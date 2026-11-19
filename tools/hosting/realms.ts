import { bounded, type HostBound } from './http.ts';
// The game site (adventure.land) not answering: the realm list and the account request end here.
export const GAME_SITE: HostBound = { name: 'gameSiteRequestMs', ms: 15000 };
export interface RealmDiscovery {
  realms: string[];
  realmError?: string;
}

/** The public login page publishes X.servers before an account is connected.
 * Parse its JSON data without executing any upstream JavaScript. */
async function discoverRealms(url: string): Promise<string[]> {
  const response = await bounded(GAME_SITE, 'the realm list request', signal => fetch(url, { signal }));
  if (!response.ok) throw Error('Game server list unavailable');
  const assignment = /\bX\.servers\s*=\s*(\[[\s\S]*?\])\s*;/.exec(await response.text());
  if (!assignment) throw Error('Game server list missing');
  const servers: unknown = JSON.parse(assignment[1]!);
  if (!Array.isArray(servers)) throw Error('Invalid game server list');
  const realms = [...new Set<string>(servers.flatMap((server: unknown) => {
    if (!server || typeof server !== 'object' || !('key' in server)) return [];
    return typeof server.key === 'string' && /^SR_[A-Za-z0-9_]+$/.test(server.key) ? [server.key] : [];
  }))];
  if (!realms.length) throw Error('Game server list is empty');
  return realms;
}

/** Start once per gateway; setup requests reuse the settled startup result. */
export async function startupRealms(url = 'https://adventure.land/'): Promise<RealmDiscovery> {
  try { return { realms: await discoverRealms(url) }; }
  catch (error) { return { realms: [], realmError: `Could not load game realms (${(error as Error).message}). Restart Party Console to retry.` }; }
}
