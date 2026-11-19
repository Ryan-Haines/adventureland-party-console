const { targetingContext } = require('./helpers/targeting-module.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture,snapshotPorts,approachPointContext}=require('./fixtures/independent-approach-scenario.cjs');
const {formationScenario}=require('./fixtures/formation-scenario.cjs');
scenarioTable("the independent approach client launches, re-aims, halves its radius and reports readiness (MOV-093)", ()=>fixture, [
 ['late caster begins own route after shared target engagement', fixture=>{const f=fixture();f.ctx.planned=false;assert.equal(f.client.tick(),true);assert.equal(f.routes.length,1);assert.equal(f.client.report().target,'target');}],
 // The approach's last level
 // tells targeting once, and a drifting target's re-aims at that level send no second notice.
 ['the last level sends one targeting.unreachable', fixture=>{const f=fixture();f.throwing=true;f.client.tick();for(let i=0;i<12;i++){f.now=10000+(i+1)*250;f.client.tick();}
  assert.equal(f.client.report().phase,'unreachable');assert.deepEqual(f.notices,['target']);
  for(let i=0;i<8;i++){f.ctx.point={x:100+(i%2?30:0),y:100};f.now=14000+i*300;f.client.tick();}
  assert.deepEqual(f.notices,['target'],'one notice per approach');}],
 // The live hunt check in e2e/targeting-rows.ts: the lock stays the plant for one queue round
 // trip after the leader's notice. A key that changes in that window ends the last level's
 // approach, and the client starts no new one to the marked plant (a live run started one 250 ms
 // after the notice).
 ['a superseded key while the notice waits for the retire starts no approach',fixture=>{const f=fixture();f.throwing=true;f.client.tick();for(let i=0;i<12;i++){f.now=10000+(i+1)*250;f.client.tick();}
  assert.equal(f.client.report().phase,'unreachable');const id=f.client.report().id;f.throwing=false;
  f.ctx.retiring=true;f.ctx.key='USII:uhills:target:next';f.now=13250;
  assert.equal(f.client.tick(),true,'the client holds');assert.equal(f.client.report(),null);assert.equal(f.routes.length,0,'no approach inside the mark');
  f.ctx.retiring=false;f.now=23250;f.client.tick();assert.equal(f.routes.length,1,'the next approach once the mark lapses');assert.notEqual(f.client.report().id,id);}],
 ['synchronous native start rejection becomes bounded approach failure', fixture=>{const f=fixture();f.throwing=true;assert.doesNotThrow(()=>f.client.tick());for(let i=0;i<12;i++){f.now=10000+(i+1)*250;assert.doesNotThrow(()=>f.client.tick());}assert.equal(f.client.report().phase,'unreachable');assert.ok(f.client.report().level<=8);}],
 ['old native completion cannot settle newer owned route', async fixture=>{const f=fixture();f.client.tick();const first=f.routes[0];f.ctx.point={x:130,y:100};f.now=10250;f.client.tick();const second=f.routes[1];first.resolve();await Promise.resolve();assert.equal(f.client.report().pending,true);assert.equal(f.owner,second.id);assert.equal(f.client.report().id,second.id);}],
 ['early native-ready actor holds position while another participant has not committed readiness', fixture=>{const f=fixture();f.ready=true;assert.equal(f.client.tick(),true);assert.equal(f.routes.length,0);assert.equal(f.client.report().phase,'ready');assert.equal(f.client.readiness().ready,true);f.ctx.committed=true;assert.equal(f.client.tick(),false);assert.equal(f.routes.length,0);}],
 ['direct connector is attempted first, blocked connector uses owned smart route', fixture=>{for(const clear of [true,false]){const f=fixture();f.clear=clear;f.client.tick();assert.equal(f.routes[0].direct,clear);}}],
 ['mid-route actual range holds owned movement and echoes only current ready confirmation', fixture=>{const f=fixture();f.client.tick();f.ready=true;f.ctx.confirmation='r2';f.client.tick();assert.equal(f.owner,null);assert.equal(f.client.report().phase,'ready');assert.equal(f.client.readiness().confirmation,'r2');f.ready=false;assert.equal(f.client.readiness().confirmation,undefined);f.now=10250;f.ctx.point={x:160,y:100};f.client.tick();assert.equal(f.routes.length,2);}],
 // A re-aim waits for the target's next entity update (its
 // `move_num`), not 250 ms; The next level goes on the pass that saw the try end.
 ['moving target preserves reductions and re-aims once per entity update of the target', async fixture=>{const f=fixture();f.client.tick();f.routes[0].resolve();await Promise.resolve();assert.equal(f.routes.length,2,'the next level at once');assert.equal(f.client.report().radius,100);f.ctx.update=1;f.ctx.point={x:140,y:100};f.client.tick();assert.equal(f.routes.length,3);f.ctx.point={x:180,y:100};f.client.tick();assert.equal(f.routes.length,3,'no second re-aim before the next update');f.ctx.update=2;f.client.tick();assert.equal(f.routes.length,4);assert.equal(f.client.report().radius,100);assert.equal(f.client.report().level,1);f.clear=false;f.ctx.update=3;f.ctx.point={x:220,y:100};f.client.tick();assert.equal(f.routes.length,5);f.ctx.update=4;f.ctx.point={x:260,y:100};f.client.tick();assert.equal(f.routes.length,5,'Pending native search must retain its progress when the target drifts');const g=fixture();g.throwing=true;g.client.tick();for(let i=1;i<=12;i++){g.now=10000+i*250;g.client.tick();}assert.equal(g.client.report().phase,'unreachable');const radius=g.client.report().radius,level=g.client.report().level;g.throwing=false;g.ctx.point={x:130,y:100};g.now=15000;g.client.tick();assert.equal(g.routes.length,1,'Changed target geometry may reconsider the already reduced radius');assert.equal(g.client.report().radius,radius);assert.equal(g.client.report().level,level);}],
 ['lost native readiness after smart approach resumes at half radius, initial readiness keeps full radius', fixture=>{
 for(const previous of ['smart','direct','initial']){const f=fixture();f.clear=previous!=='smart';if(previous!=='initial')f.client.tick();f.ready=true;f.client.tick();f.ready=false;f.ctx.point={x:130,y:100};f.now=10250;f.client.tick();assert.equal(f.client.report().radius,previous==='smart'?100:200);assert.equal(f.client.report().level,previous==='smart'?1:0);}
 const f=fixture();f.clear=false;f.throwing=true;f.client.tick();for(let i=1;i<=12;i++){f.now=10000+i*250;f.client.tick();}f.ready=true;f.client.tick();f.ready=false;f.throwing=false;f.ctx.point={x:130,y:100};f.now=15000;f.client.tick();assert.equal(f.client.report().radius,1);assert.ok(f.client.report().level<=8);}],
 ['owned native completion immediately rechecks range and advances an unsuccessful approach', async fixture=>{
 for(const outcome of ['arrived','failed']){const f=fixture();f.clear=false;f.client.tick();f.now=10500;
  if(outcome==='arrived')f.routes[0].resolve();else f.routes[0].reject(Error('no native route'));
  await Promise.resolve();assert.equal(f.routes.length,2);assert.equal(f.client.report().radius,100);
 }
 const ready=fixture();ready.client.tick();ready.now=10500;ready.ready=true;ready.routes[0].resolve();await Promise.resolve();
 assert.equal(ready.client.report().phase,'ready');assert.equal(ready.routes.length,1);
 const paused=fixture();paused.client.tick();paused.ctx.allowed=false;paused.routes[0].reject(Error('hold'));await Promise.resolve();
 assert.equal(paused.client.report(),null);assert.equal(paused.routes.length,1);}],
 ['own committed arrival retires pull approach until a genuinely new context or explicit stop', fixture=>{
 const f=fixture();f.ctx.committed=true;f.ctx.planned=false;f.client.tick();assert.equal(f.routes.length,1,'Peer engagement alone must not stop own arrival');
 f.ready=true;assert.equal(f.client.tick(),false);assert.equal(f.owner,null);
 f.ready=false;for(let i=0;i<4;i++){f.now=11000+i*250;assert.equal(f.client.tick(),false,'Normal engaged combat owns subsequent range recovery');}
 assert.equal(f.routes.length,1);
 f.ctx.allowed=false;assert.equal(f.client.tick(),false);f.ctx.allowed=true;assert.equal(f.client.tick(),false);assert.equal(f.routes.length,1,'Same-target defense must retain completed approach');
 f.ctx.key='new-selection';assert.equal(f.client.tick(),true);assert.equal(f.routes.length,2);
 f.ready=true;f.client.tick();f.ready=false;f.client.stop();assert.equal(f.client.tick(),true);assert.equal(f.routes.length,3,'Explicit stop retires completion history');}],
 ['approach report retains the actually issued center without exposing mutable controller state', fixture=>{
 const f=fixture();f.client.tick();const report=f.client.report();assert.deepEqual(report.point,{x:100,y:100});
 report.point.x=999;f.ctx.point={x:110,y:100};assert.deepEqual(f.client.report().point,{x:100,y:100});}],
 ['issued interception inputs remain immutable when current native direction changes', fixture=>{
 const f=fixture();f.ctx.prediction={at:10000,target:{x:100,y:100},destination:{x:200,y:200},targetSpeed:30,own:{x:0,y:0},ownSpeed:60,reach:20,horizon:1};
 f.client.tick();const report=f.client.report();assert.equal(report.issuedAt,10000);assert.equal(report.prediction.destination.x,200);
 report.prediction.destination.x=999;f.ctx.prediction.target.x=500;f.ctx.prediction.destination.x=400;
 assert.equal(f.client.report().prediction.destination.x,200);assert.equal(f.client.report().prediction.target.x,100);}],
 ['a pending precommit route builds range buffer while confirming actual readiness immediately', fixture=>{
 const f=fixture();f.clear=false;f.client.tick();f.ready=true;f.buffered=false;
 assert.equal(f.client.tick(),true);assert.equal(f.owner,f.routes[0].id);assert.equal(f.client.readiness().ready,true);assert.equal(f.client.report().pending,true);
 f.ready=false;f.now=10300;f.ctx.point={x:130,y:100};f.client.tick();assert.equal(f.routes.length,1,'Useful pending smart route survives range loss');
 f.ready=true;f.ctx.committed=true;assert.equal(f.client.tick(),false);assert.equal(f.owner,null,'Commit hands off immediately without waiting for buffer');
 const inner=fixture();inner.client.tick();inner.ready=true;inner.buffered=true;inner.client.tick();assert.equal(inner.owner,null);
 const initial=fixture();initial.ready=true;initial.buffered=false;initial.client.tick();assert.equal(initial.routes.length,0);}],
]);

scenarioTable("the independent approach ports walk each fighter's own journey into range (MOV-092)", ()=>snapshotPorts, [
 // This row builds its own group movement context. It runs first because that context installs the
 // events facts the other rows' ports read.
[ 'blocked sightline inside weapon range reports active approach for existing pursuit recovery',()=>{
 const c=targetingContext({Date,character:{x:0,y:0,range:200,rip:false},coordinatorClockOffset:0,formationState:{recovery:null},kiteState:{},partyConvoyActive:false,groupWalk:{travel:false},eventTraveling:false,joinedEvent:null,navigationIntent:{cancelled:false},
  groupedCombat:{target:{id:'boss',server:'USII',map:'uhills',in:'uhills'},recovering:[]},groupedFresh:()=>true,combatDistance:()=>20,can_move_to:()=>false,get_entity:()=>({visible:true,dead:false}),
  root:{partyCombatPosition:{target:'boss',mode:'independent-approach'},partyQueueClient:{independent:{report:()=>({target:'boss',id:'combat-approach:1',phase:'unreachable',goal:{x:10,y:10}})}}}});
 require('./helpers/group-movement.cjs').installGroupMoves(c);const report=c.groupedApproachReport();assert.equal(report.active,true);assert.equal(report.intent,'approach');assert.equal(report.deficit,0);assert.equal(report.waypoint.key,'combat-approach:1');
}],
 ['fresh owned invisible target snapshot routes natively but cannot advertise readiness', async snapshotPorts=>{const f=snapshotPorts(),ctx=f.ports.context();assert.equal(ctx.allowed,true);assert.equal(f.ports.ready(),false);const goal=f.ports.goal(ctx.point,ctx.radius);await f.ports.start(goal,'combat-approach:snapshot');assert.equal(f.moves.length,1);assert.equal(f.moves[0].options.native,undefined);assert.equal(f.moves[0].options.rejectUnreachableGoal,true);assert.equal(f.moves[0].goal.map,'uhills');assert.equal(f.moves[0].goal.in,'uhills');assert.equal(f.ports.ready(),false);f.entity={id:'boss',x:400,y:0,visible:true,dead:false,hp:100};f.c.character.real_x=203;assert.equal(f.ports.ready(),true);}],
 ['snapshot routing preserves stale realm instance death and manual fences', snapshotPorts=>{for(const change of [f=>f.c.groupedFresh=()=>false,f=>f.c.groupedCombat.target.server='EU',f=>f.c.groupedCombat.target.in='other',f=>f.c.root.partyRoleRunner.isKnownDead=()=>true,f=>f.c.navigationIntent.cancelled=true]){const f=snapshotPorts();change(f);assert.ok(!f.ports.context()?.allowed);assert.equal(f.ports.ready(),false);}}],
 ['the snapshot context carries the role runner retiring read for its target',snapshotPorts=>{const f=snapshotPorts();assert.equal(f.ports.context().retiring,false);f.c.root.partyRoleRunner.retiring=id=>id==='boss';assert.equal(f.ports.context().retiring,true);}],
 ['native ranged readiness accepts blocked movement ray', snapshotPorts=>{const f=snapshotPorts();f.entity={id:'boss',x:180,y:0,visible:true,dead:false,hp:100};f.c.can_move_to=()=>false;assert.equal(f.ports.ready(),true);}],
 ['direct journey installs through existing collision-validating executor', async snapshotPorts=>{const f=snapshotPorts();const installed=[];f.c.movement.identity={version:17665,fingerprint:'native'};f.c.movement.install=(plot,identity,engine)=>installed.push({plot,identity,engine});await f.ports.start({x:100,y:0},'combat-approach:direct',true);assert.equal(installed.length,1);assert.equal(installed[0].engine,'direct');assert.equal(installed[0].plot[0].x,100);assert.equal(f.moves[0].options.owner.recoveryStage,'combat-approach:direct');let reject,cancelled=false;f.c.movement.move=()=>new Promise((_,r)=>reject=r);f.c.movement.report=()=>({owner:{recoveryStage:'combat-approach:bad'}});f.c.movement.install=()=>{throw Error('connector changed');};f.c.movement.cancel=()=>{cancelled=true;reject(Error('connector changed'));throw Error('native stop unavailable');};const walking=f.ports.start({x:100,y:0},'combat-approach:bad',true);await assert.rejects(walking,/connector changed/);assert.equal(cancelled,true);}],
 ['shared approach intentional cancellation preserves exact owner and cancellation provenance', snapshotPorts=>{
 const f=snapshotPorts();let owner='combat-approach:owned',cancelled;
 f.c.movement.report=()=>({owner:{recoveryStage:owner}});
 f.c.movement.cancel=(reason,cause)=>{cancelled={reason,cause};};
 f.ports.cancel('foreign');assert.equal(cancelled,undefined);
 f.ports.cancel(owner);assert.match(cancelled.reason,/cancelled/i);assert.equal(cancelled.cause.code,'combat-approach-cancelled');}],
 ['projected target center actually drives the native-clear independent goal ring', snapshotPorts=>{
 const f=snapshotPorts(),point={x:400,y:100};f.entity={id:'boss',x:400,y:0,visible:true,hp:100};
 const goal=f.ports.goal(point,197);assert.ok(Math.abs(Math.hypot(goal.x-point.x,goal.y-point.y)-197)<1e-7);}],
 ['new approaches aim ten units inside range without changing native readiness', snapshotPorts=>{
 const f=snapshotPorts();for(const [range,radius] of [[200,190],[36,26],[8,1]]){f.c.character.range=range;assert.equal(f.ports.context().radius,radius);}
 f.c.character.range=200;f.entity={id:'boss',x:195,y:0,visible:true,hp:100};assert.equal(f.ports.ready(),true,'Native ready does not wait for the ten-unit aim');}],
]);
// combatApproachPoint leads a moving target only while the character is out of its native range.
scenarioTable('the combat approach point leads a target only while native attack range is missing (MOV-095)', approachPointContext, [
 ['out of range the approach keeps a ten-unit buffer, and ready melee keeps its spacing', c=>{
  assert.equal(c.combatApproachPoint({x:100,y:0}).x,74);c.is_in_range=()=>true;assert.equal(c.combatApproachPoint({x:100,y:0}).x,66);
  // The formation's desired range keeps the same buffer: a ranger settled at it publishes it on the hold.
  for(const [inRange,x,desired] of [[false,160,26],[true,152,34]]){
   const r=formationScenario();Object.assign(r.warrior,{ctype:'ranger',range:36,x});r.monster.target=null;
   r.c.desiredCombatRange=()=>34;r.c.is_in_range=()=>inRange;r.c.formationMove(r.monster);
   assert.equal(r.c.partyCombatPosition.mode,'formation-hold');assert.equal(r.c.partyCombatPosition.desiredRange,desired);}},
  {character:{x:0,y:0,range:36},desiredCombatRange:()=>34}],
]);
