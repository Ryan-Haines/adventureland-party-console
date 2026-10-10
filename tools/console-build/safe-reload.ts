import path from 'node:path';
import {rm} from 'node:fs/promises';
import {atomicJson, readJson} from '../build-store.ts';

export function safeReload(directory: string, observe: (signal: AbortSignal) => Promise<{id?: string | null; ready?: boolean}>) {
  const file = path.join(directory, 'updates/pause.json');
  return {
    async waitUntilSafe(id: string, signal: AbortSignal) {
      let safeSince = 0;
      while (true) {
        signal.throwIfAborted();
        const existing = await readJson<{id: string; expires: number}>(file);
        if (existing && existing.id !== id && existing.expires > Date.now()) throw new Error('Another console maintenance operation is already in progress');
        await atomicJson(file, {id, mode: 'draining', expires: Date.now() + 10000});
        const status = await observe(signal).catch(() => ({id: null, ready: false}));
        if (status.id === id && status.ready) {
          safeSince ||= Date.now();
          if (Date.now() - safeSince >= 2000) {
            // Hold acquisition through component activation and readiness checks.
            await atomicJson(file, {id, mode: 'draining', expires: Date.now() + 180000});
            return;
          }
        } else safeSince = 0;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    },
    async releaseSafeWait(id: string) {
      const lease = await readJson<{id: string}>(file);
      if (lease?.id === id) await rm(file, {force: true});
    },
  };
}
