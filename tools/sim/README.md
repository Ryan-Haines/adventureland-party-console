# Party console simulation (ChronAL)

Runs the party console's coordinator and every character's real CODE against the real
game server at faster than real time, for problems that need hours of play to show up:
long travel, slow state growth, and bugs that only appear after many fights. It is a
standalone soak tool. Seven existing gameplay E2Es now also use this host through
the [accelerated fixture](../../docs/testing-simulation.md) in `npm test`; browser,
deployment and native-only journeys retain their original fixtures.

## How it works

[ChronAL](https://github.com/MtlSnkAI/chronal) boots the game's own `server.js` and one
headless game client per character on a single virtual clock: `Date`, timers and
`Math.random` are virtual, and nothing sleeps. This tool adds the party console to that
clock:

- `host/coordinator.cjs` loads `.build/runtime/coordinator-application.cjs` into a vm
  context on the virtual clock (the repository's modules run there; Node built-ins and
  `node_modules` load normally). Express is captured at `listen()` instead of opening a
  port.
- `host/caracal.cjs` replaces the caracAL modules the coordinator loads (config, account,
  game files, logging, constants). A simulation never reads the user's `.caracal` install,
  its config or its session.
- Each run compiles CODE from the working tree into a staged generation
  (`tools/game/build.mts` without `--publish`) and gives the run its own copy of that
  manifest and its class artifacts. A run never reads or writes `characters/manifest.json`:
  the coordinator runs classes from that manifest, and publishing to it reloads any live
  characters.
- `host/character.cjs` stands in for the process the coordinator forks per character
  (caracAL's `CharacterThread`): same IPC, but it logs a ChronAL client in and runs the
  CODE through the repository's own runner host (`runtime/lifecycle/runner-host.ts`).
- `host/transport.cjs` carries CODE's `$.ajax` and `fetch` to the coordinator, with
  one-way latency on the virtual clock. The captured Express app is dispatched
  synchronously, so a request takes no virtual time inside the coordinator and long polls
  wait on virtual timers like any other.
- Threaded runs (`"threads": true`, the default for the long scenario) use ChronAL's
  lockstep threads: the game server and the coordinator stay on the main thread, and each
  character (game client and CODE) gets its own thread (`host/client-thread.cjs`). The
  caracAL IPC and CODE's HTTP cross threads as lockstep sockets (`host/threaded.cjs`).
  Single-threaded runs use `host/character-worker.cjs` on the main thread instead.
- The coordinator's route planner (ALClient pathfinding, normally a worker thread) runs
  in-process: `host/coordinator.cjs` loads the same planner bundle with a stand-in
  `worker_threads`, and its messages cross at the current virtual instant. Planning takes
  no virtual time, routes match the live game, and runs stay deterministic. A scenario can
  set `"movement": "native"` to use the game's own pathfinding instead.

A run is deterministic for a given build, scenario and seed: rerunning it gives the same
timeline byte for byte. Threaded and single-threaded runs schedule cross-thread messages
differently, so they are each reproducible but differ slightly from each other.

## Use

```sh
npm run sim:setup              # Node 24+, once: pinned ChronAL + game under .build/sim/chronal
npm run sim -- tools/sim/scenarios/farm-goo.json
```

Results go to `.build/sim-results/<scenario>-<time>/`:

- `report.json`: virtual minutes, real seconds, speed, coordinator log counts, HTTP
  requests by route and status, and per character the level, XP and gold gained and
  deaths, read from the game server. `deaths` lists each death's minute, place and the
  monsters that were targeting the character.
- `timeline.jsonl`: one line per sample: what the coordinator reports for each character
  (map, position, HP, navigation state, event) and where the game server has them.
- `coordinator.log`: the coordinator's log, stamped with virtual time.
- `final-state.json`: the coordinator's full `/state` at the end of the run (combat logs,
  rare-hunt state, queues).

`SIM_PROGRESS_MS` sets how often (real ms) progress is printed to stderr.

`SIM_TRACE=<from>-<to>[,<from>-<to>...]` (virtual minutes) also writes `trace.jsonl`: every request body
CODE sends to the coordinator in that window, and the game server's view of each character
(map, position, movement, channels, conditions) at most every 250 ms. It only reads from
requests the run makes anyway, so a traced replay stays identical to the run it
investigates: replay a scenario with its seed and trace the window where something went
wrong. With `SIM_TRACE_RESPONSES=1` the trace also records the coordinator's reply to each
request in the window (large: full status replies).

## Scenarios

`scenarios/*.json`: `seed`, `threads` (one thread per character), `realm`, `minutes`,
`sampleSeconds`, `characters` (`name`, `type`, `level`, optional `over` merged into the
created character), and `steps` run at `atSeconds`: either a coordinator API call (`method`, `route`, `body`) or
`{ "action": "farm", "leader", "followers", "monster" }`, which does what the dashboard
does: formation, focus, then travel to the monster's farming area.
`{ "action": "hunt", "leader", "followers", "monster" }` starts a rare-monster hunt the
way the dashboard does (for the Phoenix, with its spawn regions in catalog order).

`track` lists monster types whose spawns and deaths the report records (`kills`: each
death's minute and its spawn-to-death time), and `expect` makes a scenario a test:
`{ "minKills": { "<type>": n }, "maxCycleMinutes": n, "maxDeaths": n, "maxErrors": n }`.
A run that misses an expectation lists it in `report.expect` and exits 1.

- `phoenix-farm.json`: three hours of Phoenix farming by a level-80 warrior and priest
  with mid-tier gear; fails on no kill, any death or any coordinator error.

## Pins and maintenance

`setup.mts` pins ChronAL **0.10.0** (`e858d3f4cc941cc5ab87b94d2e471c0fb9dfd785`)
and its three game repositories to exact commits in `pins.json`. The game revision
is shared with the native Docker E2E stack (`90052162eb3ebda36c893e1eb4af643913c8f984`). No upstream patches are required.
Setup refuses tracked dependency edits and unexpected origins, and uses shallow pinned
fetches. `install.cjs` confines upstream configuration to this checkout; on Windows it
adapts the installer's Bash copy to Node file copying and directory links to junctions.
No administrator symlink privilege or Bash installation is needed. Generated caches and
CODE use copies. The game dependency installer still needs npm and network access.
Each run rebuilds shared/runtime bundles and stages CODE from the working tree.

The host integration is adapted from [Thefonze74065's implementation](https://github.com/Thefonze74065/adventureland-party-console/tree/e67f6c702dcc8055b6e65573a282e26c63360459/tools/sim)
for [issue #58](https://github.com/Ryan-Haines/adventureland-party-console/issues/58).
Move simulator/game pins together and rerun the benchmark when upgrading.

## Local speed and replay validation

```sh
npm run sim:benchmark
# optionally supply a different bounded scenario:
npm run sim:benchmark -- tools/sim/scenarios/benchmark-goo.json
```

The default five-minute native Goo farming journey runs three times: paced at real
time, accelerated, and accelerated with passive tracing. All three must satisfy the
same gameplay expectations and produce byte-identical timelines from the same CODE,
coordinator and scenario hashes. The benchmark fails if wall time is not reduced.
`benchmark.json` records per-run simulation and full subprocess wall time (including
build/boot); `evidence.json` hashes the reports, timelines, logs and traced requests.
Results live under `.build/sim-benchmarks/`; underlying runs remain in `.build/sim-results/`.
`--paced` is a benchmark baseline for this virtual-clock host, not a measurement of
Playwright. The long scenarios remain opt-in soak coverage; this tool does not make
the unmigrated Playwright journeys faster or replace browser, Steam, deployment or live networking assertions.
Use `npm run test:e2e:benchmark` to measure the actual migrated E2Es.

Scenario API steps fail on HTTP errors. Every run requires completed virtual duration,
native players and coordinator heartbeats, no transport errors, and any declared
kill/death/error expectations. Requests have a 120-virtual-second deadline.
Verify the retained benchmark with `npm run sim:verify -- <absolute-path-to-evidence.json>`.
Historical standalone validation, before the E2E integration and game-pin alignment, on 2026-10-16 completed the default scenario in 333.75 s
paced, 63.77 s accelerated, and 69.87 s with tracing: **5.23x** full-command speedup.
All three timelines hashed to
`3ee62e21393d06540990cfab12ed52db83e362ead9ead022cca42c5dc26dbd4d`, with
205 actual Goo kills and no character deaths or coordinator errors. One accelerated
run logged a Windows `EPERM` journal-compaction deferral; the native timeline still
matched. The retained benchmark is `.build/sim-benchmarks/2026-10-16T23-14-49-354Z/`.
The separate focused console/native E2E run passed two scenarios with 46 verified
evidence files. This is bounded harness validation, not a complete native-suite or
multi-hour soak certification.

See [failure inventory](FAILURE-MODES.md).

## Limits

- Speed is bound by the CPU of the CODE and coordinator. The reference implementation reported that for two farming characters,
  single-threaded runs reach about 4x real time and threaded runs about 5-6x; the main
  thread (game server plus coordinator) is then the busiest. Idle characters run at about
  20x (single-threaded) to 35x (threaded).
- ChronAL 0.10.0 runs native `smart_move` searches in one virtual-clock turn;
  the coordinator planner is unaffected. Do not use this pin for timing-sensitive
  native `smart_move` claims (upstream's fix is unreleased).
- No dashboard, Steam runner or realm switching. ChronAL has no other players, and its own
  README notes that timing-exact numbers (deaths, damage taken, potions) can differ from live.
