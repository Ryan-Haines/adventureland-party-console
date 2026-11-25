# Hunt anniversary and rare-event audit

Failure modes recorded before implementation: interruption must retain Hunt identity, native rewards must not duplicate across restart, disabled events must not acquire movement, Hunt off must not revive on return, manual navigation must supersede rare return, dead or rejected evidence must not reopen pursuit, and loot must complete before departure. Scenario setup may control initial native encounter difficulty and scheduling; observations, actions and rewards remain native.

No file is approved for deletion until its mapped native scenario passes. Unmapped cases remain explicit coverage gaps; a broad happy path does not replace a guard matrix.

## Native scenario mapping (anniversary, rare and Franky journeys verified)

| Native journey | Existing cases it can replace only after passing | Explicit gaps |
| --- | --- | --- |
| Anniversary visit resume/restart/Hunt-off | Successful kiss reward; completed claim survives restart; current Hunt resumes; Hunt off stays off | Exact 60/90-second boundary, pending skill cancellation, missing target retries, late permission fences |
| Anniversary disabled while Hunt kills | Disabled raw anniversary cannot preempt Hunt or reward an unselected visitor | Enabled combat event outranking anniversary and protected Daisy claim gap |
| Six native rare species killed, chest opened, same Hunt resumed | Per-species death/loot continuation, optional field-generator off, unchanged Hunt cycle/mission | Claimed outsider, stale/foreign-instance sighting, missing heartbeat, protected navigation |
| Disabled rare and malformed settings | Disabled rare cannot acquire; real HTTP validation preserves settings | Phoenix patrol independence and route geometry |
| Existing real Goobrawl restart/Hunt-off journeys | Basic event evacuation restart and Hunt-off behavior | Deferred/offline late member, stale generation, unrelated convoy and failed-child ownership matrices |
| Existing restored Franky historical recovery | Acknowledged exit after cross-map progress resumes current Hunt | Every other historical recovery corruption/ownership state remains unproven |

Anniversary commerce, BankBoi supply routing, reciprocal slice identity and UI/time-format cases are not Hunt execution tests. They remain outside this migration unless a dedicated native economics/UI journey replaces their outcomes. Phoenix scan geometry and durable rejection evidence are algorithmic failure boundaries; no kill happy path justifies deleting them.

## anniversary-bankboi-supplies.test.cjs

- offline bankboi citrus is queued through shared storage routing exactly once — retained pending native equivalence.
- staged ingredient remains pending rather than creating another bankboi request — retained pending native equivalence.
- unavailable slices are distinguished from queued supplies and invalid requests are rejected — retained pending native equivalence.

## anniversary-kiss.test.cjs

- featured party checks a live combat event immediately without a thirty-second hold — retained pending native equivalence.
- featured character yields even before the old thirty-second cutoff — retained pending native equivalence.
- featured party releases after one minute without interrupting its return convoy — retained pending native equivalence.
- featured player still holds just before one minute — retained pending native equivalence.
- a completed featured hold does not suppress a later merchant kiss round — retained pending native equivalence.
- merchant closes an open stand before travelling or kissing — retained pending native equivalence.
- missing target produces a terminal report after the visibility wait and releases merchant ownership — retained pending native equivalence.
- eight second timeout without new success aborts; an old buff does not conceal it — retained pending native equivalence.
- new slice or new buff proves success despite an unresolved skill promise — retained pending native equivalence.
- merchant recovers a consumed anniversary ticket after the reward interrupted its operation — retained pending native equivalence.
- out of range after approach produces a terminal unreachable report — retained pending native equivalence.
- abort retires a pending  — retained pending native equivalence.
- persisted skip blocks the same round after reload but allows the next round — retained pending native equivalence.
- first failed kiss gets one more approach before the terminal report — retained pending native equivalence.
- second kiss can succeed and does not report a terminal failure — retained pending native equivalence.
- disabled anniversary starts no approach or kiss — removed after native disabled-selection case passed (interrupted 63-case run, case 37).
- arrival advances despite an unresolved movement promise — retained pending native equivalence.
- a disabled raw combat event cannot shorten the featured hold — retained pending native equivalence.
- unavailable anniversary target retries the unfinished Winterland to Main staging leg — retained pending native equivalence.
- featured staging never reports Main arrival while still at Winterland town — retained pending native equivalence.
- pre-round waiting yields before travelling to the square — retained pending native equivalence.
- completed anniversary cannot restage or keep the featured character pending — retained pending native equivalence.
- completed-cycle reconciliation cancels only its retained staging route — retained pending native equivalence.

## coordinator-anniversary-commerce.test.cjs

