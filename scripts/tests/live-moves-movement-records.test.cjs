// The movement owner's records and stuck moments, which left the live default-fixture table
// (test-windows DESIGN.md 4.1, T9 and T10): the live rows planted every rung outcome, typed call
// and owner error through the CODE frame, so they need no game. Each case drives the real owner
// (runtime/movement/character/owner.ts) on the movement-service fixture's stub host. The farming
// task's own ladder (regroup, safe point, wait) stays in movement-rules.test.cjs ("the stuck record
// names the wait rung it stands on", "T4 and T5 ...") and live-moves-task-ladder.test.cjs.
const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { fixture } = require('./fixtures/movement-service-scenario.cjs');
require('./helpers/planted-calls.cjs').plantCalls();
const { MOVEMENT_RING_SIZE } = require('../../runtime/protocol/records.ts');
const { STATUS_TIMER_MS } = require('../../runtime/protocol/reports.ts');
const { createCardLines } = require('../../runtime/status/coordinator/line.ts');

// The end codes a journey may carry (e2e/movement-owner-failures.md "Step 1" item 3).
const END_CODE = /^(arrived|released|superseded|runtime-replaced|expired|stale|(replaced|stopped):[a-z-]+(:[a-z0-9-]+)?|failed:[a-z0-9-]+)$/;
const a = { map: 'main', x: 250, y: 0 }, b = { map: 'main', x: 0, y: 250 };

// The owner on a stub host whose planner answers the straight line to the asked point. `posts`
// keeps each snapshot the owner sends the coordinator.
function owner() {
  const r = fixture({ stall: true }), posts = [], plan = r.ports.request;
  r.ports.request = async (path, o) => {
    if (path === '/movement-snapshot') { posts.push(o.body); return {}; }
    return { ...(await plan(path, o)), plot: [{ map: 'main', x: o.body.to.x, y: o.body.to.y }] };
  };
  const records = () => r.service.records();
  const ask = (to, request) => { r.service.move(to, undefined, request ? { request } : {}).catch(() => {}); return r.service.report()?.id ?? null; };
  return { ...r, posts, records, ask, ended: id => records().find(e => e.decision === 'ended' && e.journeyId === id) };
}

const keys = (value, found = new Set()) => {
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { found.add(key); keys(child, found); }
  return found;
};

scenarioTable('T10: the movement ring names typed calls and end codes, keeps its bound and hands out copies', owner, [
  ['a typed call replaces a follow walk, its end names the manual kind and the call site, and each journey starts once and ends at most once', async t => {
    const first = t.ask(a, { kind: 'follow', owner: 'follow' }); await t.ticks(2);
    t.ask(b); await t.ticks(2);
    const replaced = t.ended(first);
    assert.equal(replaced?.code, 'replaced:manual');
    assert.equal(replaced.by.kind, 'manual');
    assert.equal(typeof replaced.by.site, 'string', 'the typed call names its site');
    assert.ok(replaced.by.site.length > 0);
    const early = t.records(), journeys = [...new Set(early.filter(e => e.decision === 'started').map(e => e.journeyId))];
    assert.ok(journeys.includes(first), 'journeys started in the case');
    for (const id of journeys) {
      assert.equal(early.filter(e => e.journeyId === id && e.decision === 'started').length, 1, id + ' started');
      assert.ok(early.filter(e => e.journeyId === id && e.decision === 'ended').length <= 1, id + ' ended');
    }
    t.dispose();
  }],
  ['lower asks fill the ring to its bound in sequence, every end code is a typed one, and a read hands out copies', async t => {
    t.ask(a, { kind: 'follow', owner: 'follow' }); await t.ticks(2);
    t.ask(b); await t.ticks(2);
    for (let i = 0; i < MOVEMENT_RING_SIZE + 22; i++) t.ask(i % 2 ? a : b, { kind: 'follow', owner: 'fill:' + i });
    await t.ticks(2);
    const bounded = t.records();
    assert.equal(bounded.length, MOVEMENT_RING_SIZE);
    bounded.forEach((entry, i) => { if (i) assert.equal(entry.seq, bounded[i - 1].seq + 1, 'in sequence'); });
    for (const entry of bounded.filter(e => e.decision === 'ended')) assert.match(entry.code, END_CODE);
    const code = bounded[0].code, copy = t.records(); copy[0].code = 'mutated'; copy.length = 0;
    assert.equal(t.records()[0].code, code, 'a reader cannot change the ring');
    t.dispose();
  }],
  ["the heartbeat's movement report carries no ring", async t => {
    t.ask(a, { kind: 'follow', owner: 'follow' }); await t.ticks(2);
    for (let i = 0; i < 10; i++) t.ask(b, { kind: 'follow', owner: 'fill:' + i });
    // status/character/report.ts sends `movement.report() || movement.last()` as the body's movement.
    for (const body of [t.service.report(), t.service.last()]) {
      const fields = keys(body);
      assert.equal(fields.has('ring'), false); assert.equal(fields.has('records'), false);
    }
    t.dispose();
  }],
]);

