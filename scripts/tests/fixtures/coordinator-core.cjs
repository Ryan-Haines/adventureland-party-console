// The coordinator's core answers, as the application installs them at start (application.ts
// `installCoordinatorTargeting`, `installCoordinatorMovement`). A test that runs coordinator code without the application
// requires this file, since `targeting.passing` fails with no answer (runtime/hooks/registry.ts).
// Its group lookup names no record, so `targeting.fight` answers none here.
const {partyHooks}=require('../../../runtime/hooks/index.ts');
const {installCoordinatorTargeting}=require('../../../runtime/coordinator/targeting/install.ts');
installCoordinatorTargeting(partyHooks(),{state:()=>undefined,now:()=>Date.now()});
// Movement's coordinator answers, as application.ts `installCoordinatorMovement` registers them:
// the queue asks the terrain recovery round (movement/coordinator/recovery.ts).
partyHooks().register(require('../../../runtime/movement/coordinator/runtime.ts').coordinatorMovementRegistration(() => undefined, { time: async () => 0, statuses: () => ({}) }, partyHooks().walks));
// The hunting owner's published reads, as runtime/hunting/coordinator/install.ts `reads` answers a group with no
// record: no farming focus. The walk's defense step asks it (defense.ts `huntNeedsDefense`).
partyHooks().publish({ name: 'core:hunting-reads', folder: 'core', author: 'test', summary: "Answers a group's farming focus.",
  hooks: { 'farming.focus': () => undefined } });
// The events owner's answers as events/coordinator/install.ts gives them: `event.cycle` from the party's anniversary
// cycle and `event.pending` from the member's report. A row that plants either sets `events.party`
// to its state; the default party holds neither.
const {cycleHolds}=require('../../../runtime/events/coordinator/anniversary.ts');
const events={party:()=>undefined};
partyHooks().publish({ name: 'core:events', folder: 'core', author: 'test', summary: "Answers 06's anniversary cycle hold and event pending.",
  hooks: { 'event.cycle': () => cycleHolds(events.party()?.anniversary?.eventCycle),
    'event.pending': name => !!events.party()?.statuses?.[name]?.huntEventPending } });
module.exports = { events };
