/** @jsxImportSource ../../../dashboard/features/party/addon-jsx */
"use client";
// The dashboard's slots: the two mode rows' entries with their declared buttons and status lines,
// and each enabled add-on's settings section. The data comes from GET /party-api/addons and the
// sections from the generated `dashboards` module (build/installed.mts), so this file names no
// add-on. One list per page: every card reads the same request. It reaches React and the dashboard
// only through the kit.
import { AddonPieceBoundary, QueryClientContext, createContext, performAction, useContext, useEffect, useQueryClient, useState, type AddonDialogProps, type AddonListRow,
  type AddonListRows, type AddonListView, type AddonListViewPiece, type AddonPart, type AddonPieceBase, type AddonPlace, type AddonPlaceData, type AddonRingProps,
  type AddonSectionRead, type ComponentType, type QueryClient, type AddonSectionProps, type PartyState, type ReactNode } from "../../../dashboard/features/party/addon-kit";
import type { Read, SlotColor, SlotEntry, SlotName } from "../registry";
import type { ADDON_KINDS, RecordField } from "../../settings/api";
import { dashboards } from "../../../.build/addons/dashboard";

export type { SlotEntry };
// `reads`: the coordinator registry's answers an add-on's dashboard reads (AddonSectionProps `read`).
type Reads = { "passive.rule"?: Record<string, import("../../hunting/api").PassiveRuleView | undefined> };
// An enabled add-on's own ring, a tab of the diagnostics view (12 D4's `diagnostics-ring` slot).
export interface AddonRingEntry { ring: string; addon: string; label: string }
// One installed add-on as the manager draws it, with each declared setting's saved value (http.ts `list`).
// A `records` setting lists its fields; a `character` field takes `characters` as its choices.
export interface AddonSettingListing { label: string; kind: (typeof ADDON_KINDS)[number]; default: unknown; value: unknown;
  choices?: string[]; characters?: string[]; min?: number; max?: number; fields?: Record<string, RecordField> }
export interface AddonListing { name: string; author: string; summary: string; enabled: boolean; settings: Record<string, AddonSettingListing> }
// The route's reply, `loaded` once a read answered, and `error` when the read failed. A failed read is not cached, so the next
// mount or `reloadAddons` asks again.
// `read` is the sections' one reader, built once per reply, so a section that keys a memo on it
// rebuilds only when the reply changes. `stores` holds each add-on's stores by store key:
// `party`, `scope:<owner>` and `character:<name>`.
interface AddonsReply { slots: Record<SlotName, SlotEntry[]>; rings: AddonRingEntry[]; settings: Record<string, Record<string, unknown>>; reads: Reads;
  read: AddonSectionRead; addons: AddonListing[]; refusals: { name: string; message: string }[]; overlays: Record<string, string>;
  stores: Record<string, Record<string, Record<string, unknown>>>; loaded: boolean; error: string }
const empty: AddonsReply = { slots: { "combat-mode": [], "target-mode": [], "combat-routine": [], formation: [], "merchant-routine": [] }, rings: [], settings: {}, reads: {},
  read: readerOf({}), addons: [], refusals: [], overlays: {}, stores: {}, loaded: false, error: "" };
let reply: Promise<AddonsReply> | null = null, current: AddonsReply = empty, page: QueryClient | null = null;
const readers = new Set<(value: AddonsReply) => void>();
function load(client: QueryClient): Promise<AddonsReply> {
  page = client;
  return reply ??= performAction<Omit<AddonsReply, "settings" | "read" | "loaded" | "error">>(client, "/addons", undefined, { method: "GET" })
    .then(value => current = ({ ...value, stores: value.stores ?? {}, loaded: true, error: "", read: readerOf(value.reads ?? {}),
      settings: Object.fromEntries(value.addons.map(a => [a.name, Object.fromEntries(Object.entries(a.settings).map(([key, s]) => [key, s.value]))])) }))
    .catch((error: Error) => { reply = null; return { ...empty, loaded: true, error: "Add-ons are unavailable: " + error.message }; });
}
// A change of an add-on's switch, settings or stores reloads the list for every reader (settings-page.tsx).
export function reloadAddons(client: QueryClient): void { reply = null; void load(client).then(value => { for (const read of readers) read(value); }); }
export function useAddonSlots(): AddonsReply { return useReply(useQueryClient()); }
// A page with no query client reads no add-on list, so the reply stays empty.
function useReply(client: QueryClient | undefined): AddonsReply {
  const [value, setValue] = useState<AddonsReply>(empty);
  useEffect(() => {
    if (!client) return;
    let live = true;
    const read = (next: AddonsReply) => { if (live) setValue(next); };
    readers.add(read);
    void load(client).then(read);
    return () => { live = false; readers.delete(read); };
  }, [client]);
  return value;
}

