# Hunt lifecycle test audit

This ledger reviews **26 files / 156 source test declarations**. Parameterized declarations represent every branch in their source loop, not one runtime case. Event/anniversary/rare, travel-defense and merchant audits live in companion documents. Counts refer to the inventory before replacements, so removed rows remain traceable.

## Native scenarios

All L cases are in [live-hunt-lifecycle.spec.ts](../e2e/live-hunt-lifecycle.spec.ts). They use the pinned upstream game server, native clients, real coordinator HTTP and journal. Initial quests/equipment and the explicit death fault are declared fixtures; movement, kills, respawn, expiration and Daisy rewards are actual game execution. Every case attaches authoritative server/coordinator/native-event evidence; the suite reporter hashes the artifacts.

- **L1:** Boo Boo: native map doors, actual target combat, return and Daisy token.
- **L2:** A native quest expires, increments one failure, survives restart, reacquires a real Daisy quest without a completion token, then clears its blacklist.
- **L3:** Two independently completed party quests each produce exactly one token, including coordinator restart after Hunt exit.
- **L4:** A completed follower waits while its leader kills real goos; both subsequently claim rewards.
- **L5:** An unfollowed priest completes a solo Hunt while the warrior receives neither a quest nor a reward; independently addressed settings and saved/effective response metadata remain scoped.
- **L6:** Hunt off/restart/on creates a nonempty new cycle and continues killing toward the remaining native quest.
- **L7:** Choose a farther bee spawn rather than nearest, persist across restart, acquire that area and perform actual combat there.
- **L8:** Sixteen malformed/unauthorized mutations are rejected atomically without changing settings, backup, blacklist or cycle. Valid spawn patches preserve other monsters; blacklist add/remove/clear is exercised; the Hunt still earns its real reward.
- **L9:** Death threshold one: native death, exactly one recorded failure after restart, native respawn, blacklist removal and resumed quest progress.
- **L10:** Death threshold two: first native death/restart resumes the same cycle without recounting; a second native death crosses the threshold, persists two failures, then clearing its blacklist permits actual combat again.

- **L11:** A real kill changes W1/P8 into a completed leader plus unfinished follower. The leader earns its native reward without a loot-hold stall; the preserved follower quest completes either in the original party or through an explicitly recorded Follow-off/solo Hunt command.

These are coverage descriptions, **not a claim of passing validation**. Root runs the shared native stack and records final results in the testing guide. A successful journey does not replace an isolated test that injects a different race, stale observation or ownership conflict.

The 54-case diagnostic passed L1–L9 and L11, including L7's corrected merged farming-area fixture. L10 exposed a fixture fault: one ordinary lethal attack killed both stacked fighters, and Hunt correctly counted two deaths; see [the evidence](testing-single-death-red.json). The later `recovery11-diagnostic` run passed L10 with the corrected native Rime single-target death fixture, as well as all six consumers of that fixture. Earlier passing settings/death gates replaced four full source declarations, the enabled-blacklisting branch of one parameterized declaration, and the invalid-settings loop plus its zero-save assertion. L7 now also replaces the duplicate saved-count and successful restored-preference assertions; manual, excluded-area and cleared-preference fallbacks remain. Disabled blacklisting and other unique guards remain.

## Validation status

- `recovery11-diagnostic`: **10/11 passed**, with 380 artifact hashes verified. The uninterrupted Town return passed with 42.807 seconds of owned outward movement, zero extra recovery attempts and both native rewards. The restart variant earned both rewards but failed its no-extra-recovery assertion: shared preparation incorrectly timed out after 61.127 seconds because its clock included rendezvous travel.
- A separate preparation clock now prevents assembly travel from consuming the planner deadline. `return-clock-final` passed **3/3 cases**, with 163 artifact hashes verified: both Town variants and follower reconnect. Both Town cases earned the actual rewards without extra recovery attempts on this corrected source snapshot.
- `reconnect-final`: **1/1 passed**, with 100 artifact hashes verified, after fixing publication of route identity before awaiting native rendezvous.
- The verified native aggregate contains **63 unique cases whose latest outcomes passed**, across six preserved runs and their source snapshots. This is not a single full-suite run against one final snapshot.
- The last retained-unit run passed **3,166 tests**. This is the recorded retained-test run count, separate from the native evidence.

## Per-declaration disposition

The separate Town recovery scenarios use genuine partial Town casts near the
incident Bee region. The uninterrupted case covers the full 30-second outward
detour; the restart case begins after actual outward movement and preserves the
same Hunt/convoy. A native Town may legitimately become eligible after reconnect;
its coordinator transition, socket request and upstream completion timestamp are
recorded. Both cases reject false rendezvous timeouts and excess recovery attempts.

“Retain” means the named fault/combination is not demonstrated by the native scenarios above. “Partial” means the native journey covers part of a bundled case, so the unique guard stays. A replacement candidate is deleted only after its corresponding native case passes.

