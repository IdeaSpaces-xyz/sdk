import { describe, expect, it } from "vitest";
import { COMMON_TOOL_CONTRACT, COMMON_TOOL_NAMES } from "./tool-contract.js";

describe("common agent tool contract", () => {
  it("fixes the nine tools shared by MCP and Pi", () => {
    expect(COMMON_TOOL_NAMES).toEqual([
      "is_auth",
      "is_write",
      "is_status",
      "is_commit",
      "is_change_open",
      "is_change_close",
      "is_navigate",
      "is_pull",
      "is_push",
    ]);
  });

  it("keeps attached_to singular", () => {
    expect(COMMON_TOOL_CONTRACT.is_write.parameters.attached_to).toEqual({
      type: "string",
      required: false,
    });
  });

  it("requires an explicit handle or id to open a Change", () => {
    expect(COMMON_TOOL_CONTRACT.is_change_open.requireAny).toEqual(["handle", "id"]);
  });

  it("leaves navigate arguments to each connector", () => {
    expect(COMMON_TOOL_CONTRACT.is_navigate.parameters).toBe("surface-specific");
  });
});
