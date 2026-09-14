import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ClaudeTranslator,
  claudeToolBaseName,
  normalizeClaudeInvocation,
  parseClaudeStreamLine,
  type ClaudeStreamLine,
} from "./claude-to-keeper.js";
import { KeeperTranslator, type PiAgentEvent, type ToolInvocation } from "./agent-to-keeper.js";
import type { KeeperStreamEvent, KeeperTurnCompleteEvent } from "./keeper-events.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/claude-stream-json.jsonl", import.meta.url));

/** The recorded `claude -p … --output-format stream-json --include-partial-messages` run. */
function fixtureLines(): ClaudeStreamLine[] {
  return readFileSync(FIXTURE, "utf8")
    .split("\n")
    .map(parseClaudeStreamLine)
    .filter((l): l is ClaudeStreamLine => l !== undefined);
}

function run(lines: ClaudeStreamLine[], cfg = {}): KeeperStreamEvent[] {
  const t = new ClaudeTranslator(cfg);
  return lines.flatMap((l) => t.translate(l));
}

const init: ClaudeStreamLine = { type: "system", subtype: "init", session_id: "sess-1", model: "claude-opus-5" };
const apiStart: ClaudeStreamLine = { type: "stream_event", event: { type: "message_start", message: { model: "claude-opus-5" } } };
const text = (t: string): ClaudeStreamLine => ({
  type: "stream_event",
  event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } },
});
const thinking = (t: string): ClaudeStreamLine => ({
  type: "stream_event",
  event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: t } },
});
const toolUse = (id: string, name: string, input: Record<string, unknown>): ClaudeStreamLine => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name, input }] },
});
const toolResult = (id: string, content: unknown, is_error?: boolean): ClaudeStreamLine => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error }] },
});
const success: ClaudeStreamLine = {
  type: "result",
  subtype: "success",
  is_error: false,
  result: "done",
  num_turns: 2,
  total_cost_usd: 0.01,
  usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 },
};

describe("ClaudeTranslator — event mapping", () => {
  it("maps system.init → message_start with the session as conversation and the model as tier", () => {
    expect(run([init])).toEqual([{ type: "message_start", conversation_id: "sess-1", model_tier: "claude-opus-5" }]);
  });

  it("lets the caller override conversation id and tier", () => {
    expect(run([init], { conversationId: "conv-9", modelTier: "opus" })).toEqual([
      { type: "message_start", conversation_id: "conv-9", model_tier: "opus" },
    ]);
  });

  it("streams text and non-empty thinking; JSON fragments and signatures are dropped", () => {
    const out = run([
      init,
      apiStart,
      thinking(""), // headless thinking is redacted — an empty delta is silence
      thinking("weighing it"),
      { type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"a" } } },
      { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "signature_delta" } } },
      text("Hel"),
      text("lo"),
    ]);
    expect(out).toEqual([
      { type: "message_start", conversation_id: "sess-1", model_tier: "claude-opus-5" },
      { type: "thinking_delta", delta: "weighing it" },
      { type: "text_delta", delta: "Hel" },
      { type: "text_delta", delta: "lo" },
    ]);
  });

  it("opens a tool call from the assistant record and closes it from the user record, timing it", () => {
    let now = 1000;
    const t = new ClaudeTranslator({ now: () => now });
    t.translate(init);
    const start = t.translate(toolUse("toolu_1", "Read", { file_path: "/x/a.md" }));
    now = 1250;
    const end = t.translate(toolResult("toolu_1", "1\thello"));
    expect(start).toEqual([{ type: "tool_start", tool_name: "Read", tool_call_id: "toolu_1", tool_args: { file_path: "/x/a.md" } }]);
    expect(end).toEqual([
      { type: "tool_result", tool_call_id: "toolu_1", tool_name: "Read", result_preview: "1\thello", is_error: false, duration_ms: 250 },
    ]);
  });

  it("previews array tool_result content and carries is_error", () => {
    const out = run([
      init,
      toolUse("toolu_2", "Bash", { command: "false" }),
      toolResult("toolu_2", [{ type: "text", text: "exit 1" }], true),
    ]);
    expect(out[2]).toMatchObject({ type: "tool_result", result_preview: "exit 1", is_error: true });
  });

  it("ignores a tool_result it never saw the call for, and a duplicate tool_use", () => {
    const out = run([
      init,
      toolResult("ghost", "nothing"),
      toolUse("toolu_3", "Read", { file_path: "a" }),
      toolUse("toolu_3", "Read", { file_path: "a" }),
    ]);
    expect(out.map((e) => e.type)).toEqual(["message_start", "tool_start"]);
  });

  it("emits the assistant text whole when nothing was streamed (no --include-partial-messages)", () => {
    const out = run([init, { type: "assistant", message: { content: [{ type: "text", text: "whole answer" }] } }, success]);
    expect(out[1]).toEqual({ type: "text_delta", delta: "whole answer" });
    const done = out.at(-1) as KeeperTurnCompleteEvent;
    expect(done.result.response).toBe("whole answer");
  });

  it("does not double the text when the assistant record follows streamed deltas", () => {
    const out = run([
      init,
      apiStart,
      text("streamed"),
      { type: "assistant", message: { content: [{ type: "text", text: "streamed" }] } },
      success,
    ]);
    expect(out.filter((e) => e.type === "text_delta")).toHaveLength(1);
    expect((out.at(-1) as KeeperTurnCompleteEvent).result.response).toBe("streamed");
  });

  it("drops lines it does not recognise", () => {
    expect(run([init, { type: "rate_limit_event" }, { type: "system", subtype: "hook_started" }, { type: "system", subtype: "status" }])).toHaveLength(1);
  });
});

