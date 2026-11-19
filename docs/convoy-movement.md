# Group walks

Movement owns every walk that moves more than one character together. The coordinator side is
`runtime/movement/coordinator/`, the member side is `runtime/movement/character/walk-client.ts`, and
both read the rule tables in `runtime/movement/rules.ts` and the shared protocol in
`runtime/protocol/` (ladder, report freshness, ranks, records, hold check). [movement](movement.md) describes the
character's own journeys.

| File | Holds |
| --- | --- |
| `coordinator/walk.ts` | the one walk machine: start and replacement, the event and return walks, assembly, the shared route's phases, the ladder climb, the restart recovery, the continuous return and the walk notices |
| `coordinator/route-store.ts` | the shared route, its departure and arrival checks, and the walk's types |
| `coordinator/defense.ts` | the `defending` and `communication-hold` phases and the merchant pause |
| `coordinator/arrivals.ts` | the arrival checks and each walk's destination |
| `coordinator/routes.ts` | movement's HTTP routes and the heartbeat's movement fields |
| `coordinator/runtime.ts` | the install: the travel clock, the planner geometry, the step of every group's walk, and core:movement's answers to `walks.request`, `walks.end`, `walks.estimate`, `member.holder`, `movement.reply` and `movement.gameMonsters` |
| `character/walk-client.ts` | the member side: commands in, the departure gate, the defense pause, reports out |

## The walk's rules

These are the walk's rules. The walk
infers nothing from silence and ends no phase on a round of reports or a silence timer; the
Hunt walk's fixed ends under "Recovery" stay until the hunting owner takes the walk over.

- **Delivery is confirmed by acknowledgement.** A walk command stays the member's command until
  that member's report acknowledges its id. The heartbeat reply carries the walk's command
  (`party-monster-travel`, kept in the command slot of `runtime/status/coordinator/reply.ts`) on
  every reply until the walk replaces it, and the character applies an id once. A lost message
  is therefore sent again on the next reply; the walk never counts the member as not walking
  because of it. A member whose reports stop for two of its report intervals meets movement's own
  `runtime-lost` rule (walk.ts `leaves`, reading `reports.fresh`), so the walk lets it go in any
  phase and the member catches up through its own task once its runtime reports again.
- **The holding owner answers for a member.** A member that is not walking is held by a named
  owner, and the walk asks the `member.holder` hook ("Holders" below). It waits on a member
  whose holder says it is coming and goes on without one whose holder says it is not.
- **No round or silence timeouts.** Each member that is not where the walk needs it is in one of
  four states: its command is not acknowledged (the reply resends it), a named owner holds it
  (the holder answers; a member that has the command and does not follow it names its holder in
  its own report, `commandHold`), it is acknowledged and not held but does not move (its own
  walking try stalls and the walk's ladder climbs), or it has arrived (the walk counts it). A
  member whose reports stop is let go, so the walk never waits on silence.
- **Loot before leaving, except an escape.** Every walk waits for its members' chests before it
  departs; only the escape leaves fight and chests at once (the `departure` column, below).
- **Passive "stop" rules hold on every walk.** A passive monster set to "stop" stops any Hunt or
  farming walk, the walk to Daisy and backup travel included, and the walk resumes after the
  fight. A rare still cancels a Hunt walk with no target, and the Hunt restarts it.

## Lifecycle

1. The walk takes each member with a hold at the walk's tier, the tier of the task that started
   it (`requester`), and sends no follower search. The hold lends the standing member to combat
   steps; the walk's own journeys replace it under the same identity. Phase `assemble`.
2. Members walk to the rally. The rally ends when every member has arrived or is held by an
   owner whose answer says it is not coming. A member's walking stall climbs the walk's ladder.
3. Phase `shared-prepare`. The leader alone searches the destination and publishes one route
   payload; followers fetch it once per version, check their connection to the origin, copy the
   queue and report `routeReady` with the route version. A member may stand anywhere within the
   55-unit rendezvous range (`RENDEZVOUS_RANGE`) of the rally and departs from where it stands
   .
4. The walk departs on one ready report per member that acknowledges the walk's current command:
   route installed, standing still, in range, moving at the walk's pace (route-store.ts
   `readinessIssue`, rules.ts `cruisePaced`). A report from before the command does not count.
   The walk then sets phase `travel` at once, and each member departs on the first reply
   that carries it (a member's departure counts when
   its report reads before the walk's start by no more than the member's measured clock
   difference (route-store.ts `departed`, protocol/reports.ts `reportClockError`).
5. The game's native walker carries each member. Town and transport waypoints stay native
   operations. The walk ends `arrived` when every member reports arrival.

### Departure: chests and the fight

The request table's `departure` column (rules.ts `walkDeparture`) names what a walk waits for before it leaves,
and the member's departure gate and the coordinator's readiness both read it.

- `after-loot`: the walk waits for its fight and its chests. Every walk not named below.
- `loot`: the walk leaves the fight and waits for its chests. The Hunt return, the other
  continuous returns (anniversary staging, the Halloween exit), the Hunt's travel to a named
  target and the event exit.
- `now`: the walk leaves fight and chests at once. The escape alone.

The executor's own loot wait at a map change reads the same column, so only the escape skips it
(walk-client.ts `sharedMovementOptions`, `skipLootWait`). Each wait judges
progress from the member's own reports (rules.ts `departureStep`): its attackers' summed HP or its
chest count falling. A member whose chest count stops falling is left to follow the party; a fight
that stops falling climbs the walk's ladder.

### Pace

The walk sets each member's cruise cap to its pace ):
- The pace is the slowest member's base speed (walk.ts `walkPace`): each member reports
  `baseSpeed`, shared.js `unrestrictedRunSpeed` without its conditions term, so Hard Shell, a
  stand, a slow or a cap still in force never sets it. Each walk step re-paces from the reports,
  and each signal carries the pace, which the member's cap follows (walk-client.ts
  `repaceConvoy`); a walk resumed after a defense pause begins at the pace of now.
