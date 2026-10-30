# Stat colors

Every game-style card (`docs/item-card.md`, `character-card.md`,
`comparison-card.md`, `catalog-comparison-card.md`, `skill-card.md`,
`monster-card.md`) colors a stat from one palette,
`dashboard/features/party/stat-colors.ts`, so a stat reads the
same color in every menu.

The palette keeps the game's hue for each stat (`colors` in the game's
`js/old_common_functions.js` and the literals in `render_item`). Where the
game's color is close to invisible on black it uses a brighter shade of the
same hue: Armor `#A3A9B0` (game `#5C5D5E`), Resistance `#8B74C9` (`#6A5598`),
Fortitude `#9A6BC9` (`#5F3085`), Crit Damage `#C2366A` (`#A8214E`), Lifesteal
`#C8323E` (`#9A1D27`), Manasteal `#5C66D9` (`#353C9C`), Fire Res. `#D2473D`
(`#B42B22`) and Blast Res. `#8E72A8` (`#685079`). Attack uses the item card's
`#DB2900` and MP `#3A62CE`, where the game's character panel used green and
`#365DC5`. Skill cooldowns use the game's skill-name blue `#4EB7DE`, so they
don't share Evasion's `#7AC0F5`.

The character card's ATTSPD, RANGE, RUNSPD, ARMOR and RESIST. lines take their
stat colors instead of the game panel's gray.

## Failure inventory

Written before the implementation; each line has a check in
`e2e/stat-colors.case.ts`.

1. A stat changes color between menus. Attack, MP, Armor, Resistance,
   Lifesteal and Range must read the same color on the item card, the monster
   card, the character card or its extras, the equipment comparison and the
   skill card wherever each appears.
2. The character card stays gray. Its ATTSPD, RANGE, RUNSPD, ARMOR and RESIST.
   labels take the attack speed, range, speed, armor and resistance colors.
3. Two stats share a color. A skill's Cooldown differs from Evasion.
4. A dark game color stays unreadable. Armor, Resistance, Fortitude,
   Lifesteal and Manasteal use their brighter shades.
