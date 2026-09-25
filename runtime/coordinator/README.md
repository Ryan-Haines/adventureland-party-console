# Character coordinator

## Locked-pair fast handoff

Capable grouped farmers lock the current and next target while optimizing the third.
Pair acknowledgements are independent of display queue revisions. The coordinator
issues a process-local, three-second successor grant only after all participants
acknowledge the pair. Confirmed predecessor death can consume it once locally;
ordinary cooldown, range, healing, claim and activity checks still apply. Revocation
waits for acknowledgements or lease expiry before an incompatible grant. Legacy
clients retain coordinator-confirmed promotion; restart does not restore grants.

Anniversary/event travel, returns, convoy ownership, recovery and departure holds
block grants. Hunt uses the selected quest owner's fresh count, reserving the current
and pending fights and accounting for deaths whose quest decrement has not arrived.
One remaining kill never preauthorizes a successor. Fast reports carry the quest
with the same runtime-scoped sample as combat observations.

Validate successor-handoff, combat queue/channel/handoff/movement, queue markers,
healing, Hunt and anniversary return tests. Use an isolated checkout because the
watcher publishes source changes; activate both components with the full restart.
Inspect bounded combat.handoffs for grant receipt, local promotion, reconciliation,
attack attempt timer lateness and cooldown readiness. Measure clock-local durations.

## Combat target handoff timing

Confirmed death and changed queue acknowledgements flush combat reports immediately.
If a report is already in flight, changes coalesce into one fresh report on completion;
successful long polls rearm immediately. Periodic reports remain the freshness fallback,
and transport failures retain the one-second retry delay. Queue pre-acknowledgements,
coordinator commitment, healing, attack cooldowns and departure barriers still apply.

Character status exposes bounded `combat.handoffs` records for local death, report,
response, selection, commitment, first basic-attack attempt/acceptance and blockers.
Report sequence links receipt/evaluation timing to its response; group `handoffTiming`
retains coordinator selection/commitment times. Compare durations within each clock
domain and runtime, never subtract coordinator timestamps from local timestamps.

Validate combat-handoff, combat-channel, combat-queue, combat-movement, healing,
formation, departure-loot and convoy-timing tests. Activate character and coordinator
assets together with the supported full restart below and verify fresh runtime IDs.

Managed ALClient planning, native fallback, convoy protocol 4, diagnostics and
rollback modes are documented in [movement](../../docs/movement.md).

The installed caracAL entry is a 363-byte CommonJS launcher. All coordinator
implementation lives in TypeScript here. Edit these sources, not
`.caracal/standalones/CharacterCoordinator.js` or the generated bundles.

## Architecture and generated files

`TypeScript domain modules → application.ts → build → .build/runtime/coordinator-application.cjs`

The installed `.caracal/standalones/CharacterCoordinator.js` launcher loads that
application bundle. The source is split for maintenance; esbuild combines it for
Node execution. Edit a domain module for behavior, or `application.ts` to change
how services connect.

Both `coordinator-application.cjs` and `coordinator-policies.cjs` are generated:
**do not edit them**. The application bundle includes startup wiring and imported
services. The policy bundle exports services without starting the application; it
originated as the migration bridge. They duplicate substantial code, and the
current launcher loads the application bundle directly.

Inline source maps include debugging information and original TypeScript. As an
illustrative snapshot, the application bundle was approximately 631 KB JavaScript
plus 1.89 MB source map (2.53 MB total); policies were 598 KB plus 1.77 MB (2.37 MB).
Sizes change as code changes. Roughly three quarters of those files was source-map
data, not additional executable logic.

## Finding the code

- `application.ts`: composition and startup wiring.
- `infrastructure/`: installed caracAL dependencies and platform contracts.
- `initialization.ts`, `state/`, `persistence/`: saved state, defaults and storage.
- `characters/`, `lifecycle/`: workers, IPC, roster and shutdown.
- `navigation/`: convoys and travel; `hunt/`: Monster Hunt.
- `navigation/travel-defense.ts`: current attacker observations, travel combat
  ownership and passive target retirement. `navigation/convoy-defense.ts` shares
  the defense/loot barrier between route engines; its generated
  `.build/runtime/convoy-defense.cjs` is loaded by the legacy compatibility adapter.
- `anniversary/` and `events/`: anniversary, Franky and other event coordination.
- `merchant/`, `inventory/`: jobs, upgrades, collection and BankBoi.
- `http/`, `status/`, `telemetry/`: routes, heartbeat ingestion and dashboard views.

Policies use explicit ports for time and external I/O. Importing `index.ts`
does not start workers, timers or connections. Legacy shared JavaScript services
remain external dependencies with explicit consumer contracts.

## Build and validate

`npm run build:runtime` stages the application and policy bundles under
`.build/runtime/`, with source maps. Windows start-console and Docker build
these artifacts before starting the game. The launcher template lives at
`tools/caracal/CharacterCoordinator.cjs`; the installer copies it into caracAL.

Run `npm run typecheck`, `npm test`, and the coordinator lint check:

`node node_modules/oxlint/bin/oxlint --config runtime/.oxlintrc.json runtime/coordinator`

The complexity limit is 10. Prefer direct module tests and HTTP integration
fixtures. Remaining named-function fixtures derive their source from maintained
TypeScript, never the installed host. Full-host tests cover both source and bundle;
launcher tests execute the bundle with Windows and Linux directory inputs.

## Manual edit, build and restart

The caracAL installer binds both game and CODE window storage to the persistent
IPC stores. JSDOM's default `window.localStorage` is ephemeral: using it loses
production recovery journals on reload while coordinator admissions survive.
Validate `coordinator-installer`, `production-journal`, and `merchant-npc-sales`
when changing this binding. NPC sales use the named vendor destination so managed
movement applies its interaction offset instead of targeting blocked sprite
coordinates. Activate these changes with the full supported restart.

Rare support retains the current interruptible convoy and commits its encounter
before acquisition returns. Fairy basic attacks accept the fresh owned travel
selection even if support control has been released. Unproductive optional
pursuits expire after thirty seconds without approach/combat progress or five
minutes overall; their progress and rejection evidence survive restart. Mere
monster/leader displacement cannot reopen a rejection. Fresh usable attack range
or combat evidence can. Actual current attackers retain defensive priority.

