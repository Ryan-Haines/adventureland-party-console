# Test failure audit — September 19, 2026

The initial stalled suite exposed 11 failures, not a complete count. A diagnostic run using `--test-isolation=none --test-force-exit` completed 2,289 tests: 2,259 passed and 30 failed. Each of those failing files was then rerun in its own process, reproducing the failures. This was an investigation, not a blanket update of tests to match current output.

## Confirmed runtime defect found separately

During the investigation, changes appeared in `runtime/coordinator/navigation/rare-hunting.ts`. In `priorityAllowed`, a local `const priority` shadows the outer `priority()` function throughout the block. Calls before its initialization throw `Cannot access 'priority' before initialization`; calls after initialization would try to call a number. Five Phoenix regression tests reproduced the error, and the repository typecheck reports TS2448/TS7022. This can interrupt passive rare-target selection. It was not one of the original 30 failures and was not edited by this cleanup. No live deployment was performed.

## Original completed-run failures

1. **Auto Stand follows item identity through bank and inventory transfers without requiring a listing** — [auto-stand-banner.test.cjs](../scripts/tests/auto-stand-banner.test.cjs). Stale case-sensitive label assertion: expected Auto/Stand, rendered Auto/stand. Identity matching and the price remain present.

2. **account guards prevent paid creation and occupied deletion before loading transport; confirmed deletion persists** — [coordinator-account-character-actions.test.cjs](../scripts/tests/coordinator-account-character-actions.test.cjs). Fixture omits bankboiPrefix. The route correctly rejects missing configuration with 400 before checking the eight-free-slot limit (409). The production paid-slot and occupied-inventory guards remain present.

3. **all own and party merchant commands preserve the pre-extraction wire contracts** — [coordinator-dispatch.test.cjs](../scripts/tests/coordinator-dispatch.test.cjs). The first mismatching assertion is log wording: manual upgrades replaced its own upgrades and compounds. The corresponding command comparison passes before the log comparison fails. Later loop cases require refreshed expectations before they can be fully checked.

4. **anniversary defaults preserve explicit saved fields and empty blacklist** — [coordinator-event-market-initial.test.cjs](../scripts/tests/coordinator-event-market-initial.test.cjs). Obsolete anniversary blacklist reference/default assertions. The feature was intentionally removed; updated in this cleanup.

5. **source coordinator handles first and repeated heartbeats without a current combat target** — [coordinator-heartbeat.test.cjs](../scripts/tests/coordinator-heartbeat.test.cjs). Original mismatch was only the obsolete anniversary blacklist default. Removed the field from fixtures and verified the removed route/field. Both passed in the per-file audit; a subsequent source-only rerun acquired unrelated passiveHunting response differences from concurrent workspace changes.

6. **bundle coordinator handles first and repeated heartbeats without a current combat target** — [coordinator-heartbeat.test.cjs](../scripts/tests/coordinator-heartbeat.test.cjs). Original mismatch was only the obsolete anniversary blacklist default. Removed the field from fixtures and verified the removed route/field. Both passed in the per-file audit; a subsequent source-only rerun acquired unrelated passiveHunting response differences from concurrent workspace changes.

7. **merchant completion: successful receipts and stat-scroll equipment merge** — [coordinator-merchant-completion.test.cjs](../scripts/tests/coordinator-merchant-completion.test.cjs). Frozen fixture expects autoCompounds.F to lose its ring rule. Current completion intentionally preserves persistent automatic rules; production receipts handle finite quotas. Removing the rule to satisfy this snapshot would restore obsolete behavior.

8. **delivery composition preserves all recorded completion receipts, retries and side-effect order** — [coordinator-merchant-delivery-actions.test.cjs](../scripts/tests/coordinator-merchant-delivery-actions.test.cjs). Same persistent ring auto-compound rule mismatch as the completion test; these tests share the same frozen receipt fixture.

9. **all dashboard state sections preserve their pre-extraction response contracts** — [coordinator-public-state.test.cjs](../scripts/tests/coordinator-public-state.test.cjs). Frozen response snapshot omits merchantRules, which is an intentional shared-automation setting. The actual response includes it.

