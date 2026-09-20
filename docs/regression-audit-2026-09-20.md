# Regression audit - 2026-09-20

The fresh baseline was 2,361 tests: 2,305 passed and 56 failed, with zero skips or cancellations. The previous 2,322-test report had 58 failures; collection eligibility and collection priority now pass without changes in this repair.

## Classification

The 56 baseline failures came from obsolete test contracts, incomplete extracted-function fixtures, or brittle selectors. No production behavior was reverted to match them. Restoring dependencies exposed further stale expectations for collection-only dispatch, cached appearances, protection checkpoints, and the lucky-upgrade service fixture; those were repaired while preserving safety assertions.

Two independent production bugs were reproduced and fixed during the requested buy-order audit:

- An inline price edit could resend an old quantity and turn six remaining purchases back into ten. Field-specific edits now preserve the current server-side remainder unless quantity itself is edited.
- Priority edits used the preferences-only path, which intentionally preserves priority. Both dashboard priority controls now use explicit priority edits, including clearing an override.

Field edits carry the existing order revision and cannot resurrect completed/cancelled orders or edit a replacement order. Existing creation and preference APIs remain compatible. Tests cover the actual dashboard callbacks through the real bid route, partial fills, duplicate reports, reload counter recovery, and a ten-scroll budget shared by native stand fills and shopping.

The observed vitality-scroll order had ten remaining and zero acknowledged native fills. Retained activity contained banking/crafting records, but did not establish the origin of the reported 344 scrolls. The price-edit bug is a confirmed overbuy risk, not proof of that inventory's provenance. No live order, inventory, character assets, or running services were changed by this repair.

