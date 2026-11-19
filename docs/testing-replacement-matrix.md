# Testing replacement matrix

This supersedes the initial per-file audits' blanket “E2E gap: retain” decisions.
The migration is organized by observable failure, not by the number of existing
test files. A mocked callback receiving the expected arguments is not evidence
that a character reached a destination, killed a monster, received an item, or
persisted its work. Nor does calling a test “E2E” make it one.

The first pass below removes redundant adapter, implementation, and presentation
assertions independently of new game coverage. The next pass replaces simulated
gameplay only when the equivalent real-server journey has passed. The gate table describes broader desired coverage; the executed-status table below
states what targeted runs have actually proved. Keep the run manifest with each
verified result.

**Validation boundary:** the 26-scenario run, 3,186-test retained-suite run and
Franky follow-up below are historical evidence from before the current Hunt
expansion. They do not certify the latest source or reusable loadout changes.
The current inventory is **63 scenarios (three console, 60 native)**: the
60-scenario expansion plus two partial-Town recovery variants and one genuine
lost-preparation/cold-defense journey. An earlier full diagnostic was **51 passed,
nine failed**. Its HTML
reporter exhausted memory before producing the original manifest. The preserved
`.build/hunt-full60-diagnostic-e2e-{report,results}/` archive has a post-run
`archive-index.json` covering 1,622 files; it is not a passing run manifest.

The new reporter's three-console smoke passed with 91 verified files under
`.build/file-report-smoke-e2e-{report,results}/`. The old-code Town/cold-defense
run recorded one pass and three failures with 175 intact evidence files under
`.build/town-cold-red-e2e-{report,results}/`. Its Town restart case failed before
fault injection on incidental combat, so that case supplies no recovery red
proof. See [testing guidance](testing.md) for boundaries and commands. These
historical results are distinct from the current checkpoints below.

The subsequent `.build/town-incident-red-e2e-{report,results}/` archive contains
one failed scenario and 93 intact evidence files. Actual kills, partial Town,
an outward detour exceeding 30 seconds, and both quest rewards completed, but a
walking-only request returned Town. History also recorded a false no-progress
recovery (`1790615528538`, `recoveryAttempts: 1`). The strengthened native test
rejects both defects; [sanitized evidence](testing-town-return-red.json) records
the red result. Later focused runs exposed Tiny P's carrier-selection bug: both
an initial fixture precondition and the production selector assumed raw items,
while native inventory observations use `{slot,item}` entries. The fixture and
production contract are corrected; existing isolated generator fixtures now
match the real heartbeat. [Native deployment red evidence](testing-tinyp-deployment-red.json)
shows the unused generator, avoided attacks and teleportation. Actual deployment,
consumption, damage, death and loot assertions remain unchanged.

Current validation is split across preserved runs, not one clean 63-case execution:

| Run archive (under `.build/`) | Outcome | Evidence |
| --- | --- | --- |
| `rare-final-e2e-{report,results}` | Seven passed | 267 files verified |
| `town-final-e2e-{report,results}` | Two passed | 133 files verified |
| `remaining54-diagnostic-e2e-{report,results}` | 52 passed, two failed | 1,475 files intact; failed manifest preserved |
| `reconnect-final-e2e-{report,results}` | One passed | 100 files verified |
| `recovery11-diagnostic-e2e-{report,results}` | Ten passed, one failed | 380 files intact; failed manifest preserved |
| `return-clock-final-e2e-{report,results}` | Three passed | 163 files verified; both Town variants and follower reconnect |

The remaining batch exposed a death-fixture fault (a lethal Goo killed both
stacked fighters, correctly reaching the two-death threshold) and a production
follower reconnect bug: route preparation published its version only after
awaiting rendezvous, causing a separated follower to reject fresh movement
leases. The corrected reconnect journey passed. All six single-character native
death consumers and both completion-loss variants passed in the recovery run.
Its Town case without restart also passed, including 42.807 seconds of outward
walking with zero recovery attempts. The Town restart case exposed an additional
retry: the old preparation clock included time spent in the long rendezvous.
The corrected preparation-clock run passed both Town variants and follower
reconnect. Aggregate verification checked every evidence hash across the six
archives, including preserved failed manifests, and found **63 unique scenarios
with passing latest outcomes**. These runs cover separate source snapshots;
they are not one clean 63-case execution at the final snapshot. Integrity of a
failed historical run does not turn that run into a passing E2E result.

The latest completed retained run passed **3,166 tests**, with strict TAP
verification and coordinator lint passing. Current production build and
typechecking pass. The final retained-suite repeat also passed all 3,166 cases.
After native verification, the timer calculation was extracted unchanged into
a helper to satisfy the complexity limit; the final build and all 149 focused
navigation regressions passed after that refactor.

Current removals relative to PR #21 are **36 complete unit-test files and 176
source declarations**, plus trimmed loop-generated variants; 2,696 source
declarations remain. Earlier counts
below are historical checkpoints. Per-case decisions remain in the Hunt audit
documents; native happy paths do not replace unexercised race variants.

