// addon:check rule 10, the action table.
// The game call universe is the union of four sources: every ClientToServer_<event> type
// typed-adventureland ships, every `case` the call budget's `price` switch prices, every game call and
// socket emit row owner-check's scanner finds, and every game function a file declares as a game global
// (`declare const <name>: Untyped`). Each event and each function sits in exactly one owner's `ACTIONS`
// row. A closed row names one of the five codes and a cite; an offered row's door is an export of its
// owner's door; and owner-check finds each call in the row's own owner. It reads syntax with the
// TypeScript parser and guesses nothing.
//
// A generic function acts on the thing its first argument names, so its owner is decided per thing:
// a row lists `use_skill:blink` for one skill and `use:town` for one item, owned by the owner whose
// decision uses it, as the turns, movement, merchant and hands owners decide them. A function with a
// per-thing row is generic; its bare row (03's `use_skill`, 05's `use`) owns every other thing. A
// call whose thing is a string literal (owner-check's call `use_skill(blink)`) belongs to that
// thing's row, and to the bare row when the thing has none. A call whose thing is a value
// (`use_skill(mode)`) passes in an owner that holds the bare row or a per-thing row of the function,
// since the scanner cannot read which thing the value holds.
import type * as TS from 'typescript';
import { parse, resolveIn, ts } from './uses.mts';

type Sources = ReadonlyMap<string, string>;
type Row = { events?: readonly string[]; functions?: readonly string[]; door?: string; closed?: string; cite?: string };
export interface ActionRows { HOOKS: object; ACTIONS?: Readonly<Record<string, Row>> }
// A row owner-check's scanner finds (tools/owner-check.mjs `scanFile`).
export interface ScanRow { file: string; line: number; kind: string; call: string; owner: string }
export const CLOSE_CODES = ['CL', 'SV', 'KY', 'AS', 'FW'] as const;
export const BUDGET = 'runtime/characters/call-budget.ts';
// A game call's global is declared `Untyped`; a client-side read that sends nothing is declared
// `GameRead` (items/character/calls.ts), so it is no call.
const UNTYPED = 'Untyped';

// The owner of a rows file: rows/10-items.ts is 10's.
export const ownerOfRows = (rowsFile: string) => rowsFile.slice('rows/'.length, 'rows/'.length + 2);
// An owner's doors: its runtime/<area>/api.ts, coordinator/api.ts and api/<side>.ts files, and 14's
// action dispatcher in runtime/hooks/actions/. The add-on system's own api/ files publish, so they are
// no door.
export const DOOR = /^runtime\/(?!hooks\/)[\w/-]*?(\/api\.ts|\/api\/[\w-]+\.ts)$|^runtime\/hooks\/actions\/[\w-]+\.ts$/;

// The value names a file exports: declarations with `export`, `export { a, b }` and named re-exports
// that are not `type`, and every value an `export * from` file exports. Types are no state, so they
// are left out.
export function exportedValues(file: string, sources: Sources, seen = new Set<string>()): Set<string> {
  const names = new Set<string>(), text = sources.get(file);
  if (text === undefined || seen.has(file)) return names;
  seen.add(file);
  const exported = (s: TS.Statement) => ts.canHaveModifiers(s) && !!ts.getModifiers(s)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const s of parse(file, text).statements) {
    if (ts.isExportDeclaration(s)) {
      if (s.isTypeOnly) continue;
      if (!s.exportClause && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier))
        for (const name of exportedValues(resolveIn(sources, file, s.moduleSpecifier.text), sources, seen)) names.add(name);
      else if (s.exportClause && ts.isNamedExports(s.exportClause)) for (const e of s.exportClause.elements) { if (!e.isTypeOnly) names.add(e.name.text); }
      else if (s.exportClause) names.add(s.exportClause.name.text);
    } else if (exported(s)) {
      if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && s.name) names.add(s.name.text);
      else if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
    }
  }
  return names;
}

// The events the call budget prices: the string `case` labels of `price`'s switch.
export function pricedEvents(sources: Sources): string[] {
  const text = sources.get(BUDGET), out: string[] = [];
  if (text === undefined) return out;
  const visit = (node: TS.Node, inside: boolean) => {
    const here = inside || ts.isFunctionDeclaration(node) && node.name?.text === 'price';
    if (here && ts.isCaseClause(node) && ts.isStringLiteralLike(node.expression)) out.push(node.expression.text);
    ts.forEachChild(node, child => visit(child, here));
  };
  visit(parse(BUDGET, text), false);
  return out;
}

// The game functions a file declares as globals of the character realm, `declare const <name>: Untyped`.
export function declaredGlobals(sources: Sources): { name: string; at: string }[] {
  const out: { name: string; at: string }[] = [];
  for (const [file, text] of sources) {
    if (!/^runtime\/.+\.ts$/.test(file) || !text.includes(UNTYPED)) continue;
    const source = parse(file, text);
    for (const s of source.statements) {
      if (!ts.isVariableStatement(s) || !ts.getModifiers(s)?.some(m => m.kind === ts.SyntaxKind.DeclareKeyword)) continue;
      for (const d of s.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.type && ts.isTypeReferenceNode(d.type) && d.type.typeName.getText(source) === UNTYPED)
          out.push({ name: d.name.text, at: `${file}:${source.getLineAndCharacterOfPosition(d.getStart(source)).line + 1}` });
    }
  }
  return out;
}

