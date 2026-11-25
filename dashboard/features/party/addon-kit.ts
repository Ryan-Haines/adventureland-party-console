// The add-on kit: the one module an add-on's dashboard.tsx imports from the dashboard. It
// re-exports the shared components a section may use, React's exports and the dashboard types a
// section needs, so every `react` import a section reaches is written in a dashboard file and
// resolves to the dashboard's one React. A section imports the kit by its relative path; its JSX
// compiles against addon-jsx/ by the `@jsxImportSource` pragma at its top.
import type { ComponentType, ReactNode } from 'react';
import type { MonsterChoice } from './monster-choice';
import type { PartyState } from './party-state';
import type { Read, SlotColor } from '../../../runtime/hooks/registry';
import type { Item } from './item';
import type { MonsterHuntState } from './monster-hunt-state';

// React's hooks, components and types, from the dashboard's own install. React's types use
// `export =`, so the kit names each export.
export { Children, Fragment, StrictMode, Suspense, createContext, forwardRef, lazy, memo, startTransition, use, useActionState,
  useCallback, useContext, useDebugValue, useDeferredValue, useEffect, useId, useImperativeHandle, useInsertionEffect, useLayoutEffect,
  useMemo, useOptimistic, useReducer, useRef, useState, useSyncExternalStore, useTransition } from 'react';
export type { ChangeEvent, ComponentProps, ComponentType, CSSProperties, Dispatch, FormEvent, KeyboardEvent, MouseEvent, PropsWithChildren,
  ReactElement, ReactNode, RefObject, SetStateAction } from 'react';
