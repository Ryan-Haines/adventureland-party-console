// Dashboard and status's routes: the state, ready and status routes, the dashboard and map streams, the logs, the
// metrics and the diagnostics records and the app keys, installed in one call at the place the lifecycle owner's
// plumbing gives 12 (runtime/lifecycle/coordinator/ routes.ts `installCoordinatorDashboard`). Each service keeps its
// own handlers; this file names which of them are the status owner's routes and the scope an app key needs for each.
// The interface versions the apps read are rules.ts's interface v1 rows.
import { requestObject, requestText, type HttpHandler, type HttpRouter } from '../../lifecycle/api.ts';
import { TABLE_G, type LeasedRing } from '../rules.ts';
import { partyHooks } from '../../hooks/index.ts';
import type { Diagnostics } from './diagnostics.ts';
import { boundFirings, boundsReported } from './bounds.ts';
import type { AppScope } from '../api.ts';
import type { Apps } from './apps.ts';

// The scope each dashboard route needs from an app key. A route the table does not name (the
// characters' own reports and callbacks, the key screens, the ALData key read) takes no key. Every
// other read is `read`, except a read that changes what a character does: the diagnostics records
// read starts or renews a character's lease, which makes it post its rings each report, so it is
// `command`. `spend` is anything that spends or sends gold or items.
export const APP_SCOPES: readonly AppScope[] = ['read', 'command', 'settings', 'spend'];
export const APP_VERIFY = '/party-api/apps/verify';
// The lifecycle owner's roster routes take `command`, all but /steam/bridge, the Steam window's
// own keyless post. A vault unlock pays gold, so it takes `spend`. The merchant's stand location
// is a settings write, and its gather toggle, force stand and clear are commands that spend
// nothing.
const POST_SCOPES: readonly [RegExp, AppScope][] = [
  [/^\/party-api\/(settings|config|dashboard-state\/(preview|import)|hunt-settings|hunt-blacklist|formation|focus|farming-mode|addons|market\/ignored-items|dashboard-preferences|merchant\/(config|blacklist|routine-priorities|auto-stand|auto-npc-sale|rule-conflict|stand-location))$/, 'settings'],
  [/^\/party-api\/(command|travel|town-party|navigate-to-monster|shared-travel|escape|escape\/resume|realm\/switch|console-control\/[^/]+|event-rejoin|monster-hunt\/retry-return|daily-dungeons|rare-hunting|bank-party|addon-farming|addon-command|metrics\/reset|anniversary\/chat-advertise|combat-log\/[^/]+\/clear|merchant\/(activity\/clear|job\/(cancel|retry)|refresh-location|stand-search|realm-switch|ensure-home-realm|stack-merge-permission|bank-sort|gather|force-stand|clear)|steam\/(action|restore|realm-choice|switch|headless|recover)|slots\/\d+\/(logout|spawn))$/, 'command'],
  [/^\/party-api\/(merchant\/(order|stand|stand-order|native-stand|bid|npc-sale|send-mail|join-giveaway|donate|ponty-order|exchange-order|aldata-order|aldata-sale|cleanout|stale-orders\/clear|production)|mail\/[a-z-]+|aldata\/(refresh|send-auth)|upgrade-party|deconstruction\/(auto|mark|step)|restock|bankbois\/create|bankbois\/[^/]+\/delete|roster\/create|bank\/unlock)$/, 'spend'],
];
const UNREAD = /^\/party-api\/(apps(\/|$)|aldata\/key$)/;
const LEASED_READ = /^\/party-api\/diagnostics\/records$/;
export function appRouteScope(method: string, path: string): AppScope | null {
  if (method === 'GET' || method === 'HEAD')
    return UNREAD.test(path) || !path.startsWith('/party-api/') ? null : LEASED_READ.test(path) ? 'command' : 'read';
  return POST_SCOPES.find(([route]) => route.test(path))?.[1] ?? null;
}

interface Installs { install(router: HttpRouter): void }
interface StatusRoutes {
  state: HttpHandler;
  intake: { handle: HttpHandler };
  // The dashboard stream, the map stream, the combat and game logs, and the metrics.
  installs: readonly Installs[];
  diagnostics: Diagnostics;
  // Table K: the app key store and the gate every route passes.
  apps: Apps;
  owned(name: string): unknown;
}

const RINGS = new Set<string>(TABLE_G.map(row => row.ring));
// Table G's rings and each enabled add-on's own (the `diagnostics-ring` slot).
const isRing = (value: string): value is LeasedRing => RINGS.has(value) || partyHooks().rings().some(ring => ring.ring === value);
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

type GateRouter = HttpRouter & { use(gate: Apps['gate']): unknown };
export function installStatusRoutes(router: GateRouter, routes: StatusRoutes): void {
  // The gate runs before every route the dashboard install adds after this one.
  router.use(routes.apps.gate);
  routes.apps.install(router);
  router.get('/party-api/state', routes.state);
  // The host health check asks this route, so it never builds the full state.
  router.get('/party-api/ready', (_request, response) => response.json({ ready: true }));
  router.post('/party-api/status', routes.intake.handle);
  for (const service of routes.installs) service.install(router);
  // Table G: a character posts each leased ring here after its report.
  router.post('/party-api/diagnostics/records', (req, res) => {
    const b = requestObject(req.body), name = String(b.character), ring = String(b.ring);
    if (!routes.owned(name) || !isRing(ring)) return res.status(400).json({ error: 'unknown character or ring' });
    if (!routes.diagnostics.post(name, ring, { records: list(b.records), incidents: list(b.incidents) }))
      return res.status(409).json({ error: 'no diagnostics lease' });
    return res.json({ ok: true });
  });
  // The diagnostics view reads here with the rings it shows (`rings=movement,turns`); each read
  // starts or renews the character's lease on them.
  router.get('/party-api/diagnostics/records', (req, res) => {
    const name = requestText(req.query?.character), named = requestText(req.query?.rings).split(',').filter(Boolean);
    if (!routes.owned(name) || !named.every(isRing)) return res.status(400).json({ error: 'unknown character or ring' });
    return res.json(routes.diagnostics.read(name, named as LeasedRing[]));
  });
  // The bound record (bounds.ts), once for the whole party: its firings name their own subjects.
  router.get('/party-api/diagnostics/bounds', (_req, res) => res.json(boundFirings()));
  // The dashboard's cap counts (dashboard cap-counts.ts): the page sends no status report, so it posts
  // its queued cap entries here. The record takes cap entries only, under the reporter `dashboard`.
  router.post('/party-api/diagnostics/caps', (req, res) => {
    boundsReported(list(requestObject(req.body).firings).filter(firing => requestObject(firing).cap === true), 'dashboard');
    res.json({ taken: true });
  });
}
