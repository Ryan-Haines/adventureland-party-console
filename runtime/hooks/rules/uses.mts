// The add-on rules. An add-on's play and dashboard code reach the core only through the two
// published modules, plus the JSX runtime module for a section, its own folder and packages other
// than React. It reads no game global. A use waiting on an owner's gap passes only when a stand-in
// row lists its key: the file and the imported binding (`zones.ts#inBlock`, `#default`, `#*`) or
// the global's path (`index.ts#globalThis.character`, `#parent.entities`). Its tests/ folder may
// import the harness and the core, since no bundle imports a test. owner:check
// (tools/owner-check.mjs) and `addon:check` (cli/check.mts) run these rules, and only addon:check
// runs `askFindings`; this file is their one copy.
import { createRequire } from 'node:module';
import path from 'node:path';
import type * as TS from 'typescript';
import { SCANNED, importRe } from '../../../tools/owner-check.mjs';
import { escapeRe } from '../build/naming.mts';

export const ts = createRequire(import.meta.url)('typescript') as typeof TS;
type Sources = ReadonlyMap<string, string>;
type StandIns = ReadonlyMap<string, string>;
export const ADDON_API = 'runtime/hooks/addon-api.ts';
// The add-on system's publishing files register each owner's answers (core.ts) and re-export its
// reads (api/<NN>-<area>.ts, one per owner; 00-overview "Core features use the same registry";
// 0.2, 0.4), and each side's READS answers (character-reads.ts, coordinator-reads.ts). Their imports
// of an owner's code are that publication, which owner:check's cross-owner import rule passes.
export const publishes = (file: string): boolean => file === 'runtime/hooks/core.ts' || /^runtime\/hooks\/api\/\d\d-[a-z-]+\.ts$/.test(file) ||
  /^runtime\/hooks\/(character|coordinator)-reads\.ts$/.test(file);