describe("ClaudeTranslator — the turn fold", () => {
  const spike: ClaudeStreamLine[] = [
    init,
    apiStart,
    thinking("let me look"),
    toolUse("toolu_1", "Read", { file_path: "/s/now.md" }),
    toolResult("toolu_1", "1\tNow: spike"),
    apiStart,
    text("You are "),
    text("at the root."),
    success,
  ];

  it("emits exactly one message_start and one turn_complete for the whole run", () => {
    const out = run(spike);
    expect(out.filter((e) => e.type === "message_start")).toHaveLength(1);
    expect(out.filter((e) => e.type === "turn_complete")).toHaveLength(1);
  });

  it("folds text across API messages, counts iterations, and carries usage + cost from result", () => {
    const done = run(spike).find((e) => e.type === "turn_complete") as KeeperTurnCompleteEvent;
    expect(done.result.response).toBe("You are at the root.");
    expect(done.result.iterations).toBe(2);
    expect(done.result.tool_calls).toEqual([{ name: "Read", args: { file_path: "/s/now.md" }, duration_ms: expect.any(Number), is_error: false }]);
    expect(done.result.usage).toEqual({
      input_tokens: 10,
      output_tokens: 20,
      cache_read_tokens: 100,
      cache_creation_tokens: 5,
      model_tier: "claude-opus-5",
      total_tokens: 135,
      cost_usd: 0.01,
    });
  });

  it("emits message_delta immediately before turn_complete", () => {
    const out = run(spike);
    const i = out.findIndex((e) => e.type === "turn_complete");
    expect(out[i - 1].type).toBe("message_delta");
  });

  it("hands the turn's invocations to the harvest with Claude's own tool names", () => {
    const seen: ToolInvocation[][] = [];
    run(spike, { harvestWorkspace: (tools: ToolInvocation[]) => { seen.push(tools); return { created: [], modified: [], deleted: [], read: ["/s/now.md"], mentioned: [] }; } });
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toMatchObject({ name: "Read", args: { file_path: "/s/now.md" }, isError: false });
  });

  it("ignores lines after result (idempotent close)", () => {
    const t = new ClaudeTranslator();
    spike.forEach((l) => t.translate(l));
    expect(t.isEnded).toBe(true);
    expect(t.translate(success)).toEqual([]);
    expect(t.translate(text("more"))).toEqual([]);
  });

  it("falls back to the result text when nothing streamed at all", () => {
    const done = run([init, success]).at(-1) as KeeperTurnCompleteEvent;
    expect(done.result.response).toBe("done");
    expect(done.result.iterations).toBe(2); // num_turns stands in for uncounted messages
  });
});

