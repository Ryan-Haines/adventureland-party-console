# Hunt interruptions: failure inventory before implementation

Native scenarios must expose these failures before corresponding units can be removed:

- An armadillo quest suppresses configured passing Goo attacks outbound, or retaliation replaces the Hunt destination. Passing attacks on the return leg must also happen without losing Daisy ownership or its reward.
- A merchant rendezvous takes ownership of a travelling fighter and never releases the party; collection duplicates or loses inventory; resumed travel changes the quest or destination.
- Merchant death while a queued or active job owns work loses durable intent, retries an already-completed transfer, or blocks the Hunt indefinitely.
- Fighter death leaves a stale Hunt/combat owner, prevents native respawn, or permits the same failed mission to continue despite blacklist policy.
- Coordinator restart while merchant collection is interrupting travel loses the continuation or replays the item transfer.

Setup may seed initial quest/inventory or introduce native monsters at a controlled encounter point. Monsters must die from native attacks, inventory must move through native socket handlers, and Daisy must award the token. No fabricated heartbeat, arrival, acknowledgement, HP decrement or reward assignment is permitted. Root runs the shared game stack serially. New cases remain **unverified** until its native run passes.

The inventory below distinguishes race/negative variants from ordinary scenarios. A passing normal journey cannot justify deleting delayed acknowledgements, changed generations, deadline boundaries, or unrelated event ownership variants. Remove a unit case only after matching native evidence is available.

## Scenario contracts and audit inventory

- **HC-PASS**: armadillo quest; identified native Goo attack and death outbound and returning; exactly one real Daisy token for each seeded quest owner.
- **HC-STOP**: configured stop-required Goo; observe the identified encounter committed by a defending convoy, toggle passing back on without abandoning the fight, then native kill, original armadillo cycle/target preserved and Daisy reward. The newly introduced Goo starts at five seconds of the fighters' actual server attack × frequency, recorded in the artifact, so the stopped interval remains observable under either fixture loadout; native combat alone removes that HP.
- **MH-DEATH**: leader dies during Goo Hunt; native respawn; eligible follower armadillo quest takes ownership and yields its token.
- **MH-COLLECT**: real marked seven-leather collection during owned outbound Hunt; coordinator restart, queued merchant death and active interrupted-job death variants; preserved Hunt cycle, conserved inventory/bank, cleared durable job, exactly one native Hunt reward for each owner and restart.

**MH-DEATH passed against the native server**: one leader death, native respawn, Goo blacklist, follower armadillo ownership and actual Daisy reward. **All three MH-COLLECT variants passed** in the fresh native run: coordinator restart (1.8 minutes), queued merchant death (3.0 minutes), and active merchant death. Removed two expanded unit cases now replaced by that evidence: the ordinary monster-hunt collection variant and persisted merchant-interruption restart. Subsequent HC-PASS, HC-STOP, cold-defense and ordinary Town recovery native runs also passed; final combined-run results remain separate from these focused proofs. Each source declaration is listed; loop expressions identify expanded families instead of pretending one declaration equals one runtime case. Candidates remain until the matching native case passes, and each extra negative/ordering branch still needs its own proof.

The separate recovery suite injects one follower completion-request loss, one completion-response loss, and a follower reconnect. Only the transient completion-network branch overlaps directly with its first two cases. It does not inject sustained report loss, clock skew, reordering, repeated reconnects, or mismatched ownership identities.

The first travel-combat run exposed a test precondition mistake: public coordinator phase is `travel`, whereas `shared-travel` describes a client command. It timed out before introducing either controlled Goo, so that failure is not evidence of a program combat bug. The corrected return precondition also requires actual native walking outside a Town cast; attacking is intentionally suppressed during map transitions. Controlled encounters carry an `e2eHunt` marker solely for between-test cleanup.

The merchant restart scenario caught a **program bug**: manual `/bank-party` requests create `party collection` jobs, but item handoff filtering recognized only legacy `marked items` and `inventory cleanout` names. Native logs showed both party visits succeeding and transferring gold, while the seven authorized leather remained on the warrior and the queue was empty. The maintained fix shares collection recognition across dispatch, handoff and live pickup revalidation. All three native merchant interruption variants subsequently passed with the maintained fix; this is not evidence that restart itself discarded a job. Exact cargo conservation is stable because the pinned server's armadillo, Goo, Mainland and global loot tables do not award leather.

### hunt-travel-defense.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| outbound party admits only one simultaneous proposal and retains it out of range | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| natural attacker wins before a voluntary proposal; one travels, extra aggro defends | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| a second attacker interrupts even before the reserved primary retaliates | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| defense stays latched for one survivor and resumes the same destination after loot | Retain: loot-specific outcome | Actual loot ownership, chest availability and capacity are not proved by a quest token or a marked merchant stack. |
| stale observations hold travel; outsiders and duplicate identities do not add attackers | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| admission rejects an old target grant immediately after shared primary changes | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| fresh bounded absence retires the primary without reviving its reservation | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |
| defensive combat promotes cached passing encounters and retains the original primary | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| client counts raw passing aggro, pauses locally, and releases passing suppression | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| purpose+': neutral stop-required Phoenix selects committed combat before passing admission' | Removed `monster-hunt`; retain `party-travel` | HC-STOP passed as case 31 in the full native run, proving actual stopped commitment, keepMoving toggle retention, native kill, loot handback and both Daisy rewards. Other travel ownership remains distinct. |
| single naturally aggroed Phoenix stops despite a cached passing grant | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| explicit stop overrides matching Hunt species; disabled rule leaves the Hunt exception intact | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| turning keepMoving off revokes a primary grant; turning it on does not abandon commitment | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| a Phoenix stop preserves the original mole primary and queues the Phoenix | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| protected movement and stale, dead, or externally targeted sightings cannot acquire a passive stop | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| reconciled defense evaluates a fresh neutral Phoenix under passive priority | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| fresh attacking hawk outranks a committed phoenix; inactive retained hawks are released | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| dead phoenix remains retired while its respawn is eligible; absence needs newer live evidence | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| missing attacker observations defer incidental release | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| held acknowledgement survives defense races and obsolete passive-stop signals | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| only a newer owned defense command releases a held client into normal combat | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |

### travel-defense.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| visible historic fight and recent outgoing evidence do not block normal travel | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| follower attack blocks; deaggro releases without a death after confirmed loot | Retain: loot-specific outcome | Actual loot ownership, chest availability and capacity are not proved by a quest token or a marked merchant stack. |
| outside targets and different realms or instances cannot block travel | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| a confirmed dead monster left in a client entity cache cannot hold return | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| fresh empty travel observations authorize departure even when the last monster packet is old | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| missing and stale observations explicitly stop a moving route and resume without inventing a fight | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| new attack invalidates loot completion; invalid acknowledgements cannot release the route | Retain: loot-specific outcome | Actual loot ownership, chest availability and capacity are not proved by a quest token or a marked merchant stack. |
| retired passive fight cannot return from delayed evidence or cached snapshots; a new attacker can | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |
| already stuck bee return starts with separated members and no active attackers | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| unfinished Hunt loot survives return stage and rejects stale or displaced completion | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| travel ownership suppresses pulls only until cancellation, supersession, arrival or emergency override | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| delivered individual travel remains active from fresh client ownership and ends on completion or newer navigation | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| joining Franky releases the old Daisy waiting restriction without bypassing an actual movement command | Retain: separate event scenario | Event-specific round, reward or return authority; these merchant/passing journeys do not inject that event transition. |
| 'authorized rare handoff releases Hunt combat suppression during '+stage — loop ['mission-travel','returning','daisy-sync-travel'] | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |

### travel-defense-client.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| 'travel rejects a passive retained bee but allows a current follower attacker; grouped='+grouped — loop [false,true] | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| local travel departs with a retained passive target and waits only until a live attacker disengages | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| explicit hunt acquisition bypasses travel and destination gates while retaining claims and failed approaches | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |
| cancelled and superseded travel controls cannot keep suppressing farming | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| quiet connected maps report a fresh empty observation; disconnected clients cannot authorize travel | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |
| an individual command keeps travel targeting until its local movement completes, even without a coordinator command | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| the shared confirmed-death record excludes a cached monster whose old target still names a follower | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| continuous Hunt return reports passing attackers for the walking policy without granting normal combat ownership | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |

### passing-admission.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| `retaliation after ${delay}ms projectile delay never freezes an acknowledged convoy` — loop [0,100,900] | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |
| missing acknowledgement skips repeated optional shots without surrendering the travelling handle | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |
| simultaneous senders reserve the same identity without starving each other | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| reordered controls cannot restore a grant after runtime, route, realm or membership changes | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| stale approval, dead target, and reused identity cannot use an old grant | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| three real convoy executors reach the endpoint through successive passing retaliations | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| fresh heartbeats cannot renew an acknowledgement from a lost response channel | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| unused reservations expire even while the un-attacked monster remains visible | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |
| late passing evidence rebuilds the latched owned route without a combat loot hold | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| late classification cannot clear another attacker, manual navigation or a newer command | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| an already acknowledged coordinator defense also releases a corrected passing-only cause | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| a later passing classification cannot erase loot owed to an earlier genuine defensive kill | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| combat transport publishes reservations and returns peer acknowledgements without a selected target | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |

