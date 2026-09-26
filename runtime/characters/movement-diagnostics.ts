import { point, type Point, type Issue } from '../navigation/contracts.ts';
import type { MovementPorts } from './movement-host.ts';
const coordinates = (p: Point) => `${p.map} (${Math.round(p.x * 100) / 100}, ${Math.round(p.y * 100) / 100})`;
export function movementDiagnostics(ports: MovementPorts, name: string, version: number, fingerprint: string) {
  const recent = new Map<string, { count: number; at: number }>();
  return (id: string, destination: Point, phase: string, issue?: Issue, detail?: string, context?: Record<string, unknown>) => {
    destination = point(destination);
    if (issue) issue = {reason:issue.reason,from:point(issue.from),to:point(issue.to)};
    const message = `${name}: ${description(phase, issue, detail)}. Destination: ${coordinates(destination)}. Journey: ${id}; game ${version}; geometry ${fingerprint}.`;
    const key = JSON.stringify([context?.convoyId || id, phase, detail, issue, destination]);
    const prior = recent.get(key), now = ports.now();
    const count = (prior && now - prior.at < 60000 ? prior.count : 0) + 1;
    if (prior && now - prior.at < 10000) { prior.count = count; return; }
    recent.set(key, { count, at: now });
    if (recent.size > 100) recent.delete(recent.keys().next().value!);
    ports.diagnostic({ id, character: name, version, fingerprint, destination, phase, issue, detail, context, count, at: now }, message + (count > 1 ? ` Similar messages: ${count} (not route attempts).` : ''));
  };
}

function description(phase: string, issue?: Issue, detail?: string): string {
  return phase + (issue ? ` — ${issue.reason} between ${coordinates(issue.from)} and ${coordinates(issue.to)}` : '') +
    (detail && detail!==phase ? `; ${detail}` : '');
}
