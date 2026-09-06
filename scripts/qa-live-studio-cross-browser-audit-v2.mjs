import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium, firefox, webkit } from "playwright";

const ENGINE = (process.env.QA_BROWSER_ENGINE ?? "chromium").trim().toLowerCase();
const BASE_URL = (process.env.STUDIO_BASE_URL ?? "https://www.toonstudio.cloud").replace(/\/+$/u, "");
const REPORT_DIR = process.env.QA_REPORT_DIR ?? `qa-results/studio-cross-browser-v2/${ENGINE}`;
const EVIDENCE_DIR = process.env.QA_EVIDENCE_DIR ?? `artifacts/studio-cross-browser-v2/${ENGINE}`;
const NAVIGATION_TIMEOUT_MS = Number(process.env.QA_NAVIGATION_TIMEOUT_MS ?? 60_000);
const SETTLE_MS = Number(process.env.QA_SETTLE_MS ?? 3_500);
const RETRY_SETTLE_MS = Number(process.env.QA_RETRY_SETTLE_MS ?? 7_000);
const MIN_TOUCH_PX = 43.5;

const BROWSER_TYPES = Object.freeze({ chromium, firefox, webkit });
const browserType = BROWSER_TYPES[ENGINE];
if (!browserType) throw new Error(`Unsupported QA_BROWSER_ENGINE: ${ENGINE}`);

const ROUTES = Object.freeze([
  { id: "editor", pathname: "/studio" },
  { id: "comic", pathname: "/studio/comic" },
  { id: "animation", pathname: "/studio/animation" },
  { id: "brushes", pathname: "/studio/brushes" },
  { id: "publish", pathname: "/studio/publish" },
  { id: "lift3d", pathname: "/studio/lift3d" },
  { id: "projects", pathname: "/studio/projects" },
  { id: "companion-workspace", pathname: "/studio/companion/workspace" },
  { id: "companion-review", pathname: "/studio/companion/review" },
  { id: "invalid-route", pathname: "/studio/qa-route-that-does-not-exist" },
]);

const PROFILE_CATALOG = Object.freeze({
  chromium: [
    {
      id: "chromium-desktop-1440",
      width: 1440,
      height: 900,
      mobile: false,
      hasTouch: false,
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    },
    {
      id: "chromium-kakaotalk-android-360",
      width: 360,
      height: 592,
      mobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Version/4.0 Chrome/151.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.4.3",
    },
    {
      id: "chromium-naver-android-412",
      width: 412,
      height: 700,
      mobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; SM-S931N Build/UP1A.231005.007; wv) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Version/4.0 Chrome/151.0.0.0 Mobile Safari/537.36 NAVER(inapp; search; 1000; 12.9.1)",
    },
    {
      id: "chromium-kakaotalk-android-landscape-592",
      width: 592,
      height: 360,
      mobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Version/4.0 Chrome/151.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.4.3",
    },
  ],
  webkit: [
    {
      id: "webkit-desktop-safari-1440",
      width: 1440,
      height: 900,
      mobile: false,
      hasTouch: false,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
        "(KHTML, like Gecko) Version/18.6 Safari/605.1.15",
    },
    {
      id: "webkit-instagram-ios-390",
      width: 390,
      height: 664,
      mobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 " +
        "(KHTML, like Gecko) Mobile/22G86 Instagram 390.0.0.0.0 (iPhone15,3; iOS 18_6; ko_KR)",
    },
    {
      id: "webkit-kakaotalk-ios-393",
      width: 393,
      height: 659,
      mobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 " +
        "(KHTML, like Gecko) Mobile/22G86 KAKAOTALK 25.7.2",
    },
    {
      id: "webkit-instagram-ios-landscape-664",
      width: 664,
      height: 390,
      mobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 " +
        "(KHTML, like Gecko) Mobile/22G86 Instagram 390.0.0.0.0 (iPhone15,3; iOS 18_6; ko_KR)",
    },
  ],
  firefox: [
    {
      id: "firefox-desktop-1366",
      width: 1366,
      height: 768,
      mobile: false,
      hasTouch: false,
      userAgent:
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0",
    },
    {
      id: "firefox-responsive-390",
      width: 390,
      height: 664,
      mobile: false,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Android 14; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0",
    },
    {
      id: "firefox-responsive-landscape-664",
      width: 664,
      height: 390,
      mobile: false,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Android 14; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0",
    },
  ],
});

