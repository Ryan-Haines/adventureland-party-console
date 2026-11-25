"use client";
// The one settings menu (the user's design, 2026-11-22): a wide window the player can drag by its
// title bar, with a pinned header of two tab rows. Row 1 is Account, Events, Addons and one tab per
// character card; row 2 is the sections of the selected row-1 tab, and the body shows the selected
// section. Every settings button on the dashboard opens it at its own tab and section
// (settings-target.ts). The window's position is a session preference.
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AddonSettings } from "../../../runtime/hooks/dashboard/settings-page";
import { useAddonSlots } from "../../../runtime/hooks/dashboard/slots";
import { addonTitle } from "../../../runtime/hooks/dashboard/title";
import { AccountSections } from "./account-sections";
import { CombatSettingsSection } from "./combat-settings-section";
import { CaveSettings } from "./dungeon-settings";
import { EventSelectionSection } from "./event-selection-control";
import { FarmingSettingsSection } from "./farming-settings-section";
import { ItemInspectionProvider } from "./party-item-details";
import { MerchantSettingsSection } from "./merchant-collection-settings";
import { RestockControls } from "./restock-controls";
import { RoutinePrioritiesSection } from "./routine-priorities-section";
import { SettingsLock } from "./settings-lock";
import { useSessionState } from "./session-state";
import { ACCOUNT_SECTIONS, characterSections, type SettingsTarget } from "./settings-target";
import type { PartyConsoleModel } from "./use-party-console";

const tab = (selected: boolean) => "rounded border px-2 py-1 text-sm " +
  (selected ? "border-cyan-300 bg-cyan-950 text-cyan-50" : "border-slate-600 bg-slate-950 text-slate-100 hover:bg-slate-800");
const section = (selected: boolean) => "rounded border px-2 py-0.5 font-mono text-[11px] uppercase " +
  (selected ? "border-emerald-400 bg-emerald-950 text-emerald-50" : "border-slate-700 bg-black text-slate-300 hover:bg-slate-900 hover:text-white");

export function SettingsMenu({ model }: { model: PartyConsoleModel }) {
  const { settingsTarget: target, openSettings } = model;
  const [offset, setOffset] = useSessionState("settings-menu-offset", { x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null);
  const names = model.chars.map(char => char.name);
  const slots = useAddonSlots();
  const addons = slots.addons.map(addon => addon.name);
  if (!target) return null;
  // A character tab whose card left the party falls back to Account.
  const shown: SettingsTarget = target.tab === "character" && !names.includes(target.character) ? { tab: "account" } : target;
  const merchant = (name: string) => name === model.state.merchantCharacter || model.state.characters[name]?.ctype === "merchant";
  const sections: { id: string; label: string }[] =
    shown.tab === "account" ? [...ACCOUNT_SECTIONS]
      : shown.tab === "events" ? [{ id: "cave", label: "Cave" }, ...names.map(name => ({ id: name, label: name }))]
        : shown.tab === "addons" ? [{ id: "all", label: "All add-ons" }, ...addons.map(name => ({ id: name, label: addonTitle(name) }))]
          : characterSections(merchant(shown.character));
  const current = sections.find(entry => entry.id === shown.section)?.id ?? sections[0]?.id;
  const go = (next: SettingsTarget) => openSettings(next);
  const choose = (id: string) => {
    if (shown.tab === "character") go({ tab: "character", character: shown.character, section: id as never });
    else if (shown.tab === "account") go({ tab: "account", section: id as never });
    else go({ tab: shown.tab, section: id });
  };
  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, from: offset };
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const from = drag.current;
    if (!from) return;
    setOffset({ x: from.from.x + event.clientX - from.x, y: from.from.y + event.clientY - from.y });
  };
  const end = () => { drag.current = null; };
  const row1: { key: string; label: string; target: SettingsTarget }[] = [
    { key: "account", label: "Account", target: { tab: "account" } },
    { key: "events", label: "Events", target: { tab: "events" } },
    { key: "addons", label: "Addons", target: { tab: "addons" } },
    ...names.map(name => ({ key: "character:" + name, label: name, target: { tab: "character", character: name } as SettingsTarget })),
  ];
  const selected = shown.tab === "character" ? "character:" + shown.character : shown.tab;
  return (
    // The menu renders outside the workspace, so it gives its sections the item inspector's model
    // itself; the Witch's Cipher ingredient details read it (party-item-details.tsx).
    <ItemInspectionProvider model={model}>
    <Dialog open onOpenChange={open => { if (!open) openSettings(null); }}>
      {/* The window's height follows its tab up to 85dvh, and its top edge stays at 7.5dvh so the tab
          rows hold their place when a tab changes its height. The dialog centers itself across with
          the CSS translate property, so the drag offset adds to its -50%. */}
      <DialogContent data-area="settings-menu" style={{ translate: `calc(-50% + ${offset.x}px) ${offset.y}px` }}
        className="top-[7.5dvh] flex max-h-[85dvh] flex-col gap-0 overflow-hidden border border-slate-700 bg-[#0b1916] p-0 text-emerald-50 sm:max-w-5xl [&>[data-slot=dialog-close]]:border [&>[data-slot=dialog-close]]:border-slate-600 [&>[data-slot=dialog-close]]:bg-slate-950 [&>[data-slot=dialog-close]]:text-slate-100 [&>[data-slot=dialog-close]]:hover:bg-slate-800">
        <header className="shrink-0 space-y-2 border-b border-slate-700 bg-[#091614] px-4 pb-3 pt-3">
          <div data-settings-drag onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
            className="cursor-move select-none pr-10" title="Drag to move">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription className="text-slate-300">Account, events, add-ons and each character&apos;s settings.</DialogDescription>
          </div>
          <div role="tablist" aria-label="Settings" className="flex flex-wrap gap-2">
            {row1.map(entry => <button key={entry.key} type="button" role="tab" aria-selected={selected === entry.key}
              onClick={() => go(entry.target)} className={tab(selected === entry.key)}>{entry.label}</button>)}
          </div>
          <div role="tablist" aria-label="Sections" className="flex flex-wrap gap-1.5">
            {sections.map(entry => <button key={entry.id} type="button" role="tab" aria-selected={current === entry.id}
              onClick={() => choose(entry.id)} className={section(current === entry.id)}>{entry.label}</button>)}
          </div>
        </header>
        <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
          <SettingsLock>
            <Body model={model} target={shown} current={current} />
          </SettingsLock>
        </div>
      </DialogContent>
    </Dialog>
    </ItemInspectionProvider>
  );
}

