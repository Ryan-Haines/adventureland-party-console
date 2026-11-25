# Native gathering-capacity fixture availability

Failure inventory recorded before changing the fixture. Since the merchant job owner's
gathering, a merchant at its protected free slots (default 3) that holds the
session's catch banks it and casts again; the block below holds for a bag of other items:

- Native login initializes missing `player.p.dt` skill timestamps to the current
  time and queues native cooldown updates. Resetting `player.last`, the browser's
  `next_skill`, and the coordinator after login can race queued native updates or
  old status observations. Monotonic cooldown reconciliation restores those values.
- Run 38537449485 shard 7 retained a merchant correctly blocked at 40 occupied
  inventory cells, with no new gathering cast, but future fishing/mining cooldowns
  derived from login. The UI correctly omitted ready-work rows, so the test failed
  before exercising its cooldown-preservation assertions.
- Declaring initial skill availability must happen before native login, only for
  the owned merchant in an opted-in scenario. Record both prior and seeded data;
  reject missing characters or an already connected native account. Do not clear
  cooldowns, alter skill outcomes, or fabricate ready reports during the behavior
  under test.
- Require actual server, browser, runtime and coordinator readiness before enabling
  gathering. Preserve the two visible BLOCKED rows, unchanged cooldowns, native
  capacity reason, and resumption after freeing inventory cells.

Run the native scenario and verify its artifacts:

```
npm run test:e2e:live -- --workers=1 --grep "merchant gathering waits at capacity without resetting cooldowns"
npm run test:e2e:verify
```

The capacity scenario and the separate manual-weapon/gathering/restart journey
passed together locally in 3.3 minutes, with 100 verified evidence files retained
under `.build/gathering-availability-passing/`. The capacity scenario took 14.6
seconds and recorded actual epoch server timestamps, ready browser skills, zero
runtime/coordinator cooldowns, and no prior gathering session or attempt before
enabling the modes. The default fixture remains unchanged for the weapon journey.
