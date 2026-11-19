// The call budget's two background reads ("Rework to the owner bar" B3.3): the Tracktrix request
// and the realm player list. Each asks the budget in the background band when it is due and waits
// for room instead of dropping. Each read is judged in the job band once it has waited one
// window (call-budget.ts `band`), so its readers get data no older than its refresh plus two
// windows, fights included. The Tracktrix read rises too: its cost of 50 never fits the background
// limit while a fight holds the room at its cap. The replies go to characters/shared.js through the install's ports,
// where the tracker catalog and the status report read them.
import type { ServerToClient_player } from 'typed-adventureland';
import type { Band, BudgetSocket, CallBudget } from './call-budget.ts';
import { READ_PICKS } from './call-budget-limits.ts';
import type { ScopeHandle } from '../lifecycle/api.ts';

type Item = { name?: string } | null;
// The game window's tracker render: the native client draws the tracker window with it on every
// reply (js/game.js:3591-3594). caracAL has none.
export interface ReadsWindow { caracAL?: unknown; render_tracker?: (...args: unknown[]) => unknown }
interface ReadsPorts {
  now(): number;
  // The reply's readers in characters/shared.js: the tracker catalog rebuild and the status
  // report's player list.
  tracker?(data: unknown): void;
  players?(names: string[]): void;
}
// What the budget's install hands its reads: its question, the socket it wraps, a listener and a
// stop that leave with the install, the time the window next frees room, and a wait to forget.
interface ReadsInstall {
  calls: Pick<CallBudget, 'band'>;
  socket: BudgetSocket;
  win: ReadsWindow;
  // the call budget owner's `observe` handle: the reads feed the report, as today, through a Pause.
  scope: ScopeHandle;
  items(): Item[];
  listen(event: string, listener: (data: never) => void): void;
  onStop(stop: () => void): void;
  // Each untagged emit's method: the player's own tracker click is one.
  onUntagged(seen: (method: string) => void): void;
  // When a refused background read asks again: the window's next free moment, or the end of the job
  // waits that hold the band, whichever is later.
  nextFree(): number;
  // The largest round trip of the last window (call-budget.ts `marginAt`).
  margin(): number;
  forget(band: Band, method: string): void;
  // Each reply's players with their maps, which the cost table reads for Warcry's reach (3.2).
  roster?(players: RosterEntry[]): void;
}

const carriesTracktrix = (items: Item[] | undefined) => (items || []).some(item => item?.name === 'tracker');

// The realm's player names, as the status report shows them.
function playerNames(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data.map((entry: { name?: unknown } | null) => entry?.name)
    .filter((name): name is string => typeof name === 'string' && !!name && name !== 'Hidden')
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort((a, b) => a.localeCompare(b));
}

// The realm's players with the map each stood on at the reply. A PvP realm hides both
// (server.js:12986-12997), so its entries name no map.
export interface RosterEntry { name: string; map: string }
function playerMaps(data: unknown): RosterEntry[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry: { name?: unknown; map?: unknown } | null) =>
    typeof entry?.name === 'string' && entry.name !== 'Hidden' && typeof entry.map === 'string' ? [{ name: entry.name, map: entry.map }] : []);
}

// The tracker window stays shut for an automatic reply and opens for the player's own request
// (MRG-024's render half). Only the native client draws it.
function quietRender(install: ReadsInstall, now: () => number, quietMs: number, manualMs: number) {
  const win = install.win, render = win.render_tracker;
  if (win.caracAL || typeof render !== 'function') return { automatic() {} };
  let automaticUntil = 0, manualUntil = 0;
  function quietTracker(this: unknown, ...args: unknown[]) {
    if (manualUntil > now()) { manualUntil = 0; return render!.apply(this, args); }
    if (automaticUntil > now()) return undefined;
    return render!.apply(this, args);
  }
  win.render_tracker = quietTracker;
  install.onUntagged(method => { if (method === 'tracker') manualUntil = now() + manualMs; });
  install.onStop(() => { if (win.render_tracker === quietTracker) win.render_tracker = render; });
  return { automatic() { automaticUntil = now() + quietMs; } };
}

