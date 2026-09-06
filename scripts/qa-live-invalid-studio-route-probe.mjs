import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.TOONSTUDIO_LIVE_URL || "https://www.toonstudio.cloud").replace(/\/+$/u, "");
const outputDir = path.resolve(process.env.QA_OUTPUT_DIR || "qa-results/live-invalid-route");
const rounds = Number.parseInt(process.env.QA_PROBE_ROUNDS || "3", 10);

const profiles = [
  {
    id: "kakaotalk-android-360",
    viewport: { width: 360, height: 592 },
    userAgent: "Mozilla/5.0 (Linux; Android 15; SM-S931N Build/AP3A.240905.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.0.0 Mobile Safari/537.36 KAKAOTALK 26.7.0",
  },
  {
    id: "instagram-ios-390",
    viewport: { width: 390, height: 664 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 420.0.0.0.0",
  },
  {
    id: "naver-android-412",
    viewport: { width: 412, height: 700 },
    userAgent: "Mozilla/5.0 (Linux; Android 15; SM-S931N Build/AP3A.240905.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.0.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.15.0)",
  },
];

await fs.rm(outputDir, { force: true, recursive: true });
await fs.mkdir(path.join(outputDir, "screenshots"), { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const profile of profiles) {
    for (let round = 1; round <= rounds; round++) {
      const context = await browser.newContext({
        userAgent: profile.userAgent,
        viewport: profile.viewport,
        locale: "ko-KR",
        colorScheme: "dark",
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      const requestFailures = [];
      const badResponses = [];

      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message || String(error)));
      page.on("requestfailed", (request) => {
        requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || "unknown"}`);
      });
      page.on("response", (response) => {
        if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
      });

      const cacheBust = `${Date.now()}-${profile.id}-${round}`;
      let navigationStatus = null;
      let navigationError = null;
      try {
        const response = await page.goto(`${baseUrl}/studio/nope?qaProbe=${encodeURIComponent(cacheBust)}`, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        navigationStatus = response?.status() ?? null;
        await page.waitForTimeout(12_000);
      } catch (error) {
        navigationError = error instanceof Error ? error.message : String(error);
      }

      const observation = await page.evaluate(() => {
        const bodyText = document.body?.innerText?.trim() || "";
        const main = document.querySelector("main, h1, [role='main'], [data-studio-error-boundary]");
        return {
          bodyTextLength: bodyText.length,
          bodyPreview: bodyText.slice(0, 400),
          hasReadySurface: Boolean(main),
          htmlLength: document.documentElement?.outerHTML.length ?? 0,
          background: getComputedStyle(document.body).backgroundColor,
          title: document.title,
          url: location.href,
        };
      });

      const screenshot = `screenshots/${profile.id}-round-${round}.png`;
      await page.screenshot({ path: path.join(outputDir, screenshot), fullPage: true });

      const failedAssetResponses = badResponses.filter((entry) => /\/assets\//u.test(entry));
      const ok = navigationStatus === 200
        && navigationError === null
        && observation.bodyTextLength > 0
        && observation.hasReadySurface
        && pageErrors.length === 0
        && failedAssetResponses.length === 0;

      results.push({
        profile: profile.id,
        round,
        ok,
        navigationStatus,
        navigationError,
        observation,
        consoleErrors,
        pageErrors,
        requestFailures,
        badResponses,
        failedAssetResponses,
        screenshot,
      });
      console.log(`[invalid-route] ${profile.id} round=${round} ${ok ? "PASS" : "FAIL"} text=${observation.bodyTextLength} badAssets=${failedAssetResponses.length}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok);
const summary = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  rounds,
  caseCount: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  results,
};
await fs.writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

const lines = [
  "# Live invalid Studio route probe",
  "",
  `- Target: ${baseUrl}/studio/nope`,
  `- Cases: ${results.length}`,
  `- Passed: ${results.length - failed.length}`,
  `- Failed: ${failed.length}`,
  "",
  "| Profile | Round | Result | Body text | Failed assets | Page errors |",
  "|---|---:|---:|---:|---:|---:|",
  ...results.map((result) => `| ${result.profile} | ${result.round} | ${result.ok ? "PASS" : "FAIL"} | ${result.observation.bodyTextLength} | ${result.failedAssetResponses.length} | ${result.pageErrors.length} |`),
  "",
];
await fs.writeFile(path.join(outputDir, "report.md"), `${lines.join("\n")}\n`, "utf8");

if (failed.length > 0) process.exitCode = 1;
