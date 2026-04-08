import { describe, it, expect, vi } from "vitest";
import {
  createFetchTransport,
  createMockTransport,
  SdkError,
} from "./transport.js";

// ─── Mock Transport ─────────────────────────────────────────────────

describe("createMockTransport", () => {
  it("returns canned response for exact route", async () => {
    const transport = createMockTransport({
      "GET /repos/r1/tree": { path: "", children: [], file_count: 0 },
    });
    const resp = await transport.request("GET", "/repos/r1/tree");
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data).toEqual({ path: "", children: [], file_count: 0 });
  });

  it("matches route without query string", async () => {
    const transport = createMockTransport({
      "GET /search": { results: [{ name: "acme" }] },
    });
    const resp = await transport.request("GET", "/search?q=acme&limit=10");
    const data = await resp.json();
    expect(data).toEqual({ results: [{ name: "acme" }] });
  });

  it("calls function routes with args", async () => {
    const transport = createMockTransport({
      "PUT /repos/r1/files/test.md": (
        _method: string,
        _path: string,
        body: unknown,
      ) => ({
        path: "test.md",
        node_id: "n_123",
        content: (body as { content: string }).content,
      }),
    });
    const resp = await transport.request("PUT", "/repos/r1/files/test.md", {
      content: "hello",
    });
    const data = (await resp.json()) as { content: string };
    expect(data.content).toBe("hello");
  });

  it("throws SdkError for unmatched route", async () => {
    const transport = createMockTransport({});
    await expect(transport.request("GET", "/nope")).rejects.toThrow(SdkError);
    try {
      await transport.request("GET", "/nope");
    } catch (e) {
      expect(e).toBeInstanceOf(SdkError);
      expect((e as SdkError).category).toBe("not_found");
    }
  });
});

// ─── Fetch Transport — error classification ─────────────────────────

describe("createFetchTransport", () => {
  // Mock global fetch for these tests
  const originalFetch = globalThis.fetch;

  function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      return handler(String(input), init);
    }) as unknown as typeof fetch;
  }

  function jsonResponse(
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ): Response {
    const headersObj = new Headers(headers);
    return new Response(JSON.stringify(body), { status, headers: headersObj });
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const baseConfig = {
    apiUrl: "https://test.api",
    apiKey: "test-key",
    timeout: 5000,
    retry: { maxRetries: 2 },
  };

  it("returns successful response", async () => {
    mockFetch(() => jsonResponse(200, { results: [] }));
    const transport = createFetchTransport(baseConfig);
    const resp = await transport.request("GET", "/search?q=test");
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data).toEqual({ results: [] });
  });

  it("sets auth header", async () => {
    mockFetch((_url, init) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      return jsonResponse(200, { auth });
    });
    const transport = createFetchTransport(baseConfig);
    const resp = await transport.request("GET", "/test");
    const data = (await resp.json()) as { auth: string };
    expect(data.auth).toBe("Bearer test-key");
  });

  it("throws SdkError with category on 400", async () => {
    mockFetch(() => jsonResponse(400, { detail: "bad request" }));
    const transport = createFetchTransport(baseConfig);
    try {
      await transport.request("GET", "/test");
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SdkError);
      const err = e as SdkError;
      expect(err.category).toBe("client_error");
      expect(err.status).toBe(400);
      expect(err.retryable).toBe(false);
    }
  });

  it("throws SdkError with not_found on 404", async () => {
    mockFetch(() => jsonResponse(404, { detail: "not found" }));
    const transport = createFetchTransport(baseConfig);
    try {
      await transport.request("GET", "/test");
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SdkError);
      expect((e as SdkError).category).toBe("not_found");
      expect((e as SdkError).retryable).toBe(false);
    }
  });

  it("throws SdkError with auth_error on 401", async () => {
    mockFetch(() => jsonResponse(401, { detail: "unauthorized" }));
    const transport = createFetchTransport(baseConfig);
    try {
      await transport.request("GET", "/test");
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SdkError);
      expect((e as SdkError).category).toBe("auth_error");
      expect((e as SdkError).retryable).toBe(false);
    }
  });

  it("retries on 429 then succeeds", async () => {
    let calls = 0;
    mockFetch(() => {
      calls++;
      if (calls === 1) {
        return jsonResponse(429, { detail: "rate limited" }, { "retry-after": "0" });
      }
      return jsonResponse(200, { ok: true });
    });
    const transport = createFetchTransport({
      ...baseConfig,
      retry: { maxRetries: 2 },
    });
    const resp = await transport.request("GET", "/test");
    expect(resp.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("retries on 503 then succeeds", async () => {
    let calls = 0;
    mockFetch(() => {
      calls++;
      if (calls <= 2) return jsonResponse(503, { detail: "overloaded" });
      return jsonResponse(200, { ok: true });
    });
    const transport = createFetchTransport({
      ...baseConfig,
      retry: { maxRetries: 3 },
    });
    const resp = await transport.request("GET", "/test");
    expect(resp.status).toBe(200);
    expect(calls).toBe(3);
  });

  it("gives up after max retries on 503", async () => {
    mockFetch(() => jsonResponse(503, { detail: "down" }));
    const transport = createFetchTransport({
      ...baseConfig,
      retry: { maxRetries: 1 },
    });
    try {
      await transport.request("GET", "/test");
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SdkError);
      expect((e as SdkError).category).toBe("overloaded");
      expect((e as SdkError).status).toBe(503);
    }
  });

  it("does not retry on 400", async () => {
    let calls = 0;
    mockFetch(() => {
      calls++;
      return jsonResponse(400, { detail: "bad" });
    });
    const transport = createFetchTransport(baseConfig);
    try {
      await transport.request("GET", "/test");
    } catch {
      // expected
    }
    expect(calls).toBe(1);
  });

  it("parses Retry-After header", async () => {
    let calls = 0;
    mockFetch(() => {
      calls++;
      if (calls === 1) {
        return jsonResponse(429, { detail: "rate limited" }, { "retry-after": "0" });
      }
      return jsonResponse(200, { ok: true });
    });
    const transport = createFetchTransport(baseConfig);
    const resp = await transport.request("GET", "/test");
    expect(resp.status).toBe(200);
  });
});

// Vitest needs this for afterEach
import { afterEach } from "vitest";
