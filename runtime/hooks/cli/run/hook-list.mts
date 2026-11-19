// The published hook list: runtime/addons/HOOKS.md, beside the add-on guide, written from the code
// so it cannot drift. `node runtime/hooks/cli/hook-list.mts` writes it; `addon:check` builds it in
// memory and fails when the committed file differs. It reads each source through TypeScript's
// parser with its line endings made `\n`, so the list is the same on a CRLF checkout, an export
// reads whole, and a refusal reads as the code builds it.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../build/installed.mts';
import type * as TS from 'typescript';
import { HOOKS, SLOTS, ROW_FILES, SLOT_COLORS } from '../../registry.ts';
import { coreRegistrations } from '../../core.ts';
import { parse, ts } from '../../rules/uses.mts';
import { ADDON_SPEND_CAP, ADDON_TIERS, SPEND_RANKS, TIERS } from '../../../protocol/ranks.ts';
import { ADDON_KINDS, SETTING_SCOPES } from '../../../settings/api.ts';

export const HOOK_LIST = 'runtime/addons/HOOKS.md';
const KIT = 'dashboard/features/party/addon-kit.ts';
const cell = (text: unknown) => String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

// The comment lines right above a statement, with no blank line between them and it.
function commentOf(text: string, node: TS.Node): string {
  const kept: string[] = [];
  let end = node.getStart();
  for (const range of [...(ts.getLeadingCommentRanges(text, node.pos) ?? [])].reverse()) {
    if ((text.slice(range.end, end).match(/\n/g) ?? []).length > 1) break;
    kept.unshift(text.slice(range.pos, range.end).replace(/^\/\/ ?|^\/\*\*?\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, ''));
    end = range.pos;
  }
  return oneLine(kept.join(' '));
}
const exported = (s: TS.Statement) => ts.isExportDeclaration(s) || ts.canHaveModifiers(s) && !!ts.getModifiers(s)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
// Each export statement of a source with its comment: a re-export or a type whole, a function or an
// interface up to its body. `export * from` lines are addon-api.ts's composition of the api/ files.
function exportsOf(file: string, text: string): { comment: string; line: string }[] {
  const source = parse(file, text);
  return source.statements.filter(s => exported(s) && !(ts.isExportDeclaration(s) && !s.exportClause)).map(s => {
    const start = s.getStart(source), whole = s.getText(source);
    const body = ts.isFunctionDeclaration(s) && s.body ? s.body.getStart(source) : ts.isInterfaceDeclaration(s) || ts.isClassDeclaration(s) ? s.members.pos - 1 : undefined;
    return { comment: commentOf(text, s), line: oneLine(body === undefined ? whole : whole.slice(0, body - start)) };
  });
}
// The name a refusal's `${...}` reads, in plain words: `r.name` is the add-on, `SLOT_WORDS[mode.slot]`
// the slot, `JSON.stringify(mode.button.color)` the colour, `SLOT_COLORS.join(', ')` the list.
function placeholder(node: TS.Expression): string {
  if (ts.isParenthesizedExpression(node)) return placeholder(node.expression);
  if (ts.isBinaryExpression(node)) return placeholder(node.left);
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'join') return placeholder(callee.expression);
    return node.arguments[0] ? placeholder(node.arguments[0]) : placeholder(callee);
  }
  if (ts.isElementAccessExpression(node)) return /^\d+$/.test(node.argumentExpression.getText()) ? placeholder(node.expression) : placeholder(node.argumentExpression);
  if (ts.isPropertyAccessExpression(node)) return node.name.text !== 'name' ? node.name.text : node.expression.getText() === 'r' ? 'add-on' : placeholder(node.expression);
  return node.getText() === 'r' ? 'add-on' : node.getText();
}
// A message as the code builds it: string and template parts joined, each `${...}` as `<name>`.
function messageOf(node: TS.Expression): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return messageOf(node.expression);
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(s => `<${placeholder(s.expression)}>${s.literal.text}`).join('');
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = messageOf(node.left), right = messageOf(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}
// The plain-words refusals the named function returns or throws.
function messagesOf(file: string, text: string, name: string): string[] {
  const out: string[] = [];
  const visit = (node: TS.Node, inside: boolean) => {
    const here = inside || ts.isFunctionDeclaration(node) && node.name?.text === name;
    const message = !here ? undefined : ts.isReturnStatement(node) && node.expression ? messageOf(node.expression)
      : ts.isThrowStatement(node) && ts.isCallExpression(node.expression) && node.expression.arguments[0] ? messageOf(node.expression.arguments[0]) : undefined;
    if (message) out.push(message);
    ts.forEachChild(node, child => visit(child, here));
  };
  visit(parse(file, text), false);
  return out;
}

