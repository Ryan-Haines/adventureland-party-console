# Lucky-slot restoration is best effort

Checkpoint transport can yield while a native send changes the displaced stack
and a manual swap relocates the result. Revalidate both slots after saving the
checkpoint before any optional swap-back. The changed-layout native journey
must leave cargo at its observed positions when that validation fails.

## Failure inventory recorded before implementation

An incoming item can change the displaced source contents after a real upgrade. A rejected or unconfirmed return swap can also leave the real result in the lucky slot. Previously either condition rejected the operation and retained layout bookkeeping indefinitely, blocking unrelated merchant work. Restoration errors could mask the actual destruction or success response.

Only restoration is optional. Failed preparation must issue zero upgrades. An active native operation, an interrupted runtime, and failed durable checkpoints must remain blocking. No skipped restoration may create an outcome, recreate an item, change completed quantities, or retire a production receipt. Native outcome reconciliation and per-roll lucky tracking remain independent of this layout journal.

Later recovery of an interrupted preparation may also retire failed layout bookkeeping once the runtime is current and native inventory is idle. This does not authorize the original upgrade: its preparation receipt remains separately reconciled. Authoritative absence of pending production receipts permits retirement of stale preparing layouts too.

The existing native stuck-production scenario must verify a settled operation with changed displaced contents can continue merchant work, preserves every actual item, records a restoration warning, and retains the actual result slot. Real success/destruction and durable roll advancement must still be observed. A rejected preparation must still perform no operation; an unresolved native operation must still prevent inventory reuse.

Retained isolated assertions that treated ambiguous settled restoration as a permanent global hold require policy updates: changed displaced contents, unrelated lucky-slot contents, and missing restoration layout now leave inventory untouched and retire only layout bookkeeping. Busy-operation and preparation assertions retain their guarantees.
