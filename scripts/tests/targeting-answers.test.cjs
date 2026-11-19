// The targeting owner's ring, overkill skip, retire and scope (3.3, 3.6, 3.7, 3.12; failure list
// 11.1, 11.3, and, 11.5). One table over targeting's parts on hand-driven ports
// (fixtures/targeting-scenario.cjs). Separate from the live rows: it plants refusals, flights,
// notices and recovery verdicts no live row can time (13 "Each separate test").
const assert=require('node:assert/strict');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {targetingWorld}=require('./fixtures/targeting-scenario.cjs');
const {MOVEMENT_RING_SIZE}=require('../../runtime/protocol/records.ts');
const {createOverkillSkip}=require('../../runtime/characters/targeting/retire.ts');

scenarioTable("the targeting owner's ring, overkill skip, retire and scope",targetingWorld,[
  ['the overkill skip passes over a target its own damage in flight covers, and ends when the flight does',w=>{
    const goo={id:'goo1',hp:100};w.flights.goo1=100;
    assert.equal(w.skip.covers(goo),true,'its own flight covers the HP');
    assert.equal(w.skip.covers(goo),true);
    assert.equal(w.ring.entries().filter(e=>e.kind==='skipped').length,1,'one entry while the same skip holds');
    w.flights.goo1=0;assert.equal(w.skip.covers(goo),false,'the hit landed or its eta passed: a candidate again');
    w.flights.goo1=99;assert.equal(w.skip.covers(goo),false,'a flight short of the HP keeps the target');
    w.flights.goo1=100;assert.equal(w.skip.covers(goo),true);
    assert.equal(w.ring.entries().filter(e=>e.kind==='skipped').length,2,'a new skip writes a new entry');
    assert.deepEqual(Object.keys(w.ring.entries()[0]).sort(),['at','damage','hp','kind','part','seq','target','why']);
    assert.equal(w.ring.entries()[0].part,'targeting');
    assert.equal(createOverkillSkip({incoming:()=>0,record:()=>assert.fail('no skip writes no entry')}).covers({id:'x',hp:0}),false,'a target with no HP read is not skipped');
  }],
  // (13.4a): the skip records the target and the damage in flight that covered its HP, and the
  // last pass it held, so the turns checks can tell a skipped edge from an empty one.
  ['the overkill skip records its target, the damage that covered it and its last pass',w=>{
    w.now=1000;w.flights={goo1:3000,goo2:4000};
    assert.equal(w.skip.held('goo1'),null,'nothing held before a pass');
    w.skip.covers({id:'goo1',hp:100});w.now=1250;w.skip.covers({id:'goo2',hp:100});w.now=1500;w.skip.covers({id:'goo1',hp:100});
    assert.deepEqual(w.skip.held('goo1'),{target:'goo1',damage:3000,hp:100,since:1000,last:1500});
    assert.deepEqual(w.skip.held('goo2'),{target:'goo2',damage:4000,hp:100,since:1250,last:1250},'two targets covered at once each hold');
    assert.deepEqual(w.ring.entries().map(e=>[e.kind,e.target,e.damage,e.hp]),[['skipped','goo1',3000,100],['skipped','goo2',4000,100]],'one entry a skip, with its damage');
    w.flights.goo1=0;w.now=1750;w.skip.covers({id:'goo1',hp:100});
    assert.equal(w.skip.held('goo1'),null,'the hit landed: the skip ends');
  }],
  // A target its hit killed is never asked again, so its skip leaves the held map once
  // it is no live entity; the held map carries no count of its own.
  ["a dead target's skip leaves at the next new skip",w=>{
    w.flights={goo1:100,goo2:100};w.skip.covers({id:'goo1',hp:50});
    w.gone.add('goo1');w.skip.covers({id:'goo2',hp:50});
    assert.equal(w.skip.held('goo1'),null,'the dead target holds no skip');
    assert.notEqual(w.skip.held('goo2'),null);
  }],
  ['a pass with no skip and no refusal writes nothing, and each refusal is one entry until it changes',w=>{
    for(let i=0;i<3;i++)w.skip.covers({id:'goo1',hp:100});
    w.refused({id:'goo1'},'attack',undefined);
    assert.deepEqual(w.ring.entries(),[],'nothing skipped or refused writes nothing');
    w.refused({id:'goo1'},'attack','waiting for group readiness and target commitment');
    w.refused({id:'goo1'},'attack','waiting for group readiness and target commitment');
    assert.equal(w.ring.entries().length,1,'the same refusal on the same target is one entry');
    w.refused({id:'goo1'},'attack','Monster reflection: magical basic attacks disabled');
    w.refused({id:'goo1'},'curse','unauthorized or immune target');
    assert.deepEqual(w.ring.entries().map(e=>[e.kind,e.skill,e.target]),[['refused','attack','goo1'],['refused','attack','goo1'],['refused','curse','goo1']]);
    w.refused({id:'goo1'},'attack',undefined);
    w.refused({id:'goo1'},'attack','waiting for group readiness and target commitment');
    assert.equal(w.ring.entries().length,4,'an allow ends the refusal, so the next one is a new entry');
    for(let i=0;i<MOVEMENT_RING_SIZE+5;i++)w.ring.record({kind:'refused',target:'m'+i,skill:'attack',why:'x'});
    assert.equal(w.ring.entries().length,MOVEMENT_RING_SIZE,"the ring keeps at most the protocol ring's bound (V3.3)");
  }],
  // movement's notice marks the target with the failed-approach mark and drops it as the selection,
  // with no killed-list entry; every mark, the farm approach's own included, clears at the pass
  // where the fight fact turns true, and a mark set inside a fight holds.
  ['the retire marks and drops the target, and every mark clears at a fight\'s start',w=>w.as('W',()=>{
    w.selected='ghost1';
    w.marks.farm1=Date.now()+10000; // The farm approach's own mark (movement's, shared.js 16151)
    w.retire.notice({character:'P',target:'ghost1',why:'approach'});
    assert.deepEqual({marks:Object.keys(w.marks),dropped:w.dropped},{marks:['farm1'],dropped:[]},"another character's notice changes nothing here");
    w.retire.notice({character:'W',target:'ghost1',why:'approach'});
    assert.deepEqual(Object.keys(w.marks).sort(),['farm1','ghost1']);
    assert.deepEqual(w.dropped,['ghost1'],'the selection is dropped');
    w.retire.notice({character:'W',target:'ghost2',why:'sight'});
    assert.deepEqual(w.dropped,['ghost1'],'a target that is not the selection is marked and not dropped');
    assert.deepEqual(w.ring.entries().map(e=>[e.kind,e.target,e.why]),[['retired','ghost1','approach'],['retired','ghost2','sight']]);
    w.retire.pass();assert.equal(Object.keys(w.marks).length,3,'no fight: the marks keep their 10 s');
    w.fighting=true;w.retire.pass();
    assert.deepEqual(Object.keys(w.marks),[],"a fight's start clears every mark, the farm approach's included");
    assert.equal(w.ring.entries().at(-1).kind,'marks-cleared');
    w.retire.notice({character:'W',target:'ghost3',why:'approach'});w.retire.pass();w.retire.pass();
    assert.deepEqual(Object.keys(w.marks),['ghost3'],'a mark set inside a fight holds');
    w.fighting=false;w.retire.pass();w.fighting=true;w.retire.pass();
    assert.deepEqual(Object.keys(w.marks),[],'the next fight starts clear');
    // The target timer: with no mark set, a pass asks no fight fact, and a mark
    // set while a fight already runs still holds.
    w.fightAsks=0;for(let i=0;i<5;i++)w.retire.pass();
    assert.equal(w.fightAsks,0,'a pass with no mark asks survival.fighting');
    w.retire.notice({character:'W',target:'ghost4',why:'approach'});w.retire.pass();
    assert.deepEqual(Object.keys(w.marks),['ghost4'],'a mark set inside a running fight holds');
    w.fighting=false;w.retire.pass();w.fighting=true;w.retire.pass();
    assert.deepEqual(Object.keys(w.marks),[],'the fight after it starts clear');
  })],
  // e2e/live-targeting-hooks.spec.ts "the walled goo is retired once": movement repeats its
  // unreachable notice for the same goo across passes and fights; each repeat renews the mark and
  // the drop, and the ring and its notice hold one retired entry per goo.
  ['repeated unreachable notices for one goo give one retired entry',w=>w.as('W',()=>{
    for(let i=0;i<5;i++){
      w.selected='goo1';
      w.retire.notice({character:'W',target:'goo1',why:'approach'});w.retire.pass();
      assert.ok('goo1' in w.marks,'each repeat renews the mark');
      w.fighting=!w.fighting;w.retire.pass();
    }
    assert.deepEqual(w.dropped,['goo1','goo1','goo1','goo1','goo1'],'each repeat drops the selection');
    assert.deepEqual(w.ring.entries().filter(e=>e.kind==='retired').map(e=>e.target),['goo1']);
  })],
  // (3.6, 13.5): the leader's notice on its own grouped lock target is reported to the queue, which
  // retires the lock; a notice on another target or from a member that is not the leader reports
  // nothing.
  ['the leader reports its own unreachable lock target, and only that',w=>w.as('W',()=>{
    w.lock={id:'ghost1',map:'main',in:'main'};
    w.retire.notice({character:'W',target:'ghost1',why:'approach'});
    assert.deepEqual(w.retire.report(),[],'a member that is not the leader reports nothing');
    w.leader=true;
    w.retire.notice({character:'W',target:'ghost2',why:'approach'});
    assert.deepEqual(w.retire.report(),[],'a target that is not the lock reports nothing');
    w.retire.notice({character:'W',target:'ghost1',why:'approach'});
    assert.deepEqual(w.retire.report().map(e=>[e.id,e.map,e.in,typeof e.at]),[['ghost1','main','main','number']]);
    assert.equal(w.retire.retiring('ghost1'),true,'the approach holds off the lock until the queue retires it');
    assert.equal(w.retire.retiring('ghost2'),true,'a marked target that is not the lock holds too');
    assert.equal(w.retire.retiring('ghost9'),false);
    w.lock={id:'ghost3',map:'main',in:'main'};
    assert.deepEqual(w.retire.report(),[],'the report ends once the queue holds another lock');
    assert.equal(w.retire.retiring('ghost1'),true,'the live mark still holds the approach');
    w.marks.ghost1=Date.now()-1;
    assert.equal(w.retire.retiring('ghost1'),false,'the approach starts again once the mark lapses');
  })],
  // e2e/live-targeting-hooks.spec.ts TG13: the queue's retire lands and the lock goes null, while
  // the member's cached lock target is still the retired one for one more game update. The
  // approach reads retiring in that gap and must not start.
  ['a target whose mark is live stays retiring after the lock goes null',w=>w.as('W',()=>{
    w.lock={id:'ghost1',map:'main',in:'main'};w.leader=true;
    w.retire.notice({character:'W',target:'ghost1',why:'approach'});
    w.lock=null;
    assert.deepEqual(w.retire.report(),[],'the report ends with the lock');
    assert.equal(w.retire.retiring('ghost1'),true,'the mark holds the approach in the gap');
    assert.equal(w.retire.retiring('ghost2'),false,'an unmarked target is free');
  })],
  // (3.3; v1.5.0 shared.js:14724-14727): in death recovery every target is refused, a
  // party attacker included, unless the verdict is `finish` and the target is on the finishing
  // list; any other tier refuses nothing here. Layer 7 probe held this rule in play with no
  // committed check, so layer 7 step 5 adds this row.
  ['death recovery refuses every target but a listed one under the finish verdict',w=>{
    const goo={id:'goo1'},attacker={id:'goo2',target:'W'};
    for(const tier of [null,'farming','escape']){w.tier=tier;assert.equal(w.scope.recoveryRefuses(goo),false,`tier ${tier}`);}
    w.tier='death-recovery';w.listed=['goo1'];
    assert.equal(w.scope.recoveryRefuses(goo),true,'the fight verdict refuses a listed target');
    assert.equal(w.scope.recoveryRefuses(attacker),true,'the fight verdict refuses a party attacker');
    w.verdict='finish';
    assert.equal(w.scope.recoveryRefuses(goo),false,'the finish verdict allows a listed target');
    assert.equal(w.scope.recoveryRefuses(attacker),true,'the finish verdict refuses a party attacker off the list');
    w.verdict='leave';assert.equal(w.scope.recoveryRefuses(goo),true,'the leave verdict refuses a listed target');
  }],
]);

