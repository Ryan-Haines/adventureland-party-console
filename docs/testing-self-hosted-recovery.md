# Self-hosted run 39199505087 recovery

Final recovery validation: [run 39340661324](https://github.com/Ryan-Haines/adventureland-party-console/actions/runs/39340661324) succeeded on `party-console-5090-manual`: **340/340 passed**, all 338 original scenarios retained, eight workers, ChronAL at 4x, and RTX 5090 rendering. The E2E phase took 3003.767 seconds (50m 3.8s); the job including preparation and evidence upload took 3661 seconds (61m 1s). All 12,031 evidence hashes verify and all 313 owned scenario workspaces were removed. This is a complete ChronAL run, not a native-versus-ChronAL benchmark. Machine-readable evidence is in [testing-self-hosted-recovery-results.json](testing-self-hosted-recovery-results.json).

The direct-drop UI follow-up requested after that full run has separate focused browser validation, documented in [testing-release-1.5.md](testing-release-1.5.md); it is not included in the earlier full-run source revision.

Initial run: 309 passed, 29 failed, eight workers, all 338 selected scenarios.
Failure inventory before implementation:
- Optional timing collection assumes original browser frames survive managed
  headless migration/logout; it can fail after successful gameplay assertions.
  Record current runtime ownership and keep broker-level headless observations.
- Offline fallback fixtures read some files from an installed native cache and
  others from scenario fixtures, making derived-stat availability machine-dependent.
- A bank view can contain a partial bank report even when item count matches;
  compare native stock, slots, reservations, client persistence and later telemetry.
- Virtual time advances in fixed windows: a timed communication fault must retain
  the peer as stale until an exact observed admission, not expire during polling.
- Event return can resume an old encounter/convoy before new farm admission;
  inspect native targets, damage, ownership and command receipts before changing code.
- Realm reloads must register fresh browser/CODE clock participants without
  inheriting retired frame registrations or dropping connections under parallel load.

Preserve all original behavioral assertions and all 338 scenarios. Test focused
failures first with eight workers and hardware rendering, then dispatch complete
self-hosted validation until green. Keep immutable candidates staged; do not activate
the user's live console. Preserve reports; remove owned completed workspaces.

Focused reproduction confirmed a real gameplay issue: both fighters had
`context.allowed=false`, `occupied=false`, a live selected Bee and a convoy in
`defending`. The already-authorized farming handoff was allowed through the
coordinator convoy flag but still rejected by the local paused convoy object.
Allow only that same target's handoff while local convoy defense is paused; retain
all foreign movement, manual navigation, runtime, range, map and realm fences.

Classification of the 29 original failures: 22 retired-browser instrumentation,
two environment-dependent offline profiles, one bank snapshot/job-completion race,
one timed stale-peer fault, two initial clock handshake failures, and one genuine
paused-convoy farming handoff deadlock. Failed native startup and realm-switch
traces both contain an initial local clock WebSocket failure; permanent failures
remain fatal after three bounded connection attempts. The new browser regression
rejects the first actual handshake through an owned local TCP proxy and verifies
that the second connects and virtual time advances, retaining attempt timestamps.

Focused evidence:
- `focused-before-convoy`: 10/11 passed; farming deadlock reproduced with matching
  live Bee target, `allowed=false`, `occupied=false`, convoy phase `defending`.
- `focused-after-gameplay`: both natural farming-return repeats passed (54.6/55.2s),
  both bank triplets passed, both rejected-handshake regressions passed, one of two
  realm cases caught another teardown publication race: new game clock connecting,
  CODE clock not yet installed. The body had already passed its gameplay checks.
- Final clock collection now polls for two current, advancing browser/CODE clocks
  for browser-owned actors and retains strict backend/error assertions. Managed
  headless/offline actors use the broker's participant observations.

The full suite retains all original 338 scenarios and adds one ChronAL transport
regression, for 339 total. That transport-only case explicitly skips native parity,
which uses no virtual browser clock. All existing gameplay assertions remain.
Full self-hosted rerun results will be recorded after completion.
## Additional failures exposed by the first complete rerun

Before further implementation: the debug lifecycle can pass every assertion but
fail while Playwright merges recording evidence; preserve and inspect temporary
trace archives. Receipt fault injection can publish its held flag before parsing
the actual authoritative receipt. The estimator's 1,831 zero-delay timer yields
can consume almost the entire gateway deadline on Windows despite little CPU
work; keep the deterministic roll budget and outputs while measuring native I/O
yields. Mixed deployment must distinguish journal completion, maintenance-release
publication, native planner initialization, and actual physical movement; record
these milestones before changing gameplay behavior or timeout policies.
The debug reproduction passed its entire body and captured 8,438 trace JPEGs:
454.5 MB compressed browser recording, in addition to three retained videos and
named screenshots. Trace merge alone took 31.2 seconds in the focused run and
exceeded the separate 120-second merge deadline in the full run. Disable only
the redundant trace screencast for the debug project; retain DOM snapshots,
network trace, sources, videos, screenshots and every lifecycle assertion.
The estimator's native I/O yield reduced the +12 case from 26.95s to 2.42s;
all four target levels retained byte-equivalent deterministic result objects.
The Town-unavailable fault did not reach the game: its first intercepted planner
request spent 1.25 virtual seconds acquiring status plus coordinator ownership,
then the native request aborted before the 409 arrived. Both fighters eventually
hit the boss, but the retry still permitted Town, correctly failing the strict
fallback assertion. Cache fresh read-only coordinator observations outside the
held request, retain exact convoy/epoch/command/runtime/revision guards and the
existing deadline, and record snapshot age and delivery failures. Do not relax
the required Town-disabled retry or native damage checks.
Several later failures are observation-clock stalls rather than exhausted
behavior windows: return tests fail with less than 140 virtual seconds elapsed
in the whole body despite a 240-second return window, while their game/CODE
clocks keep advancing. Runner stdout records read-only /observe timeouts and
ECONNRESET. The observer pump currently stops forever on a single transport
error. Before implementation: retry only this idempotent read, bound consecutive
failures below the existing stall watchdog, record native timestamps and every
recovered failure, keep permanent/protocol failures fatal, never advance locally
without a real broker response, and verify through an actual reset HTTP socket
in the browser-clock E2E. Do not retry gameplay mutations or E2E scenarios.
The Cave failure contains a real negative native transport receipt after the
fixture moved Warrior away from already-admitted stairs. Its injector was armed
by the UI click promise returning, which can lag native farewell resolution and
coordinator stair admission. Arm with the verified exact native farewell choice
ID before voting, and trigger on that native choice's resolved status packet.
Retain actual post-farewell displacement, lost completion packet, independent
repair command, both-floor arrival, native votes and all existing assertions.
The cold-defense fault publishes deliveredDefense before route.fulfill completes;
the observing test can retire routes while that response is still being handed
to the native browser. Publish only after actual fulfillment and stop proxying
unrelated later status requests once that targeted fault is complete. Keep the
same-convoy, no-local-convoy proof and actual combat/loot/quest assertions.
The account-home browser failure shows the real settings dialog with UNKNOWN
realm and an empty closed picker after its first click, despite fresh server
participants. Wait for the actual requested option and reopen the idempotent
picker if asynchronous settings publication remounts it; retain the existing
20-second UI budget, full account confirmation and native/DB/slot assertions.
The disabled-Anniversary failure occurs before gameplay at declared encounter
seeding: four 35-unit cardinal offsets from a moving actor can all fall outside
the current mission or collide. Search nearest collision-clear points across the
same native mission boundary, preserving the mission/cycle, native geometry,
real spawned monster, kill, quest progress and absence of anniversary rewards.
Read the current mission from one snapshot rather than mixing two observations.
The map case now passes (60.0s), but serializes millions of RGBA numbers through
CDP and repeats them in trace arguments for three views. Before optimization:
retain the click-time reference as a lossless PNG, decode that reference in the
real screenshot popup, compare every RGBA byte there, and retain identical
width/height/footer/color/PNG assertions. No sampled pixels or relaxed equality.
The manual-travel fault's first native request has the correct new movement ID,
but its combat trace still has null convoy fields and __partyLastCommand still
names the prior command. Those are separate publications, not current movement
ownership. Read convoyNavigationReport() in the same native snapshot and retain
all exact expected convoy/epoch/command/runtime/revision/rally guards and the
1.5-second injection budget. Do not alter actor positions or relax the fault.
The Phoenix terrain failure is a mismatched fixture encounter: its real context
selects native monster 104 while every assertion expects seeded monster 762.
Use the existing reversible native-map ambient isolation before this declared
single-encounter geometry case, exempt only its real seeded monster, and restore
all retained native objects/counts in an outer finally. Keep exact selected-ID,
hitbox goals, geometry, range and real Warrior damage assertions unchanged.
Focused follow-up validation: full TypeScript checks and selection audit pass;
339 total / 228 gameplay cases remain. Browser debug and merchant-estimate pair:
2/2, 34 evidence hashes verified. Actual clock transport regression: 2/2,
including recovered reset and permanently failing read, 14 evidence hashes.
Map case with trace-only change: 60.0s, 20 evidence hashes; lossless whole-image
comparison: 4.0s and 4.3s, all original byte equality/footer/PNG checks retained.

A simultaneous focused gameplay run exceeded Docker's 31.19-GiB VM memory and
an owned game container was OOM-killed. Its results are diagnostic only. Its
normal teardown completed; further gameplay runs are sequential. The complete
self-hosted run remains eight workers. The final 340-case full run passed; see the validation record above.
## Late-join initialization investigation

Mixed deployment still fails with a healthy observer (no errors or retries) and
a headless participant holding one unacknowledged window. Its replacement
coordinator also logs a premature planner-preparation timeout. New Node actors
install a clock at the pool's original epoch and start application initialization
before joining its current timeline. Startup deadlines/date values may therefore
already be expired at first join. Browser scripts can similarly register timers
before their first handshake.

Before implementation: prove that late joining actors retain full relative
one-shot/interval delays, do not replay startup deadlines immediately, preserve
all callbacks and exact counts, and start Node application code only after its
real authenticated broker acknowledgement. Preserve the common epoch, native
I/O, permanent failures, and the existing watchdogs; do not enlarge deadlines.

Second-run failure inventory before implementation: the coordinator executes
inside a caracAL realm without global setImmediate, so the estimator's Node
fast yield falls back to virtual setTimeout(0). Inject a native I/O yield from
the coordinator module, preserving deterministic results, 60M rolls, cancellation
checks and the 32768-roll cooperation cadence. Browser estimation stays intact.
Delivery report withholding must begin before historical-intent restart and at
the coordinator ingress, otherwise an already-dispatched report can legitimately
reconcile the retained stock. Preserve the unreconciled-before-release assertions.
Entry fault injection must sample current CODE movement/ownership directly in
one round trip: initial planning may precede its first full status report. Keep
every operation identity and the native request's original deadline intact.

Cold-defense fault inventory: a genuine held command can install the local
convoy between the dropped preparation and defense. Withhold every same-owner
pre-defense command (including held), retaining the strict null-local-convoy
assertion and genuine forwarded defending response. Realm picker failure image
shows its selected US I row aligned behind the trigger while US II is visible;
position this account-settings popup below its trigger so both remain actionable.

The terminal-settlement fault misses the peer's earlier completion receipt:
it starts matching only after Warrior establishes the final barrier, and listens
on one Page. By the assertion, both actors have a fresh successor convoy and
the old completion is no longer present in current state. Retain bounded actual
peer barrier responses from the BrowserContext before arming; accept only the
same convoy/epoch/route/step/exact destination with genuine ready=true. Preserve
the one-leave/one-ack counts and all terminal ownership checks.

Actual sandbox comparison, same real ChronAL broker and exact 60M-roll input:
original 79.271s / native-yield-only 79.186s, identical unavailable/completed/rolls.
Native yields alone do not fix the 30s request failure. Repeated global Math
lookups cross the sandbox global proxy in the hottest loop. Capture the same
intrinsic functions once at module load, without changing arithmetic, policy,
RNG, roll counts or yields; compare exact result JSON before accepting the change.
Intrinsic capture reduces this to 53.216s with identical results, still too slow.
The remaining hot path awaits a new Promise for every failed base item. Keep
ordinary attempts synchronous and return/await a Promise only at the original
32768-roll I/O boundary; preserve the exact current level across that yield,
budget exhaustion, RNG stream, grace, scroll consumption and cancellation check.

Manual/entry fault direct reads used an optional global function that is private
inside sharedRoutine's closure, so they could never certify the current owner.
Expose that existing read-only report on sharedRoutine beside its combat trace;
read it there and keep all exact ownership checks. Hawk geometry setup must hold
from native login so a newly configured focus cannot first start farm relocation;
maintenance intentionally parks existing journeys rather than deleting ownership.

CPU profiling attributes 26s of the remaining 50s sandbox time to rollChance.
Its only varying input is integer grace[level]; the expression saturates at
grace>=14. Precompute the exact existing arithmetic for each level and grace
0..14 once per policy, then index with the same saturated integer during rolls.
Do not normalize RNG seeds or approximate probabilities. Verify identical
available and unavailable estimates, all completion/roll/scroll/spending values.

Targetron failure is a second genuine gameplay defect: its first native packet
has unintentional=true and stacked=[Warrior,Priest,outsider merchant], without
splash=true. Later splash packets are ignored correctly, but that first packet
already stole the convoy for defense. Apply the existing outside-party-target
guard to explicitly unintentional stacked victims too. Direct, unknown-target
and actual party-target attacks must retain defense; validate both native cases.

Focused eight-worker result: 13/17 pass, including both Targetron ownership
variants, capped commerce, retained cargo, mixed deployment, both home changes,
walking-return reuse/reward and final-exit loss. Four fixture boundaries remain:
holding all merchant status starves unrelated heartbeat/Steam restoration;
initial maintenance intentionally prevents focus updates; CDP ownership reads
consume 1.5s of a 2s virtual planner deadline. Before changing these: withhold only
full inventory at ingress, declare and acknowledge the manual geometry waypoint
before selecting focus, and observe real current ownership synchronously at the
native ajax call via a Playwright binding. Do not change the native wire body,
request deadline, exact owner guards, focus/geometry or replay assertions.

Repeat the retained sandbox performance comparison from the repository root with
`node docs/compare-estimator-sandbox.mts` after installing the pinned ChronAL
fixture (`node tools/sim/setup.mts`). It uses real authenticated clock sockets,
a fresh Node sandbox for each revision, no gameplay containers, and requires
exact result JSON equality. The original cfc61bd calculation takes 79.271s;
the exact precomputed calculation takes 15.677s (5.06x). Results are retained in
`testing-estimator-sandbox-results.json`; ordinary targets 1/5/8/12 also retain
their exact attempts, gold, scrolls, completions and roll counts.

The next focused run passes the original four fixture fixes but finds two more
setup assumptions: movement retries use a new job ID with the same durable
commerceOrderId, and an unnamed focus mutation does not set a character's search
radius. Require exactly one matching owned commerce continuation and explicitly
set the leader's existing 600-unit search radius; retain every budget, geometry
and native damage assertion. Gate later durable checkpoint progress after the
first accepted paid checkpoint until restart, keeping unrelated probes/status free.
This run also overlapped a deep artifact verification with gameplay. Its native
heartbeat receipts show a 3.75s virtual gap and repeated return recovery; future
expensive build/hash/archive operations finish before gameplay starts. Keep the
Halloween return's original deadline and physical-arrival assertions.

With unrelated verification removed, 17/18 focused cases pass. The remaining
entry test attempts four refusals because its full dashboard state read consumes
1.25s of a native two-second request deadline before response delivery. Use the
existing public fast state projection for current convoy ownership in both fault
handlers; it carries the identical activeConvoy without inventory/combat history.
Keep all exact owner guards, native request deadline and strict three-refusal count.

Fast ownership fixes the strict three-refusal case. The remaining exit fault
pins an expired pre-barrier: its proxy fetch returns ready=true, but the real
client is still in Cyberland, never issued leave, and already retired that request.
Before implementation: forward the actual pre-barrier normally, arm only after
the real browser receives its matching successful ready response, and permit an
unreleased candidate to be replaced by a genuine retry. Preserve current native
journey/plot/geometry ownership and the exact one-leave/one-ack assertions.

Same-revision one-worker parity passes both backends: native 217.440s, ChronAL
59.154s; deselection-to-arrival 94.743 native seconds / 71.000 virtual seconds.
All fault, native leave/ack, ownership and final physical arrival assertions pass;
53 native and 61 ChronAL evidence hashes are verified. See the retained parity JSON.
The completed fault still intercepts every later Warrior heartbeat through the
checkpoint-return leg. Retire its three routes and listeners immediately after
proof, drain actual in-flight status/terminal callbacks, and assert clean retirement
before normal travel. Do not change the 180s deadline or any arrival tolerance.

Earlier focused validation: 18/18 pass with eight workers, hardware RTX 5090 and
ChronAL 4x; all 823 evidence hashes verify and all 16 owned gameplay workspaces
are removed. Full TypeScript checks and the 340-scenario selection audit pass.
The complete self-hosted run is the remaining release-quality validation gate.

Full run 39228381291 exposes a remaining browser startup clock issue: the
replacement CODE's runtime ID and initial combat timestamp equal the original
pool epoch, over twenty virtual minutes behind its already-running game parent.
Timer rebasing cannot repair synchronous Date.now values captured before join.
Before implementation, extend the actual browser regression with a late same-
origin iframe whose synchronous startup timestamp must match its live parent.
Use only that parent's matching clock domain; preserve authenticated broker
acknowledgements, timer rebasing, cross-origin isolation and no clock rewind.

The new iframe regression reproduces an 8-second synchronous startup date error,
then passes with the matching live parent's clock as the initial epoch. The actual
browser/Node transport pair passes 2/2; relative timeout and interval counts remain
unchanged. This establishes the clock defect separately from the farming failure.

The same full run's mixed deployment stopped at 52.75 virtual seconds of body
progress, before its 60-second release poll could expire: the clock-stall guard
ended observation while one headless worker lacked a 250ms acknowledgement.
Before changing gameplay, capture real host lease/control replies, the journal,
client maintenance reports and native Node window phases. A missing acknowledgement
must remain fatal; never evict an active actor merely to let virtual time advance.

Event-entry exhaustion counted four refusals, with the second native request
aborted and repeated in the same recovery attempt. The fixture must deliver its
declared HTTP response before waiting for its diagnostic state GET. Keep the fresh
GET initiated before delivery, exact coordinator/runtime/epoch/revision checks,
the original three-refusal assertion, and additionally reject any native aborts.
Clock diagnostics also encountered a transient state HTTP 503 before the exchange
scenario began. Acquire fresh ownership with a bounded poll and retain read errors;
do not infer ownership from a retired browser or retry gameplay mutations.

The home-realm failure screenshot contains an empty dashboard account model
(CURRENT/HOME UNKNOWN), not an obscured populated option. Before implementation,
extend the real browser transport case with an external application script and a
delayed initial authenticated join. Require its synchronous startup Date to be
current. If reproduced, gate application script delivery on clock readiness rather
than increasing UI timeouts. Preserve native browser networking and all realm UI
and server/database assertions. The terminal fault never reached its intended
final leave: earlier unfaulted barrier requests aborted during transport to
Cyberland. Keep this distinct from failure of terminal reconciliation itself.

The delayed-join external-script regression reproduces a 10.75-second stale
application startup date. It then stalls in shutdown after both pages close;
inspect owned broker sockets, including TCP connections not yet upgraded. Stop
accepting connections before destroying every owned TCP/WebSocket connection so
a late handshake cannot escape cleanup. Do not discard live gameplay actors.

The terminal fixture currently intercepts and parses every status POST before
the response-loss fault is armed, adding CDP traffic during otherwise unfaulted
travel. Register that interceptor only at the verified native settlement phase;
retire it on finish as before. Retain all forwarding, ownership, one-leave,
acknowledgement, peer completion, geometry and deadline assertions.

The Boo Boo cache case proves the exact owned remainder was reused once, then
fails its later reward milestone after repeated ordinary-travel regrouping.
Its report-abort interceptor remains installed both before the declared hold
and throughout the post-fault journey. Restrict installation to the declared
communication fault and remove it immediately after the observed stopped hold.
Keep the real resumed route/cache/Town/reward assertions and passive receipts.

The next focused run passes all ten full-run failures, 24/25 overall. Its paired
Hawk first-attack observer reports a 1124ms readiness age. Before changing the
1000ms production/assertion limit, compare observer and CODE clock domains: the
observer currently adds CODE's coordinator offset to the game window's Date,
whereas the actual gate adds it to CODE's Date. Those separately acknowledged
actors can occupy adjacent 250ms windows. Record both raw timestamps and evaluate
the unchanged readiness and expiry assertions using the actual CODE clock.

The repeat passes both Hawk variants but exposes two fixture checks: the added
abort assertion includes an unrelated Priest return-planner cancellation, while
all three declared Warrior refusals arrive. Scope it to the exact rejected request
IDs and retain the complete cancellation ledger. The home picker passes visibility
then closes before the separate click. Keep opening, actual option click and exact
selected-label confirmation together inside the existing 20-second idempotent UI
selection budget; issue the mutating realm action only after that confirmation.

The next 25-case pass validates 24 cases and selects the correct home destination,
but the added selected-label assertion expected option text while this trigger
displays the realm value `SR_USI`. Check that exact visible ID token (not a prefix
that also matches US II), then rerun both home-realm journeys before full CI.

Latest local validation: the 25-case eight-worker set passes 24 cases; its sole
remaining failure is the added home-picker label assertion. After correcting only
that expected ID, both native home journeys pass, with all 103 evidence hashes
verified and both workspaces removed. All 25 distinct focused scenarios are thus
validated across their retained runs, including all ten failures from run
39228381291. Both actual browser/Node startup transport cases pass (15 evidence
hashes verified). Final TypeScript checks pass. Candidate `64c76ca1b04a` is complete,
source-matched and deep-verified; active `7881dbb8120d` remains unchanged. A fresh
complete self-hosted run is still required before claiming the branch green.

Run 39241223991 reaches a new bank-staging failure: the bank job is accepted,
then fails with `POST /movement-plan · timeout`; no bank snapshot ever arrives.
The full 99.75 virtual seconds of body time elapse, so this is not clock stall
or evidence of incorrect sorting. Before implementation, extend the real-network
clock regression with actual jQuery browser and JSDOM requests whose 200ms native
responses fit the original 1000ms timeout at native speed but not at 16x. Preserve
the timeout value and actual response. Coordinate temporary native I/O pressure
at the shared broker rather than enlarging deadlines or changing gameplay code.
Combat-wait long polls must not impose I/O backpressure because their responses
depend on future virtual events; prove a virtual timer can release that request.
After responses settle, verify ordinary gameplay timers still accelerate and
retain comparable native/virtual timing evidence.

The native-I/O regression reproduces false timeouts at 135ms in Chromium and
129.5ms in JSDOM, although the native control succeeds in 209.7ms. Native-I/O
backpressure passes the same requests without changing timeout values; a 2000ms
gameplay wait takes 242.9ms versus 2013ms native. Combat-wait remains untracked and
its future virtual release succeeds. The separate headless stall records completed
virtual callbacks with a missing acknowledgement in `native-io` phase. Before
changing scheduling, delay only the standalone Node probe's native immediate
callbacks and require a two-second virtual timer to complete in less than one
native second, with all startup timer counts and native responses still exact.

The delayed-immediate probe reproduces 1944.9ms native for a 2002ms virtual wait.
Racing the native immediate with a native zero-delay timer (one guarded callback,
cancel the loser) reduces that same wait to 385.2ms. Both paths still acknowledge
only after completed virtual callbacks and a native macrotask. The paired normal
browser wait takes 239.9ms versus 2011.2ms native, and both clock regressions pass.
These are focused transport measurements, not a full-suite runtime comparison.

The Steam CODE-slot test reused a packet array across disposed bridge clients.
An already-transmitted release from the successful client could arrive after the
array was cleared and be attributed to the next full/unknown-inventory client.
Keep all packets and use each new client's actual session-storage client ID for
the exact no-release assertion. Retain the one-save count, original-cache checks,
full/unknown error messages and connected-native-client checks.

The fishing receipt timeline also shows a real settings race: a no-tool report
arrives after a new gathering enable and after automatic tool crafting is opted
in. It disables the mode permanently, so later available materials cannot be
crafted. Before changing the handler, extend both native replacement-tool E2Es:
hold only the current no-tool request, opt in through the actual settings route,
release that request and require the mode to stay enabled without a no-tool mark.
Keep the real unavailable-material 409, unchanged gold, actual single craft,
one accepted job identity and final tool/inventory assertions.

The stop-required Hunt failure actually commits and attacks other native ambient
Goos while the asserted seeded Goo remains behind the travelling Warrior. This
does not prove policy ignored Goo. Before changing inputs, retain the exact-seed
commit, subsequent native kill, same-cycle armadillo Hunt and reward assertions.
Declare reversible isolation of only ambient Goos, enable policy before introducing
the native seed ahead on its actual walking route, preserve all native armadillos,
and restore native population/constructor accounting even on failure. The shared
isolation helper must retain its existing all-species default for other journeys.

The manual Broom failure records the fishing attempt cancelled for `command equip`
and a new mining attempt starting in that same virtual millisecond, with no native
Broom equip receipt. Gathering currently excludes merchant jobs but not a pending
ordinary inventory command, even though handle already tracks those commands.
Before changing admission, retain the native Broom packet, later actual gathering
tool, restored Broom, exact four-item ownership and restart persistence checks.
Do not admit a new gathering attempt while any inventory command is still held;
keep cancellation of the old attempt and native completion separate milestones.

The 38-case replay passes every one of the latest full run's 13 failures, plus
both native replacement-tool races and manual Broom restoration. Its only failure
is the expanded standalone transport regression: Node's 1000ms virtual deadline
expires after 227.9ms native despite a 200ms native response. A direct diagnostic
confirms Node XHR tracking works; the regression broker itself inherits an already
virtualized Date from its worker. A separate actual-broker probe with a caller
Date 60 seconds ahead reproduces an erroneous 59977ms epoch offset. Before fixing
pacing, extend the real browser/Node E2E to create its broker under that displaced
caller Date and require its epoch to lie between native monotonic observations.
Keep every actual HTTP, startup timer, acknowledgement and long-poll assertion.

That explicit displaced-Date E2E fails before the fix with its broker epoch
59989ms beyond the native observation. After pacing every broker wall-time read
from node:perf_hooks' monotonic native origin, both transport E2Es pass; all 22
evidence hashes verify. The prior 38-case eight-worker replay passed 37 cases,
including all 13 full-run failures, with 1738 hashes verified and 36 workspaces
removed. The corrected clock case passes in the retained two-case follow-up;
these are separate focused runs. TypeScript checks pass. A new clean full
self-hosted workflow remains the release-quality gate.

Run 39252732969 exposes a separate lucky-slot browser failure after restart:
the exact slot-1 tooltip is absent. Its persisted ledger still computes nextSlot=1
and inferred=false, and the actual trace shows Raw Emerald with the lucky-slot
menu binding. The final DOM has no tooltip at all. Before changing the fixture,
retain the exact slot-1 tooltip, inference lapse, restart and subsequent dialog
checks. Bring the real page forward and retry an actual leave/re-enter hover plus
the exact visible tooltip together within the original 15-second assertion budget;
capture the visible tooltip before opening its existing menu. No inference or
gameplay rule, timeout, expected text or scenario selection changes.

Both lucky-slot browser journeys pass three consecutive repetitions after this
interaction correction: six passes, 72 evidence hashes verified. Stop the known
failed full run and preserve its partial evidence before replacing it with a clean
full run of the corrected commit. A cancelled partial run is not a passing suite.

Run 39255854708 passes the lucky-slot case but exposes a real dashboard state
loss during direct coordinator restart. The blacklist remains durable; a successful
core response briefly contains desired slots and zero character reports, unmounting
the card and discarding its locally held Farming settings dialog. The trace records
empty core at 831994.569ms, fresh fast reports at 832019.059ms, then the missing
dialog at Clear all. Before implementation, extend that existing browser journey
with two declared post-restart empty-character core responses. Preserve the open
dialog, manual reason/death count, exact saved blacklist and both clear/cancel
confirmation paths. Keep dialog ownership in the stable console model so transient
card removal does not discard it; preserve ordinary explicit close and owner identity.

The previous immutable UI reproduces that dialog loss with the declared reconnect
responses; all 16 red evidence hashes verify. The first added recovery barrier
incorrectly expected configuration inside the core payload. Check fresh character
reports there and retain the existing exact blacklist checks through full state.
With stable model-owned dialog state, both the reconnect and blacklist export/import
journeys pass three repetitions: six passes, 81 evidence hashes verified. The visible
post-reconnect dialog screenshot confirms its owner and manually added Goo entry.

Before optimizing catalogue expansion, account for repeated absent-item searches,
cyclic loot tables whose absence depends on their ancestor path, and tracker table
updates invalidating earlier negative results. Preserve all reward probabilities,
paths, home reward separation and existing publication assertions. Native CPU
profiles from three passing mixed deployment repetitions show reward expansion
blocking headless event loops for several seconds. Retain those profiles and the
224 verified baseline evidence files; do not relax the 30-second clock stall guard.

The negative-cache-only candidate passes three repetitions, with 224 verified
evidence files, but profiles still show multi-second catalogue work. Preparation's
8 ms limit used gameplay `Date.now()`, which cannot bound CPU work while virtual
time is fixed inside a callback. Limit each batch to four items as well, and use a
positive 4 ms timer so batches span virtual clock windows. Keep generation checks
and publish only the complete catalogue. Validate with eight simultaneous mixed
deployment journeys and the existing native catalogue acknowledgement and tracker
refresh E2Es before the next full self-hosted run.

The completed batch-limited candidate passes all eight concurrent mixed deployment
journeys (579 verified evidence files, eight workspaces removed). Catalogue
acknowledgement and later tracker reward refresh each pass three repetitions
(six passes, 269 verified evidence files, six workspaces removed). These focused
runs retain all original assertions and ChronAL at 4x. They are not a substitute
for the full self-hosted workflow; do not claim a full-suite green result until
that workflow completes successfully.

Run 39270495973 exposed a catalogue-test precondition race. Its native ledger
shows an ordinary merchant heartbeat with no catalogue fields and `needsCatalog:
false`, followed by one 9.16 MB discovery publication and subsequent catalogue-free
heartbeats. Shared coordinator state being available does not acknowledge that
client's still-preparing generation. Request one catalogue publication per native
client through the existing `needsCatalog` protocol, then require acceptance of
the full payload and exact current version before counting the subsequent three
heartbeats. Keep the strict zero catalogue-field and no-renegotiation assertions.

The first readiness probe incorrectly required tracker data on characters without
a tracker; all four acknowledgement repetitions stopped at that precondition while
the four reward-refresh repetitions passed. Their 363 evidence files are verified.
Use each client's prepared/accepted catalogue state instead, retaining bounded
timestamped readiness observations. With that correction, both catalogue journeys
pass four repetitions across eight workers: eight passes, 367 verified evidence
files and eight workspaces removed. Publication acceptance must include all seven
catalogue fields and the exact current version; later heartbeat assertions remain
strict. The full workflow still needs to pass.

Before changing event admission after a farming combat handoff, cover an unfinished
same-revision farming resume command blocking a new event rendezvous, a newer
manual command being incorrectly discarded, and a delayed old completion touching
the event's new owner. Retain fresh runtime/intent/event authorization and exact
command identity. The full-run failure occurs before changing focus: both clients
claim Mr. Pumpkin while remaining on Main, with the priest retaining the farming
convoy's `event-resume-travel` continuation. Reproduce by refusing completion of
one actual native farming handoff operation, without delaying unrelated status or
movement requests; keep both native boss attacks and post-event bee attacks.

The controlled old-coordinator run reproduces event-entry deadlock after two
declared retries of the priest's real completion. All 50 red evidence files verify.
The first follow-up still loaded the previous working-checkout coordinator bundle:
building an immutable candidate does not rebuild the bundles loaded by the live
test fixture. Its seven passes and one failure (382 verified evidence files) do
not establish validation of the coordinator fix. Rebuild shared, runtime and game
outputs before direct Playwright invocation; the workflow's npm pretest already
does this. Keep this distinction when interpreting earlier direct-CLI focused
results; the clean full-workflow runs include the maintained pretest build.

After rebuilding the working bundles, all eight focused handoff/event-entry,
manual override and navigation supersession journeys pass: 381 verified evidence
files and eight workspaces removed. The controlled handoff now admits both native
boss attacks, rejects the old completion as stale, preserves event navigation
ownership during the focus change, and resumes both fighters against native bees
after the native boss death and event return. The subsequent full-suite follow-up passes all 340 scenarios; see the final validation record above.

Settings character inspection also merges the live inventory/vitals stream and
saved appearance, renders equipment/item sprites, and opens read-only item
details with Compare. Nested comparison/stats dialogs remain above the character
window. The actual settings workflow, saved inspection after restart, and
never-loaded account comparison pass three focused E2Es, with 36 verified evidence
files and three workspaces removed. The final comparison screenshot was reviewed.

The first full follow-up exposed a missing QueryClientProvider in the retained
standalone offline-inspection browser harness. The real dashboard supplies this
provider, and inspection now subscribes to its live character cache. Wrap the
harness in the same provider; preserve its saved-observation, comparison and
absence-of-item-actions assertions. The corrected focused scenario passes, with
13 verified evidence files and its workspace removed.

The same full follow-up exposed a Cave displacement-fixture race. Its route was
registered after selecting stairs and waited for the resolved farewell choice
publication before dropping a completed-movement report. Earlier reports could
already publish that receipt and position. A peer's arrival then legitimately
authorized stairs while the fixture moved the warrior away, producing an uncertain
native transport failure. Register the route before selection, match the first
completed stairs movement after native movement resumes, and record/assert that
the coordinator has not already accepted that exact completion. Drop only that
operation's reports during displacement; unrelated status and vote operations
must continue. Retain native farewell acknowledgement, independent path repair,
and both participants' actual floor transitions. The corrected focused journey
passes in 206.5 seconds including teardown, with 71 verified evidence files and
its workspace removed.

Full run 39333470950 exposed a separate reconnect-injection lifecycle failure in
the Hunt blacklist browser scenario: `route.continue: Route is already handled`
originated in the context network guard while the page's core fetch/fulfill handler
was being removed without draining its callbacks. Drain page handlers with
`unrouteAll({behavior:'wait'})` before continuing, and use fallback for non-core
requests so the context guard retains ownership. Do not suppress handler errors
or change gameplay persistence. Three focused repetitions pass with all original
reconnect, native-state persistence and clear-confirmation assertions, 48 verified
evidence files, and three workspaces removed.

The late-joining clock diagnostic in that run also exhausted its unchanged
15-second child-process limit without retaining child diagnostics. Its deliberately
delayed browser-frame acknowledgement remained active after all startup assertions,
throttling the same private barrier used by later native HTTP and Node checks.
End that injection after verifying browser startup timer counts and relative
deadlines. Retain every native/accelerated I/O assertion, the deferred native-turn
check, and the original limits. On child failure retain stdout/stderr, termination
metadata, timestamped native I/O receipts and the private broker's participant
snapshot. Three focused repetitions pass; the custom focused configuration starts
only the diagnostic's own clock/HTTP fixtures and no gameplay pool.
