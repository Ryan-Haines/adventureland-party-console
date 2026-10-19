import { test, expect } from "./fixtures";
import type { Locator } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

// Failure inventory: docs/comparison-card.md. Game metadata is a declared boundary;
// the maintained GearComparisonDialog runs in Chromium with the console styles.
const color = (locator: Locator) => locator.evaluate((node) => getComputedStyle(node).color);
const rgb = (hex: string) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};
const ROWS = ["HP", "MP", "Attack", "Attack speed", "Range", "Run speed", "Armor", "Resistance", "STR", "INT", "DEX", "VIT",
  "Fortitude", "Luck", "Gold", "XP", "Evasion", "Reflection", "Lifesteal", "Manasteal", "Armor piercing", "Resistance piercing",
  "Critical hit", "Damage return", "MP cost reduction", "Output"];

test("equipment comparison shows each panel's stats in the game card style", async ({ page, app }, info) => {
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
    import {GearComparisonDialog} from './features/party/gear-comparison-dialog';
    const root=createRoot(document.getElementById('root'));
    window.mountComparison=(comparison)=>root.render(<GearComparisonDialog comparison={comparison} onOpenChange={()=>root.render(null)}/>);
  `,
    },
  });
  await page.goto(app.url);
  await expect(page.locator("body")).toContainText("Party");
  const styles = await page
    .locator('style, link[rel="stylesheet"]')
    .evaluateAll((nodes) => nodes.map((node) => node.outerHTML).join("\n"));
  await page.route("**/comparison-card-harness", (route) =>
    route.fulfill({ contentType: "text/html", body: `<!doctype html><head>${styles}</head><body><div id="root"></div></body>` }),
  );
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(app.url + "/comparison-card-harness");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  // The same equipment as e2e/gear-comparison.case.ts: a two-handed staff replaces a
  // wand and its book, losing the book set and completing the staff set.
  const set = (id: string, items: string[], int: number) => ({
    id, name: id, items: items.map((item) => ({ id: item, name: item, quantity: 1, sprite: null })), bonuses: [{ pieces: 2, stats: { int } }],
  });
  const bookSet = set("Book set", ["book", "helmet"], 10), staffSet = set("Staff set", ["sparkstaff", "ring"], 20);
  const gear = (name: string, properties: Record<string, number>, hands: number | null, setInfo?: ReturnType<typeof set>) => ({
    item: { name, level: 0 },
    // Upgradeable weapons, so both panels show their level slider (failure mode 8). The
    // definition matches the reported properties, so level 0 previews the same stats.
    meta: { definition: { name, type: hands ? "weapon" : "armor", ...(hands ? properties : {}) }, properties,
      ...(hands ? { upgradeable: true, scaling: { attack: 4 }, maxLevel: 12 } : {}),
      usage: { classes: [{ id: "mage", hands }], hands: [hands] }, world: { set: setInfo } },
  });
  const character = {
    name: "Qwentina", ctype: "mage", level: 80, primaryStat: "int", int: 100, str: 10, dex: 10, vit: 10, hp: 1000, max_hp: 1000,
    mp: 2000, max_mp: 2000, attack: 600, armor: 50, resistance: 100, frequency: 1, speed: 30, range: 100,
    slots: { mainhand: gear("wand", { attack: 100, int: 5 }, 1), offhand: gear("book", { int: 15, armor: 40 }, null, bookSet),
      helmet: gear("helmet", {}, null, bookSet), ring1: gear("ring", {}, null, staffSet) },
    items: [],
  };
  await page.evaluate((value) => (window as any).mountComparison(value), {
    character, slot: "mainhand", entry: { slot: 0, ...gear("sparkstaff", { attack: 150, int: 10 }, 2, staffSet) },
  });
  const dialog = page.getByRole("dialog", { name: "Equipment comparison", exact: true });
  const equipped = dialog.getByRole("group", { name: "Equipped stats", exact: true });
  const proposed = dialog.getByRole("group", { name: "Proposed stats", exact: true });

  // 5: the panels stay the dialog's only regions.
  await expect(dialog.getByRole("region")).toHaveCount(2);
  // 1: every row, in order, in both boxes.
  for (const box of [equipped, proposed]) {
    const labels = await box.locator("[data-line] [data-label]").evaluateAll((nodes) => nodes.map((node) => node.textContent));
    expect(labels).toEqual(ROWS);
  }
  await expect(equipped.locator('[data-line="int"]')).toHaveText("INT: 100");
  await expect(equipped.locator('[data-line="attack"]')).toHaveText("Attack: 600.0");
  // 2: game colors on the labels.
  expect(await color(equipped.locator('[data-line="max_hp"] [data-label]'))).toBe(rgb("#FF2E46"));
  expect(await color(equipped.locator('[data-line="int"] [data-label]'))).toBe(rgb("#3E6EED"));
  expect(await color(equipped.locator('[data-line="lifesteal"] [data-label]'))).toBe(rgb("#C8323E"));
  // 3: direction colors in the proposed box only.
  await expect(proposed.locator('[data-line="attack"]')).toHaveText("Attack: 900.0 (+300.0 · +50.0%)");
  expect(await color(proposed.locator('[data-line="attack"] [data-change]'))).toBe(rgb("#85C76B"));
  await expect(proposed.locator('[data-line="armor"]')).toHaveText("Armor: 10.0 (-40.0 · -80.0%)");
  expect(await color(proposed.locator('[data-line="armor"] [data-change]'))).toBe(rgb("#E13758"));
  await expect(equipped.locator("[data-change]")).toHaveCount(0);
  // 4: set outcomes keep their text and gain their colors.
  const sets = dialog.getByRole("group", { name: "Set changes", exact: true });
  await expect(sets.getByText(/Book set: 2\/2/)).toContainText("1/2");
  expect(await color(sets.getByText("LOST", { exact: true }))).toBe(rgb("#E13758"));
  expect(await color(sets.getByText("GAINED", { exact: true }))).toBe(rgb("#85C76B"));
  // 8: both level sliders remain.
  await expect(dialog.getByRole("slider")).toHaveCount(2);
  // 7: the checkbox on one side and the two-handed note on the other don't misalign the boxes.
  await expect(dialog.getByRole("checkbox", { name: "include offhand weapon in comparison", exact: true })).toBeVisible();
  await expect(dialog.getByText(/Two-handed weapon/)).toBeVisible();
  const top = async (box: Locator) => (await box.boundingBox())!.y;
  expect(Math.abs((await top(equipped)) - (await top(proposed)))).toBeLessThan(1);
  for (const key of ["max_hp", "attack", "armor", "output"])
    expect(Math.abs((await top(equipped.locator(`[data-line="${key}"]`))) - (await top(proposed.locator(`[data-line="${key}"]`))))).toBeLessThan(1);
  await info.attach("comparison-card-wide", { body: await dialog.screenshot(), contentType: "image/png" });

  // 6: stacked on a narrow viewport, without sideways scrolling.
  await page.setViewportSize({ width: 420, height: 1000 });
  const left = (await dialog.getByRole("region").nth(0).boundingBox())!, right = (await dialog.getByRole("region").nth(1).boundingBox())!;
  expect(right.y).toBeGreaterThanOrEqual(left.y + left.height - 1);
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await info.attach("comparison-card-narrow", { body: await dialog.screenshot(), contentType: "image/png" });
});
