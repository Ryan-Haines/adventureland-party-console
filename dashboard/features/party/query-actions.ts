import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { API } from './api';
import { authenticationLost, key, type Domain } from './query-cache';
import { steamClientSetup } from './steam-client-setup';

// 'config' (rules/marks/configuration) sits alongside 'core' (live operational
// state) in every one of these groups: most mutations here are dashboard-driven
// settings changes, and the two domains split what used to be one 'core'
// payload, so anything that used to be covered by invalidating 'core' alone
// needs 'config' invalidated too or the user's own change looks stale for up
// to the config domain's poll interval.
const core = ['core', 'config'] as const;
const inventory = ['core', 'config', 'inventory', 'fast'] as const;
const commerce = ['core', 'config', 'inventory', 'fast', 'bank', 'market'] as const;
export const actionDomains = {
  '/daily-dungeons': core,
  '/merchant/bank-sort': core,
  '/config': core,
  '/formation': core,
  '/focus': core,
  '/farming-mode': core,
  // An add-on section's save (runtime/hooks/dashboard/slots.tsx): the scope's add-on store is in the farming profile.
  '/addon-farming': core,
  // An add-on's own command (slots.tsx `AddonCard` send): its store is in the farming profile.
  '/addon-command': core,
  // The add-on manager's switch and settings (runtime/hooks/dashboard/settings-page.tsx) and its list
  // read: the list is its own cache (slots.tsx `reloadAddons`), and each character takes the change
  // on its next status reply.
  '/addons': [],
  '/hunt-blacklist': core,
  '/hunt-settings': core,
  // The settings route: a setting with no route of its own, such as the relocation switch.
  '/settings': core,
  '/rare-hunting': core,
  '/navigate-to-monster': core,
  '/town-party': core,
  '/restock': core,
  '/escape': core,
  '/escape/resume': core,
  '/bank-party': ['core', 'config', 'bank'],
  '/realm/switch': inventory,
  '/steam/action': inventory,
  '/steam/recover': inventory,
  '/roster/create': core,
  '/bankbois/create': ['core', 'config', 'bank'],
  '/bank/unlock': ['bank', 'core', 'config'],
  '/merchant/clear': core,
  '/merchant/config': inventory,
  '/merchant/force-stand': core,
  '/merchant/stand-location': core,
  '/merchant/gather': core,
  '/merchant/job/cancel': commerce,
  '/merchant/job/retry': commerce,
  '/merchant/routine-priorities': core,
  '/merchant/blacklist': core,
  '/market/ignored-items': core,
  '/merchant/stale-orders/clear': commerce,
  '/merchant/activity/clear': ['logs'],
  '/merchant/auto-npc-sale': core,
  '/merchant/rule-conflict': commerce,
  '/deconstruction/mark': core,
  '/deconstruction/auto': core,
  '/merchant/auto-stand': core,
  '/merchant/stand': commerce,
  '/merchant/bid': commerce,
  '/merchant/native-stand': commerce,
  '/merchant/npc-sale': commerce,
  '/merchant/order': commerce,
  '/merchant/exchange-order': commerce,
  '/merchant/aldata-order': commerce,
  '/merchant/aldata-sale': commerce,
  '/merchant/ponty-order': commerce,
  '/merchant/donate': inventory,
  '/merchant/join-giveaway': inventory,
  '/merchant/send-mail': [...commerce, 'mail'],
  '/mail/collect': ['mail', 'inventory', 'config', 'bank', 'core'],
  '/mail/delete': ['mail'],
  '/mail/refresh': ['mail'],
  '/mail/settings': ['mail','config','core'],
  '/mail/seen': ['mail'],
  '/mail/outbox-delete': ['mail'],
  '/aldata/key': core,
  '/aldata/refresh': ['market', 'core', 'config'],
  '/anniversary/chat-advertise': core,
  // The event list's rejoin button (the events owner's `event-list` slot).
  '/event-rejoin': core,
  // The account settings' BankBoi prefix and the anniversary dialog's auto chat (`core:status`).
  '/dashboard-preferences': core,
  // The lifecycle owner's Pause, Play and shutdown (runtime/lifecycle/coordinator/routes.ts).
  '/console-control/pause': core,
  '/console-control/play': core,
  '/console-control/shutdown': core,
  '/console-control/cancel-shutdown': core,
  '/console-control/cancel-resume': core,
  // The state import's limits and preview change nothing; its import replaces the saved settings.
  '/dashboard-state': [],
  '/dashboard-state/export': [],
  '/dashboard-state/preview': [],
  '/dashboard-state/import': core,
  // Reads that go through the action client for its session handling: the upgrade preview, the
  // ALData key and its authentication check.
  '/upgrade-preview': [],
  '/aldata/auth': [],
  // Table K's key screen: issuing a key changes no state section; the screen reads its own list.
  '/apps': [],
  // The metrics reset's own query keys settle in its mutation (metrics-reset.ts).
  '/metrics/reset': [],
} satisfies Record<string, readonly Domain[]>;
export type ActionPath =
  | keyof typeof actionDomains
  | '/command'
  | `/slots/${number}/${'spawn' | 'logout'}`
  | `/bankbois/${string}/delete`
  | `/combat-log/${string}/clear`
  | `/apps/${string}/${'revoke' | 'own-commands'}`;
