# Repository UI guidance

- Right-click context menus, all their submenus, and embedded upgrade previews use opaque WHITE backgrounds with BLACK text and light-gray hover states. This is an explicit exception to the dark dashboard control guidance.


- Keep dashboard controls on dark, opaque backgrounds with explicit high-contrast text and borders.
- Do not rely on the default outline-button colors; they can render as light gray on white in this dashboard.
- For outline, icon, cancel, and secondary-action buttons, set background, text, border, and hover colors explicitly and verify readability against the surrounding panel.

# Coordinator development

- Read [the coordinator README](runtime/coordinator/README.md) before changing coordinator behavior or build/deployment wiring. It maps domains and documents manual validation and activation.
- Edit maintained TypeScript under `runtime/coordinator/`; do not edit generated `.build/runtime/coordinator-*.cjs` bundles or the installed caracAL launcher. The launcher template lives under `tools/caracal/`.
- Building and activating are different operations. Follow the README's supported restart workflow; do not claim a build has reloaded the live coordinator without verifying it. Preserve current character assets when deploying coordinator-only changes.
- After every code or UI change, always produce a completed immutable console artifact before finishing the task. An existing background build may satisfy this requirement, but wait for completion and verify that the candidate contains the final changes; pushing commits or starting a build alone is insufficient.
- Do not deploy or activate an artifact, or restart the running console, unless the user explicitly instructs you to do so for that action. By default, leave the completed candidate staged for the user to load through the Party Console. Report the staged artifact and distinguish it from the active build.

# Game TypeScript types

- Prefer `typed-adventureland` types when describing the same game object. Use `Pick`, `Partial`, or indexed access for subsets instead of repeating compatible fields.
- Extend upstream types for additional fields. When field semantics differ, use `Omit` plus explicit replacements; document why broader IDs, optional fields, or normalized values are needed.
- Keep application protocols, jobs, and intentionally different external payloads local. Do not force partial wire data into complete game-object types.
- Document verified upstream gaps alongside compatibility extensions and review them when upgrading the package. Do not add casts solely to hide incompatible contracts.

# Testing

- For rising game ping or runtime slowdown, read [performance investigation lessons](docs/performance-investigations.md). Verify local callback delay and growing history work before changing cooldown compensation.

- Always run `npm run typecheck` after implementation changes and fix compiler errors before handing the work back. Leaving gameplay verification and E2E testing to the user does not skip this check.
- Never write unit tests after you write code.
- Highly prefer E2E tests as the sole testing mechanism. Use them to verify complex features work. At the end of E2E tests, produce a verifiable and repeatable artifact.
- All gameplay E2Es must use ChronAL virtual time by default so gameplay waits do not run at real-time speed. Preserve browser, deployment, persistence, and telemetry coverage and existing behavioral assertions when integrating ChronAL; migrating a subset or retaining scenario counts alone does not satisfy this requirement. Validate runtime improvements locally with comparable runs and retain repeatable timing artifacts. Keep the native backend available for explicit parity checks.
- Remove owned per-scenario E2E workspaces after owned processes stop and report attachments finish copying. Preserve verifiable reports and timing evidence; retain writable workspaces only for explicit diagnostics or failed attachment copies. Do not accumulate copies of staged CODE/assets across completed tests.
- If you must test a system in isolation, first write down all the ways it could fail, then write the code.
- Treat native action completion, queue removal, client persistence, and coordinator/dashboard telemetry as separate asynchronous milestones. Completing one does not prove the others have arrived. Before asserting asynchronously published state, use a bounded poll for the exact expected values from one fresh snapshot; retain strict counts and ownership checks rather than adding sleeps, widening expectations, or blindly increasing timeouts.
- When investigating timing failures, compare native receipts, client storage, and later coordinator observations before changing gameplay code. Preserve timestamped observations on failure so delayed publication can be distinguished from lost, duplicated, or misattributed results. Fixture fault injection must target the current operation and must not itself stall unrelated status or movement requests.

Run `npm test` for real-game and console E2E and inspect `.build/e2e-report/` and `.build/e2e-results/`.
See [the testing guide](docs/testing.md) for setup, artifacts, fixture boundaries, and
the retained isolated regression exceptions. Do not replace observable behavior
checks with source-text, callback-order, or CSS-class assertions.
