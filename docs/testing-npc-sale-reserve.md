# Automatic NPC sale reserves (#116)

New merchant-wide rules persist an explicit `keep: 0`; legacy rules load with
zero. The confirmation dialog accepts a nonnegative safe integer. Bank actions
use the same merchant-wide dialog. The merchant's Auto NPC sales row edits the
saved reserve without requiring another inventory copy.

Reserve allowances count matching merchant, bank and BankBoi stock. Existing
craft/delivery protection remains in force. Whole bank stacks may be withdrawn,
but only surplus quantities receive sale marks; retained carried copies receive
ordinary bank marks. Changing a reserve retires unsent quantities and withdrawal
reservations before reconciliation. An in-flight sale must finish before editing
its reserve. Received party stacks also have their automatic sale quantities
bounded by the reserve. Manual sales remain explicit operations.

Adapted from Thefonze74065's contributor commits `9358a000` and `9ce32e5f`.
The 1.5 integration adds zero defaults, inline editing, bank-menu scope,
strict input validation and rebalancing of pre-existing automatic sale marks.

Repeat the browser and native regressions, verifying and archiving each report
before a subsequent run replaces the standard report folders:

```powershell
npm run test:e2e -- --project=console --workers=2 --grep 'legacy zero reserve'
npm run test:e2e:verify
npm run test:e2e -- --project=live --workers=2 e2e/live-npc-sale-keep.spec.ts e2e/live-bank-npc-sales.spec.ts
npm run test:e2e:verify
npm run test:e2e:selection
```

The native tests declare initial stock through the native database/server boundary,
then require actual withdrawals, NPC sales, exact quantities, gold receipts,
coordinator restart, an unchanged BankBoi inventory and eventual bank storage.
The browser test covers legacy zero, cancel, invalid input, reserve editing,
retirement of old queued sale intent, restart and the bank-menu confirmation.
