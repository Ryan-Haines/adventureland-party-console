// The two slots:
// the target mode entry each group selected names its task (Farming, an
// add-on entry such as Achievements, or Hunt, whose `hunt` source asks), and the entry's tick runs
// only while that task may act. When the entry's task ends, the add-on gets one `release` call,
// so it lets go of what it holds (its target, its focus). The combat mode slot's add-on answer
// reaches the members with the hand response.
import type { HttpHandler } from '../../lifecycle/api.ts';
import type { ReturnLocation } from '../../events/api.ts';
import type { HookRegistry, Registration, SlotMode } from '../../hooks/registry.ts';
import type { SettingsChange, SettingsWrite, SettingsWriteResult } from '../../settings/api.ts';
import type { SourceAnswer, SourceView } from './sources.ts';

// What a target mode entry's ports offer (published through api.ts).
export interface TargetModePorts {
  members(): string[];
  // Why the entry may not act now, or null (the `busy` question).
  busy(): string | null;
  destination(id: string): ReturnLocation | null | undefined;
  select(id: string, location: ReturnLocation): string[] | null;
  // Sets the scope's monster focus, the entry's target with the monsters it fights beside it,
  // through the hunting owner's record writer.
  focus(ids: string[]): void;
  radius(): number;
  persist(): void;
  write(changes: SettingsChange[]): SettingsWriteResult;
  passive?: { rule(id: string): unknown; set(rules: Record<string, unknown>): SettingsWriteResult };
  // Ends the entry by itself: writes the entry's `returnsTo` (Farming when unset) as the scope's
  // target mode, so its task ends and the slot's `release` call follows.
  leave(): SettingsWriteResult;
}
// The view one `target.mode` or `target.settings` call gets for one farming scope. `release` is
// set on the one call after the entry's task ended.
export interface TargetModeView { owner: string; scope: SlotScope; store: Record<string, unknown>; now: number; ports: TargetModePorts; release?: true; body?: unknown }
export interface SlotScope { targetMode?: unknown; combatMode?: unknown; leader?: string | null; addonFarming?: Record<string, Record<string, unknown>> }
// The ports the coordinator gives one scope's entries; `passive.set` takes the writer's name.
export interface ScopePorts extends Omit<TargetModePorts, 'write' | 'passive' | 'busy' | 'leave'> {
  passive?: { rule(id: string): unknown; set(rules: Record<string, unknown>, by: string): SettingsWriteResult };
  write(changes: SettingsChange[], by: string): SettingsWriteResult;
}

// The ports one target mode add-on gets: entryPorts writes a setting the add-on changes through the
// settings writer under the add-on's name (`addon:<name>`). An entry that
// lists `reads` writes only those settings and the slot's own pair.
function entryPorts(ports: ScopePorts, busy: () => string | null, name: string, mode: SlotMode | undefined, leader: string | null | undefined): TargetModePorts {
  const by = 'addon:' + name, passive = ports.passive;
  const write = (changes: SettingsChange[]): SettingsWriteResult => {
    const outside = mode?.reads && changes.find(c => !['targetMode', 'combatMode', ...mode.reads!].includes(c.field));
    if (outside) return { ok: false, field: outside.field, error: `${name} writes only the settings its entry reads: ${mode!.reads!.join(', ')}` };
    return ports.write(changes, by);
  };
  return { ...ports, busy, write, passive: passive && { rule: passive.rule, set: rules => passive.set(rules, by) },
    leave: () => ports.write([{ field: 'targetMode', value: mode?.returnsTo ?? 'farming', ...(leader ? { character: leader } : {}) }], by) };
}
// The target mode entry the add-on `name` fills.
const modeOf = (hooks: HookRegistry, name: string) => hooks.registrations().find(r => r.name === name)?.slots?.find(m => m.slot === 'target-mode' && m.fills === 'choice');
const storeOf = (state: SlotScope, name: string) => ((state.addonFarming ||= {})[name] ||= {});
// The entry a scope selected, as its task names it: Farming or an add-on's entry. An entry no
// switched-on add-on fills farms.
const entryOf = (hooks: HookRegistry, state: SlotScope) => hooks.targetModes().find(m => m.mode === state.targetMode);

