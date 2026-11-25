// Achievement Hunt (README.md here): a target mode entry beside Farming and Hunt, with any combat
// mode (user decision M1). The coordinator ticks it for each farming scope (`target.mode`), the
// player's choices reach it through `target.settings`, and on the characters its bosses keep a zone (`step.safety`), a
// character walks out of one (`movement.request`) and reports the bosses it sees
// (`status.report`). Everything it keeps lives in the scope's add-on store, which persists with
// the scope's farming profile.
import { ask, delivered, type MoverView, type PassiveRule, type Registration, type SettingsWriteResult, type TargetModePorts, type TargetModeView, type ViewEntity } from '../../hooks/addon-api.ts';
import { createAchievementHunt, fresh, type AchievementHuntScope, type AchievementHuntStore, type AchievementHuntView } from './hunt.ts';
import { achievementMonsters, type AchievementCatalogEntry, type BossCut } from './policy.ts';
import { defaultAchievementHuntSettings, validAchievementHuntSettings, type AchievementHuntSettings } from './settings.ts';
import { pullRefusal, retreatAnswer, sightings, zoneRefusal, type ZoneView } from './zones.ts';

const NAME = 'achievement-hunt', MODE = 'achievements';
type Store = AchievementHuntStore & Record<string, unknown>;
type Scope = AchievementHuntScope & Record<string, unknown>;
// What the coordinator hands the slot's tick for one farming scope (the groups and tasks owner's
// `TargetModeView`), with the hunt's own scope, store and passive rule shapes.
export interface FarmingView extends Omit<TargetModeView, 'scope' | 'store' | 'ports'> {
  scope: Scope; store: Store;
  ports: Omit<TargetModePorts, 'passive'> & { passive?: { rule(id: string): PassiveRule | undefined; set(rules: Record<string, PassiveRule>): SettingsWriteResult } };
}

// One hunt per farming scope, keyed by the scope's owner. Each call hands the scope's newest view to
// its entry, and the hunt reads that view's scope, store and ports, so a tick never reads an older
// view. The view's clock and the add-on's boss cut-off join its ports. An entry lives while its
// scope's task does: the slot's `release` call and `addon.off` drop it, so the next hunt starts with
// no boss holds or failed routes.
interface HuntEntry { hunt: ReturnType<typeof createAchievementHunt>; view: AchievementHuntView }
const hunts = new Map<string, HuntEntry>();
// The boss cut-off from the add-on's declared settings (`bossSpawns`, `bossHp`).
const cutOf = (settings: Readonly<Record<string, unknown>>): BossCut => ({ spawns: Number(settings.bossSpawns), hp: Number(settings.bossHp) });
function huntFor(v: FarmingView, settings: Readonly<Record<string, unknown>>) {
  const view: AchievementHuntView = { scope: v.scope, store: v.store, ports: { ...v.ports, now: () => v.now, bossCut: () => cutOf(settings) } };
  const existing = hunts.get(v.owner);
  if (existing) { existing.view = view; return existing.hunt; }
  const entry: HuntEntry = { view, hunt: createAchievementHunt(() => entry.view) };
  hunts.set(v.owner, entry);
  return entry.hunt;
}
function initialStore(store: Store): void {
  store.achievementHunt ??= { ...defaultAchievementHuntSettings };
  store.achievementBlacklist ??= {};
  store.achievementTarget ??= null;
  store.achievementMessage ??= '';
}
const known = (scope: Scope, settings: Readonly<Record<string, unknown>>) =>
  new Set(achievementMonsters(scope.bestiaryCatalog as AchievementCatalogEntry[] | null, scope.monsterChoices, cutOf(settings),
    id => ask('passive.rule', id).corePriority).map(m => m.id));
const reply = (store: Store) => ({ achievementHunt: store.achievementHunt, achievementBlacklist: store.achievementBlacklist,
  achievementTarget: store.achievementTarget, achievementMessage: store.achievementMessage });
// The avoid list the coordinator hands each character of the scope.
const avoidList = (): readonly string[] => {
  const given = delivered(NAME) as { avoid?: string[] } | undefined;
  return Array.isArray(given?.avoid) ? given!.avoid : [];
};

