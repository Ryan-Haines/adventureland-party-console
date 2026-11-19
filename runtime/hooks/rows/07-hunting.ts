// Owner 07's rows of the hook table: hunts and farming. Only 07's build writes this file;
// runtime/hooks/registry.ts composes every owner's file into one `HOOKS` and one `SLOTS`.
import type { DecisionRow, PlainKind } from './row.ts';
import { doorOnly } from './row.ts';
import type { ActionRow, DispatchContext, ReadRow, HookRow, RareSearchAsk, SlotRow } from '../registry.ts';
import type { CaveDestinationAsk, CaveRejoinAsk, FarmSpotAnswer, FarmSpotAsk, HuntQuestAsk } from '../../hunting/api.ts';

export const HOOKS = {
  // The decision hooks (6 part 1). An add-on answers them and never asks them.
  'hunt.quest': { side: 'coordinator', kind: 'request', part: 'hunts and farming (07)', answers: 'many', addonMayAsk: false, bound: 'refusal only',
    fixture: 'e2e/live-hunting-hooks.spec.ts#L: the add-on refuses the planted quest, and the cycle backs up',
    receives: 'group, owner, quest (id, count, ms), candidates', returns: '`false` to refuse, or nothing' },
  'farm.spot': { side: 'coordinator', kind: 'request', part: 'hunts and farming (07)', answers: 'many', addonMayAsk: false,
    bound: 'refusal, or a rank among the alternatives H4 already allows; it cannot add an area',
    fixture: 'e2e/live-hunting-hooks.spec.ts#L: the add-on keeps the relocation to its own spawn',
    receives: 'group, focus, active, alternatives', returns: '`{refuse: [ids]}` or `{prefer: id}`, or nothing' },
  'rare.search': { side: 'coordinator', kind: 'request', part: 'hunts and farming (07)', answers: 'one', addonMayAsk: false,
    bound: "the order of the game's Phoenix regions; it cannot add a region",
    fixture: "scripts/tests/hunting-hooks.test.cjs#U: the add-on's order is the patrol's next region",
    receives: 'group, regions, current', returns: 'an order of the same regions, or nothing' },
  // G3: the order of auto exploration's next point, as `rare.search` orders the patrol.
  'cave.destination': { side: 'coordinator', kind: 'request', part: 'hunts and farming (07)', answers: 'one', addonMayAsk: false,
    bound: 'one of the offered points; it cannot pick the exit, a locked or done point, or another floor, and a paused run asks nothing',
    fixture: "scripts/tests/daily-dungeons.test.cjs#HN: the add-on's room order is the next exploration target",
    receives: 'group, run, floor, points (the unlocked stairs down and the required rooms not done), previous', returns: 'one offered point id, or nothing for the stairs, then the room under way, then the nearest' },
  // G2: a member back online that the game lets enter the run again. An add-on that holds the member
  // on its own task keeps it out of the run.
  'cave.rejoin': { side: 'coordinator', kind: 'request', part: 'hunts and farming (07)', answers: 'many', addonMayAsk: false,
    bound: "refusal only; it cannot rejoin a member the game or the entry check refuses, or drop a member the visit lists; P10: its false to drop keeps an offline member only while a vote pauses the run, and the first unpaused report drops it",
    fixture: 'scripts/tests/daily-dungeons.test.cjs#HN24: an add-on refuses the rejoin and the member stays on its own task',
    receives: 'question (rejoin, drop), group, member, run, clock (paused, expires), task (kind, owner) or null', returns: '`false` to leave the member out on rejoin or keep it listed on drop, or nothing' },
  // The read-only events (6 part 2), one notify at each change on the coordinator.
  'hunt.stage': { side: 'coordinator', kind: 'notice', part: 'hunts and farming (07)', answers: 'many', 
    fixture: "e2e/live-hunting-hooks.spec.ts#L: the cycle goes to Daisy, takes the quest and travels",
    receives: 'group, cycle, from, to, by', returns: 'nothing' },
  'hunt.questChanged': { side: 'coordinator', kind: 'notice', part: 'hunts and farming (07)', answers: 'many', 
    fixture: "e2e/live-hunting-hooks.spec.ts#L: the planted quest is turned in",
    receives: 'group, owner, quest, change (taken, turnedIn), by', returns: 'nothing' },
  'hunt.counted': { side: 'coordinator', kind: 'notice', part: 'hunts and farming (07)', answers: 'many', 
    fixture: "scripts/tests/hunting-hooks.test.cjs#U: a planted too-hard escape counts on the target",
    receives: 'group, target, kind (death, escape, expiration), count, threshold, by', returns: 'nothing' },
  'hunt.blacklisted': { side: 'coordinator', kind: 'notice', part: 'hunts and farming (07)', answers: 'many', 
    fixture: "scripts/tests/hunting-hooks.test.cjs#the planted second count blacklists the target",
    receives: 'group, target, reason, by', returns: 'nothing' },
  'farming.focusChanged': { side: 'coordinator', kind: 'notice', part: 'hunts and farming (07)', answers: 'many', 
    fixture: "e2e/live-hunting-hooks.spec.ts#L: the add-on reads the focus change",
    receives: 'focus, member or party, by', returns: 'nothing' },
  'farm.relocated': { side: 'coordinator', kind: 'notice', part: 'hunts and farming (07)', answers: 'many', 
    fixture: "e2e/live-hunting-hooks.spec.ts#L: the add-on keeps the relocation to its own spawn",
    receives: 'group, from, to, cause (contested, focus, failed), by', returns: 'nothing' },
  'farming.mode': { side: 'coordinator', kind: 'notice', part: 'hunts and farming (07)', answers: 'many', 
    fixture: "e2e/live-hunting-hooks.spec.ts#L: Auto scatters on a learned goo",
    receives: 'group, mode (grouped, scatter), by', returns: 'nothing' },
  'scatter.learned': { side: 'coordinator', kind: 'notice', part: 'hunts and farming (07)', answers: 'many', 
    fixture: "e2e/live-hunting-hooks.spec.ts#L: Auto scatters on a learned goo",
    receives: 'group, type, by', returns: 'nothing' },
  'rare.encounter': { side: 'coordinator', kind: 'notice', part: 'hunts and farming (07)', answers: 'many', 
    fixture: "scripts/tests/hunting-hooks.test.cjs#U: a planted Fairy sighting starts and ends an encounter",
    receives: 'group, target, change (started, ended), code, by', returns: 'nothing' },
  'rare.patrol': { side: 'coordinator', kind: 'notice', part: 'hunts and farming (07)', answers: 'many', 
    fixture: "scripts/tests/hunting-hooks.test.cjs#U: the patrol finishes a planted region",
    receives: 'group, region, change (leg, region-done, paused), by', returns: 'nothing' },
  'cave.phase': { side: 'coordinator', kind: 'notice', part: 'hunts and farming (07)', answers: 'many', 
    fixture: "e2e/live-cave.spec.ts#C: `cave.phase` tells each phase change once, the entry by the player",
    receives: 'party, visit, from, to, by', returns: 'nothing' },
  'cave.member': { side: 'coordinator', kind: 'notice', part: 'hunts and farming (07)', answers: 'many', 
    fixture: 'scripts/tests/daily-dungeons.test.cjs#HN24: an add-on refuses the rejoin and the member stays on its own task',
    receives: 'visit, member, change (dropped, rejoined, refused), by', returns: 'nothing' },
  // The published reads (6 part 3).
  'farming.focus': { side: 'coordinator', kind: 'request', part: 'hunts and farming (07), a published read', answers: 'one', core: true, addonMayAsk: true,
    fixture: "e2e/live-hunting-hooks.spec.ts#L: the add-on reads the focus, the area and the Hunt target",
    receives: 'a group (coordinator) or nothing (character)', returns: 'focus types, priorities, radius, the area and contains(point), the Hunt target, the party type, the combat mode answer, the rare state with its rejections, blocksPulls, the farm spot label (H8), loot pending, the Hunt walk defense and control' },
  'cave.state': { side: 'coordinator', kind: 'request', part: 'hunts and farming (07), a published read', answers: 'one', core: true, addonMayAsk: true,
    fixture: "e2e/live-cave.spec.ts#C: `cave.state` answers each member inside and owned, and the visit active",
    receives: 'a member, or nothing for the party', returns: 'per member inside or not; per party the phase, the run, its end and rewards; caveFloors(name)' },
  'passive.rule': { side: 'coordinator', kind: 'request', part: 'hunts and farming (07), a published read', answers: 'one', core: true, addonMayAsk: true,
    fixture: "e2e/live-hunting-hooks.spec.ts#L: the add-on reads the goo's passive rule and the Fairy's priority",
    receives: 'a monster type', returns: 'the effective rule with its default, and whether the monster has a core priority' },
  'hunt.view': { side: 'coordinator', kind: 'request', part: 'hunts and farming (07), a published read', answers: 'one', core: true, addonMayAsk: true,
    fixture: "e2e/live-hunting-hooks.spec.ts#L: the cycle goes to Daisy, takes the quest and travels",
    receives: 'a group', returns: 'the cycle stage, mission, target, owner and counts, or nothing' },
} as const satisfies Record<string, HookRow>;

