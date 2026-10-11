"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SupervisorState } from "@/lib/dashboard-recovery";
export function DashboardModeControl() {
  const [state, setState] = useState<SupervisorState | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/__dashboard/state", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (response.ok) {
          const value = await response.json() as SupervisorState;
          if (!controller.signal.aborted) setState(value);
        }
      }).catch(() => { /* Isolated development has no launcher supervisor. */ });
    return () => controller.abort();
  }, []);
  return <section className="rounded border border-slate-700 bg-[#07100f] p-4 text-slate-100">
    <h3 className="font-semibold">Console builds</h3>
    <p className="mt-2 text-sm text-slate-300">{state?.immutable
      ? "Docker production build. Rebuild the image to install updates."
      : state ? "Source changes build in the background. Use the refresh icon beside Party Console to deploy a completed build when you are ready. Building does not change running code."
      : "Managed launches stage source changes for explicit deployment. Direct development servers retain their isolated development workflow."}</p>
    {state?.immutable && <Button onClick={() => window.location.assign("/setup")} className="mt-2 border border-slate-500 bg-slate-900 text-white hover:bg-slate-700 hover:text-white">Pair devices and manage Steam connections</Button>}
  </section>;
}
