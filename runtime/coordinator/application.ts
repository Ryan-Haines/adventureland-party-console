// The coordinator's composition root (owner 00): one function builds every owner's coordinator
// install and hands each the ports it reads, in creation order. A port here only hands another
// owner's read or write across; a closure that holds a rule or state is that owner's (design lists
// each one still here). The order: the lifecycle owner's run scope and the environment, movement's
// planner and geometry, the groups, events and tasks, the merchant realm, the party's combat group,
// the workers and the console control, the items and merchant jobs, the roster, survival, the web
// routes, then the lifecycle owner's character start. The function declarations the flow hands as
// ports sit after it, one section per owner.
import { createMailInboxRoutes, inventoryMergePlan, createUpgradePreviews, installProductionRoutes, installMarketRoutes,
  loadCoordinatorBankVaults, createCoordinatorStorageService, createBankboiStorage, planPontyPurchase, loadCoordinatorItemData,
  createDeconstructionRoutes, createMerchantObservation, createMerchantExchangeRoutes, createCoordinatorMarketAccountActions,
  createCoordinatorAccountCharacterActions, createCoordinatorBankActions, createStaleOrderRoute, createRuleConflictRoute,
  createCoordinatorInventoryActions, normalizeMarketSales, normalizeMarketBids, storageKey,
  createMerchantBlacklistRoute, sellerKey, createCoordinatorCharacterCommands, createReservedBankboiCargo, createInventoryReservations,
  createMerchantOrderRoute, createCoordinatorMarketFeeds, normalizePontyListings, createCoordinatorPurchases, restockPolicyOf,
  restockInventorySatisfied, clearCoordinatorResolvedUpgrades, installItems, migrateSharedRules, itemAskFacts } from "../items/coordinator/api.ts";
import { createSettingsRoutes, installCoordinatorSettings, readLegacyStorage, initializeCoordinatorState, createFormationRoute,
  createCoordinatorDashboardImport, createThresholdRoute, coordinatorSettings } from "../settings/coordinator/api.ts";
import { createPlannerService, createPartyTravelRoutes, createCoordinatorManualNavigation, createCoordinatorTravelClock,
  installSharedConvoyRoute, installMovementRoutes, installMovementRecordRoutes, createCoordinatorPartyConvoys,
  createCoordinatorNavigationActions } from "../movement/api/coordinator.ts";
import { defaultMerchantRoutinePriorities, defaultMerchantAutomations, merchantRoutinePriority as routinePriorityOf,
  coordinatorMerchantPriority, coordinatorMerchantTransferBlocked } from "../merchant-jobs/api.ts";
import { createCoordinatorActivity, createDashboardStream, createStatusIntake, createReply, createCardLines,
  createCoordinatorPublicOverview, createCoordinatorTelemetry, installStatusNotices, online as reportOnline, createHeartbeatReply,
  openMetricsService, createDiagnostics, installStatusRoutes, createApps, requestCaller, accountGoldSnapshot } from "../status/coordinator/api.ts";
import { recoverMerchantQueue, coordinatorPrioritizedBids, createCoordinatorMerchantQueue, createCoordinatorMerchantServices,
  createCoordinatorMerchantRecovery, createMerchantScheduling, createMerchantPartyRoutes, createCoordinatorMerchantJobActions,
  createCoordinatorMerchantActions, createCoordinatorMerchantAutomation, createCoordinatorMerchantConfiguration,
  stampMerchantJob as stampJob, coordinatorCollectionSlots, coordinatorCollectionNearby, coordinatorCollectionReady,
  takeCoordinatorMerchantJob, coordinatorMerchantCapacitySignature, hasStrongMluck as strongMluck, mluckTravelLead as mluckLead, createMerchantCompletionRoute } from "../merchant-jobs/coordinator/api.ts";
import { createCoordinatorRealmActions } from "../merchant-realm/api.ts";
import { createCoordinatorAnniversaryReturns, createCoordinatorAnniversarySnapshot, createCoordinatorAnniversaryActions,
  anniversaryTradeIdentity, createAnniversarySupplies, coordinatorEventCheckpoint, createCoordinatorEventReturns,
  createCoordinatorEventObservations, createEventRecoveryRoutes, activeCoordinatorNames } from "../events/coordinator/api.ts";
import { markedItem, markMatches, commerceRuleKey, ruleKey } from "../items/api.ts";
import { createFocusRoute, createPartyCheckpointRoute, createMonsterSelectionRoutes, createFarmingCommand, createSavedFarmingModeRoute,
  createHuntRoutes } from "../hunting/coordinator/api.ts";
import { createSurvivalRoutes, installCoordinatorSurvival, type SurvivalParty } from "./survival/api.ts";
import { coordinatorGroupedSnapshot, installCoordinatorTargeting, installEventBoundary } from "./targeting/api.ts";
import { ladderPort, installTasks, type PartyRecord, type ScopePorts, activeOf, coordinatorHuntParticipants, createCombatGroups,
  createFarmingScopes, groupId, groupKey, reconcileFarmingMembership, createScopedRoutes, installTaskRoutes } from "../tasks/coordinator/api.ts";
import { fresh, setReadings } from "../protocol/reports.ts";
import { createEventReturnTravel, eventAskFacts, eventInstanceAllowed, installEvents, migrateEventSelections } from '../events/coordinator/api.ts';
// The events owner's rules, the one instance events/coordinator/install.ts adopts add-on event
// kinds into.
import { eventEnabled, eventPolicy, selectedEvents } from '../events/api.ts';
import type { CaveMemberState, CaveVisitState, FarmingFocus, HuntView } from '../hunting/api.ts';
import { acceptArrival, cancelCoordinatorHuntConvoy, clearCoordinatorHunt, coordinatorHuntDestination, installHunting,
  createMonsterSelection, caveFloors, installCaveRoutes, migrateEmptyFocusIntents, migrateRareRules, migrateSharedMonsterFocus,
  selectCoordinatorMonsterDestination, searchReach, validPassivePatch, createFarmingIntents, farmingRecordOf, writeSpot, dungeonEnter, huntAskFacts } from '../hunting/coordinator/api.ts';
import type { HttpResponse } from "../lifecycle/api.ts";
import { createConsoleControl } from '../lifecycle/coordinator/control.ts';
import { installCoordinatorDashboard, installLifecycleRoutes, startCoordinatorWebServices } from '../lifecycle/coordinator/routes.ts';
import { createShutdown, failStart, initializeCoordinatorEnvironment, lifecycleRegistration, startCharacters } from '../lifecycle/coordinator/start.ts';
import { createCoordinatorRun } from '../lifecycle/character/run.ts';
import { coordinatorClock, createWorkers } from '../lifecycle/coordinator/workers.ts';
import { coordinatorOwnership, createCoordinatorOwnershipPorts, createRosterCommit } from '../lifecycle/roster/ownership.ts';
import { createRosterProjection } from '../lifecycle/roster/roster-projection.ts';
import { realmLabel } from '../protocol/realm.ts';
import { reservedForSteam } from '../lifecycle/roster/handoff.ts';
import { classScript, createCode } from '../lifecycle/coordinator/code.ts';
import { merchantVisibility } from '../merchant-jobs/coordinator/api.ts';
import { loadCoordinatorDependencies } from "../lifecycle/coordinator/start.ts";
import { createAddonRoutes } from "../hooks/http.ts";
import { adoptSavedSwitches } from "../hooks/core.ts";
import type { SettingsChange, SettingsWriteResult } from "../settings/api.ts";
import { convoyFighting, canStand, createCommandOwnership, createMovementRecords, createRareRouteDistance, createRouteTime, gameItems, gameMonsters,
  installCoordinatorMovement, movementFingerprint, prepareMovement as prepareMovementGeometry, stepWalks } from "../movement/api/coordinator.ts";
