const test=require('node:test'),assert=require('node:assert/strict');
const {createStatusIntake}=require('../../runtime/status/coordinator/intake.ts');
const {createScatterReports,tickHuntSaved}=require('../../runtime/hunting/coordinator/api.ts');
// The tasks owner's answers the scatter observation reads: no member holds a task
// assignment or a group.
require('../../runtime/tasks/api.ts').publishTasks({assignment:()=>null,groupOf:()=>null});
function fixture(extra={}){
 const state={statuses:{},headlessSlots:[],steamMembers:[],steamSwitch:null,nativeOwner:null,merchantCharacter:'M',leader:'F',
  monsterHunt:{phase:'before'},aldata:{auth:'CORRECT',publishedAt:0},scatterMonsterTypes:[],scatterEpoch:1,scatterBreakTarget:null,
  partyFarmingMode:'default',partyFarmingMonsterType:null,combatMode:'auto'};
 const calls=[],workers={M:{}};let now=10000000;
 const rareOwns=extra.rareOwns||(()=>false);
 const service=createStatusIntake(state,workers,{
  now:()=>now,owned:name=>name==='F',persistRoster:()=>calls.push('roster'),
  write:()=>({ok:true}),
  merchant:()=>calls.push('merchant'),groupedCombat:()=>calls.push('combat'),rareReport:(name,report)=>{assert.equal(report,state.statuses[name]);calls.push('rare');},rareTick(){},
  bankboi:()=>calls.push('bankboi'),anniversary:()=>calls.push('anniversary'),
  taskTick:()=>{state.monsterHunt={phase:'after'};calls.push('hunt');},hunting:{...createScatterReports({farmingState:()=>state,activeNames:()=>Object.keys(state.statuses),now:()=>now,rareOwns:name=>rareOwns(name)}),
   reportTick:(name,taskTick)=>tickHuntSaved(state,()=>{taskTick();calls.push('farm');},()=>calls.push('persist'))},persist:()=>calls.push('persist'),
  abtesting:()=>calls.push('abtesting'),activeNames:()=>Object.keys(state.statuses),events:()=>calls.push('events'),
  convoyStep:()=>{calls.push('convoy');return false;},merchantScheduling:(body,previous)=>calls.push(['schedule',body.name,previous]),
  // The items owner's report answers, recorded: the lucky evidence, the items observation and the
  // market check.
  items:{lucky:name=>calls.push(['lucky',name]),observe:name=>calls.push(['items',name]),marketReport:name=>calls.push(['market',name])},
  reply:{read:name=>({name}),send:name=>({name})},...extra,
 });
 function invoke(body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};service.handle({body},res);return res;}
 return {state,calls,workers,invoke,time:value=>{now=value;}};
}

test('rare ownership keeps the coordinator grouped across fighter and merchant heartbeats',()=>{
 let owns=true;
 const t=fixture({rareOwns:name=>{assert.equal(name,'F');return owns;}});
 t.state.targetMode='hunt';t.state.scatterMonsterTypes=['minimush'];
 t.invoke({name:'F',farmingMonsterType:'minimush'});
 assert.equal(t.state.partyFarmingMode,'default');
 t.invoke({name:'M'});
 assert.equal(t.state.partyFarmingMode,'default');
 owns=false;t.invoke({name:'F',farmingMonsterType:'minimush'});
 assert.equal(t.state.partyFarmingMode,'scatter','normal Hunt scatter resumes after the rare owner releases');
});

// The intake hands every report to the items owner's market check, which publishes for the current merchant only
// (items/coordinator/owner.ts marketReport) and on a changed body (market.ts publish).
test('each report hands its reporter to the market check of the items owner',()=>{
 const t=fixture();t.invoke({name:'M'});t.invoke({name:'F'});
 assert.deepEqual(t.calls.filter(call=>call[0]==='market'),[['market','M'],['market','F']]);
});

test('status ownership accepts newly managed workers and owned characters but rejects inherited registry names',()=>{
 const t=fixture();assert.equal(t.invoke({name:'toString'}).code,400);assert.deepEqual(t.calls,[]);
 assert.equal(t.invoke({name:'F'}).code,200);
 t.workers.New={};assert.equal(t.invoke({name:'New'}).code,200);
 assert.equal(t.state.statuses.New.name,'New');
});

// Issuing a key under a revoked name drops that name's revoked records, so the key screen lists
// one record per name. A separate test: the E2E step "L: a key is issued, used once and revoked"
// (e2e/live-status-hooks.spec.ts) needs the live stack, and no other unit setup builds the app
// key routes.
test('issuing a key under a revoked name drops the name\'s revoked records',()=>{
 const {createApps}=require('../../runtime/status/coordinator/apps.ts');
 const state={appKeys:[]},routes={};let now=10;
 createApps(state,{now:()=>now,persist(){},notify(){}}).install({get:(path,handler)=>{routes['GET '+path]=handler;},post:(path,handler)=>{routes['POST '+path]=handler;}});
 const call=(route,request={})=>{let value;routes[route]({body:{},params:{},...request},{status(){return this;},json(v){value=v;return this;}});return value;};
 call('POST /party-api/apps',{body:{name:'Tracker',scopes:['read']}});
 call('POST /party-api/apps',{body:{name:'Other',scopes:['read']}});
 now=20;call('POST /party-api/apps/:name/revoke',{params:{name:'Tracker'}});
 now=30;call('POST /party-api/apps',{body:{name:'Tracker',scopes:['read','command']}});
 const listed=call('GET /party-api/apps').apps;
 assert.deepEqual(listed.map(app=>[app.name,app.issuedAt,app.revokedAt]),[['Other',10,null],['Tracker',30,null]]);
});

// A combat channel reply carries the farming section and not `settings` (status/rules.ts TABLE_R),
// so the farming section carries the scatter epoch the character's farm row compares. Observed on
// the e2e stack farming bees: the warrior learned `bee` at epoch 0 while the scope stood at epoch 2,
// the combat replies kept resetting it, and the party never scattered.
test('farmingReply carries the scope epoch and type the farm row reads on a combat reply', () => {
 const {farmingReply}=require('../../runtime/hunting/coordinator/api.ts');
 const {TABLE_R}=require('../../runtime/status/rules.ts');
 const row=name=>TABLE_R.find(r=>r.section===name);
 assert.deepEqual([row('farming').combat,row('settings').combat],[true,false]);
 const state={leader:'W',followers:{P:true},targetMode:'farming',monsterHunt:null,monsterFocus:['bee'],monsterFocusByCharacter:{},
  monsterPrioritiesByCharacter:{},monsterSearchRadiusByCharacter:{},combatMode:'auto',scatterBreakTarget:null,
  partyFarmingMonsterType:'bee',scatterMonsterTypes:['bee'],scatterEpoch:2};
 const reply=farmingReply(state,'P',undefined,false);
 assert.equal(reply.scatterEpoch,2);
 assert.equal(reply.partyFarmingMonsterType,'bee');
 assert.equal(reply.partyFarmingMode,'scatter');
});
