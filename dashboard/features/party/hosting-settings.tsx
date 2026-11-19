"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { hostAction } from "./query-actions";
import { Button } from "@/components/ui/button";

export function HostingSettings() {
  const [required, setRequired] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const client = useQueryClient();
  // The pairing host's read goes through the action client, so a lost session ends the session.
  useEffect(() => {
    let active = true;
    hostAction<{ requirePairing: boolean }>(client, "/setup/state", {}, { method: "GET" })
      .then(state => { if (active) setRequired(state.requirePairing); })
      .catch((failure: Error) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [client]);
  async function change(requirePairing: boolean) {
    setBusy(true); setError("");
    try {
      const result = await hostAction(client, "/setup/pairing", { requirePairing }) as { requirePairing: boolean };
      setRequired(result.requirePairing);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section data-area="hosting" className="space-y-3 rounded border border-slate-600 bg-slate-950 p-4 text-sm text-slate-100">
    <label className="flex items-center gap-3 font-semibold">
      <input type="checkbox" className="size-4 accent-violet-500" checked={required === true} disabled={busy || required === null} onChange={event => void change(event.target.checked)} />
      Require secure pairing
    </label>
    <p>Require paired browsers and private Steam connection tokens. Recommended when hosting at a publicly accessible URL; use HTTPS. When off, anyone who can reach this dashboard can control it.</p>
    {required && <p className="text-amber-200">This browser is authorized. Unpaired browsers and tokenless Steam loaders must reconnect using an invitation or a new private loader.</p>}
    <Button onClick={() => { location.href = "/setup"; }} variant="outline" className="border-slate-500 bg-slate-950 text-slate-100 hover:bg-slate-800 hover:text-white">Load setup</Button>
    {error && <p role="alert" className="text-rose-300">{error}</p>}
  </section>;
}
