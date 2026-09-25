import type { Point, Step } from '../navigation/contracts.ts';
import type { MovementHost, NativeFunctions } from './movement-host.ts';
/** Only this adapter touches the game's planner globals. It never runs the native walker. */
export function createNativePlanner(host: MovementHost, native: NativeFunctions) {
  let running = false, failure = '', deadline = 0, serial = 0, limit = 30000;
  function cancel() { running = false; serial++; void Promise.resolve(native.stop('smart')).catch(() => {}); }
  function begin(destination: Point, town: boolean, now: number, timeout = 30000) {
    cancel(); failure = ''; limit = timeout; deadline = now + timeout;
    const token = serial;
    const promise = native.move(destination);
    void promise.catch(error => { if (running && token === serial) failure = String(error?.reason || error); });
    host.smart.use_town = town; running = true;
  }
  function tick(now: number): Step[] | undefined {
    if (!running) throw Error('Native search not initialized');
    if (failure || now >= deadline) { const reason = failure || `Native planning timed out (${limit / 1000} seconds)`; cancel(); throw Error(reason); }
    if (!host.smart.searching) native.start(); else if (!host.smart.found) native.next();
    if (!host.smart.moving && !host.smart.found) throw Error('Native planner found no route');
    if (!host.smart.found) return;
    const plot = host.smart.plot.map(p => ({ ...p }));
    cancel(); return plot;
  }
  return { begin, tick, cancel };
}
