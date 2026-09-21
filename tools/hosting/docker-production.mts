// Development may run as the checkout owner. Restore the production data owner
// when switching modes, then immediately drop root privileges before hosting.
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
if (process.getuid?.() === 0) {
  await mkdir('/data', { recursive: true });
  const owned = spawnSync('chown', ['-R', 'node:node', '/data'], { stdio: 'inherit' });
  if (owned.error) throw owned.error;
  if (owned.status !== 0) throw new Error('Could not prepare saved data permissions');
  process.execve!('/usr/sbin/gosu', ['gosu', 'node', 'node', 'tools/hosting/start.mts'], process.env as Record<string, string>);
} else {
  await import('./start.mts');
}
