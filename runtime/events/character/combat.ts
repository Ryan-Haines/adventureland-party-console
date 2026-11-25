// The event facts on the character:
// the kinds table read with the client's game data, the facts other owners read on the character -
// targets, reach, sighting, Franky, the merchant's event fight, the A/B team, opponent and mode, and
// the three event movers. Each fact is shared.js's function of b9b5c91e,
// moved with its branches and values. The rules are rules.ts's; this file holds the
// per-`G` cache of the event monster lists (`event.targets`) and the player's monster pick from the
// event's limits. shared.js calls `installEventFacts` once in the routine's install.
import { eventArea, eventAreas, eventAttackers, eventJoins, eventKinds, eventReservedBy, eventMap, eventNames, eventSupported, eventTargetTypes, eventWalkBoss, eventIs, eventKey } from '../rules.ts';
import type { EventGame } from '../rules.ts';
import { publishEventFacts } from '../api.ts';
import { cipherIngredients } from '../october.ts';
import { approachFan, stepLength } from '../../movement/api/character.ts';

interface Spot { x: number; y: number }
interface Entity extends Spot {
  id?: unknown; type?: string; name?: string; mtype?: string; map?: string; in?: unknown; visible?: boolean;
  dead?: boolean; rip?: boolean; hp?: number; team?: string; target?: string; s?: { abtesting?: { team?: string } };
}
interface Character extends Entity { name: string; map: string; ctype?: string; speed?: number; transporting?: unknown }
// The A/B strategy the coordinator's reply carries (runtime/events/coordinator/abtesting.ts).
interface Strategy { mode?: string; majorityTeam?: string; sabotageNames?: string[] }

export interface EventFactPorts {
  game(): EventGame;
  // The event's limits as the reply's `eventSettings` carries them (EventLimits); a `monsters` list,
  // which the limits' check allows for the Graveyard's three only, is the player's pick, and
  // `bossApproach` is the boss approach.
  limits(name: string): { monsters?: unknown; bossApproach?: unknown } | undefined;
  character(): Character;
  entities(): Record<string, Entity>;
  // The attendance (attend.ts), installed after this file, so read when a fact is asked.
  attend(): {
    selected(name: string): boolean; joined(): string | null; traveling(): string | null; active(): { name: string } | null;
    owns(event: string): boolean; sighting(name: string): Spot | null;
    rejoin(rung: string): Promise<unknown>; rejoinPending(): string | null;
  };
  // The October runtime's activity for an event (its gathering monster types for the Cipher).
  activity(name: string): { kind?: string; types?: string[] } | null | undefined;
  clockOffset(): number;
  // The party's reports and the game's PvP flag.
  members(): Entity[];
  inPvp(): boolean;
  // The monster types the poll set for the current event (attend.ts `targets`).
  targetTypes(): string[];
  // The exit's pending return and its running climb (exit.ts), and the merchant job that holds the
  // merchant (the merchant jobs owner's runner).
  exitPending(): boolean;
  exiting(): boolean;
  // The exit's climb off the event map for a recovery request (exit.ts `leaveEventMap`).
  leaveEventMap(current: () => boolean, request: unknown): Promise<boolean>;
  // The character travels for an event: the event walk, or the anniversary's staging or visit while no
  // group walk stopped for the party's defence (attend.ts, anniversary.ts).
  travelling(): boolean;
  // The character recovers from an event: the anniversary's staging runs uncancelled, or the exit's
  // return is open (anniversary.ts, exit.ts).
  recovering(): boolean;
  merchantJob(): unknown;
  // Movement's combat geometry and steps (runtime/movement/character/steps.ts) and the game's range
  // and terrain reads.
  inRange(target: Entity): boolean;
  approachPoint(target: Entity): Spot;
  canMoveTo(x: number, y: number): boolean;
  safePoint(point: Spot, target: Entity): boolean;
  step(target: Entity, point: Spot, mode: string, closes?: 'terrain'): boolean;
  resetSteps(): void;
  position(record: Record<string, unknown>): void;
  now(): number;
  // The targeting owner's answers the event movers read (targeting/threat.ts and events.ts): the Franky row of its
  // selection, the event return's fight and the Town cast that fight interrupts.
  frankyAllows(target: Entity | null): boolean;
  returnFight(): boolean;
  cancelReturnTown(): void;
}

// One movement tick as the movers see it (runtime/movement/character/movers.ts).
// The tick's target is the role runner's selection, a game entity.
export interface EventMoverTick { reselect(): void; target(): unknown; combat: boolean; first(): boolean }

