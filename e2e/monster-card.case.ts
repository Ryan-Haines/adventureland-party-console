import { test, expect } from "./fixtures";
import type { Locator } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

// Failure inventory: docs/monster-card.md. Monster definitions are declared from the
// live game data (17665); the maintained dialogs run in Chromium with the console styles.
const color = (locator: Locator) => locator.evaluate((node) => getComputedStyle(node).color);
const rgb = (hex: string) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};
const monster = (id: string, definition: Record<string, unknown>) => ({
  id, name: String(definition.name), sprite: null, hp: Number(definition.hp), attack: Number(definition.attack), xp: Number(definition.xp),
  range: Number(definition.range), threat: 0, definition, drops: [],
});
const goo = monster("goo", { name: "Goo", speed: 6, charge: 12, hp: 100, xp: 100, attack: 5, damage_type: "physical", respawn: 1, range: 15,
  frequency: 0.4, aggro: 0, aa: 1, achievements: [[10, "stat", "hp", 5]], skin: "goo", rage: 0, mp: 2 });
const greenjr = monster("greenjr", { name: "Green Jr.", speed: 30, hp: 120000, xp: 0, attack: 300, damage_type: "physical", respawn: -1,
  range: 50, frequency: 1, aggro: 1, skin: "greenjr" });
const mrgreen = monster("mrgreen", { name: "Mr. Green", speed: 40, charge: 90, hp: 36000000, xp: 48000000, attack: 1200,
  damage_type: "physical", respawn: 5640, phresistance: 100, range: 620, frequency: 1.6, aggro: 1, rage: 1, apiercing: 320,
  resistance: 900, cooperative: true, announce: "#256943", spawns: [["hp:0.75", "greenjr", 5], ["hp:0.50", "greenjr", 5], ["hp:0.25", "greenjr", 5]],
  skin: "mrgreen" });
const bscorpion = monster("bscorpion", { name: "Black Scorpion", speed: 24, hp: 1200000, xp: 900000, attack: 2400, damage_type: "physical",
  respawn: 3600, range: 40, frequency: 1, aggro: 1, skin: "bscorpion",
  abilities: { weakness_aura: { aura: true, condition: "weakness", radius: 100, cooldown: 4000 } } });
const harpy = monster("harpy", { name: "Harpy", speed: 30, hp: 32000, xp: 24000, attack: 160, damage_type: "physical", respawn: 60, range: 30,
  frequency: 1, aggro: 0.5, skin: "harpy", abilities: { warp_on_hit: { unlimited: true, attr0: 0.08 } } });
const MONSTERS = [goo, greenjr, mrgreen, bscorpion, harpy];
const SKILLS = [{ id: "shared", name: "Shared / system", skills: [{ id: "weakness_aura", name: "Weakness Aura", sprite: null,
  definition: { name: "Weakness Aura", explanation: "Weakens nearby enemies.", type: "skill" } }] }];

