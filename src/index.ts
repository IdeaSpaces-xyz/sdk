// @ideaspaces/sdk

// Core
export { createClient, IsClient, DEFAULT_API_URL } from "./client.js";
export {
  SdkError,
  createFetchTransport,
  createMockTransport,
} from "./transport.js";
export type { FetchTransportConfig, MockRoutes } from "./transport.js";
export * from "./types.js";

// Patterns
export { createSession } from "./patterns/session.js";
export type { IsSession } from "./patterns/session.js";
export { watchForChanges } from "./patterns/watch.js";
export type { ChangeResult } from "./patterns/watch.js";
export { autoSelectRepo } from "./patterns/repo.js";
export type { RepoDiscoveryResult } from "./patterns/repo.js";
export {
  syncToSpace,
  resolveLinks,
  normalizeFilename,
} from "./patterns/sync.js";
export type { SyncResult } from "./patterns/sync.js";
