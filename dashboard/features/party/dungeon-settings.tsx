'use client';
import { AddonSlot } from '../../../runtime/hooks/dashboard/slots';
import { Settings } from 'lucide-react';
import { useEffect } from 'react';
import { useClock } from '@/hooks/use-clock';
import { dungeonEntryLabel, useDungeons } from './dungeon-query';

export const dungeonButton =
  'rounded border border-slate-500 bg-slate-950 px-3 py-2 text-emerald-50 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-50';
// The Events list's Cave row; its gear opens the Cave section of the Events tab.
export function CaveEventRow({ onSettings }: { onSettings: () => void }) {
  const query = useDungeons(),
    now = useClock(),
    view = query.data;
  return (
    <div className="flex items-center gap-2 border-b border-slate-600 py-2">
      <span>Cave of Many Dreams — {dungeonEntryLabel(view, now)}</span>
      <button type="button" aria-label="Cave of Many Dreams settings" onClick={onSettings} className={dungeonButton + ' ml-auto'}>
        <Settings className="size-4" />
      </button>
    </div>
  );
}

// The Events tab's Cave section, which was the Cave dialog: manual entry, event protection and
// what the party does after a run. The party entering the Cave closes the menu (`onActive`), as it
// closed the dialog, so the Cave panel's native choices show.
export function CaveSettings({ onActive }: { onActive: () => void }) {
  const query = useDungeons(),
    now = useClock(),
    view = query.data;
  const active = view?.state.phase === 'active';
  useEffect(() => { if (active) onActive(); }, [active, onActive]);
  const resume = view?.members[0]?.observation?.visit?.resume;
  // The hunting owner's entry checks answer whether the party may enter (DungeonView.entryRefusal).
  const eligible = !!view && view.entryRefusal === null;
  return (
    <section data-area="cave-settings" aria-label="Cave of Many Dreams" className="grid gap-4 rounded border border-slate-500 bg-[#101c1a] p-4 text-emerald-50">
      <div>
        <h3 className="font-semibold">Cave of Many Dreams</h3>
        <p className="text-slate-300">Manual entry and event protection</p>
      </div>
      <p>{dungeonEntryLabel(view, now)}</p>
      {resume && (
        <p>Resume on {resume.server}. Realm changes are manual.</p>
      )}
      <p>
        Participants:{' '}
        {view?.members
          .map((m) => m.name + (m.fresh ? '' : ' (offline)'))
          .join(', ') || 'Select a leader and combat followers'}
        .
      </p>
      {view?.members.filter((m) => m.observation?.visitError).map((m) => (
        <p key={m.name} className="text-amber-200">
          {m.name}: eligibility check failed ({m.observation?.visitError}); retrying.
        </p>
      ))}
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 accent-emerald-500"
          checked={view?.state.protectFromEvents !== false}
          disabled={!view || query.busy}
          onChange={(e) =>
            void query.action({
              action: 'settings',
              protectFromEvents: e.target.checked,
            })
          }
        />
        Don’t leave the Cave of Many Dreams for other events
      </label>
      <p className="text-sm text-slate-300">
        Disabling this allows enabled events, including Anniversary, to end
        your visit. You may not be able to enter again until the daily
        reset.
      </p>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 accent-emerald-500"
          checked={view?.state.afterRun === 'stay'}
          disabled={!view || query.busy}
          onChange={(e) =>
            void query.action({
              action: 'settings',
              afterRun: e.target.checked ? 'stay' : 'go-back',
            })
          }
        />
        After a run, stay outside until I press Release
      </label>
      <p className="text-sm text-slate-300">
        Off: once everyone is out, the party goes back to its task on its
        own. Escape, death handling and respawn run outside either way.
      </p>
      <button
        className={dungeonButton}
        disabled={
          !eligible ||
          query.busy ||
          (!!view && !['idle', 'held'].includes(view.state.phase))
        }
        onClick={() =>
          void query.action({ action: resume ? 'resume' : 'enter' })
        }
      >
        {resume ? 'Resume visit' : 'Enter now'}
      </button>
      {view?.state.phase === 'held' && (
        <button
          className={dungeonButton}
          disabled={query.busy}
          onClick={() => void query.action({ action: 'release' })}
        >
          Release
        </button>
      )}
      {!eligible && (
        <p className="text-amber-200">
          Entry needs fresh eligible characters: a leader and at most two
          combat followers, excluding the merchant.
        </p>
      )}
      {(query.actionError || query.error || view?.state.error) && (
        <p role="alert" className="text-rose-200">
          {query.actionError || query.error?.message || view?.state.error}
        </p>
      )}
      <AddonSlot name="dialog-section" part="cave-settings" />
    </section>
  );
}
