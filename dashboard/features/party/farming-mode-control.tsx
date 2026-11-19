"use client";
import { Button } from "@/components/ui/button";
import { PassiveHuntingMenu, type PassivePatch } from "./passive-hunting-menu";
import { defaultSearchRadius, migratePassiveSettings, modePair } from "../../../runtime/hunting/api.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, Settings } from "lucide-react";
import { memo, useId, useState, type ComponentProps, type ReactNode } from "react";
import { durationLabel } from "./duration-label";
import { SpriteCrop } from "./sprite-crop";
import { MonsterChoice } from "./monster-choice";
import { MonsterHuntState } from "./monster-hunt-state";
import { MonsterHuntStatus } from "./monster-hunt-status";
import { PartyState } from "./party-state";
import { MonsterRadiusControl } from './monster-radius-control';
import {HuntSettingsControl, RelocationControl} from "./hunt-settings-control";
import { HuntSpawnSettings } from './hunt-spawn-settings';
import { huntBlacklistLabel } from './hunt-blacklist-label';
import { HuntBlacklistPicker } from './hunt-blacklist-picker';
import type { SlotColor, SlotEntry } from "../../../runtime/hooks/registry";
import { AddonSlot } from "../../../runtime/hooks/dashboard/slots";
import type { AddonPlaceData } from "./addon-kit";

// Each slot colour's dashboard classes, written out so Tailwind finds them:
// the button, and the status block's border and text.
const SLOT_CLASSES: Record<SlotColor, { button: string; block: string; title: string }> = {
  slate: { button: "border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800", block: "border-slate-900/70 text-slate-100/80", title: "text-slate-100" },
  cyan: { button: "border-cyan-600 bg-cyan-950 text-cyan-100 hover:bg-cyan-900", block: "border-cyan-900/70 text-cyan-100/80", title: "text-cyan-100" },
  emerald: { button: "border-emerald-600 bg-emerald-950 text-emerald-100 hover:bg-emerald-900", block: "border-emerald-900/70 text-emerald-100/80", title: "text-emerald-100" },
  violet: { button: "border-violet-600 bg-violet-950 text-violet-100 hover:bg-violet-900", block: "border-violet-900/70 text-violet-100/80", title: "text-violet-100" },
  amber: { button: "border-amber-600 bg-amber-950 text-amber-100 hover:bg-amber-900", block: "border-amber-900/70 text-amber-100/80", title: "text-amber-100" },
  rose: { button: "border-rose-600 bg-rose-950 text-rose-100 hover:bg-rose-900", block: "border-rose-900/70 text-rose-100/80", title: "text-rose-100" },
  sky: { button: "border-sky-600 bg-sky-950 text-sky-100 hover:bg-sky-900", block: "border-sky-900/70 text-sky-100/80", title: "text-sky-100" },
};
// What one mode button sends: its slot's field only.
export type SlotChoice = { combatMode: string } | { targetMode: string };