// The dashboard reads: GET /party-api/addon-read answers a coordinator
// read row an add-on may ask. A read hands back the cached answer, or undefined while it is asked;
// the answer redraws every add-on reader. The query client caches each answer per status revision,
// the core read's update time, so a failed read is asked again only on the next revision.
function dashboardRead(name: string, args: readonly unknown[]): unknown {
  const client = page;
  if (!client) return undefined;
  const queryKey = ["party", "addon-read", name, JSON.stringify(args), client.getQueryState(["party", "core"])?.dataUpdatedAt ?? 0];
  const state = client.getQueryState(queryKey);
  if (state?.status === "success") return state.data;
  if (!state) void client.fetchQuery({ queryKey, staleTime: Infinity,
    queryFn: () => performAction<{ value?: unknown }>(client, `/addon-read?name=${encodeURIComponent(name)}&args=${encodeURIComponent(JSON.stringify(args))}`, undefined, { method: "GET" })
      .then(answer => answer.value ?? null) })
    .then(() => { current = { ...current }; for (const read of readers) read(current); }, () => {});
  return undefined;
}
// `passive.rule` answers from the list's precomputed `reads` while the reply carries them.
function readerOf(reads: Reads): AddonSectionRead {
  const read = ((name: string, ...args: unknown[]) => name === "passive.rule" && reads["passive.rule"]
    ? reads["passive.rule"][args[0] as string] : dashboardRead(name, args)) as Read;
  return Object.assign(read, { passiveRule: (monster: string) => read("passive.rule", monster) });
}

// The add-on dialogs open on the page, one per add-on and dialog id; reopening one replaces its subject.
interface OpenDialog { addon: string; dialog: string; subject?: unknown }
let opened: readonly OpenDialog[] = [];
const dialogReaders = new Set<(dialogs: readonly OpenDialog[]) => void>();
function setOpened(next: readonly OpenDialog[]) { opened = next; for (const read of dialogReaders) read(next); }
const closeDialog = (addon: string, dialog: string) => setOpened(opened.filter(d => d.addon !== addon || d.dialog !== dialog));
// Only the add-on's own pieces reach `open`, since each piece's base is bound to its add-on. An id
// the add-on's dashboard does not declare opens nothing.
function openDialog(addon: string, dialog: string, subject?: unknown) {
  if (!dashboards[addon]?.dialogs?.[dialog]) return;
  setOpened([...opened.filter(d => d.addon !== addon || d.dialog !== dialog), { addon, dialog, ...subject === undefined ? {} : { subject } }]);
}

