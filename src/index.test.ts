import { describe, it, expect } from "vitest";
import * as sdk from "./index.js";

// The SDK re-exports the protocol shape primitives. This guards that the
// re-export resolves and the key surface is present for consumers.
describe("@ideaspaces/sdk re-export of @ideaspaces/protocol", () => {
  it("exposes the core shape primitives", () => {
    expect(typeof sdk.findSpaceRoot).toBe("function");
    expect(typeof sdk.readContract).toBe("function");
    expect(typeof sdk.assembleAwareness).toBe("function");
    expect(typeof sdk.stripFrontmatter).toBe("function");
    expect(typeof sdk.composeFrontmatter).toBe("function");
    expect(typeof sdk.gitState).toBe("function");
  });
});
