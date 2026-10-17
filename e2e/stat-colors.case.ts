import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

// Failure inventory: docs/stat-colors.md. Every card renders in Chromium with the
// console styles; the declared data gives each card the same stats.
const color = (locator: Locator) => locator.first().evaluate((node) => getComputedStyle(node).color);
const rgb = (hex: string) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};
const PALETTE = { attack: "#DB2900", mp: "#3A62CE", armor: "#A3A9B0", resistance: "#8B74C9", lifesteal: "#C8323E", range: "#93A6A2",
  frequency: "#3BE681", speed: "#36B89E", fortitude: "#9A6BC9", manasteal: "#5C66D9", evasion: "#7AC0F5", cooldown: "#4EB7DE" };

test("each stat reads the same color in every game-style card", async ({ page, app }) => {
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
    import {ItemDetails} from './features/party/item-details';
    import {MonsterDetailsDialog} from './features/party/monster-details-dialog';
    import {CharacterStatsDialog} from './features/party/character-stats-dialog';
    import {GearComparisonDialog} from './features/party/gear-comparison-dialog';
    import {SkillsDialog} from './features/party/skills-dialog';
    const root=createRoot(document.getElementById('root'));
    const noop=()=>{};
    window.show=(kind,value)=>root.render(null)||setTimeout(()=>root.render(
      kind==='item'?<ItemDetails selected={value} catalog={[]} exchanges={[]} monsters={[]} characters={[]} achievements={{}} standFull={false}
        onNavigate={noop} onAddWTB={noop} onAddStand={noop} onCompare={noop} onCompareCatalog={noop} onOpenChange={noop}/>:
      kind==='monster'?<MonsterDetailsDialog monster={value} catalog={[]} achievement={null} onOpenChange={noop} onInspectDrop={noop} onNavigate={noop}/>:
      kind==='character'?<CharacterStatsDialog character={value} onOpenChange={noop}/>:
      kind==='comparison'?<GearComparisonDialog comparison={value} onOpenChange={noop}/>:
      <SkillsDialog open classes={value} onOpenChange={noop}/>),0);
  `,
    },
  });
  await page.goto(app.url);
  await expect(page.locator("body")).toContainText("Party");
  const styles = await page.locator('style, link[rel="stylesheet"]').evaluateAll((nodes) => nodes.map((node) => node.outerHTML).join("\n"));
  await page.route("**/stat-colors-harness", (route) =>
    route.fulfill({ contentType: "text/html", body: `<!doctype html><head>${styles}</head><body><div id="root"></div></body>` }));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(app.url + "/stat-colors-harness");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const show = async (p: Page, kind: string, value: unknown) => {
    await p.evaluate(([k, v]) => (window as any).show(k, v), [kind, value] as const);
    await expect(p.getByRole("dialog")).toBeVisible();
    return p.getByRole("dialog");
  };
  const label = (box: Locator, key: string) => color(box.locator(`[data-line="${key}"] [data-label]`));

  const stats = { attack: 30, mp: 50, armor: 20, resistance: 10, lifesteal: 2, range: 5, evasion: 3, frequency: 1, speed: 4 };
  const item = await show(page, "item", { character: "W", entry: { slot: 1, item: { name: "testgear", level: 0 },
    meta: { definition: { name: "Test Gear", type: "chest", ...stats }, properties: stats, usage: { classes: [], hands: [] }, sprite: null } } });
  const itemCard = item.getByRole("region", { name: "Item card", exact: true });
  for (const key of ["attack", "mp", "armor", "resistance", "lifesteal", "range", "evasion", "frequency", "speed"] as const)
    expect(await label(itemCard, key), `item ${key}`).toBe(rgb(PALETTE[key]));

  const monster = await show(page, "monster", { id: "testmob", name: "Test Mob", sprite: null, hp: 100, attack: 30, xp: 1, range: 5, threat: 0, drops: [],
    definition: { name: "Test Mob", hp: 100, xp: 1, attack: 30, armor: 20, resistance: 10, range: 5, speed: 4, frequency: 1, mp: 50 } });
  const monsterCard = monster.getByRole("region", { name: "Monster card", exact: true });
  for (const key of ["attack", "mp", "armor", "resistance", "range", "frequency", "speed"] as const)
    expect(await label(monsterCard, key), `monster ${key}`).toBe(rgb(PALETTE[key]));

  const character = await show(page, "character", { name: "Tester", ctype: "mage", primaryStat: "int", level: 50, hp: 1, max_hp: 1, mp: 1, max_mp: 1,
    attack: 30, frequency: 1, range: 5, speed: 4, armor: 20, resistance: 10, str: 1, int: 1, dex: 1, vit: 1, fortitude: 1, luck: 100, xp: 0, max_xp: 1,
    gold: 0, map: "main", x: 0, y: 0, rip: false, banking: false, seenAt: 0, items: [], slots: {}, conditions: [], combatStats: { lifesteal: 2, manasteal: 1 } });
  const characterCard = character.getByRole("region", { name: "Character card", exact: true });
  const characterExtras = character.getByRole("region", { name: "Character extras", exact: true });
  // 2: the panel's game-gray lines take their stat colors.
  for (const [key, stat] of [["attack", "attack"], ["mp", "mp"], ["frequency", "frequency"], ["range", "range"], ["speed", "speed"],
    ["armor", "armor"], ["resistance", "resistance"]] as const)
    expect(await label(characterCard, key), `character ${key}`).toBe(rgb(PALETTE[stat]));
  for (const [key, stat] of [["lifesteal", "lifesteal"], ["manasteal", "manasteal"], ["for", "fortitude"], ["armor", "armor"], ["resistance", "resistance"]] as const)
    expect(await label(characterExtras, key), `character extras ${key}`).toBe(rgb(PALETTE[stat]));

  const gear = (name: string, properties: Record<string, number>) => ({ item: { name, level: 0 },
    meta: { definition: { name, type: "chest" }, properties, usage: { classes: [], hands: [] }, world: {} } });
  const comparison = await show(page, "comparison", { character: { name: "Tester", ctype: "mage", level: 50, primaryStat: "int", int: 1, str: 1, dex: 1,
    vit: 1, hp: 1, max_hp: 1, mp: 1, max_mp: 1, attack: 30, armor: 20, resistance: 10, frequency: 1, speed: 4, range: 5,
    slots: { chest: gear("old", { armor: 5 }) }, items: [] }, slot: "chest", entry: { slot: 0, ...gear("new", { armor: 8 }) } });
  const equipped = comparison.getByRole("group", { name: "Equipped stats", exact: true });
  for (const [key, stat] of [["attack", "attack"], ["max_mp", "mp"], ["armor", "armor"], ["resistance", "resistance"], ["lifesteal", "lifesteal"],
    ["range", "range"], ["frequency", "frequency"], ["speed", "speed"], ["fortitude", "fortitude"], ["manasteal", "manasteal"]] as const)
    expect(await label(equipped, key), `comparison ${key}`).toBe(rgb(PALETTE[stat]));

  // 3: a skill's cooldown no longer shares Evasion's color; MP and Range match the palette.
  const skills = await show(page, "skills", [{ id: "x", name: "X", skills: [{ id: "zap", name: "Zap", sprite: null,
    definition: { name: "Zap", explanation: "Zap.", mp: 100, cooldown: 2000, range: 300 } }] }]);
  await skills.getByRole("button", { name: /^Zap/ }).click();
  const skillCard = skills.getByRole("region", { name: "Skill card", exact: true });
  expect(await label(skillCard, "mp")).toBe(rgb(PALETTE.mp));
  expect(await label(skillCard, "range")).toBe(rgb(PALETTE.range));
  expect(await label(skillCard, "cooldown")).toBe(rgb(PALETTE.cooldown));
  expect(PALETTE.cooldown).not.toBe(PALETTE.evasion);
});
