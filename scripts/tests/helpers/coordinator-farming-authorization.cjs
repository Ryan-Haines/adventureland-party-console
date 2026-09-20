const {authorizeCoordinatorFarmingRoute} = require('../../../runtime/coordinator/navigation/runtime.ts');

/** Bind the production authorization function to each integration fixture's live controls. */
exports.installFarmingAuthorization = context => {
  context.authorizeFarmingRoute = (names, destination, shared = false) => authorizeCoordinatorFarmingRoute(context.party, names, destination, shared, {
    release: () => context.escapeControl.release(), authorize: (...args) => context.farmingNavigation.authorize(...args),
  });
};