### passive-hunting.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| legacy selections migrate; independent edits preserve selections and keep moving defaults off | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| passing chooses priority only in range, without any movement dependency, including stationary attacks | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| retaliation stays movement-neutral for the attacked identity, not other monsters of that type | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| verified Hunt farming releases local and peer passing ownership without changing outbound travel | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| farming Hunt queue accepts a target with cached and freshly reported travel passing marks | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| passing attacks yield to Town from reservation through settled transition | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| ordinary protocol 4 passing attacks require the current travelling signal | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. Since the movement rewrite every group walk is the one walk, and the `routeProtocol` marker is gone; passing-admission keeps the travelling signal row. |
| an unreserved monster attacking first stays a genuine defensive target | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |
| Phoenix patrol permits in-range passing attacks but encounters and recovery still take precedence | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| field-generator preference governs passing Fairy use without moving | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| queue and travel defense reject passing ownership from nominations, hits and retaliation | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| actual attack controller sends passing attacks without queue evidence or normal combat side effects | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| passing retaliation cannot cancel a return convoy; unrelated attackers still defend | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| Hunt return passing attacks wait for an owned travelling route and yield to every transition | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| Hunt return attacks nearby aggressors while walking without requiring a passive hunting rule | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |
| a pending passing attack burst cannot send again after the return starts preparing | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| outbound Hunt attacks its in-range target without passive settings and never during route preparation | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| outbound Phoenix stop setting excludes passing attacks and reports eligible neutral sightings | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |

### passive-healing.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| 'regular healing continues during ' + flag — loop ['anniversaryStaging', 'anniversaryBusy', 'convoyTraveling', 'eventTraveling', 'followingLeader', 'partyTownActive'] | Retain: healing-specific branch | Healing resource selection, priority or overlapping cast is not asserted by death/respawn alone. The `convoyTraveling` flag is gone since the movement rewrite: walk-client.ts reads a running group walk's travel (`groupWalk.travel`). |
| movement allows regular heals and priest regeneration in the same pulse | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| only an acknowledged heal publishes success telemetry | Retain: healing-specific branch | Healing resource selection, priority or overlapping cast is not asserted by death/respawn alone. |
| passive pulse never uses partyheal even for multiple critical members | Retain: healing-specific branch | Healing resource selection, priority or overlapping cast is not asserted by death/respawn alone. |
| ordinary combat retains the 90 percent threshold and critical partyheal | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| skip unreachable, dead, other-map and opposing-team members without moving | Retain: healing-specific branch | Healing resource selection, priority or overlapping cast is not asserted by death/respawn alone. |
| no heal when dead, out of mana, on cooldown, stale-full, or an ordinary combat pulse | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| pending heals cannot overlap role healing; rejection releases the guard | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| topping off the warrior lets existing regeneration select MP | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| merchant cannot take regular healing priority or trigger partyheal with one injured fighter | Retain: healing-specific branch | Healing resource selection, priority or overlapping cast is not asserted by death/respawn alone. |
| live merchant identity is rejected even when snapshot class is missing | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| merchant uses actual potion healing amount rather than HP percentage, even during a service job | Retain: healing-specific branch | Healing resource selection, priority or overlapping cast is not asserted by death/respawn alone. |
| merchant potion follows inventory selection, respects cooldown, and cannot overlap requests | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |

### passive-hunting-ui.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| searchable menu saves separate enable, movement, priority and generator choices with readable controls | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |
| closing nested monster details preserves both passive hunting and farming dialogs | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |

### passive-rare-queue.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| client reports enabled out-of-area rares from followers but excludes disabled, dead and claimed monsters | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| actual coordinator snapshot retains a rare-owned queue and all clients derive its targeting rings | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| claim reports preserve cooperative bosses and are completely disabled during events | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| rare retry expiry allows fresh nominations while rejecting delayed abandoned attack evidence | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |

### merchant-convoy-interruption.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| merchant collection waits for communication recovery without capturing its internal phase | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| legacy merchant continuation captured during communication recovery prepares a new route | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| purpose+' pauses all members, collects once, and resumes its destination' | Removed `monster-hunt` variant; retain other three purposes | Native MH-COLLECT restart and queued-death artifacts prove actual collection, conserved cargo and both Hunt rewards. Event-return, shared-walk-return and empty-spawn-recovery owners remain distinct. |
| commerce pauses, timeout waits for stopped acknowledgement, and stale completion cannot clear travel | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| manual navigation supersedes the saved merchant continuation | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| merchant collection cannot replace the event-return parent between walking legs | Retain: separate event scenario | Event-specific round, reward or return authority; these merchant/passing journeys do not inject that event transition. |
| another recipient must wait for the first collection to release the convoy | Retain: distinct collection condition | MH-COLLECT proves a marked stack transfer around its injected fault. The reservation, processing, ownership or ordering condition named here requires separate evidence. |
| a persisted interrupted convoy resumes with fresh commands after restart | Removed | Native MH-COLLECT coordinator-restart artifact proves interrupted ownership before actual restart, resumed collection, conserved cargo, both rewards and another persistence restart. |
| collection during assembly initializes stop acknowledgements before the first shared route | Retain: distinct collection condition | MH-COLLECT proves a marked stack transfer around its injected fault. The reservation, processing, ownership or ordering condition named here requires separate evidence. |
| 'orphaned Snowman exit in '+map+' releases recovery without losing the checkpoint' — loop ['main','winterland'] | Retain: separate event scenario | Event-specific round, reward or return authority; these merchant/passing journeys do not inject that event transition. |
| merchant resumption processes combat before waiting for held reports | Retain: distinct collection condition | MH-COLLECT proves a marked stack transfer around its injected fault. The reservation, processing, ownership or ordering condition named here requires separate evidence. |
| purpose+' resumes after merchant '+reason+' without accepting a late handoff' — loop ['failure','timeout','clear','force','realm']; ['monster-hunt','shared-walk-return','event-return','empty-spawn-recovery'] | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| job release keeps newer commands and equipment ownership intact | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| late commerce receipt for an ended job does not overwrite the next job | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |

### merchant-anniversary-reservation.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| merchant work is reserved throughout the ninety-second anniversary lead-up | Retain: separate event scenario | Event-specific round, reward or return authority; these merchant/passing journeys do not inject that event transition. |
| merchant work is not reserved before the ninety-second anniversary lead-up | Retain: separate event scenario | Event-specific round, reward or return authority; these merchant/passing journeys do not inject that event transition. |
| merchant work remains reserved through retries until the live kiss completes | Retain: separate event scenario | Event-specific round, reward or return authority; these merchant/passing journeys do not inject that event transition. |
| completion from a previous round cannot release a new live visit | Retain: separate event scenario | Event-specific round, reward or return authority; these merchant/passing journeys do not inject that event transition. |
| aborted round releases stale busy state | Retain: separate event scenario | Event-specific round, reward or return authority; these merchant/passing journeys do not inject that event transition. |
| persisted claim releases a restarted merchant only for its matching round | Retain: separate event scenario | Event-specific round, reward or return authority; these merchant/passing journeys do not inject that event transition. |
| client and coordinator release the same featured round after reload and retain the next round | Retain: separate event scenario | Event-specific round, reward or return authority; these merchant/passing journeys do not inject that event transition. |
| restarted client restores its recorded claim and does not release a later round | Retain: separate event scenario | Event-specific round, reward or return authority; these merchant/passing journeys do not inject that event transition. |

### automatic-collection.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| automatic upgrade, compound and sale pickups merge at collection priority and capacity | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |
| selection respects disabled processing, slot uniqueness, locked items and reservations | Retain: distinct collection condition | MH-COLLECT proves a marked stack transfer around its injected fault. The reservation, processing, ownership or ordering condition named here requires separate evidence. |
| ordinary collection excludes manual NPC sale reservations but manual pickup still works | Retain: distinct collection condition | MH-COLLECT proves a marked stack transfer around its injected fault. The reservation, processing, ownership or ordering condition named here requires separate evidence. |
| pending migration preserves earliest age and unrelated work without touching active jobs | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| collection handoff uses keep receipts and sends no processing instructions | Retain: distinct collection condition | MH-COLLECT proves a marked stack transfer around its injected fault. The reservation, processing, ownership or ordering condition named here requires separate evidence. |
| planned activity separates bank retrieval from merchant inventory processing | Retain: distinct collection condition | MH-COLLECT proves a marked stack transfer around its injected fault. The reservation, processing, ownership or ordering condition named here requires separate evidence. |
| Hunt movement blocks dispatch without pruning work and defers a raced handoff | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| protected work does not prevent unrelated merchant selection and becomes eligible on release | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| character handoff helper yields immediately for Hunt ownership instead of polling or proceeding | Retain: distinct collection condition | MH-COLLECT proves a marked stack transfer around its injected fault. The reservation, processing, ownership or ordering condition named here requires separate evidence. |

### automatic-collection-client.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| automatic pickup sends only the currently authorized unreserved quantity as kept cargo | Retain: distinct collection condition | MH-COLLECT proves a marked stack transfer around its injected fault. The reservation, processing, ownership or ordering condition named here requires separate evidence. |
| disabled rules, locked items and stale slots cannot send an automatic pickup | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| activity reports only processing commands and suppresses duplicate stage reports | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |

