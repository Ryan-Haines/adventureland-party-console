"use client";
// A character's Farming section in the settings menu, which was the card's Farming settings
// dialog: relocation, the Monster Hunt settings, the search radius, the Hunt spawn settings, the
// add-on farming sections, passive rare hunting and the Hunt blacklist. A follower's section shows
// its leader's farming scope read-only, as the dialog did.
import { useCallback, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { defaultSearchRadius, migratePassiveSettings } from "../../../runtime/hunting/api.ts";
import { addonSections, useAddonSlots } from "../../../runtime/hooks/dashboard/slots";
import { HuntBlacklistPicker } from "./hunt-blacklist-picker";
import { huntBlacklistLabel } from "./hunt-blacklist-label";
import { HuntSettingsControl, RelocationControl } from "./hunt-settings-control";
import { HuntSpawnSettings } from "./hunt-spawn-settings";
import { MonsterDetailsDialog } from "./monster-details-dialog";
import { MonsterRadiusControl } from "./monster-radius-control";
import { PassiveHuntingMenu, type PassivePatch } from "./passive-hunting-menu";
import { SpriteCrop } from "./sprite-crop";
import { farmingContext } from "./farming-context";
import { useCharacterData } from "./dashboard-live";
import { useSettingsWrite } from "./settings-write";
import type { PartyState } from "./party-state";
import type { PartyConsoleModel } from "./use-party-console";

type MonsterModel = Pick<PartyConsoleModel, "state" | "monsterAchievements" | "setMonsterNavigateTarget" | "setSelected" |
  "setSelectedBestiaryMonster" | "setActionError">;
// The monster details a farming control opens: a Bestiary entry's details dialog, or a note while
// the Bestiary has no entry yet. The card's add-on farming pieces and this section read the same two.
export function useMonsterInspection(model: MonsterModel) {
  const { state, monsterAchievements, setMonsterNavigateTarget, setSelected, setSelectedBestiaryMonster, setActionError } = model;
  const renderMonsterDetails = useCallback((id: string, close: () => void): ReactNode => {
    const monster = state.bestiaryCatalog?.find(entry => entry.id === id);
    if (!monster) return <Dialog open onOpenChange={open => { if (!open) close(); }}>
      <DialogContent data-area="card-monster" className="border-emerald-700 bg-[#081713] text-emerald-50">
        <DialogHeader><DialogTitle>Monster details</DialogTitle><DialogDescription className="text-emerald-100">Details are not available for {id} yet.</DialogDescription></DialogHeader>
      </DialogContent>
    </Dialog>;
    return <MonsterDetailsDialog monster={monster} catalog={state.merchantCatalog?.allItems || []}
      monsters={state.bestiaryCatalog || []} skills={state.skillCatalog || []}
      achievement={monsterAchievements[id] || null}
      onOpenChange={open => { if (!open) close(); }}
      onNavigate={setMonsterNavigateTarget}
      onInspectDrop={(itemId, monsterName) => {
        const item = state.merchantCatalog?.allItems?.find(entry => entry.id === itemId);
        if (item) { close(); setSelected({ character: `Dropped by ${monsterName}`, entry: { slot: -1, item: { name: itemId }, meta: item.meta } }); }
      }} />;
  }, [state.bestiaryCatalog, state.merchantCatalog, state.skillCatalog, monsterAchievements, setMonsterNavigateTarget, setSelected]);
  const onInspectMonster = useCallback((id: string) => {
    const monster = state.bestiaryCatalog?.find(entry => entry.id === id);
    if (monster) setSelectedBestiaryMonster(monster);
    else setActionError(`Monster details are not available for ${id} yet.`);
  }, [state.bestiaryCatalog, setSelectedBestiaryMonster, setActionError]);
  return { renderMonsterDetails, onInspectMonster };
}

export function FarmingSettingsSection({ model, name }: { model: PartyConsoleModel; name: string }) {
  const { state, post, setFocus, monsters, selectedFocus, openSettings } = model;
  const slots = useAddonSlots();
  const diagnostics = useCharacterData(name, "diagnostics");
  const settings = useSettingsWrite();
  const farming = farmingContext(state, name);
  const inherited = !!farming.followingLeader;
  const followDescription = useId();
  const { renderMonsterDetails, onInspectMonster } = useMonsterInspection(model);
  const [confirmBlacklistClear, setConfirmBlacklistClear] = useState(false);
  const [blacklistBusy, setBlacklistBusy] = useState(false), [blacklistError, setBlacklistError] = useState<string | null>(null);
  const blacklist = farming.blacklist;
  const focus = state.monsterFocusByCharacter?.[name] || selectedFocus;
  const priorities = state.monsterPrioritiesByCharacter?.[name] || {};
  const save = (body: Record<string, unknown>) => post("/hunt-blacklist", { ...body, character: name });
  async function clearBlacklist(monsterId?: string) {
    setBlacklistBusy(true);
    setBlacklistError(null);
    try {
      await save(monsterId ? { action: "remove", monsterId } : { action: "clear" });
      if (!monsterId) setConfirmBlacklistClear(false);
    } catch (error) {
      setBlacklistError(error instanceof Error ? error.message : "Could not update Hunt blacklist");
    } finally {
      setBlacklistBusy(false);
    }
  }
  const saveAddon = async (addon: string, body: Record<string, unknown>) => { await post("/addon-farming", { name: addon, character: name, ...body }); };
  const sendAddon = async (addon: string, body: unknown) => { await post("/addon-command", { name: addon, character: name, body }); };
  const addonFarming = addonSections(slots, { state, owner: farming.owner, inherited, save: saveAddon, command: sendAddon,
    monsters: { kills: (diagnostics as { monsterAchievementKills?: Record<string, number> } | undefined)?.monsterAchievementKills ?? {},
      achievements: model.monsterAchievements, bestiary: state.bestiaryCatalog, choices: state.monsterChoices, catalog: monsters,
      inspect: onInspectMonster, renderDetails: renderMonsterDetails } });
  return (
    <section data-area="farming-settings" data-addon-slot="settings-section" className="space-y-4">
      <p className="text-emerald-100/80">
        Configure relocation away from competing farmers and automatic Hunt blacklisting. Blacklisted quests are skipped until you clear the entry. Normal farming selections are unaffected.
        {farming.owner !== name ? ` These settings belong to ${farming.owner}'s farming scope.` : ""}
      </p>
      {inherited && <p id={followDescription} className="sr-only">Settings inherited from the leader</p>}
      {settings.notice ? <p role="alert" className="text-xs text-amber-200">{settings.notice}</p> : null}
      <fieldset disabled={!settings.ready} aria-busy={!settings.ready} className="contents">
        <RelocationControl value={state.relocateIfCompeting}
          onSave={async on => { await settings.write([{ field: "relocateIfCompeting", value: on }]); }} />
        <fieldset disabled={inherited} aria-describedby={inherited ? followDescription : undefined}>
          <HuntSettingsControl value={farming.settings} onSave={inherited ? undefined : async patch => { await post("/hunt-settings", { ...patch, character: name }); }} />
        </fieldset>
        <MonsterRadiusControl radius={state.monsterSearchRadiusByCharacter?.[name] || defaultSearchRadius}
          onSave={radius => setFocus(name, focus, priorities, radius)}
          context={farming.followingLeader
            ? `Following ${state.leader}: effective radius ${state.monsterSearchRadiusByCharacter?.[String(state.leader)] || defaultSearchRadius}. This input saves ${name}'s own radius.`
            : "Radius for Leader"} />
        <HuntSpawnSettings catalog={monsters} value={farming.settings}
          onSave={async (patch: Partial<NonNullable<PartyState["huntSettings"]>>) => { await post("/hunt-settings", { ...patch, character: name }); }} disabled={inherited} />
        {addonFarming.sections}
        <PassiveHuntingMenu settings={migratePassiveSettings(state.passiveHunting, state.passiveRareHunts)} catalog={monsters} disabled={inherited}
          onSave={async (patch: PassivePatch) => { await post("/rare-hunting", patch); }} renderMonsterDetails={renderMonsterDetails} />
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
            <HuntBlacklistPicker catalog={monsters} blacklist={blacklist} disabled={inherited || blacklistBusy}
              onAdd={async monsterId => { await save({ action: "add", monsterId }); }} renderMonsterDetails={renderMonsterDetails} />
          </div>
          <div className="space-y-2">
            {Object.entries(blacklist).length === 0 && (
              <p className="text-sm text-emerald-100">No monsters blacklisted.</p>
            )}
            {Object.entries(blacklist)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([id, entry]) => {
                const monster = monsters.find((m) => m.id === id);
                return (
                  <div key={id} className="flex items-center gap-3 rounded border border-emerald-800 bg-[#07110f] p-3">
                    <button type="button" aria-label={`Inspect ${monster?.name || id}`}
                      onClick={() => { openSettings(null); onInspectMonster(id); }}
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
          {blacklistError && <p role="alert" className="text-rose-200">{blacklistError}</p>}
        </section>
      </fieldset>
      <Dialog open={confirmBlacklistClear} onOpenChange={value => { if (!blacklistBusy) setConfirmBlacklistClear(value); }}>
        <DialogContent data-area="clear-blacklist" className="border border-rose-700 bg-black text-emerald-50 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clear Hunt blacklist?</DialogTitle>
            <DialogDescription className="text-emerald-100">Remove all {Object.keys(blacklist).length} blacklisted monsters for {farming.owner}? Hunt can accept quests for these monsters again.</DialogDescription>
          </DialogHeader>
          {blacklistError && <p role="alert" className="text-rose-200">{blacklistError}</p>}
          <DialogFooter className="border-rose-900 bg-[#081713]">
            <Button type="button" variant="outline" disabled={blacklistBusy} onClick={() => setConfirmBlacklistClear(false)} className="border-slate-600 bg-black text-slate-100 hover:bg-slate-800 hover:text-white">Cancel</Button>
            <Button type="button" disabled={inherited || blacklistBusy} onClick={() => void clearBlacklist()} className="border border-rose-600 bg-rose-950 text-rose-100 hover:bg-rose-900 hover:text-white">{blacklistBusy ? 'Clearing...' : 'Clear all'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
