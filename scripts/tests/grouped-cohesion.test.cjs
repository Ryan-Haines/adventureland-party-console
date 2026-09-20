const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateGroup}=require('../../runtime/combat/grouped.ts');
function fixture(){
  return ['W','P','M'].map((name,i)=>({name,ctype:['warrior','priest','mage'][i],revision:1,
    status:{seenAt:1000,hp:100,map:'cave',in:'cave',server:'USII',x:i*20,y:0,range:200,
      combatSelection:{id:null,map:null,revision:0,runtimeId:name+'-runtime'},groupedCombat:{protocol:4,anchorVisible:true,ack:null}}}));
}
function ready(m){return evaluateGroup(evaluateGroup(null,m,'W',1000),m,'W',1500);}
function nominate(m,id='A',revision=1){m[0].status.groupedCombat.candidates=[{id,mtype:'cgoo',map:'cave',in:'cave',x:80,y:0}];Object.assign(m[0].status.combatSelection,{id,revision,map:'cave',target:{id,mtype:'cgoo',map:'cave',in:'cave',x:80,y:0}});}
test('missing report servers retain the legacy initial-group failure without inventing a realm',()=>{
 const m=fixture();for(const member of m)delete member.status.server;
 assert.throws(()=>ready(m),TypeError);
 assert.ok(m.every(member=>!Object.hasOwn(member.status,'server')));
 assert.equal(m[0].status.combatSelection.id,null);assert.equal(m[0].status.combatSelection.map,null);
});
test('current attackers supersede a neutral nomination while preserving unfinished fights',()=>{
 const m=fixture();nominate(m,'hound');let g=ready(m);
 m[1].status.groupedCombat.threats=[{id:'boar',mtype:'boar',map:'cave',in:'cave',x:30,y:0}];
 g=evaluateGroup(g,m,'W',1600);
 assert.equal(g.target.id,'boar');assert.deepEqual(g.fights.map(f=>f.id),['boar']);
 assert.deepEqual(g.threats.map(f=>f.id),['boar']);
 m[0].status.groupedCombat.threats=[{id:'other',mtype:'boar',map:'cave',in:'cave',x:40,y:0}];
 g=evaluateGroup(g,m,'W',1700);assert.equal(g.target.id,'boar','retain focus among active attackers');
});
test('wrong-map member recovers without blocking participating fighters',()=>{
  const m=fixture();m[2].status.map='main';
  const g=ready(m);assert.equal(g.ready,true);assert.deepEqual(g.recovering,['M']);
  m[2].status.map='cave';const reunited=evaluateGroup(g,m,'W',1600);assert.equal(reunited.ready,true);assert.deepEqual(reunited.recovering,['M']);
  assert.equal(evaluateGroup(reunited,m,'W',2100).ready,true);
});
test('one target is committed only after every member acknowledges the exact revision',()=>{
  const m=fixture();nominate(m);let g=ready(m);assert.equal(g.committed,false);
  for(const member of m)member.status.groupedCombat.ack=g.selection;
  g=evaluateGroup(g,m,'W',1600);assert.equal(g.committed,true);
  m[0].status.groupedCombat.deaths=[{id:'A',map:'cave',in:'cave',server:'USII',at:1650}];
  nominate(m,'B',2);const next=evaluateGroup(g,m,'W',1700);assert.equal(next.committed,false);
  assert.notEqual(next.selection,g.selection);assert.equal(next.target.id,'B');
});
test('separated member does not block the next committed fight',()=>{
  const m=fixture();nominate(m);let g=ready(m);
  m.forEach(member=>member.status.groupedCombat.ack=g.selection);g=evaluateGroup(g,m,'W',1600);
  m[0].status.groupedCombat.evidence=[{...m[0].status.combatSelection.target,server:'USII',at:1600,action:'hit',state:'engaged'}];m[2].status.x=500;m[2].status.groupedCombat.anchorVisible=false;g=evaluateGroup(g,m,'W',1700);
  assert.equal(g.ready,true);assert.equal(g.committed,true);assert.equal(g.phase,'engaged');assert.deepEqual(g.recovering,['M']);
  m[0].status.groupedCombat.deaths=[{id:'A',map:'cave',in:'cave',server:'USII',at:1650}];
  nominate(m,'B',2);g=evaluateGroup(g,m,'W',1800);assert.equal(g.committed,false);
  m.slice(0,2).forEach(member=>member.status.groupedCombat.ack=g.selection);
  assert.equal(evaluateGroup(g,m,'W',1900).committed,false);
});
test('unavailable members still block new pulls while unavailable priests release healing-anchor ownership',()=>{
  for(const [mutate,priest] of [[m=>m[1].status=undefined,null],[m=>m[1].status.rip=true,null],[m=>m[1].status.seenAt=-5000,null],
    [m=>m[1].status.groupedCombat.protocol=0,'P'],[m=>m[1].cancelled=true,null]]) {
    const m=fixture();mutate(m);const g=ready(m);assert.equal(g.ready,false);assert.equal(g.priest,priest);
    assert.equal(g.anchor?.name,priest || 'W');
  }
});
test('runtime replacement invalidates commitment and old acknowledgements',()=>{
  const m=fixture();nominate(m);let g=ready(m);m.forEach(member=>member.status.groupedCombat.ack=g.selection);
  g=evaluateGroup(g,m,'W',1600);m[2].status.combatSelection.runtimeId='new-runtime';
  const changed=evaluateGroup(g,m,'W',1700);assert.equal(changed.committed,false);assert.notEqual(changed.selection,g.selection);
});
test('priestless groups use leader spacing; no target still reports regrouping',()=>{
  const m=fixture().filter(m=>m.name!=='P');m[1].status.x=300;m[1].status.groupedCombat.anchorVisible=false;
  const g=ready(m);assert.equal(g.range,150);assert.equal(g.anchor.name,'W');assert.equal(g.phase,'ready');assert.deepEqual(g.recovering,['M']);assert.equal(g.target,null);
});
test('readiness has inward hysteresis before recovering and does not flicker at the edge',()=>{
  const m=fixture();let g=ready(m);m[2].status.x=198;
  g=evaluateGroup(g,m,'W',1600);assert.equal(g.ready,true);
  m[2].status.x=205;m[2].status.groupedCombat.anchorVisible=false;g=evaluateGroup(g,m,'W',1700);assert.deepEqual(g.recovering,['M']);
  m[2].status.x=198;m[2].status.groupedCombat.anchorVisible=true;g=evaluateGroup(g,m,'W',1800);assert.deepEqual(g.recovering,['M']);
  m[2].status.x=180;g=evaluateGroup(g,m,'W',1900);assert.deepEqual(g.recovering,['M']);
  assert.deepEqual(evaluateGroup(g,m,'W',2400).recovering,[]);
});

