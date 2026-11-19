// The survival owner's installs on the character. shared.js, the character's composition root, builds
// the character half at load (`installSurvivalCharacter`), since its report reply applies the escape
// and the Cave assignment and its first ticks read the farm fact, the pulse and the death recovery's
// identity before the role runner starts. The role runner's one install line (`installSurvival`) then
// adds the parts that spend through the turns owner: the needs, the death handlers and the respawn,
// the escape's spends and the member's death recovery. shared.js hands in only other owners' reads,
// state and the game client (`SurvivalShared`, each port one owner's public read); every survival
// decision lives in this folder.
import type { HookRegistry, Registration, SurvivalNotice } from '../../hooks/registry.ts';
import type { PriestRecoveryAssignment } from '../../hunting/api.ts';
import type { Readiness } from '../turns/api.ts';
import { atFarm, createNeeds, partyUnderAttack, pulseHeld, type Member, type Needs } from './needs.ts';
import { createEscape, createEscapeSpends, escapeCost, type EscapeMovement, type EscapeSpends } from './escape.ts';
import { createDeath, type Death } from './death.ts';
import { createCaveRevival } from './cave-revival.ts';
import { createDeathRecovery, createRecoveryMovement, type EventRejoinOutcome, type TaskAnswer } from './recovery-member.ts';
import { createSurvivalRing, recoveryView, type RecoveryRecord } from './records.ts';
import { linesOf } from './lines.ts';
import { survivalRegistrations } from './registrations.ts';
import { eventFacts } from '../../events/api.ts';
import type { SurvivalScope } from './death.ts';
type SurvivalRing = ReturnType<typeof createSurvivalRing>;
type Request = { kind: string; owner: string };
type Body = { name?: string; map?: string; in?: string; x: number; y: number; rip?: boolean; seenAt?: unknown };
interface Socket { on?(event: string, listener: (data: never) => void): void; off?(event: string, listener: (data: never) => void): void }

// What shared.js hands the character half: the runtime, movement's service and requesters, the
// party's reports, and the reads of the tasks owner, 03, 04, 07, 12 and 13 that survival's rules take, each port
// named with its owner below.
export interface SurvivalShared {
  current(): boolean;
  // The tasks owner's hand control (Manual or Pause).
  hand(): unknown;
  movement(): EscapeMovement & { townCasting(): boolean; release(owner: string): void };
  blinkAs(request: Request, x: number, y: number): Promise<unknown>;
  timed<T>(request: T): T;
  holdIdle(request: Request): void;
  nextReport(): Promise<unknown>;
  reportGap(): number;
  sleep(ms: number): Promise<unknown>;
  smartMove(destination: object, callback: undefined, options: object): Promise<unknown>;
  realm(): string;
  socket(): Socket | undefined;
  // The lifecycle owner's run scope handle `act`; `scope` below is the hunting owner's farm scope.
  act: SurvivalScope;
  // The party's reports (the targeting owner's `targeting.positions`), and the heal list: the Cave's members inside a Cave
  // (the hunting owner's `cave.state`), else the reports.
  reports(): readonly (Member & { escape?: { id?: string; readyForPort?: string | null } })[];
  members(): readonly Member[];
  // The tasks owner's party list and the group task's phase and recovery hold.
  roster(): readonly string[];
  recoveryHolds(): boolean;
  taskPhase(): string | null | undefined;
  // The turns owner's "Heal first below" as the last report reply delivered it.
  healFirstBelow(): unknown;
  isLeader(): boolean;
  // Movement's kite of the current target.
  kiting(): boolean;
  // The hunting owner's farm scope, area and radius (`farming.focus`), and the coordinator's clock difference.
  scope(): { map?: string } | null | undefined;
  clockOffset(): number;
  inFarmArea(entity: Body, scope: object): boolean;
  inFarmRadius(entity: Body): boolean;
  // The Stomp's gate: the party's combat mode (the events owner's Franky fight is asked of api.ts).
  combatMode(): string | null | undefined;
  // The death's identity, the time of the status owner's death record (runtime/status/character/telemetry.ts).
  deathAt(): unknown;
  ownActor(id: unknown): boolean;
  // The Cave revival's target rule (the targeting owner's Cave fight rule) and movement's combat geometry for its
  // approach step.
  dungeonTarget(entity: unknown): boolean;
  approachPoint(target: unknown, range: number): { x: number; y: number };
  safePoint(point: { x: number; y: number }, target: unknown): boolean;
  combatStep(target: unknown, point: { x: number; y: number }, mode: string): void;
  storage(): { getItem(key: string): string | null; setItem(key: string, value: string): void };
  // The death recovery's reads: the tasks owner's group task and farm return, and the navigation revision. The events owner's
  // join rule, rejoin and rejoin mark are asked of api.ts `eventFacts()`.
  memberTask(): TaskAnswer | null;
  revision(): number;
  farmReturn(): boolean;
}
type Turns = { spend(ask: never): Promise<unknown>; ready(skill: string): Readiness; margin(): number; pass(kind: 'pulse'): unknown; nextReady(): number | null;
  update?(): number; afterNextUpdate?(callback: () => void): void };
