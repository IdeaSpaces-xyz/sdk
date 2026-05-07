import { randomBytes } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { join, resolve } from "node:path";

export const NODE_ID_RE = /^n_[0-9a-f]{12}(?:[0-9a-f]{12})?$/;

const FRONTMATTER_DELIM = "---";
const SKIP_DIRS = new Set([".git", "node_modules"]);

export interface MarkdownIdentity {
  status: "valid" | "missing" | "malformed";
  node_id: string | null;
  message?: string;
}

interface FrontmatterBlock {
  lines: string[];
  endIndex: number;
}

export function generateNodeId(): string {
  return `n_${randomBytes(12).toString("hex")}`;
}

export function isNodeId(value: string): boolean {
  return NODE_ID_RE.test(value);
}

export function inspectMarkdownIdentity(content: string): MarkdownIdentity {
  const block = parseFrontmatter(content);
  if (!block) return { status: "missing", node_id: null };

  const matches = findNodeIdLines(block.lines);
  if (matches.length === 0) return { status: "missing", node_id: null };
  if (matches.length > 1) {
    return { status: "malformed", node_id: null, message: "multiple node_id fields" };
  }

  const value = parseScalarValue(matches[0]!.line.slice(matches[0]!.line.indexOf(":") + 1));
  if (!value || !isNodeId(value)) {
    return { status: "malformed", node_id: value || null, message: "invalid node_id" };
  }

  return { status: "valid", node_id: value };
}

/**
 * Ensure a markdown document has a valid `node_id` in frontmatter.
 *
 * Missing IDs are inserted. Valid legacy/new IDs are preserved. Malformed IDs
 * throw unless `regenerate` is true; callers that want non-throwing problem
 * reporting should call `inspectMarkdownIdentity()` first.
 */
export function ensureMarkdownNodeId(content: string, opts: { regenerate?: boolean } = {}): {
  content: string;
  node_id: string;
  old_node_id: string | null;
  changed: boolean;
} {
  const block = parseFrontmatter(content);

  if (!block) {
    const nextId = generateNodeId();
    return {
      content: `${FRONTMATTER_DELIM}\nnode_id: ${nextId}\n${FRONTMATTER_DELIM}\n${content}`,
      node_id: nextId,
      old_node_id: null,
      changed: true,
    };
  }

  const matches = findNodeIdLines(block.lines);
  if (matches.length > 1) {
    throw new Error("multiple node_id fields");
  }

  if (matches.length === 1) {
    const match = matches[0]!;
    const oldValue = parseScalarValue(match.line.slice(match.line.indexOf(":") + 1));
    if (!oldValue || !isNodeId(oldValue)) {
      if (!opts.regenerate) {
        throw new Error(`invalid node_id: ${oldValue || "(empty)"}`);
      }
    } else if (!opts.regenerate) {
      return { content, node_id: oldValue, old_node_id: oldValue, changed: false };
    }

    const nextId = generateNodeId();
    const lines = content.split(/\r?\n/);
    lines[match.index] = `node_id: ${nextId}`;
    return {
      content: lines.join("\n"),
      node_id: nextId,
      old_node_id: oldValue || null,
      changed: true,
    };
  }

  const nextId = generateNodeId();
  const lines = content.split(/\r?\n/);
  const insertAt = insertionIndexForNodeId(block.lines);
  lines.splice(insertAt, 0, `node_id: ${nextId}`);
  return {
    content: lines.join("\n"),
    node_id: nextId,
    old_node_id: null,
    changed: true,
  };
}

export async function collectMarkdownFiles(target: string): Promise<string[]> {
  const abs = resolve(target);
  if (!existsSync(abs)) return [];

  const stat = await fs.lstat(abs);
  if (stat.isSymbolicLink()) return [];
  if (stat.isFile()) return isMarkdownPath(abs) ? [abs] : [];
  if (!stat.isDirectory()) return [];

  const out: string[] = [];
  await walk(abs, out);
  return out.sort();
}

export function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), out);
      continue;
    }
    if (entry.isFile() && isMarkdownPath(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
}

function parseFrontmatter(content: string): FrontmatterBlock | null {
  if (!content.startsWith(`${FRONTMATTER_DELIM}\n`) && !content.startsWith(`${FRONTMATTER_DELIM}\r\n`)) {
    return null;
  }
  const lines = content.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trimEnd() === FRONTMATTER_DELIM) {
      return { lines: lines.slice(0, i + 1), endIndex: i };
    }
  }
  return null;
}

function findNodeIdLines(lines: string[]): Array<{ index: number; line: string }> {
  const matches: Array<{ index: number; line: string }> = [];
  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i]!;
    if (/^node_id\s*:/.test(line)) {
      matches.push({ index: i, line });
    }
  }
  return matches;
}

function insertionIndexForNodeId(lines: string[]): number {
  for (let i = 1; i < lines.length - 1; i++) {
    if (/^name\s*:/.test(lines[i]!)) return i + 1;
  }
  return 1;
}

function parseScalarValue(raw: string): string {
  let value = raw.trim();
  const hashIndex = value.indexOf(" #");
  if (hashIndex >= 0) value = value.slice(0, hashIndex).trim();
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value;
}
