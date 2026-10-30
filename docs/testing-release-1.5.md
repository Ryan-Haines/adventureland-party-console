# Release 1.5 validation inventory

Before implementation: drop catalogs can omit home-server tables, conflate native kill counters with drop tables, discard late tracker table changes, or list duplicate rolls as contradictory probabilities. Preserve direct roll coefficients, reward quantities and independent rows; show base odds as ratios with explicit contribution/luck/level caveats. Home rewards require home-server bonus and must remain separate from ordinary/zone/world drops in both monster and item views. A rate coefficient above one is not a guaranteed count of multiple items.

Native regression declares only Tracktrix discovery input through the real server socket and observes maintained CODE/catalog HTTP publication, including a later table change. Browser regression renders maintained monster and item dialogs, verifies ratio odds, separate home rewards, independent duplicate rolls and inspect navigation. No native action results are fabricated.

Existing-fix audits: #23 statistical elimination must preserve 100-sample threshold, dynamic eligibility, manual lock precedence and restart. #57 passing/tombstone indexes must preserve invalid/duplicate timestamps, expiry and realm identity while reducing repeated scans. #83 must retain native collision and actual melee damage around engaged terrain. #106 planner visibility must remain the exact native function across normal/throw/cancel and CODE retirement. Validate existing behavioral regressions before closing.

Catalog refresh failure modes: ordinary heartbeat acknowledgements must not suppress a newer discovery generation while its item caches warm; an older catalog response must not acknowledge a later tracker update. Retain the native later-table-change E2E and original no-retransmission handshake assertions.

Native tracker discovery inputs retain the server packet envelope: monsters, monsters_diff, exchanges and max from the actual player, plus both home-table aliases. The native game receiver renders this packet before CODE listeners; incomplete envelopes can throw inside native rendering and prevent CODE discovery from observing an otherwise delivered packet.


## Release integration validation

Contributor PRs #87, #104 and #135 are integrated with their original head commits retained as ancestors, preserving contributor authorship. Conflict resolution and compatibility fixes live in follow-up commits on `1.5-feature-branch`.

The retained machine-readable result is [testing-release-1.5-results.json](testing-release-1.5-results.json). It records the latest outcome for each of 45 distinct focused browser/native E2Es, every archived run (including initial failures), source revisions, candidate IDs, timing, and SHA-256 evidence manifests. This is focused release validation, not a claim that the complete 322-scenario suite ran. The selection audit verifies all 322 identities exactly once and all 219 gameplay cases use ChronAL by default. The 98 existing isolated regressions used to validate #23/#57/#83/#106 also pass; their command and behavior inventory are in [testing-release-1.5-existing-fixes.json](testing-release-1.5-existing-fixes.json).

Local reports are preserved under `.build/release-1.5-validation/<archive>/.build/{e2e-report,e2e-results}`. Artifacts include native events/receipts, fresh coordinator state, screenshots, timing and workspace-cleanup results. Initial failures remain available alongside corrected passing reruns. No assertions were weakened to obtain passing outcomes. The stat-delivery scenario explicitly enables delivery trips; the tracker scenario supplies the complete native packet before changing only the declared home-drop table. Automatic bank compounding uses one finite rule and checks exactly one native result, three consumed inputs and untouched locked/unrelated stock.

Repeat the focused checks with one worker and local hardware rendering mode:

```powershell
$env:E2E_BROWSER_RENDERING='hardware'
$env:E2E_EXPECT_GPU='NVIDIA GeForce RTX 5090'
npm run typecheck
npm run test:e2e:selection
npm run test:e2e -- --project=console --workers=1 --grep 'merchant donation|offline|never-loaded|item batches|inventory batches|bank selections|exchange reward selections|Steam pointer|metrics persists|metrics collector|monster rewards|access code|game.*card|character.*stats|catalog comparison|item titles|lucky discovery|equipment comparison|exact selection, rollback'
npm run test:e2e -- --project=live --workers=1 --grep 'accepted native catalogs|native tracker home rewards|compound from native bank|gathering tool crafting settings|missing fishing tool|missing mining tool|exchange rewards that merge|a missed fishing|armadillo Hunt kills|healthy warrior reaches an engaged Phoenix|warrior recovers a blocked Targetron|a merchant (str|luck) stat scroll|a stale stat mark|bank uses all initial slots|offline merchant logs in|offline merchant work permits'
npm run test:e2e:verify
```

Run the artifact verifier immediately after each run, before another run replaces the standard report directory. The final catalog-only report is also retained as `catalog-final`; verify its archived copy with `node e2e/verify-artifacts.cjs .build/release-1.5-validation/catalog-final`. Earlier failing reports still have intact hashes but intentionally fail the verifier's all-scenarios-passed gate.

The final immutable candidate is completed and staged, with a source fingerprint matching the final code. No live console or game client was restarted or activated. Offline equipment-derived projections explicitly omit private permanent bonuses and temporary effects; when native calculation assets are unavailable, basic saved stats remain inspectable and derived values are labeled unavailable.


