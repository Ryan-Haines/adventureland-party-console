"use client";
// The merchant's Merchant section in the settings menu, which was the card's Merchant settings
// dialog. The card's "Settings" button keeps its place and look and opens the menu here.
import {GatheringToolSettings} from "./gathering-tool-settings";
import { BankSortControl } from "./bank-sort-control";
import { BuyUpgradeBatchSetting } from "./buy-upgrade-batch-setting";
import { MerchantStandLocationSetting } from './merchant-stand-location-setting';
import { MerchantTripSetting } from "./merchant-trip-setting";
import { MerchantRealmBlacklistSetting } from "./merchant-realm-blacklist-setting";
import { useEffect } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OverlaidBy } from "../../../runtime/hooks/dashboard/slots";
import type { PartyConsoleModel } from "./use-party-console";

export function MerchantSettingsButton({ onOpen }: { onOpen: () => void }) {
  return <Button variant="outline" onClick={onOpen} className="h-9 border-slate-600 bg-[#07100f] text-xs text-slate-100 hover:bg-slate-800 hover:text-white"><Settings className="mr-1.5 size-3.5" />Settings</Button>;
}

export function MerchantSettingsSection({ model }: { model: PartyConsoleModel }) {
  const { state, thresholdError, itemCollectionThresholdError, clearCollectionErrors, threshold, editThreshold, save,
    itemCollectionThreshold, editItemCollectionThreshold, saveItemCollectionThreshold } = model;
  // A threshold refusal from an earlier visit does not show when the section opens, as the dialog
  // cleared it when it opened.
  useEffect(() => clearCollectionErrors(), [clearCollectionErrors]);
  return <section data-area="collection-settings" className="space-y-4">
    <OverlaidBy fields={["merchantAutomations", "protectedFreeSlots"]} />
    <BankSortControl state={state} settings />
    <GatheringToolSettings enabled={state.merchantAutomations} />
    <BuyUpgradeBatchSetting value={state.buyUpgradeBatchSize} />
    <MerchantStandLocationSetting location={state.merchantStandLocation} />
    <MerchantTripSetting routine="deliveries" enabled={state.merchantAutomations?.deliveries !== false} />
    <MerchantTripSetting routine="withdrawals" enabled={state.merchantAutomations?.withdrawals !== false} />
    <MerchantRealmBlacklistSetting realms={state.realmControl?.realms} blacklist={state.merchantRealmBlacklist} />
    <div className="grid gap-4 md:grid-cols-2">
    <ThresholdSetting id="merchant-gold-threshold" title="Automatic gold collection" field="Collect above"
      help="Send the merchant when any active character carries more than this amount."
      value={threshold} onChange={editThreshold} onSave={save} error={thresholdError}
      tone={{ section: "border-emerald-900/80", title: "text-emerald-400", label: "text-emerald-200", input: "border-emerald-800", button: "border-emerald-400 bg-emerald-500 text-emerald-950 hover:bg-emerald-400" }} />
    <ThresholdSetting id="item-collection-threshold" title="Automatic item collection" field="Marked slots required"
      help="Start a collection trip when one party member or the bank has this many marked slots. Bank collection also runs when marked withdrawals do not always create jobs. Smaller pickups run only while the merchant is within 200 units. Queued pickups and retries recheck this rule. NPC-sale marks count toward this threshold. Manual visits and other merchant jobs still collect immediately."
      value={itemCollectionThreshold} onChange={editItemCollectionThreshold} onSave={saveItemCollectionThreshold} error={itemCollectionThresholdError}
      tone={{ section: "border-violet-900/80", title: "text-violet-300", label: "text-violet-200", input: "border-violet-800", button: "border-violet-400 bg-violet-500 text-black hover:bg-violet-400" }} />
    </div>
  </section>;
}
// One collection threshold: its words, a whole-number box and Apply, and the save's refusal.
function ThresholdSetting({ id, title, field, help, value, onChange, onSave, error, tone }: {
  id: string; title: string; field: string; help: string; value: string; onChange(value: string): void; onSave(): Promise<void>;
  error?: string | null; tone: { section: string; title: string; label: string; input: string; button: string };
}) {
  return <section data-area="collection-settings-body" className={`rounded-lg border ${tone.section} bg-slate-900 p-4`}>
    <p className={`font-mono text-xs uppercase tracking-wider ${tone.title}`}>{title}</p>
    <p className="mt-1 text-xs text-slate-300">{help}</p>
    <div className="mt-3 flex items-end gap-2">
      <label htmlFor={id} className={`grid min-w-0 flex-1 gap-1.5 font-mono text-xs ${tone.label}`}>
        {field}
        <Input id={id} inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ""))}
          className={`${tone.input} bg-slate-950 font-mono text-slate-100`} />
      </label>
      <Button type="button" onClick={() => void onSave()} className={`border ${tone.button}`}>Apply</Button>
    </div>
    {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
  </section>;
}