describe("ClaudeTranslator — failure inside a clean result", () => {
  it("emits error, not turn_complete, when result is not a success", () => {
    const out = run([init, apiStart, text("partial"), { type: "result", subtype: "error_max_turns", is_error: true, result: "Reached max turns (1)" }]);
    expect(out.at(-1)).toEqual({ type: "error", error_type: "claude_error_max_turns", message: "Reached max turns (1)" });
    expect(out.some((e) => e.type === "turn_complete")).toBe(false);
  });

  it("falls back to a generic message when the result carries no text", () => {
    const out = run([init, { type: "result", subtype: "error_during_execution", is_error: true }]);
    expect(out.at(-1)).toEqual({
      type: "error",
      error_type: "claude_error_during_execution",
      message: "Claude Code ended the turn with error_during_execution.",
    });
  });

  it("cancelled/error from the process layer close the turn", () => {
    const t = new ClaudeTranslator();
    t.translate(init);
    expect(t.cancelled("killed")).toEqual({ type: "cancelled", reason: "killed" });
    expect(t.isEnded).toBe(true);
    expect(t.translate(success)).toEqual([]);
  });
});

describe("parseClaudeStreamLine", () => {
  it("parses records and skips blanks, prose, and JSON without a type", () => {
    expect(parseClaudeStreamLine('{"type":"result","subtype":"success"}')).toEqual({ type: "result", subtype: "success" });
    expect(parseClaudeStreamLine("")).toBeUndefined();
    expect(parseClaudeStreamLine("warning: something")).toBeUndefined();
    expect(parseClaudeStreamLine('{"no":"type"}')).toBeUndefined();
    expect(parseClaudeStreamLine("{not json")).toBeUndefined();
  });
});

describe("Claude tool names for the workspace harvest", () => {
  it("strips the MCP server prefix", () => {
    expect(claudeToolBaseName("mcp__plugin_ideaspaces_core__is_write")).toBe("is_write");
    expect(claudeToolBaseName("Write")).toBe("Write");
  });

  it("rewrites native file tools into the pi-shaped write/edit/read with `path`", () => {
    const inv = (name: string, args: Record<string, unknown>): ToolInvocation => ({ name, args, result: null, isError: false });
    expect(normalizeClaudeInvocation(inv("Write", { file_path: "/s/a.md", content: "x" }))).toMatchObject({ name: "write", args: { path: "/s/a.md" } });
    expect(normalizeClaudeInvocation(inv("Edit", { file_path: "/s/a.md" }))).toMatchObject({ name: "edit", args: { path: "/s/a.md" } });
    expect(normalizeClaudeInvocation(inv("MultiEdit", { file_path: "/s/a.md" }))).toMatchObject({ name: "edit" });
    expect(normalizeClaudeInvocation(inv("NotebookEdit", { notebook_path: "/s/n.ipynb" }))).toMatchObject({ name: "edit", args: { path: "/s/n.ipynb" } });
    expect(normalizeClaudeInvocation(inv("Read", { file_path: "/s/a.md" }))).toMatchObject({ name: "read", args: { path: "/s/a.md" } });
    expect(normalizeClaudeInvocation(inv("mcp__plugin_ideaspaces_core__is_write", { path: "n.md" }))).toMatchObject({ name: "is_write", args: { path: "n.md" } });
    const bash = inv("Bash", { command: "ls" });
    expect(normalizeClaudeInvocation(bash)).toBe(bash);
  });
});

