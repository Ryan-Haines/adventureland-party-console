// The lifecycle routes: Pause, Play and
// the clean shutdown; the deploy lease's readiness and table S's admission, which the managed host
// asks; the loader's deployment reply; and the reports the host reads for a reload. The route
// plumbing moved here from runtime/coordinator/http/middleware.ts, dashboard.ts and
// web-services.ts: the response headers, the dashboard's route order and the web services' start;
// the route table moved here from runtime/coordinator/http/registration.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { requestObject, type HttpResponse, type HttpRouter } from '../http.ts';
import { fresh } from '../../protocol/reports.ts';
import type { LoadMode } from '../rules.ts';
import type { createConsoleControl } from './control.ts';
import type { Statuses } from './lease.ts';
import { startFailure } from './start.ts';
import { characterInspectionRoute, type InspectionPorts } from './inspection.ts';


interface RoutePorts {
  control: ReturnType<typeof createConsoleControl>;
  statuses(): Statuses;
  /** The CODE directory, whose activation.json names the activation the loader runs. */
  code: string;
  /** A character's inspection (inspection.ts): its saved profile with the game's derived stats. */
  inspection: InspectionPorts;
}

// The CODE directory's activation id, or null with no readable activation, so a loader stops polling
// activation.json for a 404.
function activation(code: string): string | null {
  try { return String(JSON.parse(readFileSync(path.join(code, 'activation.json'), 'utf8')).id || '') || null; }
  catch { return null; }
}

export function installLifecycleRoutes(router: HttpRouter, ports: RoutePorts): void {
  const { control } = ports;
  router.get('/party-api/console-control', (_req, res) => res.json(control.status()));
  router.post('/party-api/console-control/:action', (req, res) => {
    const body = requestObject(req.body);
    try {
      switch (req.params.action) {
        case 'pause': control.pause(); break;
        case 'play': control.play(); break;
        case 'shutdown': control.requestShutdown(body.force === true); break;
        case 'cancel-shutdown': control.cancelShutdown(); break;
        case 'cancel-resume': control.cancelResume(); break;
        default: return res.status(404).json({ error: 'Unknown console control action' });
      }
      control.observe();
      return res.json(control.status());
    } catch (error) { return res.status(500).json({ error: String((error as Error).message || error) }); }
  });
  router.get('/party-api/console-maintenance', (_req, res) => res.json(control.maintenance()));
  router.get('/party-api/characters/:name/inspection', characterInspectionRoute(ports.inspection));
  // Table S1: the host asks before it writes a lease, so a refused deploy writes none.
  router.get('/party-api/console-maintenance/admit', (req, res) => {
    const mode = String(requestObject(req.query).mode ?? 'now');
    if (!['now', 'safe', 'main'].includes(mode)) return res.status(400).json({ error: 'Unknown load mode' });
    return res.json({ refusal: control.admit(mode as LoadMode) });
  });
  // The loader's reply: the deploy lease alone, and the Pause as its own field.
  router.get('/party-api/console-deployment', (_req, res) => res.json({ serverNow: Date.now(),
    consoleMaintenance: control.drain()?.lease ?? null, consolePaused: control.state().paused, activation: activation(ports.code) }));
  // Each report with its freshness, which the host reads in place of a copy of the rule.
  router.get('/party-api/console-runtime', (_req, res) => {
    const now = Date.now(), statuses = ports.statuses();
    res.json({ start: { failed: startFailure() }, characters: Object.fromEntries(Object.entries(statuses).map(([name, raw]) => {
      const report = requestObject(raw);
      return [name, { name, seenAt: report.seenAt, connected: report.connected, ctype: report.ctype, type: report.type, codeHash: report.codeHash, rip: report.rip,
        fresh: report.connected !== false && fresh(report.seenAt, now, 'recent'),
        consoleMaintenance: report.consoleMaintenance, map: report.map, in: report.in, x: report.x, y: report.y }];
    })) });
  });
}

interface HeaderResponse {
  set: (name: string, value: string) => unknown;
  sendStatus: (status: number) => unknown;
}

type Next = () => void;

/** CODE must never be cached: workers reload it after runtime publication. */
function codeResponseHeaders(_request: unknown, response: HeaderResponse, next: Next): void {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Cache-Control", "no-store, max-age=0");
  response.set("Pragma", "no-cache");
  next();
}

