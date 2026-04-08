/**
 * Session pattern — lifecycle wrapper for agent integrations.
 *
 * Every agent needs the same lifecycle:
 * 1. Session start → orient (tree, Now, agent guidance)
 * 2. Before turn  → search space for relevant context
 * 3. After turn   → optional persistence
 * 4. Between turns → detect external changes
 *
 * Extracted from pi-sw-space/src/index.ts buildSpaceContext() + before_agent_start.
 */

import type { IsClient } from "../client.js";
import type { NavigateResult, SearchResult } from "../types.js";

export interface IsSession {
  /**
   * Build the awareness block for system prompt injection.
   * Returns: Now + tree overview + agent context + recent changes.
   * Caches internally — call multiple times without extra API calls.
   * Call invalidate() to force refresh.
   */
  getAwarenessBlock(): Promise<string>;

  /**
   * Search the space for context relevant to a query.
   * Returns formatted text ready for injection before a turn.
   */
  getContextFor(
    query: string,
    opts?: { scope?: string; limit?: number },
  ): Promise<string>;

  /**
   * Check if the space changed since last check.
   * Returns change summary or null if unchanged / no prior HEAD known.
   */
  getChanges(): Promise<{ changed: boolean; summary: string } | null>;

  /** Update the known HEAD SHA (call after mutations). */
  trackHead(): Promise<void>;

  /** Force rebuild of cached awareness on next getAwarenessBlock() call. */
  invalidate(): void;
}

export function createSession(client: IsClient): IsSession {
  let cachedAwareness: string | null = null;
  let knownHeadSha: string | null = null;
  let lastSha: string | null = null; // HEAD from previous session / before this one

  async function getCurrentHead(): Promise<string | null> {
    try {
      const { data } = await client.gitOps({ op: "log", limit: 1 });
      return data.entries?.[0]?.sha ?? null;
    } catch {
      return null;
    }
  }

  async function buildAwareness(): Promise<string> {
    const { data: root } = await client.navigate("");
    const lines: string[] = [];

    // Now
    if (root.now) {
      const nowLines = root.now
        .split("\n")
        .filter(
          (l: string) =>
            l.trim() &&
            !l.startsWith("---") &&
            !l.startsWith("name:") &&
            !l.startsWith("summary:"),
        );
      const firstLine = nowLines.find(
        (l: string) => !l.startsWith("#") && l.trim().length > 0,
      );
      if (firstLine) lines.push(`Now: ${firstLine.trim().slice(0, 200)}`);
    }

    // Top-level tree
    const dirs = root.children.filter(
      (c: NavigateResult["children"][0]) => c.type === "directory",
    );
    const files = root.children.filter(
      (c: NavigateResult["children"][0]) => c.type === "file",
    );
    if (dirs.length || files.length) {
      lines.push(`\nTree (${root.file_count} files):`);
      for (const d of dirs) {
        const count = d.file_count ? ` (${d.file_count})` : "";
        const summary = d.summary ? ` — ${d.summary}` : "";
        lines.push(`  ${d.name}/${count}${summary}`);
      }
      for (const f of files) {
        const summary = f.summary ? ` — ${f.summary}` : "";
        lines.push(`  ${f.name}${summary}`);
      }
    }

    // Agent context
    if (root.agent_context.length) {
      const contextNames = root.agent_context
        .map((a: NavigateResult["agent_context"][0]) => a.name)
        .join(", ");
      lines.push(`\nAgent context: ${contextNames}`);
    }

    // Recent changes
    if (lastSha) {
      try {
        const { data: changes } = await client.gitOps({
          op: "changes",
          since: lastSha,
        });
        if (changes.changes?.length) {
          lines.push(
            `\nSince last session (${changes.changes.length} changes):`,
          );
          for (const c of changes.changes.slice(0, 15)) {
            lines.push(`  ${c.status} ${c.path}`);
          }
          if (changes.changes.length > 15) {
            lines.push(
              `  ... and ${changes.changes.length - 15} more`,
            );
          }
        }
      } catch {
        // silent — lastSha might be stale
      }
    }

    // Track HEAD
    knownHeadSha = await getCurrentHead();

    return lines.join("\n");
  }

  return {
    async getAwarenessBlock(): Promise<string> {
      if (cachedAwareness !== null) return cachedAwareness;
      cachedAwareness = await buildAwareness();
      return cachedAwareness;
    },

    async getContextFor(
      query: string,
      opts?: { scope?: string; limit?: number },
    ): Promise<string> {
      const { data } = await client.search({
        query,
        scope: opts?.scope,
        limit: opts?.limit ?? 10,
      });
      if (!data.results.length) return `No results for "${query}"`;

      const lines: string[] = [];
      for (const r of data.results) {
        const score = r.score.toFixed(2);
        lines.push(`${score}  ${r.path}`);
        if (r.name) lines.push(`      ${r.name}`);
        if (r.summary) lines.push(`      ${r.summary}`);
      }
      return lines.join("\n");
    },

    async getChanges(): Promise<{
      changed: boolean;
      summary: string;
    } | null> {
      if (!knownHeadSha) return null;

      const currentHead = await getCurrentHead();
      if (!currentHead || currentHead === knownHeadSha) {
        return null;
      }

      try {
        const { data } = await client.gitOps({
          op: "changes",
          since: knownHeadSha,
        });
        knownHeadSha = currentHead;

        if (!data.changes?.length) return null;

        const lines = data.changes
          .slice(0, 15)
          .map((c: { status: string; path: string }) => `  ${c.status} ${c.path}`);
        if (data.changes.length > 15) {
          lines.push(`  ... and ${data.changes.length - 15} more`);
        }
        return {
          changed: true,
          summary: `${data.changes.length} change${data.changes.length === 1 ? "" : "s"}:\n${lines.join("\n")}`,
        };
      } catch {
        return null;
      }
    },

    async trackHead(): Promise<void> {
      knownHeadSha = await getCurrentHead();
    },

    invalidate(): void {
      cachedAwareness = null;
    },
  };
}