// The event or function a scanned row calls: `emit(bank)` is the event bank, `use(town)` the function use.
export const scanned = (row: ScanRow): { kind: 'event' | 'function'; name: string } | undefined =>
  row.kind === 'socket-emit' ? { kind: 'event', name: row.call.replace(/^emit\(|\)$/g, '') }
    : row.kind === 'game-call' ? { kind: 'function', name: row.call.replace(/\(.*$/, '') } : undefined;
// A row's function key: `use_skill:blink` is use_skill's row for blink, `use_skill` the bare row. The
// key is no call's text, so owner-check's scanner reads no call in a rows file.
export const thingOf = (key: string): { name: string; thing?: string } => {
  const at = key.indexOf(':');
  return at < 0 ? { name: key } : { name: key.slice(0, at), thing: key.slice(at + 1) };
};
// A scanned call's thing: owner-check writes a string literal first argument into the call,
// `use_skill('blink')`; a call with a value carries none.
const calledThing = (call: string): string | undefined => /^[\w$]+\(["'`](\w+)["'`]?\)$/.exec(call)?.[1];

export function actionFindings(files: Readonly<Record<string, ActionRows>>, typedEvents: readonly string[], scan: readonly ScanRow[], sources: Sources,
  moduleOf: (file: string) => string | null): string[] {
  const findings: string[] = [];
  // Where each event and function sits: the rows that list it, as `<rows file> <action>`.
  const placed = { event: new Map<string, { owner: string; at: string }[]>(), function: new Map<string, { owner: string; at: string }[]>() };
  const doors = new Map<string, Set<string>>();
  for (const file of sources.keys()) if (DOOR.test(file)) {
    const owner = moduleOf(file);
    if (!owner) continue;
    const names = doors.get(owner) ?? new Set<string>();
    for (const name of exportedValues(file, sources)) names.add(name);
    doors.set(owner, names);
  }
  for (const [rowsFile, rows] of Object.entries(files)) {
    const owner = ownerOfRows(rowsFile);
    for (const [action, row] of Object.entries(rows.ACTIONS ?? {})) {
      const at = `runtime/hooks/${rowsFile} ACTIONS ${action}`;
      for (const [kind, list] of [['event', row.events], ['function', row.functions]] as const)
        for (const name of list ?? []) { const seen = placed[kind].get(name) ?? []; seen.push({ owner, at }); placed[kind].set(name, seen); }
      if (row.door !== undefined) {
        if (!doors.get(owner)?.has(row.door)) findings.push(`${at}: its door ${row.door} is not an export of owner ${owner}'s door`);
      } else if (!(CLOSE_CODES as readonly string[]).includes(row.closed ?? '')) findings.push(`${at}: closed with "${row.closed ?? ''}", which is not one of ${CLOSE_CODES.join(', ')}`);
      else if (!row.cite?.trim()) findings.push(`${at}: its closing code ${row.closed} cites nothing`);
    }
  }
  const universe = { event: new Map<string, string>(), function: new Map<string, string>() };
  for (const event of typedEvents) universe.event.set(event, 'typed-adventureland');
  for (const event of pricedEvents(sources)) if (!universe.event.has(event)) universe.event.set(event, `${BUDGET} price`);
  for (const row of scan) { const call = scanned(row); if (call && !universe[call.kind].has(call.name)) universe[call.kind].set(call.name, `${row.file}:${row.line}`); }
  for (const { name, at } of declaredGlobals(sources)) if (!universe.function.has(name)) universe.function.set(name, at);
  // Each generic function's per-thing rows, by function name.
  const things = new Map<string, Map<string, { owner: string; at: string }[]>>();
  for (const [key, rows] of placed.function) {
    const { name, thing } = thingOf(key);
    if (thing === undefined) continue;
    if (!things.has(name)) things.set(name, new Map());
    things.get(name)!.set(thing, rows);
    if (rows.length > 1) findings.push(`the game function ${key} sits in ${rows.length} ACTIONS rows: ${rows.map(r => r.at).join(', ')}`);
  }
  for (const kind of ['event', 'function'] as const) {
    for (const [name, source] of universe[kind]) {
      const rows = placed[kind].get(name) ?? [];
      if (!rows.length && !(kind === 'function' && things.has(name))) findings.push(`the game ${kind} ${name} (${source}) has no ACTIONS row`);
      else if (rows.length > 1) findings.push(`the game ${kind} ${name} sits in ${rows.length} ACTIONS rows: ${rows.map(r => r.at).join(', ')}`);
    }
  }
  for (const row of scan) {
    const call = scanned(row);
    if (!call) continue;
    const perThing = call.kind === 'function' ? things.get(call.name) : undefined;
    const literal = calledThing(row.call);
    if (perThing && literal === undefined) {
      const owners = [...placed.function.get(call.name) ?? [], ...[...perThing.values()].flat()];
      if (!owners.some(r => r.owner === row.owner))
        findings.push(`${row.file}:${row.line}: owner ${row.owner} calls the game function ${call.name} with a value, and owner ${row.owner} holds no ACTIONS row of ${call.name}`);
      continue;
    }
    const rows = (literal !== undefined && perThing?.get(literal)) || placed[call.kind].get(call.name) || [];
    const what = literal !== undefined && perThing?.has(literal) ? `${call.name}:${literal}` : call.name;
    if (rows.length === 1 && rows[0]!.owner !== row.owner)
      findings.push(`${row.file}:${row.line}: owner ${row.owner} calls the game ${call.kind} ${what}, which ${rows[0]!.at} gives to owner ${rows[0]!.owner}`);
  }
  return findings;
}