export const ADDON_SURFACE = new Set([ADDON_API, 'dashboard/features/party/addon-kit.ts']);
export const ADDON_JSX = /^dashboard\/features\/party\/addon-jsx\//;
export const ADDON_SOURCE = /^runtime\/addons\/([\w-]+)\/(?!tests\/).+\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const GLOBALS = new Set(['globalThis', 'parent', 'character', 'G', 'smart']);
// The stand-in row whose cell lists `key` as a whole key, so `index.ts#globalThis.parent` does
// not list `index.ts#globalThis.parent.entities`.
export function listingOf(standIns: StandIns, key: string): string | undefined {
  const re = new RegExp(`${escapeRe(key)}(?![\\w$.#/-])`);
  return [...standIns].find(([, cell]) => re.test(cell))?.[0];
}
export const resolveIn = (sources: Sources, file: string, spec: string): string => {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)), stem = base.replace(/\.(m|c)?js$/, '');
  return [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.js`, `${stem}/index.ts`].find((f) => sources.has(f)) || base;
};
export const parse = (file: string, text: string) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
// The declarations whose `name` is the identifier itself, so the identifier names, not reads.
const NAMED = ['isPropertyAssignment', 'isPropertySignature', 'isPropertyDeclaration', 'isMethodDeclaration', 'isMethodSignature', 'isVariableDeclaration',
  'isParameter', 'isFunctionDeclaration', 'isBindingElement', 'isImportSpecifier', 'isExportSpecifier', 'isImportClause', 'isNamespaceImport', 'isEnumMember',
  'isLabeledStatement', 'isPropertyAccessExpression', 'isQualifiedName'] as const;
const tests = ts as unknown as Record<(typeof NAMED)[number], (node: TS.Node) => boolean>;

// The names a binding pattern declares.
function bindings(pattern: TS.BindingName, out: Set<string>): Set<string> {
  if (ts.isIdentifier(pattern)) out.add(pattern.text);
  else for (const e of pattern.elements) if (!ts.isOmittedExpression(e)) bindings(e.name, out);
  return out;
}
// The names one scope declares: a function's parameters and own name, a catch clause's and a loop's
// bindings, and the declarations and imports of a file, block or switch case.
function declares(scope: TS.Node): Set<string> {
  const names = new Set<string>();
  if (ts.isFunctionLike(scope)) {
    for (const p of scope.parameters) bindings(p.name, names);
    if (scope.name && ts.isIdentifier(scope.name)) names.add(scope.name.text);
  }
  if (ts.isCatchClause(scope) && scope.variableDeclaration) bindings(scope.variableDeclaration.name, names);
  if ((ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) && scope.initializer && ts.isVariableDeclarationList(scope.initializer))
    for (const d of scope.initializer.declarations) bindings(d.name, names);
  const statements = ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope) || ts.isCaseClause(scope) || ts.isDefaultClause(scope) ? scope.statements : [];
  for (const s of statements) {
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) bindings(d.name, names);
    else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name) names.add(s.name.text);
    else if (ts.isImportDeclaration(s) && s.importClause) {
      const { name, namedBindings } = s.importClause;
      if (name) names.add(name.text);
      if (namedBindings && ts.isNamespaceImport(namedBindings)) names.add(namedBindings.name.text);
      else if (namedBindings) for (const e of namedBindings.elements) names.add(e.name.text);
    }
  }
  return names;
}
// True when a scope around `node` declares `name`, so the identifier reads that local and not the game global.
function local(node: TS.Node, name: string): boolean {
  for (let at = node.parent; at; at = at.parent) if (declares(at).has(name)) return true;
  return false;
}
// Every import binding and every game global read in one add-on file, each with its key.
export function addonUses(file: string, text: string, sources: Sources) {
  const tsx = file.endsWith('x'), source = parse(file, text);
  const folder = `runtime/addons/${file.split('/')[2]}/`, line = (node: TS.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const imports: { line: number; spec: string; key: string }[] = [], globals: { line: number; key: string }[] = [];
  const aliases = new Set<string>();
  const allowed = (spec: string) => {
    if (!spec.startsWith('.')) return !/^react(-dom)?(\/|$)/.test(spec);
    const target = resolveIn(sources, file, spec);
    return target.startsWith(folder) || ADDON_SURFACE.has(target) || tsx && ADDON_JSX.test(target);
  };
  const use = (node: TS.Node, spec: string, bindings: string[]) => {
    if (allowed(spec)) return;
    for (const binding of bindings) imports.push({ line: line(node), spec, key: `${file}#${binding}` });
  };
  // The expression a read sits in, past parentheses and type casts.
  const strip = (node: TS.Node): TS.Node => {
    while (node.parent && (ts.isParenthesizedExpression(node.parent) || ts.isAsExpression(node.parent) || ts.isNonNullExpression(node.parent) ||
      ts.isTypeAssertionExpression(node.parent) || ts.isSatisfiesExpression(node.parent))) node = node.parent;
    return node;
  };
  // A global's key names the global and its first property; the game window `parent` names one
  // property more, since its properties are the game's own objects.
  const chain = (node: TS.Node, root: string) => {
    const names: string[] = [];
    for (let at = strip(node); ts.isPropertyAccessExpression(at.parent) && at.parent.expression === at; at = strip(at.parent)) names.push(at.parent.name.text);
    return [root, ...names.slice(0, root === 'parent' ? 1 : names[0] === 'parent' ? 2 : 1)].join('.');
  };
  const visit = (node: TS.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
      if (spec) {
        const clause = ts.isImportDeclaration(node) ? node.importClause : undefined, bindings: string[] = [];
        if (clause?.name) bindings.push('default');
        const named = ts.isImportDeclaration(node) ? clause?.namedBindings : node.exportClause;
        if (named && (ts.isNamespaceImport(named) || ts.isNamespaceExport(named))) bindings.push('*');
        else if (named) for (const e of named.elements) bindings.push((e.propertyName || e.name).text);
        use(node, spec, bindings.length ? bindings : ['*']);
      }
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') &&
      node.arguments[0] && ts.isStringLiteral(node.arguments[0])) use(node, node.arguments[0].text, ['*']);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) use(node, node.argument.literal.text, ['*']);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const inType = (node: TS.Node) => { for (let at = node.parent; at; at = at.parent) if (ts.isTypeNode(at) && !ts.isExpressionWithTypeArguments(at)) return true; return false; };
  const reads = (node: TS.Node) => {
    if (ts.isIdentifier(node) && !inType(node)) {
      const p = node.parent as TS.Node & { name?: TS.Node; right?: TS.Node }, name = node.text;
      const isName = NAMED.some((is) => tests[is](p) && (p.name === node || p.right === node)) || ts.isBindingElement(p) && p.propertyName === node;
      if (!isName && (name === 'globalThis' || GLOBALS.has(name) && !local(node, name))) {
        // `const game = globalThis as ...` names the global, so `game.x` reads `globalThis.x`.
        const outer = strip(node);
        if (name === 'globalThis' && ts.isVariableDeclaration(outer.parent) && outer.parent.initializer === outer && ts.isIdentifier(outer.parent.name)) aliases.add(outer.parent.name.text);
        else globals.push({ line: line(node), key: `${file}#${chain(node, name)}` });
      } else if (!isName && aliases.has(name)) globals.push({ line: line(node), key: `${file}#${chain(node, 'globalThis')}` });
    }
    ts.forEachChild(node, reads);
  };
  reads(source);
  // A section's JSX compiles against the dashboard's React through its pragma (4.6), which must reach
  // dashboard/features/party/addon-jsx/ from the file itself, so a section in a subfolder works.
  const pragma = tsx ? (text.match(/@jsxImportSource\s+(\S+?)\s*(?:\*\/|$)/m) || [])[1] : null;
  const jsx = !tsx || pragma && path.posix.normalize(path.posix.join(path.posix.dirname(file), pragma)) === 'dashboard/features/party/addon-jsx' ? null
    : pragma ? `its @jsxImportSource ${pragma} does not reach dashboard/features/party/addon-jsx` : 'it has no @jsxImportSource pragma naming dashboard/features/party/addon-jsx';
  return { imports, globals, jsx };
}
export function addonFindings(sources: Sources, standIns: StandIns): string[] {
  const findings: string[] = [];
  for (const [file, text] of sources) {
    if (!ADDON_SOURCE.test(file)) continue;
    const { imports, globals, jsx } = addonUses(file, text, sources);
    if (jsx) findings.push(`${file}:1: ${jsx}, so its JSX would not compile against the dashboard's React`);
    for (const u of imports) if (!listingOf(standIns, u.key))
      findings.push(`${file}:${u.line}: an add-on imports ${u.key.split('#')[1]} from ${u.spec}; it imports only its own folder, ${ADDON_API}, dashboard/features/party/addon-kit.ts and packages, and no stand-in row lists ${u.key}`);
    for (const u of globals) if (!listingOf(standIns, u.key))
      findings.push(`${file}:${u.line}: an add-on reads the global ${u.key.split('#')[1]}; it reads the game only through its hooks' views, and no stand-in row lists ${u.key}`);
  }
  return findings;
}
// No bundle imports a test: a runtime or dashboard file that imports
// a file in a tests/ folder fails.
export function testImports(sources: Sources): string[] {
  const findings: string[] = [];
  for (const [file, text] of sources) {
    if (!SCANNED(file) || !/^(runtime|dashboard)\//.test(file)) continue;
    text.split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
      for (const m of l.matchAll(importRe)) {
        const spec = m[1] || m[2] || m[3], target = spec.startsWith('.') && resolveIn(sources, file, spec);
        if (target && /(^|\/)tests?\//.test(target)) findings.push(`${file}:${i + 1}: imports the test file ${target}; no bundle holds a test`);
      }
    });
  }
  return findings;
}
// An add-on's game call or loop row (owner-check `scanTree`), judged per use (3.4): a stand-in row
// lists its file and call, so a second call in an admitted file still fails. A tree from before the
// add-on API is admitted by file, as the budget rule judges older trees: owner-check.test.mjs's
// planted trees hold runtime/addons/tank-hold/ and no addon-api.ts.
export function addonRowFindings(row: { file: string; call: string }, sources: Sources, standIns: StandIns, say: string): { listing?: string; finding?: string } {
  const listing = sources.has(ADDON_API) ? listingOf(standIns, `${row.file}#${row.call}`) : [...standIns].find(([, cell]) => cell.includes(row.file))?.[0];
  return listing ? { listing } : { finding: `${say}: an add-on acts only through hooks, and no stand-in row lists this one` };
}

