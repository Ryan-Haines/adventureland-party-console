# Character cards and issue followup for 1.5

The card layout uses matching chevron rows for Combat log, Inventory, Equipped and Merchant restock. Inventory and Equipped start open as requested; the other two start closed. Each character's browser preference survives refresh. Inventory, Equipped and Merchant restock appear in that order, before the remaining action lists. Restock drafts survive hiding and status refresh; saving persists through coordinator restart. The embedded restock element is memoized so unrelated vitals do not force inventory renders.

| Issue | Result and observable coverage |
| --- | --- |
| #141 | Native renderer cells preserve weapons, large cosmetics, transforms and projectiles. Headless clients retain native HTML cosmetic bounds and project observed action packets using native atlas metadata, origin, ETA and matching-hit retirement. Pixel checks include removal, clipping and sanitization; capture is subscriber-only with bounded traversal, payload and caches. |
| #122 | Steam minimize/restore keeps a fixed anchor between the native PvP score and controls. Narrow windows use the next row. Browser rectangles, resize/reload, non-overlap, audio and movement-toggle regressions pass. |
| #126 | Existing event-route sighting behavior is now covered for both Green and Pumpkin. A real native boss exists before travel, then the same ID is displaced into view during verified native walking. Both fighters attack before reaching the obsolete advertised spawn. |
| #128 | Independent default-off attachment collection and post-collection deletion settings, a new-mail indicator acknowledged on opening Mail, and durable confirmed-send outbox records with local deletion. Native round-trip coverage proves exact inventory transfer, native `taken=true`, job completion, deletion and restart persistence. |
| #124 | Explicit bought/not-bought reconciliation releases stale WTB reservations only after the owning job is absent. Counts, unrelated orders, replay refusal, queued-job refusal and restart are checked. Thefonze74065's original `bf5da1b` contribution is preserved as authored commit `3d86eaa`. |
| #125 | Replacing focus queues a revision-fenced relocation when the old farm's species no longer match. Event attendance and its return keep ownership until handoff; later manual commands supersede relocation. Native readiness now permits only the matching farming encounter during convoy handoff, preserving other movement gates. Both fighters must damage the new bees after natural event completion. Explicit travel and neighboring terrain/Hunt journeys remain covered. |

Outbox history begins with newly confirmed sends; old native sent mail is not backfilled. Deleting an outbox record does not recall native mail. Headless projectile rendering projects observed timing and metadata; it does not invent attack outcomes or claim to reproduce absent PIXI state.

## Repeatable validation

[The retained result](testing-1.5-card-and-issue-followup-results.json) records exact commands, scenario identities, latest outcomes, timings, source revisions, GPU identity, candidate IDs and SHA-256 manifests. Local archives under `.build/release-1.5-followup/<archive>/.build/` preserve initial failures alongside corrected passing runs. The result writer verifies every archived evidence hash and refuses unresolved latest outcomes. This is focused validation, not a full-suite execution; the selection audit retains all 338 scenarios exactly once and all 227 gameplay scenarios use ChronAL by default.

```powershell
$env:E2E_BROWSER_RENDERING='hardware'
$env:E2E_MEASURE_BROWSER_CPU='1'
$env:E2E_EXPECT_GPU='NVIDIA GeForce RTX 5090'
npm run typecheck
npm run test:e2e:selection
npm run test:e2e -- --project=console --project=live --workers=1 --grep 'character sections collapse|mailbox settings persist|outbox shows durable|live maps draw native|map sprite publication|headless native HTML|headless server action|Steam Characters bar|Steam pointer toggle|Steam character controls|expanded character and Cave maps|fixed-origin map image proxy|player context marks keep|player and merchant inventory batches|mailbox automation collects native|unconfirmed WTB|new farming focus resumes|walk yields to a newly visible boss|explicit monster travel|native event route retains ownership|native UHills farming handoff|doll markup remains inert|empty saved hawk spawn'
npm run test:e2e:verify
```

The final passing rerun is archived as `focused-final`; verify it with `node e2e/verify-artifacts.cjs .build/release-1.5-followup/focused-final`. Earlier reports intentionally fail the verifier's all-passed gate, while their artifact hashes remain intact. Retained isolated mail/focus/farm/readiness checks use the repository's existing fixtures, restored with `node scripts/ci/restore-game-fixtures.cjs`; no new unit cases were added.

The final immutable console candidate is completed and verified against the final source fingerprint. It remains staged for an explicit user load. No live console or game client was restarted or activated. Disposable E2E processes stop and workspaces are removed after report attachments finish copying; verifiable reports remain.
