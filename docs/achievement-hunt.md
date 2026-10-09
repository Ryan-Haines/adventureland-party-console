# Achievement Hunt

Achievement Hunt farms monsters for their kill achievements (the permanent stat
rewards in `G.monsters[id].achievements`). It is a farming mode like Hunt
(`farmingPolicy: "achievements"`, chosen next to Auto, Default, Scatter and Hunt),
but it chooses its own targets from achievement progress instead of taking
quests from Daisy.

It only chooses *what* to farm. Travel, formation, grouped combat and
competition relocation work exactly as they do when a monster is picked by
hand, and the fight style follows Auto's logic as in Hunt (scatter where it has
been learned per monster). Each target switch goes through the same
`manual-monster-override` convoy as `navigate-to-monster`, except that it stays
in Achievement Hunt instead of resetting the mode to Auto.

## Characters

Achievement Hunt follows the same farming scopes as Hunt. The party leader's
settings drive the leader and every follower. A character with Follow off has
its own settings, blacklist and target, and travels alone. Followers can read
the leader's settings but cannot edit them; the coordinator answers
"following leader settings". The settings live in each character's Farming
settings dialog, next to Hunt settings.

## Choosing targets

- **Selection.** The player selects monsters from a list sorted weakest to
  strongest by XP per kill, which the game scales with HP, damage and
  defenses. Ties are broken by bestiary threat (`attack × frequency`), then
  HP. Threat alone misranks monsters: a Vampire Rat hits harder than a Fire
  Spirit but has a ninth of its HP.
- **Two lists.** Regular monsters are those with a fixed map spawn. Special
  monsters (bosses, event, cooperative and random-respawn monsters, and those
  the game leaves out of its monster list: the training dummies and the Cave of
  Many Dreams monsters) are listed separately and are never selected by default.
  Boss-like monsters the game does not flag are special too: those that never
  respawn (the crypt bosses and the Protectors), and those with at most two
  spawns in the world and at least 50,000 HP (Stompy, Ms. Dracul, Skeletor,
  Black Scorpion, the Fairies). Rare but weak monsters such as Froggies and
  Squigtoads stay regular.
- **Steps.** Every monster has its own milestone ladder, for example
  `10, 100, 1000…` or `1, 100, 1000…`. Step *n* is the *n*-th milestone of
  each monster's own ladder.
- **The target.** It is the first selected monster, weakest first, whose next
  unmet milestone is at the lowest step. So every selected monster reaches step
  1 before any is farmed for step 2, and so on.
- **Kills.** Kill counts are the account-wide progress the clients already
  report (`monsterAchievementKills`); the largest value across party statuses
  is used.
- **Moving on.** When the target's kill count reaches its milestone, the next
  target is chosen.

## Filling respawn waits

Some targets spawn in small numbers and respawn slowly: Orange Snakes
(`osnake`, 2 to 4 per spawn, 60 s respawn) or Squigtoads (2 per spawn, 120 s).
With *Fill respawn waits* on (the default), the target's focus also lists the
monsters whose spawn shares ground with the chosen spawn, for example plain
snakes with Orange Snakes, or Squigs with Squigtoads.

Characters already pick targets by priority tier: the highest-priority focused
monster within reach first, lower tiers only when none is in range. Achievement
Hunt gives the target priority 90 and each filler priority 10 for every member
of the farming scope, so the party fights fillers only while no target is up.
Filler kills count toward their own achievements.

A monster is a filler when one of its spawn boxes overlaps the target's spawn
box, it is no stronger than the target by XP per kill, it is not special, and
it is not blacklisted. When the target's spot has no box, spawns within 100 of
the spot count.

**Rare variants first.** When the chosen target would itself be a filler of
another selected monster that is rarer (fewer of it spawn on that ground than
of the chosen target) and at the same step or lower, that monster becomes
the target instead. If the sweep picks plain snakes and Orange Snakes are selected
at the same step, the party farms Orange Snakes with snakes as fillers, and the
snake step clears along the way. This applies only while *Fill respawn waits*
is on.

## Skipping and blacklisting

Skipping works like Hunt's blacklist:

- **Manual skips.** Monsters are left unselected, or added to the
  Achievement Hunt blacklist by hand.
- **Deaths.** When *Blacklist on deaths* is on, a target is blacklisted after
  `deathThreshold` party deaths while farming it.
- **Removing entries.** Blacklist entries are removed individually or cleared.

## Failure modes considered before implementation

1. **Fighting the player.** If the player changes the monster focus while
   Achievement Hunt is running, re-selecting the target would undo their choice
   every tick. Instead the mode switches to Auto, as picking a monster by hand
   does, and reports why.
2. **Thrashing.** Kill counts arrive from several clients and can lag. A target
   switch happens only when the current target's milestone is met, when it is
   blacklisted or unselected, or when a monster at a lower step becomes
   available again (re-selected, unblacklisted, or a route retry). Counts only
   rise, so small count differences never cause a switch.
3. **Conflicting owners.** A daily dungeon, an event trip, a rare hunt or
   another convoy may own travel. Achievement Hunt must not start a convoy then;
   it waits. Hunt is a different farming mode, so the two never run together;
   choosing another mode forgets the target.
4. **Offline owner.** With no fresh report from the scope's owner (the party
   leader, or the independent character) there is nothing to move. It waits.
5. **No route.** A selected monster may have no known spawn. It is skipped
   with a reason, not retried every tick.