- automatic chat is reserved once, and manual chat completion checks its command id — retained pending native equivalence.
- slice swaps reserve one identity and track returns owed until acknowledged — retained pending native equivalence.
- fresh merchant inventory replaces stale heartbeat counts before accepting a swap — retained pending native equivalence.
- trade guards reject invalid slices, ignore owned senders, and preserve complete sets — retained pending native equivalence.
- automatic chat is off unless explicitly enabled; manual chat remains available — retained pending native equivalence.

## coordinator-anniversary-control.test.cjs

- merchant staging reserves ninety seconds and tolerates a fifteen-second late live payload — retained pending native equivalence.
- featured merchant leaves after one minute of the five-minute round — retained pending native equivalence.
- kiss attempts honor completion, availability, retries, disabled events and aborted rounds — retained pending native equivalence.

## coordinator-anniversary-empty-state.test.cjs

- combat recovery accepts absent anniversary cycles and unselected targets without holding travel — retained pending native equivalence.
- lost anniversary handoff without captured participants retains active-party recovery fallback — retained pending native equivalence.
- fresh anniversary state accepts return polling without inventing runtime fields or scheduling travel — retained pending native equivalence.

## coordinator-anniversary-return-composition.test.cjs

- early anniversary return handles  — retained pending native equivalence.

## coordinator-anniversary-snapshot.test.cjs

- complete slice sets never authorize automatic cake crafting — retained pending native equivalence.
- anniversary live feed updates and logs a featured round once, preferring the leader realm — retained pending native equivalence.
- inventory recovers missed slice callbacks while completed handoffs and claimed duplicates remain excluded — retained pending native equivalence.
- trade limits reserve complete sets and advertisements use the merchant realm and requested flavor — retained pending native equivalence.
- handoffs exclude bank merchants, disabled, stale, dead and unowned holders even with claims — retained pending native equivalence.
- fresh fighter handoffs carry freshness and remain available between events — retained pending native equivalence.

## coordinator-anniversary-supplies.test.cjs

- anniversary supply totals prefer BankBoi snapshots over duplicate live inventories and read replacement state — retained pending native equivalence.
- reciprocal trade identities preserve account coercion and character fallback rules — retained pending native equivalence.
- reciprocal trade lookup reads current records, honors stored identity and releases only returned trades — retained pending native equivalence.

## encounter-recovery.test.cjs

- split-map Phoenix keeps the same owner while the trailing member crosses maps — retained pending native equivalence.
- catch-up handles  — retained pending native equivalence.
- completed osnake with a retained anniversary return hands back to quest policy — retained pending native equivalence.
- anniversary Hunt handoff preserves  — retained pending native equivalence.
- Fairy wandering does not count as party approach progress — retained pending native equivalence.
- spawn arrival waits for convoy release and then uses the area instead of its center — retained pending native equivalence.
- restored anniversary Fairy stop retires optional commitment and does not reacquire it — retained pending native equivalence.
- managed catch-up actually executes a portal transition before joining Phoenix combat — retained pending native equivalence.

## event-selections.test.cjs

- clock samples use request midpoint and reject stale responses — retained pending native equivalence.
- browser timezone formats the event instant without changing its countdown — retained pending native equivalence.
- dropdown disables inherited and unsupported selections and permits independent choices — retained pending native equivalence.

## hunt-event-handoff.test.cjs

- Ice Golem ${phase} death is consumed without blacklisting or recounting — retained pending native equivalence.
- late event death stays exempt after return; a new outside death counts even with a stale client trip — retained pending native equivalence.
- globally live Ice Golem does not exempt a normal hunt death — retained pending native equivalence.
- rip edge before the event death packet and repeated permission requests are idempotent — retained pending native equivalence.
- replayed return dispatch and slow healthy routes keep one convoy until arrival — retained pending native equivalence.
- failed return retries once and manual cancellation closes protection without reviving movement — retained pending native equivalence.
- unseen pre-event primary retires; yellow alternative becomes primary and cached reports cannot restore it — retained pending native equivalence.
- event handoff preserves a pre-event target with fresh ${evidence} — retained pending native equivalence.
- stale member reports delay retirement; ordinary disappearance outside events retains its fight — retained pending native equivalence.
- blacklist labels distinguish expirations, legacy reasons, and mixed causes — retained pending native equivalence.

## hunt-event-priority.test.cjs

