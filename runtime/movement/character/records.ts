// The character's movement records: the diagnostics each failed or fallback journey writes, and
// the error helpers the owner and executor share, movementError (a coded journey error),
// retryableMovementRequest (which planner failures a caller may ask again) and
// movementFailureCause (the cause a failed journey reports).
import { point, type Point, type Issue } from '../geometry/contracts.ts';
import type { MovementHost, MovementPorts } from '../../protocol/records.ts';
const coordinates = (p: Point) => `${p.map} (${Math.round(p.x * 100) / 100}, ${Math.round(p.y * 100) / 100})`;
// A requested destination: a point, or the place name or monster type `move` takes.
const place = (value: unknown) => value && typeof value === 'object' && Number.isFinite((value as Point).x) ? coordinates(value as Point) : String(value);
// Each diagnostic goes to the game log, red for a failed journey and grey for a native fallback
// that succeeded, and to the dashboard's navigation events (moved from shared.js's install). RF6
// class D: a diagnostic is written once while the journey that last wrote it lives, and a repeat
// only counts, whatever was written between. `end` runs when a journey ends: a diagnostic of that
// journey that repeated is written once more with its count, and the journey's lines leave the map,
// so it holds only live journeys' lines.
export function movementDiagnostics(host: Pick<MovementHost, 'game_log'>, ports: Pick<MovementPorts, 'now' | 'events'>, name: string, version: number, fingerprint: string) {
  const written = new Map<string, { journey: string; count: number; write(count: number): void }>();
  function report(id: string, destination: Point, phase: string, issue?: Issue, detail?: string, context?: Record<string, unknown>) {
    destination = point(destination);
    if (issue) issue = {reason:issue.reason,from:point(issue.from),to:point(issue.to)};
    // `destination` is the journey that ended; a replaced journey's line also names the request
    // that replaced it (owner.ts `move`).
    const replacement = context?.replacement === undefined ? '' : `. Replaced by: ${place(context.replacement)}`;
    const message = `${name}: ${description(phase, issue, detail)}. Destination: ${coordinates(destination)}${replacement}. Journey: ${id}; game ${version}; geometry ${fingerprint}.`;
    const key = JSON.stringify([context?.convoyId || id, phase, detail, issue, destination]);
    const prior = written.get(key);
    if (prior) { prior.count++; prior.journey = id; return; }
    const write = (count: number) => {
      const now = ports.now(), text = message + (count > 1 ? ` Similar messages: ${count} (not route attempts).` : '');
      host.game_log(text, phase === 'Movement failed' ? 'red' : phase === 'Native fallback succeeded' ? '#94a3b8' : '#fbbf24');
      ports.events('navigation', text, { id, character: name, version, fingerprint, destination, phase, issue, detail, context, count, at: now }, `movement:${id}:${phase}:${now}`);
    };
    written.set(key, { journey: id, count: 1, write });
    write(1);
  }
  function end(id: string) {
    for (const [key, entry] of written) if (entry.journey === id) {
      if (entry.count > 1) entry.write(entry.count);
      written.delete(key);
    }
  }
  return Object.assign(report, { end });
}

function description(phase: string, issue?: Issue, detail?: string): string {
  return phase + (issue ? ` — ${issue.reason} between ${coordinates(issue.from)} and ${coordinates(issue.to)}` : '') +
    (detail && detail!==phase ? `; ${detail}` : '');
}

export function movementError(value: unknown): Error & {partyRequest?: unknown} {
  if (value instanceof Error) return value;
  const object = value && typeof value === 'object' ? value as {message?: unknown; reason?: unknown; partyRequest?: unknown} : {};
  const message = [object.message, object.reason, value].find(item => typeof item === 'string' && item.length);
  return Object.assign(new Error(typeof message === 'string' ? message : 'Movement cancelled'),
    object.partyRequest ? {partyRequest: object.partyRequest} : {});
}
export function retryableMovementRequest(value: unknown): boolean {
  const r = movementError(value).partyRequest as {kind?: string; status?: number} | undefined;
  return !!r && (r.kind === 'network' || r.kind === 'timeout' || r.status === 408 || r.status === 429 || Number(r.status) >= 500);
}

export function movementFailureCause(failure: unknown, cause?: Record<string, unknown>): Record<string, unknown> | undefined {
  const request = movementError(failure).partyRequest as {path?: string; kind?: string; status?: number; code?: string} | undefined;
  if (!request) return cause;
  if (request.path === '/movement-barrier' &&
      (request.kind === 'aborted' || request.status === 409 && request.code === 'superseded'))
    return {...cause, partyRequest: request, code: 'superseded'};
  return {...cause, partyRequest: request, ...(retryableMovementRequest(failure) ? {code: 'convoy-communication-hold'} : {})};
}
