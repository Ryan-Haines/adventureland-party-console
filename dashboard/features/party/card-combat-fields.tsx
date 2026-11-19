"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useSettingsWrite } from "./settings-write";

// The character card's combat lines: "Heal first below", the
// HP and MP potion lines (05) and the two reflect lists (04). Each is its owner's declared
// per-character setting, written through the settings owner's settings route with the page's basis; an empty box
// shows the owner's own default, which the owner applies when the character has no entry. Each
// line's words are its owner's declared label, from the settings owner's settings read.
const LINES = [
  { field: 'healFirstBelow', fighters: true },
  { field: 'hpPotionBelow', fighters: false },
  { field: 'mpPotionBelow', fighters: false },
] as const;
const LISTS = ['reflectMagicByCharacter', 'reflectPhysicalByCharacter'] as const;

export function CardCombatFields({ character, merchant }: { character: string; merchant: boolean }) {
  const settings = useSettingsWrite();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState('');
  // Until the settings owner's read arrives the fieldset stays locked and a line shows its field name.
  const label = (field: string) => settings.declared(field)?.label ?? field;
  const entry = (field: string) => (settings.value(field) as Record<string, unknown> | undefined)?.[character];
  const shown = (field: string, saved: unknown) => drafts[field] ?? (saved === undefined ? '' : Array.isArray(saved) ? saved.join(', ') : String(saved));
  // A box saves once, when it commits (blur or Enter); the settings owner's check refuses a value out of range.
  const commit = async (field: string, list: boolean) => {
    if (!(field in drafts)) return;
    const draft = drafts[field]!.trim();
    // An emptied line sends null, which the settings owner's writer takes as removal of the character's entry.
    const value = list ? draft.split(/[\s,]+/).filter(Boolean) : draft ? Number(draft) : null;
    // A box that holds text which is not a number keeps it and says so; nothing is written.
    if (value !== null && !list && !Number.isFinite(value)) return setRefusal(`"${draft}" is not a number.`);
    setRefusal('');
    setDrafts(current => { const next = { ...current }; delete next[field]; return next; });
    await settings.write([{ field, character, value }]);
  };
  const box = (field: string, label: string, list: boolean) => (
    <label key={field} className="grid gap-1 text-xs">
      {label}
      <Input value={shown(field, entry(field))} placeholder={list ? 'none' : 'default'} inputMode={list ? 'text' : 'numeric'}
        aria-label={`${label} for ${character}`}
        onChange={event => setDrafts(current => ({ ...current, [field]: event.target.value }))}
        onBlur={() => void commit(field, list)}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        className="h-8 border-slate-600 bg-slate-950 font-mono text-xs" />
    </label>
  );
  return (
    <fieldset disabled={!settings.ready || settings.pending} aria-busy={!settings.ready} className="mt-2 grid gap-2 sm:grid-cols-3">
      {LINES.filter(line => !merchant || !line.fighters).map(line => box(line.field, label(line.field), false))}
      {!merchant && LISTS.map(field => box(field, label(field) + ' (monster ids)', true))}
      {refusal || settings.notice ? <p role="alert" className="text-xs text-amber-200 sm:col-span-3">{refusal || settings.notice}</p> : null}
    </fieldset>
  );
}
