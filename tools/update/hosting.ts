import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Updates } from './service.ts';
import { exists } from './files.ts';
import { requiredJson } from '../build-store.ts';
import type { Release } from './contracts.ts';
import { body, bounded, json, type HostBound } from '../hosting/http.ts';
import { DRAIN_READ } from './transaction.ts';
// An update route forwarded to the updater process (port 925) that never answers.
const UPDATER_FORWARD: HostBound = { name: 'updaterForwardMs', ms: 10000 };
import { consoleVersion } from './version-label.ts';
import { hiddenValue } from '../../runtime/settings/coordinator/api.ts';
import { internalPorts } from '../hosting/health.ts';

export interface UpdateRoutes {
  route(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void>;
  control?(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void>;
  // The startup poll; the host starts without waiting on GitHub, and a caller that reads
  // the first answer awaits this.
  polled?: Promise<void>;
}
export async function updateHosting(root: string, data: string): Promise<UpdateRoutes> {
  const upstream = process.env.AL_UPDATER_URL;
  if (upstream) return {
    async control(req, res, pathname) {
      const token = (await readFile(path.join(data, 'updates/token'), 'utf8')).trim();
      if (req.headers.authorization !== `Bearer ${token}` || req.method !== 'GET' || pathname !== '/console-control/maintenance') {
        json(res, 403, { error: 'Updater authentication required' }); return;
      }
      const response = await bounded(DRAIN_READ, 'the gateway drain read', signal => fetch(`http://127.0.0.1:${internalPorts().api}/party-api/console-maintenance`, { signal }));
      json(res, response.status, await response.json());
    },
    async route(req, res, pathname) {
      const token = (await readFile(path.join(data, 'updates/token'), 'utf8')).trim();
      const payload = req.method === 'POST' ? { body: JSON.stringify(await body(req)) } : {};
      const response = await bounded(UPDATER_FORWARD, 'an update route forward', signal => fetch(new URL(pathname.replace('/console-update', '' ) || '/', upstream), {
        method: req.method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...payload, signal,
      }));
      json(res, response.status, await response.json());
    },
  };
  const release = process.env.AL_DOCKER_DEV !== '1' && await exists(path.join(root, 'release.json')) ? await requiredJson<Release>(path.join(root, 'release.json')) : undefined;
  const config = await requiredJson<{ repository: string }>(path.join(root, 'distribution.json'));
  const updates = new Updates(release, path.join(data, 'updates/preferences.json'), undefined, config.repository);
  // Branch/dirty labels are display metadata; compare the same resolved base
  // version without pretending a source checkout is a managed installation.
  Object.assign(updates.state, await consoleVersion(root, release));
  await updates.load();
  const polled = updates.poll();
  setInterval(() => void updates.poll(), hiddenValue('updateCheckMs')).unref();
  return { polled, route: (req, res, pathname) => updateRoute(updates, req, res, pathname.replace('/console-update', '') || '/') };
}
export async function updateRoute(updates: Updates, req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (pathname === '/' && req.method === 'GET') { json(res, 200, updates.state); return; }
  if (req.method !== 'POST') { json(res, 405, { error: 'POST required' }); return; }
  const input = await body(req);
  if (pathname === '/preferences') { await updates.preference(input.automatic); json(res, 200, updates.state); return; }
  const actions: Record<string, () => Promise<void>> = {
    '/check': () => updates.check(), '/download': () => updates.download(), '/restart': () => updates.restart(),
  };
  if (!actions[pathname]) { json(res, 404, { error: 'Unknown update action' }); return; }
  // The 202 goes out first, so the browser never waits on GitHub; the route settles when its
  // operation does.
  json(res, 202, { accepted: true });
  await actions[pathname]().catch(() => { /* The current operation owns progress; duplicate clicks do not replace it. */ });
}
