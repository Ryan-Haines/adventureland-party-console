# achievement-hunt

The fork's Achievement Hunt (972c9fce: runtime/coordinator/hunt/achievement-hunt.ts,
runtime/hunt/achievement-policy.ts, achievement-settings.ts, http/achievement-hunt.ts, the boss
block of characters/shared.js 3760-3923, dashboard/features/party/achievement-hunt-settings.tsx;
its rules and failure modes are the fork's docs/achievement-hunt.md), rebuilt as an add-on.

## Part 1: what it does in game
1. **New feature or bug fix?** A new feature.
2. **What it makes the party do.** It farms the monsters you pick for their kill achievements,
   weakest first, one milestone step at a time, fills respawn waits with the weaker monsters on
   the same ground, and keeps the party away from the bosses on that ground.
3. **When it starts and stops.** While the target mode is Achievements, for each farming scope:
   the party leader's, or a character with Follow off.
4. **What it replaces.** It is a target mode entry beside Farming and Hunt, with any combat mode
   (the slot holds one target mode entry at a time). Achievements fights in the combat mode
   you chose, which the scope saves in its own field. Leaving it, by another entry, a pick by
   hand or its switch turned off (`addon.off`), switches the target mode to Farming, keeps the
   combat mode, and puts back the priorities and passive rare rules it changed.
5. **Movement and interruptions.** Its target switches are the current console's monster pick
   (the manual-monster convoy), keeping the target mode. It waits while a daily dungeon, an event trip,
   a rare hunt or another convoy holds travel. On the characters, a step out of a boss's zone
   runs at the `farming` tier, below every task.
6. **Items.** None.
7. **Skills and targets.** The fork never attacked a boss on the avoid list and started no pull
   inside a zone. The add-on answers targeting's `targeting.candidates` question with both rules
   (index.ts, zones.ts `pullRefusal`).
8. **Danger.** Deaths on a target count toward its blacklist (6 by default); a boss that attacks
   the party sends the hunt to a stand-in target until nobody has seen the boss for the check
   back time (10 minutes by default). With "leave the target when a boss attacks" off, the party
   keeps farming the target; fighters still keep away from the boss and never attack it (user,
   2026-11-09).
9. **Settings.** The monsters, blacklist on deaths and the death count, fill respawn waits, fill
   only with selected monsters, leave the target when a boss attacks (on by default) and check
   back after (minutes), and the blacklist; in the Farming
   settings dialog.
10. **Card text.** The Farming settings status: "Farming Goo: 1,234 / 10,000 kills (step 3)",
    "Waiting: ...", "Skipping ...", "Nothing left to farm".
11. **When it cannot make progress.** A monster with no route waits until the spawn data it failed
    on changes or the settings change; a boss with no clear spot outside its zone holds the
    character with the reason.
12. **Overrides.** Picking a monster by hand switches the target mode to Farming, with the combat
    mode left as it is.
13. **How you know it works.** Targets move up the ladder weakest first, nobody fights a boss on
    the target's ground, and deaths blacklist a target at the set count.

## Part 2: where it lands in the console
- A. Group task slot (01): the target mode slot, entry `achievements`, a choice
  (`target.mode`, `target.settings`). Its store lives in each farming profile
  (`addonFarming["achievement-hunt"]`) and persists with it.
- B. Movement tier (02): `farming` (56) for the boss retreat; `step.safety` keeps the zones.
- C. Item claims (10): none.
- D. Turns and targets (03, 04): waiting, below.
- E. Survival (05): none.
- F. Settings (11): the fork's choices, with their defaults. The fork's fixed waits are gone, since a
  wait is game data, a measured state or a progress rule, never a made-up number: a report counts
  as fresh for two of the character's report intervals, a switch settles
  once every member has reported since it, a return to the target is resent after two of the
  leader's reports, a route failure waits for new spawn data, the boss zone is the server's aggro
  block and the boss's walk, and ground without a spawn box is one aggro block wide. The
  blacklist needs no cap: it holds one entry per monster. No game field marks a boss, so the
  fork's rule for sorting the chooser's lists is two declared settings: a boss-like monster has
  at most "A boss has at most this many spawns" (default 2) and at least "A boss has at least
  this much HP" (default 50,000); the coordinator's tick and the section's monster list read the
  same values. The retreat search samples its circles every half aggro cell along the circle, as
  along the radius.
