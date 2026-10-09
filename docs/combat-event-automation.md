# Combat, farming and event automation

## Combat and farming controls

Character cards expose persistent strategy toggles. Kiting defaults on; disabling
it holds combat position while following moving targets. Absorb Sins is priest-only.
Rspeed and Mentalburst are rogue-only and default on. Class and native skill
requirements still apply. These choices persist and participate in dashboard
settings export/import.

Rogue crab farming holds the selected spawn center. Fan of Knives batches eligible
targets on its attack cooldown. Scatter farming can use the same knife strategy
for other selected farming regions. Mentalburst runs on its own cooldown during
farming and ordinary combat; farming targets must be outside knife range while
remaining in native Mentalburst range. Rspeed upkeep includes nearby native party
members, including merchants, and reserves mana before damage skills spend it.
Warriors keep within melee range of moving targets. Ordinary mana potion use starts
below 50%; rogues additionally prioritize mana recovery below 1500 MP.

## Luck equipment and consumables

Inventory swaps provides Luck before kill. Ordinary monsters trigger near two
estimated party attack cycles; cooperative monsters trigger at 5% HP. The runtime
records the actual pre-swap equipment, verifies native equip batches, restores the
original set after the trigger or before console equipment commands, and retains
a restoration journal across reloads. Swap equipment and displaced originals are
protected from collection. See [Inventory swaps](inventory-swaps.md).

Timed elixirs can be selected for automatic use from the inventory menu. One
selection is saved per character. The runtime renews it when the elixir slot is
empty or expired, never replaces an active elixir, yields to inventory mutation,
and retains the selection when stock is unavailable.

## Optional death loop

Death loop defaults off and is restricted to non-merchant combat classes. At 95%
XP, it suspends normal activity, travels to the arena, provokes monsters without
normal healing/kiting, and respawns until XP reaches zero. It then resumes its saved
task or farming location. The enabled toggle can trigger another cycle later.

Intentional deaths retain death-loop ownership through status and travel reports,
including the final death, so ordinary recovery and Hunt death limits do not claim
them. Returning to farming retries until the saved-farm reunion accepts ownership.

## Halloween attendance

Halloween selects Mr. Pumpkin and Mr. Green on the current realm. Enabled
characters prepare before announced spawns, share one committed encounter and
travel generation within an attendance group, approach live targets into range,
finish loot/departure combat, and restore saved activity when attendance ends.
The default preparation window is 120 seconds. Missing/stale timing does not start
preparation, and delayed spawn reports have a bounded allowance.

Mr. Pumpkin's junior adds take priority. Rogues use Fan of Knives around add-spawn
HP windows and while eligible adds remain in range. A lone rogue attacks the boss
only while another character holds its aggro. Merchant event combat is separately
configurable and defaults off; selected events are preserved when combat is off.
An attacking merchant also requires another character to hold the target's aggro.
See [Event attendance](events-and-anniversary.md).

## Solo Farming + Events plan

The coordinator persists one farmer, up to two companions, a merchant, an operating
realm, selected bosses and preparation time. It advances through solo farming,
preparation, participation, loot, town, collection and farming return while the
dashboard is closed. Temporary effective preferences preserve the saved party
and personal farming choices. External/Steam sessions, realm fatigue, active
inventory work and competing movement owners can hold the plan with a visible
reason rather than silently taking ownership.

Companions do not log out until all participating fighters finish eligible loot
transfers. The coordinator checks command/run/generation/worker identity on each
receipt and waits for fresh fighter and merchant inventories. Mandatory collection
protects equipment swap stock, selected elixirs, locked/bound items, tracking
devices, computers, potions and existing crafting/delivery reservations. A full
merchant pauses progression with a capacity message.

Transfers share a projected native call budget with automatic tracker/directory
requests. These handoff prerequisites support event cleanup; this contribution
does not add Ponty shopping or automatic full-inventory sell/bank cleanout.

Pause prevents new phases while issued operations can settle. Resume reconciles
observed sessions and stock. Manual roster/realm/travel controls pause the plan.
Stop completes required encounter cleanup before companion logout and farmer
return. See [Solo Farming + Events](solo-farming-events.md).

## Manual review and activation

PR preparation runs TypeScript checks only. No tests are written or run, no E2E
scenarios execute, and no builds, deployments or application process restarts are
performed. Typechecking does not certify live gameplay or UI behavior.

Manual review should cover class-specific toggles, stationary crab farming and
moving targets; low MP and independent skill cooldowns; luck swaps, restoration and
expired-elixir renewal; the death loop's trigger/final return; announced/cancelled
Halloween spawns and adds; and the complete plan with stale receipts, full merchant
capacity, pause/resume/stop and interrupted progress.

Adopting these changes requires the supported full activation workflow to publish
character, coordinator and dashboard assets together. Activation is a separate
user action and was not performed while preparing this PR.
