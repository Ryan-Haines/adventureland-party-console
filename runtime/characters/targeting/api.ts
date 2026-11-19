// The targeting owner's door on the character realm and for both realms' shared reads: the passing
// encounter's key and merge and the passive hunting stop rule, which the coordinator's queue, the
// walk's defense (movement, through this door; S-04p closed) and the character's passing code all
// read. It holds no node-only import, so a character bundle may load it.
import type { PassiveSettings } from '../../hunting/api.ts';
import type { Member, Target } from '../../coordinator/targeting/api.ts';
import type { Target as RoleTarget } from '../turns/api.ts';
import { pick } from './saved-fields.ts';
import { fresh, notAhead, reportClockError } from '../../protocol/reports.ts';
import { placeKey } from '../../protocol/place.ts';
import { LIST_BOUNDS } from './rules.ts';

// The answer of `targeting.target`: the target, its passing flag, whether support casts may go
// on it, whether a selection is due, and the attack source's two reads (E04-a,
// E03-t4): the crab range sample and the target revision. With no target the answer is `{ due: true }`
// while a selection is due, and nothing otherwise.
export interface TargetAnswer { target: RoleTarget; passing: boolean; support: boolean; due: boolean; range: unknown; revision: string | null }
// The threat fact (`targeting.threat`): b9b5c91e's two facts for survival's fight test, with the
// policy inside the fact named. `attacking` is whether a monster this client sees targets a party
// member (shared.js `isAttackingPartyMember`, the way `groupedThreatReports` reads it); its passing
// and return conditions stay in the fact (decided under AV), so the answer names them
// `return-only`. `partyTarget` is whether a party member's target is alive in view (shared.js
// `getNearestPartyTarget`), read only when no monster attacks, as b9b5c91e's survival fight test
// read it.
export interface ThreatAnswer { attacking: boolean; partyTarget: boolean; passing: 'return-only' }
// The payloads of the targeting owner's notices. Each names its source in `by` where a row has one.
// `targeting.changed` and `targeting.passed`: the selection pass's publish, with S's or K's row.
export interface ChangedNotice { character: string; from: string | null; to: string | null; row: string | null; by: string }
export interface PassedNotice { character: string; target: string | null; row: string | null; by: string }
// The ring's records: a refusal (`refused`, with its G check and A's row), a skip (`skipped`), a retire
// (`retired`) and the set-aside list cleared at a fight's start (`cleared`).
export interface RingNotice { character: string; kind: 'retired' | 'skipped' | 'refused' | 'marks-cleared'; target?: string; skill?: string;
  why?: string; row?: string; by?: string; damage?: number; hp?: number }
// The queue's nomination, a fight's change of state and a successor grant, on the coordinator.
export interface NominatedNotice { group: string; target: string; revision: string; by: string }
export interface FightStateNotice { group: string; target: string; from: 'planned' | 'engaged' | null; to: 'planned' | 'engaged' | 'retired' | 'lost' | 'reset'; reason: string }
export interface GrantNotice { group: string; predecessor: string; successor: string; reason: string }
export type PassiveTravelSettings = Pick<PassiveSettings, 'rules'>;
/** An explicit enabled stop rule wins over Hunt's moving-attack exception. */
export function passiveStopRequired(settings: PassiveTravelSettings | undefined, mtype: string): boolean {
  const rule=settings?.rules[mtype];
  return !!rule?.enabled && rule.keepMoving===false;
}
// Queue A31: a rare whose "May interrupt Hunt" switch is off does not stop Hunt mission travel. The
// character's stop candidates and the coordinator's reconcile (hunt-travel.ts) both ask it; a
// character with no walk under way has no Hunt mission to keep.
export function huntSwitchAllows(walk: { requester?: { tier?: string } } | null | undefined, settings: PassiveTravelSettings | undefined, mtype: string): boolean {
  return walk?.requester?.tier !== 'hunt-mission' || settings?.rules[mtype]?.interruptsHunt !== false;
}

