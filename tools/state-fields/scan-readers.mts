// Lists which per-character state fields a TypeScript client reads, using the
// type checker. See docs/state-field-registry.md.
//
// node tools/state-fields/scan-readers.mts --project dashboard/tsconfig.json \
//   --include dashboard/features --types Char [--out reads.json]
//
// It records each property access, destructured name, literal element access
// and `in` test on a value whose type is one of --types (directly, or through
// Partial, Pick, Readonly or a union). It lists every
// access it cannot resolve to a field name as dynamic, for manual review.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import path from "node:path";
import type * as TS from "typescript";

interface Options {
  project: string;
  include: string;
  types: Set<string>;
  out?: string;
}
interface Site {
  file: string;
  line: number;
  kind: string;
  text: string;
}
interface Result {
  reads: Record<string, string[]>;
  dynamic: Site[];
}

function options(argv: string[]): Options {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const project = value("--project"), include = value("--include"), types = value("--types");
  if (!project || !include || !types) throw Error("Usage: --project tsconfig --include dir --types A,B [--out file]");
  return { project: path.resolve(project), include: path.resolve(include), types: new Set(types.split(",")), out: value("--out") };
}

/** Utility types whose result keeps the fields of their first argument. Record and Array do not: their keys are names or indexes. */
const wrappers = new Set(["Partial", "Readonly", "Required", "Pick", "Omit", "NonNullable"]);

function scanner(ts: typeof TS, checker: TS.TypeChecker, targets: Set<string>) {
  const declarations = new Set<TS.Node>();
  function targetType(type: TS.Type, depth = 0): boolean {
    if (depth > 4) return false;
    if (type.isUnionOrIntersection()) return type.types.some((part) => targetType(part, depth + 1));
    if (named(type)) return true;
    const alias = type.aliasSymbol;
    return !!alias && wrappers.has(alias.name) && !!type.aliasTypeArguments?.some((part) => targetType(part, depth + 1));
  }
  function named(type: TS.Type): boolean {
    const alias = type.aliasSymbol, symbol = type.getSymbol();
    return (!!alias && targets.has(alias.name)) || (!!symbol && targets.has(symbol.name));
  }
  function declaredInTarget(symbol: TS.Symbol | undefined): boolean {
    if (!symbol) return false;
    // Only direct members count: a nested object's fields are not state fields.
    return checker.getRootSymbols(symbol).some((root) => (root.declarations || []).some((node) => declarations.has(node.parent)));
  }
  function remember(program: TS.Program) {
    for (const file of program.getSourceFiles())
      ts.forEachChild(file, function visit(node) {
        if (ts.isInterfaceDeclaration(node) && targets.has(node.name.text)) declarations.add(node);
        if (ts.isTypeAliasDeclaration(node) && targets.has(node.name.text) && ts.isTypeLiteralNode(node.type)) declarations.add(node.type);
        ts.forEachChild(node, visit);
      });
  }
  const typed = (node: TS.Node) => targetType(checker.getNonNullableType(checker.getTypeAtLocation(node)));
  /** A character value, or a record or array of them. */
  function holds(type: TS.Type): boolean {
    const value = checker.getNonNullableType(type);
    if (targetType(value)) return true;
    const element = checker.isArrayType(value) ? checker.getTypeArguments(value as TS.TypeReference)[0] : checker.getIndexTypeOfType(value, ts.IndexKind.String);
    return !!element && targetType(checker.getNonNullableType(element));
  }
  /** The receiving type's own object type: the type itself, or the value or element type of a record or array. */
  function receiver(type: TS.Type): TS.Type {
    const value = checker.getNonNullableType(type);
    const element = checker.isArrayType(value) ? checker.getTypeArguments(value as TS.TypeReference)[0] : checker.getIndexTypeOfType(value, ts.IndexKind.String);
    return checker.getNonNullableType(element || value);
  }
  /**
   * A character value flowing into a slot typed without the character type,
   * such as a helper with a structural parameter. It returns the receiving
   * type's declared field names, which bound what the helper can read, or
   * null when that type declares none (unknown, any, Record<string, unknown>
   * or a type parameter) and the site needs manual review.
   */
  function escapes(node: TS.Expression): string[] | null | undefined {
    const expected = checker.getContextualType(node);
    if (!expected || !holds(checker.getTypeAtLocation(node)) || holds(expected)) return undefined;
    const shape = receiver(expected);
    const fields = checker.getPropertiesOfType(shape).map((property) => property.name);
    return fields.length && !checker.getIndexInfosOfType(shape).length ? fields : null;
  }
  return { typed, declaredInTarget, remember, escapes };
}

function site(file: TS.SourceFile, node: TS.Node, kind: string, root: string): Site {
  const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
  return { file: path.relative(root, file.fileName).replaceAll("\\", "/"), line: line + 1, kind, text: node.getText(file).slice(0, 160) };
}

