"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { memo, useEffect, useId, useRef, useState } from "react";
import {useStoredBoolean} from "@/hooks/use-stored-boolean";
import {CharacterSectionToggle} from "./character-section-toggle";
import {MetricsItemPicker} from "./metrics-item-picker";
import {useDomain} from "./query-cache";
import { RestockPolicy } from "./restock-policy";

const defaults: RestockPolicy = {
  hp: { min: 5, max: 20, item: "hpot1" },
  mp: { min: 0, max: 0, item: "mpot1" },
};

export const RestockControls = memo(function RestockControls({
  character,
  value,
  onSave,
}: {
  character: string;
  value?: RestockPolicy;
  onSave: (character: string, value: RestockPolicy) => Promise<void>;
}) {
  const [open,setOpen]=useStoredBoolean(`party-section:${character}:restock`,false);
  const id=useId();
  const catalog=useDomain("catalog",open);
  const elixirs=(catalog.data?.merchantCatalog?.allItems || []).filter(item=>item.meta?.definition.type === "elixir");
  function draftElixir() { return draft?.elixir || {item:"",min:1,max:2,autoConsume:true,autoAcquire:false}; }
  const [draft, setDraft] = useState<RestockPolicy>(value || defaults),
    dirty = useRef(false);
  const elixir=draftElixir();
  function updateElixir(patch: Partial<typeof elixir>) { dirty.current=true; setDraft({...draft,elixir:{...elixir,...patch}}); }
  // Character status polling returns a new policy object on every refresh.
  // Reconcile it only while the user has no unsaved local edits.
  useEffect(() => {
    if (!dirty.current) setDraft(value || defaults);
  }, [value]);
  const field = (kind: "hp" | "mp", key: "min" | "max", label: string) => (
    <label className="grid gap-1 font-mono text-[10px] uppercase text-emerald-100/45">
      {label}
      <Input
        inputMode="numeric"
        value={draft[kind][key]}
        onChange={(event) => {
          dirty.current = true;
          setDraft({
            ...draft,
            [kind]: {
              ...draft[kind],
              [key]: Number(event.target.value.replace(/[^0-9]/g, "")),
            },
          });
        }}
        className="h-8 border-emerald-900 bg-[#07100f] text-xs text-emerald-100"
      />
    </label>
  );
  return (
    <section className="mt-4 border-y border-emerald-900/70">
      <CharacterSectionToggle label="Merchant restock" open={open} controls={id} onToggle={()=>setOpen(value=>!value)}/>
      <div id={id} hidden={!open} className="pb-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] text-emerald-100/65">Potion thresholds</span>
        <Button
          aria-label="Save restock"
          size="sm"
          variant="outline"
          onClick={async () => {
            try { await onSave(character, draft); dirty.current = false; }
            catch { /* The parent displays the error; retain the unsaved draft. */ }
          }}
          className="h-8 border-emerald-800 bg-[#07100f] text-[10px] text-emerald-300 hover:bg-emerald-950 hover:text-emerald-100"
        >
          Save
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {field("hp", "min", "HP min")}
        {field("hp", "max", "HP max")}
        {field("mp", "min", "MP min")}
        {field("mp", "max", "MP max")}
      </div>
      <div className="mt-4 grid gap-3 border-t border-emerald-900 pt-4">
        <span className="font-mono text-xs text-emerald-100">Select elixir type</span>
        <MetricsItemPicker label="Select elixir type" items={elixirs} value={elixir.item} onChange={item=>updateElixir({item})}/>
        {elixir.item && <button type="button" onClick={()=>updateElixir({item:""})} className="border border-slate-600 bg-[#07100f] px-2 py-1 text-xs text-slate-200 hover:bg-slate-800">Disable elixir restock</button>}
        <div className="grid grid-cols-2 gap-2">{(["min","max"] as const).map(key=><label key={key} className="grid gap-1 text-xs text-emerald-100">Elixir {key}<Input aria-label={`Elixir ${key}`} type="number" min={0} max={9999} value={elixir[key]} onChange={event=>updateElixir({[key]:Number(event.target.value)})} className="h-8 border-emerald-800 bg-[#07100f] text-emerald-100"/></label>)}</div>
        <label className="flex items-center gap-2 text-xs text-emerald-100"><input type="checkbox" checked={elixir.autoConsume} onChange={event=>updateElixir({autoConsume:event.target.checked})}/>Automatically consume elixirs</label>
        <label className="flex items-center gap-2 text-xs text-emerald-100"><input type="checkbox" checked={elixir.autoAcquire} onChange={event=>updateElixir({autoAcquire:event.target.checked})}/>Buy or craft elixir when out of stock</label>
        <p className="text-xs text-emerald-100/60">Delivered from existing stock at the minimum threshold. Active elixirs finish before another is consumed. Buying or crafting uses available gold and materials only when enabled.</p>
      </div>
      </div>
    </section>
  );
});
