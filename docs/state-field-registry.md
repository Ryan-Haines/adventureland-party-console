# Per-character state field registry

Summary: `section=fast` sent every character status field except a
seven-entry omit list, so debug data such as the `combatTrace` ring buffer
(146 KB per character) went out on every 250 ms poll whenever the live stream
was down. A new registry, `runtime/coordinator/telemetry/character-fields.ts`,
lists all 170 fields a status can carry and holds coded whitelists for the
per-character sections. With `PARTY_STATE_FIELDS=enforce`, `section=fast`
sends the 60 fields that some client reads: on a saved four-character state it
drops from 628 KB to 37 KB and builds in 0.2 ms instead of 2.6 ms. The default,
`shadow`, keeps the v1.4.0 output so a console can audit reads before
enforcing. The full `/party-api/state` request keeps every field.

## What changed

- `character-fields.ts` part 1, `characterFields`: every key that
  `snapshot()` and `sampleTravelReport()` in `characters/shared.js` report,
  plus the keys the coordinator stamps (`seenAt`, `inventorySeenAt`). Each
  entry has a description, a tier (`lean` or `debug`), a size hint with a
  measured size for large fields, whether the coordinator stores it, and its
  external readers.
- Part 2, `sectionFields`: plain arrays for `fast`, `inventory`,
  `diagnostics` (core `characterDetails`) and `coreSummary` (core
  `characters`). Adding a field to a section is one line.
- `public-state-characters.ts`: `fastCharacters` calls `fastProjection`, and
  `diagnosticCharacters` reads its allow-list from `sectionFields.diagnostics`
  (unchanged content).
- `dashboard/features/party/field-read-audit.ts`: an opt-in recording proxy
  for the shadow rollout and the E2E read inventory.
- `tools/state-fields/scan-readers.mts`: a type-aware static scan of which
  character fields a TypeScript client reads.
- `e2e/field-registry-speed.spec.ts`: the before and after speed check.

## Fields added on 1.5

Rebased onto Ryan's `1.5-feature-branch` (`c691d60e`), the registry adds
three report fields and keeps 1.5's own section changes:

- `cc`, the code call cost for the dashboard's CC meter
  (`connected-character-card.tsx`): `fast`, and the live stream, where 1.5
  added it to `liveFields`.
- `donationLevelXp`, the XP per level from `G.levels` for
  `donation-preview.tsx`: `fast`, next to `donationXpPerGold`, and
  `diagnostics`, where 1.5 added it.
- `inventoryRevision` (inventory deltas, `status/inventory-carry.ts`):
  consumed at ingestion, not stored, in no section.

The item `title` 1.5 added to each copy's meta stays in the compact meta
fields (`public-state-characters.ts`). Rerunning `scan-readers.mts` on the
1.5 dashboard, with #135's cards, `donation-preview.tsx` and
`offline-character-view.tsx`, finds no other status field read outside the
whitelists: the remaining names are `inspection` and `updatedAt` from the
offline snapshots and inspection route, `length` on arrays, and the
`travelPlaces` and `monsterChoices` catalogs. #87's Metrics workspace reads
its own `/party-api/metrics` routes plus `conditions` (stream) and core's
`accountId`, `activeSlots` and `accountGold`, all already sent.
Coordinator-level fields 1.5 adds (`characterSnapshots` in config,
`accountGold` in core) are state fields, not per-character status fields.
The fork's whitelist still needs `cosmetics` and `reservedInventory`.

## Tiers

| Tier | Request | Per-character content |
| --- | --- | --- |
| lean | `section=fast` | `sectionFields.fast` (enforce) or v1.4.0's omit-list output (shadow) |
| lean | `section=inventory` | `sectionFields.inventory`, item metadata compacted by `compactEntry` |
| lean | `section=core&dashboard=1` | `characterDetails` from `sectionFields.diagnostics` plus `combat.positioning`; `characters` from `sectionFields.coreSummary` |
| lean | live stream | `streamFields` vitals, items and slots (`dashboard-stream.ts`) |
| debug | `/party-api/state` with no section | every stored field, exactly as v1.4.0 |

The full request already exists, so the debug tier needs no new route. A
field that leaves the lean sections stays readable there.

## Rollout

`PARTY_STATE_FIELDS` selects the fast-section behavior, following the
`PARTY_MOVEMENT_MODE` pattern in `docs/movement.md`:

- `shadow` (default): `section=fast` sends the v1.4.0 output unchanged.
- `enforce`: `section=fast` sends only `sectionFields.fast`.

