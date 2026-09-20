# Travel defense validation

Normal travel now consults fresh `currentAttackers` reports, including attacks on
followers. Retained hunt fights, old outgoing hits and cached threats cannot hold
departure. Full status and the fast combat channel carry the same travel control.
Local targeting stops passive pulls before convoy creation and during travel.
Consumed individual commands retain their travel ownership locally and report it
until completion. Both the classifier and clients respect realm/instance-scoped
confirmed deaths, even when a dead monster remains in another client's cache.

When fresh reports show a passive fight, the coordinator retires that target with
the existing per-target cutoff. Delayed evidence cannot revive it; a subsequent
current attacker can. Retirement does not fabricate a death or clear loot.
Final Hunt loot survives return-stage changes and Hunt restart/toggle transitions.
Defensive travel resumes the same destination after deaggro and an acknowledged
loot pass. A new attacker invalidates that pass.

Missing or stale travel observations produce an explicit observation hold. Quiet
maps use a fresh sample of the connected client's entity state, independent of
monster-packet timestamps. Disconnected clients cannot authorize departure.
Force travel, emergency recovery, existing event exits, cancellation, newer
commands, and arrival validation retain their respective ownership rules.

## Automated checks

- Direct defense regressions reproduce separated GDroidPT/GermanicHP near bees
  with QwenTina already in main square, completed quest and no attackers.
- Client tests cover passive target rejection, grouped/scatter defense, quiet maps,
  disconnects, local departure and navigation revision/cancellation.
- Shared-route integration covers departure, follower attack, route invalidation,
  loot and fresh planning toward the original destination.
- Hunt composition tests preserve pending loot across resumed and rebuilt cycles.
- Full suite command: `node --test --test-force-exit --test-timeout=60000 scripts/tests/*.test.cjs`.
  `--test-force-exit` avoids lingering timers in existing dashboard fixtures.
- Result: 1,671 tests passed, zero failures.
- Type checking, coordinator complexity lint, runtime and character builds run
  before activation. Build logs/results are under `.build/travel-final-tests.log`.

## Live activation

Use `scripts/start-caracal.ps1`, then confirm current character code revisions,
fresh attacker observations and live route progress. A build alone does not prove
activation. The original bee encounter had already ended before activation;
the deterministic regression preserves that exact failure scenario.

Activated on 2026-09-14 using the supported script; published character generation
`f0baab2a35a4`. The final launcher error log was empty. Duplicate older hosting
launchers were stopped before the final clean activation.

Live evidence: all three fighters reported fresh attacker samples. A cached dead
porcupine (`1932751`) exposed the confirmed-death mismatch during validation and
is now covered by coordinator/client regression tests. Subsequent telemetry
recorded the completed GermanicHP turn-in and a new rharpy quest. Travel logs
showed passive-target retirement and renewed route progress. At the final check,
the party was in `blacklist-retreat` after two later Hunt deaths, not blocked on
the original return guard. This is not a claim that all characters remain at Daisy.
