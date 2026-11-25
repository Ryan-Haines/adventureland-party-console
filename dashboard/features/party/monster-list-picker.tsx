"use client";
// A list of monsters picked from the game's monster list: each pick shows as a chip with its
// sprite and a remove button, and the Add dropdown searches every monster not yet picked. A
// change saves the whole list through `onChange`.
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CenteredMonsterSprite } from "./centered-monster-sprite";
import type { Sprite } from "./sprite";

export interface PickableMonster { id: string; name: string; sprite?: Sprite | null }

// `note` marks a list the character has not saved, such as the owner's default.
export function MonsterListPicker({ label, monsters, value, note, disabled, onChange }: {
  label: string; monsters: readonly PickableMonster[]; value: readonly string[]; note?: string; disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const byId = new Map(monsters.map(monster => [monster.id, monster]));
  const query = search.trim().toLowerCase();
  const rows = monsters.filter(monster => !value.includes(monster.id) && `${monster.name} ${monster.id}`.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return (
    <fieldset aria-label={label} className="grid gap-1 text-xs">
      <legend className="mb-1">{label}{note ? <span className="ml-2 text-slate-400">({note})</span> : null}</legend>
      <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-slate-600 bg-slate-950 p-1">
        {value.map(id => {
          const monster = byId.get(id);
          return <span key={id} className="flex items-center gap-1 rounded border border-slate-600 bg-[#10201b] py-0.5 pl-1 pr-0.5 text-slate-100">
            {monster?.sprite ? <span className="pointer-events-none relative size-5 shrink-0 overflow-hidden"><CenteredMonsterSprite sprite={monster.sprite} /></span> : null}
            {monster?.name ?? id}
            <button type="button" aria-label={`Remove ${monster?.name ?? id} from ${label}`} disabled={disabled}
              onClick={() => onChange(value.filter(entry => entry !== id))}
              className="rounded p-0.5 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50"><X className="size-3" /></button>
          </span>;
        })}
        {!value.length ? <span className="px-1 text-slate-400">none</span> : null}
        <Popover onOpenChange={open => { if (!open) setSearch(""); }}>
          <PopoverTrigger disabled={disabled} aria-label={`Add a monster to ${label}`}
            className="ml-auto flex items-center gap-1 rounded border border-slate-600 bg-[#10201b] px-1.5 py-0.5 text-slate-100 hover:bg-slate-800 disabled:opacity-50">
            <Plus className="size-3" />Add
          </PopoverTrigger>
          <PopoverContent data-area="monster-list-picker" align="end" className="flex max-h-80 w-72 flex-col border border-slate-600 bg-[#101c1a] p-2 text-xs text-emerald-50">
            <input aria-label={`Search monsters for ${label}`} placeholder="Search monsters…" value={search} onChange={event => setSearch(event.target.value)}
              className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-emerald-50 placeholder:text-slate-400" />
            <div role="group" aria-label={`Monsters for ${label}`} className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {rows.map(monster => (
                <button key={monster.id} type="button" aria-label={`Add ${monster.name} to ${label}`}
                  onClick={() => onChange([...value, monster.id])}
                  className="flex w-full items-center gap-2 rounded border border-transparent px-1 py-0.5 text-left hover:border-cyan-600 hover:bg-slate-900">
                  {monster.sprite ? <span className="pointer-events-none relative size-6 shrink-0 overflow-hidden"><CenteredMonsterSprite sprite={monster.sprite} /></span> : <span className="size-6 shrink-0" />}
                  <span>{monster.name}<span className="block text-[10px] text-slate-400">{monster.id}</span></span>
                </button>
              ))}
              {!rows.length ? <p className="p-1 text-slate-300">No matching monsters.</p> : null}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </fieldset>
  );
}