const fs=require('node:fs'),vm=require('node:vm');
const shared=fs.readFileSync('characters/shared.js','utf8');
function movement(){
  let now=1000;const moves=[],paths=[];
  const c=vm.createContext({Date:{now:()=>now},Math,JSON,Promise,Infinity,
    character:{name:'W',ctype:'warrior',map:'main',in:'main',x:0,y:0,speed:40},
    leader:'W',convoyRuntimeId:'W-runtime',coordinatorClockOffset:0,navigationIntent:{revision:1,cancelled:false},
    partyConvoyActive:false,convoyTraveling:null,game_log(){},
    groupedCombat:{key:'["W-runtime"]',leader:'W',members:['W','P'],seenAt:1000,ready:false,range:180,
      anchor:{name:'P',server:'USII',map:'cave',in:'cave',x:200,y:0},blockers:['W: different map'],priest:'P'},
    groupedFarming:()=>true,rareActive:()=>false,reunionRealm:()=> 'USII',runtimeCurrent:()=>true,
    get_player:()=>null,get_entity:()=>null,isExternallyClaimedMonster:()=>false,isAttackingPartyMember:()=>false,partyPositions:[],parent:{entities:{}},
    cancelFarmApproach(){},can_move_to:()=>false,safeCombatPoint:()=>true,stop:()=>Promise.resolve(),
    move:(x,y)=>{moves.push([x,y]);return Promise.resolve();},smart:{},
    root:{sharedRoutine:{isOccupied:()=>false,defensiveFormationMove:()=>false}},
    smart_move:destination=>{paths.push(destination);c.smart.on_done=()=>{};return new Promise(()=>{});},
  });
  vm.runInContext(shared.slice(shared.indexOf('  function groupedFresh('),shared.indexOf('  function leaderLockAllows(')),c);
  return {c,moves,paths,at(t){now=t;c.groupedCombat.seenAt=t;}};
}
test('off-map regroup runs without a monster and routes only after the local progress timeout',()=>{
  const f=movement();assert.equal(f.c.groupedMovement(),true);assert.equal(f.paths.length,0);
  f.at(4000);assert.equal(f.c.groupedMovement(),true);assert.equal(f.paths[0].map,'cave');
  f.c.navigationIntent.cancelled=true;f.c.groupedMovement();assert.equal(f.c.groupRegroup.route,null);
});
test('regroup route times out, retries with backoff, and stops after three attempts',()=>{
  const f=movement();f.c.groupedMovement();f.at(4000);f.c.groupedMovement();
  f.at(34000);f.c.groupedMovement();assert.equal(f.paths.length,1);
  f.at(39000);f.c.groupedMovement();assert.equal(f.paths.length,2);
  f.at(69000);f.c.groupedMovement();f.at(84000);f.c.groupedMovement();assert.equal(f.paths.length,3);
  f.at(114000);f.c.groupedMovement();f.at(144000);f.c.groupedMovement();assert.equal(f.paths.length,3);
  assert.match(f.c.root.partyCombatPosition.reason,/three attempts/);
});

