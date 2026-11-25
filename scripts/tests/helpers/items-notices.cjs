// The items owner's notices as a reader hears them (records.ts `recordItems`): one core listener
// on the console's registry hears every `items.*` notice row of runtime/hooks/rows/10-items.ts.
const {partyHooks}=require('../../../runtime/hooks/index.ts');
const {HOOKS}=require('../../../runtime/hooks/rows/10-items.ts');
const NAME='core:items-notices-fixture',heard=[];
function listen(){
  if(partyHooks().map().registrations.some(r=>r.name===NAME)) return;
  const notices=Object.keys(HOOKS).filter(name=>HOOKS[name].kind==='notice');
  partyHooks().register({name:NAME,folder:'core',author:'test',summary:"Hears the items owner's notices.",
    hooks:Object.fromEntries(notices.map(name=>[name,payload=>heard.push(payload)]))});
}
// The notices about one subject sent after this call, oldest first.
exports.itemsSince=subject=>{listen();const from=heard.length;return ()=>heard.slice(from).filter(entry=>entry.subject===subject);};
