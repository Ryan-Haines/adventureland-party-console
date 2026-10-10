"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CandidateManifest, Component, ConsoleBuildStatus, DeploymentJournal } from "../../../tools/console-build/contracts";

const secondary = "border border-slate-500 bg-slate-950 text-slate-100 hover:bg-slate-800 hover:text-white";
type Selection = { manifest: CandidateManifest; changed: Component[] };

export function ConsoleBuildControl() {
  const [status, setStatus] = useState<ConsoleBuildStatus | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
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

  async function deploy() {
    if (!selection || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/console-build/deploy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildId: selection.manifest.id }),
      });
      const reply = await response.json() as DeploymentJournal & { error?: string };
      if (!response.ok) throw new Error(reply.error || "Could not start deployment.");
      requested.current = { id: reply.id, target: selection.manifest.id };
      setStatus(previous => previous && { ...previous, operation: reply });
      setSelection(null);
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
  const busy = submitting || operation?.phase === "activating" || operation?.phase === "rolling-back";
  return <>
    {status.building && <output className="ml-3 text-xs text-slate-300">Building candidate… Running code unchanged.</output>}
    {status.buildError && <span role="alert" className="ml-3 max-w-sm text-xs text-rose-200">Build failed: {status.buildError}. Running code unchanged.</span>}
    {candidate && candidate.id !== status.active && <Button
      size="icon" variant="outline" disabled={busy}
      aria-label="Deploy new console build" title="New console build ready to deploy"
      className="ml-3 border-emerald-500 bg-emerald-950 text-emerald-100 hover:bg-emerald-900 hover:text-white"
      onClick={() => {
        setError("");
        setSelection({ manifest: candidate, changed: (Object.keys(candidate.components) as Component[]).filter(key => candidate.components[key] !== active?.components[key]) });
      }}><RefreshCw className="size-4" /></Button>}
    {busy && <output className="ml-3 text-xs text-cyan-200">{operation?.phase === "rolling-back" ? "Restoring previous build…" : "Deploying build; reconnecting…"}</output>}
    {(error || operation?.phase === "failed" || operation?.phase === "rolling-back" && operation.error) && <span role="alert" className="ml-3 max-w-sm text-xs text-rose-200">{error || operation?.error || "Deployment failed."}</span>}
    <Dialog open={!!selection} onOpenChange={open => { if (!open && !submitting) setSelection(null); }}>
      <DialogContent showCloseButton={false} className="border-slate-600 bg-[#091614] text-slate-100">
        <DialogHeader><DialogTitle>Deploy console build?</DialogTitle><DialogDescription className="text-slate-300">Deployment interrupts activity. Coordinator changes briefly reconnect headless characters. No compilation is performed during deployment.</DialogDescription></DialogHeader>
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
          <Button disabled={busy} className="border border-emerald-500 bg-emerald-950 text-emerald-100 hover:bg-emerald-900 hover:text-white" onClick={() => void deploy()}>Deploy build</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
