# Expanded map capture

Failure inventory before implementation: a capture can use newer coordinates
than its pixels, identify a full-floor view with a character's coordinates,
capture the collapsed canvas, lose its footer when saving the image, fail on
cross-origin sprite/terrain images, or be blocked by a popup blocker. Snapshot
the already drawn canvas and its actual camera center synchronously on click;
burn map and center into the PNG footer. Open the tab in the click handler and
show a readable error if image export is unavailable. Validate both character
and full/native-size Cave views with browser E2E and retain the PNGs.

The live Adventure Land image host's Dreams PNG response has no
Access-Control-Allow-Origin header. Cross-origin anonymous loading alone would
therefore hide existing terrain. Map images from that fixed host use the
dashboard's same-origin image route; local debug assets retain their existing
route. Other declared CORS-enabled image sources remain usable. Capture tests
must exercise the same-origin route as well as external CORS images.

Repeat the focused browser check with:

```powershell
npm test -- -- --project=console --workers=1 --grep "expanded character and Cave maps capture"
npm run test:e2e:verify
```

The passing run retains three PNG captures and a ledger proving identical map
pixels, correct footer dimensions, visible footer text, and the camera center
for each view. It also retains the actual native Dreams tileset response and
verifies that the image route rejects external hosts. The preserved local
evidence is in `.build/map-capture-passing-results/` and its report in
`.build/map-capture-passing-report/`.
