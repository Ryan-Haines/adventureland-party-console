# Collection after failed convoy travel

Failure inventory, recorded before implementation:

- A failed convoy rejects every merchant interruption and each nearby collection
  times out after sixty seconds, cycling indefinitely through the party.
- Admitting collection must still require fresh, stopped acknowledgements from
  all unfinished convoy members; moving, stale or mismatched reports cannot grant it.
- Collection must not restart failed travel, clear its failure diagnostics, reset
  exhausted retry budgets, or overwrite a newer manual navigation command.
- Non-preemptible recovery, defensive combat and disconnected ownership retain
  their existing admission safeguards.
- Completion, job failure and coordinator restart must restore the failed hold
  without duplicating real item transfers or losing pending marks.

Native E2E: `live-hunt-failed-collection.spec.ts` declares an exhausted historical
convoy as its input. Native stopped acknowledgements, item sends, inventory totals,
subsequent collection and restart persistence remain real. Retain state, native
inventory and transfer receipts as artifacts. Existing isolated convoy interruption
regressions cover stale reports, supersession and non-preemptible admission.

Repeat with `npm test -- -- --project=live --grep "failed convoy permits native collection"`.
