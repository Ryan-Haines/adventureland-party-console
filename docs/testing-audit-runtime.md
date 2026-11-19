# Runtime and tooling test audit

Historical first-pass audit. The follow-up [replacement matrix](testing-replacement-matrix.md)
supersedes the retention decisions and records subsequent removals.

Scope: 246 non-coordinator test files outside the dashboard audit filename set. This inventory records a representative retained failure scenario per file; it does not claim each scenario is exercised by the new browser suite.

Deleted 1 complete test file and 5 additional source/literal-only test cases (6 test registrations total); removed 6 source-regex assertions from 3 otherwise behavioral files. Retained 245 files, including 8 trimmed files. Counts refer to static test registrations, not parameterized runtime case totals.

The browser E2E suite cannot yet replace game movement/geometry, multi-character combat, inventory conservation, interrupted transfers, Steam ownership, updater/filesystem safety or malformed external packet coverage. These existing isolated tests remain exceptions because they catch specific bugs beyond the present E2E boundary. A small test is not automatically low signal; stale-owner and wrong-item checks can prevent substantial failures. Source extraction used to execute maintained functions is different from asserting their spelling. Future replacement should reproduce the listed failure through an integrated scenario before deleting it.

## Per-file decisions

| File under scripts/tests | Decision | Reason / retained failure coverage |
| --- | --- | --- |
| `abtesting-routing.test.cjs` | Retain | Coverage absent from console E2E: team A searches toward team B on the left. |
| `account-inventory.test.cjs` | Retain | Coverage absent from console E2E: persisted bankboi inventory supersedes its duplicate or stale status. |
| `active-wtb-fields.test.cjs` | Retain | Coverage absent from console E2E: each button becomes only its own same-size input and saves just that field. |
| `anniversary-bankboi-supplies.test.cjs` | Retain | Coverage absent from console E2E: unavailable slices are distinguished from queued supplies and invalid requests are rejected. |
| `anniversary-kiss.test.cjs` | Retain | Coverage absent from console E2E: featured party checks a live combat event immediately without a thirty-second hold. |
| `auto-stand-banner.test.cjs` | Retain | Coverage absent from console E2E: Auto Stand follows item identity through bank and inventory transfers without requiring a listing. |
| `automatic-collection-client.test.cjs` | Retain | Coverage absent from console E2E: automatic pickup sends only the currently authorized unreserved quantity as kept cargo. |
| `automatic-collection.test.cjs` | Retain | Coverage absent from console E2E: selection respects disabled processing, slot uniqueness, locked items and reservations. |
| `bank-consolidation.test.cjs` | Retain | Coverage absent from console E2E: reserved transfers, incompatible properties and stack limits are preserved. |
| `bank-deconstruction.test.cjs` | Retain | Coverage absent from console E2E: mark all snapshots matching unlocked copies across bank panes and bankbois. |
| `bank-improvements.test.cjs` | Retain | Coverage absent from console E2E: shared bank stock schedules upgrades and compounds while preserving permanent bank preferences. |
| `bank-partial-stacks.test.cjs` | Retain | Coverage absent from console E2E: legacy completed buffer reservations cannot shadow later reuse of the same slots. |
| `bank-sale-copies.test.cjs` | Retain | Coverage absent from console E2E: bulk sale excludes locked, different-level and differently modified copies. |
| `bank-sort-request.test.cjs` | Trim | Removed exact caller-count/source-order case; retained authorization, cancellation, inventory recovery and restart behavior. |
| `bank-stack-routing.test.cjs` | Retain | Coverage absent from console E2E: worker duplicates converge deterministically and full stacks permit overflow. |
| `bankboi-recovery.test.cjs` | Retain | Coverage absent from console E2E: a fresh banking report protects an active cycle until its bounded deadline. |
| `bankboi-scheduler.test.cjs` | Retain | Coverage absent from console E2E: a failed merchant stop releases the transaction and restores its slot. |
| `bankboi-transfer-confirmation.test.cjs` | Retain | Coverage absent from console E2E: an unconfirmed transfer cannot issue a successful receipt. |
| `barrier-communication.test.cjs` | Retain | Coverage absent from console E2E: permanent HTTP rejection does not retry. |
| `bee-recovery.test.cjs` | Retain | Coverage absent from console E2E: every member must lose sight; one observer or one stale member prevents retirement. |
| `build-retention.test.cjs` | Retain | Coverage absent from console E2E: keeps 20 distinct complete game builds plus a pinned older current build; preview is read-only. |
| `caracal-bootstrap-recovery.test.cjs` | Delete | Removed entire file: source regexes cannot prove bootstrap failure exits or requests repair; coordinator worker behavior remains covered. |
| `caracal-game-files.test.cjs` | Retain | Coverage absent from console E2E: current game dependencies load in official order before socket initialization. |
| `catalog-startup.test.cjs` | Retain | Coverage absent from console E2E: catalog work yields before every item, does not duplicate, and becomes ready only when complete. |
| `catalog-validation.test.cjs` | Retain | Coverage absent from console E2E: missing, unknown, duplicate and changed definitions are rejected. |
| `cave-return-progress.test.cjs` | Retain | Coverage absent from console E2E: coordinator startup retains return progress and the active Town cycle. |
| `cgoo-planner.test.cjs` | Retain | Coverage absent from console E2E: reported cgoo segment is blocked in both directions with processed game 17175 and the actual character base. |
| `character-appearance.test.cjs` | Retain | Coverage absent from console E2E: appearance survives roster serialization and coordinator restart without restoring live status. |
| `character-connection-status.test.cjs` | Retain | Coverage absent from console E2E: observations accept only owned characters and support older Steam bridges. |
| `character-run-speed.test.cjs` | Retain | Coverage absent from console E2E: merchant speed includes equipment and exact set bonus; stand cannot hide added DEX. |
| `ci-regression.test.cjs` | Retain | Coverage absent from console E2E: CI rejects failures, cancellations, skips, TODOs and incomplete reports. |
| `claim-client.test.cjs` | Retain | Coverage absent from console E2E: reset rejects delayed action completion and unpaired old hit after reacquiring the same monster. |
| `class-skills.test.cjs` | Retain | Coverage absent from console E2E: every catalog level and class gate is enforced at its boundary. |
| `cleanout-item-level.test.cjs` | Trim | Removed source spelling assertion; retained level-specific cargo authorization behavior. |
| `clear-item-marks.test.cjs` | Retain | Coverage absent from console E2E: stale item request changes nothing. |
| `client-cache-updates.test.cjs` | Retain | Coverage absent from console E2E: live refresh stages complete candidates, retains old cache on failure and detects same-version changes. |
| `client-updates.test.cjs` | Retain | Coverage absent from console E2E: download or candidate preparation failure preserves running workers and active version. |
| `collection-threshold.test.cjs` | Retain | Coverage absent from console E2E: two marked slots cannot start a remote trip or retry; five can. |
| `combat-channel.test.cjs` | Retain | Coverage absent from console E2E: fast report returns receipt timing without changing the combat revision. |
| `combat-claims.test.cjs` | Retain | Coverage absent from console E2E: a first-hit collision invalidates a locked target using the latest server claim. |
| `combat-disengagement.test.cjs` | Retain | Coverage absent from console E2E: backup farming retains three neutral nominations through coordinator preparation; departure still suppresses them. |
| `combat-handoff.test.cjs` | Retain | Coverage absent from console E2E: acknowledgement received during an in-flight report follows it without another poll tick. |
| `combat-movement.test.cjs` | Retain | Coverage absent from console E2E: warrior selects and taunts a passive Porcupine without attacking, allowing grouped casters to engage. |
| `combat-queue.test.cjs` | Retain | Coverage absent from console E2E: hunt queue promotes follower nominations after death and retains three ring targets. |
| `completed-return-cleanup.test.cjs` | Retain | Coverage absent from console E2E: anniversary tick cleans a completed convoy restored as failed, allowing Hunt to resume at Daisy. |
| `compound-cost.test.cjs` | Retain | Coverage absent from console E2E: high-grade items start at the correct scroll and missing prices are not zero. |
| `compound-marks.test.cjs` | Retain | Coverage absent from console E2E: sorting preserves all three compound badges and group identity with one unchanged slot. |
| `compound-storage-behavior.test.cjs` | Retain | Coverage absent from console E2E: scheduler queues automatic storage without changing Auto bank and waits for a complete bank group. |
| `console-improvements.test.cjs` | Retain | Coverage absent from console E2E: game filters prioritize errors and retain unmatched entries. |
| `console-updates-auth.test.cjs` | Retain | Coverage absent from console E2E: updater routes require browser authorization and never accept a Steam credential. |
| `console-updates.test.cjs` | Retain | Coverage absent from console E2E: local edits preserve staged release but prohibit installation. |
| `console-version-label.test.cjs` | Retain | Coverage absent from console E2E: hosting compares the tagged source version while retaining notification-only update permissions. |
| `continuous-hunt-return.test.cjs` | Retain | Coverage absent from console E2E: a cancelled convoy cannot fake Daisy arrival, and confirmed arrival does not start another convoy. |
| `convoy-combat-handoff.test.cjs` | Retain | Coverage absent from console E2E: accepted engagement releases convoy and sends revision-bound individual recovery to late members. |
| `convoy-communication.test.cjs` | Retain | Coverage absent from console E2E: late route-ready after signal failure recovers a split Daisy return without spending retries. |
| `convoy-coordinator.test.cjs` | Retain | Coverage absent from console E2E: lost assembly command times out despite fresh stationary assembled reports. |
| `convoy-defense.test.cjs` | Retain | Coverage absent from console E2E: escape and event convoys retain their travel policy. |
| `convoy-failure-context.test.cjs` | Retain | Coverage absent from console E2E: expired matching signal produces copyable pre-cancellation context and HTTP timings. |
| `convoy-restart-recovery.test.cjs` | Retain | Coverage absent from console E2E: changed navigation invalidates the restored convoy without replacing newer commands . |
| `convoy-timing.test.cjs` | Retain | Coverage absent from console E2E: reordered full report cannot replace fast movement fields or renew freshness. |
| `convoy.test.cjs` | Retain | Coverage absent from console E2E: explicit cancellation restores cruise before ownership is cleared, only once. |
| `crab-range.test.cjs` | Retain | Coverage absent from console E2E: native behavior is unchanged until a qualifying rejection; correction and backoff agree. |
| `craft-bank-confirmation.test.cjs` | Retain | Coverage absent from console E2E: missing crafting materials still fail without changing storage preferences. |
| `craft-compound-reservations.test.cjs` | Retain | Coverage absent from console E2E: queued reservations survive moves, pause and restart; progress and cancellation release quantities. |
| `daisy-door-routes.test.cjs` | Retain | Coverage absent from console E2E: Daisy to both booboo spawns validates completely after the bounded walking repair. |
| `deconstruction-rewards.test.cjs` | Retain | Coverage absent from console E2E: dismantle rewards distinguish quantities from probabilities and retain independent bonus rolls. |
| `deconstruction.test.cjs` | Retain | Coverage absent from console E2E: automatic missing-item blocks recover one available copy without replaying uncertain work. |
| `delivery-precedence.test.cjs` | Retain | Coverage absent from console E2E: delivery reservations relocate without stealing another marked copy or reserving every duplicate. |
| `delivery-trip-settings.test.cjs` | Retain | Coverage absent from console E2E: delivery scheduling defaults on at priority 90 and preserves saved false and priority zero. |
| `departure-loot.test.cjs` | Retain | Coverage absent from console E2E: historical completed loot releases farming and cannot return through a delayed report. |
| `docker-smoke-cleanup.test.cjs` | Retain | Coverage absent from console E2E: Docker smoke cleanup waits for explicit removal: ${mode}. |
| `docker-start.test.cjs` | Retain | Coverage absent from console E2E: Docker helper reports prerequisite, build, and startup failures without claiming readiness. |
| `drop-rate.test.cjs` | Retain | Coverage absent from console E2E: fractional extra rolls, rare chances and indirect rewards retain their probabilities. |
| `duration-format.test.cjs` | Retain | Coverage absent from console E2E: duration stats respect skill milliseconds and elixir hours. |
| `emergency-cleanout.test.cjs` | Retain | Coverage absent from console E2E: a capacity-limited pickup does not request another visit once emergency clears. |
| `encounter-recovery.test.cjs` | Retain | Coverage absent from console E2E: completed osnake with a retained anniversary return hands back to quest policy. |
| `entity-refresh.test.cjs` | Retain | Coverage absent from console E2E: red target churn and movement cannot postpone phantom reconciliation indefinitely. |
| `equipment-command-delivery.test.cjs` | Retain | Coverage absent from console E2E: ${type} survives combat-only reports and polling until a full heartbeat delivers it. |
| `escape-to-farm.test.cjs` | Retain | Coverage absent from console E2E: completed manual Escape routes all three fighters to boars only after everyone has a prepared route. |
| `event-bank-recovery.test.cjs` | Retain | Coverage absent from console E2E: bank ingredients schedule merchant auto-compound without an inventory triple. |
| `event-policy.test.cjs` | Retain | Coverage absent from console E2E: leader, merchant and characters without a leader keep independent settings. |
| `event-return.test.cjs` | Retain | Coverage absent from console E2E: dedicated instance exit rejects unchanged-map success and persists a bounded retry budget. |
| `event-selections.test.cjs` | Retain | Coverage absent from console E2E: clock samples use request midpoint and reject stale responses. |
| `farm-competition.test.cjs` | Retain | Coverage absent from console E2E: all member radii must be empty, with fresh matching observations and competitor present. |
| `farm-reunion.test.cjs` | Retain | Coverage absent from console E2E: late convoy member hands off within waypoint hunt radius without walking to waypoint. |
| `farm-zone-recovery.test.cjs` | Retain | Coverage absent from console E2E: blocked unengaged target starts only one route and times out with a target cooldown. |
| `farming-areas.test.cjs` | Retain | Coverage absent from console E2E: farming location validation preserves raw input rejection and exact coordinate matching. |
| `farming-engagement.test.cjs` | Retain | Coverage absent from console E2E: early farming handoff preserves destination, authorizes neutral combat and resumes after death and loot. |
| `farming-navigation-client.test.cjs` | Retain | Coverage absent from console E2E: new cancellation stops owned farming movement and clears the cached anniversary origin. |
| `farming-navigation.test.cjs` | Retain | Coverage absent from console E2E: leader focus clear invalidates every party waypoint and preserves independent and merchant work. |
| `farming-respawn-wait.test.cjs` | Retain | Coverage absent from console E2E: old clients cannot create an inside-area return or consume the recovery cooldown. |
| `farming-zones.test.cjs` | Retain | Coverage absent from console E2E: legacy point locations retain radius fallback. |
| `fight-death-packets.test.cjs` | Retain | Coverage absent from console E2E: only explicitly lethal disappearance releases an ID, not visibility or teleport. |
| `formation-path-recovery.test.cjs` | Retain | Coverage absent from console E2E: recovery fails closed on pending attacks, aggro, stale observations, travel, cancellation and changed identity. |
| `franky-combat.test.cjs` | Retain | Coverage absent from console E2E: Franky ignores sprite metadata and closer adds, retaining a living boss with deterministic fallback. |
| `franky-exit.test.cjs` | Retain | Coverage absent from console E2E: exit assembles only remote members, even with cleared farming focus, preserving farm location. |
| `franky-recovery.test.cjs` | Retain | Coverage absent from console E2E: join failure retries, while successful teleport needs neither boss visibility nor convoy. |
| `fringe-targeting.test.cjs` | Retain | Coverage absent from console E2E: bounded zone wins exclusively; fringe is allowed only when it is empty. |
| `game-generation.test.cjs` | Retain | Coverage absent from console E2E: class generation publishes atomically, skips unchanged writes, and isolates class-only edits. |
| `gathering-destinations.test.cjs` | Retain | Coverage absent from console E2E: fishing and mining destinations are reachable and within server 24-unit range with arrival margin. |
| `gathering-equipment-restore.test.cjs` | Retain | Coverage absent from console E2E: fishing and mining restore the displaced broom without a merchant weapon mark. |
| `gathering-ownership.test.cjs` | Retain | Coverage absent from console E2E: fishing and mining retain the broom across map travel and approach, equipping only after settling. |
| `gathering-tool.test.cjs` | Retain | Coverage absent from console E2E: missing tool is retrieved from bank and included in gathering baseline. |
| `gear-comparison.test.cjs` | Retain | Coverage absent from console E2E: unchanged gear preserves reported attack speed. |
| `geometry-reload-client.test.cjs` | Retain | Coverage absent from console E2E: an old browser game build reloads the game page once, not just CODE. |
| `goobrawl-live-combat.test.cjs` | Retain | Coverage absent from console E2E: visible Brawl Goos corroborate live combat without a server event flag; empty arena does not. |
| `goobrawl-targeting.test.cjs` | Retain | Coverage absent from console E2E: goobrawl retains the current target while party telemetry catches up. |
| `grouped-cohesion.test.cjs` | Retain | Coverage absent from console E2E: missing report servers retain the legacy initial-group failure without inventing a realm. |
| `grouped-combat-coordinator.test.cjs` | Retain | Coverage absent from console E2E: completion racing a combat handoff preserves the replacement route. |
| `headless-game-logs.test.cjs` | Retain | Coverage absent from console E2E: native filters occupy the existing log height and reinstall without duplicate controls or log entries. |
| `hosting-first-run.test.cjs` | Retain | Coverage absent from console E2E: standalone development dashboard does not redirect without a public gateway. |
| `hosting-https.test.cjs` | Retain | Coverage absent from console E2E: certificate readiness probes preserve DNS SNI and verify the current no-SNI LAN fallback. |
| `hosting-lan.test.cjs` | Retain | Coverage absent from console E2E: setup detects the reachable address without exposing a Docker container IP. |
| `hosting.test.cjs` | Retain | Coverage absent from console E2E: session format accepts MongoDB and legacy account IDs without changing the credential. |
| `hover-price.test.cjs` | Retain | Coverage absent from console E2E: hover prices require an explicitly matching item level. |
| `hunt-ab-return.test.cjs` | Retain | Coverage absent from console E2E: A/B ending during protected Daisy travel preserves commands and completes directly into that journey. |
| `hunt-area-arrival.test.cjs` | Retain | Coverage absent from console E2E: spawn edge stops once, requires matching stopped acknowledgements, releases ownership without center rally. |
| `hunt-event-handoff.test.cjs` | Retain | Coverage absent from console E2E: Ice Golem ${phase} death is consumed without blacklisting or recounting. |
| `hunt-event-priority.test.cjs` | Retain | Coverage absent from console E2E: Gigacrab teleport releases travel before boss visibility without any convoy request. |
| `hunt-event-resume.test.cjs` | Retain | Coverage absent from console E2E: ${event} evacuation hands directly to current Hunt without a checkpoint detour. |
| `hunt-fallback-owner.test.cjs` | Retain | Coverage absent from console E2E: selected follower owns cutoff and reward return without changing party leader. |
| `hunt-farm-walk.test.cjs` | Retain | Coverage absent from console E2E: orphaned failed farming relocation releases expired Hunt to Daisy. |
| `hunt-geometry-roster.test.cjs` | Retain | Coverage absent from console E2E: Hunt retains its reloading member during geometry . |
| `hunt-missing-destination.test.cjs` | Retain | Coverage absent from console E2E: missing mission data remains unresolved and is retried without fabricating a waypoint. |
| `hunt-mode-reset.test.cjs` | Retain | Coverage absent from console E2E: off/on resets runtime while retaining live quests: completed=${completed}, event=${event}. |
| `hunt-retreat-restart.test.cjs` | Retain | Coverage absent from console E2E: fresh cycle retains pending loot and waits for a dead member without another reset. |
| `hunt-return-recovery.test.cjs` | Retain | Coverage absent from console E2E: explicit return retry retains native fallback and pending rewards. |
| `hunt-return-regression.test.cjs` | Retain | Coverage absent from console E2E: Hunt planning diagnostics retain both candidate failures. Removed: the movement rewrite deleted the file. |
| `hunt-return-town.test.cjs` | Retain | Coverage absent from console E2E: the first interrupted Town round selects walking, deduplicates members, and resets only after everyone changes map. |
| `hunt-route-acquisition.test.cjs` | Retain | Coverage absent from console E2E: Hunt route rejects early handoff during . |
| `hunt-route-recovery.test.cjs` | Retain | Coverage absent from console E2E: ALClient execution failure gets one native attempt, then another spawn; when every spawn has failed, the round of spawns starts over (`climbSpawn` in `runtime/hunting/coordinator/hunt.ts`) instead of holding the Hunt. |
| `hunt-safety.test.cjs` | Retain | Coverage absent from console E2E: starting Hunt follows only the leader quest without visiting Daisy for followers. |
| `hunt-selector.test.cjs` | Retain | Coverage absent from console E2E: ordinary farming without Hunt history does not show an empty Hunt panel. |
| `hunt-settings.test.cjs` | Retain | Coverage absent from console E2E: settings endpoint validates atomically, preserves disabled counts, evaluates changes and cancels pending conflict. |
| `hunt-spawn-preferences.test.cjs` | Retain | Coverage absent from console E2E: spawn patches retain other monsters and reject invalid selections atomically. |
| `hunt-temporary-encounter.test.cjs` | Retain | Coverage absent from console E2E: Poisio (-48,704) is a temporary stop on the way to (-121,1360); death and loot resume the retained spawn. |
| `hunt-travel-defense.test.cjs` | Retain | Coverage absent from console E2E: outbound party admits only one simultaneous proposal and retains it out of range. |
| `item-exchange-rewards.test.cjs` | Retain | Coverage absent from console E2E: nested tables multiply probabilities and combine identical rewards without opening awarded boxes. |
| `item-operations.test.cjs` | Retain | Coverage absent from console E2E: finish exact marked slot before another identical copy, retrying a confirmed surviving failure. |
| `loader-connection.test.cjs` | Retain | Coverage absent from console E2E: bridge download retries without another Engage, serializes requests, and respects disposal and manual stops. |
| `loot-capacity-recovery.test.cjs` | Retain | Coverage absent from console E2E: capacity recovery does not invent bank permissions for unmarked inventory. |
| `lucky-slot-tracker.test.cjs` | Trim | Removed listener-registration/report source regexes; retained packet handling, persistence and retired-runtime behavior. |
| `lucky-upgrade.test.cjs` | Retain | Coverage absent from console E2E: full bag does not prevent a swap. |
| `mail-inbox.test.cjs` | Retain | Coverage absent from console E2E: all pages are deduplicated and sent-only messages are excluded without marking read. |
| `manual-party-collection.test.cjs` | Retain | Coverage absent from console E2E: Send to party survives disabled automation and upgrades duplicate requests to manual. |
| `merchant-anniversary-reservation.test.cjs` | Trim | Removed source-only local gate case; retained lead-up boundary, round identity and live reservation failures. |
| `merchant-bank-full.test.cjs` | Retain | Coverage absent from console E2E: full bank defers only rejected deposits, preserves marks and allows improvement supply to continue. |
| `merchant-buy-cycle.test.cjs` | Retain | Coverage absent from console E2E: confirmed survivor resumes after reload without a new item or another cycle allowance. |
| `merchant-cash.test.cjs` | Retain | Coverage absent from console E2E: large purchases can exceed the reserve and low bank balance allows a partial refill. |
| `merchant-convoy-interruption.test.cjs` | Retain | Coverage absent from console E2E: merchant collection waits for communication recovery without capturing its internal phase. |
| `merchant-crafting.test.cjs` | Retain | Coverage absent from console E2E: resumed crafting retrieves only the remaining materials banked during interruption. |
| `merchant-delivery-recovery.test.cjs` | Retain | Coverage absent from console E2E: inventory rearrangement moves delivery marks without changing their durable intent. |
| `merchant-events.test.cjs` | Retain | Coverage absent from console E2E: nearby event target records attendance even without a travel leg. |
| `merchant-exchange.test.cjs` | Retain | Coverage absent from console E2E: token purchases preserve selected rewards through checkpoints and charge bundle cost. |
| `merchant-idle-return.test.cjs` | Retain | Coverage absent from console E2E: ready collection and ready gathering retain priority over stand return. |
| `merchant-inventory-stacks.test.cjs` | Retain | Coverage absent from console E2E: plans Nightberry 434 followed by Tiny Ruby 44 without moving unrelated slots. |
| `merchant-marketplace-timeout.test.cjs` | Trim | Removed source-only timeout/stop case; retained execution of blacklist classification for distinct failure codes. |
| `merchant-npc-sales.test.cjs` | Retain | Coverage absent from console E2E: durable orphan sale is runnable without a new automatic mark. |
| `merchant-party-realm.test.cjs` | Retain | Coverage absent from console E2E: offline target cannot starve eligible purchases. |
| `merchant-recovery.test.cjs` | Retain | Coverage absent from console E2E: local work waits for actual home arrival and restarts only once. |
| `merchant-rendezvous-retry.test.cjs` | Retain | Coverage absent from console E2E: rendezvous timeouts retry twice; anniversary pauses do not consume timeout retries. |
| `merchant-rendezvous.test.cjs` | Trim | Removed source-only receive/send ordering case; retained movement, stalls, cancellation, death and replacement ownership scenarios. |
| `merchant-stand-sync.test.cjs` | Retain | Coverage absent from console E2E: skipped and deferred stand sync cannot claim success. |
| `merchant-upgrade-recovery.test.cjs` | Retain | Coverage absent from console E2E: relocating a pass does not steal a survivor already owned by another pass. |
| `merchant-visibility.test.cjs` | Retain | Coverage absent from console E2E: queued, replaced, distant, stale, dead and cross-instance visits cannot reveal recipients. |
| `monster-attack-policy.test.cjs` | Retain | Coverage absent from console E2E: unknown attack stats fail closed only for requested dangerous monsters. |
| `monster-focus-route.test.cjs` | Retain | Coverage absent from console E2E: Find retains all-monsters filtering and current follower routing restrictions. |
| `monster-hunt-start.test.cjs` | Retain | Coverage absent from console E2E: reselecting stalled Hunt resumes; repeating an active Hunt selection does not cancel its convoy. |
| `monster-routing-permission.test.cjs` | Retain | Coverage absent from console E2E: only leaders and independent characters can route to monsters. |
| `monster-spawn-catalog.test.cjs` | Retain | Coverage absent from console E2E: all seven omitted monsters gain routes on unlisted maps; Pom Pom retains both regions. |
| `movement-barrier.test.cjs` | Retain | Coverage absent from console E2E: unready member, stale runtime and cancelled command cannot authorize a warp. |
| `movement-service.test.cjs` | Retain | Coverage absent from console E2E: route import refreshes and normalizes the game version, retaining strict fingerprint validation. |
| `native-host-health.test.cjs` | Retain | Coverage absent from console E2E: health checks use the native API port and retain the existing default. |
| `native-stand-client.test.cjs` | Retain | Coverage absent from console E2E: client serially places multiple native offers and preserves an occupied sale. |
| `native-stand.test.cjs` | Retain | Coverage absent from console E2E: native partial fill updates one ledger and advertisements once across duplicate, delayed and restart reports. |
| `nomination-retention.test.cjs` | Retain | Coverage absent from console E2E: client retains a visible admitted fringe target when an inside-zone monster appears. |
| `party-escape.test.cjs` | Retain | Coverage absent from console E2E: duplicate clicks reuse the active escape and stale landing reports cannot advance it. |
| `party-loader.test.cjs` | Retain | Coverage absent from console E2E: missing shared dependency fails before installing any combat timers. |
| `party-status-diagnostics.test.cjs` | Retain | Coverage absent from console E2E: status timing records actual response receipt and failure without extra requests. |
| `passing-admission.test.cjs` | Retain | Coverage absent from console E2E: missing acknowledgement skips repeated optional shots without surrendering the travelling handle. |
| `passive-healing.test.cjs` | Retain | Coverage absent from console E2E: only an acknowledged heal publishes success telemetry. |
| `passive-hunting.test.cjs` | Retain | Coverage absent from console E2E: legacy selections migrate; independent edits preserve selections and keep moving defaults off. |
| `passive-rare-queue.test.cjs` | Retain | Coverage absent from console E2E: actual coordinator snapshot retains a rare-owned queue and all clients derive its targeting rings. |
| `pathfinder-benchmark.test.cjs` | Retain | Coverage absent from console E2E: query watchdog times out and removes listeners without swallowing worker failures. |
| `phoenix-patrol-regression.test.cjs` | Retain | Coverage absent from console E2E: stationary successful-but-wrong convoy completions cannot loop forever. |
| `planner-geometry.test.cjs` | Retain | Coverage absent from console E2E: preprocessing failure never silently returns raw geometry. |
| `player-npc-sales.test.cjs` | Retain | Coverage absent from console E2E: stale deconstruction slots cannot suppress NPC pickups for replacement items. |
| `ponty-market.test.cjs` | Retain | Coverage absent from console E2E: identical items group across realms and quantities but not stats. |
| `ponty-order.test.cjs` | Retain | Coverage absent from console E2E: stale stock rejects atomically without creating partial purchase jobs. |
| `porcupine-equipment.test.cjs` | Retain | Coverage absent from console E2E: highest upgrade bow, retained through target changes and holds, exact loadout restored on departure. |
| `priest-absorb-sins.test.cjs` | Retain | Coverage absent from console E2E: legacy priest hook delegates to the live leader policy without the old HP cutoff. |
| `priest-formation.test.cjs` | Retain | Coverage absent from console E2E: Default defense requires one shared target; local attackers cannot nominate independently. |
| `production-journal.test.cjs` | Retain | Coverage absent from console E2E: lost completion reply retries its durable receipt without executing the game operation again. |
| `production-reconciliation.test.cjs` | Retain | Coverage absent from console E2E: production inspection is read-only and explicit unknown resolution survives replay and late completion. |
| `public-handoff.test.cjs` | Retain | Coverage absent from console E2E: completed transfers never expose stale timeout flags to older dashboards. |
| `queue-markers.test.cjs` | Retain | Coverage absent from console E2E: snake Hunt to Phoenix cancellation resumes one queue and both marker displays without resetting CODE. |
| `rare-farming-return.test.cjs` | Retain | Coverage absent from console E2E: rejected return dispatch survives serialization and retries. |
| `rare-hunting-client.test.cjs` | Retain | Coverage absent from console E2E: active assistance permission survives the first grouped fight handoff but expires with its revision or heartbeat. |
| `rare-hunting-settings.test.cjs` | Retain | Coverage absent from console E2E: invalid passive settings are rejected without changing saved preferences. |
| `rare-hunting.test.cjs` | Retain | Coverage absent from console E2E: sightings on another realm and claimed Fairy do not acquire; outsider Phoenix is rejected. |
| `rare-retry-evidence.test.cjs` | Retain | Coverage absent from console E2E: rejection receipts project heartbeat positions and migrate bloated saved receipts without reopening pursuit. |
| `recipe-wtb-level.test.cjs` | Retain | Coverage absent from console E2E: full stand replacement shows catalog sprites and retains selection until confirmed. |
| `recovery-route.test.cjs` | Retain | Coverage absent from console E2E: recovery routes around monster clearance instead of planning through it and failing while walking. |
| `respawn-recovery.test.cjs` | Retain | Coverage absent from console E2E: an unanswered respawn releases its latch and retries without concurrent attempts. |
| `return-planner.test.cjs` | Retain | Coverage absent from console E2E: a rejected Town candidate still permits a valid walking route. |
| `roster-routes.test.cjs` | Retain | Coverage absent from console E2E: selection-screen bridge readiness permits a headless transfer without claiming a connected character. |
| `routine-separation.test.cjs` | Retain | Coverage absent from console E2E: migration retains zeroes and explicit new values; split legacy work keeps allocations with crafting. |
| `runner-engine.test.cjs` | Retain | Coverage absent from console E2E: downloaded game and CODE engines survive repeated runner disposal on one socket. |
| `runner-host.test.cjs` | Retain | Coverage absent from console E2E: real JSDOM CODE replacement keeps the game context and retires old windows. |
| `runner-lifecycle.test.cjs` | Retain | Coverage absent from console E2E: game methods preserve explicit entity receivers and revoke saved bound functions. |
| `scatter-evidence.test.cjs` | Retain | Coverage absent from console E2E: scatter accepts rejection of an existing action and preserves its original identity after travel. |
| `shared-convoy.test.cjs` | Retain | Coverage absent from console E2E: geometry mismatch holds everyone and reloads only affected runtime after hold acknowledgements. |
| `shared-merchant-rules.test.cjs` | Retain | Coverage absent from console E2E: migration gives merchant precedence, imports unique rules and preserves manual requests. |
| `shared-walk.test.cjs` | Retain | Coverage absent from console E2E: runtime reload cancellation preserves the geometry repair convoy. |
| `smart-loot.test.cjs` | Retain | Coverage absent from console E2E: full bags still open gold chests after earlier item and generic loot failures. |
| `solo-hunt.test.cjs` | Retain | Coverage absent from console E2E: simultaneous pickups use separate cycle IDs and commands; unrelated quests cannot bypass solo blacklist. |
| `sprite-center.test.cjs` | Retain | Coverage absent from console E2E: visible sprite bounds center without resizing, ignoring transparent frame padding. |
| `stand-capacity.test.cjs` | Retain | Coverage absent from console E2E: stand capacity reserves explicit buys and releases paused sales and automatic buys. |
| `stand-inspection.test.cjs` | Retain | Coverage absent from console E2E: only placed buys count, not pending explicit reservations. |
| `stand-level-prices.test.cjs` | Retain | Coverage absent from console E2E: missing history and legacy observations without levels cannot supply a price. |
| `starting-appearance.test.cjs` | Retain | Coverage absent from console E2E: starting choices retain native renderer geometry and never mutate official cosmetics. |
| `steam-bridge.test.cjs` | Retain | Coverage absent from console E2E: v2 bridge starts background CODE without navigating or disconnecting primary. |
| `steam-desktop.test.cjs` | Retain | Coverage absent from console E2E: setup preferences survive restart; remote, browser and unknown placement cannot launch. |
| `steam-group.test.cjs` | Retain | Coverage absent from console E2E: restoring Steam companions is not blocked by an untouched headless merchant. |
| `steam-handoff.test.cjs` | Retain | Coverage absent from console E2E: Steam switch reciprocally transfers the target slot only after confirmed native release. |
| `steam-realm-choice.test.cjs` | Retain | Coverage absent from console E2E: unknown realms explain detection and offer enabled cancellation; Escape also cancels. |
| `steam-recovery.test.cjs` | Trim | Removed literal bootstrap-string duplication; retained executed bootstrap/recovery and saved-code preservation scenarios. |
| `successor-handoff.test.cjs` | Retain | Coverage absent from console E2E: locked red/yellow survive distance changes while third is optimized and acknowledgements survive. |
| `tracktrix-bonuses.test.cjs` | Retain | Coverage absent from console E2E: Tracktrix totals only unlocked stat rewards and prefers reported stats. |
| `tracktrix-refresh.test.cjs` | Trim | Keeps only its dashboard score test. The call budget owner moved the Tracktrix request into runtime/characters/call-budget-reads.ts, so the two tests that ran shared.js's request code went; e2e/call-budget-rows.ts row A checks their retry, inventory and silent render goals. |
| `travel-defense-client.test.cjs` | Retain | Coverage absent from console E2E: travel rejects a passive retained bee but allows a current follower attacker; grouped=. |
| `travel-defense.test.cjs` | Retain | Coverage absent from console E2E: visible historic fight and recent outgoing evidence do not block normal travel. |
| `ui-cleanup-behavior.test.cjs` | Retain | Coverage absent from console E2E: only follower mode saves use the preference route; merchants and inherited settings stay protected. |
| `unfinished-target-boundary.test.cjs` | Retain | Coverage absent from console E2E: exact unfinished monster remains eligible outside farm bounds and focus. |
| `unified-return.test.cjs` | Retain | Coverage absent from console E2E: new map still under aggro stays walking; missing observations never mean clear. |
| `unseen-primary.test.cjs` | Retain | Coverage absent from console E2E: invisible engaged Tiny P yields to visible Ghost after bounded fresh absence, outside last-position coverage. |
| `upgrade-offering-recovery.test.cjs` | Retain | Coverage absent from console E2E: surviving failed manual attempt with a lost completion response consumes exactly one offering. |
| `upgrade-offerings-client.test.cjs` | Retain | Coverage absent from console E2E: auto +9 stops at +8 without required primling and preserves unfinished work. |
| `upgrade-offerings.test.cjs` | Retain | Coverage absent from console E2E: stock counts merchant and bank only, excluding locked and reserved quantities. |
| `upgrade-preview.test.cjs` | Retain | Coverage absent from console E2E: all four previews use calculate=true and preserve items, quantities and item grace. |
| `upgrade-scroll-batch.test.cjs` | Retain | Coverage absent from console E2E: three requested +8 shoes stock 21 normal and one high, not all five inventory shoes. |
| `warrior-porcupine.test.cjs` | Retain | Coverage absent from console E2E: Porcupine pull respects ownership, mana, cooldown, and Taunt range. |
| `warrior-stomp.test.cjs` | Retain | Coverage absent from console E2E: cooldown, insufficient MP, unusable skill, scatter, stale/distant party and empty range do not cast. |
| `worker-lifecycle.test.cjs` | Retain | Coverage absent from console E2E: old worker exit cannot mark the replacement offline or destroy its monitor. |
| `wtb-priority.test.cjs` | Retain | Coverage absent from console E2E: WTB overrides apply to Ponty, local and world merchants; automatic sources share a default and manual purchases retain theirs. |

## Real game server boundary

The [upstream setup](https://github.com/kaansoral/adventureland_mongodb#quick-start) requires the game repository, common_engine, secretsandconfig, a MongoDB instance and map seeding, then separate backend and game-server processes. Account and character records are created separately. The console browser suite does not establish live game-server compatibility; pinning and provisioning that server plus disposable player data is future work.
