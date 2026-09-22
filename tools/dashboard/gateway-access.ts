import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

/** Child dashboard servers are implementation details, not onboarding entry points. */
export function configureDashboardGateway() {
  process.env.AL_DASHBOARD_GATEWAY_URL = process.env.AL_PUBLIC_URL || `http://localhost:${Number(process.env.AL_PORT) || 3010}`;
  process.env.AL_DASHBOARD_GATEWAY_TOKEN = randomUUID();
}
export function gatewayHeaders(): Record<string, string> {
  return process.env.AL_DASHBOARD_GATEWAY_TOKEN ? { 'x-party-dashboard-gateway': process.env.AL_DASHBOARD_GATEWAY_TOKEN } : {};
}
export function fromGateway(req: IncomingMessage): boolean {
  return !process.env.AL_DASHBOARD_GATEWAY_URL || !!process.env.AL_DASHBOARD_GATEWAY_TOKEN &&
    req.headers['x-party-dashboard-gateway'] === process.env.AL_DASHBOARD_GATEWAY_TOKEN;
}
export function redirectInternal(req: IncomingMessage, res: ServerResponse): boolean {
  if (fromGateway(req)) return false;
  const destination = new URL(process.env.AL_DASHBOARD_GATEWAY_URL!);
  const requested = new URL(req.url || '/', 'http://internal');
  destination.pathname = requested.pathname;
  destination.search = requested.search;
  res.setHeader('Cache-Control', 'no-store');
  if (['GET', 'HEAD'].includes(req.method || '')) {
    res.writeHead(302, { Location: destination.href }); res.end();
  } else {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Open Party Console at ' + destination.origin + ' to continue.', url: destination.origin }));
  }
  return true;
}
export function protectInternalServer(server: Server) {
  const listeners = server.listeners('request');
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (!redirectInternal(req, res)) for (const listener of listeners) listener.call(server, req, res);
  });
}
export function dashboardReadyMessage(mode: string, port: number): string {
  return process.env.AL_DASHBOARD_GATEWAY_URL
    ? 'Party Console ready. Open ' + process.env.AL_DASHBOARD_GATEWAY_URL + ' (first-time installations continue to setup).'
    : 'Dashboard ' + mode + ' ready at http://127.0.0.1:' + port;
}
