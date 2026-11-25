// Dashboard and status's coordinator door (with, "Two doors"): the coordinator values, which import
// node built-ins (reply.ts's `node:perf_hooks`), so runtime/status/api.ts stays loadable in a character
// bundle and the dashboard. The transport timing movement's routes report.
export { transportTiming } from "./reply.ts";
// The saved coordinator history the settings owner's initializer loads at
// startup.
export { initialCoordinatorHistory } from "./logs.ts";
// The one combat log append every coordinator writer calls.
export { appendCombatLog } from "./logs.ts";
// The safety bound record every owner's kept bound tells when it trips (big check part 6).
export { boundFired, boundFirings, boundsReported, capReached, type BoundFiring } from "./bounds.ts";
// The catalog check for a client version and the catalog reset, which the lifecycle owner's
// client update applies.
export { createInstalledCatalogValidation, resetCatalogs, type CatalogDefinitions, type ReportedCatalogs } from "./intake.ts";

// What the lifecycle owner's composition root (runtime/coordinator/application.ts) and
// its contract check (initialization.contract-check.ts) compose of this owner.
export { createCoordinatorActivity } from './logs.ts';
export { createDashboardStream, createCoordinatorTelemetry } from './streams.ts';
export { createStatusIntake } from './intake.ts';
export { createReply, installStatusNotices, createHeartbeatReply } from './reply.ts';
export { createCardLines } from './line.ts';
export { createCoordinatorPublicOverview, online, accountGoldSnapshot } from './state.ts';
export { openMetricsService } from './metrics/service.ts';
export { createDiagnostics } from './diagnostics.ts';
export { installStatusRoutes } from './routes.ts';
export { createApps, requestCaller } from './apps.ts';
