const test = require('node:test'), assert = require('node:assert/strict');
const create = require('../party-escape.cjs');
function fixture(saved) {
  let clock = 1000, cancelled = 0;
  const party = { escape: saved, statuses: {}, activeConvoy: null };
  ['warrior', 'mage', 'priest'].forEach(role => party.statuses[role] = { name: role, ctype: role, hp: 100, rip: false,
    map: 'cave', in: 'cave', server: 'USII', x: 0, y: 0, seenAt: clock });
  const control = create(party, { now: () => clock, persist() {}, cancel() { cancelled++; party.activeConvoy = null; },
    convoy(names) { party.activeConvoy = { id: 'recovery', participants: names }; return true; } });
  return { party, control, advance(ms) { clock += ms; Object.values(party.statuses).forEach(s => s.seenAt = clock); },
    start() { return control.start(['warrior', 'mage', 'priest']); }, cancelled: () => cancelled };
}
test('rescue requires confirmed mage landing then warrior and priest arrivals', () => {
  const f = fixture(), e = f.start(), destination = { map: 'cave', in: 'cave', server: 'USII', x: 500, y: 100 };
  f.party.statuses.mage.escape = { id: e.id, landed: true, destination };
  f.control.step(); assert.equal(e.stage, 'blink');
  Object.assign(f.party.statuses.mage, destination); f.control.step(); assert.equal(e.stage, 'warrior');
  Object.assign(f.party.statuses.priest, destination); f.control.step(); assert.equal(e.stage, 'warrior');
  Object.assign(f.party.statuses.warrior, destination); f.control.step(); assert.equal(e.stage, 'complete');
  assert.equal(f.control.owns('mage'), true); f.control.release(); assert.equal(f.control.owns('mage'), false);
});
test('duplicate clicks reuse the active escape and stale landing reports cannot advance it', () => {
  const f = fixture(), e = f.start(); assert.equal(f.start(), e);
  f.party.statuses.mage.escape = { id: 'old', landed: true, destination: f.party.statuses.mage };
  f.control.step(); assert.equal(e.stage, 'blink');
});
test('every fighter death fails immediately, respawned party convoys to main and holds', () => {
  for (const name of ['warrior', 'mage', 'priest']) {
    const f = fixture(), e = f.start(); f.party.statuses[name].rip = true;
    f.control.step(); assert.equal(e.stage, 'recovering'); assert.match(e.error, new RegExp(name + ' died'));
    Object.values(f.party.statuses).forEach(s => Object.assign(s, { rip: false, map: 'main', in: 'main', x: 300, y: 0 }));
    f.control.step(); assert.equal(e.stage, 'recovering');
    Object.values(f.party.statuses).forEach(s => s.x = 0);
    f.control.step(); assert.equal(e.stage, 'recovery-convoy');
    f.control.step(); assert.equal(e.stage, 'failed-hold'); assert.ok(f.control.owns(name));
  }
});
test('deadline records the last skill error; disconnected and missing roles fail', () => {
  const f = fixture(), e = f.start(); f.party.statuses.mage.escape = { id: e.id, error: 'Insufficient mana' };
  f.advance(30000); f.control.step(); assert.match(e.error, /Insufficient mana/);
  const missing = fixture(); delete missing.party.statuses.priest; assert.match(missing.start().error, /Missing/);
  const offline = fixture(), o = offline.start(); offline.party.statuses.priest.seenAt = -10000;
  offline.control.step(); assert.match(o.error, /disconnected/);
});
test('restart moves an uncertain escape to recovery and never recasts teleport stages', () => {
  const f = fixture(), saved = f.start(); saved.stage = 'priest';
  const restarted = fixture(saved); assert.equal(restarted.party.escape.stage, 'recovering');
  assert.match(saved.error, /restarted/);
});

