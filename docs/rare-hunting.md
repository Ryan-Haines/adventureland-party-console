# Passive rare hunting and Phoenix patrol

Farming settings opens a searchable passive-hunting catalog. Each monster has an
independent enable checkbox, Keep moving to destination option, and priority (0–1000,
higher first). New selections default to keeping movement off and priority 100;
Fairy retains priority 101. Existing selections migrate without changing behavior.
The separate field-generator preference defaults on.

Keep moving uses basic attacks only while in range, including when stationary.
It does not select a movement target, chase, kite, or wait for loot. Actual attacked
identities are reported by realm/map/instance/ID so their retaliation does not
acquire defense or queue ownership; unrelated threats still do. Healing, attack
restrictions and emergency recovery retain precedence. Turning this option off
uses the ordinary encounter behavior below. Explicit farming and Phoenix patrol
remain separate. Rare sightings can interrupt normal
farming, scatter, farming travel, and Monster Hunt. Event work, Daisy reward
claims, Town, and emergency recovery retain ownership. A completed encounter
resumes the saved task only while its navigation revisions remain current.
Only confirmed party engagement followed by that target's death starts looting;
witnessing another player's kill is insufficient. Loot acknowledgement must match
the encounter, realm, map, instance, and location. Collection awaits the existing
loot routine and a fresh server/draw observation. Failures remain pending and retry;
full inventories request merchant cleanout. There is no fixed departure delay or
timeout that silently skips drops. Emergency and event ownership still take precedence.
Passive Phoenix hunting rejects outsider claims. An explicitly active Phoenix
patrol helps other players kill Phoenix through fresh, revision-bound assistance
permission; shared combat handoff does not revoke that permission. Ordinary
monsters retain their claim guards. Franky, Ice Golem, and Crab collaboration
remains available.

Starting Phoenix from the farming-area picker selects Phoenix alone. Select all
five spawn regions in the desired order; selecting a numbered region removes it
and renumbers the rest. The saved order survives restart. Stop Phoenix patrol
cancels its movement without disabling passive Phoenix encounters.

During an active patrol, a fresh visible Phoenix sighting from any party member
on the leader's map/instance interrupts patrol travel before waypoint arrival.
Sightings and encounter controls use the fast combat channel. Observations carry
their capture time, runtime, position, realm, and instance; delayed full statuses
cannot overwrite newer observations, and position heartbeats alone do not count
as scan coverage. Navigation logs record sighting receipt and combat selection.
While patrol acquisition is authorized, fresh Phoenix observations are also fed
directly into the grouped candidate list, even if convoy travel suppresses client
nominations. Patrol Phoenix priority is 100.5: above other priority-100 passive
rares, below Fairy at 101. Already-engaged fights and protected activities retain
ownership. All interrupted rare pursuits retry after three seconds.
The encounter allows up to ten seconds for normal grouped-combat selection to
take ownership; stale sightings still expire normally. Protected activities keep
their movement priority, and attack range/readiness checks remain authoritative.

All patrol scan legs, including short approaches, belong to the convoy. Client
patrol controls never launch an independent smart move. Assembly acknowledgements
must show stopped characters before capturing the planning origin. ALClient remains
the primary planner; regrouping, cancellation, origin drift, and transport errors
do not authorize native pathfinding. Geometry/pathfinding failures may use native
fallback. Obsolete local approach failures cannot invalidate a convoy scan.

Without a valid saved order, the picker preselects Mainland (641, 1803), Cave
(-180, -1164), western Mainland (-1184, 781), eastern Mainland (1188, -193), then
Spooky Forest (8, 631). Valid custom orders are preserved.

The search planner uses a conservative rectangular footprint inside the game's
700-by-500 visibility half-extents. Four current regions need one observation
point; the tall western Mainland region needs overlapping north–south coverage.
Only actual fresh positions count toward coverage, and observation endpoints
include a one-second dwell. Blocked points retry once, then use bounded nearby
coverage points; unfinished regions are reported and skipped. Failure in all
regions pauses travel until the user restarts. Scan convoys carry exact points:
ordinary farming-area resolution must not attach shapes or substitute a farming
entry point. All convoy members acknowledge arrival before scan advancement.
The leader handles approaches within 180 units, with a 30-second no-progress
watchdog covering convoy/local handoff and repeatedly completed ineffective trips.
Runtime loss or temporary unavailability retries the same point after five
seconds without consuming geometry fallback attempts. Fallback coordinates are
clamped to the spawn boundary rather than sending the party outside the region.

