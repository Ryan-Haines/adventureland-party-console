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
