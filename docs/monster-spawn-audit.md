# Monster spawn catalog audit

Run `node scripts/audit-monster-spawns.cjs <path-to-data.js>` with trusted installed
game data. The read-only command prints JSON for every monster: an independent
scan of raw map records, catalog records with exclusion reasons, and ordinary
route counts. Redirect stdout to a local report when needed.

## Version 15722 findings

The old catalog excluded `unlist` maps. This is a map-listing flag, not an
ordinary-spawn restriction. Removing that exclusion restores these routes:

| Monster | Newly included maps |
| --- | --- |
| pppompom | level2n (two regions, populations 6 and 7) |
| odino, dryad | mforest |
| oneeye | level2w |
| pinkgoblin | level2e (polygon retained) |
| sparkbot, targetron | uhills |
| greenfairy, redfairy, bluefairy | mforest (additional regions) |
| cgoo | level2s, level4 (additional regions) |
| mummy | level3, level4 (additional regions) |
| bbpompom | level3 (additional region) |

Of 129 monsters, 79 now have ordinary locations (previously 72). The remaining
50 are fully accounted for below. These classifications describe static records,
not current live availability or a guarantee that a map can be entered.

- Instance records (20): a1–a8, vbat, spiderbl, spiderbr, spiderr,
  xmagex, xmagefz, xmagefi, xmagen, gpurplepro, gredpro, gbluepro, ggreenpro.
- Ignored maps (2): dknight2, d_wiz.
- Irregular maps (2): mechagnome, jrat.
- Zero-count records outside those categories (4): franky, crabxx, icegolem, rgoo.
  Some instance records also have zero counts; records retain every reason.
- No static map record (22): chestm, nerfedbat, bgoo, cutebee, dragold,
  eelemental, fieldgen0, felemental, goldenbat, goldenbot, ligerx, pinkgoo,
  nerfedmummy, nelemental, rudolph, slenderman, goblin, snowman, tiger, wabbit,
  welemental, zapper0.

Jr. and Green Jr. already have regular map records. Phoenix already has five
cross-map regions; its patrol behavior is unchanged. Cute Bee and Golden Bat
(`goldenbat`) remain passive encounters without invented static destinations.

## Contract and activation

Catalog version 3 adds optional `spawnRecords` to monster choices and bestiary
entries. Records contain `sourceMap`, destination `map`, optional map name,
coordinates, boundary, polygon, count, and `restrictions`. Restrictions use
`ignore`, `instance`, `irregular`, `zero-count`, `missing-map`, and
`invalid-geometry`. All applicable source/destination restrictions are retained.
Existing `locations` contains only eligible routing candidates. Bestiary and
empty area-picker views explain restricted records without navigation actions.
Older payloads without metadata display a refresh message.

Run the repository typecheck, tests and coordinator lint, then use the supported
restart workflow in `runtime/coordinator/README.md`. Building alone does not
refresh connected characters. After activation, verify telemetry reports version
3, Pom Pom has two `level2n` destinations, Phoenix retains five regions, and
restricted records remain informational in the dashboard.
