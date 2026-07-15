// Shared semantic contract for the IdeaSpaces tools exposed by agent surfaces.
//
// Claude Code (MCP) and Pi use different schema libraries and intentionally
// differ in a few surface behaviors. This contract fixes only their common
// agent-facing tool names and argument shapes. Descriptions, result envelopes,
// lifecycle UI, and arguments marked `surface-specific` remain owned by each
// connector.

export type ToolParameterType = "string" | "boolean" | "string[]";

export interface ToolParameterContract {
  type: ToolParameterType;
  required: boolean;
  values?: readonly string[];
}

export interface SharedToolContract {
  parameters: Readonly<Record<string, ToolParameterContract>> | "surface-specific";
  /** At least one named argument must be a non-empty string. */
  requireAny?: readonly string[];
}

export const COMMON_TOOL_CONTRACT = {
  is_auth: {
    parameters: {
      action: { type: "string", required: false, values: ["login", "logout"] },
    },
  },
  is_write: {
    parameters: {
      path: { type: "string", required: true },
      content: { type: "string", required: true },
      name: { type: "string", required: false },
      summary: { type: "string", required: false },
      tags: { type: "string[]", required: false },
      attached_to: { type: "string", required: false },
      if_match: { type: "string", required: false },
      force: { type: "boolean", required: false },
      cwd: { type: "string", required: false },
    },
  },
  is_status: {
    parameters: {
      path: { type: "string", required: false },
      cwd: { type: "string", required: false },
    },
  },
  is_commit: {
    parameters: {
      message: { type: "string", required: true },
      paths: { type: "string[]", required: false },
      all: { type: "boolean", required: false },
      op: {
        type: "string",
        required: false,
        values: ["create", "update", "move", "delete", "restructure", "capture"],
      },
      cwd: { type: "string", required: false },
    },
  },
  is_change_open: {
    parameters: {
      handle: { type: "string", required: false },
      id: { type: "string", required: false },
    },
    requireAny: ["handle", "id"],
  },
  is_change_close: {
    parameters: {},
  },
  is_navigate: {
    // Claude returns orientation for a cwd-relative path. Pi updates persistent
    // focus and can inspect mounts. The intent is common; the arguments are not.
    parameters: "surface-specific",
  },
  is_pull: {
    parameters: {
      dry_run: { type: "boolean", required: false },
      rebase: { type: "boolean", required: false },
      cwd: { type: "string", required: false },
    },
  },
  is_push: {
    parameters: {
      dry_run: { type: "boolean", required: false },
      cwd: { type: "string", required: false },
    },
  },
} as const satisfies Readonly<Record<string, SharedToolContract>>;

export type CommonToolName = keyof typeof COMMON_TOOL_CONTRACT;

export const COMMON_TOOL_NAMES = Object.freeze(
  Object.keys(COMMON_TOOL_CONTRACT) as CommonToolName[],
);
