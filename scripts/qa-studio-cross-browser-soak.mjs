import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium, firefox, webkit } from "playwright";

const BROWSER_NAME = process.env.QA_BROWSER ?? "chromium";
const PROFILE_ID = process.env.QA_PROFILE_ID ?? "kakaotalk-360";
const WIDTH = Number(process.env.QA_VIEWPORT_WIDTH ?? 360);
const HEIGHT = Number(process.env.QA_VIEWPORT_HEIGHT ?? 592);
const USER_AGENT = process.env.QA_USER_AGENT ??
  "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 KAKAOTALK 10.4.3";
const BASE_URL = (process.env.STUDIO_BASE_URL ?? "http://127.0.0.1:4173").replace(/\/+$/, "");
const SOAK_MINUTES = Math.max(1, Number(process.env.QA_SOAK_MINUTES ?? 50));
const DEADLINE = Date.now() + SOAK_MINUTES * 60_000;
const REPORT_DIR = process.env.QA_REPORT_DIR ?? `qa-results/studio-cross-browser-soak/${BROWSER_NAME}-${PROFILE_ID}`;
const EVIDENCE_DIR = process.env.QA_EVIDENCE_DIR ?? `artifacts/studio-cross-browser-soak/${BROWSER_NAME}-${PROFILE_ID}`;
const RESULTS_PATH = path.join(REPORT_DIR, "cases.jsonl");
const MIN_TAP_PX = 43.5;

const ROUTES = Object.freeze([
  { id: "editor", pathname: "/studio", ready: "main, canvas, [data-studio-mobile-editing-dock='true']", interactive: true },
  { id: "comic", pathname: "/studio/comic", ready: "main, canvas, [data-studio-mobile-editing-dock='true']", interactive: true },
  { id: "animation", pathname: "/studio/animation", ready: "main, canvas, [data-studio-mobile-editing-dock='true']", interactive: true },
  { id: "brushes", pathname: "/studio/brushes", ready: "main, canvas, [data-studio-mobile-editing-dock='true']", interactive: true },
  { id: "publish", pathname: "/studio/publish", ready: "main, h1" },
  { id: "companion-workspace", pathname: "/studio/companion/workspace", ready: "main, h1" },
  { id: "companion-review", pathname: "/studio/companion/review", ready: "main, h1" },
  { id: "lift3d", pathname: "/studio/lift3d", ready: "main, h1, canvas" },
  { id: "projects", pathname: "/studio/projects", ready: "main, h1" },
  { id: "invalid-route", pathname: "/studio/qa-not-found", ready: "main, h1" },
]);

