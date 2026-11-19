const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../characters/shared.js'), 'utf8');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture}=require('./fixtures/farming-navigation-client-scenario.cjs');

scenarioTable('a navigation cancellation stops the owned farm walk, a queued farm walk and following the leader (MOV-047, MOV-050, MOV-064)', fixture, [
 ['new cancellation stops owned farming movement and clears the cached anniversary origin', async t=>{
  const token = t.r.farmingTravelToken = { revision: 0, cancelled: false };
  // The cached origin is the anniversary's (runtime/events/character/anniversary.ts `clearReturn`).
  let cleared = 0;
  t.r.eventAnniversary = { clearReturn: () => { cleared++; } };
  await t.r.applyNavigationIntent({ revision: 1, cancelled: true });
  assert.equal(token.cancelled, true);
  assert.deepEqual(t.stops, ['smart', 'move']);
  assert.equal(cleared, 1, 'the cancellation drops the anniversary origin');
 }],
 ['a new revision ends the group walk and the follow, as applyNavigationIntent did (appendix A2 NAV)', async t=>{
  const released=[],convoy=t.r.groupWalk.travel={id:'c',release:()=>released.push('release')};
  t.r.cruise=speed=>{released.push('cruise:'+speed);};t.r.setConvoyCruise(convoy,60);released.length=0;t.r.followingLeader=true;
  await t.r.applyNavigationIntent({ revision: 2, cancelled: false });
  assert.deepEqual(released,['cruise:500','release']);assert.equal(convoy.cancelled,true);
  assert.equal(t.r.followingLeader,false);assert.deepEqual(t.stops,['smart','move']);
  assert.equal(t.r.root.__partyNavigationIntent.revision,2);
  await t.r.applyNavigationIntent({ revision: 2, cancelled: false });
  assert.deepEqual(t.stops,['smart','move'],'the same intent stops nothing');
 }],
 ['cancellation while finishing combat cannot start a delayed farming route', async t=>{
  // The job's combat wait is the movement owner's: combat lets go after the cancellation.
  const owner = require('./fixtures/movement-service-scenario.cjs').fixture();
  let routes = 0;
  t.r.game_log = () => {};
  t.r.movement = owner.service;
  t.r.engagedMonster = () => ({ id: 'bat' });
  t.r.farmingTravelToken = { revision: 0, cancelled: false };
  // afterCombat is the job owner's runner's, over shared.js's reads.
  const { createMerchantRunner } = require('../../runtime/merchant-jobs/character/runner.ts');
  const runner = createMerchantRunner({ root: () => ({}), character: () => t.r.character, log: t.r.game_log, movement: () => t.r.movement,
    farmingTravel: () => t.r.farmingTravelToken, departing() {}, travelCombat: () => null, fighting: () => !!t.r.engagedMonster() });
  const job = runner.afterCombat(async () => { routes++; }, 'farming');
  t.r.farmingTravelToken.cancelled = true;
  t.r.engagedMonster = () => null;
  owner.service.letGo();
  await job;
  assert.equal(routes, 0);
  owner.dispose();
 }],
 ['a cancelled follower does not immediately resume ordinary leader-following', t=>{
  // The follow rule is the character's holds module (runtime/tasks/character/holds.ts).
  Object.assign(t.r, { followLeader: true, leader: 'L', followMe: null, eventAttend: { active: () => null }, groupedFarming: () => false });
  require('./helpers/requesters.cjs').installHolds(t.r);
  t.r.navigationIntent.cancelled = true;
  assert.equal(t.r.shouldFollowLeader(), false);
  t.r.navigationIntent.cancelled = false;
  assert.equal(t.r.shouldFollowLeader(), true);
 }],
]);
