/**
 * Watch pattern — detect changes in the space since a known commit.
 *
 * Extracted from pi-sw-space/src/index.ts before_agent_start change detection.
 */
import type { IsClient } from "../client.js";
export interface ChangeResult {
    changed: boolean;
    newSha: string;
    changes: Array<{
        status: string;
        path: string;
    }>;
}
/**
 * Check if the space changed since a known commit SHA.
 * Returns null if HEAD can't be determined (empty repo, network error).
 */
export declare function watchForChanges(client: IsClient, knownSha: string): Promise<ChangeResult | null>;
//# sourceMappingURL=watch.d.ts.map