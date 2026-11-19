import type { Entity } from "typed-adventureland";
import type { PriestRecoveryAssignment, PriestRecoveryObservation } from "../../hunting/api.ts";
import { ageOf } from "../../protocol/reports.ts";
import { HEALTHY_SHARE } from "./lines.ts";
import { boundFired } from "../../status/api.ts";
import { stepLength } from "../../movement/api/character.ts";

type Member = Pick<Entity, "name" | "map" | "in" | "rip" | "hp" | "max_hp" | "c">;
type Receipt = {
  phase: "dispatched" | "reviving" | "uncertain" | "failed" | "complete";
  reason?: string;
  sentAt?: number;
  acceptedAt?: number;
  // When the target's revival channel ends: its `ms` when this client first saw it.
  endsAt?: number;
};
export type RecoveryLedger = Record<string, Receipt>;
interface Ports {
  now(): number;
  current(): boolean;
  actor(): PriestRecoveryObservation["actor"] & Member;
  cave(): { run: string; paused: boolean } | null;
  target(name: string): Member | null;
  // An assignment is current for two of the coordinator's report gaps.
  assignmentAge(): number;
  // The largest round trip of the last 4 s (the call budget's margin).
  margin(): number;
  essence(): boolean;
  fighting(): boolean;
  livingNeedsHealing(): boolean;
  // The heal's family has a spend in flight (`skills.ready`'s `flying`).
  healFlying(): boolean;
  cost(skill: "heal" | "revive"): number;
  reserve(): number;
  inRange(target: Member, skill: "heal" | "revive"): boolean;
  ready(skill: "heal" | "revive", target: Member): boolean;
  // The two casts are survival's pushes into the turns executor, each settling with the server's
  // reply or the executor's lost-reply rule.
  heal(target: Member): Promise<unknown>;
  revive(target: Member): Promise<unknown>;
  approach(target: Member): void;
  read(): RecoveryLedger;
  write(ledger: RecoveryLedger): void;
}
/** Recovery uses the ordinary priest action slots; no independent combat timer. */
export function installCaveRecovery(p: Ports) {
  let assignment: PriestRecoveryAssignment | undefined,
    receivedAt = 0;
  let busy = false,
    phase: PriestRecoveryObservation["phase"] = "idle",
    reason: string | undefined;
  const ledger = p.read();
  function save(receipt: Receipt) {
    if (!assignment) return;
    // Assignment ids start with the run id. Receipts from earlier runs can
    // never match again, so only the current run's receipts are kept.
    const run = assignment.run + ":";
    const next: RecoveryLedger = { [assignment.id]: receipt };
    for (const [id, entry] of Object.entries(ledger)) if (id.startsWith(run) && id !== assignment.id) next[id] = entry;
    p.write(next); // Storage must succeed before any consumptive dispatch.
    for (const id of Object.keys(ledger)) if (!(id in next)) delete ledger[id];
    Object.assign(ledger, next);
  }
  function sameFloorTarget() {
    if (!assignment || p.cave()?.run !== assignment.run) return null;
    const target = p.target(assignment.target),
      actor = p.actor();
    return target && target.map === actor.map && target.in === actor.in ? target : null;
  }
  function member() {
    if (!assignment || !p.current() || p.actor().rip || p.cave()?.paused) return null;
    if (p.now() - receivedAt >= p.assignmentAge() || assignment.priest !== p.actor().name) return null;
    return sameFloorTarget();
  }
  // The server's revival channel decides (server.js:10423, `c.revival = {ms}`, which every client
  // sees): a revival fails once the channel's `ms` and one margin have passed with the target still
  // dead, and an accepted Revive whose channel this client never saw fails once the channel would
  // have shown, one margin and the cast's own reply time after the acceptance. Each is a kept bound
  // on a game or network failure, named with its wait for the status owner's bound record.
  function interrupted(receipt: Receipt): { reason: string; bound: string; ms: number } | undefined {
    if (receipt.phase === "reviving")
      return p.now() >= (receipt.endsAt ?? 0) + p.margin() ? { reason: "Revival interrupted; use Nera", bound: "caveRevivalChannel", ms: p.margin() } : undefined;
    if (receipt.phase !== "dispatched" || !receipt.acceptedAt || p.cave()?.paused) return;
    const reply = receipt.sentAt ? receipt.acceptedAt - receipt.sentAt : 0, ms = Math.max(p.margin(), reply);
    if (p.now() - receipt.acceptedAt > ms) return { reason: "Revival did not complete; use Nera", bound: "caveRevivalAccepted", ms };
  }
  function reconcile() {
    const target = sameFloorTarget(),
      receipt = assignment && ledger[assignment.id];
    if (!target || !receipt) return;
    if (!target.rip) {
      if (receipt.phase !== "complete") save({ phase: "complete" });
      return;
    }
    if (target.c?.revival) {
      if (receipt.phase !== "reviving") save({ phase: "reviving", endsAt: p.now() + (Number((target.c.revival as { ms?: unknown }).ms) || 0) });
      return;
    }
    const failure = interrupted(receipt);
    if (!failure) return;
    // `ms` is the wait past the channel's end, or past the acceptance.
    boundFired({ bound: failure.bound, owner: "05", state: { id: assignment?.id, ms: failure.ms } });
    save({ phase: "failed", reason: failure.reason });
  }
  function invalidatePreparation() {
    if (!assignment?.authorized || ledger[assignment.id] || !p.current()) return;
    if (p.cave()?.run !== assignment.run) return;
    if (p.actor().rip) save({ phase: "failed", reason: "Priest has fallen; use Nera" });
    else if (!p.essence()) save({ phase: "failed", reason: "No Essence of Life; use Nera" });
  }
  function resources(target: Member, skill: "heal" | "revive") {
    if (!p.essence()) return "No Essence of Life; use Nera";
    if (p.livingNeedsHealing() || p.healFlying()) return "Healing living teammates first";
    if (!p.inRange(target, skill)) return "Waiting to reach fallen teammate";
    if (p.actor().max_mp < p.cost("revive")) return "Not enough maximum MP; use Nera";
    if (p.actor().mp < p.cost(skill) + (p.fighting() ? p.reserve() : 0)) return "Waiting for MP";
    if (!p.ready(skill, target)) return "Waiting for skill cooldown";
  }
  function inspect(): { target: Member; skill: "heal" | "revive" } | null {
    reconcile();
    invalidatePreparation();
    const receipt = assignment && ledger[assignment.id];
    if (receipt) {
      phase = receipt.phase;
      reason = receipt.reason;
      return null;
    }
    phase = assignment ? "waiting" : "idle";
    reason = undefined;
    const target = member();
    if (!target) {
      reason = assignment
        ? "Waiting for fresh cave observations or a reachable teammate"
        : undefined;
      return null;
    }
    return inspectTarget(target);
  }
  function inspectTarget(target: Member): { target: Member; skill: "heal" | "revive" } | null {
    if (!target.rip) {
      phase = "complete";
      return null;
    }
    if (target.c?.revival) {
      phase = "reviving";
      return null;
    }
    const skill = target.hp < target.max_hp ? "heal" : "revive";
    reason = resources(target, skill);
    if (reason) return null;
    phase = skill === "heal" ? "healing" : "ready";
    return { target, skill };
  }
  function reserved() {
    const action = inspect();
    return (
      busy || !!action || reason === "Waiting for MP" || ["dispatched", "uncertain"].includes(phase)
    );
  }
  function pending(id: string) {
    return assignment?.id === id && ledger[id]?.phase === "dispatched";
  }
  function rejected(id: string, error: unknown) {
    if (!pending(id)) return;
    const code = (error as { reason?: string })?.reason;
    const definite = [
      "hp",
      "target_alive",
      "no_mp",
      "no_item",
      "skill_cant_item",
      "cooldown",
      "too_far",
      "disabled",
      "cave_paused",
      "skill_cant_use",
    ].includes(String(code));
    save({
      phase: definite ? "failed" : "uncertain",
      reason: definite
        ? "Revive rejected: " + code + "; use Nera"
        : "Revive outcome unknown; waiting for observation",
    });
  }
  async function dispatch(target: Member, skill: "heal" | "revive", id: string) {
    try {
      const sentAt = p.now();
      if (skill === "revive") save({ phase: "dispatched", sentAt });
      await (skill === "heal" ? p.heal(target) : p.revive(target));
      if (skill === "revive" && pending(id)) save({ phase: "dispatched", sentAt, acceptedAt: p.now() });
    } catch (error) {
      if (skill === "revive") rejected(id, error);
    }
  }
  async function tick() {
    if (busy) return true;
    const action = inspect();
    if (!action) return false;
    if (action.skill === "revive" && !assignment?.authorized) return true;
    busy = true;
    try {
      await dispatch(action.target, action.skill, assignment!.id);
    } finally {
      busy = false;
    }
    return true;
  }
  function movementBlocked() {
    return p.fighting() || busy || p.healFlying() || p.livingNeedsHealing() || !p.essence();
  }
  function move() {
    inspect();
    const target = member();
    if (!target?.rip || movementBlocked()) return false;
    if ((assignment && ledger[assignment.id]) || target.c?.revival) return false;
    const skill = target.hp < target.max_hp ? "heal" : "revive";
    if (p.inRange(target, skill)) return false;
    p.approach(target);
    return true;
  }
  return {
    receive(next?: PriestRecoveryAssignment) {
      assignment = next;
      receivedAt = p.now();
    },
    reserved,
    tick,
    move,
    // The phase, target and reason the last inspect set, read without inspecting again.
    last: () => ({ phase, reason, target: assignment?.target }),
    report(): PriestRecoveryObservation {
      inspect();
      const actor = p.actor();
      return {
        actor: {
          ctype: actor.ctype,
          hp: actor.hp,
          max_hp: actor.max_hp,
          mp: actor.mp,
          max_mp: actor.max_mp,
          c: actor.c,
        },
        essence: p.essence(),
        id: assignment?.id,
        target: assignment?.target,
        phase,
        reason,
      };
    },
  };
}

