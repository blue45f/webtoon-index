/**
 * Every listed brush must be selectable from the picker.
 *
 * The catalogue is the product's promise: a preset that appears in the picker and cannot be
 * chosen is worse than one that was never listed, because the artist sees it, wants it, and gets
 * nothing. Nothing else in the repo checks that promise — the scenario matrix only drives the
 * handful of presets it measures, and it fails with a bare Playwright timeout when selection
 * breaks, which reads as a harness problem rather than a product one.
 *
 * This walks all of STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS through the real picker and classifies
 * each failure, so "some brushes cannot be selected" becomes a list with reasons.
 *
 * It then draws with each one, because "I selected it and nothing happened" reads to an artist as
 * a brush that cannot be selected. That failure is real and has shipped: a translucent brush and
 * the eraser both left 0 px on a browser with working WebGPU, refused by a lane that had already
 * been chosen for them.
 *
 *   TOONSPECTRUM_VERIFY_ORIGIN=http://…   reuse a running server instead of spawning a preview
 *   TOONSPECTRUM_SELECTABLE_IDS=a,b       check a subset
 *   TOONSPECTRUM_SELECTABLE_OUT=<path>    write the JSON report here
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { chromium, type Browser, type Page } from "@playwright/test";
import { decodePng } from "image-js";

import {
  filterStudioBrushCatalogItems,
  STUDIO_ERASER_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS,
  type StudioBrushCatalogItem,
} from "../apps/web/src/domains/creator/brush/studio-brush-catalog";
import { STUDIO_BRUSH_MATERIAL_GROUP_LABELS } from "../apps/web/src/domains/creator/brush/studio-brush-material-group";

const OUT = process.env.TOONSPECTRUM_SELECTABLE_OUT?.trim()
  || "/tmp/studio-brush-selectable.json";
const VIEWPORT = { width: 1440, height: 1100 } as const;

type Outcome =
  | "ok"
  /** The search box matched nothing, even after revealing every progressive batch. */
  | "absent-from-picker"
  /** The option was there but the click never took. */
  | "click-refused"
  /** Something else was selected — the picker resolved the name to a different preset. */
  | "selected-something-else"
  /** Selected fine, then the stroke left nothing on the canvas. */
  | "draws-nothing"
  | "error";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly outcome: Outcome;
  readonly detail: string;
  readonly ink?: number;
}

function log(message: string): void {
  console.log(`[verify-studio-brush-selectable] ${message}`);
}

function requested(): readonly StudioBrushCatalogItem[] {
  const raw = process.env.TOONSPECTRUM_SELECTABLE_IDS?.trim();
  if (!raw) return STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS;
  const wanted = new Set(raw.split(",").map((value) => value.trim()).filter(Boolean));
  return STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.filter((item) => wanted.has(item.id));
}

const isEraser = (item: StudioBrushCatalogItem) =>
  STUDIO_ERASER_BRUSH_CATALOG_ITEMS.some((entry) => entry.id === item.id);

/**
 * Draw one short stroke and say how many canvas pixels changed.
 *
 * Deliberately cheap: this is a liveness check, not a quality one — the scenario matrix owns
 * texture, flicker and live/commit parity. All this has to catch is "nothing came out".
 */
async function inkFromOneStroke(page: Page): Promise<number> {
  const box = await page.locator(".konvajs-content").first().boundingBox();
  if (!box) return -1;
  const x = box.x + box.width * 0.32;
  const y = box.y + box.height * 0.42;
  const before = await page.screenshot({ clip: box, animations: "disabled" });
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 18; step += 1) {
    await page.mouse.move(x + step * 14, y + Math.sin(step / 3) * 26, { steps: 2 });
  }
  await page.mouse.up();
  await page.waitForTimeout(900);
  const after = await page.screenshot({ clip: box, animations: "disabled" });
  const left = decodePng(new Uint8Array(before.buffer, before.byteOffset, before.byteLength)).getRawImage();
  const right = decodePng(new Uint8Array(after.buffer, after.byteOffset, after.byteLength)).getRawImage();
  if (left.data.length !== right.data.length) return -1;
  let changed = 0;
  for (let index = 0; index < left.data.length; index += left.channels) {
    if (Math.abs(left.data[index]! - right.data[index]!) > 12
      || Math.abs(left.data[index + 1]! - right.data[index + 1]!) > 12
      || Math.abs(left.data[index + 2]! - right.data[index + 2]!) > 12) changed += 1;
  }
  return changed;
}

