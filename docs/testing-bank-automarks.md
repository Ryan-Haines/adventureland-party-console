# Bank automarks and collection

Failure inventory: automatic NPC rules can fail to materialize when other
withdrawals exist; repeated reconciliation can duplicate cells or jobs; changing
the always-on setting can lose pending intent; threshold collection can inherit
the disabled withdrawal routine; counts can use quantities instead of bank cells;
locked, reserved and conflicting stock can become sellable; automatic badges can
disappear in storage or be mislabeled as individual NPC marks.

The console journey renders native bank tiles against a declared bank/rule read
boundary and records a screenshot covering Auto bank, Auto NPC, deconstruction,
stand, upgrade, compound and manual NPC sale labels. No game receipts are forged.

The native journeys create an automatic NPC rule through the bank context menu
and confirmation. They verify below-threshold marks wait with always-on disabled,
toggling it creates a job, already-enabled marks create jobs, and above-threshold
bank marks create collection jobs with always-on disabled. Native withdrawal and
NPC sale receipts establish completion and locked copies remain in storage.

Run `npm test -- -- --project=console --project=live --grep "bank tiles show every|bank automatic NPC collection|bank NPC"`,
then `npm run test:e2e:verify`. Inspect `.build/e2e-report/` and
`.build/e2e-results/` including queue evidence, native receipts and screenshots.
