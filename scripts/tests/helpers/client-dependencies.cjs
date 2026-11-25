// Ordinary combat scenarios start without passing encounters. The passing and passive predicates
// are targeting module functions (targeting-module.cjs `targetingModule` builds them over this
// context over the test's `doors`), and the Hunt travel reads are huntClient members, which a sliced
// context answers absent. Movement's walks door is the context's walk client (helpers/walk-reports.cjs)
// under the members the test's `doors.walks` names, and its realm is the context's `reunionRealm`,
// which the walk client reads too.
exports.passingContext = (values, doors) => {
  const walks = { reunionRealm: () => context.reunionRealm(), ...doors?.walks };
  const context = require('./shared-context.cjs').createSharedContext({
    passingEncounters: {}, peerPassingEncounters: [], coordinatorClockOffset: 0,
    groupedCombat: null,
    navigationIntent: {}, partyTownActive: false, banking: false, stocking: false,
    upgrading: false, gatheringActive: false, forceTraveling: false, townTraveling: false,
    eventAnniversary: { staging: () => false, busy: () => false }, root: {},
    escapeOwns: () => false, combatRecoveryHolds: () => false, eventReturnHolds: () => false, taskKind: () => null,
    eventAttend: { active: () => false, joined: () => null, traveling: () => null }, rareActive: () => false, unfinishedFight: () => false,
    reunionRealm: () => 'USII', ...values,
  }, { ...doors, walks });
  // The walk client needs the context, so it joins the door once the context exists.
  Object.setPrototypeOf(walks, require('./walk-reports.cjs').installWalkReports(context).__walkClient);
  return context;
};
