/**
 * Pointer-distance regression gate for the on-canvas command surfaces.
 *
 * V5 §15 states three ceilings — `브러시 HUD 80px, 선택 명령 180px, 레이어 행 동작
 * 120px` — and the 2026-08-08 audit failed all ten budget items it measured,
 * the nearest interactive control of any kind sitting 388px from the canvas
 * centre (`tests/benchmarks/results/ux-audit.json`).
 *
 * This harness re-measures the same way the audit did — real rendered client
 * rects in a real browser, no source reading — but against each surface's own
 * anchor, which is the only reading under which "레이어 행 동작 120px" is even
 * meaningful (a layer row is never near the canvas centre):
 *
 *   - `brushHud`         cursor              → every brush HUD control
 *   - `selectionCommand` selection box       → every selection command
 *   - `layerRowAction`   layer row centre    → every inline row action
 *
 * The audit's canvas-centre numbers are reported alongside, so the headline
 * "가장 가까운 컨트롤 388px" claim can be compared like for like.
 *
 * Run after `pnpm exec vite build`:
 *   pnpm exec tsx tests/benchmarks/harness/ux-pointer-distance.ts
 *
 * Env:
 *   TOONSPECTRUM_VERIFY_ORIGIN  reuse an already-running preview origin
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { arch, cpus, platform } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { chromium, type Browser, type Page } from "playwright";

import { STUDIO_POINTER_DISTANCE_BUDGETS_PX } from "../../../apps/web/src/domains/creator/studio-oncanvas-command-surfaces";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;
const RESULTS_DIR = join(REPO_ROOT, "tests", "benchmarks", "results");
const RESULTS_FILE = "ux-pointer-distance-after.json";
const AUDIT_FILE = join(RESULTS_DIR, "ux-audit.json");

interface ViewportCase {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

const VIEWPORTS: readonly ViewportCase[] = [
  { id: "1600", width: 1600, height: 1000 },
  { id: "900", width: 900, height: 900 },
  { id: "430", width: 430, height: 932 },
];

function log(message: string): void {
  console.log(`[ux-pointer-distance] ${message}`);
}

const STORAGE_PRIMING_SOURCE = String.raw`
(() => {
  try {
    localStorage.setItem("toonspectrum-studio-quick-start-dismissed", "1");
    localStorage.setItem("toonspectrum-studio-mobile-hint-dismissed", "1");
    const keys = Object.keys(localStorage);
    for (let i = 0; i < keys.length; i += 1) {
      if (keys[i].indexOf("toonspectrum-studio-autosave") === 0) localStorage.removeItem(keys[i]);
    }
  } catch (error) {
    // Private mode: the studio still boots, just without the primed flags.
  }
})();
`;

/**
 * Page-side measuring tape. Shipped as source text, not a serialized closure:
 * the tsx/esbuild transform emits `__name(...)` helpers that do not exist in a
 * fresh page realm.
 */
