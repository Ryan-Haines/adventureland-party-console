# Steam merchant realm switches (#86)

Failure modes recorded before implementation: Steam waits indefinitely after an
accepted merchant-only switch; headless pages navigate unexpectedly; IV/V realm
keys are rejected; a rejected switch navigates anyway; replaced CODE cannot
resume the saved itinerary; returning home strands the merchant or opens its
stand on the wrong realm.

Run the focused browser and native journeys:

```sh
npm test -- -- --project=console --grep "Steam merchant realm switch replaces"
npm run test:e2e:verify
npm test -- -- --project=live --grep "Steam merchant realm hop redispatches"
npm run test:e2e:verify
```

The console journey executes maintained merchant functions in Chromium, with
declared HTTP acceptance and native transaction boundaries. It verifies actual
page replacement for Ponty, giveaways, ALData buying/selling and stand return,
headless waiting, rejection handling, completed-key continuation and the native
party switch branch across Roman-numeral and PVP destinations. Its ledger and
page screenshot are repeatable artifacts. The pre-fix run stayed on US III after
requesting US II; preserved evidence is under `.build/issue-86-red-{report,results}`.

The native journey uses the disposable upstream game and the maintained Steam
browser runtime. A saved Ponty itinerary with no outstanding purchases requires
US II, then the merchant reconnects, publishes completion and returns to US I
with its native stand open. A stand item is explicit fixture input. Server player
presence, coordinator state, native event logs and a realm ledger are retained.
This checks redispatch and native return, not a new marketplace purchase or the
desktop Steam executable. Read stand state from native client `character.stand`,
allowing the character to be temporarily absent while its page loads. A native
RED completed the job but remained on US II for the entire return deadline;
preserved evidence is in `.build/issue-86-native-home-red-*`. Home recovery now
sends the existing native realm-switch command instead of stopping a disabled
headless worker. A bridge reconnect can incidentally return a companion home,
so require both actual realm arrival and a native open stand at the end.

Activation requires publishing the character assets through the supported full
`scripts/start-console.ps1` restart. Building alone does not reload live CODE.
