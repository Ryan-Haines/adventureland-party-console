"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useAddonSlots } from "../../../runtime/hooks/dashboard/slots";
import { defaultLists, reflectChoices } from "../../../runtime/hooks/addon-api.ts";
import { MonsterListPicker, type PickableMonster } from "./monster-list-picker";
import { useSettingsWrite } from "./settings-write";

// A character's Combat section in the settings menu, which holds what was on the card face:
// "Heal first below" (04), the HP and MP potion lines (05), the two reflect lists (04) and the
// add-on routine picks. Each is its owner's declared per-character setting, written through the
// settings owner's settings route with the page's basis; an empty box shows the owner's own
// default, which the owner applies when the character has no entry. Each line's words are its
// owner's declared label, from the settings owner's settings read.
const LINES = [
  { field: 'healFirstBelow', fighters: true },
  { field: 'hpPotionBelow', fighters: false },
  { field: 'mpPotionBelow', fighters: false },
] as const;
// Each reflect list offers the monsters the targeting owner's `targeting.reflectChoices` read picks
// from the catalog's definitions, the same answer its saved-value check holds a write to. A
// character with no entry plays the owner's default list, which the picker shows marked as the
// default.
const LISTS = [
  { field: 'reflectMagicByCharacter', list: 'magic', defaults: defaultLists.magic },
  { field: 'reflectPhysicalByCharacter', list: 'physical', defaults: defaultLists.physical },
] as const;
export type RatedMonster = PickableMonster & { definition?: Record<string, unknown> };
// The routine slots an enabled add-on can fill for a class. The built-in entry is listed first
// and is each character's default. A merchant gets no formation line, since it stands outside the
// grouped fight, and only the merchant gets the merchant routine line.
const ROUTINE_SLOTS = [
  { slot: 'combat-routine', label: 'Combat routine', for: 'all' },
  { slot: 'formation', label: 'Formation', for: 'fighters' },
  { slot: 'merchant-routine', label: 'Merchant routine', for: 'merchant' },
] as const;

export function CombatSettingsSection({ character, ctype, monsters }: { character: string; ctype: string; monsters: readonly RatedMonster[] }) {
  const settings = useSettingsWrite();
  const { slots } = useAddonSlots();
  const merchant = ctype === 'merchant';
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState('');
  const choices = reflectChoices(Object.fromEntries(monsters.map(monster => [monster.id, monster.definition])));
  // Until the settings owner's read arrives the fieldset stays locked and a line shows its field name.
  const label = (field: string) => settings.declared(field)?.label ?? field;
  const entry = (field: string) => (settings.value(field) as Record<string, unknown> | undefined)?.[character];
  // A box saves once, when it commits (blur or Enter); the settings owner's check refuses a value out of range.
  const commit = async (field: string) => {
    if (!(field in drafts)) return;
    const draft = drafts[field]!.trim();
    // An emptied line sends null, which the settings owner's writer takes as removal of the character's entry.
    const value = draft ? Number(draft) : null;
    // A box that holds text which is not a number keeps it and says so; nothing is written.
    if (value !== null && !Number.isFinite(value)) return setRefusal(`"${draft}" is not a number.`);
    setRefusal('');
    setDrafts(current => { const next = { ...current }; delete next[field]; return next; });
    await settings.write([{ field, character, value }]);
  };
  const saved = (field: string) => { const value = entry(field); return typeof value === 'number' ? String(value) : ''; };
  const picks = ((settings.value('routines') as Record<string, Record<string, string>> | undefined)?.[character]) ?? {};
  // A routine line shows only when an enabled add-on fills its slot for this class, so the section
  // matches the console without add-ons.
  const routines = ROUTINE_SLOTS.filter(line => line.for === 'all' || (line.for === 'merchant') === merchant).map(({ slot, label }) => ({ slot, label,
    entries: (slots[slot] ?? []).filter(entry => !entry.classes || entry.classes.includes(ctype)) }))
    .filter(line => line.entries.some(entry => !entry.addon.startsWith('core:')));
  return (
    <section data-area="combat-settings" data-addon-slot="combat-routine formation merchant-routine">
    <fieldset disabled={!settings.ready || settings.pending} aria-busy={!settings.ready} className="grid gap-4 sm:grid-cols-3">
      {LINES.filter(line => !merchant || !line.fighters).map(line => (
        <label key={line.field} className="grid gap-1 text-xs">
          {label(line.field)}
          <Input value={drafts[line.field] ?? saved(line.field)} placeholder="default" inputMode="numeric"
            aria-label={`${label(line.field)} for ${character}`}
            onChange={event => setDrafts(current => ({ ...current, [line.field]: event.target.value }))}
            onBlur={() => void commit(line.field)}
            onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            className="h-8 border-slate-600 bg-slate-950 font-mono text-xs" />
        </label>
      ))}
      {!merchant && LISTS.map(({ field, list, defaults }) => {
        const saved = entry(field) as string[] | undefined;
        return <div key={field} className="sm:col-span-3">
          <MonsterListPicker label={label(field)} monsters={monsters.filter(monster => choices[list].includes(monster.id))}
            value={saved ?? defaults} note={saved ? undefined : 'default'}
            onChange={next => void settings.write([{ field, character, value: next }])} />
        </div>;
      })}
      {routines.map(({ slot, label, entries }) => (
        <label key={slot} className="grid gap-1 text-xs">
          {label}
          <select aria-label={`${label} for ${character}`} value={picks[slot] ?? entries[0]!.mode}
            onChange={event => void settings.write([{ field: 'routines', character, value: { ...picks, [slot]: event.target.value } }])}
            className="h-8 rounded-md border border-slate-600 bg-slate-950 px-2 text-xs">
            {entries.map(entry => <option key={entry.mode} value={entry.mode} title={entry.button.description}>{entry.button.label}</option>)}
          </select>
        </label>
      ))}
      {refusal || settings.notice ? <p role="alert" className="text-xs text-amber-200 sm:col-span-3">{refusal || settings.notice}</p> : null}
    </fieldset>
    </section>
  );
}
