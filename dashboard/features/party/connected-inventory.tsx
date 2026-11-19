'use client';
import { aggregateSlotTracking, commerceRuleKey, defaultStandPrice, luckySlotAnswer } from '../../../runtime/items/api.ts';
import { UpgradeOfferingProvider } from './upgrade-offering-controls';
import { SharedRuleConflicts } from './shared-rule-conflicts';
import { InventoryPanel } from './inventory-panel';
import { standDraft, standIsFull } from './stand-capacity';
import { LuckySlotDialog } from './lucky-slot-tracker';
import type { InventoryModel } from './character-card-model';
import type { InventoryEntry } from './inventory-entry';
import type { Item } from './item';

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DeconstructionConfirmation, type DeconstructionSelection } from './deconstruction-confirmation';
import { usePanelModel } from './use-panel-model';
import { emptyArray, emptyRecord } from './empty-values';
// A stand listing's starting price: the item's catalog gold value, at least 1.
export const ConnectedInventory = memo(function ConnectedInventory({
  name,
  model: base,
  restock,
}: {
  name: string;
  model: InventoryModel;
  restock?: ReactNode;
}) {
  const model = usePanelModel(base, { inventory: true });
  const {
    state,
    chars,
    command,
    setActionError,
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
    post,
    send,
  } = model;
  const char = state.characters[name];
  const ruleName = state.merchantRules ? String(state.merchantCharacter) : name;
  const marked = state.marked[name] || emptyArray();
  const [deconstructionSelection, setDeconstructionSelection] = useState<DeconstructionSelection | null>(null);
  const [luckySlotOpen, setLuckySlotOpen] = useState(false);
  const luckyTracking = useMemo(
    () => aggregateSlotTracking(state.luckySlotTracking?.[name], char?.luckySlotTracking),
    [state.luckySlotTracking, name, char?.luckySlotTracking],
  );
  const lucky = useMemo(() => luckySlotAnswer(state, name),
    [state.luckySlotLocks?.[name], state.luckySlotResume?.[name], state.luckyUpgradeSlots?.[name], name]);
  const onLuckySlot = useCallback(() => setLuckySlotOpen(true), []);
  const deconstructionMarks = state.deconstructionMarks || emptyArray();
  const standListings = state.standListings || emptyArray();
  const npcSaleMarks = state.npcSaleMarks || emptyArray();
  const onDeconstruction = useCallback(
    (entry: InventoryEntry, auto: boolean, remove: boolean, id?: string) => {
      if (!remove) { setDeconstructionSelection({ entry, auto }); return; }
      send(auto ? '/deconstruction/auto' : '/deconstruction/mark', {
        character: id ? deconstructionMarks.find((mark) => mark.id === id)?.owner || name : name, slot: entry.slot, item: entry.item, remove, id,
      });
    },
    [send, deconstructionMarks, name],
  );
  const onRetryDeconstruction = useCallback(
    (id: string) => send('/deconstruction/mark', { character: deconstructionMarks.find((mark) => mark.id === id)?.owner || name, id, retry: true }),
    [send, deconstructionMarks, name],
  );
  const onRemoveNpcSale = useCallback(
    (id: string) => send('/merchant/npc-sale', { character: npcSaleMarks.find((mark) => mark.id === id)?.character || name, id, remove: true }),
    [send, npcSaleMarks, name],
  );
  const onStand = useCallback(
    (entry: InventoryEntry) => {
      const press = standDraft({ standSlots: state.standSlots, standListings }, entry);
      if ('refused' in press) return setActionError(press.refused);
      setStandItem(press.draft);
    },
    [state.standSlots, standListings, setActionError, setStandItem],
  );
  const onNpcSale = useCallback(
    (entry: InventoryEntry) =>
      setNpcSaleItem({
        source: name === state.merchantCharacter ? 'merchant' : 'character',
        character: state.merchantRules || name === state.merchantCharacter ? undefined : name,
        entry,
        quantity: String(entry.item.q || 1),
        acknowledged: false,
      }),
    [name, state.merchantCharacter, state.merchantRules, setNpcSaleItem],
  );
  const onAutoNpcSale = useCallback(
    (entry: InventoryEntry) => setAutoNpcSaleItem({ ...entry,
      character: state.merchantRules || name === state.merchantCharacter ? undefined : name }),
    [name, state.merchantCharacter, state.merchantRules, setAutoNpcSaleItem],
  );
  const onAutoStand = useCallback(
    (entry: InventoryEntry) => {
      const price = defaultStandPrice(entry.meta?.definition);
      const existing = state.autoStandMarks?.[commerceRuleKey(entry.item)];
      setStandItem({
        entry,
        defaultPrice: price,
        markAll: false,
        auto: true,
        price: String(existing?.price || price),
        quantity: String(entry.item.q || 1),
      });
    },
    [state.autoStandMarks, setStandItem],
  );
  const onClearAutomaticSales = useCallback(
    (kind: 'npc' | 'stand') => {
      if (kind === 'npc' && name !== state.merchantCharacter)
        send('/merchant/auto-npc-sale', { character: name, action: 'clear-all' });
      else void clearAutomaticSales(kind);
    },
    [name, state.merchantCharacter, send, clearAutomaticSales],
  );
  // A character's NPC rule removes for its owner: the rule's own name from the merchant's list.
  const onRemoveAutomaticSale = useCallback(
    (kind: 'npc' | 'stand', item: Item, owner = name !== state.merchantCharacter ? name : undefined) =>
      kind === 'npc' && owner
        ? send('/merchant/auto-npc-sale', { character: owner, item, action: 'remove' })
        : void removeAutomaticSale(kind, item),
    [name, state.merchantCharacter, send, removeAutomaticSale],
  );
  const onSelect = useCallback(
    (entry: InventoryEntry) =>
      setSelected({
        character: name,
        entry: {
          ...entry,
          meta: detailMeta(entry.item, entry.meta),
        },
        ...(name === state.merchantCharacter
          ? { source: { kind: 'merchant' as const } }
          : {}),
      }),
    [name, state.merchantCharacter, detailMeta, setSelected],
  );
  const onCompare = useCallback(
    (entry: InventoryEntry, slot?: string) =>
      setGearComparison({
        character: char,
        slot,
        entry: {
          ...entry,
          meta: detailMeta(entry.item, entry.meta),
        },
      }),
    [char, detailMeta, setGearComparison],
  );
  const onTravel = useCallback(() => sendCharacter(name), [sendCharacter, name]);
  // Presence and inventory arrive independently, including after reconnects.
  // Missing inventory is still loading, not an empty bag.
  if (!char || !Array.isArray(char.items) || !char.slots) {
    return (
      <output className="block border-t border-emerald-900/70 bg-[#0b1916] p-5 text-emerald-100">Loading inventory…</output>
    );
  }
  return (
    <UpgradeOfferingProvider character={char.name} executor={state.merchantCharacter} stock={state.upgradeOfferingStock || emptyRecord()} rules={state.upgradeOfferingRules || emptyArray()} catalog={state.merchantCatalog?.allItems || emptyArray()} post={post}>
    <InventoryPanel
      restock={restock}
      character={char}
      sharedRules={!!state.merchantRules}
      characters={chars}
      leader={state.leader}
      merchant={state.merchantCharacter}
      merchantWeapon={state.merchantWeapon}
      luckySlot={lucky}
      luckySlotTracking={luckyTracking}
      onLuckySlot={onLuckySlot}
      marked={marked}
      merchantMarked={state.merchantMarked?.[char.name] || emptyArray()}
      autoItemMarks={state.autoItemMarks?.[ruleName] || emptyRecord()}
      autoUpgradeMarks={state.autoUpgradeMarks?.[ruleName] || emptyRecord()}
      allAutoUpgradeMarks={state.autoUpgradeMarks || emptyRecord()}
      merchantDeliveries={state.merchantDeliveries || emptyRecord()}
      standListings={standListings}
      standFull={standIsFull(state)}
      autoNpcSales={state.autoNpcSales || emptyRecord()}
      npcSaleMarks={npcSaleMarks}
      deconstructionMarks={deconstructionMarks}
      autoDeconstruction={state.autoDeconstruction?.[ruleName] || emptyRecord()}
      deconstructionCatalog={state.deconstructionCatalog || emptyRecord()}
      onDeconstruction={onDeconstruction}
      onRetryDeconstruction={onRetryDeconstruction}
      onRemoveNpcSale={onRemoveNpcSale}
      autoStandMarks={state.autoStandMarks || emptyRecord()}
      buyable={state.merchantCatalog?.buyable || emptyArray()}
      catalog={state.merchantCatalog?.allItems || emptyArray()}
      priceHistory={state.standPriceHistory || emptyRecord()}
      onStand={onStand}
      onNpcSale={onNpcSale}
      onAutoNpcSale={onAutoNpcSale}
      onAutoStand={onAutoStand}
      onClearAutomaticSales={onClearAutomaticSales}
      onRemoveAutomaticSale={onRemoveAutomaticSale}
      onUpdateNpcReserve={(item, keep) => {
        send('/merchant/auto-npc-sale', { item, keep, action: 'set' });
      }}
      upgradeMarks={state.upgrades?.[char.name] || emptyArray()}
      statScrollMarks={state.statScrolls?.[char.name] || emptyArray()}
      statScrollInventory={statScrollInventory}
      compoundGroups={state.compounds?.[char.name] || emptyArray()}
      autoCompoundMarks={state.autoCompounds?.[ruleName] || emptyArray()}
      allAutoCompoundMarks={state.autoCompounds || emptyRecord()}
      autoExchanges={state.autoExchanges || emptyRecord()}
      onSelect={onSelect}
      onCompare={onCompare}
      onCommand={command}
        onBatchCommand={(character, type, item, extra) =>
          post('/command', { character, type, item, ...extra })
        }
        onBatchError={setActionError}
        onTravel={onTravel}
    />
    <LuckySlotDialog character={name} tracking={luckyTracking} lucky={lucky} onLock={(slot) => { send("/merchant/config", {character: name, slot, action: lucky.locked != null ? "unlock-lucky-slot" : "lock-lucky-slot"}); }} open={luckySlotOpen} onOpenChange={setLuckySlotOpen} />
    {char.name === state.merchantCharacter && (
        <SharedRuleConflicts state={state} onResolve={(id, owner) => send("/merchant/rule-conflict", {id,owner})} />
      )}
    <DeconstructionConfirmation selection={deconstructionSelection} catalog={state.deconstructionCatalog || emptyRecord()}
      items={state.merchantCatalog?.allItems || emptyArray()} onClose={() => setDeconstructionSelection(null)}
      onConfirm={async ({ entry, auto }) => {
        await post(auto ? '/deconstruction/auto' : '/deconstruction/mark', { character: char.name, slot: entry.slot, item: entry.item });
      }} />
    </UpgradeOfferingProvider>
  );
});