/** Finish browser preflights before they reach the dashboard handlers. */
function partyApiResponseHeaders(
  request: { method?: string },
  response: HeaderResponse,
  next: Next,
): unknown {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Headers", "Content-Type");
  response.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (request.method === "OPTIONS") return response.sendStatus(204);
  next();
}

interface DashboardRouter<Handler, Middleware> {
  get: (path: string, handler: Handler) => unknown;
  post: (path: string, ...handlers: (Handler | Middleware)[]) => unknown;
  use: {
    (middleware: Middleware): unknown;
    (path: string, middleware: typeof partyApiResponseHeaders): unknown;
  };
}
type DashboardHandlers<Handler> = AnniversaryAndCommerceHandlers<Handler> &
  FarmingAndTravelHandlers<Handler> &
  MerchantControlsHandlers<Handler> &
  MerchantTransactionsHandlers<Handler> & {
    dashboardImportRoutes: { metadata: Handler; exportState: Handler; preferences: Handler; preview: Handler; importState: Handler };
    settingsRoutes: { list: Handler; save: Handler };
    characterCreationRoutes: { roster: Handler; bankboi: Handler };
    bankboiStorageRoutes: { checkpoint: Handler; complete: Handler };
    bankboiDeleteRoute: Handler;
    realmRoutes: { switchRealm: Handler; homeComplete: Handler };
    partyActionRoutes: { escape: Handler };
  };
interface DashboardPorts<Handler, Middleware, Router> {
  json: (options: { limit: string }) => Middleware;
  text: (options: { type: string; limit: string }) => Middleware;
  maps: (router: Router) => void;
  // The status owner's routes: state, ready, status, the streams, the logs, the metrics and the diagnostics
  // records (runtime/status/coordinator/routes.ts `installStatusRoutes`).
  status: (router: Router) => void;
  roster: (router: Router) => void;
  startMail: () => {
    snapshot: Handler;
    action: (name: "refresh" | "collect" | "delete" | "settings" | "seen" | "outbox-delete") => Handler;
  };
}

/** Install the dashboard in its original middleware, route and service-start order. */
export function installCoordinatorDashboard<
  Handler,
  Middleware,
  Router extends DashboardRouter<Handler, Middleware>,
>(
  router: Router,
  handlers: DashboardHandlers<Handler>,
  ports: DashboardPorts<Handler, Middleware, Router>,
): void {
  // Initial heartbeats include catalogs plus the merchant's bank. Expanded
  // reward tables and a populated bank can exceed 12 MB; later reports omit catalogs.
  router.use(ports.json({ limit: "32mb" }));
  router.use("/party-api", partyApiResponseHeaders);
  ports.status(router);
  router.get("/party-api/dashboard-state/export", handlers.dashboardImportRoutes.exportState);
  router.post("/party-api/dashboard-preferences", handlers.dashboardImportRoutes.preferences);
  router.get("/party-api/settings", handlers.settingsRoutes.list);
  router.post("/party-api/settings", handlers.settingsRoutes.save);
  router.get("/party-api/dashboard-state", handlers.dashboardImportRoutes.metadata);
  router.post(
    "/party-api/dashboard-state/preview",
    ports.text({ type: "text/plain", limit: "128mb" }),
    handlers.dashboardImportRoutes.preview,
  );
  router.post(
    "/party-api/dashboard-state/import",
    ports.text({ type: "text/plain", limit: "128mb" }),
    handlers.dashboardImportRoutes.importState,
  );
  installAnniversaryAndCommerceRoutes(router, handlers);
  ports.maps(router);
  router.post("/party-api/roster/create", handlers.characterCreationRoutes.roster);
  router.post("/party-api/bankbois/create", handlers.characterCreationRoutes.bankboi);
  router.post("/party-api/bankboi/checkpoint", handlers.bankboiStorageRoutes.checkpoint);
  router.post("/party-api/bankboi/complete", handlers.bankboiStorageRoutes.complete);
  router.post("/party-api/bankbois/:name/delete", handlers.bankboiDeleteRoute);
  ports.roster(router);
  router.post("/party-api/realm/switch", handlers.realmRoutes.switchRealm);
  router.post("/party-api/realm/home-complete", handlers.realmRoutes.homeComplete);
  installFarmingAndTravelRoutes(router, handlers);
  router.post("/party-api/escape", handlers.partyActionRoutes.escape);
  installMerchantControlsRoutes(router, handlers);
  const mail = ports.startMail();
  router.get("/party-api/mail", mail.snapshot);
  for (const action of ["refresh", "collect", "delete", "settings", "seen", "outbox-delete"] as const)
    router.post("/party-api/mail/" + action, mail.action(action));
  installMerchantTransactionsRoutes(router, handlers);
}

