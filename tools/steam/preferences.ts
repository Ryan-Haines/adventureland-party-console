import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { validSteamSetup, type SteamClient, type SteamPlacement } from './clients.ts';

export interface SteamPreferences {
  placement: SteamPlacement;
  client: SteamClient;
}
export function parsePreferences(input: Record<string, unknown>): SteamPreferences {
  if (!validSteamSetup(input))
    throw Error('Choose where Adventure Land runs and which client you use in setup.');
  return { placement: input.placement, client: input.client };
}
export function assertLocalSteam(preferences: SteamPreferences | null, platform: string) {
  if (!preferences) throw Error('Open setup and choose whether Adventure Land and Party Console run on the same computer.');
  if (preferences.placement === 'remote') throw Error('Unable to start Steam client from a different PC. Open Adventure Land and connect its Party Console bridge on that PC.');
  const expected = platform === 'win32' ? 'windows-steam' : platform === 'linux' ? 'linux-steam' : null;
  if (!expected || preferences.client !== expected)
    throw Error('Automatic Steam launch requires the matching Windows or Linux Steam client on this computer. Check setup.');
}
export class SteamPreferenceStore {
  private file: string;
  constructor(data: string) { this.file = path.join(data, 'steam-client.json'); }
  async read(): Promise<SteamPreferences | null> {
    try { return parsePreferences(JSON.parse(await readFile(this.file, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async save(input: Record<string, unknown>) {
    const value = parsePreferences(input);
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + crypto.randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, this.file);
    return value;
  }
}