// The group's task records on the same row (e2e/task-records.ts `taskRecords`): the live row drove
// the leader's group through the coordinator's task ops, so the tasks owner
// (runtime/tasks/coordinator/owner.ts) runs here on its own ports.
const { createTaskOwner } = require('../../runtime/tasks/coordinator/owner.ts');
scenarioTable('T10: the group ring keeps its bound, one snapshot per trigger and the breaks it saw', () => {
  const saved = [], owner = createTaskOwner({ now: () => 1000, notify() {}, snapshot: (group, trigger) => saved.push([group, trigger]) });
  owner.sync([{ id: 'party:L', kind: 'party', members: ['L', 'F'] }]);
  const ask = (kind, who, deadline) => owner.request('party:L', { kind, owner: who, members: ['L', 'F'], ...(deadline === undefined ? {} : { deadline }) });
  return { owner, ask, snapshots: trigger => saved.filter(([group, t]) => group === 'party:L' && t === trigger).length };
}, [
  ['a live trip with no bound and a waiting Hunt with no expiry are breaks 1 and 3', ({ owner, ask }) => {
    const trip = ask('manual', 'e2e:f1'), hunt = ask('hunt-mission', 'e2e:f3');
    assert.deepEqual([trip.status, hunt.status], ['granted', 'waiting']);
    owner.tick();
    assert.deepEqual([...new Set(owner.diagnostics().breaks.filter(b => b.group === 'party:L').map(b => b.invariant))].sort(), [1, 3]);
  }],
  ['kept asks fill the ring to its bound in sequence, and the safe point, a failed end and a loop each save one snapshot', ({ owner, ask, snapshots }) => {
    const deadline = 600_000, fill = ask('addon:e2e', 'e2e:fill', deadline);
    assert.equal(fill.status, 'granted');
    assert.ok(Array.from({ length: MOVEMENT_RING_SIZE + 22 }, () => ask('addon:e2e', 'e2e:fill', deadline)).every(h => h.status === 'kept'));
    owner.fail(fill, 'e2e'); owner.fail(fill, 'e2e'); owner.release(fill, 'failed:e2e');
    for (let i = 0; i < 3; i++) owner.release(ask('addon:e2e', 'e2e:once:' + i, deadline));
    for (let i = 0; i < 2; i++) owner.release(ask('addon:e2e', 'e2e:churn', deadline));
    const ring = owner.diagnostics().groups.find(g => g.id === 'party:L').ring;
    assert.equal(ring.length, MOVEMENT_RING_SIZE);
    ring.forEach((entry, i) => { assert.equal(entry.part, 'tasks'); if (i) assert.equal(entry.seq, ring[i - 1].seq + 1); });
    assert.deepEqual({ churn: snapshots('churn'), failed: snapshots('task-failed'), safe: snapshots('safe-point') }, { churn: 1, failed: 1, safe: 1 }, 'one snapshot per trigger');
    // The group's line, which the dashboard state and the heartbeat reply carry, holds no ring.
    assert.doesNotMatch(JSON.stringify(owner.status('party:L')), /"part":"tasks"/);
  }],
  ['a member on Manual refuses a merchant visit under Carries on, and takes one under Follows me', ({ owner }) => {
    const visits = [owner.allows('merchant-visit', 'F')];
    owner.hold('F', 'manual', { reason: 'On Manual', party: 'carries-on' }); visits.push(owner.allows('merchant-visit', 'F')); owner.hold('F', 'manual', null);
    owner.hold('F', 'manual', { reason: 'On Manual', party: 'follows-me' }); visits.push(owner.allows('merchant-visit', 'F')); owner.hold('F', 'manual', null);
    assert.deepEqual(visits, [true, false, true], 'idle, Carries on, Follows me');
  }],
]);

