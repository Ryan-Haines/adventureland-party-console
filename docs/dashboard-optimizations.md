# Dashboard optimization validation (#17)

Baseline: `34e3ee7418223620567cfb2b26f1f4e7cb49653e` on `hunt-lifecycle-fixes`.
Run `node scripts/benchmark-dashboard-optimizations.cjs [baseline-ref]` from the
repository root. Results go to `.build/dashboard-optimizations-benchmark.json`.
The benchmark is offline and sends no game actions or telemetry to live services.

## What changed

The display-only stream rounds non-negative countdowns upward to seconds in both
`remainingMs` and nested `live.ms`. Rounding only the first field leaves the
condition changing on every sample. Both initial snapshots and incremental
telemetry use the same normalization. Authoritative status remains untouched.
Displayed countdowns can be less than one second longer than the raw sample;
condition removal, stacks, sources and other metadata still publish immediately.

Position has its own client cache, populated by SSE and fallback polling, including
map and instance changes. The map and farming-area picker subscribe independently.
Existing panels requesting complete vitals also merge position. Generation changes
replace old records; removal clears the live caches. The SSE wire shape is unchanged.

Cards and inventory receive typed, scoped models with stable event handlers.
Handlers forward to the latest committed closure, while rendering values, drafts,
validation errors and catalogs remain explicit dependencies. No incomplete custom
memo comparator is used. Status duration reconciliation keys off all timing inputs
instead of array identity. Structural sharing remains enabled.

Browser diagnostics report `utf16CodeUnits`, not falsely labeled byte estimates.
Server/benchmark bytes remain exact UTF-8 byte counts. Commit counters distinguish
position, vitals and inventory; timing samples correspond to those domains.

## Measurements

2026-09-22, Windows, Node 24.12.0. Stream replay: four synthetic characters,
six buffs each, 100 samples per character at simulated 10 Hz. Five measured runs
after warmup per workload. Mixed includes inventory changes, map/instance changes
and reconnect. Bytes include SSE framing and snapshots, excluding HTTP overhead,
map streams and character-to-coordinator traffic.

| Workload | Baseline bytes | Optimized bytes | Messages before → after | Median processing wall time before → after |
| --- | ---: | ---: | ---: | ---: |
| Idle buffs | 1,499,106 | 163,561 | 401 → 41 | 7.50 → 5.23 ms |
| Movement | 1,505,026 | 248,986 | 401 → 401 | 7.37 → 5.62 ms |
| Combat HP | 1,502,706 | 246,666 | 401 → 401 | 6.89 → 5.37 ms |
| Mixed | 1,524,838 | 268,798 | 402 → 402 | 7.91 → 6.21 ms |

Wall-time ranges (baseline / optimized) were 7.01–8.55 / 4.99–6.17 ms for idle,
7.09–7.80 / 5.45–6.08 for movement, 6.72–7.47 / 5.31–6.47 for combat, and
7.78–8.74 / 5.99–6.27 for mixed. Windows process CPU counters were too coarsely
quantized at this duration to support a separate CPU percentage claim.

Three React replays used the actual connected card, inventory, map and status
components, with visual leaf controls stubbed. Two characters were mounted.
Twenty movement updates caused 20 card render invocations before and zero after;
status renders also fell from 20 to zero, while map rendering continued. Twenty
unrelated form edits caused 40 card and 40 inventory renders before and zero after.
Validation errors and changed action closures remained current, including actions
changed during an unrelated form edit. An HP update rendered only its own card.

This has a small cache-layer cost: fifteen warmed timing samples of 2,000 writes
had median 4.90 ms before and 12.75 ms after (ranges 4.19–6.65 and 11.65–15.19 ms).
That is approximately 4 microseconds extra per write for splitting and checking
two caches. The tradeoff removes the much larger card subtree from movement
updates; these results do not prove a total browser CPU improvement. A direct
inventory update also had four render invocations after versus two before in this
test renderer, with no card render or lost update. That remaining inventory
subscription behavior is not claimed as an optimization.

## Validation and limits

Tests cover real connected render boundaries, current callbacks and errors,
countdown refresh/expiry/definition changes, nested timer normalization, immutable
source samples, Unicode counters, separate commit domains, polling fallback,
generation replacement and removal. Existing tests cover stale samples, auth
clearing, reconnect, hidden tabs, map observers and stream backpressure.

The production build and typecheck passed. Full regression validation uses
`node --test --test-force-exit` for the suite except `console-updates-auth` and
`dashboard-node-server`, which run with ordinary `node --test`: forced exit on
Node 24 Windows can crash libuv after their assertions pass. The real Caddy TLS
test can also fail transiently under parallel suite load and is rerun separately.
The final broad run reported 2,898 passes, two skips and the TLS failure; the
isolated TLS file subsequently passed all four tests. Both separately scheduled
subprocess tests passed with ordinary exit. Changed-file lint also passed.

No browser surface was exposed to this session. Physical browser interaction,
heap/CPU profiling and end-to-end latency remain unverified. Replay elapsed time
includes React test flush delays; it is not a browser frame-time measurement.

No live activation is included. Deploy coordinator and dashboard together using
`scripts/start-console.ps1 -CoordinatorOnly -ProductionDashboard`; no character
asset change is required. Rollback must restore both coordinator and dashboard.