- Gigacrab teleport releases travel before boss visibility without any convoy request — retained pending native equivalence.
- event ending during join releases travel and preserves unconfirmed reentry — retained pending native equivalence.
- dead or other-instance event entities cannot trigger the combat handoff — retained pending native equivalence.
- joinable entry does not depend on coordinator walking availability — retained pending native equivalence.
- Goobrawl cannot join or move when coordinator protects the Daisy claim gap — retained pending native equivalence.
- a permission response cannot revive an event poll after local turn-in begins — retained pending native equivalence.
- event travel rechecks priority after joining and resumes normally once released — retained pending native equivalence.
- coordinator outage denies event movement without interfering with merchant work — retained pending native equivalence.
- anniversary preemption denial cannot stop the active hunt route — retained pending native equivalence.
- coordinator refuses anniversary preemption after the return convoy has completed — retained pending native equivalence.
- anniversary staging yields to an enabled combat event — retained pending native equivalence.
- denied handoff leaves anniversary movement intact — retained pending native equivalence.
- preempting an owned staging route invalidates its continuation — retained pending native equivalence.
- an active kiss stays protected until its operation ends — retained pending native equivalence.
- a late departure permission cannot cancel a newer navigation intent — retained pending native equivalence.

## hunt-event-resume.test.cjs

- ${event} evacuation hands directly to current Hunt without a checkpoint detour — retained pending native equivalence.
- staggered restart, deferred exit, failed farm child and Hunt off/on resume current policy — retained pending native equivalence.
- currently connected late member must really leave before handoff — retained pending native equivalence.
- Hunt handoff preserves ${kind} ownership or observation — retained pending native equivalence.
- unowned farm child cannot be retired by label alone — retained pending native equivalence.
- leaving Hunt during evacuation returns to the newly selected normal destination — retained pending native equivalence.
- leaving Hunt discards pending execution while preserving event evacuation — retained pending native equivalence.
- normal farming repairs an owned failed checkpoint child after runtime replacement — retained pending native equivalence.
- explicit Hunt reselection releases manual cancellation without dispatching the backup — retained pending native equivalence.

## hunt-temporary-encounter.test.cjs

- Poisio (-48,704) is a temporary stop on the way to (-121,1360); death and loot resume the retained spawn — retained pending native equivalence.
- continuous Goo passing attacks do not retain the completed encounter or block real convoy departure — retained pending native equivalence.
- five observed seconds without the target resumes; stale reports pause the timer and a restart adds no time — retained pending native equivalence.
- a fresh sighting resets disappearance; unrelated monsters do not count as encounter progress — retained pending native equivalence.
- encounter recovery respects  — retained pending native equivalence.
- quest  — retained pending native equivalence.
- anniversary and restart retain destination and revalidate the target before resuming — retained pending native equivalence.
- legacy point destination is repaired without changing quest progress or cycle — retained pending native equivalence.
- recognized legacy spawn is retained; missing catalog waits and retries — retained pending native equivalence.
- legacy repair waits for combat, fresh reports, cancellation and competing movement — retained pending native equivalence.
- externally claimed target becomes invalid even while sightings remain visible — retained pending native equivalence.
- pending encounter loot cannot cancel a newer journey, including through the tick loot preflight — retained pending native equivalence.
- delayed completion of the retired convoy cannot complete or cancel resumed travel — retained pending native equivalence.
- a follower sees the next hunt monster: continue the encounter without a loot departure or regroup — retained pending native equivalence.
- farming outside the origin recovers even with a follower nomination — retained pending native equivalence.
- next encounter rejects  — retained pending native equivalence.

## merchant-anniversary-reservation.test.cjs

- merchant work is reserved throughout the ninety-second anniversary lead-up — retained pending native equivalence.
- merchant work is not reserved before the ninety-second anniversary lead-up — retained pending native equivalence.
- merchant work remains reserved through retries until the live kiss completes — retained pending native equivalence.
- completion from a previous round cannot release a new live visit — retained pending native equivalence.
- aborted round releases stale busy state — retained pending native equivalence.
- persisted claim releases a restarted merchant only for its matching round — retained pending native equivalence.
- client and coordinator release the same featured round after reload and retain the next round — retained pending native equivalence.
- restarted client restores its recorded claim and does not release a later round — retained pending native equivalence.

## passive-rare-queue.test.cjs

- client reports enabled out-of-area rares from followers but excludes disabled, dead and claimed monsters — retained pending native equivalence.
- actual coordinator snapshot retains a rare-owned queue and all clients derive its targeting rings — retained pending native equivalence.
- claim reports preserve cooperative bosses and are completely disabled during events — retained pending native equivalence.
- rare retry expiry allows fresh nominations while rejecting delayed abandoned attack evidence — retained pending native equivalence.

## phoenix-patrol-regression.test.cjs