const fs = require('node:fs'), vm = require('node:vm'), shared = fs.readFileSync('characters/shared.js', 'utf8');
function runtime(overrides = {}) {
  const casts = [], r = vm.createContext({ character: { name: 'mage', ctype: 'mage', map: 'cave', in: 'cave', x: 0, y: 0, mp: 100, max_mp: 2000, hp: 100, max_hp: 100 },
    G: { skills: { charge: { mp: 0 }, blink: { mp: 1600 }, magiport: { mp: 900 }, hardshell: { mp: 480 }, dash: { mp: 120 }, curse: { mp: 400 }, partyheal: { mp: 400 }, heal: { mp: 20 } }, maps: { cave: { doors: [[200, 0, 20, 20, 'main']] } } },
    root: {}, parent: { entities: {} }, runtimeCurrent: () => true, can_move: () => true, can_move_to: () => true,
    is_on_cooldown: () => false, can_use: () => true, use_skill: async (skill) => casts.push(skill), partyPositions: [],
    reunionRealm: () => 'USII', anniversaryWithTimeout: p => p,
    convoyTraveling: null, farmingTravelToken: null, reunion: null, stop: async () => {}, move: () => {}, ...overrides });
  vm.runInContext(shared.slice(shared.indexOf('  var escapeState ='), shared.indexOf('  if (root.__partyEscapeTimer)')), r);
  r.escapeState = { id: 'op', stage: 'blink', participants: ['mage', 'warrior', 'priest'], roles: { mage: 'mage', warrior: 'warrior', priest: 'priest' } };
  r.escapeLocal = { id: 'op', rejected: {} };
  return { r, casts };
}
test('landing chooses clear exit offsets and respects terrain and rejected Blink points', () => {
  const { r } = runtime(); r.parent.entities.enemy = { type: 'monster', visible: true, x: 160, y: 0, range: 100 };
  const point = r.escapeLanding(); assert.equal(point.x, 240);
  r.escapeLocal.rejected['240,0'] = true; assert.notEqual(r.escapeLanding().x, 240);
  r.can_move = () => false; assert.equal(r.escapeLanding(), undefined);
});
test('mage uses MP without normal percentage cutoff and does not spend at full MP', async () => {
  const { r, casts } = runtime(); r.character.mp = 1800;
  await r.escapePulse(); assert.deepEqual(casts, ['use_mp', 'blink']);
  casts.length = 0; r.character.mp = 2000; r.escapeLocal.destination = null;
  await r.escapePulse(); assert.deepEqual(casts, ['blink']);
});
test('warrior buffer includes Hardshell and two Dashes and stops emergency behavior on arrival', async () => {
  const { r, casts } = runtime(); Object.assign(r.character, { name: 'warrior', ctype: 'warrior', mp: 719, hp: 50 });
  r.G.skills.hardshell.mp = 480; r.character.s = { hardshell: {} };
  await r.escapePulse(); assert.deepEqual(casts, ['use_mp']);
  casts.length = 0; r.character.mp = 2000; await r.escapePulse(); assert.deepEqual(casts, ['use_hp']);
  casts.length = 0; r.escapeState.destination = { map: 'cave', in: 'cave', x: 0, y: 0 }; await r.escapePulse(); assert.equal(casts.length, 0);
});
test('priest buffer includes Curse, Party Heal and Heal; shared cooldown blocks potions', async () => {
  const { r, casts } = runtime({ healPartyBelow: async () => false });
  Object.assign(r.character, { name: 'priest', ctype: 'priest', mp: 819, hp: 50 });
  await r.escapePulse(); assert.deepEqual(casts, ['use_mp']);
  casts.length = 0; r.character.mp = 820; await r.escapePulse(); assert.deepEqual(casts, ['use_hp']);
  casts.length = 0; r.is_on_cooldown = () => true; await r.escapePulse(); assert.equal(casts.length, 0);
});

test('survivor keeps potions and defenses running while independent escape travel is pending', async()=>{
 let finish; const {r,casts}=runtime({eventReturnRouteToMain:()=>new Promise(resolve=>finish=resolve)});
 r.character.name='warrior';r.character.ctype='warrior';r.character.mp=800;r.character.hp=50;
 r.escapeState.stage='recovering';r.escapeSurvivalBusy=false;
 r.escapeObserveHit({id:'warrior',hid:'enemy',damage:10});
 const travel=r.escapePulse();await Promise.resolve();
 await r.escapeSurvivalPulse();assert.ok(casts.includes('use_hp'));assert.ok(casts.includes('hardshell'));
 finish();await travel;
});

function escapingWarrior(mp = 1000) {
 const {r,casts}=runtime();
 Object.assign(r.character,{name:'warrior',id:'w-id',ctype:'warrior',mp,max_mp:2000,s:{},moving:true,direction:2});
 r.use_skill=async(skill)=>{
   casts.push(skill);
   r.character.mp-=r.escapeCost(skill);
   if(skill==='hardshell')r.character.s.hardshell={};
 };
 r.is_on_cooldown=(skill)=>skill==='use_mp';
 return {r,casts};
}


test('Charge waits for a valid retreat pulse and is used once, not on escape entry',async()=>{
 const {r,casts}=escapingWarrior();r.escapeState=null;r.escapeLocal=null;
 await r.applyEscape({id:'new',stage:'blink'});
 assert.deepEqual(casts,[]);
 await r.escapeWarriorDefense(()=>true,{x:40,y:0});
 await r.escapeWarriorDefense(()=>true,{x:40,y:0});
 assert.deepEqual(casts,['charge','dash','dash']);
});

test('unattacked escape preserves the defensive mana reserve',async()=>{
 const {r,casts}=escapingWarrior(839);
 await r.escapePulse();assert.deepEqual(casts,['charge']);
 r.character.mp=960;
 await r.escapePulse();await r.escapePulse();await r.escapePulse();
 assert.deepEqual(casts,['charge','dash','dash']);assert.equal(r.character.mp,720);
});

