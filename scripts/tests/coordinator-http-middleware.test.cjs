const test = require('node:test');
const assert = require('node:assert/strict');
const { codeResponseHeaders, partyApiResponseHeaders } = require('../../runtime/coordinator/http/middleware.ts');

function responseRecorder() {
  const calls = [];
  return {
    calls,
    response: {
      set: (name, value) => calls.push([name, value]),
      sendStatus: status => { calls.push(['status', status]); return 'sent'; },
    },
    next: () => calls.push(['next']),
  };
}

test('CODE responses disable caching before allowing static file delivery', () => {
  const { calls, response, next } = responseRecorder();
  codeResponseHeaders({}, response, next);
  assert.deepEqual(calls, [
    ['Access-Control-Allow-Origin', '*'],
    ['Cache-Control', 'no-store, max-age=0'],
    ['Pragma', 'no-cache'],
    ['next'],
  ]);
});

test('dashboard preflight terminates without invoking a route', () => {
  const { calls, response, next } = responseRecorder();
  assert.equal(partyApiResponseHeaders({ method: 'OPTIONS' }, response, next), 'sent');
  assert.deepEqual(calls, [
    ['Access-Control-Allow-Origin', '*'],
    ['Access-Control-Allow-Headers', 'Content-Type'],
    ['Access-Control-Allow-Methods', 'GET,POST,OPTIONS'],
    ['status', 204],
  ]);
});

test('normal dashboard requests continue exactly once after setting CORS headers', () => {
  for (const method of ['GET', 'POST']) {
    const { calls, response, next } = responseRecorder();
    assert.equal(partyApiResponseHeaders({ method }, response, next), undefined);
    assert.equal(calls.length, 4);
    assert.deepEqual(calls.at(-1), ['next']);
    assert.equal(calls.some(([name]) => name === 'status'), false);
  }
});
