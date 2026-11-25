// npm run addon:check [-- --with <file>] [-- --root <dir>]: loads every registration the way the
// console does and prints each finding in plain words, then exits 1 on one, so an agent cannot call
// an add-on done over it. It checks:
// 1. the registry's refusals;
// 2. the import rule and 3. the global rule for every file in each add-on folder and each `.tsx`
//    file's `@jsxImportSource` pragma (rules/uses.mts, which owner:check runs too);
// 4. the `ask` rule (rules/uses.mts `askFindings`), which only addon:check runs;
// 5. the naming rule: core code names no add-on (build/naming.mts), and the entry rule: no command
//    entry in cli/ imports .build/ before it writes the installed list (rules/uses.mts `entryFindings`,
//    which owner:check runs too);
// 6. the contract: each owner's rows carry a fixture row that its file
//    holds and that parses, and on a request `addonMayAsk`;
// 7. that runtime/addons/HOOKS.md matches the code (run/hook-list.mts);
// 8. the hook coverage: every exported decision of an owner's rule files has a hook or a core-only
//    reason, and every hook an add-on answers is named by a decision (rules/coverage.mts);
// 9. the slot coverage: every dashboard area carries a data-area that 12's AREAS row gives a slot or
//    a core-only reason, a slotted area draws its slot, and every slot is drawn (rules/areas.mts);
// 10. the action table: every game event and function in exactly one owner's ACTIONS row (rules/actions.mts);
// 11. the read table: every door export readable, a write or closed, and table F in StatusReport (rules/reads.mts);
// 12. the views: each hook's side, AddonContext on each answer, and addon-api.ts exporting each type a
//     signature names (rules/views.mts);
// 13. the pieces: AddonPieceBase on every piece, a row type per list-view part, and a manager case per
//     setting kind (rules/pieces.mts).
// The contract, the list and the coverage describe this checkout's own rows, so `--root <dir>` runs
// rules 1 to 5 on that checkout's add-on folders and skips 6 to 13. Rules 10 to 13 run while
// CAPABILITY_RULES is on, or with `--capability-rules`. addon:check admits no stand-in, so no add-on
// use waits on one.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadRegistry, rootOf } from './load.mts';
import { HOOK_LIST, hookList } from './hook-list.mts';
import { escapeRe, namingFindings } from '../../build/naming.mts';
import { addonFindings, askFindings, entryFindings, ts } from '../../rules/uses.mts';
import { coverageFindings } from '../../rules/coverage.mts';
import { areaFindings } from '../../rules/areas.mts';
import { HOOKS, ROW_FILES, SLOTS } from '../../registry.ts';
import * as status from '../../rows/12-status.ts';
import { actionFindings } from '../../rules/actions.mts';
import { readFindings } from '../../rules/reads.mts';
import { viewFindings } from '../../rules/views.mts';
import { pieceFindings } from '../../rules/pieces.mts';
import { ADDON_KINDS } from '../../../settings/api.ts';
import { characterFields } from '../../../status/rules.ts';
import { moduleOf, readTree, scanTree } from '../../../../tools/owner-check.mjs';

// Rules 10 to 13 run on every check since the merged capability lanes pass them (addon-capabilities.md
// "Build lanes").
export const CAPABILITY_RULES = true;
// The client-to-server events typed-adventureland ships, one ClientToServer_<event>.d.ts each.
export const TYPED_EVENTS = 'node_modules/typed-adventureland/dist/src/socket-events/client-to-server/events';
export function typedEvents(root: string): string[] {
  const dir = path.join(root, TYPED_EVENTS);
  return existsSync(dir) ? readdirSync(dir).flatMap(f => /^ClientToServer_(.+)\.d\.ts$/.exec(f)?.[1] ?? []) : [];
}
// Rules 10 to 13 over this checkout's rows.
export function capabilityFindings(root: string, sources: ReadonlyMap<string, string>): string[] {
  return [...actionFindings(ROW_FILES, typedEvents(root), scanTree(sources), sources, moduleOf),
    ...readFindings(ROW_FILES, Object.keys(characterFields), sources, moduleOf),
    ...viewFindings(HOOKS, sources), ...pieceFindings(ADDON_KINDS, sources)];
}

type Row = { kind?: string; fixture?: string; addonMayAsk?: boolean };
// A title as a test source writes it inside quotes: an escaped quote reads as the quote.
const unescaped = (text: string) => text.replace(/\\(['"`])/g, '$1');
// A table test builds a row's title at run time from a template and the file's own strings
// (targeting-selection.test.cjs: `${FILE}#${hook}: answers as ${name} did` over its READS table).
// Such a title is in the file when one template spells the whole fixture or the bare title with
// each `${...}` standing for a string literal the file holds.
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g, TEMPLATE = /`((?:[^`\\]|\\.)*)`/g;
function builtTitle(text: string, fixture: string, title: string): boolean {
  const literals = new Set([...text.matchAll(LITERAL)].map(m => unescaped(m[1] ?? m[2] ?? '')));
  for (const [, body] of text.matchAll(TEMPLATE)) {
    const parts = unescaped(body!).split(/\$\{[^}]*\}/);
    if (parts.length < 2) continue;
    const pattern = new RegExp(`^${parts.map(escapeRe).join('(.+?)')}$`);
    for (const wanted of [`${fixture}#${title}`, title]) {
      const match = pattern.exec(wanted);
      if (match && match.slice(1).every(piece => literals.has(piece))) return true;
    }
  }
  return false;
}

