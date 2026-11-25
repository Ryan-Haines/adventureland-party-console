// The run scope, the one character gate (L1.3 with Check fix pass K-B1 and K-B2, LIF-W1 decided A19).
// Every timer, listener, sleep, fetch and ajax call an owner makes on the character goes through its
// handle from `scope(owner, kind)`, in a native CODE frame as in a headless one. The handle records each
// registration, so `dispose` removes every one of the generation whatever the frame state, and the next
// generation disposes the last one it finds on the game window.
//
// Table P (rules.ts `runRow`) decides when the character is held. While it is held or starting:
// - a due `act` one-shot (a `setTimeout`, a `sleep`, a microtask) is held and fires at release, in its
//  due order, so every `await sleep` resumes after Play and every `finally` runs;
// - a due `act` interval tick is held as one pending tick and fires once at release;
// - a game event handler of kind `act` is not called: the event's state stays in the game client and
//  the owner reads it on its next pass;
// - `observe` registrations run: the report timer, the reply apply, the loader poll, the telemetry.
// The kind rule: a registration is `act` when its callback decides, or makes or asks for a game
// call, and `observe` when it only records game state or reports.
//
// The cadence: decisions follow the game's state update, because there is nothing new to decide on
// between updates. The game applies the world packets it buffered at each draw (game.js `draw` runs
// `process_entities`), and it draws at least every 250 ms while code runs (game.js:276, `if
// ((code_run || sound_sfx) && mssince(last_draw) > 250) draw`). So an `act` listener whose
// callback takes no packet, a decision on the game's state, runs once after the next draw's update
// lands, however many packets of that update woke it; `afterUpdate` puts a timer's wake into the
// same pass. A listener that takes its packet records it and runs on every packet, as does every
// `observe` registration. A send a decision makes still goes at once.
import { COORDINATOR_ROW, runRow, type RunRow } from '../rules.ts';
import { CHARACTER_PICKS } from '../fields.ts';

