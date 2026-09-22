"use client";
import { Plus } from "lucide-react";
import type { ActiveSlot } from "./active-slot";
import type { SteamSwitch } from "./steam-switch";

export function RosterControls({
  slots,
  operation,
  onChoose,
}: {
  slots: ActiveSlot[];
  operation?: SteamSwitch | null;
  onChoose: (slot: number) => void;
}) {
  const pending = !!operation?.phase && operation.phase !== "complete";
  const emptySlots = slots.filter(slot => slot.kind === "headless" && !slot.character);
  if (!emptySlots.length) return null;
  return (
    <>
        {emptySlots
          .map((slot) => (
            <button
              key={slot.index}
              type="button"
              disabled={pending}
              onClick={() => onChoose(slot.index)}
              className="flex min-h-24 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-emerald-700 bg-[#07100f] text-emerald-100 hover:border-cyan-400 hover:bg-emerald-950 hover:text-white disabled:opacity-50"
            >
              <Plus className="h-5 w-5" /> Load character slot {slot.index + 1}
            </button>
          ))}
    </>
  );
}
