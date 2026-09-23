import { characterRuntime, reportMatches, type SharedState, type SharedConvoy } from './shared-route-types.ts';
import { sharedRoute } from './shared-route-store.ts';

type Geometry = {version: number; fingerprint: string};
const same = (a: Geometry | undefined, b: Geometry) => a?.version === b.version && a.fingerprint === b.fingerprint;
export function geometryMismatch(state: SharedState, c: SharedConvoy): string[] {
  const expected = sharedRoute(c)?.geometry || state.statuses[c.leader]?.movementGeometry;
  if (!expected) return [];
  return c.participants.filter(n => !c.completed.includes(n) && !!state.statuses[n]?.movementGeometry && !same(state.statuses[n]?.movementGeometry, expected));
}
export function beginGeometryRepair(state: SharedState, c: SharedConvoy, now: number): boolean {
  if (c.geometryRepair) return false;
  // A browser can remain on an older game build after headless workers update.
  // Repair toward the newest reported build, including when the leader is stale.
  const expected = repairIdentity(state,c);
  if (!expected) return false;
  const mismatched = c.participants.filter(n=>!c.completed.includes(n) && !same(state.statuses[n]?.movementGeometry,expected));
  // An import can detect an identity change before its next heartbeat reaches us.
  const names = mismatched.length ? mismatched : c.participants.filter(n => !c.completed.includes(n));
  c.geometryRepair = {id: c.id + ':geometry:' + c.epoch, startedAt: now, expected,
    runtimes: Object.fromEntries(names.map(n => [n, characterRuntime(state.statuses[n]) || ''])), phase: 'waiting'};
  return true;
}
function repairIdentity(state: SharedState, c: SharedConvoy): Geometry | undefined {
  const identities=[sharedRoute(c)?.geometry,state.statuses[c.leader]?.movementGeometry,
    ...c.participants.map(n=>state.statuses[n]?.movementGeometry)].filter((g): g is Geometry=>!!g);
  return identities.sort((a,b)=>b.version-a.version)[0];
}
export function geometryRepairReady(state: SharedState, c: SharedConvoy, now: number): boolean {
  const repair = c.geometryRepair!;
  return c.participants.every(name => {
    if (c.completed.includes(name)) return true;
    const s = state.statuses[name];
    if (!repairStatusReady(s,now)) return false;
    if (s.server !== c.routeServer || !same(s.movementGeometry, repair.expected)) return false;
    return !repair.runtimes[name] || characterRuntime(s) !== repair.runtimes[name];
  });
}
function repairStatusReady(s: SharedState['statuses'][string], now: number): s is NonNullable<SharedState['statuses'][string]> {
  return !!s && now-s.seenAt<=3000 && s.seenAt<=now+500 && !s.rip && s.hp!==0 && !s.moving;
}
export function geometryReloadSignal(state: SharedState, c: SharedConvoy, name: string) {
  const repair = c.geometryRepair;
  if (repair?.phase !== 'waiting' || repair.runtimes[name] !== characterRuntime(state.statuses[name])) return null;
  if (!c.participants.filter(n => !c.completed.includes(n)).every(n =>
    characterRuntime(state.statuses[n]) !== repair.runtimes[n] && !!repair.runtimes[n] ||
    reportMatches(state,n) && state.statuses[n]?.convoyNavigation?.phase === 'held')) return null;
  return {id: repair.id, runtimeId: repair.runtimes[name], expected:repair.expected, deadline: repair.startedAt + 60000};
}
