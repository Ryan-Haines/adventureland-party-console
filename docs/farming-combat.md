# Shared farming combat

Default grouped farming uses protocol 4: one authoritative current monster and a rolling queue. The current monster is planned until an offensive action is pending or server evidence confirms engagement. Visible party attackers become engagements too. An untouched nomination can yield to defense; an unresolved projectile cannot. All characters focus the same engaged monster until target-specific confirmed death or a fresh external-claim observation. Local visibility, weapon range, farm boundaries, stale reports and reloads do not release its identity. Deliberate Hunt transitions, death disengagement and the manual queue reset invalidate the old encounter session; late reports cannot restore it.

The selector reports eligible visible neutral candidates every 100 ms. The coordinator keeps current engagements ahead of neutral pulls, fills two upcoming slots where possible, and retains every extra aggressor. Neutral ranking uses configured monster priority, summed distance from the participating party, then monster ID. Merchants are excluded. Queue candidates may reorder while the current fight stays fixed. Selecting upcoming monsters does not attack or move toward them.

The lightweight combat channel reuses the status endpoint without running inventory, merchant, or event consumers. Event-triggered reports and revision-based long polls propagate death and promotion without waiting for the full heartbeat. Upcoming queue acknowledgements can authorize a successor without another acknowledgement cycle. Missing/stale members block new neutral pulls. Duplicate and late death evidence is idempotent. Pending/engaged evidence survives CODE replacement in the game window. Legacy fights without sufficient evidence remain unresolved rather than being silently abandoned.

A character losing sight retains the shared ID and uses local visibility recovery only: recent breadcrumbs, a teammate with a fresh sighting, then a persistent detour and bounded fan search. Breadcrumbs cover up to eight seconds. Safe short steps are based on walking speed, not attack range. Failed/recently visited positions are remembered for five seconds; stalls reverse the detour direction. Candidate detours favor priest coverage. Completely blocked searches retry after 250 ms. Visibility recovery never calls smart_move. Seeing the target again immediately returns control to normal approach/combat movement. Other characters continue the same fight.

Every attack, heal, skill and potion of a fighter goes through the turns owner (`runtime/characters/turns/`). At the attack cooldown's edge, `parent.next_skill.attack` with the game's ping correction, it sends the family's most urgent request once: a heal for a member below "Heal first below" before the basic attack. A `cooldown` reply resends once the server's time left has passed, also when it answers an attack the owner already dropped, and a reply that never comes frees the cooldown after the cooldown and the largest recent round trip. The owner's hold table (`turns/rules.ts`) decides who may spend now, and every reader asks it through `skills.allows`; the role loop runs a pass on each game event that can change a need and on the report timer, and a step that brings the target into range arms the attack at that moment. Every actual attack rechecks the shared target and authorization. A new target releases the preceding target's attack-response latch without resetting the actual game cooldown. Server-confirmed attacks, rather than requests sent, drive timing diagnostics.

The sprite map and each rendered native game view use the same authoritative queue: one red circle for current, one yellow circle for next, two yellow circles for third. Hidden/off-instance monsters have no marker but keep their queue slot. Steam owns a separate graphics layer and destroys only that layer on reload/stop. Headless sessions without graphics create no layer.

When the current target is a porcupine, every class with unsafe physical melee attacks equips its highest-upgrade usable inventory bow (ties use inventory order). The shared basic-attack guard blocks physical attacks below 75 range, including while equipment changes; magical/pure attacks and already-safe ranged equipment are unchanged. The controller remembers the original mainhand and any displaced offhand across target changes and CODE reloads. Actual convoy departure or resumption restores the saved loadout without delaying synchronized movement; defense, loot holds, and combat positioning retain the bow. Missing bows or equipment failures appear in combat diagnostics and retry after two seconds. Manual equipment changes supersede restoration.

