# Halloween attendance failure inventory

Written before runtime changes. Native E2E scenarios in `live-halloween.spec.ts`
declare initial monsters, native announcements and one native relocation only.
They require actual walking, attacks, native lethal damage, reentry and saved
checkpoint arrival. The retained report, screenshots, packets and JSON snapshots
are repeatable evidence; no fixture records successful combat or travel outcomes.

- The three monster IDs are absent from `G.events`; catalog and runtime support
  must include them without enabling them in existing settings.
- Mr. Green/Pumpkin announce `S.spawn`, not `S.next`. Their non-live announcement
  must begin staging no earlier than 60 seconds before that server timestamp.
- Staging is participation, not live combat. Its saved checkpoint must survive
  the existing ten-second ended-event sweep and coordinator restart.
- A missed spawn cannot hold attendance beyond spawn plus 120 seconds, refresh
  that deadline from later status receipts, or reopen the same expired timer.
- Staging reports must translate the captured client-wall deadline into the
  coordinator clock, as sightings do. Different client clocks must not alter
  eligibility; the local wait deadline and native spawn identity remain fixed.
- Native spawn regions are rectangular, not one exact boss location. Live
  coordinates and local entities supersede staging destinations.
- A new timer or loss of the announcement must release old staging ownership;
  manual navigation, cancellation, Cave ownership and protected turn-ins win.
- Slenderman's native server status omits coordinates; native warps also leave
  its initial `S.map` unchanged. Fresh feed does not prove that initial map is
  still current. Local visible entities and fresh party sightings are authoritative.
- Slender search must cover the three native warp maps, remain managed and
  bounded (60 seconds per map, 180 seconds total), then resume the saved activity.
  A continuously live stale hint must not immediately reopen an exhausted search.
- A visible Slender warp must invalidate an old walking destination, without
  stealing a newer navigation or event-return owner. Actual sightings can reopen
  an exhausted search; a not-live to live transition starts a new episode.
- Existing magical reflection checks must still reject attacks and magical
  offensive skills. Physical combat remains eligible.
- Native Slender RED on game 15555 found that player serialization omits
  `character.damage_type` even for a physical Blade-equipped warrior. The
  compatibility resolver must prefer a valid native field, then the current
  weapon definition, then the native class definition; unknown data remains
  blocked. A magic weapon must override a physical class, and physical/pure
  native overrides must remain authoritative. These contract failures were
  recorded and isolated policy cases written before implementing the resolver.
- Native death must retain selected-event reentry and normal recovery; event
  completion and deselection must return every captured participant, including
  followers and merchants, under existing checkpoint/revision ownership.
- Native Mr. Green RED exposed a return rendezvous after real death/reentry:
  the priest's verified Town receipt at radius 57.5 retired its return command,
  while the warrior's shared exit still waited for that priest under the generic
  55-unit walking radius. Same-cycle event-return legs must use the recovery's
  remaining pending roster; unrelated cycles and ordinary walks retain their
  existing roster and radius. Record actual post-respawn attacks before testing
  deselection, not merely a same-map reentry marker.

The pinned disposable backend's `event_loop` removes non-live boss announcements
before their timers. Scheduled scenarios therefore declare one immutable native
`server_info` schedule at its broadcast read boundary until the actual monster
exists; the original native live status takes over permanently at that point.
The declaration cannot fabricate movement, damage, death, loot or completion.

Run `npm test -- -- --project=live --grep "Halloween"`, then
`npm run test:e2e:verify`. Build and use the supported full restart to publish
coordinator and character assets; a build does not activate running clients.

## Verified implementation

- Console selection/save/restart scenario: passed; evidence retained under
  `.build/halloween-console-passing-report` and `-results` (16 files).
- Four native scenarios: passed; `.build/halloween-native-green6-report` and
  `-results` retain 125 verified evidence files. Both timed boss journeys prove
  actual post-respawn damage, evacuation with the boss alive, and checkpoint return.
- Slenderman's final assertion was strengthened to reject a transient crossing
  of the saved map. Its separate passing rerun retains 35 verified evidence files
  under `.build/halloween-slender-terminal-report` and `-results`, proving native
  kill, both living characters at Halloween `(0,0)`, cleared attendance, no convoy,
  and a retired return cycle.
- Full retained unit run: 3,346 passed, no failures; two Linux-only checks skipped
  on Windows. See `.build/halloween-full-unit-green.log`.
- Full build, all four TypeScript projects, and the CI coordinator lint passed.
- Staging clock normalization passed a further native Mr. Pumpkin journey,
  including restart, post-respawn damage, evacuation with the boss alive, and
  saved-point return. Its 35 verified files are archived under
  `.build/halloween-clock-normalization-report` and `-results`.

Native fixtures isolate previously declared Halloween encounters between cases.
Slenderman's initial health budget counts only damage types eligible against its
reflection. Neither fixture change supplies successful movement or combat results.
Reentry rendezvous failure inventory: a recovered melee character must not wait
for a ranged character already fighting the same visible boss. A joined marker
alone, stale observations, another map or instance, another monster, or staging
must never remove a required walker. The native GREEN3 diagnostic records the
priest fighting Mr. Green while the respawned warrior has no movement command.

Live deselection exit failure inventory: the existing afterCombat wait must not
hold a Halloween exit until the boss dies. Interrupted Town must progress to
owned walking while the boss remains alive; incoming threats may receive moving
defense, but voluntary boss targeting cannot reclaim movement. Cancellation and
new navigation still supersede the exit, and actual Town/checkpoint receipts
remain required. GREEN4 proves native reentry damage, then records this live-boss
evacuation stall before the exit implementation changes.

Point-return failure inventory: reconciliation must not retire a new Halloween
checkpoint convoy at the legacy 180-unit proximity while its authorized shared
route still requires 100-unit arrival. Preserve shaped farming areas, unrelated
legacy return tolerance, ownership revisions, and stale/dead actor guards.
GREEN5 records a valid Mr. Green checkpoint and cancelled route at 107.55 units.
Fixture boundaries must also clear only prior fixture-owned encounters between
cases, and derive Slender's initial bounded HP from fighters actually permitted
to damage its reflection; a blocked magical priest cannot contribute expected
DPS. Native damage, kills and movement remain untouched after declaration.
