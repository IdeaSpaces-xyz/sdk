// @ideaspaces/sdk

// Stable type contract; useful for both local and future remote primitives.
export * from "./types.js";

// Local primitives — filesystem-backed building blocks for the agent's
// session-start orientation, Note authoring, and `_agent/` contract handling.
export { findSpaceRoot } from "./space.js";
export type {
  SpaceRoot,
  SpaceContract,
  ContractEntry,
  ContractFile,
} from "./space.js";

export { assembleAwareness } from "./awareness.js";
export type { AssembleAwarenessOpts } from "./awareness.js";

export {
  stripFrontmatter,
  composeFrontmatter,
  extractSummary,
  inspectFrontmatterSyntax,
} from "./frontmatter.js";
export type { Frontmatter, FrontmatterSyntax } from "./frontmatter.js";

