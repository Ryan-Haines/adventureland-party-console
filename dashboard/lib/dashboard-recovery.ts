export type SupervisorState = {
  immutable?: boolean;
  mode: "development" | "production" | null;
  busy: boolean;
  error: string | null;
  instance?: string | null;
  ready?: boolean;
};
export type RecoveryStatus = { seconds: number; checking: boolean; blocked: boolean };
export const recoveryStoragePrefix = "party-dashboard-recovery:";
export function clearRecoveryHistory(storage: Pick<Storage, "length" | "key" | "removeItem">): void {
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key?.startsWith(recoveryStoragePrefix)) storage.removeItem(key);
  }
}
export function recoveryDelay(attempt: number): number {
  return attempt < 10 ? 1000 : Math.min(60000, 1000 * 2 ** Math.min(6, attempt - 9));
}
interface Ports {
  now(): number;
  later(callback: () => void, ms: number): unknown;
  cancel(timer: unknown): void;
  probe(signal: AbortSignal): Promise<string | null>;
  claimed(instance: string): boolean;
  claim(instance: string): void;
  reload(): void;
  update(status: RecoveryStatus): void;
}
export function startRecovery(ports: Ports) {
  let attempt = 0, disposed = false, checking = false, blocked = false, manual = false;
  let timer: unknown, timeout: unknown, controller: AbortController | undefined;
  let due = ports.now() + recoveryDelay(attempt);
  function publish() { ports.update({ seconds: Math.max(0, Math.ceil((due - ports.now()) / 1000)), checking, blocked }); }
  function tick() {
    if (disposed) return;
    publish();
    if (ports.now() >= due) void check();
    else timer = ports.later(tick, Math.min(1000, due - ports.now()));
  }
  async function check() {
    if (checking || disposed) return;
    checking = true; publish();
    controller = new AbortController();
    timeout = ports.later(() => controller?.abort(), 5000);
    try {
      const instance = await ports.probe(controller.signal);
      if (disposed || controller.signal.aborted) return;
      if (instance) {
        blocked = !manual && ports.claimed(instance);
        // A healthy page blocked by loop protection is not a failed poll.
        attempt = -1;
        if (!blocked) {
          // Store before navigating so a persistent render error cannot loop.
          try { ports.claim(instance); } catch (error) { if (!manual) throw error; }
          disposed = true;
          ports.reload();
        }
      } else blocked = false;
    } catch { /* Keep checking after unavailable servers or timed-out requests. */ }
    finally {
      ports.cancel(timeout);
      checking = false; manual = false;
      if (!disposed) { attempt++; due = ports.now() + recoveryDelay(attempt); tick(); }
    }
  }
  tick();
  return {
    retry() {
      if (disposed || checking) return;
      ports.cancel(timer); attempt = -1; manual = true; blocked = false; due = ports.now();
      void check();
    },
    dispose() { disposed = true; ports.cancel(timer); ports.cancel(timeout); controller?.abort(); },
  };
}

export async function probeDashboard(fetcher: typeof fetch, url: string, signal: AbortSignal,
  report?: (state: SupervisorState) => void, waitForBuild = false): Promise<string | null> {
  const options = { signal, cache: "no-store" as const };
  async function state() {
    try {
      const response = await fetcher("/__dashboard/state", options);
      if (!response.ok) return null;
      const value = await response.json() as SupervisorState;
      report?.(value);
      return value;
    } catch { return null; }
  }
  const before = await state();
  // Requested builds must finish before refreshing. Error recovery instead
  // checks whether the currently served page works, including a retained build.
  if (waitForBuild && (!before?.ready || before.busy || before.error || !before.instance)) return null;
  const page = await fetcher(url, { ...options, headers: { Accept: "text/html" } });
  const healthy = page.ok && (page.headers.get("content-type") || "").includes("text/html");
  await page.body?.cancel();
  if (!healthy) return null;
  const after = await state();
  if (waitForBuild && (!after?.ready || after.busy || after.error)) return null;
  if (before?.instance && after?.instance && before.instance !== after.instance) return null;
  return after?.instance || before?.instance || "direct-dashboard";
}
