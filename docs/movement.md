# Managed movement

All dashboard-owned travel uses `runtime/movement/character/owner.ts`. The shared
JavaScript runtime retains local `smart_move`, `smart` and `stop` compatibility
names pointing to this service; they no longer run the native walker. Combat
positioning and formation detours send combat steps through the same service
(`movement.step()`). A convoy, Cave or formation recovery gate rides on its own
journey (`options.gate`): the scheduler runs it only for that journey and drops it
with the journey, and never inspects native function source.

## The module

Movement is one owner.
`npm run owner:check` holds `runtime/movement/`, `runtime/protocol/` and
`runtime/hooks/` as its folders. It fails a `move`, `smart_move` or `stop` sent from
anywhere else, and an import of movement's internals by another owner.

- `runtime/movement/api/`: the two doors another owner imports movement from.
  `character.ts` serves the character realm and pulls no coordinator module into a
  browser bundle; `coordinator.ts` serves the coordinator.
- `runtime/movement/character/`: the journey owner (`owner.ts`), the executor, the
  planner, the server corrections (`corrections.ts`), the destination names
  (`destinations.ts`), combat steps (`steps.ts`), formation and terrain recovery, the approach,
  crossings (Town, doors, leave, Blink, Magiport), errands, the movers run once per
  movement tick (`movers.ts`), the member side of a group walk (`walk-client.ts`) and
  the ring records.
- `runtime/movement/coordinator/`: the group walk ([group walks](convoy-movement.md)).
- `runtime/movement/geometry/`: step safety, route aggro, segment validation, the
  walking endpoint and interior, and the door approach and detour.
- `runtime/movement/rules.ts`: the tables. The request table has one row per request kind with its
  tier, its Steps, click and band columns and a walk's `departure`; the safe-goal table
  names the safe goals; `MOVERS` lists the core movers in their order; `sendBand` is
  the band each send asks the call budget.
- `runtime/protocol/`: what every owner may import. `ranks.ts` holds the one rank
  table (`TIERS`), `ladder.ts` the one climber, `reports.ts` the one report
  freshness rule, `hold-check.ts` whether a member can last, `records.ts` the
  request, notice and ring shapes.
- `runtime/movement/saved-fields.ts`: movement's settings and records
  (`core:movement`). A setting marked `hidden` keeps the current console's value and
  changes only with the code.

