import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

const BASE_URL = (process.env.STUDIO_BASE_URL ?? "https://www.toonstudio.cloud").replace(/\/+$/, "");
const REPORT_DIR = process.env.QA_REPORT_DIR ?? "qa-results/studio-inapp-audit-2026-09-02/live";
const EVIDENCE_DIR = process.env.QA_EVIDENCE_DIR ?? "artifacts/studio-live-inapp";
const NAVIGATION_TIMEOUT_MS = Number(process.env.QA_NAVIGATION_TIMEOUT_MS ?? 60_000);
const SETTLE_MS = Number(process.env.QA_SETTLE_MS ?? 3_000);
const MIN_TAP_PX = 43.5;

const PROFILES = Object.freeze([
  {
    id: "kakaotalk-android-360",
    width: 360,
    height: 592,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 KAKAOTALK 10.4.3",
  },
  {
    id: "instagram-ios-390",
    width: 390,
    height: 664,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Mobile/21E236 Instagram 320.0.0.0.0 (iPhone15,3; iOS 17_4; ko_KR)",
  },
  {
    id: "naver-android-412",
    width: 412,
    height: 700,
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; SM-G991N Build/TP1A.220624.014; wv) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Version/4.0 Chrome/122.0.0.0 Mobile Safari/537.36 NAVER(inapp; search; 1000; 12.9.1)",
  },
]);

const VALID_COMPANION_SESSION = "studio-inapp-live-session-0001";
const ROUTES = Object.freeze([
  { id: "editor", pathname: "/studio", ready: '[data-studio-mobile-editing-dock="true"], canvas, main' },
  { id: "comic", pathname: "/studio/comic", ready: '[data-studio-mobile-editing-dock="true"], canvas, main' },
  { id: "animation", pathname: "/studio/animation", ready: '[data-studio-mobile-editing-dock="true"], canvas, main' },
  { id: "brushes", pathname: "/studio/brushes", ready: '[data-studio-mobile-editing-dock="true"], canvas, main' },
  { id: "publish", pathname: "/studio/publish", ready: "h1, main" },
  { id: "companion-workspace", pathname: "/studio/companion/workspace", ready: "h1, main" },
  { id: "companion-review", pathname: "/studio/companion/review", ready: "h1, main" },
  {
    id: "companion-workspace-session",
    pathname: `/studio/companion/workspace?session=${VALID_COMPANION_SESSION}`,
    ready: "h1, main",
    profiles: ["kakaotalk-android-360"],
  },
  {
    id: "companion-review-session",
    pathname: `/studio/companion/review?session=${VALID_COMPANION_SESSION}`,
    ready: "h1, main",
    profiles: ["kakaotalk-android-360"],
  },
  { id: "lift3d", pathname: "/studio/lift3d", ready: "h1, main, canvas" },
  { id: "projects", pathname: "/studio/projects", ready: "h1, main" },
  { id: "invalid-route", pathname: "/studio/nope", ready: "h1, main" },
]);

