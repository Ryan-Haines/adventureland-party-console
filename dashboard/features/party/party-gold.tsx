'use client';
import { Coins } from 'lucide-react';
import { abbreviatedGold } from './abbreviated-gold';
import type { PartyState } from './party-state';

// The header reads the coordinator's account gold (runtime/status/coordinator/state.ts
// `accountGoldSnapshot`), which counts an offline character's last reported gold and names that
// share, so the total marks it.
export function PartyGold({ state }: { state: PartyState }) {
  const { carried = null, offline = null, total = null } = state.accountGold ?? {};
  const exact = (value: number | null | undefined) =>
    value == null ? 'unknown' : value.toLocaleString();
  return (
    <div
      className="whitespace-nowrap font-mono text-sm text-amber-300"
      title={`Bank: ${exact(state.bankGold)}; carried: ${exact(carried)}, of which offline: ${exact(offline)}; combined: ${exact(total)} gold. Last reported balances; an offline character's gold may have changed in game, and transfers may have different sampling times.`}
    >
      <div className="flex items-center gap-1.5">
        <Coins className="h-4 w-4" />
        {state.bankGold == null ? '—' : abbreviatedGold(state.bankGold)}
      </div>
      <div className="mt-0.5 text-xs">
        ({total == null ? '—' : abbreviatedGold(total)} total
        {offline ? `, ${abbreviatedGold(offline)} offline` : ''})
      </div>
    </div>
  );
}
