"use client";
import { RosterPicker } from "./roster-picker";
import type { PartyConsoleModel } from "./use-party-console";

export function PartyRosterPicker({ model }: { model: PartyConsoleModel }) {
  const { state, setPickerSlot, pickerSlot, switchSteam, spawn, setCreateOpen } = model;
  return (
    <RosterPicker
      slot={pickerSlot}
      slots={state.activeSlots || []}
      roster={state.roster || []}
      onClose={() => setPickerSlot(null)}
      onCreate={() => {
        setPickerSlot(null);
        setCreateOpen(true);
      }}
      onChoose={(name, hosting) => (pickerSlot === 0 ? switchSteam(name) : spawn(pickerSlot!, name, hosting))}
    />
  );
}
