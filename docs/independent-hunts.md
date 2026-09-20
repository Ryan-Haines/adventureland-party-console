# Independent Monster Hunts

Farming ownership follows the dashboard leader and Follow switches, not in-game party membership.
The main leader and enabled followers share one controller. Each non-following combat character
has its own farming profile and can select Hunt independently. Merchants and BankBois cannot Hunt.

## Saved versus effective mode

A profile retains its mode, backup farming focus/location, Hunt settings, blacklist and failure
counts. New solo profiles start in Auto with default settings and no blacklist. Existing personal
focus/location selections are retained. The old global profile migrates to the current leader.

Enabling Follow retires solo commands and movement, preserves the actual quest and personal
preferences, and joins the leader's current work. The leader's selected mission keeps priority.
Disabling Follow restores the saved mode and reconciles the current quest instead of replaying
an old route. A departing selected quest owner is removed from the old controller's selection.

Follower mode buttons save the personal mode used when Follow is disabled; they do not alter active leader farming. Hunt settings remain read-only. The saved mode remains selected inside the expansion; the collapsed follower badge reads Copy leader. Thus saved Hunt survives a leader changing to Auto.

## Runtime and API ownership

`hunt/scopes.ts` provides stable owner-specific views. Shared observations, command IDs and
per-character navigation revisions remain authoritative; Hunt cycles, convoys, blacklists,
scatter state and ordinary event returns are independent. Legacy global fields alias the main
leader's profile. `farmingProfiles` is persisted and returned by the dashboard state API.

Farming-mode, Hunt settings and blacklist requests accept `character`. Omitted addressing
retains the main-group API. Follower Hunt settings and blacklist mutations return 409; mode changes save personal preferences only (and require a valid personal backup location for Hunt); workflow acknowledgements resolve
the effective owner and retain existing command/cycle/route identity checks. Successful edits
include `farmingOwner`, `savedFarmingPolicy`, and `effectiveFarmingPolicy`.

## Validation

Run `scripts/tests/solo-hunt.test.cjs` and `scripts/tests/solo-hunt-ui.test.cjs`, plus the repository
checks in the coordinator README. Live validation needs a main group and a non-following combat
character: start separate Hunts and observe pickup, approach, attacks, loot and turn-in for each.
Test Follow on, leader Auto, Follow off; the personal Hunt must resume with its own blacklist.
Use the documented coordinator-only restart to preserve current character assets.