A travel encounter can route a separated member onto the encounter map under the
same convoy, epoch, command, and navigation revision. Catch-up uses the managed
planner and cancels on hold, supersession, target retirement, or observed arrival;
unsupported instance entry and failed routes report explicit blockers. Protected
anniversary return does not acquire optional stops, and finished visits hand back
to current Hunt policy after combat/loot and fresh ownership checks.

Validate `encounter-recovery`, rare hunting/client/retry tests, Hunt travel,
communication, shared convoy, event returns, combat queues, and markers. Publish
character and coordinator assets together using the full restart below.

Event evacuation hands directly to current Hunt policy after fresh Main town
observations, without requiring the historical farming checkpoint. Normal farming
still resumes its authorized checkpoint. Hunt off/on during evacuation changes the
post-exit policy without dispatching backup movement; completed turn-ins and loot
remain owned. Deferred members retain evacuation but drop obsolete Hunt checkpoints.
Restored failed farm-recovery children are recognized by parent command and revision.

Dedicated-map exit handling covers Goobrawl's transporter and the A/B Testing and
Pirate Ship leave/transport mechanisms. Responses never substitute for observed map
changes. Exit attempt budgets and the Goobrawl Town shortcut survive reload through
return progress; unsupported maps report an explicit blocker. Completion checks
command, runtime, cycle and navigation identity. New Hunt commands clear old exit labels.
Validate Hunt event resume, event return, mode, acknowledgement, return progress,
farming navigation and convoy regressions. Publish characters and coordinator together
using the full restart, then verify fresh runtimes and actual Hunt progression.

Terminal Hunt retreat failures restart the Hunt cycle once per failed Escape ID.
Only a fresh matching `recoveryFailed` report under the captured navigation ownership
can trigger this reset; newer commands, manual cancellation, and events take priority.
The reset releases Escape/death recovery and selects current-party quests while
preserving blacklist history, settings, backup destination, and pending loot.
The leader's combat log records `restarting hunting routine due to failure` with
the character, position, error, and old/new cycle identities. The handled Escape ID
is retained in persisted combat recovery to prevent replay after restart.
Validate `hunt-retreat-restart`, `combat-disengagement`, Hunt composition, and Escape
tests. ALClient/native endpoint trimming also requires `movement-service` and shared
convoy checks: only a blocked final walking point within arrival tolerance is omitted;
precision and shared endpoints remain protected. Publish character and coordinator
assets with the full restart below, then verify fresh runtimes and Hunt progression.

Hunt travel reconciles encounter death and absence before acquisition. Permanent
retirements use server/map/instance/monster identity; absence releases require a
newer living sample. Current attackers outrank committed passive encounters, and
fresh unanimous attacker observations release incidental targets. Historical
interruption targets are diagnostics only. Defense completion waits for loot,
then regroups toward the saved Hunt destination without replacing its mission.

A shared hold owns the client phase even while local in-range attacks continue.
Only a newer owned defense command can release that acknowledgement into combat.
Recovery preserves the five-second stability and thirty-second cooldown barriers,
then reconciles combat and loot before preparing movement. Hold diagnostics name
missing participants and acknowledgements; defense logs record changed blockers.
Validate `convoy-communication`, `hunt-travel-defense`, `travel-defense`,
`shared-convoy`, `passive-hunting`, `combat-queue`, and `queue-markers`. Publish
character and coordinator assets together with the full restart below.

Protocol-4 Hunt travel keeps communication outages separate from movement failure.
Missing heartbeats or an expired matching signal stop the party in a persisted
communication hold without spending movement or Hunt retry budgets. All members
must acknowledge the current hold and provide five seconds of fresh, living,
stopped reports before a new route generation is prepared; repeated resumptions
are spaced at least thirty seconds apart. Restart discards stability observations,
and runtime replacement requires new acknowledgements. Manual navigation wins.

Arrival remains `arrived` while transient completion HTTP failures retry (one
request at a time, five-second timeout, jittered 1/2/5/10-second backoff). The
existing verified-arrival fallback still applies, and persisted latest completion
receipts make response-loss replays harmless. Only captured legacy completion
network failures at their destination enter the one-time migration path; real
movement failure counters remain intact. Existing convoy history records outage
and recovery transitions rather than every retry. Validate `convoy-communication`,
shared convoy, Hunt return, restart, and acknowledgement tests. Publish character
and coordinator assets together with the ordinary full restart below, then verify
fresh runtimes and actual Hunt advancement through Daisy processing.

Convoy failure messages include a snapshot taken before cancellation: phase,
position, destination, route identifiers, signal expiry or mismatched identity
fields, and recent status-response/failure timing. Two context lines accompany
the existing reason and the same snapshot travels in existing failure details.
Timing is held in memory only; no requests, timers, or storage are added.
Validate convoy failure context, shared convoy, and status diagnostics tests;
publish character assets using the supported full restart.

Shared-route geometry mismatches have a separate one-reload repair budget. Heartbeats
carry numeric game versions and geometry fingerprints; import failures include both
expected and actual identities. The coordinator holds every participant, asks only
affected runtimes to reload, and waits up to 60 seconds for fresh compatible reports
before creating new route commands. An older browser game version requires a game-page
reload; CODE alone cannot replace its game data. Repair targets the newest reported
game build, including when the leader is older. Repair identity and deadline survive restart.
Hunt roster reconciliation retains reloading participants through the repair wait
and its terminal geometry hold, rather than treating a heartbeat gap as departure.
A repeated mismatch stays held with a geometry-specific error and does not blacklist
the farming zone. New navigation supersedes repair. Hunt clears an orphaned failed
farming relocation only when its destination and every navigation revision still
match the current mission, then resumes origin travel or a due Daisy return. This
also releases an expired anniversary checkpoint whose dispatched farming return
failed; live event returns and newer commands remain protected.
Validate geometry reload, shared convoy/walk, movement service, and Hunt farm-walk
tests; publish character and coordinator assets together with the full restart.

Anniversary participation never automatically crafts Sixfold Cakes. Complete slice
sets remain available for the normal exchange menu. Publish character and coordinator
assets together when retiring the legacy cake routine; snapshot `craftReady` stays
false for older clients. Validate anniversary snapshots and merchant exchange tests.

