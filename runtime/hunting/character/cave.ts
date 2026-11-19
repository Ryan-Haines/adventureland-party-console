// The character's Cave of Many Dreams runtime: the action journal, the correlated interaction request and the dungeon
// runtime that receives the coordinator's control and runs one journaled command at a time
//, and the client install.ts installs: ownership, the floor's party, the chest
// loot and the runtime's game and walk ports. Moved from
// runtime/characters/dungeon-journal.ts, cave-request.ts, dungeons.ts and shared.js's dungeon
// block. Each request and chest open waits for its reply within the call budget owner's call margin, a lost reply is
// asked again on the next report while the state it asked about is unchanged, and the
// control counts current for the `report` reading.
import { partyHooks } from '../../hooks/index.ts';
import type { CaveObservation, CaveCommand, CavePoint, CaveRoute } from "../api.ts";
import { fresh } from "../../protocol/reports.ts";
import { caveFloorMap, caveVisitCurrent, GAME_CHEST_REACH, voteSettled } from "../rules.ts";
import { scope, type ScopeHandle } from '../../lifecycle/api.ts';
import { boundFired } from '../../status/api.ts';
import { ARRIVAL_TOLERANCE } from '../../protocol/ladder.ts';

// The action journal.

export interface DungeonReceipt {
  id: string;
  status: "dispatched" | "complete" | "uncertain" | "failed";
  error?: string;
  command?: CaveCommand;
}
export interface DungeonJournal {
  entries: DungeonReceipt[];
}

/**
 * Persist before dispatch. Retain unresolved receipts across later commands and reloads, and the
 * receipts of the saved command's run; a run's resolved receipts go once a command of another run
 * is saved, since the Cave's ids are the current visit's.
 */
export function createDungeonJournal(
  read: () => DungeonJournal | DungeonReceipt | null,
  write: (value: DungeonJournal) => void,
) {
  const saved = read();
  let entries = saved && "entries" in saved ? saved.entries : saved ? [saved] : [];
  const unresolved = (entry: DungeonReceipt) =>
    entry.status === "dispatched" || entry.status === "uncertain";
  function save(command: CaveCommand, status: DungeonReceipt["status"], error?: string) {
    const next = [
      ...entries.filter((entry) => entry.id !== command.id),
      { id: command.id, command, status, error },
    ];
    const retained = next.filter(entry => unresolved(entry) || entry.command?.run === command.run);
    write({ entries: retained });
    entries = retained;
  }
  function reconcile(cave: CaveObservation["cave"], name: string, resume?: { run?: string }) {
    for (const entry of entries.filter(unresolved)) {
      const command = entry.command;
      if (!command) continue;
      const sameRun = cave?.run === command.run;
      const entered = command.action === "enter" && (!!cave || !!resume?.run);
      const climbed = command.action === "stairs" && sameRun && !!command.target?.to &&
        command.target.to === caveFloorMap(cave?.run, cave?.floor);
      const exited = command.action === "exit" && !cave;
      const voted = command.action === "vote" && sameRun && voteSettled(cave?.choice, command, name);
      const bought =
        command.action === "buy" &&
        sameRun &&
        cave?.choice?.id === command.choice &&
        cave?.choice?.shop?.room === command.room &&
        cave?.choice?.shop?.sold;
      const revival =
        command.action === "revival" &&
        sameRun &&
        !!cave?.choice &&
        cave.choice.id !== command.choice;
      if (entered || climbed || exited || voted || bought || revival) save(command, "complete");
    }
  }
  return {
    save,
    reconcile,
    get: (id?: string) => entries.find((entry) => entry.id === id),
    latest: () => entries.at(-1),
    blocked: (command?: CaveCommand) =>
      entries.some(
        (entry) =>
          unresolved(entry) && entry.id !== command?.id &&
          (!command || !entry.command?.run || entry.command.run === command.run),
      ),
  };
}

