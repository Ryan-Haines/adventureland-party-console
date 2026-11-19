// The event fields of the heartbeat reply: the member's follow and event switches, its limits, the
// party hint, the Cipher plan and stock owner, the party's Slenderman sighting, the admission of the
// member's live event and the anniversary, and the return cycle that the return section carries
// on the combat poll too. Moved from runtime/coordinator/status/response.ts (`liveEvent`,
// `returnResponse`'s cycle, `cipherGathering`), response-party.ts (the sighting functions) and
// response-composition.ts (`selectedEvents`), and the event switches, limits and anniversary from the
// status owner's events section (status/coordinator/reply.ts). The status owner's reply spreads
// `eventReply(name)` as its events section and `returnReply(name)` into its return section (table R).
import { requestObject } from '../../lifecycle/api.ts';
import { played, type SettingsRead } from '../../settings/api.ts';
import { eventLimits, type EventFormation } from '../rules.ts';
import type { HeartbeatState, HeartbeatStatus, SlendermanSighting } from '../../status/api.ts';
import { cipherEntry, cipherIngredients, type CipherGatheringContext } from '../october.ts';
import { fresh, reportClockError } from '../../protocol/reports.ts';
import { cipherFetching } from './cipher.ts';

interface EventReplyPorts {
  now(): number;
  activeNames(): string[];
  enabled(name: string, event?: string): boolean;
  // The selected events the member may still attend (installEvents' `attendableEvents`).
  selectedEvents(state: HeartbeatState, name: string): string[];
  // The settings owner's `settings.read`, for the declared event settings the limits read.
  setting(query: SettingsRead): unknown;
  anniversary(): unknown;
}

function sightingScope(report: HeartbeatStatus, sighting: SlendermanSighting, server: string | undefined): boolean {
  return !!server && report.server === server && sighting.server === server &&
    report.map === sighting.map && report.in === sighting.in;
}

function sightingPosition(sighting: SlendermanSighting): boolean {
  return typeof sighting.id === 'string' && !!sighting.id && typeof sighting.map === 'string' &&
    !!sighting.map && Number.isFinite(sighting.x) && Number.isFinite(sighting.y);
}

