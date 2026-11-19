// Setups for the queue client transport tests (scripts/tests/combat-handoff.test.cjs), in the shared
// harness: the combat queue client with its report and
// long poll requests held open, run inside `fixture(run)`, which restores the globals it borrows.
const {installQueueClient}=require('../../../runtime/characters/targeting/queue-client.ts');
const {testScope}=require('../helpers/run-scope.cjs');
async function fixture(run){
 const keys=['parent','character','get_entity','setInterval','clearInterval'];
 const saved=Object.fromEntries(keys.map(k=>[k,global[k]])),dateNow=Date.now;
 let now=1000,group=null,sequence=0,enabled=true,ready=null,client,pos={x:0,y:0};const listeners=new Map();
 const pending=[],root={},deaths=[];
 // The try opens before the globals are borrowed, so its finally puts them back after a failed install.
 try{
 Object.assign(global,{parent:{socket:{on:(e,f)=>listeners.set(e,f),off:(e,f)=>{if(listeners.get(e)===f)listeners.delete(e);}}},character:{name:'W',map:'cave',in:'cave'},get_entity:()=>null,setInterval:()=>1,clearInterval(){}});
 Date.now=()=>now;
 const shared={
  targeting:{state:{},sharedTargetId:()=>null,acceptQueue:g=>{group=g;root.__partyGroupedCombat=g;},
  queueAcknowledgement:()=>({groupedCombat:{independentReady:ready,ack:group?.selection,queueAck:group?.queueRevision}}),
  queueReport:()=>({server:'USII',x:pos.x,y:pos.y,travelSample:{sequence:++sequence},groupedCombat:{threats:[{id:'M',x:pos.x+5,y:pos.y}],independentReady:ready,ack:group?.selection,queueAck:group?.queueRevision,deaths:[...deaths]}}),
  queueRequest:body=>new Promise((resolve,reject)=>pending.push({body,resolve,reject}))}};
 root.partyStatus={character:{applyChannel:(data,combat)=>combat(data),handoffTiming:require('../../../runtime/status/character/rings.ts').createHandoffTiming([],()=>true)}};root.partyTasks={partyList:()=>enabled?['W']:[]};root.partyHunting={farm:{grouped:()=>enabled,mode:()=>'default'}};root.partyMovement={coordinatorNow:()=>Date.now()+0,convoyActive:()=>false,independentApproachClient:()=>null,terrainRecoveryClient:()=>null,queueSightRecovery:()=>null};
 // The targeting owner's `act` handle on the run scope of this borrowed game window (lifecycle/character/roles.ts:38).
 client=installQueueClient(root,shared,testScope('04','act'));
 const response=(g=group)=>({groupedCombat:g,combatRevision:g?.selection||'empty'});
 await run({client,root,deaths,pending,response,reports:()=>pending.filter(r=>r.body.combatOnly),waits:()=>pending.filter(r=>r.body.combatWait),now:v=>now=v,move:v=>pos=v,readiness:v=>ready=v,listeners,disable:()=>enabled=false});}
 finally{client?.stop();Date.now=dateNow;Object.assign(global,saved);}
}
module.exports={fixture};
