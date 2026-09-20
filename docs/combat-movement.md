# Combat movement

## Grouped farming formation

Grouped followers use the leader's explicit combat selection, including its
runtime identity, revision, map, and a three-second freshness limit. A missing
local entity does not authorize a replacement target. Followers keep healing
and positioning while holding offensive attacks. Only the leader can initiate
a grouped convoy's combat handoff. Scatter and event-specific combat retain
their independent targeting and movement.

During grouped farming, a living same-map priest is the formation center.
Movement prioritizes immediate safety, healing coverage, the priest-facing
side of the monster, then weapon range and smooth arc progress. Healing range
has a 10% movement margin, bounded to 8–20 units. Live visible positions take
precedence over telemetry; telemetry expires after three seconds.

The aggro holder progresses along a flexible arc around the priest. The priest
retreats when chased, otherwise moving only when range or healing coverage needs
correction. Short collision-checked candidate moves allow the arc to reverse
or follow a wall. Fully blocked local paths stop producing new moves; they do
not invoke an unvalidated route through a corner. Larger obstacles may still
need ordinary navigation. An absent or dead priest restores independent
defensive positioning without relaxing the target lock. Warrior Dash is held
while a priest formation owns positioning so it cannot bypass healing coverage.

`combatSelection` reports the leader's reserved selection separately from the
currently visible target. `combat.positioning` includes priest identity,
healing distance/range, formation mode, and the currently unsatisfied constraint.

The priest also avoids visible non-target monsters, including unaggroed roamers.
It evaluates clockwise/counterclockwise arcs at desired target range and the
existing local movement candidates. A 600ms prediction measures minimum
hitbox-aware clearance over each complete segment, including relative-motion
closest approaches and entities stopping at their destinations. It considers
every non-target monster so avoiding one cannot hide a crossing with another.
Unknown movement remains stationary in the prediction.

Immediate collision/attack-zone safety and healing coverage take priority over
target range; secondary clearance then takes priority over unnecessary holding.
Since a retreat's minimum clearance includes its starting point, endpoint
clearance breaks otherwise-equal path-clearance ties. Starting or reversing an
avoidance arc normally requires a five-unit improvement. Blocked directions,
immediate danger, and predicted encroachment can override that threshold.
Diagnostics include the nearest other monster, current/predicted/endpoint
clearance, direction, and avoidance reason. This never changes attack selection.

The role runner checks basic attacks every 50ms, updates combat movement every
100ms, and selects targets and runs support actions on independent 250ms timers.
Direct movement does not block attacks. Priest healing retains priority over
basic attacks on their shared cooldown. Lost attack acknowledgements have a
bounded guard; retries still require the game cooldown to be ready.

All classes use their live weapon range minus a 5% margin, bounded to 2–12 units.
Positioning uses the game's hitbox-aware distance and stays on the character's
side of the target. Warriors also apply this boundary to Dash. When chased,
characters kite at any HP, refreshing collision-checked direct destinations
before arrival. Circling keeps a stable direction unless blocked. Without a
chaser, characters move only to correct their range. Obstacles and nearby
attackers can require moving outside the ideal attack distance.

Farming convoy handoff requires a visible, eligible matching monster on the
destination map and within the hunt radius **of the destination waypoint**.
The character's distance from the monster does not define that area. Selecting
among multiple waypoints is not part of this change.

`POST /party-api/convoy-engage` validates convoy ID, epoch, command ID, runtime,
navigation revision, departure, focus, and target coordinates. After acceptance,
the client releases cruise to 500 and cancels the prepared route. Remaining
members receive revision-bound individual reunion commands and can engage an
eligible waypoint monster while still moving. Event return records retain the
handoff so their recovery loop does not recreate travel to the exact waypoint.
Ordinary leader-follow recovery uses the same waypoint eligibility rule.
Town, anniversary staging, service travel, and convoy preparation retain their
movement ownership and combat restrictions.

Character status exposes `combat.runner.skippedAttack` and `combat.positioning`
(target, distance, desiredRange, mode, movementOwner, and timestamp). Positioning
records are timestamps of the last positioning decision, not fresh heartbeats.

