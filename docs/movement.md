# Managed movement

All dashboard-owned travel uses `runtime/characters/movement.ts`. The shared
JavaScript runtime retains local `smart_move`, `smart` and `stop` compatibility
names pointing to this service; they no longer run the native walker. Existing
combat positioning and formation detours remain local movement. Convoy gates
schedule the service explicitly and never inspect native function source.

## Planner and deployment

The coordinator runs one isolated WASM worker per retained geometry (maximum
three). `alclient-adapter.ts` adapts ALClient's prepare/getPath implementation at
`853cf80279b761ecbea238c4b3acd9caab102e11` and pins `alpathfinder@0.6.0` in the root
lockfile. Attribution and the upstream source hash are in that module. Workers
load the packaged npm WASM asset; no benchmark artifact or download is needed at
runtime. `tools/build-runtime.mts` produces `movement-planner.cjs`.

Startup and welcome/reloaded client updates prepare geometry before activating
the client. Geometry identity includes collision lines, spawns, doors and
transporter positions/places, excluding rendering decorations. Both numeric
version and fingerprint must match. Character journeys refresh their identity
when starting. Unmatched browser/pinned clients use their native planner.
Preparation failure leaves native planning available. Worker failures retry on
subsequent requests after a five-second cooldown, with bounded queues and caches.

Coordinator preparation must run the installed client's `process_game_data()`
from `old_common_functions.js` after loading `data.js`. Game 17083 adds collision
boxes for composed scenery during that step (four additional lines on each axis
in Main). Hashing/preparing raw data instead produced `97a531dd-24c2b1d9-218543`,
while live clients correctly reported `65911a4d-e2f70215-218667`, rejecting every
request before pathfinding. `planner-geometry.test.cjs` covers preprocessing,
the live fingerprint and the reported Main `(-1184, 232)` to `(-1184, 61.8)` route.
The offline native benchmark now runs this initialization too. Startup logs the
prepared identity; mismatch errors include both requested and retained identities.

Set `PARTY_MOVEMENT_MODE=shadow` before the supported supervisor restart to
validate and record ALClient proposals while executing native routes. The default
is `alclient`. `PARTY_MOVEMENT_MODE=native` selects native planning globally.
These modes use the same validated executor and ownership protections.

Changes affect both coordinator and character assets. Activate with
`scripts/start-caracal.ps1 -ProductionDashboard`, not `-CoordinatorOnly`.
See `runtime/coordinator/README.md` for restart and health verification. Building
alone does not prove that production loaded a change.

## Execution and recovery

Ordinary routes allow town warps and use actual movement speed. Shared travel uses
the slowest member's speed. Hunt walking legs and terrain recovery retain explicit
walking-only policies. Returned town edges are checked independently of ALClient's
cost preference, which does not actually prohibit town.

Every route is checked with native character-footprint collision rules. Door,
transporter, spawn and key checks precede execution. Instance/event transitions
remain owned by their existing entry/exit workflows. Unknown transitions are
rejected. Native fallback routes are also validated; an unchecked native final
point is removed only when its predecessor meets the caller's arrival tolerance.

Fishing and mining request `arrivalTolerance: 1` for their final approach;
ordinary journeys retain the 20-unit default. Precision routes append a nearby
missing final segment and collision-check it before execution, including native
fallback. Gathering verifies its settled position before casting. Its destinations
are tested against native footprint collision rules and the server's four
24-unit zone probes; the client's broader 48-unit access indicator cannot prove
that a cast is in range. See `gathering-destinations.test.cjs`.
Gathering uses coordinate distance, since the game's `distance()` measures
hitbox separation. The verified targets are Main `(-1597, 552)` for fishing
and Tunnel `(277, -96)` for mining.

Live validation on game 17083 completed both casts with normal no-item results
and cooldowns after publication. The focused regression run passed 72 tests.
Evidence: `.build/gathering-live-verification.json` and
`.build/gathering-regressions.log`.

