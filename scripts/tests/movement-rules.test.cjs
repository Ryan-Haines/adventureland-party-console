// Isolated test of the movement owner's rule table. Failure list first.
// Expected values are the design
// rule table typed by hand, with applied. From a request names a tier of "The rank table".
const assert=require('node:assert/strict');
const {walkStatePorts}=require('./helpers/walk-state-ports.cjs');
// The events owner's character facts, which shared.js installs before movement's owners ask them (events/api.ts
// `eventFacts`).
const {installCharacterEvents}=require('./helpers/character-events.cjs');
// The hunting owner's planner request for a Hunt walk, which the walk client asks (shared.js passes
// huntClient.returnPlan).
const huntReturnPlan=command=>require('../../runtime/hunting/character/hunt.ts').huntReturnPlan(command);
const {decide,tierOf,judgeStop,stepAllowed}=require('../../runtime/movement/rules.ts');
// The rank a request ranks at: its tier's row of the one rank table.
const rankOf=request=>require('../../runtime/protocol/ranks.ts').TIERS[tierOf(request).tier].rank;


const {scenarioTable}=require('./fixtures/scenarios.cjs');
// The walk's cruise asks the call budget (executor.ts sendCruise), which answers send here.
require('./helpers/planted-calls.cjs').plantCalls();
const {r,decision,task}=require('./fixtures/movement-rules-scenario.cjs');
// The task rows' ranks, typed by hand from sections 2.1 and 2.5.
const TASK_RANKS={escape:100,'death-recovery':95,cave:90,lifecycle:88,'realm-hold':88,manual:75,app:74,'event-attendance':72,
 'hunt-turn-in':70,'event-return':68,'merchant-job':65,rare:64,'hunt-mission':62,'addon:x':60,farming:56,idle:0};
const PLAYER_ENDS=new Set(['escape','death-recovery']);
// The events owner's `event.schedule` answer the wind-down rows read: party:L's Mr. Pumpkin spawning
// at 1 s with a planned 10 s walk, `over` changing it, or null for no scheduled occurrence.
function scheduled(over={}){
 const {occurrenceId,publishEventAnswers}=require('../../runtime/events/api.ts');
 const id=occurrenceId('party:L','mrpumpkin');
 const answer=over&&{event:'mrpumpkin',occurrence:id,group:'party:L',realm:'USII',spawnAt:1000,walkMs:10_000,leadMs:10_000,phase:'scheduled',shortWindow:false,...over};
 publishEventAnswers({schedule:occurrence=>occurrence===id?answer:null});
}
scenarioTable('the rule table ranks each request by the tier it names', ()=>undefined, [
 ['failure 1: a lower rank never takes over a higher one', ()=>{
  // [incoming, live] pairs, each incoming ranked below the live row.
  for(const [incoming,live] of [
    [r('death-recovery'),r('escape')],[r('cave'),r('death-recovery')],[r('lifecycle'),r('cave')],
    [r('town'),r('lifecycle')],[r('manual'),r('town')],
    [r('approach'),r('formation')],[r('follow'),r('approach')],[r('task-walk','t','hunt-mission'),r('manual')],
  ])assert.equal(decision(live,incoming),'refused',`${incoming.kind} against ${live.kind}`);
 }],
 ['failure 2: an equal rank waits or is refused, never takes over', ()=>{
  assert.equal(decision(r('town','town:1'),r('town','town:2')),'refused');
  assert.equal(decision(r('cave','cave:1'),r('cave','cave:2')),'refused');
  assert.equal(decision(r('group-walk','walk:1','hunt-mission'),r('group-walk','walk:2','hunt-mission')),'waiting');
  assert.equal(decision(r('errand','errand:1'),r('errand','errand:2')),'waiting');
 }],
 ['failure 3: only group walks and errands wait, and only a group walk keeps the walk it interrupts', ()=>{
  // Incoming lower requests: group walks and errands wait; the rest are refused.
  assert.equal(decision(r('manual'),r('group-walk','walk:1','hunt-turn-in')),'waiting');
  assert.equal(decision(r('town'),r('errand')),'waiting');
  assert.equal(decision(r('manual'),r('follow')),'refused');
  assert.equal(decision(r('cave'),r('approach')),'refused');
  // Interrupted live requests: the group-walk row keeps lower group walks and errands waiting.
  assert.deepEqual(decide(r('group-walk','walk:1','hunt-mission'),r('group-walk','walk:2','event-return')),{decision:'granted',interrupted:'wait'});
  assert.deepEqual(decide(r('errand'),r('group-walk','walk:2','hunt-turn-in')),{decision:'granted',interrupted:'wait'});
  assert.deepEqual(decide(r('follow'),r('group-walk','walk:2','farming')),{decision:'granted',interrupted:'cancel'});
  assert.deepEqual(decide(r('group-walk','walk:1','hunt-mission'),r('errand')),{decision:'granted',interrupted:'cancel'});
  assert.deepEqual(decide(r('group-walk','walk:1','hunt-mission'),r('escape')),{decision:'granted',interrupted:'cancel'});
  assert.deepEqual(decide(r('errand'),r('town')),{decision:'granted',interrupted:'cancel'});
 }],
 // Items 1 and 4 (e2e/movement-owner-failures.md): every walk names its tier, so the step 4
 // range and its `unranked` decision are gone. One walk against another, and a takeover stop
 // between them, read the same tiers.
 ['failure 1: a walk ranks by the tier it names, and a walk without one is a protocol error', ()=>{
  for(const request of [r('group-walk','walk:1'),r('task-walk','rare:1'),r('addon:pull','pull'),r('group-walk','walk:1','errand')])
    assert.throws(()=>decide(r('follow'),request),/names no tier/,request.kind);
  assert.throws(()=>decide(r('group-walk','walk:1'),r('manual')),/names no tier/);
  // Fixed rows need no tier.
  assert.equal(decision(r('follow'),r('approach')),'granted');
  assert.equal(rankOf(r('group-walk','walk:1','rare')),64);
  assert.equal(decision(r('follow'),r('group-walk','walk:2','farming')),'granted');
  assert.equal(decision(r('group-walk','walk:1','farming'),r('manual')),'granted');
  assert.equal(decision(r('manual'),r('group-walk','walk:2','hunt-turn-in')),'waiting');
  assert.equal(decision(r('group-walk','walk:1','hunt-mission'),r('group-walk','walk:2','event-return')),'granted');
  assert.equal(decision(r('group-walk','walk:1','event-return'),r('group-walk','walk:2','hunt-mission')),'waiting');
  assert.equal(decision(r('errand'),r('group-walk','walk:2','rare')),'waiting');
  assert.deepEqual(decide(r('errand'),r('group-walk','walk:2','event-attendance')),{decision:'granted',interrupted:'wait'});
  assert.equal(judgeStop(r('group-walk','walk:1','farming'),{...r('group-walk','walk:2','hunt-mission'),takeover:true}),'takeover');
  assert.equal(judgeStop(r('group-walk','walk:1','hunt-mission'),{...r('group-walk','walk:2','farming'),takeover:true}),'refused');
  assert.equal(judgeStop(r('errand'),{...r('group-walk','walk:2','event-return'),takeover:true}),'takeover');
  assert.equal(judgeStop(r('errand'),{...r('group-walk','walk:2','rare'),takeover:true}),'refused');
 }],
 // Step 9: the hook registry refuses an add-on tier at or above manual at load
 // (scripts/tests/hook-registry.test.cjs item 2), so a request that names one anyway is a
 // protocol error like any other row's, never a clamp.
 ['failure 5: an add-on names a tier below manual; a higher one is a protocol error', ()=>{
  assert.throws(()=>rankOf(r('addon:pull','pull','town')),/addon:pull request pull names no tier of its row: town/);
  assert.equal(rankOf(r('addon:pull','pull','follow')),40);
  assert.equal(rankOf(r('addon:pull','pull','hunt-turn-in')),70);
  assert.equal(decision(r('manual'),r('addon:pull','pull','hunt-turn-in')),'refused');
  assert.equal(decision(r('follow'),r('addon:pull','pull','hunt-turn-in')),'granted');
 }],
 // The player command column and the
 // tiers of "The rank table", typed by hand.
 ['failure 1: a player command ends only the rows whose Player command column says ends', ()=>{
  const playerEnds={escape:true,'death-recovery':true,cave:false,lifecycle:false,town:false};
  for(const [kind,ends] of Object.entries(playerEnds))
    assert.deepEqual(decide(r(kind),r('manual')),ends?{decision:'granted',interrupted:'cancel'}:{decision:'refused'},kind);
  // Below manual the rank decides, as for any request.
  for(const live of [r('group-walk','walk:1','hunt-turn-in'),r('errand'),r('task-walk','rare:1','rare'),r('formation'),r('approach'),r('follow')])
    assert.equal(decision(live,r('manual')),'granted',live.kind);
  // A request of another tier never ends an escape or a death recovery below its rank.
  assert.equal(decision(r('escape'),r('death-recovery')),'refused');
  assert.equal(decision(r('death-recovery'),r('cave')),'refused');
 }],
 ['failure 2: a tier ranks the request; a tier outside the kind\'s rows does not', ()=>{
  // Attendance ranks above the turn-in, and the add-on task band is one tier below the Hunt
  // mission.
  const ranks={'event-attendance':72,'hunt-turn-in':70,'event-return':68,rare:64,'hunt-mission':62,'addon-task':60,farming:56};
  for(const [tier,rank] of Object.entries(ranks))for(const kind of ['group-walk','task-walk'])
    assert.equal(rankOf(r(kind,'walk:1',tier)),rank,kind+' '+tier);
  // A walk cannot claim a fixed row's tier: from that breaks the request protocol.
  assert.throws(()=>rankOf(r('group-walk','walk:1','escape')),/names no tier/);
  assert.throws(()=>rankOf(r('task-walk','walk:1','follow')),/names no tier/);
  // A fixed row ignores a tier it does not own.
  assert.equal(rankOf(r('follow','follow','escape')),40);
  assert.equal(rankOf(r('escape','escape:1','follow')),100);
  assert.equal(rankOf(r('errand')),65);
 }],
 ['failure 3: the coordinator ranks a walk by the same table as the character', ()=>{
  const {walkRequester}=require('../../runtime/movement/rules.ts');
  assert.deepEqual(walkRequester('farm-relocation','farming'),{kind:'group-walk',owner:'farm-relocation',tier:'farming'});
  assert.deepEqual(walkRequester('escape-recovery','escape'),{kind:'escape',owner:'escape-recovery',tier:'escape'});
  assert.deepEqual(walkRequester('death-recovery','death-recovery'),{kind:'death-recovery',owner:'death-recovery',tier:'death-recovery'});
  assert.equal(decision(walkRequester('farm-relocation','farming'),walkRequester('party-travel','manual')),'granted');
  assert.equal(decision(walkRequester('party-travel','manual'),walkRequester('farm-relocation','farming')),'waiting');
  assert.equal(decision(walkRequester('monster-hunt','hunt-mission'),walkRequester('monster-hunt','hunt-mission')),'same-owner');
 }],
 // Groups and tasks step 2: the task columns of runtime/tasks/rules.ts. The expectations are
 // sections 2.1, 2.2 and 2.5 typed by hand. The 15 task rows give 225 ordered pairs, and no run
 // meets most of them.
 ['task failure 1: a lower tier task never takes the group from a higher one, and a higher one always does',()=>{
  const {judge}=require('../../runtime/tasks/rules.ts');
  for(const [incoming,inRank] of Object.entries(TASK_RANKS))for(const [live,liveRank] of Object.entries(TASK_RANKS)){
   if(incoming===live||PLAYER_ENDS.has(live)&&incoming==='manual')continue;
   const got=judge(task(live,'live:1'),task(incoming,'in:1')).decision;
   if(inRank>liveRank)assert.equal(got,'granted',`${incoming} against ${live}`);
   else assert.notEqual(got,'granted',`${incoming} against ${live}`);
  }
 }],
 ['task failure 2: an equal tier keeps the live task, and the same identity is kept',()=>{
  const {judge}=require('../../runtime/tasks/rules.ts');
  assert.equal(judge(task('farming','farm:a'),task('farming','farm:b')).decision,'waiting');
  assert.equal(judge(task('event-attendance','attend:a'),task('event-attendance','attend:b')).decision,'waiting');
  // lifecycle and realm-hold share the tier rank: whichever holds the merchant first keeps it (2.1).
  assert.equal(judge(task('lifecycle'),task('realm-hold')).decision,'waiting');
  assert.equal(judge(task('realm-hold'),task('lifecycle')).decision,'waiting');
  // A rare does not wait (1.3 `refused`).
  assert.equal(judge(task('rare','rare:a'),task('rare','rare:b')).decision,'refused');
  assert.equal(judge(task('hunt-mission','hunt:1'),task('hunt-mission','hunt:1')).decision,'kept');
  assert.equal(judge(undefined,task('farming')).decision,'granted');
 }],
 ['task failure 3: a row that suspends suspends, and rare and escape are cancelled',()=>{
  const {judge}=require('../../runtime/tasks/rules.ts');
  const suspends=['death-recovery','cave','lifecycle','realm-hold','manual','app','event-attendance','hunt-turn-in',
   'event-return','merchant-job','hunt-mission','farming'];
  for(const live of suspends)assert.equal(judge(task(live),task('escape')).interrupted,'suspend',live);
  assert.equal(judge(task('rare'),task('escape')).interrupted,'cancel','D3: a resumed rare would chase a monster that moved');
  assert.equal(judge(task('idle'),task('farming')).interrupted,'cancel','idle keeps nothing');
  // Nothing outranks escape; the player's command ends it.
  assert.deepEqual(judge(task('escape'),task('manual')),{decision:'granted',interrupted:'cancel'});
  // An add-on's task is interrupted as its request declares (section 5).
  assert.equal(judge(task('addon:x','x:1',{interrupted:'cancel'}),task('escape')).interrupted,'cancel');
  assert.equal(judge(task('addon:x','x:1',{interrupted:'suspend'}),task('escape')).interrupted,'suspend');
 }],
 ['task failure 4: the merchant visit and admission columns answer as section 2.2 says',()=>{
  const {allows}=require('../../runtime/tasks/rules.ts');
  const visit={escape:false,'death-recovery':false,cave:false,lifecycle:false,manual:true,app:true,
   'hunt-turn-in':false,'event-return':true,'event-attendance':true,rare:true,'hunt-mission':true,'addon:x':true,farming:true,idle:true};
  for(const [kind,yes] of Object.entries(visit))assert.equal(allows('merchant-visit',{kind}),yes,'merchant visit during '+kind);
  // Admission is false while a task above event attendance (72) holds the group (2.4 gap 4).
  const admits={escape:false,'death-recovery':false,cave:false,lifecycle:false,manual:false,app:false,
   'event-attendance':true,'hunt-turn-in':true,'event-return':true,rare:true,'hunt-mission':true,'addon:x':true,farming:true,idle:true};
  for(const [kind,yes] of Object.entries(admits))assert.equal(allows('event-attendance',{kind}),yes,'admission during '+kind);
 }],
 ['task failure 5: a group kind offers only the rows it has a provider for',()=>{
  const {offers}=require('../../runtime/tasks/rules.ts');
  const rows={party:['escape','death-recovery','cave','lifecycle','manual','app','event-attendance','hunt-turn-in','event-return','rare','hunt-mission','addon:x','farming','idle'],
   solo:['death-recovery','cave','lifecycle','manual','app','event-attendance','hunt-turn-in','event-return','hunt-mission','addon:x','farming','idle'],
   merchant:['death-recovery','lifecycle','realm-hold','event-attendance','event-return','merchant-job','addon:x','idle']};
  for(const [group,kinds] of Object.entries(rows))for(const kind of Object.keys(TASK_RANKS))
   assert.equal(offers(group,kind),kinds.includes(kind),`${group} ${kind}`);
 }],
 ['task failure 6: every task tier is a TIERS key, the module holds no rank, and the walks rank each pair the same',()=>{
  const rules=require('../../runtime/tasks/rules.ts'),{ TIERS } = require('../../runtime/protocol/ranks.ts');
  for(const kind of Object.keys(TASK_RANKS)){assert.ok(rules.taskTier(task(kind)) in TIERS,kind);assert.equal(TIERS[rules.taskTier(task(kind))].rank,TASK_RANKS[kind],kind);}
  assert.throws(()=>rules.taskTier(task('addon:x','x:1',{tier:'manual'})),/addon:x names the tier manual; an add-on task names addon-task/);
  const numbers=(value,seen=new Set())=>typeof value==='number'||!!value&&typeof value==='object'&&!seen.has(value)&&(seen.add(value),Object.values(value).some(v=>numbers(v,seen)));
  assert.equal(Object.values(rules).some(v=>numbers(v)),false,'task-rules exports no number');
  // The walk each task's members use (2.1 "Walk row"); movement's decide ranks them.
  const walk={escape:r('escape'),'death-recovery':r('death-recovery'),cave:r('cave'),lifecycle:r('lifecycle'),manual:r('manual'),
   'merchant-job':r('errand')};
  for(const tier of ['event-attendance','hunt-turn-in','event-return','rare','hunt-mission','farming'])walk[tier]=r('group-walk','w',tier);
  walk['addon:x']=r('group-walk','w','addon-task');
  for(const [incoming,inWalk] of Object.entries(walk))for(const [live,liveWalk] of Object.entries(walk)){
   if(incoming===live)continue;
   assert.equal(rules.judge(task(live,'live:1'),task(incoming,'in:1')).decision==='granted',
    decide({...liveWalk,owner:'live:1'},{...inWalk,owner:'in:1'}).decision==='granted',`${incoming} against ${live}`);
  }
 }],
 ['task failure 7: a rare whose "May interrupt Hunt" is off never takes a Hunt task',()=>{
  const {judge}=require('../../runtime/tasks/rules.ts');
  assert.equal(judge(task('hunt-mission'),task('rare','rare:1',{interruptsHunt:false})).decision,'refused');
  assert.equal(judge(task('hunt-turn-in'),task('rare','rare:1',{interruptsHunt:false})).decision,'refused');
  assert.deepEqual(judge(task('hunt-mission'),task('rare','rare:1',{interruptsHunt:true})),{decision:'granted',interrupted:'suspend'});
  assert.deepEqual(judge(task('hunt-mission'),task('rare')),{decision:'granted',interrupted:'suspend'},'the switch is on unless the rare says off');
  assert.equal(judge(task('farming'),task('rare','rare:1',{interruptsHunt:false})).decision,'granted','the switch narrows Hunt only');
 }],
 ['task failure 8: an app command ranks below the player\'s, and the player\'s commands rank as the player (IN1)',()=>{
  const {judge,taskTier}=require('../../runtime/tasks/rules.ts');
  assert.equal(taskTier(task('manual')),'manual');assert.equal(taskTier(task('app')),'app');
  assert.equal(judge(task('manual'),task('app')).decision,'waiting');
  assert.deepEqual(judge(task('app'),task('manual')),{decision:'granted',interrupted:'suspend'});
  // The Player command column is the player's: an app never ends an escape or a death recovery.
  for(const live of ['escape','death-recovery']){
   assert.notEqual(judge(task(live),task('app')).decision,'granted',live);
   assert.deepEqual(judge(task(live),task('manual')),{decision:'granted',interrupted:'cancel'},live);
  }
 }],
 // `farmWalkHeld`: the death recovery's farm walk ranks as a farming task walk.
 ['the farm walk after a death is held only by another request it does not outrank, as farmWalkHeld did (appendix A2 RANK)', ()=>{
  const {farmWalkHeld}=require('../../runtime/movement/rules.ts'),own='death:R:0';
  assert.equal(farmWalkHeld(null,own),false,'nothing holds the character');
  assert.equal(farmWalkHeld({kind:'death-recovery',owner:own},own),false,"the recovery's own hold");
  for(const live of [r('group-walk','walk:1','farming'),r('task-walk','event-return:1','event-return'),r('manual')])
   assert.equal(farmWalkHeld(live,own),true,live.kind+' '+live.tier);
  for(const live of [r('follow'),r('formation'),r('approach')])assert.equal(farmWalkHeld(live,own),false,live.kind);
 }],
 // The three new columns, each typed by hand from the design's table, and T5's
 // rungs by name. Each replaces a copy the rework removed.
 ['task failure 9: dueYields, reunion and fallBack answer as T1 says, and the ladder climbs by rung names',()=>{
  const {dueYields,column,nextRung}=require('../../runtime/tasks/rules.ts');
  for(const kind of Object.keys(TASK_RANKS))assert.equal(dueYields(kind),kind==='hunt-turn-in',kind);
  const alone=['farming','hunt-mission','idle'],command=['manual','app','town','hunt-turn-in','event-return'];
  for(const kind of Object.keys(TASK_RANKS))assert.equal(column(task(kind),'reunion'),alone.includes(kind)?'alone':command.includes(kind)?'command':'no',kind);
  assert.equal(column(task('addon:x','x:1',{reunion:'alone'}),'reunion'),'alone','an add-on names its own reunion');
  const waits=['farming','realm-hold','hunt-turn-in','idle'];
  for(const kind of Object.keys(TASK_RANKS))assert.equal(nextRung('safe-point',kind),waits.includes(kind)?'wait':'fall-back',kind);
  assert.equal(nextRung('walk','manual'),'regroup','no alternative left skips it');
  assert.equal(nextRung('walk','manual',{alternative:true}),'alternative');
  assert.equal(nextRung('walk','hunt-mission',{from:'alternative'}),'regroup','a source that climbed past the owner');
  assert.equal(nextRung('wait','farming'),'wait','a failure on the wait rung waits again');
 }],
 // `stopsActing` and the wait rung's report test: only the console Pause and the escape's hold stop every
 // source's acting tick, and a wait ends on a new map, a death or a respawn, or the progress distance of movement.
 ['T4 and T5: only the user and the escape stop acting, and the wait rung ends on a report that shows a change',()=>{
  const {stopsActing,reportChanged}=require('../../runtime/tasks/rules.ts'),{PROGRESS_DISTANCE}=require('../../runtime/protocol/ladder.ts');
  for(const [by,stops] of [['user',true],['escape',true],['cave-hold',false],['intent',false],['manual',false],['pause',false],['addon:x',false]])
   assert.equal(stopsActing(by),stops,by);
  const at={map:'main',x:0,y:0};
  assert.equal(reportChanged(undefined,undefined),false,'no report on either side');
  assert.equal(reportChanged(undefined,at),true,'the first report shows a change');
  assert.equal(reportChanged(at,{...at,x:PROGRESS_DISTANCE-1}),false,'less than the progress distance');
  assert.equal(reportChanged(at,{...at,x:PROGRESS_DISTANCE}),true,'the progress distance');
  assert.equal(reportChanged(at,{...at,map:'cave'}),true,'a new map');
  assert.equal(reportChanged(at,{...at,rip:true}),true,'a death');
  assert.equal(reportChanged({...at,rip:true},at),true,'a respawn');
 }],
 // The `busy` check reads the group's walk as movement's notices name it, not the walk state.
 ['task failure 10: a target mode entry waits while another walk runs in its group, and acts on its own target walk',()=>{
  const {busy}=require('../../runtime/tasks/rules.ts');
  assert.equal(busy(false,undefined),'another task holds the party');
  assert.equal(busy(true,undefined),null,'no walk runs');
  assert.equal(busy(true,{purpose:'monster-hunt',phase:'shared-prepare'}),'the party is travelling');
  assert.equal(busy(true,{purpose:'manual-monster-override',phase:'shared-route'}),null,'its own target walk');
  for(const phase of ['complete','failed'])assert.equal(busy(true,{purpose:'monster-hunt',phase}),null,phase);
 }],
 // The wind-down is the tasks owner's `member.holder` answer for an event walk. Its
 // cut-off is the 1 s spawn plus 60 s, less a 10 s walk: 51 s. Red on an earlier build, which
 // has no answer. The spawn, walk time and window are the events owner's `event.schedule` answer for
 // the group's occurrence (closed); `scheduled` publishes one for party:L's Mr. Pumpkin, or none.
 ['task failure 11: the live trip holds a member coming until the cut-off, and not for a short window',()=>{
  const {windDownHolds}=require('../../runtime/tasks/coordinator/wind-down.ts');
  const facts={onTrip:true,healer:false,verdict:()=>'leave'},ask=at=>({group:'party:L',member:'F',at,activity:'event',key:'mrpumpkin'});
  scheduled();
  assert.deepEqual(windDownHolds(ask(50_999),facts).map(h=>[h.owner,h.coming,h.endsOn]),[['01',true,'task.ended']]);
  assert.deepEqual(windDownHolds(ask(51_000),facts),[],'at the cut-off the trip gives way');
  scheduled({shortWindow:true});
  assert.deepEqual(windDownHolds(ask(1000),facts),[],'a short window takes the group at once');
  scheduled(null);
  assert.deepEqual(windDownHolds(ask(1000),facts),[],'without a scheduled occurrence nothing is held');
 }],
 ['task failure 12: the group\'s fight holds a member coming until survival says leave or the cut-off',()=>{
  const {windDownHolds}=require('../../runtime/tasks/coordinator/wind-down.ts');
  const ask=at=>({group:'party:L',member:'F',at,activity:'event',key:'mrpumpkin'});
  scheduled();
  assert.deepEqual(windDownHolds(ask(1000),{onTrip:false,healer:false,verdict:()=>'finish'}).map(h=>h.coming),[true]);
  assert.deepEqual(windDownHolds(ask(1000),{onTrip:false,healer:false,verdict:()=>'leave'}),[]);
  assert.deepEqual(windDownHolds(ask(51_000),{onTrip:false,healer:false,verdict:()=>'finish'}),[],'past the cut-off the walk leaves the fight');
 }],
 ['task failure 13: the healer is not coming from the cut-off on, and held by no wind-down before it',()=>{
  const {windDownHolds}=require('../../runtime/tasks/coordinator/wind-down.ts');
  const facts={onTrip:false,healer:true,verdict:()=>'leave'},ask=at=>({group:'party:L',member:'P',at,activity:'event',key:'mrpumpkin'});
  scheduled();
  assert.deepEqual(windDownHolds(ask(50_999),facts),[]);
  assert.deepEqual(windDownHolds(ask(51_000),facts).map(h=>[h.owner,h.coming]),[['01',false]]);
 }],
 // The tasks owner's part: it answers event admission per group, so a task that holds the party holds its own
 // members only, and the merchant, in its own group, may attend during the party's Hunt hand-in or a
 // trip above attendance. Green on an earlier build too: the owner answers per group since RA-01a.
 ["task failure 14: the merchant's event attendance during the party's Hunt hand-in is allowed",()=>{
  const {createTaskOwner}=require('../../runtime/tasks/coordinator/owner.ts');
  const notices=[],owner=createTaskOwner({now:()=>1000,notify:(hook,payload)=>notices.push([hook,payload]),snapshot(){}});
  owner.sync([{id:'party:L',kind:'party',members:['L','F']},{id:'merchant:M',kind:'merchant',members:['M']}]);
  owner.request('party:L',{kind:'hunt-turn-in',owner:'hunt:L',members:['L','F'],source:'core:hunt'});owner.tick();
  assert.equal(owner.live('party:L').kind,'hunt-turn-in');assert.equal(owner.allows('event-attendance','M'),true);
  owner.request('party:L',{kind:'manual',owner:'manual:trip',members:['L','F'],source:'core:manual'});owner.tick();
  assert.equal(owner.allows('event-attendance','F'),false,'a trip above attendance holds the party');
  assert.equal(owner.allows('event-attendance','M'),true,"the merchant's own group answers for it");
  // A group gone from the settings sends its last group.changed with no members, which the
  // events owner's occurrences end that group's records on (red before: no notice).
  owner.sync([{id:'merchant:M',kind:'merchant',members:['M']}]);
  assert.deepEqual(notices.filter(([hook,p])=>hook==='group.changed'&&p.group==='party:L').at(-1)?.[1],{group:'party:L',members:[],leader:null,by:'settings'});
 }],
 // Observed live on the records row: the party's farming resumed after each add-on task and each
 // resume wrote a churn snapshot, six for one real loop.
 ['a task resuming after a higher task ends writes no churn snapshot; a second grant of one identity does',()=>{
  const {createTaskOwner}=require('../../runtime/tasks/coordinator/owner.ts');
  const saved=[],owner=createTaskOwner({now:()=>1000,notify(){},snapshot:(group,trigger)=>saved.push(trigger)});
  owner.sync([{id:'party:L',kind:'party',members:['L','F']}]);
  owner.request('party:L',{kind:'farming',owner:'farm:L',members:['L','F'],source:'core:farm'});owner.tick();
  for(const name of ['once:0','once:1','once:2']){const h=owner.request('party:L',{kind:'addon:e2e',owner:'e2e:'+name,members:['L','F']});owner.tick();owner.release(h);owner.tick();}
  assert.equal(owner.live('party:L').owner,'farm:L');
  assert.deepEqual(saved.filter(t=>t==='churn'),[],'distinct identities and the resumed farming write none');
  for(let i=0;i<2;i++){const h=owner.request('party:L',{kind:'addon:e2e',owner:'e2e:churn',members:['L','F']});owner.tick();owner.release(h);owner.tick();}
  assert.deepEqual(saved.filter(t=>t==='churn'),['churn']);
 }],
 // Observed live on the stuck row: the farming task's stuck record named no rung, so the ring
 // could not say which rung the party stood on.
 ['the stuck record names the wait rung it stands on',()=>{
  const {createTaskOwner}=require('../../runtime/tasks/coordinator/owner.ts');
  const {RUNGS}=require('../../runtime/tasks/rules.ts');
  const owner=createTaskOwner({now:()=>1000,notify(){},snapshot(){}});
  owner.sync([{id:'party:L',kind:'party',members:['L','F']}]);
  const handle=owner.request('party:L',{kind:'farming',owner:'farm:L',members:['L','F'],source:'core:farm'});owner.tick();
  assert.deepEqual([1,2,3].map(()=>owner.fail(handle,'e2e-farm')?.rung),['regroup','safe-point','wait']);
  assert.deepEqual(owner.ring('party:L').filter(r=>r.decision==='stuck').map(r=>r.ladderStep),[RUNGS.indexOf('wait')]);
 }],
]);