## Direct drop cards and whole-number odds

Failure inventory: forcing a numerator of one produces decimal denominators;
exchange-derived acquisitions appear as monster drops; derivation labels and long
odds overflow the sprite column; compacting duplicate rewards loses distinct
chance/quantity lines. The retained browser journey covers each case at 1440,
640 and 390 pixels, with measured sprite/odds/card bounds and screenshots.

Official reference behavior is pinned with the test game:
- [Mr. Green's table](https://github.com/kaansoral/adventureland_mongodb/blob/90052162eb3ebda36c893e1eb4af643913c8f984/design/drops.js#L388) specifies the CX Jar coefficient as `15 / 100000`, which reduces to `3/20,000`.
- [Native monster drop rolls](https://github.com/kaansoral/adventureland_mongodb/blob/90052162eb3ebda36c893e1eb4af643913c8f984/node/server.js#L2212) compare a modified random draw with each table coefficient; values above one do not mean multiple awarded items.
- [Native chest table selection](https://github.com/kaansoral/adventureland_mongodb/blob/90052162eb3ebda36c893e1eb4af643913c8f984/node/server_functions.js#L3988) chooses a weighted reward and opens nested tables directly into the chest. Those final items are direct drops. Trading a dropped candy cane or mistletoe for another reward requires an exchange, so the resulting Hot Chocolate is excluded from the monster-drop tables.

Both item and bestiary views exclude acquisition paths containing an exchange.
Native chest openings and direct zone/world drops remain visible. Chances use
reduced whole-number numerators and denominators reconstructed at the reported
floating-point precision, with an exact decimal-fraction fallback for values
beyond safe numeric convergents. Distinct drops keep separate ratio lines and
quantities. Cards omit roll numbers, roll-weight labels and acquisition arrows;
the sprite has a dedicated column and the odds wrap within the text column.

Repeat the focused browser check with:

```powershell
npm run test:e2e -- --project=console --workers=1 --grep 'monster rewards separate home drops'
```

This UI follow-up was requested after the successful 340-scenario CI recovery
run and has its own focused evidence; that earlier full run did not include it.

The final focused scenario passes with 18 verified evidence files and its owned
workspace removed, retained under `.build/ci-recovery/direct-drop-ratios-complete-green`.
`npm run typecheck` passes. Desktop and phone screenshots were reviewed. The
completed, source-matched staged candidate is
`3c8f69fd48a4c56137a3088e05684afcda079c4e73821bd3e9d331d7f99f2c77`;
this follow-up did not activate or restart the running console.

The shared-drop catalog preserves all distinct source rows while deduplicating catalog item definitions. An intermediate assertion had a Windows encoding error in its quantity string; the corrected UTF-8-safe fixture passes with the original exact quantity requirement.


## Planner wall corners (#147)

Adopted Thefonze74065's native-collision/detour implementation from
[9120e68](https://github.com/Thefonze74065/adventureland-party-console/commit/9120e685d5a913c96e5aaee43a3225318ed7fd09).
The integration retains collision source files across worker recreation, reuses
the shared movement Geometry contract, and preserves explicit instance identity
on inserted points. Client validation and bounded repair remain the backstop
when a single valid detour is unavailable. Fork bookkeeping and additional unit
tests were not imported; the maintained native gameplay E2E is registered.

The control used the pre-fix working planner bundle (its SHA-256 and absent fix
marker are recorded) and reproduced the exact rejected edge from (135,72) to
(153,-51). All 48 control evidence files verify. Shared/runtime/game outputs were
then rebuilt before the passing run; creating a console candidate alone does not
replace the working test coordinator bundles.

The corner journey checks nine actual planner HTTP responses against native
server collision, covering the town-to-tunnel route, six additional reported
corner pairs, and small/large footprint variants. Both fighters then arrive
within 35 units of the tunnel approach with no client repair logged. That case,
Phoenix terrain approach, Desert transporter cargo collection and Town
supersession all pass: 4/4 ChronAL E2Es, 187 verified evidence files, four owned
workspaces removed and the owned game pool torn down. Typecheck passes. Selection
retains 341 scenarios exactly once, with 230 gameplay scenarios using ChronAL by
default. These are focused checks, not a new full-suite run.

Repeat with:

```powershell
npm run test:e2e -- --project=live --workers=1 --grep 'Routes from a town corner contain no edge|native headless merchant approaches Desert transporter|healthy warrior reaches an engaged Phoenix|superseded native Town progress ends quietly'
```

[testing-planner-corner-results.json](testing-planner-corner-results.json) records
source attribution, control and passing evidence archives, timing, cleanup and
the completed source-matched candidate. Artifact
`61842c08d71ad13a150778a8166217042048595cdb87894d368c13cc892db04a`
is staged; this task did not activate it or restart the running console.
