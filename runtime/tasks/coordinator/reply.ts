// The groups and tasks owner's reply sections (`party` and `leader`): the party each
// member forms and reads, and the leader's target, selection and place. Moved from
// runtime/status/coordinator/reply.ts.
import { uniqueReferences } from '../../coordinator/targeting/api.ts';
import type { HeartbeatState, HeartbeatStatus } from '../../status/api.ts';

// The party positions each member reads of the others (the tasks owner's party
// section).
const positionFields = [
  'ctype', 'map', 'x', 'y', 'escape', 'server', 'seenAt', 'in', 'hp', 'max_hp', 'mp', 'max_mp', 'rip',
  'attack', 'frequency', 'range', 'activeCombatTarget', 'monsterHunt',
  // The turns owner's turns report: each member's ranking reads the others' Energize readiness and
  // damage per MP.
  'turns',
  // Each enabled add-on's own report, which an add-on's `targeting.aggroOwner` reads in the members'
  // views.
  'addonReports',
] as const;
function position(name: string, status: HeartbeatStatus) {
  return {
    name,
    ...Object.fromEntries(positionFields.map((field) => [field, status[field]])),
    ...(status.eventCombatSighting ? { eventCombatSighting: status.eventCombatSighting } : {}),
    kiting: !!status.combat?.kiting,
    team: status.eventTeam || null,
    activeEvent: status.presence?.event ?? null,
    armorPiercing: status.combatStats && status.combatStats.armorPiercing,
  };
}
export function partyReply(state: HeartbeatState, names: string[], leader: HeartbeatStatus | null | undefined) {
  return {
    desiredPartyMembers: names.filter((name) => (name === state.leader || state.followers[name]) && leader &&
      state.statuses[name]?.server === leader.server),
    partyPositions: names.map((name) => position(name, state.statuses[name]!)),
    partyThreats: uniqueReferences(names.filter((name) => name !== state.leader).flatMap((name) => {
      const threats = state.statuses[name]?.threats;
      return Array.isArray(threats) ? threats : [];
    })),
    partyTargets: uniqueReferences(names.map((name) => state.statuses[name]?.target)),
  };
}

// The leader's fields every member reads: its target, its combat selection and its place.
export function leaderReply(state: HeartbeatState, status: HeartbeatStatus | null) {
  return {
    leaderTarget: (status && status.target) || null,
    leaderCombatSelection: status?.combatSelection ? { ...status.combatSelection, leader: state.leader, server: status.server, seenAt: status.seenAt } : null,
    leaderLocation: status ? { map: status.map, x: status.x, y: status.y } : null,
  };
}
