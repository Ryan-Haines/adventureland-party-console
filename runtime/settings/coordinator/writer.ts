// The one writer of settings. Every route, the settings route and an owner changing a player
// setting itself write a batch here through the `settings.write` hook. The writer checks the
// whole batch before it writes anything, so a refused request changes nothing and names its field
//. An accepted batch writes one audit line per changed field, sends
// `settings.changed` and saves through the persistence writer's own windows. A refused batch
// sends `settings.refused`.
import type { AddonState, HookRegistry } from '../../hooks/registry.ts';
import { valueProblem, type Setting, type SettingsChange, type SettingsRead, type SettingsWrite, type SettingsWriteResult } from '../api.ts';
import { coordinatorSettings, hiddenValue } from './table.ts';

// One audit line. `basis` is the time of the read the page showed, or null for a write that sent
// none, such as an older app's. A secret setting's line carries no values. An add-on's setting or
// switch names its add-on and key.
export interface SettingsLine { at: number; field: string; character?: string; addon?: string; key?: string; old?: unknown; new?: unknown; by: string; basis: number | null }

type Document = 'settings' | 'selections' | 'roster' | 'bank' | 'aldata';
export interface SettingsWriterState { [field: string]: unknown;
  settingsChangedAt?: Record<string, number>; settingsChanges?: SettingsLine[]; addons?: Record<string, AddonState> }
export interface SettingsWriterPorts {
  hooks: Pick<HookRegistry, 'notify' | 'entries' | 'registrations'>;
  owned(name: string): boolean;
  // The party's fighters, the characters an add-on's `character` and `per-character` settings
  // name.
  fighters(): readonly string[];
  // The monster ids the coordinator's game data names, or null before the data loads.
  monsters(): ReadonlySet<string> | null;
  // The game's item names, or null before the game data loads.
  items(): ReadonlySet<string> | null;
  // The coordinator's spawn catalog, or null before the data loads, for a declared check.
  spawns(): readonly unknown[] | null;
  // A character's own farming profile (runtime/tasks/coordinator/groups.ts `profile`): the party's scope for the leader,
  // its scope with Follow off, and a follower's saved preferences, so a write for a follower never reaches the leader's
  // scope.
  scope(name: string): Record<string, unknown>;
  persist(document: Document): void;
  history(): void;
  now(): number;
  // The status owner's app caller: the app whose request runs this write, `app:<name>`, or
  // undefined for the player and the console (runtime/status/coordinator/apps.ts
  // `requestCaller`).
  app(): string | undefined;
}
// Where a change lands: the object at `root` and the path under it.
interface Planned { change: SettingsChange; root: Record<string, unknown>; path: readonly string[]; name: string; whole: unknown; old: unknown; secret: boolean; document: Document }

const at = (root: Record<string, unknown>, path: readonly string[]): unknown =>
  path.reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], root);
function put(root: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let holder = root;
  for (const key of path.slice(0, -1)) holder = (holder[key] ??= {}) as Record<string, unknown>;
  holder[path.at(-1)!] = value;
}

// The game ids a value names for one kind: a `monsters` or `items` setting's own list, and each
// field of that kind inside a `records` setting's records.
function gameIds(setting: Setting, value: unknown, kind: 'monsters' | 'items'): unknown[] {
  if (!Array.isArray(value)) return [];
  if (setting.kind === kind) return value;
  if (setting.kind !== 'records') return [];
  return value.flatMap(record => Object.entries((record ?? {}) as Record<string, unknown>)
    .flatMap(([key, ids]) => setting.fields?.[key]?.kind === kind && Array.isArray(ids) ? ids : []));
}

