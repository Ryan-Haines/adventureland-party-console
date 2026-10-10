import type { IncomingMessage, ServerResponse } from "node:http";
import type { Options } from "./setup-routes.ts";
import { pair, setupRoute } from "./setup-routes.ts";
import { json, redirect } from "./http.ts";
import { requestOrigin } from './request-origin.ts';
export function authorizeSteam(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  match: RegExpExecArray,
  options: Options,
) {
  if (!options.access.valid("steam", match[1])) {
    json(res, 401, { error: "Steam pairing expired; generate a new loader in /setup" });
    return false;
  }
  const origin = req.headers.origin;
  if (origin && !["https://adventure.land", "http://adventure.land"].includes(origin)) {
    json(res, 403, { error: "Game origin required" });
    return false;
  }
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return false;
  }
  req.url = match[2] + url.search;
  if (!/^\/(party-api\/|CODE\/adventure_land\/)/.test(req.url)) {
    json(res, 404, { error: "Unknown game endpoint" });
    return false;
  }
  return true;
}
export function validBrowser(req: IncomingMessage, options: Options) {
  const cookie = /(?:^|;\s*)party=([^;]+)/.exec(req.headers.cookie || "")?.[1] || "";
  return options.access.valid("browsers", cookie);
}
export function sameBrowserOrigin(req: IncomingMessage, options: Options) {
  return [options.publicUrl, requestOrigin(req, options)].includes(req.headers.origin || "");
}
export function gamePath(path: string) { return /^\/(party-api\/|CODE\/adventure_land\/)/.test(path); }
function browserOriginAllowed(req: IncomingMessage, sameOrigin: boolean) {
  if (req.headers.origin && !sameOrigin) return false;
  return ["GET", "HEAD"].includes(req.method || "") || sameOrigin;
}
function requiresAccountSetup(options: Options): boolean {
  return !options.configured() && !!options.configure;
}
export async function authorizeBrowser(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: Options,
) {
  const sameOrigin = sameBrowserOrigin(req, options);
  if (!options.access.required && gamePath(url.pathname) && !sameOrigin) {
    if (requiresAccountSetup(options)) {
      json(res, 503, { error: 'Connect your game account in setup before using Party Console.', setupUrl: '/setup' });
      return false;
    }
    return authorizeDirectGame(req, res);
  }
  if (!browserOriginAllowed(req, sameOrigin)) {
    json(res, 403, { error: "Dashboard origin required" });
    return false;
  }
  if (url.pathname === "/setup/pair" && req.method === "POST") {
    await pair(req, res, options);
    return false;
  }
  if (options.access.required && !validBrowser(req, options)) {
    rejectBrowser(req, res, url);
    return false;
  }
  return await routeBrowser(req, res, url, options);
}
async function routeConsoleService(req: IncomingMessage, res: ServerResponse, url: URL, options: Options) {
  const services = [
    ['/console-build', options.builds, 'Staged builds are unavailable on this console.'],
    ['/console-debug', options.debug, 'Debug instances are unavailable on this console.'],
    ['/console-update', options.updates, 'Update service is unavailable'],
  ] as const;
  const service = services.find(([prefix]) => url.pathname === prefix || url.pathname.startsWith(prefix + '/'));
  if (!service) return false;
  if (service[1]) await service[1].route(req, res, url.pathname);
  else json(res, 503, {error: service[2]});
  return true;
}
async function routeBrowser(req: IncomingMessage, res: ServerResponse, url: URL, options: Options) {
  if (await routeConsoleService(req, res, url, options)) return false;
  if (url.pathname.startsWith("/setup/")) {
    await setupRoute(req, res, url.pathname, options);
    return false;
  }
  if (!options.configured() && options.configure) {
    redirect(res);
    return false;
  }
  return true;
}
function rejectBrowser(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (req.method === "GET" && !url.pathname.startsWith("/setup/")) redirect(res);
  else json(res, 401, { error: "Pair this browser using an invitation from an authorized browser or the server startup output" });
}
function authorizeDirectGame(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (origin && !["https://adventure.land", "http://adventure.land"].includes(origin)) {
    json(res, 403, { error: "Game origin required" }); return false;
  }
  // Missing origins are allowed for direct script/native clients, not browser mutations.
  if (!origin && !["GET", "HEAD"].includes(req.method || "")) {
    json(res, 403, { error: "Game origin required" }); return false;
  }
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return false; }
  return true;
}