// What the Cave revival's install reads from shared.js, the character's composition root: the
// runtime, the Cave's members (the hunting owner's `cave.state`) and its target rule (the targeting owner's), and movement's combat
// geometry for the approach step. The casts and readiness are the turns owner's (`skills.ready`, the turns
// executor's push), the margin the call budget's (`calls.margin`).
export interface CaveShared {
  current(): boolean;
  // The Cave's members (the hunting owner's Cave client) and the Cave's fight rule (the targeting owner's `dungeonTargetAllowed`).
  members(): readonly Member[];
  dungeonTarget(entity: unknown): boolean;
  reportGap(): number;
  ready(skill: string): { ready: boolean; flying: boolean; reserve: number };
  push(ask: { skill: string; targets: unknown[]; rank: 'survival'; category: 'survival'; reason: string; by: string }): Promise<unknown>;
  margin(): number;
  cost(skill: string): number;
  approachPoint(target: unknown, range: number): { x: number; y: number };
  safePoint(point: { x: number; y: number }, target: unknown): boolean;
  step(target: unknown, point: { x: number; y: number }, mode: string): void;
  storage(): { getItem(key: string): string | null; setItem(key: string, value: string): void };
  notify(hook: 'survival.reviving', payload: Record<string, unknown>): void;
}
// The Cave revival on this character (b9b5c91e shared.js `caveRecovery` and its ports, E05-a):
// built once, on the first ask, with its journal in localStorage `party-cave-revival:<name>`. Only
// a priest inside a Cave reserves, ticks or moves for it. `survival.reviving` tells each change of
// the revival's phase, which the tick's own inspect sets.
export function createCaveRevival(shared: CaveShared) {
  let client: ReturnType<typeof installCaveRecovery> | null = null, told: string | null = null;
  const own = () => !!(character as { cave?: unknown }).cave && character.ctype === 'priest';
  function revival() {
    if (client) return client;
    const key = 'party-cave-revival:' + character.name;
    client = installCaveRecovery({
      now: Date.now, current: shared.current, actor: () => character as unknown as ReturnType<Ports['actor']>,
      cave: () => (character as { cave?: { run: string; paused: boolean } }).cave || null,
      target: name => { const m = (name === character.name ? character : get_player(name)) as unknown as (Member & { visible?: boolean }) | null; return m && m.visible !== false ? m : null; },
      essence: () => character.items.some(item => !!item && item.name === 'essenceoflife'),
      fighting: () => Object.values((parent as unknown as { entities?: Record<string, unknown> }).entities ?? {}).some(shared.dungeonTarget),
      // A living member below the healthy share is healed first (lines.ts `HEALTHY_SHARE`).
      livingNeedsHealing: () => shared.members().some(m => !m.rip && m.hp < m.max_hp * HEALTHY_SHARE && is_in_range(m as never, 'heal' as never)),
      // The revival's casts are survival's pushes: the heal's family in
      // flight, the reserve and the readiness come from the turns owner (`skills.ready`).
      healFlying: () => shared.ready('heal').flying,
      // An assignment is current for two report gaps, the `walk` reading with no attacker known.
      assignmentAge: () => ageOf({ reading: 'walk', attackerKnown: false, intervalMs: shared.reportGap() }),
      margin: shared.margin, cost: shared.cost,
      reserve: () => shared.ready('revive').reserve,
      inRange: (target, skill) => is_in_range(target as never, skill as never),
      ready: skill => shared.ready(skill).ready,
      heal: target => shared.push({ skill: 'heal', targets: [target], rank: 'survival', category: 'survival', reason: 'Gravestone healing', by: 'core:survival/cave-revival' }),
      revive: target => shared.push({ skill: 'revive', targets: [target], rank: 'survival', category: 'survival', reason: 'Cave revival', by: 'core:survival/cave-revival' }),
      // The approach is a combat step of movement's: movement's recovery step length
      // toward the reach of both casts, the heal's (the priest's range) and the revive's
      // (`G.skills.revive.range`). The server adds the caster's `xrange` past it (node/server.js
      // `isTargetTooFar`), so the edge itself passes.
      approach: target => {
        const range = Math.min(Number(character.range), Number((G.skills.revive as unknown as { range: number }).range));
        const goal = shared.approachPoint(target, Math.max(1, range));
        const length = Math.hypot(goal.x - character.x, goal.y - character.y);
        if (!length) return;
        const fraction = Math.min(1, stepLength(character.speed, 'recovery') / length);
        const point = { x: character.x + (goal.x - character.x) * fraction, y: character.y + (goal.y - character.y) * fraction };
        if (shared.safePoint(point, target)) shared.step(target, point, 'cave-recovery');
      },
      read: () => JSON.parse(shared.storage().getItem(key) || '{}'),
      write: value => { shared.storage().setItem(key, JSON.stringify(value)); },
    });
    return client;
  }
  return {
    reserved: () => own() && revival().reserved(),
    // The tick at today's place in the role loop (`survival.revival`): true when it acted.
    async tick(): Promise<boolean> {
      if (!own()) return false;
      // The tick's own inspect set the phase, so the notice reads it without a second inspect.
      const acted = await revival().tick(), report = revival().last();
      if (report.phase !== told) {
        told = report.phase;
        shared.notify('survival.reviving', { character: character.name, target: report.target ?? null, phase: report.phase, reason: report.reason ?? null, by: 'core:survival/cave-revival' });
      }
      return acted;
    },
    move: () => own() && revival().move(),
    report: () => revival().report(),
    receive: (assignment?: PriestRecoveryAssignment) => revival().receive(assignment),
  };
}
export type CaveRevival = ReturnType<typeof createCaveRevival>;