Shadow procedure:

1. Run the console with the default (`shadow`).
2. In the dashboard, run `localStorage.setItem('party-field-audit', '1')` in
   the browser console and reload. `field-read-audit.ts` then wraps every
   per-character object the dashboard reads in a recording proxy and logs one
   `console.warn` per field read outside the whitelist for that cache kind.
3. Use the dashboard normally for a few days. No `[field audit]` warnings
   means the whitelist covers every read path that use reached.
4. Set `PARTY_STATE_FIELDS=enforce` and restart through the supported
   supervisor workflow. `localStorage.removeItem('party-field-audit')` turns
   the proxy off again.

## Failure inventory

Written before the tests and code, as `AGENTS.md` asks.

Readers losing data:

1. A dashboard panel reads a fast field that the whitelist drops, and renders
   blank or stale data with no error.
2. A dashboard panel reads the field through a dynamic path (`obj[key]`,
   `Object.entries`, a spread into props), so a static scan of property names
   misses it.
3. The dashboard reads a field from the `diagnostics` cache, which the fast
   section fills before core's first `referenceRevision`
   (`query-cache.tsx`), so fast must still carry diagnostic fields.
4. An external client of the public API (the companion PWA and Android app,
   a metrics collector) reads a fast field the dashboard never reads, for
   example `lastDeath`.
5. The full request (`/party-api/state`) changes shape, which breaks
   debugging and the E2E `app.state()` helper.
6. The inventory or core sections change shape when they move onto the
   registry.
7. Fast stands in for the live stream while it is down, so a stream vitals
   field missing from fast blanks that field until the stream returns.

Catalog drift:

8. The character script adds a report field and nobody adds it to the
   catalog, so the catalog stops being a complete reference.
9. A whitelist names a field the catalog does not have (a typo, or a field
   removed from the report), so the section silently sends nothing for it.
10. The script adds a report key through a path the catalog test does not parse
    (a spread or a computed key in the `snapshot()` literal, a new
    `status.x =` assignment, `sampleTravelReport`, or a coordinator-stamped
    key such as `seenAt`).

Mode switching and speed:

11. Shadow mode drifts from v1.4.0 output, so shadow does not measure what
    enforce would remove.
12. The audit proxy runs in production paths or changes values, identity or
    React Query structural sharing.
13. The audit proxy misses reads after a spread copies the object, because
    the copy is a plain object.
14. Building from a whitelist makes the section or the dashboard slower.

## Checks

- Failures 8 and 10: `scripts/tests/character-field-registry.test.cjs` parses
  `snapshot()` and `sampleTravelReport()` in `characters/shared.js` with the
  repository's TypeScript parser helper
  (`scripts/tests/helpers/named-function.cjs`), plus the stamped keys in
  `status/ingestion.ts`, and fails on a spread or a computed key. Every
  reported key must appear in the catalog, and the script must still report
  every catalog entry. Running the real `snapshot()` would need stubs for about
  a hundred game and runtime functions, and each stub would hide the fields
  behind it. This parse checks catalog completeness, which no output shows: a
  report field the catalog lacks changes no section until a whitelist names
  it. It replaces no behavior check; the section checks below and
  `e2e/console-field-registry.spec.ts` show the behavior.
- Failure 9: the same test checks each whitelist entry against the catalog,
  and `streamFields` against `liveFields` in `dashboard-stream.ts`.
- Failures 5, 6 and 11: the test builds a status holding every stored field
  and compares the full request with all stored keys, the inventory and core
  sections with their v1.4.0 shape, and shadow fast output with the v1.4.0
  omit list written out in the test.
- Failures 3, 4 and 7: a field is `lean` exactly when an external client
  reads it or the stream sends it, and `fast` is every stored lean field
  except the three large ones the inventory section carries.
- Failures 1 and 2: the readers inventory below, and the console E2E project
  run with `PARTY_STATE_FIELDS=enforce`.
- Failures 3, 5, 7 and 11 through the real coordinator and dashboard:
  `e2e/console-field-registry.spec.ts`. With `PARTY_STATE_FIELDS=enforce` the
  fixture's status reports reach `section=fast` with only `sectionFields.fast`
  names, the full request keeps the debug fields, and the dashboard shows the
  party gold from fast polling with the live stream blocked. In the default
  mode, fast sends every stored field except v1.4.0's omit list.
