# Coordinator test audit

Historical first-pass audit. The follow-up [replacement matrix](testing-replacement-matrix.md)
supersedes the retention decisions and records subsequent removals. The old
three-browser-test boundary is not a reason to retain duplicated isolated tests.

The scope is every `scripts/tests/coordinator-*.test.cjs` file present on PR #21. Counts below are source-level test declarations; parameterized loops expand to more runtime cases.

160 files reviewed; 3 files deleted; 12 files trimmed; 20 test declarations removed out of 642.

The browser suite runs the gateway and real coordinator application with an isolated disk journal, using simulated external account/game boundaries. It does not yet execute native game clients or every commerce, combat and recovery failure. Retained tests are explicit coverage gaps, not an endorsement of adding more unit tests. Do not delete a failure regression until an E2E journey can reproduce the same failure.

Removal criteria: implementation mirrors, exact property/read/callback order, transparent adapter forwarding, empty-object identity, and router/dependency registration snapshots. Retention criteria: externally meaningful state/validation contracts, stale ownership rejection, bounded retries, failure recovery, migration and persistence, privacy, and resource reservations absent from E2E.

| File | Decision | Reason / uncovered failure |
| --- | --- | --- |
| `coordinator-abtesting-update.test.cjs` | Retain | E2E gap: active names preserve status order and include the exact ten-second boundary; AB strategy evaluates merchants and excludes disabled members, persisting only serialized changes. |
| `coordinator-account-character-actions.test.cjs` | Retain | E2E gap: account guards prevent paid creation and occupied deletion before loading transport; confirmed deletion persists. |
| `coordinator-activity-service.test.cjs` | Retain | E2E gap: merchant activity persists only accepted cooldown messages and reads replacement history; anniversary activity uses current state, retains 500 entries and does not persist merchant history. |
| `coordinator-aldata-routes.test.cjs` | Retain | E2E gap: ALData authentication mail requires an online merchant and key and deduplicates queued work; ALData fetch and unavailable mail source errors retain their public failure contracts. |
| `coordinator-anniversary-actions.test.cjs` | Retain | E2E gap: anniversary actions share current revisions and preserve Hunt and convoy travel ownership; anniversary commerce uses the shared counter and supplies follow the current merchant with bank persistence. |
| `coordinator-anniversary-commerce.test.cjs` | Retain | E2E gap: automatic chat is reserved once, and manual chat completion checks its command id; fresh merchant inventory replaces stale heartbeat counts before accepting a swap. |
| `coordinator-anniversary-control.test.cjs` | Retain | E2E gap: merchant staging reserves ninety seconds and tolerates a fifteen-second late live payload; featured merchant leaves after one minute of the five-minute round. |
| `coordinator-anniversary-empty-state.test.cjs` | Retain | E2E gap: combat recovery accepts absent anniversary cycles and unselected targets without holding travel; lost anniversary handoff without captured participants retains active-party recovery fallback. |
| `coordinator-anniversary-return-composition.test.cjs` | Retain | E2E gap: anniversary composition waits for current travel owners and dispatches/reconciles through shared navigation; early anniversary return handles . |
| `coordinator-anniversary-snapshot-composition.test.cjs` | Retain | E2E gap: anniversary composition follows current merchant and status records without retaining stale realm data. |
| `coordinator-anniversary-snapshot.test.cjs` | Retain | E2E gap: inventory recovers missed slice callbacks while completed handoffs and claimed duplicates remain excluded; handoffs exclude bank merchants, disabled, stale, dead and unowned holders even with claims. |
| `coordinator-anniversary-supplies.test.cjs` | Retain | E2E gap: anniversary supply totals prefer BankBoi snapshots over duplicate live inventories and read replacement state. |
| `coordinator-application-launcher.test.cjs` | Retain | E2E gap: launcher starts the real bundle and serves a heartbeat: ; application launcher delegates installed paths unchanged: . |
| `coordinator-automatic-sales.test.cjs` | Retain | E2E gap: banked auto-stand pants reserve four soft buy slots and queue one bounded withdrawal batch; bank auto-stand protects locked, conflicting, and crafting stock and waits for active withdrawals. |
| `coordinator-bank-actions.test.cjs` | Retain | E2E gap: bank checkpoint and completion persist bank state and respond before restoring the merchant; bank unlock allocates a current command ID while restock settings use settings persistence. |
| `coordinator-bankboi-composition.test.cjs` | Retain | E2E gap: BankBoi composition disables the merchant after clearing its slot and writes through transaction phases; an empty slot is not a merchant when no merchant is selected. |
| `coordinator-bankboi-observation-composition.test.cjs` | Retain | E2E gap: BankBoi observation composition respects existing commands and preserves ordered withdrawal references. |
| `coordinator-bankboi-routes.test.cjs` | Retain | E2E gap: mail deposits unblock their exact job without leaving a duplicate withdrawal; relocated stacks retarget every durable reference and failed completions preserve retry inventory. |
| `coordinator-bids.test.cjs` | Retain | E2E gap: market bids select affordable eligible levels and cancel duplicate queued purchases when filled. |
| `coordinator-character-actions.test.cjs` | Retain | E2E gap: character action validation rejects unavailable farming and inherited worker names before mutation. |
| `coordinator-character-command.test.cjs` | Retain | E2E gap: command boundary validates farming area before character and never runs rejected requests; command boundary preserves accepted farming location, response keys and first-handler ownership. |
| `coordinator-character-composition.test.cjs` | Retain | E2E gap: CODE digest preserves file-name/content ordering and read failures; character composition retains receiver-bound account methods, live account state and lifecycle writes. |
| `coordinator-character-creation.test.cjs` | Retain | E2E gap: creation trusts returned roster snapshot before requesting potentially stale account data; accepted but unconfirmed BankBoi creation stops after bounded refreshes without creating another character. |
| `coordinator-character-startup.test.cjs` | Retain | E2E gap: worker preparation failure prevents timer, generation watch and account subscription. |
| `coordinator-code.test.cjs` | Retain | E2E gap: rejected CODE restarts only when the runner explicitly requires recovery. |
| `coordinator-command-ownership.test.cjs` | Retain | E2E gap: command ownership clears only a matching current job and retains the underlying registry; convoy ownership logs are bounded and omit command payloads. |
| `coordinator-compound-commands.test.cjs` | Retain | E2E gap: compound groups reserve disjoint triplets with the selected slot first; removing a compound member retains the partial group until its final member is removed. |
| `coordinator-convoy-composition.test.cjs` | Retain | E2E gap: convoy composition resolves current Hunt target or shared focus and preserves command sequencing. |
| `coordinator-convoy-routes.test.cjs` | Retain | E2E gap: convoy failure validates ownership before recording a held route and preserves known failure codes. |
| `coordinator-craft-storage.test.cjs` | Retain | E2E gap: craft deposits keep staging cargo reserved until its job leaves the queue. |
| `coordinator-dashboard.test.cjs` | Delete (3 declarations) | Asserts registration token identity and installation order against a fake router. Browser/gateway/coordinator journeys exercise the real router and parser. |
| `coordinator-dependencies.test.cjs` | Delete (2 declarations) | Replays the dependency require list and getter order against a Proxy, including ordinary JavaScript throw propagation. Full application startup uses the actual dependencies. |
| `coordinator-dispatch-composition.test.cjs` | Retain | E2E gap: manual equipment ownership suppresses dispatch before storage scheduling; pending storage suppresses jobs. |
| `coordinator-dispatch.test.cjs` | Trim (1 declaration) | Deletes frozen pre-extraction command/effect snapshots requiring policy-specific patching; retains storage and manual equipment ownership, seller batching and runnable reservation regressions. |
| `coordinator-environment.test.cjs` | Retain | E2E gap: environment failures stop later startup I/O and preserve the original exception. |
| `coordinator-event-market-initial.test.cjs` | Retain | E2E gap: ALData applies legacy coercion for absent or invalid saved values. |
| `coordinator-event-observation-composition.test.cjs` | Retain | E2E gap: anniversary staging handoff ownership; observed=; event observation composition writes live sessions and resumes deferred travel through current command ownership. |
| `coordinator-event-observation.test.cjs` | Retain | E2E gap: stale kiss completion cannot erase a newer kiss, and cancelled movement cannot join combat; Goo Brawl combat postpones recovery even after the server announcement expires. |
| `coordinator-event-routes.test.cjs` | Retain | E2E gap: late deferred acknowledgement preserves unrelated newer commands and leaves cleanup to reconciliation; authorized deferred returns resume the captured waypoint and reject stale revisions. |
| `coordinator-exchange-routes.test.cjs` | Retain | E2E gap: exchange orders preserve level and reward choice and reject unavailable combinations; exchange shortage requests are delegated without transferring merchant ownership prematurely. |
| `coordinator-farm-composition.test.cjs` | Retain | E2E gap: a pending Hunt relocation moves the mission through the Hunt's own row; Hunt route recovery keeps its spawn and budget out of the farming retry; the empty spawn return walks only while farming holds the group and no walk runs. |
| `coordinator-focus-routes.test.cjs` | Retain | E2E gap: focus validation rejects invalid priorities and radius before mutation; clearing independent focus invalidates only its checkpoint while a global clear invalidates party members. |
| `coordinator-game-data.test.cjs` | Retain | E2E gap: invalid vault sources warn and return an empty list; failed game loads retry while an absent G caches an empty catalog. |
| `coordinator-giveaway-scheduler.test.cjs` | Retain | E2E gap: ALData candidates require freshness and safe realms, obtain rid live, and retain deduplication across restart. |
| `coordinator-grouped-snapshot.test.cjs` | Retain | E2E gap: event suppression retains the group but cancellation clears it and updates reset time; unselected leader clears an absent initial group after disengagement without evaluating members. |
| `coordinator-heartbeat-composition.test.cjs` | Retain | E2E gap: BankBoi service commands survive repeated heartbeat delivery until completion; heartbeat follows replaced farming authority, navigation intent and storage snapshots. |
| `coordinator-heartbeat.test.cjs` | Retain | E2E gap: heartbeat contract variants and runtime ownership validation. |
| `coordinator-http-middleware.test.cjs` | Trim (1 declarations) | Deletes callback-count implementation assertion; keeps actual required CORS/preflight and CODE cache contracts not asserted by same-origin browser journeys. |
| `coordinator-hunt-actions.test.cjs` | Retain | E2E gap: Hunt mode consults current catalog and combat participants before authorizing a restart. |
| `coordinator-hunt-composition.test.cjs` | Retain | E2E gap: checking quests keeps fresh dead members and waits when the leader is stale; backup repairs a persisted area that does not contain the selected monster and departs. |
| `coordinator-hunt-control.test.cjs` | Retain | E2E gap: manual hunt-return retry waits for runtime compatibility and existing command ownership; permission polling alone does not create event protection, and completed anniversary protection closes. |
| `coordinator-hunt-controls.test.cjs` | Retain | E2E gap: Hunt participants require a fresh combat leader and keep only its active same-realm followers; Hunt cancellation scopes cleanup to convoy participants; clearing also removes orphan Hunt commands. |
| `coordinator-idle-composition.test.cjs` | Retain | E2E gap: only runnable queued work blocks idle, including capacity and marked collection eligibility; idle command retains current listings, realm and sequence, and storage prevents issuance. |
| `coordinator-improvement-scheduler.test.cjs` | Retain | E2E gap: bankboi ingredients stage one missing triple and repeated observations do not duplicate it. |
| `coordinator-initial-bank.test.cjs` | Retain | E2E gap: bank initialization preserves strict migration flag and defaults invalid queues. |
| `coordinator-initial-collection.test.cjs` | Retain | E2E gap: collection thresholds preserve integer validation and slot clamping; explicit selection maps take precedence over legacy marks without mutation. |
| `coordinator-initial-commands.test.cjs` | Trim (1 declarations) | Deletes exact clock invocation order; keeps restart invalidation and destination preservation. |
| `coordinator-initial-core.test.cjs` | Trim (1 declarations) | Deletes empty runtime collection allocation checks; keeps durable recovery/event selection restoration. |
| `coordinator-initial-farming.test.cjs` | Trim (1 declarations) | Deletes independent empty-object allocation checks; keeps durable Hunt/rare recovery restoration. |
| `coordinator-initial-focus.test.cjs` | Retain | E2E gap: focus initialization preserves selection precedence and legacy defaults; per-character selection maps and valid farming modes remain unchanged. |
| `coordinator-initial-gathering.test.cjs` | Trim (1 declarations) | Deletes direct assignment/reference checks; keeps legacy multi-mode migration and explicit empty-selection precedence. |
| `coordinator-initial-history.test.cjs` | Retain | E2E gap: legacy potion and invalid kill entries are removed before consecutive skill deduplication. |
| `coordinator-initial-intents.test.cjs` | Delete (2 declarations) | Checks copied reference identity and empty-object allocation only; persisted item intent and recovery are exercised by retained transaction/restart regressions. |
| `coordinator-initial-merchant-runtime.test.cjs` | Retain | E2E gap: merchant startup defaults invalid queues and creates fresh empty cargo. |
| `coordinator-initial-roster.test.cjs` | Retain | E2E gap: saved headless slots retain explicit empties and order without mutating the source; missing saved slots inherit at most three enabled workers. |
| `coordinator-initial-snapshots.test.cjs` | Trim (1 declarations) | Deletes exact document read order; keeps corrupt-document isolation and legacy persisted payload handling. |
| `coordinator-initialization.test.cjs` | Retain | E2E gap: startup assembles persisted roster, bank and navigation state without writing or losing identity. |
| `coordinator-installer.test.cjs` | Retain | E2E gap: heartbeat contract variants and runtime ownership validation. |
| `coordinator-inventory-actions.test.cjs` | Retain | E2E gap: NPC sale and handoff commands share the live sequence without consuming IDs on rejected receipts; bank receipts persist matching withdrawals before releasing the bank and dispatching its next job. |
| `coordinator-inventory-receipts.test.cjs` | Retain | E2E gap: bank receipts consume one duplicate and dispatch only after persistence; bank receipt refuses another owner and preserves unrelated commands. |
| `coordinator-item-commands.test.cjs` | Retain | E2E gap: transfer commands coexist with unrelated commands that have no item payload. |
| `coordinator-job-policy.test.cjs` | Retain | E2E gap: priority follows occupied outbound staging while stable bid ties retain their identities; incomplete withdrawal slots never acquire outbound handoff priority. |
| `coordinator-json-store.test.cjs` | Retain | E2E gap: invalid shared values keep the original exception and per-document fallback. |
| `coordinator-jsonl-store.test.cjs` | Retain | E2E gap: preserves legacy tombstones, objects, UTF-8 chunk boundaries, and final record without newline; compacts by size even without yielding to the interval; latest updates and deletion survive restart. |
| `coordinator-legacy-schedulers.test.cjs` | Retain | E2E gap: Luck rejects stale, low-level, disabled, and already queued exchange work; bank queue deduplicates per character and job type while serializing dispatch. |
| `coordinator-legacy-storage.test.cjs` | Retain | E2E gap: legacy write failures preserve the source file and propagate the original error; legacy deletion failures propagate without claiming deletion succeeded. |
| `coordinator-mail-startup.test.cjs` | Retain | E2E gap: synchronous initial refresh failure propagates before registering a timer. |
| `coordinator-mail.test.cjs` | Retain | E2E gap: mail staging appends its attachment without altering unrelated withdrawal requests; mail rejects blank quantities, stale attachments and invalid envelopes without enqueueing. |
| `coordinator-manual-navigation.test.cjs` | Retain | E2E gap: manual party travel resets recovery but keeps an event return deferred; individual travel and merchant home preserve command IDs and delayed worker restart. |
| `coordinator-manual-orders.test.cjs` | Retain | E2E gap: ALData invalid, missing, stale and PVP selections leave the queue unchanged. |
| `coordinator-mark-reconciliation.test.cjs` | Retain | E2E gap: missing or invalid inventory cannot erase unfinished upgrades. |
| `coordinator-market-account.test.cjs` | Retain | E2E gap: postage reads the first current cache version in order and retains the null-on-failure contract. |
| `coordinator-market-feeds.test.cjs` | Retain | E2E gap: market feeds prime ALData and retain separate Ponty, merchant and trade cadences; market publication uses current merchant identity and current configured listings. |
| `coordinator-market.test.cjs` | Retain | E2E gap: market failures release the refresh latch; authenticated publication sends the selected level. |
| `coordinator-marketplace-location.test.cjs` | Retain | E2E gap: merchant realm transitions acknowledge before delayed restart and avoid restarting an already-connected destination; merchant home return initializes an unassigned worker realm before restart. |
| `coordinator-marketplace-progress.test.cjs` | Retain | E2E gap: successful marketplace progress fulfills once and pulls queued listings for the same seller into the visit; unavailable listing is not evidence to blacklist the seller or cancel other purchases. |
| `coordinator-merchant-actions.test.cjs` | Retain | E2E gap: merchant force-stand pauses active work and prepares the home realm before deferred restart. |
| `coordinator-merchant-automation.test.cjs` | Retain | E2E gap: home recovery persists realm reassignment before a deferred restart and waits for arrival. |
| `coordinator-merchant-clusters.test.cjs` | Retain | E2E gap: nearby marked collection accepts one marked slot and replaces a duplicate trip with same-batch work. |
| `coordinator-merchant-completion.test.cjs` | Retain | E2E gap: upgrade and compound communication failures preserve work with escalating durable delays; Hunt ownership defers once with the same job identity and preserved progress. |
| `coordinator-merchant-configuration.test.cjs` | Retain | E2E gap: upgrade batch setting defaults to one and persists only valid integer limits. |
| `coordinator-merchant-control.test.cjs` | Retain | E2E gap: cancel clears only the matching work intent and never dispatches; cancelling either upgrade routine preserves the other upgrade intent. |
| `coordinator-merchant-delivery-actions.test.cjs` | Retain | E2E gap: delivery composition preserves all recorded completion receipts, retries and side-effect order; mail and deferred improvements share the live command counter and completion uses the current inbox. |
| `coordinator-merchant-initial-settings.test.cjs` | Retain | E2E gap: listing migration fills missing metadata without mutating original records; saved disabled automations and zero priorities override defaults. |
| `coordinator-merchant-item-commands.test.cjs` | Retain | E2E gap: weapon selection validates the exact live item and merchant-compatible type; automatic exchange validates level and toggles before scheduling. |
| `coordinator-merchant-job-actions.test.cjs` | Retain | E2E gap: merchant job realm changes respond before scheduling a restart and reject stale reports. |
| `coordinator-merchant-order.test.cjs` | Retain | E2E gap: commerce allocates inventory before purchasing missing base materials and deduplicates the same order; invalid quantities and unavailable higher-level ingredients reject before queueing. |
| `coordinator-merchant-progress.test.cjs` | Retain | E2E gap: handoff respects protected Hunt travel and preserves newer commands on old acknowledgements; commerce handoff requires a reserved source and records delivered material without clearing another command. |
| `coordinator-merchant-projection.test.cjs` | Retain | E2E gap: public jobs redact credentials and explain collection thresholds without mutating intent; BankBoi views sort names and expose only the matching transaction phase and mode. |
| `coordinator-merchant-queue.test.cjs` | Retain | E2E gap: repeated heartbeat queue checks do not persist unchanged settings and still dispatch ready work; queue deduplicates party visits but retains distinct merchant jobs. |
| `coordinator-merchant-recovery.test.cjs` | Retain | E2E gap: completed restock dispatches before evaluating the next job recovery; anniversary deferral releases ownership once without losing purchase progress. |
| `coordinator-merchant-services.test.cjs` | Retain | E2E gap: dispatch falls through to the composed idle service using current merchant data and the shared sequence; storage blocks both idle and dispatch, and dispatch starts storage without consuming queued work. |
| `coordinator-migrate-focus.test.cjs` | Retain | E2E gap: legacy leader focus replaces stale shared focus and removes only participating overrides. |
| `coordinator-migrate-selections.test.cjs` | Retain | E2E gap: legacy event flags migrate while explicit empty and undefined selections stay authoritative; only known occupied headless slots inherit the active realm, excluding BankBoi. |
| `coordinator-navigation-actions.test.cjs` | Retain | E2E gap: convoy failure records a hold before persisting diagnostics. |
| `coordinator-navigation-commands.test.cjs` | Retain | E2E gap: Town invalidates shared intent only for the party leader; merchant home persists before delayed restart and avoids redundant same-realm restart. |
| `coordinator-no-merchant.test.cjs` | Retain | E2E gap: a stalled sale cannot restart a worker after merchant selection is cleared. |
| `coordinator-observation.test.cjs` | Retain | E2E gap: activity suppresses only recent duplicate cooldown messages and keeps bounded history. |
| `coordinator-ownership.test.cjs` | Retain | E2E gap: offline polling remains bounded and missing account members reject immediately; ownership writes through, and shutdown marks offline only after the worker stops. |
| `coordinator-party-actions.test.cjs` | Retain | E2E gap: manual collection queues every group member without a radius and does not duplicate work; repeated send does not duplicate the in-progress leader or queued follower. |
| `coordinator-party-configuration.test.cjs` | Retain | E2E gap: party configuration consults current managed workers and focus clearing invalidates shared navigation. |
| `coordinator-persistence-writer.test.cjs` | Retain | E2E gap: settings persist selections before settings and exclude transient state and auth keys; persistence writes separate roster, bank, capped history and authentication documents. |
| `coordinator-policies.test.cjs` | Retain | E2E gap: luck uses authoritative absence and caster ownership before persisted cast time; persistence logs invalid input, preserves keys, and round-trips only the supplied snapshot. |
| `coordinator-public-overview.test.cjs` | Retain | E2E gap: overview and external job projection share current collection thresholds without leaking credentials. |
| `coordinator-public-state.test.cjs` | Trim (1 declaration) | Deletes legacy whole-response snapshot that ignored every newer field; retains privacy, payload partitioning, stale connection and live-state projection regressions. |
| `coordinator-publication-scheduler.test.cjs` | Removed | Publication runs on a market change (market-feeds.ts `publish`); the timer it tested is gone. |
| `coordinator-purchases.test.cjs` | Retain | E2E gap: local and Ponty purchases share pending bids and the live command counter across queue replacement; local matching forwards bid priority and fulfillment preserves the level requirement before releasing work. |
| `coordinator-queue-composition.test.cjs` | Retain | E2E gap: queue composition filters BankBois and sequences IDs/timestamps against replacement queues; collection eligibility is enforced before enqueue while explicit visits remain available. |
| `coordinator-queue-selection.test.cjs` | Retain | E2E gap: collection combines current mark maps without counting duplicate marks or stack quantities. |
| `coordinator-realm-actions.test.cjs` | Retain | E2E gap: realm route runs the switch service with current arrival reports and shared command allocation; home-realm changes wait for the HTTP acknowledgement before dispatching the merchant. |
| `coordinator-realm-composition.test.cjs` | Retain | E2E gap: realm composition clears prior commands before stopping headless workers and routes Steam through the primary; set-home follows the current leader and shares the command sequence. |
| `coordinator-realm-pause.test.cjs` | Retain | E2E gap: realm pause fills a missing queue timestamp without deleting unrelated commands. |
| `coordinator-realm-routes.test.cjs` | Retain | E2E gap: realm changes reject missing participants, stale reports, active BankBoi and PVP before dispatch; realm request persists its exact operation before dispatch and refuses a concurrent switch. |
| `coordinator-realm-switch.test.cjs` | Retain | E2E gap: realm switch restarts headless workers and commands only the primary Steam character; stale destination reports do not satisfy the sixty-second arrival deadline. |
| `coordinator-recovery-composition.test.cjs` | Retain | E2E gap: merchant recovery preserves an unrelated command while replacing stranded work with a sequenced ID; completed restock clears only matching ownership and persists before dispatch. |
| `coordinator-recovery-hooks.test.cjs` | Retain | E2E gap: rare recovery resets the supplied Hunt before optional quest preparation and reads current turn-in ownership; real rare-controller wiring cannot repeatedly replace a protected Daisy return with Tiny P. |
| `coordinator-reservations.test.cjs` | Retain | E2E gap: outgoing slots release reservations but preserve equipped upgrades and partial compounds; incoming reservations use exact item payload and remove empty groups only. |
| `coordinator-reserved-cargo.test.cjs` | Retain | E2E gap: reserved cargo adopts the staging row once and refreshes stack quantities; stale staging requests are removed while ordinary bank requests survive. |
| `coordinator-restart-ownership.test.cjs` | Retain | E2E gap: restart retires its own service launcher and leaves an unrelated parent alone. |
| `coordinator-restart-queue.test.cjs` | Retain | E2E gap: process restart recovers cargo and job intent once, removing only original transient fields; recovered commerce job wins exact-order deduplication without collapsing other work. |
| `coordinator-restock-completion.test.cjs` | Retain | E2E gap: restock completion totals matching stacks against both maxima; disabled targets are satisfied but missing inventory does not evaluate policy. |
| `coordinator-retained-combat-log.test.cjs` | Retain | E2E gap: appending normalized combat logs preserves legacy entries and their identity. |
| `coordinator-return-composition.test.cjs` | Retain | E2E gap: A/B recovery writes through, clears strategy and allocates cycle/Town IDs in order; Franky recovery starts the exact Mainland exit convoy and suppresses initial Town for its passengers. |
| `coordinator-roster-projection.test.cjs` | Retain | E2E gap: ownership lookup compares raw names without coercing untrusted request values; slots preserve Steam ownership, lifecycle state, empty capacity, and heartbeat boundary. |
| `coordinator-runtime-lifecycle.test.cjs` | Retain | E2E gap: generation reloads select live enabled workers and reject a replaced process; restart retains the selected replacement script when stopping rejects. |
| `coordinator-sale-routes.test.cjs` | Retain | E2E gap: mark-all reprices live copies, ignores transient stack fields, deduplicates sources and stages bank withdrawals; stale-order cleanup preserves every delivery even when stock is missing. |
| `coordinator-scatter.test.cjs` | Retain | E2E gap: first learned kill supplies farming authority before a character has a target; off-type threat suspends automatic scatter and remains until absent for three seconds. |
| `coordinator-schedule-reports.test.cjs` | Retain | E2E gap: schedule freshness and stale feed thresholds preserve strict boundaries. |
| `coordinator-scheduling.test.cjs` | Retain | E2E gap: below-threshold collection is not scheduled; capacity reserve blocks collection and resets stale signatures; pending delivery equipment resumes after restart without overwriting another command. |
| `coordinator-selected-destination.test.cjs` | Retain | E2E gap: party members use shared focus while independent empty selections remain empty; priority precedes distance and legacy zero priorities default to fifty. |
| `coordinator-settings.test.cjs` | Retain | E2E gap: gathering toggles preserve other modes, clear no-tool status, and reject stale merchant reports; merchant configuration and activity validate ownership and the active job. |
| `coordinator-snapshots.test.cjs` | Retain | E2E gap: v1 persistence keeps its exact keys and excludes transient runtime fields; settings flatten only the persisted marketplace fields and preserve cleared focus separately. |
| `coordinator-stand-control.test.cjs` | Retain | E2E gap: arrival, inventory recovery, and stand update failures are distinct from travel failure; bank-backed listing withdrawals are deduplicated across idle completions. |
| `coordinator-startup-slots.test.cjs` | Retain | E2E gap: restoration preserves Steam reservations, clears invalid slots and starts each worker once; restoration reads ownership at invocation so a Steam handoff during the delay is respected. |
| `coordinator-state-factory.test.cjs` | Trim (1 declarations) | Deletes frozen legacy implementation parity, object key order and clock-call order; keeps persisted Hunt and lucky-slot migration regressions. |
| `coordinator-status-composition.test.cjs` | Retain | E2E gap: rare ownership keeps the coordinator grouped across fighter and merchant heartbeats; market publication uses current merchant authentication and the strict hourly boundary. |
| `coordinator-status-ingestion.test.cjs` | Retain | E2E gap: bank observation deduplicates unchanged content but adopts staging before persistence on a change; local Ponty reports preserve realm keys, reject invalid offers, and do not overwrite an error-free observation on an error. |
| `coordinator-storage-controls.test.cjs` | Retain | E2E gap: vault unlocking requires floor access before gold and rejects an absent key; restock preserves defaults, explicit zero and null coercion, rejecting reversed bounds. |
| `coordinator-storage-observation.test.cjs` | Retain | E2E gap: storage startup reports carry protected withdrawals and transition the transaction exactly once; pending worker commands and unrelated characters cannot start the storage handoff. |
| `coordinator-storage-observations.test.cjs` | Retain | E2E gap: merchant observations reconcile replaced listings and persist settings before market publication. |
| `coordinator-storage-service.test.cjs` | Trim (2 declarations) | Deletes arbitrary getter evaluation order, primitive coercion matrix and restock object identity; keeps exchange queue deduplication and item identity distinctions. |
| `coordinator-telemetry-composition.test.cjs` | Retain | E2E gap: telemetry loads map data lazily, retries failed reads and caches successful definitions; map and combat routes share current ownership and preserve subscription cleanup and log identity. |
| `coordinator-telemetry.test.cjs` | Retain | E2E gap: map routes reject unknown characters and malformed frames and cache map definitions; combat logs bound batch and retention sizes, normalize values, and clear only the selected character. |
| `coordinator-travel-runtime.test.cjs` | Trim (1 declarations) | Deletes callback sequence and ordinary exception propagation; keeps timer replacement/ownership and Escape release regressions. |
| `coordinator-unselected-leader.test.cjs` | Trim (1 declarations) | Deletes transparent adapter argument forwarding; keeps absent-leader guards and convoy-history preservation. |
| `coordinator-upgrade-commands.test.cjs` | Retain | E2E gap: upgrade intent retains starting item and distinguishes equipped slots; automatic mark is idempotent for the matching target without removing manual intent. |
| `coordinator-web-services.test.cjs` | Retain | E2E gap: failed dashboard initialization reports the error and skips later services without losing the monitor. |
| `coordinator-worker-setup.test.cjs` | Retain | E2E gap: slot assignment persists first and starts only workers without an instance; script lookup failure preserves setup order and never starts a partial worker. |
| `coordinator-workers.test.cjs` | Retain | E2E gap: worker stop requests graceful termination before killing after the grace interval. |

## Next replacements

- Merchant journeys must cover stale completion, partial transfers, duplicate receipts and durable reservations before deleting the commerce/BankBoi regressions.
- Hunt/convoy journeys must cover interrupted travel, newer navigation and runtime ownership, communication loss and exhausted recovery budgets before deleting those regressions.
- Storage fault injection must cover corrupt input, writer exclusion and failed atomic replacement before deleting JSONL tests.
- Platform startup must cover native worker/CODE rollout, Steam handoff and real character processes before deleting lifecycle tests.
- Basic browser settings/Hunt journeys are intentionally insufficient evidence for removing these remaining failure cases.

The two removed pre-extraction parity cases owned the only references to `merchant-command-contracts.json` and `public-state-contracts.json`; those unused golden fixtures were removed as well. Their stale `buyUpgradeBatchSize` snapshots were discovered during the retained-suite run. Existing merchant configuration and buy-cycle cases already cover actual batch validation, restoration and consumption behavior.
