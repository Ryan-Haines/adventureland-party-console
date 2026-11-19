// A test's own hook registry. partyHooks() keeps one registry per realm on
// globalThis.__partyHooks (runtime/hooks/index.ts), so a registration a test planted there stayed
// for every later test of the process. testRegistry gives the test a new registry holding a copy of
// each registration the process has so far (the console's, and those a fixture module published at
// load), and t.after puts the process's registry back, so the test's registrations end with it.
const {partyHooks}=require('../../../runtime/hooks/index.ts');
const {createRegistry}=require('../../../runtime/hooks/registry.ts');

function testRegistry(t){
 const before=partyHooks(),hooks=createRegistry();
 // Each copy has its own hook table, since a later publish assigns into the registered one.
 for(const r of before.registrations())hooks.register({...r,hooks:{...r.hooks}});
 globalThis.__partyHooks=hooks;
 t.after(()=>{globalThis.__partyHooks=before;});
 return hooks;
}

// The merchant jobs owner's `jobs.ready` on the test's registry, answering the list the test sets.
function jobsReady(t,ready=[]){
 let list=ready;
 const ok=testRegistry(t).register({name:'test:jobs-ready',folder:'core',author:'test',summary:'Answers jobs.ready with the test\'s list.',
  hooks:{'jobs.ready':()=>list}}).ok;
 if(!ok)throw Error('test:jobs-ready did not register');
 return {set(next){list=next;}};
}

module.exports={testRegistry,jobsReady};
