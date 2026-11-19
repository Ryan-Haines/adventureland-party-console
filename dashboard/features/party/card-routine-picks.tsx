"use client";
import { useAddonSlots } from "../../../runtime/hooks/dashboard/slots";
import { useSettingsWrite } from "./settings-write";

// The character card's routine picks: one line per routine slot that an
// enabled add-on fills for this character's class. The built-in entry is listed first and is each
// character's default. With no add-on entry for the class the card draws nothing, so the card
// matches the console without add-ons. The pick saves in `routines` through the settings owner's settings route.
// A merchant gets no formation line, since it stands outside the grouped fight, and only the
// merchant gets the merchant routine line.
const ROUTINE_SLOTS = [
  { slot: 'combat-routine', label: 'Combat routine', for: 'all' },
  { slot: 'formation', label: 'Formation', for: 'fighters' },
  { slot: 'merchant-routine', label: 'Merchant routine', for: 'merchant' },
] as const;

export function CardRoutinePicks({ character, ctype }: { character: string; ctype: string }) {
  const { slots } = useAddonSlots();
  const settings = useSettingsWrite();
  const picks = ((settings.value('routines') as Record<string, Record<string, string>> | undefined)?.[character]) ?? {};
  const lines = ROUTINE_SLOTS.filter(line => line.for === 'all' || (line.for === 'merchant') === (ctype === 'merchant')).map(({ slot, label }) => ({ slot, label,
    entries: (slots[slot] ?? []).filter(entry => !entry.classes || entry.classes.includes(ctype)) }))
    .filter(line => line.entries.some(entry => !entry.addon.startsWith('core:')));
  if (!lines.length) return null;
  const pick = (slot: string, mode: string) => {
    const next = { ...picks, [slot]: mode };
    void settings.write([{ field: 'routines', character, value: next }]);
  };
  return (
    <fieldset disabled={!settings.ready || settings.pending} data-addon-slot="combat-routine formation merchant-routine" className="mt-2 grid gap-2 sm:grid-cols-3">
      {lines.map(({ slot, label, entries }) => (
        <label key={slot} className="grid gap-1 text-xs">
          {label}
          <select aria-label={`${label} for ${character}`} value={picks[slot] ?? entries[0]!.mode}
            onChange={event => pick(slot, event.target.value)}
            className="h-8 rounded-md border border-slate-600 bg-slate-950 px-2 text-xs">
            {entries.map(entry => <option key={entry.mode} value={entry.mode} title={entry.button.description}>{entry.button.label}</option>)}
          </select>
        </label>
      ))}
    </fieldset>
  );
}