scenarioTable('only the holder, escape, death recovery and a higher takeover stop a journey', ()=>undefined, [
 ['failure 7: stops succeed for the holder, escape, death recovery and the row additions only', ()=>{
  const live=r('group-walk','walk:7','hunt-mission');
  assert.equal(judgeStop(live,r('group-walk','walk:7','hunt-mission')),'stop');
  assert.equal(judgeStop(live,r('escape')),'stop');
  assert.equal(judgeStop(live,r('death-recovery')),'stop');
  assert.equal(judgeStop(live,r('town')),'refused');
  assert.equal(judgeStop(live,r('manual')),'refused');
  assert.equal(judgeStop(live,r('group-walk','walk:8','event-return')),'refused');
  // Row additions: the Cave runtime stops Cave journeys; the lifecycle owner stops lifecycle journeys.
  assert.equal(judgeStop(r('cave','cave:1'),r('cave','cave:2')),'stop');
  assert.equal(judgeStop(r('lifecycle','lifecycle:1'),r('lifecycle','lifecycle:2')),'stop');
  assert.equal(judgeStop(r('town','town:1'),r('cave','cave:2')),'refused');
 }],
 // Step 4: e2e/movement-owner-failures.md "Isolated: step 4 rule and goal changes".
 ['step 4 failure 2: a takeover stop ends only a lower journey', ()=>{
  const town={...r('town','town:9'),takeover:true};
  assert.equal(judgeStop(r('group-walk','walk:1','hunt-mission'),town),'takeover');
  assert.equal(judgeStop(r('follow'),town),'takeover');
  assert.equal(judgeStop(r('manual'),town),'takeover');
  assert.equal(judgeStop(r('escape'),town),'refused');
  assert.equal(judgeStop(r('cave'),town),'refused');
  assert.equal(judgeStop(r('town','town:1'),town),'refused');
  assert.equal(judgeStop(r('death-recovery'),{...r('manual','manual'),takeover:true}),'takeover');
 }],
 ['step 4 failure 4: rank alone does not stop a journey (A2)', ()=>{
  assert.equal(judgeStop(r('follow'),r('town')),'refused');
  assert.equal(judgeStop(r('group-walk','walk:1','hunt-mission'),r('manual')),'refused');
  // The holder, escape and death recovery still stop it.
  assert.equal(judgeStop(r('follow','follow'),r('follow','follow')),'stop');
  assert.equal(judgeStop(r('manual'),r('escape')),'stop');
  assert.equal(judgeStop(r('manual'),r('death-recovery')),'stop');
 }],
]);




scenarioTable('the Steps column decides which journeys and holds lend the character to a combat step', ()=>undefined, [
 // Step 5: e2e/movement-owner-failures.md "Isolated: the Steps column". The § 2.1 Steps
 // column typed by hand. A Town cast and a hold refuse steps in the service, not here.
 ['step 5 failure 1: rows whose Steps column says no refuse a combat step', ()=>{
  for(const live of [r('escape'),r('lifecycle'),r('group-walk','walk:1','hunt-mission'),r('errand')])
    assert.equal(stepAllowed(live),false,live.kind);
 }],
 ['step 5 failure 2: rows whose Steps column says yes allow a combat step', ()=>{
  for(const live of [r('death-recovery'),r('cave'),r('town'),r('manual'),r('task-walk','rare:1','rare'),
    r('formation'),r('approach'),r('follow'),r('addon:pull','pull','follow')])
    assert.equal(stepAllowed(live),true,live.kind);
 }],
 ['step 5 failure 3: a step with no live journey is allowed', ()=>{
  assert.equal(stepAllowed(undefined),true);
 }],
]);

// Every reader asks the one freshness rule in
// runtime/protocol/reports.ts with its reading. Each row is a reading's answer at today's age, or
// the measured clock difference that replaced the fixed future bounds.
scenarioTable('a report is fresh by its reading\'s age and the measured clock difference', ()=>require('../../runtime/protocol/reports.ts'), [
 ['each reading keeps today\'s age at its boundary', reports=>{
  for(const [reading,age] of [['report',3000],['presence',10000],['recent',5000],['errand-target',15000],['merchant-home',15000]]){
   assert.equal(reports.fresh(10000,10000+age,reading),true,reading);
   assert.equal(reports.fresh(10000,10001+age,reading),false,reading);
  }
  assert.equal(reports.fresh(10000,13000),true,'report is the default reading');
 }],
 ['a reader whose site counted the exact age as stale keeps that answer', reports=>{
  assert.equal(reports.fresh(0,10000,'presence',0,true),false);
  assert.equal(reports.fresh(0,9999,'presence',0,true),true);
  assert.equal(reports.fresh(0,10000,'presence'),true);
 }],
 ['a time with no value is stale', reports=>{
  for(const at of [undefined,NaN,'x']) assert.equal(reports.fresh(at,1000),false,String(at));
 }],
 ['a time ahead of now is fresh only within the measured clock difference', reports=>{
  assert.equal(reports.fresh(1001,1000),false,'a coordinator stamp is never ahead');
  assert.equal(reports.fresh(1200,1000,'report',250),true);
  assert.equal(reports.fresh(1300,1000,'report',250),false);
 }],
 ['the walk reading is A20: 3 s with an attacker known or no interval, two intervals otherwise', reports=>{
  const walk=(attackerKnown,intervalMs)=>({reading:'walk',attackerKnown,intervalMs});
  assert.equal(reports.fresh(0,3000,walk(true,1000)),true);
  assert.equal(reports.fresh(0,3001,walk(true,1000)),false);
  assert.equal(reports.fresh(0,2000,walk(false,1000)),true);
  assert.equal(reports.fresh(0,2001,walk(false,1000)),false);
  assert.equal(reports.fresh(0,4000,walk(false,2000)),true);
  assert.equal(reports.fresh(0,3000,walk(false,undefined)),true);
  assert.equal(reports.fresh(0,3001,walk(false,0)),false);
 }],
 ['the settings owner\'s values set the ages, and a value its check refuses changes nothing', reports=>{
  try {
   reports.setReadings({reportFreshMs:5000,reportPresenceMs:'soon'});
   assert.equal(reports.fresh(0,5000),true);
   assert.equal(reports.fresh(0,10000,'presence'),true);
   assert.equal(reports.fresh(0,10001,'presence'),false);
  } finally { reports.setReadings({reportFreshMs:3000}); }
  assert.equal(reports.fresh(0,3001),false);
 }],
 ['the measured clock difference is half the network time of the last clock sync', reports=>{
  assert.equal(reports.clockError({clock:{networkMs:180}}),90);
  for(const transport of [undefined,null,{},{clock:{}}]) assert.equal(reports.clockError(transport),0);
  assert.equal(reports.reportClockError({travelSample:{transport:{clock:{networkMs:40}}}}),20);
  assert.equal(reports.reportClockError(undefined),0);
 }],
 ['a character adds its own clock difference, so a coordinator stamp it reads may look that far ahead', reports=>{
  try {
   reports.setClockError({clock:{networkMs:100}});
   assert.equal(reports.fresh(1050,1000),true);
   assert.equal(reports.fresh(1051,1000),false);
   assert.equal(reports.fresh(1080,1000,'report',30),true);
  } finally { reports.setClockError(null); }
  assert.equal(reports.fresh(1001,1000),false);
 }],
]);

