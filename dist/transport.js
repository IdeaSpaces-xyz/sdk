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
// ─── SdkError ───────────────────────────────────────────────────────
export class SdkError extends Error {
    category;
    status;
    retryable;
    retryAfterMs;
    constructor(opts) {
        super(opts.message);
        this.name = "SdkError";
        this.category = opts.category;
        this.status = opts.status;
        this.retryable = opts.retryable;
        this.retryAfterMs = opts.retryAfterMs;
    }
}
// ─── Error classification ───────────────────────────────────────────
function classifyStatus(status, headers) {
    if (status === 429) {
        const retryAfter = headers["retry-after"];
        let retryAfterMs;
        if (retryAfter) {
            const seconds = Number(retryAfter);
            retryAfterMs = Number.isFinite(seconds)
                ? seconds * 1000
                : undefined;
        }
        return { category: "rate_limited", retryable: true, retryAfterMs };
    }
    if (status === 502 || status === 503 || status === 529) {
        return { category: "overloaded", retryable: true };
    }
    if (status === 401) {
        return { category: "auth_error", retryable: false };
    }
    if (status === 404) {
        return { category: "not_found", retryable: false };
    }
    // 400, 422, and other 4xx
    if (status >= 400 && status < 500) {
        return { category: "client_error", retryable: false };
    }
    // Other 5xx
    return { category: "overloaded", retryable: true };
}
// ─── Backoff ────────────────────────────────────────────────────────
/** min(500ms × 2^attempt, 16s) + jitter */
function backoffMs(attempt) {
    const base = Math.min(500 * Math.pow(2, attempt), 16_000);
    const jitter = Math.random() * base * 0.25;
    return base + jitter;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// ─── Fetch Transport ────────────────────────────────────────────────
const DEFAULT_RETRYABLE_STATUSES = [429, 502, 503, 529];
export function createFetchTransport(config) {
    const maxRetries = config.retry?.maxRetries ?? 3;
    const retryableStatuses = config.retry?.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES;
    const timeout = config.timeout ?? 30_000;
    return {
        async request(method, path, body) {
            const url = `${config.apiUrl}/api/v1${path}`;
            const headers = {
                Authorization: `Bearer ${config.apiKey}`,
                "Content-Type": "application/json",
            };
            let lastError;
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), timeout);
                    let resp;
                    try {
                        resp = await fetch(url, {
                            method,
                            headers,
                            body: body ? JSON.stringify(body) : undefined,
                            signal: controller.signal,
                        });
                    }
                    finally {
                        clearTimeout(timer);
                    }
                    // Success — return wrapped response
                    if (resp.ok) {
                        const responseHeaders = {};
                        resp.headers.forEach((v, k) => {
                            responseHeaders[k.toLowerCase()] = v;
                        });
                        // Clone body once for both json() and text()
                        const bodyText = await resp.text();
                        return {
                            status: resp.status,
                            headers: responseHeaders,
                            json: async () => JSON.parse(bodyText),
                            text: async () => bodyText,
                        };
                    }
                    // Error — classify and decide whether to retry
                    const responseHeaders = {};
                    resp.headers.forEach((v, k) => {
                        responseHeaders[k.toLowerCase()] = v;
                    });
                    const errorText = await resp.text().catch(() => "");
                    let detail = errorText;
                    try {
                        const json = JSON.parse(errorText);
                        detail = json.detail || json.error || errorText;
                    }
                    catch {
                        // not JSON
                    }
                    const { category, retryable, retryAfterMs } = classifyStatus(resp.status, responseHeaders);
                    // Should we retry?
                    const canRetry = retryable &&
                        retryableStatuses.includes(resp.status) &&
                        attempt < maxRetries;
                    if (!canRetry) {
                        throw new SdkError({
                            message: `${method} ${path}: ${resp.status} — ${detail}`,
                            category,
                            status: resp.status,
                            retryable,
                            retryAfterMs,
                        });
                    }
                    // Retry after delay
                    const delayMs = retryAfterMs ?? backoffMs(attempt);
                    await sleep(delayMs);
                    lastError = new SdkError({
                        message: `${method} ${path}: ${resp.status} — ${detail}`,
                        category,
                        status: resp.status,
                        retryable,
                        retryAfterMs,
                    });
                }
                catch (err) {
                    // Network errors and aborts
                    if (err instanceof SdkError)
                        throw err;
                    const isTimeout = err instanceof DOMException && err.name === "AbortError";
                    const category = isTimeout
                        ? "timeout"
                        : "network_error";
                    if (attempt < maxRetries) {
                        await sleep(backoffMs(attempt));
                        lastError = err instanceof Error ? err : new Error(String(err));
                        continue;
                    }
                    throw new SdkError({
                        message: `${method} ${path}: ${category} — ${err instanceof Error ? err.message : String(err)}`,
                        category,
                        retryable: true,
                    });
                }
            }
            // Should not reach here, but safety net
            throw lastError || new Error("Unexpected transport error");
        },
    };
}
export function createMockTransport(routes) {
    return {
        async request(method, path, body) {
            // Try exact match first, then method + path without query
            const key = `${method} ${path}`;
            const keyNoQuery = `${method} ${path.split("?")[0]}`;
            const route = routes[key] ?? routes[keyNoQuery];
            if (route === undefined) {
                throw new SdkError({
                    message: `Mock: no route for ${key}`,
                    category: "not_found",
                    status: 404,
                    retryable: false,
                });
            }
            const data = typeof route === "function" ? route(method, path, body) : route;
            return {
                status: 200,
                headers: {},
                json: async () => data,
                text: async () => JSON.stringify(data),
            };
        },
    };
}
//# sourceMappingURL=transport.js.map