// Core code names no add-on. The
// check reads the code files git tracks, and the untracked ones it does not ignore (owner-check.mjs
// `readTree`), outside each installed folder with the TypeScript scanner. It flags two things:
// - an import, export or require specifier that resolves into runtime/addons/<name>/;
// - a string literal equal to the add-on's name, `addon:<name>`, a ring id `<name>.<key>`, or the
//   store field its slot entry's status line declares. A mode id can be a game word, such as
//   achievement-hunt's `achievements` beside the monster card's keys (item-card-lines.ts), so it passes.
// Comments, Markdown, identifiers and every other string pass. A test file may name an add-on as its
// own fixture, so only its imports count. A tracked file whose first line is build-runtime.mts's banner
// is that build's output (the published bundles in characters/), so the check skips it.
import path from 'node:path';
import type * as TS from 'typescript';
import { parse, ts } from '../rules/uses.mts';

export const BUILD_BANNER = '// Generated from TypeScript; run npm run build:runtime -- --publish. Do not edit.';
const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;
// The unit, E2E and add-on test files, with their helpers and fixtures.
export const TEST_FILE = /(^|\/)(tests?|e2e)\/|\.(test|spec)\.\w+$/;
// Text as a regular expression that matches it literally; the add-on system's one copy.
export const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface NamedAddon { name: string; ids?: readonly string[] }

// The module specifier a node carries: an import or export declaration, `require('x')`, `import('x')`
// and `import('x')` in a type.
function specifierOf(node: TS.Node): TS.StringLiteralLike | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) return node.moduleSpecifier;
  if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') &&
    node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) return node.arguments[0];
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) return node.argument.literal;
  return undefined;
}

export function namingFindings(sources: ReadonlyMap<string, string>, addons: readonly NamedAddon[]): string[] {
  const findings: string[] = [];
  for (const [file, text] of sources) {
    if (!CODE.test(file) || text.includes('\0') || text.startsWith(BUILD_BANNER)) continue;
    // An add-on names itself freely inside its own folder.
    const others = addons.filter(a => !file.startsWith(`runtime/addons/${a.name}/`));
    if (!others.length) continue;
    const source = parse(file, text), test = TEST_FILE.test(file), specifiers = new Set<TS.Node>();
    const say = (node: TS.Node, name: string, what: string) => findings.push(
      `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: names the add-on ${name} (${what}); core code reaches an add-on only through its hooks`);
    const visit = (node: TS.Node) => {
      const spec = specifierOf(node);
      if (spec) {
        specifiers.add(spec);
        const to = spec.text.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec.text)) : '';
        for (const { name } of others) if (to === `runtime/addons/${name}` || to.startsWith(`runtime/addons/${name}/`)) say(node, name, `imports ${spec.text}`);
      } else if (!test && ts.isStringLiteralLike(node) && !specifiers.has(node)) {
        for (const { name, ids = [] } of others)
          if (node.text === name || node.text === `addon:${name}` || node.text.startsWith(`${name}.`) || ids.includes(node.text)) say(node, name, `"${node.text}"`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings;
}