const IGNORED_NETWORK_FRAGMENTS = Object.freeze([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
  "/favicon",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slug(value) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/(?:^-+|-+$)/g, "");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isIgnoredNetworkMessage(text) {
  return IGNORED_NETWORK_FRAGMENTS.some((fragment) => text.includes(fragment));
}

async function inspectDom(page) {
  return page.evaluate((minTapPx) => { // NOSONAR javascript:S3776
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const epsilon = 0.5;

    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width >= 2 && rect.height >= 2 && rect.bottom > 0 && rect.top < vh;
    };

    const describe = (element) => {
      const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
      const label = element.getAttribute("aria-label") ?? element.getAttribute("title") ?? text;
      return element.tagName.toLowerCase() + (label ? `[${label}]` : "");
    };

    const insideHorizontalScroller = (element) => {
      let current = element.parentElement;
      while (current && current !== document.body) {
        const style = getComputedStyle(current);
        if (["auto", "scroll"].includes(style.overflowX) && current.scrollWidth > current.clientWidth + 1) return true;
        current = current.parentElement;
      }
      return false;
    };

    const interactiveSelector = "button, a[href], input:not([type='hidden']), select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])";
    const controls = [...document.querySelectorAll(interactiveSelector)].filter(visible);
    const smallTargets = [];
    const unnamedControls = [];
    const offscreenControls = [];
    const deadPopupControls = [];
    const exitAffordances = [];

    for (const control of controls) {
      const rect = control.getBoundingClientRect();
      const disabled = control.matches(":disabled") || control.getAttribute("aria-disabled") === "true";
      const inScroller = insideHorizontalScroller(control);
      const wrappingLabel = control.closest("label");
      const name =
        (control.textContent ?? "").trim() ||
        (wrappingLabel?.textContent ?? "").trim() ||
        control.getAttribute("aria-label") ||
        control.getAttribute("aria-labelledby") ||
        control.getAttribute("title") ||
        control.getAttribute("alt") ||
        "";

      if (!inScroller && !disabled && (rect.width < minTapPx || rect.height < minTapPx)) {
        smallTargets.push({ label: describe(control), size: `${rect.width.toFixed(1)}x${rect.height.toFixed(1)}` });
      }
      if (!name) unnamedControls.push({ label: describe(control) });
      if (!inScroller && (rect.left < -epsilon || rect.right > vw + epsilon)) {
        offscreenControls.push({
          label: describe(control),
          rect: [Number(rect.left.toFixed(1)), Number(rect.right.toFixed(1))],
        });
      }
      if (control.getAttribute("target") === "_blank" || control.hasAttribute("data-studio-presence-companion-tab")) {
        deadPopupControls.push({ label: describe(control) });
      }

      if (control instanceof HTMLAnchorElement) {
        try {
          const url = new URL(control.href, location.href);
          if (url.origin === location.origin && url.pathname !== location.pathname) exitAffordances.push(describe(control));
        } catch {
          // Ignore malformed links; the browser will not navigate them either.
        }
      }
      const actionText = `${name} ${control.getAttribute("data-testid") ?? ""}`.toLowerCase();
      if (/back|exit|close|home|나가기|닫기|뒤로|홈/.test(actionText)) exitAffordances.push(describe(control));
    }

    const bodyText = (document.body?.innerText ?? "").trim();
    const visualSurfaceCount = document.querySelectorAll("canvas, svg, img, video, iframe, [data-studio-mobile-editing-dock='true']").length;
    const docOverflowX = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const largestCanvas = [...document.querySelectorAll("canvas")]
      .map((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return { width: rect.width, height: rect.height, area: rect.width * rect.height };
      })
      .sort((a, b) => b.area - a.area)[0] ?? null;

    return {
      bodyTextLength: bodyText.length,
      bodyPreview: bodyText.replace(/\s+/g, " ").slice(0, 240),
      controls: controls.length,
      deadPopupControls: deadPopupControls.slice(0, 30),
      docOverflowX,
      exitAffordances: [...new Set(exitAffordances)].slice(0, 30),
      largestCanvas,
      offscreenControls: offscreenControls.slice(0, 30),
      smallTargets: smallTargets.slice(0, 50),
      unnamedControls: unnamedControls.slice(0, 50),
      visualSurfaceCount,
      viewport: { width: vw, height: vh },
    };
  }, MIN_TAP_PX);
}

async function probeEditorStroke(page) {
  const canvasLocator = page.locator("canvas:visible");
  const count = await canvasLocator.count();
  let largest = null;
  for (let index = 0; index < count; index += 1) {
    const box = await canvasLocator.nth(index).boundingBox().catch(() => null);
    if (!box || box.width < 80 || box.height < 80) continue;
    if (!largest || box.width * box.height > largest.box.width * largest.box.height) largest = { index, box };
  }
  if (!largest) return { attempted: false, changed: null, reason: "no visible canvas >= 80x80" };

  const before = await page.screenshot({ animations: "disabled" });
  const { box } = largest;
  const startX = box.x + Math.min(Math.max(box.width * 0.35, 24), box.width - 24);
  const startY = box.y + Math.min(Math.max(box.height * 0.45, 24), box.height - 24);
  const endX = Math.min(box.x + box.width - 24, startX + Math.max(32, Math.min(100, box.width * 0.2)));
  const endY = Math.min(box.y + box.height - 24, startY + Math.max(18, Math.min(60, box.height * 0.12)));

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();
  await sleep(500);
  await page.keyboard.press("Control+z").catch(() => undefined);
  await page.keyboard.press("Control+Shift+z").catch(() => undefined);
  await sleep(300);

  const after = await page.screenshot({ animations: "disabled" });
  return {
    attempted: true,
    changed: sha256(before) !== sha256(after),
    canvasIndex: largest.index,
    canvasSize: { width: Number(box.width.toFixed(1)), height: Number(box.height.toFixed(1)) },
  };
}