### continuous-hunt-return

L1 crosses native map doors and returns; it does not force three staggered runners through both Town-enabled and Town-disabled itineraries or cancellation.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [14](../scripts/tests/continuous-hunt-return.test.cjs#L14) — three managed runners return from '+map+' to Daisy on one itinerary; disableTown='+disableTown<br>Matrix: <code>const map of ['mansion','winterland']; const disableTown of [false,true]</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [80](../scripts/tests/continuous-hunt-return.test.cjs#L80) — a cancelled convoy cannot fake Daisy arrival, and confirmed arrival does not start another convoy | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### coordinator-hunt-actions

L3/L6 exercise real Hunt exit. Manual-blacklist add/unknown-monster rejection and exit with an unclaimed completed quest remain distinct.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [18](../scripts/tests/coordinator-hunt-actions.test.cjs#L18) — Hunt exit immediately clears completed turn-in state and retains live quest observations | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### coordinator-hunt-composition

L1–L7 exercise healthy composition. Stale/offline roster reconciliation, replaced backup areas, pending loot and malformed persisted stages need targeted fault injection.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [33](../scripts/tests/coordinator-hunt-composition.test.cjs#L33) — resuming Hunt retains the newly selected backup area and focus | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [43](../scripts/tests/coordinator-hunt-composition.test.cjs#L43) — new Hunt excludes saved offline followers and characters outside the current party | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [56](../scripts/tests/coordinator-hunt-composition.test.cjs#L56) — persisted ${stage} Hunt releases an offline quest owner and resumes current party quests<br>Matrix: <code>const stage of ['checking-quests', 'mission-travel', 'returning', 'backup-farming']</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [79](../scripts/tests/coordinator-hunt-composition.test.cjs#L79) — checking quests keeps fresh dead members and waits when the leader is stale | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [91](../scripts/tests/coordinator-hunt-composition.test.cjs#L91) — backup repairs a persisted area that does not contain the selected monster and departs | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [107](../scripts/tests/coordinator-hunt-composition.test.cjs#L107) — backup preserves an explicitly selected compatible area | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [114](../scripts/tests/coordinator-hunt-composition.test.cjs#L114) — Hunt restart preserves unfinished loot before preparing travel; resume='+resume<br>Matrix: <code>const resume of [true,false]</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [126](../scripts/tests/coordinator-hunt-composition.test.cjs#L126) — Hunt composition starts its route despite nearby attackers and retains the mission | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [137](../scripts/tests/coordinator-hunt-composition.test.cjs#L137) — resumed mission travel clears the previous rare interruption message | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### coordinator-hunt-control

Normal turn-in and event exit do not exercise late acknowledgements, retry runtime compatibility, permission polling or duplicate departure requests.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [12](../scripts/tests/coordinator-hunt-control.test.cjs#L12) — manual hunt-return retry waits for runtime compatibility and existing command ownership | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [17](../scripts/tests/coordinator-hunt-control.test.cjs#L17) — interaction acknowledgements cannot clear a newer command and success waits for quest telemetry | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [24](../scripts/tests/coordinator-hunt-control.test.cjs#L24) — permission polling alone does not create event protection, and completed anniversary protection closes | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [40](../scripts/tests/coordinator-hunt-control.test.cjs#L40) — event return blocks repeated event departures until recovery completes | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### coordinator-hunt-controls

L5 proves a separate solo controller. Stale/cross-realm admission, command ownership, destination ties/coercion and malformed threat values remain uncovered.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [5](../scripts/tests/coordinator-hunt-controls.test.cjs#L5) — Hunt participants require a fresh combat leader and keep only its active same-realm followers | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [21](../scripts/tests/coordinator-hunt-controls.test.cjs#L21) — Hunt cancellation scopes cleanup to convoy participants; clearing also removes orphan Hunt commands | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [34](../scripts/tests/coordinator-hunt-controls.test.cjs#L34) — Hunt destinations preserve zone identity, coercion and stable ties while excluding cross-map distance | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [49](../scripts/tests/coordinator-hunt-controls.test.cjs#L49) — Hunt threat lookup retains numeric coercion and zero fallback | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### hunt-area-arrival

L1/L7 prove native arrival and farming. They do not replay mismatched/stale hold acknowledgements, reload runtime identity or nominations during the handoff barrier.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [15](../scripts/tests/hunt-area-arrival.test.cjs#L15) — spawn edge stops once, requires matching stopped acknowledgements, releases ownership without center rally | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [20](../scripts/tests/hunt-area-arrival.test.cjs#L20) — label+' cannot hand off<br>Matrix: <code>const [label,change] of Object.entries({outside:f=&gt;f.s.statuses.P.x=499,stale:f=&gt;f.s.statuses.P.seenAt=1,transporting:f=&gt;f.s.statuses.P.transporting=true,instance:f=&gt;f.s.statuses.P.in='other',server:f=&gt;f.s.statuses.P.server='EUI',event:f=&gt;f.s.statuses.P.activeEvent='franky',escape:f=&gt;f.s.escape={stage:'walking'},replacement:f=&gt;f.s.commands.P.convoyId='other'})</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [21](../scripts/tests/hunt-area-arrival.test.cjs#L21) — persisted farming convoy is stopped and released using the same barrier | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [22](../scripts/tests/hunt-area-arrival.test.cjs#L22) — existing loot is retained until its original barrier completes | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [23](../scripts/tests/hunt-area-arrival.test.cjs#L23) — new runtime must acknowledge a newly issued hold | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [24](../scripts/tests/hunt-area-arrival.test.cjs#L24) — handoff preserves evidence and normal queue prioritizes existing fight before two nominations | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [33](../scripts/tests/hunt-area-arrival.test.cjs#L33) — three visible nominations authorize only the current target; incidental aggro blocks the next pull | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [44](../scripts/tests/hunt-area-arrival.test.cjs#L44) — late pre-release local reports cannot reinstate travel restrictions after farming handoff | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### hunt-fallback-owner

L4 covers an incidental completed follower claim. It does not select that follower as active quest owner or change leadership during selection.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [3](../scripts/tests/hunt-fallback-owner.test.cjs#L3) — selected follower owns cutoff and reward return without changing party leader | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [17](../scripts/tests/hunt-fallback-owner.test.cjs#L17) — leadership changes invalidate a fallback selection outside turn-in | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### hunt-farm-walk

No lifecycle journey injects an orphaned/failed farm relocation, exhausted geometry budget or a deadline crossing with competing navigation owners.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [24](../scripts/tests/hunt-farm-walk.test.cjs#L24) — orphaned failed farming relocation releases expired Hunt to Daisy | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [27](../scripts/tests/hunt-farm-walk.test.cjs#L27) — stale relocation with its failed walk and expired anniversary checkpoint yields to Daisy | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [34](../scripts/tests/hunt-farm-walk.test.cjs#L34) — orphaned failed farming relocation restores the actual Hunt mission origin | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [39](../scripts/tests/hunt-farm-walk.test.cjs#L39) — orphan recovery preserves '+blocker<br>Matrix: <code>const blocker of ['revision','command','event','destination','stale','cancelled','paused']</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [51](../scripts/tests/hunt-farm-walk.test.cjs#L51) — failed geometry repair stays held with an accurate Hunt message | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [55](../scripts/tests/hunt-farm-walk.test.cjs#L55) — Daisy deadline preempts owned '+phase+' farm walk before event pause, despite optional attacks<br>Matrix: <code>const phase of ['failed','shared-travel']</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [59](../scripts/tests/hunt-farm-walk.test.cjs#L59) — expired quest stranded behind failed farm walk still goes to Daisy without restarting the hunt | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [62](../scripts/tests/hunt-farm-walk.test.cjs#L62) — healthy farming walk remains owned through the final second, then yields exactly once | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [68](../scripts/tests/hunt-farm-walk.test.cjs#L68) — restored failed farming walk with fresh reports recovers without changing quest progress | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [72](../scripts/tests/hunt-farm-walk.test.cjs#L72) — reported Ghost stall: expired anniversary checkpoint yields failed farm recovery to Daisy | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [76](../scripts/tests/hunt-farm-walk.test.cjs#L76) — anniversary checkpoint handoff preserves '+blocker<br>Matrix: <code>const blocker of ['ongoing','busy','kiss','new-revision','dispatched']</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [86](../scripts/tests/hunt-farm-walk.test.cjs#L86) — farm walk deadline preserves '+blocker<br>Matrix: <code>const blocker of ['stale','cancelled','new-revision','new-command','other-walk','protected','event-return','anniversary','death','escape']</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### hunt-geometry-roster

No lifecycle journey reloads one member during geometry repair while proving roster retention.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [3](../scripts/tests/hunt-geometry-roster.test.cjs#L3) — Hunt retains its reloading member during geometry '+phase<br>Matrix: <code>const phase of ['waiting','failed']</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### hunt-missing-destination

All native fixtures have complete catalogs; delayed or absent mission/Daisy destination data is not injected.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [7](../scripts/tests/hunt-missing-destination.test.cjs#L7) — missing mission data remains unresolved and is retried without fabricating a waypoint | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [22](../scripts/tests/hunt-missing-destination.test.cjs#L22) — cleared targets and missing destinations preserve the existing no-travel hold | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### hunt-mode-reset

L6 proves off/on with an unfinished real quest. Its fixture does not contain foreign merchant commands, child recovery convoys, completed quests or simultaneous event-return ownership.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [19](../scripts/tests/hunt-mode-reset.test.cjs#L19) — off/on resets runtime while retaining live quests: completed=${completed}, event=${event}<br>Matrix: <code>const completed of [false,true]; const event of [false,true]</code> | **Partial: L6.** Unfinished no-event off/on is exercised. Retain the completed/event matrix and cleanup of unrelated ownership. |
| [28](../scripts/tests/hunt-mode-reset.test.cjs#L28) — Hunt child recovery convoy clears without deleting another owners command | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### hunt-retreat-restart

L9/L10 cover death/restart. They do not exhaust tunnel retreat, retain pending loot, or supersede recovery with another owner.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [41](../scripts/tests/hunt-retreat-restart.test.cjs#L41) — terminal tunnel retreat restarts through death recovery and selects a nonblacklisted Hunt once | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [75](../scripts/tests/hunt-retreat-restart.test.cjs#L75) — terminal Hunt restart respects '+name<br>Matrix: <code>const [name,change] of Object.entries({
   stale:f=&gt;f.state.statuses.W.seenAt=1,
   future:f=&gt;f.state.statuses.W.seenAt=101000,
   mismatched:f=&gt;f.state.statuses.W.escape.id='previous-escape',
   ordinaryWait:f=&gt;delete f.state.statuses.W.escape.recoveryFailed,
   deadReporter:f=&gt;f.state.statuses.W.rip=true,
   manualCancel:f=&gt;f.intents.M.cancelled=true,
   newerNavigation:f=&gt;f.intents.M.revision++,
   newerCommand:f=&gt;f.state.commands.M={type:'character-travel'},
   event:f=&gt;f.state.statuses.P.activeEvent='franky',
   eventReturn:f=&gt;f.state.eventReturn={id:'return'},
   convoy:f=&gt;f.state.activeConvoy={id:'newer'},
   policy:f=&gt;f.state.farmingPolicy='auto',
   nonHuntRecovery:f=&gt;f.state.combatRecovery.policy='auto',
   exit:f=&gt;f.state.monsterHunt.exitMode='auto',
   handled:f=&gt;f.state.combatRecovery.restartedEscapeId='escape-1',
 })</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [79](../scripts/tests/hunt-retreat-restart.test.cjs#L79) — fresh cycle retains pending loot and waits for a dead member without another reset | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### hunt-return-recovery

Healthy rewards do not force manual retry after native fallback failure, a second turn-in after exhausted Town retries, or stale merchant handoff completions.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [4](../scripts/tests/hunt-return-recovery.test.cjs#L4) — explicit return retry retains native fallback and pending rewards | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [17](../scripts/tests/hunt-return-recovery.test.cjs#L17) — a new turn-in resets retry and Town fallback state | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [21](../scripts/tests/hunt-return-recovery.test.cjs#L21) — late '+kind+' completion cannot erase a newer convoy command<br>Matrix: <code>const kind of ['handoff','order-handoff']</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### hunt-return-regression

Removed file: rows 28 to 92 left with the movement rewrite's test cut, which deleted the file with its last row, row 7. The links below name a file that no longer exists; the rows keep their history.

L1 proves real routing. It does not delay planner responses across cancellation, produce two planner failures, or exhaust/rebuild an itinerary under ownership changes.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [7](../scripts/tests/hunt-return-regression.test.cjs#L7) — delayed ALClient result finalizes Hunt '+phase+' without premature movement<br>Matrix: <code>const phase of ['plan-return','prepare']</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. Removed with the `plan-return` phase (the movement rewrite); the Hunt return's goal is checked by live-hunt-lifecycle "a native Boo Boo Hunt crosses real map doors, kills its target and returns to Daisy". |
| [28](../scripts/tests/hunt-return-regression.test.cjs#L28) — Hunt planning diagnostics retain both candidate failures | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [34](../scripts/tests/hunt-return-regression.test.cjs#L34) — a cancelled Hunt cannot install a delayed planner response | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [53](../scripts/tests/hunt-return-regression.test.cjs#L53) — generic route recovery does not disable Town from error text alone | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [70](../scripts/tests/hunt-return-regression.test.cjs#L70) — failed Hunt itinerary reassembles before shared identity exists, retaining Daisy and bounded retries | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [86](../scripts/tests/hunt-return-regression.test.cjs#L86) — already stranded Hunt return rebuilds once under matching ownership | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [92](../scripts/tests/hunt-return-regression.test.cjs#L92) — stranded Hunt recovery rejects '+reason<br>Matrix: <code>const reason of ['cancelled','revision','command','realm','stale','exhausted','initialized']</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### hunt-return-town

Native returns are covered, but these cases deliberately interrupt Town rounds, inject stale attack reports and drive rally/runtime timeout boundaries.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [21](../scripts/tests/hunt-return-town.test.cjs#L21) — the first interrupted Town round selects walking, deduplicates members, and resets only after everyone changes map | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [35](../scripts/tests/hunt-return-town.test.cjs#L35) — unavailable Town selects walking without counting a cast; superseded reports cannot add rounds | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [42](../scripts/tests/hunt-return-town.test.cjs#L42) — one failed Town immediately cancels the round and routes everyone toward the forward Town rally | **Removed after both native Town recovery variants passed the earlier gate.** Actual interrupted follower cast after leader Town arrival selects the forward walking rally, reunites the party and pays both rewards. That earlier uninterrupted run recorded 42,708 ms of owned outward movement; both cases passed without extra attempts, with 133 verified evidence files archived in `.build/town-final-e2e-report/` and `.build/town-final-e2e-results/`. The later recovery11 uninterrupted case also passed (42,807 ms, zero extra attempts), but its restart case caught a false preparation timeout despite both rewards. The subsequent `return-clock-final` rerun passed both Town variants and follower reconnect (3/3, 163 verified artifact hashes), certifying the separate-clock fix for these cases with both actual rewards and no extra Town recovery attempts. |
| [55](../scripts/tests/hunt-return-town.test.cjs#L55) — continuous return ignores defense holds from hits instead of stopping for combat and loot | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [61](../scripts/tests/hunt-return-town.test.cjs#L61) — fresh attackers select walking immediately; stale reports cannot change the route | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [68](../scripts/tests/hunt-return-town.test.cjs#L68) — walking fallback retains movement ownership under live attackers, but cancellation still wins | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [76](../scripts/tests/hunt-return-town.test.cjs#L76) — real client preparation keeps its route and command when an attacker hits | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [101](../scripts/tests/hunt-return-town.test.cjs#L101) — overnight regression: late Town-rally arrival preserves its marker until the moving leader stops | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [111](../scripts/tests/hunt-return-town.test.cjs#L111) — leader stuck moving within the rally radius consumes bounded route recovery, not a runtime failure | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [117](../scripts/tests/hunt-return-town.test.cjs#L117) — runtime incompatibility gets a fresh continuous deadline after compatible rally progress | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### hunt-route-acquisition

L1/L7 prove successful area acquisition. Wrong-phase early receipts, one stale/dead/foreign-instance member and persisted premature-farming repair remain distinct.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [22](../scripts/tests/hunt-route-acquisition.test.cjs#L22) — Hunt route rejects early handoff during '+phase<br>Matrix: <code>const phase of ['assemble','shared-prepare','scheduled','travel']</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [33](../scripts/tests/hunt-route-acquisition.test.cjs#L33) — replacement commands disable legacy early handoff and retain the attack-while-moving target | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [45](../scripts/tests/hunt-route-acquisition.test.cjs#L45) — missing convoy is not proof of arrival; nearby bees and active combat cannot release the route | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [48](../scripts/tests/hunt-route-acquisition.test.cjs#L48) — all members must enter the spawn area, with fresh living same-instance positions | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [58](../scripts/tests/hunt-route-acquisition.test.cjs#L58) — whole-party spawn arrival enables free farming, which may then spread beyond the area | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [63](../scripts/tests/hunt-route-acquisition.test.cjs#L63) — previous premature farming state repairs toward the saved origin despite nearby combat | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [67](../scripts/tests/hunt-route-acquisition.test.cjs#L67) — client does not send a Hunt handoff request or stop an installed route | **Removed — native fighter-death journey passed.** This called a no-op function with throwing stubs. Native outbound armadillo travel, actual kills and Daisy reward catch an unwanted movement stop; asserting that this particular helper never calls HTTP added no distinct workflow protection. |

### hunt-route-recovery

No lifecycle journey exhausts both planners or changes geometry/ownership during route-recovery budget selection.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [21](../scripts/tests/hunt-route-recovery.test.cjs#L21) — native exhaustion selects another monster spawn and never dispatches the suggested door | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [24](../scripts/tests/hunt-route-recovery.test.cjs#L24) — ALClient execution failure gets one native attempt, then another spawn | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [28](../scripts/tests/hunt-route-recovery.test.cjs#L28) — no alternative spawn reports exhaustion without inventing travel | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. The movement owner starts the round of spawns over instead of holding the Hunt (`climbSpawn`); the case checks that restart and that no travel is invented. |
| [32](../scripts/tests/hunt-route-recovery.test.cjs#L32) — saved '+phase+' door recovery is retired<br>Matrix: <code>const phase of ['relocation','post-relocation','held']</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [37](../scripts/tests/hunt-route-recovery.test.cjs#L37) — recovery preserves '+kind+' ownership<br>Matrix: <code>const kind of ['event','merchant','revision','cancelled','dead','turn-in']</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [42](../scripts/tests/hunt-route-recovery.test.cjs#L42) — geometry changes retire the old budget | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### hunt-safety

Healthy Hunt/reward/death workflows overlap this file. The table identifies partial overlap; cancellation, stale identity and multi-batch guard combinations remain retained.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [31](../scripts/tests/hunt-safety.test.cjs#L31) — completed featured kiss return resumes Hunt before the five-minute selection ends | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [40](../scripts/tests/hunt-safety.test.cjs#L40) — reselected Hunt discards the old normal-farming convoy instead of calling it event travel | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [48](../scripts/tests/hunt-safety.test.cjs#L48) — Hunt still waits for a genuine event return even when already standing in the Hunt zone | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [55](../scripts/tests/hunt-safety.test.cjs#L55) — mission destination stays pinned as nearest spawn changes; combat outside radius cannot start regroup convoy | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [60](../scripts/tests/hunt-safety.test.cjs#L60) — first death blacklists current mission, waits for respawn, and counts duplicate reports once | **Removed — L9 passed.** Native death records one failure/death count, holds movement while dead, persists without recounting through restart, then respawns and resumes after blacklist removal. |
| [64](../scripts/tests/hunt-safety.test.cjs#L64) — multiple deaths on the failed quest still allow the next member: '+second<br>Matrix: <code>const second of ['M','P']</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [71](../scripts/tests/hunt-safety.test.cjs#L71) — persisted death observations prevent recounting an old death after restart | **Removed — native threshold-two death/restart passed.** The native character dies, failure count stays one through actual coordinator journal reload, respawn and subsequent real Goo kills. That catches recounting the same persisted death while the same quest remains active. |
| [75](../scripts/tests/hunt-safety.test.cjs#L75) — manual navigation cancellation while awaiting respawn prevents fallback from reviving movement | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [81](../scripts/tests/hunt-safety.test.cjs#L81) — a follower quest cannot replace a missing leader quest | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [84](../scripts/tests/hunt-safety.test.cjs#L84) — return planning waits for compatible runtimes without consuming retries | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [93](../scripts/tests/hunt-safety.test.cjs#L93) — unfinished leader farms until expiry despite optional fighting: '+remainingMs<br>Matrix: <code>const remainingMs of [180001,180000,179999,60000,1,0]</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [103](../scripts/tests/hunt-safety.test.cjs#L103) — completed leader returns immediately and protects incidental follower claims until confirmed | **Trimmed — L3 passed.** Removed three redundant assertions for basic return/claim dispatch. Retained the delayed follower telemetry and pending-event-before-refill protection; renamed the case to describe those unique guards. |
| [120](../scripts/tests/hunt-safety.test.cjs#L120) — unfinished leader already at Daisy under the old policy resumes farming instead of waiting for expiry | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [130](../scripts/tests/hunt-safety.test.cjs#L130) — failed protected turn-in remains held without recreating its retry budget or releasing ownership | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [145](../scripts/tests/hunt-safety.test.cjs#L145) — leadership switches targets and releases a turn-in owner who leaves the party | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [154](../scripts/tests/hunt-safety.test.cjs#L154) — Hunt preserves anniversary return and resumes after '+reason<br>Matrix: <code>const reason of ['kiss-timeout']</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [167](../scripts/tests/hunt-safety.test.cjs#L167) — lost same-map return routes back into the shaped hunt zone | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [175](../scripts/tests/hunt-safety.test.cjs#L175) — new hunt departs directly from Daisy even when the generic shortcut would choose Town | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [192](../scripts/tests/hunt-safety.test.cjs#L192) — event return releases a completed hunt straight to protected Daisy turn-in | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [199](../scripts/tests/hunt-safety.test.cjs#L199) — missing follower quests never cause a pickup detour: '+remainingMs<br>Matrix: <code>const remainingMs of [1500000, 1500001, 1499999]</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [205](../scripts/tests/hunt-safety.test.cjs#L205) — resume preserves cycle and deaths without filling followers after leader received quest | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [218](../scripts/tests/hunt-safety.test.cjs#L218) — any older quest skips missing pickup, even when another quest is fresh | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [223](../scripts/tests/hunt-safety.test.cjs#L223) — legacy interrupted assigning stage is resumed even without a stored pickup flag | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [231](../scripts/tests/hunt-safety.test.cjs#L231) — expired unanswered assignment retries only with a newer fresh status | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [238](../scripts/tests/hunt-safety.test.cjs#L238) — blacklisted leader quest selects a follower and keeps its owner through combat and turn-in | **Removed — native fighter-death E2E passed.** The real leader dies during a Goo Hunt; native respawn completes, eligible follower becomes armadillo quest owner, kills both targets and receives the actual Daisy reward. This replaces the isolated selected-follower combat/turn-in progression. |
| [247](../scripts/tests/hunt-safety.test.cjs#L247) — blacklisted followers are skipped while a nearly expired eligible quest is still farmed | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [254](../scripts/tests/hunt-safety.test.cjs#L254) — all active quests blacklisted retains Hunt and travels to backup instead of Daisy | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [268](../scripts/tests/hunt-safety.test.cjs#L268) — backup boundary drift cannot start travel while a nomination or attack remains valid | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [277](../scripts/tests/hunt-safety.test.cjs#L277) — backup arrival releases only its own convoy once; defense retains ownership | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [285](../scripts/tests/hunt-safety.test.cjs#L285) — backup waits for all three expiries then assigns the whole batch before selecting a mission | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [300](../scripts/tests/hunt-safety.test.cjs#L300) — offline members do not block batch readiness; restart and event return preserve the current batch | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [307](../scripts/tests/hunt-safety.test.cjs#L307) — backup preserves explicit cancellation and resumes a newly unblacklisted quest | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [313](../scripts/tests/hunt-safety.test.cjs#L313) — explicit roster removal releases only that member from the expiry batch | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [318](../scripts/tests/hunt-safety.test.cjs#L318) — another entirely blacklisted batch returns to backup without ending Hunt | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [326](../scripts/tests/hunt-safety.test.cjs#L326) — blacklist survives cycle restart and clearing entry makes it eligible again | **Partial: L2/L9.** Blacklist persistence and clearing are exercised. Retain explicit cycle-restart eligibility semantics until confirmed by native assertions. |
| [330](../scripts/tests/hunt-safety.test.cjs#L330) — blacklist API removes individually, clears all, and rejects unknown actions | **Removed — L8 passed.** Real API removes one blacklist entry while preserving another, rejects an unknown action atomically, then clears all. The active Hunt subsequently earns a native reward. |
| [339](../scripts/tests/hunt-safety.test.cjs#L339) — failed leader gets a fresh follower quest; only all three blacklisted quests trigger fallback | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [359](../scripts/tests/hunt-safety.test.cjs#L359) — receiving an already blacklisted quest immediately assigns only the next member | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [377](../scripts/tests/hunt-safety.test.cjs#L377) — old early handoff receipt does not bypass full-party origin arrival | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [382](../scripts/tests/hunt-safety.test.cjs#L382) — arrival grace expires and permits recovery from a genuine outside position | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [388](../scripts/tests/hunt-safety.test.cjs#L388) — superseded arrival receipt does not suppress recovery: '+mutate.toString()<br>Matrix: <code>const mutate of [t=&gt;t.hunt.cycleId='new',t=&gt;t.hunt.currentIndex++,
  t=&gt;t.party.statuses.W.combatSelection.runtimeId='new',t=&gt;t.r.farmingNavigation.intent=()=&gt;({revision:8,cancelled:false})]</code> | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [392](../scripts/tests/hunt-safety.test.cjs#L392) — arrival grace cannot delay a completed hunt turn-in or revive cancelled navigation | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [399](../scripts/tests/hunt-safety.test.cjs#L399) — an expired unfinished quest is blacklisted before acquiring the next quest | **Partial: L2.** Native expiration and reacquisition are exercised; the bundled safety fixture also checks the precise selection transition. |
| [408](../scripts/tests/hunt-safety.test.cjs#L408) — completed anniversary convoy cannot trap the saved at-Daisy stage after coordinator restart | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [416](../scripts/tests/hunt-safety.test.cjs#L416) — death below threshold resumes the same Hunt; enabled='+enabled<br>Original matrix: <code>const enabled of [true,false]</code> | **Trimmed — L10 passed.** Removed enabled=true: first native death/restart resumes the same cycle; second death crosses threshold two and persists. Retained enabled=false, whose disabled-blacklisting behavior is distinct. |

### hunt-selector

Console Hunt E2E clicks real controls; it does not render all ended/blacklisted/batch/stale-member status variants asserted here.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [35](../scripts/tests/hunt-selector.test.cjs#L35) — Hunt remains clickable and explains blacklist fallback after returning to Auto | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [48](../scripts/tests/hunt-selector.test.cjs#L48) — active Hunt still shows its current progress | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [55](../scripts/tests/hunt-selector.test.cjs#L55) — ordinary farming without Hunt history does not show an empty Hunt panel | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [58](../scripts/tests/hunt-selector.test.cjs#L58) — backup status shows batch readiness instead of three-minute turn-in advice | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### hunt-settings

L2/L8 cover expiration and an invalid mutation. Threshold migration, disabled counters, atomic mixed-field updates and stale expiry reports remain distinct.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [8](../scripts/tests/hunt-settings.test.cjs#L8) — defaults, historical migration, accumulated thresholds and restart persistence | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [17](../scripts/tests/hunt-settings.test.cjs#L17) — settings endpoint validates atomically, preserves disabled counts, evaluates changes and cancels pending conflict | **Trimmed — L8 passed.** Removed four invalid-shape iterations and the zero-save assertion. Retained disabled-count accumulation, threshold reevaluation and pending competition cancellation. |
| [30](../scripts/tests/hunt-settings.test.cjs#L30) — expiry counts attempted unfinished quests once, survives restart and ignores completed and stale reports | **Partial: L2.** Real native expiry counts once and survives restart. Retain stale status and completed-quest exclusion, not forced by L2. |

### hunt-spawn-preferences

L7 now selects a farther bee spawn, persists it and observes actual combat there. Manual/unavailable preference fallback and preserving other monster patches remain distinct.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [11](../scripts/tests/hunt-spawn-preferences.test.cjs#L11) — Hunt preference survives settings save and restart; manual and unavailable routes use normal ranking | **Trimmed — L7 passed in remaining54.** Removed save-count and restored preferred-area assertions after native farther-spawn persistence, arrival and actual kills passed. Retained manual selection, unavailable preference and preference clearing assertions; renamed the remaining case accordingly. |
| [25](../scripts/tests/hunt-spawn-preferences.test.cjs#L25) — spawn patches retain other monsters and reject invalid selections atomically | **Removed — L8 passed.** Native API rejects every original invalid spawn shape and unknown key, preserves another monster preference during valid patching, and the active Hunt earns a real reward. |

### hunt-spawn-settings-ui

The console settings journey does not open the spawn radio popup or exercise a failed save.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [6](../scripts/tests/hunt-spawn-settings-ui.test.cjs#L6) — spawn popup lists multiple zones, saves radio preferences and reports failed saves | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### monster-hunt-start

L8 covers invalid backup followed by successful real Hunt completion. Missing Daisy/backup setup and idempotent active reselection remain distinct.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [13](../scripts/tests/monster-hunt-start.test.cjs#L13) — reselecting stalled Hunt resumes; repeating an active Hunt selection does not cancel its convoy | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [14](../scripts/tests/monster-hunt-start.test.cjs#L14) — missing Daisy catalog rejects without changing policy or navigation | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [16](../scripts/tests/monster-hunt-start.test.cjs#L16) — missing normal waypoint requires setup without changing farming mode | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [19](../scripts/tests/monster-hunt-start.test.cjs#L19) — valid backup is saved with monster selection before Hunt starts; invalid backup makes no changes | **Removed — L8 and console Hunt passed.** Invalid backup is rejected without changing the nonempty current cycle and native reward completes. The console Hunt journey verifies saving the valid backup/focus and retaining it after mode exit. |

### monster-spawn-ui

Native catalog acceptance is covered in live-catalog.spec.ts, but old version-2 upgrade negotiation and the browser loading/restricted-spawn display are not injected there.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [16](../scripts/tests/monster-spawn-ui.test.cjs#L16) — spawn display distinguishes loading, missing records, ordinary routes and restrictions | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [30](../scripts/tests/monster-spawn-ui.test.cjs#L30) — spawn version 2 triggers refresh and version 3 satisfies catalog discovery | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### solo-hunt-ui

L5 starts solo through the real API; it does not verify inherited read-only controls or saved-vs-effective UI state.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [16](../scripts/tests/solo-hunt-ui.test.cjs#L16) — following keeps saved Hunt selected, allows saved mode edits while keeping inherited settings read-only | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |

### solo-hunt

L5 proves an unfollowed priest can claim a native reward without activating the warrior. Concurrent controllers, ownership migration and Follow toggles remain distinct.

| Source case (line at audit) | Disposition and remaining edge |
| --- | --- |
| [38](../scripts/tests/solo-hunt.test.cjs#L38) — legacy leader migrates once; personal defaults and blacklists remain independent after restart | **Partial: L5.** Separate profiles are exercised. Legacy profile migration and independent persisted blacklist settings are not. |
| [49](../scripts/tests/solo-hunt.test.cjs#L49) — concurrent Hunts select their own quests and clearing solo travel leaves the group running | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [63](../scripts/tests/solo-hunt.test.cjs#L63) — simultaneous pickups use separate cycle IDs and commands; unrelated quests cannot bypass solo blacklist | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [77](../scripts/tests/solo-hunt.test.cjs#L77) — Hunt -> Follow -> leader Auto -> Follow off restores personal Hunt without an obsolete route | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [97](../scripts/tests/solo-hunt.test.cjs#L97) — second singleton and leader change never merge profiles or retain a previous group convoy | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [108](../scripts/tests/solo-hunt.test.cjs#L108) — scope-owned event recovery does not pause the other Hunt | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [117](../scripts/tests/solo-hunt.test.cjs#L117) — HTTP controls reject inherited edits, address solo settings, and report saved/effective mode | **Removed — L5/L8 passed.** Real scoped HTTP rejects follower/merchant/unknown edits, returns solo saved/effective metadata, and keeps solo/leader settings independent while the solo character completes a real Hunt. |
| [136](../scripts/tests/solo-hunt.test.cjs#L136) — all-blacklisted fallback contains only the singleton | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [145](../scripts/tests/solo-hunt.test.cjs#L145) — restart invalidates both routes separately and never recovers an old runtime command | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [154](../scripts/tests/solo-hunt.test.cjs#L154) — a late solo interaction acknowledgement cannot modify the group after Follow is enabled | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
| [168](../scripts/tests/solo-hunt.test.cjs#L168) — a departing selected quest owner cannot leave the group pursuing that character’s quest | **Retain.** The named injected condition/combination has no equivalent native assertion in L1–L10; healthy travel or reward alone cannot establish this guard. |
