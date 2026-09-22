# Hunt encounters during travel

Mission travel scans the character's configured monster search radius for the exact
active hunt type. A visible, living, unclaimed target can interrupt the route when
it is already in attack range or has a directly reachable attack position. Daisy
and backup trips keep their existing travel ownership.

The coordinator validates the current mission, route identity, navigation revisions,
fresh position, instance, and distance before releasing the convoy. It adopts a
catalogued spawn zone, including its boundaries, when the encounter is inside one.
Otherwise it retains the mission destination and records a temporary encounter
with its monster identity, mission identity, navigation revisions and start time.
The encounter position is used for combat and follower rendezvous. Existing group
readiness and defensive priorities still apply. Travel nomination does not require
an existing group target selection; actual attacks still require the group lock
and commitment. An unfinished group fight prevents a new travel nomination.

Temporary encounters end on confirmed death or five seconds of fresh observations
without a valid target. Stale observations, restarts and event interruptions add no
time. After an acknowledged loot pass, the hunt resumes its retained destination,
or follows the existing Daisy flow if complete or due. Passing attacks cannot hold
the encounter or its loot barrier. Escape, manual cancellation, death recovery and
newer movement ownership remain authoritative. The engagement response identifies
`handoff: "temporary"` or `"spawn"`; a combat handoff is not spawn arrival.

Destination reconciliation version 1 preserves recognized legacy spawn destinations
and repairs uncatalogued encounter points using the normal hunt destination selector.
It waits for fresh reports, clear movement ownership and the end of current combat.
Missing catalog data produces a specific waiting message and is retried. Quest counts
and hunt identity are preserved.

Rate-limited `Hunt acquisition:` navigation logs record the nearest candidate,
rejection reason, position, radius, route identity, and handoff outcome. Convoy
lifecycle logs retain destinations and revisions when routes start, prepare,
regroup, fail, complete, or hand off. Replacement starts include the previous
convoy ID; failures include current command types to expose ownership changes.

For an untouched hunt target, a strictly closer eligible monster can replace it.
Grouped combat first revokes the old pull and waits for acknowledgements carrying
pending attack evidence. A pending or engaged attack keeps the old target. Solo
and scatter targeting likewise retain pending and successful attacks. Equal-distance
candidates do not cause a switch; a normal closer-target switch adds no exclusion.

## Validation

- Route toward the bees below mansion through the bee spawn southeast of goo.
  Confirm the party stops for eligible bees there and stays in that spawn after
  the first kill and after the ten-second arrival-protection window.
- On a Poisio route to `(-121, 1360)`, encounter one at `(-48, 704)` outside the
  spawn. Confirm the mission destination remains unchanged, loot finishes after
  the kill, and the party resumes the original route despite nearby passing Goos.
- Interrupt temporary combat with anniversary travel or a restart. Confirm fresh
  observations revalidate the encounter and delayed handoff/completion callbacks
  cannot stop a newer route.
- Approach an untouched hunt monster and pass closer to another. Confirm the new
  closest target is selected, then confirm another closer monster cannot interrupt
  an attack already in flight.
- Check an unreachable bee across a bend, an external claim, and a different monster
  type: these must not end the route. Confirm hunt turn-in still reaches Daisy.
- Run `npm run typecheck`, `npm test`, and the coordinator lint check. Regression
  coverage lives in hunt-temporary-encounter, hunt-route-acquisition, departure-loot,
  movement-service, combat-queue, combat-movement, and the
  existing convoy/hunt suites.

Build and activate using [the coordinator workflow](../runtime/coordinator/README.md).
This change includes character code, so activation must publish the new character
bundles as well as restart the coordinator. A build alone does not reload either.