/** Clear the canvas so the next brush measures its own stroke. */
async function undoAll(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(250);
}

async function activateMode(page: Page, eraser: boolean): Promise<void> {
  await page.keyboard.press(eraser ? "e" : "b");
  await page.waitForTimeout(80);
}

async function selectOne(page: Page, item: StudioBrushCatalogItem): Promise<Row> {
  const row = (outcome: Outcome, detail = "") => ({ id: item.id, name: item.name, outcome, detail });
  try {
    await activateMode(page, isEraser(item));
    const toolbar = page.locator('[data-studio-draw-options="true"]');
    await toolbar.waitFor({ state: "visible", timeout: 8_000 });
    const pill = toolbar.locator('[data-studio-brush-active-pill="true"]');
    await pill.waitFor({ state: "visible", timeout: 8_000 });
    await pill.click();
    const catalog = page.locator('[data-studio-brush-catalog-session="true"]');
    await catalog.waitFor({ state: "visible", timeout: 8_000 });
    await catalog.getByRole("tab", { name: "전체", exact: true }).click();
    await catalog.getByRole("searchbox").fill(item.name);
    const option = catalog.getByRole("button", { name: `${item.name} 선택`, exact: true });
    for (let batch = 0; batch < 24 && await option.count() === 0; batch += 1) {
      const sentinel = catalog.locator('[data-studio-brush-progressive-sentinel="true"]');
      if (await sentinel.count() === 0) break;
      await catalog.locator('[data-studio-brush-catalog-scrollport="true"]').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await page.waitForTimeout(120);
    }
    if (await option.count() === 0) {
      // Say what the search DID offer — an empty result and a near-miss are different bugs.
      const offered = await catalog.getByRole("button", { name: /선택$/ })
        .evaluateAll((nodes) => nodes.slice(0, 5).map((node) => node.getAttribute("aria-label") ?? ""));
      await page.keyboard.press("Escape");
      return row("absent-from-picker", `search "${item.name}" offered: ${offered.join(" | ") || "(nothing)"}`);
    }
    await option.first().scrollIntoViewIfNeeded();
    await option.first().click({ force: true });
    await catalog.waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
    const label = await page.waitForFunction(
      () => document.querySelector('[data-studio-brush-active-pill="true"]')?.getAttribute("aria-label") ?? null,
      undefined,
      { timeout: 8_000 },
    ).then((handle) => handle.jsonValue() as Promise<string | null>).catch(() => null);
    if (label === null) return row("click-refused", "the active pill never reported a brush");
    if (!label.includes(item.name)) return row("selected-something-else", `pill reads "${label}"`);
    if (process.env.TOONSPECTRUM_SELECTABLE_SKIP_DRAW === "1") return row("ok");
    // An eraser on blank paper removes nothing; it has no ink of its own to prove.
    if (isEraser(item)) return row("ok", "eraser — draw check skipped");
    const ink = await inkFromOneStroke(page);
    await undoAll(page);
    if (ink === 0) {
      const refusal = await page.evaluate(`Array.from(document.querySelectorAll('[role="alert"]'))
        .map((element) => (element.textContent || "").trim()).filter(Boolean).slice(0, 2).join(" | ")`) as string;
      return { ...row("draws-nothing", refusal || "no alert shown"), ink };
    }
    return { ...row("ok", `${ink} px`), ink };
  } catch (error) {
    await page.keyboard.press("Escape").catch(() => {});
    return row("error", String(error).split("\n")[0]!.slice(0, 160));
  }
}

async function spawnPreview(): Promise<{ origin: string; child: ChildProcess | null }> {
  const external = process.env.TOONSPECTRUM_VERIFY_ORIGIN?.trim();
  if (external) return { origin: external, child: null };
  const port = 4600 + Math.floor(Math.random() * 300);
  const child = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], {
    stdio: "ignore",
    detached: false,
  });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return { origin, child };
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill();
  throw new Error("vite preview never came up");
}

