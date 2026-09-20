export interface ALDataClientPorts {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  fetch(url: string, options: RequestInit): Promise<Response>;
  timeout(milliseconds: number): AbortSignal;
}

const requestWindowMs = 60_000;
const requestsPerWindow = 12;
const requestTimeoutMs = 20_000;

export type ALDataRequest = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };

/** One client owns the rolling limit shared by all ALData operations. */
export function createALDataClient(baseUrl: string, ports: ALDataClientPorts) {
  let requestTimes: number[] = [];

  async function reserveRequest(): Promise<void> {
    for (;;) {
      const now = ports.now();
      requestTimes = requestTimes.filter((at) => now - at < requestWindowMs);
      if (requestTimes.length < requestsPerWindow) {
        requestTimes.push(ports.now());
        return;
      }
      await ports.sleep(Math.max(250, requestWindowMs - (now - requestTimes[0])));
    }
  }

  async function request(route: string, options: ALDataRequest = {}): Promise<unknown> {
    await reserveRequest();
    const response = await ports.fetch(baseUrl + route, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: ports.timeout(requestTimeoutMs),
    });
    if (response.status === 429) throw new Error("ALData rate limit reached");
    if (!response.ok) throw new Error("ALData returned HTTP " + response.status);
    if (response.status === 204 || response.headers.get("content-length") === "0") return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  return { request };
}
