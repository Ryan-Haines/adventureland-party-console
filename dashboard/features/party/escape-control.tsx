"use client";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { read, useVisible } from "./query-cache";
import { usePartyAction } from "./query-actions";
import { useDungeons } from './dungeon-query';
import { EscapeStatus } from "./escape-status";

export function EscapeControl() {
  const dungeon = useDungeons();
  const inDungeon = !!dungeon.data && !['idle', 'held'].includes(dungeon.data.state.phase);
  const client = useQueryClient(), visible = useVisible();
  const mutation = usePartyAction();
  const query = useQuery({ queryKey: ['party', 'escape'],
    queryFn: ({ signal }) => read<{ escape: EscapeStatus | null }>(client, '/escape', signal),
    enabled: visible, refetchInterval: 1000, staleTime: 1000, gcTime: 300000 });
  const operation = query.data?.escape || null;
  const [busy, setBusy] = useState(false);
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError || (query.isError ? query.error.message : null);
  async function action() {
    if (inDungeon) { await dungeon.action({ action: 'exit' }); return; }
    setBusy(true);
    setError(null);
    try {
      const data = await mutation.mutateAsync({ path: '/escape', body: {} });
      client.setQueryData(['party', 'escape'], data);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Escape request failed");
    } finally {
      setBusy(false);
    }
  }
  const running = !!operation && !["complete", "failed-hold", "released"].includes(operation.stage);
  const failed =
    !!error ||
    (!!operation &&
      operation.stage !== "released" &&
      (!!operation.error || operation.stage === "failed-hold"));
  const label = failed
    ? "Escape - failed"
    : operation?.stage === "complete"
      ? "Escape - success"
      : "Escape";
  return (
    <div className="lg:col-span-2 xl:col-span-4">
      <Button
        disabled={inDungeon ? dungeon.busy : busy || running}
        onClick={() => void action()}
        className="h-14 w-full border-2 border-rose-400 bg-[#481c27] text-base font-semibold text-rose-50 hover:bg-[#682336] disabled:opacity-80"
      >
        {(inDungeon ? dungeon.busy : busy || running) && (
          <span
            aria-label="Escape in progress"
            className="mr-3 h-5 w-5 animate-spin rounded-full border-2 border-rose-100 border-t-transparent"
          />
        )}
        {inDungeon ? 'Escape â€” exit dungeon' : label}
      </Button>
      {inDungeon && dungeon.actionError && <p role="alert" className="text-rose-200">{dungeon.actionError}</p>}
    </div>
  );
}