// The `slot` source: the selected entry's `farming` task, `farm:<entry>:<leader>`. A change of
// entry ends the old entry's task `replaced:farming`, and a combat mode change ends nothing. Hunt
// asks through the `hunt` source, so the slot asks nothing while a scope selects Hunt. The task's label is
// The hunting owner's farm spot label (`farming.focus(group).spot`), or "Farming" while the spot has none.
export function slotSource(ports: { hooks: HookRegistry; scope(group: SourceView): SlotScope | null; huntKind(state: SlotScope): string | null;
  release(state: SlotScope, owner: string, mode: string): void }): Registration {
  return { name: 'core:slot', folder: 'core', author: 'adventureland-party-console',
    summary: 'Asks for the farming task of the target mode entry each group selected.',
    hooks: { 'task.request': (view): SourceAnswer[] => {
      const g = view as SourceView, state = ports.scope(g);
      if (!state) return [];
      const hunt = ports.huntKind(state);
      if (hunt || state.targetMode === 'hunt') return [{ slot: 'farm', ask: null, end: hunt ? `replaced:${hunt}` : 'hunt-ended' }];
      const entry = entryOf(ports.hooks, state)?.mode ?? 'farming';
      const spot = ports.hooks.ask('farming.focus', g.group)?.spot;
      return [{ slot: 'farm', end: 'replaced:farming', ask: { kind: 'farming', owner: `farm:${entry}:${state.leader}`, phase: 'farm', label: spot || 'Farming',
        provider: { onEnd: () => ports.release(state, String(state.leader), entry) } } }];
    } } };
}
export function createSlots(ports: { hooks: HookRegistry; now(): number; scopePorts(state: SlotScope): ScopePorts; busy(state: SlotScope): string | null }) {
  const portsOf = (state: SlotScope, name: string) => entryPorts(ports.scopePorts(state), () => ports.busy(state), name, modeOf(ports.hooks, name), state.leader);
  return {
    // One `release` call for the entry whose task ended, so the add-on lets go of its target and focus.
    release(state: SlotScope, owner: string, mode: string) {
      const addon = ports.hooks.targetTicks().find(t => t.mode === mode);
      if (addon) addon.tick({ owner, scope: state, store: storeOf(state, addon.name), now: ports.now(), ports: portsOf(state, addon.name), release: true } satisfies TargetModeView, state);
    },
    // The selected add-on entry's tick, while the group's slot task may act (`runs`); it hands
    // the scope's characters what it returns. Each call names its farming scope, whose own values
    // of the settings placed per scope the add-on reads.
    tick(state: SlotScope, owner: string) {
      const entry = entryOf(ports.hooks, state);
      for (const addon of ports.hooks.targetTicks()) {
        // An entry the scope did not select hands nothing. Its store is the add-on's own, so a scope
        // that holds none gets none.
        if (addon.mode !== entry?.mode) { const store = state.addonFarming?.[addon.name]; if (store && 'deliver' in store) store.deliver = null; continue; }
        const store = storeOf(state, addon.name);
        store.deliver = addon.tick({ owner, scope: state, store, now: ports.now(), ports: portsOf(state, addon.name) } satisfies TargetModeView, state) ?? null;
      }
    },
    // POST /party-api/addon-farming { name, character?, settings?, ... }: a target mode add-on's
    // own settings for the character's farming scope.
    route(state: SlotScope, owner: () => string): HttpHandler {
      return (req, res) => {
        const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>, name = String(body.name ?? '');
        const handler = ports.hooks.targetSettings(name);
        if (!handler) return res.status(404).json({ error: 'No enabled target mode add-on named ' + JSON.stringify(name) });
        const result = handler({ owner: owner(), scope: state, store: storeOf(state, name), now: ports.now(), ports: portsOf(state, name), body } as TargetModeView, state) as
          { ok: true; reply: Record<string, unknown> } | { ok: false; status: number; error: string };
        return result.ok ? res.json({ ok: true, ...result.reply }) : res.status(result.status).json({ error: result.error });
      };
    },
  };
}

// The target mode slot's Hunt half. The hunting owner's Hunt entry owns the Hunt record and its ports
// (runtime/hunting/coordinator/modes.ts `HuntModeState`, `createHuntEntry`); the slot reads
// the scope's target and leader and asks the entry the hunting route hands it.
export interface HuntSlotState { targetMode: string; leader: string | null }
export interface HuntModePorts {
  // Writes the request's slot fields through the settings writer.
  write(batch: SettingsWrite): SettingsWriteResult;
  entry: { select(previous: string, mode: string, location: ReturnLocation | null, backupFocus: string[] | undefined, backupSupplied: boolean): void };
}

/**
 * The target mode slot's Hunt half: the request's slot fields go through the settings writer first,
 * so a refused request changes nothing, and a target change then asks the hunting owner's Hunt entry,
 * which begins, restarts or releases the cycle. The combat mode alone changes how the party
 * fights and ends nothing.
 */
export function createHuntMode(state: HuntSlotState, ports: HuntModePorts) {
  function select(
    slots: { combatMode?: string; targetMode?: string },
    location: ReturnLocation | null,
    backupFocus: string[] | undefined,
    backupSupplied: boolean,
  ): SettingsWriteResult {
    const previous = state.targetMode, mode = slots.targetMode;
    const written = ports.write({ by: "dashboard:farming-mode", changes: ([["combatMode", slots.combatMode], ["targetMode", mode]] as const)
      .flatMap(([field, value]) => value === undefined ? [] : [{ field, value, ...(state.leader ? { character: state.leader } : {}) }]) });
    if (!written.ok || mode === undefined) return written;
    ports.entry.select(previous, mode, location, backupFocus, backupSupplied);
    return written;
  }
  return { select };
}