Native fixtures use reusable `god` equipment by default and `fragile` for
mortality-sensitive cases. Both preserve native combat and record initial gear
and calculated stats. Rare journeys retain damage/death/chest/Hunt assertions;
Tiny P additionally requires actual field-generator deployment and consumption.
Cute Bee uses per-instance avoidance zero instead of its normal 99.9%; this is
an explicit initial difficulty condition, not coverage of avoidance probabilities.
The strengthened Franky journey passed visible-boss damage, deselection, both
native exit owners and Mainland arrival while the boss remained alive.

## Real gameplay journeys and replacement gates

Every gameplay journey must run a disposable account against the pinned upstream
game server and real game client/runtime. Setup can seed MongoDB, configure an
encounter, or disconnect a socket. Assertions must read server/client outcomes;
the harness must never implement success by assigning character coordinates,
decrementing monster HP, moving inventory entries, or acknowledging its own
coordinator command. A browser-only state toggle does not satisfy these gates.

| Journey | Required behavior and repeatable evidence | Simulated coverage eligible for replacement after passing |
| --- | --- | --- |
| G01 Party startup | Login two fighters and a merchant, load maintained CODE, receive real socket telemetry, show them online in the dashboard. Record server revision, account seed, runtime generations and socket log. | Happy startup/argument forwarding in `coordinator-character-startup`, `coordinator-worker-setup`, `party-loader`, `caracal-game-files`; preserve obsolete-worker rejection. |
| G02 Same-map convoy | Request movement from dashboard, observe all participants traverse geometry and arrive. Assert final server positions and clearance of the convoy only after the last arrival. | Successful-route cases in `convoy`, `convoy-coordinator`, `shared-convoy`, `movement-service`, `farming-navigation-client`. |
| G03 Cross-map convoy | Travel through an actual door/transporter, retain party cohesion and arrive on the destination map. Record map transitions, route identity and final positions. | Cross-map happy paths in `convoy`, `shared-convoy`, `daisy-door-routes`, `farming-navigation`. |
| G04 Superseded navigation | Issue a second destination while the first is active. Verify all clients reach the new destination and stale completions cannot restore the old one. | Matching newer-command cases in `coordinator-convoy-routes`, `coordinator-navigation-actions`, `coordinator-manual-navigation`, `monster-focus-route`, `monster-popup`; retain independently delayed response variants until reproduced. |
| G05 Hunt first quest | Select Hunt using UI, reach Daisy, obtain an actual quest and travel to its spawn. Record quest state, coordinator mission and route trace. | Start/backup happy paths in `monster-hunt-start`, `coordinator-hunt-actions`, `coordinator-hunt-controls`, `coordinator-hunt-composition`, `hunt-route-acquisition`. |
| G06 Hunt completion and next cycle | Seed a repeatable short quest, kill the required targets through real combat, return to Daisy, turn in, receive rewards and start the next quest. Record authoritative kills, quest counter, turn-in reward and new mission. | Happy paths in `hunt-area-arrival`, `continuous-hunt-return`, `hunt-return-town`, `hunt-farm-walk`, `coordinator-hunt-control`; Town-disabled and delayed follower variants need corresponding executions. |
| G07 Hunt stop and reset | Stop Hunt during travel and combat; reset via UI; confirm clients relinquish old work and a new cycle starts once. | Toggle/reset cases in `hunt-mode-reset`, `hunt-settings`, `ui-cleanup-behavior`, `coordinator-hunt-controls`; preserve invalid-payload tests until browser invalid drafts are exercised. |
| G08 Hunt restart | Restart the actual coordinator mid-Hunt using its journal; reconnect clients; finish the quest without a duplicate reward or stale route. | Successful restart cases in `hunt-retreat-restart`, `hunt-return-recovery`, `convoy-restart-recovery`, `coordinator-initial-commands`; retain damaged-journal and late-response races. |
| G09 Sequential combat | Kill at least two actual monsters, verify server HP/death records and target changes; pick up real drops and reconcile dashboard inventory. | Happy targeting/kill handoff in `combat-handoff`, `combat-movement`, `combat-claims`, `smart-loot`, `fight-death-packets`; keep defense and entity-identity races until explicitly injected. |
| G10 Death and respawn | Die to server damage, release combat and movement ownership, respawn through the actual handler and resume the selected activity once. | Ordinary successful recovery in `respawn-recovery`, `farm-reunion`, `combat-disengagement`; lost acknowledgement, timeout and delayed respawn tests remain distinct. |
| G11 Event interruption and Hunt resumption | During Hunt, announce/join an actual Goobrawl event, fight, end it, leave through the real transporter and resume the captured Hunt destination. | Successful interruption/return in `hunt-event-resume`, `hunt-event-handoff`, `hunt-event-priority`, `event-return`, `goobrawl-live-combat`, `goobrawl-targeting`, `coordinator-event-observation`; no assertion based only on synthetic joinedEvent flags. |
| G12 Event evacuation versus cancellation | Replace navigation while returning from an event. Verify a late event acknowledgement cannot steal the new route or force Town. | Matching ownership cases in `coordinator-event-routes`, `coordinator-event-observation-composition`, `coordinator-anniversary-return-composition`, `hunt-return-regression`. |
| G13 Anniversary continuation | Visit the actual anniversary NPC, observe server reward/inventory change, interrupt with combat, then restore the prior task. | Anniversary success cases in `anniversary-kiss`, `coordinator-anniversary-actions`, `coordinator-anniversary-control`; this remains a separate gate from Goobrawl. |
| G14 Rare encounter handback | Introduce a real rare monster on the route, fight it, confirm death, release rare ownership and resume Hunt. | Happy rare handback in `rare-hunting-client`, `rare-hunting`, `hunt-temporary-encounter`, `rare-farming-return`; unseen/dead-target races require separate evidence. |
| G15 Merchant collection and delivery | Mark a real item in the browser, dispatch merchant, transfer it over the socket and verify exactly one copy changes owner, with completed durable job and refreshed UI. | Successful transfer in `automatic-collection-client`, `manual-party-collection`, `coordinator-dispatch-composition`, `merchant-rendezvous`, `merchant-idle-return`. |
| G16 NPC buy and sell | Buy an actual item and sell an eligible copy through merchant commands. Verify authoritative inventory/gold deltas and completed job, then reload/restart. | Happy transactions in `merchant-buy-cycle`, `merchant-npc-sales`, `player-npc-sales`, `coordinator-purchases`, `coordinator-sale-routes`; retained lock/quantity/ownership checks are not replaced by a single successful sale. |
| G17 Upgrade and preview | Open preview without issuing upgrade, execute a requested real upgrade, record server outcome and exact consumption of scroll/item/gold; confirm job completion survives restart. | Successful UI/command path in `upgrade-offerings-ui`, `upgrade-offerings-client`, `coordinator-upgrade-commands`, `upgrade-preview`; preserve chance/compound math, ambiguous-operation recovery and reservation failures. |
| G18 Bank round trip | Deposit and withdraw an identifiable stack through the actual bank; verify conservation across carried inventory and MongoDB bank, durable completion and refreshed browser contents. | Happy paths in `bank-improvements`, `bank-stack-routing`, `coordinator-bank-actions`, `bank-withdrawal-dialog`; partial transfers, overlapping reservations and stale slots remain distinct failures. |
| G19 Cancelled merchant work | Cancel while travelling; issue a different command; verify neither late arrival nor retry consumes/transfers the old item. | Matching ownership variants in `merchant-cancel-job-ui`, `merchant-convoy-interruption`, `coordinator-merchant-recovery`, `equipment-command-delivery`. |
| G20 Settings durability | Submit invalid setting, preserve draft/error, retry valid value, reload browser and restart coordinator, and verify persisted value. | Existing browser journey already provides this boundary for the bankboi prefix; do not generalize it to every commerce dialog. |
| G21 Inventory menus | Use native right-click/submenus, inspect computed colors and hover states, open preview and verify no economic side effect. | Existing browser journey replaces CSS-token assertions and the synthetic preview-open smoke path; it does not cover a completed upgrade. |
| G22 Connection loss | Disconnect an actual client during travel and reconnect. Verify safe hold/recovery, current-generation ownership and eventual arrival without a second game action. | Matching recovery cases in `convoy-communication`, `barrier-communication`, `loader-connection`, `worker-lifecycle`; explicit late/reordered packets still require separate tests. |

