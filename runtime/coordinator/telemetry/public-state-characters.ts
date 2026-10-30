import { selectSnapshot } from "../persistence/snapshots.ts";
import { fastProjection, sectionFields } from "./character-fields.ts";
import { entryMeta } from "../inventory/catalog-meta.ts";
import type { PresentationEntry, PresentationStatus, PublicCommand } from "./public-state-types.ts";

export function diagnosticCharacters(statuses: Readonly<Record<string, PresentationStatus>>) {
  const allowed = new Set<string>(sectionFields.diagnostics);
  return Object.fromEntries(
    Object.entries(statuses).map(([name, status]) => [
      name,
      {
        ...Object.fromEntries(Object.entries(status).filter(([key]) => allowed.has(key))),
        combat: {
          positioning: (status.combat as { positioning?: unknown } | undefined)?.positioning,
        },
      },
    ]),
  );
}

const metadataFields = [
  "definition",
  "upgradeable",
  "compoundable",
  "buyable",
  "properties",
  "scaling",
  "maxLevel",
  "sprite",
  "title",
] as const;

export function fastCharacters(statuses: Readonly<Record<string, PresentationStatus>>) {
  return Object.fromEntries(
    Object.entries(statuses).map(([name, status]) => [
      name,
      fastProjection(status || {}),
    ]),
  );
}

// One compact copy per joined meta object, which lives until the next report.
const compactMetas = new WeakMap<object, Record<string, unknown>>();
/**
 * Joins the catalog's per-type meta onto a report entry, then keeps the fields
 * the dashboard, the mobile apps and the stream have always received here.
 */
export function compactEntry(entry: PresentationEntry | null, catalog: unknown): PresentationEntry | null {
  if (!entry) return entry;
  const meta = entryMeta(catalog, entry);
  // After a coordinator restart the first reports carry per-copy meta
  // (characters/shared.js itemDefinition, always with `properties`) before the
  // catalog arrives again. Dashboard readers such as inventory-panel.tsx read
  // meta.definition whenever meta is set, so per-copy meta stays out until the
  // catalog joins it. Other meta passes through as before.
  if (!meta || (!meta.definition && "properties" in meta)) return { ...entry, meta: null };
  let compact = compactMetas.get(meta);
  if (!compact) compactMetas.set(meta, (compact = selectSnapshot(meta, metadataFields)));
  return { ...entry, meta: compact };
}

export function inventoryCharacters(
  statuses: Readonly<Record<string, PresentationStatus>>,
  catalog: unknown,
) {
  return Object.fromEntries(
    Object.entries(statuses).map(([name, status]) => [
      name,
      {
        items: (status.items || []).map((entry) => compactEntry(entry, catalog)),
        slots: Object.fromEntries(
          Object.entries(status.slots || {}).map(([slot, entry]) => [
            slot,
            compactEntry(entry, catalog),
          ]),
        ),
        characterDollHtml: status.characterDollHtml || null,
      },
    ]),
  );
}

export function pendingCommands(
  commands: Readonly<Record<string, PublicCommand | null | undefined>>,
) {
  return Object.fromEntries(
    Object.entries(commands).map(([name, command]) => [
      name,
      command && {
        id: command.id,
        type: command.type,
        phase: command.phase || null,
        convoyId: command.convoyId || null,
      },
    ]),
  );
}