function literalName(ts: typeof TS, node: TS.Node | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

/** React hook dependency lists compare references and read no fields. */
function dependencyList(ts: typeof TS, call: TS.CallExpression | TS.NewExpression, argument: TS.Expression): boolean {
  return ts.isArrayLiteralExpression(argument) && /^use(Memo|Callback|Effect|LayoutEffect)$/.test(call.expression.getText().replace(/^React\./, ""));
}

const enumerators = new Set(["Object.keys", "Object.entries", "Object.values", "Object.assign", "JSON.stringify"]);

function inspector(ts: typeof TS, checker: TS.TypeChecker, scan: ReturnType<typeof scanner>, result: Result, root: string) {
  function read(file: TS.SourceFile, node: TS.Node, field: string) {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    (result.reads[field] ||= []).push(`${path.relative(root, file.fileName).replaceAll("\\", "/")}:${line + 1}`);
  }
  const dynamic = (file: TS.SourceFile, node: TS.Node, kind: string) => result.dynamic.push(site(file, node, kind, root));
  function access(file: TS.SourceFile, node: TS.Node) {
    if (ts.isPropertyAccessExpression(node) && (scan.typed(node.expression) || scan.declaredInTarget(checker.getSymbolAtLocation(node.name))))
      read(file, node, node.name.text);
    if (ts.isElementAccessExpression(node) && scan.typed(node.expression)) {
      const name = literalName(ts, node.argumentExpression);
      if (name) read(file, node, name);
      else dynamic(file, node, "computed element access");
    }
  }
  function binding(file: TS.SourceFile, node: TS.Node) {
    if (!ts.isObjectBindingPattern(node) || !scan.typed(node)) return;
    for (const element of node.elements) {
      if (element.dotDotDotToken) dynamic(file, element, "rest binding");
      else read(file, element, (element.propertyName || element.name).getText(file));
    }
  }
  function handOff(file: TS.SourceFile, node: TS.Expression, kind: string) {
    const fields = scan.escapes(node);
    if (fields === null) dynamic(file, node, kind);
    else for (const field of fields || []) read(file, node, field);
  }
  function copies(file: TS.SourceFile, node: TS.Node) {
    if ((ts.isSpreadAssignment(node) || ts.isSpreadElement(node) || ts.isJsxSpreadAttribute(node)) && scan.typed(node.expression))
      dynamic(file, node, "spread");
    if (ts.isCallExpression(node) && enumerators.has(node.expression.getText(file)) && node.arguments.some((argument) => scan.typed(argument)))
      dynamic(file, node, node.expression.getText(file));
  }
  function casts(file: TS.SourceFile, node: TS.Node) {
    if (ts.isAsExpression(node) && scan.typed(node.expression) && !scan.typed(node)) dynamic(file, node, "cast to a non-character type");
  }
  function handOffs(file: TS.SourceFile, node: TS.Node) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node))
      for (const argument of node.arguments || []) if (!dependencyList(ts, node, argument)) handOff(file, argument, "passed as an untyped argument");
    if (ts.isJsxExpression(node) && node.expression && ts.isJsxAttribute(node.parent)) handOff(file, node.expression, "untyped prop");
  }
  function membership(file: TS.SourceFile, node: TS.Node) {
    if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.InKeyword || !scan.typed(node.right)) return;
    const name = literalName(ts, node.left);
    if (name) read(file, node, name);
    else dynamic(file, node, "computed in test");
  }
  return (file: TS.SourceFile) => ts.forEachChild(file, function visit(node) {
    access(file, node);
    binding(file, node);
    copies(file, node);
    casts(file, node);
    handOffs(file, node);
    membership(file, node);
    ts.forEachChild(node, visit);
  });
}

export function scanReaders(input: Options): Result {
  const ts = createRequire(input.project)("typescript") as typeof TS;
  const config = ts.getParsedCommandLineOfConfigFile(input.project, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  if (!config) throw Error("Unreadable project " + input.project);
  const program = ts.createProgram({ rootNames: config.fileNames, options: config.options });
  const checker = program.getTypeChecker();
  const scan = scanner(ts, checker, input.types);
  scan.remember(program);
  const result: Result = { reads: {}, dynamic: [] };
  const inspect = inspector(ts, checker, scan, result, path.dirname(input.project));
  for (const file of program.getSourceFiles())
    if (path.resolve(file.fileName).startsWith(input.include) && !file.fileName.includes("node_modules")) inspect(file);
  result.reads = Object.fromEntries(Object.entries(result.reads).sort(([a], [b]) => a.localeCompare(b)));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("scan-readers.mts")) {
  const input = options(process.argv.slice(2));
  const result = scanReaders(input);
  const text = JSON.stringify(result, null, 1);
  if (input.out) writeFileSync(input.out, text);
  else process.stdout.write(text + "\n");
}
