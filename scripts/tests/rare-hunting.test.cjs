const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validPhoenixOrder } = require('../../runtime/hunting/saved-fields.ts');
const { zones } = require('../../runtime/hunting/zones.ts');
// The patrol's regions are the Phoenix spawn's catalog areas (rares.ts `regions`).
const regions = catalog => zones(catalog, ['phoenix']);
const boxes = [['main',708,-300,1668,-86],['main',378,1686,904,1920],
  ['main',-1358,-118,-1010,1680],['halloween',-166,453,182,808],['cave',-375,-1287,14,-1041]];
const catalog = [{ id:'phoenix', locations:boxes.map(([map,...boundary]) => ({ map,boundary,
  x:(boundary[0]+boundary[2])/2,y:(boundary[1]+boundary[3])/2 })) }];
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture,groupRare}=require('./fixtures/rare-hunting-scenario.cjs');

scenarioTable('Phoenix patrol regions cover every catalog area in a fixed order (MOV-150)', ()=>undefined, [
 ['all five catalog regions are required, independent of caller order', ()=>{
  const order=regions(catalog).map(a=>a.id);
  assert.equal(validPhoenixOrder(catalog,order),true);
  assert.equal(validPhoenixOrder(catalog,order.slice(1)),false);
  assert.equal(validPhoenixOrder(catalog,[...order.slice(1),order[1]]),false);
  assert.equal(validPhoenixOrder(catalog,[...order.slice(1),'invented']),false);
 }],
 // The region count is the game's.
 // With a sixth Phoenix box planted in the catalog, an order of all six is valid and one of five
 // is refused.
 ['a Phoenix order names every region the game lists', ()=>{
  const six = [{ id: 'phoenix', locations: [...catalog[0].locations, { map: 'desertland', boundary: [0, 0, 200, 200], x: 100, y: 100 }] }];
  const ids = regions(six).map(a => a.id);
  assert.equal(ids.length, 6);
  assert.equal(validPhoenixOrder(six, ids), true);
  assert.equal(validPhoenixOrder(six, ids.slice(0, 5)), false);
 }],
 ['a region the game view spans takes one stop; a larger one gets a sweep that covers it', ()=>{
  // The patrol walks each region's scan from its centre: every member stands at the published stop
  // and reports, until the region's samples are covered and the patrol moves to the next region.
  // The view is the game's (protocol/reports.ts GAME_VISION).
  const {GAME_VISION}=require('../../runtime/protocol/reports.ts');
  for(const area of regions(catalog)) {
    const r=fixture(),order=regions(catalog).map(a=>a.id),first=order.indexOf(area.id);
    r.party.monsterFocus=['phoenix'];
    for(const s of Object.values(r.party.statuses)) Object.assign(s,{map:area.map,in:area.map,x:area.x,y:area.y});
    r.patrol([...order.slice(first),...order.slice(0,first)]);
    const stops=[];
    for(let i=0;i<20&&r.party.rareHuntState.patrol.regionId===area.id;i++){
      r.controller.tick();const stop=r.party.rareHuntState.patrol.waypoint;
      if(r.party.rareHuntState.patrol.regionId!==area.id||!stop)break;
      if(!stops.some(p=>p.x===stop.x&&p.y===stop.y))stops.push(stop);
      for(const s of Object.values(r.party.statuses)) Object.assign(s,{x:stop.x,y:stop.y});
      r.party.activeConvoy=null;r.advance(500);r.controller.tick();r.advance(500);
    }
    const [x1,y1,x2,y2]=area.boundary,fits=x2-x1<=GAME_VISION[0]&&y2-y1<=GAME_VISION[1],tall=x2-x1<=GAME_VISION[0]&&!fits;
    assert.notEqual(r.party.rareHuntState.patrol.regionId,area.id,area.id+' finished its scan');
    assert.deepEqual(r.party.rareHuntState.patrol.incomplete,[],area.id+' covered every sample');
    assert.equal(stops.length===1,fits,area.id+' stops '+stops.length);
    if(tall) assert.ok(stops.every(p=>p.x===stops[0].x));
  }
 }],
]);

