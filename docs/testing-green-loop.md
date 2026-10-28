# October 2026 E2E failure investigation

Run 40635085488 exposed these fixture failure modes before the fixes below:

- Cleave's positive case starts beside native spiders and Phoenix. The correct
  collateral guard vetoes the skill; use a town position for the declared fight.
- Auto NPC withdrawal jobs no longer depend on ordinary withdrawal enablement.
  Queue assertions must reflect this while retaining native sale conservation.
- Native mail deletion removes account ownership, not the database document.
  Reused subjects and old account mail also leak across scenarios.
- The pinned native mail transaction throws `ReferenceError: in_arr is not
  defined` in its isolated transaction context. The compatibility guard replaces
  only that ownership membership call with `includes`; real deletion remains.
- Seasonal bosses spawn naturally after two minutes and persist across cases.
  Tests declaring an absent or future encounter then start with a live boss.
- Witch's Cipher intentionally preserves account daily claims across rounds.
  Restoring character documents alone does not restore a fresh test account.
- Cipher reused the event-boss spawn lookup for ordinary ingredient monsters.
  Goo resolved to the instanced `dungeon0` template and never produced a reachable
  farming route. Reuse the ordinary farming catalog's map/geometry restrictions.

Reset only between disconnected scenarios. Declare the disposable realm's
seasonal respawn timers outside the scenario window and clear previous encounter
actors through native removal. Keep native spawning, combat, loot, persistence,
and event completion inside each scenario unchanged. Reset disposable account
daily claims in both native memory and MongoDB; retain persistence within a case.

Local evidence is retained under `.build/green-loop/`, including the original
CI artifacts and local red/green reports.

## Follow-up evidence and fixture corrections

The first full rerun (`40643326583`) cleared the mailbox, bank collection,
Cleave, manual override, and most seasonal failures. Its remaining failures
identified narrower fixture boundaries:

- Cave's pixel sample was centered on the native sprite's feet and clipped its
  torso. Sample above the anchor; retain the existing pixel thresholds and
  attach the measured pixels even on failure.
- Native runs deliberately exclude the two ChronAL transport cases. Evidence
  verification accepts only those explicit expected exclusions, while rejecting
  unexpected skips, ordinary gameplay skips, failed cases and changed evidence.
- Capacity setup must retain the merchant's initial potion supply. Removing it
  starts a separate native self-restock during the capacity observation window.
- Native Pumpkin status is reconstructed without a fixed end. A test declaring
  a fixed-end feed must preserve that declaration at every broadcast, retaining
  native presence, position and damage.
- Graveyard retains the established 180-unit checkpoint arrival radius; the
  newer 100-unit radius applies only to Slender, Green and Pumpkin. Retain the
  native arrival after Main evacuation and separately verify return retirement.
  Restore the pretravel fixture's peaceful monster definitions afterward so
  subsequent Franky and Cleave scenarios retain native combat behavior.
- The Slender reacquisition journey declares one warp. Pause the independent
  random seasonal warp scheduler for that case and restore it in cleanup; retain
  native discovery, attacks, death and return after the declared relocation.
- The skills dialog now includes conditions; its E2E locator uses the visible
  current title while retaining all skill-card content and layout assertions.

Local native red/green evidence is archived under `.build/green-loop/`.
The retained regression fixtures were updated for current protocol defaults,
module locations, UI contracts and cancellation ownership. The complete local
regression rerun passed 3,893 checks with two Linux-only exclusions on Windows.
That run uses the pinned upstream account file with the repository's maintained
compatibility patch in a disposable fixture, because the installed user copy is
older; it does not modify or restart the installed console.

A same-worker Horseman reproduction showed that the prior encounter and its
modified catalog survived into the add-wave case. Reset Horseman/Jack-o-Walker
actors and their initial native definitions only between disconnected scenarios.
Hunt restart admission now waits for a fresh fighter report separately from HTTP
readiness. The Graveyard pretravel broadcast also keeps an unrelated native live
round hidden after the declared occurrence is cancelled.

## Cave target-switch failure inventory

Hosted run 40653621258 retained a planned Cave bat while the closer duelist
created the first locked target pair. Both fighters acknowledged revocation,
but the new pair blocked completion of the already-started switch. Reproduce
this transition in the existing combat-queue regression before implementation.
Check missing acknowledgements, an acknowledged switch, a vanished alternative,
and attack evidence arriving with acknowledgement. Never authorize a new
distance-based switch once a pair is already locked. Native Cave completion
and actual duel damage/death remain the end-to-end gate.

The existing queue regression reproduced both the frozen switch and a vanished
alternative before the fix; pending/engaged attacks retained ownership. After
the change, all 103 focused queue, successor and formation regressions pass.

