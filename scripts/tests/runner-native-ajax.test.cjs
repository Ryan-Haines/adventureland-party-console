const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('../../.caracal/node_modules/jsdom');
const jquery = require('../../.caracal/node_modules/jquery');
const { installNativeAjax, nativeAjaxEligible } = require('../../runtime/lifecycle/native-ajax.ts');
const { createRunnerHost } = require('../../runtime/lifecycle/runner-host.ts');

// Failure inventory: docs/efficiency.md, Character threads, CT2.
function codeWindow() {
  const window = new JSDOM('', { url: 'https://adventure.land/' }).window;
  window.$ = jquery(window);
  return window;
}
async function server(handler) {
  const seen = { requests: [], connections: 0, closed: 0 };
  const instance = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      seen.requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      // The coordinator's partyApiResponseHeaders middleware.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      handler(req, res, seen);
    });
  });
  instance.on('connection', socket => { seen.connections++; socket.on('close', () => seen.closed++); });
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + instance.address().port;
  return { seen, base, close: () => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve); }) };
}
function settle(request) {
  return new Promise(resolve => request
    .done((value, status, xhr) => resolve({ ok: true, value, status, xhr }))
    .fail((xhr, status, error) => resolve({ ok: false, status, error, xhr })));
}
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'X-Probe': 'kept', 'Access-Control-Expose-Headers': 'X-Probe' }); res.end(JSON.stringify(value)); };

test('a loopback JSON POST carries the same body and resolves the same values', async () => {
  const local = await server((req, res) => json(res, 200, { echoed: req.url }));
  const window = codeWindow();
  installNativeAjax(window.$);
  const completed = [];
  window.$(window.document).on('ajaxComplete', (_event, xhr, settings) => completed.push([settings.url, xhr.status]));
  try {
    const body = JSON.stringify({ name: 'E2EPriest', text: 'snow ☃ and a lone \ud800 surrogate' });
    const result = await settle(window.$.ajax({ url: local.base + '/party-api/status', method: 'POST',
      contentType: 'application/json', dataType: 'json', data: body, cache: false, timeout: 5000 }));
    assert.equal(result.ok, true);
    assert.equal(result.status, 'success');
    assert.equal(result.xhr.status, 200);
    assert.equal(result.value.echoed, '/party-api/status');
    assert.deepEqual(result.xhr.responseJSON, result.value);
    assert.equal(result.xhr.getResponseHeader('x-probe'), 'kept');
    assert.deepEqual(local.seen.requests.map(r => r.method), ['POST']);
    const [request] = local.seen.requests;
    assert.equal(request.headers['content-type'], 'application/json');
    assert.equal(request.headers['x-requested-with'], undefined);
    // jsdom's USVString conversion replaces a lone surrogate with U+FFFD; Node's encoder does too.
    assert.equal(request.body.toString('utf8'), body.replace('\ud800', '�'));
    assert.deepEqual(completed.map(entry => entry[1]), [200]);
  } finally { window.close(); await local.close(); }
});

test('sequential requests share one keep-alive connection', async () => {
  const local = await server((_req, res) => json(res, 200, { ok: true }));
  const window = codeWindow();
  installNativeAjax(window.$);
  try {
    for (let index = 0; index < 5; index++) {
      const result = await settle(window.$.ajax({ url: local.base + '/party-api/status', method: 'POST',
        contentType: 'application/json', dataType: 'json', data: '{}' }));
      assert.equal(result.ok, true);
    }
    assert.equal(local.seen.requests.length, 5);
    assert.equal(local.seen.connections, 1);
  } finally { window.close(); await local.close(); }
});

test('HTTP errors, invalid JSON, timeouts, refused connections and aborts keep their jQuery outcomes', async () => {
  const local = await server((req, res) => {
    if (req.url.startsWith('/busy')) return json(res, 503, { error: 'Declared hold' });
    if (req.url.startsWith('/broken')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{not json'); }
    // /slow never answers.
  });
  const window = codeWindow();
  installNativeAjax(window.$);
  try {
    const busy = await settle(window.$.ajax({ url: local.base + '/busy', method: 'POST', dataType: 'json', data: '{}' }));
    assert.equal(busy.ok, false);
    assert.equal(busy.status, 'error');
    assert.equal(busy.xhr.status, 503);
    assert.equal(busy.xhr.responseJSON.error, 'Declared hold');

    const broken = await settle(window.$.ajax({ url: local.base + '/broken', dataType: 'json' }));
    assert.equal(broken.ok, false);
    assert.equal(broken.status, 'parsererror');
    assert.equal(broken.xhr.status, 200);

    const closedBefore = local.seen.closed;
    const slow = await settle(window.$.ajax({ url: local.base + '/slow', dataType: 'json', timeout: 100 }));
    assert.equal(slow.ok, false);
    assert.equal(slow.status, 'timeout');
    assert.equal(slow.xhr.status, 0);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(local.seen.closed > closedBefore, 'a timed out request must release its connection');

    const pending = window.$.ajax({ url: local.base + '/slow', dataType: 'json' });
    const aborted = settle(pending);
    pending.abort();
    const outcome = await aborted;
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 'abort');

    const refusedPort = await new Promise(resolve => { const probe = http.createServer().listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); }); });
    const refused = await settle(window.$.ajax({ url: 'http://127.0.0.1:' + refusedPort + '/party-api/status', method: 'POST', dataType: 'json', data: '{}' }));
    assert.equal(refused.ok, false);
    assert.equal(refused.status, 'error');
    assert.equal(refused.xhr.status, 0);
  } finally { window.close(); await local.close(); }
});

