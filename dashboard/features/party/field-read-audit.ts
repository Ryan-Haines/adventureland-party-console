'use client';
// Records which per-character fields the dashboard reads, for the field
// registry's shadow rollout (docs/state-field-registry.md). It is off unless
// localStorage 'party-field-audit' is '1' or the E2E fixture installs
// window.__partyFieldAudit; when off, audited() returns its input unchanged.
import { characterFields, sectionFields, streamFields as liveFields } from '../../../runtime/coordinator/telemetry/character-fields.ts';

export type AuditKind = 'vitals' | 'position' | 'inventory' | 'diagnostics' | 'presence' | 'core' | 'merged';
export interface FieldAuditRecord {
  kind: AuditKind;
  field: string;
  how: 'read' | 'enumerated';
  site: string;
}
declare global {
  interface Window {
    __partyFieldAudit?: (record: FieldAuditRecord) => void;
  }
}

const everyLean = new Set<string>([...Object.values(sectionFields).flat(), ...liveFields]);
/** Fields each cache kind can hold once PARTY_STATE_FIELDS=enforce (query-cache.tsx, dashboard-live.tsx). */
const sources: Record<AuditKind, Set<string>> = {
  vitals: new Set([...sectionFields.fast, ...liveFields]),
  position: new Set([...sectionFields.fast, ...liveFields]),
  diagnostics: new Set([...sectionFields.diagnostics, ...sectionFields.fast, 'combat']),
  inventory: new Set(sectionFields.inventory),
  presence: new Set(['seenAt']),
  core: new Set([...sectionFields.coreSummary, ...sectionFields.fast]),
  merged: everyLean,
};

let active: boolean | undefined;
function enabled() {
  if (active !== undefined) return active;
  if (typeof window === 'undefined') return (active = false);
  try {
    active = typeof window.__partyFieldAudit === 'function' || window.localStorage.getItem('party-field-audit') === '1';
  } catch {
    active = typeof window.__partyFieldAudit === 'function';
  }
  return active;
}

function caller() {
  const frames = (new Error().stack || '').split('\n').slice(1);
  return (frames.find((frame) => !frame.includes('field-read-audit')) || '').trim().slice(0, 200);
}

const reported = new Set<string>();
function note(kind: AuditKind, field: string, how: FieldAuditRecord['how']) {
  const key = `${kind}:${field}:${how}`;
  if (reported.has(key)) return;
  reported.add(key);
  const site = caller();
  window.__partyFieldAudit?.({ kind, field, how, site });
  if (how === 'read' && Object.hasOwn(characterFields, field) && !sources[kind].has(field))
    console.warn(`[field audit] ${kind}.${field} is read but not whitelisted for that source`, site);
}

/** A spread or Object.assign reads every own key in ownKeys order; those reads are copies, not uses. */
const pending = new WeakMap<object, { keys: string[]; index: number }>();
function classify(target: object, field: string): FieldAuditRecord['how'] {
  const copy = pending.get(target);
  if (copy && copy.keys[copy.index] === field) {
    if (++copy.index >= copy.keys.length) pending.delete(target);
    return 'enumerated';
  }
  pending.delete(target);
  return 'read';
}

const proxies = new WeakMap<object, object>();
/** The same object behind a recording proxy, cached so React sees a stable identity. */
export function audited<T>(kind: AuditKind, value: T): T {
  if (!value || typeof value !== 'object' || !enabled()) return value;
  const known = proxies.get(value);
  if (known) return known as T;
  const proxy = new Proxy(value, {
    get(target, field, receiver) {
      if (typeof field === 'string') note(kind, field, classify(target, field));
      return Reflect.get(target, field, receiver);
    },
    has(target, field) {
      if (typeof field === 'string') note(kind, field, 'read');
      return Reflect.has(target, field);
    },
    ownKeys(target) {
      const keys = Reflect.ownKeys(target);
      pending.set(target, { keys: keys.filter((key): key is string => typeof key === 'string'), index: 0 });
      note(kind, '*', 'enumerated');
      return keys;
    },
  });
  proxies.set(value, proxy);
  proxies.set(proxy, proxy);
  return proxy;
}

/** audited() for each character in a name-keyed record, keeping the record itself when auditing is off. */
export function auditedCharacters<T extends Record<string, unknown>>(kind: AuditKind, characters: T): T {
  if (!enabled()) return characters;
  return Object.fromEntries(Object.entries(characters).map(([name, value]) => [name, audited(kind, value)])) as T;
}
