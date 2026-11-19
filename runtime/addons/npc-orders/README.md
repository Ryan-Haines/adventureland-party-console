# npc-orders

Standing buy orders from the NPC sellers Ponty (secondhands) and Ron (lost and found).

## Part 1: what it does in game
1. A new feature.
2. The merchant keeps buying the items the player ordered from Ponty or Ron: exactly X copies for
   "Buy X", or every new copy for "Buy all", never above the order's unit price cap and never
   below the merchant's gold reserve.
3. An order starts when the player presses "Buy X" or "Buy all" in the "Ponty / Ron" dialog. A Ron
   visit starts when the player presses "Visit Ron" with the donation ticked. A
   "Buy X" order stops after X copies; a "Buy all" order stops when the player presses Stop.
   Remove takes an order off the list.
4. It replaces nothing. The buys run as merchant jobs between the merchant's other routines, and
   the merchant goes back to its routines after each job.
5. It moves only the merchant, through its job: to Ponty on the realm of the lot it buys, or to Ron
   on the merchant's realm, and back.
   Every core routine above the add-on job band interrupts it, and the job waits its turn.
6. It buys the ordered items only. Ponty sells a lot whole, so a lot qualifies only when its whole
   quantity fits the copies still wanted.
7. No.
8. No. The merchant walks only in town maps; survival stays core.
9. `orders`, the order list, starts empty and is edited in the dialog. `ronDonate` starts off: a
   Ron visit donates gold only after the player ticks it. `ronDonation` is the gold each Ron visit
   donates; the game decides how much opens his list.
10. Each order's line in the dialog says its next buy ("Next: 1 at 800g each") or why it waits
    ("Over your 1,000g cap", "The gold reserve keeps 5,000,000g", "None in stock").
11. An order that cannot buy waits on its line and the merchant goes on with its routines.
12. Stop and Remove in the dialog, or switching the add-on off. Neither needs a warning; the Ron
    donation needs the player's tick first.
13. Order "Buy 2" of a Ponty item under its price: the merchant buys two copies and no third. Set
    the cap under every listing: nothing is bought. Raise the gold reserve above the merchant's
    gold: nothing is bought.

## Part 2: where it lands in the console
- A. Group task slot (01): none; the merchant's jobs carry the buys.
- B. Movement tier (02): none of its own; each job's walk step runs at the job's tier.
- C. Item claims: none. The buys go through the items owner's actions `market.pontyBuy`, `gold.donate`,
  `npc.lostAndFound` and `npc.lostAndFoundBuy`, under the items owner's working gold.
- D. Turns and targets (03, 04): none.
- E. Survival (05): none.
- F. Settings (11): `orders` (records: id, npc, item, level, count with 0 for every copy, maxPrice,
  stopped), `ronDonate` (boolean, default off), `ronDonation` (number, default 100,000). The cap is
  the player's per order; the reserve is the core `goldReserve`.
- G. Card text (12): none; the dialog shows each order's next buy or its wait.
- H. Overrides and their warning: none.
- I. Conflicts `npm run addon:check` reports: none.
- J. Tests: `tests/orders.test.cjs` covers the order rows, the buy rule (cap, reserve, whole lots,
  every realm, exactly X, Stop, Remove), the job plan and its count across two jobs, the Ron consent
  and Ron's buys one lot at a time.
- K. Dashboard: `dashboard.tsx` fills the `top-bar` slot's `actions` part with the "Ponty / Ron"
  button, which opens the add-on dialog `orders`.

## How it plays

- `merchant.jobKind` declares `ponty` on the lot's realm (`listing`), and `ron` with `spends` on the
  merchant's realm (`here`) once `ronDonate` is ticked; both run the `addon-steps` command. The
  "Ron orders" routine switch is the player's second consent for the donation.
- `merchant.job` (coordinator) reads `market.ponty`, the merchant's gold from its last report,
  `goldReserve` and Ponty's and Ron's places (`movement.npcPlace`), picks one order's lot with
  `nextPurchase` and keeps it as `pending` in the party store. The job names the lot's realm, and
  its steps walk to Ponty and ask `market.pontyBuy`. With no Ponty buy it queues one Ron visit per
  "Visit Ron" press: walk to Ron, `gold.donate`, then `npc.lostAndFound`.
- `merchant.step` (merchant) ends a Ponty job once its buy went out. On a Ron job it keeps Ron's
  list (`npc.lostAndFoundList`) as `ronStock`, asks `npc.lostAndFoundBuy` for the cheapest lot an
  order wants, counts each lot bought in `ronBought`, and ends once no order wants a listed lot.
- `merchant.job.ended` counts a `done` Ponty job's copies in `bought`, so "Buy X" stops at X across
  restarts.
