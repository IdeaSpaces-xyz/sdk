/**
 * Sync local directory ↔ sw_space.
 *
 * Compares local files against space state via GET /files/status,
 * resolves markdown cross-links to node IDs, uploads what changed.
 *
 * Usage: /sw-sync <localPath> <spacePath>
 * Example: /sw-sync Docs/core starwatcher/docs
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, basename, extname } from "node:path";
// ─── Filename normalization ─────────────────────────────────────────
/** About.md → about.md, Space Jump.md → space-jump.md */
export function normalizeFilename(name) {
    const ext = extname(name);
    const base = basename(name, ext);
    return base.toLowerCase().replace(/\s+/g, "-") + ext.toLowerCase();
}
// ─── Local file hashing ────────────────────────────────────────────
/** Git blob hash: "blob <size>\0<content>" → SHA-1 */
function gitBlobHash(content) {
    const header = `blob ${content.length}\0`;
    const hash = createHash("sha1");
    hash.update(header);
    hash.update(content);
    return hash.digest("hex");
}
// ─── Link resolution ────────────────────────────────────────────────
/**
 * Build a mapping from local filenames and space paths to node IDs.
 * Uses the outline (cached, one API call) to resolve references.
 */
function buildLinkMapping(outline, spacePath) {
    const byLocalName = new Map();
    const bySpacePath = new Map();
    for (const item of outline) {
        if (!item.node_id || !item.path)
            continue;
        bySpacePath.set(item.path, item.node_id);
        // Map normalized filename → node_id (within the target directory)
        if (item.path.startsWith(spacePath + "/") || spacePath === "") {
            const fileName = item.path.split("/").pop();
            if (fileName) {
                // Store both the normalized name and original casing variants
                byLocalName.set(fileName, item.node_id);
            }
        }
    }
    return { byLocalName, bySpacePath };
}
/**
 * Resolve markdown links in content.
 *
 * Rewrites [text](Target.md) → [text](/n/n_abc123) and
 * [text](../library/Some%20File.md) → [text](/n/n_xyz456)
 *
 * Leaves external links (http/https), anchors (#), and node ID links (/n/) untouched.
 */