- A member counts as paced when its reported speed is the pace within 0.1 (rules.ts
  `cruisePaced`), so the walk departs with every member at the pace.
- A runtime with no walk and no live walk lease resets a cap it finds: one a hand-over kept, or
  one a CODE reload left, seen as a speed below its base speed with no stand, dungeon run or
  speed condition (walk-client.ts `clearStrayCruise`).
- live-movement-owner's farm walk row starts the walk under Hard Shell and checks each travel
  sample's speed against the pace.

## Holders

`member.holder` is a core request hook declared in `runtime/hooks/registry.ts`, answered by many.
Each holder answers for its own holds only, with `{ owner, reason, coming, endsOn }`: `coming`
false lets the walk go on without the member, and `endsOn` names the holder's notice that ends the
hold. The walk reads the answers again when that notice fires and on each fresh report of the
held member. When several owners hold one member, the walk goes on without it if any answer says
not coming, and otherwise waits until every hold has ended.

| Holder | Holds | Answer at this head |
| --- | --- | --- |
| survival | dead, reviving, escaping | built-in answer: a dead member (`rip`) is not coming, so the party never waits for a dead member; the revived member catches up on its own |
| events | attending or returning from an event | built-in answer: coming, except for the walk to the event the member attends and that cycle's event return, which the walk's ask names (`activity`, `key`) and which answer nothing |
| lifecycle | paused, loading | built-in answer reads the report's `consoleMaintenance`: paused or loading is coming, and under the Pause the whole party is held. A member whose reports stopped is movement's own `runtime-lost`, not coming |
| tasks | a task wind-down: the live trip, the fight's finish, the event healer | the tasks owner's `core:tasks` answers an event walk's start (runtime/tasks/coordinator/wind-down.ts `windDownHolds`): the live trip and the group's fight hold a member coming until the attendance cut-off, and the healer is not coming from the cut-off on; `endsOn: 'task.ended'` |
| movement | manual control (a live `manual` or `unattributed` request) | ends on `journey.ended` |

A built-in answer ends on `endsOn: 'report'`, so the walk re-reads it on each fresh report.

**The event start** works the same way. The walk sends its command to each eligible member that
has not asked and has no holder, delivery confirmed, and the acknowledging report is that
member's ask. It waits for a member whose holder says coming, whichever owner holds it, and goes
on without one that says not coming. The walk takes over a live trip only while the group's
`walk:event` answer allows it, which the tasks owner holds false while the trip winds down. The one time bound
left is that the party reaches an event no more than 60 s after its spawn,
and the tasks owner's wind-down answer applies it (`runtime/tasks/coordinator/wind-down.ts` `attendanceCutOff`).

## Recovery

A route failure climbs the walk's own ladder (`runtime/protocol/ladder.ts` `walkRound`):
`replan` (the shared route under a new epoch), `other-route` (the native planner, without Town
or the leave transition), `rebuild` (regroup at the leader), `safe-point` (walk every member to
Main's Town landing and start again there, `rallyWalking`), then `wait` (the next report from
every member, then a new round). The leader getting 10 units closer or reaching a new map starts
the round again, and no count ends a climb. The walk keeps the climb on the convoy (`ladder`,
`ladderRung`, `ladderTrying`), so a coordinator restart resumes it, and the card's activity line
names the rung.

The failure-code table names what each code does:
- `route-failed`, `town-unavailable` and `town-interrupted` climb; a failed Town turns Town off
  for the walk (`disableFailedTown`).
- `owner-lost` ends the walk `replaced`, and the task asks again.
- `realm-lost` climbs. `runtime-lost` lets a member whose reports stopped go. At a walk's start, every
  walk, a Hunt route's included, lets a member on an old runtime or another server go as
  `rule:T5` and goes on without it, and the member catches up through its task.
- `geometry-mismatch` asks the affected runtimes to reload once and waits while they progress: it
  fails when a member's report after its reload signal still names its old runtime, or its reloaded
  runtime reports a game geometry other than the expected one.

A walk a Hunt route owns ends on the rules every other walk uses (the walk rules of this section): its own progress and its ladder, with no Hunt-only timeout.

