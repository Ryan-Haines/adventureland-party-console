import type { BridgeReply } from "./bridge.ts";
import { lifecycleSavedFields } from "../fields.ts";
import { boundFired } from "../../status/api.ts";
import { codeStopped, codeStoppedKey } from "../rules.ts";
import { gameRealm } from '../../protocol/realm.ts';

// The recovery's restart waits and its attempts bound (fields.ts, bigcheck/bounds.md).
const pick = lifecycleSavedFields.settings;
const firstWait = () => pick.steamRecoveryFirstMs.default;

export interface GameWindow {
  document: Document;
  character?: { name: string };
  socket?: { connected: boolean };
  server_region?: string;
  server_identifier?: string;
  code_active?: boolean;
  event?: Event;
  start_runner?: (id?: string, code?: string) => void;
  stop_runner?: (id?: string) => void;
  __partyStatusSuccessAt?: number;
  __partyLoaderRuntimeStartedAt?: number;
  sharedRoutine?: { canReload(): boolean };
}
interface RecoveryState { since: number; next: number; attempts: number; healthy: number; connected: boolean }
function runner(game: GameWindow): GameWindow | null {
  return (game.document.getElementById("maincode") as HTMLIFrameElement | null)?.contentWindow as unknown as GameWindow | null;
}
// The lifecycle owner's drain says whether a reload would cut work (character/drain.ts `canReload`, N3).
function occupied(code: GameWindow | null): boolean {
  return !!code?.sharedRoutine && !code.sharedRoutine.canReload();
}
function stale(game: GameWindow, state: RecoveryState, now: number): boolean {
  const code = runner(game);
  const last = Math.max(code?.__partyStatusSuccessAt || 0, code?.__partyLoaderRuntimeStartedAt || state.since);
  // A running CODE is stale once its last successful report is `steamRunnerStaleMs` old, the
  // lifecycle owner's declared wait (fields.ts).
  return now >= state.next && !occupied(code) && (!game.code_active || now - last >= pick.steamRunnerStaleMs.default);
}

