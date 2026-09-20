# Resiliency refactor progress

Branch: `resiliency-refactor`. This is an implementation checkpoint, not completion
of the full “le grande refactore” plan.

## Implemented

- Extracted the 492 KB dashboard page into feature components, types, utilities,
  and a state hook. The route and console shell now compose those modules.
- Migrated inventory counts, event inheritance, compound pricing, farming areas,
  and farming geometry to strict TypeScript. Dashboard imports are native modules;
  `tools/build-shared.mts` emits CommonJS/browser equivalents for existing consumers.
- Fixed the development render failure caused by local CommonJS named imports.
- Added a typed dashboard supervisor with development mode, immutable production
  builds, input fingerprints, pre-switch health checks, previous-asset fallback,
  and an accessible Settings mode/rebuild control.
- Corrected Vinext's launch argument to `--hostname`. All build environments now
  honor the isolated output directory, avoiding Windows locks on the served build.
- Added follower routing permissions, an accessible explanation, and an equivalent
  coordinator guard installed on the next setup/launcher run.
- Added creation access from the roster picker and excluded externally online
  characters from headless-slot choices.
- Removed unused chart, drawer, and sidebar components and the empty dashboard/src.
  Outline, secondary, and ghost buttons now have explicit dark, readable defaults.
- Added strict TypeScript class entrypoints for all seven classes, shared combat
  controllers, death recovery, and a generic native loader. Removed named character
  entrypoint files. The large shared routine remains a legacy dependency.
- Added validated immutable class bundles, atomic generation manifests, selective
  reloads, disposed runner scopes, asynchronous cancellation, and acknowledged IPC.
  Syntax/build failures retain the previous published generation.
- Added reciprocal Steam/headless ownership transfer, persistent generic Steam CODE
  bootstrap, native logout, four headless slots, and the party-colored switcher.
- Fixed lost/late Steam arrival acknowledgements: a connected requested target can
  finish a previously released transfer without starting another worker. Each phase
  has its own 90-second timeout. Unconfirmed ownership remains reserved.
- Corrected the legacy dashboard `timedOut` compatibility flag to reflect an actual
  timeout failure, rather than elapsed time since a completed transfer. Covered by
  two additional serialization regression tests.
- Fixed headless combat after the lifecycle migration: the facade had discarded
  the entity receiver used by SDK `attack` and `heal`, binding both to the game
  window instead. Ordinary methods now preserve explicit receivers while saved
  functions still become unusable when their CODE generation retires.
- Extended the downloaded-engine test to assert actual attack/heal socket targets,
  self-healing, range rejection, and repeated reloads. Added follower/healing tests
  for each Steam placement; Steam ownership does not change the selected leader.
- Combat telemetry records acknowledged heals and timestamps errors. Successful
  attacks/heals clear older errors without erasing failures from newer attempts.
- Placed the Steam switcher between the bottom-center HP/MP panel and the game logs.
  It follows their bounds on resize; narrow windows move it above the logs.
- Deferred heavy dashboard dialogs until their first use. The main page chunk fell
  from 630.08 KB to 268.09 KB (gzip 189.96 KB to 78.98 KB); this is not the total app size.

## Validation

- Original baseline: 448 passing tests.
- Updated suite: 503 passing tests, including runner disposal, the downloaded game CODE engine, reciprocal
  handoffs, late arrival recovery, slot ownership, and responsive switcher placement.
- Dashboard, runtime, and build-tool strict TypeScript checks pass.
- Isolated production build passes. Both dashboard modes return HTTP 200.
- Supervisor smoke test passes: serve the previous version while building, retain
  it after an intentionally invalid build, restore source, then recover development.
- Dashboard and runtime/tool lint pass. Runtime/tool functions enforce a complexity
  limit of 10. Several dashboard components still need further complexity reduction.
- Existing source-slicing dashboard tests use a temporary module-aware adapter.
  The achievement aggregation test now imports a pure TypeScript function directly.
- The existing-checkout routing upgrade is idempotent and matches the compatibility
  patch when checked against a staged copy of the runtime. PowerShell scripts parse.

## Still required

- Split and type the 572 KB character shared routine and the repository-owned
  coordinator services. Class modules currently bundle the legacy shared routine.
- Further evaluate ALPathfinder collision semantics before any movement replacement.
  A local 7-map/7,000-segment benchmark found faster collision queries but substantial
  disagreement with native walkability; native movement remains enabled.
