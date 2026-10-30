# Efficiency

These changes make the console do less work for the same result: fewer and
smaller disk writes, smaller status reports and state sections, fewer
requests and log lines, and less coordinator CPU on hot paths. Each section
below has the failure inventory, the change and its measurements. Sections
first measured on v1.4.0 keep those numbers; the summary and the "On 1.5"
tables repeat each measurement on Ryan's `1.5-feature-branch` against this
branch, with the same scripts on the same runner. The branch sits on
`1e12540e`. The per-group tables measured `c691d60e`, four commits earlier;
those four commits change catalogue preparation timing, gathering tool
reports, a dashboard dialog's open state and tests, none of the measured
paths. The combined build profile measured `1e12540e`.

## Summary on 1.5

Medians of each script's runs on the shared Linux runner (Node 24); a range
is the spread across runs. Character-thread and coordinator CPU come from the
combined build profile (below), which ran the 1.5 tip and this branch on one
disposable game stack.

| Measure | 1.5 | This branch |
|---|---:|---:|
| Coordinator journal writes, farming (`tools/benchmark-persistence.mts`) | 5.27 MB/s | 0.25 MB/s |
| Coordinator journal writes, production | 7.02 MB/s | 0.72 MB/s |
| History save per combat-log POST, median | 3.95-4.28 ms | 0.000 ms |
| Compaction pauses in 600 s, farming, median length | 40, 45-51 ms | 3, 23-33 ms |
| Metrics journal writes, 4 characters (`tools/benchmark-metrics-journal.mts`) | 14.9-15.0 KB/s, 1.26 GB/day | 4.2-4.3 KB/s, 0.36 GB/day |
| Metrics POST acknowledgement, median / p95 | 0.3 / 0.5-2.0 ms | 213-228 / 751 ms |
| Merchant status report | 1,791,821 B | 29,721 B |
| Merchant status report with bank, coordinator time | 5,294,086 B, 64-96 ms | 73,982 B, 4.8-7.2 ms |
| Fighter status report, coordinator time | 571,133 B, 8.7-11.3 ms | 8,683 B, 2.5-3.4 ms |
| Character: build the item part of a merchant report | 36-49 ms | 0.9-1.3 ms |
| `section=bank`, live-size bank | 3,507,304 B, 20-31 ms | 197,703 B, 1.7-2.0 ms |
| Unchanged `section=bank` poll with `revision=` | 200, 3,167,456 B, 16-19 ms | 304, 0 B, 0.9-1.0 ms |
| Unchanged `section=logs` poll with `revision=` | 200, 348,580 B, 2.2-2.3 ms | 304, 0 B, 1.5-1.7 ms |
| Host health check | full state, 3.19 MB, 18.4-18.7 ms | `/party-api/ready`, 14 B, 0.37 ms |
| Unknown section such as `section=mail` | full state, 3.19 MB, 17-19 ms | 400, 114 B, 0.46 ms |
| `section=fast` with `PARTY_STATE_FIELDS=enforce` | see Field whitelist | see Field whitelist |
| Fighter status report, game stack farming (Inventory deltas) | 611-649 KB each, every report with items | 204-206 KB each, 1 in 20-25 with items (30 s refresh; now 10 s, not remeasured) |
| Merchant status report, game stack farming | 453 KB each | 69 KB each |
| Headless fighter CPU, farming / steady combat (combined build profile) | 39.9% / 38.0% of a core | 14.8% / 14.4% |
| Headless merchant CPU, farming | 16.0% | 6.9% |
| Coordinator CPU, farming / steady combat | 14.9% / 10.8% | 8.5% / 7.4% |
| Ready to attack, farming, p50 / p90 | 3-5 / 16-34 ms | 1 / 5-6 ms |
| `local_cm_logic` per fighter, 150 s farming (1.5 column: 1.5 with CT1-CT5) | 6.3-6.5 s | 0.35 s |

What costs more: shutdown takes 34-59 ms instead of 0.2-0.3 ms because it
compacts the journal and writes rollback settings, and a metrics collector
with no new frame sends an empty batch to learn that its waiting frames are
on disk (Persistence, Metrics history). No reader waits for either.

## On 1.5

Each group started on v1.4.0. This branch applies them, one commit per fix,
onto Ryan's `1.5-feature-branch` at `1e12540e`, in the order persistence (B),
field whitelist (A), report payload (C), inventory deltas (F), requests and
logs (D), coordinator (G), the 1.5 follow-ups, character threads (E) and
their follow-ups on 1.5, and the metrics outbox (P11).

Overlaps with 1.5 and how each keeps both sides:

| File | 1.5 change | Resolution |
|---|---|---|
| `playwright.config.ts` | rendering arguments, worker count, new live specs | 1.5's config; the console project adds `console-persistence.spec.ts` and `console-requests.spec.ts`, and the config adds the on-demand `speed` project |
| `merchant/completion-results.ts` | delivery imports | both imports |
| `telemetry/public-state-characters.ts` | `donationLevelXp` in diagnostics, `title` in compact meta | A's lists in `character-fields.ts`, with `donationLevelXp` added; C's catalog join; `title` kept |
| `telemetry/character-fields.ts` | `cc` (stream), `donationLevelXp` | both registered (state-field-registry.md, Fields added on 1.5) |
| `gear-comparison-dialog.tsx`, `merchant-card-controls.tsx` | #135 card imports and stat colors | 1.5's file; A's `audited()` wrap on the merchant merge |
| `use-panel-model.ts`, `use-party-console.tsx` | none (A and C overlap) | A's audit wrap and C's catalog join |
| `characters/shared.js` `itemDefinition` | `bonuses` and per-copy `title` | C's per-copy branch carries `title` when the copy has one; the full branch keeps `bonuses` and `title`; `bonuses` reaches per-copy entries through the catalog join |
| `status/ingestion.ts` | `rememberCharacterSnapshot` | F's `inventory.complete()` runs first, so snapshots see the carried inventory |
| `scripts/tests/coordinator-public-state.test.cjs` | "unknown sections retain full responses" | D's 400 replaces that expectation; the test helper accepts the 304 sections' text responses |
| `scripts/tests/coordinator-section-revision.test.cjs` | none (C and D overlap) | the bank mutation replaces the snapshot object, as bank observation does |
| `characters/shared.js` `departureTargetEngaged` | #87 checks ownership before the death list | 1.5's order; CT5's index serves the death check after it |
| `telemetry/dashboard-stream.ts` | none (C and H3 overlap) | C's catalog join on every publish; H3's `difference()` compares the joined cells |
| `docs/efficiency.md` | none | one file, a section per group |

Ryan's 37a36995 (recursive combat-report tick guard) lowers combat CPU on 1.5
by itself, so the character-thread tables on 1.5 measure against the 1.5 tip.

Semantic follow-ups on 1.5, each its own commit: the dashboard joins catalog
meta onto 1.5's saved character snapshots, two functions split in two to stay
under the lint complexity limit, and the persistence changes extend to the
metrics journal, the snapshots, the mail read marks and #87's metrics outbox
(Persistence, Metrics history and other saved state added in 1.5).

## Persistence

The coordinator keeps its saved state in one append journal,
`caraGarage.jsonl` (`runtime/coordinator/persistence/jsonl-store.ts`). Each
record is one whole document, for example `{"party_dashboard_history_state_v1": {...}}`,
and replay keeps the last record per key. `createCoordinatorPersistence`
(`runtime/coordinator/persistence/writer.ts`) decides when the writer saves
each document.

On a live v1.4.0 console the journal grew 0.9-7 MB/s, and history and settings
rewrites made up 97% of it. This section records the failure inventory for each
change, written before its tests, and the guarantees each change keeps.

Memory is always current. Every change below delays or skips only the disk
copy: HTTP routes, `/party-api/state` and the dashboard read the in-memory
state, so they show a change as soon as it happens.

`tools/benchmark-persistence.mts` drives the real writer and journal at the
live event rates and prints bytes written and call times. Pass `--root` to
measure another checkout with the same script.

### History saves (P2)

`party_dashboard_history_state_v1` holds `merchantActivity` (500 lines) and
`combatLogs` (500 lines per character), about 1.08 MB live. In v1.4.0 every
combat-log POST (`telemetry/combat-log.ts`), merchant activity line
(`telemetry/activity-service.ts`) and convoy acknowledgement
(`http/convoy-acknowledgements.ts`) rewrote the whole document, 3.3-5 times a
second.

`history()` now marks the document dirty and saves it at most once per
`HISTORY_SAVE_MS` (5 s). `historyNow()` saves at once; the combat-log clear
route uses it, so a cleared log stays cleared after a crash. `flush()` saves a
pending document, and coordinator shutdown (`lifecycle/shutdown.ts`) calls it
before it closes the journal.

Crash window: a crash or `SIGKILL` loses at most the last 5 s of history lines
from the disk copy. The game clients keep their own logs.

Failure inventory:

1. A burst of N lines inside the window writes N documents instead of one.
2. A line that arrives inside the window is missing from the saved document.
3. Shutdown inside the window loses the pending lines.
4. The saved document reorders or duplicates lines.
5. The dashboard shows new lines only after the save.
6. A clear followed by a crash restores the cleared lines.
7. A failing disk write inside the timer crashes the coordinator, where the
   v1.4.0 route only returned an error for that request.
8. A failed save leaves the document clean, so a later flush skips it.
9. The pending timer keeps the process alive after shutdown.

Tests: `scripts/tests/coordinator-persistence-writer.test.cjs` (1-4, 6-9) and
`e2e/console-persistence.spec.ts` (2, 3, 5 through the real coordinator and
dashboard).

### Saves by content (P1)

`write` in `writer.ts` passed `structuredClone(value)` to the store, and
`CoordinatorJsonlStore.set` skipped the append only when the new value was the
same object as the stored one, which a fresh clone never is. Every call appended
the whole document. On a live console 20 of 21 roster saves (one per native
status report, `status/ingestion.ts`) and 19 of 20 selections saves were
identical to the record before them.

The store now keeps the JSON text of each key's last record and appends only
when the new text differs. `set` serializes before it returns, which gives
callers the isolation the clone gave, so `write` no longer clones. Replay of the
journal gives the same values, because a skipped record repeats the one before
it. A value with no JSON form (`undefined`) saves as a deletion; v1.4.0 wrote
`{}`, which made the next start fail with `Empty storage record`.

The comparison costs one string compare per save on text `append` already
produced, and it replaces a `structuredClone` of the document (Measurements,
below).

Failure inventory:

1. An identical save appends a record.
2. The store skips a save whose content changed, including a change in key
   order or in an array the caller mutated in place.
3. The store skips a save of the earlier value after a delete.
4. The first save after a restart compares against nothing and appends, or
   compares against the wrong text and skips.
5. A caller that mutates its object after `set` changes what `get`, `entries`
   or the next compaction return.
6. Character `localStorage` strings stop round-tripping.
7. A value with no JSON form writes a record replay cannot read.

Tests: `scripts/tests/coordinator-jsonl-store.test.cjs` (1-7), including a real
writer and store for unchanged roster reports, and
`e2e/console-persistence.spec.ts` (1 and 4 through the real coordinator).

### Settings split and liveness timestamps (P3)

`party_dashboard_settings_state_v1` was one 1.23 MB document of about 90
fields (`settingsSnapshot`, `snapshots.ts`), saved within a second of any
change (`scheduleSettings`, `writer.ts`). Two parts are large and change on
their own schedule: the ALData market cache (`aldataMarketListings` 0.51 MB,
`aldataMarketBuyOrders` 0.11 MB and three smaller fields), replaced on each
ALData refresh (`commerce/aldata-service.ts`), and `production` (0.33 MB),
whose attempt phases change during upgrades. Most saves changed only liveness
timestamps: on a live console 14 of 14 consecutive settings records differed
in `eventAttendance.<character>.<event>.lastLiveAt` / `lastObservedAt`, and 13
of 14 in `farmAreaState.quiet`.

Layout 2 saves three documents:

| Key | Content | Saved when |
|---|---|---|
| `party_dashboard_market_state_v1` | the five `aldata*` fields | an ALData refresh replaces one of them |
| `party_dashboard_production_state_v1` | `production` | its content changes |
| `party_dashboard_settings_state_v1` | every other settings field, plus `persistenceLayout: 2` | see below |

Liveness timestamps keep their in-memory value at full rate. A settings save
whose only changes are these values waits until 30 s after the previous
settings record (`SETTINGS_LIVENESS_MS`):

- `lastLiveAt`, `lastObservedAt`, `elapsedMs`, `authorizedAt` and `seenAt`
  numbers inside `eventAttendance`, `eventSessions`, `farmingProfiles`,
  `farmAreaState` and `standPriceHistory`
- the timestamps in `farmAreaState.quiet`, whose area keys still count as a
  change, and the `farmAreaState.seen` hit filter

Any other change saves within a second, as in v1.4.0, and carries the pending
timestamps with it. The readers of these values use windows of 3 s to minutes
(`events/attendance-limits.ts`, `scripts/farm-area-control.cjs`), and a
restart already takes longer than those windows, so a value up to 30 s old
after a crash leads to the same decisions.

Crash window: liveness timestamps up to 30 s old; everything else as in
v1.4.0.

The comparison costs one `JSON.stringify` per field, which the save needs
anyway, plus a masked stringify of only the liveness fields that changed
(`eventAttendance` and `farmAreaState` are a few KB). The writer compares the
market document by array identity first, because `aldata-service.ts` replaces
those arrays and never edits them in place.

Migration and rollback:

- Load (`initial-snapshots.ts`): when the settings document carries
  `persistenceLayout: 2`, the market and production documents override the
  same fields in it. Without the marker, the settings document is the only
  source, so a v1.4.0 journal loads every field as before.
- The writer saves market and production before settings. A crash between
  them leaves settings without the marker, and load ignores the newer split
  documents only until the next save.
- Shutdown (`flush()`) saves the settings document in the v1.4.0 layout, with
  the market and production fields inside it and the marker kept. A v1.4.0
  build started after an orderly stop reads every field.
- After a crash, a v1.4.0 build reads settings without `production` and the
  market cache. It starts with no production receipts and refetches the market
  on its first ALData refresh.
- A v1.4.0 build rewrites settings without the marker. When the new build
  starts again, it reads that document and ignores the split documents it left
  behind, which are older.
- Dashboard export and import (`persistence/dashboard-import.ts`) cover neither
  `production` nor the market fields, so the split does not change them.

Failure inventory:

1. A v1.4.0 journal with only the monolithic document loses a field on load.
2. Split documents do not override the fields in a layout 2 settings document.
3. A settings document written by a v1.4.0 build after a rollback loses to
   older split documents.
4. A timestamp-only change appends the market or production document.
5. A timestamp-only change appends settings more often than every 30 s.
6. The writer never saves a timestamp-only change.
7. A material change waits for the liveness window.
8. A change in a liveness field other than a listed timestamp waits for the
   liveness window.
9. Shutdown leaves a settings document a v1.4.0 build cannot read in full.
10. The writer skips a market cache refresh, or saves the cache on every settings save.
11. Credentials or transient fields reach a saved document.

Tests: `scripts/tests/coordinator-persistence-writer.test.cjs` (4-11),
`scripts/tests/coordinator-initialization.test.cjs` (1-3) with a v1.4.0
journal fixture, and `e2e/console-persistence.spec.ts` (7 and 9 through the
real coordinator and dashboard).

### Compaction on growth (P4)

`CoordinatorJsonlStore` rewrote every live record into a replacement file,
fsynced it and renamed it over the journal every 30 s, whether or not the
journal had grown, and at 128 MB. With a 7.6 MB live set the timer alone wrote
about 250 KB/s and blocked the event loop for the whole rewrite.

The store now tracks the bytes of each key's newest record. It compacts when
superseded records exceed both `COMPACT_SUPERSEDED_BYTES` (32 MB) and
`COMPACT_GROWTH` (3) times the live set. A compaction rewrites the live set,
so it writes the append rate times live / superseded: for the 7.6 MB live set,
about a quarter of the append volume. With a threshold of 2 times the live set
and 8 MB, the benchmark compacted every 13 s during production (0.6 MB/s of
appends) and wrote more than the 30 s timer did.
The journal now peaks near 40 MB, under the 90-130 MB it reached between
compactions in v1.4.0. Every append checks the threshold, and the
compaction runs in a `setImmediate` after the request or status report that
crossed the threshold, so that save returns at its own cost. At 128 MB it still
compacts inside the append. The 30 s timer only retries a compaction that a Windows sharing
conflict deferred. Start-up compacts only a journal with superseded records,
and `close()` compacts one at shutdown, so the next start replays a compact
file. Compaction writes the JSON text kept since P1 and no longer stringifies
each value.

