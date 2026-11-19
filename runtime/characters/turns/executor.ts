import type { CombatRoot, CombatState, Role, Target } from './role-types.ts';
import { SPEND_RANKS, type SpendRank } from '../../protocol/ranks.ts';
import type { CallAnswer, CallQuestion, SpendAsk, SpendRequester } from '../../hooks/registry.ts';
import { createMovementRing } from '../../protocol/records.ts';
import { cost as skillCost, entriesMp, reserve as classReserve, unlocked } from './skills/eligibility.ts';
import type { SkillId, SkillWorld } from './skills/types.ts';
import { cooldownOf, errorReason, familyOf, familyTable, readyKey, type CoreAsk, type PassKind, type Readiness, type Skills, type TargetAnswer,
  type TurnsRecord, type TurnsView } from './api.ts';
import { forecast, mpRefusal, replyRow, type Hold } from './rules.ts';
import { healFirstBelowOf } from './saved-fields.ts';
import { boundFired } from '../../status/api.ts';

// The turns owner's executor: one
// executor for every cooldown spend. Requesters ask; once per pass it reads the spend table once, ranks each
// cooldown family's requests by the rank table and sends the highest of each ready family, asking the call
// budget first. Each send, reply, refusal and wait is a notice.

interface Spend extends CoreAsk { by: string; family: string; push?: { resolve(value: unknown): void; reject(error: unknown): void } }
interface Flight { spend: Spend; family: string; place: string; epoch: number; sentAt: number; cooldownMs: number; mp: number; targetId?: string }
// The A/B feed's requester (ab-feed.ts `feedPush`).
const AB_FEED = 'core:turns/ab-feed';
// The attack family's source (attack.ts), which the spend table's H8 refuses while the Cave revival holds the priest.
export const ATTACK_SOURCE = 'core:turns/attack';
interface Hooks {
  skillRequests(view: unknown): { registration: string; requester: SpendRequester; answer: SpendAsk }[];
  turns: { target(view: unknown): unknown; allows(monster: unknown, skill: string): string | undefined };
  skills: { refuses(ask: SpendAsk & { family: string }): string | undefined };
  calls: { band(question: CallQuestion): CallAnswer; margin(): number; window(): number };
  notify(hook: never, payload: Record<string, unknown>): unknown;
}
// The lifecycle owner's run scope handle (runtime/lifecycle/character/run.ts `ScopeHandle`), the part turns uses.
export interface TurnsScope {
  setTimeout(callback: () => void, ms: number): number;
  afterUpdate(callback: () => void): void;
  clearTimeout(id: number | null | undefined): void;
  on(target: unknown, event: string, listener: (data: any) => void): void;
  off(target: unknown, event: string, listener: (data: any) => void): void;
}
export interface TurnsPorts {
  hooks: Hooks;
  // The turns owner's run scope handle, `act`: the pass's timers and the game
  // packets that wake it wait while table P holds the character, and the generation's stop ends them.
  scope: TurnsScope;
  epoch(): number;
  // The spend table read once for this pass (rules.ts `hold`).
  hold(): Hold;
  role(): Role;
  world(): SkillWorld;
  state(): CombatState;
  // "Heal first below" as the character's last report reply delivered it (3.9).
  healFirstBelow(): unknown;
}
export interface PassRead { hold: Hold; target: TargetAnswer | null }
type Reply = { place?: string; failed?: boolean; reason?: string; response?: string; ms?: number; id?: unknown; target?: unknown };
interface Host { next_skill?: Record<string, Date | number | undefined>; pings?: number[]; last_draw?: Date | number;
  socket?: { on?(event: string, listener: (data: Reply) => void): void; off?(event: string, listener: (data: Reply) => void): void } }
export interface Turns {
  family(skill: string): string;
  readyKey(skill: string): string;
  families(): Record<string, string[]>;
  // One pass; it returns the spend table read and the target answer it ran on, which the role loop reads for
  // the class decisions.
  pass(kind: PassKind): PassRead | null;
  // The spend table read: the open pass's, else a read of its own. Every `skills.allows` inside one
  // pass asks the same table the pass ran on.
  hold(): Hold;
  // The game update the character is on: the game clock's reading at its last draw.
  update(): number;
  // Runs `callback` once at the first draw of a later game update.
  afterNextUpdate(callback: () => void): void;
  // The earliest time a family spent since it was last ready is ready again, or null.
  nextReady(): number | null;
  spend(ask: CoreAsk & { by: string }): Promise<unknown>;
  ready(skill: string, member?: string): Readiness;
  // The attack family's edge: a pass at its ready time (3.4), or at `at` when that is later, the
  // time a step brings the target into range.
  armAttack(at?: number): void;
  // The priest's A8 forecast (rules.ts the MP table), or null for another class.
  forecast(): number | null;
  attackFlight(): { targetId?: string; sentAt: number } | null;
  // The lost-reply margin: the call budget's, and every family's own reply times.
  margin(): number;
  // The one ledger (3.6): the MP of every spend in flight, and whether a family has one in flight.
  inFlightMp(): number;
  flying(family: string): boolean;
  records(): (TurnsRecord & { seq: number; at: number })[];
  // A refusal the turns owner meets outside a spend, such as movement's refusal of the ranking's
  // position step, recorded in the same ring.
  refused(entry: { family: string; skill: string; reason: string; by: string }): void;
  meter(): { passes: number; totalMs: number; maxMs: number; sends: number; updates: number; byKind: Record<string, number> };
  reset(): void;
  start(): void;
  stop(): void;
}

