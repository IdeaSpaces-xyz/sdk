import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionState } from "./session-state.js";

let home: string;
let repo: string;
let prevHome: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "is-sdk-home-"));
  repo = await mkdtemp(join(tmpdir(), "is-sdk-repo-"));
  // os.homedir() honors $HOME on POSIX — isolate state under a temp home.
  prevHome = process.env.HOME;
  process.env.HOME = home;
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  await rm(home, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

describe("sessionState", () => {
  it("records, deduplicates, and clears staged paths", async () => {
    const store = sessionState(repo);
    await store.recordStagedPath("notes/a.md");
    await store.recordStagedPath("notes/a.md"); // dup ignored
    await store.recordStagedPath("_agent/now.md");
    expect((await store.getStagedPaths()).sort()).toEqual([
      "_agent/now.md",
      "notes/a.md",
    ]);

    await store.clearStagedPath("notes/a.md");
    expect(await store.getStagedPaths()).toEqual(["_agent/now.md"]);
  });

  it("persists lastSha and keeps session_id stable across reads", async () => {
    const store = sessionState(repo);
    const written = await store.setLastSha("abc123");
    expect(written.lastSha).toBe("abc123");

    const first = await store.readState();
    const second = await store.readState();
    expect(first.lastSha).toBe("abc123");
    expect(first.session_id).toBe(second.session_id);
    expect(first.session_id).toBe(written.session_id);
  });

  it("writes under HOME/.ideaspaces, never inside the repo", async () => {
    const store = sessionState(repo);
    await store.recordStagedPath("notes/a.md");

    const sessionsDir = join(home, ".ideaspaces", "sessions");
    const files = await fs.readdir(sessionsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{16}\.json$/);

    // The repo dir stays untouched.
    await expect(fs.readdir(join(repo, ".ideaspaces"))).rejects.toThrow();
  });

  it("keys distinct repos to distinct state files", async () => {
    const otherRepo = await mkdtemp(join(tmpdir(), "is-sdk-repo2-"));
    try {
      await sessionState(repo).recordStagedPath("a.md");
      await sessionState(otherRepo).recordStagedPath("b.md");
      const files = await fs.readdir(join(home, ".ideaspaces", "sessions"));
      expect(files).toHaveLength(2);
      expect(await sessionState(repo).getStagedPaths()).toEqual(["a.md"]);
      expect(await sessionState(otherRepo).getStagedPaths()).toEqual(["b.md"]);
    } finally {
      await rm(otherRepo, { recursive: true, force: true });
    }
  });

  it("returns a fresh default state when nothing is persisted yet", async () => {
    const state = await sessionState(repo).readState();
    expect(state.staged_paths).toEqual([]);
    expect(state.lastSha).toBeUndefined();
    expect(typeof state.session_id).toBe("string");
  });
});
