"use client";
import { useEffect, useState } from "react";
import { useSettingsWrite } from "./settings-write";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// The items owner's declared field (runtime/items/saved-fields.ts buyUpgradeBatchSize) holds the range; the write
// goes through the settings owner's writer with the page's basis, and its refusal shows here.
export function BuyUpgradeBatchSetting({ value = 1 }: { value?: number }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const settings = useSettingsWrite();
  return <fieldset disabled={!settings.ready || settings.pending} aria-busy={!settings.ready} className="space-y-3 rounded-lg border border-slate-600 bg-slate-900 p-4 text-sm text-slate-100">
    <label htmlFor="buy-upgrade-batch">Maximum number to buy at once for upgrading</label>
    <p className="text-xs text-slate-300">Default: 1. Buys up to this many items and their starting-tier scrolls per batch, within available space and order limits. Higher-tier scrolls are bought as needed. Every purchased item is finished, so a batch can produce extra target-level items.</p>
    <div className="flex gap-2">
      <Input id="buy-upgrade-batch" type="number" step={1} value={draft}
        onChange={event => setDraft(event.target.value)} className="border-slate-500 bg-slate-950 text-slate-100" />
      <Button disabled={!draft.trim()} onClick={() => void settings.write([{ field: "buyUpgradeBatchSize", value: Number(draft) }])}
        className="border border-emerald-400 bg-emerald-500 text-emerald-950 hover:bg-emerald-400">Apply</Button>
    </div>
    {settings.notice && <p role="alert" className="text-rose-200">{settings.notice}</p>}
  </fieldset>;
}
