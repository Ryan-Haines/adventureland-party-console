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