Enabled passive targets with `keepMoving: false` take precedence over outbound
Hunt moving attacks, including when the passive type matches the Hunt species.
Fresh eligible sightings can nominate a committed travel encounter before aggro;
passing reservations cannot suppress that encounter. The shared convoy retains its
original destination while normal combat, rare support, and kiting run. Rare support
must not cancel that convoy or create a competing farming return. Turning keep-moving
back on does not abandon an already committed fight. Protected returns and Escape
remain separate. Validate passive admission, Hunt travel defense, and rare support.

Local development starts `tools/game/watch.mts`: source edits can publish and reload
character assets automatically even without an explicit build. Make coordinated
character/coordinator changes in an isolated checkout; stop the supervised local host
before transferring validated sources. Killing the watcher alone is insufficient
because the service host respawns it. Publish both components with the full restart
below, and verify fresh character generations plus the coordinator process.

Outbound Monster Hunt convoys share one coordinator-authorized encounter while
walking. Basic attacks remain in range and cannot switch to another monster merely
because the primary falls out of range. Raw target observations remain visible even
for passing encounters. A second attacker pauses the whole convoy for normal
defensive combat and kiting; the original encounter and additional attackers retain
combat ownership until death or bounded lost-target recovery, followed by the
existing loot barrier. Regrouping resumes travel to the original destination under
a new route epoch. Return and emergency escape policies remain separate.
Sightings cannot adopt an earlier spawn. Preparation and map transitions suppress
passing attacks. Completion records verified origin arrival before free
combat resumes. Premature persisted farming states return to their saved origin.
On entering farming, the Hunt target sheds passing-attack ownership from travel,
including cached peer reports, so it can enter the normal combat queue. Unrelated
passing encounters retain their movement restrictions.
Validate Hunt travel defense, passing admission, travel defense, Hunt route acquisition,
passive hunting, shared convoy endpoint arrival,
and Hunt composition tests. Publish both character and coordinator assets with
the full restart, then verify every member reaches the destination before farming.

Shared convoy departure tolerates matching travel reports within 500 ms of the
scheduled departure. Transient readiness changes stop and reprepare under the
original 60-second readiness deadline without spending a movement retry.
Walking execution may reissue one stopped, collision-checked owned segment;
only observed displacement resets its five-second progress deadline. A repeated
walking stall switches the shared planner to native within the two-regroup limit.
Hunt return retries preserve that fallback and pending Daisy rewards. Stale arrival
responses wait for replacement commands instead of reporting another failure.
If a final Hunt-return completion request never settles, three seconds of verified
arrival reports let the coordinator finish the convoy and proceed to Daisy claims.
Fresh route, runtime, command, and navigation ownership checks still apply.
Validate `shared-convoy`, `movement-service`, `convoy`, and Hunt return tests;
publish character and coordinator assets together through the full restart.

Explicit Send to party requests survive a disabled automatic-collection toggle.
Automatic pickups still obey the toggle. Validate `manual-party-collection`.

Steam logout recovery uses a game-window session ID that survives CODE reloads
but changes on a fresh game page. A connected Engage can retire a pending logout;
headless and primary-transfer operations retain their ownership safeguards. Old
release receipts are replayed as acknowledgements, never as another disconnect.
Validate with `roster-routes.test.cjs` and `steam-bridge.test.cjs`. Publish both the
coordinator and character assets, then test console logout followed by Steam login
and Engage for the same and a different character, including a primary with Steam
companions. Confirm the new primary stays connected and headless slots stay assigned.

Passing attacks first publish an exact encounter reservation over the combat
channel and wait for every active fighter/convoy participant to acknowledge it.
Missing approval skips the optional attack while travel continues. Admission is
scoped to runtime, membership, navigation and convoy ownership. Protocol 4 optional
attacks require an owned travelling signal; transitions still suppress them.
Protocol 4 defensive stops retain their local convoy identity and first interruption
cause until the coordinator acknowledges the stop. If every recorded cause becomes
a passing encounter, fresh observations let the coordinator rebuild the current
owned route without a defensive loot hold. Genuine defensive kills retain loot
handling. See the [keep-moving audit](../../docs/keep-moving-combat-audit.md).
Validate passing-admission, passive-hunting, convoy-defense and shared-convoy tests;
publish character and coordinator assets together using the full restart.
The shared travel watchdog regroups
after three seconds of fresh missing local route reports, preserving the destination
and checking navigation ownership first. Validate with `shared-convoy.test.cjs`,
`convoy-defense.test.cjs`, and `passive-hunting.test.cjs`.

Managed public distributions use the host's authenticated update controller. Its
expiring `AL_DATA_DIR/updates/pause.json` lease suppresses new merchant/bank
dispatch and returns a maintenance-only heartbeat until each fresh character
acknowledges idle inventory/movement state. Missing or busy acknowledgements
defer installation; no unacknowledged runtime is assumed safe. The lease is not
persisted in game settings. Character and coordinator assets must be released
together. See `docs/distribution.md` and `console-updates.test.cjs` for package
startup, state backup, source-edit protection and rollback behavior.

The account Characters panel retains the last reported doll and sprite in
`characterAppearances` within the persisted roster. Full heartbeats update this
cache only when appearance changes; empty reports never erase it. Offline cards
use the cached appearance without restoring live status. Characters never observed
with a usable portrait need one normal connection before an offline doll is available.

WTB quantities are remaining purchases, not desired inventory stock. Native stand
fills and automatic shopping share that remainder. Inline price, quantity, and
priority edits use `editField`, `value`, and `bidRevision` on the bid endpoint;
only quantity edits replace the remainder. Completed or replaced orders reject
stale field edits. Validate with `native-stand.test.cjs`,
`native-stand-client.test.cjs`, and `active-wtb-fields.test.cjs`.

Bank sorting defaults to `bankSortMode: "automatic"`. Merchant settings can select
`"request"`; the bank window then queues/cancels a durable, uniquely identified
sort without dispatching travel. All cosmetic sorting callers in the shared
character runtime use the same authorization checkpoint. A request made during
a visit waits for a later entry; floor transitions retain the visit identity.
After ordinary banking work, departure waits for the requested pass over owned
packs on reachable bank floors (existing keys only). Completion requires the
same request, visit, and currently reporting runtime. Failures retain the intent;
restarts recover it as retry. Automatic passes cache each floor's final contents
for that visit. Normal deposit stacking and required banking transfers are not
controlled by this setting.

