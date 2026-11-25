import { request, type IncomingMessage, type ServerResponse } from "node:http";
import { gatewayHeaders } from '../dashboard/api.ts';
/** A host program's bound against a process, daemon or server that does not answer: the host has no
 *  run scope and no boundFired, so a bound that ends its wait logs its name, its length and what it
 *  ended, then the caller's error goes on. Each bound is a named constant in the module that waits. */
export interface HostBound { name: string; ms: number }
export async function bounded<T>(bound: HostBound, what: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const signal = AbortSignal.timeout(bound.ms);
  try { return await run(signal); }
  catch (error) {
    if (signal.aborted) console.warn(`[bound] ${bound.name} (${bound.ms} ms) ended ${what}`);
    throw error;
  }
}
// The gateway's proxy bound against a coordinator or dashboard that accepts and never answers: the
// client gets a 504 naming it and the host log a line. authorize.ts's app key check waits on the
// same coordinator under the same bound. A request body past REQUEST_BODY_MAX bytes
// is refused (a size limit, not a wait).
export const PROXY_UPSTREAM: HostBound = { name: 'gatewayUpstreamMs', ms: 30000 };
const REQUEST_BODY_MAX = 16384;
export function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
export function redirect(res: ServerResponse) {
  res.writeHead(302, { Location: "/setup" });
  res.end();
}
export function failure(res: ServerResponse, error: unknown) {
  if (!res.headersSent)
    json(res, 400, { error: error instanceof Error ? error.message : "Invalid request" });
  else res.end();
}
export function text(value: unknown) {
  return typeof value === "string" ? value : "";
}
export async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let value = "";
  for await (const chunk of req) {
    value += chunk;
    if (value.length > REQUEST_BODY_MAX) throw new Error("Request too large");
  }
  const parsed = req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')
    ? Object.fromEntries(new URLSearchParams(value)) : JSON.parse(value || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("JSON object required");
  return parsed;
}
export function proxy(req: IncomingMessage, res: ServerResponse, port: number, dashboard = false) {
  const upstream = request(
    {
      hostname: "127.0.0.1",
      port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, cookie: "", host: `127.0.0.1:${port}`,
        'x-party-tls': '',
        ...(dashboard ? gatewayHeaders() : {}),
        // The gateway already checked the browser origin; the loopback supervisor checks it again.
        ...(req.url?.startsWith("/__dashboard/") || (dashboard && req.headers.origin) ? { origin: `http://127.0.0.1:${port}` } : {}) },
    },
    (reply) => {
      const headers = { ...reply.headers };
      delete headers["access-control-allow-origin"];
      delete headers["set-cookie"];
      res.writeHead(reply.statusCode || 502, headers);
      res.flushHeaders();
      reply.pipe(res);
    },
  );
  upstream.setTimeout(PROXY_UPSTREAM.ms, () => {
    console.warn(`[bound] ${PROXY_UPSTREAM.name} (${PROXY_UPSTREAM.ms} ms) ended a request to port ${port}`);
    if (!res.headersSent) json(res, 504, { error: `The service on port ${port} did not answer within ${PROXY_UPSTREAM.ms} ms` });
    upstream.destroy();
  });
  upstream.on("error", (error: NodeJS.ErrnoException) => {
    console.warn(`Gateway upstream ${port} failed: ${error.code || error.message}`);
    if (!res.headersSent)
      json(res, 503, { error: "Service is starting or unavailable; retry shortly" });
    else res.end();
  });
  req.on("aborted", () => upstream.destroy());
  res.on("close", () => upstream.destroy());
  req.pipe(upstream);
}