// The follow mover: today's followLeaderIfFar, moved into movers.ts, answering
// `movement.followIfFar`. Each row plants the ports shared.js hands it.
function followWorld(over = {}) {
  const walks = [], logs = [], following = [];
  const me = { name: 'P', map: 'main', x: 0, y: 0, moving: false };
  const state = { at: { map: 'main', x: 200, y: 0 }, held: false, routed: false, scatter: false, follows: true, kiting: false, leaves: false,
    intent: { cancelled: false, revision: 1 }, followsMe: false, leader: 'W', current: true, escaping: false, assigned: true,
    event: null, mapEvents: {}, entities: { m1: { type: 'monster' } }, ...over };
  const ports = { character: () => me, followMe: () => state.followsMe ? { location: state.at } : null, leaderLocation: () => state.at,
    approachRouted: () => state.routed, scatter: () => state.scatter,
    townActive: () => state.held === 'town', convoyActive: () => state.held === 'convoy', groupWalking: () => state.held === 'walk',
    departurePending: () => state.held === 'departure', bankQueued: () => state.held === 'bank',
    shouldFollowLeader: () => state.follows, kiting: () => state.kiting,
    activeEvent: () => state.event, mapEvent: map => state.mapEvents[map],
    intent: () => state.intent, followsMe: () => state.followsMe, leader: () => state.leader, following: on => following.push(on),
    joinEvent: async () => { if (state.onJoin) state.onJoin(state); }, current: () => state.current, escaping: () => state.escaping,
    reunionAssigned: () => state.assigned, walk: async to => { if (state.walkError) throw { reason: state.walkError }; walks.push(to); }, gameLog: m => logs.push(m),
    partyList: () => ['P', 'W'], focus: () => ['goo'], joinedEvent: () => state.joined ?? null, franky: () => false, fightsAdds: event => event === state.addsEvent,
    rareControl: () => null, farmSpot: () => ({ map: 'main', x: 5, y: 6 }), inFarmArea: point => point.x < 100, now: () => 4321,
    root: () => ({ parent: { entities: state.entities }, G: { maps: {} }, can_move_to: x => x < 50, can_move: m => m.y < 50 }),
    service: () => ({ stepAllows: to => to.x < 40, audit() {}, holdStep() {}, step: () => ({ sent: Promise.resolve() }) }) };
  const { createFollow, createMoverView } = require('../../runtime/movement/character/movers.ts');
  return { follow: createFollow(ports), view: createMoverView(ports), walks, logs, following, me, state };
}
scenarioTable('the follow mover walks to the leader past the distance, as followLeaderIfFar did, and the mover view reads as the role runner moverView did (appendix A2 VIEW)', followWorld, [
 ['a member farther than the distance walks to the leader, and one inside it stays', async w => {
  assert.equal(await w.follow.followLeaderIfFar(), true);
  assert.deepEqual(w.walks, [{ map: 'main', x: 200, y: 0 }]);
  assert.deepEqual(w.following, [true, false], 'the follow flag holds while the walk runs');
  w.state.at = { map: 'main', x: 100, y: 0 };
  assert.equal(await w.follow.followLeaderIfFar(), false);
  assert.equal(w.walks.length, 1);
  w.state.at = { map: 'halloween', x: 10, y: 0 };
  assert.equal(await w.follow.followLeaderIfFar(), true, 'another map is always far');
 }],
 ['a held walk, Scatter, a routed approach, a kite, no leader to follow or an event exit takes no walk', async () => {
  for (const over of [{ held: 'town' }, { held: 'convoy' }, { held: 'walk' }, { held: 'departure' }, { held: 'bank' }, { scatter: true }, { routed: true }, { follows: false }, { at: null }, { kiting: true },
   { event: { name: 'goobrawl' }, mapEvents: { main: 'goobrawl' }, at: { map: 'halloween', x: 0, y: 0 } }]) {
   const w = followWorld(over);
   assert.equal(await w.follow.followLeaderIfFar(), false, JSON.stringify(over));
   assert.deepEqual(w.walks, []);
  }
 }],
 ['a follower on the active event map stays for the fight, and follows off any other map, as followLeavesCurrentEvent did (appendix A2 RANK)', () => {
  const {followLeavesCurrentEvent}=require('../../runtime/movement/rules.ts'),event={name:'goobrawl'};
  assert.equal(followLeavesCurrentEvent(event,{map:'main'},'goobrawl','goobrawl'),true);
  assert.equal(followLeavesCurrentEvent(event,{map:'goobrawl'},'goobrawl','goobrawl'),false,'the leader is on the same map');
  assert.equal(followLeavesCurrentEvent(event,{map:'main'},'halloween',undefined),false,'the map is not an event map');
  assert.equal(followLeavesCurrentEvent(null,{map:'main'},'goobrawl','goobrawl'),false,'no combat event runs');
  assert.equal(followLeavesCurrentEvent(event,null,'goobrawl','goobrawl'),false);
 }],
 ['a member already moving takes the tick with no new walk', async () => {
  const w = followWorld(); w.me.moving = true;
  assert.equal(await w.follow.followLeaderIfFar(), true);
  assert.deepEqual(w.walks, []);
 }],
 ['a change while the event join runs ends the follow before it walks', async () => {
  for (const change of [s => { s.intent = { cancelled: false, revision: 2 }; }, s => { s.leader = 'M'; }, s => { s.escaping = true; },
   s => { s.assigned = false; }, s => { s.current = false; }, s => { s.held = 'town'; }]) {
   const w = followWorld({ onJoin: change });
   assert.equal(await w.follow.followLeaderIfFar(), false);
   assert.deepEqual(w.walks, []);
  }
 }],
 ['a refused walk asks again on the next tick with no log, and a failed one logs', async () => {
  for (const [reason, logged] of [['refused', 0], ['interrupted', 0], ['no path', 1]]) {
   const w = followWorld({ walkError: reason });
   assert.equal(await w.follow.followLeaderIfFar(), true);
   assert.deepEqual([w.logs.length, w.following], [logged, [true, false]], reason);
  }
 }],
 ['the mover view hands an add-on the party, leader, focus, farm spot and the tick, read when the tick asks', w => {
  {
   const target = { id: 'm1' }, view = w.view({ target, combat: true });
   assert.deepEqual([view.character, view.target, view.combat, view.party, view.leader, view.focus, view.farmSpot, view.joinedEvent, view.fightsAdds],
    [w.me, target, true, ['P', 'W'], 'W', ['goo'], { map: 'main', x: 5, y: 6 }, null, false]);
   assert.equal(view.entities, w.state.entities);
   assert.equal(view.now, 4321, "the view's clock is the owner's");
   assert.deepEqual([view.canMoveTo({ x: 10, y: 0 }), view.canMoveTo({ x: 60, y: 0 }), view.inFarmArea({ x: 10, y: 0 }), view.inFarmArea({ x: 200, y: 0 })], [true, false, true, false]);
   // The terrain checks answer from the game and the step check from the owner's service, never
   // "clear" by default.
   assert.deepEqual([view.canStand({ x: 0, y: 10 }), view.canStand({ x: 0, y: 60 }), view.stepSafe({ x: 10, y: 0 }), view.stepSafe({ x: 45, y: 0 })], [true, false, true, false]);
   w.state.leader = 'R'; w.state.joined = 'franky'; w.state.addsEvent = 'franky';
   assert.deepEqual((({ leader, joinedEvent, fightsAdds }) => [leader, joinedEvent, fightsAdds])(w.view({ combat: false })), ['R', 'franky', true]);
  }
 }],
 // and: the tick runs the convoy defence triggers after the hold, reads the combat gate itself, and
 // asks the turns owner for no edge. The two event rows are the events owner's movers: the tick asks
 // combat.ts's published `movers` through api.ts `eventFacts()`.
 ['the movement tick runs the core movers in T6\'s order and an add-on answer before its mover, as the role runner\'s movementTick did (R2.3), the farm approach waiting only while a selection is due', () => {
  const { createMovementTick, MOVEMENT_TICK_MS } = require('../../runtime/movement/character/movers.ts');
  const calls = [], timers = [], s = { target: { id: 'm1' }, dungeon: false, held: false, addon: null, before: null, due: true };
  const log = (name, answer = false) => (...args) => { calls.push(name); return typeof answer === 'function' ? answer(...args) : answer; };
  const routine = { dungeonOwned: () => s.dungeon, resetCombatMovement: log('reset'), defensiveFormationMove: log('defensive'),
    pollRareHunting: log('rare'),
    pollFarmingCombatHandoff: log('handoff'), groupedMovement: log('grouped', first => first()),
    recoverFarmApproach: log('approach'), caveRecoveryMove: log('cave'), formationMove: log('formation'),
    kiteIfNeeded: log('kite', () => new Promise(() => {})), approachCombatTarget: log('approachTarget'), endAddonWalk: log('endAddon'),
    convoyDefenseTriggers: log('defense') };
  const game = { __partyHooks: { moving: () => !!s.addon, moverAnswer: () => s.addon, before: (a, core) => !!a && core === s.before,
    turns: { target: () => s.due ? { due: true } : undefined }, skills: { allows: () => undefined } },
    __partyMovement: { audit: log('audit'), step: to => (calls.push('step:' + to.x), { sent: Promise.resolve() }) },
    setInterval: (run, ms) => { const t = { run, ms }; timers.push(t); return t; }, clearInterval: t => { t.off = true; } };
  const runner = { held: () => s.held, equipment: log('equipment'), reselect: log('reselect'), target: () => s.target,
    refresh: log('refresh'), report: e => { throw e; } };
  const facts = globalThis.__partyEventFacts;
  globalThis.__partyEventFacts = { movers: { 'event-return-combat': log('return'), 'franky-approach': log('frankyApproach') } };
  try {
  // Movement's `act` handle times on the game's timers, which the row drives.
  const scope = require('./helpers/run-scope.cjs').contextScope(game, '02', 'act');
  const stop = createMovementTick({ root: () => game, service: () => game.__partyMovement, movers: () => routine, now: () => 0, scope }, () => ({}))(runner);
  assert.deepEqual(timers.map(t => t.ms), [MOVEMENT_TICK_MS]);
  const tick = () => { calls.length = 0; timers[0].run(); return calls.slice(); };
  assert.deepEqual(tick(), ['audit', 'defense', 'equipment', 'return', 'frankyApproach', 'rare', 'handoff', 'reselect', 'refresh',
   'grouped', 'approach', 'formation', 'kite'], 'with a target');
  s.target = null;
  assert.deepEqual(tick(), ['audit', 'defense', 'equipment', 'return', 'frankyApproach', 'rare', 'handoff', 'reselect', 'refresh',
   'grouped', 'defensive', 'reset'], 'no target, a selection due: the farm approach waits, the idle mover resets');
  s.due = false;
  assert.deepEqual(tick().slice(-4), ['grouped', 'approach', 'defensive', 'reset'], 'no target and no selection due: the farm approach moves at once (TGT-Q24 (a))');
  s.due = true;
  s.dungeon = true;
  assert.deepEqual(tick(), ['audit', 'defense', 'equipment', 'reselect', 'refresh', 'cave', 'reset'], 'in the Cave');
  s.dungeon = false; s.target = { id: 'm1' }; s.addon = { registration: 'x', mover: { tier: 'formation' }, answer: { kind: 'step', to: { x: 7, y: 0 } } };
  s.before = 'target-formation';
  assert.deepEqual(tick().slice(-3), ['approach', 'endAddon', 'step:7'], 'the add-on answers before target-formation');
  s.before = 'grouped-target-formation';
  assert.deepEqual(tick().slice(-3), ['grouped', 'endAddon', 'step:7'], 'a positions mover asks the add-on itself');
  s.held = true;
  assert.deepEqual(tick(), ['audit', 'reset'], 'a held character only resets');
  stop(); assert.equal(timers[0].off, true);
  } finally { globalThis.__partyEventFacts = facts; }
 }],
 ['movement.followIfFar is answered by followLeaderIfFar itself', async w => {
  const { createRegistry } = require('../../runtime/hooks/registry.ts');
  const { publishFollow } = require('../../runtime/movement/character/movers.ts');
  const hooks = createRegistry();
  hooks.register({ name: 'core:role-runner', folder: 'core', author: 'x', summary: 'x', hooks: {} });
  publishFollow(w.follow, hooks);
  assert.equal(await hooks.ask('movement.followIfFar', { character: 'P' }), true);
  assert.equal(w.walks.length, 1);
  // The ask carries no distance; movement's FOLLOW_DISTANCE decides it.
  w.state.at = { map: 'main', x: 100, y: 0 };
  assert.equal(await hooks.ask('movement.followIfFar', { character: 'P' }), false, 'a member inside FOLLOW_DISTANCE stays');
  assert.equal(w.walks.length, 1);
 }],
 // The realm switch asks `walks.end`, which core:movement answers on the coordinator over the named
 // group's walk.
 ['walks.end ends the named group walk with its code, and the ask fails without an answer', () => {
  const { createRegistry } = require('../../runtime/hooks/registry.ts');
  const { installCoordinatorMovement } = require('../../runtime/movement/coordinator/runtime.ts');
  const hooks = createRegistry(), cancelled = [];
  assert.throws(() => hooks.walks.end('party:L', 'realm-switch'), /walks.end has no answer/);
  const group = (id, convoy) => ({ partyConvoys: { cancel: reason => cancelled.push([id, reason]) }, state: { activeConvoy: convoy } });
  const groups = { 'party:L': group('party:L', { id: 'c1' }), 'solo:M': group('solo:M', null) };
  installCoordinatorMovement(hooks, id => groups[id], { time: async () => 0, statuses: () => ({}) });
  assert.equal(hooks.walks.end('party:L', 'realm-switch'), true);
  assert.equal(hooks.walks.end('solo:M', 'realm-switch'), false, 'a group with no walk has none to end');
  assert.deepEqual(cancelled, [['party:L', 'party departed for another realm']]);
 }],
 // The terrain recovery round is coordinator code, so the character bundles leave it out and
 // core:movement answers the queue's ask on the coordinator.
 ['the queue\'s recovery ask answers on the coordinator, and the character bundle is built without the round', () => {
  const { createRegistry } = require('../../runtime/hooks/registry.ts');
  const { installCoordinatorMovement } = require('../../runtime/movement/coordinator/runtime.ts');
  const { buildSync } = require('esbuild');
  const built = buildSync({ entryPoints: ['runtime/characters/legacy-entry.ts'], bundle: true, write: false, format: 'iife', platform: 'browser' });
  assert.ok(!built.outputFiles[0].text.includes('function recoveryRound('), 'the character bundle carries no recovery round');
  const hooks = createRegistry();
  installCoordinatorMovement(hooks, () => undefined, { time: async () => 0, statuses: () => ({}) });
  assert.equal(hooks.movement.formationRecovery(null, [], null, 'key', 0, false, 160, ''), undefined, 'no target, no round');
 }],
]);

// The departure gate (`townReady`, `transitionReady`, moved into walk-client.ts): a Town
// cast waits while a departure fight is pending or an eligible chest is left, and any other map
// change waits for the chests alone. The pending fight is targeting's published read.
scenarioTable('the departure gate waits on the departure fight and the chests, as townReady and transitionReady did', ()=>{
  const { createRegistry } = require('../../runtime/hooks/registry.ts');
  const { departureGate } = require('../../runtime/movement/character/walk-client.ts');
  const world = { pending: false, chests: [] }, hooks = createRegistry();
  hooks.register({ name: 'core:targeting', folder: 'core', author: 'x', summary: 'x', hooks: { 'targeting.departurePending': () => world.pending } });
  return { world, gate: departureGate({ chests: () => world.chests, attackers: () => [], windowMs: () => 0, now: () => 0 }, hooks) };
}, [
 ['no fight and no chest lets both go; a chest holds both; a pending fight holds the Town cast only', ({ world, gate }) => {
  assert.deepEqual([gate.townReady(), gate.transitionReady()], [true, true]);
  world.chests = ['c1'];
  assert.deepEqual([gate.townReady(), gate.transitionReady()], [false, false]);
  world.chests = []; world.pending = true;
  assert.deepEqual([gate.townReady(), gate.transitionReady()], [false, true]);
 }],
]);

// A job's combat wait (`afterCombat`): the errand request waits in the owner and
// starts when combat lets go, an event in place of the 250 ms poll.
scenarioTable('a job asked while its character fights waits on combat and starts when combat lets go, as shared.js afterCombat did (appendix A2 RANK)', ()=>{
  const scenario = require('./fixtures/movement-service-scenario.cjs');
  scenario.targetIds.length = 0;
  const world = { fight: true, current: true, started: [] };
  const f = scenario.fixture(), ask = owner => f.service.afterCombat({ kind: 'errand', owner, current: () => world.current }, () => world.fight)
    .then(started => world.started.push([owner, started]));
  return { ...f, world, ask, targetIds: scenario.targetIds };
}, [
 ['a job asked during a fight starts only when combat lets go with no fight left, and clears the combat target', async ({ service, world, ask, targetIds, settle = () => new Promise(r => setImmediate(r)), dispose }) => {
  const job = ask('errand:bank');
  service.letGo(); await settle();
  assert.deepEqual(world.started, [], 'combat let go while the fight test still reads a fight');
  world.fight = false; await settle();
  assert.deepEqual(world.started, [], 'the fight ending alone is no event: the job waits for combat to let go');
  service.letGo(); await job;
  assert.deepEqual(world.started, [['errand:bank', true]]);
  assert.deepEqual(targetIds, [[null, 'errand:bank']]);
  assert.deepEqual(service.records().filter(r => r.cause === 'combat').map(r => r.decision), ['waiting', 'resumed']);
  dispose();
 }],
 ['a job asked with no fight starts at once', async ({ world, ask, targetIds, dispose }) => {
  world.fight = false;
  await ask('errand:upgrade');
  assert.deepEqual(world.started, [['errand:upgrade', true]]);
  assert.deepEqual(targetIds, [[null, 'errand:upgrade']]);
  dispose();
 }],
 ['a job whose currency test lapses while it waits never starts, on the next tick with no let-go', async ({ world, ask, ticks, targetIds, dispose }) => {
  const job = ask('errand:farming');
  world.current = false; await ticks(1); await job;
  assert.deepEqual(world.started, [['errand:farming', false]]);
  assert.deepEqual(targetIds, []);
  dispose();
 }],
]);

scenarioTable('the owner reads the console pause sources, as shared.js consoleMovementPaused did', ()=>{
  const { fixture } = require('./fixtures/movement-service-scenario.cjs');
  return fixture();
}, [
 // The lifecycle owner's drain decides when it parks (lifecycle/character/drain.ts `park`), so the owner reads
 // Manual and the drain's answer.
 ['Manual holds movement, and so does the drain while it says park', ({ service, ports, dispose }) => {
  const set = (values) => Object.assign(ports.pauses, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, () => v])));
  assert.equal(service.consolePaused(), false);
  set({ manual: true }); assert.equal(service.consolePaused(), true);
  set({ manual: false, drainPark: true }); assert.equal(service.consolePaused(), true);
  set({ drainPark: false }); assert.equal(service.consolePaused(), false);
  dispose();
 }],
 // The game's runner calls the scheduler every 80 ms outside the run scope, so a held character's
 // journey still ticks.
 ['the Pause pauses a live journey and Play resumes it', async ({ service, ports, ticks, dispose }) => {
  const walk = service.move({ map: 'main', x: 100, y: 0 }, undefined, { request: { kind: 'manual', owner: 'manual:test' } }).catch(() => {});
  ports.pauses.held = () => true; await ticks(2);
  ports.pauses.held = () => false; await ticks(2);
  const context = service.records().filter(r => r.cause === 'context');
  assert.deepEqual(context.map(r => r.decision), ['paused', 'resumed']);
  assert.ok(context.every(r => r.journeyId), 'each names the journey');
  dispose(); await walk;
 }],
]);

