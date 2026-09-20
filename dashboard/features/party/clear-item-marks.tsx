"use client";
import { Eraser } from "lucide-react";
import { ContextMenuItem } from "@/components/ui/context-menu";

export function ClearItemMarks({ onClear }: { onClear: () => void }) {
  return <div className="mt-2 pb-1" data-clear-marks-footer>
    <ContextMenuItem onClick={onClear} title="Clear this item’s manual marks and matching shared automatic rules" className="relative !bg-white !pl-14 !font-normal !text-[#b91c1c] data-highlighted:!bg-red-50 data-highlighted:!text-[#b91c1c]">
      <Eraser aria-hidden="true" className="absolute left-2 h-4 w-4" />
      Clear all marks
    </ContextMenuItem>
  </div>;
}
