const test = require('node:test'), assert = require('node:assert/strict');
const {createPartyEscape} = require('../../runtime/coordinator/survival/escape.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {runtime,escapingWarrior}=require('./fixtures/party-escape-scenario.cjs');
const {drivePositions}=require('./helpers/targeting-module.cjs');

// The party escape on the coordinator (runtime/coordinator/survival/escape.ts, its stage
// table) with its ports as install.ts gives them; `told` keeps each notice.
function partyEscape(party, ports) {
  const told = [];
  const control = createPartyEscape(party, { now: () => 1000, persist() {}, endWalk() {},
    arrival: 20, group: () => 'party:warrior', online: () => true, notify: (hook, payload) => told.push([hook, payload]), ...ports });
  return { control, told };
}
// (b): a member whose report is late stays in the escape's stages while the lifecycle owner answers
// it online, and leaves them as disconnected once the lifecycle owner answers it offline.
test('a late member stays in the escape until the lifecycle owner answers it offline', () => {
  let clock = 1000;
  const offline = new Set();
  const party = { escape: null, activeConvoy: null, leader: 'warrior', targetMode: 'farm', commands: {},
    statuses: Object.fromEntries(['warrior', 'mage', 'priest'].map(role => [role, { name: role, ctype: role, hp: 100, rip: false,
      map: 'cave', in: 'cave', server: 'USII', x: 0, y: 0, seenAt: clock }])) };
  const home = { goal: 'death', map: 'main', x: -10, y: 5, radius: 65, spawn: 0 };
  const { control } = partyEscape(party, { now: () => clock, home: () => home, atHome: () => false, convoy: () => true, online: name => !offline.has(name) });
  const e = control.start(['warrior', 'mage', 'priest'], 'player');
  clock += 60000;
  for (const name of ['warrior', 'mage']) party.statuses[name].seenAt = clock;
  control.step();
  assert.deepEqual([e.walk, e.dropped], [[], {}], 'a late priest 13 holds online keeps its stage');
  offline.add('priest');
  control.step();
  assert.deepEqual([e.walk, e.dropped], [['priest'], { priest: 'disconnected' }]);
});
// The escape walks to the safe table's death goal. Once every member stands home, the recovery
// convoy gathers the party at the goal's point, and the escape reads `home` only after that
// convoy. A failed convoy sends the members back to their own walks home. Without game data the
// coordinator knows no goal, so the escape holds where it stands. A member that dies leaves
// the remaining stages and the escape goes on; once the mage leading it dies, every member walks.
// escape rows: each start, stage change and end sends one notice at its change.
test('an escape walks the party to the death goal, and holds where it stands with no game data', () => {
  let clock = 1000;
  const roles = () => Object.fromEntries(['warrior', 'mage', 'priest'].map(role => [role, { name: role, ctype: role, hp: 100, rip: false,
    map: 'cave', in: 'cave', server: 'USII', x: 0, y: 0, seenAt: clock }]));
  const home = { goal: 'death', map: 'main', x: -10, y: 5, radius: 65, spawn: 0 }, convoys = [];
  const party = { escape: null, statuses: roles(), activeConvoy: null, leader: 'warrior', targetMode: 'farm', commands: { priest: { id: 1 } } };
  const atHome = (s, goal) => s.map === goal.map && Math.hypot(s.x - goal.x, s.y - goal.y) <= goal.radius;
  const { control, told } = partyEscape(party, { now: () => clock, endWalk() { party.activeConvoy = null; }, home: () => home, atHome,
    convoy(names, goal) { convoys.push({ names, goal }); party.activeConvoy = { id: 'recovery-' + convoys.length, participants: names, phase: 'assemble' }; return true; } });
  const e = control.start(['warrior', 'mage', 'priest'], 'player');
  // The pending command drop is the status owner's table on `survival.escapeStarted`
  // (coordinator-heartbeat.test.cjs).
  assert.equal(told.some(([hook, payload]) => hook === 'survival.escapeStarted' && payload.participants.includes('priest')), true);
  party.statuses.warrior.rip = true; control.step(); assert.equal(e.stage, 'blink'); assert.deepEqual(e.walk, ['warrior']);
  party.statuses.mage.rip = true; control.step(); assert.equal(e.stage, 'recovering');
  party.statuses.warrior.rip = false; party.statuses.mage.rip = false;
  for (const s of Object.values(party.statuses)) Object.assign(s, { map: 'main', in: 'main', x: -10, y: 5, seenAt: clock });
  control.step();
  assert.equal(e.stage, 'recovery-convoy'); assert.deepEqual(convoys, [{ names: ['warrior', 'mage', 'priest'], goal: home }]);
  assert.deepEqual(control.escaping('priest'), { id: e.id, stage: 'recovery-convoy', admits: 'escape-recovery', label: 'Regrouping after escape - walking the party home', climbs: false }, 'the recovery convoy admits its own command');
  party.activeConvoy.phase = 'failed'; party.statuses.mage.x = 400; control.step(); assert.equal(e.stage, 'recovering');
  party.statuses.mage.x = -10; control.step(); assert.equal(e.stage, 'recovery-convoy'); assert.equal(convoys.length, 2);
  control.step(); assert.equal(e.stage, 'home'); assert.equal(e.convoyId, 'recovery-2');
  assert.deepEqual(control.escaping('priest'), { id: e.id, stage: 'home', admits: null, label: 'Home after escape', climbs: false });
  control.release();
  assert.equal(control.escaping('priest'), undefined, 'a released escape owns nobody');
  assert.deepEqual(told.filter(([hook]) => hook === 'survival.escapeStarted').map(([, n]) => [n.group, n.id, n.leader, n.participants.join(), n.walk.join(), n.resetsFight, n.by]),
    [['party:warrior', e.id, 'mage', 'warrior,mage,priest', '', false, 'player']]);
  assert.deepEqual(told.filter(([hook]) => hook === 'survival.escapeStage').map(([, n]) => n.from + '>' + n.to),
    ['blink>recovering', 'recovering>recovery-convoy', 'recovery-convoy>recovering', 'recovering>recovery-convoy', 'recovery-convoy>home', 'home>released'], 'one notice per change');
  assert.deepEqual(told.filter(([hook]) => hook === 'survival.escapeEnded').map(([, n]) => [n.stage, n.by]), [['home', 'core:survival'], ['released', 'player']]);

  const blind = { escape: null, statuses: roles(), activeConvoy: null, leader: 'warrior', targetMode: 'farm' }, walks = [];
  const held = partyEscape(blind, { now: () => clock, home: () => null, atHome,
    convoy(names, goal) { walks.push(goal); return true; } }).control.start(['warrior', 'mage', 'priest']);
  assert.equal(held.stage, 'failed-hold'); assert.equal(held.home, undefined); assert.match(held.error, /No game data/);
  assert.deepEqual(walks, []);
});

// The character's escape (runtime/characters/survival/escape.ts). Failure modes: an escape leaves
// the character's other travel or target running, or stops it under another identity; a landing sits
// on a portal, on blocked terrain or on a spot the server refused; a waiting fighter does not step
// away from the nearest monster; the warrior's shield, Stomp, Charge and Dash go out of order; the
// mage spends no MP buffer or spends at full MP; a sent Magiport ends its stage on the MP it spent;
// a survivor's potions and defence stop while its walk home runs; the Blink counts landed away from
// the server's spot, or a walked member counts beside the mage outside its bound; the escape drinks
// or Curses inside a Town cast or channel; the escape lets through a command it does not admit.
// A step that ends on a changed stage waits for the next event.
scenarioTable('an escaping fighter cancels other travel, lands clear, steps away from monsters and runs its warrior mobility in order', runtime, [
 ['a new escape tells the member joined and stops smart and move under its own identity; a stage change resets only into walking alone', async ()=>{
  const stops=[],{escape,told,r}=runtime({},{fresh:true});
  r.movement.stop=async(kind,_done,requester)=>{stops.push([kind,requester&&requester.owner]);};
  const {escapeMemberResets}=require('../../runtime/characters/survival/api.ts');
  await escape.apply({id:'e2',stage:'blink'});
  await escape.apply({id:'e2',stage:'port:priest'});
  await escape.apply({id:'e2',stage:'recovering'});
  await escape.apply(null);
  const notices=told.filter(([hook])=>hook==='survival.escapeMember').map(([,n])=>n);
  assert.deepEqual(notices.map(n=>[n.change,n.stage]),[['joined','blink'],['stage','port:priest'],['stage','recovering'],['left','recovering']]);
  assert.deepEqual(notices.map(escapeMemberResets),[true,false,true,false],'movement and targeting reset at the join and at walking alone, as applyEscape did');
  assert.deepEqual(stops,[['smart','escape:e2'],['move','escape:e2'],['smart','escape:e2'],['move','escape:e2']]);
 }],
 ['movement ends the convoy, the farm walk, the reunion and the follow, and targeting drops its target, at the notice', ()=>{
  const {endTravelForEscape}=require('../../runtime/movement/character/install.ts');
  const convoy={id:'C'},token={cancelled:false},offer={offer:{}},state={following:true,forceTraveling:true,townGeneration:3};
  const ended=[];let dropped=0;
  endTravelForEscape({travel:()=>convoy,endConvoyWalk:walk=>{ended.push(walk);},farmTravel:()=>token,dropReunion:()=>{dropped++;},crossing:offer,state});
  assert.deepEqual([ended,token.cancelled,dropped,offer.offer,state.following,state.forceTraveling,state.townGeneration],
   [[convoy],true,1,null,false,false,4]);
  const {publishTargetingReads}=require('../../runtime/characters/targeting/install.ts');
  let published,set=[];
  globalThis.character={name:'warrior'};
  publishTargetingReads({'targeting.setTargetId':(id,by)=>set.push([id,by])},{publish:r=>{published=r;return {ok:true};}});
  published.hooks['survival.escapeMember']({character:'warrior',change:'stage',stage:'port:priest'});
  published.hooks['survival.escapeMember']({character:'other',change:'joined',stage:'blink'});
  published.hooks['survival.escapeMember']({character:'warrior',change:'joined',stage:'blink'});
  assert.deepEqual(set,[[null,'core:targeting']]);
 }],
 ['landing chooses clear points off the door\'s edge and respects terrain and rejected Blink points', ({ r, escape })=>{
  r.parent.entities.enemy = { type: 'monster', visible: true, x: 160, y: 0, range: 100 };
  // The 20 by 20 door at (200, 0): half its width plus the arrival tolerance (20) off its edge.
  const point = escape.landing(); assert.deepEqual([point.x, point.y], [230, 0]);
  escape.record().rejected['230,0'] = true; assert.notEqual(escape.landing().x, 230);
  r.can_move = () => false; assert.equal(escape.landing(), undefined);
 }],
 ['a fighter waiting for rescue steps one retreat step straight away from the nearest monster', async ()=>{
  const {r,escape}=runtime({is_in_range:()=>false});
  Object.assign(r.character,{name:'priest',ctype:'priest',moving:false,mp:2000});
  await escape.apply({id:'op',stage:'warrior',participants:['mage','warrior','priest']});r.parent.entities.enemy={type:'monster',visible:true,x:100,y:0};
  await escape.step();
  assert.deepEqual(r.movement.moves.map(m=>[m.x,m.y,m.mode]),[[-40,0,'escape-retreat']]);
  r.can_move_to=()=>false;await escape.step();
  assert.equal(r.movement.moves.length,1);assert.equal(escape.record().error,'Retreat blocked by terrain');
 }],
 ['shield blocks mobility until expiry, then Stomp precedes Charge and repeated Dash', async ()=>{
  const {r,casts,escape,spends}=escapingWarrior(1200);
  r.G.skills.stomp={mp:120};r.G.items={hammer:{wtype:'basher'}};
  r.character.slots={mainhand:{name:'hammer'}};
  r.parent.entities.enemy={type:'monster',visible:true,x:10,y:0};
  r.is_in_range=()=>true;
  spends.observeHit({id:'w-id',damage:10});
  await escape.step();await escape.step();
  assert.deepEqual(casts,['hardshell']);
  delete r.character.s.hardshell;
  r.is_on_cooldown=skill=>skill==='use_mp'||skill==='hardshell';
  await escape.step();await escape.step();
  assert.deepEqual(casts,['hardshell','stomp','charge','dash','dash']);
 }],
]);

scenarioTable('a fighter in an escape lands clear, spends its buffer and keeps its defenses on the way', runtime, [
 ['mage uses MP without normal percentage cutoff and does not spend at full MP', async ({ r, casts, escape })=>{
  r.character.mp = 1800;
  await escape.step(); assert.deepEqual(casts, ['use_mp', 'blink']);
  casts.length = 0; r.character.mp = 2000; escape.record().destination = null;
  await escape.step(); assert.deepEqual(casts, ['blink']);
 }],
 // The port stage: the server charges Magiport's MP when it sends the offer, so the mage's MP reads
 // under one Magiport while its sent port waits for the member to accept; that stage ends on its crossing,
 // not as a port the MP cannot cover (case D (2)).
 ['a sent Magiport waits for its member, and the MP it spent does not end the stage', async ({ r, casts, escape })=>{
  Object.assign(r.character, { mp: 1000, max_mp: 1000 });
  await escape.apply({ id: 'op', stage: 'port:priest', leader: 'mage', participants: ['mage', 'priest'] });
  drivePositions(r, [{ name: 'priest', escape: { id: 'op', readyForPort: 'port:priest' } }]);
  r.timed = request => request;
  r.movement = { ...r.movement, magiport: (request, name) => { casts.push('magiport:' + name); r.character.mp -= r.escapeCost('magiport'); return Promise.resolve({ accepted: true }); } };
  await escape.step();
  assert.ok(casts.includes('magiport:priest'));
  await escape.step();
  assert.equal(escape.record().portFailed, undefined);
  assert.equal(escape.record().portEnded, undefined);
  assert.equal(casts.filter(c => c === 'magiport:priest').length, 1);
 }],
 ['survivor keeps potions and defenses running while independent escape travel is pending', async ()=>{
  let finish; const {r,casts,escape,spends,flush}=runtime({smart_move:()=>new Promise(resolve=>finish=resolve),joinedEvent:null,eventTraveling:false,travellingEventName:null});
  r.character.name='warrior';r.character.ctype='warrior';r.character.mp=800;r.character.hp=50;
  await escape.apply({id:'op',stage:'recovering',participants:['mage','warrior'],home:{goal:'death',map:'main',x:0,y:0,radius:65,spawn:0}});
  spends.observeHit({id:'warrior',hid:'enemy',damage:10});
  const travel=escape.step();await flush();
  assert.ok(casts.includes('use_hp'));assert.ok(casts.includes('hardshell'));
  finish();await travel;
 }],
 // B108: the escape's walk home ends only with its journey. v1.5.0
 // raced the walk against a 20 s timer (`anniversaryWithTimeout`, 11802-11822), which rejected and
 // left the smart_move walking with no owner. The ladder has no timer: the step waits for the
 // walk, however long its sleeps are.
 ['B108: the escape step lasts as long as its walk home and ends with it', async ()=>{
  let finish; const {r,escape,flush}=runtime({smart_move:()=>new Promise(resolve=>finish=resolve),joinedEvent:null,eventTraveling:false,travellingEventName:null});
  r.character.name='warrior';r.character.ctype='warrior';
  await escape.apply({id:'op',stage:'recovering',participants:['mage','warrior'],home:{goal:'death',map:'main',x:0,y:0,radius:65,spawn:0}});
  let ended=false;const travel=escape.step().then(()=>{ended=true;});
  await flush();
  assert.equal(ended,false,'the step waits on the walk home');
  finish();await travel;
  assert.equal(ended,true);
 }],
 // The Blink counts landed where the server put it (`s.blink` from the `player` emit), not
 // within 40 of the asked point; a member counts beside the mage on its own `s.magiport` spot,
 // or, walked, within the arrival tolerance plus the largest Magiport offset.
 ['the Blink lands on the server\'s spot and a walked member\'s bound is the tolerance plus the Magiport offset', async ()=>{
  const listeners={},socket={on:(e,l)=>{listeners[e]=l;},off(){}},plant=()=>({on:(e,l)=>{plant.listeners[e]=l;},off(){}});plant.listeners={};
  const {r,casts,escape}=runtime({socket});
  escape.listen();
  r.character.mp=2000;r.G.maps.cave.doors=[];r.G.maps.cave.npcs=[{id:'transporter',position:[0,500]}];
  await escape.step();
  assert.deepEqual(casts,['blink'],'the mage Blinks toward the transporter landing');
  // The server put it 30 from the asked point (0, 540): within 40 of it, but not on its spot.
  listeners.player({map:'cave',s:{blink:{x:60,y:600}}});
  Object.assign(r.character,{x:0,y:570});r.is_on_cooldown=()=>true;
  await escape.step();
  assert.equal(escape.record().landed,false,'30 from the asked point, 67 from the server\'s spot');
  Object.assign(r.character,{x:60,y:590});
  await escape.step();
  assert.equal(escape.record().landed,true,'within the arrival tolerance of the server\'s spot');
  // A member waiting beside the mage's landing, by its own Magiport spot or by the walked bound.
  const w=runtime({socket:plant()});w.escape.listen();Object.assign(w.r.character,{name:'warrior',ctype:'warrior',mp:2000,max_mp:2000});
  await w.escape.apply({id:'op',stage:'port:warrior',leader:'mage',participants:['mage','warrior'],destination:{map:'cave',in:'cave',x:0,y:0}});
  const waits=async(x,y)=>{Object.assign(w.r.character,{x,y});w.escape.record().readyForPort=undefined;await w.escape.step();return w.escape.record().readyForPort;};
  assert.equal(await waits(0,57),undefined,'57 from the landing: within 20 plus hypot(20, 32)');
  assert.equal(await waits(0,59),'port:warrior','59 from the landing: outside the walked bound, so it still waits for its port');
  plant.listeners.player({map:'cave',s:{magiport:{x:300,y:300}}});
  assert.equal(await waits(305,300),undefined,'on the spot the Magiport of the server put it, far from the landing');
 }],
 // A potion's `equip` and a Curse end a Town channel (server.js:7657:3519), so the escape
 // drinks and Curses neither while a Town cast is in flight nor while it channels. Red on an
 // earlier build, where `escapePotions` and the escape Curse read no Town gate.
 ['no escape potion or Curse goes while a Town cast is in flight or channelling', async ()=>{
  const {r,casts,escape}=runtime();
  Object.assign(r.character,{name:'priest',ctype:'priest',mp:1000,hp:20,moving:true});
  await escape.apply({id:'op',stage:'warrior',participants:['mage','warrior','priest']});
  r.parent.entities.m={type:'monster',visible:true,x:10,y:0,target:'warrior'};r.is_in_range=()=>true;
  r.townCasting=true;await escape.step();
  assert.deepEqual(casts,[],'a Town cast in flight holds the potion and the Curse');
  r.townCasting=false;r.character.c={town:{ms:3000}};await escape.step();
  assert.deepEqual(casts,[],'the Town channel holds them');
  delete r.character.c;await escape.step();
  assert.deepEqual(casts,['use_hp','curse'],'with no Town cast the escape drinks and Curses');
 }],
 // The escape lets through only the command purpose it admits, the
 // `escape-recovery` convoy in `recovery-convoy`; a merchant is never owned.
 ['the escape answers its stage and admits only the recovery convoy\'s command in recovery-convoy (CF-B1)', async ({ r, escape })=>{
  assert.deepEqual({...escape.answer('mage')},{id:'op',stage:'blink',admits:null,label:'Escaping - mage blinking the party out',climbs:false});
  await escape.apply({id:'op',stage:'recovery-convoy'});
  assert.deepEqual({...escape.answer('mage')},{id:'op',stage:'recovery-convoy',admits:'escape-recovery',label:'Regrouping after escape - walking the party home',climbs:false});
  assert.equal(escape.answer('other'),undefined,'another character\'s name');
  r.character.ctype='merchant';
  assert.equal(escape.answer('mage'),undefined,'a merchant is never owned');
 }],
 // An event that comes while a half runs is skipped, and a half that ends on another
 // stage than it began with runs once more at once.
 ['a step that ends on a changed stage runs once more at once, and an event inside a step is skipped (W3.1 row 1)', async ()=>{
  let release;const {r,escape,casts}=runtime();
  r.character.mp=2000;r.G.skills.blink.cooldown=1000;
  r.blinkAs=()=>new Promise(resolve=>release=resolve);
  const first=escape.step();await new Promise(resolve=>setImmediate(resolve));
  void escape.step();
  await escape.apply({id:'op',stage:'port:priest',leader:'mage',participants:['mage','priest']});
  drivePositions(r,[{name:'priest',escape:{id:'op',readyForPort:'port:priest'}}]);
  r.movement={...r.movement,magiport:(request,name)=>{casts.push('magiport:'+name);return Promise.resolve();}};
  release();await first;await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  assert.ok(casts.includes('magiport:priest'),'the changed stage ran at once: '+casts);
 }],
]);
