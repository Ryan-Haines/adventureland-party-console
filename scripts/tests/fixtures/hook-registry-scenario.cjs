// The hook registry's builders (runtime/hooks/registry.ts), moved from hook-registry.test.cjs by
// layer 7 step 5 so the targeting hooks' table builds from the shared harness.
const assert = require('node:assert/strict');
const { createRegistry } = require('../../../runtime/hooks/registry.ts');
const { coreRegistrations, addonSwitches } = require('../../../runtime/hooks/core.ts');

// The console's own registrations, each accepted, with the add-on switches' listener as
// runtime/hooks/index.ts registers it.
const loaded = () => {
  const r = createRegistry();
  for (const x of [...coreRegistrations, addonSwitches(r)]) assert.deepEqual(r.register(x), { ok: true }, x.name);
  return r;
};
const addon = (name, hooks, extra) => ({ name, folder: 'addons', author: 'e2e', summary: 'test', hooks, ...extra });
// A slot entry with the button and status every entry declares.
const entry = (slot, mode, fills = 'choice') => ({ slot, mode, fills, button: { label: mode, description: mode, color: 'slate' },
  ...(slot === 'target-mode' ? { status: { title: mode, field: 'message', idle: mode } } : {}) });
// A character's registrations: `core:targeting` answers the two targeting
// questions the turns owner asks.
// The turns owner's registration over stub answers (turns/install.ts `turnsRegistration`); a row
// that reads the pull check hands its own `pullSafe`.
const turnsStub=(pullSafe=()=>true)=>require('../../../runtime/characters/turns/install.ts').turnsRegistration({sources:{absorb:()=>undefined,support:()=>undefined,attack:()=>undefined,offense:()=>undefined,routine:()=>undefined},
  ready:()=>undefined,allows:()=>undefined,pullSafe,listeners:{}});
const character = () => {
  const { targetingRegistrations } = require('../../../runtime/characters/targeting/install.ts');
  const r = loaded();
  for (const x of [turnsStub(), ...targetingRegistrations]) assert.deepEqual(r.register(x), { ok: true }, x.name);
  return r;
};

const literal = s => s.replace(/[.]/g, '\\.');
// A question with no add-on answer: the registry refuses an add-on that answers it.
function noAddonAnswer(r, hook) {
  assert.match(r.register(addon('a-' + hook, { [hook]: () => undefined })).message, new RegExp(`answers "${literal(hook)}", which takes no add-on answer`));
}
// A question with one core answer, which a core registration already gives on `r`:
// the hook table declares it with one answer, and the registry refuses a second core answer and an
// add-on answer.
function oneCoreAnswer(r, hook) {
  const h = r.map().hooks.find(x => x.name === hook);
  assert.ok(h, `the hook table declares ${hook}`); assert.equal(h.answers, 'one', hook);
  assert.match(r.register({ name: 'core:second-' + hook, folder: 'core', author: 'e2e', summary: 'test', hooks: { [hook]: () => undefined } }).message,
    new RegExp(`both answer "${literal(hook)}", a question with one answer$`));
  noAddonAnswer(r, hook);
}

module.exports = { loaded, addon, character, turnsStub, entry, noAddonAnswer, oneCoreAnswer };
