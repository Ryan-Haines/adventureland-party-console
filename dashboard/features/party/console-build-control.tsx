"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CandidateManifest, Component, ConsoleBuildStatus, DeploymentJournal } from "../../../tools/console-build/contracts";

const secondary = "border border-slate-500 bg-slate-950 text-slate-100 hover:bg-slate-800 hover:text-white";
type Selection = { manifest: CandidateManifest; changed: Component[] };

export function ConsoleBuildControl() {
  const [status, setStatus] = useState<ConsoleBuildStatus | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [menu, setMenu] = useState(false);
  const [menuSelection, setMenuSelection] = useState<Selection | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const requested = useRef<{ id: string; target: string } | null>(null);
  const submittingRef = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const response = await fetch("/console-build", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const value = await response.json() as ConsoleBuildStatus;
        if (controller.signal.aborted) return;
        setStatus(value);
        if (!requested.current && value.operation && ['waiting-safe', 'activating', 'rolling-back'].includes(value.operation.phase))
          requested.current = {id: value.operation.id, target: value.operation.target};
        const own = requested.current;
        if (own && value.operation?.id === own.id && value.operation.target === own.target) {
          if (value.operation.phase === "complete" && value.active === own.target) {
            requested.current = null;
            window.location.reload();
          } else if (value.operation.phase === "failed") {
            requested.current = null;
            setError(value.operation.error || "Deployment failed; the previous build was restored.");
          }
        }
      } catch { /* Keep polling when activation temporarily interrupts the host. */ }
      finally { pending = false; }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  async function deploy(mode: 'now' | 'safe' = 'now', picked = selection) {
    if (!picked || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/console-build/deploy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildId: picked.manifest.id, mode }),
      });
      const reply = await response.json() as DeploymentJournal & { error?: string };
      if (!response.ok) throw new Error(reply.error || "Could not start deployment.");
      requested.current = { id: reply.id, target: picked.manifest.id };
      setStatus(previous => previous && { ...previous, operation: reply });
      setSelection(null);
      setMenu(false);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not start deployment.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (!status) return null;
  const candidate = status.builds.find(build => build.id === status.available);
  const active = status.builds.find(build => build.id === status.active);
  const operation = status.operation;
  const busy = submitting || operation?.phase === "waiting-safe" || operation?.phase === "activating" || operation?.phase === "rolling-back";
  return <>
    {status.building && <output className="ml-3 text-xs text-slate-300">Building candidate… Running code unchanged.</output>}
    {status.buildError && <span role="alert" className="ml-3 max-w-sm text-xs text-rose-200">Build failed: {status.buildError}. Running code unchanged.</span>}
    {(candidate && candidate.id !== status.active || busy) && <Popover open={menu} onOpenChange={open => {
      setMenu(open);
      if (open && candidate) { setError(""); setMenuSelection({manifest: candidate, changed: (Object.keys(candidate.components) as Component[]).filter(key => candidate.components[key] !== active?.components[key])}); }
    }}><PopoverTrigger render={<Button
      size="icon" variant="outline" disabled={busy}
      aria-label="Deploy new console build" title="New console build ready to deploy"
      className="ml-3 border-emerald-500 bg-emerald-950 text-emerald-100 hover:bg-emerald-900 hover:text-white"
      />}><RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} /></PopoverTrigger>
      <PopoverContent align="start" className="w-48 border border-gray-300 bg-white p-1 text-black shadow-xl data-open:animate-none data-closed:animate-none" aria-label="Load console build">
        <Button className="justify-start rounded-sm border-0 bg-white text-black hover:bg-gray-100 hover:text-black" disabled={busy} onClick={() => { setSelection(menuSelection); setMenu(false); }}>Load now</Button>
        <Button className="justify-start rounded-sm border-0 bg-white text-black hover:bg-gray-100 hover:text-black" disabled={busy} onClick={() => void deploy('safe', menuSelection)}>Load when safe</Button>
      </PopoverContent>
    </Popover>}
    {busy && <output className="ml-3 text-xs text-cyan-200">{operation?.phase === 'waiting-safe' ? 'Waiting for combat to finish; new targets paused…' : operation?.phase === "rolling-back" ? "Restoring previous build…" : "Deploying build; reconnecting…"}</output>}
    {(error || operation?.phase === "failed" || operation?.phase === "rolling-back" && operation.error) && <span role="alert" className="ml-3 max-w-sm text-xs text-rose-200">{error || operation?.error || "Deployment failed."}</span>}
    <Dialog open={!!selection} onOpenChange={open => { if (!open && !submitting) setSelection(null); }}>
      <DialogContent showCloseButton={false} className="border-slate-600 bg-[#091614] text-slate-100">
        <DialogHeader><DialogTitle>Load console build now?</DialogTitle><DialogDescription className="text-slate-300">Loading now may interrupt combat and briefly disconnect headless characters. Characters could die while reconnecting. Load now anyway?</DialogDescription></DialogHeader>
        {selection && <div className="space-y-2 text-sm">
          <p>Build: <span className="break-all font-mono">{selection.manifest.id}</span></p>
          <p>Built: {selection.manifest.createdAt}</p>
          <p>Changed components: {selection.changed.join(", ") || "none"}</p>
          <p>Source: <span className="break-all font-mono">{selection.manifest.sourceHash}</span></p>
          {selection.manifest.commit && <p>Revision: <span className="break-all font-mono">{selection.manifest.commit}</span>{selection.manifest.dirty ? " (includes local changes)" : ""}</p>}
        </div>}
        {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button disabled={submitting} className={secondary} onClick={() => setSelection(null)}>Cancel</Button>
          <Button disabled={busy} className="border border-emerald-500 bg-emerald-950 text-emerald-100 hover:bg-emerald-900 hover:text-white" onClick={() => void deploy()}>Load now</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
