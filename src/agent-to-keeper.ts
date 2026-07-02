/**
 * Translate pi's `AgentEvent` stream into the Keeper event vocabulary.
 *
 * The bridge that lets a local pi runtime speak the same transcript wire format
 * the Keeper (and every client) already understands ([keeper-events](./keeper-events.ts)).
 * Pure and deterministic given its inputs — feed it pi events one by one, get
 * zero-or-more Keeper events back. State (accumulated text, tool timing, tool
 * calls) lives in the instance; nothing else.
 *
 * The important fold: a single pi `prompt` emits **one** `agent_start … agent_end`
 * wrapping **many** inner `turn_start/turn_end` (each ReAct iteration). The Keeper
 * vocabulary is **one** `message_start … turn_complete` per turn — so we open on
 * `agent_start`, count inner turns as `iterations`, accumulate text across all of
 * them, and close once on `agent_end`. Inner turn boundaries emit nothing.
 *
 * We mirror pi's event *shape* structurally rather than depend on
 * `@earendil-works/pi-agent-core`, to keep the SDK dependency-free. The
 * connector-specific parts — building the workspace surface from tool calls, the
 * final usage, the position — are injected, so this stays generic (the bridge,
 * A3, supplies pi-is-space-aware implementations).
 */

import {
  type KeeperStreamEvent,
  type KeeperToolCallSummary,
  type KeeperTurnResult,
  type KeeperUsage,
  type KeeperWorkspaceSurface,
  emptyWorkspaceSurface,
  zeroUsage,
} from "./keeper-events.js";

/** The streaming sub-event pi carries inside `message_update`. Structural mirror
 * of pi-ai's `AssistantMessageEvent`; we only read `type` + `delta`. */
export interface PiAssistantMessageEvent {
  type: string;
  delta?: string;
}

/** Structural mirror of pi-agent-core's `AgentEvent` — the fields we translate. */
export type PiAgentEvent =
  | { type: "agent_start" }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "message_start" }
  | { type: "message_update"; assistantMessageEvent: PiAssistantMessageEvent }
  | { type: "message_end" }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: "agent_end" };

/** A completed tool call, with enough context for a connector to classify it. */
export interface ToolInvocation {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  isError: boolean;
}

export interface KeeperTranslatorConfig {
  conversationId: string;
  modelTier: string;
  /** Position reported in `turn_complete`. Default "". */
  position?: string;
  /** Injectable clock for tool durations. Default `Date.now`. */
  now?: () => number;
  /** Connector-aware workspace harvest from the turn's tool calls. Default empty. */
  harvestWorkspace?: (tools: ToolInvocation[]) => KeeperWorkspaceSurface;
  /** Final token accounting. Default zeros for the tier. */
  finalUsage?: () => KeeperUsage;
  /** Render a tool result into a short preview string. Default: text/JSON, truncated. */
  toolResultPreview?: (result: unknown) => string;
}

const PREVIEW_LIMIT = 500;

/** Default preview: pull `content[].text` if present, else JSON; truncate. */
export function defaultToolResultPreview(result: unknown): string {
  let text: string;
  const content = (result as { content?: unknown })?.content;
  if (Array.isArray(content)) {
    text = content
      .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : ""))
      .filter(Boolean)
      .join("\n");
    if (!text) text = JSON.stringify(result);
  } else if (typeof result === "string") {
    text = result;
  } else {
    text = JSON.stringify(result) ?? "";
  }
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}…` : text;
}

/**
 * Stateful translator for one pi agent run → one Keeper turn. Construct per turn;
 * feed every pi event through {@link translate}; on terminal signals from the RPC
 * layer, call {@link cancelled} or {@link error}.
 */
export class KeeperTranslator {
  private readonly cfg: Required<KeeperTranslatorConfig>;
  private responseText = "";
  private iterations = 0;
  private started = false;
  private ended = false;
  private readonly toolCalls: KeeperToolCallSummary[] = [];
  private readonly invocations: ToolInvocation[] = [];
  private readonly toolStart = new Map<string, { args: Record<string, unknown>; at: number }>();

  constructor(config: KeeperTranslatorConfig) {
    this.cfg = {
      position: "",
      now: () => Date.now(),
      harvestWorkspace: () => emptyWorkspaceSurface(),
      finalUsage: () => zeroUsage(config.modelTier),
      toolResultPreview: defaultToolResultPreview,
      ...config,
    };
  }

  /** Translate one pi event into zero-or-more Keeper events. */
  translate(ev: PiAgentEvent): KeeperStreamEvent[] {
    switch (ev.type) {
      case "agent_start": {
        if (this.started) return [];
        this.started = true;
        return [
          { type: "message_start", conversation_id: this.cfg.conversationId, model_tier: this.cfg.modelTier },
        ];
      }
      case "turn_start":
        this.iterations += 1;
        return [];
      case "message_update": {
        const a = ev.assistantMessageEvent;
        if (a.type === "thinking_delta" && a.delta) return [{ type: "thinking_delta", delta: a.delta }];
        if (a.type === "text_delta" && a.delta) {
          this.responseText += a.delta;
          return [{ type: "text_delta", delta: a.delta }];
        }
        return [];
      }
      case "tool_execution_start":
        this.toolStart.set(ev.toolCallId, { args: ev.args, at: this.cfg.now() });
        return [{ type: "tool_start", tool_name: ev.toolName, tool_call_id: ev.toolCallId, tool_args: ev.args }];
      case "tool_execution_end": {
        const s = this.toolStart.get(ev.toolCallId);
        const args = s?.args ?? {};
        const duration_ms = s ? Math.max(0, this.cfg.now() - s.at) : 0;
        this.toolStart.delete(ev.toolCallId);
        this.toolCalls.push({ name: ev.toolName, args, duration_ms, is_error: ev.isError });
        this.invocations.push({ name: ev.toolName, args, result: ev.result, isError: ev.isError });
        return [
          {
            type: "tool_result",
            tool_call_id: ev.toolCallId,
            tool_name: ev.toolName,
            result_preview: this.cfg.toolResultPreview(ev.result),
            is_error: ev.isError,
            duration_ms,
          },
        ];
      }
      case "agent_end": {
        if (this.ended) return [];
        this.ended = true;
        const usage = this.cfg.finalUsage();
        const result: KeeperTurnResult = {
          response: this.responseText,
          usage,
          tool_calls: this.toolCalls,
          iterations: this.iterations,
          position: this.cfg.position,
          workspace: this.cfg.harvestWorkspace(this.invocations),
        };
        return [
          { type: "message_delta", usage },
          { type: "turn_complete", result },
        ];
      }
      default:
        return [];
    }
  }

  /** Terminal: the run was aborted. The caller detects this from the RPC layer. */
  cancelled(reason: string): KeeperStreamEvent {
    this.ended = true;
    return { type: "cancelled", reason };
  }

  /** Terminal: the run errored. The caller detects this from the RPC layer. */
  error(errorType: string, message: string): KeeperStreamEvent {
    this.ended = true;
    return { type: "error", error_type: errorType, message };
  }

  /** Whether a terminal event (turn_complete/cancelled/error) has been emitted. */
  get isEnded(): boolean {
    return this.ended;
  }
}
