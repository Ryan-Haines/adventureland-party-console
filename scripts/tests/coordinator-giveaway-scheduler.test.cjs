const test=require('node:test'),assert=require('node:assert/strict');
const {createGiveawayScheduler}=require('../../runtime/coordinator/merchant/giveaway-scheduler.ts');
function fixture(){const state={merchantCharacter:'M',merchantAutomations:{},merchantCurrent:null,merchantQueue:[]},logs=[];let id=0;
 const service=createGiveawayScheduler(state,{now:()=>100,nextCommand:()=>++id,stamp:job=>({...job,priority:5}),log:(...args)=>logs.push(args)});
 return {state,logs,service};}
const offer={seller:'Seller',slot:'trade1',rid:'offer',map:'main',x:'12',y:'-3',item:{name:'ring'},minutes:2};
test('giveaway discovery stamps one job per seller and offer, preserving location and log details',()=>{
 const f=fixture();f.service.schedule({server:'USII',nearbyGiveaways:[offer,offer]});
 assert.equal(f.state.merchantQueue.length,1);assert.equal(f.state.merchantQueue[0].realm,'SR_USII');
 assert.deepEqual(f.state.merchantQueue[0].location,{map:'main',x:12,y:-3});assert.equal(f.state.merchantQueue[0].priority,5);
 assert.deepEqual(f.logs[0][2],{item:'ring',slot:'trade1',minutes:2});
 f.service.schedule({nearbyGiveaways:[{...offer,rid:'new'}]});assert.equal(f.state.merchantQueue.length,2);assert.equal(f.state.merchantQueue[1].realm,null);
});
test('already entered, malformed, and active giveaway offers are skipped',()=>{
 const f=fixture();f.state.merchantCurrent={reason:'join giveaway',seller:'Seller',rid:'offer'};
 f.service.schedule({nearbyGiveaways:[offer,null,{...offer,rid:''},{...offer,rid:'joined',entrants:['M']}]});
 assert.deepEqual(f.state.merchantQueue,[]);assert.deepEqual(f.logs,[]);
 f.state.merchantCurrent.reason='other';f.service.schedule({nearbyGiveaways:[offer]});assert.equal(f.state.merchantQueue.length,1);
});
test('disabled giveaway discovery and absent reports leave queues untouched',()=>{
 const f=fixture();f.state.merchantAutomations['join giveaway']=false;f.service.schedule({nearbyGiveaways:[offer]});
 f.state.merchantAutomations={};f.service.schedule(null);f.service.schedule({});assert.deepEqual(f.state.merchantQueue,[]);
});
test('ALData candidates require freshness and safe realms, obtain rid live, and retain deduplication across restart',()=>{
 const f=fixture();const merchant={id:'S',lastSeen:new Date(1000).toISOString(),map:'main',x:1,y:2,serverRegion:'EU',serverIdentifier:'II',slots:{trade1:{name:'ring',level:2,giveaway:3}}};
 f.service.scheduleMarket([merchant,{...merchant,id:'P',serverIdentifier:'PVP'},{...merchant,id:'old',lastSeen:new Date(-200000).toISOString()}]);
 assert.equal(f.state.merchantQueue.length,1);const job=f.state.merchantQueue[0];assert.equal(job.realm,'SR_EUII');assert.equal(job.rid,undefined);assert.equal(job.expectedItem.level,2);
 f.state.merchantQueue=[];f.service.scheduleMarket([merchant]);assert.equal(f.state.merchantQueue.length,0);
 const restarted=createGiveawayScheduler(f.state,{now:()=>1000,nextCommand:()=>2,stamp:j=>j,log(){}});restarted.scheduleMarket([merchant]);assert.equal(f.state.merchantQueue.length,0);
});
