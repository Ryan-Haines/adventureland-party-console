// The events owner's coordinator install: the
// per-report ingest in today's order and the answers the composition hands to other owners. It holds
// no rule of its own: each answer reads its own table (occurrences.ts and its scheduled walks, attendance.ts, the
// anniversary rows anniversary.ts, the A/B strategy abtesting.ts, returns.ts). application.ts
// makes the one `installEvents` call.
import { adoptAddonKinds, merchantAnniversaryReserved, selectedEvents } from '../rules.ts';
import type { EventFormation } from '../rules.ts';
import { attendableEvents, eventAdmitted, observeEventAttendance } from './attendance.ts';
import type { AttendanceReport, CaveAnswer, EventReport, SavedEventState } from './attendance.ts';
import { anniversaryCombatMembers, cycleHolds, merchantAnniversaryState } from './anniversary.ts';
import type { AnniversaryParty } from './anniversary.ts';
import { updateCoordinatorABStrategy } from './abtesting.ts';
import { merchantAnniversaryControl } from '../../merchant-jobs/api.ts';
import { createOccurrences } from './occurrences.ts';
import { cipherClaims, type CipherClaimParty } from './cipher.ts';
import type { OccurrenceReport, WalkReport } from './occurrences.ts';
import { eventPresence, publishEventAnswers } from '../api.ts';
import { tasks } from '../../tasks/api.ts';
import { partyHooks } from '../../hooks/index.ts';
import type { Registration } from '../../hooks/registry.ts';

export type EventsParty = Parameters<typeof eventAdmitted>[0] & Parameters<typeof observeEventAttendance>[0] &
  Parameters<typeof updateCoordinatorABStrategy>[0] & AnniversaryParty & CipherClaimParty & Pick<SavedEventState, 'deferredEventReturns'>;
type ReturnGroup = { eventReturns: { reconcile(): void } };
// The full report the ingest takes: the attendance fields, the admission fields (attendance.ts) and
// the walk fields (occurrences.ts). Each step takes it as its own type, so a field typed apart from
// what a step reads fails to compile.
type IngestReport = AttendanceReport & EventReport & WalkReport;
type Observer = { admit(report: IngestReport): unknown; observe(report: IngestReport): void };
interface EventsPorts {
  // The Cave's answer for its participants.
  dungeons: { eventAllowed: CaveAnswer };
  groups: { combat(): ReturnGroup[]; solo(name: string): ({ eventObservations: Observer } & ReturnGroup) | null;
    walkGroup(key: string): ReturnGroup | undefined };
  partyObservations(): Observer;
  partyReturns(): ReturnGroup['eventReturns'];
  // The tasks owner's table: whether the group's task runs the event return or the anniversary (2.4 gap 3).
  runs(kind: 'event-return' | 'anniversary'): boolean;
  anniversary(): { tick(): void; schedule(): void; settle(): void };
  observeTask(name: string): void;
  // The tasks owner's table: whether the member may take an event-attendance task now, which an add-on's
  // event.join needs as a core attendance does.
  admits(name: string): boolean;
  activeNames(): string[];
  persist(): void;
}

