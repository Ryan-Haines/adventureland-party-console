import type { PartyConvoy } from "./convoy.ts";
import type { MerchantCommand } from "../merchant/work.ts";

interface SavedConvoy extends Omit<PartyConvoy, "epoch"> {
  [key: string]: unknown;
  epoch?: unknown;
}
interface SavedCommands {
  townCycle?: { id: string; pending: string[]; startedAt: number; revisions?: Record<string, number> } | null;
  returnProgress?: Record<string, import("../http/return-progress.ts").ReturnProgress>;
  activeConvoy?: SavedConvoy | null;
  navigationEpoch?: unknown;
}

function restartRevisions(convoy: SavedConvoy): Record<string, number> {
  if (convoy.restartRecovery && convoy.restartRevisions) return { ...convoy.restartRevisions };
  return Object.fromEntries(
    Object.entries(convoy.expected || {}).map(([name, expected]) => [name, expected.revision]),
  );
}

function retainedEventFailure(saved: SavedCommands): boolean {
  const c = saved.activeConvoy;
  return c?.phase === "failed" && c.purpose === "shared-walk" && c.label === "event walking leg";
}
function restoredConvoy(saved: SavedCommands, now: () => number): PartyConvoy | null {
  return saved.activeConvoy
    ? {
        ...saved.activeConvoy,
        ...(saved.activeConvoy.merchantInterruption ? { merchantInterruption: {
          ...(saved.activeConvoy.merchantInterruption as object), phase: "resuming",
        } } : {}),
        routeProtocol: 4,
        epoch: Number(saved.activeConvoy.epoch) || now(),
        phase: "failed",
        departAt: null,
        failure: retainedEventFailure(saved) ? saved.activeConvoy.failure : "Coordinator restarted; waiting to recover interrupted travel",
        failureCode: retainedEventFailure(saved) ? saved.activeConvoy.failureCode : "runtime-lost",
        failedAt: retainedEventFailure(saved) ? saved.activeConvoy.failedAt : now(),
        restartRecovery: true,
        restartRevisions: restartRevisions(saved.activeConvoy),
      }
    : null;
}

/** Character runtimes survive host reloads, so command IDs must start from wall-clock time. */
export function initialCommandState(saved: SavedCommands, now: () => number) {
  return {
    returnProgress: saved.returnProgress || {},
    commands: {} as Record<string, MerchantCommand | undefined>,
    activeConvoy: restoredConvoy(saved, now),
    navigationEpoch: Math.max(Number(saved.navigationEpoch) || 0, now()),
    nextCommandId: now(),
    thresholdRunActive: false,
    bankCycleMembers: {},
    bankQueue: [],
    bankCurrent: null,
    bankStartedAt: 0,
  };
}