export function resolveLinks(content, links, localDir, spacePath, siblingSpacePath) {
    // Match markdown links: [text](target)
    return content.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (match, text, target) => {
        // Skip external URLs, anchors, node IDs
        if (target.startsWith("http") || target.startsWith("#") || target.startsWith("/n/")) {
            return match;
        }
        // Separate anchor from path: "Purpose.md#section" → ["Purpose.md", "#section"]
        const [targetPath, anchor] = target.split("#", 2);
        const anchorSuffix = anchor ? `#${anchor}` : "";
        // Decode URL encoding: Space%20Jump.md → Space Jump.md
        const decoded = decodeURIComponent(targetPath);
        // Try direct match by normalized filename in same directory
        const normalized = normalizeFilename(decoded);
        const nodeId = links.byLocalName.get(normalized);
        if (nodeId) {
            return `[${text}](/n/${nodeId}${anchorSuffix})`;
        }
        // Try resolving relative path (../library/Something.md)
        if (decoded.startsWith("../") || decoded.startsWith("./")) {
            const parts = decoded.split("/");
            const fileName = normalizeFilename(parts[parts.length - 1]);
            // First: try structural resolution against space path
            let resolvedDir = spacePath;
            for (let i = 0; i < parts.length - 1; i++) {
                if (parts[i] === "..") {
                    resolvedDir = resolvedDir.split("/").slice(0, -1).join("/");
                }
                else if (parts[i] !== ".") {
                    resolvedDir = resolvedDir ? `${resolvedDir}/${parts[i]}` : parts[i];
                }
            }
            const fullPath = resolvedDir ? `${resolvedDir}/${fileName}` : fileName;
            const resolvedId = links.bySpacePath.get(fullPath);
            if (resolvedId) {
                return `[${text}](/n/${resolvedId}${anchorSuffix})`;
            }
            // Fallback: search entire outline by normalized filename.
            // Handles cases where local dir structure doesn't match space structure
            // (e.g. Docs/architecture/ is a sibling locally but a child in the space).
            for (const [path, nodeId] of links.bySpacePath) {
                if (path.endsWith(`/${fileName}`)) {
                    return `[${text}](/n/${nodeId}${anchorSuffix})`;
                }
            }
        }
        // Last resort: search by normalized filename globally (handles unresolved same-dir links)
        const fileNameOnly = normalizeFilename(decoded.split("/").pop() || decoded);
        for (const [path, nodeId] of links.bySpacePath) {
            if (path.endsWith(`/${fileNameOnly}`)) {
                return `[${text}](/n/${nodeId}${anchorSuffix})`;
            }
        }
        // No match — leave as-is
        return match;
    });
}
// ─── Sync state persistence ─────────────────────────────────────────
const SYNC_STATE_FILE = ".sw-sync.json";
async function loadSyncState(localPath) {
    try {
        const raw = await readFile(join(localPath, SYNC_STATE_FILE), "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function saveSyncState(localPath, state) {
    await writeFile(join(localPath, SYNC_STATE_FILE), JSON.stringify(state, null, 2) + "\n");
}
// ─── Collect local markdown files ───────────────────────────────────
async function collectLocalFiles(dirPath) {
    const files = new Map();
    async function walk(dir) {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith(".") || entry.name.startsWith("_"))
                continue;
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                // Skip archive and other special directories
                if (entry.name === "archive" || entry.name === "node_modules")
                    continue;
                await walk(fullPath);
            }
            else if (entry.name.endsWith(".md") && entry.name !== "CLAUDE.md") {
                const content = await readFile(fullPath);
                const rel = relative(dirPath, fullPath);
                files.set(rel, { localPath: fullPath, content });
            }
        }
    }
    await walk(dirPath);
    return files;
}
// ─── Main sync ──────────────────────────────────────────────────────
export async function syncToSpace(client, localPath, spacePath, options = {}) {
    const log = options.onProgress || (() => { });
    const result = {
        uploaded: [],
        skipped: [],
        conflicts: [],
        errors: [],
        newHead: null,
    };
    // 1. Get space state — try bulk status, fall back to outline
    log("Fetching space status...");
    let spaceFiles;
    try {
        const { data: spaceStatus } = await client.fileStatus(spacePath);
        spaceFiles = new Map(spaceStatus.files.map(f => [f.path, f.sha]));
    }
    catch {
        // Fallback: use outline to get list of known paths (no SHAs, but we know what exists)
        log("Status endpoint unavailable, using outline fallback...");
        const { data: outline } = await client.outline();
        spaceFiles = new Map(outline.items
            .filter(i => i.path.startsWith(spacePath + "/") || spacePath === "")
            .map(i => [i.path, "unknown"]));
    }
    // 2. Collect local files
    log("Scanning local files...");
    const localFiles = await collectLocalFiles(localPath);
    log(`Found ${localFiles.size} local files, ${spaceFiles.size} space files in scope`);
    // 3. Load previous sync state
    const prevState = await loadSyncState(localPath);
    // 5. Compare each local file against space
    //
    // Comparison uses LOCAL hash as source of truth, not space blob SHA.
    // Link resolution transforms content on upload (local paths → node IDs),
    // so space content always differs from local. We track "last synced
    // local hash" to detect real changes.
    //
    for (const [relPath, { localPath: filePath, content }] of localFiles) {
        const normalized = relPath.split("/").map(p => normalizeFilename(p)).join("/");
        const targetPath = spacePath ? `${spacePath}/${normalized}` : normalized;
        const localHash = gitBlobHash(content);
        const existsInSpace = spaceFiles.has(targetPath);
        // Has previous sync state — compare against stored local hash
        if (prevState?.files[relPath]) {
            const prev = prevState.files[relPath];
            const localChanged = localHash !== prev.localHash;
            if (!localChanged) {
                // Local hasn't changed since last sync → skip
                result.skipped.push(relPath);
                continue;
            }
            // Local changed. Check if space also changed (conflict).
            const spaceSha = spaceFiles.get(targetPath);
            const spaceChanged = spaceSha !== prev.spaceSha;
            if (spaceChanged && existsInSpace) {
                result.conflicts.push(relPath);
                continue;
            }
        }
        else if (existsInSpace) {
            // No previous state, file exists in space — first sync.
            // Compare raw blob hash if we have real SHAs.
            const spaceSha = spaceFiles.get(targetPath);
            if (spaceSha && spaceSha !== "unknown" && localHash === spaceSha) {
                result.skipped.push(relPath);
                continue;
            }
            // Otherwise upload — content may differ or we can't tell
        }
        // Upload needed
        if (options.dryRun) {
            result.uploaded.push(relPath);
            continue;
        }
        try {
            const contentStr = content.toString("utf-8");
            // Files upload as-is — no link rewriting.
            // Relative links stay portable (Layer 1). The platform resolves them
            // at render time using the index (Layer 2). See sw_space#156.
            const { body, name, summary } = extractFrontmatter(contentStr);
            // Read existing file for if_match SHA (conditional write to prevent overwrites)
            let ifMatch;
            if (existsInSpace) {
                try {
                    const { data: existing } = await client.readFile(targetPath);
                    ifMatch = existing.last_commit_sha || undefined;
                }
                catch {
                    // File might not exist yet in space
                }
            }
            await client.writeFile(targetPath, {
                content: body,
                name: name || basename(relPath, ".md"),
                summary,
                if_match: ifMatch,
            });
            log(`Uploaded: ${relPath} → ${targetPath}`);
            result.uploaded.push(relPath);
        }
        catch (e) {
            const msg = e?.message || String(e);
            if (msg.includes("409")) {
                result.conflicts.push(relPath);
            }
            else {
                result.errors.push({ path: relPath, error: msg });
            }
        }
    }
    // 6. Get new HEAD and save sync state
    try {
        const { data: head } = await client.gitOps({ op: "log", limit: 1 });
        result.newHead = head.entries?.[0]?.sha || null;
    }
    catch {
        // non-fatal
    }
    if (!options.dryRun && result.newHead) {
        const newState = {
            lastSyncHead: result.newHead,
            spacePath,
            files: {},
        };
        // Record state for all synced files
        let newSpaceFiles;
        try {
            const { data: newSpaceStatus } = await client.fileStatus(spacePath);
            newSpaceFiles = new Map(newSpaceStatus.files.map(f => [f.path, f.sha]));
        }
        catch {
            // Fallback: no space SHAs for state tracking. Next sync will re-compare.
            newSpaceFiles = new Map();
        }
        for (const [relPath, { content }] of localFiles) {
            const normalized = relPath.split("/").map(p => normalizeFilename(p)).join("/");
            const targetPath = spacePath ? `${spacePath}/${normalized}` : normalized;
            newState.files[relPath] = {
                localHash: gitBlobHash(content),
                spaceSha: newSpaceFiles.get(targetPath) || "",
            };
        }
        await saveSyncState(localPath, newState);
    }
    return result;
}
// ─── Frontmatter extraction ─────────────────────────────────────────
function extractFrontmatter(content) {
    // Content uploaded to space should NOT include frontmatter — the API handles
    // name/summary as separate fields. But our local docs are pure markdown
    // without frontmatter (they use # heading as the name).
    // Extract name from first # heading
    const headingMatch = content.match(/^#\s+(.+)$/m);
    const name = headingMatch?.[1]?.trim();
    // Extract summary from the first blockquote or first paragraph after heading
    const lines = content.split("\n");
    let summary;
    let pastHeading = false;
    for (const line of lines) {
        if (line.startsWith("# ")) {
            pastHeading = true;
            continue;
        }
        if (!pastHeading)
            continue;
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        // Blockquote line — common pattern for doc summaries
        if (trimmed.startsWith("> **")) {
            summary = trimmed.replace(/^>\s*\*\*/, "").replace(/\*\*$/, "").trim();
            break;
        }
        if (trimmed.startsWith(">")) {
            summary = trimmed.replace(/^>\s*/, "").trim();
            break;
        }
        // First non-empty paragraph
        summary = trimmed.slice(0, 300);
        break;
    }
    return { body: content, name, summary };
}
//# sourceMappingURL=sync.js.map