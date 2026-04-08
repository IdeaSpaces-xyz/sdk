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
    getContextFor(query: string, opts?: {
        scope?: string;
        limit?: number;
    }): Promise<string>;
    /**
     * Check if the space changed since last check.
     * Returns change summary or null if unchanged / no prior HEAD known.
     */
    getChanges(): Promise<{
        changed: boolean;
        summary: string;
    } | null>;
    /** Update the known HEAD SHA (call after mutations). */
    trackHead(): Promise<void>;
    /** Force rebuild of cached awareness on next getAwarenessBlock() call. */
    invalidate(): void;
}
export declare function createSession(client: IsClient): IsSession;
//# sourceMappingURL=session.d.ts.map