export function createEventReply(state: HeartbeatState, ports: EventReplyPorts) {
  const setting = <T,>(field: string): T | undefined => ports.setting({ field }) as T | undefined;
  // The declared event settings the limits read.
  const formation = (): EventFormation => ({ leader: setting('leader'), merchantCharacter: setting('merchantCharacter'),
    followers: setting('followers'), eventsByCharacter: setting('eventsByCharacter'), eventLimitsByCharacter: setting('eventLimitsByCharacter'),
    eventPrioritiesByCharacter: setting('eventPrioritiesByCharacter'), eventSelectionsByCharacter: setting('eventSelectionsByCharacter') });
  function selectedEvents(name: string): string[] {
    return ports.selectedEvents(state, name);
  }
  function cipherGathering(name:string):CipherGatheringContext {
    const leader=state.leader;
    const shared=!!leader&&selectedEvents(leader).includes('witchcipher')&&
      (name===leader||!!state.followers[name]||name===state.merchantCharacter);
    const owner=shared?leader!:name, realm=state.statuses[owner]?.server;
    const round=cipherEntry(state.statuses[owner])?.board?.id;
    // Independent fighter scopes intentionally omit the merchant from their
    // activeNames port; ingredient accounting still includes that merchant.
    const participants=[...new Set([owner,...ports.activeNames().filter(member=>
      shared&&!!state.followers[member]&&state.statuses[member]?.server===realm),
      ...(state.merchantCharacter&&state.statuses[state.merchantCharacter]?.server===realm?[state.merchantCharacter]:[])])];
    const stock=Object.fromEntries(cipherIngredients.map(id=>[id,0]));
    let ready=true;
    for(const member of participants){
      const report=state.statuses[member];
      const cipher=cipherEntry(report);
      const runtime=cipher?.runtime;
      // A recent heartbeat from before the new round still has old inventory.
      // Require inventory and the current round in the same observation.
      if(!round||cipher?.board?.id!==round||!report||!realm||report.server!==realm||!fresh(Number(report.seenAt),ports.now(),'presence')||!runtime?.stock){ready=false;continue;}
      for(const id of cipherIngredients)stock[id]+=Math.max(0,Number(runtime.stock[id])||0);
    }
    const ownerPlan=cipherEntry(state.statuses[owner])?.runtime?.journal?.gathering;
    const merchant=state.statuses[state.merchantCharacter??''];
    const runtime=merchant&&merchant.server===realm&&fresh(Number(merchant.seenAt),ports.now(),'presence',0,true)?
      cipherEntry(merchant)?.runtime:undefined;
    const shortage=runtime?.journal?.gathering;
    const plan=shortage?.reason==='recipe shortage'&&shortage.owner===owner&&shortage.realm===realm&&
      (!ownerPlan||shortage.round===ownerPlan.round&&shortage.selectedAt>ownerPlan.selectedAt)?shortage:ownerPlan;
    // The merchant's walk to the Witch waits while 10 fetches the round's ingredients to its bag.
    const fetching=cipherFetching(state,name,round);
    return {owner,round,ready,stock,plan,mixesLeft:runtime?.day?.mixes_left,...(fetching?{fetching}:{})};
  }
  function liveEvent(name: string, names: string[]): string | null {
    const reporter = names
      .map((member) => state.statuses[member])
      .find(
        (status) =>
          status &&
          ports.enabled(status.name) &&
          Array.isArray(status.serverLiveEvents) &&
          status.serverLiveEvents.some((event) => ports.enabled(name, event.name)),
      );
    return (
      selectedEvents(name).find(event => reporter?.serverLiveEvents?.some(live => live.name === event)) || null
    );
  }
  // The return cycle a member's reply names: the group's return, or its own deferred row once it
  // is past event admission.
  function returnCycleId(name: string): string | null {
    const deferred = requestObject(state.deferredEventReturns?.[name]);
    const cycleId = state.eventReturn?.participants.includes(name) ? state.eventReturn.cycleId : deferred.phase === "awaiting-event-admission" ? null : deferred.cycleId;
    return typeof cycleId === 'string' ? cycleId : null;
  }
  function slendermanSighting(names: string[], recipientServer: string | undefined): SlendermanSighting | undefined {
    const now = ports.now();
    return names.flatMap(name => {
      const report = state.statuses[name], sighting = report?.slendermanSighting;
      if (!report || !sighting || !sightingScope(report, sighting, recipientServer) ||
          !fresh(report.seenAt, now, 'report') || !fresh(sighting.observedAt, now, 'report', reportClockError(report)) ||
          !sightingPosition(sighting)) return [];
      return [sighting];
    }).sort((a, b) => b.observedAt - a.observedAt)[0];
  }
  // The event fields of one member's full reply: its switches and limits, its selected events and
  // the admission answer the ingest gave its report.
  function eventReply(name: string) {
    const names = ports.activeNames(), sighting = slendermanSighting(names, state.statuses[name]?.server);
    return {
      // Movement's follow (rules.ts `followLeavesCurrentEvent`, FOLLOW_DISTANCE) reads this, so an
      // add-on's Follow overlay plays for the follow while the saved value stays the player's.
      followLeader: !!played(state, 'followers', name)?.[name],
      eventsEnabled: !!ports.enabled(name),
      eventSettings: eventLimits(formation(), name),
      cipherMerchant: state.merchantCharacter,
      eventSelections: selectedEvents(name),
      ...(sighting ? { partySlendermanSighting: sighting } : {}),
      eventAdmission: state.statuses[name]?.eventAdmission ?? null,
      eventRejoin: state.statuses[name]?.eventRejoin ?? null,
      // The schedule's `due` leads of the member's group, which its staging and the Cipher merchant's
      // walk to the Witch time by.
      eventLeads: state.statuses[name]?.eventLeads ?? null,
      cipherGathering: cipherGathering(name),
      partyEventHint: liveEvent(name, names),
      anniversary: ports.anniversary(),
    };
  }
  // The return cycle rides table R's return section, which the combat poll carries too, so the
  // character's exit fence (events/character/exit.ts `observe`) sees a new cycle on either reply, as
  // v1.5.0's combat reply spread it (response.ts:242).
  const returnReply = (name: string) => ({ eventReturnCycleId: returnCycleId(name) });
  // Table R's event-trip section: the Hunt's last event trip for this character.
  const tripReply = (name: string) => ({ eventTrip: state.huntEventTrips?.[name]?.at(-1) || null });
  return { eventReply, returnReply, tripReply };
}
