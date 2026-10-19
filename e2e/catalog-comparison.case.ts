import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

// Failure inventory: docs/catalog-comparison-card.md. Game metadata is a declared
// boundary; the maintained Equipment catalog dialog runs in Chromium with the console
// styles, and the journey adds items and opens the comparison through its buttons.
const color = (locator: Locator) => locator.evaluate((node) => getComputedStyle(node).color);
const rgb = (hex: string) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};
const square = (fill: string) => ({
  url: "data:image/svg+xml;base64," + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${fill}"/></svg>`).toString("base64"),
  tileSize: 40, columns: 1, rows: 1, x: 0, y: 0,
});
export const weapon = (definition: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  definition: { type: "weapon", ...definition }, usage: { classes: [{ id: "ranger", name: "Ranger", hands: 1 }], hands: [1] }, ...extra,
});
// A is an inventory Blade +3 with its sprite on the meta. The catalog items keep their
// sprite on the catalog entry only, as the console's catalog items can.
const source = {
  slot: 3,
  item: { name: "blade", level: 3 },
  meta: weapon({ name: "Blade", wtype: "short_sword", tier: 1, damage_type: "physical", attack: 20, dex: 2 },
    { upgradeable: true, scaling: { attack: 4 }, maxLevel: 12, properties: { attack: 32, dex: 2 }, sprite: square("#c0c0c0") }),
};
const catalog = [
  { id: "bow", name: "Bow", sprite: square("#8b5a2b"),
    meta: weapon({ name: "Bow", wtype: "bow", tier: 2, damage_type: "physical", attack: 25, range: 50, dex: 3, stat: 1 },
      { upgradeable: true, scaling: { attack: 3, stat: 1 }, maxLevel: 12, sprite: null }) },
  { id: "wand", name: "Wand", sprite: square("#5a3fd0"),
    meta: weapon({ name: "Wand", wtype: "wand", tier: 1, damage_type: "magical", attack: 18, int: 5, range: 30, ability: "freeze", attr0: 2 },
      { sprite: null }) },
];

