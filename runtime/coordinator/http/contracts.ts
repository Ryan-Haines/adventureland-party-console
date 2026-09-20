/** The HTTP boundary used by coordinator routes; Express is supplied by the host. */
export interface HttpRequest {
  get(name: string): string | undefined;
  body?: unknown;
  query?: Record<string, unknown>;
  params: Record<string, string>;
  on(event: "close", listener: () => void): unknown;
}

export interface HttpResponse {
  status(code: number): HttpResponse;
  json(value: unknown): unknown;
  end(): unknown;
  set(name: string, value: string): unknown;
  set(headers: Record<string, string>): unknown;
  flushHeaders?(): void;
  write(chunk: string): unknown;
  once?(event: "drain", listener: () => void): unknown;
  sendStatus(code: number): unknown;
}

export type HttpHandler = (request: HttpRequest, response: HttpResponse) => unknown;
export interface HttpRouter {
  get(path: string, handler: HttpHandler): unknown;
  post(path: string, handler: HttpHandler): unknown;
}

/** Network objects remain untrusted until a route validates the fields it uses. */
export function isRequestObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function requestObject(value: unknown): Record<string, unknown> {
  return isRequestObject(value) ? value : {};
}

/** Existing text endpoints coerce JSON values with JavaScript's String contract. */
export function requestText(value: unknown): string {
  return String(value);
}