File names in the table are under `scripts/tests/` and end in `.test.cjs`.
Mixed suites must be trimmed by failure mode; a passing happy path is not grounds
to delete a lost acknowledgement or concurrent reservation regression.

## Evidence required for each verified row

- Playwright outcome, trace and user-visible screenshot, where a UI is involved.
- Pinned upstream revisions and dependency locks, deterministic seed, process
  versions, test command and scenario identifier.
- Before/after authoritative game snapshots, server events, client logs and
  coordinator commands/journal sufficient to check the asserted transition.
- Item and gold conservation for economic journeys; exact quest/kill/reward
  changes for Hunt; final server map/coordinates for travel.
- Hash manifest and verification command. Skipped, failed, or environment-blocked
  gameplay is not recorded as passing coverage.

## Isolated regressions with a distinct reason to remain

These are explicit failure families, not permission to keep every test:

| Family | Existing examples | Why a happy full-game journey misses it |
| --- | --- | --- |
| Irreversible/economic ambiguity | `production-journal`, `production-reconciliation`, `merchant-upgrade-recovery`, `bankboi-transfer-confirmation`, `craft-bank-confirmation`, `coordinator-reservations`, `coordinator-reserved-cargo`, `item-action-safety` | A server action succeeds but its response is lost; retry must not destroy a second item, sell changed stock or consume another job's reservation. |
| Destructive persistence failures | `coordinator-jsonl-store`, `coordinator-json-store`, `dashboard-state-import`, `build-retention`, `console-updates` | Corruption, interrupted replacement, lock contention, failed backup and rollback require deliberate filesystem faults. |
| Ownership/reordering races | `coordinator-command-ownership`, `coordinator-restart-ownership`, `successor-handoff`, `coordinator-event-routes`, `respawn-recovery`, `hunt-return-regression` | Old acknowledgements, delayed callbacks, replaced processes and out-of-order packets must not reclaim current work. Delete the exact variant when a fault-injected game journey proves it. |
| Numeric/probability boundaries | `compound-cost`, `drop-rate`, `deconstruction-rewards`, `upgrade-offerings`, `tracktrix-bonuses`, `planner-geometry` | One probabilistic gameplay result cannot verify probability math, fractional rounding, full geometry boundaries or conservation over all branches. |
| Different deployment surface | `hosting-https`, `dashboard-node-server`, `steam-desktop`, `steam-recovery` | Local game E2E does not exercise TLS/LAN production hosting or the actual Steam renderer/process. These should become dedicated system journeys, not be silently claimed by headless coverage. |

