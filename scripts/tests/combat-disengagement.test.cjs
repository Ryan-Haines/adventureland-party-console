const assert=require('node:assert/strict');
const test=require('node:test');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture,verdicts}=require('./fixtures/combat-disengagement-scenario.cjs');

// The party death recovery (runtime/coordinator/survival/recovery.ts, its phase table) on
// one grouped fight: each row is one failure mode on the shared setup.
scenarioTable('a farming death finishes the fight in its window, escapes and returns to the farm', fixture, [
 ['one death finishes while the trend says the foes die first, with no new pulls, and leaves once it turns (A38)', f=>{
 f.advance();f.party.statuses.M.hp=f.party.statuses.P.hp=50;f.kill('W');f.ctl.tick();
 assert.equal(f.party.combatRecovery.phase,'finishing');assert.equal(f.escapes(),0);assert.equal(f.of('survival.died').length,1,'one survival.died notice');
 assert.deepEqual(f.ctl.view().fight,{running:true,keepsObservations:true,keepsCommitted:true},'the finishing fight takes no new pulls and keeps its target');
 // The foe loses 5 HP a second while the survivors hold: finish.
 for(const hp of [20,15]){f.target.hp=hp;f.advance(1000);f.ctl.tick();}
 assert.equal(f.party.combatRecovery.phase,'finishing');
 // The foe stops losing HP while a survivor drops fast: leave.
 for(const hp of [30,10]){f.party.statuses.M.hp=hp;f.advance(1000);f.ctl.tick();}
 assert.equal(f.escapes(),1);assert.equal(f.party.groupedCombat,null);assert.equal(f.of('survival.died').length,1,'still one notice for the one death');
 assert.deepEqual([f.party.combatRecovery.verdicts.at(-1).verdict,f.party.combatRecovery.verdicts.at(-1).model],['leave','trend'],'the ring records the change with its rates');
 assert.deepEqual(f.of('survival.judged').map(j=>j.verdict),['finish','leave'],'one survival.judged notice at each change of the answer');
 }],
 ['a member that respawns on another map is no arrival at the fight: the window keeps its survivors', f=>{
 f.advance();f.kill('W');f.ctl.tick();assert.equal(f.party.combatRecovery.phase,'finishing');
 for(const hp of [20,15]){f.target.hp=hp;f.advance(1000);f.ctl.tick();}
 // The warrior respawns at the game's respawn point, alive and reporting, on another map.
 const w=f.party.statuses.W;w.rip=false;w.hp=100;w.map=w.in='main';w.groupedCombat.threats=[];
 f.target.hp=10;f.advance(1000);f.ctl.tick();
 assert.equal(f.party.combatRecovery.phase,'finishing');
 assert.deepEqual(f.party.combatRecovery.verdicts.map(v=>v.restart).filter(Boolean),['start'],'no arrival restart for a member away from the fight');
 }],
 ['a foe no fresh report shows is no foe left to finish: the recovery leaves once the party sees none', f=>{
 f.advance();f.kill('W');f.ctl.tick();assert.equal(f.party.combatRecovery.phase,'finishing');
 // The monster leaves every member's view (it disappears, as a removed or despawned monster does)
 // while the fight list still names it; no member observes it, so no foe is left.
 for(const s of Object.values(f.party.statuses)){s.groupedCombat.threats=[];s.groupedCombat.sightings=[];}
 for(let i=0;i<3;i++){f.advance(1000);f.ctl.tick();}
 assert.equal(f.escapes(),1,'the recovery leaves a fight with no observed foe');
 }],
 ['an escape names its cause: a trend that leaves a model win is bad luck, the second under the same odds too hard, a kill clears it', f=>{
 const trendEscape=()=>{f.advance();f.kill('W');f.ctl.tick();
  for(const hp of [20,15]){f.target.hp=hp;f.advance(1000);f.ctl.tick();}
  for(const hp of [30,10]){f.party.statuses.M.hp=hp;f.advance(1000);f.ctl.tick();}};
 const again=()=>{f.party.combatRecovery=null;for(const s of Object.values(f.party.statuses)){s.rip=false;s.hp=100;s.groupedCombat.threats=[f.target];s.groupedCombat.sightings=[f.target];}f.target.hp=25;f.party.groupedCombat={target:f.target,queue:[f.target],fights:[f.target],deaths:[]};f.advance();f.ctl.tick();};
 const escaped=()=>f.of('survival.escaped');
 trendEscape();
 // The fixture's mole has no game data, so the model reads the fight winnable: the trend left a model win.
 assert.deepEqual(escaped().map(n=>[n.cause,n.mtypes.join(),n.model,n.by]),[['bad luck','mole','finish','core:survival']],'one survival.escaped notice, bad luck');
 assert.match(f.party.combatRecovery.reason,/\(bad luck\)$/,'the card reason names the cause');
 again();trendEscape();
 assert.equal(escaped().at(-1).cause,'too hard','a second bad-luck escape from the mole under the same odds');
 again();trendEscape();
 assert.equal(escaped().at(-1).cause,'bad luck','the record cleared on too hard starts again');
 // A kill of the mole after the escape clears its record. The kill reaches the coordinator as play
 // sends it: each member reports the death as shared.js `reportFightDeath` does ({id, map, in,
 // server, at}, no monster type), and the grouped fight's queue keeps it as a tombstone with the
 // type its target had (queue.ts).
 again();f.advance();for(const s of Object.values(f.party.statuses))s.groupedCombat.epoch=f.party.groupedCombatResetAt||0;f.reconcile();
 for(const s of Object.values(f.party.statuses)){const {id,map,in:inst,server}=f.target;s.groupedCombat.epoch=f.party.groupedCombatResetAt||0;s.groupedCombat.deaths=[{id,map,in:inst,server,at:f.now()}];s.groupedCombat.threats=[];s.groupedCombat.sightings=[];}
 f.reconcile();f.advance();f.ctl.tick();
 assert.deepEqual(f.party.groupedCombat.deaths.map(d=>[Object.keys(d).sort().join(),d.mtype]),[['at,id,in,map,mtype,server','mole']],"the tombstone carries its target's type");
 for(const s of Object.values(f.party.statuses))s.groupedCombat.deaths=[];
 again();trendEscape();
 assert.equal(escaped().at(-1).cause,'bad luck','a won fight clears the bad-luck record');
 // A level change moves the odds.
 f.party.statuses.M.level=(f.party.statuses.M.level||1)+1;again();trendEscape();
 assert.equal(escaped().at(-1).cause,'bad luck','another level is other odds');
 }],
 ["the verdict reads each foe's target from a sighting of this fight, with the sighting's report time", f=>{
 const asked=[],decide=f.ports.verdict;f.ports.verdict=(k,s,foes,at)=>{asked.push(foes);return decide(k,s,foes,at);};
 for(const s of Object.values(f.party.statuses))s.groupedCombat.sightings=[{...f.target,target:'P'}];
 f.advance();f.kill('W');f.ctl.tick();
 assert.deepEqual(asked.at(-1).map(x=>[x.id,x.target,x.seenAt]),[[JSON.stringify(['USII','cave','cave','mole']),'P',f.now()]]);
 }],
 // Recovery rows: each phase change sends one notice at the change, and none goes without it.
 ['confirmed completion escapes then resumes only after everyone safely returns above the HP potion line', f=>{
 f.advance();f.kill('W');f.ctl.tick();f.party.groupedCombat.deaths=[{...f.target,at:f.now()}];f.advance();f.ctl.tick();assert.equal(f.escapes(),1);
 f.advance();f.ctl.tick();assert.equal(f.returns(),0);f.home();f.party.statuses.M.hp=49;f.ctl.tick();assert.equal(f.returns(),0);
 f.party.statuses.M.hp=50;f.ctl.tick();assert.equal(f.returns(),1);assert.equal(f.party.combatRecovery.phase,'returning-to-farm');f.ctl.tick();assert.equal(f.returns(),1);
 // The farm return ends once every member stands inside the saved farm (v1.5.0's
 // arrival rule).
 for(const s of Object.values(f.party.statuses)){s.map='cave';s.x=s.y=10;}f.party.activeConvoy=null;f.ctl.tick();assert.equal(f.party.combatRecovery.phase,'complete');
 // The recovery's verdict window ends with it: the same key starts a new window.
 assert.equal(f.verdicts.decide('recovery:'+f.party.combatRecovery.id,[],[],f.now()).restart,'start','the ended recovery keeps no verdict window');
 const id=f.party.combatRecovery.id;
 assert.deepEqual(f.of('survival.recoveryStarted').map(n=>[n.group,n.id,n.names.join(),n.deaths.join(),n.home.map]),[['party:W',id,'W,M,P','W','main']]);
 assert.deepEqual(f.of('survival.recoveryPhase').map(n=>[n.from,n.to,n.resetsFight]),
  [['finishing','escaping',true],['escaping','recovering',false],['recovering','returning-to-farm',true],['returning-to-farm','complete',false]],'one notice per change');
 assert.deepEqual(f.of('survival.recovered').map(n=>[n.id,n.code,n.by]),[[id,'arrived-at-farm','core:survival']]);
 }],
 // The recovery waits for the escape's regroup: members safe at home still wait while the escape's
 // recovery convoy gathers them, and the recovery moves on once the escape stands home.
 ['the recovery moves on only after the escape gathered the party home', f=>{
 f.advance();f.kill('W');f.ctl.tick();f.party.groupedCombat.deaths=[{...f.target,at:f.now()}];f.advance();f.ctl.tick();
 f.party.escape={stage:'recovering'};f.advance();f.ctl.tick();f.home();
 f.ctl.tick();assert.equal(f.party.combatRecovery.phase,'recovering','the escape still regroups');
 f.party.escape.stage='recovery-convoy';f.ctl.tick();assert.equal(f.party.combatRecovery.phase,'recovering');
 f.party.escape.stage='home';f.ctl.tick();assert.equal(f.party.combatRecovery.phase,'returning-to-farm');
 }],
 // An arrival while the return's own convoy still runs ends the recovery once: the convoy is the
 // one the return started, so the next ticks leave the ended recovery as it is.
 ['an arrival with the return convoy still active completes once', f=>{
 f.advance();f.kill('W');f.ctl.tick();f.party.groupedCombat.deaths=[{...f.target,at:f.now()}];f.advance();f.ctl.tick();
 f.advance();f.ctl.tick();f.home();f.ctl.tick();assert.equal(f.party.combatRecovery.phase,'returning-to-farm');
 for(const s of Object.values(f.party.statuses)){s.map='cave';s.x=s.y=10;}
 for(let i=0;i<4;i++)f.ctl.tick();
 assert.equal(f.party.combatRecovery.phase,'complete');
 assert.deepEqual(f.of('survival.recoveryPhase').map(n=>n.to).filter(to=>to==='complete'||to==='returning-to-farm'),['returning-to-farm','complete'],'one change each');
 }],
 // The recovery's low read is install.ts's, the survival owner's "HP potion below" line per character.
 ['a member above half HP but under its own potion line holds the farm return', f=>{
 f.party.hpPotionBelow={M:70};
 f.advance();f.kill('W');f.ctl.tick();f.party.groupedCombat.deaths=[{...f.target,at:f.now()}];f.advance();f.ctl.tick();
 f.advance();f.ctl.tick();f.home();f.party.statuses.M.hp=60;f.ctl.tick();assert.equal(f.returns(),0);
 f.party.statuses.M.hp=70;f.ctl.tick();assert.equal(f.returns(),1);
 }],
 // The return's arrival reads the farm area, as v1.5.0 did.
 ['a party standing in its farm after respawn completes the recovery with no convoy', f=>{
 f.party.location={map:'main',x:0,y:0};
 f.advance();f.kill('W');f.ctl.tick();f.party.groupedCombat.deaths=[{...f.target,at:f.now()}];f.advance();f.ctl.tick();
 f.home();f.advance();f.ctl.tick();
 assert.equal(f.returns(),0,'no convoy starts for a party already in its farm');
 assert.deepEqual([f.party.combatRecovery.phase,f.of('survival.recovered').at(-1)?.code],['complete','arrived-at-farm']);
 }],
 ["an engagement outside the farm area does not end the return, and one inside it does", f=>{
 f.advance();f.kill('W');f.ctl.tick();f.party.groupedCombat.deaths=[{...f.target,at:f.now()}];f.advance();f.ctl.tick();
 f.home();f.advance();f.ctl.tick();assert.equal(f.returns(),1);
 f.party.lastConvoyEngagement={convoyId:'return-1',target:{map:'cave',x:600,y:600}};f.advance();f.ctl.tick();
 assert.equal(f.party.combatRecovery.phase,'returning-to-farm','an engagement far from the farm keeps the return');
 f.party.lastConvoyEngagement={convoyId:'return-1',target:{map:'cave',x:40,y:40}};f.advance();f.ctl.tick();
 assert.equal(f.party.combatRecovery.phase,'complete','an engagement inside the farm ends it');
 }],
 ['a failed farm return asks again on the report that carries the failure', f=>{
 f.advance();f.kill('W');f.ctl.tick();f.party.groupedCombat.deaths=[{...f.target,at:f.now()}];f.advance();f.ctl.tick();
 f.home();f.advance();f.ctl.tick();assert.equal(f.returns(),1);assert.equal(f.party.combatRecovery.phase,'returning-to-farm');
 // The convoy's failure reaches the coordinator with a report: the return asks at once.
 f.party.activeConvoy.phase='failed';f.advance();f.ctl.tick();
 assert.equal(f.returns(),2,'the farm return asks on the report that carries the failure');
 }],
 // targeting's grouped fight resets at the recovery's escape and at its end, at the notice, and
 // the reset epoch then rejects the old evidence, threats and restored state.
 ["the grouped fight resets at the escape and at the recovery's end, at the notice, and fresh reports reacquire the attackers", f=>{
 f.reconcile();const old=f.party.groupedCombat;
 f.advance();f.kill('W');f.ctl.tick();f.party.groupedCombat.deaths=[{...f.target,at:f.now()}];f.advance();f.ctl.tick();
 const phase=(test)=>f.heard.filter(n=>n.hook==='survival.recoveryPhase').find(n=>test(n.payload));
 const escape=phase(p=>p.to==='escaping');
 assert.deepEqual([escape.fight.groupedCombat,escape.fight.resetAt,escape.fight.byCharacter],[null,f.now(),{W:f.now(),M:f.now(),P:f.now()}],'the escape resets the fight at its notice');
 f.advance();f.ctl.tick();
 assert.equal(phase(p=>p.from==='escaping').fight.resetAt,escape.fight.resetAt,'a change that keeps the fight leaves it');
 f.home();f.advance();f.ctl.tick();
 const end=phase(p=>p.from==='recovering');
 assert.deepEqual([end.payload.resetsFight,end.fight.groupedCombat,end.fight.resetAt],[true,null,f.now()],"the recovery's end resets it again");
 for(const s of Object.values(f.party.statuses)){Object.assign(s,{map:'cave',in:'cave',x:0,y:0});s.groupedCombat.threats=[f.target];s.groupedCombat.state=old;s.groupedCombat.evidence=[{...f.target,action:'old',at:900,startedAt:800}];}
 f.party.activeConvoy=null;f.party.combatRecovery=null;f.reconcile();assert.equal(f.party.groupedCombat.target,null);
 for(const s of Object.values(f.party.statuses))s.groupedCombat.epoch=f.party.groupedCombatResetAt;
 f.advance();f.reconcile();assert.equal(f.party.groupedCombat.target.id,'mole');assert.equal(f.party.groupedCombat.evidence.length,0);
 }],
 // An add-on's refusal only refuses. Its fixture is this unit row, since death fight is decided by
 // its fault, so the live table cannot plant a finish to refuse.
 ['SV53: an add-on refusal turns a finish into an escape, and a leave stays a leave', f=>{
 const asked=[];
 f.registry.register({name:'refuse-fixture',folder:'addons',author:'test',summary:'test',hooks:{'survival.refuses'(ask){asked.push(ask.verdict);return 'holding the farm';}}});
 f.registry.configure({'refuse-fixture':{enabled:true}});
 f.advance();f.kill('W');f.ctl.tick();
 assert.deepEqual(asked,['finish'],'asked once, at the finish');
 assert.equal(f.party.combatRecovery.phase,'escaping','the refusal turns the finish into an escape');assert.equal(f.escapes(),1);
 assert.match(f.party.combatRecovery.reason,/refused by refuse-fixture: holding the farm/,'the reason names the refusal');
 assert.deepEqual(f.of('survival.escaped').map(n=>n.by),['refuse-fixture'],'survival.escaped names the add-on in by');
 assert.deepEqual(f.of('survival.recoveryPhase').map(n=>[n.to,n.by]),[['escaping','refuse-fixture']]);
 // A leave is never asked and stays a leave: a walk the model leaves is not refused into a fight.
 const {registerCoordinatorSurvival}=require('../../runtime/coordinator/survival/registrations.ts');
 const coordinatorVerdict=question=>f.registry.survival.verdict(question);
 const {createVerdicts}=require('../../runtime/coordinator/survival/verdict.ts');
 let monsters={brute:{attack:100000,frequency:1,damage_type:'pure'}};
 registerCoordinatorSurvival(f.registry,{verdicts:createVerdicts({now:()=>1000,monsters:()=>monsters}),status:name=>({name,hp:1000,attack:100,frequency:1}),
  refuses:ask=>f.registry.survival.refuses(ask)});
 asked.length=0;
 assert.equal(coordinatorVerdict({walk:true,members:['W'],attackers:[{mtype:'brute',hp:10,target:'W'}]}),'leave');assert.deepEqual(asked,[],'a leave asks no add-on');
 monsters={goo:{attack:1,frequency:1}};
 assert.equal(coordinatorVerdict({walk:true,members:['W'],attackers:[{mtype:'goo',hp:10,target:'W'}]}),'leave',"the walk's fight is refused");
 assert.deepEqual(asked,['fight']);
 }],
 ["targeting.fight: the read names the grouped fight's start, fights and typed deaths", f=>{
 assert.deepEqual(f.registry.targeting.fight('party:W'),{startedAt:800,fights:[f.target],deaths:[]});
 assert.equal(f.registry.targeting.fight('party:Other'),undefined,'a group with no record has no fight');
 // The queue holds the mole, then each member reports its kill with no monster type.
 f.party.groupedCombat=null;f.reconcile();
 for(const s of Object.values(f.party.statuses)){const {id,map,in:inst,server}=f.target;s.groupedCombat.deaths=[{id,map,in:inst,server,at:f.now()}];}
 f.reconcile();
 assert.deepEqual(f.registry.targeting.fight('party:W').deaths.map(d=>d.mtype),['mole'],'a kill names the type its target had');
 }],
 // targeting's grouped snapshot asks `survival.recoveryStep` once per snapshot, which runs the
 // recovery's step on the current reports, then applies the fight rule's masks itself. The row
 // plants survival's answer as install.ts answers it, over the fixture's recovery, and reads the
 // members the queue was handed.
 ["the grouped snapshot's step runs the recovery once on the current reports", (f,t) => {
 const {testRegistry}=require('./helpers/test-registry.cjs'),{registerCoordinatorSurvival}=require('../../runtime/coordinator/survival/registrations.ts');
 const {coordinatorGroupedSnapshot}=require('../../runtime/coordinator/targeting/snapshot.ts');
 const {evaluateGroup}=require('../../runtime/coordinator/targeting/queue.ts');
 require('./fixtures/coordinator-core.cjs');require('./helpers/requesters.cjs').publishPresence(()=>f.party.statuses);
 let steps=0;
 const hooks=testRegistry(t);
 // The events owner's anniversary cycle holds no party here: coordinator-core.cjs answers
 // `event.cycle` with none.
 registerCoordinatorSurvival(hooks,{recoveryStep:group=>{if(group!=='party:W')return undefined;steps++;f.ctl.tick();return f.ctl.view();}});
 Object.assign(f.party,{headlessSlots:['W','M','P'],steamMembers:[],merchantCharacter:null});
 const handed=[];
 const ports={now:f.now,passing:()=>false,recoveryGroup:()=>'party:W',intent:()=>({revision:1}),owned:n=>({type:f.party.statuses[n].ctype}),
  prepare:m=>m,evaluate:(previous,members,...rest)=>{handed.push(members);return evaluateGroup(previous,members,...rest);},
  pullsHeld:()=>false,rareRejections:()=>[]};
 f.advance();f.kill('W');
 const group=coordinatorGroupedSnapshot(f.party,ports);
 assert.equal(steps,1,'one step per snapshot');assert.equal(f.party.combatRecovery.phase,'finishing','the step read the death in the current reports');
 assert.ok(handed.at(-1).every(m=>m.status.groupedCombat.candidates.length===0&&m.status.groupedCombat.retentionPaused),'no candidates and retention paused while it runs');
 assert.equal(group.recovery,f.party.combatRecovery,'the group carries the recovery record');
 ports.recoveryGroup=()=>null;coordinatorGroupedSnapshot(f.party,ports);assert.equal(steps,1,'a group with no death recovery asks no step');
}],
 // `survival.life` is the time of the member's last death the coordinator read, from the one
 // death counter (died.ts), on setup.
 ['SV59: the life changes once per death', f => {
 const lives=[];
 const read=()=>{f.died.scan(f.names,{eventDeath:()=>false,fightStartedAt:()=>Infinity});lives.push(f.died.life('W'));};
 read();f.advance();f.kill('W');const first=f.now();read();read();
 f.party.statuses.W.rip=false;f.party.statuses.W.hp=100;f.advance(5000);read();
 f.kill('W');const second=f.now();read();read();
 assert.deepEqual(lives,[0,first,first,first,second,second]);
 assert.equal(f.died.life('Nobody'),0,'0 before any death');
}],
]);

