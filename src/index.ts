// @ideaspaces/sdk
//
// The SDK is the platform layer for IdeaSpaces. The shape primitives now live in
// @ideaspaces/protocol; they are re-exported here so existing consumers keep
// importing from @ideaspaces/sdk unchanged. Platform code (sync, auth, API
// client) will be added here over time, on top of the protocol.
export * from "@ideaspaces/protocol";

// Platform layer — the Keeper transport contract + the pi→Keeper bridge.
export * from "./keeper-events.js";
export * from "./agent-to-keeper.js";
