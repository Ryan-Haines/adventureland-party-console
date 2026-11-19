// Targeting's holds that end on a signal: a peer's independent readiness, the Hunt travel control and
// the queue's settled attack evidence.
const test = require('node:test'), assert = require('node:assert/strict');
const { targetingContext } = require('./helpers/targeting-module.cjs');
const { reconcileQueue } = require('../../runtime/coordinator/targeting/queue.ts');
const { LIST_BOUNDS } = require('../../runtime/characters/targeting/rules.ts');
const { ageOf } = require('../../runtime/protocol/reports.ts');

// A peer whose report interval is longer than a second stamped its readiness more than a second ago;
// the confirmation it names is still the current one, so its readiness counts until its next report
// or a new confirmation replaces it.
test('a peer readiness counts while it names the current confirmation, however old its stamp', () => {
  const confirmation = { id: 'c1', selection: 's1', target: 'goo1', startedAt: 1000, expiresAt: 4000 };
  const record = { ready: true, selection: 's1', target: 'goo1', confirmation: 'c1', at: 1000 };
  const c = targetingContext({ character: { name: 'W', map: 'main', in: 'main' },
    groupedCombat: { members: ['W', 'P'], independentReadiness: { W: { ...record }, P: { ...record } } } });
  assert.equal(c.independentPeersReady(confirmation, 2500), true, 'a stamp 1.5 s old still counts');
  c.groupedCombat.independentReadiness.P = { ...record, ready: false, at: 2400 };
  assert.equal(c.independentPeersReady(confirmation, 2500), false, "the peer's next report withdraws it");
  c.groupedCombat.independentReadiness.P = { ...record };
  assert.equal(c.independentPeersReady({ ...confirmation, id: 'c2' }, 2500), false, 'a new confirmation replaces it');
});

// The Hunt walk's control for an outbound walk, with one passing monster in range.
function huntWorld(controlAt) {
  const bee = { id: 'bee1', mtype: 'bee', type: 'monster', visible: true, hp: 100, max_hp: 100, x: 20, y: 0, map: 'main', in: 'main', target: 'W' };
  // The group walk travels on the leader's live signal, which the passing column waits for.
  const travel = { id: 'walk1', epoch: 1, purpose: 'monster-hunt', huntTarget: 'goo', continuousReturn: 0, phase: 'travelling', commandId: 1, navigationRevision: 0 };
  const signal = { id: 'walk1', epoch: 1, commandId: 1, phase: 'travel' };
  const control = { id: 'walk1', epoch: 1, primary: bee, committed: [] };
  const c = targetingContext({ Date, character: { name: 'W', ctype: 'warrior', map: 'main', in: 'main', x: 0, y: 0, hp: 100, max_hp: 100 },
    parent: { entities: { bee } }, root: { __partyHuntTravel: control, __partyHuntTravelAt: controlAt }, coordinatorClockOffset: 0,
    G: { classes: { warrior: {} }, items: {}, skills: {}, monsters: { bee: {} }, maps: {} },
    get_entity: id => (id === bee.id ? bee : null), is_in_range: e => Math.hypot(e.x, e.y) <= 100, fightDeaths: [] },
  {}, { walks: { groupWalk: { travel, signal }, convoySignalExpired: () => false }, tasks: { partyList: () => ['W'] },
    hunting: { hunt: { outbound: () => true, extraAggro: () => false, control: () => control } } });
  return { c, bee };
}

// A coordinator that replies every 1.5 s left the control unread between its replies once a second
// passed; the control holds until the next reply or the report freshness rule's age.
test('the Hunt travel control holds between coordinator replies', () => {
  const now = Date.now();
  let w = huntWorld(now - 1500);
  assert.equal(w.c.passingTarget()?.id, 'bee1', 'a control 1.5 s old still admits its primary');
  w = huntWorld(now - ageOf('report') - 1);
  assert.equal(w.c.passingTarget(), null, 'a coordinator silent past the report age holds the passing attack');
});

// The queue's evidence for one member's fight.
function member(evidence, deaths = []) {
  return { name: 'W', status: { seenAt: 0, hp: 100, map: 'main', in: 'main', server: 'USII', x: 0, y: 0,
    groupedCombat: { epoch: 1, candidates: [], evidence, deaths } } };
}
const settled = (id, at) => ({ id, mtype: 'goo', map: 'main', in: 'main', server: 'USII', x: 10, y: 0, action: 'W:' + id, state: 'engaged', at, startedAt: at });

// A fight longer than a minute lost its settled evidence at the minute while the target lived.
test('settled evidence stays while its target lives and leaves on its reported death', () => {
  const at = 1000, later = at + 120000;
  const m = member([settled('goo1', at)]);
  m.status.seenAt = at;
  let g = reconcileQueue(null, [m], 'W', at, 'key');
  m.status.seenAt = later; m.status.groupedCombat.evidence = [];
  g = reconcileQueue(g, [m], 'W', later, 'key');
  assert.deepEqual(g.evidence.map(e => e.id), ['goo1'], 'two minutes on, the live fight keeps its evidence');
  m.status.groupedCombat.deaths = [{ id: 'goo1', map: 'main', in: 'main', server: 'USII', at: later }];
  g = reconcileQueue(g, [m], 'W', later + 1, 'key');
  assert.deepEqual(g.evidence, [], 'the reported death drops it');
});

// A target that dies where no member sees it sends no death, so the list bound holds its evidence.
test('evidence over its list bound reports the overflow', () => {
  const { boundFirings } = require('../../runtime/status/coordinator/api.ts');
  const before = boundFirings().counts['LIST_BOUNDS.events'] || 0;
  const at = 1000, m = member(Array.from({ length: LIST_BOUNDS.events + 1 }, (_, i) => settled('goo' + i, at)));
  m.status.seenAt = at;
  const g = reconcileQueue(null, [m], 'W', at, 'key');
  assert.equal(g.evidence.length, LIST_BOUNDS.events);
  assert.equal(boundFirings().counts['LIST_BOUNDS.events'], before + 1, 'the overflow tells the bound record');
});
