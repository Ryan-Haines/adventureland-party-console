# Coordinator migration

This directory is the tracked TypeScript home for coordinator code. The migration
is in progress: `CharacterCoordinator.js` is still the application host, not yet
the final small launcher. Do not treat the current extraction as a completed
rewrite.

## Implemented boundaries

- `inventory`: extensible item identities, manual and automatic collection marks,
  upgrade intent reconciliation, and exchange withdrawals from BankBoi.
- `merchant`: collection eligibility, queue selection and priorities, Merchant's
  Luck ownership and travel timing, queue deduplication and resource-block retry,
  in-place stand synchronization, automatic compound and exchange planning.
- `merchant/dispatcher`, `commands`, `idle`, and `recovery`: command construction,
  dispatch arbitration, marketplace batches, stand return, and interrupted work.
- `characters`: worker startup and exit recovery, IPC decoding and routing,
  local/session storage synchronization, CODE reload/watch lifecycle, and realm
  switching with the existing 60-second arrival deadline.
- `inventory/bankboi-service`: the merchant/BankBoi slot transaction, concurrent
  start suppression, failure rollback, and merchant restoration.
- `events/abtesting`: team discovery and the existing 20-second fallback.
- `events/returns`: combat-event return ownership, Franky exit convoys, town
  handoffs, deferred farming returns, and premature Goo Brawl return cancellation.
- `telemetry/maps`: map projections and the eight-entry insertion-order cache.
- `telemetry`: map streams, combat logs, bounded activity logs, and dashboard
  state projections, including compact and inventory-only responses.
- `status`: catalog and bank ingestion, merchant observations and scheduling,
  scatter coordination, command retention, heartbeat responses, and their ordered
  HTTP handler. Combat reports are reconciled before passive rare hunting.
- `hunt`: cycle lifecycle, quest selection and Daisy interactions, convoy setup,
  participant reconciliation, event ownership, death recovery, and farming travel.
- `anniversary`: live round synchronization, slice accounting and advertisements,
  missing reward handoffs, aborts, blacklist decisions, buff reconciliation, and
  one-minute featured-character holds.
- `navigation`: convoy construction and command ownership, farming-area activity,
  bounded route recovery, and relocation after current fights finish.
- `commerce`: ALData request limits, normalization, refresh and publication,
  level-aware price history, seller blacklist cooldowns, bid matching, and Ponty
  local/remote reconciliation.
- `http`: merchant settings, priorities, thresholds, and typed handler contracts.
- `persistence/json-store` and `lifecycle/resources`: tested infrastructure for
  the upcoming state and startup extraction; not yet used by the legacy host.
- `persistence/snapshots`: explicit v1 saved-field selection, marketplace field
  flattening, and per-character history limits. Domain initialization and decoding
  still live in the legacy host.
- `lifecycle/shutdown`: one signal/supervisor shutdown operation that waits for
  character workers before closing storage.

The legacy host composes these services through explicit ports. It still owns
state initialization, many HTTP handlers, and several completion workflows. Collection
reconciliation intentionally retains the existing relocation behavior for manual
marks; upgrade reconciliation keeps the original starting item throughout a pass.

## Dependency rules

Policies import contracts or other policies. They do not import the application,
HTTP routes, caracAL modules, configuration, or the dashboard. External I/O and
time enter through explicit parameters or ports. Importing `index.ts` starts no
timers, opens no connections, and launches no workers.

Run `npm run build:runtime` to build `.build/runtime/coordinator-policies.cjs`.
It includes source maps back to TypeScript. Both the Windows setup/launcher and
Docker already invoke the shared runtime build. Do not edit this artifact.
Until the final launcher migration, legacy coordinator changes must also be
preserved in `patches/caracal-current-api.patch`.

Run `npm run typecheck` and `npm run lint:runtime` for strict typing and the
complexity limit of 10. New regression tests should import the TypeScript modules,
not slice functions out of the coordinator source.

## Remaining implementation, in order

1. Define persisted domain schemas and explicit serializers; migrate initialization
   and the existing v1 saved-state defaults without changing their keys or semantics.
2. Finish account initialization and roster integration behind caracAL-root-relative
   adapters. Worker lifecycle, IPC, CODE reloads, shutdown, and realm-transition
   execution are extracted; their composition adapters still live in JavaScript.
3. Finish navigation command APIs, grouped-combat composition,
   and remaining merchant handlers. Anniversary staging/commerce, account creation,
   BankBoi completion, realm controls, focus/formation and Hunt controls are extracted. Preserve command generations,
   stale-acknowledgement rules, and existing deadlines.
4. Move merchant completion, remaining storage reconciliation, mail, and remaining
   inventory/order APIs into their domain services.