interface WebSettings {
  port: number;
  enable_bwi?: boolean;
  enable_minimap?: boolean;
  expose_CODE?: boolean;
  party_dashboard?: boolean;
  expose_TYPECODE?: boolean;
}
interface WebRouter<Middleware> {
  use: (path: string, middleware: Middleware | typeof codeResponseHeaders) => unknown;
}
interface WebPorts<
  Middleware,
  Server extends WebRouter<Middleware>,
  Monitor extends { router?: Server },
> {
  createRouter: () => Server & { listen: (port: number, host?: string) => unknown;
    get: (path: string, handler: (request: unknown, response: HttpResponse) => unknown) => unknown };
  createMonitor: (options: { port: number; password: null; updateRate: number }) => Monitor;
  retainMonitor: (monitor: Monitor) => void;
  staticFiles: (path: string) => Middleware;
  dashboard: (router: Server) => void;
  info: (details: { type: string; src_path?: string }, message: string) => void;
  error: (message: string, error?: unknown) => void;
  directory: string;
  updateRate: number;
}

// Every router the console creates answers the running build's identity: the deploy's artifact
// id and the coordinator bundle's hash.
function identifiedRouter<
  Middleware,
  Server extends WebRouter<Middleware>,
  Monitor extends { router?: Server },
>(ports: WebPorts<Middleware, Server, Monitor>) {
  const router = ports.createRouter();
  router.get('/party-api/build-identity', (_request, response) => response.json({
    artifactId: process.env.AL_CONSOLE_ARTIFACT_ID || null,
    hash: process.env.AL_CONSOLE_COORDINATOR_HASH || null,
  }));
  return router;
}

function serveCode<
  Middleware,
  Server extends WebRouter<Middleware>,
  Monitor extends { router?: Server },
>(
  server: Server | undefined,
  settings: WebSettings,
  ports: WebPorts<Middleware, Server, Monitor>,
): Server {
  if (!server) {
    const app = identifiedRouter(ports);
    server = app;
    app.listen(settings.port, "127.0.0.1");
  }
  const directory = ports.directory + "/../CODE";
  ports.info({ type: "CODE_exposed", src_path: directory }, "Serving CODE statically");
  server.use("/CODE", codeResponseHeaders);
  server.use("/CODE", ports.staticFiles(directory));
  return server;
}

function serveTypeCode<
  Middleware,
  Server extends WebRouter<Middleware>,
  Monitor extends { router?: Server },
>(
  server: Server | undefined,
  settings: WebSettings,
  ports: WebPorts<Middleware, Server, Monitor>,
): void {
  if (!server) {
    const app = identifiedRouter(ports);
    server = app;
    app.listen(settings.port);
  }
  const directory = ports.directory + "/../TYPECODE.out";
  ports.info({ type: "TYPECODE_exposed", src_path: directory }, "Serving TYPECODE statically");
  server.use("/TYPECODE", ports.staticFiles(directory));
}

/** Reuse the monitor router and preserve legacy binding, setup order and partial-start failure behavior. */
export function startCoordinatorWebServices<
  Middleware,
  Server extends WebRouter<Middleware>,
  Monitor extends { router?: Server },
>(
  settings: WebSettings | undefined,
  typeCodeEnabled: boolean,
  ports: WebPorts<Middleware, Server, Monitor>,
): void {
  try {
    if (settings) startConfiguredServices(settings, typeCodeEnabled, ports);
  } catch (error) {
    ports.error("failed to start web services.", error);
    ports.error("no web services will be available");
  }
}

function startConfiguredServices<
  Middleware,
  Server extends WebRouter<Middleware>,
  Monitor extends { router?: Server },
