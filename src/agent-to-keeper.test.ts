import { describe, it, expect } from "vitest";
import {
  KeeperTranslator,
  defaultToolResultPreview,
  type PiAgentEvent,
  type ToolInvocation,
} from "./agent-to-keeper.js";
import type { KeeperStreamEvent, KeeperTurnCompleteEvent } from "./keeper-events.js";

/** Run a whole pi event sequence through a fresh translator, flatten the output. */
function run(events: PiAgentEvent[], cfg = {}): KeeperStreamEvent[] {
  const t = new KeeperTranslator({ conversationId: "conv1", modelTier: "opus", ...cfg });
  return events.flatMap((e) => t.translate(e));
}

const td = (delta: string): PiAgentEvent => ({
  type: "message_update",
  assistantMessageEvent: { type: "text_delta", delta },
});
const think = (delta: string): PiAgentEvent => ({
  type: "message_update",
  assistantMessageEvent: { type: "thinking_delta", delta },
});

describe("KeeperTranslator — event mapping", () => {
  it("maps agent_start → message_start with conversation + tier", () => {
    const out = run([{ type: "agent_start" }]);
    expect(out).toEqual([{ type: "message_start", conversation_id: "conv1", model_tier: "opus" }]);
  });

  it("maps thinking/text deltas; other assistant sub-events are dropped", () => {
    const out = run([
      { type: "agent_start" },
      think("reasoning"),
      { type: "message_update", assistantMessageEvent: { type: "text_start" } },
      td("Hello"),
      { type: "message_update", assistantMessageEvent: { type: "toolcall_delta", delta: "{" } },
    ]);
    expect(out).toEqual([
      { type: "message_start", conversation_id: "conv1", model_tier: "opus" },
      { type: "thinking_delta", delta: "reasoning" },
      { type: "text_delta", delta: "Hello" },
    ]);
  });

  it("maps a tool call to tool_start + tool_result with duration from the clock", () => {
    let t = 1000;
    const clock = () => t;
    const tr = new KeeperTranslator({ conversationId: "c", modelTier: "sonnet", now: clock });
    const start = tr.translate({ type: "tool_execution_start", toolCallId: "tc1", toolName: "is_navigate", args: { path: "." } });
    t = 1200;
    const end = tr.translate({ type: "tool_execution_end", toolCallId: "tc1", toolName: "is_navigate", result: { content: [{ type: "text", text: "space root: /x" }] }, isError: false });
    expect(start).toEqual([{ type: "tool_start", tool_name: "is_navigate", tool_call_id: "tc1", tool_args: { path: "." } }]);
    expect(end).toEqual([
      { type: "tool_result", tool_call_id: "tc1", tool_name: "is_navigate", result_preview: "space root: /x", is_error: false, duration_ms: 200 },
    ]);
  });
});

describe("KeeperTranslator — the multi-turn fold", () => {
  // Mirrors the A3 spike: one agent run, two inner ReAct turns (tool then answer).
  const spike: PiAgentEvent[] = [
    { type: "agent_start" },
    { type: "turn_start" },
    think("let me look"),
    { type: "tool_execution_start", toolCallId: "tc1", toolName: "is_navigate", args: { path: "." } },
    { type: "tool_execution_end", toolCallId: "tc1", toolName: "is_navigate", result: { content: [{ type: "text", text: "Now: spike" }] }, isError: false },
    { type: "turn_end" },
    { type: "turn_start" },
    td("You are "),
    td("at the root."),
    { type: "turn_end" },
    { type: "agent_end" },
  ];

  it("emits exactly one message_start and one turn_complete for the whole run", () => {
    const out = run(spike);
    expect(out.filter((e) => e.type === "message_start")).toHaveLength(1);
    expect(out.filter((e) => e.type === "turn_complete")).toHaveLength(1);
  });

  it("folds text across inner turns and counts iterations", () => {
    const out = run(spike);
    const done = out.find((e) => e.type === "turn_complete") as KeeperTurnCompleteEvent;
    expect(done.result.response).toBe("You are at the root.");
    expect(done.result.iterations).toBe(2);
    expect(done.result.tool_calls).toHaveLength(1);
    expect(done.result.tool_calls[0]).toMatchObject({ name: "is_navigate", is_error: false });
  });

  it("emits message_delta immediately before turn_complete", () => {
    const out = run(spike);
    const i = out.findIndex((e) => e.type === "turn_complete");
    expect(out[i - 1].type).toBe("message_delta");
  });

  it("ignores events after agent_end (idempotent close)", () => {
    const t = new KeeperTranslator({ conversationId: "c", modelTier: "opus" });
    spike.forEach((e) => t.translate(e));
    expect(t.isEnded).toBe(true);
    expect(t.translate({ type: "agent_end" })).toEqual([]);
  });
});

describe("KeeperTranslator — injected workspace harvest", () => {
  it("passes the turn's tool invocations to harvestWorkspace and surfaces the result", () => {
    let seen: ToolInvocation[] = [];
    const out = run(
      [
        { type: "agent_start" },
        { type: "turn_start" },
        { type: "tool_execution_start", toolCallId: "w1", toolName: "is_write", args: { path: "notes/a.md" } },
        { type: "tool_execution_end", toolCallId: "w1", toolName: "is_write", result: "ok", isError: false },
        { type: "agent_end" },
      ],
      {
        harvestWorkspace: (tools: ToolInvocation[]) => {
          seen = tools;
          return { created: ["notes/a.md"], modified: [], deleted: [], read: [], mentioned: [] };
        },
      },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ name: "is_write", args: { path: "notes/a.md" }, result: "ok" });
    const done = out.find((e) => e.type === "turn_complete") as KeeperTurnCompleteEvent;
    expect(done.result.workspace.created).toEqual(["notes/a.md"]);
  });
});

describe("KeeperTranslator — terminal signals", () => {
  it("builds cancelled and error events and marks ended", () => {
    const t = new KeeperTranslator({ conversationId: "c", modelTier: "opus" });
    expect(t.cancelled("user aborted")).toEqual({ type: "cancelled", reason: "user aborted" });
    expect(t.isEnded).toBe(true);
    const t2 = new KeeperTranslator({ conversationId: "c", modelTier: "opus" });
    expect(t2.error("provider_error", "boom")).toEqual({ type: "error", error_type: "provider_error", message: "boom" });
  });
});

describe("defaultToolResultPreview", () => {
  it("prefers content[].text, falls back to JSON, truncates", () => {
    expect(defaultToolResultPreview({ content: [{ type: "text", text: "hi" }] })).toBe("hi");
    expect(defaultToolResultPreview("plain")).toBe("plain");
    expect(defaultToolResultPreview({ a: 1 })).toBe('{"a":1}');
    expect(defaultToolResultPreview("x".repeat(600)).endsWith("…")).toBe(true);
  });
});
