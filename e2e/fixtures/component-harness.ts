import { expect, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

// The component cases' shared harness: a dashboard component built from its source and drawn in
// the console's own styles, read through the colors the browser computes.
export const color = (locator: Locator) => locator.evaluate((node) => getComputedStyle(node).color);
export const rgb = (hex: string) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};

// mountComponent bundles `contents` (a tsx entry under dashboard/ that defines the case's window
// mount), copies the running console's styles into a page served at `name`, and opens it. The
// viewport defaults to the cards' 1400 x 1000; null keeps the page's own. It returns `open`, which
// loads the page and the bundle again for a case that starts over from an empty page.
export async function mountComponent(page: Page, app: { url: string }, name: string, contents: string,
  viewport: { width: number; height: number } | null = { width: 1400, height: 1000 }) {
  const bundle = await build({
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    tsconfig: path.resolve("dashboard/tsconfig.json"),
    stdin: { resolveDir: path.resolve("dashboard"), loader: "tsx", contents },
  });
  await page.goto(app.url);
  await expect(page.locator("body")).toContainText("Party");
  const styles = await page.locator('style, link[rel="stylesheet"]').evaluateAll((nodes) => nodes.map((node) => node.outerHTML).join("\n"));
  await page.route(`**/${name}`, (route) =>
    route.fulfill({ contentType: "text/html", body: `<!doctype html><head>${styles}</head><body><div id="root"></div></body>` }));
  if (viewport) await page.setViewportSize(viewport);
  const open = async () => {
    await page.goto(`${app.url}/${name}`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
  };
  await open();
  return open;
}

// A tab hidden or shown as the browser reports it: the document's hidden state and its
// visibilitychange event.
export const setHidden = (page: Page, hidden: boolean) => page.evaluate((value) => {
  Object.defineProperty(document, "hidden", { value, configurable: true });
  Object.defineProperty(document, "visibilityState", { value: value ? "hidden" : "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}, hidden);