scenarioTable('the Town requests answer as shared.js enforcePartyTownOverride and returnWorkflowSuperseded did (appendix A2 TOWN, RANK)', ()=>{
  const { installMovementRequesters } = require('../../runtime/movement/character/owner.ts');
  // The game's Town readiness (class G): a cast puts `use_town` on cooldown until the row clears it.
  const world = { c: { name: 'W', ctype: 'warrior', map: 'cave', x: 0, y: 0 }, root: { parent: {}, partySurvival: { townGoal: () => null, isSafeAt: () => false },
    can_use: skill => skill === 'use_town', is_on_cooldown: skill => skill === 'use_town' && world.cooldown },
    town: { active: true, traveling: false }, departure: false, following: true, walk: { cancelled: false }, released: [], holds: [], casts: 0, cooldown: false, job: null };
  const movement = { hold: request => { world.holds.push(request.owner); return 'granted'; }, live: () => null, release() {}, clicking: () => false,
    endCode: () => null, town: async () => { world.casts++; world.cooldown = true; } };
  const client = { groupWalk: { get travel() { return world.walk; } }, releaseConvoyCruise: walk => world.released.push(walk) };
  const requesters = installMovementRequesters(client, { now: () => 10000, movement: () => movement, smartMove: async () => {}, character: () => world.c,
    G: () => ({ maps: {} }), sleep: async () => {}, root: () => world.root, current: () => true, sharedMovementOptions: () => ({}),
    coordinatorCommand: () => ({ command: null, seen: false }), assignedTier: fallback => fallback,
    withTimeout: promise => promise, request: async () => ({}), returnPhaseRecord: () => ({}), escaping: () => false, town: () => world.town,
    ...walkStatePorts(world), keepReturnProgress: progress => { world.root.progress = progress; },
    setDeparture: pending => { world.departure = pending; }, endFollow: () => { world.following = false; },
    respawn: async () => {}, parent: () => ({}), merchantJob: () => world.job });
  return { world, requesters };
}, [
 // The errand request names the merchant's running job when a walk reads it, and a
 // fighter's errand keeps the one identity.
 ['a merchant errand names its running job, and an errand with no job stays `errand`', ({ world, requesters }) => {
  assert.deepEqual({ ...requesters.errandRequest }, { kind: 'errand', owner: 'errand' });
  world.job = { jobId: 'service-4', commandId: 17 };
  assert.equal(requesters.errandRequest.owner, 'job:service-4:17');
  assert.equal(JSON.parse(JSON.stringify(requesters.errandRequest)).owner, 'job:service-4:17');
  world.job = null;
  assert.equal(requesters.errandRequest.owner, 'errand');
 }],
 ['the override ends the walk and the follow, claims and casts once from where the fighter stands, and keeps the departure up while the party Town lasts', async ({ world, requesters }) => {
  await requesters.enforcePartyTownOverride();
  assert.equal(world.walk.cancelled, true); assert.deepEqual(world.released, [world.walk]);
  assert.equal(world.following, false); assert.equal(world.casts, 1); assert.ok(world.holds.includes('town:override'));
  assert.equal(world.departure, true);
  await requesters.enforcePartyTownOverride();
  assert.equal(world.casts, 1, 'a cast while the game holds use_town on cooldown is not repeated');
  world.cooldown = false; await requesters.enforcePartyTownOverride();
  assert.equal(world.casts, 2, 'the override casts again once the game allows use_town');
 }],
 ['the retained Town command owns the channel: the override never casts over it', async ({ world, requesters }) => {
  world.root.__partyTownCycleId = 'cycle'; await requesters.enforcePartyTownOverride();
  assert.equal(world.casts, 0); assert.equal(world.walk.cancelled, false);
 }],
 // The report wait of the event exit, the event search, the Town return and the reunion (owner.ts
 // `reportOrSilence`): a report that never comes, from a stalled report loop or a lost connection,
 // ends the wait at two report gaps through reportSilence; a report that comes first fires nothing.
 // The harness's sleep ends at once, so the silence comes on the next tick. Isolated: a live row
 // cannot stall one character's report loop inside one wait.
 ['a report wait frees on silence through reportSilence, and a report that comes first fires nothing', async ({ requesters }) => {
  const { boundsPending } = require('../../runtime/status/api.ts');
  const fired = () => boundsPending().filter(f => f.bound === 'reportSilence' && f.state.holder === 'event-exit').length, before = fired();
  assert.equal(await requesters.reportOrSilence('event-exit'), false, 'the wait outlived the silence');
  assert.equal(fired(), before + 1, 'the silence did not tell the bound record');
  const wait = requesters.reportOrSilence('event-exit');
  requesters.reportSucceeded();
  assert.equal(await wait, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fired(), before + 1, 'a wait the report ended fired the bound');
 }],
 ['a 409 superseded return ends the Town return; any other error does not', ({ requesters }) => {
  const error = reason => ({ partyRequest: { path: '/return-progress', status: 409, reason } });
  assert.equal(requesters.returnWorkflowSuperseded(error('return workflow superseded')), true);
  assert.equal(requesters.returnWorkflowSuperseded(error('other')), false);
  assert.equal(requesters.returnWorkflowSuperseded(new Error('x')), false);
 }],
]);
scenarioTable('the reunion crossings answer as shared.js reunionCm, root.on_cm and farmReunionTick\'s travel did (appendix A2 REU, the REUW split)', ()=>{
  const { installReunionCrossings } = require('../../runtime/movement/character/crossings.ts');
  const { createOwnerLadder } = require('../../runtime/protocol/ladder.ts');
  const previousCm = () => 'previous', previousMagiport = () => 'previous';
  // `waits` records each sleep, which runs the clock on; `reported` ends the wait for the next
  // report; `roundTrip` is the call budget's measured round trip.
  const world = { now: 100000, root: { on_cm: previousCm, on_magiport: previousMagiport }, sent: [], moves: [], options: [], waits: [],
    c: { name: 'M', ctype: 'mage', map: 'main', x: 0, y: 0, mp: 3000, max_mp: 3000, c: {} }, reunion: null, ladders: {}, ended: [],
    positions: [{ name: 'R', map: 'main', server: 'USII', seenAt: 100000 }, { name: 'M', map: 'winterland', server: 'USII', seenAt: 100000 }],
    fail: null, blink: async () => {}, reported: null, roundTrip: 200 };
  const report = name => { world.positions.find(p => p.name === name).seenAt = world.now += 1000; };
  const host = { parent: { server_region: 'US', server_identifier: 'II' }, can_move_to: () => true, can_move: () => true, is_on_cooldown: () => false, can_use: () => true,
    is_transporting: () => false, game_log() {}, send_cm: async (name, data) => { world.sent.push({ name, ...data }); } };
  const crossings = installReunionCrossings(host, { now: () => world.now, character: () => world.c,
    G: () => ({ maps: { main: {}, winterland: {} }, skills: { magiport: { mp: 900 }, blink: { mp: 1600 } } }),
    movement: () => ({ fresh: () => true, roundTrip: () => world.roundTrip,
      climb: (owner, round) => world.ladders[owner] ||= createOwnerLadder(round, () => world.now), endClimb: owner => { world.ended.push(owner); } }), root: () => world.root, reunion: () => world.reunion, reunionBlocked: () => false,
    reunionMembers: () => [{ name: 'M', ctype: 'mage', map: 'winterland', x: 0, y: 0 }], reunionCurrent: () => true,
    escaping: () => false, escape: () => ({ state: null, local: null }), partyLocation: () => ({ map: 'main', x: 0, y: 0 }),
    partyPositions: () => world.positions, desiredPartyMembers: () => ['M', 'R'], leader: () => 'M', scatter: () => false,
    clockOffset: () => 0, intent: () => ({ revision: 1 }), engagedMonster: () => null, entryPoint: location => location,
    sharedPartyWalk: async () => {}, stop: async () => {}, timed: request => request,
    smartMove: async (destination, _callback, options) => { world.moves.push(destination); world.options.push(options); if (world.fail) throw Error(world.fail); },
    sleep: ms => new Promise(resolve => setImmediate(resolve)).then(() => { world.waits.push(ms); world.now += ms; }),
    // Each owner scheduler pass (owner.ts `nextPass`) stands for 100 ms of the world's clock.
    nextPass: () => new Promise(resolve => setImmediate(resolve)).then(() => { world.waits.push(100); world.now += 100; }),
    reportOrSilence: () => new Promise(resolve => { world.reported = resolve; }), blinkAs: (_request, x, y) => world.blink(x, y),
    reunionRequest: token => ({ kind: 'task-walk', owner: 'reunion:' + token.id, tier: 'farming' }) });
  return { world, crossings, report };
}, [
 ['unloading gives the game back the handlers it found, and leaves a newer runtime\'s handlers in place', ({ world, crossings }) => {
  assert.notEqual(world.root.on_cm, undefined); assert.equal(world.root.on_cm('R', { type: 'other' }), undefined);
  crossings.restoreReunionHandlers();
  assert.equal(world.root.on_cm(), 'previous'); assert.equal(world.root.on_magiport(), 'previous');
  const newer = () => 'newer'; world.root.on_cm = newer; crossings.restoreReunionHandlers();
  assert.equal(world.root.on_cm, newer);
 }],
 ['a mage answers a request with one offer, and a second request gets none until the member has reported twice since the offer, past 10 s', async ({ world, crossings, report }) => {
  const request = { type: 'farm-reunion', action: 'request', id: 'R-1', revision: 1, realm: 'USII' };
  await crossings.reunionCm('R', request); await crossings.reunionCm('R', request);
  assert.deepEqual(world.sent.map(m => m.action), ['offer']);
  world.now += 20000; await crossings.reunionCm('R', request);
  report('R'); await crossings.reunionCm('R', request);
  assert.deepEqual(world.sent.map(m => m.action), ['offer'], 'no answer is due before its second report');
  report('R'); await crossings.reunionCm('R', request);
  assert.deepEqual(world.sent.map(m => m.action), ['offer', 'offer']);
 }],
 ['a travel try waits out a crossing in progress, asks a mage farther than 300 for Magiport once and waits for its answer until the mage has reported twice, past 10 s, and a reunion wait lasts until the next report', async ({ world, crossings, report }) => {
  const token = { id: 'R-1', revision: 1, retryAt: 0, command: null, portAttempted: false };
  const target = { member: { name: 'M', map: 'winterland', x: 0, y: 0 }, distance: Infinity, arrived: true, independent: false };
  crossings.reunionCrossing.working = true; await crossings.reunionTravel(token, target);
  assert.deepEqual(world.sent, []); assert.deepEqual(world.moves, []);
  crossings.reunionCrossing.working = false; await crossings.reunionTravel(token, target);
  assert.deepEqual(world.sent.map(m => [m.name, m.action]), [['M', 'request']]); assert.equal(token.phase, 'requesting-magiport');
  world.now += 20000; await crossings.reunionTravel(token, target); report('M'); await crossings.reunionTravel(token, target);
  assert.deepEqual(world.moves, [], 'the mage has not reported twice since the request');
  report('M'); await crossings.reunionTravel(token, target);
  assert.deepEqual(world.sent.length, 1); assert.deepEqual(world.moves, [{ map: 'winterland' }]);
  crossings.reunionWait(token); await crossings.reunionTravel(token, target);
  assert.equal(world.moves.length, 1, 'a reunion wait holds the next try');
  world.reported(); await new Promise(resolve => setImmediate(resolve)); await crossings.reunionTravel(token, target);
  assert.equal(world.moves.length, 2);
 }],
 ['a failed route try climbs the task round when it ends: the other route next, with no route bound or retry clock of its own', async ({ world, crossings }) => {
  const token = { id: 'R-2', revision: 1, retryAt: 0, command: null, portAttempted: true };
  const target = { member: { name: 'R', map: 'winterland', x: 0, y: 0 }, distance: Infinity, arrived: true, independent: true };
  world.fail = 'Stalled walking movement'; await crossings.reunionTravel(token, target);
  assert.equal(token.lastError, 'Stalled walking movement'); assert.ok(!token.retryAt);
  world.fail = null; await crossings.reunionTravel(token, target);
  assert.deepEqual(world.moves, [{ map: 'winterland' }, { map: 'winterland' }]);
  assert.equal(world.options[1].native, true, "the second try is the round's other route");
  assert.deepEqual(world.waits, [], 'no clock bounds or delays a try');
  assert.deepEqual(world.ended, ['reunion:R-2']);
 }],
 // crossingRoundTrip (bigcheck/bounds.md): the lost Blink queues its firing for the next report, and
 // an answered one queues none.
 ["a Blink ends on the game's answer, a lost one a measured round trip after it, and an answered Blink waits past 3 s for its blink condition to land", async ({ world, crossings }) => {
  const { boundsPending, boundsSent } = require('../../runtime/status/api.ts');
  boundsSent(boundsPending().length);
  world.c.map = 'winterland';
  const target = { member: { name: 'R', map: 'winterland', x: 400, y: 0 }, distance: 400, arrived: true, independent: true };
  world.blink = () => new Promise(() => {});
  const lost = { id: 'R-3', revision: 1, retryAt: 0, command: null, portAttempted: true };
  await crossings.reunionTravel(lost, target);
  assert.ok(world.waits.includes(world.roundTrip)); assert.match(lost.lastError, /round trip/);
  assert.deepEqual(boundsPending().map(f => [f.bound, f.owner, f.state.ms]), [['crossingRoundTrip', '02', world.roundTrip]]);
  boundsSent(1);
  assert.deepEqual(world.moves, [{ map: 'winterland', x: 400, y: 0 }], 'the route follows a lost Blink');
  const landsAt = world.now + 4000;
  world.blink = async () => { world.c.s = { blink: {} }; };
  const sleep = world.waits.length;
  const answered = { id: 'R-4', revision: 1, retryAt: 0, command: null, portAttempted: true };
  const tick = setInterval(() => { if (world.now >= landsAt) { world.c.x = 400; world.c.s = {}; } }, 0);
  try { await crossings.reunionTravel(answered, target); } finally { clearInterval(tick); }
  assert.equal(world.c.x, 400); assert.ok(world.waits.slice(sleep).reduce((a, b) => a + b, 0) >= 4000);
  assert.equal(world.moves.length, 1, 'no route after a Blink that lands');
  assert.deepEqual(boundsPending(), [], 'an answered Blink trips no bound');
 }],
]);
scenarioTable('the walk defense answers as shared.js acceptConvoyDefenseCommand, interruptConvoyForDefense and travelCombatActive did (appendix A2 DEF)', ()=>{
  const { createWalkDefense } = require('../../runtime/movement/character/walk-client.ts');
  const world = { intent: { revision: 2 }, travel: null, token: null, stops: 0, released: 0, wakes: 0, created: [] };
  const host = { parent: { entities: {}, socket: { connected: true } }, game_log() {}, partyRoleRunner: { wake() { world.wakes++; } } };
  const client = { groupWalk: world, releaseConvoyCruise: () => { world.released++; },
    createLocalConvoy: command => { world.created.push(command.id); return world.travel = { id: command.convoyId, epoch: Number(command.epoch), navigationRevision: command.navigationRevision }; } };
  const defense = createWalkDefense(host, client, { ...walkStatePorts(host), now: () => 5000, character: () => ({ name: 'W' }), current: () => true,
    intent: () => world.intent, farmTravel: () => world.token, huntOutbound: () => false, huntExtraAggro: () => false,
    huntControl: () => null, grouped: () => true, groupedCombat: () => null, leader: () => 'L', partyList: () => ['W', 'L'],
    fightDeaths: () => [], engaged: () => true, entityReport: e => ({ id: e.id, mtype: e.mtype }), passingKey: t => t.id, realm: () => 'USII',
    clockOffset: () => 7, convoyRequest: c => ({ kind: 'convoy', owner: c.id }), stop: () => { world.stops++; } });
  return { world, host, defense };
}, [
 // The one walk machine: a defense command from every phase installs the walk, the barrier phases'
 // included, which carried no route protocol marker before this change.
 ['a defense command answers only under the current revision; with no walk it installs the commanded walk and pauses it', ({ world, defense }) => {
  const command = { id: 4, convoyId: 'C', epoch: 1, phase: 'defending', navigationRevision: 1, purpose: 'monster-hunt',
    location: { map: 'main', x: 0, y: 0 }, participants: ['W', 'L'] };
  assert.equal(defense.acceptConvoyDefenseCommand(command), false); assert.deepEqual(world.created, []);
  command.navigationRevision = 2; assert.equal(defense.acceptConvoyDefenseCommand(command), true);
  assert.deepEqual(world.created, [4]); assert.equal(world.travel.phase, 'defending'); assert.equal(world.travel.commandId, 4); assert.equal(world.stops, 1);
  assert.equal(defense.acceptConvoyDefenseCommand({ ...command, purpose: 'event-return', id: 3 }), false);
 }],
 ['a local attacker pauses a walk once and names it, in every phase, and never touches an escape walk', ({ world, host, defense }) => {
  host.parent.entities.bee = { id: 'bee', type: 'monster', mtype: 'bee', target: 'W' };
  world.travel = { id: 'C', epoch: 1, navigationRevision: 2, phase: 'travelling' };
  defense.interruptConvoyForDefense(); defense.interruptConvoyForDefense();
  assert.equal(world.travel.defensePaused, true); assert.deepEqual(world.travel.defenseTargets.map(t => [t.id, t.server]), [['bee', 'USII']]);
  assert.equal(world.travel.defenseInterruption.source, 'local-attacker'); assert.equal(world.stops, 1); assert.equal(host.convoyDefense, 'C');
  // A walk casting Town for the walk (a barrier phase) pauses as well; before this change its command
  // carried no route protocol marker, and the attacker ended it.
  const town = world.travel = { id: 'D', epoch: 1, navigationRevision: 2, phase: 'casting-town' }; defense.interruptConvoyForDefense();
  assert.equal(world.travel, town); assert.equal(town.cancelled, undefined); assert.equal(town.defensePaused, true); assert.equal(world.released, 0); assert.equal(world.stops, 2);
  const escape = world.travel = { id: 'E', epoch: 1, navigationRevision: 2, purpose: 'escape-recovery' }; defense.interruptConvoyForDefense();
  assert.equal(world.travel, escape); assert.equal(escape.defensePaused, undefined); assert.equal(world.stops, 2);
 }],
 ['a defensive farm walk owns travel combat only under the current revision, and a closed socket gives no observation time', ({ world, host, defense }) => {
  world.token = { id: 'f', defensiveTravel: true, revision: 2 };
  assert.deepEqual(defense.localTravelCommand(), { id: 'f', revision: 2 }); assert.equal(defense.travelCombatActive(), true);
  world.token.revision = 1; assert.equal(defense.travelCombatActive(), false);
  host.__partyTravelCombat = { revision: 2 }; assert.equal(defense.travelCombatActive(), true);
  assert.equal(defense.travelObservationAt(), 5007); host.parent.socket.connected = false; assert.equal(defense.travelObservationAt(), 0);
 }],
]);
scenarioTable('the group movement answers as shared.js requestGroupApproach, groupedApproachReport and groupedMovement did (appendix A2 GRP)', ()=>{
  const { installGroupMovement } = require('../../runtime/movement/character/formation.ts');
  // `report` ends the wait for the leader's next report; `roundTrip` is the call budget's measured round trip.
  const world = { now: 1000, c: { name: 'W', map: 'main', in: 'main', x: 0, y: 0, range: 50, speed: 40 }, sent: [], ended: [], climbs: [], steps: [], report: null, roundTrip: 200,
    group: { key: 'k', selection: 's', range: 180, members: ['W', 'P'], blockers: ['W: far'], anchor: { name: 'P', server: 'USII', map: 'cave', in: 'cave', x: 400, y: 0 },
      target: { id: 'goo', server: 'USII', map: 'main', in: 'main' }, recovering: [] } };
  const host = { parent: { entities: {} }, get_entity: () => null, get_player: () => null, can_move_to: () => false,
    partyCombatPosition: { target: 'goo' },
    partySurvival: { taskRound: (G, name) => ['round', name] } };
  installCharacterEvents(host);
  let resolve;
  const moves = installGroupMovement(host, { groupWalk: { travel: null } }, { defensiveFormationMove: () => false, now: () => world.now, character: () => world.c, G: () => ({}),
    movement: () => ({ fresh: () => true, holdStep() {}, step: point => { world.steps.push(point); return { sent: Promise.resolve() }; },
      roundTrip: () => world.roundTrip, reportInterval: () => 1000 }),
    nextReport: () => new Promise(r => { world.report = r; }),
    intent: () => ({ revision: 3 }), groupedCombat: () => world.group, clockOffset: () => 0, leader: () => 'W', partyLocation: () => null,
    convoyActive: () => false, eventTraveling: () => false, joinedEvent: () => null, kite: () => ({}), formation: () => ({}),
    rareControl: () => null, grouped: () => true, fresh: () => true, anchorVisible: () => true, defensiveTarget: () => null, huntDefense: () => false,
    huntControl: () => null, rareActive: () => false, escaping: () => false, attacking: () => false, passiveRare: () => false, passingKey: t => t.id,
    realm: () => 'USII', combatDistance: () => 20, safeCombatPoint: () => true, cancelFarmApproach() {}, formationMove: () => true, holdFormation: () => true,
    logGroupMovement() {}, request: (path, options) => { world.sent.push(options.body); return new Promise(r => { resolve = r; }); },
    smartMove: async () => {}, catchupRequest: route => ({ kind: 'catchup', owner: 'catchup:' + route.key }),
    endTaskWalk: owner => { world.ended.push(owner); }, climbTaskWalk: walk => { world.climbs.push(walk.owner); } });
  return { world, host, moves, settle: async () => { resolve(); await new Promise(r => setImmediate(r)); } };
}, [
 // Class B: the pending ask ends with the leader's next report, not after 3 s.
 ['only the covered leader asks for a group approach, once while one is pending and not again before the next report', async ({ world, moves, settle }) => {
  const at = { map: 'main', x: 10, y: 0 };
  world.group.anchor = { name: 'W', server: 'USII', map: 'main', in: 'main', x: 0, y: 0 };
  assert.equal(moves.requestGroupApproach(at), true); assert.equal(moves.requestGroupApproach(at), true);
  assert.deepEqual(world.sent.map(b => [b.key, b.navigationRevision, b.selection]), [['k', 3, 's']]);
  await settle(); world.now += 60000; moves.requestGroupApproach(at); assert.equal(world.sent.length, 1);
  world.report(); await new Promise(r => setImmediate(r)); moves.requestGroupApproach(at); assert.equal(world.sent.length, 2);
 }],
 ['the approach report measures displacement from the last report of the same target', ({ world, moves }) => {
  assert.equal(moves.groupedApproachReport().displacement, 0);
  world.c.x = 30; world.c.y = 40; const report = moves.groupedApproachReport();
  assert.equal(report.displacement, 50); assert.equal(report.active, true); assert.equal(report.intent, 'approach');
  world.group.target = { ...world.group.target, id: 'bee' }; assert.equal(moves.groupedApproachReport().displacement, 0);
 }],
 // W:14634:14656: the climb starts once the member's walking try stalls (`stepStalled`): a member
 // that stands stalls one measured round trip after its last progress.
 ['a member on another map than its anchor climbs a task walk once its walking try stalls, and a cancel ends that climb once', ({ world, moves }) => {
  assert.equal(moves.groupedMovement(), true); assert.deepEqual(world.climbs, []);
  world.now += world.roundTrip; assert.equal(moves.groupedMovement(), true); assert.deepEqual(world.climbs, []);
  world.now += 1; assert.equal(moves.groupedMovement(), true); assert.deepEqual(world.climbs, ['regroup:P:3']);
  moves.cancelGroupRoute(); moves.cancelGroupRoute(); assert.deepEqual(world.ended, ['regroup:P:3']);
 }],
]);
scenarioTable('the group walk answers as shared.js setConvoyCruise, releaseConvoyCruise, createLocalConvoy and the event travel checks did (appendix A2 WCL, RANK)', ()=>{
  const { createWalkClient } = require('../../runtime/movement/character/walk-client.ts');
  const world = { cruises: [], forced: 0, location: 'none', follows: true };
  const client = createWalkClient({ cruise: speed => { world.cruises.push(speed); if (world.refuse) return Promise.reject(Error(world.refuse)); } }, { ...walkStatePorts(world), huntReturnPlan, generation: () => 3, forceTravel: () => { world.forced++; },
    setPartyLocation: location => { world.location = location; }, endFollow: () => { world.follows = false; } });
  const command = { id: 5, convoyId: 'C', epoch: '2', phase: 'shared-hold', routeVersion: 4, navigationRevision: '7', location: { map: 'main', x: 1, y: 2 },
    purpose: 'party-force-travel', nonPreemptible: 1 };
  return { world, client, command };
}, [
 ['a local walk becomes the member\'s walk with the command\'s identity, sets the party location and ends the follow', ({ world, client, command }) => {
  const walk = client.createLocalConvoy(command);
  assert.equal(client.groupWalk.travel, walk);
  assert.deepEqual([walk.id, walk.epoch, walk.commandId, walk.routeVersion, walk.navigationRevision, walk.generation, walk.holdRequested, walk.phase, walk.nonPreemptible],
    ['C', 2, 5, 4, 7, 3, true, 'taking-control', true]);
  assert.equal(world.forced, 1); assert.equal(world.location, command.location); assert.equal(world.follows, false);
  client.createLocalConvoy({ ...command, purpose: 'franky-exit' }); assert.equal(world.location, null); assert.equal(world.forced, 1);
  world.location = 'kept'; client.createLocalConvoy({ ...command, purpose: 'shared-walk-event' }); assert.equal(world.location, 'kept');
 }],
 ['only the current walk sets the cruise, once per speed, and only the walk that set it gives it back', ({ world, client, command }) => {
  const stale = { id: 'old' }; client.setConvoyCruise(stale, 40); assert.deepEqual(world.cruises, []);
  const walk = client.createLocalConvoy(command);
  client.setConvoyCruise(walk, 40); client.setConvoyCruise(walk, 40); client.setConvoyCruise(walk, 30);
  assert.deepEqual(world.cruises, [40, 30]);
  client.releaseConvoyCruise(stale); assert.deepEqual(world.cruises, [40, 30]);
  // A new walk under the same id takes over the cap the old one set.
  const next = client.createLocalConvoy(command); client.releaseConvoyCruise(walk); assert.deepEqual(world.cruises, [40, 30]);
  client.releaseConvoyCruise(next); client.releaseConvoyCruise(next); assert.deepEqual(world.cruises, [40, 30, 500]); assert.equal(next.cruiseReleased, true);
  const last = client.createLocalConvoy(command); let freed = 0; last.release = () => { freed++; };
  client.setConvoyCruise(last, 40); client.endConvoyWalk(last);
  assert.deepEqual([world.cruises.at(-1), last.cancelled, freed], [500, true, 1], 'ending the walk gives back its cruise, cancels it and releases its journey');
 }],
 // X2: v1.5.0's setConvoyCruise recorded the cap before the game
 // answered and dropped a refusal (shared.js:15707-15713), so the same speed was never sent again and
 // readiness said only "waiting for cruise speed". The refusal goes on the walk and the cap goes.
 ['X2: a refused cruise cap names the refusal on the walk and is sent again on the next signal', async ({ world, client, command }) => {
  const walk = client.createLocalConvoy(command);
  world.refuse = 'speed refused'; client.setConvoyCruise(walk, 40); await new Promise(resolve => setImmediate(resolve));
  assert.equal(walk.cruiseRefused, 'speed refused');
  world.refuse = null; client.setConvoyCruise(walk, 40); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(world.cruises, [40, 40], 'b9b5c91e kept the refused cap as applied and sent nothing');
  assert.equal(walk.cruiseRefused, undefined);
 }],
 ['the Hunt hand-in and a non-preemptible walk hold event travel; a walk is active when the member runs one or the coordinator reports one', ({ client }) => {
  assert.equal(client.eventTravelHeld(true, null), true); assert.equal(client.eventTravelHeld(false, { nonPreemptible: true }), true);
  assert.equal(client.eventTravelHeld(false, { nonPreemptible: false }), false); assert.equal(client.eventTravelHeld(false, null), false);
  assert.equal(client.groupWalkActive(null, false), false); assert.equal(client.groupWalkActive(null, true), true);
  assert.equal(client.groupWalkActive({ id: 'C' }, false), true);
 }],
]);
scenarioTable('the shared walk answers as shared.js sharedPartyWalk, sharedMovementOptions and the walk lease did (appendix A2 WCL)', ()=>{
  const { createWalkClient } = require('../../runtime/movement/character/walk-client.ts');
  const world = { now: 1000, sent: [], moves: [], replies: [], leader: 'L', name: 'L', follows: false };
  const host = { parent: {}, performance: { now: () => world.now }, game_log() {}, can_use: () => true, setTimeout: fn => { fn(); } };
  const ports = { ...walkStatePorts(host), huntReturnPlan, now: () => world.now, character: () => ({ name: world.name, map: 'main', in: 'main', real_x: 3, real_y: 4 }), current: () => true,
    intent: () => ({ revision: 2 }), runtimeId: () => 'R', clockOffset: () => 0, generation: () => 1, leader: () => world.leader,
    followLeader: () => world.follows, loneWalkRequest: (activity, key) => ({ kind: 'lone', owner: activity + ':' + key }),
    smartMove: async (point, callback, options) => { world.moves.push([point.map, options.request.kind]); },
    walkIdentity: (requester, convoyId) => ({ kind: 'group-walk', owner: 'walk:' + convoyId }), departurePending: () => false, chests: () => [],
    setClockOffset() {}, movement: () => ({ setClockError() {} }), nextReport: () => Promise.resolve(),
    request: async (path, options) => { world.sent.push([path, options.body.token, !!options.body.cancel]); return world.replies.shift() || { phase: 'waiting' }; } };
  const client = createWalkClient(host, ports);
  const reports = client;
  return { world, client, reports };
}, [
 ['a grouped member asks the coordinator under one token until the walk completes; a lone member walks alone', async ({ world, client }) => {
  world.replies.push({ phase: 'waiting' }, { phase: 'complete' });
  await client.sharedPartyWalk({ map: 'cave' }, 'farm', 'bee', null);
  assert.deepEqual(world.sent, [['/shared-travel', 'R:1', false], ['/shared-travel', 'R:1', false]]);
  world.replies.push({ phase: 'failed', reason: 'blocked' });
  await assert.rejects(client.sharedPartyWalk({ map: 'cave' }, 'farm', 'bee', null), /blocked/);
  assert.deepEqual(world.sent.slice(2), [['/shared-travel', 'R:2', false], ['/shared-travel', 'R:2', true]]);
  world.name = 'F'; await client.sharedPartyWalk({ map: 'main' }, 'farm', 'bee', null);
  assert.deepEqual(world.moves, [['main', 'lone']]); assert.equal(world.sent.length, 4);
 }],
 ['the lease a reply grants is the one the barrier reads, and an expired lease holds the barrier as waiting', async ({ world, client, reports }) => {
  const command = { id: 3, convoyId: 'C', epoch: 2, routeVersion: 1, navigationRevision: 2, continuousReturn: 1, phase: 'shared-travel' };
  client.groupWalk.travel = { id: 'C', epoch: 2, commandId: 3, routeVersion: 1, navigationRevision: 2 };
  reports.acceptTravelResponse({ transportTiming: { receivedAt: 1000, sentAt: 1000 }, convoySignal: { id: 'C', epoch: 2, commandId: 3, runtimeId: 'R', routeVersion: 1, validUntil: 4000 } },
    { wall: 1000, mono: 1000 }, false);
  assert.equal(client.groupWalk.signal.localDeadline, 4000); assert.equal(client.convoySignalExpired(client.groupWalk.signal), false);
  world.replies.push({ ready: true });
  assert.equal(await client.sharedMovementOptions(command).barrier({ map: 'main', x: 0, y: 0 }, 0, false), true);
  // An expired lease answers not ready after the next report and sends no barrier request.
  world.now = 4000; assert.equal(client.convoySignalExpired(client.groupWalk.signal), true); const sent = world.sent.length;
  assert.equal(await client.sharedMovementOptions(command).barrier({ map: 'main', x: 0, y: 0 }, 0, false), false); assert.equal(world.sent.length, sent);
 }],
 ['the shared route measures no distance across maps or instances and names the walk by its numeric identity', ({ client }) => {
  assert.equal(client.sharedConvoyDistance({ map: 'main', x: 0, y: 0 }, { map: 'main', in: 'other', x: 3, y: 4 }), Infinity);
  assert.equal(client.sharedConvoyDistance(client.sharedConvoyPoint(), { map: 'main', x: 0, y: 0 }), 5);
  assert.deepEqual(client.sharedConvoyIdentity({ convoyId: 'C', epoch: '2', id: 3, navigationRevision: '4', routeVersion: 1 }),
    { character: 'L', convoyId: 'C', epoch: 2, commandId: 3, navigationRevision: 4, runtimeId: 'R', routeVersion: 1 });
 }],
]);
scenarioTable('the saved route and the handoff reach answer as shared.js sharedConvoyReusable and convoyHandoffReachable did (appendix A2 WCL)', ()=>{
  const { createWalkClient } = require('../../runtime/movement/character/walk-client.ts');
  const world = { walkable: true, inRange: true, realm: 'USII', geometry: { version: 3, fingerprint: 'g' } };
  const host = { parent: {}, game_log() {}, can_move_to: () => world.walkable, is_in_range: () => world.inRange };
  const client = createWalkClient(host, { ...walkStatePorts(host), huntReturnPlan, now: () => 0, character: () => ({ name: 'L' }), runtimeId: () => 'R', realm: () => world.realm,
    movement: () => ({ identity: world.geometry }), eventReachable: target => target.id === 'event' });
  const command = { convoyId: 'C', navigationRevision: '2', location: { map: 'cave', x: 50, y: 0 } };
  const origin = { map: 'main', in: 'main', x: 0, y: 0 };
  const plot = [{ map: 'main', x: 10, y: 0 }];
  host.__partySharedRouteRemainder = { id: 'C', revision: 2, destinationKey: JSON.stringify(command.location), runtimeId: 'R', origin, server: 'USII',
    geometry: { version: 3, fingerprint: 'g' }, plot, transporting: false };
  return { world, host, client, command, origin };
}, [
 ['the saved remainder answers only for the same walk, realm, geometry and Town choice, from a walkable first point', ({ world, host, client, command, origin }) => {
  assert.equal(client.sharedConvoyReusable(command, origin), host.__partySharedRouteRemainder);
  world.realm = 'EUI'; assert.equal(client.sharedConvoyReusable(command, origin), null); world.realm = 'USII';
  world.geometry = { version: 4, fingerprint: 'g' }; assert.equal(client.sharedConvoyReusable(command, origin), null); world.geometry = { version: 3, fingerprint: 'g' };
  assert.equal(client.sharedConvoyReusable({ ...command, continuousReturn: 1 }, origin), host.__partySharedRouteRemainder);
  host.__partySharedRouteRemainder.townAllowed = false;
  assert.equal(client.sharedConvoyReusable({ ...command, continuousReturn: 1 }, origin), null);
  world.walkable = false; assert.equal(client.sharedConvoyReusable(command, origin), null);
 }],
 ['farming hands off only a target in range, recovery any visible live target, and an event walk asks the event reach', ({ world, client }) => {
  const target = { id: 'bee', hp: 10, visible: true };
  assert.equal(client.convoyHandoffReachable(target, { purpose: 'party-travel' }), true);
  world.inRange = false; assert.equal(client.convoyHandoffReachable(target, { purpose: 'party-travel' }), false);
  assert.equal(client.convoyHandoffReachable(target, { purpose: 'empty-spawn-recovery' }), true);
  assert.equal(client.convoyHandoffReachable({ ...target, dead: true }, { purpose: 'empty-spawn-recovery' }), false);
  assert.equal(client.convoyHandoffReachable({ id: 'event' }, { purpose: 'event-return' }), true);
  assert.equal(client.convoyHandoffReachable(target, { purpose: 'event-return' }), false);
 }],
]);
scenarioTable('the walk\'s travel answers as shared.js coordinatedMonsterTravel and sharedConvoyEngagement did, with the client\'s own reports and defense (appendix A2 WCL)', ()=>{
  const { createWalkClient } = require('../../runtime/movement/character/walk-client.ts');
  const world = { now: 1000, logs: [], sent: [], stops: 0, ended: 0, selections: [], handoffs: [], combatTarget: null, cruises: [] };
  const host = { parent: { entities: {}, socket: { connected: true } }, can_walk: () => true, game_log: message => { world.logs.push(message); },
    is_in_range: () => true, can_move_to: () => true, is_transporting: () => false, cruise: speed => { world.cruises.push(speed); } };
  const c = { name: 'W', map: 'main', in: 'main', x: 0, y: 0, real_x: 0, real_y: 0, speed: 40 };
  const client = createWalkClient(host, { ...walkStatePorts(host), huntReturnPlan, now: () => world.now, character: () => c, current: () => true, intent: () => ({ revision: 0 }),
    runtimeId: () => 'R', clockOffset: () => 5, realm: () => 'USII', generation: () => 1,
    baseSpeed: () => c.speed, dungeonOwned: () => false, walkCommand: () => null, forceTravel() {}, setPartyLocation() {}, endFollow() {}, leader: () => 'W',
    movement: () => ({ identity: {}, report: () => null, last: () => null, combatHandoff: request => { world.handoffs.push(request.owner); } }),
    stop: () => { world.stops++; return Promise.resolve(); }, walkRequest: command => ({ kind: 'group-walk', owner: 'walk:' + command.convoyId }),
    walkStands: () => ({ end() { world.ended++; } }), request: async (path, options) => { world.sent.push([path, options.body]); return { ok: true }; },
    farmTarget: () => ({ id: 'bee', mtype: 'bee', x: 5, y: 0, hp: 10 }), publishSelection: target => { world.selections.push(target.id); },
    setCombatTarget: id => { world.combatTarget = id; }, grouped: () => false, groupedCombat: () => null, huntOutbound: () => false,
    engaged: () => true, entityReport: e => ({ id: e.id, mtype: e.mtype }), partyList: () => ['W'], fightDeaths: () => [], passingKey: t => t.id });
  return { world, host, client, settle: () => new Promise(r => setImmediate(r)) };
}, [
 ['a held command fails the walk with its reason and waits; the release ends the walk, its hold and its label', async ({ world, host, client, settle }) => {
  const travel = client.coordinatedMonsterTravel({ id: 3, convoyId: 'C', epoch: 1, phase: 'hold', reason: 'Blocked door', location: { map: 'main', x: 0, y: 0 } });
  await settle();
  const walk = client.groupWalk.travel;
  assert.equal(walk.phase, 'failed'); assert.equal(walk.failure, 'Blocked door'); assert.equal(host.navigationDetail, 'Convoy held: Blocked door');
  assert.ok(world.logs.includes('Convoy held: Blocked door'));
  walk.release(); await travel;
  assert.equal(client.groupWalk.travel, null); assert.equal(world.ended, 1); assert.equal(host.navigationDetail, null);
 }],
 ['a farm walk hands a target in range to combat once: the coordinator accepts, the walk ends and the target is selected', async ({ world, client, settle }) => {
  const command = { id: 3, convoyId: 'C', epoch: 1, phase: 'shared-prepare', purpose: 'party-travel', navigationRevision: 0, routeVersion: 2, location: { map: 'main', x: 0, y: 0 } };
  const walk = client.createLocalConvoy(command), phases = [];
  client.setConvoyCruise(walk, 40);
  client.sharedConvoyEngagement(walk, command, () => client.groupWalk.travel === walk, value => phases.push(value));
  client.sharedConvoyEngagement(walk, command, () => client.groupWalk.travel === walk, value => phases.push(value));
  await settle();
  assert.deepEqual(world.sent.map(([path, body]) => [path, body.convoyId, body.commandId, body.runtimeId, body.target.id]), [['/convoy-engage', 'C', 3, 'R', 'bee']]);
  assert.deepEqual(phases, ['engaging-target']); assert.equal(walk.engaged, true); assert.equal(walk.cancelled, true);
  assert.equal(client.groupWalk.travel, null); assert.equal(world.combatTarget, 'bee'); assert.deepEqual(world.selections, ['bee']);
  assert.deepEqual(world.handoffs, ['walk:C']);
  // The handoff gives the cruise cap back before combat moves the character.
  assert.deepEqual(world.cruises, [40, 500]);
 }],
 ['the reports name the defense\'s attackers and observation time on each travel sample', ({ host, client }) => {
  host.parent.entities.bee = { id: 'bee', type: 'monster', mtype: 'bee', target: 'W' };
  const body = { groupedCombat: {} }; client.sampleTravelReport(body);
  assert.deepEqual(body.groupedCombat.currentAttackers, [{ id: 'bee', mtype: 'bee', target: 'W', server: 'USII' }]);
  assert.equal(body.groupedCombat.currentAttackersAt, 1005);
 }],
]);
scenarioTable('the combat steps answer as shared.js sendCombatMove, kiteIfNeeded, approachCombatTarget, resetCombatMovement and the fight queue\'s recovery step did (appendix A2 STEP, QUEUE)', ()=>{
  const { createCombatSteps } = require('../../runtime/movement/character/steps.ts');
  const world = { now: 1000, steps: [], letGos: 0, answer: 'sent', owns: false, returning: false, group: null, safe: () => true };
  const c = { name: 'W', map: 'main', in: 'main', x: 0, y: 0, range: 50, speed: 40 };
  const goo = { id: 'goo', type: 'monster', mtype: 'goo', visible: true, x: 30, y: 0, target: 'W' };
  const formation = { recovery: { point: 1 }, warriorPhase: 'closing', heading: 1 };
  const host = { parent: { entities: { goo } }, distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y), get_entity: id => host.parent.entities[id], is_in_range: t => Math.hypot(t.x - c.x, t.y - c.y) <= c.range,
    can_move_to: () => true, can_walk: () => true, can_move: () => true, partyCombatPosition: null };
  installCharacterEvents(host);
  const steps = createCombatSteps(host, { groupWalk: { travel: null } }, { now: () => world.now, character: () => c,
    movement: () => ({ step: (to, mode, options) => { world.steps.push([mode, options.target]); if (world.stepImpl) world.stepImpl(); return { status: world.answer, sent: Promise.resolve() }; },
      stepAllows: () => true, chooseStep: points => ({ point: points[0] }), letGo: () => { world.letGos++; } }),
    current: () => true, intent: () => ({ revision: 1 }), joinedEvent: () => null, following: () => false, forceTraveling: () => false,
    townTraveling: () => false, departurePending: () => false, formation: () => formation, performance: () => ({ collisionChecks: 0 }),
    independentApproachOwns: () => world.owns, interceptCenter: target => target, returning: () => world.returning,
    franky: () => false, frankyTick: () => false, eventBoss: () => false, fightsAdds: () => false,
    groupedCombat: () => world.group, safePoint: point => world.safe(point) });
  return { world, c, goo, formation, host, steps };
}, [
 // The kite stays current for its step's window, the walk to the step at the character's speed plus
 // one movement tick, where it stayed a fixed 1.5 s.
 ['a monster on the character takes a kite step, and the kite stays current for its step window after it', async ({ world, goo, host, steps }) => {
  assert.equal(await steps.kiteIfNeeded(null), true);
  assert.deepEqual(world.steps, [['kiting', 'goo']]); assert.equal(steps.kiteState.targetId, 'goo');
  assert.equal(host.partyCombatPosition.mode, 'kiting'); assert.equal(steps.isCurrentlyKiting(), true);
  const { stepWindowMs } = require('../../runtime/movement/character/steps.ts');
  assert.equal(steps.kiteState.holdMs, stepWindowMs({ x: 0, y: 0 }, host.partyCombatPosition.destination, 40));
  world.now += steps.kiteState.holdMs - 1; assert.equal(steps.isCurrentlyKiting(), true);
  world.now += 1; assert.equal(steps.isCurrentlyKiting(), false);
  goo.target = 'P'; assert.equal(await steps.kiteIfNeeded(null), false); assert.equal(steps.kiteState.targetId, null);
 }],
 ['a target out of range takes an approach step; a refused step reports nothing, a kept one leaves the last report', async ({ world, c, goo, host, steps }) => {
  goo.target = 'P'; c.x = -100;
  assert.equal(await steps.approachCombatTarget(goo), true);
  assert.deepEqual(world.steps, [['approaching', 'goo']]); assert.equal(host.partyCombatPosition.mode, 'approaching');
  const reported = host.partyCombatPosition; world.answer = 'kept';
  assert.equal(steps.sendCombatMove(goo, { x: 1, y: 0 }, 'kiting'), true); assert.equal(host.partyCombatPosition, reported);
  world.answer = 'refused'; assert.equal(steps.sendCombatMove(goo, { x: 1, y: 0 }, 'kiting'), false); assert.equal(host.partyCombatPosition, reported);
  world.returning = true; world.answer = 'sent'; assert.equal(steps.sendCombatMove(goo, { x: 1, y: 0 }, 'kiting'), false); assert.equal(world.steps.length, 3);
 }],
 // The move packet leaves inside the step call, so a packet observer reads the report as it
 // stands at that moment.
 ['the step goes out with its own report already published', ({ world, goo, host, steps }) => {
  steps.resetCombatMovement(); world.seen = [];
  world.stepImpl = () => world.seen.push(host.partyCombatPosition && host.partyCombatPosition.mode);
  assert.equal(steps.sendCombatMove(goo, { x: 1, y: 0 }, 'formation-regrouping'), true);
  assert.deepEqual(world.seen, ['formation-regrouping']);
 }],
 ['the reset lets go and clears the kite and formation steps, and an independent approach keeps both its reset and its steps', ({ world, goo, formation, host, steps }) => {
  world.owns = true; steps.resetCombatMovement(); assert.equal(world.letGos, 0);
  assert.equal(steps.sendCombatMove(goo, { x: 1, y: 0 }, 'kiting'), true); assert.equal(world.steps.length, 0);
  world.owns = false; steps.kiteState.targetId = 'goo'; steps.resetCombatMovement();
  assert.equal(world.letGos, 1); assert.equal(steps.kiteState.targetId, null); assert.equal(steps.kiteState.mode, 'idle');
  assert.equal(formation.recovery, null); assert.equal(formation.warriorPhase, null); assert.equal(host.partyCombatPosition.mode, 'idle');
 }],
 ['the fight queue\'s recovery step goes to the grouped target only through a safe point, a point costs its distance past the anchor\'s cover, and the reason reports a group move', ({ world, c, goo, host, steps }) => {
  steps.queueRecoveryMove({ x: 10, y: 0 }); assert.deepEqual(world.steps, [], 'no grouped target');
  world.group = { target: goo, anchor: { map: 'main', in: 'main', x: 0, y: 0 }, range: 40 };
  world.safe = () => false; steps.queueRecoveryMove({ x: 10, y: 0 }); assert.deepEqual(world.steps, [], 'an unsafe point');
  world.safe = point => point.x === 10; steps.queueRecoveryMove({ x: 10, y: 0 });
  assert.deepEqual(world.steps, [['fight-recovery', 'goo']]); assert.equal(host.partyCombatPosition.mode, 'fight-recovery');
  assert.equal(steps.queueCoverageCost({ x: 30, y: 0 }), 0); assert.equal(steps.queueCoverageCost({ x: 0, y: 70 }), 30);
  world.group.anchor.in = 'cave'; assert.equal(steps.queueCoverageCost({ x: 0, y: 70 }), 0, 'an anchor in another instance');
  steps.queueRecoveryReason('target out of sight');
  assert.deepEqual(host.partyCombatPosition, { at: 1000, mode: 'fight-recovery', movementOwner: 'group', reason: 'target out of sight' });
 }],
]);
scenarioTable('the approaches answer as shared.js recoverFarmApproach, cancelFarmApproach and independentApproachPorts did (appendix A2 APP)', ()=>{
  const { createApproach } = require('../../runtime/movement/character/approach.ts');
  const world = { now: 10000, routes: [], releases: [], moves: [], steps: [], cancels: [], notices: [], groupCancels: 0, ticks: 0, handle: null, report: null, roundTrip: 200, lastAttack: 0, readyAt: null };
  const c = { name: 'W', ctype: 'warrior', map: 'main', in: 'main', x: 0, y: 0, real_x: 0, real_y: 0, range: 50, speed: 60, frequency: 1, base: {} };
  const bee = { id: 'bee', type: 'monster', mtype: 'bee', visible: true, hp: 100, map: 'main', in: 'main', x: 0, y: 200 };
  const host = { parent: { entities: {}, socket: { connected: true } }, get_entity: id => id === 'bee' ? bee : null,
    is_in_range: () => false, can_move_to: () => false, can_move: () => true, can_walk: () => true,
    partyFarmingZones: { searchPoints: () => [] }, partyCombatPosition: null };
  installCharacterEvents(host);
  const approach = createApproach(host, { groupWalk: { travel: null }, groupedFollower: () => false }, {
    now: () => world.now, clockOffset: () => 0, character: () => c, notify: (name, payload) => world.notices.push([name, payload.why]),
    movement: () => ({ release: owner => world.releases.push(owner), report: () => world.report,
      step: (to, mode) => { world.steps.push(mode); return { sent: Promise.resolve() }; },
      roundTrip: () => world.roundTrip, reportInterval: () => 1000, consolePaused: () => false, move: (goal, callback, options) => { world.moves.push(options.owner.recoveryStage); return new Promise(() => {}); },
      tick: () => { world.ticks++; }, cancel: (why, options) => world.cancels.push(options.by.owner) }),
    current: () => true, intent: () => ({ revision: 1 }), joinedEvent: () => null, eventTraveling: () => false,
    anniversary: () => ({ staging: false, busy: false }), convoyActive: () => false, groupedCombat: () => null,
    grouped: () => false, fresh: () => false, partyLocation: () => ({ id: 'a', map: 'main' }), farmTravelPaused: () => false,
    lastAttackAt: () => world.lastAttack, attackReadyAt: () => world.readyAt, inFarmArea: () => false, activeEvent: () => null, eventReturnHolds: () => false,
    rareActive: () => false, unfinishedFight: () => false, defensiveTarget: () => null, dungeonOwned: () => false,
    attacking: () => false, realm: () => 'USII', journeyHandle: () => world.handle,
    farmApproachRequest: route => ({ owner: 'farm:' + route.target }),
    smartMove: (to, callback, options) => { world.routes.push(options.request.owner); world.handle = 'journey'; return new Promise(() => {}); },
    combatDistance: target => Math.hypot(target.x - c.x, target.y - c.y), combatApproachPoint: () => ({ x: 0, y: 160 }),
    safeCombatPoint: () => true, resetCombatMovement: () => {}, setFormationFrame: () => {}, formationBody: e => ({ x: e.x, y: e.y }),
    formationMotion: e => ({ body: { x: e.x, y: e.y } }), recoverCorner: () => false, cancelGroupRoute: () => { world.groupCancels++; } });
  return { world, c, bee, host, approach };
}, [
 // An attack is the current fight until one attack interval (1000 / frequency) past the
 // later of the last attack and the attack's cooldown edge, whatever the report age (red: the
 // report age, 3 s by default, held the route).
 ['a recent attack holds the route for one attack interval, which follows the frequency stat', ({ world, c, bee, approach }) => {
  const { setReadings } = require('../../runtime/protocol/reports.ts');
  approach.recoverFarmApproach(bee); world.now += world.roundTrip + 1;
  const held = (frequency, lastAgo, readyAgo = null) => {
   c.frequency = frequency; world.lastAttack = world.now - lastAgo; world.readyAt = readyAgo === null ? null : world.now - readyAgo;
   return approach.recoverFarmApproach(bee) === false && world.steps.length === 0;
  };
  assert.equal(held(1, 500), true, 'frequency 1: 500 ms after the attack');
  assert.equal(held(0.5, 1500), true, 'frequency 0.5: the interval is 2 s');
  assert.equal(held(1, 1500, 200), true, 'the cooldown edge 200 ms ago starts the interval');
  setReadings({ reportFreshMs: 9000 });
  try { assert.equal(held(2, 600), false, 'frequency 2: 600 ms is past the 500 ms interval, whatever the report age'); }
  finally { setReadings({ reportFreshMs: 3000 }); }
 }],
 // shared.js:16104: the route starts once the approach's walking try stalls, one measured round trip for a standing fighter. The
 // local detour first tries its own walking try, which stalls the same way.
 ['a blocked target routes once its approach stops closing for its walking try, and the route ends when another journey replaces it', ({ world, bee, host, approach }) => {
  assert.equal(approach.recoverFarmApproach(bee), false); assert.deepEqual(world.routes, []);
  world.now += world.roundTrip; assert.equal(approach.recoverFarmApproach(bee), false); assert.deepEqual(world.routes, []);
  world.now += 1; assert.equal(approach.recoverFarmApproach(bee), true);
  assert.deepEqual(world.routes, []); assert.equal(host.partyCombatPosition.mode, 'farm-local-detour');
  world.now += world.roundTrip + 1; assert.equal(approach.recoverFarmApproach(bee), true);
  assert.deepEqual(world.routes, ['farm:bee']); assert.equal(host.partyCombatPosition.mode, 'farm-approach-route');
  assert.equal(approach.recoverFarmApproach(bee), true); assert.equal(world.routes.length, 1);
  world.handle = 'other'; assert.equal(approach.recoverFarmApproach(bee), false);
  assert.deepEqual(world.releases, ['farm:bee']); assert.equal(approach.farmApproach.route, null);
  assert.equal(host.partyCombatPosition.mode, 'recovery-cancelled'); assert.equal(host.partyCombatPosition.reason, 'new movement owner');
 }],
 // 16681: the local reference lasts one of the character's report intervals.
 ['the journey check reads only a combat approach owner, and a local approach follows the formation target for one report interval', ({ world, approach }) => {
  world.report = { owner: { recoveryStage: 'combat-approach:1' } }; assert.equal(approach.independentApproachOwnsJourney(), true);
  world.report = { owner: { recoveryStage: 'farm' } }; assert.equal(approach.independentApproachOwnsJourney(), false);
  world.report = null; const ports = approach.independentApproachPorts();
  assert.equal(ports.context(), null);
  approach.independentApproach.reference = { target: { id: 'bee' }, at: world.now };
  const context = ports.context(); assert.equal(context.target, 'bee'); assert.equal(context.allowed, true);
  world.now += 1000; assert.equal(ports.context().target, 'bee');
  world.now += 1; assert.equal(ports.context(), null);
 }],
 ['the start ends the group and farm routes and walks one approach under its id; owned and cancel answer only for that id', ({ world, bee, approach }) => {
  approach.recoverFarmApproach(bee); world.now += world.roundTrip + 1; approach.recoverFarmApproach(bee);
  world.now += world.roundTrip + 1; approach.recoverFarmApproach(bee); assert.equal(world.routes.length, 1);
  const ports = approach.independentApproachPorts(); ports.start({ x: 0, y: 160 }, 'combat-approach:7');
  assert.equal(world.groupCancels, 1); assert.deepEqual(world.releases, ['farm:bee']); assert.equal(approach.farmApproach.route, null);
  assert.deepEqual(world.moves, ['combat-approach:7']); assert.equal(world.ticks, 1);
  world.report = { owner: { recoveryStage: 'combat-approach:7' } };
  assert.equal(ports.owned('combat-approach:7'), true); assert.equal(ports.owned('combat-approach:8'), false);
  ports.cancel('combat-approach:8'); assert.deepEqual(world.cancels, []);
  ports.cancel('combat-approach:7'); assert.deepEqual(world.cancels, ['approach:combat-approach:7']);
 }],
 // The detour ends on its own walking try, so a longer report age leaves it unchanged (red:
 // the detour lasted the report age, here 9 s).
 ['the local detour steps around the block and ends when its walking try stalls, whatever the report age', ({ world, bee, host, approach }) => {
  const { setReadings } = require('../../runtime/protocol/reports.ts');
  host.can_move_to = (x, y) => !(x === 0 && y === 160);
  setReadings({ reportFreshMs: 9000 });
  try {
   approach.recoverFarmApproach(bee); world.now += world.roundTrip + 1;
   assert.equal(approach.recoverFarmApproach(bee), true); assert.deepEqual(world.steps, ['farm-local-detour']); assert.deepEqual(world.routes, []);
   world.now += world.roundTrip + 1; assert.equal(approach.recoverFarmApproach(bee), true);
   assert.deepEqual(world.routes, ['farm:bee'], 'the stalled detour hands over to the route');
  } finally { setReadings({ reportFreshMs: 3000 }); }
 }],
]);
scenarioTable('the formation solver answers as shared.js formationMove, holdFormation, separateFromParty and defensiveFormationMove did (appendix A2 FORM)', ()=>{
  const { createFormationSolver } = require('../../runtime/movement/character/formation.ts');
  const world = { now: 10000, sent: [], holds: 0, resets: 0, kites: [], spreads: [], owns: false, grouped: true, safe: true,
    errands: { banking: false, bankQueued: false, stocking: false, departurePending: false } };
  const w = { name: 'W', ctype: 'warrior', map: 'main', x: 0, y: 0, range: 30, speed: 60, hp: 100, max_hp: 100, visible: true };
  const p = { name: 'P', ctype: 'priest', map: 'main', x: 0, y: 0, range: 200, speed: 56, hp: 100, max_hp: 100, visible: true };
  const goo = { id: 'goo', type: 'monster', mtype: 'goo', map: 'main', x: 100, y: 0, range: 20, visible: true };
  const players = { W: w, P: p }, kite = { destination: { x: 1, y: 1 } }, independentApproach = { reference: null };
  const host = { parent: { entities: { goo } }, distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y), get_player: name => players[name], can_move_to: () => true,
    is_in_range: t => Math.hypot(t.x - w.x, t.y - w.y) <= w.range, partyCombatPosition: null };
  installCharacterEvents(host);
  const distance = t => Math.hypot(t.x - w.x, t.y - w.y);
  const solver = createFormationSolver(host, { groupWalk: { travel: null } }, {
    now: () => world.now, clockOffset: () => 0, character: () => w, G: () => ({ monsters: { goo: { range: 20 } } }),
    movement: () => ({ fresh: () => true, holdStep: () => { world.holds++; }, roundTrip: () => 200, reportInterval: () => 1000, routinePick: () => undefined,
      step: (point, mode) => { world.spreads.push({ mode, x: point.x, y: point.y }); return { sent: Promise.resolve() }; } }),
    partyList: () => ['W', 'P'], partyPositions: () => [w, p].map(m => ({ ...m, seenAt: world.now, server: 'USII' })), realm: () => 'USII',
    groupedCombat: () => null, grouped: () => world.grouped, joinedEvent: () => world.joined ?? null, eventTraveling: () => false, scatter: () => false,
    leader: () => 'W', followLeader: () => true, sameTeam: () => true, leaderSelection: () => null, franky: () => false,
    bagErrand: () => world.errands.banking || world.errands.bankQueued || world.errands.stocking, departurePending: () => world.errands.departurePending, convoyActive: () => false, following: () => false, kite: () => kite,
    combatDistance: distance, desiredCombatRange: () => 20, resetCombatMovement: () => { world.resets++; },
    sendCombatMove: (target, point, mode) => { world.sent.push({ mode, x: point.x, y: point.y }); host.partyCombatPosition = { mode }; return true; },
    safeCombatPoint: () => world.safe, combatApproachPoint: (t, desired) => ({ x: t.x - desired, y: t.y }),
    kiteIfNeeded: target => { world.kites.push(target.id); return Promise.resolve(false); },
    independentApproach: () => independentApproach, independentApproachOwns: () => world.owns,
    interceptCenter: t => ({ x: t.x, y: t.y }), rangeReference: t => ({ x: t.x, y: t.y }),
    cancelFarmApproach: () => {}, intent: () => ({ cancelled: false }), dungeonOwned: () => false, fresh: () => true,
    unfinishedFight: () => false, activeEvent: () => null, recoveryHolds: () => false, covered: () => true, cancelGroupRoute: () => {},
    recoveryRequest: () => ({ kind: 'formation', owner: 'formation-recovery' }), smartMove: () => Promise.resolve(),
    stop: () => Promise.resolve(), logEvent: () => {} });
  return { world, w, p, goo, host, kite, independentApproach, solver };
}, [
 ['a warrior out of range takes one step toward its target inside the priest\'s cover, and the pass is counted and its frame cleared', ({ world, w, goo, host, independentApproach, solver }) => {
  assert.equal(solver.formationMove(goo), true);
  assert.deepEqual(world.sent, [{ mode: 'formation-approaching', x: 36, y: 0 }]); assert.equal(world.resets, 1);
  assert.equal(independentApproach.reference.target, goo); assert.equal(solver.formationState.warriorPhase, 'approaching');
  assert.equal(host.partyCombatPosition.priest, 'P'); assert.equal(host.partyCombatPosition.healingRange, 180);
  assert.equal(solver.formationPerformance.ticks, 1);
  // A mage keeps clear of monsters besides its target. With every step refused its pass takes the
  // blocked branch, which publishes the clearance of its own spot.
  const bee = { id: 'bee', type: 'monster', mtype: 'goo', map: 'main', x: 0, y: 150, range: 20, visible: true };
  host.parent.entities.bee = bee; w.ctype = 'mage'; w.range = 200; world.safe = false; w.x = 50;
  assert.equal(solver.formationMove(bee), true); assert.equal(host.partyCombatPosition.mode, 'formation-blocked');
  assert.equal(host.partyCombatPosition.secondaryClearance, 50, 'the clearance measures from the live body, not the pass\'s frame');
 }],
 // B15: v1.5.0 held a blocked mage escort in a joined event
 // with "no safe local detour; waiting for an opening" and refused the terrain recovery while an event
 // ran, so the mage stood out of range. It takes the event's own approach, a step only terrain
 // stops; when the event fights its adds the step takes the full check, so it holds.
 ['B15: a blocked mage escort in a joined event takes the event approach, and holds where the event fights its adds', ({ world, w, host, solver }) => {
  const facts = globalThis.__partyEventFacts, adds = { fight: false };
  globalThis.__partyEventFacts = { ...facts, travellingEventName: () => null, fightsAdds: () => adds.fight };
  try {
   const bee = { id: 'bee', type: 'monster', mtype: 'goo', map: 'main', x: 0, y: 150, range: 20, visible: true };
   host.parent.entities.bee = bee; host.can_move = () => true; w.ctype = 'mage'; w.range = 200; world.safe = false; w.x = 50; world.joined = 'goobrawl';
   // The first pass starts the walking try; the next, past the harness's 200 round trip for a body
   // that is not moving, finds it stalled and reaches the blocked detour (steps.ts stepStalled).
   assert.equal(solver.formationMove(bee), true); world.now += 201; world.sent.length = 0;
   assert.equal(solver.formationMove(bee), true);
   assert.match(host.partyCombatPosition.reason, /event approach/, 'b9b5c91e: no safe local detour; waiting for an opening');
   assert.equal(world.sent.length, 1, 'one event approach step'); assert.equal(world.sent[0].mode, 'formation-approaching');
   world.sent.length = 0; adds.fight = true; host.partyCombatPosition = null;
   assert.equal(solver.formationMove(bee), true); assert.deepEqual(world.sent, []);
   assert.equal(host.partyCombatPosition.mode, 'formation-blocked');
  } finally { globalThis.__partyEventFacts = facts; }
 }],
 ['a fighter at its range holds and stops only its own step; a hold under an independent approach sends nothing', ({ world, w, goo, host, kite, solver }) => {
  w.x = 80; assert.equal(solver.formationMove(goo), true);
  assert.deepEqual(world.sent, []); assert.equal(world.holds, 1); assert.equal(kite.destination, null);
  assert.equal(host.partyCombatPosition.mode, 'formation-hold'); assert.equal(host.partyCombatPosition.healingDistance, 80);
  world.owns = true; host.partyCombatPosition = null;
  assert.equal(solver.holdFormation(goo, 'settled'), true); assert.equal(world.holds, 1); assert.equal(host.partyCombatPosition, null);
 }],
 ['the spread step moves the later name once per 1.5 s and waits for errands; the defensive move kites only an attacker in reach', async ({ world, w, p, goo, host, solver }) => {
  p.x = 5; p.name = 'A';
  assert.equal(await solver.separateFromParty(), true); assert.equal(world.spreads.length, 1);
  assert.equal(world.spreads[0].mode, 'spread'); assert.ok(Math.abs(Math.hypot(world.spreads[0].x, world.spreads[0].y) - 30) < 1e-9);
  assert.equal(await solver.separateFromParty(), false); world.now += 1500;
  world.errands.banking = true; assert.equal(await solver.separateFromParty(), false); world.errands.banking = false;
  p.name = 'Z'; assert.equal(await solver.separateFromParty(), false); assert.equal(world.spreads.length, 1);
  assert.equal(solver.defensiveFormationMove(), false, 'the goo targets nobody');
  goo.target = 'W'; goo.x = 140; assert.equal(solver.defensiveFormationMove(), false, 'out of reach');
  goo.x = 20; host.partyCombatPosition = {}; assert.equal(solver.defensiveFormationMove(), true);
  assert.deepEqual(world.kites, ['goo']); assert.equal(host.partyCombatPosition.reason, 'defending against goo');
  world.grouped = false; assert.equal(solver.defensiveFormationMove(), false);
 }],
]);
scenarioTable('the corner and terrain recovery answers as shared.js recoverFormationCorner, terrainRecoveryPorts and formationRecoverySafePoint did (appendix A2 TERR)', ()=>{
  const { createFormationSolver } = require('../../runtime/movement/character/formation.ts');
  const world = { now: 10000, fresh: true };
  const w = { name: 'W', ctype: 'warrior', map: 'main', x: 0, y: 0, range: 30, speed: 60, hp: 100, max_hp: 100, visible: true };
  const p = { name: 'P', ctype: 'priest', map: 'main', x: -20, y: 0, range: 200, speed: 56, hp: 100, max_hp: 100, visible: true };
  const goo = { id: 'goo', type: 'monster', mtype: 'goo', map: 'main', x: 100, y: 0, range: 20, visible: true };
  const players = { W: w, P: p }, group = { key: 'k', target: { ...goo, server: 'USII', state: 'planned' } };
  // A wall on x = 50 from y = -40 to y = 40 stands between the warrior and the goo.
  const crosses = (a, b) => (a.x < 50) !== (b.x < 50) && Math.abs(a.y + (b.y - a.y) * (50 - a.x) / (b.x - a.x)) <= 40;
  const host = { parent: { entities: { goo } }, distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y), get_player: name => players[name], get_entity: id => host.parent.entities[id],
    is_in_range: t => Math.hypot(t.x - w.x, t.y - w.y) <= w.range, can_move_to: (x, y) => !crosses(w, { x, y }),
    can_move: q => !crosses({ x: q.x, y: q.y }, { x: q.going_x, y: q.going_y }),
    partyCombatPosition: null };
  installCharacterEvents(host);
  const solver = createFormationSolver(host, { groupWalk: { travel: null }, travelCombatActive: () => false, currentTravelAttackers: () => [] }, {
    now: () => world.now, clockOffset: () => 0, character: () => w, G: () => ({ monsters: { goo: { range: 20 } } }),
    movement: () => ({ fresh: () => true, roundTrip: () => 200, reportInterval: () => 1000 }), partyList: () => ['W', 'P'],
    partyPositions: () => [w, p].map(m => ({ ...m, seenAt: world.now, server: 'USII' })), realm: () => 'USII',
    groupedCombat: () => group, grouped: () => true, joinedEvent: () => null, eventTraveling: () => false, scatter: () => false,
    leader: () => 'W', followLeader: () => true, sameTeam: () => true, leaderSelection: () => null, franky: () => false,
    bagErrand: () => false, departurePending: () => false, convoyActive: () => false, following: () => false, kite: () => ({}),
    combatDistance: t => Math.hypot(t.x - w.x, t.y - w.y), desiredCombatRange: () => 20, resetCombatMovement: () => {},
    sendCombatMove: () => true, safeCombatPoint: () => true, combatApproachPoint: (t, desired) => ({ x: t.x - desired, y: t.y }),
    kiteIfNeeded: () => Promise.resolve(), independentApproach: () => ({ reference: null }), independentApproachOwns: () => false,
    interceptCenter: t => t, rangeReference: t => t, cancelFarmApproach: () => {}, intent: () => ({ cancelled: false }),
    dungeonOwned: () => false, fresh: () => world.fresh, unfinishedFight: () => false, activeEvent: () => null, recoveryHolds: () => false,
    covered: () => true, cancelGroupRoute: () => {}, recoveryRequest: () => ({ kind: 'formation', owner: 'formation-recovery' }),
    smartMove: () => Promise.resolve(), stop: () => Promise.resolve(), logEvent: () => {} });
  // The independent approach sets the pass's frame the same way before it asks for a corner step.
  const frame = () => solver.setFormationFrame({ attackers: [], enemies: [goo], motions: new Map(), self: solver.formationBody(w) });
  return { world, w, p, goo, host, group, crosses, frame, solver };
}, [
 ['a warrior walled off from its target steps toward an open side on a two-leg route clear of the wall; with every side walled it reports a terrain-blocked approach', ({ world, w, p, goo, host, crosses, frame, solver }) => {
  frame(); const step = solver.recoverFormationCorner(goo, p, false, [w, p], 36), recovery = solver.formationState.recovery;
  assert.equal(step.blocked, undefined); assert.ok(Math.abs(Math.hypot(step.x, step.y) - 36) < 1e-9, 'one 36-unit step');
  assert.equal(crosses(w, step), false); assert.equal(crosses(recovery.point, recovery.goal), false); assert.equal(recovery.selected, true);
  host.can_move = () => false; host.can_move_to = () => false; world.now += 1000; frame();
  assert.deepEqual(solver.recoverFormationCorner(goo, p, false, [w, p], 36), { blocked: true, planning: undefined, reason: 'terrain-blocked approach' });
 }],
 ['the recovery client\'s context allows only a planned target under a fresh grouped report, and its goals ring the target at its safety reach', ({ world, w, goo, group, solver }) => {
  const ports = solver.terrainRecoveryPorts();
  assert.deepEqual(ports.context(), { key: 'k', target: '["USII","main",null,"goo"]', covered: false, allowed: true });
  group.target.state = 'engaged'; assert.equal(ports.context().allowed, false); group.target.state = 'planned';
  world.fresh = false; assert.equal(ports.context().allowed, false); world.fresh = true;
  const goals = ports.goals(), gaps = goals.map(g => Math.hypot(g.x - goo.x, g.y - goo.y)), reach = goals.map(g => Math.hypot(g.x - w.x, g.y - w.y));
  assert.equal(goals.length, 16); assert.ok(gaps.every(gap => Math.abs(gap - 26) < 1e-5), 'the goo\'s selected safety 14 plus 12');
  assert.deepEqual(reach, [...reach].sort((a, b) => a - b));
 }],
 ['the safe point and the safe segment refuse another monster\'s reach, the healer\'s cover and a wall', ({ host, solver }) => {
  host.parent.entities.bee = { id: 'bee', type: 'monster', mtype: 'bee', map: 'main', x: 0, y: 60, range: 20, visible: true };
  assert.equal(solver.formationRecoverySafePoint({ x: 0, y: 20 }), true);
  assert.equal(solver.formationRecoverySafePoint({ x: 0, y: 45 }), false, 'inside the bee\'s reach');
  assert.equal(solver.formationRecoverySafePoint({ x: -20, y: -210 }), false, 'outside the priest\'s cover');
  const ports = solver.terrainRecoveryPorts();
  assert.equal(ports.safe({ x: 0, y: 30 }), true); assert.equal(ports.safe({ x: 0, y: 50 }), false, 'into the bee');
  assert.equal(ports.safe({ x: 60, y: 0 }), false, 'through the wall');
 }],
]);
// The group walk's four notices: the walk machine tells the group's listeners at each transition
// (walk.ts `formWalk`, `walkPhase`, `completeMembers`, `walkEnds`), and `walks.end` names its own
// code. Each row steps a fresh group through the walk owner's install and `stepWalks`, with the walk
// started and cancelled by the machine itself.
let walkGroups = 0;
scenarioTable('the walk tells its group when it forms, changes phase, completes or loses a member, and ends', ()=>{
  const runtime = require('../../runtime/movement/coordinator/runtime.ts');
  const walks = require('../../runtime/movement/coordinator/walk.ts');
  const leader = 'L' + ++walkGroups, id = 'party:' + leader, names = [leader, 'A', 'B'];
  const status = () => ({ map: 'main', x: 0, y: 0, server: 'US I', seenAt: 1000, hp: 100 });
  const state = { leader, followers: { A: {}, B: {} }, statuses: Object.fromEntries(names.map(n => [n, status()])),
    commands: {}, navigationEpoch: 0, activeConvoy: null };
  let command = 0;
  // The walk tells the registry its coordinator passes `createPartyConvoys`; a listener hears each notice.
  const hooks = require('../../runtime/hooks/registry.ts').createRegistry(), heard = [];
  hooks.register({ name: 'core:test-listener', folder: 'core', author: 'test', summary: 'test',
    hooks: Object.fromEntries(['walk.formed', 'walk.phase', 'walk.member', 'walk.ended', 'ladder.climbed'].map(hook => [hook, payload => { heard.push([hook, payload]); }])) });
  const convoys = walks.createPartyConvoys(state, { listeners: hooks, now: () => 1000, nextCommand: () => ++command, activeNames: () => names,
    intent: () => ({ revision: 1 }), resolve: input => input, persist() {}, group: () => id, live: () => ({ kind: 'farming', tier: 'farming' }) });
  const group = { id, state, partyConvoys: { recoverRestart() {}, addonWalk: convoys.addonWalk, cancel: convoys.cancel } };
  const lookup = name => name === id ? group : undefined;
  runtime.installCoordinatorMovement(hooks, lookup, { time: async () => 0, statuses: () => ({}) });
  let change = null;
  const navigation = { step: s => { if (change) change(s); change = null; return false; } };
  // Each step's notices, in words: the hook and what it names.
  const words = list => list.map(([hook, p]) => hook + ' ' + (hook === 'walk.phase' ? p.from + '>' + p.phase :
    hook === 'walk.member' ? p.member + ':' + p.change : hook === 'walk.ended' ? p.walk + ':' + p.code : p.walk));
  const step = next => { change = next; runtime.stepWalks([group], navigation); return heard.splice(0); };
  const tick = next => words(step(next));
  const start = () => { convoys.start({ map: 'main', x: 0, y: 0 }, 'spot', names, 'party-travel', undefined, 'farming'); return state.activeConvoy; };
  return { id, heard, step, tick, start, state, walks, runtime, convoys, lookup };
}, [
 ['walk.formed fires once for a new walk, with its members, tier, purpose and destination; a restored walk at its first change', ({ id, state, step, tick, start, walks }) => {
  assert.deepEqual(step(() => { start(); }), [['walk.formed', { group: id, walk: 'convoy-1000-1', members: [id.slice(6), 'A', 'B'],
    tier: 'farming', purpose: 'party-travel', destination: { map: 'main', x: 0, y: 0 }, by: '01' }]]);
  assert.deepEqual(tick(() => {}), [], 'a walk it already told of');
  const restored = { ...state.activeConvoy, id: 'restored', phase: 'assemble', group: id };
  assert.deepEqual(tick(s => { s.activeConvoy = restored; }), [], 'a restore tells nothing until the restored walk changes');
  assert.deepEqual(tick(s => walks.walkPhase(s, restored, 'travel')), ['walk.formed restored', 'walk.phase assemble>travel']);
 }],
 ['a walk that forms and ends within one walk step is told both (red on an earlier build: told neither)', ({ tick, start, convoys }) => {
  assert.deepEqual(tick(() => { start(); convoys.cancel(); }), ['walk.formed convoy-1000-1', 'walk.ended convoy-1000-1:cancelled']);
 }],
 ['walk.phase fires on each phase change, naming the phase it left', ({ tick, start, walks }) => {
  let w; tick(() => { w = start(); });
  assert.deepEqual(tick(s => walks.walkPhase(s, w, 'shared-prepare')), ['walk.phase assemble>shared-prepare']);
  assert.deepEqual(tick(s => walks.walkPhase(s, w, 'shared-prepare')), [], 'the same phase');
  assert.deepEqual(tick(s => { walks.walkPhase(s, w, 'travel'); walks.walkPhase(s, w, 'defending'); }),
    ['walk.phase shared-prepare>travel', 'walk.phase travel>defending'], 'two changes within one step');
 }],
 ['walk.member fires when a member completes', ({ tick, start, walks }) => {
  let w; tick(() => { w = start(); });
  assert.deepEqual(tick(s => walks.completeMembers(s, w, ['A'])), ['walk.member A:completed']);
  assert.deepEqual(tick(s => walks.completeMembers(s, w, ['A'])), [], 'already completed');
 }],
 ['walk.ended fires once with its code, the T5 code, cancelled, or the walks.end code', ({ id, heard, tick, start, walks, runtime, convoys, lookup }) => {
  let w; tick(() => { w = start(); });
  assert.deepEqual(tick(s => walks.walkEnds(s, 'arrived')), ['walk.ended convoy-1000-1:arrived']);
  tick(() => { w = start(); });
  assert.deepEqual(tick(s => { w.failureCode = 'route-failed'; w.failure = 'No route'; walks.walkPhase(s, w, 'failed'); }),
    ['walk.phase assemble>failed', 'walk.ended ' + w.id + ':route-failed']);
  assert.deepEqual(tick(() => convoys.cancel()), [], 'the failed walk told its end once');
  tick(() => { w = start(); });
  assert.equal(runtime.endWalk(lookup, id, 'realm-switch'), true);
  assert.deepEqual(heard.splice(0).map(([hook, p]) => [hook, p.walk, p.code]), [['walk.ended', w.id, 'realm-switch']], 'at once, with its own code');
  assert.deepEqual(tick(() => {}), [], 'the next step tells no second end');
 }],
 // Contract part 2 (D:7826): each walk notice names `by`, the requester's owner identity or the
 // table row that decided (red: no `by`).
 ['each walk notice names by: its requester\'s owner or the rule that decided', ({ step, start, walks, convoys }) => {
  let w; const by = list => list.map(([hook, p]) => hook + ' ' + p.by);
  assert.deepEqual(by(step(() => { w = start(); })), ['walk.formed 01']);
  assert.deepEqual(by(step(s => walks.walkPhase(s, w, 'travel'))), ['walk.phase rule:T4']);
  assert.deepEqual(by(step(s => walks.completeMembers(s, w, ['A']))), ['walk.member rule:T4']);
  assert.deepEqual(by(step(s => walks.walkEnds(s, 'arrived'))), ['walk.ended rule:T4']);
  step(() => { w = start(); });
  assert.deepEqual(by(step(s => { w.failureCode = 'route-failed'; walks.walkPhase(s, w, 'failed'); })), ['walk.phase rule:T4', 'walk.ended rule:T5']);
  step(() => { w = start(); });
  assert.deepEqual(by(step(() => convoys.cancel())), ['walk.ended 01']);
 }],
]);
// A fixture walk with movement's hooks installed, so the walk's holder reads (`member.holder`)
// answer from its own state, whatever an earlier table installed.
// `told` holds each `walk.member` notice.
function holdersInstalled(build) {
  const {createRegistry} = require('../../runtime/hooks/registry.ts'), state = { p: null }, hooks = createRegistry(), told = [];
  require('../../runtime/movement/coordinator/runtime.ts').installCoordinatorMovement(hooks, () => state.p ? { state: state.p, partyConvoys: state.convoys } : undefined,
   { time: async () => 0, statuses: () => state.p?.statuses ?? {} });
  hooks.register({ name: 'core:test-listener', folder: 'core', author: 'test', summary: 'test', hooks: { 'walk.member': notice => { told.push(notice); } } });
  const walk = build(); state.p = walk.p;
  // The walk tells and asks the registry `createPartyConvoys` records for its state.
  state.convoys = require('../../runtime/movement/coordinator/walk.ts').createPartyConvoys(walk.p, { listeners: hooks, now: () => 0, nextCommand: () => 0,
    activeNames: () => Object.keys(walk.p.statuses), intent: () => ({ revision: 0 }), resolve: location => location, persist() {} });
  return { ...walk, told, hooks };
}
// The walk's pace is the slowest member's base speed, so Hard Shell, a slow
// or a cap still in force at the walk's start never sets it, and a change to a base speed
// re-paces the walk.
scenarioTable('a walk paces from base speed', ()=>{
  const walks = require('../../runtime/movement/coordinator/walk.ts');
  const status = (speed, baseSpeed) => ({ map: 'main', x: 0, y: 0, server: 'US I', seenAt: 1000, hp: 100, speed, baseSpeed });
  const state = { leader: 'W', followers: { A: {} }, statuses: { W: status(60, 60), A: status(70, 70) }, commands: {}, navigationEpoch: 0, activeConvoy: null };
  let command = 0;
  const convoys = walks.createPartyConvoys(state, { now: () => 1000, nextCommand: () => ++command, activeNames: () => ['W', 'A'],
    intent: () => ({ revision: 1 }), resolve: input => input, persist() {}, group: () => 'party:W', live: () => ({ tier: 'farming' }) });
  const start = () => { convoys.start({ map: 'main', x: 0, y: 0 }, 'spot', ['W', 'A'], 'party-travel', undefined, 'farming'); return state.activeConvoy; };
  return { state, start };
}, [
 ['a warrior under Hard Shell (speed 10) at the walk\'s start gives the pace of its base speed (red: 10)', ({ state, start }) => {
  state.statuses.W.speed = 10;
  const c = start();
  assert.equal(c.slowestSpeed, 60); assert.equal(c.paceCharacter, 'W');
  assert.deepEqual(['W', 'A'].map(n => state.commands[n].slowestSpeed), [60, 60]);
 }],
 ['a reported speed that already carries a cap gives the base pace (red: the capped speed)', ({ state, start }) => {
  state.statuses.A.speed = 40;
  assert.equal(start().slowestSpeed, 60);
 }],
 ['a gear change re-paces the walk, and each signal carries the pace (red: no change)', () => {
  const {travellingParty} = require('./fixtures/shared-convoy-scenario.cjs');
  const {p, e} = holdersInstalled(travellingParty), c = p.activeConvoy;
  p.statuses.F.baseSpeed = 61; p.statuses.L.baseSpeed = 64; p.statuses.P.baseSpeed = 66;
  e.step(p, 1000);
  assert.equal(c.slowestSpeed, 61); assert.equal(c.paceCharacter, 'F');
  assert.equal(e.signal(p, 'L', 1000).pace, 61);
 }],
 ['a walk resumed after a defense pause keeps the base pace (red: the stale pace)', () => {
  const {travellingParty, report} = require('./fixtures/shared-convoy-scenario.cjs');
  const {p, e} = holdersInstalled(travellingParty), c = p.activeConvoy; p.combatLogs = {};
  // The walk was paced under Hard Shell before and its defense pause holds it.
  Object.assign(c, { phase: 'shared-hold', sharedStoppedAt: 2000, runtimes: { L: 'L', F: 'F', P: 'P' }, slowestSpeed: 10 });
  for (const n of c.participants) { p.statuses[n].baseSpeed = 57; report(p, n, 'held', 2500); }
  e.step(p, 2500);
  assert.equal(c.phase, 'shared-prepare');
  assert.deepEqual(c.participants.map(n => p.commands[n].slowestSpeed), [57, 57, 57]);
 }],
]);
// On the member, the walk's cap follows the pace each signal carries, and a runtime that
// finds a cap with no walk running resets it.
scenarioTable('the walk client keeps its cap on the pace, and a runtime clears a cap it finds with no walk', () => {
  const { createWalkClient } = require('../../runtime/movement/character/walk-client.ts');
  const world = { now: 1000, cruises: [], character: { name: 'W', speed: 40, s: {} }, base: 60, dungeon: false };
  const host = { parent: { entities: {}, socket: { connected: true } }, performance: { now: () => world.now },
    G: { maps: {}, conditions: { tangled: { set_speed: 24 }, hardshell: { set_speed: 10 } } } };
  host.cruise = speed => { world.cruises.push(speed); };
  const client = createWalkClient(host, { ...walkStatePorts(host), baseSpeed: () => world.base, dungeonOwned: () => world.dungeon, walkCommand: () => world.command,
    generation: () => 1, forceTravel() {}, setPartyLocation() {}, endFollow() {}, now: () => world.now, character: () => world.character,
    current: () => true, intent: () => ({ revision: 0 }), runtimeId: () => 'R', clockOffset: () => 0, setClockOffset() {},
    movement: () => ({ identity: null, report: () => null, last: () => null, setClockError() {}, live: () => world.live }),
    huntOutbound: () => false, partyList: () => [], fightDeaths: () => [], chests: () => [] });
  const report = () => client.sampleTravelReport({ groupedCombat: {} });
  const command = { id: 5, convoyId: 'C', epoch: 2, phase: 'assemble', navigationRevision: 0, location: { map: 'main', x: 1, y: 2 }, purpose: 'party-travel', slowestSpeed: 40 };
  return { world, client, report, command };
}, [
 ['a signal with a new pace re-caps the walk (red: keeps the old cap)', ({ world, client, command }) => {
  const walk = client.createLocalConvoy(command); client.setConvoyCruise(walk, 40);
  client.acceptTravelResponse({ serverNow: 1000, convoySignal: { id: 'C', epoch: 2, commandId: 5, validUntil: 5000, pace: 44 } }, { wall: 1000, mono: 1000 }, false);
  assert.deepEqual(world.cruises, [40, 44]);
 }],
 // The live Mr Green return row's leader had its cap refused while it fought the boss
 // (cruiseRefused: not-now), and the walk's settle waited 90 s on a pace no signal sent again.
 ['a cap the call budget refused goes again on the next signal with the same pace (red: never again)', async ({ world, client, command }) => {
  const { partyHooks } = require('../../runtime/hooks/index.ts');
  const walk = client.createLocalConvoy(command); client.groupWalk.travel = walk;
  const calls = partyHooks().calls, band = calls.band;
  calls.band = () => 'hold';
  try { client.setConvoyCruise(walk, 40); await new Promise(resolve => setImmediate(resolve)); } finally { calls.band = band; }
  assert.equal(walk.cruiseRefused, 'not-now');
  client.acceptTravelResponse({ serverNow: 1000, convoySignal: { id: 'C', epoch: 2, commandId: 5, validUntil: 5000, pace: 40 } }, { wall: 1000, mono: 1000 }, false);
  assert.deepEqual(world.cruises, [40]);
 }],
 ['a fresh runtime after a reload with a capped report sends the reset, once for that speed (red: keeps the cap)', ({ world, report }) => {
  report(); report(); assert.deepEqual(world.cruises, [500]);
  world.character.speed = 60; report(); assert.deepEqual(world.cruises, [500]);
 }],
 ['a hand-over whose next command ends clears the cap once the walk\'s lease lapses (red: keeps it)', ({ world, client, report, command }) => {
  world.base = 40;
  const walk = client.createLocalConvoy(command); client.setConvoyCruise(walk, 40);
  walk.cruiseHandoff = true; client.groupWalk.travel = null;
  client.groupWalk.signal = { id: 'C', validUntil: 3000 };
  report(); assert.deepEqual(world.cruises, [40], 'the next command may still run');
  world.now = 3000; report(); report(); assert.deepEqual(world.cruises, [40, 500]);
 }],
 // A member holding the walk's command that does not run it names what
 // holds it, the owner taken from the live request's tier.
 ['the report names what holds a member that has the command of the walk and does not run it, by the live request\'s tier', ({ world, client, command }) => {
  const hold = () => { const body = { groupedCombat: {} }; client.sampleTravelReport(body); return body.commandHold; };
  world.command = { ...command, id: 9, type: 'party-monster-travel' }; world.character.speed = 60;
  world.live = { kind: 'task-walk', owner: 'farm:goo', tier: 'farming' }; assert.deepEqual(hold(), { owner: '01', reason: 'task-walk farm:goo' });
  world.live = { kind: 'escape', owner: 'escape' }; assert.deepEqual(hold(), { owner: '05', reason: 'escape escape' }, 'red: 01');
  world.live = { kind: 'task-walk', owner: 'attend', tier: 'event-attendance' }; assert.deepEqual(hold(), { owner: '06', reason: 'task-walk attend' }, 'red: 01');
  world.live = { kind: 'errand', owner: 'merchant' }; assert.deepEqual(hold(), { owner: '08', reason: 'errand merchant' }, 'red: 01');
  world.live = { kind: 'manual', owner: 'click' }; assert.deepEqual(hold(), { owner: '02', reason: 'manual control' });
  world.character.rip = true; assert.deepEqual(hold(), { owner: '05', reason: 'dead' }); world.character.rip = false;
  world.live = null; assert.equal(hold(), null, 'nothing holds it: its walking try stalls');
  world.live = { kind: 'task-walk', owner: 'farm:goo', tier: 'farming' }; client.createLocalConvoy(world.command); assert.equal(hold(), null, 'it runs the walk');
 }],
 ['a slowed, standing or dungeon-held member is not reset (green on both)', ({ world, report }) => {
  world.character.s = { tangled: { ms: 2000 } }; report();
  world.character.s = {}; world.character.stand = true; report();
  world.character.stand = false; world.dungeon = true; report();
  assert.deepEqual(world.cruises, []);
 }],
]);
// Every walk waits for its chests, and the escape alone leaves them. Each row reads the member's
// step barrier (walk-client.ts `sharedMovementOptions`), which asks the coordinator with its fight
// and chests, and whether the executor's own loot wait runs at a map change.
scenarioTable('T1 departure: a walk waits for its chests, the escape alone leaves them, and each walk leaves its fight as before', () => {
  const { createWalkClient } = require('../../runtime/movement/character/walk-client.ts');
  const world = { chests: [], fight: false, sent: [] };
  const host = { parent: {}, performance: { now: () => 1000 }, can_use: () => true, setTimeout: fn => { fn(); } };
  const client = createWalkClient(host, { ...walkStatePorts(host), huntReturnPlan, now: () => 1000, character: () => ({ name: 'L' }), runtimeId: () => 'R', clockOffset: () => 0,
    generation: () => 1, forceTravel() {}, setPartyLocation() {}, endFollow() {}, walkIdentity: () => ({ kind: 'walk' }),
    chests: () => world.chests, departurePending: () => world.fight,
    request: async (path, options) => { world.sent.push(options.body.ready); return { ready: true }; } });
  // What the member tells the barrier with chests left, and with a fight left, for a walk of these
  // fields; `waitsLoot` is the executor's own loot wait at a map change.
  const departs = async walk => {
    const command = { id: 5, convoyId: 'C', epoch: 2, navigationRevision: 0, routeVersion: 1, location: { map: 'main', x: 0, y: 0 }, ...walk };
    client.createLocalConvoy(command);
    client.groupWalk.signal = { id: 'C', epoch: 2, commandId: 5, runtimeId: 'R', routeVersion: 1, validUntil: 5000 };
    const options = client.sharedMovementOptions(command), ask = async (chests, fight) => {
      world.chests = chests; world.fight = fight; await options.barrier({ map: 'main', x: 0, y: 0 }, 0, false, false); return world.sent.pop(); };
    return { withChests: await ask([1], false), withFight: await ask([], true), waitsLoot: options.departure !== 'now' };
  };
  return { departs };
}, [
 ['a Hunt return with chests left waits for them (red: departs) and still leaves its fight (green on both)', async ({ departs }) => {
  assert.deepEqual(await departs({ purpose: 'monster-hunt', continuousReturn: 1, returnRouting: true, nonPreemptible: true }), { withChests: false, withFight: true, waitsLoot: true });
 }],
 ['a Hunt target travel with chests left waits for them (red: departs) and still leaves its fight (green on both)', async ({ departs }) => {
  assert.deepEqual(await departs({ purpose: 'monster-hunt', huntTarget: 'goo' }), { withChests: false, withFight: true, waitsLoot: true });
 }],
 ['the anniversary staging walk and the Halloween exit wait for their chests (red: depart) and still leave their fight (green on both)', async ({ departs }) => {
  for (const purpose of ['shared-walk', 'shared-walk-return'])
    assert.deepEqual(await departs({ purpose, continuousReturn: 1 }), { withChests: false, withFight: true, waitsLoot: true }, purpose);
 }],
 ['the event exit leaves its fight and waits for its chests (green on both)', async ({ departs }) => {
  assert.deepEqual(await departs({ purpose: 'franky-exit', navigationExempt: true, combatHandoffAllowed: false }), { withChests: false, withFight: true, waitsLoot: true });
 }],
 ['an after-loot walk waits for its fight and its chests (green on both)', async ({ departs }) => {
  assert.deepEqual(await departs({ purpose: 'party-travel' }), { withChests: false, withFight: false, waitsLoot: true });
 }],
 ['an escape leaves its fight and its chests at once (red: it waited for both)', async ({ departs }) => {
  assert.deepEqual(await departs({ purpose: 'escape-recovery', navigationExempt: true, combatHandoffAllowed: false }), { withChests: true, withFight: true, waitsLoot: false });
 }],
]);
// Every member a walk waits on has an acknowledged command it follows or an owner's
// `member.holder` answer, so a walk never waits on silence. One row per state, each giving the
// walk an answer.
scenarioTable('a walk never waits on silence', () => {
  const {partyEngine, report} = require('./fixtures/shared-convoy-scenario.cjs');
  const w = holdersInstalled(partyEngine);
  // Movement's own answer over the fixture walk's state, with the console's five owners that speak
  // for their members (each one's registration names it as `holder`).
  const speaking = { answersFor: owner => ['01', '05', '06', '08', '13'].includes(owner) };
  const memberHolds = ask => require('../../runtime/movement/coordinator/runtime.ts').memberHolds(() => ({ state: w.p }), speaking, ask); w.c = w.p.activeConvoy; w.p.combatLogs = {}; w.p.statuses.F.x = 500;
  const step = (at, stopped = []) => { for (const n of w.c.participants) if (!stopped.includes(n)) w.p.statuses[n].seenAt = at; w.e.step(w.p, at); };
  return { ...w, step, report, memberHolds };
}, [
 // The live manual-override rerun: the warrior attended Mr. Pumpkin, and each walk it asked to the boss
 // let it go within 200 ms, since each step asked the holders with no activity and the events owner's attendance
 // answered "attending mrpumpkin, not coming" to its own event's walk.
 ["each step asks the holders with the walk's own event, so a member attending it stays (red: all leave)", ({ p, c, step, hooks }) => {
  const {eventHolds} = require('../../runtime/events/coordinator/source.ts');
  hooks.register({ name: 'core:test-event', folder: 'core', author: 'test', holder: '06', summary: 'test',
    hooks: { 'member.holder': ask => eventHolds({ event: 'mrpumpkin', occurrence: 'o1', phase: 'attending' }, ask, null) } });
  Object.assign(c, { walkingActivity: 'event', walkingEvent: 'mrpumpkin' });
  step(1000); step(2000);
  assert.deepEqual([...c.participants].sort(), ['F', 'L', 'P']);
  c.walkingEvent = 'icegolem'; step(3000);
  assert.equal(p.activeConvoy, null, 'members attending another event leave its walk');
 }],
 // The same rerun: the player's move inside the event map let the warrior go from its own trip too.
 ["the player's trip keeps a member its event attends (red: all leave)", ({ p, c, step, hooks }) => {
  const {eventHolds} = require('../../runtime/events/coordinator/source.ts');
  hooks.register({ name: 'core:test-event', folder: 'core', author: 'test', holder: '06', summary: 'test',
    hooks: { 'member.holder': ask => eventHolds({ event: 'mrpumpkin', occurrence: 'o1', phase: 'attending' }, ask, null) } });
  c.requester = { kind: 'group-walk', tier: 'manual' };
  step(1000); step(2000);
  assert.deepEqual([...c.participants].sort(), ['F', 'L', 'P']); assert.equal(p.activeConvoy, c);
 }],
 // (closed in the leftovers pass): the tasks owner's own `member.holder` answers a report naming an 01
 // request (tasks/coordinator/install.ts `holder`), so movement's answer adds no row for it.
 ['a member that acknowledges the command and names an 01 request as its hold is waited on, and movement adds no row for 01', ({ p, c, step, report, memberHolds }) => {
  step(1000); report(p, 'F', 'assembled', 1000); p.statuses.F.commandHold = { owner: '01', reason: 'task-walk farm:goo' };
  assert.deepEqual(memberHolds({ group: null, member: 'F', at: 1000 }), []);
  step(2000); assert.ok(c.participants.includes('F')); assert.equal(c.ladderRung, undefined, 'no climb');
 }],
 // The job owner answers for a member its errand holds, so movement's own answer adds no row naming
 // 08.
 ['a member an errand holds is answered by the merchant job owner, and movement adds no row for it', ({ p, step, report, memberHolds }) => {
  const {merchantJobSource} = require('../../runtime/merchant-jobs/coordinator/registrations.ts');
  step(1000); report(p, 'F', 'assembled', 1000); p.statuses.F.commandHold = { owner: '08', reason: 'errand job:a:1' };
  assert.deepEqual(memberHolds({ group: null, member: 'F', at: 1000 }), []);
  assert.deepEqual(merchantJobSource(() => null, n => p.statuses[n]).hooks['member.holder']({ group: null, member: 'F', at: 1000 }),
    [{ owner: '08', reason: 'errand job:a:1', coming: true, endsOn: 'report' }]);
 }],
 ['a member that acknowledges, names no hold and stands still climbs on its walking stall (green on both)', ({ p, c, e, step, report }) => {
  step(1000);
  for (const at of [2000, 3000, 4000]) { for (const n of c.participants) report(p, n, 'route-ready', at); e.step(p, at); }
  e.hold(p, 'F: Stalled walking movement (5 seconds without progress)', 'route-failed', 4000);
  assert.equal(c.ladderRung, 'replan');
 }],
 ['a member with no acknowledgement keeps the command for its next reply (green on both)', ({ p, c, step }) => {
  step(1000); const sent = p.commands.F;
  for (const at of [2000, 3000, 4000]) step(at);
  assert.equal(p.commands.F, sent); assert.ok(c.participants.includes('F'));
 }],
 ['a member whose report names manual control as its hold is waited on until journey.ended, with the one 02 answer (green on both)', ({ p, c, step, memberHolds }) => {
  step(1000); Object.assign(p.statuses.F, { commandHold: { owner: '02', reason: 'manual control' }, movementLive: { kind: 'manual', owner: 'click', tier: 'manual' } });
  assert.deepEqual(memberHolds({ group: null, member: 'F', at: 1000 }), [{ owner: '02', reason: 'manual control', coming: true, endsOn: 'journey.ended' }]);
  step(2000); assert.ok(c.participants.includes('F'));
 }],
 // `runtime-lost`, movement's own rule, lets the member go and
 // names itself; `member.holder` answers no lost runtime (reads only `consoleMaintenance`).
 // The user's decision of 2026-11-17: every member silent at once holds the walk until 13 judges them
 // lost on its stale bound (steamRunnerStaleMs, 20 s), and then the walk lets them go. The live Boo
 // Boo row dropped both report channels and both left the walk at 1.9 s.
 ['every member silent at once holds the walk until 13 judges them lost, then lets them go (red: all leave at once)', ({ p, c, step, told }) => {
  for (const n of c.participants) p.statuses[n].reportIntervalMs = 1000;
  const all = [...c.participants];
  step(1000); told.length = 0; step(3500, all);
  assert.deepEqual(c.participants, all, 'the walk keeps every member while 13 has not judged them lost');
  assert.equal(p.activeConvoy, c);
  step(1000 + 20_000, all);
  assert.equal(p.activeConvoy, null, 'at the stale bound the walk lets them go');
  assert.deepEqual(told.filter(n => n.change === 'left').map(n => n.member).sort(), [...all].sort());
 }],
 ['a member whose reports stopped is let go by T5 runtime-lost and the walk goes on (red: the walk waits on it)', ({ p, c, step, memberHolds, told }) => {
  p.statuses.F.reportIntervalMs = 1000; step(1000); step(2000, ['F']); told.length = 0; step(3500, ['F']);
  assert.deepEqual(c.participants, ['L', 'P']); assert.equal(p.commands.F, undefined);
  assert.deepEqual(told.map(n => [n.member, n.change, n.by]), [['F', 'left', 'rule:T5']]);
  assert.deepEqual(memberHolds({ group: null, member: 'F', at: 3500 }), [], 'red: S-13k answers runtime-lost');
  step(4000, ['F']); assert.deepEqual(c.participants, ['L', 'P'], 'its next fresh report does not join it back');
 }],
 // (the (a) check): resumes a Hunt after a CODE runtime replacement once each member reports fresh. Here the
 // replaced runtime ends the round with `runtime-lost`, whose row says the task's next request starts it over
 // with the runtime now reporting. Written in the leftovers pass; the end run runs it first, and the CODE reload
 // row (e2e/console-reload-rows.ts `reloadResumes`) reads the resume live.
 ['a member whose CODE runtime is replaced on the walk ends the round with T5 runtime-lost, taken over by the next request', ({ p, c, step }) => {
  step(1000); Object.assign(c, { phase: 'travel', routeServer: 'USII', runtimes: { L: 'L', F: 'F', P: 'P' } });
  p.statuses.F.convoyNavigation = { ...p.statuses.F.convoyNavigation, runtimeId: 'F-reloaded' };
  step(2000);
  assert.equal(c.failureCode, 'runtime-lost');
 }],
]);

