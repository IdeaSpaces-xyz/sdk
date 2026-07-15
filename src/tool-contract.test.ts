import { describe, expect, it } from "vitest";
import { COMMON_TOOL_CONTRACT, COMMON_TOOL_NAMES } from "./tool-contract.js";

describe("common agent tool contract", () => {
  it("fixes the complete semantic baseline shared by MCP and Pi", () => {
    expect(COMMON_TOOL_CONTRACT).toEqual({
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
    });

    expect(COMMON_TOOL_NAMES).toEqual(Object.keys(COMMON_TOOL_CONTRACT));
  });

  it("keeps cross-field requirements attached to declared parameters", () => {
    for (const [name, contract] of Object.entries(COMMON_TOOL_CONTRACT)) {
      if (!("requireAny" in contract)) continue;
      expect(contract.parameters, name).not.toBe("surface-specific");
      for (const key of contract.requireAny) {
        expect(contract.parameters, `${name}.${key}`).toHaveProperty(key);
      }
    }
  });
});
