/** Browser evidence for real shortcut components and the co-built production filter gallery. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

import { STUDIO_FILTER_DIALOG_CATALOG } from "../apps/web/src/domains/creator/filter/studio-filter-catalog";

import { findFreePort, spawnVitePreview, stopChildProcess, waitForServer } from "./lib/studio-verify-preview-harness.mjs";

import type { Page } from "playwright";

const output = process.env.STUDIO_DISCOVERY_QA_DIR ?? "/tmp/studio-discovery-ux";
mkdirSync(output, { recursive: true });
const html = "studio-discovery-qa.html";
const entry = "studio-discovery-qa.tsx";
const runtimeErrors: string[] = [];
const receipt: { checks: string[]; runtimeErrors: string[]; screenshots: string[]; failure?: string } = { checks: [], runtimeErrors, screenshots: [] };
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const devPort = await findFreePort();
const previewPort = await findFreePort();
const devOrigin = `http://127.0.0.1:${devPort}`;
const previewOrigin = `http://127.0.0.1:${previewPort}`;
writeFileSync(html, '<!doctype html><html lang="ko" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/studio-discovery-qa.tsx"></script></body></html>');
writeFileSync(entry, `
import {useState} from "react";
import {createRoot} from "react-dom/client";
import "../apps/web/src/styles/globals.css";
import {StudioSubToolPalette} from "../apps/web/src/domains/creator/brush/StudioSubToolPalette";
import {studioSubToolPaletteCategoryIdForBrushId} from "../apps/web/src/domains/creator/brush/studio-sub-tool-palette-data";
function App(){
  const [category,setCategory]=useState("pen");
  const [selected,setSelected]=useState("gpen");
  return <main className="min-h-screen bg-panel p-2 text-fg"><div style={{maxWidth:360,margin:"0 auto"}}>
    <h1 className="mb-3 text-base font-semibold">브러시 선택 검증</h1>
    <StudioSubToolPalette activeCategory={category} activeSubToolId={selected} onCategoryChange={setCategory}
      onSelectSubTool={id=>{setSelected(id);setCategory(studioSubToolPaletteCategoryIdForBrushId(id)??"pen");}} />
    <output data-selected={selected} className="mt-2 block text-xs">선택 ID: {selected}</output>
  </div></main>;
}
createRoot(document.getElementById("root")!).render(<App/>);
`);
const dev = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(devPort), "--strictPort"], { stdio: "ignore" });
const preview = spawnVitePreview({ port: previewPort, runner: "node-vite-bin", logPath: join(output, "preview.log") });

function watch(page: Page) {
  page.setDefaultTimeout(15_000);
  page.on("pageerror", error => runtimeErrors.push(error.stack ?? error.message));
}
async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: join(output, name), fullPage: true, animations: "disabled" });
  receipt.screenshots.push(name);
}
async function assertNoOverflow(page: Page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "horizontal document overflow");
}

try {
  await Promise.all([waitForServer(devOrigin), waitForServer(previewOrigin)]);
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    watch(page);
    await page.goto(`${devOrigin}/${html}`, { waitUntil: "networkidle" });
    const palette = page.locator('[data-studio-subtool-palette="true"]');
    await palette.waitFor({ state: "visible" });
    assert.equal(await palette.getByRole("tab").count(), 6);
    assert.equal(await palette.getByRole("option").count(), 3);
    const firstTab = palette.getByRole("tab").first();
    await firstTab.focus();
    await firstTab.press("ArrowRight");
    assert.equal(await page.locator("[data-selected]").getAttribute("data-selected"), "gpen");
    await page.keyboard.press("Enter");
    assert.equal(await palette.getByRole("tab", { name: "연필·목탄", exact: true }).getAttribute("aria-selected"), "true");
    const search = palette.getByRole("searchbox");
    await search.fill("스플래터(흩뿌리기)");
    assert.equal(await palette.getByRole("option").count(), 1);
    await search.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("[data-selected]").getAttribute("data-selected"), "splatter");
    await search.focus();
    await search.press("Escape");
    assert.equal(await search.inputValue(), "");
    await palette.getByRole("tab", { name: "채색·물감", exact: true }).click();
    assert.equal(await palette.getByRole("option").count(), 4);
    for (const target of await palette.locator('[role="option"], [role="tab"], input').all()) {
      const box = await target.boundingBox();
      assert(box && box.height >= 44, "touch target height below 44px");
    }
    await assertNoOverflow(page);
    await screenshot(page, `palette-${width}-dark.png`);
    await page.locator("html").evaluate(element => element.classList.remove("dark"));
    await screenshot(page, `palette-${width}-light.png`);
    await search.fill("NO-MATCH-zzzz");
    assert.equal(await palette.getByRole("option").count(), 0);
    assert.equal(await page.locator("[data-selected]").getAttribute("data-selected"), "splatter");
    await palette.getByRole("button", { name: "브러시 검색 지우기" }).click();
    assert.equal(await search.inputValue(), "");
    receipt.checks.push(`${width}px: keyboard, legacy search, exact-ID selection, empty/reset, 44px targets, dark/light, no horizontal overflow`);
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  watch(page);
  await page.addInitScript({ content: `globalThis.__name ??= fn=>fn; localStorage.setItem("toonspectrum-studio-quick-start-dismissed","1");localStorage.setItem("toonspectrum-studio-mobile-hint-dismissed","1");` });
  await page.goto(`${previewOrigin}/studio`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator('[data-studio-editor="true"]').waitFor({ state: "visible", timeout: 45_000 });
  const dismiss = page.locator('[data-studio-quickstart-dismiss="true"]');
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
  await page.keyboard.press("Escape");
  const pen = page.locator('button[data-studio-rail-tool-id="pen"]');
  await pen.first().click();
  const properties = page.locator('[data-studio-inspector-primary-tab="properties"]');
  if (await properties.isVisible().catch(() => false)) await properties.click();
  const trigger = page.locator('[data-studio-drawing-palette-icon-trigger="sub-tools"]');
  await trigger.click();
  const actualPalette = page.locator('[data-studio-subtool-palette="true"]');
  await actualPalette.waitFor({ state: "visible" });
  await actualPalette.getByRole("searchbox").fill("물감 튀김");
  await actualPalette.getByRole("option", { name: "물감 튀김" }).click();
  await screenshot(page, "studio-palette-integration.png");
  await page.keyboard.press("Escape");
  // An actual document stroke makes the image-filter dialog applicable.
  const viewport = await page.locator("[data-studio-canvas-viewport]").boundingBox();
  assert(viewport, "canvas viewport unavailable");
  const x = viewport.x + viewport.width * 0.48;
  const y = viewport.y + viewport.height * 0.45;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) await page.mouse.move(x + i * 4, y + Math.sin(i / 4) * 25);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const nav = page.locator('[data-studio-main-menu="true"]');
  await nav.locator('[data-studio-main-menu-trigger="filter"]').click();
  await page.locator('[data-studio-main-menu-panel="true"] [data-studio-menu-item-id="gaussian-blur"]').click();
  const dialog = page.locator('[aria-labelledby="studio-filter-dialog-title"]');
  await dialog.waitFor({ state: "visible" });
  const filterSearch = dialog.getByRole("searchbox", { name: "필터 검색" });
  if (!await filterSearch.isVisible().catch(() => false)) await dialog.getByRole("button", { name: /다른 필터 둘러보기/ }).click();
  await dialog.getByRole("radio", { name: "빛·렌즈", exact: true }).click();
  const expectedLights = STUDIO_FILTER_DIALOG_CATALOG.filter(entry => entry.group === "light").length;
  assert.equal(await dialog.locator("[data-studio-filter-gallery-card]").count(), expectedLights);
  await screenshot(page, "studio-filter-light-category.png");
  await filterSearch.fill("볼류메트릭 광선");
  assert.equal(await dialog.locator("[data-studio-filter-gallery-card]").count(), 1);
  await dialog.locator('[data-studio-filter-gallery-card="god-rays"]').click();
  await screenshot(page, "studio-filter-legacy-search.png");
  await assertNoOverflow(page);
  receipt.checks.push("production build: real inspector palette, document stroke, filter gallery light group, old filter name search, exact-kind selection");
  await context.close();
  assert.equal(runtimeErrors.length, 0, runtimeErrors.join("\n"));
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  receipt.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  for (const [index, page] of browser.contexts().flatMap((context) => context.pages()).entries()) {
    await screenshot(page, `failure-${index}.png`).catch(() => undefined);
    writeFileSync(join(output, `failure-${index}.html`), await page.content().catch(() => ""));
  }
  throw error;
} finally {
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  await browser.close();
  stopChildProcess(dev);
  stopChildProcess(preview);
  rmSync(html, { force: true });
  rmSync(entry, { force: true });
}
