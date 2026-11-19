'use client';
import { caveVisitCurrent } from '../../../runtime/hunting/api.ts';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { read, reportPeriod, useVisible } from './query-cache';
import { usePartyAction } from './query-actions';
import type { DungeonView } from '../../../runtime/hunting/api';
import { requestId } from '@/lib/request-id';

export function useDungeons() {
  const client = useQueryClient(),
    visible = useVisible(),
    mutation = usePartyAction();
  const query = useQuery({
    queryKey: ['party', 'daily-dungeons'],
    queryFn: ({ signal }) =>
      read<DungeonView>(client, '/daily-dungeons', signal),
    enabled: visible,
    refetchInterval: reportPeriod,
    staleTime: reportPeriod,
  });
  const [error, setError] = useState('');
  async function action(body: Record<string, unknown>) {
    setError('');
    try {
      const result = await mutation.mutateAsync({
        path: '/daily-dungeons',
        body: { ...body, operationId: requestId() },
      });
      client.setQueryData(['party', 'daily-dungeons'], result);
      return true;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
      return false;
    }
  }
  return { ...query, action, busy: mutation.isPending, actionError: error };
}

export function dungeonCountdown(at: number, now: number) {
  const seconds = Math.max(0, Math.ceil((at - now) / 1000));
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`;
}
export function dungeonEntryLabel(view: DungeonView | undefined, now: number) {
  const member = view?.members[0],
    visit = member?.observation?.visit;
  if (!member?.fresh || !visit || !caveVisitCurrent(visit, now))
    return 'Availability unknown';
  if (visit.available) return 'Available now';
  if (visit.resets > now)
    return `Next entry: ${dungeonCountdown(visit.resets, now)}`;
  return 'Checking availability…';
}
