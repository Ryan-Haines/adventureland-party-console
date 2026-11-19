(function (root) {
  // 13's run scope (runtime/lifecycle/character/run.ts; 13-lifecycle-design L1.3, K-B1, LIF-W1): every
  // timer, listener and sleep of this file goes through its owner's handle, which table P holds while
  // the character is held and which the generation's stop disposes, in a native frame as in a headless
  // one. It disposes the previous generation's scope from the game window.
  var run = root.partyLifecycle.createRunScope({ frame: root, game: parent, name: function () { return character.name; },
    hold: function () { return holds.handBy(); },
    notify: function (hook, payload) { root.__partyHooks.notify(hook, payload); } });
  var scopes = { act02: run.scope("02", "act"), act05: run.scope("05", "act"), act06: run.scope("06", "act"), observe06: run.scope("06", "observe"),
    act07: run.scope("07", "act"), act08: run.scope("08", "act"), act09: run.scope("09", "act"), observe09: run.scope("09", "observe"), act10: run.scope("10", "act"),
    observe04: run.scope("04", "observe"), observe07: run.scope("07", "observe"), observe10: run.scope("10", "observe"), observe12: run.scope("12", "observe") };
  // 05's escape that owns this character (`survival.escaping`), the one read every install's
  // `escaping` port takes.
  function survivalEscaping() { return !!root.__partyHooks.survival.escaping(character.name); }
  // The game's `is_in_range` for a target, false where the client has none: the one read 07's and
  // 06's `inRange` ports take.
  function gameInRange(target) { return typeof is_in_range === "function" && !!is_in_range(target); }
  if (!root.partyFarmingZones) throw new Error("Load farming-zones.js before shared.js; party startup aborted");
  // 07's install on the character (runtime/hunting/character/install.ts `installHuntingClient`): the
  // farm client (the farm part of the reply, the farming type, farm area membership, candidates and
  // entry point, the competition evidence and the one-shot learner with its `hit` listener, the
  // farming walk's hand-off and spawn return), the Hunt client (the quest report, Daisy, the Hunt
  // walk's travel facts and acquisition diagnostics), the rare client (the rare reports, candidate,
  // control and the rare's walk, deploy and loot legs), the Cave client (ownership, the floor's party,
  // chest loot and the dungeon runtime) and the `farming.focus` and `cave.state` facts the other
  // owners' ports read. It installs before the owners whose ports ask it, so each port is a function
  // that reads its owner's state when called.
  var huntingClient = root.installHuntingClient({
    character: function () { return character; }, frame: function () { return parent; }, game: function () { return G; },
    entity: function (id) { return get_entity(id); }, player: function (name) { return get_player(name); },
    members: function () { return currentPartyList(); }, realm: function () { return reunionRealm(); },
    walk: function () { return walkState; }, travel: function () { return groupWalk.travel; },
    huntTravel: function () { return root.__partyHuntTravel; }, spot: function () { return walkState.partyLocation; },
    scope: function () { return targetScope(); }, current: function () { return run.current(); },
    walkable: function (p) { return movementParts.walkable(p); },
    kept: function () { return root; }, own: function (actor) { return telemetry.ownActor(actor); },
    hitMetrics: function (data, target) { telemetry.hit(data, target); },
    defendHit: function (data) { defendPartyHit(data); },
    deathHit: function (data) { if (targetingDeath) targetingDeath.hit(data); },
    queueHit: function (data) { if (root.partyQueueClient) root.partyQueueClient.hit(data); },
    ownHit: function (data, entity) { telemetry.ownKill(data, entity); },
    focusChanged: function () { targeting.focusChanged(); },
    selected: function () { return targeting.selection().targetId && get_entity(targeting.selection().targetId); },
    queue: function () { return targeting.queue(); },
    priority: function (target) { return monsterPriority(target); }, fighting: function () { return unfinishedFight(); },
    passing: function (entity) { return isPassingEncounter(entity); }, passingKey: function (t) { return passingKey(t); },
    passiveStop: function (t) { return !!passiveStopRequired(t); }, levelAllowed: function (entity) { return passiveLevelAllowed(entity); },
    target: function () { return rareTarget(); }, deaths: function () { return targeting.selection().deaths; },
    allowed: function (target, command, diagnostic) { return isAllowedTarget(target, command, diagnostic); },
    attackers: function () { return currentTravelAttackers(); }, threat: function (entity) { return dungeonCombatThreat(entity); },
    inRange: gameInRange,
    reachable: function (target) { return movementParts.reachable(target); },
    attackable: function (entity) { return typeof can_attack === 'function' && can_attack(entity); },
    convoyDefense: function () { return !!walkState.convoyDefense; }, recoveryHolds: function () { return !!combatRecoveryHolds(); },
    escaping: survivalEscaping,
    respawn: function (by) { return root.__partyHooks.survival.respawn({ by: by }); },
    leader: function () { return partyMembership.leader(); }, followLeader: function () { return partyMembership.followLeader(); },
    eventTypes: function () { return eventAttend.targetTypes(); }, eventActive: function () { return !!eventAttend.active(); },
    eventJoined: function () { return !!eventAttend.joined(); }, eventTravelling: function () { return !!eventAttend.traveling(); },
    onEventMap: function () { return !!(G.maps && G.maps[character.map] && G.maps[character.map].event); },
    following: function () { return !!walkState.following; },
    // The farming walk hand-off's holds (hunting/rules.ts `handoffHeld`), one owner's fact each.
    huntErrand: function () { return !!bag.errandFor('hunt'); }, forcedWalk: function () { return !!walkState.forceTraveling; },
    townWalk: function () { return !!walkState.townTraveling; }, townActive: function () { return !!walkState.townActive; },
    groupWalk: function () { return !!groupWalk.travel; }, convoyActive: function () { return !!walkState.convoyActive; },
    gathering: function () { return !!merchantGathering.active(); }, reunion: function () { return !!currentReunion(); },
    anniversaryVisit: function () { return !!eventAnniversary.busy(); }, anniversaryStaging: function () { return !!eventAnniversary.staging(); },
    errands: function () { return bag.errands(); },
    farmTarget: function (location) { return farmingTravelTarget({ location: location }); },
    takeTarget: function (target) { movementParts.endFollowForTarget(); targeting.setTargetId(target.id); },
    findNpc: function (name) { return typeof find_npc === "function" ? find_npc(name) : null; },
    log: function (kind, message, details, key) { telemetry.line(kind, message, details, key); },
    npcWalk: function (location) { return smart_move(location, undefined, { request: huntNpcRequest }); },
    post: function (path, options) { return request(path, options); },
    gameLog: function (message, color) { game_log(message, color); },
    lootClient: function () { return root.partyLootClient; },
    loot: function () { return market.smartLoot(); }, chestsLeft: function () { return market.eligibleDepartureChests().length; },
    deploy: function (slot) { return itemsOwner.game.equip(slot); },
    pathRequest: function (id) { return rarePathRequest({ id: id }); },
    climb: function (climb) { return climbTaskWalk(climb); }, endClimb: function (owner) { return endTaskWalk(owner); },
    supported: function () { return typeof cave_info === 'function' && typeof cave_enter === 'function' && typeof cave_exit === 'function'; },
    withTimeout: scopes.act07.withTimeout,
    transport: function (request, map, spawn) { return transportAs(request, map, spawn); },
    movement: function () { return movement; }, cruise: function (speed) { return movementParts.cruise(speed); },
    storage: function () { return root.localStorage; },
    drainHeld: function () { return drain.holds(); }, travelCombat: function () { return travelCombatActive(); },
    departing: function () { return walkState.departing; }, departureCombat: function () { return departureCombatPending(); },
    monsterEngaged: function () { return !!engagedMonster(); }, bankQueued: function () { return bag.fact('bankQueued'); },
    positions: function () { return targeting.positions(); }, engagedWith: function (entity) { return departureTargetEngaged(entity); },
    chests: function () { return market.eligibleDepartureChests(); }, socket: function () { return parent.socket; },
    // Movement's walk ends a rare encounter, a rare control and the Cave's command ask (commands.ts).
    retirePatrolWalk: function () { walkCommands.endPatrolWalk(); },
    farmHandoff: function () { return walkCommands.takeFarmMovement(); },
    caveStop: function () { return walkCommands.stopForCave(); },
  });
  // 07's character door on the frame: the role runner's loot client, the queue client and the e2e
  // probes read the farm, Hunt, rare and Cave clients here.
  root.partyHunting = huntingClient;
  var farm = huntingClient.farm, huntClient = huntingClient.hunt, rares = huntingClient.rares, caveClient = huntingClient.cave,
    hunting = huntingClient.facts;
  // K1 on the character and the event facts (runtime/events/character/combat.ts): the event names,
  // join, support, map and monster lists from the client's game data, the monster list cached per
  // game data and filtered by the player's pick in the event's limits, and the facts other owners
  // read: reach, sighting, Franky, the merchant's event fight and A/B Testing. It installs first,
  // since the other owners' installs below take its facts.
  var characterEvents = root.installEventFacts({ game: function () { return G; },
    limits: function (name) { return eventReply.limits()[name]; },
    character: function () { return character; }, entities: function () { return parent.entities || {}; },
    attend: function () { return eventAttend; }, activity: function (name) { return octoberRuntime().activity(name); },
    clockOffset: function () { return walkState.clockOffset; },
    members: function () { return targeting.positions(); }, inPvp: function () { return typeof in_pvp === "function" && !!in_pvp(); },
    targetTypes: function () { return eventAttend.targetTypes(); },
    exitPending: function () { return eventExit.pending(); }, merchantJob: function () { return merchantRunner.holder(); },
    exiting: function () { return eventExit.exiting(); },
    leaveEventMap: function (current, request) { return eventExit.leaveEventMap(current, request); },
    travelling: function () { return !!(eventAttend.traveling() || (eventAnniversary.busy() || eventAnniversary.staging()) && !walkState.convoyDefense); },
    recovering: function () { var staging = eventAnniversary.operation(); return !!(staging && !staging.cancelled || eventExit.returning()); },
    inRange: function (target) { return typeof is_in_range === "function" && !!is_in_range(target); },
    approachPoint: function (target) { return combatApproachPoint(target); },
    canMoveTo: function (x, y) { return typeof can_move_to === "function" && !!can_move_to(x, y); },
    safePoint: function (point, target) { return safeCombatPoint(point, target); },
    step: function (target, point, mode, closes) { return sendCombatMove(target, point, mode, closes); },
    resetSteps: function () { resetCombatMovement(); },
    position: function (record) { root.partyCombatPosition = record; }, now: Date.now,
    frankyAllows: function (target) { return frankyTargetAllowed(target); },
    returnFight: function () { return returnCombatActive(); }, cancelReturnTown: function () { cancelReturnTownUnderAttack(); } });
  if (!root.partyTargeting) throw new Error("Load targeting's shared entry before shared.js; party startup aborted");
  // 13's drain on the character (runtime/lifecycle/character/drain.ts): the deploy lease, the fight it
  // lets finish, Load in Main and the checkpoint return, the atomic boundary and the acknowledgement.
  var drain = root.partyLifecycle.createDrain({ frame: root, game: parent,
    character: function () { return character; }, storage: function () { return root.localStorage; },
    realm: function () { return reunionRealm(); }, current: run.current, retired: run.retired, held: run.held,
    markers: function () { return markerView.markers(); },
    started: function (id) { return !!(root.partyRoleRunner && root.partyRoleRunner.hasStartedTarget && root.partyRoleRunner.hasStartedTarget(id)); },
    attackingParty: function (id) { return isAttackingPartyMember(get_entity(id)); },
    engaged: function () { return engagedCombatTarget(); }, drainKey: function (target) { return consoleDrainKey(target); },
    drainFight: function () { return consoleDrainCombatActive(); }, attackers: function () { return currentTravelAttackers().length; },
    move: function (goal, owner, label, forced) { return movementParts.lifecycleWalk(goal, { kind: "lifecycle", owner: owner, label: label }, !!forced); },
    parked: function () { return movement.consolePaused(); },
    routing: function () { return !!smart.moving; },
    log: function (message) { game_log(message, "red"); } });
  // The merchant job owner's character half (party-console-plan 08-09-merchant-design 3.1, S1): the
  // fighter's visit to the merchant (runtime/merchant-jobs/character/visits.ts), over `visitPorts()`,
  // and the runner that holds the merchant (runner.ts), over `runnerPorts()`; the realm owner's hop
  // executor (runtime/merchant-realm/character/hop.ts), over `hopPorts()`.
  if (!root.partyMerchant || !root.partyMerchant.jobs || !root.partyMerchant.realm) throw new Error("Load the merchant owners' character entry before shared.js; party startup aborted");
  // 10's character half (party-console-plan 10-inventory-bank-commerce-design 3.1): the bag holder
  // and the I7 failures.
  if (!root.partyItems) throw new Error("Load the items owner's character entry before shared.js; party startup aborted");
  var itemsOwner = root.partyItems, bag = itemsOwner.bag;
  // The bag's reads (runtime/items/character/bag.ts, E00-10r1 to r3) over `bagPorts()`.
  var bagReads = itemsOwner.bagReads(bagPorts());
  var fingerprint = bagReads.fingerprint, sameItem = bagReads.sameItem, sameItemState = bagReads.sameItemState,
    itemQuantity = bagReads.itemQuantity, inventoryTotals = bagReads.inventoryTotals, findItem = bagReads.findItem,
    findInventoryItemByName = bagReads.findInventoryItemByName, inventoryQuantity = bagReads.inventoryQuantity,
    inventoryAmount = bagReads.inventoryAmount, findMarkedInventoryItem = bagReads.findMarkedInventoryItem,
    findMarkedItem = bagReads.findMarkedItem, waitForMarkedItem = bagReads.waitForMarkedItem,
    freeInventorySlots = bagReads.freeInventorySlots,
    waitForPlayer = bagReads.waitForPlayer, standSlots = bagReads.standSlots, itemSeller = bagReads.itemSeller,
    safeItemDefinition = bagReads.safeItemDefinition, nativeMonsterDropTables = bagReads.nativeMonsterDropTables,
    maximumItemLevel = bagReads.maximumItemLevel, itemWorldInfo = bagReads.itemWorldInfo, itemSheetSprite = bagReads.itemSheetSprite,
    itemDefinition = bagReads.itemDefinition, inventoryOperationEntry = bagReads.inventoryOperationEntry, merchantCatalog = bagReads.merchantCatalog, bankSnapshot = bagReads.bankSnapshot,
    bankVaultCatalog = bagReads.bankVaultCatalog, attachStatusInventory = bagReads.attachStatusInventory,
    acknowledgeStatusInventory = bagReads.acknowledgeStatusInventory,
    statusInventoryResend = bagReads.statusInventoryResend;
  // The bank (runtime/items/character/bank.ts, E00-10r4 to r6, r8, r9, T5 to T7, S94) over `bankPorts()`.
  var bankOps = itemsOwner.bank(bankPorts());
  var findBankItem = bankOps.findBankItem,
    bankRetrieveConfirmed = bankOps.bankRetrieveConfirmed,
    bankStoreFully = bankOps.bankStoreFully,
    sortCurrentBankFloor = bankOps.sortCurrentBankFloor, goBank = bankOps.goBank,
    withdrawMerchantCash = bankOps.withdrawMerchantCash, merchantVisitBank = bankOps.merchantVisitBank,
    runBankboiService = bankOps.runBankboiService;
  // The character's market (runtime/items/character/market.ts, E00-10r23 to r36, r40 to r44, S98,
  // S-10e, the loot pass) over `marketPorts()`.
  var market = itemsOwner.market(marketPorts());
  var buyConfirmed = market.buyConfirmed, purchasePreservesLogisticsReserve = market.purchasePreservesLogisticsReserve;
  // The character's production (runtime/items/character/production.ts), over the bag and bank above.
  var production = itemsOwner.production(productionPorts());
  var recoverProductionJournal = production.recover, verifyMerchantItemMarks = production.verifyMerchantItemMarks,
    verifyProductionProtection = production.verifyProductionProtection, merchantMassBuff = production.massBuff,
    recoverLuckyUpgrade = production.recoverLucky,
    luckySlotTracking = production.tracking,
    upgradeMarked = production.upgradeMarked,
    merchantUpgradePreview = production.merchantUpgradePreview, restoreUpgradePreviewSupplies = production.restoreUpgradePreviewSupplies,
    upgradeOfferingCheckpoint = production.upgradeOfferingCheckpoint,
    availableOfferingEntries = production.availableOfferingEntries,
    merchantImprove = production.merchantImprove, prepareManualImprovementScrolls = production.prepareManualImprovementScrolls,
    refreshCompoundProtection = production.refreshCompoundProtection, compoundAvailableStock = production.compoundAvailableStock,
    statusQuantity = production.statusQuantity,
    preloadStatScrolls = production.preloadStatScrolls,
    deliverStatScrolls = production.deliverStatScrolls, applyOwnedStatScrolls = production.applyOwnedStatScrolls,
    merchantSelfImprove = production.merchantSelfImprove, merchantCommerce = production.merchantCommerce;
  var merchantJobs = root.partyMerchant.jobs, merchantVisits = merchantJobs.visits(visitPorts()), merchantRunner = merchantJobs.runner(runnerPorts());
  var merchantRealm = root.partyMerchant.realm, merchantHop = merchantRealm.hop(hopPorts());
  // The hands owner (runtime/merchant-hands/character/owner.ts, E00-09r3 to r5): the merchant's own
  // two hands for gathering, the normal record and `settle`, over `handsPorts()`.
  var merchantHandsOwner = root.partyMerchant.hands, merchantHands = merchantHandsOwner.create(handsPorts());
  // The job owner's Merchant's Luck (runtime/merchant-jobs/character/luck.ts, E00-08r16), over `luckPorts()`.
  var merchantLuckCaster = merchantJobs.luck(luckPorts());
  // The call budget (runtime/characters/call-budget.ts) wraps the game socket's emit before
  // movement's install and before any console game call, so its ledger counts every call this
  // runtime and the game client send. Its two background reads (call-budget-reads.ts) hand the
  // Tracktrix reply to the catalog rebuild below and the realm's player names to the status
  // report; its `limitdc` snapshot posts through this runtime's coordinator connection. Its
  // `cpuClock` is the real clock the owners' cost per call reads, movement's too.
  var callBudget = root.installCallBudget(root, { now: Date.now, scope: scopes.observe09, held: run.held,
    request: function (path, options) { return request(path, options); },
    tracker: function (data) { statusReport.observeTracker(data); },
    players: function (names) { statusReport.receivePlayers(names); } });
  // The survival owner on the character (runtime/characters/survival/install.ts, party-console-plan
  // 05-survival-design W1.1): the escape's record and step, the Cave revival, the farm fact, the
  // passive pulse's tick and the death recovery's walk identity, built at load because the report
  // reply and the first ticks read them. Each port hands one read or write of another owner's state,
  // movement's service or the game client (root wiring), or is the stand-in line its ledger row
  // names, with today's expression.
  // 03's "Heal first below" as the reply delivers it (runtime/characters/turns/delivered.ts).
  var healFirstBelow = root.installHealFirstBelow({ name: function () { return character.name; } });
  var survivalCharacter = root.installSurvivalCharacter(root, root.__partyHooks, {
    current: run.current,
    hand: function () { return handControl(); },
    movement: function () { return movement; },
    blinkAs: function (request, x, y) { return blinkAs(request, x, y); },
    timed: function (request) { return timed(request); },
    holdIdle: function (request) { return holdIdle(request); },
    deathAt: function () { var death = telemetry.lastDeath(); return death && death.at; },
    nextReport: function () { return nextReport(); },
    reportGap: function () { return reportGap(); },
    sleep: scopes.act05.sleep, act: scopes.act05,
    smartMove: function (destination, callback, options) { return smart_move(destination, callback, options); },
    realm: function () { return reunionRealm(); },
    socket: function () { return parent.socket; },
    reports: function () { return targeting.positions(); },
    // 07's party for survival (`cave.state`): the Cave floor's members inside a Cave, else the reports.
    members: function () { return hunting.cave.members(); },
    roster: function () { return currentPartyList(); },
    recoveryHolds: function () { return combatRecoveryHolds(); },
    taskPhase: function () { return taskPhase(); },
    healFirstBelow: healFirstBelow.read,
    isLeader: function () { return targeting.isLeader(); },
    kiting: function () { return isCurrentlyKiting(); },
    // 07's farm scope, area and radius (`farming.focus`).
    scope: function () { return targetScope(); },
    clockOffset: function () { return walkState.clockOffset; },
    inFarmArea: function (entity, scope) { return hunting.focus.contains(entity, scope); },
    inFarmRadius: function (entity) { return hunting.focus.inRadius(entity); },
    // The party's combat mode.
    combatMode: function () { return hunting.focus.mode; },
    ownActor: function (id) { return telemetry.ownActor(id); },
    // 04's Cave fight rule. Movement's combat geometry for the revival's approach step.
    dungeonTarget: function (entity) { return dungeonTargetAllowed(entity); },
    approachPoint: function (target, range) { return combatApproachPoint(target, range); },
    safePoint: function (point, target) { return safeCombatPoint(point, target); },
    combatStep: function (target, point, mode) { sendCombatMove(target, point, mode); },
    storage: function () { return root.localStorage; },
    // The death recovery's reads: 01's group task and farm return, and the navigation revision.
    memberTask: function () { return assignment.memberTask(); },
    revision: function () { return navigationRevision(); },
    farmReturn: function () { return deathRecoveryFarmReturn(); },
  });
  // The respawn binding (05-survival-design W2.3, ledger B-12s2): its readers name the module's
  // answer here until they ask `survival.respawn`. Every escape reader asks `survival.escaping`
  // (B-12s1). The passive pulse starts with the generation's survival part below.
  var survivalRespawnWhenAllowed = survivalCharacter.respawnWhenAllowed;
  // The member's group task is the groups and tasks owner's character module
  // (runtime/tasks/character/assignment.ts, stand-in S34), and the requester identities, holds,
  // the Town cast and the task walk climb are movement's (runtime/movement/character/owner.ts,
  // G3): each identity takes its tier from the assignment, which keeps the task the heartbeat names.
  var assignment = root.installTaskAssignment({ character: function () { return character; },
      partyLocation: function () { return walkState.partyLocation; }, smartMove: function (destination, callback, options) { return smart_move(destination, callback, options); },
      hooks: root.__partyHooks });
  var { taskKind, taskPhase, assignedTier, combatRecoveryHolds, eventReturnHolds, reunionAssigned, huntTurnInPriority, apartFromEvent, apartFarming } = assignment;
  // 06's reply state (runtime/events/character/reply.ts): the selection, the event fields, the
  // pending disables, the hint, the Hunt's event trip and the Slenderman sighting, each written by
  // its table A row. The other 06 parts below read it.
  var eventReply = root.installEventReply({ attend: function () { return eventAttend; }, anniversary: function () { return eventAnniversary; },
    strategy: function (next) { characterEvents.receiveStrategy(next); }, turnIn: huntTurnInPriority,
    live: function () { return movement.live(); }, eventWalk: function () { return loneWalkRequest("event"); },
    returnHolds: eventReturnHolds, reunion: function () { return !!currentReunion(); },
    stop: function (kind) { return stop(kind, undefined, loneWalkRequest("event")); },
    name: function () { return character.name; }, request: request, later: function (action) { scopes.act06.setTimeout(action, 0); } });
  // The event clock (runtime/events/character/clock.ts): the game's feed, the server clock by the
  // `test` echo, and the live, staging and schedule reports.
  var eventClock = root.installEventClock({ scope: { observe: scopes.observe06, act: scopes.act06 }, now: Date.now,
    socket: function () { return parent.socket; },
    feed: function () { return typeof server !== "undefined" && server && server.status || parent.server && parent.server.status || parent.S || {}; },
    game: function () { return G; }, names: characterEvents.names, supported: characterEvents.supported, walkBoss: characterEvents.walkBoss,
    selected: function (name) { return eventAttend.selected(name); }, joined: function () { return eventAttend.joined(); },
    reportOffset: function () { return walkState.clockOffset; },
    searching: function (name, state) { return eventAttend.searching(name, state); },
    activity: function (name) { return octoberRuntime().activity(name); }, october: function () { return octoberRuntime().snapshot(); },
    doors: function () { return octoberRuntime().doorStatus(); },
    cipher: eventReply.cipher,
    ingredients: function () { return characterEvents.cipherIngredients; },
    sprite: function (skin) { return statusReport.sprite(skin); }, monsterSprite: function (skin) { return statusReport.monsterSprite(skin); },
    leads: eventReply.leads,
    destination: function (name, state) { return eventAttend.destination(name, state); },
    cipherWalk: function () { return octoberRuntime().witchWalk(); } });
  // K7's first rows (runtime/events/character/attend.ts): the selection, the live combat event,
  // the arena's fight evidence and the event's destination.
  var eventAttend = root.installEventAttendance({ now: Date.now, game: function () { return G; },
    selection: eventReply.selection,
    character: function () { return character; }, hint: eventReply.hint,
    anniversary: function () { return eventAnniversary.plan(); }, roundAborted: function (event) { return eventAnniversary.roundAborted(event); },
    entities: function () { return parent.entities || {}; }, members: function () { return targeting.positions(); },
    realm: function () { return reunionRealm(); }, reportOffset: function () { return walkState.clockOffset; },
    nextReport: function () { return reportOrSilence("event-search"); },
    clock: eventClock, facts: characterEvents,
    october: { activity: function (name) { return octoberRuntime().activity(name); }, destination: function (name) { return octoberRuntime().destination(name); } },
    travel: { admission: eventReply.admission, current: run.current,
      caveOwns: function () { return hunting.cave.owned; },
      // A safe console load fights its captured target to a finish, so event travel waits: walking off
      // would hold the attack and strand the fight the lease is waiting on.
      held: function () { return eventTravelHeld(huntTurnInPriority(), groupWalk.travel) || consoleDrainCombatActive(); } },
    holder: function () { return movement.live(); },
    kiss: function () { return eventAnniversary.kissOperation(); },
    assignment: function () { return assignment.task(); },
    rejoin: eventReply.rejoin, life: function () { var death = telemetry.lastDeath(); return death && death.at || 0; },
    intent: function () { return walkState.intent; }, selectionRevision: eventReply.selectionRevision, updates: function () { return parent.draws; },
    escaping: survivalEscaping, returnHolds: function () { return eventReturnHolds(); },
    returnPending: function () { return eventExit.pending(); },
    bagErrand: function () { return !!bag.errandFor('hunt'); }, departing: function () { return !!walkState.departing; },
    join: function (name) { return join(name); }, freeSlots: function () { return bag.facts().freeCells; },
    walk: function (point, event, owns, reentry, search) { return sharedPartyWalk(point, "event", event, null, owns, reentry, search); },
    target: function () { return nearestEventTarget(); }, reachable: characterEvents.reachable,
    approaching: function (target) { return movementParts.approaching(target); },
    partySighting: eventReply.sighting,
    // The merchant's own work holds the move until it settles (runtime/events/character/merchant.ts).
    merchantYield: function () { return eventMerchant.yieldForMove(); },
    visit: { busy: function () { return eventAnniversary.busy(); }, staging: function () { return eventAnniversary.staging(); },
      operation: function () { return eventAnniversary.operation(); },
      yieldTo: function (event, staging) { return eventAnniversary.yieldTo(event, staging); } },
    interaction: { run: function (name, owns) { return octoberRuntime().run(name, owns); }, transfer: function () { return octoberRuntime().transfer(); } },
    recovery: { begin: function () { var recovery = survivalCharacter.recovery.request(); return { held: movement.hold(timed(recovery)) !== "refused", request: recovery }; },
      release: function (recovery) { if (recovery) movement.release(recovery.owner); },
      stop: function (recovery) { return stop("smart", undefined, recovery); },
      walk: function (point, owns) { return smart_move(point, undefined, survivalCharacter.recovery.walk(owns)); },
      mark: function () { return movement.last(); }, progress: function (before) { return survivalCharacter.recovery.progress(before); } },
    request: request, after: function (ms, action) { scopes.act06.setTimeout(action, ms); },
    log: function (message, color) { game_log(message, color); } });
  // The character's own hold, Manual or Pause, the console Pause, and Follows me
  // (runtime/tasks/character/holds.ts). Movement's pause sources read it, so it installs first.
  var holds = root.installCharacterHolds({
    name: function () { return character.name; }, escaping: survivalEscaping,
    followMe: function () { return partyMembership.followMe(); }, partyLocation: function () { return walkState.partyLocation; },
    cancelled: function () { return !!walkState.intent.cancelled; }, combatEvent: function () { return !!eventAttend.active(); },
    apart: function () { return apartFromEvent(); }, eventReturn: function () { return eventExit.returning(); },
    groupedFarming: farm.grouped, groupedCombat: function () { return targeting.queue(); }, walkFollower: function () { return groupedFollower(); },
    leader: function () { return partyMembership.leader(); }, followLeader: function () { return partyMembership.followLeader(); }, abtesting: characterEvents.liveAbtesting,
    partyPositions: function () { return targeting.positions(); }, team: function () { return characterEvents.team(character); } });
  var { handControl, manualHolds, targetScope, shouldFollowLeader } = holds;
  // The game party and the reply's party fields are the groups and tasks owner's
  // (runtime/tasks/character/membership.ts): the game party follows the console's leader and Follow
  // settings from here.
  var currentPartyList = root.currentPartyList;
  // 01's character door on the frame: the role runner's hand hold, the queue client's party and the
  // e2e probes read the holds, the assignment and the party list here.
  root.partyTasks = { holds: holds, assignment: assignment, partyList: currentPartyList };
  var partyMembership = root.installPartyMembership({ name: function () { return character.name; },
    partyList: currentPartyList, socket: function () { return parent.socket || null; }, log: function (message) { game_log(message, "red"); } });
  var acceptConfiguredPartyInvite = partyMembership.acceptInvite, acceptConfiguredPartyRequest = partyMembership.acceptRequest, reconcileGameParty = partyMembership.reconcile;
  var movement = root.installPartyMovement(root, {
    now: Date.now,
    current: run.current,
    pauses: { manual: manualHolds, drainPark: drain.park, caveHolds: function () { return caveClient.holds(); }, held: run.held },
    scope: scopes.act02,
    request: request,
    cpu: root.cpuClock,
    departureChests: function () { return market.eligibleDepartureChests(); },
    metrics: function (event) { telemetry.movementMetric(event); },
    events: function (kind, message, details, key) { telemetry.line(kind, message, details, key); }
  });
  // Compatibility names refer to the managed service, never the native walker.
  var smart = movement.state, smart_move = bankOps.bankSortMove, stop = movement.stop;
  // Movement's walk state (runtime/movement/character/owner.ts `WalkState`): the navigation intent,
  // the runtime id, the coordinator's clock difference and the follow, forced walk, party walk and
  // Town flags, which the heartbeat and the other owners' code below read and write.
  var walkState = movement.walkState;
  // The farm reunion (runtime/tasks/character/assignment.ts `installFarmReunion`, E01-3): whether it
  // runs, toward whom and when it ends. Movement's crossings walk it, so it installs before them and
  // reads the reunion's movement (runtime/movement/character/install.ts `ReunionMovement`) once it exists.
  var movementParts;
  var { reunionBlocked, reunionMembers, reunionCurrent, beginFarmReunion, deathRecoveryFarmReturn, cancelFarmReunion, retireReunion, endReunionFor,
    currentReunion, reunionReport, dropReunion, resumeReunion, reunionPart } = root.installFarmReunion({
    now: Date.now, root: root, parent: parent, movement: movement, walkState: walkState,
    walks: function () { return movementParts.reunion; }, character: function () { return character; }, current: run.current, dungeonOwned: function () { return hunting.cave.owned; },
    lastDeath: function () { return telemetry.lastDeath(); }, deathRecoveryRequest: survivalCharacter.recovery.request, farmTravel: function () { return walkCommands.farmTravel(); },
    setCombatTarget: function (id) { targeting.setTargetId(id); }, eventRecovery: function () { return eventExit.recovery(); },
    partyLocation: function () { return walkState.partyLocation; }, partyPositions: function () { return targeting.positions(); },
    desiredPartyMembers: function () { return partyMembership.members(); }, leader: function () { return partyMembership.leader(); },
    attacking: function (target) { return isAttackingPartyMember(target); }, request: request, farmingTravelTarget: function (command) { return farmingTravelTarget(command); }, farmingEntryPoint: farm.entryPoint,
    bagBusy: function () { return bag.errandFor('hunt'); },
    inFarmArea: farm.inArea, farmRadius: farm.radius, canMoveTo: function (x, y) { return can_move_to(x, y); }, log: function (message, color) { game_log(message, color); } },
    { taskKind: taskKind, reunionAssigned: reunionAssigned, eventReturnHolds: eventReturnHolds });
  // Movement's parts on the character (runtime/movement/character/install.ts): the group walk, the
  // navigation, the requesters, the movers, the reunion's crossings, the errand walk, the combat
  // steps, the approaches, the formation and the group movement. Each port is one read or write of
  // another owner's state or the game client (root wiring, catalog/00-root-wiring.json).
  var { convoyActive, rarePathRequest, loneWalkRequest,
    errandRequest, eventAttendanceRequest, anniversaryRequest, anniversaryReturnRequest, huntNpcRequest,
    xmoveAs, reportGap, reportSucceeded, nextReport, reportOrSilence, timed, holdIdle, claim, holdForWalk,
    climbTaskWalk, endTaskWalk, townCast, transportAs, leaveAs, blinkAs, townLanded,
    eventReturnRequest, holdForTask, prepareReturnExit,
    follow, navigationRevision, returnPhaseRecord, reunionRealm, meet, isCurrentlyKiting,
    desiredCombatRange, combatDistance, combatApproachPoint, resetCombatMovement, sendCombatMove,
    safeCombatPoint, formationMembers, groupedApproachReport,
    groupWalk, sharedPartyWalk, eventTravelHeld,
    acceptConvoyDefenseCommand, groupedFollower, currentTravelAttackers, travelCombatActive, travelRequest, commands: walkCommands, setDeparture, coordinatorNow } = movementParts =
    root.installMovementCharacter(root, movement, root.__partyHooks, {
    // 08's read: the merchant's running job, which its errands name (L8-5).
    merchantJob: function () { var job = merchantRunner.job(); return job && { jobId: job.jobId, commandId: job.commandId }; },
    itemsErrand: function () { return bag.errand(); },
    // 01's reads: the heartbeat's command and follow facts, the roster, the reunion and the task.
    walkCommand: function () { return intake.command(); },
    coordinatorCommand: function () { return { command: intake.command(), seen: intake.seen() }; },
    leader: function () { return partyMembership.leader(); },
    followLeader: function () { return partyMembership.followLeader(); },
    followMe: function () { return partyMembership.followMe(); },
    leaderLocation: function () { return partyMembership.leaderLocation(); },
    partyPositions: function () { return targeting.positions(); },
    desiredPartyMembers: function () { return partyMembership.members(); },
    partyList: currentPartyList,
    shouldFollowLeader: shouldFollowLeader,
    reunion: currentReunion,
    reunionBlocked: reunionBlocked,
    reunionMembers: reunionMembers,
    reunionCurrent: reunionCurrent,
    reunionAssigned: function () { return reunionAssigned(true); },
    assignedTier: assignedTier,
    eventReturnHolds: eventReturnHolds,
    recoveryHolds: combatRecoveryHolds,
    // 04's reads: the group record, the fight, the selection and the passing rules.
    groupedCombat: function () { return targeting.queue(); },
    grouped: farm.grouped,
    fresh: function () { return groupedFresh(); },
    anchorVisible: function () { return groupedAnchorVisible(); },
    defensiveTarget: function () { return groupedDefensiveTarget(); },
    attacking: function (target) { return isAttackingPartyMember(target); },
    unfinishedFight: function () { return unfinishedFight(); },
    fightDeaths: function () { return targeting.selection().deaths; },
    engaged: function (target) { return departureTargetEngaged(target); },
    engagedMonster: function () { return engagedMonster(); },
    entityReport: function (entity) { return groupedEntityReport(entity); },
    passingKey: function (target, realm) { return passingKey(target, realm); },
    leaderSelection: function () { return targeting.selection().leaderSelection; },
    lastAttackAt: function () { return targeting.selection().lastAttack.at; },
    setCombatTarget: function (id) { targeting.setTargetId(id); },
    publishSelection: function (target, clear) { return publishCombatSelection(target, clear); },
    departureCombatPending: function () { return departureCombatPending(); },
    // 05's escape and respawn: movement asks `survival.escaping`, the escape's Magiport accept and
    // the respawn's waiting form (B-12s2).
    escaping: survivalEscaping,
    acceptEscapePort: function (name) { return survivalCharacter.escape.acceptPort(name); },
    dropReunion: dropReunion,
    respawn: survivalRespawnWhenAllowed,
    // 06's events.
    activeEvent: function () { return eventAttend.active(); },
    eventTarget: function () { return nearestEventTarget(); },
    eventReachable: characterEvents.reachable,
    eventReturnPending: function () { return eventExit.pending(); },
    eventReturnComplete: function () { eventExit.complete(); },
    joinedEvent: function () { return eventAttend.joined(); },
    joinedEventName: function () { return eventAttend.eventName(); },
    joinEvent: function (destination) { return eventAttend.joinDestination(destination); },
    sameTeam: characterEvents.sameTeam,
    anniversary: function () { return { staging: eventAnniversary.staging(), busy: eventAnniversary.busy() }; },
    clearEventReturn: function () { eventAnniversary.clearReturn(); },
    franky: characterEvents.frankyActive,
    frankyTick: characterEvents.frankyTick,
    fightsAdds: characterEvents.fightsAdds,
    eventBoss: characterEvents.bossMovement,
    returning: function () { return returnCombatActive(); },
    withTimeout: scopes.act02.withTimeout,
    // 07's farming, Hunt, rare and Cave reads.
    dungeonOwned: function () { return hunting.cave.owned; },
    farmSpot: farm.spot,
    farmTarget: function (command) { return farmingTravelTarget(command); },
    entryPoint: farm.entryPoint,
    inFarmArea: farm.inArea,
    inFarmAreaAt: farm.inAreaAt,
    scatter: farm.scatter,
    focus: function () { return farm.focus().slice(); },
    huntOutbound: huntClient.outbound,
    huntReturnPlan: huntClient.returnPlan,
    huntExtraAggro: huntClient.extraAggro,
    eventTargetTypes: function () { return eventAttend.targetTypes(); },
    huntControl: huntClient.control,
    huntDefense: huntClient.defense,
    huntLog: huntClient.log,
    setHuntTarget: farm.setHuntTarget,
    rareActive: function () { return rares.active(); },
    passiveRare: function (target) { return rares.candidate(target); },
    rareControl: function () { return rares.control(); },
    moverRareControl: function () { return rares.walkControl(); },
    pollRareHunting: function () { return rares.poll(); },
    pollFarmingCombatHandoff: function () { farm.handoff(); },
    caveRecoveryMove: function () { return survivalCharacter.cave.move(); },
    // The role runner's routine.
    routine: function () { return root.sharedRoutine; },
    // 08's and 10's job state: the merchant's reserved work, the command id, the departure gate, the errands.
    reserved: function () { return eventMerchant.anniversaryReserved(); },
    command: function () { return intake.last(); },
    chests: function () { return market.eligibleDepartureChests(); },
    bankQueued: function () { return bag.fact('bankQueued'); },
    bagErrand: function () { return bag.errandFor('formation'); }, departurePending: function () { return !!walkState.departing; },
    // 10's bank sort, which every move goes through (S-10 (02)).
    smartMove: function (destination, callback, options) { return smart_move(destination, callback, options); },
    // 12's stat speed and the dashboard's event queue.
    baseSpeed: function () { return statusReport.baseSpeed(); },
    logEvent: function (kind, message, details, key) { telemetry.line(kind, message, details, key); },
    // 13's runtime: the generation, whether this runner still runs, and the coordinator request.
    generation: function () { return run.generation; },
    current: run.current,
    request: request,
    // The commands' reads: 08's fight wait, 06's event leave, return phase, convoy and anniversary
    // walk, 01's reunion end, and 13's intake rollback.
    afterCombat: function (action, label) { return merchantRunner.afterCombat(action, label); },
    leaveEventForWalk: function (command, request) { return eventAttend.leaveForManualWalk(command, request); },
    saveTownPhase: function (command, phase) { return eventExit.saveReturnPhase(command, "town", phase); },
    eventConvoyReturn: function (command) { eventExit.convoyReturn(command); },
    anniversaryCommand: function (command) { eventAnniversary.commandReturns(command); },
    cancelReunion: function (reason) { return cancelFarmReunion(reason); }, retireReunion: function (token) { retireReunion(token); },
    rollback: function (id) { intake.rollback(id); },
    gameLog: function (message, color) { game_log(message, color); },
    // The game client.
    now: Date.now,
    character: function () { return character; },
    G: function () { return G; },
    root: function () { return root; },
    parent: function () { return parent; },
    sleep: scopes.act02.sleep,
    scope: scopes.act02,
    mapEvent: function (map) { return G.maps[map] && G.maps[map].event; },
  });
  // K7's `event-return` row (runtime/events/character/exit.ts): the event exit as one climb over
  // K1's exit rungs, the Town in Main and the arrival report.
  var eventExit = root.installEventExit({ now: Date.now, game: function () { return G; },
    character: function () { return character; }, current: run.current,
    escaping: survivalEscaping,
    revision: function () { return Number(walkState.intent.revision) || 0; },
    feedLive: function (event) { var feed = eventClock.status() || {}; return !eventClock.feedCurrent() || !!(feed[event] && feed[event].live); },
    runtimeId: function () { return walkState.runtimeId; },
    townCastReady: function () { return !is_on_cooldown("use_town"); },
    nextReport: function () { return reportOrSilence("event-exit"); },
    progress: function (command, kind) { return returnPhaseRecord(command, kind); },
    keepProgress: function (record) { movementParts.keepReturnProgress(record); },
    request: request,
    movement: { climb: function (owner, round, activity) { return movement.climb(owner, round, activity); },
      endClimb: function (owner) { movement.endClimb(owner); }, release: function (owner) { movement.release(owner); },
      claim: claim, holdIdle: holdIdle, returnRequest: eventReturnRequest, attendRequest: eventAttendanceRequest,
      leave: leaveAs, transport: transportAs, town: function (request) { return townCast(request); },
      approach: function (point, request) { return smart_move(point, undefined, { request: request, town: false }); },
      prepare: function (command, current) { return prepareReturnExit(command, "event", current); },
      walk: function (point, command, current) { return sharedPartyWalk(point, "event-return", command.cycleId, command, current); },
      landed: function (point) { return townLanded(point); } },
    walkBoss: function (event) { return characterEvents.walkBoss(event); },
    departing: setDeparture, clearTarget: function () { targeting.setTargetId(null); }, eventTargets: eventAttend.targets,
    fightEnds: function (action) { return merchantRunner.afterCombat(action, "returning from the event"); },
    log: function (message, color) { game_log(message, color); } });
  root.__partyEventExit = eventExit;
  // K7's `anniversary` row (runtime/events/character/anniversary.ts): the staging in Main, the kiss,
  // the slices and the merchant's advert, with the round state the heartbeat reports.
  var eventAnniversary = root.installEventAnniversary({ now: Date.now,
    character: function () { return character; }, root: function () { return root; },
    current: run.current, generation: function () { return run.generation; },
    round: function () { var status = eventClock.status(); return status && status.anniversary; },
    epoch: function (value) { return eventClock.epoch(value); },
    nextReport: function () { return reportOrSilence("anniversary-collect"); },
    due: function (at) { return eventClock.due("anniversary", at); },
    attend: eventAttend, exitPending: function () { return eventExit.pending(); },
    eventsEnabled: eventReply.enabled,
    paused: function () { return !!(root.__partyConsoleMaintenance || handControl()); },
    escaping: survivalEscaping,
    caveOwns: function () { return hunting.cave.owned; },
    huntTurnIn: function () { return huntTurnInPriority(); },
    merchant: { reserved: function () { return eventMerchant.reserved(); }, holder: function () { return merchantRunner.holder(); },
      gathering: function () { return merchantGathering.active(); }, forceStand: function () { return merchantRunner.forceStand(); },
      errand: function () { return bag.errandFor('merchantEvent'); }, wake: function () { merchantGathering.wakeGatheringAfterStatus(); } },
    walk: { revision: function () { return walkState.intent.revision; }, command: function () { return intake.last(); },
      townActive: function () { return !!walkState.townActive; },
      townTraveling: function () { return !!walkState.townTraveling; }, forceTraveling: function () { return !!walkState.forceTraveling; },
      convoy: function () { return groupWalk.travel; }, convoying: movementParts.convoying,
      convoyActive: function () { return convoyActive(); }, held: function () { return eventTravelHeld(huntTurnInPriority(), groupWalk.travel); },
      yieldConvoy: movementParts.yieldConvoy, endFollow: movementParts.endFollow,
      request: anniversaryRequest, returnRequest: anniversaryReturnRequest,
      stop: function (kind, request) { return stop(kind, undefined, request); },
      smart: function (point, request) { return smart_move(point, undefined, { request: request }); },
      direct: function (point, request) { return xmoveAs(request, point.x, point.y); },
      leave: function (request) { return leaveAs(request); },
      toMain: function (point, key, current) { return sharedPartyWalk(point, "anniversary-staging", key, null, current); },
      landed: function (point) { return townLanded(point); } },
    farmingLabel: farm.label,
    game: { entities: function () { return parent.entities || {}; }, player: function (name) { return get_player(name); },
      joinedInstance: function (map) { var event = G.maps && G.maps[map] && G.maps[map].event; return !!(event && G.events && G.events[event] && G.events[event].join); },
      canMoveTo: function (x, y) { return typeof can_move_to !== "function" || can_move_to(x, y); },
      useSkill: function (name, target) { return use_skill(name, target); }, say: function (message) { return say(message); },
      readyAt: function (name) { var next = parent.next_skill && parent.next_skill[name]; return next ? new Date(next).getTime() : 0; },
      send: function (name, slot, count) { return market.send(name, slot, count); }, closeStand: function () { return market.stand.close(); },
      quantity: inventoryQuantity, slot: findInventoryItemByName,
      realm: function () { return reunionRealm(); } },
    clearTarget: function () { targeting.setTargetId(null); },
    request: request,
    wait: scopes.act06.sleep,
    later: function (action) { scopes.act06.setTimeout(action, 0); },
    log: function (message, color) { game_log(message, color); } });
  // K7's merchant row (runtime/events/character/merchant.ts): the merchant's event and anniversary
  // reservation, its job's yield and the hand-off of its own work before an event move.
  var eventMerchant = root.installEventMerchant({ now: Date.now,
    character: function () { return character; }, attend: eventAttend, exitPending: function () { return eventExit.pending(); },
    eventsEnabled: eventReply.enabled, intentCancelled: function () { return !!walkState.intent.cancelled; },
    coordinatorHolds: eventReply.merchantRecovery,
    anniversary: eventAnniversary, round: function () { var status = eventClock.status(); return status && status.anniversary; },
    epoch: function (value) { return eventClock.epoch(value); },
    releasedRound: function () { return root.__merchantAnniversaryReleasedRound; },
    control: function () { return merchantJobs.anniversaryControl; },
    job: function () { return merchantRunner.job(); }, holder: function () { return merchantRunner.holder(); },
    standReturning: function () { return merchantRunner.standReturning(); }, leaveStand: function () { return merchantRunner.leaveStand(); },
    errand: function () { return bag.errandFor('eventMerchant'); },
    gathering: function () { return merchantGathering.attempt(); },
    stopGathering: function () { return stop("smart", undefined, errandRequest); },
    request: request });
  // The events owner's loops (runtime/events/character/install.ts): the poll, the anniversary tick,
  // the clock's sync and its socket listeners.
  var characterEventLoops = root.installCharacterEvents({ scope: { observe: scopes.observe06 },
    socket: function () { return parent.socket; }, poll: function () { return eventAttend.poll(); },
    name: function () { return character.name; }, reported: function () { eventAttend.reported(); },
    disappeared: function (data) { eventAttend.disappeared(data); },
    anniversary: eventAnniversary, clock: eventClock });
  var previous = root.sharedRoutine;
  if (previous && typeof previous.stop === "function") previous.stop();
  // Keep the native audio preferences; the Steam Characters bar owns toggles.

  var api = (root.__partyServer || parent.__partyServer || "http://127.0.0.1:924") + "/party-api";
  // Whether the held reply has parked the character since the hold began (table D `reply-held`).
  // "HP potion below" and "MP potion below" for this character (party-console-plan
  // 05-survival-design 3.9), which the survival owner reads at its next turns pass.
  // The targeting owner's reflect lists as the last report reply delivered them, all characters'.
  // Older coordinators omit the flag: retain their conservative reservation.
  bag.connect({ freeCells: bagReads.freeInventorySlots, name: function () { return character.name; },
    lucky: function () { return production.luckyPending(); }, map: function () { return character.map; },
    merchant: function () { return character.ctype === "merchant"; } });
  var intake = root.partyLifecycle.createIntake({ frame: root,
    merchant: function () { return character.ctype === "merchant"; },
    held: run.held, lease: drain.lease, hand: function () { return handControl(); },
    pinning: function () { return root.__partyTracktrixMove; },
    band: function (runCommand) { return bag.command(runCommand); },
    previewing: function () { return bag.fact('previewing'); },
    prepare: production.prepareCommand,
    caveOwns: function () { return hunting.cave.runtimeOwns; },
    escape: function () { return root.__partyHooks.survival.escaping(character.name); },
    eventDefers: function (command) { return eventAttend.defers(command); },
    eventAccepted: function (command) { eventExit.supersede(command, root.__partySharedWalking || null); },
    reunion: endReunionFor, walk: walkCommands.farmWalk, takeover: walkCommands.takeOverWalk,
    jobs: { admit: function (id) { return merchantRunner.admit(id); },
      accept: function (command) { return merchantRunner.accept(command); },
      report: function (command, outcome, reason) { merchantRunner.report(command, outcome, reason); },
      release: function (id) { merchantRunner.releaseCommand(id); },
      job: function (command, label, runJob) { return merchantRunner.runJob(command, label, runJob); },
      afterCombat: function (runJob, label) { return merchantRunner.afterCombat(runJob, label); } },
    accepts: { "event-return-town": function (command) { return eventExit.accepts(command); } },
    doors: {
      "party-monster-travel:event-walk-release": walkCommands.releaseEventWalk,
      "party-monster-travel:defending": function (command, accept) { if (acceptConvoyDefenseCommand(command)) accept(); },
      "merchant-production-recover": production.recoverCommand,
      "merchant-mluck": function (command) { return merchantLuckCaster.merchantLuck(command); },
      "merchant-service": function (command) { return merchantVisits.merchantService(command); },
      "merchant-self-improve": function (command) { return merchantSelfImprove(command); },
      "merchant-self-bank": function (command) { return bankOps.merchantSelfBank(command); },
      "merchant-bank-unlock": function (command) { return bankOps.merchantBankUnlock(command); },
      "merchant-deconstruct": function (command) { return market.merchantDeconstruct(command); },
      "merchant-npc-sale": function (command) { return market.merchantNpcSale(command); },
      "merchant-donate": function (command) { return market.merchantDonate(command); },
      "merchant-self-restock": function (command) { return market.merchantSelfRestock(command); },
      "merchant-upgrade-preview": function (command) { return merchantUpgradePreview(command); },
      "merchant-commerce": function (command) { return merchantCommerce(command); },
      "merchant-exchange": function (command) { return market.merchantExchange(command); },
      "merchant-stand-search": function (command) { return market.merchantStandSearch(command); },
      "merchant-join-giveaway": function (command) { return merchantVisits.merchantJoinGiveaway(command); },
      // C2: an add-on merchant job's steps, which the runner runs one at a time through the C1 dispatcher.
      "addon-steps": function (command) { return merchantRunner.addonSteps(command); },
      "merchant-stand-buy": function (command) { return market.merchantStandBuy(command); },
      "merchant-ponty-buy": function (command) { return market.merchantPontyBuy(command); },
      "merchant-aldata-auth": function (command) { return market.merchantALDataAuth(command); },
      "merchant-aldata-buy": function (command) { return market.merchantALDataBuy(command); },
      "merchant-aldata-sell": function (command) { return market.merchantALDataSell(command); },
      "merchant-collect-mail": function (command) { return market.collectMail(command); },
      "merchant-send-mail": function (command) { return market.merchantSendMail(command); },
      "merchant-stand-sync": function (command) { return merchantRunner.standSync(command); },
      "merchant-idle": function (command) { return merchantRunner.holdStand(command); },
      "bankboi-service": function (command) { return runBankboiService(command); },
      "merchant-gather": function (command) { merchantGathering.choose(Array.isArray(command.modes) ? command.modes : []); },
      "merchant-handoff": function (command) { return merchantVisits.withMerchantHandoffRecovery(command, function () { return merchantVisits.merchantHandoff(command); }); },
      "merchant-order-handoff": function (command) { return merchantVisits.merchantOrderHandoff(command); },
      "restore-equipment": function (command) { return market.restoreEquipment(command); },
      "apply-stat-scrolls": function (command) { return applyOwnedStatScrolls(command); },
      "monster-hunt-interact": function (command) { return huntClient.interactNpc(command); },
      bank: function (command) { return goBank(command.marked || [], command.withdrawals || [], command.goldTarget, command.returnLocation); },
      upgrade: function (command) { return upgradeMarked(command.items || [], command.compounds || [], command.purchases || [], command.returnLocation); },
      travel: walkCommands.partyTravel, "force-travel": walkCommands.forceTravel, "town-party": walkCommands.townParty,
      "event-return-town": function (command) { return eventExit.run(command); },
      "character-travel": walkCommands.characterTravel,
      "party-monster-travel": walkCommands.monsterTravel,
      "event-resume-travel": function (command) { eventAnniversary.resumed(); beginFarmReunion(command); },
      "return-leader": walkCommands.returnToLeader,
      "use-item": function (command) { return market.useDashboardItem(command); },
      equip: function (command) { return market.equipDashboardItem(command); },
      "equip-deliveries": merchantVisits.equipDeliveries,
      unequip: function (command) { return market.unequipDashboardItem(command); },
      give: market.giveDashboardItem,
      "native-realm-switch": function (command) { return merchantHop.nativeSwitch(command); },
      "realm-set-home": function (command) { return merchantHop.setHome(command); },
    },
    game: parent, log: function (message, color) { game_log(message, color); } });
  var previousPartyInviteHandler = root.on_party_invite;
  var previousPartyRequestHandler = root.on_party_request;

  // 12's telemetry (runtime/status/character/telemetry.ts): the fast telemetry, the map frames, the
  // combat lines, the metrics collector, the game logs, the fight packets and the last death.
  // 12's combat queue rings (runtime/status/character/telemetry.ts `createQueueMarkers`, DSH-056),
  // which the overlay, the map frames, the combat trace and the drain read.
  var markerView = root.partyStatus.queueMarkers({
    character: function () { return character; }, entity: function (id) { return get_entity(id); },
    realm: function () { return reunionRealm(); }, now: coordinatorNow,
    returnCombat: function () { return returnCombatActive(); }, returnDefense: function () { return returnDefenseTarget(); },
    eventTypes: function () { return eventAttend.targetTypes(); }, selected: function () { return targeting.selection().targetId; },
    allowed: function (target, command, diagnostic, skill) { return isAllowedTarget(target, command, diagnostic, skill); }, grouped: function () { return farm.grouped(); }, mode: function () { return farm.mode(); },
    cancelled: function () { return walkState.intent.cancelled; }, activeTarget: function () { return activeCombatTarget(); },
    partyPositions: function () { return targeting.positions(); }, huntControl: function () { return huntClient.control(); },
    queue: function () { return targeting.queue(); }, travel: function () { return groupWalk.travel; },
    holdDefense: function () { return convoyHoldDefenseTarget(); }, entityReport: function (entity) { return groupedEntityReport(entity); },
    draining: function () { return drain.draining(); }, drainAllows: function (target) { return consoleDrainAllows(target); } });
  var telemetry = root.partyStatus.telemetry({
    me: function () { return character; }, G: function () { return G; }, parent: function () { return parent; }, root: function () { return root; },
    now: coordinatorNow, runtime: function () { return walkState.runtimeId; },
    current: run.current, request: request,
    entity: function (id) { return get_entity(id); }, player: function (name) { return get_player(name); },
    party: function () { return currentPartyList(); },
    report: { sprite: function (skin) { return statusReport.sprite(skin); }, mapDollHtml: function (entity, direction) { return statusReport.mapDollHtml(entity, direction); },
      activeConditions: function () { return statusReport.activeConditions(); } },
    items: { fingerprint: fingerprint, itemDefinition: itemDefinition, inventoryOperationEntry: inventoryOperationEntry,
      inventoryTotals: inventoryTotals, safeItemDefinition: safeItemDefinition },
    map: { definition: function () { return caveClient.mapDefinition(); }, definitionNeeded: function (map) { caveClient.definitionNeeded(map); },
      selected: function () { return targeting.selection().targetId; },
      markers: markerView.markers, grouped: function () { return farm.grouped(); },
      eventCombat: function () { return eventAttend.targetTypes().length > 0; } },
    death: { huntTrip: eventReply.trip, joinedEvent: function () { return characterEvents.joinedEventName(); } },
    walk: movementParts.convoyWalk,
    log: function (message, color) { game_log(message, color); },
  });
  // 12's rings and the diagnostics lease client (runtime/status/character/rings.ts, table G): each
  // leased ring is read through its owner's door.
  var rings = root.partyStatus.rings({
    root: function () { return root; }, name: function () { return character.name; }, current: run.current, request: request,
    combat: {
      character: function () { return character; }, mode: farm.mode, queue: function () { return targeting.queue(); }, activeTarget: function () { return activeCombatTarget(); },
      markers: markerView.markers, departure: function () { return hunting.focus.lootPending; },
      cancelled: function () { return walkState.intent.cancelled; }, approach: groupedApproachReport,
      travel: function () { return groupWalk.travel; }, rare: function () { return rares.control(); } },
    fightPackets: telemetry.fightPackets,
    reads: {
      movement: function () { return { records: movement.records(), incidents: movement.incidents() }; },
      turns: function () { return { records: root.__partyHooks.ask("skills.records") }; },
      targeting: function () { return { records: root.__partyHooks.ask("targeting.records") }; },
      survival: function () { return { records: survivalCharacter.records() }; },
      calls: function () { return { records: callBudget ? callBudget.records() : [] }; },
    },
  });
  // The October runtime with its ports (runtime/events/october/ports.ts), built on its first use.
  var octoberRuntime = root.installEventOctober({
    now: eventClock.serverNow, feed: eventClock.feed, realm: reunionRealm,
    character: function () { return character; }, cipherMerchant: function () { return eventReply.cipher().merchant; },
    settings: eventReply.limits, gathering: function () { return eventReply.cipher().gathering; },
    game: function () { return G; }, load: function (key) { return get(key); }, save: function (key, value) { set(key, value); },
    walk: function (point, owns) { return sharedPartyWalk(point, 'event', eventAttend.traveling() || eventAttend.joined(), null, owns); },
    walkAlone: function (point) { return smart_move(point, undefined, { request: loneWalkRequest('event', 'witchcipher') }); },
    knock: function (door) { return knock(door); }, info: function () { return witch_cipher_info(); },
    brew: function (mix) { return brew(mix); }, selected: function (name) { return eventAttend.selected(name); },
    runnerHolds: function () { return !!merchantRunner.holder(); }, bagErrand: function () { return !!bag.errandFor('merchantEvent'); },
    current: run.current, inventoryCommand: function () { return bag.fact('inventoryCommand'); },
    leads: eventReply.leads,
    player: function (name) { return get_player(name); }, distance: function (entity) { return distance(character, entity); },
    send: function (name, slot, count) { return market.send(name, slot, count); }, freeSlots: function () { return bag.facts().freeCells; } });
  resumeReunion();
  // The job owner's gathering (runtime/merchant-jobs/character/gathering.ts, E00-08r8 to r11): an
  // attempt holds the merchant through the runner's one record, over `gatheringPorts()`.
  var merchantGathering = merchantJobs.gathering(gatheringPorts());
  // The targeting owner's module (party-console-plan 04-targeting-design CF9, R1-5): built after the
  // last door it reads (`targetingPorts()`), and each name this file's other owners call bound to the
  // module's own function (V2.3). The owners above reach it through late reads, since targeting reads
  // their doors.
  var targeting = root.partyTargeting.create(targetingPorts());
  var engagedMonster = targeting.engagedMonster,
    publishCombatSelection = targeting.publishCombatSelection, monsterPriority = targeting.monsterPriority,
    isAllowedTarget = targeting.isAllowedTarget,
    dungeonTargetAllowed = targeting.dungeonTargetAllowed, dungeonCombatThreat = targeting.dungeonCombatThreat, frankyTargetAllowed = targeting.frankyTargetAllowed,
    nearestEventTarget = targeting.nearestEventTarget,
    isAttackingPartyMember = targeting.isAttackingPartyMember,
    returnCombatActive = targeting.returnCombatActive,
    returnDefenseTarget = targeting.returnDefenseTarget,
    cancelReturnTownUnderAttack = targeting.cancelReturnTownUnderAttack,
    departureTargetEngaged = targeting.departureTargetEngaged,
    departureCombatPending = targeting.departureCombatPending, defendPartyHit = targeting.defendPartyHit,
    consoleDrainKey = targeting.consoleDrainKey,
    consoleDrainAllows = targeting.consoleDrainAllows,
    consoleDrainCombatActive = targeting.consoleDrainCombatActive, rareTarget = targeting.rareTarget,
    passingKey = targeting.passingKey,
    isPassingEncounter = targeting.isPassingEncounter,
    passiveLevelAllowed = targeting.passiveLevelAllowed,
    farmingTravelTarget = targeting.farmingTravelTarget, passiveStopRequired = targeting.passiveStopRequired,
    convoyHoldDefenseTarget = targeting.convoyHoldDefenseTarget, groupedFresh = targeting.groupedFresh,
    groupedEntityReport = targeting.groupedEntityReport, unfinishedFight = targeting.unfinishedFight,
    groupedDefensiveTarget = targeting.groupedDefensiveTarget, engagedCombatTarget = targeting.engagedCombatTarget,
    activeCombatTarget = targeting.activeCombatTarget, groupedAnchorVisible = targeting.groupedAnchorVisible, reportFightDeath = targeting.reportFightDeath;
  // The targeting owner's published reads, which other owners' code asks from here on
  // (party-console-plan 04-targeting-design CF2, CF3).
  root.partyTargeting.publish(targeting.reads(), root.__partyHooks);

  // 12's report (runtime/status/character/report.ts): the status body, its catalogs and the reads
  // they share, over each owner's door.
  var statusReport = root.partyStatus.report({
    me: function () { return character; }, G: function () { return G; }, parent: function () { return parent; }, root: function () { return root; },
    initialTracker: function () { return typeof tracker !== "undefined" ? tracker : null; },
    game: {
      entity: function (id) { return get_entity(id); }, inRange: function (target) { return is_in_range(target); },
      canAttack: function (target) { return can_attack(target); }, canUse: function (skill) { return can_use(skill); },
      cooling: function (skill) { return is_on_cooldown(skill); },
      renderer: function () { return typeof sprite === "function" ? sprite : parent && typeof parent.sprite === "function" ? parent.sprite : null; },
      itemProperties: bagReads.characterItemProperties,
      log: function (text, color) { game_log(text, color); },
    },
    current: function () { return run.current(); }, sleep: function (ms) { return scopes.observe12.sleep(ms); },
    owners: {
      movement: movement, walks: movementParts, survival: survivalCharacter, targeting: targeting, turns: { report: function () { return root.__partyHooks.skills.report(); } },
      hooks: function () { return root.__partyHooks || {}; },
      events: { clock: eventClock, attend: eventAttend, merchant: eventMerchant, anniversary: eventAnniversary, team: characterEvents, exit: eventExit },
      items: { reads: bagReads, bag: bag, bank: bankOps, market: market, production: production, luckySlots: luckySlotTracking, visits: merchantVisits },
      gathering: { report: function () { return merchantGathering.report(); } },
      hunting: { hunt: huntClient, cave: caveClient, rares: rares, farm: farm, spawnCatalog: function (game, sprite) { return root.partySpawnCatalog(game, sprite); } },
      lifecycle: { run: run, drain: drain, intake: intake },
      tasks: { partyList: currentPartyList, reunion: reunionReport },
      telemetry: telemetry,
    },
    smart: function () { return smart; },
  });

  production.listen(parent.socket);

  // 07's hit learner and the Cave's opened chests, here so the `hit` readers keep their order.
  huntingClient.listen(parent.socket);
  // TGT-019's listeners for another entity's death, a lethal `disappear`, an `entities` tombstone
  // and a `death` packet, are the targeting owner's (runtime/characters/targeting/death.ts,
  // party-console-plan 04-targeting-design 3.10): one `reportFightDeath` per packet, then the role
  // runner's target reset when the runner is loaded.
  // installDeath hands back the listeners, so the `hit` readers above release a kill through them.
  var targetingDeath = root.partyTargeting.installDeath(scopes.observe04, parent.socket, {
    self: function () { return character.name; },
    instance: function () { return character.in; },
    report: targeting.reportFightDeath,
    invalidate: targeting.invalidate,
    entitiesSeen: targeting.entitiesSeen
  });

  // 12's report and its reply's apply (runtime/status/character/apply.ts).
  var statusApply = root.partyStatus.apply({
    // Table A's rows (rules.ts `TABLE_A`), each its owner's function or one statement handing one owner's
    // read to another (RTW-002). An `ends` row answers true to end the apply.
    rows: {
      // The member takes its group's live task from every reply, whoever drives its movement
      // (01 design rule 2.3.2): the console's Main load, a maintenance hold and the Cave runtime
      // end the apply below before the reply's other fields apply. `at` is the reply's arrival,
      // which death recovery compares with the moment it asked.
      task: assignment.receiveTask,
      hand: holds.handReply,

      replied: run.replied,
      held: drain.heldReply,
      // The game party acts once per change of the pair, on each reply and each `party_update`
      // (01 design RF2, runtime/tasks/character/membership.ts).
      "game-party": function () { reconcileGameParty(); },
      // A response accepting the coordinator's old catalog cannot acknowledge a
      // newer local discovery that is still warming, or an in-flight newer table.
      catalog: statusReport.catalogReply,
      lease: drain.leaseReply,
      addons: function (state) { return root.__partyHooks.reply(state); },
      settings: movement.settingsReply,
      "heal-first": healFirstBelow.reply,
      "potion-lines": survivalCharacter.linesReply,
      "reflect-lists": targeting.reflectReply,

      // Table G (12's rings.ts): each ring the view leases follows the report as its own request.
      diagnostics: function (state) { rings.reply(state); },
      maintenance: drain.maintenanceReply,
      "map-telemetry": function (state) {
        telemetry.map(!!state.mapTelemetry);
      },
      // 05's priest recovery assignment, then 07's Cave runtime, which ends the apply while it owns the character.
      "cave-recovery": survivalCharacter.caveReply,
      cave: caveClient.reply,
      "merchant-visibility": function (state) { return merchantVisits.applyMerchantVisibility(state.merchantVisibility); },
      receipts: market.flushNativePurchaseReceipts,
      // 10's lucky recovery after the receipts, before stale layouts (E10-12).
      "lucky-recovery": function () { return production.recoverOnReply(!!merchantRunner.holder()); },
      "stand-sync": market.standSyncReply,

      status: telemetry.statusReply,
      reported: reportSucceeded,
      // The task's hold and GT2's walk move the character, so they run only on a report that
      // reaches this point.
      "task-hold": function () { return holdForTask(assignment.task()); },
      apart: assignment.apartReply,
      "walk-hold": holdForWalk,

      "realm-errors": function (state) { merchantRealm.logRealmErrors(state.merchantRealmErrors, game_log); },
      convoy: movementParts.convoyReply,

      escape: function (state) { return survivalCharacter.escape.apply(state.escape || null); },
      "exit-observe": eventExit.observe,
      navigation: movementParts.navigationReply,

      // 07's farming section: focus, radius, the Hunt's type and the mode; then 04's priorities.
      farming: farm.receive,
      priorities: targeting.prioritiesReply,
      // 04's combat control and the grouped lock, under the mode the farming row just applied.
      combat: targeting.combatReply,
      recovery: survivalCharacter.receiveRecovery,
      // The rare control and the passive rules (and the loot client's controls) arrive with the status.
      rare: function (state) { return rares.receive(state); },
      "bank-queue": bag.queueReply,
      leader: partyMembership.leaderReply,
      "turn-in": eventReply.turnInReply,
      "party-walks": movementParts.partyWalksReply,
      events: eventReply.selectionsReply,
      "leader-follow": function () { return movementParts.endLeaderFollow(partyMembership.followEnded()); },

      "party-targets": targeting.leaderTargetReply,
      "follow-me": partyMembership.followMeReply,
      "follow-step": follow.followMeStep,
      "event-hints": eventReply.hintsReply,
      anniversary: function () { return eventAnniversary.abort(); },
      "delivery-receipts": merchantVisits.recoverMerchantDeliveryReceipts,
      "item-settings": bag.settingsReply,
      "lucky-settings": production.luckyReply,
      "stand-settings": merchantRunner.standReply,
      "stand-listings": merchantHands.listedReply,
      "gathering-settings": merchantGathering.reply,
      positions: targeting.positionsReply,
      "party-settings": targeting.partySettingsReply,
      slenderman: eventReply.sightingReply,
      "catalog-prepare": statusReport.prepareReply,
      failures: telemetry.failuresReply,
      // 10's acting rows and the command (the command's owner runs it through the intake).
      elixir: function (state) { return bankOps.useElixir(state.command || null); },
      command: intake.reply,
      tidy: production.tidyReply,

      "stock-up": bankOps.stockUpOnReply,
    },
    host: function () { return root; }, current: run.current, held: run.held, startReports: run.startReports,
    observeVisit: bankOps.observeVisit, pin: bankOps.keepTracktrixLast, snapshot: statusReport.snapshot, request: request,
    failed: telemetry.statusFailure, observe: farm.observe, reported: merchantGathering.wakeGatheringAfterStatus,
    log: function (message, color) { game_log(message, color); },
    farmingMode: function () { farm.observeType(); },
    // A death whose packet this client missed records once here (survival's death handler).
    deathSeen: function () { survivalCharacter.seen(!!character.rip); },
    // The potion line compares the bag with the bag as of the last report.
    telemetry: function () { telemetry.beforeReport(); },
    gatheringCooldown: function (skill) { merchantGathering.syncGatheringCooldown(skill); },
  });
  // 12's character door on the frame: the queue client writes the handoff timing and runs its channel
  // replies through table A's channel rows, the role runner draws the markers, and the e2e probes read
  // the markers and the combat trace.
  root.partyStatus.character = { handoffTiming: rings.timing, queueMarkers: markerView.markers, combatTraceSnapshot: rings.snapshot,
    applyChannel: function (data, combat) { return statusApply.channel(data, combat); } };

  function request(path, options) {
    var REQUEST_DEFAULT_MS = 10000;
    options = options || {};
    // Movement's transport row (walk-client.ts travelRequest) carries the travel diagnostics.
    var travel = travelRequest(path, options.body);
    return new Promise(function (resolve, reject) {
      $.ajax({
        url: api + path,
        method: options.method || "GET",
        contentType: "application/json",
        dataType: "json",
        data: options.body ? JSON.stringify(options.body) : undefined,
        cache: false,
        // A native Steam runner lives longer than the local coordinator. A
        // half-open localhost request must not leave its one-at-a-time status
        // loop permanently busy after CaracAL or Windows restarts overnight, so
        // a request that names no timeout of its own ends at REQUEST_DEFAULT_MS,
        // the earlier console's 10 s, and its cut reports through boundFired.
        timeout: Number(options.timeout) > 0 ? Number(options.timeout) : REQUEST_DEFAULT_MS,
      }).done(function(value) {
        travel.succeeded(value, !!(options.body && (options.body.combatOnly || options.body.combatWait)));
        if (path === '/status') {
          if (options.body) acknowledgeStatusInventory(options.body, value);
        }
        resolve(value);
      }).fail(function (xhr, status, error) {
        var httpStatus = Number(xhr && xhr.status) || 0;
        var resend = path === '/status' && options.body ? statusInventoryResend(options.body, httpStatus, xhr && xhr.responseJSON) : null;
        if (resend) {
          resolve(request(path, Object.assign({}, options, { body: resend })));
          return;
        }
        var kind = status === "timeout" ? "timeout" : status === "parsererror" ? "invalid-json" :
          status === "abort" ? "aborted" : httpStatus ? "http" : "network";
        travel.failed(kind);
        if (kind === "timeout" && !(Number(options.timeout) > 0))
          root.partyStatus.boundFired({ bound: "REQUEST_DEFAULT_MS", owner: "13", state: { path: String(path).split(/[?#]/)[0], ms: REQUEST_DEFAULT_MS } });
        var serverError = xhr && xhr.responseJSON && (xhr.responseJSON.error || xhr.responseJSON.message);
        var reason = typeof serverError === "string" ? serverError :
          error && error !== "error" ? (error.message || error) : status;
        var context = { method: options.method || "GET", path: String(path).split(/[?#]/)[0],
          status: httpStatus, kind: kind, reason: root.partyStatus.diagnosticText(reason || kind) };
        if (xhr && xhr.responseJSON && typeof xhr.responseJSON.code === "string") context.code = xhr.responseJSON.code;
        var failure = new Error(context.method + " " + context.path + " · " +
          (httpStatus ? "HTTP " + httpStatus + " · " : "") + kind +
          (context.reason && context.reason !== kind && context.reason !== "error" ? ": " + context.reason : ""));
        failure.partyRequest = context;
        reject(failure);
      });
    });
  }

  root.on_party_invite = acceptConfiguredPartyInvite;
  root.on_party_request = acceptConfiguredPartyRequest;

  // The targeting owner's reads of this file (party-console-plan 04-targeting-design V4, CF8, CF9):
  // one line each of another owner's variable or function, today's code unchanged, read when a
  // targeting function runs. The stand-in facts carry their ledger rows; every other line is a
  // closure name the moved code read where it stood.
  // The visit's one-line reads of other owners and the game: the character, the command and walk
  // state, movement's errand walk and stop, the game's entities, 01's farm reunion, 10's inventory
  // reads, its equip and send calls (S73) and its bank, restock, delivery and improvement calls, each
  // today's function unchanged, and the job owner's own luck caster and runner.
  // The bag reads' ports (runtime/items/character/bag.ts `BagPorts`): the game client, the walk
  // toward a handoff's player, and 12's catalog parts, read here until 12's character report.
  function bagPorts() {
    return {
      character: function () { return character; }, G: function () { return G; },
      bankPacks: function () { return typeof bank_packs !== "undefined" ? bank_packs : (parent.bank_packs || {}); },
      itemProperties: function (item) { return item_properties(item); }, getPlayer: function (name) { return get_player(name); },
      calculateItemProperties: typeof calculate_item_properties === "function" ? calculate_item_properties : null,
      sleep: scopes.act10.sleep, now: Date.now,
      meet: function (name, timeout) { return meet(name, timeout); },
      approach: function (x, y) { return xmoveAs(errandRequest, x, y); },
      current: run.current, lastCommand: function () { return intake.last(); },
      walkRevision: function () { return walkState.intent.revision; },
      engaged: function () { return !!engagedMonster(); },
      sprite: function (skin) { return statusReport.sprite(skin); }, monsterSprite: function (skin) { return statusReport.monsterSprite(skin); },
      dropOutcome: function (drop, itemName) { return statusReport.dropOutcome(drop, itemName); },
      homeDropTables: function () { return statusReport.homeDropTables(); }, tracker: function () { return statusReport.tracker(); },
      catalogKnown: function () { return statusReport.catalogKnown(); },
      activeUpgrade: function () { return production.activeUpgrade(); },
    };
  }

  // The bank's ports (runtime/items/character/bank.ts `BankPorts`): the game's bank calls, the
  // coordinator's last reply, the stack service and 13's console Pause boundary.
  // The market's ports (runtime/items/character/market.ts `MarketPorts`): the game's calls, its
  // socket, entities and chests, movement's errand walk, and the reads of 01, 06, 07, 08, 09 and
  // production each as today's expression.
  function marketPorts() {
    var ports = bankPorts();
    return {
      reads: bagReads, bank: bankOps, bag: bag, character: ports.character, G: ports.G, bankPacks: ports.bankPacks, sleep: ports.sleep, now: ports.now,
      getPlayer: function (name) { return get_player(name); },
      on: function (event, listener) { scopes.observe10.on(parent.socket, event, listener); },
      off: function (event, listener) { scopes.observe10.off(parent.socket, event, listener); },
      entities: function () { return parent.entities; }, chests: function () { return parent.chests; },
      request: function (path, options) { return request(path, options); }, log: function (message, color) { game_log(message, color); },
      walk: function (destination) { return smart_move(destination, undefined, { request: errandRequest }); },
      follow: function (x, y) { try { xmoveAs(errandRequest, x, y); } catch (_followError) { /* The next look follows again. */ } },
      stopWalk: function (kind) { return stop(kind, undefined, errandRequest); },
      findNpc: function (name) { return find_npc(name); },
      protectedSlots: function () { return bag.protectedSlots(); }, marketSpot: function () { return merchantRunner.market(); },
      realm: function () { return { region: parent.server_region, identifier: parent.server_identifier }; },
      scope: scopes.act10, abtesting: function () { return characterEvents.abtestingMode(); },
      cave: caveClient.inside,
      production: {
        luckySlot: function () { return production.luckySlot(); }, massBuff: function (skill) { return merchantMassBuff(skill); },
        verifyMarks: function () { return verifyMerchantItemMarks(); },
        verifyProtection: function (slots) { return verifyProductionProtection(slots); },
        checkpoint: function (command) { return upgradeOfferingCheckpoint(command); },
        entries: function (checkpoint) { return availableOfferingEntries(checkpoint); },
      },
      merchant: {
        liveRealm: function () { return merchantHop.liveRealm(); }, jobHop: function (command, realm) { return merchantHop.jobHop(command, realm); },
        realmOf: function (region, identifier) { return merchantRealm.realmOf(region, identifier); },
        job: function () { return merchantRunner.job(); }, leaveStand: function () { return merchantRunner.leaveStand(); },
        holder: function () { return merchantRunner.holder(); }, standReturning: function () { return merchantRunner.standReturning(); },
        continues: function (command) { merchantVisits.assertMerchantContinuation(command); },
        cleanout: function () { return merchantVisits.requestMerchantCleanout(); },
        isEquipment: function (item) { return merchantHandsOwner.isDashboardEquipment(item); },
        hands: function () { return merchantHands.hands(); }, manualHands: function (previous) { merchantHands.manual(previous); },
        porcupineManual: function () { return root.partyPorcupineEquipment ? root.partyPorcupineEquipment.manual() : Promise.resolve(); },
      },
    };
  }
  function productionPorts() {
    var ports = bankPorts();
    return {
      reads: bagReads, bank: bankOps, bag: bag, character: ports.character, G: ports.G, bankPacks: ports.bankPacks,
      sleep: ports.sleep, now: ports.now, atomic: ports.atomic, request: ports.request, current: run.current,
      log: ports.log, partyLocation: ports.partyLocation, clockOffset: ports.clockOffset,
      findNpc: ports.findNpc,
      move: function (destination) { return smart_move(destination, undefined, { request: errandRequest }); },
      job: function () { return merchantRunner.job(); }, yieldJob: function () { return eventMerchant.yieldJob(); },
      commerce: function (commandId, marks) { merchantRunner.commerce(commandId, marks); },
      runnerHolds: function () { return !!merchantRunner.holder(); }, runnerRecord: function () { return !!merchantRunner.record(); },
      eventReserved: function () { return eventMerchant.reserved(); }, standReturning: function () { return merchantRunner.standReturning(); },
      reportCommand: function (command, outcome, reason) { merchantRunner.report(command, outcome, reason); },
      operationStage: function (command, stage) { return merchantRunner.operationStage(command, stage); },
      buyConfirmed: function (name, quantity) { return buyConfirmed(name, quantity); },
      handoff: function (path, options) { return merchantVisits.requestMerchantHandoff(path, options); },
      protectedSlots: function () { return bag.protectedSlots(); },
      rendezvous: function (jobId, target) { return merchantVisits.rendezvous(jobId, target); },
      sendItem: function (target, slot, quantity) { return market.send(target, slot, quantity); },
      leaderLocation: function () { return partyMembership.followedLeaderSpot(); },
      equipDelivered: function (items) { return merchantVisits.equipDeliveredItems(items); },
    };
  }
  function bankPorts() {
    return {
      reads: bagReads, character: function () { return character; }, G: function () { return G; },
      bankPacks: function () { return typeof bank_packs !== "undefined" ? bank_packs : (parent.bank_packs || {}); },
      sleep: scopes.act10.sleep, now: Date.now,
      // E10-13b: a bank transfer runs whole at 13's boundary.
      atomic: drain.atomic,
      staging: function () { return bag.staging(); }, stackHomes: function () { return bag.stackHomes(); },
      request: function (path, options) { return request(path, options); },
      walkToBank: function () { return smart_move("bank", undefined, { request: errandRequest }); },
      current: run.current,
      move: function (destination, callback, options) { return movement.move(destination, callback, options); },
      errand: function () { return errandRequest; },
      runtimeId: function () { return walkState.runtimeId; }, clockOffset: function () { return walkState.clockOffset || 0; },
      status: function (message, level, details) { merchantGathering.gatheringStatus(message, level, details); },
      publish: function () { return statusApply.publish(); },
      bag: bag,
      findNpc: function (name) { return find_npc(name); },
      log: function (message, color) { game_log(message, color); },
      protectedSlots: function () { return bag.protectedSlots(); }, merchantCashTarget: function () { return bag.cashTarget(); },
      restockPolicy: function () { return bag.restockPolicy(); }, partyLocation: function () { return walkState.partyLocation; },
      departing: function () { return walkState.departing; }, escaping: survivalEscaping,
      standReturning: function () { return merchantRunner.standReturning(); },
      operationStage: function (command, stage) { return merchantRunner.operationStage(command, stage); },
      leaveStand: function () { return merchantRunner.leaveStand(); },
      isTracker: function (item) { return merchantJobs.isPersonalTracker(item); },
      othersBusy: function () {
        return eventAnniversary.busy() || merchantGathering.active() || !!merchantRunner.holder();
      },
    };
  }

  function visitPorts() {
    return {
      character: function () { return character; }, player: function (name) { return get_player(name); },
      protectedSlots: function () { return bag.protectedSlots(); }, current: run.current, lastCommand: function () { return intake.last(); }, walkState: function () { return walkState; },
      partyLocation: function () { return walkState.partyLocation; }, realm: function () { return reunionRealm(); },
      engaged: function () { return engagedMonster(); },
      approach: function (x, y) { return xmoveAs(errandRequest, x, y); },
      afterCombat: function (action, label) { return merchantRunner.afterCombat(action, label); },
      beginFarmReunion: function () { beginFarmReunion(); },
      request: function (url, options) { return request(url, options); }, sleep: scopes.act08.sleep,
      untilGame: function (events, done, bound) { return root.partyMerchant.jobs.untilGame(scopes.act08, events, done, bound); },
      nextReport: function (bound) { return root.partyMerchant.jobs.nextOwnReport(scopes.act08, bound); },
      waitForPlayer: function (name, timeout) { return waitForPlayer(name, timeout); },
      sameItem: function (item, wanted) { return sameItem(item, wanted); }, findItem: function (wanted) { return findItem(wanted); },
      fingerprint: function (item) { return fingerprint(item); }, itemQuantity: function (item) { return itemQuantity(item); },
      freeInventorySlots: function () { return freeInventorySlots(); },
      refreshCompoundProtection: function (command) { return refreshCompoundProtection(command); },
      compoundAvailableStock: function (command) { return compoundAvailableStock(command); },
      unequip: itemsOwner.game.unequip,
      sendItem: function (name, slot, quantity) { return market.send(name, slot, quantity); },
      sendGold: itemsOwner.game.sendGold,
      log: function (message, color) { game_log(message, color); },
      stop: function (action) { return stop(action); }, entities: function () { return parent.entities; },
      meet: function (name, timeout, report) { return meet(name, timeout, report); },
      hop: function () { return merchantHop; }, market: function () { return merchantRunner.market(); },
      walk: function (destination) { return smart_move(destination, undefined, { request: errandRequest }); },
      preloadStatScrolls: function (command, activity) { return preloadStatScrolls(command, activity); },
      visitBank: function (command, activity) { return merchantVisitBank(command, activity); },
      findBankItem: function (item, pack, slot) { return findBankItem(item, pack, slot); },
      bankRetrieve: function (pack, slot) { return bankRetrieveConfirmed(pack, slot); },
      withdrawCash: function (gold, command) { return withdrawMerchantCash(gold, command); },
      sortBankFloor: function (activity) { return sortCurrentBankFloor(activity); },
      statusQuantity: function (inventory, name) { return statusQuantity(inventory, name); },
      itemSeller: function (name) { return itemSeller(name); },
      restockElixirEntries: function (command, name, needed) { return market.restockElixirEntries(command, name, needed); },
      inventoryQuantity: function (name) { return inventoryQuantity(name); },
      walkToNpc: function (npc) { return smart_move(find_npc(npc), undefined, { request: errandRequest }); },
      buy: function (name, quantity) { return buyConfirmed(name, quantity); },
      root: function () { return root; }, sameItemState: function (item, wanted) { return sameItemState(item, wanted); },
      isEquipment: function (item) { return merchantHandsOwner.isDashboardEquipment(item); },
      equip: itemsOwner.game.equip,
      findInventoryItemByName: function (name) { return findInventoryItemByName(name); },
      offeringCheckpoint: function (command) { return upgradeOfferingCheckpoint(command); },
      availableOfferingEntries: function (checkpoint) { return availableOfferingEntries(checkpoint); },
      merchantSendItem: function (name, slot, quantity) { return market.send(name, slot, quantity); },
      tidyLuckySlot: function () { return production.tidy(production.luckySlot()); },
      luck: function () { return merchantLuckCaster; },
      collectAfter: function (ms) { merchantRunner.collectAfter(ms); },
      deliverStatScrolls: function (command, activity) { return deliverStatScrolls(command, activity); },
      prepareManualImprovementScrolls: function (command, activity) { return prepareManualImprovementScrolls(command, activity); },
      improve: function (command, activity) { return merchantImprove(command, activity); },
      townCast: function () { return movement.town(timed(errandRequest)); },
      transporting: function () { return is_transporting(character); },
      onCooldown: function (skill) { return is_on_cooldown(skill); }, canUse: function (skill) { return can_use(skill); },
      stopWalk: function (kind) { return stop(kind, undefined, errandRequest); },
      bankStoreFully: function (slot) { return bankStoreFully(slot); },
      bankDeposit: itemsOwner.game.bankDeposit,
    };
  }

  function hopPorts() {
    return {
      parent: function () { return parent; }, character: function () { return character; },
      request: function (url, options) { return request(url, options); }, sleep: scopes.act09.sleep,
      log: function (message, color) { game_log(message, color); },
      holdRealm: function (realm) { merchantRunner.holdRealm(realm); },
      afterCombat: function (action, label) { return merchantRunner.afterCombat(action, label); },
      respawn: function (by) { return survivalRespawnWhenAllowed(by); },
      setHome: function () { return set_home(); },
    };
  }

  // Gathering's one-line reads of other owners and the game: the character and the coordinator's
  // slot, movement's errand walk and stop, the skill's readiness, 10's bag and bank calls and its stand return, the
  // hands' three functions (09's, E00-09r3, r4), and the facts of owners with no character holder yet.
  function gatheringPorts() {
    return {
      root: function () { return root; }, runner: function () { return merchantRunner; },
      character: function () { return character; }, parent: function () { return parent; }, current: run.current,
      protectedSlots: function () { return bag.protectedSlots(); },
      request: function (url, options) { return request(url, options); }, sleep: scopes.act08.sleep,
      log: function (message, color) { game_log(message, color); },
      stop: function (action) { return stop(action, undefined, errandRequest); },
      smartMove: function (destination, options) { return smart_move(destination, undefined, Object.assign({ request: errandRequest }, options)); },
      moving: function () { return is_moving(character); },
      onCooldown: function (mode) { return is_on_cooldown(mode); }, canUse: function (mode) { return can_use(mode); },
      sameItem: function (item, wanted) { return sameItem(item, wanted); }, findItem: function (wanted) { return findItem(wanted); },
      fingerprint: function (item) { return fingerprint(item); }, itemQuantity: function (item) { return itemQuantity(item); },
      inventoryAmount: function (item) { return inventoryAmount(item); }, freeSlots: function () { return freeInventorySlots(); },
      bankStoreFully: function (slot) { return bankStoreFully(slot); }, split: itemsOwner.game.split,
      sortBankFloor: function (activity) { return sortCurrentBankFloor(activity); },
      townReturn: function (owns) { return merchantVisits.merchantTownReturn(null, owns); },
      standReturn: function (listings, current) { return merchantRunner.standReturn({ id: 0, listings: listings }, current); },
      market: function () { return merchantRunner.market(); },
      ensureTool: function (session, current) { return merchantHands.ensureGatheringTool(session, current); },
      equipTool: function (session, current) { return merchantHands.equipGatheringTool(session, current); },
      restoreEquipment: function (current) { return merchantHands.restoreGatheringEquipment(current); },
      maintenance: function () { return root.__partyConsoleMaintenance || handControl(); },
      slotCommand: function () { return intake.command(); }, lastCommand: intake.last,
      reportCommand: function (command, state, reason) { merchantRunner.report(command, state, reason); },
      banking: function () { return bag.fact('banking'); },
      upgrading: function () { return bag.fact('upgrading'); }, departurePending: function () { return walkState.departing; },
      anniversaryReserved: function () { return eventAnniversary.busy() || eventMerchant.anniversaryReserved(); },
      forceStand: function () { return merchantRunner.forceStand(); },
    };
  }

  // The hands owner's one-line reads: the character, the merchant's weapon intent (10's setting), the
  // stand listings, gathering's status line and its replacement-craft opt-in, 10's bag reads and its
  // bank retrieve (S94), and movement's errand walk to the bank.
  function handsPorts() {
    return {
      root: function () { return root; }, character: function () { return character; }, current: run.current,
      sleep: scopes.act09.sleep, request: function (url, options) { return request(url, options); },
      intent: function () { return bag.weaponItem(); },
      holder: function () { return merchantRunner.holder(); }, gathering: function () { return merchantGathering.active(); },
      listings: function () { return merchantGathering.standListings(); },
      sameItem: function (item, wanted) { return sameItem(item, wanted); }, findItem: function (wanted) { return findItem(wanted); },
      fingerprint: function (item) { return fingerprint(item); }, count: function (name) { return inventoryQuantity(name); },
      status: function (message, level, details) { merchantGathering.gatheringStatus(message, level, details); },
      report: function (body) { return request("/merchant/gather-status", { method: "POST", body: Object.assign({ character: character.name }, body) }); },
      baseline: function () { return merchantGathering.gatheringBaseline(); },
      crafts: function (mode) { return merchantGathering.crafts(mode); }, holdForOrder: function (jobId, tool) { merchantGathering.holdForOrder(jobId, tool); },
    };
  }

  // Merchant's Luck's one-line reads: the character, the entities in view, the party's positions, the
  // skill's readiness and its cooldown end, and the job's rendezvous (shared.js until E00-08r4).
  function luckPorts() {
    return {
      character: function () { return character; }, entities: function () { return parent.entities; },
      partyPositions: function () { return targeting.positions(); }, player: function (name) { return get_player(name); },
      onCooldown: function (skill) { return is_on_cooldown(skill); }, canUse: function (skill) { return can_use(skill); },
      nextSkill: function (skill) { return parent.next_skill && parent.next_skill[skill]; },
      request: function (url, options) { return request(url, options); }, sleep: scopes.act08.sleep, act: scopes.act08,
      log: function (message, color) { game_log(message, color); },
      rendezvous: function (jobId, name) { return merchantVisits.rendezvous(jobId, name); },
    };
  }

  // The runner's one-line reads: the runtime root and the character, movement's stop, afterCombat and
  // errand walk, 01's farming walk and the combat reads, 06's event and anniversary facts (S95), the
  // gathering handoff and the hands' settle, the realm hop, and 10's stand body, close, lucky slot and
  // recoveries (S97, S98), each today's function unchanged.
  function runnerPorts() {
    return {
      root: function () { return root; },
      request: function (url, options) { return request(url, options); }, sleep: scopes.act08.sleep,
      log: function (message, color) { game_log(message, color); },
      stopWalk: function () { return stop("smart", undefined, errandRequest); },
      standOpen: function () { return !!character.stand; },
      character: function () { return character; },
      hop: function () { return merchantHop; }, previewInFlight: function () { return bag.fact('previewing'); },
      townReturn: function (activity, owns) { return merchantVisits.merchantTownReturn(activity, owns); },
      walkToMarket: function (spot) { return smart_move(spot, undefined, { request: errandRequest }); },
      stand: function () { return market.stand; },
      luckySlot: function () { return production.luckySlot(); }, fingerprint: function (item) { return fingerprint(item); },
      clockOffset: function () { return walkState.clockOffset; },
      eventReserved: function () { return eventMerchant.reserved(); }, anniversaryReserved: function () { return eventMerchant.anniversaryReserved(); },
      gatheringHandoff: function (command) { return merchantGathering.meetCommand(command); },
      settle: function (command) { return merchantHands.settle(command); },
      farmingTravel: function () { return walkCommands.farmTravel(); }, departing: function (on) { setDeparture(on); },
      travelCombat: function () { return travelCombatActive(); },
      fighting: function (travel) { return targeting.fightingNow(travel); },
      movement: function () { return movement; },
      recoverProductionJournal: function () { return recoverProductionJournal(); },
      previewSuppliesSaved: function () { return production.previewSaved(); },
      restoreUpgradePreviewSupplies: function () { return restoreUpgradePreviewSupplies(); },
      setLuckySlot: function (slot) { production.setLuckySlot(slot); },
      recoverLuckyUpgrade: function () { return recoverLuckyUpgrade(); },
      freeSlots: function () { return freeInventorySlots(); },
      tidyLuckySlot: function (slot) { return production.tidy(slot); },
      mergeBag: function () { return bankOps.mergeBag(); },
    };
  }

  // Targeting's doors (04-targeting-design R1-5): each owner's own object, built above by the time
  // targeting is, which install.ts `TargetingPorts` types from each owner's door file.
  function targetingPorts() {
    return {
      root: root,
      tasks: { holds: holds, assignment: assignment, membership: partyMembership, partyList: currentPartyList },
      movement: movement, walks: movementParts, walkState: walkState,
      survival: survivalCharacter,
      hunting: huntingClient,
      bag: bag,
      lifecycle: { drain: drain, telemetry: telemetry, request: request },
      merchant: { gathering: merchantGathering },
    };
  }
  // The turns owner's reads of shared.js (party-console-plan 03-turns-design Q1.1, CF2): one line of
  // today's expression each, of an owner with no build (ledger S-06c, S-07c, S-08,
  // S-13c) or of a built owner's state that shared.js still holds (01's holds, 02's walk state, 05's
  // recovery and escape). T1 (turns/rules.ts) holds only the order of the rows and each outcome.
  function turnsPorts() {
    return {
      // 01's character holds (runtime/tasks/character/holds.ts), H4 and H5.
      hand: handControl,
      // A Cave owns the character (H11), from 07's `cave.state`.
      dungeonOwned: function () { return hunting.cave.owned; },
      // The facts T1's occupied rows O1 to O18 read (turns/rules.ts `occupiedRows`), each from its
      // owner: 07's Cave and Hunt focus, 13's run, 02's walk, 04's departure fight and 10's bag.
      cavePaused: function () { return hunting.cave.paused; }, current: run.current,
      travelCombat: function () { return travelCombatActive(); }, departing: function () { return walkState.departing; },
      departureCombat: function () { return departureCombatPending(); }, monsterEngaged: function () { return !!engagedMonster(); },
      huntDefense: function () { return hunting.focus.huntDefense; }, huntLoot: function () { return hunting.focus.lootPending; },
      bankQueued: function () { return bag.fact('bankQueued'); },
      previewing: function () { return bag.fact('previewing'); },
      leased: drain.holds,
      returnCombat: targeting.returnCombatTurn,
      // 02's walk state (runtime/movement/character/owner.ts), read whole.
      walk: function () { return groupWalk.travel; }, walkState: function () { return walkState; },
      merchantTidy: bag.merchantTidy,
      escape: survivalEscaping,
      rare: function () { return hunting.focus.rare.ownsWalk; },
      // 01's farm reunion (runtime/tasks/character/assignment.ts).
      reunion: currentReunion, reunionBlocked: reunionBlocked,
      errands: bag.errands,
      gathering: function () { return merchantGathering.active(); },
      // The A/B feed's reads (turns/ab-feed.ts, S-06c): the strategy, the teams and the enemy spawn.
      feed: {
        strategy: characterEvents.strategy, team: characterEvents.team, enemySpawn: characterEvents.enemySpawn,
        step: function (to, mode) { return movement.step(to, mode).sent; },
      },
      // Energize's and Dash's reads (turns/classes/): the party's reports and Cave members, and
      // movement's combat geometry (02's steps.ts, which shared.js installs).
      members: survivalCharacter.members,
      clockOffset: function () { return walkState.clockOffset; },
      roster: currentPartyList, sameTeam: characterEvents.sameTeam,
      franky: characterEvents.frankyActive,
      groupedFarming: farm.grouped, formationMembers: formationMembers,
      combatDistance: combatDistance, desiredCombatRange: desiredCombatRange, safeCombatPoint: safeCombatPoint,
      // The combat context's reads (turns/skills/context.ts): the event, the leader and the mode.
      combatEvent: eventAttend.combatEvent,
      joinedEvent: function () { return eventAttend.joined(); }, leader: function () { return partyMembership.leader(); },
      farmingMode: farm.mode,
      liveAbtesting: characterEvents.liveAbtesting,
      roleFarmingMode: farm.mode,
      healFirstBelow: healFirstBelow.read,
    };
  }

  // The generation's parts (13's run.ts `part`, E00-13r3), in start order: each owner's start and its
  // own end. The run scope disposes every timer and listener after the ends, so no part clears its own.
  run.part({ start: statusApply.start });
  run.part({ start: reconcileGameParty, stop: function () {
    if (root.on_party_invite === acceptConfiguredPartyInvite) root.on_party_invite = previousPartyInviteHandler;
    if (root.on_party_request === acceptConfiguredPartyRequest) root.on_party_request = previousPartyRequestHandler;
  } });
  run.part({ start: characterEventLoops.start, stop: characterEventLoops.stop });
  // Survival's half ends its escape record while this frame can still reach the socket (E13-s1).
  run.part({ start: survivalCharacter.startPulse, stop: survivalCharacter.stop });
  // 01's farm reunion loop, then movement's walk at the stop (commands.ts `stop`).
  run.part(reunionPart);
  run.part({ stop: walkCommands.stop });
  run.part({ start: telemetry.start });
  run.part({ start: merchantLuckCaster.startLuckScan, stop: merchantGathering.halt });
  // 12's catalog, then the market's listeners and its Ponty read (runtime/items/character/market.ts, L-1).
  run.part({ stop: statusReport.stopCatalog });
  run.part({ start: market.start, stop: market.stop });
  run.part({ stop: function () { rares.stop(); } });
  // Last, so the stops above still ask the budget. A next install has already retired this one when it
  // stops its predecessor, so only a stop with no next install acts here (09 3.1).
  run.part({ stop: function () { if (callBudget) callBudget.stop(); } });
  // The walk this character runs and the command it last took, for a test's evidence (E00-01r5), on
  // 01's door: 13's intake has built the command by now.
  root.partyTasks.convoyState = root.installCommandEvidence({ walk: function () { return groupWalk.travel; }, lastCommand: intake.last,
    command: function () { return intake.command(); }, intent: function () { return walkState.intent; } });
  // 13's drain beside its factories on the frame, which the loader's poll of the host's deployment
  // reply hands the lease (13's character/loader.ts).
  root.partyLifecycle.drain = drain;
  // 03's character door on the frame: the turns install's stand-in facts and the delivered "Heal first
  // below", which the e2e probes read and TC1's red plant replaces through its reply.
  root.partyTurns = { facts: turnsPorts, healFirstBelow: healFirstBelow };
  root.sharedRoutine = {
    // The generation's start and stop are 13's (runtime/lifecycle/character/run.ts, E00-13r3): the parts
    // above in order, then every timer and listener of the generation disposed.
    start: run.start,
    stop: run.stop,
    // CODE replacement retires and replays travel ownership. A maintenance movement hold must not
    // prevent the very replacement it is waiting for (13's drain, N3).
    canReload: drain.canReload,
    // The two halves the role runner's install lines complete: 05's character half and 04's module.
    survival: survivalCharacter,
    targeting: targeting,
  };
  root.sharedRoutine.start();
})(globalThis);
