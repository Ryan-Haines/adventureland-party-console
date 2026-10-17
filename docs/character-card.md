# Character card

The character stats dialog shows two boxes in the game's item-card style
(`docs/item-card.md`): the game's character panel on the left and everything
else the console knows on the right. The header and close button stay as they
are.

- **Character card** replicates the game's panel (`render_character` in the
  game's `js/html.js`): NAME, LEVEL, HP, MP, HEAL when the character heals, ATT,
  ATTSPD, RANGE, RUNSPD, ARMOR, RESIST. and CODE, with the game's labels
  (`interface.character.*`) and colors, and its condition tags ("[C]" on ATT
  while cursed, "[P]" on ATTSPD while poisoned).
- **Character extras** holds every other entry from the console's stats grid in
  two columns: the attributes, the armor and resistance reductions, the
  unrestricted run speed, luck and the combat stats. Each attribute, plus armor
  and resistance, has a collapsible breakdown of its effects, each effect
  colored by the stat it changes. A breakdown starts open, and the dashboard
  remembers each one's open or closed state across characters and reloads
  (`useStoredBoolean`).

The boxes sit side by side when the dialog has room, and the extras box moves
below the card when it doesn't.

## Failure inventory

Written before the implementation; each line has a check in
`e2e/character-card.case.ts`.

1. The card drifts from the game's panel. Its lines must be the game's labels,
   colors and order, with ATTSPD as frequency × 100 and RUNSPD as the live
   speed, both rounded (a merchant with an open stand reads 10, as in game).
2. HEAL shows for every class, or never. It appears only when the character's
   heal is above zero.
3. Conditions lose their tags. A cursed character shows "ATT: 33 [C]", a
   poisoned one "ATTSPD: 73 [P]".
4. An entry from the old grid disappears. Every value and every effect in the
   console's 26 entries must appear in the extras box: the attribute effects
   with their per-point rates, the armor and resistance reductions with the
   100-damage example, and the unrestricted run speed.
5. Effects lose their meaning. Each effect line must name and color the stat it
   changes ("+483 Max HP" in the HP color, "+23 Armor" in the armor color).
6. A collapse is forgotten. Collapsing Strength must hide its effects, stay
   collapsed when another character's dialog opens, and survive a reload;
   expanding it must stay expanded the same way.
7. The layout breaks. On a wide dialog the boxes sit side by side with aligned
   tops; on a narrow one the extras box sits below the card, and nothing
   scrolls sideways.
8. Missing data turns into zeros. A run speed the console hasn't received
   still reads "Waiting for speed data".
