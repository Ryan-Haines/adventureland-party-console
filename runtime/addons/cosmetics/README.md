# cosmetics

Answer Part 1 in your own words before any code; your agent answers Part 2 from
`npm run addon:map` and runtime/addons/HOOKS.md, and checks it with `npm run addon:check`
(runtime/addons/README.md).

## Part 1: what it does in game
1. Is this a new feature or a bug fix? A bug fix goes into core and stops here.
   A new feature: the console shows no cosmetics today.
2. In one sentence, what does it make the party do?
   It adds a Cosmetics panel under Equipped on each character's card that lists the character's
   CX jars, the looks it owns with the ones it wears, and the emotes it has, and a press on a look
   puts it on or takes it off and a press on an emote plays it.
3. When does it start, and when does it stop?
   The panel shows while the add-on is on and the character reports; switching the add-on off
   removes it. Each press is one action, sent once.
4. Does it replace something the party does now, such as the farming mode? What should the party go back to when it stops?
   No. Farming, Hunt and every task run as before.
5. Does it move characters? What should be allowed to interrupt it, and should it wait or give up?
   No. A press waits behind Pause, the deploy lease, the player's hand under Manual and survival,
   as every add-on action does, and a newer press replaces one still waiting.
6. Does it keep, use, buy, sell or move items? Which, and how many?
   No. It reads the CX jars in the bag and never opens one. Putting a look on or off changes no
   item.
7. Does it cast skills, attack, or pick which monster to fight?
   Playing an emote casts that one emote skill at the `maintenance` rank, once per press. A
   targeted emote, such as Kiss, shows without a button, since the emote action takes no target.
8. Can it get a character killed? What should happen when a character is in danger?
   No. Survival's spends rank above the emote, and survival holds every add-on action.
9. What settings should the player see, and what should they start at?
   None.
10. What should the character's card say while it runs, and when it cannot make progress?
   The panel lists what the character has; a character with no report yet shows
   "No cosmetics report yet". Under the lists, the newest press shows as sent, refused with the
   owner and reason, or failed with the error.
11. What should it try next when it cannot reach its goal?
   Nothing: a refused press stays on the card, and the player presses again.
12. How should the player be able to stop or override it, and does that need a warning?
   Switch the add-on off in the add-on manager. No warning.
13. How will you know it works? Describe what you would watch for in game.
   Open a character's card: under Equipped, the panel's worn looks match the character's
   Cosmetics window in game (`character.cx`), the owned list matches `character.acx`, each CX jar
   in the bag shows with the look inside, and the emotes match the ones the in-game Random Emote
   picks from. Press an owned look: the character wears it in game and the panel moves it to
   Wearing. Press a worn look: the slot empties. Press Wave: the character waves.

## Part 2: where it lands in the console
- A. Group task slot (01): none.
- B. Movement tier (02), between which two named tiers, and cancel or wait: none.
- C. Item claims (10): none; the jars are only read. The items owner's `item.wearLook` action
  carries out put on and take off (the game's `equip_cx`).
- D. Turns and targets (03, 04): the turns owner's `emote` action plays an emote at
  `maintenance`.
- E. Survival (05): none; survival holds the actions as it holds any add-on action.
- F. Settings (11), each number from game data, a setting with a default, or a progress rule: no
  settings and no numbers. The emote list comes from game data: each `G.skills` entry with an
  `emote` whose look the character owns, the rule the game's own Random Emote uses. Each look's
  slot comes from its `G.sprites` sheet type through the game's `cxtype_to_slot`.
- G. Card text (12), and the next strategy when progress stops: `status.report` sends
  `{worn, owned, jars, emotes}`; the `card-section` slot's `equipped` part draws it. A press posts
  through the piece's `send` to `addon.command`, which asks the action on the coordinator; the
  press waits in the party store's `pending.<character>` until `addon.acted` settles it into
  `last.<character>`, which the panel shows.
- H. Overrides and their warning: none.
- I. Conflicts `npm run addon:check` reports, resolved in the owner's table: none.
- J. Tests: tests/cosmetics.test.cjs, isolated, since the report is a read of the character the
  game hands each status and the presses run against a recording `act`. Its failure list heads
  the file.
- K. Dashboard section: no settings section; `dashboard.tsx` holds only the card piece.
