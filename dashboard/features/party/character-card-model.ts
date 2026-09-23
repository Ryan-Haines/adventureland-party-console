'use client';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PartyConsoleModel } from './use-party-console';

const inventoryActions = ['command', 'post', 'setActionError', 'setStandItem', 'setNpcSaleItem',
  'setAutoNpcSaleItem', 'clearAutomaticSales', 'removeAutomaticSale', 'setSelected',
  'setGearComparison', 'sendCharacter'] as const;
const cardActions = ['formation', 'logout', 'post', 'setFarmingPolicy', 'setSelectedCondition',
  'command', 'bankParty', 'clearMerchantWork', 'setForceStand', 'cancelMerchantJob',
  'setRoutinesOpen', 'gather', 'refresh', 'setCommerceMode', 'setDonationOpen', 'setGiveawayRealm',
  'setGiveawayMerchant', 'setGiveawayOpen', 'findMonsterFor', 'setFocus', 'saveRestock',
  'moveSteamToHeadless', 'joinOrPromoteSteam', 'setAnniversaryOpen', 'setMonsterNavigateTarget',
  'setSelected', 'setSelectedBestiaryMonster', 'setActionError', 'clearCollectionErrors',
  'editThreshold', 'save', 'editItemCollectionThreshold', 'saveItemCollectionThreshold'] as const;
type ActionKey = (typeof inventoryActions)[number] | (typeof cardActions)[number];
function forwardingActions(getModel: () => PartyConsoleModel) {
  return Object.fromEntries([...new Set<ActionKey>([...inventoryActions, ...cardActions])].map(key => [key,
    (...args: unknown[]) => Reflect.apply(getModel()[key], undefined, args)])) as Pick<PartyConsoleModel, ActionKey>;
}
export type InventoryModel = Pick<PartyConsoleModel, (typeof inventoryActions)[number] | 'state' | 'chars' | 'detailMeta'>;
export type CharacterCardModel = Pick<PartyConsoleModel, (typeof cardActions)[number] |
  'state' | 'monsters' | 'monsterAchievements' | 'selectedFocus' | 'threshold' |
  'itemCollectionThreshold' | 'thresholdError' | 'itemCollectionThresholdError'>;

/** Event-only forwarding: stable identities, but always call the latest committed
 * action closure. Rendering dependencies are explicitly carried in the models. */
function useCardActions(model: PartyConsoleModel) {
  const latest = useRef(model);
  useLayoutEffect(() => { latest.current = model; }, [model]);
  const getModel = useCallback(() => latest.current, []);
  // The factory only creates event handlers; it never invokes getModel during
  // render. The compiler cannot infer that through Reflect.apply.
  // eslint-disable-next-line react/react-compiler
  const [actions] = useState(() => forwardingActions(getModel));
  return actions;
}
export function useCharacterCardModels(model: PartyConsoleModel) {
  const actions = useCardActions(model);
  const { state, chars, detailMeta, monsters, monsterAchievements, selectedFocus, threshold,
    itemCollectionThreshold, thresholdError, itemCollectionThresholdError } = model;
  const inventory: InventoryModel = useMemo(() => ({ ...actions, state, chars, detailMeta }),
    [actions, state, chars, detailMeta]);
  const card: CharacterCardModel = useMemo(() => ({ ...actions, state, monsters, monsterAchievements,
    selectedFocus, threshold, itemCollectionThreshold, thresholdError, itemCollectionThresholdError }),
    [actions, state, monsters, monsterAchievements, selectedFocus, threshold,
      itemCollectionThreshold, thresholdError, itemCollectionThresholdError]);
  return { card, inventory };
}
