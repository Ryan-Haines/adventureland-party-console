// `survival.escaping` (runtime/characters/survival/escape.ts), which sliced the tasks, movement, turns, targeting and merchant jobs owners'
// code of characters/shared.js asks through the realm's registry.
// A test root with no registry gets a real one, and `core:planted-escaping` answers on it in the
// escape's place: the test's own `escapeOwns` stub and `escapeState` name the escape, and
// escape.ts `escapeAdmits` gives the purpose its stage lets through.
const { createRegistry } = require('../../../runtime/hooks/registry.ts');
const { escapeAdmits } = require('../../../runtime/characters/survival/escape.ts');

exports.plantEscaping = context => {
  if (!context.root || typeof context.root !== 'object' || context.root.__partyHooks) return context;
  const registry = context.root.__partyHooks = createRegistry();
  registry.register({ name: 'core:planted-escaping', folder: 'core', author: 'test', summary: 'A planted escape answer.',
    hooks: { 'survival.escaping': () => {
      if (typeof context.escapeOwns !== 'function' || !context.escapeOwns()) return undefined;
      const stage = context.escapeState?.stage ?? 'blink';
      return { id: context.escapeState?.id ?? 'test', stage, admits: escapeAdmits(stage) };
    } } });
  return context;
};