function classifyResult({ route, profile, responseStatus, finalUrl, ready, dom, pageErrors, consoleErrors, requestFailures, navigationError, editorProbe }) { // NOSONAR javascript:S3776
  const hardFailures = [];
  const warnings = [];

  if (navigationError) hardFailures.push(`navigation failed: ${navigationError}`);
  if (responseStatus !== null && responseStatus >= 400) hardFailures.push(`document HTTP status ${responseStatus}`);
  if (!ready) hardFailures.push(`ready selector was not found for ${route.ready}`);
  if (dom.bodyTextLength === 0 && dom.visualSurfaceCount === 0) hardFailures.push("blank page: no text or visual surface");
  if (dom.docOverflowX > 2) hardFailures.push(`document horizontal overflow ${dom.docOverflowX}px`);
  if (dom.offscreenControls.length > 0) hardFailures.push(`${dom.offscreenControls.length} visible controls extend outside the viewport`);
  if (dom.deadPopupControls.length > 0) hardFailures.push(`${dom.deadPopupControls.length} popup-only controls are unusable when window.open is blocked`);
  if (pageErrors.length > 0) hardFailures.push(`${pageErrors.length} uncaught page errors`);

  if (dom.controls > 0 && dom.exitAffordances.length === 0) warnings.push("no visible in-page exit/back affordance detected");
  if (dom.smallTargets.length > 0) warnings.push(`${dom.smallTargets.length} touch targets are smaller than 44px`);
  if (dom.unnamedControls.length > 0) warnings.push(`${dom.unnamedControls.length} visible controls have no accessible name`);
  if (consoleErrors.length > 0) warnings.push(`${consoleErrors.length} console errors`);
  if (requestFailures.length > 0) warnings.push(`${requestFailures.length} failed network requests`);
  if (route.id === "invalid-route" && !/not found|찾을 수|404|존재하지/i.test(dom.bodyPreview)) {
    warnings.push("invalid Studio route does not expose an obvious not-found message");
  }
  if (["editor", "comic", "animation", "brushes"].includes(route.id) && editorProbe?.attempted && editorProbe.changed === false) {
    warnings.push("canvas stroke probe produced no visible page change");
  }

  return {
    ok: hardFailures.length === 0,
    hardFailures,
    warnings,
    evidence: {
      consoleErrors,
      editorProbe,
      finalUrl,
      pageErrors,
      requestFailures,
      responseStatus,
    },
    metrics: dom,
    profile: profile.id,
    route: route.id,
    url: `${BASE_URL}${route.pathname}`,
  };
}

async function runRoute(browser, profile, route) {
  const context = await browser.newContext({
    colorScheme: "light",
    hasTouch: true,
    isMobile: true,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    userAgent: profile.userAgent,
    viewport: { width: profile.width, height: profile.height },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.open = () => null;
  });

  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.stack ?? error)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (!isIgnoredNetworkMessage(text)) consoleErrors.push(text);
  });
  page.on("requestfailed", (request) => {
    const text = `${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? "failed"}`;
    if (!isIgnoredNetworkMessage(text)) requestFailures.push(text);
  });

  const url = `${BASE_URL}${route.pathname}`;
  let responseStatus = null;
  let navigationError = null;
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    responseStatus = response?.status() ?? null;
  } catch (error) {
    navigationError = String(error?.message ?? error);
  }

  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
  await sleep(SETTLE_MS);
  const ready = await page.locator(route.ready).first().isVisible().catch(() => false);
  const editorProbe = ["editor", "comic", "animation", "brushes"].includes(route.id)
    ? await probeEditorStroke(page).catch((error) => ({ attempted: false, changed: null, reason: String(error?.message ?? error) }))
    : null;
  const dom = await inspectDom(page).catch((error) => ({
    bodyTextLength: 0,
    bodyPreview: "",
    controls: 0,
    deadPopupControls: [],
    docOverflowX: 0,
    exitAffordances: [],
    largestCanvas: null,
    offscreenControls: [],
    smallTargets: [],
    unnamedControls: [],
    visualSurfaceCount: 0,
    viewport: { width: profile.width, height: profile.height },
    inspectionError: String(error?.message ?? error),
  }));

  const screenshotName = `${slug(profile.id)}--${slug(route.id)}.png`;
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: path.join(EVIDENCE_DIR, "screenshots", screenshotName),
  }).catch(() => undefined);

  const result = classifyResult({
    consoleErrors,
    dom,
    editorProbe,
    finalUrl: page.url(),
    navigationError,
    pageErrors,
    profile,
    ready,
    requestFailures,
    responseStatus,
    route,
  });
  result.screenshot = `screenshots/${screenshotName}`;
  await context.close();
  return result;
}

