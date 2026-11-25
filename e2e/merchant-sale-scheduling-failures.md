# Merchant sale scheduling failure inventory

- Retry/recovery paths can append cleanouts outside ordinary queue admission;
  persisted duplicates must collapse without changing an active command identity.
- Collapsing retries must preserve the oldest queue age, latest eligibility time
  and highest retry counters, rather than resetting the retry budget.
- Continuous party service can starve bank-sale discovery. Discovery must run
  during unrelated party work, while merchant-owned inventory operations retain
  their existing snapshot boundary.
- Bank retrieval can invert priorities: a highest-priority sale must lend its
  priority to the enabled withdrawal prerequisite, without enabling disabled
  withdrawals or sales, or bypassing collection thresholds.
- Whole-stack withdrawals must not consume reserved copies. Native sales must
  leave exact gear and stack reserves, including after coordinator restart.
- Native completion, inventory, persisted rules and public queue state are
  separate milestones. Poll exact fresh observations and retain native receipts.

Repeat with `npm run test:e2e:live -- e2e/windows/W51-merchant-bank-day.spec.ts`
(ChronAL is the default backend). W51 plays the bank sale scheduling rows of
`live-bank-npc-sales.spec.ts` at 21fe30a2b.
