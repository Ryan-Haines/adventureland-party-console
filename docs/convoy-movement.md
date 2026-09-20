# Shared native routes for party convoys

Convoy protocol **3** computes the destination route on the convoy leader. Followers
rendezvous at that leader's fixed origin, import independent copies of the native
waypoint queue, acknowledge installation, and depart together. This uses the game's
native search and walker; it does not introduce a second movement scheduler.

## Lifecycle

1. Bootstrap takes movement ownership and applies the cruise cap without starting
   follower searches. When fresh compatible runtimes have reported, the coordinator
   fixes the leader's origin and issues `shared-prepare`.
2. The leader searches while followers approach that origin. Reachable local
   approaches use direct movement; other rendezvous approaches may use native search.
   Followers never search for the convoy destination.
3. The leader publishes one bounded route payload. Followers fetch it once per
   version, validate their connection to the origin, copy the queue, and report
   `routeReady` with the route version. Farm entry points are resolved by the leader.
4. Fresh readiness, stationary formation, and cruise caps must hold for 500 ms.
   Departure is scheduled four seconds ahead. Signals expire after three seconds;
   a first signal arriving after departure or a release over 500 ms late fails safely.
5. The existing 80 ms scheduler releases each native walker. Town and transport
   waypoints remain native operations. Ordinary arrival keeps the leader under
   convoy ownership until all members report arrival; Hunt legs retain their leg
   barrier, and Franky's Mainland exit retains its boundary handoff.

Town shortcuts and Hunt itinerary selection remain coordinator barriers. Hunt's
leader-only Town/no-Town comparison retains usable walking segments locally, so a
selected itinerary does not require every member to search each leg again.

## Recovery

A blocked waypoint, displaced origin, lost prepared queue, or missed departure
requests a group hold. The walker intercepts native fallback before it can start a
follower destination search. A new epoch invalidates the old departure and payload.

After everyone acknowledges a physical stop, followers approach the leader's new
fixed position. The leader republishes its valid remaining route, including a
waypoint already issued but not reached. A route interrupted during transport, an
unreachable first segment, or changed ownership invalidates reuse; the leader then
searches while followers catch up. Departure always requires fresh installation
acknowledgements. Three regroup attempts are allowed before retaining a failed hold.

Rendezvous permits 30 seconds without progress and 120 seconds overall. Planning
and installation have a 60-second limit. Lost runtime, realm, navigation ownership,
death, or stale reports hold travel; explicit cancellation and newer commands are
never authorization to resume the old route. Route payloads are not persisted.
Ordinary restart recovery requires protocol 3. Workflow walking legs retain small
parent-command records so surviving event/Town continuations can re-register after
a coordinator restart without losing their completion owner.

## Interfaces and implementation

- `runtime/coordinator/navigation/shared-navigation.ts` owns shared planning,
  readiness, scheduling, and regrouping. Existing Town, itinerary, defense, and
  workflow barriers remain behind the legacy navigation adapter.
- `POST /party-api/convoy-route` accepts a publication only from the current leader.
  `GET /party-api/convoy-route` serves current participants. Both bind convoy,
  epoch, route version, command, navigation revision, and runtime. Payloads are
  bounded to 10,000 waypoints and 900,000 serialized characters and validated
  before storage. Conflicting publication under an existing version is rejected.
- `POST /party-api/shared-travel` coalesces workflow walking requests and provides
  their completion state. It preserves suspended return-command acknowledgements,
  rejects superseded requests, and keeps exhausted convoys held.
- `characters/shared.js` integrates the native scheduler gate and workflow callers.
  `routeStarts` counts shared-stage native search starts; `destinationSearches`,
  `rendezvousSearches`, `routeImports`, `reusedRoutes`, and `routeSource` distinguish
  actual searches from queue initialization and copying.

The route store is an ephemeral WeakMap keyed by the convoy. Waypoint arrays do not
enter retained commands, status heartbeats, dashboard snapshots, SSE, or TanStack
Query. Only small identities/readiness/diagnostic fields use the control channel.

## smart_move audit

All maintained calls are in `characters/shared.js`; generated character bundles
must not be edited. The movement owners are:

| Owner/call family | Policy |
| --- | --- |
| Party travel API, selected farming, Hunt, rare/patrol and return convoys | Shared convoy engine; ordinary and forced party travel retain their respective combat behavior. |
| Event approach/rejoin, anniversary staging, Town/event-return walking, full-party farming recovery | Coalesced workflow walking; event join/leave, Town casts and completion callbacks retain their owners. |
| Goobrawl Transporter approach | Shared for an event-return command; emergency/manual escape remains independent. |
| Convoy bootstrap, preparation and rendezvous | Bootstrap performs no search; leader alone searches the destination; follower search targets only the fixed rendezvous. |
| Hunt return itinerary comparison | Leader only; usable walking segments are reused. |
| Follow/return-leader, survivor reunion | Individual rendezvous; blocked while a convoy owns movement. |
| Grouped combat positioning, farm-target approach, rare deployer/loot positioning | Individual combat/role movement, guarded against convoy ownership. |
| Emergency escape and event-instance exit fallback | Independent safety movement; never waits for party assembly. |
| Banking, upgrades, supplies, gathering, merchant sales/orders/mail/stand/marketplace, anniversary trades/cake and per-character kiss approach | Individual errands or interaction approaches; not shared destination dispatches. |
| Legacy per-character travel/force-travel handlers | Compatibility handlers; the party travel API now dispatches a convoy instead. |
| Event participant with following disabled | Independent event movement; does not enlist a leader who has not joined that travel group. |

## Validation and activation

Run `npm run typecheck`, `npm test`, the coordinator lint command from the README,
and `npm run build:runtime`. Native VM tests use the installed numeric game cache;
they do not connect to the game. Shared-route tests cover one leader search across
three runners, copied queues, blocked-waypoint interception, unconsumed-waypoint
reuse, native Town/transport operations, protocol mismatch, stale publications,
request coalescing, command continuation and cancellation.

For activation use the supported `scripts/start-caracal.ps1` workflow from the
coordinator README. It builds and publishes character assets and restarts services.
A bundle build alone does not reload the live coordinator. Preserve concurrent
work and verify protocol/readiness/search telemetry on both browser and caracAL
runtimes before claiming live activation or synchronized gameplay validation.
