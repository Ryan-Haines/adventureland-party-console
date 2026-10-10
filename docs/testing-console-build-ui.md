# Explicit build deployment: browser failure inventory

Before implementation, the browser control must account for these failures:

- A pending or failed build is presented as deployable, or automatic polling starts deployment.
- The confirmation silently selects a newer build after it opens.
- Repeated clicks start concurrent deployments.
- A host restart makes a temporary status fetch failure look like successful deployment.
- The page reloads before its requested deployment is confirmed successful, or reloads for another operator's operation.
- Hidden tabs continue polling, or unmounted controls update React state.
- Error and confirmation controls lose contrast against the dark header/panel.
- Direct development servers and immutable packaged installations receive misleading managed-build controls.

Browser verification should use a real host controller and immutable artifacts, not intercepted browser fetches. The host-level E2E driver should stage two candidates, open the confirmation for the first, stage the second, then confirm the exact first candidate. Retain status responses, deployment ledger, and screenshots of ready, confirmation, progress, and failure states. Verify no deployment before confirmation, exactly one deployment for repeated clicks, recovery from temporary controller unavailability, and reload only after the requested operation succeeds.

`e2e/console-build.spec.ts` declares native process activation as its external service boundary. It uses the maintained store, checksummed artifacts, controller, HTTP routes and browser control. Its local HTTP host forwards other traffic to the normal console fixture without intercepting browser requests. The deferred native driver proves active selection stays unchanged while readiness is pending; a rejected readiness operation verifies durable rollback and the visible error. This browser scenario proves control and protocol behavior; native runtime activation remains covered by host/native integration scenarios.

Focused UI type checking and lint supplement observable browser evidence. No isolated unit tests are required for this control.

The focused browser scenario passed with 36 hash-verified evidence files under `.build/issue79/e2e-results/` and `.build/issue79/e2e-report/`. It additionally verifies a failed rollback retains the durable recovery phase, disables another deployment, and displays the failure reason. Its confirmation screenshot was visually inspected for readable dark backgrounds and explicit action colors. Repeat through the console project with `--grep "completed console builds require confirmation"`.

A real private candidate build also passed with over 1,850 checksummed application files and an independently verified dependency cache. The builder performed private type checks, compilation and an actual production-dashboard HTTP readiness probe before publishing. The isolated smoke store has only a latest reference, so this validation did not activate code or restart the live coordinator. `.build/issue79-builder-ledger.json` records the latest verified candidate ID, component/source hashes and elapsed time; `.build/issue79-build-smoke.mts` is the local repeat driver.
