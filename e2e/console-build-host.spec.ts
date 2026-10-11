import {test, expect, type TestInfo} from '@playwright/test';
import {createHash, randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdir, readFile, writeFile, readdir, symlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {ConsoleBuildStore} from '../tools/console-build/store';
import {ConsoleBuildController} from '../tools/console-build/controller';
import {createDeploymentDriver, type ActivationPorts} from '../tools/console-build/driver';
import {ImmutableDashboard} from '../tools/console-build/dashboard';
import type {Candidate, CandidateManifest} from '../tools/console-build/contracts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function port() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}
async function stopChild(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await stopped;
}
async function dependencyCache(store: ConsoleBuildStore, label: string) {
  const id = hash('dependencies-' + label), directory = path.join(store.directory, 'dependencies', id);
  const files: Record<string, string> = {};
  for (const component of ['root', 'dashboard', 'caracal']) {
    const name = component + '/node_modules/declared-module.txt';
    await mkdir(path.dirname(path.join(directory, name)), {recursive: true});
    await writeFile(path.join(directory, name), label);
    files[name] = hash(label);
  }
  const packageFile = 'caracal/node_modules/declared-pkg/index.js';
  const packageCode = `module.exports = ${JSON.stringify(label)};`;
  await mkdir(path.dirname(path.join(directory, packageFile)), {recursive: true});
  await writeFile(path.join(directory, packageFile), packageCode);
  files[packageFile] = hash(packageCode);
  await writeFile(path.join(directory, 'complete.json'), JSON.stringify({id, files, manifestHash: hash(JSON.stringify({id, files}))}));
  return {id, directory, label};
}
async function stage(store: ConsoleBuildStore, root: string, label: string, sequence: number, brokenDashboard = false, dependencyId?: string): Promise<Candidate> {
  const directory = path.join(root, 'stage-' + label);
  const dashboard = brokenDashboard ? 'process.exit(23);' : `
    import {createServer} from 'node:http';
    createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/plain','X-Declared-Pid':String(process.pid)});res.end(${JSON.stringify(label)});if(req.url==='/crash')res.once('finish',()=>process.exit(0));}).listen(Number(process.argv[2]),'127.0.0.1');
  `;
  const coordinator = `
    import {createServer} from 'node:http';
    const identity=JSON.parse(process.argv[3]);
    createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({...identity,label:${JSON.stringify(label)},pid:process.pid}));}).listen(Number(process.argv[2]),'127.0.0.1');
  `;
  const content: Record<string, string> = {'tools/dashboard/node-server.mts': dashboard, 'coordinator.mts': coordinator, 'dashboard/.build/container/identity.txt': label,
    'tools/caracal/pinned-native.cjs': await readFile(fileURLToPath(new URL('../tools/caracal/pinned-native.cjs', import.meta.url)), 'utf8')};
  for (const [name, value] of Object.entries(content)) {
    const file = path.join(directory, 'app', name);
    await mkdir(path.dirname(file), {recursive: true});
    await writeFile(file, value);
  }
  if (dependencyId) for (const [name, component] of Object.entries({'node_modules': 'root', 'dashboard/node_modules': 'dashboard', '.caracal/node_modules': 'caracal'})) {
    const target = path.join(directory, 'app', name);
    await mkdir(path.dirname(target), {recursive: true});
    await symlink(path.join(store.directory, 'dependencies', dependencyId, component, 'node_modules'), target, process.platform === 'win32' ? 'junction' : 'dir');
  }
  const id = hash(label);
  const manifest: CandidateManifest = {schema: 1, id, sourceHash: id, dependencyId,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
    components: {dashboard: hash('dashboard-' + label), coordinator: hash('coordinator-' + label), characters: hash('characters-' + label)},
    files: Object.fromEntries(Object.entries(content).map(([name, value]) => [name, hash(value)]))};
  return store.complete(directory, manifest);
}
async function processHost(store: ConsoleBuildStore, info: TestInfo) {
  const dashboard = new ImmutableDashboard(), dashboardPort = await port(), coordinatorPort = await port();
  await dashboard.listen(dashboardPort);
  let coordinator: ChildProcess | undefined;
  const ledger: Record<string, unknown>[] = [];
  const owned: ChildProcess[] = [];
  async function observation() {
    const response = await fetch(`http://127.0.0.1:${coordinatorPort}`, {signal: AbortSignal.timeout(1000)});
    return response.json() as Promise<{artifactId: string; hash: string; characters: Record<string, string>; label: string; pid: number}>;
  }
  const ports: ActivationPorts = {
    async stopCoordinator(signal) { signal.throwIfAborted(); await stopChild(coordinator); coordinator = undefined; },
    async startCoordinator(directory, signal) {
      signal.throwIfAborted();
      const candidate = await store.verify(path.basename(path.dirname(directory)));
      const identity = {artifactId: candidate.manifest.id, hash: candidate.manifest.components.coordinator,
        characters: {DeclaredNativeCharacter: candidate.manifest.components.characters}};
      coordinator = spawn(process.execPath, [path.join(directory, 'coordinator.mts'), String(coordinatorPort), JSON.stringify(identity)], {cwd: directory, stdio: 'pipe', windowsHide: true});
      owned.push(coordinator);
      coordinator.stdout?.on('data', chunk => ledger.push({stdout: String(chunk)}));
      coordinator.stderr?.on('data', chunk => ledger.push({stderr: String(chunk)}));
      ledger.push({action: 'start-coordinator', id: identity.artifactId, pid: coordinator.pid});
    },
    async activateDashboard(directory, signal) {
      const candidate = await store.verify(path.basename(path.dirname(directory)));
      await dashboard.activate(candidate, signal);
      await store.pin(dashboard.pinnedBuilds);
      ledger.push({action: 'dashboard-ready', id: candidate.manifest.id});
    },
    async reloadCharacters(directory, signal) {
      signal.throwIfAborted();
      const candidate = await store.verify(path.basename(path.dirname(directory)));
      return {DeclaredNativeCharacter: candidate.manifest.components.characters};
    },
    async observe(signal) {
      signal.throwIfAborted();
      const observed = await observation().catch(() => undefined);
      return {coordinator: observed, dashboardHash: dashboard.currentHash, characters: observed?.characters || {}};
    },
  };
  const driver = createDeploymentDriver(ports);
  const controller = new ConsoleBuildController(store, driver, 5000);
  return {controller, driver, ledger, dashboardPort, observation,
    async body() { const response = await fetch(`http://127.0.0.1:${dashboardPort}`, {signal: AbortSignal.timeout(2000)}); return response.text(); },
    async dashboardIdentity(route = '/') {
      const response = await fetch(`http://127.0.0.1:${dashboardPort}${route}`, {signal: AbortSignal.timeout(2000)});
      return {pid: response.headers.get('x-declared-pid'), body: await response.text(), status: response.status};
    },
    async stop() {
      await Promise.all(owned.map(stopChild));
      await dashboard.stop();
      await store.pin([]);
      await info.attach('owned-process-ledger', {body: JSON.stringify(ledger), contentType: 'application/json'});
    }};
}
async function terminal(controller: ConsoleBuildController) {
  await expect.poll(async () => (await controller.status()).operation?.phase, {timeout: 15_000}).toMatch(/^(complete|failed)$/);
}

test('immutable console process activation preserves exact selection, rollback and pinned restart', async ({}, info) => {
  // Short owned paths avoid Windows CreateProcess cwd limits for nested releases.
  const root = path.resolve('.build/p79', randomUUID().slice(0, 8)), store = new ConsoleBuildStore(root);
  const a = await stage(store, root, 'process-A', 1), b = await stage(store, root, 'process-B', 2);
  await store.setReferences({active: a.manifest.id, latest: b.manifest.id});
  const state = path.join(root, 'current-account-state.json');
  await writeFile(state, JSON.stringify({currentJob: 'keep-this-job', gold: 1234}));
  const host = await processHost(store, info);
  try {
    await host.driver.activate(a, undefined, AbortSignal.timeout(5000));
    expect(await host.body()).toBe('process-A');
    const accepted = await host.controller.deploy(b.manifest.id);
    const c = await stage(store, root, 'process-C', 3);
    expect(accepted.target).toBe(b.manifest.id);
    await terminal(host.controller);
    expect((await store.references()).active).toBe(b.manifest.id);
    expect((await store.references()).latest).toBe(c.manifest.id);
    expect(await host.body()).toBe('process-B');
    expect((await host.observation()).label).toBe('process-B');
    const broken = await stage(store, root, 'process-broken-dashboard', 4, true);
    await host.controller.deploy(broken.manifest.id);
    await terminal(host.controller);
    expect((await store.journal())?.phase).toBe('failed');
    expect((await store.journal())?.error).toContain('exited before readiness');
    expect((await store.references()).active).toBe(b.manifest.id);
    expect(await host.body()).toBe('process-B');
    expect((await host.observation()).label).toBe('process-B');
    const beforeCrash = await host.dashboardIdentity();
    expect(beforeCrash.pid).toBeTruthy();
    expect((await host.dashboardIdentity('/crash')).body).toBe('process-B');
    await expect.poll(async () => {
      const current = await host.dashboardIdentity();
      return current.status === 200 && current.body === 'process-B' && !!current.pid && current.pid !== beforeCrash.pid;
    }, {timeout: 15_000}).toBe(true);
    const afterCrash = await host.dashboardIdentity();
    expect((await store.references()).active).toBe(b.manifest.id);
    expect((await store.references()).latest).toBe(broken.manifest.id);
    await info.attach('active-dashboard-process-crash-recovery', {body: JSON.stringify({beforeCrash, afterCrash, references: await store.references()}), contentType: 'application/json'});
    expect(JSON.parse(await readFile(state, 'utf8'))).toEqual({currentJob: 'keep-this-job', gold: 1234});
    await info.attach('exact-process-deployment-and-rollback', {body: JSON.stringify({accepted, references: await store.references(), journal: await store.journal(), identity: await host.observation(), state: JSON.parse(await readFile(state, 'utf8'))}), contentType: 'application/json'});
  } finally { await host.stop(); }
  const restarted = await processHost(store, info);
  try {
    const active = await store.verify((await store.references()).active!);
    await restarted.driver.activate(active, undefined, AbortSignal.timeout(5000));
    expect(await restarted.body()).toBe('process-B');
    expect((await restarted.observation()).artifactId).toBe(b.manifest.id);
    await info.attach('pinned-process-restart', {body: JSON.stringify({references: await store.references(), identity: await restarted.observation()}), contentType: 'application/json'});
  } finally { await restarted.stop(); }
});

test('interrupted console deployment recovers prior executable and retention protects live pins', async ({}, info) => {
  const root = path.resolve('.build/p79', randomUUID().slice(0, 8)), store = new ConsoleBuildStore(root);
  const dependencies = await Promise.all(['active', 'previous', 'live', 'new'].map(label => dependencyCache(store, label)));
  const a = await stage(store, root, 'crash-A', 1, false, dependencies[0].id), b = await stage(store, root, 'crash-B', 2, false, dependencies[1].id), c = await stage(store, root, 'crash-C', 3, false, dependencies[2].id);
  await store.setReferences({active: a.manifest.id, previous: b.manifest.id, latest: c.manifest.id});
  const state = path.join(root, 'current-state.json');
  await writeFile(state, JSON.stringify({checkpoint: 'current-after-old-build'}));
  const script = path.join(root, 'crash-controller.mts');
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  await writeFile(script, `
    import {ConsoleBuildStore} from ${JSON.stringify(pathToFileURL(path.join(sourceRoot, 'tools/console-build/store.ts')).href)};
    import {ConsoleBuildController} from ${JSON.stringify(pathToFileURL(path.join(sourceRoot, 'tools/console-build/controller.ts')).href)};
    const store=new ConsoleBuildStore(${JSON.stringify(root)});
    const controller=new ConsoleBuildController(store,{activate:async()=>{await new Promise(()=>{});},restore:async()=>{}},120000);
    await controller.deploy(${JSON.stringify(c.manifest.id)});
    setInterval(()=>{},1000);
  `);
  const crashed = spawn(process.execPath, [script], {cwd: root, stdio: 'pipe', windowsHide: true});
  let output = '';
  crashed.stderr?.on('data', chunk => { output += String(chunk); });
  try {
    await expect.poll(async () => {
      if (crashed.exitCode !== null) throw new Error('Controller process exited: ' + output);
      return (await store.journal())?.phase;
    }).toBe('activating');
  } finally {
    await stopChild(crashed);
    await info.attach('terminated-controller-output', {body: output, contentType: 'text/plain'});
  }
  // A real terminated process supplies the abandoned lock identity.
  await mkdir(path.join(store.directory, 'operation.lock'), {recursive: true});
  await writeFile(path.join(store.directory, 'operation.lock/owner.json'), JSON.stringify({pid: crashed.pid, token: 'terminated-process'}));
  const host = await processHost(store, info);
  try {
    await host.controller.recover();
    expect((await store.journal())?.phase).toBe('failed');
    expect((await store.references()).active).toBe(a.manifest.id);
    expect(await host.body()).toBe('crash-A');
    expect((await host.observation()).artifactId).toBe(a.manifest.id);
    expect(JSON.parse(await readFile(state, 'utf8'))).toEqual({checkpoint: 'current-after-old-build'});
    const candidates = [a, b, c];
    for (let index = 4; index <= 26; index++) candidates.push(await stage(store, root, 'retention-' + index, index, false, dependencies[3].id));
    await store.pin([c.manifest.id]);
    await store.cleanup();
    const retainedPinned = (await store.history()).map(value => value.id);
    expect(retainedPinned).toHaveLength(23);
    expect(retainedPinned).toEqual(expect.arrayContaining([a.manifest.id, b.manifest.id, c.manifest.id, ...candidates.slice(-20).map(value => value.manifest.id)]));
    const dependencyPins = await readdir(path.join(store.directory, 'dependencies'));
    expect(dependencyPins.sort()).toEqual(dependencies.map(value => value.id).sort());
    await store.pin([]);
    await store.cleanup();
    const retainedReleased = (await store.history()).map(value => value.id);
    expect(retainedReleased).toHaveLength(22);
    expect(retainedReleased).not.toContain(c.manifest.id);
    const dependencyReleased = await readdir(path.join(store.directory, 'dependencies'));
    expect(dependencyReleased.sort()).toEqual([dependencies[0].id, dependencies[1].id, dependencies[3].id].sort());
    const latest = candidates.at(-1)!;
    const changedDependency = path.join(dependencies[3].directory, 'root/node_modules/declared-module.txt');
    await writeFile(changedDependency, 'changed-dependency');
    await expect(store.verify(latest.manifest.id)).rejects.toThrow('Artifact file changed');
    await writeFile(changedDependency, dependencies[3].label);
    await writeFile(path.join(latest.directory, 'coordinator.mts'), '// changed executable');
    await expect(store.verify(latest.manifest.id)).rejects.toThrow('Artifact file changed');
    await info.attach('interrupted-controller-retention-evidence', {body: JSON.stringify({terminatedPid: crashed.pid, output, references: await store.references(), journal: await store.journal(), recoveredIdentity: await host.observation(), retainedPinned, retainedReleased, dependencyPins, dependencyReleased, manifests: candidates.map(value => value.manifest)}), contentType: 'application/json'});
  } finally { await host.stop(); }
});

test('managed native preload pins external packages while preserving installed state imports', async ({}, info) => {
  const root = path.resolve('.build/p79', randomUUID().slice(0, 8)), store = new ConsoleBuildStore(root);
  const dependency = await dependencyCache(store, 'selected-artifact-package');
  const candidate = await stage(store, root, 'native-preload-artifact', 1, false, dependency.id);
  const installed = path.join(root, 'native-installed');
  await mkdir(path.join(installed, 'node_modules/declared-pkg'), {recursive: true});
  await writeFile(path.join(installed, 'node_modules/declared-pkg/index.js'), 'module.exports = "unactivated-installed-package";');
  await writeFile(path.join(installed, 'config.cjs'), 'module.exports = { checkpoint: "current-account-checkpoint" };');
  const executable = path.join(installed, 'main.cjs');
  await writeFile(executable, `
    const path = require('node:path');
    console.log(JSON.stringify({external: require('declared-pkg'), absoluteExternal: require(path.join(__dirname,'node_modules/declared-pkg')), state: require('./config.cjs'), builtin: typeof require('node:fs').readFileSync}));
  `);
  const preload = path.join(candidate.directory, 'tools/caracal/pinned-native.cjs');
  const child = spawn(process.execPath, [executable], {cwd: installed, stdio: 'pipe', windowsHide: true,
    env: {...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(AL_|E2E_)/.test(name))),
      NODE_OPTIONS: `--require ${JSON.stringify(preload)}`, AL_CONSOLE_ARTIFACT: candidate.directory, AL_CONSOLE_NATIVE_DIR: installed}});
  let output = '', errors = '';
  child.stdout?.on('data', chunk => { output += String(chunk); });
  child.stderr?.on('data', chunk => { errors += String(chunk); });
  try {
    const exit = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    expect(exit, errors).toBe(0);
    const observed = JSON.parse(output.trim());
    expect(observed).toEqual({external: 'selected-artifact-package', absoluteExternal: 'selected-artifact-package', state: {checkpoint: 'current-account-checkpoint'}, builtin: 'function'});
    await info.attach('pinned-native-package-resolution', {body: JSON.stringify({observed, errors, candidate: candidate.manifest, nativeDirectory: installed, preload}), contentType: 'application/json'});
  } finally { await stopChild(child); }
});
