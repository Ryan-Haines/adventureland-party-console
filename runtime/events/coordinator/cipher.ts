// The Cipher's one item rule:
// while a round's plan is live on the merchant, its
// ingredients belong with the merchant. the events owner states that as a claim through the items owner's `items.claim`, the path
// compound inputs take; the items owner keeps the merchant's copies and fetches the stored ones on its normal bank
// visit. The merchant's walk to the Witch waits while the items owner's `items.claimPending` names copies on the
// way. Nothing here reads the bank or banks an ingredient.
import { cipherEntry, cipherIngredients, type CipherGatheringPlan } from '../october.ts';
import { partyHooks } from '../../hooks/index.ts';
import type { ItemClaimAsk, ItemClaimView } from '../../hooks/registry.ts';

// The registration that states the claim; 10 names the claim's `by` after it.
export const CIPHER_CLAIMER = 'core:event-returns';
interface CipherReport { eventSchedules?: { id: string; cipher?: { board?: { id?: string } | null; runtime?: { journal?: { gathering?: CipherGatheringPlan } } } }[] }
export interface CipherClaimParty { merchantCharacter: string | null; statuses: Record<string, unknown> }

// The round whose plan the merchant's report carries, while that plan is not finished.
function liveRound(party: CipherClaimParty): string | null {
  const report = party.statuses[String(party.merchantCharacter)] as CipherReport | undefined;
  const cipher = cipherEntry(report);
  const round = cipher?.board?.id, plan = cipher?.runtime?.journal?.gathering;
  return round && plan?.round === round && plan.mode !== 'finished' ? round : null;
}

/** `items.claim` on each member's view while a round lives: every copy of each ingredient belongs
 * at the merchant, which a fighter hands over at the Witch, so no bank rule takes it. */
export function cipherClaims(party: CipherClaimParty, _view: ItemClaimView): ItemClaimAsk[] {
  if (!liveRound(party)) return [];
  return cipherIngredients.map(name => ({ item: { name }, quantity: { all: true }, place: 'merchant', reason: 'cipher' }));
}

/** Whether the merchant's walk to the Witch waits: 10 still fetches the round's ingredients to its bag. */
export function cipherFetching(party: CipherClaimParty, name: string, round: string | undefined): boolean {
  return !!round && name === party.merchantCharacter && liveRound(party) === round &&
    partyHooks().ask('items.claimPending', name, CIPHER_CLAIMER) > 0;
}
