import { request, type IncomingMessage, type ServerResponse } from "node:http";
import { gatewayHeaders } from '../dashboard/gateway-access.ts';
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
    if (value.length > 16384) throw new Error("Request too large");
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
  upstream.setTimeout(30000, () => upstream.destroy());
  upstream.on("error", () => {
    if (!res.headersSent)
      json(res, 503, { error: "Service is starting or unavailable; retry shortly" });
    else res.end();
  });
  req.on("aborted", () => upstream.destroy());
  res.on("close", () => upstream.destroy());
  req.pipe(upstream);
}
