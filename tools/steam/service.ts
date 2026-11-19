import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { SteamPreferenceStore, assertLocalSteam } from './preferences.ts';
import { findExecutable, gameRunning, launchGame } from './platform.ts';
import { Inspector, InspectorUnavailable, targets, type InspectorTarget } from './inspector.ts';
import { ConsoleBuildStore } from '../console-build/store.ts';
import { bounded, type HostBound } from '../hosting/http.ts';
import { needsSteamBridge } from '../../runtime/lifecycle/roster/connection.ts';
// The Steam window's connection: a game window that never signs in ends the launch at STEAM_CONNECT
// (a bound, logged); the desktop is asked each DESKTOP_POLL_MS and the injected bridge checked each
// BRIDGE_MAINTENANCE_MS (polls: the desktop sends no event); a coordinator that does not answer the
// bridge readiness read ends it at BRIDGE_READY.
const STEAM_CONNECT: HostBound = { name: 'steamConnectMs', ms: 45000 };
const BRIDGE_READY: HostBound = { name: 'steamBridgeReadyMs', ms: 3000 };
const DESKTOP_POLL_MS = 500;
const BRIDGE_MAINTENANCE_MS = 2000;

/** The bridge the desktop injects is the active release's, checked against the release's hash,
 *  as the served CODE loader is; with no release the source tree's bundle runs. */