export const FarmingModeControl = memo(function FarmingModeControl({
  followingLeader, settingsOwner,
  effectiveMode,
  hunt,
  huntLine,
  characterHunt,
  combatEntries, targetEntries, slotsError, combatMode, targetMode, effectiveCombat = combatMode, effectiveTarget = targetMode,
  onSelect,
  blacklist,
  catalog,
  onClearBlacklist, onAddBlacklist, onInspectMonster, renderMonsterDetails,
  huntSettings, onHuntSettingsSave, relocate, onRelocate,
  passiveRareHunts, passiveHunting,
  onRareChange,
  radius, onRadiusSave, radiusContext, farmArea,
  settingsOpen, onSettingsOpenChange: setSettingsOpen,
  addonSettings, addonStatus = {}, addonCard,
}: {
  // The two rows' entries, each with its declared button (runtime/hooks/dashboard/slots.tsx), and the scope's pair:
  // the character's own saved values for the pressed buttons, the scope's effective target mode
  // for the status line.
  combatEntries: readonly SlotEntry[];
  targetEntries: readonly SlotEntry[];
  // The slots read's failure (slots.tsx `error`): with it the rows hold no buttons, so the card says why.
  slotsError?: string;
  combatMode: string;
  targetMode: string;
  effectiveCombat?: string;
  effectiveTarget?: string;
  // The enabled add-ons' settings sections and status lines (runtime/hooks/dashboard/slots.tsx `addonSections`).
  addonSettings?: ReactNode;
  addonStatus?: Record<string, { title: string; message: string; color: SlotColor }>;
  // What the Farming settings line's add-on pieces read (the `card-section` slot, part `farming-line`).
  addonCard: AddonPlaceData["card-section"];
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  farmArea?: PartyState["farmAreaState"];
  followingLeader?: string; settingsOwner?: string;
  huntSettings?: PartyState["huntSettings"];
  onHuntSettingsSave?: (patch: Partial<NonNullable<PartyState["huntSettings"]>>) => Promise<void>;
  // The root relocation switch and its write.
  relocate?: boolean;
  onRelocate?: (on: boolean) => Promise<void>;
  radius?:number;onRadiusSave?:(radius:number)=>Promise<void>;radiusContext?:string;
  passiveHunting?: PartyState["passiveHunting"];
  passiveRareHunts?: PartyState["passiveRareHunts"];
  onRareChange?: (settings: PassivePatch) => Promise<void>;
  blacklist: NonNullable<PartyState["huntBlacklist"]>;
  catalog: MonsterChoice[];
  onInspectMonster?: (id: string) => void;
  renderMonsterDetails?: ComponentProps<typeof PassiveHuntingMenu>["renderMonsterDetails"];
  onClearBlacklist: (monsterId?: string) => Promise<void>;
  onAddBlacklist?: (monsterId: string) => Promise<void>;
  // The hunting owner's calculated combat mode (`calculateFarmingMode`), which Auto shows beside its name.
  effectiveMode: string;
  hunt?: MonsterHuntState | null;
  // The Hunt task's status line, the card line's own text while the Hunt holds it.
  huntLine?: string;
  characterHunt?: MonsterHuntStatus | null;
  onSelect: (choice: SlotChoice) => void;
}) {
  const followDescription = useId();
  const inherited = !!followingLeader;
  const [open, setOpen] = useState(false);
  const [confirmBlacklistClear, setConfirmBlacklistClear] = useState(false);
  const [blacklistBusy, setBlacklistBusy] = useState(false),
    [blacklistError, setBlacklistError] = useState<string | null>(null);
  async function clearBlacklist(monsterId?: string) {
    setBlacklistBusy(true);
    setBlacklistError(null);
    try {
      await onClearBlacklist(monsterId);
      if (!monsterId) setConfirmBlacklistClear(false);
    } catch (error) {
      setBlacklistError(error instanceof Error ? error.message : "Could not update Hunt blacklist");
    } finally {
      setBlacklistBusy(false);
    }
  }
  // Row 1 sends the combat mode only and row 2 the target mode only, so one button is pressed in
  // each row.
  const rows: { name: string; entries: readonly SlotEntry[]; pressed: string; choose(mode: string): SlotChoice }[] = [
    { name: "Combat mode", entries: combatEntries, pressed: combatMode, choose: mode => ({ combatMode: mode }) },
    { name: "Target mode", entries: targetEntries, pressed: targetMode, choose: mode => ({ targetMode: mode }) },
  ];
  const addonLine = addonStatus[effectiveTarget];
  // The pair in the hunting owner's words, each mode by its entry's label.
  const label = (entries: readonly SlotEntry[], mode: string) => entries.find(entry => entry.mode === mode)?.button.label ?? mode;
  const pair = (target: string, combat: string) => modePair(label(targetEntries, target), label(combatEntries, combat));
  const hunting = effectiveTarget === "hunt";
  return (
    <section data-area="farming-line" className="border-t border-emerald-900/70 pt-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex h-9 min-w-0 flex-1 items-center justify-between rounded border border-transparent bg-[#07110f] px-1 py-1 text-left text-emerald-100 hover:border-emerald-800 hover:bg-emerald-950"
        >
          <span className="flex items-center gap-2 font-mono text-xs uppercase text-emerald-100/65">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{" "}
            Farming settings
          </span>
          <span className="rounded border border-cyan-700 bg-cyan-950 px-2 py-1 font-mono text-[10px] uppercase text-cyan-100">
            {followingLeader ? "Copy leader" : pair(targetMode, combatMode)}
            {!inherited && combatMode === "auto" ? ` · ${effectiveMode}` : ""}
          </span>
        </button>
        <Button
          type="button"
          size="icon"
          aria-label="Farming settings"
          title="Farming settings"
          onClick={() => setSettingsOpen(true)}
          className="h-9 w-9 shrink-0 border border-emerald-700 bg-[#07110f] text-emerald-100 hover:border-cyan-300 hover:bg-emerald-950"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
      {inherited && <p id={followDescription} className="sr-only">Settings inherited from the leader</p>}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent data-area="farming-settings" data-addon-slot="settings-section" className="border-emerald-700 bg-[#081713] text-emerald-50 sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Farming settings{settingsOwner ? ` · ${settingsOwner}` : ""}</DialogTitle>
            <DialogDescription className="text-emerald-100/80">
              Configure relocation away from competing farmers and automatic Hunt blacklisting. Blacklisted quests are skipped until you clear the entry. Normal farming selections are unaffected.
            </DialogDescription>
          </DialogHeader>
          {onRelocate && <RelocationControl value={relocate} onSave={onRelocate}/>}
          <fieldset disabled={inherited} aria-describedby={inherited ? followDescription : undefined}>
          <HuntSettingsControl value={huntSettings} onSave={inherited ? undefined : onHuntSettingsSave}/>
          </fieldset>
          {onRadiusSave && <MonsterRadiusControl radius={radius||defaultSearchRadius} onSave={onRadiusSave} context={radiusContext}/>}
          <HuntSpawnSettings catalog={catalog} value={huntSettings} onSave={onHuntSettingsSave} disabled={inherited}/>
          {addonSettings}
          <PassiveHuntingMenu settings={migratePassiveSettings(passiveHunting,passiveRareHunts)} catalog={catalog} disabled={inherited} onSave={onRareChange} renderMonsterDetails={renderMonsterDetails}/>
          <section aria-label="Hunt blacklist" className="space-y-3 rounded border border-emerald-700 bg-[#07110f] p-3">
          <div className="flex items-center gap-3">
            <h3 className="flex-1 font-semibold text-emerald-50">Hunt blacklist</h3>
            <Button
              type="button"
              size="sm"
              disabled={inherited || blacklistBusy || !Object.keys(blacklist).length} aria-describedby={inherited ? followDescription : undefined}
              onClick={() => { setBlacklistError(null); setConfirmBlacklistClear(true); }}
              className="border border-rose-700 bg-[#301219] text-rose-100 hover:bg-rose-950 hover:text-white"
            >
              Clear all
            </Button>
            <HuntBlacklistPicker catalog={catalog} blacklist={blacklist} disabled={inherited||blacklistBusy} onAdd={onAddBlacklist} renderMonsterDetails={renderMonsterDetails}/>
          </div>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {Object.entries(blacklist).length === 0 && (
              <p className="text-sm text-emerald-100">No monsters blacklisted.</p>
            )}
            {Object.entries(blacklist)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([id, entry]) => {
                const monster = catalog.find((m) => m.id === id);
                return (
                  <div
                    key={id}
                    className="flex items-center gap-3 rounded border border-emerald-800 bg-[#07110f] p-3"
                  >
                    <button type="button" aria-label={`Inspect ${monster?.name || id}`}
                      onClick={() => {setSettingsOpen(false);onInspectMonster?.(id);}}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded border border-transparent bg-[#07110f] text-left text-emerald-50 hover:border-cyan-600 hover:bg-emerald-950 hover:text-white">
                    <span className="relative h-10 w-10 shrink-0">
                      {monster?.sprite && <SpriteCrop sprite={monster.sprite} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-emerald-50">{monster?.name || id}</p>
                      <p className="text-xs text-emerald-200">
                        {huntBlacklistLabel(entry) ? `${huntBlacklistLabel(entry)} · ` : ""}
                        {new Date(entry.at).toLocaleString()}
                      </p>
                    </div>
                    </button>
                    <Button
                      type="button"
                      disabled={inherited || blacklistBusy} aria-describedby={inherited ? followDescription : undefined}
                      onClick={() => void clearBlacklist(id)}
                      className="border border-cyan-700 bg-black text-cyan-100 hover:bg-cyan-950"
                    >
                      Clear
                    </Button>
                  </div>
                );
              })}
          </div>
          {blacklistError && (
            <p role="alert" className="text-rose-200">
              {blacklistError}
            </p>
          )}
          </section>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmBlacklistClear && settingsOpen} onOpenChange={value => {if (!blacklistBusy) setConfirmBlacklistClear(value);}}>
        <DialogContent data-area="clear-blacklist" className="border border-rose-700 bg-black text-emerald-50 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clear Hunt blacklist?</DialogTitle>
            <DialogDescription className="text-emerald-100">Remove all {Object.keys(blacklist).length} blacklisted monsters{settingsOwner ? ` for ${settingsOwner}` : ''}? Hunt can accept quests for these monsters again.</DialogDescription>
          </DialogHeader>
          {blacklistError && <p role="alert" className="text-rose-200">{blacklistError}</p>}
          <DialogFooter className="border-rose-900 bg-[#081713]">
            <Button type="button" variant="outline" disabled={blacklistBusy} onClick={() => setConfirmBlacklistClear(false)} className="border-slate-600 bg-black text-slate-100 hover:bg-slate-800 hover:text-white">Cancel</Button>
            <Button type="button" disabled={inherited || blacklistBusy} onClick={() => void clearBlacklist()} className="border border-rose-600 bg-rose-950 text-rose-100 hover:bg-rose-900 hover:text-white">{blacklistBusy ? 'Clearing...' : 'Clear all'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {open ? (
        <div data-addon-slot="mode-row combat-mode target-mode" className="mt-2 rounded border border-emerald-900 bg-[#050b0a] p-2">
          {inherited && <p className="mb-2 text-xs text-cyan-100">Used when Follow is off.</p>}
          {slotsError ? <p role="alert" className="mb-2 text-xs text-amber-200">{slotsError}</p> : null}
          {rows.map(row => (
            <div key={row.name} role="group" aria-label={row.name} className="mb-2 flex flex-wrap gap-2">
              {row.entries.map(entry => (
                <button
                  key={entry.mode}
                  type="button"
                  title={entry.button.description}
                  aria-pressed={row.pressed === entry.mode}
                  onClick={() => onSelect(row.choose(entry.mode))}
                  className={`rounded border px-2.5 py-1 font-mono text-[10px] uppercase transition-colors ${SLOT_CLASSES[entry.button.color].button} ${row.pressed === entry.mode ? "ring-2 ring-white/70" : "opacity-80"}`}
                >
                  {entry.button.label}
                </button>
              ))}
            </div>
          ))}
          <AddonSlot name="card-section" part="farming-line" {...addonCard} />
          {!inherited && farmArea?.active && <div className="mt-3 rounded border border-cyan-800 bg-[#07110f] p-2 text-xs text-cyan-100">
            <p>Active farming zone: {farmArea.active.map} ({Math.round(farmArea.active.x)}, {Math.round(farmArea.active.y)})</p>
            {farmArea.message && <p className="mt-1 text-amber-100">{farmArea.message}</p>}
          </div>}
          {addonLine ? (
            <div data-addon-slot="status-line" className={`mt-2 border-t pt-2 font-mono text-[10px] ${SLOT_CLASSES[addonLine.color].block}`}>
              <p className={`font-semibold ${SLOT_CLASSES[addonLine.color].title}`}>{addonLine.title}</p>
              <p>{addonLine.message}</p>
            </div>
          ) : null}
          {hunting || hunt || characterHunt ? (
            <div className="mt-2 border-t border-amber-900/70 pt-2 font-mono text-[10px] text-amber-100/80">
              <p className="font-semibold text-amber-100">
                {hunting ? "Hunt status" : "Last Hunt status"}
                {hunt?.stage ? ` · ${hunt.stage}` : ""}
              </p>
              <p>{huntLine || (hunting ? "Preparing Monster Hunt cycle" : "Hunt mode is not active")}</p>
              {!hunting ? <p>Current farming mode: {pair(effectiveTarget, effectiveCombat)}. Selecting Hunt rechecks eligible quests; blacklisted quests remain skipped.</p> : null}
              {hunt?.backup ? <div className="mt-1 text-amber-200">
                <p>Next batch after every blacklisted quest expires · {durationLabel(Math.max(0,...Object.values(hunt.backup.members).map(m=>m.remainingMs)))}</p>
                {Object.entries(hunt.backup.members).map(([name,m])=><p key={name}>{name}: {!m.fresh ? 'waiting for fresh status' : m.ready ? 'ready' : `${m.target} · ${durationLabel(m.remainingMs)}`}</p>)}
              </div> : <p className="mt-1 text-amber-200">Quest owner{hunt?.owner ? `: ${hunt.owner}` : ""} · when complete or expired</p>}
              {hunt?.turnIn && hunt.turnIn.phase !== "complete" ? <p className="mt-1 text-amber-200">Events wait until Daisy reward claims finish.</p> : null}
              {hunt?.target ? <p className="mt-1 text-amber-300">Target: {hunt.target}</p> : null}
              {characterHunt ? (
                <p className="mt-1 text-emerald-200">
                  My quest: {characterHunt.id} · {characterHunt.count} left ·{" "}
                  {durationLabel(characterHunt.remainingMs)}
                  {characterHunt.id && blacklist[characterHunt.id] ? " · Blacklisted — skipped for Hunt" : ""}
                </p>
              ) : null}
              <AddonSlot name="hunt-status" part="hunt" hunt={hunt} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});
