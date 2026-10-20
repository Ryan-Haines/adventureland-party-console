# Achievement Hunt

Achievement Hunt farms monsters for their kill achievements (the permanent stat
rewards in `G.monsters[id].achievements`). It is a farming mode like Hunt
(`farmingPolicy: "achievements"`, chosen next to Auto, Default, Scatter and Hunt),
but it chooses its own targets from achievement progress instead of taking
quests from Daisy.

It only chooses *what* to farm. Travel, formation, grouped combat and
competition relocation work as they do when the player picks a monster by
hand, and the fight style follows Auto's logic as in Hunt (scatter where the
party has learned it per monster). Each target switch goes through the same
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
  defenses. Bestiary threat (`attack × frequency`) breaks ties, then
  HP. Threat alone misranks monsters: a Vampire Rat hits harder than a Fire
  Spirit but has a ninth of its HP.
- **Two lists.** Regular monsters are those with a fixed map spawn. Special
  monsters (bosses, event, cooperative and random-respawn monsters, and those
  the game leaves out of its monster list: the training dummies and the Cave of
  Many Dreams monsters) have their own list, and the defaults select none of them.
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
  1 before the party farms any for step 2, and so on.
- **Kills.** Kill counts are the account-wide progress the clients already
  report (`monsterAchievementKills`); the hunt uses the largest value across
  party statuses.
- **Moving on.** When the target's kill count reaches its milestone, the hunt
  chooses the next target.