Crash safety is unchanged: the journal stays authoritative until the store
renames the fsynced replacement over it, and replay of an uncompacted journal
gives the same values.

Failure inventory:

1. The timer, a restart or shutdown rewrites a journal with nothing
   appended.
2. Growth past the threshold does not compact, compacts before the minimum
   size, or compacts inside the save that crossed it.
3. The live-set count drifts after deletes, replays or compactions, so
   compaction never runs or runs on every append.
4. Compaction loses a key or keeps a deleted one.
5. The store never compacts a journal over 128 MB.
6. A Windows `EPERM` / `EACCES` / `EBUSY` during the rename fails the write
   instead of deferring 30 s.
7. close() compacts a store whose open failed (malformed journal) and overwrites its source.
8. A compaction failure at shutdown keeps the writer lock.

Tests: `scripts/tests/coordinator-jsonl-store.test.cjs` (1-4, 8 new; 5-7 by
the existing size, sharing-conflict and malformed-input tests).

### Retention (P5)

Every collection below is Ryan's v1.4.0 code (checked with
`git show v1.4.0:<path>`). Counts come from the live journal on 2026-10-05,
10-08, 10-11 and 10-18.

Four collections keyed by game entity ids or player names had no expiry:

| Collection | Live growth | Window derived from the code | Fix |
|---|---|---|---|
| `farmAreaState.seen`, `.quiet`, `.activity`, top level and in each `farmingProfiles` entry | `seen` 0 to 38 entries, then frozen | `record()` in `scripts/farm-area-control.cjs` ignores hits older than 10 s and drops `seen` after 15 s, finished `activity` after 10 s and `quiet` after `COOLDOWN` (120 s), but only while it runs, so a snapshot saved while it is idle keeps them | `prune()` holds those three rules; `record()` calls it, and the coordinator applies it at load (`application.ts`) |
| `mluckCastAt` (player name) | 35 to 49 names | `mluckRemaining` (`merchant/luck.ts`) gives 0 for a cast older than `luckDurationMs` (1 h), the same as no cast | `pruneLuckCasts` drops casts at least 1 h old, on each new cast (`merchant/completion-results.ts`) and at load (`merchant/initial-gathering.ts`) |
| `rarePursuitProgress` (monster instance id) | 1 to 25 | none: an entry matters while its monster lives, and `rare-hunting.ts` deletes it only on a kill or retry evidence | `keepNewestRare` keeps the newest 100 by `progress`, on each write (`rememberPursuit`) and at load for every scope (`navigation/initial-farming.ts`) |
| `rareRetryEvidence` (monster instance id) | 0 to 5 | none: `rare-retry-evidence.ts` deletes an entry only when new evidence makes it eligible | the newest 100 by `sight.seenAt`, on each rejection and when the store loads a scope's evidence |

Dropping a rare entry changes behavior only for an instance not touched
since the 100 newest: its next pursuit starts with a fresh 300 s budget, and
the coordinator can pursue a rejected instance once more.

A cap, the account or the game data bounds every other saved collection:

| Collection | Bound | Where |
|---|---|---|
| `history.combatLogs` | 500 per character | `telemetry/combat-log.ts`, `historySnapshot` (`persistence/snapshots.ts`) |
| `history.merchantActivity`, `anniversary.activity` | 500 | `telemetry/activity.ts` |
| `production.attempts` | 2048, plus receipt pruning | `pruneProductionReceipts` (`inventory/production.ts`) |
| `dailyDungeons.operations` | 200 | `dungeons/service.ts` |
| `huntEventTrips` | 32 per character | `events/hunt-trip.ts` |
| `standListingCache` (in memory) | 500 | `merchant/completion-results.ts` |
| market cache (`aldata*`) | replaced on each refresh | `commerce/aldata-service.ts` |
| `npcSaleMarks`, `deconstructionMarks`, `standListings` | filtered on completion | `http/automatic-sales.ts`, `inventory/automatic-action.ts`, `merchant/deconstruction.ts` |
| `standPriceHistory`, `autoNpcSales`, `autoExchanges`, `autoCompounds`, `autoDeconstruction` | one entry per item id or rule | game item list |
| roster, selections, `characterLocations`, `navigationIntents`, `returnProgress`, `restockPolicies`, `goldTargets`, `eventAttendance`, `eventSessions`, `combatDeathSeen`, `convoyCompletionReceipts`, `luckySlotTracking` | one entry per account character, and per event name where keyed so | account roster, `G` events |
| `merchantRoutinePriorities`, `merchantAutomations`, `huntFailures`, `huntBlacklist`, `passiveHunting.rules` | one entry per routine or monster type | code and game monster list |
| rare `sightings` / `cooldowns` / `kills` (in memory) | 30 s / 3 s / 120 s | `navigation/rare-hunting.ts` |
| rare diagnostics (in memory) | cleared above 100 | `navigation/rare-hunting.ts` |
| Ponty `dismissed` (in memory) | 120 s | `commerce/ponty.ts` |
| Bankboi `completedReports` (in memory) | 32 | `http/bankboi-storage.ts` |
| grouped combat `deaths` / `evidence` / `transitionTrace` (in memory, sent in reports) | 512 / 256 and 60 s / 100 | `runtime/combat/queue.ts`, `runtime/combat/grouped.ts` |

Two remain unbounded, and this change leaves them as they are:

- `anniversary.rounds`, `.attempts`, `.advertisedRounds` and `.abortedRounds`
  gain one entry per anniversary round (288 in the 2026 event, 41 KB in all).
  `anniversaryHandoffs` and `alreadyHandedOff` (`anniversary/handoffs.ts`)
  read `rounds` across every round to find unhanded slices, so trimming it
  changes handoff behavior. They grow only while the event runs.
- Grouped combat `lostTargets` (`runtime/combat/queue.ts:34`) keeps every lost
  target since the last grouped combat reset, with no count cap. It is in
  memory and in each status report, not in the journal. It needs a combat
  E2E before a cap, so it is out of scope for persistence.

Fields that exist only on the user's fork (`achievementHunt`,
`achievementBlacklist`, `achievementTarget`, `achievementPassive`, `bossChase`,
`realmHopBlacklist`, `gearSets`) are not in v1.4.0, and this review leaves
them out.

Failure inventory:

1. An expired farm-area hit, quiet area or activity survives a restart.
2. Load drops a live farm-area entry.
3. The prune drops a luck cast still in effect, or an expired one changes
   `mluckRemaining`.
4. The cap drops the newest rare progress or rejection, or removes more than
   the oldest entries.
5. The in-memory retry evidence keeps a rejection the saved dictionary dropped.
6. An absent collection becomes an empty one at load.

Tests: `scripts/tests/coordinator-retention.test.cjs` (1-6) and
`e2e/console-persistence.spec.ts` (3, 4 and 6 through a saved journal and the
real coordinator load).

### Crash recovery (P6)

A crash or power loss in the middle of an append leaves a half-written last
line. v1.4.0 replay (`record` in `jsonl-store.ts`) passed every line to
`JSON.parse` without a guard, so the coordinator could not start until someone
edited the journal by hand.

Each record goes to disk in one `writeFileSync` call of the whole line,
newline included. The operating system may still split a large write, and
power loss can leave a partial or zero-filled tail, so replay handles the last
line on its own:

- A last line that does not parse is a torn write. Replay copies its raw bytes
  to `<journal>.torn-<time>`, truncates the journal to the last complete
  line, logs a warning that names the key when the line starts with one, and
  starts. The dropped record is the one write that was in flight.
- A last line that parses but has no newline (a v1.4.0 journal can end this
  way) gets its newline before the next append, so two records never share a
  line.
- A line that does not parse with records after it is corruption, not a torn
  write. The store refuses to open and names the line, the byte offset and how
  to recover, and it leaves the journal untouched.

Shutdown stays bounded: `close()` compacts only when the live set is at most
`CLOSE_COMPACT_MAX_BYTES` (64 MB), and leaves a larger journal for the next
start. Measured times are in Measurements below.

Failure inventory:

1. A torn last line, with or without a newline, stops the coordinator from
   starting.
2. Recovery drops more than the torn line, or keeps no copy of its bytes.
3. A record appended after recovery joins the torn bytes or a last line that
   had no newline.
4. Replay drops a corrupt line in the middle silently, or the error does not
   say where it is.
5. A crash mid-append, mid-compaction (before the rename, after it) or
   mid-shutdown loses a record the store saved before the crash, or more
   history or settings than the documented windows.
6. The writer lock left by a killed process blocks the next start.
7. Reopening after a crash hangs.
8. Shutdown takes longer than the 30 s stop grace on a large journal.

Tests: `scripts/tests/coordinator-jsonl-store.test.cjs` (1-4, 8) and
`scripts/tests/coordinator-crash-recovery.test.cjs` (5-7), which SIGKILLs a
writer process at random points and at each compaction and shutdown step, 50
times, then reopens the journal in a fresh process with a time limit.

### Measurements

All numbers come from `tools/benchmark-persistence.mts` (600 simulated
seconds, real CPU time) and `e2e/console-persistence.spec.ts`, run in the same
Linux container (Node 24, shared with other jobs, load average 8-10). The
benchmark replays the live rates: 4 status reports/s with one native roster
save, 3.3 combat lines/s, merchant activity 0.25/s while farming, and 2 lines
plus 2 production phase changes/s during production, against documents of
live size.

Disk writes in MB/s, appends plus compaction rewrites, each commit added to
the one before:

| Build | Farming | Production |
|---|---:|---:|
| v1.4.0 | 5.27 (4.83 + 0.44) | 7.02 (6.58 + 0.44) |
| + history saves (P2) | 1.70 (1.48 + 0.22) | 1.70 (1.48 + 0.22) |
| + saves by content (P1) | 1.68 (1.47 + 0.22) | 1.69 (1.47 + 0.22) |
| + settings split (P3) | 0.43 (0.21 + 0.22) | 0.82 (0.60 + 0.22) |
| + compaction on growth (P4) | 0.25 (0.21 + 0.03) | 0.72 (0.60 + 0.12) |

P1 saves about 10 KB/s (roster and selections); its larger effect is CPU. P5
changes no write rate. What remains while farming is the history document,
1.08 MB every 5 s.

Speed, v1.4.0 against this branch, median / p95 in ms over three benchmark
runs (run-to-run spread in brackets):

| Path | v1.4.0 | This branch |
|---|---:|---:|
| Persistence work per status report | 0.011-0.016 / 0.07 | 0.001 / 0.016 |
| Roster save (native status report) | 0.06 / 0.10 | 0.011 / 0.02 |
| History save per combat-log POST | 5.4-5.6 / 11-13 | 0.000 / 0.004 |
| Timed save (1 s settings timer, 5 s history timer) | 9.2-10.0 / 17-21 | 1.6-1.7 / 4.2-4.9 |
| Direct settings save with a change | 9.7-10.5 / 19-22 | 2.7-3.0 / 3.9-6.1 |
| Bank save, changed (4.3 MB) | 20.6-22.2 / 31-41 | 15.7-16.0 / 24-31 |
| Bank save, unchanged | 21.2-22.5 / 38-97 | 8.7-9.4 / 12-14 |
| Compaction pause (event loop blocked) | 62-71 / 83-96, 22 per 300 s | 36-44 / 42-59, 6 per 300 s |
| Shutdown (flush and close) | 0.3 | 52-62 |

Shutdown is the one slower path: it now writes settings in the v1.4.0 layout
for rollback and compacts the journal, so the next start replays a compact
file. It runs once per stop, inside the 30 s `stop_grace_period`.

Dashboard latency through the real coordinator and dashboard
(`e2e/console-persistence.spec.ts`, 20 samples each):

| Measure | v1.4.0 | This branch |
|---|---:|---:|
| Status report to DOM, median / p95 | 32 / 66 ms | 22 / 33 ms |
| Status POST response, median / p95 | 6.3 / 15.8 ms | 3.7 / 8.2 ms |
| Combat line to DOM, median | 994 ms | 982 ms |
| History records appended for 20 lines in 20 s | 22 | 3 |

The combat line latency is the dashboard's 1 s `logs` poll; both builds show
one 1.5 s sample when a line lands shortly after a poll.

Crash recovery (`scripts/tests/coordinator-crash-recovery.test.cjs`, 50
SIGKILLs, run with `CRASH_ROOT` against v1.4.0 for comparison):

| Case | Runs | v1.4.0 | This branch |
|---|---:|---|---|
| Random moment while saving | 14 | opens | opens |
| Random moment past the 5 s history window | 6 | opens | opens |
| Compaction, before the rename | 8 | opens | opens |
| Compaction, after the rename | 8 | opens | opens |
| Shutdown, during flush and close | 8 | opens | opens |
| Torn last line, file cut inside it | 6 | fails to start: `SyntaxError: Unterminated string in JSON` | opens, drops the torn record, keeps a copy |

Every run left the killed writer's lock behind except after a finished
shutdown; every reopen took the stale lock, held every acknowledged direct
save, every history line older than 5 s and every setting older than 1 s,
and finished well inside the 15 s limit.

Journal open and `close()` at the 128 MB inline bound (one key rewritten
until one more record would pass 128 MB, a stale lock left behind):

| Live set | v1.4.0 open / close | This branch open / close |
|---:|---|---|
| 8 MB | 626 / 0 ms | 563 / 33 ms (compacts to 9 MB) |
| 60 MB | 749 / 0 ms | 807 / 180 ms (compacts to 61 MB) |
| 70 MB | 833 / 0 ms | 831 / 0 ms (above `CLOSE_COMPACT_MAX_BYTES`, left for the next start) |

### Metrics history and other saved state added in 1.5

1.5 adds three saved sources outside the coordinator documents above. The
1.5 impact review listed them before this change; each item below names the
failure it removes.

- **Metrics journal (`<LOCALSTORAGE_PATH>.metrics.jsonl`,
  `runtime/coordinator/metrics/jsonl-store.ts`).** #87's store is a copy of
  the v1.4.0 coordinator journal with asynchronous writes, so it kept two of
  the problems P4 and P6 fixed.
  1. A torn last line made replay throw, `application.ts` installed the 503
     stub and the Metrics workspace stayed down until someone edited the file.
     Replay now drops a torn last line and keeps its bytes in a
     `.torn-<time>` copy, as P6 does. An unreadable line followed by records
     still fails and names the line.
  2. `compactIfNeeded` compacted whenever the journal reached 128 MB. A
     compaction leaves the live set, so once the live set passed 128 MB
     (about 30 days of history at four characters) every bucket write
     compacted again. The store now tracks the live record sizes and compacts
     on growth, P4's rule: superseded bytes above 32 MB and 3x the live set,
     or above 128 MB. The 30 min timer and startup compact only when that
     holds or the journal holds superseded records.
  `scripts/tests/metrics-journal.test.cjs` holds the failure inventory and a
  test for each case.
- **Bucket rewrites (`runtime/coordinator/metrics/service.ts`).** Every
  accepted frame rewrote its whole 10 s bucket: every character's row, every
  receipt and every event id. Accepted frames now update the bucket in memory
  and mark it dirty; one shared commit, `METRICS_COMMIT_MS` (750 ms) after
  the first accepted frame, writes each dirty bucket once and flushes. A POST
  answers once memory holds its frames, and queries read the in-memory bucket
  at once. A first version answered each POST after the flush; the characters
  in one browser share its connections to the coordinator, and the held POSTs
  delayed status and combat requests until `live-hunt-sparkbot-follow.spec.ts`
  lost its target selection in 3-4 of 12 runs. Each answer names the commit
  that will write its frames (`commit`), the last commit on disk
  (`durableCommit`) and the coordinator process (`commitEpoch`). The
  collector (`runtime/characters/metrics.ts`) keeps a frame in its outbox
  until an answer from the process that accepted it shows that commit on
  disk; while frames wait, it sends an empty batch that reads `durableCommit`.
  An answer from another process means a restart may have lost the waiting
  frames, so the collector sends them again, and the receipt check counts a
  frame the new process already holds once. A collector built before this
  change drops a frame on the answer. `e2e/console-persistence.spec.ts`
  checks that a POST answers in under 500 ms, that each frame is in the
  journal within one commit, that frames share bucket writes, that a restart
  returns every frame, and, with the real collector, that SIGKILL inside the
  commit window after an answer loses no frame and counts none twice.