10. **collection eligibility is enforced before enqueue while explicit visits remain available** — [coordinator-queue-composition.test.cjs](../scripts/tests/coordinator-queue-composition.test.cjs). Fixture injects collectionReady:()=>eligible for every reason, then sets eligible=false and expects an explicit visit to enqueue. The real coordinatorCollectionReady returns true for non-collection reasons. The fake does not implement that distinction.

11. **typed state factory preserves the complete legacy initialization and clock evaluation order** — [coordinator-state-factory.test.cjs](../scripts/tests/coordinator-state-factory.test.cjs). Frozen initialization snapshot omits merchantRules:null and production:{attempts:{}}. Both are intentional additions documented in the coordinator README.

12. **Settings import previews a file before confirmation and shows its canonical path and backup** — [dashboard-state-import.test.cjs](../scripts/tests/dashboard-state-import.test.cjs). VM test removes imports but does not supply StateExportButton. The actual component imports it correctly.

13. **executor visits Craftsman, claims, dismantles, acknowledges, then finishes** — [deconstruction.test.cjs](../scripts/tests/deconstruction.test.cjs). Extracted-function VM fixture omits verifyMerchantItemMarks. That helper exists in the complete generated character runtime.

14. **browser timezone formats the event instant without changing its countdown** — [event-selections.test.cjs](../scripts/tests/event-selections.test.cjs). By case: unknown-time label changed from Next time unknown to Time not announced; extracted JSX fixture omits the imported Settings icon; blacklist mutation assertions exercise an intentionally removed endpoint (obsolete test removed).

15. **dropdown disables inherited and unsupported selections and permits independent choices** — [event-selections.test.cjs](../scripts/tests/event-selections.test.cjs). By case: unknown-time label changed from Next time unknown to Time not announced; extracted JSX fixture omits the imported Settings icon; blacklist mutation assertions exercise an intentionally removed endpoint (obsolete test removed).

16. **blacklist mutations persist case-insensitive additions and intentional empty lists** — [event-selections.test.cjs](../scripts/tests/event-selections.test.cjs). By case: unknown-time label changed from Next time unknown to Time not announced; extracted JSX fixture omits the imported Settings icon; blacklist mutation assertions exercise an intentionally removed endpoint (obsolete test removed).

17. **blacklisted featured player aborts immediately, returns to farm, and logs once** — [farming-navigation.test.cjs](../scripts/tests/farming-navigation.test.cjs). Both failures enforce the removed anniversary blacklist policy. Removed obsolete blacklist tests and the no-op callback; preserved actual kiss-failure recovery tests.

18. **blacklist covers an unstaged round but leaves other players and future windows alone** — [farming-navigation.test.cjs](../scripts/tests/farming-navigation.test.cjs). Both failures enforce the removed anniversary blacklist policy. Removed obsolete blacklist tests and the no-op callback; preserved actual kiss-failure recovery tests.

19. **placeholder remains pending even when queue proxy disappears before the result** — [item-operations.test.cjs](../scripts/tests/item-operations.test.cjs). Extracted upgradeConfirmed fixture omits trackedProduction. The full character runtime defines that helper.

20. **token catalog includes every currency, bundles, and cosmetic reward identifiers** — [merchant-exchange.test.cjs](../scripts/tests/merchant-exchange.test.cjs). Catalog source fragment now requires root; exchange source fragments now require verifyMerchantItemMarks. Their VM fixtures omit those dependencies. The complete runtime has them.

21. **40 level-less leather is withdrawn and delivered for one exchange** — [merchant-exchange.test.cjs](../scripts/tests/merchant-exchange.test.cjs). Catalog source fragment now requires root; exchange source fragments now require verifyMerchantItemMarks. Their VM fixtures omit those dependencies. The complete runtime has them.

22. **confirmed exchanges checkpoint remaining work before returning to bank** — [merchant-exchange.test.cjs](../scripts/tests/merchant-exchange.test.cjs). Catalog source fragment now requires root; exchange source fragments now require verifyMerchantItemMarks. Their VM fixtures omit those dependencies. The complete runtime has them.

23. **auto-bank errands cannot redeposit materials reserved for this exchange** — [merchant-exchange.test.cjs](../scripts/tests/merchant-exchange.test.cjs). Catalog source fragment now requires root; exchange source fragments now require verifyMerchantItemMarks. Their VM fixtures omit those dependencies. The complete runtime has them.