// A scripted round of two rungs whose outcomes the row reports itself, as the live row did.
function climber() {
  const t = owner();
  const rung = (name, trying) => ({ name, toward: true, attempt: () => ({ trying, options: {} }) });
  const at = () => ({ map: t.c.map, in: t.c.in, x: t.c.real_x, y: t.c.real_y });
  t.service.settingsReply({});
  const ladder = t.service.climb('e2e:stuck', [rung('first', 'walking to the first point'), rung('second', 'walking around the test wall')], 'Testing a blocked rung');
  const incidents = kind => t.service.incidents().filter(r => r.kind === kind && r.owner === 'e2e:stuck');
  return { ...t, ladder, at, incidents, first: ladder.next(at()).rung };
}
// The rung's own walk ends without arriving: a follow walk its holder stops.
async function blocked(t) {
  t.ask({ map: 'main', x: 80, y: 0 }, { kind: 'follow', owner: 'e2e:blocked' }); await t.ticks(2);
  await t.host.stop(undefined, undefined, { kind: 'follow', owner: 'e2e:blocked' }); await t.ticks(1);
}

scenarioTable('T9: a rung with no progress logs one stuck record, and the climb shows it until progress or its deadline', climber, [
  ['the failed rung writes one stuck record that names the climb, the rung and the walk that blocked it, and the next rung starts', async t => {
    assert.equal(t.first, 'first');
    await blocked(t);
    assert.equal(t.ladder.result({ arrived: false, at: t.at() }), 'failed');
    const [stuck, ...extra] = t.incidents('stuck');
    assert.equal(extra.length, 0, 'stuck records for one rung');
    assert.deepEqual({ character: stuck.character, activity: stuck.activity, rung: stuck.rung, trying: stuck.trying, map: stuck.position.map, blocked: stuck.blocked && { code: stuck.blocked.code, kind: stuck.blocked.kind, owner: stuck.blocked.owner } },
      { character: 'Test', activity: 'Testing a blocked rung', rung: 'first', trying: 'walking to the first point', map: 'main', blocked: { code: 'released', kind: 'follow', owner: 'e2e:blocked' } });
    assert.ok([stuck.position.x, stuck.position.y, stuck.noProgressMs].every(Number.isFinite), 'position and time without progress');
    const climbing = stuck.leadUp.find(r => r.decision === 'climbing' && r.owner === 'e2e:stuck');
    assert.ok(climbing, 'the lead-up starts at the climb');
    assert.ok(stuck.leadUp.every(r => r.seq >= climbing.seq), 'the lead-up holds nothing from before the climb');
    assert.deepEqual(t.service.incident(stuck.id), stuck, 'the id resolves to the record');
    assert.equal(t.records().filter(r => r.decision === 'stuck' && r.cause === stuck.id).length, 1, 'ring decisions naming the record');
    assert.equal(t.ladder.next(t.at()).rung, 'second', 'the next rung starts');
    assert.deepEqual(t.records().filter(r => r.cause === 'ladder' && r.owner === 'e2e:stuck' && /^rung/.test(r.decision)).map(r => [r.decision, r.code, r.ladderStep]),
      [['rung', 'first', 0], ['rung-failed', 'first', 0], ['rung', 'second', 1]]);
    assert.deepEqual(t.service.climbing().notice, { text: 'Stuck - trying walking around the test wall', incident: stuck.id, until: t.ports.now() + 2 * STATUS_TIMER_MS });
    await t.ticks(1);
    assert.equal(t.posts.filter(p => p.trigger === 'stuck' && p.incident === stuck.id).length, 1, 'one stuck snapshot');
    assert.ok(t.posts.find(p => p.incident === stuck.id).records.some(r => r.decision === 'stuck' && r.cause === stuck.id), 'the snapshot holds the record');
    t.dispose();
  }],
  ['progress on the next rung clears the notice, and without progress it ends at its deadline of two report intervals', async t => {
    await blocked(t);
    t.ladder.result({ arrived: false, at: t.at() }); t.ladder.next(t.at());
    assert.equal(t.ladder.result({ arrived: false, at: { ...t.at(), map: 'e2e-new-map' } }), 'progress');
    assert.equal(t.service.climbing().notice, undefined, 'progress clears it');
    assert.equal(t.ladder.result({ arrived: false, at: t.at() }), 'failed');
    assert.equal(t.incidents('stuck').length, 2);
    t.ladder.next(t.at());
    assert.match(t.service.climbing().notice?.text, /^Stuck - trying /);
    t.setNow(t.ports.now() + 2 * STATUS_TIMER_MS - 1);
    assert.ok(t.service.climbing().notice, 'the notice lasts until its deadline');
    t.setNow(t.ports.now() + 1);
    assert.equal(t.service.climbing().notice, undefined, 'the deadline ends it');
    t.dispose();
  }],
  ['an error the owner catches writes a caught-error record and moves the ladder on', async t => {
    const before = t.service.climbing().rung;
    t.service.hold({ get kind() { throw Error('e2e: forced owner error'); }, owner: 'e2e:broken' });
    const [caught] = t.incidents('caught-error');
    assert.match(caught?.error, /forced owner error/);
    assert.ok(caught.leadUp.some(r => r.decision === 'climbing' && r.owner === 'e2e:stuck'));
    assert.deepEqual(t.service.incident(caught.id), caught);
    assert.notEqual(t.service.climbing().rung, before, 'the ladder tries its next rung');
    t.dispose();
  }],
  ['ten refusals inside ten seconds save one churn snapshot', async t => {
    t.service.endClimb('e2e:stuck');
    t.service.hold({ kind: 'cave', owner: 'e2e:churn', deadline: t.ports.now() + 20_000 });
    for (let i = 0; i < 10; i++) t.ask({ map: 'main', x: 5 + i, y: 0 });
    await t.ticks(1);
    assert.equal(t.posts.filter(p => p.trigger === 'churn').length, 1);
    t.dispose();
  }],
]);

