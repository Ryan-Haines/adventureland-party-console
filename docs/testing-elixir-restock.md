# Elixir restock and consumption accounting failure inventory

Before implementation: legacy potion policies must remain unchanged; invalid item
types and min/max ranges must reject. Selecting an elixir must persist its identity,
auto-consume (default true), and procurement opt-in (default false). Existing stock
must be delivered before buying/crafting. Procurement must use durable commerce
orders, protect reserved materials, deduplicate work, and stop when stock or
ingredients are unavailable. A changed/disabled policy must not continue consuming
an old selection. Active elixirs must never be overwritten or repeatedly consumed.
Inventory, native effects, client persistence, and coordinator telemetry are
independent asynchronous milestones. Validate an actual native purchase, delivery,
consumption and craft, plus opt-out and restart paths using ChronAL.

Native elixirs live in slots.elixir with an expiry, not necessarily character.s.
The equipped icon and Active status must reflect that same native expiry. Transfers,
sales, banking, failed actions and CODE reload must not count as consumption.
Consumption costs must survive metrics retries/restarts without double counting;
legacy samples without accounting must be identified. Gold adjustments must not
charge the same consumable purchase twice.


## Implementation

Character restock settings retain existing HP/MP policies and add an optional
elixir policy (minimum 1, maximum 2, automatic consumption on, procurement off).
The catalog picker shows item sprites. The coordinator serves that policy on
ordinary heartbeats; native CODE consumes only unlocked, unbound matching stock
when no elixir is equipped and inventory work is idle.

Existing unreserved merchant/bank stock supplies deliveries. Opted-in procurement
uses normal durable commerce orders and their material reservations. Production
must complete and a later merchant inventory report must arrive before delivery
can preempt that work or another procurement order can be admitted. Delivery
retires idle/gathering movement before taking ownership.

Native elixir expiry drives the equipped icon countdown and Active status entry.
Successful native potion/elixir receipts increment persistent consumption totals
at catalog replacement value. Successful purchases are tracked separately so the
default-enabled gold checkbox does not charge both purchase and consumption.
Old samples have no invented consumption backfill; the options explain this limit.

## Repeatable checks

```powershell
npm run test:e2e -- --project=live --workers=2 e2e/live-elixir-restock.spec.ts
npm run test:e2e -- --project=console --workers=2 --grep "elixir restock defaults|gold history defaults|character sections collapse|metrics persists|metrics collector|metrics outbox"
npm run test:e2e:selection
```

The native journeys use ChronAL and require actual bank withdrawals, native buy
and craft execution, exact purchase/consumption counts, opt-out behavior,
client inventory, coordinator slot/status publication, rendered countdown,
consumption metrics, and restart persistence. Each retains timestamped native
receipts, full state, client snapshots, screenshots and normal fixture evidence.
Owned workspaces are removed only after attachments copy and processes stop.


## Validation result (2026-10-20)

All 11 distinct focused scenarios passed across runs: seven console regressions
and four native ChronAL journeys (stored stock, NPC purchase, crafting, and
merchant self-restock). The final self-restock run passed in 4 seconds of test
execution. This was focused validation, not a full-suite rerun.

Hash-verified local evidence:
- `.build/ci-recovery/elixir-focused-ten-green`: ten passing scenarios, with the
  initial self-restock assertion failure retained transparently in that report.
- `.build/ci-recovery/elixir-compact-timer-green-self-red`: updated timer screenshot
  and three passing checks; native evidence also demonstrates idle-command
  starvation when automatic consumption rejects every retained idle command.
- `.build/ci-recovery/elixir-self-restock-green`: corrected native self-restock,
  exactly one consumption, exactly one remaining item, completed job and published
  effect. All owned workspace copies were removed after evidence collection.

Typechecking and `git diff --check` passed. Selection retains 373 scenarios exactly
once; all 236 gameplay scenarios use ChronAL by default. The completed candidate
`d7268b9d06ae62d06ed9386174ad198839a610e2920449cec27a4cc7a42ac9e6`
was deep-verified against final source hash
`53ebdccb98dde71bc4d9e78c032891ec584b89fda8ffcb6b7edc53dfce16e20a`.
It is staged only; this task did not activate or restart the live console.
