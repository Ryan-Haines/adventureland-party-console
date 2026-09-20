interface Schedule {
  [key: string]: unknown;
}
interface Report {
  seenAt: number;
  server?: string;
  eventSchedules?: Schedule[];
  eventFeedAt?: unknown;
  eventClockStale?: unknown;
}

/** Prefer the latest feed among fresh reports from the leader's realm. */
export function projectEventSchedules(
  statuses: Record<string, Report | null | undefined>,
  leader: string | null,
  now: () => number,
): Schedule[] {
  const server = statuses[String(leader)]?.server;
  const reports = Object.values(statuses).filter(
    (report): report is Report & { eventSchedules: Schedule[] } =>
      !!report &&
      !!report.eventSchedules &&
      now() - report.seenAt < 15000 &&
      (!server || report.server === server),
  );
  reports.sort((a, b) => Number(b.eventFeedAt || 0) - Number(a.eventFeedAt || 0));
  const report = reports[0];
  return report
    ? report.eventSchedules.map((event) => ({
        ...event,
        stale: now() - Number(report.eventFeedAt || 0) > 120000 || !!report.eventClockStale,
      }))
    : [];
}
