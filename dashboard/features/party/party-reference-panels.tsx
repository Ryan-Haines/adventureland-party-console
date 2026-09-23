"use client";
import { API } from "./api";

import { lazy } from "react";
import { DeferredPanel } from "./deferred-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { abbreviatedGold } from "./abbreviated-gold";
import { AnniversaryDialog } from "./anniversary-dialog";
import { BestiaryDialog } from "./bestiary-dialog";
import { liveCharacter } from "./display-character";
const GearComparisonDialog = lazy(() =>
  import("./gear-comparison-dialog").then((module) => ({ default: module.GearComparisonDialog })),
);
import { MonsterDetailsDialog } from "./monster-details-dialog";
import { SkillsDialog } from "./skills-dialog";
import type { PartyConsoleModel } from "./use-party-console";

import { usePanelModel } from "./use-panel-model";
export function PartyReferencePanels({ model }: { model: PartyConsoleModel }) {
  return model.actionError || model.donationOpen || model.bestiaryOpen || model.skillsOpen || model.anniversaryOpen || !!model.selectedBestiaryMonster || !!model.gearComparison ? <PartyReferencePanelsConnected base={model} /> : null;
}
function PartyReferencePanelsConnected({ base }: { base: PartyConsoleModel }) {
  const model = usePanelModel(base, { inventory: true, vitals: true, diagnostics: true });
  const {
    bestiaryOpen,
    setBestiaryOpen,
    state,
    monsterAchievements,
    setSelectedBestiaryMonster,
    setSelected,
    selectedBestiaryMonster,
    setMonsterNavigateTarget,
    skillsOpen,
    setSkillsOpen,
    anniversaryOpen,
    setAnniversaryOpen,
    post,
    setActionError,
    gearComparison,
    setGearComparison,
    actionError,
    donationOpen,
    setDonationOpen,
    donationAmount,
    setDonationAmount,
    donateGold,
  } = model;
  return (
    <>
      <BestiaryDialog
        characterNames={model.chars.map(character => character.name)}
        open={bestiaryOpen}
        onOpenChange={setBestiaryOpen}
        monsters={state.bestiaryCatalog || []}
        catalog={state.merchantCatalog?.allItems || []}
        achievements={Object.keys(monsterAchievements).length ? monsterAchievements : null}
        onInspectMonster={setSelectedBestiaryMonster}
        onInspectDrop={(itemId, monsterName) => {
          const item = state.merchantCatalog?.allItems?.find((entry) => entry.id === itemId);
          if (item)
            setSelected({
              character: `Dropped by ${monsterName}`,
              entry: { slot: -1, item: { name: itemId }, meta: item.meta },
            });
        }}
      />
      <MonsterDetailsDialog
        monster={selectedBestiaryMonster}
        catalog={state.merchantCatalog?.allItems || []}
        achievement={
          selectedBestiaryMonster ? monsterAchievements[selectedBestiaryMonster.id] || null : null
        }
        onOpenChange={(open) => {
          if (!open) setSelectedBestiaryMonster(null);
        }}
        onInspectDrop={(itemId, monsterName) => {
          const item = state.merchantCatalog?.allItems?.find((entry) => entry.id === itemId);
          if (item) {
            setSelectedBestiaryMonster(null);
            setSelected({
              character: `Dropped by ${monsterName}`,
              entry: { slot: -1, item: { name: itemId }, meta: item.meta },
            });
          }
        }}
        onNavigate={(monster) => setMonsterNavigateTarget(monster)}
      />
      <SkillsDialog
        open={skillsOpen}
        onOpenChange={setSkillsOpen}
        classes={state.skillCatalog || []}
      />
      <AnniversaryDialog
        open={anniversaryOpen}
        onOpenChange={setAnniversaryOpen}
        anniversary={state.anniversary}
        autoChat={state.anniversaryAutoChat} merchant={state.merchantCharacter}
        onAutoChatChange={async enabled => { const response = await fetch(`${API}/dashboard-preferences`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anniversaryAutoChat: enabled }) }); if (!response.ok) throw new Error("Could not save anniversary settings"); }}
        characters={state.characters}
        onSendChatAdvertisement={async () => {
          try {
            await post("/anniversary/chat-advertise", {});

          } catch (error) {
            setActionError(String((error as Error).message || error));

          }
        }}
      />
      <DeferredPanel active={!!gearComparison}>
        <GearComparisonDialog
          comparison={gearComparison}
          currentCharacter={liveCharacter(gearComparison?.character || null, state.characters)}
          onOpenChange={(open) => {
            if (!open) setGearComparison(null);
          }}
        />
      </DeferredPanel>
      <Dialog
        open={!!actionError}
        onOpenChange={(open) => {
          if (!open) setActionError(null);
        }}
      >
        <DialogContent showCloseButton={false} className="border-rose-800 bg-[#0b1916] text-emerald-50">
          <DialogHeader>
            <DialogTitle>Couldn&apos;t complete action</DialogTitle>
            <DialogDescription className="text-rose-100">{actionError}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-rose-800 bg-[#0b1916]">
            <Button
              onClick={() => setActionError(null)}
              className="border border-emerald-500 bg-[#10392b] text-emerald-50 hover:bg-[#18513c] hover:text-white"
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={donationOpen} onOpenChange={setDonationOpen}>
        <DialogContent className="border-amber-800 bg-[#0b1916] text-emerald-50">
          <DialogHeader>
            <DialogTitle>Donate gold for merchant XP</DialogTitle>
            <DialogDescription>
              GoldMajesty will withdraw any shortage, travel to the XP frog, and donate this amount.
            </DialogDescription>
          </DialogHeader>
          <Input
            inputMode="numeric"
            value={donationAmount}
            onChange={(event) => setDonationAmount(event.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Donation amount"
            className="border-amber-800 bg-black/30 font-mono text-amber-100"
          />
          <div className="rounded border border-violet-900/70 bg-violet-950/20 p-3 font-mono text-sm text-violet-200">
            Preview:{" "}
            {abbreviatedGold(
              Math.floor(
                (Number(donationAmount) || 0) *
                  (state.merchantCharacter
                    ? state.characters[state.merchantCharacter]?.donationXpPerGold || 3.2
                    : 3.2),
              ),
            )}{" "}
            XP
            <span className="ml-2 text-[10px] text-violet-200/55">
              (
              {state.merchantCharacter
                ? state.characters[state.merchantCharacter]?.donationXpPerGold || 3.2
                : 3.2}{" "}
              XP/gold)
            </span>
          </div>
          {model.donationError && <p role="alert" className="text-sm text-rose-200">{model.donationError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDonationOpen(false)} className="border-slate-500 bg-slate-950 text-slate-100 hover:bg-slate-800 hover:text-white">
              Cancel
            </Button>
            <Button onClick={() => void donateGold()} className="bg-amber-400 text-amber-950">
              Donate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
