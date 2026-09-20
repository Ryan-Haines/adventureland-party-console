"use client";
import { useState } from "react";
import { LogSidebar } from "./log-sidebar";
import { PartyHeader } from "./party-header";
import { PartyInventoryPanels } from "./party-inventory-panels";
import { PartyManagementPanels } from "./party-management-panels";
import { PartyReferencePanels } from "./party-reference-panels";
import { PartyWorkspace } from "./party-workspace";
import { usePartyConsole } from "./use-party-console";
import { DashboardLive } from "./dashboard-live";
import { DashboardQueries } from "./query-cache";

export function Home() {
  return <DashboardQueries><DashboardLive /><PartyConsole /></DashboardQueries>;
}
function PartyConsole() {
  const model = usePartyConsole();
  const [logsOpen,setLogsOpen]=useState(false),[logsWidth,setLogsWidth]=useState(440);
  return (
    <>
      <main style={{marginRight:logsOpen?`min(${logsWidth}px,75vw)`:0}} data-party-console-root className="@container min-h-screen bg-[#07100f] text-[#e9f3e8]">
        <PartyHeader model={model} onLogs={() => setLogsOpen(v=>!v)} />
        <PartyWorkspace model={model} />
      </main>
      {logsOpen && <LogSidebar state={model.state} width={logsWidth} onWidth={setLogsWidth} onClose={() => setLogsOpen(false)} />}
      <PartyInventoryPanels model={model} />
      <PartyReferencePanels model={model} />
      <PartyManagementPanels model={model} />
    </>
  );
}