- G. Card text (12): the status line above; each character reports the bosses it sees
  (`addonReports["achievement-hunt"].sightings`).
- H. Overrides: a pick by hand switches the target mode to Farming and keeps the combat mode.
- I. Conflicts: `npm run addon:check` reports none; the fork's own registration (a toggle beside
  the target mode) is refused, because the slot holds one target mode entry at a time, so this one
  is an entry of the slot.
- J. Tests, all in tests/ here: achievement-hunt.test.cjs (the fork's isolated checks on the
  add-on) and achievement-boss-zones.test.cjs (the zones, the step check, the retreat, the
  targeting answer and the status report's sightings); fork.ts, the fork's own registration beside the target mode, which load refuses; and
  rows.ts, this add-on's rows of two shared tables: the Achievement Hunt row in
  e2e/live-movement-owner.spec.ts's table, which runs it on the game stack (the switch on, the target picked, its task live, the
  kills, and the switch off), and the console journey in e2e/addon-console.case.ts's add-on
  table.

## Waiting
- **The persistence split:** the fork moved these fields to their own save key
  (party_dashboard_achievement_state_v1). Here they persist with the farming profile, as every
  other scoped field does.

## Failure modes

Moved here from e2e/movement-owner-failures.md "Step 9b", each with
the check in this folder's tests/ that holds it.

10. **Achievement Hunt's target order, steps, fillers and rare variants** (the fork's failure
    modes 1 to 35 in its docs/achievement-hunt.md).
11. **Its settings accept an unknown monster or a bad threshold, or the mode starts with no
    monster chosen.**
12. **A scope's choices leak to another scope, or are lost on a restart.**
13. **A failing return restarts every tick.**
14. **A route failure is retried before anything changed.**
15. **A boss zone misses the boss's walk.**
16. **A combat step ends in a zone, or a joined event's boss is avoided.**
17. **The retreat ends in a zone, leaves the priest's heal range, or drops the target.**
22. **The Achievement Hunt mode shows or starts while the add-on is off.**
23. **Its choices are lost on a restart.**

10-14. `tests/achievement-hunt.test.cjs`, the fork's own isolated checks moved onto the
     add-on; 12 and 13 rewritten for the scope store and the report rule.
