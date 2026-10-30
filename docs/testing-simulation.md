# ChronAL gameplay E2Es

All 206 gameplay scenarios in the `live` Playwright project use the shared ChronAL clock backend by default. They retain the original browser clients, native game server, MongoDB, real HTTP and Socket.IO connections, coordinator restarts, CODE replacement, two realms, fault injection and deployment assertions. The complete default inventory remains 286 scenarios.

## Commands

- `npm test`: complete console, debug and gameplay suite.
- `npm run test:e2e:live` or `npm run test:e2e:simulation`: complete gameplay project with ChronAL.
- `E2E_GAMEPLAY_BACKEND=native npm test`: explicit real-time parity run (set the environment variable using your shell).
- `npm run test:e2e:selection`: compare every scenario identity and its allocation on both backends.
- `npm run test:e2e:benchmark`: run and archive the complete suite on both backends, verify matching selections and CODE generations, and compare externally measured wall time.
- `npm run test:e2e:benchmark -- --focused`: shorter nine-journey comparison for clock diagnostics; this does not certify the complete suite.

Node 24+, Docker and Playwright Chromium are required. Setup installs the exact ChronAL/game pins and builds the browser clock adapter automatically. Local runs default to two isolated game/database/clock pools (up to four with `--workers=4` when memory permits), assigned by Playwright parallel index; `--workers=1` selects a serial diagnostic run. Each pool uses a distinct loopback address and disposable Docker project. CI shards the same complete gameplay project across 16 runners. Native comparisons use the identical worker allocation. The native backend is available for parity checks; selecting `--project=live` alone still uses ChronAL.

## Shared clock and preserved boundaries

The network backend uses the pinned ChronAL `VirtualClock` in both game realms, the local upstream web process, the maintained coordinator, headless client VM contexts, and every real browser game/CODE frame. The original native fixture still seeds and verifies equipment, logs into the actual game and invokes the same assertion bodies. No game action, movement, damage, receipt, reward or telemetry result is synthesized.

A disposable authenticated WebSocket clock broker advances the timeline in bounded 250 ms windows (`E2E_CLOCK_WINDOW_MS` permits 25–250 ms diagnostic windows) after all current gameplay participants acknowledge the previous window. It caps the requested speed at four times real time by default (`E2E_CLOCK_RATE`, greater than 1 and at most 1024), and slows down for actual browser, filesystem and network work. Use `E2E_GAMEPLAY_BACKEND=native` for real time. Restarted coordinators and replacement CODE frames rejoin that timeline. Retired participants are removed explicitly. Native pathfinding workers join the same barrier, so their real CPU work cannot consume an artificial accelerated planning deadline. Native WebSocket closure removes terminated workers.

Browser fixtures serve the verified immutable production dashboard candidate on isolated worker ports; global setup completes a matching candidate without activating it. Browser rendering, network transport, MongoDB durability and Playwright watchdogs remain real. Gameplay Date, timers and monotonic measurements use the shared virtual timeline. The test worker observes the gameplay Date for freshness and receipt comparisons while retaining native timers and monotonic watchdogs. Gameplay polls retain their exact predicates, ownership/count assertions and original virtual deadlines, with a separate wall watchdog. Completion, persistence and published telemetry remain separate asynchronous milestones.

Compare browser request timing with `nativeWallNow()` from the network-clock helper, retaining gameplay observation timestamps separately. CPU-sliced administrative fixture work uses the clock receipt's `cpuNow()` with its original native work budget. Native renderer task entries retain their native time origin; these measurements must not be compared directly with virtual gameplay timestamps.

Node participants advance each network window from a native macrotask using ChronAL's synchronous microtask drain, then allow a native I/O turn before acknowledging it. The pinned adapter completes exact-boundary callbacks because ChronAL's public synchronous window is exclusive while the network window is inclusive; review that compatibility extension when upgrading the pin. This avoids a native event-loop hop after every virtual timer. Browser frames retain their asynchronous microtask checkpoints.

Native companion readiness uses bounded timer polling with the original predicates and deadlines. It does not depend on animation frames from a hidden iframe. Failed readiness checks retain the expected character and a fresh browser observation of its socket, CODE status and visibility.

The browser bundle adapts ChronAL's Node VM and promise-hook interfaces without editing its checkout. It dispatches full native microtask checkpoints through the same-origin top document when available, avoiding hidden-frame scheduling throttles, and drains browser promise microtasks between virtual callbacks and keeps native animation frames for actual graphics coverage. Native headless VM contexts receive the same clock through the E2E preload; the clock integration lives in the fixture preload and leaves installed caracAL sources unchanged.

The original headless standalone soak host under `tools/sim/` remains available independently. It is no longer used to replace seven selected Playwright journeys. The entire gameplay project now exercises the same browser-backed network fixture on both backends.

