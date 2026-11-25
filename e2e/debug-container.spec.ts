import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { docker } from '../tools/debug/process';
import { untilRunning } from './debug-running';

test('Docker-hosted console launches and destroys a sibling debug server without host source mounts', async ({ request }, info) => {
  test.setTimeout(1_800_000);
  const host = 'party-debug-host-' + randomBytes(8).toString('hex');
  let url = '', project = '';
  const state = async () => (await request.get(url + '/console-debug')).json();
  const address = async () => {
    const bindings = JSON.parse(await docker(['inspect', '--format', '{{json .NetworkSettings.Ports}}', host]));
    return 'http://127.0.0.1:' + bindings['3010/tcp'][0].HostPort;
  };
  try {
    await docker(['build', '--target', 'production', '-t', host, '.']);
    await docker(['run', '-d', '--name', host, '-v', '/var/run/docker.sock:/var/run/docker.sock', '-p', '127.0.0.1::3010',
      '--entrypoint', 'node', host, 'e2e/debug-container-host.mts']);
    const hostState = JSON.parse(await docker(['inspect', '--format', '{{json .State}}', host]));
    expect(hostState.Running, await docker(['logs', host], { combined: true })).toBe(true);
    url = await address();
    await expect.poll(async () => { try { return (await state()).phase; } catch { return ''; } }).toBe('stopped');
    const start = await request.post(url + '/console-debug/start', { headers: { Origin: url }, data: {} });
    expect(start.ok()).toBe(true);
    project = (await start.json()).project;
    await untilRunning(state);
    const running = await state(); project = running.project;
    expect(running.port).not.toBe(3010);
    const health = await request.get('http://127.0.0.1:' + running.port + '/health');
    expect(health.ok()).toBe(true);
    await docker(['restart', host]);
    // Docker may allocate a new ephemeral host port when a container restarts.
    url = await address();
    await expect.poll(async () => { try { return (await state()).project; } catch { return ''; } }).toBe(project);
    expect((await state()).phase).toBe('running');
    await info.attach('docker-hosted-debug-running', { body: JSON.stringify({ project, port: running.port, health: await health.json() }), contentType: 'application/json' });
    await request.post(url + '/console-debug/stop', { headers: { Origin: url }, data: {} });
    await expect.poll(async () => (await state()).phase, { timeout: 120_000 }).toBe('stopped');
    for (const kind of ['container', 'volume', 'network']) {
      expect(await docker([kind, 'ls', ...(kind === 'container' ? ['-a'] : []), '-q', '--filter', 'label=party-console.debug=' + project])).toBe('');
    }
    await info.attach('docker-hosted-debug-destroyed', { body: JSON.stringify({ project, state: await state() }), contentType: 'application/json' });
  } finally {
    try {
      if (url && project) {
        await request.post(url + '/console-debug/stop', { headers: { Origin: url }, data: {} });
        await expect.poll(async () => (await state()).phase, { timeout: 120_000 }).toBe('stopped');
      }
    } finally {
      if (await docker(['container', 'ls', '-aq', '--filter', 'name=^/' + host + '$'])) {
        await info.attach('docker-debug-host-log', { body: await docker(['logs', host], { combined: true }), contentType: 'text/plain' });
        await docker(['rm', '-f', '-v', host]);
      }
      // A crashed parent cannot perform its own teardown. Only this test's
      // recorded project may be removed by the fallback cleanup.
      if (project) for (const kind of ['container', 'volume', 'network']) {
        const ids = (await docker([kind, 'ls', ...(kind === 'container' ? ['-a'] : []), '-q', '--filter', 'label=party-console.debug=' + project])).split(/\s+/).filter(Boolean);
        if (ids.length) await docker([kind, 'rm', ...(kind === 'container' ? ['-f', '-v'] : []), ...ids]);
      }
      for (const tag of [host, ...(project ? [project + '-console:local', project + '-game:local'] : [])]) {
        if (await docker(['image', 'ls', '-q', tag])) await docker(['image', 'rm', tag]);
      }
    }
  }
});
