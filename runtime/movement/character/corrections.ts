// The server's position corrections during an owned walk (moved from b9b5c91e
// runtime/characters/movement-correction.ts by way of planner.ts).
import type { MovementHost } from '../../protocol/records.ts';
import type { ScopeHandle } from '../../lifecycle/api.ts';
import { movementError } from './records.ts';

interface CorrectionRecord { at: number; map: string; in?: string | number; x: number; y: number; stopRequested: boolean; stopError?: string }

// Native 15555 accepts correction before CODE listeners, but leaves the old
// origin velocity when speed is unchanged. Stop only the accepted owned walk;
// the normal executor must validate its remaining connector on the next tick.
export function observeMovementCorrections(host: MovementHost, walking: () => boolean, pause: () => void, now: () => number, scope: ScopeHandle) {
  const socket=host.parent.socket;
  const records: CorrectionRecord[]=[];
  function accepted(value: unknown): boolean {
    if(!value || typeof value!=='object')return false;
    const p=value as {x?:unknown;y?:unknown},c=host.character;
    return typeof p.x==='number' && Number.isFinite(p.x) && typeof p.y==='number' && Number.isFinite(p.y) &&
      c.real_x===p.x && c.real_y===p.y;
  }
  // A correction the walk accepted pauses it. The native stop's failure stays on the record, so the
  // movement report names a correction whose stop did not go; socket delivery goes on either way.
  function corrected(value: unknown) {
    if(!accepted(value) || !walking() || host.is_transporting(host.character) || !host.can_walk(host.character))return;
    const c=host.character,record: CorrectionRecord={at:now(),map:c.map,in:c.in,x:c.real_x,y:c.real_y,stopRequested:false};
    records.push(record);if(records.length>4)records.shift();
    try { pause(); record.stopRequested=true; } catch (error) { record.stopError=movementError(error).message; }
  }
  // Movement's `act` registration: the generation's stop removes it with the rest.
  scope.on(socket,'correction',corrected);
  function dispose() { scope.off(socket,'correction',corrected); }
  return {report:()=>records.map(record=>({...record})),dispose};
}