// The coordinator's card line while the climber serves the line's walk (status/coordinator/line.ts
// `climbing`): "<activity> - <trying>", with the stuck notice and its record id riding along.
scenarioTable("T9: the card line carries the climber's stuck notice", () => {
  const state = { statuses: { W: { seenAt: 1, ctype: 'warrior', map: 'main' } }, targetMode: 'farming', combatMode: 'auto', leader: 'W', followers: {}, monsterFocus: ['goo'], monsterFocusByCharacter: {}, merchantCharacter: null };
  const ports = { assignment: () => ({ kind: 'farming', owner: 'farming', tier: 'farming', reunion: 'none' }), monsterName: () => 'Goo', groupLine: () => null,
    lifecycle: () => ({ paused: false, drain: null }), hunt: () => undefined, merchantJob: () => false, escaping: () => undefined, recovery: () => undefined,
    cave: () => ({ members: [], travel: null }), entryLabel: (slot, mode) => slot === 'target-mode' ? 'Farming' : 'Auto' };
  return { state, line: climb => { state.statuses.W.movementClimb = climb; return createCardLines(state, ports)('W'); } };
}, [
  ['the notice and its record id ride with the line, which names no time, and progress leaves the words', ({ line }) => {
    const stuck = line({ activity: 'Testing a blocked rung', trying: 'walking around the test wall', notice: 'Stuck - trying walking around the test wall', incident: 'stuck:W:1' });
    assert.deepEqual({ text: stuck.text, notice: stuck.notice, incident: stuck.incident },
      { text: 'Testing a blocked rung - walking around the test wall', notice: 'Stuck - trying walking around the test wall', incident: 'stuck:W:1' });
    assert.doesNotMatch(stuck.text, /stuck|\d+ ?min/i);
    const moving = line({ activity: 'Testing a blocked rung', trying: 'walking around the test wall', notice: null, incident: null });
    assert.equal(moving.text, 'Testing a blocked rung - walking around the test wall');
    assert.equal(moving.notice ?? null, null);
  }],
]);
