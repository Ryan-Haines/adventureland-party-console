// The job owner's gathering (runtime/merchant-jobs/character/gathering.ts)
// over a vm context that holds shared.js's names, the
// names `gatheringPorts()` reads in play, with the runner the attempt holds. The module joins the
// context as `merchantGathering`, the name shared.js gives it.
const { createGathering } = require('../../../runtime/merchant-jobs/character/gathering.ts');
const { installRunner } = require('./merchant-runner.cjs');
const { plantCalls } = require('./planted-calls.cjs');
const { createRunScope } = require('../../../runtime/lifecycle/character/run.ts');
// shared.js creates the lifecycle owner's run scope on the game window before any owner installs (run.ts `scope`).
// Here it runs on the test's own timers, and every registration takes an `observe` handle, which
// table P never holds: these rows test the attempt, not the hold.
const runScope = createRunScope({ frame: { setTimeout, clearTimeout, setInterval, clearInterval }, game: {}, name: () => 'Test', hold: () => null, notify() {} });

exports.installGathering = (context, overrides = {}) => {
  context.root ||= {};
  globalThis.parent ||= {};
  globalThis.parent.__partyRunScope ||= { scope: owner => runScope.scope(owner, 'observe'), dispose() {} };
  if (context.G) globalThis.G = context.G;
  if (!context.merchantRunner) installRunner(context);
  // The cast asks the call budget's job band (3.13); the planted budget answers "send".
  plantCalls();
  // The cast is the game's own call from the module, as in play.
  globalThis.use_skill = (mode, target) => context.use_skill(mode, target);
  const gathering = createGathering({
    root: () => context.root, runner: () => context.merchantRunner,
    character: () => context.character, parent: () => context.parent || {}, current: () => context.runtimeCurrent ? context.runtimeCurrent() : true,
    request: (url, options) => context.request ? context.request(url, options) : Promise.resolve({}),
    sleep: ms => context.sleep ? context.sleep(ms) : Promise.resolve(), log: (message, color) => context.game_log?.(message, color),
    stop: action => context.stop ? context.stop(action) : Promise.resolve(),
    smartMove: (destination, options) => context.smart_move(destination, undefined, options || {}),
    moving: () => !!context.character.moving,
    onCooldown: mode => context.is_on_cooldown(mode), canUse: mode => context.can_use(mode),
    sameItem: (item, wanted) => context.sameItem ? context.sameItem(item, wanted) : !!item && !!wanted && item.name === wanted.name,
    findItem: wanted => context.findItem ? context.findItem(wanted) : -1,
    fingerprint: item => item ? { ...item } : null, itemQuantity: item => Number(item && item.q) || 1,
    inventoryAmount: item => context.inventoryAmount ? context.inventoryAmount(item) : 0, freeSlots: () => context.freeInventorySlots(),
    // The items owner's protected reserve (p.protectedSlots, the setting's default 3).
    protectedSlots: () => context.protectedSlots ? context.protectedSlots() : 3,
    bankStoreFully: slot => context.bankStoreFully(slot), split: (slot, quantity) => context.split(slot, quantity),
    sortBankFloor: activity => context.sortCurrentBankFloor ? context.sortCurrentBankFloor(activity) : Promise.resolve(),
    townReturn: owns => context.merchantTownReturn ? context.merchantTownReturn(null, owns) : Promise.resolve(false),
    standReturn: (listings, current) => context.standReturn ? context.standReturn({ id: 0, listings }, current) : Promise.resolve(),
    market: () => context.merchantRunner.market(),
    ensureTool: (session, current) => context.ensureGatheringTool(session, current),
    equipTool: (session, current) => context.equipGatheringTool(session, current),
    restoreEquipment: current => context.restoreGatheringEquipment ? context.restoreGatheringEquipment(current) : Promise.resolve(true),
    // shared.js `gatheringPorts`: The lifecycle owner's maintenance flag, or the calls owner's hand control when the test plants it.
    maintenance: () => !!context.root.__partyConsoleMaintenance || !!context.handControl?.(), slotCommand: () => context.coordinatorCommand, lastCommand: () => context.lastCommand || 0,
    reportCommand: (command, state, reason) => context.reportMerchantCommand?.(command, state, reason),
    banking: () => !!context.banking, upgrading: () => !!context.upgrading,
    departurePending: () => !!context.departurePending,
    anniversaryReserved: () => !!(context.eventAnniversary?.busy() || context.eventMerchant?.anniversaryReserved()), forceStand: () => !!context.merchantForceStand,
    ...overrides,
  });
  context.merchantGathering = gathering;
  return gathering;
};