// A Cleave hits every monster in its area, so the group lock row
// never refuses its victims, while a single-target skill on the same monster is refused there; during
// Franky a Cleave's victim is any live, visible monster on the character's map and instance the drain
// allows. The claims setup (fixtures/targeting-scenario.cjs) with the group lock planted on another
// monster.
const {claimsSetup}=require('./fixtures/targeting-scenario.cjs');
scenarioTable("a Cleave's victims pass the group lock",()=>{
  const {context:c,entities}=claimsSetup();
  c.leaderLockAllows=()=>false;c.huntTravelDefense=()=>false;
  // The realm's hooks answer no skill pick, no escape and, for the lifecycle owner's
  // `lifecycle.drain`, no drain.
  c.root.__partyHooks={skills:{allows:()=>undefined},survival:{escaping:()=>undefined},ask:()=>null};
  return {c,victim:{...entities['1']}};
},[
  ["a Cleave's victim outside the lock is allowed",({c,victim})=>{
    assert.equal(c.isAllowedTarget(victim,undefined,undefined,'cleave'),true);
    assert.equal(c.skillTargetAllowed(victim,'cleave'),true);
  }],
  ['a single-target skill on the same monster is refused by the lock',({c,victim})=>{
    const diagnostic={};
    assert.equal(c.isAllowedTarget(victim,undefined,diagnostic),false);
    assert.equal(diagnostic.reason,'group target lock');
    assert.equal(c.skillTargetAllowed(victim,'supershot'),false);
  }],
  ["a Franky Cleave takes an add on the character's map",({c,victim})=>{
    c.characterEvents.frankyActive=()=>true;c.frankyTargetAllowed=()=>false;
    Object.assign(victim,{map:c.character.map,in:c.character.in});
    assert.equal(c.skillTargetAllowed(victim,'cleave'),true);
    assert.equal(c.skillTargetAllowed(victim,'supershot'),false,'a single-target skill keeps the Franky row');
  }],
]);

