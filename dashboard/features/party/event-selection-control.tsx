"use client";
import { CaveEventRow } from './dungeon-settings';
import { memo, useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { EventLimitsDialog } from "./event-limits-dialog";
import { GripVertical, Settings } from "lucide-react";

import { useClock } from "@/hooks/use-clock";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { eventDisplayNames, eventPolicy, selectedEvents, supportedEvents, eventPriorityOrder, eventLimits, type EventLimits } from "@/lib/event-policy";
import { PartyState } from "./party-state";

export type EventSchedule = { id: string; name: string; live?: boolean; next?: number; expires?: number; stale?: boolean; slotAt?: number; slotKind?: string };
export type EventSelectionState = Pick<PartyState, "leader" | "merchantCharacter" | "followers" |
  "eventAttendance" | "eventLimitsByCharacter" | "eventPrioritiesByCharacter" | "eventsByCharacter" | "eventSelectionsByCharacter" | "eventSchedules">;
export function eventTimeLabel(next: number | undefined, now: number) {
  if (!next || !Number.isFinite(next)) return "Time not announced";
  const ms = next < 1e12 ? next * 1000 : next;
  const remaining = Math.max(0, ms - now);
  return `${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(ms)} (${Math.floor(remaining / 60000)}m ${Math.floor(remaining / 1000) % 60}s)`;
}
export const EventSelectionControl = memo(function EventSelectionControl({ state, name, onChange, onPriorityChange, onLimitsChange, onAnniversary }: {
  onLimitsChange: (event: string, limits: EventLimits) => Promise<unknown> | void; onPriorityChange: (events: string[]) => Promise<unknown> | void; state: EventSelectionState; name: string; merchant: boolean; onAnniversary: () => void; onChange: (events: string[]) => void;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const savedOrder = eventPriorityOrder(state, name);
  const [draft, setDraft] = useState<string[] | null>(null);
  const order = draft ?? savedOrder;
  const [dragPosition, setDragPosition] = useState<{x:number;y:number;width:number;offsetX:number;offsetY:number} | null>(null);
  const [settings, setSettings] = useState<string | null>(null);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const dragOrder = useRef<string[] | null>(null);
  const positions = useRef(new Map<string, number>());
  useEffect(() => { if (!dragged && draft?.join(',') === savedOrder.join(',')) setDraft(null); }, [dragged, draft, savedOrder]);
  const move = (source: string, target: string, after: boolean) => {
    if (source === target || !order.includes(target)) return;
    const next = order.filter(id => id !== source);
    next.splice(next.indexOf(target) + (after ? 1 : 0), 0, source);
    positions.current = new Map(Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-event]') ?? []).map(row => [row.dataset.event!, row.getBoundingClientRect().top]));
    setDraft(next);
    return next;
  };
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const row of listRef.current?.querySelectorAll<HTMLElement>('[data-event]') ?? []) {
      const previous = positions.current.get(row.dataset.event!);
      if (previous != null && row.dataset.event !== dragged) {
        const delta = previous - row.getBoundingClientRect().top;
        if (delta) row.animate([{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],{duration:150,easing:'ease-out'});
      }
    }
    positions.current.clear();
  }, [draft, dragged]);
  useEffect(() => {
    if (!dragged || !dragPosition) return;
    let frame = 0;
    const scroll = () => {
      const list = listRef.current;
      if (list) { const rect = list.getBoundingClientRect(), y = dragPosition.y + dragPosition.offsetY;
        if (y < rect.top + 40) list.scrollTop -= 8;
        else if (y > rect.bottom - 40) list.scrollTop += 8;
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [dragged, dragPosition]);
  const saveOrder = async (next: string[]) => {
    try { await onPriorityChange(next); }
    catch (failure) { setDraft(null); setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  const cancelDrag = () => { setDraft(dragOrder.current); setDragged(null); setDragPosition(null); dragOrder.current = null; };
  const now = useClock(), policy = eventPolicy(state, name), selected = selectedEvents(state, name);
  // Server schedules are observations, not the supported catalog: seasonal
  // bosses must remain selectable even when the current feed omits them.
  const schedules = new Map((state.eventSchedules ?? []).map(event => [event.id, event]));
  const catalog: EventSchedule[] = [...new Set([...order, ...schedules.keys()])].map(id => {
    const schedule = schedules.get(id);
    return { ...schedule, id, name: eventDisplayNames[id] ?? schedule?.name ?? id };
  });
  const rows = catalog.filter(event => event.id !== "cave" && event.name.toLowerCase() !== "cave of many dreams");
  return <>
    {dragged && dragPosition && createPortal(<div data-testid="event-drag-preview" aria-hidden="true" className="pointer-events-none fixed z-[100] flex items-center justify-between rounded border border-cyan-300 bg-slate-900 px-3 py-3 text-emerald-50 shadow-2xl" style={{left:dragPosition.x,top:dragPosition.y,width:dragPosition.width}}><span>{eventDisplayNames[dragged]}</span><span>{order.length-order.indexOf(dragged)} <GripVertical className="ml-3 inline size-4" /></span></div>, document.body)}
    <Popover onOpenChange={open => { if (!open && dragged) cancelDrag(); }}>
    <PopoverTrigger className="cursor-pointer rounded border border-slate-500 bg-[#101c1a] px-2 py-1 text-xs text-emerald-100 hover:bg-[#20332e]">Events ({selected.length}) ▾</PopoverTrigger>
    <PopoverContent align="start" className="max-h-[min(40rem,var(--available-height))] w-[30rem] max-w-[calc(100vw-1rem)] flex flex-col overflow-hidden rounded border border-slate-500 bg-[#101c1a] p-3 text-xs text-emerald-50 shadow-xl">
      {policy.inherited && <p className="mb-2 text-amber-200">Using {policy.source}’s events</p>}
      <CaveEventRow />
      <p className="mt-2 text-slate-300">Higher numbers attend first. Drag to reorder.</p>
      {error && <p role="alert" className="text-red-300">{error}</p>}
      <div ref={listRef} className="mt-2 min-h-0 space-y-2 overflow-y-auto"
        onPointerMove={e => {
          if (!dragged || !dragPosition) return;
          setDragPosition({...dragPosition,x:e.clientX-dragPosition.offsetX,y:e.clientY-dragPosition.offsetY});
          const bounds = listRef.current!.getBoundingClientRect();
          if (e.clientY < bounds.top) { move(dragged, order[0], false); return; }
          if (e.clientY > bounds.bottom) { move(dragged, order[order.length-1], true); return; }
          for (const row of listRef.current?.querySelectorAll<HTMLElement>('[data-event]') ?? []) {
            const rect = row.getBoundingClientRect();
            if (e.clientY >= rect.top && e.clientY <= rect.bottom && row.dataset.event !== dragged) {
              move(dragged, row.dataset.event!, e.clientY > rect.top + rect.height/2); break;
            }
          }
        }}
        onPointerUp={() => { if (dragged) void saveOrder(order); setDragged(null); setDragPosition(null); dragOrder.current = null; }}
        onPointerCancel={cancelDrag}>
      {rows.map(event => {
        const supported = supportedEvents.includes(event.id), allowed = supported;
        const ignored = [state.eventAttendance?.[name]?.[event.id], state.eventAttendance?.[policy.source]?.[event.id]]
          .find(entry => entry?.ignored && !entry.ended)?.ignored;
        return <div key={event.id} data-event={event.id} className={`flex items-center gap-2 rounded border bg-slate-950 px-2 py-2 text-emerald-50 ${dragged === event.id ? 'border-cyan-300 opacity-25' : 'border-emerald-900/70'}`}>
          <button type="button" aria-label={`Move ${event.name}`} title="Drag to reorder; use arrow keys to move" disabled={!supported || policy.inherited}
            style={{touchAction:'none'}} className="shrink-0 cursor-grab rounded border border-slate-600 bg-[#10201b] p-1 text-slate-200 hover:bg-slate-700 hover:text-white active:cursor-grabbing disabled:opacity-30"
            onPointerDown={e => {
              if (e.button !== 0 || !supported || policy.inherited) return;
              e.preventDefault(); e.currentTarget.focus(); listRef.current!.setPointerCapture(e.pointerId);
              const rect = e.currentTarget.parentElement!.getBoundingClientRect();
              dragOrder.current = draft; setDraft(order); setDragged(event.id); setError('');
              setDragPosition({x:rect.left,y:rect.top,width:rect.width,offsetX:e.clientX-rect.left,offsetY:e.clientY-rect.top});
            }}
            onKeyDown={e => {
              if (e.key === 'Escape' && dragged) { e.preventDefault(); e.stopPropagation(); cancelDrag(); return; }
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
              const target = order[order.indexOf(event.id) + (e.key === 'ArrowUp' ? -1 : 1)];
              if (target) { e.preventDefault(); const next = move(event.id,target,e.key === 'ArrowDown'); if (next) void saveOrder(next); }
            }}><GripVertical className="size-3" /></button>
          <span aria-label={`${event.name} priority`} className="w-8 shrink-0 text-center text-emerald-200">{supported ? order.length - order.indexOf(event.id) : 0}</span>
          <input type="checkbox" checked={allowed && selected.includes(event.id)} disabled={!allowed || policy.inherited}
            className="accent-emerald-500" onChange={e => onChange(e.target.checked ? [...selected, event.id] : selected.filter(id => id !== event.id))} />
          <span>{event.name} — {!supported ? "Unsupported" : event.live ? "LIVE" : event.next ? eventTimeLabel(event.next, now) : event.slotAt ? `Next chance: ${eventTimeLabel(event.slotAt, now)}` : "Time not announced"}{event.stale ? " · timing stale" : ""}{ignored && <span className="block text-amber-200">Skipped this instance: {ignored}</span>}</span>
          <button type="button" aria-label={`${event.name} settings`} disabled={!supported} onClick={() => setSettings(event.id)} className="ml-auto rounded border border-slate-500 bg-slate-950 p-2 text-pink-200 hover:bg-slate-800"><Settings className="size-4" /></button>
        </div>;
      })}
      </div>
      {settings && <EventLimitsDialog key={settings} event={settings} label={eventDisplayNames[settings] ?? settings}
        limits={eventLimits(state, name)[settings] ?? {deathLimit:null,timeLimitMinutes:null}}
        inherited={policy.inherited} onClose={() => setSettings(null)} onSave={onLimitsChange} onAnniversary={onAnniversary} />}
    </PopoverContent>
  </Popover></>;
});