test("monsters show the game's monster card beside an extras box in both dialogs", async ({ page, app }, info) => {
  const bundle = await build({
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    tsconfig: path.resolve("dashboard/tsconfig.json"),
    stdin: {
      resolveDir: path.resolve("dashboard"),
      loader: "tsx",
      contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {MonsterDetailsDialog} from './features/party/monster-details-dialog';
    import {ItemDetails} from './features/party/item-details';
    const root=createRoot(document.getElementById('root'));
    window.mountMonster=(monster,monsters,skills)=>root.render(<MonsterDetailsDialog monster={monster} monsters={monsters} skills={skills}
      catalog={[]} achievement={null} onOpenChange={()=>root.render(null)} onInspectDrop={()=>{}} onNavigate={()=>{}}/>);
    window.mountItem=(selected,monsters,skills)=>root.render(<ItemDetails selected={selected} catalog={[]} exchanges={[]} skills={skills}
      monsters={monsters} characters={[]} achievements={{}} standFull={false} onNavigate={()=>{}} onAddWTB={()=>{}} onAddStand={()=>{}}
      onCompare={()=>{}} onCompareCatalog={()=>{}} onOpenChange={()=>root.render(null)}/>);
    window.unmount=()=>root.render(null);
  `,
    },
  });
  await page.goto(app.url);
  await expect(page.locator("body")).toContainText("Party");
  const styles = await page
    .locator('style, link[rel="stylesheet"]')
    .evaluateAll((nodes) => nodes.map((node) => node.outerHTML).join("\n"));
  await page.route("**/monster-card-harness", (route) =>
    route.fulfill({ contentType: "text/html", body: `<!doctype html><head>${styles}</head><body><div id="root"></div></body>` }),
  );
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(app.url + "/monster-card-harness");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const lines = (box: Locator) => box.locator("[data-line]").evaluateAll((nodes) => nodes.map((node) => node.textContent));
  const show = async (value: unknown) => {
    await page.evaluate(() => (window as any).unmount());
    await page.evaluate(([entry, monsters, skills]) => (window as any).mountMonster(entry, monsters, skills), [value, MONSTERS, SKILLS] as const);
    const dialog = page.getByRole("dialog");
    return { dialog, card: dialog.getByRole("region", { name: "Monster card", exact: true }), extras: dialog.getByRole("region", { name: "Monster extras", exact: true }) };
  };

  // 1: Goo in the game's monster mode, with the game's colors.
  const gooView = await show(goo);
  expect(await lines(gooView.card)).toEqual(["XP: 100", "Damage: 5", "Type: Physical", "Range: 15", "HP: 100", "MP: 2", "Speed: 6", "A.Speed: 40"]);
  expect(await color(gooView.card.locator('[data-line="attack"] [data-label]'))).toBe(rgb("#DB2900"));
  expect(await color(gooView.card.locator('[data-line="hp"] [data-label]'))).toBe(rgb("#FF2E46"));
  // 5: the rest of the grid, readable, without the name, skin and achievements.
  expect(await lines(gooView.extras)).toEqual(["Aa: 1", "Aggro: 0", "Charge: 12", "Rage: 0", "Respawn: 1"]);
  // 8: meaning colors on the extras labels.
  for (const [key, hex] of [["aggro", "#E13758"], ["respawn", "#7AC0F5"], ["charge", "#36B89E"], ["rage", "#F36C6E"]] as const)
    expect(await color(gooView.extras.locator(`[data-line="${key}"] [data-label]`))).toBe(rgb(hex));
  await expect(gooView.dialog).toContainText("G.monsters.goo");
  await info.attach("monster-card-goo", { body: await gooView.dialog.screenshot(), contentType: "image/png" });

  // 9: the level preview follows level_monster and calculate_monster_stats.
  const level = gooView.dialog.getByRole("group", { name: "Monster level preview", exact: true }).getByRole("slider");
  await expect(gooView.dialog.getByText("Level 1", { exact: true })).toBeVisible();
  await level.focus();
  for (let step = 1; step < 9; step++) await page.keyboard.press("ArrowRight");
  await expect(gooView.dialog.getByText("Level 9", { exact: true })).toBeVisible();
  expect(await lines(gooView.card)).toEqual(["XP: 900", "Damage: 10", "Type: Physical", "Range: 15", "HP: 500", "MP: 2", "Speed: 8.16", "A.Speed: 70.6"]);
  await expect(gooView.dialog).toContainText("Gold and drop chance ×9");
  for (let step = 9; step < 15; step++) await page.keyboard.press("ArrowRight");
  expect(await lines(gooView.card)).toEqual(["XP: 1500", "Damage: 12", "Type: Physical", "Range: 15", "HP: 800", "MP: 2", "Speed: 8.88", "A.Speed: 80.8"]);
  await info.attach("monster-card-goo-level-15", { body: await gooView.dialog.screenshot(), contentType: "image/png" });

  // 2, 3: Mr. Green's game names, flags and spawns.
  const greenView = await show(mrgreen);
  const greenLines = await lines(greenView.card), greenExtras = await lines(greenView.extras);
  expect(greenLines).toEqual(["XP: 48000000", "Damage: 1200", "Type: Physical", "Range: 620", "HP: 36000000",
    "A.Piercing: 320", "Resistance: 900", "Impact Res.: 100", "Speed: 40", "A.Speed: 160", "Cooperative",
    "Spawns: Green Jr.", "Spawns: Green Jr.", "Spawns: Green Jr."]);
  expect(await color(greenView.card.locator('[data-line="spawn_0"] [data-label]'))).toBe(rgb("#237B2A"));
  await info.attach("monster-card-mrgreen", { body: await greenView.dialog.screenshot(), contentType: "image/png" });

  // 4: a skill aura reads as an Aura line; an ability that isn't a skill moves to the extras.
  const scorpionView = await show(bscorpion);
  expect(await lines(scorpionView.card)).toContain("Aura: Weakness Aura");
  expect(await color(scorpionView.card.locator('[data-line="ability_weakness_aura"] [data-label]'))).toBe(rgb("#FC5F39"));
  const harpyView = await show(harpy);
  expect(await lines(harpyView.card)).not.toContainEqual(expect.stringContaining("warp"));
  expect(await lines(harpyView.extras)).toContain("Abilities: warp_on_hit");

  // 7: side by side here; stacked on a narrow viewport without sideways scrolling.
  const wideCard = (await harpyView.card.boundingBox())!, wideExtras = (await harpyView.extras.boundingBox())!;
  expect(wideExtras.x).toBeGreaterThanOrEqual(wideCard.x + wideCard.width - 1);
  await page.setViewportSize({ width: 420, height: 1000 });
  const narrowCard = (await harpyView.card.boundingBox())!, narrowExtras = (await harpyView.extras.boundingBox())!;
  expect(narrowExtras.y).toBeGreaterThanOrEqual(narrowCard.y + narrowCard.height - 1);
  expect(await harpyView.dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1400, height: 1000 });

  // 6, 3: Mr. Green from an item's drops shows the same card, and a spawn drills in.
  await page.evaluate(() => (window as any).unmount());
  await page.evaluate(([monsters, skills]) => (window as any).mountItem({
    character: "Dropped by Mr. Green",
    entry: { slot: -1, item: { name: "candypop", level: 0 }, meta: { definition: { name: "Candy Pop", type: "gem" }, properties: {},
      usage: { classes: [], hands: [] }, world: { drops: [{ monsterId: "mrgreen", monsterName: "Mr. Green", rate: 0.01, quantity: 1, sprite: null }] },
      sprite: null } },
  }, monsters, skills), [MONSTERS, SKILLS] as const);
  await page.getByRole("dialog", { name: "Candy Pop", exact: true }).getByRole("button", { name: /Mr\. Green/ }).click();
  const fromItem = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Mr. Green", exact: true }) });
  const itemCard = fromItem.getByRole("region", { name: "Monster card", exact: true });
  expect(await lines(itemCard)).toEqual(greenLines);
  expect(await lines(fromItem.getByRole("region", { name: "Monster extras", exact: true }))).toEqual(greenExtras);
  expect(greenExtras).toContain("Respawn: 5640");
  await itemCard.getByRole("button", { name: "Green Jr." }).first().click();
  await expect(page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Green Jr.", exact: true }) })).toBeVisible();
  await info.attach("monster-card-from-item", { body: await page.getByRole("dialog").screenshot(), contentType: "image/png" });
});