5. Make HTTP routes thin adapters, replace the legacy host with a composition
   root, and finish converting source-coupled tests into module/HTTP contract tests.
6. Build the complete coordinator with source maps; replace the large compatibility
   patch section with a generated launcher. Remove coordinator string-rewriting
   upgrade scripts, retaining unrelated CharacterThread hooks.
7. Publish via a validated generation marker, add a single graceful supervisor
   restart per generation, and test failed builds without disturbing the old
   process. Verify fresh and existing Windows installs and Docker persistent-volume
   restarts before the final switch.

The baseline suite passed 692 tests before extraction. The read-only inventory
tool `tools/caracal/coordinator-inventory.mts` enumerates functions, routes, timers,
saved keys, and source-coupled tests. Pass a coordinator path and an optional JSON
output path to audit subsequent migration steps. Store temporary comparison
fixtures under `.build`, never in the installed game directory.

The initial policy extraction passed 707 tests. Subsequent integrations added
direct module and HTTP contract tests, including captured dispatcher outputs,
dashboard response variants, and complete first/repeated heartbeat responses.
The combined BankBoi, realm, focus/formation and Hunt-control integration passed all
926 tests, including the concurrent combat queue refactor. The shared runtime build performs
strict TypeScript checking; the coordinator directory also passes type-aware lint
and the complexity limit of 10.

A full-entry comparison with a mocked account, empty roster, and disabled I/O
checks route registration, timer intervals, signal listeners, and initial storage
writes against the pre-extraction host. The existing installer was exercised in
an isolated directory; its additional mail-postage route and headless-ready hook
are retained. These checks do not constitute final Windows/Docker live startup
or generation-publication validation.

Verified integrations are published together with their compatibility patch.
The local Party Console endpoint has been checked after publication; all four
configured slots reported online. Concurrent changes remain intact. The Hunt
installer recognizes typed services instead of trying to rewrite their wrappers.

The compatibility host remains substantial, particularly its HTTP handlers and
composition root. The full rewrite is **not complete**. Do not replace the host with a generated launcher until
the remaining services and composition root exist and the installer no longer
rewrites coordinator source strings.

### Merchant integration checkpoint

Merchant handoffs, heartbeats/checkpoints, marketplace progress and location
refresh, collection/Luck clusters, and job completion are extracted into typed
services. Completion separates durable receipts, retry decisions, and final
scheduling. Captured legacy-handler contracts cover partial BankBoi handoffs,
unbounded commerce interruption retries, rendezvous limits, resource blocks,
equipment/stat-scroll delivery, deferred work, and stale acknowledgements.

Bank, stat-scroll, and equipment receipts are also extracted. Their tests preserve
individual duplicate requests, bank ownership, persistence-before-dispatch ordering,
and equipment command generation checks.

Stand control now separates WTB validation, idle-report handling, physical listing
reconciliation, and stack-merge authorization. Returned inventory entries are claimed
once, pending bank withdrawals are deduplicated, and stale commands are rejected.
The associated tests call the extracted modules directly.

Mail envelope/attachment validation, storage staging, job construction, account API
response decoding, and inbox HTTP actions are extracted. A host-level regression
test invokes the completion callback and verifies it reaches the same initialized
inbox used by the routes; this fixed a scope error in the earlier completion wiring.

Manual local-stand, ALData buy/sell, and Ponty orders now use typed validation and
job construction services. Merchant cancellation, force-stand, clear, donation,
giveaway, and stand-search controls are also extracted. Tests cover atomic stale
selection rejection, Ponty realm grouping/reservations, retained pause checkpoints,
and cancellation intent cleanup.

The installed host is now 167,529 bytes, down from 231,107 bytes at this checkpoint.
All 1,017 full-suite tests pass with the completed combat claim integration. Runtime
build, coordinator complexity lint, isolated installer, and compiled-module startup
comparison pass. The validated host and its compatibility install patch are published.
Final Windows/Docker generation-publication validation remains part of the full rewrite.

### Command and scheduling integration

All character-command families and their common HTTP adapter are extracted into
strict TypeScript. This includes navigation, upgrades, compounds, stat scrolls,
delivery/withdrawal, equipment, exchange, and collection marks. Bank unlocking,
restock, manual blacklisting, and dashboard import/backup/rollback are also extracted.

The published host retains the completed combat death-disengagement controller and
zone/radius integration. Merchant's Luck scheduling, the serialized character bank
queue, and automatic NPC/stand sale reconciliation now have typed services. Their
tests cover timing and queue deduplication, NPC rule precedence, inventory sorting,
locked items, listing limits, and live stand listings whose bag slots are reused.
Dashboard import tests cover preview tokens, exclusive backup failure, persistence
rollback, and preservation of runtime state.

Inventory reservation cleanup is also extracted: outgoing bag slots preserve
equipped upgrade requests and partial compound groups; incoming cleanup retains
the original exact serialized-item match. Both cases have behavior tests.