// The interaction request.
// Cave interaction wire protocol is not included in typed-adventureland.
// Keep one socket and request identity through settlement, including in Steam CODE.
interface Reply {
  request_id?: string;
  place?: string;
  failed?: boolean;
  reason?: string;
  visit?: unknown;
}
interface Socket {
  connected?: boolean;
  prependAny?(listener: (event: string, data: Reply) => void): unknown;
  offAny?(listener: (event: string, data: Reply) => void): unknown;
  on(event: string, listener: (data: Reply) => void): unknown;
  off(event: string, listener: (data: Reply) => void): unknown;
  emit(event: string, fields: Record<string, unknown>): unknown;
}
// A reply that has not come within `bound` (the caller's call margin) rejects as a lost reply
// (`timeout`) and tells the status owner's bound record. The reply and disconnect listeners only settle the wait, so they are the hunting owner's `observe`
// registrations; the bound is `act`, so a request in flight at Pause times out only after Play.
// The `prependAny` capture is the game client's own API, which
// the scope does not wrap: `finish` removes it on the reply, the bound or the disconnect.
// The interaction emit asks the call budget owner's `job` band and waits for the call window
// while it answers "not now", before the bound starts, as the events owner's and the merchant jobs owner's job calls do.
// The game client resolves a native `interaction` deferred for every interaction reply
// (js/old_common_functions.js `resolve_deferred`) and logs "Weird resolve_deferred issue:
// interaction" when none waits, so the request registers one before its emit (fork 46e63781). The
// reply listener below settles the request; the deferred only answers the client's own queue.
export async function requestCave(
  frame: { socket: Socket; push_deferred?(name: string): Promise<unknown> },
  id: string,
  action: string,
  fields: Record<string, unknown>,
  bound: number,
  handles: { act: ScopeHandle; observe: ScopeHandle } = { act: scope('07', 'act'), observe: scope('07', 'observe') },
): Promise<Reply> {
  const { act, observe } = handles, socket = frame.socket, target = socket as Parameters<ScopeHandle['on']>[0];
  await partyHooks().calls.wait({ band: 'job', method: 'interaction' }, act);
  return new Promise((resolve, reject) => {
    if (!socket || socket.connected === false) return reject(Error("Cave socket disconnected"));
    let settled = false;
    const timer = act.setTimeout(() => {
      boundFired({ bound: 'callMargin', owner: '07', state: { method: 'interaction', action, ms: bound } });
      finish({ failed: true, reason: "timeout" });
    }, bound);
    // Native UI handlers can prevent later event listeners from seeing a reply.
    // Capture our correlated reply first without replacing or suppressing those handlers.
    if (socket.prependAny && socket.offAny) socket.prependAny(incoming);
    else observe.on(target, "game_response", response as (data: unknown) => void);
    observe.on(target, "disconnect", disconnected);
    try {
      frame.push_deferred?.("interaction").catch(() => undefined);
      socket.emit("interaction", { ...fields, type: "cave", action, request_id: id });
    }
    catch (error) {
      finish({ failed: true, reason: error instanceof Error ? error.message : String(error) });
    }
    function finish(data: Reply) {
      if (settled) return;
      settled = true;
      act.clearTimeout(timer);
      observe.off(target, "game_response", response as (data: unknown) => void);
      socket.offAny?.(incoming);
      observe.off(target, "disconnect", disconnected);
      if (data.failed) reject(data);
      else resolve(data);
    }
    function response(data: Reply) {
      if (data?.request_id === id && data.place === "interaction") finish(data);
    }
    function disconnected() { finish({ failed: true, reason: "disconnected" }); }
    function incoming(event: string, data: Reply) {
      if (event === "game_response") response(data);
    }
  });
}

// The dungeon runtime.

