/**
 * IdeaSpaces client — typed operations against the sw_space API.
 *
 * Extracted from pi-sw-space/src/client.ts. All methods return SdkResponse<T>
 * wrapping data + metadata (request timing, retry count, rate limit info).
 *
 * Uses the transport layer for resilient HTTP (retry, backoff, error classification).
 */

import { createFetchTransport } from "./transport.js";
import type {
  IsClientConfig,
  IsTransport,
  SdkResponse,
  RepoInfo,
  OutlineResult,
  NavigateResult,
  SearchParams,
  SearchResult,
  FileResult,
  WriteFileBody,
  WriteResult,
  GrepResult,
  GrepSectionsResult,
  TagsResult,
  HistoryResult,
  NodeVersionResult,
  DeleteResult,
  MoveResult,
  MetadataFields,
  MetadataUpdateResult,
  ListNodesParams,
  ListNodesResult,
  FileStatusResult,
  GitOpsParams,
  GitOpsResult,
} from "./types.js";

export const DEFAULT_API_URL = "https://api.starwatcher.ai";

export class IsClient {
  private transport: IsTransport;
  private repo: string;

  constructor(transport: IsTransport, repo: string) {
    this.transport = transport;
    this.repo = repo;
  }

  /** Current repo ID. Throws if not set. */
  get repoId(): string {
    if (!this.repo) {
      throw new Error(
        "No repo selected. Pass repo in config, or call autoSelectRepo().",
      );
    }
    return this.repo;
  }

  /** Whether a repo is selected. */
  get isConnected(): boolean {
    return !!this.repo;
  }

  /** Update the active repo (e.g. after autoSelectRepo). */
  setRepo(repoId: string): void {
    this.repo = repoId;
  }

  // ─── Internal request wrapper ──────────────────────────────────

  private async req<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<SdkResponse<T>> {
    const start = Date.now();
    const resp = await this.transport.request(method, path, body);
    const data = (await resp.json()) as T;
    const requestMs = Date.now() - start;

    // Parse rate limit headers if present
    let rateLimit: SdkResponse<T>["meta"]["rateLimit"];
    const remaining = resp.headers["x-ratelimit-remaining"];
    const resetAt = resp.headers["x-ratelimit-reset"];
    if (remaining !== undefined) {
      rateLimit = {
        remaining: Number(remaining),
        resetAt: resetAt ? new Date(Number(resetAt) * 1000) : new Date(),
      };
    }

    // Count retries from transport (not directly available — tracked via requestMs)
    // The transport handles retries internally; meta.retries is 0 here.
    // A future enhancement could pass retry count through TransportResponse.
    return { data, meta: { requestMs, retries: 0, rateLimit } };
  }

  // ─── Repos ────────────────────────────────────────────────────

  async listRepos(): Promise<SdkResponse<{ repos: RepoInfo[] }>> {
    return this.req("GET", "/repos");
  }

  // ─── Outline ──────────────────────────────────────────────────

  async outline(): Promise<SdkResponse<OutlineResult>> {
    return this.req("GET", `/repos/${this.repoId}/nodes/outline`);
  }

  // ─── Tree ─────────────────────────────────────────────────────

  async navigate(path: string = ""): Promise<SdkResponse<NavigateResult>> {
    const encodedPath = path ? `/${encodeURIComponent(path)}` : "";
    return this.req("GET", `/repos/${this.repoId}/tree${encodedPath}`);
  }

  // ─── Search ───────────────────────────────────────────────────

  async search(
    params: SearchParams,
  ): Promise<SdkResponse<{ results: SearchResult[] }>> {
    const qs = new URLSearchParams();
    qs.set("q", params.query);
    qs.set("repo_id", this.repoId);
    if (params.scope) qs.set("scope", params.scope);
    if (params.node_type) qs.set("node_type", params.node_type);
    if (params.attached_to) qs.set("attached_to", params.attached_to);
    if (params.contributed_by) qs.set("contributed_by", params.contributed_by);
    if (params.tags) qs.set("tags", params.tags);
    if (params.limit) qs.set("limit", String(params.limit));
    return this.req("GET", `/search?${qs.toString()}`);
  }

  // ─── Files ────────────────────────────────────────────────────

  async readFile(
    path: string,
    opts?: { offset?: number; limit?: number },
  ): Promise<SdkResponse<FileResult>> {
    const qs = new URLSearchParams();
    if (opts?.offset) qs.set("offset", String(opts.offset));
    if (opts?.limit) qs.set("limit", String(opts.limit));
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return this.req(
      "GET",
      `/repos/${this.repoId}/files/${encodeURIComponent(path)}${query}`,
    );
  }

  async readNode(nodeId: string): Promise<SdkResponse<FileResult>> {
    return this.req("GET", `/repos/${this.repoId}/nodes/${nodeId}`);
  }