// C1 (addon-capabilities.md "The table by owner"): the hunting owner's Hunt and Cave doors. hunt.take is the
// character door in runtime/hunting/api.ts with the coordinator's facts (coordinator/api.ts
// `huntAskFacts`); dungeon.enter runs the Cave's own enter action on the coordinator.
export const ACTIONS = {
  'hunt.take': { events: ['monsterhunt'], functions: ['interact'], door: 'huntTake', args: '{}',
    bound: "a member no core Hunt cycle holds (its group's record has no monsterHunt); the game refuses an interaction out of reach" },
  'dungeon.enter': { events: ['enter', 'interaction'], functions: [], door: 'dungeonEnter', args: '{key: cave}',
    bound: "the Cave's enter action for the party leader (cave.ts begin): the entry checks, and a visit in progress refuses" },
} as const satisfies Record<string, ActionRow>;

// C3: the hunting owner's add-on reads, one per door export that reads (runtime/hunting/api.ts and its coordinator/api.ts).
export const READS = {
  // C3's completeness rule: every other door export that reads, by the export's own type. The
  // table is made from the door exports by kind (a function of state or rules, a constant).
  'door.hunting.defaultHuntSettings': { side: 'both', type: 'typeof defaultHuntSettings', door: 'runtime/hunting/api.ts#defaultHuntSettings' },
  'door.hunting.validHuntSettings': { side: 'both', type: 'typeof validHuntSettings', door: 'runtime/hunting/api.ts#validHuntSettings' },
  'door.hunting.eventDeath': { side: 'both', type: 'typeof eventDeath', door: 'runtime/hunting/api.ts#eventDeath' },
  'door.hunting.caveVisitCurrent': { side: 'both', type: 'typeof caveVisitCurrent', door: 'runtime/hunting/api.ts#caveVisitCurrent' },
  'door.hunting.caveFloorMap': { side: 'both', type: 'typeof caveFloorMap', door: 'runtime/hunting/api.ts#caveFloorMap' },
  'door.hunting.answerOf': { side: 'both', type: 'typeof answerOf', door: 'runtime/hunting/api.ts#answerOf' },
  'door.hunting.farmLine': { side: 'both', type: 'typeof farmLine', door: 'runtime/hunting/api.ts#farmLine' },
  'door.hunting.farmWalkLine': { side: 'both', type: 'typeof farmWalkLine', door: 'runtime/hunting/api.ts#farmWalkLine' },
  'door.hunting.huntLine': { side: 'both', type: 'typeof huntLine', door: 'runtime/hunting/api.ts#huntLine' },
  'door.hunting.modeLine': { side: 'both', type: 'typeof modeLine', door: 'runtime/hunting/api.ts#modeLine' },
  'door.hunting.modePair': { side: 'both', type: 'typeof modePair', door: 'runtime/hunting/api.ts#modePair' },
  'door.hunting.RARE_TRAVEL_LABEL': { side: 'both', type: 'typeof RARE_TRAVEL_LABEL', door: 'runtime/hunting/api.ts#RARE_TRAVEL_LABEL' },
  'door.hunting.rareWalkLine': { side: 'both', type: 'typeof rareWalkLine', door: 'runtime/hunting/api.ts#rareWalkLine' },
  'door.hunting.PATROL_WALK': { side: 'both', type: 'typeof PATROL_WALK', door: 'runtime/hunting/api.ts#PATROL_WALK' },
  'door.hunting.RARE_WALK': { side: 'both', type: 'typeof RARE_WALK', door: 'runtime/hunting/api.ts#RARE_WALK' },
  'door.hunting.rareWalkKind': { side: 'both', type: 'typeof rareWalkKind', door: 'runtime/hunting/api.ts#rareWalkKind' },
  'door.hunting.DEFAULT_COMBAT_MODE': { side: 'both', type: 'typeof DEFAULT_COMBAT_MODE', door: 'runtime/hunting/api.ts#DEFAULT_COMBAT_MODE' },
  'door.hunting.DEFAULT_TARGET_MODE': { side: 'both', type: 'typeof DEFAULT_TARGET_MODE', door: 'runtime/hunting/api.ts#DEFAULT_TARGET_MODE' },
  'door.hunting.slotPair': { side: 'both', type: 'typeof slotPair', door: 'runtime/hunting/api.ts#slotPair' },
  'door.hunting.defaultPassiveRule': { side: 'both', type: 'typeof defaultPassiveRule', door: 'runtime/hunting/api.ts#defaultPassiveRule' },
  'door.hunting.passiveLevelAllowed': { side: 'both', type: 'typeof passiveLevelAllowed', door: 'runtime/hunting/api.ts#passiveLevelAllowed' },
  'door.hunting.committedPassiveRules': { side: 'both', type: 'typeof committedPassiveRules', door: 'runtime/hunting/api.ts#committedPassiveRules' },
  'door.hunting.NO_LEVEL_CAP': { side: 'both', type: 'typeof NO_LEVEL_CAP', door: 'runtime/hunting/api.ts#NO_LEVEL_CAP' },
  'door.hunting.PASSIVE_PRIORITY_RANGE': { side: 'both', type: 'typeof PASSIVE_PRIORITY_RANGE', door: 'runtime/hunting/api.ts#PASSIVE_PRIORITY_RANGE' },
  'door.hunting.SEARCH_RADIUS_RANGE': { side: 'both', type: 'typeof SEARCH_RADIUS_RANGE', door: 'runtime/hunting/api.ts#SEARCH_RADIUS_RANGE' },
  'door.hunting.GAME_CHEST_REACH': { side: 'both', type: 'typeof GAME_CHEST_REACH', door: 'runtime/hunting/api.ts#GAME_CHEST_REACH' },
  'door.hunting.GAME_FIELD_REACH': { side: 'both', type: 'typeof GAME_FIELD_REACH', door: 'runtime/hunting/api.ts#GAME_FIELD_REACH' },
  'door.hunting.partyFocus': { side: 'both', type: 'typeof partyFocus', door: 'runtime/hunting/api.ts#partyFocus' },
  'door.hunting.standsAt': { side: 'both', type: 'typeof standsAt', door: 'runtime/hunting/api.ts#standsAt' },
  'door.hunting.transientFailure': { side: 'both', type: 'typeof transientFailure', door: 'runtime/hunting/api.ts#transientFailure' },
  'door.hunting.voteSettled': { side: 'both', type: 'typeof voteSettled', door: 'runtime/hunting/api.ts#voteSettled' },
  'door.hunting.huntFocusTarget': { side: 'both', type: 'typeof huntFocusTarget', door: 'runtime/hunting/api.ts#huntFocusTarget' },
  'door.hunting.rareEndReadsRare': { side: 'both', type: 'typeof rareEndReadsRare', door: 'runtime/hunting/api.ts#rareEndReadsRare' },
  'door.hunting.polygon': { side: 'both', type: 'typeof polygon', door: 'runtime/hunting/api.ts#polygon' },
  'door.hunting.segmentDistance': { side: 'both', type: 'typeof segmentDistance', door: 'runtime/hunting/api.ts#segmentDistance' },
  'door.hunting.shapeDistance': { side: 'both', type: 'typeof shapeDistance', door: 'runtime/hunting/api.ts#shapeDistance' },
  'door.hunting.distance': { side: 'both', type: 'typeof distance', door: 'runtime/hunting/api.ts#distance' },
  'door.hunting.contains': { side: 'both', type: 'typeof contains', door: 'runtime/hunting/api.ts#contains' },
  'door.hunting.candidates': { side: 'both', type: 'typeof candidates', door: 'runtime/hunting/api.ts#candidates' },
  'door.hunting.withinRadius': { side: 'both', type: 'typeof withinRadius', door: 'runtime/hunting/api.ts#withinRadius' },
  'door.hunting.bounds': { side: 'both', type: 'typeof bounds', door: 'runtime/hunting/api.ts#bounds' },
  'door.hunting.overlap': { side: 'both', type: 'typeof overlap', door: 'runtime/hunting/api.ts#overlap' },
  'door.hunting.firstSpawn': { side: 'both', type: 'typeof firstSpawn', door: 'runtime/hunting/api.ts#firstSpawn' },
  'door.hunting.id': { side: 'both', type: 'typeof id', door: 'runtime/hunting/api.ts#id' },
  'door.hunting.zones': { side: 'both', type: 'typeof zones', door: 'runtime/hunting/api.ts#zones' },
  'door.hunting.resolve': { side: 'both', type: 'typeof resolve', door: 'runtime/hunting/api.ts#resolve' },
  'door.hunting.searchPoints': { side: 'both', type: 'typeof searchPoints', door: 'runtime/hunting/api.ts#searchPoints' },
  'door.hunting.defaultSearchRadius': { side: 'both', type: 'typeof defaultSearchRadius', door: 'runtime/hunting/api.ts#defaultSearchRadius' },
  'door.hunting.spawnCatalog': { side: 'both', type: 'typeof spawnCatalog', door: 'runtime/hunting/api.ts#spawnCatalog' },
  'door.hunting.huntSpawnKey': { side: 'both', type: 'typeof huntSpawnKey', door: 'runtime/hunting/api.ts#huntSpawnKey' },
  'door.hunting.defaultPhoenixOrder': { side: 'both', type: 'typeof defaultPhoenixOrder', door: 'runtime/hunting/api.ts#defaultPhoenixOrder' },
  'door.hunting.farmingAreas': { side: 'both', type: 'typeof farmingAreas', door: 'runtime/hunting/api.ts#farmingAreas' },
  'door.hunting.validFarmingLocation': { side: 'both', type: 'typeof validFarmingLocation', door: 'runtime/hunting/api.ts#validFarmingLocation' },
  'door.hunting.huntOwner': { side: 'coordinator', type: 'typeof huntOwner', door: 'runtime/hunting/coordinator/api.ts#huntOwner' },
  'door.hunting.ownsHuntRoute': { side: 'coordinator', type: 'typeof ownsHuntRoute', door: 'runtime/hunting/coordinator/api.ts#ownsHuntRoute' },
  'door.hunting.inheritedHuntRoute': { side: 'coordinator', type: 'typeof inheritedHuntRoute', door: 'runtime/hunting/coordinator/api.ts#inheritedHuntRoute' },
  'door.hunting.coordinatorHuntDestination': { side: 'coordinator', type: 'typeof coordinatorHuntDestination', door: 'runtime/hunting/coordinator/api.ts#coordinatorHuntDestination' },
  'door.hunting.selectCoordinatorMonsterDestination': { side: 'coordinator', type: 'typeof selectCoordinatorMonsterDestination', door: 'runtime/hunting/coordinator/api.ts#selectCoordinatorMonsterDestination' },
  'door.hunting.searchReach': { side: 'coordinator', type: 'typeof searchReach', door: 'runtime/hunting/coordinator/api.ts#searchReach' },
  'door.hunting.farmTravelPaused': { side: 'coordinator', type: 'typeof farmTravelPaused', door: 'runtime/hunting/coordinator/api.ts#farmTravelPaused' },
  'door.hunting.monsterFocus': { side: 'coordinator', type: 'typeof monsterFocus', door: 'runtime/hunting/coordinator/api.ts#monsterFocus' },
  'door.hunting.caveFloors': { side: 'coordinator', type: 'typeof caveFloors', door: 'runtime/hunting/coordinator/api.ts#caveFloors' },
  'door.hunting.caveCombat': { side: 'coordinator', type: 'typeof caveCombat', door: 'runtime/hunting/coordinator/api.ts#caveCombat' },
  'door.hunting.farmingModeNames': { side: 'coordinator', type: 'typeof farmingModeNames', door: 'runtime/hunting/coordinator/api.ts#farmingModeNames' },
  'door.hunting.slotsOfMode': { side: 'coordinator', type: 'typeof slotsOfMode', door: 'runtime/hunting/coordinator/api.ts#slotsOfMode' },
  'door.hunting.requestedSlots': { side: 'coordinator', type: 'typeof requestedSlots', door: 'runtime/hunting/coordinator/api.ts#requestedSlots' },
  'door.hunting.huntKind': { side: 'coordinator', type: 'typeof huntKind', door: 'runtime/hunting/coordinator/api.ts#huntKind' },
  'door.hunting.farmingRecordOf': { side: 'coordinator', type: 'typeof farmingRecordOf', door: 'runtime/hunting/coordinator/api.ts#farmingRecordOf' },
  'door.hunting.validPassivePatch': { side: 'coordinator', type: 'typeof validPassivePatch', door: 'runtime/hunting/coordinator/api.ts#validPassivePatch' },
} as const satisfies Record<string, ReadRow>;
// C3's completeness rule: the door exports that are no read, each a write (it changes owner state), a
// port (an install, a factory or a published answer the composition wires) or a command (it builds
// or sends work to a character). A door named by an ACTIONS row is no entry here.
export const DOOR_ONLY = {
  ...doorOnly('runtime/hunting/api.ts', 'write', ['migratePassiveSettings']),
  ...doorOnly('runtime/hunting/coordinator/api.ts', 'write', ['migrateEmptyFocusIntents', 'migrateRareRules', 'migrateSharedMonsterFocus', 'clearSpotRecovery', 'writeHunt', 'writeSpot', 'acceptArrival', 'huntOwnerLeft', 'propagateHuntTarget', 'engageHunt', 'cancelCoordinatorHuntConvoy', 'clearCoordinatorHunt', 'engageFarming', 'observeScatter', 'consumeOneShotReports', 'acceptHunterLocation', 'tickHuntSaved', 'preserveRare']),
  ...doorOnly('runtime/hunting/api.ts', 'port', ['installLootClient']),
  ...doorOnly('runtime/hunting/coordinator/api.ts', 'port', ['installHunting', 'huntAskFacts', 'loadFarmingRecord', 'createHunt', 'createFocusSelection', 'createMonsterSelection', 'createFarmingIntents', 'createScatterReports', 'createFocusRoute', 'createPartyCheckpointRoute', 'createMonsterSelectionRoutes', 'createHuntRoutes', 'createSavedFarmingModeRoute', 'installCaveRoutes', 'createHuntingSources']),
  ...doorOnly('runtime/hunting/coordinator/api.ts', 'command', ['farmingReply', 'createFarmingCommand']),
};

