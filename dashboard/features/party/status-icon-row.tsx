"use client";
// The card's status icons (fork 972c9fce dashboard/features/party/status-icon-row.tsx). They
// replaced the collapsible Active status list.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useClock } from "@/hooks/use-clock";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { durationSignature, reconcileDurations, statusRemaining, type StatusDuration } from "./status-duration";
import { Condition } from "./condition";
import { durationLabel } from "./duration-label";
import { SpriteCrop } from "./sprite-crop";

const icon = 16;
const gap = 4;

/** How many 16 px cells fit one line of the measured element, measured on resize. */
function useCapacity() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [capacity, setCapacity] = useState(Infinity);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(() => setCapacity(Math.max(0, Math.floor((element.clientWidth + gap) / (icon + gap)))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, capacity] as const;
}

type Shared = {
  durations: Record<string, StatusDuration | undefined>;
  open: string | null;
  setOpen: (update: (current: string | null) => string | null) => void;
  touched: React.RefObject<boolean>;
  onSelect: (condition: Condition) => void;
};

/**
 * The card's active statuses as game condition icons, in the empty space right of the XP bar and
 * then right of the location row. The XP line takes the icons that fit its one line, and the
 * location row takes the rest, wrapping onto more lines when they do not fit, so every status
 * shows. Each icon's tooltip carries what the old Active status list showed: name, remaining time
 * and stacks. A mouse click opens the condition details; a tap on a touch screen toggles the
 * tooltip instead, because touch has no hover.
 */
export function useStatusIcons(conditions: Condition[], onSelect: (condition: Condition) => void) {
  const [measure, cells] = useCapacity();
  const [durations, setDurations] = useState<Record<string, StatusDuration | undefined>>({});
  const [open, setOpen] = useState<string | null>(null);
  const touched = useRef(false);
  const signature = durationSignature(conditions);
  useEffect(() => {
    // Anchor newly observed telemetry at commit time; the shared clock would backdate the sample.
    // eslint-disable-next-line react/react-compiler
    setDurations(previous => reconcileDurations(signature, previous, Date.now()));
  }, [signature]);
  const shared = useMemo<Shared>(() => ({ durations, open, setOpen, touched, onSelect }), [durations, open, onSelect]);
  const xpLine = useMemo(() => conditions.slice(0, cells), [conditions, cells]);
  const locationLine = useMemo(() => conditions.slice(cells), [conditions, cells]);
  return { measure, shared, xpLine, locationLine };
}

/** One line of status cells. The clock ticks here, so the card does not redraw every second. */
export const StatusCells = memo(function StatusCells({ conditions, shared }: { conditions: Condition[]; shared: Shared }) {
  const now = useClock();
  const { durations, open, setOpen, touched, onSelect } = shared;
  const detail = (condition: Condition) => {
    const remaining = statusRemaining(durations[condition.id], now) ?? condition.remainingMs;
    const stacks = condition.stacks !== null && condition.stacks !== undefined ? ` · ${condition.stacks} stacks` : "";
    return `${durationLabel(remaining)}${stacks}`;
  };
  const toggle = (id: string) => (event: React.PointerEvent) => {
    if (event.pointerType !== "touch") return;
    touched.current = true;
    setOpen(current => current === id ? null : id);
  };
  const cell = "relative size-4 shrink-0 overflow-hidden rounded-[2px] border border-cyan-800 bg-black hover:border-cyan-300 focus-visible:outline-2 focus-visible:outline-cyan-400";
  return conditions.map(condition => (
    <Tooltip key={condition.id} open={open === condition.id}
      onOpenChange={next => setOpen(current => next ? condition.id : current === condition.id ? null : current)}>
      <TooltipTrigger delay={0} render={<button type="button" aria-label={`${condition.name}, ${detail(condition)}`} />} data-status={condition.id}
        onPointerUp={toggle(condition.id)}
        onClick={() => { if (touched.current) touched.current = false; else onSelect(condition); }}
        className={cell}>
        {condition.sprite && <SpriteCrop sprite={condition.sprite} size={icon - 2} />}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex-col items-start gap-0 border border-cyan-800 bg-[#071719] text-cyan-100">
        <span className="text-xs font-semibold">{condition.name}</span>
        <span className="font-mono text-[10px]">{detail(condition)}</span>
      </TooltipContent>
    </Tooltip>
  ));
});