export interface PassingEncounter extends Target { server?: string; at: number; startedAt?: number; reserved?: boolean;
  /** Explicit passive keep-moving reservation; retaliation cannot acquire travel ownership. */
  keepMoving?: boolean;
  admission?: {scope: string; token: string} }
export const passingIdentity = (t: {server?:string;map:string;in?:string|number;id:string}) =>
  JSON.stringify([t.server,t.map,placeKey(t),String(t.id)]);

// A reservation counts while it is younger than the passing memory and no further ahead than its
// stamper's measured clock difference (`aheadMs`) allows.
const recent = (at:number,now:number,aheadMs=0) => Number.isFinite(at) && now-at<pick('passingMemoryMs') && notAhead(at,now,aheadMs);
function sameLocation(e:PassingEncounter,s:NonNullable<Member['status']>):boolean {
  return e.server===s.server && e.map===s.map && String(e.in??e.map)===String(s.in??s.map);
}
function memberReservations(member:Member,now:number):PassingEncounter[] {
  const s=member.status;
  if(!s || !fresh(s.seenAt,now))return [];
  return (s.groupedCombat?.passingEncounters||[]).filter(e=>sameLocation(e,s) && recent(e.at,now,reportClockError(s)));
}
function latestReservations(members: Member[], previous: PassingEncounter[], now: number): Map<string,PassingEncounter> {
  const result = new Map<string,PassingEncounter>();
  const reservationKey=(e:PassingEncounter)=>JSON.stringify([passingIdentity(e),e.admission?.token]);
  for (const entry of previous) if (recent(entry.at,now))
    result.set(reservationKey(entry),entry);
  for (const member of members) {
    for (const e of memberReservations(member,now)) {
      const key=reservationKey(e), old=result.get(key);
      if (!old || old.at<e.at) result.set(key,e);
    }
  }
  return result;
}
// Responses call collectPassing twice per report and most reports carry no encounter, so
// collectPassing reads the death lists only when an encounter needs them, once per call.
function deathTimes(encounters: PassingEncounter[], members: Member[]): Map<string,number[]> {
  const times=new Map<string,number[]>(encounters.map(e=>[passingIdentity(e),[]]));
  for (const member of members)
    for (const d of member.status?.groupedCombat?.deaths||[]) times.get(passingIdentity(d))?.push(d.at);
  return times;
}
/** Exact, recent encounter reservations suppress retaliation ownership. */
// The list keeps the newest LIST_BOUNDS.passing; the queue, whose copy rides on every reply, hands
// `overflow` the count it drops so the bound reports through boundFired.
export function collectPassing(members: Member[], previous: PassingEncounter[], now: number, overflow?: (count: number) => void): PassingEncounter[] {
  const encounters=[...latestReservations(members,previous,now).values()];
  if (!encounters.length) return [];
  const deaths=deathTimes(encounters,members);
  const live=encounters.filter(e=>!deaths.get(passingIdentity(e))!.some(at=>at>=(e.startedAt??e.at))).sort((a,b)=>a.at-b.at);
  if (live.length>LIST_BOUNDS.passing) overflow?.(live.length);
  return live.slice(-LIST_BOUNDS.passing);
}
export { MONSTER_PRIORITY, validMonsterPriorities } from './saved-fields.ts';
export { installPorcupineEquipment } from './porcupine.ts';
export { installTargeting } from './install.ts';
export { createCrabRangeRecovery, effectiveAttackDamageType } from './gates.ts';
export { installQueueClient } from './queue-client.ts';
export type { SelectionPass } from './selection.ts';
// The shapes the turns owner's role types read of the targeting owner's module (turns/role-types.ts SharedCombat, CombatState, CombatRoot).
export type { TargetingMap } from './install.ts';
export type { RangeDiagnostic, RangeSample, SkillTargetAllowed } from './gates.ts';
export type { EntityRefreshDiagnostic } from './queue-client.ts';
export type { createPorcupineEquipment } from './porcupine.ts';
