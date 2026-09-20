# Party console polish validation — 2026-09-13

Implemented healthy-connection label removal, connected party gold totals, full-content-width location maps, a 20 FPS location renderer, and a single Steam monitor action. The roster picker retains its explicit-primary operation.

Gold uses active slots, deduplicates names, excludes offline/failed slots and BankBois, and includes the active merchant. Only gold is selected from each live vitals query. Missing balances remain unknown; zero remains zero. Tooltips contain exact bank, carried, and combined values and explain that observations can have different sampling times.

Location maps keep the existing 4:3 embedded viewport. Both edges now share the card content padding. Embedded and enlarged views use one stream, definition query, and mutable frame buffer. The covered embedded renderer stops; hidden tabs close their stream and stop rendering. Map changes reset interpolation, and a definition/frame mismatch clears the canvas. ResizeObserver caches dimensions; prepared placement bounds and group depths eliminate repeated setup, and repeated-tile loops visit only the viewport. Farming previews retain their uncapped scheduling. Runtime telemetry was not changed.

Validation:

- Full `npm test`: 1,576 passing tests, zero failures.
- Expanded `party-console-polish.test.cjs`: six passing tests, including React gold subscription isolation, membership/unknown/zero balances, health status, all four Steam monitor states, cancel, changed-primary confirmation, failed request, duplicate submission, renderer lifecycle, mismatched definitions, tile bounds, and map interpolation reset.
- `npm run build`: passed, including repository typecheck and production dashboard build. Existing Vinext ineffective-dynamic-import warnings remain.
- Changed dashboard code lint: passed with the dashboard's `.oxlintrc.json`.
- Synthetic 60 Hz, ten-second scheduler: one map draws 200 times instead of 600; four maps draw 800 times instead of 2,400. This measures scheduler decisions, not browser draw duration or CPU.

Activation used the existing dashboard supervisor's production-mode operation. It built and activated a new dashboard instance without restarting party services or publishing character assets. Supervisor state returned production, ready, and no error with a changed instance ID. The page returned HTTP 200; 29 referenced JavaScript assets were fetched successfully, including the updated console code.

A four-second read-only stream check received 153 dashboard messages and 28/29/31/29 map messages across the four active characters. Arrival estimates were 9.2/9.3/9.9/7.2 Hz over the interval between first and last message; these short observations are not a controlled before/after traffic benchmark. Server samples remain independent of the 20 FPS drawing cap.

No browser surfaces were connected to the available browser tool. Narrow/wide visual margin verification, real one/four-map draw durations, browser CPU, and a controlled before/after traffic comparison were therefore unavailable. No measured CPU reduction is claimed. Steam actions were exercised through mocked callbacks rather than switching the live party during validation.
