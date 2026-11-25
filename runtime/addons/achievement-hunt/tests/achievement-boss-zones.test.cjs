// Achievement Hunt's boss zones on the characters (runtime/addons/achievement-hunt/zones.ts), the
// fork's scripts/tests/achievement-boss-avoid.test.cjs on the add-on. Failure list first, in
// e2e/movement-owner-failures.md items 15 to 17. Isolated: the game server spawns no boss beside
// a farm on demand, as the fork's test notes, so no live scenario covers the zone.
const test=require('node:test'),assert=require('node:assert/strict');
const {inZone,zoneRefusal,retreatAnswer,avoidedBosses}=require('../zones.ts');

const boss=(extra={})=>({id:'s',type:'monster',mtype:'stompy',x:0,y:0,target:null,...extra});
const view=(entities,me={x:100,y:0},extra={})=>({character:{name:'W',ctype:'warrior',map:'winterland',real_x:me.x,real_y:me.y},entities,party:['W','P'],
  stepSafe:()=>true,inFarmArea:()=>true,canMoveTo:()=>true,canStand:()=>true,target:{id:'wolf'},...extra});

// The three failure-list items share the boss and view setup above, so they are rows of one test: a
// failing row names its item and the other rows still run.
test('the boss zone: its extent, the combat steps it refuses and the retreat out of it (items 15 to 17)',async t=>{
await t.test('item 15: a zone is the boss aggro block, and a walking boss also covers the cells of its walk',()=>{
  const rows=[
    [boss(),{x:40,y:40},true,'inside the 3x3 block of 32-unit cells'],
    [boss(),{x:100,y:0},false,'past the block'],
    [boss({moving:true,going_x:200,going_y:0}),{x:150,y:10},true,'on the walk to its going point'],
    [boss({moving:true,going_x:-200,going_y:0}),{x:150,y:10},false,'its walk leads away'],
  ];
  for(const [b,p,expected,why] of rows)assert.equal(inZone(p,b),expected,why);
});

await t.test('item 16: no combat step ends inside a zone, except a step out of it, and a joined event fights its boss',()=>{
  const e={s:boss()};
  assert.match(zoneRefusal(view(e),['stompy'],{x:40,y:0}),/stompy's zone/);
  assert.equal(zoneRefusal(view(e),['stompy'],{x:120,y:0}),undefined);
  assert.equal(zoneRefusal(view(e,{x:20,y:0}),['stompy'],{x:40,y:0}),undefined,'a step out of the zone it stands in');
  assert.equal(zoneRefusal(view(e,{x:100,y:0},{joinedEvent:'mrpumpkin'}),['stompy'],{x:40,y:0}),undefined,'a joined event');
  assert.equal(zoneRefusal(view(e),[],{x:40,y:0}),undefined,'no avoid list');
  assert.deepEqual(avoidedBosses(view({s:boss({dead:true})}),['stompy']),[],'a dead boss keeps no zone');
});

await t.test('item 17: inside a zone the character walks to the nearest clear point, keeping its target and the priest heal range',()=>{
  const e={s:boss(),P:{name:'P',ctype:'priest',map:'winterland',x:60,y:-60,range:200}};
  const a=retreatAnswer(view(e,{x:30,y:0}),['stompy']);
  assert.equal(a.kind,'step');assert.equal(a.target,'wolf');
  assert.equal(inZone(a.to,e.s),false);
  assert.ok(Math.hypot(a.to.x-60,a.to.y+60)<=200,'within the priest heal range');
  assert.equal(retreatAnswer(view(e,{x:200,y:0}),['stompy']),undefined,'outside every zone it leaves the tick alone');
  assert.equal(retreatAnswer(view(e,{x:30,y:0},{stepSafe:()=>false}),['stompy']).kind,'hold','no walkable point holds with the reason');
});
});

// The add-on's two waiting rules, as the fork's `isAllowedTarget` ran them (fork shared.js
// 15598-15612), now its `targeting.candidates` answer, which targeting asks inside its
// eligibility check. A boss on the avoid list is never a target outside its joined event. A new
// pull is refused when its target or the character's attack spot lies inside a zone; a monster
// attacking the party and the character's current target are no new pull.
test('never a boss on the avoid list outside its event, and no new pull into a zone',()=>{
  const {pullRefusal}=require('../zones.ts');
  const wolf=(extra={})=>({id:'wolf',type:'monster',mtype:'arcticbee',x:40,y:0,target:null,...extra});
  const zone=(extra={})=>({character:{name:'W',map:'winterland',real_x:300,real_y:0,range:100,target:null},entities:{s:boss()},joinedEvent:null,...extra});
  const party=['W','P'];
  assert.equal(pullRefusal(zone(),['stompy'],boss(),party),'avoided boss');
  assert.equal(pullRefusal(zone({joinedEvent:'stompy'}),['stompy'],boss(),party),undefined,'its own joined event fights it');
  assert.equal(pullRefusal(zone(),['stompy'],boss({target:'P'}),party),'avoided boss','an avoided boss attacking the party stays refused, as the fork');
  assert.equal(pullRefusal(zone(),['stompy'],wolf(),party),'boss keep-out zone','a pull whose target stands in the zone');
  assert.equal(pullRefusal(zone(),['stompy'],wolf({x:-100}),party),'boss keep-out zone','a pull whose attack spot lies in the zone');
  assert.equal(pullRefusal(zone(),['stompy'],wolf({x:200}),party),undefined,'target and spot outside every zone');
  assert.equal(pullRefusal(zone(),['stompy'],wolf({target:'P'}),party),undefined,'a monster attacking the party is no new pull');
  const current=zone();current.character.target='wolf';
  assert.equal(pullRefusal(current,['stompy'],wolf(),party),undefined,'the current target is no new pull');
  assert.equal(pullRefusal(zone(),[],wolf(),party),undefined,'no avoid list');
  // The registration: with the delivered avoid list it keeps the candidates the rules allow, and
  // with none it answers nothing, which keeps every candidate. It reads the character, the entities
  // and the party from targeting's view, not the game client.
  const {registration:achievementHunt}=require('../index.ts');
  const saved={hooks:globalThis.__partyHooks};
  let avoid=['stompy'];
  const view=extra=>({character:{name:'W',map:'winterland',real_x:300,real_y:0,x:300,y:0,range:100,target:null},entities:{s:boss()},party,
    nomination:null,event:null,...extra});
  globalThis.__partyHooks={delivered:()=>({avoid})};
  try{
    const ask=achievementHunt.hooks['targeting.candidates'];
    assert.deepEqual(ask(view({candidates:[boss(),wolf(),wolf({id:'far',x:200})]}),{}).map(c=>c.id),['far']);
    assert.deepEqual(ask(view({candidates:[wolf({target:'P'})],party:['W']}),{}).map(c=>c.id),[],"the view's party decides who counts as the party");
    avoid=[];
    assert.equal(ask(view({candidates:[boss()]}),{}),undefined,'no avoid list answers nothing');
  }finally{globalThis.__partyHooks=saved.hooks;}
});

// The status report (index.ts `status.report`, zones.ts `sightings`) carries each avoided boss in
// view with its position and target, every one of them, which the hunt reads to leave a held
// target; with no avoid list it answers nothing, and a dead or unlisted boss is no sighting.
test('the report: every avoided boss in view, with its position and target, and nothing with no avoid list',()=>{
  const {sightings}=require('../zones.ts');
  const {registration:achievementHunt}=require('../index.ts');
  const many=Object.fromEntries(Array.from({length:10},(_,i)=>[`s${i}`,boss({id:`s${i}`,x:i*10,target:i?null:'W'})]));
  const e={...many,d:boss({id:'d',dead:true}),g:{id:'g',type:'monster',mtype:'goo',x:5,y:5}};
  const seen=sightings(view(e),['stompy']);
  assert.equal(seen.length,10,'ten avoided bosses, ten sightings');
  assert.deepEqual(seen[0],{id:'s0',mtype:'stompy',x:0,y:0,target:'W'});
  const saved={hooks:globalThis.__partyHooks};
  let avoid=['stompy'];
  globalThis.__partyHooks={delivered:()=>({avoid})};
  try{
    const report=achievementHunt.hooks['status.report'];
    assert.equal(report(view(e),{},null).sightings.length,10);
    avoid=[];
    assert.equal(report(view(e),{},null),undefined,'no avoid list answers nothing');
  }finally{globalThis.__partyHooks=saved.hooks;}
});
