import { describe, expect, it } from "vitest";
import { mkdtemp, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectMarkdownFiles,
  ensureMarkdownNodeId,
  generateNodeId,
  inspectMarkdownIdentity,
  isMarkdownPath,
  isNodeId,
} from "./identity.js";

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

  it("injects fresh frontmatter when none exists", () => {
    const result = ensureMarkdownNodeId("# Body");
    expect(result.changed).toBe(true);
    expect(result.node_id).toMatch(/^n_[0-9a-f]{24}$/);
    expect(result.content).toMatch(/^---\nnode_id: n_[0-9a-f]{24}\n---\n# Body$/);
  });

  it("throws on multiple node_id fields", () => {
    expect(() => ensureMarkdownNodeId("---\nnode_id: n_abcdef123456\nnode_id: n_abcdef123456abcdef123456\n---\n# Body")).toThrow("multiple node_id fields");
  });

  it("regenerates invalid node_id when explicit", () => {
    const result = ensureMarkdownNodeId("---\nnode_id: nope\n---\n# Body", { regenerate: true });
    expect(result.changed).toBe(true);
    expect(result.old_node_id).toBe("nope");
    expect(result.node_id).toMatch(/^n_[0-9a-f]{24}$/);
    expect(result.content).toMatch(/^---\nnode_id: n_[0-9a-f]{24}\n---\n# Body$/);
  });

  it("regenerates valid node_id when explicit", () => {
    const oldId = "n_abcdef123456";
    const result = ensureMarkdownNodeId(`---\nnode_id: ${oldId}\n---\n# Body`, { regenerate: true });
    expect(result.changed).toBe(true);
    expect(result.old_node_id).toBe(oldId);
    expect(result.node_id).toMatch(/^n_[0-9a-f]{24}$/);
    expect(result.node_id).not.toBe(oldId);
  });

  it("recognizes markdown paths case-insensitively", () => {
    expect(isMarkdownPath("foo.md")).toBe(true);
    expect(isMarkdownPath("foo.MD")).toBe(true);
    expect(isMarkdownPath("foo.ts")).toBe(false);
  });

  it("collects markdown files and skips ignored dirs and symlinks", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "is-sdk-identity-"));
    try {
      await mkdir(join(tmp, "notes"));
      await mkdir(join(tmp, ".git"));
      await mkdir(join(tmp, "node_modules"));
      await writeFile(join(tmp, "b.md"), "b");
      await writeFile(join(tmp, "notes", "a.md"), "a");
      await writeFile(join(tmp, "notes", "skip.txt"), "skip");
      await writeFile(join(tmp, ".git", "hidden.md"), "hidden");
      await writeFile(join(tmp, "node_modules", "dep.md"), "dep");
      await symlink(join(tmp, "notes"), join(tmp, "linked-notes"));

      expect(await collectMarkdownFiles(join(tmp, "missing"))).toEqual([]);
      expect(await collectMarkdownFiles(join(tmp, "b.md"))).toEqual([join(tmp, "b.md")]);
      expect(await collectMarkdownFiles(tmp)).toEqual([join(tmp, "b.md"), join(tmp, "notes", "a.md")]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
