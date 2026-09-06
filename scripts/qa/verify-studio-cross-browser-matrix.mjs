#!/usr/bin/env node

/**
 * Cross-browser Studio route audit for the long soak workflow.
 * Expects `dist/` to exist. It launches one Vite preview server and sweeps Chromium, Firefox and
 * WebKit across desktop, tablet and embedded-mobile viewport contracts.
 */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import process from "node:process";
import { chromium, firefox, webkit } from "playwright";

const OUTPUT_DIR = resolve(process.env.TOONSPECTRUM_VERIFY_DIR ?? "artifacts/studio-cross-browser");
const LOCALE = process.env.TOONSPECTRUM_VERIFY_LOCALE ?? "ko-KR";
const COLOR_SCHEME = process.env.TOONSPECTRUM_VERIFY_COLOR_SCHEME === "dark" ? "dark" : "light";
const REDUCED_MOTION = process.env.TOONSPECTRUM_VERIFY_REDUCED_MOTION === "reduce" ? "reduce" : "no-preference";
const MIN_TAP = 43.5;

const ENGINES = Object.freeze([
  { id: "chromium", type: chromium },
  { id: "firefox", type: firefox },
  { id: "webkit", type: webkit },
]);

const PROFILES = Object.freeze([
  {
    id: "desktop-1440",
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    userAgent: undefined,
  },
  {
    id: "tablet-768",
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  },
  {
    id: "kakaotalk-android-360",
    width: 360,
    height: 592,
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 KAKAOTALK 10.4.3",
  },
  {
    id: "instagram-ios-390",
    width: 390,
    height: 664,
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Mobile/21E236 Instagram 320.0.0.0.0 (iPhone15,3; iOS 17_4; ko_KR)",
  },
]);

const ROUTES = Object.freeze([
  { id: "editor", path: "/studio" },
  { id: "comic", path: "/studio/comic" },
  { id: "animation", path: "/studio/animation" },
  { id: "brushes", path: "/studio/brushes" },
  { id: "lift3d", path: "/studio/lift3d" },
  { id: "publish", path: "/studio/publish" },
]);

const IGNORED_CONSOLE = [
  "/api/auth/session",
  "/api/studio-ai/status",
  "/api/kmas/merge-on-access",
  "/socket.io/",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
];

function log(message) {
  console.log(`[verify-soak-cross-browser] ${message}`);
}

async function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 300));
  }
  throw new Error(`Preview server did not become ready: ${lastError ?? url}`);
}

function stopProcess(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    return;
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already stopped.
    }
  }, 5_000).unref?.();
}

async function installGuestBoundary(page) {
  await page.route("**/api/auth/session", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ authenticated: false, user: null }),
    });
  });
}

async function auditPage(page) {
  return page.evaluate((minimumTap) => { // NOSONAR javascript:S3776
    const viewportWidth = window.innerWidth;
    const selectors = "button, a[href], [role='button'], input:not([type='hidden']), select, textarea";
    const candidates = Array.from(document.querySelectorAll(selectors));

    function isVisible(element) {
      if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width >= 2 && rect.height >= 2;
    }

    function scrollContainer(element) {
      let parent = element.parentElement;
      while (parent && parent !== document.body) {
        const style = getComputedStyle(parent);
        if (["auto", "scroll"].includes(style.overflowX) && parent.scrollWidth > parent.clientWidth + 1) return parent;
        parent = parent.parentElement;
      }
      return null;
    }

    function label(element) {
      return (
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.textContent ||
        element.tagName
      ).trim().replace(/\s+/g, " ").slice(0, 80);
    }

    const offscreen = [];
    const smallTargets = [];
    const unnamed = [];
    for (const element of candidates) {
      if (!isVisible(element)) continue;
      const rect = element.getBoundingClientRect();
      const inScrollRow = Boolean(scrollContainer(element));
      const disabled = element.matches(":disabled") || element.getAttribute("aria-disabled") === "true";
      if (!inScrollRow && (rect.left < -0.5 || rect.right > viewportWidth + 0.5)) {
        offscreen.push(`${element.tagName.toLowerCase()}“${label(element)}” rect=[${rect.left.toFixed(1)}, ${rect.right.toFixed(1)}] vw=${viewportWidth}`);
      }
      if (
        !disabled &&
        !inScrollRow &&
        element.matches("button, a[href], [role='button']") &&
        (rect.width < minimumTap || rect.height < minimumTap)
      ) {
        smallTargets.push(`${element.tagName.toLowerCase()}“${label(element)}” ${rect.width.toFixed(1)}×${rect.height.toFixed(1)}`);
      }
      if (!disabled && !element.getAttribute("aria-label") && !element.getAttribute("aria-labelledby")) {
        if (element.matches("button, [role='button']") && !(element.textContent || "").trim()) {
          unnamed.push(`${element.tagName.toLowerCase()}.${String(element.className).replace(/\s+/g, ".").slice(0, 100)}`);
        }
        if (element.matches("input, select, textarea") && !element.labels?.length && !element.getAttribute("title")) {
          unnamed.push(`${element.tagName.toLowerCase()}[type=${element.getAttribute("type") || "text"}]`);
        }
      }
    }

    return {
      documentOverflowX: Math.max(0, document.documentElement.scrollWidth - viewportWidth),
      offscreen: [...new Set(offscreen)].slice(0, 20),
      smallTargets: [...new Set(smallTargets)].slice(0, 20),
      unnamed: [...new Set(unnamed)].slice(0, 20),
    };
  }, MIN_TAP);
}

