import { describe, it, expect } from "vitest";
import { stripFrontmatter, composeFrontmatter, extractSummary } from "./frontmatter.js";

describe("stripFrontmatter", () => {
  it("returns body when frontmatter present", () => {
    const input = "---\nname: Foo\n---\n# Heading\nBody.";
    expect(stripFrontmatter(input)).toBe("# Heading\nBody.");
  });

  it("returns input unchanged when no frontmatter", () => {
    const input = "# Heading\nBody.";
    expect(stripFrontmatter(input)).toBe(input);
  });

  it("returns input unchanged when leading --- is not at offset 0", () => {
    const input = "Text first\n---\nname: Foo\n---\nBody.";
    expect(stripFrontmatter(input)).toBe(input);
  });

  it("treats unclosed frontmatter as no frontmatter", () => {
    const input = "---\nname: Foo\nBody without close";
    expect(stripFrontmatter(input)).toBe(input);
  });

  it("handles multiline summaries (folded yaml)", () => {
    const input =
      "---\nname: Foo\nsummary: line one\n  continuation\n  more\n---\nBody.";
    expect(stripFrontmatter(input)).toBe("Body.");
  });

  it("handles CRLF line endings on the opening delimiter", () => {
    const input = "---\r\nname: Foo\n---\nBody.";
    expect(stripFrontmatter(input)).toBe("Body.");
  });

  it("preserves body whitespace exactly", () => {
    const input = "---\nname: Foo\n---\n\n# Heading\n\nParagraph.\n";
    expect(stripFrontmatter(input)).toBe("\n# Heading\n\nParagraph.\n");
  });
});

describe("composeFrontmatter", () => {
  it("emits only the fields provided", () => {
    expect(composeFrontmatter({ name: "Foo" })).toBe("---\nname: Foo\n---\n");
  });

  it("orders fields name, summary, tags, attached_to", () => {
    const out = composeFrontmatter({
      attached_to: ["person:alice"],
      tags: ["a"],
      summary: "S",
      name: "N",
    });
    expect(out).toBe(
      "---\nname: N\nsummary: S\ntags:\n  - a\nattached_to:\n  - person:alice\n---\n",
    );
  });

  it("renders arrays in block style", () => {
    const out = composeFrontmatter({ tags: ["one", "two", "three"] });
    expect(out).toBe("---\ntags:\n  - one\n  - two\n  - three\n---\n");
  });

  it("quotes values that need escaping", () => {
    const out = composeFrontmatter({
      name: "Has: colon",
      summary: 'with "quotes"',
    });
    expect(out).toContain('name: "Has: colon"');
    expect(out).toContain('summary: "with \\"quotes\\""');
  });

  it("leaves simple strings unquoted for readability", () => {
    const out = composeFrontmatter({ name: "Foundation", summary: "Baseline." });
    expect(out).toBe("---\nname: Foundation\nsummary: Baseline.\n---\n");
  });

  it("omits empty arrays", () => {
    const out = composeFrontmatter({ name: "Foo", tags: [] });
    expect(out).toBe("---\nname: Foo\n---\n");
  });

  it("emits empty document when no fields", () => {
    expect(composeFrontmatter({})).toBe("---\n---\n");
  });

  it("quotes yaml-keyword values like true/false/null", () => {
    expect(composeFrontmatter({ name: "true" })).toContain('name: "true"');
    expect(composeFrontmatter({ name: "null" })).toContain('name: "null"');
  });

  it("quotes leading dash to avoid collision with sequence indicator", () => {
    expect(composeFrontmatter({ name: "- hyphen-led" })).toContain(
      'name: "- hyphen-led"',
    );
  });

  it("output is round-trippable through stripFrontmatter", () => {
    const fm = composeFrontmatter({ name: "Foo", summary: "Bar" });
    const doc = `${fm}# Body\n`;
    expect(stripFrontmatter(doc)).toBe("# Body\n");
  });
});

describe("extractSummary", () => {
  it("returns single-line summary", () => {
    const input = "---\nname: Foo\nsummary: Short summary.\n---\n# Body";
    expect(extractSummary(input)).toBe("Short summary.");
  });

  it("concatenates implicit-continuation multi-line summary", () => {
    const input =
      "---\nname: Foundation\nsummary: Baseline contract for an ideaspace —\n  what kind of place this is, how the agent inhabits it,\n  the rhythm of capture and commit.\n---\n# Body";
    const out = extractSummary(input);
    expect(out).toBe(
      "Baseline contract for an ideaspace — what kind of place this is, how the agent inhabits it, the rhythm of capture and commit.",
    );
  });

  it("handles folded-scalar (>) form", () => {
    const input =
      "---\nname: Foo\nsummary: >\n  Folded line one\n  folded line two\n---\n# Body";
    expect(extractSummary(input)).toBe("Folded line one folded line two");
  });

  it("strips surrounding double quotes", () => {
    const input = '---\nname: Foo\nsummary: "Quoted summary."\n---\n# Body';
    expect(extractSummary(input)).toBe("Quoted summary.");
  });

  it("strips surrounding single quotes", () => {
    const input = "---\nname: Foo\nsummary: 'Quoted summary.'\n---\n# Body";
    expect(extractSummary(input)).toBe("Quoted summary.");
  });

  it("returns null when there's no frontmatter", () => {
    expect(extractSummary("# Just body")).toBeNull();
  });

  it("returns null when frontmatter has no summary field", () => {
    const input = "---\nname: Foo\ntags: [a, b]\n---\n# Body";
    expect(extractSummary(input)).toBeNull();
  });

  it("returns null when frontmatter is unclosed", () => {
    expect(extractSummary("---\nsummary: Hanging\n# never closes")).toBeNull();
  });

  it("stops at the next field, not at the end of frontmatter", () => {
    const input =
      "---\nname: Foo\nsummary: First field summary\ntags:\n  - a\n  - b\n---\n# Body";
    expect(extractSummary(input)).toBe("First field summary");
  });

  it("handles CRLF line endings", () => {
    const input = "---\r\nname: Foo\r\nsummary: CRLF summary.\r\n---\r\nBody";
    expect(extractSummary(input)).toBe("CRLF summary.");
  });
});
