import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleAwareness } from "./awareness.js";
import { findSpaceRoot } from "./space.js";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "is-sdk-awareness-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function makeAgent(at: string, files: Record<string, string>): Promise<void> {
  const agentDir = join(at, "_agent");
  await fs.mkdir(agentDir, { recursive: true });
  await Promise.all(
    Object.entries(files).map(([name, content]) =>
      fs.writeFile(join(agentDir, name), content, "utf-8"),
    ),
  );
}

describe("assembleAwareness", () => {
  it("surfaces Now's first content line, skipping frontmatter and headings", async () => {
    await makeAgent(tmp, {
      "now.md": [
        "---",
        "name: Now",
        "summary: irrelevant",
        "---",
        "",
        "# Now",
        "",
        "Shipping the local-first pivot this week.",
      ].join("\n"),
    });
    const space = await findSpaceRoot(tmp);
    const block = await assembleAwareness({ root: space.root!, contract: space.contract });
    expect(block).toContain("Now: Shipping the local-first pivot this week.");
  });

  it("treats blockquote line as Now content", async () => {
    await makeAgent(tmp, {
      "now.md": "> Plugin local-first pivot.\n\n## Thread",
    });
    const space = await findSpaceRoot(tmp);
    const block = await assembleAwareness({ root: space.root!, contract: space.contract });
    expect(block).toContain("Now: Plugin local-first pivot.");
  });

  it("truncates a very long Now line with ellipsis", async () => {
    const long = "x".repeat(500);
    await makeAgent(tmp, { "now.md": long });
    const space = await findSpaceRoot(tmp);
    const block = await assembleAwareness({
      root: space.root!,
      contract: space.contract,
      nowExcerptLength: 50,
    });
    const nowMatch = block.match(/^Now: (.*)$/m);
    expect(nowMatch).not.toBeNull();
    expect(nowMatch![1].endsWith("…")).toBe(true);
    expect(nowMatch![1].length).toBeLessThanOrEqual(51);
  });

  it("lists agent context names in canonical order", async () => {
    await makeAgent(tmp, {
      "next.md": "x",
      "foundation.md": "f",
      "purpose.md": "p",
    });
    const space = await findSpaceRoot(tmp);
    const block = await assembleAwareness({ root: space.root!, contract: space.contract });
    expect(block).toContain("Agent context: foundation, purpose, next");
  });

  it("renders a tree section with directories and top-level markdown files", async () => {
    await makeAgent(tmp, { "purpose.md": "p" });
    await fs.mkdir(join(tmp, "core"), { recursive: true });
    await fs.writeFile(join(tmp, "core", "About.md"), "# About", "utf-8");
    await fs.writeFile(join(tmp, "core", "Notes.md"), "# Notes", "utf-8");
    await fs.mkdir(join(tmp, "architecture"), { recursive: true });
    await fs.writeFile(join(tmp, "architecture", "plan.md"), "# Plan", "utf-8");
    await fs.writeFile(join(tmp, "README.md"), "# Readme", "utf-8");

    const space = await findSpaceRoot(tmp);
    const block = await assembleAwareness({ root: space.root!, contract: space.contract });
    expect(block).toMatch(/Tree \(\d+ files\):/);
    expect(block).toContain("architecture/ (1)");
    expect(block).toContain("core/ (2)");
    expect(block).toContain("README.md");
  });

  it("skips _agent, node_modules, .git, dist from the tree", async () => {
    await makeAgent(tmp, { "purpose.md": "p" });
    for (const name of ["node_modules", ".git", "dist", "build"]) {
      await fs.mkdir(join(tmp, name), { recursive: true });
      await fs.writeFile(join(tmp, name, "x.md"), "x", "utf-8");
    }
    const space = await findSpaceRoot(tmp);
    const block = await assembleAwareness({ root: space.root!, contract: space.contract });
    expect(block).not.toContain("_agent/");
    expect(block).not.toContain("node_modules");
    expect(block).not.toContain("dist/");
    expect(block).not.toContain("build/");
  });

  it("omits sections that have nothing to show", async () => {
    await makeAgent(tmp, {});
    const space = await findSpaceRoot(tmp);
    const block = await assembleAwareness({ root: space.root!, contract: space.contract });
    // empty _agent dir, no content files, just the agent dir itself which is skipped
    expect(block).not.toContain("Now:");
    expect(block).not.toContain("Tree (");
    expect(block).not.toContain("Agent context:");
  });

  it("appends 'Since last session' when lastSha supplied and git diff returns changes", async () => {
    if (!hasGit()) return;
    await makeAgent(tmp, { "purpose.md": "p" });
    await fs.writeFile(join(tmp, "README.md"), "v1", "utf-8");
    runGit(tmp, ["init", "-q", "-b", "main"]);
    runGit(tmp, ["config", "user.email", "test@example.com"]);
    runGit(tmp, ["config", "user.name", "Test"]);
    runGit(tmp, ["add", "."]);
    runGit(tmp, ["commit", "-q", "-m", "first"]);
    const baseSha = runGit(tmp, ["rev-parse", "HEAD"]).trim();
    await fs.writeFile(join(tmp, "README.md"), "v2", "utf-8");
    await fs.writeFile(join(tmp, "added.md"), "new", "utf-8");
    runGit(tmp, ["add", "."]);
    runGit(tmp, ["commit", "-q", "-m", "second"]);

    const space = await findSpaceRoot(tmp);
    const block = await assembleAwareness({
      root: space.root!,
      contract: space.contract,
      lastSha: baseSha,
    });
    expect(block).toContain("Since last session (2 changes):");
    expect(block).toMatch(/M\s+README\.md/);
    expect(block).toMatch(/A\s+added\.md/);
  });

  it("silently skips the changes section when git fails (e.g., bad sha)", async () => {
    await makeAgent(tmp, { "purpose.md": "p" });
    const space = await findSpaceRoot(tmp);
    const block = await assembleAwareness({
      root: space.root!,
      contract: space.contract,
      lastSha: "deadbeef",
    });
    expect(block).not.toContain("Since last session");
  });
});

function hasGit(): boolean {
  return spawnSync("git", ["--version"]).status === 0;
}

function runGit(cwd: string, args: string[]): string {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf-8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return r.stdout;
}
