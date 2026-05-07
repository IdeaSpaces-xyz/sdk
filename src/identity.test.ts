import { describe, expect, it } from "vitest";
import { generateNodeId, inspectMarkdownIdentity, ensureMarkdownNodeId, isNodeId } from "./identity.js";

describe("node identity helpers", () => {
  it("generates 96-bit node IDs", () => {
    expect(generateNodeId()).toMatch(/^n_[0-9a-f]{24}$/);
  });

  it("accepts legacy and new node IDs", () => {
    expect(isNodeId("n_abcdef123456")).toBe(true);
    expect(isNodeId("n_abcdef123456abcdef123456")).toBe(true);
    expect(isNodeId("n_abcdef")).toBe(false);
    expect(isNodeId("x_abcdef123456")).toBe(false);
  });

  it("inspects valid, missing, and malformed frontmatter", () => {
    expect(inspectMarkdownIdentity("---\nnode_id: n_abcdef123456\n---\n# Body")).toEqual({
      status: "valid",
      node_id: "n_abcdef123456",
    });
    expect(inspectMarkdownIdentity("---\nname: X\n---\n# Body")).toEqual({
      status: "missing",
      node_id: null,
    });
    expect(inspectMarkdownIdentity("---\nnode_id: nope\n---\n# Body")).toEqual({
      status: "malformed",
      node_id: "nope",
      message: "invalid node_id",
    });
  });

  it("injects missing node_id after name", () => {
    const result = ensureMarkdownNodeId("---\nname: X\nsummary: S\n---\n# Body");
    expect(result.changed).toBe(true);
    expect(result.node_id).toMatch(/^n_[0-9a-f]{24}$/);
    expect(result.content).toMatch(/^---\nname: X\nnode_id: n_[0-9a-f]{24}\nsummary: S\n---\n# Body$/);
  });

  it("preserves existing valid node_id", () => {
    const content = "---\nnode_id: n_abcdef123456\n---\n# Body";
    const result = ensureMarkdownNodeId(content);
    expect(result).toEqual({
      content,
      node_id: "n_abcdef123456",
      old_node_id: "n_abcdef123456",
      changed: false,
    });
  });

  it("regenerates invalid node_id when explicit", () => {
    const result = ensureMarkdownNodeId("---\nnode_id: nope\n---\n# Body", { regenerate: true });
    expect(result.changed).toBe(true);
    expect(result.old_node_id).toBe("nope");
    expect(result.node_id).toMatch(/^n_[0-9a-f]{24}$/);
    expect(result.content).toMatch(/^---\nnode_id: n_[0-9a-f]{24}\n---\n# Body$/);
  });
});
