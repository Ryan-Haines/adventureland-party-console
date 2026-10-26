"use client";
import { memo, useEffect, useRef, useState } from "react";
import { useClock } from "@/hooks/use-clock";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { durationSignature, reconcileDurations, statusRemaining, type StatusDuration } from "./status-duration";
import { Condition } from "./condition";
import { durationLabel } from "./duration-label";
import { SpriteCrop } from "./sprite-crop";

const icon = 16;
const gap = 4;

/** How many 16 px cells fit the row's width, measured on resize. */
function useCapacity() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [capacity, setCapacity] = useState(Infinity);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(() => setCapacity(Math.max(1, Math.floor((element.clientWidth + gap) / (icon + gap)))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, capacity] as const;
}

/**
 * The card's active statuses as one row of game condition icons in the
 * profile header. Each icon's tooltip carries what the old Active status
 * list showed: name, remaining time and stacks. A mouse click opens the
 * condition details; a tap on a touch screen toggles the tooltip instead,
 * because touch has no hover. Statuses beyond the row's width collapse into
 * a "+N" last cell, and the row takes no space without statuses.
 */
export const StatusIconRow = memo(function StatusIconRow({ conditions, onSelect }: {
  conditions: Condition[];
  onSelect: (condition: Condition) => void;
}) {
  const [measure, cells] = useCapacity();
  const now = useClock();
  const [durations, setDurations] = useState<Record<string, StatusDuration | undefined>>({});
  const [open, setOpen] = useState<string | null>(null);
  const touched = useRef(false);
  const signature = durationSignature(conditions);
  useEffect(() => {
    // Same anchoring as active-statuses.tsx: commit time, not the shared clock.
    // eslint-disable-next-line react/react-compiler
    setDurations(previous => reconcileDurations(signature, previous, Date.now()));
  }, [signature]);
  const overflow = conditions.length > cells ? conditions.length - cells + 1 : 0;
  const shown = overflow ? conditions.slice(0, cells - 1) : conditions;
  const hidden = overflow ? conditions.slice(cells - 1) : [];
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
  const cell = "relative overflow-hidden rounded-[2px] border border-cyan-800 bg-black hover:border-cyan-300 focus-visible:outline-2 focus-visible:outline-cyan-400";
  const tip = "flex-col items-start gap-0 border border-cyan-800 bg-[#071719] text-cyan-100";
  if (!conditions.length) return null;
  return (
    <div ref={measure} data-status-row className="mt-2 flex h-4 gap-1 overflow-hidden">
      {shown.map(condition => (
        <Tooltip key={condition.id} open={open === condition.id}
          onOpenChange={next => setOpen(current => next ? condition.id : current === condition.id ? null : current)}>
          <TooltipTrigger delay={0} render={<button type="button" aria-label={`${condition.name}, ${detail(condition)}`} />} data-status={condition.id}
            onPointerUp={toggle(condition.id)}
            onClick={() => { if (touched.current) touched.current = false; else onSelect(condition); }}
            className={`${cell} size-4 shrink-0`}>
            {condition.sprite && <SpriteCrop sprite={condition.sprite} size={icon - 2} />}
          </TooltipTrigger>
          <TooltipContent side="bottom" className={tip}>
            <span className="text-xs font-semibold">{condition.name}</span>
            <span className="font-mono text-[10px]">{detail(condition)}</span>
          </TooltipContent>
        </Tooltip>
      ))}
      {overflow ? (
        <Tooltip open={open === "+"} onOpenChange={next => setOpen(current => next ? "+" : current === "+" ? null : current)}>
          <TooltipTrigger delay={0} render={<button type="button" aria-label={`${overflow} more statuses`} />} onPointerUp={toggle("+")}
            className={`${cell} h-4 min-w-4 shrink-0 px-0.5 font-mono text-[10px] leading-none text-cyan-100`}>
            +{overflow}
          </TooltipTrigger>
          <TooltipContent side="bottom" className={`${tip} gap-0.5`}>
            {hidden.map(condition => <span key={condition.id} className="text-xs">{condition.name} · {detail(condition)}</span>)}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
});
