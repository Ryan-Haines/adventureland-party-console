export async function servicesHealthy(configured: boolean, dashboardPort = 3030): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${dashboardPort}/__dashboard/state`, { signal: AbortSignal.timeout(3000) });
    const state = await response.json() as { ready?: boolean };
    if (!response.ok || !state.ready) return false;
    if (!configured) return true;
    const api = await fetch("http://127.0.0.1:924/party-api/state?catalog=0", { signal: AbortSignal.timeout(3000) });
    await api.body?.cancel();
    return api.ok;
  } catch { return false; }
}