- **Offline character snapshots (`status/character-appearance.ts`, 1.5's
  b5be1022).** `rememberCharacterSnapshot` refreshes each character's
  inspection snapshot at least every 30 s, and each refresh rewrote the
  roster key, which holds every character's items and slots. P1 never skips
  it: `updatedAt` and `seenAt` change every time. The 30 s refresh still
  updates memory, so the config section and the inspection dialog read the
  same values as before. The coordinator saves a character's snapshot to the
  roster when the physical inventory changes, or when that character's last
  saved snapshot is `SNAPSHOT_SAVE_MS` (5 min) old. `nativeOwnership` saves
  the roster on every native status report, so the roster carries each
  character's snapshot from its last due save (`rosterSnapshots`). After a
  restart a saved snapshot can be up to 5 min behind on vitals and stats;
  items and slots are never behind. `e2e/console-persistence.spec.ts` shows a
  36 s window with every character's refresh and no roster record. With
  C, the snapshot keeps per-copy item meta, and the dashboard joins the
  catalog meta onto it (`account-settings.tsx`, `party-item-details.tsx`).
- **Metrics outbox in caracAL storage (P11, `runtime/characters/metrics.ts`,
  `runtime/coordinator/characters/storage.ts`).** #87's collector writes a
  frame (`party-metrics-v1:<name>:frame:<slot>`) and its header
  (`party-metrics-v1:<name>`) to localStorage every second. In a headless
  worker that is caracAL's IPC store: the coordinator appends each write to
  its journal and sends it to every worker, and every worker receives all
  keys again when it starts. The collector never removed a confirmed frame's
  ring key, so each character kept up to 1,024 keys, and the game CODE
  runner's `local_cm_logic` walks every localStorage key every 16 ms in every
  worker (CT11, Character threads, follow-ups). Now `synchronizeStorage`
  keeps outbox keys in the journal as before but sends them only to the
  owner's worker, at init and never in a broadcast; every other key, and
  session storage, broadcast as before. `persist()` removes a frame's ring
  key after it writes the header that drops the frame, and install removes
  the ring keys the restored header does not list, so the store holds only
  unconfirmed frames. The keys keep their 1.5 names and layout, so a rollback
  to 1.5 reads the same outbox, and a frame stays saved until the coordinator
  confirms it, so a CODE reload, a worker restart or a coordinator restart
  resends it as before.
  Failure inventory:
  1. A frame the coordinator has not confirmed is gone after a CODE reload,
     a worker restart or a coordinator restart, or changes content.
  2. A frame that the coordinator confirmed keeps its ring key.
  3. Another character's worker receives an outbox write or removal, or the
     outbox keys at init.
  4. A worker's init lacks its own outbox keys.
  5. Ordinary localStorage keys or session storage stop broadcasting.
  6. The cleanup removes the slot of a queued frame or a key that is not the
     collector's.
  7. Ring keys of confirmed 1.5 frames stay in the store.
  `e2e/metrics-history.case.ts` covers 1, 2, 6 and 7 in a real browser store
  and fails on the previous tree (40 stale keys);
  `scripts/tests/coordinator-workers.test.cjs` covers 3-5. Measurements:
  Combined build profile, below.
