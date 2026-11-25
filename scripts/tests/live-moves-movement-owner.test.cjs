// The movement owner's journey rules that left the live W09 window (test-windows DESIGN.md 4.3,
// T8): ranked requests, the stop rule, kept and retargeted journeys, waiting walks, holds, typed
// calls, deadlines, stale requests, the per-tick invariants and the combat step pauses. Each case
// drives the real owner (runtime/movement/character/owner.ts) on the movement-service fixture's
// stub host, with the requests, holds and deadlines the live row planted through the CODE frame.
// W09 keeps the click hand-back, the Town recast landing on the server and the no-stop-packet
// resume, which need the game.
const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { settle, fixture } = require('./fixtures/movement-service-scenario.cjs');
require('./helpers/planted-calls.cjs').plantCalls();
const { MOVEMENT_TICK_MS } = require('../../runtime/movement/rules.ts');
const { ARRIVAL_TOLERANCE, rejoinRound } = require('../../runtime/protocol/ladder.ts');

// The audit runs on each movement tick, so a deadline that falls after one is seen on the next.
const AUDIT_BOUND_MS = 2 * MOVEMENT_TICK_MS;
// Three points with clear lines between each pair; the character starts on o.
const o = { map: 'main', x: 0, y: 0 }, a = { map: 'main', x: 250, y: 0 }, b = { map: 'main', x: 0, y: 250 };
const travelRequest = { kind: 'manual', owner: 'manual' };

// The owner on a stub host whose planner answers the straight line to the asked point, so a walk
// ends where it was asked to. `packets` counts the stop packets the live row counted: a native stop
// that moves and a move to where the character already stands.
function journeys() {
  const r = fixture({ stall: true });
  r.ports.request = async (_, o) => ({ ...o.body, plot: [{ map: 'main', x: o.body.to.x, y: o.body.to.y }] });
  let packets = 0;
  const native = r.host.__partyNativeMovement, nativeStop = native.stop, move = r.host.move;
  native.stop = (action, ...rest) => { if (action !== 'smart') packets++; return nativeStop(action, ...rest); };
  r.host.move = (x, y) => { if (Math.hypot(x - r.c.real_x, y - r.c.real_y) < 1) packets++; return move(x, y); };
  const records = () => r.service.records();
  const ended = id => records().find(e => e.decision === 'ended' && e.journeyId === id);
  // An ask keeps its promise's outcome: `arrived`, or the rejection's code or message.
  function ask(to, request, options = {}) {
    const asked = { outcome: 'pending' };
    r.service.move(to, undefined, request ? { ...options, request } : options)
      .then(() => { asked.outcome = 'arrived'; }, e => { asked.outcome = e && e.code || String(e && e.message || e); });
    asked.journey = r.service.report()?.id ?? null;
    return asked;
  }
  const place = p => Object.assign(r.c, { x: p.x, y: p.y, real_x: p.x, real_y: p.y });
  return { ...r, records, ended, ask, place,
    packets: () => packets,
    code: id => ended(id)?.code,
    // The plan answers and the first move goes out.
    walk: () => r.ticks(3),
    // The character stands on `p` and the owner sees the arrival.
    async arrive(p) { place(p); await r.ticks(3); },
    // A clear point `length` to the side of the character, for a combat step.
    side: (length = 40) => ({ x: r.c.real_x + length, y: r.c.real_y + 10 }),
    step: p => r.service.step(p, 'e2e-step').status,
    // The game shows the character walking toward `p`, as it does after a step's move.
    walking(p) { Object.assign(r.c, { moving: true, going_x: p.x, going_y: p.y }); },
    entries: (id, decision) => records().filter(e => e.journeyId === id && e.decision === decision) };
}

