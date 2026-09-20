"use client";
import { useClock } from "@/hooks/use-clock";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Settings } from "lucide-react";
import { eventTimeLabel } from "./event-selection-control";
import { useState } from "react";
import { Char } from "./char";
import { PartyState } from "./party-state";

export function AnniversaryDialog({
  open,
  onOpenChange,
  anniversary,
  characters,
  autoChat = false,
  merchant,
  onSendChatAdvertisement,
  onAutoChatChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anniversary?: PartyState["anniversary"];
  autoChat?: boolean;
  merchant?: string | null;
  characters: Record<string, Char>;
  onSendChatAdvertisement: () => Promise<void>;
  onAutoChatChange: (enabled: boolean) => Promise<void>;
}) {
  const now = useClock();
  const [copied, setCopied] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [sendingChat, setSendingChat] = useState(false);
  const live = anniversary?.live;
  const schedule = anniversary?.schedule;
  const deadline = Number(live?.expires || schedule?.next || 0);
  const normalizedDeadline = deadline > 0 && deadline < 1e12 ? deadline * 1000 : deadline;
  const countdown = normalizedDeadline ? Math.max(0, normalizedDeadline - now) : null;
  const countdownText =
    countdown === null
      ? null
      : `${Math.floor(countdown / 60000)}:${String(Math.floor(countdown / 1000) % 60).padStart(2, "0")}`;
  const cycle = anniversary?.eventCycle;
  const failsafeRemaining =
    cycle && !cycle.returnDispatchedAt ? Math.max(0, Number(cycle.endsAt) - now) : null;
  const failsafeText =
    failsafeRemaining === null
      ? null
      : `${Math.floor(failsafeRemaining / 60000)}:${String(Math.floor(failsafeRemaining / 1000) % 60).padStart(2, "0")}`;
  const anniversaryActivityClass = (entry: { level?: string; message?: string }) => {
    const message = String(entry.message || "");
    // Keep the activity log deliberately simple: rewards are green, failures
    // are red, and routine bookkeeping remains neutral.
    if (/\band received [^·]+ Slice$/i.test(message)) return "text-emerald-300";
    if (entry.level === "error") return "text-rose-300";
    if (/\bkissed\b/i.test(message)) return "text-rose-300";
    if (entry.level === "featured") return "text-amber-300";
    return "text-slate-300";
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(900px,calc(100vw-2rem))] max-w-none overflow-y-auto border-pink-800 bg-[#0b1110] text-emerald-50 sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-pink-200">10 Years of Adventure

          </DialogTitle>
          <DialogDescription className="text-emerald-100/60">
            Automated featured-player visits and protected slice trading.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-3 rounded border border-slate-600 bg-slate-950 p-3 text-sm text-slate-100">
          <input type="checkbox" checked={autoChat} onChange={e => { setSettingsError(""); void onAutoChatChange(e.target.checked).catch(error => setSettingsError(String(error.message))); }} />
          Send anniversary chat message when receiving cake from a kiss
        </label>
        {settingsError && <p role="alert" className="text-rose-300">{settingsError}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          <section className="rounded border border-pink-900 bg-black/35 p-3">
            <p className="font-semibold text-pink-200">
              {live ? `LIVE · ${live.target}` : "Waiting for the next round"}
            </p>
            <p className="mt-1 font-mono text-xs text-pink-300">
              {live
                ? `Expires in ${countdownText || "unknown"} · ${live.map} [${live.x}, ${live.y}]`
                : countdownText
                  ? `Next round: ${eventTimeLabel(normalizedDeadline, now)} · Depart ${eventTimeLabel(normalizedDeadline - 90000, now)}`
                  : "Next round time unavailable"}
            </p>
            {cycle ? (
              <p className="mt-1 font-mono text-xs text-cyan-300">
                {cycle.returnDispatchedAt
                  ? `Return dispatched · ${cycle.returnReason || "anniversary complete"}`
                  : `Farming return failsafe in ${failsafeText} · ${cycle.destination?.label || "saved location"}`}
              </p>
            ) : null}
            <div className="mt-3 space-y-1">
              {Object.values(characters).map((char) => (
                <div key={char.name} className="flex justify-between text-xs">
                  <span>{char.name}</span>
                  <span
                    className={
                      char.anniversaryVisit
                        ? "text-pink-300"
                        : char.anniversaryState?.stage === "kiss confirmed"
                          ? "text-emerald-300"
                          : "text-slate-400"
                    }
                  >
                    {char.anniversaryVisit
                      ? char.anniversaryState?.stage || "ticket ready"
                      : char.anniversaryState?.stage || "no ticket"}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded border border-amber-900 bg-black/35 p-3">
            <p className="font-semibold text-amber-200">
              Cake slices · {anniversary?.completeSets || 0} complete set(s)
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(anniversary?.slices || []).map((id) => (
                <div key={id} className="rounded border border-slate-800 px-2 py-1 text-xs">
                  <span>{anniversary?.labels[id] || id}</span>
                  <span className="float-right font-mono text-amber-300">
                    {anniversary?.counts[id] || 0}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-violet-300">
              Tradable native surplus: {anniversary?.tradableNative || 0}
            </p>
          </section>
        </div>
        <section className="rounded border border-violet-900 bg-black/35 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold text-violet-200">Trade advertisement</p>
            <Button
              size="sm"
              variant="outline"
              disabled={!anniversary?.message}
              onClick={async () => {
                try { await navigator.clipboard.writeText(anniversary?.message || ""); setCopied(true); setTimeout(() => setCopied(false), 2000); }
                catch { setSettingsError("Could not copy the message"); }
              }}
              className="min-w-28 border-violet-600 bg-black text-violet-100 hover:bg-violet-950 hover:text-white"
            >
              <Copy className="mr-2 h-3.5 w-3.5" />
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-emerald-100/70">
            {anniversary?.message ||
              "No safe trade offer yet. Complete cake sets are reserved before native slices are advertised."}
          </p>
        </section>
        <section className="rounded border border-cyan-800 bg-black/45 p-3 text-cyan-50">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold text-cyan-200">Chat advertisement</p>
            <Button
              size="sm"
              type="button"
              disabled={
                !anniversary?.chatMessage || sendingChat || !!anniversary?.chatAdvertisement
              }
              onClick={async () => {
                setSendingChat(true);
                try {
                  await onSendChatAdvertisement();
                } finally {
                  setSendingChat(false);
                }
              }}
              className="border border-cyan-500 bg-cyan-950 text-cyan-100 hover:border-cyan-300 hover:bg-cyan-900 hover:text-white disabled:border-slate-700 disabled:bg-black disabled:text-slate-500"
            >
              {anniversary?.chatAdvertisement
                ? `Queued for ${merchant || "merchant"}`
                : sendingChat
                  ? "Queueing…"
                  : "Send in game chat"}
            </Button>
          </div>
          <p className="mt-2 break-words font-mono text-xs text-cyan-100/80">
            {anniversary?.chatMessage || "No safe chat advertisement is currently available."}
          </p>
        </section>
        <section className="rounded border border-slate-800 bg-black/35 p-3">
          <p className="font-semibold">Anniversary activity</p>
          <div className="mt-2 max-h-52 space-y-1 overflow-y-auto font-mono text-xs">
            {anniversary?.activity?.length ? (
              [...anniversary.activity].reverse().map((entry, index) => (
                <div key={`${entry.at}-${index}`} className={anniversaryActivityClass(entry)}>
                  {new Date(entry.at).toLocaleTimeString()} · {entry.message}
                </div>
              ))
            ) : (
              <p className="text-slate-500">No anniversary activity yet.</p>
            )}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