// A fixture file's top-level relative require or import, which runs at load and must name a file
// of the tree; a require inside a row body can be code the game page runs. A `.js`
// import in a TypeScript file names its `.ts` source, and `.build/` is the e2e build's output,
// which the tree never holds.
const SPECIFIER = /^(?:const|let|var|import)\b[^\n]*?(?:\brequire\(\s*['"](\.[^'"]+)['"]\s*\)|\bfrom\s+['"](\.[^'"]+)['"])/gm;
const RESOLVED = ['', '.ts', '.cjs', '.js', '.mjs', '.mts', '.tsx', '.json', '/index.ts', '/index.js'];
function missingModule(file: string, text: string, sources: ReadonlyMap<string, string>): string | undefined {
  for (const [, required, imported] of text.matchAll(SPECIFIER)) {
    const spec = (required ?? imported)!, base = path.posix.join(path.posix.dirname(file), spec);
    if (base.startsWith('.build/')) continue;
    const source = /\.tsx?$/.test(file) ? base.replace(/\.js$/, '') : base;
    if (!RESOLVED.some(ending => sources.has(source + ending) || sources.has(base + ending))) return spec;
  }
  return undefined;
}

// 0.4's mechanical checks over every owner's row file: a row with no `since`, a `since` not of the
// form, no `fixture`, a fixture file that does not parse or requires a module the tree lacks, or a
// fixture title its file lacks fails, and so does a request row with no `addonMayAsk`. A file that
// does not parse or load runs none of its rows, so its titles prove nothing.
export function contractFindings(files: Readonly<Record<string, { HOOKS: object; SLOTS: object }>>, sources: ReadonlyMap<string, string>): string[] {
  const findings: string[] = [], parsed = new Map<string, string | undefined>();
  const syntax = (file: string, text: string) => {
    if (!parsed.has(file)) {
      const error = ts.transpileModule(text, { fileName: file, reportDiagnostics: true }).diagnostics?.[0];
      parsed.set(file, error && ts.flattenDiagnosticMessageText(error.messageText, ' '));
    }
    return parsed.get(file);
  };
  for (const [file, rows] of Object.entries(files)) {
    for (const [kind, table] of [['hook', rows.HOOKS], ['slot', rows.SLOTS]] as const) {
      for (const [name, row] of Object.entries(table) as [string, Row][]) {
        const at = `runtime/hooks/${file} ${kind} ${name}`;
        if (kind === 'hook' && row.kind === 'request' && row.addonMayAsk === undefined) findings.push(`${at}: states no addonMayAsk`);
        if (!row.fixture) { findings.push(`${at}: names no fixture row`); continue; }
        const hash = row.fixture.indexOf('#'), fixture = row.fixture.slice(0, hash), title = row.fixture.slice(hash + 1);
        const text = hash > 0 ? sources.get(fixture) : undefined;
        if (text === undefined) findings.push(`${at}: its fixture file ${hash > 0 ? fixture : row.fixture} is not in the tree`);
        else if (syntax(fixture, text)) findings.push(`${at}: its fixture file ${fixture} does not parse (${syntax(fixture, text)}), so none of its rows runs`);
        else if (missingModule(fixture, text, sources))
          findings.push(`${at}: its fixture file ${fixture} requires ${missingModule(fixture, text, sources)}, which is not in the tree, so none of its rows runs`);
        else if (!title || !(unescaped(text).includes(title) || builtTitle(text, fixture, title))) findings.push(`${at}: ${fixture} has no row "${title}"`);
      }
    }
  }
  return findings;
}

// The committed list against the one the code writes now.
export function listFindings(root: string, files: Readonly<Record<string, { HOOKS: object; SLOTS: object }>>): string[] {
  const at = path.join(root, HOOK_LIST), list = existsSync(at) ? readFileSync(at, 'utf8').replace(/\r\n/g, '\n') : '';
  return list === hookList(root, files) ? [] : [`${HOOK_LIST} differs from the code; run node runtime/hooks/cli/hook-list.mts`];
}

// The command itself; cli/check.mts runs it after it writes the installed list.
export async function main(args: string[]): Promise<void> {
  const root = rootOf(args), own = root === rootOf([]);
  const registry = await loadRegistry(args);
  const refusals = registry.refusals(), loaded = registry.registrations(), addons = loaded.filter(r => r.folder === 'addons');
  for (const refusal of refusals) console.log(`Refused ${refusal.name}: ${refusal.message}.`);
  const sources = readTree(root) as Map<string, string>;
  const findings = [...addonFindings(sources, new Map()), ...askFindings(sources, HOOKS), ...entryFindings(sources),
    ...namingFindings(sources, addons.map(r => ({ name: r.name, ids: (r.slots ?? []).flatMap(s => s.status ? [s.status.field] : []) }))),
    ...own ? [...contractFindings(ROW_FILES, sources), ...listFindings(root, ROW_FILES),
      ...coverageFindings(ROW_FILES, HOOKS, sources), ...areaFindings(status, SLOTS, sources),
      ...CAPABILITY_RULES || args.includes('--capability-rules') ? capabilityFindings(root, sources) : []] : []];
  for (const finding of findings) console.log(finding);
  if (!refusals.length && !findings.length) console.log(`No conflicts: ${loaded.length} registrations, ${addons.length} add-ons.`);
  process.exitCode = refusals.length || findings.length ? 1 : 0;
}
