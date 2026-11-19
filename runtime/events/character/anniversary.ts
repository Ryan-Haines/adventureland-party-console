// The `anniversary` row on the character:
// the staging in Main, the kiss, the slices and the merchant's chat
// advert, with the round state the heartbeat reports. Moved from characters/shared.js:
// the anniversary block, its state and its readers' writes, with b9b5c91e's order and values.
// The game data (the visit window, the slices, the kiss and send reach) is rules.ts's and this
// file's constants. Every wait reads a game signal: the round's `expires`, the kiss skill's reply
// and cooldown, the character's next game update, the walk's own end, or a report.
// The coordinator
// decides the round (coordinator/anniversary.ts) and the reply carries its plan; this file acts on it.
// shared.js calls `installEventAnniversary` once in the routine's install.
import { callMargin, marginCall } from './calls.ts';
import { ANNIVERSARY_WINDOW_MS, anniversaryRoundId, anniversarySlices } from '../rules.ts';
import { SEND_REACH } from '../../protocol/reports.ts';
import { partyHooks } from '../../hooks/index.ts';

// The game's reach for a kiss (logic/anniversary_event.js:209). A send reads protocol's
// SEND_REACH.
const KISS_REACH = 80;
const MAIN = { map: 'main', x: 0, y: 0 };
// The kiss reply's reasons (logic/anniversary_event.js `visitStatus`, `rewardBlock`) that no other
// approach in the round can change.
const FINAL_REASONS = ['claimed', 'host', 'no_visit', 'realmfatigue', 'hopsickness', 'merchant_home'];

// The round the clock reports (character/clock.ts `status().anniversary`).
export interface AnniversaryRound {
  active?: boolean; live?: boolean; available?: boolean; round?: unknown; target?: string; id?: unknown; event_id?: unknown;
  map?: string; x?: unknown; y?: unknown; expires?: unknown; next?: unknown;
}
interface Ticket { round?: unknown; id?: unknown }
// The coordinator's plan the reply carries (coordinator/anniversary.ts).
interface Cycle { startsAt?: unknown; endsAt?: unknown; liveRound?: unknown; id?: unknown; returnCompletedAt?: unknown; supersededAt?: unknown;
  combatHandoffAt?: unknown; returnDispatchedAt?: unknown }
interface Handoff { name: string; round?: unknown; slice: string; event?: unknown; ctype?: string; server?: string; map: string; x: unknown; y: unknown }
interface Debt { sender: string; item: string; key: unknown; map?: string; x: unknown; y: unknown }
export interface AnniversaryPlan {
  abortedRounds?: Record<string, { startsAt?: unknown }>; eventCycle?: Cycle | null; partyFeatured?: boolean;
  // Another party member still holds an unclaimed visit ticket while ours is featured.
  featuredVisitsPending?: boolean;
  live?: { round?: unknown } | null; round?: { claims?: Record<string, unknown> } | null; merchant?: string;
  handoffTargets?: Handoff[]; pendingReturns?: Debt[]; chatAdvertisement?: { id: unknown; message: string } | null;
}
interface Operation { round?: string; target?: string; startedAt?: number; navigationRevision?: number; generation?: unknown; cancelled?: boolean; attempt?: number;
  revision?: number }
interface Point { map: string; x: number; y: number }
type Request = Record<string, unknown>;
interface Character { name: string; ctype?: string; map: string; x: number; y: number; rip?: boolean; stand?: unknown;
  s?: { anniversary_visit?: Ticket; anniversary_kiss?: { ms?: unknown } } }
interface Entity { type?: string; name?: string; map?: string; x: number; y: number; owner?: unknown; owner_id?: unknown; account?: unknown }
// The kiss skill's reply (server.js:10074-10079).
type KissReply = { rewarded?: unknown; reason?: unknown } | null;
interface Completed { at: number; target?: string; slice: string | null; recoveredFromBuff?: boolean }
// The round as the feed showed it when an attempt failed: the next attempt waits for the feed or the
// character to show a change.
interface Failed { round: string; target?: string; x?: unknown; y?: unknown; available?: boolean; map: string; at: { x: number; y: number } }
// The state that outlives a hot reload of the CODE frame: a function awaiting smart_move survives
// it, and its old closure's state is invisible to the new script.
export interface AnniversaryRoot {
  __anniversaryCompletedRounds?: Record<string, unknown>;
  __anniversaryPendingHandoff?: { round: unknown; slice: string; attempted: boolean } | null;
  __anniversaryReturnLocation?: Point | null;
  __partyAnniversaryKissOperation?: Operation | null;
  __partyAnniversaryStagingOperation?: Operation | null;
  __partyAnniversaryAttempt?: { round: string; before: Record<string, number>; buffMsBefore: number | null } | null;
  __merchantAnniversaryReleasedRound?: string | null;
  __anniversaryCraftResult?: unknown;
}

export interface EventAnniversaryPorts {
  now(): number;
  character(): Character;
  root(): AnniversaryRoot;
  current(): boolean;
  generation(): unknown;
  // The clock's round (character/clock.ts) and its time reads.
  round(): AnniversaryRound | null | undefined;
  epoch(value: unknown): number;
  // This character's next report, true, or false once its reports fall silent past the
  // report-freshness bound (movement's `reportOrSilence`).
  nextReport(): Promise<boolean>;
  // The schedule's `due` for the anniversary's next round (clock.ts `due`).
  due(at: number): boolean;
  // The attendance (attend.ts) and the exit (exit.ts).
  attend: { selected(name: string): boolean; allowed(name: string): boolean; active(): unknown; traveling(): unknown; joined(): string | null; poll(): unknown };
  exitPending(): boolean;
  eventsEnabled(): boolean;
  // The console's maintenance or the player's hand holds the character; survival's escape owns it;
  // the Cave owns it; the hunting owner's Hunt hand-in goes first.
  paused(): boolean;
  escaping(): boolean;
  caveOwns(): boolean;
  huntTurnIn(): boolean;
  // the merchant jobs owner's merchant: its event reservation (merchant.ts), job holder, gathering, the
  // coordinator's stand hold, and the bank or upgrade errand.
  merchant: { reserved(): boolean; holder(): unknown; gathering(): boolean; forceStand(): boolean; errand(): boolean; wake(): void };
  // Movement's state and service (runtime/movement/character/).
  walk: {
    // The navigation revision and the last command this character took (shared.js `lastCommand`).
    revision(): number; command(): number; townActive(): boolean; townTraveling(): boolean; forceTraveling(): boolean; convoy(): unknown; convoying(): boolean;
    convoyActive(): boolean; held(): boolean;
    // Movement's convoy preemption under the visit's request (install.ts `yieldConvoy`), and the
    // follow's end with the smart stop under it.
    yieldConvoy(request: Request, owns: () => boolean): Promise<boolean>;
    endFollow(request: Request): Promise<unknown>;
    request: Request; returnRequest: Request;
    stop(kind: string | undefined, request: Request): Promise<unknown>;
    smart(point: Point, request: Request): Promise<unknown>;
    direct(point: Point, request: Request): Promise<unknown>;
    leave(request: Request): Promise<unknown>;
    toMain(point: Point, key: string, current: () => boolean): Promise<unknown>;
    landed(point: Point): boolean;
  };
  // The hunting owner's farming pick, for the staging's return label.
  farmingLabel(): string;
  game: {
    entities(): Record<string, Entity | undefined>; player(name: string): Entity | null | undefined;
    joinedInstance(map: string): boolean; canMoveTo(x: number, y: number): boolean;
    useSkill(name: string, target: unknown): Promise<unknown>; say(message: string): Promise<unknown>;
    // The client's `next_skill[name]`: when the skill's cooldown (`G.skills[name].cooldown`) lets it go again.
    readyAt(name: string): number;
    send(name: string, slot: number, count: number): Promise<unknown>; closeStand(): Promise<unknown>;
    quantity(name: string): number; slot(name: string): number; realm(): string;
  };
  clearTarget(): void;
  request(path: string, options: { method: string; body: Record<string, unknown> }): Promise<Record<string, any>>;
  wait(ms: number): Promise<void>;
  later(action: () => void): void;
  log(message: string, color: string): void;
}

