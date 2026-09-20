const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorStatusIngestion}=require('../../runtime/coordinator/status/composition.ts');
function fixture(extra={}){
 const state={statuses:{},headlessSlots:[],steamMembers:[],steamSwitch:null,nativeOwner:null,merchantCharacter:'M',leader:'F',
  monsterHunt:{phase:'before'},aldata:{auth:'CORRECT',publishedAt:0},scatterMonsterTypes:[],scatterEpoch:1,scatterBreakTarget:null,
  partyFarmingMode:'default',partyFarmingMonsterType:null,farmingPolicy:'automatic'};
 const calls=[],workers={M:{}},bank={snapshot:null,observer:null};let now=10000000;
 const service=createCoordinatorStatusIngestion(state,workers,{
  now:()=>now,owned:name=>name==='F',persistRoster:()=>calls.push('roster'),itemKey:item=>item.name,
  observePonty:report=>calls.push(['ponty',report]),bankState:bank,
  bankPorts:{now:()=>now,adoptReservedCargo:()=>calls.push('adopt'),persist:()=>calls.push('bank')},
  merchant:()=>calls.push('merchant'),groupedCombat:()=>calls.push('combat'),rareReport:(name,report)=>{assert.equal(report,state.statuses[name]);calls.push('rare');},
  rareTick:()=>calls.push('rareTick'),bankboi:()=>calls.push('bankboi'),anniversary:()=>calls.push('anniversary'),
  huntTick:()=>{state.monsterHunt={phase:'after'};calls.push('hunt');},farmAreaTick:()=>calls.push('farm'),persist:()=>calls.push('persist'),
  abtesting:()=>calls.push('abtesting'),activeNames:()=>Object.keys(state.statuses),events:()=>calls.push('events'),publish:()=>calls.push('publish'),
  convoyStep:()=>{calls.push('convoy');return false;},merchantScheduling:(body,previous)=>calls.push(['schedule',body.name,previous]),
  response:name=>({name}),...extra,
 });
 function invoke(body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};service.handle({body},res);return res;}
 return {state,calls,workers,bank,invoke,time:value=>{now=value;}};
}

test('status consumers strip discovery payloads and preserve bank, combat and scheduling order',()=>{
 const t=fixture();t.state.statuses.F={name:'F',farmingMonsterType:'bat'};
 const body={name:'M',server:'USII',travelPlaces:['main'],monsterHunterLocation:{map:'main',x:'1',y:'2'},
  bankVaults:['items0'],bank:{packs:{items0:[]}},oneShotEpoch:1,oneShotMonsterTypes:['bat'],
  ponty:{updatedAt:123,listings:[{rid:'r',item:{name:'helmet'},price:20}]}};
 assert.equal(t.invoke(body).code,200);
 assert.deepEqual(t.state.travelPlaces,['main']);assert.deepEqual(t.state.bankVaults,['items0']);
 assert.deepEqual(t.state.monsterHunterLocation,{map:'main',x:1,y:2});
 for(const key of ['travelPlaces','monsterHunterLocation','bankVaults','bank','oneShotEpoch','oneShotMonsterTypes','ponty'])assert.equal(key in body,false,key);
 assert.equal(t.bank.snapshot.character,'M');assert.equal(t.bank.observer,'M');
 assert.equal(t.state.partyFarmingMonsterType,'bat');assert.equal(t.state.partyFarmingMode,'scatter');
 assert.equal(t.state.scatterPartySignature,'F');
 assert.deepEqual(t.calls.map(call=>Array.isArray(call)?call[0]:call),
  ['ponty','adopt','bank','merchant','combat','rare','rareTick','bankboi','anniversary','hunt','farm','persist','abtesting','events','publish','convoy','schedule']);
 assert.equal(t.calls[0][1].listings[0].key,'US:II:r');assert.equal(t.calls.at(-1)[2],false);
});

test('rare ownership keeps the coordinator grouped across fighter and merchant heartbeats',()=>{
 let owns=true;
 const t=fixture({rareOwns:name=>{assert.equal(name,'F');return owns;}});
 t.state.farmingPolicy='hunt';t.state.scatterMonsterTypes=['minimush'];
 t.invoke({name:'F',farmingMonsterType:'minimush'});
 assert.equal(t.state.partyFarmingMode,'default');
 t.invoke({name:'M'});
 assert.equal(t.state.partyFarmingMode,'default');
 owns=false;t.invoke({name:'F',farmingMonsterType:'minimush'});
 assert.equal(t.state.partyFarmingMode,'scatter','normal Hunt scatter resumes after the rare owner releases');
});

test('market publication uses current merchant authentication and the strict hourly boundary',()=>{
 const t=fixture();t.state.merchantCharacter='New';t.workers.New={};t.state.aldata={auth:'CORRECT',publishedAt:10000000};
 t.time(13600000);t.invoke({name:'New'});assert.equal(t.calls.includes('publish'),false);
 t.time(13600001);t.invoke({name:'M'});assert.equal(t.calls.includes('publish'),false);
 t.invoke({name:'New'});assert.equal(t.calls.filter(call=>call==='publish').length,1);
 t.state.aldata={auth:'NO',publishedAt:0};t.invoke({name:'New'});assert.equal(t.calls.filter(call=>call==='publish').length,1);
});

test('status ownership accepts newly managed workers and owned characters but rejects inherited registry names',()=>{
 const t=fixture();assert.equal(t.invoke({name:'toString'}).code,400);assert.deepEqual(t.calls,[]);
 assert.equal(t.invoke({name:'F'}).code,200);
 t.workers.New={};assert.equal(t.invoke({name:'New'}).code,200);
 assert.equal(t.state.statuses.New.name,'New');
});
