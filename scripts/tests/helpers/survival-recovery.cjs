// The death recovery's walk identity, ladder and hold (runtime/characters/survival/recovery-member.ts
// `createRecoveryMovement`) over a sliced test's vm context, as shared.js's event rejoin reads them
// through `survivalCharacter.recovery`: the context's character, movement service, idle hold and
// last death.
const { createRecoveryMovement } = require('../../../runtime/characters/survival/recovery-member.ts');

exports.plantRecovery = context => {
  context.survivalCharacter = { recovery: createRecoveryMovement({ character: () => context.character, movement: () => context.movement,
    holdIdle: request => context.holdIdle(request), deathAt: () => context.lastDeathInfo && context.lastDeathInfo.at }) };
  return context;
};
