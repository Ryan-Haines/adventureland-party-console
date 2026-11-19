// addon:check rule 8, the hook coverage check: every decision an owner's rule files export has a
// hook an add-on answers or a core-only reason. It reads each rows file's RULE_FILES, DECISIONS and
// PLAIN, and lists the rule files' exported functions with the TypeScript parser; it reads syntax
// and guesses nothing. A decision written inline in a coordinator stays a review item, since no rule
// file exports it.
import type * as TS from 'typescript';
import { CORE_REASONS, PLAIN_KINDS, type DecisionRow } from '../rows/row.ts';
import { parse, ts } from './uses.mts';

export interface CoverageRows { HOOKS: object; RULE_FILES?: readonly string[]; DECISIONS?: Readonly<Record<string, DecisionRow>>; PLAIN?: Readonly<Record<string, string>> }
type HookRows = Readonly<Record<string, { kind: string; core?: true }>>;

// The exported functions of one file: function declarations and consts whose value is a function.
// A const of any other value is a bound a decision reads, so the check skips it.
export function exportedFunctions(file: string, text: string): string[] {
  const names: string[] = [];
  const exported = (s: TS.Statement) => ts.canHaveModifiers(s) && !!ts.getModifiers(s)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const s of parse(file, text).statements) {
    if (ts.isFunctionDeclaration(s) && exported(s) && s.name) names.push(s.name.text);
    else if (ts.isVariableStatement(s) && exported(s)) for (const d of s.declarationList.declarations) {
      let value = d.initializer;
      while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value))) value = value.expression;
      if (value && ts.isIdentifier(d.name) && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) names.push(d.name.text);
    }
  }
  return names;
}

// A citation `path:line` names a file of the tree.
const CITED = /^((?:runtime|scripts|e2e|characters|dashboard|tools)\/[\w./-]+\.\w+):\d/;

export function coverageFindings(files: Readonly<Record<string, CoverageRows>>, hooks: HookRows, sources: ReadonlyMap<string, string>): string[] {
  const findings: string[] = [], named = new Set<string>();
  for (const [rowsFile, rows] of Object.entries(files)) {
    const at = `runtime/hooks/${rowsFile}`;
    if (!rows.RULE_FILES || !rows.DECISIONS || !rows.PLAIN) { findings.push(`${at} exports no RULE_FILES, DECISIONS and PLAIN`); continue; }
    const exports = new Map<string, string[]>();
    for (const file of rows.RULE_FILES) {
      const text = sources.get(file);
      if (text === undefined) findings.push(`${at} names the rule file ${file}, which is not in the tree`);
      else exports.set(file, exportedFunctions(file, text));
    }
    const decided = new Set<string>();
    for (const [name, row] of Object.entries(rows.DECISIONS)) {
      const where = `${at} decision "${name}"`;
      if ('at' in row) {
        const [file, fn] = row.at.split('#') as [string, string];
        if (!exports.has(file)) findings.push(`${where}: ${row.at} names a file outside RULE_FILES`);
        else if (!exports.get(file)!.includes(fn)) findings.push(`${where}: ${file} exports no function ${fn}`);
        decided.add(row.at);
      } else if (!CITED.test(row.site) || !sources.has(CITED.exec(row.site)![1]!)) findings.push(`${where}: its site ${row.site} names no file of the tree`);
      if ('hook' in row) {
        const hook = hooks[row.hook];
        if (!hook) findings.push(`${where}: names the hook ${row.hook}, which the hook table does not declare`);
        else if (hook.kind !== 'request') findings.push(`${where}: names ${row.hook}, a notice, which decides nothing`);
        else if (hook.core) findings.push(`${where}: names ${row.hook}, which only core answers`);
        named.add(row.hook);
      } else {
        if (!(CORE_REASONS as readonly string[]).includes(row.core)) findings.push(`${where}: core reason "${row.core}" is not one of ${CORE_REASONS.join(', ')}`);
        if (!row.cite?.trim()) findings.push(`${where}: its core reason cites nothing`);
        else if (/:\d/.test(row.cite) && !(CITED.test(row.cite) && sources.has(CITED.exec(row.cite)![1]!))) findings.push(`${where}: its cite ${row.cite} names no file of the tree`);
      }
    }
    const all = [...exports].flatMap(([file, fns]) => fns.map(fn => ({ file, fn })));
    for (const [fn, kind] of Object.entries(rows.PLAIN)) {
      if (!(PLAIN_KINDS as readonly string[]).includes(kind)) findings.push(`${at} PLAIN ${fn}: kind "${kind}" is not one of ${PLAIN_KINDS.join(', ')}`);
      if (!all.some(e => e.fn === fn)) findings.push(`${at} PLAIN ${fn}: no rule file of ${rowsFile} exports it`);
    }
    for (const { file, fn } of all) if (!decided.has(`${file}#${fn}`) && !Object.hasOwn(rows.PLAIN, fn))
      findings.push(`${file} exports ${fn}, a decision with no hook and no core-only reason`);
  }
  for (const [hook, row] of Object.entries(hooks))
    if (row.kind === 'request' && !row.core && !named.has(hook))
      findings.push(`the hook ${hook} is named by no decision of its owner's DECISIONS`);
  return findings;
}
