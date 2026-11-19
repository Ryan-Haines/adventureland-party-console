"use client";
import { AddonSlot } from '../../../runtime/hooks/dashboard/slots';
import { useEffect, useRef, useState } from "react";
import {useSessionState} from './session-state';
import { LogSidebar } from "./log-sidebar";
import { PartyHeader } from "./party-header";
import { PartyInventoryPanels } from "./party-inventory-panels";
import { PartyManagementPanels } from "./party-management-panels";
import { PartyReferencePanels } from "./party-reference-panels";
import { PartyWorkspacePanels } from "./party-workspace";
import { PartyViewSwitch, type PartyView } from './party-view-switch';
import { usePartyConsole } from "./use-party-console";
import { DashboardLive } from "./dashboard-live";
import { DashboardQueries } from "./query-cache";
import { DebugBrowserBanner } from './debug-browser';
import { DiagnosticsDialog, RecordIcon, useRecordIcon } from './diagnostics-dialog';

// Scrolls to `top` once the page is tall enough to hold it, as the content lays out. A scroll input
// from the player or the returned cleanup ends the wait.
function restoreScroll(top: number) {
  const root = document.querySelector('[data-party-console-root]');
  const observer = new ResizeObserver(() => place());
  const stop = () => { observer.disconnect(); for (const event of ['wheel', 'touchstart', 'keydown']) window.removeEventListener(event, stop); };
  function place() {
    if (document.documentElement.scrollHeight - window.innerHeight < top) return;
    window.scrollTo({ top, behavior: 'instant' });
    stop();
  }
  for (const event of ['wheel', 'touchstart', 'keydown']) window.addEventListener(event, stop);
  if (root) observer.observe(root);
  place();
  return stop;
}

// `onUp` hears whether the committed render holds a successful status read (the page's recovery
// guard, app/page.tsx).
export function Home({ onUp }: { onUp?: (up: boolean) => void } = {}) {
  return <DashboardQueries><DashboardLive /><PartyConsole onUp={onUp} /></DashboardQueries>;
}
function PartyConsole({ onUp }: { onUp?: (up: boolean) => void }) {
  const model = usePartyConsole();
  const up = !model.coordinatorLoading && !model.coordinatorUnavailable;
  useEffect(() => onUp?.(up), [onUp, up]);
  const records = useRecordIcon(model.state.recordSaved);
  const [logsOpen,setLogsOpen]=useSessionState('logs-open',false),[logsWidth,setLogsWidth]=useSessionState('logs-width',440);
  useEffect(()=>{const saved=sessionStorage.getItem('party-console-scroll');if(saved!==null){sessionStorage.removeItem('party-console-scroll');return restoreScroll(Number(saved));}},[]);
  const [view, setView] = useState<PartyView>('characters');
  const positions = useRef({ characters: 0, metrics: 0 });
  const navigate = (next: PartyView) => {
    if (next === view) return;
    positions.current[view] = window.scrollY;
    setView(next);
  };
  useEffect(() => restoreScroll(positions.current[view]), [view]);
  return (
    <>
      <main style={{marginRight:logsOpen?`min(${logsWidth}px,75vw)`:0}} data-party-console-root className="@container min-h-screen bg-[#07100f] text-[#e9f3e8]">
        <PartyHeader model={model} onLogs={() => setLogsOpen(v=>!v)} metricsActive={view === 'metrics'} onMetrics={() => navigate('metrics')}
          recordIcon={records.unread && model.state.recordSaved ? <RecordIcon saved={model.state.recordSaved} /> : null} />
        <DebugBrowserBanner />
        <AddonSlot name="page-section" part="banner" state={model.state} />
        <PartyViewSwitch model={model} view={view} navigate={navigate} />
      </main>
      {logsOpen && <LogSidebar state={model.state} width={logsWidth} onWidth={setLogsWidth} onClose={() => setLogsOpen(false)} />}
      <PartyInventoryPanels model={model} />
      <PartyReferencePanels model={model} />
      <PartyManagementPanels model={model} />
      <PartyWorkspacePanels model={model} />
      <DiagnosticsDialog characters={Object.keys(model.state.characters || {})} onRead={records.markRead} />
    </>
  );
}
