# Event timer identity and independent returns

Failure inventory, before implementation: clock correction changes a timestamp
instance identity and resets elapsed attendance; replacing CODE synchronizes a
different offset; adding a limit discards earlier unlimited attendance; a new
native instance inherits exhaustion; individual returns wait for a leader whose
checkpoint differs, or retarget to that leader instead of their saved waypoint.
All exhausted selections can leave the general event-enabled flag true; CODE
turnover can lose the local join marker before disabling a still-open trip.
Different heartbeat times can exhaust a follower before its leader: a later
forced exit must extend the same event return rather than discard that member.
The first continuation can arrive while the Town acknowledgement is still
finishing; retry it instead of silently consuming it while exit owns movement.
Recover a missing join marker once at CODE initialization; repeated disable
notifications must not stop an already-owned individual checkpoint return.
An individual point return must reach the waypoint closely enough before it
acknowledges completion, rather than stop at a loose party rendezvous radius.
An early-arriving follower can resume following before its peer arrives, leaving
its checkpoint and making the return cycle repeatedly reroute it. Keep ordinary
following paused until that member's active return cycle has finished.

The fixed-end native boss journey uses the same timestamp identity fallback as
Crab. It retains real combat and attendance, replaces native CODE, then adds a
limit shorter than already accrued attendance. Require stable server identity,
retained elapsed time, exhaustion, and actual checkpoint arrival. The existing
instance-limit journey covers fresh instances and restart persistence.

The follower handoff journey now requires both native fighters to reach their
separate saved destinations after deselecting Pumpkin. Retain native hit packets,
attendance snapshots, final positions, traces and the verified evidence manifest.

Keep declared peaceful boss catalog statistics for the entire journey, then
restore them in cleanup. The native server reads the catalog during later AI
ticks too; restoring immediately after spawn re-enabled native aggro and speed,
so genuine return defense could correctly delay travel against the seeded boss.
Disable the separate native `rage` flag too; `aggro: 0` alone does not disable it.
Set native `peaceful: true` to disable retaliation too. Verified upstream
`target_player` refuses new targets for peaceful monsters; zero aggro/rage alone
still allows player damage to create a legitimate return-defense attacker.

Run `npm test -- -- --project=live --grep "following a Pumpkin leader|native fixed-end event timer"`,
then `npm run test:e2e:verify`. Inspect `.build/e2e-report/` and
`.build/e2e-results/`, including attendance, native hit packets and final positions.

Final focused validation passed both native journeys in 5.2 minutes; the artifact
verifier checked 66 evidence files. Earlier failed runs remain separate under
`.build/` and identified staggered exit admission, premature following, and the
fixture's native retaliation. Typechecking, character syntax and focused return-
service lint passed; repository-wide runtime lint still reports existing errors.
