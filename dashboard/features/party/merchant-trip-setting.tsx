"use client";
import { usePartyAction } from "./query-actions";
import { useState } from "react";

// The two "always create merchant jobs" switches of the merchant settings. Each shows the value you
// asked for until its save settles, then the saved value the merchant settings read back.
const TRIPS = {
  deliveries: {
    label: "Marked deliveries always create merchant jobs",
    help: "When disabled, the merchant completes marked deliveries when visiting the party for another reason, " +
      "such as item collection. It will not make a trip for deliveries alone unless you use Send to party " +
      "or send the merchant to a specific character.",
  },
  withdrawals: {
    label: "Marked withdrawals always create merchant jobs",
    help: "When disabled, marked withdrawals create a collection trip at the automatic item collection threshold, " +
      "or wait for another bank visit below that threshold. " +
      "When enabled, pending withdrawal marks create a bank trip at the Marked withdrawals routine priority.",
  },
} as const;

export function MerchantTripSetting({ routine, enabled = true }: { routine: keyof typeof TRIPS; enabled?: boolean }) {
  const action = usePartyAction();
  const [pendingChecked, setPendingChecked] = useState<boolean | null>(null);
  const help = `${routine}-trip-help`;
  return <fieldset disabled={action.isPending} className="space-y-2 rounded-lg border border-slate-600 bg-slate-900 p-4 text-sm text-slate-100">
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={pendingChecked ?? enabled} aria-describedby={help}
        onChange={event => {
          action.reset();
          setPendingChecked(event.target.checked);
          action.mutate({ path: "/merchant/routine-priorities", body: { priorities: {}, enabled: { [routine]: event.target.checked } } },
            { onSettled: () => setPendingChecked(null) });
        }}
        className="size-4 border border-slate-400 bg-slate-950 accent-emerald-400" />
      {TRIPS[routine].label}
    </label>
    <p id={help} className="text-xs text-slate-300">{TRIPS[routine].help}</p>
    {action.error && <p role="alert" className="text-rose-200">{action.error.message}</p>}
  </fieldset>;
}
