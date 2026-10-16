# Repeated client diagnostics

Two client messages repeated on a live 1.4.0 party without any gameplay fault.
Over 10 minutes, a melee warrior logged 403 copies of the first, and every
character logged the second every 30 seconds.

## Combat approach cancellations

`characters/shared.js` independent approach cancels its own walk each time it
re-aims (`cancel` in the approach ports, code `combat-approach-cancelled`).
`movementDiagnostics` folds repeats by journey and destination, and both change
on every re-aim, so it logged every cancellation as "Movement cancelled".

Failure inventory, written before the change; regressions are in
`scripts/tests/movement-service.test.cjs`:

1. The first cancellation must still log as "Movement cancelled" with its
   destination, as the existing cancellation test requires.
2. Repeats with new journey ids and destinations must fold into one message per
   character per minute, carrying the count.
3. Other phases and codes keep the existing 10-second fold by journey and
   destination.
4. Two characters fold separately.
5. Movement metrics keep one record per cancellation; only the log folds.

## Cave interaction replies

The game client resolves a native `interaction` deferred for every
`game_response` with `place: "interaction"` (`resolve_deferred` in
`js/old_common_functions.js`). `requestCave` emits the request on the raw
socket, so each reply found no deferred and the client logged "Weird
resolve_deferred issue: interaction". The daily dungeon eligibility check sends
one every 30 seconds (`runtime/characters/dungeons.ts`).

Failure inventory, written before the change; regressions are in
`scripts/tests/cave-request.test.cjs`:

1. A request registers exactly one native `interaction` deferred before it
   emits, so the native resolve finds it.
2. A request that never emits (a disconnected socket) registers none, so no
   native deferred waits forever.
3. A client without `push_deferred` still sends and settles the request.
4. A native deferred that rejects never surfaces as an unhandled rejection.
5. The correlated reply still settles the request through its own listener.
