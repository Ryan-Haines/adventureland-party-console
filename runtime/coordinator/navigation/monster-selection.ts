import {skipManualEventOccurrences, type EventAttendance} from '../events/attendance-limits.ts';
import type { ReturnLocation } from "../events/return-types.ts";
export interface MonsterSelectionState {
  eventAttendance?: EventAttendance;
  leader: string | null;
  followers: Record<string, boolean>;
  monsterChoices?: { id: string }[] | null;
  statuses: Record<string, { seenAt: number; server?:string; joinedEvent?:unknown; mapEvent?:unknown; eventFeedConnected?:boolean; eventClockStale?:boolean } | undefined>;
  farmAreaState: unknown;
  farmingPolicy: string;
  monsterFocus: string[];
  monsterFocusByCharacter: Record<string, string[] | undefined>;
  scatterMonsterTypes: string[];
  scatterEpoch: number;
  partyFarmingMode: string;
  partyFarmingMonsterType: string | null;
  scatterBreakTarget: unknown;
  eventReturn: unknown;
  deferredEventReturns: Record<string, unknown>;
  eventSessions: Record<string, {event:string; id?:string|null; lastLiveAt?:number; authorizedRealm?:string; authorizedAt?:number; participants:string[]; participationRecorded?:boolean} | undefined>;
  commands: Record<string, { type: string; manualMonsterOverride?: boolean } | undefined>;
  passiveHunting?: import("./passive-settings.ts").PassiveSettings;
  passiveRareHunts: unknown;
}
export interface MonsterSelectionPorts {
  now(): number;
  validPhoenixOrder(order: unknown): boolean;
  validLocation(id: string, location: unknown): ReturnLocation | null;
  destination(id: string): ReturnLocation | null | undefined;
  release(): void;
  clearHunt(): void;
  members(): string[];
  authorize(names: string[], location: ReturnLocation, shared: boolean): void;
  start(location: ReturnLocation, label: string, names: string[], purpose: string): boolean;
  startPhoenix(order: unknown): void;
  stopPhoenix(reason: string): void;
  persist(): void;
  validPassive(settings: Record<string, unknown>): boolean;
  setPassive(settings: Record<string, unknown>): void;
  invalidate(names: string[], reason: string, shared: boolean): void;
}

export function createMonsterSelection(state: MonsterSelectionState, ports: MonsterSelectionPorts) {
  // keepPolicy: Achievement Hunt switches targets without resetting the
  // player's Auto/Default/Scatter choice.
  function reset(id: string, location: ReturnLocation, keepPolicy: boolean): void {
    ports.release();
    state.farmAreaState = { preferredLocation: location };
    ports.clearHunt();
    if (!keepPolicy) state.farmingPolicy = "auto";
    state.monsterFocus = [id];
    delete state.monsterFocusByCharacter[String(state.leader)];
    for (const name of Object.keys(state.followers))
      if (state.followers[name]) delete state.monsterFocusByCharacter[name];
    state.scatterMonsterTypes = [];
    state.scatterEpoch++;
    state.partyFarmingMode = "default";
    state.partyFarmingMonsterType = null;
    state.scatterBreakTarget = null;
    // A mode's own switch keeps event state: Achievement Hunt switches on a timer, while members
    // may still be finishing an event. A manual pick clears it.
    if (keepPolicy) return;
    state.eventReturn = null;
    state.deferredEventReturns = {};
    state.eventSessions = {};
  }
  function select(id: string, location: ReturnLocation, phoenixOrder: unknown, keepPolicy = false): string[] | null {
    const names = ports.members();
    const sessions = state.eventSessions;
    reset(id, location, keepPolicy);
    ports.authorize(names, location, true);
    if (!ports.start(location, "the " + id + " spawn", names, "manual-monster-override"))
      return null;
    skipManualEventOccurrences({...state, eventSessions: sessions, eventAttendance: state.eventAttendance ||= {}}, names, ports.now());
    for (const name of names) {
      const command = state.commands[name];
      if (command?.type === "party-monster-travel") command.manualMonsterOverride = true;
    }
    if (id === "phoenix") ports.startPhoenix(phoenixOrder);
    else ports.stopPhoenix("New farming selection");
    ports.persist();
    return names;
  }
  return { select };
}
