# Movement and marketplace failure regressions

## Barrier ownership (#27)

Failure modes recorded before the barrier fix:

- HTTP transport drops the server's rejection code, conflating supersession,
  early departure, and invalid itineraries.
- A superseded barrier fails the movement promise and reports a fresh convoy
  failure instead of retiring the old walk; late replies can affect replacement
  ownership or leave the old promise unresolved.
- An early-departure rejection dispatches a transition too soon, consumes route
  retries, or replays a transition whose arrival is already being acknowledged.
- Unknown 409 errors are swallowed, while true timeouts lose bounded retry and
  communication-hold behavior.
- Movement diagnostics label an ownership cancellation as a terminal failure.

Extend retained barrier/transport and shared-convoy integration checks before
production edits. These exceptions inject exact HTTP races through maintained
client functions and the movement executor; the native fixture cannot reliably
schedule a coordinator epoch change between a barrier request and its response.
Keep existing native convoy/Town E2Es as the game-behavior validation and retain
their checksummed artifacts. No claim is made that those journeys inject #27.

Barrier rejection codes remain attached to request errors. A superseded 409 or
locally replaced barrier owner cancels only the old movement and retires its
convoy coroutine without sending `/convoy-failed`. The before-departure 409 is
gone: a walk is in its travel phase before any member departs,
so no barrier request can arrive before departure. Missing/expired leases retain communication
recovery; invalid or unrecognized rejections retain failure handling.

Repeat the retained checks with `node --test scripts/tests/barrier-communication.test.cjs
scripts/tests/movement-barrier.test.cjs scripts/tests/shared-convoy.test.cjs
scripts/tests/convoy-communication.test.cjs scripts/tests/movement-service.test.cjs`.
Publish the character assets and use the full supported restart from the
coordinator README to activate this change; building alone does not activate it.

## Planner and marketplace failures (#29, #26)

Failure modes recorded before implementation for issues #29 and #26:

- A planner rejection becomes HTTP 503 and is mistaken for a transport outage,
  preventing native fallback and indefinitely preserving the route retry budget.
- Planner failures without a route-related word (including native-only mode and
  worker startup failures) skip fallback even when returned as normal responses.
- Actual network, timeout, or HTTP availability failures incorrectly start native
  movement instead of preserving the communication hold and request metadata.
- Native fallback failure is reported as a temporary pause, or its original
  planner rejection is lost from terminal diagnostics.
- A command-level catch logs an already reported movement hold as a second,
  misleading generic command failure.
- Successful plans, response identity checks, cancellation ownership, and native
  search bounds regress while changing the error response.
- An ALData sell command disappears after first delivery, so a replacement worker
  on the destination realm cannot receive the same job and command identity.
- Retention reintroduces completed commands or changes one-shot command delivery.

Extend the retained movement-service and heartbeat-composition exceptions before
changing production code. Exercise the real movement HTTP handler with the
movement service, including a planner rejection and a genuine HTTP failure;
retain existing return-planner checks for parallel candidate failures. The
heartbeat boundary must redeliver the same sale job across successive runtime
reports until completion removes it. These are protocol checks, not proof of
native travel or an actual cross-realm sale. The disposable native E2E server
has one realm and cannot establish a cross-realm marketplace transaction.

Run existing console/native E2Es when the environment supports them, preserve
their reports, and report any setup blockers separately from regression results.
