const test=require('node:test'),assert=require('node:assert/strict');
const {fixture:workersFixture}=require('./helpers/coordinator-workers.cjs');
function fixture(){const calls=[],f=workersFixture({blocks:{},state:{activeRealm:'SR_USII',location:{realm:'SR_EUI'},headlessSlots:[null,null],lifecycle:{}},
 configuredRealm:'SR_USI',homeRealm:()=> 'SR_USII',script:name=>name+'.js',watch:(name,block)=>calls.push(['watch',name,block]),commit:by=>calls.push(['commit',by,f.state.headlessSlots.slice()])});
 return {workers:f.blocks,state:f.state,calls,service:f.manager};}
test('dormant worker setup selects native home and preserves version while replacing legacy watchers',()=>{
 const f=fixture();let closed=0;const block={realm:'SR_USIII',version:4,connected:1,code_watcher:{close:()=>closed++}};f.workers.M=block;
 assert.equal(f.service.ensure('M'),block);assert.equal(closed,1);assert.equal(block.code_watcher,null);assert.equal(block.realm,'SR_USII');assert.equal(block.version,4);assert.equal(block.connected,true);assert.equal(block.script,'M.js');
 f.service.ensure('M');assert.equal(closed,1);assert.equal(f.calls.length,2);
});

// MJ47: the worker connects the merchant to the realm owner's target and deletes no
// request; a party switch participant connects to the switch's realm.
test('MJ47: worker setup connects to the realm target and keeps the request',()=>{
 const {state,service}=fixture();
 state.merchantCharacter='M';state.merchantRealmRequests={M:{realm:'SR_EUI',owner:'job',requestedAt:1,attempts:1}};
 state.statuses={M:{server:'EUI',seenAt:Date.now()}};
 assert.equal(service.ensure('M').realm,'SR_EUI');
 assert.deepEqual(state.merchantRealmRequests.M,{realm:'SR_EUI',owner:'job',requestedAt:1,attempts:1});
 state.realmSwitch={phase:'retrying',realm:'SR_ASIAI',participants:['F','M']};
 assert.equal(service.ensure('F').realm,'SR_ASIAI');
 assert.equal(service.ensure('M').realm,'SR_EUI');
});