- default order matches screenshot, independent of catalog order — retained pending native equivalence.
- logged waypoint never becomes the nearby farming entry point in real convoy composition — retained pending native equivalence.
- a full five-region circuit completes with real positions and endpoint dwell — retained pending native equivalence.
- stationary successful-but-wrong convoy completions cannot loop forever — retained pending native equivalence.
- assisted kill stays in current region, waits from death through delayed loot and restart, then follows successor — retained pending native equivalence.
- fight dragged outside all regions chooses nearest planned route from post-loot position — retained pending native equivalence.
- nearest region ignores rejected plans and breaks equal route distances by saved order — retained pending native equivalence.
- planner distance excludes incomplete routes and includes transition cost — retained pending native equivalence.
- stale kill reports cannot extend a wait, and disappearance cannot create one — retained pending native equivalence.
- new navigation cancels pending asynchronous waiting-region selection — retained pending native equivalence.
- region transition waits for every convoy acknowledgement instead of cancelling the leader arrival — retained pending native equivalence.
- protected activity suspends the scan watchdog and stale positions cannot complete coverage — retained pending native equivalence.
- a new Phoenix sighting interrupts a respawn wait immediately — retained pending native equivalence.
- Steam runtime reload retries the same waypoint without consuming geometry fallback attempts — retained pending native equivalence.
- blocked waypoint alternatives stay within the selected spawn region — retained pending native equivalence.
- anniversary staging and return hold patrol even after event commands temporarily clear — retained pending native equivalence.
- active grouped patrol retains an outsider Phoenix selection while passive mode rejects it — retained pending native equivalence.
- follower sighting interrupts a travelling patrol before arrival and survives combat selection handoff — retained pending native equivalence.
- stale sightings and protected event ownership do not interrupt patrol for acquisition — retained pending native equivalence.
- fast report interrupts convoy and actual client nomination produces a selected Phoenix ring — retained pending native equivalence.
- short scan legs use a convoy and obsolete local failures cannot cancel it — retained pending native equivalence.
- fresh position heartbeats without fresh observations do not complete scan coverage — retained pending native equivalence.
- real snapshot selects a convoy-visible Phoenix over nearer passive chickens — retained pending native equivalence.
- interrupted active Phoenix handoff retries fresh sightings without a two-minute exclusion — retained pending native equivalence.
- combat bridge placeholder HP cannot requalify an unchanged failed rare pursuit — retained pending native equivalence.

## rare-farming-return.test.cjs

- rejected return dispatch survives serialization and retries — retained pending native equivalence.
- offline member retains obligation after leader arrives, then rejoins a return convoy — retained pending native equivalence.
- protected activity and unrelated convoy cannot consume or steal the return — retained pending native equivalence.
- missing leader heartbeat pauses recovery without discarding durable intent — retained pending native equivalence.
- arrival anywhere inside selected farm boundary completes return without a center-point loop — retained pending native equivalence.
- rare return resumes the same Hunt cycle and mission idempotently without preparing quests — retained pending native equivalence.

## rare-hunting-client.test.cjs

- All optional rare monster sightings are reported to the passive controller — removed; six native rare workflows now prove real acquisition.
- active assistance permission survives the first grouped fight handoff but expires with its revision or heartbeat — retained pending native equivalence.
- carried generator is consumed at most once and only inside deployment range — retained pending native equivalence.
- inventory changes fail deployment safely, and field confirmation releases only basic attacks — retained pending native equivalence.
- stale instructions, wrong instance and changed navigation cannot attack Fairy — retained pending native equivalence.
- new movement owner is not stopped by cancellation of the old rare path — retained pending native equivalence.
- patrol control never starts independent smart movement, including short approaches — retained pending native equivalence.
- fast encounter handoff releases only the patrol convoy and ignores older controls — retained pending native equivalence.
- hidden field generators are reported without dashboard map subscriptions — retained pending native equivalence.
- loot phase approaches the kill and opens drops while rare movement owns the character — removed; native chest-open receipts and inventory gains prove the workflow.
- loot failures do not report success and remain retryable — retained pending native equivalence.
- grouped rare uses shared combat movement even when unseen; Fairy lock still permits basic attacks — retained pending native equivalence.
- grouped Fairy deployer recovers locally when out of range and consumes generator nearby — retained pending native equivalence.
- owned committed Fairy permits basic attacks without a separate rare controller — retained pending native equivalence.

## rare-hunting-settings.test.cjs

- invalid passive settings are rejected without changing saved preferences — retained pending native equivalence.

## rare-hunting-ui.test.cjs