const cancelled = () => Object.assign(new Error('Anniversary operation cancelled'), { cancelled: true });
const failure = (message: string, failureReason: string) => Object.assign(new Error(message), { failureReason });
const text = (error: any) => error && (error.reason || error.message) || String(error);

export function installEventAnniversary(ports: EventAnniversaryPorts) {
  const root = ports.root();
  const s = {
    busy: false, staging: false, stage: 'idle', round: null as string | null, lastAttemptAt: 0,
    merchant: { mode: 'idle', attemptAt: 0, retryAt: 0, featuredHold: false },
    plan: null as AnniversaryPlan | null, stagingReported: null as string | null, returnReported: null as string | null,
    chatSending: false, responses: [] as Record<string, unknown>[], responsesRound: null as string | null,
    failed: null as Failed | null, collectTried: {} as Record<string, string>,
  };
  const completed = root.__anniversaryCompletedRounds = root.__anniversaryCompletedRounds || {};
  const merchant = () => ports.character().ctype === 'merchant';
  const ticket = () => ports.character().s?.anniversary_visit;
  const inMain = () => ports.walk.landed(MAIN);
  // The character's game updates (character/install.ts registers the listeners): a wait ends at the
  // next update of the kind asked, any kind when none is named, or at `until`, whichever is first.
  const waiters: { kind?: string; resolve: () => void }[] = [];
  function updated(kind: string) {
    for (const waiter of waiters.splice(0)) if (!waiter.kind || waiter.kind === kind) waiter.resolve(); else waiters.push(waiter);
  }
  function nextUpdate(until: number, kind?: string): Promise<void> {
    return new Promise(resolve => {
      const waiter = { kind, resolve };
      waiters.push(waiter);
      // The timer that ends the wait first takes the waiter off the list.
      if (Number.isFinite(until)) void ports.wait(Math.max(0, until - ports.now())).then(() => {
        const at = waiters.indexOf(waiter);
        if (at >= 0) waiters.splice(at, 1);
        resolve();
      });
    });
  }
  const pollSoon = () => ports.later(() => { ports.attend.poll(); });
  const movementOurs = () => !ports.walk.convoy() && !ports.walk.townTraveling() && !ports.walk.forceTraveling();
  // The stops of one site go in order and end at the first that fails: nothing of ours moves.
  const stopOurs = async (kinds: (string | undefined)[]) => {
    try { for (const kind of kinds) await ports.walk.stop(kind, ports.walk.request); } catch (_) { /* nothing of ours moves */ }
  };

  // The round's identity: the game's round, else the ticket's, else the scheduled round
  // (`anniversaryRoundId`), else the target, map and expiry together.
  function roundId(event: AnniversaryRound, visit?: Ticket): string {
    return String(event.round || visit && (visit.round || visit.id) || anniversaryRoundId(event) || [event.target, event.map, event.expires].join(':'));
  }
  function featured(event: AnniversaryRound): Entity | null {
    const entities = ports.game.entities();
    if (event.id && entities[String(event.id)]) return entities[String(event.id)]!;
    return Object.values(entities).find(entity => entity && entity.type === 'character' && entity.name === event.target) || null;
  }
  const windowStart = (event: AnniversaryRound) => ports.epoch(event.expires) - ANNIVERSARY_WINDOW_MS;
  const startsAt = (event: AnniversaryRound) => event.live === false ? ports.epoch(event.next) : windowStart(event);

  // The round is skipped: deselected, survival's escape owns the character, or the coordinator
  // aborted it (a scheduled round by its start, a live one by its id).
  function aborted(event: AnniversaryRound | null | undefined): boolean {
    if (!ports.attend.selected('anniversary') || ports.escaping()) return true;
    if (!event) return false;
    const rounds = s.plan?.abortedRounds || {};
    if (event.live === false) return Object.values(rounds).some(round => Number(round.startsAt) === ports.epoch(event.next));
    return !!rounds[roundId(event, ticket())];
  }
  // An aborted round ends its kiss and clears the visit state; true when it did.
  async function abort(): Promise<boolean> {
    const event = ports.round(), operation = root.__partyAnniversaryKissOperation, rounds = s.plan?.abortedRounds || {};
    const ours = !!(operation && rounds[operation.round!]);
    if (!aborted(event) && !ours) return false;
    if (ours) {
      operation!.cancelled = true;
      // Only the kiss's own movement stops; a convoy or another owner that replaced it keeps going.
      if (movementOurs()) await stopOurs(['smart', undefined]);
      if (root.__partyAnniversaryKissOperation === operation) root.__partyAnniversaryKissOperation = null;
    }
    s.busy = false; s.staging = false; s.merchant.featuredHold = false; s.merchant.retryAt = 0;
    if (merchant()) s.merchant.mode = 'skipped';
    s.stage = 'anniversary round skipped; returning to normal work';
    return true;
  }
  // A kiss landed: a slice arrived, or the buff is new or its time rose. The buff's `ms` only falls
  // between the game's resends, so any rise is a new kiss.
  function succeeded(before: Record<string, number>, buffBefore: number | null): boolean {
    const buff = ports.character().s?.anniversary_kiss;
    return anniversarySlices.some(name => ports.game.quantity(name) > before[name]) ||
      !!(buff && (buffBefore === null || Number(buff.ms) > buffBefore));
  }

  // One approach toward the featured player or its spot: done when the walk ends or the featured
  // player stands in the kiss reach, failed when movement's progress rule fails the walk. It looks
  // again at each game update, the moment a position can have changed; the round's `expires` ends it
  // through `current`.
  async function approach(point: Point, direct: boolean, event: AnniversaryRound, operation: Operation, current: () => void) {
    let settled = false, failed: unknown = null;
    const done = (direct ? ports.walk.direct(point, ports.walk.request) : ports.walk.smart(point, ports.walk.request))
      .then(() => { settled = true; }, error => { failed = error; settled = true; });
    try {
      for (;;) {
        current();
        const target = featured(event);
        if (target && inReach(target)) return;
        if (failed) throw failed;
        if (settled) return;
        await Promise.race([done, nextUpdate(ports.epoch(event.expires))]);
      }
    } catch (error) { (error as { failureReason?: string }).failureReason = 'target-unreachable'; throw error; }
    finally {
      if (root.__partyAnniversaryKissOperation === operation && !operation.cancelled && operation.navigationRevision === ports.walk.revision() && movementOurs())
        await stopOurs(['smart', 'move']);
    }
  }
  const gapTo = (target: Entity) => { const c = ports.character(); return (target.map || c.map) === c.map ? Math.hypot(Number(target.x) - c.x, Number(target.y) - c.y) : Infinity; };
  const inReach = (target: Entity) => gapTo(target) <= KISS_REACH;

  // The combat party stages in Main for the round; the merchant has its own rows in `merchantRow`.
  // A joined event's instance is left first, so a character fighting there can kiss and re-join.
  async function stageInMain(event: AnniversaryRound) {
    if (!ports.attend.allowed('anniversary') || aborted(event) || merchant() || s.busy) return;
    const revision = ports.walk.revision(), operation: Operation = { revision, cancelled: false };
    const current = () => ports.current() && !operation.cancelled && root.__partyAnniversaryStagingOperation === operation && !ports.huntTurnIn() &&
      !aborted(event) && ports.walk.revision() === revision;
    if (inMain()) return;
    s.busy = true;
    root.__partyAnniversaryStagingOperation = operation;
    s.stage = 'returning to Main for anniversary';
    try {
      await stopOurs([undefined]);
      if (!current()) return;
      if (ports.game.joinedInstance(ports.character().map)) {
        if (!ports.attend.allowed('anniversary')) return;
        let leaving = true;
        try { await ports.walk.leave(ports.walk.request); } catch (_) { leaving = false; /* Town remains the fallback. */ }
        // The walk to Main starts once the game moved the character out of the instance (`new_map`).
        const left = ports.epoch(event && event.expires) || ports.epoch(event && event.next) + ANNIVERSARY_WINDOW_MS;
        while (leaving && current() && ports.game.joinedInstance(ports.character().map) && ports.now() < left) await nextUpdate(left, 'new_map');
        if (!current()) return;
      }
      if (current() && !inMain()) {
        ports.log('Anniversary departure: returning from ' + ports.character().map + ' to Main', '#51D2E1');
        if (!ports.attend.allowed('anniversary')) return;
        await ports.walk.toMain(MAIN, String(event && (event.id || event.event_id) || 'anniversary'), current);
      }
    } finally {
      if (root.__partyAnniversaryStagingOperation === operation) { root.__partyAnniversaryStagingOperation = null; s.busy = false; }
    }
  }

  // The fighter reports its staging once per round with the spot it farmed, which the round's return
  // walks back to. The round is the game's slot id, the same while scheduled and live.
  function reportStaging(event: AnniversaryRound) {
    if (aborted(event) || merchant()) return;
    const start = startsAt(event);
    const key = roundId(event, ticket());
    if (s.stagingReported === key) return;
    s.stagingReported = key;
    const c = ports.character();
    const origin = root.__anniversaryReturnLocation = root.__anniversaryReturnLocation || { map: c.map, x: c.x, y: c.y };
    ports.request('/anniversary/staging', { method: 'POST', body: { character: c.name, round: key, map: origin.map, x: origin.x,
      navigationRevision: ports.walk.revision(), y: origin.y, startsAt: start,
      endsAt: event.live === false ? ports.epoch(event.next) + ANNIVERSARY_WINDOW_MS : ports.epoch(event.expires),
      label: 'the ' + ports.farmingLabel() + ' farming location' } }).catch(() => { s.stagingReported = null; });
  }
  function reportReturn(round: string) {
    if (merchant() || s.returnReported === round) return;
    s.returnReported = round;
    ports.request('/anniversary/return-ready', { method: 'POST', body: { character: ports.character().name, round, navigationRevision: ports.walk.revision() } })
      .catch(() => { s.returnReported = null; });
  }

  // A farming convoy yields to the round's travel once the coordinator allows it. 1.5 row 32: the
  // visit owns the preemption while the navigation revision, the last command and the convoy it
  // found stand and its admission holds; it re-reads them after the reply and each stop, and a
  // newer one ends the visit with no move (false). The coordinator's `skipped` and
  // `alreadyReturning` answers end it too.
  async function preempt(event: AnniversaryRound): Promise<boolean> {
    if (aborted(event) || ports.walk.held() || !ports.walk.convoyActive() || !ports.attend.allowed('anniversary')) return true;
    const revision = ports.walk.revision(), command = ports.walk.command(), convoy = ports.walk.convoy();
    const owns = () => ports.current() && !aborted(event) && ports.walk.revision() === revision && ports.walk.command() === command &&
      (!ports.walk.convoy() || ports.walk.convoy() === convoy) && ports.attend.allowed('anniversary');
    const permission = await ports.request('/anniversary/navigation-preempt', { method: 'POST', body: {
      character: ports.character().name, navigationRevision: revision, round: event && roundId(event, ticket()) } });
    if (permission.huntTurnIn) return true;
    if (permission.skipped || permission.alreadyReturning || !owns()) return false;
    return ports.walk.yieldConvoy(ports.walk.request, owns);
  }

  // The kiss pass, in b9b5c91e's order: each step either ends the pass or hands on to the next.
  async function kiss() {
    if (ports.caveOwns() || ports.merchant.reserved() || !ports.attend.selected('anniversary')) return;
    if (await abort()) return;
    expireKiss();
    if (await settleFinished() || yieldToCombat()) return;
    if (s.busy || root.__partyAnniversaryKissOperation || ports.character().rip || ports.walk.townActive() || ports.huntTurnIn()) return;
    if (merchant() && ports.merchant.forceStand()) return;
    let event = ports.round();
    if (!event || event.active === false) return noRound();
    if (releaseFeatured(event)) return;
    const cycle = s.plan?.eventCycle;
    const lookAhead = ports.due(ports.epoch(event.next));
    const visitDone = !merchant() && event.live !== false && !ticket() && !!ports.character().s?.anniversary_kiss;
    if (!cycle?.combatHandoffAt && (event.live !== false || lookAhead) && !merchant() && !visitDone && ports.walk.convoying()) {
      try { if (!await preempt(event)) return; } catch (_) { s.stage = 'waiting to interrupt farming travel for anniversary'; return; }
    }
    if (aborted(event) || !ports.attend.allowed('anniversary')) return;
    if (await holdCycle(event)) return;
    const preWindow = event.live === false && lookAhead, designated = event.target === ports.character().name;
    const round = roundId(event, ticket()), kissed = !!completed[round];
    if (recovered(event, round, kissed)) return;
    if (merchant() && await merchantRow(event, preWindow, designated, kissed)) return;
    if (s.plan?.eventCycle?.combatHandoffAt) {
      // The combat event's return owns the way back, so the anniversary's origin goes and cannot
      // leak into a later round.
      root.__anniversaryReturnLocation = null; s.stagingReported = null; s.returnReported = null;
    }
    if (await stageRow(event, preWindow, designated, kissed)) return;
    if (merchant() && ports.merchant.holder()) return;
    if (completed[round] || !retryReady(event, round) || !ports.attend.allowed('anniversary')) return;
    await attempt(event, round);
  }
  // A kiss that outlived its round's visit window is gone (the game's window bounds
  // every kiss, kiss).
  function expireKiss() {
    const old = root.__partyAnniversaryKissOperation;
    if (!old || ports.now() - Number(old.startedAt || 0) <= ANNIVERSARY_WINDOW_MS) return;
    old.cancelled = true;
    root.__partyAnniversaryKissOperation = null;
    s.busy = false;
  }
  // The fighter's round finished (returned, superseded or handed to a combat event) inside its
  // window: the staging walk stops and the poll looks for a live event.
  async function settleFinished(): Promise<boolean> {
    const cycle = s.plan?.eventCycle;
    if (merchant() || !cycle || !(cycle.returnCompletedAt || cycle.supersededAt || cycle.combatHandoffAt) || !(ports.now() <= Number(cycle.endsAt))) return false;
    const staging = root.__partyAnniversaryStagingOperation;
    if (staging) {
      staging.cancelled = true;
      if (staging.revision === ports.walk.revision() && movementOurs()) await stopOurs(['smart']);
      if (root.__partyAnniversaryStagingOperation === staging) { root.__partyAnniversaryStagingOperation = null; s.busy = false; }
    }
    s.staging = false;
    if (ports.eventsEnabled() && ports.attend.active()) pollSoon();
    return true;
  }
  // A live event, its travel, an exit or a combat handoff owns the fighter: the poll acts now.
  function yieldToCombat(): boolean {
    const cycle = s.plan?.eventCycle;
    if (merchant() || !ports.eventsEnabled() || !(ports.attend.active() || ports.attend.traveling() || ports.exitPending() ||
        cycle?.combatHandoffAt && ports.now() <= Number(cycle.endsAt))) return false;
    if (!s.busy) s.staging = false;
    pollSoon();
    return true;
  }
  function noRound() {
    const was = s.staging;
    s.staging = false;
    if (merchant()) { s.merchant.mode = 'idle'; s.merchant.retryAt = 0; s.merchant.featuredHold = false; }
    if (was && ports.eventsEnabled()) pollSoon();
  }
  // The featured hold ends once no other party member holds an unclaimed visit ticket (the
  // coordinator's `featuredVisitsPending`): the round stays live for its window, but the visit does
  // not hold the party from farming past it.
  function releaseFeatured(event: AnniversaryRound): boolean {
    const cycle = s.plan?.eventCycle;
    if (event.live === false || s.plan?.featuredVisitsPending ||
        !(event.target === ports.character().name || s.plan?.partyFeatured)) return false;
    s.staging = false; s.merchant.featuredHold = false;
    s.stage = 'featured hold complete; returning to normal work';
    if (merchant()) { s.merchant.mode = 'complete'; root.__merchantAnniversaryReleasedRound = roundId(event, ticket()); }
    else if (!cycle?.combatHandoffAt) reportReturn(roundId(event, ticket()));
    return true;
  }
  // The coordinator's cycle keeps the party staged until it dispatches the return, even after a
  // broken round leaves the server's status.
  async function holdCycle(event: AnniversaryRound): Promise<boolean> {
    const cycle = s.plan?.eventCycle;
    if (cycle?.returnCompletedAt) s.staging = false;
    if (!merchant() && event.live !== false && !cycle) reportStaging(event);
    if (merchant() || !cycle || cycle.returnDispatchedAt || cycle.combatHandoffAt) return false;
    s.staging = true;
    if (ports.now() >= Number(cycle.endsAt)) {
      s.stage = 'anniversary ended; awaiting farming convoy';
      reportReturn(String(cycle.liveRound || cycle.id));
      return true;
    }
    if (event.live !== false) return false;
    await stageInMain(event);
    s.stage = 'holding in Main until anniversary deadline';
    return true;
  }
  // The visit ticket goes before the buff arrives, so a kiss whose reply was lost shows in the buff
  // or the slice: the next pass records the round as kissed, for the merchant too.
  function recovered(event: AnniversaryRound, round: string, kissed: boolean): boolean {
    const prior = root.__partyAnniversaryAttempt;
    if (event.live === false || ticket() || kissed || !prior || prior.round !== round || !succeeded(prior.before, prior.buffMsBefore)) return false;
    const slice = anniversarySlices.find(name => ports.game.quantity(name) > Number(prior.before[name] || 0)) || null;
    completed[round] = { at: ports.now(), target: event.target, slice, recoveredFromBuff: true } satisfies Completed;
    s.busy = false; s.staging = false;
    s.stage = 'kiss buff confirmed; returning to farming';
    if (merchant()) s.merchant.mode = 'complete';
    else if (slice) root.__anniversaryPendingHandoff = { round, slice, attempted: false };
    ports.log('Anniversary kiss buff confirmed after the visit response; returning to farming', '#ff69b4');
    claim(round, event, slice, false);
    if (!merchant() && !slice) reportReturn(round);
    return true;
  }
  // The claim, and the merchant's advert of the round.
  function claim(round: string, event: AnniversaryRound, slice: string | null, logAdvert: boolean) {
    ports.request('/anniversary/claim', { method: 'POST', body: { character: ports.character().name, round, target: event.target, slice } })
      .catch(error => ports.log('Anniversary claim report failed: ' + text(error), '#f0b429'));
    if (!merchant()) return;
    ports.request('/anniversary/advertise', { method: 'POST', body: { round } }).then(plan => plan && plan.message ? marginCall('say', () => ports.game.say(plan.message), 'Chat advertisement') : undefined)
      .catch(error => { if (logAdvert) ports.log('Anniversary advertisement failed: ' + (error.message || error), '#f0b429'); });
  }
  // The merchant's rows: it stays at its stand through the lead-up, holds there when featured, and
  // kisses only between jobs, once per round, after a failed attempt's wait.
  async function merchantRow(event: AnniversaryRound, preWindow: boolean, designated: boolean, kissed: boolean): Promise<boolean> {
    const m = s.merchant, expires = ports.epoch(event.expires);
    m.featuredHold = false;
    if (preWindow) {
      // Gathering is the merchant's own trip: the lead-up interrupts one in flight once, and it stays
      // paused until the kiss is done.
      if (m.mode !== 'leadup-at-stand' && ports.merchant.gathering()) { await stopOurs(['smart']); await stopOurs(['move']); }
      m.mode = 'leadup-at-stand';
      s.stage = ports.character().stand ? 'at stand; anniversary round approaching' : 'anniversary round approaching';
      s.staging = false;
      return true;
    }
    if (event.live === false || !event.target || !expires || expires <= ports.now()) { m.mode = 'idle'; m.retryAt = 0; s.staging = false; return true; }
    if (designated) {
      m.mode = 'featured-hold'; m.featuredHold = true; s.staging = true;
      s.stage = ports.merchant.holder() ? 'featured; finishing current merchant job' : 'featured player holding at stand';
      return true;
    }
    if (ports.merchant.holder()) { m.mode = 'waiting-for-job'; s.stage = 'finishing current merchant job before anniversary kiss'; return true; }
    if (kissed) { m.mode = 'complete'; m.retryAt = 0; return true; }
    if (event.available === false) { m.mode = 'waiting-available'; s.staging = false; s.stage = 'waiting for ' + event.target + ' to become available'; return true; }
    if (!retryReady(event, roundId(event, ticket()))) { m.mode = 'retry-wait'; s.stage = 'anniversary retry cooling down'; return true; }
    return false;
  }
  // The staging rows: Main through the lead-up and while featured, the return once a featured round
  // ends, a hold with a featured member, and a wait for an unavailable target.
  async function stageRow(event: AnniversaryRound, preWindow: boolean, designated: boolean, kissed: boolean): Promise<boolean> {
    const expires = ports.epoch(event.expires), partyFeatured = !!s.plan?.partyFeatured;
    if (preWindow || event.live !== false && expires > ports.now() && designated) {
      if (!merchant() || designated) s.staging = true;
      reportStaging(event);
      await stageInMain(event);
      s.stage = inMain() ? (designated ? 'featured player holding in Main' : 'waiting in Main for anniversary') : 'returning to Main for anniversary';
      return true;
    }
    if ((designated || partyFeatured) && expires && expires <= ports.now()) {
      s.staging = false;
      reportReturn(roundId(event, ticket()));
      if (ports.eventsEnabled()) pollSoon();
      return true;
    }
    if (event.live === false || !event.target || !ticket()) {
      if (partyFeatured && expires > ports.now() && !ports.attend.joined()) {
        s.staging = true;
        await stageInMain(event);
        s.stage = inMain() ? 'holding with featured party member in Main' : 'returning to Main for anniversary';
        return true;
      }
      if (!designated && (kissed || event.live !== false)) s.staging = false;
      return true;
    }
    if (event.available === false) {
      s.staging = true;
      reportStaging(event);
      await stageInMain(event);
      s.stage = inMain() ? 'waiting for ' + event.target + ' to become available' : 'returning to Main for anniversary';
      return true;
    }
    return false;
  }

  // The kiss itself: approaches reserved with the coordinator, each walked, found, kissed and confirmed
  // by the kiss reply. Another approach follows a failed one while it brought the character closer to
  // the featured player; the attempts end when an approach made no progress or the reply's reason
  // leaves nothing to try, and the coordinator hears that end (`ended`) with the reason.
  async function attempt(event: AnniversaryRound, round: string) {
    const visit = ticket(), c = ports.character();
    s.busy = true; s.round = round; s.lastAttemptAt = ports.now();
    if (s.responsesRound !== round) { s.responses = []; s.responsesRound = round; }
    const operation: Operation = { round, target: event.target, startedAt: s.lastAttemptAt, navigationRevision: ports.walk.revision(), generation: ports.generation() };
    root.__partyAnniversaryKissOperation = operation;
    const current = () => {
      if (ports.huntTurnIn() || operation.cancelled || !ports.current() || root.__partyAnniversaryKissOperation !== operation || aborted(event) ||
          ports.epoch(event.expires) <= ports.now() || !ports.attend.selected('anniversary') || operation.navigationRevision !== ports.walk.revision()) throw cancelled();
    };
    if (merchant()) { s.merchant.mode = 'kiss-active'; s.merchant.attemptAt = s.lastAttemptAt; s.merchant.retryAt = 0; }
    const before: Record<string, number> = {};
    for (const name of anniversarySlices) before[name] = ports.game.quantity(name);
    const buffBefore = c.s?.anniversary_kiss ? Number(c.s.anniversary_kiss.ms) || 0 : null;
    root.__partyAnniversaryAttempt = { round, before, buffMsBefore: buffBefore };
    s.failed = null;
    try {
      if (merchant() && ports.character().stand) await closeStand(event, current);
      let earned: string | null = null, closest = Infinity;
      for (;;) {
        current();
        const latest = ports.round();
        if (latest && roundId(latest, visit) === round) event = latest;
        const reservation = await ports.request('/anniversary/attempt', { method: 'POST', body: {
          character: c.name, round, target: event.target, navigationRevision: operation.navigationRevision } });
        current();
        operation.attempt = Number(reservation.attempt) || 1;
        try {
          earned = await visitOnce(event, round, visit, operation, current, before, buffBefore);
          break;
        } catch (error) {
          if ((error as { cancelled?: boolean }).cancelled) throw error;
          current();
          if (succeeded(before, buffBefore)) break;
          const target = featured(event), gap = target ? gapTo(target) : Infinity, closer = gap < closest;
          closest = Math.min(closest, gap);
          if (!closer || (error as { final?: boolean }).final || !merchant() && ports.attend.active()) {
            (error as { failureReason?: string }).failureReason ||= 'kiss-unconfirmed';
            (error as { ended?: boolean }).ended = true;
            throw error;
          }
          s.stage = 'retrying approach (' + (operation.attempt + 1) + ')';
          await ports.request('/anniversary/failure', { method: 'POST', body: { character: c.name, round, target: event.target, attempt: operation.attempt,
            navigationRevision: operation.navigationRevision, failureReason: (error as { failureReason?: string }).failureReason || 'kiss-unconfirmed', error: String((error as Error).message || error) } });
        }
      }
      confirmed(event, round, earned);
    } catch (error) {
      if ((error as { cancelled?: boolean }).cancelled || operation.cancelled || !ports.current()) return;
      // The coordinator refuses the reservation while its own read of the round is behind this
      // character's feed, as at the round's first update. No kiss went out, so this is no failed
      // attempt: the next poll asks again, with no wait for a change at the featured player.
      if (/stale anniversary attempt/.test(text(error))) { s.stage = 'waiting for the coordinator to see the round'; return; }
      await retry(event, round, operation, error);
    } finally {
      if (root.__partyAnniversaryKissOperation === operation) { s.busy = false; root.__partyAnniversaryKissOperation = null; }
      if (!merchant() && ports.attend.active()) pollSoon();
    }
  }
  // The stand closes on the game's reply; the kiss waits for the character's `stand` to clear at the
  // game's resends after it, within the round.
  async function closeStand(event: AnniversaryRound, current: () => void) {
    s.stage = 'closing stand before anniversary kiss';
    ports.log('Closing merchant stand before anniversary travel', '#ff69b4');
    await marginCall('close_stand', () => ports.game.closeStand(), 'Stand close');
    while (ports.character().stand) { await nextUpdate(ports.epoch(event.expires), 'player'); current(); }
    current();
  }
  // One approach: walk to the featured player (or its spot), find it, close to the kiss reach, kiss,
  // and read the reward from the kiss reply. Returns the slice earned, or throws.
  async function visitOnce(event: AnniversaryRound, round: string, visit: Ticket | undefined, operation: Operation, current: () => void,
      before: Record<string, number>, buffBefore: number | null): Promise<string | null> {
    s.stage = 'travelling to ' + event.target + ' (' + operation.attempt + ')';
    ports.clearTarget();
    try { await ports.walk.endFollow(ports.walk.request); } catch (_) { /* nothing of ours moves */ }
    current();
    let target = featured(event);
    const c = () => ports.character(), expires = ports.epoch(event.expires);
    if (!target || !inReach(target)) {
      const point = target ? { map: target.map || c().map, x: Number(target.x), y: Number(target.y) } : { map: event.map || 'main', x: Number(event.x) || 0, y: Number(event.y) || 0 };
      // Most targets stand in Main's square, where one direct move does without the pathfinder.
      const direct = c().map === point.map && ports.game.canMoveTo(point.x, point.y);
      const label = 'anniversary kiss -> selected player ' + event.target + ' at ' + point.map + ' (' + Math.round(point.x) + ', ' + Math.round(point.y) + ')';
      ports.log((direct ? 'Direct move started: ' : 'Path search started: ') + label, '#ff69b4');
      if (!ports.attend.allowed('anniversary')) throw cancelled();
      await approach(point, direct, event, operation, current);
      current();
      ports.log('Movement finished: ' + label, '#ff69b4');
    }
    // The feed carries the featured player's place each event tick; the search follows it until the
    // player shows, the feed names it unavailable or another target, or the round ends.
    s.stage = 'looking for ' + event.target;
    while (!(target = featured(event))) {
      const latest = ports.round();
      if (!latest || latest.target !== event.target || latest.available === false) break;
      await nextUpdate(expires);
      current();
    }
    current();
    if (!target) throw failure('featured player ' + event.target + ' is not visible', 'target-missing');
    // Close in on the player itself while each move brings the character closer.
    let gap = gapTo(target);
    while (target && !inReach(target)) {
      await approach({ map: c().map, x: Number(target.x), y: Number(target.y) }, true, event, operation, current);
      current();
      target = featured(event);
      if (!target || gapTo(target) >= gap) break;
      gap = gapTo(target);
    }
    if (!target || !inReach(target)) throw failure('featured player moved out of kissing range', 'target-unreachable');
    const selection = ports.round();
    if (!selection || selection.target !== event.target || roundId(selection, visit) !== round) throw failure('featured player changed', 'target-unreachable');
    s.stage = 'kissing ' + event.target;
    // The game's own kiss names the round's event id, not the player entity. The server answers
    // from inside its handler (server.js:9821-10080) with `rewarded` and `reason`, so once the call
    // budget sends it the reply is due within one `calls.margin`, and the round's end bounds it.
    let reply = null as KissReply;
    try {
      const id = event.id || (target as { id?: unknown }).id;
      reply = await marginCall('skill', () => ports.game.useSkill('ikissyou', id), 'Anniversary kiss', { name: 'ikissyou', id },
        Math.min(callMargin(), Math.max(1, expires - ports.now()))) as KissReply;
    } catch (error) {
      current();
      if (FINAL_REASONS.includes(String((error as { reason?: unknown })?.reason || ''))) (error as { final?: boolean }).final = true;
      if (!/timed out/i.test(String((error as Error).message || error))) throw error;
      // A lost reply: the game's resend after a kiss shows its buff or its slice.
      await nextUpdate(expires, 'player');
      current();
      if (!succeeded(before, buffBefore)) { (error as { failureReason?: string }).failureReason = 'kiss-timeout'; throw error; }
    }
    current();
    if (reply && reply.rewarded === false)
      throw Object.assign(failure('anniversary kiss not rewarded: ' + String(reply.reason || 'no_visit'), 'kiss-unconfirmed'), { final: FINAL_REASONS.includes(String(reply.reason)) });
    // The game delivers the slice inside the kiss's handler and resends the bag after it, so the
    // next resend carries it.
    const slice = () => anniversarySlices.find(name => ports.game.quantity(name) > before[name]) || null;
    if (!slice()) { await nextUpdate(expires, 'player'); current(); }
    return slice();
  }
  // A confirmed kiss: the round is kissed, a fighter's slice waits for the merchant, and without a
  // live event the fighter keeps the handoff's staging; with one, the poll acts now.
  function confirmed(event: AnniversaryRound, round: string, earned: string | null) {
    completed[round] = { at: ports.now(), target: event.target, slice: earned } satisfies Completed;
    if (earned && !merchant()) root.__anniversaryPendingHandoff = { round, slice: earned, attempted: false };
    s.stage = 'kiss confirmed';
    if (merchant()) s.merchant.mode = 'complete';
    ports.log('Anniversary kiss confirmed: ' + event.target + (earned ? ' · received ' + earned : ''), '#ff69b4');
    claim(round, event, earned, true);
    if (merchant()) return;
    const live = ports.attend.active();
    s.staging = !!earned && !live;
    if (!earned && !live) reportReturn(round);
    if (live) pollSoon();
  }
  // A failed attempt is tried again once the kiss skill is ready (`G.skills.ikissyou.cooldown`, read
  // as the client's `next_skill`) and the feed or the character shows a change since the failure:
  // the featured player moved or became available, or this character moved.
  async function retry(event: AnniversaryRound, round: string, operation: Operation, error: any) {
    s.stage = 'retrying';
    const c = ports.character();
    s.failed = { round, target: event.target, x: event.x, y: event.y, available: event.available, map: c.map, at: { x: c.x, y: c.y } };
    if (merchant()) { s.merchant.mode = 'retry-wait'; s.merchant.retryAt = ports.game.readyAt('ikissyou'); }
    ports.log('Anniversary kiss retry for selected player ' + event.target + ' at ' + (event.map || 'main') + ' (' + (Number(event.x) || 0) + ', ' +
      (Number(event.y) || 0) + '): ' + text(error), '#f0b429');
    await ports.request('/anniversary/failure', { method: 'POST', body: { character: ports.character().name, round, target: event.target,
      attempt: operation.attempt || 0, failureReason: error.failureReason || 'kiss-unconfirmed', ended: !!error.ended,
      navigationRevision: operation.navigationRevision, error: text(error), responses: s.responses } }).then(async result => {
      if (!ports.current()) return;
      if (result.anniversary) s.plan = result.anniversary;
      await abort();
    }).catch(failure => ports.log('Anniversary failure report failed: ' + text(failure), '#f0b429'));
  }
  function retryReady(event: AnniversaryRound, round: string): boolean {
    if (ports.now() < ports.game.readyAt('ikissyou')) return false;
    const failed = s.failed, c = ports.character();
    if (!failed || failed.round !== round) return true;
    const changed = failed.target !== event.target || failed.x !== event.x || failed.y !== event.y || failed.available !== event.available ||
      failed.map !== c.map || failed.at.x !== c.x || failed.at.y !== c.y;
    if (changed) s.failed = null;
    return changed;
  }
  // The fighter keeps its handoff's staging until the slice is handed over, except while a featured
  // live round still has a party visit pending.
  function releaseHandoff(round: unknown) {
    const event = ports.round();
    if (event) {
      if (event.live === false || String(round) !== roundId(event, ticket())) return;
      if ((event.target === ports.character().name || s.plan?.partyFeatured) && s.plan?.featuredVisitsPending) return;
    } else if (s.round && String(round) !== String(s.round)) return;
    s.staging = false;
  }
  // The slice handoff: a fighter sends its slice to a merchant in send reach once; the merchant
  // walks to a fighter that reported one and waits for the send.
  async function handoff() {
    if (s.busy || ports.character().rip || ports.merchant.forceStand() || !s.plan) return;
    if (merchant()) return collect();
    if (ports.eventsEnabled() && (ports.attend.active() || ports.attend.traveling() || ports.exitPending() || ports.attend.joined())) return;
    let pending = root.__anniversaryPendingHandoff;
    if (!pending) {
      // A confirmed kiss released the fighter to combat, which kept the slice; the coordinator's list
      // names it again.
      const found = (s.plan.handoffTargets || []).find(entry => entry.name === ports.character().name && ports.game.slot(entry.slice) >= 0);
      if (found) pending = root.__anniversaryPendingHandoff = { round: found.round, slice: found.slice, attempted: false };
    }
    if (!pending) return;
    const round = pending.round;
    const done = () => {
      root.__anniversaryPendingHandoff = null;
      releaseHandoff(round);
      if (!ports.attend.active()) reportReturn(String(round));
    };
    if (pending.attempted) return done();
    pending.attempted = true;
    // The console's merchant, which the plan names; with none named the fighter sends nothing.
    const c = ports.character(), merchantEntity = s.plan.merchant ? ports.game.player(s.plan.merchant) : null;
    if (!merchantEntity || merchantEntity.map !== c.map || Math.hypot(merchantEntity.x - c.x, merchantEntity.y - c.y) > SEND_REACH) return done();
    const slot = ports.game.slot(pending.slice);
    if (slot < 0) return done();
    s.busy = true;
    s.stage = 'delivering slice to merchant';
    try {
      await ports.game.send(merchantEntity.name!, slot, 1);
      await ports.request('/anniversary/handoff', { method: 'POST', body: { character: c.name, round: pending.round, slice: pending.slice } });
      s.stage = 'slice delivered';
    } catch (_) {
      s.stage = 'slice handoff attempted';
    } finally {
      done();
      s.busy = false;
    }
  }
  // The merchant walks to a fighter the coordinator lists (present, holding a claimed slice), then
  // waits for the fighter's answer: the fighter's tick sends once the merchant is in reach and posts
  // /anniversary/handoff, and the entry leaves the list (coordinator/anniversary.ts
  // anniversaryHandoffs). A fighter report with no send ends the wait too: the listed entry names a
  // new position, slice or event, as when the fighter walks off to an event, and the
  // changed entry is tried again. A wait the merchant's own state ends marks the entry tried, and it
  // is tried again once the fighter's report shows a change. The list comes with
  // the merchant's own report's reply, so the wait reads it on each report and ends when the
  // merchant's reports fall silent, since no new list can come then.
  async function collect() {
    if (ports.merchant.holder() || ports.merchant.gathering() || ports.merchant.errand()) return;
    const tried = (entry: Handoff) => [entry.map, entry.x, entry.y, entry.slice, entry.round].join(':');
    const target = (s.plan!.handoffTargets || []).find(entry => entry && !entry.event && entry.ctype !== 'merchant' &&
      s.collectTried[entry.name] !== tried(entry) && entry.server === ports.game.realm());
    if (!target) return;
    s.busy = true;
    s.stage = 'collecting slice from ' + target.name;
    const walkedTo = s.collectTried[target.name] = tried(target);
    const current = () => ports.current() && !ports.character().rip && !ports.merchant.holder() && !ports.merchant.gathering() && !ports.merchant.forceStand();
    const listed = () => (s.plan!.handoffTargets || []).find(entry => entry.name === target.name && entry.slice === target.slice);
    try {
      if (ports.character().stand) await marginCall('close_stand', () => ports.game.closeStand(), 'Stand close');
      if (!current()) return;
      await ports.walk.smart({ map: target.map, x: Number(target.x), y: Number(target.y) }, ports.walk.request);
      // The fighter owns the send: its anniversary tick sees the merchant and hands over.
      const unchanged = () => { const entry = listed(); return !!entry && !entry.event && tried(entry) === walkedTo; };
      while (current() && unchanged()) if (!await ports.nextReport()) break;
      const left = listed();
      if (left && !current()) s.collectTried[target.name] = tried(left);
    } catch (_) {
      s.stage = 'collection retrying';
      if (current()) await stopOurs(['smart']);
    } finally {
      s.busy = false;
      ports.merchant.wake();
    }
  }

  // A slice another player sent the merchant: the coordinator decides the swap or the return, and a
  // reciprocal send that fails returns the slice or records the debt.
  function received(data: { response?: string; item?: string; name?: string } | null | undefined) {
    if (!ports.current() || !merchant() || !data || data.response !== 'item_received' || !anniversarySlices.includes(data.item!)) return;
    const event = ports.round(), sender = ports.game.player(data.name!), c = ports.character();
    const counts: Record<string, number> = {};
    for (const name of anniversarySlices) counts[name] = ports.game.quantity(name);
    ports.request('/anniversary/trade', { method: 'POST', body: { sender: data.name, owner: sender && (sender.owner || sender.owner_id || sender.account), item: data.item,
      counts, round: event && event.round || s.round || 'between-rounds', map: c.map, x: sender && sender.x || c.x, y: sender && sender.y || c.y,
      server: ports.game.realm() } }).then(async decision => {
      if (!decision || decision.action === 'ignore') return;
      const complete = (state: string) => decision.key ? ports.request('/anniversary/trade-complete', { method: 'POST', body: { key: decision.key, state } }) : undefined;
      try {
        const out = ports.game.slot(decision.item);
        if (out < 0) throw new Error('reciprocal slice is no longer available');
        await ports.game.send(data.name!, out, 1);
        await complete(decision.action === 'swap' ? 'completed' : 'returned');
        ports.log((decision.action === 'swap' ? 'Completed' : 'Returned') + ' anniversary slice trade with ' + data.name, '#ff69b4');
      } catch (sendError) {
        let returned = false;
        const back = ports.game.slot(data.item!);
        if (back >= 0) { try { await ports.game.send(data.name!, back, 1); returned = true; } catch (_) { /* The debt is recorded below. */ } }
        await complete(returned ? 'returned' : 'return_owed');
        if (!returned) throw sendError;
        ports.log('Returned ' + data.name + "'s slice because our reciprocal transfer failed", '#f0b429');
      }
    }).catch(error => { ports.log('Anniversary trade needs attention: ' + text(error), 'red'); });
  }
  // The merchant pays an owed slice back, one at a time.
  async function repay() {
    if (!merchant() || s.busy || ports.merchant.forceStand() || ports.merchant.holder() || !s.plan?.pendingReturns?.length) return;
    const debt = s.plan.pendingReturns[0];
    s.busy = true;
    s.stage = 'returning slice to ' + debt.sender;
    try {
      if (ports.character().stand) await marginCall('close_stand', () => ports.game.closeStand(), 'Stand close');
      await ports.walk.smart({ map: debt.map || ports.character().map, x: Number(debt.x), y: Number(debt.y) }, ports.walk.returnRequest);
      const c = ports.character(), sender = ports.game.player(debt.sender);
      if (!sender || sender.map !== c.map || Math.hypot(sender.x - c.x, sender.y - c.y) > SEND_REACH) throw new Error(debt.sender + ' is not currently reachable');
      const slot = ports.game.slot(debt.item);
      if (slot < 0) throw new Error('owed slice is missing from merchant inventory');
      await ports.game.send(debt.sender, slot, 1);
      await ports.request('/anniversary/trade-complete', { method: 'POST', body: { key: debt.key, state: 'returned' } });
      s.stage = 'owed slice returned';
    } catch (_) { s.stage = 'return queued'; }
    finally { s.busy = false; }
  }
  // The merchant says the coordinator's advert once.
  async function advertise() {
    if (!merchant() || s.chatSending || s.busy || !s.plan?.chatAdvertisement) return;
    const pending = s.plan.chatAdvertisement;
    s.chatSending = true;
    try {
      await marginCall('say', () => ports.game.say(pending.message), 'Chat advertisement');
      await ports.request('/anniversary/chat-advertise-complete', { method: 'POST', body: { id: pending.id } });
    } catch (error) {
      ports.log('Anniversary chat advertisement retrying: ' + text(error), '#f0b429');
    } finally { s.chatSending = false; }
  }

  // The anniversary tick: the kiss, the advert, the owed slices, the handoff.
  // A stage that throws ends the tick with one game log line naming the stage, so the install may
  // drop the tick's promise.
  async function tick() {
    if (ports.paused() || ports.escaping()) return;
    try {
      await kiss();
      await advertise();
      await repay();
      await handoff();
    } catch (error) {
      ports.log('Anniversary ' + (s.stage || 'tick') + ' failed: ' + text(error), '#f0b429');
    }
    announcePhase();
  }
  // `anniversary.phase`: this member's phase in the round, read from the visit's own state
  // after each tick and announced when it changes: aborted, kissed (the round's kiss completed),
  // returning (the cycle's return runs), visiting (the kiss runs), staging, or none.
  let lastPhase: string | null = null;
  function announcePhase(): void {
    const event = ports.round(), round = event ? roundId(event, ticket()) : null, cycle = s.plan?.eventCycle;
    const phase = !event ? null : aborted(event) ? 'aborted' : round && completed[round] ? (cycle && !cycle.returnCompletedAt && s.busy ? 'returning' : 'kissed')
      : root.__partyAnniversaryKissOperation ? 'visiting' : s.staging || s.busy ? 'staging' : null;
    if (phase === lastPhase) return;
    lastPhase = phase;
    if (phase) partyHooks().notify('anniversary.phase', { round, member: ports.character().name, phase, by: 'core:events' });
  }
  // The game's replies while a kiss runs, kept for the round's failure report.
  function response(data: unknown) {
    if (!root.__partyAnniversaryKissOperation || !data) return;
    const entry = typeof data === 'object' ? data as Record<string, unknown> : null, name = entry ? entry.response : data;
    if (!name) return;
    s.responses.push({ at: ports.now(), response: name, place: entry?.place || null, failed: !!entry?.failed, reason: entry?.reason || null });
  }

  // The visit yields to a live event the poll joins (attend.ts): the staging walk stops.
  async function yieldTo(event: string, staging: Operation | null) {
    if (staging) {
      staging.cancelled = true;
      if (staging.revision === ports.walk.revision() && movementOurs()) await stopOurs(['smart', undefined]);
      if (root.__partyAnniversaryStagingOperation === staging) root.__partyAnniversaryStagingOperation = null;
    }
    s.busy = false; s.staging = false;
    s.stage = 'joining ' + event;
  }
  // The round's return started: its origin and reports go so a later round captures its own.
  function clearReturn() { root.__anniversaryReturnLocation = null; s.stagingReported = null; s.returnReported = null; }
  // A return command (the anniversary's, the event's, or a walk back to the farming spot the staging
  // captured) ends the round's staging.
  function commandReturns(command: { purpose?: string; label?: string }) {
    if (!(command.purpose === 'anniversary-return' || command.purpose === 'event-return' ||
        root.__anniversaryReturnLocation && command.label && /pre-event|farming location/i.test(command.label))) return;
    clearReturn();
    s.staging = false;
    s.stage = 'returning to regular farming';
  }
  function resumed() { s.staging = false; s.stage = 'returning to saved farming waypoint'; }
  // The player deselected the anniversary: the kiss ends and the coordinator hears of it.
  async function disabled() {
    const old = root.__partyAnniversaryKissOperation;
    if (old) old.cancelled = true;
    if (movementOurs()) await stopOurs(['smart', undefined]);
    s.busy = false; s.staging = false;
    root.__partyAnniversaryKissOperation = null;
    s.merchant.featuredHold = false; s.merchant.retryAt = 0;
    s.stage = 'anniversary disabled; resuming previous activity';
    const result = await ports.request('/event-disabled', { method: 'POST', body: { character: ports.character().name, event: 'anniversary' } });
    if (result.anniversary) s.plan = result.anniversary;
  }
  function receive(plan: AnniversaryPlan | null | undefined) { s.plan = plan || s.plan; }
  // The heartbeat's `anniversaryState`; the merchant's completed round is merchant.ts's.
  function report(completedRound: string | null) {
    const operation = root.__partyAnniversaryKissOperation;
    return { busy: s.busy, stage: s.stage, round: s.round, kiss: !merchant() && operation ? String(operation.startedAt) : null, completedRound,
      mode: s.merchant.mode, attemptAt: s.merchant.attemptAt, retryAt: s.merchant.retryAt, featuredHold: s.merchant.featuredHold,
      craftResult: root.__anniversaryCraftResult || null };
  }

  // The anniversary's staging holds a deploy's drain until it ends.
  partyHooks().publish({ name: 'core:events-anniversary', folder: 'core', author: 'adventureland-party-console',
    summary: "Holds a deploy's drain while the anniversary stages its items.",
    hooks: { 'lifecycle.ready': () => s.busy ? { ready: false, reason: 'the anniversary is staging' } : { ready: true } } });
  return {
    tick, kiss, response, received, updated, abort, roundId, roundAborted: aborted, yieldTo, clearReturn, commandReturns, resumed, disabled, receive, report,
    busy: () => s.busy, staging: () => s.staging, plan: () => s.plan, completed: () => completed,
    operation: () => root.__partyAnniversaryStagingOperation || null, kissOperation: () => root.__partyAnniversaryKissOperation || null,
    merchantState: () => ({ busy: s.busy, mode: s.merchant.mode, retryAt: s.merchant.retryAt }),
  };
}
Object.assign(globalThis, { installEventAnniversary });