const items = requested();
const { origin, child } = await spawnPreview();
log(`origin ${origin} · ${items.length} listed brushes`);
const browser: Browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newContext({ viewport: { ...VIEWPORT } }).then((c) => c.newPage());
await page.goto(new URL("/studio", origin).toString(), { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForSelector('[data-studio-editor="true"]', { timeout: 90_000 });
await page.waitForTimeout(2_500);

/**
 * Browsing is the other way in, and it is not the same test.
 *
 * Selecting by name goes through the search box, which is catalogue-wide and mounts its whole
 * result set. An artist who does not know a brush's name scrolls a tab instead, and that list
 * mounts progressively — so a preset far down a tab is reachable only if the progressive sentinel
 * keeps firing. Search passing says nothing about that path.
 */
async function browseTab(page: Page, tab: string, label: string, expected: number): Promise<Row> {
  const row = (outcome: Outcome, detail = "") => ({ id: `tab:${tab}`, name: label, outcome, detail });
  try {
    await activateMode(page, tab === "eraser");
    const pill = page.locator('[data-studio-draw-options="true"] [data-studio-brush-active-pill="true"]');
    await pill.waitFor({ state: "visible", timeout: 8_000 });
    await pill.click();
    const catalog = page.locator('[data-studio-brush-catalog-session="true"]');
    await catalog.waitFor({ state: "visible", timeout: 8_000 });
    // Eraser mode renders no material-group tabs — there are two presets, so the picker offers
    // 즐겨찾기 / 최근 / 전체 only. Asking for a 지우개 tab there hangs on a locator that will never
    // resolve, which is what this check reported as a product failure for one whole run.
    const tabLabel = tab === "eraser" ? "전체" : label;
    await catalog.getByRole("tab", { name: tabLabel, exact: true }).click();
    // Paint cards are labelled "<이름> 선택"; eraser cards read "<이름>, 38% 지움. …". Match both
    // shapes rather than one, and never by an element hook the eraser cards do not carry.
    // Anchored: the sheet's close control is also labelled "…선택 닫기" and must not count.
    const options = catalog.getByRole("button", { name: /( 선택$|지움\. )/ });
    let mounted = await options.count();
    // Exhaust the progressive batches, then keep going a little to prove it has actually settled.
    for (let batch = 0; batch < 60; batch += 1) {
      const sentinel = catalog.locator('[data-studio-brush-progressive-sentinel="true"]');
      if (await sentinel.count() === 0) break;
      await catalog.locator('[data-studio-brush-catalog-scrollport="true"]').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await page.waitForTimeout(140);
      const next = await options.count();
      if (next === mounted && await sentinel.count() === 0) break;
      mounted = next;
    }
    await page.keyboard.press("Escape");
    if (mounted < expected) {
      return row("absent-from-picker", `browsing "${tabLabel}" mounted ${mounted} of ${expected}`);
    }
    return row("ok", `${mounted}/${expected}`);
  } catch (error) {
    await page.keyboard.press("Escape").catch(() => {});
    return row("error", String(error).split("\n")[0]!.slice(0, 160));
  }
}

const rows: Row[] = [];

// Browsing first: it is the cheaper check and it fails differently from search.
if (!process.env.TOONSPECTRUM_SELECTABLE_IDS) {
  const tabs: Array<[string, string, number]> = [
    ["all", "전체", filterStudioBrushCatalogItems({ operation: "paint", category: "all" }).length],
    ...Object.entries(STUDIO_BRUSH_MATERIAL_GROUP_LABELS).map(([group, label]) => [
      group,
      String(label),
      filterStudioBrushCatalogItems({
        operation: group === "eraser" ? "erase" : "paint",
        category: group as never,
      }).length,
    ] as [string, string, number]),
  ];
  for (const [tab, label, expected] of tabs) {
    if (expected === 0) continue;
    const row = await browseTab(page, tab, label, expected);
    rows.push(row);
    log(`${row.outcome === "ok" ? "·" : "✗"} tab ${label}: ${row.detail || row.outcome}`);
  }
}

for (const item of items) {
  const row = await selectOne(page, item);
  rows.push(row);
  if (row.outcome !== "ok") log(`✗ ${item.id} (${item.name}): ${row.outcome} — ${row.detail}`);
}

await browser.close();
child?.kill();

const failures = rows.filter((row) => row.outcome !== "ok");
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ origin, total: rows.length, failures: failures.length, rows }, null, 2));
log(`${rows.length - failures.length}/${rows.length} selectable · report ${OUT}`);
for (const row of failures) log(`  ${row.outcome}: ${row.id} (${row.name})`);
process.exit(failures.length > 0 ? 1 : 0);