Movement publishes these rows in `runtime/hooks/registry.ts` `HOOKS` (every row whose
`part` names movement (02); `since` gives the design section that added it):
- Requests an add-on answers: `movement.request` (an add-on mover holds, steps or
  walks its character), `step.safety` (refuses a step's end point), `route.avoid`
  (names maps a route must not cross), `crossing.allows` (refuses a crossing),
  `step.point` (offers a combat step point), `formation.routine` (the
  formation entry a character picked names its point or holds it), and for its own task's group walk `walk.request`,
  `walk.departs`, `safe.goal` and `ladder.rung`. Grouped combat answers
  `group.anchor`, the member a formation centres on.
- Core requests other owners ask: `movement.followIfFar` (targeting asks a member
  with no target to walk to its leader), `movement.step`, `movement.acceptMagiport`,
  the group walk's `walks.request`, `walks.end` and `member.holder`, the heartbeat's
  `movement.reply`, the game data read `movement.gameMonsters`, and the CC reads
  `movement.formationRecovery`, `movement.independentApproach`,
  `movement.independentReadiness` and `movement.confirmIndependentApproach`.
- Reads: other owners ask the `movement.live` row for the request the character
  owner holds, `movement.climbing` for the live climb's rung, `reports.fresh` for the
  one report freshness rule, and `movement.records` and `movement.incidents` for the
  decision ring. An add-on may ask `movement.live`, `movement.climbing` and
  `reports.fresh` (`addonMayAsk: true`).
- Notices: `journey.started`, `journey.paused`, `journey.resumed` and
  `journey.ended` with its end code; `request.waiting`, `request.refused`,
  `hold.started`, `hold.ended`, `click.taken`, `ladder.climbed` and `records.saved`;
  `crossing.started`, `crossing.ended`, `step.sent` and `formation.moved`; and the
  group walk's `walk.formed`, `walk.phase`, `walk.member` and `walk.ended`.

## The movement owner

The service is the movement owner for its character . Every caller asks with a requester identity:
its row (`kind`), its owner and, for a task walk, a group walk or an add-on, the
tier of its task. `runtime/protocol/ranks.ts` holds the one rank table (`TIERS`)
and `runtime/movement/rules.ts` the rule table, and the coordinator's group walk
reads the same module, so a pair ranks the same way on both sides.

- A request against the live one is granted (a higher rank, or the Player command
  column for escape and death recovery), kept (the same owner asking for the same
  place), retargeted in place (the same owner, a new point on a clear line, no stop
  packet), waiting (a group walk or errand meeting a higher request) or refused.
  A request that waits carries the navigation revision and runtime it was asked
  under, and a revision change ends it.
- Only the holder, escape and death recovery may stop a journey. The `cave`, `lifecycle`
  and `escape` rows also let a request of their own kind stop theirs, so the Cave
  runtime, the lifecycle owner and escape release can end the journey they started
  (`stoppedBySameKind`, `runtime/movement/rules.ts` `mayStop`). Any other stop is refused, sends no
  stop packet and leaves a ring entry. Code typed in the game client passes no
  requester and ranks as `manual`, so the player's own `smart_move` and `stop()`
  win below Town, the Cave, lifecycle and survival. The owner report counts every
  such call by its call site (`ownerReport().typed`), so a console caller that lost its
  requester shows there.
- Event attendance (72) ranks above the Hunt turn-in (70) and the event return (68), so the
  party never leaves an event early to hand in. `addon-task` is the
  add-on task band; `realm-hold`, `app` and `idle` are task rows that move nobody, and
  an add-on mover may not name them.
- A requester that owns the character with no journey, such as a Town cast or a
  walk's member standing at the rally, holds it (`movement.hold`). A hold lasts two
  of the character's report intervals unless its holder asks again.
- The owner makes every movement call (`npm run owner:check` fails on one made
  elsewhere). A requester's crossing with no journey, a door (`movement.transport`),
  an instance exit (`leave`), a Town cast (`town`) or a Blink (`blink`), ranks as a hold
  of its identity, and the owner sends it; `townCasting()` counts a sent Town cast
  until the server answers, which the priest's heal guard reads. The maintenance lease
  parks the character through `movement.park()`. A requester loop, such as the farm
  reunion or a walk waiting for its member to settle, runs from the owner's scheduler
  (`movement.every`), never on its own timer. The warrior's Dash stays with turns and
  cooldowns until that owner is built.
- A click to walk in the game client is the player's command. The game asks the code page's `on_map_click` before it walks, so the
  owner hears each click: it pauses a journey the click outranks and refuses lower
  requests, holds and combat steps while the click walks and for "After my click, wait
  before taking over" after it (movement's saved setting `movementClickWaitMs`, one entry
  per character, written through `POST /party-api/settings`; a character with no entry waits
  5 s, decided by the user, 2026-10-29). Then the paused
  journey resumes by itself, and the card reads "Your click - taking over in N s" meanwhile. A new
  click starts the wait again; the Steam view's "Ignore movement clicks" stops clicks
  before the owner hears them.
- A click outranks the console's own Town cast (user, 2026-10-29): a click breaks a Town
  channel whatever the console does, so the owner recovers. The Town hold ends
  `interrupted:click`, Town requests wait for the hand-back, and the same Town request casts
  again by itself after it, with no count; the card reads "Your click - casting Town again in
  N s". The Cave and lifecycle still keep the character.
- A combat step pauses the live journey when the row's Steps column lends it, and
  the journey resumes from where the character stands when combat lets go or after
  1.5 seconds without a step. Step safety (`runtime/movement/geometry/step-safety.ts`)
  checks every step for terrain, attackers, idle aggro blocks and add-on zones; no
  combat step starts a smart route.
- A request carries a deadline and a currency test; the owner ends it as
  `expired` or `stale`, so no caller holds a dead request.
- One ladder (`runtime/protocol/ladder.ts`) escalates every requester that
  climbs: the escape walk home, the respawn rejoin and the task walks (the rare
  walk, a cut-off member's regroup, an add-on's walk). A failure moves one rung on,
  getting closer by the items owner units or reaching a new map starts the round again, and the
  last rung waits for the next report. No count ends a climb.