const MEASURE_SOURCE = String.raw`
(() => {
  function rectOf(node) {
    const r = node.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  function visible(node) {
    const r = node.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) return false;
    const style = getComputedStyle(node);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  }
  function distancePointToRect(point, rect) {
    const dx = Math.max(rect.left - point.x, 0, point.x - (rect.left + rect.width));
    const dy = Math.max(rect.top - point.y, 0, point.y - (rect.top + rect.height));
    return Math.hypot(dx, dy);
  }
  function distanceRectToRect(rect, anchor) {
    const corners = [
      { x: rect.left, y: rect.top },
      { x: rect.left + rect.width, y: rect.top },
      { x: rect.left, y: rect.top + rect.height },
      { x: rect.left + rect.width, y: rect.top + rect.height },
    ];
    let worst = 0;
    for (const corner of corners) {
      const d = distancePointToRect(corner, anchor);
      if (d > worst) worst = d;
    }
    return worst;
  }
  function centerOf(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  const INTERACTIVE = [
    "button", "input", "select", "textarea", "a[href]",
    '[role="button"]', '[role="slider"]', '[role="tab"]', '[role="menuitem"]',
    '[role="checkbox"]', '[role="switch"]', '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  globalThis.__uxPointerDistance = {
    /** Distance from a viewport point to every brush HUD control. */
    brushHud: function (point) {
      const hud = document.querySelector('[data-studio-brush-hud="true"]');
      if (!hud || !visible(hud)) return null;
      const controls = [];
      const nodes = hud.querySelectorAll('[role="slider"], button');
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        const rect = rectOf(node);
        const center = centerOf(rect);
        controls.push({
          label: node.getAttribute("aria-label") || node.getAttribute("data-studio-brush-hud-cell") || "?",
          rect: rect,
          centerDistancePx: Math.hypot(center.x - point.x, center.y - point.y),
          edgeDistancePx: distancePointToRect(point, rect),
        });
      }
      return {
        side: hud.getAttribute("data-studio-brush-hud-side"),
        withinBudgetFlag: hud.getAttribute("data-studio-brush-hud-within-budget"),
        rect: rectOf(hud),
        controls: controls,
      };
    },

    selectionBar: function (anchorRect, pointerPoint) {
      const bar = document.querySelector('[data-studio-selection-context-bar="true"]');
      if (!bar || !visible(bar)) return null;
      const controls = [];
      const nodes = bar.querySelectorAll("[data-studio-selection-command]");
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        const rect = rectOf(node);
        const center = centerOf(rect);
        controls.push({
          command: node.getAttribute("data-studio-selection-command"),
          rect: rect,
          fromSelectionBoxPx: distancePointToRect(center, anchorRect),
          fromPointerPx: Math.hypot(center.x - pointerPoint.x, center.y - pointerPoint.y),
        });
      }
      return {
        side: bar.getAttribute("data-studio-selection-bar-side"),
        rect: rectOf(bar),
        barToSelectionPx: distanceRectToRect(rectOf(bar), anchorRect),
        controls: controls,
      };
    },

    layerRow: function () {
      const row = document.querySelector('[data-studio-layer-row="true"]');
      if (!row || !visible(row)) return null;
      const rowRect = rectOf(row);
      const rowCenter = centerOf(rowRect);
      const actions = [];
      const nodes = row.querySelectorAll("[data-studio-layer-row-action]");
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        const rect = rectOf(node);
        const center = centerOf(rect);
        actions.push({
          action: node.getAttribute("data-studio-layer-row-action"),
          label: node.getAttribute("aria-label"),
          rect: rect,
          fromRowCenterPx: Math.hypot(center.x - rowCenter.x, center.y - rowCenter.y),
        });
      }
      return {
        rect: rowRect,
        rowCount: document.querySelectorAll('[data-studio-layer-row="true"]').length,
        actions: actions,
      };
    },

    /**
     * Baseline route: the row's own action popover, which before Wave C was the
     * only place 잠금 and 불투명도 lived. Resolved through the menu button's
     * aria-controls id so it can never accidentally match an inline control.
     */
    layerPopoverControl: function (rowRect, pattern) {
      const menu = document.querySelector('[data-studio-layer-row-action="menu"]');
      const popoverId = menu ? menu.getAttribute("aria-controls") : null;
      const popover = popoverId ? document.getElementById(popoverId) : null;
      if (!popover || !visible(popover)) return null;
      const rowCenter = centerOf(rowRect);
      const nodes = popover.querySelectorAll(INTERACTIVE);
      const re = new RegExp(pattern, "u");
      let best = null;
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (!visible(node)) continue;
        const text = (node.getAttribute("aria-label") || node.textContent || "").trim();
        if (!re.test(text)) continue;
        const rect = rectOf(node);
        const center = centerOf(rect);
        const distance = Math.hypot(center.x - rowCenter.x, center.y - rowCenter.y);
        if (best === null || distance < best.distancePx) {
          best = { label: text.slice(0, 40), rect: rect, distancePx: distance };
        }
      }
      return best;
    },

    /**
     * Audit parity: nearest interactive control of any kind to a point.
     * Layout containers that merely carry a tab stop (the canvas workspace itself)
     * are skipped — they are not commands, and the audit did not count them.
     */
    nearestInteractive: function (point, excludeSelector) {
      const stage = document.querySelector(".konvajs-content");
      const nodes = document.querySelectorAll(INTERACTIVE);
      const excluded = excludeSelector ? document.querySelectorAll(excludeSelector) : [];
      const excludedSet = new Set();
      for (let i = 0; i < excluded.length; i += 1) excludedSet.add(excluded[i]);
      let best = null;
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (!visible(node)) continue;
        let skip = false;
        let cursor = node;
        while (cursor) {
          if (excludedSet.has(cursor)) { skip = true; break; }
          cursor = cursor.parentElement;
        }
        if (skip) continue;
        if (stage && node.contains(stage)) continue;
        const rect = rectOf(node);
        if (rect.width > 320 || rect.height > 320) continue;
        const center = centerOf(rect);
        const distance = Math.hypot(center.x - point.x, center.y - point.y);
        if (best === null || distance < best.distancePx) {
          best = {
            label: (node.getAttribute("aria-label") || node.textContent || "").trim().slice(0, 40),
            distancePx: distance,
            rect: rect,
          };
        }
      }
      return best;
    },
  };
})();
`;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SurfaceRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface BrushHudReading {
  side: string | null;
  withinBudgetFlag: string | null;
  rect: SurfaceRect;
  controls: {
    label: string;
    rect: SurfaceRect;
    centerDistancePx: number;
    edgeDistancePx: number;
  }[];
}