const browserTypes = { chromium, firefox, webkit };
const browserType = browserTypes[BROWSER_NAME];
if (!browserType) throw new Error(`Unsupported QA_BROWSER: ${BROWSER_NAME}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digest = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);
const textError = (error) => String(error?.stack ?? error?.message ?? error).slice(0, 2_000);
const safeFilePart = (value) => value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/(?:^-+|-+$)/g, "");

async function inspectDom(page) {
  return page.evaluate((minimumTap) => { // NOSONAR javascript:S3776
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width >= 2 && rect.height >= 2 && rect.bottom > 0 && rect.top < vh;
    };
    const describe = (element) => {
      const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 64);
      const name = element.getAttribute("aria-label") ?? element.getAttribute("title") ?? text;
      return element.tagName.toLowerCase() + (name ? `[${name}]` : "");
    };
    const inHorizontalScroller = (element) => {
      let current = element.parentElement;
      while (current && current !== document.body) {
        const style = getComputedStyle(current);
        if (["auto", "scroll"].includes(style.overflowX) && current.scrollWidth > current.clientWidth + 1) return true;
        current = current.parentElement;
      }
      return false;
    };

    const selector = "button, a[href], input:not([type='hidden']), select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])";
    const controls = [...document.querySelectorAll(selector)].filter(visible);
    const offscreen = [];
    const smallTargets = [];
    const unnamed = [];
    const popupOnly = [];
    for (const control of controls) {
      const rect = control.getBoundingClientRect();
      const disabled = control.matches(":disabled") || control.getAttribute("aria-disabled") === "true";
      const inScroller = inHorizontalScroller(control);
      const wrappingLabel = control.closest("label");
      const name =
        (control.textContent ?? "").trim() ||
        (wrappingLabel?.textContent ?? "").trim() ||
        control.getAttribute("aria-label") ||
        control.getAttribute("aria-labelledby") ||
        control.getAttribute("title") ||
        control.getAttribute("alt") ||
        "";
      if (!inScroller && (rect.left < -0.5 || rect.right > vw + 0.5)) {
        offscreen.push({ label: describe(control), rect: [Number(rect.left.toFixed(1)), Number(rect.right.toFixed(1))] });
      }
      if (!disabled && !inScroller && (rect.width < minimumTap || rect.height < minimumTap)) {
        smallTargets.push({ label: describe(control), size: [Number(rect.width.toFixed(1)), Number(rect.height.toFixed(1))] });
      }
      if (!name) unnamed.push({ label: describe(control) });
      if (control.getAttribute("target") === "_blank" || control.hasAttribute("data-studio-presence-companion-tab")) {
        popupOnly.push({ label: describe(control) });
      }
    }

    const bodyText = (document.body?.innerText ?? "").trim();
    const canvases = [...document.querySelectorAll("canvas")].map((canvas, index) => {
      const rect = canvas.getBoundingClientRect();
      return { index, x: rect.x, y: rect.y, width: rect.width, height: rect.height, area: rect.width * rect.height };
    }).filter((canvas) => canvas.width >= 2 && canvas.height >= 2).sort((a, b) => b.area - a.area);
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const activeRect = active?.getBoundingClientRect();
    return {
      activeElement: active ? describe(active) : null,
      activeElementOffscreen: Boolean(activeRect && (activeRect.left < 0 || activeRect.right > vw || activeRect.top < 0 || activeRect.bottom > vh)),
      bodyPreview: bodyText.replace(/\s+/g, " ").slice(0, 260),
      bodyTextLength: bodyText.length,
      canvasCount: canvases.length,
      controls: controls.length,
      documentOverflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      largestCanvas: canvases[0] ?? null,
      offscreen: offscreen.slice(0, 40),
      popupOnly: popupOnly.slice(0, 20),
      smallTargets: smallTargets.slice(0, 60),
      unnamed: unnamed.slice(0, 60),
      viewport: { width: vw, height: vh },
      visualCount: document.querySelectorAll("canvas, svg, img, video, iframe, [data-studio-mobile-editing-dock='true']").length,
    };
  }, MIN_TAP_PX);
}

async function probeCanvas(page, dom) {
  const canvas = dom.largestCanvas;
  if (!canvas || canvas.width < 100 || canvas.height < 100) return { attempted: false, reason: "no canvas >= 100x100" };
  const locator = page.locator("canvas").nth(canvas.index);
  const before = await locator.screenshot({ animations: "disabled" }).catch(() => null);
  if (!before) return { attempted: false, reason: "canvas screenshot failed" };
  const x1 = canvas.x + Math.max(24, canvas.width * 0.35);
  const y1 = canvas.y + Math.max(24, canvas.height * 0.45);
  const x2 = Math.min(canvas.x + canvas.width - 24, x1 + Math.min(110, canvas.width * 0.22));
  const y2 = Math.min(canvas.y + canvas.height - 24, y1 + Math.min(70, canvas.height * 0.14));
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 16 });
  await page.mouse.up();
  await sleep(120);
  const afterDraw = await locator.screenshot({ animations: "disabled" }).catch(() => null);
  await page.keyboard.press("Control+z").catch(() => undefined);
  await page.keyboard.press("Meta+z").catch(() => undefined);
  await sleep(80);
  await page.keyboard.press("Control+Shift+z").catch(() => undefined);
  await page.keyboard.press("Meta+Shift+z").catch(() => undefined);
  const afterHistory = await locator.screenshot({ animations: "disabled" }).catch(() => null);
  return {
    attempted: true,
    drawChanged: Boolean(afterDraw && digest(before) !== digest(afterDraw)),
    historyChanged: Boolean(afterDraw && afterHistory && digest(afterDraw) !== digest(afterHistory)),
    size: [Number(canvas.width.toFixed(1)), Number(canvas.height.toFixed(1))],
  };
}

async function probeButton(page, selector, expectedSelector, label) {
  const trigger = page.locator(selector).first();
  if ((await trigger.count()) === 0 || !(await trigger.isVisible().catch(() => false))) return { attempted: false };
  const baselineDialogs = await page.locator("[role='dialog']:visible").count().catch(() => 0);
  try {
    await trigger.click({ timeout: 2_500 });
    await sleep(120);
    const expectedVisible = expectedSelector ? await page.locator(expectedSelector).first().isVisible().catch(() => false) : null;
    const dialogs = await page.locator("[role='dialog']:visible").count().catch(() => baselineDialogs);
    const expanded = await trigger.getAttribute("aria-expanded").catch(() => null);
    const opened = expectedVisible === true || dialogs > baselineDialogs || expanded === "true";
    await page.keyboard.press("Escape").catch(() => undefined);
    return { attempted: true, opened, expectedVisible, expanded };
  } catch (error) {
    return { attempted: true, opened: false, error: `${label}: ${textError(error)}` };
  }
}

async function probeInteractions(page, route, dom) { // NOSONAR javascript:S3776
  const result = {};
  if (route.interactive) {
    result.canvas = await probeCanvas(page, dom);
    result.pageList = await probeButton(page, "button[aria-label='페이지 목록 열기']", null, "page-list");
    result.workspace = await probeButton(page, "button[aria-haspopup='dialog'][aria-label^='작업공간:']", "[role='dialog']:visible", "workspace");
    const fullScreen = page.locator("button[aria-label='전체 화면 드로잉']").first();
    if ((await fullScreen.count()) > 0 && await fullScreen.isVisible().catch(() => false)) {
      try {
        await fullScreen.click({ timeout: 2_500 });
        await sleep(100);
        const exit = page.locator("button[aria-label='전체 화면 드로잉 종료']").first();
        result.fullScreen = {
          attempted: true,
          exitVisible: await exit.isVisible().catch(() => false),
          exitBox: await exit.boundingBox().catch(() => null),
        };
        if (result.fullScreen.exitVisible) await exit.click({ timeout: 2_500 }).catch((error) => { result.fullScreen.exitError = textError(error); });
      } catch (error) {
        result.fullScreen = { attempted: true, exitVisible: false, error: textError(error) };
      }
    } else result.fullScreen = { attempted: false };
  }

  if (route.id === "comic") {
    const close = page.getByRole("button", { name: /빠른 시작 닫기/u }).first();
    if ((await close.count()) > 0 && await close.isVisible().catch(() => false)) {
      result.quickStartClose = { attempted: true, box: await close.boundingBox().catch(() => null) };
      await close.click({ timeout: 2_500 }).then(() => { result.quickStartClose.clicked = true; }).catch((error) => {
        result.quickStartClose.clicked = false;
        result.quickStartClose.error = textError(error);
      });
    } else result.quickStartClose = { attempted: false };
  }

  for (let index = 0; index < 8; index += 1) await page.keyboard.press("Tab").catch(() => undefined);
  result.focus = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return { present: false };
    const rect = active.getBoundingClientRect();
    return {
      present: true,
      name: active.getAttribute("aria-label") ?? active.getAttribute("title") ?? (active.textContent ?? "").trim().slice(0, 80),
      offscreen: rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight,
      rect: [Number(rect.left.toFixed(1)), Number(rect.top.toFixed(1)), Number(rect.right.toFixed(1)), Number(rect.bottom.toFixed(1))],
    };
  });
  return result;
}

function classify({ route, status, navigationError, ready, dom, pageErrors, consoleErrors, requestFailures, interactions, offlineRecovery }) { // NOSONAR javascript:S3776
  const failures = [];
  const warnings = [];
  if (navigationError) failures.push(`navigation: ${navigationError}`);
  if (status !== null && status >= 400) failures.push(`document HTTP ${status}`);
  if (!ready) failures.push(`ready selector missing: ${route.ready}`);
  if (dom.bodyTextLength === 0 && dom.visualCount === 0) failures.push("blank page");
  if (dom.documentOverflowX > 2) failures.push(`document horizontal overflow ${dom.documentOverflowX}px`);
  if (dom.offscreen.length > 0) failures.push(`${dom.offscreen.length} visible controls outside viewport`);
  if (pageErrors.length > 0) failures.push(`${pageErrors.length} uncaught page errors`);
  if (interactions.workspace?.attempted && !interactions.workspace.opened) failures.push("workspace trigger did not open dialog");
  if (interactions.fullScreen?.attempted && !interactions.fullScreen.exitVisible) failures.push("full-screen exit control not visible");
  if (interactions.fullScreen?.exitError) failures.push("full-screen exit control could not be clicked");
  if (interactions.quickStartClose?.attempted && interactions.quickStartClose.clicked === false) failures.push("quick-start close control could not be clicked");
  if (interactions.focus?.offscreen) failures.push("keyboard focus moved outside viewport");
  if (offlineRecovery?.attempted && !offlineRecovery.recovered) failures.push("failed to recover after offline reload");

  if (dom.smallTargets.length > 0) warnings.push(`${dom.smallTargets.length} touch targets below 44px`);
  if (dom.unnamed.length > 0) warnings.push(`${dom.unnamed.length} controls without accessible name`);
  if (dom.popupOnly.length > 0) warnings.push(`${dom.popupOnly.length} popup-only controls`);
  if (consoleErrors.length > 0) warnings.push(`${consoleErrors.length} console errors`);
  if (requestFailures.length > 0) warnings.push(`${requestFailures.length} failed requests`);
  if (route.interactive && interactions.canvas?.attempted && !interactions.canvas.drawChanged) warnings.push("canvas stroke caused no visible pixel change");
  if (route.id === "invalid-route" && !/404|not found|찾을 수|존재하지/u.test(dom.bodyPreview)) warnings.push("invalid route lacks obvious not-found copy");
  return { failures, warnings };
}

async function runRoute(context, cycle, route, settings, seenSignatures) { // NOSONAR javascript:S3776
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];
  page.on("pageerror", (error) => pageErrors.push(textError(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon|fonts\.googleapis|fonts\.gstatic/u.test(message.text())) consoleErrors.push(message.text().slice(0, 1_000));
  });
  page.on("requestfailed", (request) => {
    const text = `${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? "failed"}`;
    if (!/favicon|fonts\.googleapis|fonts\.gstatic/u.test(text)) requestFailures.push(text.slice(0, 1_200));
  });
  await page.addInitScript(({ blockPopups }) => {
    if (blockPopups) window.open = () => null;
  }, { blockPopups: settings.blockPopups });

  let status = null;
  let navigationError = null;
  try {
    const response = await page.goto(`${BASE_URL}${route.pathname}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    status = response?.status() ?? null;
  } catch (error) {
    navigationError = textError(error);
  }
  const ready = navigationError ? false : await page.locator(route.ready).first().waitFor({ state: "attached", timeout: 8_000 }).then(() => true).catch(() => false);
  await sleep(220);
  const dom = await inspectDom(page).catch((error) => ({
    bodyPreview: "", bodyTextLength: 0, canvasCount: 0, controls: 0, documentOverflowX: 0, largestCanvas: null,
    offscreen: [], popupOnly: [], smallTargets: [], unnamed: [], viewport: settings.viewport, visualCount: 0,
    inspectError: textError(error),
  }));
  const interactions = navigationError ? {} : await probeInteractions(page, route, dom).catch((error) => ({ probeError: textError(error) }));

  let offlineRecovery = { attempted: false };
  if (route.id === "editor" && cycle % 4 === 3 && Date.now() + 12_000 < DEADLINE) {
    offlineRecovery = { attempted: true, offlineShellVisible: false, recovered: false };
    await context.setOffline(true).catch(() => undefined);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 5_000 }).catch(() => undefined);
    offlineRecovery.offlineShellVisible = await page.locator("body").evaluate((body) => body.innerText.trim().length > 0 || body.querySelector("canvas, main, svg") !== null).catch(() => false);
    await context.setOffline(false).catch(() => undefined);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
    offlineRecovery.recovered = await page.locator(route.ready).first().waitFor({ state: "attached", timeout: 8_000 }).then(() => true).catch(() => false);
  }

  const classified = classify({ route, status, navigationError, ready, dom, pageErrors, consoleErrors, requestFailures, interactions, offlineRecovery });
  const signaturePayload = {
    route: route.id,
    failures: classified.failures,
    offscreen: dom.offscreen.map((item) => item.label),
    smallTargets: dom.smallTargets.map((item) => item.label),
    unnamed: dom.unnamed.map((item) => item.label),
    consoleErrors,
    pageErrors,
  };
  const signature = digest(JSON.stringify(signaturePayload));
  let screenshot = null;
  if ((classified.failures.length > 0 || classified.warnings.length > 0) && !seenSignatures.has(signature)) {
    seenSignatures.add(signature);
    screenshot = path.join(EVIDENCE_DIR, `${safeFilePart(BROWSER_NAME)}-${safeFilePart(PROFILE_ID)}-${route.id}-${signature}.png`);
    await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" }).catch(() => { screenshot = null; });
  }
  const heap = await page.evaluate(() => {
    const memory = performance.memory;
    return memory ? { used: memory.usedJSHeapSize, total: memory.totalJSHeapSize, limit: memory.jsHeapSizeLimit } : null;
  }).catch(() => null);
  const result = {
    at: new Date().toISOString(),
    browser: BROWSER_NAME,
    profile: PROFILE_ID,
    cycle,
    route: route.id,
    url: `${BASE_URL}${route.pathname}`,
    settings,
    status,
    ready,
    navigationError,
    failures: classified.failures,
    warnings: classified.warnings,
    dom,
    interactions,
    offlineRecovery,
    pageErrors,
    consoleErrors,
    requestFailures,
    heap,
    signature,
    screenshot,
  };
  await appendFile(RESULTS_PATH, `${JSON.stringify(result)}\n`);
  await page.close().catch(() => undefined);
  return result;
}

