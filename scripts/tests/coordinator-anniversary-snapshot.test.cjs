const test=require('node:test');
const assert=require('node:assert/strict');
const {createAnniversarySnapshot}=require('../../runtime/coordinator/anniversary/snapshot.ts');
function fixture(){
 const state={nativeSlice:'slice_nightberry',eventCycle:{id:'cycle',target:null,endsAt:0},abortedRounds:{},partyHold:null,rounds:{},
  attempts:{},returnDestination:null,chatAdvertisement:null,activity:[],crafted:0,advertisedRounds:{}};
 const statuses={P:{seenAt:100,server:'USII'},M:{seenAt:100,server:'USII'}},effects=[];
 const ports={now:()=>100,counts:()=>({slice_nightberry:12}),statuses:()=>statuses,leader:()=> 'P',merchant:()=> 'M',follower:name=>name==='W',
  enabled:()=>true,owned:name=>['P','W','M'].includes(name),realm:()=>undefined,log:(...args)=>effects.push(args),persist:()=>effects.push('persist')};
 return {state,statuses,effects,ports,snapshot:createAnniversarySnapshot(state,ports).snapshot};
}

test('complete slice sets never authorize automatic cake crafting',()=>{
 const f=fixture();const {anniversarySlices}=require('../../runtime/coordinator/anniversary/contracts.ts');
 f.ports.counts=()=>Object.fromEntries(anniversarySlices.map(name=>[name,3]));
 const snapshot=f.snapshot();assert.equal(snapshot.completeSets,3);assert.equal(snapshot.craftReady,false);
});
test('anniversary live feed updates and logs a featured round once, preferring the leader realm',()=>{
 const f=fixture();f.statuses.P.anniversaryServer={active:true,live:true,target:'P',round:1,expires:5000};
 f.statuses.X={seenAt:100,server:'EUI',eventFeedAt:200,anniversaryServer:{active:true,live:true,target:'X',round:2,expires:9000}};
 const result=f.snapshot();assert.equal(result.live.target,'P');assert.equal(result.partyFeatured,true);
 assert.equal(f.state.eventCycle.endsAt,5000);assert.deepEqual(f.effects,[['P was selected for the anniversary kiss','featured'],'persist','persist']);
 f.snapshot();assert.equal(f.effects.length,3);f.state.abortedRounds['1']={};assert.equal(f.snapshot().partyFeatured,false);
});
test('inventory recovers missed slice callbacks while completed handoffs and claimed duplicates remain excluded',()=>{
 const f=fixture();f.state.rounds.old={claims:{P:{slice:'slice_citrus'},W:{slice:'slice_honey',handedOff:true}}};
 f.statuses.P.items=[{item:{name:'slice_citrus',q:1}},{item:{name:'slice_mint',q:1}}];
 f.statuses.W={seenAt:100,items:[{item:{name:'slice_honey',q:1}}]};
 const targets=f.snapshot().handoffTargets;
 assert.deepEqual(targets.map(entry=>[entry.name,entry.round,entry.slice]),[['P','old','slice_citrus'],['P','recovered','slice_mint']]);
});
test('trade limits reserve complete sets and advertisements use the merchant realm and requested flavor',()=>{
 const f=fixture(),result=f.snapshot();assert.equal(result.completeSets,0);assert.equal(result.tradeLimits.slice_citrus,2);
 assert.ok(result.message.startsWith('Anniversary trade — Realm: US II. M trades Nightberry'));
 assert.ok(result.chatMessage.includes('send_item("M",character.items.findIndex(i=>i&&i.name==="slice_strawberry"),1);'));
});

test('handoffs exclude bank merchants, disabled, stale, dead and unowned holders even with claims',()=>{
 for(const mode of ['merchant','disabled','stale','dead','unowned','empty']){
  const f=fixture();
  f.statuses.P.items=[{item:{name:'slice_citrus',q:1}}];
  f.state.rounds.old={claims:{P:{slice:'slice_citrus'}}};
  if(mode==='merchant')f.statuses.P.ctype='merchant';
  if(mode==='disabled')f.ports.enabled=()=>false;
  if(mode==='stale')f.statuses.P.seenAt=-10001;
  if(mode==='dead')f.statuses.P.rip=true;
  if(mode==='unowned')f.ports.owned=()=>false;
  if(mode==='empty')f.statuses.P.items=[];
  assert.deepEqual(f.snapshot().handoffTargets,[],mode);
 }
});

test('fresh fighter handoffs carry freshness and remain available between events',()=>{
 const f=fixture();f.statuses.P.ctype='priest';
 f.statuses.P.items=[{item:{name:'slice_citrus',q:1}}];
 const [target]=f.snapshot().handoffTargets;
 assert.equal(target.name,'P');assert.equal(target.seenAt,100);assert.equal(target.ctype,'priest');
});
