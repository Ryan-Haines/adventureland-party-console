// The fighter's visit to the merchant (runtime/merchant-jobs/character/visits.ts)
// over a vm context that holds shared.js's names, the
// names `visitPorts()` reads in play. The module's functions join the context under their own names,
// so a test calls them as it called the slices.
const { createMerchantVisits, isPersonalTracker, cleanoutProtected, cleanoutPriority, cleanoutRespectsAutoItemLevel } =
  require('../../../runtime/merchant-jobs/character/visits.ts');
const { plantWalkState } = require('./walk-state.cjs');

// visits.ts reads the game's item table as the bare global G, as the game's code does. This puts the
// context's G there for the length of one call and restores the previous value after it, so a later
// test in the same process never reads this test's table.
function withGameTable(context, fn) {
  return (...args) => {
    if (!context.G) return fn(...args);
    const had = Object.getOwnPropertyDescriptor(globalThis, 'G');
    const restore = () => { if (had) Object.defineProperty(globalThis, 'G', had); else delete globalThis.G; };
    globalThis.G = context.G;
    let result;
    try { result = fn(...args); } catch (error) { restore(); throw error; }
    if (result && typeof result.then === 'function') return result.finally(restore);
    restore();
    return result;
  };
}

exports.installVisits = (context, overrides = {}) => {
  // The visit reads movement's `walkState`, which shared.js always holds; a sliced context's reads its
  // own variables (walk-state.cjs).
  plantWalkState(context);
  const visits = createMerchantVisits({
    character: () => context.character, player: name => context.get_player(name),
    current: () => context.runtimeCurrent(), lastCommand: () => context.lastCommand, walkState: () => context.walkState,
    partyLocation: () => context.partyLocation, realm: () => context.reunionRealm(), engaged: () => context.engagedMonster(),
    approach: (x, y) => context.xmoveAs?.(context.errandRequest, x, y),
    afterCombat: (action, label) => context.afterCombat(action, label), beginFarmReunion: () => context.beginFarmReunion(),
    request: (url, options) => context.request(url, options), sleep: ms => context.sleep(ms),
    // The game's packets and the merchant's own reports: a test drives them through `gameUpdate` and
    // `ownReport`, else each wait reads its state once per sleep, as the context's sleep runs.
    untilGame: async (events, done, bound) => {
      if (context.gameUpdate) return context.gameUpdate(events, done, bound);
      const end = Date.now() + bound;
      while (!done() && Date.now() < end) await (context.sleep ? context.sleep(0) : new Promise(r => setTimeout(r, 1)));
      return done();
    },
    nextReport: bound => context.ownReport ? context.ownReport(bound) : context.sleep ? context.sleep(0) : Promise.resolve(),
    waitForPlayer: (name, timeout) => context.waitForPlayer(name, timeout),
    sameItem: (item, wanted) => context.sameItem(item, wanted), findItem: wanted => context.findItem(wanted),
    fingerprint: item => context.fingerprint ? context.fingerprint(item) : { ...item }, itemQuantity: item => context.itemQuantity(item),
    freeInventorySlots: () => context.freeInventorySlots(),
    // The items owner's protected reserve (p.protectedSlots, the setting's default 3).
    protectedSlots: () => context.protectedSlots ? context.protectedSlots() : 3,
    refreshCompoundProtection: command => context.refreshCompoundProtection?.(command),
    compoundAvailableStock: command => context.compoundAvailableStock(command),
    unequip: slot => context.unequip(slot), sendItem: (name, slot, quantity) => context.send_item(name, slot, quantity),
    sendGold: (name, gold) => context.send_gold(name, gold), log: (message, color) => context.game_log(message, color),
    stop: action => context.stop(action), entities: () => context.parent?.entities,
    meet: (name, timeout, report) => context.meet(name, timeout, report),
    ...overrides,
  });
  const bound = {};
  for (const [name, fn] of Object.entries({ ...visits, cleanoutPriority })) bound[name] = typeof fn === 'function' ? withGameTable(context, fn) : fn;
  Object.assign(context, bound, { isPersonalTracker, cleanoutProtected, cleanoutRespectsAutoItemLevel });
  return bound;
};