Stack consolidation is independent of cosmetic sorting and runs during normal
bank visits across accessible owned floors, using existing keys. Deposits fill
compatible partial stacks before opening new stacks; partial transfers respect
the game's stack limits (for example, tomb keys 46/46/5 become 50/47). Unrelated
items stay in place when sorting is off. Staging slots, queued withdrawals and
craft ingredients are excluded. The existing bank-sort checkpoint accepts the
`stack` action and returns current protected locations and item types without
claiming or completing a cosmetic sort request.

The separate `party-bank-stack-buffer:<character>` journal records temporary
inventory slots and expected operation results before mutation. Unconfirmed
operations are not repeated; unresolved buffers prevent departure. Lack of safe
buffer space defers partial transfers instead of creating unnecessary stacks.
Validate with `bank-partial-stacks.test.cjs`, banking integration tests and the
full regression suite. Publish character and coordinator assets together.

Sorting buffers are journaled before mutation in character local storage and
returned before departure, including after cancellation/reload. Failed recovery
holds the merchant in the bank rather than treating carried bank stock as cargo.
Validate with `bank-sort-request.test.cjs`, bank consolidation/stack routing, and
craft/compound reservation tests. Publish both character and coordinator code
with the ordinary supported restart below; a coordinator-only restart is not
sufficient for this feature. Live character reports expose `bankSortProtocol: 1`.


Merchant heartbeat stock checks complete only the merchant's own restock job.
Party restock assignments await the service completion flow; the merchant's full
potion stacks cannot clear another character's delivery. Validate with
`coordinator-recovery-composition.test.cjs` and `coordinator-merchant-recovery.test.cjs`.
This change needs only the coordinator-only restart.

All active merchant visits reveal their recipient within transfer range, including
restocks, item delivery, pickups and gold collection. Fresh same-realm/map/instance
positions and the current merchant command authorize a short heartbeat visibility
lease; the recipient verifies local proximity before stopping invisibility. The
rogue skill runtime suppresses automatic invisibility while that lease is active.
Validate with `merchant-visibility.test.cjs` and `merchant-rendezvous.test.cjs`.
Publish both coordinator and character assets with the ordinary restart.

Merchant deliveries carry durable IDs. `/party-api/merchant/delivery-receipt` accepts
`deliveryReceipt: true`, merchant `character`, `target`, `deliveryId`, and a phase
of `uncertain` or `confirmed`. The runtime journals before sending and acknowledges
each confirmed send independently of job completion. Uncertain sends remain blocked
rather than being repeated; missing stock blocks only that delivery. Fresh reports
reconcile legacy equip requests already equipped by their recipient. Anniversary
pre-start deferrals release queue ownership without extending the worker watchdog.
Validate with `merchant-delivery-recovery.test.cjs` and merchant recovery/completion
tests; publish character and coordinator assets together using the ordinary restart.

Marked deliveries create their own merchant jobs by default, at priority 90.
Merchant settings can disable these delivery-only trips: waiting delivery jobs
are removed, active trips finish, and marks remain available for other visits or
explicit party/character sends. The Marked deliveries routine remains visible but
disabled until enabled in Merchant settings. Only ready marks schedule visits;
blocked transfers and pending equipment confirmation keep their existing recovery
flow. Empty delivery jobs are discarded before dispatch. Validate delivery-trip
settings/UI, scheduling, queue, dispatch, and delivery-recovery tests. This change
needs a coordinator-only restart and refreshed dashboard assets.

Manual upgrade menus request server previews through `/party-api/upgrade-preview`.
The auxiliary heartbeat request and `/upgrade-preview/result` response are ephemeral
and expire after ten seconds; they never create merchant jobs. Only the executing
merchant's exact inventory item and currently carried scroll/offerings are queried.
The runtime always uses `upgrade(item, scroll, offering, true)` and serializes it
against inventory/production work. A timed-out official deferred retains its guard
until it settles, so a late preview cannot resolve a real upgrade. The menu shows
unavailable reasons instead of estimates, and labels the server percentage without
the separate lucky-slot roll adjustment. Validate with `upgrade-preview.test.cjs`
and `upgrade-offerings-ui.test.cjs`; publish character and coordinator assets together.

Lucky-slot discovery records only ordinary upgrade-scroll `q_data` rolls, excluding
compound, stat-scroll and offering-only operations. Unknown slots no longer block
upgrades. Normal jobs rotate through the least-sampled slots until a slot meets
the statistical inference threshold, then continue testing that slot.
Inventory swaps use the existing durable upgrade recovery journal. No extra
upgrade jobs are created. Explicitly verified saved slots remain authoritative;
the legacy hardcoded GoldMajesty slot-7 default is retired. Statistical candidates never populate
`luckyUpgradeSlots` or trigger inventory tidying as if verified.

`luckySlotTracking` persists per-character client streams in coordinator settings.
Clients retain their stream and last roll receipt locally, replay cumulative counts
on heartbeats, and receive other clients' history before selecting a slot. Replayed
or older counters cannot double-count or replace newer evidence. The merchant's
Lucky slots dialog shows combined evidence and search confidence. A slot is labeled
inferred at 99.9% model confidence after at least 100 observations there; continued
observations may change that conclusion. See [the source audit](../../docs/lucky-slot-discovery.md).
Validate lucky-slot tracking/UI, lucky-upgrade recovery, heartbeat and persistence
tests. Publish character and coordinator assets together with the full restart.

Fresh inventory reports relocate delivery marks to the item's current slot before
scheduling work. Existing matching slots retain ownership before displaced marks
claim other copies; merged stacks reserve each request's original quantity across
recipients. Relocation preserves delivery IDs, equipment intent, and uncertain-send
blocks. Missing stock and stale-order cleanup never cancel a delivery. Validate
with `merchant-delivery-recovery.test.cjs`, `coordinator-scheduling.test.cjs`, and
`coordinator-sale-routes.test.cjs`. This reconciliation change needs only the
coordinator-only restart.

