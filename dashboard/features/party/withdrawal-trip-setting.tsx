"use client";
import { usePartyAction } from "./query-actions";
import { useState } from "react";

export function WithdrawalTripSetting({ enabled = true }: { enabled?: boolean }) {
  const action = usePartyAction();
  const [pendingChecked, setPendingChecked] = useState<boolean | null>(null);
  return <fieldset disabled={action.isPending} className="space-y-2 rounded-lg border border-slate-600 bg-slate-900 p-4 text-sm text-slate-100">
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={pendingChecked ?? enabled} aria-describedby="withdrawal-trip-help"
        onChange={event => {
          action.reset();
          setPendingChecked(event.target.checked);
          action.mutate({ path: "/merchant/routine-priorities", body: { priorities: {}, enabled: { withdrawals: event.target.checked } } },
            { onSettled: () => setPendingChecked(null) });
        }}
        className="size-4 border border-slate-400 bg-slate-950 accent-emerald-400" />
      Marked withdrawals always create merchant jobs
    </label>
    <p id="withdrawal-trip-help" className="text-xs text-slate-300">
      When disabled, marked withdrawals create a collection trip at the automatic item collection threshold,
      or wait for another bank visit below that threshold.
      When enabled, pending withdrawal marks create a bank trip at the Marked withdrawals routine priority.
    </p>
    {action.error && <p role="alert" className="text-rose-200">{action.error.message}</p>}
  </fieldset>;
}
