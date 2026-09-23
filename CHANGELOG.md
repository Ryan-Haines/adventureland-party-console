# Changelog

## Unreleased

Changes queued for the next release. The release workflow determines its version
from the commits merged into `main`.

### Fixed

- Removed unused dashboard notices; previously silent validation and action failures
  now use contextual error feedback. ([#14](https://github.com/Ryan-Haines/adventureland-party-console/issues/14))

- Entirely headless rosters can switch realms without a connected Steam character,
  including switches that set a new home realm. Steam connectivity is still required
  when a Steam-hosted character participates; existing readiness checks remain in
  place. ([#13](https://github.com/Ryan-Haines/adventureland-party-console/issues/13))
- Re-engaging CODE after a console logout recovers the Steam session instead of
  replaying the previous logout or character navigation.
- Monster Hunt lifecycle follows current party membership.
- Convoys recover from departure and walking stalls without repeating retry loops.
- Shared-route geometry mismatches get one bounded reload attempt while preserving
  Hunt membership; stale farming and anniversary checkpoints can recover.
- Monster Hunt preserves travel to its origin and recovers missed Daisy arrival
  acknowledgements.
- Lucky upgrade-slot discovery persists and is available from the inventory menu.
- Merchant collection reservations and routine cancellation recover correctly.

### Changed

- Anniversary participation no longer automatically crafts Sixfold Cakes; complete
  slice sets remain available through the normal exchange menu.
