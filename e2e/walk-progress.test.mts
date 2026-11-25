// The self-test of the walk progress rule (e2e/walk-progress.ts). It needs no game stack: each case
// feeds the rule a sample series. The ways the rule can fail:
//  P1 a stalled walk passes because the wait has no bound but the window's;
//  P2 a closing walk fails on its length, as the fixed 90 s did on W25b's cross-map walk;
//  P3 a member waiting at a door fails the walk while the other one still walks;
//  P4 route planning or a fight on the way reads as a stall;
//  P6 the route planning before the first walking step counts against the walking bound.
// Usage: node --test e2e/walk-progress.test.mts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { walkProgress, type WalkSample } from './walk-progress.ts';

const PLANNING_MS = 30_000, REPORT_MS = 1_000;
const sample = (over: Partial<WalkSample> = {}): WalkSample =>
  ({ map: 'main', x: 0, y: 0, journey: 'j1', step: 0, attackAt: null, walking: true, reportIntervalMs: REPORT_MS, ...over });

test('P1: a walk that stands still on a walking step fails after two report intervals', () => {
  const rule = walkProgress(0, PLANNING_MS);
  rule.observe(0, { W: sample(), P: sample() });
  rule.observe(500, { W: sample({ x: 40 }), P: sample({ x: 40 }) });
  rule.observe(2_500, { W: sample({ x: 41 }), P: sample({ x: 40 }) });
  assert.throws(() => rule.observe(2_501, { W: sample({ x: 41 }), P: sample({ x: 40 }) }), /stalled.*two report intervals \(2000 ms\)/);
});

test('P1: a walk that never leaves fails at the route planning budget', () => {
  const rule = walkProgress(0, PLANNING_MS);
  rule.observe(0, { W: sample({ walking: false }), P: sample({ walking: false }) });
  rule.observe(PLANNING_MS, { W: sample({ walking: false }), P: sample({ walking: false }) });
  assert.throws(() => rule.observe(PLANNING_MS + 1, { W: sample({ walking: false }), P: sample({ walking: false }) }), /movementPlanningMs/);
});

test('P2: a closing walk of any length passes', () => {
  const rule = walkProgress(0, PLANNING_MS);
  let x = 0;
  for (let at = 0; at <= 600_000; at += 500) { x += 39; rule.observe(at, { W: sample({ x }), P: sample({ x }) }); }
  assert.equal(rule.snapshot().causes.moved, 2 * 1200);
});

test('P3: a member waiting at a door is not a stall while the other walks', () => {
  const rule = walkProgress(0, PLANNING_MS);
  for (let at = 0; at <= 10_000; at += 500) rule.observe(at, { W: sample({ x: 300, walking: false }), P: sample({ x: at / 20 }) });
  rule.observe(10_500, { W: sample({ map: 'mtunnel', x: 0 }), P: sample({ map: 'mtunnel', x: 0 }) });
  assert.equal(rule.snapshot().lastProgress?.cause, 'map');
});

test('P4: planning and a fight on the way are progress or under the planning budget', () => {
  const rule = walkProgress(0, PLANNING_MS);
  rule.observe(0, { W: sample({ walking: false, journey: null, step: null }), P: sample({ walking: false, journey: null, step: null }) });
  rule.observe(12_000, { W: sample({ walking: false }), P: sample({ walking: false }) });
  rule.observe(13_000, { W: sample({ x: 20 }), P: sample({ x: 20 }) });
  for (let at = 13_500; at <= 20_000; at += 500) rule.observe(at, { W: sample({ x: 20, attackAt: at }), P: sample({ x: 20 }) });
  assert.equal(rule.snapshot().lastProgress?.cause, 'attack');
});

// W48 run liveb-step9-run1.log: the party travel to a map the game data lacks failed as
// route-failed 31 ms into each try, and the convoy started a new journey from the same point every
// 1-3 s for 24 min of wall time, each one read as progress.
test('P5: a route that fails and restarts from the same point stalls at the planning budget', () => {
  const rule = walkProgress(0, PLANNING_MS);
  let at = 0;
  const retry = (n: number) => ({ W: sample({ journey: `j${n}`, step: 0, walking: false }), P: sample({ walking: false }) });
  for (let n = 1; at <= PLANNING_MS; n++, at += 2_000) rule.observe(at, retry(n));
  assert.throws(() => rule.observe(at, retry(99)), /movementPlanningMs/);
});

// W45 closing run (final-gate-closing-s1.log): the party's convoy prepared for 2.5 s with no member
// walking, and the first walking sample, still at the start, failed at 2750 ms against the 2000 ms
// walking bound.
test('P6: the walking bound counts from the first walking sample, not from the planning before it', () => {
  const rule = walkProgress(0, PLANNING_MS);
  rule.observe(0, { W: sample({ walking: false }), P: sample({ walking: false }) });
  rule.observe(2_750, { W: sample(), P: sample() });
  rule.observe(4_750, { W: sample(), P: sample() });
  assert.throws(() => rule.observe(4_751, { W: sample(), P: sample() }), /two report intervals \(2000 ms\)/);
});