- Failures 12 and 13: the proxy is off unless `localStorage` or the E2E
  binding enables it, it caches one proxy per object, and it wraps the hook
  outputs and the merge sites the static scan lists as spreads. The copy in
  `gear-comparison-dialog.tsx`'s `project` stays unwrapped because
  `scripts/tests/gear-comparison.test.cjs` runs that function as extracted
  source; the manual review below covers its reads.
- Failure 14: the speed table below.

## Readers inventory

Three methods, reconciled per client:

1. Type-aware static scan. `tools/state-fields/scan-readers.mts` uses the
   TypeScript checker to record each property access, destructured name,
   literal element access and `in` test on a value typed as a character type
   (`Char` in the dashboard; `CharacterVitals`, `CharacterDiagnostics` and
   `CharacterInventory` in the PWA), including reads after a spread, whose
   properties keep their declarations. When a character value flows into a
   helper with a structural parameter type, it records that type's declared
   fields. It lists every access it cannot resolve as dynamic.
2. Runtime recording. `field-read-audit.ts` recorded every first read per
   cache kind and field across the 78 console E2E tests
   (`PARTY_FIELD_AUDIT=1`). The same proxy, patched into a scratch copy of the
   PWA's data hooks, recorded the PWA's 324 Playwright tests.
3. Shadow mode, above, for reads that only real use reaches.

Android reads the API through kotlinx data classes; the declared fields of
`CharacterVitals` (fast and stream) and `CharacterDiagnostics` (core) plus the
literal keys read from `CharacterDiagnostics.raw` form its read set. The
metrics collector reads `state?section=fast`, `inventory`, `bank`, `logs` and
`config` (`src/collector.ts`), and its fast reads are `ctype`, `seenAt`,
`monsterAchievementKills`, `map`, `gold`, `level`, `xp`, `max_xp`, `rip` and
`lastDeath`.

