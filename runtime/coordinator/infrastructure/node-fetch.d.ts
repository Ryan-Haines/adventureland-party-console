/** caracAL owns node-fetch. This is the subset consumed by coordinator account APIs. */
declare module "node-fetch" {
  export interface CoordinatorFetchOptions {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
  export interface CoordinatorFetchResponse {
    ok: boolean;
    statusText: string;
    json(): Promise<unknown>;
  }
  export default function fetch(
    url: string,
    options: CoordinatorFetchOptions,
  ): Promise<CoordinatorFetchResponse>;
}