// The rank table's rare column decides which trips a passive rare
// interrupts. A trip the player started by hand finishes. Each rare's "May interrupt Hunt"
// switch covers the whole Hunt task, its farming included, and leaves backup farming alone.
scenarioTable('a rare interrupts farming and Hunt travel by the rank table, and a hand-started trip finishes', fixture, [
 ...[['farming',false,false],['farming',undefined,true],['backup-farming',false,true]].map(([stage,interruptsHunt,expected])=>
  ['Hunt '+stage+' with interruptsHunt '+interruptsHunt,r=>{
   r.party.targetMode='hunt';r.party.monsterHunt={cycleId:'h',stage};r.tasks.taskTick();
   r.controller.setSettings({rules:{bee:{enabled:true,keepMoving:false,priority:100,...(interruptsHunt===undefined?{}:{interruptsHunt})}}},'dashboard:rare-hunting');r.sight('bee');
   assert.equal(r.controller.encounter(),expected,'Hunt '+stage+' '+interruptsHunt);
  }]),
 // Each trip's task is the source fact the tasks owner reads: farming's slot, the player's trip from its
 // walk record (tasks/coordinator/manual.ts `tripOf`), the Hunt's travel from its record's stage.
 ...[['farm-relocation','farming',undefined,true,false],['party-travel','manual',undefined,false,false],
   ['monster-hunt','hunt-mission',undefined,true,true],['monster-hunt','hunt-mission',false,false,true]].map(([purpose,tier,interruptsHunt,expected,hunt])=>
  [`${purpose} trip at the ${tier} tier with interruptsHunt ${interruptsHunt}`,r=>{
   groupRare(r,'goo');r.party.groupedCombat.target=null;
   if(hunt){r.party.targetMode='hunt';r.party.monsterHunt={cycleId:'h',stage:'mission-travel'};}
   r.party.activeConvoy={id:'owned-travel',purpose,phase:'travel',huntTarget:'goo',location:{map:'main',x:0,y:0},participants:['W','M','P'],
    requester:{kind:'group-walk',tier}};r.tasks.taskTick();
   assert.equal(r.tasks.live('party:W').tier,tier,purpose);
   r.controller.setSettings({rules:{bee:{enabled:true,keepMoving:false,priority:100,...(interruptsHunt===undefined?{}:{interruptsHunt})}}},'dashboard:rare-hunting');r.sight('bee');
   assert.equal(r.controller.encounter(),expected,purpose+' '+tier+' '+interruptsHunt);
  }]),
]);

// The encounter is the tasks owner's `rare` task. Its begin ends the walk under way and commits
// nothing into it, and the tasks owner's resume walks the suspended task back, so the rare keeps no return.
scenarioTable('a rare encounter ends an uncommitted Hunt walk and opens no return of its own (MOV-148)', fixture, [
 ['rare acquisition ends an uncommitted Hunt walk and writes nothing into it', r=>{
 groupRare(r,'tinyp');
 const c=r.party.activeConvoy={id:'hunt-route',purpose:'monster-hunt',requester:{kind:'group-walk',owner:'monster-hunt',tier:'hunt-mission'},huntTarget:'osnake',phase:'travel'};
 r.sight('tinyp');
 assert.equal(r.controller.encounter(),true);assert.equal(r.party.activeConvoy,null);
 assert.equal(c.huntTravel,undefined);assert.equal('rareHuntReturn' in r.party,false);
 }],
]);

