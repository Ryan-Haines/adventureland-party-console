'use client';
import { UpgradeOfferingProvider } from './upgrade-offering-controls';
import { SharedRuleConflicts } from './shared-rule-conflicts';
import { MerchantPendingImprovements } from './merchant-pending-improvements';
import { automaticCommerceRuleKey } from './automatic-commerce-rule-key';
import { InventoryPanel } from './inventory-panel';
import { same } from './same';
import type { PartyConsoleModel } from './use-party-console';

import { memo, useEffect, useState } from 'react';
import { DeconstructionConfirmation, type DeconstructionSelection } from './deconstruction-confirmation';
import { committedLiveRecord } from './live-metrics';
import { usePanelModel } from './use-panel-model';
export const ConnectedInventory = memo(function ConnectedInventory({
  name,
  model: base,
}: {
  name: string;
  model: PartyConsoleModel;
}) {
  const model = usePanelModel(base, { inventory: true });
  const {
    state,
    chars,
    command,
    setNotice,
    setStandItem,
    setNpcSaleItem,
    setAutoNpcSaleItem,
    clearAutomaticSales,
    removeAutomaticSale,
    statScrollInventory,
    setSelected,
    detailMeta,
    setGearComparison,
    sendCharacter,
  } = model;
  const char = state.characters[name];
  useEffect(() => {
    committedLiveRecord(name);
  }, [name, char.items, char.slots]);
  const ruleName = state.merchantRules ? String(state.merchantCharacter) : name;
  const marked = state.marked[name] || [];
  const [deconstructionSelection, setDeconstructionSelection] = useState<DeconstructionSelection | null>(null);
  return (
    <UpgradeOfferingProvider character={char.name} stock={state.upgradeOfferingStock || {}} rules={state.upgradeOfferingRules || []} catalog={state.merchantCatalog?.allItems || []} post={model.post}>
    <InventoryPanel
      character={char}
      sharedRules={!!state.merchantRules}
      characters={chars}
      leader={state.leader}
      merchant={state.merchantCharacter}
      merchantWeapon={state.merchantWeapon}
      luckyUpgradeSlot={state.luckyUpgradeSlots?.[name]}
      marked={marked}
      merchantMarked={state.merchantMarked?.[char.name] || []}
      autoItemMarks={state.autoItemMarks?.[ruleName] || {}}
      autoUpgradeMarks={state.autoUpgradeMarks?.[ruleName] || {}}
      allAutoUpgradeMarks={state.autoUpgradeMarks || {}}
      merchantDeliveries={state.merchantDeliveries || {}}
      standListings={state.standListings || []}
      standBids={state.standBids || {}}
      autoNpcSales={state.autoNpcSales || {}}
      npcSaleMarks={state.npcSaleMarks || []}
      deconstructionMarks={state.deconstructionMarks || []}
      autoDeconstruction={state.autoDeconstruction?.[ruleName] || {}}
      deconstructionCatalog={state.deconstructionCatalog || {}}
      onDeconstruction={(entry, auto, remove, id) => {
        if (!remove) { setDeconstructionSelection({ entry, auto }); return; }
        void model.post(auto ? '/deconstruction/auto' : '/deconstruction/mark', {
          character: id ? state.deconstructionMarks?.find(mark => mark.id === id)?.owner || char.name : char.name, slot: entry.slot, item: entry.item, remove, id,
        });
      }}
      onRetryDeconstruction={(id) => void model.post('/deconstruction/mark', { character: state.deconstructionMarks?.find(mark => mark.id === id)?.owner || char.name, id, retry: true })}
      onRemoveNpcSale={(id) => void model.post('/merchant/npc-sale', { character: state.npcSaleMarks?.find(mark => mark.id === id)?.character || char.name, id, remove: true })}
      autoStandMarks={state.autoStandMarks || {}}
      buyable={state.merchantCatalog?.buyable || []}
      catalog={state.merchantCatalog?.allItems || []}
      priceHistory={state.standPriceHistory || {}}
      onStand={(entry) => {
        const existing = (state.standListings || []).find(
          (mark) => mark.slot === entry.slot && same(mark.item, entry.item),
        );
        if (!existing && (state.standListings || []).length >= 16)
          return setNotice('Merchant stand is full (16/16)');
        const value = { defaultPrice: Math.max(1, Number(entry.meta?.definition.g) || 1) };
        setStandItem({
          entry,
          defaultPrice: value.defaultPrice,
          markAll: false,
          price: String(existing?.price || value.defaultPrice),
          quantity: String(existing?.quantity || entry.item.q || 1),
        });
      }}
      onNpcSale={(entry) =>
        setNpcSaleItem({
          source: char.name === state.merchantCharacter ? 'merchant' : 'character',
          character: char.name === state.merchantCharacter ? undefined : char.name,
          entry,
          quantity: String(entry.item.q || 1),
          acknowledged: false,
        })
      }
      onAutoNpcSale={(entry) => setAutoNpcSaleItem({ ...entry,
        character: char.name === state.merchantCharacter ? undefined : char.name })}
      onAutoStand={(entry) => {
        const value = { defaultPrice: Math.max(1, Number(entry.meta?.definition.g) || 1) };
        const existing =
          state.autoStandMarks?.[automaticCommerceRuleKey(entry.item)];
        setStandItem({
          entry,
          defaultPrice: value.defaultPrice,
          markAll: false,
          auto: true,
          price: String(existing?.price || value.defaultPrice),
          quantity: String(entry.item.q || 1),
        });
      }}
      onClearAutomaticSales={(kind) => {
        if (kind === 'npc' && char.name !== state.merchantCharacter)
          void model.post('/merchant/auto-npc-sale', { character: char.name, action: 'clear-all' });
        else void clearAutomaticSales(kind);
      }}
      onRemoveAutomaticSale={(kind, item) =>
        kind === 'npc' && char.name !== state.merchantCharacter
          ? void model.post('/merchant/auto-npc-sale', { character: char.name, item, action: 'remove' })
          : void removeAutomaticSale(kind, item)
      }
      upgradeMarks={state.upgrades?.[char.name] || []}
      statScrollMarks={state.statScrolls?.[char.name] || []}
      statScrollInventory={statScrollInventory}
      compoundGroups={state.compounds?.[char.name] || []}
      autoCompoundMarks={state.autoCompounds?.[ruleName] || []}
      allAutoCompoundMarks={state.autoCompounds || {}}
      autoExchanges={state.autoExchanges || {}}
      onSelect={(entry) =>
        setSelected({
          character: char.name,
          entry: {
            ...entry,
            meta: detailMeta(entry.item, entry.meta),
          },
          ...(char.name === state.merchantCharacter
            ? { source: { kind: 'merchant' as const } }
            : {}),
        })
      }
      onCompare={(entry, slot) =>
        setGearComparison({
          character: char,
          slot,
          entry: {
            ...entry,
            meta: detailMeta(entry.item, entry.meta),
          },
        })
      }
      onCommand={command}
      onTravel={() => sendCharacter(char.name)}
    />
    {char.name === state.merchantCharacter && <><MerchantPendingImprovements state={state} /><SharedRuleConflicts state={state} onResolve={(id, owner) => model.post("/merchant/rule-conflict", {id,owner})} /></>}
    <DeconstructionConfirmation selection={deconstructionSelection} catalog={state.deconstructionCatalog || {}}
      items={state.merchantCatalog?.allItems || []} onClose={() => setDeconstructionSelection(null)}
      onConfirm={async ({ entry, auto }) => {
        await model.post(auto ? '/deconstruction/auto' : '/deconstruction/mark', { character: char.name, slot: entry.slot, item: entry.item });
      }} />
    </UpgradeOfferingProvider>
  );
});
