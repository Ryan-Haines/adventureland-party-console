'use client';
import { memo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { domainOptions, useVisible } from './query-cache';
import { CombatLog } from './combat-log';
import type { CombatLogEntry } from './combat-log-entry';
const empty: CombatLogEntry[] = [];
function LogContents({ character }: { character: string }) {
  const client = useQueryClient(),
    visible = useVisible();
  const query = useQuery({
    ...domainOptions(client, 'logs'),
    enabled: visible,
    select: (data) => data.combatLogs?.[character] || empty,
  });
  return (
    <CombatLog character={character} entries={query.data || empty} expanded />
  );
}
export const ConnectedCombatLog = memo(function ConnectedCombatLog({
  character,
}: {
  character: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="mt-4 border-t border-emerald-900/70 pt-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-xs text-emerald-200">
        Combat log
      </summary>
      {open && <LogContents character={character} />}
    </details>
  );
});
