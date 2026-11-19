import type { PartyState } from './party-state';

function describe(value: unknown): string {
  if (!value || typeof value !== 'object') return String(value);
  const rule = value as {tiers?:number; targetTier?:number; quantity?:number; price?:number};
  if (rule.tiers) return `${rule.tiers} upgrade levels · ${rule.quantity === -1 || rule.quantity === undefined ? 'Unlimited' : `${rule.quantity} remaining`}`;
  if (rule.targetTier) return `Compound to +${rule.targetTier} · ${rule.quantity === -1 || rule.quantity === undefined ? 'Unlimited' : `${rule.quantity} remaining`}`;
  if (rule.price) return `${rule.price.toLocaleString()}g`;
  return 'Automatic rule';
}

export function SharedRuleConflicts({ state, onResolve }: {
  state: PartyState; onResolve: (id: string, owner: string) => void;
}) {
  const conflicts = state.merchantRules?.conflicts || [];
  const incompatible = state.incompatibleRules || [];
  if (!conflicts.length && !incompatible.length) return null;
  return <section data-area="rule-conflicts" className="border-t border-amber-700 bg-zinc-950 p-4 text-amber-100">
    <p>Automatic rules awaiting a choice</p>
    {conflicts.map(conflict => <div key={conflict.id} className="mt-3 text-sm">
      <p>{conflict.family} · {conflict.key} · Paused</p>
      {conflict.choices.map(choice => <button key={choice.owner}
        className="mt-2 mr-2 rounded border border-amber-700 bg-zinc-900 px-3 py-2 text-amber-100 hover:border-amber-400 hover:bg-zinc-800"
        onClick={() => onResolve(conflict.id, choice.owner)}>
        Use {choice.owner}: {describe(choice.value)}
      </button>)}
    </div>)}
    {incompatible.map(({item,actions}) => <p key={`${item.name}:${item.level || 0}`} className="mt-3 text-sm">
      {item.name} +{item.level || 0} · {actions.join(' / ')} · Paused. Remove the unwanted rule from the sections above.
    </p>)}
  </section>;
}
