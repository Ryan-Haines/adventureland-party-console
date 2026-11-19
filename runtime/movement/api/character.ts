// Movement's door for the character realm (X3: an owner asks movement from the door of its realm). A
// character file (the browser bundles) imports only this file, so it pulls no coordinator module into
// its bundle: those need node:perf_hooks and node:worker_threads, and api/coordinator.ts holds them.
// Each line re-exports a type or a rule another owner's character code asks; the definitions stay in
// their movement modules.
export type { FormationRecovery, FormationRecoveryReport, GameData, Geometry, IndependentConfirmation, IndependentReady, Point, Step } from '../geometry/contracts.ts';
// The walk purpose table's hand-off read, which targeting's hand-off checks ask.
export { handsCombatOver } from '../rules.ts';
// Whether the walk holds the combat turn, which turns' the request table rows read.
export { combatHold } from '../rules.ts';
// The combat step's length and the approach's candidate points, which survival's Cave revival
// and the events owner's Franky approach take.
export { approachFan, stepLength } from '../character/steps.ts';
export { ARRIVAL_TOLERANCE, farmWalkHeld, isSafeAt, MOVERS, REPORT_STALL_DISTANCE, tierOf } from '../rules.ts';
export type { Requester } from '../rules.ts';
// The game's item table, which the items owner's saved fields read in both runtimes
// (items/saved-fields.ts).
export { gameItems } from '../../protocol/game-items.ts';
// An NPC's place by its id, so an add-on walks to an NPC it does not hard-code.
export { npcPlace } from '../../protocol/game-npcs.ts';
export type { RunnerTick } from '../character/movers.ts';
export type { Relocation } from '../../protocol/ladder.ts';
export type { ReunionMovement } from '../character/crossings.ts';
export { confirmIndependentApproach, independentApproach, independentReadiness } from '../character/approach.ts';
// The character owner, its parts and its walk state, which targeting's ports hold.
export type { PartyMovement, WalkState } from '../character/owner.ts';
export type { MovementCharacter } from '../character/install.ts';
// movement's add-on action doors (addon-capabilities.md C1, rows/02-movement.ts `ACTIONS`): `walk`
// and `step`, each a `movement.request` answer at the add-on's tier. The character's movers install
// them.
import type { Door } from '../../hooks/registry.ts';
type MovementDoorRoot = { __partyMovementDoors?: ReturnType<typeof import('../character/movers.ts').installMovementMovers>['doors'] };
function movementDoors() {
  const doors = (globalThis as MovementDoorRoot).__partyMovementDoors;
  if (!doors) throw Error('The movement owner is not installed on this character');
  return doors;
}
export const walk: Door = (args, ask) => movementDoors().walk(args, ask);
export const step: Door = (args, ask) => movementDoors().step(args, ask);
