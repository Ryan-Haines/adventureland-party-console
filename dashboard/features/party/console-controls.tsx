"use client";
import { useState } from "react";
import { Pause, Play, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { API } from "./api";

/** runtime/coordinator/lifecycle/console-control.ts status(). */
export interface ConsoleControlState {
  paused: boolean;
  pausedAt: number | null;
  resume: { since: number; waiting: string[] } | null;
  shutdown: { phase: 'deferred' | 'draining' | 'safe'; requestedAt: number; hold: string | null; waiting: string[]; command: string } | null;
  log: { at: number; message: string }[];
}
const secondary = "border border-slate-500 bg-slate-950 text-slate-100 hover:bg-slate-800 hover:text-white";

async function send(action: string, body: object = {}): Promise<ConsoleControlState> {
  const response = await fetch(`${API}/console-control/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json() as ConsoleControlState & { error?: string };
  if (!response.ok) throw new Error(result.error || "Console control failed");
  return result;
}

/** The core poll owns the state; a reply only bridges the second until the next poll. */
function useConsoleControl(polled: ConsoleControlState | null | undefined) {
  // A reply applies only until the next poll replaces the polled object.
  const [reply, setReply] = useState<{ value: ConsoleControlState; basis: typeof polled } | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function act(action: string, body?: object) {
    setBusy(true); setError(undefined);
    try { setReply({ value: await send(action, body), basis: polled }); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return { control: (reply?.basis === polled ? reply?.value : null) || polled || null, act, busy, error };
}

export function ConsolePausedIndicator({ control }: { control?: ConsoleControlState | null }) {
  if (!control?.paused) return null;
  return <output data-console-paused
    className="ml-3 rounded border border-amber-400 bg-amber-950 px-2 py-0.5 font-mono text-xs font-semibold uppercase tracking-wider text-amber-100">
    {control.resume ? 'Resuming' : control.shutdown?.phase === 'safe' ? 'Safe to stop' : 'Paused'}
  </output>;
}

export function ConsoleControls({ polled }: { polled?: ConsoleControlState | null }) {
  const { control, act, busy, error } = useConsoleControl(polled);
  const [dialog, setDialog] = useState(false);
  const [confirmForce, setConfirmForce] = useState(false);
  if (!control) return null;
  const shutdown = control.shutdown;
  const open = dialog || !!shutdown;
  return <>
    {control.paused
      ? <Button size="icon" onClick={() => void act('play')} disabled={busy || !!shutdown} aria-label="Play: resume automated actions" title="Resume automated actions"
          className="ml-2 size-6 rounded-full border border-emerald-400 bg-emerald-950 text-emerald-100 hover:bg-emerald-900 hover:text-white">
          <Play className="size-3.5" />
        </Button>
      : <Button size="icon" onClick={() => void act('pause')} disabled={busy || !!shutdown} aria-label="Pause all automated actions" title="Pause all automated actions"
          className="ml-2 size-6 rounded-full border border-amber-500 bg-black text-amber-200 hover:bg-amber-950 hover:text-white">
          <Pause className="size-3.5" />
        </Button>}
    <Button size="icon" onClick={() => setDialog(true)} aria-label="Clean shutdown" title="Clean shutdown"
      className="ml-2 size-6 rounded-full border border-rose-600 bg-black text-rose-200 hover:bg-rose-950 hover:text-white">
      <Power className="size-3.5" />
    </Button>
    <Dialog open={open} onOpenChange={next => { if (!next && !shutdown) { setDialog(false); setConfirmForce(false); } }}>
      <DialogContent showCloseButton={false} className="border-slate-600 bg-[#091614] text-slate-100">
        <DialogHeader>
          <DialogTitle>{shutdown?.phase === 'safe' ? 'Safe to stop' : 'Clean shutdown'}</DialogTitle>
          <DialogDescription className="text-slate-300">
            {!shutdown && 'Pause every automated action, wait until the characters hold still, then save the state. The console resumes the same activity after its next start.'}
            {shutdown?.phase === 'deferred' && `Waiting for the fight to end: ${shutdown.hold}.`}
            {shutdown?.phase === 'draining' && 'Pausing and saving the state.'}
            {shutdown?.phase === 'safe' && 'Everything is saved. Stop the container now:'}
          </DialogDescription>
        </DialogHeader>
        {shutdown?.phase === 'draining' && <p className="text-sm text-slate-200">Waiting for: {shutdown.waiting.length ? shutdown.waiting.join(', ') : 'character acknowledgements'}</p>}
        {shutdown?.phase === 'safe' && <div className="space-y-1 text-sm">
          <p className="text-slate-300">In the folder that holds compose.yaml:</p>
          <code data-console-stop-command className="block select-all rounded border border-slate-600 bg-black px-2 py-1 font-mono text-emerald-200">{shutdown.command}</code>
        </div>}
        {confirmForce && <p className="text-sm text-rose-200">Stopping now pauses the characters in the middle of the fight. They only defend themselves until the console resumes.</p>}
        {error && <p className="text-sm text-rose-300">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {!shutdown && <Button onClick={() => { setDialog(false); void act('shutdown'); }} disabled={busy} className="border border-rose-500 bg-rose-950 text-rose-50 hover:bg-rose-900">Start clean shutdown</Button>}
          {shutdown?.phase === 'deferred' && (confirmForce
            ? <Button onClick={() => { setConfirmForce(false); void act('shutdown', { force: true }); }} disabled={busy} className="border border-rose-500 bg-rose-950 text-rose-50 hover:bg-rose-900">Confirm: stop now</Button>
            : <Button onClick={() => setConfirmForce(true)} disabled={busy} className="border border-rose-500 bg-black text-rose-200 hover:bg-rose-950">Force shutdown</Button>)}
          {shutdown
            ? <Button onClick={() => { setDialog(false); setConfirmForce(false); void act('cancel-shutdown'); }} disabled={busy} className={secondary}>Cancel shutdown</Button>
            : <Button onClick={() => setDialog(false)} className={secondary}>Close</Button>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

/** Shown after a clean shutdown until the characters reconnect and Play runs. */
export function ConsoleResumeBanner({ polled }: { polled?: ConsoleControlState | null }) {
  const { control, act, busy } = useConsoleControl(polled);
  if (!control?.resume) return null;
  return <output data-console-resuming
    className="mx-auto mt-2 flex max-w-[1500px] flex-wrap items-center gap-3 rounded border border-amber-500 bg-amber-950 px-3 py-1.5 text-sm text-amber-50">
    <span>Resuming previous activity{control.resume.waiting.length ? ` · waiting for ${control.resume.waiting.join(', ')}` : ''}</span>
    <Button size="sm" onClick={() => void act('cancel-resume')} disabled={busy} className={secondary}>Cancel</Button>
  </output>;
}
