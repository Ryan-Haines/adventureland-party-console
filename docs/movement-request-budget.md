# Movement request budget

The game server disconnects a socket whose call cost passes `limits.calls`
(200) within any 4-second window (`node/server.js`, `limitdcreport` with
`disconnect_reason: "limitdc"`). Every socket call costs 1 and a `move` adds
`CC.move` (1.5), so one move costs 2.5. The server disconnects a client that
issues 80 moves inside 4 seconds on moves alone. The server reports the current cost to
the client as `character.cc` in each player update.

`runtime/characters/move-budget.ts` wraps the character's native `move` once.
Every caller reaches it: the movement executor, direct combat steps in
`characters/shared.js`, and stop requests that move to the current position.

## Failure inventory

This list predates the implementation. Each line has a regression in
`scripts/tests/move-budget.test.cjs`.

1. A caller restarts walks in a loop (the 2026-10-15 tank approach churn) and
   floods `move`. The budget must cap issued moves per 4-second window however
   the caller behaves.
2. The budget defers the latest request. Dropping it leaves the character
   standing short of its destination, so the budget issues the newest deferred
   target as soon as the window frees.
3. A deferred request replaced by a newer one must settle. Native `move`
   resolves earlier promises with `{reason: "interrupted"}`, and the budget
   resolves superseded calls the same way so awaiting callers continue.
4. Moves at the ordinary approach cadence (one walk per 250 ms, each with a
   stop move) must pass through unchanged and in order.
5. Attacks, skills and chat share the server window. When `character.cc` is at
   or above the soft limit, moves defer even with budget left, and resume once
   `cc` falls.
6. A runtime reload installs movement again. The budget must wrap the native
   function, never its own wrapper, and dispose must resolve a pending deferred
   move as interrupted and restore native `move`.
7. Throttling must be visible. The budget reports one diagnostic per window
   with the deferred and superseded counts, not one per move.
8. Native rejections such as `cave_paused` and `unable` pass through to the
   caller of the move that was actually issued.
