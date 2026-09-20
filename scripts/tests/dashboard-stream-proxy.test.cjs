const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { gateway } = require('../../tools/hosting/gateway.ts');
const { createDashboardStream } = require('../../runtime/coordinator/telemetry/dashboard-stream.ts');
async function listen(server) { await new Promise(done => server.listen(0, '127.0.0.1', done)); return server.address().port; }
async function close(server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
function nativeProxy() {
  const source = fs.readFileSync('tools/dashboard/supervisor.mts', 'utf8');
  const ast = ts.createSourceFile('supervisor.mts', source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'proxy');
  const context = { request: http.request, previous: null, json: (response, code, value) => { response.writeHead(code); response.end(JSON.stringify(value)); } };
  vm.createContext(context); vm.runInContext(ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.proxy;
}
for (const kind of ['gateway', 'native']) test(`${kind} passes authenticated SSE snapshots and five-second heartbeats, then cleans up disconnected upstream`, { timeout: 9000 }, async () => {
  const routes = new Map(); const statuses = { A: { dashboardRuntime: 'r', seenAt: Date.now(), hp: 100, items: [], slots: {} } };
  const streams = createDashboardStream({ now: Date.now, statuses: () => statuses, active: () => true,
    every: setInterval, cancel: clearInterval });
  streams.install({ get: (path, handler) => routes.set(path, handler), post() {} });
  const upstream = http.createServer((request, response) => {
    response.set = headers => { for (const [name, value] of Object.entries(headers)) response.setHeader(name, value); };
    routes.get(request.url)(request, response);
  });
  const port = await listen(upstream);
  const proxy = nativeProxy();
  const downstream = kind === 'gateway' ? gateway({ apiPort: port, dashboardPort: port, configured: () => true,
    access: { required: true, valid: (scope, token) => scope === 'browsers' && token === 'test-session' } }) :
    http.createServer((request, response) => proxy(request, response, { port }));
  const proxyPort = await listen(downstream);
  try {
    if (kind === 'gateway') {
      const denied = await fetch(`http://127.0.0.1:${proxyPort}/party-api/dashboard-stream`, { redirect: 'manual' });
      assert.equal(denied.status, 302); assert.equal(streams.count(), 0);
    }
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${proxyPort}/party-api/dashboard-stream`, { headers: { Cookie: 'party=test-session' }, signal: controller.signal });
    assert.match(response.headers.get('content-type'), /event-stream/);
    const reader = response.body.getReader(), decoder = new TextDecoder(); let text = '';
    while (!text.includes('"heartbeat"')) text += decoder.decode((await reader.read()).value);
    assert.match(text, /"snapshot"/); assert.match(text, /"heartbeat"/); assert.equal(streams.count(), 1);
    controller.abort(); await reader.cancel().catch(() => {});
    for (let index = 0; index < 20 && streams.count(); index++) await new Promise(done => setTimeout(done, 10));
    assert.equal(streams.count(), 0);
  } finally { await close(downstream); await close(upstream); }
});
