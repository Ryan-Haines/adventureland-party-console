# Exchange rewards banked by default: failure inventory

Written before the change (#28, 2026-10-13 report: "exchange ruby -> the boxes stay in
inventory instead of being deposited to the bank"). `merchantExchange`
(characters/shared.js) records a reward only from the slot the game's `exchange()`
returns. The server clears the placeholder and then calls `add_item`, so a stackable
reward (boxes, scrolls, offerings) merges into a carried stack; the placeholder slot is
empty, `exchange()` returns no `num`, and the reward is never routed. Live journey:
`e2e/live-exchange-reward-bank.spec.ts`.

1. **Merged reward stranded.** A reward that merges into a carried stack of the same
   item stays in inventory although no merchant rule claims it.
2. **New-slot reward lost.** A reward that lands in a new slot (non-stacking item, or the
   first copy) is no longer recorded. Covered by the default-bank case in
   `live-economy.spec.ts`.
3. **Non-rewards banked.** Carried items the exchange did not add to (other stock, the
   shrinking input stack) are deposited.
4. **Locked stock banked.** A locked stack is deposited even if a reward of that name
   arrived.
5. **Rules bypassed.** A reward with an exchange, NPC-sale, stand, upgrade, compound or
   deconstruction rule is banked instead of staying carried. Covered by
   `live-economy.spec.ts`.
6. **Restart loses rewards.** Rewards recorded before a coordinator restart are dropped
   from the resumed job's checkpoint.

A merged stack is banked whole: the game cannot tell the new copies from the carried
ones, and the carried copies of an item with no rule would be routed to the bank too.
