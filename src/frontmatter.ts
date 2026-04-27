/**
 * Layer 1+2 frontmatter helpers.
 *
 * Layer 1: `name`, `summary` (the writing standard's required fields).
 * Layer 2: `tags`, `attached_to` (entity binding, retrieval).
 *
 * `stripFrontmatter` returns the body — useful for code that needs the prose
 * without parsing semantically. `composeFrontmatter` writes a stable, minimal
 * yaml block; consumers using replace-semantics (`is_write`, `ideaspaces write`)
 * own all fields they want set.
 *
 * No yaml parser dep — semantic parsing (e.g., merge-semantics on existing
 * tags) is deferred until a use case earns it.
 */

export interface Frontmatter {
  name?: string;
  summary?: string;
  tags?: string[];
  attached_to?: string[];
}

const DELIM = "---";

/**
 * Returns the body of a markdown file with the leading frontmatter block
 * removed. If the input has no frontmatter, returns it unchanged.
 *
 * The frontmatter is recognized as a `---` line at offset 0 followed by a
 * later `---` line. Trailing newline after the closing delimiter is consumed.
 */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith(`${DELIM}\n`) && !content.startsWith(`${DELIM}\r\n`)) {
    return content;
  }
  const lines = content.split("\n");
  // lines[0] is the opening "---"
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === DELIM) {
      // Body starts after the closing delimiter line.
      return lines.slice(i + 1).join("\n");
    }
  }
  // No closing delimiter — treat as no frontmatter.
  return content;
}

/**
 * Compose a stable yaml frontmatter block.
 *
 * Output is sorted by field order (name, summary, tags, attached_to) and
 * uses block-style for arrays. Strings are escaped only if they contain
 * yaml-special characters (colons, quotes, leading dashes); otherwise the
 * raw form is emitted for readability.
 *
 * Empty/undefined fields are omitted. Trailing newline included so callers
 * can concatenate with body directly.
 */
export function composeFrontmatter(fm: Frontmatter): string {
  const lines: string[] = [DELIM];
  if (fm.name !== undefined) lines.push(`name: ${escapeScalar(fm.name)}`);
  if (fm.summary !== undefined) lines.push(`summary: ${escapeScalar(fm.summary)}`);
  if (fm.tags?.length) lines.push(...renderArray("tags", fm.tags));
  if (fm.attached_to?.length) lines.push(...renderArray("attached_to", fm.attached_to));
  lines.push(DELIM, "");
  return lines.join("\n");
}

function escapeScalar(value: string): string {
  if (needsQuoting(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function needsQuoting(value: string): boolean {
  if (value === "") return true;
  // Leading/trailing whitespace, special characters, or yaml indicators.
  if (/^[\s>|*&!%@`]/.test(value)) return true;
  if (/^[-?]\s/.test(value)) return true;
  if (/[:#]\s/.test(value)) return true;
  if (/[\n\r"\\]/.test(value)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) return true;
  if (/^-?\d/.test(value)) return true;
  return false;
}

function renderArray(key: string, items: string[]): string[] {
  return [`${key}:`, ...items.map((v) => `  - ${escapeScalar(v)}`)];
}