The initial audits remain historical records. Their individual “retain because
not in the first three browser tests” entries are not an acceptance criterion for
future tests. New isolation requires failure modes written before code, as stated
in `AGENTS.md`.

## Initial removal history

The following section is an inventory of actual changes, independent of planned
game coverage. Counts are source declarations, not inflated loop-expanded test
counts. Helpers are removed only after checking other test/tool imports.

The initial pass removed 20 complete suites and 64 source test declarations and trimmed 12 additional suites. The subsequent removals below brought the **pre-expansion totals** to 36 complete files and 160 declarations. These are historical counts; the current Hunt audit adds further replacements counted in the current totals above.

| File | Removed | Reason |
| --- | --- | --- |
| `coordinator-anniversary-snapshot-composition.test.cjs` | 1 declaration(s) — entire file | Adapter-only current-state reads; anniversary snapshot domain suite remains. |
| `coordinator-character-composition.test.cjs` | 2 declaration(s) — entire file | Digest implementation snapshot and receiver/argument plumbing; worker lifecycle and game-generation suites remain. |
| `coordinator-convoy-composition.test.cjs` | 1 declaration(s) — entire file | Resolver argument identity and command-counter wiring; convoy coordinator and shared-convoy behavior remain. |
| `coordinator-idle-composition.test.cjs` | 2 declaration(s) — entire file | Mocked eligibility and exact command payload wiring; merchant idle/queue behavior remains. |
| `coordinator-queue-composition.test.cjs` | 3 declaration(s) — entire file | Queue adapter replays fake ports; merchant-queue domain already covers deduplication, balance changes and priorities. |
| `coordinator-realm-composition.test.cjs` | 2 declaration(s) — entire file | Exact callback order and counter snapshots; realm-switch and realm-route behavior remain. |
| `coordinator-return-composition.test.cjs` | 2 declaration(s) — entire file | Exact ID and mocked dispatch argument snapshots; event-return and Franky exit behavior remain. |
| `coordinator-merchant-services.test.cjs` | 2 declaration(s) — entire file | Composition of the same idle/dispatch services with fake ports; retained dispatch and queue suites cover ownership. |
| `coordinator-environment.test.cjs` | 3 declaration(s) — entire file | Initialization callback order, property identity and ordinary exception propagation; actual application startup exercises construction. |
| `coordinator-web-services.test.cjs` | 6 declaration(s) — entire file | Fake router registration and setup ordering; real HTTP gateway, node-server and application-launcher coverage remain. |
| `coordinator-http-middleware.test.cjs` | 2 declaration(s) — entire file | Header setter callback ordering; gateway/browser integration executes the real middleware. |
| `coordinator-initial-core.test.cjs` | 2 declaration(s) — entire file | Saved-object identity and default-value snapshots; JSONL restart and migration coverage remain. |
| `coordinator-initial-farming.test.cjs` | 1 declaration(s) — entire file | Saved-object identity and transient default snapshots; Hunt restart/recovery suites remain. |
| `coordinator-initial-merchant-runtime.test.cjs` | 2 declaration(s) — entire file | Default-value and object identity snapshots; restart queue/ownership and no-merchant suites remain. |
| `coordinator-activity-service.test.cjs` | 2 declaration(s) — entire file | Mock persistence call counts and array identity; retained history/telemetry domain behavior remains. |
| `coordinator-party-configuration.test.cjs` | 2 declaration(s) — entire file | Mock navigation forwarding, authorization order and exact counter wiring; party/focus action and ownership suites remain. |
| `duration-format.test.cjs` | 1 declaration(s) — entire file | Formatting examples without a workflow failure; browser item presentation is the appropriate boundary. |
| `item-action-banner.test.cjs` | 3 declaration(s) — entire file | Label/style token precedence mirrors the renderer; actual inventory menu journey exercises visible controls. |
| `dashboard-card-optimizations.test.cjs` | 1 declaration(s) — entire file | Exact React render counts couple tests to optimization details; real browser journeys exercise freshness and interaction. |
| `coordinator-farm-composition.test.cjs` | 1 declaration(s) | Remove adapter/default/property-forwarding assertions; keep the distinct negative and ownership regressions in this file. |
| `coordinator-dispatch-composition.test.cjs` | 2 declaration(s) | Remove adapter/default/property-forwarding assertions; keep the distinct negative and ownership regressions in this file. |
| `coordinator-heartbeat-composition.test.cjs` | 1 declaration(s) | Remove adapter/default/property-forwarding assertions; keep the distinct negative and ownership regressions in this file. |
| `coordinator-bankboi-composition.test.cjs` | 1 declaration(s) | Remove adapter/default/property-forwarding assertions; keep the distinct negative and ownership regressions in this file. |
| `coordinator-anniversary-return-composition.test.cjs` | 1 declaration(s) | Remove adapter/default/property-forwarding assertions; keep the distinct negative and ownership regressions in this file. |
| `coordinator-status-composition.test.cjs` | 1 declaration(s) | Remove adapter/default/property-forwarding assertions; keep the distinct negative and ownership regressions in this file. |
| `coordinator-initialization.test.cjs` | 1 declaration(s) | Remove adapter/default/property-forwarding assertions; keep the distinct negative and ownership regressions in this file. |
| `coordinator-worker-setup.test.cjs` | 3 declaration(s) | Remove adapter/default/property-forwarding assertions; keep the distinct negative and ownership regressions in this file. |
| `coordinator-initial-bank.test.cjs` | 1 declaration(s) | Remove adapter/default/property-forwarding assertions; keep the distinct negative and ownership regressions in this file. |
| `coordinator-initial-collection.test.cjs` | 1 declaration(s) | Remove adapter/default/property-forwarding assertions; keep the distinct negative and ownership regressions in this file. |
| `coordinator-initial-focus.test.cjs` | 1 declaration(s) | Remove adapter/default/property-forwarding assertions; keep the distinct negative and ownership regressions in this file. |
| `coordinator-public-state.test.cjs` | 5 declaration(s) | Remove adapter/default/property-forwarding assertions; keep the distinct negative and ownership regressions in this file. |

