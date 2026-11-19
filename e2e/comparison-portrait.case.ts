import { test, expect } from "./fixtures";
import { mountComponent } from "./fixtures/component-harness";

// Failure modes: a headless character reports no doll HTML (characters/shared.js
// characterDollHtml returns null without the game's sprite()), so the comparison
// header shows an empty box; a character with neither doll nor sprite shows a blank
// box and no skin name; doll HTML stops rendering once a sprite exists.
// The maintained dialog runs in Chromium, as in gear-comparison.case.ts.
test("equipment comparison shows a portrait for headless characters", async ({ page, app }) => {
  await mountComponent(page, app, "comparison-portrait-harness", `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {GearComparisonDialog} from './features/party/gear-comparison-dialog';
    const root=createRoot(document.getElementById('root'));
    window.mountComparison=(comparison)=>{root.render(null);root.render(<GearComparisonDialog comparison={comparison} onOpenChange={()=>root.render(null)}/>);};
  `, null);

  const gear = (name: string, properties: Record<string, number>) => ({
    item: { name, level: 0 },
    meta: { definition: { name, type: "weapon" }, properties, usage: { classes: [{ id: "warrior", hands: 1 }], hands: [1] }, world: {} },
  });
  const sprite = { url: "/sprite-sheet.png", tileSize: 32, columns: 12, rows: 8, x: 3, y: 0 };
  const character = (appearance: Record<string, unknown>) => ({
    name: "Sadokunn", ctype: "warrior", level: 80, primaryStat: "str", str: 100, int: 10, dex: 10, vit: 10,
    hp: 1000, max_hp: 1000, mp: 500, max_mp: 500, attack: 600, armor: 50, resistance: 100, frequency: 1, speed: 30, range: 30,
    slots: { mainhand: gear("blade", { attack: 100 }) }, items: [], ...appearance,
  });
  const mount = (appearance: Record<string, unknown>) =>
    page.evaluate(
      (value) => (window as any).mountComparison(value),
      { character: character(appearance), slot: "mainhand", entry: { slot: 0, ...gear("sword", { attack: 150 }) } },
    );
  const portrait = (side: string) =>
    page.getByRole("region", { name: side, exact: true }).locator("[data-comparison-portrait]");

  // 1: a headless character (sprite, no doll HTML) shows its sprite on both panels.
  await mount({ skin: "mbody1", characterSprite: sprite, characterDollHtml: null });
  for (const side of ["Equipped equipment", "Proposed equipment"]) {
    const image = await portrait(side).evaluate((node) =>
      [...node.querySelectorAll<HTMLElement>("span")].map((span) => span.style.backgroundImage).find(Boolean) || "",
    );
    expect(image).toContain("/sprite-sheet.png");
  }

  // 2: neither doll nor sprite falls back to the skin name.
  await mount({ skin: "mbody1", characterSprite: null, characterDollHtml: null });
  await expect(portrait("Equipped equipment")).toContainText("mbody1");

  // 3: doll HTML still wins when the game client reports it.
  await mount({
    skin: "mbody1",
    characterSprite: sprite,
    characterDollHtml: "<div style='width:54px;height:76px;position:relative'><img src='/doll-layer.png' style='max-width:none;width:648px;height:864px'/></div>",
  });
  await expect(portrait("Equipped equipment").locator("img")).toHaveAttribute("src", "/doll-layer.png");
});
