// The death recovery's respawn and its return after it.
// The movement owner's death recovery is the only path.
// The respawn asks the group task what the member does now: a farm or Hunt answer starts
// the farm return, an event answer climbs the rejoin ladder. `task` is the heartbeat's answer; it
// counts only once it is newer than the respawn (`askAfter`). Isolated: the rows lose a respawn's
// reply, which the live server never does. Each row builds its own ports, since two rows plant
// their own respawn and rejoin.
const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { ports } = require('./fixtures/respawn-recovery-scenario.cjs');

scenarioTable('the death recovery respawns once and returns the member to its task (SV26, SV28, SV29)', ports, [
 ['a respawn whose reply was lost asks again on the next tick, never two in flight', async () => {
  const f = ports();
  try {
    const first = f.recover(); await f.recover();
    assert.equal(f.state.attempts, 1);
    f.timers.shift()({ reason: 'lost reply' }); await first;
    assert.equal(f.logs.length, 0, 'a lost reply is no failure to log');
    const second = f.recover(); assert.equal(f.state.attempts, 2, 'the next tick asks again, with no fixed wait');
    f.timers.shift()(); await second;
  } finally { f.restore(); }
 }],
 ['a respawn answered not-now waits for the next tick without counting an attempt', async () => {
  const f = ports();
  try {
    f.state.flight = {};
    await f.recover();
    assert.equal(f.state.attempts, 0); assert.equal(f.published.at(-1).stage, 'respawn-waiting');
    f.state.flight = null;
    const attempt = f.recover(); assert.equal(f.state.attempts, 1); f.timers.shift()(); await attempt;
  } finally { f.restore(); }
 }],
 ['live respawn state starts the farm return once the group task answers, even if the response promise was lost', async () => {
  const f = ports();
  try {
    const attempt = f.recover(); f.state.dead = false; f.timers.shift()({ reason: 'lost reply' }); await attempt;
    assert.equal(f.state.farms, 0, 'an answer from before the respawn does not count');
    f.advance(1000); await f.recover(); assert.equal(f.state.farms, 1);
    await f.recover(); assert.equal(f.state.farms, 1);
    assert.equal(f.published.at(-1).stage, 'recovery-complete');
  } finally { f.restore(); }
 }],
 ['a respawn that lands after its lost reply still starts exactly one farm return', async () => {
  const f = ports();
  try {
    const attempt = f.recover(); f.timers.shift()({ reason: 'lost reply' }); await attempt;
    assert.equal(f.state.farms, 0); f.state.dead = false; f.advance(1001); await f.recover(); f.advance(1000); await f.recover();
    assert.equal(f.state.farms, 1); assert.equal(f.state.attempts, 1); await f.recover(); assert.equal(f.state.farms, 1);
  } finally { f.restore(); }
 }],
 ['failed event travel climbs the rejoin ladder without another respawn or a farm return', async () => {
  let dead = true, respawns = 0, joins = 0;
  const f = ports({ isDead: () => dead, respawn: async () => { respawns++; dead = false; },
    rejoinEvent: async () => { joins++; return joins === 1 ? { status: 'retryable', phase: 'event-travel', reason: 'route blocked' } : { status: 'recovered' }; } });
  try {
    f.state.task = { kind: 'event-attendance', owner: 'attend:mrgreen:1', event: 'mrgreen' };
    await f.recover(); f.advance(1000); await f.recover();
    assert.equal(f.published.at(-1).recovery.phase, 'event-travel'); assert.equal(f.published.at(-1).recovery.lastError, 'route blocked');
    f.advance(1000); await f.recover();
    assert.equal(respawns, 1); assert.equal(joins, 2); assert.equal(f.state.farms, 0); assert.equal(f.published.at(-1).stage, 'recovery-complete');
    assert.equal(f.logs.length, 0);
  } finally { f.restore(); }
 }],
 ['an event that ends asks the group task again; a thrown error names its phase', async () => {
  for (const cancel of [true, false]) {
    let dead = true;
    const f = ports({ isDead: () => dead, respawn: async () => { dead = false; },
      rejoinEvent: async () => { if (cancel) return { status: 'cancelled' }; throw Error('join rejected'); } });
    try {
      f.state.task = { kind: 'event-attendance', owner: 'attend:mrgreen:1', event: 'mrgreen' };
      await f.recover(); f.advance(1000); await f.recover();
      assert.equal(f.published.at(-1).stage, cancel ? 'recovery-ask' : 'recovery-retry');
      assert.equal(f.state.farms, 0);
      if (!cancel) assert.match(f.logs[0], /^event-reentry failed: join rejected/);
    } finally { f.restore(); }
  }
 }],
]);