test('announced convoy owns movement before its local command arrives',()=>{
  const f=movement();f.c.partyConvoyActive=true;
  f.c.character.name='P';f.c.character.moving=true;
  let stops=0;f.c.stop=()=>{stops++;return Promise.resolve();};
  assert.equal(f.c.groupedMovement(),true);f.at(10000);f.c.groupedMovement();
  assert.equal(stops,0);assert.equal(f.moves.length,0);assert.equal(f.paths.length,0);
});

test('target changes cannot restart or reset a regroup route',()=>{
  const f=movement();f.c.groupedMovement();f.at(4000);f.c.groupedMovement();
  const route=f.c.groupRegroup.route;
  f.c.groupedCombat.selection='next-target';f.at(5000);f.c.groupedMovement();
  assert.equal(f.c.groupRegroup.route,route);assert.equal(f.c.groupRegroup.attempts,1);
});


test('separated leader retains shared selection authority and holds neutral pulls',()=>{const m=fixture();m[0].status.x=500;m[0].status.groupedCombat.anchorVisible=false;nominate(m);const g=ready(m);assert.equal(g.targetLeader,'W');assert.equal(g.committed,false);});

test('visible distant member uses local movement without stopping nearby members',()=>{
 const f=movement();f.c.character.map='cave';f.c.character.in='cave';
 f.c.get_player=()=>({...f.c.groupedCombat.anchor,visible:true});
 assert.equal(f.c.groupedMovement(),false);assert.equal(f.paths.length,0);
});

test('unseen separated member takes a safe arc before starting a smart route',()=>{
 const f=movement();f.c.character.map='cave';f.c.character.in='cave';
 f.c.groupedCombat.anchor.x=400;
 f.c.can_move_to=(x,y)=>y>0;
 assert.equal(f.c.groupedMovement(),true);assert.equal(f.moves.length,1);
 assert.ok(f.moves[0][1]>0);assert.equal(f.paths.length,0);
});