15-17. New `tests/achievement-boss-zones.test.cjs`: the game server spawns no boss beside
     a farm on demand (the fork's own note).

- Achievement Hunt target order, steps, fillers and rare variants (failure modes 1 to 35 of the fork this add-on came from): `tests/achievement-hunt.test.cjs`, mode by mode (the fork's numbering): 1 "items 10 and 14: the target order, its steps and what stops or skips a switch" row "a monster focus changed by hand switches the target mode to Farming instead of fighting the player"; 2 the same table's "no thrashing: the target is kept until its own milestone is met" and "a monster that comes back at a lower step takes over from a higher-step target"; 3 and 4 its "another owner of travel, an offline leader or another farming mode stop it from starting a convoy"; 5 its "a monster without a route is skipped for a while, and the rest of the list continues"; 6 its "with everything finished it reports so and keeps the party where it is"; 7 its "deaths count once each, only after the target started, then blacklist it and move on"; 8 "items 11 to 13: the settings, the mode switch, the scope store and the return to the target" row "each farming scope keeps its own Achievement Hunt in its profile; followers use the leader scope" and "item 10: fillers, their priorities and rare variants" row "a target kept across a restart or a settings change gets its fillers without moving"; 9 and 27 "items 11 to 13: the settings, the mode switch, the scope store and the return to the target" row "an Achievement Hunt switch stays in the target mode; picking a monster by hand switches it to Farming (Auto)"; 10 "items 10 and 14: the target order, its steps and what stops or skips a switch" row "the list runs weakest to strongest; special and achievement-less monsters are marked or left out"; 11 the scope row of mode 8; 12 retired: the add-on keeps its store in each farming profile from its first save (runtime/addons/achievement-hunt/README.md Part 2 A), so no settings saved before scopes exist to upgrade; 13 and 23 "items 10 and 14: the target order, its steps and what stops or skips a switch" row "boss-like monsters the game does not flag are special; rare but weak ones stay regular"; 14 and 18 "item 10: fillers, their priorities and rare variants" row "the target is the top priority tier and nearby fillers the bottom one, for every member"; 15 and 22 its "fillers share the target spawn, are no stronger than the target, regular and not excluded"; 16 its "leaving the mode restores each member's previous priorities"; 17 its "a relocation to a spawn without the target sends the party back to the target"; 19 "items 10 and 14: the target order, its steps and what stops or skips a switch" row "two monsters with one game name show their ids"; 20 "item 10: fillers, their priorities and rare variants" row "a rare variant at the same step is farmed first, with the common monster as its filler"; 21 the restart row of mode 8; 24 "items 10 and 14: the target order, its steps and what stops or skips a switch" row "a dead party member holds the next switch until everyone is back"; 25 "items 11 to 13: the settings, the mode switch, the scope store and the return to the target" row "a leader standing away from the target after a failed trip is sent back, again only after two of its reports"; 26 "items 10 and 14: the target order, its steps and what stops or skips a switch" row "deaths during an event trip do not count toward the target, as in Hunt"; 28 "item 10: fillers, their priorities and rare variants" row "fillers are only selected monsters unless that setting is off"; 29 "item 10: bosses on the target ground and rare spawns" row "a target with a boss on its ground tells fighters to keep away from that boss"; 30 its "a boss attacking the party sends the hunt to a stand-in, and it returns 10 minutes after the boss was last seen"; 31 its "a selected rare is never the target; passive hunting fights it when seen, then gets its old rule back"; 32 to 34 "item 10: the monster list is built once per catalog (the fork failure modes 32 to 34)" (one row each); 35 `npm run typecheck`: the kept list is `readonly` in runtime/addons/achievement-hunt/hunt.ts, so an edit does not compile.
- Achievement Hunt settings accept an unknown monster or a bad threshold, or the mode starts with no monster: `tests/achievement-hunt.test.cjs` "items 11 to 13: the settings, the mode switch, the scope store and the return to the target".
- A scope choices leak to another scope, or are lost on a restart: `tests/achievement-hunt.test.cjs` "items 11 to 13: the settings, the mode switch, the scope store and the return to the target".
- A failing return restarts every tick: `tests/achievement-hunt.test.cjs` "items 11 to 13: the settings, the mode switch, the scope store and the return to the target".
- A route failure is retried before anything changed: `tests/achievement-hunt.test.cjs` "items 10 and 14: the target order, its steps and what stops or skips a switch".
- A boss zone misses the boss walk: `tests/achievement-boss-zones.test.cjs` "item 15: a zone is the boss aggro block, and a walking boss also covers the cells of its walk".
- A combat step ends in a zone, or a joined event boss is avoided: `tests/achievement-boss-zones.test.cjs` "item 16: no combat step ends inside a zone, except a step out of it, and a joined event fights its boss".
- The retreat ends in a zone, leaves the priest heal range, or drops the target: `tests/achievement-boss-zones.test.cjs` "item 17: inside a zone the character walks to the nearest clear point, keeping its target and the priest heal range".
- The Achievement Hunt mode shows or starts while the add-on is off: `tests/rows.ts` (the console journey) "Achievement Hunt adds its farming mode, refuses it with no monster chosen, and keeps its choices in the scope store".
- Achievement Hunt choices are lost on a restart: the same failure as the scope-store restart row above.