Each character's targeting owner (runtime/characters/targeting/) keeps three rules on top of the queue. A target the character's approach cannot reach (the approach's last level, or a sight search that ends without the target) gets the 10 s failed-approach mark and leaves the character's selection, with no killed-list entry; every mark clears when the character's next fight starts. When the leader cannot reach its own grouped lock, its notice retires the lock as a lost target with the reason "unreachable", and the queue keeps that monster out of every member's nominations until the leader's mark expires; a non-leader's notice retires nothing, so it keeps the lock. A character skips a target its own damage in flight already kills, the priest's long shots above all, and attacks a living one until the killing hit lands or the shot's eta passes. Each character's two reflect lists, "Don't hit with magic" and "Don't hit with physical", are per-character settings (slenderman, tiger and goblin for magic, porcupine below range 75 for physical, by default); a list change reaches the character with its next status reply. `__partyTargeting.records()` holds each retire, skip and refusal.

Diagnostics include group target state, queue scores, revision/acknowledgements, observers and blockers. queueTiming records promotion, confirmed death time and the first accepted subsequent attack. Recovery explanations appear in partyCombatPosition.reason. Local target rejection means the current entity cannot be attacked here; it is not permission to select another target.

Grouped attack evidence settles even after entering scatter or moving to another map: action completions retain their original realm, instance and start time. Confirmed local deaths remove matching evidence immediately, at client initialization, and before either heartbeat channel publishes it. Scatter cannot create new grouped actions, and late callbacks cannot recreate retired actions. The last 32 local settlement/death-cleanup records are available in `__partyQueueEvidenceTrace`, with action identity, mode and reason. Visibility loss alone still uses bounded search rather than fabricating a death.

After a farming death, stop new pulls. The survival owner's verdict decides whether the survivors finish the fight or escape: the party finishes while the fight's trend since it last changed (a death, an arrival or a new attacker) says the foes die before a survivor's HP, less the next blows of its attackers, runs out, and before the trend has two readings the game-data hold check decides. Otherwise the party escapes; a full wipe clears the encounter. Recovery waits for everyone alive, settled at the respawn point of the death's map and at or above its "HP potion below" line with no monster on it, then resumes the saved farming location or Hunt controller; a failed farm return asks again on the next report. Manual activity changes supersede recovery. Collaborative events retain their event behavior. Returning after a wipe does not fabricate a monster death.

Passive rares use the shared queue in Default grouped farming. Fresh same-instance sightings from any party member can nominate enabled Fairy (101), Phoenix, Golden Bat, or Cute Bee (100), even outside the normal farming focus/area. Higher-priority rares replace untouched nominations; pending attacks, engaged fights, and other existing aggressors stay ahead. Normal candidates still come from the leader. Both targeting overlays read this same queue.

Rare support follows the selected queue target and does not clear combat state. Grouped rare visibility recovery uses the normal local recovery routine, including the Fairy generator carrier. An engaged rare survives checkbox changes, missing sightings, and the former rare timeout. Confirmed shared death evidence permits loot, but existing fights finish first; neutral pulls pause during rare loot. The existing patrol restart and saved farming-return obligation then resume.

External claims release current, next and third choices together. Any visible party observer can report a claim; the newest observation wins, with external claims winning timestamp ties. The shared release timestamp removes old attack evidence and survives reloads. A newer visible eligibility observation permits fresh nomination, but never restores the old engagement. This applies only to normal grouped farming: event reports are ignored and the existing cooperative-monster exceptions remain in force. A claimed rare is cancelled without loot or respawn timing, and the farming task 01 resumes after it walks back to the spot once no member holds a target.

Event targets use a single red ring in Steam and the party sprite map, independently of the farming queue. The marker follows the combat routine's selected eligible event monster; another player's target does not suppress collaborative attacks or the ring. Death, lost visibility, cleared selection, and event exit remove the event marker. Empty event selection does not fall back to the game UI's stale target.

The purple crosshair clears and recalculates the targeting queue immediately, for the whole default group or the individual scatter character. Actual attackers remain eligible immediately. The control is disabled during events and does not cancel escape. Search radius is now an input in Farming Mode settings. Explicit Hunt return and mission travel transitions clear the previous queue once; waiting for spawns or losing visibility does not.


During Monster Hunt, ordinary monster focus is the backup farming preference. Clearing it does not cancel the active quest destination or its return after events. Legacy navigation cancellations specifically caused by "monster focus cleared" are ignored while that character participates in an active Hunt; explicit manual Town and other cancellation reasons remain authoritative.

Ordinary farming and Hunt convoys pause in `defending` when any participant has an existing fight or receives monster aggro. Clients stop their owned route and resume shared attacks/healing, without neutral pulls. After combat, the convoy waits for an awaited loot pass and a fresh chest observation before starting a new assembly generation. Failed collection stays visible and retries; inventory-space failures request merchant cleanout. A new attacker invalidates the pass. Defense and loot time are not route timeouts. Escape and event routes retain their separate behavior. Hunt departure cannot clear an unfinished encounter.

When all participating Hunt assignments are blacklisted, Hunt remains active and farms the configured backup zone. The party waits for every assignment to expire, using fresh reports from every participant, then finishes a loot pass and makes one trip to Daisy. All participants receive new assignments before selecting the next mission. Temporary disconnection holds the batch; explicit follower removal removes that member. Restart and event return preserve the wait. Clearing a blacklist entry allows its eligible assignment to resume. Historical completed loot never blocks ordinary or backup farming.

Backup farming permits neutral nominations in both the client and coordinator. Arrival releases only the matching backup convoy; defense and loot retain ownership until complete. Three eligible monsters produce current, next and third queue entries. Nomination traces record focus, area, navigation revision, blocking ownership and per-monster rejection reasons.

Acquisition and retention use separate boundaries. Already nominated neutral monsters remain eligible within the zone or surrounding radius plus 150 units, even when a new monster enters the preferred spawn boundary. A fresh positive observation from any party member preserves the nomination; absence requires fresh negative observations from every member. Confirmed death, claims, failed approaches, boundary exit and activity changes still release nominations. Valid nominations and active combat prevent backup reentry convoys while characters kite across the zone edge. Waiting for observation of a retained primary target does not launch an empty-zone search.

Anniversary-return planning and travel can yield to visible party attackers. Interrupted route ownership invalidates late planning callbacks. The same return destination resumes with a fresh assembly epoch after defense and confirmed collection; Escape and explicit cancellation remain authoritative.

Auto death recovery retains `returning-to-farm` until actual arrival or an authorized combat handoff at the destination. Failed trips retry with increasing delays capped at one minute. Missing assembly commands are reissued only under the original navigation revision; manual activity changes still cancel recovery. Command ownership logs include command identities and the code location responsible for replacement/removal, and merchant/bank cleanup cannot delete a replacement convoy.


## Formation terrain recovery

Untouched ordinary targets now yield to an eligible equal-or-higher-priority monster at least eight units closer to the leader, using the party's pull-revocation acknowledgement before changing the shared red target. Recovery does not disable this comparison: the new target cancels the old recovery. Pending and engaged fights remain protected.

Recovery plans same-map routes incrementally using terrain and monster clearance on every edge, matching the walker safety checks. Followers use the same search to reach the recovery leader around obstacles. Searches are bounded to 128 expansions per tick and 8,192 total; changed monster positions trigger replanning before walking the unsafe segment. Characters already within a monster's clearance may move out without increasing exposure.

Selected-target clearance must permit reaching the character's weapon range. A neutral monster that outranges the character uses a close body-clearance buffer rather than turning its full attack reach into an impassable region. BBPom's real range is 280; replay fixtures must use that value, including stationary-target tests that require repeated accepted warrior attacks.

Ordinary farming, party travel, and farming relocation can pause before the final waypoint for a visible configured monster within the leader's local search radius. The coordinator validates the route identity and revision, pauses all participants, and keeps the original destination. The shared queue supplies the red target and combat authorization. The convoy resumes after the encounter and loot; forced and special-purpose routes keep their existing restrictions.

Warriors use the actual attack-range check to leave approach mode. A three-unit formation tolerance must never settle a warrior outside basic-attack range. Target promotion clears the previous target's owned movement. Validation requires a kill followed by selection, approach, and repeated accepted basic attacks against a stationary neutral successor, with no taunt or incoming damage.

Movement identifies the selected monster by ID and instance, not JavaScript object reference. A selected target represented by a CODE snapshot or proxy must remain exempt from secondary-attacker avoidance after taunt. The regression also holds that monster stationary while it targets the warrior and requires repeated accepted basic attacks.

A member cut off from the group's anchor walks short native steps toward it. After 3
seconds of steps without progress it climbs the movement owner's task round toward the
anchor (`taskRound` in `runtime/protocol/ladder.ts`): the route, by the saved farm
spot, the route again, the other route, the nearest exit (never Town), the route, then the
next report. Getting closer starts the round again, so no count ends the climb and new
pulls are not held for it.

Before a new pull, a terrain- or monster-blocked formation can authorize one member (priest
first) to take a native pathfinding detour. Local recovery still gets the first
1.5 seconds. If no safe local detour exists, healing coverage prevents that
detour, or both the priest and warrior stop making progress toward a neutral
target even on clear ground, the mover proposes up to 16 safe positions around the selected target.
Every member acknowledges the attack pause with fresh combat evidence before
movement starts. Followers advance with the mover; short native route segments
wait when necessary to preserve healing coverage. Combat resumes after stable
regrouping, or after every member reports a safe ordinary approach for 500 ms.
Seeing the target alone does not release recovery. The handoff clears only its
owned route and combat movement state, then wakes target selection and attacks.

The native walker retains one movement owner. Terrain and observed monster danger
are checked before its next segment; Town and cross-map shortcuts are rejected.
The staging goals are the rungs of the movement owner's progress ladder
(`runtime/movement/character/formation.ts` `formationRecovery`). A try fails when its route fails,
when coverage leaves a follower unreachable, or after 30 seconds without progress
toward its goal (or, while regrouping, of the members toward the anchor). The
mover's next report chooses the next goal from fresh staging goals. A failure that
left the mover closer to the target starts the round again with every goal; one
that did not leaves the failed goal out. No count ends the climb: once every goal
of a round has failed without progress, the recovery ends and the queue retires the
untouched nomination for 10 seconds, so the party tries another target. Matching
recovery and attempt IDs reject late callbacks. Existing
aggro, pending attacks, manual navigation, events, stale reports, and runtime
changes cancel authorization rather than competing with the route.

`Formation recovery:` navigation logs and `combat.positioning` show the mover,
phase, reason, attempt, destination, and remaining path distance. Set
`globalThis.partyFormationRecoveryDebug = true` in a character's CODE context to
show the direct line (red when terrain blocks it), blue route, and yellow goal.
Set it to `false` to disable; recovery clears its owned drawings on completion.

A warrior already in melee uses its combat arc rather than obstacle recovery.
When closing, a backwards step must improve healing coverage or address another
attacker; otherwise it holds with an explicit approach constraint instead of
oscillating at the healing boundary. Neutral targets use the same approach
progress checks as targets selected during a hunt.

## The farm spot and the combat mode (hunts and farming owner)

The farm spot, its relocation and its failed walks, the empty spawn return and the combat mode answer are the hunts and farming owner's (`runtime/hunting/`). The farm spot moves once per report of the group's leader. A failed farm walk is classified by its walk's end code: only `route-failed` counts a strike on the area, and every other code retries the same area after the transient wait. farm.ts alone recovers a failed farm walk; during a Hunt mission its retry starts the Hunt's own walk to the mission's spawn. The empty spawn return is decided on the coordinator's tick: a fresh leader outside the saved area, no member with a target, the farming task live and no walk running; it asks again only after its last walk ended and a later leader report still stands outside. The combat mode answer is one table, `combatModeAnswer` in `runtime/hunting/rules.ts`: a Cave run, a rare and a live death recovery fight grouped; Default and Scatter decide for themselves; Auto scatters on a learned one-shot type while no off-type fight breaks it. The character applies the reply's answer; a focus change resets learning, so the reply that carries the new focus already answers grouped. Each farming profile keeps its learned types across a restart for the same roster, and a roster change clears them. An add-on may refuse or rank the relocation's alternatives through `farm.spot`.

## Hunt conflict relocation and failure settings

Farming settings now include party-wide Hunt controls: conflict relocation, automatic death blacklisting, and automatic expiry blacklisting. All are enabled by default; both failure thresholds default to one. Thresholds are positive integers. Death and expiry counts accumulate per monster across missions and restarts, even while their rule is disabled. Changing a threshold evaluates existing counts; disabling a rule leaves existing blacklist entries intact. Removing an entry resets its counts; Clear all resets every count.

A death below the threshold recovers and continues the same Hunt. An unfinished attempted quest expiry below its threshold leaves that monster eligible for future quests. Event deaths remain excluded. Fresh quest observations and persisted attempt records prevent repeated expiry counts.

Conflict relocation (the party's root setting `relocateIfCompeting`, one switch in the Farming settings dialog, read in every target mode) requires recent competing-farmer activity, a fresh sighting of that farmer, and fresh reports that every party member has zero living target-type monsters inside their own search radius. Claimed monsters still count as present. There is no extra empty-area grace period; the existing two-minute relocation cooldown remains. Missing observations do not establish emptiness. Queued conflicts are rechecked before departure. Turning the relocation switch off cancels a pending conflict, while a convoy already underway completes its route.

Conflict convoys carry `cause: farming-conflict` and disable early combat handoff until arrival, including regenerated commands and retries. Actual attackers retain defensive handling. Ordinary Hunt travel still acquires eligible monsters early.

Reunion after an early Hunt handoff completes near the current party member rather than requiring proximity to the obsolete encounter point as well. Arrival is checked while the old path is still running and during retry delays. An old engaged monster can release its engagement lock when fresh sightings explicitly show it neutral and fully healed, with no pending attack, current attacker, or accepted attack in the last five seconds. This uses the existing claim-release fence so old evidence cannot restore the fight, and allows ordinary nearest-target selection without reporting a death.
