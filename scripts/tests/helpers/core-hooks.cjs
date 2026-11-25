// A core test that registers its own add-on runs on a realm registry of the core registrations only
// (core tests hold with any add-on installed). An installed add-on that
// answers the same one-answer hook would refuse the test's add-on in a registry that loads the
// installed list. A test file requires this helper before any runtime module, so partyHooks() and
// every owner install find this registry on `globalThis`.
const {createRegistry}=require('../../../runtime/hooks/registry.ts');

if(globalThis.__partyHooks)throw Error('helpers/core-hooks.cjs is required after the realm registry was built; require it first');
const registry=globalThis.__partyHooks=createRegistry();
require('../../../runtime/hooks/core.ts').registerConsole(registry,[]);
module.exports={registry};
