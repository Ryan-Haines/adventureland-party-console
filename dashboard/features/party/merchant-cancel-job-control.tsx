"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { automaticRoutineKeys } from "./automatic-routine-keys";
import { routineLabels } from "./routine-labels";

export function MerchantCancelJobControl({ id, reason, label, onCancel }: {
  id?: string;
  reason: string;
  label: string;
  onCancel: (id?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const disablesRoutine = automaticRoutineKeys.has(reason);

  async function cancelJob() {
    if (!id || busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await onCancel(id);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cancel merchant job");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return <>
    <button type="button" aria-label={`Cancel ${label}`} disabled={pending || !id}
      title={disablesRoutine ? "Cancel job and disable routine" : "Cancel and undo pending intent"}
      onClick={() => { if (disablesRoutine) { setError(""); setOpen(true); } else void cancelJob(); }}
      className="grid h-4 w-4 shrink-0 place-items-center rounded border border-rose-700 bg-zinc-950 text-rose-300 hover:border-rose-400 hover:bg-rose-950 hover:text-rose-100 disabled:opacity-50">
      <X className="h-2.5 w-2.5" />
    </button>
    <Dialog open={open} onOpenChange={value => { if (!busy.current) setOpen(value); }}>
      <DialogContent showCloseButton={false} className="border border-rose-800 bg-zinc-950 text-zinc-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel {routineLabels[reason] || reason}?</DialogTitle>
          <DialogDescription className="text-zinc-300">
            Canceling this job will also disable this routine until you re-enable it in Routines.
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}
            className="border-zinc-600 bg-zinc-900 text-zinc-100 hover:border-zinc-400 hover:bg-zinc-800 hover:text-white">Cancel</Button>
          <Button disabled={pending} onClick={() => void cancelJob()}
            className="border border-rose-600 bg-rose-950 text-rose-100 hover:border-rose-400 hover:bg-rose-900 hover:text-white">
            {pending ? "Canceling…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