Results, counting status fields only (the dashboard also reads the `travelPlaces` and
`monsterChoices` catalogs from a character before core's catalog arrives):

| Client | Static | Runtime | Only static | Only runtime |
| --- | --- | --- | --- | --- |
| dashboard | 54 fields | 52 fields | `combatStats`, `unrestrictedSpeed` (stats dialog, which no E2E opens) | none |
| PWA | 50 fields | 54 fields | `monsterHunt`, `xp` | `str`, `int`, `dex`, `goldBonus`, `xpBonus`, `unrestrictedSpeed` (read by `num(key)` in `GearComparisonSheet.tsx`, which the static scan lists as dynamic) |

Each method caught fields the other missed, so the whitelist is the union of
both, plus Android and metrics: 59 report fields, plus `in` and
`upgradeInventoryBusy`, which only the live stream's readers use and fast
carries as the stream fallback.

Dynamic sites, reviewed by hand:

- Dashboard (28): `character-cache.ts` and `query-cache.tsx` copy whole
  objects into the query cache; `use-panel-model.ts`, `log-sidebar.tsx` and
  `send-to-party-control.tsx` take `Object.keys` of the character record
  (names only); `gear-comparison-dialog.tsx` reads `character[primary]`
  (`str`, `int` or `dex`) and `candidate[key]` over its stat rows, all
  whitelisted, and it copies the character before adding gear deltas; the
  remaining spreads merge cache kinds into one `Char`
  (`connected-character-card.tsx`, `character-map-section.tsx`,
  `connected-farming-area-picker.tsx`, `merchant-card-controls.tsx`,
  `character-stats-trigger.tsx`, `stand-count.tsx`). The audit proxy wraps
  each merged object, so runtime recording covers the reads after them.
- PWA (11): `PartyDataProvider.tsx` merges and stores records;
  `GearComparisonSheet.tsx` reads `str`, `int`, `dex`, `vit`, `luck`,
  `fortitude`, `armor`, `attack`, `frequency`, `range`, `resistance`, `speed`,
  `goldBonus` and `xpBonus` through `num(key)`; `StandScreen.tsx` and
  `FarmingSection.tsx` cast to `{ standOpen }` and `{ farmingMode }`;
  `AccountMembers.tsx` reads `characterSprite` and `characterDollHtml`.
- React's development build diffs changed props
  (`addObjectDiffToProperties` in `react-dom_client.js`) and touched 18 more
  fields, such as `runtime` and `threats`. Those are framework reads that a
  production build does not make, so the reconciliation drops reads whose
  stack frame is under `node_modules`.

External clients of the public API that need fields the dashboard does not
read (why the whitelist carries them):

- `rip`: the PWA and Android death indicator and the metrics death fallback.
- `target`: the PWA and Android combat target line.
- `upgrading`: the PWA and Android merchant activity flags.
- `lastDeath`: the metrics collector's death count.
- `monsterAchievementKills`: Android achievements and the metrics
  account-wide achievement totals.

Not sent in enforce mode (92 stored debug fields, still in the full request):
the identity and protocol fields (`runtime`, `platform`, `clientVersion`,
`codeHash`, ...), the combat queue (`combatTrace`, `groupedCombat`,
`combatSelection`, `combat`, `threats`, the rare and loot reports), movement
and navigation diagnostics (`movement`, `convoyNavigation`, `travelSample`,
`farmingNavigationDebug`, `farmAreaEvidence`, ...), the event feed fields, and
`realmPlayers`, `nearbyStandListings` and `nearbyGiveaways`, which v1.4.0
already left out of fast. The catalog's `tier: "debug"` entries are the full
list. Ten of them stay in v1.4.0's diagnostics allow-list, which this change
leaves as it is: `recovery`, `movement`, `eventWalkFailure`,
`farmingNavigationDebug`, `activeEvent`, `joinedEvent`, `gatheringPhase`,
`gatheringBlockedReason`, `gatheringAttemptId` and `lootStatus`. No client
reads them from core, so they are candidates for a later cut.

## Speed

Two measurements, both comparing v1.4.0 with this branch in `shadow` and
`enforce` mode.

Section builders on real data. A saved four-character state dump
(2026-09-23, 141 fields per character) fed through `createPublicStateRoute`
plus `JSON.stringify`, 300 timed calls after 50 warm-up calls, two runs each
(median / p95 in ms):

| Section | v1.4.0 | shadow | enforce |
| --- | --- | --- | --- |
| fast bytes (4 characters) | 627,617 | 627,617 | 36,656 |
| fast time | 2.64 / 4.20, 2.72 / 4.57 | 2.60 / 4.02, 3.03 / 6.02 | 0.21 / 0.35, 0.19 / 0.42 |
| fast keys per character | 134 | 134 | 58 |
| core bytes, time | 37,582; 0.44 / 1.32 | 37,582; 0.42 / 1.31 | 37,582; 0.43 / 1.15 |
| inventory bytes, time | 52,019; 0.19 / 0.37 | 52,019; 0.20 / 0.35 | 52,019; 0.19 / 0.45 |
| full request bytes, time | 4,750,325; 28.3 / 37.4 | 4,750,325; 26.8 / 40.1 | 4,750,325; 29.0 / 45.8 |

One character's fast entry drops from about 157 KB to about 9 KB. The status
ingestion path (`status/ingestion.ts`) is unchanged; the builders only run
when a client requests a section.

Dashboard journeys. `e2e/field-registry-speed.spec.ts` (Playwright project
`speed`, run with `PARTY_SPEED_LABEL` set) on the E2E fixture, three
interleaved rounds per build on a shared runner. Each cell is the median of
the three per-round medians (p95 in brackets), in ms:

| Journey | v1.4.0 | shadow | enforce |
| --- | --- | --- | --- |
| First render to the merchant's inventory (5 loads) | 1853 (2439) | 1670 (1722) | 1733 (2490) |
| Item details dialog open (10) | 445 (506) | 384 (460) | 386 (491) |
| Gear comparison dialog open (10) | 469 (629) | 427 (607) | 442 (574) |
| Bank dialog open (10) | 303 (355) | 202 (256) | 233 (282) |
| Update latency, live stream (20; status POST to DOM) | 22 (85) | 18 (48) | 21 (47) |
| Update latency, fast polling with the stream blocked (20) | 186 (302) | 177 (274) | 172 (271) |
| `section=fast` response (50) | 0.6 (1.8) | 0.7 (1.7) | 0.7 (1.4) |
| `section=core&dashboard=1` response (50) | 0.9 (1.6) | 0.9 (1.4) | 0.9 (1.3) |
| `section=inventory` response (50) | 0.6 (1.0) | 0.6 (0.7) | 0.6 (0.9) |
| Full request response (20) | 8.8 (27.6) | 7.4 (21.8) | 7.1 (24.1) |

No update sample missed its 3 s window. The fixture's three characters
report about 30 fields each, so its fast section is 2.4 KB (1.7 KB enforced)
and the journey numbers show that nothing regressed; the real-data table
shows the size win. Other agents shared the runner during these
runs (load average 8 to 11 on 8 cores), so differences of this size between
builds are run-to-run noise.
