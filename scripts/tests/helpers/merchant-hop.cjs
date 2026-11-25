// The realm owner's hop executor (runtime/merchant-realm/character/hop.ts)
// over a vm context that holds shared.js's names, the
// names `hopPorts()` reads in play. It joins the context as `merchantHop` and `merchantRealm`.
const { createMerchantHop, realmOf } = require('../../../runtime/merchant-realm/character/hop.ts');

exports.installHop = context => {
  context.merchantRealm = { realmOf };
  context.merchantHop = createMerchantHop({
    parent: () => context.parent, character: () => context.character,
    request: (url, options) => context.request(url, options), sleep: ms => context.sleep ? context.sleep(ms) : Promise.resolve(),
    log: (message, color) => context.game_log?.(message, color), holdRealm: realm => context.merchantRunner?.holdRealm(realm),
    afterCombat: (action, label) => context.afterCombat(action, label), respawn: by => context.survivalRespawnWhenAllowed(by),
    setHome: () => context.set_home(),
  });
  return context;
};
