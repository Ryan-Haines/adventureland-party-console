const test=require('node:test'),assert=require('node:assert/strict'),load=require('./helpers/dashboard-query-module.cjs');
const React=require('../../dashboard/node_modules/react');
const {create,act}=require('../../dashboard/node_modules/react-test-renderer');
const compiled={exports:load('merchant-cancel-job-control.tsx',{
 '@/components/ui/button':{Button:props=>React.createElement('button',props)},
 '@/components/ui/dialog':{
  Dialog:props=>props.open?React.createElement('section',props):null,
  ...Object.fromEntries(['DialogContent','DialogDescription','DialogFooter','DialogHeader','DialogTitle'].map(name=>[name,props=>React.createElement('section',props)]))}})};
global.IS_REACT_ACT_ENVIRONMENT=true;
test('automatic cancellation requires confirmation; dismissing leaves the routine alone and repeated confirms send once',async()=>{
 let tree,finish;const calls=[];
 await act(async()=>{tree=create(React.createElement(compiled.exports.MerchantCancelJobControl,{id:'job',reason:'auto compound',label:'Auto compound',onCancel:id=>{calls.push(id);return new Promise(resolve=>finish=resolve);}}));});
 const open=()=>tree.root.findByProps({'aria-label':'Cancel Auto compound'}).props.onClick();
 const button=label=>tree.root.findAllByType('button').find(b=>b.children.includes(label));
 await act(async()=>open());assert.deepEqual(calls,[]);
 assert.match(JSON.stringify(tree.toJSON()),/disable this routine until you re-enable it in Routines/);
 await act(async()=>button('Cancel').props.onClick());assert.deepEqual(calls,[]);assert.equal(button('Confirm'),undefined);
 await act(async()=>open());
 const confirm=button('Confirm').props.onClick;
 await act(async()=>{confirm();confirm();});assert.deepEqual(calls,['job']);
 assert.equal(button('Cancel').props.disabled,true);
 await act(async()=>finish());assert.equal(button('Confirm'),undefined);
 await act(async()=>tree.unmount());
});
test('manual compound cancellation does not claim to disable automatic routines',async()=>{
 let tree;const calls=[];
 await act(async()=>{tree=create(React.createElement(compiled.exports.MerchantCancelJobControl,{id:'manual',reason:'manual compounds',label:'Manual compounds',onCancel:async id=>calls.push(id)}));});
 await act(async()=>tree.root.findByProps({'aria-label':'Cancel Manual compounds'}).props.onClick());
 assert.deepEqual(calls,['manual']);assert.doesNotMatch(JSON.stringify(tree.toJSON()),/disable this routine/);
 await act(async()=>tree.unmount());
});
