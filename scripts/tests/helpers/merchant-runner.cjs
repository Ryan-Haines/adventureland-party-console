// The merchant job owner's runner (runtime/merchant-jobs/character/runner.ts)
// over a vm context that holds shared.js's names, the names
// `runnerPorts()` reads in play. The runner joins the context as `merchantRunner`, the name shared.js
// gives it, and keeps its holder record on the context's `root`.
const { createMerchantRunner } = require('../../../runtime/merchant-jobs/character/runner.ts');

// The items owner's stand (items/character/market.ts `stand`) over the context's game calls: open and close act
// only when the stand is not already in that state, and the fixtures list nothing.
const gameStand = context => ({
  open: async () => { if (!context.character.stand) await context.open_stand(); },
  close: async () => { if (context.character.stand) await context.close_stand(); },
  list: async () => [],
});

exports.installRunner = (context, overrides = {}) => {
  // shared.js creates the lifecycle owner's run scope before any owner installs, and the runner's job heartbeat asks it.
  require('./run-scope.cjs').processScope();
  context.root ||= {};
  context.partyItems ||= {};
  context.partyItems.stand ||= gameStand(context);
  const runner = createMerchantRunner({
    root: () => context.root,
    request: (url, options) => context.request(url, options),
    log: (message, color) => context.game_log?.(message, color),
    stopWalk: () => Promise.resolve(context.stop?.('smart', undefined, context.errandRequest)).catch(() => {}),
    standOpen: () => !!context.character?.stand,
    character: () => context.character,
    hop: () => context.merchantHop || { liveRealm: () => context.merchantHomeRealm, hop: async () => 'alreadyThere' },
    previewInFlight: () => !!context.bag?.facts().previewing,
    townReturn: (activity, owns) => context.merchantTownReturn ? context.merchantTownReturn(activity, owns) : Promise.resolve(false),
    walkToMarket: spot => context.smart_move(spot),
    stand: () => context.partyItems.stand,
    luckySlot: () => context.luckyUpgradeSlot, fingerprint: item => context.fingerprint ? context.fingerprint(item) : item,
    clockOffset: () => Number(context.walkState?.clockOffset) || 0,
    // The events owner's merchant row (character/merchant.ts), which a context plants as `eventMerchant`.
    eventReserved: () => !!context.eventMerchant?.reserved(), anniversaryReserved: () => !!context.eventMerchant?.anniversaryReserved(),
    gatheringHandoff: command => context.merchantGathering ? context.merchantGathering.meetCommand(command) : Promise.resolve(true),
    settle: command => context.merchantHands ? context.merchantHands.settle(command) : Promise.resolve(true),
    farmingTravel: () => context.farmingTravelToken, departing: on => { context.departurePending = on; },
    travelCombat: () => !!context.travelCombatActive?.(),
    fighting: travel => !!(travel ? context.getNearestPartyAttacker?.() : context.engagedMonster?.()),
    movement: () => context.movement || { afterCombat: async () => true },
    recoverProductionJournal: () => context.recoverProductionJournal(),
    previewSuppliesSaved: () => !!context.root.localStorage?.getItem('party-preview-supplies:' + context.character?.name),
    restoreUpgradePreviewSupplies: () => context.restoreUpgradePreviewSupplies(),
    setLuckySlot: slot => { context.luckyUpgradeSlot = slot; }, recoverLuckyUpgrade: () => context.recoverLuckyUpgrade(),
    freeSlots: () => context.freeInventorySlots(), tidyLuckySlot: slot => context.tidyLuckySlot(slot),
    // The fixtures plant no mergeable pair, so a job's merge moves nothing.
    mergeBag: async () => 0,
    ...overrides,
  });
  context.merchantRunner = runner;
  return runner;
};
// A sliced shared.js function reads the runner by its shared.js name; this hands a test's context one.
exports.withRunner = context => { exports.installRunner(context); return context; };
