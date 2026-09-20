import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { exists } from './files.ts';
import { delay } from './transaction.ts';
export async function notifyBoot(data: string) {
  if (!process.env.AL_UPDATER_URL) return;
  // Existing controllers keep running across container replacements. Every fresh
  // application boot therefore explicitly requests the startup update path.
  const token = (await readFile(path.join(data, 'updates/token'), 'utf8')).trim();
  const response = await fetch(new URL('/boot', process.env.AL_UPDATER_URL), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Managed updater is unavailable; characters have not started');
}
export async function waitForRelease(data: string) {
  while (await exists(path.join(data, 'updates/hold.json'))) await delay(500);
}
