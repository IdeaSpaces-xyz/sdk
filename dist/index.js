// @ideaspaces/sdk
// Core
export { createClient, IsClient, DEFAULT_API_URL } from "./client.js";
export { SdkError, createFetchTransport, createMockTransport, } from "./transport.js";
export * from "./types.js";
// Patterns
export { createSession } from "./patterns/session.js";
export { watchForChanges } from "./patterns/watch.js";
export { autoSelectRepo } from "./patterns/repo.js";
export { syncToSpace, resolveLinks, normalizeFilename, } from "./patterns/sync.js";
//# sourceMappingURL=index.js.map