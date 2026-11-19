"use client";
import {GatheringToolSettings} from "./gathering-tool-settings";
import { BankSortControl, type BankSortState } from "./bank-sort-control";
import { BuyUpgradeBatchSetting } from "./buy-upgrade-batch-setting";
import { MerchantStandLocationSetting } from './merchant-stand-location-setting';
import { MerchantTripSetting } from "./merchant-trip-setting";
import { MerchantRealmBlacklistSetting } from "./merchant-realm-blacklist-setting";
import type { RealmOption } from "./realm-option";
import { useState } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OverlaidBy } from "../../../runtime/hooks/dashboard/slots";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
export interface MerchantCollectionSettingsProps {
  buyUpgradeBatchSize?: number;
  toolCrafting?: Record<string,boolean>;
  merchantStandLocation?: import('../../../runtime/merchant-jobs/api.ts').MerchantStandLocation | null;
  bankSortState?: BankSortState;
  deliveryTripsEnabled?: boolean;
  withdrawalTripsEnabled?: boolean;
  realms?: RealmOption[];
  realmBlacklist?: string[];
  thresholdError?: string | null;
  itemCollectionThresholdError?: string | null;
  onClearErrors: () => void;
  threshold: string;
  onThresholdChange(value: string): void;
  onThresholdSave(): Promise<void>;
  itemCollectionThreshold: string;
  onItemCollectionThresholdChange(value: string): void;
  onItemCollectionThresholdSave(): Promise<void>;
}
export function MerchantCollectionSettings({toolCrafting,buyUpgradeBatchSize, merchantStandLocation, deliveryTripsEnabled = true, withdrawalTripsEnabled = true, realms, realmBlacklist, thresholdError, itemCollectionThresholdError, onClearErrors, bankSortState = {},threshold,onThresholdChange,onThresholdSave,itemCollectionThreshold,onItemCollectionThresholdChange,onItemCollectionThresholdSave}: MerchantCollectionSettingsProps) {
 const [open,setOpen]=useState(false);
 return <>
  <Button variant="outline" onClick={()=>setOpen(true)} className="h-9 border-slate-600 bg-[#07100f] text-xs text-slate-100 hover:bg-slate-800 hover:text-white"><Settings className="mr-1.5 size-3.5" />Settings</Button>
  <Dialog open={open} onOpenChange={open => { onClearErrors(); setOpen(open); }}>
   <DialogContent data-area="collection-settings" aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto border-slate-600 bg-slate-950 text-slate-100 sm:max-w-2xl">
    <DialogHeader><DialogTitle>Merchant settings</DialogTitle></DialogHeader>
    <OverlaidBy fields={["merchantAutomations", "protectedFreeSlots"]} />
          <BankSortControl state={bankSortState} settings />
          <GatheringToolSettings enabled={toolCrafting} />
          <BuyUpgradeBatchSetting value={buyUpgradeBatchSize} />
          <MerchantStandLocationSetting location={merchantStandLocation} />
          <MerchantTripSetting routine="deliveries" enabled={deliveryTripsEnabled} />
          <MerchantTripSetting routine="withdrawals" enabled={withdrawalTripsEnabled} />
          <MerchantRealmBlacklistSetting realms={realms} blacklist={realmBlacklist} />
          <div className="grid gap-4 md:grid-cols-2">
          <ThresholdSetting id="merchant-gold-threshold" title="Automatic gold collection" field="Collect above"
            help="Send the merchant when any active character carries more than this amount."
            value={threshold} onChange={onThresholdChange} onSave={onThresholdSave} error={thresholdError}
            tone={{ section: "border-emerald-900/80", title: "text-emerald-400", label: "text-emerald-200", input: "border-emerald-800", button: "border-emerald-400 bg-emerald-500 text-emerald-950 hover:bg-emerald-400" }} />
          <ThresholdSetting id="item-collection-threshold" title="Automatic item collection" field="Marked slots required"
            help="Start a collection trip when one party member or the bank has this many marked slots. Bank collection also runs when marked withdrawals do not always create jobs. Smaller pickups run only while the merchant is within 200 units. Queued pickups and retries recheck this rule. NPC-sale marks count toward this threshold. Manual visits and other merchant jobs still collect immediately."
            value={itemCollectionThreshold} onChange={onItemCollectionThresholdChange} onSave={onItemCollectionThresholdSave} error={itemCollectionThresholdError}
            tone={{ section: "border-violet-900/80", title: "text-violet-300", label: "text-violet-200", input: "border-violet-800", button: "border-violet-400 bg-violet-500 text-black hover:bg-violet-400" }} />
          </div>
</DialogContent></Dialog></>;
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
