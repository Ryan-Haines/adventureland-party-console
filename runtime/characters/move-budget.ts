// The game server disconnects a socket above 200 call cost per 4 seconds, and
// one move costs 2.5 (node/server.js limits.calls, CC.move). The budget keeps
// moves at half that limit whatever the caller does.
// docs/movement-request-budget.md lists the failures it covers.
export const MOVE_WINDOW_MS = 4000, MOVE_LIMIT = 40, SOFT_CALL_COST = 150, CALL_COST_RETRY_MS = 250;
type Move = (x: number, y: number) => Promise<unknown>;
export interface MoveBudgetPorts {
  native: Move; now(this: void): number;
  // The server's current call cost for this socket, from character.cc.
  cc(this: void): number | undefined;
  schedule(this: void, run: () => void, ms: number): unknown; cancel(this: void, handle: unknown): void;
  report(this: void, event: Record<string, unknown>, message: string): void;
}
interface Deferred { x: number; y: number; resolve(this: void, value: unknown): void; reject(this: void, error: unknown): void }
const interrupted = { reason: 'interrupted' };
export function createMoveBudget(ports: MoveBudgetPorts) {
  const issued: number[] = [];
  let pending: Deferred | undefined, timer: unknown, reportedAt = -Infinity, deferred = 0, superseded = 0;
  // Returns 0 when a move may go out now, otherwise the wait in ms.
  function wait(now: number): number {
    // The server keeps calls up to and including 4000 ms old.
    while (issued.length && now - issued[0] > MOVE_WINDOW_MS) issued.shift();
    if (issued.length >= MOVE_LIMIT) return issued[0] + MOVE_WINDOW_MS + 1 - now;
    const cost = ports.cc();
    return typeof cost === 'number' && cost >= SOFT_CALL_COST ? CALL_COST_RETRY_MS : 0;
  }
  function issue(x: number, y: number) { issued.push(ports.now()); return ports.native(x, y); }
  function supersede() {
    if (!pending) return;
    superseded++; pending.resolve(interrupted); pending = undefined;
  }
  function flush() {
    timer = undefined;
    const next = pending;
    if (!next) return;
    const delay = wait(ports.now());
    if (delay > 0) { timer = ports.schedule(flush, delay); return; }
    pending = undefined;
    try { Promise.resolve(issue(next.x, next.y)).then(next.resolve, next.reject); } catch (error) { next.reject(error); }
  }
  function notice(now: number) {
    if (now - reportedAt <= MOVE_WINDOW_MS) return;
    reportedAt = now;
    const cost = ports.cc(), full = issued.length >= MOVE_LIMIT;
    ports.report({ phase: 'Movement request budget reached', at: now, issued: issued.length, deferred, superseded, cc: cost },
      full ? `Movement request budget reached: ${MOVE_LIMIT} moves in ${MOVE_WINDOW_MS / 1000}s; sending only the newest destination`
        : `Movement deferred: server call cost ${cost} of 200`);
  }
  // Native move runs synchronously when the budget allows, so callers still see
  // character.moving change in the same tick.
  function move(x: number, y: number): Promise<unknown> {
    const now = ports.now();
    if (wait(now) === 0) {
      supersede();
      if (timer !== undefined) { ports.cancel(timer); timer = undefined; }
      return issue(x, y);
    }
    deferred++; supersede(); notice(now);
    return new Promise((resolve, reject) => {
      pending = { x, y, resolve, reject };
      timer ??= ports.schedule(flush, wait(now));
    });
  }
  return { move,
    report: () => ({ issued: issued.length, deferred, superseded, pending: !!pending }),
    dispose() {
      if (timer !== undefined) ports.cancel(timer);
      timer = undefined; supersede();
    },
  };
}
