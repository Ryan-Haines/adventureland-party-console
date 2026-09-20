# Deconstruction

Right-click an eligible bag item on any character to **Mark for deconstruction** or
**Auto mark for deconstruction**. Brown borders identify marked items and automatic
rules. The expandable Deconstruction section at the bottom of each character card
shows pending work, automatic rules, blocked reasons, removal, and retry controls.

Character marks request merchant pickup, preserving the exact item and quantity.
A confirmed pickup transfers the mark to the merchant. Merchant marks schedule a
visit to the Craftsman in Main and use the game's dismantle action, one unit at a
time. Fees can be withdrawn from bank gold. Insufficient funds or result space
leave visible blocked work for retry.

Both menu visibility and server validation use the current game's dismantling
catalog. Recipe items qualify; compound equipment requires a positive level and
boosters are excluded. Locked or blocked items never qualify. Auto rules belong to
the character and match name, level, stat, and special variant, so lower-level
compound outputs are not recursively processed.

Each destructive action is durably claimed before execution and acknowledged
afterward. Uncertain results following interruption/restart are blocked for review,
not automatically replayed. Removing a rule cancels its pending marks; an action
already in flight must finish. Existing conflicting work marks must be removed
before deconstruction.

Game semantics verified against the official server dismantle handler:
https://github.com/kaansoral/adventureland_mongodb/blob/main/node/server.js

Validation: scripts/tests/deconstruction.test.cjs covers eligibility, pickup,
automatic matching, relocation, cancellation, duplicate receipts, restart recovery,
and native executor ordering and resource guards.
