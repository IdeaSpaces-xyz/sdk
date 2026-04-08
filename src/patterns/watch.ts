/**
 * Watch pattern — detect changes in the space since a known commit.
 *
 * Extracted from pi-sw-space/src/index.ts before_agent_start change detection.
 */

import type { IsClient } from "../client.js";

export interface ChangeResult {
  changed: boolean;
  newSha: string;
  changes: Array<{ status: string; path: string }>;
}

/**
 * Check if the space changed since a known commit SHA.
 * Returns null if HEAD can't be determined (empty repo, network error).
 */
export async function watchForChanges(
  client: IsClient,
  knownSha: string,
): Promise<ChangeResult | null> {
  try {
    const { data: head } = await client.gitOps({ op: "log", limit: 1 });
    const currentSha = head.entries?.[0]?.sha;
    if (!currentSha) return null;

    if (currentSha === knownSha) {
      return { changed: false, newSha: currentSha, changes: [] };
    }

    const { data } = await client.gitOps({
      op: "changes",
      since: knownSha,
    });

    return {
      changed: true,
      newSha: currentSha,
      changes: data.changes ?? [],
    };
  } catch {
    return null;
  }
}