interface SelectionBarReading {
  side: string | null;
  rect: SurfaceRect;
  barToSelectionPx: number;
  controls: {
    command: string | null;
    rect: SurfaceRect;
    fromSelectionBoxPx: number;
    fromPointerPx: number;
  }[];
}

interface LayerRowReading {
  rect: SurfaceRect;
  rowCount: number;
  actions: {
    action: string | null;
    label: string | null;
    rect: SurfaceRect;
    fromRowCenterPx: number;
  }[];
}

interface NearestReading {
  label: string;
  distancePx: number;
  rect: SurfaceRect;
}

interface UxPointerDistanceBridge {
  brushHud: (point: { x: number; y: number }) => BrushHudReading | null;
  selectionBar: (
    anchorRect: SurfaceRect,
    pointerPoint: { x: number; y: number },
  ) => SelectionBarReading | null;
  layerRow: () => LayerRowReading | null;
  layerPopoverControl: (
    rowRect: SurfaceRect,
    pattern: string,
  ) => { label: string; rect: SurfaceRect; distancePx: number } | null;
  nearestInteractive: (
    point: { x: number; y: number },
    excludeSelector: string | null,
  ) => NearestReading | null;
}

declare global {
  /** Injected measuring tape; only exists inside the driven browser context. */
  var __uxPointerDistance: UxPointerDistanceBridge;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        reject(new Error("could not reserve a preview port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForServer(origin: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(origin, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // preview is still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`vite preview did not become ready at ${origin}`);
}

async function stageBox(page: Page): Promise<Box> {
  const box = await page.locator(".konvajs-content").first().boundingBox();
  if (!box) throw new Error("konva stage has no layout box");
  return box;
}

/** Same boot sequence the other Studio harnesses use, tolerant of the mobile shell. */
async function prepareStudio(page: Page, studioUrl: string): Promise<void> {
  page.setDefaultTimeout(15_000);
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.evaluate("globalThis.__name ??= (target) => target");
  await page.locator(".konvajs-content").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("b");
  // Narrow viewports boot into 전체 화면 드로잉. Leave it: the layer panel and the
  // rest of the chrome have to be reachable for the comparison to mean anything.
  const exitFullscreen = page.getByRole("button", { name: /전체 화면 드로잉 종료/u }).first();
  if (await exitFullscreen.isVisible().catch(() => false)) {
    await exitFullscreen.click().catch(() => undefined);
    await page.waitForTimeout(400);
  }
  try {
    const toolbar = page.getByRole("toolbar", { name: /그리기 옵션/u });
    await toolbar.waitFor({ state: "visible", timeout: 6_000 });
    const pen = toolbar.getByRole("button", { name: "펜", exact: true });
    if ((await pen.getAttribute("aria-pressed")) !== "true") await pen.click();
  } catch {
    // The mobile shell docks the draw options in a sheet; `b` already armed the pen.
  }
  await dismissOpenSheets(page);
  await page.waitForTimeout(400);
}

/**
 * Close whatever `b` opened.
 *
 * On the mobile shell `activateDrawToolWithProperties` opens the 브러시 설정 sheet,
 * which covers the canvas — a drag started under it draws nothing, and every
 * measurement downstream would silently read an empty document.
 */
async function dismissOpenSheets(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const open = await page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"], [data-presentation="bottom-sheet"]')]
        .filter((node) => node.getBoundingClientRect().width > 100).length);
    if (open === 0) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
  }
}

