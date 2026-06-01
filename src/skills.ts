import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { extractDescription } from "./frontmatter.js";

/**
 * The SDK skill catalog — the distribution-canonical reference content.
 *
 * The 8 universal skills ship as markdown under the package's `skills/`
 * directory (see `package.json` `files`). The plugin build copies them into
 * its `reference/`; the MCP server serves them as resources. Both consume
 * through `listSkills` / `readSkill` rather than reaching into the files.
 *
 * A skill's identity is its file stem (`awareness.md` → `awareness`), which is
 * what `readSkill` takes. The blurb comes from `description` frontmatter,
 * falling back to `summary`.
 */

export interface SkillInfo {
  /** Skill id — the file stem. */
  name: string;
  /** Trigger-hint blurb from `description` frontmatter (or `summary`). */
  description: string | null;
}

export interface Skill extends SkillInfo {
  /** Full markdown, including frontmatter. */
  content: string;
}

// Resolves to the package's `skills/` dir from both `dist/` (built) and
// `src/` (tests) — both sit one level under the package root.
const SKILLS_DIR = fileURLToPath(new URL("../skills/", import.meta.url));

/** List the catalog: every skill's id + blurb, sorted by id. */
export async function listSkills(): Promise<SkillInfo[]> {
  let files: string[];
  try {
    files = await fs.readdir(SKILLS_DIR);
  } catch {
    return [];
  }
  const skills = await Promise.all(
    files
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map(async (f) => {
        const content = await fs.readFile(join(SKILLS_DIR, f), "utf-8");
        return { name: f.replace(/\.md$/, ""), description: extractDescription(content) };
      }),
  );
  return skills;
}

/** Read one skill by id. Throws if the skill doesn't exist. */
export async function readSkill(name: string): Promise<Skill> {
  // Guard against path traversal — a skill id is a bare stem.
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error(`Invalid skill name: ${name}`);
  }
  let content: string;
  try {
    content = await fs.readFile(join(SKILLS_DIR, `${name}.md`), "utf-8");
  } catch {
    throw new Error(`Unknown skill: ${name}`);
  }
  return { name, description: extractDescription(content), content };
}