type Hooks = Pick<HookRegistry, 'publish' | 'notify' | 'ask' | 'calls'>;
type Root = { __partySurvival?: Survival; __partySurvivalCharacter?: SurvivalCharacter };

function publish(hooks: Pick<HookRegistry, 'publish'>): void {
  for (const registration of survivalRegistrations) {
    const result = hooks.publish(registration as Registration);
    if (!result.ok) throw Error(`The survival owner's ${registration.name} did not load: ${result.message}`);
  }
}

// The character half: the escape's record and step, the Cave revival, the farm fact, the
// pulse, the death recovery's movement and the delivered party recovery, and the bindings shared.js
// names for its unedited callers.
export function installSurvivalCharacter(realm: object, hooks: Hooks, shared: SurvivalShared) {
  const root = realm as Root;
  root.__partySurvivalCharacter?.stop();
  const notify = (hook: SurvivalNotice, payload: Record<string, unknown>) => { hooks.notify(hook, payload); };
  // The turns owner's executor, once the role runner's install adopts it (`installSurvival`).
  let turns: () => Turns | undefined = () => undefined;
  const escape = createEscape({ ...shared, scope: shared.act, reports: shared.reports, notify });
  const cave = createCaveRevival({ current: shared.current, members: shared.members as never, dungeonTarget: shared.dungeonTarget, reportGap: shared.reportGap,
    ready: skill => turns()?.ready(skill) ?? { ready: false, flying: false, cost: 0, reserve: 0, margin: 0, target: null } as unknown as Readiness,
    push: ask => turns() ? turns()!.spend(ask as never) : Promise.reject({ reason: 'turns stopped' }),
    margin: () => hooks.calls.margin(), cost: escapeCost, approachPoint: shared.approachPoint, safePoint: shared.safePoint, step: shared.combatStep,
    storage: shared.storage, notify });
  const recovery = createRecoveryMovement({ character: () => character as never, movement: shared.movement as never, holdIdle: shared.holdIdle, deathAt: shared.deathAt });
  // The party death recovery as the last report reply delivered it (the coordinator's
  // `combatRecovery`): its phase, which the character's verdict reads, and the character's answer to
  // `survival.recovery`, whose finishing list the targeting owner's death recovery check reads.
  let partyRecovery: RecoveryRecord | null = null;
  // This character's two potion lines as the last reply that carried either delivered them.
  let potionLines: { hp?: number | null; mp?: number | null } = {};
  const farm = () => atFarm({ scope: shared.scope, roster: shared.roster, reports: shared.reports as never, clockOffset: shared.clockOffset,
    reportGap: shared.reportGap, inFarmArea: shared.inFarmArea, inFarmRadius: shared.inFarmRadius });
  const installed = () => root.__partySurvival;
  const half = {
    shared, escape, cave, recovery,
    // The bindings: the two respawns and the status report's record.
    record: escape.record,
    // The survival ring's entries for the diagnostics read (shared.js `survival`); the ring lives on
    // the installed owner, so a character before its role runner reads an empty ring.
    records: (): ReturnType<Survival['records']> => installed()?.records() ?? [],
    respawn: (by: string): Promise<void> => installed() ? installed()!.death.respawn(by) : Promise.reject({ reason: 'not-now' }),
    respawnWhenAllowed: (by: string): Promise<void> => installed() ? installed()!.death.respawnWhenAllowed(by) : Promise.reject({ reason: 'survival stopped' }),
    // The status snapshot's read of `rip` (the status owner's snapshot): a death whose packet this client missed
    // records here, and a respawn clears the mark.
    seen: (rip: boolean) => { installed()?.death.seen(rip); },
    /** Table A's `recovery` row: the reply's party recovery, or none when the reply carries none. */
    receiveRecovery: (state: { combatRecovery?: RecoveryRecord | null }) => { partyRecovery = state.combatRecovery || null; },
    recoveryPhase: () => partyRecovery?.phase || null,
    recoveryAnswer: () => recoveryView(partyRecovery),
    /** Table A's `cave-recovery` row: the priest recovery assignment the reply's Cave section carries. */
    caveReply: (state: { dailyDungeon?: { recovery?: PriestRecoveryAssignment } | null }) => cave.receive(state.dailyDungeon?.recovery),
    /** Table A's `potion-lines` row: a reply that carries either line replaces both. */
    linesReply: (state: { hpPotionBelow?: Record<string, number> | null; mpPotionBelow?: Record<string, number> | null }) => {
      if ('hpPotionBelow' in state || 'mpPotionBelow' in state)
        potionLines = { hp: state.hpPotionBelow && state.hpPotionBelow[character.name], mp: state.mpPotionBelow && state.mpPotionBelow[character.name] };
    },
    potionLines: () => potionLines,
    atFarm: farm,
    members: shared.members,
    // The spend table's death recovery row: the party's recovery holds the character
    // outside its `finishing` phase.
    occupies: () => shared.recoveryHolds() && shared.taskPhase() !== 'finishing',
    // The passive pulse: the turns owner's pulse pass now, on each game packet that carries what its
    // needs read (`player` for the character's own HP and MP, `entities` for the members' HP and the
    // monsters on them, `death` for a fight's end), and at the turns owner's next turn edge, the time the next
    // spent family readies. Its registrations are survival's `act` handle, which the run
    // scope disposes with the generation.
    // The pulse reads one game update, as the role loop does: a packet inside an update it already
    // pulsed waits for the next update, which runs one pulse for every packet that waited.
    startPulse() {
      let edge: number | null = null, edgeAt = Infinity, pulsedIn: number | null = null, waiting = false;
      const pulseTick = () => {
        const t = turns(), at = t?.update?.();
        if (at !== undefined && at === pulsedIn) {
          if (!waiting && t?.afterNextUpdate) { waiting = true; t.afterNextUpdate(() => { waiting = false; pulseTick(); }); }
          return;
        }
        pulsedIn = at ?? null;
        if (!pulseHeld(escape.stage()) && shared.current()) t?.pass('pulse');
        const ready = t?.nextReady() ?? null;
        if (ready === null || ready <= Date.now() || ready >= edgeAt) return;
        if (edge !== null) shared.act.clearTimeout(edge);
        edgeAt = ready;
        edge = shared.act.setTimeout(() => { edge = null; edgeAt = Infinity; pulseTick(); }, ready - Date.now());
      };
      pulseTick();
      for (const packet of ['player', 'entities', 'death']) shared.act.on(shared.socket(), packet, pulseTick);
    },
    adopt(next: () => Turns | undefined) { turns = next; },
    stop() { escape.stop(); if (root.__partySurvivalCharacter === half) delete root.__partySurvivalCharacter; },
  };
  root.__partySurvivalCharacter = half;
  publish(hooks);
  escape.listen();
  return half;
}
export type SurvivalCharacter = ReturnType<typeof installSurvivalCharacter>;

