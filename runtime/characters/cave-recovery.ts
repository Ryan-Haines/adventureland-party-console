import type { Entity } from "typed-adventureland";
import type { PriestRecoveryAssignment, PriestRecoveryObservation } from "../dungeons/contracts.ts";

type Member = Pick<Entity, "name" | "map" | "in" | "rip" | "hp" | "max_hp" | "c">;
type Receipt = {
  phase: "dispatched" | "reviving" | "uncertain" | "failed" | "complete";
  reason?: string;
  acceptedAt?: number;
};
export type RecoveryLedger = Record<string, Receipt>;
interface Ports {
  now(): number;
  current(): boolean;
  actor(): PriestRecoveryObservation["actor"] & Member;
  cave(): { run: string; paused: boolean } | null;
  target(name: string): Member | null;
  essence(): boolean;
  fighting(): boolean;
  livingNeedsHealing(): boolean;
  healingBusy(): boolean;
  cost(skill: "heal" | "revive"): number;
  reserve(): number;
  inRange(target: Member, skill: "heal" | "revive"): boolean;
  ready(skill: "heal" | "revive", target: Member): boolean;
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
    const next = { ...ledger, [assignment.id]: receipt };
    p.write(next); // Storage must succeed before any consumptive dispatch.
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
    if (p.now() - receivedAt >= 3000 || assignment.priest !== p.actor().name) return null;
    return sameFloorTarget();
  }
  function interrupted(receipt: Receipt) {
    if (receipt.phase === "reviving") return "Revival interrupted; use Nera";
    if (receipt.phase !== "dispatched" || !receipt.acceptedAt || p.cave()?.paused) return;
    if (p.now() - receipt.acceptedAt > 12000) return "Revival did not complete; use Nera";
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
      if (receipt.phase !== "reviving") save({ phase: "reviving" });
      return;
    }
    const failure = interrupted(receipt);
    if (failure) save({ phase: "failed", reason: failure });
  }
  function invalidatePreparation() {
    if (!assignment?.authorized || ledger[assignment.id] || !p.current()) return;
    if (p.cave()?.run !== assignment.run) return;
    if (p.actor().rip) save({ phase: "failed", reason: "Priest has fallen; use Nera" });
    else if (!p.essence()) save({ phase: "failed", reason: "No Essence of Life; use Nera" });
  }
  function resources(target: Member, skill: "heal" | "revive") {
    if (!p.essence()) return "No Essence of Life; use Nera";
    if (p.livingNeedsHealing() || p.healingBusy()) return "Healing living teammates first";
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
  async function acknowledgement(operation: Promise<unknown>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error("Acknowledgement timeout")), 2500);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
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
      if (skill === "revive") save({ phase: "dispatched" });
      await acknowledgement(skill === "heal" ? p.heal(target) : p.revive(target));
      if (skill === "revive" && pending(id)) save({ phase: "dispatched", acceptedAt: p.now() });
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
    return p.fighting() || busy || p.healingBusy() || p.livingNeedsHealing() || !p.essence();
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
Object.assign(globalThis, { installCaveRecovery });