24. **partial sales retain confirmed IDs and report interruption at top level** — [merchant-npc-sales.test.cjs](../scripts/tests/merchant-npc-sales.test.cjs). Extracted sales functions call verifyMerchantItemMarks, which the fixtures do not provide. The interruption assertion is seeing that ReferenceError instead of its intended simulated interruption.

25. **sale rechecks lock and quantity after travel** — [merchant-npc-sales.test.cjs](../scripts/tests/merchant-npc-sales.test.cjs). Extracted sales functions call verifyMerchantItemMarks, which the fixtures do not provide. The interruption assertion is seeing that ReferenceError instead of its intended simulated interruption.

26. **stand sync passes active ownership, performs listing, and reconciles before completion** — [merchant-stand-sync.test.cjs](../scripts/tests/merchant-stand-sync.test.cjs). Extracted stand-sync fixtures omit recoverProductionJournal. The executor catches that ReferenceError and reports deferred, causing the three downstream assertions to fail. The full runtime defines the helper.

27. **stand-return commands bypass pre-dispatch recovery; other commands still require it** — [merchant-stand-sync.test.cjs](../scripts/tests/merchant-stand-sync.test.cjs). Extracted stand-sync fixtures omit recoverProductionJournal. The executor catches that ReferenceError and reports deferred, causing the three downstream assertions to fail. The full runtime defines the helper.

28. **optional tidy failure reports recovery without claiming the stand return failed** — [merchant-stand-sync.test.cjs](../scripts/tests/merchant-stand-sync.test.cjs). Extracted stand-sync fixtures omit recoverProductionJournal. The executor catches that ReferenceError and reports deferred, causing the three downstream assertions to fail. The full runtime defines the helper.

29. **Steam monitor joins, promotes, ignores primary, cancels, rejects changed confirmations, handles failure and duplicate submission** — [party-console-polish.test.cjs](../scripts/tests/party-console-polish.test.cjs). The test selects the monitor as button index 1; current index 1 is the headless control and the monitor is index 0. It then assumes a confirmation dialog was opened and dereferences a missing button.

30. **marked collection uses Party collection priority and full-inventory work raises the queued job** — [wtb-priority.test.cjs](../scripts/tests/wtb-priority.test.cjs). Fixture requests marked collection with no fresh target status and no matching marked items. The actual collection readiness policy correctly refuses the job, so the test dereferences a nonexistent queued job.

## Why the suite appeared to hang

- `dashboard-query.test.cjs` completes all eight assertions, but retains a referenced 300,000 ms TanStack Query garbage-collection timer. An async-hooks trace identifies `Query.fetch → Query.scheduleGc → timeoutManager.setTimeout`. The process is waiting for cleanup, not a failed gameplay action. The test cleanup needs to account for this timer; the eight passing assertions alone do not guarantee prompt process exit.
- `runner-engine.test.cjs` exceeded a 20-second per-file diagnostic deadline under concurrent load. A separate traced run completed and exited successfully in about 18 seconds. This is not evidence of broken runner disposal.
- `dashboard-stream-proxy.test.cjs` passed and exited independently. It was not the source of the stalled output.

## Anniversary cleanup and verification

Removed the anniversary blacklist route, no-op abort callback, snapshot callback wiring, state/interface field, response field, import/UI references, and obsolete policy tests. Kept only restore-time deletion of obsolete saved data and obsolete blacklist-abort records, plus the migration regression test. Merchant and Hunt blacklist features are separate and retained.

All anniversary-related files, source/bundle heartbeats, farming navigation, and Hunt safety passed in the per-file run after the cleanup. A subsequent focused run passed 112 of 113 tests: the source heartbeat gained `passiveHunting` and changed `passiveRareHunts` through concurrent workspace changes; its frozen expected response now differs independently of this cleanup. The latest typecheck is blocked by the separate rare-hunting shadowing defect described above. The runtime build succeeded before that defect appeared. No live services were restarted.

Raw diagnostics are under `.build/failure-details/`, with `summary.json` containing the 363-file bounded audit. The original complete-run TAP is `.build/test-failure-investigation.tap`. Resource traces are `.build/query-resources.log` and `.build/runner-resources.log`. The working tree changed during investigation, so these results describe their captured revisions rather than a single immutable commit.
