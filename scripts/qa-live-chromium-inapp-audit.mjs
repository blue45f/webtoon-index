#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

const BASE_URL = (process.env.STUDIO_BASE_URL ?? "https://www.toonstudio.cloud").replace(/\/+$/u, "");
const OUTPUT_DIR = path.resolve(
  process.env.QA_OUTPUT_DIR ?? "qa-results/studio-chromium-inapp/live",
);
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, "screenshots");
const NAVIGATION_TIMEOUT_MS = Number(process.env.QA_NAVIGATION_TIMEOUT_MS ?? 60_000);
const SETTLE_MS = Number(process.env.QA_SETTLE_MS ?? 4_000);
const MIN_TOUCH_PX = 43.5;

const PROFILES = Object.freeze([
  {
    id: "chrome-desktop-1440",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    evidenceLevel: "chromium-engine",
  },
  {
    id: "chrome-android-390",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP4A.250205.002) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36",
    evidenceLevel: "chromium-mobile-emulation",
  },
  {
    id: "kakaotalk-android-360",
    viewport: { width: 360, height: 740 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; SM-S931N Build/AP4A.250205.002; wv) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.0.0 " +
      "Mobile Safari/537.36 KAKAOTALK 26.7.0",
    evidenceLevel: "chromium-kakaotalk-ua-emulation",
  },
  {
    id: "naver-android-412",
    viewport: { width: 412, height: 846 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; SM-S931N Build/AP4A.250205.002; wv) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.0.0 " +
      "Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.15.0)",
    evidenceLevel: "chromium-naver-ua-emulation",
  },
  {
    id: "instagram-inapp-390",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 " +
      "Instagram 420.0.0.0.0",
    evidenceLevel: "chromium-with-instagram-ios-ua-emulation",
  },
]);

const ROUTES = Object.freeze([
  { id: "studio", pathname: "/studio" },
  { id: "comic", pathname: "/studio/comic" },
  { id: "animation", pathname: "/studio/animation" },
  { id: "brushes", pathname: "/studio/brushes" },
  { id: "publish", pathname: "/studio/publish" },
  { id: "lift3d", pathname: "/studio/lift3d" },
  { id: "projects", pathname: "/studio/projects" },
  { id: "companion-workspace", pathname: "/studio/companion/workspace" },
  { id: "companion-review", pathname: "/studio/companion/review" },
  {
    id: "community-market-deeplink",
    pathname: "/studio?assetMarket=community",
    expectsCommunityMarket: true,
  },
  { id: "invalid-route", pathname: "/studio/qa-route-that-does-not-exist" },
]);

