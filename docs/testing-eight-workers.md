# Eight-worker local gameplay validation

The self-hosted workflow runs eight Playwright workers by default. Its maintained
launcher no longer restricts process affinity to eight logical CPUs; below-normal
priority remains. The active listener was updated without restarting the current
one-worker full-suite job. Already-running Playwright jobs retain their original
worker count; start a new manual run to use the new default.

A shared list of sixteen assigned loopback hosts replaces independent four-host
allowlists in browser routing, the denial proxy, native clients, coordinator
fetching and Docker game configuration. Production/external destinations remain
blocked. The first eight hosts serve the normal eight-worker run. Diagnostics can
use `E2E_GAME_POOL_OFFSET=8` and a distinct `E2E_GAME_PROJECT_PREFIX` to reserve a
second nonoverlapping block. Pool startup is bounded to two stacks at a time;
startup failures settle every in-flight operation before owned-stack teardown.

Validation used the existing **Loaded Die equips through the priest inventory menu
into the native orb slot** journey, repeated eight times with `--workers=8`.
All eight passed, with distinct parallel indices 0–7, distinct game/Mongo stacks,
separate ChronAL clocks at the default requested 4x rate, and RTX 5090 rendering.
All original native equipment assertions remained intact. Each test took 11.1–14.4
seconds. The entire invocation took 4.3 minutes including compilation, immutable
artifact preparation, eight fresh game stacks, fixture setup and teardown. This is
a focused concurrency check, not a full-suite run or a serial/parallel benchmark.

Typechecking passed. All 364 evidence files were hash-verified in the standard
report and preserved archive `.build/eight-worker-validation/`. Every owned scenario
workspace and validation container/volume was removed after attachments copied.
The independently running full-suite stack was preserved. The completed candidate
`c415ad11ac9af6e4afecd31e3ca71fbf3b471d11f48eb0c8c613d019e202a84c` matches final
source, was deeply verified, and remains staged without activation.

See [machine-readable results](testing-eight-workers-results.json) for the exact
command, diagnostic environment, worker assignments, GPU renderer, cleanup receipts,
manifest hash and candidate proof. Repeat using that command and environment; verify
the archive with `node e2e/verify-artifacts.cjs .build/eight-worker-validation`.