export type Kind = 'act' | 'observe';
type Callback = (...args: unknown[]) => unknown;
type Id = number;
/** A game socket, the game window or any emitter with `on` and `off`. */
export interface Emitter {
  on?(event: string, listener: Callback): unknown;
  once?(event: string, listener: Callback): unknown;
  off?(event: string, listener: Callback): unknown;
  removeListener?(event: string, listener: Callback): unknown;
  addEventListener?(event: string, listener: Callback): unknown;
  removeEventListener?(event: string, listener: Callback): unknown;
}
interface Request { abort(): void; always(callback: () => void): unknown }
export interface ScopeHandle {
  setTimeout(callback: Callback, ms?: number, ...args: unknown[]): Id;
  setInterval(callback: Callback, ms: number, ...args: unknown[]): Id;
  clearTimeout(id: Id | null | undefined): void;
  clearInterval(id: Id | null | undefined): void;
  sleep(ms: number): Promise<void>;
  /** A bound on a game promise: it rejects with "<label> timed out after N seconds" once `bound` ms pass,
   *  after calling `fired`, which a kept bound uses to tell the status owner's bound record. */
  withTimeout<T>(promise: T | Promise<T>, bound: number, label: string, fired?: () => void): Promise<T>;
  queueMicrotask(callback: () => void): void;
  /** The callback on the game's next draw frame (`draw_trigger`), which a dispose drops. */
  afterDraw(callback: () => void): void;
  /** The callback once, after the game's next state update lands (the cadence above): a callback
   *  asked for again before then runs once. */
  afterUpdate(callback: () => void): void;
  on(target: Emitter | null | undefined, event: string, listener: Callback): void;
  once(target: Emitter | null | undefined, event: string, listener: Callback): void;
  off(target: Emitter | null | undefined, event: string, listener: Callback): void;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  ajax(options: Record<string, unknown>): Request;
}
interface Frame {
  __partyRuntimeGeneration?: number;
  setTimeout(callback: () => void, ms?: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(callback: () => void, ms?: number): unknown;
  clearInterval(id: unknown): void;
  fetch?: typeof fetch;
  $?: { ajax(options: Record<string, unknown>): Request };
}
interface Listening { target: Emitter; event: string; listener: Callback; wrapped: Callback }
interface Due { at: number; order: number; fire(): void }
interface RunPorts {
  /** The CODE frame, whose timers and network calls the handles use. */
  frame: Frame;
  /** The game window, which outlives a native CODE frame: it keeps the live scope. */
  game: GameWindow;
  name(): string;
  /** The tasks owner's hold field from the last status reply (`user`, `pause`, `manual` or none). */
  hold(): string | null | undefined;
  /** The realm's hook registry: `lifecycle.holdChanged` and `report.sent`. */
  notify(hook: 'lifecycle.holdChanged' | 'report.sent', payload: Record<string, unknown>): void;
}
interface GameWindow { __partyRunScope?: { scope(owner: string, kind: Kind): ScopeHandle; dispose(): void }; draw_trigger?(callback: () => void): void; in_draw?: boolean }

/** `lifecycle.scope(owner)` (part 3): the owner's handle on this
 *  generation's run scope, which shared.js creates on the game window before any owner installs. The
 *  kind is the one the owner's install declares. */
export function scope(owner: string, kind: Kind): ScopeHandle {
  const live = (globalThis as { parent?: GameWindow }).parent?.__partyRunScope;
  if (!live) throw Error(`No run scope for ${owner}: shared.js creates it before any owner installs`);
  return live.scope(owner, kind);
}

// The handles, parts, stop and dispose that the character's and the coordinator's runs share. `row`
// is table P's answer for the run; `ended` runs once at dispose.
// `draw` is the game window's draw frame; the coordinator has none, so its handles have no afterDraw.
function createRegistry(frame: Frame, row: () => RunRow, ended: () => void, draw?: (callback: () => void) => void) {
  const native = new Map<Id, { clear(): void }>();
  const listening: Listening[] = [];
  const requests = new Set<Request>();
  const abort = new AbortController();
  let disposed = false, nextId = 1, order = 0;
  // The `act` one-shots that came due while held, and the intervals with a held tick.
  let held: Due[] = [];
  const pendingTicks = new Map<Id, Due>();
  // The draw-frame callbacks not yet run; a dispose empties it, so the frame runs none of them.
  const draws = new Set<() => void>();
  // The decisions waiting for the game's next state update, each once, with whether an `act` handle
  // asked for it, and whether the update's draw callback is registered.
  const updates = new Map<Callback, boolean>();
  let updateArmed = false;
  // The update's decisions run after the draw's task, once `process_entities` has applied the
  // packets: the draw callback runs at the frame's start (functions.js `draw_timeouts_logic(2)`),
  // and the microtask after the draw returns. A held `act` decision waits for Play like a one-shot.
  // The coordinator has no draw and no game update, so its decisions run at once.
  function afterUpdate(callback: Callback, acts: boolean): void {
    if (disposed) return;
    if (!draw) { if (!(acts && gated())) callback(); return; }
    updates.set(callback, acts || !!updates.get(callback));
    if (updateArmed) return;
    updateArmed = true;
    const entry = () => {
      if (!draws.delete(entry)) return;
      globalThis.queueMicrotask(runUpdate);
    };
    draws.add(entry);
    draw(entry);
  }
  function runUpdate(): void {
    updateArmed = false;
    const due = [...updates];
    updates.clear();
    for (const [callback, acts] of due) {
      if (disposed) return;
      if (acts && gated()) { held.push({ at: Date.now(), order: order++, fire: () => { if (!disposed) callback(); } }); continue; }
      // One decision's error goes to the page's error report and leaves the update's other decisions to run.
      try { callback(); } catch (error) { globalThis.queueMicrotask(() => { throw error; }); }
    }
  }

  const gated = () => row() !== 'running';
  function release(): void {
    const due = [...held, ...pendingTicks.values()].sort((a, b) => a.at - b.at || a.order - b.order);
    held = []; pendingTicks.clear();
    for (const entry of due) { if (disposed || gated()) { held.push(entry); continue; } entry.fire(); }
  }

  // `owner` names the registering owner at the call site, where owner:check's loops rule reads it.
  function scope(owner: string, kind: Kind): ScopeHandle {
    const acts = kind === 'act';
    const run = (callback: Callback, args: unknown[]) => { if (!disposed) callback(...args); };
    function oneShot(callback: Callback, ms: number, args: unknown[]): Id {
      const id = nextId++, at = Date.now() + Math.max(0, ms);
      const fire = () => { native.delete(id); run(callback, args); };
      const handle = frame.setTimeout(() => {
        if (acts && gated()) { native.delete(id); held.push({ at, order: order++, fire }); return; }
        fire();
      }, ms);
      native.set(id, { clear: () => { frame.clearTimeout(handle); held = held.filter(entry => entry.fire !== fire); } });
      return id;
    }
    function interval(callback: Callback, ms: number, args: unknown[]): Id {
      const id = nextId++;
      // One fire per interval, so a tick a release held again leaves `held` when the interval clears.
      const fire = () => run(callback, args);
      const handle = frame.setInterval(() => {
        if (acts && gated()) { if (!pendingTicks.has(id)) pendingTicks.set(id, { at: Date.now(), order: order++, fire }); return; }
        run(callback, args);
      }, ms);
      native.set(id, { clear: () => { frame.clearInterval(handle); pendingTicks.delete(id); held = held.filter(entry => entry.fire !== fire); } });
      return id;
    }
    function clear(id: Id | null | undefined): void { if (id == null) return; native.get(id)?.clear(); native.delete(id); }
    function listen(target: Emitter | null | undefined, event: string, listener: Callback, once: boolean): void {
      if (!target || disposed) return;
      // A decision on the game's state (the cadence above): an `act` callback that takes no packet.
      const decides = acts && listener.length === 0;
      const entry: Listening = { target, event, listener, wrapped: (...values: unknown[]) => {
        if (once) unlisten(entry);
        if (disposed || acts && gated()) return;
        if (decides) { afterUpdate(listener, true); return; }
        return listener(...values);
      } };
      listening.push(entry);
      if (target.on) target.on(event, entry.wrapped); else target.addEventListener?.(event, entry.wrapped);
    }
    return {
      setTimeout: (callback, ms = 0, ...args) => oneShot(callback, ms, args),
      setInterval: (callback, ms, ...args) => interval(callback, ms, args),
      clearTimeout: clear,
      clearInterval: clear,
      sleep: ms => new Promise<void>(resolve => { oneShot(resolve as Callback, ms, []); }),
      // The bound is a one-shot of the caller's handle, so an `act` bound waits out a Pause.
      withTimeout: <T>(promise: T | Promise<T>, bound: number, label: string, fired?: () => void) => new Promise<T>((resolve, reject) => {
        let settled = false;
        const timeout = oneShot(() => {
          if (settled) return;
          settled = true;
          fired?.();
          reject(new Error(label + " timed out after " + Math.round(bound / 1000) + " seconds"));
        }, bound, []);
        Promise.resolve(promise).then(value => {
          if (settled) return;
          settled = true; clear(timeout); resolve(value);
        }, error => {
          if (settled) return;
          settled = true; clear(timeout); reject(error);
        });
      }),
      // A microtask from an `act` callback is held like a one-shot due now.
      queueMicrotask: callback => {
        if (!acts) { globalThis.queueMicrotask(() => run(callback, [])); return; }
        const at = Date.now(), entry: Due = { at, order: order++, fire: () => run(callback, []) };
        globalThis.queueMicrotask(() => { if (gated()) held.push(entry); else entry.fire(); });
      },
      // A draw callback from an `act` handle is held like a one-shot due at its frame.
      afterDraw: callback => {
        if (!draw) throw Error(`${owner}'s afterDraw: the coordinator run has no draw frame`);
        if (disposed) return;
        const entry = () => {
          if (!draws.delete(entry)) return;
          if (acts && gated()) held.push({ at: Date.now(), order: order++, fire: () => run(callback, []) });
          else run(callback, []);
        };
        draws.add(entry);
        draw(entry);
      },
      afterUpdate: callback => afterUpdate(callback as Callback, acts),
      on: (target, event, listener) => listen(target, event, listener, false),
      once: (target, event, listener) => listen(target, event, listener, true),
      off: (target, event, listener) => {
        const entry = listening.find(item => item.target === target && item.event === event && item.listener === listener);
        if (entry) unlisten(entry);
      },
      fetch: (input, init) => {
        const fetcher = frame.fetch ?? globalThis.fetch;
        const signals = [abort.signal, ...(init?.signal ? [init.signal] : [])];
        return fetcher(input, { ...init, signal: anySignal(signals) });
      },
      ajax: options => {
        const request = frame.$!.ajax(options);
        requests.add(request);
        request.always(() => requests.delete(request));
        return request;
      },
    };
  }
  function unlisten(entry: Listening): void {
    const index = listening.indexOf(entry);
    if (index >= 0) listening.splice(index, 1);
    const { target, event, wrapped } = entry;
    if (target.off) target.off(event, wrapped);
    else if (target.removeListener) target.removeListener(event, wrapped);
    else target.removeEventListener?.(event, wrapped);
  }

  // The run's start and stop: each owner's part in the order it was added. Stop runs every
  // part's own end while the frame still reaches the socket, then disposes every registration,
  // so no part clears its own timers or listeners.
  const parts: { start?(): void; stop?(): void }[] = [];
  let started = false;
  function start(): void { if (started || disposed) return; started = true; for (const part of parts) part.start?.(); }
  function stop(): void { if (disposed) return; for (const part of parts) part.stop?.(); dispose(); }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    abort.abort();
    for (const request of requests) request.abort();
    requests.clear();
    for (const timer of native.values()) timer.clear();
    native.clear(); held = []; pendingTicks.clear(); draws.clear(); updates.clear();
    for (const entry of [...listening]) unlisten(entry);
    ended();
  }
  return { scope, gated, release, start, stop, dispose, retired: abort.signal, disposed: () => disposed,
    part: (part: { start?(): void; stop?(): void }) => { parts.push(part); } };
}

