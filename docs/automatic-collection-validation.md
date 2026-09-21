# Automatic item collection validation

Validated on Windows, September 20, 2026.

- 153 focused tests pass: pickup selection, queue migration and priority, handoff
  receipts, reserved quantities, bank-backed processing, production receipts,
  manual-job separation and dashboard labels.
- Typechecking, changed-file lint, character syntax and supported startup builds
  pass. The character merge retains concurrently added bank-sort behavior.
- Restarted through `scripts/start-console.ps1 -ProductionDashboard`. Merchant
  work was paused before a handoff, during travel with no banking, upgrading or
  BankBoi transaction active, and resumed after activation.
- The local dashboard returns HTTP 200 and all four characters report fresh
  status. The live queue contains one P85 `marked items` job for each fighter;
  automatic processing jobs target GoldMajesty. The updated merchant executor
  successfully completed NPC sales and reported `retrieving` for bank-backed
  compounding. A complete post-update fighter pickup was not observed during
  this validation window.

The full suite is not green. Its final broad run recorded 69 failures;
activity-helper fixture failures were then fixed and verified in focused runs.
Other failures include legacy command/state snapshots, combat fixtures, delivery
expectations and an existing item-operation placeholder test. Logs are local:
`.build/collection-final-focused.log`, `.build/collection-final-full-tests.log`,
and `.build/collection-executor-tests.log`. These results do not establish a
fully passing repository suite or a measured reduction in total backlog.