/** Lives in the primary game window, independently of every CODE iframe. */
export function createSteamRecovery(host: GameWindow & { localStorage: Storage }, bootstrap: string,
  persist: (name: string) => Promise<string>, log: (message: string) => void) {
  const states = new Map<string, RecoveryState>();
  const restores: (() => void)[] = [];
  const observed = new WeakMap<GameWindow, { start: GameWindow['start_runner']; stop: GameWindow['stop_runner'] }>();
  let suspended = false, disposed = false, running = false;
  let latest: BridgeReply | undefined;
  function observe(game: GameWindow) {
    const previous = observed.get(game);
    if (previous && previous.start === game.start_runner && previous.stop === game.stop_runner) return;
    for (const method of ["start_runner", "stop_runner"] as const) {
      const original = game[method];
      if (!original) continue;
      const wrapped = function (id?: string, code?: string) {
        const name = game.character?.name;
        const event = game.event || host.event;
        const trusted = name && event?.isTrusted && /^(click|keydown|keyup|keypress)$/.test(event.type);
        if (trusted) {
          const stopped = method === "stop_runner";
          host.localStorage.setItem(codeStoppedKey(name), stopped ? "1" : "0");
          log(name + (stopped ? ": manual Disengage" : ": manual Engage"));
        }
        const result = original.call(game, id, code);
        if (trusted) void persist(name).catch(error => log(name + ": autorun persistence failed: " + String(error)));
        return result;
      };
      game[method] = wrapped;
      restores.push(() => { if (game[method] === wrapped) game[method] = original; });
    }
    observed.set(game, { start: game.start_runner, stop: game.stop_runner });
  }
  // Native logout uses socket.emit("leave") directly. Observe its existing control.
  const logout = (event: Event) => {
    if (!event.isTrusted) return;
    const target = event.target as Element | null;
    const action = target?.closest?.('[onclick]')?.getAttribute('onclick') || '';
    if (/socket\.emit\(\s*["']leave["']|\blogout\s*\(/.test(action)) suspended = true;
  };
  host.document.addEventListener("click", logout, true);
  observe(host);
  function gameFor(name: string): GameWindow | null {
    if (name === host.character?.name) return host;
    const frame = host.document.getElementById("ichar" + name.toLowerCase()) as HTMLIFrameElement | null;
    return frame?.contentWindow as unknown as GameWindow | null;
  }
  function allowed(name: string) {
    if (!latest || disposed || suspended || !host.socket?.connected) return false;
    return owned(name, latest) && !codeStopped(host.localStorage, name);
  }
  // With no handoff running, the primary window owns its Steam members; a released multi-character
  // handoff belongs to the window that holds it, whatever the coordinator names primary meanwhile.
  function owned(name: string, reply: BridgeReply) {
    if (!reply.steam?.includes(name)) return false;
    const op = reply.operation;
    if (!op || op.phase === "complete") return reply.primary === host.character?.name;
    return confirmedArrival(name, reply);
  }
  function confirmedArrival(name: string, reply: BridgeReply) {
    const op = reply.operation!;
    // Release was authoritatively confirmed before ownership was assigned to
    // Steam. Repair only an existing connected CODE frame, never a login or
    // ownership transfer. Otherwise a stale runner deadlocks failed arrivals.
    if (!op.releasedAt || !op.multi || !["navigate", "failed"].includes(op.phase)) return false;
    if (op.multi.primary !== host.character?.name || !op.multi.desired.includes(name)) return false;
    if (reply.primary && reply.primary !== op.multi.primary) return false;
    const game = gameFor(name);
    return !!op.destinationRealm && !!game &&
      gameRealm(game.server_region, game.server_identifier) === op.destinationRealm;
  }
  function observeState(name: string, game: GameWindow, now: number): RecoveryState {
      let state = states.get(name);
      if (!state) {
        state = { since: now, next: now + firstWait(), attempts: 0, healthy: 0, connected: true };
        states.set(name, state);
      }
      if (!game.socket?.connected) {
        if (state.connected) log(name + ": game connection lost (window present)");
        state.connected = false; state.next = now + firstWait();
        return state;
      }
      state.connected = true;
      const code = runner(game);
      const healthy = code?.__partyStatusSuccessAt || 0;
      if (healthy > state.healthy) {
        if (state.attempts) log(name + ": recovery healthy status received");
        state.healthy = healthy; state.attempts = 0; state.since = now;
      }
      return state;
  }
  async function restart(name: string, game: GameWindow, state: RecoveryState, now: number) {
      state.attempts++;
      state.next = now + Math.min(pick.steamRecoveryMaxMs.default, firstWait() * 2 ** (state.attempts - 1));
      log(name + ": recovery attempt " + state.attempts + (game.code_active ? " (CODE status stale)" : " (unexpected CODE inactivity)"));
      const bound = pick.steamRecoveryAttemptsBound.default;
      if (state.attempts >= bound) log(name + ": prolonged recovery failure; game window present, healthy CODE status missing");
      // The bound trips once per run of failed restarts, at the attempt that reaches it; the bridge's
      // next report carries the firing to the status owner's bound record.
      // A running CODE's silence past `steamRunnerStaleMs` is a kept bound too: it trips once, at the
      // first restart of the run, and the healthy report that ends the run starts the count again.
      if (state.attempts === 1 && game.code_active) boundFired({ bound: 'steamRunnerStaleMs', owner: '13', subject: name, state: { ms: pick.steamRunnerStaleMs.default } });
      if (state.attempts === bound) boundFired({ bound: 'steamRecoveryAttemptsBound', owner: '13', subject: name, state: { attempts: state.attempts, codeActive: !!game.code_active } });
      try {
        await persist(name);
        if (!allowed(name) || !game.socket?.connected) return;
        game.start_runner?.("maincode", bootstrap);
        // start_runner writes native persistence; restore managed autorun afterward.
        await persist(name);
      } catch (error) { log(name + ": recovery failed: " + String(error)); }
  }
  async function recover(reply: BridgeReply) {
    for (const name of reply.steam || []) {
      const game = gameFor(name);
      if (!game || game.character?.name !== name) continue;
      observe(game);
      const now = Date.now(), state = observeState(name, game, now);
      if (!allowed(name)) { state.next = now + firstWait(); continue; }
      if (state.connected && stale(game, state, now)) await restart(name, game, state, now);
    }
  }
  return { async tick(reply: BridgeReply) {
    latest = reply;
    if (running || disposed) return;
    running = true;
    try { await recover(reply); } finally { running = false; }
  },
  dispose() {
    disposed = true;
    host.document.removeEventListener("click", logout, true);
    for (const restore of restores) restore();
  } };
}
