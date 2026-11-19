// The A/B strategy on the coordinator. Moved from
// runtime/coordinator/events/abtesting.ts and abtesting-update.ts.
import { partyHooks } from '../../hooks/index.ts';
import { ageOf } from '../../protocol/reports.ts';
export interface ABStrategy {
  eventId: string;
  expectedNames: string[];
  teams: Record<string, string>;
  mode: "pending" | "uniform" | "balanced" | "split";
  majorityTeam: string | null;
  majorityNames: string[];
  sabotageNames: string[];
  resolvedAt: number | null;
}

export interface ABReport {
  name: string;
  activeEvent?: string;
  joinedEvent?: string;
  activeEventId?: string;
  map?: string;
  eventTeam?: string;
}

function inEvent(status: ABReport | undefined): status is ABReport {
  return (
    !!status &&
    (status.activeEvent === "abtesting" ||
      status.joinedEvent === "abtesting" ||
      status.map === "abtesting")
  );
}

function pending(eventId: string, participants: readonly string[]): ABStrategy {
  return {
    eventId,
    expectedNames: participants.slice().sort(),
    teams: {},
    mode: "pending",
    majorityTeam: null,
    majorityNames: [],
    sabotageNames: [],
    resolvedAt: null,
  };
}

function groupTeams(strategy: ABStrategy): [string, string[]][] {
  const groups: Record<string, string[]> = {};
  for (const name of strategy.expectedNames) {
    const team = strategy.teams[name];
    if (team) (groups[team] ||= []).push(name);
  }
  return Object.entries(groups).sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
}

function resolveTeams(strategy: ABStrategy, entries: [string, string[]][]): void {
  if (entries.length <= 1) {
    strategy.mode = "uniform";
    strategy.majorityTeam = entries[0]?.[0] || null;
    strategy.majorityNames = entries[0]?.[1] || [];
    strategy.sabotageNames = [];
  } else if (entries[0][1].length === entries[1][1].length) {
    strategy.mode = "balanced";
    strategy.majorityTeam = null;
    strategy.majorityNames = [];
    strategy.sabotageNames = [];
  } else {
    strategy.mode = "split";
    strategy.majorityTeam = entries[0][0];
    strategy.majorityNames = entries[0][1].slice();
    strategy.sabotageNames = entries.slice(1).flatMap((entry) => entry[1]);
  }
}

/** No reporters means no new evidence: retain the previous event snapshot. */
export function resolveABStrategy(
  previous: ABStrategy | null,
  participants: readonly string[],
  statuses: Readonly<Record<string, ABReport | undefined>>,
  now: number,
): ABStrategy | null {
  const reporters = participants.map((name) => statuses[name]).filter(inEvent);
  if (!reporters.length) return previous;
  const eventId = reporters.map((status) => status.activeEventId).find(Boolean) || "abtesting-live";
  const strategy =
    previous?.eventId === eventId ? structuredClone(previous) : pending(eventId, participants);
  strategy.expectedNames = [...new Set(strategy.expectedNames.concat(participants))].sort();
  for (const status of reporters)
    if (status.eventTeam) strategy.teams[status.name] = status.eventTeam;
  // The strategy decides once every expected participant (each active, opted-in member) has
  // reported its team, which the game sets at the join; b9b5c91e held `pending` until then
  // (abtesting.ts:92-98). A member that leaves the opted-in set drops out of `participants`.
  if (participants.every((name) => !!strategy.teams[name])) {
    resolveTeams(strategy, groupTeams(strategy));
    if (!strategy.resolvedAt) strategy.resolvedAt = now;
  }
  return strategy;
}

interface Status extends ABReport {
  seenAt: number;
}
interface StrategyState {
  statuses: Record<string, Status>;
  abtestingStrategy: ABStrategy | null;
  merchantCharacter: string | null;
}

export function activeCoordinatorNames(
  statuses: Record<string, { name: string; seenAt: number }>,
  now: number,
): string[] {
  return Object.values(statuses)
    .filter((entry) => entry.seenAt >= now - ageOf('presence'))
    .map((entry) => entry.name);
}

/** Persist only changes in the resolved strategy, retaining the existing serialized equality check. */
export function updateCoordinatorABStrategy(
  state: StrategyState,
  ports: {
    activeNames: () => string[];
    enabled: (name: string, event: string) => boolean;
    now: () => number;
    persist: () => void;
  },
): ABStrategy | null {
  const previousSerialized = JSON.stringify(state.abtestingStrategy);
  const participants = ports
    .activeNames()
    .filter((name) => ports.enabled(name, "abtesting"));
  state.abtestingStrategy = resolveABStrategy(
    state.abtestingStrategy,
    participants,
    state.statuses,
    ports.now(),
  );
  if (JSON.stringify(state.abtestingStrategy) !== previousSerialized) {
    ports.persist();
    // `abtesting.strategy`: the strategy and its teams, once per change.
    partyHooks().notify('abtesting.strategy', { strategy: state.abtestingStrategy, by: 'core:events' });
  }
  return state.abtestingStrategy;
}