Tests include continuous simulated melee/ranged movement, attacks while move
and support promises remain pending, priest priority, claims and cancellation,
Dash bounds, waypoint boundaries, native prepared-route handoff, late members,
and event return reconciliation.

Franky recovery finishes each member's current fight, assembles the members still
outside Mainland, then uses the normal prepared convoy to exit. Each member stops
its native route on entering Mainland and receives the existing Town recovery
command immediately, without waiting for the others to cross. Once everyone is
Town-ready, the existing farming-return barrier dispatches valid saved waypoints.
Members already on Mainland skip the exit convoy. The exit permits cleared monster
focus but never saves a new farming waypoint or engages a farming target en route.
Failed exit convoys rebuild from the remaining remote members; acknowledged exits
are retained so stale position heartbeats cannot send someone back into the cave.

In normal grouped farming, the warrior closes on its selected enemy even when
that enemy outranges melee (for example, ghosts). The selected enemy's attack
radius does not count as an approach hazard; other attackers, collision checks,
and priest coverage still constrain movement. Approach changes to melee kiting
on entering attack range and resumes beyond attack range plus three units.
Safe, useful warrior segments persist for up to 250 ms and refresh with 150 ms
of travel remaining. Target changes, unsafe paths, or threatened healing coverage
force immediate reconsideration. Combat-position status includes `warriorPhase`
and `movementReason`; priest and event movement retain their existing behavior.

Merchant handoffs return fighters to farming reunion on success or failure, only
while the command and navigation revision still match and a farming checkpoint
remains authorized. Handoff approach keeps one pending path search during its
45-second wait. Merchant rendezvous bounds each travel leg to 45 seconds and the
whole attempt to two minutes, stopping its own timed-out route. Farming reunion
requires an unobstructed route to a nearby party member before declaring arrival;
its existing 90-second travel timeout and ten-second retry remain in effect.


## Formation performance and corner recovery

Formation prediction uses numeric position and hitbox snapshots rather than copying live renderer entities. Enemy motion is prepared once per tick; the same attacker list is reused for candidate safety. Candidates are scored before collision tests, with lazy checks in score order. The attack and movement timers remain 50 ms and 100 ms respectively. Secondary avoidance includes enemies within the larger of 160 units or their attack safety radius plus both parties' predicted travel and a 40-unit margin; distant passive enemies do not trigger perpetual orbiting.

Without a selected target, only a nearby same-instance attacker can trigger lightweight defensive kiting. Losing a target clears positioning diagnostics and cancels an old direct move only when the game's destination still matches the combat-owned endpoint. It does not cancel another navigation destination. `combat.runner.targetRejection` explains why the selected target cannot currently be used.

A blocked approach that fails to improve by eight units for 1.5 seconds can use a local two-leg detour. It tries 64 bounded waypoints (16 directions at 80/160/320/640 units), at most once per second, retains its chosen waypoint, and checks the next short segment for collision and enemy safety. It never starts smart-move during combat. If no safe local detour exists and nobody is attacking the character, it holds with an explicit reason instead of oscillating. Complex passages requiring more than two legs can remain blocked; this is not a replacement global pathfinder.

`combat.performance` reports cumulative solver ticks, total/max milliseconds, candidate count, and collision checks through ordinary status updates. Run `node scripts/benchmark-formation.cjs` for isolated crowded-scene measurements; add `--game-geometry` to use the locally downloaded game's Frozen Cave collision and hitbox functions. These are CPU measurements, not Steam FPS measurements. The September 10 validation measured 30-monster p95 below 1.6 ms with stub collisions; actual game geometry was below 2.9 ms across the three fighter roles. Adding 100 unrelated properties per entity no longer causes the previous hundreds-of-milliseconds cost.

Merchant pursuit refreshes coordinator positions every second, including during
direct movement. Ten seconds without 20 units of movement or distance improvement
triggers a smart-route recovery, at most twice within the existing rendezvous
deadline. Fresh map/instance status takes precedence over stale visible entities.
Anniversary reservations explicitly pause pursuit; timeout failures retry twice
with a ten-second scheduling delay. Diagnostics include both positions, movement
phase, recovery count and pause reason. Service failures retain collected cargo
and acknowledge individually delivered withdrawals before resuming.
