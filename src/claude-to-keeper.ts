/**
 * Translate Claude Code's headless `stream-json` output into the Keeper event
 * vocabulary — the second producer behind the same transcript that
 * [agent-to-keeper](./agent-to-keeper.ts) serves for pi.
 *
 * Input is one parsed line of `claude -p --output-format stream-json
 * --include-partial-messages` at a time. The shapes here are a structural
 * mirror of what Claude Code 2.1 emits (recorded in
 * `fixtures/claude-stream-json.jsonl`); we read only the fields we translate
 * and drop every line we do not recognise, so a new record type on their side
 * is silence on ours rather than a crash.
 *
 * The fold is the same as pi's: one `claude -p` invocation is **one** Keeper
 * turn. Each API message inside it (`stream_event` `message_start`) is one
 * ReAct iteration. Text streams from `content_block_delta`; tool calls are
 * taken from the `assistant` record, which is the first place the full
 * `input` exists (the deltas only carry JSON fragments); tool results come
 * from the `user` record; `result` closes the turn with usage and cost.
 *
 * Two things the recording settled:
 *  - Headless thinking is redacted — `thinking_delta` arrives with an empty
 *    `thinking` string and only a token estimate. We forward thinking text
 *    when there is some and stay quiet otherwise.
 *  - Without `--include-partial-messages` there are no deltas at all, only the
 *    `assistant` record. We emit its text whole in that case, so a caller that
 *    forgot the flag still gets a transcript.
 */

import { defaultToolResultPreview, type ToolInvocation } from "./agent-to-keeper.js";
import {
  type KeeperStreamEvent,
  type KeeperToolCallSummary,
  type KeeperTurnResult,
  type KeeperUsage,
  type KeeperWorkspaceSurface,
  emptyWorkspaceSurface,
  zeroUsage,
} from "./keeper-events.js";

/** A content block on an `assistant` or `user` record. */
export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; is_error?: boolean | null; content?: unknown }
  | { type: string };

/** The Anthropic API streaming event Claude Code wraps in `stream_event`. */
export type ClaudeApiStreamEvent =
  | { type: "message_start"; message?: { model?: string } }
  | { type: "content_block_start"; index: number; content_block: ClaudeContentBlock }
  | { type: "content_block_delta"; index: number; delta: { type: string; text?: string; thinking?: string; partial_json?: string } }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; usage?: ClaudeApiUsage }
  | { type: "message_stop" }
  | { type: string };

export interface ClaudeApiUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** Structural mirror of a Claude Code stream-json line — the fields we translate. */
export type ClaudeStreamLine =
  | { type: "system"; subtype: "init"; session_id: string; model?: string; cwd?: string; permissionMode?: string; claude_code_version?: string }
  | { type: "system"; subtype: string; session_id?: string }
  | { type: "stream_event"; event: ClaudeApiStreamEvent; session_id?: string }
  | { type: "assistant"; message: { content: ClaudeContentBlock[] }; session_id?: string }
  | { type: "user"; message: { content: ClaudeContentBlock[] | string }; tool_use_result?: unknown; session_id?: string }
  | {
      type: "result";
      subtype: string;
      is_error?: boolean;
      result?: string;
      session_id?: string;
      num_turns?: number;
      total_cost_usd?: number;
      usage?: ClaudeApiUsage;
      permission_denials?: unknown[];
    }
  | { type: string };

/** Parse one stdout line. Blank and non-JSON lines are `undefined` — Claude Code
 *  keeps stdout clean, but a runner should not die on a stray warning. */
export function parseClaudeStreamLine(line: string): ClaudeStreamLine | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && typeof (parsed as { type?: unknown }).type === "string") {
      return parsed as ClaudeStreamLine;
    }
  } catch {
    /* not a record */
  }
  return undefined;
}

export interface ClaudeTranslatorConfig {
  /** Keeper conversation id. Default: the session id from `system.init`. */
  conversationId?: string;
  /** Model tier reported on `message_start` and in usage. Default: the model from `system.init`. */
  modelTier?: string;
  /** Position reported in `turn_complete`. Default "". */
  position?: string;
  /** Injectable clock for tool durations. Default `Date.now`. */
  now?: () => number;
  /** Connector-aware workspace harvest from the turn's tool calls. Default empty.
   *  Invocations carry Claude's own tool names; see {@link normalizeClaudeInvocation}. */
  harvestWorkspace?: (tools: ToolInvocation[]) => KeeperWorkspaceSurface;
  /** Render a tool result into a short preview string. Default: text/JSON, truncated. */
  toolResultPreview?: (result: unknown) => string;
}

/**
 * Stateful translator for one `claude -p` run → one Keeper turn. Construct per
 * turn; feed every parsed line through {@link translate}; on terminal signals
 * from the process layer, call {@link cancelled} or {@link error}.
 */
