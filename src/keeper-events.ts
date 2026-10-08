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

/** The ten event kinds a turn stream emits, in JSON-lines. */
export const KEEPER_STREAM_EVENT_TYPES = [
  "message_start",
  "thinking_delta",
  "text_delta",
  "tool_start",
  "tool_result",
  "message_delta",
  "turn_complete",
  "compacted",
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
  /** Local launcher disclosure. Absent for hosted turns. */
  cwd?: string;
  /** Directories actually granted by the runtime (not merely discovered). */
  added_dirs?: string[];
  /** Null means the runtime has no permission-mode mechanism; absent for hosted turns. */
  permission_mode?: string | null;
  /** Null: no tool preapproval list. A non-null list is NOT a restriction unless the
   * runtime explicitly documents one; older consumers must not infer a boundary. */
  allowed_tools?: string[] | null;
  /** Named tools are preapproved, not restrictive; absent on hosted/Pi or older launchers. */
  allowed_tools_semantics?: "preapproval";
  /** Whether a shell tool is available; absent when the launcher does not declare it. */
  shell_available?: boolean;
  runtime?: "claude" | "pi";
  /** Concrete model ID (model_tier remains the coarse accounting tier). */
  model?: string;
  /** Pi's executable extension paths and trust policy, when applicable. */
  extensions?: string[];
  trust?: "saved" | "explicit";
  /** Read receipt of Thread context provided to the agent. Absent for turns not bound to a Thread. */
  thread?: {
    /** The Thread identifier (local folder slug or hosted exchange id `x_...`). */
    thread: string;
    /** Authored title or Thread name. */
    name?: string;
    /** Number of posts or messages in the Thread. */
    post_count: number;
    /** Participant names or post authors. */
    people: string[];
    /** Authored Map note or attachment reference, or null when absent. */
    map?: string | null;
  };
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

export interface KeeperCompactedEvent {
  type: "compacted";
  pre_tokens?: number;
  post_tokens?: number;
  at: string;
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
  | KeeperCompactedEvent
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
