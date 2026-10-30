# Unconfirmed WTB purchase: failure inventory

Written before the change (2026-10-14). Reported live: Spider Silk ×45 at 150,000g showed
"Purchase outcome unconfirmed; reconciliation required" for three days. Before buying
from another player's stand the coordinator records a pending purchase in
`nativeStand.purchases`; only the merchant's `purchased` report removes it. A job that
ended without that report (here job merchant-1791749596518 on 2026-10-11: 1 Spider Silk
for 117,600 from MtlSnk on EU IV) leaves it forever, and while it exists the item's WTB
is neither listed on the stand nor bought again. Nothing implements the reconciliation
the message asks for. Live journey: `e2e/live-wtb-unconfirmed-purchase.spec.ts`.

1. **Permanent block.** A pending purchase whose job has ended can never be cleared.
2. **No way to decide.** The dashboard shows the message but offers no action.
3. **Wrong count.** "It wasn't bought" must leave the WTB quantity unchanged; "It was
   bought" must count the reserved quantity as filled, exactly once.
4. **In-flight purchase cleared.** A purchase whose job is still current or queued must
   not be resolvable; its normal confirmation path stays in charge.
5. **Other items touched.** Resolving one item leaves other items' purchases and bids
   alone.

Release 1.5 follow-up: pending queued work must reject both manual outcomes without changing either bid; cancelling the owned job permits exactly one resolution. A replay or coordinator restart must not decrement a confirmed order twice. Poll the purchase ledger and both exact bid quantities together after browser resolution.
