import type { HuntCycle, HuntStatus } from "./contracts.ts";
import type { ReturnLocation } from "../events/return-types.ts";

export interface HuntModeState {
  farmingPolicy: string;
  monsterHunt: HuntCycle | null;
  leader: string | null;
  monsterHunterLocation: ReturnLocation | null;
  statuses: Record<string, HuntStatus | undefined>;
  monsterFocus: string[];
  monsterFocusByCharacter: Record<string, string[] | undefined>;
  escape?: { stage: string } | null;
}
export interface HuntModePorts {
  fighting?(): boolean;
  participants(): string[];
  cancelled(name: string): boolean;
  release(): void;
  authorize(names: string[], location: ReturnLocation | null | undefined, shared: boolean): void;
  monsterDestination(id: string | undefined): ReturnLocation | null | undefined;
  clear(): void;
  selectedDestination(name: string | null): { location: ReturnLocation } | null;
  convoy(location: ReturnLocation, label: string, names: string[]): unknown;
  returnToDaisy(hunt: HuntCycle): void;
  begin(policy: string, location: ReturnLocation | null, preserve: boolean): void;
}

/** Mode transitions retain completed turn-ins and explicitly authorize resumed Hunt travel. */
export function createHuntMode(state: HuntModeState, ports: HuntModePorts) {
  function exit(mode: string): void {
    const hunt = state.monsterHunt;
    const completed = hunt?.participants.some(
      (name) => state.statuses[name]?.monsterHunt?.count === 0,
    );
    if (hunt && (completed || hunt.loot && !hunt.loot.complete)) {
      hunt.exitMode = mode;
      hunt.message = "Turning in completed hunts before leaving Hunt mode";
      ports.returnToDaisy(hunt);
    } else {
      ports.clear();
      const destination = ports.selectedDestination(state.leader);
      if (destination)
        ports.convoy(
          destination.location,
          "the leader's configured farming focus",
          ports.participants(),
        );
    }
  }
  function authorize(location: ReturnLocation | null): void {
    const names = ports.participants();
    const quest = names
      .map((name) => state.statuses[name]?.monsterHunt)
      .find((quest) => !!quest && quest.count > 0);
    ports.release();
    ports.authorize(
      names,
      location || state.monsterHunterLocation || ports.monsterDestination(quest?.id),
      true,
    );
  }
  function resumeRequested(): boolean {
    return (
      ports.participants().some((name) => ports.cancelled(name)) ||
      (!!state.escape && state.escape.stage !== "released")
    );
  }
  function setBackup(backupFocus: string[] | undefined): void {
    if (!backupFocus) return;
    state.monsterFocus = [...new Set(backupFocus)];
    for (const name of ports.participants()) delete state.monsterFocusByCharacter[name];
  }
  function restartRequested(mode: string, previous: string, backupSupplied: boolean): boolean {
    return (
      mode === "hunt" &&
      (backupSupplied || previous !== "hunt" || resumeRequested() || !state.monsterHunt)
    );
  }
  function normalPolicy(previous: string): string {
    return previous === "hunt" ? state.monsterHunt?.returnPolicy || "auto" : previous;
  }
  function select(
    mode: string,
    location: ReturnLocation | null,
    backupFocus: string[] | undefined,
    backupSupplied: boolean,
  ): void {
    const previous = state.farmingPolicy,
      policy = normalPolicy(previous);
    if (mode === "hunt") setBackup(backupFocus);
    const restart = restartRequested(mode, previous, backupSupplied);
    if (restart && !ports.fighting?.()) authorize(location);
    state.farmingPolicy = mode;
    if (previous === "hunt" && mode !== "hunt") exit(mode);
    else if (restart) ports.begin(policy, location, previous === "hunt" && !!state.monsterHunt);
  }
  return { select };
}
