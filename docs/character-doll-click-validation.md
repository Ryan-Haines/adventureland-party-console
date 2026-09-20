# Character doll click reliability — 2026-09-14

The stats trigger recreated its `dangerouslySetInnerHTML` object whenever the
character card received live updates. The installed React DOM implementation
compares that prop by identity and assigns `innerHTML` again, replacing portrait
descendants. Replacement during a press/release sequence is a likely explanation
for intermittent missed clicks; it has not been reproduced in a browser here.

The portrait is now a memoized component receiving appearance-only inputs. Its
HTML object is memoized separately so reconstructed sprite metadata cannot cause
unchanged HTML to be reassigned. The decorative subtree disables pointer events
and image dragging, leaving the persistent outer button as the click target even
when appearance changes. Stats retain local open state and live cache data. The
popup has an explicit return-focus reference and a high-contrast close button.

Validation completed:

- Seven targeted tests passed across dashboard-character-stats,
  dashboard-doll, and dashboard-query-render.
- Tests verify stable markup identity and button identity during vitals updates,
  genuine outfit changes, sprite fallback dimensions, fresh stats on reopening,
  live equipment, observer cleanup, and opening without network requests.
- Repository typecheck and lint of the three changed UI components passed.
- The dashboard supervisor built and activated production successfully. Its
  instance changed from `12635692-c863-416c-b5b4-ea322734b48f` to
  `e054eb2e-9c2b-4c60-99d9-4018aa8b9a0b`, with ready true and no error.
- The page returned HTTP 200; all 29 directly referenced JavaScript assets were
  fetched successfully and the served bundle contained the portrait fix.

No browser surfaces were connected. Component tests do not verify browser DOM
identity, pointer dispatch, focus behavior, visual contrast, or painted latency.
Those checks remain outstanding: press/update/release with unchanged and changed
appearance; mouse, touch, Enter, Space, Escape, close and focus return; Qwentina
and the other dolls with maps active, targeting zero misses in 100 openings and
95th-percentile click-to-visible latency below 100 ms. No measured latency or
browser success-rate improvement is claimed.

Activation used only the dashboard supervisor's production-mode endpoint. It did
not restart character/coordinator services or publish character assets.
