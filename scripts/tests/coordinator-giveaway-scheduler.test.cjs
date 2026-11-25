const {withDoor}=require('./helpers/coordinator-merchant.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {createGiveawayScheduler}=require('../../runtime/merchant-jobs/coordinator/sources.ts');
const {realmRefusal}=require('../../runtime/merchant-realm/rules.ts');
// The realm owner's refusal over the fixture's blacklist (application.ts hands merchantRealm.refuses).
function fixture(blacklist=[]){const state={merchantCharacter:'M',merchantAutomations:{},merchantCurrent:null,merchantQueue:[]},logs=[];let id=0;
 const service=createGiveawayScheduler(state,withDoor(state,{now:()=>100,nextCommand:()=>++id,stamp:job=>({...job,priority:5}),log:(...args)=>logs.push(args),
  realmRefuses:realm=>!!realmRefusal('job',realm,blacklist)}));
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
// An ALData offer ends at the sighting plus its giveaway minutes; a sighting whose giveaway already ended is skipped.
test('ALData candidates expire at the sighting plus giveaway minutes, require safe realms, obtain rid live, and retain deduplication across restart',()=>{
 const f=fixture();const merchant={id:'S',lastSeen:new Date(1000).toISOString(),map:'main',x:1,y:2,serverRegion:'EU',serverIdentifier:'II',slots:{trade1:{name:'ring',level:2,giveaway:3}}};
 f.service.scheduleMarket([merchant,{...merchant,id:'P',serverIdentifier:'PVP'},{...merchant,id:'old',lastSeen:new Date(-200000).toISOString()}]);
 assert.equal(f.state.merchantQueue.length,1);const job=f.state.merchantQueue[0];assert.equal(job.realm,'SR_EUII');assert.equal(job.rid,undefined);assert.equal(job.expectedItem.level,2);assert.equal(job.expiresAt,1000+3*60_000);
 f.state.merchantQueue=[];f.service.scheduleMarket([merchant]);assert.equal(f.state.merchantQueue.length,0);
 const restarted=createGiveawayScheduler(f.state,withDoor(f.state,{now:()=>1000,nextCommand:()=>2,stamp:j=>j,log(){},realmRefuses:()=>false}));restarted.scheduleMarket([merchant]);assert.equal(f.state.merchantQueue.length,0);
});
// The giveaway asks the realm owner's one refusal, so a blacklisted realm is refused as a PVP
// one is, and no PVP test of its own runs here.
test('a giveaway on a realm the realm owner refuses is not queued',()=>{
 const f=fixture(['SR_EUII']);f.service.schedule({server:'EUII',nearbyGiveaways:[offer]});f.service.schedule({server:'USPVP',nearbyGiveaways:[offer]});
 assert.deepEqual(f.state.merchantQueue,[]);
 f.service.schedule({server:'USII',nearbyGiveaways:[offer]});assert.equal(f.state.merchantQueue.length,1);
});
// The character reports a found giveaway's minutes, not its end, so the job had no end and
// `Number(undefined) < now` never dropped it.
test('a self-found giveaway ends at its minutes, and its claim ends with it',()=>{
 const f=fixture();f.service.schedule({server:'USII',nearbyGiveaways:[offer]});
 const job=f.state.merchantQueue[0];
 assert.equal(job.expiresAt,100+2*60_000);
 assert.ok(Number(job.expiresAt)<100+2*60_000+1,'the dispatcher\'s expiry test drops it after its end');
 assert.deepEqual(Object.values(f.state.giveawayAttempts),[job.expiresAt]);
});

// (issue #129), the job half: the giveaway job carries the host's position from the sighting,
// so a host away from the market and a merchant that starts in the bank both get a command that
// names the host's spot. The walk to it is the character's executor.
test('a giveaway job names the host away from the market, and a merchant in the bank gets the same command',()=>{
 const {ownMerchantCommand}=require('../../runtime/merchant-jobs/coordinator/commands.ts');
 const inputs={merchant:'M',activeRealm:'SR_USII',aldataKey:'',threshold:0,gatheringModes:[],cargo:null,npcSales:[],standListings:[],statScrolls:{},
  workingGold:0,visitWithdrawals:()=>[],work:()=>({withdrawals:[],marked:[],goldTarget:0}),restock:()=>null};
 const away={...offer,rid:'away',map:'winterland',x:'812',y:'-640'};
 for(const merchantMap of ['main','bank']){
  const f=fixture();f.service.schedule({server:'USII',map:merchantMap,nearbyGiveaways:[away]});
  const job=f.state.merchantQueue[0];assert.deepEqual(job.location,{map:'winterland',x:812,y:-640});
  const command=ownMerchantCommand(1,job,inputs);
  assert.deepEqual([command.type,command.seller,command.location],['merchant-join-giveaway','Seller',{map:'winterland',x:812,y:-640}]);
 }
});
// The join asks the job band, then visits.ts sends join_giveaway itself. A job that stops being
// the intake's current command during the band wait ends the wait with no join.
test('the giveaway join asks the job band before join_giveaway, and a cancelled job joins nothing',async()=>{
 const {createMerchantVisits}=require('../../runtime/merchant-jobs/character/visits.ts');
 const host={name:'Host',map:'main',x:0,y:0,slots:{trade1:{name:'ring',giveaway:1,rid:'r1',list:[]}}};
 const run=async(answers,current)=>{
  const calls=[],previous=[globalThis.__partyHooks,globalThis.join_giveaway];
  globalThis.__partyHooks={calls:{band:ask=>{calls.push('band '+ask.band+' '+ask.method);return answers.shift()},window:()=>0},notify(){}};
  globalThis.join_giveaway=(seller,slot,rid)=>calls.push('join '+seller+' '+slot+' '+rid);
  const visits=createMerchantVisits({character:()=>({name:'M',map:'main',x:0,y:0}),player:()=>host,walk:async()=>{},sleep:async()=>{},untilGame:async(events,done)=>done(),
   hop:()=>({liveRealm:()=>'EU I'}),market:()=>({map:'main',x:0,y:0}),log(){},current,lastCommand:()=>'c1',
   request:async(url,options)=>{calls.push(url+' '+options.body.success)}});
  try{await visits.merchantJoinGiveaway({id:'c1',jobId:'g',seller:'Host'});}finally{[globalThis.__partyHooks,globalThis.join_giveaway]=previous;}
  return calls;
 };
 assert.deepEqual(await run(['wait','send'],()=>true),['band job join_giveaway','band job join_giveaway','join Host trade1 r1','/merchant/complete true']);
 let live=2;
 assert.deepEqual(await run(['wait','wait','wait','send'],()=>live-- > 0),['band job join_giveaway','band job join_giveaway','band job join_giveaway']);
});
