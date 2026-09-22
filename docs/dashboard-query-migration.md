# Dashboard query and live telemetry migration

The dashboard uses a browser-local TanStack Query v5 client. Core configuration,
per-character diagnostics, live vitals, inventory, logs, bank, market and reference
data have separate subscriptions. Drafts and confirmations remain React state.
Ordinary actions cancel affected reads and invalidate explicit domains; inactive
domains become stale without fetching. Failed actions preserve confirmed data and
are never retried automatically. Authentication loss clears account caches;
account replacement also resets local drafts.

## Delivery and ownership

`GET /party-api/dashboard-stream` carries a complete initial snapshot, then changed
character fields and inventory/equipment slots. Null slots explicitly remove items.
Server epoch, stream sequence, runtime generation and sample sequence fence stale
updates. Reconnect starts with a new complete snapshot. Core diagnostics cannot
overwrite live fields. Reused slots replace metadata rather than merging it.

The maintained coordinator installer registers the stream and telemetry POST
routes in native and Docker builds. The telemetry store only supplies display
data: ordinary status remains authoritative for automation and runtime ownership.
Ordinary status responses negotiate a renewable three-second viewer lease.
Capable runtimes sample every 100 ms while leased, send changes, allow one POST
in flight and retain only the newest pending sample. Item metadata is built only
for changed entries. Older runtimes continue through polling compatibility.

Each visible browser tab has one stream. Heartbeats occur every five seconds;
15 seconds of silence causes reconnect and fallback polling (vitals 250 ms,
inventory two seconds). A fresh snapshot disables fallback. Hidden tabs close
streams and pause recurring reads. Slow streams are disconnected and resynchronize
on reconnect. Existing map streams and bot command cadence are preserved.

## Cache policy

| Domain | Active updates | Stale time | Unused retention |
| --- | --- | --- | --- |
| Vitals/inventory | Stream, fallback only | Infinite healthy, zero fallback | 1 minute |
| Core/roster | 1 second | 1 second | 5 minutes |
| Logs/activity | 1 second while displayed | 1 second | 1 minute |
| Bank | 2 seconds with a consumer | 2 seconds | 5 minutes |
| Market | 10 seconds with a consumer | 10 seconds | 2 minutes |
| Inbox | 2 seconds open, 10-second badge | 2 seconds | 5 minutes |
| Catalog/maps | Revision-keyed, on demand | Infinite | 30 minutes |
| Postage | Stale composer opening | 15 minutes | 30 minutes |
| ALData authentication | 15 seconds while pending | Zero | 1 minute |

On-demand reads retry transient failures once after a second; recurring reads
wait for their next scheduled update. Closed panels release observers. Reference
data is shared across map consumers; switching maps has no previous-map placeholder.
Stale data remains visible with connection/error status during outages.

## Measurement

`node scripts/benchmark-dashboard-query.cjs` performs read-only GETs against the
local coordinator and replays the same four-character snapshot through the old
HEAD projection and current maintained projection. It includes a synthetic ten
seconds of four-character HP telemetry at 10 Hz. The raw result is written to
`.build/query-replay-benchmark.json`.

Replay on 2026-09-14 01:23 UTC:

| Ten-second replay | Previous | Migrated |
| --- | ---: | ---: |
| Dashboard response bytes | 74,397,830 | 4,273,520 |
| Additional runtime telemetry POST bytes | 0 | 936,168 |
| Additional stream bytes | 0 | 99,168 |
| Projection CPU, including telemetry processing | 173 ms | 94 ms |

This is approximately 93% less estimated traffic and 46% less projection CPU.
It excludes HTTP headers, existing map streams, unchanged ordinary bot status and
mail. It is not a total-system CPU or physical LAN benchmark. Samples vary with
game state. No 100–200 ms end-to-end latency claim is established by this replay.

After activation, `window.dashboardLiveMetrics` exposes bounded counters and the
last 100 sample-to-commit estimates and receive-to-commit timings. Core responses
provide clock alignment; network asymmetry still affects absolute estimates.
Counters retain neither item contents nor credentials.

## Verification and rollout

Automated coverage includes shared-map reads and observer cleanup, hidden-tab
gating, cache expiry, precise invalidation, failed mutations, authentication cache
clearing, stale polling responses, slot removal/reuse, generation fencing, leases,
heartbeats, reconnect and stalled-client cleanup. React subscription tests verify
one character's HP change does not render other character subscriptions or the
inventory panel, and equal cache values cause no content updates. Real HTTP native
and authenticated gateway tests verify snapshot/heartbeat passage and disconnect
cleanup.

Final native production build (including typecheck) and Docker image build passed.
All 17 focused query, telemetry, React subscription and real HTTP proxy tests also
passed inside the built Linux image with `NODE_ENV=test`. Changed dashboard UI
and new query/telemetry modules passed lint. Production React intentionally omits
the `act` test helper, so render tests require test mode even inside that image.

The combined full suite on 2026-09-14 reported 1,548 passes out of 1,551. Remaining
failures are in concurrently edited event/navigation behavior:

- `anniversary-kiss`: featured character holds before the combat cutoff.
- `anniversary-kiss`: abort retires a pending skill without late claims/kisses.
- `franky-exit`: each member queues Town before the rest arrive.

No live activation was performed by this migration. Use the supported
`scripts/start-console.ps1` workflow in `runtime/coordinator/README.md` to publish
matching coordinator, character and dashboard assets after resolving combined
validation failures. A build alone does not reload the live process.

No browser was exposed by the computer-use environment. Physical visual QA,
browser CPU/heap and commit-time profiling, real sample-to-render LAN latency,
active combat/looting, two visible dashboards, real Steam handoff/runtime reload,
and the complete idle/market/bank/multiple-map scenario matrix remain unverified.
These measurements are required before asserting the full resource and latency
acceptance targets. Existing gameplay was left running during read-only replay.
