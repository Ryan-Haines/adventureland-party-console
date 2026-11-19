import type { IncomingMessage, ServerResponse } from "node:http";
import type { Access } from "./access.ts";
import { body, json, text } from "./http.ts";
import { steamBootstrap } from "../../runtime/lifecycle/roster/connection.ts";
import { setupAddress } from "./address.ts";
import type { LocalTLS } from './tls.ts';
import { trustHelper } from './trust.ts';
import { requestOrigin } from './request-origin.ts';
import { transfer } from './setup-transfer.ts';
import { bareOrigin, partyCookie, publicPort } from './defaults.ts';
export interface Options {
  builds?: { route(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> };
  code?:{route(req:IncomingMessage,res:ServerResponse,pathname:string):Promise<boolean>};
  realms?: Promise<import('./realms.ts').RealmDiscovery>;
  debug?: import('../debug/service.ts').DebugInstances;
  steam?: import('../steam/service.ts').LocalSteam;
  tls?: LocalTLS;
  updates?: import('../update/hosting.ts').UpdateRoutes;
  access: Access;
  configured(): boolean;
  healthy?(): Promise<boolean>;
  /** The coordinator's failed start, which /health serves for the updater. */
  startFailed?(): Promise<string | null>;
  configure?(session: string, realm: string): Promise<void>;
  dashboardPort: number;
  apiPort?: number;
  publicUrl?: string;
}
export const loaderCode = steamBootstrap;
async function steamLoader(options: Options, input: Record<string, unknown>) {
  if (options.steam && input.placement !== undefined) await options.steam.preferences.save(input);
  const address = bareOrigin(text(input.origin), "Enter the server origin, without a path");
  const suffix = options.access.required ? "/bridge/" + await options.access.steam() : "";
  return { code: loaderCode(address.origin + suffix) };
}
export async function pair(req: IncomingMessage, res: ServerResponse, options: Options) {
  const input = await body(req);
  const credential = text(input.code)
    ? await options.access.pairCode(text(input.code))
    : await options.access.pair(text(input.token));
  browserCookie(req, res, credential);
  json(res, 200, { ok: true });
}
// The cookie is Secure only for an HTTPS requesting origin: LAN HTTP works beside a public HTTPS URL.
function browserCookie(req: IncomingMessage, res: ServerResponse, credential: string) {
  partyCookie(res, credential, !!req.headers.origin?.startsWith("https:"));
}
async function setupState(req: IncomingMessage, options: Options) {
  const secure = options.tls?.trusted(req);
  const origin = options.publicUrl || (secure ? requestOrigin(req, options) : undefined);
  const tls = options.tls ? { tls: await options.tls.status(), secure, httpPort: Number(process.env.AL_HTTP_PUBLIC_PORT || publicPort()) } : {};
  return { configured: options.configured(), requirePairing: options.access.required, ...(options.access.required ? { accessCodeExpiresAt: options.access.accessCodeExpiry } : {}), canConfigureAccount: !!options.configure, serverAddress: setupAddress(req, origin), steamPreferences: await options.steam?.preferences.read(), ...await options.realms, ...tls };
}
async function readSetup(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: Options,
) {
  if (pathname === "/setup/state" && req.method === "GET") {
    json(res, 200, await setupState(req, options));
    return true;
  }
  if (req.method === 'GET' && /^\/setup\/trust\/(certificate|windows|linux)$/.test(pathname)) {
    if (!options.tls) throw Error('HTTPS is not installed');
    const kind = pathname.split('/').pop();
    const pem = await options.tls.certificate();
    const file = kind === 'certificate' ? 'party-console-root.crt' : 'party-console-trust.' + (kind === 'windows' ? 'cmd' : 'sh');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.end(kind === 'certificate' ? pem : await trustHelper(pem, kind as 'windows' | 'linux')); return true;
  }
  return false;
}
// authorize.ts authorizeBrowser is the one pairing gate: an unpaired browser never reaches setupRoute.
export async function setupRoute(req: IncomingMessage, res: ServerResponse, pathname: string, options: Options) {
  if (await readSetup(req, res, pathname, options)) return;
  if (req.method !== "POST") {
    json(res, 405, { error: "POST required" });
    return;
  }
  const input = await body(req);
  const handlers: Record<string, () => Promise<unknown>> = {
    '/setup/client': async () => {
      if (!options.steam) throw Error('Local Steam launcher is unavailable.');
      return options.steam.preferences.save(input);
    },
    '/setup/transfer': () => transfer(req, options, input),
    '/setup/https': async () => {
      if (!options.tls) throw Error('HTTPS is not installed');
      return options.tls.prepare(text(input.origin));
    },
    "/setup/pairing": async () => {
      if (typeof input.requirePairing !== "boolean") throw new Error("requirePairing must be a boolean");
      const credential = await options.access.setRequired(input.requirePairing);
      if (credential) browserCookie(req, res, credential);
      return { requirePairing: options.access.required };
    },
    "/setup/session": async () => {
      if (!options.configure) throw new Error("Configure this account in the Windows launcher");
      await options.configure(text(input.session), text(input.realm));
      return { ok: true };
    },
    "/setup/invite": async () => ({ token: await options.access.invitation(), ...options.access.accessCode() }),
    "/setup/revoke": async () => {
      await options.access.revokeSteam();
      return { ok: true };
    },
    "/setup/steam": () => steamLoader(options, input),
  };
  const handler = handlers[pathname];
  if (handler) json(res, 200, await handler());
  else json(res, 404, { error: "Unknown setup action" });
}