## Evidence and comparisons

Every gameplay test retains the usual native events, server/client state, action ledger, screenshots, traces, storage journals, and build manifest. It also attaches clock participant receipts and final clock observations. The broker diagnostic records gameplay time, elapsed wall time and participant acknowledgement lag. Assertion failures retain timestamped evidence for distinguishing delayed publication from missing or duplicated work.

Each scenario first restores the disposable account's empty native CODE inventory through the native save/delete API and verifies both its fresh API receipt and persisted database record. `E2E_SEED_BOOTSTRAP_CODES=1` fills all 100 slots before the first reset for a focused recovery check. Each scenario serves CODE from its own directory, preserving its explicit activation record across coordinator restarts without inheriting another journey's selection. Before gameplay begins, every owned client must publish the exact class hash from that scenario's staged manifest. The timing comparison verifies these retained startup receipts as well as the manifest generation.

The fixture downloads native client assets on the first coordinator start in each scenario, records their hashes, and verifies that scenario-local cache on restart. Every start still queries the real account/realm API. Writable CODE is initialized once per scenario so restarts preserve its activation updates instead of copying historical bundles again. Native-wall preparation and cache receipts are attached to the report. Completed fixture workspaces are removed after copied log evidence is saved; `E2E_KEEP_WORKSPACES=1` explicitly retains them for diagnostics.

Benchmark archives are under `.build/e2e-benchmarks/<time>/{native,accelerated}/.build/`, with `comparison.json` and `code-parity.json`. Full commands are measured outside the clocked workers using native monotonic time. Require the same selected scenarios, passing assertions and identical CODE generation before accepting a speed improvement. Reverify either archive with `npm run test:e2e:verify -- <archive-root>`.

See the [pre-implementation failure inventory](../tools/sim/FAILURE-MODES.md). A selection audit alone is not full-suite validation, and a focused comparison is not a full-suite speed measurement.

Scenario-local CODE hosts pass the built planner worker explicitly, preserving ALClient planning alongside native fallback. The departure fault fixture delays only matching real control responses with gameplay timers; it never spins on a virtual timestamp. Current early convoy arrivals remain waiting until the coordinator departure boundary without losing their ownership.

Each disconnected scenario reset also restores journaled native ambient removals made by terrain fixtures. Only original map-pack actors removed with `nospawn` are retained; temporary encounters are excluded, genuine native deaths retire their entries, and restoration uses the native constructor with exact IDs and unchanged population accounting. Reset receipts are included in the native seed artifact.

The disposable native server setup guards a verified defect in the pinned upstream Cave snapshot: resolved farewell votes can retain an NPC after its native departure clears `zone_actor`. The setup adds the missing optional guard in `cave_option_unavailable`, rejects upstream source drift, and applies identically to both clock backends. Native departure, votes, room completion and transport assertions remain unchanged. Review this compatibility extension when upgrading the game pin.

## Verified local results

The complete suite passed all **286 scenarios on both backends** with two workers: **140.7 minutes with Native time, 104.0 minutes with ChronAL** (26.1% less command wall time, 36.7 minutes saved). All 206 gameplay scenarios executed the same CODE generation; browser, debug, deployment, persistence and telemetry assertions remained enabled. Gameplay assertion bodies collectively improved by 1.77x; full command times also include setup, browser work and teardown.

| Gameplay case | Native | ChronAL | Saved |
| --- | ---: | ---: | ---: |
| Cave room completion and farewell recovery | 466.2 s | 247.6 s | 218.7 s |
| Halloween Green lifecycle | 300.6 s | 115.5 s | 185.1 s |
| Slenderman warp and death recovery | 228.7 s | 80.8 s | 147.9 s |

Full archives: .build/e2e-benchmarks/2026-10-18T02-55-34-914Z. Both full runs used software rendering; they finished unchanged before the hardware default was applied. The hardware change was then validated through a focused comparison, without another full suite.

## Browser rendering and focused CPU measurements

Local Playwright runs request hardware rendering with Chromium's `--enable-gpu` flag. CI defaults to software rendering. Set `E2E_BROWSER_RENDERING=hardware` or `software` to select explicitly; invalid values fail configuration. The browser binary, native graphics, animation frames, recording settings and gameplay assertions remain unchanged. Verify the actual renderer rather than assuming that an installed adapter is used.

The existing armadillo passing-Goo Hunt ran three times per mode, with one worker and ChronAL on both sides. All six executions passed; both reports' 298 evidence files verified. Every hardware receipt reported **NVIDIA GeForce RTX 5090 / ANGLE Direct3D11**, driver 32.0.16.1742, and complete process accounting.