const PROFILES = PROFILE_CATALOG[ENGINE];
const IGNORED_NETWORK_PARTS = Object.freeze([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
  "/favicon",
  "google-analytics.com",
  "googletagmanager.com",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slug(value) {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-").replace(/(?:^-+|-+$)/gu, "");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function ignoredNetwork(text) {
  return IGNORED_NETWORK_PARTS.some((part) => text.includes(part));
}

async function inspectDom(page, profile) {
  return page.evaluate(
    ({ minTouchPx, touchProfile }) => { // NOSONAR javascript:S3776
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const epsilon = 0.5;

      const visible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
        const rect = element.getBoundingClientRect();
        return rect.width >= 2 && rect.height >= 2 && rect.bottom > 0 && rect.top < viewportHeight;
      };

      const accessibleName = (element) => {
        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/u)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
            .filter(Boolean)
            .join(" ");
          if (text) return text;
        }
        if (element.id) {
          try {
            const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
            if (label?.textContent?.trim()) return label.textContent.trim();
          } catch {
            // Ignore malformed IDs.
          }
        }
        return (
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.getAttribute("alt") ||
          element.closest("label")?.textContent?.trim() ||
          element.textContent?.trim() ||
          ""
        );
      };

      const describe = (element) => {
        const name = accessibleName(element).replace(/\s+/gu, " ").slice(0, 80);
        return element.tagName.toLowerCase() + (name ? `[${name}]` : "");
      };

      const horizontalScrollerAncestor = (element) => {
        let parent = element.parentElement;
        while (parent && parent !== document.body) {
          const style = getComputedStyle(parent);
          if (["auto", "scroll"].includes(style.overflowX) && parent.scrollWidth > parent.clientWidth + 1) return true;
          parent = parent.parentElement;
        }
        return false;
      };

      const controls = [
        ...document.querySelectorAll(
          "button, a[href], input:not([type='hidden']), select, textarea, [role='button'], [role='link'], [tabindex]:not([tabindex='-1'])",
        ),
      ].filter(visible);
      const offscreenControls = [];
      const smallTargets = [];
      const unnamedControls = [];

      for (const control of controls) {
        const rect = control.getBoundingClientRect();
        const disabled = control.matches(":disabled") || control.getAttribute("aria-disabled") === "true";
        const inScroller = horizontalScrollerAncestor(control);
        const name = accessibleName(control);
        if (!name) unnamedControls.push({ label: describe(control) });
        if (!inScroller && (rect.left < -epsilon || rect.right > viewportWidth + epsilon)) {
          offscreenControls.push({
            label: describe(control),
            rect: {
              left: Number(rect.left.toFixed(1)),
              right: Number(rect.right.toFixed(1)),
              top: Number(rect.top.toFixed(1)),
              bottom: Number(rect.bottom.toFixed(1)),
            },
          });
        }
        if (touchProfile && !disabled && !inScroller && (rect.width < minTouchPx || rect.height < minTouchPx)) {
          smallTargets.push({
            label: describe(control),
            width: Number(rect.width.toFixed(1)),
            height: Number(rect.height.toFixed(1)),
          });
        }
      }

      const duplicateTestIds = [...document.querySelectorAll("[data-testid]")]
        .reduce((map, element) => {
          const testId = element.getAttribute("data-testid");
          if (!testId) return map;
          map.set(testId, (map.get(testId) ?? 0) + 1);
          return map;
        }, new Map());
      const duplicateTestIdList = [...duplicateTestIds.entries()]
        .filter(([, count]) => count > 1)
        .map(([testId, count]) => ({ testId, count }))
        .sort((a, b) => b.count - a.count || a.testId.localeCompare(b.testId));

      const dialogsOutsideViewport = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open]')]
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            label: describe(element),
            rect: {
              left: Number(rect.left.toFixed(1)),
              right: Number(rect.right.toFixed(1)),
              top: Number(rect.top.toFixed(1)),
              bottom: Number(rect.bottom.toFixed(1)),
            },
            outside:
              rect.left < -epsilon ||
              rect.right > viewportWidth + epsilon ||
              rect.top < -epsilon ||
              rect.bottom > viewportHeight + epsilon,
          };
        })
        .filter((item) => item.outside);

      const bodyText = (document.body?.innerText ?? "").trim();
      const visualSurfaceCount = document.querySelectorAll(
        "canvas, svg, img, video, iframe, [data-studio-mobile-editing-dock='true']",
      ).length;
      const loadingSurfaceCount = document.querySelectorAll(
        "[aria-busy='true'], [class*='skeleton'], [class*='animate-pulse'], [data-loading='true']",
      ).length;
      const documentOverflowX = Math.max(
        0,
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      return {
        bodyPreview: bodyText.replace(/\s+/gu, " ").slice(0, 420),
        bodyTextLength: bodyText.length,
        controlCount: controls.length,
        dialogsOutsideViewport: dialogsOutsideViewport.slice(0, 20),
        documentOverflowX,
        duplicateTestIds: duplicateTestIdList.slice(0, 40),
        loadingLike:
          loadingSurfaceCount > 0 ||
          /불러오는 중|loading|잠시만 기다/iu.test(bodyText.slice(0, 300)),
        loadingSurfaceCount,
        offscreenControls: offscreenControls.slice(0, 50),
        smallTargets: smallTargets.slice(0, 80),
        unnamedControls: unnamedControls.slice(0, 80),
        viewport: { width: viewportWidth, height: viewportHeight },
        visualSurfaceCount,
      };
    },
    { minTouchPx: MIN_TOUCH_PX, touchProfile: profile.hasTouch || profile.mobile },
  );
}