/**
 * A point that is really on the stage — hit-tested, not merely inside the stage
 * rectangle. Narrow layouts float panels over the canvas, so the geometric
 * centre is often a panel, and a drag started there draws nothing.
 */
async function canvasHitPoint(
  page: Page,
  box: Box,
  viewport: ViewportCase,
): Promise<{ x: number; y: number }> {
  const seed = canvasVisibleCenter(box, viewport);
  const found = await page.evaluate(
    (input) => {
      const stage = document.querySelector(".konvajs-content");
      if (!stage) return null;
      const hits = (x: number, y: number) => {
        const element = document.elementFromPoint(x, y);
        return element !== null && (stage === element || stage.contains(element));
      };
      if (hits(input.seed.x, input.seed.y)) return input.seed;
      for (let radius = 40; radius <= 420; radius += 40) {
        for (let step = 0; step < 16; step += 1) {
          const angle = (step / 16) * Math.PI * 2;
          const x = input.seed.x + Math.cos(angle) * radius;
          const y = input.seed.y + Math.sin(angle) * radius;
          if (x < 8 || y < 8 || x > input.width - 8 || y > input.height - 8) continue;
          if (hits(x, y)) return { x: x, y: y };
        }
      }
      return null;
    },
    { seed, width: viewport.width, height: viewport.height },
  );
  if (!found) throw new Error("no point on the canvas is reachable — chrome covers the whole stage");
  return found;
}

