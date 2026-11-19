# Event attendance

The events owner is the folder `runtime/events/`. Its
rule tables sit in `rules.ts`: the event kinds, the occurrence, the member record,
admission, the join replies, the return and the character's actions. The coordinator half
is `coordinator/` (occurrences, attendance, the `event` task source, returns, anniversary, A/B,
the reply's fields, the routes and one install); the character half is `character/` (clock,
attend, exit, combat facts, anniversary, merchant, calls and one install). Other owners import
only `runtime/events/api.ts`; add-ons use the hooks of `runtime/hooks/rows/06-events.ts`
(`event.attend`, `event.presence`, `event.schedule` and the event notices) and the types in
`runtime/hooks/api/06-events.ts`.

Slenderman, Mr. Green, and Mr. Pumpkin are opt-in open-world boss events. Adding
them does not alter existing or legacy character selections. Their rows remain
available when the current server schedule feed omits a seasonal event.

Mr. Green and Mr. Pumpkin use the native announced spawn timestamp. Each report names the
selected staged events' next spawn and destination (`eventWalks`), and the occurrence table asks movement's
`walks.estimate` for the group's planned walk there. The occurrence is `due` from the spawn less
that walk and one report interval, so the party leaves in time to arrive at the spawn; until an
estimate answers, nothing is due before the spawn. Attendance holds the original return
checkpoint, and a passed spawn counts until the schedule names a later one. A missed or cancelled
spawn returns to the saved activity. Live boss sightings replace the staging
destination: an event walk follows every boss whose game data entry has a speed
above 0 (`eventBossMoves` in `runtime/events/rules.ts`). Each fresh
sighting 250 units or more from the destination re-aims the travelling walk in
place: every member's journey takes the new point on a clear straight line, with
no stop, and a member whose line is blocked holds the walk for a new route. Native death recovery can resume a still-active selected fight.

An event walk ranks as event attendance in the rank table. A fighter's event walk
waits for the group's healer while waiting still lets the party reach the event
within 60 seconds of its announced spawn. An event with a `duration` in game data
takes over a lower trip at once; one without waits for the trip to arrive or fail
while waiting still reaches the event within 60 seconds of its spawn, and takes over
at once when no spawn time is known. The tasks owner's wind-down answers both waits
(`runtime/tasks/coordinator/wind-down.ts`) from the events owner's `event.schedule` for the group's
occurrence (its spawn, planned walk and window): its `member.holder` holds and its
`walk:event` answer for the takeover, and the walk asks them
(`runtime/movement/coordinator/walk.ts`). The walk sends its command to each eligible
member that has not asked, and goes on without a member whose holder says it is not
coming ([group walks](convoy-movement.md) "Holders").

Slenderman has no fixed staging position. His native announcement can omit
coordinates and keep its initial map after subsequent warps. Attendance therefore
prefers a living local entity or a party sighting received within three seconds
on the same realm, then searches Halloween, Spookytown, and Cave using native map
locations and managed movement. Discovery is limited to one minute per map and
three minutes overall. An unsuccessful search returns to saved work and suppresses
that live episode until a new actual sighting or a new live cycle permits another
attempt. Each character's "Don't hit with magic" list (the targeting owner's reflect
setting, Slenderman on it by default) blocks its magical attacks on the boss and keeps
healing and defensive recovery; equipped weapons are not automatically replaced.

Windows activation requires the supported full restart, which now also publishes
the shared event policy. A build alone does not activate running characters.

Each character's Events dropdown selects individual supported activities. Followers use the leader's whole selection; their saved choices return when they unfollow. Merchants keep independent selections and can attend every supported event. During combat events they attempt attacks with their currently equipped weapon, including Golden Gun; no automatic weapon swap is performed. Merchant work yields at safe production/crafting checkpoints, while other in-flight actions finish before travel. Gathering, new jobs, and stand activity remain paused through event attendance and return. Unsupported game events remain visible with disabled checkboxes.

Unchecking an attended event requests the existing saved-activity return. Cancellation requests retry after coordinator outages. Legacy combat settings migrate to the equivalent supported combat list, with Anniversary initially enabled to preserve prior behavior.

Schedule rows use browser-local date formatting, including a timezone label. Only server-provided next timestamps produce countdowns. Unknown schedules are labelled explicitly. Game-server clock offset is sampled on connection and every five minutes; cached event checks do not create additional game-server requests.

Anniversary departure begins 90 seconds before the next server deadline. Each character gets at most two reserved attempts per round, retained by the coordinator through reloads. The second approach uses the latest featured-player position. Movement is bounded to 60 seconds with a ten-second progress watchdog and independent arrival detection. Visibility, kiss response, and reward confirmation waits are also bounded by event expiry.

The first character to exhaust both attempts skips the remainder of the round for the party. The Anniversary modal's gear edits a persistent, case-insensitive player blacklist. Adding the current featured player skips the current round; removing a name does not reopen a skipped round. An empty list is preserved.

Relevant regression coverage: `event-selections`, `event-policy`, `anniversary-kiss`, `farming-navigation`, `merchant-anniversary-reservation`, and `hunt-event-priority` tests, and `e2e/live-events-hooks.spec.ts` for the hooks and notices.

Franky attendance attacks only living, visible `franky` monsters in the current map
and instance. It retains the current boss when possible and waits without fallback
targets if the boss disappears. Every participating class approaches until in attack
range, then holds position; no kiting, retreating, formation movement, or warrior Dash
is used. Each boss event's settings choose the approach: straight to the boss, the
default, respects terrain and lets no add or healer coverage stop it; fighting adds on
the way takes the full step check and makes the adds targets (`bossApproach`). Offensive skills cannot target adds; area effects that cannot exclude them
are suppressed. Healing, potions, buffs, and nearby loot continue. Event exit and
manual navigation retain ownership, and the existing exit-defense policy is unchanged.

Validate with `franky-combat`, `combat-movement`, `class-skills`, `franky-recovery`,
and `franky-exit`; publish character assets with the full supported restart.

Deselecting Franky revokes voluntary boss targeting and installs the protected
exit convoy immediately; departure does not require killing the boss first.
The native evacuation journey verifies boss damage, deselection, both client
exit owners, and actual Mainland arrival while Franky remains alive.
