// addon:check rule 11, the read table:
// every value an owner's door exports is a `READS` row, a `DOOR_ONLY` row or an offered action's door;
// every `PLAIN` rule-file export of kind `read` is a `READS` row; and every table F report field
// (runtime/status/rules.ts `characterFields`) is a member of the published `StatusReport` type.
// A `READS` row's `door` and a `DOOR_ONLY` key name the export as `<file>#<export>`. A `DOOR_ONLY` row
// is `{ kind: 'write' | 'port' | 'command' }` or `{ closed: 'KY', cite }`. It reads syntax with the
// TypeScript parser and guesses nothing.
import type * as TS from 'typescript';
import { DOOR, exportedValues, ownerOfRows } from './actions.mts';
import { parse, ts } from './uses.mts';

type Sources = ReadonlyMap<string, string>;
type DoorOnly = { kind?: string; closed?: string; cite?: string };
export interface ReadRows {
  HOOKS: object; PLAIN?: Readonly<Record<string, string>>; READS?: Readonly<Record<string, { door: string; side?: string }>>;
  DOOR_ONLY?: Readonly<Record<string, DoorOnly>>; ACTIONS?: Readonly<Record<string, { door?: string; closed?: string }>>;
}
export const DOOR_KINDS = ['write', 'port', 'command'] as const;
// The file that publishes the report type an add-on reads.
export const REPORT_TYPE = { file: 'runtime/status/api.ts', name: 'StatusReport' } as const;

// The member names of an interface or type alias declared in `files`, with the members of each
// interface it extends and each type its alias intersects, read by name from the same files.
export function membersOf(name: string, files: readonly string[], sources: Sources, keyed: (table: string) => readonly string[] = () => [],
  seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(name)) return out;
  seen.add(name);
  const fromType = (type: TS.TypeNode | undefined) => {
    if (!type) return;
    if (ts.isTypeLiteralNode(type)) for (const m of type.members) { if (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) out.add(m.name.text); }
    else if (ts.isIntersectionTypeNode(type)) type.types.forEach(fromType);
    else if (ts.isParenthesizedTypeNode(type)) fromType(type.type);
    else if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) for (const m of membersOf(type.typeName.text, files, sources, keyed, seen)) out.add(m);
    // `{ [K in keyof typeof <table>]?: T }` holds each key of the table that `keyed` names.
    else if (ts.isMappedTypeNode(type)) {
      const keys = type.typeParameter.constraint;
      if (keys && ts.isTypeOperatorNode(keys) && keys.operator === ts.SyntaxKind.KeyOfKeyword && ts.isTypeQueryNode(keys.type) && ts.isIdentifier(keys.type.exprName))
        for (const m of keyed(keys.type.exprName.text)) out.add(m);
    }
  };
  for (const file of files) {
    const text = sources.get(file);
    if (text === undefined) continue;
    for (const s of parse(file, text).statements) {
      if (ts.isInterfaceDeclaration(s) && s.name.text === name) {
        for (const m of s.members) if (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) out.add(m.name.text);
        for (const clause of s.heritageClauses ?? []) for (const t of clause.types)
          if (ts.isIdentifier(t.expression)) for (const m of membersOf(t.expression.text, files, sources, keyed, seen)) out.add(m);
      } else if (ts.isTypeAliasDeclaration(s) && s.name.text === name) fromType(s.type);
    }
  }
  return out;
}

export function readFindings(files: Readonly<Record<string, ReadRows>>, reportFields: readonly string[], sources: Sources,
  moduleOf: (file: string) => string | null): string[] {
  const findings: string[] = [];
  for (const [rowsFile, rows] of Object.entries(files)) {
    const owner = ownerOfRows(rowsFile), at = `runtime/hooks/${rowsFile}`;
    const read = new Set(Object.values(rows.READS ?? {}).map(r => r.door));
    // A read on both sides names its character door's export; the owner's coordinator door exports the
    // same name for the coordinator's answer, so that export is the same read.
    const both = new Set(Object.values(rows.READS ?? {}).flatMap(r => r.side === 'both' ? [r.door.slice(r.door.indexOf('#') + 1)] : []));
    const acted = new Set(Object.values(rows.ACTIONS ?? {}).flatMap(r => r.door === undefined ? [] : [r.door]));
    for (const [key, row] of Object.entries(rows.DOOR_ONLY ?? {})) {
      if (row.closed !== undefined) {
        if (row.closed !== 'KY') findings.push(`${at} DOOR_ONLY ${key}: closed with "${row.closed}"; a door export closes only as KY`);
        else if (!row.cite?.trim()) findings.push(`${at} DOOR_ONLY ${key}: its closing code KY cites nothing`);
      } else if (!(DOOR_KINDS as readonly string[]).includes(row.kind ?? '')) findings.push(`${at} DOOR_ONLY ${key}: kind "${row.kind ?? ''}" is not one of ${DOOR_KINDS.join(', ')}`);
    }
    for (const file of [...sources.keys()].filter(f => DOOR.test(f) && moduleOf(f) === owner).sort())
      for (const name of exportedValues(file, sources)) {
        const key = `${file}#${name}`;
        if (!read.has(key) && !both.has(name) && !Object.hasOwn(rows.DOOR_ONLY ?? {}, key) && !acted.has(name))
          findings.push(`${key}: owner ${owner}'s door exports it, and ${at} has no READS row, DOOR_ONLY row or offered action for it`);
      }
    for (const [fn, kind] of Object.entries(rows.PLAIN ?? {}))
      if (kind === 'read' && ![...read].some(door => door.endsWith(`#${fn}`))) findings.push(`${at} PLAIN ${fn}: a read with no READS row`);
  }
  const statusFiles = [...sources.keys()].filter(f => f.startsWith('runtime/status/'));
  // A mapped type over table F (`keyof typeof characterFields`) holds its fields.
  const members = membersOf(REPORT_TYPE.name, [REPORT_TYPE.file, ...statusFiles.filter(f => f !== REPORT_TYPE.file)], sources,
    table => table === 'characterFields' ? reportFields : []);
  for (const field of reportFields) if (!members.has(field))
    findings.push(`runtime/status/rules.ts characterFields ${field}: the published ${REPORT_TYPE.name} (${REPORT_TYPE.file}) has no member ${field}`);
  return findings;
}
