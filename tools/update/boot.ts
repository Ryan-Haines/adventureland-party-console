import { readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import path from 'node:path';
import { exists } from './files.ts';
import { delay } from './transaction.ts';
import { bounded, type HostBound } from '../hosting/http.ts';
import { lifecycleSavedFields } from '../../runtime/lifecycle/fields.ts';
// The boot notice to an updater that accepts the connection and never answers.
const BOOT_NOTICE: HostBound = { name: 'updaterBootMs', ms: 10000 };
export async function notifyBoot(data: string) {
  if (!process.env.AL_UPDATER_URL) return;
  // Existing controllers keep running across container replacements. Every fresh
  // application boot therefore explicitly requests the startup update path.
  const token = (await readFile(path.join(data, 'updates/token'), 'utf8')).trim();
  const response = await bounded(BOOT_NOTICE, 'the boot notice to the updater', signal => fetch(new URL('/boot', process.env.AL_UPDATER_URL), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal }));
  if (!response.ok) throw new Error('Managed updater is unavailable; characters have not started');
}
// The updater binds its port as the installation lock (agent.mts), so a listener on it is the updater
// that wrote the hold.
function updaterListening(url: URL): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect(Number(url.port), url.hostname, () => { socket.end(); resolve(true); });
    socket.on('error', () => resolve(false));
  });
}
// The start waits while the updater installs (updates/hold.json). The wait ends when the hold goes, or
// when the updater that wrote it is gone, so a hold left by an updater that died never blocks the start.
export async function waitForRelease(data: string) {
  const updater = process.env.AL_UPDATER_URL ? new URL(process.env.AL_UPDATER_URL) : null;
  while (await exists(path.join(data, 'updates/hold.json'))) {
    if (updater && !(await updaterListening(updater))) {
      console.warn('The updater that wrote updates/hold.json is gone; the console starts');
      return;
    }
    await delay(lifecycleSavedFields.settings.hostPollMs.default);
  }
}
