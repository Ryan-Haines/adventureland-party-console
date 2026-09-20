import { spawn } from 'node:child_process';
import path from 'node:path';
import { assertUnmodified, readJson } from '../update/files.ts';
import type { Release } from '../update/contracts.ts';
import { delay } from '../update/transaction.ts';
import { run } from '../update/process.ts';
const home = path.resolve(process.argv[2]), root = path.join(home, 'app');
await assertUnmodified(root, (await readJson<Release>(path.join(root, 'release.json'))).files);
const child = spawn(process.execPath, [path.join(root, 'tools/update/agent.mts')], {
  cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, AL_INSTALL_HOME: home, AL_DATA_DIR: path.join(home, 'data'), AL_PORT: '13010', AL_INTERNAL_DASHBOARD_PORT: '13303' },
});
try {
  let healthy = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch('http://127.0.0.1:13010/health')).ok) { healthy = true; break; } } catch { /* starting */ }
    await delay(1000);
  }
  if (!healthy) throw new Error('Clean editable package did not become healthy');
  const page = await fetch('http://127.0.0.1:13010/setup');
  if (!page.ok || !(await page.text()).includes('Party Console')) throw new Error('Setup page missing');
  const update = await (await fetch('http://127.0.0.1:13010/console-update')).json() as { managed?: boolean };
  if (!update.managed) throw new Error('Packaged updater is not connected');
  console.log('Clean package startup passed; no game credentials used.');
} finally {
  if (child.pid) await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], home);
}
