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
