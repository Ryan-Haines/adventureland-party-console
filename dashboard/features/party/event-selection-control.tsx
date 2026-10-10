"use client";
import { CaveEventRow } from './dungeon-settings';
import { memo, useState } from "react";
import { GripVertical, Settings } from "lucide-react";

import { useClock } from "@/hooks/use-clock";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { eventDisplayNames, eventPolicy, selectedEvents, supportedEvents, eventPriorityOrder } from "@/lib/event-policy";
import { PartyState } from "./party-state";

export type EventSchedule = { id: string; name: string; live?: boolean; next?: number; expires?: number; stale?: boolean; slotAt?: number; slotKind?: string };
export type EventSelectionState = Pick<PartyState, "leader" | "merchantCharacter" | "followers" |
  "eventPrioritiesByCharacter" | "eventsByCharacter" | "eventSelectionsByCharacter" | "eventSchedules">;
export function eventTimeLabel(next: number | undefined, now: number) {
  if (!next || !Number.isFinite(next)) return "Time not announced";
  const ms = next < 1e12 ? next * 1000 : next;
  const remaining = Math.max(0, ms - now);
  return `${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(ms)} (${Math.floor(remaining / 60000)}m ${Math.floor(remaining / 1000) % 60}s)`;
}
export const EventSelectionControl = memo(function EventSelectionControl({ state, name, onChange, onPriorityChange, onAnniversary }: {
  onPriorityChange: (events: string[]) => void; state: EventSelectionState; name: string; merchant: boolean; onAnniversary: () => void; onChange: (events: string[]) => void;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const order = eventPriorityOrder(state, name);
  const now = useClock(), policy = eventPolicy(state, name), selected = selectedEvents(state, name);
  // Server schedules are observations, not the supported catalog: seasonal
  // bosses must remain selectable even when the current feed omits them.
  const schedules = new Map((state.eventSchedules ?? []).map(event => [event.id, event]));
  const catalog: EventSchedule[] = [...new Set([...order, ...schedules.keys()])].map(id => {
    const schedule = schedules.get(id);
    return { ...schedule, id, name: eventDisplayNames[id] ?? schedule?.name ?? id };
  });
  const rows = catalog.filter(event => event.id !== "cave" && event.name.toLowerCase() !== "cave of many dreams");
  return <Popover>
    <PopoverTrigger className="cursor-pointer rounded border border-slate-500 bg-[#101c1a] px-2 py-1 text-xs text-emerald-100 hover:bg-[#20332e]">Events ({selected.length}) ▾</PopoverTrigger>
    <PopoverContent align="start" className="max-h-[min(40rem,var(--available-height))] w-[30rem] max-w-[calc(100vw-1rem)] overflow-auto rounded border border-slate-500 bg-[#101c1a] p-3 text-xs text-emerald-50 shadow-xl">
      {policy.inherited && <p className="mb-2 text-amber-200">Using {policy.source}’s events</p>}
      <CaveEventRow />
      <p className="mt-2 text-slate-300">Higher numbers attend first. Drag to reorder.</p>
      {rows.map(event => {
        const supported = supportedEvents.includes(event.id), allowed = supported;
        return <div key={event.id} draggable={supported && !policy.inherited}
          onDragStart={e => { setDragged(event.id); e.dataTransfer.setData("text/plain", event.id); }}
          onDragOver={e => { if (supported && !policy.inherited) e.preventDefault(); }}
          onDragEnd={() => setDragged(null)}
          onDrop={e => {
            e.preventDefault();
            if (!supported || policy.inherited || !dragged || dragged === event.id) return;
            const next = order.filter(id => id !== dragged);
            next.splice(next.indexOf(event.id), 0, dragged);
            onPriorityChange(next); setDragged(null);
          }} className="flex items-center gap-2 py-2">
          <GripVertical aria-hidden="true" className={`size-3 shrink-0 ${supported && !policy.inherited ? "cursor-grab text-slate-300" : "invisible"}`} />
          <span aria-label={`${event.name} priority`} className="w-8 shrink-0 text-center text-emerald-200">{supported ? order.length - order.indexOf(event.id) : 0}</span>
          <input type="checkbox" checked={allowed && selected.includes(event.id)} disabled={!allowed || policy.inherited}
            className="accent-emerald-500" onChange={e => onChange(e.target.checked ? [...selected, event.id] : selected.filter(id => id !== event.id))} />
          <span>{event.name} — {!supported ? "Unsupported" : event.live ? "LIVE" : event.next ? eventTimeLabel(event.next, now) : event.slotAt ? `Next chance: ${eventTimeLabel(event.slotAt, now)}` : "Time not announced"}{event.stale ? " · timing stale" : ""}</span>
          {event.id === "anniversary" && <button type="button" aria-label="Anniversary settings" onClick={onAnniversary} className="ml-auto rounded border border-slate-500 bg-slate-950 p-2 text-pink-200 hover:bg-slate-800"><Settings className="size-4" /></button>}
        </div>;
      })}
    </PopoverContent>
  </Popover>;
});
