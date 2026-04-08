/**
 * Sync local directory ↔ sw_space.
 *
 * Compares local files against space state via GET /files/status,
 * resolves markdown cross-links to node IDs, uploads what changed.
 *
 * Usage: /sw-sync <localPath> <spacePath>
 * Example: /sw-sync Docs/core starwatcher/docs
 */
import type { IsClient } from "../client.js";
export interface SyncResult {
    uploaded: string[];
    skipped: string[];
    conflicts: string[];
    errors: Array<{
        path: string;
        error: string;
    }>;
    newHead: string | null;
}
interface LinkMapping {
    byLocalName: Map<string, string>;
    bySpacePath: Map<string, string>;
}
/** About.md → about.md, Space Jump.md → space-jump.md */
export declare function normalizeFilename(name: string): string;
/**
 * Resolve markdown links in content.
 *
 * Rewrites [text](Target.md) → [text](/n/n_abc123) and
 * [text](../library/Some%20File.md) → [text](/n/n_xyz456)
 *
 * Leaves external links (http/https), anchors (#), and node ID links (/n/) untouched.
 */
export declare function resolveLinks(content: string, links: LinkMapping, localDir: string, spacePath: string, siblingSpacePath: string): string;
export declare function syncToSpace(client: IsClient, localPath: string, spacePath: string, options?: {
    dryRun?: boolean;
    onProgress?: (msg: string) => void;
}): Promise<SyncResult>;
export {};
//# sourceMappingURL=sync.d.ts.map