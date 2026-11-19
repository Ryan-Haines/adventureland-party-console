// addon:check rule 13, the pieces: every piece's props
// (`AddonPieceProps`) and an add-on dialog's props (`AddonDialogProps`, once the kit declares it)
// intersect `AddonPieceBase`; each `list-view` part names its published row type in the kit's
// `AddonListRows`, a type the kit exports; and the add-on manager's switch on a setting's kind has a
// case for each of the settings owner's `ADDON_KINDS`. It reads syntax with the TypeScript parser and
// guesses nothing.
import type * as TS from 'typescript';
import { exportedNames } from './views.mts';
import { parse, ts } from './uses.mts';

type Sources = ReadonlyMap<string, string>;
export const KIT = 'dashboard/features/party/addon-kit.ts';
export const MANAGER = 'runtime/hooks/dashboard/settings-page.tsx';
export const BASE = 'AddonPieceBase', LIST_ROWS = 'AddonListRows', LIST_PLACE = 'list-view';

// The kit's `ADDON_PLACES`: each place with its parts, read from the object literal.
export function placesOf(source: TS.SourceFile): Record<string, string[]> {
  const places: Record<string, string[]> = {};
  for (const s of source.statements) if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) {
    if (!ts.isIdentifier(d.name) || d.name.text !== 'ADDON_PLACES' || !d.initializer) continue;
    let value: TS.Expression = d.initializer;
    while (ts.isAsExpression(value) || ts.isSatisfiesExpression(value)) value = value.expression;
    if (ts.isObjectLiteralExpression(value)) for (const p of value.properties)
      if (ts.isPropertyAssignment(p) && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name)) && ts.isArrayLiteralExpression(p.initializer))
        places[p.name.text] = p.initializer.elements.flatMap(e => ts.isStringLiteralLike(e) ? [e.text] : []);
  }
  return places;
}

export function pieceFindings(kinds: readonly string[], sources: Sources): string[] {
  const findings: string[] = [], kit = sources.get(KIT), manager = sources.get(MANAGER);
  if (kit === undefined) findings.push(`${KIT} is not in the tree`);
  else {
    const source = parse(KIT, kit), top = new Map<string, TS.Statement>();
    for (const s of source.statements) if ((ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) && ts.isIdentifier(s.name)) top.set(s.name.text, s);
    const at = (node: TS.Node) => `${KIT}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
    // A props type holds the base when its alias intersects it or its interface extends it.
    const holdsBase = (s: TS.Statement): boolean => {
      if (ts.isInterfaceDeclaration(s)) return !!s.heritageClauses?.some(c => c.types.some(t => t.expression.getText(source) === BASE));
      if (!ts.isTypeAliasDeclaration(s)) return false;
      const parts = ts.isIntersectionTypeNode(s.type) ? s.type.types : [s.type];
      return parts.some(p => ts.isTypeReferenceNode(p) && p.typeName.getText(source) === BASE);
    };
    for (const name of ['AddonPieceProps', 'AddonDialogProps']) {
      const s = top.get(name);
      if (!s) { if (name === 'AddonPieceProps') findings.push(`${KIT} declares no AddonPieceProps`); continue; }
      if (!holdsBase(s)) findings.push(`${at(s)}: ${name} does not take ${BASE}, so its pieces lack the powers every piece gets`);
    }
    const parts = placesOf(source)[LIST_PLACE];
    if (!parts) findings.push(`${KIT} ADDON_PLACES has no ${LIST_PLACE} place`);
    else {
      const rows = top.get(LIST_ROWS), exported = exportedNames(KIT, sources), named = new Map<string, TS.TypeNode | undefined>();
      if (rows && ts.isInterfaceDeclaration(rows)) for (const m of rows.members)
        if (m.name && (ts.isStringLiteral(m.name) || ts.isIdentifier(m.name))) named.set(m.name.text, ts.isPropertySignature(m) ? m.type : undefined);
      for (const part of parts) {
        const type = named.get(part);
        if (!type) findings.push(`${KIT} ${LIST_ROWS}: the ${LIST_PLACE} part ${part} names no published row type`);
        else if (!(ts.isTypeReferenceNode(type) && exported.has(type.typeName.getText(source))))
          findings.push(`${at(type)}: the ${LIST_PLACE} part ${part}'s row type ${type.getText(source)} is not a type ${KIT} exports`);
      }
    }
  }
  if (manager === undefined) findings.push(`${MANAGER} is not in the tree`);
  else {
    const cases = new Set<string>();
    const visit = (node: TS.Node) => {
      if (ts.isSwitchStatement(node) && /\.kind$/.test(node.expression.getText()))
        for (const clause of node.caseBlock.clauses) if (ts.isCaseClause(clause) && ts.isStringLiteralLike(clause.expression)) cases.add(clause.expression.text);
      ts.forEachChild(node, visit);
    };
    visit(parse(MANAGER, manager));
    for (const kind of kinds) if (!cases.has(kind)) findings.push(`${MANAGER}: the add-on manager draws no ${kind} setting (no case "${kind}" in its switch on the kind)`);
  }
  return findings;
}
