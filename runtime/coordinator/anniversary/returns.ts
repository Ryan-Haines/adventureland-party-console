import type { AnniversaryCycle } from "./contracts.ts";
import type {
  AnniversaryBuffStatus,
  AnniversaryRecoveryPorts,
  AnniversaryRecoveryState,
} from "./return-contracts.ts";
import { createAnniversaryAbort } from "./abort.ts";

export function createAnniversaryReturns(
  state: AnniversaryRecoveryState,
  ports: AnniversaryRecoveryPorts,
) {
  function deadline(cycle: AnniversaryCycle): number {
    const featured = (cycle.participants || ports.participants()).includes(cycle.target || "");
    return featured
      ? Math.min(Number(cycle.endsAt), Number(cycle.startsAt) + 60000)
      : Number(cycle.endsAt);
  }

  function unavailable(cycle: AnniversaryCycle | null | undefined): boolean {
    return (
      !cycle ||
      !!cycle.returnDispatchedAt ||
      !!cycle.returnCompletedAt ||
      !!cycle.supersededAt ||
      !!cycle.combatHandoffAt ||
      ports.townBusy()
    );
  }

  function waiting(cycle: AnniversaryCycle, names: string[], force: boolean): boolean {
    if (
      ports.now() < Number(cycle.startsAt) ||
      (!cycle.abortedAt && names.includes(cycle.target || "") && ports.now() < deadline(cycle))
    )
      return true;
    const ready = Object.keys(state.returnReady || {});
    return !force && !cycle.abortedAt && !names.every((name) => ready.includes(name));
  }

  function returnReason(
    cycle: AnniversaryCycle,
    featured: boolean,
    force: boolean,
  ): [string, string] {
    if (cycle.abortedAt)
      return ["anniversary target unkissable: " + cycle.abortReason, "Anniversary round skipped"];
    if (featured)
      return ["one-minute featured hold complete", "One-minute anniversary featured hold complete"];
    if (force) return ["anniversary window ended", "Anniversary window ended"];
    return ["party completed anniversary visits", "Anniversary visits completed"];
  }

  function reportDispatch(cycle: AnniversaryCycle, force: boolean): void {
    const featured =
      !cycle.abortedAt &&
      (cycle.participants || []).includes(cycle.target || "") &&
      ports.now() >= deadline(cycle);
    if (cycle.returnCompletedAt)
      ports.log("Anniversary return complete: " + cycle.returnReason, "info");
    else {
      const [reason, message] = returnReason(cycle, featured, force);
      cycle.returnReason = reason;
      ports.log(message + "; returning to saved farming waypoints", "info");
    }
    ports.persist();
  }

  function dispatch(force = false): boolean {
    const cycle = state.eventCycle;
    if (unavailable(cycle)) return false;
    const names = (cycle!.participants || ports.participants()).filter((name) =>
      ports.activeNames().includes(name),
    );
    if (waiting(cycle!, names, force)) return false;
    ports.releaseFarmingWalk?.(cycle!);
    if (ports.convoyBusy() || !ports.dispatch(cycle!, names)) return false;
    reportDispatch(cycle!, force);
    return true;
  }

  function hasCurrentBuff(cycle: AnniversaryCycle, status: AnniversaryBuffStatus): boolean {
    const buff =
      Array.isArray(status.conditions) &&
      status.conditions.some(
        (condition) =>
          condition &&
          (condition.id === "anniversary_kiss" || condition.name === "anniversary_kiss"),
      );
    return (
      buff &&
      !status.anniversaryVisit &&
      ports.now() >= Number(cycle.startsAt) &&
      [String(cycle.id), String(cycle.liveRound)].includes(String(status.anniversaryState?.round))
    );
  }

  function reconcileDispatched(cycle: AnniversaryCycle): void {
    if (!cycle.returnRoutes) {
      cycle.waypoints = ports.capture(cycle.participants);
      cycle.returnRoutes = Object.fromEntries(
        Object.entries(cycle.waypoints).filter(([, saved]) => saved.location),
      );
    }
    ports.reconcile(cycle);
  }

  function mayObserve(
    cycle: AnniversaryCycle | null | undefined,
    name: string,
  ): cycle is AnniversaryCycle {
    return (
      !!cycle &&
      !cycle.returnCompletedAt &&
      !cycle.supersededAt &&
      !cycle.combatHandoffAt &&
      name !== ports.merchant() &&
      ports.participants().includes(name)
    );
  }

  function reconcile(name: string, status: AnniversaryBuffStatus): void {
    const cycle = state.eventCycle;
    if (!mayObserve(cycle, name)) return;
    if (cycle.returnDispatchedAt) {
      reconcileDispatched(cycle);
      return;
    }
    if (!hasCurrentBuff(cycle, status)) return;
    state.returnReady ||= {};
    if (state.returnReady[name]) return;
    state.returnReady[name] = {
      at: ports.now(),
      round: status.anniversaryState?.round || cycle.liveRound || cycle.id,
      recoveredFromBuff: true,
    };
    ports.log(name + " anniversary completion recovered from the active kiss buff", "info");
    ports.persist();
    ports.schedule();
  }

  function tick(): void {
    const cycle = state.eventCycle;
    if (cycle && (cycle.returnCompletedAt || cycle.supersededAt)) {
      ports.reconcile(cycle);
      return;
    }
    if (
      !cycle ||
      cycle.returnDispatchedAt ||
      !Number.isFinite(Number(cycle.endsAt))
    )
      return;
    dispatch(!!cycle.abortedAt || ports.now() >= deadline(cycle));
  }
  const aborts = createAnniversaryAbort(state, ports, () => {
    dispatch(true);
  });
  return {
    dispatch,
    deadline,
    reconcile,
    tick,
    abort: aborts.abort,
    finishAbort: aborts.finish,
  };
}