| Focused browser measurement | Software (SwiftShader) | Hardware (RTX 5090) |
| --- | ---: | ---: |
| CPU seconds across three assertion bodies | 418.19 | 110.77 |
| Native elapsed seconds across those bodies | 91.74 | 83.07 |
| Average browser CPU, normalized to the 32-thread machine | 14.24% | 4.17% |

Hardware reduced the measured browser CPU rate by **70.7%**. These are browser process measurements during the assertion bodies, not whole-machine CPU, GPU utilization or full-suite GPU timings. Report directories are under .build/gpu-validation/{software,hardware}/.build/, with CPU summaries and comparison.json alongside them. See [the compact benchmark evidence](testing-simulation-benchmark.json) for exact times, source/candidate identities and archive hashes.

To repeat the focused comparison in PowerShell, run each mode with the same source and candidate, preserving the first report before the second run:

```powershell
$env:E2E_GAMEPLAY_BACKEND='simulation'
$env:E2E_MEASURE_BROWSER_CPU='1'
$env:E2E_BROWSER_RENDERING='software'
$env:E2E_EXPECT_GPU=''
npm run test:e2e -- --project=live --grep 'armadillo Hunt kills passing goos outbound and returning before claiming Daisy' --repeat-each=3 --workers=1
# Archive and verify .build/e2e-report and .build/e2e-results before continuing.
$env:E2E_BROWSER_RENDERING='hardware'
$env:E2E_EXPECT_GPU='NVIDIA GeForce RTX 5090'
npm run test:e2e -- --project=live --grep 'armadillo Hunt kills passing goos outbound and returning before claiming Daisy' --repeat-each=3 --workers=1
```

Each `browser-rendering-cpu` attachment records the actual GL renderer, GPU driver/features and native process CPU counters. Compare summed CPU seconds divided by summed native elapsed seconds. `averageMachinePercent` additionally divides by the logical processor count. Reject incomplete measurements if a baseline process exited. Clear the measurement/expected-GPU environment variables after diagnostics.

## Linux CI bootstrap metadata

Global setup verifies the completed console candidate, then passes only its app directory and immutable manifest path in E2E_DASHBOARD_CANDIDATE. Reporters read the full manifest from disk so artifact hashes and benchmark provenance remain complete. Do not serialize the full candidate into subprocess environments: the current manifest exceeds Linux's 128 KiB per-entry limit and causes E2BIG before ChronAL setup starts, even when the same run succeeds on Windows. Use the direct test:e2e npm script when forwarding project selectors through CI; nested npm test invocations can consume those flags and accidentally run all gameplay cases again in the console/debug job.

## Focused requested-rate sweep

Run `node tools/sim/e2e-rate-benchmark.mts` to double requested rates from4 until a confirmed timing plateau. It repeats the existing armadillo passing-Goo Hunt three times per rate with one hardware-rendered worker, preserving original assertions and virtual deadlines. It ranks median native assertion-body time, records achieved virtual-clock speed and browser CPU, verifies every evidence archive and fixes source/candidate identity across runs. A gain below3% triggers repeat runs of both the current best and challenger before stopping. Defaults remain4x; the higher1024x administrative ceiling supports experiments and does not enlarge the250ms shared clock window. An increased requested rate is not a guarantee of achieved speed.

### Local rate-sweep result (2026-10-18)

The existing armadillo passing-Goo Hunt passed all15 repetitions with one RTX5090 worker and the same pinned immutable console candidate, source hash,250ms clock windows and original assertions. Median native assertion-body timings were28.67s at requested4x (3 runs),22.48s at8x (6 runs), and23.60s at16x (6 runs). Eight is21.6% faster than four for this scenario; sixteen was5.0% slower than eight after repeating both rates. The confirmed plateau stopped escalation before32x. Achieved clock rates were2.22x,3.08x and3.17x respectively. Requested rate is a scheduling target; real browser/CODE acknowledgement barriers limit achieved speed. These are focused gameplay timings, not new full-suite results or evidence of100x speed. The default remains4x.

See [repeatable timing evidence](testing-simulation-rate-benchmark.json) for exact samples summary, measured candidate/source, RTX5090 identity and archive hashes. Full reports and individual receipts are retained under `.build/e2e-rate-benchmarks/2026-10-18T17-56-46-190Z/`. The later native-only timing-receipt compatibility fix does not alter the measured ChronAL branch; its final candidate is distinct from the pinned experimental artifact.

## Browser/CODE acknowledgement investigation (2026-10-18)

A native renderer CPU profile exposed synchronous recursion in combat reporting: `tick -> preparePassing -> reserve -> beginPassingAttack -> flush -> tick`. The queue client now guards synchronous tick reentry. A nested flush still invalidates the report signature and marks the client dirty; the outer tick publishes its current reservation, or the existing in-flight report completion publishes the dirty update. Admission scopes/tokens, attack eligibility, ownership and behavioral assertions are unchanged.

