# Pinned game fixtures

These gzip-compressed JSON maps contain the official client scripts and script
manifests already used by the regression suite for Adventure Land versions 16846
and 17083. The source is https://adventure.land. Upstream notices remain in the
files. No account configuration, credentials, saved state, or logs are included.

Each archive contains only `client_scripts.json` and the scripts named by that
manifest. `manifest.json` records the SHA-256 digest and file count. These are
test inputs, not published character assets or an installation of the live game.

Restore with `node scripts/ci/restore-game-fixtures.cjs [destination]`. The default
destination is `.caracal/game_files`. Restoration validates all archives before
writing, reuses identical files, and refuses to overwrite different existing
files. Use a clean checkout for CI; do not clear a live cache to make this pass.

The suite intentionally tests historical geometry and native client behavior.
Fetching current upstream scripts with an old `?v=` query is not a substitute
for these exact bytes. To update fixtures, review the affected geometry and
native-engine assertions, archive only manifest-listed scripts from the intended
version, update the checksums, and run the full suite in a clean checkout.