- **Mail read marks (`commerce/mailbox.ts`, 1.5's 9454392e).** `seen()`
  added every listed mail id to `seenIds` and never removed one. It now keeps
  the newest `SEEN_IDS_KEPT` (2000). The sent-mail history (`outbox`) is user
  data and stays uncapped. `e2e/console-persistence.spec.ts` opens the mail
  with 2100 saved marks and checks the saved 2000 and every listed mail.

Not changed, with the reason:

- Content-skip (P1) for the metrics journal. Every bucket write carries a new
  receipt and the worker header changes every second, so equal content never
  repeats there.
- Receipts and event ids in 10 s buckets. They guard against counting a frame
  twice when a restarted character resends its saved outbox, and that outbox
  has no age bound. The 1 min rollup after a day already drops them.
- Keying bucket rows per character, the review's larger option for the bucket
  rewrites. It changes the stored schema, the rollups and the queries.

`tools/benchmark-metrics-journal.mts` runs the real metrics service with
four characters sending a frame per second each, at their own phases, and
reports journal bytes, the live set and the POST acknowledgement times.

### Measurements on 1.5

`tools/benchmark-persistence.mts` with `--root` on the 1.5 tip and on this
branch, three runs each, 600 simulated seconds. 1.5 does not change the
coordinator writer, so its rates equal v1.4.0's; the benchmark does not
include the metrics journal, which has its own benchmark below.

| Path | 1.5 | This branch |
|---|---:|---:|
| Writes, farming (appends + compaction) | 5.27 MB/s (4.83 + 0.44) | 0.25 MB/s (0.21 + 0.03) |
| Writes, production | 7.02 MB/s (6.58 + 0.44) | 0.72 MB/s (0.60 + 0.12) |
| Persistence work per status report, median / p95 | 0.004-0.005 / 0.05 ms | 0.001 / 0.011-0.013 ms |
| Roster save (native status report), median | 0.038-0.043 ms | 0.007-0.009 ms |
| History save per combat-log POST, median / p95 | 3.95-4.28 / 6.1-10.4 ms | 0.000 / 0.001-0.002 ms |
| Timed save, median / p95 | 6.9-7.5 / 11.2-14.3 ms | 1.1-1.9 / 3.1-3.6 ms |
| Direct settings save with a change, median | 6.9-8.5 ms | 1.9-2.4 ms |
| Bank save, changed, median | 15.6-16.8 ms | 10.2-15.1 ms |
| Bank save, unchanged, median | 15.6-18.2 ms | 6.3-9.0 ms |
| Compaction pauses in 600 s (farming / production), median length | 40 / 40, 45-57 ms | 3 / 11, 23-33 ms |
| Shutdown (flush and close) | 0.2-0.3 ms | 34-59 ms |

Metrics journal, `tools/benchmark-metrics-journal.mts`, two 120 s runs each
with four characters:

| Measure | 1.5 | This branch |
|---|---:|---:|
| Bytes appended | 14.9-15.0 KB/s | 4.2-4.3 KB/s |
| Appends | 4.09/s | 1.21/s |
| Projected per day | 1,258-1,264 MB | 352-363 MB |
| Live set after 120 s | 64.1-64.2 KB | 64.2 KB |
| POST acknowledgement, median / p95 / max | 0.3 / 0.5-2.0 / 8-14 ms | 213-228 / 751-752 / 758-779 ms |

The acknowledgement row measures the first version, which answered each POST
after the shared write. A POST now answers before the commit; the commit
itself is the same, and the benchmark has not been rerun since.

## Field whitelist

`section=fast` sent every stored status field except a seven-entry omit list.
`runtime/coordinator/telemetry/character-fields.ts` lists every field a
status can carry and holds coded whitelists for the per-character sections;
with `PARTY_STATE_FIELDS=enforce`, `section=fast` sends the 60 fields some
client reads. The default, `shadow`, keeps 1.5's output so a console can audit
reads first. The failure inventory, tiers, rollout, readers inventory, the
fields added on 1.5 and the speed measurements are in
[state-field-registry.md](state-field-registry.md).

### Measurements on 1.5

`e2e/field-registry-speed.spec.ts` (project `speed`) on the 1.5 tip and on
this branch in both modes, three rounds each in the order 1.5, shadow,
enforce, on the shared runner while other jobs ran. Each cell is the median
of the three per-round medians; the range is the per-round medians, in ms:

| Journey | 1.5 | shadow | enforce |
|---|---|---|---|
| First render to the merchant's inventory (5 loads) | 510 (488-943) | 805 (686-862) | 662 (569-1179) |
| Item details dialog open (10) | 410 (324-462) | 466 (409-477) | 365 (330-660) |
| Gear comparison dialog open (10) | 461 (388-594) | 487 (441-509) | 398 (324-695) |
| Bank dialog open (10) | 251 (214-270) | 293 (217-294) | 216 (163-418) |
| `section=fast` response (50), bytes | 0.9, 2,454 | 0.9, 2,454 | 0.8, 1,699 |
| `section=core&dashboard=1` response (50) | 1.0 | 0.9 | 1.1 |
| `section=inventory` response (50) | 0.9 | 0.7 | 0.7 |
| Full request response (20) | 9.0 | 11.4 | 7.2 |

Every per-round range overlaps the others, and the 1.5 rounds alone span
488-943 ms for the first render, so these runs show no difference beyond the
runner's noise in either direction. The fixture's `fast` entry is small, so its
bytes barely change; on a live four-character state enforce cuts it from
628 KB to 37 KB (state-field-registry.md, Speed).

Quiet rerun, with no other job on the runner: four rounds on the 1.5 tip
`1e12540e`, then the branch tip without docs (`31c480b5`), shadow and enforce
alternating (three shadow and two enforce rounds saved their results). Medians
of the per-round medians, with the range, in ms:

| Journey | 1.5 `1e12540e` | shadow | enforce |
|---|---|---|---|
| Dashboard reload to the merchant's inventory (5 reloads per round) | 400 (332-405) | 374 (359-386) | 386 (365-406) |
| Item details dialog open (10) | 276 (268-288) | 277 (260-290) | 283 (263-302) |
| Gear comparison dialog open (10) | 296 (283-303) | 286 (283-287) | 295 (285-304) |
| Bank dialog open (10) | 132 (128-142) | 142 (127-145) | 143 (142-144) |
| `section=fast` response (50), bytes | 0.6, 2,454 | 0.6, 2,454 | 0.7, 1,699 |
| `section=core&dashboard=1` response (50) | 0.7 | 0.7 | 0.8 |
| `section=inventory` response (50) | 0.5 | 0.5 | 0.7 |
| Full request response (20) | 4.8 | 4.6 | 5.2 |

The spec's first-render journey times reloads after one untimed first load,
so the quiet rerun answers the reload question: reloads are not slower in
either mode, and the earlier 805 ms shadow median was runner noise. Dialog
opens stay inside each other's ranges. The update-latency journeys still
miss 10 of 20 samples on every tree, 1.5 included, so they measure nothing;
the inventory-change-to-state latency in the combined build profile (405-564
ms against 471-641 ms on 1.5, p50) covers the report path up to the API.

## Report payload: per-copy item meta in status reports

Status reports carry only the per-copy part of each item's meta. The per-type
part comes from `merchantCatalog.allItems`, and readers join the two by item
id. On the live stack the merchant's report falls from 5.1 MB to about 0.13 MB,
each fighter's from 0.5-0.8 MB to about 0.16 MB, and the stored bank snapshot
from 4.6 MB to about 19 KB. Dashboard and API speed show no regression beyond
run-to-run noise.

### Before

`itemDefinition` in `characters/shared.js` built the full meta for every
inventory item, equipment slot, bank slot and nearby stand listing in every
report: `definition`, `upgradeable`, `compoundable`, `buyable`, `scaling`,
`maxLevel`, `usage`, `sprite`, `properties` and `world` (drop graph, suggested
prices, recipe with material drops, set and used-in lists). Only `properties`
depends on the copy (level, `stat_type`, title). `merchantCatalog.allItems`
already held the same per-type meta for all 623 items.

Live size-only read (`GET /party-api/state` inside the live container, byte
counts only):

| Report | Status | `meta` | `meta.world` | Per-copy meta |
|---|---:|---:|---:|---:|
| Merchant (59 stand listings) | 5,055,127 | 4,929,054 | 4,853,910 | 5,598 |
| Priest | 769,323 | 612,049 | 583,728 | 1,727 |
| Warrior | 526,741 | 368,310 | 345,028 | 1,545 |
| Mage | 628,578 | 469,839 | 448,369 | 1,151 |
| Bank snapshot | 4,577,678 | 4,566,109 | 4,409,529 | 7,320 |

### Change

- **Character script.** Once a status response clears `needsCatalog`,
  `itemDefinition` returns `{ properties }`, plus `sprite` for a copy whose
  `skin` differs from its definition. Before that point it returns full meta,
  so a fresh coordinator, a coordinator after a game update and a coordinator
  that rejected the catalog keep every field they had.
- **Coordinator join.** `runtime/coordinator/inventory/catalog-meta.ts`
  `entryMeta(catalog, entry)` returns catalog meta with the report's fields on
  top. It indexes `allItems` once per catalog object (O(1) per item) and caches
  each join per report meta object. Readers: `merchant-item-commands.ts`
  (merchant weapon), `stat-scroll-commands.ts`, `transfer-commands.ts`
  (manual weapon, bank upgrades), `mark-reconciliation.ts` (auto upgrade
  marks), `compound-commands.ts` (bank compound selection),
  `scripts/bank-stack-routing.cjs` (stack homes and storage worker
  unloads) and `scripts/merchant-inventory-stacks.cjs` (stack merges).
- **Public projections keep their shapes.** `compactEntry` joins before it
  selects its field list, so the `inventory` section and the dashboard stream
  send the same fields as before. The `bank` section sends those compact
  fields too, without `world` and `usage`. The unsectioned debug state joins
  full meta (`telemetry/item-meta-projection.ts`). The stream joins a record
  published before the catalog arrived again on its next telemetry sample.
  After a coordinator restart the first reports carry per-copy meta before
  the catalog arrives, and `compactEntry` sends `meta: null` for them until
  it can join. A first version sent the per-copy meta, and the dashboard
  crashed in `inventory-panel.tsx` reading `meta.definition.type`
  (`live-bank-staging.spec.ts`, after its settings restart).
- **Dashboard.** `features/party/item-catalog-meta.ts` joins catalog meta onto
  inventory, equipment and bank entries in `usePanelModel`, so every panel
  reads `entry.meta.world`, `usage` and the rest from the entry. The module
  caches joins per entry and per catalog object, so React Query structural
  sharing keeps unchanged tiles. `detailMeta` uses the same index in place of a
  linear `allItems.find` per call.

### Reader inventory

A type-aware scan (TypeScript checker: every property read whose receiver has
type `ItemMeta` in the dashboard or `ItemMetaRecord` in the coordinator) found
188 dashboard reads in 32 files and 5 coordinator reads. A runtime check ran
the full console E2E suite with a test-mode Proxy over every report meta
object in the coordinator and the browser. It recorded each field read and
each read of a per-type field the report no longer carried while the catalog
had it. It found two readers the scan cannot type: `definition.s` in
`scripts/bank-stack-routing.cjs` and `scripts/merchant-inventory-stacks.cjs`.
Both now read through `entryMeta`. After that fix the run records no such
reads in either process.

### Compatibility

- The mobile apps (PWA and Android) read `definition`, `upgradeable`,
  `compoundable`, `buyable`, `scaling`, `maxLevel`, `sprite` and `properties`
  from `inventory`, `bank` and stream entries; those fields keep their shape.
  They read `world` and `usage` through their `detailMeta` catalog join or
  straight from the catalog, which is unchanged.
- The metrics service reads only `item.name`, `item.q`, `item.level` and
  `bank.gold`.
- Reports from clients that still send full meta join with the report's
  values on top.

### Speed

Coordinator and character numbers come from `bench.cjs` on the E2E runner: a
real coordinator receives reports built by each tree's own `shared.js` meta
builders from installed game data 17175 (merchant: 42 items, 15 slots, 88
stand listings; bank: 8 packs of 42). Each cell is the median of three runs,
with 25 requests per section run, or 300 for `inventory` and `bank`.
Dashboard numbers come from a Playwright probe against the console fixture on
the vinext dev server, 11 runs on v1.4.0 and 10 on this branch, alternating;
each cell is the median of the per-run medians.

| Measure | v1.4.0 | This change |
|---|---:|---:|
| Character: build the item part of a merchant status | 43.1 ms | 1.3 ms |
| Merchant report bytes | 1,734,916 | 29,721 |
| Coordinator: POST merchant report | 24.1 ms | 5.3 ms |
| Fighter report bytes | 554,088 | 8,683 |
| Coordinator: POST fighter report | 8.3 ms | 2.6 ms |
| Coordinator: POST merchant report with bank | 80.2 ms | 5.7 ms |
| `section=fast` bytes / time | 2,457 / 0.7 ms | 2,457 / 0.7 ms |
| `section=inventory` bytes / time | 101,311 / 1.3 ms | 101,311 / 1.1 ms |
| `section=bank` bytes / time | 3,431,872 / 25.8 ms | 197,703 / 1.8 ms |
| `section=catalog` bytes / time | 6,108,982 / 46.7 ms | 6,108,982 / 50.9 ms |
| Dashboard: first meaningful render | 1,809 ms | 1,753 ms |
| Dashboard: open item details | 225 ms | 212 ms |
| Dashboard: open bank | 194 ms | 185 ms |
| Dashboard: open stand | 214 ms | 224 ms |
| Dashboard: open gear comparison | 509 ms | 472 ms |
| Dashboard: status change to DOM | 58 ms | 51 ms |

The `catalog` section time moves by less than its run-to-run spread
(46-58 ms on v1.4.0, 41-63 ms here). The `inventory` section runs 1.1-1.3 ms
on both trees; an in-process loop over the same projection with wire-parsed
objects measures 255-286 us per call including `JSON.stringify` on v1.4.0 and
229-271 us here. The dashboard probe's per-run medians overlap for every
measure: first render 1,660-2,650 ms against 1,636-2,552 ms, bank
134-274 ms against 139-426 ms.

### Measurements on 1.5

The same `bench.cjs` on the 1.5 tip and on this branch (installed game data
17175), three runs each; the first run of each tree warms the runner, so the
ranges below are all three runs. On 1.5 the reports also carry #135's
`bonuses` and `title`.

| Measure | 1.5 | This branch |
|---|---:|---:|
| Character: build the item part of a merchant status | 35.6-48.7 ms | 0.9-1.3 ms |
| Merchant report bytes, coordinator POST | 1,791,821; 19.8-27.8 ms | 29,721; 4.8-6.8 ms |
| Fighter report bytes, coordinator POST | 571,133; 8.7-11.3 ms | 8,683; 2.5-3.4 ms |
| Merchant report with bank, coordinator POST | 5,294,086; 63.9-95.9 ms | 73,982; 4.8-7.2 ms |
| `section=fast` bytes / time | 2,457 / 0.59-0.84 ms | 2,457 / 0.56-0.62 ms |
| `section=inventory` bytes / time | 103,534 / 1.1-1.6 ms | 102,052 / 1.1-1.6 ms |
| `section=bank` bytes / time | 3,507,304 / 19.7-30.9 ms | 197,703 / 1.7-2.0 ms |
| `section=catalog` bytes / time | 6,260,820 / 33.8-59.6 ms | 6,260,820 / 35.9-54.4 ms |

The inventory section is 1,482 bytes smaller because a copy without a title
no longer carries `"title":null`; `item-title.ts` treats a missing and a null
title the same.

### Tests

- `scripts/tests/inventory-loading.test.cjs`: full meta before the
  acknowledgement, per-copy meta after it, a per-copy skin sprite.
- `scripts/tests/coordinator-public-state.test.cjs`: the inventory, bank and
  debug projections join catalog meta and keep per-copy fields.
- `scripts/tests/bank-stack-routing.test.cjs`,
  `scripts/tests/merchant-inventory-stacks.test.cjs`: stack limits from the
  catalog.
- `e2e/game-fixture.cjs` sends per-copy meta after its first report, so every
  console E2E case reads joined meta.
- `e2e/console-reports.spec.ts`: a saved snapshot with per-copy meta shows the
  catalog's item name in the offline inspection after a restart (C3p).

### Follow-ups for the game-card additions

The same rule applies to the card fields from PR #135. `bonuses`
(`itemBonuses(definition)`) is per-type, so it belongs in the catalog's
`allItems[].meta` only and leaves the per-copy branch of `itemDefinition`.
`title` is per-type data keyed by the copy's title id: the report already
carries that id as `item.p`, the title definitions (`G.titles`) belong in the
catalog once, and readers join `titles[item.p]` the way they join `allItems`.

## Inventory deltas

Every status report carried the character's items, slots and, at the bank,
every bank pack, although most reports repeat the previous one. With per-copy
meta (above) that is still most of a report.

- `characters/shared.js`: `statusInventory` keys the three builders on
  `character.items`, `character.slots`, `character.bank` and the active
  upgrade, and rebuilds them under a new revision only when one changes.
  `attachStatusInventory` leaves them out while the coordinator acknowledged
  that revision and a full report went out in the last 10 s. (A first
  version used 30 s; `live-catalog.spec.ts` observes three ordinary reports
  with items within 45 s of the catalog acceptance.) A pickup, an
  equip or a bank deposit changes the key, so the next report carries it.
  Reports before the catalog acknowledgement are always full. A coordinator
  built before this change never acknowledges, so it keeps receiving every
  report in full. On a 409 `inventory-required` refusal, `request()` sends the
  same report with the inventory and resolves with that reply.
- `status/inventory-carry.ts`: per character, the items, slots and bank of
  the last full report and the revision it named. A report naming that
  revision without the fields gets them back on the raw body before any
  consumer runs, so merchant scheduling, bank observation, delivery recovery
  and the stored status all see a full report. An unknown revision (restart,
  another runtime) answers 409 before any consumer runs.
- `status/bank.ts`: while a report carries the bank object the last
  comparison produced, the snapshot is still that one and the same character
  observes it, `consumeBankReport` skips the two `JSON.stringify` comparisons.

Failure inventories are in the three commits and
`scripts/tests/inventory-delta.test.cjs`; `e2e/coordinator.cjs` sends its
fixture reports the same way, so every console E2E case runs on carried
inventory. `e2e/console-reports.spec.ts` shows the carry through the real
coordinator and dashboard: reports without inventory keep it on the merchant
card, an unknown revision answers 409, the resend replaces the carried
inventory, and the stored bank stays the same until the bank changes.

Measured in the combined build profile (below) on the disposable game stack,
farming goos for 150 s with real loot, so every pickup changes the inventory.
Bytes are the request bodies each headless character sent to
`/party-api/status`, split by report kind:

| Per character, farming | 1.5 (`1e12540e`) | This branch |
|---|---:|---:|
| Fighter status report (1/s) | 611-649 KB each, 607-645 KB/s | 204-206 KB each, 204-206 KB/s |
| Fighter reports that carry items | 0.99/s (every report) | 0.04-0.05/s (30 s refresh; at least 0.1/s with the 10 s refresh, not remeasured) |
| Merchant status report (1/s) | 453 KB each, 450 KB/s | 69 KB each, 69 KB/s |
| Merchant reports that carry items | 0.99/s | 0.03/s |
| Fighter combat reports | 22-23/s, 10-15 KB each, 227-336 KB/s | 24/s, 10.5-10.7 KB each, 252-258 KB/s |
| All status POSTs, per fighter | 834-981 KB/s | 458-466 KB/s |
| Inventory change to `/party-api/state`, p50 / p90 (4 runs, n = 20 each) | 471-641 / 926-1,079 ms | 405-564 / 697-1,013 ms |

The report payload change (C) and this change share the drop; the fighter's
remaining 205 KB report is mostly two diagnostic fields, `combatTrace`
(up to 102 KB) and `combat` (up to 77 KB), in every 1 s report. They are on
1.5 too and are not part of this branch (Combined build profile, Left for a
follow-up).

## Requests and logs

The health check, the dashboard's big sections, the container log and two
browser polls did work nobody used. The health check now asks a 14-byte
readiness route instead of building the 14.6 MB state. The bank, logs and
market sections answer 304 with no body while their content is unchanged, and
any client that does not ask for that gets the full body as before. An unknown
section answers 400 instead of the full payload. Each party kill and find by
a caracAL character prints once in the container log, from that character's
thread, and the account poll logs only when its counts change. The Steam client stops
fetching a missing activation record every 2 s, and two display-only dashboard
timers pause in a hidden tab and read at once when it returns. Section times,
dashboard latency, first render and log capture show no regression beyond
run-to-run noise.

Measurements ran in `ah-e2e-runner` against the real coordinator with the
console fixture (`e2e/coordinator.cjs`, fixture heartbeats on). The "live-size"
bank is 8 packs of 42 items with a 9 KB `world` block per item (3.17 MB), close
to the 4.4 MB live bank; logs are 1,000 lines for each of three characters
(349 KB). The client measures each time, body included. Another test stack
shared the runner, so the runs alternate (v1.4.0, branch, v1.4.0, branch), and
each value below is one run's median / p95.

### Health check (C1)

**Before.** The gateway's `/health` (`tools/hosting/gateway.ts`) calls
`servicesHealthy` (`tools/hosting/health.ts`), which fetched
`/party-api/state?catalog=0` and cancelled the body. The coordinator built the
whole payload anyway: 14.6 MB and 194 ms per call measured live, every 30 s
from the production `HEALTHCHECK`.

**Failure modes** (`scripts/tests/native-host-health.test.cjs`):

1. the check builds the full state to answer "is the coordinator up";
2. it reports healthy while the coordinator is down or answering errors;
3. it reports unhealthy against an older coordinator without the readiness route;
4. it skips the dashboard check, or asks the API before the user configures the account.

**Change.** The coordinator serves `GET /party-api/ready` (`{"ready":true}`)
next to `/party-api/state` (`runtime/coordinator/http/dashboard.ts`), so it
answers from the same moment. `servicesHealthy` asks it. A rollback can run a
coordinator older than the host; it answers 404 there, and the check falls
back to the state route.

The debug image's 3 s health check (`Dockerfile`, `debug` stage) answers from
`tools/debug/gateway.ts` with a ready flag and never reached the coordinator,
so it needed no change.

| Read | Bytes | Median / p95 (ms) |
|---|---:|---:|
| v1.4.0 `/party-api/state?catalog=0`, live-size bank | 3,187,288 | 46.0 / 88.3, 53.7 / 116.9, 51.5 / 111.1 |
| Branch `/party-api/ready` | 14 | 0.54 / 1.5, 0.63 / 2.1, 0.45 / 0.8 |
| Live v1.4.0 state read (breakdown, window A) | 14.6 MB | 194 |

### Unknown sections (C5)

**Before.** `publicState` (`runtime/coordinator/telemetry/public-state.ts`)
answered a section it did not know with the full payload: 14.3 MB measured live
for `section=mail`. A unit test pinned that fallback ("unknown sections retain
full responses").

**Failure modes** (`scripts/tests/coordinator-public-state.test.cjs`,
`e2e/console-requests.spec.ts`):

1. a mistyped or prototype section name (`constructor`, `__proto__`) answers with the full payload;
2. a request without a section stops getting the full payload;
3. a known section changes shape;
4. a client in the repository asks for a section that does not exist.

**Change.** An unknown section answers 400
`{"error":"Unknown state section","sections":[...]}`. No section, or an empty
one, still answers the full payload. The old test now checks the private-state
rule on the full payload. The console E2E records every state request the
dashboard makes while it opens the bank and market and finds only known
sections. The PWA, the APK (`PartyRepository.kt`) and the metrics service
(`collector.ts`, `follow.ts`, `server.ts`) ask only `core`, `config`, `fast`,
`inventory`, `logs`, `bank`, `market` and `catalog`.

| `section=mail` | Status | Bytes | Median / p95 (ms) |
|---|---:|---:|---:|
| v1.4.0, live-size bank | 200 | 3,187,285 | 47.2 / 83.6 |
| Branch | 400 | 114 | 0.66 / 10.8 |

### Conditional bank, logs and market sections (C3)

**Before.** The dashboard polls `bank` every 2 s, `logs` every 1 s and `market`
every 10 s (`dashboard/features/party/query-cache.tsx`, `policies`), and each
poll carried the whole body: 4.4 MB, 1.2 MB and 1.75 MB live. Express already
hashed each body for a weak ETag, but browsers add `Cache-Control: no-cache` to
any fetch that sets `If-None-Match`, and Express's freshness check then always
answers 200. The fixture measurement showed one stable ETag per section and a
200 to every conditional request.

What each section carries (`createPublicStateRoute`):

| Section | Fields |
|---|---|
| `bank` | `bank` (snapshot), `bankVaults`, `bankCurrent`, `bankQueue`, and `bankbois` with `dashboard=1` |
| `logs` | `gameLogs`, `combatLogs`, `merchantActivity` |
| `market` | `aldata`, `ponty`, `standPriceHistory` |

The bank tab (`usePanelModel`) lays the `bank`, `market` and `logs` domains over
the `core`, `config` and `catalog` domains. Marks for sale, withdrawal and
upgrade, NPC sale marks, automatic rules, stand listings, BankBoi summaries and
bank gold come from `config` and `core`. Those sections keep their polling, and
each dashboard action keeps invalidating the domains in `actionDomains`
(`query-actions.ts`).

**Failure modes** (`scripts/tests/coordinator-section-revision.test.cjs`,
`scripts/tests/dashboard-section-revision.test.cjs`,
`e2e/console-requests.spec.ts`):

1. an unchanged bank, logs or market section resends its whole body on every poll;
2. the revision stays the same although a field the section carries changed,
   so the dashboard keeps showing old bank contents, jobs, logs or prices;
3. a client that sends no revision (PWA, APK, metrics) gets anything but the full body;
4. a stale or malformed revision answers 304;
5. sections outside bank, logs and market start answering 304;
6. a 304 replaces the cached data with nothing, or the dashboard sends a
   revision for data it no longer holds (replaced by `setQueryData`, removed);
7. structural sharing loses the revision, so the dashboard never gets a 304;
8. a mark, unmark, withdrawal mark or rule change, or a bank change, shows later than in v1.4.0;
9. auth loss and server errors behave differently.

**Change.**

- **Coordinator.** `sendWithRevision`
  (`runtime/coordinator/telemetry/section-revision.ts`) serializes the section
  once, hashes it with SHA-1 (the hash Express computed for its ETag) and sets a
  strong ETag. A request whose `revision=` query or `If-None-Match` header
  matches answers 304 with no body. The revision is a hash of the whole body,
  so a change in any field in the table above answers 200; the unit test
  mutates each field and checks for a new revision.
- **Dashboard.** `readRevision` (`query-cache.tsx`) keeps each revision with
  the cached data object it arrived with (a `WeakMap`), and sends it only while
  that object is still the cached value. A 304 returns the cached object, so
  nothing re-renders. The domains' `structuralSharing` carries the revision to
  the shared object. The dashboard reads a section in full after `setQueryData`
  replaces its data or the cache removes it.
- **External clients.** A client that sends neither `revision=` nor a matching
  `If-None-Match` gets the same body as v1.4.0 (field-for-field test). The PWA
  and APK (`pm-worktrees/mobile-fork`, `origin/dev` of
  `adventureland-party-mobile`) and the metrics service
  (`party-console-metrics/src`) send neither, so they need no change. The
  gateway's `Cache-Control: no-store` keeps browsers from caching the body, as
  before.

- **Test mocks.** Console E2E tests that rewrite a fetched state body
  (`page.route('**/party-api/state*')` with `route.fetch()`) kept the real
  ETag on the rewritten body, so the next poll's revision matched the real
  body and `route.fetch()` returned a 304 with nothing to rewrite (three
  failures in the first full run). They now fetch through
  `e2e/state-route.ts`, which drops the revision. A proxy that rewrote bodies
  and passed the ETag through would hit the same problem; nothing in the
  hosting stack rewrites bodies.

The server still builds and serializes the section on every poll; a 304 saves
the transfer, the browser's parse and React Query's structural comparison.

| Section (fixture, live-size bank) | Bytes | v1.4.0 median / p95 (ms) | Branch, no revision | Branch, unchanged (304) |
|---|---:|---:|---:|---:|
| `bank` | 3,167,456 | 35.9 / 75.7, 42.8 / 106.0, 54.7 / 84.3 | 42.0 / 101.5, 48.6 / 121.5, 48.1 / 96.8 | 0 B: 16.4 / 42.0, 19.8 / 76.1, 24.1 / 61.4 |
| `logs` | 348,580 | 3.6 / 36.7, 5.2 / 31.3, 4.9 / 26.1 | 2.7 / 25.8, 3.6 / 17.8, 4.0 / 30.3 | 0 B: 1.9 / 2.6, 2.2 / 8.8, 2.4 / 19.1 |
| `market` | 390 | 0.64 / 3.7 | 0.51 / 1.0 | 0 B: 0.46 / 1.7 |

The v1.4.0 conditional reads (the same request with its ETag) answered 200 with
the full body: bank 60.6 / 103.5, 46.2 / 77.4, 50.0 / 101.4 ms.

Bank tab latency in the real dashboard (`bank tab shows marks, unmarks,
withdrawals, rules and bank changes as fast as before`), ms from the action to
the tile change, median of 3 (bank change: of 5, each landing at a different
point of the 2 s poll), two runs each:

| Action | v1.4.0 | Branch |
|---|---:|---:|
| Mark for withdrawal | 856, 903 | 923, 575 |
| Unmark withdrawal | 904, 975 | 856, 566 |
| Sell to NPC (banner "NPC sale") | 690, 671 | 743, 542 |
| Clear all marks | 1,098, 787 | 1,065, 685 |
| Auto sell to NPC rule (banner "Auto NPC", one sample) | 673, 679 | 671, 372 |
| Bank content change (new tile) | 753, 1,116 | 800, 1,192 |
| Bank polls answered 304 | 0 of 16, 0 of 15 | 9 of 15, 9 of 15 |

Bank change samples: v1.4.0 645-1,583 ms, branch 318-1,575 ms, the spread of
one 2 s poll in both.

While farming, `logs` changes almost every second (every kill adds a line), so
it answers 304 mostly between fights and when the party is idle. A cursor for
new log entries would cut it further; that changes the section's shape for
clients that opt in, so it waits for a later change.

### Duplicate game log lines (L1)

**Before.** caracAL's hook in `src/CharacterThread.js` wraps `add_log` and
prints every `game_logs` entry through pino to the container's stdout. The game
delivers each party event to every member's client, so with three headless
fighters each kill printed three times. Live, kill and gold lines were 89% of
17,397 lines/h (breakdown window A). Each character's `N gold` line is its own
share of the loot, not a copy of another character's line.

**Failure modes** (`scripts/tests/game-log-echo.test.cjs`,
`scripts/tests/coordinator-installer.test.cjs`):

1. every caracAL thread prints a party kill or find that a sibling thread also receives;
2. a thread stops printing a line about its own character;
3. two separate events with identical text lose a line, in stdout or in the console capture;
4. a kill or find by a party member outside this caracAL process (the Steam client) leaves stdout;
5. the console capture (`gameLogs`) changes in any byte;
6. a phrase lookup that no `add_log` follows silences the next unrelated line;
7. without a siblings list, or for lines without a phrase, anything stops printing.

**Change.** `installGameLogEcho` (`runtime/characters/game-log-echo.ts`)
replaces the hook. The game's `game_log` handler calls
`ui_log(phrase.message(data, true), data.color)`, so the installer wraps
`phrase.message` to read the event's own phrase arguments. A thread does not
print a `server.kill.player.*` or `server.item.named_found.*` event whose
`player` is one of its running caracAL siblings (`siblings_and_acc`) other than
itself. That sibling receives the same event and prints it; live logs show a
killer's own thread printing "Recharged killed a Tiny Crab" and a finder's
printing "Sadokunn found a Seashell". The choice comes from the event, never
from comparing message text, so two Goos killed at once by the same character
print twice. A kill by the Steam client keeps printing from every thread, as
before. Gold shares, other phrases and plain strings print as before.

Every event still reaches `add_log`, so the console's capture
(`installHostGameLogs`, `runtime/characters/game-logs.ts`) sees the same lines.
The unit test feeds one event stream through the upstream hook and through the
new one, with the capture installed on top as `runner-host.ts` does, and
compares the captured entries byte for byte. The metrics service counts kills
and finds from `gameLogs` and only from the killer's or finder's own log
(`party-console-metrics/src/parse.ts`, `kill` and `drop`), so its counts stay
the same.

**How the console carries it.** `tools/caracal/setup.mts` pins upstream
caracAL at revision `234af745` and applies
`patches/caracal-current-api.patch`. The patch is unchanged for L1:
`tools/caracal/upgrade-runner.mts` adds one guarded line in front of the
upstream hook at install time, like `installGameRendering`. An older lifecycle
bundle without the installer (a rolled-back console build) runs the upstream
hook.

Live log mix, 30 minutes read with `docker logs` (read-only) on 2026-10-19:

| Lines | 30 min |
|---|---:|
| All | 1,887 |
| `game_logs` | 1,254 (498 kills, 96 finds, 504 gold shares) |
| Kill and find lines a sibling prints instead | 396 (21% of all lines) |
| Account info pair (L2) | 598 (32%) |
| After L1 and L2 | about 893 (-53%) |

On the breakdown's busier window A (17,397 lines/h, 7,767 kill lines), L1
removes about 5,200 lines/h and L2 about 1,200, roughly 37%.

### Account info poll (L2)

**Before.** caracAL's `account_info.js` POSTs
`adventure.land/api/servers_and_characters` every 6 s and logged "updating
account info" and "found N servers and N characters" on each poll: 1,198 lines/h.

**Failure modes** (`scripts/tests/account-info-log.test.cjs`):

1. every poll logs the pair although nothing changed;
2. a change in the server or character count goes unlogged;
3. the poll leaves the first account read after start unlogged;
4. the poll interval, the response or the listeners change;
5. a failed poll stops logging its warning.

**Change.** The poll line logs at debug. The found line logs at info on the
first read and when its text changes, and at debug otherwise. Log level
`debug` shows every poll as before.

**Interval.** The poll stays at 6 s. Readers of `my_acc.response` in
`runtime/coordinator/application.ts`:

| Reader | Freshness need |
|---|---|
| `connectionCount` (realm switch, `connectionToSuspend` in `realm-switch.ts`) | reads the cached response without a refresh while it decides whether to suspend a slot |
| `accountCharacters`, `characterCount`, `rosterProjection` (`online`, `server`, `level` in the roster) | the dashboard and roster routes display and check them |
| `servers` (`publicOverview`, giveaway realms) | display |
| `subscribeAccount` listener | pushes `siblings_and_acc` to every character thread on each poll (the game's account data and the L1 siblings list) |
| `confirmOffline`, `confirmAccountHomes`, character creation, realm routes, mail | call `updateInfo()` themselves |

A slower poll would make the first four staler, and the realm switch reads its
count without asking, so the interval stays.

**How the console carries it.** The change is a hunk of
`patches/caracal-current-api.patch` (`account_info.js`), regenerated with
`git diff` from a clean clone at the pinned revision; the rest of the patch is
byte-identical. Docker builds and fresh installs apply it.
`tools/caracal/setup.mts` skips the patch on a checkout that already has the
previous version applied, so an existing local install keeps the old logging
until someone reinstalls it.

### Activation record poll (H2)

**Before.** The universal loader (`runtime/characters/universal-loader.ts`,
published as `characters/universal-loader.js`) asks for
`CODE/adventure_land/activation.json` every 2 s. Only a managed console build
deployment writes that record (`publishCode` in
`tools/console-build/hosting.ts`). The live console runs the production image
without `AL_CONSOLE_MANAGED`, so the coordinator serves `CODE` and has no
record: the Steam client got a 404 every 2 s (61 in 2 minutes measured live)
and returned early.

**Failure modes** (`scripts/tests/loader-activation-poll.test.cjs`,
`e2e/console-requests.spec.ts`):

1. the loader asks for `activation.json` every 2 s while the host has none;
2. the loader ignores an activation the host publishes later, or adopts it a tick late;
3. the loader stops asking a host that does not report its activation for the record;
4. the `console-deployment` poll, its maintenance hold, or the startup manifest load change.

**Change.** `/party-api/console-deployment`, which the loader already polls on
the same tick, names the host's activation record in `activation`, or `null`
when there is none. The managed host reads its deployed directory; the
coordinator reads its `CODE` directory. While the reply says `null`, the loader
asks for `activation.json` once every 10 s instead of every tick, so a record
the reply does not name still arrives within 10 s
(`live-console-explicit-activation.spec.ts` and the Steam-style replacement in
`live-game.spec.ts` publish one at the record itself). When a record appears, the
control reply that reports it starts a refresh at once, so the loader adopts
a new activation on the same tick as before. The loader asks a host that
leaves the field out (an older host) for the record on every tick, as before.
A loader older than the host ignores the field.

| Steam client, host without a record | Requests per minute |
|---|---:|
| v1.4.0 | 30 `console-deployment` + 30 `activation.json` (404) |
| Branch | 30 `console-deployment` + 6 `activation.json` (404) |

The Steam client keeps the loader it started with until it reloads.

### Hidden-tab dashboard timers (H4)

Each plain `setInterval` in the breakdown, and what it does:

| Timer | Request | Role | Branch |
|---|---|---|---|
| `console-build-control.tsx`, 1 s | `GET /console-build` | Shows build and deployment state. After the tab's own deployment completes with a new dashboard, it reloads the page. | Unchanged. It already returns early while `document.hidden` and refreshes on `visibilitychange`, so the post-deploy reload waits until the tab is visible, as in v1.4.0. The deployment itself runs on the host. |
| `console-updates.tsx`, 3 s | `GET /console-update` | Shows update status in the header and in Settings. Download, restart and preference changes are click POSTs. | Paused while hidden; reads at once on return. |
| `debug-instance.tsx`, 1.5 s | `GET /console-debug` | Shows the debug instance. The host's `status()` (`tools/debug/service.ts`) also marks a running instance as failed when its container turns unhealthy, so the read drives a state change. | Unchanged. It runs only while Settings is open. |
| `upgrade-preview-panel.tsx`, 2 s | `POST /upgrade-preview` with `refresh: false` | Reads the stored preview (`createUpgradePreviews`, `request`); only the Refresh chances click queues one. | Paused while hidden; reads at once on return, still with `refresh: false`. |

No flow depends on a timer that now pauses. Browsers also throttle timers in
hidden tabs, so a flow that needed one would already be unreliable there.

**Failure modes** (`e2e/console-requests.spec.ts`, `display-only dashboard
timers pause while the tab is hidden and read at once on return`):

1. a display-only timer keeps requesting while the tab is hidden;
2. a tab that becomes visible shows a stale view until the next tick;
3. returning to the tab queues an upgrade preview;
4. a timer that drives a flow stops.

The test hides the tab (`document.hidden` and `visibilitychange`) for 7 s with
an upgrade preview open:

| Requests while hidden, 7 s | v1.4.0 | Branch |
|---|---:|---:|
| `/console-update` | 4 | 0 |
| `/upgrade-preview` | 4 | 0 |
| `/console-build` | 0 | 0 |
| First read after return, ms (update / preview) | 936-1,460 / 1,751-1,815 (next tick) | 46-119 / 50-127 |

### Dashboard first render and log capture

`first render and game log capture reach the dashboard as fast as before`
(`e2e/console-requests.spec.ts`), three runs per tree, interleaved. First
render is the median of three warm reloads until the merchant card shows (the
first load also compiles the dev dashboard). Log capture is the time from
`POST /party-api/game-logs` to the line in the Live logs sidebar, median of 6
lines placed across the 1 s logs poll.

| Run | v1.4.0 first render / logs open / capture (ms) | Branch |
|---|---|---|
| 1 | 2,311 / 111 / 627 | 2,764 / 320 / 630 |
| 2 | 4,482 / 131 / 635 | 2,553 / 349 / 630 |
| 3 | 2,715 / 301 / 609 | 2,630 / 223 / 638 |

Capture samples ranged 83-997 ms on v1.4.0 and 70-955 ms on the branch, one
logs poll in both.

### Measurements on 1.5

The same section benchmark (fixture coordinator with heartbeats, live-size
bank of 8 packs of 42 items with a 9 KB `world` block each, 3,000 log lines),
60 requests per cell, two runs each, median / p95 in ms:

| Read | 1.5 | This branch |
|---|---|---|
| `bank`, full | 3,167,456 B; 17.3-17.6 / 26.6-27.9 | 119,936 B; 1.3-1.4 / 1.8-3.6 |
| `bank`, unchanged with `revision=` | 200, full body; 15.7-18.9 / 21.7-33.4 | 304, 0 B; 0.85-0.95 / 1.1-2.8 |
| `logs`, full | 348,580 B; 2.2-2.5 / 7.2-14.6 | 348,580 B; 2.4-2.8 / 4.2-9.4 |
| `logs`, unchanged with `revision=` | 200, full body; 2.2-2.3 / 4.0-9.0 | 304, 0 B; 1.5-1.7 / 1.9-3.9 |
| `market`, unchanged with `revision=` | 200, 390 B; 0.4-0.5 / 0.5-1.9 | 304, 0 B; 0.3-0.4 / 0.4-0.6 |
| Health check | `state?catalog=0`, 3,189,826 B; 18.4-18.7 / 27-33 | `/party-api/ready`, 14 B; 0.37 / 0.7-1.4 |
| `section=mail` (unknown) | 200, 3,189,826 B; 17.3-19.2 / 34-35 | 400, 114 B; 0.46-0.47 / 1.1-1.8 |

The full bank is smaller on this branch because the report payload change
leaves `world` out of the bank section. The full `logs` read moves within its
run-to-run spread.

### Tests

Run in `ah-e2e-runner` on the branch tip (`.caracal` reinstalled with the
branch's patch and installer), against the v1.4.0 baselines:

| Check | v1.4.0 | Branch |
|---|---|---|
| `npm run typecheck` | clean | clean |
| `npm run lint:runtime` | 132 | 132 |
| Dashboard oxlint | 56 | 56 |
| Unit (`npm run test:unit`) | 2 failures (Caddy HTTPS, launcher restart) | 3,713 / 3,715; the same 2 failures |
| Console E2E | 78 | 83 / 84 (78 + 6 new) |

The one console E2E failure, `log character pills default to all and
independently filter live updates across tabs`, passed in the first full run
of the branch and failed in the second and in four isolated reruns while
another test stack held the runner at load 13-15. v1.4.0 failed it the same
way (the sidebar never opens) in two reruns in the same window. The test
opens the log sidebar 2 s after load, before a slow dev server has finished
its first reload.

New tests: `native-host-health`, `coordinator-public-state` (400),
`coordinator-section-revision`, `dashboard-section-revision`,
`game-log-echo`, `coordinator-installer` (echo transform),
`account-info-log`, `loader-activation-poll`, and six console E2E tests in
`e2e/console-requests.spec.ts`.

## Coordinator

Three hot spots from a 180 s farming profile of the coordinator on the
disposable game stack (`e2e/profile-coordinator.spec.ts`, below):

- **Lowest stand listings (`commerce/local-market.ts`).** `history()` ran
  `listings.find` inside the loop over each item's lowest price, O(items x
  listings) per merchant report. `lowestListings` keeps the first listing at
  the lowest price while it finds that price. `coordinator-market.test.cjs`:
  407 listings for 202 items read 41,818 entries before and at most 3 per
  listing now, with the same history for every item.
  `e2e/console-coordinator.spec.ts` shows the rule through a merchant status
  report and the market section.
- **Class file hashes (`runtime/lifecycle/generations.ts`).** `classScript` read the
  class bundle and computed its SHA-256 on every call; the merchant home check
  reaches it through worker setup on each report. That was 1.6 s of the 2.4 s
  `merchantScheduling` spent in the profile. `classScript` hashes a file again
  only when its inode, size, mtime or ctime changes, for at most 32 files.
- **Death lists in `collectPassing` (`runtime/combat/passing.ts`).** Each status and
  combat response calls it twice, and it copied every member's death list
  before looking at encounters: 1.1 s of the profile, for the usual report
  with no passing encounter. It now returns early without encounters and
  indexes the death times of the encounters' identities in one pass. 20,000
  random member sets give the v1.4.0 result.

`e2e/profile-coordinator.spec.ts` (config `playwright.coordinator-profile.config.ts`)
runs a farm, bank or production scenario with one browser client and three
headless threads, and `e2e/profiling/coordinator-profile-preload.cjs`
records coordinator CPU, event-loop delay, a V8 CPU profile and every status
report's handler and stage times. The combined build profile (below) records
the coordinator in the same runs as the character threads: farming 14.9% of a
core on 1.5 and 8.5% on this branch, steady combat 10.8% and 7.4%.

## Character threads

On the test stack and v1.4.0, headless fighter threads use 38-49% less CPU and the
headless merchant 21-40% less. A fighter farming goos falls from 37.6% to
19.2% of one core, a fighter in steady combat from 32.3% to 19.9%, a fighter
in convoy travel from 29.4% to 16.8%, and the merchant from 13-16% to 9-11%. Most of the saving is the request
path: every `$.ajax` call from headless CODE to the coordinator went through
jsdom's `XMLHttpRequest`, which opens a new TCP connection per request and
runs a JavaScript pass over every character of each body. Four smaller
changes remove per-tick work whose result did not change (geometry
fingerprint, event monster types, the confirmed-death scan during travel)
or nobody saw (queue markers on headless clients). Reactions got
faster, not slower: an attack goes out 3 ms after its cooldown in the
median (5-6 ms on v1.4.0, 90th percentile 10-24 ms instead of 32-78 ms),
and an inventory change reaches `/party-api/state` in 509 ms in the median
instead of 647 ms. Coordinator CPU is unchanged.

### How the threads spend their time on v1.4.0

Each headless character is one caracAL `CharacterThread` process. It runs
the game client and the game's CODE runner as vm scripts in a jsdom window,
and the console's CODE (`shared.js` and `roles.js`, built into one class
bundle) in a second jsdom window under `runtime/lifecycle`.

The measurements come from the disposable game stack (`e2e/game`, upstream
server, game version 15555) with three headless characters: a priest and a mage
(fighters, following the warrior) and the merchant. The warrior is the
browser client that owns the Steam session, as on the live console. The
profile is a 180 s window after a 60 s warmup, and the profiler samples every
250 us (`e2e/profiling/thread-profile-preload.cjs`). Shares are of busy samples
(everything except idle) in the farming scenario.

| Where the time goes | Fighter (priest) | Merchant |
|---|---:|---:|
| Console CODE (`shared.js`, `roles.js`) | 31.5% | 8.5% |
| Game client and the game's CODE runner (vm scripts) | 20.9% | 32.3% |
| jsdom and its WebIDL helpers | 17.7% | 29.8% |
| Garbage collection | 11.5% | 8.2% |
| Node internals (HTTP, streams, buffers) | 7.0% | 9.4% |
| Native builtins (`JSON.stringify` and the like) | 3.7% | 3.9% |
| jQuery | 2.8% | 2.1% |
| Console runtime (`lifecycle.cjs`) | 1.6% | 1.3% |
| socket.io, caracAL, profiler wrappers | 2.3% | 2.9% |

By owner, with inclusive time: the console's request path (`request()` in
`shared.js`, status and combat reports through `$.ajax`) is 22.0% of the
fighter and 33.5% of the merchant; jsdom's `XMLHttpRequest` and jQuery are
most of it (18.3% and 30.3% below `host.ajax`). Each fighter sent about 20
status POSTs a second (1 status report, the rest combat reports and the
combat wait poll), the merchant about 5 requests a second. The game client's
16 ms draw loop, which also advances entity positions in headless mode, is
the largest single timer.

Timer inventory (S6). Synchronous time per callback, as a share of one core,
fighter (priest) and merchant, farming, v1.4.0 and this branch. Async
continuations (request completions, the awaited part of the status tick)
are not in these rows; the request path above covers them.

| Period | Timer | Fighter v1.4.0 | Fighter branch | Merchant v1.4.0 | Merchant branch |
|---|---|---:|---:|---:|---:|
| 16 ms | game draw loop | 6.33% | 7.80% | 3.93% | 3.50% |
| 16 ms | game CODE runner `local_cm_logic` | 0.76% | 0.79% | 0.65% | 0.54% |
| 50 ms | game CODE runner character proxy | 1.86% | 2.08% | 1.33% | 1.28% |
| 50 ms | queue markers | 0.22% | 0.01% | 0.05% | 0.01% |
| 100 ms | movement tick | 3.55% | 1.50% | 0.14% | 0.13% |
| 100 ms | combat client tick (also on `player`/`entities`) | 2.78% | 3.06% | 0.04% | 0.04% |
| 100 ms | escape pulses, departure loot ticks | 0.04% | 0.06% | 0.04% | 0.05% |
| 100 ms | map frame, dashboard sampler (gated) | 0.01% | 0.00% | 0.00% | 0.00% |
| 250 ms | runner tick, loot tick, combat trace | 0.19% | 0.18% | 0.15% | 0.11% |
| 500 ms | regen, reunion | 0.12% | 0.10% | 0.02% | 0.01% |
| 1 s | status tick (sync part), anniversary, target selection | 0.22% | 0.16% | 0.18% | 0.13% |
| 5 s / 10 s | roster, events, player directory | 0.01% | 0.01% | 0.01% | 0.00% |
| | game socket event handlers | 1.72% | 2.69% | 0.03% | 0.02% |
| | whole process | 46.4% | 29.6% | 19.2% | 15.4% |

The fighter's draw loop and socket handlers rise on the branch because that
run killed more and moved more (705 moves against 339); the profiler adds
roughly 10 points to every process in these full runs. The light runs in
CPU before and after carry no profiler.

Top 15 self-time functions, fighter (priest), farming:

| # | v1.4.0 | Share | This branch | Share |
|---:|---|---:|---|---:|
| 1 | garbage collector | 11.5% | `combatContext` monster copy (`shared.js`) | 7.9% |
| 2 | `USVString` (webidl-conversions, via jsdom XHR `send`) | 8.3% | game `update_sprite` | 4.0% |
| 3 | `geometryFingerprint` (`runtime/navigation/contracts.ts`) | 4.6% | game vm line 2815 `get` | 3.6% |
| 4 | `combatContext` monster copy (`shared.js`) | 3.6% | `request()` promise executor (`shared.js`) | 3.3% |
| 5 | game `update_sprite` | 2.4% | game `in_arr` | 3.1% |
| 6 | game `draw` | 2.2% | `isPassingEncounter` (`shared.js`) | 3.1% |
| 7 | `request()` promise executor (`shared.js`) | 2.2% | game `draw` | 2.9% |
| 8 | game `in_arr` | 2.1% | game `draw_entities` | 2.8% |
| 9 | game `draw_entities` | 2.1% | `reunionRealm` (`shared.js`, through the CODE facade) | 2.3% |
| 10 | `isPassingEncounter` (`shared.js`) | 2.0% | `writeUtf8String` (Node HTTP write) | 1.9% |
| 11 | game vm line 2815 `get` | 2.0% | `passingKey` (`shared.js`) | 1.9% |
| 12 | `eventMonsterTypes` filter callback (`shared.js`) | 1.9% | game vm line 2834 | 1.8% |
| 13 | game vm line 2834 | 1.5% | facade `get` (`runtime/lifecycle/runner-scope.ts`) | 1.7% |
| 14 | `eventMonsterTypes` (`shared.js`) | 1.3% | garbage collector | 1.7% |
| 15 | `reunionRealm` (`shared.js`) | 1.2% | `departureTargetEngaged` (`shared.js`) | 1.4% |

In convoy travel the largest v1.4.0 self-time function is the
`departureTargetEngaged` death scan (9.8%); on the branch the whole function
is 2.4%. The merchant's v1.4.0 top entry is `USVString` at 21.5%.

### Changes

#### CT1. Queue markers skip clients without a renderer

`installQueueMarkers` (`runtime/combat/markers.ts`) runs `draw` every 50 ms.
It built `shared.queueMarkers()` before it checked for a renderer. Headless
clients set `no_graphics` (`.caracal/html_vars.js`), and the game then loads
a stub `pixi.min.js` whose `Graphics` draws nothing, so every headless
client built the list 20 times a second and drew it into the stub. `draw`
now checks `no_graphics`, the PIXI stage, the map and the socket first, on
every frame, so a renderer that appears later starts drawing on its next
frame.

Failure inventory:

1. A headless client still computes markers every frame.
2. A client with graphics stops drawing markers.
3. A ring stays on the map after the socket drops or the queue empties.
4. A renderer that appears after install never draws.

Test: `scripts/tests/queue-markers.test.cjs`, "a no-graphics client skips
marker computation". It fails on v1.4.0 with 20 computations for 20 frames.
The Steam overlay cases in the same file cover drawing and disposal.

#### CT2. Headless CODE requests use Node's HTTP client

Every `$.ajax` call from headless CODE to the coordinator (status every
second, combat reports up to every 100 ms, the combat wait poll, map frames)
went through jsdom's `XMLHttpRequest`. jsdom builds a new keep-alive agent,
and so a new TCP connection, for every request, and runs webidl's
`USVString` conversion, a JavaScript loop over every character, on each
body. `runtime/lifecycle/native-ajax.ts` registers a jQuery transport in
each headless CODE window (`createRunnerHost`). It takes asynchronous `http:`
requests to `127.0.0.1`, `localhost` or `[::1]` with a string or empty body
and sends the same method, headers and UTF-8 bytes through `node:http` over
one keep-alive agent. jQuery still owns timeouts, conversion, deferreds and
global ajax events. Browsers and the Steam client never load
`runtime/lifecycle`, so they keep their XHR transport.

Failure inventory:

1. A response value, status, `responseJSON` or header differs from the XHR
   path.
2. An HTTP error, invalid JSON, timeout, refused connection or abort
   resolves differently. `shared.js` `request()` maps these to failure kinds
   (`http`, `invalid-json`, `timeout`, `network`, `aborted`).
3. A timed out or aborted request keeps its socket.
4. The body bytes differ. jsdom replaces a lone surrogate with U+FFFD, and
   so does Node's encoder.
5. A non-loopback, synchronous, `script`/`jsonp` or `FormData` request
   leaves jsdom.
6. A reused keep-alive socket that the server closed fails the request.
   The agent closes idle sockets after 4 s, before the coordinator's 5 s
   keep-alive timeout, and a reset on a reused socket retries once.
7. A CODE reload or retirement leaves requests running. `RunnerScope`
   aborts them through `jqXHR.abort`, which reaches this transport.

Test: `scripts/tests/runner-native-ajax.test.cjs`, against a server with
the coordinator's CORS middleware. On v1.4.0 the connection reuse,
eligibility and runner wiring cases fail (5 connections for 5 requests);
the parity cases (values, errors, timeout, abort, refused connection, body
bytes, `ajaxComplete`) pass on both trees.

#### CT3. eventMonsterTypes caches its list per game data object

`activeCombatEvent` calls `eventMonsterTypes` for every supported event, and
`isAllowedTarget`, `combatAllowed` and `sameEventTeamMember` call
`activeCombatEvent` for every candidate on each combat tick. The list
depends only on `G.events` and `G.monsters`. `eventMonsterTypes` now caches
it per `G` object and event name and returns a copy. A game update loads a
new `G`, which starts a new cache, and each CODE generation starts with a
new function.

Failure inventory:

1. A cached list survives new game data.
2. A caller that edits the returned list changes later results.
3. The `goobrawl`, sprite and Halloween `hp:` spawn rules change.
4. Repeated calls with the same `G` derive the list again.

Test: `scripts/tests/event-monster-types.test.cjs`. Case 4 fails on v1.4.0
(108 reads of `G.events` for 54 calls).

#### CT4. Movement reuses the geometry fingerprint

Movement checks the game geometry identity on every `move()` and every
shared route import. `geometryFingerprint` serializes the collision lines of
every map and hashes the string. `cachedGeometryFingerprint`
(`runtime/navigation/contracts.ts`) keeps the value per `G` object together
with the objects, arrays and array lengths `geometryFingerprint` reads, and
serializes again when the game replaces any of them or an array grows. That covers new
game data, a replaced map geometry and additions like `process_game_data`'s
border lines. The planner service keeps the full fingerprint.

Failure inventory:

1. A new `G`, a replaced map geometry or an added collision line, door or
   map keeps the old fingerprint.
2. Renderer decoration (`map.data` aliases, NPC cosmetics) changes the
   fingerprint.
3. Repeated moves serialize unchanged geometry again.

Test: `scripts/tests/geometry-identity-cache.test.cjs`. Case 3 fails on
v1.4.0 (22 line reads for 20 moves after install instead of 2).

### Measured and left alone

- **S3, `item_properties` per item fingerprint.** `itemDefinition` is 0.3%
  of the fighter's busy time and 0.8% of the merchant's, and
  `item_properties` itself 0.03%. A cache would not show in CPU. The report
  payload change (above) sends only per-copy meta.
- **Combat trace stringify (250 ms).** 0.05-0.06% of a core.
- **Status snapshot.** 2.5-9.2 ms per report across runs on both trees, 0.9%
  of fighter busy time; the report payload change reduces the merchant's
  item part.
- **Game draw loop (16 ms) and the game CODE runner's 50 ms character proxy
  loop.** 6-8% and 2% of a core per fighter. They belong to the game client
  and caracAL's runner, and the draw loop moves entities in headless mode.
- **`combatContext` monster copies.** `combatContext` builds
  `Object.assign({}, G.monsters[mtype], entity)` for every visible monster
  on each skill `world()` call, now the largest console self time (7.9%).
  CT7 (Character threads, follow-ups) builds it only when a decision reads it.
- **`isPassingEncounter`, `passingKey`, `reunionRealm`.** 4-7% together,
  mostly `JSON.stringify` keys and `parent.server_*` reads through the CODE
  facade Proxy. CT8 (follow-ups) reads the realm once per check.
- **jQuery's own request setup.** About 10% of fighter busy time remains
  below `host.ajax`: jQuery resolves each URL through a jsdom anchor element
  to decide `crossDomain`, and builds its Deferreds. CT9 (follow-ups)
  decides `crossDomain` with Node's URL parser.
- **Coordinator.** These changes do not touch it. `structuredClone` and
  `JSON.parse` lead its profile (persistence and report payload groups).

### CPU before and after

Light runs: no profiler, only `process.cpuUsage()` over a 150 s window
after a 60 s warmup. Each cell is the mean of the per-process CPU share of
one core, with the range; fighters are the priest and the mage, 2 runs each
(n = 4), the merchant and coordinator 2 runs (n = 2). v1.4.0 and branch runs
alternated on the same stack.

| Scenario | Fighter v1.4.0 | Fighter branch | Merchant v1.4.0 | Merchant branch | Coordinator v1.4.0 | Coordinator branch |
|---|---:|---:|---:|---:|---:|---:|
| Farming goos (natural spawns) | 37.6% (35.1-40.5) | 19.2% (18.5-19.8) | 14.9% (13.8-16.1) | 9.1% (9.0-9.2) | 16.2% | 16.1% |
| Steady combat (six 50M HP goos) | 32.3% (28.6-35.4) | 19.9% (18.4-21.0) | 15.9% (15.4-16.3) | 9.5% (9.4-9.6) | 10.7% | 11.4% |
| Convoy travel (goo and crab farms, 30 s legs) | 29.4% (27.4-32.7) | 16.8% (16.0-17.8) | 13.1% (12.2-14.0) | 9.4% (9.4-9.4) | 29.0% | 29.8% |
| Bank visit every 50 s (marked cargo, party collection) | 38.2% (35.8-41.7) | 20.3% (17.3-23.0) | 14.4% (14.2-14.5) | 11.4% (11.4-11.4) | 16.3% | 16.5% |

Before the departure death index (CT5), farming, combat and the bank visit
measured 21.8%, 18.9% and 20.5% for the fighter and 9.9%, 9.9% and 11.1%
for the merchant.

Requests: a fighter sends 25 status POSTs a second on the branch against 20
on v1.4.0. The combat client sends a report when its signature changes and
the previous one has returned, so a faster round trip lets more of them
through. Coordinator CPU and its event-loop delay are the same (farming:
15.3-16.4% and p99 16.7-19.0 ms on v1.4.0, 15.5-16.0% and p99 16.0-16.8 ms
on the branch).

Memory: a 13-minute farming run with memory sampled every 30 s
(`PROF_MEMORY=1`) shows no growth on either tree after the first 4 minutes.
Fighter RSS settles at 440-520 MB on the branch against 360-440 MB on
v1.4.0, with the heap swinging between 100 and 270 MB against 70 and 150 MB
before each major collection; the branch collects less often (GC 1.7% of
busy time against 11.5%) and handles 25 report responses a second instead
of 20. Merchant RSS falls from 320-410 MB to 300-315 MB.

### Speed

Same light runs; all samples pooled per scenario.

| Measure | v1.4.0 | Branch |
|---|---:|---:|
| Ready to attack: cooldown expiry to the `attack` emit, in place (p50 / p90, ms) | farming 6 / 32, combat 6 / 35, travel 4 / 78, bank visit 5 / 35 | farming 3 / 10, combat 3 / 12, travel 3 / 24, bank visit 3 / 13 |
| Attacks per minute per fighter | farming 69, combat 78, bank visit 65 | farming 81, combat 85, bank visit 80 |
| Kill to next action, farming and bank visit (p50 / p90 per run and fighter, ms) | 61-470 / 239-902 | 52-409 / 432-913 |
| Character event-loop delay p99 (fighters, ms) | 17.7-46.0 | 11.4-22.4 |
| Movement tick mean / max per call (fighter, profiled runs, ms) | farming 3.9 / 225, combat 8.0 / 246 | farming 1.6 / 44, combat 0.9 / 16 |
| Combat client tick mean / max per call (fighter, profiled runs, ms) | farming 3.1 / 51, combat 10.9 / 105 | farming 3.3 / 47, combat 2.5 / 35 |
| Status snapshot per report (profiled runs, ms) | fighter 4.2-9.2, merchant 2.7-3.6 | fighter 4.3-5.6, merchant 2.5-3.5 |
| Inventory change on the headless priest to `/party-api/state` (p50 / p90 / max, ms, n = 160) | 647 / 1,206 / 1,766 | 509 / 1,062 / 1,287 |

Kill to next action depends on where the next target stands: runs with many
kills put both trees near 300-470 ms in the median, runs with few near
50-100 ms, so the table gives the per-run ranges. The inventory-to-state latency
is the dashboard's data path up to the API: the server changes an item, the
headless client reports it, and a 20 ms poll of `/party-api/state` sees it.
The dashboard's own polling and rendering are unchanged code.

### Tests

On the v1.4.0-based branch tip (`efficiency/character-cpu`), on the E2E runner
(`v1.4.0` baselines in brackets):

- Typecheck: clean [clean].
- `npm run lint:runtime`: 132 errors [132]. Dashboard oxlint: 56 [56].
- Unit: 3,701 of 3,703 pass. The two failures are the baseline ones (real
  Caddy HTTPS; launcher restart retires its own service launcher).
- Console E2E: 78 of 78 [78].
- Live journeys on the disposable game stack, branch and v1.4.0 run one
  after the other: 16 of 16 on both. `live-console-mixed-deployment` (real
  headless workers through a coordinator restart), `live-merchant-transporter-approach`
  (headless merchant), `live-home-realm` (2), `live-home-connect` (headless
  spawn), `live-combat-handoff` (2), `live-farming-handoff`,
  `live-hunt-combat` (3), `live-navigation-supersession` (2) and
  `live-console-safe-reload` (3, which reads the queue markers).
  `live-bankboi-offerings` (5) times out on both trees on this stack with
  the same "Recovering abandoned BankBoi transaction" loop, so it does not
  separate them.

New and changed unit tests: `queue-markers.test.cjs` (no-graphics case),
`runner-native-ajax.test.cjs`, `event-monster-types.test.cjs`,
`geometry-identity-cache.test.cjs`, `departure-death-index.test.cjs` and
`travel-defense-client.test.cjs` (replaces the deaths list where it edited
an entry). Each new case fails on v1.4.0 for the reason its change names.

### How to rerun

The harness runs on the repository's disposable game stack and needs
Linux (`/proc`) and the game fixtures from the testing guide.

```sh
npm run build:shared && node tools/build-runtime.mts && node tools/game/build.mts
PROF_DIR=$PWD/.build/profile/farm PROF_SCENARIO=farm PROF_LIGHT=1   NODE_OPTIONS="--require $PWD/e2e/profiling/thread-profile-preload.cjs"   npx playwright test -c playwright.profile.config.ts
node e2e/profiling/run-summary.cjs .build/profile/farm
```

- `PROF_SCENARIO`: `farm`, `combat`, `travel` or `merchant`.
- `PROF_LIGHT=1` measures CPU, event-loop delay, request counts and
  reactions only. Without it the run also writes a `.cpuprofile` per
  process and per-timer and per-socket-event times
  (`run-summary.cjs --timers`).
- `PROF_WARMUP_S` and `PROF_WINDOW_S` set the warmup (60 s) and window
  (180 s).
- `node e2e/profiling/profile-report.cjs <file.cpuprofile>` prints the
  category split and top self time; `--inclusive [url regex]` and
  `--callers <function>` drill down.

The test fails a run when a fighter attacked 20 times or fewer in the window,
so the harness never reports a stalled scenario as a measurement.

## Character threads, follow-ups

On Ryan's 1.5 branch, the follow-ups cut a farming fighter thread's CPU
another 16% after the character-thread changes (CT1-CT5): 20.5% to 17.3% of
one core, against 37.9% on the 1.5 tip. A fighter in steady combat goes from
20.2% to 19.4% (34.4% on the tip), and the merchant from 11.0% to 10.6%
(16-18% on the tip). Reactions stay as fast or get faster: an attack goes out
2 ms after its cooldown in the median (3 ms with CT1-CT5, 3-6 ms on the tip),
and an inventory change reaches `/party-api/state` in 553 ms in the median
(578 ms, 638 ms on the tip). Coordinator CPU does not change.

Four changes remove work whose result nobody reads: the skill combat context
that most skill checks never open (CT7), the second realm read and context
serialization in every passing encounter check (CT8), jQuery's jsdom anchor
per request (CT9) and the headless tint styling in the game's draw loop
(CT6). The dashboard stream (H3) compares fields without serializing them.

### Where a 1.5 fighter spends its time with CT1-CT5

The profile uses the setup of the character-thread section (disposable game
stack, `E2E_GAMEPLAY_BACKEND=native`, one worker, 60 s warmup, 150 s window,
250 us sampling) on the 1.5 tip `c691d60e` with CT1-CT5 cherry-picked. Inclusive
times of a headless priest's 53.0 s busy time, farming:

| Where | Inclusive | What it is |
|---|---:|---|
| game draw loop (16 ms) | 9.5 s | `draw_entities` 3.8 s (`update_sprite` 2.4 s), `tint_logic` 2.1 s, draw itself 1.6 s |
| game CODE runner `local_cm_logic` (16 ms) | 6.3 s | `Object.keys(localStorage)` and a prefix test on every key, every frame |
| `combatContext` (skill world) | 5.4 s | one copy of every visible monster per `world()` call |
| `isPassingEncounter` | 4.1 s | called by `isAttackingPartyMember` for every visible monster |
| game CODE runner character proxy (50 ms) | 1.4 s | `in_arr` over `character.properties` for every game property |
| `reunionRealm` | 1.2 s | two `parent.server_*` reads through the CODE facade |

In combat the same priest spends 11.1 s in the draw loop (`tint_logic`
2.5 s), 6.5 s in `local_cm_logic` and 4.3 s in `combatContext`.

### Changes

#### CT6. Headless clients skip tint styling in the game's draw loop

The game client's draw loop calls `tint_logic` every 16 ms. It restyles the
skill bar, potion, Town and progress tints with jQuery. A headless
(`no_graphics`) client has no renderer, and nothing reads that DOM.
`installGameRendering` (`runtime/characters/game-rendering.ts`), which caracAL
already runs in the game context before the first draw, replaces `tint_logic`
on `no_graphics` clients. The replacement keeps the native list work: it
removes ended tints with the game's `delete_indices`, turns an ended fill tint
into glow before its `on_end` callback, and advances the dissipate counter.
Clients with graphics keep the native function.

The rest of the draw loop stays. `draw()` also merges entity updates
(`process_entities`), moves entities, removes dead and out-of-range ones in
`draw_entities` and runs draw timeouts. `update_sprite` also stays: the map
telemetry reads the textures it sets (`capturePartyMapLayers` in `shared.js`),
and it keeps a merchant's stand speed and gravestone dimensions.

Failure inventory:

1. A tint that ended stays in the list, so headless tints grow without bound.
2. A fill tint loses its change to glow or its `on_end` callback.
3. The dissipate counter or midpoint differs from the native frames.
4. `add_tint` stops merging into a running tint.
5. A client with graphics stops animating tints.
6. A headless frame still makes jQuery calls for tints.

Test: `scripts/tests/headless-tints.test.cjs` runs the pinned native
`tint_logic` (`.caracal/game_files/17175`) side by side with the headless one
for three frames, with running and ended tints of every type. It is a unit
test because a headless client's DOM is visible only inside its game context.
Case 6 fails on the previous tree (67 jQuery calls).

#### CT7. The skill world builds its combat context on first read

`combatContext` (`shared.js`) builds `Object.assign({}, G.monsters[mtype],
entity)` for every visible monster. The skill runtime's `world()`
(`runtime/characters/skills/runtime.ts`) called it every time, and most
callers never read it: `engine.busy()` on every attack tick (1.5 s of the
5.4 s), `engine.attack()` for classes without attack skills (1.4 s) and the
projectile tracker on action events. `world()` now builds the context on its
first read and keeps it for that world. `engine.attack()` checks the class
before the context mode. The projectile tracker checks for a usable
projectile before it asks for a world; `incoming()` prunes before it sums.
`support()` and `offense()` pass their world to `first()`, which built a
second one in the same synchronous turn.

Failure inventory:

1. A decision reads a context from another turn than the one that asked for
   the world. `blocked()`, the first check of every cast, reads it
   synchronously.
2. `blocked()` lets a disabled actor cast.
3. `busy()`, `attack()` for priest, mage or warrior, or an action event
   without a projectile builds the context.
4. A ranger or rogue attack skips the context or casts differently.
5. `support()` or `offense()` builds a context for its choices and another in
   `first()`.

Test: `scripts/tests/skill-context-builds.test.cjs`, a unit test because the
number of context builds is not visible outside the character thread. Cases 3
and 5 fail on the previous tree. `class-skills.test.cjs` and
`franky-combat.test.cjs` pass unchanged.

#### CT8. A passing encounter check reads the realm once

On 1.5, `isAttackingPartyMember` calls `isPassingEncounter` first, and
`departureTargetEngaged` (after #87's ownership-first order) and the
independent approach context call `isAttackingPartyMember` for every visible
monster. Each check read `parent.server_region` and `server_identifier`
through the CODE facade twice and serialized the realm, map and instance
context. `isPassingEncounter` now reads the realm once and passes it to
`passingKey`, which still reads it itself when a caller passes none. It keeps
the last context text on the function and serializes again only when the
realm, map or instance changes. Keys and answers do not change.

Failure inventory:

1. `passingKey` returns different text for a field shape (numbers, null, a
   missing instance, quotes, backslashes, control characters, lone and paired
   surrogates, U+2028).
2. `isPassingEncounter` answers differently for deaths, peer reservations,
   local and grouped encounters or expired entries, or after a realm, map or
   instance change.
3. One check reads the realm through the facade more than once.

Test: `scripts/tests/passing-encounter-keys.test.cjs`, a unit test because
facade reads are not visible outside the character thread. Case 3 fails on
the previous tree (40 reads for 20 checks).

#### CT9. Headless requests decide crossDomain with Node's URL parser

jQuery decides `crossDomain` for each request by assigning the URL to a jsdom
anchor element and reading its protocol and host back; jsdom parses the URL
in JavaScript. `installNativeAjax` (`runtime/lifecycle/native-ajax.ts`) now
wraps `$.ajax` in headless CODE windows. For an absolute http(s) URL the
wrapper compares protocol and host with Node's URL parser against the origin
jQuery captured at load (`ajaxSettings.url`) and passes the result as the
`crossDomain` option. jQuery keeps its own decision for relative,
protocol-relative and unparseable URLs, and when the options or `ajaxSetup`
already set `crossDomain`. In a runner benchmark (a status-sized POST over the
CT2 loopback transport, server in the same process) a request costs 270 us of
CPU instead of 445 us.

Failure inventory:

1. `crossDomain` differs from jQuery's anchor result for a URL form
   (loopback, same origin, default or explicit port, case, userinfo,
   whitespace, invalid port, protocol-relative, relative, empty, ftp).
2. The wrapper overrides an explicit `crossDomain` in the options or in
   `ajaxSetup`.
3. The wrapper edits the caller's options object.
4. `$.ajax(url)`, `$.ajax(url, options)`, `$.ajax(options)`, `$.get` or
   `$.post` return a different jqXHR or outcome.
5. An absolute request URL still goes through a jsdom anchor.

Test: `scripts/tests/runner-ajax-origin.test.cjs`. Case 1 compares every URL
and call shape against a window without the wrapper, for two origins. Case 5
fails on the previous tree (20 anchors for 20 requests). The CT2 tests in
`runner-native-ajax.test.cjs` pass unchanged.

#### H3. The dashboard stream compares fields by walking them

`difference()` (`runtime/coordinator/telemetry/dashboard-stream.ts`) decided
which vitals, items and slots changed with `JSON.stringify` on both sides of
every field, on every publish, so a fast sample with one changed vital
serialized the whole record twice. It now walks both values and stops at the
first difference, with the same answer as comparing their JSON text: absent
values drop from objects and become null in arrays, NaN and Infinity equal
null, key order counts, and identical references are equal without a walk. A
`toJSON` method, a non-plain object, a bigint or a 65th level sends the field
to `JSON.stringify` as before. The result keeps the old key order. What the
stream sends, and its sequence numbers, do not change.

Benchmark (42 items, 10 slots, one coordinator process): a fast sample with
one changed vital costs 7.5 us instead of 110 us, and a status report publish
116 us instead of 128 us. A status report publish runs for every report even
with no dashboard open; a fast sample runs only while one is.

Failure inventory:

1. The stream skips a field whose JSON text changed, or sends an unchanged
   one.
2. The stream sends a removed field as something other than null, or puts
   keys in another order.
3. A value `JSON.stringify` rejects (bigint, a repeated cycle) stops throwing.
4. Deltas or sequence numbers for status reports change.
5. Each status report serializes an unchanged inventory again.

Test: `scripts/tests/dashboard-stream-difference.test.cjs`: every pair of 59
edge values, key order cases, a 3,000-step random walk over nested records
and the throwing cases against the JSON reference, plus a status report
sequence through the stream. Case 5 fails on the previous tree (88
serializations for one report). `dashboard-live.test.cjs` passes unchanged.

### Measured and left alone

- **`local_cm_logic` and #87's metrics outbox.** The game CODE runner's
  `local_cm_logic` (`runner_functions.js`) runs every 16 ms and walks
  `Object.keys(localStorage)` with a prefix test per key. In a headless
  worker that storage is caracAL's IPC store, which on 1.5 also holds every
  character's metrics outbox ring (`party-metrics-v1:<name>:frame:<n>`, up to
  1,024 keys per character). It is 6.3-6.5 s per 150 s on a fighter, 4% of a
  core, more than the draw loop's tint styling. The runner code is the
  game's; P11 (Persistence) keeps the outbox's keys out of the other workers'
  stores and removes confirmed frames.
- **`update_sprite`.** 2.4 s per 150 s. Map telemetry reads the textures it
  sets, and it holds a merchant's stand speed; CT6 leaves it.
- **The game CODE runner's character proxy loop (50 ms).** `proxy()` runs
  `in_arr` over `character.properties` for every property of
  `parent.character`, 1.4-1.6 s per 150 s. It is the game's runner code.
- **`request()` body serialization.** 1.1-1.4 s per 150 s, the status body's
  `JSON.stringify`; the report payload and inventory delta groups shrink that
  body.

### CPU before and after

Light runs (no profiler): mean per-process share of one core over a 150 s
window, with the range. Fighters are the priest and the mage, 2 runs each
(n = 4); merchant and coordinator 2 runs (n = 2). Runs alternated 1.5 tip,
1.5 + CT1-CT5 and this branch on one stack. Kills and walking vary between
runs (farming: 61-162 kills and 0-557 moves per fighter and run).

| Scenario | Process | 1.5 tip `c691d60e` | + CT1-CT5 | This branch |
|---|---|---:|---:|---:|
| Farming goos | fighter | 37.9% (34.1-41.5) | 20.5% (19.7-21.5) | 17.3% (15.9-19.1) |
| Farming goos | merchant | 17.7% (17.6-17.8) | 11.0% (10.6-11.5) | 10.6% (10.6-10.7) |
| Farming goos | coordinator | 15.6% (14.8-16.4) | 14.9% (14.1-15.7) | 14.3% (14.2-14.5) |
| Steady combat | fighter | 34.4% (31.0-37.3) | 20.2% (18.3-22.3) | 19.4% (17.1-21.2) |
| Steady combat | merchant | 16.3% (15.9-16.7) | 11.0% (11.0-11.1) | 10.6% (10.3-11.0) |
| Steady combat | coordinator | 9.9% (9.8-10.1) | 9.5% (8.7-10.4) | 10.8% (9.4-12.1) |

In the profiled farming runs the priest's busy time falls from 53.0 s to
40.5 s per 150 s: `combatContext` 5.4 to 1.6 s inclusive, the draw loop 9.5 to
6.7 s, `isPassingEncounter` 4.1 to 2.4 s and `reunionRealm` 1.2 to 0.5 s.

### Speed

Same light runs, samples pooled per scenario; movement tick and status
snapshot from one profiled farming run per tree (150 status reports per
character).

| Measure | 1.5 tip | + CT1-CT5 | This branch |
|---|---:|---:|---:|
| Ready to attack: cooldown expiry to `attack` emit, p50 / p90 (ms) | farm 6 / 46, combat 3 / 21 | farm 3 / 12, combat 3 / 16 | farm 2 / 9, combat 2 / 13 |
| Attacks per minute per fighter | farm 60, combat 83 | farm 91, combat 84 | farm 90, combat 100 |
| Fighter event-loop delay p99 (ms, range over runs) | farm 30.6-47.9, combat 16.9-32.0 | farm 14.5-21.5, combat 18.0-24.2 | farm 10.5-17.8, combat 11.4-32.7 |
| Inventory change to `/party-api/state`, p50 / p90 / max (ms, n = 80) | 638 / 1,240 / 1,507 | 578 / 1,168 / 1,540 | 553 / 1,084 / 1,215 |
| Movement tick mean / max per call (ms; priest, mage) | 11.9 / 384, 1.7 / 27.4 | 1.18 / 44.6, 0.84 / 11.8 | 0.11 / 14.6, 0.73 / 38.8 |
| Status snapshot per report (ms; priest, mage, merchant) | 8.1, 7.1, 3.7 | 4.7, 4.0, 2.4 | 3.6, 3.6, 2.5 |
| Dashboard stream, fast sample / status publish (us) | 110 / 128 | 110 / 128 | 7.5 / 116 |

Movement tick time follows how much a fighter walked (priest moves: 572 on
the tip, 594 with CT1-CT5, 154 on the branch; the branch mage's 38.8 ms is
one call). The one
32.7 ms combat p99 is the run whose priest walked 1,056 times.

### Tests

On the group's own branch (`efficiency/character-followups`, CT1-CT9 and H3 on
the 1.5 tip), on the E2E runner (1.5 tip `c691d60e` in brackets):

