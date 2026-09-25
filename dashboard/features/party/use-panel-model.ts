'use client';
import { levelPriceHistory } from './level-price-history';
import { occupiedStandSlots } from './stand-inspection';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { domainOptions, useVisible } from './query-cache';
import { characterKey } from './dashboard-live';
import { STAT_SCROLLS } from './stat-scrolls';
import { aggregateMonsterAchievements } from './monster-achievements';
import type { Char } from './char';
import type { PartyConsoleModel } from './use-party-console';
import type { Item } from './item';
import type { PartyState } from './party-state';

export function usePanelModel<T extends Pick<PartyConsoleModel, 'state' | 'chars'> & Partial<Pick<PartyConsoleModel, 'standItem'>>>(
  model: T,
  needs: {
    inventory?: boolean;
    vitals?: boolean;
    position?: boolean;
    diagnostics?: boolean;
    bank?: boolean;
    market?: boolean;
    logs?: boolean;
  },
) {
  const client = useQueryClient(),
    visible = useVisible();
  const names = Object.keys(model.state.characters);
  const kinds = (['inventory', 'vitals', 'position', 'diagnostics'] as const).filter(
    (kind) => kind === 'position' ? needs.position ?? needs.vitals : needs[kind],
  );
  const subscriptions: ((typeof kinds)[number] | 'presence')[] = needs.inventory
    ? [...kinds, 'presence']
    : kinds;
  const values = useQueries({
    queries: names.flatMap((name) =>
      subscriptions.map((kind) => ({
        queryKey: characterKey(name, kind),
        enabled: false,
        staleTime: Infinity,
        gcTime: 60000,
        queryFn: (): Partial<Char> => ({}),
      })),
    ),
  });
  const domains = (['bank', 'market', 'logs'] as const).filter(
    (domain) => needs[domain],
  );
  const queries = useQueries({
    queries: domains.map((domain) => ({
      ...domainOptions(client, domain),
      enabled: visible,
    })),
  });
  const characters = Object.fromEntries(
    names.map((name, index) => [
      name,
      Object.assign(
        {},
        model.state.characters[name],
        ...subscriptions.map(
          (_, kind) => values[index * subscriptions.length + kind].data,
        ),
      ) as Char,
    ]),
  );
  const state: PartyState = Object.assign(
    {},
    model.state,
    ...queries.map((query) => query.data),
    { characters },
  );
  const quantities: Record<string, number> = {};
  const add = (item?: Item | null) => {
    if (item && STAT_SCROLLS.some((entry) => entry.scroll === item.name))
      quantities[item.name] =
        (quantities[item.name] || 0) + Math.max(1, Number(item.q) || 1);
  };
  const merchant = characters[state.merchantCharacter || ''];
  (merchant?.items || []).forEach((entry) => add(entry?.item));
  Object.values(state.bank?.packs || {}).forEach((pack) =>
    pack.forEach((entry) => add(entry?.item)),
  );
  const standObserved = model.standItem
    ? levelPriceHistory(
        state.standPriceHistory?.[model.standItem.entry.item.name],
        Number(model.standItem.entry.item.level) || 0,
      )
    : undefined;
  const marketAt = queries[domains.indexOf('market')]?.dataUpdatedAt || 0;
  const standMarketCount = model.standItem
    ? (state.aldata?.listings || [])
        .filter(
          (listing) =>
            listing.seenAt >= marketAt - 120000 &&
            listing.serverIdentifier !== 'PVP' &&
            listing.item.name === model.standItem!.entry.item.name &&
            Number(listing.item.level || 0) ===
              Number(model.standItem!.entry.item.level || 0) &&
            (listing.item.p || null) ===
              (model.standItem!.entry.item.p || null),
        )
        .reduce(
          (sum, listing) => sum + Math.max(1, Number(listing.quantity) || 1),
          0,
        )
    : 0;
  return {
    ...model,
    state,
    chars: model.chars.map((char) => characters[char.name]),
    standObserved,
    standMarketCount,
    standMarketReference:
      standObserved?.marketLow || standObserved?.lowest || 0,
    statScrollInventory: quantities,
    monsterAchievements: aggregateMonsterAchievements(characters),
    occupiedStandSlots: occupiedStandSlots(state.standListings || [], state.nativeStand, merchant, state.standBids),
  };
}
