import { RosterConflict, type SteamHandoff, type RosterOwnership } from "./handoff.ts";
import type { SteamGroup } from "./steam-group.ts";
interface BridgePorts {
  now(): number;
  owned(name: string): boolean;
  bridgeChanged(character: string | null): void;
  save(): void;
  codeRunning?(name: string): boolean;
}
/** A bridge lease identifies a window; it never proves a game session is offline. */
export class BridgeSession {
  private lease: { id: string; at: number; version: number } | null = null;
  private readonly state: RosterOwnership;
  private readonly service: SteamHandoff;
  private readonly ports: BridgePorts;
  private group?: SteamGroup;
  constructor(state: RosterOwnership, service: SteamHandoff, ports: BridgePorts, group?: SteamGroup) {
    this.group = group;
    this.state = state; this.service = service; this.ports = ports;
  }
  ready(version = 1): boolean { return !!this.lease && this.lease.version >= version && this.ports.now() - this.lease.at < 8000; }
  private renew(body: Record<string, unknown>): string | null {
    if (typeof body.clientId !== "string" || !body.clientId || body.clientId.length > 100 || ![1,2].includes(Number(body.version)))
      throw new RosterConflict("Unsupported Steam bridge");
    if (this.lease && this.lease.id !== body.clientId && this.ready())
      throw new RosterConflict("Another Steam window currently owns the bridge");
    this.lease = { id: body.clientId, at: this.ports.now(), version: Number(body.version) };
    return typeof body.character === "string" && this.ports.owned(body.character) ? body.character : null;
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
    if (body.version === 2 && this.group && (!this.state.handoff || this.state.handoff.multi || this.state.handoff.phase === "complete")) {
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
        this.state.native = character; this.ports.save();
      }
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
      this.ports.save();
    }
    this.service.expire();
    if (!this.state.handoff || this.state.handoff.phase === "complete") {
      this.state.steam = this.state.native ? [this.state.native] : [];
    }
  }
}
