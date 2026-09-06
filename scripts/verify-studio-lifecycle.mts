/**
 * Focused production-preview gate for Studio's artist-critical document lifecycle:
 *
 * pointer stroke -> committed pixels -> Undo -> Redo -> local autosave -> reload/recovery
 * -> deterministic PNG export.
 *
 * The harness only drives shipped UI and stable public selectors. It intentionally verifies local
 * autosave recovery rather than authenticated server persistence; API/database coverage belongs to
 * the integration suite. Run after `pnpm build`:
 *
 *   pnpm exec tsx scripts/verify-studio-lifecycle.mts
 *
 * Reuse an already-running production preview:
 *
 *   TOONSPECTRUM_VERIFY_ORIGIN=http://127.0.0.1:4173 \
 *     pnpm exec tsx scripts/verify-studio-lifecycle.mts
 */
import { type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import {
  chromium,
  type Browser,
  type Download,
  type Locator,
  type Page,
} from "playwright";

import { STUDIO_CANVAS_WIDTH } from "../apps/web/src/domains/creator/canvas/studio-canvas-constants";
import { DEFAULT_CANVAS_H } from "../apps/web/src/domains/creator/studio-pages";

import { DIST_DIR } from "./lib/repo-paths.mjs";
import {
  enabledStudioHistoryControl,
} from "./lib/studio-verify-history-controls.mjs";
import {
  cleanScratchDir,
  findFreePort,
  spawnVitePreview,
  stopChildProcess,
  waitForServer,
} from "./lib/studio-verify-preview-harness.mjs";
import {
  inspectPngIntegrity,
  studioLifecycleVisualViolations,
  type PixelDiffEvidence,
  type PngIntegrity,
} from "./studio-lifecycle-verifier-policy";

const SCRATCH =
  process.env.TOONSPECTRUM_LIFECYCLE_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), "toonspectrum-studio-lifecycle");
const LOG_PATH = join(SCRATCH, "studio-lifecycle-preview.log");
const REPORT_PATH = join(SCRATCH, "studio-lifecycle-report.json");
const AUTOSAVE_PREFIX = "toonspectrum-studio-autosave";
const DURABLE_AUTOSAVE_SETTLE_MS = 2_500;
const CLEAN_SESSION_KEY = "toonspectrum-lifecycle-verifier-cleaned";
const QUICKSTART_KEY = "toonspectrum-studio-quick-start-dismissed";
const MOBILE_HINT_KEY = "toonspectrum-studio-mobile-hint-dismissed";
const OPTIONAL_STATIC_PREVIEW_API_PATHS = [
  "/api/auth/session",
  "/api/kmas/merge-on-access",
  "/api/studio-ai/status",
  "/api/analytics/traffic/",
] as const;

interface BrowserErrorCollector {
  messages: string[];
  failedResponses: string[];
}

interface AutosaveEvidence {
  authority: "durable-reload-recovery";
  recoveryBannerObserved: true;
  restoreActionCompleted: true;
  browserCompatibilityKeysBeforeReload: number;
  browserCompatibilityKeysAtRecovery: number;
}

interface DecodedPngStats {
  width: number;
  height: number;
  backgroundDifferentPixels: number;
  nonTransparentPixels: number;
}

interface PixelCrop {
  leftRatio: number;
  topRatio: number;
  rightRatio: number;
  bottomRatio: number;
}

