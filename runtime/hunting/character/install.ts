// The hunting owner's install on the character: characters/shared.js keeps one
// install call of runtime/hunting/character/. It builds the farm, Hunt, rare and Cave clients and
// the facts other owners read, and hands each client the others' answers itself: the farm client
// asks the rare and Cave clients, the Hunt client the farm's radius and the rare's passive rules,
// the rare client the farm's focus. shared.js passes each port once, as one read or write of another
// owner's state or the game client. Every port is a function, so the install can run before the
// owners whose ports read it are built.
import { installFarmClient } from './farm.ts';
import type { FarmClientPorts } from './farm.ts';
import { installHuntClient } from './hunt.ts';
import type { HuntClientPorts } from './hunt.ts';
import { installRareClient } from './rares.ts';
import type { PassingEntity, RareClientPorts } from './rares.ts';
import { installCaveClient } from './cave.ts';
import type { CaveClientPorts } from './cave.ts';
import { installHuntingFacts } from './facts.ts';
import type { HuntingFactsPorts } from './facts.ts';
import { scope, type Emitter } from '../../lifecycle/api.ts';

type Farm = Omit<FarmClientPorts, 'monsters' | 'cancelled' | 'rareActive' | 'caveOwned' | 'reachable' | 'character' | 'walk' | 'frame' | 'entity' |
  'hitReaders' | 'queueTarget'>;
type Hit = Parameters<FarmClientPorts['hitReaders']>[0];
type HitTarget = Parameters<FarmClientPorts['hitReaders']>[1];
type Hunt = Pick<HuntClientPorts, 'findNpc' | 'travel' | 'escaping' | 'attackers' | 'passingKey' | 'passiveStop' | 'deaths' |
  'allowed' | 'inRange' | 'reachable' | 'log' | 'npcWalk' | 'post' | 'gameLog'>;
type Rare = Pick<RareClientPorts, 'realm' | 'passing' | 'levelAllowed' | 'target' | 'errands' | 'loot' | 'chestsLeft' |
  'deploy' | 'pathRequest' | 'climb' | 'endClimb' | 'retirePatrolWalk'>;
type Cave = Omit<CaveClientPorts, 'character' | 'frame' | 'game' | 'members' | 'loot' | 'queue' | 'stop' | 'departed'>;
export interface HuntingClientPorts extends Farm, Hunt, Rare, Cave {
  // One character, game and walk read serve every client, so each read carries what all of them read.
  character(): ReturnType<FarmClientPorts['character']> & ReturnType<HuntClientPorts['character']> &
    ReturnType<RareClientPorts['character']> & ReturnType<CaveClientPorts['character']>;
  frame(): ReturnType<FarmClientPorts['frame']> & ReturnType<RareClientPorts['frame']> & ReturnType<CaveClientPorts['frame']>;
  entity(id: unknown): (NonNullable<ReturnType<FarmClientPorts['entity']>> & NonNullable<ReturnType<RareClientPorts['entity']>>) | null | undefined;
  game(): ReturnType<RareClientPorts['game']> & ReturnType<CaveClientPorts['game']> & { monsters?: ReturnType<FarmClientPorts['monsters']> };
  walk(): ReturnType<FarmClientPorts['walk']> & ReturnType<RareClientPorts['walk']> & { intent: { cancelled?: boolean } };
  // The Hunt walk's control (root.__partyHuntTravel).
  huntTravel: HuntClientPorts['control'];
  // Whether the character can attack the rare (the game's `can_attack`).
  attackable: RareClientPorts['reachable'];
  // The targeting owner's grouped queue on the character: its target and the Cave floor's scope and members.
  queue(): ({ target?: { id: string; mtype?: string; x: number; y: number } | null } & NonNullable<ReturnType<CaveClientPorts['queue']>>) | null | undefined;
  lootClient(): (ReturnType<RareClientPorts['lootClient']> & ReturnType<HuntingFactsPorts['lootClient']> &
    { finalKill(mtype: string | undefined): void }) | null | undefined;
  // The other owners' readers of the game's `hit` packet: the status owner's combat metrics with the hit's
  // target, the targeting owner's party defense, the targeting owner's fight-death report and the targeting owner's queue client.
  hitMetrics(data: NonNullable<Hit>, target: HitTarget): void;
  defendHit(data: Hit): void;
  deathHit(data: Hit): void;
  queueHit(data: Hit): void;
  // The farm movement a new rare control takes over, and movement's walks the Cave's command retires.
  farmHandoff: RareClientPorts['handoff'];
  caveStop: CaveClientPorts['stop'];
  // The turn rows' reads: the lifecycle owner's drain hold (drain.ts `holds`), the movement owner's travel fight and departure, the targeting owner's
  // departure fight and engaged monster, and the items owner's queued bank visit.
  drainHeld(): boolean;
  travelCombat(): boolean;
  departing(): boolean;
  departureCombat(): boolean;
  monsterEngaged(): boolean;
  bankQueued(): boolean;
  // The departure loot's reads (character/loot.ts): the party's reports, a monster this character's
  // departure engaged, the chests a departure may take, the game socket and its next draw.
  positions(): { name?: string; seenAt?: number; monsterHunt?: { id?: string | null; count?: number } | null }[];
  engagedWith(entity: unknown): boolean;
  chests(): unknown[];
  socket(): Emitter;
}

