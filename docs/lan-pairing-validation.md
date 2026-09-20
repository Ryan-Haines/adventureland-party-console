# LAN and optional pairing validation — 2026-09-19

## Implemented behavior

Windows and Docker use the hosting gateway on `0.0.0.0:3010` by default. `AL_HOST`
and `AL_PORT` select the public binding; Compose maps them to the container's
port 3010. `AL_PUBLIC_URL` supports a stable reverse-proxy origin. Internal
supervisor and coordinator ports remain on loopback. Windows retains its mode
file, build controls, terminal account setup, and encrypted session storage.

New access stores default to pairing off. Legacy stores with browser/Steam
credentials or an outstanding invitation remain protected. Explicitly saved off
survives restart even when old credentials exist. Hosting access is separate from
dashboard exports. Enabling pairs the requesting browser; cookie security follows
its validated origin, so HTTP LAN access works alongside a configured HTTPS URL.

## Completed checks

- Typecheck and coordinator runtime build passed. Hosting-module lint and the
  new settings component's lint passed.
- 41 focused hosting, real-jQuery loader/reload, Steam group, and Steam recovery
  tests passed. An additional run passed all seven LAN/cookie/setup-DOM and
  authenticated SSE forwarding tests (overlapping the LAN cases above).
- Tests cover fresh direct access, legacy migration, persistence, both toggle
  directions, lockout prevention, malformed input, foreign origins, unauthorized
  changes, token revocation while off, and WebSocket authorization.
- AMD64 and emulated ARM64 images built successfully. Both passed the
  credential-free smoke runner: setup, prebuilt dashboard HTML, both pairing
  modes, private loader generation/revocation, and restart persistence. No game
  account was supplied to either container. Only disposable test containers and
  their anonymous volumes were removed.
- A stale local `characters/build-history.json` initially broke the clean Docker
  build because generated bundles were excluded. It is now excluded with the
  other local publication metadata.
- Windows was activated with the supported `-CoordinatorOnly` restart. Health,
  setup state, and internal supervisor readiness returned 200. The public LAN
  origin `http://192.168.1.30:3010` served the dashboard and party API. A request
  with that origin exercised build-history inspection, cleanup preview, and
  switching to development. The actual Vite WebSocket upgraded with HTTP 101
  through the gateway. Production mode was restored and confirmed ready.

## Broader-suite and rollout limits

The ordinary `npm test` run stalled with retained handles. A diagnostic run with
`--test-isolation=none --test-force-exit` completed 2,318 tests: 2,259 passed and
59 failed. One failure was the protected SSE fixture assuming that pairing was
always enabled; the fixture now explicitly enables protection and passes in its
focused run. The full suite was not repeated after that fixture correction.
Other failures span existing combat, merchant, UI, and extracted-contract tests;
see also the earlier [failure audit](test-failure-audit-2026-09-19.md). The
nonisolated diagnostic run may also expose shared-fixture interactions. Logs
are retained locally in `.build/lan-suite.log` and `.build/lan-suite-complete.log`.

Lint of the surrounding `party-inventory-panels.tsx` reports two existing errors
at its `result.added` interpolation (`no-base-to-string` and
`restrict-template-expressions`). The newly added hosting control passes lint.

A later process inspection found a different ordinary `--production` launcher
and character watcher after the coordinator-only restart. Character hashes changed
during this shared-workspace activity, so this run cannot claim that all assets
remained unchanged across the entire validation window. No manual character
publication was performed by this change's activation command, and concurrent
character changes were not reverted.

No browser was available through the UI automation tool. Setup mode visibility
was checked with DOM tests; visual contrast inspection in a real browser remains
manual. LAN HTTP and WebSocket checks ran from the server machine, not a second
device. Physical Pi testing and a live Steam-to-remote-host handoff remain manual.

## Second-device acceptance check

1. On another device on the same private network, open the printed LAN URL.
   Check Windows Private-profile firewall access for TCP 3010 if unreachable.
2. Open Interface settings and verify the dark pairing control below ALData is
   readable. With pairing off, verify `/setup` omits browser pairing and, on
   Windows, account setup.
3. Generate a loader using the LAN origin, paste into one Steam character's CODE,
   and verify reload and character switches retain that server address.
4. Enable pairing. Confirm this browser stays authorized, an unpaired browser
   cannot control the dashboard, and a newly generated invitation pairs it.
   Generate and run a private Steam loader.
5. Disable pairing and confirm direct access returns. Revoke private tokens and
   confirm old credentialed loaders fail while a new direct loader works.
6. Restore your preferred pairing policy. For publicly reachable hosting, use
   HTTPS and keep pairing enabled. Never run two coordinators for one account
   during migration.
