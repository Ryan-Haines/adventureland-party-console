// The self-test of the play window runner (e2e/window-runner.ts). It needs no game stack: the
// world is a plain object and each step records what ran. The ways the runner can fail, written
// before the runner (AGENTS.md "Testing"):
//  R1 a dirty start still runs the play, so a window reads another window's leftovers;
//  R2 one observer's failed verdict stops the others, so one failure hides the rest;
//  R3 a play failure leaves the observers' verdicts as passed, though nothing was observed;
//  R4 the state dump is skipped on a failure, or taken after the undo has changed the world;
//  R5 the undo is skipped after a failure, so the plants reach the next window's world;
//  R6 an observer's failed sample stops the play or the other observers' samples;
//  R7 an observer whose start failed gives a passing verdict on a read it never installed;
//  R8 a window that leaks a global (a new __e2e name, a wrapped game function) leaves it for the
//     next window, so that window starts dirty;
//  R9 a window that edits the game data (a catalog monster made peaceful) leaves it for every
//     later spawn of that type, and the next window's proof does not read it.
// Usage: node --test e2e/window-runner.test.mts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordData, recordGlobals, restoreData, restoreGlobals, runWindow, type GlobalScope, type Observer, type WindowRun } from './window-runner.ts';

type World = { log: string[] };
const observer = (id: string, verdict: (w: World) => void = () => {}, extra: Partial<Observer<World>> = {}): Observer<World> =>
  ({ id, owner: 'tests', behaviours: [], start: w => { w.log.push(`start ${id}`); }, verdict: w => { w.log.push(`verdict ${id}`); verdict(w); }, ...extra });
const run = (world: World, spec: Partial<WindowRun<World>>) => runWindow(world, {
  id: 'W00', proof: async () => [], play: async w => { w.log.push('play'); }, observers: [],
  dump: async w => { w.log.push('dump'); return {}; }, undo: async w => { w.log.push('undo'); }, ...spec,
}, { step: async (_title, fn) => fn(), attach: async () => {} });

test('R1: a planted dirty start fails as "dirty start" and never plays', async () => {
  const world = { log: [] };
  const result = await run(world, { proof: async () => [{ line: 'events', expected: [], actual: ['goobrawl'] }], observers: [observer('A')] });
  assert.equal(result.outcome, 'dirty start');
  assert.match(String(result.error), /dirty start: events/);
  assert.ok(!world.log.includes('play'), 'the play does not run on a dirty start');
  assert.deepEqual(result.verdicts.map(v => v.status), ['not observed']);
});

test('R2: a failing observer still lets the others report', async () => {
  const world = { log: [] };
  const result = await run(world, { observers: [observer('A'), observer('B', () => { throw Error('B read 0.7, bound 0.76'); }), observer('C')] });
  assert.equal(result.outcome, 'failed');
  assert.deepEqual(result.verdicts.map(v => [v.id, v.status]), [['A', 'passed'], ['B', 'failed'], ['C', 'passed']]);
  assert.match(String(result.error), /B: B read 0.7/);
});

test('R3: a play failure marks every observer "not observed"', async () => {
  const world = { log: [] };
  const result = await run(world, { play: async () => { throw Error('the fixture never reached the farm'); }, observers: [observer('A'), observer('B')] });
  assert.equal(result.outcome, 'play failed');
  assert.deepEqual(result.verdicts.map(v => v.status), ['not observed', 'not observed']);
  assert.ok(!world.log.some(l => l.startsWith('verdict')), 'no verdict runs after a play failure');
});

test('R4 and R5: the dump runs before the undo at every end, pass or fail', async () => {
  for (const spec of [{}, { play: async () => { throw Error('play'); } }, { proof: async () => [{ line: 'x', expected: 1, actual: 2 }] },
    { observers: [observer('A', () => { throw Error('A'); })] }] as Partial<WindowRun<World>>[]) {
    const world = { log: [] as string[] };
    await run(world, spec);
    assert.deepEqual(world.log.slice(-2), ['dump', 'undo']);
  }
});

test('R6: a failed sample fails only its own observer', async () => {
  const world = { log: [] as string[] };
  let samplesB = 0;
  const result = await run(world, { pollMs: 1, play: async () => { await new Promise(r => setTimeout(r, 30)); },
    observers: [observer('A', () => {}, { sample: () => { throw Error('A sample'); } }), observer('B', () => {}, { sample: () => { samplesB++; } })] });
  assert.ok(samplesB > 1, 'B keeps sampling after A failed');
  assert.deepEqual(result.verdicts.map(v => [v.id, v.status]), [['A', 'failed'], ['B', 'passed']]);
  assert.match(String(result.verdicts[0].error), /A sample/);
});

test('R7: an observer whose start failed fails, and the others play on', async () => {
  const world = { log: [] as string[] };
  const result = await run(world, { observers: [observer('A', () => {}, { start: () => { throw Error('no ring'); } }), observer('B')] });
  assert.ok(world.log.includes('play'));
  assert.deepEqual(result.verdicts.map(v => [v.id, v.status]), [['A', 'failed'], ['B', 'passed']]);
  assert.ok(!world.log.includes('verdict A'), 'its verdict never runs on a read it never installed');
});

