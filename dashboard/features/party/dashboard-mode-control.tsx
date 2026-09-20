"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDashboardRecovery } from "@/hooks/use-dashboard-recovery";
import type { SupervisorState } from "@/lib/dashboard-recovery";

export function DashboardModeControl() {
  const [state, setState] = useState<SupervisorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const recovery = useDashboardRecovery(requested, setState);
  useEffect(() => {
    if (requested) return;
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const response = await fetch("/__dashboard/state", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) return;
        const result = (await response.json()) as SupervisorState;
        if (!controller.signal.aborted) setState(result);
      } catch {
        /* Direct npm dev does not expose the launcher supervisor. */
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [requested]);

  async function change(production: boolean) {
    setError(null);
    try {
      const response = await fetch("/__dashboard/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: production ? "production" : "development",
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not change dashboard mode");
      setState((previous) => previous && { ...previous, busy: true });
      setRequested(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Mode change failed");
    }
  }

  if (state?.immutable) return (
    <section className="rounded border border-slate-700 bg-[#07100f] p-4 text-slate-100">
      <p>Docker production build. Rebuild the image to install updates.</p>
      <Button onClick={() => window.location.assign("/setup")} className="mt-2 border border-slate-500 bg-slate-900 text-white hover:bg-slate-700 hover:text-white">Pair devices and manage Steam connections</Button>
    </section>
  );
  return (
    <section className="rounded border border-slate-700 bg-[#07100f] p-4 text-slate-100">
      <label htmlFor="dashboard-production-mode" className="flex items-center gap-3 font-semibold">
        <Checkbox
          id="dashboard-production-mode"
          checked={state?.mode === "production"}
          disabled={!state || state.busy}
          onCheckedChange={(checked) => void change(checked === true)}
          aria-label="Production build"
        />
        Production build
      </label>
      <p className="mt-2 text-sm text-slate-300">
        Uses fewer resources. Requested rebuilds refresh this page automatically when ready. Development mode
        updates automatically.
      </p>
      {!state ? (
        <p className="mt-2 text-xs text-slate-400">
          Start the dashboard through the repository launcher to change modes here.
        </p>
      ) : null}
      {state?.busy ? (
        <output className="mt-2 block text-sm text-cyan-200">
          Preparing dashboard. The current version stays available.
        </output>
      ) : null}
      {error || state?.error ? (
        <p role="alert" className="mt-2 text-sm text-rose-200">
          {error || state?.error}
        </p>
      ) : null}
      {requested && <output className="mt-2 block text-sm text-cyan-200">
        {recovery.checking ? "Checking dashboard…" : `Checking again in ${recovery.seconds}s…`}
        {recovery.blocked && " Automatic reload already attempted for this version. Retry manually if needed."}
      </output>}
      <div className="mt-3 flex gap-2">
        {state?.mode === "production" ? (
          <Button
            disabled={state.busy}
            variant="outline"
            onClick={() => void change(true)}
            className="border-slate-500 bg-[#07100f] text-slate-100 hover:bg-slate-800 hover:text-white"
          >
            Rebuild
          </Button>
        ) : null}
        {requested ? (
          <Button
            variant="outline"
            disabled={recovery.checking}
            onClick={recovery.retry}
            className="border-cyan-600 bg-[#07100f] text-cyan-100 hover:bg-cyan-950 hover:text-white"
          >
            Retry now
          </Button>
        ) : null}
      </div>
    </section>
  );
}
