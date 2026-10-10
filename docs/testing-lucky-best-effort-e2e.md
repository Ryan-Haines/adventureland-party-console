# Best-effort lucky restoration

The focused native run passes all four journeys: changed cargo with a sequential
cursor, changed cargo with a locked cursor, party deliveries during restoration,
and stale local receipts followed by real production after restart. The retained
evidence is in `.build/lucky-isolated/e2e-results/` and its report in
`.build/lucky-isolated/e2e-report/`; 126 evidence files pass hash verification.
This run uses separate report/output directories because another session's
console run cleared the shared Playwright trace directory during an earlier run.
Its isolated configuration and reporter are retained in the reproduction folder.

Repeat the focused scenarios with:

```powershell
npm test -- -- --project=live --workers=1 --grep "best-effort lucky restoration|lucky upgrade preserves party deliveries|buy with upgrade target survives lucky restoration"
npm run test:e2e:verify
```

Failure inventory: a genuine completed upgrade leaves a stale displaced-item
fingerprint after a real incoming stack changes; an actual inventory swap moves
the result away from its lucky position; swapback then fences unrelated merchant
work indefinitely or overwrites changed cargo. CODE/coordinator restart can
replay an operation, duplicate roll evidence, or lose the sequential cursor.
A locked slot must continue accumulating rolls without advancing its position.

The native journey declares initial cargo only. After a genuine upgrade reaches
its restoring checkpoint, a real party send changes the displaced stack and a
native swap relocates the upgraded result. No upgrade, receipt, movement, or
inventory outcome is fabricated. Require real completed inventory, conserved
cargo, retired lucky journal, a subsequent ordinary purchase, CODE replacement
and coordinator restart, and a second genuine upgrade at the expected next or
locked slot. Persisted per-slot counts must increase exactly once per attempt.
Finally retain checkpoint, inventory, coordinator, native-event and error proof.

Initial execution failed before gameplay because the historical fixture allowlist
did not admit the established luckySlotResume/luckySlotLocks fields. Its stopped
coordinator caused the finally state capture to mask that rejection with HTTP503.
Admit only those declared configuration keys and retain capture errors separately
so diagnostic attachment cannot replace the original failure. Runtime replacement
is observed through the public dashboardRuntime identity.

The next execution exposed fixture readiness errors: coordinator restart retires
the fresh merchant catalog, so declare catalog readiness after restart and again
before each distinct purchase. An injected stale production journal for an already
finished order is reconciled before subsequent real work, rather than by idle.
Require a native shoes +1 production order and its actual upgraded-item increase before checking
that this historical journal has retired; preserve both genuine upgraded results.

Changed positions must not be asserted after ordinary inventory tidy resumes.
Instead wrap the native swap boundary, forwarding every real call unchanged, and
retain any attempted old from/to swap while the changed journal is restoring.
The forbidden-swap ledger must remain empty; conserved native cargo and genuine
result counts remain required after completion and restart.

A plain level-zero purchase does not enter production preflight and therefore
cannot prove stale production-journal reconciliation. The recovery scenario uses
a genuine shoes +1 upgrade, retains its native result check, and then requires the
historical journal to clear. No runtime behavior or assertion is relaxed.
