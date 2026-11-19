'use client';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API } from './api';
import { createLiveReceiver, type LiveMessage } from './live-protocol';
import { domainOptions, key, useVisible } from './query-cache';
import type { Char } from './char';
import { characterKey, writeCharacter, writeVitals, type CharacterDomain } from './character-cache';
export { characterKey } from './character-cache';
import { audited } from './field-read-audit';

const liveConnectionKey = ['party', 'connection'] as const;
interface LiveConnection {
  healthy: boolean;
  version: number;
}
function useLiveHealthy() {
  return (
    useQuery({
      queryKey: liveConnectionKey,
      queryFn: () => ({ healthy: false, version: 0 }),
      enabled: false,
      select: (value: LiveConnection) => value.healthy,
    }).data || false
  );
}
export function useCharacterData(
  name: string,
  kind: CharacterDomain,
) {
  const data = useQuery({
    queryKey: characterKey(name, kind),
    enabled: false,
    staleTime: Infinity,
    gcTime: 60000,
    queryFn: (): Partial<Char> => ({}),
  }).data;
  return audited(kind, data);
}
export function DashboardLive() {
  const client = useQueryClient();
  const visible = useVisible();
  const healthy = useLiveHealthy();
  // Compatibility reads are shared once per tab. They stop as soon as a snapshot arrives.
  useQuery({ ...domainOptions(client, 'fast'), enabled: visible && !healthy });
  useQuery({
    ...domainOptions(client, 'inventory'),
    enabled: visible && !healthy,
  });
  useEffect(() => {
    if (!visible) return;
    // `waiting` is set while a failed stream waits for the coordinator to answer a poll again.
    let stream: EventSource | undefined,
      stopped = false,
      waiting = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const status = (healthy: boolean) => {
      const version =
        (client.getQueryData<LiveConnection>(liveConnectionKey)?.version || 0) +
        1;
      client.setQueryData(liveConnectionKey, { healthy, version });
    };
    const inventories = new Map<string, { items: unknown; slots: unknown; size: number }>();
    const receiver = createLiveReceiver((name, record) => {
      if (!record) {
        for (const kind of ['vitals', 'position', 'inventory'] as const) writeCharacter(client, name, kind, null);
        inventories.delete(name);
        return;
      }
      writeVitals(client, name, record.vitals);
      const size =
        Number(record.vitals.inventorySize) || Object.keys(record.items).length;
      // Native arrays can contain occupied overflow cells beyond isize. Keep
      // them inspectable while retaining the actual capacity separately.
      const displaySize = Object.keys(record.items).reduce((length, key) =>
        /^\d+$/.test(key) && record.items[key] ? Math.max(length, Number(key) + 1) : length, size);
      const previous = inventories.get(name);
      if (previous?.items === record.items && previous.slots === record.slots && previous.size === size) return;
      inventories.set(name, { items: record.items, slots: record.slots, size });
      writeCharacter(client, name, 'inventory', {
        items: Array.from(
          { length: displaySize },
          (_, index) => record.items[String(index)] || null,
        ),
        inventorySize: size,
        slots: record.slots,
      });
    });
    // A failed stream reconnects once the coordinator answers the fallback core poll again, which
    // runs while the stream is down.
    function fail() {
      if (stopped) return;
      stream?.close();
      clearTimeout(watchdog);
      status(false);
      waiting = true;
    }
    // The stream fails after three heartbeats it did not hear, at the period the stream names.
    function heard(heartbeatMs: number | undefined) {
      clearTimeout(watchdog);
      if (heartbeatMs) watchdog = setTimeout(fail, 3 * heartbeatMs);
    }
    function connect() {
      if (stopped) return;
      waiting = false;
      const source = new EventSource(`${API}/dashboard-stream`);
      stream = source;
      source.onerror = () => {
        if (stream === source) fail();
      };
      source.onmessage = (event) => {
        if (stopped || stream !== source) return;
        try {
          const message = JSON.parse(event.data) as LiveMessage;
          if (!receiver.accept(message)) return;
          if (message.type === 'heartbeat' || message.type === 'snapshot')
            heard(message.heartbeatMs);
          if (message.type === 'snapshot') {
            void client.cancelQueries({ queryKey: key('fast') });
            void client.cancelQueries({ queryKey: key('inventory') });
            status(true);
          }
        } catch {
          fail();
        }
      };
    }
    status(false);
    connect();
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (
        event.type === 'removed' &&
        event.query.queryKey[1] === 'connection'
      ) {
        stopped = true;
        stream?.close();
        clearTimeout(watchdog);
      }
      if (waiting && event.type === 'updated' && event.action.type === 'success' && event.query.queryKey[1] === 'core')
        connect();
    });
    return () => {
      stopped = true;
      unsubscribe();
      clearTimeout(watchdog);
      stream?.close();
      status(false);
    };
  }, [client, visible]);
  return null;
}
