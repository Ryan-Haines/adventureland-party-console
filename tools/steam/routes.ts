import type { IncomingMessage, ServerResponse } from 'node:http';
import { body, bounded, json, type HostBound } from '../hosting/http.ts';
// The gateway's Steam forwards to a coordinator that does not answer: the action (a handoff's first
// step can wait on the account list) and the roster read before it.
const STEAM_ACTION: HostBound = { name: 'steamActionForwardMs', ms: 60000 };
const STEAM_STATE: HostBound = { name: 'steamStateReadMs', ms: 5000 };
import type { Options } from '../hosting/setup-routes.ts';

/** Called only after gateway browser authorization; bridge traffic never enters here. */
export async function steamAction(req: IncomingMessage, res: ServerResponse, options: Options) {
  const input = await body(req);
  const port = options.apiPort || 924;
  await prepareAction(input, port, options);
  // Forward only after a real bridge lease exists. Original coordinator checks,
  // offline confirmation, bootstrap preparation and arrival fencing stay intact.
  const response = await bounded(STEAM_ACTION, 'a Steam action forward', signal => fetch(`http://127.0.0.1:${port}/party-api/steam/action`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal,
  }));
  json(res, response.status, await response.json());
}
async function prepareAction(input: Record<string, unknown>, port: number, options: Options) {
  if (['primary', 'login'].includes(String(input.action)) && typeof input.character === 'string' && options.steam) {
    await savePreferences(input, options.steam);
    const response = await bounded(STEAM_STATE, 'the Steam roster read', signal => fetch(`http://127.0.0.1:${port}/party-api/state?section=core`, { signal }));
    if (!response.ok) throw Error('Party coordinator is unavailable.');
    const state = await response.json() as { roster?: { name: string }[]; steamSwitch?: { phase: string } };
    if (!state.roster?.some(member => member.name === input.character)) throw Error('Choose an owned character.');
    if (state.steamSwitch && state.steamSwitch.phase !== 'complete') throw Error('Resolve the pending Steam operation first.');
    await options.steam.ensure(input.character);
  }
}
async function savePreferences(input: Record<string, unknown>, steam: NonNullable<Options['steam']>) {
  if (input.clientSetup && typeof input.clientSetup === 'object')
    await steam.preferences.save(input.clientSetup as Record<string, unknown>);
}
export function isSteamAction(url: URL, req: IncomingMessage, bridge: RegExpExecArray | null) {
  return !bridge && url.pathname === '/party-api/steam/action' && req.method === 'POST';
}
