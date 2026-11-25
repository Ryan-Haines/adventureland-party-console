import { test, expect } from "./fixtures";
import { mountComponent, color, rgb } from "./fixtures/component-harness";
import { comparisonSource, staffForWand } from "./fixtures/comparison-equipment";
import type { Locator } from "@playwright/test";

// Failure inventory: docs/comparison-card.md. Game metadata is a declared boundary;
// the maintained GearComparisonDialog runs in Chromium with the console styles.
const ROWS = ["HP", "MP", "Attack", "Attack speed", "Range", "Run speed", "Armor", "Resistance", "STR", "INT", "DEX", "VIT",
  "Fortitude", "Luck", "Gold", "XP", "Evasion", "Reflection", "Lifesteal", "Manasteal", "Armor piercing", "Resistance piercing",
  "Critical hit", "Damage return", "MP cost reduction", "Output"];

test("equipment comparison shows each panel's stats in the game card style", async ({ page, app }, info) => {
  await mountComponent(page, app, "comparison-card-harness", comparisonSource);
  await page.evaluate((value) => (window as any).mountComparison(value), staffForWand);
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
