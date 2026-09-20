# Steam and merchant realm handling

The first Steam login keeps the realm chosen by the game client. Adding a
character away from account home pauses the handoff before releasing sessions.
The primary Steam window asks **Switch** or **Stay on this realm**. Switch moves
the Steam group home before adding companions; Stay applies only to that login.
Escape cancels. Home is never changed by either choice. Arrival requires fresh
CODE observations on the selected realm, rather than just matching names.

Party-bound merchant work checks fresh target and merchant realms before
selection and throughout rendezvous. A headless merchant follows its target,
waiting for a new heartbeat before dispatching service. One transition owns the
merchant for up to 60 seconds. Failed transitions retry after 10 seconds, twice;
exhausted jobs remain in logistics with a **Retry** control. Normal home/stand
handling resumes after party work. Home routing never restarts a Steam merchant.

A Steam merchant on another realm defers that visit and logs:
`merchant job failed: wrong realm (target was on US IV)`.
The visit becomes eligible when matching realms are observed. Other eligible
jobs can run while a visit is blocked or its retry is cooling down. Completed
receipts and improved items awaiting delivery survive a target realm change.

## Validation

Regression coverage: `steam-realm-choice.test.cjs`, `steam-group.test.cjs`,
`merchant-party-realm.test.cjs`, plus the existing dispatch, roster, completion,
and rendezvous suites. Activation follows `runtime/coordinator/README.md`.
The character loader refreshes published generations when its work is idle;
that refresh also installs the published Steam bridge. Verify fresh runtime
observations after restart rather than treating build success as activation.
