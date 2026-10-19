# Equipment comparison card

The equipment comparison dialog keeps its two panels, headers, stat scroll
buttons and level sliders. Each panel's grid of stat tiles becomes one black
box in the game's item-card style (`docs/item-card.md`): a 5px gray border,
each stat label in its game color and the value beside it. In the proposed
panel, a change shows after the value in green when it improves on the
equipped preview and red when it reduces it, as the dialog's description says.
The set changes section uses the same box, with GAINED in green and LOST in
red.

Labels stay as the dialog had them ("INT", "Armor", "Attack") so the existing
journey in `e2e/gear-comparison.case.ts` keeps reading them. Each box is a
labelled group, not a region, so the panels stay the dialog's only regions.

## Failure inventory

Written before the implementation; each line has a check in
`e2e/comparison-card.case.ts`.

1. A stat disappears. All 26 rows must still render in each panel, in the
   same order, with the same formatting.
2. Labels lose their meaning. Each label must use its stat's game color (HP in
   `#FF2E46`, INT in `#3E6EED`, Lifesteal in `#9A1D27`).
3. Changes lose their direction. In the proposed panel, an improvement shows
   "(+x · +y%)" in green and a reduction "(-x · -y%)" in red; the equipped
   panel shows no change text.
4. Set changes lose their outcome. GAINED renders in green and LOST in red,
   with the same text as before.
5. The panels stop being the dialog's regions. The new boxes are groups, so
   `getByRole("region")` still finds exactly the equipped and proposed panels.
6. The layout breaks. On a narrow viewport the panels stack and nothing
   scrolls sideways.
7. The two stat boxes drift out of line. A notice on one side only (the
   offhand checkbox on the left, the two-handed note on the right) must not
   push one box lower: the panels share rows for the header, notice, level
   slider and stats, so both boxes start at the same height and each stat
   sits beside its counterpart.
8. The level sliders disappear. Upgradeable gear shows a preview slider in
   each panel, as before.
