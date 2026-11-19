// The character's wardrobe as `status.report` sends it: the looks it wears, the looks it owns, the
// CX jars in its bag and the emotes it can play. It reads only the character and game data the
// report's view carries.

// `slot` is the cx slot the game puts the look in, or null for a look whose sprite type has none.
export interface OwnedLook { name: string; count: number; worn: boolean; slot: string | null }
export interface CxJar { cell: number; look: string | null }
export interface Emote { skill: string; name: string; targeted: boolean }
export interface CosmeticsReport { worn: Record<string, string>; owned: OwnedLook[]; jars: CxJar[]; emotes: Emote[] }

interface SkillDef { name?: string; emote?: string; target?: unknown }
interface SpriteSheet { type?: string; matrix?: readonly (readonly string[])[] }
interface ReportView {
  character?: { cx?: Record<string, unknown> | null; acx?: Record<string, unknown> | null; items?: readonly unknown[] | null };
  G?: { skills?: Record<string, SkillDef>; sprites?: Record<string, SpriteSheet> };
}

// The game's cxtype_to_slot (js/common_functions.js): the cx slot each sprite type goes in. The
// server's cx handler (server.js:5331) files a look by its type and reads the slot it is sent only
// for `skin` and `upper`.
const SLOT_OF_TYPE: Readonly<Record<string, string>> = {
  armor: 'skin', body: 'skin', character: 'skin', face: 'face', makeup: 'makeup', a_makeup: 'makeup',
  beard: 'chin', mask: 'chin', tail: 'tail', s_wings: 'back', wings: 'back', hat: 'hat', a_hat: 'hat',
  head: 'head', hair: 'hair', gravestone: 'gravestone',
};

// The game builds its look-to-type map `T` from every name in each `G.sprites` sheet's matrix.
export function lookSlots(sprites: Record<string, SpriteSheet> | undefined): Map<string, string> {
  const slots = new Map<string, string>();
  for (const sheet of Object.values(sprites ?? {})) {
    const slot = sheet.type ? SLOT_OF_TYPE[sheet.type] : undefined;
    if (slot) for (const row of sheet.matrix ?? []) for (const name of row) if (name) slots.set(name, slot);
  }
  return slots;
}

const byKey = <T>(key: (t: T) => string) => (a: T, b: T) => key(a).localeCompare(key(b));

export function cosmeticsReport(view: unknown): CosmeticsReport | undefined {
  const { character, G } = (view ?? {}) as ReportView;
  if (!character) return undefined;
  // `cx` holds the look in each slot; the game leaves a cleared slot as '' or null.
  const worn: Record<string, string> = {};
  for (const [slot, look] of Object.entries(character.cx ?? {}).sort(([a], [b]) => a.localeCompare(b)))
    if (typeof look === 'string' && look) worn[slot] = look;
  const wearing = new Set(Object.values(worn));
  // `acx` counts the copies of each look; sending the last copy to another character leaves 0.
  const acx = character.acx ?? {};
  const slots = lookSlots(G?.sprites);
  const owned = Object.entries(acx).filter(([, count]) => Number(count) > 0)
    .map(([name, count]) => ({ name, count: Number(count), worn: wearing.has(name), slot: slots.get(name) ?? null })).sort(byKey(l => l.name));
  const jars = (character.items ?? []).flatMap((item, cell) => {
    const it = item as { name?: string; data?: unknown } | null;
    return it?.name === 'cxjar' ? [{ cell, look: typeof it.data === 'string' && it.data ? it.data : null }] : [];
  });
  // The game's Random Emote picks from the `G.skills` entries whose `emote` look the character owns
  // (js/functions.js on_skill "emotion"); a targeted one also needs someone to play it on.
  const emotes = Object.entries(G?.skills ?? {}).filter(([, s]) => s.emote && Number(acx[s.emote]) > 0)
    .map(([skill, s]) => ({ skill, name: s.name || skill, targeted: !!s.target })).sort(byKey(e => e.name));
  return { worn, owned, jars, emotes };
}