BankBoi staging-row adoption is extracted into `inventory/reserved-cargo.ts`.
Tests preserve retrieval reservations, quantity refreshes, stale-request removal,
ordinary bank requests, and first-snapshot migration behavior.

Merchant home recovery and stalled WTB handling now live in `merchant/home-recovery.ts`.
Behavior tests cover realm arrival, throttled restart attempts, exact sale deadlines,
and the rule that ambiguous sales are never requeued.

Automatic compound/exchange scheduling now uses `merchant/improvement-scheduler.ts`.
Tests cover bank-backed ingredients, completed quantity rules, disabled routines,
and duplicate exchange jobs; the existing bank-compound regression uses the service.

Giveaway discovery now uses `merchant/giveaway-scheduler.ts`, with behavior tests
for eligibility, seller/offer deduplication, stamped jobs, and notification details.

Roster, slot, account-home and realm-control responses use
`characters/roster-projection.ts`. Tests preserve Steam/headless slot allocation,
heartbeat cutoffs, account refreshes, BankBoi exclusion, and combat realm splits.

The host is now 121,819 bytes (171,650 before this integration). All 1,103 tests pass,
as do the runtime build, coordinator complexity checks, isolated installer, and
compiled-module startup comparison. The host and compatibility patch are published.
Remaining work includes reconciliation helpers, state initialization, HTTP
installation, the typed composition root, and final Windows/Docker generation
publication validation. The host is still JavaScript; this is not the final launcher.

### Startup integration

Event schedule report selection and merchant process-restart queue recovery are
extracted into `events/schedule-reports.ts` and `merchant/restart-queue.ts`.
Four focused tests cover report freshness/realm selection, recovered cargo,
transient command fields, and exact commerce-order deduplication. Runtime
typecheck, targeted complexity lint, and source-module startup comparison pass.
These changes are published after rebasing onto the completed convoy-defense and
command-ownership integration. All 1,146 tests pass, along with the runtime build,
coordinator complexity lint, isolated installer and compiled startup comparison.
The host is now 113,586 bytes, down from the updated baseline of 122,232 bytes.

`infrastructure/game-data.ts` also extracts bank-vault parsing and lazy map-data
loading. Four additional focused tests cover source paths, diagnostic filenames,
vault sorting/keys, malformed sources, cache identity, and retry after failed reads.
Its integration passes typecheck, complexity lint, and startup checks.

`characters/worker-setup.ts` extracts worker configuration and headless slot
assignment. Three tests cover realm fallback order, watcher replacement, preserved
version/connection state, persistence order, and avoiding duplicate worker starts.
Its integration also passes typecheck, complexity lint, and startup checks.

`characters/startup-slots.ts` extracts startup worker preparation and delayed slot
restoration, retaining the four-second timer. Three tests cover preparation order,
Steam ownership changes during the delay, invalid slots, and duplicate starts.
Typecheck, complexity lint, and startup comparison pass.

`merchant/realm-pause.ts` extracts realm-switch job preservation. Two tests retain
queue precedence, original intent, timestamp coercion, and command cleanup while
removing the old worker's progress fields. Typecheck/lint/source startup pass.

`persistence/initial-snapshots.ts` now uses the typed JSON store for the six startup
documents. Tests preserve key/read order, independent failures and warning text,
and legacy JSON values. Typecheck, complexity lint, and source startup checks pass.

`merchant/initial-settings.ts` extracts sale-listing migration and merchant priority
and automation defaults. Three tests cover missing metadata, preserved records,
false/zero overrides, and independent defaults. Typecheck/lint/source startup pass.

`telemetry/initial-history.ts` extracts saved activity and combat-log initialization.
Three tests cover source precedence, retention limits, legacy entry filtering, and
consecutive skill deduplication. Typecheck/lint/source startup checks pass.

Anniversary and ALData startup state now use `anniversary/initial-state.ts` and
`commerce/initial-aldata.ts`. Three tests preserve saved overrides, empty blacklist,
authentication/history restoration, timestamp coercion, and transient state reset.
Typecheck/lint/startup pass. `characters/initial-roster.ts` also preserves saved
headless slots, legacy enabled-worker fallback, and Steam membership migration;
three additional tests cover those behaviors. The compatibility patch is updated.

`characters/migrate-selections.ts` now owns legacy event selections and initial
headless realm assignment. Two tests preserve explicit empty selections and
BankBoi exclusions. The published host is 113,098 bytes; all 1,148 tests pass,
along with runtime build, targeted complexity lint, installer and startup checks.

`navigation/migrate-focus.ts` owns promotion and removal of the legacy leader
focus copy. Three tests preserve explicit empty focus and independent selections.
The published host is 112,397 bytes; all 1,151 tests, runtime build, targeted lint,
installer and startup checks pass. Command-ownership wiring remains intact.

