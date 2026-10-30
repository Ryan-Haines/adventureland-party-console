export async function servicesHealthy(configured: boolean, dashboardPort = 3030, apiPort = 924): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${dashboardPort}/__dashboard/state`, { signal: AbortSignal.timeout(3000) });
    const state = await response.json() as { ready?: boolean };
    if (!response.ok || !state.ready) return false;
    if (!configured) return true;
    const ready = await fetch(`http://127.0.0.1:${apiPort}/party-api/ready`, { signal: AbortSignal.timeout(3000) });
    await ready.body?.cancel();
    if (ready.status !== 404) return ready.ok;
    // A rollback can run a coordinator older than this host, without the
    // readiness route. Its state route answers the same question.
    const api = await fetch(`http://127.0.0.1:${apiPort}/party-api/state?catalog=0`, { signal: AbortSignal.timeout(3000) });
    await api.body?.cancel();
    return api.ok;
  } catch { return false; }
}