export function installEventFacts(ports: EventFactPorts) {
  // The A/B strategy the last report reply carried (table A's `party-targets` row).
  let abtesting: Strategy | null = null;
  const abtestingStrategy = (): Strategy | null => abtesting;
  // The activeCombatEvent pass asks the monster list for every event many times per combat tick; it
  // depends only on the game data, and a game update loads a new `G`, so the list is derived once
  // per `G` and event. Callers get a copy.
  let cache: { game: EventGame; types: Map<string, string[]>; attackers: Map<string, string[]>; areas: Map<string, string> } | null = null;
  function cached(): NonNullable<typeof cache> {
    const game = ports.game();
    if (cache?.game !== game) cache = { game, types: new Map(), attackers: new Map(), areas: eventAreas(game) };
    return cache;
  }
  function targets(name: string): string[] {
    const entry = cached();
    if (!entry.types.has(name)) entry.types.set(name, eventTargetTypes(name, entry.game));
    const types = entry.types.get(name)!.slice(), picked = ports.limits(name)?.monsters;
    return Array.isArray(picked) ? types.filter(type => picked.includes(type)) : types;
  }
  // `event.targets()`'s attacker half (`targets.attackers`): the boss's spawns that the targeting owner's Franky
  // row fights while they target this character.
  function attackers(name: string): string[] {
    const entry = cached();
    if (!entry.attackers.has(name)) entry.attackers.set(name, eventAttackers(name, entry.game));
    return entry.attackers.get(name)!.slice();
  }
  // The player's monster pick leaves out a type the event's `only` list names, so that monster is
  // no target while the event is selected (b9b5c91e `excludedGraveyardTarget`; the limits allow a
  // pick of the Graveyard's three only, validEventLimits).
  function excluded(type: string): boolean {
    return eventKinds().some(entry => {
      const picked = ports.limits(entry.name)?.monsters;
      return !!entry.targets.only?.includes(type) && Array.isArray(picked) && !picked.includes(type) && ports.attend().selected(entry.name);
    });
  }
  // `event.targets()`: the current event's monster types as the poll set them,
  // the area event whose map the character stands on, the event a reserved boss belongs to, and the
  // pick's exclusions.
  function eventTargets() {
    return { types: ports.targetTypes(), area: cached().areas.get(ports.character().map) ?? null, reservedBy: eventReservedBy, excluded };
  }
  const mapEvent = () => (ports.game() as { maps?: Record<string, { event?: string }> }).maps?.[ports.character().map]?.event;

  // Each event's settings say whether its boss
  // approach goes straight to the boss or fights the adds on the way.
  function fightsAdds(name: string | null | undefined): boolean {
    return !!name && ports.limits(name)?.bossApproach === 'fight-adds';
  }
  // The monsters a boss spawns around itself (G.monsters[boss].spawns).
  function bossAdd(name: string, target: Entity | null | undefined): boolean {
    const monster = (ports.game() as { monsters?: Record<string, { spawns?: unknown[][] }> }).monsters?.[name];
    return !!target && (monster?.spawns || []).some(spawn => spawn[1] === target.mtype);
  }
  function reachable(target: Entity | null | undefined): boolean {
    if (!target || target.dead || target.hp === 0) return false;
    if (ports.inRange(target)) return true;
    const point = ports.approachPoint(target);
    return !!(point && ports.canMoveTo(point.x, point.y) && ports.safePoint(point, target));
  }
  // The report's boss sighting for the party's event walk (movement's arrivals.ts reads it). The
  // boss's location follows the boss, never a temporary selected add; the Cipher has gathering
  // monsters in place of a namesake boss.
  function sighting(target: Entity | null | undefined) {
    const attend = ports.attend(), character = ports.character(), joined = attend.joined();
    if (!joined || attend.traveling() || character.rip || character.transporting) return null;
    const cipher = joined === 'witchcipher' ? ports.activity('witchcipher') : null;
    const gathering = cipher?.kind === 'monster' && !!target && (cipher.types || []).includes(target.mtype!);
    if (!gathering && (!target || target.mtype !== joined)) target = Object.values(ports.entities()).find(entry =>
      entry && entry.type === 'monster' && entry.mtype === joined && entry.visible !== false && !entry.dead && entry.hp! > 0 &&
      (!entry.map || entry.map === character.map) && (entry.in == null || entry.in === character.in));
    if (!target || target.visible === false || target.dead || !(target.hp! > 0) || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
    return { id: String(target.id), mtype: target.mtype, event: joined, map: character.map, in: String(character.in || character.map),
      x: target.x, y: target.y, attackReachable: reachable(target), observedAt: ports.now() + ports.clockOffset() };
  }
  function aggressive(): boolean {
    return eventArea(ports.attend().joined()) || cached().areas.has(ports.character().map);
  }
  // A monster the poll named for the current event: the boss movement of movement's steps.
  function bossMovement(target: Entity | null | undefined): boolean {
    return !!target && ports.targetTypes().includes(target.mtype!);
  }

  // Franky's fight: the character stands on Franky or joined it, the player selected it, and its
  // attendance owns it (attend.ts `owns`). It survives a temporary loss of the boss or
  // the feed; the attacks and the movers read this one answer.
  function frankyActive(): boolean {
    const attend = ports.attend();
    return attend.selected('franky') && (attend.joined() === 'franky' || mapEvent() === 'franky') && attend.owns('franky');
  }
  // 1.5 row 7: the approach closes on the event target the targeting owner's selection holds. Going straight, only
  // terrain constrains it: adds and healer coverage never make it retreat or keep it from closing,
  // and the step goes through movement as a closing step that checks terrain only. Fighting adds
  //, the step takes the full check, so an add in the way stops it and the party fights it.
  function frankyTick(target: Entity | null): boolean {
    if (!frankyActive()) return false;
    const character = ports.character();
    if (!ports.frankyAllows(target) || ports.inRange(target!)) {
      ports.resetSteps();
      ports.position({ at: ports.now(), mode: target ? 'franky-holding' : 'franky-waiting', movementOwner: 'combat', target: target?.id || null,
        reason: target ? 'Franky event target is in attack range' : 'Waiting for Franky' });
      return true;
    }
    const destination = ports.approachPoint(target!);
    const step = Math.min(Math.hypot(destination.x - character.x, destination.y - character.y), stepLength(character.speed, 'approach'));
    for (const point of approachFan(character, destination, step)) {
      if (fightsAdds('franky')) {
        if (ports.canMoveTo(point.x, point.y) && ports.safePoint(point, target!)) return ports.step(target!, point, 'franky-approaching');
      } else if (ports.canMoveTo(point.x, point.y)) return ports.step(target!, point, 'franky-approaching', 'terrain');
    }
    ports.resetSteps();
    ports.position({ at: ports.now(), mode: 'blocked', movementOwner: 'combat', target: target!.id,
      reason: 'No terrain-clear approach to Franky event target' });
    return true;
  }

  // The merchant fights the event it joined and selected while no exit is pending and no job of its
  // own holds it (the turns owner's rule). The interaction events, the Cipher and the doors, have nothing to
  // fight: the merchant only brews or knocks there, and with its turns on it attacked the goo of
  // the Cipher gathering and was disconnected (US II, 2026-10-24; fork da499b7b).
  function merchantFightsEvent(): boolean {
    const attend = ports.attend(), joined = attend.joined();
    return ports.character().ctype === 'merchant' && !!joined && eventKey(joined)?.kind !== 'interaction' &&
      attend.selected(joined) && !ports.exitPending() && !ports.merchantJob();
  }

  // A/B Testing.
  function team(entity: Entity | null | undefined): string | null {
    return entity && (entity.team || entity.s?.abtesting?.team) || null;
  }
  function liveAbtesting(): boolean {
    const character = ports.character();
    return ports.attend().active()?.name === 'abtesting' && character.map === 'abtesting' && !!team(character) && ports.inPvp();
  }
  // The A/B map's team spawns (G.maps.abtesting.spawns, game version 18285): team B enters at
  // index 2 on the negative (left) side and team A at index 3 on the positive (right) side, so a
  // search crosses toward the other team's spawn. A client with no map data searches toward the
  // map's centre, (0, 0), its index 0.
  function enemySpawn(side: string | null): Spot {
    const spawn = ports.game().maps?.abtesting?.spawns?.[side === 'A' ? 2 : 3];
    return { x: Number(spawn?.[0] ?? 0), y: Number(spawn?.[1] ?? 0) };
  }
  function owned(): Set<string> {
    const names = new Set(ports.members().map(member => member?.name).filter((name): name is string => !!name));
    names.add(ports.character().name);
    return names;
  }
  // An opponent is a live character of the other team in this instance. One of ours is an
  // opponent only under a split strategy whose majority is our team and which names it to feed.
  function validOpponent(target: Entity | null | undefined): boolean {
    const character = ports.character();
    if (!liveAbtesting() || !target || target.type !== 'character' || target.visible === false || target.rip || target.dead ||
        !team(target) || team(target) === team(character)) return false;
    if (target.in != null && character.in != null && target.in !== character.in) return false;
    if (!owned().has(target.name!)) return true;
    const strategy = abtestingStrategy();
    return !!(strategy && strategy.mode === 'split' && strategy.majorityTeam === team(character) && (strategy.sabotageNames || []).includes(target.name!));
  }
  // The nearest opponent: our feeders first, then those attacking an ally, then the weakest, then
  // the nearest. A feeder of ours picks none.
  function nearestOpponent(): Entity | null {
    const character = ports.character(), strategy = abtestingStrategy();
    if (!liveAbtesting() || !strategy || strategy.mode === 'pending' || (strategy.sabotageNames || []).includes(character.name)) return null;
    const feeders = new Set(strategy.sabotageNames || []);
    const allies = new Set(ports.members().filter(member => member && member.team === team(character)).map(member => member.name));
    allies.add(character.name);
    const found = Object.values(ports.entities()).filter(validOpponent);
    found.sort((a, b) => Number(feeders.has(b.name!)) - Number(feeders.has(a.name!)) ||
      Number(!!(b.target && allies.has(b.target))) - Number(!!(a.target && allies.has(a.target))) ||
      (Number(a.hp) || Infinity) - (Number(b.hp) || Infinity) ||
      Math.hypot(a.x - character.x, a.y - character.y) - Math.hypot(b.x - character.x, b.y - character.y));
    return found[0] || null;
  }
  function abtestingMode(): string | undefined {
    if (!liveAbtesting()) return 'none';
    const strategy = abtestingStrategy();
    if (!strategy || strategy.mode === 'pending') return 'pending';
    return (strategy.sabotageNames || []).includes(ports.character().name) ? 'feed' : strategy.mode;
  }
  function sameTeam(member: { team?: unknown } | null | undefined): boolean {
    return !liveAbtesting() || !!(member && member.team && member.team === team(ports.character()));
  }
  // `partyheal` goes outside a live A/B test, or under its uniform strategy (S-06s7).
  function partyhealAllowed(): boolean {
    return !liveAbtesting() || abtestingStrategy()?.mode === 'uniform';
  }

  // The three event rows, in movement's order, each the role runner's row of b9b5c91e.
  // The event return's fight takes the tick and interrupts the return's Town under attack. `franky`
  // takes no tick of its own; `franky-approach` positions the character, so an add-on of its tier
  // places it first.
  const movers: Record<'event-return-combat' | 'franky' | 'franky-approach', (tick: EventMoverTick) => boolean> = {
    'event-return-combat': () => {
      if (!ports.returnFight()) return false;
      ports.cancelReturnTown();
      return true;
    },
    franky: () => false,
    'franky-approach': tick => {
      if (!frankyActive()) return false;
      tick.reselect();
      if (tick.combat && !tick.first()) frankyTick(tick.target() as Entity | null);
      return true;
    },
  };

  const facts = {
    names: () => eventNames(ports.game()),
    joins: (name: string) => eventJoins(name, ports.game()),
    supported: eventSupported,
    walkBoss: eventWalkBoss,
    staged: (name: string) => eventIs(name, 'staged'),
    map: (name: string) => eventMap(name, ports.game()),
    targets, attackers, eventTargets,
    // The derived marker and selection (attend.ts), and the party's freshest boss sighting.
    selected: (name: string) => ports.attend().selected(name), active: () => ports.attend().active(),
    joinedEventName: () => ports.attend().joined(), travellingEventName: () => ports.attend().traveling(),
    freshSighting: (name: string) => ports.attend().sighting(name), recovering: ports.recovering,
    // `event.join` for the survival owner's rejoin rung, attendance's rejoin mark, and the Goo Brawl exit the survival owner's walk
    // home takes as its first rung.
    rejoin: (rung: string) => ports.attend().rejoin(rung), rejoinPending: () => ports.attend().rejoinPending(),
    exitGoobrawlForRecovery: ports.leaveEventMap,
    fightsAdds, bossAdd, reachable, sighting, aggressive, bossMovement,
    frankyActive, frankyTick, merchantFightsEvent, exitRunning: ports.exiting, eventTravelling: ports.travelling,
    team, liveAbtesting, enemySpawn, validOpponent, nearestOpponent, abtestingMode, sameTeam, partyhealAllowed,
    movers,
    strategy: abtestingStrategy, receiveStrategy(next: Strategy | null): void { abtesting = next; },
    // The Witch's Cipher ingredients (october.ts), which the status owner's report counts in the bag.
    cipherIngredients,
  };
  publishEventFacts(facts);
  return facts;
}
export type EventFacts = ReturnType<typeof installEventFacts>;
Object.assign(globalThis, { installEventFacts });
