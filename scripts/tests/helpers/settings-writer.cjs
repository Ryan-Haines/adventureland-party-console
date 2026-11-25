// The real settings writer (runtime/settings/coordinator/writer.ts) over a test's own state, for
// the route tests that write settings through it.
// `saves` counts each document save, `notices` each settings.changed notice. `scope` gives a
// character's own farming profile, which a scoped setting written for that character lands in.
// `names` maps a declared field to the name a route's view state gives it (the merchant routes read
// `merchant`, `modes`, `priorities` and `automations`, http/merchant-configuration.ts), so the
// writer writes the view the route reads.
const {createSettingsWriter}=require('../../../runtime/settings/coordinator/writer.ts');
const {createRegistry}=require('../../../runtime/hooks/registry.ts');
const {coreRegistrations,addonSwitches}=require('../../../runtime/hooks/core.ts');
// A registry with the console's own registrations, so the slot fields take their core entries.
function coreRegistry(){const r=createRegistry();for(const c of [...coreRegistrations,addonSwitches(r)])r.register(c);return r;}
const merchantViewNames={merchantCharacter:'merchant',gatheringModes:'modes',merchantRoutinePriorities:'priorities',merchantAutomations:'automations',merchantQueue:'queue'};
// `fighters`, `monsters` and `items` answer an add-on setting's character, monsters and items checks;
// `spawns` is the spawn catalog a declared check reads. Each game data port is null before the
// data loads, as the install's are.
function settingsWriter(view,{owned=()=>true,hooks=coreRegistry(),scope,names,fighters=()=>[],monsters=()=>null,items=()=>null,spawns=()=>null}={}){
  const state=names?new Proxy(view,{get:(t,k)=>t[names[k]??k],set:(t,k,v)=>{t[names[k]??k]=v;return true;}}):view;
  scope??=()=>state;
  const saves=[],notices=[];
  const writer=createSettingsWriter(state,{hooks:{entries:slot=>hooks.entries(slot),registrations:()=>hooks.registrations(),notify:(hook,payload)=>{notices.push(payload);return hooks.notify(hook,payload);}},
    owned,fighters,monsters,items,spawns,scope,persist:document=>saves.push(document),history(){},now:()=>Date.now(),app:()=>undefined});
  // The registry's two settings requests answer through this writer, as the install registers them.
  if(!hooks.registrations().some(r=>r.name==='core:settings'))hooks.register({name:'core:settings',folder:'core',author:'test',summary:'test',hooks:{'settings.write':writer.write,'settings.read':writer.read}});
  return {write:batch=>writer.write(batch),read:query=>writer.read(query),saves,notices};
}
module.exports={settingsWriter,merchantViewNames};
