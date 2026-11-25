"use client";
import { ExchangeItemSelection } from './exchange-item-selection';
import {loadCharacterInspection} from "./load-character-inspection";
import { useQueryClient } from '@tanstack/react-query';
import { createContext, lazy, useContext, useEffect, useState, type ReactNode } from "react";
import { DeferredPanel } from "./deferred-panel";
const ItemDetails = lazy(() =>
  import("./item-details").then((module) => ({ default: module.ItemDetails })),
);
import { standDraft, standIsFull } from "./stand-capacity";
import type { PartyConsoleModel } from "./use-party-console";

import { usePanelModel } from "./use-panel-model";
import { ExchangeRewardTile } from './exchange-reward-tile';
import { inventoryWithCatalogMeta } from './item-catalog-meta';
import { UpgradeOfferingProvider } from './upgrade-offering-controls';
import type { SelectedItem } from './selected-item';

// Only a mounted nested inspector subscribes to this model. Character cards do
// not need the full model or a changing render callback to open catalog details.
const InspectionModel = createContext<PartyConsoleModel | null>(null);
export function ItemInspectionProvider({model,children}:{model:PartyConsoleModel;children:ReactNode}) {
  return <InspectionModel.Provider value={model}>{children}</InspectionModel.Provider>;
}
export function NestedItemDetails({itemId,onClose}:{itemId:string;onClose:()=>void}) {
  const model=useContext(InspectionModel);
  const [selected,setSelected]=useState<SelectedItem|null>(()=>({character:"Witch's Cipher",entry:{slot:-1,item:{name:itemId},
    meta:model?.state.merchantCatalog?.allItems?.find(item=>item.id===itemId)?.meta}}));
  useEffect(()=>{if(!selected)onClose();},[selected,onClose]);
  return model&&selected?<PartyItemDetails model={{...model,selected,setSelected}}/>:null;
}
export function PartyItemDetails({ model }: { model: PartyConsoleModel }) {
  return model.selected ? <PartyItemDetailsConnected base={model} /> : null;
}
function PartyItemDetailsConnected({ base }: { base: PartyConsoleModel }) {
  const model = usePanelModel(base, { inventory: true, vitals: true, diagnostics: true, bank: true, market: true });
  const client = useQueryClient();
  const {
    state,
    chars,
    setActionError,
    setStandItem,
    setSelected,
    setGearComparison,
    selected,
    monsterAchievements,
    setMonsterNavigateTarget,
    setWtbItem,
  } = model;
  return (
    <DeferredPanel active={!!selected}>
      <ExchangeItemSelection>
      <UpgradeOfferingProvider character={String(state.merchantCharacter)} executor={state.merchantCharacter} stock={state.upgradeOfferingStock || {}} rules={state.upgradeOfferingRules || []} catalog={state.merchantCatalog?.allItems || []} post={model.post}>
      <ItemDetails
        renderExchangeReward={(reward) => (
              <ExchangeRewardTile reward={reward} model={model} />
            )}
        selected={selected}
        catalog={state.merchantCatalog?.allItems || []}
        exchanges={state.merchantCatalog?.exchangeable || []}
        monsters={state.bestiaryCatalog || []}
        skills={state.skillCatalog || []}
        characters={[
              ...chars,
              // Saved snapshots carry per-copy item meta; the catalog supplies the rest.
              ...Object.values(state.characterSnapshots || {}).filter(
                (saved) => !chars.some((live) => live.name === saved.name),
              ).map((saved) => inventoryWithCatalogMeta(state.merchantCatalog, saved)!),
            ]}
        offlineCharacters={(state.roster || []).filter(member=>!chars.some(live=>live.name===member.name) && !state.characterSnapshots?.[member.name])}
        onLoadCharacter={(name) => loadCharacterInspection(client, name)}
        achievements={monsterAchievements}
        standFull={standIsFull(state)}
        onNavigate={(monster) => setMonsterNavigateTarget(monster)}
        onAddWTB={(item, meta) => setWtbItem({ item, meta })}
        onAddStand={(entry, source) => {
          const press = standDraft(state, entry, source.kind === "bank" ? source.pack : undefined);
          if ('refused' in press) return setActionError(press.refused);
          setStandItem(press.draft);
        }}
        onCompare={(character, entry, slot) => {
          setSelected(null);
          setGearComparison({ character, entry, slot });
        }}
        onCompareCatalog={(entry) => {
          setSelected(null);
          model.setCatalogComparison(entry);
          model.setCatalogOpen(true);
        }}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
      </UpgradeOfferingProvider>
    </ExchangeItemSelection>
    </DeferredPanel>
  );
}
