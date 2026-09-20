import { installGameLogs } from "./game-logs.ts";
import { createDashboardSampler } from "./dashboard-sampler.ts";
Object.assign(globalThis, { createPartyDashboardSampler: createDashboardSampler, installPartyGameLogs: installGameLogs });