// What the role runner's install line hands in: the realm's registry, the character half shared.js
// built, the turns owner's executor and the card's combat state.
export interface SurvivalPorts {
  hooks: Hooks;
  character: SurvivalCharacter;
  turns(): Turns | undefined;
  state(): Record<string, unknown> | undefined;
  // The respawn timer's reset while the member is dead: the role runner's selection generation (04)
  // and the turns owner's reset (03).
  dead(): void;
}
export interface Survival {
  needs: Needs;
  escape: EscapeSpends;
  death: Death;
  // The survival ring's entries, oldest first (3.10).
  records(): ReturnType<SurvivalRing['entries']>;
  // The two potion lines as this character reads them now (SV13 reads it).
  lines(): { hp: number; mp: number };
  healChoice: Needs['healChoice'];
  partyHealthy: Needs['partyHealthy'];
  // Scare is due before the escape moves: wanted, and its family ready with the MP for it.
  scareDue(): boolean;
  // Whether the party is in a fight (`survival.fighting`).
  fighting(): boolean;
  // The member's death recovery's step.
  recoveryTick(): Promise<void>;
  // The death recovery's signals, on survival's `act` handle, and its first step now.
  start(): void;
  stop(): void;
}
// The role runner's install: the needs, the death handlers, the escape's spends and the death
// recovery, registered before the turns owner's sources so the pass asks them first, in today's
// chain order.
export function installSurvival(realm: object, ports: SurvivalPorts): Survival {
  const root = realm as Root, ring = createSurvivalRing(), half = ports.character, shared = half.shared, hooks = ports.hooks;
  publish(hooks);
  root.__partySurvival?.stop();
  const fighting = () => partyUnderAttack(half.atFarm, () => hooks.ask('targeting.threat', { character: character.name }));
  const needs = createNeeds({ members: shared.members, sameTeam: member => eventFacts().sameTeam(member), escapeStage: half.escape.stage,
    townCasting: () => shared.movement().townCasting(), partyhealAllowed: () => eventFacts().partyhealAllowed(),
    isLeader: shared.isLeader, partyAttacker: () => hooks.ask('targeting.partyAttacker'), fighting,
    lines: () => linesOf(character.ctype, half.potionLines()), state: ports.state,
    stomp: { franky: () => eventFacts().frankyActive(), mode: shared.combatMode, ask: hooks.ask },
    kiting: shared.kiting, roster: shared.roster, recoveryPhase: half.recoveryPhase, ring: ring.record });
  const margin = () => Math.max(hooks.calls.margin(), ports.turns()?.margin() ?? 0);
  const spends = createEscapeSpends({ turns: () => ports.turns() as never, scope: shared.act, margin: () => hooks.calls.margin(), healFirstBelow: shared.healFirstBelow,
    local: () => half.escape.owns() ? half.escape.record() : null, current: () => shared.current() && half.escape.owns(), ring: ring.record }, needs);
  const death = createDeath({ socket: shared.socket as never, scope: shared.act, ownActor: shared.ownActor,
    character: () => character, monsterName: mtype => (G.monsters as Partial<Record<string, { name?: string }>>)[mtype]?.name, entity: id => get_entity(id),
    notify: (hook, payload) => { hooks.notify(hook, payload); }, escapeHit: data => spends.observeHit(data as never),
    calls: hooks.calls, margin, ring: ring.record });
  death.listen();
  const scareDue = () => { const answer = ports.turns()?.ready('scare'); return needs.scareWanted() && !!answer?.ready && character.mp >= answer.cost; };
  // The death recovery leaves the respawn to the Cave inside a Cave run (A13: the game calls Nera,
  // the Cave revival is the survival owner's), to the escape while the party recovers, and holds while the player's
  // hand holds the character; the console Pause holds the recovery's timer itself (the lifecycle owner's run scope).
  const owned = () => !!(character as { cave?: unknown }).cave || half.escape.ownsRevival() || !!shared.hand();
  const recoveryTick = createDeathRecovery({
    name: () => character.name, isDead: () => !!character.rip, blocked: owned,
    // The one respawn (`survival.respawn`, 3.5): `not-now` while one is in flight or the server's
    // wait runs, and the next tick asks again.
    respawn: () => owned() ? Promise.reject(Error('Recovery owns revival')) : death.respawn('death-recovery'),
    publish: state => { Object.assign(ports.state() ?? {}, state); },
    rejoinEvent: rung => eventFacts().rejoin(rung) as Promise<EventRejoinOutcome>, task: shared.memberTask, returnToFarm: shared.farmReturn, nextReport: shared.nextReport as () => Promise<void>,
    revision: shared.revision, position: () => ({ map: character.map, in: character.in, x: character.real_x, y: character.real_y }),
    climb: half.recovery.climb, hold: half.recovery.hold, done: half.recovery.done, joinEvent: name => eventFacts().joins(name),
    rejoinMark: () => eventFacts().rejoinPending(), notify: (hook, payload) => { hooks.notify(hook, payload); },
    log: message => game_log(message, 'red'),
    wake: () => { void wake(); }, wakeAt: at => wakeAt(at),
  });
  // The death recovery steps on what it waits for: the game's `death` packet for this character and
  // a `player` packet that changes `rip` (the death, and the alive confirmation after a respawn),
  // each completed report (the group task's answer, the rejoin mark and a released hold arrive with
  // it), and the time a respawn's `not-now` names. A wake during a step runs one more step after it.
  // Every registration is survival's `act` handle, which the console Pause holds.
  let running = false, stepping = false, again = false, rip = !!character.rip;
  let timer: number | null = null, timerAt = Infinity, queuedStep: number | null = null;
  async function wake(): Promise<void> {
    if (!running) return;
    if (stepping) { again = true; return; }
    stepping = true;
    try {
      do {
        again = false;
        // The reset while the member is dead: the role runner's selection and the turns owner's turns.
        if (character.rip) ports.dead();
        await recoveryTick();
      } while (again && running);
    } finally { stepping = false; }
  }
  function wakeAt(at: number): void {
    if (!running || at >= timerAt) return;
    if (timer !== null) shared.act.clearTimeout(timer);
    timerAt = at;
    timer = shared.act.setTimeout(() => { timer = null; timerAt = Infinity; void wake(); }, Math.max(1, at - Date.now()));
  }
  // Each completed report queues one step on the `act` handle, so the console Pause holds it.
  function respawnCue(): void {
    if (!running) return;
    if (queuedStep === null) queuedStep = shared.act.setTimeout(() => { queuedStep = null; void wake(); }, 0);
    void shared.nextReport().then(respawnCue);
  }
  const onPlayer = () => { if (!!character.rip !== rip) { rip = !!character.rip; void wake(); } };
  const onDeath = (data: unknown) => { const d = data as { id?: unknown; name?: unknown } | null; if (d && shared.ownActor(d.id || d.name)) void wake(); };
  half.adopt(ports.turns);
  half.escape.adopt({ spends, scareDue, respawn: death.respawn, ring: ring.record });
  const survival: Survival = {
    needs, escape: spends, death, records: ring.entries, lines: needs.lines, healChoice: needs.healChoice, partyHealthy: needs.partyHealthy,
    fighting, scareDue, recoveryTick,
    start() {
      if (running) return;
      running = true;
      shared.act.on(shared.socket(), 'player', onPlayer);
      shared.act.on(shared.socket(), 'death', onDeath);
      void shared.nextReport().then(respawnCue);
      void wake();
    },
    stop() {
      running = false;
      shared.act.off?.(shared.socket(), 'player', onPlayer);
      shared.act.off?.(shared.socket(), 'death', onDeath);
      if (timer !== null) shared.act.clearTimeout(timer);
      if (queuedStep !== null) shared.act.clearTimeout(queuedStep);
      timer = null; timerAt = Infinity; queuedStep = null;
      half.escape.adopt(null);
      half.adopt(() => undefined);
      if (root.__partySurvival === survival) delete root.__partySurvival;
    },
  };
  root.__partySurvival = survival;
  return survival;
}

