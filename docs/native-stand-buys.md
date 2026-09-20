# Native stand buy orders

WTBs share the existing `standBids` remaining-quantity ledger. `useStandSlot`
defaults to false; `acceptHigherLevels` defaults to true. Automatic spare-slot
allocation (`autoStandBuys`) defaults to false. Migration does not change terms,
remaining quantities, or priorities. ALData Deals and anniversary barter remain
separate from the game's gold-only wishlist offers.

Explicit buys and unpaused sales reserve capacity before automatic buys. Automatic
buys use purchase priority and then item ID, with one slot per order. Their Auto
badge reflects placement, not the checkbox. Replacing a sale pauses its terms;
replacing an explicit buy leaves shopping enabled and suppresses automatic
placement until the user explicitly enables its stand preference again.

Auto-stand rules reserve sale slots for eligible bank stock as well as merchant
inventory. After existing sales and explicit buys, bank stock takes capacity from
automatic buys and queues a bounded bank withdrawal batch. Active withdrawals,
locked stock, conflicting rules, and crafting/delivery reservations are respected.
Removing the auto-stand rule also cancels its pending stand withdrawals.

`commerce/native-stand.ts` owns bounded offer batches, server offer IDs, order
revisions, acknowledged fills and placement problems. A same-offer decrease in
quantity or a cumulative trade receipt acknowledges a fill once. Slot absence,
stand closure, unrelated inventory changes and gold changes are not fill evidence.
A missing or replaced offer without sufficient evidence blocks replenishment and
shopping. Full fills require the character's trade receipt because the game
removes a fully filled wishlist slot. Closed stands retain their offers.

The character reconciles buys before and after sale synchronization and leaves
`b: true` slots out of sale matching. Ordinary native batches cap at 9,999;
upgradeable/compoundable equipment batches cap at 99. Price and level limits are
reported as placement problems. Placement never increases the merchant cash
target. Shopping retains its existing bank/gold policy.

Immediately before a shopping API call, the character suspends native offers,
acknowledges removal (including intervening fill receipts), and reserves only the
confirmed shared remainder. Reservations and acknowledgements are persisted.
Nearby, ALData and Ponty purchases all use this guard; Ponty whole stacks are
skipped if larger than the remainder. Duplicate completion reports do not debit
twice. Queued work alone does not suspend offers. Confirmed receipts can arrive
after job recovery; unconfirmed operations stay blocked rather than retrying.

For an ambiguous outcome, inspect `nativeStand.offers`, `nativeStand.purchases`,
the merchant's current slots and the game trade history. Preserve the hold until
the transaction can be established; do not clear the ledger merely to retry.
This release does not automatically infer a lost full-fill receipt after a client
process crash. A later confirmed cumulative receipt can reconcile a missing offer.

Validation: `native-stand.test.cjs` covers allocation, caps, replacement/cancel,
edits, all purchase channels, partial/full fills, restart, duplicates, exact
levels and ambiguous outcomes. `native-stand-client.test.cjs` runs the real client
reconciler against the coordinator handler, including a fill racing with removal.

Activation requires the ordinary `scripts/start-caracal.ps1` workflow because the
character protocol in `characters/shared.js` changes along with the coordinator.
A coordinator-only restart cannot activate this feature's client protocol. After
activation, first confirm defaults and existing terms, then enable an order and
verify its `b: true` slot and ALData merchant-feed entry. A real external fill is
needed to verify live publication timing; Discord refresh timing is external.
