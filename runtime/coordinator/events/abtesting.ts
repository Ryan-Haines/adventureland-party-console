export interface ABStrategy {
  eventId: string;
  firstSeenAt: number;
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

const teamDiscoveryMs = 20_000;

function inEvent(status: ABReport | undefined): status is ABReport {
  return (
    !!status &&
    (status.activeEvent === "abtesting" ||
      status.joinedEvent === "abtesting" ||
      status.map === "abtesting")
  );
}

function pending(eventId: string, participants: readonly string[], now: number): ABStrategy {
  return {
    eventId,
    firstSeenAt: now,
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
    previous?.eventId === eventId ? structuredClone(previous) : pending(eventId, participants, now);
  strategy.expectedNames = [...new Set(strategy.expectedNames.concat(participants))].sort();
  for (const status of reporters)
    if (status.eventTeam) strategy.teams[status.name] = status.eventTeam;
  const known = strategy.expectedNames.filter((name) => strategy.teams[name]);
  if (
    known.length === strategy.expectedNames.length ||
    now - strategy.firstSeenAt >= teamDiscoveryMs
  ) {
    resolveTeams(strategy, groupTeams(strategy));
    if (!strategy.resolvedAt) strategy.resolvedAt = now;
  }
  return strategy;
}