interface LifecycleResult {
  ok: true;
  origin: string;
  externalPreview: boolean;
  autosave: AutosaveEvidence;
  timings: {
    pointerGestureMs: number;
    historyReadyAfterPointerUpMs: number;
    autosaveSettleBeforeReloadMs: number;
    recoveryReadyAfterReloadMs: number;
  };
  visual: {
    blankToCommitted: PixelDiffEvidence;
    blankToUndone: PixelDiffEvidence;
    committedToRedone: PixelDiffEvidence;
    redoneToReloaded: PixelDiffEvidence;
    beforeToAfterReloadExport: PixelDiffEvidence;
  };
  export: {
    beforeReload: PngIntegrity & DecodedPngStats & { sha256: string; bytes: number; path: string };
    afterReload: PngIntegrity & DecodedPngStats & { sha256: string; bytes: number; path: string };
    expectedWidth: number;
    expectedHeight: number;
  };
  artifacts: {
    directory: string;
    baseline: string;
    committed: string;
    undone: string;
    redone: string;
    reloaded: string;
    report: string;
  };
  browserErrors: BrowserErrorCollector;
  limitations: string[];
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function log(message: string): void {
  const line = `[verify-studio-lifecycle] ${message}`;
  console.log(line);
  appendFileSync(LOG_PATH, `${line}\n`);
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isExpectedStaticPreviewError(message: string, studioUrl: string): boolean {
  let preview: URL;
  try {
    preview = new URL(studioUrl);
  } catch {
    return false;
  }
  if (
    preview.protocol !== "http:"
    || preview.hostname !== "127.0.0.1"
    || preview.port.length === 0
  ) {
    return false;
  }
  if (
    OPTIONAL_STATIC_PREVIEW_API_PATHS.some(
      (path) => message.includes(`${preview.origin}${path}`),
    )
  ) {
    return true;
  }
  const base = `ws://127.0.0.1:${preview.port}/socket.io/?EIO=4&transport=websocket`;
  const expectedMessages = [
    `WebSocket connection to '${base}' failed: Connection closed before receiving a handshake response`,
    `WebSocket connection to '${base}' failed: Error during WebSocket handshake: Unexpected response code: 400`,
  ];
  if (expectedMessages.includes(message)) return true;
  const sourcePrefix = expectedMessages
    .map((entry) => `${entry} @ `)
    .find((entry) => message.startsWith(entry));
  if (!sourcePrefix) return false;
  try {
    const source = new URL(message.slice(sourcePrefix.length));
    return source.origin === preview.origin
      && /^\/assets\/[A-Za-z0-9._-]+\.js$/u.test(source.pathname)
      && source.search === ""
      && source.hash === "";
  } catch {
    return false;
  }
}

function collectBrowserErrors(page: Page, studioUrl: string): BrowserErrorCollector {
  const collector: BrowserErrorCollector = { messages: [], failedResponses: [] };
  page.on("console", (entry) => {
    if (entry.type() !== "error") return;
    const location = entry.location().url;
    const message = location ? `${entry.text()} @ ${location}` : entry.text();
    if (!isExpectedStaticPreviewError(message, studioUrl)) collector.messages.push(message);
  });
  page.on("pageerror", (error) => collector.messages.push(String(error)));
  page.on("response", (response) => {
    if (response.status() < 500) return;
    const message = `${response.status()} ${response.url()}`;
    if (!isExpectedStaticPreviewError(message, studioUrl)) {
      collector.failedResponses.push(message);
    }
  });
  return collector;
}

async function installCleanStudioState(page: Page): Promise<void> {
  await page.addInitScript(
    ({ autosavePrefix, cleanSessionKey, mobileHintKey, quickstartKey }) => {
      try {
        window.localStorage.setItem(quickstartKey, "1");
        window.localStorage.setItem(mobileHintKey, "1");
        // Init scripts run before reload as well. Clear stale records exactly once so the gate can
        // exercise the real autosave recovery path on its second Studio boot.
        if (window.sessionStorage.getItem(cleanSessionKey) !== "1") {
          for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
            const key = window.localStorage.key(index);
            if (key?.startsWith(autosavePrefix)) window.localStorage.removeItem(key);
          }
          window.sessionStorage.setItem(cleanSessionKey, "1");
        }
      } catch {
        // Visible persistence assertions below remain strict if storage is unavailable.
      }
    },
    {
      autosavePrefix: AUTOSAVE_PREFIX,
      cleanSessionKey: CLEAN_SESSION_KEY,
      mobileHintKey: MOBILE_HINT_KEY,
      quickstartKey: QUICKSTART_KEY,
    },
  );
}

async function dismissQuickStart(page: Page): Promise<void> {
  const quickstart = page.locator('[data-studio-creative-starter="true"]');
  if (await quickstart.isVisible({ timeout: 300 }).catch(() => false)) {
    await quickstart.locator('[data-studio-quickstart-dismiss="true"]').click();
  }
}

async function prepareStudio(page: Page, studioUrl: string): Promise<void> {
  page.setDefaultTimeout(8_000);
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.locator('[data-studio-editor="true"]').waitFor({ state: "visible", timeout: 12_000 });
  await dismissQuickStart(page);
  const shell = await page.evaluate(() => ({
    textLength: document.body.innerText.trim().length,
    hasErrorOverlay: Boolean(
      document.querySelector("vite-error-overlay, .vite-error-overlay, #webpack-dev-server-client-overlay"),
    ),
  }));
  invariant(shell.textLength > 0, "Studio rendered a blank document");
  invariant(!shell.hasErrorOverlay, "Vite error overlay is visible");
}

async function activatePen(page: Page): Promise<void> {
  await page.keyboard.press("b");
  const drawOptions = page.locator('[data-studio-draw-options="true"]');
  await drawOptions.waitFor({ state: "visible", timeout: 8_000 });
  const pen = drawOptions.getByRole("button", { name: "펜", exact: true });
  if (await pen.getAttribute("aria-pressed") !== "true") await pen.click();
  await page.locator('[data-studio-brush-active-pill="true"]').waitFor({ state: "visible" });
}

async function enabledHistoryButton(
  page: Page,
  ariaLabel: "실행취소" | "다시실행",
): Promise<Locator> {
  return enabledStudioHistoryControl(page, ariaLabel === "실행취소" ? "undo" : "redo");
}

async function comparePngPixels(
  page: Page,
  first: Buffer,
  second: Buffer,
  channelTolerance: number,
  crop: PixelCrop | null = null,
): Promise<PixelDiffEvidence> {
  return page.evaluate(async ({ firstBase64, secondBase64, tolerance, cropRatios }) => {
    const [firstResponse, secondResponse] = await Promise.all([
      fetch(`data:image/png;base64,${firstBase64}`),
      fetch(`data:image/png;base64,${secondBase64}`),
    ]);
    const [firstBitmap, secondBitmap] = await Promise.all([
      createImageBitmap(await firstResponse.blob()),
      createImageBitmap(await secondResponse.blob()),
    ]);
    const firstCanvas = new OffscreenCanvas(firstBitmap.width, firstBitmap.height);
    const secondCanvas = new OffscreenCanvas(secondBitmap.width, secondBitmap.height);
    const firstContext = firstCanvas.getContext("2d", { willReadFrequently: true });
    const secondContext = secondCanvas.getContext("2d", { willReadFrequently: true });
    if (!firstContext || !secondContext) throw new Error("could not create PNG comparison context");
    firstContext.drawImage(firstBitmap, 0, 0);
    secondContext.drawImage(secondBitmap, 0, 0);
    const a = {
      width: firstCanvas.width,
      height: firstCanvas.height,
      data: firstContext.getImageData(0, 0, firstCanvas.width, firstCanvas.height).data,
    };
    const b = {
      width: secondCanvas.width,
      height: secondCanvas.height,
      data: secondContext.getImageData(0, 0, secondCanvas.width, secondCanvas.height).data,
    };
    firstBitmap.close();
    secondBitmap.close();
    if (a.width !== b.width || a.height !== b.height) {
      return {
        changedPixels: Math.max(a.width * a.height, b.width * b.height),
        totalPixels: Math.max(a.width * a.height, b.width * b.height),
        maxChannelDelta: 255,
      };
    }
    const left = cropRatios
      ? Math.max(0, Math.min(a.width - 1, Math.floor(a.width * cropRatios.leftRatio)))
      : 0;
    const top = cropRatios
      ? Math.max(0, Math.min(a.height - 1, Math.floor(a.height * cropRatios.topRatio)))
      : 0;
    const right = cropRatios
      ? Math.max(left + 1, Math.min(a.width, Math.ceil(a.width * cropRatios.rightRatio)))
      : a.width;
    const bottom = cropRatios
      ? Math.max(top + 1, Math.min(a.height, Math.ceil(a.height * cropRatios.bottomRatio)))
      : a.height;
    let changedPixels = 0;
    let maxChannelDelta = 0;
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const offset = (y * a.width + x) * 4;
        let pixelDelta = 0;
        for (let channel = 0; channel < 4; channel += 1) {
          pixelDelta = Math.max(
            pixelDelta,
            Math.abs(a.data[offset + channel]! - b.data[offset + channel]!),
          );
        }
        maxChannelDelta = Math.max(maxChannelDelta, pixelDelta);
        if (pixelDelta > tolerance) changedPixels += 1;
      }
    }
    return {
      changedPixels,
      totalPixels: (right - left) * (bottom - top),
      maxChannelDelta,
    };
  }, {
    firstBase64: first.toString("base64"),
    secondBase64: second.toString("base64"),
    tolerance: channelTolerance,
    cropRatios: crop,
  });
}

