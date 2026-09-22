import type { IncomingMessage } from 'node:http';
import type { Options } from './setup-routes.ts';
export function requestOrigin(req: IncomingMessage, options: Options) {
 return `${options.tls?.trusted(req) ? 'https' : 'http'}://${req.headers.host}`;
}