// One read: due or not, its timer, and its question. A due read asks on each pump until the
// budget answers `send`; the pump runs on its timer, on every player packet and when the window
// next frees room.
function read(install: ReadsInstall, method: 'tracker' | 'players', now: () => number, sent: () => void) {
  const scope = install.scope;
  let due = false, timer: number | undefined, waiting: number | undefined;
  const clearWaiting = () => { if (waiting !== undefined) { scope.clearTimeout(waiting); waiting = undefined; } };
  const self = {
    get due() { return due; },
    pump(): void {
      clearWaiting();
      if (!due) return;
      const calls = install.calls, data = method === 'players' ? {} : undefined;
      if (calls.band({ band: 'background', method, data }) === 'send') {
        due = false;
        if (data === undefined) install.socket.emit('tracker');
        else install.socket.emit('players', data);
        sent();
        return;
      }
      // Not now: ask again when the window next frees room, or on the next player packet.
      waiting = scope.setTimeout(() => { waiting = undefined; self.pump(); }, Math.max(1, install.nextFree() - now()));
    },
    // Due at once, or after `delay`.
    at(delay: number): void {
      if (timer !== undefined) scope.clearTimeout(timer);
      timer = undefined;
      if (delay <= 0) { due = true; self.pump(); return; }
      timer = scope.setTimeout(() => { timer = undefined; due = true; self.pump(); }, delay);
    },
    cancel(): void {
      if (timer !== undefined) scope.clearTimeout(timer);
      timer = undefined; due = false;
      clearWaiting();
      install.forget('background', method);
    },
  };
  return self;
}

// The Tracktrix reply the kill counts are kept on: `monsters` by monster type.
type TrackerReply = { monsters?: Record<string, number> };
// The credited character's `kill_credit` (node/server.js:2778, 2831, 2872 at the game pin).
type KillCredit = { mtype?: unknown };

// installBudgetReads starts both reads on one install of the budget; they stop with it.
export function installBudgetReads(install: ReadsInstall, ports: ReadsPorts): void {
  const refreshMs = READ_PICKS.callTrackerRefreshMs, playersMs = READ_PICKS.callPlayersEveryMs;
  const now = ports.now, render = quietRender(install, now, READ_PICKS.callTrackerQuietMs, READ_PICKS.callTrackerManualMs);
  // The server answers `tracker` inside its handler or not at all (node/server.js:5523-5537), so a
  // reply not back one margin after the request is lost. The read asks again then, once, and every
  // later request waits the refresh. A reply resets it.
  let held = carriesTracktrix(install.items()), retried = false, last: TrackerReply | null = null;
  const tracker = read(install, 'tracker', now, () => {
    render.automatic();
    tracker.at(retried ? refreshMs : install.margin());
    retried = true;
  });
  const players = read(install, 'players', now, () => {});
  // Read the packet, not character.items: the game may apply it after this listener.
  const onPlayer = (data: Partial<Pick<ServerToClient_player, 'items'>> | null) => {
    if (data && Array.isArray(data.items)) {
      const holds = carriesTracktrix(data.items as Item[]);
      if (!holds && held) tracker.cancel();
      else if (holds && !held) { retried = false; tracker.at(0); }
      held = holds;
    }
    tracker.pump(); players.pump();
  };
  const onTracker = (data: unknown) => {
    if (held) { retried = false; tracker.at(refreshMs); }
    last = data && typeof data === 'object' ? data as TrackerReply : null;
    ports.tracker?.(data);
  };
  // The server raises the credited character's `stats.monsters[mtype]` by 1 after each
  // `kill_credit` (node/server.js:2799), and the budget raises the last reply the same way, so the
  // kill counts stay current with no read. That reply is the object every `tracker` listener got:
  // the native client's `tracker` (js/game.js:3591-3594) and the catalog's `trackerDropData`
  // (characters/shared.js `trackerCatalogListener`), so both read the raised count. The socket
  // delivers in order: a credit the server handled before a request raises the old reply, which
  // the new one replaces. `monsters_diff` steps by the server's `score` (:2800), which the packet
  // does not carry, so it waits for the next reply.
  const onKillCredit = (data: KillCredit | null) => {
    const monsters = last?.monsters, mtype = data?.mtype;
    if (!monsters || typeof mtype !== 'string') return;
    monsters[mtype] = (Number(monsters[mtype]) || 0) + 1;
  };
  const onPlayers = (data: unknown) => { install.roster?.(playerMaps(data)); ports.players?.(playerNames(data)); };
  // Each listener is registered by name on the call budget owner's handle, so owner:check sees it in the budget's module.
  const socket = install.socket;
  const scope = install.scope, on = (event: string, listener: (data: never) => void) => scope.on(socket, event, listener as (data: unknown) => void);
  on('player', onPlayer as (data: never) => void);
  on('tracker', onTracker as (data: never) => void);
  on('players', onPlayers as (data: never) => void);
  on('kill_credit', onKillCredit as (data: never) => void);
  install.listen('player', onPlayer as (data: never) => void);
  install.listen('tracker', onTracker as (data: never) => void);
  install.listen('players', onPlayers as (data: never) => void);
  install.listen('kill_credit', onKillCredit as (data: never) => void);
  const every = scope.setInterval(() => players.at(0), playersMs);
  install.onStop(() => { scope.clearInterval(every); tracker.cancel(); players.cancel(); });
  if (held) tracker.at(0);
  players.at(0);
}