test('unfinished rat survives selector separation, vanished nomination and runtime replacement',()=>{
 const m=fixture();nominate(m,'rat1');m[0].status.groupedCombat.evidence=[{...m[0].status.combatSelection.target,server:'USII',at:1000,action:'engage',state:'engaged'}];let g=ready(m);
 m.forEach(member=>member.status.groupedCombat.ack=g.selection);g=evaluateGroup(g,m,'W',1600);
 m[0].status.x=500;m[0].status.groupedCombat.anchorVisible=false;m[0].status.combatSelection.target=null;
 m[2].status.combatSelection={id:'rat2',revision:3,runtimeId:'mage2',map:'cave',target:{id:'rat2',mtype:'cgoo',map:'cave',in:'cave',x:20,y:0}};
 g=evaluateGroup(g,m,'W',1700);assert.equal(g.target.id,'rat1');assert.equal(g.targetLeader,'W');
 m[2].status.combatSelection.runtimeId='reloaded';g=evaluateGroup(g,m,'W',1800);assert.equal(g.target.id,'rat1');
 assert.equal(g.committed,true);assert.equal(g.fights.length,1);
});
test('only matching realm, instance and target death releases the unfinished fight',()=>{
 const m=fixture();nominate(m,'rat1');m[0].status.groupedCombat.evidence=[{...m[0].status.combatSelection.target,server:'USII',at:1000,action:'engage',state:'engaged'}];let g=ready(m);
 m[0].status.combatSelection.target=null;
 for(const death of [{id:'rat2'},{id:'rat1',in:'different'},{id:'rat1',server:'USIII'}]) {
  m[1].status.groupedCombat.deaths=[{id:'rat1',map:'cave',in:'cave',server:'USII',at:1600,...death}];
  g=evaluateGroup(g,m,'W',1700);assert.equal(g.target.id,'rat1');
 }
 m[1].status.groupedCombat.deaths=[{id:'rat1',map:'cave',in:'cave',server:'USII',at:1800}];
 assert.equal(evaluateGroup(g,m,'W',1800).target,null);
});
test('existing attackers remain locked after the original dies; neutral nomination waits',()=>{
 const m=fixture();nominate(m,'rat1');m[0].status.groupedCombat.evidence=[{...m[0].status.combatSelection.target,server:'USII',at:1000,action:'engage',state:'engaged'}];let g=ready(m);
 m[2].status.groupedCombat.threats=[{id:'rat2',mtype:'cgoo',map:'cave',in:'cave',x:40,y:0}];
 g=evaluateGroup(g,m,'W',1600);
 m[1].status.groupedCombat.deaths=[{id:'rat1',map:'cave',in:'cave',server:'USII',at:1700}];nominate(m,'rat3',3);
 g=evaluateGroup(g,m,'W',1800);assert.equal(g.target.id,'rat2');assert.equal(g.fights.length,1);
 m[0].status.groupedCombat.state=g;
 assert.equal(evaluateGroup(null,m,'W',1900).target.id,'rat2','coordinator restart restores reports');
});
test('lost visibility delegates to local recovery without smart routing and resets on reacquisition',()=>{
 const f=movement();let calls=0,resets=0;
 f.c.root.partyQueueClient={sight:{tick(){calls++;return true;},reset(){resets++;}}};
 Object.assign(f.c.groupedCombat,{selection:'rat',fights:[{id:'rat'}],target:{id:'rat',x:200,y:200,map:'main',in:'main',server:'USII'}});
 f.c.groupedMovement();f.at(10000);f.c.groupedMovement();assert.equal(calls,2);assert.equal(f.paths.length,0);
 f.c.get_entity=()=>({id:'rat',visible:true});f.c.is_in_range=()=>true;f.c.groupedMovement();assert.equal(resets,1);
});

test('explicit farming reset excludes older cached fight reports',()=>{
 const m=fixture();nominate(m,'rat1');const g=ready(m);m[0].status.groupedCombat.state=g;
 m[0].status.combatSelection.target=null;m[0].status.groupedCombat.candidates=[];
 assert.equal(evaluateGroup(null,m,'W',2000,1900).target,null);
});
test('missing visibility runtime holds identity without falling back to smart routes',()=>{
 const f=movement();Object.assign(f.c.groupedCombat,{selection:'rat',fights:[{id:'rat'}],target:{id:'rat',x:200,y:200,map:'main',in:'main',server:'USII'}});
 for(const t of [1000,10000,100000]){f.at(t);assert.equal(f.c.groupedMovement(),true);}
 assert.equal(f.paths.length,0);assert.match(f.c.root.partyCombatPosition.reason,/target retained/);
});

test('full-party wipe retains confirmed engagement until explicit reset or target death',()=>{
 const m=fixture();nominate(m);m[0].status.groupedCombat.evidence=[{...m[0].status.combatSelection.target,server:'USII',at:1000,action:'engage',state:'engaged'}];const before=ready(m);
 for(const member of m)Object.assign(member.status,{map:'main',in:'main',seenAt:2000,lastDeath:{at:1800},combatSelection:{id:null,map:null,revision:2,runtimeId:'respawn'}});
 const after=evaluateGroup(before,m,'W',2000);assert.equal(after.fights.length,1);assert.equal(after.target.id,'A');
});
test('one death or an ongoing attack retains unfinished-fight protection',()=>{
 for(const caseName of ['survivor','attacker']){
  const m=fixture();nominate(m);m[0].status.groupedCombat.evidence=[{...m[0].status.combatSelection.target,server:'USII',at:1000,action:'engage',state:'engaged'}];const before=ready(m);
  for(const member of m)Object.assign(member.status,{seenAt:2000,lastDeath:{at:1800}});
  if(caseName==='survivor')delete m[1].status.lastDeath;
  else m[1].status.groupedCombat.threats=[{id:'A',mtype:'cgoo',map:'cave',in:'cave',x:80,y:0}];
  assert.equal(evaluateGroup(before,m,'W',2000).target.id,'A');
 }
});
