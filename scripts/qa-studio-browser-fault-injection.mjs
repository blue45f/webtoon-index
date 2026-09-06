import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium, firefox, webkit } from "playwright";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const BROWSER_NAME = process.env.QA_BROWSER ?? "chromium";
const WEB_ORIGIN = (process.env.QA_WEB_ORIGIN ?? "http://127.0.0.1:5419").replace(/\/+$/u, "");
const REPORT_DIR = process.env.QA_REPORT_DIR ?? `qa-results/studio-browser-faults/${BROWSER_NAME}`;
const EVIDENCE_DIR = process.env.QA_EVIDENCE_DIR ?? `artifacts/studio-browser-faults/${BROWSER_NAME}`;
const browserType = { chromium, firefox, webkit }[BROWSER_NAME];
if (!browserType) throw new Error(`Unsupported QA_BROWSER: ${BROWSER_NAME}`);

const results = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function text(value, max = 2_000) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);
}

function record(id, passed, details, severity = "hard") {
  const result = { id, passed: Boolean(passed), severity, details, at: new Date().toISOString() };
  results.push(result);
  let resultPrefix;
  if (result.passed) resultPrefix = "PASS";
  else if (severity === "hard") resultPrefix = "FAIL";
  else resultPrefix = "WARN";
  console.log(`[fault-qa] ${resultPrefix} ${id}: ${text(JSON.stringify(details), 900)}`);
}

