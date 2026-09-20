# Docker validation

The latest LAN/optional-pairing rollout, including AMD64 and emulated ARM64 smoke
tests, is recorded in [LAN pairing validation](lan-pairing-validation.md).
The entries below describe earlier protected-by-default releases.

Validated on 2026-09-12 with Docker Desktop's Linux engine. No real game account was supplied to the test containers and no authentication mail was sent.

| Check | Result |
| --- | --- |
| Clean AMD64 image build | Passed |
| ARM64 image build | Passed; build tools run on the builder architecture, runtime dependencies target ARM64 |
| AMD64 and emulated ARM64 startup | Passed |
| First-run browser pairing and rejection of foreign-origin requests | Passed |
| Compiled production dashboard serves HTML | Passed on both architectures |
| Pairing survives container restart | Passed on both architectures |
| Revoked Steam credentials are rejected | Passed |
| Bulk handoff, primary last, headless CODE confirmation, recovery queue | Regression tests passed |
| X confirmation and stationary minimize control | DOM tests passed |
| Public game-file discovery | Downloaded and syntax-validated client 15650 without logging in |
| Failed helper download preserves complete cache | Regression test passed |
| Mail cost | 48,000 gold read from the current client's translated markup; unknown formats return no estimate |
| ALData mail preparation | Opens a draft; no paid-send request until the user confirms |
| TypeScript checks and new hosting-module lint | Passed |

Run the container acceptance checks again after changes:

```sh
docker build --platform linux/amd64 -t adventure-land:headless-test .
node tools/hosting/smoke.mts adventure-land:headless-test
docker build --platform linux/arm64 -t adventure-land:headless-arm64-test .
node tools/hosting/smoke.mts adventure-land:headless-arm64-test
npm test
npm run typecheck
```

ARM64 execution on an AMD64 host needs Docker ARM emulation. The smoke script creates and removes only its own credential-free test container and volume. The normal Compose data volume is untouched.

## Remaining validation

- Physical Pi hardware, memory/CPU benchmarking, and an overnight soak test remain to be performed.
- A controlled live Steam-to-Pi handoff and real multi-device LAN browser test remain to be performed. The automated tests verify the protocol, origins, serving, and persistence; they do not establish behavior of every Steam/browser networking policy.
- Repository-wide lint is not clean: older dashboard compiler/accessibility findings and runtime complexity findings remain. The newly added hosting modules pass lint, and new dashboard lint findings from this change were resolved.
- Keep the previous host stopped during migration; do not test a second coordinator against the same live account concurrently. See the README for the migration sequence.

## Coordinator TypeScript refactor validation

Fresh Linux AMD64 image `adventure-land:coordinator-refactor` builds with the maintained coordinator launcher and simplified installer. Credential-free health, pairing, dashboard startup and credential persistence pass. All 11 source/bundle/launcher heartbeat checks pass inside the image, including explicitly absent merchant and null server reports. The combined host suite passes 1,486 tests. This run did not repeat ARM64 or physical Pi validation.