test('R8: a window that leaks a global leaves the next one clean', async () => {
  // windows.ts ships the guard into each realm as source text, so the test rebuilds it the same way.
  const [record, restore] = [recordGlobals, restoreGlobals].map(f => new Function(`return ${f.toString()}`)()) as [typeof recordGlobals, typeof restoreGlobals];
  const native = () => 'native';
  const realm: Record<string, unknown> = { broadcast_e: native, __e2eChronalClock: 1, __e2eHarnessLater: undefined };
  delete realm.__e2eHarnessLater;
  const stopped: unknown[] = [], key = Symbol('record');
  const scope: GlobalScope = { names: () => Object.keys(realm), functionNames: () => ['broadcast_e', 'missing'],
    get: n => realm[n], set: (n, v) => { realm[n] = v; }, remove: n => delete realm[n], stop: v => { if (v === 'timer') stopped.push(v); } };
  const globals = { record: async () => { (realm as any)[key] = record(scope); }, restore: async () => restore(scope, (realm as any)[key], ['__e2eChronalClock', '__e2eHarnessLater']) };
  const proof = async () => Object.keys(realm).filter(n => n.startsWith('__e2e') && n !== '__e2eChronalClock' && n !== '__e2eHarnessLater')
    .map(n => ({ line: 'plant', expected: [], actual: n })).concat(realm.broadcast_e === native ? [] : [{ line: 'broadcast_e', expected: 'native', actual: 'wrapped' }]);
  const leak = async () => {
    realm.__e2eSavedBroadcast = realm.broadcast_e; realm.broadcast_e = () => 'wrapped';
    realm.__e2eStagingTimer = 'timer'; realm.__e2eHarnessLater = 2;
  };
  const undos: unknown[] = [];
  for (const play of [leak, async () => { await leak(); throw Error('play failed after its plants'); }]) {
    const first = await runWindow({ log: [] }, { id: 'W01', proof, play, observers: [], dump: async () => ({}), undo: async () => {}, globals },
      { step: async (_t, fn) => fn(), attach: async (n, body) => { if (n.endsWith('global-undo')) undos.push(body); } });
    assert.notEqual(first.outcome, 'dirty start');
    const next = await run({ log: [] }, { proof, globals });
    assert.equal(next.outcome, 'passed', String(next.error));
  }
  assert.equal(realm.broadcast_e, native);
  assert.equal(realm.__e2eHarnessLater, 2, 'a kept name stays with its owner');
  assert.deepEqual(stopped, ['timer', 'timer'], 'a deleted timer is stopped first');
  assert.deepEqual(undos[0], { added: ['__e2eSavedBroadcast', '__e2eStagingTimer'], replaced: ['broadcast_e'], stuck: [] });
});

test('R9: a window that sets a catalog monster peaceful leaves the next window clean', async () => {
  // windows.ts ships these into the game server as source text, so the test rebuilds them the same way.
  const [record, restore] = [recordData, restoreData].map(f => new Function(`return ${f.toString()}`)()) as [typeof recordData, typeof restoreData];
  const cgoo = { hp: 1000, aggro: 1, drops: [['0.1', 'gem0']] }, bee = { hp: 120 };
  const G: Record<string, any> = { monsters: { cgoo, bee }, events: { dreams: { encounters: [{ id: 'e11' }, { id: 'e20' }] } }, maps: { main: {} } };
  const baseline = record(G, ['monsters', 'events'], ['c']);
  let current: ReturnType<typeof recordData> | undefined;
  const globals = { record: async () => { current = record(G, ['monsters', 'events'], ['c']); }, restore: async () => restore(current!, 'G', true) };
  const proof = async () => { const drift = restore(baseline, 'G', false); return drift.length ? [{ line: 'game data', expected: 'the baseline', actual: drift }] : []; };
  // W29a's shape: peacefulWorld edits the catalog in place, a spawner swaps a type's definition for
  // a peaceful copy, a Cave row cuts the encounter list, and the play's own undo of them is lost.
  const leak = async () => {
    for (const d of Object.values(G.monsters)) { d.aggro = 0; d.peaceful = true; }
    G.monsters.bee = { ...bee, peaceful: true };
    G.events.dreams.encounters = G.events.dreams.encounters.filter((e: { id: string }) => e.id === 'e11');
    cgoo.drops.push(['1', 'planted']);
  };
  const first = await runWindow({ log: [] }, { id: 'W01', proof, play: leak, observers: [], dump: async () => ({}), undo: async () => {}, globals },
    { step: async (_t, fn) => fn(), attach: async () => {} });
  assert.equal(first.outcome, 'passed', String(first.error));
  assert.equal(G.monsters.bee, bee, 'the swapped definition goes back by reference');
  assert.deepEqual([cgoo, bee].map(d => 'peaceful' in d), [false, false]);
  assert.equal(cgoo.aggro, 1);
  assert.deepEqual(cgoo.drops, [['0.1', 'gem0']]);
  assert.deepEqual(G.events.dreams.encounters.map((e: { id: string }) => e.id), ['e11', 'e20']);
  // The fixture's reset swaps a definition for an equal copy before a window, and the game counts
  // each type's spawns in its definition's `c` (server.js new_monster); neither is a leak.
  G.monsters.cgoo = structuredClone(cgoo); G.monsters.bee.c = 3;
  const next = await run({ log: [] }, { proof, globals });
  assert.equal(next.outcome, 'passed', String(next.error));
  // With no global undo, the next window's proof names the leak and the window never plays.
  await leak();
  const dirty = await run({ log: [] }, { proof });
  assert.equal(dirty.outcome, 'dirty start');
  assert.match(String(dirty.error), /game data .*G\.monsters\.cgoo\.peaceful/);
});