function Body({ model, target, current }: { model: PartyConsoleModel; target: SettingsTarget; current: string | undefined }) {
  const { state, openSettings } = model;
  const close = useCallback(() => openSettings(null), [openSettings]);
  if (!current) return null;
  switch (target.tab) {
    case "account": return <AccountSections model={model} section={current as never} />;
    case "addons": return <AddonSettings only={current === "all" ? undefined : current} />;
    case "events": {
      const name = current;
      if (name === "cave") return <CaveSettings onActive={close} />;
      return <EventSelectionSection key={name} state={state} name={name} event={target.section === name ? target.event : undefined}
        onCave={() => model.openSettings({ tab: "events", section: "cave" })}
        onAnniversary={() => model.setAnniversaryOpen(true)}
        onChange={eventSelections => model.formation({ character: name, eventSelections })}
        onPriorityChange={eventPriorities => model.formation({ character: name, eventPriorities })}
        onLimitsChange={(event, limits) => model.formation({ character: name, eventLimits: { event, limits } })} />;
    }
    case "character": {
      const name = target.character, ctype = state.characters[name]?.ctype ?? "";
      switch (current) {
        case "farming": return <FarmingSettingsSection key={name} model={model} name={name} />;
        case "combat": return <CombatSettingsSection key={name} character={name} ctype={ctype}
          monsters={state.bestiaryCatalog?.length ? state.bestiaryCatalog : model.monsters} />;
        case "restock": return <RestockControls key={name} character={name} value={state.restockPolicies?.[name]} onSave={model.saveRestock} />;
        case "merchant": return <MerchantSettingsSection model={model} />;
        case "routines": return <RoutinePrioritiesSection
          priorities={state.merchantRoutinePriorities || {}}
          kinds={state.merchantAddonKinds}
          enabled={{
            ...state.merchantAutomations,
            fishing: state.gatheringModes?.includes("fishing") === true,
            mining: state.gatheringModes?.includes("mining") === true,
          }}
          onSave={model.saveRoutinePriorities} />;
      }
    }
  }
  return null;
}
