'use client';
import {
  hashKey,
  QueryClient,
  QueryClientProvider,
  replaceEqualDeep,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { API } from './api';
import type { PartyState } from './party-state';
import type { ALDataState } from './aldata-state';
import type { MapDefinition } from './map-definition';
import { writeVitals } from './character-cache';
import { STATUS_PICKS } from '../../../runtime/status/rules.ts';
import { CHARACTER_PICKS } from '../../../runtime/lifecycle/api.ts';

export type Domain =
  | 'core'
  | 'config'
  | 'fast'
  | 'inventory'
  | 'logs'
  | 'bank'
  | 'market'
  | 'catalog'
  | 'mail';
export const key = (domain: Domain) => ['party', domain] as const;
export class ReadError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function createDashboardClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}
export function DashboardQueries({ children }: { children: ReactNode }) {
  const [client] = useState(createDashboardClient);
  const [sessionLost, setSessionLost] = useState(false),
    [account, setAccount] = useState(0);
  useEffect(() => {
    const lost = () => {
      client.clear();
      setSessionLost(true);
    };
    const replaced = () => setAccount((value) => value + 1);
    window.addEventListener('party-auth-loss', lost);
    window.addEventListener('party-account-change', replaced);
    return () => {
      window.removeEventListener('party-auth-loss', lost);
      window.removeEventListener('party-account-change', replaced);
    };
  }, [client]);
  return (
    <QueryClientProvider client={client}>
      {sessionLost ? (
        <main className="min-h-screen bg-[#07100f] p-8 text-emerald-100">
          <p>Session expired. Reconnect this browser.</p>
          <button
            className="mt-4 rounded border border-emerald-600 bg-[#0b1916] px-4 py-2 text-emerald-100 hover:bg-emerald-950 hover:text-white"
            onClick={() => window.location.reload()}
          >
            Reconnect
          </button>
        </main>
      ) : (
        <Fragment key={account}>{children}</Fragment>
      )}
    </QueryClientProvider>
  );
}
// DashboardQueries clears the page's client on 'party-auth-loss', so a report sent with no client
// (query-actions.ts reportAction) still ends the page's session.
export function authenticationLost(client?: QueryClient) {
  client?.clear();
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event('party-auth-loss'));
}
async function respond(
  client: QueryClient,
  path: string,
  signal: AbortSignal | undefined,
  unchanged = false,
): Promise<Response> {
  const response = await fetch(API + path, { cache: 'no-store', signal });
  if (
    response.status === 401 ||
    response.status === 403 ||
    response.redirected
  ) {
    authenticationLost(client);
    throw new ReadError(401, 'Session expired. Reconnect this browser.');
  }
  if (!response.ok && !(unchanged && response.status === 304))
    throw new ReadError(response.status, RECONNECTING_NOTICE);
  return response;
}
// The words a failed read carries, which the header's connection line shows too.
export const RECONNECTING_NOTICE = 'Reconnecting — showing last received data';
export async function read<T>(
  client: QueryClient,
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  return (await respond(client, path, signal)).json() as Promise<T>;
}
// The coordinator answers 304 for these sections while their serialized body
// is unchanged (runtime/status/coordinator/state.ts, table S). Each
// revision belongs to the cached data object it arrived with, so the dashboard
// reads a section in full after setQueryData replaces its data or the cache
// removes it.
const revisionDomains = new Set<Domain>(['bank', 'logs', 'market']);
const revisions = new WeakMap<object, string>();
async function readRevision<T extends object>(
  client: QueryClient,
  domain: Domain,
  path: string,
  signal: AbortSignal,
): Promise<T> {
  const cached = client.getQueryData<T>(key(domain));
  const revision = cached && revisions.get(cached);
  const response = await respond(
    client,
    revision ? `${path}&revision=${encodeURIComponent(revision)}` : path,
    signal,
    true,
  );
  if (response.status === 304) {
    if (cached && client.getQueryData(key(domain)) === cached) return cached;
    return readRevision(client, domain, path, signal);
  }
  const result = (await response.json()) as T;
  const tag = response.headers.get('ETag');
  if (tag) revisions.set(result, tag.replace(/^"|"$/g, ''));
  return result;
}
function shareRevision(previous: unknown, next: unknown): unknown {
  const shared = replaceEqualDeep(previous, next);
  const revision = next && typeof next === 'object' ? revisions.get(next) : undefined;
  if (revision && shared && typeof shared === 'object') revisions.set(shared, revision);
  return shared;
}
export function useVisible() {
  const [visible, setVisible] = useState(
    () => typeof document !== 'undefined' && !document.hidden,
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const change = () => setVisible(!document.hidden);
    change();
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  return visible;
}
/** True in a hidden browser tab. A render without a document never pauses. */
export function useHidden() {
  const visible = useVisible();
  return typeof document !== 'undefined' && !visible;
}
// The polls of each section (the status owner's `dashboardPolls`, runtime/status/rules.ts `STATUS_PICKS`). Core and logs change
// only when a character reports, so they poll at the lifecycle owner's character report period; the catalog
// follows its reference revision and never goes stale. Configuration, rules and marks sit apart
// from core, so the fast-changing majority there does not force a structural diff of that much
// larger payload on every core poll.
export const polls = STATUS_PICKS.dashboardPolls;
// A view the coordinator answers from the characters' reports (the Cave run, the escape, the upgrade
// preview) changes only when one reports, so it polls at the lifecycle owner's report period too.
export const reportPeriod = CHARACTER_PICKS.lifecycleReportMs;
// The rows outside table S that the dashboard reads through `pollOf`.
export type PollRow = Domain | 'mailCount' | 'metrics';
export function pollOf(domain: PollRow): { interval: number; staleTime: number; gcTime: number | undefined } {
  const row = polls[domain] ?? {};
  if (domain === 'core' || domain === 'logs') return { interval: reportPeriod, staleTime: reportPeriod, gcTime: row.gc };
  if (domain === 'catalog') return { interval: 0, staleTime: Infinity, gcTime: row.gc };
  return { interval: row.interval ?? 0, staleTime: row.stale ?? 0, gcTime: row.gc };
}
export function domainOptions(client: QueryClient, domain: Domain) {
  const { interval, staleTime, gcTime } = pollOf(domain);
  return {
    queryKey:
      domain === 'catalog'
        ? [
            ...key(domain),
            client.getQueryData<Partial<PartyState>>(key('core'))
              ?.referenceRevision || '0',
          ]
        : key(domain),
    staleTime,
    gcTime,
    refetchInterval: interval || (false as false),
    ...(revisionDomains.has(domain) ? { structuralSharing: shareRevision } : {}),
    queryFn: async ({
      signal,
    }: {
      signal: AbortSignal;
    }): Promise<Partial<PartyState>> => {
      if (
        domain === 'market' &&
        !client.getQueryData<Partial<PartyState>>(key('core'))
          ?.referenceRevision
      )
        return {
          aldata: await read<ALDataState>(client, '/aldata/market', signal),
        };
      const version = client.getQueryData<{ version: number }>([
        'party',
        'connection',
      ])?.version;
      if (revisionDomains.has(domain))
        return readRevision<Partial<PartyState>>(
          client,
          domain,
          `/state?catalog=0&dashboard=1&section=${domain}`,
          signal,
        );
      const result = await read<
        Partial<PartyState> & {
          characterDetails?: Record<string, Partial<import('./char').Char> & { online?: boolean }>;
        }
      >(client, `/state?catalog=0&dashboard=1&section=${domain}`, signal);
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (domain === 'catalog') {
        const fields = new Set(['travelPlaces', 'monsterChoices', 'bestiaryCatalog', 'skillCatalog',
          'appearanceChoices', 'merchantCatalog', 'bankVaults', 'referenceRevision']);
        return Object.fromEntries(Object.entries(result).filter(([field]) => fields.has(field)));
      }
      if (domain === 'core') {
        const priorAccount = client.getQueryData<Partial<PartyState>>(
          key('core'),
        )?.accountId;
        if (
          priorAccount &&
          result.accountId &&
          priorAccount !== result.accountId
        ) {
          await client.cancelQueries({
            predicate: (query) => query.queryKey[1] !== 'core',
          });
          client.removeQueries({
            predicate: (query) => query.queryKey[1] !== 'core',
          });
          if (typeof window !== 'undefined')
            window.dispatchEvent(new Event('party-account-change'));
        }
        if (!result.characters)
          result.characters = client.getQueryData<Partial<PartyState>>(
            key('core'),
          )?.characters;
        for (const [name, data] of Object.entries(
          result.characterDetails || {},
        ))
          client.setQueryData(
            ['party', 'character', name, 'diagnostics'],
            data,
          );
        for (const [name, data] of Object.entries(
          result.characterDetails || {},
        ))
          // The coordinator answers online by its one presence rule.
          client.setQueryData(['party', 'character', name, 'presence'], {
            seenAt: data.online ? Number.MAX_SAFE_INTEGER : 0,
          });
        delete result.characterDetails;
      }
      if (domain === 'fast' || domain === 'inventory') {
        const connection = client.getQueryData<{
          version: number;
          healthy: boolean;
        }>(['party', 'connection']);
        if (connection?.healthy || connection?.version !== version)
          return client.getQueryData(key(domain)) || {};
        for (const [name, data] of Object.entries(result.characters || {})) {
          if (domain === 'fast') writeVitals(client, name, data);
          else client.setQueryData(
            [
              'party',
              'character',
              name,
              'inventory',
            ],
            data,
          );
        }
        if (
          domain === 'fast' &&
          !client.getQueryData<Partial<PartyState>>(key('core'))
            ?.referenceRevision
        ) {
          for (const [name, data] of Object.entries(result.characters || {}))
            client.setQueryData(
              ['party', 'character', name, 'diagnostics'],
              data,
            );
          const characters = Object.fromEntries(
            Object.entries(result.characters || {}).map(([name, data]) => [
              name,
              {
                name,
                ctype: data.ctype,
                level: data.level,
                server: data.server,
              },
            ]),
          );
          client.setQueryData(
            key('core'),
            (previous: Partial<PartyState> | undefined) => ({
              ...previous,
              characters,
            }),
          );
        }
      }
      return result;
    },
  };
}
export function useDomain(domain: Domain, needed = true) {
  const client = useQueryClient();
  const visible = useVisible();
  const result = useQuery({
    ...domainOptions(client, domain),
    enabled: visible && needed,
    ...(domain === 'catalog'
      ? { refetchOnWindowFocus: true, refetchOnReconnect: true }
      : {}),
  });
  useReferenceRetry(domain === 'catalog' ? result : undefined);
  return result;
}
// A reference read (the catalog, a map, the postage) changes only with the core section's
// referenceRevision, which its query key holds. A failed read reruns on the next core answer, and a
// second failure under the same revision waits for the revision to change, which starts a new query.
// The hook listens to the cache only while its read is failed.
export function useReferenceRetry(
  query: { isError: boolean; errorUpdateCount: number; refetch(options: { cancelRefetch: boolean }): unknown } | undefined,
) {
  const client = useQueryClient();
  const waiting = !!query && query.isError && query.errorUpdateCount < 2;
  const refetch = query?.refetch;
  useEffect(() => {
    if (!waiting || !refetch) return;
    const core = hashKey(key('core'));
    return client.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success' && event.query.queryHash === core)
        void refetch({ cancelRefetch: false });
    });
  }, [client, waiting, refetch]);
}
/** The core section's reference revision, which keys every reference read. */
export function useReferenceRevision(): string {
  const client = useQueryClient();
  return (
    useQuery({
      ...domainOptions(client, 'core'),
      enabled: false,
      select: (data) => data.referenceRevision || '0',
    }).data || '0'
  );
}
export function useMapDefinition(map: string, enabled = true) {
  const client = useQueryClient();
  const visible = useVisible();
  const revision = useReferenceRevision();
  const result = useQueries({
    queries: [
      {
        queryKey: ['party', 'reference', revision, 'map', map],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          read<MapDefinition>(
            client,
            `/maps/${encodeURIComponent(map)}?revision=${revision}`,
            signal,
          ),
        staleTime: Infinity,
        gcTime: pollOf('catalog').gcTime,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
    ].filter(() => visible && enabled && !!map),
  })[0];
  useReferenceRetry(result);
  return { data: result?.data, isError: result?.isError || false };
}
