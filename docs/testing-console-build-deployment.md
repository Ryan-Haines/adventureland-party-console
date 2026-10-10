# Console candidate deployment failure inventory

Specify observable console/native E2E journeys before implementation. No new isolated tests are planned.

- A source edit, burst of edits, new/deleted dependency or build failure must not publish live code. Failed or inconsistent snapshots never become completed candidates.
- Deployment must use the requested completed ID even if a newer build appears. Invalid IDs, missing files, changed hashes, redirected paths and concurrent operations are rejected before activation.
- Dashboard startup, coordinator restart, character reload or readiness can fail or time out. Restore the prior code candidate, retain current durable game state, and report rollback failures explicitly.
- Process termination can occur before activation, during readiness, after readiness or during reference publication. An incomplete durable journal restores its prior candidate on startup; active/latest are distinct durable references.
- Retention beyond twenty completed candidates must preserve active, previous, journal and live-process pins. Cleanup and completion serialize; dead lock owners must not block future operations and live owners must not be stolen.
- Unsupported mutable state and secret files never enter the artifact. Rollback switches only executable assets, never account/configuration/storage files.
- Authenticated browser status and exact-ID deployment routes must preserve existing gateway authorization and reject malformed or oversized mutation requests.

Retain candidate manifests/hashes, deployment records, active/latest observations, browser screenshots and fresh native acknowledgements in `.build/e2e-report/` and `.build/e2e-results/`; run `npm test` and verify artifact integrity. Include Windows, Linux and Docker-development launch boundaries. Immutable release images continue using their distribution updater.

## Repeatable deployment evidence

Run the console deployment browser journey and the deployment-process scenario through `npm test` with the relevant Playwright title filter. Preserve the report/results manifest and verify it with `npm run test:e2e:verify`. The process scenario uses disposable artifact/store directories and readiness observations; it must not alter a developer's live coordinator or account state.

Capture the exact requested candidate ID, pre/post active/latest/previous references and terminal deployment journal for each successful, failed and interrupted operation. Record hashes before deployment and after rollback, plus current-state sentinel values demonstrating that rollback did not restore old data. Dependency corruption must fail full verification while ordinary status polling reads only validated manifest metadata. Produce retention evidence listing twenty retained completed generations plus every active, rollback, in-flight and live-process pin, and the dependency cache IDs reachable from those generations.

Readiness drivers must stop adding activation work when their abort signal fires. A timeout rejects readiness and rolls back; it must not permit a late readiness callback to publish the timed-out candidate. Native verification observes the actual acknowledged component revisions after reconnect, rather than process spawn or callback ordering.

## Source startup and history commands

Windows `scripts/start-console.ps1`, native source `tools/hosting/native.mts` and the Docker-development entrypoint resume the durable active candidate. Source startup does not run the old character publication watcher or publish source bundles. The first managed startup may build one bootstrap candidate when no active candidate exists. Legacy Windows restart/mode switches remain accepted, and native `--production` still uses managed source candidates; immutable release images keep their updater.

Use `npm run builds -- list` for completed console history, `npm run builds -- deploy console ID` (or `rollback console ID`) to activate an exact completed artifact, and `npm run builds -- resume console` to request latest. CLI deployment goes through the same authorized host route as the browser. `AL_CONSOLE_URL` selects a host and `AL_CONSOLE_BROWSER_TOKEN` supplies an already-issued paired browser credential where pairing is enabled. `npm run builds -- clean console --apply` keeps twenty completed candidates plus durable and live pins, and removes only unreferenced dependency caches. Legacy independent game/dashboard history streams are unavailable after migration to managed candidates.

## Process journey boundaries specified before test implementation

`console-build-host.spec.ts` exercises real immutable artifact launchers, HTTP readiness, the production dashboard proxy, complete-candidate store, deployment driver and controller. Its small executable coordinator/dashboard servers represent an explicit external native/Vinext boundary; their identity responses certify selected executable files and process readiness, not native gameplay or production compilation. Durable data resides outside their artifact directories.

Failure cases: an exited dashboard candidate must restore prior executable behavior; a deployment must remain exact when latest advances; a normal process restart must read active rather than latest; a killed controller after its journal is written must recover the prior executable and preserve a current-state sentinel; a dead lock owner must not prevent recovery; pruning after more than twenty completed candidates must retain active/previous/live pins and later release the live pin; changed executable bytes must reject full verification. Each journey attaches process/HTTP identities, references, journal, manifests and retained IDs for repeatable inspection. Child processes are owned by the disposable test and terminated in teardown; no real account or live coordinator is used.

The retention journey also uses small real shared dependency caches: active, previous and live candidate dependencies must survive cleanup; releasing the live candidate makes its otherwise unused cache removable. Changed cache bytes must reject deployment verification while cache markers remain unchanged. Known candidate dependency junctions may be removed without following or modifying the shared cache they reference.

The executable dashboard boundary also offers a declared crash endpoint. Kill the selected dashboard process after a newer candidate exists; observe a new process identity serving the same active artifact without deploying latest. This checks real child-exit recovery and HTTP behavior, not mocked exit callbacks.

Native host package resolution uses a separate real Node process with a declared installed native executable. Its external package must come from the selected artifact's `.caracal/node_modules` even when the installed host has a different package version. Relative native configuration and built-in modules must keep their normal host resolution. The fixture certifies the preload/package boundary, not game behavior or native library compatibility.

## Host controller activation scope

The title action activates the selected dashboard, coordinator/native executables and character assets immediately. The deployment/build controller is the stable control plane for that running host; its own implementation changes take effect on a deliberate host restart. The thin source bootstrap verifies the durable active artifact and imports that artifact's managed host implementation, so restarting an older active build does not load unactivated controller source changes. First setup uses the installed bootstrap implementation because no active artifact exists yet. Controller files remain in complete artifacts for restart/rollback reproducibility, but their deferred activation does not count as a changed gameplay coordinator component.
