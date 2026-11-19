const {test}=require('node:test'),assert=require('node:assert/strict'),{load,queryRoot}=require('./helpers/dashboard-query-module.cjs');
const React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
const {ConsoleUpdateSettings,ConsoleUpdateIndicator}=load('console-updates.tsx',{'@/components/ui/button':{Button:'Button'}});
// The status read answers after the first render; `settle` lets React Query deliver it.
const settle=()=>act(()=>new Promise(resolve=>setTimeout(resolve,0)));
const text=n=>typeof n==='string'?n:(n.children||[]).map(text).join('');
test('release notification is accessible, opens settings, and staged updates offer Restart now',async()=>{
 const old=global.fetch,calls=[],state={current:'1.0.0',available:'1.1.0',managed:true,automatic:false,phase:'ready'};
 global.fetch=async(url,options)=>{calls.push([url,options]);return {ok:true,status:200,text:async()=>JSON.stringify(state)};};
 let view;const {wrap}=queryRoot();
 try{
  await act(async()=>{view=create(wrap(React.createElement(ConsoleUpdateSettings)));});await settle();
  assert.match(text(view.root),/Installed version: 1.0.0/);assert.match(text(view.root),/New release available: 1.1.0/);
  const restart=view.root.findAllByType('Button').find(n=>text(n)==='Restart now');assert.ok(restart);
  await act(async()=>restart.props.onClick());assert.equal(calls.at(-1)[0],'/console-update/restart');
  const checkbox=view.root.findByType('input');assert.equal(checkbox.props.checked,false);
  await act(async()=>checkbox.props.onChange({target:{checked:true}}));assert.deepEqual(JSON.parse(calls.at(-1)[1].body),{automatic:true});
  await act(async()=>view.unmount());view=null;
  await act(async()=>{view=create(wrap(React.createElement(ConsoleUpdateIndicator,{open(){}})));});await settle();
  assert.equal(view.root.findByType('button').props.title,'New version available');assert.equal(view.root.findByType('button').props['aria-label'],'New version available');
 }finally{if(view)await act(async()=>view.unmount());global.fetch=old;}
});
test('development checkouts expose version and check controls without installation',async()=>{
 const old=global.fetch;global.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({current:'development',available:'1.0.0',managed:false,automatic:false,phase:'available'})});let view;
 try{await act(async()=>{view=create(queryRoot().wrap(React.createElement(ConsoleUpdateSettings)));});await settle();assert.equal(view.root.findByType('input').props.disabled,true);const buttons=view.root.findAllByType('Button').map(text);assert.ok(buttons.includes('Check now'));assert.ok(!buttons.includes('Download and install update'));assert.ok(!buttons.includes('Restart now'));assert.match(text(view.root),/Development checkout/);}
 finally{if(view)await act(async()=>view.unmount());global.fetch=old;}
});
