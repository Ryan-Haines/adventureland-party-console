interface Quest { id: string; count: number; remainingMs: number }
interface Status { monsterHunt?: Quest | null; huntEventPending?: boolean }
type Statuses = Record<string, Status | undefined>;
interface TurnIn { owner: string; phase: "returning" | "claiming" | "complete" }
export interface Hunt {
  owner?: string;
  selectionLeader?: string;
  policyVersion?: number;
  stage: string;
  participants: string[];
  turnIn?: TurnIn;
  eventReleaseAt?: number;
  returnDisableTown?: boolean;
  returnNativeFallback?: boolean;
  returnTown?: import('../coordinator/navigation/return-town.ts').ReturnTownPolicy;
}
export function priority(hunt: Hunt | null | undefined): boolean {
  if (!hunt || ["ended", "failed-return"].includes(hunt.stage)) return false;
  if (hunt.turnIn) return hunt.turnIn.phase !== "complete";
  return hunt.stage === "returning" || hunt.stage === "at-daisy";
}
export function owner(hunt: Hunt, leader: string): string {
  return priority(hunt) ? hunt.turnIn?.owner || hunt.owner || leader :
    hunt.selectionLeader === leader ? hunt.owner || leader : leader;
}
export function quest(hunt: Hunt, leader: string, statuses: Statuses): Quest | null {
  const current = statuses[owner(hunt, leader)]?.monsterHunt;
  return current && current.remainingMs > 0 ? current : null;
}
export function shouldReturn(hunt: Hunt, leader: string, statuses: Statuses): boolean {
  const current = quest(hunt, leader, statuses);
  return !current || current.count === 0;
}
export function selection(hunt: Hunt, leader: string, statuses: Statuses, blacklist: Record<string, unknown>) {
  const names = [...new Set([leader, ...hunt.participants])];
  // Keep a live selected quest stable while its timer is running.
  const active = hunt.selectionLeader === leader && hunt.owner && names.includes(hunt.owner)
    ? statuses[hunt.owner]?.monsterHunt : null;
  if (active && active.remainingMs > 0 && (!blacklist[active.id] || active.count === 0))
    return { owner: hunt.owner!, action: active.count === 0 ? 'claim' : 'farm', quest: active };
  for (const name of names) {
    const current = statuses[name]?.monsterHunt;
    if (!current || current.remainingMs <= 0) return { owner: name, action: 'pickup', quest: null };
    if (current.count === 0) return { owner: name, action: 'claim', quest: current };
    if (!blacklist[current.id]) return { owner: name, action: 'farm', quest: current };
  }
  return null;
}
export function missions(hunt: Hunt, leader: string, statuses: Statuses, blacklist: Record<string, unknown>) {
  const selected = selection(hunt, leader, statuses, blacklist);
  if (!selected || selected.action !== 'farm' || !selected.quest) return [];
  return [{ target: selected.quest.id, owners: [selected.owner], skipped: false }];
}
export function beginTurnIn(hunt: Hunt, leader: string): void {
  if (!priority(hunt) || !hunt.turnIn) {
    hunt.turnIn = { owner: hunt.owner || leader, phase: "returning" };
    hunt.returnDisableTown = false;
    delete hunt.returnNativeFallback;
    delete hunt.returnTown;
  }
}
export function completeTurnIn(hunt: Hunt, now: number): void {
  if (!hunt.turnIn || hunt.turnIn.phase === "complete") return;
  hunt.turnIn.phase = "complete";
  hunt.eventReleaseAt = now;
}
export function eventsPending(hunt: Hunt, statuses: Statuses, now: number): boolean {
  if (!hunt.eventReleaseAt) return false;
  // Give the immediately rescheduled character event polls one status round.
  return now - hunt.eventReleaseAt < 2000 ||
    hunt.participants.some(name => statuses[name]?.huntEventPending);
}
export function needsReconcile(hunt: Hunt, leader: string): boolean {
  return !priority(hunt) && (hunt.policyVersion !== 3 || (hunt.selectionLeader || hunt.owner) !== leader);
}

interface EventCycle {
  convoyId?: string;
  returnRoutes?: Record<string, {convoyId?: string}>;
  returnCompletedAt?: number; supersededAt?: number; combatHandoffAt?: number;
}
export function eventOwnsTravel(hunt: Hunt, party: {
  eventReturn?: unknown;
  activeConvoy?: { id?: string; purpose?: string | null } | null;
  anniversary?: { eventCycle?: EventCycle | null };
}): boolean {
  if (priority(hunt)) return false;
  if (party.eventReturn) return true;
  const cycle = party.anniversary?.eventCycle;
  if (party.activeConvoy && party.activeConvoy.purpose !== "monster-hunt" &&
      !completedAnniversaryConvoy(party.activeConvoy, cycle)) return true;
  return !!cycle && !cycle.returnCompletedAt && !cycle.supersededAt && !cycle.combatHandoffAt;
}

function completedAnniversaryConvoy(convoy: {id?: string; purpose?: string | null}, cycle: EventCycle | null | undefined): boolean {
  if (convoy.purpose !== "anniversary-return" || !convoy.id || !cycle ||
      !(cycle.returnCompletedAt || cycle.supersededAt)) return false;
  return cycle.convoyId === convoy.id || Object.values(cycle.returnRoutes || {}).some(route => route.convoyId === convoy.id);
}
