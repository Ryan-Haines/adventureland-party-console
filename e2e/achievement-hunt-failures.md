# Achievement Hunt failure modes (written before the E2E journey)

These cases describe the `console` project journey in `achievement-hunt.spec.ts`.
The fixture publishes one routable monster (Goo) and no kill-achievement counts,
so Goo's first milestone is the target. Isolated checks for the step sweep,
death thresholds and scope crossing stay in `scripts/tests/achievement-hunt.test.cjs`
(docs/achievement-hunt.md § Tests).

- The settings section can render while its saves fail. The journey selects Goo
  through the dialog and reads the selection back from the coordinator's state,
  under the character's own farming profile.
- The regular list can offer a monster without a route. The regular list
  holds only monsters with a spawn the fixture publishes; the rest are special.
- The dashboard can offer the Achievements mode before it can start. It must refuse with
  a reason while nothing is selected, and start once Goo is selected.
- A target switch can reset the farming mode to Auto, as a hand-picked monster
  does. After the coordinator picks Goo, the mode stays `achievements` and the
  focus becomes Goo.
- The status line can stay on its placeholder. It must show the coordinator's
  message with Goo's kill count and step. The coordinator picks the target after
  `/farming-mode` answers, so the refresh that answer triggers can miss the
  message. The journey reads the message from the coordinator first, then waits
  one 15 s `config` poll for the card.
- A restart can drop the selection or the target. Restart the real coordinator
  with the same journal and read both back.
- Leaving the mode can strand the target. Choosing Default clears the target,
  and the selection stays for next time.

## Field registry in enforce mode (written before the enforce journey)

`PARTY_STATE_FIELDS=enforce` sends only the fast whitelist in
`runtime/coordinator/telemetry/character-fields.ts`. The enforce journey seeds
W with declared kill counts and an empty `avoidSightings` list, and aborts the
live stream so the dashboard reads characters from `section=fast`.

- The catalog can miss `avoidSightings`, the status key Achievement Hunt adds.
  `scripts/tests/character-field-registry.test.cjs` fails on any reported key
  outside the catalog.
- Enforce mode can drop `monsterAchievementKills` from fast. The settings list
  would then show 0 kills for Goo while the stream is down. The journey reads
  Goo's row in the monster chooser.
- `avoidSightings` can reach fast in enforce mode, as debug data on every poll.
  The journey checks that fast leaves it out and the full request keeps it.
- The coordinator can lose `avoidSightings` while storing the report, so the
  boss check in `hunt/achievement-hunt.ts` never sees a sighting. The full
  request reads the stored status.
- The party-level fields (`achievementHunt`, `achievementBlacklist`,
  `achievementTarget`, `achievementMessage`, `farmingProfiles`) can leave the
  config section. The journey reads the status line, which only
  `achievementMessage` from config fills.

## Achievement Hunt save key (written before the persistence journey)

docs/efficiency.md § Achievement Hunt state has the full failure inventory.
The persistence journey seeds a layout 2 journal: settings with the marker
and W's profile without Achievement Hunt fields, and the Achievement Hunt
document with W's settings and a blacklisted Bat.

- Load can ignore the Achievement Hunt document (item 2). The settings dialog
  must show the saved death threshold and the Bat entry.
- A running settings record can carry an Achievement Hunt field (item 1). No
  settings record written before shutdown may contain one.
- A target pick or a settings change can stay unsaved (item 5). The newest
  Achievement Hunt record must carry the target, its status message and the
  new death threshold.
- Shutdown can leave the fields out of settings (item 4). After the real
  coordinator restarts, the last settings record must hold them inside W's
  profile, and the state must read them back.