export class ClaudeTranslator {
  private readonly cfg: Required<Omit<ClaudeTranslatorConfig, "conversationId" | "modelTier">> &
    Pick<ClaudeTranslatorConfig, "conversationId" | "modelTier">;
  private conversationId = "";
  private modelTier = "";
  private responseText = "";
  private iterations = 0;
  private started = false;
  private ended = false;
  /** Text was streamed as deltas in the current API message — the `assistant`
   *  record for it is then a duplicate, not new text. */
  private textStreamed = false;
  private thinkingStreamed = false;
  private readonly toolCalls: KeeperToolCallSummary[] = [];
  private readonly invocations: ToolInvocation[] = [];
  private readonly toolStart = new Map<string, { name: string; args: Record<string, unknown>; at: number }>();
  /** Usage summed from per-message `message_delta`s — the fallback when `result` carries none. */
  private streamedUsage: Required<ClaudeApiUsage> = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };

  constructor(config: ClaudeTranslatorConfig = {}) {
    this.cfg = {
      position: "",
      now: () => Date.now(),
      harvestWorkspace: () => emptyWorkspaceSurface(),
      toolResultPreview: defaultToolResultPreview,
      ...config,
    };
  }

  /** Translate one stream-json line into zero-or-more Keeper events. */
  translate(line: ClaudeStreamLine): KeeperStreamEvent[] {
    if (this.ended) return [];
    switch (line.type) {
      case "system": {
        const sys = line as Extract<ClaudeStreamLine, { type: "system" }>;
        if (sys.subtype !== "init") return [];
        const init = sys as Extract<ClaudeStreamLine, { subtype: "init" }>;
        return this.open(init.session_id, init.model);
      }
      case "stream_event":
        return this.translateStreamEvent((line as Extract<ClaudeStreamLine, { type: "stream_event" }>).event);
      case "assistant":
        return this.translateAssistant((line as Extract<ClaudeStreamLine, { type: "assistant" }>).message.content);
      case "user": {
        const u = line as Extract<ClaudeStreamLine, { type: "user" }>;
        return this.translateUser(u.message.content, u.tool_use_result);
      }
      case "result":
        return this.translateResult(line as Extract<ClaudeStreamLine, { type: "result" }>);
      default:
        return [];
    }
  }

  /** Terminal: the run was aborted. The caller detects this from the process layer. */
  cancelled(reason: string): KeeperStreamEvent {
    this.ended = true;
    return { type: "cancelled", reason };
  }

  /** Terminal: the run errored. The caller detects this from the process layer. */
  error(errorType: string, message: string): KeeperStreamEvent {
    this.ended = true;
    return { type: "error", error_type: errorType, message };
  }

  /** Whether a terminal event (turn_complete/cancelled/error) has been emitted. */
  get isEnded(): boolean {
    return this.ended;
  }

  /** The session id Claude Code reported (or the configured override), once opened. */
  get sessionId(): string {
    return this.conversationId;
  }

  private open(sessionId?: string, model?: string): KeeperStreamEvent[] {
    if (this.started) return [];
    this.started = true;
    this.conversationId = this.cfg.conversationId ?? sessionId ?? "";
    this.modelTier = this.cfg.modelTier ?? model ?? "";
    return [{ type: "message_start", conversation_id: this.conversationId, model_tier: this.modelTier }];
  }

  private translateStreamEvent(ev: ClaudeApiStreamEvent): KeeperStreamEvent[] {
    switch (ev.type) {
      case "message_start": {
        // A resumed run without `system.init` in front still opens cleanly.
        const opened = this.open(undefined, (ev as { message?: { model?: string } }).message?.model);
        this.iterations += 1;
        this.textStreamed = false;
        this.thinkingStreamed = false;
        return opened;
      }
      case "content_block_delta": {
        const { delta } = ev as Extract<ClaudeApiStreamEvent, { type: "content_block_delta" }>;
        if (delta.type === "text_delta" && delta.text) {
          this.textStreamed = true;
          this.responseText += delta.text;
          return [{ type: "text_delta", delta: delta.text }];
        }
        if (delta.type === "thinking_delta" && delta.thinking) {
          this.thinkingStreamed = true;
          return [{ type: "thinking_delta", delta: delta.thinking }];
        }
        return [];
      }
      case "message_delta": {
        const usage = (ev as Extract<ClaudeApiStreamEvent, { type: "message_delta" }>).usage;
        if (usage) {
          this.streamedUsage.input_tokens += usage.input_tokens ?? 0;
          this.streamedUsage.output_tokens += usage.output_tokens ?? 0;
          this.streamedUsage.cache_read_input_tokens += usage.cache_read_input_tokens ?? 0;
          this.streamedUsage.cache_creation_input_tokens += usage.cache_creation_input_tokens ?? 0;
        }
        return [];
      }
      default:
        return [];
    }
  }

  private translateAssistant(content: ClaudeContentBlock[]): KeeperStreamEvent[] {
    const out: KeeperStreamEvent[] = [...this.open()];
    for (const block of content) {
      if (block.type === "tool_use") {
        const tool = block as Extract<ClaudeContentBlock, { type: "tool_use" }>;
        if (this.toolStart.has(tool.id)) continue;
        const args = tool.input ?? {};
        this.toolStart.set(tool.id, { name: tool.name, args, at: this.cfg.now() });
        out.push({ type: "tool_start", tool_name: tool.name, tool_call_id: tool.id, tool_args: args });
      } else if (block.type === "text") {
        const { text } = block as Extract<ClaudeContentBlock, { type: "text" }>;
        if (this.textStreamed || !text) continue;
        this.responseText += text;
        out.push({ type: "text_delta", delta: text });
      } else if (block.type === "thinking") {
        const { thinking } = block as Extract<ClaudeContentBlock, { type: "thinking" }>;
        if (this.thinkingStreamed || !thinking) continue;
        out.push({ type: "thinking_delta", delta: thinking });
      }
    }
    return out;
  }

  private translateUser(content: ClaudeContentBlock[] | string, structured: unknown): KeeperStreamEvent[] {
    if (typeof content === "string") return [];
    const out: KeeperStreamEvent[] = [];
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      const r = block as Extract<ClaudeContentBlock, { type: "tool_result" }>;
      const s = this.toolStart.get(r.tool_use_id);
      if (!s) continue; // a result for a call we never saw — nothing to close
      this.toolStart.delete(r.tool_use_id);
      const duration_ms = Math.max(0, this.cfg.now() - s.at);
      const isError = r.is_error === true;
      const preview = typeof r.content === "string" ? r.content : { content: r.content };
      this.toolCalls.push({ name: s.name, args: s.args, duration_ms, is_error: isError });
      this.invocations.push({ name: s.name, args: s.args, result: structured ?? r.content, isError });
      out.push({
        type: "tool_result",
        tool_call_id: r.tool_use_id,
        tool_name: s.name,
        result_preview: this.cfg.toolResultPreview(preview),
        is_error: isError,
        duration_ms,
      });
    }
    return out;
  }

  private translateResult(res: Extract<ClaudeStreamLine, { type: "result" }>): KeeperStreamEvent[] {
    const opened = this.open(res.session_id);
    if (res.is_error || res.subtype !== "success") {
      // Claude Code closes an aborted or failed run with a `result` too —
      // `error_max_turns`, `error_during_execution`, ... — and the text it
      // carries is the error, not a response.
      const message = res.result?.trim() || `Claude Code ended the turn with ${res.subtype}.`;
      return [...opened, this.error(`claude_${res.subtype}`, message)];
    }
    this.ended = true;
    // The recorded transcript wins; the `result` text is the same final message
    // and only stands in when nothing streamed (a run without deltas or records).
    if (!this.responseText && typeof res.result === "string") this.responseText = res.result;
    const usage = this.usage(res.usage ?? this.streamedUsage, res.total_cost_usd ?? 0);
    const result: KeeperTurnResult = {
      response: this.responseText,
      usage,
      tool_calls: this.toolCalls,
      iterations: this.iterations || res.num_turns || 0,
      position: this.cfg.position,
      workspace: this.cfg.harvestWorkspace(this.invocations),
    };
    return [...opened, { type: "message_delta", usage }, { type: "turn_complete", result }];
  }

  private usage(api: ClaudeApiUsage, costUsd: number): KeeperUsage {
    const u = zeroUsage(this.modelTier);
    u.input_tokens = api.input_tokens ?? 0;
    u.output_tokens = api.output_tokens ?? 0;
    u.cache_read_tokens = api.cache_read_input_tokens ?? 0;
    u.cache_creation_tokens = api.cache_creation_input_tokens ?? 0;
    u.total_tokens = u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_creation_tokens;
    u.cost_usd = costUsd;
    return u;
  }
}

