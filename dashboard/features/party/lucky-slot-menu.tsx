"use client";
import { Menu } from "@base-ui/react/menu";
import type { InventoryEntry } from "./inventory-entry";

export interface LuckySlotMenuSelection {
  anchor: HTMLElement;
  slot: number;
  entry: InventoryEntry | null;
}
export function LuckySlotMenu({ selection, onClose, onData, onItem }: {
  selection: LuckySlotMenuSelection | null;
  onClose(): void;
  onData(): void;
  onItem(entry: InventoryEntry): void;
}) {
  const itemClass = "cursor-default select-none rounded-md border border-transparent bg-white px-1.5 py-1 text-sm text-black outline-none hover:bg-slate-100 hover:text-black data-highlighted:bg-slate-100 data-highlighted:text-black data-disabled:text-slate-500 data-disabled:pointer-events-none";
  return <Menu.Root open={!!selection} onOpenChange={open => { if (!open) onClose(); }}>
    <Menu.Portal>
      <Menu.Positioner anchor={selection?.anchor} side="bottom" align="start" sideOffset={4} className="z-50">
        <Menu.Popup aria-label="Lucky slot options" className="data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 origin-(--transform-origin) duration-100 min-w-48 rounded-lg border border-slate-300 bg-white p-1 text-black shadow-lg outline-none">
          <Menu.Item className={itemClass} onClick={() => { onClose(); onData(); }}>Show lucky slot data</Menu.Item>
          <Menu.Item className={itemClass} disabled={!selection?.entry} onClick={() => {
            if (selection?.entry) { onClose(); onItem(selection.entry); }
          }}>Show item details</Menu.Item>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>;
}
