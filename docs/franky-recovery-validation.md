# Franky recovery fixes — 2026-09-14

## Behavior

- Convoy preparation and health checks use the stable heartbeat runtime identity, with the convoy report as a compatibility fallback. Missing route reports still prevent departure, but do not masquerade as runtime replacement. Route publication uses the same identity source.
- Failed event-entry shared walks emit an ownership-checked release instead of retaining a combat-blocking hold. Failure history and exhausted retries remain retained. Persisted event-entry failures receive the same cleanup; cancellation, newer commands, and return/escape workflows retain their guards.
- Mage movement rejects steps that increase predicted monster-zone risk. Stalled approaches enter bounded, persistent local detour recovery after 1.5 seconds, including terrain-clear approaches blocked by monsters. Replanning is limited to once per second. Unsafe approaches hold with terrain/monster blockage diagnostics. A multi-tick regression reaches healing and attack range around a blocker without entering its safety zone.
- Death recovery distinguishes respawn, event re-entry, event travel, and farming continuation. An explicit retryable result retains event recovery without another respawn or accidental farming fallback. Successful joins are not repeated when only subsequent travel failed. Heartbeats retain the recovery phase, attempts, last error, and successful recovery time.

## Validation

- Initial full suite: 1,593 tests passed.
- Final current-workspace suite: 1,604 tests, 1,602 passed and two heartbeat snapshot failures caused by concurrent return-progress fields. The heartbeat fixture was subsequently updated; all six source/bundle heartbeat tests passed on rerun, including both failures.
- Final focused navigation, movement, respawn, event recovery, and restart tests: 72 passed.
- Additional affected event/party HTTP route checks: 10 passed.
- Typecheck, shared-source JavaScript syntax check, and production build passed. Existing Vinext dynamic-import warnings remain.
- Lint passes for the new recovery and navigation modules. The role runner has pre-existing complexity and explicit-any findings outside this change's logic.
- Two small type compatibility repairs were needed when neighboring event-return work changed during rollout: omit an overlapping inherited deferred-return declaration, and allow absent entries in the navigation-intent record. No route behavior changed in these repairs.

## Activation

The first supported restart attempt stopped during preflight typecheck and retained the old process. After repairing the type declarations, `scripts/start-caracal.ps1 -ProductionDashboard` successfully built, published, and restarted the services. The supervisor and production dashboard have new instance identities, and all four party slots reported online.

Steam reloads are deferred while occupied. All three combat characters subsequently reported fresh runtime identities. A real QwenTina runtime replacement during a farm-recovery walk correctly triggered a safety hold; the existing saved farming-area command was reissued once through the normal command endpoint, preserving its full location and monster selection.

After the reload, all three combat characters recorded successful ordinary attacks.

Franky was no longer marked active by rollout, so live Franky attack/re-entry validation remains pending. Do not treat simulated movement and mocked re-entry success as observed success against the live boss.
