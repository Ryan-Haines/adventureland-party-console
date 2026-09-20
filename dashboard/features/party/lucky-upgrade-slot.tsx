"use client";
import type { InventoryEntry } from './inventory-entry';
export function physicalInventory(items: (InventoryEntry | null)[], size = 42) {
  const slots: (InventoryEntry | null)[] = Array(Math.max(size, items.length)).fill(null);
  for (const entry of items) if (entry && Number.isInteger(entry.slot) && entry.slot >= 0 && entry.slot < slots.length) slots[entry.slot] = entry;
  return slots;
}
export function validLuckySlot(slot: unknown): slot is number {
  return Number.isInteger(slot) && Number(slot) >= 0 && Number(slot) < 42;
}
export function LuckySlotOutline() {
  return <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute -inset-[5px] z-20 h-[calc(100%+10px)] w-[calc(100%+10px)] overflow-visible fill-none text-amber-300">
    <path stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" d="M8 4 Q14 0 20 4 T32 4 T44 4 T56 4 T68 4 T80 4 T92 4 Q96 4 96 8 Q100 14 96 20 T96 32 T96 44 T96 56 T96 68 T96 80 T96 92 Q96 96 92 96 Q86 100 80 96 T68 96 T56 96 T44 96 T32 96 T20 96 T8 96 Q4 96 4 92 Q0 86 4 80 T4 68 T4 56 T4 44 T4 32 T4 20 T4 8 Q4 4 8 4 Z" />
  </svg>;
}
