# Stat-scroll bank supply: failure inventory

Written before the change. `preloadStatScrolls` (characters/shared.js) prepares the
scrolls a stat-scroll visit needs. It called `retrieveFromBankUntil(names[n], needs[n])`
with a list index instead of the scroll name, so the required count was `undefined`
and nothing was ever withdrawn. Live journey: `e2e/live-stat-scroll-bank.spec.ts`.

1. **Bank stock ignored for purchasable scrolls.** A STR/INT/DEX/VIT scroll held in
   the bank is bought again from the NPC; the bank copy stays and gold is spent.
2. **Bank stock ignored for other scrolls.** Any other stat scroll fails with
   "Missing N × scroll in merchant or bank inventory" even when the bank has enough.
3. **Over-withdrawal.** Only the visit's required count is withdrawn; a fully
   stocked inventory makes no bank trip.

Delivery dependencies (#103): a higher priority delivery can steal an unmodified item; an exact stat mutation can invalidate its reserved fingerprint; removing the queue before telemetry may hide a stranded order. Queue both marks before releasing the merchant, retain the stat mark, and observe the recipient receive only the requested STR item without spending.

Stale cleanup is separate from native application: removing a stale INT-modified item mark must retain the old DEX delivery fingerprint and its missing-item block; it cannot fabricate STR or consume its scroll. Positive primary, rare-scroll and priority cases require exactly one explicit applied receipt whose observed item has the requested stat.

A genuine native run exposed a lost scheduler wakeup: the dependency gate retires the earlier empty delivery job, while idle recipients may not publish a later full inventory. Applying a stat must explicitly requeue ready retained deliveries after consuming its stat dependency; observing the changed fingerprint alone is insufficient. The higher-priority journey retains its final native recipient assertion.
