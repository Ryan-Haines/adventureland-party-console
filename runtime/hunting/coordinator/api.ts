// Hunts and farming's coordinator door (as the events owner's
// runtime/events/coordinator/api.ts): the coordinator values of runtime/hunting/, which the
// character bundles and the dashboard must not load. runtime/hunting/api.ts holds what both
// runtimes read.
// The farming record's load and its load migrations.
export { loadFarmingRecord, migrateEmptyFocusIntents, migrateRareRules, migrateSharedMonsterFocus } from './record.ts';
// The record's writers: the walk's place (movement), a member's move to another scope
// (01), the bag route's preferred farm spot (10), a travel command's recovery clear (movement) and
// the target mode entry's focus (the tasks owner's ports) write the record through them.
export { clearSpotRecovery, writeHunt, writeSpot } from './record.ts';
// The Hunt cycle: the group's Hunt service, whose ports the initialization contract check
// reads; the walk arrival the movement routes report (`acceptArrival`); the quest owner the targeting owner's group
// snapshot reads.
export { createHunt, acceptArrival, owner as huntOwner } from './hunt.ts';
// The Hunt's quest choice that starts again when its owner leaves, which the tasks owner's Follow move asks.
export { huntOwnerLeft } from './hunt.ts';
// The Hunt's walks: movement's walk asks whether a walk carries the mission's route and which
// recovery entry it inherits, keeps the Hunt's target on replacement commands and finishes a Hunt
// walk's route; the composition ends the Hunt's walk or the cycle and picks a target's spawn.
export { ownsHuntRoute, inheritedHuntRoute, propagateHuntTarget, engageHunt, cancelCoordinatorHuntConvoy, clearCoordinatorHunt,
  coordinatorHuntDestination } from './hunt.ts';
// Farming: the focus and farm spot selections the focus, character and monster routes make, the selected farm
// destination, and the farming walk's combat arrival movement's walk asks.
export { createFocusSelection, createMonsterSelection, selectCoordinatorMonsterDestination, engageFarming, createFarmingIntents } from './farm.ts';
export type { FocusState } from './farm.ts';
// The search radius a character farms within, which the target mode entries' ports read.
export { searchReach } from '../rules.ts';
// The combat mode answer and scatter learning: the status owner's report ingestion learns the one-shot types,
// keeps the Monster Hunter's location and updates the scatter record; the heartbeat reply carries
// the farming fields.
export { observeScatter, consumeOneShotReports, acceptHunterLocation, farmingReply, farmTravelPaused, createScatterReports } from './modes.ts';
export { tickHuntSaved } from './record.ts';
// A member's monster focus, which the status owner's card line reads.
export { monsterFocus, type MemberFocusState } from './modes.ts';
export type { ScatterState, ScatterStatus } from './modes.ts';
// Rares: the newer rare observation the status owner's combat ingestion keeps.
export { preserveRare } from './rares.ts';
// The Cave visit: the floors a worker gets and the Cave floor's grouped queue
// targeting's snapshot asks. Whether a visit owns a member is the published `cave.state` read.
export { caveFloors, caveCombat } from './cave.ts';
// The hunting owner's Cave door (`dungeon.enter`): the ask runs the Cave's own enter action
// on the coordinator (cave.ts `addonEnter`), which gathers the leader's party; the action's refusal
// answers refused.
type CaveRoot = { __partyCaveEnter?: (addon: string, character: string, id: string) => void };
export function dungeonEnter(args: Readonly<Record<string, unknown>>, ask: { addon: string; character: string; id: string }):
  { outcome: 'sent' } | { outcome: 'refused'; by: string; reason: string } {
  if (args.key !== 'cave') return { outcome: 'refused', by: '07', reason: 'dungeon.enter runs the Cave only' };
  const cave = (globalThis as CaveRoot).__partyCaveEnter;
  if (!cave) throw Error('The hunting owner is not installed in this realm');
  try { cave(ask.addon, ask.character, ask.id); } catch (error) {
    return { outcome: 'refused', by: '07', reason: error instanceof Error ? error.message : String(error) };
  }
  return { outcome: 'sent' };
}
// The routes: each parses its request, asks the module and replies; application.ts composes
// them, and the Cave's GET and actions install on the router.
export { createFarmingCommand, createFocusRoute, createPartyCheckpointRoute, createMonsterSelectionRoutes, createHuntRoutes, createSavedFarmingModeRoute,
  installCaveRoutes, farmingModeNames, slotsOfMode, requestedSlots } from './routes.ts';
// The module's install, which application.ts calls once: the party's Cave visit and rare service,
// the rare's clock and each combat group's Hunt and farm spot. The tasks owner's sources for the Cave,
// the rare and the Hunt with the Hunt task's suspend listener, the Hunt's task kind and the target
// mode slot's Hunt entry, and the Hunt tick's save on change.
export { createHuntingSources, huntKind } from './install.ts';
import { installHunting as installOwner } from './install.ts';
import type { HuntDoorFacts } from '../api.ts';
// The install with the facts an add-on's hunt.take ask carries: whether a
// combat group the member is in has a core Hunt cycle (its record's `monsterHunt`).
type AskRoot = { __partyHuntAsk?: (character: string) => HuntDoorFacts };
export function installHunting(...args: Parameters<typeof installOwner>): ReturnType<typeof installOwner> {
  const owner = installOwner(...args), groups: Parameters<typeof owner.group>[] = [];
  const group = owner.group;
  (globalThis as AskRoot).__partyHuntAsk = character =>
    ({ held: groups.some(([state, , , g]) => !!state.monsterHunt && g.navigation.members().includes(character)) });
  return { ...owner, group: (...a: Parameters<typeof group>) => { groups.push(a); return group(...a); } };
}
/** The coordinator's facts for an add-on's hunt.take ask, which the dispatcher sends beside it. */
export function huntAskFacts(character: string): HuntDoorFacts {
  const ask = (globalThis as AskRoot).__partyHuntAsk;
  if (!ask) throw Error('The hunting owner is not installed in this realm');
  return ask(character);
}
export type { HuntScope } from './install.ts';
export { farmingRecordOf } from './modes.ts';
// The rare hunting route's check of a passive rules patch (`validPassive`), the declaration's own.
export { validPassivePatch } from '../saved-fields.ts';