Pending: empty-focus navigation intent migration is extracted into the same focus
module. Its behavior test, typecheck, lint, build, installer and startup checks pass.
Full validation currently encounters Hunt/rare-hunting failures; rare-hunting also
fails without the staged host preload. The host change remains unpublished pending
integration diagnosis (`.build/coordinator-empty-focus-full-tests.log`).

Also staged: `telemetry/merchant-projection.ts` extracts public merchant jobs and
BankBoi state. Two tests preserve credential redaction, collection thresholds and
labels, sorted storage views, and transaction details. Typecheck/lint/startup pass.

Also staged: `inventory/restock-completion.ts` preserves inventory counting and
target-max completion checks. Three tests cover split inventory stacks, disabled
targets, unavailable inventory, and legacy numeric coercion. Source checks pass.

Also staged: `persistence/writer.ts` owns the five persistence entry points and
uses explicit snapshot selectors. Three tests preserve document keys/write order,
history limits, credential separation, and error propagation. Source checks pass.

Also staged: `commerce/publication-scheduler.ts` owns the five-second ALData
publication timer. Two tests preserve batching and timer release before publishing;
typecheck, complexity lint, and source startup comparison pass.

Also staged: `inventory/initial-collection.ts` owns collection thresholds and saved
mark precedence. Two tests preserve integer validation, slot clamping, and explicit
empty selection maps. Typecheck/lint/source startup checks pass.

Also staged: `inventory/initial-bank.ts` restores bank queues, snapshots,
transactions and withdrawals while loading vault definitions and resetting the
observer. Two tests and typecheck/lint/source startup checks pass.

Also staged: `merchant/initial-gathering.ts` preserves mode migration, cooldowns,
missing-tool state, and Luck cast timestamps. Two tests and source checks pass.

Also staged: `navigation/initial-commands.ts` preserves restart convoy invalidation,
navigation epochs, clock-based command IDs, and transient queue reset. Two tests
and typecheck/lint/source startup checks pass.

Also staged: `navigation/initial-focus.ts` preserves initial focus precedence,
legacy string migration, per-character settings, and farming policy defaults.
Two tests and typecheck/lint/source startup checks pass.

Also staged: `navigation/initial-farming.ts` preserves durable Hunt/rare state
while resetting transient scatter decisions. Two tests and source checks pass.

Also staged: `merchant/initial-runtime.ts` restores merchant jobs, cargo, equipment
and stand intent. Two tests and typecheck/lint/source startup checks pass.

Also staged: `inventory/initial-intents.ts` restores upgrades, stat scrolls,
purchases, compounds, automatic exchanges and gold targets. Two tests and source
checks pass.

Also staged: `initial-core.ts` owns recovery/party/event defaults and transient
market/catalog state. Three tests and typecheck/lint/source startup checks pass.
The remaining host state initializer is ready for typed factory composition.

The complete party initializer is now staged through `initial-state.ts`, composing
the extracted modules in original evaluation order. A permanent legacy fixture
checks full state equality, property ordering and clock-call order. Typecheck,
complexity lint and source startup checks pass. Persisted payload boundaries still
use unknown fields; full typed service composition and publication remain pending.

Published the pending initializer, persistence, projection and HTTP extraction batch together with the Hunt/client integration. The host is now 96,200 bytes. HTTP registration lives in http/registration.ts; cache and CORS behavior lives in http/middleware.ts. The hosting installer recognizes the extracted mail-postage registration. Full combined staged-host regressions: 1,203/1,203; typecheck, middleware tests, lint and isolated installed-host startup parity pass. Typed service composition remains unfinished. Windows/Docker share the validated installer; no Docker end-to-end run was performed for this batch.

Ownership handoff composition now lives in characters/ownership.ts: persisted ownership accessors, authoritative offline polling, readiness/busy guards, worker stop sequencing and roster group projection. Five regression tests cover bounded/offline-bounce behavior, missing members, shutdown failures, write-through state and group classification. Published host: 93,274 bytes; 1,208/1,208 full staged-host tests, runtime build/lint and isolated installer startup parity pass.

Grouped snapshot orchestration now lives in navigation/grouped-snapshot.ts, including cancellation/event/scatter gates, participant selection, evaluator/disengagement ordering and bounded formation logs. Three new behavior tests plus the existing rare queue integration pass. Published host: 91,516 bytes; full suite 1,211/1,211, typecheck/lint and isolated installed-host startup parity pass. Full typed service composition remains outstanding.

