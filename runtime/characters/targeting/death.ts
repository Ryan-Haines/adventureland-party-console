// The targeting owner's death listeners: a lethal `disappear`, an `entities` tombstone in this instance,
// a `death` packet for another entity and a killing `hit` each release the monster's id with one
// `reportFightDeath` (shared.js 14132), then reset the role runner's target when the runner is loaded.
// One report per packet fixes T7: b9b5c91e's `death` listener reported the death twice. shared.js
// installs the listeners at load, where b9b5c91e registered its own.
import type { TargetingPorts } from './install.ts';

export interface TargetingDeathPorts {
  self(): string;
  instance(): unknown;
  // shared.js `reportFightDeath` and the runner's `invalidateTarget`, when the runner is loaded.
  report(id: string): void;
  invalidate(id: string): void;
  // The entities observation stamp. The status owner's telemetry records the fight packets itself.
  entitiesSeen(): void;
}
type Packet = { id?: string; name?: string; death?: boolean; kill?: boolean; dead?: boolean; reason?: string; in?: unknown; monsters?: { id?: string; dead?: boolean; hp?: number }[] } | null | undefined;
export function createTargetingDeath(p: TargetingDeathPorts) {
  const release = (id: string) => { p.report(id); p.invalidate(id); };
  return {
    disappear(data: Packet): void {
      if (data && data.id && (data.death === true || data.reason === 'death' || data.reason === 'dead')) release(data.id);
    },
    entities(data: Packet): void {
      if (!data || data.in !== p.instance() || !Array.isArray(data.monsters)) return;
      p.entitiesSeen();
      for (const e of data.monsters) if (e && e.id && (e.dead === true || e.hp === 0)) release(e.id);
    },
    death(data: Packet): void {
      if (data && data.id && data.id !== p.self()) release(data.id);
    },
    // shared.js's hit readers hand each `hit` here in their order, so a kill is released here too.
    hit(data: Packet): void {
      if (data && data.id && (data.kill || data.dead)) release(data.id);
    },
  };
}
// The listeners record which monsters died, so they register through targeting's run scope handle as
// `observe`: they keep the known-dead ids current through a Pause,
// and the generation's stop removes them with every other registration.
type Listener = (data: Packet) => void;
interface Scope { on(target: unknown, event: string, listener: Listener): void }
export function installTargetingDeath(scope: Scope, socket: unknown, ports: TargetingDeathPorts): ReturnType<typeof createTargetingDeath> {
  const listeners = createTargetingDeath(ports);
  scope.on(socket, 'disappear', data => listeners.disappear(data));
  scope.on(socket, 'entities', data => listeners.entities(data));
  scope.on(socket, 'death', data => listeners.death(data));
  return listeners;
}

// The death listeners' two acts on the character, moved from shared.js's install ports
//: the role runner's target reset when the runner is loaded, and the time the client
// last saw the entities, on the coordinator's clock.
export function createDeathActs(p: TargetingPorts) {
  function invalidate(id: string) { if (p.root.partyRoleRunner) p.root.partyRoleRunner.invalidateTarget(id); }
  function entitiesSeen() { p.root.__partyEntitiesObservedAt = Date.now() + p.walkState.clockOffset; }
  return { invalidate, entitiesSeen };
}
