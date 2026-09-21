import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Updates } from './service.ts';
import { exists, readJson } from './files.ts';
import type { Release } from './contracts.ts';
import { body, json } from '../hosting/http.ts';

export interface UpdateRoutes {
  route(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void>;
  control?(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void>;
}
export async function updateHosting(root: string, data: string): Promise<UpdateRoutes> {
  const upstream = process.env.AL_UPDATER_URL;
  if (upstream) return {
    async control(req, res, pathname) {
      const token = (await readFile(path.join(data, 'updates/token'), 'utf8')).trim();
      if (req.headers.authorization !== `Bearer ${token}` || req.method !== 'GET' || pathname !== '/console-control/maintenance') {
        json(res, 403, { error: 'Updater authentication required' }); return;
      }
      const response = await fetch('http://127.0.0.1:924/party-api/console-maintenance', { signal: AbortSignal.timeout(3000) });
      json(res, response.status, await response.json());
    },
    async route(req, res, pathname) {
      const token = (await readFile(path.join(data, 'updates/token'), 'utf8')).trim();
      const response = await fetch(new URL(pathname.replace('/console-update', '' ) || '/', upstream), {
        method: req.method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(req.method === 'POST' ? { body: JSON.stringify(await body(req)) } : {}), signal: AbortSignal.timeout(10000),
      });
      json(res, response.status, await response.json());
    },
  };
  const release = process.env.AL_DOCKER_DEV !== '1' && await exists(path.join(root, 'release.json')) ? await readJson<Release>(path.join(root, 'release.json')) : undefined;
  const config = await readJson<{ repository: string }>(path.join(root, 'distribution.json'));
  const updates = new Updates(release, path.join(data, 'updates/preferences.json'), undefined, config.repository);
  await updates.load(); void updates.poll();
  setInterval(() => void updates.poll(), 6 * 3600000).unref();
  return { route: (req, res, pathname) => updateRoute(updates, req, res, pathname.replace('/console-update', '') || '/') };
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
  json(res, 202, { accepted: true });
  void actions[pathname]().catch(() => { /* The current operation owns progress; duplicate clicks do not replace it. */ });
}
