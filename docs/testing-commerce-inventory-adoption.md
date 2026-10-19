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

Linux focused run 38017005116 passed adoption and CODE replacement, then
continued genuine paid-batch upgrades through progress sequence 45 with four
counted results and no error. Its final unfinished base item was still buying
individual scrolls and travelling between NPCs when the original deadline ended.
Declare twenty native scroll0 units in unused slot five so this ownership test
does not repeatedly exercise unrelated scroll procurement. Preserve the three
shifted paid inputs, existing target-tier surplus, quota conservation, actual
upgrade outcomes and the original 180-second completion deadline.

CI run 39161701420, gameplay shard 3, failed in the test's `route.fetch`
proxy with `ECONNRESET`, rather than a commerce assertion. The trace contains
41 proxied checkpoint calls; the last reset occurred during later batch progress.
Native inventory retained both original +3 helmets, gained four additional +3
helmets, and consumed ten scrolls. The last coordinator snapshot had recorded
three additional results and still awaited its final upgrade checkpoint. There
was no coordinator crash in the retained log. These observations identify an
uncaught test-proxy transport failure; they do not establish why the underlying
connection reset or explain separately observed live merchant symptoms.

Limit the proxy to the first adoption checkpoint whose response this scenario
intentionally holds across CODE replacement. Require its successful HTTP response
before exposing adoption to the test. Observe all subsequent checkpoint request
states with timestamps, but send them through the browser's ordinary transport.
Retain the persisted-adoption/release timestamps, exact paid-state and owned-slot
assertions, real CODE replacement, final queue completion and inventory result
conservation. No paid-action retries, relaxed counts or longer deadlines are
introduced. Focused verification evidence is summarized in
`testing-commerce-checkpoint-ci.json`; full reports remain under
`.build/merchant-checkpoint-focused/`.

A separate native regression reproduces the reported live symptom: after the
first confirmed result in a running three-item paid batch, relocate both remaining
base items from their recorded slots into two empty native slots. Without a CODE
restart, the old implementation immediately paused with “Owned upgrade item is
ambiguous; order requires inventory review”, despite exactly two owned base items.
The retained failing report is `.build/merchant-checkpoint-focused/slot-repro-failed/`.

The slot resolver now remaps the complete owned result/batch/active group before
a non-pending lookup, using the same exact-count ownership policy already applied
at order startup. Persisting the next checkpoint retains the remapped slots.
Pending native outcomes continue through their separate receipt reconciliation.
Surplus identical cargo must still pause for inventory review. This fixes a
reproduced way to stall a running batch after item movement; the user's historical
order was already absent, so it cannot be identified conclusively as that incident.