export function createRunScope(ports: RunPorts) {
  // The previous generation's scope, live on the game window if its frame was replaced without `stop`.
  ports.game.__partyRunScope?.dispose();
  // This CODE generation. The loader moves the frame's generation on at each install and dispose, so a
  // callback from a replaced generation reads itself not current.
  const generation = ports.frame.__partyRuntimeGeneration = (Number(ports.frame.__partyRuntimeGeneration) || 0) + 1;
  let answered = false, row: RunRow = 'starting';
  // The game's draw_trigger runs a callback at once while a draw frame is on (`in_draw`), so a
  // callback registered from inside a frame waits here until the frame's task ends and then goes to
  // the next frame. A callback that registers its successor would otherwise run again inside the
  // same frame until the stack overflows. `in_draw` still set in the microtask means the game's draw
  // threw out of its frame; the callbacks then wait for the next registration.
  const nextFrame: (() => void)[] = [];
  let handing = false;
  function handOver(): void {
    handing = false;
    if (ports.game.in_draw) return;
    for (const callback of nextFrame.splice(0)) ports.game.draw_trigger!(callback);
  }
  const run = createRegistry(ports.frame, () => row, () => { if (ports.game.__partyRunScope === live) delete ports.game.__partyRunScope; },
    callback => {
      nextFrame.push(callback);
      if (!ports.game.in_draw) handOver();
      else if (!handing) { handing = true; globalThis.queueMicrotask(handOver); }
    });

  // Table P on each status reply: the first reply ends P2, and the tasks owner's hold field decides from then on.
  function update(): void {
    if (run.disposed()) return;
    const before = row;
    row = runRow({ answered, hold: ports.hold() });
    if (run.gated() === (before !== 'running')) return;
    const by = ports.hold() || 'core:lifecycle';
    ports.notify('lifecycle.holdChanged', { character: ports.name(), held: run.gated(), by });
    if (!run.gated()) run.release();
  }

  // The report timer: an observer, so it keeps its period while the character is held, and each
  // report sends the lifecycle owner's `report.sent` notice, which the turns owner's role loop
  // backstop and movement's report waits read. Each notice carries the run's report
  // count as its `sequence`, so a listener reads one notice per report, in order.
  const reports = run.scope('13', 'observe');
  let sequence = 0;
  function startReports(report: () => void): Id {
    return reports.setInterval(() => { report(); ports.notify('report.sent', { character: ports.name(), sequence: ++sequence, by: 'core:lifecycle' }); },
      CHARACTER_PICKS.lifecycleReportMs);
  }

  const live = {
    scope: run.scope,
    startReports,
    generation,
    /** Aborts when this generation is disposed: a wait on the generation ends with it. */
    retired: run.retired,
    /** Whether this generation still owns the frame. */
    current: () => !run.disposed() && Number(ports.frame.__partyRuntimeGeneration) === generation && !!ports.game,
    part: run.part,
    start: run.start,
    stop: run.stop,
    /** Table P: whether the character is held or starting. */
    held: run.gated,
    /** A status reply answered; table P re-reads the tasks owner's hold field. */
    replied(): void { answered = true; update(); },
    /** The hold field changed outside a reply (the reply applies it after this call otherwise). */
    update,
    dispose: run.dispose,
  };
  ports.game.__partyRunScope = live;
  return live;
}

