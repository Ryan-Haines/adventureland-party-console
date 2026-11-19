// The planted equipment both comparison cases mount (comparison-card.case.ts,
// gear-comparison.case.ts): a two-handed staff replaces a wand and its book, losing the book set
// and completing the staff set. Game metadata is a declared boundary.

// The case's tsx entry: window.mountComparison renders the maintained GearComparisonDialog.
export const comparisonSource = `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {GearComparisonDialog} from './features/party/gear-comparison-dialog';
    const root=createRoot(document.getElementById('root'));
    window.mountComparison=(comparison)=>root.render(<GearComparisonDialog comparison={comparison} onOpenChange={()=>root.render(null)}/>);
  `;
export const set = (id: string, items: string[], int: number) => ({
  id, name: id, items: items.map((item) => ({ id: item, name: item, quantity: 1, sprite: null })), bonuses: [{ pieces: 2, stats: { int } }],
});
export const bookSet = set("Book set", ["book", "helmet"], 10), staffSet = set("Staff set", ["sparkstaff", "ring"], 20);
export const gear = (name: string, properties: Record<string, number>, hands: number | null, setInfo?: ReturnType<typeof set>) => ({
  item: { name, level: 0 },
  // Upgradeable weapons, so both panels show their level slider (comparison-card failure mode 8).
  // The definition matches the reported properties, so level 0 previews the same stats.
  meta: { definition: { name, type: hands ? "weapon" : "armor", ...(hands ? properties : {}) }, properties,
    ...(hands ? { upgradeable: true, scaling: { attack: 4 }, maxLevel: 12 } : {}),
    usage: { classes: [{ id: "mage", hands }], hands: [hands] }, world: { set: setInfo } },
});
export const character = {
  name: "Qwentina", ctype: "mage", level: 80, primaryStat: "int", int: 100, str: 10, dex: 10, vit: 10, hp: 1000, max_hp: 1000,
  mp: 2000, max_mp: 2000, attack: 600, armor: 50, resistance: 100, frequency: 1, speed: 30, range: 100,
  slots: { mainhand: gear("wand", { attack: 100, int: 5 }, 1), offhand: gear("book", { int: 15, armor: 40 }, null, bookSet),
    helmet: gear("helmet", {}, null, bookSet), ring1: gear("ring", {}, null, staffSet) },
  items: [],
};
export const staffForWand = { character, slot: "mainhand", entry: { slot: 0, ...gear("sparkstaff", { attack: 150, int: 10 }, 2, staffSet) } };