// (01 RA-01g): the groups and tasks owner asks movement's `walks.end` for its takeover and
// `walks.request` for its trip's own walk. The installed owner's setup cannot share the rule tables'
// pure calls. Red on an earlier build, where the takeover cancelled the walk itself and the trip
// started it through the party's convoys. A trip asks under its own slot, as manual.ts `begin` does:
// the describe pass keeps a `core:manual` task by the slot its saved trip answers, and releases one
// with none.
const {installedTasks}=require('./fixtures/task-owner-scenario.cjs');
scenarioTable('the task owner asks movement for its walks', installedTasks, [
 ['a walk below the task that now holds the group ends once through walks.end, replaced:<kind>', t=>{
  t.tasks.taskTick();
  t.party.activeConvoy={id:'walk-1',requester:{tier:'farming'},participants:['L','F'],phase:'travel'};
  t.tasks.owner.request('party:L',{kind:'manual',owner:'manual:app',members:['L','F'],source:'core:manual',slot:'manual:app'});t.tasks.taskTick();
  assert.deepEqual(t.asks,[['end','party:L','replaced:manual']]);
 }],
 ["a held trip walks again through walks.request at the manual tier with the party's active members", t=>{
  t.tasks.taskTick();
  t.tasks.owner.request('party:L',{kind:'manual',owner:'manual:party-travel:main:10:10',members:['L','F'],
   goal:{destination:{map:'main',x:10,y:10},purpose:'party-travel',label:'the spot'},source:'core:manual',slot:'manual:party-travel:main:10:10'});t.tasks.taskTick();
  assert.deepEqual(t.asks,[['request','party:L',{kind:'party-travel',destination:{map:'main',x:10,y:10},tier:'manual',label:'the spot',members:['L','F']}]]);
 }],
 // A second install in one process answers through the registry's publish. Red on an
 // earlier build, where each answered through a global.
 ["a coordinator's second start answers the tasks owner's registrations through the registry, with no global", t=>{
  t.reinstall();
  t.hooks.notify('settings.changed',{field:'leader',by:'test'});
  assert.deepEqual(t.reconciled,[2],'the latest start moves the members, once');
  assert.equal(t.hooks.registrations().filter(r=>r.name==='core:tasks').length,1);
  assert.equal(globalThis.__partyTaskRegistrations,undefined,'01 holds no global');
 }],
 ["a character's second install marks its own apart walk done on movement's journey.ended", t=>{
  const {installTaskAssignment}=require('../../runtime/tasks/character/assignment.ts');
  const task={kind:'event-attendance',owner:'party:L',apart:'wait'},moves=[];
  const install=()=>installTaskAssignment({hooks:t.hooks,character:()=>({map:'halloween',x:0,y:0}),
   partyLocation:()=>null,smartMove:(goal,_c,options)=>{moves.push(options.request.owner);}});
  install();const second=install();
  second.followApart(task);
  t.hooks.notify('journey.ended',{owner:'apart:party:L',code:'arrived'});
  second.followApart(task);
  assert.deepEqual(moves,['apart:party:L'],'the arrival ends the asks');
  assert.equal(t.hooks.registrations().filter(r=>r.name==='core:apart-walk').length,1);
  assert.equal(globalThis.__partyApartEnded,undefined,'01 holds no global');
 }],
]);
// The server caps a walker at parseInt(cap) and reports round(max(5, speed)), so a walk paced at
// a fractional base speed reads its capped member at the whole speed below the pace.
scenarioTable('a member is paced when it reports the speed the game gives a walker capped at the pace', ()=>require('../../runtime/movement/rules.ts'), [
 ['a whole pace, a fractional pace, a slowed member, a member with no cap yet and no pace', ({ cruisePaced }) => {
  assert.deepEqual([cruisePaced(57, 57), cruisePaced(55, 55.4), cruisePaced(10, 55), cruisePaced(60, 55), cruisePaced(5, 0)],
    [true, true, false, false, false]);
 }],
 // The base speed leaves out terrain: the run saw the warrior report 92 on Winterland's snow under a
 // 96.9 pace with no condition on it, and its walk never left the rally. A member below the cap with
 // no speed condition on it walks at its own speed; a slowed member still waits.
 ['a member that terrain holds below the cap is paced, a member a condition slows is not', ({ cruisePaced, reportSlowed }) => {
  assert.equal(cruisePaced(92, 96.9, false), true);
  assert.equal(cruisePaced(92, 96.9, true), false);
  assert.equal(cruisePaced(92, 96.9), false, 'a caller that does not know waits');
  assert.equal(cruisePaced(97, 96.9, false), false, 'no cap yet');
  assert.deepEqual([reportSlowed([{ id: 'encouragement_new', definition: {} }]), reportSlowed([{ id: 'frozen', definition: { speed: -40 } }]),
   reportSlowed([{ id: 'x', live: { speed: -10 } }]), reportSlowed(undefined)], [false, true, true, false]);
 }],
]);
// One purpose table answers both questions the four copied lists asked: whether a walk goes to
// a farm (the card's farm line) and whether it hands combat over to farming on the way
// (walk.ts, walk-client.ts and targeting's passing.ts and rules.ts).
scenarioTable('the walk purpose table says which walks go to a farm and which hand combat over', ()=>require('../../runtime/movement/rules.ts'), [
 ['each purpose answers as the four lists did', ({ goesToFarm, handsCombatOver }) => {
  const purposes = ['', null, 'party-travel', 'farm-relocation', 'manual-monster-override', 'empty-spawn-recovery', 'grouped-approach',
   'hunt-fallback', 'monster-hunt', 'rare-hunt', 'phoenix-patrol', 'escape-recovery', 'toString'];
  assert.deepEqual(purposes.map(p => [p, goesToFarm(p), handsCombatOver(p)]), [
   ['', true, true], [null, true, true], ['party-travel', false, true], ['farm-relocation', true, true],
   ['manual-monster-override', true, true], ['empty-spawn-recovery', true, true], ['grouped-approach', true, false],
   ['hunt-fallback', true, false], ['monster-hunt', false, false], ['rare-hunt', false, false], ['phoenix-patrol', false, false],
   ['escape-recovery', false, false], ['toString', false, false]]);
 }],
 ["the hunting owner's farm recovery takes up a failed farm, relocation, empty-spawn or Hunt walk, as farm.ts recoverFailed's list did", ({ farmRecovers }) => {
  const purposes = ['', null, undefined, 'monster-hunt', 'farm-relocation', 'empty-spawn-recovery', 'party-travel', 'manual-monster-override', 'grouped-approach', 'hunt-fallback', 'rare-hunt'];
  assert.deepEqual(purposes.map(farmRecovers), [true, true, true, true, true, true, false, false, false, false, false]);
 }],
 // The walk tier and the tasks owner's manual hold read this column, where each kept its own list.
 ["the player's walks are the party travel, the forced travel and the target mode's monster walk", ({ playerWalk, goesToFarm, handsCombatOver, farmRecovers }) => {
  const purposes = ['party-travel', 'party-force-travel', 'manual-monster-override', '', 'farm-relocation', 'monster-hunt', 'rare-hunt', null];
  assert.deepEqual(purposes.map(playerWalk), [true, true, true, false, false, false, false, false]);
  assert.deepEqual([goesToFarm('party-force-travel'), handsCombatOver('party-force-travel'), farmRecovers('party-force-travel')], [false, false, false],
   'the forced travel row keeps the answers it had with no row');
 }],
]);
// Movement answers whether its walk holds the combat turn, which turns' rows read
// (characters/turns/rules.ts); turns kept two copies of these predicates over movement's state.
scenarioTable('the walk says whether it holds the combat turn, for turns\' O6 and O16', ()=>require('../../runtime/movement/rules.ts'), [
 ['a Hunt or continuous return walk holds as the group, any other walk, Town or follow holds as walking, a defence pause does not', ({ combatHold }) => {
  const none = {};
  assert.deepEqual([
   combatHold({ purpose: 'monster-hunt', huntTarget: 'bee' }, none), combatHold({ continuousReturn: 1 }, none),
   combatHold({ purpose: 'monster-hunt', huntTarget: 'bee', defensePaused: true }, none), combatHold({ purpose: 'farm-relocation' }, none),
   combatHold(null, { townActive: true }), combatHold(null, { following: true }), combatHold(null, none)],
   ['group', 'group', null, 'walking', 'walking', 'walking', null]);
 }],
]);
// (02 half): movement's radius reads with no saved radius take the hunting owner's search
// reach (hunting/rules.ts searchReach, 400) where each had its own copy of the number.
scenarioTable('a member with no saved search radius arrives within 07\'s search reach', ()=>require('../../runtime/movement/coordinator/arrivals.ts'), [
 ['the Hunt arrival reads the search reach for a member with no radius of its own', ({ stepHuntArrival }) => {
  const arrive = x => {
   const c = { id: 'w', epoch: 1, phase: 'travel', purpose: 'monster-hunt', participants: ['A'], leader: 'A', completed: [], expected: { A: { commandId: 1, revision: 1 } } };
   const state = { monsterHunt: { convoyId: 'w', stage: 'mission-travel', target: 'bee', participants: ['A'], currentIndex: 0, missions: [{ destination: { map: 'main', in: 'main', x: 0, y: 0 } }], cycleId: 'h' },
    activeConvoy: c, commands: { A: { id: 1, type: 'party-monster-travel', convoyId: 'w', navigationRevision: 1 } }, navigationIntents: { A: { revision: 1 } },
    statuses: { A: { seenAt: 1000, map: 'main', in: 'main', server: 'USII', x, y: 0, hp: 100, combatSelection: { runtimeId: 'A' } } }, monsterSearchRadiusByCharacter: {} };
   stepHuntArrival(state, c, 1000, (s, walk, phase) => ({ id: 2, type: 'party-monster-travel', phase, convoyId: 'w' }));
   return c.phase;
  };
  assert.deepEqual([arrive(375), arrive(425)], ['hunt-arrival', 'travel']);
 }],
]);
// Movement holds the combat step's length and the approach's fan, which its own approach, the events owner's
// Franky approach and the survival owner's Cave revival read (red: each kept its own copy).
scenarioTable('the combat step\'s length and the approach fan are movement\'s\'s values', ()=>require('../../runtime/movement/character/steps.ts'), [
 ['0.6 s for an approach, a quarter second for the Cave revival, never under 1, fanned at 0.4 and 0.8 radians', ({ stepLength, approachFan }) => {
  assert.deepEqual([stepLength(50, 'approach'), stepLength(40, 'recovery'), stepLength(undefined, 'approach')], [30, 10, 1]);
  const fan = approachFan({ x: 0, y: 0 }, { x: 100, y: 0 }, 10).map(p => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]);
  assert.deepEqual(fan, [[10, 0], [9.21, 3.89], [9.21, -3.89], [6.97, 7.17], [6.97, -7.17]]);
 }],
]);
// B125: a target crossing the character's path is caught 4.47 s out: the character
// at speed 30, the target 100 away walking 20 a second across for 10 s. v1.5.0
// capped the prediction at 2 s and led the character to (100, 40).
scenarioTable('the intercept prediction follows the target to the end of its leg (B125)', ()=>require('../../runtime/movement/character/steps.ts'), [
 ['B125: a crossing target is led 4.47 s out, not 2 s', ({ predictCombatIntercept })=>{
  const point = predictCombatIntercept({ x: 0, y: 0 }, 30, { x: 100, y: 0 }, 0, { vx: 0, vy: 20, duration: 10 });
  assert.equal(point.x, 100);
  assert.ok(Math.abs(point.y - 20 * Math.sqrt(20)) < 1e-6, String(point.y));
  const short = predictCombatIntercept({ x: 0, y: 0 }, 30, { x: 100, y: 0 }, 0, { vx: 0, vy: 20, duration: 3 });
  assert.equal(short.y, 60, 'the leg ends at 3 s');
 }],
]);
// B111: the status tick hands command 5 in again while the first delivery awaits the
// tasks owner's reunion stop. v1.5.0 let the repeat replace the running walk's token
// and clear it at its end, so the running walk had no token for a newer walk to cancel.
scenarioTable('a repeat delivery of a farm walk leaves the running walk\'s token (B111)', ()=>require('../../runtime/movement/character/commands.ts'), [
 ['B111: the running walk keeps its token through the repeat', async ({ installWalkCommands })=>{
  const walks = installWalkCommands({ state: { intent: { revision: 0, cancelled: false } }, groupWalk: {}, cancelEnds: () => false }, {});
  const command = { id: 5, type: 'travel', navigationRevision: 0 };
  let arrive;
  const running = walks.farmWalk(command, true, () => new Promise(done => { arrive = done; }));
  const token = walks.farmTravel();
  // The repeat's run is the intake's take, which returns at its spent-id check.
  await walks.farmWalk(command, true, async () => {});
  assert.equal(walks.farmTravel(), token, 'the running walk keeps its token');
  arrive();
  await running;
  assert.equal(walks.farmTravel(), null);
 }],
]);

