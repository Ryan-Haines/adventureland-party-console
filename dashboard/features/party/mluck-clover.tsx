"use client";
import { Clover } from "lucide-react";
import { Item } from "./item";

export function MluckClover({ item }: { item?: Item | null }) {
  return item?.m ? (
    <span
      title="Duplicated by Merchant's Luck"
      aria-label="Merchant's Luck duplicate"
      className="absolute right-0.5 top-1/2 z-20 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full border border-emerald-300 bg-emerald-950/95 text-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.65)]"
    >
      <Clover className="h-3.5 w-3.5 fill-emerald-500/35" />
    </span>
  ) : null;
}
