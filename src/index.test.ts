import { describe, expect, it } from "vitest";
import * as sdk from "./index.js";

const PUBLIC_RUNTIME_EXPORTS = [
  "ClaudeTranslator",
  "KEEPER_STREAM_EVENT_TYPES",
  "KeeperTranslator",
  "defaultToolResultPreview",
  "emptyWorkspaceSurface",
  "parseClaudeStreamLine",
  "zeroUsage",
] as const;

describe("@ideaspaces/sdk public surface", () => {
  it("exports exactly the Keeper transport runtime", () => {
    expect(Object.keys(sdk).sort()).toEqual([...PUBLIC_RUNTIME_EXPORTS].sort());
  });

  it.each(PUBLIC_RUNTIME_EXPORTS)("exports %s", (name) => {
    expect(sdk).toHaveProperty(name);
  });
});
