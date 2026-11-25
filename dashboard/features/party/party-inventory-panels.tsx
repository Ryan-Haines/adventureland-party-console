"use client";
import { commerceRuleKey, defaultStandPrice, markMatches } from '../../../runtime/items/api.ts';
import { standDraft, standIsFull } from './stand-capacity';
import { lazy, useCallback, useState } from "react";
import { DeconstructionConfirmation, type DeconstructionSelection } from "./deconstruction-confirmation";
import { DeferredPanel } from "./deferred-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
const BankSheet = lazy(() =>
  import("./bank-sheet").then((module) => ({ default: module.BankSheet })),
);
const StandSheet = lazy(() =>
  import("./stand-sheet").then((module) => ({ default: module.StandSheet })),
);
import type { PartyConsoleModel } from "./use-party-console";

import { usePanelModel } from "./use-panel-model";
import { useBankWithdrawal } from "./bank-withdrawal";
import { useForwardingActions } from "./use-forwarding-actions";
import { emptyArray, emptyRecord } from "./empty-values";
import type { InventoryEntry } from "./inventory-entry";
import type { Item } from "./item";
import type { ItemMeta } from "./item-meta";
import type { BankVault } from "./bank-vault";
import type { StandListing } from "./stand-listing";

// These are plain functions rebuilt on every usePartyConsole() render (not
// useState setters), so BankSheet/StandSheet would never see stable props
// without forwarding them through stable wrappers.
const forwardedActions = ['setStandItem', 'setNpcSaleItem', 'setAutoNpcSaleItem', 'removeStandListing',
  'saveStandBid', 'buyALDataListing', 'buyPontyListing', 'sellALDataOrder'] as const;