Trimmed mixed suites remove only these named cases:

- `coordinator-farm-composition.test.cjs`: “farm navigation resolves the current catalog and records newly added workers on each tick”.
- `coordinator-dispatch-composition.test.cjs`: “dispatch composition reads current work and preserves command payload references”; “manual equipment ownership suppresses dispatch before storage scheduling; pending storage suppresses jobs”.
- `coordinator-heartbeat-composition.test.cjs`: “heartbeat follows replaced farming authority, navigation intent and storage snapshots”.
- `coordinator-bankboi-composition.test.cjs`: “BankBoi composition disables the merchant after clearing its slot and writes through transaction phases”.
- `coordinator-anniversary-return-composition.test.cjs`: “anniversary composition waits for current travel owners and dispatches/reconciles through shared navigation”.
- `coordinator-status-composition.test.cjs`: “status consumers strip discovery payloads and preserve bank, combat and scheduling order”.
- `coordinator-initialization.test.cjs`: “startup assembles persisted roster, bank and navigation state without writing or losing identity”.
- `coordinator-worker-setup.test.cjs`: “new workers inherit active, location, then configured realm”; “slot assignment persists first and starts only workers without an instance”; “script lookup failure preserves setup order and never starts a partial worker”.
- `coordinator-initial-bank.test.cjs`: “bank initialization retains saved storage work and refreshes only runtime data”.
- `coordinator-initial-collection.test.cjs`: “explicit selection maps take precedence over legacy marks without mutation”.
- `coordinator-initial-focus.test.cjs`: “per-character selection maps and valid farming modes remain unchanged”.
- `coordinator-public-state.test.cjs`: “dashboard receives the party death recovery explanation”; “dashboard core exposes observed characters before a heartbeat”; “dashboard exposes deconstruction marks, rules and eligibility catalog in config”; “dashboard core publishes the active game version and update health”; “dashboard core exposes durable bank sort mode and request status”.

Also removed 13 CSS-token assertions from `active-wtb-fields.test.cjs`, `dashboard-state-import.test.cjs`, `recipe-wtb-level.test.cjs`, `stand-inspection.test.cjs`, `upgrade-offerings-ui.test.cjs`. These assertions cannot establish computed color, opacity, layout, or interaction in a browser.

A second duplication pass removed 9 additional complete suites (14 declarations, about 118 lines):

