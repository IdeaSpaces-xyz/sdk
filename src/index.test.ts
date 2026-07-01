import { describe, it, expect } from "vitest";
import * as sdk from "./index.js";

// The SDK is a thin re-export of @ideaspaces/protocol. This guards the FULL
// previously-exported surface so that if the protocol drops or renames anything,
// SDK CI fails loudly instead of silently breaking consumers.

const EXPECTED_FUNCTIONS = [
  // space / _agent contract
  "findNearestAgent",
  "findSpaceRoot",
  "readContract",
  "composeContractAlongPath",
  // awareness
  "assembleAwareness",
  // git state
  "gitState",
  "recentActivity",
  "lastCommitTime",
  // path context
  "walkPathContext",
  "spaceRootLevel",
  "currentBranchLevel",
  // stale-docs / drift
  "collectDocDependencies",
  "staleDocSignals",
  // skills catalog
  "listSkills",
  "readSkill",
  // frontmatter
  "stripFrontmatter",
  "composeFrontmatter",
  "extractSummary",
  "extractDescription",
  "inspectFrontmatterSyntax",
  // change-layer commit trailers
  "isValidChangeId",
  "slugify",
  "formatChangeId",
  "mintChangeId",
  "changeIdGrep",
  "parseTrailers",
  "buildTrailers",
  "appendTrailers",
] as const;

describe("@ideaspaces/sdk re-export of @ideaspaces/protocol", () => {
  it.each(EXPECTED_FUNCTIONS)("re-exports %s as a function", (name) => {
    expect(typeof (sdk as Record<string, unknown>)[name]).toBe("function");
  });

  it("re-exports CONTRACT_FILES as the five-file contract", () => {
    expect(Array.isArray(sdk.CONTRACT_FILES)).toBe(true);
    expect(sdk.CONTRACT_FILES).toEqual(
      expect.arrayContaining(["foundation", "guide", "purpose", "now", "next"]),
    );
  });

  it("re-exports CHANGE_ID_PATTERN as a RegExp", () => {
    expect(sdk.CHANGE_ID_PATTERN).toBeInstanceOf(RegExp);
    expect(sdk.CHANGE_ID_PATTERN.test("chg_token-bucket-a3f9")).toBe(true);
  });
});