export function installHuntingClient(ports: HuntingClientPorts) {
  const cancelled = () => !!ports.walk().intent.cancelled;
  // The `hit` readers in b9b5c91e's order (shared.js:992-1006): the metrics, the defense, the loot
  // client's final kill on a party member's kill, the fight-death report, the queue client, then the
  // rare client.
  const farm = installFarmClient({ ...ports, cancelled,
    monsters: () => ports.game().monsters || {},
    reachable: target => ports.inRange(target) || ports.reachable(target),
    rareActive: () => rares.active(), caveOwned: () => cave.owned(), queueTarget: () => ports.queue()?.target,
    hitReaders: (data, target) => {
      if (data) ports.hitMetrics(data, target);
      ports.defendHit(data);
      if (data && (data.kill || data.dead) && target && ports.members().indexOf(String(data.hid || data.actor || '')) >= 0)
        ports.lootClient()?.finalKill(target.mtype);
      ports.deathHit(data);
      ports.queueHit(data);
      rares.hit(data);
    } });
  const hunt = installHuntClient({ ...ports, cancelled, control: ports.huntTravel, escapeOwns: ports.escaping,
    // A passing monster whose passive rule keeps the walk moving (the rare client's rules).
    keepMoving: target => { const rule = rares.passive().rules[target.mtype!]; return !!(rule?.enabled && rule.keepMoving && ports.passing(target)); },
    eventActive: ports.eventActive, eventJoined: ports.eventJoined, recoveryHolds: ports.recoveryHolds, radius: () => farm.radius() });
  const rares = installRareClient({ ...ports, reachable: ports.attackable, queueTarget: () => ports.queue()?.target,
    unfinishedFight: ports.fighting, focus: () => farm.focus(), grouped: () => farm.grouped(),
    eventBusy: () => ports.eventTravelling() || ports.eventJoined(), handoff: ports.farmHandoff });
  // A departure is over with no departure fight pending and no departure chest left.
  const cave = installCaveClient({ ...ports, stop: ports.caveStop, departed: () => !ports.departureCombat() && ports.chests().length === 0 });
  const facts = installHuntingFacts({ character: ports.character, lootClient: ports.lootClient, positions: ports.positions, farm, hunt, rares, cave });
  // The hunting owner's hit learner decides (`act`); the Cave records the chests it opened (`observe`).
  function listen(socket: unknown): void {
    const act07 = scope('07', 'act'), observe07 = scope('07', 'observe'), target = socket as Parameters<typeof act07.on>[0];
    act07.on(target, 'hit', farm.onHit as (data: unknown) => void);
    observe07.on(target, 'chest_opened', data => { if (data) cave.chestOpened(data as Parameters<typeof cave.chestOpened>[0]); });
  }
  // The hunting owner's rows of turns' occupied table: each answers whether the hunting owner's work occupies
  // the character's turn, and the Cave and departure rows pass with null.
  const turns = {
    // A Cave the member's visit owns holds the turn while this runtime is not current, the lifecycle owner's drain
    // holds or the Cave is paused.
    cave: () => facts.cave.owned ? !ports.current() || ports.drainHeld() || facts.cave.paused : null,
    // A walk's own fight, outside a Hunt's defense and a departure's fight.
    travel: () => ports.travelCombat() && !facts.focus.huntDefense && !ports.departureCombat(),
    // The Hunt's loot pass, outside a departure's fight.
    lootHunt: () => facts.focus.lootPending && !ports.departureCombat(),
    // A departure, or a queued bank visit, holds the turn while no monster is engaged.
    departure: () => ports.departing() || ports.bankQueued() ? !ports.monsterEngaged() : null,
  };
  // The departure loot client's ports (character/loot.ts `installLootClient`): the
  // member's quest is the Hunt client's status, the console's clock the walk's offset.
  const lootPorts = () => ({
    name: () => ports.character().name, quest: hunt.status, positions: () => ports.positions() || [],
    clockOffset: () => ports.walk().clockOffset, character: ports.character, frame: ports.frame,
    navigationCancelled: cancelled, escaping: () => !!ports.escaping(), eventJoined: ports.eventJoined,
    defending: ports.departureCombat, passing: (entity: PassingEntity) => !!ports.passing(entity),
    engaged: (entity: unknown) => !!ports.engagedWith(entity), chests: ports.chests, socket: ports.socket,
  });
  return { farm, hunt, rares, cave, facts, listen, turns, lootPorts };
}
Object.assign(globalThis, { installHuntingClient });
// The hunting owner's character client as targeting's ports hold it.
export type HuntingClient = ReturnType<typeof installHuntingClient>;