The executor uses game move, town and transport primitives. A transition needs
acknowledgement and an observed arrival. Server arrivals can be scattered around
the advertised spawn: a separately collision-checked walking segment reconnects
to the exact route point before the party is released. Town cannot start while
the existing combat or nearby-loot checks report outstanding work.

Planning requests time out after two seconds; native searches after 30 seconds.
Five seconds without walking progress or 12 seconds without a completed
transition triggers recovery. Ordinary journeys allow two native recoveries and
stay native afterward. Convoys instead hold and regroup everyone; the replacement
shared route is native, with two regroup attempts maximum. Existing stricter
workflow deadlines still apply.

Protocol 4 clients validate imported routes individually, including game identity.
Before/after transition barriers prevent independent town warps or leaving a
member behind. Navigation revisions, command/runtime identities and epochs reject
stale routes and barrier messages. CODE disposal cancels pending movement; late
planner responses cannot issue actions through a retired runner.

## Diagnostics and evidence

Fallbacks appear in game logs (Errors filter) and dashboard navigation logs. They
include character, journey ID, game version/fingerprint, failed segment coordinates,
destination, fallback decision and subsequent outcome. Identical diagnostics are
deduplicated for ten seconds and include a repeat count. Completion metrics retain
engine, planner CPU time, request latency, elapsed journey time, walking distance,
transition count and retries; shadow records include the proposed route and its
validation issue. Latest movement metrics are also in character diagnostics.

Primary tests: `movement-service.test.cjs`, `movement-barrier.test.cjs`,
`convoy.test.cjs`, `shared-convoy.test.cjs`, `shared-walk.test.cjs`,
`merchant-convoy-interruption.test.cjs`, `client-updates.test.cjs`, and the real
`runner-engine.test.cjs` / `runner-host.test.cjs` reload tests.

Town-enabled offline benchmark:

```powershell
node tools/game/pathfinder-benchmark/run.cjs --town-warps --smoke --label=movement-town-enabled
node tools/game/pathfinder-benchmark/run.cjs --town-warps --bounded --label=movement-town-enabled
```

This retains the agreed 30 samples for routes with a sub-two-second pilot and
three for slow routes/timeouts. Results are under
`.build/benchmarks/movement-town-enabled/`. Planning measurements are not actual
travel-speed improvements. Live shadow verification exposed client decoration in
the initial fingerprint and scattered Town arrivals; both have regression tests.

## Activation verification (2026-09-19)

The supported production supervisor restart activated ALClient mode on game
16846. The dashboard reported production/ready with no error; all four characters
reported fresh heartbeats. Live execution completed an ALClient journey containing
a town warp. Shadow execution also exercised a rejected collision segment and
successful native fallback, with the coordinates visible in navigation logs.

The final focused run passed 107 tests. Typechecking, coordinator/movement lint,
production build and real runner/reload checks passed. The wider regression run
passed 2,171 tests and failed 12 account, event and UI fixtures outside this
movement change; it is not a fully green suite. No browser session was available
for visual inspection.

All 1,449 offline measurements across 26 routes were revalidated against the exact
game source hashes. ALClient's median planning time was 0.21 ms, but only 309/483
attempts passed the benchmark's complete validation, reinforcing the need for
native checks and fallback. This is a selected route corpus, not a live failure
rate. The final live coordinator handled 30 read-only Main-to-Halloween planning
requests with a 4.38 ms median and 5.92 ms p95 HTTP round trip. Those probes did not
command characters to move. Evidence: `.build/movement-live-verification.json`,
`.build/movement-final-tests.log`, and `.build/benchmarks/movement-town-enabled/`.

Managed movement supports the game's `leave` operation for Cyberland/Jail exits
into Main spawn 0. Leave is an acknowledged map transition with the same before/
after convoy barriers, settled-arrival checks, and collision-checked alignment as
transport. Other instance exits remain owned by event workflows. Rejected or timed
out leave attempts use bounded ALClient recovery (`avoidLeave` on movement-plan
requests and convoy commands), excluding the shortcut or taking Cyberland's
ordinary door if already inside. They do not themselves authorize native fallback.
