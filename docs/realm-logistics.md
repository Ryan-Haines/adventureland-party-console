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
merchant for up to 60 seconds. The merchant realm owner (runtime/merchant-realm/)
books a transition that misses that window as one failure of the merchant group's
`realm-hold` ladder and tries again on its next rung, with no count that ends it;
the **Retry** control runs the next attempt now (`realm.retry`). Normal home/stand
handling resumes after party work. Home routing never restarts a Steam merchant.

## Who moves the merchant, and where it may go

The realm owner (runtime/merchant-realm/rules.ts, coordinator/owner.ts)
holds every want for the merchant's realm and grants the highest one; a lower
want answers `moving` and is asked again when the higher one is released. The
wants, highest first: a party realm switch (`party-switch:<id>`), your force
stand hold (`user:force-stand`), the current job's listing hop or party visit
(`job:<id>`, live while that job is current), the items owner's realm stay
after a market job (`items:stay`), and home. With no other want the merchant
goes home. A job's hop holds the merchant's `realm-hold` task only inside the
60 second window; a home or force stand return holds it until arrival.

The refusal table refuses a want before it ranks:

- a realm ending in `PVP` is refused for every want, an order you give
  included;
- a realm on your **Merchant realm blacklist** (`merchantRealmBlacklist`,
  empty at first) is refused for automatic work: a party visit to a member on
  it waits with "Waiting for <member> to leave <realm>, which is on your realm
  blacklist", and an automatic listing hop to it is answered 409 with
  "<realm> is on your realm blacklist";
- an order you give for a blacklisted realm (a manual job, a party realm
  switch, set home, force stand) asks your confirmation, answered 409 with
  `needsConfirmation` until you confirm; the confirmation binds that one order,
  and a party switch carries it to every want it asks, its merchant leg
  included;
- the home want is never refused by the blacklist, so the merchant can always
  get home.

A Steam merchant on another realm defers that visit and logs:
`merchant job failed: wrong realm (target was on US IV)`.
The visit becomes eligible when matching realms are observed. Other eligible
jobs can run while a visit is blocked or its retry is cooling down. Completed
receipts and improved items awaiting delivery survive a target realm change.

## Validation

Regression coverage: `steam-realm-choice.test.cjs`, `steam-group.test.cjs`,
`merchant-party-realm.test.cjs`, `realm-owner.test.cjs` (the wants, refusals,
arrival and the blacklist), `coordinator-realm-switch.test.cjs` (the party switch), plus the existing dispatch, roster, completion,
and rendezvous suites. Activation follows `runtime/coordinator/README.md`.
The character loader refreshes published generations when its work is idle;
that refresh also installs the published Steam bridge. Verify fresh runtime
observations after restart rather than treating build success as activation.