test('only asynchronous loopback HTTP requests with string or empty bodies leave jsdom', () => {
  const base = { type: 'POST', async: true, hasContent: true, data: '{}', dataTypes: ['json'] };
  assert.equal(nativeAjaxEligible({ ...base, url: 'http://127.0.0.1:924/party-api/status' }), true);
  assert.equal(nativeAjaxEligible({ ...base, url: 'http://localhost:924/party-api/status' }), true);
  assert.equal(nativeAjaxEligible({ ...base, url: 'http://[::1]:924/party-api/status' }), true);
  assert.equal(nativeAjaxEligible({ ...base, url: 'http://127.0.0.1:924/CODE/adventure_land/universal-loader.js?t=1', type: 'GET', hasContent: false, data: undefined, dataTypes: ['text'] }), true);
  assert.equal(nativeAjaxEligible({ ...base, url: 'https://adventure.land/api/servers_and_characters' }), false);
  assert.equal(nativeAjaxEligible({ ...base, url: 'https://127.0.0.1:924/party-api/status' }), false);
  assert.equal(nativeAjaxEligible({ ...base, url: '/party-api/status' }), false);
  assert.equal(nativeAjaxEligible({ ...base, url: 'http://127.0.0.1:924/x', async: false }), false);
  assert.equal(nativeAjaxEligible({ ...base, url: 'http://127.0.0.1:924/x', dataTypes: ['script'] }), false);
  assert.equal(nativeAjaxEligible({ ...base, url: 'http://127.0.0.1:924/x', data: { form: true } }), false);
});

test('headless CODE contexts send coordinator requests through the native transport', async () => {
  const local = await server((_req, res) => json(res, 200, { ok: true }));
  const oldApiPort = process.env.AL_INTERNAL_API_PORT;
  process.env.AL_INTERNAL_API_PORT = String(new URL(local.base).port);
  await fs.mkdir('.build/test-runners', { recursive: true });
  const directory = await fs.mkdtemp('.build/test-runners/ajax-');
  const codeFile = path.resolve(directory, 'entry.js');
  await fs.writeFile(codeFile, 'globalThis.sharedRoutine={stop(){}};' +
    'const post=()=>new Promise(resolve=>$.ajax({url:__partyServer+"/party-api/status",method:"POST",contentType:"application/json",dataType:"json",data:JSON.stringify({name:"E2EPriest"})}).done(resolve));' +
    'parent.result=post().then(first=>post().then(second=>[first,second]));');
  const upper = { caracAL: {} };
  const host = createRunnerHost({ upper, codeFile, runnerFiles: [],
    createContext(parent) {
      const window = codeWindow();
      window.globalThis = window;
      Object.defineProperty(window, 'parent', { value: parent });
      vm.createContext(window);
      return window;
    },
    async evaluateFiles(_files, context) { vm.runInContext('var character={rip:false};function set_message(){}', context); },
    async connected() {}, send() {},
  });
  try {
    await host.start();
    // The values come from the CODE realm, so compare their JSON.
    assert.equal(JSON.stringify(await upper.result), JSON.stringify([{ ok: true }, { ok: true }]));
    assert.deepEqual(local.seen.requests.map(r => r.method), ['POST', 'POST']);
    assert.equal(local.seen.connections, 1);
    assert.deepEqual(JSON.parse(local.seen.requests[0].body), { name: 'E2EPriest' });
  } finally {
    if (oldApiPort === undefined) delete process.env.AL_INTERNAL_API_PORT;
    else process.env.AL_INTERNAL_API_PORT = oldApiPort;
    await host.dispose(); await fs.rm(directory, { recursive: true }); await local.close();
  }
});
