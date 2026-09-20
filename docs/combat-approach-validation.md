# Grouped combat approach

Ordinary candidates rank by leader distance within their existing priority tiers.
The selected target stays fixed while approach progresses. Red remains the shared
current target; yellow markers remain upcoming queue entries.

The priest advances far enough to cover the warrior's attack position. Every
ordinary step and local recovery step checks current healing coverage and swept
monster safety. Shared fresh sightings permit movement without local monster
visibility; they never authorize a blind attack. Missing sightings produce a hold.
Movement ownership checks prevent a combat hold from cancelling a newer route.

## Progress and replacement

`groupedCombat.approach` reports target identity, intent, issued destination,
engine movement flag, observed displacement, local visibility, attack-range
deficit, coverage deficit, and any persistent detour waypoint. A movement command
or the engine's moving flag is not evidence of progress. Eight units of measured
improvement in range, coverage, or progress toward the same detour waypoint resets
the five-second stall timer. Gaining local visibility also resets it.

Missing/stale telemetry and regrouping, travel, or event ownership suspend the
timer. Reports use the existing three-second freshness window. Clients without
approach telemetry cannot trigger replacement. Full server/map/instance/monster
identity and party runtime revisions scope pursuit state.

A stall with an eligible alternative first revokes pull authorization. Each
client acknowledges the revocation in the same report as its attack evidence.
Only fresh acknowledgements from all members permit replacement; pending or
engaged attacks retain their fight. A replaced ordinary target is excluded for
ten seconds. Without an alternative the current target remains selected with a
blocked reason. `ready` and `committed` do not imply combat: group phases distinguish
`selecting`, `approaching`, `attack-pending`, and `engaged`.

## Validation

- Run the formation, combat queue, combat movement, and combat channel tests.
  The three-character fixture uses an untouched 19,200 HP target, a warrior
  approximately 238 units away, supporters over 350 units away, and a preferred
  healing radius of 174.6. It also exercises shared-only sight and commands that
  never displace characters.
- Run typecheck, coordinator lint and the full test suite. If the existing
  dashboard query worker keeps the suite open after completed assertions,
  `node --test --test-force-exit scripts/tests/*.test.cjs` provides a bounded run.
- Build and activate with the supported workflow in the coordinator README.
  This change includes both shared character code and browser combat runtime;
  deploy their matching build together with the coordinator.
- After activation, verify fresh approach reports for the combat roster. Capture
  consecutive positions, destinations, constraints, group phase and pursuit
  timer. An approach should advance priest/supporters, then reach weapon range,
  without repeated backwards corrections at the healing boundary. Under actual
  obstruction, expect a safe detour or an explicit stationary hold.
- Verify visibility loss keeps the shared selection, and first-attack pending
  evidence retains that target even while a closer ordinary candidate appears.
  Do not treat a successful build alone as evidence of live activation.