// The dashboard slots (6 part 4), drawn by 12's card (dashboard/features/party/farming-mode-control.tsx);
// the card's Hunt panel and the passive menu are 12's.
export const SLOTS = {
  'hunt-status': { owner: '07', data: "{hunt: the Hunt status block's hunt view, settings}; the add-on's piece draws its line", section: true, 
    bound: "adds one line per add-on after the Hunt status block's core lines",
    fixture: "scripts/tests/dashboard-addon-slots.test.cjs#hunt-status: the add-on's line shows under the Hunt status, with the hunt view" },
  'rare-list': { owner: '07', data: "{search, disabled, settings}; the add-on's piece draws its monsters' rows with their rule fields", section: true, 
    bound: "adds table rows after the passive hunting menu's monster rows; the core rows and their rules stay as they are",
    fixture: "scripts/tests/dashboard-addon-slots.test.cjs#rare-list: the add-on's rows follow the passive hunting menu's monster rows" },
} as const satisfies Record<string, SlotRow>;

export function dispatch(ctx: DispatchContext) {
  return {
    // `hunt.quest` (6.1): the first add-on that refuses the quest, by name. The selection skips a
    // refused quest as it skips a blacklisted one. An answer that throws refuses nothing.
    questRefused(ask: HuntQuestAsk): string | undefined {
      return ctx.answering('hunt.quest').find(r => ctx.call(r, 'hunt.quest', () => r.hooks['hunt.quest']!(ask, ctx.settings(r.name))) === false)?.name;
    },
    // `cave.destination`: the one add-on's pick, kept only when it names an offered point. An
    // answer that throws or names another point picks nothing.
    destination(ask: CaveDestinationAsk): string | undefined {
      const r = ctx.answering('cave.destination')[0];
      const answer = r && ctx.call(r, 'cave.destination', () => r.hooks['cave.destination']!(ask, ctx.settings(r.name)));
      return ask.points.some(p => p.id === answer) ? answer : undefined;
    },
    // `cave.rejoin`: the first add-on that refuses the member's rejoin, by name. An answer that
    // throws refuses nothing.
    rejoinRefused(ask: CaveRejoinAsk): string | undefined {
      return ctx.answering('cave.rejoin').find(r => ctx.call(r, 'cave.rejoin', () => r.hooks['cave.rejoin']!(ask, ctx.settings(r.name))) === false)?.name;
    },
    // P10 `cave.rejoin` `drop`: the first add-on that keeps an offline member in a paused run, by
    // name. The coordinator asks only while the run is paused, so no answer keeps a member past play.
    dropRefused(ask: CaveRejoinAsk & { question: 'drop' }): string | undefined {
      return ctx.answering('cave.rejoin').find(r => ctx.call(r, 'cave.rejoin', () => r.hooks['cave.rejoin']!(ask, ctx.settings(r.name))) === false)?.name;
    },
    // `farm.spot`: every add-on's refusals together, and the first preference among the
    // areas no add-on refused. An answer that throws counts as none.
    spot(ask: FarmSpotAsk): FarmSpotAnswer | undefined {
      const answers = ctx.answers('farm.spot', r => r.hooks['farm.spot']!(ask, ctx.settings(r.name))).map(a => a.answer);
      const refuse = answers.flatMap(a => Array.isArray(a.refuse) ? a.refuse.map(String) : []);
      const prefer = answers.map(a => a.prefer).find((area): area is string => typeof area === 'string' && !refuse.includes(area));
      return refuse.length || prefer ? { refuse, prefer } : undefined;
    },
    // `rare.search` (6.1): the one add-on's order, kept only when it names exactly the game's
    // regions. An answer that throws or names another set orders nothing.
    search(ask: RareSearchAsk): string[] | undefined {
      const r = ctx.answering('rare.search')[0];
      if (!r) return undefined;
      const answer = ctx.call(r, 'rare.search', () => r.hooks['rare.search']!(ask, ctx.settings(r.name)));
      if (!Array.isArray(answer) || answer.length !== ask.regions.length || !ask.regions.every(id => answer!.includes(id))) return undefined;
      return [...answer];
    },
  };
}