| File | Reason |
| --- | --- |
| `coordinator-bankboi-observation-composition.test.cjs` | Duplicates both protected-withdrawal dispatch and existing-command rejection in coordinator-storage-observation; extra assertions are object identity and exact counter values. |
| `coordinator-event-market-initial.test.cjs` | Anniversary/ALData object identity, default fields and coercion snapshots; retained anniversary, market and persistence behavior tests cover actual use. |
| `coordinator-initial-bank.test.cjs` | Defaults and strict-boolean property initialization; retained bank storage/migration behavior exercises accepted persisted state. |
| `coordinator-initial-collection.test.cjs` | Repeats threshold clamping/validation already covered by collection-threshold and coordinator-settings. |
| `coordinator-initial-focus.test.cjs` | Legacy focus/default snapshots duplicate coordinator-migrate-focus and actual focus selection tests. |
| `coordinator-initial-gathering.test.cjs` | Single old-to-new preference mapping example; retained gathering settings, equipment ownership and configuration tests exercise the resulting settings. |
| `coordinator-initial-roster.test.cjs` | Slot/default/legacy membership snapshots duplicate coordinator-startup-slots, roster-routes and current ownership behavior. |
| `coordinator-initial-snapshots.test.cjs` | Per-document malformed JSON fallback is already exercised through initializeCoordinatorState; remaining case only snapshots JSON coercion and empty-object identity. |
| `coordinator-retained-combat-log.test.cjs` | Object-identity and response-payload snapshot around appending one log; retained telemetry/history suites exercise normalization, limits and ownership. |

A third pass removes wrapper and UI implementation assertions independently of the pending live-game gates. These removals are supported by retained regressions, not by an unverified E2E claim.

| File | Removed | Retained protection / reason |
| --- | --- | --- |
| `coordinator-inventory-actions.test.cjs` | Complete suite | Wrapper mocks duplicate inventory-receipts owner/generation rejection and consume-one-before-persistence regressions; NPC sale and merge domains retain actual validation. |
| `coordinator-anniversary-actions.test.cjs` | Complete suite | Callback and counter forwarding duplicates anniversary-commerce, anniversary supplies and retained return-ownership behavior. |
| `coordinator-character-actions.test.cjs` | 3 declarations | Current-counter/property/callback identity forwarding. Retains unavailable/inherited-owner rejection and solo-farm mutation regression; character-command and mark domains test effects. |
| `coordinator-bank-actions.test.cjs` | 2 declarations | Mocked call-order/counter snapshots duplicated by inventory-receipts persistence and bank-restock settings tests. Sparse slot anniversary consumption remains. |
| `coordinator-hunt-actions.test.cjs` | 1 declarations | Catalog/participant callback forwarding; hunt-controls and restart/ownership behavior remain. |
| `coordinator-navigation-actions.test.cjs` | 2 declarations | Adapter argument identity and exact mocked diagnostic call sequence; convoy route failure behavior and replayed Franky acknowledgements remain. |
| `coordinator-merchant-actions.test.cjs` | 1 declarations | Shared sequence/callback count repeats dispatch; force-stand pause/deferred restart remains. |
| `coordinator-realm-actions.test.cjs` | 1 declarations | Switch adapter call forwarding; home-realm acknowledgement race and realm-switch domain remain. |
| `coordinator-merchant-configuration.test.cjs` | 3 declarations | Replaced property forwarding and same filtering/threshold examples as coordinator-settings. Combined gathering control and integer bounds remain. |
| `dashboard-query-render.test.cjs` | 2 declarations | React callback identity and exact render counts assert implementation; retained panel roster/subscription transitions and shared map read/cleanup races check behavioral outcomes. |
| `dashboard-optimizations.test.cjs` | 2 declarations | Unicode string-length counter and unchanged reference checks; retained generation/removal cache regression and duration expiry/refresh boundaries. |
| `dashboard-minor-improvements.test.cjs` | 2 declarations | Card-slot count and appearance property forwarding; character-appearance and dashboard-doll retain actual appearance processing; mail and paid creation duplicate-submit failures remain. |
| `coordinator-public-state.test.cjs` | 3 declarations | Response field/reference catalogs and mocked performance call bypass; retained private-state filtering, metadata immutability, settings partition and Steam/headless ownership regression. |
| `coordinator-merchant-completion.test.cjs` | 14 generated snapshots | Remove 14 full-state/effect golden snapshots and their 37KB implementation fixture. Retained explicit completion retry, lucky-slot loss, deferred classification, Hunt ownership, bankboi-transfer-confirmation, merchant-delivery-recovery, rendezvous retry and convoy interruption tests assert concrete failure outcomes. |

Pre-expansion catalog/duplicate pass (10 runtime cases):

