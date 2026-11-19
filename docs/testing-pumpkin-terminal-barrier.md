# Pumpkin terminal return barrier observations

Removed path: the movement rewrite removed the Hunt return's plan-return phase and its return legs (`returnLeg`, `returnLegs`, `leg-arrived`) as unreachable code, since every Hunt return is a continuous return and finishes through /convoy-complete. The return-leg hypothesis below names code that no longer exists.

## Failure inventory before observation code

Run 38452758672 shard 10, artifact 11844339685, Pumpkin physically reached Main within 24 seconds but failed its unchanged 180-second saved-checkpoint return. Native Priest observed Main new_map at +23.172 seconds and actual leave success at +23.457. Warrior movement completed at +23.5. Priest remained at Main (0,0) on its acknowledged terminal leave barrier for 166 seconds until the shared walk rendezvous timed out. No CODE replacement occurs in this case.

The existing terminal settlement path was already present in the failing commit. A completed HTTP barrier set is already latched per convoy object; no redundant latch is justified. A shared returnLeg reports leg-arrived and waits for release instead of calling /convoy-complete. An out-of-band owned terminal settlement could therefore finish one local route without its completion POST, but the artifact has no actual barrier request/response proof. This remains a hypothesis.

Possible causes to distinguish: no completion request; stale/mismatched owner rejection; a different transition key; response ready false/error; fresh response received but not applied; lost final arrival acknowledgement; convoy replacement. Passive observations must not intercept, replay, or change requests. Only exact local movement-barrier/convoy-complete identities and response readiness/error metadata are recorded; no full URLs, headers, accounts, or tokens. Bounded first/latest records and bounded pending reads preserve diagnostic cost. Existing native positions, acknowledgements, deadlines, and combat assertions stay unchanged.

Per-identity aggregates (maximum 64 exact actor/convoy/epoch/command/runtime/revision/route-version/transition/completion/destination keys) retain request and ready/error/failure counts plus first/latest times after rolling samples expire. Aggregate overflow is explicit; missing-receipt conclusions are invalid when coverage overflowed. No old rolling snapshot is used as an absence proof.
