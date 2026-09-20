# Offline ALClient comparison

This harness compares the installed native `smart_move` planner with ALClient at
commit `853cf80279b761ecbea238c4b3acd9caab102e11`. That revision wraps
`alpathfinder@0.6.0`. It is different from both the older JavaScript ALClient
implementation and this repository's existing `alpathfinder@0.5.0` collision benchmark.

From the repository root:

```powershell
npm ci --prefix tools/game/pathfinder-benchmark --ignore-scripts --no-audit --no-fund
node tools/game/pathfinder-benchmark/setup.cjs
node --test scripts/tests/pathfinder-benchmark.test.cjs
node tools/game/pathfinder-benchmark/run.cjs 16846 --smoke
node tools/game/pathfinder-benchmark/run.cjs 16846 --bounded
node tools/game/pathfinder-benchmark/verify.cjs
```

After a completed smoke run, `--bounded` performs 30 measurements and five warm-up
passes on routes whose pilot queries all took under two seconds, and three measured
passes with no additional warm-ups on slower routes/timeouts. Counts are explicit in
the report. This avoids spending hours repeating known expensive searches. The
unflagged command retains the full 30+5 plan for every route. Pilot results are not
included in measured statistics.

Only setup downloads source. Benchmark execution uses local files and isolated
child processes, never logs in or moves characters, and never imports production
entrypoints. Production package dependencies remain unchanged. Source is downloaded
under `.build/benchmarks/alclient-source` and hashes are recorded. Upstream declares
MIT in its package metadata but does not include a license file at this revision.

The optional `.build/benchmarks/config-snapshot.json` accepts `gameVersion` and
`partyLocation: {map,x,y}` from a read-only dashboard snapshot. Otherwise configured
farm fixtures are omitted. No credentials are needed. Results and plots are under
`.build/benchmarks/alclient-comparison`; `results.json` is authoritative, while the
append-only progress JSONL file may contain earlier runs. `--smoke` uses separate
output names, one cold run, and one measurement pass.

Merchant stand coordinates are read from `merchantMarketLocation` in
`characters/shared.js`; NPC positions and map spawns come from the selected game data.
For a targeted rerun, use `--routes=stand-bank,stand-potions` and a separate
`--label=merchant-check`; use the same flags for its smoke and bounded runs. This
keeps the targeted results separate from the full comparison.

Native query time includes the installed BFS and smoothing, with seeded randomness,
actual visible/hidden slice budgets, and no inserted scheduler delays. ALClient time
includes its wrapper. Preparation includes module/WASM loading. Cold measurements
use fresh processes; timing messages exclude IPC and validation. A 30-second native
VM limit and 31-second process watchdog bound searches. Run only one benchmark at a
time; the harness alternates engine order and does not run searches concurrently.

Native collision dimensions are `{h:8,v:7,vn:2}`, matching `game.js` character bases.
ALClient accepts `base` but does not forward it to its WASM planner. Returned routes
are independently checked against native geometry and transitions. Restricted and
instance access cannot be verified offline. A native final exact-position waypoint
can itself be blocked, so neither implementation is treated as a route-quality oracle.

ALClient's `avoidTownWarps` changes its internal speed to 100000. Town-disabled
fixtures reject returned town steps; do not mistake that option for identical routing
costs. Transport checks use native smart_move's conservative 75-unit approach.

Reports distinguish planning speed from estimated walking time and do not claim
measured travel improvement. Actual executor reliability, transport reach, cancellation,
convoy ownership, and combat/loot gates need a later controlled live evaluation.
