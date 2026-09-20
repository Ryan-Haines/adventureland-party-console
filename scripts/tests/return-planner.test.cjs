const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPlannerService } = require('../../runtime/coordinator/navigation/planner-service.ts');
const { planReturnCandidates } = require('../../runtime/characters/return-planner.ts');

const game = { maps: { main: { spawns: [[0, 0]], doors: [], npcs: [] } }, geometry: {}, npcs: {} };
const validation = { game, walk: () => true, door: () => false, hasKey: () => false };
const request = { id: 'hunt-return', version: 1, fingerprint: 'fixture',
  from: { map: 'main', x: 1000, y: 0 }, to: { map: 'main', x: 0, y: 0 }, speed: 50 };
const result = (body) => ({ id: body.id, version: body.version, fingerprint: body.fingerprint,
  ms: 1, plot: [{ ...body.to, ...(body.town ? { town: true } : {}) }] });

test('parallel return candidates reach the real planner service and select the faster Town route', async () => {
  // Keep both requests in flight to exercise the service's real duplicate-ID guard.
  const worker = new URL('data:text/javascript,' + encodeURIComponent(`
    import { parentPort } from 'node:worker_threads';
    parentPort.postMessage({ ready: true });
    parentPort.on('message', body => setTimeout(() => parentPort.postMessage((${result.toString()})(body)), 25));
  `));
  const service = createPlannerService(worker), completed = [];
  try {
    const prepared = service.prepare(game, 1);
    await prepared.ready;
    const chosen = await planReturnCandidates({ request: async (url, { body }) => {
      assert.equal(url, '/movement-plan');
      const response = await service.plan(body);
      completed.push(body);
      return response;
    } }, validation, { ...request, fingerprint: prepared.fingerprint }, 20);
    assert.equal(completed.length, 2);
    assert.equal(new Set(completed.map(body => body.id)).size, 2);
    assert.equal(chosen.id, request.id);
    assert.equal(chosen.plot[0].town, true);
  } finally { service.dispose(); }
});

test('candidate response identities are checked before restoring the journey identity', async () => {
  await assert.rejects(planReturnCandidates({ request: async (url, { body }) =>
    ({ ...result(body), id: request.id }) }, validation, request, 20), /identity mismatch/);
});

test('a rejected Town candidate still permits a valid walking route', async () => {
  const chosen = await planReturnCandidates({ request: async (url, { body }) => {
    if (body.town) throw Error('Town route unavailable');
    return result(body);
  } }, validation, request, 20);
  assert.equal(chosen.id, request.id);
  assert.equal(chosen.plot[0].town, undefined);
});

test('shadow comparison preserves its mode and parent journey identity', async () => {
  const chosen = await planReturnCandidates({ request: async (url, { body }) =>
    ({ ...result(body), mode: 'shadow' }) }, validation, request, 20);
  assert.equal(chosen.id, request.id);
  assert.equal(chosen.mode, 'shadow');
});