- Typecheck: clean [clean]. `npm run lint:runtime`: 175 errors [175].
  Dashboard oxlint: 109 [109].
- Unit: 3,715 tests outside `steam-bridge.test.cjs`, 15 failures [3,682, the
  same 15]. The 33 added tests are CT1-CT9 and H3's. `steam-bridge.test.cjs`
  fails 3 of 11 and never exits on both trees; the run times it out.
- Console E2E: 109 of 109 after one rerun of "market affordability uses core
  bank gold" (passed alone) [108 of 109; "unlocked lucky inference overrides
  cursor" failed again alone]. Both runs shared the runner with another
  console run.
- Live journeys on the disposable stack, native time, one worker: 11 of 11.
  `live-combat-handoff` (2), `live-farming-handoff`, `live-hunt-combat` (3,
  passing goos and death ownership), `live-navigation-supersession` (2),
  `live-console-mixed-deployment` (real headless workers through a
  coordinator restart), `live-home-connect` (headless spawn) and
  `live-merchant-transporter-approach` (headless merchant).

New and changed unit tests: `headless-tints.test.cjs`,
`skill-context-builds.test.cjs`, `passing-encounter-keys.test.cjs`,
`runner-ajax-origin.test.cjs`, `dashboard-stream-difference.test.cjs` and
`event-monster-types.test.cjs` (loads every helper `eventMonsterTypes` calls,
however the production code splits the work).