>(
  settings: WebSettings,
  typeCodeEnabled: boolean,
  ports: WebPorts<Middleware, Server, Monitor>,
): void {
  let server: Server | undefined;
  if (settings.enable_bwi || settings.enable_minimap) {
    const monitor = ports.createMonitor({
      port: settings.port,
      password: null,
      updateRate: ports.updateRate,
    });
    ports.retainMonitor(monitor);
    server = monitor.router;
  }
  if (settings.expose_CODE || settings.party_dashboard) server = serveCode(server, settings, ports);
  if (settings.party_dashboard) {
    // Dashboard implies CODE above, which supplies the router before any routes are installed.
    ports.dashboard(server!);
    ports.info(
      { type: "party_dashboard" },
      "Party API listening on http://127.0.0.1:" + settings.port,
    );
  }
  if (settings.expose_TYPECODE && typeCodeEnabled) serveTypeCode(server, settings, ports);
}

/** Minimal router contract keeps registration independent of Express and its server lifecycle. */
interface CoordinatorRouteRegistrar<Handler> {
  get: (path: string, handler: Handler) => unknown;
  post: (path: string, handler: Handler) => unknown;
}

interface AnniversaryAndCommerceHandlers<Handler> {
  anniversaryVisitRoutes: {
    claim: Handler;
    attempt: Handler;
    failure: Handler;
    handoff: Handler;
  };
  anniversaryNavigationRoutes: { ready: Handler; preempt: Handler; staging: Handler };
  anniversaryCommerceRoutes: {
    advertise: Handler;
    chat: Handler;
    chatComplete: Handler;
    trade: Handler;
    tradeComplete: Handler;
    cakeComplete: Handler;
  };
  anniversarySuppliesRoute: Handler;
  mailPostageRoute: Handler;
  aldataRoutes: {
    key: Handler;
    market: Handler;
    generateKey: Handler;
    auth: Handler;
    sendAuth: Handler;
    refresh: Handler;
  };
}

function installAnniversaryAndCommerceRoutes<Handler>(
  router: CoordinatorRouteRegistrar<Handler>,
  handlers: AnniversaryAndCommerceHandlers<Handler>,
): void {
  router.post("/party-api/anniversary/claim", handlers.anniversaryVisitRoutes.claim);
  router.post("/party-api/anniversary/attempt", handlers.anniversaryVisitRoutes.attempt);
  router.post("/party-api/anniversary/failure", handlers.anniversaryVisitRoutes.failure);
  router.post("/party-api/anniversary/handoff", handlers.anniversaryVisitRoutes.handoff);
  router.post("/party-api/anniversary/return-ready", handlers.anniversaryNavigationRoutes.ready);
  router.post(
    "/party-api/anniversary/navigation-preempt",
    handlers.anniversaryNavigationRoutes.preempt,
  );
  router.post("/party-api/anniversary/staging", handlers.anniversaryNavigationRoutes.staging);
  router.post("/party-api/anniversary/advertise", handlers.anniversaryCommerceRoutes.advertise);
  router.post("/party-api/anniversary/chat-advertise", handlers.anniversaryCommerceRoutes.chat);
  router.post(
    "/party-api/anniversary/chat-advertise-complete",
    handlers.anniversaryCommerceRoutes.chatComplete,
  );
  router.post("/party-api/anniversary/trade", handlers.anniversaryCommerceRoutes.trade);
  router.post(
    "/party-api/anniversary/trade-complete",
    handlers.anniversaryCommerceRoutes.tradeComplete,
  );
  router.post("/party-api/anniversary/cake-supplies", handlers.anniversarySuppliesRoute);
  router.post(
    "/party-api/anniversary/cake-complete",
    handlers.anniversaryCommerceRoutes.cakeComplete,
  );
  router.get("/party-api/mail/postage", handlers.mailPostageRoute);
  router.get("/party-api/aldata/key", handlers.aldataRoutes.key);
  router.get("/party-api/aldata/market", handlers.aldataRoutes.market);
  router.post("/party-api/aldata/key", handlers.aldataRoutes.generateKey);
  router.get("/party-api/aldata/auth", handlers.aldataRoutes.auth);
  router.post("/party-api/aldata/send-auth", handlers.aldataRoutes.sendAuth);
  router.post("/party-api/aldata/refresh", handlers.aldataRoutes.refresh);
}