// The add-on commands write the installed list before they load anything that imports it
//. Each entry runtime/hooks/cli/*.mts
// fails when its static import closure imports a file under .build/: a fresh checkout has none, and
// a static import runs before the entry's own `writeInstalled`. A dynamic `import()` and an
// `import type` load nothing at that point, so the walk skips both.
export const ENTRY = /^runtime\/hooks\/cli\/[^/]+\.mts$/;
export function entryFindings(sources: Sources): string[] {
  const findings: string[] = [], imports = new Map<string, string[]>();
  const staticImports = (file: string): string[] => {
    if (!imports.has(file)) {
      const text = sources.get(file), out: string[] = [];
      if (text !== undefined) for (const s of parse(file, text).statements) {
        const spec = (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier) ? s.moduleSpecifier.text : '';
        const typeOnly = ts.isImportDeclaration(s) ? !!s.importClause?.isTypeOnly : ts.isExportDeclaration(s) && s.isTypeOnly;
        if (spec.startsWith('.') && !typeOnly) out.push(resolveIn(sources, file, spec));
      }
      imports.set(file, out);
    }
    return imports.get(file)!;
  };
  for (const entry of [...sources.keys()].filter(f => ENTRY.test(f)).sort()) {
    const via = new Map<string, string>([[entry, '']]), queue = [entry];
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      for (const target of staticImports(file)) {
        if (via.has(target)) continue;
        via.set(target, file);
        if (!target.startsWith('.build/')) { queue.push(target); continue; }
        const chain = [target];
        for (let at = file; at; at = via.get(at)!) chain.push(at);
        findings.push(`${entry}: imports ${target} before it writes the installed list (${chain.reverse().join(' -> ')}); load the body with import() after writeInstalled`);
        queue.length = 0;
        break;
      }
    }
  }
  return findings;
}