- `coordinator-merchant-delivery-actions.test.cjs`: Removes a second copy of all fourteen deleted golden snapshots, plus counter/queue forwarding. Retains delayed authentication credential race.
- `coordinator-merchant-initial-settings.test.cjs`: Default object factory identity/constant assertions; retains disabled/zero saved preferences and nonmutating migration.
- `coordinator-snapshots.test.cjs`: Expected keys generated from the same production field arrays and exact storage-key catalog; retains secret exclusion and nonmutating history bounds.
- `rare-hunting-settings.test.cjs`: Six copies of the same mock Object.assign boolean route; retains invalid mixed inputs without writes and rare-hunting domain behavior.

## Historical 26-scenario run: coverage and limits

The pre-expansion combined run completed **26 passing scenarios: 23 native-game and three console**, without retries, in 24 minutes. `npm run test:e2e:verify` verified all **655 evidence files** at the time of that run. Its manifest and report are now archived under `.build/pre-franky-e2e-report/`, with evidence under `.build/pre-franky-e2e-results/`. They include native video, socket events, authoritative game observations, journals, and the exact source snapshot used by that historical run.

After all scenarios passed, the redundant Playwright JSON reporter exceeded JavaScript's string-size limit while embedding the large evidence bodies; this made that command exit nonzero after the HTML report and manifest had completed. The JSON reporter was removed: `manifest.json` already supplies machine-readable outcomes and file hashes. The resulting reporter configuration passed the three console E2Es with exit zero and 65 verified evidence files, preserved under `.build/reporter-validation-report/` and `.build/reporter-validation-results/`. The original 26-scenario evidence was restored and verified again before archival. No native test or production behavior changed for that reporting fix.

The following gate statuses describe that archived run, not the current expanded suite.

| Gate | Executed outcome and remaining scope |
| --- | --- |
| G01 | Native login and maintained CODE for two fighters plus a merchant, real telemetry and catalog handshake passed. Other deployment surfaces remain separate. |
| G02 | Two-fighter same-map convoy and real observed arrival passed. The convoy journey submits the maintained command route; the separate console order journey covers browser submission and actual walking. |
| G03 | **Partial:** merchant bank-door travel and return passed. This does not establish cross-map whole-party cohesion. |
| G04 | **Partial:** a newer moving-fighter destination wins and survives restart. Explicit reordered acknowledgements and simultaneous whole-party supersession remain distinct. |
| G05 | **Partial:** dashboard Hunt selection reaches Daisy and obtains the first actual quest. That pickup scenario does not independently assert arrival at the newly assigned spawn. |
| G06 | **Partial:** both fighters' seeded two-Goo quest uses real kills, returns to Daisy and yields an actual warrior token. A subsequent quest cycle is not asserted. |
| G07 | **Partial:** Hunt-off/new-destination behavior and both native event cancellation timings passed: leader entry in progress and the full party inside the event. Evacuation preserves cancellation rather than reviving Hunt. Every UI reset or mid-combat cancellation timing is not asserted. |
| G08 | **Partial:** completed Hunt survives coordinator restart and claims its token once. Convoy restart and follower disconnect/relogin also pass. Mid-combat restart, damaged journals and lost reward responses are separate faults. |
| G09 | **Partial:** real Goo kills and native hit/death evidence pass within Hunt. Generic drop collection and inventory reconciliation are not established by a quest token. |
| G10 | **Partial:** authoritative death and maintained native respawn pass. Every prior activity's resumption is not asserted. |
| G11 | **Targeted passed after fixes:** both native Goobrawl interruption/evacuation variants, with and without coordinator restart, resumed actual Hunt progress or reward. They exposed and verified fixes to the arrival barrier and authorized event entry. The later Franky historical-recovery case is recorded separately below. |
| G12 | **Partial:** both Hunt-off event entry/evacuation variants passed, including the authorized leader entry while another member arrives. This does not establish arbitrary late/reordered acknowledgements or replacement of every manual route. |
| G13 | **Not in this archived run:** actual anniversary reward, deselection/resumption, restart and Hunt-off now pass in the expansion. Natural window expiry remains a separate gap. |
| G14 | **Not in this archived run:** six native rare damage/death/loot/same-Hunt journeys and disabled selection now pass in the separate seven-case run above. |
| G15 | **Targeted passed for native transfer/persistence:** the corrected fixture enables deliveries; one real item changes owner with conservation, cleared durable intent and no replay after restart. This does not establish every browser marking path or merchant interruption/death variant. |
| G16 | **Targeted passed:** duplicate queued NPC purchase executes once through native buying and survives restart; partial NPC sale preserves the unsold stack, credits real gold and survives restart. |
| G17 | **Partial:** real upgrade consumes its scroll, produces a matching native response/inventory result and survives restart. Console preview/menu tests are separate; compound probability and ambiguous completion faults remain. |
| G18 | **Targeted passed for game/persistence:** marked deposit and requested withdrawal conserve the stack, native bank exit persists it, and restart preserves the result. This does not independently prove every bank dialog rendering state. |
| G19 | **Partial:** cancelled queued purchase survives restart and a later real purchase completes. Cancellation while travelling and late-action ownership remain distinct. |
| G20 | Existing console E2E covers invalid/valid bankboi-prefix settings and reload/restart durability. It does not establish every commerce setting. |
| G21 | Existing console E2E covers native browser menus, computed colors and preview opening without issuing an economic action. |
| G22 | **Partial:** a real disconnected follower reconnects and reaches the convoy destination. Arbitrary delayed/reordered packets and every duplicated economic action are not implied. |

