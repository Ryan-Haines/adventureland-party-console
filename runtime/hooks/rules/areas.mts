// addon:check rule 9, the slot coverage check (
// "The standing check"): every dashboard area a player sees is marked, and each mark has a slot or a
// core-only reason. It reads the dashboard's JSX with the TypeScript parser; it reads syntax and
// guesses nothing.
// 1. Each area element carries a literal `data-area`. A section, article, header, aside, details or
//  CharacterSectionToggle drawn inside another area of the same file takes that area's decision,
//  as its buttons and rows do; a dialog, popover or sheet is its own surface, so it always carries one.
// 2. Each id has one AREAS row (runtime/hooks/rows/12-status.ts), and each row's id is in its file.
// 3. A slotted area's element holds its slot's draw.
// 4. Every SLOTS row is drawn somewhere: an `<AddonSlot name>` names it, or a `data-addon-slot` mark
//  names it on the element that draws a slot from the registry's data.
import type * as TS from 'typescript';
import { parse, ts } from './uses.mts';
import type { AreaRow } from '../rows/12-status.ts';

export const AREA_KINDS = new Set(['DialogContent', 'PopoverContent', 'SheetContent', 'header', 'aside', 'section', 'article', 'details', 'CharacterSectionToggle']);
const SURFACES = new Set(['DialogContent', 'PopoverContent', 'SheetContent']);
// The folders whose `.tsx` files draw what a player sees.
export const AREA_FOLDERS = /^(dashboard\/features\/party|dashboard\/app|runtime\/hooks\/dashboard)\/.+\.tsx$/;

export interface AreaRows { AREAS: Readonly<Record<string, AreaRow>>; AREA_CORE_REASONS: readonly string[] }

type Element = TS.JsxElement | TS.JsxSelfClosingElement;
const opening = (node: Element) => ts.isJsxElement(node) ? node.openingElement : node;
const tagOf = (node: Element) => opening(node).tagName.getText();
// A literal string attribute's value; undefined when the attribute is absent or not a literal.
function literal(node: Element, name: string): string | undefined {
  for (const attribute of opening(node).attributes.properties)
    if (ts.isJsxAttribute(attribute) && attribute.name.getText() === name && attribute.initializer && ts.isStringLiteral(attribute.initializer))
      return attribute.initializer.text;
  return undefined;
}
// Every JSX element of a file with the area elements above it in the same file.
function elements(file: string, text: string): { node: Element; areas: Element[] }[] {
  const out: { node: Element; areas: Element[] }[] = [];
  const visit = (node: TS.Node, areas: Element[]) => {
    let inner = areas;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      out.push({ node, areas });
      if (AREA_KINDS.has(tagOf(node))) inner = [...areas, node];
    }
    ts.forEachChild(node, child => visit(child, inner));
  };
  const source = parse(file, text);
  visit(source, []);
  return out;
}
// The slots an element draws: `<AddonSlot name>` and each name of a `data-addon-slot` mark.
function draws(node: Element): { slot: string; part?: string }[] {
  if (tagOf(node) === 'AddonSlot') { const slot = literal(node, 'name'); return slot ? [{ slot, part: literal(node, 'part') }] : []; }
  return (literal(node, 'data-addon-slot') ?? '').split(/\s+/).filter(Boolean).map(slot => ({ slot }));
}

export function areaFindings(rows: AreaRows, slots: Readonly<Record<string, unknown>>, sources: ReadonlyMap<string, string>): string[] {
  const findings: string[] = [], found = new Map<string, { file: string; node: Element; line: number }>(), drawn = new Set<string>();
  const inside = new Map<Element, { slot: string; part?: string }[]>();
  for (const [file, text] of sources) {
    if (!AREA_FOLDERS.test(file)) continue;
    const all = elements(file, text);
    for (const { node, areas } of all) {
      const kind = tagOf(node), holders = AREA_KINDS.has(kind) ? [...areas, node] : areas;
      for (const draw of draws(node)) {
        drawn.add(draw.slot);
        for (const area of holders) inside.set(area, [...inside.get(area) ?? [], draw]);
      }
      if (!AREA_KINDS.has(kind)) continue;
      const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1, id = literal(node, 'data-area');
      if (id === undefined) {
        if (SURFACES.has(kind) || !areas.length) findings.push(`${file}:${line} draws a ${kind} with no data-area`);
        continue;
      }
      const before = found.get(id);
      if (before) findings.push(`${file}:${line} repeats the area id "${id}" of ${before.file}:${before.line}`);
      else found.set(id, { file, node, line });
    }
  }
  for (const [id, area] of found) if (!(id in rows.AREAS)) findings.push(`${area.file}:${area.line} marks the area "${id}", which no AREAS row decides`);
  for (const [id, row] of Object.entries(rows.AREAS)) {
    const at = `runtime/hooks/rows/12-status.ts AREAS ${id}`, area = found.get(id);
    if (!area || area.file !== row.file) { findings.push(`${at}: ${row.file} draws no data-area="${id}"`); continue; }
    if ('core' in row) {
      if (!rows.AREA_CORE_REASONS.includes(row.core)) findings.push(`${at}: "${row.core}" is not a core-only reason (${rows.AREA_CORE_REASONS.join(', ')})`);
      if (!row.cite) findings.push(`${at}: its core-only reason cites nothing`);
    } else if ('within' in row) {
      if (!(row.within in rows.AREAS)) findings.push(`${at}: it is drawn within "${row.within}", which no AREAS row names`);
    } else {
      if (!(row.slot in slots)) findings.push(`${at}: the slot "${row.slot}" is not a SLOTS row`);
      else if (!(inside.get(area.node) ?? []).some(draw => draw.slot === row.slot && (row.part === undefined || draw.part === row.part)))
        findings.push(`${at}: the area holds no <AddonSlot name="${row.slot}"${row.part ? ` part="${row.part}"` : ''}>`);
    }
  }
  for (const slot of Object.keys(slots)) if (!drawn.has(slot)) findings.push(`${slot} is declared but no dashboard area draws it`);
  return findings;
}
