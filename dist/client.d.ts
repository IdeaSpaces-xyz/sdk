/**
 * IdeaSpaces client — typed operations against the sw_space API.
 *
 * Extracted from pi-sw-space/src/client.ts. All methods return SdkResponse<T>
 * wrapping data + metadata (request timing, retry count, rate limit info).
 *
 * Uses the transport layer for resilient HTTP (retry, backoff, error classification).
 */
import type { IsClientConfig, IsTransport, SdkResponse, RepoInfo, OutlineResult, NavigateResult, SearchParams, SearchResult, FileResult, WriteFileBody, WriteResult, GrepResult, GrepSectionsResult, TagsResult, HistoryResult, NodeVersionResult, DeleteResult, MoveResult, MetadataFields, MetadataUpdateResult, ListNodesParams, ListNodesResult, FileStatusResult, GitOpsParams, GitOpsResult } from "./types.js";
export declare const DEFAULT_API_URL = "https://api.starwatcher.ai";
export declare class IsClient {
    private transport;
    private repo;
    constructor(transport: IsTransport, repo: string);
    /** Current repo ID. Throws if not set. */
    get repoId(): string;
    /** Whether a repo is selected. */
    get isConnected(): boolean;
    /** Update the active repo (e.g. after autoSelectRepo). */
    setRepo(repoId: string): void;
    private req;
    listRepos(): Promise<SdkResponse<{
        repos: RepoInfo[];
    }>>;
    outline(): Promise<SdkResponse<OutlineResult>>;
    navigate(path?: string): Promise<SdkResponse<NavigateResult>>;
    search(params: SearchParams): Promise<SdkResponse<{
        results: SearchResult[];
    }>>;
    readFile(path: string, opts?: {
        offset?: number;
        limit?: number;
    }): Promise<SdkResponse<FileResult>>;
    readNode(nodeId: string): Promise<SdkResponse<FileResult>>;
    writeFile(path: string, body: WriteFileBody): Promise<SdkResponse<WriteResult>>;
    grep(pattern: string, scope?: string): Promise<SdkResponse<GrepResult>>;
    grepSections(heading: string, scope?: string, maxLines?: number): Promise<SdkResponse<GrepSectionsResult>>;
    listTags(prefix?: string): Promise<SdkResponse<TagsResult>>;
    nodeHistory(nodeId: string): Promise<SdkResponse<HistoryResult>>;
    nodeAtVersion(nodeId: string, sha: string): Promise<SdkResponse<NodeVersionResult>>;
    deleteNode(nodeId: string): Promise<SdkResponse<DeleteResult>>;
    moveFile(source: string, destination?: string): Promise<SdkResponse<MoveResult>>;
    updateMetadata(nodeId: string, fields: MetadataFields): Promise<SdkResponse<MetadataUpdateResult>>;
    listNodes(params?: ListNodesParams): Promise<SdkResponse<ListNodesResult>>;
    fileStatus(scope?: string): Promise<SdkResponse<FileStatusResult>>;
    gitOps(params: GitOpsParams): Promise<SdkResponse<GitOpsResult>>;
}
/** Create an IdeaSpaces client. */
export declare function createClient(config: IsClientConfig): IsClient;
//# sourceMappingURL=client.d.ts.map