export const registration: Registration = {
  name: NAME, folder: 'addons', author: 'Icelocked',
  summary: 'A target mode that farms the monsters you pick for their kill achievements, weakest first, and keeps the party away from the bosses on their ground.',
  slots: [{ slot: 'target-mode', mode: MODE, fills: 'choice',
    button: { label: 'Achievements', description: 'Farm the selected monsters for their kill achievements, weakest first, one milestone step at a time', color: 'rose' },
    status: { title: 'Achievement Hunt status', field: 'achievementMessage', idle: 'Choosing the next monster' } }],
  // The boss cut-off for monsters the game does not flag (policy.ts `BossCut`): no game field marks
  // a boss, so the fork's two values are settings with those values as defaults, and play at the
  // defaults does not change.
  settings: {
    bossSpawns: { label: 'A boss has at most this many spawns', kind: 'number', min: 1, default: 2 },
    bossHp: { label: 'A boss has at least this much HP', kind: 'number', min: 1, default: 50_000 },
  },
  hooks: {
    'target.mode'(view, settings) {
      const v = view as FarmingView;
      initialStore(v.store);
      huntFor(v, settings).tick();
      if (v.release) hunts.delete(v.owner);
      // The characters keep away from the target's bosses while the scope farms in this mode.
      const target = v.store.achievementTarget as { avoid?: string[] } | null;
      return { avoid: v.scope.targetMode === MODE ? target?.avoid ?? [] : [] };
    },
    'target.settings'(view, settings) {
      const v = view as FarmingView & { body: Record<string, unknown> };
      initialStore(v.store);
      const body = v.body, ids = known(v.scope, settings);
      if (body.action === 'available') {
        const owner = v.scope.statuses[v.owner] as Parameters<typeof fresh>[0];
        if (!fresh(owner, v.now)) return { ok: false, status: 409, error: 'the character must be online' };
        return (v.store.achievementHunt as AchievementHuntSettings).monsters.length ? { ok: true, reply: {} }
          : { ok: false, status: 409, error: 'choose at least one monster for Achievement Hunt' };
      }
      if (body.settings !== undefined) {
        if (!validAchievementHuntSettings(body.settings)) return { ok: false, status: 400, error: 'Invalid Achievement Hunt settings' };
        const patch = body.settings as Partial<AchievementHuntSettings>;
        if (patch.monsters?.some(id => !ids.has(id))) return { ok: false, status: 400, error: 'Unknown monster, or one Achievement Hunt cannot target' };
        const current = v.store.achievementHunt as AchievementHuntSettings;
        v.store.achievementHunt = { ...current, ...patch, monsters: patch.monsters ? [...new Set(patch.monsters)] : current.monsters };
        hunts.get(v.owner)?.hunt.reset();
      }
      if (body.blacklist !== undefined) {
        const change = (body.blacklist ?? {}) as { action?: unknown; monsterId?: unknown }, id = String(change.monsterId ?? '');
        const blacklist = v.store.achievementBlacklist as Record<string, unknown>;
        if (change.action === 'clear') v.store.achievementBlacklist = {};
        else if (change.action === 'remove' && id) delete blacklist[id];
        // The next tick moves on from a blacklisted target and restores its priorities.
        else if (change.action === 'add' && ids.has(id)) blacklist[id] = { monsterId: id, at: v.now, reason: 'Manually blacklisted' };
        else return { ok: false, status: 400, error: 'Invalid blacklist change' };
      }
      v.ports.persist();
      return { ok: true, reply: reply(v.store) };
    },
    // `addon.off`: each scope the hunt ran for goes back to Farming in its combat mode, with the
    // priorities and rare rules the target changed put back. The characters hold no hunt, so the
    // notice changes nothing there.
    'addon.off'() { for (const { hunt } of hunts.values()) hunt.leave(); hunts.clear(); },
    'step.safety'(view, to) { return zoneRefusal(view as ZoneView, avoidList(), to); },
    // Targeting asks each candidate inside its eligibility check. The view carries the character,
    // the entities in view and the party; with no avoid list it answers nothing, which keeps every
    // candidate.
    'targeting.candidates'(view) {
      const avoid = avoidList();
      if (!avoid.length) return undefined;
      // `event` is the event the character joined or fights, whose own boss it may fight.
      const v = view as { candidates: ViewEntity[]; event?: string | null; character: ZoneView['character'] & { target?: string | null; range?: number };
        entities: ZoneView['entities']; party: string[] };
      const zone = { character: v.character, entities: v.entities, joinedEvent: v.event ?? null };
      return v.candidates.filter(c => !pullRefusal(zone, avoid, c, v.party));
    },
    // `farming` (56): the target mode's own move, above the formation and below every task.
    'movement.request': [{ name: 'boss-retreat', tier: 'farming', answer(view) { return retreatAnswer(view as MoverView & ZoneView, avoidList()); } }],
    // Every sighting of the avoid list goes: the list holds the target's bosses on its ground.
    'status.report'(view) {
      const avoid = avoidList();
      return avoid.length ? { sightings: sightings(view as ZoneView, avoid) } : undefined;
    },
  },
};