### coordinator-merchant-completion.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| upgrade and compound communication failures preserve work with escalating durable delays | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |
| transient lucky-slot input loss retries automatic upgrades without a capacity block | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |
| authentication timer confirms and publishes later | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| deferred automatic compounds never fabricate manual improvement jobs | Retain: distinct collection condition | MH-COLLECT proves a marked stack transfer around its injected fault. The reservation, processing, ownership or ordering condition named here requires separate evidence. |
| empty deferred work creates no follow-up, and automatic upgrade marks keep their classification | Retain: distinct collection condition | MH-COLLECT proves a marked stack transfer around its injected fault. The reservation, processing, ownership or ordering condition named here requires separate evidence. |
| Hunt ownership defers once with the same job identity and preserved progress | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |

### coordinator-merchant-progress.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| handoff respects protected Hunt travel and preserves newer commands on old acknowledgements | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| commerce handoff requires a reserved source and records delivered material without clearing another command | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |
| merchant heartbeat clamps future progress and batch status picks only the same collection batch | Retain: distinct collection condition | MH-COLLECT proves a marked stack transfer around its injected fault. The reservation, processing, ownership or ordering condition named here requires separate evidence. |
| checkpoint preserves current work on equal priority and yields durable resume state to higher-priority gathering | Retain: distinct collection condition | MH-COLLECT proves a marked stack transfer around its injected fault. The reservation, processing, ownership or ordering condition named here requires separate evidence. |
| cleared marks stop the next protected action without removing the active operation | Retain: distinct collection condition | MH-COLLECT proves a marked stack transfer around its injected fault. The reservation, processing, ownership or ordering condition named here requires separate evidence. |
| merchant activity accepts known stages only for merchant-owned work | Retain: distinct collection condition | MH-COLLECT proves a marked stack transfer around its injected fault. The reservation, processing, ownership or ordering condition named here requires separate evidence. |
| event checkpoint preserves job identity and resume data and rejects duplicate yields | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |

### convoy-combat-handoff.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| travel acquisition uses monster distance from destination waypoint, never character distance | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |
| authorized ordinary farming acquires configured monsters near the party before its destination map | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |
| monster picker travel acquires visible wild boar before reaching its spawn | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |
| accepted engagement releases convoy and sends revision-bound individual recovery to late members | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| event return reconciliation preserves the combat handoff instead of recreating travel | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| stale identity, revision, wrong map, outside radius and preparation never release routes | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |

### convoy-defense.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| 'defense interrupts '+phase+' and rebuilds a fresh convoy after confirmed death' — loop ['assemble','plan-return','scheduled','travel','failed'] | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. No walk has a `plan-return` phase: the movement rewrite removed it with the Hunt return's legs as unreachable code, since every Hunt return is a continuous return. |
| follower aggressor pauses the convoy; a planned neutral does not | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| 'anniversary return defends during '+phase+' and resumes after loot' — loop ['assemble','plan-return','scheduled','travel'] | Retain: separate event scenario | Event-specific round, reward or return authority; these merchant/passing journeys do not inject that event transition. No walk has a `plan-return` phase: the movement rewrite removed it with the Hunt return's legs as unreachable code, since every Hunt return is a continuous return. |
| escape and event convoys retain their travel policy | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| lost death-return assembly command is reissued without losing destination or accepting old acknowledgements | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| Hunt mode does not authorize a new destination while fighting, and convoy startup waits | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| late merchant recovery cannot delete a replacement convoy and command transitions identify their caller | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| client interruption releases its route and ignores stale convoy signals | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| protocol 4 local defense retains an identifiable handle until the coordinator acknowledges it | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| an old invisible engagement cannot hold departure, but a visible party attacker can | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| travel loot failure retries, rejects stale acknowledgements, and a new attacker invalidates the pass | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |

### combat-disengagement.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| backup farming retains three neutral nominations through coordinator preparation; departure still suppresses them | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| one death finishes only at inclusive 25/50 thresholds, with no new pulls | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |
| cause+' immediately escapes and clears the abandoned lock' — loop ['healthy enemy','low survivor','missing monster HP','stale survivor','no enemies','wipe'] | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| new attacker or second death ends the finishing window | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| confirmed completion escapes then resumes only after everyone safely returns above 50 percent | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| Hunt resumes through its controller and manual navigation cancels automatic return | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| collaborative event deaths never start farming disengagement | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| legacy death recovery does not reset the queue at Hunt travel boundaries | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| reset epoch rejects old evidence, threats and restored state; fresh reports reacquire actual attackers | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| dead class members go straight to escape recovery rather than waiting on their skills | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| failed return start remains durable across controller reload and retries without resetting again | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| escape convoy cannot hide a manual navigation revision change | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| failed return convoy retries with delay, survives reload and completes only at the farm | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |

### combat-movement.test.cjs

The reflection row below keeps its test's title; the block it names reads each character's
reflect lists.

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| group commitment is checked at attack time while movement and defensive support remain available | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| warrior selects and taunts a passive Porcupine without attacking, allowing grouped casters to engage | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| dangerous monster guard checks current weapon stats immediately before attacking | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| solo hunt can replace an untouched target but retains one with an attack in flight | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| shared melee bow swap follows authoritative current target and blocks attacks until equipment settles | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |
| reflection guard keeps priest healing available and permits physical ranged attacks | Retain: healing-specific branch | Healing resource selection, priority or overlapping cast is not asserted by death/respawn alone. |
| moving attacks and movement continue while support and move promises never settle | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| mage and priest combat follow the selected leader regardless of the Steam character | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |
| latest visibility, claims, map, death, ownership and reload block attacks | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| attack acknowledgement clears an older error but preserves a newer failure | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| crab server rejection activates geometry correction, throttles, and expires without renewing on success | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |
| superseded crab attack rejection cannot activate correction for a new selection | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| healing reserves basic attack without stopping movement or waiting for support | Retain: healing-specific branch | Healing resource selection, priority or overlapping cast is not asserted by death/respawn alone. |
| a moving grouped priest cannot acquire nearer B while leader A is selected or unavailable | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |
| full-health kiting refreshes before arrival for melee and ranged weapons | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |
| approach and retreat respect weapon range and the character side, including moving warriors | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| blocked paths never fall back to unvalidated movement, and alternate kite direction works | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| blocked kiting around an add yields to a safe approach toward the selected event boss | Retain: separate event scenario | Event-specific round, reward or return authority; these merchant/passing journeys do not inject that event transition. |
| blocked kite fallback cannot approach through another attacker or a wall | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| event add avoidance closes boss range first and cannot kite away from the boss | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| event corner search finds another safe direction while remaining in boss range | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| Dash cannot overshoot the weapon range boundary | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |
| burst sends one immediate and four interval attempts, and compensates once for duplicate successes | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| late scheduler sends one attack instead of replaying expired burst slots | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| early cooldown rejection preserves later slots, success cancels unsent attempts | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| healing reservation cancels remaining burst slots | Retain: healing-specific branch | Healing resource selection, priority or overlapping cast is not asserted by death/respawn alone. |
| selection retains a valid target and immediately changes on confirmed death | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| successor wake uses the existing attack deadline and ignores the previous target promise | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |
| a revoked fight authorization cancels the remaining four attack attempts | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| nearby loot continues during travel and blocked support without overlapping calls | Retain: loot-specific outcome | Actual loot ownership, chest availability and capacity are not proved by a quest token or a marked merchant stack. |
| eligible passing and active attacks share priority without passing movement | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| ctype+' Franky attendance suppresses farming/passing targets and ordinary movement, including boss absence' — loop ['warrior','mage','priest','ranger','rogue','paladin','merchant'] | Retain: separate event scenario | Event-specific round, reward or return authority; these merchant/passing journeys do not inject that event transition. |

### combat-queue.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| hunt queue promotes follower nominations after death and retains three ring targets | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| hunt switches to the newly closest nomination without a stall and without excluding the old one | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| hunt keeps ties and wrong-type nominations from causing a closer-target switch | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| pending or engaged attacks arriving with hunt revocation acknowledgements retain the original fight | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| closer hunt candidate disappearing cancels revocation and allows a later replacement | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| untouched selection is planned and candidates rank by leader distance within priority | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| upcoming neutral ranks change while current engagement stays fixed | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| defense discards untouched nomination, but cannot replace an engaged current fight | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| pending projectile prevents abandoning nomination; explicit rejection permits defense | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| known aggressors are retained beyond three and always precede neutrals | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| acknowledged successor promotes on death without another acknowledgement cycle | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| disappearance, focus change, character death and reload cannot release engagement | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| wrong instance death never releases and stale member blocks fresh neutral authorization | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| visibility recovery backtracks then explores collision-checked local detours with no pathfinder | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| completely blocked visibility search retries and retains identity | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| breadcrumbs retrace the actual turn rather than a diagonal to the old sighting | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| coordinator reports only fresh living observers that see the actual target | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| recovery prefers observer and preserves detour side until it stalls | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| follower passive rare replaces untouched nomination, deduplicates, and promotes after defense | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| rare cannot replace a pending attack; stale or wrong-instance follower sightings are ignored | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| rare loot blocks acknowledged neutral pulls but never an existing aggressor | Retain: loot-specific outcome | Actual loot ownership, chest availability and capacity are not proved by a quest token or a marked merchant stack. |
| external claim releases an engaged current target and promotes the shared successor | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| claims remove second and third choices despite another member still nominating them | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| pending target release survives newer hit delivery; newer eligibility permits only a fresh fight | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| external wins timestamp ties; missing sight, stale and wrong-instance reports never release a fight | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| event reports cannot release a shared farming fight | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| reload merges a newer claim release from another member before restoring old engagement | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| ordinary ranking follows leader rather than summed distance to distant supporters | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| stalled pursuit revokes authorization, awaits all clients, then replaces and cools down target | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| pending first attack arriving with revocation acknowledgement keeps the original fight | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| missing approach telemetry disables replacement and committed planned target is approaching | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| a materially closer ordinary target promptly revokes the old pull even during progress | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| no alternative holds the stalled target, and missing telemetry suspends replacement | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| outward detour displacement toward a persistent waypoint counts as approach progress | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| stale revocation acknowledgement cannot replace target, and reload resets pursuit timer | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| fully healed neutral old engagement releases to the nearest nomination without resurrecting old attack evidence | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| 'old engagement is retained with '+variation+' evidence' — loop ['damaged','attacking','unknown','pending'] | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |

### successor-handoff.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| locked red/yellow survive distance changes while third is optimized and acknowledgements survive | Retain: unmatched named branch | No exact outcome assertion in the proposed native journeys yet; inspect this named branch rather than delete on file-level overlap. |
| 'Hunt remaining count reserves current kill: '+count — loop [0,1,2,3] | Retain: unmatched named branch | No exact outcome assertion in the proposed native journeys yet; inspect this named branch rather than delete on file-level overlap. |
| count two permits one successor and stale count cannot permit another after death | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| count decrement and death in one report do not double-count kill | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| 'grant blocked or revoked for '+reason — loop ['activity','quest-expired','quest-type','missing-capability'] | Retain: unmatched named branch | No exact outcome assertion in the proposed native journeys yet; inspect this named branch rather than delete on file-level overlap. |
| partial acknowledgements never create a grant | Retain: unmatched named branch | No exact outcome assertion in the proposed native journeys yet; inspect this named branch rather than delete on file-level overlap. |
| revocation waits for every recipient or expiry before an incompatible grant | Retain: unmatched named branch | No exact outcome assertion in the proposed native journeys yet; inspect this named branch rather than delete on file-level overlap. |
| three clients promote without a coordinator response and report the identical selection | Retain: unmatched named branch | No exact outcome assertion in the proposed native journeys yet; inspect this named branch rather than delete on file-level overlap. |
| 'client refuses promotion on '+gate — loop ['expire','block','hide'] | Retain: unmatched named branch | No exact outcome assertion in the proposed native journeys yet; inspect this named branch rather than delete on file-level overlap. |
| only matching confirmed predecessor death consumes permission | Retain: distinct death/kill ordering | MH-DEATH injects fighter death only. It does not establish monster predecessor/successor death accounting or the separate ordering named here. |
| delayed predecessor snapshot cannot roll back local promotion | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |
| stale receipt cannot extend monotonic expiry and wall clock rollback cannot resurrect permission | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| revocation and scope replacement immediately remove a local promotion | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| client reset discards every permission and acknowledgement | Retain: unmatched named branch | No exact outcome assertion in the proposed native journeys yet; inspect this named branch rather than delete on file-level overlap. |
| coordinator activity ownership blocks grants during anniversary return and Hunt turn-in | Retain: separate event scenario | Event-specific round, reward or return authority; these merchant/passing journeys do not inject that event transition. |
| changed navigation/runtime scope cannot reuse a grant | Retain: unmatched named branch | No exact outcome assertion in the proposed native journeys yet; inspect this named branch rather than delete on file-level overlap. |
| new coordinator scope requires fresh pair acknowledgements instead of restoring grants | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |
| removed grant recipient cannot be acknowledged by a replacement runtime | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |

### monster-attack-policy.test.cjs

The rows keep the tests' titles. The block reads each character's two
reflect lists, "Don't hit with magic" and "Don't hit with physical", with today's monsters as their
defaults, not a fixed set of reflecting monsters.

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| Porcupine physical attacks require a finite range stat of at least 75 | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |
| high reflection monsters block magic regardless of range, allowing physical and pure damage | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| unknown attack stats fail closed only for requested dangerous monsters | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |

### departure-loot.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| temporary Hunt loot ignores passing attacks while ordinary departure defense stays unchanged | Retain: loot-specific outcome | Actual loot ownership, chest availability and capacity are not proved by a quest token or a marked merchant stack. |
| historical completed loot releases farming and cannot return through a delayed report | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |
| loot acknowledgement waits for collection and a fresh observation; no fixed departure timer | Retain: loot-specific outcome | Actual loot ownership, chest availability and capacity are not proved by a quest token or a marked merchant stack. |
| failed collection stays pending and retryable, defense and cancellation take priority | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| stale encounter, wrong realm, instance and location cannot regain loot ownership | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| an in-flight collection result cannot acknowledge a replaced encounter | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| completed Hunt returns to Daisy without a departure loot hold | Retain: loot-specific outcome | Actual loot ownership, chest availability and capacity are not proved by a quest token or a marked merchant stack. |
| explicit Hunt loot barrier requires a matching fresh acknowledgement, not delivery | Retain: loot-specific outcome | Actual loot ownership, chest availability and capacity are not proved by a quest token or a marked merchant stack. |
| pending loot never blocks explicit cancellation or an unfinished mission | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| fresh collector outside the old loot location releases an inherited hunt barrier | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| an inherited barrier remains pending at its location and stale location reports cannot discard it | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| final ghost kill blocks the queued neutral before quest count delivery, only for the mission owner | Retain: loot-specific outcome | Actual loot ownership, chest availability and capacity are not proved by a quest token or a marked merchant stack. |
| client ignores a selected neutral when deciding whether it must defend before loot | Retain: loot-specific outcome | Actual loot ownership, chest availability and capacity are not proved by a quest token or a marked merchant stack. |

### loot-capacity-recovery.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| full merchant banks authorized deposits before optional purchases and leaves party cleanout queued | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |
| capacity recovery does not invent bank permissions for unmarked inventory | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |
| actual capacity rejection releases farming combat but retains the loot barrier and return protection | Retain: boundary/capacity fault | Deadline, numeric or capacity boundary needs its stated condition; native success does not exercise both sides. |

### unified-return.test.cjs

| Named case / generated family | Disposition | Specific gap |
| --- | --- | --- |
| 'booboo return walks while attacked and restores Town when aggro disengages: '+activity — loop [undefined,'anniversary-staging'] | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| new map still under aggro stays walking; missing observations never mean clear | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| an in-flight healthy Town cast is not cancelled by its temporary unavailable status | Retain: ordering fault | Delayed, stale or overlapping ownership/evidence variant needs the exact ordering injected. Normal native handback is insufficient. |
| one fresh planning retry then durable hold, without losing the original cause | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |
| 'attacker selection and markers remain available during '+phase — loop ['taking-control','preparing-route','travelling','held','failed'] | Retain: different interaction | Browser or deployment interaction has a different boundary from the route-driven native Hunt scenarios. |
| local aggro cancels an active Town cast immediately, not ordinary walking | Retain: named condition not isolated | Native Goo kills establish the ordinary travel-combat path only. The candidate/priority, evidence, species or ownership variant named in this row is not asserted by that path. |

Inventory: 24 owned suites, 282 source declarations (expanded runtime cases are not counted here). Unrelated event/UI/healing/commerce variants are explicitly retained with their narrower missing boundary.

## Crosscut movement audit

These seven suites were reviewed separately from the interruption scenarios. Each row remains retained unless the root native run supplies the **same fault and outcome**, including every listed loop variant. Table titles are source declarations, not an inflated runtime-test count.

### convoy-communication.test.cjs

Real network loss can replace only the matching loss/recovery path. Keep stale identity matrices, hours-long budget preservation, flapping cooldown, partial arrival, repeated runtime replacement, permanent HTTP errors and legacy saved failures until those conditions are injected. A successful merchant restart does not prove them.

