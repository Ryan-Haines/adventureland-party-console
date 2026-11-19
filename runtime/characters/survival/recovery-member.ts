// The member's death recovery: the respawn, then the group task's next activity, the event rejoin on movement's
// ladder, and the farm return. `createDeathRecovery` is the recovery's step, which install.ts `start` runs on the
// signals the recovery waits for; `createRecoveryMovement` is the recovery's walk identity, ladder and hold, which
// shared.js's event rejoin (the events owner's body) and the farm reunion read from load.
import type { CombatState } from '../turns/api.ts';
import type { SurvivalNotice } from "../../hooks/registry.ts";
import { rejoinRound } from "../../protocol/ladder.ts";
import { errorReason } from "../turns/api.ts";
import { respawnLabel, respawnRuns } from "./records.ts";
import type { Closeness, OwnerLadder } from "../../protocol/ladder.ts";
import type { Point } from "../../movement/api/character.ts";

export type EventRejoinOutcome = { status: "not-applicable" | "recovered" | "retryable" | "cancelled"; phase?: "event-reentry" | "event-travel"; reason?: string;
  // Where the try left the character and how close its last journey got (the owner ladder's progress test).
  progress?: { at: Point; planned?: Closeness; remaining?: Closeness } };
// The heartbeat's `task` (runtime/coordinator/status/assignment.ts) and when that heartbeat completed.
// GT2: `apart` names a left-out member's choice while its group attends an event without it.
export interface TaskAnswer { task: { kind: string; owner: string; event?: string; apart?: "wait" | "farm" } | null; at: number }
// The group tasks whose member returns to the saved farm point or the Hunt after a respawn
// (01 design 2.1): the Hunt's tasks and farming.
const FARM_RETURN = new Set(["farming", "hunt-mission", "hunt-turn-in"]);
interface RecoveryPorts {
  // The character's name, which `survival.memberRecovery` names.
  name(): string;
  isDead(): boolean;
  blocked?(): boolean;
  respawn(): Promise<unknown>;
  publish(state: CombatState): void;
  rejoinEvent(rung: string): Promise<EventRejoinOutcome>;
  log(message: string): void;
  // Resolves on the next completed heartbeat: a failed step waits for it.
  nextReport(): Promise<void>;
  task(): TaskAnswer | null;
  // The farm or Hunt return: false while nothing can move the member yet.
  returnToFarm(): boolean;
  // The navigation revision: a player command changes it and ends the recovery.
  revision(): number;
  position(): Point;
  // The movement owner's ladder for this recovery's way back to `event` (step 8a, design
  // § 3.2): the rejoin round, or the join round of a join event.
  climb(event: string, join: boolean): OwnerLadder;
  // Holds the character as this death recovery until two report intervals pass (design
  // § 3.2 invariant 2), between rungs and while it waits for a report.
  hold(): void;
  // Releases the hold and ends the climb.
  done(): void;
  // A join event has no walk of its own; its server join is the only way in.
  joinEvent(name: string): boolean;
  // The event rejoin mark (the events owner's K3 mark, `rejoinPending()`): the event this member
  // must return to, or null.
  rejoinMark?(): unknown;
  // `survival.memberRecovery` at each change of the recovery's stage.
  notify?(hook: SurvivalNotice, payload: Record<string, unknown>): void;
  // Asks for one more step once the current one ends (install.ts `wake`).
  wake?(): void;
  // Asks for a step at `at`, the time a respawn's `not-now` names for the next ask.
  wakeAt?(at: number): void;
}