scenarioTable('the movement owner ranks requests, keeps the holder\'s journey and ends what it replaces', journeys, [
  ['items 1 and 2: lower requests and foreign stops leave a travel walking, send no stop packet and each leave a refusal on it', async t => {
    const first = t.ask(a, travelRequest); await t.walk();
    const before = t.packets();
    const approach = t.ask(b, { kind: 'approach', owner: 'approach:e2e' }), follow = t.ask(b, { kind: 'follow', owner: 'follow' });
    await t.host.stop(undefined, undefined, { kind: 'follow', owner: 'follow' });
    await t.host.stop('smart', undefined, { kind: 'approach', owner: 'approach:e2e' });
    await settle();
    assert.equal(t.packets(), before, 'stop packets for refused requests and stops');
    assert.equal(t.service.report().id, first.journey);
    assert.deepEqual([approach.outcome, follow.outcome], ['refused', 'refused']);
    await t.arrive(a);
    assert.equal(t.code(first.journey), 'arrived');
    assert.deepEqual(t.records().filter(e => e.journeyId === first.journey && ['refused', 'refused-stop'].includes(e.decision)).map(e => [e.decision, e.by?.kind]),
      [['refused', 'approach'], ['refused', 'follow'], ['refused-stop', 'follow'], ['refused-stop', 'approach']]);
    t.dispose();
  }],
  ['item 3: the same owner asking for the same place keeps its journey with no stop packet', async t => {
    const request = { kind: 'manual', owner: 'e2e-owner' };
    const keep1 = t.ask(b, request); await t.walk();
    const stops = t.packets(), keep2 = t.ask(b, request);
    assert.equal(keep2.journey, keep1.journey);
    assert.equal(t.packets(), stops);
    await t.arrive(b);
    assert.deepEqual([keep1.outcome, keep2.outcome], ['arrived', 'arrived']);
    assert.deepEqual(t.records().filter(e => e.journeyId === keep1.journey).map(e => e.decision), ['started', 'kept', 'ended']);
    t.dispose();
  }],
  ['item 4: the same owner\'s new point on a clear line retargets the live journey with no stop packet', async t => {
    const request = { kind: 'manual', owner: 'e2e-owner' };
    const first = t.ask(a, request); await t.walk();
    const stops = t.packets(), c = t.c;
    assert.equal(t.host.can_move({ map: c.map, x: c.real_x, y: c.real_y, going_x: b.x, going_y: b.y, base: c.base }), true, 'precondition: the line to the new point is clear');
    const retarget = t.ask(b, request);
    assert.equal(retarget.journey, first.journey);
    assert.equal(t.packets(), stops);
    await t.arrive(b);
    assert.deepEqual([first.outcome, retarget.outcome], ['arrived', 'arrived']);
    assert.deepEqual(t.records().filter(e => e.journeyId === first.journey).map(e => e.decision), ['started', 'retargeted', 'ended']);
    t.dispose();
  }],
  ['item 5: a group walk asked below a travel waits, starts where the travel ended, and expires when the navigation revision changes', async t => {
    const manual = t.ask(b, travelRequest); await t.walk();
    // A convoy's gate rides on its walk's journey, so the travel keeps its scheduler while the walk waits.
    const walk = t.ask(a, { kind: 'group-walk', owner: 'walk:e2e:1', tier: 'hunt-mission' }, { gate: { tick() { t.service.tick(); } } });
    assert.equal(walk.journey, manual.journey);
    assert.equal(t.records().some(e => e.decision === 'waiting' && e.owner === 'walk:e2e:1'), true);
    await t.arrive(b);
    assert.equal(t.code(manual.journey), 'arrived');
    await t.walk(); await t.arrive(a);
    assert.equal(walk.outcome, 'arrived');
    const manualEnd = t.ended(manual.journey), resumed = t.records().find(e => e.decision === 'started' && e.owner === 'walk:e2e:1');
    assert.ok(resumed.at >= manualEnd.at);
    assert.ok(Math.hypot(resumed.from.x - b.x, resumed.from.y - b.y) <= ARRIVAL_TOLERANCE, 'the waiting walk starts where the travel ended');
    // A waiting walk whose navigation revision changes expires before it starts.
    t.ask(b, travelRequest); await t.walk();
    const stale = t.ask(o, { kind: 'group-walk', owner: 'walk:e2e:2', tier: 'hunt-mission' });
    // A second dashboard travel changes the navigation revision, and the next tick ends the old one.
    t.supersede(); await t.ticks(1);
    const next = t.ask(o, travelRequest);
    await settle();
    assert.equal(stale.outcome, 'expired');
    assert.deepEqual(t.records().filter(e => e.owner === 'walk:e2e:2').map(e => e.decision), ['waiting', 'expired']);
    await t.walk(); await t.arrive(o);
    assert.equal(t.code(next.journey), 'arrived');
    t.dispose();
  }],
  ['item 6: a hold refuses a lower request until its release', async t => {
    assert.equal(t.service.hold({ kind: 'town', owner: 'e2e-town' }), 'granted');
    const held = t.ask(b, { kind: 'follow', owner: 'follow' }); await settle();
    assert.equal(held.outcome, 'refused');
    assert.equal(t.service.release('e2e-town'), true);
    const freed = t.ask(b, { kind: 'follow', owner: 'follow' });
    assert.ok(freed.journey);
    await t.walk();
    await t.host.stop(undefined, undefined, { kind: 'follow', owner: 'follow' });
    assert.equal(t.code(freed.journey), 'released');
    t.dispose();
  }],
  // Step 10 item 2: every console caller names its requester, so a call with none is the player's
  // typed code and ranks as the player's command.
  ['item 8: a typed call replaces a lower walk and an older typed call, its stop releases it, and replaced and failed callers hear their cause', async t => {
    const lower = t.ask(a, { kind: 'follow', owner: 'follow' }); await t.walk();
    const typed1 = t.ask(b);
    assert.notEqual(typed1.journey, lower.journey);
    assert.equal(t.code(lower.journey), 'replaced:manual');
    // Asked before the first one plans, so it starts its own journey.
    const typed2 = t.ask(a);
    assert.notEqual(typed2.journey, typed1.journey);
    assert.equal(t.code(typed1.journey), 'replaced:manual');
    await t.walk();
    await t.host.stop();
    assert.equal(t.code(typed2.journey), 'released');
    await settle();
    assert.deepEqual([lower.outcome, typed1.outcome], ['Movement replaced by a new destination', 'Movement replaced by a new destination'], 'replaced requests hear their cause');
    // The planner answers no route for a point past Main's east edge.
    t.ports.request = async () => { throw Object.assign(Error('Path not found'), { failure: 'unreachable' }); };
    const lost = t.ask({ map: 'main', x: 2600, y: 0 }, { kind: 'manual', owner: 'e2e-unreachable' });
    for (let i = 0; i < 20 && lost.outcome === 'pending'; i++) await t.ticks(2);
    assert.notEqual(lost.outcome, 'pending');
    assert.doesNotMatch(String(lost.outcome), /^(|arrived|undefined)$/, 'the failed request hears a cause');
    assert.match(String(t.records().find(e => e.decision === 'ended' && e.owner === 'e2e-unreachable')?.code), /^failed:[a-z0-9-]+$/, 'the failed journey end names its failure');
    assert.equal(t.service.live(), null);
    assert.equal(t.service.ownerReport().errors, 0);
    t.dispose();
  }],
  ['a journey a click pauses walks on after the hand-back and ends arrived', async t => {
    const home = t.ask(o, travelRequest); await t.walk(); await t.arrive(o);
    assert.equal(t.code(home.journey), 'arrived');
    const follow = t.ask(a, { kind: 'follow', owner: 'follow' }); await t.walk();
    t.c.moving = true; t.host.on_map_click(0, 60); await settle();
    t.c.moving = false; t.service.audit(); t.setNow(1000 + 5000); t.service.audit();
    assert.equal(t.service.clicking(), null);
    const from = t.calls.length;
    await t.walk();
    assert.deepEqual(t.calls.slice(from), [['move', a.x, a.y]], 'the resumed walk sends its travel move again');
    await t.arrive(a);
    assert.equal(t.code(follow.journey), 'arrived');
    t.dispose();
  }],
]);

