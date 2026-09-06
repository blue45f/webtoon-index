import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { chromium, type Page } from "playwright";

import { materializeStudioBrushCatalogSelection } from "../apps/web/src/domains/creator/brush/studio-brush-selection";
import { studioAutosaveKey } from "../apps/web/src/domains/creator/studio-autosave";

import { enabledStudioHistoryControl } from "./lib/studio-verify-history-controls.mjs";

const out = process.env.STUDIO_SESSION_EVIDENCE ?? "/tmp/studio-session-evidence";
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync("dist/.vite/manifest.json", "utf8"));
const storePath = `/${manifest["apps/web/src/domains/creator/studio-autosave-sqlite-store.ts"].file}`;
const ids = ["pen", "pencil", "pencil--side-shade", "inkwash-water-brush", "core-round", "flex-ink", "precision-pencil"];
const server = spawn("pnpm", ["exec", "vite", "preview", "--host", "127.0.0.1", "--port", "4179", "--strictPort"], { stdio: "ignore" });
const url = "http://127.0.0.1:4179/studio";
const records: unknown[] = [];
const browser = await chromium.launch({ headless: true });
async function stored(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(async ({ path, key }) => {
    const module = await import(/* @vite-ignore */ path);
    const row = await (await module.acquireStudioAutosaveSqliteStore()).read(key);
    const doc = row?.payload;
    const current = doc?.pagesList?.find((item: { id: string }) => item.id === doc.currentPageId) ?? doc?.pagesList?.[0];
    return current?.elements ?? [];
  }, { path: storePath, key: studioAutosaveKey({}) });
}
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await fetch(url).then((r) => r.ok).catch(() => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const locale of ["en-US", "ko-KR"]) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.addInitScript(() => {
      (globalThis as Record<string, unknown>).__name = (value: unknown) => value;
      localStorage.setItem("toonspectrum-studio-quick-start-dismissed", "1");
      localStorage.setItem("toonspectrum-studio-mobile-hint-dismissed", "1");
      localStorage.setItem("toonspectrum-studio-app-settings:v1", JSON.stringify({ general: { brushCursorStyle: "none" } }));
    });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.locator('[data-studio-editor="true"]').waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1_000);
      for (let index = 0; index < 3; index++) await page.keyboard.press("Escape");
      for (const id of ids) {
        const expected = await materializeStudioBrushCatalogSelection(id);
        if (!expected) throw new Error(`Missing catalogue ${id}`);
        await page.locator('[data-studio-rail-tool-id="pen"]').click();
        await page.locator('[data-studio-brush-active-pill="true"]').click();
        const catalog = page.locator('[data-studio-brush-catalog-session="true"]');
        await catalog.getByRole("searchbox").fill(expected.catalogName);
        const choice = catalog.locator(`[data-studio-brush-select="${id}"]`);
        await choice.click();
        await page.waitForFunction((brushId) => {
          const button = document.querySelector<HTMLButtonElement>(`[data-studio-brush-select="${brushId}"]`);
          return Boolean(button && !button.disabled && button.getAttribute("aria-busy") !== "true");
        }, id);
        await page.waitForTimeout(200);
        const pill = await page.locator('[data-studio-brush-active-pill="true"]').getAttribute("aria-label");
        await page.locator('[data-studio-brush-floating]').getByRole("button", { name: / 닫기$/u }).click();
        await catalog.waitFor({ state: "detached" });
        const box = await page.locator('.konvajs-content').first().boundingBox();
        if (!box) throw new Error("Missing canvas");
        const start = { x: box.x + box.width * 0.38, y: Math.max(320, box.y + 160) };
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + 240, start.y + 8, { steps: 20 });
        await page.screenshot({ path: `${out}/${locale}-${id}-live.png` });
        await page.mouse.up();
        await page.mouse.move(4, 4);
        await page.waitForTimeout(2_000);
        const saved = await stored(page);
        const draws = saved.filter((entry) => entry.type === "draw");
        records.push({ locale, id, expected, pill, draws, errors: [...errors] });
        writeFileSync(`${out}/diagnosis.json`, JSON.stringify(records, null, 2));
        console.log(JSON.stringify({ locale, id, expectedName: expected.catalogName, saved: draws.map(({ brush, brushCatalogId, brushCatalogName, mode, hidden, groupId, livingInkReceipt, brushDynamics }) => ({ brush, brushCatalogId, brushCatalogName, mode, hidden, groupId, livingInkReceipt, hasDynamics: Boolean(brushDynamics) })) }));
        await page.screenshot({ path: `${out}/${locale}-${id}-settled.png` });
        if (draws.length > 0) {
          await (await enabledStudioHistoryControl(page, "undo")).click();
          await page.waitForTimeout(2_000);
          const remaining = (await stored(page)).filter((entry) => entry.type === "draw");
          if (remaining.length !== 0) throw new Error(`Undo retained ${remaining.length} draws after ${id}`);
        }
      }
    } catch (error) {
      records.push({ locale, failure: String(error), errors });
      await page.screenshot({ path: `${out}/${locale}-failure.png` }).catch(() => undefined);
      writeFileSync(`${out}/diagnosis.json`, JSON.stringify(records, null, 2));
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  writeFileSync(`${out}/diagnosis.json`, JSON.stringify(records, null, 2));
  await browser.close();
  server.kill("SIGTERM");
}
