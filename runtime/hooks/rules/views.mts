// addon:check rule 12, the views (addon-capabilities.md C3 and C6 "The guide and the types say where
// each hook runs"): every hook row names its `side`; every answer an add-on may give takes
// `AddonContext` after its settings, or last with no settings; and every type a `Registration` hook signature, `PublishedReads`
// or `AddonContext` names is exported from addon-api.ts. A type name counts when registry.ts declares
// or imports it, so the language's own types and a signature's type parameters pass. It reads syntax
// with the TypeScript parser and guesses nothing.
import type * as TS from 'typescript';
import { ADDON_API, parse, resolveIn, ts } from './uses.mts';

type Sources = ReadonlyMap<string, string>;
type HookRows = Readonly<Record<string, { kind: string; core?: true; side?: string }>>;
export const REGISTRY = 'runtime/hooks/registry.ts';
export const CONTEXT = 'AddonContext';

// Every name a module exports, types included, through `export *` and named re-exports.
export function exportedNames(file: string, sources: Sources, seen = new Set<string>()): Set<string> {
  const names = new Set<string>(), text = sources.get(file);
  if (text === undefined || seen.has(file)) return names;
  seen.add(file);
  for (const s of parse(file, text).statements) {
    if (ts.isExportDeclaration(s)) {
      if (!s.exportClause && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier))
        for (const name of exportedNames(resolveIn(sources, file, s.moduleSpecifier.text), sources, seen)) names.add(name);
      else if (s.exportClause && ts.isNamedExports(s.exportClause)) for (const e of s.exportClause.elements) names.add(e.name.text);
      else if (s.exportClause) names.add(s.exportClause.name.text);
    } else if (ts.canHaveModifiers(s) && ts.getModifiers(s)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      const named = s as TS.Statement & { name?: TS.Identifier };
      if (named.name && ts.isIdentifier(named.name)) names.add(named.name.text);
      if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
    }
  }
  return names;
}