/** The coordinator's run (table P's P0 row, rules.ts COORDINATOR_ROW): the coordinator has no hold
 *  and no first reply, so no tick is held and no holdChanged notice goes out. The root hands each
 *  owner `scope(owner, kind)`, and the shutdown's `stopRun` ends every part and registration before
 *  storage closes (start.ts createShutdown). */
export function createCoordinatorRun(frame: Frame) {
  const run = createRegistry(frame, () => COORDINATOR_ROW, () => {});
  return { scope: run.scope, part: run.part, stop: run.stop };
}

// The headless runner's facade (moved from runner-scope.ts): character/host.ts wraps the game context in
// it. The run scope above records every timer, listener and request of the generation, in a headless frame
// as in a native one, so the facade records none. It gives the generation a view of the game that turns
// into reads only at retirement: each later call or write throws RetiredRunnerError. A removal (`off`,
// `removeListener`, `remove`, `clearTimeout`, `clearInterval`) is no game effect and still runs, so the
// run scope ends its registrations whether it disposes before or after the facade retires.
/** A CODE generation may read game state, but loses all effects on retirement. */
export class RetiredRunnerError extends Error {
  constructor() {
    super("CODE generation has been retired");
    this.name = "RetiredRunnerError";
  }
}

type Callable = (...args: unknown[]) => unknown;
type Host = Record<PropertyKey, unknown>;
const REMOVALS = new Set<PropertyKey>(["off", "removeListener", "remove", "clearTimeout", "clearInterval"]);