export function createSettingsWriter(state: SettingsWriterState, ports: SettingsWriterPorts) {
  const { table } = coordinatorSettings();
  // The writer's own records start empty on a state that never saved them.
  const changedAt = state.settingsChangedAt ??= {}, lines = state.settingsChanges ??= [];

  // The time a field last changed for the page's view: a whole value against every entry of it,
  // an entry against itself and the whole value.
  function lastChange(field: string, name: string): number {
    if (name !== field) return Math.max(changedAt[field] ?? 0, changedAt[name] ?? 0);
    return Math.max(0, ...Object.entries(changedAt).filter(([key]) => key === field || key.startsWith(field + ':')).map(([, at]) => at));
  }
  const refuse = (change: SettingsChange, error: string): SettingsWriteResult & { ok: false } =>
    ({ ok: false, field: change.field, ...(change.character !== undefined ? { character: change.character } : {}), error });

  // The checks for an add-on's setting or switch: its kind, its fighters, game data's monsters and
  // its own check decide the value; the switch and an account setting save in the add-on's entry
  // of `addons`, a scope setting in the farming profile's `addonSettings`.
  function addressed(change: SettingsChange, maps: Map<string, Record<string, unknown>>, planned: readonly Planned[]): Omit<Planned, 'name' | 'secret' | 'document'> | string {
    const { addon = '', key = '', character, value } = change, scoped = change.field === 'addonSettings';
    const registration = ports.hooks.registrations().find(r => r.name === addon && r.folder === 'addons');
    if (!registration) return `No installed add-on named ${JSON.stringify(addon)}`;
    if (key === 'enabled' && !scoped) {
      if (typeof value !== 'boolean') return `${addon}'s switch takes true or false`;
      return { change, root: state, path: ['addons', addon, 'enabled'], whole: value, old: at(state, ['addons', addon, 'enabled']) };
    }
    const setting: Setting | undefined = registration.settings?.[key];
    if (!setting || (setting.scope === 'scope') !== scoped) return `${addon} has no setting ${key}${setting ? scoped ? ' saved per farming scope' : ' saved for the account' : ''}`;
    if (scoped && character !== undefined && !ports.owned(character)) return `${character} is not a character of this account`;
    const root = scoped && character !== undefined ? ports.scope(character) : state;
    const path = scoped ? ['addonSettings', addon, key] : ['addons', addon, 'settings', key];
    const fighter = (name: unknown) => ports.fighters().includes(String(name));
    let whole = value, old = at(root, path);
    if (setting.kind === 'per-character') {
      if (character === undefined || !fighter(character)) return `${setting.label} takes one of the party's fighters`;
      const map = maps.get(`${addon}.${key}`) ?? { ...(old as Record<string, unknown> | undefined) };
      old = map[character]; whole = { ...map, [character]: value };
    } else if (character !== undefined && !scoped) return `${setting.label} is one value for the account and takes no character`;
    if (setting.kind === 'character' && value !== null && !fighter(value)) return `${setting.label} takes one of the party's fighters`;
    for (const kind of ['monsters', 'items'] as const) {
      const ids = gameIds(setting, value, kind), known = ids.length ? ports[kind]() : null;
      if (known && !ids.every(id => known.has(String(id)))) return `${setting.label} takes ${kind} the game has`;
    }
    // The add-on's own settings after the change, its keys only, for its own check.
    const own: Record<string, unknown> = Object.fromEntries(Object.entries(registration.settings ?? {}).map(([k, s]) =>
      [k, at(s.scope === 'scope' ? root : state, s.scope === 'scope' ? ['addonSettings', addon, k] : ['addons', addon, 'settings', k]) ?? s.default]));
    for (const p of planned) if (p.change.addon === addon && p.change.key && p.change.key !== 'enabled') own[p.change.key] = p.whole;
    own[key] = whole;
    const problem = valueProblem(setting, whole, own, { spawns: ports.spawns() });
    if (problem) return problem;
    if (setting.kind === 'per-character') maps.set(`${addon}.${key}`, whole as Record<string, unknown>);
    return { change, root, path, whole, old };
  }

  // Step 1 and 2 of 2.3: every change passes before anything is written.
  function plan(batch: SettingsWrite, app: string | undefined): Planned[] | SettingsWriteResult {
    // A per-character field's entries in this batch build on each other's map.
    const planned: Planned[] = [], named = new Set<string>(), maps = new Map<string, Record<string, unknown>>();
    for (const change of batch.changes) {
      const declared = table.fields.get(change.field);
      if (!declared) return refuse(change, `${change.field} is not a declared setting`);
      if (declared.record) return refuse(change, `${change.field} is a record its owner writes from play, not a setting`);
      // The status owner's lock: an app key's write to a field the player locked against apps is
      // refused, and so is its write to the lock list itself, whichever route it came by.
      if (app && (change.field === 'appLocks' || appLocked(change.field)))
        return refuse(change, `${declared.setting.label} is locked against apps`);
      const setting = declared.setting, scope = setting.scope ?? 'account', character = change.character;
      const name = [change.field, ...change.addon !== undefined ? [`${change.addon}.${change.key}`] : [], ...character !== undefined ? [character] : []].join(':');
      if (named.has(name) || named.has(change.field) || name === change.field && [...named].some(n => n.startsWith(change.field + ':')))
        return refuse(change, `${setting.label} is named twice in one write`);
      named.add(name);
      let place: Omit<Planned, 'name' | 'secret' | 'document'>;
      if (change.addon !== undefined) {
        const result = addressed(change, maps, planned);
        if (typeof result === 'string') return refuse(change, result);
        place = result;
      } else {
        if (character !== undefined && scope === 'account') return refuse(change, `${setting.label} is one value for the account and takes no character`);
        if (character !== undefined && !ports.owned(character)) return refuse(change, `${character} is not a character of this account`);
        if (setting.kind === 'character' && change.value !== null && !ports.owned(String(change.value)))
          return refuse(change, `${setting.label} takes a character of this account`);
        // A setting with a `path` sits inside a `party` object (the ALData key in
        // `party.aldata`); a scope setting with a character in that character's own profile.
        const root = setting.path ? state[setting.path[0]] as Record<string, unknown>
          : scope === 'scope' && character !== undefined ? ports.scope(character) : state;
        const key = setting.path ? setting.path[1] : change.field;
        const entry = scope === 'character' && character !== undefined;
        const map = maps.get(change.field) ?? (root[key] ?? {}) as Record<string, unknown>;
        // `value: null` on a character entry removes that entry, so the character returns to the
        // owner's default and the map's other entries stay.
        const whole = !entry ? change.value : change.value === null
          ? Object.fromEntries(Object.entries(map).filter(([name]) => name !== character)) : { ...map, [character]: change.value };
        // A slot field takes the slot's entries the registry holds now.
        const problem = valueProblem(setting.slot ? { ...setting, choices: ports.hooks.entries(setting.slot).map(e => e.mode) } : setting, whole,
          undefined, { spawns: ports.spawns() });
        if (problem) return refuse(change, problem);
        if (entry) maps.set(change.field, whole as Record<string, unknown>);
        place = { change, root, path: [key], whole, old: entry ? map[character] : root[key] };
      }
      // Decided (user, 2026-11-03): a page whose view is older than a later change of the field
      // has that change refused. The refusal says plainly that the change was not saved because
      // the page was out of date, names the field and carries its current value, which the page
      // shows in its place. A write with no basis goes through, and its line says so.
      if (batch.basis !== undefined && lastChange(change.field, name) > batch.basis)
        return { ...refuse(change, `${setting.label} was not saved: this page was out of date, so it shows the current value again`),
          reason: 'out of date', ...(setting.secret ? {} : { current: place.old }) };
      if (JSON.stringify(place.old) === JSON.stringify(change.value)) continue;
      planned.push({ ...place, name, secret: !!setting.secret, document: setting.document ?? 'settings' });
    }
    return planned;
  }

  const appLocked = (field: string) => { const locks = read({ field: 'appLocks' }); return Array.isArray(locks) && locks.includes(field); };
  function write(batch: SettingsWrite): SettingsWriteResult {
    // An app's write names the app in place of the
    // route it came by.
    const app = ports.app(), by = app ?? batch.by;
    const planned = plan(batch, app);
    if (!Array.isArray(planned)) {
      if (!planned.ok) ports.hooks.notify('settings.refused', { field: planned.field, character: planned.character, error: planned.error, reason: planned.reason, by });
      return planned;
    }
    const at = ports.now();
    // Step 3: apply every change and record when it changed.
    // A leader change applies first: a scope setting in the same batch lands in the new leader's
    // profile, whatever order the batch names them in.
    for (const p of [...planned].sort((a, b) => Number(b.change.field === 'leader') - Number(a.change.field === 'leader'))) {
      put(p.root, p.path, structuredClone(p.whole)); changedAt[p.name] = at;
    }
    // Step 4: one audit line per changed field, newest `historyKept` (the history document's bound
    // for every list, persistence/snapshots.ts `historySnapshot`).
    const named = (change: SettingsChange) => ({ ...change.character !== undefined ? { character: change.character } : {},
      ...change.addon !== undefined ? { addon: change.addon, key: change.key } : {} });
    for (const { change, old, secret } of planned)
      lines.push({ at, field: change.field, ...named(change), ...(secret ? {} : { old, new: change.value }), by, basis: batch.basis ?? null });
    const kept = hiddenValue('historyKept');
    if (lines.length > kept) lines.splice(0, lines.length - kept);
    // Step 5: the readers hear each change in the batch's order. The add-on system hears its
    // switches the same way (runtime/hooks/core.ts `core:addons`).
    for (const { change, old, secret } of planned)
      ports.hooks.notify('settings.changed', { field: change.field, ...named(change), ...(secret ? {} : { old, new: change.value }), by });
    // Step 6: memory is current at once; each document saves in its own window.
    for (const document of new Set(planned.map(p => p.document))) ports.persist(document);
    if (planned.length) ports.history();
    return { ok: true, changed: planned.map(p => p.change.field) };
  }

  // A setting's value outside a hook call (1.4): the account's, a character's entry, or the copy
  // in a character's own farming profile.
  function read({ field, character }: SettingsRead): unknown {
    const declared = table.fields.get(field);
    if (!declared || declared.record) return undefined;
    const scope = declared.setting.scope ?? 'account', path = declared.setting.path;
    if (path) return (state[path[0]] as Record<string, unknown> | undefined)?.[path[1]];
    if (scope === 'scope') return (character === undefined ? state : ports.scope(character))[field];
    const value = state[field];
    return scope === 'character' && character !== undefined ? (value as Record<string, unknown> | undefined)?.[character] : value;
  }

  return { write, read };
}