interface FarmingAndTravelHandlers<Handler> {
  monsterSelectionRoutes: { navigate: Handler; passive: Handler };
  focusRoute: Handler;
  formationRoute: Handler;
  huntBlacklistRoute: Handler;
  huntSettingsRoute: Handler;
  huntModeRoute: Handler;
  huntControlRoutes: { retryReturn: Handler; interactionComplete: Handler };
  eventRecoveryRoutes: { disabled: Handler; ended: Handler; rejoin: Handler };
  eventAcknowledgementRoutes: {
    progress: Handler;
    townComplete: Handler;
    returnComplete: Handler;
    resumeComplete: Handler;
  };
  convoyEngagementRoutes: { engage: Handler; approach: Handler };
  convoyAcknowledgementRoutes: { complete: Handler; failed: Handler };
  addonRoutes: { list: Handler; save: Handler; read: Handler };
  // Step 9b: a target mode add-on's own settings for the character's scope.
  addonFarmingRoute: Handler;
  addonCommandRoute: Handler;
  partyActionRoutes: { travel: Handler; checkpoint: Handler; bank: Handler; escapeState: Handler };
}

function installFarmingAndTravelRoutes<Handler>(
  router: CoordinatorRouteRegistrar<Handler>,
  handlers: FarmingAndTravelHandlers<Handler>,
): void {
  router.post("/party-api/navigate-to-monster", handlers.monsterSelectionRoutes.navigate);
  router.get("/party-api/addons", handlers.addonRoutes.list);
  router.post("/party-api/addons", handlers.addonRoutes.save);
  // C3: one coordinator read an add-on's dashboard piece asks (hooks/http.ts `read`).
  router.get("/party-api/addon-read", handlers.addonRoutes.read);
  router.post("/party-api/addon-farming", handlers.addonFarmingRoute);
  router.post("/party-api/addon-command", handlers.addonCommandRoute);
  router.post("/party-api/rare-hunting", handlers.monsterSelectionRoutes.passive);
  router.post("/party-api/focus", handlers.focusRoute);
  router.post("/party-api/formation", handlers.formationRoute);
  router.post("/party-api/hunt-blacklist", handlers.huntBlacklistRoute);
  router.post("/party-api/hunt-settings", handlers.huntSettingsRoute);
  router.post("/party-api/farming-mode", handlers.huntModeRoute);
  router.post("/party-api/monster-hunt/retry-return", handlers.huntControlRoutes.retryReturn);
  router.post(
    "/party-api/monster-hunt-interact-complete",
    handlers.huntControlRoutes.interactionComplete,
  );
  router.post("/party-api/event-disabled", handlers.eventRecoveryRoutes.disabled);
  router.post("/party-api/event-ended", handlers.eventRecoveryRoutes.ended);
  // The rejoin route: a manual leave of an event comes back.
  router.post("/party-api/event-rejoin", handlers.eventRecoveryRoutes.rejoin);
  router.post("/party-api/town-complete", handlers.eventAcknowledgementRoutes.townComplete);
  router.post("/party-api/return-progress", handlers.eventAcknowledgementRoutes.progress);
  router.post(
    "/party-api/event-return-complete",
    handlers.eventAcknowledgementRoutes.returnComplete,
  );
  router.post(
    "/party-api/event-resume-complete",
    handlers.eventAcknowledgementRoutes.resumeComplete,
  );
  router.post("/party-api/convoy-engage", handlers.convoyEngagementRoutes.engage);
  router.post("/party-api/grouped-approach", handlers.convoyEngagementRoutes.approach);
  router.post("/party-api/convoy-complete", handlers.convoyAcknowledgementRoutes.complete);
  router.post("/party-api/convoy-failed", handlers.convoyAcknowledgementRoutes.failed);
  router.post("/party-api/travel", handlers.partyActionRoutes.travel);
  router.post("/party-api/checkpoint", handlers.partyActionRoutes.checkpoint);
  router.post("/party-api/bank-party", handlers.partyActionRoutes.bank);
  router.get("/party-api/escape", handlers.partyActionRoutes.escapeState);
}

interface MerchantControlsHandlers<Handler> {
  partyActionRoutes: { resume: Handler; town: Handler; upgrades: Handler };
  merchantSettingsRoutes: {
    bankSort?: { configure: Handler; checkpoint: Handler };
    configure: Handler;
    gather: Handler;
    gatherStatus: Handler;
    activity: Handler;
    clearActivity: Handler;
  };
  staleOrderRoute: Handler;
  ruleConflictRoute: Handler;
  standMarkRoute: Handler;
  npcSaleRoute: Handler;
  deconstructionRoutes?: { mark: Handler; automatic: Handler; step: Handler };
  automaticSaleRoutes: { npc: Handler; stand: Handler };
  routinePriorityRoute: Handler;
  merchantBlacklistRoute: Handler;
  merchantControlRoutes: { cancel: Handler; retry?: Handler };
  merchantBidRoute: Handler;
  stackMergeRoute: Handler;
  merchantIdleRoute: Handler;
  merchantRequestRoutes: { donate: Handler };
}

