export type SupervisorState = {
  immutable?: boolean;
  mode: "development" | "production" | null;
  busy: boolean;
  error: string | null;
  instance?: string | null;
  ready?: boolean;
};
// `timedOut` is the probe bound's report: the last check passed PROBE_TIMEOUT_MS.
export type RecoveryStatus = { seconds: number; checking: boolean; blocked: boolean; timedOut: boolean };
export const recoveryStoragePrefix = "party-dashboard-recovery:";
export function clearRecoveryHistory(storage: Pick<Storage, "length" | "key" | "removeItem">): void {
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key?.startsWith(recoveryStoragePrefix)) storage.removeItem(key);
  }
}
/**
 * The page clears the render-loop guard once Home commits a render that holds a successful status
 * read: the page is up, so a later error on the same server can recover again. A render error
 * before that leaves the guard in place, which blocks the reload loop.
 */
export function clearWhenUp(storage: () => Pick<Storage, "length" | "key" | "removeItem">): (up: boolean) => void {
  let cleared = false;
  return (up) => {
    if (cleared || !up) return;
    cleared = true;
    try { clearRecoveryHistory(storage()); } catch { /* Storage may be disabled. */ }
  };
}
// The delay doubles from 1 s on each failed probe up to 60 s.
export function recoveryDelay(attempt: number): number {
  return Math.min(60000, 1000 * 2 ** Math.min(6, attempt));
}
// The bound on one probe against an unavailable or hung dashboard server.
export const PROBE_TIMEOUT_MS = 5000;
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
  let attempt = 0, disposed = false, checking = false, blocked = false, manual = false, timedOut = false;
  let timer: unknown, timeout: unknown, controller: AbortController | undefined;
  let due = ports.now() + recoveryDelay(attempt);
  function publish() { ports.update({ seconds: Math.max(0, Math.ceil((due - ports.now()) / 1000)), checking, blocked, timedOut }); }
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
    timeout = ports.later(() => controller?.abort(), PROBE_TIMEOUT_MS);
    try {
      const instance = await ports.probe(controller.signal);
      if (disposed) return;
      timedOut = controller.signal.aborted;
      if (timedOut) return;
      if (instance) {
        blocked = !manual && ports.claimed(instance);
        // A healthy page blocked by loop protection is not a failed poll.
        attempt = -1;
        if (!blocked) {
          // Store before navigating so a persistent render error cannot loop. A storage that refuses
          // the claim cannot guard the loop, so the automatic check stops on the manual reload.
          let stored = true;
          try { ports.claim(instance); } catch { stored = false; }
          blocked = !stored && !manual;
          if (!blocked) { disposed = true; ports.reload(); }
        }
      } else blocked = false;
    } catch {
      // An unavailable server, or the probe bound fired; the countdown checks again.
      timedOut = !disposed && !!controller?.signal.aborted;
    }
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

export async function probeDashboard(fetcher: typeof fetch, url: string, signal: AbortSignal): Promise<string | null> {
  const options = { signal, cache: "no-store" as const };
  async function state() {
    try {
      const response = await fetcher("/__dashboard/state", options);
      if (!response.ok) return null;
      return await response.json() as SupervisorState;
    } catch { return null; }
  }
  const before = await state();
  // Error recovery checks whether the served page works, including a retained build.
  const page = await fetcher(url, { ...options, headers: { Accept: "text/html" } });
  const healthy = page.ok && (page.headers.get("content-type") || "").includes("text/html");
  await page.body?.cancel();
  if (!healthy) return null;
  const after = await state();
  if (before?.instance && after?.instance && before.instance !== after.instance) return null;
  return after?.instance || before?.instance || "direct-dashboard";
}
