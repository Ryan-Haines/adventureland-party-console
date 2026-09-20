import { upgradeOfferings, isUpgradeOffering } from '../../../runtime/upgrade-offerings';
import type { PartyState } from './party-state';

export function MerchantPendingImprovements({ state }: { state: PartyState }) {
  const upgrades = Object.entries(state.upgrades || {}).flatMap(([owner, marks]) =>
    (marks || []).filter(mark => !mark.auto || mark.waitingOffering).map(mark => ({
      key: `${owner}:upgrade:${mark.slot}`, owner, name: mark.item.name,
      detail: `+${mark.item.level || 0} → +${Number(mark.item.level || 0) + Number(mark.tiers || 1)}${mark.equipped ? ` · ${mark.slot}` : ''}`,
    })));
  const compounds = Object.entries(state.compounds || {}).flatMap(([owner, groups]) =>
    (groups || []).map(group => ({ key: `${owner}:compound:${group.id}`, owner,
      name: group.items[0]?.item.name || 'Compound', detail: 'Compound · awaiting merchant',
    })));
  const rows = upgrades.concat(compounds);
  if (!rows.length) return null;
  return <details className="border-t border-violet-800 bg-zinc-950 p-4 text-violet-100">
    <summary className="cursor-pointer text-sm">Pending improvements · {rows.length}</summary>
    {rows.map(row => <p key={row.key} className="mt-2 text-sm">{row.owner} · {row.name} · {row.detail}</p>)}
  </details>;
}