// Partial official wire payloads, not complete game objects. api.ts holds the Cave shapes.
interface RawPoint {
  id?: string;
  kind?: string;
  map?: string;
  floor: number;
  x: number;
  y: number;
  name?: string;
  name_message?: unknown;
  locked?: boolean;
  done?: boolean;
  to?: string;
  down?: boolean;
  required?: boolean;
}
interface RawCave {
  run: string;
  floor: number;
  expires: number;
  server_time: number;
  remaining_ms: number;
  paused: boolean;
  gold: number;
  amber: number;
  doors?: RawPoint[];
  objectives?: RawPoint[];
  choice?: {
    id: string;
    title: string;
    text: string;
    title_message?: unknown;
    text_message?: unknown;
    deadline: number;
    resolved: boolean;
    result_label?: string;
    result_message?: unknown;
    summary?: string[];
    votes: Record<string, string>;
    options: {
      id: string;
      label: string;
      label_message?: unknown;
      unavailable?: string;
      unavailable_message?: unknown;
      cost?: number;
      amber?: number;
    }[];
    shop?: { room: string; name: string; price: number; sold: boolean; nearby: boolean };
  };
}
interface Visit {
  available: boolean;
  unlimited?: boolean;
  resets: number;
  server_time: number;
  home: string;
  resume?: { server: string; run?: string };
}
interface Ports {
  name: string;
  members(): string[];
  leader(): string | undefined;
  ready(): boolean;
  now(): number;
  alive(): boolean;
  current(): boolean;
  cave(): RawCave | null;
  supported(): boolean;
  info(): Promise<Visit>;
  request(action: string, fields?: Record<string, unknown>): Promise<unknown>;
  keeper(): { map: string; x: number; y: number } | undefined;
  text(value: unknown): string;
  move(point: CavePoint, command: CaveCommand): Promise<unknown>;
  travel?(): CaveObservation['travel'];
  stop(): Promise<unknown>;
  // A speed caps the walk; no speed lifts the cap (the game's cruise handler sets `player.cruise` to
  // parseInt of it, and a NaN cap reads as none: node/server.js:1793, 5658-5665).
  cruise?(speed?: number): void;
  sharedRoute?(route:CaveRoute,command:CaveCommand):void;
  read(): DungeonJournal | DungeonReceipt | null;
  write(journal: DungeonJournal): void;
}
export function installDungeonRuntime(ports: Ports) {
  let visit: CaveObservation["visit"],
    checking = false,
    checkId = 0,
    visitError: string | undefined,
    owned = false;
  let command: CaveCommand | undefined;
  let activeId: string | undefined;
  // A command whose journal write failed: the next observation answers it failed with the reason,
  // so the coordinator's receipt reads it and the visit climbs its repair.
  let unsaved: DungeonReceipt | undefined;
  let observedRun = ports.cave()?.run,
    visitRevision = 0;
  const journal = createDungeonJournal(ports.read, ports.write);
  let movementReady = false,
    controlAt = 0;
  // The cap last sent: `undefined` until the first control, `null` for no cap. The first control
  // always sends, so a cap an earlier runtime left goes.
  let cruiseSpeed: number | null | undefined;
  let stopping: Promise<unknown> = Promise.resolve();
  let serverTime = 0,
    serverOffset = 0;
  function caveText(message: unknown, fallback: string | undefined): string {
    const translated = ports.text(message || fallback);
    // Headless clients may lack phrase.message and stringify localization payloads.
    return typeof translated === "string" && translated !== "[object Object]"
      ? translated
      : fallback || "";
  }
  function normalized(): CaveObservation["cave"] {
    const c = ports.cave();
    if (!c) return null;
    if (c.server_time !== serverTime) {
      serverTime = c.server_time;
      serverOffset = c.server_time - ports.now();
    }
    const offset = serverOffset;
    const points = (items: RawPoint[], kind: string): CavePoint[] =>
      items.map((p, i) => ({
        id: c.run + ":" + c.floor + ":" + kind + ":" + i,
        room: kind === "room" ? p.id : undefined,
        kind: p.kind,
        label:
          kind === "door"
            ? p.to === "main"
              ? "Exit dungeon"
              : p.down
                ? "Stairs down"
                : "Stairs up"
            : caveText(p.name_message, p.name),
        map: p.map || caveFloorMap(c.run, p.floor),
        x: p.x,
        y: p.y,
        locked: p.locked,
        done: p.done,
        exit: p.to === "main",
        down: p.down,
        to: p.to,
        required: p.required,
      }));
    return {
      run: String(c.run),
      floor: c.floor,
      expires: c.expires - offset,
      remainingMs: c.remaining_ms,
      paused: !!c.paused,
      gold: c.gold,
      amber: c.amber,
      points: [...points(c.doors || [], "door"), ...points(c.objectives || [], "room")],
      choice: c.choice && {
        ...c.choice,
        id: String(c.choice.id),
        deadline: c.choice.deadline - offset,
        title: caveText(c.choice.title_message, c.choice.title),
        text: caveText(c.choice.text_message, c.choice.text),
        resultLabel: caveText(c.choice.result_message, c.choice.result_label),
        summary: c.choice.summary,
        options: c.choice.options.map((o) => ({
          id: String(o.id),
          label: caveText(o.label_message, o.label),
          unavailable: o.unavailable && caveText(o.unavailable_message, o.unavailable),
          cost: o.cost,
          amber: o.amber,
        })),
      },
    };
  }
  // The daily eligibility answer counts until the game's daily reset it names (`resets`):
  // the character asks while it has none, after each Cave run (`report` clears it) and once the
  // reset passes.
  const visitCurrent = () => !!visit && caveVisitCurrent(visit, ports.now());
  // A lost or failed answer is asked again on the next report, through the call budget owner's job band.
  const canRefresh = () => !checking && ports.supported() && !visitCurrent();
  function eligibilityError(error: unknown) {
    if (error instanceof Error) return error.message;
    return String((error as { reason?: unknown })?.reason || error);
  }
  async function refresh() {
    if (!canRefresh()) return;
    checking = true;
    const id = ++checkId;
    const revision = visitRevision;
    try {
      const v = await ports.info();
      if (id !== checkId || !ports.current() || revision !== visitRevision) return;
      visitError = undefined;
      visit = {
        available: !!(v.available || v.unlimited),
        resets: v.resets - (v.server_time - ports.now()),
        home: v.home,
        resume: v.resume,
        checkedAt: ports.now(),
      };
    } catch (error) {
      if (id !== checkId) return;
      visitError = eligibilityError(error);
    } finally {
      if (id === checkId) checking = false;
    }
  }
  function report(): CaveObservation {
    const run = ports.cave()?.run;
    if (run !== observedRun) {
      observedRun = run;
      visit = undefined;
      visitRevision++;
    }
    void refresh();
    return {
      protocol: 1,
      at: ports.now(),
      supported: ports.supported(),
      alive: ports.alive(),
      ready: ports.ready(),
      travel: ports.travel?.(),
      members: ports.members(),
      leader: ports.leader(),
      visit,
      visitError,
      cave: normalized(),
      keeper: ports.keeper(),
      action: unsaved && unsaved.id === command?.id ? unsaved : journal.get(command?.id) || journal.latest(),
    };
  }
  function validate(c: CaveCommand) {
    if (!ports.current() || command?.id !== c.id) throw Error("Dungeon command superseded");
    const cave = normalized();
    if (c.action === "enter" && (!ports.ready() || cave)) throw Error("Entry readiness changed");
    if (c.action === "stairs") {
      const door = cave?.points.find(p => p.id === c.target?.id);
      if (!door?.down || door.locked || door.to !== c.target?.to || !canMove())
        throw Error("Stairs are not ready for the party");
    }
    if (c.action === "revival" && (!cave || ports.alive()))
      throw Error("No fallen dungeon participant");
    if (c.run && cave?.run !== c.run && (c.action !== "exit" || cave))
      throw Error("Dungeon run changed");
    if ((c.action === "vote" || c.action === "buy") && cave?.choice?.id !== c.choice)
      throw Error("Choice changed");
    if (c.action === "vote" && (cave!.choice!.resolved || cave!.choice!.votes[ports.name]))
      return false;
    if (c.action === "vote") {
      const option = cave?.choice?.options.find((o) => o.id === c.option);
      if (
        !option ||
        option.unavailable ||
        (option.cost || 0) !== c.cost ||
        (option.amber || 0) !== c.amber
      )
        throw Error("Vote terms changed");
    }
    if (
      c.action === "buy" &&
      (!cave!.choice!.shop?.nearby ||
        cave!.choice!.shop.price !== c.cost ||
        cave!.choice!.shop.sold ||
        cave!.gold < cave!.choice!.shop.price)
    )
      throw Error("Purchase unavailable");
    return true;
  }
  // 1.5 row 26: a stairs command the server refused for a pause (`cave_paused`) goes again, revalidated
  // for the same run and door, on the first report where the party can move.
  const pausedStairs = (c: CaveCommand) => {
    const prior = journal.get(c.id);
    return c.action === "stairs" && prior?.status === "failed" && /cave_paused/.test(prior.error || "") && canMove();
  };
  // A dispatched command whose reply was lost (`timeout`) goes again on the next report while
  // the journal's reconcile, which read that report, has not found its effect.
  const lostReply = (c: CaveCommand) => {
    const prior = journal.get(c.id);
    return prior?.status === "uncertain" && prior.error === "timeout";
  };
  async function execute(c: CaveCommand) {
    if (activeId || (journal.get(c.id) && !pausedStairs(c) && !lostReply(c))) return;
    // 1.5 row 26: the stairs wait while the party cannot move (a native conversation pause); the
    // command stays pending and is sent on a report where it can.
    if (c.action === "stairs" && !canMove()) return;
    activeId = c.id;
    let dispatched = false;
    try {
      await stopping;
      if (!validate(c)) {
        journal.save(c, "complete");
        return;
      }
      if (c.action === "exit" && !ports.cave()) {
        journal.save(c, "complete");
        return;
      }
      if (c.action !== "exit" && journal.blocked(c))
        throw Error("Previous dungeon action needs reconciliation");
      if (c.action === "move" || c.action === "gather") {
        if (!c.target || !ports.alive()) throw Error("Alive participant and destination required");
        await ports.move(c.target,c);
        validate(c);
        journal.save(c, "complete");
        return;
      }
      if (c.action === "talk") {
        // Talking only reopens a dialogue, so it is never saved as
        // dispatched and its failure blocks no later action.
        await ports.request(c.action, { room: c.room });
        journal.save(c, "complete");
        return;
      }
      journal.save(c, "dispatched");
      dispatched = true;
      await ports.request(c.action, { choice: c.choice, option: c.option, room: c.room, to: c.target?.to });
      journal.save(c, "complete");
    } catch (error) {
      if (journal.get(c.id)?.status === "complete") return;
      const reason =
        error && typeof error === "object" && "reason" in error
          ? String(error.reason)
          : String(error);
      // A rejected transport promise does not prove that the server rejected the action; the
      // server's pause gate refuses before the action runs, so `cave_paused` is a definite failure.
      journal.save(c, dispatched && !/cave_paused/.test(reason) ? "uncertain" : "failed", reason);
    } finally {
      if (activeId === c.id) activeId = undefined;
    }
  }
  function receive(control?: { owned: boolean; command?: CaveCommand; movementReady?: boolean; route?:CaveRoute }) {
    const nextOwned = !!control?.owned || !!ports.cave();
    if ((nextOwned && !owned) || (command?.id !== control?.command?.id && activeId))
      stopping = ports.stop();
    movementReady = !!control?.movementReady;
    controlAt = ports.now();
    owned = nextOwned;
    command = control?.command;
    if (control?.route && command) ports.sharedRoute?.(control.route,command);
    const nextCruise = command?.cruiseSpeed || null;
    if (nextCruise !== cruiseSpeed) { cruiseSpeed = nextCruise; ports.cruise?.(nextCruise ?? undefined); }
    journal.reconcile(normalized(), ports.name, visit?.resume);
    if (journal.get(activeId)?.status === "complete") activeId = undefined;
    // A journal write failure dispatches no action (execute saves before it dispatches).
    const asked = command;
    if (asked)
      void execute(asked).catch((error: unknown) => {
        unsaved = { id: asked.id, command: asked, status: "failed", error: "Dungeon journal write failed: " + eligibilityError(error) };
      });
  }
  const canMove = () =>
    !owned || ((movementReady || command?.action === "gather" && command.resume && !ports.cave()) &&
      fresh(controlAt, ports.now(), 'report', 0, true) && ports.ready() && !ports.cave()?.paused);
  return {
    report,
    commandIdentity(): Pick<CaveCommand,'id'|'action'|'run'> | undefined {
      if(!ports.current() || !command)return;
      return {id:command.id,action:command.action,run:command.run};
    },
    receive,
    canMove,
    owns: () => owned || !!ports.cave(),
    paused: () => !!ports.cave()?.paused,
  };
}

