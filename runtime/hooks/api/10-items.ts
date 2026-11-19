// Owner 10's published functions and types for add-ons: one re-export line each with its comment.
// Only 10's build writes this file, and runtime/hooks/addon-api.ts re-exports it.

// What `items.claim` receives and answers, and what `items.action` receives.
export type { ItemClaimView, ItemClaimAsk, ItemActionAsk, ItemActionAnswer, ActionOrder } from '../registry.ts';
// The items owner's notices, read-only.
export type { ItemsNotice } from '../registry.ts';
// A claim with its `by`, and a copy's fate with its I1 row.
export type { Claim, Fate } from '../../items/rules.ts';
// A job's needs, as `items.needs` answers them.
export type { ItemNeeds } from '../../items/coordinator/api.ts';
// The copy an item key is built from.
export type { ItemCopy as ItemKey } from '../../items/identity.ts';
// The keys an item is matched by: a copy, a rule (name@+level), an exchange (name@level), a stack,
// a storage cell, a listing, a seller and a Ponty lot.
export { copyKey, ruleKey, exchangeKey, stackKey, storageKey, listingKey, sellerKey, pontyGroupKey, pontyKey, sameItem, sameItemState } from '../../items/identity.ts';
// The game's item value (calculate_item_value), the one copy Ponty's prices read.
export { itemValue } from '../../items/rules.ts';
// Whether a market listing seen at `seenAt` is still fresh.
export { marketListingFresh } from '../../items/rules.ts';
// The free cells a bag keeps for a visit's logistics, from the player's "Protected free slots".
export { protectedSlotsOf } from '../../items/rules.ts';
// One lot on Ron's last list with the price his buy spends, as `npc.lostAndFoundList` reads it.
export type { RonListed } from '../../items/api.ts';
