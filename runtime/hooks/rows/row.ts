import type { HookSide, ReadRow } from '../registry.ts';

// The row builders the owners' row files share: a notice and a published read of one owner's part.
// `at` heads each fixture: the table file and the row title's prefix the owner's rows share,
// or nothing when each row names its own
// file. `side` is the row's HookRow side; a row built without one carries none.
export function rowsFor(part: string, at: string) {
  const sided = <S extends HookSide | undefined>(side: S) => (side === undefined ? {} : { side }) as S extends HookSide ? { side: S } : object;
  return {
    notice: <S extends HookSide | undefined = undefined>(fixture: string, receives: string, side?: S) =>
      ({ kind: 'notice', part, answers: 'many', fixture: at + fixture, receives, returns: 'nothing', ...sided(side as S) }) as const,
    read: <M extends boolean, S extends HookSide | undefined = undefined>(fixture: string, receives: string, returns: string, addonMayAsk: M, side?: S) =>
      ({ kind: 'request', part, answers: 'one', core: true, addonMayAsk, fixture: at + fixture, receives, returns, ...sided(side as S) }) as const,
  };
}

// The coverage contract (addon:check rule 8):
// an add-on author never edits core, so each owner's row file lists the files that hold its
// decisions (`RULE_FILES`), each decision with the hook an add-on answers or the reason it is core
// only (`DECISIONS`), and each other export of those files with its plain kind (`PLAIN`).
// A player's setting is no core reason: `settings.overlay` answers each decision one reads.
export const CORE_REASONS = ['game', 'safety', 'call-budget', 'tier-table', 'integrity'] as const;
export type CoreReason = (typeof CORE_REASONS)[number];
export const PLAIN_KINDS = ['label', 'read', 'validator', 'migration', 'format'] as const;
export type PlainKind = (typeof PLAIN_KINDS)[number];
// `at` names the export of a rule file that decides. A decision written outside the rule files names
// its `site` (file:line) instead, which the check reads as a citation only (hook-coverage.md "Limit").
export type DecisionRow = ({ at: `${string}#${string}` } | { site: string }) & ({ hook: string } | { core: CoreReason; cite: string });

// C3's door tables (addon-capabilities.md "The completeness rule", addon:check rule 11). `readsOf`
// names each read of one door file `<prefix>.<export>`, with its published type and the export that
// answers it. `doorOnly` keys each write, port or command export of one door file `<file>#<export>`.
export type DoorKind = 'write' | 'port' | 'command';
export function readsOf<P extends string, T extends Readonly<Record<string, string>>>(prefix: P, side: HookSide, file: string, types: T) {
  return Object.fromEntries(Object.entries(types).map(([name, type]) => [`${prefix}.${name}`, { side, type, door: `${file}#${name}` }])) as
    { [K in keyof T & string as `${P}.${K}`]: ReadRow };
}
export function doorOnly<K extends DoorKind>(file: string, kind: K, names: readonly string[]): Readonly<Record<`${string}#${string}`, { kind: K }>> {
  return Object.fromEntries(names.map(name => [`${file}#${name}`, { kind }]));
}
