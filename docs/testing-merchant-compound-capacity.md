# Automatic compound withdrawal capacity

Failure observed on the live merchant: a full inventory repeatedly accepted
bank-backed auto-compound work, deferred withdrawals to preserve three slots,
reported successful completion without processing ingredients, and admitted the
same work again about five seconds later. Bankboi withdrawals were also staged
without space to receive them.

Admission must distinguish carried work from external inputs. Full inventories
can still contain a runnable triple or compound leftovers that should be banked.
Only external-only work requires more than three empty slots. Craft reservations,
rule conflicts, disabled automation, and unrelated queued jobs remain effective.
Space freed by genuine NPC sales must permit automatic withdrawal and native
compound attempts; capacity must not create a permanent cooldown.

The native capacity scenario declares initial bank ingredients and a full bag,
observes fresh reports without repeated compound admission, then uses genuine
NPC sales to free space and requires an actual native compound response. Its
finally attachment preserves inventory, scheduler state, and native receipts.

Linux run 38013269713 passed the blocked admission phase, then timed out while
the serialized NPC-sale job was still progressing: twenty genuine sales took
126.843 seconds, twenty-one helmets remained, and the correctly admitted
compound job was queued behind those sales. This was an unrelated forty-sale
initial workload. Declare eight sellable fillers and natively lock the remaining
initial fillers; retain the full bag, genuine sales, compound response, and
original 150-second processing deadline. No production behavior changes.