// What every piece, section and dialog of one add-on gets (addon-kit.ts AddonPieceBase). The base
// holds a character store where the place names a character, and a scope store where the place
// knows the farming scope. `save` writes only those and the party store, through POST
// /party-api/addon-command's `store` verb, then reloads the list. `send` posts the add-on's own
// command and resolves on the coordinator's answer.
function pieceBase(slots: AddonsReply, addon: string, where: { character?: string; scope?: string }): AddonPieceBase {
  const own = slots.stores?.[addon] ?? {}, keys = { party: "party", character: where.character && "character:" + where.character, scope: where.scope && "scope:" + where.scope };
  const client = () => { if (!page) throw new Error("The add-on list has not loaded"); return page; };
  return {
    settings: slots.settings[addon] ?? {},
    stores: { party: own.party ?? {}, ...keys.character ? { character: own[keys.character] ?? {} } : {}, ...keys.scope ? { scope: own[keys.scope] ?? {} } : {} },
    async save(store, patch) {
      const key = keys[store];
      if (!key) throw new Error(`${addonTitle(addon)} has no ${store} store in this place`);
      await performAction(client(), "/addon-command", { name: addon, verb: "store", key, patch });
      reloadAddons(client());
    },
    send: (body, character = where.character) => performAction(client(), "/addon-command", { name: addon, ...character ? { character } : {}, body }),
    reload: () => reloadAddons(client()),
    read: slots.read,
    open: (dialog, subject) => openDialog(addon, dialog, subject),
  };
}

// An add-on's name as the player reads it: the folder name, title-cased (my-tank-addon reads My Tank Addon).
export const addonTitle = (name: string) => name.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
// The line beside a setting an enabled add-on overlays (settings.overlay): the control keeps the
// player's own value, and the line names the add-on whose value plays. With no overlay it draws nothing.
export function OverlaidBy({ fields }: { fields: readonly string[] }): ReactNode {
  // A control drawn outside the dashboard's query client, as a unit render is, shows no line.
  const { overlays } = useReply(useContext(QueryClientContext));
  const by = [...new Set(fields.flatMap(field => overlays?.[field] ? [overlays[field]] : []))];
  return by.length ? <>{by.map(addon => <p key={addon} className="text-xs text-amber-200">Overlaid by {addonTitle(addon)} while it is on</p>)}</> : null;
}

// One character's post of an add-on's ring, drawn by the add-on's own records component; null when
// the add-on's dashboard draws no rings, and the view shows the records as they came.
export function addonRing(entry: AddonRingEntry, records: AddonRingProps["records"]): ReactNode {
  const Ring = dashboards[entry.addon]?.ring;
  return Ring ? <Ring ring={entry.ring} label={entry.label} records={records} /> : null;
}

// The add-on sections and status lines for one farming scope (4.3, 4.4). Every enabled add-on whose
// dashboard declares a section gets it, in name order. A section's `save` reaches a target mode
// add-on's `target.settings` through POST /party-api/addon-farming, and any other add-on's
// `addon.command` through POST /party-api/addon-command; a section gets none while the scope
// follows its leader. Each target mode entry with a declared status gets its status line.
export function addonSections(slots: AddonsReply, props: { state: PartyState; owner: string; inherited: boolean;
  save(addon: string, body: Record<string, unknown>): Promise<void>; command(addon: string, body: unknown): Promise<void>;
  monsters: AddonSectionProps["monsters"] }):
  { sections: ReactNode; status: Record<string, { title: string; message: string; color: SlotEntry["button"]["color"] }> } {
  const stores = ((props.state.farmingProfiles?.[props.owner] as { addonFarming?: Record<string, Record<string, unknown>> } | undefined)?.addonFarming) ?? {};
  const sections: ReactNode[] = [], status: Record<string, { title: string; message: string; color: SlotEntry["button"]["color"] }> = {};
  const targeted = new Set(slots.slots["target-mode"].map(entry => entry.addon));
  for (const { name } of slots.addons.filter(addon => addon.enabled).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const Section = dashboards[name]?.section;
    if (!Section) continue;
    const { stores: own, send, reload, open } = pieceBase(slots, name, { scope: props.owner });
    sections.push(<Section key={name} store={stores[name] ?? {}} settings={slots.settings[name] ?? {}} inherited={props.inherited}
      save={props.inherited ? undefined : targeted.has(name) ? body => props.save(name, body) : body => props.command(name, body)} monsters={props.monsters}
      read={slots.read} stores={own} send={send} reload={reload} open={open} />);
  }
  for (const entry of slots.slots["target-mode"]) {
    if (!entry.status) continue;
    const message = (stores[entry.addon] ?? {})[entry.status.field];
    status[entry.mode] = { title: entry.status.title, message: typeof message === "string" && message ? message : entry.status.idle, color: entry.button.color };
  }
  return { sections: sections.length ? <>{sections}</> : null, status };
}

