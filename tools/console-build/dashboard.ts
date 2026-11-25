import { createServer, request, type ServerResponse, type IncomingMessage } from 'node:http';
import { createServer as portServer } from 'node:net';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { gatewayHeaders, launch, stop } from '../dashboard/api.ts';
import type { Candidate } from './contracts.ts';
import { lifecycleSavedFields } from '../../runtime/lifecycle/fields.ts';
import { waitForHealthy } from '../hosting/process-tree.ts';
import type { HostBound } from '../hosting/http.ts';
// The immutable dashboard's readiness: a candidate dashboard that starts and never serves ends at
// READY, which hosting/process-tree.ts waitForHealthy logs.
const READY: HostBound = { name: 'dashboardReadyMs', ms: 120_000 };

interface Running { candidate: Candidate; port: number; child: ChildProcess }

/** Serves only completed production artifacts. Source compilation belongs to
 * the builder, and readiness precedes the atomic upstream selection. */
export class ImmutableDashboard {
  private active?: Running;
  private previous?: Running;
  private children = new Set<Running>();
  private prepared = new Map<string,Running>();
  private respawnTimer?: ReturnType<typeof setTimeout>;
  private respawnAbort?: AbortController;
  private respawnAttempts = 0;
  private stopped = false;
  private selecting = false;
  private server = createServer((req, res) => this.route(req, res));
  get currentHash(): string | undefined {
    return this.active && this.alive(this.active) ? this.active.candidate.manifest.components.dashboard : undefined;
  }
  get pinnedBuilds(): string[] {
    return [...this.children].filter(value => this.alive(value)).map(value => value.candidate.manifest.id);
  }
  private alive(value: Running) { return value.child.exitCode === null && value.child.signalCode === null && !!value.child.pid; }
  async listen(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const error = (cause: Error) => reject(cause);
      this.server.once('error', error);
      this.server.listen(port, '127.0.0.1', () => { this.server.off('error', error); resolve(); });
    });
  }
  private async port(): Promise<number> {
    const server = portServer();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Cannot allocate dashboard port');
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return address.port;
  }
  async activate(candidate: Candidate, signal: AbortSignal): Promise<void> {
    this.cancelRespawn();
    this.respawnAttempts = 0;
    this.selecting = true;
    try { await this.select(candidate, signal); }
    finally {
      this.selecting = false;
      if (this.active && !this.currentHash) this.scheduleRespawn(this.active);
    }
  }
  async prepare(candidate:Candidate,signal:AbortSignal):Promise<void>{
    if(this.currentHash===candidate.manifest.components.dashboard)return;
    await this.startPrepared(candidate,signal);
  }
  async discardPrepared(){for(const value of this.prepared.values())await this.retire(value);this.prepared.clear();}
  private cancelRespawn() {
    clearTimeout(this.respawnTimer);
    this.respawnTimer = undefined;
    this.respawnAbort?.abort();
    this.respawnAbort = undefined;
  }
  private scheduleRespawn(value: Running) {
    if (this.stopped || this.selecting || this.active !== value || this.respawnTimer || this.respawnAbort) return;
    const { dashboardRespawnMs, dashboardRespawnMaxMs } = lifecycleSavedFields.settings;
    const delay = Math.min(dashboardRespawnMaxMs.default, dashboardRespawnMs.default * 2 ** Math.min(this.respawnAttempts++, 5));
    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = undefined;
      if (this.stopped || this.active !== value) return;
      const controller = new AbortController();
      this.respawnAbort = controller;
      // Restart the selected artifact, never a newer build or live source.
      void this.select(value.candidate, controller.signal).then(() => { this.respawnAttempts = 0; })
        .catch(error => { if (!controller.signal.aborted) console.error('Immutable dashboard recovery failed:', error); })
        .finally(() => {
          if (this.respawnAbort !== controller) return;
          this.respawnAbort = undefined;
          if (!this.currentHash) this.scheduleRespawn(value);
        });
    }, delay);
  }
  private async select(candidate: Candidate, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.stopped) throw new Error('Immutable dashboard is stopped');
    if (this.currentHash === candidate.manifest.components.dashboard) return;
    const next=await this.startPrepared(candidate,signal);
    signal.throwIfAborted();this.prepared.delete(candidate.manifest.components.dashboard);
    await this.handoff(next);
  }
  private async startPrepared(candidate:Candidate,signal:AbortSignal):Promise<Running>{
    const hash=candidate.manifest.components.dashboard,existing=this.prepared.get(hash);
    if(existing&&this.alive(existing))return existing;
    const port = await this.port();
    signal.throwIfAborted();
    const child = launch(path.join(candidate.directory, 'tools/dashboard/node-server.mts'),
      [String(port), path.join(candidate.directory, 'dashboard/.build/container')],
      path.join(candidate.directory, 'dashboard'), {...process.env, NODE_ENV: 'production'});
    const next: Running = {candidate, child, port};
    this.children.add(next);
    child.once('exit', () => this.scheduleRespawn(next));
    try {
      await waitForHealthy(child, `http://127.0.0.1:${port}/`, 'Immutable dashboard', READY, { headers: gatewayHeaders(), signal });
      signal.throwIfAborted();
      this.prepared.set(hash,next);return next;
    } catch (error) { await this.retire(next); throw error; }
  }
  private async handoff(next: Running) {
    const oldActive = this.active;
    const obsolete = oldActive && this.alive(oldActive) ? this.previous : oldActive;
    if (oldActive && this.alive(oldActive)) this.previous = oldActive;
    this.active = next;
    if (obsolete) await this.retire(obsolete);
  }
  private route(req: IncomingMessage, res: ServerResponse) {
    if (new URL(req.url || '/', 'http://localhost').pathname === '/__dashboard/state') {
      res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
      res.end(JSON.stringify({mode: 'production', managedBuilds: true, immutable: false, busy: false, error: null, ready: !!this.currentHash}));
      return;
    }
    const active = this.active;
    if (!active || !this.alive(active)) { res.writeHead(503); res.end('Dashboard unavailable'); return; }
    this.proxy(req, res, active, this.previous);
  }
  private proxy(req: IncomingMessage, res: ServerResponse, target: Running, fallback?: Running) {
    const upstream = request({hostname: '127.0.0.1', port: target.port, path: req.url, method: req.method, headers: req.headers}, response => {
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      // Existing tabs may still ask for hashes from the previous dashboard.
      const staticAsset = pathname.startsWith('/assets/') || pathname.startsWith('/_next/static/');
      if (response.statusCode === 404 && req.method === 'GET' && staticAsset && fallback && this.alive(fallback)) {
        response.resume();
        this.proxy(req, res, fallback);
        return;
      }
      res.writeHead(response.statusCode || 502, {...response.headers,'server-timing':`party_dashboard;desc="${target.candidate.manifest.components.dashboard}"`});
      response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Dashboard upstream unavailable'); });
    res.once('close', () => upstream.destroy());
    if (req.readableEnded) upstream.end(); else req.pipe(upstream);
  }
  private async retire(value: Running) {
    await stop(value.child);
    this.children.delete(value);
  }
  async stop(): Promise<void> {
    this.stopped = true;
    this.cancelRespawn();
    this.active = undefined;
    this.previous = undefined;
    this.prepared.clear();
    this.server.closeAllConnections();
    await Promise.all([...this.children].map(child => this.retire(child)));
    if (this.server.listening) await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
  }
}