// Step 8a items 5 to 7 and step 8c item 12: deadlines, stale requests and the per-tick
// invariants, on the service clock the ring stamps.
scenarioTable('the movement owner ends a hold, a waiting request or a journey at its deadline or currency test', journeys, [
  ['8a item 5: a hold ends at its renewed deadline within one audit, and a waiting request with a deadline expires at it', async t => {
    const t0 = 1000, entry = (owner, decision) => t.records().find(e => e.owner === owner && e.decision === decision);
    assert.equal(t.service.hold({ kind: 'death-recovery', owner: 'e2e-hold', deadline: t0 + 1000 }), 'granted');
    assert.equal(t.service.hold({ kind: 'death-recovery', owner: 'e2e-hold', deadline: t0 + 2000 }), 'kept');
    t.setNow(t0 + 1000); t.service.audit();
    assert.equal(entry('e2e-hold', 'ended'), undefined);
    t.setNow(t0 + 2000); t.service.audit();
    assert.equal(entry('e2e-hold', 'ended')?.code, 'expired');
    const expired = entry('e2e-hold', 'ended').at;
    assert.ok(expired >= t0 + 2000, 'the renewed deadline holds');
    assert.ok(expired - (t0 + 2000) <= AUDIT_BOUND_MS, 'ms from the deadline to the expiry');
    assert.equal(t.service.live(), null);
    // A waiting request with a deadline expires the same way.
    const travelling = t.ask(a, travelRequest); await t.walk();
    const waitUntil = t0 + 3000;
    const late = t.ask(b, { kind: 'group-walk', owner: 'walk:e2e:8a', tier: 'hunt-mission', deadline: waitUntil });
    t.setNow(waitUntil); t.service.audit(); await settle();
    assert.equal(late.outcome, 'expired');
    const lateEnd = entry('walk:e2e:8a', 'expired');
    assert.ok(lateEnd.at - waitUntil <= AUDIT_BOUND_MS, 'ms from the waiting deadline to the expiry');
    assert.ok(lateEnd.at >= waitUntil);
    await t.arrive(a);
    assert.equal(t.code(travelling.journey), 'arrived');
    t.dispose();
  }],
  // Each ask names its own currency flag, so a journey that still read the first ask's test would end
  // `stale` when that flag drops.
  ['8c item 12: a holder asking again for its kept or retargeted journey takes the new deadline and currency test', async t => {
    const flags = {}, now = () => t.ports.now();
    const renewAsk = (p, deadline, flag) => { flags[flag] = true; return t.ask(p, { kind: 'manual', owner: 'e2e-renew', deadline, current: () => flags[flag] }); };
    const drop = flag => { flags[flag] = false; t.setNow(now() + AUDIT_BOUND_MS); t.service.audit(); };
    const first = renewAsk(b, now() + 60_000, 'renew1'); await t.walk();
    const again = renewAsk(b, now() + 120_000, 'renew2');
    assert.equal(again.journey, first.journey);
    assert.equal(t.service.live().deadline, 1000 + 120_000, 'the kept journey carries the new deadline');
    drop('renew1');
    assert.equal(t.service.live()?.owner, 'e2e-renew', 'the kept journey reads the new currency test');
    await t.arrive(b);
    assert.deepEqual([first.outcome, again.outcome], ['arrived', 'arrived']);
    assert.deepEqual(t.records().filter(e => e.journeyId === first.journey).map(e => [e.decision, e.code ?? null]), [['started', null], ['kept', null], ['ended', 'arrived']]);
    // From b toward a, then a new point on a clear line, o.
    const toA = renewAsk(a, now() + 60_000, 'renew3'); await t.walk();
    const c = t.c;
    assert.equal(t.host.can_move({ map: c.map, x: c.real_x, y: c.real_y, going_x: o.x, going_y: o.y, base: c.base }), true, 'precondition: the line to the new point is clear');
    const retargetAt = now(), toO = renewAsk(o, retargetAt + 90_000, 'renew4');
    assert.equal(toO.journey, toA.journey);
    assert.equal(t.service.live().deadline, retargetAt + 90_000, 'the retargeted journey carries the new deadline');
    drop('renew3');
    assert.equal(t.service.live()?.owner, 'e2e-renew', 'the retargeted journey reads the new currency test');
    flags.renew4 = false; t.service.audit();
    assert.equal(t.code(toA.journey), 'stale');
    assert.deepEqual(t.records().filter(e => e.journeyId === toA.journey).map(e => e.decision), ['started', 'retargeted', 'ended']);
    assert.equal(t.service.live(), null);
    const back = t.ask(a, { kind: 'manual', owner: 'e2e-renew' }); await t.walk(); await t.arrive(a);
    assert.equal(back.outcome, 'arrived');
    t.dispose();
  }],
  ['8a item 6: a journey whose request goes stale ends stale at the next audit and its caller hears it', async t => {
    let stale = false;
    const asked = t.ask(b, { kind: 'death-recovery', owner: 'e2e-stale', current: () => !stale }); await t.walk();
    stale = true; const staleAt = t.ports.now(); t.service.audit(); await settle();
    assert.equal(t.code(asked.journey), 'stale');
    assert.ok(t.records().find(e => e.owner === 'e2e-stale' && e.decision === 'ended').at - staleAt <= AUDIT_BOUND_MS, 'ms from going stale to the end');
    assert.equal(asked.outcome, 'stale');
    assert.equal(t.service.live(), null);
    t.dispose();
  }],
  ['8a item 7: an unowned climber and an untimed hold each count once and write one entry, and a standing hold gives way to any request', async t => {
    const invariants = () => t.service.ownerReport().invariants, before = invariants();
    t.service.climb('e2e-climber', rejoinRound(false));
    t.service.audit(); t.service.audit();
    assert.equal(invariants().unowned, before.unowned + 1);
    assert.equal(t.service.hold({ kind: 'town', owner: 'e2e-untimed' }), 'granted');
    t.service.audit();
    assert.equal(invariants().untimed, before.untimed + 1);
    // Both stay counted once while they last.
    for (let i = 0; i < 5; i++) { t.setNow(t.ports.now() + MOVEMENT_TICK_MS); t.service.audit(); }
    assert.ok(t.ports.now() >= 1000 + 5 * MOVEMENT_TICK_MS);
    assert.deepEqual({ unowned: invariants().unowned, untimed: invariants().untimed }, { unowned: before.unowned + 1, untimed: before.untimed + 1 });
    assert.deepEqual(t.records().filter(e => e.decision === 'invariant').map(e => [e.owner, e.cause]), [['e2e-climber', 'unowned'], ['e2e-untimed', 'untimed']]);
    assert.equal(t.service.release('e2e-untimed'), true);
    t.service.endClimb('e2e-climber');
    assert.equal(t.service.live(), null);
    // A standing hold marks who owns a still character and gives way to any request.
    assert.equal(t.service.hold({ kind: 'death-recovery', owner: 'e2e-standing', yields: true, deadline: t.ports.now() + 60_000 }), 'granted');
    const follower = t.ask(b, { kind: 'follow', owner: 'follow' });
    assert.ok(follower.journey, 'a follow request starts over a standing death recovery hold');
    assert.equal(t.records().find(e => e.owner === 'e2e-standing' && e.decision === 'ended')?.code, 'replaced:follow');
    await t.walk();
    await t.host.stop(undefined, undefined, { kind: 'follow', owner: 'follow' });
    assert.equal(t.code(follower.journey), 'released');
    const back = t.ask(b, travelRequest); await t.walk(); await t.arrive(b);
    assert.equal(t.code(back.journey), 'arrived');
    t.dispose();
  }],
]);