  async writeFile(
    path: string,
    body: WriteFileBody,
  ): Promise<SdkResponse<WriteResult>> {
    return this.req(
      "PUT",
      `/repos/${this.repoId}/files/${encodeURIComponent(path)}`,
      body,
    );
  }

  // ─── Grep ─────────────────────────────────────────────────────

  async grep(
    pattern: string,
    scope?: string,
  ): Promise<SdkResponse<GrepResult>> {
    const qs = new URLSearchParams({ pattern });
    if (scope) qs.set("scope", scope);
    return this.req(
      "GET",
      `/repos/${this.repoId}/grep?${qs.toString()}`,
    );
  }

  async grepSections(
    heading: string,
    scope?: string,
    maxLines?: number,
  ): Promise<SdkResponse<GrepSectionsResult>> {
    const qs = new URLSearchParams({ heading });
    if (scope) qs.set("scope", scope);
    if (maxLines) qs.set("max_lines", String(maxLines));
    return this.req(
      "GET",
      `/repos/${this.repoId}/grep/sections?${qs.toString()}`,
    );
  }

  // ─── Tags ─────────────────────────────────────────────────────

  async listTags(prefix?: string): Promise<SdkResponse<TagsResult>> {
    const qs = new URLSearchParams();
    if (prefix) qs.set("q", prefix);
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return this.req("GET", `/repos/${this.repoId}/tags${query}`);
  }

  // ─── Node history ─────────────────────────────────────────────

  async nodeHistory(nodeId: string): Promise<SdkResponse<HistoryResult>> {
    return this.req(
      "GET",
      `/repos/${this.repoId}/nodes/${nodeId}/history`,
    );
  }

  async nodeAtVersion(
    nodeId: string,
    sha: string,
  ): Promise<SdkResponse<NodeVersionResult>> {
    return this.req(
      "GET",
      `/repos/${this.repoId}/nodes/${nodeId}/history/${sha}`,
    );
  }

  // ─── Delete node ──────────────────────────────────────────────

  async deleteNode(nodeId: string): Promise<SdkResponse<DeleteResult>> {
    return this.req("DELETE", `/repos/${this.repoId}/nodes/${nodeId}`);
  }

  // ─── Move / delete file ───────────────────────────────────────

  async moveFile(
    source: string,
    destination?: string,
  ): Promise<SdkResponse<MoveResult>> {
    return this.req("POST", `/repos/${this.repoId}/files/move`, {
      source,
      destination: destination ?? null,
    });
  }

  // ─── Update metadata ──────────────────────────────────────────

  async updateMetadata(
    nodeId: string,
    fields: MetadataFields,
  ): Promise<SdkResponse<MetadataUpdateResult>> {
    return this.req(
      "PATCH",
      `/repos/${this.repoId}/nodes/${nodeId}/metadata`,
      fields,
    );
  }

  // ─── List nodes ───────────────────────────────────────────────

  async listNodes(
    params?: ListNodesParams,
  ): Promise<SdkResponse<ListNodesResult>> {
    const qs = new URLSearchParams();
    if (params?.node_type) qs.set("node_type", params.node_type);
    if (params?.tag) qs.set("tag", params.tag);
    if (params?.dir_path) qs.set("dir_path", params.dir_path);
    if (params?.attached_to) qs.set("attached_to", params.attached_to);
    if (params?.contributed_by) qs.set("contributed_by", params.contributed_by);
    if (params?.origin) qs.set("origin", params.origin);
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    if (params?.sort_by) qs.set("sort_by", params.sort_by);
    if (params?.sort_order) qs.set("sort_order", params.sort_order);
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return this.req("GET", `/repos/${this.repoId}/nodes${query}`);
  }

  // ─── File status (bulk sync) ──────────────────────────────────

  async fileStatus(
    scope?: string,
  ): Promise<SdkResponse<FileStatusResult>> {
    const qs = new URLSearchParams();
    if (scope) qs.set("scope", scope);
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return this.req(
      "GET",
      `/repos/${this.repoId}/files/status${query}`,
    );
  }

  // ─── Git operations ───────────────────────────────────────────

  async gitOps(params: GitOpsParams): Promise<SdkResponse<GitOpsResult>> {
    const qs = new URLSearchParams({ op: params.op });
    if (params.path) qs.set("path", params.path);
    if (params.ref) qs.set("ref", params.ref);
    if (params.text) qs.set("text", params.text);
    if (params.since) qs.set("since", params.since);
    if (params.limit) qs.set("limit", String(params.limit));
    return this.req(
      "GET",
      `/repos/${this.repoId}/git?${qs.toString()}`,
    );
  }
}

// ─── Factory ────────────────────────────────────────────────────────

/** Create an IdeaSpaces client. */
export function createClient(config: IsClientConfig): IsClient {
  const transport =
    config.transport ??
    createFetchTransport({
      apiUrl: config.apiUrl ?? DEFAULT_API_URL,
      apiKey: config.apiKey,
      timeout: config.timeout,
      retry: config.retry,
    });
  return new IsClient(transport, config.repo ?? "");
}
