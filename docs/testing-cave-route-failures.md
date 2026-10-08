# Cave route preparation regression boundary

Native E2E remains authoritative for generated Cave terrain, shared pacing,
combat, votes and arrival. The retained movement service fixture checks only
deterministic planner admission and bounded waiting before implementation.

Failure modes:

- A follower duplicates the leader's expensive native search rather than waiting
  for the validated route from their shared assembly point.
- Waiting prevents a follower from accepting the leader's route, or importing a
  route leaves a prior native search running.
- Waiting/import bypasses geometry identity or collision validation.
- A generated floor needs more search work than the ordinary 30-second budget;
  its explicit larger budget becomes unbounded or changes ordinary navigation.
- Cancellation leaves waiting followers moving or allows a retired command to
  install another route.
- A newly triggered native vote hides background controls from accessibility;
  a test mistakes the expected modal state for missing Cave controls.

The native Cave journey must still confirm both characters actually reach the
selected destination, conserve the shared route and cruise, resolve real votes,
and stop after cancellation. It retains screenshots and native state artifacts.
Its arrival and cumulative required-room checks allow 300 seconds each, within
a 900-second overall journey. A reproduced random floor completed its final
farewell vote and opened the stairs milliseconds after the earlier 180-second
room-completion deadline; the longer bound preserves the completion assertions.

The cruise journey can exhaust a 45-second motion assertion while the selected
route is still assembling or preparing, then show real shared movement in the
native failure artifacts. Preparation reports for the earlier map waypoint or
assembly command must not satisfy the selected farm-route barrier. Match the
current target ID, run, floor and each participant's actual command and prepared
travel report. Allow 120 seconds for the bounded preparation stage, then retain
the 45-second displacement check against the original departure positions and
the native shared engine and matching cruise checks. Preparation alone never
establishes that either character moved.

A subsequent CI floor reached the cruise checkpoint, stopped correctly, then
resumed its owned serial-3 Bat Roost route. Native bat kills (502, 507 and 501)
and the real ten-second next-wave announcement showed productive combat pauses;
both actors retained prepared serial-3 routes and advanced toward the room.
The old 120-second resumed-room assertion combined new assembly/preparation and
those fights. Match the resumed prepared commands independently of combat
readiness, then allow the existing 300-second room-arrival budget. Keep both
characters within 70 of the selected point, all stop assertions and native
engine/cruise evidence; combat alone never substitutes for actual arrival.

## Assembly displaced after native completion

Native combat can displace a participant after its gather command completed.
The old completion journal prevents executing the same command again, while the
coordinator still requires current positions at the assembly point. This can
strand a newly selected route before departure. Recovery must issue a fresh
owned gather ID only for a completed current gather that drifted beyond the
assembly tolerance. Require fresh, living, combat/loot-ready observations on the
same run and floor; reject stale receipts, different commands and coordinates,
wrong maps/runs, pending combat, and in-flight gathers. Keep the original target
and arrival conditions. Bound repeated regroup attempts explicitly instead of
silently looping; old receipts must not authorize departure or overwrite a
newer command. The native journey still proves both actual boss arrivals.

The deterministic native assembly case uses actual collision-checked walking
and a temporarily slow native cruise to keep a peer's gather in flight. It
observes a real completed gather, displaces that actor with another native walk,
and verifies a new owned gather receipt and real return before both actors
reach the selected waypoint. Original cruise is restored in a finally block.

A visually verified rendered Cave minimap had 148 distinct colors and failed
the old arbitrary 150-color criterion. Screenshot verification now requires
material native orange floor coverage, variation between neighboring floor
pixels, and the bright native actor sprite in the camera-centered region.
Both pixel counts and screenshots are retained; blank or flat terrain cannot
satisfy these checks. The minimap camera follows the actor, with sprite feet
at the center (the sprite lies immediately above that point).

The exact archived 148-color Priest canvas measured 13,325 orange floor pixels,
1,652 transitions from native dark-neutral floor speckles to orange floor, and
10 bright centered actor pixels. All exceed the coverage/texture/actor limits
(200/200/3). The texture neighbor accepts dark neutral or warm pixels, excluding
purple walls/background. Constant purple and constant orange negative-control
images have zero qualifying texture transitions and zero bright actor pixels;
both fail, independently of their floor coverage.

## Shared route connector after combat drift

A validated Cave route can be interrupted by native combat/formation movement.
The current actor can then no longer reach the next retained waypoint directly,
even though the original edge was valid. Both leader and follower must retain
collision checks. A Cave-only opt-in may plan one bounded three-second same-map
walking connector to that next waypoint, then validate the entire bridge and
remaining owned route before resuming. Reject map/instance changes, transitions,
supersession, a second repair, unsafe bridges or moved endpoints. A failed
shared repair must fail the owned journey; it must never independently plan a
new destination route. Preserve barriers, runtime/revision, cruise, remaining
endpoint and generic shared-route behavior. Native stair and full journey
assertions remain the acceptance boundary.

## Native connector validation and transition choice race

The first native connector run completed four distinct walking-segment repairs
(one Priest and three Warrior journeys), including two stairs connectors; no
shared connector repair failed. Both native actors reached floor 1. The test
then timed out clicking a stale previous-floor `Take 2 Amber` reply as the modal
was replaced by the new-floor shop. Test failure modes: the goal can already be
true before a choice click, or become true during that click; repeated pending
choice clicks can target obsolete replies. Check both real floor values first,
submit each choice ID once, retain successful farewell vote evidence, and only
accept a click error when a fresh native observation proves both actors already
reached floor 1. Every other click error must still fail the test. Preserve the
farewell vote requirement, collision checks and actual floor transition.

The next real minimap rendered 24,148 orange floor pixels and 3,013 texture
neighbors, but the Warrior's small centered sprite contained only two bright
highlight pixels and 13 cool armor pixels. The archived 148-color map contained
10 highlights and 22 cool armor pixels. Require the paired centered highlight
(at least one) and cool armor footprint (more than eight), preserving both
terrain requirements. Flat orange floor and purple background have neither;
flat steel armor has no highlight, and flat white has no cool armor footprint.
These paired visual criteria accept both verified native sprites and reject
those blank/flat negative controls. Keep screenshot and numerical artifacts.

After actual floor arrival, a newly activated native shop choice can still hold
an opaque modal over the exit controls. Read that fresh choice, submit its
available free reply through the real UI, wait for native resolution and modal
closure, and dismiss the encounter result before exercising Exit/Stay/Confirm.
Record the new-floor choice ID, submitted option and resulting native state.
Preserve all exit confirmation and final held-phase assertions.

## Resumed selection: combat/assembly precedes native route planning

CI 37766427937 stopped Warrior travel at 1791457346286. Six actual Cave Guard
and Wolf kills continued through 1791457418407 (72 seconds after Stop). Native
assembly movement completed for Warrior at 1791457438838 and Priest at
1791457440223 (94 seconds after Stop). At the 120-second preparation deadline,
the owned move was only 17 seconds into native planning; both actors remained
815 units from the Bat Roost, ready, with completed gather receipts and no move
failure. This was not a completed-route race or a hung planner. Failure mode:
a single preparation wall-clock bound charges defensive combat and reassembly
against the native 90-second planning allowance. Only on resumed selection,
first await fresh ready actors with the current run/floor/target and owned move
commands, bounded by the existing 300-second combat allowance. Then start the
existing 120-second matching route-prepared guard. Keep initial preparation,
actual arrival within 70, native planner limits and overall 900 seconds intact.