The same hosted run's stat-scroll delivery received a native `gold_received`
receipt for 10,000,000 from the Warrior. Its conservation assertion now totals
all three party balances plus the bank, retaining exact equality and the native
scroll-consumption/application assertions. Internal delivery collection must not
be mistaken for an NPC purchase or newly created gold.

The fresh full ChronAL run exposed ordinary respawning mummies at the stale
Mr. Green hint. The empty-hint journey declares only that ambient pack peaceful
and restores its catalog and actors afterward; real boss visibility, travel,
attacks and both fighters' damage assertions remain required.

## Transporter approach failure inventory

The native elixir purchase succeeded, but its merchant stopped outside the
Winterland transporter and exhausted rendezvous. A 60-unit approach with a
20-unit walking tolerance can finish outside the 75-unit interaction range.
Before changing movement, reproduce the Winter Inn exit with the existing
native transporter/cargo journey and retain an isolated tolerance regression.
Check real native transport range, collision clearance, exact cargo conservation,
and the existing Desert route. Precision must apply only to transporter legs;
ordinary recipient movement and manual cancellation retain their contracts.

The isolated tolerance regression failed before the fix. A native Desert rerun
then caught an unsafe assumption in the initial fix: globally precise arrival
required a final connector across scenery although the coarse endpoint already
allowed transport. Keep ordinary planning for the route and request precision
only for a nearby, native collision-clear final connector still outside range.
Retain the failing native trace and rerun Desert, Winter Inn exit and elixir buy.

Horseman pretravel arrival is bounded by the declared native LIVE timestamp,
not an unrelated fixed one-minute wait. The strict before-LIVE arrival and
no-early-damage assertions remain unchanged.

The ChronAL Cipher gathering trace also exposed a fixture leak: its temporary
100-million-HP catalog override affected ambient respawns, so the party locked
onto a different durable bee instead of the asserted target. Scope that override
to construction of one actor, restore the catalog immediately, and isolate the
ambient pack with the existing no-respawn removal journal. Remove the owned actor
in finally; retain exact ingredient totals, sustained hits, restart persistence,
and cutoff assertions. The separate cutoff journey still requires native drops.

Full validation at 3db06ad6 passed all 150 console/deployment/debug journeys and
all 3,900 retained regressions, then exposed coordinator lint debt. Extract
domain helpers without weakening lint limits: preserve validation contracts,
native receipt ownership, event admission, metrics commit acknowledgements,
rollup ordering, and bounded reset yields. Recheck lint, typecheck, the retained
suite, and focused metrics/mail/NPC/stat/event E2Es before the next full dispatch.

Its ChronAL elixir cost check also raced automatic regeneration after deliberately
injuring the character. Native receipts showed repeated `not_ready` responses;
three local baseline attempts reproduced one failure at the same assertion.
The cost-only fixture now starts that step with full HP/MP. It still requires
actual potion consumption, removal of the exact slot and the exact extra 20 gold
consumption cost, alongside the original elixir purchase/use/restart checks.

The native remote-event defense baseline passed twice locally, but CI captured
an unrelated Goo kill before navigation and a transient defense/loot hold. Start
the leader away from that ambient pack and require fresh same-realm reports of
the exact seeded attacker AND its independently published LIVE event before
navigation. Retain the strict never-defending assertion and capture both reports
before cleanup. The corrected native journey passed twice.

The native door tour recorded all seven receipts for both participants. Its
combined exit/checkpoint wait expired while the party finished the last Town
transition; persisted state collected afterward already had completed return
progress and no recovery or convoy. Observe the exit-to-checkpoint milestone
separately from completion of the dispatched checkpoint journey, each bounded
by the existing two-minute deadline. Retain exact receipts, physical arrival,
cleared recovery, restart persistence and timestamped milestone evidence.

The offline-merchant CI trace returned 409 to the fixture's sole permitted status
request: protocol resynchronization had not yet accepted a heartbeat. A local
repeat reproduced the same missing assignment. Forward the resync response,
then admit exactly one successful report, drop its response, and block further
reports. Preserve stale-login admission, timeout, exhausted retry removal and
subsequent native status recovery; retain timestamped admission receipts.

The capped-upgrade restart fixture intercepted protection-only probes with
route.fetch, so an expected restart connection reset escaped as a fixture error.
Continue those probes through the browser normally. Only durable commerce
progress belongs to the declared held-response fault; native retry behavior,
exact base/scroll purchases, cap conservation and restart persistence remain.

The native stale-peer retirement trace admitted the Warrior just after its
12-second assertion expired. First require the restarted coordinator to receive
the original Warrior runtime's fresh status and LIVE event feed, then retain the
12-second admission bound. Keep the Priest's exact pre-fault timestamp, deferred
ownership and connected native runtime checks unchanged.

