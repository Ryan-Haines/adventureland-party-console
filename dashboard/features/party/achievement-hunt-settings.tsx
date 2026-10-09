'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { achievementMonsters, nextStep, type AchievementMonster } from '../../../runtime/hunt/achievement-policy';
import {
  defaultAchievementHuntSettings,
  type AchievementBlacklistEntry,
  type AchievementHuntSettings,
} from '../../../runtime/coordinator/hunt/achievement-settings';
import { CenteredMonsterSprite } from './centered-monster-sprite';
import { ItemSprite } from './item-sprite';
import type { MonsterChoice } from './monster-choice';
import type { PartyState } from './party-state';

// The coordinator rejects these as targets (runtime/coordinator/application.ts).
const untargetable = new Set(['phoenix', 'tinyp']);

export type AchievementBlacklistChange = { action: 'remove' | 'clear'; monsterId?: string };

function progress(monster: AchievementMonster, kills: number): string {
  const step = nextStep(monster.ladder, kills);
  return step < 0
    ? `${Math.floor(kills).toLocaleString()} kills · complete`
    : `${Math.floor(kills).toLocaleString()} / ${monster.ladder[step]!.toLocaleString()} · step ${step + 1}`;
}

/** Achievement Hunt settings for one farming scope, shown in the Farming settings dialog. */
export function AchievementHuntSettingsControl({
  value, blacklist, kills, bestiary, choices, catalog, onSave, onBlacklist, onInspectMonster, renderMonsterDetails,
}: {
  value?: AchievementHuntSettings;
  blacklist: Record<string, AchievementBlacklistEntry>;
  kills: Record<string, number>;
  bestiary: PartyState['bestiaryCatalog'];
  choices: PartyState['monsterChoices'];
  catalog: MonsterChoice[];
  onSave?: (patch: Partial<AchievementHuntSettings>) => Promise<void>;
  onBlacklist?: (change: AchievementBlacklistChange) => Promise<void>;
  onInspectMonster?: (id: string) => void;
  renderMonsterDetails?: (id: string, onClose: () => void) => ReactNode;
}) {
  const settings = { ...defaultAchievementHuntSettings, ...value };
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [deaths, setDeaths] = useState(String(settings.deathThreshold));
  const [open, setOpen] = useState(false), [inspected, setInspected] = useState<string | null>(null);
  useEffect(() => setDeaths(String(settings.deathThreshold)), [settings.deathThreshold]);
  const monsters = useMemo(
    () => achievementMonsters(bestiary as never, choices as never).filter((m) => !untargetable.has(m.id)),
    [bestiary, choices],
  );
  const regular = monsters.filter((m) => !m.special), special = monsters.filter((m) => m.special);
  const selected = new Set(settings.monsters);
  const sprite = (id: string) => catalog.find((m) => m.id === id)?.sprite;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save Achievement Hunt settings'); }
    finally { setBusy(false); }
  }
  const save = (patch: Partial<AchievementHuntSettings>) => onSave && run(() => onSave(patch));
  const choose = (ids: string[]) => save({ monsters: ids });
  const toggle = (id: string) => choose(selected.has(id) ? settings.monsters.filter((x) => x !== id) : [...settings.monsters, id]);
  // Every regular monster from the weakest through this one; special picks are kept.
  const upTo = (index: number) => choose([...regular.slice(0, index + 1).map((m) => m.id), ...special.filter((m) => selected.has(m.id)).map((m) => m.id)]);
  function threshold() {
    const n = Number(deaths);
    if (!deaths.trim() || !Number.isSafeInteger(n) || n < 1 || n > 100) {
      setError('The death threshold must be a whole number from 1 to 100.');
      return;
    }
    if (n !== settings.deathThreshold) void save({ deathThreshold: n });
  }
  const checkbox = 'border-cyan-400 bg-[#07110f] text-white data-checked:bg-cyan-700';
  const input = 'w-16 rounded border border-cyan-700 bg-[#07110f] px-2 py-1 text-emerald-50 disabled:border-slate-600 disabled:text-slate-400';
  const control = 'border border-emerald-600 bg-[#07110f] text-emerald-100 hover:border-emerald-300 hover:bg-emerald-950 hover:text-white';
  const row = (monster: AchievementMonster, index: number | null) => (
    <div key={monster.id} className="flex items-center gap-3 rounded border border-emerald-800 bg-[#07110f] p-2">
      <Checkbox className={checkbox} aria-label={`Farm ${monster.name} for achievements`} checked={selected.has(monster.id)}
        disabled={busy || !onSave} onCheckedChange={() => void toggle(monster.id)} />
      <button type="button" aria-label={`Inspect ${monster.name}`} onClick={() => setInspected(monster.id)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded border border-transparent bg-[#07110f] p-1 text-left text-emerald-50 hover:border-cyan-600 hover:bg-emerald-950 hover:text-white">
        {sprite(monster.id) && <span className="pointer-events-none relative h-10 w-10 shrink-0 overflow-hidden"><CenteredMonsterSprite sprite={sprite(monster.id)!} /></span>}
        <span className="min-w-0">
          {monster.name}
          <span className="block text-xs text-emerald-200">
            {progress(monster, Number(kills[monster.id]) || 0)}{blacklist[monster.id] ? ' · blacklisted' : ''}
          </span>
        </span>
      </button>
      {index !== null && <Button size="sm" className={control} disabled={busy || !onSave} onClick={() => void upTo(index)}>Up to here</Button>}
    </div>
  );
  return (
    <section aria-label="Achievement Hunt settings" className="space-y-3 rounded border border-emerald-700 bg-[#07110f] p-3">
      <div className="flex items-center gap-3">
        <h3 className="flex-1 font-semibold text-emerald-50">Achievement Hunt</h3>
        <Button type="button" size="sm" className={control} onClick={() => { setError(''); setOpen(true); }}>
          Monsters ({selected.size})
        </Button>
      </div>
      <p className="text-xs text-emerald-200">
        Farms the selected monsters for their kill achievements, weakest first. Every selected monster reaches its next
        milestone before any moves on to the one after.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm text-emerald-50">
        <label className="flex items-center gap-3">
          <Checkbox className={checkbox} checked={settings.blacklistDeaths} disabled={busy || !onSave}
            onCheckedChange={(v) => void save({ blacklistDeaths: !!v })} />
          Blacklist monsters after
        </label>
        <input aria-label="Achievement Hunt deaths before blacklisting" className={input} type="number" min="1" max="100" step="1"
          value={deaths} disabled={busy || !onSave || !settings.blacklistDeaths}
          onChange={(e) => setDeaths(e.target.value)} onBlur={threshold}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        <span>deaths</span>
      </div>
      <label className="flex items-center gap-3 text-sm text-emerald-50">
        <Checkbox className={checkbox} checked={settings.fillIdle} disabled={busy || !onSave}
          onCheckedChange={(v) => void save({ fillIdle: !!v })} />
        Fill respawn waits with nearby monsters
      </label>
      <p className="text-xs text-emerald-200">
        While the target respawns, the party fights weaker monsters that spawn within its search radius. The target always
        comes first.
      </p>
      {Object.keys(blacklist).length > 0 && (
        <div aria-label="Achievement Hunt blacklist" className="space-y-2">
          <div className="flex items-center gap-3">
            <p className="flex-1 text-sm text-emerald-50">Blacklisted</p>
            <Button type="button" size="sm" disabled={busy || !onBlacklist} onClick={() => onBlacklist && void run(() => onBlacklist({ action: 'clear' }))}
              className="border border-rose-700 bg-[#301219] text-rose-100 hover:bg-rose-950 hover:text-white">Clear all</Button>
          </div>
          {Object.values(blacklist).sort((a, b) => a.monsterId.localeCompare(b.monsterId)).map((entry) => {
            const monster = monsters.find((m) => m.id === entry.monsterId), image = sprite(entry.monsterId);
            return (
              <div key={entry.monsterId} className="flex items-center gap-3 rounded border border-emerald-800 bg-[#07110f] p-3">
                <button type="button" aria-label={`Inspect ${monster?.name || entry.monsterId}`} onClick={() => onInspectMonster?.(entry.monsterId)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded border border-transparent bg-[#07110f] text-left text-emerald-50 hover:border-cyan-600 hover:bg-emerald-950 hover:text-white">
                  <span className="relative h-10 w-10 shrink-0">{image && <ItemSprite sprite={image} />}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-emerald-50">{monster?.name || entry.monsterId}</p>
                    <p className="text-xs text-emerald-200">{entry.reason} · {new Date(entry.at).toLocaleString()}</p>
                  </div>
                </button>
                <Button type="button" disabled={busy || !onBlacklist} onClick={() => onBlacklist && void run(() => onBlacklist({ action: 'remove', monsterId: entry.monsterId }))}
                  className="border border-cyan-700 bg-black text-cyan-100 hover:bg-cyan-950">Clear</Button>
              </div>
            );
          })}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
      <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setInspected(null); }}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden border-emerald-700 bg-[#081713] text-emerald-50 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Achievement Hunt monsters</DialogTitle>
            <DialogDescription className="text-emerald-100/80">
              Weakest first, by experience per kill. Up to here selects every monster above it. Click a monster for details.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button size="sm" className={control} disabled={busy || !onSave} onClick={() => void choose(regular.map((m) => m.id))}>All regular</Button>
            <Button size="sm" className={control} disabled={busy || !onSave} onClick={() => void choose([])}>None</Button>
          </div>
          <div className="min-h-0 space-y-2 overflow-y-auto overscroll-contain">
            <section aria-label="Regular monsters" className="space-y-2">{regular.map((m, i) => row(m, i))}</section>
            <h3 className="pt-2 font-semibold text-emerald-50">Special monsters</h3>
            <p className="text-xs text-emerald-200">
              Bosses and boss-like monsters, event, cooperative and random-respawn monsters, training dummies, Cave of Many
              Dreams monsters, and any without a regular spawn. Up to here never selects them.
            </p>
            <section aria-label="Special monsters" className="space-y-2">{special.map((m) => row(m, null))}</section>
          </div>
          {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
          {inspected && renderMonsterDetails?.(inspected, () => setInspected(null))}
        </DialogContent>
      </Dialog>
    </section>
  );
}
