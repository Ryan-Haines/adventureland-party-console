// Each health probe's bound: a dashboard or coordinator process that accepts the connection and never
// answers reads as not ready at this bound (the gateway's /health is asked on each poll).
const PROBE_MS = 3000;
// The host's internal ports, from the environment the host and the updater share: the one port rule
// start.mts, the updater's gateway route and the Windows updater read.
export function internalPorts(env: NodeJS.ProcessEnv = process.env): { dashboard: number; api: number } {
  return { dashboard: Number(env.AL_INTERNAL_DASHBOARD_PORT) || 3030, api: Number(env.AL_INTERNAL_API_PORT) || 924 };
}
// The coordinator's failed start (start.ts `failStart`), which the gateway's /health serves
// beside `ready` so an update rolls back on it at once. No coordinator answer is no failed start.
export async function startFailure(apiPort = internalPorts().api): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${apiPort}/party-api/console-runtime`, { signal: AbortSignal.timeout(PROBE_MS) });
    if (!response.ok) return null;
    const failed = (await response.json() as { start?: { failed?: unknown } }).start?.failed;
    return typeof failed === 'string' && failed ? failed : null;
  } catch { return null; }
}
let lastProbeFailure: string | null = null;
export async function servicesHealthy(configured: boolean, dashboardPort = internalPorts().dashboard, apiPort = internalPorts().api): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${dashboardPort}/__dashboard/state`, { signal: AbortSignal.timeout(PROBE_MS) });
    const state = await response.json() as { ready?: boolean };
    if (!response.ok || !state.ready) return false;
    if (!configured) return true;
    const ready = await fetch(`http://127.0.0.1:${apiPort}/party-api/ready`, { signal: AbortSignal.timeout(PROBE_MS) });
    await ready.body?.cancel();
    if (ready.status !== 404) return ready.ok;
    // A rollback can run a coordinator older than this host, without the
    // readiness route. Its state route answers the same question.
    const api = await fetch(`http://127.0.0.1:${apiPort}/party-api/state?catalog=0`, { signal: AbortSignal.timeout(PROBE_MS) });
    await api.body?.cancel();
    return api.ok;
  } catch (error) {
    // A probe that throws (a timeout, a refused port, an answer that is not JSON) logs its cause once
    // per change, so ready:false has a cause in the host log without a line per poll.
    const cause = String((error as Error & { cause?: { code?: string } }).cause?.code || (error as Error).message);
    if (cause !== lastProbeFailure) console.warn(`Health probe failed: ${cause}`);
    lastProbeFailure = cause;
    return false;
  }
}