async function waitForHttp(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "not attempted";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return response.status;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = text(error instanceof Error ? error.message : error);
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${last}`);
}

function startWebServer() {
  const url = new URL(WEB_ORIGIN);
  return spawn(
    "pnpm",
    ["exec", "vite", "--host", url.hostname, "--port", url.port, "--strictPort"],
    {
      cwd: ROOT,
      detached: process.platform !== "win32",
      env: { ...process.env, NODE_ENV: "test", NEST_API_URL: "http://127.0.0.1:49999" },
      stdio: "inherit",
    },
  );
}

async function stopTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform !== "win32" && Number.isInteger(child.pid)) process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + 5_000;
  while (child.exitCode === null && Date.now() < deadline) await sleep(50);
  if (child.exitCode === null) {
    try {
      if (process.platform !== "win32" && Number.isInteger(child.pid)) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      // Best-effort cleanup only.
    }
  }
}

async function installWebGlFailure(page, introShown) {
  await page.addInitScript(({ shown }) => {
    if (shown) sessionStorage.setItem("toonspectrum-intro-shown", "true");
    else sessionStorage.removeItem("toonspectrum-intro-shown");

    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      writable: true,
      value(type, ...args) {
        const kind = String(type).toLowerCase();
        if (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl") return null;
        return original.call(this, type, ...args);
      },
    });
  }, { shown: introShown });
}

async function screenshot(page, name) {
  const target = path.join(EVIDENCE_DIR, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true, animations: "disabled" }).catch(() => undefined);
  return target;
}

async function pageSnapshot(page) {
  return page.evaluate(() => {
    const bodyText = (document.body?.innerText ?? "").trim();
    const interactive = document.querySelectorAll(
      "button, a[href], input, textarea, select, [role='button'], [tabindex]:not([tabindex='-1'])",
    ).length;
    const visuals = document.querySelectorAll("canvas, svg, img, video, [role='dialog']").length;
    return {
      bodyTextLength: bodyText.length,
      bodyPreview: bodyText.replace(/\s+/gu, " ").slice(0, 320),
      interactive,
      visuals,
      readyState: document.readyState,
      url: location.href,
    };
  });
}

async function runIntroCase(browser, { id, introShown, reducedMotion, viewport }) {
  const context = await browser.newContext({
    viewport,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    colorScheme: "dark",
    reducedMotion,
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(text(error instanceof Error ? error.stack ?? error.message : error, 4_000)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const value = message.text();
    if (/Failed to load resource.*502|favicon|fonts\.googleapis|fonts\.gstatic/iu.test(value)) return;
    consoleErrors.push(text(value, 2_000));
  });
  await installWebGlFailure(page, introShown);

  const response = await page.goto(`${WEB_ORIGIN}/studio/publish`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await sleep(3_600);
  const snapshot = await pageSnapshot(page);
  const shot = await screenshot(page, id);
  const webGlErrors = [...pageErrors, ...consoleErrors].filter((value) => /WebGL|creating WebGL context/iu.test(value));
  const usable = snapshot.bodyTextLength > 0 && snapshot.interactive + snapshot.visuals > 0 && pageErrors.length === 0;

  record(id, usable, {
    introShown,
    reducedMotion,
    viewport,
    status: response?.status() ?? null,
    snapshot,
    pageErrors,
    consoleErrors,
    webGlErrorCount: webGlErrors.length,
    screenshot: shot,
  });
  await context.close();
  return { usable, snapshot, pageErrors, consoleErrors };
}

async function runCompatibilityCase(browser) { // NOSONAR javascript:S3776
  const viewport = { width: 700, height: 412 };
  const context = await browser.newContext({
    viewport,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    colorScheme: "dark",
    reducedMotion: "reduce",
    hasTouch: true,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(text(error instanceof Error ? error.stack ?? error.message : error, 4_000)));
  await installWebGlFailure(page, true);
  await page.goto(`${WEB_ORIGIN}/studio`, { waitUntil: "domcontentloaded", timeout: 120_000 });

  const heading = page.getByText("최신 브라우저 업데이트가 필요합니다", { exact: true }).first();
  let visible = false;
  try {
    await heading.waitFor({ state: "visible", timeout: 20_000 });
    visible = true;
  } catch {
    // Keep the initialized false value when the modal is absent.
  }
  record("compat-modal-visible", visible, { viewport, pageErrors });
  if (!visible) {
    await screenshot(page, "compat-modal-missing");
    await context.close();
    return;
  }

  const metrics = await heading.evaluate((node) => {
    const modal = node.parentElement?.parentElement?.parentElement;
    const rect = modal?.getBoundingClientRect();
    const style = modal ? getComputedStyle(modal) : null;
    const dialog = document.querySelector("[role='dialog']");
    const buttons = [...(modal?.querySelectorAll("button") ?? [])].map((button) => {
      const box = button.getBoundingClientRect();
      return {
        name: (button.textContent ?? "").trim().replace(/\s+/gu, " "),
        width: Number(box.width.toFixed(1)),
        height: Number(box.height.toFixed(1)),
        top: Number(box.top.toFixed(1)),
        bottom: Number(box.bottom.toFixed(1)),
      };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      modalFound: Boolean(modal),
      modalRect: rect
        ? {
            left: Number(rect.left.toFixed(1)),
            top: Number(rect.top.toFixed(1)),
            right: Number(rect.right.toFixed(1)),
            bottom: Number(rect.bottom.toFixed(1)),
            width: Number(rect.width.toFixed(1)),
            height: Number(rect.height.toFixed(1)),
          }
        : null,
      modalClientHeight: modal?.clientHeight ?? null,
      modalScrollHeight: modal?.scrollHeight ?? null,
      overflowY: style?.overflowY ?? null,
      hasDialogRole: Boolean(dialog),
      ariaModal: dialog?.getAttribute("aria-modal") ?? null,
      targetBlankLinks: modal?.querySelectorAll("a[target='_blank']").length ?? 0,
      buttons,
    };
  });

  const fitsViewport = Boolean(
    metrics.modalRect
    && metrics.modalRect.top >= 0
    && metrics.modalRect.bottom <= metrics.viewport.height,
  );
  const scrollable = Boolean(
    metrics.modalScrollHeight
    && metrics.modalClientHeight
    && metrics.modalScrollHeight > metrics.modalClientHeight
    && ["auto", "scroll"].includes(metrics.overflowY),
  );
  record("compat-modal-fits-or-scrolls", fitsViewport || scrollable, { ...metrics, fitsViewport, scrollable });
  record(
    "compat-modal-dialog-semantics",
    metrics.hasDialogRole && metrics.ariaModal === "true",
    metrics,
  );
  record(
    "compat-modal-touch-targets",
    metrics.buttons.every((button) => button.width >= 44 && button.height >= 44),
    { buttons: metrics.buttons },
    "soft",
  );

  const refresh = page.getByRole("button", { name: "새로고침" }).first();
  const continueButton = page.getByRole("button", { name: "호환 모드로 계속하기" }).first();
  const nonBlocking = await continueButton.isVisible().catch(() => false);
  let refreshRect = null;
  let remainedAfterEscape = null;
  if (await refresh.isVisible().catch(() => false)) {
    await refresh.focus();
    refreshRect = await refresh.boundingBox().catch(() => null);
    await page.keyboard.press("Escape");
    await sleep(250);
    remainedAfterEscape = await heading.isVisible().catch(() => false);
  }
  record(
    "compat-modal-escape-dismiss",
    !nonBlocking || remainedAfterEscape === false,
    { nonBlocking, remainedAfterEscape, refreshRect },
  );
  record(
    "compat-modal-focused-control-visible",
    !refreshRect || (refreshRect.y >= 0 && refreshRect.y + refreshRect.height <= viewport.height),
    { viewport, refreshRect },
  );

  await screenshot(page, "compat-modal-landscape-700x412");
  await context.close();
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  await mkdir(EVIDENCE_DIR, { recursive: true });

  let server = null;
  let browser = null;
  try {
    server = startWebServer();
    const status = await waitForHttp(`${WEB_ORIGIN}/studio`);
    record("vite-server-start", status < 500, { status, webOrigin: WEB_ORIGIN });

    browser = await browserType.launch({
      headless: true,
      ...(BROWSER_NAME === "chromium"
        ? { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }
        : {}),
    });

    const control = await runIntroCase(browser, {
      id: "intro-skipped-webgl-failure-control",
      introShown: true,
      reducedMotion: "no-preference",
      viewport: { width: 700, height: 412 },
    });
    const firstVisit = await runIntroCase(browser, {
      id: "intro-first-visit-webgl-failure",
      introShown: false,
      reducedMotion: "no-preference",
      viewport: { width: 700, height: 412 },
    });
    const reduced = await runIntroCase(browser, {
      id: "intro-first-visit-webgl-failure-reduced-motion",
      introShown: false,
      reducedMotion: "reduce",
      viewport: { width: 412, height: 700 },
    });

    record(
      "intro-failure-isolated-to-first-visit",
      control.usable && (!firstVisit.usable || !reduced.usable),
      {
        controlUsable: control.usable,
        firstVisitUsable: firstVisit.usable,
        reducedMotionUsable: reduced.usable,
      },
      "diagnostic",
    );

    await runCompatibilityCase(browser);
  } finally {
    await browser?.close().catch(() => undefined);
    await stopTree(server);
  }

  const hardFailures = results.filter((item) => !item.passed && item.severity === "hard");
  const report = {
    generatedAt: new Date().toISOString(),
    browser: BROWSER_NAME,
    webOrigin: WEB_ORIGIN,
    total: results.length,
    passed: results.filter((item) => item.passed).length,
    hardFailures: hardFailures.length,
    results,
  };
  await writeFile(path.join(REPORT_DIR, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    path.join(REPORT_DIR, "report.md"),
    [
      `# Studio browser fault injection — ${BROWSER_NAME}`,
      "",
      `- Generated: ${report.generatedAt}`,
      `- Cases: ${report.total}`,
      `- Passed: ${report.passed}`,
      `- Hard failures: ${report.hardFailures}`,
      "",
      "| Result | Severity | Case | Details |",
      "|---|---|---|---|",
      ...results.map((item) =>
        `| ${item.passed ? "PASS" : "FAIL"} | ${item.severity} | ${item.id} | ${text(JSON.stringify(item.details), 260).replace(/\|/gu, "\\|")} |`
      ),
      "",
    ].join("\n"),
  );

  if (hardFailures.length > 0) {
    throw new Error(`${hardFailures.length} hard fault-injection case(s) failed: ${hardFailures.map((item) => item.id).join(", ")}`);
  }
}

main().catch(async (error) => {
  console.error(`[fault-qa] fatal: ${text(error instanceof Error ? error.stack ?? error.message : error, 4_000)}`);
  process.exitCode = 1;
});