describe("ClaudeTranslator — the recorded fixture", () => {
  // Write a note, read it back, say "done": two API messages, two tool calls.
  const lines = fixtureLines();

  it("is a real recording: init, deltas, assistant, user, result", () => {
    const types = new Set(lines.map((l) => l.type));
    expect([...types].sort()).toEqual(["assistant", "rate_limit_event", "result", "stream_event", "system", "user"]);
  });

  it("replays into the Keeper event sequence", () => {
    const out = run(lines);
    expect(out.map((e) => e.type)).toEqual([
      "message_start",
      "tool_start",
      "tool_result",
      "tool_start",
      "tool_result",
      "text_delta",
      "message_delta",
      "turn_complete",
    ]);
    expect(out[0]).toEqual({ type: "message_start", conversation_id: "d0b2e296-c2b7-4fa4-8227-6390639ea756", model_tier: "claude-haiku-4-5-20251001" });
    expect(out[1]).toMatchObject({ type: "tool_start", tool_name: "Write", tool_args: { file_path: "/home/user/space/notes/hello.md", content: "hello from fixture" } });
    expect(out[2]).toMatchObject({ type: "tool_result", tool_name: "Write", is_error: false });
    expect(out[3]).toMatchObject({ type: "tool_start", tool_name: "Read", tool_args: { file_path: "/home/user/space/notes/hello.md" } });
    expect(out[4]).toMatchObject({ type: "tool_result", tool_name: "Read", result_preview: "1\thello from fixture" });
    expect(out[5]).toEqual({ type: "text_delta", delta: "done" });
    const done = out[7] as KeeperTurnCompleteEvent;
    expect(done.result).toMatchObject({
      response: "done",
      iterations: 2,
      position: "",
      usage: { input_tokens: 18, output_tokens: 591, cache_read_tokens: 35279, cache_creation_tokens: 8762, cost_usd: 0.0250219, model_tier: "claude-haiku-4-5-20251001" },
    });
    expect(done.result.tool_calls.map((c) => c.name)).toEqual(["Write", "Read"]);
  });

  it("produces the same event sequence a pi turn would for the equivalent transcript", () => {
    // The pi run that writes a note, reads it back, and answers "done".
    const piEvents: PiAgentEvent[] = [
      { type: "agent_start" },
      { type: "turn_start" },
      { type: "tool_execution_start", toolCallId: "t1", toolName: "write", args: { path: "notes/hello.md", content: "hello from fixture" } },
      { type: "tool_execution_end", toolCallId: "t1", toolName: "write", result: "ok", isError: false },
      { type: "tool_execution_start", toolCallId: "t2", toolName: "read", args: { path: "notes/hello.md" } },
      { type: "tool_execution_end", toolCallId: "t2", toolName: "read", result: "hello from fixture", isError: false },
      { type: "turn_end" },
      { type: "turn_start" },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } },
      { type: "turn_end" },
      { type: "agent_end" },
    ];
    const pi = new KeeperTranslator({ conversationId: "c", modelTier: "haiku" });
    const piOut = piEvents.flatMap((e) => pi.translate(e));
    const claudeOut = run(lines);
    expect(claudeOut.map((e) => e.type)).toEqual(piOut.map((e) => e.type));
    const piDone = piOut.at(-1) as KeeperTurnCompleteEvent;
    const claudeDone = claudeOut.at(-1) as KeeperTurnCompleteEvent;
    expect(claudeDone.result.response).toBe(piDone.result.response);
    expect(claudeDone.result.iterations).toBe(piDone.result.iterations);
    expect(claudeDone.result.tool_calls.map((c) => normalizeClaudeInvocation({ ...c, result: null, isError: c.is_error }).name))
      .toEqual(piDone.result.tool_calls.map((c) => c.name));
  });

  it("harvests the written and read note through the normalised invocations", () => {
    let harvested: ToolInvocation[] = [];
    run(lines, { harvestWorkspace: (tools: ToolInvocation[]) => { harvested = tools.map(normalizeClaudeInvocation); return { created: [], modified: [], deleted: [], read: [], mentioned: [] }; } });
    expect(harvested.map((t) => [t.name, t.args.path])).toEqual([
      ["write", "/home/user/space/notes/hello.md"],
      ["read", "/home/user/space/notes/hello.md"],
    ]);
  });
});