The movement tick (`runtime/movement/character/movers.ts`) asks the movers once per
tick in v1.5.0's order (`runtime/movement/rules.ts` `MOVERS`, which
`runtime/hooks/core.ts` registers), and an add-on mover's answer runs before the first core
mover ranked below it, or before a positioning step of its own tier (Franky's
approach and the grouped mover's coordinated target approach). A mover may answer
a hold, a step through `movement.step()`, or a walk, which climbs a task walk at the
mover's tier (`addonWalk` in `runtime/movement/character/owner.ts`). See runtime/addons/README.md.

The service records every decision, end and refused stop in a 128-entry ring with
the caller's kind and site. A death, a stuck or caught-error record, a failed group
walk and churn (10 conflicts inside 10 seconds) save a snapshot on the coordinator
(`POST /party-api/movement-snapshot`), at most 20 per character and none older than 7 days.
The diagnostics view's movement tab (`#diagnostics/movement`) lists the stuck and
caught-error records, and the card's activity line names the rung being tried.

## Planner and deployment

The coordinator runs one isolated WASM worker per retained geometry (maximum
three). The worker file, `runtime/movement/coordinator/planner-worker.ts`, adapts ALClient's prepare/getPath implementation at
`853cf80279b761ecbea238c4b3acd9caab102e11` and pins `alpathfinder@0.6.0` in the root
lockfile. Attribution and the upstream source hash are in that file. Workers
load the packaged npm WASM asset; no benchmark artifact or download is needed at
runtime. `tools/build-runtime.mts` produces `movement-planner.cjs`.

Startup and welcome/reloaded client updates prepare geometry before activating
the client. Geometry identity includes collision lines, spawns, doors and
transporter positions/places, excluding rendering decorations. Both numeric
version and fingerprint must match. Character journeys refresh their identity
when starting. Unmatched browser/pinned clients use their native planner.
Preparation failure leaves native planning available. A worker that retires on a
failure (a plan timeout, its exit or error, or a preparation timeout) starts one
replacement for the same geometry; a replacement that fails before its first plan
starts none. Past that, the geometry prepares again only when startup or a client
update delivers it; until then its plan requests fail and the characters plan
natively, so no plan request starts a worker. Queues and caches stay bounded.

Coordinator preparation must run the installed client's `process_game_data()`
from `old_common_functions.js` after loading `data.js`. Game 17083 adds collision
boxes for composed scenery during that step (four additional lines on each axis
in Main). Hashing/preparing raw data instead produced `97a531dd-24c2b1d9-218543`,
while live clients correctly reported `65911a4d-e2f70215-218667`, rejecting every
request before pathfinding. `scripts/tests/planner-geometry.test.cjs` checks that
the coordinator's geometry load runs the preprocessing and refuses raw geometry
when it fails; step the settings owner's test cut removed its live fingerprint and Main route rows.
The offline native benchmark now runs this initialization too. Startup logs the
prepared identity; mismatch errors include both requested and prepared identities.

Set `PARTY_MOVEMENT_MODE=shadow` before the supported supervisor restart to
validate and record ALClient proposals while executing native routes. The default
is `alclient`. `PARTY_MOVEMENT_MODE=native` selects native planning globally.
These modes use the same validated executor and ownership protections.

Changes affect both coordinator and character assets. Activate with
`scripts/start-console.ps1 -ProductionDashboard`, not `-CoordinatorOnly`.
See `runtime/coordinator/README.md` for restart and health verification. Building
alone does not prove that production loaded a change.

## Execution and recovery

Ordinary routes allow town warps and use actual movement speed. A group walk uses
its pace, the slowest member's base speed without conditions (walk.ts `walkPace`). Terrain recovery and the walk ladder's safe-point rung
walk only. Returned town edges are checked independently of ALClient's
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

An ALClient plan has a budget of `movementAlclientPlanMs` (2 s by default) and a
native search one of `movementPlanningMs` (30 s by default, a setting the player
sees); a requester may name its own per request. A transition that has not
completed after 12 seconds fails the try. A walking try is never cut while the
game client shows the character moving: a walk that stops short of its step sends
the step again one measured round trip later, and the try ends when that re-sent
step's round trip passes with the character still standing, or when two of its
reports show it moving with no 2-unit progress between them (executor.ts
`observeWalk`).

A failed journey climbs its own round on the one climber (`runtime/protocol/ladder.ts`
`journeyRound`): plan again from where it stands, then the native planner, then
end the journey so its requester climbs. Getting 10 units closer or reaching a new
map starts the round again. A group walk climbs its own ladder instead, and the
climb survives a coordinator restart ([group walks](convoy-movement.md)
"Recovery").

Every walk member checks an imported route itself, including the game identity.
Before and after transition barriers keep a member from a lone Town warp and keep
the party from leaving a member behind. Navigation revisions, command and runtime
identities and epochs reject stale routes and barrier messages. CODE disposal
cancels pending movement; late planner responses cannot issue actions through a
retired runner.

## Diagnostics and evidence

Fallbacks appear in game logs (Errors filter) and dashboard navigation logs. They
include character, journey ID, game version/fingerprint, failed segment coordinates,
destination, fallback decision and subsequent outcome. A diagnostic is written when it
changes and includes a repeat count. Completion metrics retain
engine, planner CPU time, request latency, elapsed journey time, walking distance,
transition count and retries; shadow records include the proposed route and its
validation issue. Latest movement metrics are also in character diagnostics.

Primary tests: `movement-service.test.cjs`, `movement-rules.test.cjs`, `convoy.test.cjs`,
`convoy-coordinator.test.cjs`, `shared-convoy.test.cjs`, `shared-walk.test.cjs`,
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
