# October 2026 E2E failure investigation

Run 40635085488 exposed these fixture failure modes before the fixes below:

- Cleave's positive case starts beside native spiders and Phoenix. The correct
  collateral guard vetoes the skill; use a town position for the declared fight.
- Auto NPC withdrawal jobs no longer depend on ordinary withdrawal enablement.
  Queue assertions must reflect this while retaining native sale conservation.
- Native mail deletion removes account ownership, not the database document.
  Reused subjects and old account mail also leak across scenarios.
- The pinned native mail transaction throws `ReferenceError: in_arr is not
  defined` in its isolated transaction context. The compatibility guard replaces
  only that ownership membership call with `includes`; real deletion remains.
- Seasonal bosses spawn naturally after two minutes and persist across cases.
  Tests declaring an absent or future encounter then start with a live boss.
- Witch's Cipher intentionally preserves account daily claims across rounds.
  Restoring character documents alone does not restore a fresh test account.
- Cipher reused the event-boss spawn lookup for ordinary ingredient monsters.
  Goo resolved to the instanced `dungeon0` template and never produced a reachable
  farming route. Reuse the ordinary farming catalog's map/geometry restrictions.

Reset only between disconnected scenarios. Declare the disposable realm's
seasonal respawn timers outside the scenario window and clear previous encounter
actors through native removal. Keep native spawning, combat, loot, persistence,
and event completion inside each scenario unchanged. Reset disposable account
daily claims in both native memory and MongoDB; retain persistence within a case.

Local evidence is retained under `.build/green-loop/`, including the original
CI artifacts and local red/green reports.

## Follow-up evidence and fixture corrections

The first full rerun (`40643326583`) cleared the mailbox, bank collection,
Cleave, manual override, and most seasonal failures. Its remaining failures
identified narrower fixture boundaries:

- Cave's pixel sample was centered on the native sprite's feet and clipped its
  torso. Sample above the anchor; retain the existing pixel thresholds and
  attach the measured pixels even on failure.
- Native runs deliberately exclude the two ChronAL transport cases. Evidence
  verification accepts only those explicit expected exclusions, while rejecting
  unexpected skips, ordinary gameplay skips, failed cases and changed evidence.
- Capacity setup must retain the merchant's initial potion supply. Removing it
  starts a separate native self-restock during the capacity observation window.
- Native Pumpkin status is reconstructed without a fixed end. A test declaring
  a fixed-end feed must preserve that declaration at every broadcast, retaining
  native presence, position and damage.
- Graveyard retains the established 180-unit checkpoint arrival radius; the
  newer 100-unit radius applies only to Slender, Green and Pumpkin. Retain the
  native arrival after Main evacuation and separately verify return retirement.
  Restore the pretravel fixture's peaceful monster definitions afterward so
  subsequent Franky and Cleave scenarios retain native combat behavior.
- The Slender reacquisition journey declares one warp. Pause the independent
  random seasonal warp scheduler for that case and restore it in cleanup; retain
  native discovery, attacks, death and return after the declared relocation.
- The skills dialog now includes conditions; its E2E locator uses the visible
  current title while retaining all skill-card content and layout assertions.

Local native red/green evidence is archived under `.build/green-loop/`.
The retained regression fixtures were updated for current protocol defaults,
module locations, UI contracts and cancellation ownership. The complete local
regression rerun passed 3,893 checks with two Linux-only exclusions on Windows.
That run uses the pinned upstream account file with the repository's maintained
compatibility patch in a disposable fixture, because the installed user copy is
older; it does not modify or restart the installed console.

A same-worker Horseman reproduction showed that the prior encounter and its
modified catalog survived into the add-wave case. Reset Horseman/Jack-o-Walker
actors and their initial native definitions only between disconnected scenarios.
Hunt restart admission now waits for a fresh fighter report separately from HTTP
readiness. The Graveyard pretravel broadcast also keeps an unrelated native live
round hidden after the declared occurrence is cancelled.