async function visibleOverlaySummary(page) {
  return page.evaluate(() => {
    const candidates = [
      ...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [aria-label="모달 닫기"]'),
    ];
    const visible = candidates.filter((element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 &&
        rect.width > 2 &&
        rect.height > 2 &&
        rect.bottom > 0 &&
        rect.right > 0
      );
    });
    return visible.slice(0, 5).map((element) => ({
      role: element.getAttribute("role"),
      ariaLabel: element.getAttribute("aria-label"),
      text: (element.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 100),
    }));
  });
}

async function probeWorkspace(page, profile) {
  if (profile.mobile || profile.width <= 430) return { applicable: false, reason: "mobile layout" };

  const blockingOverlays = await visibleOverlaySummary(page);
  if (blockingOverlays.length > 0) {
    return { applicable: true, skipped: true, reason: "visible overlay already owns interaction", blockingOverlays };
  }

  const trigger = page.locator('button[aria-haspopup="dialog"][aria-label^="작업공간:"]').first();
  if ((await trigger.count()) === 0 || !(await trigger.isVisible().catch(() => false))) {
    return { applicable: true, available: false };
  }

  const hitTarget = await trigger.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
    const top = document.elementFromPoint(x, y);
    return {
      center: { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) },
      hitIsTrigger: top === element || Boolean(top && element.contains(top)),
      topTag: top?.tagName?.toLowerCase() ?? null,
      topLabel:
        top?.getAttribute?.("aria-label") ??
        top?.getAttribute?.("data-testid") ??
        top?.textContent?.trim().slice(0, 80) ??
        null,
    };
  });

  let clickError = null;
  let opened = false;
  let openedBy = null;
  try {
    await trigger.click({ timeout: 7_500 });
    await page.waitForTimeout(400);
    const checks = [
      ["aria-expanded", (await trigger.getAttribute("aria-expanded")) === "true"],
      ["dialog", (await page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible').count()) > 0],
      ["workspace-heading", await page.getByText("작업공간", { exact: true }).last().isVisible().catch(() => false)],
      ["workspace-management", await page.getByText("작업공간 관리", { exact: true }).isVisible().catch(() => false)],
    ];
    const match = checks.find(([, value]) => value);
    opened = Boolean(match);
    openedBy = match?.[0] ?? null;
  } catch (error) {
    const overlaysAfterFailure = await visibleOverlaySummary(page).catch(() => []);
    if (overlaysAfterFailure.length > 0) {
      return {
        applicable: true,
        available: true,
        skipped: true,
        reason: "overlay appeared before workspace interaction completed",
        blockingOverlays: overlaysAfterFailure,
        hitTarget,
      };
    }
    clickError = String(error?.message ?? error);
  } finally {
    await page.keyboard.press("Escape").catch(() => undefined);
  }

  return { applicable: true, available: true, clickError, hitTarget, opened, openedBy };
}

async function probeBg3dEntry(page, routeId) {
  if (!["editor", "comic"].includes(routeId)) return { applicable: false };
  const blockingOverlays = await visibleOverlaySummary(page);
  if (blockingOverlays.length > 0) {
    return { applicable: true, skipped: true, reason: "visible overlay already owns interaction", blockingOverlays };
  }

  const trigger = page
    .locator(
      'button:has-text("3D 배경"), button[aria-label*="3D 배경"], [role="button"]:has-text("3D 배경")',
    )
    .first();
  if ((await trigger.count()) === 0 || !(await trigger.isVisible().catch(() => false))) {
    return { applicable: true, available: false };
  }

  let clickError = null;
  let opened = false;
  try {
    await trigger.click({ timeout: 7_500 });
    await page.waitForTimeout(650);
    opened =
      (await page.locator('[data-testid="studio-bg3d-dialog"]:visible, [role="dialog"]:visible').count()) > 0;
  } catch (error) {
    clickError = String(error?.message ?? error);
  } finally {
    await page.keyboard.press("Escape").catch(() => undefined);
    const closeButton = page
      .locator(
        '[data-testid="studio-bg3d-dialog"] button[aria-label*="닫기"], [role="dialog"] button[aria-label*="닫기"]',
      )
      .first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click({ force: true }).catch(() => undefined);
    }
  }

  return { applicable: true, available: true, clickError, opened };
}