Automatic inventory rules are shared through `inventory/shared-rules.ts` and
managed on the merchant panel. The versioned migration retains its original
documents in `merchantRules.backup`; merchant rules take precedence and unresolved
fighter conflicts remain inactive until selected. Manual requests retain their
character and equipment-slot ownership. Automatic processing pickups use the
normal collection threshold and nearby exception.
Deconstruction reservations match item identity as well as slot, so stale records
cannot block NPC-sale pickups for replacement items. Automatic missing-item marks
recover when fresh inventory contains an available copy; uncertain attempts and
other blocked operations still require review. Validate player NPC sales,
deconstruction, and automatic collection; activate with a coordinator-only restart.
Manual bank/merchant collection marks override an opposing automatic collection
rule for the marked stack, including after slot relocation. Other stacks still
follow the rule; removing the manual mark restores automatic handling. Validate
with `coordinator-mark-reconciliation.test.cjs`; coordinator-only restart suffices.
Fighter pickups for automatic upgrade, compound and NPC sale rules share one
`party collection` job per character, using the Automatic item collection toggle,
threshold and priority. Queued legacy automatic pickups merge on startup; active
jobs finish unchanged. Collection retains cargo for separate merchant processing
and preserves sale receipts and reserved crafting quantities. Manual jobs retain
their own ownership. Merchant processing reports bank retrieval, processing and
bank storage separately. Validate with `automatic-collection.test.cjs` and
`automatic-collection-client.test.cjs`; publish character assets with this change.

Auto compound includes temporary storage: below-target merchant inventory without
a complete eligible group is banked, without creating or clearing Auto bank rules.
Complete groups use inventory first and withdraw only missing ingredients. Finished
outputs follow their own tier's storage marks. Protection checkpoints refresh active
compound rules and conflicting item tiers before storage or consumption; full-bank
failures use the existing capacity block until contents change. Target-level success
receipts log `merchant completed auto compound` once, including unlimited rules.

Upgrade offerings are separate from automatic target rules. `upgradeOfferingRules`
stores item-wide half-open level ranges: +7 to +9 applies at +7 and +8. The
`upgrade-offering-rule` character command creates, edits, or removes a range;
overlapping ranges are rejected. Required offerings preserve an unfinished mark
with `waitingOffering` until stock or policy changes. Optional offerings retrieve
owned bank stock before falling back. Neither mode buys offerings. Merchant and
bank availability excludes locked stock and existing crafting/delivery reservations.
Manual `upgrade-mark` requests with `offering` authorize one attempt and carry a
durable `requestId`; a surviving failure does not retry. Production receipts and
lucky-slot journals account for the offering and prevent duplicate consumption.
An unissued manual attempt can be abandoned during recovery without losing its
request. Validate with `upgrade-offerings*.test.cjs`,
`upgrade-offering-recovery.test.cjs`, and `lucky-upgrade.test.cjs`. Publish character
and coordinator assets together through the supported restart below.

Automatic upgrade passes persist their original item, target and `passId` before
the first production attempt, including bank withdrawals. Reconciliation pauses
during lucky-slot swaps/recovery and inventory tidying, and follows a uniquely
matching relocated survivor. Intermediate levels remain reserved for processing;
completion clears the pass by ID. Missing scroll/item inputs retry instead of
creating a capacity block. Validate with `merchant-upgrade-recovery.test.cjs`,
`coordinator-mark-reconciliation.test.cjs`, `coordinator-merchant-completion.test.cjs`
and `upgrade-offerings-client.test.cjs`. Publish character and coordinator assets
together through the supported full restart.

Finite upgrade/compound quantities mean remaining successful target-level outputs,
not desired stock. `inventory/production.ts` persists admission and completion
receipts before acknowledging them. Character code journals each operation locally
and retries a lost receipt without repeating production. Failed operations and
existing inventory do not decrement quantities; zero retains a completed rule.
Changed rules do not consume receipts admitted against an older rule value.
An unresolved operation blocks further inventory commands until its outcome can
be recovered. Validate these behaviors with `shared-merchant-rules.test.cjs`,
`production-journal.test.cjs`, and `item-action-menus.test.cjs`.

Production recovery inspects admission by journal identity before taking action.
A prepared journal that was never admitted is discarded without admitting new work;
a different unfinished coordinator attempt remains held for explicit review.
Production and journal recovery serialize locally to prevent overwriting an active
journal. The existing `/party-api/merchant/production` endpoint accepts `action:
"inspect"` with the original character/id/kind/item and returns its attempt plus
pending identities. After reviewing an orphan, an operator can submit those same
identity fields with `action: "resolve-unknown"` and a nonempty `reason`. This
retains a timestamped unknown-outcome receipt, does not consume quotas, and prevents
replay or late completion from changing the resolution. Automatic recovery never
uses this operator action. Merchant retries retain their reported deferral cause.
Stand open/closed observations travel in both the dashboard snapshot and fast
telemetry; absent observations display as unknown. Validate production reconciliation,
production journal, offering recovery, merchant recovery, dashboard live and stand
inspection tests. Publish character/coordinator assets with the ordinary full restart.

Craft orders reserve their remaining exact-level ingredients as soon as they are
queued. Reservations are derived from durable order allocations and crafting
checkpoints, including frozen recipe materials for newly queued orders. Automatic
compounding excludes these quantities when scheduling, staging BankBoi stock,
withdrawing from the bank, and selecting each live triplet. It refreshes protection
through a read-only `protectionOnly` merchant checkpoint before consuming stock.
Allocated source locations are preferred; missing allocations relocate against
current inventory. Completed/cancelled orders release reservations automatically.
Merchant bank errands refresh these reservations before each marked deposit,
including when another job interrupts crafting. Reserved ingredients and partially
reserved stacks stay in inventory, with their bank marks pending. Resumed crafts
normalize absent material levels to zero when locating bank stock; other marked
item lookups retain strict fingerprints. Validate with `merchant-bank-full.test.cjs`
and `merchant-crafting.test.cjs`, including a six-ring order resumed after four crafts.
Legacy orders use their saved requirements and the current recipe catalog; an
unrecoverable recipe produces a diagnostic and blocks automatic compounding.

At startup, Bestiary, Skills, and item catalogs are validated against the installed
game version's `data.js`. Every source ID and serialized definition field must
match; derived client fields are allowed. Invalid reports cannot replace a valid
catalog, and missing catalogs continue to be requested. Validation outcomes are
logged. A game-client update prepares a new validator before activation and clears
the old catalogs so reports must pass against the new version. This checks the
installed game data; it does not independently fetch a second upstream version.

Character and dashboard build history, retention, and rollback commands are
documented in [tools/BUILD-HISTORY.md](../../tools/BUILD-HISTORY.md).
These roll back generated character/dashboard code, not coordinator state or code.

From the repository root, after editing TypeScript:

