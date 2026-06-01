import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Per-repo, per-machine plugin session state.
 *
 * Lives at `~/.ideaspaces/sessions/<repo_id_hash>.json` — in HOME, **never in
 * the repo**. It is the plugin's record of which paths *it* staged, so
 * `is_commit`/`is_sync` only ever touch plugin-originated work and leave the
 * user's own staged changes alone. Because it sits outside the repo it is never
 * committed or synced; `repo_id_hash` is only a lookup key derived from the
 * repo's absolute path, not stored in the repo. Moving or re-cloning the repo
 * resets the state — acceptable for ephemeral session tracking.
 *
 * Reads never write. The session record (`session_id`, `started_at`) is
 * initialized on the first mutating call.
 */

export interface SessionState {
  session_id: string;
  /** ISO 8601 timestamp of first write this session. */
  started_at: string;
  /** Paths the plugin staged, deduplicated. */
  staged_paths: string[];
  /** HEAD persisted at session start, for `recentActivity` since-diffing. */
  lastSha?: string;
}

export interface SessionStore {
  readState(): Promise<SessionState>;
  recordStagedPath(path: string): Promise<SessionState>;
  clearStagedPath(path: string): Promise<SessionState>;
  getStagedPaths(): Promise<string[]>;
  setLastSha(sha: string): Promise<SessionState>;
}

/** Short, stable key for a repo: first 16 hex of sha256(absolute root path). */
function repoIdHash(repoRoot: string): string {
  return createHash("sha256").update(resolve(repoRoot)).digest("hex").slice(0, 16);
}

function sessionFilePath(repoRoot: string): string {
  return join(homedir(), ".ideaspaces", "sessions", `${repoIdHash(repoRoot)}.json`);
}

function freshState(): SessionState {
  return {
    session_id: randomUUID(),
    started_at: new Date().toISOString(),
    staged_paths: [],
  };
}

export function sessionState(repoRoot: string): SessionStore {
  const file = sessionFilePath(repoRoot);

  async function load(): Promise<SessionState | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf-8")) as SessionState;
      // Defensive: an externally-mangled file shouldn't crash the session.
      if (!Array.isArray(parsed.staged_paths)) parsed.staged_paths = [];
      return parsed;
    } catch {
      return null;
    }
  }

  async function persist(state: SessionState): Promise<SessionState> {
    await fs.mkdir(dirname(file), { recursive: true });
    // Write-then-rename so a crash mid-write can't leave a truncated file.
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
    await fs.rename(tmp, file);
    return state;
  }

  /** Existing state, or a freshly-initialized record (not yet persisted). */
  async function ensure(): Promise<SessionState> {
    return (await load()) ?? freshState();
  }

  return {
    async readState() {
      return (await load()) ?? freshState();
    },

    async recordStagedPath(path) {
      const state = await ensure();
      if (!state.staged_paths.includes(path)) state.staged_paths.push(path);
      return persist(state);
    },

    async clearStagedPath(path) {
      const state = await ensure();
      state.staged_paths = state.staged_paths.filter((p) => p !== path);
      return persist(state);
    },

    async getStagedPaths() {
      return (await load())?.staged_paths ?? [];
    },

    async setLastSha(sha) {
      const state = await ensure();
      state.lastSha = sha;
      return persist(state);
    },
  };
}