function classify({ // NOSONAR javascript:S3776
  route,
  profile,
  responseStatus,
  navigationError,
  ready,
  dom,
  pageErrors,
  consoleErrors,
  requestFailures,
  workspaceProbe,
  bg3dProbe,
}) {
  const hardFailures = [];
  const warnings = [];

  if (navigationError) hardFailures.push(`navigation failed: ${navigationError}`);
  if (responseStatus !== null && responseStatus >= 400 && route.id !== "invalid-route") {
    hardFailures.push(`document HTTP status ${responseStatus}`);
  }
  if (!ready && pageErrors.length > 0) hardFailures.push("no Studio readiness surface found");
  if (dom.bodyTextLength === 0 && dom.visualSurfaceCount === 0) {
    if (dom.loadingLike && pageErrors.length === 0) warnings.push("loading surface remained after retry window");
    else hardFailures.push("blank page");
  }
  if (dom.documentOverflowX > 2) hardFailures.push(`document horizontal overflow ${dom.documentOverflowX}px`);
  if (dom.offscreenControls.length > 0) {
    hardFailures.push(`${dom.offscreenControls.length} visible controls extend outside the viewport`);
  }
  if (dom.dialogsOutsideViewport.length > 0) {
    hardFailures.push(`${dom.dialogsOutsideViewport.length} visible dialogs extend outside the viewport`);
  }
  if (pageErrors.length > 0) hardFailures.push(`${pageErrors.length} uncaught page errors`);

  const centralEditorDuplicate = dom.duplicateTestIds.find(
    (item) => item.testId === "studio-central-3d-editor",
  );
  if (centralEditorDuplicate) {
    hardFailures.push(`data-testid studio-central-3d-editor is duplicated ${centralEditorDuplicate.count} times`);
  } else if (dom.duplicateTestIds.length > 0) {
    warnings.push(`${dom.duplicateTestIds.length} duplicated data-testid values`);
  }

  if (workspaceProbe.applicable && workspaceProbe.available && !workspaceProbe.skipped) {
    if (!workspaceProbe.hitTarget?.hitIsTrigger) hardFailures.push("workspace trigger center is covered by another element");
    if (workspaceProbe.clickError) hardFailures.push("workspace trigger could not be clicked");
    else if (!workspaceProbe.opened) hardFailures.push("workspace trigger did not open its panel or dialog");
  }

  if (bg3dProbe.applicable && bg3dProbe.available && !bg3dProbe.skipped) {
    if (bg3dProbe.clickError) hardFailures.push("3D background entry could not be clicked");
    else if (!bg3dProbe.opened) hardFailures.push("3D background entry did not open a dialog");
  }

  if (profile.hasTouch && dom.smallTargets.length > 0) {
    warnings.push(`${dom.smallTargets.length} touch targets are smaller than 44px`);
  }
  if (dom.unnamedControls.length > 0) warnings.push(`${dom.unnamedControls.length} controls have no accessible name`);
  if (consoleErrors.length > 0) warnings.push(`${consoleErrors.length} console errors`);
  if (requestFailures.length > 0) warnings.push(`${requestFailures.length} failed requests`);
  if (/SQLite\/OPFS 작업공간 저장소를 열지 못해|navigator\.storage\.getDirectory is unavailable/iu.test(dom.bodyPreview)) {
    warnings.push("OPFS/SQLite workspace storage unavailable in this browser engine run");
  }
  if (route.id === "invalid-route" && !/404|not found|찾을 수|존재하지/iu.test(dom.bodyPreview)) {
    warnings.push("invalid route has no obvious not-found message");
  }

  return { hardFailures, warnings, ok: hardFailures.length === 0 };
}