// A hidden pick is the party's saved value, not its declared default. A character's reply delivers
// the value; a value its declaration's check refuses leaves the pick as it was.
const test=require('node:test');
test('a delivered hidden pick reaches the character and a refused value leaves it as it was',()=>{
  const {deliveredPicks,pick,readPicks}=require('../../runtime/characters/targeting/saved-fields.ts');
  const picks=deliveredPicks();readPicks(picks.read);
  assert.equal(pick('setAsideMs'),10000,'the declared default before any reply');
  const saved=2*pick('setAsideMs');
  picks.take({setAsideMs:saved,crabReplyMs:-1});
  assert.equal(pick('setAsideMs'),saved);
  assert.equal(pick('crabReplyMs'),2000,'a value the check refuses is not taken');
});

// A member's stamp counts no further ahead than the clock difference the console measured for it
// (protocol/reports.ts `notAhead`), where every site allowed a fixed 500 ms (red: a reservation 400
// ms ahead from a member with no clock sync counted).
test('a passing reservation ahead of the clock counts only within its member\'s measured clock difference',()=>{
 const {collectPassing}=require('../../runtime/characters/targeting/api.ts');
 const member=(name,networkMs)=>({name,ctype:'',revision:0,status:{name,seenAt:1000,server:'USII',map:'main',in:'main',hp:100,
  travelSample:{transport:{clock:{networkMs}}},groupedCombat:{passingEncounters:[{id:'b'+name,mtype:'bee',server:'USII',map:'main',in:'main',x:0,y:0,at:1400}]}}});
 assert.deepEqual(collectPassing([member('A',0),member('B',1000)],[],1000).map(e=>e.id),['bB'],'B\'s sync allows 500 ms ahead; A\'s allows none');
});
