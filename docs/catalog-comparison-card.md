# Catalog comparison card

The Equipment catalog's "Compare selected" table (`catalog-comparison.tsx`)
keeps its dialog, caption and column headers: sprite, name, preview level
slider, stat scroll select and Remove. Its stat rows become one table body in
the game's item-card style (`docs/item-card.md`): black, a 5px `#808080`
border and a monospace font. The rows stay in one table, so a stat sits on the
same line in every column.

- Each row label uses the item card's name for the stat ("Damage",
  "Dexterity", "Run Speed") and its color from `stat-colors.ts`
  (`docs/stat-colors.md`). The table takes the label from the first column
  that has the stat.
- Each value is the item card's text for that stat ("+50" for Range, "4%" for
  Crit), in the card's value color. A column without the stat shows 0.
- Columns B to D show their difference against A after the value, green
  (`#85C76B`) when the number is higher and red (`#E13758`) when it is lower,
  as the equipment comparison does (`docs/comparison-card.md`). Neither card
  treats any stat as lower-is-better, so a higher Attack MP Cost also reads
  green. An unchanged stat shows no difference.
- The type rows keep their place. The game's card labels both the damage type
  and the weapon type "Type", so the table names them "Damage Type" and
  "Weapon Type", plus "Item Type" for the definition's type. Values use the
  card's text and colors ("T2 Bow", "Physical" in `#93AB98`). The Ability row
  shows the card's ability name in its color and its effect text with the
  chance filled in.

## Failure inventory

Written before the implementation; each line has a check in
`e2e/catalog-comparison.case.ts`.

1. A stat disappears or moves. Every numeric stat any column has must still
   get a row, in the order the table used before (`item-detail-property-order.ts`).
2. Labels stay raw keys. Rows must read the card's names ("Damage", not
   "attack"; "Dexterity", not "dex") in their palette colors (Damage
   `#DB2900`, Dexterity `#44B75C`, Intelligence `#3E6EED`, Range `#93A6A2`).
3. Values lose the card's formatting. Range must read "+50" as on the item
   card, and a column without the stat must read 0.
4. Differences lose their direction. A higher value in B shows "(+x · +y%)" in
   green, a lower one "(-x · -y%)" in red, a stat A lacks "(+x)" with no
   percentage, and column A and unchanged stats show no difference.
5. The type rows lose their meaning. Item Type, Weapon Type and Damage Type
   must show the card's text with Damage Type in its game color, and the
   Ability row must show "Freeze" in `#2EBCE2` with the effect text.
6. The body stops looking like the game's card. It must be black with a 5px
   `#808080` border and a monospace font.
7. Columns drift out of line. Each stat's cells must share one row, so their
   tops match across columns.
8. The column headers change. The preview level slider, stat scroll select
   and Remove buttons keep their accessible names, and the caption stays.
9. The table ignores the preview. Moving A's level slider must update A's
   value and every other column's difference.
10. The layout breaks. On a narrow viewport the table scrolls inside its own
    box and the dialog does not scroll sideways.
11. An added item shows no picture. A catalog item can carry its sprite on the
    catalog entry (`MerchantCatalogItem.sprite`) with none on its `meta`, and
    the table read only `meta.sprite`, so columns B to D showed an empty box.
    Every column's header must show its item's sprite, 48px square inside the
    header's sprite box.