// One place's pieces of every installed add-on, by part. Each place's piece type lives in
// addon-kit.ts AddonPieces; the slot hands each piece the data its place declares there.
type PlacePieces = Readonly<Record<string, ComponentType<Record<string, unknown>> | undefined>>;
const piecesOf = (addon: string, name: AddonPlace) => dashboards[addon]?.pieces?.[name] as PlacePieces | undefined;
const viewOf = (addon: string, list: AddonPart<'list-view'>) => dashboards[addon]?.pieces?.['list-view']?.[list] as AddonListViewPiece<typeof list> | undefined;
// The installed add-ons that declare a piece for one place and part, in name order.
const declaring = (name: AddonPlace, part: string) => Object.keys(dashboards).filter(addon => piecesOf(addon, name)?.[part]).sort();
type SlotProps<S extends AddonPlace> = { name: S; part: AddonPart<S> } & AddonPlaceData[S];
// The one way a dashboard place draws add-on pieces: each enabled add-on's piece for this place
// and part, after the core content the place puts before it. A place no installed add-on declares
// draws nothing and asks for no add-on list.
export function AddonSlot<S extends AddonPlace>(props: SlotProps<S>): ReactNode {
  if (props.name === 'map-layer') {
    const map = props as SlotProps<'map-layer'>;
    return declaring('map-layer', map.part).length ? <MapLayer slot={map} /> : map.children([...map.pins]);
  }
  return declaring(props.name, props.part).length ? <AddonPieces slot={props} /> : null;
}
// The canvas colour of each slot colour, Tailwind's 400 shade of the colour's name.
const PIN_COLORS: Record<SlotColor, string> = { slate: '#94a3b8', cyan: '#22d3ee', emerald: '#34d399', violet: '#a78bfa', amber: '#fbbf24', rose: '#fb7185', sky: '#38bdf8' };
// A map's pins: the core ones first, then each enabled add-on's markers, so the canvas draws them above.
function MapLayer({ slot: { part, map, character, pins, children } }: { slot: SlotProps<'map-layer'> }): ReactNode {
  const slots = useAddonSlots(), enabled = new Set(slots.addons.filter(addon => addon.enabled).map(addon => addon.name));
  const markers = declaring('map-layer', part).filter(addon => enabled.has(addon)).flatMap(addon =>
    dashboards[addon]!.pieces!['map-layer']![part]!({ part, map, character, ...pieceBase(slots, addon, { character }) })
      .map(marker => ({ x: marker.x, y: marker.y, label: marker.label, color: PIN_COLORS[marker.color] })));
  return children([...pins, ...markers]);
}
// What a character card hands its `card-section` pieces beside the place's data: the party's
// character names and the farming scope the character plays in, for the scope store. Every part of
// the card, the inventory and the merchant controls included, draws inside it. `send` is the
// card's older post of the add-on's command; a piece's base posts its own.
export interface AddonCardValue { members: readonly string[]; scope?: string; send?(addon: string, body: unknown): Promise<void> }
const CardContext = createContext<AddonCardValue | null>(null);
export const AddonCard = CardContext.Provider;
function AddonPieces({ slot }: { slot: { name: AddonPlace; part: string; reports?: Readonly<Record<string, unknown>>; view?: AddonListView<AddonListRow>; character?: unknown } }): ReactNode {
  const { name, part, reports, view, ...shared } = slot;
  const slots = useAddonSlots(), enabled = new Set(slots.addons.filter(addon => addon.enabled).map(addon => addon.name));
  const card = useContext(CardContext), onCard = name === 'card-section' && card;
  const character = typeof shared.character === 'string' ? shared.character : undefined;
  return <>{declaring(name, part).filter(addon => enabled.has(addon)).map(addon => {
    const declared = piecesOf(addon, name)![part]!;
    // A list view piece is its control, its `keep` and its `order`; the slot draws the control.
    const Piece = view ? viewOf(addon, part as AddonPart<'list-view'>)!.control as ComponentType<Record<string, unknown>> : declared;
    return <AddonPieceBoundary key={addon} addon={addon}>
      <Piece {...shared} part={part} {...pieceBase(slots, addon, { character, scope: onCard ? card.scope : undefined })} {...reports ? { report: reports[addon] } : {}}
        {...onCard ? { members: card.members } : {}}
        {...view ? { value: view.values[addon], set: (value: unknown) => view.set(addon, value) } : {}} />
    </AddonPieceBoundary>;
  })}</>;
}