```powershell
npm run typecheck
npm test
npm run build:runtime
.\scripts\start-console.ps1
```

Building the coordinator bundles alone does **not** reload the running process.
Steam CODE recovery can repair connected runners during failed/navigating group
arrivals only after confirmed release, with matching primary, assigned membership,
and destination realm. It never logs a character in or transfers ownership.
Bridge revisions invalidate class artifacts so existing one-line loaders install
the updated bridge automatically. Validate with `steam-recovery.test.cjs` and
`loader-connection.test.cjs`; publish character assets through the full restart.
Retained combat nominations wait safely when the leader has no heartbeat during
startup (`nomination-retention.test.cjs`).
Hunt turn-in and anniversary staging share the persisted continuous-return convoy.
Return combat selects only current party attackers, including while planning or held.
The ordinary class attack/support loop runs without formation, approach, kiting,
optional encounters, or combat/loot departure holds. Nearby chests remain opportunistic.
Town is synchronized through the route transition barrier. A failed/interrupted cast
supersedes all outstanding member commands immediately and selects walking. Partial
warps establish a forward Town rally; successful members are never sent backward.
Fresh current aggro selects walking. Town becomes eligible again when the party
reports no attackers, even if the enemies survived, or completes a map transition
without aggro. Missing observations do not prove safety. Temporary Town unavailability
while casting is not an interruption. Cooldown changes can release an unavailable
Town hold without repeatedly restarting an unchanged route.
Both owners retain one retry after the initial planning cycle. Native fallback is
bounded at thirty seconds; interrupted Town and combat do not consume route retries.
Exhaustion retains the first and latest failure and continues in-range defense;
owner recreation/restart cannot reset the budget. A genuinely new Town opportunity
can release a route failure. Manual navigation and communication/death recovery win.
Anniversary visits hand back to the existing post-event workflow after Main arrival;
Hunt continues its itinerary to Daisy. This does not change farming after the visit.
Validate unified-return, continuous-hunt-return, hunt-return-town, shared convoy,
movement, class skills, and anniversary tests.
Publish character and coordinator assets together for these checks.
Transition release is latched; duplicate acknowledgements
are idempotent, and temporarily stale observations wait without discarding ownership.
The travel checkpoint retains destination, stage, navigation revisions and observed
positions/progress, never ephemeral barrier readiness. Completion requires fresh
participant positions at Daisy; cancellation is not arrival. Unchanged failed rare
pursuits wait for material new evidence without changing rare/event priorities.
An authorized rare encounter carries participant navigation revisions. While it
owns a participant, the saved Hunt stage does not impose travel-only combat rules;
actual new movement commands still take precedence. Without this handoff, rare
acquisition cancels travel but cannot select a target, producing ten-second retry
loops. Cover both outbound and returning Hunt stages with the real grouped combat
snapshot in `phoenix-patrol-regression.test.cjs` and `travel-defense.test.cjs`.
Those tests must include actual death-recovery preparation, which must not apply
a second stage-based travel filter. Empty-zone searching also yields while a rare
encounter awaits combat selection so it cannot pull the leader away from regrouping.
Heartbeat scatter learning must retain grouped mode while the rare controller owns
the party, matching the mode sent to characters. A learned Hunt monster reported
during a rare encounter must not clear the shared target queue. Cover this through
fighter and merchant heartbeats and resume ordinary scatter after rare ownership
ends (`coordinator-status-composition.test.cjs`, `phoenix-patrol-regression.test.cjs`).
Validate with `continuous-hunt-return.test.cjs`, `hunt-return-regression.test.cjs`,
`movement-barrier.test.cjs`, `planner-geometry.test.cjs` and `shared-convoy.test.cjs`.
These changes include `characters/shared.js`, so they
require the full restart. An already exhausted return uses the existing
`/party-api/monster-hunt/retry-return` action after fresh runtimes connect.

For coordinator/dashboard-only changes, use `scripts/start-console.ps1 -CoordinatorOnly`.
This verifies the installed launcher, builds the coordinator, and restarts services
without installing or publishing character assets or starting their build watcher.
Use the ordinary restart when character changes must also be published.

The start script builds before stopping the previous supervisor, installs the
launcher, publishes character/browser assets, and starts the services. Use that
supported restart path to activate a manual coordinator change. It restarts the
party services, so choose an appropriate moment in gameplay.

For coordinator bundles, `--publish` is unnecessary: they are always written to
`.build/runtime/`. The runtime builder's `--publish` additionally copies browser
outputs into `characters/`. Changing the installed launcher can trigger the
supervisor's file watcher; a supervisor restart also reloads the coordinator.
Neither is equivalent to merely building a bundle.

After a restart, valid ordinary party travel can rebuild automatically after
fresh compatible reports arrive. Hunt and event returns keep their own recovery;
completed event returns release leftover convoys instead of starting another trip.
Manual cancellation and newer navigation are never authorization to retry old travel.

Hunt rosters include only fresh combat members following the current leader on
the same server. Saved Follow preferences do not enroll offline characters.
Existing cycles prune departed members before quest, backup and return handling;
departed quest owners release their selection so the current party can continue.
A stale leader report defers reconciliation rather than emptying the roster.
Validate with `coordinator-hunt-composition.test.cjs`; coordinator-only restart suffices.

Hunts return to Daisy when the selected quest is complete or expired, never merely
because it has less than three minutes remaining. The selected owner may keep
farming through the final second. Hunt's own `farm-recovery` shared walk yields on completion or expiry,
before event-pause handling. Failed farming walks also release on fresh reports,
with matching parent revisions and command ownership. Actual event travel, Escape,
death recovery and manual navigation keep priority. Test `hunt-farm-walk.test.cjs`.
Rare acquisition uses the same turn-in priority during travel and claims, so a new
Tiny P sighting cannot repeatedly cancel the Daisy convoy. Cover the real wiring
with `coordinator-recovery-hooks.test.cjs`.
An unseen engaged queue head may yield to a visible eligible alternative after
eight seconds of fresh party absence observations even when local search cannot
reach its last position. This releases an obligation, not a death: old attack
evidence stays retired and a new living sighting can nominate the monster again.
Sightings, attackers and fresh attack evidence preserve the current fight; stale
reports and activity pauses do not advance the timer. Validate with
`unseen-primary.test.cjs` and `bee-recovery.test.cjs`; coordinator-only restart suffices.

