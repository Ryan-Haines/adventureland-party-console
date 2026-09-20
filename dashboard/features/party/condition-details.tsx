"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Condition } from "./condition";
import { displayValue } from "./display-value";
import { durationLabel } from "./duration-label";
import { durationStat } from "./format-duration";
import { SpriteCrop } from "./sprite-crop";

export function ConditionDetails({
  selected,
  onOpenChange,
}: {
  selected: { character: string; condition: Condition } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const condition = selected?.condition;
  const merged = condition ? { ...condition.definition, ...condition.live } : {},
    ignored = new Set(["name", "explanation", "skin", "ui"]);
  const details = Object.entries(merged).filter(([key]) => !ignored.has(key));
  return (
    <Dialog open={!!selected} onOpenChange={onOpenChange}>
      <DialogContent className="border border-cyan-800 bg-[#0b1916] text-emerald-50 sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-4">
            {condition?.sprite && (
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded border border-cyan-700 bg-black">
                <SpriteCrop sprite={condition.sprite} size={56} />
              </div>
            )}
            <div>
              <DialogTitle>{condition?.name || "Status effect"}</DialogTitle>
              <DialogDescription className="mt-1 text-emerald-100/55">
                {selected?.character} · {durationLabel(condition?.remainingMs)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {condition?.explanation && (
          <p className="text-sm leading-6 text-emerald-50/80">{condition.explanation}</p>
        )}
        <dl className="grid grid-cols-2 gap-x-5 gap-y-2 border-t border-emerald-900 pt-4">
          {details.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3 border-b border-emerald-950 pb-1">
              <dt className="capitalize text-emerald-100/50">{key.replaceAll("_", " ")}</dt>
              <dd className="max-w-44 break-words text-right font-mono text-cyan-200">
                {durationStat(key, value, condition?.definition) ?? displayValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