function installMerchantControlsRoutes<Handler>(
  router: CoordinatorRouteRegistrar<Handler>,
  handlers: MerchantControlsHandlers<Handler>,
): void {
  router.post("/party-api/escape/resume", handlers.partyActionRoutes.resume);
  router.post("/party-api/town-party", handlers.partyActionRoutes.town);
  router.post("/party-api/upgrade-party", handlers.partyActionRoutes.upgrades);
  if (handlers.merchantSettingsRoutes.bankSort) {
    router.post("/party-api/merchant/bank-sort", handlers.merchantSettingsRoutes.bankSort.configure);
    router.post("/party-api/merchant/bank-sort/checkpoint", handlers.merchantSettingsRoutes.bankSort.checkpoint);
  }
  router.post("/party-api/merchant/config", handlers.merchantSettingsRoutes.configure);
  router.post("/party-api/merchant/gather", handlers.merchantSettingsRoutes.gather);
  router.post("/party-api/merchant/gather-status", handlers.merchantSettingsRoutes.gatherStatus);
  router.post("/party-api/merchant/activity", handlers.merchantSettingsRoutes.activity);
  router.post("/party-api/merchant/activity/clear", handlers.merchantSettingsRoutes.clearActivity);
  router.post("/party-api/merchant/stale-orders/clear", handlers.staleOrderRoute);
  router.post("/party-api/merchant/rule-conflict", handlers.ruleConflictRoute);
  router.post("/party-api/merchant/stand", handlers.standMarkRoute);
  router.post("/party-api/merchant/npc-sale", handlers.npcSaleRoute);
  if (handlers.deconstructionRoutes) {
    router.post("/party-api/deconstruction/mark", handlers.deconstructionRoutes.mark);
    router.post("/party-api/deconstruction/auto", handlers.deconstructionRoutes.automatic);
    router.post("/party-api/deconstruction/step", handlers.deconstructionRoutes.step);
  }
  router.post("/party-api/merchant/auto-npc-sale", handlers.automaticSaleRoutes.npc);
  router.post("/party-api/merchant/auto-stand", handlers.automaticSaleRoutes.stand);
  router.post("/party-api/merchant/routine-priorities", handlers.routinePriorityRoute);
  router.post("/party-api/merchant/blacklist", handlers.merchantBlacklistRoute);
  router.post("/party-api/merchant/job/cancel", handlers.merchantControlRoutes.cancel);
  if (handlers.merchantControlRoutes.retry)
    router.post("/party-api/merchant/job/retry", handlers.merchantControlRoutes.retry);
  router.post("/party-api/merchant/bid", handlers.merchantBidRoute);
  router.post("/party-api/merchant/stack-merge-permission", handlers.stackMergeRoute);
  router.post("/party-api/merchant/idle-status", handlers.merchantIdleRoute);
  router.post("/party-api/merchant/donate", handlers.merchantRequestRoutes.donate);
}

interface MerchantTransactionsHandlers<Handler> {
  sendMailRoute: Handler;
  merchantRequestRoutes: { giveaway: Handler; search: Handler };
  manualMarketOrderRoutes: { stand: Handler; purchase: Handler; ponty: Handler; sale: Handler };
  merchantOrderRoute: { handle: Handler };
  merchantExchangeRoutes: { progress: Handler; supply: Handler; order: Handler; offeringSupply:Handler };
  merchantControlRoutes: { clear: Handler; force: Handler };
  merchantHandoffRoutes: {
    handoff: Handler;
    complete: Handler;
    cleanout: Handler;
    order: Handler;
    orderComplete: Handler;
  };
  merchantProgressRoutes: { job: Handler; heartbeat: Handler; checkpoint: Handler };
  marketplaceProgressRoutes: { ponty: Handler; aldata: Handler };
  merchantRealmRoutes: { switchRealm: Handler; ensureHome: Handler };
  marketplaceLocationRoute: Handler;
  merchantClusterRoutes: { leader: Handler; marked: Handler; luck: Handler };
  bankUnlockRoute: Handler;
  merchantCompletionRoute: Handler;
  inventoryReceiptRoutes: { statScrolls: Handler; equipment: Handler; bank: Handler };
  restockRoute: Handler;
  thresholdRoute: Handler;
  characterCommandRoute: Handler;
}