// A potion goes as the game's `use` sends it (functions.js:5377-5397): an `equip` of the last
// inventory slot whose item gives the pool, else a `use` of the pool, which the server answers as
// regeneration. The call budget prices the potion from that slot (call-budget.ts:222-224).
function potionSlot(pool: 'hp' | 'mp'): number | null {
  const items = (character.items || []) as ({ name: string } | null)[];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i], gives = item ? (G.items as unknown as Record<string, { gives?: [string, number][] } | undefined>)[item.name]?.gives : undefined;
    if (gives?.some(([stat, value]) => stat === pool && value > 0)) return i;
  }
  return null;
}
const ids = (targets: CoreAsk['targets']) => (targets || []).map(t => t.id || t.name || '');

export function createExecutor(root: CombatRoot & { __partyTurns?: Turns }, ports: TurnsPorts): Turns {
  const skills: Skills = G.skills;
  const table = familyTable(skills);
  const host = parent as unknown as Host;
  const flights = new Map<string, Flight>();
  // The server's `cooldown` reply names the time left on its clock (server.js:9869-9873); the
  // family waits it out, since no such reply moves the client's `next_skill`.
  const waitUntil = new Map<string, number>();
  // A rejection for another reason holds the same skill and targets for one round trip (3.4).
  const refusedUntil = new Map<string, number>();
  const waits = new Map<string, number>(), lastRefusal = new Map<string, string>();
  // The families spent since they were last ready, for `skills.readied`.
  const spent = new Map<string, string>();
  // The game's update each family last sent in or met a `cooldown` reply in. A family sends at most
  // once per update, since the decisions follow the update (the run scope's cadence) and each send
  // adds to the call cost the server disconnects on. A resend inside the update of a `cooldown` reply
  // meets the same server edge: the e2e stack's server answered `ms: 9` to 44 resends inside one
  // 250 ms clock window.
  const sentIn = new Map<string, number>();
  // An update is the game clock's reading at the game's last draw (game.js `draw` sets `last_draw`).
  // Draws run at the renderer's pace, so two draws at one clock reading are one update. A host with
  // no draw reads its clock.
  const update = () => { const at = Number(host.last_draw); return Number.isFinite(at) ? at : Date.now(); };
  const nextUpdate = () => { pass('edge'); };
  // The 1 ms timer before each draw lets a host with no draw, whose update is its clock, reach the
  // next millisecond; on the game each draw inside the same clock window checks again.
  function afterNextUpdate(callback: () => void) {
    const from = update();
    const check = () => {
      if (!running) return;
      if (update() !== from) callback();
      else ports.scope.setTimeout(() => ports.scope.afterUpdate(check), 1);
    };
    ports.scope.setTimeout(() => ports.scope.afterUpdate(check), 1);
  }
  // The ring takes the protocol ring's one bound (records.ts `MOVEMENT_RING_SIZE`).
  const ring = createMovementRing<TurnsRecord>(() => Date.now());
  // `updates` counts the game updates the passes ran in, and `byKind` the passes by what woke them.
  const meter = { passes: 0, totalMs: 0, maxMs: 0, sends: 0, updates: 0, byKind: {} as Record<string, number> };
  let meteredUpdate: number | null = null;
  // Each family's own replies, by the margin's rule: the largest within the call budget's window
  // (`calls.window`), and at least the latest.
  // A skill cast less often than once a window, such as Dash, then keeps its own latest reply time,
  // which can be longer than the attack's.
  const familyReplies = new Map<string, { at: number; rtt: number }[]>();
  const familyOwn = (fam: string, now: number) => {
    const own = familyReplies.get(fam) ?? [];
    const window = ports.hooks.calls.window();
    while (own.length > 1 && own[0]!.at < now - window) own.shift();
    familyReplies.set(fam, own);
    return own;
  };
  const familyMargin = (fam: string, now: number) => Math.max(ports.hooks.calls.margin(), ...familyOwn(fam, now).map(reply => reply.rtt));
  let timer: number | null = null, timerAt = Infinity, running = false;
  let attackOpen = false, epochSeen = ports.epoch();
  const clock = () => typeof performance === 'undefined' ? Date.now() : performance.now();
  const family = (skill: string) => skill === 'attack' ? 'attack' : familyOf(skills, skill);
  const notify = (hook: string, payload: Record<string, unknown>) => ports.hooks.notify(hook as never, { character: character.name, ...payload });
  const smallestPing = () => { const list = (host.pings || []).filter(p => Number.isFinite(p) && p >= 0); return list.length ? Math.min(...list) : null; };
  function readyAt(fam: string, skill: string): number {
    const key = fam === 'attack' ? 'attack' : readyKey(skills, skill), next = Number(host.next_skill?.[key]);
    return Math.max(Number.isFinite(next) ? next : 0, waitUntil.get(fam) ?? 0);
  }
  const inFlightMp = () => [...flights.values()].reduce((sum, f) => sum + f.mp, 0);
  function record(entry: Omit<TurnsRecord, 'part'>) { ring.push({ part: 'turns', ...entry }); }
  // A requester's booking (3.4 "Settle") at the send, the reply or the flight's end; an error it
  // throws goes to the card, so no booking failure passes unseen.
  function booking(book: () => void) {
    try { book(); } catch (error) { ports.state().error = errorReason(error); }
  }
  let world: SkillWorld | null = null;
  const lazyWorld = () => world ??= ports.world();
  const reserveOf = (): number => classReserve(lazyWorld());
  // TRN-023's diagnostic with the rank, the family and the requester. The basic
  // attack keeps its own `attackTiming`, as today.
  function diagnostic(s: Spend, status: 'selected' | 'accepted' | 'rejected' | 'skipped', reason = s.reason) {
    if (s.skill === 'attack') return;
    const state = ports.state();
    if (state) state.skill = { at: Date.now(), skill: s.skill as SkillId, targets: ids(s.targets), category: s.category,
      reserve: reserveOf(), reason, status, rank: s.rank, family: s.family, by: s.by };
  }
  // The MP a spend takes on the server: the basic attack and the heal take `mp_cost`
  // (server.js:3354-3356, 3397), a potion none.
  const skillCostOf = (s: Pick<Spend, 'skill' | 'family' | 'argument'>): number => {
    if (s.family === 'potion') return 0;
    if (s.skill === 'attack' || s.skill === 'heal') return Number(character.mp_cost) || 0;
    // Energize moves the amount it names, not a cost of its own (server.js `energize`).
    if (s.skill === 'energize' && Number.isFinite(Number(s.argument))) return Number(s.argument);
    return skillCost(lazyWorld(), s.skill as SkillId) + entriesMp(s.argument);
  };
  const mpOf = (s: Spend) => mpRefusal({ skill: s.skill, family: s.family, category: s.category, cost: skillCostOf(s), belowReserve: s.belowReserve },
    Number(character.mp) || 0, Number(character.mp_cost) || 0, inFlightMp(), reserveOf);
  // 3.3 step 3: the requester's rank, the spend table, the skill's unlock, the targeting owner's target rules, an add-on's refusal
  // and the MP table. The A/B feed's own pushes skip the targeting owner's target rules, today's "no target gate" for the feed
  // : its Curse goes to its own teammate, a player the gate refuses. Every other check and the band ask stay.
  function refusal(s: Spend, cap: SpendRank, h: Hold): string | null {
    if (!(s.rank in SPEND_RANKS) || SPEND_RANKS[s.rank] > SPEND_RANKS[cap]) return `rank ${s.rank} above its requester's ${cap}`;
    if (!h.combat && s.family !== 'potion') return 'Combat is off';
    if (!h.potions && (s.skill === 'use_hp' || s.skill === 'use_mp')) return 'Use potions is off';
    if (h.revive && s.by === ATTACK_SOURCE) return 'T1 H8: 05, the Cave revival holds the priest';
    if (s.skill !== 'attack' && s.skill !== 'heal' && s.family !== 'potion' && !unlocked(lazyWorld(), s.skill as SkillId)) return 'level, equipment, or requirements';
    const hostile = s.by !== AB_FEED && (s.skill === 'attack' || !!skills[s.skill]?.hostile);
    for (const t of hostile && s.targets?.length ? s.targets : [undefined]) {
      const refused = ports.hooks.turns.allows(t, s.skill);
      if (refused) return refused;
    }
    if (SPEND_RANKS[s.rank] < SPEND_RANKS.survival) {
      const refused = ports.hooks.skills.refuses({ skill: s.skill, targets: s.targets, argument: s.argument, rank: s.rank, category: s.category, reason: s.reason, family: s.family });
      if (refused) return refused;
    }
    const held = refusedUntil.get(s.skill + '|' + ids(s.targets).join(','));
    if (held !== undefined && Date.now() < held) return 'refused by the server within one round trip';
    return mpOf(s);
  }
  // 3.3 step 4, one call budget question per send: method `attack`, `heal`, `skill`, a potion's
  // `equip` with its slot, or `use` for regeneration.
  function question(s: Spend): CallQuestion {
    const t = s.targets?.[0];
    if (s.skill === 'attack' || s.skill === 'heal') return { band: 'survival', method: s.skill, data: { id: t?.id } };
    if (s.skill === 'use_hp' || s.skill === 'use_mp') {
      const num = potionSlot(s.skill === 'use_hp' ? 'hp' : 'mp');
      return num === null ? { band: 'survival', method: 'use', data: { item: s.skill.slice(4) } } : { band: 'survival', method: 'equip', data: { num } };
    }
    if (s.skill === 'regen_hp' || s.skill === 'regen_mp') return { band: 'survival', method: 'use', data: { item: s.skill.slice(6) } };
    const many = (s.targets?.length ?? 0) > 1 || !!skills[s.skill]?.multi;
    return { band: 'survival', method: 'skill', data: many ? { name: s.skill, ids: ids(s.targets) } : { name: s.skill, id: ids(s.targets)[0] } };
  }
  function drop(s: Spend, reason: string) {
    record({ kind: 'refusal', family: s.family, skill: s.skill, rank: s.rank, by: s.by, reason });
    notify('skills.dropped', { skill: s.skill, family: s.family, rank: s.rank, reason, by: s.by });
  }
  function send(s: Spend, waitedFrom: number | undefined, edge: number): void {
    const late = s.before?.();
    if (late) { drop(s, late); s.push?.reject({ reason: late }); return; }
    // The call goes in the same synchronous turn as the band's `send`.
    if (ports.hooks.calls.band(question(s)) !== 'send') {
      if (!waits.has(s.family)) { waits.set(s.family, Date.now()); notify('skills.waiting', { family: s.family, skill: s.skill, since: Date.now(), by: s.by }); }
      s.push?.reject({ reason: 'waiting' });
      return;
    }
    const t = s.targets?.[0];
    let reply: Promise<unknown>;
    try {
      // The basic attack and the heal go to the role runner's or survival's game entity (attack.ts,
      // survival's heal source); the engine's monsters ask only skills.
      if (s.skill === 'attack') reply = Promise.resolve(attack(t as Target));
      else if (s.skill === 'heal') reply = Promise.resolve(heal(t as Target));
      else {
        // The game's `use_skill(name, target, extra)`: a request with targets sends its argument after
        // them (Energize's amount); one with none sends the argument in the target's place (a
        // paladin aura's name). A skill whose game data names no `target` and no `multi`, such as
        // Cleave, takes no target, so its targets only name what it hits (1.5 row 8). A list of MP per
        // target goes as `[id, mp]` pairs in the target's place (Controlled Mana Burst,
        // server.js:9806-9819; the client's `use_skill`, functions.js:1684-1686).
        const data = skills[s.skill], untargeted = !!data && !data.target && !data.multi;
        const pairs = Array.isArray(s.argument) ? ids(s.targets).map((id, i) => [id, (s.argument as number[])[i]]) : null;
        const target = (s.targets?.length ?? 0) > 1 || data?.multi ? ids(s.targets) : ids(s.targets)[0];
        const args = pairs ? [pairs] : s.targets?.length && !untargeted ? [target, ...(s.argument === undefined ? [] : [s.argument])] : s.argument === undefined ? [] : [s.argument];
        reply = Promise.resolve((use_skill as (id: string, ...args: unknown[]) => unknown)(s.skill, ...args));
      }
    } catch (error) { reply = Promise.reject(error); }
    const q = question(s), place = q.method === 'skill' ? s.skill : q.method;
    // A potion with none in the bag goes as `use`, which the server answers as regeneration and
    // holds for regeneration's cooldown (server.js:12041-12048; game data `use_hp`).
    const cooldownSkill = q.method === 'use' && (s.skill === 'use_hp' || s.skill === 'use_mp') ? 'regen_' + s.skill.slice(4) : s.skill;
    const now = Date.now(), flight: Flight = { spend: s, family: s.family, place, epoch: ports.epoch(), sentAt: now, targetId: t?.id,
      cooldownMs: cooldownOf(skills, cooldownSkill, Number(character.frequency)), mp: skillCostOf(s) };
    flights.set(s.family, flight);
    spent.set(s.family, s.skill);
    sentIn.set(s.family, update());
    meter.sends++;
    if (waitedFrom !== undefined) { record({ kind: 'wait', family: s.family, skill: s.skill, rank: s.rank, by: s.by, waitedMs: now - waitedFrom }); waits.delete(s.family); }
    notify('skills.sent', { skill: s.skill, family: s.family, targets: ids(s.targets), rank: s.rank, edge, by: s.by, ...(s.context ? { context: s.context } : {}) });
    booking(() => s.book?.sent?.());
    diagnostic(s, 'selected');
    // The socket's reply settles the flight (`onReply`); the game function's own promise answers the
    // same reply in its place's queue order, so its rejection carries nothing more.
    reply.catch(() => undefined);
  }
  // A send with its context settles with it, its send time and the reply.
  const booked = (flight: Flight, reply: unknown) => flight.spend.context ? { context: flight.spend.context, sentAt: flight.sentAt, reply } : {};
  // 3.4 "Settle", the epoch rule and T4: a reply from before a target reset or a death settles nothing
  // but a `cooldown` reply's server clock.
  function settle(flight: Flight, ok: boolean, value: unknown) {
    const rtt = Date.now() - flight.sentAt;
    familyOwn(flight.family, Date.now()).push({ at: Date.now(), rtt });
    const current = flights.get(flight.family) === flight;
    if (current) flights.delete(flight.family);
    const s = flight.spend, reason = ok ? 'accepted' : errorReason(value), ms = Number((value as { ms?: unknown } | null)?.ms);
    const row = replyRow(ok, reason, ms, current && flight.epoch === ports.epoch() && running);
    // The server measured `ms` when the call arrived, and its reply took the way back, so a resend
    // one round trip before `ms` has passed lands on the server's edge (3.4 "One send"). The round
    // trip is the smallest the game measured, the same figure the ping compensation uses, so the
    // resend is never early by the jitter.
    if ((row === 'cooldown' || row === 'stale-cooldown') && Number.isFinite(ms)) {
      waitUntil.set(flight.family, Date.now() + Math.max(0, ms - (smallestPing() ?? 0)));
      sentIn.set(flight.family, update());
    }
    const settled = (outcome: string) => notify('skills.settled', { skill: s.skill, family: flight.family, outcome, reason, ...(Number.isFinite(ms) ? { ms } : {}), roundTrip: rtt, by: s.by,
      ...booked(flight, value) });
    if (row === 'stale' || row === 'stale-cooldown') {
      record({ kind: 'stale', family: flight.family, skill: s.skill, by: s.by, reason, ...(Number.isFinite(ms) ? { ms } : {}) });
      settled('stale');
      s.push?.reject({ reason: 'stale' });
      if (flight.family === 'attack' && row === 'stale-cooldown') arm(readyAt('attack', 'attack'));
      return;
    }
    if (row === 'accepted') {
      // The game's own ping compensation (runner_functions.js:414-421), after a heal as after an
      // attack: both start the same cooldown on the same server clock (3.4).
      const ping = smallestPing();
      // A reply can come before the game's own `skill_timeout` moves `next_skill` (a heal's does),
      // and with no `next_skill` at all the controller waited from its send (`retryAt`). While the
      // entry is not ahead, the family waits the cooldown from its send, less the same ping. A
      // potion family reply comes before its `next_skill` too, and survival asks again on the next
      // `player` packet, so every family waits this way, not the attack alone.
      const key = flight.family === 'attack' ? 'attack' : readyKey(skills, s.skill);
      if (flight.cooldownMs > 0 && !(Number(host.next_skill?.[key]) > Date.now()))
        waitUntil.set(flight.family, flight.sentAt + flight.cooldownMs - (ping ?? 0));
      if (flight.family === 'attack' && ping !== null && typeof reduce_cooldown === 'function')
        reduce_cooldown('attack', Math.min(Math.max(0, Number(host.next_skill?.attack) - Date.now()), ping));
      settled('accepted');
      booking(() => s.book?.accepted?.(value));
      diagnostic(s, 'accepted');
      s.push?.resolve(value);
    } else {
      if (row === 'cooldown') record({ kind: 'cooldown', family: flight.family, skill: s.skill, by: s.by, ...(Number.isFinite(ms) ? { ms } : {}) });
      else refusedUntil.set(s.skill + '|' + ids(s.targets).join(','), Date.now() + ports.hooks.calls.margin());
      settled('rejected');
      booking(() => s.book?.rejected?.(value));
      diagnostic(s, 'rejected', reason);
      s.push?.reject(value);
    }
    if (flight.family === 'attack') { attackOpen = true; arm(readyAt('attack', 'attack')); }
  }
  // The server's reply settles a spend: the first `game_response` naming the spend's place, or the
  // `disappear` or `death` of its target naming it (js/game.js:2066-2075, 3477-3486), after the
  // send. The game's own promises take replies in the order of their places' queues, so one reply
  // that never comes shifts every later attack's promise by one; the socket's reply does not.
  // A refusal names its target as `id`; an acceptance is `commence_attack`'s action, which names it
  // as `target` (server.js:3600-3610, 3662-3665 at the game pin), so an old attack's acceptance
  // after a target reset does not settle the new flight.
  function onReply(data: Reply) {
    if (!data || typeof data.place !== 'string') return;
    const target = data.id ?? data.target;
    for (const f of flights.values()) {
      if (f.place !== data.place) continue;
      if (target !== undefined && f.targetId !== undefined && String(target) !== f.targetId) continue;
      settle(f, !data.failed, data.failed ? { ...data, reason: data.reason || data.response } : data);
      return;
    }
    // A `cooldown` reply to a flight the pass already dropped (T4's stale row): its `ms` is the
    // server's word on the family whatever flight it named, so the family waits it out.
    const reason = data.reason || data.response, ms = Number(data.ms);
    if (data.failed && (reason === 'cooldown' || reason === 'not_ready') && Number.isFinite(ms)) {
      // A potion's place is its call, `equip` or `use`; both are the potion family (3.2).
      const fam = data.place === 'equip' || data.place === 'use' ? 'potion' : family(data.place);
      waitUntil.set(fam, Date.now() + Math.max(0, ms - (smallestPing() ?? 0)));
      sentIn.set(fam, update());
      record({ kind: 'stale', family: fam, skill: data.place, reason, ms });
      notify('skills.settled', { skill: data.place, family: fam, outcome: 'stale', reason, ms, by: 'core:turns' });
    }
  }
  const onGone = (data: Reply) => { if (data?.place) onReply({ ...data, failed: true, reason: data.reason || 'not_found' }); };
  const listening = typeof host.socket?.on === 'function';
  if (listening) { ports.scope.on(host.socket, 'game_response', onReply); ports.scope.on(host.socket, 'disappear', onGone); ports.scope.on(host.socket, 'death', onGone); }
  // A flight that leaves the map with no reply settles here: a lost reply, an epoch change or a
  // reset (`stale`) and a stop (`turns stopped`). Its push rejects with the reason, so a caller that
  // awaits it (the role loop's class casts, the escape) never waits on a flight that is gone, as
  // b9b5c91e's acknowledgement timeout rejected every unanswered cast.
  function leave(f: Flight, reason: 'lost reply' | 'stale' | 'turns stopped') {
    const now = Date.now();
    flights.delete(f.family);
    // A stale flight's call reached the server, which holds its cooldown from the send whatever the
    // epoch, so its family waits that out; a second potion sent across the reset reads `not_ready`.
    // The attack goes at the new target at once, and its `cooldown` reply carries the server's wait.
    if (reason === 'stale' && f.family !== 'attack' && f.cooldownMs > 0)
      waitUntil.set(f.family, Math.max(waitUntil.get(f.family) ?? 0, f.sentAt + f.cooldownMs - (smallestPing() ?? 0)));
    record({ kind: reason === 'lost reply' ? 'lost' : 'stale', family: f.family, skill: f.spend.skill, by: f.spend.by, reason, waitedMs: now - f.sentAt });
    notify('skills.settled', { skill: f.spend.skill, family: f.family, outcome: reason === 'lost reply' ? 'lost' : 'stale', reason, roundTrip: now - f.sentAt,
      by: f.spend.by, ...booked(f, { reason }) });
    // T4: a lost reply books the requester's rejection; a stale flight books nothing. The lost reply's
    // bound tells the status owner's bound record, since its end comes from silence, not from the server.
    if (reason === 'lost reply') {
      boundFired({ bound: 'flightLostReply', owner: '03', state: { family: f.family, skill: f.spend.skill, ms: now - f.sentAt } });
      booking(() => f.spend.book?.rejected?.({ reason }));
    }
    f.spend.push?.reject({ reason });
  }
  const leaveAll = (reason: 'stale' | 'turns stopped') => { for (const f of [...flights.values()]) leave(f, reason); };
  // 3.4 "A lost reply": a spend in flight counts as lost once the cooldown it would have started has
  // run out from its send and the margin has passed after that.
  function expire(now: number) {
    for (const [fam, f] of flights) if (now >= f.sentAt + f.cooldownMs + familyMargin(fam, now)) leave(f, 'lost reply');
  }
  function view(kind: PassKind, h: Hold): TurnsView {
    return { kind, now: Date.now(), character, role: ports.role(), roleLoop: kind !== 'pulse' && h.roleLoop, pulse: kind === 'pulse',
      attack: kind !== 'pulse' && h.attack, combat: h.combat, potions: h.potions,
      target: null, healFirstBelow: healFirstBelowOf(ports.healFirstBelow()), world: lazyWorld,
      inFlightMp: inFlightMp(), flying: fam => flights.has(fam) };
  }
  // One pass. A push from the escape runs whatever the spend table holds, as the escape pulse does today.
  // The open pass's spend table read, which `hold()` answers until the pass returns.
  let passHold: Hold | null = null;
  // The update the last pass ran in. Every pass reads all the families at its update, so an edge
  // inside an update already passed adds nothing until the game moves: it runs once at the next
  // update (`edgeWaiting`), as the role loop's and the pulse's wakes do.
  let passedIn: number | null = null, edgeWaiting = false;
  function pass(kind: PassKind, push?: Spend): PassRead | null {
    if (kind === 'edge' && running && update() === passedIn) {
      if (!edgeWaiting) { edgeWaiting = true; afterNextUpdate(() => { edgeWaiting = false; pass('edge'); }); }
      return null;
    }
    const outer = passHold;
    try { return passOnce(kind, push); } finally { passHold = outer; }
  }
  function passOnce(kind: PassKind, push?: Spend): PassRead | null {
    if (!running) { push?.push?.reject({ reason: 'turns stopped' }); return null; }
    const started = clock();
    world = null;
    if (ports.epoch() !== epochSeen) { epochSeen = ports.epoch(); leaveAll('stale'); refusedUntil.clear(); }
    expire(Date.now());
    passedIn = update();
    const h = passHold = ports.hold(), v = view(kind, h);
    const asks: { spend: Spend; cap: SpendRank }[] = push ? [{ spend: push, cap: push.rank }] : [];
    if (kind === 'pulse' ? h.pulse : h.asks) {
      // The pass's one target answer: the attack source, the drop below and the other sources
      // read it, so they never disagree inside a pass.
      const answer = ports.hooks.turns.target(v) as TargetAnswer | undefined;
      v.target = answer?.target ? answer : null;
      // A passing attack goes where the spend table's passing column lets it.
      v.attack = kind !== 'pulse' && (h.attack || h.passing && !!v.target?.passing);
      for (const { registration, requester, answer: ask } of ports.hooks.skillRequests(v))
        asks.push({ spend: { ...(ask as CoreAsk), by: `${registration}/${requester.name}`, family: family(ask.skill) }, cap: requester.rank });
    }
    // A selection change leaves the attack flight to its reply: the server answers every attack
    // (`commence_attack`'s action, or `disappear` with `not_there`, server.js:9928) within one round
    // trip, well inside the attack cooldown, so the new target loses no turn. The acceptance books
    // the count the entity refresh reads, the ping compensation and the next attack edge; the
    // requester's book and targeting's notice check that the selection still holds.
    const top = new Map<string, Spend>(), outranked = new Map<string, Spend[]>();
    for (const { spend, cap } of asks) {
      const refused = refusal(spend, cap, h), key = spend.by + '|' + spend.family;
      if (refused) {
        if (lastRefusal.get(key) !== refused) { lastRefusal.set(key, refused); drop(spend, refused); }
        if (spend === push) push.push?.reject({ reason: refused });
        continue;
      }
      const best = top.get(spend.family);
      if (!best || SPEND_RANKS[spend.rank] > SPEND_RANKS[best.rank]) {
        if (best) (outranked.get(spend.family) ?? outranked.set(spend.family, []).get(spend.family)!).push(best);
        top.set(spend.family, spend);
      } else (outranked.get(spend.family) ?? outranked.set(spend.family, []).get(spend.family)!).push(spend);
    }
    // A request a higher one beat in its family is dropped, outranked by that requester.
    for (const [fam, losers] of outranked) for (const s of losers) {
      const reason = `outranked by ${top.get(fam)!.by}`, key = s.by + '|' + fam;
      if (lastRefusal.get(key) !== reason) { lastRefusal.set(key, reason); drop(s, reason); }
    }
    for (const s of top.values()) lastRefusal.delete(s.by + '|' + s.family);
    if (push && top.get(push.family) !== push) push.push?.reject({ reason: 'waiting' });
    attackOpen = top.has('attack');
    // 3.3 step 4: the ready families, highest rank first, so the MP a pass spends goes to the
    // higher rank.
    for (const s of [...top.values()].sort((a, b) => SPEND_RANKS[b.rank] - SPEND_RANKS[a.rank])) {
      const at = readyAt(s.family, s.skill), sameUpdate = sentIn.get(s.family) === update();
      const waiting = flights.has(s.family) || Date.now() < at || sameUpdate ? 'waiting' : flights.size ? mpOf(s) : null;
      // A ready family that sent in this update asks again after the next one.
      if (sameUpdate && !flights.has(s.family) && Date.now() >= at) ports.scope.afterUpdate(nextUpdate);
      if (waiting) { if (s === push) push.push?.reject({ reason: waiting }); continue; }
      send(s, waits.get(s.family), at);
    }
    for (const fam of [...waits.keys()]) if (!top.has(fam)) waits.delete(fam);
    // A family that is ready for the first time since its last spend.
    for (const [fam, skill] of spent) {
      if (flights.has(fam) || Date.now() < readyAt(fam, skill)) continue;
      spent.delete(fam);
      notify('skills.readied', { family: fam, by: 'core:turns' });
    }
    const flying = flights.get('attack');
    if (flying) arm(flying.sentAt + flying.cooldownMs + familyMargin('attack', Date.now()));
    // A family the call budget answered `not-now` waits for the next pass (3.3 step 4), the next
    // event the role loop hears. An edge armed at a ready time already past would ask the budget
    // again every few milliseconds through a hold.
    else if (attackOpen && !waits.has('attack')) arm(readyAt('attack', 'attack'));
    const took = clock() - started;
    meter.passes++; meter.totalMs += took; meter.maxMs = Math.max(meter.maxMs, took);
    meter.byKind[kind] = (meter.byKind[kind] ?? 0) + 1;
    if (update() !== meteredUpdate) { meteredUpdate = update(); meter.updates++; }
    return { hold: h, target: v.target };
  }
  // The attack family's edge (3.3, 3.4): one timer at the family's ready time, or at a flight's
  // lost-reply time, never later than one already armed.
  function arm(at: number) {
    if (!running) return;
    const due = Math.max(Date.now() + 1, at);
    if (timer !== null && timerAt <= due) return;
    if (timer !== null) ports.scope.clearTimeout(timer);
    timerAt = due;
    timer = ports.scope.setTimeout(() => { timer = null; timerAt = Infinity; pass('edge'); }, Math.max(1, due - Date.now()));
  }
  function ready(skill: string): Readiness {
    const fam = family(skill), f = flights.get(fam);
    return { ready: !f && Date.now() >= readyAt(fam, skill), flying: !!f, target: f?.targetId ?? null,
      cost: skillCostOf({ skill, family: fam }), reserve: reserveOf(),
      // Read on demand: most readers want the flight, and the margin asks the call budget.
      get margin() { return familyMargin(fam, Date.now()); } };
  }
  const turns: Turns = {
    family: skill => familyOf(skills, skill),
    readyKey: skill => readyKey(skills, skill),
    families: () => Object.fromEntries(Object.entries(table).map(([fam, list]) => [fam, [...list]])),
    pass: kind => pass(kind),
    hold: () => passHold ?? ports.hold(),
    update,
    afterNextUpdate,
    nextReady() { const at = Math.min(...[...spent].map(([fam, skill]) => readyAt(fam, skill))); return Number.isFinite(at) ? at : null; },
    spend(ask) {
      return new Promise((resolve, reject) => { pass('push', { ...ask, family: family(ask.skill), push: { resolve, reject } }); });
    },
    ready,
    armAttack(at = 0) { if (!flights.has('attack')) arm(Math.max(at, readyAt('attack', 'attack'))); },
    forecast: () => character.ctype === 'priest' ? forecast(lazyWorld()) : null,
    attackFlight() { const f = flights.get('attack'); return f ? { targetId: f.targetId, sentAt: f.sentAt } : null; },
    margin: () => Math.max(ports.hooks.calls.margin(), ...[...familyReplies.keys()].flatMap(fam => familyOwn(fam, Date.now()).map(reply => reply.rtt))),
    inFlightMp,
    flying: fam => flights.has(fam),
    records: () => ring.entries(),
    refused: entry => record({ kind: 'refusal', ...entry }),
    meter: () => ({ ...meter, byKind: { ...meter.byKind } }),
    reset() { leaveAll('stale'); refusedUntil.clear(); waits.clear(); attackOpen = false; },
    start() { running = true; },
    stop() {
      running = false; if (timer !== null) ports.scope.clearTimeout(timer); timer = null; timerAt = Infinity; leaveAll('turns stopped');
      // The game nulls its socket on a disconnect before the CODE frame's removal stops the runner
      // (js/game.js `socket.on("disconnect")`), as b9b5c91e's skill runtime reads it.
      if (listening) { ports.scope.off(host.socket, 'game_response', onReply); ports.scope.off(host.socket, 'disappear', onGone); ports.scope.off(host.socket, 'death', onGone); }
      if (root.__partyTurns === turns) delete root.__partyTurns;
    },
  };
  // The tests read the ring and the meter here; no answer reads it.
  root.__partyTurns = turns;
  return turns;
}