export function affectedDomains(
  path: string,
  body?: unknown,
): readonly Domain[] {
  if (path === '/command') {
    const type = (body as { type?: string } | undefined)?.type || '';
    if (type === 'withdraw') return commerce;
    return /travel|town|gold-target/.test(type) ? core : inventory;
  }
  if (/^\/slots\/\d+\/(spawn|logout)$/.test(path)) return inventory;
  if (/^\/bankbois\/[^/]+\/delete$/.test(path)) return ['core', 'config', 'bank'];
  if (/^\/combat-log\/[^/]+\/clear$/.test(path)) return ['logs'];
  if (/^\/apps\/[^/]+\/(revoke|own-commands)$/.test(path)) return [];
  // An add-on's dashboard read only reads (runtime/hooks/dashboard/slots.tsx dashboardRead).
  if (path.startsWith('/addon-read?')) return [];
  // A saved character's inspection only reads (the lifecycle owner's inspection route).
  if (/^\/characters\/[^/]+\/inspection$/.test(path)) return [];
  const domains = actionDomains[path as keyof typeof actionDomains];
  if (!domains) throw new Error(`Missing action cache policy: ${path}`);
  return domains;
}
export class PartyActionError extends Error {
  readonly status: number;
  readonly details: Record<string, unknown>;
  constructor(status: number, details: Record<string, unknown>) {
    super(typeof details.error === 'string' ? details.error : typeof details.text === 'string' ? details.text : 'Action failed');
    this.status = status;
    this.details = details;
  }
}
// A request's options beside its JSON body: a GET read, a text body with its own headers, an abort.
export interface ActionOptions { method?: 'GET' | 'POST'; text?: string; headers?: Record<string, string>; signal?: AbortSignal }
// The one session-loss rule for every write and host request: a 401, a 403 or any redirected
// answer ends the session.
async function send(client: QueryClient | undefined, url: string, body: unknown, options: ActionOptions) {
  const method = options.method ?? 'POST';
  const response = await fetch(url, {
    method, signal: options.signal,
    headers: { 'Content-Type': options.text === undefined ? 'application/json' : 'text/plain;charset=UTF-8', ...options.headers },
    body: method === 'GET' ? undefined : options.text ?? JSON.stringify(body),
  });
  // A refusal whose body is not JSON keeps its text, or its status line when the body is empty.
  const text = await response.text();
  let result: Record<string, unknown>;
  try { result = JSON.parse(text) as Record<string, unknown>; }
  catch { result = { text: text || `HTTP ${response.status} ${response.statusText}` }; }
  if (response.status === 401 || response.status === 403 || response.redirected)
    authenticationLost(client);
  return { response, result };
}
// T names the answer's shape for a caller that reads it; the route's handler is its source.
export async function performAction<T = Record<string, unknown>>(
  client: QueryClient,
  path: string,
  body: unknown,
  options: ActionOptions = {},
) {
  const domains = affectedDomains(path, body);
  await Promise.all(
    domains.map((domain) => client.cancelQueries({ queryKey: key(domain) })),
  );
  const { response, result } = await send(client, API + path,
    path === '/steam/action' ? steamClientSetup(body, typeof window === 'undefined' ? undefined : window.localStorage) : body, options);
  if (!response.ok || response.redirected) {
    if (response.status === 409 && Array.isArray(result.missing))
      await Promise.all(
        commerce.map((domain) =>
          client.invalidateQueries({
            queryKey: key(domain),
            refetchType: 'active',
          }),
        ),
      );
    throw new PartyActionError(response.status, result);
  }
  if (path.startsWith('/mail/') && Array.isArray(result.messages))
    client.setQueryData(key('mail'), result);
  // A successful enqueue is not an inventory receipt. Keep confirmed items until a later observation.
  await Promise.all(
    domains.map((domain) =>
      client.invalidateQueries({
        queryKey: key(domain),
        refetchType: 'active',
      }),
    ),
  );
  return result as T;
}
// A request to the host programs beside the coordinator (tools/: the build, the update service, the
// debug instance, the pairing setup), with the same session handling and no state section to refresh.
export async function hostAction<T = Record<string, unknown>>(client: QueryClient, path: string, body: unknown = {}, options: ActionOptions = {}) {
  const { response, result } = await send(client, path, body, options);
  if (!response.ok || response.redirected) throw new PartyActionError(response.status, result);
  return result as T;
}
// A report the page sends from outside any component, with no query client to refresh: the cap
// counts' post (cap-counts.ts). It keeps the session-loss rule of every other write.
export async function reportAction<T = Record<string, unknown>>(path: '/diagnostics/caps', body: unknown) {
  const { response, result } = await send(undefined, API + path, body, {});
  if (!response.ok || response.redirected) throw new PartyActionError(response.status, result);
  return result as T;
}
export function usePartyAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: ActionPath; body: unknown }) =>
      performAction(client, path, body),
    retry: false,
    networkMode: 'always',
  });
}