The same existing armadillo passing-Goo Hunt was measured with one RTX 5090 worker, real browser/HTTP/Socket.IO, identical assertions, 250 ms shared windows and unprofiled timing. The baseline used three repetitions; the optimized 16x and 32x batches each used six after plateau confirmation. Sources and immutable candidates differ for the queue guard and benchmark start-rate option; both identities are recorded.

| Queue client | Requested rate | Median assertion-body time | Achieved clock rate |
| --- | ---: | ---: | ---: |
| Before guard | 16x | 26.41 s | 2.74x |
| Guarded | 16x | 14.78 s | 4.83x |
| Guarded | 32x | 15.22 s | 4.81x |

The guard cut focused gameplay time by 44.0% and mean browser CPU work per execution by 33.6% (39.11 to 25.99 CPU-seconds). This CPU-work result is not a claim that instantaneous CPU utilization fell: the browser completes its work sooner. An after-fix diagnostic CPU profile passed with no sampled recursive queue ticks, versus 43 nested identical ticks and 9.38 seconds in recursive tick stacks before the fix. Profiling runs are excluded from timing comparisons.

MessageChannel checkpoint scheduling was slower and failed the strict clock-error assertion; a Playwright control bridge passed but was slower. Both alternatives were rejected. The retained WebSocket transport, native rendering, full per-timer microtask checkpoints, every participant and the 250 ms acknowledgement barrier remain intact. Requested 32x confirmed a plateau, so the sweep stopped before 64x; 100x achieved speed has not been demonstrated. The default remains 4x. These are focused timings, not a new full-suite estimate.

See [exact timing and profile evidence](testing-simulation-browser-benchmark.json). To repeat the guarded rate sweep starting at the previous plateau in PowerShell:

```powershell
$env:E2E_RATE_SWEEP_START='16'
$env:E2E_EXPECT_GPU='NVIDIA GeForce RTX 5090'
node tools/sim/e2e-rate-benchmark.mts
```

For one diagnostic run, set `E2E_MEASURE_BROWSER_CPU=1` and `E2E_PROFILE_BROWSER_CPU=1` with the ordinary focused gameplay command. The report retains `native-browser-cpu-profile` (loadable as a Chrome CPU profile), per-frame timing counters, and `gameplay-clock-body-timing` before/after snapshots. Receipt timestamps split approximate inbound delivery, clock advancement and acknowledgement return; sub-millisecond wall-clock skew can produce small negative transport measurements. Clear diagnostic environment variables after use.

Focused validation also passed the existing default-4x safe console reload, CODE replacement, Hunt death/respawn ownership and stop-required combat/handback cases (176 verified evidence files), followed by the original armadillo Hunt on the explicit native backend (49 verified evidence files, 57.18 s body and 1.000x observed clock). The after-fix profiling case passed with 54 verified evidence files. Typechecking ran through the normal E2E pretest. No full suite was run for this investigation. Completed candidate `659d38681a89eef72e782c1cd097ac946ef62e50afaf1f144df3501a8826160f` matches the final maintained source and is staged only; the active console was not changed.

## Slow-runner virtual deadlines and encounter staging

ChronAL observation windows and polls expire on their original virtual deadlines. A native watchdog detects 30 seconds without virtual clock progress; it no longer assumes a software-rendered CI runner achieves at least 1x speed. Native Playwright test and fixture limits remain in place. In run 39157328601, the mage test had observed only 32 virtual seconds when the old 90-second native cap fired. The offline merchant poll likewise ended before its 200-second virtual deadline and before the 180-second expiry of its actual assigned work. Both original scenarios passed locally with software rendering after the watchdog correction.

The empty saved-spawn journey starts in a genuinely targetless native map, asserts no fighter sees a living configured bird, and observes the automatically created empty-spawn recovery convoy before introducing its declared native encounter. A pre-seeded bird can enter native visibility before the 1.5-second targetless decision, legitimately causing direct combat instead of an unnecessary recovery route. The corrected staging retains automatic recovery, real native movement/damage, cohort confirmation and before-center handoff assertions. It passed with software rendering. See [the investigation evidence](testing-simulation-ci-reliability.json) and local archives under `.build/ci-shard16-focused/` and `.build/ci-shard10-corrected/`.

A final software-rendered mage run used the existing stricter 50 ms shared synchronization window: 63.85 virtual seconds advanced over 96.49 native seconds (0.662x), all 60 observation samples were retained and 55 were in range. This validates legitimate progress below native speed without reducing observation coverage. Reports and timing receipts are retained in `.build/ci-mage-small-windows/`; launch-affinity diagnostic runs are retained separately. Completed candidate `84149c6690e333230fb1726f98c5bf0dde8e2fffa78183b46edec9f5b18b4d2d` matches the final maintained source and remains staged, without changing the active console.
