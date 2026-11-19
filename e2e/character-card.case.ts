import { test, expect } from "./fixtures";
import { mountComponent, color, rgb } from "./fixtures/component-harness";
import type { Locator } from "@playwright/test";
import { readFileSync } from "node:fs";

// Failure inventory: docs/character-card.md. Character telemetry is a declared
// boundary; the maintained CharacterStatsDialog runs in Chromium with the console styles.

const patinder = {
  name: "Patinder", ctype: "merchant", primaryStat: "int", level: 61, hp: 4760, max_hp: 4760, mp: 2120, max_mp: 2700,
  attack: 33.4, frequency: 0.73, range: 82, speed: 10, unrestrictedSpeed: 82.1, standOpen: true, armor: 277, resistance: 500,
  str: 23, int: 110, dex: 99, vit: 50, fortitude: 15, luck: 100, xp: 0, max_xp: 1, gold: 0, map: "main", x: 0, y: 0, rip: false,
  banking: false, seenAt: 0, items: [], conditions: [], goldBonus: 123.45,
  slots: { mainhand: { item: { name: "dartgun" }, meta: { definition: {}, properties: { attack: 48 }, sprite: null } } },
  combatStats: { crit: 1.5, critDamage: 20, lifesteal: 2, evasion: 3, armorPiercing: 10, fireResistance: 4 },
};

