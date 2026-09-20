"use client";
import { useEffect, useRef, useState } from "react";
import { probeDashboard, recoveryStoragePrefix, startRecovery, type RecoveryStatus, type SupervisorState } from "@/lib/dashboard-recovery";

export function useDashboardRecovery(enabled: boolean, report?: (state: SupervisorState) => void) {
  const [status, setStatus] = useState<RecoveryStatus>({seconds: 1, checking: false, blocked: false});
  const current = useRef<ReturnType<typeof startRecovery> | null>(null);
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    if (!enabled) return;
    const key = recoveryStoragePrefix;
    const recovery = startRecovery({
      now: Date.now,
      later: (fn, ms) => window.setTimeout(fn, ms),
      cancel: timer => window.clearTimeout(timer as number),
      probe: signal => probeDashboard(window.fetch.bind(window), window.location.pathname + window.location.search,
        signal, state => reportRef.current?.(state), !!reportRef.current),
      claimed: instance => { try { return sessionStorage.getItem(key + instance) === "1"; } catch { return true; } },
      claim: instance => sessionStorage.setItem(key + instance, "1"),
      reload: () => window.location.reload(),
      update: setStatus,
    });
    current.current = recovery;
    return () => { recovery.dispose(); current.current = null; };
  }, [enabled]);
  return { ...status, retry: () => current.current?.retry(), reload: () => window.location.reload() };
}
