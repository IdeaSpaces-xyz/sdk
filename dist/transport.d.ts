/**
 * Transport layer — resilient HTTP with retry, backoff, and error classification.
 *
 * Two implementations:
 * - createFetchTransport() — production, uses global fetch
 * - createMockTransport()  — tests, returns canned responses
 *
 * Error classification from claude-code-lessons.md:
 * 429 → rate_limited (retry with Retry-After)
 * 502/503/529 → overloaded (retry with backoff)
 * 401 → auth_error (don't retry)
 * 400/422 → client_error (don't retry)
 * 404 → not_found (don't retry)
 * Network error → network_error (retry with backoff)
 */
import type { IsTransport, SdkErrorCategory } from "./types.js";
export declare class SdkError extends Error {
    readonly category: SdkErrorCategory;
    readonly status?: number;
    readonly retryable: boolean;
    readonly retryAfterMs?: number;
    constructor(opts: {
        message: string;
        category: SdkErrorCategory;
        status?: number;
        retryable: boolean;
        retryAfterMs?: number;
    });
}
export interface FetchTransportConfig {
    apiUrl: string;
    apiKey: string;
    timeout?: number;
    retry?: {
        maxRetries?: number;
        retryableStatuses?: number[];
    };
}
export declare function createFetchTransport(config: FetchTransportConfig): IsTransport;
/**
 * Mock transport for testing. Routes are keyed by "METHOD /path".
 *
 * Usage:
 *   createMockTransport({
 *     'GET /repos/r1/tree': { path: '', children: [], ... },
 *     'GET /search?q=acme': { results: [] },
 *   })
 *
 * If a route value is a function, it receives (method, path, body) and
 * should return the response data.
 */
export type MockRoutes = Record<string, unknown | ((method: string, path: string, body?: unknown) => unknown)>;
export declare function createMockTransport(routes: MockRoutes): IsTransport;
//# sourceMappingURL=transport.d.ts.map