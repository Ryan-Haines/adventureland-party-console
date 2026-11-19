import { request } from 'node:http';
import path from 'node:path';
import { exists } from './files.ts';
import { atomicJson, requiredJson } from '../build-store.ts';
import { DRAIN_READ, HEALTH_READ, Installation, hostHealth, type Driver } from './transaction.ts';
import { bounded, type HostBound } from '../hosting/http.ts';
import type { UpdateAdapter } from './service.ts';
import type { PublishedRelease } from './contracts.ts';

// One Docker Engine call, an image pull included: a daemon that never answers ends here.
const DOCKER_CALL: HostBound = { name: 'dockerCallMs', ms: 600000 };
// Docker's own stop grace (seconds) before it kills the old container; the console's clean shutdown
// runs inside it (tools/hosting/start.mts).
const CONTAINER_STOP_SECONDS = 30;
export async function docker<T>(method: string, route: string, input?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: '/var/run/docker.sock', method, path: `/v1.45${route}`, headers: { 'Content-Type': 'application/json' } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        if ((res.statusCode || 500) >= 400) { reject(new Error(`Docker ${res.statusCode}: ${text.slice(-1000)}`)); return; }
        try { resolve((text ? JSON.parse(text) : {}) as T); }
        catch { // Image pull uses newline-delimited progress objects.
          try { const rows = text.trim().split('\n').map(line => JSON.parse(line)); const failure = rows.find(row => row.error); if (failure) reject(new Error(failure.error)); else resolve(rows as T); }
          catch (error) { reject(error); }
        }
      });
    });
    req.setTimeout(DOCKER_CALL.ms, () => {
      console.warn(`[bound] ${DOCKER_CALL.name} (${DOCKER_CALL.ms} ms) ended Docker ${method} ${route}`);
      req.destroy(new Error('Docker operation timed out'));
    });
    req.on('error', reject); req.end(input === undefined ? undefined : JSON.stringify(input));
  });
}
interface Container {
  Id: string; Name: string;
  Config: { Image: string; Labels: Record<string, string>; Env: string[]; [key: string]: unknown };
  HostConfig: Record<string, unknown>;
  NetworkSettings: { Networks: Record<string, { Aliases?: string[] }> };
}
export class DockerInstallation implements Driver, UpdateAdapter {
  readonly data: string;
  readonly token: string;
  readonly transaction: Installation;
  private container?: Container;
  constructor(data: string, token: string) { this.data = data; this.token = token; this.transaction = new Installation(this, data); }
  async locate() {
    const self = await docker<Container>('GET', `/containers/${process.env.HOSTNAME}/json`);
    const project = self.Config.Labels['com.docker.compose.project'];
    if (!project) throw new Error('Managed Docker updates require the release Compose configuration');
    const filters = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${project}`, 'com.docker.compose.service=party-console'] }));
    const entries = await docker<{ Id: string }[]>('GET', `/containers/json?all=true&filters=${filters}`);
    if (entries.length !== 1) throw new Error('Expected exactly one Party Console container');
    this.container = await docker<Container>('GET', `/containers/${entries[0].Id}/json`);
    await atomicJson(path.join(this.data, 'updates/container.json'), this.container);
    return this.container;
  }
  async current() { return (this.container || await this.locate()).Config.Image; }
  async inspect() {
    const container = this.container || await this.locate();
    const mounts = container.HostConfig.Binds as string[] | undefined;
    if (mounts?.some(bind => /:(\/app|\/app\/[^:]*)(:|$)/.test(bind))) throw new Error('Custom source mounts prevent managed updates. Rebuild your image manually.');
    const changes = await docker<{ Path: string; Kind: number }[]>('GET', `/containers/${container.Id}/changes`);
    if (changes.some(change => /^\/app\/(runtime|tools|scripts|dashboard\/(features|app|lib)|characters\/[^/]+\.js)(\/|$)/.test(change.Path)))
      throw new Error('Local application edits prevent installation; reconcile them first');
  }
  async stage(release: PublishedRelease) {
    await docker('POST', `/images/create?fromImage=${encodeURIComponent(release.image)}`);
    const image = await docker<{ RepoDigests: string[] }>('GET', `/images/${encodeURIComponent(release.image)}/json`);
    if (!image.RepoDigests?.includes(release.image)) throw new Error('Pulled image digest does not match release');
  }
  async install(release: PublishedRelease, startup: boolean) { await this.transaction.install(release.image, startup); }
  async stop() {
    const container = this.container || await this.locate();
    try { await docker('POST', `/containers/${container.Id}/stop?t=${CONTAINER_STOP_SECONDS}`); }
    catch (error) { if (!/Docker (304|404):/.test(String(error))) throw error; }
  }
  async start(image: string) {
    const previous = this.container || await requiredJson<Container>(path.join(this.data, 'updates/container.json'));
    // Retain exactly the existing volume, ports, environment and networks.
    try { await docker('DELETE', `/containers/${previous.Id}`); } catch (error) { if (!String(error).includes('404')) throw error; }
    const endpoints = Object.fromEntries(Object.entries(previous.NetworkSettings.Networks).map(([name, config]) => [name, { Aliases: config.Aliases?.filter(alias => alias !== previous.Id.slice(0, 12)) }]));
    const created = await docker<{ Id: string }>('POST', `/containers/create?name=${encodeURIComponent(previous.Name.replace(/^\//, ''))}`, {
      ...previous.Config, Image: image, Hostname: '', HostConfig: previous.HostConfig, NetworkingConfig: { EndpointsConfig: endpoints },
    });
    this.container = await docker<Container>('GET', `/containers/${created.Id}/json`);
    await atomicJson(path.join(this.data, 'updates/container.json'), this.container);
    await docker('POST', `/containers/${created.Id}/start`);
  }
  async health() {
    const container = this.container || await this.locate();
    // An Engine error during the wait is not the container stopping: the wait asks again (b9b5c91e).
    const running = await docker<{ State?: { Running?: boolean } }>('GET', `/containers/${container.Id}/json`)
      .then(state => state.State?.Running, (error: unknown) => { console.warn('Docker Engine read failed during the update health wait:', String(error)); return undefined; });
    if (running === false) return 'failed' as const;
    return hostHealth(bounded(HEALTH_READ, 'the update health read', signal => fetch('http://party-console:3010/health', { signal })));
  }
  async maintenance() {
    const response = await bounded(DRAIN_READ, 'the update drain read', signal => fetch('http://party-console:3010/console-control/maintenance', { headers: { Authorization: `Bearer ${this.token}` }, signal }));
    if (!response.ok) throw new Error('Coordinator does not support safe updates');
    return await response.json() as { id?: string; ready?: boolean; waiting?: string[]; lost?: string[] };
  }
  async recover() {
    if (await exists(path.join(this.data, 'updates/container.json'))) this.container = await requiredJson<Container>(path.join(this.data, 'updates/container.json'));
    try { await this.locate(); } catch { /* First Compose startup or interrupted replacement; retained config supports recovery. */ }
    await this.transaction.recover();
  }
  async installedVersion() {
    const running = await this.locate();
    const image = await docker<{ Config: { Labels?: Record<string, string> } }>('GET', `/images/${encodeURIComponent(running.Config.Image)}/json`);
    return image.Config.Labels?.['org.opencontainers.image.version'];
  }
}
