"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { hostAction, PartyActionError } from "./query-actions";
import { polls } from "./query-cache";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {deploymentPending,type CandidateSummary,type Component,type ConsoleBuildStatus,type DeploymentJournal,type DeploymentMode} from "../../../runtime/lifecycle/api.ts";

const secondary = "border border-slate-500 bg-slate-950 text-slate-100 hover:bg-slate-800 hover:text-white";
type Selection = { manifest: CandidateSummary; changed: Component[] };
const pendingKey='party-console-pending-deployment';
function remember(operation:DeploymentJournal|null){try{if(operation)sessionStorage.setItem(pendingKey,JSON.stringify(operation));else sessionStorage.removeItem(pendingKey);}catch{}}

export function ConsoleBuildControl({onActiveChange}:{onActiveChange?:(id:string|undefined)=>void} = {}) {
  const client = useQueryClient();
  const [status, setStatus] = useState<ConsoleBuildStatus | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [menu, setMenu] = useState(false);
  const [menuSelection, setMenuSelection] = useState<Selection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The deploy request's own refusal, shown on the control until the next request.
  const [deployError, setDeployError] = useState("");
  // Load now during a Cave run waits for the player to tick that the run ends.
  const [caveConfirmed, setCaveConfirmed] = useState(false);
  const requested = useRef<{ id: string; target: string } | null>(null);
  const submittingRef = useRef(false);
  const dashboardHash=useRef<string|undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    try{const hint=JSON.parse(sessionStorage.getItem(pendingKey)||'null') as DeploymentJournal|null;if(hint&&deploymentPending(hint.phase)){requested.current={id:hint.id,target:hint.target};setStatus({builds:[],operation:hint});}}catch{}
    async function refresh() {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const value = await hostAction<ConsoleBuildStatus>(client, "/console-build", {}, { method: "GET", signal: controller.signal });
        if (controller.signal.aborted) return;
        setStatus(value);
        onActiveChange?.(value.active);
        const navigation=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined;
        dashboardHash.current ||= (window as Window & {__partyDashboardHash?:string}).__partyDashboardHash || navigation?.serverTiming?.find(timing=>timing.name==='party_dashboard')?.description || value.builds.find(build=>build.id===value.active)?.components.dashboard;
        if(value.operation&&deploymentPending(value.operation.phase))remember(value.operation);else remember(null);
        if (!requested.current && value.operation && deploymentPending(value.operation.phase))
          requested.current = {id: value.operation.id, target: value.operation.target};
        const own = requested.current;
        if (own && value.operation?.id === own.id && value.operation.target === own.target) {
          if (value.operation.phase === "complete" && value.active === own.target) {
            requested.current = null;
            const target=value.builds.find(build=>build.id===value.active)?.components.dashboard;
            if(target&&dashboardHash.current&&target!==dashboardHash.current){
              const key='party-console-handled-deployment';
              if(sessionStorage.getItem(key)!==own.id){sessionStorage.setItem(key,own.id);sessionStorage.setItem('party-console-scroll',String(window.scrollY));window.location.reload();}
            }
          } else if (value.operation.phase === "failed") {
            requested.current = null;
          }
        }
      } catch { /* Keep polling when activation temporarily interrupts the host. */ }
      finally { pending = false; }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), polls.build!.interval);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [client, onActiveChange]);

  async function deploy(mode: DeploymentMode = 'now', picked = selection) {
    if (!picked || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setDeployError("");
    try {
      // A 409 answers the deployment already running, which the control then follows.
      const reply = await hostAction(client, "/console-build/deploy", { buildId: picked.manifest.id, mode }).catch((failure: unknown) => {
        const operation = failure instanceof PartyActionError && failure.status === 409 ? failure.details.operation : undefined;
        if (!operation) throw failure instanceof PartyActionError && failure.details.error ? failure : new Error("Could not start deployment.");
        return operation;
      }) as unknown as DeploymentJournal;
      remember(reply);
      requested.current = { id: reply.id, target: reply.target };
      setStatus(previous => previous && { ...previous, operation: reply });
      setSelection(null);
      setMenu(false);
    } catch (error) {
      setDeployError(error instanceof Error ? error.message : String(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (!status) return null;
  const candidate = status.builds.find(build => build.id === status.available);
  const active = status.builds.find(build => build.id === status.active);
  const operation = status.operation;
  const busy = submitting || !!operation&&deploymentPending(operation.phase);
  const buildCount = Math.max(1, status.pendingBuildCount ?? status.builds.filter(build => build.id !== status.active && (!active || build.createdAt > active.createdAt)).length);
  return <>
    {(candidate && candidate.id !== status.active || busy) && <Popover open={menu} onOpenChange={open => {
      setMenu(open);
      if (open && candidate) { setMenuSelection({manifest: candidate, changed: (Object.keys(candidate.components) as Component[]).filter(key => candidate.components[key] !== active?.components[key])}); }
    }}><PopoverTrigger render={<Button
      size="icon" variant="outline" aria-busy={busy}
      aria-label="Deploy new console build" title="New console build ready to deploy"
      className="relative ml-3 border-emerald-500 bg-emerald-950 text-emerald-100 hover:bg-emerald-900 hover:text-white"
      />}><RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} /><span aria-label={`${buildCount} completed builds since deployment`} className="pointer-events-none absolute bottom-0.5 left-0.5 z-10 min-w-3 rounded bg-black/85 px-0.5 text-center font-mono text-[10px] leading-3 text-emerald-300">{buildCount}</span></PopoverTrigger>
      <PopoverContent data-area="build-load" align="start" className="w-48 border border-gray-300 bg-white p-1 text-black shadow-xl data-open:animate-none data-closed:animate-none" aria-label="Load console build">
        {busy&&operation&&<p className="px-2 py-1 text-xs text-black">{operation.phase.replaceAll('-',' ')} · {new Date(operation.phaseStartedAt||operation.startedAt).toLocaleTimeString()}</p>}
        {busy&&operation?.waiting?.length?<p className="px-2 py-1 text-xs text-black">Waiting: {operation.waiting.join(', ')}</p>:null}
        {operation?.error&&<p className="break-words px-2 py-1 text-xs text-red-700">{operation.error}</p>}
        {deployError&&<p className="break-words px-2 py-1 text-xs text-red-700">{deployError}</p>}
        <Button className="justify-start rounded-sm border-0 bg-white text-black hover:bg-gray-100 hover:text-black" disabled={busy} onClick={() => { setSelection(menuSelection); setCaveConfirmed(false); setMenu(false); }}>Load now</Button>
        <Button className="justify-start rounded-sm border-0 bg-white text-black hover:bg-gray-100 hover:text-black" disabled={busy||status.cave} onClick={() => void deploy('safe', menuSelection)}>Load when safe</Button>
        <Button className="justify-start rounded-sm border-0 bg-white text-black hover:bg-gray-100 hover:text-black" disabled={busy||status.cave} onClick={() => void deploy('main', menuSelection)}>Load at Main</Button>
      </PopoverContent>
    </Popover>}
    <Dialog open={!!selection} onOpenChange={open => { if (!open && !submitting) setSelection(null); }}>
      <DialogContent data-area="build-confirm" showCloseButton={false} className="border-slate-600 bg-[#091614] text-slate-100">
        <DialogHeader><DialogTitle>Load console build now?</DialogTitle><DialogDescription className="text-slate-300">Loading now may interrupt combat and briefly disconnect headless characters. Characters could die while reconnecting. Load now anyway?</DialogDescription></DialogHeader>
        {selection && <div className="space-y-2 text-sm">
          <p>Build: <span className="break-all font-mono">{selection.manifest.id}</span></p>
          <p>Built: {selection.manifest.createdAt}</p>
          <p>Changed components: {selection.changed.join(", ") || "none"}</p>
          <p>Source: <span className="break-all font-mono">{selection.manifest.sourceHash}</span></p>
          {selection.manifest.commit && <p>Revision: <span className="break-all font-mono">{selection.manifest.commit}</span>{selection.manifest.dirty ? " (includes local changes)" : ""}</p>}
        </div>}
        {status.cave && <label className="flex items-start gap-2 rounded border border-rose-500 bg-[#2a1018] p-2 text-sm text-rose-100">
          <input type="checkbox" className="mt-1" checked={caveConfirmed} onChange={event => setCaveConfirmed(event.target.checked)} />
          <span>A Cave run is active. Loading now ends the run, and the party may die in the Cave while it reconnects.</span>
        </label>}
        {deployError && <p className="break-words text-sm text-red-300">{deployError}</p>}
        <div className="flex justify-end gap-2">
          <Button disabled={submitting} className={secondary} onClick={() => setSelection(null)}>Cancel</Button>
          <Button disabled={busy || (!!status.cave && !caveConfirmed)} className="border border-emerald-500 bg-emerald-950 text-emerald-100 hover:bg-emerald-900 hover:text-white" onClick={() => void deploy()}>Load now</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