// The hook coverage (addon:check rule 8, farming and the Cave"):
// each decision of the files below with its hook or core-only reason, and each other export's plain kind.
export const RULE_FILES = ['runtime/hunting/rules.ts'] as const;
export const DECISIONS = {
  'Hunt quest choice': { site: 'runtime/hunting/coordinator/hunt.ts:797', hook: 'hunt.quest' },
  'farm spot relocation': { at: 'runtime/hunting/rules.ts#alternatives', hook: 'farm.spot' },
  'a spot counts as contested': { at: 'runtime/hunting/rules.ts#contests', core: 'game', cite: 'runtime/hunting/rules.ts:73, other players\' hits and kills' },
  'Phoenix patrol order': { site: 'runtime/hunting/coordinator/rares.ts:794', hook: 'rare.search' },
  'a sighted rare outranks the current target': { site: 'runtime/hunting/coordinator/rares.ts:461', hook: 'settings.overlay' },
  'a passive rare\'s level cap': { at: 'runtime/hunting/rules.ts#passiveLevelAllowed', hook: 'settings.overlay' },
  'Auto mode scatters': { at: 'runtime/hunting/rules.ts#combatModeAnswer', hook: 'combat.mode' },
  'the Hunt hand-off holds': { at: 'runtime/hunting/rules.ts#handoffHeld', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:12' },
  'a death counts at an event': { at: 'runtime/hunting/rules.ts#eventDeath', hook: 'retry.policy' },
  'a rare\'s end rejects it': { at: 'runtime/hunting/rules.ts#rareEndRejects', hook: 'retry.policy' },
  'Hunt blacklist at the death or expiry threshold': { site: 'runtime/hunting/coordinator/hunt.ts:209', hook: 'settings.overlay' },
  'Hunt loot waits before leaving': { at: 'runtime/hunting/rules.ts#huntLootId', core: 'game', cite: 'runtime/hunting/rules.ts:215, chests' },
  'Cave offline drop': { at: 'runtime/hunting/rules.ts#caveDropped', hook: 'cave.rejoin' },
  'Cave rejoin of a member back online': { at: 'runtime/hunting/rules.ts#caveRejoinOpen', hook: 'cave.rejoin' },
  'Cave auto exploration\'s offered points': { at: 'runtime/hunting/rules.ts#caveDestinations', hook: 'cave.destination' },
  'Cave auto exploration\'s next point': { at: 'runtime/hunting/rules.ts#caveNextPoint', hook: 'cave.destination' },
  'Cave exits for a live event at R6\'s cut-off': { site: 'runtime/hunting/coordinator/cave.ts:337', hook: 'settings.overlay' },
  'Cave after a run, stay or go back': { site: 'runtime/hunting/coordinator/cave.ts:327', hook: 'settings.overlay' },
} satisfies Record<string, DecisionRow>;
export const PLAIN = {
  // Facts the game fixes, which the console reads; an add-on's answer cannot change them.
  standsAt: 'read', transientFailure: 'read', caveVisitCurrent: 'read', voteSettled: 'read',
  huntFocusTarget: 'read', partyFocus: 'read', searchReach: 'read', answerOf: 'read', rareEndReadsRare: 'read',
  rareWalkKind: 'read', slotPair: 'read', defaultPassiveRule: 'read',
  realmOf: 'format', instanceOf: 'format', caveFloorMap: 'format', committedPassiveRules: 'format',
  huntLabel: 'label', rareEndLabel: 'label', rareLabel: 'label', caveLabel: 'label', huntLine: 'label',
  rareWalkLine: 'label', modePair: 'label', modeLine: 'label', farmWalkLine: 'label', farmLine: 'label',
  caveTravelLabel: 'label',
  migratePassiveSettings: 'migration',
  validHuntSettings: 'validator',
} satisfies Record<string, PlainKind>;