export async function steamBridgeSource(root: string): Promise<string> {
  const store = new ConsoleBuildStore(root), { active } = await store.references();
  if (!active) return readFile(path.join(root, 'characters/steam-bridge.js'), 'utf8');
  const [manifest, source] = await Promise.all([store.describe(active), readFile(path.join(store.directory, 'releases', active, 'app/characters/steam-bridge.js'), 'utf8')]);
  if (createHash('sha256').update(source).digest('hex') !== manifest.files['characters/steam-bridge.js']) throw Error('Active Steam bridge failed integrity verification.');
  return source;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export interface DesktopPorts {
  platform: NodeJS.Platform;
  targets(): Promise<InspectorTarget[]>;
  executable(): Promise<string>;
  running(executable: string): Promise<boolean>;
  launch(executable: string): Promise<void>;
  connect(target: InspectorTarget): Promise<Pick<Inspector, 'evaluate' | 'close'>>;
  bridgeReady(): Promise<boolean>;
  server(): Promise<string>;
  source(): Promise<string>;
  now(): number;
  sleep(ms: number): Promise<unknown>;
}
/** Only bootstraps the browser bridge. The coordinator still owns every release and login. */
export class LocalSteam {
  readonly preferences: SteamPreferenceStore;
  private ports: DesktopPorts;
  private pending?: Promise<void>;
  private maintenance?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private refused?: string;
  constructor(preferences: SteamPreferenceStore, ports: DesktopPorts) { this.preferences = preferences; this.ports = ports; }
  ensure(character: string): Promise<void> {
    if (this.pending) throw Error('Another Steam client connection is in progress.');
    this.pending = this.prepare(character).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async available() {
    try { return await this.ports.targets(); }
    catch (error) { if (error instanceof InspectorUnavailable) return []; throw error; }
  }
  // The maintenance pass logs each refusal once, until the next pass that attaches.
  private refuse(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (this.refused !== message) console.warn(`Steam bridge maintenance kept the injected bridge: ${message}`);
    this.refused = message;
  }
  private async refreshLocalBridge(character: string) {
    // A ready remote/manual bridge needs no local desktop. Only the explicitly
    // configured local Steam client may be refreshed after a hosting restart.
    try { assertLocalSteam(await this.preferences.read(), this.ports.platform); }
    catch { return; }
    const pages = await this.available();
    if (pages.length !== 1) return;
    const server = await this.ports.server(), source = await this.ports.source();
    if (await this.attach(pages[0], server, source, character)) this.maintain(server);
  }
  private async prepare(character: string) {
    if (await this.ports.bridgeReady()) { await this.refreshLocalBridge(character); return; }
    assertLocalSteam(await this.preferences.read(), this.ports.platform);
    let pages = await this.available();
    if (!pages.length) {
      const executable = await this.ports.executable();
      if (await this.ports.running(executable))
        throw Error('Adventure Land is already running without its automation connection. Close it once, then retry Make Steam primary so Party Console can launch it with automation enabled. Your headless characters have not been stopped.');
      await this.ports.launch(executable);
    }
    const server = await this.ports.server(), source = await this.ports.source();
    const deadline = this.ports.now() + STEAM_CONNECT.ms;
    let attachError = '';
    while (this.ports.now() < deadline && !this.stopped) {
      pages = await this.available();
      if (pages.length > 1) throw Error('Multiple Adventure Land windows are open. Keep the intended Steam window open and close the others before retrying.');
      if (pages[0] && await this.attach(pages[0], server, source, character).catch((error: Error) => { attachError = error.message; return false; })) {
        this.maintain(server);
        if (await this.ports.bridgeReady()) return;
      }
      await this.ports.sleep(DESKTOP_POLL_MS);
    }
    console.warn(`[bound] ${STEAM_CONNECT.name} (${STEAM_CONNECT.ms} ms) ended the Steam window's connection wait`);
    throw Error('Steam client did not connect to Party Console. Sign in to your Adventure Land account in the game, complete setup if requested, then retry. Headless ownership is unchanged.' + (attachError ? ' Last connection error: ' + attachError : ''));
  }
  private async attach(target: InspectorTarget, server: string, source: string, character?: string) {
    const connection = await this.ports.connect(target);
    try {
      // No credentials or account data leave the game page. Selection must expose
      // the owned roster and bootstrap APIs before the coordinator can stop CODE.
      const page = await connection.evaluate(`(() => {
        if (window !== window.top || !window.__TAURI_INTERNALS__ || window.no_html || window.is_bot) return null;
        if (!Array.isArray(window.X?.characters) || typeof window.api_call !== 'function' ||
            typeof window.storage_get !== 'function' || typeof window.storage_set !== 'function') return null;
        if (${JSON.stringify(character || '')} && !window.X.characters.some(c => c.name === ${JSON.stringify(character || '')})) return null;
        const bridge = window.__partySteamBridge;
        return { bridge: bridge ? { version: bridge.version, server: bridge.server } : null };
      })()`) as { bridge: { version?: number; server?: string } | null } | null;
      if (!page) return false;
      // roster/connection.ts needsSteamBridge is the one staleness rule: the CODE loader asks it too,
      // so neither installer replaces the bridge the other one put in place.
      if (!needsSteamBridge(page.bridge ?? undefined, server)) return true;
      return await connection.evaluate(`(() => {
        window.__partyServer = ${JSON.stringify(server)};
        (0, eval)(${JSON.stringify(source)});
        return !!window.__partySteamBridge;
      })()`) === true;
    } finally { connection.close(); }
  }
  private maintain(server: string) {
    if (this.maintenance || this.stopped) return;
    const tick = async () => {
      // Each pass reads the active release's bridge; a refused release or inspector keeps the injected one.
      const ready = await Promise.all([this.ports.source(), this.available()]).catch(error => { this.refuse(error); return undefined; });
      if (ready?.[1].length === 1) {
        const [source, pages] = ready;
        try { await this.attach(pages[0], server, source); this.refused = undefined; }
        catch { /* Navigating destroys the old context; attach to its replacement next pass. */ }
      }
      if (!this.stopped) this.maintenance = setTimeout(() => { this.maintenance = undefined; void tick(); }, BRIDGE_MAINTENANCE_MS);
      this.maintenance?.unref();
    };
    this.maintenance = setTimeout(() => { this.maintenance = undefined; void tick(); }, BRIDGE_MAINTENANCE_MS);
    this.maintenance.unref();
  }
  stop() { this.stopped = true; clearTimeout(this.maintenance); }
}
export function createLocalSteam(root: string, data: string, apiPort: number, server: () => Promise<string>) {
  return new LocalSteam(new SteamPreferenceStore(data), {
    platform: process.platform, targets, executable: findExecutable, running: gameRunning, launch: launchGame,
    connect: target => Inspector.connect(target), server,
    source: () => steamBridgeSource(root), now: Date.now, sleep: delay,
    bridgeReady: async () => {
      const response = await bounded(BRIDGE_READY, 'the Steam bridge readiness read', signal => fetch(`http://127.0.0.1:${apiPort}/party-api/steam/connection`, { signal }));
      if (!response.ok) throw Error('Party coordinator is unavailable.');
      return (await response.json() as { ready?: boolean }).ready === true;
    },
  });
}