export function hookList(root: string, files: Readonly<Record<string, { HOOKS: object; SLOTS: object }>> = ROW_FILES): string {
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
  const owner = (file: string) => file.slice('rows/'.length, 'rows/'.length + 2);
  const out = ['# The published hook list', '',
    'Generated by `node runtime/hooks/cli/hook-list.mts` from the code. Do not edit; `npm run addon:check`',
    'fails while this file differs from the code. The add-on guide is [README.md](README.md) here.',
    ''];
  for (const [file, rows] of Object.entries(files)) {
    const hooks = Object.entries(rows.HOOKS) as [string, Record<string, unknown>][], slots = Object.entries(rows.SLOTS) as [string, Record<string, unknown>][];
    out.push(`## Owner ${owner(file)} (runtime/hooks/${file})`, '');
    if (!hooks.length && !slots.length) { out.push('No rows yet: the owner adds them in its own build.', ''); continue; }
    const requests = hooks.filter(([, h]) => h.kind === 'request'), notices = hooks.filter(([, h]) => h.kind === 'notice');
    if (requests.length) {
      out.push('### Requests', '', '| Hook | Who answers | Add-on may ask | Bound | Receives | Returns | Fixture |', '|---|---|---|---|---|---|');
      for (const [name, h] of requests) out.push(`| \`${name}\` | ${h.core ? 'core only' : cell(h.answers)}${h.pending ? `, waits for ${cell(h.pending)}` : ''} | ` +
        `${h.addonMayAsk === undefined ? '' : h.addonMayAsk ? 'yes' : 'no'} | ${cell(h.bound)} | ${cell(h.receives)} | ${cell(h.returns)} | ${cell(h.fixture)} |`);
      out.push('');
    }
    if (notices.length) {
      out.push('### Events (read-only)', '', '| Event | Payload | Fixture |', '|---|---|---|');
      for (const [name, h] of notices) out.push(`| \`${name}\` | ${cell(h.receives)} | ${cell(h.fixture)} |`);
      out.push('');
    }
    if (slots.length) {
      out.push('### Dashboard slots', '', '| Slot | Data | Takes a section | Bound | Fixture |', '|---|---|---|---|---|');
      for (const [name, s] of slots) out.push(`| \`${name}\` | ${cell(s.data)} | ${s.section ? 'yes' : 'no'} | ${cell(s.bound)} | ${cell(s.fixture)} |`);
      out.push('');
    }
  }
  // C1 and C3: every owner's ACTIONS and READS rows. An action runs on the side that publishes its
  // door: the character publishes hooks/character-doors.ts's doors, and the coordinator the rest.
  type Action = { events: readonly string[]; functions: readonly string[]; door?: string; args?: string; bound?: string; closed?: string; cite?: string };
  type Read = { side: string; type: string; door: string };
  const tables = Object.entries(ROW_FILES as Readonly<Record<string, { ACTIONS?: Record<string, Action>; READS?: Record<string, Read> }>>);
  const characterDoors = new Set([...read('runtime/hooks/character-doors.ts').matchAll(/(\w+): (?:\w+\.\w+|gameEvent\()/g)].map(m => m[1]));
  out.push('## Actions', '', 'An add-on asks one with `ctx.act({ action, args, reason })` (README.md "Asking for an action"). An offered action',
    "runs its owner's door on the side named, inside the bound. A closed action is no add-on's to ask; its code is one of",
    'CL (the call limit), SV (save and restore), KY (keys and account assets), AS (the add-on system) and FW (the framework).', '',
    '| Action | Owner | Side | Args | Bound, or closed with its reason | Game events and functions |', '|---|---|---|---|---|---|');
  for (const [file, rows] of tables) for (const [name, a] of Object.entries(rows.ACTIONS ?? {})) {
    const calls = [...a.events.map(e => `\`${e}\``), ...a.functions.map(f => `\`${f}\``)].join(', ');
    out.push(a.door !== undefined
      ? `| \`${name}\` | ${owner(file)} | ${characterDoors.has(a.door) ? 'character' : 'coordinator'} | ${cell(a.args)} | ${cell(a.bound)} | ${calls} |`
      : `| \`${name}\` | ${owner(file)} | | | closed ${cell(a.closed)}: ${cell(a.cite)} | ${calls} |`);
  }
  out.push('', '## Reads', '', 'An add-on reads one with `ctx.read(name, ...args)` or `read(name, ...args)` (README.md "Reading state"), on the side named.', '',
    '| Read | Owner | Side | Returns |', '|---|---|---|---|');
  for (const [file, rows] of tables) for (const [name, r] of Object.entries(rows.READS ?? {}))
    out.push(`| \`${name}\` | ${owner(file)} | ${cell(r.side)} | ${cell(r.type)} |`);
  out.push('');
  const rank = (tier: keyof typeof TIERS) => TIERS[tier].rank;
  const movers = (tier: string) => coreRegistrations.flatMap(r => (r.hooks['movement.request'] ?? []).filter(m => m.tier === tier).map(m => m.name));
  out.push('## Movement tiers, highest first', '', 'An add-on mover names a tier marked add-on; each tier lists the core movers in it.', '');
  for (const tier of (Object.keys(TIERS) as (keyof typeof TIERS)[]).sort((a, b) => rank(b) - rank(a)))
    out.push(`- \`${tier}\` (${rank(tier)})${(ADDON_TIERS as readonly string[]).includes(tier) ? ', add-on' : ''}${movers(tier).length ? `: ${movers(tier).join(', ')}` : ''}`);
  out.push('');
  out.push('## Spend ranks', '', Object.entries(SPEND_RANKS).sort(([, a], [, b]) => b - a).map(([r, n]) => `\`${r}\` (${n})`).join(', ') +
    `; an add-on asks at \`${ADDON_SPEND_CAP}\` or below.`, '');
  out.push('## Slot buttons', '', `A slot entry's button colour is one of ${SLOT_COLORS.map(c => `\`${c}\``).join(', ')}; each app maps the name to its own palette.`, '');
  out.push('## Settings', '', `An add-on setting's kinds: ${ADDON_KINDS.map(k => `\`${k}\``).join(', ')}. Its placements: ${SETTING_SCOPES.map(s => `\`${s}\``).join(', ')} ` +
    '(runtime/settings/api.ts).', '');
  // store.ts's header comment, its first block of comment lines.
  const lines = read('runtime/hooks/store.ts').split('\n'), header = lines.slice(0, lines.findIndex(l => !l.startsWith('//')));
  out.push('## Storage and delivered data', '', header.map(l => l.replace(/^\/\/ ?/, '')).join(' ').replace(/\s+/g, ' ').trim(), '',
    'An add-on holds its store through `AddonStoreHandle`, and reads what the coordinator delivers to it with `delivered(name)` from addon-api.ts.', '');
  out.push('## Published functions and types (runtime/hooks/addon-api.ts)', '');
  for (const file of [...Object.keys(files).map(f => `runtime/hooks/${f.replace('rows/', 'api/')}`), 'runtime/hooks/addon-api.ts', KIT]) {
    const exports = exportsOf(file, read(file)).filter(e => e.line !== 'export {};');
    if (!exports.length) continue;
    out.push(`### ${file}`, '');
    for (const e of exports) out.push(`- \`${e.line}\`${e.comment ? `: ${e.comment}` : ''}`);
    out.push('');
  }
  out.push('## Load and build refusals', '');
  // `problem` hands the one-answer check to `oneAnswerHeld`, which the add-on switches use too.
  for (const name of ['problem', 'oneAnswerHeld']) for (const m of messagesOf('runtime/hooks/registry.ts', read('runtime/hooks/registry.ts'), name)) out.push(`- ${m}`);
  for (const m of messagesOf('runtime/hooks/build/installed.mts', read('runtime/hooks/build/installed.mts'), 'installedFolders')) out.push(`- ${m}`);
  return out.join('\n') + '\n';
}

// The command itself; cli/hook-list.mts runs it after it writes the installed list.
export function main(): void {
  writeFileSync(path.join(ROOT, HOOK_LIST), hookList(ROOT));
  console.log(`Wrote ${HOOK_LIST}: ${Object.keys(HOOKS).length} hooks and events, ${Object.keys(SLOTS).length} slots.`);
}
