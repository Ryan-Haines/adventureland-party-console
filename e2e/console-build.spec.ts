import { createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures';
import { ConsoleBuildStore } from '../tools/console-build/store';
import { ConsoleBuildController } from '../tools/console-build/controller';
import { consoleBuildRoutes } from '../tools/console-build/routes';
import type { CandidateManifest } from '../tools/console-build/contracts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

test('reload menu confirms immediate loading and safely deploys the exact selected artifact', async ({page, app}, info) => {
  // External service boundary: the real controller/store/routes run here. Only
  // native process activation is a declared driver; browser requests are genuine.
  const root = info.outputPath('build-host');
  const store = new ConsoleBuildStore(root);
  const ledger: Array<Record<string, unknown>> = [];
  let finish: (() => void) | undefined;
  let finishFight: (() => void) | undefined;
  let rejectActivation = false;
  let rejectRestore = false;
  const controller = new ConsoleBuildController(store, {
    async waitUntilSafe(id) {
      ledger.push({action:'wait-for-combat', id});
      await new Promise<void>(resolve => { finishFight = resolve; });
    },
    async activate(candidate) {
      ledger.push({action: 'activate', buildId: candidate.manifest.id});
      if (rejectActivation) throw new Error('Declared process readiness failure');
      await new Promise<void>(resolve => { finish = resolve; });
    },
    async restore(candidate) {
      ledger.push({action: 'restore', buildId: candidate?.manifest.id});
      if (rejectRestore) throw new Error('Declared rollback readiness failure');
    },
  }, 30_000);
  async function stage(label: string, sequence: number) {
    const directory = path.join(root, 'stage-' + label);
    await mkdir(path.join(directory, 'app'), {recursive: true});
    await writeFile(path.join(directory, 'app', 'artifact.txt'), label);
    const id = hash(label);
    const manifest: CandidateManifest = {schema: 1, id, sourceHash: id,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
      components: {dashboard: id, coordinator: id, characters: id}, files: {'artifact.txt': id}};
    await store.complete(directory, manifest);
    ledger.push({action: 'stage', buildId: id});
    return manifest;
  }
  const a = await stage('A', 1);
  await store.setReferences({active: a.id, latest: a.id});
  const routes = consoleBuildRoutes(controller);
  const upstream = new URL(app.url);
  let documents = 0;
  const server = createServer((req, res) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname.startsWith('/console-build')) {
      ledger.push({action: 'request', method: req.method, pathname});
      void routes.route(req, res, pathname);
      return;
    }
    if (pathname === '/' && req.method === 'GET') documents++;
    const headers = {...req.headers, host: upstream.host};
    delete headers.origin;
    const proxy = httpRequest(new URL(req.url || '/', upstream), {method: req.method, headers}, response => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    });
    proxy.on('error', error => { if (!res.headersSent) res.writeHead(502); res.end(error.message); });
    req.pipe(proxy);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No build host address');
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await expect(page.getByRole('heading', {name: 'Party Console', exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Deploy new console build'})).toHaveCount(0);
    await controller.setBuildState({building: true});
    await expect(page.getByText('Building candidate… Running code unchanged.')).toBeVisible();
    await controller.setBuildState({building: false, error: 'Declared compiler failure'});
    await expect(page.getByRole('alert').filter({hasText: 'Build failed: Declared compiler failure'})).toBeVisible();
    expect((await store.references()).active).toBe(a.id);
    await info.attach('candidate-build-failure', {body: await page.screenshot(), contentType: 'image/png'});
    await controller.setBuildState({building: false});
    const b = await stage('B', 2);
    const refresh = page.getByRole('button', {name: 'Deploy new console build'});
    await expect(refresh).toBeVisible();
    await refresh.click();
    await page.getByRole('button', {name:'Load now',exact:true}).click();
    const dialog = page.getByRole('dialog', {name: 'Load console build now?'});
    await expect(dialog.getByText(/Characters could die while reconnecting/)).toBeVisible();
    await info.attach('immediate-reload-combat-warning',{body:await dialog.screenshot(),contentType:'image/png'});
    await expect(dialog.getByText(b.id, {exact: true})).toHaveCount(2);
    await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
    expect(ledger.filter(entry => entry.action === 'activate')).toHaveLength(0);
    await refresh.click();
    await expect.poll(()=>page.locator('[data-slot="popover-content"]').evaluate(element=>getComputedStyle(element).opacity)).toBe('1');
    await info.attach('reload-options-context-window',{body:await page.screenshot(),contentType:'image/png'});
    const c = await stage('C', 3);
    await page.getByRole('button', {name:'Load when safe',exact:true}).click();
    await expect(refresh).toBeDisabled();
    await expect(page.getByText('Waiting for combat to finish; new targets paused…')).toHaveCount(0);
    await expect.poll(async()=>(await store.journal())?.phase).toBe('waiting-safe');
    expect((await store.journal())?.target).toBe(b.id);
    expect((await store.journal())?.phase).toBe('waiting-safe');
    expect(ledger.filter(entry=>entry.action==='activate')).toHaveLength(0);
    const rotation = await refresh.locator('svg').evaluate(element=>getComputedStyle(element).transform);
    await page.waitForTimeout(150);
    expect(await refresh.locator('svg').evaluate(element=>getComputedStyle(element).transform)).not.toBe(rotation);
    await info.attach('safe-reload-waiting-menu-selection', {body:await page.screenshot(),contentType:'image/png'});
    await page.reload();
    await expect(refresh).toBeDisabled();
    finishFight?.();
    await expect(refresh).toBeDisabled();
    await expect.poll(() => ledger.filter(entry => entry.action === 'activate').length).toBe(1);
    expect(ledger.find(entry => entry.action === 'activate')?.buildId).toBe(b.id);
    expect((await store.references()).active).toBe(a.id);
    expect((await store.references()).latest).toBe(c.id);
    const beforeReload = documents;
    await info.attach('deployment-in-progress', {body: await page.screenshot(), contentType: 'image/png'});
    finish?.();
    await expect.poll(async () => (await store.references()).active).toBe(b.id);
    await expect.poll(() => documents).toBeGreaterThan(beforeReload);
    await expect(refresh).toBeVisible();
    rejectActivation = true;
    await refresh.click();
    await page.getByRole('button', {name:'Load now',exact:true}).click();
    await dialog.getByRole('button', {name: 'Load now', exact: true}).click();
    await expect(page.getByRole('alert').filter({hasText: 'Declared process readiness failure'})).toBeVisible();
    expect((await store.references()).active).toBe(b.id);
    expect(ledger.filter(entry => entry.action === 'restore')).toEqual([{action: 'restore', buildId: b.id}]);
    await info.attach('deployment-rollback-error', {body: await page.screenshot(), contentType: 'image/png'});
    rejectRestore = true;
    await refresh.click();
    await page.getByRole('button', {name:'Load now',exact:true}).click();
    await dialog.getByRole('button', {name: 'Load now', exact: true}).click();
    await expect(page.getByRole('alert').filter({hasText: 'rollback failed: Declared rollback readiness failure'})).toBeVisible();
    await expect(refresh).toBeDisabled();
    await expect(page.getByText('Restoring previous build…')).toHaveCount(0);
    await expect(refresh).toBeDisabled();
    expect((await store.references()).active).toBe(b.id);
    expect((await store.journal())?.phase).toBe('rolling-back');
    await info.attach('deployment-rollback-readiness-failure', {body: await page.screenshot(), contentType: 'image/png'});
    await info.attach('console-build-deployment-ledger', {body: JSON.stringify({ledger, documents, status: await controller.status()}), contentType: 'application/json'});
  } finally {
    finishFight?.();
    finish?.();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