test('shield blocks mobility until expiry, then Stomp precedes Charge and repeated Dash',async()=>{
 const {r,casts}=escapingWarrior(1200);
 r.G.skills.stomp={mp:120};r.G.items={hammer:{wtype:'basher'}};
 r.character.slots={mainhand:{name:'hammer'}};
 r.parent.entities.enemy={type:'monster',visible:true,x:10,y:0};
 r.is_in_range=()=>true;
 r.escapeObserveHit({id:'w-id',damage:10});
 await r.escapePulse();await r.escapePulse();
 assert.deepEqual(casts,['hardshell']);
 delete r.character.s.hardshell;
 r.is_on_cooldown=skill=>skill==='use_mp'||skill==='hardshell';
 await r.escapePulse();await r.escapePulse();
 assert.deepEqual(casts,['hardshell','stomp','charge','dash','dash']);
});

test('shield refills MP past defensive reserve and respects potion cooldown and full MP',async()=>{
 const {r,casts}=escapingWarrior(900);r.character.s.hardshell={};
 r.use_skill=async skill=>{casts.push(skill);if(skill==='use_mp')r.character.mp=Math.min(2000,r.character.mp+500);};
 r.is_on_cooldown=()=>false;
 await r.escapePulse();await r.escapePulse();await r.escapePulse();await r.escapePulse();
 assert.deepEqual(casts,['use_mp','use_mp','use_mp']);
 r.character.mp=1000;r.is_on_cooldown=()=>true;
 await r.escapePulse();assert.equal(casts.length,3);
});

test('pending shield and delayed condition cannot leak Dash or Charge',async()=>{
 const {r,casts}=escapingWarrior();r.escapeLocal.attacked=true;
 let finish;r.use_skill=async skill=>{casts.push(skill);await new Promise(resolve=>finish=resolve);};
 const first=r.escapeWarriorDefense(()=>true,{x:40,y:0});
 await r.escapeWarriorDefense(()=>true,{x:40,y:0});
 assert.deepEqual(casts,['hardshell']);finish();await first;
 await r.escapeWarriorDefense(()=>true,{x:40,y:0});
 assert.deepEqual(casts,['hardshell']);
});

test('unavailable or rejected Stomp never prevents post-shield retreat',async()=>{
 for(const mode of ['weapon','cooldown','mana','rejected']){
  const {r,casts}=escapingWarrior(240);r.escapeLocal.shellCycle=true;r.escapeLocal.attacked=true;
  r.G.skills.stomp={mp:mode==='mana'?999:120};r.G.items={hammer:{wtype:'basher'}};
  r.character.slots={mainhand:{name:mode==='weapon'?'sword':'hammer'}};
  r.parent.entities.enemy={type:'monster',visible:true};r.is_in_range=()=>true;
  r.is_on_cooldown=skill=>skill==='use_mp'||skill==='hardshell'||mode==='cooldown'&&skill==='stomp';
  r.use_skill=async skill=>{casts.push(skill);if(skill==='stomp')throw Error('rejected');};
  await r.escapePulse();
  assert.deepEqual(casts,mode==='rejected'?['stomp','charge','dash']:['charge','dash']);
 }
});

test('recovery travel observes the same shield and post-shield ordering',async()=>{
 const {r,casts}=escapingWarrior(840);r.escapeState.stage='recovery-convoy';
 r.escapeObserveHit({id:'warrior',evade:true});
 await r.escapeSurvivalPulse();await r.escapeSurvivalPulse();
 assert.deepEqual(casts,['hardshell']);
 delete r.character.s.hardshell;r.is_on_cooldown=skill=>skill==='use_mp'||skill==='hardshell';
 await r.escapeSurvivalPulse();assert.deepEqual(casts,['hardshell','charge','dash']);
});

test('active Dash and blocked terrain prevent mobility casts',async()=>{
 const {r,casts}=escapingWarrior();r.character.s.dash={};
 await r.escapePulse();assert.deepEqual(casts,[]);
 delete r.character.s.dash;r.can_move_to=()=>false;
 await r.escapePulse();assert.deepEqual(casts,[]);
});

test('rejected Charge retries later without blocking Dash',async()=>{
 const {r,casts}=escapingWarrior();
 r.use_skill=async skill=>{casts.push(skill);if(skill==='charge')throw Error('rejected');};
 await r.escapePulse();await r.escapePulse();
 assert.deepEqual(casts,['charge','dash','charge','dash']);
});

test('cancellation or death during shield cast prevents follow-up skills',async()=>{
 for(const cancel of [true,false]){
  const {r,casts}=escapingWarrior();r.escapeLocal.attacked=true;
  r.use_skill=async skill=>{casts.push(skill);if(cancel)r.escapeLocal=null;else r.character.rip=true;};
  await r.escapeWarriorDefense(()=>true,{x:40,y:0});
  assert.deepEqual(casts,['hardshell']);
 }
});

test('overlapping potion pulses only issue one request',async()=>{
 const {r,casts}=escapingWarrior(900);r.character.s.hardshell={};r.is_on_cooldown=()=>false;
 let finish;r.use_skill=async skill=>{casts.push(skill);await new Promise(resolve=>finish=resolve);};
 const first=r.escapePotions(()=>true);
 await r.escapePotions(()=>true);assert.deepEqual(casts,['use_mp']);
 finish();await first;
});
