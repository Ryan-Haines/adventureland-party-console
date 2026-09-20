const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorPublicOverview}=require('../../runtime/coordinator/telemetry/public-composition.ts');
const {publicStateRuntime}=require('./helpers/coordinator-public-state.cjs');
function fixture(){
 const {party,ports}=publicStateRuntime();
 Object.assign(party,{leader:'P',steamSwitch:{phase:'old'},bankbois:{},itemCollectionThreshold:5});
 const overview=createCoordinatorPublicOverview(party,{...ports,handoff:value=>({...value}),
  stamp:job=>({...job,priority:50}),collectionSlots:()=>2,collectionNearby:()=>true});
 function read(){let body;overview.route({query:{}},{json:value=>body=value});return body;}
 return {party,overview,read};
}
test('overview reads replaced event reports, leader, handoff and BankBoi transaction state',()=>{
 const {party,read}=fixture();assert.equal(read().steamSwitch.phase,'old');
 party.steamSwitch={phase:'moving'};party.leader='Q';
 party.statuses={P:{seenAt:1000000,server:'USII',eventFeedAt:1000000,eventSchedules:[{name:'old realm'}]},
  Q:{seenAt:1000000,server:'EUI',eventFeedAt:999999,eventSchedules:[{name:'anniversary'}]}};
 party.bankbois={B:{name:'B',items:null},A:{name:'A',items:[{item:{name:'leather'}}]}};
 party.bankboiTransaction={bankboi:'B',phase:'withdraw',mode:'drain'};
 const response=read();
 assert.deepEqual(response.steamSwitch,{phase:'moving'});
 assert.deepEqual(response.eventSchedules,[{name:'anniversary',stale:false}]);
 assert.deepEqual(response.bankbois,[{name:'A',items:[{item:{name:'leather'}}],transaction:null},
  {name:'B',items:[],transaction:{phase:'withdraw',mode:'drain'}}]);
 assert.equal(party.bankbois.B.items,null,'projection must not mutate stored inventory');
});
test('overview and external job projection share current collection thresholds without leaking credentials',()=>{
 const {party,overview,read}=fixture();
 const job={id:'j',reason:'marked items',target:'P',aldataKey:'private'};party.merchantQueue=[job];
 const first=read().merchantQueue[0];assert.equal(first.collectionLabel,'nearby collection');
 assert.equal(first.collectionThreshold,5);assert.equal(first.collectionNearby,true);
 assert.equal(Object.hasOwn(first,'aldataKey'),false);assert.equal(job.aldataKey,'private');
 party.itemCollectionThreshold=2;
 const projected=overview.job(job);assert.equal(projected.collectionLabel,'marked items');
 assert.equal(projected.collectionThreshold,2);assert.deepEqual(read().merchantQueue[0],projected);
 assert.equal(overview.job(null),null);
});
