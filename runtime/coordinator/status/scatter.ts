export interface CombatReference {
  id?: string;
  mtype?: string;
  at?: number;
  reason?: string;
}

export interface ScatterStatus {
  name: string;
  farmingMonsterType?: string;
  target?: CombatReference | null;
  combatDeviation?: CombatReference | null;
  threats?: (CombatReference | null)[];
}

export interface ScatterBreak extends CombatReference {
  triggeredBy?: string;
  seenAt: number;
}

export interface ScatterState {
  scatterPartySignature?: string;
  scatterMonsterTypes: string[];
  scatterEpoch: number;
  scatterBreakTarget: ScatterBreak | null;
  partyFarmingMode: string;
  partyFarmingMonsterType: string | null | undefined;
  farmingPolicy: string;
}

function refreshMembership(state: ScatterState, names: string[]): void {
  const signature = [...names].sort().join("|");
  if (state.scatterPartySignature && state.scatterPartySignature !== signature) {
    state.scatterMonsterTypes = [];
    state.scatterEpoch += 1;
    state.partyFarmingMode = "default";
    state.partyFarmingMonsterType = null;
    state.scatterBreakTarget = null;
  }
  state.scatterPartySignature = signature;
}

function offType(reference: CombatReference | null | undefined, type: string): boolean {
  return !!reference?.id && reference.mtype !== type;
}

function deviation(status: ScatterStatus, type: string, now: number): ScatterBreak | null {
  if (offType(status.combatDeviation, type))
    return { ...status.combatDeviation, triggeredBy: status.name, seenAt: now };
  if (offType(status.target, type))
    return {
      id: status.target?.id,
      mtype: status.target?.mtype,
      triggeredBy: status.name,
      at: now,
      reason: "party target",
      seenAt: now,
    };
  const threat = status.threats?.find((entry) => offType(entry, type));
  return threat
    ? {
        id: threat.id,
        mtype: threat.mtype,
        triggeredBy: status.name,
        at: now,
        reason: "off-type attacker",
        seenAt: now,
      }
    : null;
}

function reportsTarget(status: ScatterStatus, id: string | undefined): boolean {
  return !!(
    (status.target && status.target.id === id) ||
    (status.combatDeviation && status.combatDeviation.id === id) ||
    status.threats?.some((threat) => threat && threat.id === id)
  );
}

function refreshBreak(state: ScatterState, statuses: ScatterStatus[], now: number): void {
  if (state.partyFarmingMode === "scatter" && state.partyFarmingMonsterType) {
    const target = statuses
      .map((status) => deviation(status, state.partyFarmingMonsterType!, now))
      .find(Boolean);
    if (target) state.scatterBreakTarget = target;
  }
  const current = state.scatterBreakTarget;
  if (!current) return;
  if (statuses.some((status) => reportsTarget(status, current.id))) current.seenAt = now;
  else if (now - Number(current.seenAt || 0) > 3000) state.scatterBreakTarget = null;
}

function selectMode(state: ScatterState, monster: string | null): string {
  if (state.farmingPolicy === "default") return "default";
  if (state.farmingPolicy === "scatter") return "scatter";
  return !state.scatterBreakTarget && monster && state.scatterMonsterTypes.includes(monster)
    ? "scatter"
    : "default";
}

/** A party-wide deviation suspends automatic scatter until no member reports it for three seconds. */
export function observeScatter(
  state: ScatterState,
  names: string[],
  statuses: Readonly<Record<string, ScatterStatus | undefined>>,
  authority: ScatterStatus | undefined,
  learned: string[],
  now: number,
  rareOwns = false,
): void {
  refreshMembership(state, names);
  refreshBreak(
    state,
    names.map((name) => statuses[name]).filter((status): status is ScatterStatus => !!status),
    now,
  );
  const monster = authority?.farmingMonsterType || authority?.target?.mtype || learned[0] || null;
  state.partyFarmingMonsterType = state.scatterBreakTarget
    ? state.scatterBreakTarget.mtype
    : monster;
  // Use the same ownership override as heartbeat responses. Otherwise a stale
  // learned Hunt type clears the shared queue while clients wait on that queue.
  state.partyFarmingMode = rareOwns ? "default" : selectMode(state, monster);
}
