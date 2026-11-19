// Movement's door for the coordinator realm.
// Coordinator files import it, and runtime/movement/api/character.ts for the character half's types and
// constants. This door also carries the shared rules a coordinator file calls (isSafeAt, gameItems
// and the card labels), so no coordinator file takes a rule from both. No character file imports
// this door (owner-check's door rule).
export { restoredConvoy } from '../coordinator/arrivals.ts';
export type { CommandOutcome, ReturnTownPolicy, SavedCommands } from '../coordinator/arrivals.ts';
export { admitMerchantInterruption, attachMerchantInterruption, classifyTravelDefense, communicationReason, finishMerchantInterruption,
  identity, releaseMerchantInterruption, travelCombatFor } from '../coordinator/defense.ts';
// The coordinator's convoy defense step and the Hunt entry's fight read (b9b5c91e convoy-defense.ts `step`, `fighting`).
export { step as convoyDefenseStep, fighting as convoyFighting } from '../coordinator/defense.ts';
export type { CurrentAttacker, TravelState } from '../coordinator/defense.ts';
export { createPlannerService, createRareRouteDistance, createRouteTime, gameEvents, gameMonsters } from '../coordinator/planner-service.ts';
export type { GameMonster } from '../coordinator/planner-service.ts';
export { createCommandOwnership, createMovementRecords } from '../coordinator/records.ts';
export type { CommandOwnershipPlatform } from '../coordinator/records.ts';
export type { NavigationIntent } from '../saved-fields.ts';
export { preparationChanged } from '../coordinator/route-store.ts';
export { samePlace } from '../../protocol/place.ts';
export type { ConvoyNavigationPlatform, NavigationRoutePorts, RouteConvoy, SharedCommand, SharedConvoy, SharedState } from '../coordinator/route-store.ts';
export { acceptTravelReport, createConvoyAcknowledgementRoutes, createConvoyEngagementRoutes, createCoordinatorNavigationActions,
  createPartyTravelRoutes, heartbeatMovement, installMovementRecordRoutes, installMovementRoutes, installSharedConvoyRoute,
  endTownMembership, restoreTownCommand, retireTownCommand, sequencedTravelReport, travelReportFields } from '../coordinator/routes.ts';
export type { HeartbeatMovementPorts } from '../coordinator/routes.ts';
export { authorizeCoordinatorFarmingRoute, canStand, createCoordinatorTravelClock, homeGoal, installCoordinatorMovement, movementFingerprint, prepareMovement,
  stepWalks, townLanding } from '../coordinator/runtime.ts';
export { createSharedConvoyNavigation, sharedCommand, walkEnds } from '../coordinator/walk.ts';
// The terrain recovery round, which core:movement answers and the hook rows type.
export { formationRecovery } from '../coordinator/recovery.ts';
// T3's arrival at a safe goal, which the party escape and death recovery read.
export { isSafeAt } from '../rules.ts';
// A point return's arrival distance, which the events owner's return travel reads (events/coordinator/returns.ts).
export { RETURN_ARRIVAL_RADIUS } from '../rules.ts';
export { climbLabel, farmRecovers, farmWalk, handsCombatOver, partyTravelLabel, playerWalk, walkLabel, type CardWalk } from '../rules.ts';
// The game's item table, which the items owner's bank fates read for stack sizes (items/coordinator/fates.ts).
export { gameItems } from '../../protocol/game-items.ts';
export { npcPlace } from '../../protocol/game-npcs.ts';
export type { HuntTravelCheckpoint, PartyConvoy, WalkStart } from '../coordinator/walk.ts';
// Hunt travel's walk part, which targeting's hunt travel and status read.
export { huntDefense, outboundHunt } from '../coordinator/hunt-travel.ts';

// What the lifecycle owner's composition root (runtime/coordinator/application.ts) and its contract check
// (initialization.contract-check.ts) compose of this owner.
export { createCoordinatorManualNavigation, createCoordinatorPartyConvoys } from '../coordinator/arrivals.ts';