await mkdir(REPORT_DIR, { recursive: true });
await mkdir(EVIDENCE_DIR, { recursive: true });
await writeFile(RESULTS_PATH, "");
const browser = await browserType.launch({ headless: true });
const startedAt = Date.now();
const results = [];
const seenSignatures = new Set();
let cycle = 0;

try {
  while (Date.now() < DEADLINE) {
    const landscape = cycle % 2 === 1;
    const viewport = landscape ? { width: HEIGHT, height: WIDTH } : { width: WIDTH, height: HEIGHT };
    let deviceScaleFactor = 3;
    if (cycle % 3 === 0) deviceScaleFactor = 1;
    else if (cycle % 3 === 1) deviceScaleFactor = 2;
    const settings = {
      blockPopups: cycle % 3 !== 2,
      colorScheme: cycle % 2 === 0 ? "light" : "dark",
      deviceScaleFactor,
      orientation: landscape ? "landscape" : "portrait",
      reducedMotion: cycle % 4 < 2 ? "no-preference" : "reduce",
      viewport,
    };
    const contextOptions = {
      colorScheme: settings.colorScheme,
      deviceScaleFactor: settings.deviceScaleFactor,
      hasTouch: true,
      locale: "ko-KR",
      reducedMotion: settings.reducedMotion,
      timezoneId: "Asia/Seoul",
      userAgent: USER_AGENT,
      viewport,
    };
    if (BROWSER_NAME !== "firefox") contextOptions.isMobile = true;
    const context = await browser.newContext(contextOptions);
    try {
      for (const route of ROUTES) {
        if (Date.now() >= DEADLINE) break;
        const result = await runRoute(context, cycle, route, settings, seenSignatures);
        results.push(result);
        process.stdout.write(
          `[soak] ${BROWSER_NAME}/${PROFILE_ID} cycle=${cycle} ${settings.orientation}/${settings.colorScheme}/dpr${settings.deviceScaleFactor} ` +
          `${route.id}: failures=${result.failures.length} warnings=${result.warnings.length}\n`,
        );
      }
    } finally {
      await context.close().catch(() => undefined);
    }
    cycle += 1;
  }
} finally {
  await browser.close().catch(() => undefined);
}