// The shared components a section may draw with.
export { Button } from '@/components/ui/button';
export { Checkbox } from '@/components/ui/checkbox';
export { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
export { Input } from '@/components/ui/input';
// An add-on settings section writes through `save`, so its select is the settings control's (Path A).
export { SettingSelect as Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
export { CenteredMonsterSprite } from './centered-monster-sprite';
// The error boundary the slots put around each piece (runtime/hooks/dashboard/slots.tsx).
export { AddonPieceBoundary } from './addon-piece-boundary';
// A blacklist rule's switch and count, the hunt settings' row.
export { BlacklistThresholdRow } from './blacklist-threshold-row';
// ItemSprite is the kit's name for SpriteCrop, the one sprite crop (HOOKS.md's kit list).
export { SpriteCrop as ItemSprite } from './sprite-crop';
// The action client, which the add-on system's own pages (runtime/hooks/dashboard/) read and write
// through, so a lost session ends the page's session as every dashboard write does.
export { performAction } from './query-actions';
export { QueryClientContext, useQueryClient, type QueryClient } from '@tanstack/react-query';
// The dashboard data a section reads.
export type { MonsterChoice } from './monster-choice';
export type { PartyState } from './party-state';

// What the slot code hands an add-on's settings section for one farming scope (4.3).
export interface AddonSectionProps {
  // The scope's add-on store (`addonFarming[<name>]`).
  store: Readonly<Record<string, unknown>>;
  // The add-on's declared settings' values (GET /party-api/addons).
  settings: Readonly<Record<string, unknown>>;
  // Writes the add-on's store for this scope: POST /party-api/addon-farming for a target mode
  // add-on, POST /party-api/addon-command (`addon.command`) for any other; absent while the scope
  // follows its leader.
  save?(body: Record<string, unknown>): Promise<void>;
  // The scope follows its leader: read only.
  inherited: boolean;
  // The dashboard reads (AddonPieceBase `read`). `read.passiveRule(monster)` stays for one release
  // as the alias of `read('passive.rule', monster)`.
  read: AddonSectionRead;
  // The party's store, `send`, `reload` and `open`, as every piece gets them (AddonPieceBase). The
  // scope store is `store` above.
  stores: AddonPieceBase['stores']; send: AddonPieceBase['send']; reload(): void; open: AddonPieceBase['open'];
  // The shared monster data.
  monsters: {
    kills: Readonly<Record<string, number>>;
    achievements: Readonly<Record<string, { score: number; owner: string | null }>>;
    bestiary: PartyState['bestiaryCatalog']; choices: PartyState['monsterChoices']; catalog: MonsterChoice[];
    inspect?(id: string): void; renderDetails?(id: string, onClose: () => void): ReactNode;
  };
}
export type AddonSectionRead = Read & { passiveRule(monster: string): import('../../../runtime/hunting/api').PassiveRuleView | undefined };
// What the diagnostics view hands an add-on's records component for one character's post of its
// own ring (the `diagnostics-ring` slot).
export interface AddonRingProps { ring: string; label: string; records: unknown }
// The dashboard places an add-on's piece joins, each with its parts (runtime/hooks/rows SLOTS; the
// places in the slot table). `<AddonSlot name part>`
// (runtime/hooks/dashboard/slots.tsx) draws a place's pieces after its core content.
export const ADDON_PLACES = {
  // The top bar: `views` after Logs, `actions` after Bank, `status` after the hand count.
  'top-bar': ['views', 'actions', 'status'],
  // A character card: `identity` after the XP meter and badges, `controls` after Events, `vitals`
  // after CC, `farming-line` after the mode rows, `combat` after the gold, `merchant` after the
  // merchant's button grid, `focus` after the monster focus, `equipped` after Equipped, `inventory`
  // after the merchant visit, Home and Radio buttons, `foot` after the combat log.
  'card-section': ['identity', 'controls', 'vitals', 'farming-line', 'combat', 'merchant', 'focus', 'equipped', 'inventory', 'foot'],
  // A dialog's end, after its core content and above its footer. No confirmation step is listed:
  // a piece there would change what the player confirms.
  'dialog-section': ['interface-settings', 'bank', 'stand', 'market-settings', 'wtb-orders', 'mail', 'catalog', 'bestiary', 'monster', 'skills',
    'item', 'gear-comparison', 'character-stats', 'condition', 'commerce', 'wtb-order', 'travel', 'farming-area', 'event-settings', 'cave-settings',
    'anniversary', 'giveaway', 'stand-item', 'lucky-slots', 'offline-character'],
  // A list's filter row: a control after the core filters, which narrows or sorts only that list's rows.
  'list-view': ['market:wts', 'market:wtb', 'market:classifieds', 'market:ponty'],
  // The page: `banner` under the top bar, `party-actions` after Send party to town, `cave` after the
  // Cave panel's progress, `metrics` at the end of the metrics view, `logs` after the log entries.
  'page-section': ['banner', 'party-actions', 'cave', 'metrics', 'logs'],
  // A map's markers above its core layers: the card map, the native-size map and the cave map.
  'map-layer': ['card', 'native', 'cave'],
  // The owners' slots: the hunting owner's `hunt-status` under the Hunt status block and `rare-list` after the
  // passive hunting menu's monster rows, the merchant jobs owner's `merchant-routines` after the routine priorities,
  // and the items owner's `item-rules` in the inventory and bank item menus and the item's details.
  'hunt-status': ['hunt'],
  'rare-list': ['passive-hunting'],
  'merchant-routines': ['routines'],
  'item-rules': ['inventory-menu', 'bank-menu', 'item-details'],
} as const;
export type AddonPlace = keyof typeof ADDON_PLACES;
export type AddonPart<S extends AddonPlace> = (typeof ADDON_PLACES)[S][number];
// What each place hands its pieces beside `part` and the add-on's own settings.
export interface AddonPlaceData {
  'top-bar': { state: PartyState };
  // `reports` is the character's `addonReports`; each piece gets its own add-on's as `report`.
  'card-section': { character: string; reports?: Readonly<Record<string, unknown>> };
  // `subject` is what the dialog shows when it shows one thing: a character, an item, a monster,
  // a status effect or an event.
  'dialog-section': { subject?: unknown };
  // The list's rows before any add-on narrows them, the list's add-on state (slots.tsx
  // useAddonListView), and whether the tab draws its own search box.
  'list-view': { rows: readonly AddonListRow[]; view: AddonListView<AddonListRow>; search: boolean };
  // The metrics view reads no party state, so its part hands none.
  'page-section': { state?: PartyState };
  // The shown map and, on a character's maps, the character. The slot hands `children` the core
  // pins with every enabled add-on's markers after them, and draws what it returns.
  'map-layer': { map: string; character?: string; pins: readonly MapPin[]; children(pins: MapPin[]): ReactNode };
  // The hunting owner's hunt view the Hunt status block reads.
  'hunt-status': { hunt?: MonsterHuntState | null };
  // A rare-list piece draws table rows (`tr`) of the menu's six columns; the menu's search narrows them too.
  'rare-list': { search: string; disabled: boolean };
  // The dialog's draft priorities and switches, by routine key, and the add-on job kinds the merchant
  // runs, each with its routine key, add-on, label and priority.
  'merchant-routines': { priorities: Readonly<Record<string, number>>; enabled: Readonly<Record<string, boolean>>;
    kinds: readonly import('../../../runtime/merchant-jobs/api.ts').AddonKindRow[] };
  // The item, and the character or bank pack that holds it.
  // `fate` is the add-on claim or action that holds the copy, from the party state's addonItemFates.
  'item-rules': { item: Item; character?: string; fate?: import('../../../runtime/items/api.ts').Fate };
}
// One pin of a map canvas, in map coordinates (map-canvas.tsx `pins`).
export interface MapPin { x: number; y: number; label: string; color: string }
// One marker an add-on puts on a map, in map coordinates, coloured from SLOT_COLORS.
export interface AddonMapMarker { x: number; y: number; label: string; color: SlotColor }
// The fields every list row has. A Market row's realm is "<region> <identifier>". `grade` is the
// game's item grade, 0 to 4 (items/api.ts itemGrade), which the item name's colour shows.
export interface AddonListRow { item: string; level?: number; grade?: number; price?: number; seen?: number; realm?: string }
// Each list's own row, built once per tab by stand-sheet.tsx with every field the tab draws.
// A Live WTS listing.
export interface MarketRow extends AddonListRow { key: string; quantity: number; seller: string; map: string }
// A Live WTB order.
export interface MarketBuyRow extends AddonListRow { key: string; quantity: number; buyer: string; map: string }
// A Classifieds listing with its owner and its sell and buy offers. `seen` is the feed's update time.
export interface ClassifiedsRow extends AddonListRow { owner: string; label?: string; characters: readonly string[]; note?: string;
  wts?: { price?: number; quantity?: number; negotiable: boolean }; wtb?: { price?: number; quantity?: number; negotiable: boolean } }
// A Ponty listing. `price` is the unit price and `total` the lot's price.
export interface PontyRow extends AddonListRow { key: string; quantity: number; total: number }
export interface AddonListRows { 'market:wts': MarketRow; 'market:wtb': MarketBuyRow; 'market:classifieds': ClassifiedsRow; 'market:ponty': PontyRow }
// A list's add-on state: whether an installed add-on views the list, each add-on's control value
// (unset until the player sets it), and whether a row passes every set value. `sort` hands the
// items back in the order of the add-on whose control the player set last, or as they came when
// no set control has an order.
export interface AddonListView<R extends AddonListRow> { declared: boolean; values: Readonly<Record<string, unknown>>; set(addon: string, value: unknown): void;
  keep(row: R): boolean; sort<T>(items: T[], row: (item: T) => R): T[] }
// What each piece gets beside its part and its add-on's settings: the place's data, except that a
// card piece gets its own add-on's report and a list filter control its own value and setter.
interface AddonPieceData {
  'top-bar': AddonPlaceData['top-bar'];
  // `members` names the party's characters (slots.tsx `AddonCard`). `send` with no character
  // posts for the card's character.
  'card-section': { character: string; report?: unknown; members: readonly string[] };
  'dialog-section': AddonPlaceData['dialog-section'];
  // `set(undefined)` clears the control, and the list shows every row again.
  'list-view': { rows: readonly AddonListRow[]; value: unknown; set(value: unknown): void; search: boolean };
  'page-section': AddonPlaceData['page-section'];
  'map-layer': { map: string; character?: string };
  'hunt-status': AddonPlaceData['hunt-status'];
  'rare-list': AddonPlaceData['rare-list'];
  'merchant-routines': AddonPlaceData['merchant-routines'];
  'item-rules': AddonPlaceData['item-rules'];
}
// What every piece and section receives beside its place's data: its
// add-on's settings and stores, `save` for a store, `send` for the add-on's own command
// (`addon.command`), `reload` for the add-on list (slots.tsx reloadAddons), the dashboard reads and
// `open` for one of the add-on's own dialogs. A card piece has the character store and a scope
// piece the scope store; every piece has the party store.
export interface AddonPieceBase {
  settings: Readonly<Record<string, unknown>>;
  stores: { character?: Readonly<Record<string, unknown>>; scope?: Readonly<Record<string, unknown>>; party: Readonly<Record<string, unknown>> };
  save(store: 'character' | 'scope' | 'party', patch: Record<string, unknown>): Promise<void>;
  send(body: unknown, character?: string): Promise<unknown>;
  reload(): void;
  read: Read;
  open(dialog: string, subject?: unknown): void;
}
export type AddonPieceProps<S extends AddonPlace> = AddonPieceData[S] & AddonPieceBase & { part: AddonPart<S> };
// A list view control's props, with the list's own rows.
export type AddonListControlProps<P extends AddonPart<'list-view'>> = Omit<AddonPieceProps<'list-view'>, 'rows' | 'part'> & { part: P; rows: readonly AddonListRows[P][] };
// A list view piece: its control, whether a row passes the control's value, and the order it sorts
// rows in. The list calls `keep` and `order` only while the control holds a value. Rows that
// `order` ties keep the list's own order.
export interface AddonListViewPiece<P extends AddonPart<'list-view'>> { control: ComponentType<AddonListControlProps<P>>;
  keep?(row: AddonListRows[P], value: unknown): boolean; order?(a: AddonListRows[P], b: AddonListRows[P], value: unknown): number }
// An add-on's own dialog, which any of its pieces opens with `open(id, subject)`. slots.tsx
// `AddonDialogs` mounts it with the page's other dialogs, inside an AddonPieceBoundary, and the
// dialog draws its own kit Dialog.
export type AddonDialogProps = AddonPieceBase & { subject?: unknown; close(): void };
// An add-on's pieces by place and part. A piece only adds: the slot draws it after the place's core
// content, and it reaches the core only through the data it is handed.
// A map layer is a function of the view, which the map calls as it renders.
export type AddonPieces = { [S in Exclude<AddonPlace, 'list-view' | 'map-layer'>]?: Partial<Record<AddonPart<S>, ComponentType<AddonPieceProps<S>>>> }
  & { 'list-view'?: { [P in AddonPart<'list-view'>]?: AddonListViewPiece<P> } }
  & { 'map-layer'?: Partial<Record<AddonPart<'map-layer'>, (view: AddonPieceProps<'map-layer'>) => readonly AddonMapMarker[]>> };
// What an add-on's dashboard.tsx exports as `dashboard`: its settings section, the component that
// draws its own rings' records when it declares rings, its pieces and its own dialogs by id.
export interface AddonDashboard { section?: ComponentType<AddonSectionProps>; ring?: ComponentType<AddonRingProps>; pieces?: AddonPieces;
  dialogs?: Record<string, ComponentType<AddonDialogProps>> }
// Reloads the add-on list for every reader, for a section that changes its own switches. Every
// piece's `reload()` does the same.
export { reloadAddons } from '../../../runtime/hooks/dashboard/slots';
