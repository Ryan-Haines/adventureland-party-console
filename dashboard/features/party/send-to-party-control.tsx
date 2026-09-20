"use client";
import { useRef, useState } from "react";
import { Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { merchantPartyGroups } from "../../../runtime/party-groups";
import type { PartyState } from "./party-state";

export function SendToPartyControl({state, onSend}: {state: PartyState; onSend: (group?: string) => Promise<void>}) {
  const submitting = useRef(false);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  // Manual requests must not depend on this panel receiving fresh presence data.
  // The coordinator validates live recipients when the request arrives.
  const groups = merchantPartyGroups(state, Object.keys(state.characters));
  async function send(group?: string) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    try { await onSend(group); setOpen(false); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <>
    <Button disabled={busy} onClick={() => { if (groups.length <= 1) void send(groups[0]?.id); else setOpen(true); }} className="h-9 bg-amber-400 text-xs text-amber-950 hover:bg-amber-300">
      <Landmark className="mr-1.5 h-3.5 w-3.5" />Send to party
    </Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="border-amber-700 bg-[#081713] text-emerald-50">
        <DialogHeader><DialogTitle>Select party group</DialogTitle></DialogHeader>
        <div className="grid gap-2">
          {groups.map(group => <Button key={group.id} disabled={busy} onClick={() => void send(group.id)} className="h-auto justify-start whitespace-normal border border-amber-700 bg-[#071719] py-3 text-left text-amber-100 hover:bg-amber-950 hover:text-white">{group.members.join(" · ")}</Button>)}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