6. **Everything done or skipped.** The party keeps farming the last target.
   The status says nothing is left to farm, instead of clearing focus and
   stranding the party.
7. **Death counting.** A death recorded before the target started, or one
   reported twice by the same client, must not count. Only `lastDeath.at`
   values newer than the target's start count, at most once per timestamp per
   character.
8. **Restart.** Settings, blacklist and current target persist with the other
   farming settings, so a restart resumes the same target instead of starting
   over.
9. **Staying in the mode.** A target switch must keep the farming mode on
   Achievement Hunt (picking a monster by hand resets it to Auto). Only the
   learned scatter state for the old monster resets, as on any focus change.
10. **Monsters with no achievements, or finished ladders.** They are never
    targets, and listing them is harmless.
11. **Scopes crossing.** An independent character's target switch must move
    only that character and must not touch the party's mode, focus or
    target. Its tick runs on its own scope view with itself as the only
    member.
12. **Upgrading a saved console.** Settings saved before scopes existed sit
    on the party state. The leader's profile picks them up on load, so an
    existing selection survives the upgrade.
13. **Random-respawn bosses listed as regular.** `G.maps` marks the Dracul
    (`mvampire`) and Phoenix spawns `stype: "randomrespawn"`, but the bestiary
    catalog does not carry spawn types and Dracul has no `special` flag. The
    policy names both, so Dracul lands in the special list.

14. **A filler outranks the target.** Priorities are per character, and
    followers read their own. The target and fillers get priorities for every
    member of the scope, so the target is always the higher tier.
15. **Fillers that are too strong.** Only monsters no stronger than the target
    by XP per kill, not special and not blacklisted, become fillers.
16. **Overwriting the player's priorities.** The previous priority of each
    touched monster, per member, is saved with the target and restored when
    the target changes or the mode ends.
17. **Relocating to a filler-only spawn.** A competition relocation picks among
    the spawns of every focused monster, so it can move the party to a spawn
    without the target. When the farming location is no longer at one of the
    target's spawns, Achievement Hunt moves the party back to the target.
18. **Mistaking the filler list for a hand change.** The focus check compares
    against the target plus its fillers, not the target alone.
19. **Two monsters with one name.** The game names both `snake` and `osnake`
    "Snake", and both `hen` and `rooster` "Chicken". Duplicated names show the
    id, for example "Snake (osnake)".

20. **Farming the common monster while its rare variant waits.** Without the
    rare-variant rule, the sweep farms plain snakes for a step, then Orange
    Snakes for the same step, killing plain snakes twice over. The chosen
    target yields to a selected, not excluded monster at the same step or
    lower whose fillers include it, but only a rarer one: a common, stronger
    monster at the same spawn (Bee over Goo) has kills enough of its own and
    would leave its filler unfarmed. Spawn counts come from the monster
    choices' `spawnRecords`. The swap only happens at a target switch, so it
    cannot thrash.
21. **A target that predates its fillers.** A target kept across a restart, or
    a *Fill respawn waits* change mid-target, would keep its old focus until
    the next switch. After a restart or any settings change, the current
    target's focus and priorities are set again once, around the party's
    farming location, without moving the party.
22. **Fillers next door pull the party to the edge.** Tiny Crabs, Tortoises
    and Froggies spawn in boxes that touch the Squigtoad box but do not share
    it. Characters may fight anything within the search radius of the farming
    spot, so chasing them takes a character up to about 300 from the middle,
    out of sight of a Squigtoad spawning on the far side; Squigtoads are
    passive and never come to the party. Only monsters whose spawn overlaps the
    target's become fillers, so the party stays on the target's own ground.
23. **A boss pulled in by Up to here.** Stompy, Skeletor and Ms. Dracul have no
    `special` flag and sort to the end of the regular list by XP, so selecting
    far down with Up to here picked them, and the rare-variant rule then put
    them ahead of the White Wolves, Irradiated Goos or Ghosts sharing their
    spawn. They and the other boss-like monsters are listed as special.

Found while running on a live party:

24. **Switching while a member is dead.** The death that blacklisted White
    Wolves also left the warrior dead, and the switch to Irradiated Goos started
    a convoy that failed during setup ("dead during convoy setup"). Achievement
    Hunt waits ("Waiting: Sadokunn is dead") while any member's fresh status
    says it is dead, then switches.
25. **A failed trip that looks like arrival.** The failed switch had already
    set the farm location to the Arena, so the party, still split between
    Mainland and Winterland, counted as at its target and stayed there for 20
    minutes. The leader's own position now counts too, but only after our
    convoy failed or while the leader has no convoy and is idle, so a town
    restock is never pulled back. A party sent back is sent again no sooner
    than 30 seconds later.
26. **Event deaths counted against the target.** A death on an event trip
    counted toward the death blacklist. Hunt leaves those out
    (`scripts/hunt-safety.cjs` `eventDeath`), and so does Achievement Hunt.

## Tests

The console E2E journey `e2e/achievement-hunt.spec.ts` (failure modes in
`e2e/achievement-hunt-failures.md`) drives the real dashboard and coordinator:
it selects Goo in Farming settings, chooses the mode, waits for the target,
restarts the coordinator and leaves the mode. Its evidence lands in
`.build/e2e-report/` with the other console journeys.

`scripts/tests/achievement-hunt.test.cjs` checks the rest of the failure modes
in isolation. The console fixture publishes one Goo spawn and no kill counts, so
the journey cannot reach a step sweep across several monsters, death
thresholds, a lower step taking over, or the random-respawn list.
