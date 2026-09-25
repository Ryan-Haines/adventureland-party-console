"use client";
import { usePartyAction } from "./query-actions";

export function DeliveryTripSetting({ enabled = true }: { enabled?: boolean }) {
  const action = usePartyAction();
  return <fieldset disabled={action.isPending} className="space-y-2 rounded-lg border border-slate-600 bg-slate-900 p-4 text-sm text-slate-100">
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={enabled} aria-describedby="delivery-trip-help"
        onChange={event => {
          action.reset();
          action.mutate({ path: "/merchant/routine-priorities", body: { priorities: {}, enabled: { deliveries: event.target.checked } } });
        }}
        className="size-4 border border-slate-400 bg-slate-950 accent-emerald-400" />
      Marked deliveries create merchant jobs
    </label>
    <p id="delivery-trip-help" className="text-xs text-slate-300">
      When disabled, the merchant completes marked deliveries when visiting the party for another reason,
      such as item collection. It will not make a trip for deliveries alone unless you use Send to party
      or send the merchant to a specific character.
    </p>
    {action.error && <p role="alert" className="text-rose-200">{action.error.message}</p>}
  </fieldset>;
}
