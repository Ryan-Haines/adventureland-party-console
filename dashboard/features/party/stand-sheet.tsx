'use client';
import { AddonSlot, useAddonListView } from '../../../runtime/hooks/dashboard/slots';
import type { ClassifiedsRow, MarketBuyRow, MarketRow, PontyRow } from './addon-kit';
import {IgnoreMarketItemButton,IgnoredMarketItems,MarketSettingsSection} from './market-preferences';
import {bidAcceptsLevel, defaultStandPrice, itemGrade, marketItemKey, marketListingFresh, ownedStockKey} from '../../../runtime/items/api.ts';
import {type MarketIgnoredItem,type MarketItemIdentity} from '../../../runtime/items/api.ts';
import { ActiveWTBFields } from './active-wtb-fields';


import { useStoredBoolean } from '@/hooks/use-stored-boolean';

import { useClock } from '@/hooks/use-clock';

import { Button } from '@/components/ui/button';

import { Checkbox } from '@/components/ui/checkbox';

import {

  Dialog,

  DialogContent,

  DialogDescription,

  DialogFooter,

  DialogHeader,

  DialogClose,

  DialogTitle,

} from '@/components/ui/dialog';

import { Input } from '@/components/ui/input';

import {

  Tooltip,

  TooltipContent,

  TooltipTrigger,

} from '@/components/ui/tooltip';

import { ChevronDown, ChevronRight, Settings, X } from 'lucide-react';

import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { ALDataBuyOrder } from './aldata-buy-order';

import { ALDataListing } from './aldata-listing';

import { ALDataPublicTrade } from './aldata-public-trade';

import { ALDataState } from './aldata-state';

import { usePartyAction } from './query-actions';

import { BankSnapshot } from './bank-snapshot';

import { Char } from './char';

import { InventoryEntry } from './inventory-entry';

import { Item } from './item';

import { ItemMeta } from './item-meta';

import { SpriteCrop } from './sprite-crop';

import { MerchantBlacklistEntry } from './merchant-blacklist-entry';

import { MerchantBuyItem } from './merchant-buy-item';

import { MerchantCatalogItem } from './merchant-catalog-item';

import { MluckClover } from './mluck-clover';

import { PontyListing } from './ponty-listing';

import { PontyState } from './ponty-state';
import { marketAge } from './market-age';
import { API } from './api';

import { standSaleRows, standBuyRows } from './stand-inspection';
import { standIsFull } from './stand-capacity';

import { StandBid } from './stand-bid';
import { saveActiveBidField, saveStandPriorityDraft } from './stand-bid-save';

import { StandListing } from './stand-listing';

import { StandPriceHistory } from './stand-price-history';

import { statBadgeClass, statBadgeStyle } from './stat-badge-class';

import { SuggestedPriceDetails } from './suggested-price-details';

import type { PartyState } from './party-state';

import {

  WTBPreference,

  useWTBReplacement,

  standBuyExplanation,

  higherLevelExplanation,

  autoStandExplanation,

  type WTBOptions,

} from './wtb-preferences';

import { WTBPriorityInput } from './wtbpriority-input';
import { WTBUnconfirmedPurchase } from './wtb-unconfirmed-purchase';

// A Market row's realm as an add-on's list view reads it (addon-kit.ts AddonListRow).
const realmOf = (row: { serverRegion?: string; serverIdentifier?: string }) =>
  row.serverRegion && row.serverIdentifier ? `${row.serverRegion} ${row.serverIdentifier}` : undefined;