test("character stats show the game's panel beside collapsible extras", async ({ page, app }, info) => {
  const open = await mountComponent(page, app, "character-card-harness", `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {CharacterStatsDialog} from './features/party/character-stats-dialog';
    const root=createRoot(document.getElementById('root'));
    window.mountCharacter=(character)=>root.render(character ? <CharacterStatsDialog character={character} onOpenChange={()=>root.render(null)}/> : null);
  `);
  const mount = async (character: unknown) => {
    await page.evaluate(() => (window as any).mountCharacter(null));
    await page.evaluate((value) => (window as any).mountCharacter(value), character);
  };
  await mount(patinder);
  const dialog = page.getByRole("dialog", { name: "Patinder", exact: true });
  const card = dialog.getByRole("region", { name: "Character card", exact: true });
  const extras = dialog.getByRole("region", { name: "Character extras", exact: true });
  await expect(extras.locator('[data-line="gold"]')).toHaveText('Gold: +123.45%');
  expect(await color(extras.locator('[data-line="gold"] [data-label]'))).toBe(rgb('#FFD700'));

  // 1: the game's panel, line for line, with RUNSPD as the live stand-limited speed.
  const lines = await card.locator("[data-line]").evaluateAll((nodes) => nodes.map((node) => node.textContent));
  expect(lines).toEqual(["NAME: Patinder", "LEVEL: 61", "HP: 4760/4760", "MP: 2120/2700", "ATT: 33", "ATTSPD: 73", "RANGE: 82",
    "RUNSPD: 10", "ARMOR: 277", "RESIST.: 500", "CODE: Active"]);
  const label = (box: Locator, key: string) => color(box.locator(`[data-line="${key}"] [data-label]`).first());
  expect(await label(card, "level")).toBe("rgb(255, 165, 0)");
  expect(await label(card, "hp")).toBe(rgb("#FF2E46"));
  expect(await label(card, "mp")).toBe(rgb("#3A62CE"));
  expect(await label(card, "attack")).toBe(rgb("#DB2900"));
  expect(await label(card, "code")).toBe("rgb(255, 215, 0)");

  // 4, 5: every entry and effect of the old grid, each effect named and colored by its stat.
  const strength = extras.locator('[data-line="str"]');
  await expect(strength.getByRole("button", { name: /Strength: 23/ })).toHaveAttribute("aria-expanded", "true");
  await expect(strength.locator('[data-effect="max_hp"]')).toHaveText("+483 Max HP +21 per point");
  expect(await color(strength.locator('[data-effect="max_hp"] [data-value]'))).toBe(rgb("#FF2E46"));
  await expect(strength.locator('[data-effect="armor"]')).toHaveText("+23 Armor +1 per next point");
  expect(await color(strength.locator('[data-effect="armor"] [data-value]'))).toBe(rgb("#A3A9B0"));
  await expect(strength.locator('[data-effect="run_speed"]')).toHaveText("+0.36 Run Speed +0.0156 per next point");
  const intelligence = extras.locator('[data-line="int"]');
  await expect(intelligence.getByRole("button", { name: /Intelligence: 110 Primary/ })).toBeVisible();
  await expect(intelligence.locator('[data-effect="attack"]')).toHaveText("+264.0 Attack +2.40 per point");
  await expect(intelligence.locator('[data-effect="max_mp"]')).toHaveText("+1,650 Max MP +15 per point");
  await expect(intelligence.locator('[data-effect="resistance"]')).toHaveText("+110 Resistance +1 per next point");
  await expect(intelligence.locator('[data-effect="attack_speed"]')).toHaveText("+0.070 Attacks/sec +0.000635 per point");
  await expect(extras.locator('[data-line="dex"] [data-effect="run_speed"]')).toHaveText("+3.09 Run Speed +0.0313 per next point");
  await expect(extras.locator('[data-line="vit"] [data-effect="max_hp"]')).toHaveText("+3,417 Max HP 68.33 HP per VIT at level 61");
  await expect(extras.locator('[data-line="for"] [data-effect="pvp"]')).toHaveText("7.50% less incoming PvP damage no PvE reduction");
  await expect(extras.locator('[data-line="armor"] [data-effect="reduction"]')).toHaveText("27.32% physical damage reduction a 100-damage physical hit becomes 72.7");
  await expect(extras.locator('[data-line="resistance"] [data-effect="reduction"]')).toHaveText("46.70% magical damage reduction a 100-damage magical hit becomes 53.3");
  await expect(extras.locator('[data-line="run_speed"]')).toHaveText("Run Speed: 82.10 before movement restrictions");
  for (const [key, text] of [["luck", "Luck: 100%"], ["crit", "Crit: 1.5%"], ["critdamage", "Crit Damage: 220%"], ["lifesteal", "Lifesteal: 2%"],
    ["evasion", "Evasion: 3%"], ["apiercing", "A.Piercing: 10"], ["firesistance", "Fire Res.: 4"], ["miss", "Miss: 0%"], ["manasteal", "Manasteal: 0%"],
    ["rpiercing", "R.Piercing: 0"], ["pnresistance", "Poison Res.: 0"], ["fzresistance", "Freeze Res.: 0"], ["phresistance", "Physical Res.: 0"],
    ["stresistance", "Status Res.: 0"], ["blastresistance", "Blast Res.: 0"], ["dreturn", "D.Return: 0%"], ["reflection", "Reflection: 0%"],
    ["mp_cost", "MP Cost: 0"], ["heal", "Heal: 0"], ["output", "Output: 0%"]] as const)
    await expect(extras.locator(`[data-line="${key}"]`)).toHaveText(text);
  expect(await label(extras, "lifesteal")).toBe(rgb("#C8323E"));

  // 7: side by side on a wide dialog.
  const cardBox = (await card.boundingBox())!, extrasBox = (await extras.boundingBox())!;
  expect(extrasBox.x).toBeGreaterThanOrEqual(cardBox.x + cardBox.width - 1);
  expect(Math.abs(extrasBox.y - cardBox.y)).toBeLessThan(2);
  await info.attach("character-card-wide", { body: await dialog.screenshot(), contentType: "image/png" });

  // 6: a collapse persists across characters and reloads.
  await strength.getByRole("button", { name: /Strength: 23/ }).click();
  await expect(strength.getByRole("button", { name: /Strength: 23/ })).toHaveAttribute("aria-expanded", "false");
  await expect(strength.locator("[data-effect]")).toHaveCount(0);
  await expect(intelligence.locator("[data-effect]")).toHaveCount(4);
  await info.attach("character-card-strength-collapsed", { body: await dialog.screenshot(), contentType: "image/png" });

  // 2, 3: a cursed, poisoned priest shows HEAL and the game's tags; Strength stays collapsed.
  await mount({ ...patinder, name: "Recharged", ctype: "priest", primaryStat: "int", speed: 55, unrestrictedSpeed: null, standOpen: false,
    combatStats: { heal: 320 }, conditions: [{ id: "cursed", name: "Cursed", definition: {}, live: {} }, { id: "poisoned", name: "Poisoned", definition: {}, live: {} }] });
  const priest = page.getByRole("dialog", { name: "Recharged", exact: true });
  const priestCard = priest.getByRole("region", { name: "Character card", exact: true });
  const priestLines = await priestCard.locator("[data-line]").evaluateAll((nodes) => nodes.map((node) => node.textContent));
  expect(priestLines.slice(3, 7)).toEqual(["MP: 2120/2700", "HEAL: 320", "ATT: 33 [C]", "ATTSPD: 73 [P]"]);
  expect(await label(priestCard, "heal")).toBe(rgb("#CB83AC"));
  const priestStrength = priest.getByRole("region", { name: "Character extras", exact: true }).locator('[data-line="str"]');
  await expect(priestStrength.getByRole("button", { name: /Strength: 23/ })).toHaveAttribute("aria-expanded", "false");
  await expect(priestStrength.locator("[data-effect]")).toHaveCount(0);

  // 6: the choice survives a reload, and expanding is remembered the same way.
  await open();
  await mount(patinder);
  const reloaded = page.getByRole("dialog", { name: "Patinder", exact: true }).getByRole("region", { name: "Character extras", exact: true });
  const reloadedStrength = reloaded.getByRole("button", { name: /Strength: 23/ });
  await expect(reloadedStrength).toHaveAttribute("aria-expanded", "false");
  await reloadedStrength.click();
  await open();
  await mount(patinder);
  await expect(page.getByRole("dialog", { name: "Patinder", exact: true }).getByRole("region", { name: "Character extras", exact: true })
    .getByRole("button", { name: /Strength: 23/ })).toHaveAttribute("aria-expanded", "true");

  // 8: a merchant with an open stand and no unrestricted speed still says so.
  await mount({ ...patinder, unrestrictedSpeed: null });
  await expect(page.getByRole("dialog", { name: "Patinder", exact: true }).getByRole("region", { name: "Character extras", exact: true })
    .locator('[data-line="run_speed"]')).toHaveText("Run Speed: Waiting for speed data");

  // 7: stacked on a narrow viewport, without sideways scrolling.
  await page.setViewportSize({ width: 420, height: 1000 });
  const narrow = page.getByRole("dialog", { name: "Patinder", exact: true });
  const narrowCard = (await narrow.getByRole("region", { name: "Character card", exact: true }).boundingBox())!;
  const narrowExtras = (await narrow.getByRole("region", { name: "Character extras", exact: true }).boundingBox())!;
  expect(narrowExtras.y).toBeGreaterThanOrEqual(narrowCard.y + narrowCard.height - 1);
  expect(await narrow.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await info.attach("character-card-narrow", { body: await narrow.screenshot(), contentType: "image/png" });

  // The gold line shows the character's own reported bonus, signed, in percent,
  // as Ryan's `Gold: +123.45%`; the dialog computes nothing.
  await page.setViewportSize({ width: 1400, height: 1000 });
  await mount({ ...patinder, goldBonus: 123.45 });
  await expect(page.getByRole("dialog", { name: "Patinder", exact: true }).locator('[data-line="gold"]')).toContainText("+123.45%");
  await mount({ ...patinder, goldBonus: -5 });
  await expect(page.getByRole("dialog", { name: "Patinder", exact: true }).locator('[data-line="gold"]')).toContainText("-5%");
});

// The merchant card's gathering rows follow the merchant jobs owner's ready jobs, and the stand's
// fullness reads the items owner's count from the core section's `standSlots`, not a count of its own.
test("the merchant card's gathering rows and stand fullness read their owners' answers", async ({ page, app }) => {
  await mountComponent(page, app, "component-harness", `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {QueryClientProvider} from '@tanstack/react-query';
    import {createDashboardClient} from './features/party/query-cache';
    import {MerchantCardControls} from './features/party/merchant-card-controls';
    import {standIsFull, standFullMessage} from './features/party/stand-capacity';
    const root=createRoot(document.getElementById('root')), client=createDashboardClient(), none=async()=>{};
    window.stand={standIsFull, standFullMessage};
    window.mount=(state)=>root.render(<QueryClientProvider client={client}><MerchantCardControls state={state}
      collectionSettings={{onClearErrors(){},threshold:'',onThresholdChange(){},onThresholdSave:none,itemCollectionThreshold:'',onItemCollectionThresholdChange(){},onItemCollectionThresholdSave:none}}
      onBank={none} onClear={none} onForceStand={none} onCancelJob={none} onRoutines={()=>{}} onGather={none} onBuy={()=>{}} onCraft={()=>{}}
      onExchange={()=>{}} onDonate={()=>{}} onGiveaway={()=>{}}/></QueryClientProvider>);
  `, null);
  await page.evaluate(() => (window as any).mount({
    characters: { M: { name: "M", ctype: "merchant", items: [], gatheringCooldowns: {} } }, merchantCharacter: "M",
    gatheringModes: ["fishing", "mining"], merchantRoutinePriorities: {},
    merchantQueue: [{ id: "f1", reason: "fishing", priority: 5 }, { id: "m1", reason: "mining", priority: 5 }],
    merchantReady: [{ id: "f1", reason: "fishing", target: "", priority: 5, realm: null }],
  }));
  await page.getByText(/Merchant logistics · 2 queued/).click();
  const status = (job: RegExp) => page.locator("div").filter({ hasText: job }).filter({ has: page.locator("span.max-w-32") }).last().locator("span.max-w-32");
  // The ready fishing job is queued; mining, which the merchant jobs owner's plan has not listed ready, is held with
  // the merchant jobs owner's reason.
  await expect(status(/Fishing/i)).toHaveText("queued");
  await expect(status(/Mining/i)).toHaveText("BLOCKED");
  await expect(status(/Mining/i)).toHaveAttribute("title", "Not ready in the merchant's plan");
  // Full only at the items owner's count of free slots; before the first core answer nothing is full.
  const stand = (slots: unknown) => page.evaluate((slots) => {
    const { standIsFull, standFullMessage } = (window as any).stand;
    return [standIsFull({ standSlots: slots }), standFullMessage({ standSlots: slots })];
  }, slots);
  expect(await stand({ slots: 20, free: 0 })).toEqual([true, "Merchant stand is full (20/20)"]);
  expect((await stand({ slots: 20, free: 1 }))[0]).toBe(false);
  expect((await stand(null))[0]).toBe(false);
});

// A pending Steam primary card offers Ryan 1.5's recovery (f48dfabb8,
// aac30d45 pending-character-cards.tsx): a retry of the Steam connection, the /setup link and,
// after a failed handoff, its recovery. A handoff in flight disables the retry. Each press goes
// through the model's roster actions, whose requests the action client sends (use-party-console.tsx
// `post`).
test("a pending primary card offers its Steam recovery through the model's actions", async ({ page, app }) => {
  await mountComponent(page, app, "component-harness", `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {PendingCharacterCards} from './features/party/pending-character-cards';
    const root=createRoot(document.getElementById('root'));
    window.calls=[];
    window.mount=(state)=>root.render(<PendingCharacterCards model={{chars:[],state,
      switchSteam:async(name)=>{window.calls.push(['switchSteam',name]);},
      recoverSteamHandoff:async()=>{window.calls.push(['recoverSteamHandoff']);}}}/>);
  `, null);
  const mount = (state: unknown) => page.evaluate((state) => (window as any).mount(state), state);
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Primary", exact: true }) });
  const retry = card.getByRole("button", { name: "Retry Steam connection" });
  const recover = card.getByRole("button", { name: "Recover Steam handoff after characters are offline" });
  await mount({ characterConnections: [{ name: "Primary", status: "lost", primary: true, delayed: true }], activeSlots: [], roster: [] });
  await retry.click();
  await expect(card.getByRole("link", { name: "Open connection setup" })).toHaveAttribute("href", "/setup");
  await expect(recover).toHaveCount(0);
  await mount({ characterConnections: [{ name: "Primary", status: "loading", primary: true, delayed: true }], activeSlots: [], roster: [],
    steamSwitch: { phase: "failed" } });
  await expect(retry).toBeDisabled();
  await recover.click();
  expect(await page.evaluate(() => (window as any).calls)).toEqual([["switchSteam", "Primary"], ["recoverSteamHandoff"]]);
  // A handoff in flight holds the retry; a companion's card and a headless primary's show no control.
  await mount({ characterConnections: [{ name: "Primary", status: "loading", primary: true, delayed: true }], activeSlots: [], roster: [],
    steamSwitch: { phase: "switching" } });
  await expect(retry).toBeDisabled();
  await expect(recover).toHaveCount(0);
  await mount({ characterConnections: [{ name: "Primary", status: "lost", primary: false, delayed: true }], activeSlots: [], roster: [] });
  await expect(card.getByRole("button")).toHaveCount(0);
  await mount({ characterConnections: [{ name: "Primary", status: "loading", primary: true, delayed: true }],
    activeSlots: [{ character: "Primary", kind: "headless", primary: true }], roster: [] });
  await expect(card.getByRole("button")).toHaveCount(0);
  // The model's two Steam actions send through `post`, the action client.
  const model = readFileSync("dashboard/features/party/use-party-console.tsx", "utf8");
  for (const [name, route] of [["switchSteam", "/steam/action"], ["recoverSteamHandoff", "/steam/recover"]])
    expect(model).toMatch(new RegExp(`async function ${name}\\([^)]*\\) \\{\\s*try \\{\\s*await post\\("${route}"`));
});

// Each of the card's combat lines writes its owner's field
// through the settings route, and the settings owner's check refuses a value out of range with nothing saved. The
// merchant's card has no heal line and no reflect lists.
test("the card's combat lines write their owners' fields and stay inside 11's checks", async ({ page, app }) => {
  const value = async (field: string) => {
    const page_ = await (await page.request.get(app.url + "/party-api/settings")).json();
    return (page_.settings as { field: string; value: any }[]).find((entry) => entry.field === field)?.value?.W;
  };
  await page.goto(app.url);
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "W", exact: true }) });
  for (const [label, field, typed, saved] of [
    ["Heal first below (% HP)", "healFirstBelow", "65", 65],
    ["HP potion below (% HP)", "hpPotionBelow", "40", 40],
    ["MP potion below (% MP)", "mpPotionBelow", "25", 25],
    // A reflect list holds only monsters game data rates for it, reflection or dreturn above 0
    // (runtime/characters/targeting/reflect.ts `reflectCheck`, d9edc4b6e).
    ["Don't hit with magic (monster ids)", "reflectMagicByCharacter", "slenderman", ["slenderman"]],
    ["Don't hit with physical (monster ids)", "reflectPhysicalByCharacter", "porcupine", ["porcupine"]],
  ] as const) {
    const box = card.getByLabel(`${label} for W`, { exact: true });
    await expect(box).toBeEnabled();
    await box.fill(typed);
    await box.press("Enter");
    await expect.poll(() => value(field), { message: field }).toEqual(saved);
  }
  // The settings owner's check: 1 to 100 for a line; the refusal shows and the saved value stays.
  const heal = card.getByLabel("Heal first below (% HP) for W", { exact: true });
  await heal.fill("150");
  await heal.press("Enter");
  await expect(card.getByRole("alert").filter({ hasText: /./ })).toBeVisible();
  expect(await value("healFirstBelow")).toBe(65);
  const merchant = page.locator("article").filter({ has: page.getByRole("heading", { name: "M", exact: true }) });
  await expect(merchant.getByLabel("Heal first below (% HP) for M", { exact: true })).toHaveCount(0);
  await expect(merchant.getByLabel("Don't hit with magic (monster ids) for M", { exact: true })).toHaveCount(0);
  await expect(merchant.getByLabel("HP potion below (% HP) for M", { exact: true })).toBeVisible();
});
