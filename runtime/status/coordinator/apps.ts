// The app keys: the key store,
// the gate every coordinator request passes, last use and revoke. The player's paired browser is
// the player; any other app sends `Authorization: Bearer <key>`. The store keeps each
// key's SHA-256 only and the issue answer shows the key once. The keys are the status owner's
// own record, `appKeys` in fields.ts.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes } from 'node:crypto';
import { isRequestObject, requestObject, requestText, type HttpRequest, type HttpResponse } from '../../lifecycle/api.ts';
import type { AppKey, AppScope } from '../api.ts';
import { secretField, type RequestCaller } from '../rules.ts';
import { appRouteScope, APP_SCOPES, APP_VERIFY } from './routes.ts';
// The app's name shows on the card line, the records and the settings history beside character
// names, so it follows the game's name rule, the lifecycle owner's one copy.
import { characterNameAllowed } from '../../lifecycle/api.ts';

interface AppRecord extends AppKey { hash: string }
interface AppsState { appKeys?: AppRecord[] }
interface AppsPorts {
  now(): number;
  // The record's save, through the settings owner's persistence writer.
  persist(): void;
  notify(event: 'app.keyIssued' | 'app.keyRevoked' | 'app.used' | 'dashboard.command', payload: Record<string, unknown>): void;
}
// A request as the gate reads it: Express gives the method, path and parsed body.
type GateRequest = HttpRequest & { method?: string; path?: string };

const digest = (key: string) => createHash('sha256').update(key).digest('hex');
// A command's body less what the secret-name list keeps from every answer and every listener (rules.ts `secretField`).
function withoutSecrets(body: unknown): unknown {
  if (!isRequestObject(body)) return body;
  return Object.fromEntries(Object.entries(body).filter(([field]) => !secretField(field)));
}
// The app key a request came in on, for all the work that request runs, its awaits
// included. The gate starts it; the settings owner's writer (the line's `by` and the lock on app writes)
// and movement's travel commands (the `app` tier) read it through `requestCaller`. The player's
// browser and the console's own calls run with none, so their writes keep the route's own name.
const callers = new AsyncLocalStorage<RequestCaller>();
export const requestCaller = (): RequestCaller | undefined => callers.getStore();
const publicKey = ({ hash: _hash, ...key }: AppRecord): AppKey => key;

export function createApps(state: AppsState, ports: AppsPorts) {
  const keys = () => (state.appKeys ||= []);
  const live = (name: string) => keys().find(key => key.name === name && key.revokedAt === null);
  // The key a bearer header names, while it is not revoked; undefined for no header.
  function keyOf(authorization: string | undefined): AppRecord | null | undefined {
    const bearer = /^Bearer\s+(\S+)$/i.exec(authorization || '')?.[1];
    if (!authorization) return undefined;
    if (!bearer) return null;
    const hash = digest(bearer);
    return keys().find(key => key.hash === hash && key.revokedAt === null) ?? null;
  }
  // An app key's caller. Its switch "Counts as my own commands" makes it the player's tier.
  const callerOf = (key: AppRecord): RequestCaller => ({ by: 'app:' + key.name, tier: key.ownCommands ? 'manual' : 'app' });
  const notice = (key: AppRecord, by: string) => ({ name: key.name, scopes: key.scopes, tier: callerOf(key).tier, by });

  /**
   * The gate, before every coordinator route. A request with no bearer is the player's browser or the
   * console's own character (the host gateway pairs browsers). A key passes only for a route
   * whose scope it carries; routes.ts's scope table names no scope for the characters' own
   * routes or the key screens, so no key reaches them. A key's request runs as its app's caller.
   * A dashboard route's write sends `dashboard.command`. The body stays as the client sent it, so
   * a route that checks every field of its body reads only its own.
   */
  function gate(request: GateRequest, response: HttpResponse, next: () => void): unknown {
    const key = keyOf(request.get('authorization')), method = request.method || 'GET', path = request.path || '';
    if (key === null) return response.status(401).json({ error: 'This app key is unknown or revoked' });
    const scope = appRouteScope(method, path);
    // The gateway's check of a key is not the app's use; the request it lets through is.
    if (key && path === APP_VERIFY) return next();
    if (key) {
      if (!scope || !key.scopes.includes(scope))
        return response.status(403).json({ error: scope ? `This app key has no ${scope} scope` : 'No app key reaches this route' });
      // The last use rides the next save the settings owner's writer makes; a poll
      // alone asks for none.
      key.lastUsedAt = ports.now();
      ports.notify('app.used', notice(key, 'app:' + key.name));
    }
    // A dashboard route's write is a command; a character's own report is not one.
    if (scope && method === 'POST' && isRequestObject(request.body)) {
      const body = request.body;
      ports.notify('dashboard.command', { route: path, ...(typeof body.character === 'string' ? { character: body.character } : {}),
        ...(typeof body.group === 'string' ? { group: body.group } : {}), body: withoutSecrets(body), by: key ? callerOf(key).by : 'user' });
    }
    return key ? callers.run(callerOf(key), next) : next();
  }

  // The key screens' routes: only the player's browser reaches them.
  function install(router: { get(path: string, handler: (request: HttpRequest, response: HttpResponse) => unknown): unknown;
    post(path: string, handler: (request: HttpRequest, response: HttpResponse) => unknown): unknown }) {
    router.get('/party-api/apps', (_request, response) => response.json({ apps: keys().map(publicKey), scopes: APP_SCOPES }));
    // The host gateway asks here before it lets a bearer request through; the gate above already
    // refused an unknown or revoked key, so a request that reaches this route is valid.
    router.get(APP_VERIFY, (_request, response) => response.json({ ok: true }));
    router.post('/party-api/apps', (request, response) => {
      const body = requestObject(request.body), name = requestText(body.name ?? '').trim();
      const scopes = (Array.isArray(body.scopes) ? body.scopes : []).filter((scope): scope is AppScope => APP_SCOPES.includes(scope as AppScope));
      if (!characterNameAllowed(name)) return response.status(400).json({ error: 'Name the app as the game names a character: letters, digits or _, not only digits' });
      if (live(name)) return response.status(409).json({ error: `${name} already has a key; revoke it first` });
      if (!scopes.length) return response.status(400).json({ error: 'Tick at least one scope' });
      const key = randomBytes(32).toString('hex');
      const record: AppRecord = { name, scopes: [...new Set(scopes)], ownCommands: body.ownCommands === true, issuedAt: ports.now(),
        lastUsedAt: null, revokedAt: null, hash: digest(key) };
      // The name has no live key here, so each record under it is revoked and has no use left; the
      // new key replaces them, and the key screen lists one record per name.
      state.appKeys = [...keys().filter(entry => entry.name !== name), record];
      ports.persist();
      ports.notify('app.keyIssued', notice(record, 'user'));
      return response.json({ key, app: publicKey(record) });
    });
    router.post('/party-api/apps/:name/revoke', (request, response) => {
      const key = live(requestText(request.params.name));
      if (!key) return response.status(404).json({ error: 'No live key has that name' });
      key.revokedAt = ports.now();
      ports.persist();
      ports.notify('app.keyRevoked', notice(key, 'user'));
      return response.json({ app: publicKey(key) });
    });
    router.post('/party-api/apps/:name/own-commands', (request, response) => {
      const key = live(requestText(request.params.name));
      if (!key) return response.status(404).json({ error: 'No live key has that name' });
      key.ownCommands = requestObject(request.body).ownCommands === true;
      ports.persist();
      return response.json({ app: publicKey(key) });
    });
  }
  return { gate, install };
}
export type Apps = ReturnType<typeof createApps>;