async function main() { // NOSONAR javascript:S3776
  await mkdir(OUTPUT_DIR, { recursive: true });
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const preview = spawn(
    "pnpm",
    ["exec", "vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { detached: true, env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] },
  );
  preview.stdout.on("data", (chunk) => process.stdout.write(chunk));
  preview.stderr.on("data", (chunk) => process.stderr.write(chunk));

  let hardFailures = 0;
  let warnings = 0;
  try {
    await waitForServer(baseUrl);
    for (const engine of ENGINES) {
      const browser = await engine.type.launch({ headless: true });
      try {
        for (const profile of PROFILES) {
          const context = await browser.newContext({
            viewport: { width: profile.width, height: profile.height },
            deviceScaleFactor: profile.deviceScaleFactor,
            hasTouch: profile.hasTouch,
            isMobile: engine.id === "firefox" ? false : profile.isMobile,
            userAgent: profile.userAgent,
            locale: LOCALE,
            colorScheme: COLOR_SCHEME,
            reducedMotion: REDUCED_MOTION,
          });
          try {
            for (const route of ROUTES) {
              const page = await context.newPage();
              const scope = `${engine.id}/${profile.id}/${route.id}`;
              const consoleErrors = [];
              const pageErrors = [];
              page.on("pageerror", (error) => pageErrors.push(error.message));
              page.on("console", (message) => {
                if (message.type() !== "error") return;
                const text = message.text();
                if (!IGNORED_CONSOLE.some((ignored) => text.includes(ignored))) consoleErrors.push(text);
              });
              await installGuestBoundary(page);
              try {
                await page.goto(`${baseUrl}${route.path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
                await page.locator("body").waitFor({ state: "visible", timeout: 20_000 });
                await page.waitForTimeout(route.path.startsWith("/studio") ? 2_500 : 1_000);
                const metrics = await auditPage(page);
                const failures = [];
                if (metrics.documentOverflowX > 1) failures.push(`document horizontal overflow ${metrics.documentOverflowX}px`);
                for (const item of metrics.offscreen) failures.push(`offscreen control: ${item}`);
                for (const item of pageErrors.slice(0, 5)) failures.push(`page error: ${item}`);
                for (const item of consoleErrors.slice(0, 5)) failures.push(`console error: ${item}`);

                for (const failure of failures) {
                  hardFailures += 1;
                  log(`${scope} FAIL: ${failure}`);
                }
                for (const item of metrics.smallTargets) {
                  warnings += 1;
                  log(`${scope} warn: small tap target: ${item}`);
                }
                for (const item of metrics.unnamed) {
                  warnings += 1;
                  log(`${scope} warn: unnamed control: ${item}`);
                }
                if (failures.length) {
                  await page.screenshot({
                    path: join(OUTPUT_DIR, `${scope.replaceAll("/", "--")}.png`),
                    fullPage: false,
                  });
                }
                log(`${scope}: overflowX=${metrics.documentOverflowX} offscreen=${metrics.offscreen.length} small=${metrics.smallTargets.length} unnamed=${metrics.unnamed.length} errors=${pageErrors.length + consoleErrors.length} ok=${failures.length === 0}`);
              } catch (error) {
                hardFailures += 1;
                log(`${scope} FAIL: navigation or audit error: ${error?.message ?? error}`);
              } finally {
                await page.close().catch(() => undefined);
              }
            }
          } finally {
            await context.close();
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    stopProcess(preview);
  }

  log(`RESULT: ${hardFailures ? "FAIL" : "PASS"} hardFailures=${hardFailures} warnings=${warnings} locale=${LOCALE} color=${COLOR_SCHEME} motion=${REDUCED_MOTION}`);
  if (hardFailures) process.exitCode = 1;
}

main().catch((error) => {
  log(`FATAL: ${error?.stack ?? error}`);
  process.exitCode = 2;
});
