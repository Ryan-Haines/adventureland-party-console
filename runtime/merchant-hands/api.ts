// The hands owner's public file: what the rest of the
// console and the other owners may import of runtime/merchant-hands/. The character owner publishes
// through partyHooks (`hands.normal`) and the character door `partyMerchant.hands`
// (character/owner.ts). rules.ts and the call budget's limits import nothing, so the dashboard can
// load this door.
export { DASHBOARD_EQUIPMENT_TYPES } from './rules.ts';
// The game server's call limit per window, which the dashboard's CC meter fills to.
export { CALL_LIMIT } from '../characters/call-budget-limits.ts';
