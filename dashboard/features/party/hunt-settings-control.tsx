'use client';
import { useEffect, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  defaultHuntSettings,
  type HuntSettings,
} from '../../../runtime/coordinator/hunt/settings';

export function HuntSettingsControl({
  value,
  onSave,
}: {
  value?: HuntSettings;
  onSave?: (patch: Partial<HuntSettings>) => Promise<void>;
}) {
  const settings = { ...defaultHuntSettings, ...value };
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [deaths, setDeaths] = useState(String(settings.deathThreshold));
  const [expirations, setExpirations] = useState(
    String(settings.expirationThreshold),
  );
  useEffect(() => {
    setDeaths(String(settings.deathThreshold));
    setExpirations(String(settings.expirationThreshold));
  }, [settings.deathThreshold, settings.expirationThreshold]);
  async function save(patch: Partial<HuntSettings>) {
    if (!onSave) return;
    setBusy(true);
    setError('');
    try {
      await onSave(patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save Hunt settings');
    } finally {
      setBusy(false);
    }
  }
  function threshold(
    key: 'deathThreshold' | 'expirationThreshold',
    text: string,
  ) {
    const n = Number(text);
    if (!text.trim() || !Number.isSafeInteger(n) || n < 1) {
      setError('Thresholds must be positive whole numbers.');
      return;
    }
    if (n !== settings[key]) void save({ [key]: n });
  }
  const checkbox =
    'border-cyan-400 bg-[#07110f] text-white data-checked:bg-cyan-700';
  const input =
    'w-16 rounded border border-cyan-700 bg-[#07110f] px-2 py-1 text-emerald-50 disabled:border-slate-600 disabled:text-slate-400';
  return (
    <section className="space-y-3 rounded border border-emerald-700 bg-[#07110f] p-3">
      <h3 className="font-semibold text-emerald-50">Hunt settings</h3>
      <label className="flex items-center gap-3 text-sm text-emerald-50">
        <Checkbox
          className={checkbox}
          checked={settings.relocateIfCompeting}
          disabled={busy || !onSave}
          onCheckedChange={(v) => void save({ relocateIfCompeting: !!v })}
        />
        Relocate to different spawn if competing
      </label>
      <p className="text-xs text-emerald-200">
        Relocate only when everyone’s hunt radius is empty and a competing
        farmer is nearby.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm text-emerald-50">
        <label className="flex items-center gap-3">
          <Checkbox
            className={checkbox}
            checked={settings.blacklistDeaths}
            disabled={busy || !onSave}
            onCheckedChange={(v) => void save({ blacklistDeaths: !!v })}
          />
          Blacklist hunts after
        </label>
        <input
          aria-label="Deaths before blacklisting"
          className={input}
          type="number"
          min="1"
          step="1"
          value={deaths}
          disabled={busy || !onSave || !settings.blacklistDeaths}
          onChange={(e) => setDeaths(e.target.value)}
          onBlur={() => threshold('deathThreshold', deaths)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <span>deaths</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-emerald-50">
        <label className="flex items-center gap-3">
          <Checkbox
            className={checkbox}
            checked={settings.blacklistExpirations}
            disabled={busy || !onSave}
            onCheckedChange={(v) => void save({ blacklistExpirations: !!v })}
          />
          Blacklist hunts after
        </label>
        <input
          aria-label="Expired hunts before blacklisting"
          className={input}
          type="number"
          min="1"
          step="1"
          value={expirations}
          disabled={busy || !onSave || !settings.blacklistExpirations}
          onChange={(e) => setExpirations(e.target.value)}
          onBlur={() => threshold('expirationThreshold', expirations)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <span>hunts expire</span>
      </div>
      <p className="text-xs text-emerald-200">
        Failures accumulate per monster across Hunts. Clearing its blacklist
        entry resets its counts. Turning a rule off keeps counts and existing
        blacklist entries.
      </p>
      {error && (
        <p role="alert" className="text-sm text-rose-200">
          {error}
        </p>
      )}
    </section>
  );
}