### How to rerun

As in the character-thread section, with `E2E_GAMEPLAY_BACKEND=native` and
`--workers=1`. Start one game stack on its own network from the host
(`docker compose -p <name> -f <compose> up -d --wait`), connect the runner
container to that network (`docker network connect <name>_default
<runner>`), forward 8083, 9003 and 9004 inside the runner to the stack's
8090, 7192 and 7193, and use a global setup that bootstraps the running
stack. Remove the stack after (`docker compose -p <name>
down -v`).

## Combined build profile

One disposable game stack, started from the host, ran the 1.5 tip `1e12540e`
and this branch (`31c480b5`, the tip without docs) one after the other with
`e2e/profile-character-threads.spec.ts`: the warrior as the browser client,
the priest, the mage and the merchant as headless threads, native time, one
worker, 60 s warmup and a 150 s window. Light runs carry no profiler. Each
cell is the mean of the per-process share of one core, with the range; the
fighter cells have two processes per run. Farming pools two runs per tree,
one of them with request byte counting.

| Scenario | Process | 1.5 `1e12540e` | This branch |
|---|---|---:|---:|
| Farming goos | fighter | 39.9% (37.9-41.8) | 14.8% (13.5-16.4) |
| Farming goos | merchant | 16.0% (15.9-16.1) | 6.9% (6.7-7.0) |
| Farming goos | coordinator | 14.9% (14.7-15.1) | 8.5% (8.3-8.6) |
| Steady combat | fighter | 38.0% (35.1-40.9) | 14.4% (13.2-15.6) |
| Steady combat | merchant | 16.0% | 6.5% |
| Steady combat | coordinator | 10.8% | 7.4% |
| Farming, 1,024 outbox ring keys per character saved | fighter | 42.1% (41.6-42.6) | 15.1% (15.0-15.2) |
| Farming, 1,024 outbox ring keys per character saved | merchant | 19.2% | 6.8% |