Web lifecycle extracted to http/web-services.ts: monitor reuse, CODE/TYPECODE setup, dashboard ordering, bind addresses and startup failure handling. Five new regressions cover configuration branches and partial failures. Published host 90,292 bytes; 1,216/1,216 tests plus build/lint and installed-host startup parity pass. Dashboard route composition remains in the host callback; the overall TypeScript composition root is still incomplete.

Generation watcher ports and shutdown signal registration now live in characters/runtime-lifecycle.ts. Three regressions cover live-worker filtering, process replacement, script-before-stop sequencing, stop failures and IPC filtering. Published host 89,556 bytes; 1,219/1,219 full tests, build/lint and installed-host startup parity pass. Service composition, dashboard composition and the final typed entry point are still outstanding.

Destination selection and A/B update orchestration now live in navigation/selected-destination.ts and events/abtesting-update.ts. Five regressions cover shared/independent empty focus, priorities, same-map distance/ties, active-name boundaries, participant exclusion, retained strategy and persistence gating. Published host 88,005 bytes; full suite 1,224/1,224, typecheck/lint and installed-host startup parity pass. Overall typed composition remains incomplete.

Storage boundary extracted to inventory/storage-service.ts, including withdrawal queue/persistence, storage identity and restock defaults. Three new regressions; 1,227/1,227 full tests plus typecheck/lint and installed-host startup parity pass. Published host 87,726 bytes. Remaining service composition and typed entry point are not complete.

Character manager/CODE service composition now lives in characters/composition.ts. It retains dynamic account reads, receiver-bound account methods, lifecycle access and ordered filename/content hashing. Two new regressions; full suite 1,229/1,229, build/lint and installed-host startup parity pass. Published host 87,270 bytes; other service composition and the final typed entry point remain unfinished.

Event-return composition now lives in events/return-composition.ts: recovery accessors, Town commands, Franky exit routing and farming-navigation callbacks. Two new composition regressions plus full suite 1,231/1,231 pass; typecheck/lint and installed-host startup parity pass. Published host 86,032 bytes; remaining service composition and typed entry point are not complete.

BankBoi composition extracted to inventory/bankboi-composition.ts. Two regressions cover slot/stop ordering, transaction updates, dynamic merchant restoration and normal-withdrawal collection. Published host 85,370 bytes; full suite 1,233/1,233, build/lint and installed-host startup parity pass. Full typed composition remains incomplete.

Merchant queue composition staged in merchant/queue-composition.ts; two new tests, typecheck/lint and installed-host startup parity pass. Publication pending integration of seven independently reproduced Hunt/event baseline failures. Candidate host .build/coordinator-after-queue-composition.js is 84,793 bytes; installed host remains 85,370 bytes. Do not mark full refactor complete.

Realm-switch composition staged in characters/realm-composition.ts after the pending queue extraction. Two new composition tests, typecheck/lint and full source startup parity pass. Seven Hunt/event baseline failures still reproduce unchanged; no shared build/publication performed for this batch. Candidate is .build/coordinator-after-realm-composition.js; full typed composition remains unfinished.

Merchant dispatch composition staged in merchant/dispatch-composition.ts after queue and realm composition. Two new regressions cover live command payload references and equipment/storage precedence. Typecheck/lint and source startup parity pass. Candidate .build/coordinator-after-dispatch-composition.js remains unpublished pending shared Hunt/event integration.

Merchant idle composition staged in merchant/idle-composition.ts. Two regressions cover ready-job gates and live idle command payloads/sequence. Typecheck/lint and source startup parity pass. Candidate .build/coordinator-after-idle-composition.js follows queue, realm and dispatch stages; no publication while shared Hunt/event integration remains pending.

Party convoy composition staged in navigation/convoy-composition.ts. Focused regression and targeted lint pass. Shared typecheck currently fails on duplicate trip declarations in http/hunt-control.ts from Hunt integration; no combined build/publication performed. Candidate .build/coordinator-after-convoy-composition.js follows prior staged chain; goal remains incomplete.

Anniversary-return composition staged in anniversary/return-composition.ts after convoy composition. Focused travel-ownership/routing regression, shared typecheck, targeted lint and source startup comparison pass. The duplicate Hunt trip declaration was resolved by its owning work. Candidate .build/coordinator-after-anniversary-return-composition.js remains unpublished pending combined integration validation.

Anniversary snapshot composition staged in anniversary/snapshot-composition.ts. New live merchant/status/realm regression, typecheck/lint and source startup parity pass. Candidate .build/coordinator-after-anniversary-snapshot-composition.js follows existing staged chain; combined validation/publication and final typed composition remain outstanding.

Published the accumulated queue, realm, dispatch, idle, convoy and anniversary composition stages with the Hunt paused-event follow-up. Full combined suite 1,262/1,262 and npm run build pass; installer/startup parity pass. Legacy state comparison now explicitly verifies the added Hunt-trip/handoff fields while retaining all original-field equality/order assertions. Hunt selector harness loads the real blacklist-label helper. Host 81,393 bytes; full typed entry point/composition remains unfinished.

