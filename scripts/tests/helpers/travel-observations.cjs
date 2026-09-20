// Existing route fixtures advance their entity observations with seenAt.
exports.observeTravel = function observeTravel(statuses) {
  for (const status of Object.values(statuses)) {
    status.groupedCombat ||= {};
    status.groupedCombat.currentAttackers ||= [];
    Object.defineProperty(status.groupedCombat, 'currentAttackersAt', { configurable: true, enumerable: true, get: () => status.seenAt });
  }
  return statuses;
};
