# Hunt movement and recovery

Each mission keeps its selected spawn waypoint for its lifetime. Hunt does not start regroup travel while a fresh fighter reports a living target or attacker. Its waypoint arrival check uses the configured hunt radius.

Starting or resuming Hunt waits for fresh reports from the expected fighters. If quests are missing and every existing unexpired quest has at least 25 minutes remaining, visit Daisy to fill the gaps. With no quests, visit Daisy normally. If any existing quest is below 25 minutes, select among eligible unfinished quests (leader quest first); questless members accompany that mission. Completed-quest turn-in and near-expiry behavior remain unchanged.

A committed pickup round persists as `pickupPending`: crossing below 25 minutes during travel or reconnection does not abandon the remaining assignments. Resume retains the cycle ID, death accounting, saved farm, and pickup commitment. Daisy interactions require fresh same-realm reports and arrival within 100 units. Received quests reconcile outstanding commands before a retry; an unanswered interaction can retry after 15 seconds and a newer status report. `checking-quests` and the Hunt message identify the fighter whose report is awaited.

Deaths accumulate across the party for the active Hunt run and persist with the cycle. A death persistently blacklists the current Hunt monster; after respawn the party selects another eligible mission. If none remain, it returns to normal farming. Across the run, two deaths, including two different fighters, end Hunt. After respawn, return to the saved normal farming waypoint when the normal selection is unchanged, otherwise choose a spawn for the current normal selection. Restore the prior farming policy; no Daisy expiry wait is required. Manual cancellation supersedes this return.

Mage reunion can Blink toward a direct entrance on its current map, use normal cross-map travel, then Blink toward a survivor. Blink landing validity is checked independently of a straight walking path. Insufficient mana, blocked landing, unavailable skills, or failed Blink retain walking fallback. Existing reunion ownership, realm, survivor-distance, and MP reserve checks remain in effect.

Validation: `scripts/tests/hunt-safety.test.cjs`, `scripts/tests/monster-hunt-start.test.cjs`, and `scripts/tests/farm-reunion.test.cjs`. No live Hunt is started by these tests.

The gear beside Farming mode opens the shared Hunt blacklist, with individual Clear and Clear all controls. Blacklist entries persist independently of Hunt cycles and do not affect ordinary farming. `/party-api/hunt-blacklist` accepts POST actions `add`, `remove` (with `monsterId`), or `clear`; the dashboard state includes `huntBlacklist`.

Starting Hunt requires a normal farming waypoint and explicit monster focus. When missing, the dashboard opens Getting ready to hunt with a local monster selection and spawn-area preview. Confirming sends a validated `backup: { monsterFocus, location }` with the farming-mode request; cancelling changes no server state. The API rejects a missing backup with `backup_required`.