Merchant recovery composition published in merchant/recovery-composition.ts. Two regressions verify job-scoped command cleanup, recovery IDs and persist-before-dispatch ordering. Full suite 1,264/1,264, typecheck/lint and installed-host startup parity pass. Host 81,185 bytes; overall typed composition remains incomplete.

Event observation composition published in events/observation-composition.ts. New regression covers live session capture and deferred command ownership with current collections. Full suite 1,265/1,265, typecheck/lint and installed-host startup parity pass. Host 80,620 bytes; full typed composition remains incomplete.

BankBoi observation composition published in status/bankboi-composition.ts. New regression covers command ownership, ordered withdrawal references, inventory update and transaction phase. Full suite 1,266/1,266, typecheck/lint and installed-host startup parity pass. Host 80,263 bytes; full typed composition remains incomplete.

Merchant scheduling composition published in status/scheduling-composition.ts. New regression covers bank-command ownership, asynchronous storage failure reporting and live gold snapshots. Full suite 1,270/1,270, typecheck/lint and installed-host startup parity pass. Host 80,113 bytes; full typed composition remains incomplete.

Hunt composition published in hunt/composition.ts. Lifecycle, quest selection, convoy travel and tick recovery now connect directly in TypeScript. Three regressions cover departure command flags and IDs, defense-before-travel and Daisy claims without a convoy. Full suite 1,273/1,273, typecheck/lint and installed-host startup parity pass. Installer recognizes the composition entry point. Host 78,733 bytes; full typed composition remains incomplete.

Hunt controls published in hunt/controls.ts: participant eligibility, scoped cancellation and clearing, spawn selection and threat lookup. Four regressions cover freshness boundaries, command ownership, location coercion and stable ties. Full suite 1,277/1,277; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 77332 bytes; full typed composition remains incomplete.

Legacy startup storage migration published in persistence/legacy-storage.ts; removed unused partition helper. Six regressions preserve transfer order, diagnostics, empty input, read fallback and parse/write/delete failure behavior. Full suite 1,283/1,283; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 76507 bytes; full typed composition remains incomplete.

Dashboard route assembly published in http/dashboard.ts with typed handler groups and router ports. Preserves middleware and parser limits, route order, roster setup and mailbox initialization timing. Three regressions cover handler identity, service ordering and partial-start failures; full suite 1,286/1,286. Runtime typecheck/lint, build and isolated installer/startup parity pass. Installer recognizes the dashboard entry point. Host 74383 bytes; full typed composition remains incomplete.

Mailbox startup published in commerce/mail-startup.ts. Typed transport preserves lazy fetch loading, authentication and 20-second deadline; refresh lifecycle retains current inbox reads, immediate refresh and unreferenced 30-second polling. Three regressions cover transport, replaced account/jobs/inbox state and synchronous failure behavior. Full suite 1,289/1,289; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 73892 bytes; full typed composition remains incomplete.

Market feed composition published in commerce/market-feeds.ts. ALData and Ponty share the original request budget; current owner, listings, catalog and history callbacks remain dynamic. Three regressions cover priming and polling cadence, publication identity/listings and replaced history collections. Full suite 1,292/1,292; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 72873 bytes; full typed composition remains incomplete.

Inventory mark reconciliation and merchant job policy published in inventory/mark-reconciliation.ts and merchant/job-policy.ts. Six regressions cover manual mark relocation, current map writes, upgrade pass resolution, occupied staging priority, stable bids and capacity signatures. Migrated the existing bank-full capacity regression from host source slicing to the production module. Full suite 1,298/1,298; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 71504 bytes; full typed composition remains incomplete.

Merchant collection eligibility and queue dequeue/stamping published in merchant/queue-selection.ts. Three regressions preserve threshold/nearby behavior, duplicate-slot counting, blocked queue identities, enqueue-time ties, normalization and clock-call order. Full suite 1,301/1,301; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 70954 bytes; full typed composition remains incomplete.

Travel clocks, farming authorization and event checkpoints published in navigation/runtime.ts. Four regressions preserve timer installation/tick order, convoy-busy retries, Escape-release state replacement and checkpoint coercion. Three legacy integration fixtures now use the production authorization helper. Full combined suite 1,310/1,310, including the other session's merchant fix; typecheck/lint, build and installer/startup parity pass. Host 70832 bytes; full typed composition remains incomplete.

Character startup sequencing published in characters/startup.ts. Preserves shutdown signal registration, worker preparation, four-second restoration, live Steam ownership, generation watching and account subscription order. Three regressions cover startup ordering, worker replacement and preparation failure. Full suite 1,313/1,313; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 70523 bytes; full typed composition remains incomplete.

