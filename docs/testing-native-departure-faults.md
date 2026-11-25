# Native departure fault injection failure inventory

Superseded 2026-11-04: a walk departs at once and each member departs on
the first reply that carries the travel phase, so there is no departure deadline to cross.
`e2e/departure-signal-fault.ts` now holds one member's first travel reply for 1.5 s, and
`e2e/live-hunt-departure.spec.ts` checks that the member departs late under the same epoch,
with no recovery attempt, and that every member arrives. The notes below describe the
deadline injector it replaced.

Recorded before changing the fault injector. CI forwarded only two scheduled epochs; the fixture used coordinator serverNow to calculate a relative browser timer, then separately crossed CDP transport and native client clock estimation. It recorded response forwarding, not actual blocked execution. A timer can therefore miss the intended deadline without evidence.

Use the character runner's same coordinator clock offset as its movement scheduler. Block the actual event loop through departure plus two seconds, retain native started/ended timestamps, and count only completed real deadline-crossing stalls. Do not generate movement acknowledgements, change destinations, consume recovery budget, or increase timeouts. Preserve actual arrival and zero physical retries assertions.
# Native timer scheduling failure observed in run 38216828516

All three injected stalls ran, but callbacks scheduled only 100ms before departure began 574–979ms after it. Hidden native frames and busy browser event loops cannot guarantee sub-second timer dispatch. Start each real stall immediately after observing the scheduled signal, while its deadline is still several seconds ahead; block through deadline + 2 seconds and retain the unchanged cross-deadline receipts and physical recovery assertions. Do not count a late-start callback as a successful injected fault.
