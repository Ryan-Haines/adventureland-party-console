# Merchant and inventory automation

## Ponty shopping

The catalog's Add to Ponty action saves a base-item shopping rule. Catalog browsing
includes non-equipment items; equipment comparisons still filter to equippable
items. The merchant's shopping list supports individual removal and clear-all.
Rules match upgraded/stat variants and authorize matching lots without a quantity
or price ceiling. Purchases can use carried and bank gold, while preserving three
inventory slots for logistics.

Ponty Shop queues a manual trip independently of the hourly cooldown or automatic
toggle. The routine also supports hourly automatic trips, priority control,
durable scanned-server/attempted-listing progress and return to the selected party
realm. Manual retries preserve blocked progress. Higher-priority work can interrupt
between servers; ambiguous purchase attempts are not repeated during that trip.
See [Ponty shopping](ponty-shopping.md).

Carried computers and supercomputers enable remote merchant purchases and item
processing without requiring the item to be equipped. Bank-floor restrictions and
existing movement recovery still apply.

## Sale rules and collection

Saved automatic NPC sale policies, manual sale requests and queued sale work use
separate lists. Policies match base item names across variants; conflicts,
removal and exchange-reward actions use the same identity convention.

Automatic ordinary collection requires inventory pressure, including when the
merchant is nearby. Manual collection retains its existing behavior. Native
combat-compatible transfers recheck inventory, recipient range and current
command ownership immediately before sending.

Projected call cost uses a shared 170-point automatic-call budget. Item and gold
transfers reserve their native cost, while automatic tracker and player-directory
requests defer when their projected cost would exceed that budget. The final
implementation does not impose an unconditional 500 ms interval between sends.

## Opt-in full-inventory cleanout

Inventory cleanout defaults off and is available to non-merchant combat classes
through Strategies on their cards. A fresh report must show every usable slot
occupied and at least one eligible sale or bank mark. The character goes to town
to sell NPC-tagged stock, banks marked stock, and returns to its saved farming
waypoint. It can run while the designated merchant is logged out and leaves the
character's gold balance policy unchanged.

The planner and native executor protect locked/bound items, tracking devices,
potions, selected elixirs, configured swap gear and existing inventory reservations.
Events, death loops, dungeons, outstanding commands and other movement/work owners
can defer the trip. Confirmed sale receipts clear only matching marks from the
current command. Interrupted cleanout work retains a retry delay.

The feature uses shared strategy and reservation contracts from the combat/event
contribution. This PR exposes Inventory cleanout only; it does not implement the
other combat strategies, equipment swapping, elixir renewal or event orchestration.

## Commit 2137f48 and activity ownership

`2137f48` belongs with cleanout. The previous guard reused the activity plan's
merchant-reservation predicate, which also reserves a paused plan in the solo
phase. That incorrectly stopped full-inventory cleanout and queued bank work while
solo farming was paused.

Cleanout now uses the plan's participant membership and phase, matching the
activity control projection used by that commit. Paused status alone does not
reserve inventory. Existing merchant job reservation behavior remains separate.

| Activity state for this character | Cleanout/bank admission |
| --- | --- |
| No owning activity plan | Allowed if the other checks pass |
| Solo farming, running or paused | Allowed if the other checks pass |
| Preparation, participation, loot, town, collection or return | Deferred, including while paused |

The standalone contribution reads compatible persisted plan state without
starting the event scheduler. When combined with the combat/event PR, both use
the same membership and phase semantics. The original fix is incorporated into
the focused contribution rather than submitted as a separate PR.

## Manual review and activation

PR preparation runs TypeScript checks only. No tests or E2E scenarios are written,
modified or run, and no builds, deployments or application process restarts are
performed. Typechecking does not certify native purchases, transfers, sales or UI
behavior.

Manual review should cover manual/hourly Ponty trips, non-equipment catalog
entries, interruption/retry and return; carried-computer processing; automatic
versus manual NPC-sale lists; item/gold transfers and inventory pressure; protected
full-bag contents, sale receipts and farming return; and cleanout during paused
solo versus paused event phases.

Adopting the feature requires the supported full workflow to publish character,
coordinator and dashboard assets together. A coordinator-only activation cannot
publish the native cleanout and transfer changes. No activation was performed
while preparing this contribution.
