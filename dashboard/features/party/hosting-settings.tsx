"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function HostingSettings() {
  const [required, setRequired] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/setup/state").then(async response => {
      if (!response.ok) throw new Error("Open /setup to pair this browser.");
      const state = await response.json() as { requirePairing: boolean; error?: string };
      if (active) setRequired(state.requirePairing);
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  async function change(requirePairing: boolean) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/setup/pairing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requirePairing }) });
      const result = await response.json() as { requirePairing: boolean; error?: string };
      if (!response.ok) throw new Error(result.error);
      setRequired(result.requirePairing);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded border border-slate-600 bg-slate-950 p-4 text-sm text-slate-100">
    <label className="flex items-center gap-3 font-semibold">
      <input type="checkbox" className="size-4 accent-violet-500" checked={required === true} disabled={busy || required === null} onChange={event => void change(event.target.checked)} />
      Require secure pairing
    </label>
    <p>Require paired browsers and private Steam connection tokens. Recommended when hosting at a publicly accessible URL; use HTTPS. When off, anyone who can reach this dashboard can control it.</p>
    {required && <p className="text-amber-200">This browser is authorized. Unpaired browsers and tokenless Steam loaders must reconnect using an invitation or a new private loader.</p>}
    <Button onClick={() => { location.href = "/setup"; }} variant="outline" className="border-slate-500 bg-slate-950 text-slate-100 hover:bg-slate-800 hover:text-white">{required ? "Browser invitations and Steam loaders" : "Generate Steam loader"}</Button>
    {error && <p role="alert" className="text-rose-300">{error}</p>}
  </section>;
}
