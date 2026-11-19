const test=require('node:test'),assert=require('node:assert/strict');
const zones=require('../../runtime/hunting/zones.ts');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { area, queueWorld } = require('./fixtures/fringe-targeting-scenario.cjs');
const inside={id:'inside',map:'halloween',x:-580,y:-330},fringe={id:'fringe',map:'halloween',x:-509,y:-626};
test('bounded zone wins exclusively; fringe is allowed only when it is empty',()=>{
 assert.deepEqual(zones.candidates(area,[inside,fringe],400),[inside]);
 assert.deepEqual(zones.candidates(area,[fringe],400),[fringe]);
 assert.deepEqual(zones.candidates(area,[{...fringe,map:'main'},{...fringe,y:-900}],400),[]);
 assert.deepEqual(zones.candidates({...area,boundary:undefined},[inside,fringe],400),[inside,fringe]);
 assert.deepEqual(zones.candidates({...area,boundary:[-654,-900,-398,-287]},[{...fringe,y:-850}],100),[{...fringe,y:-850}]);
});
// The queue's candidates in the Halloween area: one world per row (fixtures/fringe-targeting-scenario.cjs).
const world = spec => { const entities = spec.entities(); return { entities, c: queueWorld({ ...spec, entities }) }; };
scenarioTable('the queue nominates from the zone, its claims and its exclusions', world, [
 ['queue filters claims and path exclusions before choosing zone, while passive rares remain available', ({ c, entities }) => {
  const ids=()=>Array.from(c.queueCandidates(),t=>t.id);
  assert.deepEqual(ids(),['inside','rare']);entities.inside.claimed=true;assert.deepEqual(ids(),['fringe','rare']);
  // The set-aside list is targeting's own, in place of movement's failed-approach marks.
  entities.inside.claimed=false;c.setAside={inside:Date.now()+10000};assert.deepEqual(ids(),['fringe','rare']);
  c.setAside={};assert.deepEqual(ids(),['inside','rare']);
  delete entities.rare;entities.second={...entities.inside,id:'second'};entities.third={...entities.inside,id:'third'};
  c.partyConvoyActive=true;assert.deepEqual(ids(),[]);assert.equal(c.root.__partyNomination.blocked,'convoy travel');
  c.partyConvoyActive=false;assert.deepEqual(ids(),['inside','second','third']);
  assert.deepEqual(Array.from(c.root.__partyNomination.eligible),['inside','second','third']);
  assert.equal(c.root.__partyNomination.rejected.fringe,'zone or target eligibility');
 }, { character: { name: 'W' }, focus: ['osnake'], rareHunts: { phoenix: true }, radius: 400, priority: t => t.mtype === 'phoenix' ? 100 : 50,
  entities: () => {
   const entities = {};
   for (const t of [inside, fringe]) entities[t.id] = { ...t, mtype: 'osnake', type: 'monster', visible: true, hp: 100 };
   entities.rare = { ...fringe, id: 'rare', mtype: 'phoenix', type: 'monster', visible: true, hp: 100 };
   return entities;
  } }],
 ['a follower nominates nearby ghosts outside the original spawn area for all three target rings', ({ c, entities }) => {
  assert.deepEqual(Array.from(c.queueCandidates(),t=>t.id),['g1','g2','g3']);
  entities.g1.claimed=true;entities.g2.x=250;entities.g3.in='other';assert.deepEqual(Array.from(c.queueCandidates()),[]);
 }, { character: { name: 'M', map: 'halloween', in: 'halloween', x: 0, y: 0 }, focus: ['ghost'], huntTarget: 'ghost', rareHunts: {}, radius: 200, priority: () => 50,
  entities: () => Object.fromEntries([1,2,3].map(i=>['g'+i,{id:'g'+i,mtype:'ghost',type:'monster',visible:true,hp:100,map:'halloween',in:'halloween',x:i*20,y:0}])) }],
]);