Hunt candidates use each observing party member's local search radius. Followers
can nominate the current Hunt species, including outside the original spawn area.
A completed temporary encounter continues with a fresh eligible nearby candidate
before installing a departure loot barrier or resuming the saved spawn route.
The original destination remains the fallback when no valid candidates remain.
Hunt convoy acquisition also runs during assembly and shared route preparation;
it does not require returning to the route origin first. Normal target revision
acknowledgements still govern attacks. Validate with `hunt-temporary-encounter`,
`hunt-route-acquisition`, `combat-queue`, and `fringe-targeting` tests. Publish
character and coordinator assets together with the full restart workflow.

Anniversary return readiness is retried on every coordinator tick, not only at
the event deadline. Once party visits complete, a matching saved farming or
staging walk yields to the return, including a failed walk. Saved/current
navigation revisions must match; newer manual movement and protected convoys
remain authoritative. The featured-party-member one-minute hold is unchanged.
Validate with `farming-navigation` and `coordinator-anniversary-return-composition`.

Event recovery retires an overlapping `farm-recovery` shared walk or failed event
entry walk when its saved navigation revisions still match, including after
restart. It preserves event-return commands and captured waypoints, and rejects
late farming/event-entry walking requests and event departure permission until
the event return releases ownership. This lets Goobrawl's transporter approach
and Ice Golem's exit from Winterland run before returning to the saved checkpoint.
A combat event ending during a protected Daisy return preserves the Hunt's owned
travel command. Once fresh participants have exited to Mainland, matching event
recovery yields directly to Daisy instead of dispatching a checkpoint convoy.
Legacy returns failed by an `event-return-town` replacement are retired only after
matching navigation revisions and completed Town reports; unrelated failures,
manual cancellation, newer commands, Escape, and death recovery stay protected.
Validate with `hunt-ab-return.test.cjs`; coordinator-only activation suffices.
If deferred participants reach Main after checkpoint travel was dispatched, their
matching saved navigation is included in a rebuilt return plan. A newer manual
navigation revision cannot rejoin the old return.
The return's own farming reunion walk is permitted only when its parent command
ID and navigation revision match the recorded return route; unrelated farming
requests remain blocked while recovery owns movement.

Anniversary-to-combat handoff also retires its owned `anniversary-staging` walk.
Event recovery repairs staging walks left behind by older handoffs, including
failed walks restored after restart. Both paths require matching participants
and saved/current navigation revisions, and preserve protected travel. Late
staging requests cannot reclaim movement during combat handoff or recovery.
Validate the entire return through Hunt leaving `paused-event`; arrival at Main
alone does not complete recovery to the saved destination.

Merchant collection pauses an ordinary or event-return convoy through a persisted
interruption. All members acknowledge a stop before the recipient receives its
handoff; completion or the 60-second deadline regroups the party toward the same
destination. The interruption retains shared-walk parent commands and navigation
revisions, and never authorizes resuming after a newer navigation order. Protected
Hunt turn-in remains exclusive. Both collection and commerce callers understand
the handoff endpoint's `waiting` response; publish the character runtime along
with coordinator changes to this protocol.

Recovery also recognizes orphaned event-return exit walks by their saved parent
cycle. A failed exit already at Main is retired before checkpoint dispatch; those
still outside Main receive fresh exit commands. Validate merchant interruption
during both exit and checkpoint travel, including restart, timeout, and a newer
manual move. Hunt must resume combat after checkpoint arrival.

Normal travel releases passive retained targets and waits for current attackers
and pending loot. Freshness comes from `groupedCombat.currentAttackersAt`, sampled
from a connected game client, rather than the last monster update packet (quiet
maps may not emit one). Missing reports hold travel with an observation message.
See [travel defense validation](../../docs/travel-defense-validation.md).

## Migration evidence

See [APPLICATION-MIGRATION.md](APPLICATION-MIGRATION.md) for current validation
and completion audit. [MIGRATION-HISTORY.md](MIGRATION-HISTORY.md) retains
historical checkpoints; its incomplete-state descriptions are historical.

## Live official client updates

Coordinator startup checks the official client before starting workers. After that,
headless game sockets report `welcome` and `reloaded` through worker IPC. There is
no periodic update poll. A welcome checks the official manifest; reloaded and
bootstrap repair also refresh existing script contents to catch same-version
changes. Concurrent events share one refresh; a reloaded event during a refresh
causes one follow-up check.

Downloads are staged and syntax checked, and live candidates must contain valid
`G.geometry`, `G.maps`, and `G.items` before publication. Failed preparation leaves
running workers and the selected version unchanged. New versions retain the old
cache; pinned versions are excluded from startup cache cleanup.

Activation swaps the default version, map data, and coordinator catalogs before
restarting enabled, unpinned headless workers one at a time. Each replacement must
report the selected client version and its unique process instance within 60 seconds.
A failed verification halts the rollout and publishes `clientUpdate.error`; a later
welcome/reloaded/repair event retries unfinished workers. There is no silent
rollback after activation and no claim that a syntactically valid client is guaranteed
to work with every future server change. Native/Steam sessions remain browser-owned.

The dashboard core publishes `gameVersion` and `clientUpdate`. The header displays
that coordinator-selected version without changing header layout height.


Merchants can independently select all supported events. Combat attendance uses
current equipment and the normal attack controller, without enabling farming.
New merchant jobs, gathering, and stand work pause while event ownership is
active. Production yields before its next admission and crafting uses durable
checkpoints; other in-flight work finishes before travel. Event sessions and
return ownership retain this reservation through coordinator restart. Publish
character and coordinator assets together with the ordinary full restart.
Validate with `merchant-events`, `shared-walk`, event selection/return, and
merchant checkpoint/recovery tests.

Hunt pickup and outbound shared convoys recover missing completion acknowledgements
using the same three-second verified-arrival hold as continuous Daisy returns.
Fresh stopped reports must match the route, command, runtime, server and navigation
ownership; legacy per-leg returns retain their transition barriers. Validate
shared-convoy and continuous-hunt-return tests. Coordinator-only restart suffices.

Delivered equipment retains its awaiting-equip receipt instead of overwriting an
active command. Scheduling uses the merchant interruption barrier to stop convoy
participants, equip the recipient, and rebuild the saved destination under a new
route epoch after the equipment receipt. Equipment pauses outlive the merchant
job but retain the bounded deadline and navigation ownership checks. Combat and
loot are reconciled while stopping/resuming so defending reports cannot deadlock
the held acknowledgement barrier. Validate merchant-convoy-interruption,
coordinator-scheduling, delivery-precedence and inventory receipt tests; activate
with the coordinator-only restart workflow.