| Line | Named case / generated family | Disposition |
| --- | --- | --- |
| 25 | 'late route-ready after signal failure recovers a split Daisy return without spending retries' | Retain exact named condition; no equivalent passing artifact yet |
| 55 | 'contradictory communication report cannot recover stale '+mismatch — loop `['id','epoch','commandId','navigationRevision','runtimeId','routeVersion','manual','cancel']` | Retain exact named condition; no equivalent passing artifact yet |
| 66 | 'arrived completion retry does not become a shared communication hold' | Retain exact named condition; no equivalent passing artifact yet |
| 71 | 'hours without reports do not consume movement budgets; fresh acknowledged holds resume after five seconds' | Retain exact named condition; no equivalent passing artifact yet |
| 80 | 'flapping recovery resets stability and rate limits route resumptions' | Retain exact named condition; no equivalent passing artifact yet |
| 86 | 'restart discards readiness and rebinds freshly registered runtimes before resuming' | Retain exact named condition; no equivalent passing artifact yet |
| 91 | 'communication recovery respects '+change — loop `['manual','cancel','revision']` | Retain exact named condition; no equivalent passing artifact yet |
| 99 | 'communication hold waits for '+change+' participant' — loop `['moving','realm','dead','unacknowledged']` | Retain exact named condition; no equivalent passing artifact yet |
| 109 | 'saved arrived completion-network hold migrates once without clearing actual movement counters' | Retain exact named condition; no equivalent passing artifact yet |
| 120 | 'unrelated legacy route failure is not converted to communication recovery' | Retain exact named condition; no equivalent passing artifact yet |
| 124 | 'missing heartbeat cannot silently remove a participant from the held Hunt' | Retain exact named condition; no equivalent passing artifact yet |
| 140 | 'arrival survives '+JSON.stringify(failure)+' and retries only the acknowledgement' — loop `[{kind:'timeout',status:0},{kind:'http',status:408},{kind:'http',status:429},{kind:'http',status:503}]` | Removed only the network member after both native completion-request and completion-response loss passed. Timeout, HTTP 408/429/503, cancellation and ownership guards remain. |
| 148 | 'arrival retry is cancelled without another HTTP request' | Retain exact named condition; no equivalent passing artifact yet |
| 152 | 'permanent completion errors remain failures' | Retain exact named condition; no equivalent passing artifact yet |
| 156 | 'permanent error after a transient failure cannot inherit the communication hold' | Retain exact named condition; no equivalent passing artifact yet |
| 162 | 'healthy travel restored after coordinator restart uses communication recovery rather than Hunt retries' | Retain exact named condition; no equivalent passing artifact yet |
| 166 | 'restart with partially acknowledged arrival rebinds every participant' | Retain exact named condition; no equivalent passing artifact yet |
| 171 | 'completion receipt survives restart and cannot delete replacement commands' | Retain exact named condition; no equivalent passing artifact yet |
| 182 | 'minimush travel recovers a restarted phoenix interruption through defense, loot and regroup' | Retain exact named condition; no equivalent passing artifact yet |
| 220 | 'repeated restarts and replacement runtimes require a new uninterrupted acknowledgement window' | Retain exact named condition; no equivalent passing artifact yet |
| 230 | purpose+' communication holds preserve route budgets and current destination' — loop `['shared-walk','event-return','party-travel']` | Retain exact named condition; no equivalent passing artifact yet |

### convoy.test.cjs

The native Hunt journeys execute real search, travel, return and combat handoff. Keep exact cruise restoration ownership, synchronized departure boundaries, stale response races, blocked geometry, interrupted Town, suspended scheduler and no-movement-during-planning checks until observed under those specific faults.

| Line | Named case / generated family | Disposition |
| --- | --- | --- |
| 16 | 'explicit cancellation restores cruise before ownership is cleared, only once' | Retain exact named condition; no equivalent passing artifact yet |
| 27 | 'stale cleanup cannot unthrottle the replacement convoy' | Retain exact named condition; no equivalent passing artifact yet |
| 35 | 'cancelling assembled convoy restores unrestricted cruise' | Retain exact named condition; no equivalent passing artifact yet |
| 43 | 'assembly handoff preserves cap even when its cleanup runs before preparation' | Retain exact named condition; no equivalent passing artifact yet |
| 58 | 'a stale arrival response after party regroup does not report another movement failure' | Retain exact named condition; no equivalent passing artifact yet |
| 67 | 'anniversary planning yields immediately to defense and late route ticks cannot restart movement' | Retain exact named condition; no equivalent passing artifact yet |
| 76 | 'stationary phase handoff never emits a stop move before synchronized departure' | Retain exact named condition; no equivalent passing artifact yet |
| 94 | 'hunt return planning compares native routes without emitting movement or Town' | Retain exact named condition; no equivalent passing artifact yet |
| 105 | 'return itinerary separates map transitions and Town shortcuts' | Retain exact named condition; no equivalent passing artifact yet |
| 117 | 'failed Town fallback searches only walking routes' | Retain exact named condition; no equivalent passing artifact yet |
| 123 | 'Town succeeds near spawn without requiring 90 units of displacement' | Retain exact named condition; no equivalent passing artifact yet |
| 132 | 'assembly holds ownership and caps speed without awaiting cruise acknowledgement' | Retain exact named condition; no equivalent passing artifact yet |
| 139 | 'native multi-tick search prepares without movement; same plot walks at offset departure' | Retain exact named condition; no equivalent passing artifact yet |
| 160 | 'native route handoff restores cruise and relinquishes movement without false arrival' | Retain exact named condition; no equivalent passing artifact yet |
| 176 | 'a visible monster around a bend cannot interrupt the obstacle-aware route' | Retain exact named condition; no equivalent passing artifact yet |
| 201 | name+' holds the character without acknowledging arrival' — loop `[
  ['position drift', r=>{r.context.character.x=10;}],
  ['speed drift', r=>{r.context.character.speed=80;}],
  ['route replacement', r=>{r.context.movement.state.plot=[];}],
  ['route invalidation', r=>{r.context.movement.state.found=false;}],
  ['stale runtime signal', r=>{r.context.convoySignal.runtimeId='other';}],
  ['expired coordinator signal', r=>{r.setNow(6000);}],
  ['dead character', r=>{r.context.character.rip=true;}],
  ['late departure', r=>{r.context.convoySignal.departAt=1000;r.context.convoySignal.phase='scheduled';}],
]` | Retain exact named condition; no equivalent passing artifact yet |
| 209 | 'native route search failure remains held until cancellation' | Retain exact named condition; no equivalent passing artifact yet |
| 216 | 'cancelled preparation cannot release a route and wrapper is reused for ordinary navigation' | Retain exact named condition; no equivalent passing artifact yet |
| 226 | 'old assembly cleanup cannot reset the preparation owner or its speed' | Retain exact named condition; no equivalent passing artifact yet |
| 235 | 'a connected member cannot search forever' | Retain exact named condition; no equivalent passing artifact yet |
| 242 | 'a suspended runner cannot depart far behind the convoy' | Retain exact named condition; no equivalent passing artifact yet |
| 249 | 'unsupported scheduler fails before starting a route' | Retain exact named condition; no equivalent passing artifact yet |
| 256 | 'native town waypoints wait for release' | Retain exact named condition; no equivalent passing artifact yet |
| 267 | 'hunt departure never adds individual Town shortcuts to prepared routes' | Retain exact named condition; no equivalent passing artifact yet |
| 277 | 'Town barrier requires a real teleport: '+mode — loop `['delayed','unavailable','interrupted']` | Retain exact named condition; no equivalent passing artifact yet |
| 292 | 'Franky exit resolves at the Mainland boundary without walking the remaining route' | Retain exact named condition; no equivalent passing artifact yet |
| 311 | 'same convoy phase and epoch changes retain one cruise cap; changed speed sends one update' | Retain exact named condition; no equivalent passing artifact yet |
| 322 | 'legacy terminal hold without a reason reports convoy identity and missing context' | Retain exact named condition; no equivalent passing artifact yet |
| 330 | 'convoy diagnostics exclude movement evidence from preceding commands' | Retain exact named condition; no equivalent passing artifact yet |

### convoy-timing.test.cjs

Keep offset and monotonic clock tests, reordered full/fast reports, mismatched leases, disconnected samplers and transporting holds. Normal network recovery is not evidence for clock jumps or response reordering. The genuine report-loss branch is a candidate only if native evidence checks stopped-origin recovery and no invented loot.

| Line | Named case / generated family | Disposition |
| --- | --- | --- |
| 28 | 'clock offset '+offset+' cannot invalidate fresh reports during a long regroup' — loop `[-2000,-600,600,2000]` | Retain exact named condition; no equivalent passing artifact yet |
| 35 | 'reordered full report cannot replace fast movement fields or renew freshness' | Retain exact named condition; no equivalent passing artifact yet |
| 50 | 'genuine report loss stops once and resumes at the stopped leader without old rally or fake loot' | Retain exact named condition; no equivalent passing artifact yet |
| 64 | 'disconnected sampler cannot claim a clear observation even when HTTP is fresh' | Retain exact named condition; no equivalent passing artifact yet |
| 70 | 'fast responses retain lease ownership while renewal alone leaves combat revision unchanged' | Retain exact named condition; no equivalent passing artifact yet |
| 85 | 'fast lease survives delayed full status work and wall-clock jumps; delayed full reply cannot roll it back' | Retain exact named condition; no equivalent passing artifact yet |
| 92 | 'fast signal cannot authorize another '+field — loop `['epoch','commandId','runtimeId','routeVersion','navigationRevision']` | Retain exact named condition; no equivalent passing artifact yet |
| 98 | 'transporting reports cannot release a communication hold' | Retain exact named condition; no equivalent passing artifact yet |

### convoy-restart-recovery.test.cjs

This suite restores generic party travel. Hunt and event owners have separate recovery paths. Keep repeated-restart backoff/exhaustion, changed roster/revision/cancellation, and stale command ownership; a single interrupted Hunt restart does not prove those cases.

| Line | Named case / generated family | Disposition |
| --- | --- | --- |
| 15 | 'restart waits for current reports and command ownership and logs the wait once' | Retain exact named condition; no equivalent passing artifact yet |
| 22 | 'changed navigation invalidates the restored convoy without replacing newer commands '+change — loop `[f=>f.intents.P.cancelled=true,f=>f.intents.P.revision++,f=>f.state.followers.P=false]` | Retain exact named condition; no equivalent passing artifact yet |
| 26 | 'event and Hunt owners retain their own recovery; unrelated failures do not auto-retry' | Retain exact named condition; no equivalent passing artifact yet |
| 32 | 'hold acknowledgements and a second restart cannot replace the original navigation authority' | Retain exact named condition; no equivalent passing artifact yet |
| 37 | 'repeated coordinator restarts preserve the three-attempt budget and backoff' | Retain exact named condition; no equivalent passing artifact yet |

### shared-convoy.test.cjs