async function decodedPngStats(page: Page, bytes: Buffer): Promise<DecodedPngStats> {
  return page.evaluate(async (base64) => {
    const response = await fetch(`data:image/png;base64,${base64}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("could not create PNG statistics context");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const background = [data[0]!, data[1]!, data[2]!, data[3]!] as const;
    let backgroundDifferentPixels = 0;
    let nonTransparentPixels = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset + 3]! > 0) nonTransparentPixels += 1;
      const delta = Math.max(
        Math.abs(data[offset]! - background[0]),
        Math.abs(data[offset + 1]! - background[1]),
        Math.abs(data[offset + 2]! - background[2]),
        Math.abs(data[offset + 3]! - background[3]),
      );
      if (delta > 4) backgroundDifferentPixels += 1;
    }
    return {
      width: canvas.width,
      height: canvas.height,
      backgroundDifferentPixels,
      nonTransparentPixels,
    };
  }, bytes.toString("base64"));
}

async function captureStableStage(page: Page, stage: Locator): Promise<Buffer> {
  let current = await stage.screenshot({ animations: "disabled" });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.waitForTimeout(80);
    const next = await stage.screenshot({ animations: "disabled" });
    const diff = await comparePngPixels(page, current, next, 2);
    if (diff.changedPixels <= 3) return next;
    current = next;
  }
  return current;
}

async function countBrowserCompatibilityAutosaveKeys(page: Page): Promise<number> {
  return page.evaluate((prefix) => {
    let count = 0;
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) count += 1;
    }
    return count;
  }, AUTOSAVE_PREFIX);
}

async function captureDownload(
  page: Page,
  destination: string,
): Promise<{ bytes: Buffer; download: Download; scale: number }> {
  const button = page.locator('button[aria-label$="· 현재 페이지"]:visible').first();
  await button.waitFor({ state: "visible" });
  invariant(await button.isEnabled(), "current-page download button is disabled");
  const label = (await button.textContent()) ?? "";
  invariant(label.includes("PNG"), `lifecycle verifier requires PNG export, found: ${label.trim()}`);
  const scaleMatch = label.match(/(\d+(?:\.\d+)?)×/u);
  const scale = scaleMatch ? Number(scaleMatch[1]) : 2;
  invariant(Number.isFinite(scale) && scale > 0, `could not read export scale from: ${label.trim()}`);

  const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
  await button.click();
  const download = await downloadPromise;
  const failure = await download.failure();
  invariant(failure === null, `PNG download failed: ${failure}`);
  await download.saveAs(destination);
  const bytes = readFileSync(destination);
  invariant(bytes.byteLength > 0, "PNG download is empty");
  return { bytes, download, scale };
}

function cleanScratch(): void {
  cleanScratchDir({
    directory: SCRATCH,
    filePrefix: "studio-lifecycle-",
    extensions: [".png", ".json", ".log"],
  });
}

async function runLifecycle(browser: Browser, origin: string): Promise<LifecycleResult> {
  const studioUrl = `${origin}studio`;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const browserErrors = collectBrowserErrors(page, studioUrl);
  await installCleanStudioState(page);

  const baselinePath = join(SCRATCH, "studio-lifecycle-baseline.png");
  const committedPath = join(SCRATCH, "studio-lifecycle-committed.png");
  const undonePath = join(SCRATCH, "studio-lifecycle-undone.png");
  const redonePath = join(SCRATCH, "studio-lifecycle-redone.png");
  const reloadedPath = join(SCRATCH, "studio-lifecycle-reloaded.png");
  const beforeExportPath = join(SCRATCH, "studio-lifecycle-export-before-reload.png");
  const afterExportPath = join(SCRATCH, "studio-lifecycle-export-after-reload.png");

  try {
    await prepareStudio(page, studioUrl);
    await activatePen(page);
    const stage = page.locator(".konvajs-content").first();
    await stage.waitFor({ state: "visible" });
    await page.mouse.move(4, 4);
    const baseline = await captureStableStage(page, stage);
    writeFileSync(baselinePath, baseline);

    const stageBox = await stage.boundingBox();
    const viewport = page.viewportSize();
    invariant(stageBox && viewport, "could not measure the Studio canvas");
    const safeLeft = Math.max(stageBox.x + 70, viewport.width * 0.34);
    const safeRight = Math.min(stageBox.x + stageBox.width - 70, viewport.width * 0.66);
    const safeTop = Math.max(stageBox.y + 80, viewport.height * 0.25);
    const safeBottom = Math.min(stageBox.y + stageBox.height - 80, viewport.height * 0.58);
    invariant(safeRight - safeLeft >= 180, "visible Studio canvas is too narrow for lifecycle stroke");
    invariant(safeBottom - safeTop >= 120, "visible Studio canvas is too short for lifecycle stroke");

    const start = { x: safeLeft + 10, y: safeTop + (safeBottom - safeTop) * 0.35 };
    const artworkCrop: PixelCrop = {
      leftRatio: Math.max(0, (start.x - stageBox.x - 70) / stageBox.width),
      topRatio: Math.max(0, (start.y - stageBox.y - 70) / stageBox.height),
      rightRatio: Math.min(1, (safeRight - stageBox.x + 70) / stageBox.width),
      bottomRatio: Math.min(1, (start.y - stageBox.y + 150) / stageBox.height),
    };
    const hitCanvas = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return Boolean(target?.closest(".konvajs-content"));
    }, start);
    invariant(hitCanvas, "lifecycle pointer route is covered by Studio chrome");

    const gestureStartedAt = performance.now();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= 24; step += 1) {
      const progress = step / 24;
      await page.mouse.move(
        start.x + (safeRight - safeLeft - 20) * progress,
        start.y + Math.sin(progress * Math.PI * 2) * 34 + progress * 44,
      );
    }
    await page.mouse.up();
    const pointerReleasedAt = performance.now();
    const pointerGestureMs = performance.now() - gestureStartedAt;
    const undo = await enabledHistoryButton(page, "실행취소");
    const historyReadyAfterPointerUpMs = performance.now() - pointerReleasedAt;
    // Remove the live brush cursor from visual evidence; it is UI feedback, not committed ink.
    await page.mouse.move(4, 4);
    const committed = await captureStableStage(page, stage);
    writeFileSync(committedPath, committed);

    await undo.click();
    const redo = await enabledHistoryButton(page, "다시실행");
    const undone = await captureStableStage(page, stage);
    writeFileSync(undonePath, undone);

    await redo.click();
    const redoCompletedAt = performance.now();
    await enabledHistoryButton(page, "실행취소");
    const redone = await captureStableStage(page, stage);
    writeFileSync(redonePath, redone);

    // V12 writes the authoritative snapshot to OPFS/SQLite and deliberately deletes the old
    // localStorage JSON compatibility slot. Give the shipped debounce one bounded settle window;
    // the reload/recovery UI and pixel-identical export below are the persistence receipt.
    await page.waitForTimeout(DURABLE_AUTOSAVE_SETTLE_MS);
    const autosaveSettleBeforeReloadMs = performance.now() - redoCompletedAt;
    const browserCompatibilityKeysBeforeReload = await countBrowserCompatibilityAutosaveKeys(page);
    invariant(
      browserCompatibilityKeysBeforeReload === 0,
      "durable autosave left a browser compatibility record before reload",
    );

    const beforeDownload = await captureDownload(page, beforeExportPath);
    const beforePng = inspectPngIntegrity(beforeDownload.bytes);
    const beforeStats = await decodedPngStats(page, beforeDownload.bytes);
    invariant(
      beforeStats.backgroundDifferentPixels >= 8,
      "PNG export contains no visible stroke pixels",
    );
    const expectedWidth = Math.round(STUDIO_CANVAS_WIDTH * beforeDownload.scale);
    const expectedHeight = Math.round(DEFAULT_CANVAS_H * beforeDownload.scale);
    invariant(
      beforePng.width === expectedWidth && beforePng.height === expectedHeight,
      `PNG dimensions are ${beforePng.width}x${beforePng.height}, expected ${expectedWidth}x${expectedHeight}`,
    );

    const reloadStartedAt = performance.now();
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.locator('[data-studio-editor="true"]').waitFor({ state: "visible", timeout: 12_000 });
    await dismissQuickStart(page);
    // Playwright preserves the physical pointer across navigation. The pre-reload download leaves
    // it over the menubar, which can legitimately reopen a rich tool hint above the recovery rail.
    await page.mouse.move(4, 4);
    await page.keyboard.press("Escape");
    const recoveryMessage = page.getByText(
      "이전에 작성 중이던 임시저장 데이터가 있습니다.",
      { exact: false },
    );
    await recoveryMessage.waitFor({ state: "visible", timeout: 8_000 });
    const recoveryReadyAfterReloadMs = performance.now() - reloadStartedAt;
    const browserCompatibilityKeysAtRecovery = await countBrowserCompatibilityAutosaveKeys(page);
    invariant(
      browserCompatibilityKeysAtRecovery === 0,
      "reload recovery was backed by a browser compatibility record instead of OPFS/SQLite",
    );
    await page.getByRole("button", { name: "복구하기", exact: true }).click();
    await recoveryMessage.waitFor({ state: "detached", timeout: 8_000 });

    const restoredStage = page.locator(".konvajs-content").first();
    await restoredStage.waitFor({ state: "visible" });
    await page.mouse.move(4, 4);
    let reloaded = await captureStableStage(page, restoredStage);
    let redoneToReloaded = await comparePngPixels(page, redone, reloaded, 2, artworkCrop);
    for (let attempt = 0; attempt < 8 && redoneToReloaded.changedPixels > 192; attempt += 1) {
      await page.waitForTimeout(120);
      reloaded = await captureStableStage(page, restoredStage);
      redoneToReloaded = await comparePngPixels(page, redone, reloaded, 2, artworkCrop);
    }
    writeFileSync(reloadedPath, reloaded);

    const afterDownload = await captureDownload(page, afterExportPath);
    const afterPng = inspectPngIntegrity(afterDownload.bytes);
    const afterStats = await decodedPngStats(page, afterDownload.bytes);
    invariant(
      afterPng.width === expectedWidth && afterPng.height === expectedHeight,
      `reloaded PNG dimensions are ${afterPng.width}x${afterPng.height}, expected ${expectedWidth}x${expectedHeight}`,
    );
    invariant(
      afterStats.backgroundDifferentPixels >= 8,
      "reloaded PNG export contains no visible stroke pixels",
    );

    const visual = {
      blankToCommitted: await comparePngPixels(page, baseline, committed, 2, artworkCrop),
      blankToUndone: await comparePngPixels(page, baseline, undone, 2, artworkCrop),
      committedToRedone: await comparePngPixels(page, committed, redone, 2, artworkCrop),
      redoneToReloaded,
      beforeToAfterReloadExport: await comparePngPixels(
        page,
        beforeDownload.bytes,
        afterDownload.bytes,
        0,
      ),
    };
    const visualViolations = studioLifecycleVisualViolations(visual);
    log(`visual evidence: ${JSON.stringify(visual)}`);
    invariant(
      visualViolations.length === 0,
      `lifecycle visual policy failed: ${visualViolations.join("; ")}`,
    );
    invariant(
      browserErrors.messages.length === 0,
      `unexpected browser errors: ${browserErrors.messages.slice(0, 5).join(" | ")}`,
    );
    invariant(
      browserErrors.failedResponses.length === 0,
      `unexpected 5xx responses: ${browserErrors.failedResponses.slice(0, 5).join(" | ")}`,
    );

    const result: LifecycleResult = {
      ok: true,
      origin,
      externalPreview: Boolean(process.env.TOONSPECTRUM_VERIFY_ORIGIN?.trim()),
      autosave: {
        authority: "durable-reload-recovery",
        recoveryBannerObserved: true,
        restoreActionCompleted: true,
        browserCompatibilityKeysBeforeReload,
        browserCompatibilityKeysAtRecovery,
      },
      timings: {
        pointerGestureMs,
        historyReadyAfterPointerUpMs,
        autosaveSettleBeforeReloadMs,
        recoveryReadyAfterReloadMs,
      },
      visual,
      export: {
        beforeReload: {
          ...beforePng,
          ...beforeStats,
          sha256: sha256(beforeDownload.bytes),
          bytes: beforeDownload.bytes.byteLength,
          path: beforeExportPath,
        },
        afterReload: {
          ...afterPng,
          ...afterStats,
          sha256: sha256(afterDownload.bytes),
          bytes: afterDownload.bytes.byteLength,
          path: afterExportPath,
        },
        expectedWidth,
        expectedHeight,
      },
      artifacts: {
        directory: SCRATCH,
        baseline: baselinePath,
        committed: committedPath,
        undone: undonePath,
        redone: redonePath,
        reloaded: reloadedPath,
        report: REPORT_PATH,
      },
      browserErrors,
      limitations: [
        "Persistence coverage is the shipped OPFS/SQLite autosave and reload/recovery UI path, not authenticated server/database save.",
        "historyReadyAfterPointerUpMs includes Playwright transport and DOM polling overhead; it is diagnostic, not input-latency p95.",
        "The gate covers Chromium production preview and one default opaque pen stroke, not every brush/backend/browser.",
      ],
    };
    writeFileSync(REPORT_PATH, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  cleanScratch();
  const externalOrigin = process.env.TOONSPECTRUM_VERIFY_ORIGIN?.trim();
  if (!externalOrigin) {
    invariant(
      existsSync(join(DIST_DIR, "index.html")),
      "dist/index.html is missing; run `pnpm build` before the lifecycle verifier",
    );
  }
  const port = externalOrigin ? null : await findFreePort();
  const origin = externalOrigin
    ? `${externalOrigin.replace(/\/+$/u, "")}/`
    : `http://127.0.0.1:${port}/`;
  const server: ChildProcess | null = port === null
    ? null
    : spawnVitePreview({ port, runner: "node-vite-bin", logPath: LOG_PATH });

  let browser: Browser | null = null;
  try {
    await waitForServer(origin);
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const result = await runLifecycle(browser, origin);
    await browser.close();
    browser = null;
    log("POINTER → UNDO/REDO → AUTOSAVE/RELOAD → PNG EXPORT GATE OK");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (server) await stopChildProcess(server).catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    log(`FATAL: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
