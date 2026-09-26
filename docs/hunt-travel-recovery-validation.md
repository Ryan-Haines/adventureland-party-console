# Hunt travel recovery validation — 2026-09-23

Implemented encounter reconciliation before acquisition, permanent death identities,
new-sample requirements after absence release, current-attacker selection priority,
and communication hold ownership with in-range local defense. Historical defense
causes no longer keep encounters alive. Passive commitments, loot, regrouping and
the original Hunt route use the same reconciled lifecycle.

## Verification

- Communication, shared-convoy, Hunt travel-defense, passive-hunting, combat-queue,
  travel-defense and marker regressions passed, including new restart/hold races.
- The deterministic minimush regression exercises phoenix interruption, restart,
  rejected `defending` acknowledgements, matching `held` reports, phoenix death,
  stale commitment retirement, loot, regroup and renewed route preparation.
- Separate tests cover attacking versus inactive hawks, phoenix respawn identities,
  stale absence samples, missing observations, newer navigation, and held markers.
- Typecheck, coordinator complexity lint, Hunt travel module lint, runtime build,
  character build and `git diff --check` passed.
- Full suite assertions: 3,008 passed, 2 skipped across the full run and separate
  dashboard server check. Windows Node 24.12.0 crashed in cleanup with
  `UV_HANDLE_CLOSING` under `--test-force-exit`; the affected dashboard server and
  console authentication tests both passed separately without that option.
- Logs remain in `.build/hunt-recovery-work/.build/full-test-verified.log`,
  `dashboard-node-check.log`, and `console-auth-check.log`.

## Activation and observed behavior

The supervised local host was stopped before transferring validated sources from
an isolated worktree. The ordinary `scripts/start-console.ps1` workflow installed
and published both components. Character generation `87cf243a398d` was published;
the new caracAL supervisor PID was 5064, started at 19:24:05 local time.

All three fighters reported fresh replacement runtimes. The 19:24:48 telemetry
sample contained matching `held` acknowledgements for QwenTina, GDroidPT and
GermanicHP, including convoy, epoch, command, navigation and runtime identity.
Coordinator logs recorded pending travel loot, communication restored, and
`Travel encounter complete; regrouping toward booboo`. Subsequent samples showed
scheduled departure followed by all fighters moving through Halloween into
Spooky Town toward the retained destination [415, -702]. No communication or
defense blocker remained in the final sample.

The live Hunt had already advanced beyond minimush before publication. Its active
booboo mission and saved destination were preserved; no Hunt, queue or saved state
was manually cleared. The original phoenix/hawk sequence and ring behavior were
verified by regression tests, not reproduced visually in the live session.
Live samples are in `.build/hunt-live-verification.jsonl`; startup output is in
`.build/hunt-full-restart.stdout.log`.

## Goobrawl exit follow-up

Farm reunion could overwrite event-exit movement. Event return now owns movement
until its exit completes, retiring an obsolete reunion without stopping the exit.
The local transporter approach runs independently, so a follower that cannot
connect to a leader origin does not strand the party. A confirmed no-route error
allows one Town recovery per return attempt object, then retries the transporter;
cancelled or superseded navigation cannot trigger that recovery.

The focused farm reunion, event return, Hunt return, shared walk and shared convoy
regressions passed (147 tests), as did typecheck and character build. The supported
full restart published generation `db29c600ece2`. At 21:30:24 local time GDroidPT
logged `Event ended; returned to Town`; fresh telemetry at 21:31:44 confirmed
GDroidPT, QwenTina and GermanicHP on Main. GDroidPT's transporter journey completed
after the one-time Town recovery. No active Hunt or saved state was erased.

The rescue is verified in `.build/goobrawl-rescue-verified.json`. Hunt departure
remained blocked by a separate failed `farm-recovery` convoy reporting
`Convoy runtime-lost`; the exit verification does not establish resumed hunting.

## Complete event-to-Hunt handoff

The follow-up closes the remaining checkpoint ownership gap. Ordinary Hunt missions
now resume after evacuation without visiting the saved pre-event farming area.
Checkpoint child convoys are recognized by parent command and navigation revision,
including failed farm-recovery walks restored after runtime replacement. Hunt mode
changes defer movement until exit; completed turn-ins and pending loot survive.
Deferred members retain evacuation but cannot replay an obsolete Hunt checkpoint.

The common exit controller covers Goobrawl, A/B Testing and Pirate Ship, plus the
existing open-world return path. It verifies actual map changes, preserves exit
attempt budgets through return progress, and stops old work after ownership changes.
Unknown event-map exit mechanisms report a blocker instead of guessing. Completion
acknowledgements reject stale command/runtime identities. Participation settings
were not expanded.

Validation: full build, typecheck, coordinator lint and diff checks passed. The
full suite reported 3,036 passes, 2 skips and one HTTPS startup timeout; the entire
HTTPS test file passed separately (5 tests). The final focused suite passed all
70 tests, including staggered restart, deferred exit, Hunt off/on, normal-policy
checkpoint repair, completed turn-ins, persistent retry budgets and stale commands.

The supported full restart published character generation `5335b6c310a2` together
with the coordinator changes. At 22:22:24 local time, all three fighters had fresh
replacement runtimes at Daisy on Main [126, -413]. The original Hunt cycle
`hunt-1790213580149-1790213385116` progressed from travel into `at-daisy` and reward
processing. Event return and active convoy were both null; no stale Goobrawl hold
remained. Samples are in `.build/event-handoff-live.jsonl` and restart output in
`.build/event-handoff-restart.stdout.log`.

All event-map exits and the reported interrupted-exit sequence were exercised by
regressions. This deployment did not force live event entry to reproduce them.
