# Inventory adoption after an unlinked upgrade

Failure inventory before implementation: an old completed receipt can lack its
commerce linkage while the pending paid item has moved and advanced in level.
Retrying only the stale input and slot leaves real usable intermediate stock
blocked. The user authorized a reasonable inventory assumption, not creation of
a successful receipt or attribution of a historical result.

Adopt only actual unlocked, unbound, metadata-compatible intermediate stock
below the requested target, excluding paid results, batch stock and fresh craft
reservations. Keep paid spending, attempts and completed-result quota unchanged;
record the assumption explicitly. Never count an existing target-tier item as a
newly produced result. The native historical fixture preserves an unrelated
finished item and requires continuation of actual intermediate stock through
real upgrade responses, with durable adoption and conservation evidence.

The same historical input also shifts an exactly counted paid base batch and
leaves surplus target-tier inventory around an already counted result. After
explicit adoption, reidentify only that already-counted quota using compatible
available stock, then remap the paid base batch only when its total matching
count is exact. A real CODE replacement at the adoption checkpoint must retain
this policy without counting surplus finished items as new results.

Live activation exposed a self-reservation boundary: general craft protection
correctly hides the current commerce job's input, expected output and counted
results from other consumers. Applying that same view to the owning job's
adoption hid its own real survivor. The existing native adoption scenario covers
this boundary. Request a command-fenced owner-specific view that excludes only
that current job's commerce identity markers, retaining all craft requirements,
other orders and delivery reservations; leave general protection unchanged.

The native adoption and CODE replacement completed with preserved paid quota,
shifted batch ownership and genuine new results, but the final audit assertion
failed. The fixture held the persisted adoption checkpoint and replaced CODE
before its subsequent client activity request. Record a new adoption transition
at the authoritative command-fenced checkpoint, rather than claiming it before
persistence or depending on an old runtime continuation for the audit.
