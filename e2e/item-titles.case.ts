import { test, expect } from "./fixtures";
import type { Locator } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { openComparison, weapon } from "./catalog-comparison.case";

// Failure inventory: docs/item-titles.md. Game metadata, including G.titles on the
// copy's meta, is a declared boundary; the maintained ItemDetails, GearComparisonDialog
// and Equipment catalog dialog run in Chromium with the console styles.
const line = (box: Locator, key: string) => box.locator(`[data-line="${key}"]`);
const blade = (p: string, properties?: Record<string, number>) => ({
  item: { name: "blade", level: 7, p },
  meta: weapon({ name: "Blade", wtype: "short_sword", tier: 1, attack: 20 },
    { upgradeable: true, scaling: { attack: 4 }, maxLevel: 12, ...(properties ? { properties } : {}), sprite: null,
      title: p === "shiny" ? { type: "all_items", improve: true, source: "random", title: "Shiny" } : undefined }),
});

test("item titles name the copy and add the game's title stats", async ({ page, app }, info) => {
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
    import {GearComparisonDialog} from './features/party/gear-comparison-dialog';
    const root=createRoot(document.getElementById('root'));
    const noop=()=>{};
    window.show=(kind,value)=>root.render(null)||setTimeout(()=>root.render(
      kind==='item'?<ItemDetails selected={value} catalog={[]} exchanges={[]} skills={[]} monsters={[]} characters={[]} achievements={{}} standFull={false}
        onNavigate={noop} onAddWTB={noop} onAddStand={noop} onCompare={noop} onCompareCatalog={noop} onOpenChange={noop}/>:
      <GearComparisonDialog comparison={value} onOpenChange={noop}/>),0);
  `,
    },
  });
  await page.goto(app.url);
  await expect(page.locator("body")).toContainText("Party");
  const styles = await page.locator('style, link[rel="stylesheet"]').evaluateAll((nodes) => nodes.map((node) => node.outerHTML).join("\n"));
  await page.route("**/item-titles-harness", (route) =>
    route.fulfill({ contentType: "text/html", body: `<!doctype html><head>${styles}</head><body><div id="root"></div></body>` }));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(app.url + "/item-titles-harness");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const item = async (name: string, entry: unknown) => {
    await page.evaluate((value) => (window as any).show("item", value), { character: "W", entry: { slot: 1, ...(entry as object) } });
    const dialog = page.getByRole("dialog", { name, exact: true });
    await expect(dialog).toBeVisible();
    return {
      dialog,
      card: dialog.getByRole("region", { name: "Item card", exact: true }),
      extras: dialog.getByRole("region", { name: "Item extras", exact: true }),
    };
  };

  // 1, 2: the shiny Blade +7 by name, with 49 attack from its levels plus 4.
  const shiny = await item("Shiny Blade +7", blade("shiny"));
  await expect(line(shiny.card, "attack")).toHaveText("Damage: 53");
  await expect(line(shiny.extras, "title")).toHaveText("Title: Shiny");
  expect(await line(shiny.extras, "title").locator("[data-label]").evaluate((node) => getComputedStyle(node).color)).toBe("rgb(255, 215, 0)");
  await info.attach("item-titles-shiny-blade", { body: await shiny.dialog.screenshot(), contentType: "image/png" });
  // 2: a two-handed type gains 7.
  const axe = await item("Shiny Axe", { item: { name: "axe", level: 0, p: "shiny" },
    meta: weapon({ name: "Axe", wtype: "axe", attack: 30 }, { sprite: null }) });
  await expect(line(axe.card, "attack")).toHaveText("Damage: 37");

  // 3: no attack. A base stat gains 2 and follows the stat scroll; armor gains 12 armor and 10 resistance;
  // anything else gains 1 Dexterity, Intelligence and Strength.
  const cape = await item("Shiny Cape", { item: { name: "cape", level: 0, p: "shiny", stat_type: "dex" },
    meta: { definition: { name: "Cape", type: "cape", stat: 3, armor: 10, scroll: true }, usage: { classes: [], hands: [] }, sprite: null } });
  await expect(line(cape.card, "dex")).toHaveText("Dexterity: 5");
  await expect(line(cape.card, "armor")).toHaveText("Armor: 10");
  const helmet = await item("Shiny Helmet", { item: { name: "helmet", level: 0, p: "shiny" },
    meta: { definition: { name: "Helmet", type: "helmet", armor: 10 }, usage: { classes: [], hands: [] }, sprite: null } });
  await expect(line(helmet.card, "armor")).toHaveText("Armor: 22");
  await expect(line(helmet.card, "resistance")).toHaveText("Resistance: 10");
  const earring = await item("Shiny Earring", { item: { name: "earring", level: 0, p: "shiny" },
    meta: { definition: { name: "Earring", type: "earring", luck: 2 }, usage: { classes: [], hands: [] }, sprite: null } });
  for (const [key, text] of [["str", "Strength: 1"], ["int", "Intelligence: 1"], ["dex", "Dexterity: 1"]] as const)
    await expect(line(earring.card, key)).toHaveText(text);

  // 4: another title adds its stat fields from G.titles.
  const bow = await item("Super Fast Bow", { item: { name: "bow", level: 0, p: "superfast" },
    meta: weapon({ name: "Bow", wtype: "bow", attack: 25 },
      { sprite: null, title: { type: "weapon", frequency: 20, source: "upgrade", misc: true, title: "Super Fast" } }) });
  await expect(line(bow.card, "frequency")).toHaveText("A.Speed: 20");
  await expect(line(bow.extras, "title")).toHaveText("Title: Super Fast");

  // 5: glitched names the copy and notes its random stat without inventing one.
  const ring = await item("Glitched Ring", { item: { name: "ring", level: 0, p: "glitched" },
    meta: { definition: { name: "Ring", type: "ring", int: 3 }, usage: { classes: [], hands: [] }, sprite: null,
      title: { type: "all_items", random_stat: 1, source: "exchanges", title: "Glitched" } } });
  await expect(line(ring.extras, "title")).toHaveText("Title: Glitched (+1 Dexterity, Intelligence or Strength at random)");
  await expect(line(ring.card, "int")).toHaveText("Intelligence: 3");
  for (const key of ["str", "dex"]) await expect(line(ring.card, key)).toHaveCount(0);

  // 6: a live copy's reported properties already include the title.
  const live = await item("Shiny Blade +7", blade("shiny", { attack: 53 }));
  await expect(line(live.card, "attack")).toHaveText("Damage: 53");

  // 7: the equipment comparison names the shiny copy and adds its 4 attack over a plain Blade +7.
  const character = { name: "W", ctype: "warrior", level: 80, primaryStat: "str", str: 0, int: 0, dex: 0, vit: 0, hp: 1000, max_hp: 1000,
    mp: 100, max_mp: 100, attack: 600, armor: 0, resistance: 0, frequency: 1, speed: 30, range: 20,
    slots: { mainhand: { ...blade("", { attack: 49 }), item: { name: "blade", level: 7 } } }, items: [] };
  await page.evaluate((value) => (window as any).show("comparison", value), { character, slot: "mainhand", entry: { slot: 0, ...blade("shiny") } });
  const comparison = page.getByRole("dialog", { name: "Equipment comparison", exact: true });
  const proposed = comparison.getByRole("region", { name: "Proposed equipment", exact: true });
  await expect(proposed.getByText("Shiny Blade +7", { exact: true })).toBeVisible();
  await expect(comparison.getByRole("region", { name: "Equipped equipment", exact: true }).getByText("Blade +7", { exact: true })).toBeVisible();
  await expect(proposed.getByRole("group", { name: "Proposed stats", exact: true }).locator('[data-line="attack"]')).toHaveText("Attack: 604.0 (+4.0 · +0.7%)");
  await info.attach("item-titles-comparison", { body: await comparison.screenshot(), contentType: "image/png" });

  // 7: the catalog comparison's column A names the shiny Blade +3 and counts its 4 attack.
  const shinySource = { slot: 3, ...blade("shiny"), item: { name: "blade", level: 3, p: "shiny" } };
  const catalog = await openComparison(page, app, shinySource);
  await expect(catalog.getByRole("table").locator("thead th[scope=col]").nth(1)).toContainText("Shiny Blade");
  await expect(catalog.getByRole("group", { name: "A Shiny Blade preview level", exact: true })).toBeVisible();
  await expect(catalog.locator('tbody tr[data-row="attack"] td').first()).toHaveText("36");
  await info.attach("item-titles-catalog", { body: await catalog.screenshot(), contentType: "image/png" });
});
