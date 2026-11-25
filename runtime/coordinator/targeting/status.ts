// The heartbeat's targeting parts:
// the party's threat and target lists and the passing
// reports and control each reply carries. Table R's grouped combat and party sections ask these
// reads (runtime/status/coordinator/reply.ts, table R).
import type { EntityReference, HeartbeatState } from '../../status/api.ts';
import { passingControl } from './queue.ts';
import { collectPassing } from '../../characters/targeting/api.ts';
import type { Member } from './api.ts';
import { outboundHunt } from '../../movement/api/coordinator.ts';

// One entry per id, first seen first, for the reply's `partyThreats` and `partyTargets`.
export function uniqueReferences(entries: (EntityReference | null | undefined)[]): EntityReference[] {
  const seen = new Set<string>();
  return entries.filter((entry): entry is EntityReference => {
    if (!entry || typeof entry.id !== "string" || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

interface PassingStatusPorts { activeNames(): string[]; now(): number; navigationRevision(name: string): number }
// The passing reports of the active members, and the passing control of the live walk's members.
export function createPassingStatus(state: HeartbeatState, ports: PassingStatusPorts) {
  function passingReports() {
    return collectPassing(ports.activeNames().map(name=>({name,ctype:'',revision:0,status:state.statuses[name]})) as Member[],[],ports.now());
  }
  function passingAdmission() {
    const convoy=state.activeConvoy;
    const names=outboundHunt(convoy) ? convoy!.participants : [...new Set([...ports.activeNames().filter(name=>name!==state.merchantCharacter),...(convoy?.participants||[])])];
    const members=names.map(name=>({name,ctype:'',revision:ports.navigationRevision(name),status:state.statuses[name]})) as Member[];
    return passingControl(members,convoy ? [convoy.id,convoy.epoch] : null,ports.now(),convoy,state.passiveHunting);
  }
  return { passingReports, passingAdmission };
}