// C1's movement actions: an add-on's walk answers at its tier until the
// character arrives, a new action settles the last refused, and a tier outside ADDON_TIERS is refused.
require('node:test')('C1: a walk action answers the tick at its tier until arrival, a step settles on its send', async () => {
  const { createMovementActions, createMovementTick } = require('../../runtime/movement/character/movers.ts');
  const calls = [], timers = [], at = { map: 'main', x: 200, y: 0 };
  const game = { G: { maps: { main: { spawns: [[5, 6]] } } },
    __partyHooks: { moving: () => false, moverAnswer: () => null, before: (a, core) => !!a && core === 'grouped-target-formation', enabled: () => true,
      turns: { target: () => undefined }, skills: { allows: () => undefined } },
    __partyMovement: { audit() {}, holdStep() {}, step: to => (calls.push('step:' + to.x), { sent: Promise.resolve('ok') }) },
    setInterval: (run, ms) => { const t = { run, ms }; timers.push(t); return t; }, clearInterval() {} };
  const routine = { groupedMovement: first => first(), kiteIfNeeded() {}, approachCombatTarget() {}, endAddonWalk: () => calls.push('end'),
    addonWalk: (name, tier, to) => calls.push(`walk:${name}:${tier}:${to.map}:${to.x}`) };
  const actions = createMovementActions(() => game);
  // The two event rows are the events owner's movers, which take no tick here.
  const facts = globalThis.__partyEventFacts;
  globalThis.__partyEventFacts = { movers: { 'event-return-combat': () => false, 'franky-approach': () => false } };
  try {
  const scope = require('./helpers/run-scope.cjs').contextScope(game, '02', 'act');
  createMovementTick({ root: () => game, service: () => game.__partyMovement, movers: () => routine, now: () => 0, scope },
    () => ({ character: at }), actions)({ held: () => false, equipment() {}, reselect() {}, target: () => null, refresh() {}, report: e => { throw e; } });
  const ask = { addon: 'x', reason: 'test' };
  assert.deepEqual(await actions.walk({ to: 'town', tier: 'manual' }, ask), { outcome: 'refused', by: 'core:movement', reason: 'tier manual is not an add-on tier' });
  const first = actions.walk({ to: { map: 'main', x: 100, y: 0 }, tier: 'formation' }, ask);
  const town = actions.walk({ to: 'town', tier: 'formation' }, ask);
  assert.deepEqual(await first, { outcome: 'refused', by: 'core:movement', reason: 'replaced' });
  timers[0].run();
  assert.deepEqual(await town, { outcome: 'sent' });
  assert.deepEqual(calls, ['walk:addon:x:formation:main:5'], "town is Main's landing, walked at the action's tier");
  calls.length = 0; at.x = 5; at.y = 6; timers[0].run();
  assert.deepEqual(calls, [], 'the arrived walk answers no more');
  const step = actions.step({ to: { x: 9, y: 0 }, tier: 'formation' }, ask);
  timers[0].run();
  assert.deepEqual(await step, { outcome: 'sent', reply: 'ok' });
  assert.deepEqual(calls, ['end', 'step:9']);
  } finally { globalThis.__partyEventFacts = facts; }
});
