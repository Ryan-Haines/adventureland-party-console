// Each add-on's small stores: one model on the character, the
// coordinator and the dashboard. A store key names whose values they are: `character:<name>` for
// one character's own, `scope:<owner>` for one farming scope's, and `party` for the whole party.
// The coordinator holds every store and saves it. A count an add-on keeps on the client, such as a
// count of deaths, outlives a reload of that client: the character reports its writes with each
// status, and every reply hands back the keys the coordinator holds newer.
//
// Each key carries its own revision and the side that wrote it. A merge keeps the higher revision;
// on a tie the coordinator's write wins, so a character write and a dashboard write to different
// keys both survive. A revision is the writer's clock in milliseconds, raised by one past the key's
// last revision, so a coordinator restart still writes newer than any revision a character holds.
// A store is never a setting: a write never runs the settings `check` and never changes what the
// player saved (SV).
export type StoreSide = 'character' | 'coordinator';
export interface StoreEntry { v: unknown; rev: number; by: StoreSide }
// One add-on's keys under one store key.
export type KeyedStore = Record<string, StoreEntry>;
// Every add-on's keyed stores, by store key and then by add-on.
export type StoreBook = Record<string, Record<string, KeyedStore>>;
// The revisions a character holds, by store key, add-on and key.
export type HeldRevisions = Record<string, Record<string, Record<string, number>>>;
// What a character's report carries up: the revisions it holds and its own writes.
export interface StoreReport { held: HeldRevisions; writes: StoreBook }
// What the reply carries down: the character's three store keys and every key it holds older.
export interface StoreKeys { character: string; scope: string; party: string }
export interface StoreDown { keys: StoreKeys; stores: StoreBook }
export type StoreKind = keyof StoreKeys;
// What an add-on's hooks read and write. `rev` is the store's newest revision, 0 while it is empty.
export interface AddonStoreHandle { get(key: string): unknown; set(key: string, value: unknown): void; rev(): number }

export const PARTY_STORE = 'party';
export const characterStore = (name: string) => `character:${name}`;
export const scopeStore = (owner: string) => `scope:${owner}`;
export const nextRevision = (old: number, now: number) => Math.max(old + 1, Math.floor(now));

