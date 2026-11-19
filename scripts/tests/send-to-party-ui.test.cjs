const test=require('node:test'),assert=require('node:assert/strict'),load=require('./helpers/dashboard-query-module.cjs');
const React=require('../../dashboard/node_modules/react');
const {create,act}=require('../../dashboard/node_modules/react-test-renderer');
let calls=[],finish;
const action={isPending:false,error:null,reset(){},mutateAsync(value){calls.push(value);return new Promise(resolve=>{finish=resolve})}};
const compiled={exports:load('send-to-party-control.tsx',{
 '@/components/ui/dialog':Object.fromEntries(['Dialog','DialogContent','DialogHeader','DialogTitle'].map(name=>[name,props=>React.createElement('section',props)])),
 '@/hooks/use-clock':{useClock:()=>100000},'./query-actions':{usePartyAction:()=>action}})};
global.IS_REACT_ACT_ENVIRONMENT=true;
test('one group sends all members directly; independent groups require a choice',async()=>{
 let tree;const sent=[];
 const state={leader:'L',followers:{F:true},merchantCharacter:'M',characters:{L:{name:'L',seenAt:99999},F:{name:'F',seenAt:99999},M:{name:'M',seenAt:99999}}};
 const onSend=async group=>{sent.push(group)};
 await act(async()=>{tree=create(React.createElement(compiled.exports.SendToPartyControl,{state,onSend}))});
 const send=()=>tree.root.findAllByType('button').find(button=>button.children.includes('Send to party'));
 await act(async()=>send().props.onClick());assert.deepEqual(sent,['L']);
 state.followers.F=false;
 await act(async()=>tree.update(React.createElement(compiled.exports.SendToPartyControl,{state,onSend})));
 await act(async()=>send().props.onClick());assert.deepEqual(sent,['L']);
 const choice=tree.root.findAllByType('button').find(button=>button.children.includes('F'));
 await act(async()=>choice.props.onClick());assert.deepEqual(sent,['L','F']);
 assert.ok(!tree.root.findAllByType('button').some(button=>button.children.includes('M')));
 await act(async()=>tree.unmount());
});
for (const characters of [{L:{name:'L',seenAt:0},F:{name:'F'},M:{name:'M'}},{}])
test('manual send remains enabled with stale or missing presence: '+Object.keys(characters).join(','),async()=>{
 let tree,complete;const sent=[];
 const state={leader:'L',followers:{F:true},merchantCharacter:'M',characters,merchantCurrent:{id:'busy'}};
 const onSend=group=>{sent.push(group);return new Promise(resolve=>{complete=resolve;});};
 await act(async()=>{tree=create(React.createElement(compiled.exports.SendToPartyControl,{state,onSend}));});
 const send=()=>tree.root.findAllByType('button').find(button=>button.children.includes('Send to party'));
 assert.equal(send().props.disabled,false);
 await act(async()=>{send().props.onClick();send().props.onClick();});
 assert.deepEqual(sent,[Object.keys(characters).length?'L':undefined]);
 assert.equal(send().props.disabled,true);
 await act(async()=>complete());assert.equal(send().props.disabled,false);
 await act(async()=>tree.unmount());
});