Keep geometry mismatches, runtime/version/identity matrices, exact arrival boundaries, repeated retry exhaustion, route publication validation and delayed responses. A native reward after network recovery covers only the injected receipt-loss path, not all protocol errors. Native passing Goo covers a real encounter but does not inject reordered retaliation reports or a follower-only attack.

| Line | Named case / generated family | Disposition |
| --- | --- | --- |
| 14 | 'old leader browser is repaired toward newer worker game version' | Retain exact named condition; no equivalent passing artifact yet |
| 20 | 'geometry mismatch holds everyone and reloads only affected runtime after hold acknowledgements' | Retain exact named condition; no equivalent passing artifact yet |
| 34 | 'geometry reload wait retains its deadline through coordinator restoration' | Retain exact named condition; no equivalent passing artifact yet |
| 46 | 'geometry repair never replaces a newer character command' | Retain exact named condition; no equivalent passing artifact yet |
| 50 | 'geometry repair waits for '+blocker+' replacement reports' — loop `['stale','moving','realm','geometry']` | Retain exact named condition; no equivalent passing artifact yet |
| 66 | 'clock-skewed matching departure reports are not a route failure' (renamed in the movement rewrite: regroup attempts no longer exist, the walk's ladder replaced them) | Retain exact named condition; no equivalent passing artifact yet |
| 74 | 'early departure cannot bypass '+field+' validation' — loop `['routeVersion','epoch','commandId','navigationRevision']` | Retain exact named condition; no equivalent passing artifact yet |
| 83 | 'transient readiness withdrawal preserves deadline through repeated preparations' | Retain exact named condition; no equivalent passing artifact yet |
| 93 | 'repeated walking stalls change planner before bounded exhaustion' | Retain exact named condition; no equivalent passing artifact yet |
| 105 | 'client origin and departure-window failures reprepare without spending walking retries' | Retain exact named condition; no equivalent passing artifact yet |
| 116 | 'expired client readiness is bounded even when the reason contains an origin failure' | Retain exact named condition; no equivalent passing artifact yet |
| 121 | 'Phoenix planning origin is captured only after matching stopped assembly reports' | Retain exact named condition; no equivalent passing artifact yet |
| 129 | 'regrouping preserves ALClient unless the route failure identifies geometry' | Retain exact named condition; no equivalent passing artifact yet |
| 137 | 'convoy failure history identifies a merchant command takeover without overwriting it' | Retired in the movement rewrite as a duplicate: 'new manual navigation is not overwritten by regroup recovery' checks the same outcome; the rest was log text |
| 150 | 'shared walking leaves passive targets, stops for a follower attack, loots and replans the same destination' | Retain exact named condition; no equivalent passing artifact yet |
| 168 | 'passing bees and reordered retaliation reports never interrupt the Hunt route' | Retain exact named condition; no equivalent passing artifact yet |
| 189 | 'a return rebuilds after runtime replacement with fresh epoch and bounded retries' | Retain exact named condition; no equivalent passing artifact yet |
| 207 | 'return runtime recovery cannot overwrite a newer command or navigation revision' | Retain exact named condition; no equivalent passing artifact yet |
| 238 | 'Daisy return recovers a missing leader completion after followers have acknowledged' | Retain exact named condition; no equivalent passing artifact yet |
| 252 | 'return completion recovery rejects '+mismatch — loop `['routeVersion','commandId','runtimeId','navigationRevision','position','phase','stale','new command']` | Retain exact named condition; no equivalent passing artifact yet |
| 264 | 'missing local routes regroup the Bee stop without replacing the Stoneworm destination' | Retain exact named condition; no equivalent passing artifact yet |
| 275 | 'transient missing reports reset and newer navigation cannot be overwritten by the watchdog' | Retain exact named condition; no equivalent passing artifact yet |
| 284 | 'missing-route recovery does not count report gaps or override manual cancellation' | Retain exact named condition; no equivalent passing artifact yet |
| 292 | 'a reported local defensive stop survives a threat disappearing before coordinator observation' | Retain exact named condition; no equivalent passing artifact yet |
| 326 | 'exhausted Daisy return completes from fresh stopped terminal-hold acknowledgements at destination' | Retain exact named condition; no equivalent passing artifact yet |
| 336 | 'failed Daisy arrival cannot bypass '+mismatch — loop `['position','map','instance','moving','transporting','stale','runtime','command','epoch','route','cancelled','revision','owner failure','hunt cycle','merchant']` | Retain exact named condition; no equivalent passing artifact yet |
| 360 | 'an authorized Town return completes under its cancelled intent and restores parent commands' | Retain exact named condition; no equivalent passing artifact yet |
| 385 | role+' late route '+outcome+' cannot revive a communication hold' — loop `['F','L']; ['success','rejection','replacement']` | Retain exact named condition; no equivalent passing artifact yet |
| 408 | 'leader plans while follower is away; installation acknowledgements gate departure' | Retain exact named condition; no equivalent passing artifact yet |
| 416 | 'three native runners execute one leader search and two independently copied routes' | Retain exact named condition; no equivalent passing artifact yet |
| 437 | 'blocked waypoint requests regroup without starting native follower search' | Retain exact named condition; no equivalent passing artifact yet |
| 446 | 'recovery invalidates old publication, holds all members and resumes at the stopped leader' | Retain exact named condition; no equivalent passing artifact yet |
| 454 | 'publication rejects followers, conflicting duplicates, stale runtimes and malformed waypoints' | Retain exact named condition; no equivalent passing artifact yet |
| 462 | 'new manual navigation is not overwritten by regroup recovery' | Retain exact named condition; no equivalent passing artifact yet |
| 466 | 'failure context changes only diagnostics, retaining the original failure and request sequence' | Retain exact named condition; no equivalent passing artifact yet |
| 485 | purpose+' signal expiry stops the native route and reports a communication hold without failing movement' — loop `['monster-hunt','shared-walk']` | Retain exact named condition; no equivalent passing artifact yet |
| 496 | 'Hunt conflicting signal identity remains a genuine failure' | Retain exact named condition; no equivalent passing artifact yet |
| 504 | 'paused leader retains the issued waypoint and regroups using native fallback after a route failure' | Retain exact named condition; no equivalent passing artifact yet |
| 523 | 'transport and Town waypoints remain native operations on an imported route' | Retain exact named condition; no equivalent passing artifact yet |
| 536 | 'mixed runtimes cannot begin and retry exhaustion retains a hold' | Retain exact named condition; no equivalent passing artifact yet |
| 543 | 'stable heartbeat runtime survives idle convoy reports, but replacement fails' | Retain exact named condition; no equivalent passing artifact yet |
| 551 | 'failed event entry releases matching commands, retains history and preserves superseding navigation' | Retain exact named condition; no equivalent passing artifact yet |
| 559 | 'event release cannot bypass cancellation or an event return hold' | Retain exact named condition; no equivalent passing artifact yet |
| 565 | 'leave failure regroups with ALClient and carries avoidance to every member' | Retain exact named condition; no equivalent passing artifact yet |
| 570 | 'shared route transport preserves leave metadata and rejects conflicting flags' | Retain exact named condition; no equivalent passing artifact yet |
| 577 | 'return preparation identifies missing acknowledgements and clears the reason after readiness' | Retain exact named condition; no equivalent passing artifact yet |
| 590 | 'Hunt arrival requires the installed route endpoint, not just membership in a broad spawn area' | Retain exact named condition; no equivalent passing artifact yet |
| 603 | 'shared hold acknowledges held despite passive defense arriving while the route stops' | Retain exact named condition; no equivalent passing artifact yet |
| 616 | 'Daisy pickup recovers a missing follower completion with matching arrived reports' | Retain exact named condition; no equivalent passing artifact yet |
| 626 | 'legacy per-leg Hunt return is not completed by final arrival recovery' | Retain exact named condition; no equivalent passing artifact yet |
| 635 | 'planning-origin drift regroups without spending the Hunt route budget' | Retain exact named condition; no equivalent passing artifact yet |
| 644 | 'native Town/transport survives lost '+lostPhase+' barrier response without duplicate transitions' — loop `['departure','completion']` | Retain exact named condition; no equivalent passing artifact yet |
| 661 | 'restored terminal hold uses its new command acknowledgement without an installed route' | Retain exact named condition; no equivalent passing artifact yet |

### shared-walk.test.cjs

Keep event-specific parent-command restoration, concurrent callers, geometry reload, late staging tokens, Ice Golem/Snowman entry cleanup and protected navigation matrices. A Hunt merchant pause does not exercise these shared-walk/event owners. Coordinate anniversary overlap with the event audit before deletion.

| Line | Named case / generated family | Disposition |
| --- | --- | --- |
| 17 | 'runtime reload cancellation preserves the geometry repair convoy' | Retain exact named condition; no equivalent passing artifact yet |
| 22 | 'three event callers coalesce into one convoy and repeated requests retain its identity' | Retain exact named condition; no equivalent passing artifact yet |
| 29 | 'anniversary staging leaves farming combat behind on its shared route to Main' | Retain exact named condition; no equivalent passing artifact yet |
| 44 | 'command-owned return legs restore exactly the suspended completion owner' | Retain exact named condition; no equivalent passing artifact yet |
| 53 | 'cancellation, changed revisions and superseded convoys cannot restart an old workflow' | Retain exact named condition; no equivalent passing artifact yet |
| 59 | 'a leader already at the destination can anchor followers without repeating its workflow' | Retain exact named condition; no equivalent passing artifact yet |
| 65 | 'retry exhaustion is retained even when a waiting caller abandons its failed walking leg' | Retain exact named condition; no equivalent passing artifact yet |
| 91 | 'Snowman repairs persisted staging failure, completes recovery, and releases all-ready Backup Hunt' | Retain exact named condition; no equivalent passing artifact yet |
| 124 | 'ordinary farming recovery cannot displace active Phoenix patrol during a reload gap' | Retain exact named condition; no equivalent passing artifact yet |
| 133 | 'late staging tokens are blocked throughout combat handoff and recovery' | Retain exact named condition; no equivalent passing artifact yet |
| 147 | 'Goobrawl return retires farming walk and preserves exit continuation; restarted='+restarted — loop `[false,true]` | Retain exact named condition; no equivalent passing artifact yet |
| 193 | 'saved return commands may use farming reunion while unrelated walks remain blocked' | Retain exact named condition; no equivalent passing artifact yet |
| 215 | 'Ice Golem return releases unavailable entry convoy at Winterland spawn; restarted='+restarted — loop `[false,true]` | Retain exact named condition; no equivalent passing artifact yet |
| 252 | 'Ice Golem cleanup preserves entry convoy with '+kind — loop `['new-revision','protected','outsider','missing-revision']` | Retain exact named condition; no equivalent passing artifact yet |
| 266 | 'late Town acknowledgement rebuilds return membership only for matching navigation; newer='+newer — loop `[false,true]` | Retain exact named condition; no equivalent passing artifact yet |
| 284 | 'event return preserves '+protectedKind+' convoy' — loop `['new-revision','protected','other-purpose']` | Retain exact named condition; no equivalent passing artifact yet |
| 297 | 'independent merchant owns event walking and return convoys but cannot request farm walking' | Retain exact named condition; no equivalent passing artifact yet |

### movement-service.test.cjs

Keep connector/geometry failures, exact distance/timer boundaries, instance changes, pending-loot transitions, interrupted Town/leave ordering, native repair exhaustion and late cancelled plans. Native paths exercise the implementation, but do not prove deliberately blocked or delayed alternatives. Network E2E evidence must retain the original barrier identity to replace a barrier-loss case.

| Line | Named case / generated family | Disposition |
| --- | --- | --- |
| 9 | 'route import refreshes and normalizes the game version, retaining strict fingerprint validation' | Retain exact named condition; no equivalent passing artifact yet |
| 17 | 'diagnostics snapshot coordinates and deduplicate independently of mutable movement state' | Retain exact named condition; no equivalent passing artifact yet |
| 50 | 'interrupted walking reissues its owned segment once and finishes' | Retain exact named condition; no equivalent passing artifact yet |
| 56 | 'a reissued walk retains its original no-progress deadline and reports the failed segment' | Retain exact named condition; no equivalent passing artifact yet |
| 65 | 'stopped segment retry respects '+mode — loop `['collision','locked','superseded']` | Retain exact named condition; no equivalent passing artifact yet |
| 76 | 'combat handoff records an intentional travel pause without reporting a navigation failure' | Retain exact named condition; no equivalent passing artifact yet |
| 83 | 'ALClient planning executes validated segments, uses actual speed and permits town' | Retain exact named condition; no equivalent passing artifact yet |
| 88 | 'Town arrival waits past the cast deadline for a follower without recasting or failing' | Retain exact named condition; no equivalent passing artifact yet |
| 100 | 'Hunt Town reports actual casts and settled arrivals before the follower arrival barrier' | Retain exact named condition; no equivalent passing artifact yet |
| 110 | 'Town cooldown waits do not count as interrupted casts and become map-local walking fallback' | Retain exact named condition; no equivalent passing artifact yet |
| 121 | 'Town cast rejection reports interruption but cooldown rejection does not' | Retain exact named condition; no equivalent passing artifact yet |
| 132 | 'planner transport errors do not silently switch to native pathfinding' | Retain exact named condition; no equivalent passing artifact yet |
| 136 | 'planning-origin drift retries ALClient without native fallback' | Retain exact named condition; no equivalent passing artifact yet |
| 144 | 'precision arrival completes coarse ALClient and native endpoints without leaking tolerance' | Retain exact named condition; no equivalent passing artifact yet |
| 155 | 'precision arrival rejects a blocked connector in both planners' | Retain exact named condition; no equivalent passing artifact yet |
| 162 | 'blocked final waypoint within tolerance is trimmed for '+(native?'native':'ALClient') — loop `[false,true]` | Retain exact named condition; no equivalent passing artifact yet |
| 172 | 'blocked endpoint cannot bypass precision, shared, or distance requirements '+JSON.stringify(options) — loop `[{arrivalTolerance:1},{shared:true},{}]` | Retain exact named condition; no equivalent passing artifact yet |
| 179 | 'endpoint trim never removes a final transition or conceals an earlier collision' | Retain exact named condition; no equivalent passing artifact yet |
| 190 | 'cancellation prevents dispatching the precision final approach' | Retain exact named condition; no equivalent passing artifact yet |
| 196 | 'collision produces actionable coordinates and native fallback outcome' | Retain exact named condition; no equivalent passing artifact yet |
| 203 | 'late plan cannot restart cancelled or superseded navigation' | Retain exact named condition; no equivalent passing artifact yet |
| 211 | 'native fallback also rejects collisions and exposes terminal failure' | Retain exact named condition; no equivalent passing artifact yet |
| 216 | 'execution stalls have exactly two bounded native recovery attempts' | Retain exact named condition; no equivalent passing artifact yet |
| 221 | 'shared route execution fails to coordinator without independent follower replanning' | Retain exact named condition; no equivalent passing artifact yet |
| 225 | 'town prohibition rejects a town edge even if planner returns one' | Retain exact named condition; no equivalent passing artifact yet |
| 230 | 'real pinned planner worker uses native collision validation and geometry identity' | Retain exact named condition; no equivalent passing artifact yet |
| 244 | 'geometry identity ignores renderer decoration but detects same-version collision changes' | Retain exact named condition; no equivalent passing artifact yet |
| 252 | 'another instance cannot be mistaken for arrival on the same map' | Retain exact named condition; no equivalent passing artifact yet |
| 255 | 'town stays pending until game acknowledgement, even when starting at the town spawn' | Retain exact named condition; no equivalent passing artifact yet |
| 261 | 'observed scattered town arrival reconnects to the route through a validated walking segment' | Retain exact named condition; no equivalent passing artifact yet |
| 267 | 'leave waits for both acknowledgment and arrival, once only; arrivalFirst='+arrivalFirst — loop `[false,true]` | Retain exact named condition; no equivalent passing artifact yet |
| 278 | 'leave rejection replans ALClient without native fallback' | Retain exact named condition; no equivalent passing artifact yet |
| 284 | 'leave validator rejects arbitrary exits and conflicting metadata' | Retain exact named condition; no equivalent passing artifact yet |
| 291 | 'leave timeout requests ALClient recovery and cancellation ignores a late acknowledgment' | Retain exact named condition; no equivalent passing artifact yet |
| 299 | 'pending loot holds '+method+' before the party transition barrier' — loop `['town','door','transport','leave']` | Retain exact named condition; no equivalent passing artifact yet |
| 322 | 'uncollectable transition loot reports a bounded failure and cancellation clears the hold' | Retain exact named condition; no equivalent passing artifact yet |
| 331 | 'a blocked ALClient walking segment uses one validated native connector and keeps the rest of the route' | Retain exact named condition; no equivalent passing artifact yet |
| 338 | 'repair timeout is three seconds, then the single full native attempt retains its thirty-second bound' | Retain exact named condition; no equivalent passing artifact yet |
| 346 | 'post-relocation ALClient rejection cannot start another native search or segment repair' | Retain exact named condition; no equivalent passing artifact yet |
| 352 | 'owned cancellation retains actor, cause, journey and command context without duplicate reason text' | Retain exact named condition; no equivalent passing artifact yet |
| 360 | 'barrier timeout retains request metadata through executor and movement promise' | Retain exact named condition; no equivalent passing artifact yet |
| 379 | 'reached walking points never issue a zero-distance game move: '+duplicates — loop `[1,3]` | Retain exact named condition; no equivalent passing artifact yet |
| 385 | 'entire reached route finishes without a move including the one-unit boundary' | Retain exact named condition; no equivalent passing artifact yet |
| 389 | 'outside arrival tolerance still issues a walk' | Retain exact named condition; no equivalent passing artifact yet |
| 392 | 'reached walk cannot advance while '+blocked — loop `['moving','transporting','unable']` | Retain exact named condition; no equivalent passing artifact yet |
| 399 | 'other map or instance is not consumed: '+JSON.stringify(point) — loop `[{map:'bank',x:177,y:460},{map:'main',in:'other',x:177,y:460}]` | Retain exact named condition; no equivalent passing artifact yet |
| 403 | 'skipped walk preserves transition barrier index and pending acknowledgement' | Retain exact named condition; no equivalent passing artifact yet |

Crosscut inventory: 7 suites, 180 source declarations. No extra unit deletions are justified merely by native happy-path overlap.

## Native stop-required loot regression

HC-STOP failed after the actual controlled Goo death: both native quests stayed at armadillo count 1, the convoy completed its leader loot pass and resumed, but the rare encounter stayed in `Collecting goo drops`. The leader retained the previous rare receipt while the follower had the current one. After the party left the kill location, a second location-scoped leader rare receipt could never complete. This is a product ownership bug, not a timeout or fixture correction.

The fix captures the owning convoy epoch alongside its ID. Rare completion can consume that exact leader convoy receipt only after the encounter death and barrier creation, with matching realm/map/instance. Previous epochs, other convoys, follower receipts, incomplete receipts, and pre-death passes remain invalid. Standalone rare identity checks remain unchanged. No stale receipt is synthesized and no assertion is relaxed. The repeatable native regression HC-STOP passed as case 31 of the full native run. Minimized authentic evidence: [testing-hunt-stop-loot-red.json](testing-hunt-stop-loot-red.json).

Native merchant replacement evidence is archived in `.build/hunt-fixes-red-e2e-results/live-hunt-merchant-native--86763-losing-or-duplicating-cargo-live/trace.zip` (restart) and `.build/hunt-fixes-red-e2e-results/live-hunt-merchant-native--5e224-losing-or-duplicating-cargo-live/trace.zip` (queued death). Active death also passed: `.build/hunt-fixes-red-e2e-results/live-hunt-merchant-native--f1079-losing-or-duplicating-cargo-live/trace.zip`. The nine-case run finished with seven passes and two failures (HC-STOP and anniversary); all 302 archived file hashes were verified. The report is `.build/hunt-fixes-red-e2e-report/`. Each includes `hunt-merchant-owned-before-fault` and `hunt-merchant-recovered-and-rewarded` attachments. This audit removes two expanded runtime unit cases (one whole declaration and one loop member); HC-STOP subsequently passed as case 31 in the full native run. Its exact monster-hunt loop member is now removed; party-travel and negative ownership/ordering cases remain.

## Partial Town return: failure inventory and native regressions

Before implementation, failure modes identified: one actual Town cast fails while peers arrive; walking-only planning still emits a forbidden Town edge; a legitimate obstacle detour increases straight-line distance and falsely exhausts the thirty-second progress timer; runtime replacement or coordinator restart loses the return owner; stale positions, old commands or replaced runtimes falsely refresh progress; a moving loop bypasses the absolute deadline; restricted-map avoidance wrongly blocks an explicit endpoint.

`live-hunt-town-recovery.spec.ts` was written before the planner/recovery fixes. Its ordinary and coordinator-restart variants cancel one actual native Town cast, observe the split party, require walking recovery and original native Daisy rewards. The ordinary native variant passed with 31.1 seconds of real movement without getting closer to Town. The initial restart variant also earned both rewards but correctly re-enabled Town after native readiness recovered; its original permanent-walking assertion exceeded the product contract. Both final Town cases passed in `.build/town-final-e2e-report/` (133 artifact files verified). The restart case requires actual initial walking; any subsequent native Town request must follow an explicit coordinator eligibility transition, and both original quest owners must receive their rewards. The adapter now biases Town-disabled requests toward walking and rejects residual Town edges because upstream alpathfinder exposes no Town-disable option. Default legal shortcuts remain unchanged. Rendezvous progress recognizes fresh displacement only under the current command/epoch/navigation/runtime owner; thirty-second no-progress and 120-second absolute bounds remain. Existing 107 planner/return/shared-convoy checks pass; no new isolated tests were written and no live runtime was activated.

## Cold defending command regression

Native goldenbat and cutebee cases failed when Hunt preparation was replaced with defense between leader heartbeats. The leader acknowledged the defense command without ever installing a local convoy handle; its combat stayed blocked while the follower waited for its target. The fix reuses normal convoy ownership initialization for a complete authorized cold defense packet, then installs the ordinary stopped defense state before acknowledgement. Current navigation revision, runtime, convoy identity, packet shape, membership and protected movement checks remain required. The existing native failures preceded the fix; no new unit was written. After the exact replaced unit removal, 108 travel-defense/shared-convoy checks passed. The deterministic native cold-defense case passed: genuine prepare responses were lost, the leader had no local handle, and the next real defense command led to native damage, death, gem loot and both original Hunt rewards. Minimized evidence: [testing-cold-defense-red.json](testing-cold-defense-red.json).

Verified removal count for this interruption audit is now **four expanded unit cases**: two merchant collection/restart cases, the HC-STOP monster-hunt member, and the network-error completion acknowledgement retry member. No stale-observation, cancellation, ownership, deadline or unrelated-purpose matrix was removed. Historical fixed HC-STOP evidence is archived in `.build/hunt-full60-diagnostic-e2e-results/`; final combined-run evidence remains separate.

## Native death fault publication

The full native run exposed an incomplete fault fixture in queued merchant death: direct server `rip(player)` left the stationary merchant at server HP 0 while its client still reported full HP and never attempted respawn. Upstream `rip` does not publish the player update itself. The first publication fix introduced a tagged lethal Goo through native `commence_attack`; the final helper uses a temporary Rime Djinn and native non-stacking `rimeshatter` so only the intended character dies. It requires real damage and dead-player receipts, removes only the injected attacker with respawning disabled, and leaves character recovery to production code. All six final helper consumers passed natively: fragile-character respawn, fighter death during Hunt, death thresholds one and two, queued merchant death and active merchant death. These fixture corrections are not claimed as product bug fixes. The earlier merchant pass did not expose this stationary publication gap. Existing focused checks after the defense revision guard: 108 passed.

## Rare fixture population isolation

A later combined run reached native Goldenbat death and gem loot, returned Hunt to farming, then found no eligible Goos for 90 seconds. Client diagnostics show no movement owner or departure hold. The cold-defense setup had used `spawnRare(goo)`, which held global species `respawn=-1` until scenario cleanup. Pinned upstream `remove_monster` skips respawn queue insertion under that definition; restoring it later cannot recreate omitted entries. This is fixture contamination, not proof of a failed Hunt handback. Minimized evidence and its limits: [testing-native-population-red.json](testing-native-population-red.json).

Setup now installs a temporary species definition only inside the synchronous native constructor call and restores the exact original object in `finally`, including when creation fails. It never overrides respawn. Native `new_monster` copies initial HP, max HP, attack, speed, range and aggro into the instance; its existing `temp:1` already suppresses that instance's respawn. Later native stat recalculation uses the normal species definition, except the controlled Cute Bee receives per-instance `zone_stats` with avoidance set to zero. Its natural 99.9% avoidance remains an explicit coverage gap; actual attacks, death and loot remain native. The legacy reset restoration guard remains for previously interrupted fixture versions; it is not the normal restoration path. The final seven rare cases passed against the corrected fixture and a fresh isolated server: six native rare kill/loot/Hunt-handback workflows plus disabled-rule/preferences behavior. Evidence is archived in `.build/rare-final-e2e-report/` (267 artifact files verified). The later 54-case diagnostic and its two failures are recorded below; the two Town cases are a separate verified partition. No live server was changed.

The ordinary passing-Goo and deliberate death helpers also use native constructor `temp:1`. A spawn-definition `respawn` field is ineffective here: upstream removal reads the global species interval. Temporary instances avoid latent respawn entries while ordinary removal still decrements native population counters; the lethal helper no longer uses `nospawn`, which would skip those decrements.

The completed 54-case diagnostic passed 52 cases, including cold-defense, armadillo combat, all merchant interruptions and both completion-network faults. Its 1,475 evidence files remain intact in `.build/remaining54-diagnostic-e2e-{report,results}/`; the manifest correctly remains failed. The two failures were unintended stacked collateral damage in the death-threshold fixture and a real follower rendezvous lease mismatch. Native Rime Shatter now isolates the intended death while requiring unchanged peer HP and actual damage/death receipts; [the minimized fixture evidence](testing-single-death-red.json) records why Hunt's count of two was correct. The maintained local convoy now publishes its route version before rendezvous; [the native reconnect failure](testing-follower-lease-red.json) records fresh transport trapped in repeated holds. The reconnect correction subsequently passed its dedicated native run, archived as `.build/reconnect-final-e2e-{report,results}/` with 100 file hashes verified. The local route version is initialized before the awaited rendezvous so current fast-response leases renew correctly. No live server was changed.

## Latest recovery verification

The `.build/recovery11-diagnostic-e2e-{report,results}/` run passed **10 of 11** native cases; 380 artifact file hashes were verified. All six single-character death consumers and both completion-network fault cases passed. The remaining Town-restart case reached a long real rendezvous but incurred an incorrect preparation retry after approximately 61 seconds: the preparation clock included prior rendezvous time. A maintained production clock correction has been applied; its final three-case native rerun passed **3 of 3** in `.build/return-clock-final-e2e-{report,results}/`, with 163 artifact files verified. Both Town variants and follower reconnect completed without an extra Town preparation retry, and both native quest owners received their actual rewards. The previous `town-final` two-case pass remains historical evidence; the `return-clock-final` run validates the later clock correction.

The dedicated `reconnect-final` run passed **1 of 1** with 100 file hashes verified. The latest retained suite passed **3,166 tests** under the strict TAP gate, and lint passed. Artifact integrity counts establish archive completeness; they do not turn a diagnostic run with a failure into a green run.

Final aggregate verification contains **63 unique E2E cases whose latest outcomes passed**, across six preserved runs and their captured source snapshots. This is not a claim that one complete final suite ran against one final snapshot. The final return-clock archive specifically verifies the latest preparation-clock correction; earlier diagnostic failures and their artifacts remain preserved.
