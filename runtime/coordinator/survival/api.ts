// The survival owner's public file on the coordinator, like the events owner's and the hunting owner's coordinator doors:
// what another owner's
// coordinator code imports from survival, all from records.ts, so no coordinator file loads the
// character install. The status owner's card line reads the card words and the recovery's phase rule, the status owner's reply
// the two sections 05 writes, the tasks owner's holds whether the escape holds the party until Resume, and the hunting owner's
// Hunt reset ends the party death recovery.
export { DEAD_LABEL, ESCAPE_TASK_LABEL, endRecovery, escapeHolds, escapeReply, partyDeathLabel, recoveryReply, recoveryRuns } from '../../characters/survival/records.ts';
// The escape and death recovery records the party keeps (`party.escape`, `party.combatRecovery`),
// which the saved fields declare.
export type { PartyEscape } from './escape.ts';
export type { PartyRecovery } from './recovery.ts';

// What the lifecycle owner's composition root (runtime/coordinator/application.ts) and its contract check
// (initialization.contract-check.ts) compose of this owner.
export { createSurvivalRoutes } from './routes.ts';
export { installCoordinatorSurvival, type SurvivalParty } from './install.ts';