After a confirmed Phoenix death and required loot collection, choose from the
leader's current position: stay in the current spawn region, or compare planned
routes to all five scan entry points and choose the nearest reachable region.
Route distance includes walking distance and 400 equivalent units per map
transition; ties follow the saved order. Failed plans are excluded; if none can
be planned, pause with a visible reason. Position within a region is not assumed
to cover it: reposition to its observation point even after a long, drifting fight.
Wait until death + 35 seconds, counting loot and travel time. Sightings can
interrupt the wait immediately. At the deadline, scan with fresh coverage, then
continue with that region's successor in the saved order. Region and deadline
persist through restart; disappearance never starts a confirmed-death timer.
The installed 17083 game definition has respawn=32, and published server code
adds up to 0.9 seconds and samples uniformly from the five boundaries (20% each).

Every owned runtime reports rare sightings, field generators, and observed kills
through ordinary status telemetry, even with no map viewer open. The coordinator
scopes sightings by realm/map/instance and selects one shared encounter. Passive
unengaged encounters end when no fresh sighting remains (three seconds). Engaged
encounters retain combat/defense ownership; independent pursuit limits include 30 seconds without a new HP
low after combat starts, or five minutes total. Abandoned entity IDs have a three-second retry delay across all rare hunts,
including Fairy, Phoenix, Golden Bat, Cute Bee, Hen, and Rooster. Old attack
reports remain filtered separately for two minutes; fresh attempts are allowed
after the three-second delay. Confirmed deaths retain their dead-ID records.

Fairy is searchable but cannot be selected as an active farming focus. It is
skill-immune: Burst, Controlled Burst, Curse, Taunt, and Stomp are not used in its
encounter. Ordinary attacks, including warrior attacks, can trigger escape.
If a participating fighter carries `fieldgen0`, the nearest carrier approaches
within 200 units and consumes one through `equip(slot)`, which creates the field
at the carrier's position. Offensive attacks wait for confirmation of a field
within 300 units, or a bounded deployment failure. One generator maximum is
consumed per encounter. Existing nearby fields are reused. There are no automatic
purchases or storage withdrawals. Without a confirmed field the agreed fallback
is ordinary attacks and bounded pursuit, with no guarantee of success.

Settings use `POST /party-api/rare-hunting` with partial boolean keys `tinyp`,
`phoenix`, `goldenbat`, and `cutebee`. Phoenix starts extend `POST /party-api/navigate-to-monster` with
`monsterId: "phoenix"` and `phoenixRouteOrder: string[]`; the server validates all
five catalog region IDs. `POST /party-api/phoenix-stop` cancels the patrol.
Dashboard state exposes `passiveRareHunts`, `phoenixRouteOrder`, and `rareHuntState`;
character status responses include a revision-bound `rareControl`. A saved return
checkpoint survives coordinator restart, while encounter locks and scan coverage
are rebuilt rather than trusting old sightings.

Primary implementation: `runtime/coordinator/navigation/rare-hunting.ts` and
`phoenix-patrol.ts`, with client observation/targeting in `characters/shared.js`.
`scripts/rare-hunting.cjs` is a compatibility export of the generated TS bundle.
Run
`npm test` and `npm run build` to validate; use the existing publication/reload
workflow to activate a built generation.

Farming returns are tracked by `scripts/rare-farming-return.cjs` using the durable
`rareHuntReturn` checkpoint. Low health, stale heartbeats, events, and temporary
travel ownership pause the return without deleting it. Failed or lost return
convoys retry at most once every five seconds; offline members retain their
obligation until they reconnect. Completion requires fresh, living members in
the saved farm area (or within 180 units for a point destination). Explicit new
leader navigation supersedes the old return. An active Monster Hunt receives
ownership back at the same cycle, mission index, owners, and pinned destination,
without rebuilding quests. An active Phoenix
patrol resumes its scan rather than returning to ordinary farming. The dashboard
reports waiting, returning, and resumed states instead of leaving a stale
cancellation message after recovery.

Ordinary empty-spawn recovery cannot take movement ownership from an active
Phoenix patrol or rare encounter, including client-reload gaps. Anniversary
staging retains ownership through its full event-and-return cycle; patrol resumes
the saved region only after that cycle releases it.

Shared event returns also preserve initially offline members in
`deferredEventReturns`; a dead character or the wrong explicit instance cannot
count as an arrival. Manual Town and explicit Escape holds remain authoritative.

Final Hunt kills install a departure barrier before Daisy return or mission
travel can start. The mission owner stops nominating neutral monsters immediately,
including the interval between final-hit delivery and quest-count delivery.
An untouched selected target is not an attacker. Actual defense remains available.
Client `huntLoot` reports and coordinator `monsterHunt.loot.progress` acknowledge
collection; command delivery alone cannot complete it. Mission revision, target,
owners, and cycle scope prevent an old acknowledgement completing a new assignment.

Queue cancellation preserves genuine party attackers and rejects delayed abandoned
rare nominations/actions. Clients acknowledge the coordinator's global reset epoch
as well as character reset epochs. Synthetic interruption/return regressions verify
resumed marker eligibility and red/yellow/double-yellow rendering. The historical
missing-ring incident still requires live reproduction before attributing its cause.
