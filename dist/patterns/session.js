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
export function createSession(client) {
    let cachedAwareness = null;
    let knownHeadSha = null;
    let lastSha = null; // HEAD from previous session / before this one
    async function getCurrentHead() {
        try {
            const { data } = await client.gitOps({ op: "log", limit: 1 });
            return data.entries?.[0]?.sha ?? null;
        }
        catch {
            return null;
        }
    }
    async function buildAwareness() {
        const { data: root } = await client.navigate("");
        const lines = [];
        // Now
        if (root.now) {
            const nowLines = root.now
                .split("\n")
                .filter((l) => l.trim() &&
                !l.startsWith("---") &&
                !l.startsWith("name:") &&
                !l.startsWith("summary:"));
            const firstLine = nowLines.find((l) => !l.startsWith("#") && l.trim().length > 0);
            if (firstLine)
                lines.push(`Now: ${firstLine.trim().slice(0, 200)}`);
        }
        // Top-level tree
        const dirs = root.children.filter((c) => c.type === "directory");
        const files = root.children.filter((c) => c.type === "file");
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
                .map((a) => a.name)
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
                    lines.push(`\nSince last session (${changes.changes.length} changes):`);
                    for (const c of changes.changes.slice(0, 15)) {
                        lines.push(`  ${c.status} ${c.path}`);
                    }
                    if (changes.changes.length > 15) {
                        lines.push(`  ... and ${changes.changes.length - 15} more`);
                    }
                }
            }
            catch {
                // silent — lastSha might be stale
            }
        }
        // Track HEAD
        knownHeadSha = await getCurrentHead();
        return lines.join("\n");
    }
    return {
        async getAwarenessBlock() {
            if (cachedAwareness !== null)
                return cachedAwareness;
            cachedAwareness = await buildAwareness();
            return cachedAwareness;
        },
        async getContextFor(query, opts) {
            const { data } = await client.search({
                query,
                scope: opts?.scope,
                limit: opts?.limit ?? 10,
            });
            if (!data.results.length)
                return `No results for "${query}"`;
            const lines = [];
            for (const r of data.results) {
                const score = r.score.toFixed(2);
                lines.push(`${score}  ${r.path}`);
                if (r.name)
                    lines.push(`      ${r.name}`);
                if (r.summary)
                    lines.push(`      ${r.summary}`);
            }
            return lines.join("\n");
        },
        async getChanges() {
            if (!knownHeadSha)
                return null;
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
                if (!data.changes?.length)
                    return null;
                const lines = data.changes
                    .slice(0, 15)
                    .map((c) => `  ${c.status} ${c.path}`);
                if (data.changes.length > 15) {
                    lines.push(`  ... and ${data.changes.length - 15} more`);
                }
                return {
                    changed: true,
                    summary: `${data.changes.length} change${data.changes.length === 1 ? "" : "s"}:\n${lines.join("\n")}`,
                };
            }
            catch {
                return null;
            }
        },
        async trackHead() {
            knownHeadSha = await getCurrentHead();
        },
        invalidate() {
            cachedAwareness = null;
        },
    };
}
//# sourceMappingURL=session.js.map