# Adventureland Party Console distribution

The public home is https://github.com/ryan-haines/adventureland-party-console.
Gitea remains the private development repository. Public releases have their own
history, starting at 1.0.0, with one reviewed Conventional Commit per promotion.

## Windows: editable, without global tools

Download the Windows x64 ZIP from GitHub Releases, extract it to a writable folder,
and double-click `Start.cmd`. First startup downloads a checksum-verified private
Node runtime from nodejs.org. There is no Git installation or manual npm step.
Open http://localhost:3010 and connect your game account through setup.

The application source is in `app`, or the directory named by `active.json` after
an update. `Develop.cmd` prepares the development dependencies and watches character
source changes. Stop the console before rebuilding coordinator/dashboard code.
Production dashboard rebuilds must use `AL_DASHBOARD_OUT_DIR=.build/container`.
Source modifications block managed installation until reconciled; downloading a
release never overwrites your edits. Keep custom work in your own branch or copy.

Settings, credentials, game caches, and logs live in `data`, outside application
versions. Keep that folder private. The launch scripts and private runtime stay
outside replaceable versions; a release requiring a new updater protocol requires
a manual installer upgrade. Do not run two installations for the same characters.

## Docker

Download `compose.yaml` from GitHub Releases and run `docker compose up -d`.
The image supports Linux AMD64 and ARM64. The `party-data` volume survives updates.
The updater companion has Docker socket access and can replace the console
container; it exposes no host port. Only its authenticated, fixed release actions
are available to the application. Users managing containers externally can omit
the companion and AL_UPDATER_URL; the dashboard then provides notifications only.

For an existing source-build Compose installation, keep its project name and
existing volume when adopting the release Compose file. Do not silently accept a
new project name, which would create an empty volume. Back up the old volume first.
Custom source mounts and edited application containers require manual updates.

## Update behavior

A green ! beside Party Console announces a newer compatible stable release. Click
it to reach the bottom of settings. Download and install stages the update;
Restart now pauses work and applies it. Characters that cannot safely acknowledge
within 60 seconds defer installation. The dashboard reconnects after restart.

Automatic updates default off. When enabled they download during a running
session and wait for Restart now; on startup they install before characters start.
Checks run at startup and every six hours. Failed network checks leave the current
version usable. Drafts and prereleases are never offered.

Before switching, the updater snapshots persistent settings and credentials while
services are stopped. Candidate startup holds character launch until the dashboard
health check passes. Failed pre-launch validation restores the previous code and
snapshot. Once characters resume, state is not rolled back: game transactions may
already have happened. Backups are private files under `data/updates/backups`.

## Promoting private development

Commit the selected work on Gitea first. Run:

```sh
node tools/release/promote.mts <commit> "feat: describe the user-visible release"
```

This stages an independent public checkout in `.build/public-release` and prints
its diff. Review it, then commit and push from that checkout. The optional `--push`
does those final steps for an already reviewed promotion. Never mirror-push the
private repository: that would expose private branches/history and overwrite tags.
Future promotions update the same public history and preserve GitHub release tags.

Use `fix:` for patch releases, `feat:` for minor releases, and `feat!:` with a
`BREAKING CHANGE:` explanation for major releases. Ordinary documentation/chore
commits do not publish. GitHub Actions validates, determines the next version,
builds Windows and multi-architecture Docker artifacts, then semantic-release
publishes their checksummed manifest and release notes. No npm package is published.

The workflow uses the repository GITHUB_TOKEN with contents/packages write access.
Make the GHCR package public for anonymous pulls and permit the workflow to push
release tags. A fresh public repository does not include the private Gitea history.
Release workflows require a supported Node version independently of the developer
runtime. Stable source releases contain no sessions, downloaded live game caches,
local state, or secrets; game fixtures retain the notices in THIRD_PARTY_NOTICES.md.