const signatureCounts = new Map();
for (const result of results) {
  if (result.failures.length === 0 && result.warnings.length === 0) continue;
  const previous = signatureCounts.get(result.signature) ?? {
    signature: result.signature,
    count: 0,
    browsers: new Set(),
    profiles: new Set(),
    routes: new Set(),
    failures: result.failures,
    warnings: result.warnings,
    sampleScreenshot: result.screenshot,
  };
  previous.count += 1;
  previous.browsers.add(result.browser);
  previous.profiles.add(result.profile);
  previous.routes.add(result.route);
  if (!previous.sampleScreenshot && result.screenshot) previous.sampleScreenshot = result.screenshot;
  signatureCounts.set(result.signature, previous);
}
const recurring = [...signatureCounts.values()].map((item) => ({
  ...item,
  browsers: [...item.browsers],
  profiles: [...item.profiles],
  routes: [...item.routes],
})).sort((a, b) => b.count - a.count);
const summary = {
  generatedAt: new Date().toISOString(),
  browser: BROWSER_NAME,
  profile: PROFILE_ID,
  baseUrl: BASE_URL,
  requestedSoakMinutes: SOAK_MINUTES,
  elapsedMinutes: Number(((Date.now() - startedAt) / 60_000).toFixed(2)),
  cycles: cycle,
  cases: results.length,
  failedCases: results.filter((result) => result.failures.length > 0).length,
  warningCases: results.filter((result) => result.warnings.length > 0).length,
  uniqueFindingSignatures: recurring.length,
  recurring: recurring.slice(0, 100),
};
await writeFile(path.join(REPORT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(path.join(REPORT_DIR, "report.md"), [
  `# Studio cross-browser soak: ${BROWSER_NAME} / ${PROFILE_ID}`,
  "",
  `- Base URL: ${BASE_URL}`,
  `- Requested soak: ${SOAK_MINUTES} minutes`,
  `- Actual elapsed: ${summary.elapsedMinutes} minutes`,
  `- Cycles: ${summary.cycles}`,
  `- Route cases: ${summary.cases}`,
  `- Cases with hard failures: ${summary.failedCases}`,
  `- Cases with warnings: ${summary.warningCases}`,
  `- Unique finding signatures: ${summary.uniqueFindingSignatures}`,
  "",
  "## Most recurrent findings",
  "",
  ...recurring.slice(0, 30).flatMap((item) => [
    `### ${item.signature} — ${item.count} occurrences`,
    "",
    `- Routes: ${item.routes.join(", ")}`,
    `- Failures: ${item.failures.join("; ") || "none"}`,
    `- Warnings: ${item.warnings.join("; ") || "none"}`,
    `- Screenshot: ${item.sampleScreenshot ?? "none"}`,
    "",
  ]),
].join("\n"));

console.log(JSON.stringify(summary, null, 2));