export async function openComparison(page: Page, app: { url: string }, entry: unknown = source) {
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
    import React, {useState} from 'react';import {createRoot} from 'react-dom/client';
    import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
    import {PartyEquipmentCatalogDialog} from './features/party/party-equipment-catalog-dialog';
    const client=new QueryClient();
    function Harness({catalog, source}){
      const [open,setOpen]=useState(true), [comparison,setComparison]=useState(source);
      const model={state:{characters:{}, merchantCatalog:{allItems:catalog}}, chars:[], catalogOpen:open, setCatalogOpen:setOpen,
        catalogComparison:comparison, setCatalogComparison:setComparison, setSelected:()=>{}};
      return <QueryClientProvider client={client}><PartyEquipmentCatalogDialog model={model}/></QueryClientProvider>;
    }
    const root=createRoot(document.getElementById('root'));
    window.mountCatalog=(catalog,source)=>root.render(<Harness catalog={catalog} source={source}/>);
  `,
    },
  });
  await page.goto(app.url);
  await expect(page.locator("body")).toContainText("Party");
  const styles = await page
    .locator('style, link[rel="stylesheet"]')
    .evaluateAll((nodes) => nodes.map((node) => node.outerHTML).join("\n"));
  await page.route("**/catalog-comparison-harness", (route) =>
    route.fulfill({ contentType: "text/html", body: `<!doctype html><head>${styles}</head><body><div id="root"></div></body>` }),
  );
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(app.url + "/catalog-comparison-harness");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(([items, entry]) => (window as any).mountCatalog(items, entry), [catalog, entry] as const);
  const picker = page.getByRole("dialog", { name: "Equipment catalog", exact: true });
  for (const name of ["Bow", "Wand"])
    await picker.getByRole("button", { name: new RegExp(`^${name}\\b`) }).locator("..").getByRole("button", { name: "Add to compare", exact: true }).click();
  await picker.getByRole("button", { name: "Compare selected", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Compare catalog items", exact: true });
  await expect(dialog).toBeVisible();
  // The dialog zooms in as it opens; measure boxes once that settles.
  await dialog.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
  return dialog;
}

test("catalog comparison shows each item's stats in the game card style", async ({ page, app }, info) => {
  const dialog = await openComparison(page, app);
  const table = dialog.getByRole("table");
  const row = (key: string) => table.locator(`tbody tr[data-row="${key}"]`);
  const cell = (key: string, column: number) => row(key).locator("td").nth(column);

  // 8: the caption and the column headers' controls keep their names.
  await expect(table.locator("caption")).toHaveText("Item stats only. Every difference is against A; character bonuses and passive damage are not included.");
  await expect(dialog.getByRole("group", { name: "A Blade preview level", exact: true }).getByRole("slider")).toBeVisible();
  await expect(dialog.getByRole("group", { name: "B Bow preview level", exact: true }).getByRole("slider")).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "B Bow stat scroll", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Remove B Bow", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Remove C Wand", exact: true })).toBeVisible();

  // 1, 2: every stat row, in the old order, under the card's names and colors.
  const labels = await table.locator("tbody tr[data-row] th [data-label]").evaluateAll((nodes) => nodes.map((node) => node.textContent));
  expect(labels).toEqual(["Item Type", "Weapon Type", "Damage Type", "Ability", "Stat", "Dexterity", "Intelligence", "Damage", "Range"]);
  for (const [key, hex] of [["attack", "#DB2900"], ["dex", "#44B75C"], ["int", "#3E6EED"], ["range", "#93A6A2"]] as const)
    expect(await color(row(key).locator("th [data-label]"))).toBe(rgb(hex));

  // 3, 4: card values, then green or red differences against A.
  await expect(cell("attack", 0)).toHaveText("32");
  await expect(cell("attack", 1)).toHaveText("25 (-7 · -21.875%)");
  expect(await color(cell("attack", 1).locator("[data-change]"))).toBe(rgb("#E13758"));
  await expect(cell("dex", 1)).toHaveText("3 (+1 · +50%)");
  expect(await color(cell("dex", 1).locator("[data-change]"))).toBe(rgb("#85C76B"));
  await expect(cell("range", 0)).toHaveText("0");
  await expect(cell("range", 1)).toHaveText("+50 (+50)");
  await expect(cell("range", 2)).toHaveText("+30 (+30)");
  await expect(cell("int", 1)).toHaveText("0");
  await expect(cell("int", 1).locator("[data-change]")).toHaveCount(0);
  for (const key of ["attack", "dex", "range", "int", "stat"]) await expect(cell(key, 0).locator("[data-change]")).toHaveCount(0);
  // The old rows printed raw keys, which CSS capitalized.
  for (const raw of ["attack", "dex", "int", "damage type", "wtype"]) await expect(table.locator("tbody th", { hasText: new RegExp(`^${raw}$`) })).toHaveCount(0);

  // 5: the type rows in the card's text and colors.
  await expect(cell("type", 0)).toHaveText("Weapon");
  await expect(cell("wtype", 0)).toHaveText("T1 Short Sword");
  await expect(cell("wtype", 1)).toHaveText("T2 Bow");
  await expect(cell("damage_type", 0)).toHaveText("Physical");
  await expect(cell("damage_type", 2)).toHaveText("Magical");
  expect(await color(cell("damage_type", 0).locator("[data-value]"))).toBe(rgb("#93AB98"));
  await expect(cell("ability", 2)).toContainText("Freeze");
  await expect(cell("ability", 2)).toContainText("Freezes the opponent with a 2% chance.");
  expect(await color(cell("ability", 2).locator("[data-value]"))).toBe(rgb("#2EBCE2"));

  // 6: the game card's box.
  const body = await table.locator("tbody").evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, border: style.borderTopWidth, borderColor: style.borderTopColor, font: style.fontFamily };
  });
  expect(body).toEqual({ background: "rgb(0, 0, 0)", border: "5px", borderColor: rgb("#808080"), font: expect.stringContaining("monospace") });

  // 7: each stat lines up across the columns.
  for (const key of ["type", "ability", "dex", "attack", "range"]) {
    const tops = await row(key).locator("th, td").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
  }
  await info.attach("catalog-comparison-wide", { body: await dialog.screenshot(), contentType: "image/png" });

  // 9: A's preview level moves A's value and every difference.
  await dialog.getByRole("group", { name: "A Blade preview level", exact: true }).getByRole("slider").focus();
  await page.keyboard.press("ArrowRight");
  await expect(cell("attack", 0)).toHaveText("36");
  await expect(cell("attack", 1)).toHaveText("25 (-11 · -30.556%)");
  await expect(cell("attack", 2)).toHaveText("18 (-18 · -50%)");

  // 10: on a narrow viewport the table scrolls inside its box, not the dialog.
  await page.setViewportSize({ width: 420, height: 1000 });
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await info.attach("catalog-comparison-narrow", { body: await dialog.screenshot(), contentType: "image/png" });
});

test("every catalog comparison column shows its item's sprite", async ({ page, app }, info) => {
  const dialog = await openComparison(page, app);
  const headers = dialog.getByRole("table").locator("thead th[scope=col]");
  await expect(headers).toHaveCount(4);
  // 11: A's sprite comes from its meta; B and C carry theirs on the catalog entry only.
  for (let column = 1; column <= 3; column++) {
    const sprite = headers.nth(column).locator('span[aria-hidden="true"]');
    await expect(sprite).toHaveCount(1);
    expect(await sprite.evaluate((node) => getComputedStyle(node).backgroundImage)).toContain("data:image/svg+xml");
    const box = (await sprite.boundingBox())!, frame = (await sprite.locator("xpath=../..").boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([48, 48]);
    expect(box.x).toBeGreaterThanOrEqual(frame.x - 1);
    expect(box.y).toBeGreaterThanOrEqual(frame.y - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
  }
  await info.attach("catalog-comparison-sprites", { body: await dialog.getByRole("table").locator("thead").screenshot(), contentType: "image/png" });
});