A separate native Town journey passed actual casting and both party members' return. It does not replace interrupted-cast or cooldown-boundary regressions.

## Pre-expansion gameplay replacements made after passing evidence

- First quest acquisition replaces the mocked Hunt-start callback/policy assertion and at-Daisy command-counter snapshot. Invalid setup, active-convoy reselection and backup validation remain.
- Catalog handshake replaces positive catalog examples and the extracted source-block status assertion. Stale, malformed, unavailable and duplicate definitions, interrupted preparation and retries remain.
- Native navigation/restart replaces ordinary convoy reconstruction and initial-command field/default snapshots. Changed revisions, member removal, newer commands, repeated restart budgets and owner-specific recovery remain.
- Native merchant door travel replaces the ordinary mocked cross-map transport case. Whole-party staggered transitions, locked doors and bounded collision-repair cases remain.
- Real Hunt kills/return/reward replace quest-selection composition and ordinary initial quest/Daisy assignment cases. Follower reward waiting, event protection, late acknowledgements, interrupted Town and blacklist recovery remain.
- Additional menu label permutations and banner/render-flag assertions were removed as redundant implementation checks. Retained item-action-safety tests execute eligibility and reject stale slots before game actions; retained menu tests check payloads, clear-mark behavior and lucky-slot interactions.

No economic or event fault regression was removed merely because its happy native workflow passed.

## Historical retained-suite run and current validation boundary

At the pre-expansion checkpoint, **36 complete tracked test files and 160 source test declarations had been removed** relative to the PR #21 base. Declaration counts differ from executed test counts because loops generate multiple cases. The obsolete merchant-completion golden fixture and scenario catalog were also removed. Further Hunt replacements are not included in those historical totals.

That historical source snapshot executed **3,186 runtime tests: 3,186 passed, zero failed, skipped or cancelled**, in 390,356 ms. Command: `node --test --test-concurrency=2 --test-reporter=tap scripts/tests/*.test.cjs`; complete TAP: `.build/unit-retained-final.tap`. The repository's strict TAP checker also passed. This is not a retained-test count or validation result for the current expansion. Both npm unit scripts use this two-worker limit. One existing scatter-marker fixture now controls its clock: VM compilation under concurrent load had consumed the real three-second freshness window before its assertions. Production freshness behavior was unchanged.

Production build and typechecking passed at that checkpoint. During the current expansion, the six previously reported coordinator complexity violations were refactored and lint passed; they are no longer outstanding. Current retained-suite and split E2E checkpoints are recorded above; the latest Town preparation-clock native rerun passed all three targeted scenarios. The earlier native journeys found and covered fixes for merchant idle overriding travel, repeated catalog retransmission, lost per-member event arrival acknowledgements, and Hunt-off overriding authorized event entry.

## Historical Franky recovery regression follow-up

Two additional native cases brought the then-existing inventory to 28 scenarios. The focused
run passed both cases in 1.8 minutes, with 96 evidence files verified by
`npm run test:e2e:verify`. This verified run is archived under
`.build/verified-franky-e2e-report/` and `.build/verified-franky-e2e-results/`;
the earlier 26-scenario report and results remain preserved under
`.build/pre-franky-e2e-report/` and `.build/pre-franky-e2e-results/`.
The working `.build/e2e-report/` and `.build/e2e-results/` directories belong to
subsequent runs and must not be cited as these archived results.

The recovery case restores sanitized historical settings captured from the
reported failure. With the old Main-only condition, the real character remained
in Desertland with `gscorpion: 0`, an empty pending list, a recorded Town
acknowledgement, and `paused-event`. That failing run is preserved under
`.build/franky-red-e2e-report/` and `.build/franky-red-e2e-results/`; all 95
archived evidence hashes were checked. With the fix, the same case resumes while
still in Desertland and claims one real monster token at Daisy while Franky
remains alive. The prior acknowledgement is a declared initial fixture, not a
Town action performed by this case.

The second case uses actual Franky entry and native convoy reports to cover the
additional bug found during investigation: inherited deselection admitted only
the first character into evacuation. It verifies both characters receive the
same exit ownership; that historical version did not assert full exit completion.
The current strengthened case now also requires visible-boss combat and actual
Mainland evacuation while Franky remains alive, and has passed.

At that follow-up checkpoint, both changed modules passed lint, and the
coordinator build/typecheck and 35 retained event safety checks passed. The full
28-case suite was not rerun for that follow-up. These validations did not activate
the changes in the running console. The current expanded suite requires its own
fresh results and final counts; archived successes are not substituted for them.