- Further split large extracted components/state hooks; meet the agreed complexity
  and size budgets and resolve the remaining lint findings.
- Replace the remaining source-slicing tests with module behavior tests, validate a
  clean caracAL install, and collect runtime memory/startup/reconnect comparisons.

The live caracAL runtime now uses the lifecycle, generation, and roster hooks.
GDroidPT's timed-out Steam transfer recovered to complete, with QwenTina,
GermanicHP, and GoldMajesty reporting headless. A telemetry-only GermanicHP CODE
replacement and restoration retained all three worker process IDs. Native GDroidPT
also acknowledged replacement and restoration. The switcher's geometry is covered
by DOM tests; its native Steam appearance still needs user visual confirmation.
The standalone dashboard smoke test uses port 3020 and a separate remembered mode
from the normal port 3010 instance.

Combat fix live verification: after sequential headless restarts, GermanicHP healed
GDroidPT and both GermanicHP and QwenTina recorded killing blows. After the scheduled
anniversary pause, the convoy returned to Spooky Forest and both followers resumed
acknowledged attacks with no current combat errors; GermanicHP also healed QwenTina.
GDroidPT remained the selected leader and the native Steam character throughout.

Leader-driven Hunt policy is installed: everyone receives missing hunts on Daisy
visits, but only the selected leader's quest drives missions and the three-minute
return cutoff. Completed follower quests are redeemed incidentally; unfinished
follower quests never delay the next leader assignment. A persisted turn-in owner
protects travel and claim confirmation against event preemption and leader changes.
Event movement checks coordinator permission immediately before side effects,
including anniversary travel and post-respawn joins. Live migration left follower
quests intact and advanced GDroidPT from the old waiting-expiry state into a new
croc hunt. Dashboard production is now served by the build supervisor on port 3010.
Interrupted turn-in convoys now retry after fresh party status following a coordinator
restart, preserving event protection and respecting manual navigation cancellation.
Regression coverage includes unfinished followers not blocking the next leader hunt,
claim acknowledgements, event preemption, and throttled restart recovery. Type checking
and lint pass. Live monitoring confirmed subsequent leader hunt acquisition and farming;
reward acknowledgement across the long host interruption was not verified live.

Event-return Hunt recovery now preserves anniversary/combat return ownership instead
of cancelling its convoy. Failed return barriers and persisted individual reunions
waiting for someone already at the farm recover with a leader convoy. Same-map
displacement outside a shaped hunting zone triggers a route back; completed hunts
resume straight into protected turn-in. Farm-zone retries cannot redirect Daisy
turn-ins, and fresh arrival in the farming zone clears old travel-failure diagnostics.
Eight additional regression cases pass. Live observation confirmed GDroidPT redeemed
a completed snake hunt for one monster token and acquired a new squig hunt. This
verifies a live reward cycle, not unattended overnight reliability.

Daisy departure bypasses the generic Town shortcut and hunt pathfinding cannot add
per-character Town waypoints. Coordinated Town waits briefly for skill availability,
requires an observed teleport, and returns to the assembly barrier before preparing
routes. Late Town reports therefore cannot become stale-owner preparation failures.
Five added tests cover direct Daisy departures, native pathfinding, unavailable or
interrupted Town casts, and delayed skill readiness; the existing Town barrier test
also checks regrouping. Generation `bf40f210bdba` is published locally. A complete
post-update Daisy-to-hunt departure still needs live observation.

Crab range compatibility is published in generation `cf8e1ab8a52a`. It requires a
fresh, current-target `too_far` attack rejection plus a native/server-model geometry
discrepancy. Only Tiny Crab uses the correction, with the same rectangle geometry
feeding attack eligibility and movement. Recovery expires after 30 seconds without
renewal on success, clears on selection/lifecycle changes, and disables immediately
when native dimensions agree. Rejections are throttled for 500 ms; diagnostic samples
and rejection payloads are exposed in combat runner `rangeRecovery` status. The game
entities and SDK distance functions are not modified. Ten added tests cover geometry,
expiry, upstream fixes, late responses, and controller integration; all 576 tests pass.
Type checking and role-module lint pass. Full lint still reports two pre-existing
complexity failures in hunt policy (`selection`, `retryReturn`). The live party was
hunting Cursed Goo during activation; post-update crab recovery needs live observation.
