'use client';
import { memo, useId } from 'react';
import {useStoredBoolean} from '@/hooks/use-stored-boolean';
import {CharacterSectionToggle} from './character-section-toggle';
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
    <CombatLog character={character} entries={query.data || empty} />
  );
}
export const ConnectedCombatLog = memo(function ConnectedCombatLog({
  character,
}: {
  character: string;
}) {
  const [open, setOpen] = useStoredBoolean(`party-section:${character}:combat-log`, false);
  const id=useId();
  return (
    <section className="mt-4 border-t border-emerald-900/70">
      <CharacterSectionToggle label="Combat log" open={open} controls={id} onToggle={()=>setOpen(value=>!value)}/>
      <div id={id}>{open && <LogContents character={character} />}</div>
    </section>
  );
});
