# Coordinator refactor completion audit

The installed `.caracal/standalones/CharacterCoordinator.js` is the maintained
363-byte CommonJS launcher. It matches `tools/caracal/CharacterCoordinator.cjs`
byte-for-byte. Coordinator implementation and composition live in strict
TypeScript under `runtime/coordinator/`.

## Requirements and evidence

| Requirement | Current evidence |
| --- | --- |
| Extract every coordinator section into TypeScript | Installed entry contains only bundle loading and platform injection; `application.ts` composes the extracted domain modules. No legacy coordinator implementation is installed. |
| Preserve functionality | 1,486 combined regressions pass, including persisted-state characterization, command and heartbeat contracts, event/Hunt return behavior, merchant/BankBoi flows, startup ordering and shutdown. Source fixtures derive from maintained TypeScript. |
| Strict typing | `npm run typecheck` passes for runtime, tools and dashboard; runtime enables `strict`. No `any`, ts-ignore or ts-nocheck in coordinator TypeScript. Raw HTTP payload casts remain explicit trust boundaries. |
| Low complexity and readable code | Whole coordinator lint passes with maximum cyclomatic complexity 10; modules and launcher are formatted. Named helpers separate eligibility, acknowledgements, transitions and external I/O. |
| Windows start-caracal compatibility | Existing build-before-start path retained; isolated installer converts legacy hosts and safely reinstalls the launcher. Launcher-to-real-bundle and heartbeat tests pass locally. Live Windows coordinator reload succeeded. |
| Docker compatibility | Fresh Linux AMD64 image builds through setup, installation and runtime compilation. Credential-free health, pairing, production dashboard and credential-persistence smoke checks pass. All 11 launcher/source/bundle heartbeat integration tests pass inside the image. |
| Maintainable build/install flow | Runtime build emits application/policy bundles with TypeScript source maps. Installer stages and syntax-checks the launcher and runner, checks originals before replacement, and retains backups. Obsolete coordinator text-rewriting tools are removed; separate runner compatibility remains. |
| Activated and healthy | Guarded publication installed the launcher and synchronized the compatibility patch. Current character assets were preserved. GDroidPT, QwenTina, GermanicHP and GoldMajesty reported alive with status ages below one second; merchant naturally returned to stand. |

Final combined log: `.build/coordinator-maintained-source-tests.log`.
Final container build log: `.build/coordinator-docker-build.log`.
Validated image: `adventure-land:coordinator-refactor`.

## Preserved boundaries and limits

- Shared legacy JavaScript services remain external dependencies with explicit
  TypeScript consumer contracts; this refactor does not rewrite those services.
- HTTP ingestion retains the existing permissive payload boundary. Explicit null
  server reports pass source and bundle integration tests without a fabricated realm.
  The inherited grouped-combat failure for an omitted server and no initial target
  remains characterized in `grouped-cohesion.test.cjs`; changing that behavior is a
  separate bug fix, not part of an identical-functionality refactor.
- Configuration now passes `AL_DATA_URL` and configured merchant/null directly,
  replacing obsolete setup string substitutions. Saved merchant selection retains
  precedence. No-merchant guards prevent null worker restarts or empty-slot swaps.
- Live checks establish startup and fresh reports, not an exhaustive replay of
  every event. Container checks use no game account; ARM64 hardware and overnight
  gameplay soak were not repeated for this refactor.
- No commit or push was requested for this work.

See [README.md](README.md) for the source map and normal development workflow.
Earlier migration checkpoints in [MIGRATION-HISTORY.md](MIGRATION-HISTORY.md)
describe historical states, not remaining work.
