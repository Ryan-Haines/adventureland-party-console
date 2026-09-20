interface HeaderResponse {
  set: (name: string, value: string) => unknown;
  sendStatus: (status: number) => unknown;
}

type Next = () => void;

/** CODE must never be cached: workers reload it after runtime publication. */
export function codeResponseHeaders(_request: unknown, response: HeaderResponse, next: Next): void {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Cache-Control", "no-store, max-age=0");
  response.set("Pragma", "no-cache");
  next();
}

/** Finish browser preflights before they reach the dashboard handlers. */
export function partyApiResponseHeaders(
  request: { method?: string },
  response: HeaderResponse,
  next: Next,
): unknown {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Headers", "Content-Type");
  response.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (request.method === "OPTIONS") return response.sendStatus(204);
  next();
}
