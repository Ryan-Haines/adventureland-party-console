# PR 151 integration review

Keep the 1.5 branch's Cipher gathering, inventory transfers, minimax solver, door route and quotas, event drops, and Horseman add targeting. The duplicate syntax repair is already on 1.5.

Retain the event-only Bestiary, opted-in boss targeting, older-client priority compatibility, headless loader support, Cave floor delivery, merchant reopening, finished-visit cleanup, bounded revival ledger, and generated-floor fingerprint fix. Retain moving-boss rendezvous coalescing and the bounded grace for a silent member.

Excluded: the proposed timeout-driven forced return counts cancellations without binding them to an admitted request and current occurrence. Replayed or superseded cancels could force a newer journey home. Existing revision-fenced failure recovery remains authoritative. Exclude its invalid synthetic timeout test.

Excluded: the global test-reset override replaces the native schedule tick and marks every due occurrence missed. This would remove natural scheduling coverage from our existing journeys. Preserve the current native harness. Exclude the disabled geometry-reload test; it cannot demonstrate the claimed repair.

Integration failure cases: moving bosses may have different coordinates but must share map and instance; Cipher and door legs must retain destination identity. A stale attacker report or an event in another realm must not release convoy defense. Repeated full floor reports must not resend immutable art on every frame; a finished visit must release cached art even after map streams stop. Cave retries must retain all spent repair budgets, not only one counter. Duplicate moved code must not replace Horseman trash priority or run Cipher transfers twice.

Validation: focused ChronAL native journeys for boss avoidance, event catalog, older-client priorities, moving/silent rendezvous, cross-map event defense, Cipher priority handoff, headless Cave floors, and Cave merchant/retry. Console Bestiary journey verifies visible event descriptions. Typecheck and completed immutable candidate are required; activation remains explicit.

The headless fixture must launch the verified candidate's prepared native runner and lifecycle bundle. Launching the checkout's previously installed runner bypasses new handshake hooks; keep the native server handshake assertion and actual rendered-floor checks.