| Speed | 1.5 `1e12540e` | This branch |
|---|---:|---:|
| Ready to attack, p50 / p90 (ms) | farm 3-5 / 16-34, combat 3 / 10 | farm 1 / 5-6, combat 1 / 4 |
| Attacks per minute per fighter | farm 64-76, combat 59 | farm 87-93, combat 104 |
| Fighter event-loop delay p99 (ms) | farm 17.6-36.7, combat 15.4-22.6 | farm 8.5-9.9, combat 8.3-9.0 |
| Inventory change to `/party-api/state`, p50 / p90 (ms) | 471-641 / 926-1,079 | 405-564 / 697-1,013 |

The saved-ring rows start the console with 1,024 confirmed frames per
character in the journal, the state of a 1.5 console after 17 minutes. On
1.5 every worker receives those 4,096 keys and `local_cm_logic` walks them
every 16 ms: the fighter costs 2.2 points more and the merchant 3.2. This
branch removes them at install (P11) and costs the same as without them. In
an earlier session on the previous 1.5 tip (`c691d60e`), the same light
farming run measured the branch without P11 at fighter 19.0% and merchant
9.8%, and with P11 at 15.7% and 6.9%, on a fresh journal.

A full profile of this branch (farming, 150 s, 250 us sampling) finds no
function or timer at 10% of a core and no flow of several MB/s:

