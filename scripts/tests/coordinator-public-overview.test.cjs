const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorPublicOverview}=require('../../runtime/status/coordinator/state.ts');
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
// The projection's rows (redaction, labels, the threshold floor) live in coordinator-merchant-projection.test.cjs;
// this row checks that the overview serves the same projection from the party's current threshold.
test('overview and external job projection share the party threshold',()=>{
 const {party,overview,read}=fixture();
 const job={id:'j',reason:'marked items',target:'P',aldataKey:'private'};party.merchantQueue=[job];
 assert.deepEqual(read().merchantQueue[0],overview.job(job));assert.equal(read().merchantQueue[0].collectionThreshold,5);
 party.itemCollectionThreshold=2;
 assert.deepEqual(read().merchantQueue[0],overview.job(job));assert.equal(read().merchantQueue[0].collectionThreshold,2);
});
