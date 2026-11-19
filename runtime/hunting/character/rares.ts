// The character's rare client: the rares,
// field generators and rare kills each report carries, the passive rare candidate
//, the coordinator's rare control and whether it is current, the walk to the
// rare and its climb, the Fairy's field generator deployer and the rare loot
// pass. Moved from shared.js's rare block. install.ts installs it once and hands it
// one-line reads of other owners. The control holds until the next reply, the walk ends on
// its own progress, and the deployer's reach is the field's reach less the position step
//.
import { GAME_FIELD_REACH, legacyPriorities } from '../rules.ts';
import { GAME_POSITION_STEP } from '../../protocol/reports.ts';
import type { PassiveRule } from '../rules.ts';
import { ARRIVAL_TOLERANCE, taskRound } from '../../protocol/ladder.ts';
import { characterPlace } from './loot.ts';

interface Point { map: string; x: number; y: number }
// The monster fields the targeting owner's passing rule reads, which a rare, a Hunt attacker and a loot entity carry.
export interface PassingEntity { id?: string | number; type?: string; mtype?: string }
interface Entity { id: string | number; type?: string; mtype: string; x: number; y: number; real_x?: number; real_y?: number;
  hp: number; level?: number; target?: string | null; visible?: boolean; dead?: string | boolean }
export interface RareControl { kind: string; id: string; revision?: number; deployer?: string; target: { id: string };
  destination?: Point; allowPhoenixAssist?: boolean }
interface Passive { rules: Record<string, PassiveRule>; useFieldGenerators: boolean }
interface Place { id: string; realm: string; map: string; in: string }
// The loot client (character/loot.ts `installLootClient`), installed by the role runner when the
// character fights.
interface LootClient {
  accept(state: Status): RareControl | null;
  rare: { hit(place: Place): void; engaged(place: Place): boolean; report(): unknown; tick(): unknown };
}
interface Walk { clockOffset: number; runtimeId: unknown; intent: { cancelled?: boolean; revision?: unknown };
  townActive?: boolean; convoyActive?: boolean; forceTraveling?: boolean; townTraveling?: boolean }
interface Status { serverNow?: number; rareControl?: RareControl | null; passiveHunting?: Passive; passiveRareHunts?: Record<string, boolean>;
  convoySignal?: unknown; partyLocation?: unknown }
interface Climb { owner: string; request: unknown; round: unknown; activity: string; goal(): Point; current(): boolean }

export interface RareClientPorts {
  character(): { name: string; map: string; in?: string; x: number; y: number; rip?: unknown; items: ({ name: string } | null)[] };
  frame(): { entities?: Record<string, Entity>; server_region?: string; server_identifier?: string };
  game(): Parameters<typeof taskRound>[0];
  entity(id: unknown): Entity | null | undefined;
  // The movement owner's walk state, its group walk in progress and the realm it reports.
  walk(): Walk;
  travel(): unknown;
  realm(): string;
  members(): string[];
  // The targeting owner's reads: a passing encounter, a monster's priority, the passive level cap, the targeted
  // rare, the grouped queue's target and an unfinished fight.
  passing(entity: PassingEntity): boolean;
  priority(sighting: { mtype: string; level?: number }): number;
  levelAllowed(entity: Entity): boolean;
  reachable(entity: Entity): boolean;
  target(): Point | null | undefined;
  queueTarget(): { id: string } | null | undefined;
  unfinishedFight(): boolean;
  // The farm client's monster focus and whether the group farms grouped.
  focus(): string[];
  grouped(): boolean;
  // The events owner's event attendance and the survival owner's escape hold the character.
  eventBusy(): boolean;
  escaping(): boolean;
  // the merchant jobs owner's and the items owner's errands.
  errands(): boolean;
  lootClient(): LootClient | null | undefined;
  loot(): Promise<unknown>;
  chestsLeft(): number;
  // The field generator goes out through the game's consumable call.
  deploy(slot: number): unknown;
  // Movement's walks: the rare path's request, its ladder climb and the climb's end, the retired
  // Phoenix patrol walk, and the farm movement the rare takes over.
  pathRequest(id: string): { owner: string };
  climb(climb: Climb): void;
  endClimb(owner: string): void;
  retirePatrolWalk(): void;
  handoff(): Promise<void>;
}

const host = globalThis as { __partyRareControlAt?: number; __partyRareHandoffPending?: boolean };
const noHunts = () => Object.fromEntries(Object.keys(legacyPriorities).map(id => [id, false])) as Record<string, boolean>;
const noPassive = (): Passive => ({ rules: {}, useFieldGenerators: true });