export function viewFindings(hooks: HookRows, sources: Sources): string[] {
  const findings: string[] = [], text = sources.get(REGISTRY);
  for (const [name, row] of Object.entries(hooks)) if (!row.side) findings.push(`the hook ${name} names no side (character, coordinator or both)`);
  if (text === undefined) return [...findings, `${REGISTRY} is not in the tree`];
  const source = parse(REGISTRY, text), line = (node: TS.Node) => `${REGISTRY}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
  const top = new Map<string, TS.Statement>(), local = new Set<string>();
  for (const s of source.statements) {
    const named = s as TS.Statement & { name?: TS.Node };
    if ((ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && named.name && ts.isIdentifier(named.name)) {
      top.set(named.name.text, s); local.add(named.name.text);
    } else if (ts.isImportDeclaration(s) && s.importClause) {
      const { name, namedBindings } = s.importClause;
      if (name) local.add(name.text);
      if (namedBindings && ts.isNamedImports(namedBindings)) for (const e of namedBindings.elements) local.add(e.name.text);
    }
  }
  const registration = top.get('Registration');
  const hooksType = registration && ts.isInterfaceDeclaration(registration)
    ? registration.members.find((m): m is TS.PropertySignature => ts.isPropertySignature(m) && m.name.getText(source) === 'hooks')?.type : undefined;
  if (!hooksType) return [...findings, `${REGISTRY}: Registration declares no hooks`];
  // The hooks type's parts: literals of named answers, mapped parts over a union of hook names
  // (`[hook in OwnTaskHook]?: ...`), and the notices' `Partial<Record<NoticeName, ...>>`.
  const parts = ts.isIntersectionTypeNode(hooksType) ? hooksType.types : [hooksType];
  const members = new Map<string, TS.TypeElement | TS.FunctionTypeNode>();
  const union = (name: string): string[] => {
    const alias = top.get(name), type = alias && ts.isTypeAliasDeclaration(alias) ? alias.type : undefined;
    const types = type && ts.isUnionTypeNode(type) ? type.types : type ? [type] : [];
    return types.flatMap(t => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? [t.literal.text] : []);
  };
  let notice: TS.FunctionTypeNode | undefined;
  for (const part of parts) {
    if (ts.isTypeLiteralNode(part)) for (const m of part.members) { if (m.name && ts.isStringLiteral(m.name)) members.set(m.name.text, m); }
    // `Partial<PublishedReads>`: a read an add-on also answers, such as `hands.normal`.
    const reads = ts.isTypeReferenceNode(part) && part.typeName.getText(source) === 'Partial' && part.typeArguments?.[0]?.getText(source) === 'PublishedReads'
      ? top.get('PublishedReads') : undefined;
    if (reads && ts.isInterfaceDeclaration(reads)) for (const m of reads.members) if (m.name && ts.isStringLiteral(m.name) && !members.has(m.name.text)) members.set(m.name.text, m);
    if (ts.isMappedTypeNode(part) && part.type && ts.isFunctionTypeNode(part.type)) {
      const over = part.typeParameter.constraint;
      for (const name of over && ts.isTypeReferenceNode(over) ? union(over.typeName.getText(source)) : []) members.set(name, part.type);
    }
    const record = ts.isTypeReferenceNode(part) && part.typeName.getText(source) === 'Partial' ? part.typeArguments?.[0] : undefined;
    const fn = record && ts.isTypeReferenceNode(record) && record.typeName.getText(source) === 'Record' ? record.typeArguments?.[1] : undefined;
    if (fn && ts.isFunctionTypeNode(fn)) notice = fn;
  }
  // The registry's wrapper (registry.ts `withContext`) hands the context right after the settings, or
  // last when an answer takes no settings, so the signature's context sits there.
  const takesContext = (params: readonly TS.ParameterDeclaration[]) => {
    const settings = params.findIndex(p => p.name.getText(source) === 'settings');
    return params[settings < 0 ? params.length - 1 : settings + 1]?.type?.getText(source) === CONTEXT;
  };
  // The answer of an array hook (`movement.request`, `skills.request`) is its element's `answer`.
  const answerOf = (member: TS.TypeElement | TS.FunctionTypeNode): TS.SignatureDeclarationBase | undefined => {
    if (ts.isMethodSignature(member) || ts.isFunctionTypeNode(member)) return member;
    let type = ts.isPropertySignature(member) ? member.type : undefined;
    if (type && ts.isTypeOperatorNode(type)) type = type.type;
    const element = type && ts.isArrayTypeNode(type) ? type.elementType : undefined;
    const declared = element && ts.isTypeReferenceNode(element) ? top.get(element.typeName.getText(source)) : undefined;
    return declared && ts.isInterfaceDeclaration(declared)
      ? declared.members.find((m): m is TS.MethodSignature => ts.isMethodSignature(m) && m.name.getText(source) === 'answer') : undefined;
  };
  for (const [name, row] of Object.entries(hooks)) {
    if (row.core) continue;
    const member = members.get(name);
    if (member) {
      const answer = answerOf(member);
      if (!answer) findings.push(`${line(member)} ${name}: its answer's signature cannot be read`);
      else if (!takesContext(answer.parameters)) findings.push(`${line(answer)} ${name}: the answer takes no ${CONTEXT} after its settings`);
    } else if (row.kind === 'notice') {
      if (!notice) findings.push(`${REGISTRY}: Registration declares no notice signature, so ${name} has none`);
      else if (!takesContext(notice.parameters)) findings.push(`${line(notice)} ${name}: the notice answer takes no ${CONTEXT} after its settings`);
    } else findings.push(`${REGISTRY}: Registration hooks declare no answer for ${name}`);
  }
  // The type names the signatures, the published reads and the context name.
  const exported = exportedNames(ADDON_API, sources), named = new Map<string, TS.Node>();
  const collect = (node: TS.Node) => {
    if (ts.isTypeReferenceNode(node)) {
      const id = node.typeName;
      if (ts.isIdentifier(id) && local.has(id.text) && !named.has(id.text)) named.set(id.text, node);
    }
    ts.forEachChild(node, collect);
  };
  collect(hooksType);
  for (const name of ['PublishedReads', CONTEXT]) { const s = top.get(name); if (s) collect(s); else findings.push(`${REGISTRY} declares no ${name}`); }
  for (const [name, node] of named) if (!exported.has(name))
    findings.push(`${line(node)}: a hook signature names the type ${name}, which ${ADDON_API} does not export`);
  return findings;
}
