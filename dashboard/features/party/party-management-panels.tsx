'use client';
import { AddonSlot } from '../../../runtime/hooks/dashboard/slots';
import { itemValue } from '../../../runtime/items/api.ts';
import type { Item } from './item';
import type { ItemMeta } from './item-meta';
import { characterNameAllowed } from '../../../runtime/lifecycle/api.ts';
import { useState } from 'react';
import { standIsFull } from './stand-capacity';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronDown } from 'lucide-react';
import { abbreviatedGold } from './abbreviated-gold';
import { RoutinePrioritiesDialog } from './routine-priorities-dialog';
import { StandPriceButton } from './stand-price-button';
import type { PartyConsoleModel } from './use-party-console';

import { usePanelModel } from './use-panel-model';
// The gold an NPC pays for one copy: the items owner's itemValue, rounded as the game pays it.
const npcValue = (item: Item, meta: ItemMeta | null | undefined) => Math.round(itemValue(item, meta ?? undefined) ?? 0);
export function PartyManagementPanels({ model }: { model: PartyConsoleModel }) {
  return model.routinesOpen ||
    model.donationOpen ||
    model.giveawayOpen ||
    !!model.standItem ||
    !!model.npcSaleItem ||
    !!model.autoNpcSaleItem ||
    !!model.actionError ? (
    <PartyManagementPanelsConnected base={model} />
  ) : null;
}
function PartyManagementPanelsConnected({ base }: { base: PartyConsoleModel }) {
  const [giveawayHostSearch, setGiveawayHostSearch] = useState('');
  const model = usePanelModel(base, {
    inventory: true,
    vitals: true,
    bank: !!base.standItem,
    market: !!base.standItem,
  });
  const {
    giveawayOpen,
    setGiveawayOpen,
    giveawayRealm,
    setGiveawayRealm,
    setGiveawayMerchant,
    state,
    giveawayMerchantOpen,
    setGiveawayMerchantOpen,
    giveawayMerchant,
    joinGiveaway,
    standItem,
    setStandItem,
    applyStandPrice,
    standNpcSale,
    standPontyPrice,
    standMarketReference,
    standObserved,
    standMarketCount,
    saveStandListing,
    autoNpcSaleItem,
    setAutoNpcSaleItem,
    confirmAutoNpcSale,
    npcSaleItem,
    npcSaleBusy,
    setNpcSaleItem,
    confirmNpcSale,
    routinesOpen,
    setRoutinesOpen,
    saveRoutinePriorities,
  } = model;
  // The stand dialog's price choices: each price is computed once, for its label and its press.
  const defaultPrice = Number(standItem?.defaultPrice), inputPrice = Number(standItem?.price);
  const marketLow = Number(standObserved?.marketLow), highestWTB = Number(standObserved?.highestPublicWTB), recent = Number(standObserved?.recent);
  const standPriceChoices: { label: string; price: number; disabled: boolean; tone: 'emerald' | 'violet' | 'cyan' | 'slate' }[] = [
    { label: 'NPC sale +10%', price: standNpcSale * 1.1, disabled: !standItem, tone: 'emerald' },
    { label: 'Ponty sells for', price: standPontyPrice, disabled: !standItem, tone: 'violet' },
    { label: 'Default −10%', price: defaultPrice * 0.9, disabled: !standItem, tone: 'emerald' },
    { label: 'Default', price: defaultPrice, disabled: !standItem, tone: 'emerald' },
    { label: 'Default +10%', price: defaultPrice * 1.1, disabled: !standItem, tone: 'emerald' },
    { label: 'Market low −5%', price: standMarketReference * 0.95, tone: 'cyan',
      disabled: !standItem || !standMarketReference || standMarketReference * 0.95 < defaultPrice },
    { label: 'Market price', price: marketLow, disabled: !marketLow, tone: 'cyan' },
    { label: 'Highest WTB price', price: highestWTB, disabled: !highestWTB, tone: 'violet' },
    { label: 'Recent +5%', price: recent * 1.05, disabled: !recent, tone: 'violet' },
    { label: 'Recent price', price: recent, disabled: !recent, tone: 'violet' },
    { label: 'Recent −5%', price: recent * 0.95, disabled: !recent, tone: 'violet' },
    { label: 'Input −5%', price: inputPrice * 0.95, disabled: !inputPrice, tone: 'slate' },
    { label: 'Input +5%', price: inputPrice * 1.05, disabled: !inputPrice, tone: 'slate' },
  ];
  return (
    <>
      <Dialog open={giveawayOpen} onOpenChange={setGiveawayOpen}>
        <DialogContent data-area="giveaway" className="flex max-h-[90vh] flex-col overflow-hidden border-cyan-700 bg-[#091614] text-emerald-50">
          <DialogHeader>
            <DialogTitle>Join giveaway</DialogTitle>
            <DialogDescription>
              The merchant will switch realms, travel to the main market, find
              this player, and enter every active giveaway they are hosting.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            <div className="grid gap-3">
              <label
                htmlFor="giveaway-realm"
                className="grid gap-1 text-sm text-cyan-100"
              >
                <span>Server realm</span>
                <Select
                  value={giveawayRealm}
                  onValueChange={(value) => {
                    setGiveawayRealm(value || '');
                    setGiveawayMerchant('');
                  }}
                >
                  <SelectTrigger
                    id="giveaway-realm"
                    className="border-cyan-700 bg-[#050b0a] text-cyan-50"
                  >
                    <SelectValue placeholder="Select a realm" />
                  </SelectTrigger>
                  <SelectContent className="border-cyan-800 bg-[#07100f] text-cyan-50">
                    {(state.giveawayRealms || []).map((realm) => (
                      <SelectItem
                        key={realm.key}
                        value={realm.key}
                        className="focus:bg-cyan-950 focus:text-cyan-50"
                      >
                        {realm.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <div className="grid gap-1 text-sm text-cyan-100">
                <span>Merchant name</span>
                <Popover
                  open={giveawayMerchantOpen}
                  onOpenChange={setGiveawayMerchantOpen}
                >
                  <PopoverTrigger
                    render={<Button variant="outline" />}
                    id="giveaway-merchant"
                    type="button"
                    disabled={!giveawayRealm}
                    className="justify-between border-cyan-700 bg-[#050b0a] text-cyan-50 hover:bg-cyan-950 hover:text-white"
                  >
                    {giveawayMerchant ||
                      (giveawayRealm
                        ? 'Search online players'
                        : 'Select a realm first')}
                    <ChevronDown className="h-4 w-4 text-cyan-300" />
                  </PopoverTrigger>
                  <PopoverContent data-area="giveaway-popover"
                    align="start"
                    className="w-[var(--radix-popover-trigger-width)] border-cyan-700 bg-[#07100f] p-0 text-cyan-50"
                  >
                    <Command className="bg-[#07100f] text-cyan-50">
                      <CommandInput
                        placeholder="Search player name…"
                        value={giveawayHostSearch}
                        onValueChange={setGiveawayHostSearch}
                        className="text-cyan-50"
                      />
                      <CommandList>
                        <CommandEmpty className="text-cyan-100/55">
                          No online players loaded for this realm.
                        </CommandEmpty>
                        <CommandGroup>
                          {(state.giveawayPlayers?.[giveawayRealm] || []).map(
                            (name) => (
                              <CommandItem
                                key={name}
                                value={name}
                                onSelect={() => {
                                  setGiveawayMerchant(name);
                                  setGiveawayMerchantOpen(false);
                                }}
                                className="text-cyan-50 data-[selected=true]:bg-cyan-950 data-[selected=true]:text-white"
                              >
                                {name}
                              </CommandItem>
                            ),
                          )}
                          {/* R12-12: a host the directory has not seen, typed by name and checked by the game's name rule. */}
                          {characterNameAllowed(giveawayHostSearch.trim()) &&
                            !(state.giveawayPlayers?.[giveawayRealm] || []).includes(giveawayHostSearch.trim()) && (
                            <CommandItem
                              value={giveawayHostSearch.trim()}
                              onSelect={() => {
                                setGiveawayMerchant(giveawayHostSearch.trim());
                                setGiveawayMerchantOpen(false);
                              }}
                              className="text-cyan-50 data-[selected=true]:bg-cyan-950 data-[selected=true]:text-white"
                            >
                              Use {giveawayHostSearch.trim()}
                            </CommandItem>
                          )}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <span className="font-mono text-[10px] text-cyan-100/45">
                  {(state.giveawayPlayers?.[giveawayRealm] || []).length} online
                  players loaded
                </span>
              </div>
            </div>
          </div>
          {model.giveawayError && <p role="alert" className="text-sm text-rose-200">{model.giveawayError}</p>}
          <AddonSlot name="dialog-section" part="giveaway" />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGiveawayOpen(false)}
              className="border-slate-500 bg-[#07100f] text-slate-100 hover:bg-slate-800 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void joinGiveaway()}
              className="border border-cyan-300 bg-cyan-500 text-cyan-950 hover:bg-cyan-400"
            >
              Join
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!standItem}
        onOpenChange={(open) => {
          if (!open) setStandItem(null);
        }}
      >
        <DialogContent data-area="stand-item" className="flex max-h-[90vh] flex-col overflow-hidden border-amber-800 bg-black text-emerald-50">
          <DialogHeader>
            <DialogTitle>
              {standItem?.auto
                ? 'Automatic merchant stand listing'
                : 'Merchant stand listing'}
            </DialogTitle>
            <DialogDescription>
              {standItem?.auto
                ? 'Set one fixed price. Every future matching item is marked for the stand at this price.'
                : 'Set the sale price and quantity. The merchant lists it when idle.'}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            <div className="grid gap-1 rounded border border-amber-900/70 bg-black p-3 font-mono text-xs">
              <div className="text-emerald-100/60">
                Buy from NPC:{' '}
                {standItem &&
                !Number(standItem.entry.item.level || 0) &&
                standItem.entry.meta?.buyable
                  ? `${abbreviatedGold(standItem.defaultPrice)} gold`
                  : 'unavailable'}
              </div>
              <div className="text-cyan-200">
                Current number on market: {standMarketCount.toLocaleString()}
              </div>
            </div>
            <Input
              inputMode="numeric"
              value={standItem?.price || ''}
              onChange={(event) =>
                setStandItem(
                  (old) =>
                    old && {
                      ...old,
                      price: event.target.value.replace(/[^0-9]/g, ''),
                    },
                )
              }
              placeholder="Price"
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {standPriceChoices.map((choice) => (
                <StandPriceButton
                  key={choice.label}
                  label={choice.label}
                  value={choice.price}
                  disabled={choice.disabled}
                  onClick={() => applyStandPrice(choice.price)}
                  tone={choice.tone}
                />
              ))}
            </div>
            <p className="font-mono text-[10px] text-emerald-100/45">
              Market low uses the current fresh low, falling back to the lowest
              observed price. It is disabled when a 5% undercut would fall below
              the buy-from-NPC price.
            </p>
            {standItem &&
            !standItem.auto &&
            Number(standItem.entry.item.q || 1) > 1 ? (
              <Input
                inputMode="numeric"
                value={standItem.quantity}
                onChange={(event) =>
                  setStandItem(
                    (old) =>
                      old && {
                        ...old,
                        quantity: event.target.value.replace(/[^0-9]/g, ''),
                      },
                  )
                }
                placeholder="Quantity"
              />
            ) : null}
            {!standItem?.auto ? (
              <label className="flex items-start gap-3 rounded border border-amber-900/70 bg-amber-950/10 p-3 text-sm text-amber-100">
                <Checkbox
                  checked={standItem?.markAll ?? false}
                  onCheckedChange={(checked) =>
                    setStandItem(
                      (old) => old && { ...old, markAll: checked === true },
                    )
                  }
                />
                <span>
                  <strong>Mark all for stand</strong>
                  <span className="mt-0.5 block text-xs text-amber-100/55">
                    List every identical copy held by the merchant or stored in
                    the bank at this price.
                  </span>
                </span>
              </label>
            ) : null}
          </div>
          {model.standError && <p role="alert" className="text-sm text-rose-200">{model.standError}</p>}
          <AddonSlot name="dialog-section" part="stand-item" />
          <DialogFooter className="shrink-0 border-t border-slate-700 bg-black">
            <Button
              variant="outline"
              className="border-rose-500 bg-black text-rose-400 hover:bg-rose-950 hover:text-rose-200"
              onClick={() => setStandItem(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                !standItem?.id &&
                !standItem?.auto &&
                standIsFull(state)
              }
              onClick={() => void saveStandListing()}
              className="border border-slate-600 bg-black text-slate-100 hover:border-slate-400 hover:bg-slate-900 hover:text-white disabled:border-slate-700 disabled:bg-black disabled:text-slate-600"
            >
              {standItem?.auto ? 'Save auto mark' : 'Mark for stand'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!autoNpcSaleItem}
        onOpenChange={(open) => {
          if (!open) setAutoNpcSaleItem(null);
        }}
      >
        <DialogContent data-area="npc-sale-automatic" className="flex max-h-[90vh] flex-col overflow-hidden border-orange-800 bg-black text-emerald-50">
          <DialogHeader>
            <DialogTitle>Automatically sell to NPC?</DialogTitle>
            <DialogDescription>
              {autoNpcSaleItem?.character
                ? `Matching items on ${autoNpcSaleItem.character} will be collected and sold by the merchant. This`
                : 'Every future matching item received by the merchant will be queued for NPC sale. This'}
              {' '}remains active until you clear the rule.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            {autoNpcSaleItem ? (
              <div className="rounded border border-orange-900 bg-orange-950/20 p-3">
                <p className="font-semibold text-orange-100">
                  {String(
                    autoNpcSaleItem.meta?.definition.name ||
                      autoNpcSaleItem.item.name,
                  )}
                  {autoNpcSaleItem.item.level
                    ? ` +${autoNpcSaleItem.item.level}`
                    : ''}
                </p>
                <p className="mt-2 font-mono text-sm text-amber-200">
                  You will receive{' '}
                  {npcValue(autoNpcSaleItem.item, autoNpcSaleItem.meta).toLocaleString()}
                  g per sale.
                </p>
                <p className="mt-1 text-xs text-orange-100/55">
                  The rule matches this exact +level, stat type, and special
                  property.
                </p>
              </div>
            ) : null}
            {autoNpcSaleItem && !autoNpcSaleItem.character ? (
              <label htmlFor="auto-npc-sale-keep" className="grid gap-1 text-sm text-orange-100">
                <span>Number to keep reserved</span>
                <input
                  id="auto-npc-sale-keep"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder="Sell every copy"
                  value={model.autoNpcSaleKeep}
                  onChange={(event) => model.setAutoNpcSaleKeep(event.target.value)}
                  className="rounded border border-orange-800 bg-[#0b0603] px-2 py-1 font-mono text-orange-50 placeholder:text-orange-100/40"
                />
                <span className="text-xs text-orange-100/55">
                  Copies to keep across the merchant&apos;s bag, bank and BankBois. Only the rest is sold;
                  Enter 0 to sell every copy.
                </span>
              </label>
            ) : null}
          </div>
          {model.autoNpcSaleError && <p role="alert" className="text-sm text-rose-200">{model.autoNpcSaleError}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAutoNpcSaleItem(null)}
              className="border-slate-600 bg-black text-slate-200 hover:bg-slate-800 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void confirmAutoNpcSale()}
              className="border border-orange-300 bg-orange-500 text-black hover:bg-orange-400"
            >
              Enable auto sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!npcSaleItem}
        onOpenChange={(open) => {
          if (!open && !npcSaleBusy) setNpcSaleItem(null);
        }}
      >
        <DialogContent data-area="npc-sale" className="flex max-h-[90vh] flex-col overflow-hidden border-rose-800 bg-black text-emerald-50">
          <DialogHeader>
            <DialogTitle>
              {npcSaleItem?.targets
                ? 'Sell all matching bank items to NPC?'
                : 'Sell to NPC?'}
            </DialogTitle>
            <DialogDescription>
              {npcSaleItem?.source === 'character'
                ? 'The merchant will collect this item and sell it to an NPC. Once sold, the sale cannot be undone.'
                : 'The merchant will sell this item to an NPC. Once sold, the sale cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            <div className="rounded border border-rose-900/70 bg-rose-950/15 p-3">
              <p className="font-semibold">
                {(npcSaleItem?.entry.meta?.definition.name as string) ||
                  npcSaleItem?.entry.item.name}
              </p>
              <p className="mt-1 font-mono text-xs text-emerald-100/55">
                {npcSaleItem?.targets
                  ? `${npcSaleItem.targets.length} slots across bank panes and bankbois`
                  : npcSaleItem?.source === 'merchant'
                    ? 'Merchant inventory'
                    : npcSaleItem?.source === 'character'
                      ? `${npcSaleItem.character} inventory`
                      : `Bank · ${npcSaleItem?.pack}`}{' '}
                {!npcSaleItem?.targets && <>· slot {npcSaleItem?.entry.slot}</>}
              </p>
            </div>
            <label className="grid gap-1 font-mono text-xs text-emerald-200">
              Quantity
              <Input
                inputMode="numeric"
                value={npcSaleItem?.quantity || ''}
                disabled={npcSaleBusy || !!npcSaleItem?.targets}
                onChange={(event) =>
                  setNpcSaleItem(
                    (old) =>
                      old && {
                        ...old,
                        quantity: event.target.value.replace(/[^0-9]/g, ''),
                      },
                  )
                }
                className="border-rose-900 bg-black/40"
              />
            </label>
            {npcSaleItem ? (
              <div className="rounded border border-amber-800 bg-amber-950/20 p-3 font-mono text-sm text-amber-200">
                You will receive:{' '}
                {(
                  npcValue(npcSaleItem.entry.item, npcSaleItem.entry.meta) *
                  Math.max(0, Number(npcSaleItem.quantity) || 0)
                ).toLocaleString()}
                g
                <span className="ml-2 text-[10px] text-amber-100/55">
                  (
                  {npcValue(npcSaleItem.entry.item, npcSaleItem.entry.meta).toLocaleString()}
                  g each)
                </span>
              </div>
            ) : null}
            {npcSaleItem &&
            (Number(npcSaleItem.entry.item.level || 0) > 0 ||
              npcSaleItem.entry.item.stat_type ||
              npcSaleItem.entry.item.p) ? (
              <label className="flex items-start gap-2 rounded border border-rose-700 bg-rose-950/30 p-3 text-sm text-rose-200">
                <Checkbox
                  checked={npcSaleItem.acknowledged}
                  onCheckedChange={(checked) =>
                    setNpcSaleItem(
                      (old) =>
                        old && { ...old, acknowledged: checked === true },
                    )
                  }
                />
                <span>
                  I understand this is modified gear and selling it will
                  permanently destroy it.
                </span>
              </label>
            ) : null}
          </div>
          {model.npcSaleError && <p role="alert" className="text-sm text-rose-200">{model.npcSaleError}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={npcSaleBusy}
              className="border-slate-600 bg-black text-slate-100 hover:bg-slate-800 hover:text-white"
              onClick={() => setNpcSaleItem(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={npcSaleBusy}
              onClick={() => void confirmNpcSale()}
              className="bg-rose-600 text-white hover:bg-rose-500"
            >
              {npcSaleBusy
                ? 'Queueing…'
                : npcSaleItem?.targets
                  ? 'Sell all to NPC'
                  : 'Sell to NPC'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RoutinePrioritiesDialog
        open={routinesOpen}
        onOpenChange={setRoutinesOpen}
        priorities={state.merchantRoutinePriorities || {}}
        kinds={state.merchantAddonKinds}
        enabled={{
          ...state.merchantAutomations,
          fishing: state.gatheringModes?.includes('fishing') === true,
          mining: state.gatheringModes?.includes('mining') === true,
        }}
        onSave={saveRoutinePriorities}
      />
    </>
  );
}
