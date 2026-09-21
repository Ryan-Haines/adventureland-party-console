import { createServer, type ServerResponse } from "node:http";
import { setupPage } from "./page.ts";
import { json, proxy, failure } from "./http.ts";
import { authorizeBrowser, authorizeSteam } from "./authorize.ts";
import type { Options } from "./setup-routes.ts";
import { websocket } from "./websocket.ts";
import { acceptTransfer } from './setup-transfer.ts';
export { loaderCode } from "./setup-routes.ts";
async function health(res: ServerResponse, options: Options) {
  const ready = options.healthy ? await options.healthy() : true;
  json(res, ready ? 200 : 503, { ready, configured: options.configured() });
}
function upstreamPort(url: string, options: Options) {
  return /^\/(party-api|CODE)\//.test(url) ? options.apiPort || 924 : options.dashboardPort;
}
async function continueSetup(req: import('node:http').IncomingMessage, res: ServerResponse, url: URL, options: Options) {
  if (url.pathname.startsWith('/console-control/')) {
    if (options.updates?.control) await options.updates.control(req, res, url.pathname);
    else json(res, 404, { error: 'Managed updater unavailable' });
    return true;
  }
  if (url.pathname !== '/setup/continue' || req.method !== 'POST') return false;
  await acceptTransfer(req, res, options); return true;
}
export function gateway(options: Options) {
  const server = createServer(async (req, res) => {
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    try {
      const url = new URL(req.url || "/", "http://internal");
      if (await continueSetup(req, res, url, options)) return;
      if (url.pathname === "/health") {
        await health(res, options);
        return;
      }
      if (url.pathname === "/setup" && req.method === "GET") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(setupPage);
        return;
      }
      const match = /^\/bridge\/([a-f0-9]{64})(\/.*)$/.exec(url.pathname);
      const permitted = match
        ? authorizeSteam(req, res, url, match, options)
        : await authorizeBrowser(req, res, url, options);
      if (permitted) {
        const route = req.url || '';
        const port = upstreamPort(route, options);
        proxy(req, res, port, !/^\/(party-api|CODE)\//.test(route));
      }
    } catch (error) {
      failure(res, error);
    }
  });
  websocket(server, options);
  return server;
}
