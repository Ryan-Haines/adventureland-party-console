const test=require('node:test'),assert=require('node:assert/strict');
const {installQueueClient}=require('../../runtime/combat/client.ts');
const {createHandoffTiming}=require('../../runtime/combat/handoff-timing.ts');
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
async function fixture(run){
 const keys=['parent','character','get_entity','setInterval','clearInterval'];
 const saved=Object.fromEntries(keys.map(k=>[k,global[k]])),dateNow=Date.now;
 let now=1000,group=null,sequence=0,enabled=true;
 const pending=[],root={},deaths=[];
 Object.assign(global,{parent:{},character:{name:'W',map:'cave',in:'cave'},get_entity:()=>null,setInterval:()=>1,clearInterval(){}});
 Date.now=()=>now;
 const shared={usesGroupedCombat:()=>enabled,queueMembers:()=>enabled?['W']:[],sharedTargetId:()=>null,queueClockOffset:()=>0,
  acceptQueue:g=>{group=g;root.__partyGroupedCombat=g;},
  queueAcknowledgement:()=>({groupedCombat:{ack:group?.selection,queueAck:group?.queueRevision}}),
  queueReport:()=>({server:'USII',travelSample:{sequence:++sequence},groupedCombat:{ack:group?.selection,queueAck:group?.queueRevision,deaths:[...deaths]}}),
  queueRequest:body=>new Promise((resolve,reject)=>pending.push({body,resolve,reject}))};
 const client=installQueueClient(root,shared);
 const response=(g=group)=>({groupedCombat:g,combatRevision:g?.selection||'empty'});
 try{await run({client,root,deaths,pending,response,reports:()=>pending.filter(r=>r.body.combatOnly),waits:()=>pending.filter(r=>r.body.combatWait),now:v=>now=v,disable:()=>enabled=false});}
 finally{client.stop();Date.now=dateNow;Object.assign(global,saved);}
}
test('death while report is in flight flushes the newest state immediately and coalesces changes',()=>fixture(async f=>{
 f.client.tick();assert.equal(f.reports().length,1);
 f.deaths.push({id:'A',at:1000});f.client.flush();f.deaths.push({id:'B',at:1000});f.client.flush();
 assert.equal(f.reports().length,1);
 f.reports()[0].resolve(f.response());await settle();
 assert.equal(f.reports().length,2);assert.deepEqual(f.reports()[1].body.groupedCombat.deaths.map(d=>d.id),['A','B']);
 f.reports()[1].resolve(f.response());await settle();assert.equal(f.reports().length,2,'no response echo loop');
}));
test('new queue acknowledgement is sent immediately and successful long poll is rearmed',()=>fixture(async f=>{
 f.client.tick();f.reports()[0].resolve(f.response());await settle();
 const g={selection:'B',queueRevision:'B,C,D',target:{id:'B'},committed:true};
 f.waits()[0].resolve(f.response(g));await settle();
 assert.equal(f.reports().length,2);assert.equal(f.reports()[1].body.groupedCombat.ack,'B');
 assert.equal(f.reports()[1].body.groupedCombat.queueAck,'B,C,D');
 assert.equal(f.waits().length,2);assert.equal(f.waits()[1].body.combatRevision,'B');
 f.reports()[1].resolve(f.response(g));await settle();assert.equal(f.reports().length,2);
}));
test('acknowledgement received during an in-flight report follows it without another poll tick',()=>fixture(async f=>{
 f.client.tick();const g={selection:'B',queueRevision:'B,C',target:{id:'B'},committed:false};
 f.waits()[0].resolve(f.response(g));await settle();assert.equal(f.reports().length,1);
 f.reports()[0].resolve(f.response(g));await settle();
 assert.equal(f.reports().length,2);assert.equal(f.reports()[1].body.groupedCombat.ack,'B');
 assert.equal(f.root.__partyHandoffTrace.find(e=>e.stage==='report').sequence,1);
}));
test('report and long poll errors retain backoff despite dirty events',()=>fixture(async f=>{
 f.client.tick();f.client.flush();f.reports()[0].reject(Error('offline'));f.waits()[0].reject(Error('offline'));await settle();
 f.now(1999);f.client.flush();assert.equal(f.pending.length,2);
 f.now(2000);f.client.tick();assert.equal(f.reports().length,2);assert.equal(f.waits().length,2);
}));
test('stopped or disabled clients do not restart transport from a late response',()=>fixture(async f=>{
 f.client.tick();f.client.flush();f.client.stop();
 f.reports()[0].resolve(f.response());f.waits()[0].resolve(f.response());await settle();assert.equal(f.pending.length,2);
}));
test('leaving combat does not rearm a completed long poll',()=>fixture(async f=>{
 f.client.tick();f.disable();f.waits()[0].resolve(f.response());await settle();assert.equal(f.waits().length,1);
}));
test('handoff timing preserves local times, ignores old-target results, and stays bounded',()=>{
 let now=100;const entries=[],t=createHandoffTiming(entries,()=>now);
 t.death('A');t.death('A');now=120;t.selection({selection:'B:1',target:{id:'B'},committed:true,handoffTiming:{selectedAt:99999}});
 t.attack('blocked','B',{reason:'cooldown'});t.attack('blocked','B',{reason:'cooldown'});
 now=180;t.attack('attempt','B',{cooldownReadyAt:180});t.attack('attempt','B',{});
 t.attack('accepted','A',{});t.attack('accepted','B',{});t.attack('attempt','B',{});
 assert.deepEqual(entries.map(e=>e.stage),['death','selection','committed','blocked','attempt','accepted']);
 assert.equal(entries[4].at-entries[0].at,80);
 for(let i=0;i<300;i++)t.event('timer',{sequence:i});assert.equal(entries.length,256);
});