Environment initialization published in environment.ts. Preserves storage migration/sentinels, game-version and config loading order, optional culling, session fallback, account login and configured realm selection. Three regressions cover sequencing, reference identity, defaults and failure propagation. Full suite 1,316/1,316; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 70231 bytes; full typed composition remains incomplete.

Removed 21 unreferenced wrapper functions and eight unused bindings after TypeScript symbol/reference analysis, including shorthand-property references. Migrated two source-slice tests to named function extraction; installer now recognizes typed character services without the obsolete reload wrapper. Remaining 131 function declarations all have references. Full suite unchanged at 1,316/1,316; build/typecheck and installer/startup parity pass. Host 67779 bytes; full typed composition remains incomplete.

Merchant action composition published in http/merchant-actions.ts. Manual market orders, control routes and request routes share typed command/stamp/dispatch wiring; force-stand preserves home-realm assignment and deferred restart ordering. Two regressions cover paused work, worker identity and the shared command sequence. Full suite 1,318/1,318; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 67220 bytes; full typed composition remains incomplete.

Manual navigation composition published in navigation/manual-composition.ts; removed its obsolete host authorization wrapper. Two regressions preserve event-deferred party travel, recovery reset, merchant Escape exemption, command IDs and delayed realm restart. Full suite 1,320/1,320; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 66660 bytes; full typed composition remains incomplete.

Character command composition published in http/character-actions.ts. Shared validation, management checks and ordered navigation/inventory handlers now assemble in TypeScript. Three new regressions cover validation, dispatch precedence and current command state. Equipment-delivery regressions now submit through the real command route instead of intercepting a nested transfer factory. Full suite 1,323/1,323; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 65634 bytes; full typed composition remains incomplete.

Dashboard import I/O composition published in http/dashboard-import-composition.ts. Existing preview/backup/rollback integration tests now exercise the composition; added current-path metadata coverage and exact hash, suffix and exclusive-copy assertions. Full suite 1,324/1,324; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 65365 bytes; full typed composition remains incomplete.

Merchant automation composition published in merchant/automation-composition.ts. Giveaway, improvement, home recovery, sale and Luck schedulers share typed command and dispatch wiring. Two regressions cover live counter/collection replacement, duplicate prevention and deferred home restart. Full suite 1,326/1,326; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 64651 bytes; full typed composition remains incomplete.

Merchant job action composition published in http/merchant-job-actions.ts. Progress, purchase acknowledgements, pickup clusters, realm changes and marketplace location refresh now assemble in TypeScript. Three integration regressions preserve stale-report rejection, response/restart order, current command state, sale/purchase normalization and duplicate Ponty acknowledgement handling. Full suite 1,329/1,329; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 64080 bytes; full typed composition remains incomplete.

Merchant delivery composition published in http/merchant-delivery-actions.ts. Mail enqueue/send and completion receipt wiring now share the live command counter in TypeScript. Three regressions cover all recorded completion contracts, late inbox initialization, deferred improvements and delayed credential encoding; host mail test now uses the real completion route. Full suite 1,332/1,332; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 63543 bytes; full typed composition remains incomplete.

Inventory action composition published in http/inventory-actions.ts. Automatic sales, NPC sales, stand marks, handoffs, receipts, idle reports, bids and merge authorization now assemble in TypeScript. Three integration regressions preserve current merchant reports, command allocation, stale receipt rejection and bank release ordering. Full suite 1,335/1,335; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 62332 bytes; full typed composition remains incomplete.

Account character action composition published in http/account-character-actions.ts. Creation and BankBoi deletion share typed authenticated transport; eight-free-slot policy and bounded roster confirmation stay intact. Three regressions verify exact requests, guard-before-network behavior, adoption/assignment ordering and deferred retries. Full suite 1,338/1,338; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 61283 bytes; full typed composition remains incomplete.

Merchant configuration composition published in http/merchant-configuration.ts. Typed write-through views now own settings, routine priorities and collection thresholds. Three regressions cover replaced collections, lazy bid reasons, current command allocation and partial-invalid update behavior. Full suite 1,341/1,341; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 60044 bytes; full typed composition remains incomplete.

Status ingestion composition published in status/composition.ts. Typed wiring now owns catalog, Ponty, bank, one-shot and scatter consumers, current ownership and market publication gating. Three regressions verify ordered report processing, payload removal, bank adoption, current state and strict hourly publication timing. Full suite 1,344/1,344; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 59056 bytes; full typed composition remains incomplete.

Anniversary supply and reciprocal identity helpers published in anniversary/supplies.ts, using the shared typed inventory counter. Three regressions preserve BankBoi snapshot precedence, current storage/trade state, identity coercion and returned-trade release. Full suite 1,347/1,347; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 58517 bytes; full typed composition remains incomplete.

