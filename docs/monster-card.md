# Monster card

A monster's details show two boxes in the game's item-card style
(`docs/item-card.md`) wherever the console shows a monster: the Bestiary's
monster dialog and a monster opened from an item's drops in item details. One
component, `MonsterCards`, renders both places.

- **Monster card** replicates the stat lines of the game's monster card, which
  is the game's item card in monster mode (`render_item` with `args.monster`,
  called by `render_monster_info` in the game's `js/html.js`): the item card's
  stat lines and colors with XP as a plain number, Range and Speed without a
  plus sign and A.Speed always shown as frequency × 100, then abilities and
  auras that are skills, the Poisonous, Cooperative, Peaceful and Supporter
  lines, "Spawns" lines and the explanation.
- **Monster extras** holds the definition fields the game's card has no line
  for (respawn, aggro, rage, charge and the like), with readable labels and
  Yes/No booleans, plus any ability that isn't a skill. Each label takes a
  meaning color from the game's palette (Respawn light blue, Aggro red, Rage
  `#F36C6E`, Charge teal, Difficulty orange, Immune `#A59FFF`, Abilities
  `#FC5F39`) or light gray.

A level slider above the boxes previews the monster at levels 1 to 20, as a
reference. Monsters level up while nobody fights them, and when they drain XP
from players they kill; a respawn starts at half the previous level
(`level_monster` and `calculate_monster_stats` in the game's `node/server.js`).
Each level adds half the base HP and one base XP; Damage grows by 12.5%, Speed
by 0.24 and attack speed by 0.034 per level up to level 12. Gold and the drop
roll multiply by the level. On maps whose packs keep growing, the game uses
smaller Damage, Speed and attack speed steps; the preview shows the ordinary
steps and says so.

The dialogs keep everything else: the header with the name and
`G.monsters.<id>`, the navigate button (the game's "Find"), the Monster
achievements box with score and the achievement ladder (the game card's
Kills, Score and achievements), the spawns and the drops.

## Failure inventory

Written before the implementation; each line has a check in
`e2e/monster-card.case.ts`.

1. The card drifts from the game's monster mode. Goo reads "XP: 100",
   "Damage: 5", "Type: Physical", "Range: 15", "HP: 100", "MP: 2",
   "Speed: 6" and "A.Speed: 40", in the game's order and colors.
2. Defensive stats lose their game names. Mr. Green's `phresistance` reads
   "Impact Res.: 100" and `apiercing` "A.Piercing: 320".
3. Flags and spawns vanish. Mr. Green shows "Cooperative" and three
   "Spawns: Green Jr." lines, and a spawn opens that monster where the dialog
   supports drilling in.
4. Abilities lose their kind. The Black Scorpion's `weakness_aura` is a skill
   and an aura, so it reads "Aura: Weakness Aura"; the Harpy's `warp_on_hit`
   isn't a skill, so it moves to the extras box instead of disappearing.
5. A field from the old grid goes missing. Every definition field must appear
   on the card, in the extras box or in the dialog's existing sections; only
   the name, skin and achievements, which those sections show, leave the grid.
6. The two places drift apart. The Bestiary dialog and the monster opened from
   item details render the same card and extras for the same monster.
7. The layout breaks. The boxes sit side by side when the dialog has room and
   stack when it doesn't, with nothing scrolling sideways.
8. The extras read as a wall of gray. Their labels carry meaning colors.
9. The level preview drifts from the game's rules. At level 9 Goo reads HP 500,
   XP 900, Damage 10, Speed 8.16 and A.Speed 70.6; at level 15 the combat
   stats stop at their level-12 values while HP (800) and XP (1500) keep
   growing. Level 1 shows the base stats, and the preview names the gold and
   drop multiplier.
