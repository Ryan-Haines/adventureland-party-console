import type { ServerResponse } from 'node:http';
// The hosting defaults and checks the gateway, setup, TLS and launcher files share. Each file reads
// them here: a changed default or check changes every reader.

// The public HTTP port (AL_PORT), the HTTPS port (AL_HTTPS_PORT) and the coordinator's port when the
// host names none (runtime/lifecycle/coordinator start.ts listens on 924).
export const DEFAULT_PUBLIC_PORT = 3010, DEFAULT_HTTPS_PORT = 3443, DEFAULT_API_PORT = 924;
export const publicPort = (env: NodeJS.ProcessEnv = process.env) => Number(env.AL_PORT || DEFAULT_PUBLIC_PORT);

// The gateway sends /party-api/ and /CODE/ to the coordinator and every other path to the dashboard.
export const coordinatorPath = (path: string) => /^\/(party-api|CODE)\//.test(path);
export const coordinatorPort = (options: { apiPort?: number }) => options.apiPort || DEFAULT_API_PORT;

// A server origin the setup page accepts: http or https with no credentials, path, query or hash.
export function bareOrigin(value: string, message: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error(message);
  return url;
}

// The private IPv4 LAN ranges; loopback and the IPv6 unique-local range join them for a TLS host.
export const lanIPv4 = (value: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
export const localAddress = (value: string) => value === '::1' || /^(fc|fd)[0-9a-f]{2}:/i.test(value) || value.startsWith('127.') || lanIPv4(value);

// The paired browser's cookie, written by pairing and by the HTTPS setup hand-off.
export function partyCookie(res: ServerResponse, credential: string, secure: boolean) {
  res.setHeader('Set-Cookie', `party=${credential}; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict; Path=/; Max-Age=31536000`);
}
