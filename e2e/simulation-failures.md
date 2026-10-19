# Accelerated gameplay E2E failure inventory

Recorded before implementation. Preserve existing assertions in shared native/simulation journeys.

- Default selection duplicates or loses migrated titles, including mixed browser/gameplay files.
- Browser, deployment, restart, socket-fault, graphics, realm and real persistence tests accidentally use simulation.
- Playwright polls sleep in real time or skip brief native milestones when advancing time.
- IPC requests overlap clock runs, stop responding, lose errors, or leave owned child threads alive.
- Server/client/CODE observations are fabricated, stale, or use mismatched epochs.
- Different gear, class, quest ownership, game revision or seed invalidates the comparison.
- Server gameplay and CODE do not share the clock, or query evaluation targets the placeholder runner.
- Setup downloads needlessly, simulation starts Docker, or partial failures pass evidence verification.
- Timings compare different tests/assertions or omit fixture/build startup costs.
- Simulation skips native hit/kill, both-owner rewards, singleton membership, or arrival constraints.

Validate shared scenarios on both backends; retain exact selected titles, loadouts,
server/client observations, virtual and wall timings, logs and hashed Playwright evidence.
Use bounded polls for fresh telemetry; keep native-only coverage selectable.
