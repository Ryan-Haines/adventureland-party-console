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
