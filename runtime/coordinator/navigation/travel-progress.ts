import { distance, reportMatches, type SharedConvoy, type SharedState } from './shared-route-types.ts';

function unexplained(state: SharedState, name: string, now: number): boolean {
  const s = state.statuses[name];
  if (!s || now - s.seenAt > 3000 || !reportMatches(state, name)) return false;
  return !!s.passiveTravel?.pending && !s.passiveTravel.hold && !s.moving &&
    s.convoyNavigation?.phase === 'travelling';
}
/** Only continuous, fresh, owned walking observations can trigger route recovery. */
export function stalledTravelMember(state: SharedState, c: SharedConvoy, now: number): string | undefined {
  const samples = c.travelProgress ||= {};
  for (const name of c.participants.filter(n => !c.completed.includes(n))) {
    if (!unexplained(state, name, now)) { delete samples[name]; continue; }
    const s = state.statuses[name]!;
    const previous = samples[name];
    if (!previous || previous.commandId !== s.convoyNavigation!.commandId || s.seenAt - previous.observedAt > 3000 || distance(s, previous) >= 2)
      samples[name] = { commandId: s.convoyNavigation!.commandId, map: s.map, in: s.in, x: s.x, y: s.y, since: now, observedAt: s.seenAt };
    else previous.observedAt = s.seenAt;
    if (now - samples[name]!.since >= 3000) return name;
  }
  return undefined;
}
