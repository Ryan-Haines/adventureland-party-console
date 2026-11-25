// The groups and tasks owner's coordinator door:
// the coordinator values of runtime/tasks/ that the hunting owner's coordinator code calls. runtime/tasks/api.ts holds
// the rule values and types every runtime reads, so the dashboard bundle loads none of these.
// The Hunt entry's select (slots.ts), which the hunt mode route (runtime/hunting/coordinator/routes.ts) asks.
export { createHuntMode } from './slots.ts';
// The group's members a Hunt takes in (groups.ts), which the hunting owner's roster repair reads.
export { coordinatorHuntParticipants } from './groups.ts';

// What the lifecycle owner's composition root (runtime/coordinator/application.ts) and its contract check
// (initialization.contract-check.ts) compose of this owner.
export { ladderPort } from './owner.ts';
export { installTasks, type PartyRecord } from './install.ts';
export { type ScopePorts } from './slots.ts';
export { activeOf, createCombatGroups, createFarmingScopes, groupId, groupKey, reconcileFarmingMembership } from './groups.ts';
export { createScopedRoutes, installTaskRoutes } from './routes.ts';
// Table R's party and leader sections, which the status owner's heartbeat reply maps (reply.ts).
export { leaderReply, partyReply } from './reply.ts';