- **Rares are never the target.** See [Rare spawns](#rare-spawns).

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

With *Only selected monsters* on (the default), a filler must also be selected:
a monster the player left unselected is one they did not ask to fight. Turned
off, any regular monster on the target's ground can fill.

**Rare variants first.** When the chosen target would itself be a filler of
another selected monster that is rarer (fewer of it spawn on that ground than
of the chosen target) and at the same step or lower, that monster becomes
the target instead. If the sweep picks plain snakes and Orange Snakes are selected
at the same step, the party farms Orange Snakes with snakes as fillers, and the
snake step clears along the way. This applies only while *Fill respawn waits*
is on.

## Bosses

Stompy roams the whole White Wolf spawn, Mr. Pumpkin roams the Halloween
scorpion spawn, and Skeletor and the vampires share ground with regular
monsters. Achievement Hunt farms around them and stays out of fights with them;
deaths they cause still count toward the target's death blacklist.

- **Which bosses.** A boss is a monster the game flags `special`, or a
  boss-like one (§ 23). Each target lists the bosses whose spawn shares its
  ground (`achievementTarget.avoid`), and the status response sends that list
  to the characters as `avoidMonsters`. Every boss on the list follows the
  same rules.
- **Never the target.** A character never attacks a boss on the list, even
  one attacking the party. A joined event, such as the Mr. Pumpkin or Mr.
  Green fight, is the exception.
- **Keep-out zone.** Each visible boss on the list carries a zone around its
  live position. The game server only lets a monster notice a player in the
  3 × 3 block of 32 px cells around the player (`node/server.js` registers
  aggressive monsters with `set_ghash(aggressives, monster, 32)`, and
  `get_nearby_ghash` in `node/server_functions.js` reads the 3 × 3 block), so
  a boss notices nobody farther than 64 × √2, about 91 px. The boss's attack
  `range` (520 for Mr. Pumpkin) only limits the hit after it notices. The zone
  adds 1.5 s of the boss's own walk (60 px at speed 40) for position lag, and
  40 px more for a boss with aggro 1 (Mr. Green), which notices on every
  tick: 151 px for Mr. Pumpkin and Stompy, 191 px for Mr. Green.
- **New pulls.** A character only starts a new pull when the target and the
  spot it attacks from both sit outside every zone, counting where a walking
  boss is in the next 2 seconds. A monster already attacking the party, or the
  fight already under way, is still fought. Combat steps never end inside a
  zone, except a step that moves out of it.
- **Moving away.** Each character watches every boss's position, heading and
  speed on every movement tick. Once a zone is 2 seconds or less from
  reaching the character, the character walks away from the boss to a spot
  outside every zone, keeping its target and attacking as it goes: a monster
  that targets a party member follows that member, so the fight comes along.
  The spot favours walkable ground inside the farm area, stays in the priest's
  heal range when the priest is near, and for the priest keeps every member in
  its heal range. When no spot keeps the heal range, the character takes the
  nearest spot outside every zone.
- **Leaving.** Characters report visible bosses on the list, with whom each one
  attacks (`avoidSightings`). When one attacks a party member, the hunt farms
  the next target as a stand-in, and returns once no member has seen the boss
  for the *check back after* time (`bossRecheckMinutes`, 1 to 120, 10 by
  default). The party can't see the spawn while away, so in practice it returns
  after that long and checks again. A boss stays until someone kills it, so the
  setting trades how often the party checks against how many trips it makes. The deaths the target had go with
  it, so leaving and coming back never resets its blacklist count. Holds live
  in memory: after a restart the party goes back, and leaves again if the boss
  attacks.

## Rare spawns

Rares appear without a fixed spawn: random respawns (Dracul, Phoenix; `G.maps`
marks their spawns `stype: "randomrespawn"`, and characters copy that into
each spawn record) and the rares passive hunting already knows (Phoenix, Golden
Bat, Cute Bee, Tiny, the chickens). They appear in the special list.

A selected rare is never the target: waiting at one of its possible spawns
would stall the hunt. Instead, while the hunt runs, each selected rare with
steps left gets an enabled passive hunting rule, so the party fights it when a
character sees one and then returns. Achievement Hunt already waits while a rare
hunt owns travel. The hunt leaves alone a rare the player already hunts
passively. It saves any other rule in `achievementPassive` and puts it back,
exactly, once the rare finishes its ladder, the player unselects or
blacklists it, or the mode ends. Only
the party leader's scope runs rare hunts, so independent characters' hunts
skip their rares.

## Skipping and blacklisting

Skipping works like Hunt's blacklist:

- **Manual skips.** The player leaves monsters unselected, or adds them to the
  Achievement Hunt blacklist by hand.
- **Deaths.** When *Blacklist on deaths* is on, the hunt blacklists a target
  after `deathThreshold` party deaths while farming it, 6 by default: the live
  run used 6, and the hunt blacklisted White Wolf on its sixth death.
- **Removing entries.** The player removes blacklist entries one at a time or
  clears them.

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
5. **No route.** A selected monster may have no known spawn. The hunt skips it
   with a reason and does not retry it every tick.
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
16. **Overwriting the player's priorities.** The hunt saves the previous
    priority of each touched monster, per member, with the target and restores
    it when the target changes or the mode ends.
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
    the next switch. After a restart or any settings change, the
    hunt sets the current target's focus and priorities again once, around the
    party's farming location, without moving the party.
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
    spawn. They and the other boss-like monsters now appear in the special list.

Found while running on a live party:

24. **Switching while a member is dead.** The death that blacklisted White
    Wolves also left the warrior dead, and the switch to Irradiated Goos started
    a convoy that failed during setup ("dead during convoy setup"). Achievement
    Hunt waits ("Waiting: Sadokunn is dead") while any member's fresh status
    says it is dead, then switches.
25. **A failed trip that looks like arrival.** The failed switch had already
    set the farm location to the Arena, so the party, still split between
    Mainland and Winterland, counted as at its target and stayed there for 20
    minutes. The leader's own position now counts too, but only after the
    hunt's convoy failed or while the leader has no convoy and is idle, so the
    hunt never pulls back a town restock. The hunt sends a party back again no
    sooner than 30 seconds later.
26. **Event deaths counted against the target.** A death on an event trip
    counted toward the death blacklist. Hunt leaves those out
    (`scripts/hunt-safety.cjs` `eventDeath`), and so does Achievement Hunt.

Found in review of the first version:

27. **A switch erased event state.** Every switch, and every return to the
    target, went through the manual pick's `reset`, which cleared
    `eventReturn`, `deferredEventReturns` and `eventSessions`. A member still
    finishing an event could lose its way back. A switch that keeps the mode
    now leaves event state alone, and the hunt also waits while
    `deferredEventReturns` is set.
28. **Unselected fillers.** Any regular monster on the target's ground filled,
    including ones the player left unselected. Fillers are now selected
    monsters only, unless *Only selected monsters* is off.

Found on the live party:

29. **Fighting the boss on the target's ground.** Stompy shares the White Wolf
    spawn; 5 of White Wolf's 6 deaths were Stompy. See [Bosses](#bosses).
30. **Coming back too soon, or never.** A stand-in that kept going until its own
    milestone could hold the party away for hours. A stand-in now gives the
    target back as soon as the boss has gone unseen for the *check back after*
    time.
31. **A rare as the target.** Selecting a rare made it the target, so the party
    waited at a spawn where it may not appear. See [Rare spawns](#rare-spawns).

Found in the efficiency review, written before the change:

32. **Rebuilding an unchanged list.** The coordinator ticks the hunt on every
    status report. Each tick rebuilt and sorted the monster list, and looked up
    each catalog entry's spawn data with a linear search of `monsterChoices`,
    three times per entry: about 67,000 comparisons a tick with 149 monsters.
    The hunt keeps the list while `bestiaryCatalog` and `monsterChoices` stay
    the same arrays, and finds spawn data and monsters by id through a `Map`.
33. **A stale list after a catalog reload.** `consumeStatusCatalogs`
    (`runtime/coordinator/status/catalogs.ts`) replaces either array when a
    character reports a new one. The hunt must then build the list again, or
    it would target monsters by old spawns.
34. **Another choice for a repeated id.** The linear search returned the first
    choice with an id. The index keeps the first one too.
35. **A caller editing the kept list.** Every tick reads the same list, so an
    edit would leak into later ticks. The list is `readonly`, and the compiler
    rejects an edit.
36. **Rescanning every entity per candidate.** `isAllowedTarget` checks each
    candidate against the avoided bosses, and `visibleAvoidedBosses` walked all
    of `parent.entities` for every check. One targeting pass on a crowded map
    cost entities times candidates. The fighter collects the visible avoided
    bosses once per synchronous pass and reuses them for every candidate, for
    the keep-out zones and for `avoidSightings`.
37. **A boss list older than the entities.** The game client updates
    `parent.entities` from socket events, which run between passes. The kept
    list expires in a microtask after the pass that built it, so the next pass
    sees a boss that appeared, died or left sight. A change to the avoid list
    drops the kept list at once.

Found on the live party on 2026-10-19:

38. **A boss's attack range blocking its whole spawn.** On 2026-10-19 Mr.
    Pumpkin roamed the Halloween scorpion box ([-671,571,-320,800]). The old
    rule kept new pulls 150 + 2 × range from the boss, 1190 px for Mr.
    Pumpkin's range of 520, so the party stood still with 6 scorpions in
    range ("target outside allowed combat selection"). The keep-out zone now
    follows the server's aggro reach instead of the attack range. See
    [Bosses](#bosses).
39. **The boss as a target.** A boss on the avoid list that attacked a party
    member passed the combat selection like any attacker, so the party fought
    it. Characters now never attack a boss on the list outside a joined event.
40. **Fighting on while the boss walks in.** On 2026-10-19 the tank fought a
    White Wolf while Stompy walked up to him. Nothing moved him, though the
    wolf would have followed him. Characters now walk away from a boss before
    its zone reaches them and keep the same target. The role runner
    (`runtime/characters/roles/runner.ts`) calls `bossRetreatTick` on every
    movement tick, after it wakes the attack loop and before grouped movement.

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

`scripts/tests/achievement-boss-avoid.test.cjs` runs the real `shared.js` boss
functions in a VM with the boss geometry (failure modes 29 and 38 to 40), and
the built role runner (`.build/runtime/roles.js`) for the movement loop's order. The
E2E game server spawns no boss next to farm targets on demand, so no live
journey covers the keep-out zone or the retreat.