// ---- The Cave client: the character's side of the visit (shared.js 2595-2814, HNT-101, HNT-105, HNT-121, HNT-122) ----


interface Geometry { min_x: number; min_y: number; max_x: number; max_y: number; default?: unknown;
  tiles?: unknown[][]; placements?: unknown[]; groups?: unknown[] }
interface Chest { map: string; in?: string | null; x: number; y: number; to_delete?: boolean }
interface Track { id: string; distance: number; x: number; y: number; leader: boolean; prepared: boolean;
  points?: { x: number; y: number }[]; prefix?: number[]; route?: CaveRoute }
interface Walker { state: { found?: boolean; plot: { x: number; y: number }[] }; identity: unknown;
  install(plot: unknown, identity: unknown, kind: string): void; cancel(reason: string, detail: unknown): Promise<unknown>;
  planTick(): void; tick(): void; move(point: CavePoint, target: undefined, options: Record<string, unknown>): Promise<unknown> }
export interface CaveClientPorts {
  character(): { name: string; cave?: RawCave | null; rip?: boolean; map: string; in?: string;
    real_x: number; real_y: number; moving?: boolean };
  // The game's window: its chests, entities, socket, phrase and chest opener.
  frame(): { chests?: Record<string, Chest>; entities?: Record<string, unknown>; socket: Socket; transporting?: boolean;
    push_deferred?(name: string): Promise<unknown>;
    phrase?: { message?(value: unknown): string }; open_chest(id: string): Promise<unknown> };
  game(): { maps: Record<string, { doors?: unknown[][]; npcs?: { id: string; position: number[] }[] } | undefined>;
    geometry?: Record<string, Geometry | undefined>; tilesets?: Record<string, { file?: string } | undefined> };
  player(name: string): { map: string; in?: string } | null | undefined;
  members(): string[];
  current(): boolean;
  // The targeting owner's grouped queue on the character: the Cave floor's scope and its members.
  queue(): { caveScope?: string; members: string[] } | null | undefined;
  supported(): boolean;
  withTimeout<T>(promise: Promise<T>, ms: number, label: string, fired?: () => void): Promise<T>;
  transport(request: { kind: string; owner: string }, map: string, spawn: unknown): Promise<unknown>;
  // The survival owner's one respawn (`survival.respawn`), asked for the member it runs on.
  respawn(by: string): { answer: 'sent' } | { answer: 'not-now' } | { answer: 'refused'; reason: string };
  // No departure fight pending and no departure chest left (the loot client's own reads).
  departed(): boolean;
  threat(entity: unknown): boolean;
  // The departure loot outside the Cave (shared.js `smartLoot`).
  loot(): Promise<unknown>;
  movement(): Walker;
  cruise(speed?: number): unknown;
  // Movement's walks retire for the Cave's command (the movement owner's walk state).
  stop(): Promise<unknown>;
  storage(): { getItem(key: string): string | null; setItem(key: string, value: string): void };
}
type Client = ReturnType<typeof installDungeonRuntime>;
const host = globalThis as { __partyDungeonRuntime?: Client; __partyDungeonOpenedChests?: { run: string | null; ids: Record<string, boolean> } };

