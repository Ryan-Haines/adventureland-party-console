'use client';
import { useSyncExternalStore, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLiveHealthy } from './dashboard-live';
export function DashboardHealth() {
  const client = useQueryClient(),
    healthy = useLiveHealthy();
  const subscribe = useCallback(
    (notify: () => void) => client.getQueryCache().subscribe(notify),
    [client],
  );
  const snapshot = useCallback(
    () =>
      client
        .getQueryCache()
        .getAll()
        .filter((query) => query.isActive() && query.state.status === 'error')
        .map((query) => String(query.queryKey[1]))
        .sort()
        .join(', '),
    [client],
  );
  const failed = useSyncExternalStore(subscribe, snapshot, () => '');
  if (healthy && !failed) return null;
  return (
    <output className="block text-sm text-amber-200">
      {failed
        ? `${failed}: reconnecting; showing last received data`
        : 'Connecting / polling compatibility mode'}
    </output>
  );
}