- Phoenix picker preselects screenshot order and preserves a valid saved custom order — retained pending native equivalence.
- Phoenix picker numbers click order, renumbers removal, requires all five and saves exact order — retained pending native equivalence.
- Fairy stays searchable but only exposes an explanation, never a focus toggle — retained pending native equivalence.
- passive menu forwards independent rule patches without replacing other settings — retained pending native equivalence.
- Hunt settings default enabled, save thresholds, reject invalid values and preserve disabled thresholds — retained pending native equivalence.

## rare-hunting.test.cjs

- all five catalog regions are required, independent of caller order — retained pending native equivalence.
- four Phoenix regions fit one footprint; tall region gets an overlapping cardinal sweep — retained pending native equivalence.
- follower Fairy sighting preempts Phoenix — retained priority-switch negative; removed disabled-setting fragment after native disabled-rare case passed.
- sightings on another realm and claimed Fairy do not acquire; outsider Phoenix is rejected — retained pending native equivalence.
- higher custom priority, Daisy rewards and event combat prevent rare interruption — retained pending native equivalence.
- disappearance is not a kill and stale sightings expire — retained; removed confirmed-kill/loot success fragment after six native same-Hunt resumptions.
- manual navigation revision cancels a pursuit without a stale return convoy — retained pending native equivalence.
- generator carrier is unique and confirmation releases attacks without repeat deployment — retained pending native equivalence.
- unconfirmed generator deployment falls back after three seconds — retained pending native equivalence.
- active patrol detects Phoenix with passive checkbox off and resets after confirmed kill — retained pending native equivalence.
- patrol only advances after real coverage and endpoint dwell — retained pending native equivalence.
- failed points have bounded retries and all unreachable regions pause the patrol — retained pending native equivalence.
- no-progress and five-minute limits bound a continuously visible passive encounter — retained pending native equivalence.
- passive checkbox cancellation leaves an explicitly active Phoenix patrol running — retained pending native equivalence.
- Fairy interrupts a patrol and resumes the same region rather than resetting the order — retained pending native equivalence.
- passive rare sighting waits for unfinished grouped fights and is reconsidered afterward — retained pending native equivalence.
- interrupted return convoy is retried and cleared only after all members arrive alive — retained pending native equivalence.
- failed return retries without overriding a newer manual destination — retained pending native equivalence.
- Hunt restart waits through protected interruption before handing travel back — retained pending native equivalence.
- restored Phoenix patrol keeps its route instead of starting a farming return — retained pending native equivalence.
- witnessed Phoenix death never enters loot; claim on approach cancels and cools down — retained pending native equivalence.
- grouped rare waits for queue selection and never owns a competing convoy — retained pending native equivalence.
- currently attacking rare survives disabling and pursuit timeout; death waits for remaining attackers — retained pending native equivalence.
- externally claimed rare cancels without kill or loot and waits for remaining fights before returning — retained pending native equivalence.
- catalog monsters support committed encounters and independent passing mode — retained pending native equivalence.
- disabled field generators leave committed Fairy on ordinary attacks — retained pending native equivalence.
- committed passive sighting interrupts eligible grouped travel; passing sighting preserves route — retained pending native equivalence.
- selected stationary Fairy expires and cannot reopen merely by wandering — retained pending native equivalence.
- rare acquisition keeps an uncommitted Hunt convoy and commits the encounter atomically — retained pending native equivalence.
- restored no-progress budget releases a selected Fairy instead of resetting pursuit — retained pending native equivalence.

## rare-retry-evidence.test.cjs

- rejection receipts project heartbeat positions and migrate bloated saved receipts without reopening pursuit — retained pending native equivalence.
- unchanged rejected rare evidence cannot repeatedly cancel return; material changes admit it again — retained pending native equivalence.
- ambient wandering and restarts preserve rejection; usable range or new combat clears it — retained pending native equivalence.
- old engagement and already-known reachability cannot repeatedly reopen a rejection — retained pending native equivalence.


## Native scheduling limitation found in the first smoke run

The upstream anniversary rule factory uses fixed half-hour slots and has no public force-start hook. The disposable scenario advances only its supplied clock to a round boundary. Native ticket eligibility, kiss validation, delivery, and gift counts all succeeded (fighter one gift, featured character two, merchant one). The coordinator retains the emitted future round deadline after the native event is switched off, so this setup cannot claim coverage of natural wall-clock expiry. The planned completion action is explicit real event deselection, with the return assertion scoped to that user action. Natural timed expiry and early global deactivation remain separate uncovered behaviors.

## Retained failure boundaries (reviewed by domain)