/**
 * Which Claude Code tools touch files, and where the path lives in their input.
 * Settled by the recorded run: the native file tools take `file_path`
 * (`NotebookEdit` takes `notebook_path`); MCP tools arrive as
 * `mcp__<server>__<tool>`, so `is_write` from the ideaspaces plugin is reached
 * through {@link claudeToolBaseName}.
 */
export const CLAUDE_FILE_TOOLS: Readonly<Record<string, { kind: "write" | "edit" | "read"; pathArg: string }>> = {
  Write: { kind: "write", pathArg: "file_path" },
  Edit: { kind: "edit", pathArg: "file_path" },
  MultiEdit: { kind: "edit", pathArg: "file_path" },
  NotebookEdit: { kind: "edit", pathArg: "notebook_path" },
  Read: { kind: "read", pathArg: "file_path" },
};

/** `mcp__plugin_ideaspaces_core__is_write` → `is_write`; native names pass through. */
export function claudeToolBaseName(name: string): string {
  const m = /^mcp__.+?__(.+)$/u.exec(name);
  return m ? m[1] : name;
}

/**
 * Rewrite a Claude tool invocation into the pi-shaped one a workspace harvest
 * already understands: lower-case `write`/`edit`/`read` with `path`, MCP names
 * stripped to their base. Everything else passes through untouched.
 */
export function normalizeClaudeInvocation(inv: ToolInvocation): ToolInvocation {
  const file = CLAUDE_FILE_TOOLS[inv.name];
  if (file) {
    const path = inv.args[file.pathArg];
    return { ...inv, name: file.kind, args: { ...inv.args, path } };
  }
  const base = claudeToolBaseName(inv.name);
  return base === inv.name ? inv : { ...inv, name: base };
}