Purchase composition published in commerce/purchase-composition.ts. Local stand matching and remote bids share typed pending checks, command allocation and current merchant realm. Centralized automatic purchase reasons and removed obsolete pending wrapper. Two integration regressions cover cross-source duplicates, current queue/realm/counter state, priorities and level-qualified fulfillment. Full suite 1,349/1,349; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 58012 bytes; full typed composition remains incomplete.

Navigation action composition published in http/navigation-actions.ts. Event acknowledgements, convoy engagement/completion and farming return share typed current Hunt and command wiring. Three integration regressions preserve current target/ownership, adapter identity, Franky Town allocation, stale completion protection and failure-log order. Full suite 1,352/1,352; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 57440 bytes; full typed composition remains incomplete.

Market account composition published in http/market-account-actions.ts. ALData account controls and postage cache loading now assemble in TypeScript. Two regressions preserve key generation, live command allocation, duplicate prevention, cache lookup order and null-on-failure behavior. Full suite 1,354/1,354; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 57379 bytes; full typed composition remains incomplete.

Published accumulated Hunt controls, activity service, telemetry composition, party configuration and bank API composition after Bee Hunt publication release. Ten integration regressions cover state replacement, logging, lazy map data, navigation authorization and bank persistence/restore order. Full staged-host suite 1,375/1,375; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 56115 bytes; full typed composition remains incomplete.

Realm action composition published in http/realm-actions.ts, removing the host runRealmSwitch wrapper. Two integration regressions exercise HTTP-to-worker switching, current arrival reports, shared command IDs and home confirmation before merchant resumption. Full suite 1,377/1,377; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 55817 bytes; full typed composition remains incomplete.

Heartbeat response composition published in status/response-composition.ts. Current farming authority, navigation and storage ownership are wired in TypeScript; two regressions cover replacement state and combat-only command retention. Updated the equipment Escape fixture injection point. Full staged-host suite 1,379/1,379; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 55625 bytes; full typed composition remains incomplete. Preserved published Bee character assets.

Farming navigation composition published in navigation/farm-composition.ts. Two integration regressions verify current catalogs/worker roster and event ownership holding then releasing Hunt relocation. Full staged-host suite 1,381/1,381; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 55596 bytes; typed root and full refactor remain incomplete. Character assets preserved.

Anniversary HTTP composition published in http/anniversary-actions.ts. Visit, navigation, commerce and supplies factories share typed dependencies while retaining original anniversary object capture and live merchant/Hunt/convoy state. Two integration regressions cover revisions, travel ownership, return persistence order, command IDs and BankBoi supplies. Full staged-host suite 1,383/1,383; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 54679 bytes. Remaining 126 host functions are referenced; typed root and full refactor remain incomplete. Character assets preserved.

Recovery hooks extracted and published in navigation/recovery-hooks.ts. Rare-Hunt reset, Escape cancellation and death-return convoy behavior now reside in TypeScript. Three regressions cover mutation order, live ownership, command preservation and false convoy return propagation. Full staged-host suite 1,386/1,386; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 53889 bytes; full typed root remains incomplete. Character assets preserved.

Public overview composition published in telemetry/public-composition.ts. Event schedules, BankBoi status and merchant queue projection share typed wiring; removed two host projection wrappers. Two new regressions cover replacement state, realm feed selection, transaction presentation, current collection thresholds and credential removal. Collection-threshold fixture now constructs the real overview service. Full staged-host suite 1,388/1,388; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 53520 bytes; full typed root remains incomplete. Character assets preserved.

Startup state assembly extracted and published in initialization.ts. Snapshot reads, initial headless selection and full state construction preserve original ordering and the legacy JSON boundary. Two regressions cover storage read order, roster/bank/settings adoption, retained identity and independent malformed JSON fallback. Full staged-host suite 1,390/1,390; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 53142 bytes; full typed root remains incomplete. Character assets preserved.

Storage observation composition extracted and published in status/storage-composition.ts. Bank snapshot adapters, BankBoi observation and merchant sales observation now share typed live views with separate bank/settings persistence. Two regressions cover snapshot adoption order, live BankBoi dispatch state and replaced stand listings with persistence-before-publication. Full staged-host suite 1,392/1,392; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 52790 bytes; full typed root remains incomplete. Character assets preserved.

Merchant dispatch/idle composition extracted and published in merchant/service-composition.ts. Shared storage/readiness gates and internal idle fallback now assemble in TypeScript with original creation order. Two regressions cover live merchant/realm/listings, shared command sequence and pending storage preserving queued work. Full staged-host suite 1,394/1,394; runtime typecheck/lint, build and isolated installer/startup parity pass. Host 52418 bytes; full typed root remains incomplete. Character assets preserved.