The case list below includes parameterized declarations; interpolated words represent the declaration's full input matrix, not a single native scenario. All listed cases remain retained until a native scenario reproduces their particular failure trigger and assertion. Specifically:

- `hunt-event-handoff`, `hunt-event-priority`, and `hunt-event-resume`: ordinary success does not exercise late permission responses, event/non-event death attribution, stale generations, missing party members, failed-child ownership, or changed navigation revisions. The two Franky journeys replace only their directly demonstrated recovery states.
- `hunt-temporary-encounter` and `encounter-recovery`: nearby rare kills do not establish disappearance timers, stale observation pauses, delayed convoy receipts, external claims, or legacy destination migration. Those timing and ownership tests stay.
- `anniversary-kiss`, `anniversary-staging`, `anniversary-return`, and merchant reservation tests: real rewards and explicit deselection do not establish natural scheduling boundaries, unresolved skill promises, absent featured targets, retry limits, or later-round claim identity. Keep these fault cases even after the reward scenarios pass.
- `rare-hunting`, `rare-hunting-client`, `passive-rare-queue`, and `rare-farming-return`: species kill-and-loot scenarios cover actual attack/loot/continuation, but not foreign realms/instances, third-party claims, Fairy generator deployment, offline followers, missing heartbeats, or superseding navigation. Retain those independent guards.
- `rare-retry-evidence` and `phoenix-patrol-regression`: none of the seeded nearby encounters traverses the five-region patrol, exhausts pursuit budgets, or replays rejected evidence across restart. All of those cases remain meaningful independent coverage.
- `event-selections`, `rare-hunting-settings`, and UI tests: native HTTP rejection covers the explicitly sent malformed settings only. Dropdown interaction, inherited settings, catalog sorting, and unsupported choices require their own browser assertion before deletion.

## Native loot evidence

Rare encounter setup supplies the upstream monster's supported `drops` field with a guaranteed `gem0` drop. This is an explicit initial encounter fixture, alongside reduced encounter difficulty. The native server still owns damage, death, drop creation, chest opening, distribution, and inventory writes. Each scenario requires both an actual `chest_opened` socket receipt containing the gem and an authoritative party inventory increase; XP alone is not treated as loot proof. Natural rare-drop probabilities are outside this fixture's claim.

## Additional cross-cutting Hunt audit

Reviewed the complete test bodies in the following files, including cases whose title does not say Hunt. Existing green Goobrawl and Franky journeys do not justify deleting tests for different persisted states or invalid ownership evidence.

### completed-return-cleanup.test.cjs

- **Return completion releases its running convoy and matching commands:** candidate for replacement by a green anniversary resume scenario that proves actual post-return quest kills. The native scenario must establish movement release, not only a changed stage. Awaiting that green result.
- **Completed convoy restored as failed at Daisy:** retain; the new anniversary restart happens after the kiss, not with this explicitly completed/failed convoy mismatch.
- **Preserve newer convoy/commands:** retain; no event E2E injects superseding ownership during cleanup.
- **Gigacrab return inside an area away from center:** retain; native Goobrawl/Franky does not prove this boundary-vs-center arrival contract.
- **Reject stale/dead/wrong-instance/outside-area arrival matrix:** retain; each input can independently admit an invalid completion.
- **Point-only proximity:** retain; prevents accidentally applying broad area acceptance to point destinations.

### farming-navigation.test.cjs

All cases remain retained. Native anniversary completion does not trigger the specific failures below:

- Focus-clear leader/follower/solo isolation, clear-before-Town and Town-before-clear, repeated empty focus persistence, and Town preserving monster selections: explicit manual cancellation revisions are absent from the native event journeys.
- Merchant missing target, timeout/unreachable target, first-attempt refusal, stale round/target/member/revision/failure-kind rejection, and duplicate abort: native successful kiss and user deselection do not emit these failed operation receipts.
- Cancelled/offline waypoint preservation, serialized abort suppressing staging, featured-member abort with competing combat handoff, and late merchant failure during an existing return: concurrent ownership/receipt races remain uncovered.
- Stale staging/return-ready after cancellation and current staging with no waypoint: protect against restoring client-reported obsolete coordinates.
- Genuine cross-map cave return, already-arrived no-convoy return, distinct per-member waypoints, one-member cancellation during flight: new native scenarios exercise a shared Goo Hunt only, not these topologies.
- Cancelled/superseded returns, lost return using its original destination, offline return invalidation, failed convoy bounded retry, and persisted individual-reunion deadlock: each creates a separate historical failure state not introduced by successful Goobrawl/Franky completion.
- Stale individual completion versus newer command/deferred return: an actual reordered receipt has not been tested.
- Previous-round buffs, the featured hold that lasts while a party member's visit ticket is unclaimed, and completed visits waiting through temporary competing movement: the seeded native anniversary clock deliberately does not claim these timing contracts.
- Dead/wrong-instance arrival and offline-before-initial-dispatch durable waypoint: keep negative observations until native fault injection exercises them.
- Legacy empty-backup cancellation across anniversary then Goobrawl, with manual Town still blocking: retain; existing native event cycles start with current settings and do not reproduce the legacy cancellation reason.