/** The character reading alive completes the respawn phase. */
export function createDeathRecovery(ports: RecoveryPorts): () => Promise<void> {
  let recovering = false, pendingReturn = false, revived = false, attempt = 0, retryAt = 0;
  let phase = "respawn", lastError: string | null = null, errorAt: number | null = null;
  // An answer counts only from a heartbeat completed after `askAfter`.
  let askAfter = 0, revision: number | undefined, trying: string | null = null;
  let answer: string | null = null, answeredAt: number | null = null;
  let ladder: { event: string; steps: OwnerLadder } | null = null;
  // The rejoin mark this recovery already started from, so a recovery that finished with the mark
  // still set does not start again from it.
  let markStarted: unknown = null, told: string | null = null;
  const publish = (stage: string, error: string | null = null) => {
    if (error) { lastError = error; errorAt = Date.now(); }
    // The recovery carries its card words while it runs (the status owner's table L1).
    const label = respawnRuns(stage) ? respawnLabel(phase, trying) : null;
    if (stage !== told) { told = stage; ports.notify?.("survival.memberRecovery", { character: ports.name(), stage, phase, trying, label, by: "core:survival" }); }
    ports.publish({ at: Date.now(), stage, error, label, recovery: {
      phase, attempt, lastError, errorAt, status: stage, at: Date.now(),
      recoveredAt: stage === "recovery-complete" ? Date.now() : null,
      trying, answer, answeredAt,
    } });
  };
  // The respawn asks survival's one respawn (`survival.respawn`), which
  // settles on the server's reply. It answers `not-now` with the time the next ask can go: the end
  // of the server's `rip_time` wait (a `cant_respawn` reply's `ms`) or of the survival band's margin.
  // The step asks again then. A respawn in flight names no later time; its reply settles it.
  async function spawn() {
    phase = "respawn";
    try {
      const sent = ports.respawn();
      attempt++; publish("respawning");
      await sent;
    } catch (error) {
      if (errorReason(error) !== "not-now") throw error;
      const at = Number((error as { retryAt?: unknown } | null)?.retryAt);
      if (at > Date.now()) ports.wakeAt?.(at);
      publish("respawn-waiting", "No alive confirmation yet");
      return;
    }
    if (ports.isDead()) publish("respawn-waiting", "No alive confirmation yet");
  }
  function finished(status: "recovery-complete" | "recovery-cancelled") {
    pendingReturn = false; ladder = null; trying = null;
    ports.done();
    publish(status);
  }
  // Waits for a heartbeat completed from now on, holding the character meanwhile.
  function askAgain(stage: string, error: string | null = null) {
    askAfter = Date.now(); trying = "waiting for the next report, then asking the group task";
    ports.hold(); publish(stage, error);
  }
  async function returnToActivity() {
    if (!revived) { revived = true; askAfter = Date.now(); publish("respawned"); }
    return followTask();
  }
  // Step 7: the
  // respawn asks the group task what this member does now and goes there. An event that
  // ended is no outcome of its own: the next answer names the next activity.
  async function followTask() {
    if (revision !== undefined && ports.revision() !== revision) { phase = "player-command"; return finished("recovery-cancelled"); }
    const reply = ports.task();
    if (!reply || reply.at <= askAfter) {
      trying = "waiting for the next report, then asking the group task"; ports.hold(); publish("recovery-waiting"); return;
    }
    answer = reply.task?.kind ?? "idle"; answeredAt = reply.at;
    const task = reply.task;
    if (task?.kind !== "event-attendance" || !task.event) {
      ladder = null;
      // The farm return walks to the location the coordinator names for the current
      // policy (heartbeat `partyLocation`), so Hunt stays Hunt and farming stays farming.
      // A member left out of its group's event farms alone only when GT2's setting says so and
      // the fight is winnable; otherwise it waits in Main, where it respawned.
      if (task && (FARM_RETURN.has(task.kind) || task.apart === "farm")) {
        phase = "farm-return"; trying = "returning to the " + (task.kind.startsWith("hunt") ? "hunt" : "farm");
        // The farm return walks as its own request, which this recovery's hold would outrank.
        ports.done();
        if (!ports.returnToFarm()) return askAgain("recovery-waiting");
      } else phase = task?.apart === "wait" ? "event-apart" : task?.kind ?? "idle";
      // An escape and an event return have their own owners, which move the member.
      return finished("recovery-complete");
    }
    if (ladder?.event !== task.event) ladder = { event: task.event, steps: ports.climb(task.event, ports.joinEvent(task.event)) };
    const step = ladder.steps.next(ports.position());
    trying = step.trying; phase = "event-reentry";
    if (step.rung === "wait") { askAfter = Date.now(); ladder.steps.waited(); ports.hold(); publish("recovery-waiting"); return; }
    publish("recovery-try");
    const result = await ports.rejoinEvent(step.rung);
    phase = result.phase || phase;
    if (result.status === "recovered") return finished("recovery-complete");
    // The event ended, a final join refusal ended the round, or its selection changed:
    // the next fresh answer names what to do now.
    if (result.status !== "retryable") {
      ladder = null; ports.done();
      return askAgain("recovery-ask", result.reason || null);
    }
    const outcome = ladder.steps.result({ arrived: false, ...(result.progress ?? { at: ports.position() }) });
    // The next rung starts on the next report's step; the hold covers the character until then.
    ports.hold();
    publish(outcome === "failed" ? "recovery-retry" : "recovery-try", outcome === "failed" ? result.reason || "Event recovery pending" : null);
  }
  function begin() {
    attempt = 0; lastError = null; errorAt = null; retryAt = 0;
    ladder = null; trying = null; answer = null; answeredAt = null; revision = ports.revision();
  }
  // A death starts the recovery, and so does the event rejoin mark on a living member this runtime
  // never saw dead: CODE that resumes after a native revival during an event still
  // walks the member back into it, with the attempt state reset as on a new death.
  function observeDeath() {
    const mark = ports.rejoinMark?.() ?? null;
    if (ports.isDead()) {
      if (!pendingReturn || revived) begin();
      pendingReturn = true; revived = false;
    } else if (mark && !pendingReturn && mark !== markStarted) {
      begin();
      pendingReturn = true; revived = false;
    }
    if (!mark) markStarted = null;
    else if (pendingReturn) markStarted = mark;
  }
  return async () => {
    if (ports.blocked?.()) return;
    observeDeath();
    if (!pendingReturn || recovering || Date.now() < retryAt) return;
    recovering = true;
    try {
      if (ports.isDead()) await spawn();
      if (!ports.isDead() && !ports.blocked?.()) await returnToActivity();
    } catch (error) {
      const reason = errorReason(error);
      publish("recovery-retry", reason);
      if (reason !== "cant_respawn" && reason !== "cooldown" && reason !== "lost reply")
        ports.log((phase === "respawn" ? "Respawn failed" : phase + " failed") + ": " + reason);
      // A respawn the server refused inside its wait, or whose reply was lost, asks again in the
      // next step, where survival answers `not-now` until the server's `ms` has passed (3.5).
      // Any other failure takes the report-driven wait rung: the next step waits for the next
      // heartbeat, not a fixed second.
      if (phase === "respawn" && (reason === "cant_respawn" || reason === "lost reply")) { retryAt = 0; ports.wake?.(); }
      else {
        retryAt = Infinity;
        void ports.nextReport().then(() => { retryAt = 0; ports.wake?.(); });
      }
    } finally { recovering = false; }
  };
}