// The verdict's trend over planted readings (verdict.ts alone): each row plants its own monsters'
// game data, so the table's builder takes them as the row's argument.
scenarioTable('the verdict reads the trend of the readings it is given', verdicts, [
 // A survivor's floor counts the next blows of the foes its own HP loss shows, the fewest
 // hardest hitters whose game-data damage per second covers it, not every foe the party
 // reports.
 ['a survivor\'s floor counts the foes its own loss shows, not every reported foe', ({ clock, v }) => {
  const foes=hp=>['a','b','c'].map(id=>({id,mtype:'brute',hp}));
  // One brute hits the priest (400 a second net); the other two hit nobody the reports name.
  const priest=hp=>[{name:'P',hp,max_hp:2000,ctype:'priest'}];
  v.decide('k',priest(1800),foes(300),clock.now);clock.now+=1000;v.decide('k',priest(1400),foes(200),clock.now);clock.now+=1000;
  const j=v.decide('k',priest(1000),foes(100),clock.now);
  // The foes die in 1 s; the priest's 1000 HP less one blow of 400 lasts 1.5 s: finish. Counting
  // all three blows (1200) leaves no floor at all.
  assert.equal(j.model,'trend');assert.equal(j.verdict,'finish');
 }, {brute:{attack:400,frequency:1,damage_type:'pure'}}],
 // Once the window spans one attack cycle of every survivor (1000 / its `frequency`) with no foe
 // losing HP, the kill rate reads 0: the party leaves while a survivor's HP falls and finishes
 // while none does. Before that cycle the game-data model decides.
 ['a fight whose foes lose no HP over one attack cycle of every survivor and one report gap reads a kill rate of 0', ({ clock, v }) => {
  // The model rates the ent winnable: the priest's attack kills its 100 HP at once and its blows are small.
  const foes=[{id:'e',mtype:'ent',hp:100}],priest=(hp,frequency=1)=>[{name:'P',hp,max_hp:5000,ctype:'priest',attack:1000,frequency,armor:0}];
  const read=(key,hps,frequency)=>{let j;clock.now=0;for(const hp of hps){j=v.decide(key,priest(hp,frequency),foes,clock.now);clock.now+=500;}return j;};
  // Within half the priest's 2000 ms cycle the model still decides.
  let j=read('short',[5000,4800,4600],0.5);
  assert.deepEqual([j.model,j.verdict],['model','finish'],'before one attack cycle the model decides');
  // Over one cycle the ent loses nothing, but the readings are one report gap (500 ms) old at most,
  // so the model still decides.
  j=read('cycle only',[5000,4800,4600],1);
  assert.deepEqual([j.model,j.verdict],['model','finish'],'one attack cycle with no report gap after it: the model decides');
  // Over one cycle and one report gap the ent loses nothing while the priest's HP falls: leave.
  j=read('falling',[5000,4800,4600,4400],1);
  assert.deepEqual([j.model,j.verdict,j.foeRate],['trend','leave',0],'a party that lands nothing while it loses HP leaves');
  // Over one cycle with the priest's HP steady: finish.
  j=read('steady',[5000,5000,5000,5000],1);
  assert.deepEqual([j.model,j.verdict],['trend','finish'],'a party that lands nothing and loses nothing finishes');
 }, {ent:{attack:10,frequency:1,damage_type:'physical'}}],
 // The separate check's probe: the foe loses HP in every other report interval, so half the
 // intervals read no loss. The kill rate reads 0 only while no foe has lost HP since the window
 // started; the survivor's one dip mid-window moves no verdict.
 ['damage that lands in every other report reads the foes\' loss over the window, not a kill rate of 0', ({ clock, v }) => {
  const foes=hp=>[{id:'g',mtype:'goo',hp}],priest=hp=>[{name:'P',hp,max_hp:5000,ctype:'priest',attack:1000,frequency:1,armor:0}];
  const read=(key,pairs)=>{clock.now=0;return pairs.map(([hp,foe])=>{const j=v.decide(key,priest(hp),foes(foe),clock.now);clock.now+=1000;return j;});};
  const js=read('alternating',[[4000,3000],[3900,3000],[3800,2400],[3700,2400],[3600,1800]]);
  // The second reading spans one attack cycle but not one report gap after it: the model decides.
  assert.deepEqual([js[1].model,js[1].verdict],['model','finish'],'one quiet report after the death is no kill rate of 0');
  assert.deepEqual(js.slice(2).map(j=>[j.model,j.verdict]),[['trend','finish'],['trend','finish'],['trend','finish']],'a quiet interval after a loss does not read a kill rate of 0');
  assert.equal(js[3].foeRate,200,'the fourth reading: 600 HP lost over the window\'s 3 s');
  const burst=read('burst',[[4000,3000],[3950,2800],[3900,2600],[3850,2400],[1500,2200],[3750,2000],[3700,1800]]);
  assert.deepEqual(burst.slice(1).map(j=>j.verdict),Array(6).fill('finish'),'one dip of the priest\'s HP mid-window moves no verdict');
 }, {goo:{attack:10,frequency:1,damage_type:'physical'}}],
 // A burst seen in a live run: the priest planted from 92176 to 27653 HP once, then
 // healing back. Its HP stays down, so half the window's readings sit after the drop; the one
 // interval that holds it is the burst, which moves no verdict.
 ['a survivor dropped once and healing back is one burst, not a trend (case F (1) in 13.7)', ({ clock, v }) => {
  const foes=hp=>[{id:'g',mtype:'cgoo',hp}],priest=hp=>[{name:'P',hp,max_hp:92176,ctype:'priest',attack:500,frequency:1,armor:0}];
  const hps=[92176,92176,92176,92176,92176,92176,92176,27653,28053,29114,29114,30172,30572];
  let j;clock.now=0;hps.forEach((hp,i)=>{j=v.decide('drop',priest(hp),foes(5347-60*i),clock.now);clock.now+=500;});
  assert.deepEqual([j.model,j.verdict],['trend','finish'],'the drop is one interval of the window');
  // A second reading: the drop is the newest of four readings one report apart, and still one interval.
  clock.now=0;[92176,92175,92175,27653].forEach((hp,i)=>{j=v.decide('newest',priest(hp),foes(5347-60*i),clock.now);clock.now+=1000;});
  assert.deepEqual([j.model,j.verdict],['trend','finish'],'a drop at the newest reading is one interval of the window');
 }, {cgoo:{attack:1,frequency:1,damage_type:'physical'}}],
 // "Counting data from an old fight when starting a new fight is a
 // bad design". A window whose last reading is older than a fresh report (3 s with an attacker
 // known) saw no fight in between, so the same monster on the party a minute later starts a new
 // window with none of the old readings.
 ['a fight that ends leaves no readings for the next one, even against the same monster', ({ clock, v }) => {
  const foes=hp=>[{id:'g',mtype:'goo',hp}],priest=hp=>[{name:'P',hp,max_hp:5000,ctype:'priest',attack:1000,frequency:1,armor:0}];
  clock.now=0;for(const [hp,foe] of [[4000,3000],[3000,2900],[2000,2800]]){v.decide('g',priest(hp),foes(foe),clock.now);clock.now+=1000;}
  clock.now+=60000;
  const j=v.decide('g',priest(5000),foes(2800),clock.now);
  assert.deepEqual([j.restart,j.model],['start','model'],'the next fight starts its own window');
 }, {goo:{attack:10,frequency:1,damage_type:'physical'}}],
 // Under "Counting data from an old fight when starting a new fight is a bad design": before the
 // readings decide, the model puts each foe on the survivor a sighting of the current fight names as
 // its target, and a foe no such sighting names once on the survivor it would bring down soonest.
 ['the model puts each foe on the survivor its current sighting names, not every foe on each survivor', ({ clock, v }) => {
  const party=()=>[{name:'W',hp:20000,max_hp:20000,ctype:'warrior',attack:1000,frequency:1,armor:0},{name:'P',hp:500,max_hp:5000,ctype:'mage',attack:1000,frequency:1,armor:0}];
  clock.now=1000;
  const named=[{id:'a',mtype:'brute',hp:3000,target:'W',seenAt:1000},{id:'b',mtype:'brute',hp:3000,target:'W',seenAt:1000}];
  const j=v.decide('named',party(),named,clock.now);
  assert.deepEqual([j.model,j.verdict],['model','finish'],'two brutes on the warrior: the warrior outlasts them');
  const unnamed=[{id:'a',mtype:'brute',hp:3000},{id:'b',mtype:'brute',hp:3000}];
  assert.equal(v.decide('unnamed',party(),unnamed,clock.now).verdict,'leave','a foe no sighting names counts on the survivor it brings down soonest');
 }, {brute:{attack:400,frequency:1,damage_type:'pure'}}],
 ['a sighting from before the fight started names no target', ({ clock, v }) => {
  const party=()=>[{name:'W',hp:20000,max_hp:20000,ctype:'warrior',attack:1000,frequency:1,armor:0},{name:'P',hp:500,max_hp:5000,ctype:'mage',attack:1000,frequency:1,armor:0}];
  clock.now=5000;
  // The sightings name the warrior, but they came at 1000, before this window started at 5000.
  const old=[{id:'a',mtype:'brute',hp:3000,target:'W',seenAt:1000},{id:'b',mtype:'brute',hp:3000,target:'W',seenAt:1000}];
  assert.equal(v.decide('old',party(),old,clock.now).verdict,'leave','the old fight\'s targets count for nothing');
 }, {brute:{attack:400,frequency:1,damage_type:'pure'}}],
]);
