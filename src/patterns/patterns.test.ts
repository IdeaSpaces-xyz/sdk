import { describe, it, expect } from "vitest";
import { createClient } from "../client.js";
import { createMockTransport } from "../transport.js";
import { watchForChanges } from "./watch.js";
import { autoSelectRepo } from "./repo.js";

// ─── watchForChanges ────────────────────────────────────────────────

describe("watchForChanges", () => {
  it("returns unchanged when SHA matches", async () => {
    const client = createClient({
      transport: createMockTransport({
        "GET /repos/r1/git": {
          op: "log",
          entries: [{ sha: "abc123", message: "m", date: "d", author: "a" }],
        },
      }),
      repo: "r1",
    });
    const result = await watchForChanges(client, "abc123");
    expect(result).toEqual({ changed: false, newSha: "abc123", changes: [] });
  });

  it("returns changes when SHA differs", async () => {
    let callCount = 0;
    const client = createClient({
      transport: createMockTransport({
        "GET /repos/r1/git": () => {
          callCount++;
          if (callCount === 1) {
            // First call: log
            return {
              op: "log",
              entries: [{ sha: "def456", message: "m", date: "d", author: "a" }],
            };
          }
          // Second call: changes
          return {
            op: "changes",
            changes: [
              { status: "M", path: "docs/plan.md" },
              { status: "A", path: "docs/new.md" },
            ],
          };
        },
      }),
      repo: "r1",
    });
    const result = await watchForChanges(client, "abc123");
    expect(result?.changed).toBe(true);
    expect(result?.newSha).toBe("def456");
    expect(result?.changes).toHaveLength(2);
  });

  it("returns null on error", async () => {
    const client = createClient({
      transport: createMockTransport({}), // no routes = 404
      repo: "r1",
    });
    const result = await watchForChanges(client, "abc");
    expect(result).toBeNull();
  });
});

// ─── autoSelectRepo ─────────────────────────────────────────────────

describe("autoSelectRepo", () => {
  it("auto-selects single repo", async () => {
    const client = createClient({
      transport: createMockTransport({
        "GET /repos": {
          repos: [{ repo_id: "r1", slug: "notes", hostname: null, role: "owner" }],
        },
      }),
    });
    const result = await autoSelectRepo(client);
    expect(result.repoId).toBe("r1");
    expect(result.repos).toHaveLength(1);
    expect(client.repoId).toBe("r1"); // setRepo was called
  });

  it("returns null repoId for multiple repos", async () => {
    const client = createClient({
      transport: createMockTransport({
        "GET /repos": {
          repos: [
            { repo_id: "r1", slug: "notes", hostname: null, role: "owner" },
            { repo_id: "r2", slug: "work", hostname: "acme.com", role: "member" },
          ],
        },
      }),
    });
    const result = await autoSelectRepo(client);
    expect(result.repoId).toBeNull();
    expect(result.repos).toHaveLength(2);
  });

  it("returns null repoId for no repos", async () => {
    const client = createClient({
      transport: createMockTransport({
        "GET /repos": { repos: [] },
      }),
    });
    const result = await autoSelectRepo(client);
    expect(result.repoId).toBeNull();
    expect(result.repos).toHaveLength(0);
  });
});
