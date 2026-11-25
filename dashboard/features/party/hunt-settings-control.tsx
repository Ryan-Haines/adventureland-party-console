'use client';
import { useEffect, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { BlacklistThresholdRow } from './blacklist-threshold-row';
import {
  defaultHuntSettings,
  validHuntSettings,
  type HuntSettings,
} from '../../../runtime/hunting/saved-fields';

// The root relocation switch: one for the whole party, read in every target mode, so every card writes it
// through the settings route, a follower's included.
export function RelocationControl({
  value,
  onSave,
}: {
  value?: boolean;
  onSave: (on: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save(on: boolean) {
    setBusy(true);
    setError('');
    try {
      await onSave(on);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the relocation switch');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section data-area="hunt-settings" className="space-y-2 rounded border border-emerald-700 bg-[#07110f] p-3">
      <label className="flex items-center gap-3 text-sm text-emerald-50">
        <Checkbox
          className="border-cyan-400 bg-[#07110f] text-white data-checked:bg-cyan-700"
          checked={value !== false}
          disabled={busy}
          onCheckedChange={(v) => void save(!!v)}
        />
        Relocate to different spawn if competing
      </label>
      <p className="text-xs text-emerald-200">
        Relocate only when everyone’s search radius is empty and a competing
        farmer is nearby. The switch holds for the whole party in every mode.
      </p>
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    </section>
  );
}

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
    // The hunting owner's validHuntSettings is the threshold's one check, the same the settings route runs.
    const n = Number(text);
    if (!text.trim() || !validHuntSettings({ [key]: n })) {
      setError('Thresholds must be positive whole numbers.');
      return;
    }
    if (n !== settings[key]) void save({ [key]: n });
  }
  // A blacklist rule: its switch, then its count.
  const thresholdRow = (
    rule: 'blacklistDeaths' | 'blacklistExpirations',
    key: 'deathThreshold' | 'expirationThreshold',
    label: string,
    draft: string,
    setDraft: (value: string) => void,
    unit: string,
  ) => (
    <BlacklistThresholdRow
      label="Blacklist hunts after"
      inputLabel={label}
      unit={unit}
      checked={settings[rule]}
      value={draft}
      min={1}
      disabled={busy || !onSave}
      onToggle={(on) => void save({ [rule]: on })}
      onDraft={setDraft}
      onCommit={() => threshold(key, draft)}
    />
  );
  return (
    <section data-area="hunt-thresholds" className="space-y-3 rounded border border-emerald-700 bg-[#07110f] p-3">
      <h3 className="font-semibold text-emerald-50">Hunt settings</h3>
      {thresholdRow('blacklistDeaths', 'deathThreshold', 'Deaths before blacklisting', deaths, setDeaths, 'deaths')}
      {thresholdRow('blacklistExpirations', 'expirationThreshold', 'Expired hunts before blacklisting', expirations, setExpirations, 'hunts expire')}
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