// `ask`: an add-on asks a published read through addon-api.ts's `ask`, naming the
// row as a string literal; the row must carry `addonMayAsk: true`.
export function askFindings(sources: Sources, hooks: object): string[] {
  const rows = hooks as Readonly<Record<string, { addonMayAsk?: boolean }>>;
  const findings: string[] = [];
  for (const [file, text] of sources) {
    if (!ADDON_SOURCE.test(file)) continue;
    const source = parse(file, text), names = new Set<string>(), spaces = new Set<string>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
        resolveIn(sources, file, statement.moduleSpecifier.text) !== ADDON_API) continue;
      const named = statement.importClause?.namedBindings;
      if (named && ts.isNamespaceImport(named)) spaces.add(named.name.text);
      else if (named) for (const e of named.elements) if ((e.propertyName || e.name).text === 'ask') names.add(e.name.text);
    }
    const visit = (node: TS.Node) => {
      if (ts.isCallExpression(node) && (ts.isIdentifier(node.expression) && names.has(node.expression.text) ||
        ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'ask' && ts.isIdentifier(node.expression.expression) && spaces.has(node.expression.expression.text))) {
        const at = `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`, first = node.arguments[0];
        if (!first || !ts.isStringLiteralLike(first)) findings.push(`${at}: ask names its row with a value, not a string literal, so the check cannot read which row it asks`);
        else if (rows[first.text]?.addonMayAsk !== true) findings.push(`${at}: ask names ${first.text}, which ${first.text in rows ? 'is not marked addonMayAsk: it writes or acts' : 'the hook table does not declare'}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings;
}

// The add-on system is one module, runtime/hooks/ (0.2). These are the pieces outside it, each a
// line that imports from the module or a file the build needs where the module cannot be, with the
// reason 0.2's table proves. A path ending in `/` names a folder.
export const OUTSIDE: readonly { path: string; why: string }[] = [
  { path: 'tools/build-runtime.mts', why: 'a build path: discovery runs inside each (3.2)' },
  { path: 'tools/game/build.mts', why: 'a build path: discovery runs inside each (3.2)' },
  { path: 'tools/dashboard/build.mts', why: 'a build path: discovery runs inside each (3.2)' },
  { path: 'tools/console-build/builder.ts', why: 'a build path: discovery runs inside each (3.2)' },
  { path: 'package.json', why: 'npm scripts live in package.json' },
  { path: 'dashboard/features/party/addon-kit.ts', why: "Vite resolves the dashboard's `@/` alias and `react` only for files under dashboard/" },
  { path: 'dashboard/features/party/addon-jsx/', why: "the JSX pragma's import source resolves `react` from dashboard/node_modules" },
  { path: 'dashboard/app/globals.css', why: 'Tailwind reads `@source` only from the stylesheet' },
  { path: 'dashboard/features/party/connected-character-card.tsx', why: "the card is 12's; it places the module's parts" },
  { path: 'dashboard/features/party/party-inventory-panels.tsx', why: "the panels are 12's; they place the module's parts" },
  { path: 'runtime/lifecycle/coordinator/routes.ts', why: "the coordinator's router is 13's" },
  { path: 'runtime/coordinator/application.ts', why: "the coordinator's composition is 01's" },
  { path: 'tools/owner-check.mjs', why: "owner:check is the build's one checker of every owner" },
  { path: 'AGENTS.md', why: "AGENTS.md is the console's file" },
  { path: '.build/addons/', why: 'build output never sits in source (3.2)' },
  { path: 'scripts/tests/helpers/addon-folders.cjs', why: 'the test harness lives with the tests (0.3, ADD-007)' },
  { path: 'e2e/fixtures/addon-candidate.ts', why: 'the test harness lives with the tests (0.3, ADD-007)' },
];
const outside = (file: string) => OUTSIDE.some(o => o.path.endsWith('/') ? file.startsWith(o.path) : file === o.path);
// A catalog/14 function in a file outside runtime/hooks/ that the table does not list. A
// behaviour that names an add-on (`addon`) claims that add-on's folder, which the module never holds.
export function moduleFindings(behaviours: readonly { id: string; addon?: string; functions?: readonly string[] }[], sources: Sources): string[] {
  const findings = new Set<string>();
  for (const b of behaviours) for (const id of b.functions ?? []) {
    const file = id.slice(0, id.indexOf('#'));
    if (file.startsWith('runtime/hooks/') || outside(file) || b.addon && file.startsWith(`runtime/addons/${b.addon}/`) || !sources.has(file)) continue;
    findings.add(`${file}: catalog/14 ${b.id} claims ${id.slice(id.indexOf('#') + 1)} there, outside runtime/hooks/ and outside the add-on system's table of outside pieces (AS34)`);
  }
  return [...findings];
}