const KNOWN_JIRA = Object.freeze([
  ["KAN-11", /게시하기|초안 저장|전체 화면 드로잉 종료|상단 메뉴.*화면 밖|offscreen/iu],
  ["KAN-15", /작업공간.*가려|workspace.*covered|workspace.*click/iu],
  ["KAN-16", /빠른 시작|웹툰 흐름|컷 나누기|말풍선.*화면 밖/iu],
  ["KAN-17", /touch target|터치 영역|44px/iu],
  ["KAN-18", /Lift3D.*accessible|unnamed.*range|슬라이더.*이름/iu],
  ["KAN-19", /studio-central-3d-editor.*duplicate/iu],
  ["KAN-33", /JavaScript MIME|stale chunk|text\/html.*module/iu],
  ["KAN-43", /browser compatibility.*dialog|호환성.*dialog|Escape.*호환/iu],
  ["KAN-56", /3D.*canvas.*missing|bg3d.*canvas.*not visible/iu],
  ["KAN-58", /community market.*not visible|assetMarket=community/iu],
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeSlug(value) {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, "-").replace(/(?:^-+|-+$)/gu, "");
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function knownJiraFor(message) { // NOSONAR javascript:S3800
  return KNOWN_JIRA.find(([, pattern]) => pattern.test(message))?.[0] ?? null;
}

async function inspectDom(page, profile) {
  return page.evaluate(
    ({ isTouch, minimumTouch }) => { // NOSONAR javascript:S3776
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
        const style = getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        ) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width >= 2 && rect.height >= 2 && rect.bottom > 0 && rect.top < viewportHeight;
      };

      const accessibleName = (element) => {
        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy) {
          const resolved = labelledBy
            .split(/\s+/u)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
            .filter(Boolean)
            .join(" ");
          if (resolved) return resolved;
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

      const hasHorizontalScroller = (element) => {
        let current = element.parentElement;
        while (current && current !== document.body) {
          const style = getComputedStyle(current);
          if (
            ["auto", "scroll"].includes(style.overflowX) &&
            current.scrollWidth > current.clientWidth + 1
          ) {
            return true;
          }
          current = current.parentElement;
        }
        return false;
      };

      const controls = [
        ...document.querySelectorAll(
          "button, a[href], input:not([type='hidden']), select, textarea, " +
            "[role='button'], [role='link'], [tabindex]:not([tabindex='-1'])",
        ),
      ].filter(isVisible);

      const offscreenControls = [];
      const smallTouchTargets = [];
      const unnamedControls = [];
      for (const element of controls) {
        const rect = element.getBoundingClientRect();
        const scrollExempt = hasHorizontalScroller(element);
        const name = accessibleName(element);
        if (!name) unnamedControls.push({ label: describe(element) });
        if (!scrollExempt && (rect.left < -0.5 || rect.right > viewportWidth + 0.5)) {
          offscreenControls.push({
            label: describe(element),
            rect: {
              left: Number(rect.left.toFixed(1)),
              right: Number(rect.right.toFixed(1)),
              top: Number(rect.top.toFixed(1)),
              bottom: Number(rect.bottom.toFixed(1)),
            },
          });
        }
        if (
          isTouch &&
          !scrollExempt &&
          !element.matches(":disabled") &&
          (rect.width < minimumTouch || rect.height < minimumTouch)
        ) {
          smallTouchTargets.push({
            label: describe(element),
            width: Number(rect.width.toFixed(1)),
            height: Number(rect.height.toFixed(1)),
          });
        }
      }

      const testIdCounts = new Map();
      for (const element of document.querySelectorAll("[data-testid]")) {
        const testId = element.getAttribute("data-testid");
        if (testId) testIdCounts.set(testId, (testIdCounts.get(testId) ?? 0) + 1);
      }
      const duplicateTestIds = [...testIdCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([testId, count]) => ({ testId, count }));

      const workspaceTrigger = document.querySelector(
        'button[aria-haspopup="dialog"][aria-label^="작업공간:"]',
      );
      let workspaceHitTest = null;
      if (workspaceTrigger instanceof HTMLElement && isVisible(workspaceTrigger)) {
        const rect = workspaceTrigger.getBoundingClientRect();
        const x = Math.max(0, Math.min(viewportWidth - 1, rect.left + rect.width / 2));
        const y = Math.max(0, Math.min(viewportHeight - 1, rect.top + rect.height / 2));
        const hit = document.elementFromPoint(x, y);
        workspaceHitTest = {
          hitIsTrigger: hit === workspaceTrigger || Boolean(hit && workspaceTrigger.contains(hit)),
          topLabel:
            hit?.getAttribute?.("aria-label") ||
            hit?.getAttribute?.("data-testid") ||
            hit?.textContent?.trim().slice(0, 80) ||
            null,
        };
      }

      const bodyText = (document.body?.innerText ?? "").trim();
      return {
        bodyTextLength: bodyText.length,
        bodyPreview: bodyText.replace(/\s+/gu, " ").slice(0, 500),
        documentOverflowX: Math.max(
          0,
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        duplicateTestIds,
        offscreenControls: offscreenControls.slice(0, 80),
        smallTouchTargets: smallTouchTargets.slice(0, 100),
        unnamedControls: unnamedControls.slice(0, 100),
        visualSurfaceCount: document.querySelectorAll(
          "canvas, svg, img, video, iframe, [data-studio-mobile-editing-dock='true']",
        ).length,
        workspaceHitTest,
      };
    },
    { isTouch: profile.hasTouch, minimumTouch: MIN_TOUCH_PX },
  );
}

async function runCase(browser, profile, route) { // NOSONAR javascript:S3776
  const context = await browser.newContext({
    colorScheme: "light",
    deviceScaleFactor: profile.deviceScaleFactor,
    hasTouch: profile.hasTouch,
    isMobile: profile.isMobile,
    locale: "ko-KR",
    reducedMotion: "reduce",
    timezoneId: "Asia/Seoul",
    userAgent: profile.userAgent,
    viewport: profile.viewport,
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem("toonspectrum-intro-shown", "true");
      localStorage.setItem("toonspectrum-studio-quick-start-dismissed", "true");
    } catch {
      // The test also covers storage-restricted states elsewhere.
    }
  });

  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const serverErrors = [];

  page.on("pageerror", (error) => pageErrors.push(String(error?.stack ?? error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(
      `${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? "failed"}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });

  let responseStatus = null;
  let navigationError = null;
  const targetUrl = `${BASE_URL}${route.pathname}`;
  try {
    const response = await page.goto(targetUrl, {
      timeout: NAVIGATION_TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    });
    responseStatus = response?.status() ?? null;
  } catch (error) {
    navigationError = String(error?.message ?? error);
  }

  await sleep(SETTLE_MS);
  const dom = await inspectDom(page, profile);
  const communityMarketVisible = route.expectsCommunityMarket
    ? await page
        .locator(
          "[data-studio-community-marketplace], " +
            "[data-studio-asset-marketplace-lazy-boundary], " +
            "[role='tab'][aria-selected='true']:has-text('커뮤니티')",
        )
        .first()
        .isVisible()
        .catch(() => false)
    : null;

  const failures = [];
  const warnings = [];
  if (navigationError) failures.push(`navigation failed: ${navigationError}`);
  if (responseStatus !== null && responseStatus >= 400 && route.id !== "invalid-route") {
    failures.push(`document HTTP ${responseStatus}`);
  }
  if (dom.bodyTextLength === 0 && dom.visualSurfaceCount === 0) failures.push("blank page");
  if (pageErrors.length > 0) failures.push(`${pageErrors.length} uncaught page errors`);
  if (serverErrors.length > 0) failures.push(`${serverErrors.length} HTTP 5xx responses`);
  if (dom.documentOverflowX > 2) failures.push(`document overflow-x ${dom.documentOverflowX}px`);
  if (dom.offscreenControls.length > 0) {
    failures.push(`${dom.offscreenControls.length} visible controls outside viewport`);
  }
  if (dom.workspaceHitTest && !dom.workspaceHitTest.hitIsTrigger) {
    failures.push("workspace trigger center is covered by another element");
  }
  const central3dDuplicate = dom.duplicateTestIds.find(
    (item) => item.testId === "studio-central-3d-editor",
  );
  if (central3dDuplicate) {
    failures.push(
      `studio-central-3d-editor data-testid duplicated ${central3dDuplicate.count} times`,
    );
  }
  if (route.expectsCommunityMarket && !communityMarketVisible) {
    failures.push("assetMarket=community panel is not visible");
  }
  if (profile.hasTouch && dom.smallTouchTargets.length > 0) {
    warnings.push(`${dom.smallTouchTargets.length} touch targets smaller than 44px`);
  }
  if (dom.unnamedControls.length > 0) {
    warnings.push(`${dom.unnamedControls.length} controls without accessible names`);
  }
  if (consoleErrors.length > 0) warnings.push(`${consoleErrors.length} console errors`);
  if (failedRequests.length > 0) warnings.push(`${failedRequests.length} failed requests`);

  const screenshotName = `${safeSlug(profile.id)}--${safeSlug(route.id)}.png`;
  const screenshotPath = path.join(SCREENSHOT_DIR, screenshotName);
  const screenshotBytes = await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: screenshotPath,
    timeout: 90_000,
  });

  const findingMessages = [...failures, ...warnings];
  const jiraKeys = [...new Set(findingMessages.map(knownJiraFor).filter(Boolean))];
  const result = {
    browserEngine: "chromium",
    chromiumVersion: await browser.version(),
    profile: profile.id,
    uaProfile: profile.id,
    emulation: profile.id !== "chrome-desktop-1440",
    physicalDeviceVerified: false,
    evidenceLevel: profile.evidenceLevel,
    route: route.id,
    targetUrl,
    finalUrl: page.url(),
    responseStatus,
    navigationError,
    ok: failures.length === 0,
    failures,
    warnings,
    jiraKeys,
    communityMarketVisible,
    dom,
    pageErrors: pageErrors.slice(0, 30),
    consoleErrors: consoleErrors.slice(0, 50),
    failedRequests: failedRequests.slice(0, 50),
    serverErrors: serverErrors.slice(0, 50),
    screenshot: path.relative(process.cwd(), screenshotPath),
    screenshotSha256: hash(screenshotBytes),
  };

  await context.close();
  return result;
}

await mkdir(OUTPUT_DIR, { recursive: true });
await mkdir(SCREENSHOT_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});

const results = [];
try {
  for (const profile of PROFILES) {
    for (const route of ROUTES) {
      process.stdout.write(`[chromium-inapp] ${profile.id} ${route.pathname} ... `);
      try {
        const result = await runCase(browser, profile, route);
        results.push(result);
        process.stdout.write(`${result.ok ? "PASS" : "FAIL"}\n`);
        for (const failure of result.failures) console.log(`  FAIL: ${failure}`);
        for (const warning of result.warnings) console.log(`  WARN: ${warning}`);
      } catch (error) {
        const message = String(error?.stack ?? error);
        results.push({
          browserEngine: "chromium",
          profile: profile.id,
          route: route.id,
          targetUrl: `${BASE_URL}${route.pathname}`,
          ok: false,
          failures: [`audit harness exception: ${message}`],
          warnings: [],
          jiraKeys: [],
        });
        process.stdout.write("FAIL\n");
        console.error(message);
      }
    }
  }
} finally {
  await browser.close();
}

const summary = {
  generatedAt: new Date().toISOString(),
  target: BASE_URL,
  browserEngine: "chromium",
  profileCount: PROFILES.length,
  routeCount: ROUTES.length,
  caseCount: results.length,
  passed: results.filter((item) => item.ok).length,
  failed: results.filter((item) => !item.ok).length,
  warningCases: results.filter((item) => item.warnings?.length > 0).length,
  linkedJiraKeys: [...new Set(results.flatMap((item) => item.jiraKeys ?? []))].sort(),
  scopeNote:
    "All in-app profiles are Chromium engine UA/viewport/touch emulations; no physical app WebView or iOS WKWebView is claimed.",
};

await writeFile(path.join(OUTPUT_DIR, "cases.json"), `${JSON.stringify(results, null, 2)}\n`);
await writeFile(path.join(OUTPUT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

const report = [
  "# ToonStudio Chromium and in-app browser live audit",
  "",
  `- Generated: ${summary.generatedAt}`,
  `- Target: ${summary.target}`,
  `- Browser engine: ${summary.browserEngine}`,
  `- Profiles: ${summary.profileCount}`,
  `- Routes per profile: ${summary.routeCount}`,
  `- Cases: ${summary.caseCount}`,
  `- Passed: ${summary.passed}`,
  `- Failed: ${summary.failed}`,
  `- Warning cases: ${summary.warningCases}`,
  `- Linked Jira: ${summary.linkedJiraKeys.join(", ") || "-"}`,
  "",
  `> ${summary.scopeNote}`,
  "",
  "| Profile | Route | Result | Failures | Warnings | Jira |",
  "|---|---|---:|---|---|---|",
  ...results.map(
    (item) =>
      `| ${item.profile} | ${item.route} | ${item.ok ? "PASS" : "FAIL"} | ` +
      `${(item.failures ?? []).join("<br>") || "-"} | ` +
      `${(item.warnings ?? []).join("<br>") || "-"} | ` +
      `${(item.jiraKeys ?? []).join(", ") || "-"} |`,
  ),
  "",
];
await writeFile(path.join(OUTPUT_DIR, "report.md"), `${report.join("\n")}\n`);

console.log(JSON.stringify(summary, null, 2));
if (summary.failed > 0) process.exitCode = 1;
