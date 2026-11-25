const assert = require('node:assert/strict');
const { createPlannerService } = require('../../runtime/movement/coordinator/planner-service.ts');
const { planReturnCandidates } = require('../../runtime/movement/character/planner.ts');

const game = { maps: { main: { spawns: [[0, 0]], doors: [], npcs: [] } }, geometry: {}, npcs: {} };
const validation = { game, walk: () => true, door: () => false, hasKey: () => false };
const request = { id: 'hunt-return', version: 1, fingerprint: 'fixture',
  from: { map: 'main', x: 1000, y: 0 }, to: { map: 'main', x: 0, y: 0 }, speed: 50 };
const result = (body) => ({ id: body.id, version: body.version, fingerprint: body.fingerprint,
  ms: 1, plot: [{ ...body.to, ...(body.town ? { town: true } : {}) }] });

const {scenarioTable}=require('./fixtures/scenarios.cjs');
scenarioTable('Hunt return candidates are planned in parallel and one valid candidate is enough (MOV-077)', ()=>undefined, [
 ['a valid Town-first candidate wins, and a rejected Town candidate leaves the walking route', async ()=>{
  // Keep both requests in flight to exercise the service's real duplicate-ID guard.
  const worker = new URL('data:text/javascript,' + encodeURIComponent(`
    import { parentPort } from 'node:worker_threads';
    parentPort.postMessage({ ready: true });
    parentPort.on('message', body => setTimeout(() => parentPort.postMessage((${result.toString()})(body)), 25));
  `));
  const service = createPlannerService(worker, require('./helpers/run-scope.cjs').testScope('02', 'act')), completed = [];
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
  // One valid candidate is enough.
  const chosen = await planReturnCandidates({ request: async (url, { body }) => {
    if (body.town) throw Error('Town route unavailable');
    return result(body);
  } }, validation, request, 20);
  assert.equal(chosen.id, request.id);
  assert.equal(chosen.plot[0].town, undefined);
  // A candidate whose request the coordinator never answers fires its named bound, and the other
  // candidate still answers.
  const { boundsPending, boundsSent } = require('../../runtime/status/api.ts');
  boundsSent(boundsPending().length);
  const timedOut = await planReturnCandidates({ request: async (url, { body, timeout }) => {
    if (body.town) throw Object.assign(Error('timeout'), { partyRequest: { path: url, kind: 'timeout', timeout } });
    return result(body);
  } }, validation, request, 20);
  assert.equal(timedOut.plot[0].town, undefined);
  assert.deepEqual(boundsPending().filter(f => !f.cap).map(f => [f.bound, f.state.candidate, f.state.ms]), [['PLAN_CANDIDATE_REQUEST_MS', 'town', 2000]]);
  boundsSent(boundsPending().length);
 }],
 ['a candidate answered with another id is refused, and the route fails when both are', async ()=>{
  const wrongId = async (url, { body }) => ({ ...result(body), id: 'other-request' });
  await assert.rejects(planReturnCandidates({ request: wrongId }, validation, request, 20),
    /Planner response identity mismatch/);
  // The other candidate stays usable when only one answers under the wrong id.
  const chosen = await planReturnCandidates({ request: async (url, { body }) => ({ ...result(body), id: body.town ? 'other-request' : body.id }) },
    validation, request, 20);
  assert.equal(chosen.id, request.id);
  assert.equal(chosen.plot[0].town, undefined);
 }],
 ['a failed candidate request keeps its retryable partyRequest error, and one timeout leaves the other candidate', async ()=>{
  const timeout = () => Object.assign(Error('timed out'), { partyRequest: { path: '/movement-plan', kind: 'timeout' } });
  const failure = await planReturnCandidates({ request: async () => { throw timeout(); } }, validation, request, 20)
    .then(() => null, error => error);
  assert.equal(failure?.partyRequest?.kind, 'timeout', 'the caller still sees a retryable request error, not a route failure');
  const chosen = await planReturnCandidates({ request: async (url, { body }) => {
    if (!body.town) throw timeout();
    return result(body);
  } }, validation, request, 20);
  assert.equal(chosen.id, request.id);
  assert.equal(chosen.plot[0].town, true);
 }],
]);