function installMerchantTransactionsRoutes<Handler>(
  router: CoordinatorRouteRegistrar<Handler>,
  handlers: MerchantTransactionsHandlers<Handler>,
): void {
  router.post("/party-api/merchant/send-mail", handlers.sendMailRoute);
  router.post("/party-api/merchant/join-giveaway", handlers.merchantRequestRoutes.giveaway);
  router.post("/party-api/merchant/stand-search", handlers.merchantRequestRoutes.search);
  router.post("/party-api/merchant/stand-order", handlers.manualMarketOrderRoutes.stand);
  router.post("/party-api/merchant/aldata-order", handlers.manualMarketOrderRoutes.purchase);
  router.post("/party-api/merchant/ponty-order", handlers.manualMarketOrderRoutes.ponty);
  router.post("/party-api/merchant/aldata-sale", handlers.manualMarketOrderRoutes.sale);
  router.post("/party-api/merchant/order", handlers.merchantOrderRoute.handle);
  router.post("/party-api/merchant/exchange-progress", handlers.merchantExchangeRoutes.progress);
  router.post("/party-api/merchant/exchange-supply", handlers.merchantExchangeRoutes.supply);
  router.post("/party-api/merchant/offering-supply", handlers.merchantExchangeRoutes.offeringSupply);
  router.post("/party-api/merchant/exchange-order", handlers.merchantExchangeRoutes.order);
  router.post("/party-api/merchant/clear", handlers.merchantControlRoutes.clear);
  router.post("/party-api/merchant/force-stand", handlers.merchantControlRoutes.force);
  router.post("/party-api/merchant/handoff", handlers.merchantHandoffRoutes.handoff);
  router.post("/party-api/merchant/handoff-complete", handlers.merchantHandoffRoutes.complete);
  router.post("/party-api/merchant/cleanout", handlers.merchantHandoffRoutes.cleanout);
  router.post("/party-api/merchant/order-handoff", handlers.merchantHandoffRoutes.order);
  router.post(
    "/party-api/merchant/order-handoff-complete",
    handlers.merchantHandoffRoutes.orderComplete,
  );
  router.get("/party-api/merchant/job/:id", handlers.merchantProgressRoutes.job);
  router.post("/party-api/merchant/heartbeat", handlers.merchantProgressRoutes.heartbeat);
  router.post("/party-api/merchant/ponty-progress", handlers.marketplaceProgressRoutes.ponty);
  router.post("/party-api/merchant/aldata-progress", handlers.marketplaceProgressRoutes.aldata);
  router.post("/party-api/merchant/realm-switch", handlers.merchantRealmRoutes.switchRealm);
  router.post("/party-api/merchant/refresh-location", handlers.marketplaceLocationRoute);
  router.post("/party-api/merchant/ensure-home-realm", handlers.merchantRealmRoutes.ensureHome);
  router.post("/party-api/merchant/checkpoint", handlers.merchantProgressRoutes.checkpoint);
  router.post("/party-api/merchant/leader-cluster", handlers.merchantClusterRoutes.leader);
  router.post("/party-api/merchant/marked-cluster", handlers.merchantClusterRoutes.marked);
  router.post("/party-api/merchant/luck-cluster", handlers.merchantClusterRoutes.luck);
  router.post("/party-api/bank/unlock", handlers.bankUnlockRoute);
  router.post("/party-api/merchant/complete", handlers.merchantCompletionRoute);
  router.post("/party-api/merchant/delivery-receipt", handlers.merchantCompletionRoute);
  router.post("/party-api/stat-scroll-complete", handlers.inventoryReceiptRoutes.statScrolls);
  router.post("/party-api/equip-delivery-complete", handlers.inventoryReceiptRoutes.equipment);
  router.post("/party-api/restock", handlers.restockRoute);
  router.post("/party-api/bank-complete", handlers.inventoryReceiptRoutes.bank);
  router.post("/party-api/config", handlers.thresholdRoute);
  router.post("/party-api/command", handlers.characterCommandRoute);
}
