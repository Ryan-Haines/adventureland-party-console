# Accelerated gameplay in the E2E suite

`npm test` now runs seven existing gameplay journeys with ChronAL's virtual clock.
Their assertion bodies are shared with the native browser-client backend. The
remaining console, browser rendering, deployment, restart/persistence, transport
fault, Cave and realm-switch journeys keep their original fixtures.

The accelerated journeys cover singleton ranger authorization and sustained kills,
Ice Roamer successor kills and both rewards, Boo Boo doors/combat/Daisy return,
a completed follower quest waiting for its leader, unequal quest ownership, party
convoy arrival, and the original Goo Hunt kill/return/reward scenario.

## Commands

- `npm test`: default mixed suite, with accelerated gameplay selected exactly once.
- `npm run test:e2e:simulation`: the seven accelerated journeys only; no Docker or browser launch.
- `npm run test:e2e:live`: complete native project, including native versions of all seven journeys.
- `npm run test:e2e:benchmark`: the same seven gameplay tests plus unchanged browser-header and deployment E2Es, first natively and then accelerated.
- `npm run test:e2e:selection`: listing audit proving the default and native inventories have identical scenario counts and identities.

An explicit `--project=live` keeps native gameplay. Select `--project=simulation`
to diagnose the fast backend. `E2E_GAMEPLAY_BACKEND=native` also restores native
selection in a full suite. Browser and deployment projects remain available in
both configurations. Node 24+ is required for simulation; setup downloads missing
pinned dependencies automatically. CI runs console and accelerated gameplay,
with the simulator cached; the manual native workflow still runs the complete
native suite.

## What is accelerated

The real upstream game server, coordinator, route planner, game clients and
working-tree CODE share the virtual clock. Playwright drives serialized IPC
commands. Polls advance gameplay time instead of sleeping, retain their original
predicates and virtual deadlines, and have an independent wall watchdog. No
movement, damage, kill, reward or completion response is fabricated. Initial
level-80 `god` gear and potion/gold seeds match the native fixture, and actual
server equipment is checked before each test. Both backends consume the exact
game/common/config revisions in `tools/sim/pins.json`.

The fixture exposes only gameplay observations and synchronous CODE expressions.
It does not emulate Playwright Pages, Steam, real network faults, process restart,
MongoDB durability or native graphics. Those assertions remain native. Optional
standalone soak scenarios remain separate from test selection.

## Evidence and local comparison

Every simulation test attaches its scenario, native initial equipment, server and
coordinator observations, native hit events, process/coordinator logs, command
ledger and virtual/wall timing report to the normal Playwright evidence manifest.
Failures retain diagnostics and dispose the owned simulator process/threads.
`npm run test:e2e:verify` verifies the normal results.

The local benchmark requires exactly the same nine leaf titles and passing
assertions on both backends. It retains `.build/e2e-report/` and
`.build/e2e-results/` separately under `.build/e2e-benchmarks/<time>/{native,accelerated}/.build/`,
plus `comparison.json` with per-test, gameplay-total and full-command timings.
Reverify either archive with:

```sh
npm run test:e2e:verify -- .build/e2e-benchmarks/<time>/native
npm run test:e2e:verify -- .build/e2e-benchmarks/<time>/accelerated
```

These are measured migrated-journey improvements, not a claim that the entire
remaining native suite has been accelerated. See the pre-implementation
[failure inventory](../e2e/simulation-failures.md).

## Measured Windows result, 2026-10-16

The nine-journey comparison passed on both backends. Full `npm test` commands
fell from **585.16 s to 144.05 s (4.06x)**. Summed duration of the seven gameplay
tests fell from **372.60 s to 38.35 s (9.71x)**. The two browser/deployment tests
remained unchanged and passed on both backends. All fourteen gameplay executions
used CODE generation `fdda095e2b3b806aa318f8aaa57537dd57cc5e1fa15c53d62f1f1f7c1cccf1c8`.
The native and accelerated archives contain 331 and 207 verified evidence files.
The selection audit retained all 286 scenario identities exactly once.

Retained comparison: `.build/e2e-benchmarks/2026-10-16T23-35-37-511Z/`.
This measures the selected nine journeys, including build/startup overhead;
the complete mixed suite was not rerun for this timing comparison.
