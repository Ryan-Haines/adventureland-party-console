# Item titles

A copy of an item can carry a title in `item.p` ("shiny", "glitched",
"superfast" and the others in `G.titles`). The game prefixes the item's name
with it and changes its stats. The console now does both wherever it shows a
copy: the item details dialog, the equipment comparison and the catalog
comparison.

## Game rules

From the game's `js/html.js` (`render_item`) and `js/old_common_functions.js`
(`calculate_item_properties`):

- Name: `G.titles[p].title + " " + name` ("Shiny Blade +7", "Super Fast
  Bow"). A title missing from `G.titles` prints as `p.toTitleCase()`.
- Shiny: an item with attack gains 4 attack, 7 for the two-handed weapon types
  (`doublehand_types`: axe, basher, great_staff). Otherwise an item with a
  base stat gains 2 stat, an item with armor gains 12 armor and 10
  resistance, and any other item gains 1 Dexterity, Intelligence and Strength.
- Glitched: the game adds 1 to Dexterity, Intelligence or Strength at random
  each time it calculates the stats. The console shows that as a note in the
  extras box, not as a stat.
- Any other title adds each of its numeric fields that is an item stat:
  Super Fast and Fast add 20 and 10 attack speed, Sniper's adds 2 attack,
  Lucky adds 2 luck.

The game applies the title before the upgrade levels, so a shiny item's extra
stat follows its stat scroll. `calculatedLevelProperties` does the same, and
every card and comparison reads its stats from there. A live copy's reported
`item_properties` already include the title; the console's level preview
adds the difference between two calculated levels, so the title counts once.

`characters/shared.js` reports `G.titles[p]` on the copy's meta as
`meta.title`, and the coordinator keeps it in the inventory stream
(`public-state-characters.ts`). Legacy items' `def.legacy` stats are not
covered: the reported definition drops nested objects.

## Failure inventory

Written before the implementation; each line has a check in
`e2e/item-titles.case.ts`.

1. A titled copy reads as a plain one. The item details dialog's title must
   read "Shiny Blade +7", and the extras box must show "Title: Shiny" in gold
   (the game draws the title in the name's color, so the console picks gold
   to set it apart).
2. A shiny weapon's attack ignores the title. Blade +7 with no reported
   properties must show Damage 53 (49 from its levels plus 4), and a shiny
   axe +0 Damage 37 (30 plus 7 for a two-handed type).
3. A shiny item without attack gains the wrong stat. A cape with a base stat
   and a dexterity scroll shows Dexterity 5 (3 plus 2); a helmet with armor
   shows Armor 22 and Resistance 10; an earring with neither shows 1
   Dexterity, Intelligence and Strength.
4. Other titles add nothing. A Super Fast bow must show its attack speed
   raised by 20, using the title's fields from `meta.title`.
5. Glitched invents a stat. A glitched copy shows its name and the extras note
   "Glitched (+1 Dexterity, Intelligence or Strength at random)" and no stat
   change.
6. A live copy counts the title twice. With reported properties that already
   include the title, the card shows the reported value.
7. The comparisons drop the title. The equipment comparison's proposed panel
   names "Shiny Blade +7" and adds its 4 attack; the catalog comparison's
   column A names "Shiny Blade" and its Damage row includes the title.