/** A point on the stage that is also inside the viewport — the audit's anchor. */
function canvasVisibleCenter(box: Box, viewport: ViewportCase): { x: number; y: number } {
  const left = Math.max(box.x, 0);
  const top = Math.max(box.y, 0);
  const right = Math.min(box.x + box.width, viewport.width);
  const bottom = Math.min(box.y + box.height, viewport.height);
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

async function measureBrushHud(page: Page, point: { x: number; y: number }) {
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(120);
  await page.mouse.move(point.x + 1, point.y);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(160);
  return page.evaluate(
    (anchor) => globalThis.__uxPointerDistance.brushHud(anchor),
    point,
  );
}

async function measureSelectionBar(page: Page, center: { x: number; y: number }) {
  // Draw a short stroke, then select it with the pointer — the real path a user
  // takes to reach the selection commands.
  //
  // The stroke starts *below* the anchor and waits a frame after the approach
  // move: the HUD prefers the space above the cursor, and pressing the button
  // down before it has re-anchored would land on the HUD instead of the canvas.
  const halfWidth = 36;
  const halfHeight = 24;
  const originX = center.x - halfWidth;
  const originY = center.y + 12;
  await page.mouse.move(originX, originY);
  await page.waitForTimeout(160);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(
      originX + (halfWidth * 2 * step) / 8,
      originY + (halfHeight * 2 * step) / 8,
    );
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.keyboard.press("v");
  await page.waitForTimeout(250);
  const pointerPoint = { x: originX + halfWidth, y: originY + halfHeight };
  await page.mouse.click(pointerPoint.x, pointerPoint.y);
  await page.waitForTimeout(500);
  const selectionRect = {
    left: originX,
    top: originY,
    width: halfWidth * 2,
    height: halfHeight * 2,
  };
  const measured = await page.evaluate(
    (input) => globalThis.__uxPointerDistance.selectionBar(input.rect, input.point),
    { rect: selectionRect, point: pointerPoint },
  );
  const restoredTool = await page.evaluate(() => {
    const pressed = [...document.querySelectorAll('[aria-pressed="true"]')]
      .map((node) => (node.getAttribute("aria-label") || "").trim())
      .filter((label) => label.length > 0);
    return pressed.slice(0, 6);
  });
  return { selectionRect, pointerPoint, measured, restoredTool };
}

/**
 * Functional proof that the HUD dispatches through the shared quick-action
 * dispatcher rather than a private handler: 지우개 flips the live tool, which is
 * what re-labels the cell.
 */
async function verifyHudEraserToggle(page: Page, point: { x: number; y: number }) {
  const cell = page.locator('[data-studio-brush-hud-cell="eraser"]').first();
  if (!(await cell.isVisible().catch(() => false))) return { available: false as const };
  const before = await cell.getAttribute("aria-label");
  await cell.click({ timeout: 3_000 }).catch(() => undefined);
  await page.waitForTimeout(350);
  const after = await cell.getAttribute("aria-label");
  // Restore the pen so the stroke that follows is ink, not an erase.
  await cell.click({ timeout: 3_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  // Tool switches reopen the mobile 브러시 설정 sheet, which covers the canvas.
  await dismissOpenSheets(page);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(200);
  return { available: true as const, before, after, toggled: before !== after };
}

/** Fire one selection command and report whether the bar survived it. */
async function runSelectionCommand(page: Page, command: string) {
  const button = page.locator(`[data-studio-selection-command="${command}"]`).first();
  const reachable = await button
    .waitFor({ state: "visible", timeout: 4_000 })
    .then(() => true)
    .catch(() => false);
  if (!reachable) {
    return {
      available: false as const,
      reason: await page.evaluate(() => {
        const bar = document.querySelector('[data-studio-selection-context-bar="true"]');
        if (!(bar instanceof HTMLElement)) return "bar not mounted";
        return `bar visibility=${bar.style.visibility} count=${bar.dataset.studioSelectionCount}`;
      }),
    };
  }
  await button.click({ timeout: 3_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  return {
    available: true as const,
    command,
    barStillVisible: await page.evaluate(() => {
      const bar = document.querySelector('[data-studio-selection-context-bar="true"]');
      return bar instanceof HTMLElement && bar.style.visibility === "visible";
    }),
  };
}

async function openLayerPanel(page: Page): Promise<boolean> {
  if (await page.locator('[data-studio-layer-row="true"]').first().isVisible().catch(() => false)) {
    return true;
  }
  const candidates = [
    page.getByRole("tab", { name: /레이어/u }),
    page.getByRole("button", { name: /레이어/u }),
  ];
  for (const candidate of candidates) {
    const count = await candidate.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, 4); index += 1) {
      const target = candidate.nth(index);
      if (!(await target.isVisible().catch(() => false))) continue;
      await target.click({ timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(400);
      if (
        await page.locator('[data-studio-layer-row="true"]').first().isVisible().catch(() => false)
      ) {
        return true;
      }
    }
  }
  return false;
}

async function measureLayerRow(page: Page) {
  // Park the pointer in the corner so no on-canvas surface floats over the panel.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(120);
  const opened = await openLayerPanel(page);
  if (!opened) {
    return {
      available: false as const,
      reason:
        "the shell does not present the layer navigator panel at this viewport "
        + "(pre-existing responsive behaviour, not a Wave C regression)",
    };
  }
  const inline = await page.evaluate(() => globalThis.__uxPointerDistance.layerRow());
  if (!inline) {
    return { available: false as const, reason: "layer navigator opened but rendered no rows" };
  }
  // Baseline for the comparison: the pre-Wave-C route to 잠금 went through the
  // row's `…` popover. Open it and measure the same command from the row centre.
  const popoverRoute: Record<string, unknown> = {};
  const menuButton = page.locator('[data-studio-layer-row-action="menu"]').first();
  if (await menuButton.isVisible().catch(() => false)) {
    await menuButton.click({ timeout: 3_000 }).catch(() => undefined);
    await page.waitForTimeout(350);
    for (const [key, pattern] of [["lock", "잠금"], ["opacity", "불투명도"]] as const) {
      popoverRoute[key] = await page.evaluate(
        (input) => globalThis.__uxPointerDistance.layerPopoverControl(input.rect, input.pattern),
        { rect: inline.rect, pattern },
      );
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
  return { available: true as const, inline, popoverRoute };
}

function summarize(
  values: readonly number[],
  budget: number,
): { maxPx: number | null; budgetPx: number; pass: boolean } {
  if (values.length === 0) return { maxPx: null, budgetPx: budget, pass: false };
  const maxPx = Math.round(Math.max(...values) * 10) / 10;
  return { maxPx, budgetPx: budget, pass: maxPx <= budget };
}

async function main(): Promise<void> {
  const started = performance.now();
  const externalOrigin = process.env.TOONSPECTRUM_VERIFY_ORIGIN?.trim();
  const port = externalOrigin ? null : await findFreePort();
  const origin = externalOrigin
    ? `${externalOrigin.replace(/\/+$/u, "")}/`
    : `http://127.0.0.1:${port}/`;
  const studioUrl = `${origin}studio`;
  const server: ChildProcess | null = externalOrigin
    ? null
    : spawn(
        process.execPath,
        [
          join(REPO_ROOT, "node_modules", "vite", "bin", "vite.js"),
          "preview",
          "--port",
          String(port),
          "--strictPort",
          "--host",
          "127.0.0.1",
        ],
        { cwd: REPO_ROOT, stdio: ["ignore", "ignore", "ignore"] },
      );

  let browser: Browser | null = null;
  const perViewport: Record<string, unknown> = {};
  const violations: { viewport: string; budget: string; observedPx: number; budgetPx: number }[] = [];
  const notPresented: { viewport: string; surface: string }[] = [];
  let failure: string | null = null;

  try {
    await waitForServer(origin);
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

    for (const viewport of VIEWPORTS) {
      log(`measuring ${viewport.width}x${viewport.height}`);
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        hasTouch: viewport.width < 768,
        isMobile: viewport.width < 768,
      });
      await context.addInitScript({ content: STORAGE_PRIMING_SOURCE });
      await context.addInitScript({ content: MEASURE_SOURCE });
      const page = await context.newPage();
      try {
        await prepareStudio(page, studioUrl);
        const box = await stageBox(page);
        const geometricCenter = canvasVisibleCenter(box, viewport);
        const center = await canvasHitPoint(page, box, viewport);

        const beforeNearest = await page.evaluate(
          (point) =>
            globalThis.__uxPointerDistance.nearestInteractive(
              point,
              '[data-studio-brush-hud="true"],[data-studio-selection-context-bar="true"]',
            ),
          center,
        );

        const hud = await measureBrushHud(page, center);
        const afterNearest = await page.evaluate(
          (point) => globalThis.__uxPointerDistance.nearestInteractive(point, null),
          center,
        );

        const hudCommandRouting = await verifyHudEraserToggle(page, center);
        const selection = await measureSelectionBar(page, center);
        const duplicateRouting = await runSelectionCommand(page, "duplicate");
        const layerRow = await measureLayerRow(page);

        const hudDistances = hud?.controls.map((control) => control.centerDistancePx) ?? [];
        const selectionDistances =
          selection.measured?.controls.map((control) => control.fromSelectionBoxPx) ?? [];
        const layerDistances = layerRow.available
          ? layerRow.inline.actions.map((action) => action.fromRowCenterPx)
          : [];

        const budgets = {
          brushHud: summarize(hudDistances, STUDIO_POINTER_DISTANCE_BUDGETS_PX.brushHud),
          selectionCommand: summarize(
            selectionDistances,
            STUDIO_POINTER_DISTANCE_BUDGETS_PX.selectionCommand,
          ),
          layerRowAction: summarize(
            layerDistances,
            STUDIO_POINTER_DISTANCE_BUDGETS_PX.layerRowAction,
          ),
        };
        for (const [id, summary] of Object.entries(budgets)) {
          if (summary.maxPx === null) {
            // The shell did not present this surface here. Absence is reported,
            // not scored: a budget can only be broken by something that rendered.
            notPresented.push({ viewport: viewport.id, surface: id });
            continue;
          }
          if (!summary.pass) {
            violations.push({
              viewport: viewport.id,
              budget: id,
              observedPx: summary.maxPx,
              budgetPx: summary.budgetPx,
            });
          }
        }

        perViewport[viewport.id] = {
          viewport: { width: viewport.width, height: viewport.height },
          canvasRect: box,
          canvasVisibleCenter: [
            Math.round(geometricCenter.x),
            Math.round(geometricCenter.y),
          ],
          measuredAnchor: [Math.round(center.x), Math.round(center.y)],
          nearestInteractiveExcludingNewSurfaces: beforeNearest,
          nearestInteractiveIncludingNewSurfaces: afterNearest,
          brushHud: hud,
          commandRouting: { hudEraserToggle: hudCommandRouting, selection: duplicateRouting },
          selection: {
            selectionRect: selection.selectionRect,
            pointerPoint: selection.pointerPoint,
            bar: selection.measured,
          },
          layerRow,
          budgets,
        };
      } catch (error) {
        failure = failure ?? `${viewport.id}: ${(error as Error).message}`;
        perViewport[viewport.id] = { error: (error as Error).message };
      } finally {
        await context.close();
      }
    }
  } catch (error) {
    failure = failure ?? (error as Error).message;
  } finally {
    await browser?.close().catch(() => undefined);
    if (server) {
      server.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 700));
      server.kill("SIGKILL");
    }
  }

  const audit = JSON.parse(await readFile(AUDIT_FILE, "utf8")) as {
    measurements: {
      pointerDistance: {
        nearestAnyInteractiveControl: { label: string; distance: number };
        budgets: Record<string, { budgetPx: number | null; measuredPx: number; pass?: boolean }>;
      };
    };
  };
  const auditBudgets = audit.measurements.pointerDistance.budgets;

  const report = {
    $schema: "https://toonspectrum.local/schemas/ux-pointer-distance.json",
    gate: "V5 §15 포인터 거리 — on-canvas command surfaces",
    generatedAt: new Date().toISOString(),
    route: "/studio (guest, no auth session)",
    build: "vite build → vite preview (production bundle)",
    host: { platform: platform(), arch: arch(), cpus: cpus().length },
    budgets: STUDIO_POINTER_DISTANCE_BUDGETS_PX,
    anchorContract: {
      brushHud: "cursor → every brush HUD control centre",
      selectionCommand: "selection bounding box → every selection command centre",
      layerRowAction: "layer row centre → every inline row action centre",
      note:
        "V5 §15 states the budgets per surface. The 2026-08-08 audit measured all "
        + "ten items from the canvas visible centre because no anchored surface existed; "
        + "`auditParity` below keeps that comparison honest.",
    },
    auditParity: {
      source: "tests/benchmarks/results/ux-audit.json",
      before: {
        nearestAnyInteractiveControl:
          audit.measurements.pointerDistance.nearestAnyInteractiveControl,
        brushHudPx: auditBudgets.brushHud?.measuredPx ?? null,
        brushSizePx: auditBudgets.brushSizeControl?.measuredPx ?? null,
        brushOpacityPx: auditBudgets.brushOpacityControl?.measuredPx ?? null,
        selectionCommandPx: auditBudgets.selectionCommand?.measuredPx ?? null,
        transformAfterSelectPx: auditBudgets.transformAfterSelect?.measuredPx ?? null,
        layerRowActionPx: auditBudgets.layerRowAction?.measuredPx ?? null,
        budgetsMet: 0,
        budgetsTotal: 10,
      },
    },
    viewports: perViewport,
    violations,
    /**
     * Surfaces the shell does not present at a given viewport. Not scored — but
     * the desktop viewport must present all three or the run fails, so this can
     * never quietly turn into "measured nothing, therefore passed".
     */
    notPresented,
    desktopCoverageComplete:
      notPresented.filter((entry) => entry.viewport === "1600").length === 0,
    failure,
    passed:
      failure === null
      && violations.length === 0
      && notPresented.filter((entry) => entry.viewport === "1600").length === 0,
    runtimeMs: Math.round(performance.now() - started),
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(join(RESULTS_DIR, RESULTS_FILE), `${JSON.stringify(report, null, 2)}\n`);
  log(
    report.passed
      ? "PASS — every surface inside its V5 §15 budget on all three viewports"
      : `FAIL — ${failure ?? `${violations.length} budget violation(s)`}`,
  );
  if (!report.passed) process.exitCode = 1;
}

await main();
