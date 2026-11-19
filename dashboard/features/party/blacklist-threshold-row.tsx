'use client';
import { Checkbox } from '@/components/ui/checkbox';

// A blacklist rule's row: its switch, then its count, saved on blur or Enter. The hunt settings
// (hunt-settings-control.tsx) draw their two rules with it, and the add-on kit publishes it for an
// add-on's own rule.
export function BlacklistThresholdRow({ label, inputLabel, unit, checked, value, min, max, disabled, onToggle, onDraft, onCommit }: {
  label: string; inputLabel: string; unit: string; checked: boolean; value: string; min: number; max?: number; disabled: boolean;
  onToggle(on: boolean): void; onDraft(value: string): void; onCommit(): void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-emerald-50">
      <label className="flex items-center gap-3">
        <Checkbox
          className="border-cyan-400 bg-[#07110f] text-white data-checked:bg-cyan-700"
          checked={checked}
          disabled={disabled}
          onCheckedChange={(v) => onToggle(!!v)}
        />
        {label}
      </label>
      <input
        aria-label={inputLabel}
        className="w-16 rounded border border-cyan-700 bg-[#07110f] px-2 py-1 text-emerald-50 disabled:border-slate-600 disabled:text-slate-400"
        type="number"
        min={min}
        max={max}
        step="1"
        value={value}
        disabled={disabled || !checked}
        onChange={(e) => onDraft(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <span>{unit}</span>
    </div>
  );
}