// A store value is JSON: a value that fails a JSON round trip is refused at `set`.
export function isJson(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  if (typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Object.values(value as object).every(isJson);
}
const validEntry = (e: unknown): e is StoreEntry => !!e && typeof e === 'object' && Number.isFinite((e as StoreEntry).rev) &&
  (e as StoreEntry).rev > 0 && ((e as StoreEntry).by === 'character' || (e as StoreEntry).by === 'coordinator') && isJson((e as StoreEntry).v);
// Whether `incoming` replaces `saved`: the higher revision, and the coordinator on a tie.
export const newer = (incoming: StoreEntry, saved: StoreEntry | undefined) => !saved || incoming.rev > saved.rev ||
  incoming.rev === saved.rev && incoming.by === 'coordinator' && saved.by === 'character';
const objectAt = <T,>(at: Record<string, T>, key: string, make: () => T): T => (at[key] ??= make());
const empty = <T,>(): Record<string, T> => ({});
const keyedAt = (book: StoreBook, storeKey: string, addon: string): KeyedStore => objectAt(objectAt(book, storeKey, empty<KeyedStore>), addon, empty<StoreEntry>);
const entries = (book: unknown) => !book || typeof book !== 'object' ? [] :
  Object.entries(book as Record<string, unknown>).flatMap(([storeKey, addons]) => !addons || typeof addons !== 'object' ? [] :
    Object.entries(addons as Record<string, unknown>).flatMap(([addon, keys]) => !keys || typeof keys !== 'object' ? [] :
      Object.entries(keys as Record<string, unknown>).map(([key, entry]) => ({ storeKey, addon, key, entry }))));

// A handle over one add-on's keys under one store key. `wrote` runs after each change; `refuse`
// hears a value that is not JSON, or a store this side does not know yet.
function handleOver(keyed: () => KeyedStore | undefined, ensure: () => KeyedStore | undefined, side: StoreSide, now: () => number,
  wrote: (key: string, entry: StoreEntry) => void, refuse: (message: string) => void): AddonStoreHandle {
  return {
    get: key => keyed()?.[key]?.v,
    set(key, value) {
      if (!isJson(value)) { refuse(`the store refused ${JSON.stringify(key)}: its value is not JSON`); return; }
      const at = ensure();
      if (!at) { refuse(`the store refused ${JSON.stringify(key)}: this side does not know that store yet`); return; }
      if (at[key] && JSON.stringify(at[key].v) === JSON.stringify(value)) return;
      const entry: StoreEntry = { v: value, rev: nextRevision(at[key]?.rev ?? 0, now()), by: side };
      at[key] = entry; wrote(key, entry);
    },
    rev: () => Math.max(0, ...Object.values(keyed() ?? {}).map(e => e.rev)),
  };
}
export type HandleSet = { character: AddonStoreHandle; scope: AddonStoreHandle; party: AddonStoreHandle };

// The character's side: the stores of this character's add-ons, under the store keys the last
// reply named. Its own writes stay in `dirty` until a reply answers the report that carried them.
export function createAddonStores(now: () => number = Date.now) {
  const book: StoreBook = {};
  let keys: StoreKeys | null = null;
  const dirty = new Map<string, StoreEntry>(), sent = new Map<string, number>();
  const id = (storeKey: string, addon: string, key: string) => JSON.stringify([storeKey, addon, key]);
  return {
    // The character's own store key, before the first reply names all three.
    self(name: string): void { if (!keys) keys = { character: characterStore(name), scope: '', party: PARTY_STORE }; },
    keys: (): StoreKeys | null => keys,
    handles(addon: string, refuse: (message: string) => void): HandleSet {
      const one = (kind: StoreKind) => {
        const storeKey = () => keys?.[kind] || '';
        return handleOver(() => book[storeKey()]?.[addon], () => storeKey() ? keyedAt(book, storeKey(), addon) : undefined,
          'character', now, (key, entry) => dirty.set(id(storeKey(), addon, key), entry), refuse);
      };
      return { character: one('character'), scope: one('scope'), party: one('party') };
    },
    // One add-on's values of one of its stores, as a plain record.
    values(addon: string, kind: StoreKind): Record<string, unknown> {
      return Object.fromEntries(Object.entries(book[keys?.[kind] || '']?.[addon] ?? {}).map(([key, entry]) => [key, entry.v]));
    },
    // The reply's `addonStores`: its keys and every newer entry. A reply answers the report before
    // it, so the writes that report carried leave `dirty` unless a later write replaced them.
    restore(down: unknown): void {
      if (!down || typeof down !== 'object') return;
      const given = down as Partial<StoreDown>;
      if (given.keys && typeof given.keys.character === 'string') keys = { character: given.keys.character, scope: String(given.keys.scope ?? ''), party: PARTY_STORE };
      for (const { storeKey, addon, key, entry } of entries(given.stores)) {
        if (!validEntry(entry)) continue;
        const at = keyedAt(book, storeKey, addon);
        if (newer(entry, at[key])) at[key] = { ...entry };
      }
      for (const [k, rev] of sent) if (dirty.get(k)?.rev === rev) dirty.delete(k);
      sent.clear();
    },
    report(): StoreReport {
      const held: HeldRevisions = {}, writes: StoreBook = {};
      for (const [storeKey, addons] of Object.entries(book)) for (const [addon, keyed] of Object.entries(addons))
        for (const [key, entry] of Object.entries(keyed)) objectAt(objectAt(held, storeKey, empty<Record<string, number>>), addon, empty<number>)[key] = entry.rev;
      for (const [k, entry] of dirty) {
        const [storeKey, addon, key] = JSON.parse(k) as [string, string, string];
        keyedAt(writes, storeKey, addon)[key] = { ...entry };
        sent.set(k, entry.rev);
      }
      return { held, writes };
    },
  };
}

// A farming scope as the coordinator keeps it: each add-on's values of the scope store live in
// the scope's `addonFarming[<add-on>]`, which the scope's profile saves, and which the target mode
// routes and `addon.command` write in place.
export interface ScopeHolder { addonFarming?: Record<string, Record<string, unknown>> }
interface ScopeShadow { json: string; entry: StoreEntry }

// The coordinator's side: every store. `attach` hands it the account's `addonStores` record, which
// holds the character and party keys. A scope key's values stay in the scope's `addonFarming`; its
// revisions live here, raised whenever a value there changed since the last look.
export function createStoreBook(now: () => number = Date.now) {
  let saved: StoreBook = {};
  let persist: () => void = () => {};
  // Each character's held revisions from its last report, and its scope's owner from its last reply.
  const held = new Map<string, HeldRevisions>(), owners = new Map<string, string>();
  const shadows = new Map<string, Map<string, ScopeShadow>>();
  // A character's writes to its scope's store wait here until the reply that holds the scope.
  const scopeWrites = new Map<string, { addon: string; key: string; entry: StoreEntry }[]>();
  const shadowKey = (addon: string, key: string) => JSON.stringify([addon, key]);
  // Applies the character writes that arrived since the last look, when newer, then raises the
  // revision of each scope value that changed.
  function syncScope(owner: string, scope: ScopeHolder): Map<string, ScopeShadow> {
    const storeKey = scopeStore(owner), shadow = shadows.get(storeKey) ?? new Map<string, ScopeShadow>();
    shadows.set(storeKey, shadow);
    let changed = false;
    for (const { addon, key, entry } of scopeWrites.get(storeKey) ?? []) {
      if (!newer(entry, shadow.get(shadowKey(addon, key))?.entry)) continue;
      objectAt(scope.addonFarming ??= {}, addon, empty<unknown>)[key] = entry.v;
      shadow.set(shadowKey(addon, key), { json: JSON.stringify(entry.v), entry }); changed = true;
    }
    scopeWrites.delete(storeKey);
    const seen = new Set<string>();
    for (const [addon, values] of Object.entries(scope.addonFarming ?? {})) for (const [key, value] of Object.entries(values ?? {})) {
      const k = shadowKey(addon, key), json = JSON.stringify(value) ?? 'null', was = shadow.get(k);
      seen.add(k);
      if (was?.json === json) continue;
      shadow.set(k, { json, entry: { v: isJson(value) ? value : null, rev: nextRevision(was?.entry.rev ?? 0, now()), by: 'coordinator' } });
    }
    for (const [k, was] of shadow) if (!seen.has(k) && was.json !== 'null') shadow.set(k, { json: 'null', entry: { v: null, rev: nextRevision(was.entry.rev, now()), by: 'coordinator' } });
    if (changed) persist();
    return shadow;
  }
  const scopeEntries = (shadow: Map<string, ScopeShadow>): Record<string, KeyedStore> => {
    const out: Record<string, KeyedStore> = {};
    for (const [k, { entry }] of shadow) { const [addon, key] = JSON.parse(k) as [string, string]; objectAt(out, addon, empty<StoreEntry>)[key] = entry; }
    return out;
  };
  return {
    // A save from before the per-key model, one `{rev, values}` per character and add-on, becomes
    // that character's store key with the old revision on each key.
    attach(record: Record<string, unknown>, save: () => void): void {
      persist = save;
      for (const [top, addons] of Object.entries(record)) {
        if (top === PARTY_STORE || top.startsWith('character:') || top.startsWith('scope:')) continue;
        delete record[top];
        const target = objectAt(record as StoreBook, characterStore(top), empty<KeyedStore>);
        for (const [addon, old] of Object.entries((addons ?? {}) as Record<string, { rev?: number; values?: Record<string, unknown> } | undefined>)) {
          const rev = Number(old?.rev);
          if (!(rev > 0) || !old?.values || typeof old.values !== 'object') continue;
          target[addon] = Object.fromEntries(Object.entries(old.values).filter(([, v]) => isJson(v)).map(([key, v]) => [key, { v, rev, by: 'character' as const }]));
        }
      }
      saved = record as StoreBook;
    },
    // A character's report: the revisions it holds, and its writes to its own key, the party's and
    // the scope's its last reply named. `skipped` names each add-on whose entry is malformed or under another key; the
    // client's store code is console code, so the intake records each one as a console bug.
    merge(name: string, report: unknown): { changed: boolean; skipped: string[] } {
      const scopeOwner = owners.get(name);
      const skipped = new Set<string>();
      if (!report || typeof report !== 'object') return { changed: false, skipped: [] };
      const given = report as Partial<StoreReport>;
      if (given.held && typeof given.held === 'object') held.set(name, given.held);
      let changed = false;
      for (const { storeKey, addon, key, entry } of entries(given.writes)) {
        const scope = !!scopeOwner && storeKey === scopeStore(scopeOwner);
        if (!validEntry(entry) || entry.by !== 'character' || !scope && storeKey !== characterStore(name) && storeKey !== PARTY_STORE) { skipped.add(addon); continue; }
        if (scope) { scopeWrites.set(storeKey, [...scopeWrites.get(storeKey) ?? [], { addon, key, entry }]); continue; }
        const at = keyedAt(saved, storeKey, addon);
        if (newer(entry, at[key])) { at[key] = { ...entry }; changed = true; }
      }
      if (changed) persist();
      return { changed, skipped: [...skipped] };
    },
    // The reply's `addonStores` for one character: its three keys, and each entry of the enabled
    // add-ons newer than the revision it holds.
    down(name: string, addons: readonly string[], owner: string, scope: ScopeHolder): StoreDown {
      const keys: StoreKeys = { character: characterStore(name), scope: scopeStore(owner), party: PARTY_STORE };
      owners.set(name, owner);
      const mine = held.get(name) ?? {}, stores: StoreBook = {};
      const sources: [string, Record<string, KeyedStore> | undefined][] = [[keys.character, saved[keys.character]], [keys.party, saved[keys.party]],
        [keys.scope, scopeEntries(syncScope(owner, scope))]];
      for (const [storeKey, byAddon] of sources) for (const addon of addons) for (const [key, entry] of Object.entries(byAddon?.[addon] ?? {})) {
        const has = mine[storeKey]?.[addon]?.[key] ?? 0;
        if (entry.rev > has || entry.rev === has && entry.by === 'coordinator') keyedAt(stores, storeKey, addon)[key] = entry;
      }
      return { keys, stores };
    },
    // One add-on's three handles on the coordinator, for the character a call is for. The scope
    // handle writes the scope's `addonFarming` in place.
    handles(addon: string, character: string | undefined, owner: string | undefined, scope: ScopeHolder | undefined, refuse: (message: string) => void): HandleSet {
      const book = (storeKey: string | undefined) => handleOver(() => storeKey ? saved[storeKey]?.[addon] : undefined,
        () => storeKey ? keyedAt(saved, storeKey, addon) : undefined, 'coordinator', now, () => persist(), refuse);
      const scopeHandle: AddonStoreHandle = {
        get: key => scope?.addonFarming?.[addon]?.[key],
        set(key, value) {
          if (!isJson(value)) { refuse(`the store refused ${JSON.stringify(key)}: its value is not JSON`); return; }
          if (!scope) { refuse(`the store refused ${JSON.stringify(key)}: this call names no farming scope`); return; }
          objectAt(scope.addonFarming ??= {}, addon, empty<unknown>)[key] = value; persist();
        },
        rev: () => owner && scope ? Math.max(0, ...[...syncScope(owner, scope)].filter(([k]) => (JSON.parse(k) as string[])[0] === addon).map(([, s]) => s.entry.rev)) : 0,
      };
      return { character: book(character && characterStore(character)), scope: scopeHandle, party: book(PARTY_STORE) };
    },
    // The dashboard's write (POST /party-api/addon-command with the `store` verb): a patch of one
    // add-on's keys under a character or party store key.
    patch(addon: string, storeKey: string, patch: Record<string, unknown>): string | undefined {
      if (storeKey !== PARTY_STORE && !storeKey.startsWith('character:'))
        return `${JSON.stringify(storeKey)} is not a character or party store; the add-on's own command writes its scope store`;
      const bad = Object.entries(patch).find(([, v]) => !isJson(v));
      if (bad) return `the value of ${JSON.stringify(bad[0])} is not JSON`;
      const at = keyedAt(saved, storeKey, addon);
      for (const [key, v] of Object.entries(patch)) at[key] = { v, rev: nextRevision(at[key]?.rev ?? 0, now()), by: 'coordinator' };
      persist();
      return undefined;
    },
    // Every store's values by add-on and store key, for GET /party-api/addons. A scope store shows
    // as of the last reply that read its scope.
    values(): Record<string, Record<string, Record<string, unknown>>> {
      const out: Record<string, Record<string, Record<string, unknown>>> = {};
      for (const [storeKey, addons] of Object.entries(saved)) for (const [addon, keyed] of Object.entries(addons))
        out[addon] = { ...out[addon], [storeKey]: Object.fromEntries(Object.entries(keyed).map(([k, e]) => [k, e.v])) };
      for (const [storeKey, shadow] of shadows) for (const [k, { entry }] of shadow) {
        const [addon, key] = JSON.parse(k) as [string, string];
        objectAt(objectAt(out, addon, empty<Record<string, unknown>>), storeKey, empty<unknown>)[key] = entry.v;
      }
      return out;
    },
  };
}
export type StoreBookHub = ReturnType<typeof createStoreBook>;
