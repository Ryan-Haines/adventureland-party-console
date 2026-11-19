const {isLoopback}=require('./game/addresses.cjs');
const {createLiveAccount}=require('./live-account.cjs');
// Production coordinator, with account/client-file transport pointed at the disposable upstream server.
require('../tools/sim/network-clock.cjs').install();
// Character status and every game action come from actual browser CODE runtimes.
const fs = require('node:fs');
const path = require('node:path');
const {createHash}=require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const directory = path.resolve(process.env.E2E_DATA_DIR || '');
const relative = path.relative(path.join(root, '.build/e2e'), directory);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Dedicated E2E_DATA_DIR required');
const webUrl = process.env.E2E_GAME_WEB_URL;
if (!webUrl || !isLoopback(new URL(webUrl).hostname)) throw Error('Local upstream web URL required');
const auth = process.env.E2E_GAME_AUTH;
if (!auth) throw Error('Disposable account auth required');
let port = Number(process.env.E2E_COORDINATOR_PORT);
const nativeFetch = globalThis.fetch;
async function localFetch(input, init) {
  let url = new URL(String(input));
  if (url.hostname === 'adventure.land') url = new URL(url.pathname + url.search, webUrl);
  if (!isLoopback(url.hostname)) throw Error('Unexpected nonlocal request: ' + url.origin);
  return nativeFetch(url, init);
}
globalThis.fetch = localFetch;
async function api(method, body = {}) {
  const response = await localFetch(webUrl + '/api/' + method, { method: 'POST',
    headers: { Cookie: 'auth=' + auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw Error('Upstream API ' + method + ': ' + response.status);
  return response.json();
}
const account = Object.assign(createLiveAccount(api), {
  resolve_realm(realm) {
    const server = this.response.servers.find(server => server.key === realm || server.region + server.name === realm);
    const port = server?.region==='US' && server?.name==='II' ? '9004' : '9003';
    return server && { ...server, address: new URL(webUrl).origin.replace(':8083', ':'+port).replace(':8090', ':7192') };
  },
});
const resolve = createRequire(path.join(root, '.caracal/standalones/CharacterCoordinator.js'));
const nativeExpress = require('express');
let listener;
const fixtureExpress = Object.assign((...args) => {
  const app=nativeExpress(...args),listen=app.listen;
  app.listen=function(...parameters){
    listener=listen.apply(this,parameters);
    listener.once('listening',()=>{
      port=listener.address().port;
      process.env.AL_INTERNAL_API_PORT=String(port);
    });
    return listener;
  };
  return app;
}, nativeExpress);
const homeVisitorStatusFile = path.join(directory, 'home-visitor-status.jsonl');
let homeVisitorStatusLines = fs.existsSync(homeVisitorStatusFile)
  ? fs.readFileSync(homeVisitorStatusFile, 'utf8').trim().split('\n').filter(Boolean).length : 0;
fixtureExpress.json = (...args) => {
  const parse = nativeExpress.json(...args);
  return (req, res, next) => parse(req, res, error => {
    if (error) return next(error);
    if (req.method === 'GET' && req.originalUrl.split('?')[0] === '/party-api/console-deployment' &&
        fs.existsSync(path.join(directory,'observe-console-maintenance'))) {
      const sendJson=res.json;
      res.json=function(value){
        try{fs.appendFileSync(path.join(directory,'console-maintenance-observations.jsonl'),JSON.stringify({at:Date.now(),value})+'\n');}
        catch(error){console.error('Maintenance observation failed:',error);}
        return sendJson.call(this,value);
      };
    }
    if (req.method === 'POST' && req.originalUrl.split('?')[0] === '/party-api/merchant/complete' &&
        fs.existsSync(path.join(directory, 'hold-merchant-completion')))
      return res.status(503).json({error:'Declared E2E merchant completion hold'});
    if (req.method === 'POST' && req.originalUrl.split('?')[0] === '/party-api/status' && req.body?.name === 'E2EBankBoi') {
      const sendJson = res.json;
      res.json = function(value) {
        try {
          if(homeVisitorStatusLines < 128) {
            fs.appendFileSync(homeVisitorStatusFile, JSON.stringify({at:Date.now(),
              request:{lastCommandId:req.body.lastCommandId,merchantCommand:req.body.merchantCommand,
                runtime:req.body.runtime,home:req.body.home,map:req.body.map},
              response:{command:value?.command ? {id:value.command.id,type:value.command.type,operationId:value.command.operationId} : null,
                bankboiStorage:value?.bankboiStorage,escapeStage:value?.escape?.stage,
                dungeonOwned:value?.dailyDungeon?.owned,navigationIntent:value?.navigationIntent,
                consoleMaintenance:!!value?.consoleMaintenance,partyConvoyActive:value?.partyConvoyActive}
            })+'\n');
            homeVisitorStatusLines++;
          }
        } catch (_) { /* Observation cannot alter a real response. */ }
        return sendJson.call(this,value);
      };
    }
    // The group owners' calls for the records row: in the tasks owner
    // step 2 no provider asks, so the row drives the owner in this process.
    if (req.method === 'POST' && req.originalUrl.split('?')[0] === '/party-api/e2e-tasks') {
      const owner = globalThis.__partyTasks, allowed = new Set(['request', 'update', 'release', 'fail', 'progress', 'rung', 'hold', 'tick', 'allows']);
      if (!owner) return res.status(503).json({ error: 'No task owner in this coordinator' });
      try { return res.json({ results: (req.body.ops || []).map(({ op, args }) => {
        if (!allowed.has(op)) throw Error('Not a task owner call: ' + op);
        return owner[op](...(args || []));
      }) }); }
      catch (error) { return res.status(400).json({ error: String(error) }); }
    }
    // The anchor fixture add-on (scripts/tests/fixtures/anchor-addon.ts) joins this coordinator's
    // registry on a row's request, as e2e/coordinator.cjs registers the settings fixture: the
    // coordinator answers `group.anchor` (runtime/coordinator/targeting/queue.ts `evaluateGroup`). The
    // shipped tank-hold add-on answers it too, and holds it only while it is on (its default is off).
    if (req.method === 'POST' && req.originalUrl.split('?')[0] === '/party-api/e2e-anchor-addon') {
      const hooks = globalThis.__partyHooks;
      if (!hooks) return res.status(503).json({ error: 'No hook registry in this coordinator' });
      const { registration } = require('../scripts/tests/fixtures/anchor-addon.ts');
      const registered = hooks.map().registrations.some(r => r.name === registration.name) ? { ok: true } : hooks.register(registration);
      return registered.ok ? res.json({ ok: true, name: registration.name }) : res.status(400).json({ error: registered.message });
    }
    // The hook fixture add-ons' coordinator halves (e2e/fixtures/*-hooks-addon.ts): one route,
    // `/party-api/e2e-<name>-hooks`, serves each fixture from HOOK_FIXTURES.
    const fixtureRoute = req.method === 'POST' && /^\/party-api\/e2e-([a-z]+)-hooks$/.exec(req.originalUrl.split('?')[0]);
    if (fixtureRoute && HOOK_FIXTURES[fixtureRoute[1]]) {
      const hooks = globalThis.__partyHooks;
      if (!hooks) return res.status(503).json({ error: 'No hook registry in this coordinator' });
      const body = req.body || {}, run = hookFixtureOps(fixtureRoute[1])[body.op];
      if (!run) return res.status(400).json({ error: 'Unknown op ' + body.op });
      try { const out = run(body, hooks); return out && out.ok === false ? res.status(400).json({ error: out.message }) : res.json(out); }
      catch (error) { return res.status(400).json({ error: String(error) }); }
    }
    if (req.method === 'POST' && req.originalUrl.split('?')[0] === '/party-api/merchant/complete' &&
        fs.existsSync(path.join(directory, 'hold-merchant-completion')))
      return res.status(503).json({error:'Declared E2E merchant completion hold'});
    if (req.method === 'POST' && req.originalUrl.split('?')[0] === '/party-api/status' &&
        req.body?.name === 'E2EMerchant' && (fs.existsSync(path.join(directory, 'hold-merchant-status')) ||
          Array.isArray(req.body.items) && fs.existsSync(path.join(directory, 'hold-merchant-inventory'))))
      return res.status(503).json({error:'Declared E2E merchant status transport hold'});
    next();
  });
};
let version;
const platformDirectory = path.join(directory, 'standalones');
let gameDirectory;
async function assetText(route) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await localFetch(webUrl + route, {
        headers: { Cookie: 'auth=' + auth }, signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw Error('Upstream asset ' + route + ': ' + response.status);
      return await response.text();
    } catch (error) {
      if (attempt === 2) throw new Error('Could not download native asset ' + route, {cause:error});
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
// Lifecycle's fixture add-on hears the coordinator's start, so while its marker exists it joins the
// registry the moment the application creates it, before the start sends `lifecycle.started`. Each heard
// line carries the `lifecycle.state` read at that notice.
const lifecycleHooks = (() => {
  const fixture = () => require('./fixtures/lifecycle-hooks-addon.ts');
  const marker = path.join(directory, 'e2e-lifecycle-hooks.on'), file = path.join(directory, 'e2e-lifecycle-hooks.jsonl');
  const join = hooks => hooks.map().registrations.some(r => r.name === fixture().LIFECYCLE_HOOKS_ADDON) ? { ok: true }
    : hooks.register(fixture().coordinatorRegistration(entry =>
      fs.appendFileSync(file, JSON.stringify({ ...entry, state: hooks.askRow('lifecycle.state', []) ?? null }) + '\n')));
  const heard = since => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(e => e.at >= since) : [];
  let registry;
  Object.defineProperty(globalThis, '__partyHooks', { configurable: true, get: () => registry,
    set(value) { registry = value; if (value && fs.existsSync(marker)) join(value); } });
  return { marker, join, heard };
})();
// The hook fixture add-ons the live coordinator joins on a row's request. Each entry names its fixture module and
// its state; every fixture answers `register` (join once, hooks-fixture-kit.ts registerOnce), `heard`
// (its entries from `since` on) and `ask` (a read an add-on may ask), and `ops` adds the ops its rows
// set answers with. Lifecycle's state is its heard file, so its entry replaces the three defaults.
const answerOps = { answers(state, { answers }) {
  for (const [key, value] of Object.entries(answers || {})) if (value === null) delete state.answers[key]; else state.answers[key] = value;
  return state.answers; } };
const refuseOp = { refuse(state, { refuse }) { state.refuse = refuse || undefined; return { refuse: state.refuse ?? null }; } };
const HOOK_FIXTURES = {
  lifecycle: { ops: {
    register(_state, _body, hooks) { fs.writeFileSync(lifecycleHooks.marker, ''); return lifecycleHooks.join(hooks); },
    heard(_state, { since = 0 }) { return lifecycleHooks.heard(since); },
    off() { fs.rmSync(lifecycleHooks.marker, { force: true }); return { ok: true }; } } },
  status: { module: './fixtures/status-hooks-addon.ts', state: () => ({ heard: [], line: null, task: false }), ops: {
    line(state, { line = null }) { state.line = line; return { ok: true }; },
    task(state, { task = false }) { state.task = !!task; return { ok: true }; },
    // A planted ring save, as the movement owner's records owner sends it.
    notify(_state, { hook, args = [] }, hooks) { hooks.notify(hook, args[0] ?? {}); return { ok: true }; },
    off(state) { state.line = null; state.task = false; return { ok: true }; } } },
  // The movement hooks rows read what the coordinator half saw and ask movement's published reads and walk requests.
  movement: { module: './fixtures/movement-hooks-addon.ts', state: () => ({ seen: [], answers: {} }), ops: { ...answerOps,
    seen(state) { return state.seen; },
    ask(_state, { hook, args = [] }, hooks) { return { answer: hooks.ask(hook, ...args) ?? null }; },
    walks(_state, { hook, args = [] }, hooks) { return { answer: hook === 'walks.end' ? hooks.walks.end(...args) : hooks.walks.holders(...args) }; } } },
  tasks: { module: './fixtures/tasks-hooks-addon.ts', state: () => ({ heard: [], answers: {} }), ops: answerOps },
  survival: { module: './fixtures/survival-hooks-addon.ts', state: () => ({ heard: [] }), ops: refuseOp },
  events: { module: './fixtures/events-hooks-addon.ts', state: () => ({ heard: [] }), ops: refuseOp },
  // `set` names the quest it refuses, the spawn it keeps, the areas it refuses and the patrol order.
  hunting: { module: './fixtures/hunting-hooks-addon.ts', state: () => ({ heard: [] }), ops: {
    set(state, { refuseQuest, keepSpawn, refuseAreas, order }) { Object.assign(state, { refuseQuest, keepSpawn, refuseAreas, order }); return { ok: true }; } } },
  merchant: { module: './fixtures/merchant-hooks-addon.ts', state: () => ({ heard: [], jobs: [] }), ops: {
    jobs(state, { jobs }) { state.jobs.splice(0, state.jobs.length, ...(jobs || [])); return { jobs: state.jobs }; } } },
  items: { module: './fixtures/items-hooks-addon.ts', state: () => ({ heard: [], claims: [], actions: {}, listings: [] }), ops: {
    answers(state, { claims, actions, listings }) {
      if (claims) state.claims.splice(0, state.claims.length, ...claims);
      if (actions) state.actions = actions;
      if (listings) state.listings.splice(0, state.listings.length, ...listings);
      return { claims: state.claims, actions: state.actions, listings: state.listings }; } } },
  // `answers` sets the coordinator half's answers, as e2e/fixtures/targeting-hooks-addon.ts `answer` sets the page's.
  targeting: { module: './fixtures/targeting-hooks-addon.ts', state: () => ({ heard: [], asked: {}, answers: {} }), ops: {
    answers(state, { answers }) { state.answers = answers || {}; return state.answers; } } },
};
const hookFixtureStates = {};
// The ops of one fixture, each taking the request body and the registry and answering the reply.
function hookFixtureOps(name) {
  const entry = HOOK_FIXTURES[name], state = hookFixtureStates[name] ||= entry.state ? entry.state() : {};
  const defaults = entry.module ? {
    register: (_state, _body, hooks) => require('./fixtures/hooks-fixture-kit.ts').registerOnce(hooks, require(entry.module).coordinatorRegistration(state)),
    heard: (_state, { since = 0 }) => state.heard.filter(h => h.at >= since),
    ask: (_state, { hook, args = [] }, hooks) => ({ answer: hooks.askRow(hook, args) ?? null }),
  } : {};
  return Object.fromEntries(Object.entries({ ...defaults, ...entry.ops }).map(([op, run]) => [op, (body, hooks) => run(state, body, hooks)]));
}
async function main() {
  const assetStarted=process.hrtime.bigint();
  const cacheFile=path.join(directory,'native-assets.json');
  const headless=process.env.E2E_ALLOW_HEADLESS==='true';
  const cached=fs.existsSync(cacheFile)?JSON.parse(fs.readFileSync(cacheFile,'utf8')):null;
  const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if(cached){
    if(cached.schema!==1||cached.webUrl!==webUrl||cached.headless!==headless||!Number.isSafeInteger(cached.version)||cached.version<1)
      throw Error('Native asset cache belongs to another scenario configuration');
    for(const [name,hash] of Object.entries(cached.files)){
      if(name!==path.posix.basename(name)||!/^[-a-zA-Z0-9_.]+$/.test(name))throw Error('Invalid native asset cache filename');
      const file=name==='html_vars.js'?path.join(directory,name):path.join(directory,'game_files',String(cached.version),name);
      if(digest(file)!==hash)throw Error('Native asset cache checksum mismatch: '+name);
    }
    if(!cached.files['data.js']||!cached.files['old_common_functions.js']||headless&&(!cached.files['client_scripts.json']||!cached.files['html_vars.js']))
      throw Error('Native asset cache is incomplete');
  }
  const dataSource = cached?fs.readFileSync(path.join(directory,'game_files',String(cached.version),'data.js'),'utf8'):await assetText('/data.js');
  const gameContext = {};
  require('node:vm').runInNewContext(dataSource, gameContext, { timeout: 10000 });
  version = Number(gameContext.G?.version);
  if (!Number.isSafeInteger(version) || version < 1) throw Error('Upstream G.version missing');
  if(cached&&version!==cached.version)throw Error('Native asset cache version mismatch');
  gameDirectory = path.join(directory, 'game_files', String(version));
  fs.mkdirSync(gameDirectory, { recursive: true });
  await account.updateInfo();
  if(!cached){
  fs.writeFileSync(path.join(gameDirectory,'data.js'),dataSource);
  fs.writeFileSync(path.join(gameDirectory,'old_common_functions.js'),await assetText('/js/old_common_functions.js'));
  if (headless) {
    const assets = require('../runtime/lifecycle/coordinator/client-files.cjs');
    const character = encodeURIComponent(account.response.characters[0].name);
    const manifest = {
      game: assets.scripts(await assetText('/character/' + character + '/in/US/I/')),
      runner: assets.scripts(await assetText('/runner'), true),
    };
    const routes = [...new Set([...manifest.game, ...manifest.runner])];
    if (new Set(routes.map(route => path.posix.basename(route))).size !== routes.length)
      throw Error('Native client asset filenames collide');
    for (const route of routes) {
      fs.writeFileSync(path.join(gameDirectory, path.posix.basename(route)), await assetText(route));
    }
    fs.writeFileSync(path.join(gameDirectory, 'client_scripts.json'), JSON.stringify(manifest));
    fs.copyFileSync(path.join(root, '.caracal/html_vars.js'), path.join(directory, 'html_vars.js'));
  }
  const files=Object.fromEntries(fs.readdirSync(gameDirectory).filter(name=>fs.statSync(path.join(gameDirectory,name)).isFile()).map(name=>[name,digest(path.join(gameDirectory,name))]));
  if(headless)files['html_vars.js']=digest(path.join(directory,'html_vars.js'));
  fs.writeFileSync(cacheFile+'.tmp',JSON.stringify({schema:1,webUrl,headless,version,files}));
  fs.renameSync(cacheFile+'.tmp',cacheFile);
  }
  if(headless)process.env.AL_INTERNAL_API_PORT = String(port);
  fs.appendFileSync(path.join(directory,'native-assets-receipts.jsonl'),JSON.stringify({reused:!!cached,version,headless,wallMs:Number(process.hrtime.bigint()-assetStarted)/1e6,files:JSON.parse(fs.readFileSync(cacheFile,'utf8')).files})+'\n');
  // Production paths resolve relative to the launcher and cwd. All writable paths stay disposable.
  fs.mkdirSync(platformDirectory, { recursive: true });
  for (const destination of [path.join(directory, 'CODE/adventure_land')]) {
    fs.mkdirSync(destination, { recursive: true });
    const initialized=path.join(directory,'code-initialized.json');
    if(!fs.existsSync(initialized)){
      fs.cpSync(path.join(root, '.build/game'), destination, { recursive: true });
      for (const file of ['universal-loader.js', 'steam-bridge.js'])
        fs.copyFileSync(path.join(root, '.build/runtime', file), path.join(destination, file));
      fs.writeFileSync(initialized,JSON.stringify({version,manifestSha256:digest(path.join(destination,'manifest.json'))}));
    }
    if(!fs.existsSync(path.join(destination,'manifest.json')))throw Error('Initialized scenario CODE manifest missing');
  }
  process.chdir(directory);
  process.env.AL_SESSION = auth;
  process.env.AL_DATA_DIR = directory;
  let startupError;
  const logger = { log: console.log, info: console.log, warn: console.warn,
    error: (...args) => { startupError = Error(args.map(String).join(' ')); console.error(...args); } };
  const realm = account.response.servers.find(server => server.region === 'US' && server.name === 'I');
  if (!realm) throw Error('Disposable US I realm was not registered');
  const configuredCharacters = Object.fromEntries(account.response.characters.map(character =>
    [character.name, { enabled: false, realm: process.env.E2E_STALE_WORKER_REALM || realm.key, version }]));
  const adapters = {
    '../config': { characters: configuredCharacters, merchant: JSON.parse(process.env.E2E_MERCHANT_DEFAULT || '"E2EMerchant"'), watch_CODE: false, enable_TYPECODE: false,
      web_app: { party_dashboard: true, expose_CODE: true, port } },
    '../account_info': () => account.build(),
    '../game_files': { ensure_latest: async () => version, cull_versions: async () => {},
      available_versions: async () => [version], get_revision: async () => 'local-upstream',
      locate_game_file: resource => path.join(gameDirectory, resource) },
    '../api': api,
    // MOV-157 (e2e/movement-owner-failures.md X.g1.13b): with E2E_UNLOADABLE_GAME_FILES no reader
    // can read the version's old_common_functions.js, which is what a version's game files failing
    // to load means. Movement's preparation (application.ts prepareMovement) then holds no geometry,
    // and the items owner's bank vault read (items/coordinator/storage.ts loadCoordinatorBankVaults) warns and
    // answers no vaults, so the coordinator still starts.
    'node:fs': process.env.E2E_UNLOADABLE_GAME_FILES === '1' ? { ...fs, readFileSync(file, ...args) {
      if (typeof file === 'string' && path.basename(file) === 'old_common_functions.js')
        throw Error('e2e: the game file failed to load: ' + file);
      return fs.readFileSync(file, ...args);
    } } : fs,
    '../src/CONSTANTS': { LOCALSTORAGE_PATH: path.join(directory, 'state.jsonl'),
      LOCALSTORAGE_ROTA_PATH: path.join(directory, 'rotation.jsonl'), STAT_BEAT_INTERVAL: 1000 },
    '../src/LogUtils': { log: logger, console: logger, ctype_to_clid: {} },
    // Browsers own the three actual clients. Fail if a scenario accidentally requests a headless worker.
    'node:child_process': { fork(_file, args, options) {
      if (process.env.E2E_ALLOW_HEADLESS !== 'true') throw Error('Live E2E uses real browser clients; headless launch requested');
      // Exercise the same prepared native runner that the completed candidate deploys.
      const artifact = process.env.E2E_NATIVE_ARTIFACT;
      if (!artifact) throw Error('Verified native candidate required for headless E2E');
      return require('node:child_process').fork(path.join(artifact, '.caracal/src/CharacterThread.js'), args,
        {...options, cwd:directory, env:{...process.env,...options.env,AL_CONSOLE_ARTIFACT:artifact}});
    } },
    'bot-web-interface': function() { throw Error('Legacy monitor is disabled'); },
    '../monitoring_util': {},
    express: fixtureExpress,
  };
  const { startCoordinatorApplication } = require(path.join(root, '.build/runtime/coordinator-application.cjs'));
  await startCoordinatorApplication({ require: name => Object.hasOwn(adapters, name) ? adapters[name] : resolve(name),
    directory: platformDirectory, plannerWorkerFile: path.join(root, '.build/runtime/movement-planner.cjs'), loadFetch: async () => localFetch });
  if (startupError) throw startupError;
  if(!listener)throw Error('Coordinator did not create its native HTTP listener');
  if(!listener.listening)await new Promise((resolve,reject)=>{listener.once('listening',resolve);listener.once('error',reject);});
  const response = await localFetch('http://127.0.0.1:' + port + '/party-api/state?section=core');
  if (!response.ok) throw Error('Coordinator readiness: ' + response.status);
  if (process.send) process.send({ type: 'ready', port,clock:globalThis.__e2eChronalClock });
}
main().catch(error => { console.error(error); process.exit(1); });
