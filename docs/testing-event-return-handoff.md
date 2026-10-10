# Active event return handoff

Failure inventory: an active return blocks attendance while the live event blocks
checkpoint travel; old Town commands repeatedly erase the new joined event;
excluded members lose their saved checkpoint; stale/disconnected or disabled
event reports release unrelated members; removing the final member leaves an
empty return blocked by its dispatched timestamp or routes; a return convoy
keeps owning released members; follower inheritance uses the wrong event policy.

Native E2E journeys keep Green and Pumpkin simultaneously live. Leaving Green
must lead both fighters to genuine Pumpkin damage without a holding return.
A Green-attending follower that adopts a Pumpkin leader must likewise fight
Pumpkin and retain the leader's checkpoint. The leave and restored-return
journeys then deselect Pumpkin and verify actual arrival at the saved navigation
checkpoint. Changing follow mode captures a new follower intent, so mixed
checkpoint formation return is outside the follower handoff assertion.
Record native damage, return/command observations,
and final checkpoint positions as repeatable artifacts.

The initial broader follower-return assertion exposed an existing mixed-
checkpoint formation return problem after changing follow mode. It reproduced
with the old coordinator too. Retain its diagnostic artifacts separately; this
fix covers the active return hold and subsequent event combat, not that separate
formation return problem.

A third journey declares the persisted stuck Green return, including its
dispatched timestamp, while Pumpkin is selected. It requires real Pumpkin hits
and checkpoint arrival; no successful exit or combat receipt is seeded.

A fourth waits for native Town exits and an actual checkpoint-return convoy,
then selects Pumpkin. Only the matching return convoy may be cancelled; both
fighters must fight Pumpkin and subsequently reach their saved checkpoint.

Run:

```powershell
npm test -- -- --project=live --grep "active event return hands off|native event entry resumes after its old"
npm run test:e2e:verify
```

Inspect `.build/e2e-report/` and
`.build/e2e-results/`, including the declared historical inputs, native hits,
return snapshots, screenshots, video and trace. The retained plain/deferred and
stale-peer journeys verify existing command retirement and reconnect behavior.