### hunt-ab-return.test.cjs

- Protected Daisy travel when A/B ends: retain; no native A/B event journey exists yet.
- Already-stranded A/B return, with and without restart: retain; the Franky historical fixture does not contain this owner-lost Daisy convoy or preserve its exhausted return retry counter.
- Handoff blockers (stale, inside, dead, cancelled, revision, command, other convoy, escape, death recovery, other failure, old cycle, Town running): retain the entire parameter matrix; these are separate ownership and freshness guards.
- Delayed A/B completion and duplicate ended requests: retain; native event completion success does not replay obsolete receipts.

### coordinator-recovery-hooks.test.cjs

- Supplied saved-Hunt reset and optional quest preparation: retain; distinguishes the supplied suspended object from the currently active Hunt and exercises claim/return ownership phases.
- Tiny P repeatedly attempting to preempt a protected Daisy return: retain; new rare encounters are introduced during farming, not during protected turn-in.
- Escape cancellation observing participants after convoy cancellation: retain; tests a mutation ordering hazard and preserving unrelated merchant commands, absent from event journeys.
- Failed recovery convoy result propagation: retain; no native route admission rejection is introduced by anniversary success.

### coordinator-navigation-actions.test.cjs

- Franky exit acknowledgement allocates Town once, accepts exact replay, and rejects an older convoy: retain. The green Franky party case proves deselection admits all participants, while the historical recovery begins after Town; neither replays native exit-completion packets.

### coordinator-status-composition.test.cjs

- Rare ownership keeps fighter and merchant heartbeats grouped before restoring Hunt scatter: retain; the new native rare scenarios start with Goo and do not assert scatter-mode suppression/restoration under a merchant heartbeat.
- Market authentication/hour boundary and inherited registry-name rejection: outside Hunt coverage; retain their separate security/scheduling assertions.

### coordinator-state-factory.test.cjs

- Persisted Hunt trips and combat-handoff records: retain pending native restart assertions for those historical records specifically. The existing restart checks prove Hunt progress, not preservation of accounting history.
- Lucky-slot defaults, explicit slot zero, and old hardcoded-slot migration: outside Hunt execution; retain until economics E2Es assert those settings migrations.

## Native pre-start deselection regression

The latest native deselection run exposed a production guard defect: the coordinator had recorded `abortedAt` with `abortReason: event-disabled`, all native visitors reported idle, but Hunt remained `paused-event` with no return convoy. `anniversary/returns.ts` unconditionally waited for the old scheduled start even after abort. The fix exempts aborted rounds from the start/featured hold, while preserving both holds for active scheduled rounds. The seeded clock makes the failure repeatable; the same branch applies to user deselection during ordinary pre-start staging. This does not establish natural timed-expiry coverage.

## Native follower event-entry race

The Goobrawl restart scenario exposed a race that begins before the restart: the priest joined while the leader's last position was still Main, then launched ordinary following out of Goobrawl. The pre-restart snapshot already captured that outgoing native movement. The planner chose a Cyberland transit route, where movement stopped; event recovery later waited indefinitely for the priest's Main arrival. The client fix prevents following outside the current selected live event map and rechecks navigation ownership after an awaited join. Same-map following is retained. The planner transit issue is tracked separately; a safer route alone would still permit the incorrect early event departure.

## Native disabled-visitor return cleanup regression

The Hunt-off anniversary journey completed native return travel for both fighters, but its cycle never recorded completion. Deselected visitors were excluded from status-based anniversary observation, and the periodic tick skipped dispatched returns. The tick now reconciles dispatched cycles using the existing saved-route ownership checks, independently of whether attendees remain selected. Hunt stays off; no fresh attendance or old destination is manufactured. The failed native artifact records both completed movement receipts and the unreconciled cycle.

Native rare failures found during the full run: Hen and Golden Bat were selected
while Hunt farming used scatter mode. Rare acquisition captured grouped=false,
then switched to grouped mode; the next tick rejected the rare before formation
could acknowledge it. Preserve the ten-second selection admission window across
that mode handoff, without extending already-selected encounters or permitting
external claims. Hen must still receive native damage, die, produce its native
chest receipt, and resume the same Hunt.