/**
 * The character's Cave client: whether the Cave owns the character, the floor's party, the chest
 * loot and its opened record, and the dungeon runtime it installs on first use with the game and
 * walk ports the runtime asks.
 */
export function installCaveClient(ports: CaveClientPorts) {
  let runtime: Client | undefined;
  const opened = () => host.__partyDungeonOpenedChests ||= { run: null, ids: {} };
  const me = () => ports.character();
  // The Cave owns the character inside a run and while its runtime holds a command (S-07c's read).
  const owned = () => !!me().cave || !!host.__partyDungeonRuntime?.owns();
  const caveMembers = () => { const c = me().cave, q = ports.queue(); return c && q?.caveScope === c.run + ':' + c.floor ? q.members : null; };
  const partyNames = () => caveMembers() || ports.members();
  const partyMembers = () => [me() as { map: string; in?: string } | null | undefined]
    .concat(partyNames().filter(name => name !== me().name).map(name => ports.player(name)))
    .filter(m => !!m && m.map === me().map && m.in === me().in);
  function chestAvailable(id: string, chest: Chest | undefined): boolean {
    const c = me(), record = opened();
    return !!chest && !chest.to_delete && !(record.run === c.cave?.run && record.ids[id]) && chest.map === c.map &&
      (chest.in == null || chest.in === c.in) && Math.hypot(chest.x - c.real_x, chest.y - c.real_y) <= GAME_CHEST_REACH;
  }
  const looting = () => ports.current() && !me().rip && !!me().cave && !me().cave!.paused;
  async function loot(): Promise<void> {
    if (!looting()) return;
    for (const id of Object.keys(ports.frame().chests || {})) {
      if (!looting()) return;
      // The character's own socket opens the chest: loot(id) reads parent.parent, the commander's frame.
      if (!chestAvailable(id, ports.frame().chests![id])) continue;
      await jobBand('open_chest');
      const margin = partyHooks().calls.margin();
      if (chestAvailable(id, ports.frame().chests![id])) await ports.withTimeout(ports.frame().open_chest(id), margin, 'Dungeon loot',
        () => boundFired({ bound: 'callMargin', owner: '07', state: { method: 'open_chest', label: 'Dungeon loot', ms: margin } }));
    }
  }
  // A chest the game reports open in this run is not opened again.
  function chestOpened(data: { cave?: unknown; id: string }): void {
    const run = me().cave?.run;
    if (!data.cave || !run) return;
    if (opened().run !== run) host.__partyDungeonOpenedChests = { run, ids: {} };
    opened().ids[data.id] = true;
  }
  // The Cave's own chest asks the call budget owner's `job` band and waits for the call window
  // while it answers "not now", as `requestCave`'s emit does.
  async function jobBand(method: string): Promise<void> {
    await partyHooks().calls.wait({ band: 'job', method }, scope('07', 'act'));
  }
  const request = async (action: string, fields?: Record<string, unknown>) => {
    return requestCave(ports.frame(), 'cave:' + me().name + ':' + Date.now() + ':' + Math.random(), action, fields || {}, partyHooks().calls.margin());
  };

  // The shared Cave walk's progress along the leader's planned route.
  let track: Track | null = null;
  function prepare(plot: { x: number; y: number }[]): void {
    const t = track!, prefix = [0];
    let previous = { x: t.x, y: t.y };
    for (const point of plot) { prefix.push(prefix[prefix.length - 1]! + Math.hypot(point.x - previous.x, point.y - previous.y)); previous = point; }
    Object.assign(t, { points: plot, prefix, prepared: true });
  }
  function travel(): CaveObservation['travel'] {
    if (!track) return undefined;
    const walker = ports.movement(), c = me();
    if (!track.route && track.leader && walker.state.found) {
      track.route = { plot: walker.state.plot.map(p => ({ ...p })), identity: walker.identity } as CaveRoute;
      prepare(track.route.plot as { x: number; y: number }[]);
    }
    if (track.points) {
      const index = Math.max(0, track.points.length - walker.state.plot.length), next = track.points[index];
      const from = index ? track.points[index - 1]! : { x: track.x, y: track.y };
      let along = track.prefix![index] || 0;
      if (next) {
        const dx = next.x - from.x, dy = next.y - from.y, length = Math.hypot(dx, dy);
        along += length ? Math.max(0, Math.min(length, ((c.real_x - from.x) * dx + (c.real_y - from.y) * dy) / length)) : 0;
      }
      track.distance = Math.max(track.distance, along);
    }
    return { id: track.id, distance: track.distance, prepared: track.prepared, route: track.route } as CaveObservation['travel'];
  }
  function move(point: CavePoint, command: CaveCommand): Promise<unknown> {
    const c = me(), walker = ports.movement(), shared = !!command.cruiseSpeed && !command.independent;
    track = shared ? { id: command.id, distance: 0, x: c.real_x, y: c.real_y, leader: c.name === partyNames()[0], prepared: false } : null;
    // A shared Cave route plans only while the character stands still; its gate rides on this
    // journey and ends with it (design section 8.1).
    const preparing = track;
    const gate = preparing ? { tick() {
      if (track === preparing && !walker.state.found && !me().moving && !ports.frame().transporting && !me().cave?.paused) walker.planTick();
      else walker.tick();
    } } : undefined;
    // A gather plans the cross-map walk to Dorr and regroups on large generated floors. Every Cave walk
    // plans while its search advances, from the player's planning budget.
    return walker.move(point, undefined, { request: { kind: 'cave', owner: 'cave:' + command.id }, native: true, shared,
      arrivalTolerance: command.action === 'gather' ? 1 : ARRIVAL_TOLERANCE, town: false, gate, awaitSharedRoute: !!preparing && !preparing.leader,
      nativePlanningWhileAdvancing: true, repairSharedDrift: shared,
      async barrier() {
        if (me().cave) return runtime!.canMove();
        await ports.loot();
        return ports.departed();
      } });
  }
  function sharedRoute(route: CaveRoute, command: CaveCommand): void {
    if (!track || track.id !== command.id || track.leader || track.prepared) return;
    try { ports.movement().install(route.plot, route.identity, 'cave-convoy'); prepare(route.plot as { x: number; y: number }[]); }
    catch (error) { void ports.movement().cancel('Cave convoy route could not be shared: ' + String(error), { code: 'cave-route-rejected', by: { kind: 'cave', owner: 'cave:' + command.id } }); }
  }
  function caveRequest(action: string, fields: Record<string, unknown> = {}): Promise<unknown> {
    if (action === 'enter' || action === 'exit') return request(action);
    if (action === 'stairs') {
      const c = me(), door = ports.game().maps[c.map]?.doors?.find(d => d[4] === fields.to);
      if (!door || !c.cave || fields.to === 'main') throw Error('Cave stairs unavailable');
      // The stairs end at the transport's own reply and the game's `new_map`.
      return ports.transport({ kind: 'cave', owner: 'cave:stairs' }, String(fields.to), door[5]);
    }
    // The revival asks survival's respawn and the Cave's observation completes the action
    // on the member's next living report; `not-now` and `refused` fail this ask, and the next
    // report asks again while the member lies dead.
    if (action === 'revival') {
      const answer = ports.respawn('cave-revival');
      return answer.answer === 'sent' ? Promise.resolve(answer) : Promise.reject(Error(answer.answer === 'refused' ? answer.reason : 'The respawn is not allowed now'));
    }
    if (action === 'vote') return request(action, { choice: fields.choice, option: fields.option });
    if (action === 'buy' || action === 'talk') return request(action, { room: fields.room });
    throw new Error('Unsupported cave action');
  }
  // The dungeon runtime, installed on its first use, once the character's walk exists.
  function client(): Client {
    if (runtime) return runtime;
    const journalKey = 'party-dungeon-actions:' + me().name;
    runtime = host.__partyDungeonRuntime = installDungeonRuntime({
      name: me().name, now: Date.now, current: ports.current, members: ports.members, leader: () => ports.members()[0],
      ready() {
        const c = me();
        if (!c.cave) return !c.rip && ports.departed();
        const threatened = Object.values(ports.frame().entities || {}).some(entity => ports.threat(entity));
        const unlooted = Object.entries(ports.frame().chests || {}).some(([id, chest]) => chestAvailable(id, chest));
        return !c.rip && !c.cave.paused && !threatened && !unlooted;
      },
      alive: () => !me().rip,
      cave: () => me().cave || null,
      supported: ports.supported,
      info: () => request('info').then(data => (data as unknown as { visit: Visit }).visit),
      request: caveRequest,
      keeper() {
        const npc = ports.game().maps.main?.npcs?.find(n => n.id === 'dreamkeeper');
        return npc && { map: 'main', x: npc.position[0]!, y: npc.position[1]! };
      },
      text: value => ports.frame().phrase?.message ? ports.frame().phrase!.message!(value) : String(value || ''),
      travel, sharedRoute, move,
      // The game may refuse a speed; the walk goes on at the one it has.
      cruise(speed) { try { Promise.resolve(ports.cruise(speed)).catch(() => {}); } catch { /* refused */ } },
      stop: ports.stop,
      read: () => JSON.parse(ports.storage().getItem(journalKey) || 'null'),
      write: journal => ports.storage().setItem(journalKey, JSON.stringify(journal)),
    });
    return runtime;
  }
  // A generated Cave floor's map for the dashboard: sent once per floor, and again when
  // the coordinator answers that it needs it.
  let sent: { map: string | null; needed: boolean } = { map: null, needed: false };
  function mapDefinition() {
    const c = me(), game = ports.game(), geometry = game.geometry?.[c.map];
    if (!c.cave || !geometry || sent.map === c.map && !sent.needed) return undefined;
    if (!geometry.tiles?.length || !(geometry.placements?.length || geometry.groups?.length)) return undefined;
    const tilesets: Record<string, { file: string }> = {};
    for (const tile of geometry.tiles) {
      const id = String(tile?.[0]), file = game.tilesets?.[id]?.file;
      if (file) tilesets[id] = { file: /^https?:/.test(file) ? file : 'https://adventure.land' + file };
    }
    sent = { map: c.map, needed: false };
    return { name: c.map, min_x: geometry.min_x, min_y: geometry.min_y, max_x: geometry.max_x, max_y: geometry.max_y, default: geometry.default,
      tiles: geometry.tiles, placements: geometry.placements || [], groups: geometry.groups || [], tilesets };
  }
  const definitionNeeded = (map: string) => { if (sent.map === map) sent.needed = true; };
  // The `cave` row: the reply's Cave control, then, while the Cave owns the character, the
  // targeting fields go to `targeting.receive` and the apply ends here.
  function reply(state: Record<string, any>): boolean {
    client().receive(state.dailyDungeon);
    if (!client().owns()) return false;
    partyHooks().ask('targeting.receive', { groupedCombat: state.groupedCombat || null, partyThreats: state.partyThreats || [],
      partyTargets: state.partyTargets || [], partyPositions: state.partyPositions || [] });
    return true;
  }
  // The installed runtime holds the character's walks while it cannot move (movement's `caveHolds`).
  // `runtimeOwns` is the runtime's command ownership alone, which `cave.state` answers apart from a run.
  // `inside` hands the chest loot to the items owner's departure loot while the character stands inside a run.
  return { owned, runtimeOwns: () => !!host.__partyDungeonRuntime?.owns(), partyNames, partyMembers, loot, chestOpened, client, reply,
    inside: () => me().cave ? { loot } : null,
    mapDefinition, definitionNeeded, holds: () => !!runtime && !runtime.canMove() };
}
Object.assign(globalThis, { installDungeonRuntime, requestCave });
