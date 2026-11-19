const test=require('node:test'),assert=require('node:assert/strict');
const {installQueueClient}=require('../../runtime/characters/targeting/queue-client.ts');
const {testScope}=require('./helpers/run-scope.cjs');
// The game window's socket, which the client's 04 handle listens on for native position changes.
const socket={on(){},off(){}};
test('claim release clears local attack evidence and ignores a late hit after fresh renomination',async()=>{
 const saved=Object.fromEntries(['parent','character','get_entity','setInterval','clearInterval'].map(k=>[k,global[k]]));
 const target={id:'A',mtype:'boar',type:'monster',visible:true,x:1,y:0};let selected='A',nowOffset=0,resolveReport;
 Object.assign(global,{parent:{socket},character:{name:'W',map:'main',in:'main',x:0,y:0},get_entity:()=>target,setInterval:()=>1,clearInterval(){}});
 const base=()=>({server:'USII',groupedCombat:{candidates:[],evidence:[],claims:[],deaths:[],threats:[]}});
 const shared={
  targeting:{state:{},queueReport:base,sharedTargetId:()=>selected,acceptQueue:g=>{selected=g.target?.id||null;},queueRequest:r=>r.combatWait?new Promise(()=>{}):new Promise(resolve=>{resolveReport=resolve;})}};
 const root={partyTasks:{partyList:()=>['W']},partyStatus:{character:{applyChannel:(data,combat)=>combat(data),handoffTiming:require('../../runtime/status/character/rings.ts').createHandoffTiming([],()=>true)}},partyHunting:{farm:{grouped:()=>true,mode:()=>'default'}},partyMovement:{coordinatorNow:()=>Date.now()+nowOffset,convoyActive:()=>false,independentApproachClient:()=>null,terrainRecoveryClient:()=>null,queueSightRecovery:()=>null}};
 let client;
 try {
  client=installQueueClient(root,shared,testScope('04','act'));const action=client.evidence(target,'pending');const start=client.events[0].startedAt;
  nowOffset=100;client.evidence(target,'engaged',action);assert.equal(client.events[0].startedAt,start);
  resolveReport({groupedCombat:{target:null,claims:[{id:'A',map:'main',in:'main',server:'USII',external:true,at:start+200,releasedAt:start+200}]}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(client.events.length,0);
  selected='A';client.hit({hid:'W',id:'A'});assert.equal(client.events.length,0,'late hit cannot restore released evidence');
  nowOffset=300;client.evidence(target,'pending');client.hit({hid:'W',id:'A'});assert.equal(client.events[0].state,'engaged');
 } finally {client?.stop();Object.assign(global,saved);}
});

test('reset rejects delayed action completion and unpaired old hit after reacquiring the same monster',()=>{
 const saved=Object.fromEntries(['parent','character','get_entity','setInterval','clearInterval'].map(k=>[k,global[k]]));
 const target={id:'A',mtype:'boar',type:'monster',visible:true,x:1,y:0};let epoch=0;
 Object.assign(global,{parent:{socket},character:{name:'W',map:'main',in:'main',x:0,y:0},get_entity:()=>target,setInterval:()=>1,clearInterval(){}});
 let client;
 try{client=installQueueClient({partyTasks:{partyList:()=>['W']},partyStatus:{character:{applyChannel:(data,combat)=>combat(data),handoffTiming:require('../../runtime/status/character/rings.ts').createHandoffTiming([],()=>true)}},partyHunting:{farm:{grouped:()=>true,mode:()=>'default'}},partyMovement:{coordinatorNow:()=>Date.now()+0,convoyActive:()=>false,independentApproachClient:()=>null,terrainRecoveryClient:()=>null,queueSightRecovery:()=>null}}, {
  targeting:{state:{},sharedTargetId:()=> 'A',queueReport:()=>({server:'USII',groupedCombat:{epoch}}),queueRequest:()=>new Promise(()=>{})}},testScope('04','act'));
  const action=client.evidence(target,'pending');client.reset();epoch=Date.now();
  assert.equal(client.evidence(target,'engaged',action),null);client.hit({hid:'W',id:'A'});assert.equal(client.events.length,0);
  client.evidence(target,'pending');client.hit({hid:'W',id:'A'});assert.equal(client.events[0].state,'engaged');
 }finally{client?.stop();Object.assign(global,saved);}
});