The regroup hold (`shared-hold`) ends when every member's report acknowledges the hold, standing
still, or a holder says the member is not coming. A walk that stopped for monsters it walked into
fights them, runs its loot pass, and goes on as the same walk: in the phase it stopped in, or
planning again from where the leader stands. A fight the party cannot win
(`runtime/protocol/hold-check.ts`) is not the walk's; survival decides any escape.

Report freshness has one rule (`runtime/protocol/reports.ts`). A walking member's report stays
fresh for two of its own report intervals while no attacker is known on it, so the walk keeps
going through a late report; with an attacker known, the `reportFreshMs` age applies, 3 s by
default. A member whose reports stop past that age is let go (`runtime-lost`); a gap that
stays within it, such as a lost coordinator reply, holds the walk in `communication-hold` until
fresh reports return.

A lost realm, lost navigation ownership and stale reports hold travel; a member whose reports
stopped leaves the walk. Explicit cancellation
and newer commands never resume the old route. A new walk replaces the active one only when the
rank table grants it on a member or the same task asks again, so an event return outlives a lower
walk's request. The realm switch ends a group's walk through `walks.end`.

## Published surface

Movement declares these in `runtime/hooks/registry.ts`:
- Requests: `walks.request` (an owner starts a group's walk at its tier; a lower ask is
  refused; runtime.ts `requestWalk`), `walks.end` (the realm switch ends a group's walk) and
  `member.holder` (above).
- Add-on requests, each answered for the add-on's own task walk (purpose `addon:<name>`) only:
  `walk.request` names the walk on each walk step (walk.ts `addonWalk`), `walk.departs` holds
  its departure, and `safe.goal` names the point the walk restarts from (walk.ts
  `safePointOf`). The readiness and assembly progress tests still end a departure hold that
  makes no progress.
- Notices: `walk.formed`, `walk.phase`, `walk.member` (`completed` or `left`, with code `died`
  for a member whose life, the survival owner's `survival.life`, passed the one the walk admitted) and
  `walk.ended` with its code. A walk request from an earlier life is refused `stale` (1.5 row 6). The walk machine fires each at the transition that makes the change (walk.ts
  `formWalk`, `walkPhase`, `completeMembers`, `walkEnds`). `ladder.climbed` tells each rung
  the walk moves to, with what it tries (walk.ts `climbRung`).

## HTTP routes

- `POST /party-api/convoy-route` accepts a publication only from the current leader;
  `GET /party-api/convoy-route` serves current participants. Both bind the walk, epoch, route
  version, command, navigation revision and runtime. Payloads are bounded to the items owner,000 waypoints
  and 900,000 serialized characters and checked before storage.
- `POST /party-api/shared-travel` coalesces workflow walking requests (event, Town and return
  walks) and returns their completion state.
- `/party-api/movement-barrier` answers a member's transition barrier, and
  `POST /party-api/convoy-complete` takes a member's arrival.

The route store is an ephemeral WeakMap keyed by the walk. Waypoint arrays do not enter retained
commands, status heartbeats, dashboard snapshots, SSE or TanStack Query; only identities,
readiness and diagnostic fields use the control channel.

## smart_move audit

The owner makes every movement call (`runtime/movement/character/owner.ts`), and
`npm run owner:check` fails a call made elsewhere. Each requester names its row in the rank table
(`runtime/movement/rules.ts`), so a lower request waits or is refused, and no request reads another
family's flags.

| Requester family | Policy |
| --- | --- |
| Party travel API, selected farming, Hunt, rare and patrol walks, return walks | The group walk; ordinary and forced party travel keep their combat behaviour. |
| Event approach and rejoin, anniversary staging, Town and event return walking, full-party farming recovery | Coalesced workflow walking; event join and leave, Town casts and completion callbacks keep their owners. |
| Goobrawl Transporter approach | Shared for an event-return command; the escape stays independent. |
| Assembly and route preparation | The leader alone searches the destination; a follower searches only for the rally. |
| Follow the leader, survivor reunion | Individual walks at `follow` and `farming`; a group walk outranks them. |
| Grouped combat positioning, farm-target approach, rare deployer and loot positioning | Combat steps and `formation`, `approach` or `rare` requests; a walk lends a standing member to steps, never its route journey. |
| Escape and event-instance exit fallback | `escape`, the highest rank; never waits for party assembly. |
| Banking, upgrades, supplies, gathering, merchant work, anniversary trades and the kiss approach | Individual `errand` requests, or event-tier interaction approaches. |
| Event participant with following off | Independent event movement; does not enlist a leader who has not joined that walk. |

## Validation and activation

Run `npm run typecheck`, `npm run owner:check`, the coordinator lint command from the README and
`npm run build:runtime`. The walk's unit tables are `shared-convoy.test.cjs`,
`convoy-coordinator.test.cjs`, `shared-walk.test.cjs` and `movement-rules.test.cjs`; the live rows
are in `e2e/live-movement-owner.spec.ts`, `e2e/live-hunt-departure.spec.ts` and
`e2e/live-convoy-event-defense.spec.ts`.

For activation use the supported `scripts/start-console.ps1` workflow from the coordinator README.
It builds and publishes character assets and restarts services. A bundle build alone does not
reload the live coordinator.
