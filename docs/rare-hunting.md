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
remain separate. Which trips a rare interrupts is the task table's rare row
(`runtime/tasks/rules.ts`): the
rare task ranks against the group's live task, so a rare interrupts farming and Monster
Hunt mission travel and may join a rare's own walk; a trip the player started by hand, an
event walk, a return and a death recovery walk finish first. Each rare's "May interrupt Hunt" switch (`interruptsHunt`,
default on) in the passive hunting menu covers the whole Hunt task: off, the rare never takes
the party from Hunt mission travel or from farming the Hunt target. Backup
farming while Hunts expire is ordinary farming. Event work, Daisy
reward claims, Town, and emergency recovery retain ownership. A completed encounter
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
ownership. All interrupted rare pursuits retry after three seconds. A rare walk that
fails climbs the movement owner's task round (`taskRound` in
`runtime/protocol/ladder.ts`) while the rare control lives: the route again,
the other route, the nearest exit (never Town), then the next report. Each rung keeps
the 30-second rare route bound as its deadline, and the climb ends with the control.
The encounter allows up to ten seconds for normal grouped-combat selection to
take ownership; stale sightings still expire normally. Protected activities keep
their movement priority, and attack range/readiness checks remain authoritative.

All patrol scan legs, including short approaches, belong to the convoy. Client
patrol controls never launch an independent smart move. The whole party searches
together: from game data 18183 the party convoy reaches the Phoenix sooner after a
kill in every one of its five regions than a split search with its regroup (by calculation). Assembly acknowledgements
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
A scan stop is reached by movement's arrival reading, and a leg ends on its
walk's own progress end. A failed leg climbs the party's farming ladder
: a coverage sample no stop has walked to replaces the failed stop, then
the party regroups at the same stop, then the safe point starts the region's
scan over, and the wait rung counts the region incomplete and goes on. A lost or
reconnecting runtime holds the scan until every party runtime reports again.

After a confirmed Phoenix death and required loot collection, choose from the
leader's current position: stay in the current spawn region, or compare planned
routes to all five scan entry points and choose the nearest reachable region.
Route distance includes walking distance and 400 equivalent units per map
transition; ties follow the saved order. Failed plans are excluded; if none can
be planned, pause with a visible reason. Position within a region is not assumed
to cover it: reposition to its observation point even after a long, drifting fight.
Wait until the Phoenix's death plus the game's respawn time
(`G.monsters.phoenix.respawn`) and the server's 0.9 s jitter, counting loot and
travel time. With no respawn time in game data the patrol holds its respawn
stage and reports the missing data through the bound record. Sightings can
interrupt the wait immediately. At the deadline, scan with fresh coverage, then
continue with that region's successor in the saved order. Region and deadline
persist through restart; disappearance never starts a confirmed-death timer.
The installed 17083 game definition has respawn=32, and published server code
adds up to 0.9 seconds and samples uniformly from the five boundaries (20% each).

Every owned runtime reports rare sightings, field generators, and observed kills
through ordinary status telemetry, even with no map viewer open. The coordinator
scopes sightings by realm/map/instance and selects one shared encounter. A
sighting inside a member's view that its observation does not list is gone, and
sightings of a place no member's fresh report stands on go. The rare is
unseen once the members whose view covers its last spot have each sent one
observation after its last sighting without it, and lost once every member has
. Before combat the walk toward the rare ends with no progress on
movement's verdicts; in combat the rare's HP is the progress, and no new low for
30 s (the kept bound `RARE_PROGRESS_BOUND_MS`) after the fight's start, its last
low or the party's last fight against other attackers ends the encounter. No
total pursuit limit applies. An ended encounter cools its rare until a
newer sighting shows what the end read changed. A rejected rare stays
rejected until it attacks a member or dies; the record keeps the
newest 100 rejections by sighting time, as b9b5c91e did, and reports each one it
drops. A kill counts until the monster's respawn time has passed.

Fairy is searchable but cannot be selected as an active farming focus. It is
skill-immune: Burst, Controlled Burst, Curse, Taunt, and Stomp are not used in its
encounter. Ordinary attacks, including warrior attacks, can trigger escape.
If a participating fighter carries `fieldgen0`, the nearest carrier approaches
within 200 units and consumes one through `equip(slot)`, which creates the field
at the carrier's position. Offensive attacks wait for confirmation of a field
within 300 units: the report that carries the deployment stamps it, and the
deployer's next report confirms the field or shows the generator spent or
refused. One generator maximum is
consumed per encounter. Existing nearby fields are reused. There are no automatic
purchases or storage withdrawals. Without a confirmed field the agreed fallback
is ordinary attacks and bounded pursuit, with no guarantee of success.

Settings use `POST /party-api/rare-hunting` with partial boolean keys `tinyp`,
`phoenix`, `goldenbat`, and `cutebee`. Phoenix starts extend `POST /party-api/navigate-to-monster` with
`monsterId: "phoenix"` and `phoenixRouteOrder: string[]`; the server validates all
five catalog region IDs. `POST /party-api/phoenix-stop` cancels the patrol.
Dashboard state exposes `passiveRareHunts`, `phoenixRouteOrder`, and `rareHuntState`;
character status responses include a revision-bound `rareControl`. The patrol's
checkpoint survives coordinator restart, while encounter locks and scan coverage
are rebuilt rather than trusting old sightings.

Primary implementation: `runtime/hunting/coordinator/rares.ts` (sightings, the passive rules, the encounter, the Phoenix patrol and the rare's state for the reply), with the character's observation and control in `runtime/hunting/character/rares.ts`. An encounter ends with an end code from `runtime/hunting/rules.ts` (`released`, `no-progress` and `time-limit` reject the rare until new evidence; `killed`, `died`, `disabled`, `claimed` and `interrupted` do not), and the encounter writes nothing of the Hunt record, the combat mode or the scatter break: the tasks owner's rare row takes the group and the combat mode answer's rare row answers grouped. The patrol settles at a stop on the leader's next report after the walk ended, and retries a walk lost to a runtime reload on every member's next report. An add-on may order the regions through `rare.search`. The party death recovery's escape ends the encounter (`survival.recoveryPhase`), and a Hunt under the recovery resumes when the tasks owner resumes its task. Run `npm test` and `npm run build` to validate; use the existing publication/reload workflow to activate a built generation.

The encounter is the tasks owner's `rare` task: it ends the walk under way and suspends the farming or Hunt task, and commits nothing into the walk. After the encounter the tasks owner resumes that task, which walks the party back to its spot: farming through its empty spawn return (`runtime/hunting/coordinator/farm.ts` `returnToSpawn`), a Hunt through its mission travel or its arrival recovery. Grouped combat's queue facts reach the encounter through the targeting owner's `targeting.groupView`, and its queue reads the rare's rejections from `farming.focus`'s `rare.rejected`, so the encounter writes nothing of the targeting record. An active Phoenix patrol resumes its scan rather than returning to ordinary farming.

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