A later full ChronAL shard and a local cutoff rerun reproduced a native realm
calendar round replacing the fixture's manually seeded Cipher round at 06:00.
The replacement discarded the declared clues and gathering deadline. Exercise
that collision with a due native calendar entry on every date. Isolate automatic
calendar starts in disposable gameplay resets while retaining native calendar
publication, expiry and explicitly seeded event execution. Debug worlds retain
normal schedule automation; an explicit fixture opt-in can exercise scheduled
starts. Preserve actual native ingredient drops, no early brewing, exact round
ownership and successful brewing after the original cutoff.

The next full console job exposed two observation races. Twenty local metrics
repeats reproduced the CI mismatch: frame 44 appeared between reading the header
and reading its ring keys. Compare both from one synchronous browser snapshot;
retain exact ring equality, queued-frame identity and once-only delivery after
reload. The exchange-preview slider also failed three of five local repeats.
Target each keyboard action at the slider and await its actual value (0, 1, 2)
before the next input, retaining the visible +2 preview and all merchant-rule
replacement/persistence assertions. No collector or product UI behavior changes.

The next ChronAL Hunt failure retained a defensive loot checkpoint near Main's
hens while native movement packets showed empty-zone farm recovery carrying the
leader back to Goo. Ordinary repetitions did not reproduce the selection gap;
the retained farm-recovery harness reproduces it from the CI ownership state
before the fix. Convoy defense permits approaching an actual selected target,
but cannot release movement to an empty-zone search. Keep the native rare-kill,
loot, retained quest and subsequent Goo-kill assertions, plus native movement
ownership receipts. This narrow isolated regression supplements those E2Es; it
does not substitute for their receipts.

Graveyard pretravel reproduced a native evacuation failure locally. Its peaceful
ambient fixture assigned monster.target directly, leaving nine recorded attackers
and zero actual attackers. Native Town and doors correctly rejected that state.
Use native stop_pursuit to declare disengagement and verify both the actual
targets and native attacker counters are zero before scheduled attendance.
Preserve the published deadline, native no-early-damage, restart, evacuation and
physical checkpoint-return assertions.

The elixir delivery failure reproduced with 42 attempts to approach the Winter
Inn transporter at a point inside enclosed scenery. Native zero-length collision
checks accepted that footprint, but neither planner could reach it. Prefer an
approach connected to the actor or the transporter's native landing spawn.
Two elixir deliveries and repeated Desert/Winter Inn cargo journeys passed;
retain a strict absence of route-failed receipts during ordinary acquisition.

The native inventory-decision trace selected initial Cipher stock of zero before
the seeded item packet reached the browser. Publish the declared starting stock
through the native client and coordinator before starting that round. Preserve
exact affordable mixes, recipe shortage, unchanged daily tries and zero unwanted
brew receipts. Do not discard a legitimate persisted gathering decision merely
because inventory later changes.

The stale-peer retirement fault remained active through extra native reads after
Warrior admission, approaching the bridge's legitimate 20-second stale-CODE
recovery deadline. Release it from the exact admission snapshot. Observe native
frame readiness inside the existing bounded ownership poll; retain unchanged
runtime identities, strict old-owner retirement and both participants' hits.

The native equipment trace also allowed gathering mode rotation immediately when
its cancelled cast released. That changed the generation awaited by a manual
equip and rejected its handoff before execution. A retained gathering regression
written before the fix reproduces the rejected command. Keep the current enabled
mode while an inventory command owns the handoff, then resume ordinary rotation;
explicit disabling and genuinely superseded generations remain fenced. Verify
native Broom equip receipts, subsequent tool equip, restoration, item conservation,
restart persistence and both opt-in tool-crafting journeys.

The native Cipher gathering failure left the fighter and merchant on opposite
combat sides, more than 350 units apart. The merchant crossed within transfer
range while arriving, between ten-second event polls. Keep real transfers on the
existing one-second pulse while that Cipher participation is active; serialize
sends with event polling and respect inventory ownership. Retain the CI target
coordinates in the E2E, exact delivered quantities, retained gathering choice,
real hits beyond five minutes, zero early brews and the native cutoff/return.

A subsequent native run exposed two fixture-boundary failures. Disabled
Anniversary still left Hunt actively killing Goo, but ranged combat kept both
fighters outside the spawn rectangle demanded by the setup assertion. The same
failure reproduced locally. Use the neighboring Anniversary journeys' reversible
ambient isolation and declare the native Goo encounter after arrival; retain the
real kill, quest decrement, unchanged Hunt cycle and no Anniversary reward.

