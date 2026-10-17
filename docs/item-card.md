# Item card stats

The item details dialog's stats grid becomes two boxes in the game's item-card
style: black, a 5px gray border and color-coded lines. Everything else in the
dialog stays as it is.

- **Item card** replicates the stat lines of the game's card (`render_item`
  in the game's `js/html.js`): the game's order, its English labels
  (`languages/en/interface.js`, `interface.item.*`) and its colors (`colors` in
  `js/old_common_functions.js` and the literals in `render_item`).
  `item-card-lines.ts` builds the lines. The dialog header keeps the name and
  explanation.
- **Item extras** holds the grid fields the game's card has no line for (equip
  slot, stackable, tier, scroll, id and the like), in the same style.

The boxes sit side by side when the dialog has room, and the extras box moves
below the card when it doesn't. Stat values come from the live `item_properties`
report and the console's level preview, as before.

## Failure inventory

Written before the implementation; each line has a check in
`e2e/item-card.case.ts`.

1. Stats render in one color under raw keys. Each game stat must use the
   game's label and color, in the game's order (for example "Damage" in
   `#DB2900`, "Crit Damage" after "Crit").
2. A stat the game shows as a card line lands in the extras box. Lifesteal,
   the resistances, Explosion and the other `render_item` stats must render on
   the card (Vampiric Gloves' Freeze Res., the Lolipop Mace's Explosion), never
   as raw keys.
3. A built-in ability prints its raw id and `attr0`. Sugar Rush, Bash, Freeze
   and the other abilities with a game description must show their name, color
   and effect text with the chance filled in.
4. An item that grants a skill pastes the skill's text or shows its id. The
   Zapper's `zapperzap` must show one "Ability: Zap" link with the skill's
   explanation on hover, and clicking it must open that skill's details in the
   item dialog, with Back returning to the item.
5. Nested definition fields vanish. Class-only and map-only bonuses (Scorpion
   Seal for warriors and paladins, the Mothstep Boots' Cave of Darkness bonus)
   must reach the dashboard and show as "Bonus: ... [Only]" lines with their
   stats.
6. Grade disappears or ignores the preview. Grade must come from the item's
   `grades` (default 9, 10, 11, 12) at the preview level, and boosters show
   none.
7. A field from the old grid goes missing. Every grid entry must appear on the
   card or in the extras box.
8. The rest of the dialog changes. The header, explanation, NPC prices,
   eligible classes, level stat preview, set, craft, exchange and drops must
   render as before.
9. The layout breaks. On a wide dialog the boxes sit side by side with aligned
   tops; on a narrow one the extras box sits below the card, and nothing
   scrolls sideways.
10. The card ignores the preview. Moving the level slider must update the card's
    stats and grade, and stats the level calculation doesn't cover keep their
    live value.
11. Item state disappears or lands in the wrong box. Sealed, locked, account
    bound and expiry show on the card. Quantity and stat scroll show in the
    extras box, since the game shows them on the inventory slot, not the card.
    "Locked" uses `#8C8C8C`: the game's `#404141` is close to invisible on
    black.
12. Booleans print "true" and "false". They read Yes and No.
13. A scrolled stat shows twice. Once a copy has a stat scroll (`stat_type`), the
    game folds its "stat" into that stat and shows no Stat line
    (`calculate_item_properties` sets `prop.stat=0`). The card must show only
    the scrolled stat: Winged Boots +7 read "Intelligence: 9" on an
    intelligence-scrolled copy and "Dexterity: 9" on a dexterity-scrolled one,
    with no "Stat: 1" from the base definition.
14. Non-equipment loses the game's lines or invents equipment ones. Potions
    show "HP: +400", elixirs their effect and hours, boosters their gain with
    no grade, and the "[i]" line says what the game says: Exchangeable,
    Upgradeable, Compoundable, Collectable (a collector-quest ingredient),
    Usable (any other crafting ingredient) or Information. The Tracktrix shows
    only "[i]: Information", as the game's card does.
