// The groups' routes: the diagnostics read, and the scoped farming route that sends a
// character's request to its own group's handler.
//
// The group owners' diagnostics read:
// Each group's live task, waiting list, ladder, holds, status line
// and ring, the invariant breaks and each group's saved snapshots. The ring travels only here,
// never in the heartbeat or the dashboard state.
import { requestObject, type HttpHandler, type HttpResponse, type HttpRouter } from '../../lifecycle/api.ts';
import type { TaskOwner } from './owner.ts';

// `presence` is each character's event fact (3.1), read here by the rows that check it.
export function installTaskRoutes(router: HttpRouter, owner: TaskOwner, snapshots: (group: string) => unknown[], presence: () => Record<string, unknown> = () => ({})) {
  router.get('/party-api/tasks', (_req, res) => {
    const read = owner.diagnostics();
    return res.json({ ...read, presence: presence(), snapshots: Object.fromEntries(read.groups.map(g => [g.id, snapshots(g.id)])) });
  });
}

interface ScopedRoutePorts<Service> {
  owned(name: string): unknown;
  merchant(): string | null;
  combat(name: string): boolean;
  owner(name: string): string;
  solo(name: string): Service | null;
  mainOwner(): string | null;
  mode(name: string): unknown;
}

/** Address settings by character; workflow acknowledgements resolve the current effective owner. */
export function createScopedFarmingRoute<Service>(main: HttpHandler,
  select: (service: Service) => HttpHandler, ports: ScopedRoutePorts<Service>, edit = false, followerMode?: HttpHandler): HttpHandler {
  return (req, res) => {
    const name = requestObject(req.body).character;
    if (name === undefined) return main(req, resultResponse(res, ports.mainOwner(), ports, edit));
    if (typeof name !== "string" || !ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    if (followerMode && isFollower(name, ports))
      return followerMode(req, resultResponse(res, name, ports, true));
    const error = edit ? editError(name, ports) : null;
    if (error) return res.status(409).json({ error });
    const service = ports.solo(name);
    return (service ? select(service) : main)(req, resultResponse(res, name, ports, edit));
  };
}
function isFollower<Service>(name: string, ports: ScopedRoutePorts<Service>): boolean {
  return name !== ports.merchant() && ports.combat(name) && ports.owner(name) !== name;
}
function editError<Service>(name: string, ports: ScopedRoutePorts<Service>): string | null {
  if (name === ports.merchant() || !ports.combat(name)) return "Merchants do not run Monster Hunts";
  return ports.owner(name) !== name ? "following leader settings" : null;
}
function resultResponse<Service>(res: HttpResponse, name: string | null, ports: ScopedRoutePorts<Service>, edit: boolean): HttpResponse {
  if (!edit || !name) return res;
  return new Proxy(res, {
    get(target, key) {
      if (key === "json") return (value: unknown) => {
        const body = requestObject(value), owner = ports.owner(name);
        return res.json(body.ok ? { ...body, farmingOwner: owner,
          savedFarmingPolicy: ports.mode(name), effectiveFarmingPolicy: ports.mode(owner) } : value);
      };
      const member = Reflect.get(target, key);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

// The scoped farming routes: each route sends a character's request to its own group's
// handler, `group` scopes every route of a group so the dashboard table names each group once, and
// the scoped router gives each solo group its own copy of a shared walk route, built on the group's
// first request.
export interface ScopedRoutesPorts<Service> extends ScopedRoutePorts<Service> {
  // The saved mode route a follower's mode change goes to.
  savedMode(): HttpHandler;
  // Installs a solo group's shared walk routes into its own table.
  walkRoutes(routes: Pick<HttpRouter, 'get' | 'post'>, service: Service): void;
}
export function createScopedRoutes<Service>(ports: ScopedRoutesPorts<Service>) {
  const route = (main: HttpHandler, select: (service: Service) => HttpHandler, edit = false, savedMode = false): HttpHandler =>
    createScopedFarmingRoute(main, select, ports, edit, savedMode ? ports.savedMode() : undefined);
  function router(router: HttpRouter): HttpRouter {
    const handlers = new Map<string, Map<string, HttpHandler>>();
    const register = (method: 'get' | 'post', path: string, main: HttpHandler) => router[method](path, (req, res) => {
      const name = String(requestObject(method === 'get' ? req.query : req.body).character);
      if (!ports.owned(name)) return res.status(400).json({ error: 'unknown character' });
      const service = ports.solo(name);
      if (!service) return main(req, res);
      if (!handlers.has(name)) {
        const routes = new Map<string, HttpHandler>();
        ports.walkRoutes({ get: (url, handler) => routes.set('get ' + url, handler), post: (url, handler) => routes.set('post ' + url, handler) }, service);
        handlers.set(name, routes);
      }
      return handlers.get(name)!.get(method + ' ' + path)!(req, res);
    });
    return { get: (path, handler) => register('get', path, handler), post: (path, handler) => register('post', path, handler) };
  }
  function group<Key extends string>(routes: Record<Key, HttpHandler>, select: (service: Service) => Record<Key, HttpHandler>): Record<Key, HttpHandler> {
    const scoped = { ...routes };
    for (const key in scoped) scoped[key] = route(routes[key], service => select(service)[key]);
    return scoped;
  }
  return { route, group, router };
}
