# market-filters

Answer Part 1 in your own words before any code; your agent answers Part 2 from
`npm run addon:map` and runtime/addons/HOOKS.md, and checks it with `npm run addon:check`
(runtime/addons/README.md).

## Part 1: what it does in game
1. A new feature: a filter bar on the Market. Nothing in the console is wrong without it.
2. It makes the party do nothing; it narrows the rows each Market tab shows.
3. It starts when the player types a bound, picks a server or tier, or turns on Newest first in a tab's bar, and stops when the player empties the boxes or presses Clear.
4. The Market's own search box and checkboxes stay as they are, and the bar sits after them in the same row. While the bar is set its order sorts the tab: with Newest first on, the most recently seen rows come first, and otherwise the tab keeps its own order. Picking one of the Market's sorts clears the bar.
5. It moves no character.
6. It keeps, uses, buys, sells and moves no item. The tab's Buy and List buttons work the same on the rows it leaves.
7. No.
8. No.
9. No settings. Each tab's bar has a lowest and highest level, a lowest and highest price (250k and 1.5m shorthand works), a server choice, a tier choice (Normal, High, Rare, Legendary, Exotic: the item name's colour) and a Newest first switch, all empty or off at start. A tab draws a server or tier choice only when its rows carry one.
10. Nothing on the card. The bar shows Clear while any bound is set.
11. Nothing to try: a bound that matches no row shows an empty tab, and Clear brings every row back.
12. Clear on the bar, or switching the add-on off in the add-on manager, shows every row again. No warning.
13. Set "Highest price 100k" on Live WTS: every row left costs 100k or less, and Clear shows the full list again. Pick a server: only that server's rows stay. Pick High: only blue-named items stay. Turn on Newest first: the most recently seen listing is at the top.

## Part 2: where it lands in the console
- A. Group task slot (01): none.
- B. Movement tier (02), between which two named tiers, and cancel or wait: none.
- C. Item claims (10): none.
- D. Turns and targets (03, 04): none.
- E. Survival (05): none.
- F. Settings (11), each number from game data, a setting with a default, or a progress rule: none; every bound is the player's typed value.
- G. Card text (12), and the next strategy when progress stops: none.
- H. Overrides and their warning: none.
- I. Conflicts `npm run addon:check` reports, resolved in the owner's table: none ("No conflicts: 9 registrations, 2 add-ons").
- J. Tests: tests/market-filters.test.cjs checks each bound including the tier, the shorthand prices, the Newest first order, the four tabs filled with one bar, keep and order each, no search box in the bar, Clear handing the slot an unset value, and a held value drawn again when the player returns to a tab.
- K. Dashboard section: `dashboard.tsx` fills the `list-view` slot of `market:wts`, `market:wtb`, `market:classifieds` and `market:ponty`, one bar with `keep` and `order` each. It has no settings section.

## What the bar does not do
- Keyword search: every Market tab already has the Market's search box for item, seller and server names, so the bar adds no second one.
- Newest first on Classifieds: the tab stamps every row with the feed's one update time, so the rows tie and keep the tab's own order.