import { migrateHeadlessRealms, realmOperationOwnsCharacter, realmOperationDestination, normalizedRealm } from "../merchant-realm/api.ts";
import type { WebMiddleware, WebRouter, WebMonitor } from "../lifecycle/coordinator/web-platform.ts";
import type { CoordinatorApplicationPlatform } from "../lifecycle/coordinator/application-platform.ts";
import { GROUPS, priority } from '../tasks/api.ts';
import { merchantJobSource } from '../merchant-jobs/coordinator/api.ts';
import { merchantRealmSource, nextRealmReport, createMerchantRealmOwner, accountHomeRealm, characterHomeRealm, createMerchantHomeCommand } from '../merchant-realm/api.ts';
import { migrateMerchantSettings, installStandLocationRoute } from '../merchant-jobs/coordinator/api.ts';
import { partyHooks } from '../hooks/index.ts';
import { coordinatorReads } from '../hooks/coordinator-reads.ts';
import type { WalkTakeover } from '../hooks/registry.ts';
export function startCoordinatorApplication(
  platform: CoordinatorApplicationPlatform,
): Promise<void> {
  const require = platform.require,
    __dirname = platform.directory;
  const {
    evaluateGroup,
    installRosterRoutes,
    publicHandoff,
    child_process,
    account_info,
    game_files,
    bwi,
    monitoring_util,
    express,
    fs_regular,
    crypto,
    vm,
    farmZones,
    convoyNavigation,
    validFarmingLocation,
    LOCALSTORAGE_PATH,
    LOCALSTORAGE_ROTA_PATH,
    STAT_BEAT_INTERVAL,
    log,
    console,
    ctype_to_clid,
    FileStoredKeyValues,
  } = loadCoordinatorDependencies(require);

  //TODO check for invalid session
  //MAYBE improve linux service

  return (async () => {
    // The lifecycle owner's coordinator run (runtime/lifecycle/character/run.ts
    // `createCoordinatorRun`) holds every coordinator timer under its owner's handle, and the
    // shutdown's `stopRun` releases them all before storage closes.
    const coordinatorRun = createCoordinatorRun({ setTimeout, clearTimeout, setInterval, clearInterval });
    const scopes = { act02: coordinatorRun.scope('02', 'act'), act08: coordinatorRun.scope('08', 'act'), act09: coordinatorRun.scope('09', 'act'),
      act10: coordinatorRun.scope('10', 'act'), act11: coordinatorRun.scope('11', 'act'), act13: coordinatorRun.scope('13', 'act'), observe12: coordinatorRun.scope('12', 'observe') };
    // The lifecycle owner's workers, CODE reload and ownership waits.
    const lifecycleClock = coordinatorClock(scopes.act13);
    const {
      localStorage,
      sessionStorage,
      version: initialVersion,
      configuration: cfg,
      session: sess,
      account: my_acc,
      workers: character_manage,
      configuredRealm,
    } = await initializeCoordinatorEnvironment({
      createStorage: () => new FileStoredKeyValues(LOCALSTORAGE_PATH, LOCALSTORAGE_ROTA_PATH, scopes.act11),
      migration: {
        read: readLegacyStorage,
        remove: (path) => fs_regular.unlinkSync(path),
        info: (details, message) => log.info(details, message),
      },
      ensureLatest: () => game_files.ensure_latest(),
      configuration:
        (): import("../lifecycle/coordinator/platform-contracts.ts").CoordinatorConfiguration =>
          require("../config"),
      cullVersions: (versions) => game_files.cull_versions(versions),
      environmentSession: () => process.env.AL_SESSION,
      account: (session) => account_info(session),
      accountHomeRealm,
    });
    const movementPlanner = createPlannerService(platform.plannerWorkerFile || (platform.codeDirectory || __dirname) + '/../../.build/runtime/movement-planner.cjs', scopes.act02);
    // Saved movement snapshots beside the metrics journal (design § 7).
    const movementRecords = createMovementRecords({
      now: () => Date.now(),
      notify: (hook, payload) => { partyHooks().notify(hook, payload); },
      directory: LOCALSTORAGE_PATH + '.movement-snapshots', files: fs_regular,
    });
    const walkFailed = movementRecords.walkFailed;
    // Table G's one lease for every ring; the view reads movement's saved snapshots beside the live
    // rings.
    const diagnostics = createDiagnostics({ now: () => Date.now(), status: name => party.statuses[name],
      snapshots: name => movementRecords.snapshots(name) });
    const prepareMovement = (gameVersion: number) => prepareMovementGeometry(gameVersion, {
      read: path => fs_regular.readFileSync(path, 'utf8'), planner: movementPlanner, log });
    await prepareMovement(initialVersion);
    const PARTY_CLASSES = ["warrior", "paladin", "rogue", "ranger", "mage", "priest", "merchant"];
    const gameDataPorts: Parameters<typeof loadCoordinatorBankVaults>[1] = {
      read: (path) => fs_regular.readFileSync(path, "utf8"),
      evaluate: (source, context, filename) =>
        vm.runInNewContext(source, context, filename ? { filename } : undefined),
      warn: (details, message) => log.warn(details, message),
    };
    const DEFAULT_MERCHANT_ROUTINE_PRIORITIES =
      defaultMerchantRoutinePriorities();
    const DEFAULT_MERCHANT_AUTOMATIONS = defaultMerchantAutomations();
    const { party, persistedSettings } = initializeCoordinatorState(
      localStorage,
      character_manage,
      configuredRealm,
      {
        merchantDefault: cfg.merchant || null,
        now: () => Date.now(),
        loadBankVaultDefinitions,
        log,
      },
    );
    // The report ages every coordinator reader asks (runtime/protocol/reports.ts), from the saved
    // settings, once the settings are loaded; the core registration keeps them current on each
    // change (hooks/core.ts).
    setReadings(party);
    // The lifecycle owner's roster projection reads only the party state and the account. The
    // metrics service reads it for the first account gold point as it opens, so the projection
    // stands before that service.
    const rosterProjection = createRosterProjection(
      party,
      () => my_acc.response,
      () => Date.now(),
    );
    // The settings owner: the one writer and the persistence. Every route writes a setting
    // through `settings.write`, which it answers; the save names below are the persistence's
    // own functions, which other owners' code calls.
    const settings = installCoordinatorSettings(party, {
      hooks: partyHooks(), storage: localStorage, timers: scopes.act11, now: () => Date.now(), log: message => console.error(message),
      owned: name => !!ownedCharacter(name),
      monsters: gameMonsters, items: gameItems, spawns: () => party.monsterChoices ?? null,
      scope: name => farmingScopes.profile(name),
      app: () => requestCaller()?.by,
    });
    const { persistence, write: writeSettings, persistSettings, persistHistory, persistHistoryNow, persistALData, persistRosterState } = settings;
    // The add-on system reads its saved switches once the settings answer.
    adoptSavedSwitches(partyHooks());
    // The hunts and farming owner: the party's Cave visit and rare service; each combat group's Hunt
    // and farm spot come from its `group` below.
    const hunting = installHunting(party, {
      cave: {
        now: Date.now, persist: persistSettings, merchantVisit: () => party.merchantCurrent?.target,
        // The lifecycle owner's roster answers (roster-projection.ts): online for the Hunt's
        // events-pending hold, offline for the Cave's drop, so a starting or repairing worker
        // keeps its member.
        online,
        offline: name => rosterProjection.offline(name),
        cancel: names => {
          cancelActiveConvoy();
          for (const name of names) delete party.commands[name];
        },
      },
      rare: {
        group: () => groupId('party', party.leader),
        members: () => huntParticipants(),
        intent: (name) => farmingNavigation.intent(name),
        cancelConvoy: cancelActiveConvoy,
        convoy: (location, label, names, purpose) => startPartyMonsterConvoy(location as Parameters<typeof startPartyMonsterConvoy>[0], label, names, purpose),
        persist: persistSettings,
        write: writeSettings,
        reconcileHuntArrival: () => huntTick.reconcileArrival(),
        // The table's answer for a rare against the live task: rank, and the
        // rare's "May interrupt Hunt" switch when its type is known.
        taskRefuses: (mtype) => tasks.rareRefused(mtype),
        monsters: gameMonsters,
        // The party group's farming ladder, which a failed Phoenix patrol leg climbs.
        ladder: () => ladderPort(taskOwner, () => groupId('party', party.leader), ['farming']),
        routeDistance: createRareRouteDistance(request=>movementPlanner.plan(request),
          ()=>({version: party.gameVersion, fingerprint: movementFingerprint(party.gameVersion)})),
      },
      persist: persistSettings,
      groups: () => groups.combat().flatMap(g => g.id ? [g.id] : []),
      solo: name => !!groups.solo(name),
      farmingState: name => farmingRecord(name), activeNames, now: Date.now,
    });
    const { cave: dungeons, rares: rareControl } = hunting;
    const metrics = openMetricsService(LOCALSTORAGE_PATH + '.metrics.jsonl', {
      owned: name => !!ownedCharacter(name), now: Date.now, timers: scopes.observe12,
      accountGold: () => accountGoldSnapshot(party.bankSnapshot, slotPayload(), Object.values(party.bankbois), party.statuses).total,
      warn: error => log.warn({ error }, 'Metrics retention failed'),
      unavailable: error => log.warn({ error }, 'Metrics storage unavailable; party coordination continues'),
    });
    const migration = migrateSharedRules(party, Object.keys(character_manage).filter(name => !party.bankbois[name]), writeSettings);
    if (migration && !migration.ok) log.warn({ error: migration.error }, 'Shared rule migration refused; the next start migrates again');
    const farmingScopes = createFarmingScopes(party, coordinatorSettings().lists);
    // The groups and tasks owner: its module installs with the records its sources read
    // (runtime/tasks/). The combat groups this file's one composition builds
    // (runtime/tasks/coordinator/groups.ts): the party's group, and each solo group composed on
    // first use. The hunting owner's farming record of a character, from the tasks owner's groups
    // and scopes.
    const farmingRecord = farmingRecordOf(party, { isCombat: name => groups.isCombat(name), effective: name => farmingScopes.effective(name) });
    const groups = createCombatGroups({ party, owned: ownedCharacter, owner: farmingScopes.owner, members: farmingScopes.members, activeNames,
      partyGroup: () => partyGroup, compose: soloGroup, leaderScopePorts: () => leaderScopePorts });
    // The events owner's coordinator install.
    const coordinatorEvents = installEvents(party, {
      dungeons, groups, activeNames, persist: persistSettings,
      partyObservations: () => eventObservations, partyReturns: () => eventReturns,
      runs: kind => tasks.runs(null, kind), anniversary: () => anniversaryReturns,
      observeTask: (name) => tasks.observe(name), admits: name => tasks.owner.allows('event-attendance', name),
    });
    const { eventsEnabledFor, merchantAnniversaryControl, anniversaryCombatParticipants, resolveAbtestingStrategy } = coordinatorEvents;
    const tasks = installTasks({
      hooks: partyHooks(), now: () => Date.now(), persist: persistSettings, record: () => party, records: movementRecords,
      groups, members: farmingScopes.members, activeNames,
      eventEnabled: (name, event) => eventEnabled(party, name, event), instanceAllowed: (name, event) => eventInstanceAllowed(party, name, event),
      attends: eventsEnabledFor, monsters: gameMonsters,
      startConvoy: (...args) => partyConvoys.start(...args), navigation: () => farmingNavigation,
      visit: () => dungeons.task(), rare: () => rareControl.task(), reconcileVisit: () => dungeons.reconcile(), releaseVisit: () => dungeons.release(),
      reconcile: previous => reconcileFarmingMembership(party, farmingScopes, previous, (key, member) => partyHooks().walks.end(key, 'membership', member)),
      lockoutMs: () => Number(partyHooks().read({ field: 'escapeResumeLockoutMs' })),
      paused: () => consoleControl.state().paused,
    });
    const startPartyMonsterConvoy = tasks.startWalk;
    const taskOwner = tasks.owner;
    // The merchant group's job ladder: the job owner books a retry's failure on it at the next
    // claim, and a checkpoint or a completion is progress.
    const merchantJobLadder = ladderPort(taskOwner, () => party.merchantCharacter ? `merchant:${party.merchantCharacter}` : null, ['merchant-job']);
    // The merchant realm owner: the wants, the move in flight and the realm-hold ladder.
    const merchantRealm = createMerchantRealmOwner(party, {
      now: () => Date.now(), block: name => characterWorkers.ensure(name), realmLabel, log: merchantLog,
      persist: persistSettings, restart: block => void characterWorkers.stop(block), resolve: realm => my_acc.resolve_realm(realm),
      ladder: ladderPort(taskOwner, () => party.merchantCharacter ? `merchant:${party.merchantCharacter}` : null, ['realm-hold']),
      taskTick: () => void tasks.live(party.merchantCharacter ? `merchant:${party.merchantCharacter}` : null),
    });
    // The realm owner's `realm` source and reads, which the tasks owner asks in its declared
    // place.
    const realmSource = partyHooks().publish(merchantRealmSource(() => merchantRealm, () => party.merchantRealmRequests?.[String(party.merchantCharacter)]?.owner));
    if (!realmSource.ok) throw Error(`The realm owner's core:merchant-realm did not load: ${realmSource.message}`);
    installEventBoundary(partyHooks(), party, () => Date.now());
    const activity = createCoordinatorActivity(party, {
      now: () => Date.now(),
      persistHistory,
    });
    if (migrateMerchantSettings(party, Object.keys(persistedSettings).length === 0, canStand, writeSettings)) persistence.settings();
    migrateRareRules(party, writeSettings, console.error);
    const storageService = createCoordinatorStorageService(
      party,
      persistBankState,
    );
    migrateHeadlessRealms(party, character_manage);
    migrateSharedMonsterFocus(party);
    // The movement owner's coordinator answer, `walks.end`, over each combat group's walk. It installs before the
    // party group is composed, since the group's heartbeat reply asks `movement.reply`.
    installCoordinatorMovement(partyHooks(), groups.walkGroup, { statuses: () => party.statuses,
      time: createRouteTime(request => movementPlanner.plan(request), () => ({ version: party.gameVersion, fingerprint: movementFingerprint(party.gameVersion) })) });
    const commandOwnership = createCommandOwnership(party);
    const partyGroup = composeCombatGroup(party, 'party'), {
      farmingNavigation, partyConvoys, groupedCombatSnapshot, huntParticipants, huntTick,
      farmAreaNavigation, heartbeatResponse, eventReturns, eventObservations, eventRecoveryRoutes, huntModeRoute, huntBlacklistRoute, huntSettingsRoute,
      huntControlRoutes, eventAcknowledgementRoutes, convoyEngagementRoutes, convoyAcknowledgementRoutes, walks: partyWalks,
    } = partyGroup;
    migrateEmptyFocusIntents(
      persistedSettings.navigationIntents,
      party,
      farmingNavigation,
    );
    // The roster's one commit: the roster routes and the workers' slot writes each send roster.changed through it.
    const rosterCommit = createRosterCommit(party, { save: persistRosterState, notify: (hook, payload) => { partyHooks().notify(hook, payload); } });
    // The headless workers and their game client (runtime/lifecycle/coordinator/workers.ts).
    const characterWorkers = createWorkers({
      blocks: character_manage,
      notify: (hook, payload) => { partyHooks().notify(hook, payload); },
      state: party,
      clock: lifecycleClock,
      log: console,
      local: localStorage,
      session: sessionStorage,
      sessionToken: sess,
      typeCode: !!cfg.enable_TYPECODE,
      minimap: !!cfg.web_app?.enable_minimap,
      classIds: ctype_to_clid,
      caveFloors: name => caveFloors(party.leader, name),
      stopped: name => consoleControl.stopped(name),
      resolveRealm: (realm) => my_acc.resolve_realm(realm),
      resolveCharacter: (name) => my_acc.resolve_char(name),
      refreshAccount: () => my_acc.updateInfo(),
      account: () => my_acc.response,
      fork: child_process.fork,
      // workers.ts forks every worker with both streams as pipes.
      pipe: (worker) => {
        worker.stdout!.pipe(process.stdout);
        worker.stderr!.pipe(process.stderr);
      },
      monitorUi: monitoring_util.create_monitor_ui,
      // Keep the original TypeError if a queued worker no longer has an account entry.
      configuredRealm,
      homeRealm: name => characterHomeRealm(rosterProjection.homeRealm(), ownedCharacter(name)?.home),
      script: (name) => classScript("./CODE/adventure_land", ownedCharacter(name)!.type),
      watch: (name, block) => characterCode.watch(name, block),
      commit: rosterCommit,
      reserved: name => reservedForSteam({ native: party.nativeOwner, steam: party.steamMembers, slots: party.headlessSlots, handoff: party.steamSwitch }, name!),
      owned: name => !!ownedCharacter(name),
      client: { version: initialVersion, revision: await game_files.get_revision?.(initialVersion) || String(initialVersion) },
      gameFiles: game_files,
      versionData: { movement: prepareMovement, maps: version => prepareVersion(version), gameData: gameDataPorts },
    });
    // CODE reload (runtime/lifecycle/coordinator/code.ts).
    const characterCode = createCode({
      notify: (hook, payload) => { partyHooks().notify(hook, payload); },
      blocks: character_manage,
      clock: lifecycleClock,
      log: console,
      watching: !!cfg.watch_CODE && !process.env.AL_CONSOLE_ARTIFACT,
      hash: () => crypto.createHash("sha256"),
      read: (file) => fs_regular.readFileSync(file),
      watch: (script, changed) => fs_regular.watch(script, changed),
      className: name => ownedCharacter(name)?.type,
      stop: (block, reason) => characterWorkers.stop(block, reason),
    });
    // Table D's merchant row (lifecycle/rules.ts): the Pause and a deploy lease hold the merchant's jobs.
    const merchantHeld = () => !consoleControl.allows('merchant');
    const bankboiService = createBankboiStorage(
      party,
      character_manage,
      {
        now: () => Date.now(),
        stop: (block) => characterWorkers.stop(block),
        persistRoster: persistRosterState,
        persistBank: persistBankState,
        collect: queueMerchant,
        log: merchantLog,
        merchantHeld,
      },
    );
    const merchantQueue = createCoordinatorMerchantQueue(party, {
      now: () => Date.now(),
      collectionReady: markedCollectionReady,
      capacitySignature: merchantCapacitySignature,
      routinePriority: merchantRoutinePriority,
      priority: merchantJobPriority,
      stamp: stampMerchantJob,
      persist: persistSettings,
      dispatch: () => merchantDispatcher.dispatch(),
      log: merchantLog,
    });
    const realmRoutes = createCoordinatorRealmActions(party, {
      now: () => Date.now(),
      nextReport: bound => nextRealmReport(scopes.act09, bound),
      stamp: stampMerchantJob,
      realm: merchantRealm,
      groups: () => groups.combat(),
      endWalk: group => partyHooks().walks.end(groupKey(group), 'realm-switch'),
      roster: { owned: name => rosterProjection.owned(name), homeRealm: () => rosterProjection.homeRealm() },
      account: my_acc,
      native: nativeName,
      block: name => characterWorkers.ensure(name),
      stop: block => characterWorkers.stop(block),
      persist: persistSettings,
      label: realmLabel,
      dispatch: () => merchantDispatcher.dispatch(),
      resolve: (realm) => my_acc.resolve_realm(realm),
      bankBusy: () => bankboiService.busy(),
      participants: realmParticipants,
      current: () => realmControlPayload().currentRealm,
      start: (name) => characterWorkers.start(name),
    });
    // Pause, Play, the clean shutdown and the deploy lease (runtime/lifecycle/coordinator/control.ts).
    const consoleControl = createConsoleControl(process.env.AL_DATA_DIR, {
      now: Date.now,
      roster: party,
      statuses: () => party.statuses,
      task: name => taskOwner.assignment(name),
      flush: () => { persistence.flush(); persistRosterState(); },
      log: (message, level = 'info') => { console.log('Console control: ' + message); activity.merchant('Console: ' + message, level); },
      resumeWaitMs: () => Number(partyHooks().read({ field: 'consoleResumeWaitMs' })),
      notify: (hook, payload) => { partyHooks().notify(hook, payload); },
    });
    const shutdownCoordinator = createShutdown({
      prepared: consoleControl.prepared,
      flushMs: consoleControl.flushMs,
      log: (message) => console.log(message),
      stopCharacters: () => characterWorkers.stopAll(),
      stopRun: coordinatorRun.stop,
      timers: scopes.act13,
      closeStorage: async () => { consoleControl.close(); persistence.flush(); movementPlanner.dispose(); await metrics.close(); localStorage.close(); },
      exit: () => process.exit(),
    });
    const { dispatcher: merchantDispatcher, idle: merchantIdle } =
      createCoordinatorMerchantServices(party, {
        now: () => Date.now(),
        // A member in no group (offline or unowned) has no task to refuse the visit.
        visitAllowed: tasks.visitAllowed,
        travel: realm => merchantRealm.visit(realm),
        ensureHome: reason => merchantRealm.homeWant(reason),
        returningHome: () => merchantRealm.returningHome(),
        realmRefuses: realm => merchantRealm.refuses('job', realm),
        enqueue: merchantQueue.enqueue,
        ladder: merchantJobLadder,
        consoleUpdate: merchantHeld,
        partySwitch: realmOwnsMerchant,
        expire: () => merchantRecovery.expire(String(party.merchantCharacter)),
        anniversary: merchantAnniversaryControl,
        routinePriority: merchantRoutinePriority,
        priority: merchantJobPriority,
        capacityBlocked: merchantTransferCapacityBlocked,
        collectionReady: markedCollectionReady,
        pick: pickJobByPriority,
        stamp: stampMerchantJob,
        // A Ponty candidate always carries its lot's quantity (the items owner's
        // normalizePontyListings).
        planPonty: (listings, quantity, server, automatic) =>
          planPontyPurchase(listings as (typeof listings[number] & { quantity: number })[], quantity, server, automatic),
        restock: policyFor,
        persist: persistSettings,
        log: merchantLog,
        inventoryMerge: inventoryMergePlan,
      });
    // The items owner (the realm stay and the item reads): after a market job on another
    // realm, the merchant stays while a ready job there is at least as urgent as the best one at home.
    const itemsOwner = installItems(party, {
      merchant: () => party.merchantCharacter,
      home: () => normalizedRealm(party.activeRealm),
      here: () => normalizedRealm(party.statuses[String(party.merchantCharacter)]?.server),
      want: (owner, realm) => merchantRealm.want(owner, realm),
      release: owner => merchantRealm.release(owner),
      account: my_acc,
      persist: persistSettings,
      merchantHeld,
      queue: queueMerchant,
      deconstruct: name => deconstructionRoutes.reconcile(name),
      automaticSales: reconcileAutomaticMerchantSales,
      characterId: name => {
        const owned = ownedCharacter(name);
        return owned && typeof owned === 'object' && 'id' in owned &&
          (typeof owned.id === 'string' || typeof owned.id === 'number') ? String(owned.id) : undefined;
      },
      observePonty: observation => pontyService.observe(observation),
      adoptReservedCargo: () => adoptReservedBankboiCargo(),
      persistBank: () => persistBankState(),
      marketReport: () => {
        marketFeeds.ask();
        void marketFeeds.publish();
      },
      pontyWanted: () => marketFeeds.wanted('ponty'),
      storage: bankboiService,
      log: merchantLog,
      scope: scopes.act10,
    });
    // The add-on actions' coordinator side: the hunting owner's Cave entry
    // runs here, and each ask the reply carries brings the facts its owner's character door reads: the
    // items owner's working gold, fates and Ponty prices, the events owner's admission for an event.join and the hunting owner's
    // Hunt cycle for a hunt.take.
    const addonDoors = partyHooks().publishDoors({ dungeonEnter });
    if (!addonDoors.ok) throw Error(`The coordinator's add-on doors did not load: ${addonDoors.message}`);
    const addonFacts = partyHooks().publishFacts({
      '10': ask => ({ ...itemAskFacts(ask.character, ask.addon) }),
      '06': ask => ask.action === 'event.join' ? { ...eventAskFacts(ask.character, String(ask.args.event)) } : undefined,
      '07': ask => ask.action === 'hunt.take' ? { ...huntAskFacts(ask.character) } : undefined,
    });
    if (!addonFacts.ok) throw Error(`The coordinator's add-on facts did not load: ${addonFacts.message}`);
    // Every owner's coordinator and both-sides reads, which an add-on asks through ctx.read.
    const reads = coordinatorReads();
    if (reads.missing.length) throw Error(`The coordinator's add-on reads have no door: ${reads.missing.join(', ')}`);
    const addonReads = partyHooks().publishReads(reads.answers);
    if (!addonReads.ok) throw Error(`The coordinator's add-on reads did not load: ${addonReads.message}`);
    // The job owner's `job` source and reads, which the tasks owner asks in its declared
    // place.
    const jobSource = partyHooks().publish(merchantJobSource(() => party.merchantCurrent, name => party.statuses[name], () => merchantDispatcher.ready()));
    if (!jobSource.ok) throw Error(`The job owner's core:merchant-jobs did not load: ${jobSource.message}`);
    const anniversaryReturns = createCoordinatorAnniversaryReturns(party, {
      cancelConvoy: cancelActiveConvoy,
      now: () => Date.now(),
      participants: anniversaryCombatParticipants,
      activeNames,
      online,
      navigation: farmingNavigation,
      log: anniversaryLog,
      persist: persistSettings,
    });
    const anniversarySnapshot = createCoordinatorAnniversarySnapshot(
      party,
      character_manage,
      {
        now: () => Date.now(),
        counts: anniversaryCounts,
        enabled: eventsEnabledFor,
        owned: ownedCharacter,
        online,
        log: anniversaryLog,
        persist: persistSettings,
      },
    );
    const merchantRecovery = createCoordinatorMerchantRecovery(party, {
      now: () => Date.now(),
      ladder: merchantJobLadder,
      restockSatisfied,
      stamp: stampMerchantJob,
      log: merchantLog,
      persist: persistSettings,
      dispatch: () => merchantDispatcher.dispatch(),
      recoverSale: () => merchantRealm.recoverStalledSale(),
      recovers: () => consoleControl.allows('recovery'),
      offline: name => !rosterProjection.online(name),
    });
    Object.assign(party, loadCoordinatorItemData(initialVersion, gameDataPorts));
    const deconstructionRoutes = createDeconstructionRoutes(party, {
      now: () => Date.now(), next: itemsOwner.nextCommand, persist: persistSettings, write: writeSettings,
      owned: ownedCharacter, queue: queueMerchant, log: merchantLog,
      bankService: maybeStartBankboiService,
      persistBank: persistBankState,
      reserved: itemsOwner.reserved,
    });
    const merchantScheduling = createMerchantScheduling(party, {
      log: merchantLog,
      reconcileReport: itemsOwner.reconcileReport,
      luck: scheduleMerchantLuck,
      recovery: merchantRecovery.observe,
      standMarket: observeStandMarket,
      giveaways: scheduleNearbyGiveaways,
      compounds: scheduleAutoCompound,
      exchanges: scheduleAutoExchange,
      policy: policyFor,
      elixirReady: (name, rule, have) => itemsOwner.elixirReady(name, rule, have, merchantOrderRoute),
      queue: queueMerchant,
      markedItem: markedItem,
      sameItem: markMatches,
      collectionSlots: collectionSlotCount,
      standSync: queueLocalStandSync,
      dispatch: () => merchantDispatcher.dispatch(),
      idle: () => merchantIdle.idle(),
      addonProposes: () => partyHooks().merchantJobs.proposes(),
      expire: () => { if (!merchantHeld() && !realmOwnsMerchant()) merchantRecovery.expire(String(party.merchantCharacter)); },
      clearOwnedCommand: (name, matches) => commandOwnership.clear(name, matches),
      dispatchBank: itemsOwner.dispatchBank,
      activeNames,
      persist: persistSettings,
      now: () => Date.now(),
    });
    const upgradePreviews = createUpgradePreviews(party, {persist:persistSettings, dispatch:() => merchantDispatcher.dispatch(), enqueue:merchantQueue.enqueue});
    const merchantObservation = createMerchantObservation(party,
      { log: merchantLog, persist: persistSettings, publish: scheduleALDataPublish });
    const merchantExchangeRoutes = createMerchantExchangeRoutes(party, {
      now: () => Date.now(),
      nextCommand: itemsOwner.nextCommand,
      enqueue: merchantQueue.enqueue,
      log: merchantLog,
      persist: persistSettings,
      dispatch: () => merchantDispatcher.dispatch(),
      queueStorage: queueExchangeStorage,
      collectOfferings: itemsOwner.collectOfferings,
      queueOffering:(offering,quantity)=>storageService.queueOffering(offering,quantity),
      write: writeSettings,
    });
    const {
      visits: anniversaryVisitRoutes,
      navigation: anniversaryNavigationRoutes,
      commerce: anniversaryCommerceRoutes,
      supplies: anniversarySuppliesRoute,
    } = createCoordinatorAnniversaryActions(party, {
      now: () => Date.now(),
      nextCommand: tasks.nextCommand,
      owned: ownedCharacter,
      enabled: eventsEnabledFor,
      intent: (name) => farmingNavigation.intent(name),
      snapshot: publicAnniversaryState,
      abort: abortAnniversaryRound,
      log: anniversaryLog,
      persist: persistSettings,
      scheduleReturn: scheduleAnniversaryReturnConvoy,
      huntOwns: () => tasks.turnIn(party, 'heartbeat'),
      supersede: (cycle) => farmingNavigation.supersede(cycle),
      cancelConvoy: cancelActiveConvoy,
      fallback: anniversaryFallbackDestination,
      participants: anniversaryCombatParticipants,
      capture: (names) => farmingNavigation.capture(names),
      identity: anniversaryTradeIdentity,
      alreadyTraded: anniversaryIdentityAlreadyTraded,
      publish: scheduleALDataPublish,
      counts: anniversaryCounts,
      persistBank: persistBankState,
      merchantLog,
    });
    const { market: aldataRoutes, postage: mailPostageRoute } =
      createCoordinatorMarketAccountActions(party, {
        now: () => Date.now(),
        write: writeSettings,
        randomBytes: (size) => crypto.randomBytes(size),
        snapshot: publicALDataState,
        fetch: aldataFetch,
        refresh: refreshALData,
        persistMarket: persistALData,
        publish: scheduleALDataPublish,
        enqueue: merchantQueue.enqueue,
        log: merchantLog,
        persist: persistSettings,
        dispatch: () => merchantDispatcher.dispatch(),
      });
    const { creation: characterCreationRoutes, deletion: bankboiDeleteRoute } =
      createCoordinatorAccountCharacterActions(party, {
        now: () => Date.now(),
        classes: PARTY_CLASSES,
        characterCount: () => my_acc.response.characters.length,
        owned: ownedCharacter,
        session: sess,
        loadFetch: () => platform.loadFetch(),
        adopt: itemsOwner.adoptAccount,
        refresh: itemsOwner.refreshAccount,
        assign: (slot, name) => characterWorkers.assign(slot, name, 'storage'),
        persistBank: () => { adoptReservedBankboiCargo(); persistBankState(); },
        serviceBank: maybeStartBankboiService,
        log: merchantLog,
      });
    const {
      storage: bankboiStorageRoutes,
      unlock: bankUnlockRoute,
      restock: restockRoute,
    } = createCoordinatorBankActions(party, {
      now: () => Date.now(),
      write: writeSettings,
      log: merchantLog,
      adopt: adoptReservedBankboiCargo,
      persistBank: persistBankState,
      restore: restoreMerchantAfterBankboi,
      enqueue: merchantQueue.enqueue,
      publicJob: publicMerchantJob,
      persist: persistSettings,
      dispatch: () => merchantDispatcher.dispatch(),
      owned: ownedCharacter,
    });
    // The party routes: the hunting owner's focus and farming checkpoint, the settings owner's formation, the merchant jobs owner's party
    // visits, movement's party travel and Town and survival's Escape and Resume. Travel and Escape ask the
    // hunting owner's Cave exit and release (runtime/hunting/coordinator/cave.ts); the formation reads the
    // worker registry.
    const partyRoutePorts: Parameters<typeof createFocusRoute>[1] & Omit<Parameters<typeof createFormationRoute>[1], 'managed'> &
      Parameters<typeof createPartyCheckpointRoute>[1] & Parameters<typeof createMerchantPartyRoutes>[1] &
      Omit<Parameters<typeof createPartyTravelRoutes>[1], 'nextCommand' | 'exitDungeon' | 'releaseDungeon'> &
      Omit<Parameters<typeof createSurvivalRoutes>[1], 'exitDungeon' | 'releaseDungeon'> = {
      enqueue: merchantQueue.enqueue,
      escapeButton: () => tasks.holds.button(),
      escapeResumeAt: () => tasks.holds.resumeAt(),
      pressEscape: shown => tasks.holds.escape(shown),
      pressResume: shown => tasks.holds.resume(shown),
      handHeld: tasks.holds.held,
      write: writeSettings,
      focusChanged: () => farmAreaNavigation.focusChanged(),
      now: () => Date.now(),
      owned: ownedCharacter,
      members: () => farmingNavigation.members(),
      invalidate: (...args) => farmingNavigation.invalidate(...args),
      persist: persistSettings,
      inherited: (name, formation) => eventPolicy(formation, name).inherited,
      selected: (name, formation) => selectedEvents(formation, name),
      release: () => survival.release(),
      active: activeNames,
      authorize: (...args) => farmingNavigation.authorize(...args),
      dispatch: () => merchantDispatcher.dispatch(),
      escape: (names, by) => survival.start(names, by),
      queue: queueMerchant,
      convoy: startPartyMonsterConvoy,
    };
    const focusRoute = createFocusRoute(party, partyRoutePorts);
    const formationRoute = createFormationRoute(party, { ...partyRoutePorts,
      managed: (name: string) => Object.hasOwn(character_manage, name) });
    const exitDungeon = (res: HttpResponse) => dungeons.exitDungeon(res, tasks.nextCommand());
    const releaseDungeon = (res: HttpResponse) => dungeons.releaseDungeon(res);
    const partyActionRoutes = {
      checkpoint: createPartyCheckpointRoute(party, partyRoutePorts),
      ...createMerchantPartyRoutes(party, partyRoutePorts),
      ...createPartyTravelRoutes(party, { ...partyRoutePorts, nextCommand: tasks.nextCommand, exitDungeon, releaseDungeon }),
      ...createSurvivalRoutes(party, { ...partyRoutePorts, exitDungeon, releaseDungeon }),
    };
    // The add-on switches and settings, written through the settings writer as addressed changes
    // (runtime/settings/coordinator/writer.ts) and sent with every status reply.
    const addonRoutes = createAddonRoutes({ write: writeSettings, fighters: settings.fighters, persist: persistSettings, now: Date.now });
    const settingsRoutes = createSettingsRoutes({ write: writeSettings, read: query => partyHooks().read(query),
      entries: slot => partyHooks().entries(slot).map(e => e.mode), now: () => Date.now() });
    const monsterSelectionRoutes = createMonsterSelectionRoutes(party, {
      now: () => Date.now(),
      dungeon: dungeons,
      destination: (type) => coordinatorHuntDestination(party, type, false),
      release: () => survival.release(),
      clearHunt: clearMonsterHuntState,
      members: () => farmingNavigation.members(),
      authorize: (...args) => farmingNavigation.authorize(...args),
      start: startPartyMonsterConvoy,
      startPhoenix: () => rareControl.start(),
      stopPhoenix: (reason) => rareControl.stop(reason),
      persist: persistSettings,
      validPassive: validPassivePatch,
      setPassive: (settings) => rareControl.setSettings(settings, "dashboard:rare-hunting"),
      write: writeSettings,
      invalidate: (...args) => farmingNavigation.invalidate(...args),
    });
    const staleOrderRoute = createStaleOrderRoute(party, persistSettings);
    const ruleConflictRoute = createRuleConflictRoute(party, persistSettings, writeSettings);
    const {
      automatic: automaticSaleRoutes,
      npc: npcSaleRoute,
      stand: standMarkRoute,
      handoff: merchantHandoffRoutes,
      receipts: inventoryReceiptRoutes,
      idle: merchantIdleRoute,
      bid: merchantBidRoute,
      merge: stackMergeRoute,
    } = createCoordinatorInventoryActions(party, {
      now: () => Date.now(),
      offline: name => !rosterProjection.online(name),
      write: writeSettings,
      key: commerceRuleKey,
      reconcile: reconcileAutomaticMerchantSales,
      persist: persistSettings,
      publish: scheduleALDataPublish,
      syncStand: queueLocalStandSync,
      idle: () => merchantIdle.idle(),
      persistBank: persistBankState,
      bankService: maybeStartBankboiService,
      enqueue: merchantQueue.enqueue,
      queue: queueMerchant,
      log: merchantLog,
      owned: ownedCharacter,
      visitAllowed: tasks.visitAllowed,
      dispatchBank: itemsOwner.dispatchBank,
      sameItem: markMatches,
      removeQueued: removeQueuedBidPurchases,
      observe: observeStandMarket,
      ponty: queuePontyMatches,
      aldata: queueALDataMatches,
      dispatch: () => merchantDispatcher.dispatch(),
      anniversary: merchantAnniversaryControl,
      bankboiBusy: () => bankboiService.busy(),
      plan: inventoryMergePlan,
    });
    const {
      progress: merchantProgressRoutes,
      marketplace: marketplaceProgressRoutes,
      clusters: merchantClusterRoutes,
      realms: merchantRealmRoutes,
      location: marketplaceLocationRoute,
    } = createCoordinatorMerchantJobActions(party, {
      now: () => Date.now(),
      offline: name => !rosterProjection.online(name),
      ladder: merchantJobLadder,
      visitAllowed: tasks.visitAllowed,
      capacityBlocked: merchantTransferCapacityBlocked,
      collectionReady: markedCollectionReady,
      anniversaryReserved: coordinatorEvents.anniversaryReserved,
      priority: merchantJobPriority,
      routinePriority: merchantRoutinePriority,
      persist: persistSettings,
      stamp: stampMerchantJob,
      log: merchantLog,
      dispatch: () => merchantDispatcher.dispatch(),
      active: activeNames,
      fulfill: fulfillStandBid,
      dismiss: (key) => pontyService.dismiss(key),
      blacklist: itemsOwner.blacklist,
      blacklistingEnabled: itemsOwner.blacklistingEnabled,
      resolve: (realm) => my_acc.resolve_realm(realm),
      realm: merchantRealm,
      fetchMarket: aldataFetch,
      normalizePurchases: normalizeMarketSales,
      normalizeSales: normalizeMarketBids,
    });
    // The items owner's install runs the mail jobs and the send route, and the merchant jobs owner's completion route
    // takes the items owner's inbox answers and the ALData auth fetch.
    const { jobs: mailJobs, send: sendMailRoute } = itemsOwner.mail({ now: () => Date.now(), enqueue: merchantQueue.enqueue,
      dispatch: () => merchantDispatcher.dispatch(), bankboi: maybeStartBankboiService, identity: storageKey });
    const merchantCompletionRoute = createMerchantCompletionRoute(party, {
      now: () => Date.now(),
      nextCommand: itemsOwner.nextCommand,
      stamp: stampMerchantJob,
      enqueue: merchantQueue.enqueue,
      persist: persistSettings,
      persistBank: persistBankState,
      dispatch: () => merchantDispatcher.dispatch(),
      log: merchantLog,
      mailSent: itemsOwner.mailSent,
      mailComplete: itemsOwner.mailComplete,
      clearUpgrades: clearResolvedUpgradeMarks,
      clearIncoming: clearIncomingCompoundReservation,
      capacitySignature: merchantCapacitySignature,
      persistALData,
      publishALData: scheduleALDataPublish,
      queue: queueMerchant,
      ensureHome: reason => merchantRealm.homeWant(reason),
      ladder: merchantJobLadder,
      pontyMatches: queuePontyMatches,
      aldataMatches: queueALDataMatches,
    });
    const {
      orders: manualMarketOrderRoutes,
      controls: merchantControlRoutes,
      requests: merchantRequestRoutes,
    } = createCoordinatorMerchantActions(party, {
      now: () => Date.now(),
      write: writeSettings,
      stamp: stampMerchantJob,
      enqueue: merchantQueue.enqueue,
      log: merchantLog,
      persist: persistSettings,
      dispatch: () => merchantDispatcher.dispatch(),
      plan: planPontyPurchase,
      automations: DEFAULT_MERCHANT_AUTOMATIONS,
      resolveRealm: (realm) => my_acc.resolve_realm(realm),
      realmLabel,
      realm: merchantRealm,
    });
    const manualNavigationCommands = createCoordinatorManualNavigation(party, {
      now: () => Date.now(),
      queue: queueMerchant,
      releaseEscape: () => survival.release(),
      navigation: farmingNavigation,
      convoy: startPartyMonsterConvoy,
      caller: requestCaller,
      persist: persistSettings,
      // The call budget's go-home command, built on the realm owner's ports.
      home: createMerchantHomeCommand(party, {
        now: () => Date.now(), nextCommand: tasks.nextCommand, block: name => characterWorkers.ensure(name),
        realmExists: (realm) => !!my_acc.resolve_realm(realm), realmLabel,
        restart: (block) => characterWorkers.stop(block), log: merchantLog, persist: persistSettings,
      }),
    });
    const merchantBlacklistRoute = createMerchantBlacklistRoute(party, {
      now: () => Date.now(),
      key: sellerKey,
      log: merchantLog,
      persist: persistSettings,
      write: writeSettings,
    });
    const characterCommandRoute = createCoordinatorCharacterCommands(
      party,
      character_manage,
      {
        write: writeSettings,
        enqueue: merchantQueue.enqueue,
        navigation: body => tasks.travelCommand(body, command => manualNavigationCommands.handle(command)),
        farming: createFarmingCommand(party, { farmingState: farmingRecord, location: validFarmingLocation, persist: persistSettings,
          members: () => farmingNavigation.members(), invalidate: (names, reason, shared) => farmingNavigation.invalidate(names, reason, shared) }),
        key: ruleKey,
        persist: persistSettings,
        persistBank: persistBankState,
        queue: queueMerchant,
        reconcileUpgrades: itemsOwner.reconcileIntents,
        reconcileMarks: itemsOwner.reconcileMarks,
        scheduleCompound: scheduleAutoCompound,
        scheduleExchange: scheduleAutoExchange,
        log: merchantLog,
        removeReservations: removeInventoryReservations,
        clearIncoming: clearIncomingCompoundReservation,
        marksCleared: () => { scheduleALDataPublish(); queueLocalStandSync(); },
        sameItem: markMatches,
        identity: storageKey,
        bankboi: maybeStartBankboiService,
      },
    );
    const dashboardImportRoutes = createCoordinatorDashboardImport(
      party,
      LOCALSTORAGE_PATH,
      {
        roster: rosterPayload,
        owned: ownedCharacter,
        crypto,
        files: fs_regular,
        header: (request, name) => request.get(name),
        now: () => Date.now(),
        persist: persistSettings,
        write: writeSettings,
        hooks: partyHooks(),
      },
    );
    // The writer checks each character against the roster, so the slot migration runs once the
    // roster projection exists.
    settings.migrateSlots(farmingScopes.savedCopies('farmingPolicy'));
    migrateEventSelections(party, character_manage, writeSettings, console.error);
    const {
      giveaways: giveawayScheduler,
      improvements: improvementScheduler,
      sales: automaticMerchantSales,
      luck: luckScheduler,
    } = createCoordinatorMerchantAutomation(party, {
      now: () => Date.now(),
      realmRefuses: realm => merchantRealm.refuses('job', realm),
      enqueue: merchantQueue.enqueue,
      log: merchantLog,
      persist: persistSettings,
      queue: queueMerchant,
      publish: scheduleALDataPublish,
      syncStand: queueLocalStandSync,
      idle: () => merchantIdle.idle(),
      dispatch: () => merchantDispatcher.dispatch(),
      names: activeNames,
      strong: hasStrongMluck,
      lead: mluckTravelLead,
    });
    const reservedBankboiCargo = createReservedBankboiCargo(party, {
      now: () => Date.now(),
      persist: persistBankState,
    });
    // Restore reserved-row intent even when the merchant reconnects outside the bank.
    reservedBankboiCargo.reconcile();
    const inventoryReservations = createInventoryReservations(party);
    const merchantOrderRoute = createMerchantOrderRoute(party, {
      now: () => Date.now(),
      yieldToIO: () => scopes.act10.sleep(0),
      nextCommand: itemsOwner.nextCommand,
      enqueue: merchantQueue.enqueue,
      activeNames,
      log: merchantLog,
      persist: persistSettings,
      dispatch: () => merchantDispatcher.dispatch(),
      persistBank: persistBankState,
      bankboi: maybeStartBankboiService,
    });
    const dashboardStream = createDashboardStream({
      now: Date.now, statuses: () => party.statuses,
      every: scopes.observe12.setInterval, cancel: scopes.observe12.clearInterval,
      catalog: () => party.merchantCatalog,
    });
    const statusIngestion = createStatusIntake<NonNullable<typeof party.statuses[string]>>(
      party,
      character_manage,
      {
        write: writeSettings,
        now: () => Date.now(),
        owned: ownedCharacter,
        persistRoster: persistRosterState,
        items: itemsOwner,
        merchant: merchantObservation.observe,
        groupedCombat: groupedCombatSnapshot,
        rareReport: (name, report) => rareControl.report(name, report),
        rareTick: hunting.rareTick,
        bankboi: bankboiService.observe,
        anniversary: reconcileAnniversaryReturnFromStatus,
        taskTick: name => tasks.taskTick(name),
        hunting,
        persist: persistSettings,
        abtesting: resolveAbtestingStrategy,
        activeNames,
        events: coordinatorEvents.observe,
        convoyStep: stepAllConvoys,
        merchantScheduling: merchantScheduling.observe,
        reply: createReply({
          lifecycle: {
            observe: name => { consoleControl.observe(); characterWorkers.reported(name, party.statuses[name] ?? {}); characterCode.reported(name, party.statuses[name] ?? {}); characterCode.nativeReloaded(name, party.statuses[name] ?? {}); },
            allows: () => consoleControl.allows('reply'), served: () => consoleControl.served() },
          group: name => (groups.solo(name)?.heartbeatResponse || heartbeatResponse).sections,
          hand: name => tasks.handResponse(name),
          visit: name => !!tasks.visit(name),
          groupedCombat: groupedCombatSnapshot,
          cave: dungeons.reply,
          merchantVisibility: name => merchantVisibility(party, name, Date.now()),
          dashboardLease: dashboardStream.replyLease,
          now: () => Date.now(),
        }),
      },
    );
    const cardLines = createCardLines(party as Parameters<typeof createCardLines>[0], {
        assignment: (member) => tasks.memberTask(member),
        monsterName: (key) => gameMonsters()?.[key]?.name,
        groupLine: (member) => taskOwner.status(member),
        lifecycle: () => consoleControl.state(),
        hunt: (member) => { const group = taskOwner.groupOf(member); return group ? partyHooks().ask('hunt.view', group) as HuntView | undefined : undefined; },
        merchantJob: () => !!partyHooks().ask('jobs.current'),
        escaping: (member) => partyHooks().survival.escaping(member),
        recovery: () => partyHooks().survival.recovery(groupKey(groupId('party', party.leader))),
        cave: () => partyHooks().ask('cave.state') as CaveVisitState,
        entryLabel: (slot, mode) => partyHooks().entries(slot).find(entry => entry.mode === mode)?.button?.label,
      });
    const publicOverview = createCoordinatorPublicOverview(party, {
      accountCharacter: ownedCharacter,
      activity: cardLines,
      now: () => Date.now(),
      handoff: publicHandoff,
      aldata: publicALDataState,
      servers: rosterProjection.servers,
      roster: rosterPayload,
      slots: slotPayload,
      classes: PARTY_CLASSES,
      anniversary: publicAnniversaryState,
      stamp: stampMerchantJob,
      collectionSlots: collectionSlotCount,
      collectionNearby: merchantCollectionNearby,
      luckSchedule: mluckScheduleStatus,
      realmControl: realmControlPayload,
      consoleControl: () => consoleControl.status(),
      recordSaved: () => diagnostics.lastSaved(),
    });
    const publicStateRoute = publicOverview.route;
    const {
      settings: merchantSettingsRoutes,
      priorities: routinePriorityRoute,
      collectionChanged,
    } = createCoordinatorMerchantConfiguration(party, {
      reconcileSales: reconcileAutomaticMerchantSales,
      runtime: itemsOwner.runtime,
      ownedType: (name) => ownedCharacter(name)?.type,
      persist: persistSettings,
      dispatch: () => merchantDispatcher.dispatch(),
      log: merchantLog,
      priorities: DEFAULT_MERCHANT_ROUTINE_PRIORITIES,
      automations: DEFAULT_MERCHANT_AUTOMATIONS,
      stamp: stampMerchantJob,
      write: writeSettings,
    });
    // The thresholds route is the settings owner's; the job owner answers a collection change.
    const thresholdRoute = createThresholdRoute(party, { collectionChanged, write: writeSettings });
    const { maps: mapStreams, market: marketWatch, combat: combatLogRoutes, prepareVersion } =
      createCoordinatorTelemetry(__dirname, initialVersion, party.combatLogs, {
        owned: ownedCharacter,
        now: () => Date.now(),
        persistHistory,
        persistHistoryNow,
        data: gameDataPorts,
        activeMaps: () => Object.values(party.statuses).map((status) => status?.map),
        leader: () => party.leader, reportMap: (name) => party.statuses[name]?.map,
        every: scopes.observe12.setInterval, cancel: scopes.observe12.clearInterval,
      });

    recoverMerchantQueue(party, () => Date.now(), stampMerchantJob);

    const anniversarySupplies = createAnniversarySupplies(party);

    const marketFeeds = createCoordinatorMarketFeeds(party, {
      baseUrl: process.env.AL_DATA_URL,
      now: () => Date.now(),
      sleep: scopes.act10.sleep,
      fetch: (url, options) => fetch(url, options),
      queueMarket: queueALDataMatches,
      queuePonty: queuePontyMatches,
      persistSettings,
      persistAuthentication: persistALData,
      anniversary: publicAnniversaryState,
      normalizePonty: (records, items) => normalizePontyListings(records, items),
      realmExists: itemsOwner.realmExists,
      watched: marketWatch.watched,
    });
    const { client: aldataClient, aldata: aldataService, ponty: pontyService } = marketFeeds;

    const { local: localMarket, bids: bidPurchases } =
      createCoordinatorPurchases(party, {
        now: () => Date.now(),
        priority: merchantJobPriority,
        publish: scheduleALDataPublish,
        log: merchantLog,
        prioritized: prioritizedStandBids,
        planPonty: (candidates, quantity, server, local) =>
          planPontyPurchase(candidates, quantity, server, local),
        enqueue: merchantQueue.enqueue,
        persist: persistSettings,
        dispatch: () => merchantDispatcher.dispatch(),
        blacklisted: itemsOwner.blacklisted,
      });

    const travelClock = createCoordinatorTravelClock({
      convoyStep: () => {
        return stepAllConvoys();
      },
      persist: persistSettings,
      every: scopes.act02.setInterval,
    });
    travelClock.startTravel();

    // The targeting owner's coordinator answers, the passing column and the grouped fight read, over
    // each combat group's record by its walk key.
    installCoordinatorTargeting(partyHooks(), { state: key => groups.walkGroup(key)?.state, now: () => Date.now() });
    installStatusNotices(partyHooks(), { state: key => groups.walkGroup(key)?.state }, diagnostics, {
      cardLine: cardLines,
      lastReport: name => { const status = party.statuses[name]; return status ? { report: status, seenAt: Number(status.seenAt) } : null; },
      connected: name => reportOnline(party.statuses[name], Date.now()),
    });
    // The survival owner's party half: the death counter, the verdict, the escape and the death
    // recovery, and their `core:survival` answers.
    const survival = installCoordinatorSurvival({ hooks: partyHooks(), party, now: () => Date.now(), persist: persistSettings,
      group: () => groupKey(groupId('party', party.leader)), members: () => farmingNavigation.members(), intent: (name) => farmingNavigation.intent(name),
      convoy: (location, label, names, purpose) => startPartyMonsterConvoy(location as Parameters<typeof startPartyMonsterConvoy>[0], label, names, purpose),
      // The escape and death recovery gates ask the hunting owner's `cave.state` for a member inside a run.
      inCave: (name) => (partyHooks().ask('cave.state', name) as CaveMemberState).inside, online });
    const leaderScopePorts = scopePorts(party, { members: () => farmingNavigation.members(),
      select: (id, location) => monsterSelectionRoutes.modeTarget(id, location),
      passive: { rule: (id) => party.passiveHunting?.rules[id], set: (rules, by) => rareControl.setSettings({ rules }, by) } });
    // The scoped farming routes (runtime/tasks/coordinator/routes.ts): a character's request goes to
    // its own group's handler.
    const scoped = createScopedRoutes<ReturnType<typeof soloGroup>>({
      owned: ownedCharacter, merchant: () => party.merchantCharacter, combat: groups.isCombat, owner: farmingScopes.owner,
      // The status owner's app interface v1 (runtime/status/coordinator/routes.ts): the
      // scoped route's reply names each scope's single mode, derived from the pair
      // (settings/slots.ts), for the apps.
      solo: groups.solo, mainOwner: () => party.leader, mode: name => farmingScopes.profile(name).farmingPolicy,
      savedMode: () => createSavedFarmingModeRoute(party, { profile: farmingScopes.profile,
        persist: persistSettings, write: writeSettings }),
      walkRoutes: (routes, service) => installSharedConvoyRoute(routes, service.state, ownedCharacter, service.walks),
    });
    const scopedRoute = scoped.route;
    const liveTask = tasks.live;

    // The roster's ports, which its routes and lifecycle's roster reads share.
    const rosterPorts: Parameters<typeof createCoordinatorOwnershipPorts>[2] = {
      now: Date.now,
      id: () => crypto.randomUUID(),
      commit: rosterCommit,
      notify: (hook, payload) => { partyHooks().notify(hook, payload); },
      owned: ownedCharacter,
      updateAccount: () => my_acc.updateInfo(),
      sleep: lifecycleClock.sleep,
      nextAccount: () => new Promise(resolve => { const answered = (account: unknown) => { my_acc.remove_listener(answered); resolve(account); }; my_acc.add_listener(answered); }),
      realmMoving: name => merchantRealm.movingFor(name),
      switchRealm: names => realmOperationDestination(party.realmSwitch ?? null, names),
      stop: (block, reason) => characterWorkers.stop(block, reason),
      assignSlot: (slot, name, by) => characterWorkers.assign(slot, name, by),
      roster: rosterPayload,
      configuredRealm,
      releaseBankboi: () => bankboiService.releaseForSteam(),
    };
    partyHooks().register(lifecycleRegistration(rosterPorts, consoleControl, { now: Date.now, startedAt: Date.now(),
      report: name => party.statuses[name], worker: name => character_manage[name] }));
    startCoordinatorWebServices<WebMiddleware, WebRouter, WebMonitor>(
      cfg.web_app,
      cfg.enable_TYPECODE,
      {
        createRouter: express,
        createMonitor: (options) => new bwi(options),
        retainMonitor: characterWorkers.retainMonitor,
        staticFiles: (directory) => express.static(directory),
        directory: __dirname,
        updateRate: STAT_BEAT_INTERVAL,
        info: (details, message) => log.info(details, message),
        error: (...args) => console.error(...args),
        dashboard: (express_inst) =>
          installCoordinatorDashboard<WebMiddleware, WebMiddleware, WebRouter>(
            express_inst,
            {
              dashboardImportRoutes,
              settingsRoutes,
              anniversaryVisitRoutes,
              anniversaryNavigationRoutes,
              anniversaryCommerceRoutes,
              anniversarySuppliesRoute,
              mailPostageRoute,
              aldataRoutes,
              characterCreationRoutes,
              bankboiStorageRoutes,
              bankboiDeleteRoute,
              realmRoutes,
              monsterSelectionRoutes,
              addonRoutes,
              addonFarmingRoute: scopedRoute(tasks.slots.route(party, () => String(party.leader)), service => service.addonFarmingRoute, true),
              addonCommandRoute: scopedRoute(addonRoutes.command(party, () => String(party.leader)), service => service.addonCommandRoute, true),
              focusRoute: scopedRoute(focusRoute, service => service.focusRoute),
              formationRoute,
              huntBlacklistRoute: scopedRoute(huntBlacklistRoute, service => service.huntBlacklistRoute, true),
              huntSettingsRoute: scopedRoute(huntSettingsRoute, service => service.huntSettingsRoute, true),
              huntModeRoute: scopedRoute(huntModeRoute, service => service.huntModeRoute, true, true),
              huntControlRoutes: scoped.group(huntControlRoutes, service => service.huntControlRoutes),
              eventRecoveryRoutes: scoped.group(eventRecoveryRoutes, service => service.eventRecoveryRoutes),
              eventAcknowledgementRoutes: scoped.group(eventAcknowledgementRoutes, service => service.eventAcknowledgementRoutes),
              convoyEngagementRoutes: scoped.group(convoyEngagementRoutes, service => service.convoyEngagementRoutes),
              convoyAcknowledgementRoutes: scoped.group(convoyAcknowledgementRoutes, service => service.convoyAcknowledgementRoutes),
              partyActionRoutes,
              merchantSettingsRoutes,
              staleOrderRoute,
              ruleConflictRoute,
              standMarkRoute,
              npcSaleRoute,
              deconstructionRoutes,
              automaticSaleRoutes,
              routinePriorityRoute,
              merchantBlacklistRoute,
              merchantControlRoutes,
              merchantBidRoute,
              stackMergeRoute,
              merchantIdleRoute,
              merchantRequestRoutes,
              sendMailRoute,
              manualMarketOrderRoutes,
              merchantOrderRoute,
              merchantExchangeRoutes,
              merchantHandoffRoutes,
              merchantProgressRoutes,
              marketplaceProgressRoutes,
              merchantRealmRoutes,
              marketplaceLocationRoute,
              merchantClusterRoutes,
              bankUnlockRoute,
              merchantCompletionRoute,
              inventoryReceiptRoutes,
              restockRoute,
              thresholdRoute,
              characterCommandRoute,
            },
            {
              json: (options) => express.json(options),
              text: (options) => express.text(options),
              maps: (router) => {
                installCaveRoutes(router, dungeons);
                upgradePreviews.install(router);
                installLifecycleRoutes(router, { control: consoleControl, statuses: () => party.statuses,
                  code: __dirname + '/../CODE/adventure_land', inspection: {
                    owned: name => !!ownedCharacter(name), now: Date.now, version: () => party.gameVersion, directory: __dirname,
                    read: file => fs_regular.readFileSync(file, 'utf8'),
                    catalog: () => party.merchantCatalog, session: () => sess, loadFetch: () => platform.loadFetch(),
                    log: message => console.warn('Character inspection: ' + message),
                  } });
                installMovementRoutes(router, movementPlanner, ownedCharacter);
                installMovementRecordRoutes(router, movementRecords, ownedCharacter);
                installTaskRoutes(router, taskOwner, group => movementRecords.snapshots(group), () => Object.fromEntries(tasks.presences));
                installProductionRoutes(router, party, () => persistence.settings(), merchantLog);
                installStandLocationRoute(router, party, canStand, writeSettings);
                installMarketRoutes(router, party, { fulfill: fulfillStandBid, persist: persistSettings, dispatch: () => merchantDispatcher.dispatch(), enqueue: merchantQueue.enqueue, write: writeSettings });
                installSharedConvoyRoute(scoped.router(router), party, ownedCharacter, partyWalks);
              },
              status: (router) => installStatusRoutes(router, { state: publicStateRoute, intake: statusIngestion,
                installs: [mapStreams, marketWatch, dashboardStream, combatLogRoutes, metrics], diagnostics, owned: ownedCharacter,
                apps: createApps(party as Parameters<typeof createApps>[0], { now: Date.now, persist: persistSettings, notify: (event, payload) => { partyHooks().notify(event, payload); } }) }),
              roster: (express_inst) => {
                const ownership = coordinatorOwnership(party);
                installRosterRoutes(express_inst, ownership, createCoordinatorOwnershipPorts(party, character_manage, rosterPorts), scopes.act13);
              },
              startMail: () => createMailInboxRoutes(itemsOwner.startMail({ session: sess,
                loadFetch: () => platform.loadFetch(), enqueue: mailJobs.collect })),
            },
          ),
      },
    );

    // The root's port functions, by owner section. Each is a declaration the flow above hands as
    // a port; the order of the sections follows the header's.

    // The tasks owner's combat group composition: each group's services, the solo groups and the
    // scope ports. One composition of a combat group's services (cut 1), the party's group and each
    // solo group alike. Where the two kinds differ, the composition reads the kind's `groups`
    // columns (runtime/tasks/rules.ts `GROUPS`); a port whose source the kind does not run answers
    // nothing. The group's id is its kind and its leader, and a solo scope's leader is its one
    // character (hunt/scopes.ts `view`).
    function composeCombatGroup(state: typeof party, kind: 'party' | 'solo') {
      const columns = GROUPS[kind];
      const group = () => groupId(kind, state.leader);
      // A group of one reads only its own report; the party's event services and heartbeat read
      // groups.ts `partyScoped`.
      const own = () => activeOf(state.leader, activeNames());
      const one = columns.members === 'one';
      const active = one ? own : activeNames;
      const scoped: () => string[] = one ? own : groups.partyScoped;
      const members = one ? () => [String(state.leader)] : () => farmingNavigation.members();
      const intent = columns.holds ? navigationIntentOf : (name: string) => farmingNavigation.intent(name);
      const start: typeof startPartyMonsterConvoy = columns.holds ? startPartyMonsterConvoy : (...args) => partyConvoys.start(...args);
      const cancel = () => partyConvoys.cancel();
      const huntParticipants = () => coordinatorHuntParticipants(state, Date.now, active);
      const selectedDestination = (character: string | null) => selectCoordinatorMonsterDestination(state, character);
      const monsterDestination = (type: string | null | undefined) => coordinatorHuntDestination(state, type);
      const cancelHuntConvoy = () => cancelCoordinatorHuntConvoy(state, cancel);
      const clearHunt = () => clearCoordinatorHunt(state, cancel);
      // The hunting owner's farming destinations and the events owner's event return travel, which reads them
      // and keeps its own owners' waypoints on them.
      const farmingIntents = createFarmingIntents(state, {
        now: Date.now, names: one ? () => [String(state.leader)] : () => Object.keys(character_manage), online,
        cancelConvoy: cancel, startConvoy: start, events: () => eventTravel, persist: persistSettings,
      });
      const eventTravel = createEventReturnTravel(state, {
        now: Date.now, nextCommand: tasks.nextCommand, intent: farmingIntents.intent, members: farmingIntents.members, waypoint: farmingIntents.waypoint,
        activeNames: active, cancelConvoy: cancel, startConvoy: start, persist: persistSettings, log: anniversaryLog,
      });
      const farmingNavigation = { ...farmingIntents, ...eventTravel };
      const partyConvoys = createCoordinatorPartyConvoys(state, {
        // The convoy's progress shows on each member's card, not in the merchant activity.
        log: (message) => console.log('Party convoy: ' + message),
        now: () => Date.now(),
        activeNames: active,
        intent: (name) => farmingNavigation.intent(name),
        resolveArea: (catalog, monsters, location) => farmZones.resolve(catalog, monsters, location),
        persist: persistSettings,
        group: () => groupKey(group()),
        live: () => liveTask(group()),
        listeners: partyHooks(),
      });
      // The hunting owner's rejected rares for the group (`farming.focus`), which the grouped queue
      // and the walk's Hunt travel read.
      const focus = () => partyHooks().ask('farming.focus', group() ?? undefined) as FarmingFocus | undefined;
      const rareRejections = () => focus()?.rare.rejected ?? [];
      // The scoped leader also uses the native group target lock. A null group only appears to
      // work when a travel encounter finishes its quest first.
      const groupedCombatSnapshot = () => coordinatorGroupedSnapshot(state, {
        now: Date.now,
        // The party's death recovery (`deathRecovery`), asked by the group's walk key.
        recoveryGroup: () => columns.deathRecovery ? groupKey(group()) : null,
        intent,
        owned: ownedCharacter,
        // A member under a user hold is in no grouped pull (13.5): the console never moves it, so
        // its attack-range readiness never comes, and a pull that waited on it would never commit.
        prepare: (list) => columns.deathRecovery ? tasks.unheld(list, kind) : list,
        evaluate: evaluateGroup,
        rareRejections,
        pullsHeld: () => !consoleControl.allows('pulls', rare.blocksPulls()),
        patrolAcquisitionAllowed: () => !!focus()?.rare.patrolAcquisition,
      });
      const eventCheckpoint = () => coordinatorEventCheckpoint(state, name => farmingNavigation.waypoint(name));
      const eventReturns = createCoordinatorEventReturns(state, {
        now: () => Date.now(),
        nextCommand: tasks.nextCommand,
        activeNames: scoped,
        // The return's members follow the group's scope owner, so one whose Follow changed leaves it.
        moved: name => farmingScopes.owner(name) !== state.leader,
        enabled: eventsEnabledFor,
        checkpoint: eventCheckpoint,
        cancelConvoy: cancel,
        startConvoy: start,
        anniversaryParticipants: one ? own : anniversaryCombatParticipants,
        navigation: farmingNavigation,
        persist: persistSettings,
        // The `into Hunt` row: the hunting owner's `hunt.view` names the group's Hunt
        // cycle.
        huntCycle: () => !!group() && !!(partyHooks().ask('hunt.view', group()!) as HuntView | undefined)?.stage,
      });
      // The group's Hunt and farm spot (07 2.2); their task ladders climb the group's.
      const { hunt, farm: farmAreaNavigation, huntLadder, rare } = hunting.group(state, kind, character_manage, {
        now: () => Date.now(),
        participants: huntParticipants,
        cancelConvoy: cancel,
        persist: persistSettings,
        selectedDestination,
        start,
        navigation: farmingNavigation,
        ladder: kinds => ladderPort(taskOwner, group, kinds),
        intentHold: (reason) => tasks.intentHold(group(), reason),
        group,
        farmingLive: () => tasks.farmingLive(group()),
        drain: () => consoleControl.drain(),
      });
      const heartbeatResponse = createHeartbeatReply(state, {
        now: () => Date.now(),
        diagnosticsRings: name => diagnostics.rings(name),
        persist: persistSettings,
        activeNames: scoped,
        enabled: eventsEnabledFor,
        intent,

        rareControl: rare.control,
        rareRejections,
        convoySignal: (convoyState, name) => convoyNavigation.signal(convoyState, name),
        resolveArea: (catalog, focus, waypoint) => farmZones.resolve(catalog, focus, waypoint),
        waypoint: (name) => farmingNavigation.waypoint(name),
        rareEncounter: rare.encounter,
        // On the party's heartbeat: a hand-in never holds a member away from a live event it
        // attends. A solo heartbeat reads the hand-in without the yield (`groups`).
        huntOwns: () => tasks.turnIn(state, columns.turnIn),
        mapSubscriberCount: (name) => mapStreams.count(name),
        items: (name, command) => itemsOwner.reply(name, command),
        groupedCombat: groupedCombatSnapshot,
        selectedEvents: coordinatorEvents.attendableEvents,
        anniversary: publicAnniversaryState,
        rareOwns: rare.owns,
        task: tasks.memberTask,
        setting: query => partyHooks().read(query),
      });
      const eventObservations = createCoordinatorEventObservations(state, {
        cancelConvoy: cancel,
        nextCommand: tasks.nextCommand,
        releaseAnniversary: farmingNavigation.releaseReturn,
        now: () => Date.now(),
        activeNames: scoped,
        online,
        enabled: eventsEnabledFor,
        admits: name => taskOwner.allows('event-attendance', name),
        selected: coordinatorEvents.selected,
        checkpoint: eventCheckpoint,
        navigation: farmingNavigation,
        persist: persistSettings,
        log: anniversaryLog,
        goobrawlStillFighting: eventReturns.goobrawlStillFighting,
        begin: eventReturns.begin,
        finishIfReady: eventReturns.finishIfReady,
      });
      const {
        mode: huntModeRoute,
        blacklist: huntBlacklistRoute,
        settings: huntSettingsRoute,
        controls: huntControlRoutes,
      } = createHuntRoutes(state, {
        now: () => Date.now(),
        write: writeSettings,
        fighting: (fightState, names) => convoyFighting(fightState, names),
        participants: huntParticipants,
        intent: (name) => farmingNavigation.intent(name),
        release: () => { if (columns.escape) survival.release(); },
        authorize: (...args) => farmingNavigation.authorize(...args),
        monsterDestination,
        clear: clearHunt,
        selectedDestination,
        convoy: start,
        begin: (...args) => hunt.begin(...args),
        waypoint: (name) => farmingNavigation.waypoint(name),
        persist: persistSettings,
        owned: ownedCharacter,
        ownsTravel: priority,
        ladder: huntLadder,
        fresh: (cycle) => hunt.fresh(cycle),
        cancelConvoy: cancelHuntConvoy,
        start: (cycle, location, label, stage) => hunt.start(cycle, location, label, stage),
        group,
      });
      const eventRecoveryRoutes = createEventRecoveryRoutes(state, {
        owned: ownedCharacter,
        enabled: eventsEnabledFor,
        participants: one ? own : anniversaryCombatParticipants,
        active,
        abort: finishAnniversaryAbort,
        begin: eventReturns.begin,
        snapshot: publicAnniversaryState,
        persist: persistSettings,
      });
      const {
        events: eventAcknowledgementRoutes,
        engagement: convoyEngagementRoutes,
        acknowledgements: convoyAcknowledgementRoutes,
      } = createCoordinatorNavigationActions(state, {
        now: () => Date.now(),
        owned: ownedCharacter,
        walkFailed,
        farmingLive: () => tasks.farmingLive(group()),
        intent: (name) => farmingNavigation.intent(name),
        group: groupedCombatSnapshot,
        persist: persistSettings,
        selectedDestination,
        finishReturn: eventReturns.finishIfReady,
        contains: (...args) => farmZones.contains(...args),
        huntOwns: priority,
        engage: (engageState, body, options) => convoyNavigation.engage(engageState, body, options),
        acceptArrival,
        waypoint: (name) => farmingNavigation.waypoint(name),
        start,
        active,
        members: () => farmingNavigation.members(),
        valid: (validState, body) => convoyNavigation.validReport(validState, body),
        history: persistHistory,
        hold: (holdState, ...args) => convoyNavigation.hold(holdState, ...args),
        error: (message) => console.error(message),
      });
      // The group's shared walk (navigation/shared-walk.ts). The party's walks wait for its escape.
      const walks = {
        now: Date.now, members, owned: ownedCharacter, enabled: eventsEnabledFor, start, live: () => liveTask(group()), persist: persistSettings, cancel, group,
        allowed: (activity: string, takeover?: WalkTakeover) => tasks.walkAllowed(state, activity, kind, takeover),
      };
      return { state, farmingNavigation, partyConvoys, groupedCombatSnapshot, huntParticipants, hunt, huntTick: hunt, farmAreaNavigation, heartbeatResponse,
        eventReturns, eventObservations, eventRecoveryRoutes, huntModeRoute, huntBlacklistRoute, huntSettingsRoute, huntControlRoutes,
        eventAcknowledgementRoutes, convoyEngagementRoutes, convoyAcknowledgementRoutes, walks };
    }

    // A solo group's composition, plus the two pieces the party's own routes hold for the party:
    // the focus route and a target mode entry's selection, which moves this character alone with
    // the same manual-monster walk.
    function soloGroup(name: string) {
      const group = composeCombatGroup(farmingScopes.view(name), 'solo'), { state, farmingNavigation } = group;
      const modeSelection = createMonsterSelection(state, {
        now: Date.now,
        destination: () => null, release: () => {}, clearHunt: () => clearCoordinatorHunt(state, () => group.partyConvoys.cancel()),
        members: () => [name], authorize: (...args) => farmingNavigation.authorize(...args),
        start: group.walks.start, startPhoenix: () => {}, stopPhoenix: () => {},
        persist: persistSettings, validPassive: () => false, setPassive: () => ({ ok: false, field: "passiveHunting", error: "Passive hunting belongs to the party's scope" }),
        write: writeSettings,
        invalidate: (...args) => farmingNavigation.invalidate(...args),
      });
      return { ...group,
        focusRoute: createFocusRoute(state, {
          focusChanged: () => group.farmAreaNavigation.focusChanged(),
          owned: ownedCharacter, members: () => [name], invalidate: (...args) => farmingNavigation.invalidate(...args), persist: persistSettings,
          write: writeSettings,
        }),
        scopePorts: scopePorts(state, { members: () => [name], select: (id, location) => modeSelection.select(id, location, true) }),
        addonFarmingRoute: tasks.slots.route(state, () => name), addonCommandRoute: addonRoutes.command(state, () => name) };
    }

    // A target mode entry's ports for one farming scope (`target.mode`). When the entry waits is
    // The tasks owner's `busy` (runtime/tasks/coordinator/install.ts).
    function scopePorts(state: typeof party, ports: { members(): string[];
      select(id: string, location: Parameters<typeof monsterSelectionRoutes.modeTarget>[1]): string[] | null;
      passive?: { rule(id: string): unknown; set(rules: Record<string, unknown>, by: string): SettingsWriteResult } }): ScopePorts {
      return { members: ports.members, select: ports.select, passive: ports.passive, write: (changes, by) => writeSettings({ changes, by }),
        focus: (ids: string[]) => { writeSpot(state, { monsterFocus: ids }); },
        destination: (type: string) => coordinatorHuntDestination(state, type, false),
        radius: () => searchReach(state.monsterSearchRadiusByCharacter, state.leader), persist: persistSettings };
    }

    function activeNames() {
      return activeCoordinatorNames(party.statuses, Date.now());
    }
    // The lifecycle owner's answer whether a member is online by any client (roster-projection.ts
    // `online`): the escape, the Cave and the event holds ask it before they drop a member whose
    // reports stopped.
    function online(name: string) {
      return rosterProjection.online(name);
    }

    // movement's walks: the convoy step, the active walk's cancel and a member's navigation
    // intent.
    function stepAllConvoys() { return stepWalks(groups.combat(), convoyNavigation); }

    function cancelActiveConvoy() {
      return partyConvoys.cancel();
    }

    function navigationIntentOf(name: string): import("../movement/api/coordinator.ts").NavigationIntent { return tasks.holds.intent(name, farmingNavigation.intent(name)); }

    // The hunting owner's Hunt record clear.
    function clearMonsterHuntState() {
      return clearCoordinatorHunt(party, cancelActiveConvoy);
    }

    // The events owner's anniversary: its log, counts, trade identity, public state and
    // return walk.
    function anniversaryLog(
      message: Parameters<typeof activity.anniversary>[0],
      level: Parameters<typeof activity.anniversary>[1] = "info",
      details?: Parameters<typeof activity.anniversary>[2],
    ) {
      activity.anniversary(message, level, details);
    }

    function anniversaryCounts() {
      return anniversarySupplies.counts();
    }

    function anniversaryIdentityAlreadyTraded(
      identity: Parameters<typeof anniversarySupplies.alreadyTraded>[0],
    ) {
      return anniversarySupplies.alreadyTraded(identity);
    }

    function publicAnniversaryState() {
      return anniversarySnapshot.snapshot();
    }

    function anniversaryFallbackDestination(_candidate?: unknown) {
      return farmingNavigation.waypoint(party.leader);
    }

    function abortAnniversaryRound(body: Parameters<typeof anniversaryReturns.abort>[0]) {
      return anniversaryReturns.abort(body);
    }

    function finishAnniversaryAbort(
      cycle: Parameters<typeof anniversaryReturns.finishAbort>[0],
      round: Parameters<typeof anniversaryReturns.finishAbort>[1],
      target: Parameters<typeof anniversaryReturns.finishAbort>[2],
      name: Parameters<typeof anniversaryReturns.finishAbort>[3],
      reason: Parameters<typeof anniversaryReturns.finishAbort>[4],
    ) {
      return anniversaryReturns.finishAbort(cycle, round, target, name, reason);
    }

    function scheduleAnniversaryReturnConvoy() {
      coordinatorEvents.anniversaryDispatch();
    }

    function reconcileAnniversaryReturnFromStatus(
      name: Parameters<typeof anniversaryReturns.reconcile>[0],
      status: Parameters<typeof anniversaryReturns.reconcile>[1],
    ) {
      return anniversaryReturns.reconcile(name, status);
    }

    // The call budget's merchant realm: the realm's participants, its control payload and whether a
    // realm move holds the merchant.
    function realmParticipants() {
      return rosterProjection.participants();
    }

    function realmControlPayload() {
      return rosterProjection.control();
    }

    function realmOwnsMerchant() {
      return realmOperationOwnsCharacter(party.realmSwitch, party.merchantCharacter);
    }

    // The merchant job owner's merchant jobs: the activity log, the job's priority and stamp, the
    // collection and capacity reads, the queue, the giveaways and the luck.
    function merchantLog(
      message: Parameters<typeof activity.merchant>[0],
      level: Parameters<typeof activity.merchant>[1] = "info",
      details?: Parameters<typeof activity.merchant>[2],
    ) {
      activity.merchant(message, level, details);
    }

    function publicMerchantJob(job?: Parameters<typeof publicOverview.job>[0]) {
      return publicOverview.job(job);
    }

    function merchantRoutinePriority(
      reason: Parameters<typeof routinePriorityOf>[1],
    ) {
      return routinePriorityOf(party.merchantRoutinePriorities, reason);
    }

    function stampMerchantJob<T extends Parameters<typeof stampJob>[0]>(
      job: T,
    ) {
      return stampJob(job, merchantJobPriority, Date.now());
    }

    function merchantJobPriority(
      job: Parameters<typeof coordinatorMerchantPriority>[1],
    ) {
      return coordinatorMerchantPriority(party, job);
    }

    function merchantTransferCapacityBlocked(
      job?: Parameters<typeof coordinatorMerchantTransferBlocked>[1],
    ) {
      return coordinatorMerchantTransferBlocked(party, job);
    }

    function collectionSlotCount(
      name: Parameters<typeof coordinatorCollectionSlots>[1],
    ) {
      return coordinatorCollectionSlots(party, name);
    }

    function merchantCollectionNearby(
      name: Parameters<typeof coordinatorCollectionNearby>[1],
    ) {
      return coordinatorCollectionNearby(party, name, () => Date.now());
    }

    function markedCollectionReady(
      job: Parameters<typeof coordinatorCollectionReady>[1],
    ) {
      return coordinatorCollectionReady(party, job, () => Date.now());
    }

    function pickJobByPriority(facts: Parameters<typeof takeCoordinatorMerchantJob>[1], run?: string) {
      return takeCoordinatorMerchantJob(party, facts, run);
    }

    function merchantCapacitySignature(
      name: Parameters<typeof coordinatorMerchantCapacitySignature>[1],
    ) {
      return coordinatorMerchantCapacitySignature(party, name);
    }

    function queueMerchant(
      names: Parameters<typeof merchantQueue.queue>[0],
      reason: Parameters<typeof merchantQueue.queue>[1] = "service",
    ) {
      merchantQueue.queue(names, reason);
    }

    function scheduleNearbyGiveaways(status?: Parameters<typeof giveawayScheduler.schedule>[0]) {
      giveawayScheduler.schedule(status);
      giveawayScheduler.scheduleMarket(party.aldata.merchants);
    }

    function hasStrongMluck(status?: Parameters<typeof strongMluck>[0]) {
      return strongMluck(status, party.merchantCharacter);
    }

    function mluckTravelLead(
      targetStatus: Parameters<typeof mluckLead>[1],
    ) {
      return mluckLead(
        party.statuses[String(party.merchantCharacter)],
        targetStatus,
      );
    }

    function scheduleMerchantLuck() {
      return luckScheduler.schedule();
    }

    function mluckScheduleStatus() {
      return luckScheduler.snapshot();
    }

    // The items owner's items, bank and commerce: the bank vaults and state, the restock, the market
    // feeds and bids, the reservations and the BankBoi.
    function loadBankVaultDefinitions() {
      return loadCoordinatorBankVaults(initialVersion, gameDataPorts);
    }

    function persistBankState() {
      persistence.bank();
    }

    function queueExchangeStorage(
      job: Parameters<typeof storageService.queueExchange>[0],
      shortages?: Parameters<typeof storageService.queueExchange>[1],
    ) {
      return storageService.queueExchange(job, shortages);
    }

    function adoptReservedBankboiCargo() {
      return reservedBankboiCargo.reconcile();
    }

    function policyFor(name: string | null) {
      return restockPolicyOf(party.restockPolicies, name);
    }

    function restockSatisfied(
      name: string,
      items: Parameters<typeof restockInventorySatisfied>[0],
    ) {
      return restockInventorySatisfied(items, () => policyFor(name));
    }

    async function aldataFetch(
      path: Parameters<typeof aldataClient.request>[0],
      options: Parameters<typeof aldataClient.request>[1] = {},
    ) {
      return aldataClient.request(path, options);
    }

    // The dashboard's read of the market asks the feeds.
    function publicALDataState() {
      marketFeeds.ask();
      return aldataService.snapshot();
    }

    function removeQueuedBidPurchases(itemId: Parameters<typeof bidPurchases.removeQueued>[0]) {
      return bidPurchases.removeQueued(itemId);
    }

    function fulfillStandBid(
      item: Parameters<typeof bidPurchases.fulfill>[0],
      quantity: Parameters<typeof bidPurchases.fulfill>[1],
    ) {
      return bidPurchases.fulfill(item, quantity);
    }

    function queuePontyMatches() {
      return bidPurchases.queuePonty();
    }

    function queueALDataMatches() {
      return bidPurchases.queueMarket();
    }

    async function refreshALData(kind: Parameters<typeof aldataService.refresh>[0] = "all") {
      return aldataService.refresh(kind);
    }

    // A market change publishes through the one publication check.
    function scheduleALDataPublish() {
      void marketFeeds.publish();
    }

    function observeStandMarket(listings: Parameters<typeof localMarket.observe>[0]) {
      return localMarket.observe(listings);
    }

    function reconcileAutomaticMerchantSales(
      status?: Parameters<typeof automaticMerchantSales.reconcile>[0],
    ) {
      return automaticMerchantSales.reconcile(status);
    }

    function removeInventoryReservations(
      name: Parameters<typeof inventoryReservations.remove>[0],
      slot: Parameters<typeof inventoryReservations.remove>[1],
      item: Parameters<typeof inventoryReservations.remove>[2],
    ) {
      inventoryReservations.remove(name, slot, item);
    }

    function clearResolvedUpgradeMarks(
      name: Parameters<typeof clearCoordinatorResolvedUpgrades>[1],
      resolved: Parameters<typeof clearCoordinatorResolvedUpgrades>[2],
    ) {
      clearCoordinatorResolvedUpgrades(party, name, resolved);
    }

    function clearIncomingCompoundReservation(
      name: Parameters<typeof inventoryReservations.clearIncoming>[0],
      item: Parameters<typeof inventoryReservations.clearIncoming>[1],
    ) {
      inventoryReservations.clearIncoming(name, item);
    }

    function prioritizedStandBids(
      reason: Parameters<typeof coordinatorPrioritizedBids>[1],
    ) {
      return coordinatorPrioritizedBids(party, reason);
    }

    function queueLocalStandSync() {
      return merchantQueue.localStandSync();
    }

    function scheduleAutoCompound(
      name: Parameters<typeof improvementScheduler.compound>[0],
      status?: Parameters<typeof improvementScheduler.compound>[1],
    ) {
      return improvementScheduler.compound(name, status);
    }

    function scheduleAutoExchange(status?: Parameters<typeof improvementScheduler.exchange>[0]) {
      return improvementScheduler.exchange(status);
    }

    async function restoreMerchantAfterBankboi(
      transaction: Parameters<typeof bankboiService.restore>[0],
    ) {
      return bankboiService.restore(transaction);
    }

    async function maybeStartBankboiService() {
      return bankboiService.start();
    }

    // The lifecycle owner's lifecycle and roster: the owned characters, the roster and slot
    // payloads and the shutdown.
    function ownedCharacter(name: Parameters<typeof rosterProjection.owned>[0]) {
      return rosterProjection.owned(name);
    }

    function rosterPayload() {
      return rosterProjection.roster();
    }

    function nativeName() {
      return party.nativeOwner;
    }

    function slotPayload() {
      return rosterProjection.slots();
    }

    async function shutdown(signal: Parameters<typeof shutdownCoordinator>[0]) {
      return shutdownCoordinator(signal);
    }

    startCharacters({
      events: process,
      shutdown,
      workers: characterWorkers,
      code: characterCode,
      watchCode: !!cfg.watch_CODE,
      artifact: !!process.env.AL_CONSOLE_ARTIFACT,
      subscribeAccount: listener => my_acc.add_listener(listener),
      // A coordinator that starts under a deploy lease is a deploy's reload; one with the clean
      // shutdown's resume mark resumes.
      started: () => ({ realm: rosterProjection.homeRealm() ?? null, generation: process.env.AL_CONSOLE_ARTIFACT ?? null,
        reason: consoleControl.state().drain ? 'reload' : consoleControl.status().resume ? 'resume' : 'start' }),
      notify: (hook, payload) => { partyHooks().notify(hook, payload); },
      timers: scopes.act13,
    });
  })().catch(failStart);
}
