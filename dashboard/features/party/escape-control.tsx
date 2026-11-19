"use client";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { read, reportPeriod, useVisible } from "./query-cache";
import { usePartyAction } from "./query-actions";
import { useDungeons } from './dungeon-query';
import { EscapeStatus } from "./escape-status";
import { useClock } from "@/hooks/use-clock";

type EscapeButtonState = 'escape' | 'escaping' | 'resume';
interface EscapeAnswer { escape: EscapeStatus | null; button: EscapeButtonState | null; resumeAt: number | null }
// The button's colours: Escape red, Escaping amber, Resume green.
const COLOURS: Record<EscapeButtonState, string> = {
  escape: "border-rose-400 bg-[#481c27] text-rose-50 hover:bg-[#682336]",
  escaping: "border-amber-400 bg-[#4a3410] text-amber-50 hover:bg-[#4a3410]",
  resume: "border-emerald-400 bg-[#123d2a] text-emerald-50 hover:bg-[#185237]",
};

/**
 * The burst guard. Presses come in bursts: a burst runs while each gap stays within the longest gap
 * the player made in it before the button changed. Once the button turns to Resume, the guard
 * ignores the rest of the burst that started the escape, so a press meant for Escape never resumes.
 * No timer bounds a burst; a single press before the change has no gap, so the next press acts.
 * A press past the burst's gap ends the burst and acts, so the next burst starts at the press aimed
 * at Escape; the button showing Escape again clears the burst.
 */
export function createBurstGuard() {
  let burst: { last: number; longest: number; changed: boolean } | null = null;
  return {
    // A press at `at`: true when it belongs to a burst that started before the change.
    ignored(at: number): boolean {
      if (burst?.changed) {
        if (at - burst.last <= burst.longest) { burst.last = at; return true; }
        burst = null;
        return false;
      }
      if (burst) { burst.longest = Math.max(burst.longest, at - burst.last); burst.last = at; }
      else burst = { last: at, longest: 0, changed: false };
      return false;
    },
    changed() { if (burst) burst.changed = true; },
    reset() { burst = null; },
  };
}

export function EscapeControl() {
  const dungeon = useDungeons();
  const inDungeon = !!dungeon.data && !['idle', 'held'].includes(dungeon.data.state.phase);
  const client = useQueryClient(), visible = useVisible();
  const mutation = usePartyAction();
  const [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: ['party', 'escape'],
    queryFn: ({ signal }) => read<EscapeAnswer>(client, '/escape', signal),
    enabled: visible && !busy, refetchInterval: reportPeriod, staleTime: reportPeriod });
  const operation = query.data?.escape || null;
  // The button reads the tasks owner's escape hold and the survival owner's escape: Escape, Escaping or Resume.
  const state: EscapeButtonState = query.data?.button ?? 'escape';
  const resumeAt = query.data?.resumeAt ?? null;
  const now = useClock();
  const lockedFor = state === 'resume' && resumeAt !== null ? Math.max(0, Math.ceil((resumeAt - now) / 1000)) : 0;
  const guard = useRef(createBurstGuard());
  useEffect(() => {
    if (state === 'resume') guard.current.changed();
    else if (state === 'escape') guard.current.reset();
  }, [state]);
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError || (query.isError ? query.error.message : null);
  async function press() {
    if (inDungeon) { await dungeon.action({ action: 'exit' }); return; }
    // Escaping ignores every press; a press in the burst that started the escape ignores Resume.
    if (guard.current.ignored(Date.now()) || state === 'escaping' || lockedFor > 0) return;
    setBusy(true);
    setError(null);
    try {
      // Retire an older hold read before installing the acknowledged answer.
      await client.cancelQueries({ queryKey: ['party', 'escape'] });
      // The press names the state it saw, so the coordinator refuses one aimed at Escape
      // that would act as Resume, or the reverse.
      const path = state === 'resume' ? '/escape/resume' : '/escape';
      const data = await mutation.mutateAsync({ path, body: { shown: state } });
      client.setQueryData(['party', 'escape'], data);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Escape request failed");
    } finally {
      setBusy(false);
    }
  }
  const holdError = operation?.stage !== 'released' ? operation?.error : null;
  // An escape home reached its goal, so the error that sent it to the walk home stays a note.
  const failed =
    !!error ||
    (!!operation &&
      operation.stage !== "released" && operation.stage !== "home" &&
      (!!operation.error || operation.stage === "failed-hold"));
  const outcome = failed ? "Escape failed" : operation?.stage === "complete" ? "Escape succeeded" : operation?.stage === "home" ? "Escaped home" : null;
  const label = state === 'escaping' ? 'Escaping' : state === 'resume' ? (lockedFor > 0 ? `Resume (${lockedFor} s)` : 'Resume') : 'Escape';
  return (
    <div className="lg:col-span-2 xl:col-span-4">
      <Button
        disabled={inDungeon ? dungeon.busy : busy}
        aria-disabled={!inDungeon && (state === 'escaping' || lockedFor > 0)}
        onClick={() => void press()}
        className={`h-14 w-full border-2 text-base font-semibold disabled:opacity-80 ${inDungeon ? COLOURS.escape : COLOURS[state]}`}
      >
        {(inDungeon ? dungeon.busy : busy || state === 'escaping') && (
          <span
            aria-label="Escape in progress"
            className="mr-3 h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        )}
        {inDungeon ? 'Escape - exit dungeon' : label}
      </Button>
      {!inDungeon && (error || holdError) && (
        <p role="alert" className="mt-2 text-sm text-rose-200">{error || holdError}</p>
      )}
      {!inDungeon && state === 'resume' && (
        <p className="mt-2 text-sm text-slate-200">{outcome ? outcome + '. ' : ''}Automation is held until you resume it.</p>
      )}
      {inDungeon && dungeon.actionError && <p role="alert" className="text-rose-200">{dungeon.actionError}</p>}
    </div>
  );
}
