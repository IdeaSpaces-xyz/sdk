/**
 * The Keeper conversation event contract — the streaming vocabulary a turn
 * emits, one JSON object per line, consumed by every client transcript
 * (desktop `keeper-stream-state` / `V2Transcript`, and the local-agent bridge).
 *
 * This is one of the two contracts the local runtime must honour (the other is
 * the knowledge protocol — notes / Change-Id / awareness, in `@ideaspaces/protocol`).
 * It is a **platform transport**, not a portable knowledge format, so it lives in
 * the SDK, not the protocol. Owned here so the CLI-local path and the desktop
 * share one definition instead of drifting.
 *
 * The sw_space Keeper (Python) also produces this shape; keep the two in step.
 */

/** The nine event kinds a turn stream emits, in JSON-lines. */
export const KEEPER_STREAM_EVENT_TYPES = [
  "message_start",
  "thinking_delta",
  "text_delta",
  "tool_start",
  "tool_result",
  "message_delta",
  "turn_complete",
  "cancelled",
  "error",
] as const;

export type KeeperStreamEventType = (typeof KEEPER_STREAM_EVENT_TYPES)[number];

/** Token accounting + cost for a turn. */
export interface KeeperUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  model_tier: string;
  total_tokens: number;
  cost_usd: number;
}

/** One tool the turn ran, summarised for the final result. */
export interface KeeperToolCallSummary {
  name: string;
  args: Record<string, unknown>;
  duration_ms: number;
  is_error: boolean;
  cost_usd?: number;
}

/** The files a turn touched — drives the "changed N notes → pull" surface. */
export interface KeeperWorkspaceSurface {
  created: string[];
  modified: string[];
  deleted: string[];
  read: string[];
  mentioned: string[];
}

/** The canonical result carried by `turn_complete`. */
export interface KeeperTurnResult {
  response: string;
  usage: KeeperUsage;
  tool_calls: KeeperToolCallSummary[];
  iterations: number;
  position: string;
  workspace: KeeperWorkspaceSurface;
}

export interface KeeperMessageStartEvent {
  type: "message_start";
  conversation_id: string;
  model_tier: string;
}

export interface KeeperThinkingDeltaEvent {
  type: "thinking_delta";
  delta: string;
}

export interface KeeperTextDeltaEvent {
  type: "text_delta";
  delta: string;
}

export interface KeeperToolStartEvent {
  type: "tool_start";
  tool_name: string;
  tool_call_id: string;
  tool_args: Record<string, unknown>;
}

export interface KeeperToolResultEvent {
  type: "tool_result";
  tool_call_id: string;
  tool_name: string;
  result_preview: string;
  is_error: boolean;
  duration_ms: number;
}

export interface KeeperMessageDeltaEvent {
  type: "message_delta";
  usage: KeeperUsage;
}

export interface KeeperTurnCompleteEvent {
  type: "turn_complete";
  result: KeeperTurnResult;
  name?: string;
}

export interface KeeperCancelledEvent {
  type: "cancelled";
  reason: string;
}

export interface KeeperErrorEvent {
  type: "error";
  error_type: string;
  message: string;
}

export type KeeperStreamEvent =
  | KeeperMessageStartEvent
  | KeeperThinkingDeltaEvent
  | KeeperTextDeltaEvent
  | KeeperToolStartEvent
  | KeeperToolResultEvent
  | KeeperMessageDeltaEvent
  | KeeperTurnCompleteEvent
  | KeeperCancelledEvent
  | KeeperErrorEvent;

/** An empty workspace surface — the zero value before any tool runs. */
export function emptyWorkspaceSurface(): KeeperWorkspaceSurface {
  return { created: [], modified: [], deleted: [], read: [], mentioned: [] };
}

/** Zero usage for a given model tier — the fallback when accounting is absent. */
export function zeroUsage(modelTier: string): KeeperUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    model_tier: modelTier,
    total_tokens: 0,
    cost_usd: 0,
  };
}