function buildMarkdown(summary) {
  const lines = [
    "# ToonStudio live in-app browser audit",
    "",
    `- Started: ${summary.startedAt}`,
    `- Finished: ${summary.finishedAt}`,
    `- Target: ${summary.baseUrl}`,
    `- Profiles: ${summary.profileCount}`,
    `- Route/profile cases: ${summary.caseCount}`,
    `- Passed: ${summary.passed}`,
    `- Failed: ${summary.failed}`,
    `- Warning cases: ${summary.warningCases}`,
    "",
    "## Cases",
    "",
    "| Profile | Route | Result | HTTP | Hard failures | Warnings |",
    "|---|---|---:|---:|---|---|",
  ];
  for (const result of summary.results) {
    lines.push(
      `| ${result.profile} | ${result.route} | ${result.ok ? "PASS" : "FAIL"} | ${result.evidence.responseStatus ?? "-"} | ${result.hardFailures.join("<br>") || "-"} | ${result.warnings.join("<br>") || "-"} |`,
    );
  }

  const failures = summary.results.filter((result) => !result.ok);
  if (failures.length > 0) {
    lines.push("", "## Failure evidence", "");
    for (const result of failures) {
      lines.push(
        `### ${result.profile} / ${result.route}`,
        "",
        `- URL: ${result.url}`,
        `- Final URL: ${result.evidence.finalUrl}`,
        `- Screenshot artifact: ${result.screenshot}`,
        `- Hard failures: ${result.hardFailures.join("; ")}`,
        `- Body preview: ${result.metrics.bodyPreview || "(empty)"}`,
        `- Offscreen controls: ${JSON.stringify(result.metrics.offscreenControls)}`,
        `- Popup-only controls: ${JSON.stringify(result.metrics.deadPopupControls)}`,
        `- Page errors: ${JSON.stringify(result.evidence.pageErrors)}`,
        `- Console errors: ${JSON.stringify(result.evidence.consoleErrors)}`,
        `- Failed requests: ${JSON.stringify(result.evidence.requestFailures)}`,
        "",
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  await mkdir(path.join(EVIDENCE_DIR, "screenshots"), { recursive: true });
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const profile of PROFILES) {
      for (const route of ROUTES) {
        if (route.profiles && !route.profiles.includes(profile.id)) continue;
        process.stdout.write(`[live-inapp] ${profile.id} ${route.pathname} ... `);
        const result = await runRoute(browser, profile, route);
        results.push(result);
        console.log(result.ok ? `PASS (${result.warnings.length} warnings)` : `FAIL: ${result.hardFailures.join("; ")}`);
      }
    }
  } finally {
    await browser.close();
  }

  const summary = {
    baseUrl: BASE_URL,
    caseCount: results.length,
    failed: results.filter((result) => !result.ok).length,
    finishedAt: new Date().toISOString(),
    passed: results.filter((result) => result.ok).length,
    profileCount: PROFILES.length,
    results,
    startedAt,
    warningCases: results.filter((result) => result.warnings.length > 0).length,
  };

  await writeFile(path.join(REPORT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(path.join(REPORT_DIR, "report.md"), buildMarkdown(summary), "utf8");
  await writeFile(path.join(EVIDENCE_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(path.join(EVIDENCE_DIR, "report.md"), buildMarkdown(summary), "utf8");
  console.log(`[live-inapp] complete: ${summary.passed}/${summary.caseCount} passed, ${summary.failed} failed`);
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  await mkdir(REPORT_DIR, { recursive: true }).catch(() => undefined);
  const fatal = { fatal: String(error?.stack ?? error), finishedAt: new Date().toISOString() };
  await writeFile(path.join(REPORT_DIR, "fatal.json"), `${JSON.stringify(fatal, null, 2)}\n`, "utf8").catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
});