Native receipt fixtures use the `trade_sell` UI payload (`buyer`, `seller`, `slot`, and item quantity/price) emitted by the [upstream game server](https://github.com/kaansoral/adventureland_mongodb/blob/main/node/server.js). Missing slots alone remain insufficient evidence of a purchase.

## Failure-by-failure disposition

| Test file | Baseline failing case | Repair/evidence |
|---|---|---|
| `auto-stand-banner.test.cjs` | Auto Stand follows item identity through bank and inventory transfers without requiring a listing | Current Auto stand casing; preserve identity and price assertions. |
| `combat-movement.test.cjs` | latest visibility, claims, map, death, ownership and reload block attacks | Timer mock accepts absent handles, as the real clearInterval API does. |
| `coordinator-account-character-actions.test.cjs` | account guards prevent paid creation and occupied deletion before loading transport; confirmed deletion persists | Supply a valid BankBoi prefix before testing the capacity guard. |
| `coordinator-dispatch.test.cjs` | all own and party merchant commands preserve the pre-extraction wire contracts | Remaining-output compound rules, processing routine, and collection-only fighter pickups. |
| `coordinator-heartbeat.test.cjs` | source coordinator handles first and repeated heartbeats without a current combat target | Versioned passive hunting and passing-encounter response fields. |
| `coordinator-heartbeat.test.cjs` | bundle coordinator handles first and repeated heartbeats without a current combat target | Versioned passive hunting and passing-encounter response fields. |
| `coordinator-merchant-completion.test.cjs` | merchant completion: successful receipts and stat-scroll equipment merge | Automatic rules remain active; delivered equipment stays reserved until confirmed equipped. |
| `coordinator-merchant-delivery-actions.test.cjs` | delivery composition preserves all recorded completion receipts, retries and side-effect order | Retained delivery reservations and real queue composition for deferred work/IDs. |
| `coordinator-merchant-delivery-actions.test.cjs` | mail and deferred improvements share the live command counter and completion uses the current inbox | Retained delivery reservations and real queue composition for deferred work/IDs. |
| `coordinator-public-state.test.cjs` | all dashboard state sections preserve their pre-extraction response contracts | Explicit merchantRules, passiveHunting, and cached characterAppearances fields. |
| `coordinator-state-factory.test.cjs` | typed state factory preserves the complete legacy initialization and clock evaluation order | Explicit production, merchantRules, and passiveHunting defaults; retain legacy parity and clock-order checks. |
| `dashboard-state-import.test.cjs` | Settings import previews a file before confirmation and shows its canonical path and backup | Include the new export-button dependency in the import-focused render fixture. |
| `deconstruction.test.cjs` | executor visits Craftsman, claims, dismantles, acknowledges, then finishes | Load the actual protection checkpoint before testing destructive operations. |
| `emergency-cleanout.test.cjs` | emergency cleanout protects supplies and tracktrix and orders remaining categories | Load real available-craft-stock protection for handoff selection. |
| `emergency-cleanout.test.cjs` | manual and automatic marks precede extras; spare capacity cleans beyond emergency relief | Load real available-craft-stock protection for handoff selection. |
| `emergency-cleanout.test.cjs` | a capacity-limited pickup does not request another visit once emergency clears | Load real available-craft-stock protection for handoff selection. |
| `emergency-cleanout.test.cjs` | remaining emergency may retry, but a stale cleanout leaves unmarked items alone | Load real available-craft-stock protection for handoff selection. |
| `emergency-cleanout.test.cjs` | all marked pickups run before emergency extras, even after enough slots are free | Load real available-craft-stock protection for handoff selection. |
| `emergency-cleanout.test.cjs` | cleanout protects explicitly marked supplies and live locked items too | Load real available-craft-stock protection for handoff selection. |
| `event-selections.test.cjs` | browser timezone formats the event instant without changing its countdown | Current unknown-time label and Settings icon dependency. |
| `event-selections.test.cjs` | dropdown disables inherited and unsupported selections and permits independent choices | Current unknown-time label and Settings icon dependency. |
| `fringe-targeting.test.cjs` | queue filters claims and path exclusions before choosing zone, while passive rares remain available | Load actual passing-encounter predicates with empty initial ownership. |
| `goobrawl-live-combat.test.cjs` | arena monsters remain allowed with boar focus and an empty event target cache | Load actual passing-encounter predicates for arena targeting. |
| `hunt-route-acquisition.test.cjs` | real grouped lock permits travel nomination and handoff but still gates attacks | Load actual passing-encounter predicates; retain claims, travel, and safety assertions. |
| `hunt-route-acquisition.test.cjs` | grouped hunt scan retains safety, chooses a new nearest candidate, and rate limits rejection logs | Load actual passing-encounter predicates; retain claims, travel, and safety assertions. |
| `hunt-selector.test.cjs` | Hunt remains clickable and explains blacklist fallback after returning to Auto | Import actual passive-settings migration instead of returning a string from a catch-all mock. |
| `hunt-selector.test.cjs` | active Hunt still shows its current progress | Import actual passive-settings migration instead of returning a string from a catch-all mock. |
| `hunt-selector.test.cjs` | ordinary farming without Hunt history does not show an empty Hunt panel | Import actual passive-settings migration instead of returning a string from a catch-all mock. |
| `hunt-selector.test.cjs` | backup status shows batch readiness instead of three-minute turn-in advice | Import actual passive-settings migration instead of returning a string from a catch-all mock. |
| `item-operations.test.cjs` | placeholder remains pending even when queue proxy disappears before the result | Load production journaling and observed upgrade implementation before testing confirmation. |
| `merchant-exchange.test.cjs` | token catalog includes every currency, bundles, and cosmetic reward identifiers | Load actual reward-catalog and protection-checkpoint dependencies. |
| `merchant-exchange.test.cjs` | 40 level-less leather is withdrawn and delivered for one exchange | Load actual reward-catalog and protection-checkpoint dependencies. |
| `merchant-exchange.test.cjs` | confirmed exchanges checkpoint remaining work before returning to bank | Load actual reward-catalog and protection-checkpoint dependencies. |
| `merchant-exchange.test.cjs` | auto-bank errands cannot redeposit materials reserved for this exchange | Load actual reward-catalog and protection-checkpoint dependencies. |
| `merchant-npc-sales.test.cjs` | partial sales retain confirmed IDs and report interruption at top level | Load actual protection checkpoint; retain interruption, lock, and quantity assertions. |
| `merchant-npc-sales.test.cjs` | sale rechecks lock and quantity after travel | Load actual protection checkpoint; retain interruption, lock, and quantity assertions. |
| `merchant-stand-sync.test.cjs` | stand sync passes active ownership, performs listing, and reconciles before completion | Load journal recovery, assert protection checkpoint before completion, and inject the live lucky-upgrade service for recovery failure. |
| `merchant-stand-sync.test.cjs` | stand-return commands bypass pre-dispatch recovery; other commands still require it | Load journal recovery, assert protection checkpoint before completion, and inject the live lucky-upgrade service for recovery failure. |
| `merchant-stand-sync.test.cjs` | optional tidy failure reports recovery without claiming the stand return failed | Load journal recovery, assert protection checkpoint before completion, and inject the live lucky-upgrade service for recovery failure. |
| `party-console-polish.test.cjs` | Steam monitor joins, promotes, ignores primary, cancels, rejects changed confirmations, handles failure and duplicate submission | Locate Steam control by accessible label instead of its old button index. |
| `party-loader.test.cjs` | missing shared dependency fails before installing any combat timers | Provide the complete timer API for stop-before-start teardown. |
| `priest-formation.test.cjs` | Default defense requires one shared target; local attackers cannot nominate independently | Load actual passing-encounter predicates; retain shared-target ownership assertions. |
| `priest-formation.test.cjs` | party attackers block an untouched shared nomination but never its confirmed engagement | Load actual passing-encounter predicates; retain shared-target ownership assertions. |
| `queue-markers.test.cjs` | selected cooperative event boss stays attackable and yields a single red marker outside grouped farming | Load actual passing-encounter predicates; retain cooperative-event marker assertion. |
| `rare-hunting-client.test.cjs` | All optional rare monster sightings are reported to the passive controller | Explicit enabled sighting rules and actual passing-encounter predicates. |
| `rare-hunting-client.test.cjs` | inventory changes fail deployment safely, and field confirmation releases only basic attacks | Explicit enabled sighting rules and actual passing-encounter predicates. |
| `rare-hunting-client.test.cjs` | hidden field generators are reported without dashboard map subscriptions | Explicit enabled sighting rules and actual passing-encounter predicates. |
| `rare-hunting-client.test.cjs` | grouped rare uses shared combat movement even when unseen; Fairy lock still permits basic attacks | Explicit enabled sighting rules and actual passing-encounter predicates. |
| `rare-hunting-ui.test.cjs` | passive checkboxes send one boolean setting without replacing the other | Test delegation to the current per-monster rule menu and independent patches. |
| `travel-defense-client.test.cjs` | travel rejects a passive retained bee but allows a current follower attacker; grouped=false | Load actual passing-encounter predicates; retain live attacker and passive-target distinctions. |
| `travel-defense-client.test.cjs` | travel rejects a passive retained bee but allows a current follower attacker; grouped=true | Load actual passing-encounter predicates; retain live attacker and passive-target distinctions. |
| `travel-defense-client.test.cjs` | local travel departs with a retained passive target and waits only until a live attacker disengages | Load actual passing-encounter predicates; retain live attacker and passive-target distinctions. |
| `travel-defense-client.test.cjs` | explicit hunt acquisition bypasses travel and destination gates while retaining claims and failed approaches | Load actual passing-encounter predicates; retain live attacker and passive-target distinctions. |
| `unfinished-target-boundary.test.cjs` | exact unfinished monster remains eligible outside farm bounds and focus | Load actual passing-encounter predicates; retain exact identity, claims, realm, and instance boundaries. |
| `unfinished-target-boundary.test.cjs` | boundary exception never permits another neutral pull or a claimed monster | Load actual passing-encounter predicates; retain exact identity, claims, realm, and instance boundaries. |
| `unfinished-target-boundary.test.cjs` | wrong-realm and wrong-instance locks do not bypass boundaries | Load actual passing-encounter predicates; retain exact identity, claims, realm, and instance boundaries. |

## Verification

Final complete regression: **2,364 passed / 2,364 tests**, zero failures, skips, cancellations, or todos; normal exit code 0 after 302.511 seconds. This includes all 56 previously failing cases and the three new buy-order regression cases.

- [Final full regression log](../.build/full-regression-final-2026-09-20.log): `npm test`, including prerequisite typecheck and staged shared/runtime/character builds.
- [Production build log](../.build/regression-repaired-build-2026-09-20.log): `npm run build`, including dashboard production output; exit 0.
- Coordinator lint: `node node_modules/oxlint/bin/oxlint --config runtime/.oxlintrc.json runtime/coordinator`; exit 0.
- First repaired full run: 2,363/2,363 passed; the final run adds the dashboard-to-route regression.
- Focused repair runs and UI integration evidence are retained in `.build/regression-repair-*.log` and `.build/regression-wtb-ui.log`.

Builds were staged only. No publish or service restart was performed.
