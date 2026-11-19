const test=require('node:test'),assert=require('node:assert/strict'),{load,queryRoot}=require('./helpers/dashboard-query-module.cjs');
const React=require('../../dashboard/node_modules/react');
const {create,act}=require('../../dashboard/node_modules/react-test-renderer');
let calls=[],finish;
const action={isPending:false,error:null,reset(){},mutateAsync(value){calls.push(value);return new Promise(resolve=>{finish=resolve})}};
const compiled={exports:load('merchant-visit-control.tsx',{
 '@/components/ui/dialog':Object.fromEntries(['Dialog','DialogContent','DialogHeader','DialogTitle'].map(name=>[name,props=>React.createElement('section',props)])),
 '@/hooks/use-clock':{useClock:()=>100000},'./query-actions':{usePartyAction:()=>action}})};
global.IS_REACT_ACT_ENVIRONMENT=true;
const {domainOptions}=load('query-cache.tsx');
test('merchant picker excludes offline/merchant characters and queues one visit for repeated clicks',async()=>{
 let tree;const {client,wrap}=queryRoot(),original=global.fetch;
 // The coordinator's presence answer reaches the cache through query-cache's core read.
 const core={characterDetails:{M:{online:true},W:{online:true},P:{online:false}}};
 global.fetch=async()=>({ok:true,status:200,json:async()=>core,text:async()=>JSON.stringify(core)});
 try{await client.fetchQuery(domainOptions(client,'core'));}finally{global.fetch=original;}
 await act(async()=>{tree=create(wrap(React.createElement(compiled.exports.MerchantVisitControl,{merchant:'M',characters:[{name:'M',ctype:'merchant'},{name:'W',ctype:'warrior'},{name:'P',ctype:'priest'}]})))});
 const targets=tree.root.findAllByType('button').filter(b=>b.children.includes('W'));
 assert.equal(targets.length,1);assert.ok(!tree.root.findAllByType('button').some(b=>b.children.includes('P')));
 await act(async()=>{targets[0].props.onClick();targets[0].props.onClick()});
 assert.deepEqual(calls,[{path:'/command',body:{character:'W',type:'bank'}}]);
 await act(async()=>finish({ok:true}));
 assert.match(JSON.stringify(tree.toJSON()),/Merchant visit queued for W/);
 await act(async()=>tree.unmount());client.clear();
});
