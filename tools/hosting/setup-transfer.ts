import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from './setup-routes.ts';
import { body } from './http.ts';
import { requestOrigin } from './request-origin.ts';
type Transfer = { until: number; source: string; target: string; pairing: boolean; location: string };
const pending = new WeakMap<Options, Map<string, Transfer>>();
export async function transfer(req: IncomingMessage, options: Options, input: Record<string, unknown>) {
 if (!options.tls) throw Error('HTTPS is not installed');
 const { origin } = await options.tls.prepare(String(input.origin));
 let entries = pending.get(options); if (!entries) { entries = new Map(); pending.set(options, entries); }
 for (const [key, entry] of entries) if (entry.until < Date.now()) entries.delete(key);
 if (entries.size >= 100) throw Error('Too many pending connection checks');
 const ticket = randomBytes(32).toString('hex');
 const query = new URLSearchParams({ placement: String(input.placement), client: String(input.client), https: '1' });
 entries.set(ticket, { until: Date.now() + 120000, source: requestOrigin(req, options), target: origin,
  pairing: options.access.required, location: '/setup?' + query });
 return { ticket, action: origin + '/setup/continue' };
}
function validTransfer(req: IncomingMessage, options: Options, entry: Transfer | undefined): entry is Transfer {
 return !!entry && entry.until >= Date.now() && req.headers.origin === entry.source && requestOrigin(req, options) === entry.target && !!options.tls?.trusted(req);
}
export async function acceptTransfer(req: IncomingMessage, res: ServerResponse, options: Options) {
 const ticket = String((await body(req)).ticket); const entries = pending.get(options), entry = entries?.get(ticket);
 if (!validTransfer(req, options, entry))
  throw Error('Secure setup check expired or came from a different address; return to HTTP setup and retry');
 entries!.delete(ticket);
 if (options.access.required && !entry.pairing) throw Error('Browser pairing was enabled; pair this browser and retry');
 if (entry.pairing && options.access.required) {
  const credential = await options.access.browserCredential();
  res.setHeader('Set-Cookie', `party=${credential}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=31536000`);
 }
 res.writeHead(303, { Location: entry.location }); res.end();
}
