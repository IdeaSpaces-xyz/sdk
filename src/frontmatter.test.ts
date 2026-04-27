import { describe, it, expect } from "vitest";
import { stripFrontmatter, composeFrontmatter } from "./frontmatter.js";

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