// What the recovery's movement reads from shared.js: movement's service, its timed requests and
// idle hold, and the last death's time (the status owner's `lastDeathInfo`, runtime/status/character/telemetry.ts), which names each death's own
// identity.
interface RecoveryMovementPorts {
  character(): { name: string; map: string; in?: string; real_x?: number; real_y?: number };
  movement(): { climb(owner: string, round: unknown, activity: string): OwnerLadder; release(owner: string): void; endClimb(owner: string): void;
    last(): { transitions?: unknown; walkingDistance?: unknown; remaining?: unknown } | null | undefined };
  holdIdle(request: { kind: string; owner: string }): void;
  deathAt(): unknown;
}
// Steps 7 and 8a: the respawned member's own walks and holds are
// `death-recovery` requests of one identity per death, its way back to an event one ladder of the
// rejoin round, and its hold the movement owner's idle hold.
export function createRecoveryMovement(ports: RecoveryMovementPorts) {
  let climbing: string | null = null;
  const request = () => ({ kind: "death-recovery", owner: "death:" + ports.character().name + ":" + (Number(ports.deathAt()) || 0) });
  return {
    request,
    // A walk of the recovery while `current` holds: the owner ends it with code `stale` once the
    // occurrence goes or a player command arrives (02 design 2.1 rule 3).
    walk: (current: () => boolean) => ({ request: Object.assign(request(), { current }) }),
    // The movement owner's ladder for the way back to `event`: the rejoin round, or the join round of
    // a join event.
    climb(event: string, join: boolean): OwnerLadder {
      climbing = request().owner + ":" + event;
      return ports.movement().climb(climbing, rejoinRound(join), "Rejoining event after death");
    },
    hold() { ports.holdIdle(request()); },
    // Ends the recovery's hold and the climb it started, each by its own identity.
    done() {
      ports.movement().release(request().owner);
      if (climbing) { ports.movement().endClimb(climbing); climbing = null; }
    },
    // Where a rejoin try left the character, and how close the journey it started got (the owner
    // ladder's progress test, runtime/protocol/ladder.ts).
    progress(before: unknown) {
      const last = (ports.movement().last() !== before && ports.movement().last()) || {} as { transitions?: unknown; walkingDistance?: unknown; remaining?: unknown };
      const c = ports.character();
      return { at: { map: c.map, in: c.in, x: c.real_x, y: c.real_y },
        planned: last.transitions === undefined ? undefined : { transitions: last.transitions, walking: last.walkingDistance }, remaining: last.remaining };
    },
  };
}
