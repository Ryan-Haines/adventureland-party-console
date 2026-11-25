// The card panel's rows from the character's `addonReports.cosmetics`. A report from an older build
// of the add-on, or none yet, gives null, and the panel shows its empty line.
import type { LastPress } from './commands.ts';
import type { CosmeticsReport } from './report.ts';

export interface PanelRows {
  worn: { slot: string; look: string }[];
  // `slot` is set only for a look the panel can put on: one not worn whose slot the game data names.
  owned: { name: string; label: string; worn: boolean; slot: string | null }[];
  jars: { cell: number; label: string }[];
  // `playable` is false for a targeted emote, since the emote action takes no target.
  emotes: { skill: string; label: string; playable: boolean }[];
}

const isReport = (r: unknown): r is CosmeticsReport => {
  const v = r as Partial<CosmeticsReport> | null | undefined;
  return !!v && typeof v.worn === 'object' && v.worn !== null && !Array.isArray(v.worn)
    && Array.isArray(v.owned) && Array.isArray(v.jars) && Array.isArray(v.emotes);
};

export function panelRows(report: unknown): PanelRows | null {
  if (!isReport(report)) return null;
  return {
    worn: Object.entries(report.worn).map(([slot, look]) => ({ slot, look })),
    owned: report.owned.map(l => ({ name: l.name, label: l.count > 1 ? `${l.name} x${l.count}` : l.name, worn: l.worn,
      slot: !l.worn && typeof l.slot === 'string' ? l.slot : null })),
    // The game numbers bag cells from 0; the card counts them from 1, as the inventory grid reads.
    jars: report.jars.map(j => ({ cell: j.cell, label: `Bag ${j.cell + 1}: ${j.look ?? 'unknown look'}` })),
    emotes: report.emotes.map(e => ({ skill: e.skill, label: e.targeted ? `${e.name} (needs a target)` : e.name, playable: !e.targeted })),
  };
}

// The line under the buttons: the newest press that settled, from the party store.
export function lastLine(last: unknown): string | null {
  const l = last as Partial<LastPress> | null | undefined;
  if (!l || typeof l.label !== 'string' || !l.outcome) return null;
  return l.outcome === 'sent' ? `${l.label}: sent` : `${l.label}: ${l.outcome}${l.detail ? ` (${l.detail})` : ''}`;
}