export const StandSheet = memo(function StandSheet({

  open,

  onOpenChange,

  marketOpen,

  onMarketOpenChange,

  merchant,
  stand,

  bank,
  ownedStock,
  bankGold,

  listings,

  catalog,

  buyable,

  bids,

  priceHistory,

  blacklist,
  marketIgnoredItems,

  aldata,

  onALDataSetup,

  ponty,

  nativeStand,

  autoStandBuys,

  autoBlacklistMerchants,

  onAutoStandBuys,

  onEdit,
  onEditBuy,

  onRemove,

  onBuyALData,

  onBuyPonty,

  onSellALData,

  onBid,

  onListForWTB,

  onInspect,

}: {

  open: boolean;

  onOpenChange: (open: boolean) => void;

  marketOpen: boolean;

  onMarketOpenChange: (open: boolean) => void;

  merchant?: Char;
  // The items owner's stand count in the core section.
  stand: PartyState['standSlots'];

  bank?: BankSnapshot | null;
  // The bank section's copies the merchant may sell, by `ownedStockKey`, with the cells counted.
  ownedStock?: PartyState['ownedStock'];
  bankGold?: number | null;

  listings: StandListing[];

  catalog: MerchantCatalogItem[];

  buyable: MerchantBuyItem[];

  bids: Record<string, StandBid>;

  priceHistory: Record<string, StandPriceHistory>;

  blacklist: Record<string, MerchantBlacklistEntry>;
  marketIgnoredItems: MarketIgnoredItem[];

  aldata?: ALDataState;

  onALDataSetup?: () => void;

  ponty?: PontyState;

  nativeStand?: PartyState['nativeStand'];

  autoStandBuys: boolean;

  autoBlacklistMerchants: boolean;

  onAutoStandBuys(enabled: boolean): Promise<void>;

  onEdit: (listing: StandListing) => void;
  onEditBuy: (item: Item, meta?: ItemMeta | null, price?: number) => void;

  onRemove: (listing: StandListing) => Promise<void>;

  onBuyALData: (listing: ALDataListing, buyQuantity: number) => Promise<void>;

  onBuyPonty: (listing: PontyListing) => Promise<void>;

  onSellALData: (order: ALDataBuyOrder, sellQuantity: number) => Promise<void>;

  onBid: (

    itemId: string,

    price: number,

    quantity: number,

    minimumQuality?: number,

    clear?: boolean,

    priorityOverride?: number | null,

    options?: WTBOptions,

  ) => Promise<void>;

  onListForWTB: (

    entry: InventoryEntry,

    bankPack: string | undefined,

    price: number,

    quantity: number,

  ) => void;

  onInspect: (

    item: Item,

    meta: ItemMeta | null | undefined,

    context: string,

  ) => void;

}) {

  const now = useClock();
  // The coordinator's market feeds refresh while a viewer holds the market watch, which this
  // stream is for as long as the market or stand panel is open (the status owner's status streams.ts).
  const watching = open || marketOpen;
  useEffect(() => {
    if (!watching) return;
    const watch = new EventSource(`${API}/market-watch`);
    return () => watch.close();
  }, [watching]);

  const replacement = useWTBReplacement(catalog);

  const [activeBidFilter, setActiveBidFilter] = useState('');
  const [standPriorityDrafts,setStandPriorityDrafts] = useState<Record<string,string>>({});
  const savingStandPriority = useRef(false);
  async function saveStandPriority(id:string,bid:StandBid) {
    const draft=standPriorityDrafts[id];
    if(draft===undefined || savingStandPriority.current) return;
    const priority=draft===''?null:Number(draft);
    if(priority===(bid.priorityOverride ?? null)) return;
    savingStandPriority.current=true;setSavingBid(id);setBidError('');
    try {
      await saveStandPriorityDraft(id,bid,draft,onBid);
      setStandPriorityDrafts(previous=>{const next={...previous};delete next[id];return next;});
    } catch(error) {setBidError(error instanceof Error?error.message:'Could not save priority');}
    finally {savingStandPriority.current=false;setSavingBid(null);}
  }

  const saleRows = standSaleRows(listings, merchant, nativeStand);
  const buyRows = standBuyRows(bids, nativeStand, merchant, listings);

  const [marketQuantities, setMarketQuantities] = useState<

    Record<string, string>

  >({});

  const [buying, setBuying] = useState<string | null>(null);

  const [purchaseConfirmation, setPurchaseConfirmation] = useState<{

    listing: ALDataListing;

    quantity: number;

  } | null>(null);

  const [saleConfirmation, setSaleConfirmation] = useState<{

    order: ALDataBuyOrder;

    quantity: number;

  } | null>(null);

  const [selling, setSelling] = useState<string | null>(null);

  const [saleQuantities, setSaleQuantities] = useState<Record<string, string>>(

    {},

  );

  const [aldataFilter, setALDataFilter] = useState('');

  const [marketTab, setMarketTab] = useState<

    'wts' | 'wtb' | 'classifieds' | 'ponty'

  >('wts');

  const [pontyPurchaseConfirmation, setPontyPurchaseConfirmation] =

    useState<PontyListing | null>(null);

  const [pontyBuying, setPontyBuying] = useState<string | null>(null);

  const [pontyPurchaseError, setPontyPurchaseError] = useState<string | null>(

    null,

  );

  const [pontyQuantities, setPontyQuantities] = useState<

    Record<string, string>

  >({});

  const [showDealsOnly, setShowDealsOnly] = useState(false);

  const [hideBadDeals, setHideBadDeals] = useState(false);

  const [hideUnaffordable, setHideUnaffordable] = useState(false);
  const [hideUnowned, setHideUnowned] = useState(false);
  const [hideStale,setHideStale]=useStoredBoolean(`party-market-hide-stale-${marketTab}`,false);
  const ignoredKeys=new Set(marketIgnoredItems.map(marketItemKey));
  const [ignoreError,setIgnoreError]=useState('');

  const [hideBlacklisted, setHideBlacklisted] = useState(true);

  const [blacklistOpen, setBlacklistOpen] = useState(false);

  const [confirmBlacklistClear, setConfirmBlacklistClear] = useState(false);

  const [settingsError, setSettingsError] = useState('');
  // A refused market buy or sell, shown in its confirmation as Ponty's refusal is.
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [bidsOpen, setBidsOpen] = useState(false);

  const [confirmBidCancel, setConfirmBidCancel] = useState<string | null>(null);

  const [bidError, setBidError] = useState('');

  const cancelling = useRef(false);

  const [removeConfirmation, setRemoveConfirmation] = useState<string | null>(null);

  const [removing, setRemoving] = useState(false);

  const removalBusy = useRef(false);

  useEffect(() => { setRemoveConfirmation(null); }, [open]);

  useEffect(() => {

    if (removeConfirmation && !saleRows.some(row => row.key === removeConfirmation)) setRemoveConfirmation(null);

  }, [saleRows, removeConfirmation]);

  const removeSale = async (key: string, listing: StandListing) => {

    if (removalBusy.current || cancelling.current) return;

    setConfirmBidCancel(null); setBidError('');

    if (removeConfirmation !== key) { setRemoveConfirmation(key); return; }

    removalBusy.current = true; setRemoving(true);

    try { await onRemove(listing); setRemoveConfirmation(null); }

    catch (error) { setBidError(error instanceof Error ? error.message : String(error)); }

    finally { removalBusy.current = false; setRemoving(false); }

  };

  useEffect(() => { setConfirmBidCancel(null); setBidError(''); }, [open, marketOpen, bidsOpen]);

  useEffect(() => {

    if (confirmBidCancel && !bids[confirmBidCancel]) setConfirmBidCancel(null);

  }, [bids, confirmBidCancel]);

  const [blacklistName, setBlacklistName] = useState('');

  const [blacklistMinutes, setBlacklistMinutes] = useState('60');

  const [activeBidsOpen, setActiveBidsOpen] = useStoredBoolean(

    'adventure-land-active-wtb-open',

    true,

  );

  const [bidFilter, setBidFilter] = useState('');

  const [bidDrafts, setBidDrafts] = useState<

    Record<string, { price: string; quantity: string; minimumQuality: string }>

  >({});

  const [savingBid, setSavingBid] = useState<string | null>(null);

  const allALData = useMemo(() => aldata?.listings || [], [aldata?.listings]);
  // Each Market tab's add-on views (the `list-view` slot); an unset control keeps every row in the
  // tab's own order. A tab builds its rows for the slot only when an installed add-on views it.
  const wtsFilter = useAddonListView('market:wts'), wtbFilter = useAddonListView('market:wtb');
  const classifiedsFilter = useAddonListView('market:classifieds'), pontyFilter = useAddonListView('market:ponty');

  const allBuyOrders = (aldata?.buyOrders || []).filter(

    (order) => order.buyer !== merchant?.name,

  );

  const catalogById = useMemo(

    () => new Map(catalog.map((item) => [item.id, item])),

    [catalog],

  );
  // Each Market tab's rows as an add-on's list view reads them (addon-kit.ts AddonListRows). The
  // grade reads the catalog's flags and grades, as the item card does (item-card-lines.ts).
  const marketItem = (item: { name: string; level?: number }) => {
    const known = catalogById.get(item.name);
    const grades = (known?.meta as { definition?: { grades?: unknown } } | null | undefined)?.definition?.grades;
    return { item: item.name, level: item.level, grade: itemGrade({ upgrade: known?.upgradeable || known?.meta?.upgradeable,
      compound: known?.compoundable || known?.meta?.compoundable, grades }, item.level ?? 0) };
  };
  const wtsRow = (entry: ALDataListing): MarketRow => ({ ...marketItem(entry.item), price: entry.price, seen: entry.seenAt, realm: realmOf(entry),
    key: entry.key, quantity: entry.quantity, seller: entry.seller, map: entry.map });
  const wtbRow = (order: ALDataBuyOrder): MarketBuyRow => ({ ...marketItem(order.item), price: order.price, seen: order.seenAt, realm: realmOf(order),
    key: order.key, quantity: order.quantity, buyer: order.buyer, map: order.map });
  const pontyRow = (listing: PontyListing): PontyRow => ({ ...marketItem(listing.item), price: listing.unitPrice, seen: listing.seenAt, realm: realmOf(listing),
    key: listing.key, quantity: listing.quantity, total: listing.price });

  const visibleBids = Object.entries(bids).filter(([id]) =>

    `${id} ${catalogById.get(id)?.name || ''}`

      .toLowerCase()

      .includes(activeBidFilter.trim().toLowerCase()),

  );

  const dealValuesByItem = useMemo(() => {

    const buyableById = new Map(buyable.map((item) => [item.id, item]));

    return new Map(

      catalog.map((item) => {

        const definition = item.meta?.definition || {};

        const defaultPrice = defaultStandPrice(definition);

        const candidates = (item.meta?.world?.suggestedPrices || []).map(

          (source) =>

            Math.max(defaultPrice, Number(source.suggested) || defaultPrice),

        );

        const vendor = buyableById.get(item.id);

        if (vendor)

          candidates.push(Math.max(1, Number(vendor.cost) || defaultPrice));

        return [

          item.id,

          candidates.length ? Math.min(...candidates) : defaultPrice,

        ] as const;

      }),

    );

  }, [catalog, buyable]);

  const groupedALData = useMemo(() => {

    const groups = new Map<string, ALDataListing[]>();

    allALData.filter(entry=>!hideStale||marketListingFresh(entry.seenAt,now)).forEach((entry) => {

      const identity = JSON.stringify({

        name: entry.item.name,

        level: Number(entry.item.level) || 0,

        p: entry.item.p || null,

        stat_type: entry.item.stat_type || null,

        data: entry.item.data || null,

      });

      const key = `${entry.seller}|${entry.serverRegion}|${entry.serverIdentifier}|${entry.map}|${entry.price}|${identity}`;

      groups.set(key, [...(groups.get(key) || []), entry]);

    });

    return [...groups.values()].map((members) => ({

      ...members[0],

      key: members.map((entry) => entry.key).join('|'),

      quantity: members.reduce(

        (sum, entry) => sum + Math.max(1, Number(entry.quantity) || 1),

        0,

      ),

      groupedListings: members,

    }));

  }, [allALData,hideStale,now]);

  const filteredALData = useMemo(() => {

    const query = aldataFilter.trim().toLowerCase();

    return groupedALData

      .filter((entry) =>

        `${catalogById.get(entry.item.name)?.name || ''} ${entry.item.name} ${entry.seller} ${entry.serverRegion} ${entry.serverIdentifier}`

          .toLowerCase()

          .includes(query),

      )

      .sort(

        (a, b) =>

          Number(marketListingFresh(b.seenAt, now)) -
            Number(marketListingFresh(a.seenAt, now)) || a.price - b.price,

      );

  }, [groupedALData, aldataFilter, now, catalogById]);

  const listingValue = (entry: ALDataListing) => {

    return dealValuesByItem.get(entry.item.name) || 1;

  };

  const isDeal = (entry: ALDataListing) =>

    entry.price < listingValue(entry) * 0.5;

  const isBadDeal = (entry: ALDataListing) =>

    entry.price > listingValue(entry) * 2;

  const blacklistRecord = (

    seller: string,

    region: string,

    identifier: string,

  ) => {

    const exact = blacklist[`${seller}|${region}|${identifier}`];

    const wildcard = blacklist[`${seller}||`];

    return [exact, wildcard].find(

      (record) =>

        record &&

        (autoBlacklistMerchants || record.reason === 'manual') &&

        (record.until === -1 || record.until > now),

    );

  };

  const expandedALData = wtsFilter.sort(filteredALData.filter(

    (entry) =>

      !ignoredKeys.has(marketItemKey(entry.item)) && (!hideStale||marketListingFresh(entry.seenAt,now)) &&
      (!showDealsOnly || isDeal(entry)) &&

      (!hideBadDeals || !isBadDeal(entry)) &&

      (!hideUnaffordable || entry.price <= Number(bank?.gold ?? bankGold ?? 0)) &&

      (!hideBlacklisted ||

        !blacklistRecord(

          entry.seller,

          entry.serverRegion,

          entry.serverIdentifier,

        )) && wtsFilter.keep(wtsRow(entry)),

  ), wtsRow);

  const ownOwner = merchant?.owner == null ? '' : String(merchant.owner);

  const externalTradeOwners = (aldata?.trades || []).filter(

    (owner) => String(owner.owner) !== ownOwner,

  );

  const publicTrades = externalTradeOwners.flatMap((owner) =>

    (owner.listings || []).map((listing) => ({ owner, listing })),

  );

  const owned = (item: Item) => ownedStock?.[ownedStockKey(item)]?.count || 0;

  // The bank section's first counted cell, so List and Add to stand never offer a claimed copy.
  const ownedSource = (item: Item): { entry: InventoryEntry; bankPack?: string } | null =>
    (ownedStock?.[ownedStockKey(item)]?.sources[0] as { entry: InventoryEntry; bankPack?: string } | undefined) ?? null;

  const filteredBuyOrders = wtbFilter.sort(allBuyOrders
    .filter(order=>!ignoredKeys.has(marketItemKey(order.item))&&(!hideStale||marketListingFresh(order.seenAt,now)))
    .filter((order) => (!hideUnowned || owned(order.item) > 0) && wtbFilter.keep(wtbRow(order)))

    .filter((order) =>

      `${catalogById.get(order.item.name)?.name || ''} ${order.item.name} ${order.buyer} ${order.serverRegion} ${order.serverIdentifier}`

        .toLowerCase()

        .includes(aldataFilter.trim().toLowerCase()),

    )

    .sort(

      (a, b) =>

        Number(marketListingFresh(b.seenAt, now)) -
          Number(marketListingFresh(a.seenAt, now)) || b.price - a.price,

    ), wtbRow);

  const bankWTB = filteredBuyOrders.filter((order) =>

    owned(order.item) > 0,

  );

  const offer = (side?: { price?: number; quantity?: number; priceNegotiable?: boolean }) => side && { price: side.price, quantity: side.quantity, negotiable: !!side.priceNegotiable };
  const classifiedsRow = ({ owner, listing }: (typeof publicTrades)[number]): ClassifiedsRow => ({ ...marketItem(listing), price: listing.wts?.price ?? listing.wtb?.price,
    seen: aldata?.tradesUpdatedAt, owner: owner.owner, label: owner.label, characters: owner.characters ?? [], note: listing.note, wts: offer(listing.wts), wtb: offer(listing.wtb) });
  const filteredClassifieds = classifiedsFilter.sort(publicTrades.filter(({ owner, listing }) =>
    !ignoredKeys.has(marketItemKey(listing)) && (!hideStale||marketListingFresh(aldata?.tradesUpdatedAt,now)) && classifiedsFilter.keep(classifiedsRow({ owner, listing })) &&

    `${catalogById.get(listing.name)?.name || ''} ${listing.name} ${owner.label || ''} ${owner.characters?.join(' ') || ''}`

      .toLowerCase()

      .includes(aldataFilter.trim().toLowerCase()),

  ), classifiedsRow);

  const filteredPonty = pontyFilter.sort((ponty?.listings || [])

    .filter((listing) => {

      const item = catalogById.get(listing.item.name);

      return (

        !ignoredKeys.has(marketItemKey(listing.item)) && (!hideStale||marketListingFresh(listing.seenAt,now)) &&
        listing.serverIdentifier !== 'PVP' && pontyFilter.keep(pontyRow(listing)) &&

        `${item?.name || ''} ${listing.item.name}`

          .toLowerCase()

          .includes(aldataFilter.trim().toLowerCase())

      );

    })

    .sort(

      (a, b) =>

        a.unitPrice - b.unitPrice || a.item.name.localeCompare(b.item.name),

    ), pontyRow);



  const pontyGroups = new Map<

    string,

    PontyListing & { realms: Set<string>; stale: boolean }

  >();

  filteredPonty.forEach((listing) => {

    const stale = !marketListingFresh(listing.seenAt,now);

    const key = `${listing.groupKey || listing.key}|${stale ? 'stale' : 'fresh'}`;

    const realm = `${listing.serverRegion || '?'} ${listing.serverIdentifier || '?'}`;

    const existing = pontyGroups.get(key);

    if (existing) {

      existing.quantity += listing.quantity;

      existing.keys!.push(listing.key);

      existing.realms.add(realm);

      existing.unitPrice = Math.max(existing.unitPrice, listing.unitPrice);

      existing.minimumLot = Math.min(existing.minimumLot!, listing.quantity);

      existing.seenAt = Math.max(existing.seenAt || 0, listing.seenAt || 0);

    } else

      pontyGroups.set(key, {

        ...listing,

        key,

        stale,

        keys: [listing.key],

        realms: new Set([realm]),

        minimumLot: listing.quantity,

      });

  });

  const marketItemLabel=(item:MarketItemIdentity)=>{
    const known=catalogById.get(item.name);
    return `${known?.name||item.name}${known?.upgradeable||known?.compoundable||known?.meta?.upgradeable||known?.meta?.compoundable||item.level?' +'+(item.level??0):''}`;
  };
  const updateIgnored=async(actionName:'add'|'remove'|'clear',item?:MarketItemIdentity)=>{
    setIgnoreError('');setSettingsError('');setSettingsSaving(true);
    try{await action.mutateAsync({path:'/market/ignored-items',body:{action:actionName,...item,level:item?.level??0}});}
    catch(error){const message=error instanceof Error?error.message:'Could not save ignored items';setIgnoreError(message);setSettingsError(message);}
    finally{setSettingsSaving(false);}
  };
  const ignoreButton=(item:MarketItemIdentity)=><IgnoreMarketItemButton label={marketItemLabel(item)} disabled={settingsSaving} onIgnore={()=>void updateIgnored('add',item)}/>;

  const pontyRows = [...pontyGroups.values()].map((listing) => {

    const requestedQuantity = Number(

      pontyQuantities[listing.key] ?? listing.minimumLot ?? 1,

    );

    const realmLabel =

      listing.realms.size > 1 ? 'Mixed realms' : [...listing.realms][0];

    const stale = listing.stale;

    const item = catalogById.get(listing.item.name);

    const level = Number(listing.item.level) || 0;

    const bid = bids[listing.item.name];

    const satisfiesBid =
      !!bid && listing.unitPrice <= bid.price && bidAcceptsLevel(bid, listing.item);

    return (

      <div

        key={listing.key}

        className="flex flex-wrap items-center gap-3 rounded border border-fuchsia-900 bg-black p-2"

      >

        {ignoreButton(listing.item)}

        <button

          type="button"

          onClick={() =>

            onInspect(listing.item, item?.meta, "Ponty's inventory")

          }

          className="flex min-w-0 flex-1 items-center gap-3 rounded text-left text-emerald-50 hover:text-fuchsia-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500"

        >

          <div className="relative h-10 w-10 shrink-0">

            {item?.sprite && <SpriteCrop sprite={item.sprite} />}

          </div>

          <div className="min-w-0 flex-1">

            <p className="truncate text-sm">

              {item?.name || listing.item.name}

              {item && (item.upgradeable || item.compoundable)

                ? ` +${level}`

                : ''}

            </p>

            <p className="font-mono text-xs text-fuchsia-200">

              {realmLabel} · {listing.quantity} available ·{' '}

              {listing.unitPrice.toLocaleString()}g each

            </p>

            <p className="text-xs text-slate-300">

              Observed{' '}

              {listing.seenAt

                ? `${Math.max(0, Math.floor((now - listing.seenAt) / 1000))}s ago`

                : 'at an unknown time'}

              {stale ? ' · stale' : ' · fresh'}

            </p>

          </div>

        </button>

        {satisfiesBid ? (

          <span className="rounded border border-violet-600 bg-violet-950 px-2 py-1 font-mono text-[10px] uppercase text-violet-100">

            Matches WTB

          </span>

        ) : null}

        <Input

          aria-label={`Ponty quantity for ${item?.name || listing.item.name}`}

          type="number"

          min={1}

          max={listing.quantity}

          step={1}

          value={pontyQuantities[listing.key] ?? listing.minimumLot ?? 1}

          onChange={(event) =>

            setPontyQuantities((previous) => ({

              ...previous,

              [listing.key]: event.target.value,

            }))

          }

          className="w-24 border-fuchsia-700 bg-black text-white"

        />

        <span className="whitespace-nowrap font-mono text-xs text-fuchsia-200">

          Up to{' '}

          {(listing.unitPrice * (requestedQuantity || 0)).toLocaleString()}g

        </span>

        <Button

          size="sm"

          disabled={

            pontyBuying === listing.key ||

            stale ||

            !Number.isSafeInteger(requestedQuantity) ||

            requestedQuantity < 1 ||

            requestedQuantity > listing.quantity

          }

          onClick={() => {

            setPontyPurchaseError(null);

            setPontyPurchaseConfirmation({

              ...listing,

              realmLabel,

              quantity: requestedQuantity,

              price: requestedQuantity * listing.unitPrice,

            });

          }}

          className="border border-fuchsia-300 bg-fuchsia-500 text-black hover:bg-fuchsia-400 hover:text-black"

        >

          {pontyBuying === listing.key ? 'Queuing…' : 'Buy'}

        </Button>

      </div>

    );

  });

  const draftFor = (id: string) =>

    bidDrafts[id] || {

      price: bids[id] ? String(bids[id].price) : '',

      quantity: bids[id] ? String(bids[id].quantity) : '',

      minimumQuality: String(bids[id]?.minimumQuality || 0),

    };

  // The WTB picker and the order editor save through onEditBuy; this sheet only clears an order.
  const clearBid = async (id: string) => {
    const draft = draftFor(id);
    setSavingBid(id);
    try {
      await onBid(id, Number(draft.price), Number(draft.quantity), Number(draft.minimumQuality || 0), true);
      setBidDrafts((old) => ({
        ...old,
        [id]: { price: '', quantity: '', minimumQuality: '0' },
      }));
    } finally {

      setSavingBid(null);

    }

  };

  const cancelBid = async (id: string) => {

    if (cancelling.current || removalBusy.current || savingBid || !bids[id]) return;

    setRemoveConfirmation(null);

    setBidError('');

    if (confirmBidCancel !== id) { setConfirmBidCancel(id); return; }

    cancelling.current = true;

    try { await clearBid(id); setConfirmBidCancel(null); }

    catch (error) { setBidError(error instanceof Error ? error.message : 'Could not cancel WTB order'); }

    finally { cancelling.current = false; }

  };

  const cancelControl = (id: string) => (

    <Button size="sm" variant="outline" disabled={Boolean(savingBid) || removing}

      onClick={() => void cancelBid(id)}

      className="border-rose-700 bg-black text-rose-200 hover:bg-rose-950 hover:text-white">

      {savingBid === id ? 'Saving…' : confirmBidCancel === id ? 'Really cancel?' : 'Cancel'}

    </Button>

  );

  // The Keep on stand control of the stand dialog's buy card and the market's active WTB row.
  const keepOnStand = (id: string, bid: StandBid, disabled = false) => (
    <WTBPreference label="Keep on stand" description={standBuyExplanation} checked={bid.useStandSlot === true} disabled={disabled}
      onChange={(useStandSlot) => void replacement.save((replaceStandEntry) => onBid(id, bid.price, bid.quantity, bid.minimumQuality, false,
        bid.priorityOverride, { useStandSlot, replaceStandEntry, preferencesOnly: true }))} />
  );
  const bidFailure = bidError ? <p role="alert" className="text-sm text-rose-200">{bidError}</p> : null;

  const toggleActiveBids = () => setActiveBidsOpen((open) => !open);

  const filteredCatalog = catalog.filter((item) =>

    `${item.name} ${item.id}`.toLowerCase().includes(bidFilter.toLowerCase()),

  );

  const makeWTB = (entry: ALDataListing) => {

    const level = Number(entry.item.level || 0);

    setBidFilter(entry.item.name);

    setBidDrafts((old) => ({

      ...old,

      [entry.item.name]: {

        price: String(entry.price),

        quantity: '1',

        minimumQuality: String(level),

      },

    }));

    setBidsOpen(true);

  };

  const makeClassifiedWTB = (

    listing: NonNullable<ALDataPublicTrade['listings']>[number],

  ) => {

    const price = Number(listing.wts?.price || 0);

    if (!price) return;

    setBidFilter(listing.name);

    setBidDrafts((old) => ({

      ...old,

      [listing.name]: {

        price: String(price),

        quantity: '1',

        minimumQuality: String(Number(listing.level) || 0),

      },

    }));

    setBidsOpen(true);

  };

  const action = usePartyAction();

  // Answers whether the save went through; a refusal shows in settingsError.
  const saveMarketSetting = async (save: () => Promise<unknown>) => {
    setSettingsSaving(true);
    setSettingsError('');
    try {
      await save();
      return true;
    } catch (failure) {

      setSettingsError(

        failure instanceof Error

          ? failure.message

          : 'Could not save marketplace settings',
      );
      return false;
    } finally {

      setSettingsSaving(false);

    }

  };

  const updateBlacklist = (payload: Record<string, unknown>) =>

    saveMarketSetting(() =>

      action.mutateAsync({ path: '/merchant/blacklist', body: payload }),

    );

  const blacklistRecords = Object.entries(blacklist).sort(

    ([, a], [, b]) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0),

  );

  const marketRows = (entries: ALDataListing[]) =>

    entries.map((entry) => {

      const item = catalogById.get(entry.item.name),

        key = entry.key;

      const stackable = Number(item?.meta?.definition?.s || 1) > 1;

      const multipleAvailable = entry.quantity > 1;

      const age = Math.max(0, Math.floor((now - entry.seenAt) / 1000));

      const fresh = marketListingFresh(entry.seenAt,now) && entry.serverIdentifier !== 'PVP';

      const suggested = listingValue(entry);

      const deal = isDeal(entry);
      const badDeal = isBadDeal(entry);

      const dealDiscount = Math.max(

        0,

        Math.round((1 - entry.price / suggested) * 100),

      );

      const priceDifference = Math.round(

        Math.abs(entry.price / suggested - 1) * 100,

      );

      const comparison = deal

        ? `deal · ${dealDiscount}% off`

        : entry.price > suggested

          ? `${priceDifference}% above`

          : entry.price < suggested

            ? `${priceDifference}% below`

            : 'at suggested';

      return (

        <div

          key={key}

          className={`flex items-center gap-3 rounded border border-cyan-950 bg-cyan-950/10 p-2 ${fresh ? '' : 'opacity-65'}`}

        >

          {ignoreButton(entry.item)}

          <button

            type="button"

            onClick={() =>

              onInspect(

                entry.item,

                item?.meta,

                `${entry.seller}'s ALData listing`,

              )

            }

            className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-cyan-300"

          >

            <div className="relative h-10 w-10 shrink-0">

              {item?.sprite && <SpriteCrop sprite={item.sprite} />}

            </div>

            <div className="min-w-0 flex-1">

              <p className="truncate text-sm">

                {item?.name || entry.item.name}

                {item && (item.upgradeable || item.compoundable)

                  ? ` +${entry.item.level || 0}`

                  : ''}

              </p>

              <p className="font-mono text-[10px] text-cyan-100/50">

                {entry.seller} · {entry.serverRegion} {entry.serverIdentifier} ·{' '}

                {entry.map} · seen{' '}

                {age < 3600 ? `${age}s` : `${Math.floor(age / 3600)}h`} ago

                {multipleAvailable

                  ? ` · ${entry.quantity} available${stackable ? '' : ' · not stackable'}`

                  : ''}

              </p>

            </div>

          </button>

          <span

            className={`whitespace-nowrap font-mono text-xs ${deal ? 'font-semibold text-emerald-300' : badDeal ? 'font-semibold text-rose-400' : 'text-amber-300'}`}

            title={`Suggested price: ${suggested.toLocaleString()}g · ${comparison}`}

          >

            {entry.price.toLocaleString()}g{' '}

            <span className="text-[9px] uppercase">{comparison}</span>

          </span>

          {fresh ? (

            multipleAvailable ? (

              <>

                <QuantityAction
                  label={`Quantity of ${entry.item.name}`}
                  value={marketQuantities[key]}
                  maximum={entry.quantity}
                  tone="buy"
                  busy={buying === key}
                  allDisabled={buying === key}
                  actionLabel={buying === key ? 'Queuing…' : 'Buy'}
                  onChange={(value) => setMarketQuantities((old) => ({ ...old, [key]: value }))}
                  onAction={(quantity) => setPurchaseConfirmation({ listing: entry, quantity })}
                />

              </>

            ) : (

              <Button

                size="sm"

                disabled={buying === key}

                onClick={() =>

                  setPurchaseConfirmation({ listing: entry, quantity: 1 })

                }

                className="bg-cyan-500 text-cyan-950 hover:bg-cyan-400"

              >

                {buying === key ? 'Queuing…' : 'Buy'}

              </Button>

            )

          ) : (

            <Button

              size="sm"

              variant="outline"

              onClick={() => makeWTB(entry)}

              className="border-violet-600 bg-black text-violet-200 hover:bg-violet-950 hover:text-white"

            >

              Make WTB

            </Button>

          )}

        </div>

      );

    });

  const buyOrderRows = (orders: ALDataBuyOrder[]) =>

    orders.map((order) => {

      const item = catalogById.get(order.item.name),

        key = order.key;

      const have = owned(order.item);

      const source = ownedSource(order.item);

      const age = Math.max(0, Math.floor((now - order.seenAt) / 1000));

      const fresh = marketListingFresh(order.seenAt,now) && order.serverIdentifier !== 'PVP';

      const maximum = Math.min(have, order.quantity);

      return (

        <div

          key={key}

          className={`flex items-center gap-3 rounded border p-2 ${have ? 'border-emerald-900 bg-emerald-950/15' : 'border-violet-950 bg-violet-950/10'} ${fresh ? '' : 'opacity-60'}`}

        >

          {ignoreButton(order.item)}

          <button

            type="button"

            onClick={() =>

              onInspect(order.item, item?.meta, `${order.buyer}'s live WTB`)

            }

            className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-violet-300"

          >

            <div className="relative h-10 w-10 shrink-0">

              {item?.sprite && <SpriteCrop sprite={item.sprite} />}

            </div>

            <div className="min-w-0 flex-1">

              <p className="truncate text-sm">

                {item?.name || order.item.name}

                {item?.meta?.upgradeable || item?.meta?.compoundable

                  ? ` +${Number(order.item.level) || 0}`

                  : ''}

              </p>

              <p className="font-mono text-[10px] text-violet-100/50">

                {order.buyer} · {order.serverRegion} {order.serverIdentifier} ·

                seen {age < 3600 ? `${age}s` : `${Math.floor(age / 3600)}h`} ago

                · wants {order.quantity}

              </p>

            </div>

          </button>

          <span className="whitespace-nowrap font-mono text-xs text-violet-200">

            WTB {order.price.toLocaleString()}g

          </span>

          <span

            className={`whitespace-nowrap font-mono text-[10px] ${have ? 'text-emerald-300' : 'text-slate-500'}`}

          >

            You have {have}

          </span>

          {fresh && maximum > 0 ? (

            <>

              <QuantityAction
                label={`Quantity of ${order.item.name} to sell`}
                value={saleQuantities[key]}
                maximum={maximum}
                tone="sell"
                busy={selling === key}
                actionLabel="Sell"
                onChange={(value) => setSaleQuantities((old) => ({ ...old, [key]: value }))}
                onAction={(quantity) => setSaleConfirmation({ order, quantity })}
              />

            </>

          ) : !fresh && source ? (

            <Button

              size="sm"

              variant="outline"

              onClick={() =>

                onListForWTB(

                  source.entry,

                  source.bankPack,

                  order.price,

                  maximum,

                )

              }

              className="border-amber-600 bg-black text-amber-100 hover:bg-amber-950 hover:text-white"

            >

              List

            </Button>

          ) : (

            <span className="font-mono text-[10px] uppercase text-slate-500">

              {!fresh ? 'Stale · no match owned' : 'No match owned'}

            </span>

          )}

        </div>

      );

    });

  return (

    <>

      {replacement.dialog}

      <Dialog open={open} onOpenChange={onOpenChange}>

        <DialogContent data-area="stand" showCloseButton={false} className="flex max-h-[92dvh] w-[96vw] flex-col overflow-hidden border border-amber-800 bg-[#0b1916] text-emerald-50 sm:max-w-5xl">

          <DialogHeader className="relative shrink-0 pr-12">

            <DialogTitle className="sr-only">Stand</DialogTitle>

            <DialogDescription className="sr-only">Manage sales and buy orders.</DialogDescription>

            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-base font-semibold text-amber-200">Items for sale · {saleRows.filter(row => row.occupied).length}/{stand?.slots ?? '-'} slots</h2>
              <span className={`text-xs font-semibold ${merchant?.standOpen ? 'text-emerald-300' : 'text-red-300'}`}>
                {merchant?.standOpen === true ? 'Stand open' : merchant?.standOpen === false ? 'Stand closed' : 'Stand status unknown'}
              </span>
            </div>

            <DialogClose aria-label="Close stand" render={<Button size="icon-sm" variant="outline" className="absolute right-0 top-0 border-slate-600 bg-black text-slate-100 hover:bg-slate-800 hover:text-white" />}><X /></DialogClose>

          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">



          {[{queued:false,rows:saleRows.filter(row=>row.occupied)}, {queued:true,rows:saleRows.filter(row=>!row.occupied)}].filter(group=>!group.queued || group.rows.length).map(group=><section key={String(group.queued)}>
            {group.queued && <h2 className="mb-3 text-base font-semibold text-amber-200">Queued sales for stand</h2>}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">

            {group.rows.length ? (

              group.rows.map(({ configured, liveEntry, status, editable, key }) => {

                const itemMeta =

                  liveEntry?.meta ||

                  catalogById.get(configured.item.name)?.meta;

                const valuedEntry: InventoryEntry = {

                  slot: configured.slot,

                  item: liveEntry?.item || configured.item,

                  meta: itemMeta,

                };

                return (

                  <Tooltip

                    key={key}

                  >

                    <TooltipTrigger

                      render={

                        <div className="flex min-w-0 flex-wrap items-center gap-3 rounded border border-amber-800 bg-black p-3 hover:border-amber-500" />

                      }

                    >

                      <button

                        type="button"

                        title="Inspect item"

                        onClick={() =>

                          onInspect(

                            configured.item,

                            itemMeta,

                            'Your merchant stand',

                          )

                        }

                        className="flex w-full min-w-0 flex-wrap items-center gap-3 rounded text-left text-emerald-50 hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"

                      >

                        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded border border-amber-900/70 bg-black/40 p-1">

                          {itemMeta?.sprite && (

                            <SpriteCrop sprite={itemMeta.sprite} />

                          )}

                          {(Number(

                            liveEntry?.item.level ?? configured.item.level,

                          ) || 0) > 0 ? (

                            <span className="absolute left-1 top-1 z-10 rounded bg-black/80 px-1 font-mono text-[9px] font-semibold text-emerald-300">

                              +

                              {Number(

                                liveEntry?.item.level ?? configured.item.level,

                              ) || 0}

                            </span>

                          ) : null}

                          {liveEntry?.item.stat_type ||

                          configured.item.stat_type ? (

                            <span

                              className={`absolute right-1 top-1 z-10 rounded px-1 font-mono text-[8px] uppercase ring-1 ${statBadgeClass(String(liveEntry?.item.stat_type || configured.item.stat_type))}`}
                              style={statBadgeStyle(String(liveEntry?.item.stat_type || configured.item.stat_type))}

                            >

                              {String(

                                liveEntry?.item.stat_type ||

                                  configured.item.stat_type,

                              )}

                            </span>

                          ) : null}

                          <MluckClover

                            item={liveEntry?.item || configured.item}

                          />

                          <span className="absolute bottom-1 left-1 z-10 rounded bg-black/80 px-1 font-mono text-[9px] text-amber-200">

                            {Math.max(

                              1,

                              Number(

                                liveEntry?.item.q ||

                                  configured.quantity ||

                                  configured.item.q ||

                                  1,

                              ),

                            )}

                          </span>

                        </div>

                        <span className="min-w-0 flex-1 truncate text-sm">

                          {String(

                            itemMeta?.definition.name || configured.item.name,

                          )}

                          {itemMeta &&

                          (itemMeta.upgradeable || itemMeta.compoundable)

                            ? ` +${configured.item.level || 0}`

                            : ''}

                        </span>

                        {status !== 'Queued' && <span

                          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${status === 'Live' ? 'border-emerald-700 text-emerald-300' : 'border-rose-800 text-rose-300'}`}

                        >

                          {status}

                        </span>}

                        </button>
                      <Button size="sm" variant="outline" aria-label={`Edit sale price for ${configured.item.name}`} className="border-amber-600 bg-black font-mono text-amber-100 hover:bg-amber-950 hover:text-white" disabled={!editable} onClick={() => onEdit(configured)}>
                        {Number(liveEntry?.item.price || configured.price || 0).toLocaleString()}g
                      </Button>
                      {editable && <>

                      <Button

                        size="sm"

                        variant="outline"

                        aria-label={`Remove ${String(itemMeta?.definition.name || configured.item.name)} from stand`}

                        title="Remove from stand"

                        disabled={removing || Boolean(savingBid)}

                        onClick={() => void removeSale(key, configured)}

                        className="border-rose-700 bg-black text-rose-200 hover:bg-rose-950 hover:text-white"

                      >

                        {removing && removeConfirmation === key ? 'Removing…' : removeConfirmation === key ? 'Really remove?' : 'Remove'} <X className="h-4 w-4" />

                      </Button>

                      </>}

                    </TooltipTrigger>

                    <TooltipContent

                      side="left"

                      align="center"

                      className="block max-h-[70vh] w-96 overflow-y-auto border border-amber-700 bg-black p-3 text-left font-mono text-[11px] leading-relaxed text-emerald-50 shadow-2xl"

                    >

                      <SuggestedPriceDetails

                        entry={valuedEntry}

                        buyable={buyable}

                        catalog={catalog}

                        observed={priceHistory[configured.item.name]}

                      />

                    </TooltipContent>

                  </Tooltip>

                );

              })

            ) : (

              <p className="text-sm text-emerald-100/45">

                No sale items are occupying stand slots.

              </p>

            )}

          </div>

          </section>)}
          <h2 className="text-base font-semibold text-violet-200">Buy orders · {buyRows.length}/{stand?.slots ?? '-'} slots</h2>

          {bidFailure}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">

            {buyRows.map(({ key, id, bid, observed, level, price, quantity }) => {

              const item = catalogById.get(id);

              return <div key={key} className="relative min-w-0 space-y-3 rounded border border-violet-800 bg-black p-3">

                <button type="button" onClick={() => onInspect({ name: id, level }, item?.meta, 'Your stand buy order')} className="flex w-full items-center gap-3 pr-12 text-left text-emerald-50 hover:text-violet-200">

                  <div className="relative h-12 w-12 shrink-0">{(item?.sprite || item?.meta?.sprite) && <SpriteCrop sprite={(item?.sprite || item?.meta?.sprite)!} />}</div>

                  <span>{item?.name || id}{item?.upgradeable || item?.compoundable || item?.meta?.upgradeable || item?.meta?.compoundable ? ` +${level}` : ''}</span>

                </button>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-violet-100">{(bid?.quantity ?? quantity).toLocaleString()} wanted</span>
                  <Button size="sm" variant="outline" disabled={!bid} aria-label={`Edit buy price for ${item?.name || id}`} onClick={() => onEditBuy({name:id,level},item?.meta)} className="border-violet-600 bg-black font-mono text-violet-100 hover:bg-violet-950 hover:text-white">{price.toLocaleString()}g</Button>
                </div>

                {bid && observed && Number(observed.item.q || 1) !== bid.quantity && <p className="text-sm text-slate-300">Native batch: {Number(observed.item.q || 1).toLocaleString()}</p>}

                {bid && <label className="flex items-center gap-2 text-xs text-violet-200">Priority
                  <WTBPriorityInput className="h-8 w-24 font-mono" value={standPriorityDrafts[id] ?? (bid.priorityOverride == null ? '' : String(bid.priorityOverride))} disabled={Boolean(savingBid)} onChange={value => setStandPriorityDrafts(previous => ({...previous,[id]:value}))} onBlur={() => void saveStandPriority(id,bid)} onKeyDown={event => {if(event.key === 'Enter') event.currentTarget.blur(); if(event.key === 'Escape') setStandPriorityDrafts(previous => {const next={...previous};delete next[id];return next;});}} />
                </label>}



                {bid && <div className="flex flex-wrap items-center justify-between gap-3">

                  {keepOnStand(id, bid, Boolean(savingBid))}

                  {cancelControl(id)}

                </div>}

              </div>;

            })}

          </div>

          {!buyRows.length && <p className="text-sm text-slate-300">No stand buy orders.</p>}

          </div>



          <AddonSlot name="dialog-section" part="stand" />
        </DialogContent>

      </Dialog>

      <Dialog open={marketOpen} onOpenChange={onMarketOpenChange}>

        <DialogContent data-area="market"

          showCloseButton={false}

          className="flex max-h-[92vh] w-[96vw] max-w-[96vw] flex-col overflow-hidden border-cyan-800 bg-[#0b1916] text-emerald-50 sm:max-w-[96vw] 2xl:max-w-[1500px]"

        >

          <DialogHeader>

            <div className="flex items-center justify-between gap-3">

              <DialogTitle>ALData merchant market</DialogTitle>

              {bidFailure}

              <div className="flex items-center gap-2">

                <Button

                  type="button"

                  size="icon-sm"

                  variant="outline"

                  aria-label="Marketplace settings"

                  title="Marketplace settings"

                  onClick={() => {

                    setConfirmBlacklistClear(false);

                    setBlacklistOpen(true);

                  }}

                  className="border-slate-600 bg-black text-slate-200 hover:bg-slate-900 hover:text-white"

                >

                  <Settings className="h-4 w-4" />

                </Button>

                <DialogClose

                  render={

                    <Button

                      size="icon-sm"

                      className="border border-slate-600 bg-black text-slate-200 hover:bg-slate-900 hover:text-white"

                    />

                  }

                  aria-label="Close market"

                >

                  <X className="h-4 w-4" />

                </DialogClose>

              </div>

            </div>

            <DialogDescription>

              Browse live offers and player-published classifieds. Public

              browsing requires no ALData key.
              <span className="ml-2 text-xs text-slate-400">{marketAge(now, aldata?.merchantsUpdatedAt, ponty?.updatedAt)}</span>

            </DialogDescription>

          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">

            {(aldata?.auth !== 'CORRECT' || aldata?.error || ponty?.error || !aldata?.merchantsUpdatedAt) && (
            <div

              className="rounded border border-slate-600 bg-slate-950 p-3 text-sm text-slate-100"

              aria-live="polite"

            >

              {aldata?.error || ponty?.error ? (

                <p className="text-amber-200">

                  Market data unavailable: {aldata?.error || ponty?.error}.

                  Cached offers may be stale. Retry when ALData is available.

                </p>

              ) : !aldata?.merchantsUpdatedAt ? (

                <p>Loading market data from ALData…</p>

              ) : null}

              {aldata?.auth !== 'CORRECT' && (
                <div className="flex flex-wrap items-center gap-3 text-red-300">
                  <p>ALData publishing is not configured</p>
                  <Button variant="outline" onClick={onALDataSetup}
                    className="border-red-500 bg-red-950 text-red-100 hover:bg-red-900 hover:text-white">
                    Go to setup
                  </Button>
                </div>
              )}

            </div>
            )}

            <div className="rounded border border-violet-900/70 bg-violet-950/10 p-3">

              <div className="flex items-center justify-between gap-3">

                <button

                  type="button"

                  onClick={toggleActiveBids}

                  aria-expanded={activeBidsOpen}

                  className="flex items-center gap-2 rounded bg-black/20 px-2 py-1 font-mono text-xs uppercase text-violet-300 hover:bg-violet-950 hover:text-violet-100"

                >

                  {activeBidsOpen ? (

                    <ChevronDown className="h-4 w-4" />

                  ) : (

                    <ChevronRight className="h-4 w-4" />

                  )}{' '}

                  Active WTB orders ({Object.keys(bids).length})

                </button>

                <Button

                  size="sm"

                  variant="outline"

                  onClick={() => setBidsOpen(true)}

                  className="border-violet-600 bg-black text-violet-100 hover:bg-violet-950 hover:text-white"

                >

                  New WTB order

                </Button>

              </div>

              {activeBidsOpen ? (

                <div className="mt-2 space-y-2">

                  <div className="flex items-center gap-2">

                    <Input

                      aria-label="Filter WTB orders"

                      placeholder="Filter WTB orders by item name..."

                      value={activeBidFilter}

                      onChange={(event) =>

                        setActiveBidFilter(event.target.value)

                      }

                      className="h-9 min-w-0 flex-1 border-violet-600 bg-black text-violet-100 placeholder:text-violet-300"

                    />

                    <span className="shrink-0 text-xs tabular-nums text-violet-200">

                      {visibleBids.length} / {Object.keys(bids).length}

                    </span>

                    {activeBidFilter && (

                      <Button

                        size="sm"

                        variant="outline"

                        onClick={() => setActiveBidFilter('')}

                        className="border-violet-600 bg-black text-violet-100 hover:bg-violet-950 hover:text-white"

                      >

                        Clear

                      </Button>

                    )}

                  </div>

                  <div className="grid grid-cols-1 gap-2 2xl:grid-cols-2">

                    {visibleBids.length ? (

                      visibleBids.map(([itemId, bid]) => {

                        const item = catalogById.get(itemId);

                        return (

                          <div

                            key={itemId}

                            className="flex min-w-0 flex-wrap items-center gap-2 rounded border border-violet-900 bg-black px-2 py-1.5"

                          >

                            <button type="button" aria-label={`Inspect ${item?.name || itemId}`}
                              onClick={() => onInspect({ name: itemId, level: bid.minimumQuality || 0 }, item?.meta, 'Your active WTB order')}
                              className="flex min-w-0 flex-1 items-center gap-2 rounded border border-transparent bg-black text-left text-violet-100 hover:border-violet-500 hover:bg-violet-950 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
                            <div className="relative h-8 w-8 shrink-0">

                              {item?.sprite && (

                                <SpriteCrop sprite={item.sprite} />

                              )}

                            </div>

                            <span className="min-w-0 flex-1 truncate text-xs">

                              {item?.name || itemId}

                              {item && (item.upgradeable || item.compoundable)

                                ? ` · +${bid.minimumQuality || 0}`

                                : ''}

                            </span>

                            </button>

                            <ActiveWTBFields name={item?.name || itemId} bid={bid} disabled={Boolean(savingBid)}
                              onEditPrice={() => onEditBuy({ name: itemId, level: bid.minimumQuality || 0 }, item?.meta)}
                              onSave={async (field, value) => {
                                setSavingBid(itemId);
                                try {
                                  await saveActiveBidField(itemId, bid, field, value, onBid);
                                } finally { setSavingBid(null); }
                              }} />
                            <div className="flex shrink-0 items-center gap-2">

                              {keepOnStand(itemId, bid)}



                            </div>

                            <div className="order-last w-full">
                              <WTBUnconfirmedPurchase itemId={itemId} name={item?.name || itemId} purchases={nativeStand?.purchases} />
                            </div>

                            {(item?.upgradeable ||

                              item?.compoundable ||

                              nativeStand?.problems[itemId] ||

                              Object.values(nativeStand?.offers || {}).some(

                                (offer) =>

                                  offer.itemId === itemId && offer.problem,

                              )) && (

                              <div className="order-last grid w-full gap-2 border-t border-violet-900 pt-2">

                                {(item?.upgradeable || item?.compoundable) && (

                                  <WTBPreference

                                    label="Accept higher levels"

                                    description={higherLevelExplanation}

                                    checked={bid.acceptHigherLevels !== false}

                                    onChange={(acceptHigherLevels) =>

                                      void replacement.save(() =>

                                        onBid(

                                          itemId,

                                          bid.price,

                                          bid.quantity,

                                          bid.minimumQuality,

                                          false,

                                          bid.priorityOverride,

                                          {

                                            acceptHigherLevels,

                                            preferencesOnly: true,

                                          },

                                        ),

                                      )

                                    }

                                  />

                                )}

                                {(nativeStand?.problems[itemId] ||

                                  Object.values(nativeStand?.offers || {}).find(

                                    (offer) => offer.itemId === itemId,

                                  )?.problem) && (

                                  <p className="text-xs text-amber-200">

                                    {nativeStand?.problems[itemId] ||

                                      Object.values(

                                        nativeStand?.offers || {},

                                      ).find((offer) => offer.itemId === itemId)

                                        ?.problem}

                                  </p>

                                )}

                              </div>

                            )}

                            {cancelControl(itemId)}

                          </div>

                        );

                      })

                    ) : (

                      <span className="text-xs text-violet-200">

                        {Object.keys(bids).length

                          ? 'No WTB orders match this filter.'

                          : 'No active orders.'}

                      </span>

                    )}

                  </div>

                </div>

              ) : null}

            </div>

            <div className="flex gap-2">

              {(

                [

                  ['wts', `Live WTS (${allALData.length})`],

                  ['wtb', `Live WTB (${allBuyOrders.length})`],

                  ['classifieds', `Classifieds (${publicTrades.length})`],

                  ['ponty', `Ponty (${ponty?.listings?.length || 0})`],

                ] as const

              )

                .map(([id, label]) => (

                  <Button

                    key={id}

                    size="sm"

                    variant="outline"

                    onClick={() => setMarketTab(id)}

                    className={

                      marketTab === id

                        ? 'border-cyan-400 bg-cyan-950 text-cyan-100 hover:bg-cyan-900'

                        : 'border-slate-700 bg-black text-slate-300 hover:bg-slate-900 hover:text-white'

                    }

                  >

                    {label}

                  </Button>

                ))}

            </div>

            <div className="flex flex-wrap items-center gap-3">

              <Input

                value={aldataFilter}

                onChange={(event) => setALDataFilter(event.target.value)}

                placeholder="Search item, seller, server, or map…"

                className="border-cyan-800 bg-black text-emerald-50"

              />

              <label className="flex shrink-0 items-center gap-2 rounded border border-slate-600 bg-black px-3 py-2 text-sm text-slate-100" title="Hide observations older than two minutes; classifieds use the last successful feed refresh.">
                <Checkbox checked={hideStale} onCheckedChange={checked=>setHideStale(checked===true)}/>
                Hide stale listings
              </label>
              {ignoreError&&<p role="alert" className="text-sm text-rose-200">{ignoreError}</p>}
              {marketTab === 'wts' ? (

                <>

                  <label className="flex shrink-0 items-center gap-2 rounded border border-emerald-700 bg-black px-3 py-2 text-sm text-emerald-100">

                    <Checkbox

                      checked={showDealsOnly}

                      onCheckedChange={(checked) =>

                        setShowDealsOnly(checked === true)

                      }

                    />

                    Show deals only

                  </label>

                  <label className="flex shrink-0 items-center gap-2 rounded border border-rose-800 bg-black px-3 py-2 text-sm text-rose-100">

                    <Checkbox

                      checked={hideBadDeals}

                      onCheckedChange={(checked) =>

                        setHideBadDeals(checked === true)

                      }

                    />

                    Hide bad deals

                  </label>

                  <label className="flex shrink-0 items-center gap-2 rounded border border-amber-700 bg-black px-3 py-2 text-sm text-amber-100">

                    <Checkbox

                      checked={hideUnaffordable}

                      onCheckedChange={(checked) =>

                        setHideUnaffordable(checked === true)

                      }

                    />

                    Hide unaffordable

                  </label>

                  <label className="flex shrink-0 items-center gap-2 rounded border border-slate-600 bg-black px-3 py-2 text-sm text-slate-100">

                    <Checkbox

                      checked={hideBlacklisted}

                      onCheckedChange={(checked) =>

                        setHideBlacklisted(checked === true)

                      }

                    />

                    Hide blacklisted merchants

                  </label>

                </>

              ) : null}
              {marketTab === 'wtb' ? (
                <label className="flex shrink-0 items-center gap-2 rounded border border-emerald-700 bg-black px-3 py-2 text-sm text-emerald-100">
                  <Checkbox checked={hideUnowned} onCheckedChange={(checked) => setHideUnowned(checked === true)} />
                  Hide unowned
                </label>
              ) : null}
              {marketTab === 'wts' && wtsFilter.declared ? <AddonSlot name="list-view" part="market:wts" rows={filteredALData.map(wtsRow)} view={wtsFilter} search /> : null}
              {marketTab === 'wtb' && wtbFilter.declared ? <AddonSlot name="list-view" part="market:wtb" rows={allBuyOrders.map(wtbRow)} view={wtbFilter} search /> : null}
              {marketTab === 'classifieds' && classifiedsFilter.declared ? <AddonSlot name="list-view" part="market:classifieds" rows={publicTrades.map(classifiedsRow)} view={classifiedsFilter} search /> : null}
              {marketTab === 'ponty' && pontyFilter.declared ? <AddonSlot name="list-view" part="market:ponty" rows={(ponty?.listings ?? []).map(pontyRow)} view={pontyFilter} search /> : null}

            </div>

            <div className="space-y-2 pr-1">

              {marketOpen && marketTab === 'wts' ? (

                !expandedALData.length ? (

                  <p className="text-sm text-emerald-100/45">

                    {showDealsOnly

                      ? 'No listings are currently below 50% of their suggested price.'

                      : hideBadDeals

                        ? 'No matching listings remain after hiding prices over 100% above suggested.'

                        : hideUnaffordable

                          ? `No matching listings are affordable with ${Number(bank?.gold ?? bankGold ?? 0).toLocaleString()} bank gold.`

                          : 'No matching live WTS listings.'}

                  </p>

                ) : (

                  marketRows(expandedALData)

                )

              ) : null}

              {marketOpen && marketTab === 'wtb' ? (

                <>

                  <div className="mb-3 rounded border border-emerald-900 bg-emerald-950/10 p-2 text-xs text-emerald-200">

                    {bankWTB.length} offer{bankWTB.length === 1 ? '' : 's'}{' '}

                    match exact items currently held by {merchant?.name || "the merchant"} or recorded

                    in the bank.

                  </div>

                  {filteredBuyOrders.length ? (

                    buyOrderRows(filteredBuyOrders)

                  ) : (

                    <p className="text-sm text-emerald-100/45">

                      No matching live WTB offers.

                    </p>

                  )}

                </>

              ) : null}

              {marketOpen && marketTab === 'classifieds' ? (

                filteredClassifieds.length ? (

                  filteredClassifieds.map(({ owner, listing }, index) => {

                    const item = catalogById.get(listing.name);

                    const requested = {

                      name: listing.name,

                      level: listing.level || 0,

                      ...(listing.p ? { p: listing.p } : {}),

                    };

                    const source = ownedSource(requested);

                    return (

                      <div

                        key={`${owner.owner}-${listing.name}-${index}`}

                        className="flex items-center gap-3 rounded border border-slate-800 bg-black/20 p-2"

                      >

                        {ignoreButton(requested)}

                        <button

                          type="button"

                          onClick={() =>

                            onInspect(

                              requested,

                              item?.meta,

                              'Published trade intention',

                            )

                          }

                          className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-cyan-300"

                        >

                          <div className="relative h-10 w-10 shrink-0">

                            {item?.sprite && (

                              <SpriteCrop sprite={item.sprite} />

                            )}

                          </div>

                          <div>

                            <p className="text-sm">

                              {item?.name || listing.name}

                              {listing.level ? ` +${listing.level}` : ''}

                            </p>

                            <p className="font-mono text-[10px] text-slate-400">

                              {owner.label ||

                                owner.characters?.[0] ||

                                owner.owner}{' '}

                              · {listing.note || 'Published intention'}

                            </p>

                          </div>

                        </button>

                        <span className="font-mono text-xs text-emerald-300">

                          {listing.wts?.price

                            ? `WTS ${listing.wts.price.toLocaleString()}g`

                            : ''}

                        </span>

                        <span className="font-mono text-xs text-violet-300">

                          {listing.wtb?.price

                            ? `WTB ${listing.wtb.price.toLocaleString()}g`

                            : ''}

                        </span>

                        {listing.wts?.price ? (

                          <Button

                            size="sm"

                            variant="outline"

                            onClick={() => makeClassifiedWTB(listing)}

                            className="border-violet-600 bg-black text-violet-100 hover:bg-violet-950 hover:text-white"

                          >

                            Add to WTB

                          </Button>

                        ) : null}

                        {listing.wtb?.price && source ? (

                          <Button

                            size="sm"

                            variant="outline"

                            disabled={standIsFull({ standSlots: stand })}

                            onClick={() =>

                              onListForWTB(

                                source.entry,

                                source.bankPack,

                                Number(listing.wtb?.price),

                                Number(listing.wtb?.quantity || 1),

                              )

                            }

                            className="border-amber-600 bg-black text-amber-100 hover:bg-amber-950 hover:text-white disabled:border-slate-700 disabled:bg-black disabled:text-slate-600"

                          >

                            Add to stand

                          </Button>

                        ) : null}

                      </div>

                    );

                  })

                ) : (

                  <p className="text-sm text-emerald-100/45">

                    No published trade intentions from other owners. These

                    classifieds are separate from live stand slots.

                  </p>

                )

              ) : null}

              {marketOpen && marketTab === 'ponty' ? (

                <>

                  {ponty?.error ? (
                    <div className="mb-3 rounded border border-fuchsia-900 bg-black p-2 text-sm text-fuchsia-100">
                      Last refresh failed: {ponty.error}
                    </div>
                  ) : null}

                  {pontyRows.length ? (

                    pontyRows

                  ) : (

                    <p className="text-sm text-emerald-100/45">

                      Ponty currently has no matching items.

                    </p>

                  )}

                </>

              ) : null}

            </div>

          </div>



        </DialogContent>

      </Dialog>

      <Dialog

        open={blacklistOpen}

        onOpenChange={(value) => {

          setBlacklistOpen(value);

          setConfirmBlacklistClear(false);

        }}

      >

        <DialogContent data-area="market-settings" className="flex max-h-[85vh] flex-col overflow-hidden border-slate-700 bg-[#07120f] text-emerald-50 sm:max-w-2xl">

          <DialogHeader>

            <DialogTitle>Marketplace settings</DialogTitle>

            <DialogDescription>

              Manage stand preferences, ignored items and merchant blacklist entries.

            </DialogDescription>

          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">

            <section className="space-y-3 rounded border border-violet-700 bg-black p-3">

              <h3 className="text-sm font-semibold text-violet-100">

                Stand buy orders

              </h3>

              <WTBPreference

                label="Automatically fill empty stand slots with highest priority buy order"

                description={autoStandExplanation}

                checked={autoStandBuys}

                disabled={settingsSaving}

                onChange={(value) =>

                  void saveMarketSetting(() => onAutoStandBuys(value))

                }

              />

            </section>

            <IgnoredMarketItems items={marketIgnoredItems} label={marketItemLabel} disabled={settingsSaving}
              onRemove={item=>void updateIgnored('remove',item)} onClear={()=>void updateIgnored('clear')}/>
            <MarketSettingsSection title="Marketplace merchant blacklist" count={blacklistRecords.length} disabled={settingsSaving}
              clearLabel={confirmBlacklistClear?'Really clear all?':'Clear all'} clearAriaLabel={confirmBlacklistClear?'Confirm clearing all merchant blacklist entries':'Clear all merchant blacklist entries'}
              onClear={()=>{if(confirmBlacklistClear){setConfirmBlacklistClear(false);void updateBlacklist({action:'clear'});}else setConfirmBlacklistClear(true);}}>

              <WTBPreference

                label="Enable blacklisting unavailable merchants"

                description="Adds a strike when the merchant reaches an advertised seller but the seller is not visible or their stand stays closed during the bounded wait. Retries pause for 1, 2, 4, 8... minutes after successive strikes. Changed or sold listings and unreachable routes do not cause strikes. Disabling this ignores automatic strikes and stops new ones; manual blocks still apply."

                checked={autoBlacklistMerchants}

                disabled={settingsSaving}

                onChange={(enabled) =>

                  void updateBlacklist({ action: 'configure', enabled })

                }

              />

              <div className="grid grid-cols-[1fr_8rem_auto] gap-2">

                <Input

                  value={blacklistName}

                  onChange={(event) => setBlacklistName(event.target.value)}

                  placeholder="Merchant name"

                  className="border-slate-700 bg-black"

                />

                <Input

                  inputMode="numeric"

                  value={blacklistMinutes}

                  onChange={(event) =>

                    setBlacklistMinutes(

                      event.target.value.replace(/[^0-9-]/g, ''),

                    )

                  }

                  placeholder="Minutes / -1"

                  className="border-slate-700 bg-black"

                />

                <Button

                  onClick={async () => {

                    const saved = await updateBlacklist({
                      action: 'add',
                      seller: blacklistName.trim(),
                      minutes: Number(blacklistMinutes),
                    });
                    if (saved) setBlacklistName('');

                  }}

                  className="bg-rose-700 text-white hover:bg-rose-600"

                >

                  Add

                </Button>

              </div>

              <div className="space-y-2">

                {blacklistRecords.length ? (

                  blacklistRecords.map(([key, entry]) => {

                    const coolingDown = entry.until === -1 || entry.until > now;

                    return (

                      <div

                        key={key}

                        className={`flex items-center gap-3 rounded border bg-black p-2 ${coolingDown ? 'border-rose-800' : 'border-amber-800'}`}

                      >

                        <div className="min-w-0 flex-1">

                          <p

                            className={

                              coolingDown

                                ? 'font-semibold text-rose-200'

                                : 'font-semibold text-amber-200'

                            }

                          >

                            {entry.seller}

                          </p>

                          <p className="font-mono text-[10px] text-slate-300">

                            {entry.serverRegion || 'all regions'}{' '}

                            {entry.serverIdentifier || 'all servers'} ·{' '}

                            {entry.reason || 'manual'} · {entry.failures || 0}{' '}

                            strikes ·{' '}

                            {entry.until === -1

                              ? 'blocked forever'

                              : coolingDown

                                ? `${Math.max(1, Math.ceil((entry.until - now) / 60000))}m until retry`

                                : 'eligible for retry'}

                          </p>

                        </div>

                        <Button

                          size="sm"

                          variant="outline"

                          onClick={() =>

                            void updateBlacklist({ action: 'clear', key })

                          }

                          className="border-emerald-700 bg-black text-emerald-200 hover:bg-emerald-950 hover:text-white"

                        >

                          Clear

                        </Button>

                      </div>

                    );

                  })

                ) : (

                  <p className="text-sm text-emerald-100/45">

                    No merchant strike records.

                  </p>

                )}

              </div>

            </MarketSettingsSection>

          </div>

          {settingsError && (

            <p role="alert" className="text-sm text-rose-200">

              {settingsError}

            </p>

          )}

          <AddonSlot name="dialog-section" part="market-settings" />
          <DialogFooter className="shrink-0 border-t border-slate-700 bg-[#07120f] pt-3">



            <Button

              variant="outline"

              onClick={() => {

                setConfirmBlacklistClear(false);

                setBlacklistOpen(false);

              }}

              className="border-slate-600 bg-black text-slate-200 hover:bg-slate-900 hover:text-white"

            >

              Close

            </Button>

          </DialogFooter>

        </DialogContent>

      </Dialog>

      <Dialog

        open={Boolean(purchaseConfirmation)}

        onOpenChange={(nextOpen) => {

          if (!nextOpen && !buying) { setPurchaseConfirmation(null); setConfirmationError(null); }
        }}

      >

        <DialogContent data-area="market-purchase" className="border-cyan-700 bg-[#07120f] text-emerald-50 sm:max-w-md">

          <DialogHeader>

            <DialogTitle>Confirm marketplace purchase</DialogTitle>

            <DialogDescription className="text-emerald-100/65">

              {purchaseConfirmation

                ? `Really buy ${purchaseConfirmation.quantity.toLocaleString()} ${catalogById.get(purchaseConfirmation.listing.item.name)?.name || purchaseConfirmation.listing.item.name} for ${(purchaseConfirmation.quantity * purchaseConfirmation.listing.price).toLocaleString()}g?`

                : ''}

            </DialogDescription>

          </DialogHeader>

          {confirmationError && (
            <p role="alert" className="rounded border border-rose-700 bg-[#260d16] p-3 text-sm text-rose-100">
              {confirmationError}
            </p>
          )}
          <div className="flex justify-end gap-2">

            <Button

              type="button"

              variant="outline"

              disabled={Boolean(buying)}

              onClick={() => setPurchaseConfirmation(null)}

              className="border-rose-600 bg-black text-rose-200 hover:bg-rose-950 hover:text-white"

            >

              Cancel

            </Button>

            <Button

              type="button"

              disabled={!purchaseConfirmation || Boolean(buying)}

              onClick={async () => {

                if (!purchaseConfirmation) return;

                const { listing, quantity } = purchaseConfirmation;

                setBuying(listing.key);
                setConfirmationError(null);
                try {

                  let remaining = quantity;

                  for (const physicalListing of listing.groupedListings || [

                    listing,

                  ]) {

                    if (remaining <= 0) break;

                    const available = Math.max(

                      1,

                      Number(physicalListing.quantity) || 1,

                    );

                    const purchasing = Math.min(remaining, available);

                    await onBuyALData(physicalListing, purchasing);

                    remaining -= purchasing;

                  }

                  if (remaining > 0)

                    throw new Error(

                      `Only ${quantity - remaining} of ${quantity} listings could be queued`,

                    );

                  setPurchaseConfirmation(null);
                } catch (failure) {
                  setConfirmationError(failure instanceof Error ? failure.message : 'Could not queue the purchase');
                } finally {

                  setBuying(null);

                }

              }}

              className="bg-cyan-500 text-cyan-950 hover:bg-cyan-400"

            >

              {buying ? 'Queuing…' : 'Yes'}

            </Button>

          </div>

        </DialogContent>

      </Dialog>

      <Dialog

        open={Boolean(saleConfirmation)}

        onOpenChange={(nextOpen) => {

          if (!nextOpen && !selling) { setSaleConfirmation(null); setConfirmationError(null); }
        }}

      >

        <DialogContent data-area="market-sale" className="border-violet-700 bg-[#07120f] text-emerald-50 sm:max-w-md">

          <DialogHeader>

            <DialogTitle>Confirm marketplace sale</DialogTitle>

            <DialogDescription className="text-emerald-100/65">

              {saleConfirmation

                ? `Really sell ${saleConfirmation.quantity.toLocaleString()} ${catalogById.get(saleConfirmation.order.item.name)?.name || saleConfirmation.order.item.name} to ${saleConfirmation.order.buyer} for ${(saleConfirmation.quantity * saleConfirmation.order.price).toLocaleString()}g?`

                : ''}

            </DialogDescription>

          </DialogHeader>

          {confirmationError && (
            <p role="alert" className="rounded border border-rose-700 bg-[#260d16] p-3 text-sm text-rose-100">
              {confirmationError}
            </p>
          )}
          <div className="flex justify-end gap-2">

            <Button

              type="button"

              variant="outline"

              disabled={Boolean(selling)}

              onClick={() => setSaleConfirmation(null)}

              className="border-rose-600 bg-black text-rose-200 hover:bg-rose-950 hover:text-white"

            >

              Cancel

            </Button>

            <Button

              type="button"

              disabled={!saleConfirmation || Boolean(selling)}

              onClick={async () => {

                if (!saleConfirmation) return;

                const { order, quantity } = saleConfirmation;

                setSelling(order.key);
                setConfirmationError(null);
                try {
                  await onSellALData(order, quantity);
                  setSaleConfirmation(null);
                } catch (failure) {
                  setConfirmationError(failure instanceof Error ? failure.message : 'Could not queue the sale');
                } finally {

                  setSelling(null);

                }

              }}

              className="bg-violet-500 text-black hover:bg-violet-400"

            >

              {selling ? 'Queuing…' : 'Yes'}

            </Button>

          </div>

        </DialogContent>

      </Dialog>

      <Dialog

        open={Boolean(pontyPurchaseConfirmation)}

        onOpenChange={(nextOpen) => {

          if (!nextOpen && !pontyBuying) setPontyPurchaseConfirmation(null);

        }}

      >

        <DialogContent data-area="ponty-purchase" className="border-fuchsia-700 bg-[#07120f] text-emerald-50 sm:max-w-md">

          <DialogHeader>

            <DialogTitle>Confirm Ponty purchase</DialogTitle>

            <DialogDescription className="text-emerald-100/65">

              {pontyPurchaseConfirmation

                ? `Buy ${pontyPurchaseConfirmation.quantity.toLocaleString()} ${catalogById.get(pontyPurchaseConfirmation.item.name)?.name || pontyPurchaseConfirmation.item.name} for up to ${pontyPurchaseConfirmation.price.toLocaleString()}g? ${pontyPurchaseConfirmation.realmLabel || ''}. One purchase job will be queued per realm. ${merchant?.name || "The merchant"} will travel as needed and verify each listing. Any matching WTB quantity will be decremented.`

                : ''}

            </DialogDescription>

          </DialogHeader>

          {pontyPurchaseError && (

            <p

              role="alert"

              className="rounded border border-rose-700 bg-[#260d16] p-3 text-sm text-rose-100"

            >

              {pontyPurchaseError}

            </p>

          )}

          <div className="flex justify-end gap-2">

            <Button

              type="button"

              variant="outline"

              disabled={Boolean(pontyBuying)}

              onClick={() => setPontyPurchaseConfirmation(null)}

              className="border-rose-600 bg-black text-rose-200 hover:bg-rose-950 hover:text-white"

            >

              Cancel

            </Button>

            <Button

              type="button"

              disabled={!pontyPurchaseConfirmation || Boolean(pontyBuying)}

              onClick={async () => {

                if (!pontyPurchaseConfirmation) return;

                const listing = pontyPurchaseConfirmation;

                setPontyPurchaseError(null);

                setPontyBuying(listing.key);

                try {

                  await onBuyPonty(listing);

                  setPontyPurchaseConfirmation(null);

                } catch (error) {

                  setPontyPurchaseError(

                    error instanceof Error

                      ? error.message

                      : 'Could not queue Ponty purchase',

                  );

                } finally {

                  setPontyBuying(null);

                }

              }}

              className="border border-fuchsia-300 bg-fuchsia-500 text-black hover:bg-fuchsia-400 hover:text-black"

            >

              {pontyBuying ? 'Queuing…' : 'Yes'}

            </Button>

          </div>

        </DialogContent>

      </Dialog>

      <Dialog open={bidsOpen} onOpenChange={setBidsOpen}>

        <DialogContent data-area="wtb-orders" className="flex max-h-[85vh] w-[calc(100vw-2rem)] flex-col border-violet-800 bg-[#0b1916] text-emerald-50 sm:max-w-md">

          <DialogHeader>

            <DialogTitle>WTB orders</DialogTitle>

            {bidFailure}

          </DialogHeader>

          <Input

            value={bidFilter}

            onChange={(event) => setBidFilter(event.target.value)}

            placeholder="Search every item…"

            className="border-violet-800 bg-black/30"

          />

          <div className="min-h-0 flex-1 overflow-auto">

            <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-violet-900 bg-[#0b1916] px-3 py-2 font-mono text-[10px] uppercase text-violet-300">
              <span>Item</span><span>Action</span>
            </div>
            {filteredCatalog.map((item) => (
              <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-emerald-950 px-3 py-2">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative h-9 w-9 shrink-0">
                    {item.sprite && <SpriteCrop sprite={item.sprite} />}
                  </div>
                  <span className="min-w-0 truncate text-sm" title={item.name}>{item.name}</span>
                </div>
                <Button size="sm" onClick={() => {
                  setBidsOpen(false);
                  // A WTB made from a listing opens with the listing's price, still editable.
                  onEditBuy({name: item.id, level: Number(draftFor(item.id).minimumQuality) || 0}, item.meta, Number(draftFor(item.id).price) || undefined);
                }} className="border border-violet-500 bg-violet-700 text-white hover:bg-violet-600 hover:text-white">
                  Add
                </Button>
              </div>
            ))}
          </div>

          <AddonSlot name="dialog-section" part="wtb-orders" />
          <DialogFooter className="shrink-0 border-t border-violet-800 bg-[#0b1916] pt-3">

            <Button

              variant="outline"

              className="border-slate-600 bg-black text-slate-100 hover:bg-slate-800 hover:text-white"

              onClick={() => setBidsOpen(false)}

            >

              Cancel

            </Button>

          </DialogFooter>

        </DialogContent>

      </Dialog>

    </>

  );

});

const QUANTITY_TONES = {
  buy: { input: 'border-cyan-900', all: 'border-cyan-600 bg-black text-cyan-100 hover:bg-cyan-950 hover:text-white', action: 'bg-cyan-500 text-cyan-950 hover:bg-cyan-400' },
  sell: { input: 'border-violet-900', all: 'border-violet-600 bg-black text-violet-100 hover:bg-violet-950 hover:text-white', action: 'bg-violet-500 text-black hover:bg-violet-400' },
};
// The market buy row's and the WTB sell row's quantity box, All button and action button. The action
// takes a whole quantity from 1 to `maximum`; any other draft does nothing.
function QuantityAction({ label, value, maximum, tone, busy, allDisabled = false, actionLabel, onChange, onAction }: {
  label: string; value: string | undefined; maximum: number; tone: keyof typeof QUANTITY_TONES; busy: boolean;
  allDisabled?: boolean; actionLabel: string; onChange: (value: string) => void; onAction: (quantity: number) => void;
}) {
  const colors = QUANTITY_TONES[tone];
  return <>
    <Input aria-label={label} inputMode="numeric" value={value || '1'}
      onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ''))}
      className={`h-8 w-16 ${colors.input} bg-black/30 px-2 font-mono text-xs`} />
    <Button size="sm" variant="outline" disabled={allDisabled} onClick={() => onChange(String(maximum))} className={colors.all}>All</Button>
    <Button size="sm" disabled={busy} className={colors.action} onClick={() => {
      const quantity = Number(value || 1);
      if (Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= maximum) onAction(quantity);
    }}>{actionLabel}</Button>
  </>;
}