export function PartyInventoryPanels({ model }: { model: PartyConsoleModel }) {
  return model.realmConfirmOpen || model.bankOpen || model.standOpen || model.marketOpen ? (
    <PartyInventoryPanelsConnected base={model} />
  ) : null;
}
function PartyInventoryPanelsConnected({ base }: { base: PartyConsoleModel }) {
  const [deconstructionSelection, setDeconstructionSelection] = useState<DeconstructionSelection | null>(null);
  // Live WTB, a tab of the Market dialog, and the stand count the bank stock as owned, so the
  // bank section loads while either is open.
  const market = base.marketOpen || base.standOpen;
  const model = usePanelModel(base, { inventory: true, vitals: true, bank: base.bankOpen || market, market });
  const { setStandItem, setNpcSaleItem, setAutoNpcSaleItem, removeStandListing, saveStandBid, buyALDataListing,
    buyPontyListing, sellALDataOrder } = useForwardingActions(base, forwardedActions);
  const {
    bankOpen,
    setBankOpen,
    state,
    setSelected,
    detailMeta,
    setActionError,
    post,
    standOpen,
    setStandOpen,
    marketOpen,
    setMarketOpen,
    openSettings,
    realmDestination,
    setRealmSetHome,
    setRealmConfirmOpen,
    realmConfirmOpen,
    realmBusy,
    realmSetHome,
    switchRealm,
    setWtbItem,
  } = model;
  const { withdraw, confirmation } = useBankWithdrawal(post, setActionError);
  const standListings = state.standListings || emptyArray();
  const catalogAllItems = state.merchantCatalog?.allItems || emptyArray();
  const catalogBuyable = state.merchantCatalog?.buyable || emptyArray();
  const standPriceHistory = state.standPriceHistory || emptyRecord();
  const deconstructionCatalog = state.deconstructionCatalog || emptyRecord();
  const standBids = state.standBids || emptyRecord();
  const autoStandMarks = state.autoStandMarks || emptyRecord();

  const onBankSelect = useCallback((pack: string, entry: InventoryEntry) =>
    setSelected({
      character: `Bank · ${pack}`,
        entry: { ...entry, meta: detailMeta(entry.item, entry.meta) },
        source: { kind: 'bank', pack },
      }),
    [setSelected, detailMeta],
  );
  const onWithdraw = useCallback(
    (pack: string, entry: InventoryEntry) =>
      withdraw(state.merchantCharacter, pack, entry),
    [withdraw, state.merchantCharacter],
  );
  const onWithdrawAll = useCallback(
    (pack: string, entry: InventoryEntry) =>
      withdraw(state.merchantCharacter, pack, entry, true),
    [withdraw, state.merchantCharacter],
  );
  const onCreateBankboi = useCallback(async () => {
    const result = await post('/bankbois/create', {});
    return String((result.bankboi as { name?: string })?.name || 'bankboi');
  }, [post]);
  const onDeleteBankboi = useCallback(
    async (name: string) => {
      try {
        await post(`/bankbois/${encodeURIComponent(name)}/delete`, {});
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : 'Bankboi deletion failed',
        );
      }
    },
    [post, setActionError],
  );
  const onUnstand = useCallback(
    (pack: string, entry: InventoryEntry) => {
      const listing = standListings.find(
        (mark) =>
          mark.bankPack === pack &&
          mark.bankSlot === entry.slot &&
          markMatches(mark.item, entry.item),
      );
      if (listing)
        void removeStandListing(listing).catch((error: unknown) =>
          setActionError(
            error instanceof Error
              ? error.message
              : 'Could not unmark stand listing',
          ),
        );
    },
    [standListings, removeStandListing, setActionError],
  );
  const onBankStand = useCallback(
    (pack: string, entry: InventoryEntry) => {
      const knownMeta = catalogAllItems.find(
        (item) => item.id === entry.item.name,
      )?.meta;
      const valuedEntry = {
        ...entry,
        meta: knownMeta
          ? {
              ...entry.meta,
              ...knownMeta,
              world: knownMeta.world || entry.meta?.world,
            }
          : entry.meta,
      };
      const press = standDraft({ standSlots: state.standSlots, standListings }, valuedEntry, pack);
      if ('refused' in press) return setActionError(press.refused);
      setStandItem(press.draft);
    },
    [catalogAllItems, standListings, state.standSlots, setActionError, setStandItem],
  );
  const onBankNpcSale = useCallback(
    (pack: string, entry: InventoryEntry) =>
      setNpcSaleItem({
        source: 'bank',
        pack,
        entry,
        quantity: String(entry.item.q || 1),
        acknowledged: false,
      }),
    [setNpcSaleItem],
  );
  const onBankDeconstruction = useCallback(
    (pack: string, entry: InventoryEntry, all: boolean, auto = false) =>
      setDeconstructionSelection({ pack, entry, all, auto }),
    [],
  );
  const onBankUpgrade = useCallback(
    (pack: string, entry: InventoryEntry, tiers: number, auto: boolean) => {
      if (!auto)
        return withdraw(state.merchantCharacter, pack, entry, false, tiers);
      void post('/command', {
        character: state.merchantCharacter,
        type: 'auto-upgrade-mark',
        slot: -1,
        item: entry.item,
        tiers,
      }).catch((error: unknown) =>
        setActionError(
          error instanceof Error
            ? error.message
            : 'Could not mark bank upgrade',
        ),
      );
    },
    [post, withdraw, state.merchantCharacter, setActionError],
  );
  const onBankAutoStand = useCallback(
    (entry: InventoryEntry) => {
      const valued = { ...entry, meta: detailMeta(entry.item, entry.meta) };
      const rule = autoStandMarks[commerceRuleKey(entry.item)];
      const price = Number(rule?.price) || defaultStandPrice(valued.meta?.definition);
      setStandItem({
        entry: valued,
        price: String(price),
        defaultPrice: price,
        quantity: String(entry.item.q || 1),
        markAll: false,
        auto: true,
      });
    },
    [detailMeta, autoStandMarks, setStandItem],
  );
  const onBankAutoNpcSale = useCallback(
    (entry: InventoryEntry) =>
      setAutoNpcSaleItem({
        ...entry,
        character: undefined,
      }),
    [setAutoNpcSaleItem, state.merchantCharacter],
  );
  const onBankClearMarks = useCallback(
    (pack: string, entry: InventoryEntry) => {
      void post('/command', {
        character: state.merchantCharacter,
        type: 'clear-item-marks',
        pack,
        slot: entry.slot,
        item: entry.item,
      }).catch((error: unknown) =>
        setActionError(
          error instanceof Error ? error.message : 'Could not clear bank marks',
        ),
      );
    },
    [post, state.merchantCharacter, setActionError],
  );
  const onUnlock = useCallback(
    async (vault: BankVault, kind: 'key' | 'gold') => {
      try {
        await post('/bank/unlock', { pack: vault.pack, kind });
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : 'Bank unlock failed',
        );
      }
    },
    [post, setActionError],
  );

  const onMarketplaceSettings = useCallback(() => openSettings({ tab: 'account', section: 'marketplace' }), [openSettings]);
  const onStandEdit = useCallback(
    (listing: StandListing) => {
      const knownMeta = catalogAllItems.find(
        (item) => item.id === listing.item.name,
      )?.meta;
      const entry = { slot: listing.slot, item: listing.item, meta: knownMeta };
      setStandItem({
        id: listing.id,
        entry,
        bankPack: listing.bankPack,
        defaultPrice: defaultStandPrice(entry.meta?.definition),
        price: String(listing.price),
        quantity: String(listing.quantity),
        markAll: false,
      });
    },
    [catalogAllItems, setStandItem],
  );
  const onEditBuy = useCallback(
    (item: Item, meta?: ItemMeta | null, price?: number) => setWtbItem({ item, meta, price }),
    [setWtbItem],
  );
  const onListForWTB = useCallback(
    (
      entry: InventoryEntry,
      bankPack: string | undefined,
      price: number,
      quantity: number,
    ) => {
      const valuedEntry = {
        ...entry,
        meta: detailMeta(entry.item, entry.meta),
      };
      const existing = standListings.find(
        (mark) =>
          mark.bankPack === bankPack &&
          mark.slot === entry.slot &&
          markMatches(mark.item, entry.item),
      );
      setStandItem({
        id: existing?.id,
        entry: valuedEntry,
        bankPack,
        markAll: false,
        defaultPrice: defaultStandPrice(valuedEntry.meta?.definition),
        price: String(price),
        quantity: String(
          Math.max(1, Math.min(quantity, Number(entry.item.q || 1))),
        ),
      });
    },
    [detailMeta, standListings, setStandItem],
  );
  const onStandInspect = useCallback(
    (item: Item, meta: ItemMeta | null | undefined, context: string) =>
      setSelected({
        character: context,
        entry: { slot: -1, item, meta: detailMeta(item, meta) },
      }),
    [setSelected, detailMeta],
  );
  const onALDataSetup = useCallback(() => {
    setMarketOpen(false);
    openSettings({ tab: 'account', section: 'aldata' });
  }, [setMarketOpen, openSettings]);

  return (
    <>
      {confirmation}
      <DeferredPanel active={bankOpen}>
        <BankSheet
          bankSortState={state}
          bankboiPrefix={state.bankboiPrefix || ''}
          open={bankOpen}
          onOpenChange={setBankOpen}
          bank={state.bank || null}
          bankbois={state.bankbois || emptyArray()}
          bankboiQueue={state.bankboiQueue || emptyArray()}
          merchant={state.merchantCharacter}
          merchantState={
            state.merchantCharacter
              ? state.characters[state.merchantCharacter]
              : undefined
          }
          vaults={state.bankVaults || emptyArray()}
          withdrawals={state.withdrawals || emptyRecord()}
          onSelect={onBankSelect}
          onWithdraw={onWithdraw}
          onWithdrawAll={onWithdrawAll}
          onCreateBankboi={onCreateBankboi}
          onDeleteBankboi={onDeleteBankboi}
          catalog={catalogAllItems}
          autoStandMarks={autoStandMarks}
          automaticRules={{
            merchantCharacter: state.merchantCharacter,
            merchantRules: state.merchantRules,
            autoItemMarks: state.autoItemMarks,
            autoNpcSales: state.autoNpcSales,
            autoStandMarks: state.autoStandMarks,
            autoUpgradeMarks: state.autoUpgradeMarks,
            autoCompounds: state.autoCompounds,
            autoDeconstruction: state.autoDeconstruction,
            autoExchanges: state.autoExchanges,
          }}
          standListings={standListings}
          standFull={standIsFull(state)}
          onUnstand={onUnstand}
          onStand={onBankStand}
          onNpcSale={onBankNpcSale}
          npcSaleMarks={state.npcSaleMarks || emptyArray()}
          deconstructionCatalog={deconstructionCatalog}
          onDeconstruction={onBankDeconstruction}
          onUpgrade={onBankUpgrade}
          exchangeCatalog={state.merchantCatalog?.exchangeable || []}
          onBatchError={setActionError}
          onBatchCommand={(type, pack, entry, extra) =>
            type === 'exchange'
              ? post('/merchant/exchange-order', {
                  exchanges: [
                    {
                      id: entry.item.name,
                      level: entry.item.level || 0,
                      quantity: entry.item.q || 1,
                    },
                  ],
                })
              : post('/command', {
                  character: state.merchantCharacter,
                  type,
                  pack,
                  slot: entry.slot,
                  item: entry.item,
                  ...extra,
                })
          }
          onExchange={(pack, entry, auto) => {
            if (auto)
              void model.command(
                state.merchantCharacter!,
                'auto-exchange',
                entry.item,
                { slot: -1 },
              );
            else
              void model
                .post('/merchant/exchange-order', {
                  exchanges: [
                    {
                      id: entry.item.name,
                      level: entry.item.level || 0,
                      quantity: entry.item.q || 1,
                    },
                  ],
                })
                .catch((error) =>
                  setActionError(
                    error instanceof Error ? error.message : String(error),
                  ),
                );
          }}
          onCompound={(pack, entry, tier, auto) => {
            if (auto)
              void model.command(
                state.merchantCharacter!,
                'auto-compound-mark',
                entry.item,
                { targetTier: tier },
              );
            else
              void model.command(
                state.merchantCharacter!,
                'compound-mark',
                entry.item,
                { pack, slot: entry.slot, targetTier: tier },
              );
          }}
          onClearMarks={onBankClearMarks}
          onAutoStand={onBankAutoStand}
          onAutoNpcSale={onBankAutoNpcSale}
          onUnlock={onUnlock}
        />
      </DeferredPanel>
      <DeconstructionConfirmation
        selection={deconstructionSelection}
        catalog={deconstructionCatalog}
        items={catalogAllItems}
        onClose={() => setDeconstructionSelection(null)}
        onConfirm={async ({ pack, entry, all, auto }) => {
          if (auto)
            await model.post('/deconstruction/auto', {
              character: state.merchantCharacter,
              item: entry.item,
            });
          else
            await model.post('/deconstruction/mark', {
              pack,
              slot: entry.slot,
              item: entry.item,
              all,
            });
        }}
      />
      <DeferredPanel active={standOpen || marketOpen}>
        <StandSheet
          open={standOpen}
          onOpenChange={setStandOpen}
          marketOpen={marketOpen}
          onMarketOpenChange={setMarketOpen}
          stand={state.standSlots}
          merchant={
            state.merchantCharacter
              ? state.characters[state.merchantCharacter]
              : undefined
          }
          bank={state.bank}
          ownedStock={state.ownedStock}
          bankGold={state.bankGold}
          listings={standListings}
          catalog={catalogAllItems}
          buyable={catalogBuyable}
          bids={standBids}
          nativeStand={state.nativeStand}
          autoBlacklistMerchants={state.autoBlacklistMerchants !== false}
          onMarketplaceSettings={onMarketplaceSettings}
          priceHistory={standPriceHistory}
          marketIgnoredItems={state.marketIgnoredItems || []}
          blacklist={state.merchantBlacklist || emptyRecord()}
          onEdit={onStandEdit}
          onRemove={removeStandListing}
          onEditBuy={onEditBuy}
          onBid={saveStandBid}
          onListForWTB={onListForWTB}
          aldata={state.aldata}
          onALDataSetup={onALDataSetup}
          ponty={state.ponty}
          onBuyALData={buyALDataListing}
          onBuyPonty={buyPontyListing}
          onSellALData={sellALDataOrder}
          onInspect={onStandInspect}
        />
      </DeferredPanel>
      <Dialog
        open={realmConfirmOpen}
        onOpenChange={(open) => {
          if (!realmBusy) setRealmConfirmOpen(open);
        }}
      >
        <DialogContent data-area="realm-confirm" className="border-violet-700 bg-[#080b10] text-slate-100 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {realmSetHome ? 'Change home realm?' : 'Switch realm?'}
            </DialogTitle>
            <DialogDescription className="text-slate-300">
              This switches every active party character to{' '}
              {state.realmControl?.realms.find(
                (realm) => realm.key === realmDestination,
              )?.label || realmDestination}{' '}
              and gives non-merchant characters Realm Fatigue.
              {realmSetHome && (
                <span className="mt-2 block text-amber-100">
                  This will change for all characters in the account including
                  characters not currently logged in.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
            <p>
              <strong>Realm Fatigue:</strong> approximately 30 minutes.
              Home-realm rewards are paused; ordinary rewards continue.
            </p>
            {realmDestination !== state.realmControl?.homeRealm ? (
              <p>
                <strong>Outside your home realm:</strong> Hop Sickness applies
                −80 Luck, Gold, and XP, plus −20% output, until you return home
                or change your home realm through Bean.
              </p>
            ) : (
              <p>
                This destination is already your home realm, so Hop Sickness
                should not apply.
              </p>
            )}
          </div>
          {realmDestination !== state.realmControl?.homeRealm ? (
            <label className="flex items-start gap-3 rounded border border-violet-700 bg-black p-3 text-sm text-violet-100">
              <Checkbox
                checked={realmSetHome}
                onCheckedChange={(checked) => setRealmSetHome(checked === true)}
                className="border-violet-400 bg-black data-checked:bg-violet-700"
              />
              <span>
                <strong>Set as home realm</strong>
                <br />
                <span className="text-xs text-slate-300">
                  Every account character will request the native home change.
                  Offline characters log in temporarily, one at a time, then log
                  out. One headless character may briefly disconnect to make
                  room and will reconnect afterwards. Adventure Land enforces a
                  36-hour home-change cooldown per character.
                </span>
              </span>
            </label>
          ) : null}
          {model.realmBlacklisted && (
            <label className="flex items-start gap-3 rounded border border-amber-600 bg-amber-950/30 p-3 text-sm text-amber-100">
              <Checkbox
                checked={model.realmBlacklistConfirmed}
                onCheckedChange={(checked) => model.setRealmBlacklistConfirmed(checked === true)}
                className="border-amber-400 bg-black data-checked:bg-amber-600"
              />
              <span>
                <strong>{model.realmBlacklisted}.</strong> Tick to send this order anyway; it confirms this one order only.
              </span>
            </label>
          )}
          {model.realmError && (
            <p role="alert" className="text-sm text-rose-200">
              {model.realmError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={realmBusy}
              onClick={() => setRealmConfirmOpen(false)}
              className="border-slate-500 bg-black text-slate-100 hover:bg-slate-800 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={realmBusy || (!!model.realmBlacklisted && !model.realmBlacklistConfirmed)}
              onClick={() => void switchRealm()}
              className="bg-violet-600 text-white hover:bg-violet-500"
            >
              {realmBusy
                ? 'Starting…'
                : realmSetHome
                  ? 'Change home realm'
                  : 'Switch all characters'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