Rejection ownership failure inventory: selecting a leader after startup must
write rejection evidence to that leader's profile; switching leaders must not
reuse another profile's rejection cache; persisted receipts must survive restart;
fresh actionable damage/reachability must still clear only the current profile's
receipt. The Hen red artifact has an immediate real rejection with no receipt in
E2EWarrior's profile, because the service captured the startup orphan dictionary.
The current native suite demonstrates initial leader selection, but does not yet
deterministically force rejection followed by a leader switch and restoration;
retain isolated retry-evidence coverage for that remaining gap.

Tinyp's native escapist mechanic is covered with an actual inventory fieldgen0,
automatic runtime deployment, native owned field entity, and item consumption.
The server's teleport/avoidance logic remains enabled; the test then requires the
same real damage, death, chest-open receipt, and Hunt continuation as other rares.

The native Tiny P deployment run exposed a separate inventory-contract bug:
rare carrier selection expected raw `{name}` items, while real heartbeats carry
`{slot,item}` entries. A real generator stayed in Warrior inventory and no
carrier was assigned; actual attacks triggered avoidance and magiport. See
`testing-tinyp-deployment-red.json`. Existing generator-carrier fixtures were
corrected to the real wire shape before implementation and failed with a missing
carrier. Production now uses the shared observed-inventory type and nested item
name. The native generator consumption/entity assertions remain unchanged.

Phoenix native failure inventory: follower membership changes must propagate the
joining character reset boundary into the destination group; previous-controller
queues must remain rejected, unrelated profiles must remain isolated, and an
existing owner Hunt must survive follower leave/rejoin. The native Phoenix red
(`testing-phoenix-reset-red.json`) had Priest epoch three milliseconds newer than
the group, permanently rejecting its target. Membership now advances the new
controller epoch and invalidates its stale group. The Phoenix journey exercises
real Follow off/on, observes native epoch convergence, then requires damage,
kill, loot and continued Hunt kills. The final native rare run passed.

Franky deselection now has a visible-boss combat regression: native damage and
an active target precede deselection, both clients must install the protected
exit convoy and reach Mainland while Franky remains alive. The prior admission
case exposed a real deadlock (testing-franky-exit-red.json): its afterCombat
wrapper waited for the boss to die before installing exit ownership. The
authorized Franky exit now clears targeting and installs its convoy immediately;
ordinary party-travel and Crab combat waits remain unchanged. The strengthened native Franky evacuation passed.

Removal gate: the interrupted 63-case run passed all four anniversary journeys
(cases 34–37), including disabled selection and Hunt-off return completion.
Removed the corresponding disabled-kiss and immediate completed-return cleanup
unit declarations. Retained newer-command ownership, failed restored convoy and
remaining timing negatives; rare removals were gated until the later clean seven-case native run.

The first explicit Follow-cycle rerun confirmed the production epoch fix: the
new controller and rejoining Priest shared epoch 1790624820153. The test initially
required the scatter-mode Warrior to acknowledge a group snapshot that does not
exist in scatter. It now checks the admission boundary before spawning, then
requires both native epochs to converge after actual rare damage restores grouped
combat. Damage, death, loot and same-Hunt continuation assertions are unchanged.

Cute Bee workflow difficulty: its native 99.9% avoidance produced repeated real
zero-damage miss packets despite correct group ownership. Combining that rate
with the five-second nominal DPS HP budget implies roughly 5,000 seconds of
combat. The workflow now seeds only that instance's native zone_stats avoidance
to zero, records original99.9 and seeded0, and uses native stat recalculation.
The global monster definition is restored synchronously; native hit, damage,
death and loot pipelines remain required. This does not cover normal Cute Bee
avoidance probabilities; retain any isolated avoidance policy negatives.

Final rare verification: all seven native rare cases passed, with 267 files
verified in `.build/rare-final-e2e-report` and the companion results archive.
Phoenix, Golden Bat, Cute Bee, Hen, Rooster and Tiny P each demonstrated native
damage, death, chest receipt, inventory loot and further kills in the same Hunt.
Tiny P additionally consumed and deployed its actual field generator; Phoenix
exercised real follower reset convergence. Disabled rare selection also passed.
Cute Bee uses the explicitly recorded per-instance avoidance-zero difficulty;
normal avoidance probabilities remain outside this workflow coverage.
Removed two whole rare-client declarations and trimmed duplicated success
fragments from two mixed controller cases. Retained priority switching, stale
reports/controls, retry persistence, failed/out-of-range generator deployment,
multiple-carrier selection and loot-failure negatives.
