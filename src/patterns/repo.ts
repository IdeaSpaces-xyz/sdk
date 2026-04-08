/**
 * Repo discovery pattern — auto-select when user has exactly one repo.
 *
 * Extracted from pi-sw-space/src/index.ts connectWithConfig().
 */

import type { IsClient } from "../client.js";
import type { RepoInfo } from "../types.js";

export interface RepoDiscoveryResult {
  /** The auto-selected repo ID, or null if multiple repos need user choice. */
  repoId: string | null;
  /** All available repos. */
  repos: RepoInfo[];
}

/**
 * Discover available repos and auto-select if exactly one exists.
 *
 * If one repo → returns it as repoId (also calls client.setRepo).
 * If multiple → returns null repoId + the list for consumer to present a choice.
 * If none → returns null repoId + empty list.
 */
export async function autoSelectRepo(
  client: IsClient,
): Promise<RepoDiscoveryResult> {
  const { data } = await client.listRepos();
  const repos = data.repos;

  if (repos.length === 1) {
    client.setRepo(repos[0].repo_id);
    return { repoId: repos[0].repo_id, repos };
  }

  return { repoId: null, repos };
}