scenarioTable('a rare encounter is acquired by priority, pursued while it progresses and returns the party after it (MOV-148)', fixture, [
 ['higher custom priority, Daisy rewards and event combat prevent rare interruption', r=>{
 r.party.statuses.W.target={mtype:'goo'};r.party.monsterPrioritiesByCharacter.W={goo:500};
  r.sight();assert.equal(r.controller.encounter(),false);
  // The Daisy hand-in is the Hunt record's stage. The event combat is the events owner's attendance record, which
  // the report's events stage observes.
  r.party.statuses.W.target=null;Object.assign(r.party,{targetMode:'hunt',monsterHunt:{cycleId:'h',stage:'at-daisy'}});r.tasks.taskTick();
  r.sight();assert.equal(r.controller.encounter(),false);
  Object.assign(r.party,{targetMode:'farming',monsterHunt:null,eventAttendance:{W:{franky:{attending:true,realm:'USII',lastObservedAt:r.time()}}}});
  r.tasks.observe('W');r.tasks.taskTick();
  r.sight();assert.equal(r.controller.encounter(),false);
 }],
 ['follower Fairy sighting preempts Phoenix', r=>{
 r.sight();assert.equal(r.party.rareHuntState.encounter.mtype,'phoenix');
  r.sight('tinyp','M');assert.equal(r.party.rareHuntState.encounter.mtype,'tinyp');
  assert.equal(r.controller.control('P').target.id,'tinyp');
 }],
 ['manual navigation revision cancels a pursuit without a stale return convoy', r=>{
 r.sight();r.revisions.W++;r.controller.tick();
  assert.equal(r.controller.encounter(),false);assert.equal(r.starts(),0);
 }],
 ['generator carrier is unique and confirmation releases attacks without repeat deployment', r=>{
 r.party.statuses.M.items=[{slot:0,item:{name:'fieldgen0'}}];r.party.statuses.P.items=[{slot:0,item:{name:'fieldgen0'}}];
  r.sight('tinyp');const c=r.controller.control('W');assert.equal(c.deployer,'M');
  r.party.statuses.M.rareDeployment={encounterId:c.id};r.controller.tick();assert.equal(r.controller.control('W').deployer,'M');
  r.party.statuses.W.rareFields=[{x:20,y:10}];r.controller.tick();assert.equal(r.controller.control('W').deployer,null);
  r.party.statuses.W.rareFields=[];r.controller.tick();assert.equal(r.controller.control('W').deployer,null);
 }],
 ['witnessed Phoenix death never enters loot; claim on approach cancels and cools down', r=>{
 r.sight();r.party.statuses.W.rareKills=[{id:'phoenix',mtype:'phoenix',map:'main',in:'main',at:r.time()}];
 r.controller.report('W',r.party.statuses.W);r.controller.tick();assert.equal(r.controller.encounter(),false);
 const q=fixture();q.sight();q.advance(1);q.sight('phoenix','W',{target:'Outsider'});
 assert.equal(q.controller.encounter(),false);const starts=q.starts();
 // rares.ts `cooldowns`: the cooldown holds while newer sightings still show the outside
 // target the end read, and a sighting whose target cleared lifts it.
 for(let i=0;i<5;i++){q.advance(100);q.sight('phoenix','W',{target:'Outsider'});}
 assert.equal(q.controller.encounter(),false);assert.equal(q.starts(),starts);
 q.advance(100);q.sight();assert.equal(q.controller.encounter(),true);
 }],
]);

scenarioTable('the Phoenix patrol detects, pauses on unreachable regions and resumes the same region after an interruption (MOV-151)', fixture, [
 ['active patrol detects Phoenix with passive checkbox off and resets after confirmed kill', r=>{
 r.party.monsterFocus=['phoenix'];r.party.passiveRareHunts.phoenix=false;
  r.patrol(regions(catalog).map(a=>a.id));r.controller.tick();r.sight();
  // The patrol order the player starts with is a setting, so the start writes its line.
  assert.deepEqual(r.party.settingsChanges.map(l=>[l.field,l.by,l.new]),[['phoenixRouteOrder','dashboard:navigate-to-monster',regions(catalog).map(a=>a.id)]]);
  assert.equal(r.controller.encounter(),true);
  r.party.statuses.W.rareKills=[{id:'phoenix',mtype:'phoenix',map:'main',in:'main',at:r.time(),partyEngaged:true}];
  r.controller.report('W',r.party.statuses.W);r.controller.tick();
  r.advance(2000);r.party.statuses.W.rareLoot={id:r.controller.control('W').id,at:r.time(),observedAt:r.time(),realm:':USII',map:'main',in:'main',complete:true};
  r.controller.tick();
  assert.equal(r.party.rareHuntState.patrol.index,0);assert.equal(r.party.rareHuntState.patrol.stage,'respawn');
 }],
]);

// A tick that changes nothing writes no
// rareHuntState, and a passive settings change ticks only while the tasks owner's table lets the rare act.
scenarioTable('the rare state is written on change only, and a settings change ticks only while the rare runs', fixture, [
 ['a tick that changes nothing writes no state', r => {
  r.sight('phoenix');r.controller.tick();
  let writes=0,value=r.party.rareHuntState;
  Object.defineProperty(r.party,'rareHuntState',{configurable:true,get(){return value;},set(v){writes++;value=v;}});
  r.controller.tick();r.controller.tick();
  assert.equal(writes,0,'the settled encounter has nothing new to write');
 }],
 ['a settings change during a Cave visit does not tick the rare', r => {
  r.sight('phoenix');const before=JSON.stringify(r.party.rareHuntState);r.party.rareRefused=true;
  assert.equal(r.controller.setSettings({rules:{phoenix:{enabled:false,keepMoving:false,priority:100}}},'dashboard:rare-hunting').ok,true);
  assert.equal(JSON.stringify(r.party.rareHuntState),before,'the refused rare keeps its encounter until its next tick');
 }],
]);
