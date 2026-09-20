import { networkInterfaces } from 'node:os';
import type { IncomingMessage } from 'node:http';

/** Keep the browser's reachable host/port; prefer a LAN address for local Windows setup. */
export function setupAddress(req: IncomingMessage, publicUrl?: string,
  interfaces = networkInterfaces(), platform = process.platform): string {
  const address = new URL(publicUrl || `http://${req.headers.host}`);
  if (platform !== 'win32' || !['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)) return address.origin;
  const lan = Object.values(interfaces).flat().find(entry => entry && !entry.internal && entry.family === 'IPv4' &&
    /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address));
  if (lan) address.hostname = lan.address;
  return address.origin;
}