export function installEvents(party: EventsParty, ports: EventsPorts) {
  const now = () => Date.now();
  const admitted = (name: string, event?: string) => eventAdmitted(party, name, event, ports.dungeons.eventAllowed, now());
  // The scheduled walks, and `event.schedule` over them.
  const occurrences = createOccurrences(now);
  publishEventAnswers({ schedule: occurrences.schedule, deferredReturn: name => !!party.deferredEventReturns?.[name] });
  // The return look: the anniversary dispatch a visit asked for, the event return of the groups
  // named, then the anniversary return, each return while the tasks owner's table runs its task. The
  // event return is suspended under escape, death recovery and every task above attendance, and
  // resumes from its record after them. One look runs at a time. A walk notice the running look's
  // own cancel or dispatch fires for a group it already reconciled is that look's result; a look asked
  // meanwhile for another group queues it, and the running look takes the queue before it ends, so no
  // look nests and no group's notice is lost.
  let queued: Set<ReturnGroup['eventReturns']> | null = null;
  function look(groups: ReturnGroup['eventReturns'][]): void {
    if (queued) { for (const returns of groups) queued.add(returns); return; }
    const done = new Set<ReturnGroup['eventReturns']>();
    let next = groups;
    try {
      for (;;) {
        queued = new Set();
        ports.anniversary().settle();
        for (const returns of next) done.add(returns);
        if (ports.runs('event-return')) for (const returns of next) returns.reconcile();
        if (ports.runs('anniversary')) ports.anniversary().tick();
        next = [...queued].filter(returns => !done.has(returns));
        if (!next.length) break;
      }
    } finally { queued = null; }
  }
  // The merchant's anniversary state over the merchant jobs owner's control answer, which both answers below read.
  const merchantState = () => merchantAnniversaryState(party, admitted, now(), merchantAnniversaryControl);
  const allGroups = () => ports.groups.combat().map(group => group.eventReturns);
  // The return looks when its state changes: a member's report (the
  // ingest below), the end or phase change of a group walk (movement's notices) and a settings change
  // (the return policy's farming mode). A completed anniversary visit's dispatch waits on the walk end.
  const registration: Registration = { name: 'core:event-returns', folder: 'core', author: 'adventureland-party-console',
    summary: "Moves a group's event return and the anniversary return on when a group walk ends or changes phase, or a setting changes, claims the Cipher ingredients for the merchant while a round's plan is live, answers a member's event presence and a group's event schedule, and reads the add-ons' event kinds.",
    hooks: {
      'walk.phase'(notice) { const group = ports.groups.walkGroup(String(notice.group ?? '')); if (group) look([group.eventReturns]); },
      'walk.ended'(notice) { const group = ports.groups.walkGroup(String(notice.group ?? '')); look(group ? [group.eventReturns] : []); },
      'settings.changed'() { look(allGroups()); },
      'group.changed'(notice) { if (Array.isArray(notice.members) && !notice.members.length) occurrences.groupGone(String(notice.group ?? '')); },
      // The Cipher's rule: the round's ingredients belong with the merchant, through the items owner's claims.
      'items.claim': view => cipherClaims(party, view),
      // An add-on's event kinds join the kinds table when it is turned on and leave when it is turned off.
      'addon.on'() { adoptAddonKinds(partyHooks().events.kinds()); },
      'addon.off'() { adoptAddonKinds(partyHooks().events.kinds()); },
      // The published reads an add-on may ask: the attendance presence and the schedule.
      'event.presence': name => eventPresence(name),
      'event.schedule': occurrence => occurrences.schedule(occurrence),
      // EVT-011: the character's attend client reports whether its Hunt waits on an event.
      'event.pending': name => !!(party.statuses[name] as { huntEventPending?: boolean } | undefined)?.huntEventPending,
      // EVT-043: the anniversary cycle holds the party from its staging to its return.
      'event.cycle': () => cycleHolds(party.anniversary.eventCycle),
    } };
  const result = partyHooks().publish(registration);
  if (!result.ok) throw Error(`The events owner's core:event-returns did not load: ${result.message}`);
  adoptAddonKinds(partyHooks().events.kinds());
  return {
    eventsEnabledFor: admitted,
    // The selection order, which the attendance record follows.
    selected: (name: string) => selectedEvents(party, name),
    merchantAnniversaryControl: merchantState,
    anniversaryReserved: () => merchantAnniversaryReserved(merchantState()),
    anniversaryCombatParticipants: () => anniversaryCombatMembers(ports.activeNames(), party.merchantCharacter, admitted),
    resolveAbtestingStrategy: () => updateCoordinatorABStrategy(party, { activeNames: ports.activeNames, enabled: admitted, now, persist: ports.persist }),
    // The ingest, once per full report: the attendance limits, then the schedule's walks of the member's
    // group, whose leads the staging admission reads and the reply carries, then the admission by
    // the member's group observer, then the tasks owner's one event fact, which
    // reads the admission, then the rest of the observer, then the return look at the member's group.
    observe(report: IngestReport): void {
      if (observeEventAttendance(party, report, now())) ports.persist();
      // The member's group is the tasks owner's (`tasks().groupOf`); a member in no group has no walk to time.
      const group = tasks().groupOf(report.name), status = party.statuses[report.name] as OccurrenceReport | undefined;
      if (status) status.eventLeads = group ? occurrences.observe(group, report) : null;
      const solo = ports.groups.solo(report.name), observer = solo?.eventObservations || ports.partyObservations();
      observer.admit(report);
      ports.observeTask(report.name);
      observer.observe(report);
      look([solo?.eventReturns ?? ports.partyReturns()]);
    },
    attendableEvents: (eventState: EventFormation, name: string) => attendableEvents(party, eventState, name),
    // An anniversary route's ask for the return's dispatch, made in the same look.
    anniversaryDispatch(): void { ports.anniversary().schedule(); look([]); },
  };
}