export class RunnerScope {
  private readonly facades = new WeakMap<object, object>();
  private readonly receivers = new WeakMap<object, object>();
  private retired = false;

  assertActive(): void {
    if (this.retired) throw new RetiredRunnerError();
  }

  private method(host: Host, key: PropertyKey): Callable {
    const removal = REMOVALS.has(key);
    const invoke = (receiver: unknown, args: unknown[]) => {
      if (!removal) this.assertActive();
      const result = Reflect.apply(host[key] as Callable,
        receiver == null ? host : this.unwrapReceiver(receiver), args);
      return result === host ? this.facade(host) : result;
    };
    return function (this: unknown, ...args: unknown[]) { return invoke(this, args); };
  }

  private unwrapReceiver(receiver: unknown): unknown {
    if (typeof receiver === "object" && receiver !== null)
      return this.receivers.get(receiver) ?? receiver;
    return receiver;
  }

  /** Only effect-bearing roots need proxies; large, frequently read G/entities stay shared. */
  facade<T extends object>(target: T): T {
    const cached = this.facades.get(target);
    if (cached) return cached as T;
    const host = target as Host;
    // An empty target avoids violating non-configurable Window property invariants.
    const facade = new Proxy(Object.create(null) as T, {
      get: (_target, key) => {
        const value = Reflect.get(host, key, host);
        if (value === target) return facade;
        if (typeof value === "function") return this.method(host, key);
        if (
          value &&
          typeof value === "object" &&
          ["socket", "character", "caracAL", "parent", "top", "window"].includes(String(key))
        )
          return this.facade(value);
        return value;
      },
      set: (_target, key, value) => {
        this.assertActive();
        return Reflect.set(host, key, value, host);
      },
      has: (_target, key) => key in host,
      ownKeys: () => Reflect.ownKeys(host),
      getOwnPropertyDescriptor: (_target, key) =>
        key in host
          ? {
              configurable: true,
              enumerable: true,
              writable: true,
              value: Reflect.get(host, key, host),
            }
          : undefined,
    });
    this.facades.set(target, facade);
    this.receivers.set(facade, target);
    return facade;
  }

  dispose(): void {
    this.retired = true;
  }
}

// caracAL evaluates CODE in a jsdom 24 window, whose AbortSignal has only
// abort() and timeout(). Browsers and Node have AbortSignal.any, but Node's
// rejects a jsdom signal, which reaches the run scope's `fetch` handle from CODE.
type SignalHost = typeof AbortSignal & { any?: (signals: AbortSignal[]) => AbortSignal };

/** One signal that aborts with the reason of the first input that aborts. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const host = AbortSignal as SignalHost;
  if (typeof host.any === "function" && signals.every((signal) => signal instanceof AbortSignal))
    return host.any(signals);
  if (signals.length === 1) return signals[0];
  const controller = new AbortController();
  const listeners: [AbortSignal, () => void][] = [];
  const settle = (source: AbortSignal) => {
    // The first abort removes every listener, so the long-lived loader and
    // lifecycle signals do not keep one closure per finished request.
    for (const [signal, listener] of listeners) signal.removeEventListener("abort", listener);
    listeners.length = 0;
    controller.abort(source.reason);
  };
  for (const signal of signals) {
    if (signal.aborted) {
      settle(signal);
      break;
    }
    const listener = () => settle(signal);
    listeners.push([signal, listener]);
    signal.addEventListener("abort", listener, { once: true });
  }
  return controller.signal;
}
/** A request's kept bound (bigcheck/bounds.md): `signal` ends the request at `ms` or with `owner`. The
 *  caller calls `ended` when the request fails, and `fired` runs if the bound, not the owner, ended it,
 *  so the caller tells the status owner's bound record. */
export function requestBound(owner: AbortSignal, ms: number, fired: () => void): { signal: AbortSignal; ended(): void } {
  const bound = AbortSignal.timeout(ms);
  return { signal: anySignal([owner, bound]), ended: () => { if (bound.aborted && !owner.aborted) fired(); } };
}
