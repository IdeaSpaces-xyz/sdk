import { describe, it, expect } from "vitest";
import { createClient } from "./client.js";
import { createMockTransport } from "./transport.js";

describe("createClient", () => {
  const mockNav = {
    path: "",
    readme: "# My Space",
    now: "Working on SDK",
    children: [
      { name: "docs", type: "directory", file_count: 5 },
      { name: "readme.md", type: "file" },
    ],
    ancestor_context: [],
    agent_context: [],
    conversations: [],
    centroid: null,
    file_count: 10,
  };

  const mockSearch = {
    results: [
      {
        node_id: "n_123",
        path: "docs/acme.md",
        name: "Acme Analysis",
        summary: "Deep dive into Acme",
        score: 0.95,
        tags: ["acme"],
        attached_to: ["hostname:acme.com"],
        node_type: "note",
      },
    ],
  };

  function makeClient(routes: Record<string, unknown>) {
    return createClient({
      transport: createMockTransport(routes),
      repo: "repo_test",
    });
  }

  it("navigate returns SdkResponse with data and meta", async () => {
    const client = makeClient({ "GET /repos/repo_test/tree": mockNav });
    const resp = await client.navigate();
    expect(resp.data.readme).toBe("# My Space");
    expect(resp.data.now).toBe("Working on SDK");
    expect(resp.data.children).toHaveLength(2);
    expect(resp.meta.requestMs).toBeGreaterThanOrEqual(0);
    expect(resp.meta.retries).toBe(0);
  });

  it("search passes query params", async () => {
    const client = makeClient({ "GET /search": mockSearch });
    const resp = await client.search({ query: "acme", scope: "docs/" });
    expect(resp.data.results).toHaveLength(1);
    expect(resp.data.results[0].name).toBe("Acme Analysis");
  });

  it("search sends both legacy and new filter params", async () => {
    let seenPath = "";
    const client = makeClient({
      "GET /search": (_method: string, path: string) => {
        seenPath = path;
        return mockSearch;
      },
    });

    await client.search({ query: "acme", tag: "fintech", top_k: 7 });

    expect(seenPath).toContain("tag=fintech");
    expect(seenPath).toContain("tags=fintech");
    expect(seenPath).toContain("top_k=7");
    expect(seenPath).toContain("limit=7");
  });

  it("readFile with windowed read", async () => {
    const mockFile = {
      path: "docs/test.md",
      node_id: "n_456",
      content: "line 10\nline 11",
      total_lines: 50,
      continuation: { next_offset: 12, remaining: 39 },
      frontmatter: { name: "Test" },
      node_type: "note",
      tags: [],
      attached_to: [],
    };
    const client = makeClient({ "GET /repos/repo_test/files/docs%2Ftest.md": mockFile });
    const resp = await client.readFile("docs/test.md", { offset: 10, limit: 2 });
    expect(resp.data.content).toBe("line 10\nline 11");
    expect(resp.data.continuation?.remaining).toBe(39);
  });

  it("writeFile defaults if_match from current file sha", async () => {
    let seenBody: Record<string, unknown> | undefined;
    const client = makeClient({
      "GET /repos/repo_test/files/test.md": {
        path: "test.md",
        node_id: "n_123",
        content: "# Old",
        total_lines: 1,
        frontmatter: { name: "Test" },
        node_type: "note",
        tags: [],
        attached_to: [],
        last_commit_sha: "abc123",
      },
      "PUT /repos/repo_test/files/test.md": (_method: string, _path: string, body: unknown) => {
        seenBody = body as Record<string, unknown>;
        return {
          path: "test.md",
          node_id: "n_789",
          commit_sha: "def456",
        };
      },
    });
    const resp = await client.writeFile("test.md", {
      content: "# Hello",
      name: "Hello",
    });
    expect(resp.data.node_id).toBe("n_789");
    expect(resp.data.commit_sha).toBe("def456");
    expect(seenBody?.if_match).toBe("abc123");
  });

  it("writeFile skips auto-CAS when file is missing", async () => {
    let seenBody: Record<string, unknown> | undefined;
    const client = makeClient({
      "PUT /repos/repo_test/files/new.md": (_method: string, _path: string, body: unknown) => {
        seenBody = body as Record<string, unknown>;
        return {
          path: "new.md",
          node_id: "n_new",
          commit_sha: "ghi789",
        };
      },
    });

    const resp = await client.writeFile("new.md", {
      content: "# New",
      name: "New",
    });

    expect(resp.data.node_id).toBe("n_new");
    expect(seenBody?.if_match).toBeUndefined();
  });

  it("writeFile supports force option to bypass auto-CAS", async () => {
    let readCalls = 0;
    let seenBody: Record<string, unknown> | undefined;
    const client = makeClient({
      "GET /repos/repo_test/files/test.md": () => {
        readCalls += 1;
        return {
          path: "test.md",
          node_id: "n_123",
          content: "# Old",
          total_lines: 1,
          frontmatter: { name: "Test" },
          node_type: "note",
          tags: [],
          attached_to: [],
          last_commit_sha: "abc123",
        };
      },
      "PUT /repos/repo_test/files/test.md": (_method: string, _path: string, body: unknown) => {
        seenBody = body as Record<string, unknown>;
        return {
          path: "test.md",
          node_id: "n_789",
          commit_sha: "def456",
        };
      },
    });

    await client.writeFile(
      "test.md",
      {
        content: "# Hello",
        name: "Hello",
      },
      { force: true },
    );

    expect(readCalls).toBe(0);
    expect(seenBody?.if_match).toBeUndefined();
  });

  it("listRepos works without repo set", async () => {
    const client = createClient({
      transport: createMockTransport({
        "GET /repos": { repos: [{ repo_id: "r1", slug: "notes", hostname: null, role: "owner" }] },
      }),
    });
    const resp = await client.listRepos();
    expect(resp.data.repos).toHaveLength(1);
  });

  it("createRepo returns repo metadata", async () => {
    const client = createClient({
      transport: createMockTransport({
        "POST /repos": { repo_id: "r2", slug: "vc", name: "VC Space" },
      }),
    });

    const resp = await client.createRepo({ name: "VC Space", slug: "vc" });
    expect(resp.data.repo_id).toBe("r2");
    expect(resp.data.slug).toBe("vc");
  });

  it("connectRepo returns repo metadata", async () => {
    const client = createClient({
      transport: createMockTransport({
        "POST /repos/connect": { repo_id: "r3", slug: "ideaspace", name: "IdeaSpace" },
      }),
    });

    const resp = await client.connectRepo({
      origin_url: "https://github.com/IdeaSpaces-xyz/ideaspace.git",
      name: "IdeaSpace",
      slug: "ideaspace",
    });

    expect(resp.data.repo_id).toBe("r3");
    expect(resp.data.slug).toBe("ideaspace");
  });

  it("reindexRepo posts to repo-scoped endpoint", async () => {
    const client = makeClient({
      "POST /repos/repo_test/reindex": {
        repo_id: "repo_test",
        removed_entries: 12,
        indexed_files: 34,
        status: "ok",
      },
    });

    const resp = await client.reindexRepo();
    expect(resp.data.repo_id).toBe("repo_test");
    expect(resp.data.removed_entries).toBe(12);
    expect(resp.data.indexed_files).toBe(34);
    expect(resp.data.status).toBe("ok");
  });

  it("throws when repoId accessed without repo", () => {
    const client = createClient({
      transport: createMockTransport({}),
    });
    expect(() => client.repoId).toThrow("No repo selected");
  });

  it("setRepo updates the active repo", async () => {
    const client = createClient({
      transport: createMockTransport({
        "GET /repos/new_repo/tree": mockNav,
      }),
    });
    client.setRepo("new_repo");
    const resp = await client.navigate();
    expect(resp.data.readme).toBe("# My Space");
  });

  it("navigate normalizes dir child type to directory", async () => {
    const client = createClient({
      transport: createMockTransport({
        "GET /repos/new_repo/tree": {
          ...mockNav,
          children: [{ name: "dealflow", type: "dir", file_count: 2 }],
        },
      }),
    });
    client.setRepo("new_repo");

    const resp = await client.navigate();
    expect(resp.data.children[0].type).toBe("directory");
  });

  it("gitOps passes params", async () => {
    const client = makeClient({
      "GET /repos/repo_test/git": {
        op: "log",
        entries: [{ sha: "abc", message: "test", date: "2026-01-01", author: "me" }],
      },
    });
    const resp = await client.gitOps({ op: "log", limit: 5 });
    expect(resp.data.entries).toHaveLength(1);
  });

  it("grep and grepSections", async () => {
    const client = makeClient({
      "GET /repos/repo_test/grep": {
        pattern: "TODO",
        matches: [{ file: "a.md", line_number: 1, content: "TODO: fix" }],
      },
      "GET /repos/repo_test/grep/sections": {
        heading: "Status",
        section_count: 1,
        sections: [{ file: "a.md", heading: "Status", level: 2, line: 5, content: "Done", truncated: false }],
      },
    });

    const grepResp = await client.grep("TODO");
    expect(grepResp.data.matches).toHaveLength(1);

    const sectionsResp = await client.grepSections("Status");
    expect(sectionsResp.data.section_count).toBe(1);
  });

  it("fileStatus returns head and files", async () => {
    const client = makeClient({
      "GET /repos/repo_test/files/status": {
        head: "abc123",
        files: [{ path: "test.md", sha: "def456" }],
      },
    });
    const resp = await client.fileStatus();
    expect(resp.data.head).toBe("abc123");
    expect(resp.data.files).toHaveLength(1);
  });

  it("deleteNode, moveFile, updateMetadata, listTags, listNodes", async () => {
    const client = makeClient({
      "DELETE /repos/repo_test/nodes/n_1": { deleted: "n_1", path: "old.md" },
      "POST /repos/repo_test/files/move": { moved: "a.md", destination: "b.md" },
      "PATCH /repos/repo_test/nodes/n_2/metadata": { updated: "n_2", fields: ["tags"] },
      "GET /repos/repo_test/tags": { tags: [{ tag: "sdk", total: 3, notes: 2, perspectives: 1 }] },
      "GET /repos/repo_test/nodes": { nodes: [], total: 0, limit: 50, offset: 0 },
    });

    expect((await client.deleteNode("n_1")).data.deleted).toBe("n_1");
    expect((await client.moveFile("a.md", "b.md")).data.moved).toBe("a.md");
    expect((await client.updateMetadata("n_2", { tags: ["sdk"] })).data.fields).toEqual(["tags"]);
    expect((await client.listTags()).data.tags).toHaveLength(1);
    expect((await client.listNodes()).data.total).toBe(0);
  });
});