async function runCase(browser, profile, route) {
  const contextOptions = {
    colorScheme: "light",
    hasTouch: profile.hasTouch,
    locale: "ko-KR",
    reducedMotion: "reduce",
    timezoneId: "Asia/Seoul",
    userAgent: profile.userAgent,
    viewport: { width: profile.width, height: profile.height },
  };
  if (ENGINE !== "firefox") contextOptions.isMobile = profile.mobile;

  const context = await browser.newContext(contextOptions);
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
    if (!ignoredNetwork(text)) consoleErrors.push(text);
  });
  page.on("requestfailed", (request) => {
    const text = `${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? "failed"}`;
    if (!ignoredNetwork(text)) requestFailures.push(text);
  });

  const url = `${BASE_URL}${route.pathname}`;
  let responseStatus = null;
  let navigationError = null;
  try {
    const response = await page.goto(url, {
      timeout: NAVIGATION_TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    });
    responseStatus = response?.status() ?? null;
  } catch (error) {
    navigationError = String(error?.message ?? error);
  }

  await sleep(SETTLE_MS);
  let dom = await inspectDom(page, profile);
  if (dom.bodyTextLength === 0 && dom.visualSurfaceCount === 0 && dom.loadingLike && pageErrors.length === 0) {
    await sleep(RETRY_SETTLE_MS);
  }

  const ready = await page
    .locator("main, canvas, [role='main'], h1, [data-studio-mobile-editing-dock='true']")
    .first()
    .isVisible()
    .catch(() => false);

  const workspaceProbe = await probeWorkspace(page, profile);
  const bg3dProbe = await probeBg3dEntry(page, route.id);
  await sleep(250);
  dom = await inspectDom(page, profile);

  const screenshotPath = path.join(EVIDENCE_DIR, `${slug(profile.id)}--${slug(route.id)}.png`);
  const screenshot = await page.screenshot({ animations: "disabled", path: screenshotPath });

  const classification = classify({
    route,
    profile,
    responseStatus,
    navigationError,
    ready,
    dom,
    pageErrors,
    consoleErrors,
    requestFailures,
    workspaceProbe,
    bg3dProbe,
  });

  const result = {
    engine: ENGINE,
    profile: profile.id,
    route: route.id,
    url,
    finalUrl: page.url(),
    responseStatus,
    navigationError,
    ready,
    screenshot: path.relative(process.cwd(), screenshotPath),
    screenshotSha256: sha256(screenshot),
    workspaceProbe,
    bg3dProbe,
    dom,
    pageErrors: pageErrors.slice(0, 30),
    consoleErrors: consoleErrors.slice(0, 50),
    requestFailures: requestFailures.slice(0, 50),
    ...classification,
  };

  await writeFile(
    path.join(REPORT_DIR, `${slug(profile.id)}--${slug(route.id)}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  await context.close();
  return result;
}

await mkdir(REPORT_DIR, { recursive: true });
await mkdir(EVIDENCE_DIR, { recursive: true });

const launchOptions = { headless: true };
if (ENGINE === "chromium") {
  launchOptions.args = ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader"];
}

const browser = await browserType.launch(launchOptions);
const results = [];
try {
  for (const profile of PROFILES) {
    for (const route of ROUTES) {
      process.stdout.write(`[${ENGINE}] ${profile.id} ${route.pathname} ... `);
      try {
        const result = await runCase(browser, profile, route);
        results.push(result);
        process.stdout.write(`${result.ok ? "PASS" : "FAIL"}\n`);
        for (const failure of result.hardFailures) process.stdout.write(`  failure: ${failure}\n`);
        for (const warning of result.warnings) process.stdout.write(`  warning: ${warning}\n`);
      } catch (error) {
        const message = String(error?.stack ?? error);
        results.push({
          engine: ENGINE,
          profile: profile.id,
          route: route.id,
          url: `${BASE_URL}${route.pathname}`,
          ok: false,
          hardFailures: [`audit harness exception: ${message}`],
          warnings: [],
        });
        process.stdout.write("FAIL\n");
        process.stdout.write(`  failure: audit harness exception: ${message}\n`);
      }
    }
  }
} finally {
  await browser.close();
}

const passed = results.filter((result) => result.ok).length;
const failed = results.length - passed;
const warningCases = results.filter((result) => (result.warnings?.length ?? 0) > 0).length;
const summary = {
  generatedAt: new Date().toISOString(),
  engine: ENGINE,
  target: BASE_URL,
  profileCount: PROFILES.length,
  routeCount: ROUTES.length,
  caseCount: results.length,
  passed,
  failed,
  warningCases,
  failures: results
    .filter((result) => !result.ok)
    .map((result) => ({
      profile: result.profile,
      route: result.route,
      hardFailures: result.hardFailures,
    })),
};
await writeFile(path.join(REPORT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

const markdown = [
  `# ToonStudio cross-browser audit v2 — ${ENGINE}`,
  "",
  `- Generated: ${summary.generatedAt}`,
  `- Target: ${summary.target}`,
  `- Profiles: ${summary.profileCount}`,
  `- Routes: ${summary.routeCount}`,
  `- Cases: ${summary.caseCount}`,
  `- Passed: ${summary.passed}`,
  `- Failed: ${summary.failed}`,
  `- Cases with warnings: ${summary.warningCases}`,
  "",
  "## Results",
  "",
  "| Profile | Route | Result | Failures | Warnings |",
  "|---|---|---:|---|---|",
  ...results.map((result) =>
    `| ${result.profile} | ${result.route} | ${result.ok ? "PASS" : "FAIL"} | ${(result.hardFailures ?? []).join("<br>") || "-"} | ${(result.warnings ?? []).join("<br>") || "-"} |`,
  ),
  "",
  "## Scope note",
  "",
  "Chromium Android and WebKit iOS profiles emulate browser engine, viewport, touch, locale, and user-agent behavior in Playwright. They are regression proxies, not substitutes for physical Android WebView or iOS WKWebView device validation.",
  "",
];
await writeFile(path.join(REPORT_DIR, "report.md"), `${markdown.join("\n")}\n`);

console.log(JSON.stringify(summary, null, 2));
if (failed > 0) process.exitCode = 1;
