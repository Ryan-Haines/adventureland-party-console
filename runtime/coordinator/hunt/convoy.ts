import type { ReturnLocation } from "../events/return-types.ts";
import type { HuntCycle, HuntTickState } from "./contracts.ts";
import { classifyTravelDefense } from "../navigation/travel-defense.ts";

interface HuntConvoyPorts {
  fighting?(): boolean;
  now(): number;
  intent(name: string): { cancelled?: boolean };
  processDaisy(hunt: HuntCycle): void;
  authorize(names: string[], location: ReturnLocation, force: boolean): void;
  start(location: ReturnLocation, label: string, names: string[], purpose: string, cause?: "farming-conflict"): boolean;
}

/** Installs the same routing flags on the convoy and every already-issued member command. */
export function createHuntConvoy(state: HuntTickState, ports: HuntConvoyPorts) {
  function holdReason(
    hunt: HuntCycle,
    location: ReturnLocation | null | undefined,
    stage: string,
  ): string | null {
    if (
      stage === "returning" &&
      hunt.participants.some((name) => state.statuses[name]?.convoyProtocol !== 4)
    )
      return "Waiting for all party members to load the return-routing update";
    if (!location) return "Waiting for Daisy or monster spawn location data";
    if (hunt.loot && !hunt.loot.complete) return "Pending Hunt loot: collecting final kill drops";
    return null;
  }

  function paused(hunt: HuntCycle): boolean {
    if (hunt.participants.some((name) => ports.intent(name).cancelled)) {
      hunt.message = "Hunt movement is paused; select Hunt again to resume";
      return true;
    }
    if (state.escape && state.escape.stage !== "released") {
      hunt.message = "Hunt movement is paused by Escape";
      return true;
    }
    return false;
  }

  function alreadyAtDaisy(hunt: HuntCycle, location: ReturnLocation): boolean {
    return hunt.participants.every((name) => {
      const status = state.statuses[name];
      return (
        status &&
        !status.rip &&
        status.seenAt >= ports.now() - 3000 &&
        status.map === location.map &&
        Math.hypot(status.x - location.x, status.y - location.y) <= 100
      );
    });
  }

  function departingDaisy(hunt: HuntCycle, stage: string): boolean {
    const daisy = state.monsterHunterLocation;
    return (
      stage === "mission-travel" &&
      !!daisy &&
      hunt.participants.every((name) => {
        const status = state.statuses[name];
        return (
          status &&
          status.map === daisy.map &&
          Math.hypot(status.x - daisy.x, status.y - daisy.y) <= 120
        );
      })
    );
  }

  function configure(hunt: HuntCycle, stage: string): void {
    const convoy = state.activeConvoy!;
    if (departingDaisy(hunt, stage)) convoy.townFirst = false;
    convoy.combatHandoffAllowed = false;
    convoy.cause = stage === "mission-travel" ? hunt.travelCause : undefined;
    convoy.huntTarget = stage === "mission-travel" ? hunt.target || undefined : undefined;
    convoy.nonPreemptible = stage === "returning";
    convoy.returnRouting = stage === "returning";
    if (convoy.returnRouting) convoy.continuousReturn = 1;
    convoy.nativeFallback = stage === 'returning' ? hunt.returnNativeFallback : undefined;
    convoy.returnTown = hunt.returnTown;
    convoy.disableTown = disabledTown(hunt);
    if (convoy.returnRouting) convoy.townFirst = false;
    configureCommands(hunt);
  }
  function configureCommands(hunt: HuntCycle): void {
    const convoy = state.activeConvoy!;
    for (const name of hunt.participants) {
      const command = state.commands[name];
      if (command?.convoyId !== convoy.id) continue;
      command.combatHandoffAllowed = convoy.combatHandoffAllowed;
      command.huntTarget = convoy.huntTarget;
      command.nonPreemptible = convoy.nonPreemptible;
      command.returnRouting = convoy.returnRouting;
      command.continuousReturn = convoy.continuousReturn;
      command.nativeFallback = convoy.nativeFallback;
    }
  }

  function depart(
    hunt: HuntCycle,
    location: ReturnLocation,
    label: string,
    stage: string,
  ): boolean {
    ports.authorize(hunt.participants, location, true);
    delete hunt.arrivalHandoff;
    if (!ports.start(location, label, hunt.participants, "monster-hunt", stage === "mission-travel" ? hunt.travelCause : undefined)) {
      hunt.message = "Waiting for an online party leader on the convoy realm";
      return false;
    }
    configure(hunt, stage);
    hunt.convoyId = state.activeConvoy && state.activeConvoy.id;
    hunt.stage = stage;
    if (stage === "mission-travel") delete hunt.originArrivedAt;
    hunt.message = label;
    return true;
  }

  function start(
    hunt: HuntCycle,
    location: ReturnLocation | null | undefined,
    label: string,
    stage: string,
  ): boolean {
    const reason = holdReason(hunt, location, stage);
    if (reason) { hunt.message = reason; return false; }
    if (state.activeConvoy || paused(hunt)) return false;
    const defense = classifyTravelDefense(state, hunt.participants, ports.now());
    if (defense.state !== "clear" && !(stage === "mission-travel" && defense.state === "defending")) {
      hunt.stage = stage;
      if (stage === "mission-travel") delete hunt.originArrivedAt;
      hunt.convoyId = null;
      hunt.message = defense.message;
      return false;
    }
    if (stage === "returning" && alreadyAtDaisy(hunt, location!)) {
      hunt.convoyId = null;
      hunt.stage = "at-daisy";
      ports.processDaisy(hunt);
      return true;
    }
    return depart(hunt, location!, label, stage);
  }
  return { start };
}

function disabledTown(hunt: HuntCycle): boolean {
  return hunt.returnTown ? hunt.returnTown.walking : !!hunt.returnDisableTown;
}