// The open add-on dialogs, mounted once beside the page's other dialogs (party-workspace.tsx), so
// they stay outside the clipped workspace. With no installed add-on declaring a dialog it draws
// nothing and asks for no add-on list.
export function AddonDialogs(): ReactNode {
  return Object.values(dashboards).some(dashboard => dashboard?.dialogs) ? <OpenDialogs /> : null;
}
function OpenDialogs(): ReactNode {
  const slots = useAddonSlots(), [dialogs, setDialogs] = useState(opened);
  useEffect(() => { dialogReaders.add(setDialogs); return () => { dialogReaders.delete(setDialogs); }; }, []);
  const enabled = new Set(slots.addons.filter(addon => addon.enabled).map(addon => addon.name));
  // `contents` keeps the mark out of the layout: each dialog places itself.
  return <section data-area="addon-dialogs" data-addon-slot="addon-dialog" className="contents">{dialogs.filter(open => enabled.has(open.addon)).map(({ addon, dialog, subject }) => {
    const Dialog = dashboards[addon]!.dialogs![dialog] as ComponentType<AddonDialogProps>;
    return <AddonPieceBoundary key={addon + ' ' + dialog} addon={addon}>
      <Dialog {...pieceBase(slots, addon, {})} subject={subject} close={() => closeDialog(addon, dialog)} />
    </AddonPieceBoundary>;
  })}</section>;
}

const untouched: AddonListView<AddonListRow> = { declared: false, values: {}, set() {}, keep: () => true, sort: items => items };
// One list's add-on state, for the list to narrow its rows with `keep`, order them with `sort` and
// hand its `<AddonSlot name="list-view">`. A row passes when every enabled add-on whose control
// holds a value keeps it; an unset control keeps every row. The list sorts by the order of the
// add-on whose control the player set last, and rows that order ties keep the list's own order.
// A list no installed add-on views keeps and orders every row as it came.
export function useAddonListView<P extends AddonPart<'list-view'>>(list: P): AddonListView<AddonListRows[P]> {
  // The installed add-ons are fixed for the page's life, so this branch takes the same side on every render.
  return (declaring('list-view', list).length ? useListView(list) : untouched) as AddonListView<AddonListRows[P]>;
}
function useListView<P extends AddonPart<'list-view'>>(list: P): AddonListView<AddonListRows[P]> {
  const [values, setValues] = useState<Record<string, unknown>>({}), [latest, setLatest] = useState<readonly string[]>([]), slots = useAddonSlots();
  const set = (addon: string, value: unknown) => {
    setValues(previous => {
      const next = { ...previous };
      if (value === undefined) delete next[addon]; else next[addon] = value;
      return next;
    });
    setLatest(previous => [...previous.filter(name => name !== addon), ...value === undefined ? [] : [addon]]);
  };
  const live = Object.entries(values).filter(([addon]) => slots.addons.some(entry => entry.name === addon && entry.enabled));
  const sorter = [...latest].reverse().find(addon => live.some(([name]) => name === addon) && viewOf(addon, list)?.order);
  return { declared: true, values, set,
    keep: row => live.every(([addon, value]) => viewOf(addon, list)!.keep?.(row, value) ?? true),
    sort: (items, row) => {
      if (!sorter) return items;
      const order = viewOf(sorter, list)!.order!, value = values[sorter];
      return items.map((item, index) => ({ item, index, row: row(item) }))
        .sort((a, b) => order(a.row, b.row, value) || a.index - b.index).map(entry => entry.item);
    } };
}
