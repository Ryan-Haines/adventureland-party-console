# Keep-moving combat ownership audit

## Confirmed cause

Before this change, `beginPassingAttack` installed the encounter only in the
attacker's local cache, flushed an asynchronous report, then immediately sent the
game attack. A peer could observe retaliation before that report arrived.
`defendPartyHit` or `isOccupied` then called `interruptConvoyForDefense`, freezing
and detaching the peer's route. Later passing classification did not undo the
latched `defensePaused` report. The coordinator accepted that report even when its
current attacker classifier had become clear.

`passing-admission.test.cjs` reproduces the old stop with two isolated character
contexts and the maintained hit/defense functions. The protected path tests
delayed delivery, immediate retaliation and projectile delays separately. A
projectile is not necessary to reproduce the race.

The historical snake logs alone do not establish the cause of every cancellation.
They also contain missed departure windows and coordinator request timeouts.
Those failures remain distinct from combat ownership.

## Fix and protocol

The combat channel now carries a passing admission scope and acknowledged
reservation tokens. The scope includes the convoy ID/epoch, participant names,
navigation revisions, runtime IDs, realm, map and instance. All current fighters
and convoy participants must be fresh and acknowledge the scope. The sender
reserves the exact encounter; every participant must install and acknowledge it
before the attack controller can send the first optional basic attack. Concurrent
reservations for one monster retain both tokens. Missing or stale approval skips
the attack; it never waits in the movement executor.

Approval expires locally after one second without a control response. Reports
carry the acknowledgement's server timestamp, so a delayed heartbeat cannot renew
an acknowledgement older than three seconds. Reports
older than the last applied server timestamp cannot restore an approval. A new
runtime, navigation revision, convoy epoch, membership or location needs fresh
acknowledgements. Death invalidates old reservations; a missing local reservation
cannot use its previous grant.

Encounter ownership deliberately outlives the admission scope for delayed hits
and already-fired projectiles. It uses the existing 60-second encounter retention,
with realm/map/instance/monster identity checks. Peer ownership survives CODE
reload in the game parent. An unused reservation does not refresh merely because
the monster remains visible. Once an attack is admitted, visible encounters retain
the existing refresh behavior. A reservation is a bounded commitment to that exact
monster; it is not a species-wide exemption. Already-attacking, unreserved monsters
remain ordinary defensive threats outside continuous Hunt travel.

The first local defensive interruption records its pre-stop phase, command,
convoy, navigation revision and target identities in `convoyNavigation`.
The coordinator retains its defensive causes too. If all recorded causes become
passing encounters and fresh observations show no genuine attackers, the
coordinator rebuilds the owned route under a new epoch without creating a defensive
loot barrier. It never resumes a detached client route directly. Unknown causes,
superseding commands, manual cancellation, casualties and genuine attackers retain
their existing handling.

## Paths audited

| Path | Finding and coverage |
| --- | --- |
| Basic attacks and burst retries | Admission checked before creating an attack flight and again before each send. Passing attacks still bypass skill attacks and normal queue evidence. Controller and combat-movement tests cover selection and denial. |
| Local hits and current attackers | Confirmed propagation race fixed. Two-character tests retain `travelling` and record no stop for passing-only retaliation; a different monster still qualifies as defense. |
| Coordinator defense and local latch | Corrected passing causes rebuild only the current owned convoy. Tests cover both a local stop and an already-issued coordinator defense, plus genuine attackers and replacement/manual commands. |
| Queue, threat nomination and evidence | Existing identity filters remain. Reservations reach these filters before attack admission. Existing passive-hunting and travel-defense tests cover queue exclusion. |
| Combat movement, kiting and following | Existing convoy ownership gates remain; preventing the false defensive handoff prevents normal combat movement from acquiring the route. Existing combat-movement/shared-convoy tests cover these gates. |
| Preparation, assembly and transitions | Protocol 4 optional attacks now require the owned travelling signal. Town casts and movement transitions continue suppressing passing attacks. Genuine incoming damage can still interrupt Town. |
| Projectiles and death | Projectile tracking records damage/expiry, not movement. Tests vary hit delay and invalidate dead/reused identities. No projectile-based convoy stop was found. |
| Loot | Corrected passing-only stops create no defensive loot hold. Normal defensive kills and required map-transition loot barriers remain covered by convoy-defense, departure-loot and continuous-return tests. |
| Hunt travel and return | Continuous return/outbound travel ownership remains. The deferred outbound-Hunt defensive behavior redesign is outside this change. Existing return-town and Hunt travel regressions remain required. |
| Hunt expiration | `runtime/hunt/policy.ts` returns on completion, expiry or missing quest, without a three-minute cutoff. Existing farm-walk, fallback-owner and safety tests include 180000, 179999 and 1 ms remaining. |
| Transport/departure/geometry failures | Separate failure paths. No evidence that they should be classified as passing combat; retained diagnostics distinguish them. |

## Validation and activation

Run the new passing-admission tests, passive-hunting, combat-movement, combat-channel,
heartbeat, convoy-defense/shared-convoy, travel-defense, departure-loot and Hunt
return suites, then typecheck, production build and the full regression suite.
The three-client integration test injects successive reservations and retaliation
while executing maintained convoy/native movement to the endpoint, without
follower replanning. Game and network I/O are simulated; this is not live gameplay.

This change needs both character and coordinator assets. A build does not activate
it. Use the coordinator README's full `scripts/start-console.ps1` workflow when
deployment is requested. Live validation should traverse a snake spawn toward the
saved destination, check optional fire/retaliation without repeated assembly, and
introduce an unrelated attacker to verify ordinary defense. Live gameplay has not
been used as proof of this patch.
