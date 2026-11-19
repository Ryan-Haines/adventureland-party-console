import { boundsReported } from '../../status/coordinator/api.ts';
import { RosterConflict, type SteamHandoff, type RosterOwnership, type RosterActor } from "./handoff.ts";
import type { SteamGroup } from "./steam-group.ts";
import { parseObservations, type SteamObservation } from './connection-status.ts';
import { isSteamLogout, recoverSteamLogout } from './logout-recovery.ts';
import { BRIDGE_ID_MAX_LENGTH, BRIDGE_MULTI_VERSION } from '../rules.ts';
import { fresh } from '../../protocol/reports.ts';
import { isRealm } from '../../protocol/realm.ts';
interface BridgePorts {
  observationsChanged?(entries: SteamObservation[]): void;
  now(): number;
  owned(name: string): boolean;
  bridgeChanged(character: string | null): void;
  save(by: RosterActor): void;
  validateParticipants(names: string[]): void;
  codeRunning?(name: string): boolean;
}
function gameSessionId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value || value.length > BRIDGE_ID_MAX_LENGTH)
    throw new RosterConflict('Invalid Steam game session');
  return value;
}
function validateBridge(body: Record<string, unknown>): string {
  if (typeof body.clientId !== 'string' || !body.clientId || body.clientId.length > BRIDGE_ID_MAX_LENGTH || ![1, BRIDGE_MULTI_VERSION].includes(Number(body.version)))
    throw new RosterConflict('Unsupported Steam bridge');
  return body.clientId;
}
/** A bridge lease identifies a window; it never proves a game session is offline. */
export class BridgeSession {
  private character: string | null = null;
  private realm: string | null = null;
  private lease: { id: string; at: number; version: number; sessionId?: string } | null = null;
  private readonly state: RosterOwnership;
  private readonly service: SteamHandoff;
  private readonly ports: BridgePorts;
  private group?: SteamGroup;
  constructor(state: RosterOwnership, service: SteamHandoff, ports: BridgePorts, group?: SteamGroup) {
    this.group = group;
    this.state = state; this.service = service; this.ports = ports;
  }
  // A lease counts while the bridge's last post still counts its window online: the one presence
  // reading (the movement owner's `presence`), which connection-status.ts asks of the same posts.
  ready(version = 1): boolean { return !!this.lease && this.lease.version >= version && fresh(this.lease.at, this.ports.now(), 'presence', 0, true); }
  sessionId(): string | undefined { return this.ready() ? this.lease?.sessionId : undefined; }
  currentRealm(): string | null {
    return this.ready(2) && this.character === this.state.native ? this.realm : null;
  }
  connected(): boolean {
    return this.ready() && !!this.character && this.character === this.state.native
      && !!this.ports.codeRunning?.(this.character);
  }
  private renew(body: Record<string, unknown>): string | null {
    const clientId = validateBridge(body), sessionId = gameSessionId(body.sessionId);
    if (this.lease && this.lease.id !== body.clientId && this.ready() && !this.canReconnect(body))
      throw new RosterConflict("Another Steam window currently owns the bridge");
    this.lease = { id: clientId, at: this.ports.now(), version: Number(body.version), sessionId };
    return typeof body.character === "string" && this.ports.owned(body.character) ? body.character : null;
  }
  private canReconnect(body: Record<string, unknown>): boolean {
    if (this.character || typeof body.character !== 'string' || !this.ports.owned(body.character)) return false;
    if (!Array.isArray(body.running) || !body.running.includes(body.character)) return false;
    const op = this.state.handoff;
    return !op || op.phase === 'complete' || isSteamLogout(op);
  }
  private async acknowledge(body: Record<string, unknown>, character: string | null): Promise<void> {
    const operation = this.state.handoff;
    if (!operation || body.operationId !== operation.id) return;
    if (typeof body.error === "string") this.service.fail(operation.id, body.error);
    if (body.released === true)
      await this.service.released(operation.id, typeof body.from === "string" ? body.from : null);
    if (character && operation.phase === "navigate" && character === operation.target)
      this.service.arrived(operation.id, character);
  }
  async receive(body: Record<string, unknown>): Promise<void> {
    const character = this.renew(body);
    this.ports.observationsChanged?.(parseObservations(body, name => this.ports.owned(name)));
    this.character = character;
    this.realm = character && isRealm(body.realm) ? body.realm : null;
    recoverSteamLogout(this.state, character, body, this.ports);
    // The Steam window's kept bound firings (bridge.ts `boundsFired`) go to the status owner's bound record. A window
    // with no character connected still reports its own, the bridge post's and the slot check's.
    boundsReported(body.boundsFired, character ?? "Steam window");
    if (body.version === BRIDGE_MULTI_VERSION && this.group && (!this.state.handoff || this.state.handoff.multi || this.state.handoff.phase === "complete")) {
      const op = this.state.handoff;
      if (op?.multi && body.operationId === op.id) {
        if (typeof body.error === "string") this.group.fail(op.id, body.error);
        if (body.released === true) await this.group.released(op.id);
      }
      const running = (Array.isArray(body.running) ? body.running : []).filter((n): n is string =>
        typeof n === "string" && this.ports.owned(n) && (!this.ports.codeRunning || this.ports.codeRunning(n)));
      this.group.observe(character, running);
      if ((!op || op.phase === "complete") && character && !this.state.slots.includes(character)) {
        if (!this.state.steam?.includes(character)) this.state.steam = [...(this.state.steam || []), character];
        this.state.native = character; this.ports.save('steam');
      }
      await this.group.refreshRealmChoice();
      this.group.expire();
      return;
    }
    if (this.state.handoff?.multi || (this.state.steam?.length || 0) > 1)
      throw new RosterConflict("Reload the Steam bridge to use multiple characters");
    await this.acknowledge(body, character);
    // Steam can replace its browsing context while navigating. Arrival only
    // confirms an already requested and released session; it starts no worker.
    this.service.reconcileArrival(character);
    const operation = this.state.handoff;
    if ((!operation || operation.phase === "complete") && character && !this.state.slots.includes(character)) {
      this.state.native = character;
      this.ports.bridgeChanged(character);
      this.ports.save('steam');
    }
    this.service.expire();
    if (!this.state.handoff || this.state.handoff.phase === "complete") {
      this.state.steam = this.state.native ? [this.state.native] : [];
    }
  }
}
