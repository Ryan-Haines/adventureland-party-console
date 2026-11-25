# tank-hold

Answer Part 1 in your own words before any code; your agent answers Part 2 from
`npm run addon:map` and runtime/addons/HOOKS.md, and checks it with `npm run addon:check`
(runtime/addons/README.md).

## Part 1: what it does in game
1. **New feature or bug fix?** A new feature.
2. **What it makes the party do.** The tank holds the monsters and the party forms around it; the
   off tank takes the tank's attackers while the tank is in danger; with Pull on, the party waits
   outside the pack while the puller brings one monster at a time.
3. **When it starts and stops.** While the add-on is on and its Tank names a member of the party.
   Pull runs while Pull is on and the puller is in the party and alive. Switching the add-on off
   stops every rule on the next status reply.
4. **What it replaces.** Nothing. The farming mode, the target mode and the combat mode stay the
   player's. It names the member the grouped formation centres on and the member that owns Taunt,
   Absorb and Agitate (the leader by default), and orders targets inside one priority.
5. **Movement and interruptions.** In pull mode only, at the `farming` tier: the tank steps out of
   the pack and waits, the others wait within their own attack range of the tank, and the puller
   walks back to the tank with the monster it pulled. Every task, the escape, the death recovery,
   the town trip and the player's commands rank above it and take the character; it waits for
   them and answers again on the next tick. During a fight it moves nobody but the returning
   puller, so the console's own kiting and positioning run.
6. **Items.** None.
7. **Skills and targets.** It casts nothing. It names the aggro owner (the tank, or the off tank
   while the tank is in danger), puts the tank's attackers first for the party and the loose
   monsters first for the tank, and in pull mode narrows the candidates: the puller may take the
   one pack monster nearest the tank once the party is ready, and while a pull is on everyone
   fights only the monsters attacking the party.
8. **Danger.** A member is in danger when it is dead or below "The tank is in danger below this
   share of its HP" (50% by default). The off tank takes over while the tank is in danger, and the
   puller pulls nothing while any member in view is in danger. A member a monster attacks is never
   refused a step, so the console's survival moves always go.
9. **Settings.** Tank, Off tank, Puller (the tank when unset) and Pull (off), picked on each
   card's Farming settings line for the farming scope the character plays in, so each scope has
   its own tank. The danger share (50%) is a setting with one value per scope. A formation entry
   "Around the tank" for the characters the player picks.
10. **Card text.** The Farming settings line holds the three pickers and the Pull switch; the card shows the character's
    role and what it does: "Waiting outside the pack for R's pull", "Bringing the pull to T",
    "Waiting for the party before the next pull", "Fighting the pull".
11. **When it cannot make progress.** No clear spot outside the pack: the tank fights where it
    stands and says so. No path back to the tank: the puller fights the pull where it is and says
    so. A dead puller ends the pulls with "R is down; the party farms without pulls".
12. **Overrides.** Switch Pull off, clear the Tank, or switch the add-on off; none needs a warning.
13. **How you know it works.** Monsters attack the tank; the off tank's Taunt goes when the tank
    drops below the share; with Pull on, the party stands out of the pack's aggro and fights one
    monster at a time beside the tank.

## Part 2: where it lands in the console
- A. Group task slot (01): none.
- B. Movement tier (02): the mover `pull` at `farming` (56), above `formation` (46) and `approach`
  (44), below `addon-task` (60) and every task. It waits: a higher tier takes the tick.
  `step.safety` keeps the members other than the puller out of the pack's aggro blocks.
  `group.anchor` names the tank (the off tank when the tank is not available).
  `formation.routine` fills the `formation` entry `around-tank`.
- C. Item claims (10): none.
- D. Turns and targets (03, 04): `targeting.aggroOwner`, `targeting.prefers`,
  `targeting.candidates`. No spend.
- E. Survival (05): none; it never refuses a step to a member under attack.
- F. Settings (11): the picks and Pull are keys of the scope store (`tank`, `offTank`, `puller`,
  `pull`), which the card piece saves and every hook reads through `ctx.store.scope`; Pull is off
  until the player switches it on. The danger share is a `scope` setting with a default of 50%,
  read through `ctx.settings`. The tank's danger on `targeting.aggroOwner` comes from the members'
  HP in its member views. The waits are the aggro block
  (`AGGRO_CELL`), the character's own attack range, and the clear-point search out to one block
  past the farthest pack monster.
- G. Card text (12): the mover keeps its line in the character store, `status.report` reports
  `{role, line}`, `status.line` draws the line under the card line through
  `ctx.read('status.lastReport')`, and the `card-section` piece at `farming-line` holds the pickers.
- H. Overrides: none beyond the switches.
- I. Conflicts: `group.anchor` and `targeting.aggroOwner` take one answer each, so a second add-on
  that answers either conflicts and the player switches one off.
- J. Tests: tests/tank-hold.test.cjs on planted views (the holder, the order, the pull candidates,
  the mover, step safety, the formation and the registration's answers on a planted context, two
  scopes with their own tanks among them).
- K. Dashboard section: none; `dashboard.tsx` fills the `card-section` slot only.
