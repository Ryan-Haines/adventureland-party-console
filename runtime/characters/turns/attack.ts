import type { CombatState, SharedCombat, Target } from './role-types.ts';
import { errorReason } from "./api.ts";
import type { CoreAsk, SkillWorld, TargetAnswer } from "./api.ts";
import { partyHooks } from "../../hooks/index.ts";

// The attack family's core source: the basic attack, or the ranger's and rogue's attack skill, on the
// character's target, at `damage`. The turns executor owns the family's edge, its one send and the
// reply; this source keeps what the controller decided: the passing admission and the card's attack
// timing. The basic attack's ask carries its context, which `skills.sent` and `skills.settled` carry
// on, so targeting's listener books the queue evidence, `noteAttack` and the crab range rejection, and
// the status owner's rings.ts the handoff notes. The attack gates are targeting's `targeting.allows`,
// which the executor asks before each send. The crab range recovery is targeting's too, and the role
// runner hands one to the controller for its hold. The range sample targeting's module measures and
// the diagnostic the combat state shows, by their shape in the role runner's types, so the controller
// imports nothing of targeting's.
type RangeSample = NonNullable<ReturnType<NonNullable<SharedCombat["targeting"]>["describeAttackRange"]>>;
type RangeDiagnostic = NonNullable<CombatState["rangeRecovery"]>;
export interface RangeRecovery {
  reset(reason?: string): void;
  distance(sample: RangeSample | null, now: number): number | null;
  select(sample: RangeSample | null, now: number): void;
  diagnostic(): RangeDiagnostic | null;
  blocked(sample: RangeSample | null, now: number): boolean;
  reject(sample: RangeSample, rejection: unknown, now: number): void;
}
interface AttackPorts {
  recovery: RangeRecovery;
  // The ranking's attack-family cast on the pass's world (`TurnsView.world`), so it reads the ranking
  // the pass's offense source made (skills/engine.ts `ranked`).
  attackSkill?(target: Target, world: SkillWorld): CoreAsk | null;
  passing?(target: Target): boolean;
  preparePassing?(target: Target): boolean | void;
  equipmentBusy?(): boolean;
  target(): Target | null;
  selected(): string | null;
  active(): boolean;
  state(): CombatState;
  // The source's skip, a `skills.dropped` notice with its reason and the selection it skips.
  dropped(reason: string, selected: string | null): void;
  report(this: void, error: unknown): void;
}
// The attack's cooldown edge on the game client, or null; the card's timing and the status owner's handoff notes read it.
export function attackReadyAt(): number | null {
  const value = Number((parent as unknown as { next_skill?: { attack?: Date } }).next_skill?.attack);
  return Number.isFinite(value) ? value : null;
}
export function createAttackController(ports: AttackPorts) {
  let lastSuccessfulTarget: string | null = null;
  const recovery = ports.recovery;
  // The crab range sample and the target revision are `targeting.target`'s answer. A request reads
  // the pass's answer it is handed; only the reply's check asks again, since the reply comes later.
  const answer = () => partyHooks().turns.target(undefined) as TargetAnswer | undefined;
  const stats = () => ports.state().attackTiming ??= { accepted: 0, cooldownRejections: 0, timeouts: 0, lastOffsets: [] };
  function confirmed(targetId: string, passing: boolean, revision: string | null): boolean {
    const target = ports.target();
    return (!passing || !!target && !!ports.passing?.(target)) && ports.active() && ports.selected() === targetId && !!target &&
      revision === (answer()?.revision ?? null);
  }
  // The basic attack's ask for one pass: its context for the listeners, and what the card's combat
  // state books on the send and the reply.
  function basic(target: Target, passing: boolean, range: RangeSample | null, revision: string | null): CoreAsk {
    let sentAt = 0;
    const current = () => confirmed(target.id, passing, revision);
    return { skill: "attack", targets: [target], rank: "damage", category: "damage", reason: passing ? "passing target" : "basic attack",
      before: () => passing && ports.preparePassing?.(target) === false ? "waiting for passing encounter acknowledgement" : null,
      context: { target, passing, range, current },
      book: {
        sent() {
          sentAt = Date.now();
          const timing = stats();
          timing.lastOffsets = [sentAt - (attackReadyAt() ?? sentAt)];
          ports.state().skippedAttack = null;
          ports.state().stage = "attacking";
        },
        accepted() {
          stats().accepted++;
          if (!current()) return;
          lastSuccessfulTarget = target.id;
          if ((ports.state().errorAt ?? 0) <= sentAt) ports.state().error = null;
        },
        rejected(error) {
          const reason = errorReason(error);
          if (reason === "cooldown") { stats().cooldownRejections++; return; }
          if (reason === "lost reply") { stats().timeouts++; return; }
          if (current()) ports.report(error);
        },
      } };
  }
  return {
    // The attack family's request on this pass's one target answer, or none with the reason
    // in `skippedAttack` and a `skills.dropped` notice. The spend table decided the attack may ask (H8 holds it
    // while the Cave revival holds the priest).
    request(answer: TargetAnswer, world: SkillWorld): CoreAsk | null {
      const target = answer.target, range = target ? (answer.range ?? null) as RangeSample | null : null;
      recovery.select(range, Date.now());
      const skipped = (reason: string) => {
        ports.state().skippedAttack = reason;
        ports.dropped(reason, ports.selected());
        return null;
      };
      if (recovery.blocked(range, Date.now())) return skipped("crab range recovery");
      if (!is_in_range(target)) return skipped("range");
      const passing = answer.passing;
      if (!passing && !ports.equipmentBusy?.()) {
        const alternative = ports.attackSkill?.(target, world);
        if (alternative) {
          ports.state().stage = "skill attack";
          const accepted = alternative.book?.accepted;
          return { ...alternative, book: { ...alternative.book, accepted(result) { accepted?.(result); lastSuccessfulTarget = target.id; } } };
        }
      }
      return basic(target, passing, range, answer.revision ?? null);
    },
    lastTarget: () => lastSuccessfulTarget,
    reset() { lastSuccessfulTarget = null; recovery.reset("runtime reset"); },
  };
}