- Fighter threads: 33 s busy per 150 s with the profiler. The game's draw
  loop is 7.4 s inclusive (`update_sprite` 1.9 s self, `draw_entities` 1.4 s),
  the game CODE runner's character proxy (`in_arr`) 1.3-1.4 s, `request()`
  4.0 s inclusive with the status body's serialization, `isPassingEncounter`
  2.7 s inclusive, and `local_cm_logic` 0.35 s (6.3-6.5 s on 1.5).
- Merchant: 8.5 s busy, two thirds in the game client.
- Coordinator: 15.3 s busy, `JSON.parse` of request bodies 2.4 s (1.6% of a
  core) and GC 1.3 s.
- Largest byte flow: status POSTs on loopback, 458-466 KB/s per fighter
  (834-981 KB/s on 1.5).

Left for a follow-up: `combatTrace` and `combat` make up most of a fighter's
205 KB status report, once a second, and most of the coordinator's
`JSON.parse` time. Their readers need an inventory before they move to a
slower cadence or to on-demand debug data.

## Test coverage

`AGENTS.md` prefers E2E tests as the only tests. Each row names the console
E2E journey that shows a fix through the real coordinator, gateway and
dashboard, and the checks that stay unit tests with the reason. A unit-only
check needs an exact torn or corrupt file state, kill timing, limits far
below production sizes, injected disk failures, or the game client, which
only the ChronAL gameplay project runs.

| Fix | Console E2E | Unit-only checks and why |
|---|---|---|
| P2 history saves | `console-persistence`: lines show at once, one save per window, lines survive a restart | items 6-9: a crash after a clear, failing disk writes and timer handles need injected failures |
| P1 saves by content | `console-persistence`: no key's record repeats the one before it; a restart reads the same state | items 2, 3 and 5-7: key order, delete then equal, caller mutation and values without JSON are store contracts with constructed values |
| P3 settings split | `console-persistence`: a settings change saves layout 2 within a second; shutdown saves the v1.4.0 layout; a restart reads it | items 1-6, 8, 10 and 11: a v1.4.0 journal, rollback orders and the 30 s liveness window need constructed journals and mock timers |
| P4 compaction on growth | none | the thresholds are 32 MB and 128 MB; the tests shrink them |
| P5 retention | `console-persistence`: a saved journal with an expired luck cast and 101 rare pursuits loads into a save with the current cast and the newest 100 | items 1, 2 and 5: farm-area hits and retry evidence need chosen ages inside `record()`'s 10-120 s windows |
| P6 crash recovery | none | torn and corrupt file states and SIGKILL timing (`coordinator-crash-recovery.test.cjs`) |
| P13 offline snapshots | `console-persistence`: every character's 30 s refresh appends no roster record; an inventory change saves at once | none |
| P10 metrics journal | none | torn tails and compaction limits far below 128 MB (`metrics-journal.test.cjs`) |
| P12 metrics group commit | `console-persistence`: a POST answers in under 500 ms; each frame is on disk within one commit; frames share bucket writes; a restart returns all of them | none |
| P14 mail read marks | `console-persistence`: opening the mail keeps the newest 2000 marks, every listed mail among them | none |
| A1 field registry | `console-field-registry`: enforced fast sends only whitelisted fields, the full request keeps the debug fields, and the dashboard reads gold from fast polling; shadow fast is the v1.4.0 omit-list output | the catalog completeness parse (state-field-registry.md, Checks), which no section output shows |
| C1p per-copy item meta | every console journey: `e2e/game-fixture.cjs` sends per-copy meta after its first report | the stack limits in `bank-stack-routing.cjs` and `merchant-inventory-stacks.cjs` need storage worker and merge states that the console fixture never reaches |
| C3p snapshot meta join | `console-reports`: a saved per-copy snapshot shows the catalog's item name offline | none |
| F1 inventory carry | `console-reports`: reports without inventory keep it on the merchant card; an unknown revision answers 409; the resend replaces it | the character side (`statusInventory`, `attachStatusInventory`) runs inside the game client: ChronAL gameplay |
| F1 bank comparison | `console-reports`: the stored bank stays the same across reports that omit it and changes with the next full report | the observer and storage worker replacement orders |
| D1, D2, D3, H2, H4 | `console-requests` (six journeys) | `dashboard-section-revision.test.cjs`: cache states after `setQueryData` and removal; `loader-activation-poll.test.cjs`: the universal loader runs only in the game client |
| L1 game log echo | none | caracAL character threads and party events: ChronAL gameplay |
| L2 account info log | none | caracAL's `account_info.js` poll against the account API, which the console fixture replaces |
| G1 lowest stand listing | `console-coordinator`: price history takes the level of the first listing at the lowest price | the read count per listing |
| G2 class file hashes | none | the change is file reads per call, and the checksum cases rewrite a class file in place between calls |
| G3 `collectPassing` death lists | none | passing encounters with deaths come from combat: ChronAL gameplay; 20,000 random member sets compare with v1.4.0 |
| P11 metrics outbox | `console`: `metrics-history.case.ts` keeps only the queued ring slot of a 1.5 store, resends every frame queued during an outage once after a reload, and leaves no key for a confirmed frame | which worker receives which key: only the coordinator's IPC shows it (`coordinator-workers.test.cjs`) |
| CT1 queue markers | `live-console-safe-reload` reads the markers on the Steam client | the headless stub PIXI exists only inside a caracAL thread (`queue-markers.test.cjs`) |
| CT2 keep-alive transport, CT9 crossDomain | every live journey with headless characters (`live-console-mixed-deployment`, `live-home-connect`, `live-merchant-transporter-approach`) sends their requests through it | connection and anchor counts, and parity for each failure kind against an injected server (`runner-native-ajax.test.cjs`, `runner-ajax-origin.test.cjs`) |
| CT3, CT4, CT5, CT7, CT8 | `live-hunt-combat`, `live-combat-handoff`, `live-farming-handoff`, `live-navigation-supersession` run the combat, travel and passing decisions on headless characters | read and build counts exist only inside the character thread |
| CT6 headless tints | every live journey with headless characters | a headless client's DOM exists only inside its game context; the test runs the pinned native `tint_logic` side by side (`headless-tints.test.cjs`) |
| H3 dashboard stream fields | every console journey that renders live dashboard updates | 59 edge values and a 3,000-step random walk against the JSON reference (`dashboard-stream-difference.test.cjs`) |

## Validation on 1.5

Run in the shared Linux runner (Node 24.21, software rendering) on the 1.5
tip `1e12540e` and on this branch without docs (`31c480b5`), with the same
commands (docs/testing.md), after `tools/caracal/setup.mts` in each tree:

| Check | 1.5 (`1e12540e`) | This branch |
|---|---|---|
| `npm run typecheck` | clean | clean |
| `npm run lint:runtime` | 179 | 179 |
| Dashboard oxlint (`npm --prefix dashboard run lint`) | 109 | 109 |
| Unit (`scripts/tests/*.test.cjs` without `steam-bridge.test.cjs`) | 3,682 tests, 16 failures | 3,864 tests, 16 failures, the same 16 |
| Console E2E (`--project=console`) | 109 / 109 on `c691d60e` | 130 / 130, 7.1 min |
| `console-build-docker-dependencies.spec.ts` | not run | not run |
| ChronAL gameplay (`npm run test:e2e:live`) | not run | not run |

The 16 unit failures fail on 1.5 the same way. Two are 1.5's own
(`passive-hunting-ui.test.cjs` and `tracktrix-refresh.test.cjs`, whose
extracted `trackerCatalogListener` misses `trackerCatalogSignature`). The
other 14 failed on the `c691d60e` tip in this runner too, among them the real
Caddy HTTPS test and the launcher restart test, which need a Caddy binary and
a service launcher. `steam-bridge.test.cjs` fails three tests
and then hangs on 1.5 too, so the runs leave it out. The 182 extra unit tests
on this branch are the groups' new tests; all pass. The console project's
extra tests are the groups' journeys and the Test coverage journeys above.

The console project ran without `console-build-docker-dependencies.spec.ts`,
which builds and runs a Docker image, and the ChronAL gameplay project, which
creates disposable game and database containers, did not run: this runner
does not use Docker. Both run from the host (Node 24.20.0) in the final full
E2E run on the finished branch.
