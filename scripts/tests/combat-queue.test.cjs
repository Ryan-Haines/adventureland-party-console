const assert=require('node:assert/strict');
require('./fixtures/coordinator-core.cjs');
const {evaluateGroup}=require('../../runtime/coordinator/targeting/queue.ts');
const {createSightRecovery}=require('../../runtime/movement/character/steps.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture,huntFixture,pursuitFixture}=require('./fixtures/combat-queue-scenario.cjs');
const monster=(id,x=80,priority=50)=>({id,mtype:'boar',map:'cave',in:'cave',x,y:0,priority});
const {partyHooks}=require('../../runtime/hooks/index.ts');
// G4: an add-on that refuses C and prefers A, enabled only by the row that plants it.
partyHooks().register({name:'queue-fixture',folder:'addons',author:'test',summary:'Refuses C and prefers A in the grouped queue.',
 hooks:{'targeting.candidates':view=>view.candidates.filter(c=>c.id!=='C'),'targeting.prefers':view=>view.candidates.filter(c=>c.id==='A')}});
scenarioTable("the grouped queue nominates, commits and retires targets for the party", ()=>fixture, [
 ['untouched selection is planned and candidates rank by leader distance within priority', fixture=>{
 const f=fixture();f.members[0].status.groupedCombat.candidates=[monster('A',80),monster('B',30),monster('C',200,60),monster('D',400)];
 const g=f.tick();assert.equal(g.fights.length,0);assert.equal(g.target.state,'planned');assert.deepEqual(g.queue.map(t=>t.id),['C','B','A']);
 const selection=g.selection;f.tick();assert.equal(f.g.selection,selection,'planning timestamp is stable');}],
 ['known aggressors are retained beyond three and always precede neutrals', fixture=>{
 const f=fixture();engage(f);f.members[1].status.groupedCombat.threats=['B','C','D'].map(id=>monster(id));
 f.members[0].status.groupedCombat.candidates=[monster('E',1,101)];f.tick();assert.deepEqual(f.g.queue.map(t=>t.id),['A','B','C','D']);}],
 ['acknowledged successor promotes on death without another acknowledgement cycle', fixture=>{
 const f=fixture();engage(f);f.members[0].status.groupedCombat.candidates=[monster('B'),monster('C',150)];
 for(let i=0;i<8;i++){f.tick();f.ack();}
 f.members[1].status.groupedCombat.deaths=[{id:'A',map:'cave',in:'cave',server:'USII',at:1800}];f.tick();
 assert.equal(f.g.target.id,'B');assert.equal(f.g.committed,true);f.tick();assert.equal(f.g.target.id,'B','duplicate proof advances once');
 assert.equal(f.g.handoffTiming.selectedAt,f.g.handoffTiming.committedAt);
 const timing=f.g.handoffTiming;f.tick();assert.deepEqual(f.g.handoffTiming,timing,'ordinary reports retain transition times');}],
 ['external claim releases an engaged current target and promotes the shared successor', fixture=>{
 const f=fixture();engage(f);f.members[0].status.groupedCombat.candidates=[monster('B'),monster('C')];
 f.members[1].status.groupedCombat.claims=[claim('A',true,1100)];f.tick();
 assert.deepEqual(f.g.queue.map(t=>t.id),['B','C']);assert.equal(f.g.fights.length,0);assert.equal(f.g.evidence.length,0);
 assert.equal(f.g.claims[0].releasedAt,1100);
 f.members[0].status.groupedCombat.evidence.push({...monster('A'),server:'USII',action:'late',at:1200,startedAt:1000,state:'engaged'});f.tick();assert.equal(f.g.target.id,'B');
 const restored=evaluateGroup(null,f.members.map(m=>({...m,status:{...m.status,groupedCombat:{...m.status.groupedCombat,state:f.g}}})),'W',1300);
 assert.equal(restored.target.id,'B');}],
 ['fully healed neutral old engagement releases to the nearest nomination without resurrecting old attack evidence', fixture=>{
 const f=fixture();engage(f);const a={...monster('A',400),hp:100,max_hp:100,target:null};
 f.members[0].status.groupedCombat.candidates=[a,monster('B',20)];
 for(const m of f.members)m.status.groupedCombat.sightings=[a];
 for(let i=0;i<60;i++)f.tick();
 assert.equal(f.g.target.id,'B');assert.equal(f.g.target.state,'planned');assert.equal(f.g.fights.length,0);
 assert.ok(f.g.claims.find(c=>c.id==='A').releasedAt);assert.equal(f.g.deaths.length,0);
 f.tick();assert.equal(f.g.target.id,'B');}],
 // README "Bug fixes that become tests" row 07 trainer (fork): a won Cave practice trainer stays
 // neutral at 1 HP, and the server refuses every attack on it, so its fight releases too.
 ['a neutral Cave actor below full HP releases its old engagement', fixture=>{
 const f=fixture();engage(f);const a={...monster('A',400),hp:1,max_hp:100,target:null,caveSide:'neutral'};
 f.members[0].status.groupedCombat.candidates=[a,monster('B',20)];
 for(const m of f.members)m.status.groupedCombat.sightings=[a];
 for(let i=0;i<60;i++)f.tick();
 assert.equal(f.g.target.id,'B');assert.ok(f.g.claims.find(c=>c.id==='A').releasedAt);}],
 // The reply's party threat and target lists that feed the queue keep each id once, from every
 // member's report. The threats leave out the leader's own, as does.
 ['the party threat and target lists keep each id once', ()=>{
  const {partyReply}=require('../../runtime/tasks/coordinator/reply.ts');
  const ref=id=>({id,map:'main',in:'main'}),status=(threats,target)=>({server:'US I',threats:threats.map(ref),target:target&&ref(target)});
  const state={leader:'W',followers:{P:true,R:true},statuses:{W:status(['L'],'A'),P:status(['B','C','B'],'A'),R:status(['C','D'],'E')}};
  const r=partyReply(state,['W','P','R'],state.statuses.W);
  assert.deepEqual(r.partyThreats.map(t=>t.id),['B','C','D'],'each member threat once');
  assert.deepEqual(r.partyTargets.map(t=>t.id),['A','E'],'each member target once');}],
 // (and upstream issues" row 21) a closer-target replacement the members acknowledged completes in the tick
 // the first locked pair forms, whether the replacement is there, the original is gone, or a member reports
 // it pending or engaged.
 ...['switch','disappeared','pending','engaged'].map(outcome=>['the first locked pair completes an acknowledged closer-target replacement: '+outcome, fixture=>{
 const f=fixture();
 for(const m of f.members)m.status.groupedCombat.handoff={capability:1};
 f.members[0].status.groupedCombat.candidates=[monster('A',200)];
 for(let i=0;i<8;i++){f.tick();f.ack();}
 assert.equal(f.g.pairRevision,null);
 f.members[0].status.groupedCombat.candidates.push(monster('B',50));
 f.tick();assert.ok(f.g.pairRevision);assert.ok(f.g.pursuit.revoking);assert.equal(f.g.committed,false);
 const revocation=f.g.pursuit.revoking;
 f.members[0].status.groupedCombat.pursuitAck=revocation;
 f.tick();assert.equal(f.g.target.id,'A','one acknowledgement cannot release the original target');
 for(const m of f.members)m.status.groupedCombat.pursuitAck=revocation;
 if(outcome==='disappeared')f.members[0].status.groupedCombat.candidates=[monster('A',200)];
 if(['pending','engaged'].includes(outcome))f.members[1].status.groupedCombat.evidence=[{...monster('A',200),server:'USII',at:f.g.seenAt,action:'attack',state:outcome}];
 const next=f.tick();
 assert.equal(next.target.id,outcome==='switch'?'B':'A');
 assert.equal(next.pursuit?.revoking,undefined,'the acknowledged revocation must retire even after a pair appears');
 if(['pending','engaged'].includes(outcome))assert.equal(next.target.state,outcome);
 assert.equal(next.pursuitExclusions.length,0);}]),
 // Other half: with no replacement under way, a locked pair blocks a new distance-based one.
 ['a locked pair blocks a new closer-target replacement', fixture=>{
 const f=fixture();
 for(const m of f.members)m.status.groupedCombat.handoff={capability:1};
 f.members[0].status.groupedCombat.candidates=[monster('A',200),monster('B',300)];
 for(let i=0;i<8;i++){f.tick();f.ack();}
 assert.ok(f.g.pairRevision);assert.equal(f.g.target.id,'A');
 f.members[0].status.groupedCombat.candidates.push(monster('C',20));
 f.tick();assert.equal(f.g.pursuit?.revoking,undefined);assert.equal(f.g.target.id,'A');}],
 // G4: the queue asks the same hooks as each character's selection. C ranks first by priority but
 // the add-on refuses it; A is farther than B in the same priority but the add-on prefers it.
 ["G4: the grouped queue nominates the add-on's preferred goo and skips the one it refuses", fixture=>{
 const f=fixture();f.members[0].status.groupedCombat.candidates=[monster('A',80),monster('B',30),monster('C',200,60),monster('D',400)];
 partyHooks().configure({'queue-fixture':{enabled:true}});
 try{const g=f.tick();assert.deepEqual(g.queue.map(t=>t.id),['A','B','D']);assert.equal(g.target.id,'A');}
 finally{partyHooks().configure({});}}],
 // A planned pull is the queue's own choice, so an add-on preference that comes later moves it to
 // the preferred goo of the same priority; the leader keeps the queue's choice.
 ["G4: a later preference moves the planned pull to the preferred goo", fixture=>{
 const f=fixture();f.members[0].status.groupedCombat.candidates=[monster('A',80),monster('B',30)];
 assert.equal(f.tick().target.id,'B','by distance first');
 partyHooks().register({name:'queue-silent',folder:'addons',author:'test',summary:'Answers no preference.',hooks:{'targeting.prefers':()=>undefined}});
 partyHooks().configure({'queue-silent':{enabled:true}});
 assert.equal(f.tick().target.id,'B','an add-on that answers nothing keeps the planned pull');
 partyHooks().configure({'queue-fixture':{enabled:true}});
 try{assert.equal(f.tick().target.id,'A','the preference moves the planned pull');}
 finally{partyHooks().configure({});}}],
]);
scenarioTable("the grouped queue keeps Hunt targets and the Hunt's remaining kills", ()=>huntFixture, [
 ['hunt switches to the newly closest nomination without a stall and without excluding the old one', huntFixture=>{
 const f=huntFixture();f.members[0].status.x=110;
 const first=f.tick();assert.equal(first.target.id,'A');assert.ok(first.pursuit.revoking);assert.equal(first.committed,false);
 assert.equal(f.tick().target.id,'A','wait for revocation acknowledgement');
 const next=f.tick(true);assert.equal(next.target.id,'B');assert.equal(next.pursuitExclusions.length,0);assert.ok(next.queue.some(t=>t.id==='A'));}],
 // The leader's notice that it cannot reach its own lock target retires the lock the way a lost
 // target retires, with the reason "unreachable", and the queue moves to the next target. A
 // member's notice retires nothing.
 ["the leader's unreachable lock retires as a lost target, and a member's notice does not", huntFixture=>{
 const h=huntFixture();assert.equal(h.group.target.id,'A','precondition: A is the lock');
 const note={id:'A',map:'cave',in:'cave',at:h.group.queue[0].startedAt+1,until:h.now+10000};
 h.members[1].status.groupedCombat.unreachable=[note];for(let i=0;i<3;i++)h.tick();
 assert.equal(h.group.target.id,'A',"a member's notice keeps the lock");assert.deepEqual(h.group.lostTargets||[],[]);
 delete h.members[1].status.groupedCombat.unreachable;h.members[0].status.groupedCombat.unreachable=[note];
 h.tick();assert.equal(h.group.target.id,'B','the queue moves to the next target');
 assert.deepEqual(h.group.lostTargets.map(t=>[t.id,t.reason]),[['A','unreachable']]);
 // The leader's failed-approach mark keeps A out of its nominations for its 10 s.
 h.members[0].status.groupedCombat.candidates=h.members[0].status.groupedCombat.candidates.filter(c=>c.id!=='A');
 for(let i=0;i<3;i++)h.tick();
 assert.equal(h.group.target.id,'B');assert.equal(h.group.lostTargets.length,1,'one notice retires the lock once');}],
 // On a Hunt a member nominates the Hunt's monsters too, with no failed-approach mark of its own,
 // so the retired lock stays out of every nomination until the leader's mark expires, then may
 // come back. The notice carries the mark's own expiry (shared.js `farmApproach.failed`), so the
 // queue keeps no copy of its window: the row plants a 5 s mark.
 ["an unreachable lock stays out of a member's Hunt nominations until the leader's mark expires", huntFixture=>{
 const h=huntFixture();assert.equal(h.group.target.id,'A','precondition: A is the lock');
 const g=n=>h.members[n].status.groupedCombat;
 g(0).candidates=g(0).candidates.filter(c=>c.id==='A');g(1).candidates=[monster('A',80)];
 g(0).unreachable=[{id:'A',map:'cave',in:'cave',at:h.group.queue[0].startedAt+1,until:h.now+5000}];
 h.tick();assert.notEqual(h.group.target?.id,'A','the lock retires');
 // The leader's own mark keeps A out of its nominations; the member has none.
 g(0).candidates=[];
 for(let i=0;i<45;i++){h.tick();assert.notEqual(h.group.target?.id,'A',"the member's nomination of A waits out the mark");}
 for(let i=0;i<10;i++)h.tick();
 assert.equal(h.group.target?.id,'A','once the mark expires the member may nominate A again');}],
]);
function engage(f,id='A'){f.members[0].status.groupedCombat.evidence.push({...monster(id),server:'USII',at:1000,action:id,state:'engaged'});f.tick();}

const claim=(id,external,at,extra={})=>({id,map:'cave',in:'cave',server:'USII',external,at,...extra});

scenarioTable("the grouped queue pursues a moving target and revokes it for a closer one", ()=>pursuitFixture, [
 ['stalled pursuit revokes authorization, awaits all clients, then replaces and cools down target', pursuitFixture=>{
 const {f,tick}=pursuitFixture();for(let i=0;i<65;i++)tick();
 assert.ok(f.g.pursuit.revoking);assert.equal(f.g.target.id,'A');assert.equal(f.g.committed,false);
 f.members[0].status.groupedCombat.pursuitAck=f.g.pursuit.revoking;tick();assert.equal(f.g.target.id,'A');
 tick(true);assert.equal(f.g.target.id,'B');assert.ok(f.g.pursuitExclusions.length);assert.ok(!f.g.queue.some(t=>t.id==='A'));
 tick();assert.equal(f.g.target.id,'B');}],
]);
scenarioTable("sight recovery retraces breadcrumbs and explores checked detours toward the last sighting", ()=>createSightRecovery, [
 ['visibility recovery backtracks then explores collision-checked local detours with no pathfinder', createSightRecovery=>{
 let now=0;const self={x:0,y:0,range:100,speed:50},moves=[],reasons=[];
 const r=createSightRecovery({now:()=>now,self:()=>self,clear:p=>p.y>=0,move:p=>moves.push(p),report:s=>reasons.push(s),budget:()=>({ms:8000,steps:6}),clock:{roundTrip:()=>250,reportInterval:()=>1000}});
 r.tick('A',{x:100,y:0},{x:20,y:0},[{x:50,y:0}]);assert.equal(moves[0].x,20);
 for(let i=0;i<50;i++){now+=200;r.tick('A',{x:100,y:0},null,[]);}
 assert.ok(reasons.some(s=>s.includes('detour')));assert.ok(moves.every(p=>p.y>=0));}],
 // The bounded search's end sends one targeting.unreachable for its target, and a search for
 // another target sends its own. Isolated: in a live run neither fighter of the default table
 // ran the search when the grouped lock left both clients' view (the warrior kept its independent
 // approach, the priest waited for the party's observation), so no live row reaches the search's
 // end.
 ['the bounded search ends with one targeting.unreachable per search', createSightRecovery=>{
 let now=0;const self={x:0,y:0,speed:50},told=[];
 const r=createSightRecovery({now:()=>now,self:()=>self,clear:()=>false,move:()=>{},report:()=>{},unreachable:id=>told.push(id),budget:()=>({ms:8000,steps:6}),clock:{roundTrip:()=>250,reportInterval:()=>1000}});
 for(let i=0;i<60;i++){now+=250;r.tick('A',{x:100,y:0},null,[]);}
 assert.deepEqual(told,['A'],'one notice at the end of the search for A');
 for(let i=0;i<60;i++){now+=250;r.tick('B',{x:100,y:0},null,[]);}
 assert.deepEqual(told,['A','B'],'a new search sends its own');}],
 // R2F4: the search reads the delivered `movementSightSearchMs` and `movementSightSteps` (red: the
 // 8 s and 6 steps written in the code).
 ['the search ends at its delivered budget: its time and its steps', createSightRecovery=>{
 let now=0;const self={x:0,y:0,speed:50},told=[],clock={roundTrip:()=>250,reportInterval:()=>1000};
 const timed=createSightRecovery({now:()=>now,self:()=>self,clear:()=>false,move:()=>{},report:()=>{},unreachable:id=>told.push(id),budget:()=>({ms:2000,steps:6}),clock});
 for(let i=0;i<8;i++){now+=250;timed.tick('A',{x:100,y:0},null,[]);}
 assert.deepEqual(told,[],'within its 2 s');now+=250;timed.tick('A',{x:100,y:0},null,[]);assert.deepEqual(told,['A']);
 let moves=0;const stepped=createSightRecovery({now:()=>now,self:()=>self,clear:()=>true,move:()=>{moves++;},report:()=>{},unreachable:id=>told.push(id),budget:()=>({ms:8000,steps:1}),clock});
 stepped.tick('B',{x:100,y:0},null,[]);stepped.tick('B',{x:100,y:0},null,[]);
 assert.equal(moves,1);assert.deepEqual(told,['A','B'],'one step spends a one-step budget');}],
]);


// `targeting.groupView` reads the group's queue ledger: its selection, queue, lock, fights, deaths,
// claims and revision, the members whose report acknowledges that revision, each lost target with
// when and why it was retired, and when the group's fight was last seen.
require('node:test')('targeting.groupView: the read names the queue ledger facts and its lost targets', () => {
  const { installCoordinatorTargeting } = require('../../runtime/coordinator/targeting/install.ts');
  const lost = { id: 'bee', map: 'main', server: 'USII', retiredAt: 5, reason: 'released for travel; no current attacker' };
  const state = { groupedCombat: { selection: 's1', queue: [{ id: 'goo' }], target: { id: 'goo' }, fights: [{ id: 'goo' }], deaths: [{ id: 'old' }],
    claims: [], queueRevision: 'r7', lostTargets: [lost], seenAt: 9 },
    statuses: { W: { groupedCombat: { queueAck: 'r7' } }, P: { groupedCombat: { queueAck: 'r6' } } } };
  // The application publishes core:targeting over its group records; the row reads the published one.
  let published;
  installCoordinatorTargeting({ publish: r => { published = r; return { ok: true }; } }, { state: g => g === 'party:W' ? state : undefined, now: () => 10 });
  const view = published.hooks['targeting.groupView']({ group: 'party:W' });
  assert.deepEqual(view, { selected: 's1', queued: [{ id: 'goo' }], locked: { id: 'goo' }, engaged: [{ id: 'goo' }], killed: [{ id: 'old' }], claimed: [],
    revision: 'r7', acknowledgements: ['W'], lost: [lost], seenAt: 9 });
  assert.equal(published.hooks['targeting.groupView']({ group: 'party:X' }), undefined);
});

// The group's anchor without an add-on (coordinator/targeting/queue.ts `healingAnchor`): the usable
// healing priest, else the leader. The add-on's `group.anchor` answer stays in class-skills.test.cjs, whose
// process holds no other answer to that hook.
scenarioTable("the group anchors on the usable healing priest, else the leader", ()=>undefined, [
 ['composition selects a usable priest deterministically, otherwise permits leader anchoring', ()=>{
  const {healingAnchor}=require('../../runtime/coordinator/targeting/queue.ts');
  const members=['ranger','paladin','rogue'].map((ctype,i)=>({name:''+i,ctype,status:{hp:100,range:30,seenAt:10000}}));
  assert.equal(healingAnchor(members,10000),undefined);
  members.push({name:'P1',ctype:'priest',status:{hp:0,range:200,seenAt:10000}},
   {name:'P2',ctype:'priest',status:{hp:100,range:200,seenAt:10000}});
  assert.equal(healingAnchor(members,10000,'P1').name,'P2');
  members[3].status.hp=100;assert.equal(healingAnchor(members,10000,'P2').name,'P2');
  assert.equal(healingAnchor(members,20000),undefined);
 }],
]);
