import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomBytes, X509Certificate } from 'node:crypto';
import { createServer } from 'node:net';
import { connect, checkServerIdentity } from 'node:tls';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { caddyPath } from './install-caddy.mts';
import { Services } from './services.ts';
import { bounded, type HostBound } from './http.ts';
import { DEFAULT_HTTPS_PORT, publicPort } from './defaults.ts';
import { caddyConfig, certificateProbes, httpsOrigin, tlsHost } from './tls-config.ts';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// The HTTPS setup's bounds against a Caddy process that accepts and never answers: the certificate
// handshake probe and the admin API read, the configuration reload, and the new certificate, which
// Caddy issues with no event, so its readiness is asked each CERTIFICATE_POLL_MS until
// CERTIFICATE_READY. The gateway serves at most MAX_HOSTS HTTPS addresses (a size limit).
const PROBE: HostBound = { name: 'httpsProbeMs', ms: 1500 };
const RELOAD: HostBound = { name: 'httpsReloadMs', ms: 10000 };
const CERTIFICATE_READY: HostBound = { name: 'httpsCertificateMs', ms: 2000 };
const CERTIFICATE_POLL_MS = 200;
const MAX_HOSTS = 20;
export class LocalTLS {
 readonly secret = randomBytes(32).toString('hex');
 readonly port: number;
 readonly publicPort: number;
 private admin = 0;
 private hosts = ['127.0.0.1', 'localhost'];
 private busy = false;
 private error = '';
 private services = new Services();
 private data: string;
 private root: string;
 private upstream: number;
 constructor(root: string, data: string, upstream = publicPort()) {
  this.root = root; this.upstream = upstream;
  this.data = path.join(data, 'tls');
  this.port = Number(process.env.AL_HTTPS_PORT || DEFAULT_HTTPS_PORT);
  this.publicPort = Number(process.env.AL_HTTPS_PUBLIC_PORT || this.port);
  if (![this.port, this.publicPort].every(p => Number.isInteger(p) && p > 0 && p < 65536)) throw new Error('Invalid HTTPS port');
 }
 trusted(req: IncomingMessage) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') && req.headers['x-party-tls'] === this.secret;
 }
 private config() { return caddyConfig(path.join(this.data, 'caddy'), this.hosts, this.port, this.upstream, this.admin, this.secret); }
 async start() {
  try {
   await readFile(caddyPath(this.root));
   await mkdir(this.data, { recursive: true, mode: 0o700 });
   try { this.hosts = JSON.parse(await readFile(path.join(this.data, 'hosts.json'), 'utf8')); } catch { /* first run */ }
   this.admin = await new Promise<number>(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });
   const config = path.join(this.data, 'caddy.json');
   await writeFile(config, JSON.stringify(this.config()), { mode: 0o600 });
   this.services.launchBinary(caddyPath(this.root), ['run', '--config', config], this.root, process.env);
   console.log(`HTTPS: port ${this.publicPort}; open HTTP /setup to trust this console.`);
  } catch (error) { this.error = 'HTTPS unavailable: ' + String(error) + '. Run node tools/hosting/install-caddy.mts and restart.'; console.error(this.error); }
 }
 stop() { this.services.stop(); }
 async certificate() { return readFile(path.join(this.data, 'caddy/pki/authorities/local/root.crt'), 'utf8'); }
 private handshake(probe: ReturnType<typeof certificateProbes>[number], ca: string) {
  return new Promise<void>((resolve, reject) => {
   // Probe locally with the same SNI/no-SNI behavior as browsers.
   // Caddy's admin endpoint and root CA can be ready before leaf issuance finishes.
   const socket = connect({ host: probe.host, port: this.port, servername: probe.servername, ca,
    checkServerIdentity: (_name, cert) => checkServerIdentity(probe.identity, cert),
   }, () => { socket.destroy(); resolve(); });
   socket.setTimeout(PROBE.ms, () => {
    console.warn(`[bound] ${PROBE.name} (${PROBE.ms} ms) ended an HTTPS certificate handshake`);
    socket.destroy(Error('HTTPS certificate handshake timed out'));
   });
   socket.once('error', reject);
  });
 }
 async status() {
  try {
   if (this.error) throw Error(this.error);
   const response = await bounded(PROBE, 'the HTTPS admin read', signal => fetch(`http://127.0.0.1:${this.admin}/config/`, { headers: { Origin: `http://127.0.0.1:${this.admin}` }, signal }));
   if (!response.ok) throw Error('HTTPS service not responding');
   const ca = await this.certificate();
   await Promise.all(certificateProbes(this.hosts).map(probe => this.handshake(probe, ca)));
   const fingerprint = new X509Certificate(ca).fingerprint256;
   return { ready: true, port: this.publicPort, fingerprint, error: '' };
  } catch (error) { return { ready: false, port: this.publicPort, fingerprint: '', error: this.error || 'HTTPS is starting or its port is unavailable: ' + String(error) }; }
 }
 async prepare(origin: string) {
  if (this.busy) throw Error('HTTPS setup is already in progress; retry shortly');
  this.busy = true;
  try {
   const host = await tlsHost(origin);
   const status = await this.status();
   if (!status.ready) throw Error(status.error);
   if (this.hosts.at(-1) !== host) {
    if (!this.hosts.includes(host) && this.hosts.length >= MAX_HOSTS) throw Error('Too many configured HTTPS addresses');
    const previous = this.hosts; this.hosts = [...previous.filter(value => value !== host), host];
    const response = await bounded(RELOAD, 'the HTTPS configuration reload', signal => fetch(`http://127.0.0.1:${this.admin}/load`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${this.admin}` }, body: JSON.stringify(this.config()), signal }));
    if (!response.ok) { this.hosts = previous; throw Error('HTTPS configuration failed; check server logs for port conflicts'); }
    await writeFile(path.join(this.data, 'hosts.json'), JSON.stringify(this.hosts), { mode: 0o600 });
    await writeFile(path.join(this.data, 'caddy.json.tmp'), JSON.stringify(this.config()), { mode: 0o600 });
    await rename(path.join(this.data, 'caddy.json.tmp'), path.join(this.data, 'caddy.json'));
   }
   for (const until = Date.now() + CERTIFICATE_READY.ms; Date.now() < until; await delay(CERTIFICATE_POLL_MS)) {
    const status = await this.status(); if (status.ready) return { ...status, origin: httpsOrigin(host, this.publicPort) };
   }
   console.warn(`[bound] ${CERTIFICATE_READY.name} (${CERTIFICATE_READY.ms} ms) ended the HTTPS certificate wait`);
   throw Error(`HTTPS certificate is not ready after ${CERTIFICATE_READY.ms} ms; retry shortly`);
  } finally { this.busy = false; }
 }
}