// Step 5: combat steps borrow the character from a journey (design section 2.4).
scenarioTable('combat steps pause a journey the row lends, and a hold or a let go stops only the own step', journeys, [
  ['step 5 item 2: a step with no let go resumes the travel once its step window passes', async t => {
    const second = t.ask(b, travelRequest); await t.walk();
    const status = t.step(t.side()), stepWindow = t.service.live().stepMs, stepAt = t.ports.now();
    assert.equal(status, 'sent');
    t.setNow(stepAt + stepWindow - 1); await t.ticks(1);
    assert.equal(t.entries(second.journey, 'resumed').length, 0);
    t.setNow(stepAt + stepWindow); await t.ticks(1);
    assert.equal(t.entries(second.journey, 'resumed').length, 1);
    const [paused] = t.entries(second.journey, 'paused'), [resumed] = t.entries(second.journey, 'resumed');
    assert.equal(resumed.cause, 'idle');
    assert.ok(stepWindow > 0, 'precondition: the step window is the walk to the step, not a fixed time');
    assert.ok(resumed.at - paused.at >= stepWindow, 'seconds from the last step to travel resuming');
    assert.ok(resumed.at - paused.at < stepWindow + 100);
    await t.arrive(b);
    assert.equal(t.code(second.journey), 'arrived');
    t.dispose();
  }],
  ['step 5 item 6: a group walk\'s row refuses steps with no move and one refusal entry', async t => {
    const walk = t.ask(o, { kind: 'group-walk', owner: 'walk:e2e:3', tier: 'hunt-mission' }); t.place(a); await t.walk();
    const from = t.calls.length;
    assert.deepEqual([t.step(t.side()), t.step(t.side(45))], ['refused', 'refused']);
    assert.deepEqual(t.calls.slice(from), [], 'native moves for refused steps');
    assert.equal(t.entries(walk.journey, 'step-refused').length, 1, 'one refusal entry per holder');
    await t.arrive(o);
    assert.equal(walk.outcome, 'arrived');
    t.dispose();
  }],
  ['step 5 items 7 and 8: a hold stops a walking step once and refuses steps until release; letting go stops the own step; neither stops a journey\'s move', async t => {
    const p = t.side(150), first = t.step(p); t.walking(p);
    const before = t.packets(), hold = t.service.hold({ kind: 'town', owner: 'e2e-town-steps' });
    assert.deepEqual([first, hold], ['sent', 'granted']);
    await settle();
    assert.equal(t.packets() - before, 1, 'a hold stops the walking step once');
    const from = t.calls.length;
    assert.equal(t.step(t.side()), 'refused');
    assert.deepEqual(t.calls.slice(from), []);
    assert.equal(t.service.release('e2e-town-steps'), true);
    const own = t.side(150), sent = t.step(own); t.walking(own);
    const ownBefore = t.packets(); t.service.letGo(); await settle();
    assert.equal(sent, 'sent', 'steps return on release');
    assert.equal(t.packets() - ownBefore, 1, 'letting go with no journey stops the own step');
    assert.deepEqual(t.calls.at(-1).slice(1).map(Math.round), [Math.round(t.c.real_x), Math.round(t.c.real_y)]);
    t.c.moving = false;
    // With no pause, a hold or a let go leaves a journey's own move alone.
    const third = t.ask(a, travelRequest); await t.walk();
    const journeyStops = t.packets();
    t.service.holdStep(); t.service.letGo(); await settle();
    assert.equal(t.packets(), journeyStops, 'stop packets from a hold or let go on a walking journey');
    await t.arrive(a);
    assert.equal(t.code(third.journey), 'arrived');
    t.dispose();
  }],
  ['step 5 item 9: a dashboard travel during a combat pause takes the character at once and ends the pause', async t => {
    const fourth = t.ask(b, travelRequest); await t.walk();
    assert.equal(t.step(t.side()), 'sent');
    // The dashboard travel changes the navigation revision, so the next tick ends the paused journey.
    t.supersede(); await t.ticks(1);
    const fifth = t.ask(o, travelRequest);
    assert.equal(t.service.live().paused, false, 'the pause ends with the journey it paused');
    assert.equal(t.code(fourth.journey), 'superseded');
    await t.walk(); await t.arrive(o);
    assert.equal(t.code(fifth.journey), 'arrived');
    assert.equal(t.service.ownerReport().errors, 0);
    t.dispose();
  }],
]);
