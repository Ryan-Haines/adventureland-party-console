import type { Tier } from "../../protocol/ranks.ts";
import type { Reunion, TaskKind } from "../rules.ts";
import { pointOf } from "./owner.ts";

// The heartbeat's `task`:
// the member's group's live task, from the task owner, carried to the
// character. Death recovery acts on it after a respawn,
// and the farm reunion runs only while it is a farming task.
export interface MemberAssignment {
  kind: TaskKind;
  owner: string;
  tier: Tier;
  goal?: unknown;
  // The `reunion` column of the task's row, which the character reads.
  reunion: Reunion;
  // The event a member of the attendance walks to or fights. A left-out member gets none, so
  // its respawn never rejoins the event.
  event?: string;
  apart?: EventApart;
  // Where a member an add-on's walk left out waits (`member.apart`); without it a waiting member
  // waits in Main.
  apartAt?: { map: string; x: number; y: number };
}
// `phase` is the task's own sub-phase, so a member knows a death recovery is on its farm return.
export interface OwnedAssignment { kind: TaskKind; owner: string; tier: Tier; goal?: unknown; phase?: string; reunion: Reunion }

// The owner's answer in the heartbeat's shape. `apart` is set only for a member left out of a
// live attendance.
export function heartbeatTask(owned: OwnedAssignment | null, apart: Apart | null): MemberAssignment | null {
  if (!owned) return null;
  const goal = owned.goal as { event?: unknown } | undefined;
  const leftOut = (owned.kind === "event-attendance" || owned.kind.startsWith("addon:")) && !!apart;
  const event = owned.kind === "event-attendance" && !leftOut && typeof goal?.event === "string" ? goal.event : undefined;
  return { ...owned, ...(event ? { event } : {}), ...(leftOut ? { apart: apart!.apart, ...(apart!.at ? { apartAt: apart!.at } : {}) } : {}) };
}
// What a left-out member does, and for an add-on's walk the point it waits at.
export interface Apart { apart: EventApart; at?: { map: string; x: number; y: number } }

// A member its group's event cannot use still gets the attendance as its
// assignment and waits in Main where the party lands. The assignment never depends on the event's
// own participant list. `farm` is an add-on's answer only (`member.apart`).
export type EventApart = 'wait' | 'farm';

export interface ApartPorts {
  // True while the member may attend `event`: selected and under its attendance limits.
  admitted(name: string, event: string): boolean;
  // True while the member walks to or attends a live occurrence (`presence`).
  present(name: string): boolean;
}

export function eventApart(ports: ApartPorts, name: string, task: { kind: string; goal?: unknown } | null): Apart | null {
  const event = (task?.goal as { event?: unknown } | undefined)?.event;
  if (task?.kind !== 'event-attendance' || typeof event !== 'string') return null;
  if (ports.present(name) || ports.admitted(name, event)) return null;
  return { apart: 'wait' };
}
// `member.apart`: a member of the group that the add-on's own task left out of its walk goes
// where the add-on names: it waits at the add-on's point, or farms alone at the saved spot while
// it can win those fights alone, else waits in Main. With no answer it stays with its group's task.
export function addonApart(ports: { ask(view: Record<string, unknown>): unknown; winnable(name: string): boolean }, group: string, name: string,
  live: { kind: string; owner: string; members: readonly string[] } | null): Apart | null {
  if (!live?.kind.startsWith('addon:') || live.members.includes(name)) return null;
  const answer = ports.ask({ group, member: name, taskId: live.owner }) as { wait?: unknown; farm?: unknown } | null | undefined;
  const at = pointOf(answer?.wait);
  if (at) return { apart: 'wait', at };
  return answer?.farm === true ? { apart: ports.winnable(name) ? 'farm' : 'wait' } : null;
}
