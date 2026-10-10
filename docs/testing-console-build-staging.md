# Console artifact staging failure inventory

Recorded before implementation. Source edits, generated build outputs and tests
must never replace running code. A candidate must contain a consistent snapshot
of dashboard, coordinator, character and support code; secrets and account state
must never enter it. Rapid edits must coalesce without concurrent compilation.
Failed compilation or readiness must retain both the active console and the last
completed candidate. Changed dependencies must not replace live node_modules.
Restarts must select active, not newest. Deployment must not compile or silently
replace the selected target with a newer candidate. Service respawn must not race
explicit replacement; startup must use immutable support files as well as bundles.

Verify staging with a disposable checkout, source snapshot hashes and process/build
ledgers. Verify browser activation against the real build store/controller and
declared external service boundary. Native E2E must retain actual inventories,
receipt reconciliation, connected roster and character generation observations.
Use isolated reports and game instances when another checkout is testing.
