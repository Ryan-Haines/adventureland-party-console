# Rare encounter and Hunt recovery validation

## Changes

Rare support and travel combat now retain one convoy owner. Fairy basic attacks
can use a fresh owned travel commitment even when its separate support controller
is absent. Optional pursuit has a no-progress deadline and an overall deadline;
progress and rejected encounters survive restart. Ambient monster/leader movement,
old engagement, and repeated sightings do not independently reopen a rejection.
Current attackers retain priority. Cross-map encounter catch-up uses the managed
planner under the existing convoy identity and stops on holds or supersession.

Completed anniversary visits hand back to current Hunt policy after fresh
ownership, combat, and loot checks. Their return routes cannot acquire optional
passive stops. Hunt reconciles verified arrival before optional acquisition and
updates its message when a rare interruption ends.

## Automated checks

- Full suite: 3,066 tests, 3,064 passed, two skipped, zero failures. Run with
  `node --test --test-force-exit --test-isolation=none scripts/tests/*.test.cjs`
  after building; the force-exit option releases test-owned background handles.
- Acceptance suite: 267 passed across encounter recovery, rare hunting/client/retry,
  convoy communication, shared convoy, Hunt travel defense, passive hunting,
  combat queue, and marker regressions.
- Post-build retirement/catch-up/retry checks: 45 passed.
- Final status correction plus encounter regressions: 36 passed.
- Production build, project typecheck, and coordinator/changed-combat lint passed.
- Broad lint matches the unchanged baseline: 35 dashboard errors and 96 runtime/
  tools errors. None were introduced by this change.

The initial isolated run lacked installed game/dependency fixtures; those were
supplied as test-only copies and the full run above supersedes that result.
A managed-movement regression executes a real fixture portal transition; separate
cases cover lost targets, held communication, newer manual revisions, stale
runtime observations, instance mismatch, and catch-up failure.

## Local activation and observation

Published character generation `8627ae19cecc` with the supported full
`scripts/start-console.ps1` workflow. No Hunt, queue, or saved state was manually
cleared. All three fighters connected with fresh runtime identities:

- QwenTina: `1790222059384-82h71fqnqmk`
- GermanicHP: `1790222065101-s9vizfhtbrp`
- GDroidPT: `1790222080569-jz5k9niuai`

The restored anniversary return completed at `1790222081458`. Hunt left
`paused-event` and resumed current mission minimush under convoy
`convoy-1790222081494-1790222058161`.

The same convoy acquired Fairy 225, all fighters selected it and approached,
then released it at `1790222145931` when selection was released. Loot checking
completed and regrouping toward minimush was logged at `1790222147098`; the convoy
identity remained unchanged. Verified arrival was recorded at `1790222164572`.
The live Hunt reached `farming`, all three selected minimush, and GermanicHP's
remaining count fell from 500 to 428.

That live transition exposed a stale pursuit message while movement had resumed.
A focused regression now verifies that retained mission travel refreshes that
message. The final coordinator-only restart preserves the published character
assets.

The Phoenix split-map scenario and marker behavior are regression-verified;
no fresh live Phoenix split-map encounter or visual ring inspection was observed
during this activation. Fairy pursuit/release and actual Hunt resumption were
observed live; a Fairy kill was not claimed.

After the final coordinator-only restart, a new anniversary round
`scheduled-1790222399383.5` began, targeting BobManager. Fresh fighter reports also
showed Franky event ownership and two outstanding anniversary visits. This is
current event ownership, distinct from the completed stale return above. The
final coordinator process runs under supervisor PID 3852; refreshed headless
runtime identities were GermanicHP `1790222355465-bvx3uyg4wwd` and GDroidPT
`1790222387407-70hpi3f1r6e`. QwenTina retained the verified character generation
and connected runtime, as expected for the coordinator-only activation.