## Bounded Hunt route recovery

Rejected ALClient walking segments on the current map receive one native connector
search, limited to three seconds. The connector runs from the character's actual
position to the rejected segment endpoint, replaces that route prefix, and must
pass full route validation, including every remaining door and transition. Failure
falls back to one complete native search (30 seconds). Collision checks always use
the live character base and processed game geometry; ALClient cheat edges stay off.

Outbound Hunt missions persist recovery under the Hunt cycle and destination.
An execution failure before native fallback gets one coordinator-owned native
attempt. After native exhaustion, the party attempts one relocation: Town only
when the failed journey permitted it, otherwise a catalogued ordinary door exit.
Outbound Hunt walking currently forbids Town. Relocation has the same collision,
formation, defense, ownership, and arrival barriers as other shared travel.
Every member must report a fresh position at the relocation destination before
one final ALClient attempt. That attempt cannot restart native fallback. An
inaccessible origin remains held with its cause. A destination still unreachable
after relocation is excluded for this cycle and the existing spawn ranking chooses
another location for the same monster. No remaining spawn produces an explicit hold.

The farming controller yields during Hunt mission travel and cannot adopt temporary
recovery exits as monster spawns or grant fresh retries. Relocations preserve the
public farming destination and the original mission destination.
Replacement farming walks and event interruptions retain the destination budget;
intentional stops and planning-origin drift do not consume route failures. Readiness
has its own bounded hold, and movement evidence must match the current command. Recovery cannot supersede merchant,
event, death, Escape, or newer navigation ownership. New cycles, explicit Hunt
resume, and changed geometry grant fresh budgets. A coordinator restart preserves
attempts and the first failure. Missing legacy relocation evidence is reported;
no exit is invented. Terminal commands and heartbeat failures carry structured
movement evidence, and cancellations identify owned command changes where known.
Legacy unattributed stop calls remain explicitly labelled. Similar-message counts
are scoped and are never presented as route-attempt counts.

Cruise speed is applied once per convoy/cap value and retained across phase/epoch
changes. Releasing its current owner restores 500 once; stale cleanup cannot
change a replacement owner's cap. Replacement runtimes reapply their cap without
waiting for the game's unresolved cruise deferred.

Validate `hunt-route-recovery`, `cgoo-planner`, `movement-service`, `convoy`,
`shared-convoy`, Hunt travel/event/communication and merchant interruption tests.
The game-17175 regression fixture exercises the reported blocked arena segment in
both directions, the tower, its ordinary exit, and the level4 route, using fresh
planner workers. Publish character and coordinator code together with the full
restart above; verify generation acknowledgements separately from live travel.

Coordinator JSONL storage is maintained in `persistence/jsonl-store.ts`. Startup replays one record at a time instead of reading the complete append journal as a string. Compaction writes records individually and atomically replaces the journal, with a 128 MiB size trigger in addition to the interval. Existing key/value and tombstone records remain compatible. Writer locks and corrupt-input failures preserve the original journal. Validate `coordinator-jsonl-store.test.cjs`; activate with the coordinator-only restart.


## Convoy report timing and temporary holds

Full and fast status share a runtime-scoped sequence and an atomic travel sample.
Coordinator receipt time establishes attacker freshness; client-adjusted wall clocks
do not reject freshly sampled empty observations. Reordered/duplicate samples cannot
overwrite movement/route state or renew observation freshness. Disconnected samples
cannot authorize departure. Fast replies carry complete route-owned walking leases,
which clients accept at transport receipt using monotonic deadlines. Lease-only renewals
do not change combat long-poll revisions. Commands still arrive through full status.

Observation/communication loss is a temporary shared hold, preserving retry budgets
and cruise ownership. Recovery requires fresh matching stopped reports and the existing
stability/cooldown window, then plans from current stopped positions. It never sends an
assemble command to an old rally or invents a defensive loot obligation. Genuine prior
defense/loot remains owned. Full/fast timing, clock estimates, and bounded coordinator
event-loop delay accompany travel diagnostics.

Validate `convoy-timing`, combat ingestion/channel, convoy communication/defense, shared
convoy, movement, Hunt returns, merchant interruptions and event recovery. Publish both
character and coordinator assets through the supported full restart and verify their
generations independently before claiming live travel is repaired.


## Hunt spawn arrival

Outbound Hunt travel hands off to farming once every participant reports inside
the selected spawn shape (zero margin), rather than within 50 units of its center.
Point-only destinations retain the configured search-radius fallback. The owned
convoy issues shared holds and waits for fresh stopped command/epoch/runtime
acknowledgements before releasing movement ownership. Existing loot completes
under its original owner; attack evidence survives the stop. Persisted farming
states with an outbound convoy use this same handoff.

The ordinary three-target queue then resumes. Nominations never authorize a new
pull: current-target, formation, acknowledgement, and existing-attacker checks
remain unchanged. Validate hunt-area-arrival, Hunt safety/travel-defense, combat
queue, markers, shared convoy, and communication tests. Activate with the supported
full restart and verify spawn-edge arrival and sequential attacks live.

## Shared movement communication failures

All protocol-4 shared convoys, including anniversary staging, hold on coordinator
communication loss without spending route retries. Movement errors retain typed
request metadata through executor and promise boundaries. Barrier HTTP requests
retain their two-second per-request limit and retry the same identity with 250 ms
to 1 s backoff, bounded to ten seconds and the current walking lease/ownership.
Completed transitions retry only their acknowledgement, never the transport itself.
Planner request loss also holds; validated alternate candidates remain usable.

Captured legacy communication-only failures may recover once under matching
convoy/epoch/navigation ownership; mixed route failures are excluded. Restart
restores temporary holds for protocol-4 workflows. Event cycles and kiss receipts
remain owned by anniversary policy, including expiry and Hunt handback. Bounded
status-stage and barrier timings expose handler cost separately from event-loop delay.
Validate barrier-communication, movement-service, return-planner, shared-convoy,
convoy-communication, movement-barrier, anniversary kiss/return, and status-ingestion.
Publish characters and coordinator together with the supported full restart.