/** The character's rare client: its reports, the control it holds and the rare walk it runs. */
export function installRareClient(ports: RareClientPorts) {
  let control: RareControl | null = null, climbing: string | null = null;
  let passive = noPassive(), hunts = noHunts();
  let loot: { id: string; at: number; complete: boolean } | null = null, lootPending = false;
  let deployment: { encounterId: string; at: number; failed: boolean } | null = null;
  // The rare kills the character saw: each stays in its reports until the reply to a report that
  // carried it arrives, the coordinator's receipt of that report.
  let kills: { id: string; mtype: string; map: string; in: string; at: number; partyEngaged: boolean }[] = [];
  let reportedKill = 0;
  const known: Record<string, string> = {};
  const me = () => ports.character();
  const place = (id: string): Place => ({ id, ...characterPlace(ports.frame(), me()) });
  const engaged = (id: string) => !!ports.lootClient()?.rare.engaged(place(id));

  // The visible rares the group hunts and the Phoenix, highest priority first: the game's entities
  // bound the list. `known` keeps a sighted rare until its kill is reported or the entities
  // drop it.
  function sightings() {
    const result = [], entities = ports.frame().entities || {};
    for (const id of Object.keys(known)) if (!entities[id]) delete known[id];
    for (const e of Object.values(entities)) {
      if (!e || e.type !== 'monster' || !(hunts[e.mtype] || e.mtype === 'phoenix') || ports.passing(e) || !e.visible || e.dead) continue;
      known[String(e.id)] = e.mtype;
      result.push({ id: String(e.id), mtype: e.mtype, x: e.real_x !== undefined ? e.real_x : e.x, y: e.real_y !== undefined ? e.real_y : e.y,
        hp: e.hp, level: e.level, target: e.target || null, visible: true, reachable: ports.reachable(e), partyEngaged: engaged(String(e.id)) });
    }
    return result.sort((a, b) => ports.priority(b) - ports.priority(a));
  }
  function observation() {
    const c = me(), w = ports.walk();
    return { at: Date.now() + w.clockOffset, runtimeId: w.runtimeId, map: c.map, in: String(c.in || c.map), server: ports.realm(),
      x: c.x, y: c.y, sightings: sightings() };
  }
  const fields = () => Object.values(ports.frame().entities || {})
    .filter(e => e && e.mtype === 'fieldgen0' && !e.dead && e.hp > 0).map(e => ({ id: e.id, x: e.x, y: e.y }));

  // A party member's hit on a rare marks it engaged for the loot client; a kill of a sighted rare is
  // reported.
  function hit(data: { id?: string | number; hid?: string; actor?: string; kill?: unknown } | null | undefined): void {
    if (!data) return;
    const id = String(data.id), client = ports.lootClient();
    if (client && ports.members().indexOf(String(data.hid || data.actor || '')) >= 0) {
      const entity = ports.entity(data.id);
      if (known[id] || entity && Object.hasOwn(legacyPriorities, entity.mtype)) client.rare.hit(place(id));
    }
    if (!data.kill || !known[id]) return;
    const c = me();
    kills.push({ id, mtype: known[id]!, map: c.map, in: String(c.in || c.map), at: Date.now() + ports.walk().clockOffset, partyEngaged: engaged(id) });
    delete known[id];
  }

  // The control each full status carries: a newer one takes the farm's movement over, and the
  // passive rules arrive with it.
  async function receive(state: Status): Promise<void> {
    kills = kills.filter(kill => kill.at > reportedKill);
    if (Number(state.serverNow) < (host.__partyRareControlAt || 0)) state.rareControl = control;
    const client = ports.lootClient();
    if (client) state.rareControl = client.accept(state);
    if (state.rareControl && (host.__partyRareHandoffPending || !control || state.rareControl.id !== control.id)) {
      host.__partyRareHandoffPending = false;
      await ports.handoff();
    }
    passive = state.passiveHunting || noPassive();
    hunts = state.passiveRareHunts || noHunts();
    control = state.rareControl || null;
    host.__partyRareControlAt = Math.max(Number(host.__partyRareControlAt || 0), Number(state.serverNow || 0));
    if (!control) cancelPath();
  }
  // The control a combat report carries; a full status applies its own above. An encounter that is
  // current ends the Phoenix patrol's walk.
  function acceptCombat(state: Status): void {
    if ('partyLocation' in state) return;
    if (!Object.hasOwn(state, 'rareControl') || Number(state.serverNow || 0) < Number(host.__partyRareControlAt || 0)) return;
    host.__partyRareControlAt = Number(state.serverNow || 0);
    if (state.rareControl && (!control || state.rareControl.id !== control.id)) host.__partyRareHandoffPending = true;
    control = state.rareControl || null;
    if (!control) { cancelPath(); return; }
    if (control.kind !== 'encounter' || !current() || state.convoySignal) return;
    ports.retirePatrolWalk();
  }
  // The control holds until the next reply supersedes it, while it is bound to the current
  // navigation revision and nothing with a higher claim (death, the town walk, an event, an escape)
  // holds the character.
  function current(): boolean {
    const w = ports.walk();
    return !!(control && !w.intent.cancelled &&
      control.revision === w.intent.revision && !me().rip && !w.townActive && !ports.eventBusy() && !ports.escaping());
  }
  // An unfinished fight keeps the character unless the rare encounter's target is the queue's.
  function active(): boolean {
    const target = ports.queueTarget();
    if (ports.unfinishedFight() && !(control?.kind === 'encounter' && target && target.id === control.target.id)) return false;
    return current();
  }
  // The rare walk's climb ends with its journey or hold, by the walk's own identity.
  function cancelPath(): void {
    if (!climbing) return;
    const climbed = climbing; climbing = null; ports.endClimb(climbed);
  }
  // The Fairy's deployer drops one field generator per encounter once it stands within reach.
  function deploy(encounterId: string): void {
    if (deployment && deployment.encounterId === encounterId) return;
    const attempt: NonNullable<typeof deployment> = { encounterId, at: Date.now(), failed: false };
    deployment = attempt;
    const slot = me().items.findIndex(item => item && item.name === 'fieldgen0');
    if (slot < 0) attempt.failed = true;
    else Promise.resolve(ports.deploy(slot)).catch(() => { attempt.failed = true; });
  }

  // The rare tick: whether the rare owns this character now, and the walk, deploy or loot it runs.
  function poll(): boolean {
    if (!active()) { cancelPath(); return false; }
    // The deployer drops the generator once the Fairy stands inside the field's reach less the step
    // the Fairy's client place can lag.
    const c = me(), w = ports.walk(), held = control!, target = ports.target(), reach = GAME_FIELD_REACH - GAME_POSITION_STEP;
    if (held.kind === 'patrol') { cancelPath(); return true; }
    if (ports.grouped() && held.kind === 'encounter' && (held.deployer !== c.name || !target || Math.hypot(c.x - target.x, c.y - target.y) >= reach)) {
      cancelPath(); return false;
    }
    if (climbing && (climbing !== ports.pathRequest(held.id).owner || target && held.deployer !== c.name || w.convoyActive)) cancelPath();
    if (ports.travel() || w.convoyActive || ports.errands() || w.forceTraveling || w.townTraveling) return true;
    if (held.kind === 'encounter' && target && held.deployer !== c.name) return false;
    let destination = held.destination;
    if (held.kind === 'encounter' && target && held.deployer === c.name) {
      destination = { map: c.map, x: target.x, y: target.y };
      if (Math.hypot(c.x - target.x, c.y - target.y) < reach) { cancelPath(); deploy(held.id); return true; }
    }
    if (!destination || !Number.isFinite(destination.x) || !Number.isFinite(destination.y)) return true;
    const goal = destination;
    // Movement's arrival reading.
    if (goal.map === c.map && Math.hypot(c.x - goal.x, c.y - goal.y) <= ARRIVAL_TOLERANCE) {
      cancelPath();
      if (held.kind === 'loot') { pollLoot(held); return true; }
      return false;
    }
    // A failed rare walk climbs the task walk's ladder while the control lives and the
    // party gets closer; the climb ends with the control (cancelPath). Each rung ends on the walk's
    // own progress, with no deadline.
    const holder = ports.pathRequest(held.id).owner;
    climbing = holder;
    ports.climb({ owner: holder, request: ports.pathRequest(held.id), round: taskRound(ports.game(), 'the rare'),
      activity: 'Walking to a rare',
      goal: () => ({ map: goal.map, x: goal.x, y: goal.y }), current: () => climbing === holder && active() });
    return true;
  }
  // The loot client loots the rare's chests; without one, the departure loot runs once at a time.
  function pollLoot(held: RareControl): void {
    const client = ports.lootClient();
    if (client) { client.rare.tick(); return; }
    if (lootPending) return;
    lootPending = true;
    Promise.resolve(ports.loot())
      .then(() => { loot = { id: held.id, at: Date.now(), complete: ports.chestsLeft() === 0 }; })
      .catch(() => { loot = { id: held.id, at: Date.now(), complete: false }; })
      .finally(() => { lootPending = false; });
  }

  return {
    sightings, observation, fields, hit, receive, acceptCombat, current, active, poll,
    control: () => control,
    passive: () => passive,
    // A rare the group stops for, or the Phoenix while the focus names it, under its level cap.
    candidate: (target: Entity | null | undefined) =>
      !!(target && ports.levelAllowed(target) && (hunts[target.mtype] || target.mtype === 'phoenix' && ports.focus().indexOf('phoenix') >= 0)),
    // The rare owns this character's walk: a patrol or loot leg, its climb, or a solo deployer.
    ownsWalk: () => active() && (control!.kind === 'patrol' || control!.kind === 'loot' || !!climbing || !ports.grouped() && control!.deployer === me().name),
    walkControl: () => active() ? { kind: control!.kind, id: control!.id, destination: control!.destination || null } : null,
    report() {
      const client = ports.lootClient();
      reportedKill = Math.max(reportedKill, ...kills.map(kill => kill.at));
      return { rareObservation: observation(), rareSightings: sightings(), rareFields: fields(), rareKills: kills,
        rareLoot: client ? client.rare.report() : loot, rareDeployment: deployment };
    },
    stop() { cancelPath(); control = null; },
  };
}
