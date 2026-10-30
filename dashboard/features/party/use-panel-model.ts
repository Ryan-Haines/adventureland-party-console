'use client';
import { levelPriceHistory } from './level-price-history';
import { occupiedStandSlots } from './stand-inspection';
import { useQueries, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { domainOptions, useVisible } from './query-cache';
import { characterKey } from './dashboard-live';
import { STAT_SCROLLS } from './stat-scrolls';
import { aggregateMonsterAchievements } from './monster-achievements';
import { emptyArray } from './empty-values';
import type { Char } from './char';
import type { PartyConsoleModel } from './use-party-console';
import type { Item } from './item';
import type { PartyState } from './party-state';
import { auditedCharacters } from './field-read-audit';
import { bankWithCatalogMeta, inventoryWithCatalogMeta } from './item-catalog-meta';

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
  const baseCharacters = model.state.characters;
  const names = useMemo(() => Object.keys(baseCharacters), [baseCharacters]);
  const subscriptions = useMemo(() => {
    const kinds: ('inventory' | 'vitals' | 'position' | 'diagnostics' | 'presence')[] = [];
    if (needs.inventory) kinds.push('inventory', 'presence');
    if (needs.vitals) kinds.push('vitals');
    if (needs.position ?? needs.vitals) kinds.push('position');
    if (needs.diagnostics) kinds.push('diagnostics');
    return kinds;
  }, [needs.inventory, needs.vitals, needs.position, needs.diagnostics]);
  // useQueries structurally shares the combined result, including unchanged
  // characters when another character receives an inventory update.
  // Item meta joins happen here so every panel reads catalog fields from the
  // entry itself; item-catalog-meta.ts keeps each join stable across polls.
  const catalog = model.state.merchantCatalog;
  const combineCharacters = useCallback((values: UseQueryResult<Partial<Char>>[]) =>
    Object.fromEntries(names.map((name, index) => [name, Object.assign(
      {}, baseCharacters[name], ...subscriptions.map(
        (kind, offset) => kind === 'inventory'
          ? inventoryWithCatalogMeta(catalog, values[index * subscriptions.length + offset].data)
          : values[index * subscriptions.length + offset].data,
      ),
    ) as Char])), [names, baseCharacters, subscriptions, catalog]);
  const combinedCharacters = useQueries({
    combine: combineCharacters,
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
  const characters = useMemo(() => auditedCharacters('merged', combinedCharacters), [combinedCharacters]);
  const domains = (['bank', 'market', 'logs'] as const).filter(
    (domain) => needs[domain],
  );
  const queries = useQueries({
    queries: domains.map((domain) => ({
      ...domainOptions(client, domain),
      enabled: visible,
    })),
    combine: combineDomains,
  });
  const state: PartyState = useMemo(() => {
    const combined: PartyState = Object.assign({}, model.state, ...queries.data, { characters });
    if (combined.bank) combined.bank = bankWithCatalogMeta(catalog, combined.bank);
    return combined;
  }, [model.state, characters, queries.data, catalog]);
  const merchant = characters[state.merchantCharacter || ''];
  const quantities: Record<string, number> = useMemo(() => {
    const totals: Record<string, number> = {};
    const add = (item?: Item | null) => {
      if (item && STAT_SCROLLS.some((entry) => entry.scroll === item.name))
        totals[item.name] =
          (totals[item.name] || 0) + Math.max(1, Number(item.q) || 1);
    };
    (merchant?.items || []).forEach((entry) => add(entry?.item));
    Object.values(state.bank?.packs || {}).forEach((pack) =>
      pack.forEach((entry) => add(entry?.item)),
    );
    return totals;
  }, [merchant?.items, state.bank?.packs]);
  const standObserved = model.standItem
    ? levelPriceHistory(
        state.standPriceHistory?.[model.standItem.entry.item.name],
        Number(model.standItem.entry.item.level) || 0,
      )
    : undefined;
  const marketAt = queries.updatedAt[domains.indexOf('market')] || 0;
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
  const chars = useMemo(() => model.chars.map((char) => characters[char.name]),
    [model.chars, characters]);
  const monsterAchievements = useMemo(
    () => aggregateMonsterAchievements(characters),
    [characters],
  );
  const standListings = state.standListings || emptyArray();
  const occupiedSlots = useMemo(
    () => occupiedStandSlots(standListings, state.nativeStand, merchant, state.standBids),
    [standListings, state.nativeStand, merchant, state.standBids],
  );
  return {
    ...model,
    state,
    chars,
    standObserved,
    standMarketCount,
    standMarketReference:
      standObserved?.marketLow || standObserved?.lowest || 0,
    statScrollInventory: quantities,
    monsterAchievements,
    occupiedStandSlots: occupiedSlots,
  };
}

function combineDomains(queries: UseQueryResult<Partial<PartyState>>[]) {
  return { data: queries.map(query => query.data), updatedAt: queries.map(query => query.dataUpdatedAt) };
}