The empty-hint navigation trace had already moved the Warrior away during native
login, then an unrelated Boo Boo killed it. Isolate that map's ambient actors
reversibly, use ordinary public travel to establish both actual starting positions,
and only then time the unchanged 150-second catalog-reacquisition assertion.
Preserve both native hit receipts, stale advertised coordinates and actual catalog
arrival. The outer timeout includes the separate bounded setup journey.

Hosted jobs also failed before scenarios started because the pinned image mirror
returned registry quota errors. A declared single startup rejection reproduced
this locally. Retry only recognized registry 429/toomanyrequests failures, at most
three times with increasing jittered backoff. Keep original image digests, native
health readiness and bootstrap checks. A real gameplay E2E after that injected
startup failure verifies recovery; no test assertion failure is retried here.

The next native run exposed a race in the delayed Town-packet fixture, reproduced
locally with an empty follower packet ledger. The leader crossed the transition
barrier first; interrupting its cast immediately correctly revoked the follower
before that follower could emit the packet the test needed to delay. Gate only
the leader's native Town request until the follower's real request is captured,
with a five-second fail-safe and timestamped release evidence. Leave coordinator
requests flowing. Preserve the exact single delayed packet, owned native walking
overlap, follower-only transport, party reunion and both real Daisy rewards.

ChronAL then exposed a real finite-compound receipt race: the native success
response arrived before the terminal inventory packet. The promise resolved
while its source slot was still a placeholder, so production journaled failure,
left the quota at one and dispatched another job. A scoped 750ms delay of that
operation's terminal player frames reproduced the same failed quota assertion
locally. Wait for every ingredient and scroll to change, all source placeholders
to disappear and the native compound queue to clear before finalizing the
receipt. Preserve the native response, original deadline, failure behavior and
missed-response inventory fallback. The original exact inventory, success-count,
quota and restart assertions pass with this declared publication delay.

The following native shard exposed gathering starvation without a leaked owner:
command preflight performs an asynchronous production inspection, while both
periodic gathering and the post-status wake can repeatedly fall inside that
inventory lock. Delivering only due gathering intervals at the pending-inspection
boundary reproduced the exact 90-second post-Broom tool-equip failure: 50 timer
collisions, no active attempt, and zero owners between commands. Wake gathering
again when each command releases ownership. Keep the ordinary guards, handoff,
cooldowns and native tool/weapon receipt assertions. The fixture changes only
that timer delivery phase, leaving status, movement and native actions live.

The Cave stairs failure preserved an explicit native transport rejection with
`failed: true`, `place: transport`, and `reason: cave_paused`. The leader was
already downstairs; the priest journaled the rejection as uncertain and remained
upstairs after the pause ended. Freeze only the current priest transport through
the native server pause gate, then unfreeze immediately after its real rejection;
this reproduces the same split and unchanged stairs timeout locally. Classify
only that definite rejection as failed and retry the same stairs command after
fresh readiness and run/door validation. Preserve uncertain receipts for timeouts,
lost replies and other ambiguous errors. Verify exactly one native next-floor
arrival per member after the rejection.

Pretravel ambient peace must be declared before native login. In the failed run,
the Warrior had already died from ambient combat before the schedule was seeded.
The shared fixture now applies the scenario's peaceful input to existing actors
and native respawns on its declared maps before login, then restores the native
constructor, definitions and actor properties after the owned clients stop.
Retain native travel, scheduled admission, live Horseman combat, cancellation,
Main evacuation, checkpoint return and restart assertions.

The repaired collision scenario passes with the same injected timing in native
and ChronAL runs; the complete accelerated equipment/cooldown group passes all
seven cases. The native pause scenario passes twice under ChronAL and once under
native time, retaining the full room, vote, displacement, exit and floor-arrival
checks. Prelogin peace also passes both journeys twice natively and once under
ChronAL. Preserve the associated manifests, native rejection receipts and timing
observations when rerunning these cases.

A later hosted ChronAL run exposed the pause fixture's unexecuted cleanup branch:
`unfreeze_instance` is not a native API. Use the verified
`resume_frozen_instance` operation. The fixture now skips already-frozen
transports, requires ownership of the injected freeze, and records that its
response callback actually resumed that instance. This prevents naturally
existing pauses from bypassing the fixture's cleanup coverage.

The stronger local run also reproduced a separate pre-dispatch stairs race:
readiness changed after the coordinator issued stairs, leaving one member on
floor zero with a permanent `Stairs are not ready for the party` receipt while
the leader was on floor one. Defer both initial stairs dispatch and retries
until fresh readiness returns, then validate the same run and target. Invalid
doors/runs still fail; ambiguous dispatched actions still require reconciliation.
