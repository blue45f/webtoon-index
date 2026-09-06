import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium, firefox, webkit } from "playwright";

import {
  startIsolatedMarketApi,
  stopDetachedProcessTree,
  stopIsolatedMarketApi,
  validateIsolatedMarketApiTarget,
} from "./isolated-market-api.mjs";

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const BROWSER_NAME = process.env.QA_BROWSER ?? "chromium";
const PROFILE_ID = process.env.QA_PROFILE_ID ?? "desktop-1440";
const WIDTH = Number(process.env.QA_VIEWPORT_WIDTH ?? 1_440);
const HEIGHT = Number(process.env.QA_VIEWPORT_HEIGHT ?? 900);
const HAS_TOUCH = process.env.QA_HAS_TOUCH === "1";
const MOBILE = process.env.QA_IS_MOBILE === "1";
const USER_AGENT = process.env.QA_USER_AGENT?.trim() || undefined;
const API_ORIGIN = (process.env.QA_API_ORIGIN ?? "http://127.0.0.1:4301").replace(/\/+$/u, "");
const WEB_ORIGIN = (process.env.QA_WEB_ORIGIN ?? "http://127.0.0.1:5319").replace(/\/+$/u, "");
const REPORT_DIR =
  process.env.QA_REPORT_DIR
  ?? `qa-results/studio-authenticated-browser/${BROWSER_NAME}-${PROFILE_ID}`;
const EVIDENCE_DIR =
  process.env.QA_EVIDENCE_DIR
  ?? `artifacts/studio-authenticated-browser/${BROWSER_NAME}-${PROFILE_ID}`;
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL?.trim();

const browserTypes = { chromium, firefox, webkit };
const browserType = browserTypes[BROWSER_NAME];
if (!browserType) throw new Error(`Unsupported QA_BROWSER: ${BROWSER_NAME}`);
if (!Number.isFinite(WIDTH) || !Number.isFinite(HEIGHT) || WIDTH < 240 || HEIGHT < 400) {
  throw new Error("QA viewport must be at least 240x400.");
}
if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required.");

const results = [];
const observations = [];
const runtime = {
  pageErrors: [],
  consoleErrors: [],
  requestFailures: [],
  responses: [],
};

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeText(value, max = 1_500) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);
}

function record(id, passed, details = {}, severity = "hard") {
  results.push({
    id,
    passed: Boolean(passed),
    severity,
    details,
    at: new Date().toISOString(),
  });
  let prefix;
  if (passed) prefix = "PASS";
  else if (severity === "hard") prefix = "FAIL";
  else prefix = "WARN";
  console.log(`[auth-browser] ${prefix} ${id}: ${safeText(JSON.stringify(details), 800)}`);
}

function observe(id, details = {}) {
  observations.push({ id, details, at: new Date().toISOString() });
  console.log(`[auth-browser] OBS ${id}: ${safeText(JSON.stringify(details), 800)}`);
}

async function waitForHttp(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status < 500) return response.status;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = safeText(error instanceof Error ? error.message : error);
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

function startWebServer() {
  const url = new URL(WEB_ORIGIN);
  return spawn(
    "pnpm",
    [
      "exec",
      "vite",
      "--host",
      url.hostname,
      "--port",
      url.port,
      "--strictPort",
    ],
    {
      cwd: REPOSITORY_ROOT,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        NEST_API_URL: API_ORIGIN,
        NODE_ENV: "test",
      },
      stdio: "inherit",
    },
  );
}

async function browserJson(page, pathname, options = {}) {
  return page.evaluate(
    async ({ target, method, body, headers }) => {
      const response = await fetch(target, {
        method,
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          "x-toonspectrum-csrf": "1",
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // Keep the initialized null value for non-JSON responses.
      }
      return {
        ok: response.ok,
        status: response.status,
        text: text.slice(0, 2_000),
        json,
      };
    },
    {
      target: pathname,
      method: options.method ?? "GET",
      body: options.body,
      headers: options.headers ?? {},
    },
  );
}

async function visibleBodySignal(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText ?? "").trim();
    const visualCount = document.querySelectorAll(
      "canvas, svg, img, video, [data-studio-mobile-editing-dock='true']",
    ).length;
    return {
      bodyTextLength: text.length,
      bodyPreview: text.replace(/\s+/gu, " ").slice(0, 300),
      visualCount,
      readyState: document.readyState,
      url: location.href,
    };
  });
}

async function screenshot(page, name) {
  const output = path.join(EVIDENCE_DIR, `${name}.png`);
  await page.screenshot({ path: output, fullPage: true, animations: "disabled" }).catch((error) => {
    observe(`screenshot-${name}-failed`, { error: safeText(error) });
  });
  return output;
}

async function largestVisibleCanvas(page) {
  const canvases = page.locator("canvas:visible");
  const count = await canvases.count();
  let best = null;
  for (let index = 0; index < count; index += 1) {
    const box = await canvases.nth(index).boundingBox().catch(() => null);
    if (!box || box.width < 80 || box.height < 80) continue;
    if (!best || box.width * box.height > best.box.width * best.box.height) {
      best = { index, box, locator: canvases.nth(index) };
    }
  }
  return best;
}

async function probeCanvas(page) {
  const candidate = await largestVisibleCanvas(page);
  if (!candidate) return { attempted: false, reason: "no visible canvas >= 80x80" };

  const before = await candidate.locator.screenshot({ animations: "disabled" }).catch(() => null);
  if (!before) return { attempted: false, reason: "canvas screenshot failed" };

  const { box } = candidate;
  const startX = box.x + Math.max(24, Math.min(box.width - 24, box.width * 0.32));
  const startY = box.y + Math.max(24, Math.min(box.height - 24, box.height * 0.42));
  const endX = Math.min(box.x + box.width - 24, startX + Math.max(40, box.width * 0.18));
  const endY = Math.min(box.y + box.height - 24, startY + Math.max(24, box.height * 0.11));

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 20 });
  await page.mouse.up();
  await sleep(350);

  const afterDraw = await candidate.locator.screenshot({ animations: "disabled" }).catch(() => null);
  await page.keyboard.press("Control+z").catch(() => undefined);
  await sleep(150);
  const afterUndo = await candidate.locator.screenshot({ animations: "disabled" }).catch(() => null);
  await page.keyboard.press("Control+Shift+z").catch(() => undefined);
  await sleep(150);
  const afterRedo = await candidate.locator.screenshot({ animations: "disabled" }).catch(() => null);

  const digest = (buffer) =>
    buffer ? createHash("sha256").update(buffer).digest("hex").slice(0, 16) : null;
  const beforeHash = digest(before);
  const drawHash = digest(afterDraw);
  const undoHash = digest(afterUndo);
  const redoHash = digest(afterRedo);

  return {
    attempted: true,
    canvasIndex: candidate.index,
    canvasSize: [Number(box.width.toFixed(1)), Number(box.height.toFixed(1))],
    beforeHash,
    drawHash,
    undoHash,
    redoHash,
    drawChanged: Boolean(beforeHash && drawHash && beforeHash !== drawHash),
    undoChanged: Boolean(drawHash && undoHash && drawHash !== undoHash),
    redoChanged: Boolean(undoHash && redoHash && undoHash !== redoHash),
  };
}

async function clickAndDetectDialog(page, locator, id) {
  if ((await locator.count()) === 0 || !(await locator.isVisible().catch(() => false))) {
    return { attempted: false, reason: "trigger missing or hidden" };
  }
  const before = await page.locator("[role='dialog']:visible").count().catch(() => 0);
  try {
    await locator.click({ timeout: 6_000 });
    await sleep(250);
    const after = await page.locator("[role='dialog']:visible").count().catch(() => before);
    const expanded = await locator.getAttribute("aria-expanded").catch(() => null);
    const opened = after > before || expanded === "true";
    if (opened) await page.keyboard.press("Escape").catch(() => undefined);
    return { attempted: true, opened, before, after, expanded };
  } catch (error) {
    await screenshot(page, `${id}-click-failed`);
    return { attempted: true, opened: false, error: safeText(error) };
  }
}

async function probePageList(page) {
  const trigger = page.getByRole("button", { name: "페이지 목록 열기" }).first();
  if ((await trigger.count()) === 0 || !(await trigger.isVisible().catch(() => false))) {
    return { attempted: false, reason: "page-list trigger missing" };
  }
  try {
    await trigger.click({ timeout: 6_000 });
    await sleep(250);
    const add = page.locator('[data-testid="studio-add-page"]').first();
    const opened = await add.isVisible().catch(() => false);
    let added = null;
    if (opened && await add.isEnabled().catch(() => false)) {
      const beforeButtons = await page.locator("button").count();
      await add.click({ timeout: 5_000 });
      await sleep(250);
      const afterButtons = await page.locator("button").count();
      added = afterButtons >= beforeButtons;
    }
    await page.keyboard.press("Escape").catch(() => undefined);
    return { attempted: true, opened, added };
  } catch (error) {
    await screenshot(page, "page-list-failed");
    return { attempted: true, opened: false, added: false, error: safeText(error) };
  }
}

async function probeCommandSearch(page) {
  const baseline = await page.locator("[role='dialog']:visible").count().catch(() => 0);
  await page.keyboard.press("F1").catch(() => undefined);
  await sleep(250);
  const dialogs = await page.locator("[role='dialog']:visible").count().catch(() => baseline);
  const searchInputs = await page.locator(
    'input[type="search"]:visible, [role="dialog"]:visible input:visible',
  ).count().catch(() => 0);
  const opened = dialogs > baseline || searchInputs > 0;
  if (opened) await page.keyboard.press("Escape").catch(() => undefined);
  return { opened, baseline, dialogs, searchInputs };
}

async function probeDraftSave(page) {
  const responses = [];
  const listener = (response) => {
    if (/\/api\/creator\//u.test(response.url())) {
      responses.push({ url: response.url(), status: response.status(), method: response.request().method() });
    }
  };
  page.on("response", listener);
  try {
    const button = page.getByRole("button", { name: /^(초안 저장|공동 저장)(?:\s|$)/u }).first();
    if ((await button.count()) === 0 || !(await button.isVisible().catch(() => false))) {
      return { attempted: false, reason: "save button missing or hidden", responses };
    }
    if (!(await button.isEnabled().catch(() => false))) {
      return { attempted: false, reason: "save button disabled", responses };
    }

    await button.click({ timeout: 6_000 });
    await sleep(350);

    const titleInput = page.getByLabel(/작품.*제목|제목/u).first();
    if ((await titleInput.count()) > 0 && await titleInput.isVisible().catch(() => false)) {
      await titleInput.fill(`QA ${BROWSER_NAME} ${PROFILE_ID} ${Date.now()}`).catch(() => undefined);
    }
    const continueButton = page.getByRole("button", { name: /초안 저장 계속/u }).first();
    if ((await continueButton.count()) > 0 && await continueButton.isVisible().catch(() => false)) {
      await continueButton.click({ timeout: 6_000 }).catch(() => undefined);
    }
    await sleep(1_000);
    const statuses = await page.locator("[role='status']:visible").allInnerTexts().catch(() => []);
    return {
      attempted: true,
      responses,
      statuses: statuses.map((value) => safeText(value, 300)).slice(0, 12),
    };
  } catch (error) {
    await screenshot(page, "draft-save-failed");
    return { attempted: true, responses, error: safeText(error) };
  } finally {
    page.off("response", listener);
  }
}

async function probeSessionFailureRecovery(context) {
  const page = await context.newPage();
  let intercepted = 0;
  await page.route("**/api/auth/session", async (route) => {
    if (intercepted === 0) {
      intercepted += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "QA injected session outage" }),
      });
      return;
    }
    await route.continue();
  });
  const localErrors = [];
  page.on("pageerror", (error) => localErrors.push(safeText(error)));
  await page.goto(`${WEB_ORIGIN}/studio`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await sleep(1_000);
  const degraded = await visibleBodySignal(page);
  await page.unroute("**/api/auth/session");
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  await sleep(800);
  const recoveredSession = await browserJson(page, "/api/auth/session");
  const recovered = recoveredSession.status === 200 && recoveredSession.json?.authenticated === true;
  await screenshot(page, "session-recovery");
  await page.close();
  return { intercepted, degraded, localErrors, recovered, recoveredSession };
}

async function main() { // NOSONAR javascript:S3776
  await mkdir(REPORT_DIR, { recursive: true });
  await mkdir(EVIDENCE_DIR, { recursive: true });

  const target = validateIsolatedMarketApiTarget({
    rawApiUrl: `${API_ORIGIN}/`,
    rawDatabaseUrl: TEST_DATABASE_URL,
  });

  let apiProcess = null;
  let webProcess = null;
  let browser = null;
  let context = null;

  try {
    apiProcess = await startIsolatedMarketApi(target);
    record("isolated-api-start", true, { apiOrigin: target.apiOrigin, databaseName: target.databaseName });

    webProcess = startWebServer();
    const webStatus = await waitForHttp(`${WEB_ORIGIN}/studio`);
    record("web-server-start", webStatus < 500, { webOrigin: WEB_ORIGIN, status: webStatus });

    browser = await browserType.launch({
      headless: true,
      ...(BROWSER_NAME === "chromium"
        ? {
            args: [
              "--use-gl=angle",
              "--use-angle=swiftshader",
              "--enable-unsafe-swiftshader",
            ],
          }
        : {}),
    });

    context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      colorScheme: "light",
      hasTouch: HAS_TOUCH,
      ...(USER_AGENT ? { userAgent: USER_AGENT } : {}),
      ...(BROWSER_NAME === "chromium" && MOBILE ? { isMobile: true } : {}),
    });

    const page = await context.newPage();
    page.on("pageerror", (error) => runtime.pageErrors.push(safeText(error, 2_000)));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (/favicon|fonts\.googleapis|fonts\.gstatic|Failed to load resource.*404/iu.test(text)) return;
      runtime.consoleErrors.push(safeText(text, 2_000));
    });
    page.on("requestfailed", (request) => {
      const url = request.url();
      if (/fonts\.googleapis|fonts\.gstatic|favicon/iu.test(url)) return;
      runtime.requestFailures.push({
        method: request.method(),
        url,
        error: request.failure()?.errorText ?? "failed",
      });
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && /\/api\//u.test(response.url())) {
        runtime.responses.push({
          method: response.request().method(),
          status: response.status(),
          url: response.url(),
        });
      }
    });

    await page.goto(`${WEB_ORIGIN}/studio`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await sleep(1_000);
    const initialBody = await visibleBodySignal(page);
    record(
      "anonymous-studio-render",
      initialBody.bodyTextLength > 0 || initialBody.visualCount > 0,
      initialBody,
    );

    const anonymousSession = await browserJson(page, "/api/auth/session");
    record(
      "anonymous-session",
      anonymousSession.status === 200
        && anonymousSession.json?.authenticated === false
        && anonymousSession.json?.user === null,
      anonymousSession,
    );

    const invalidEmail = await browserJson(page, "/api/auth/signup", {
      method: "POST",
      body: { email: "invalid-email", password: "abcdef", name: "QA Invalid" },
    });
    record("signup-invalid-email", invalidEmail.status === 400, invalidEmail);

    const shortPassword = await browserJson(page, "/api/auth/signup", {
      method: "POST",
      body: { email: `qa-short-${randomUUID()}@example.test`, password: "12345", name: "QA Short" },
    });
    record("signup-short-password", shortPassword.status === 400, shortPassword);

    const accountId = randomUUID();
    const email = `qa-studio-${BROWSER_NAME}-${PROFILE_ID}-${accountId}@example.test`.toLowerCase();
    const password = `Qa-${accountId}-pw`;
    const name = `QA ${BROWSER_NAME} ${PROFILE_ID}`;

    const signup = await browserJson(page, "/api/auth/signup", {
      method: "POST",
      body: { email, password, name },
    });
    record("signup-valid", [200, 201].includes(signup.status), { status: signup.status, json: signup.json });

    const duplicate = await browserJson(page, "/api/auth/signup", {
      method: "POST",
      body: { email, password, name },
    });
    record("signup-duplicate", duplicate.status === 409, duplicate);

    const badLogin = await browserJson(page, "/api/auth/login", {
      method: "POST",
      body: { email, password: `${password}-wrong` },
    });
    record("login-invalid-password", badLogin.status === 401, badLogin);

    const login = await browserJson(page, "/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    record(
      "login-valid",
      login.status === 200 && login.json?.ok === true && login.json?.user?.email === email,
      { status: login.status, json: login.json },
    );

    const cookies = await context.cookies(WEB_ORIGIN);
    const authCookie = cookies.find((cookie) => cookie.name === "toonspectrum-auth-session");
    record(
      "session-cookie-contract",
      Boolean(
        authCookie
        && authCookie.httpOnly
        && authCookie.sameSite === "Lax"
        && authCookie.value,
      ),
      authCookie
        ? {
            name: authCookie.name,
            domain: authCookie.domain,
            path: authCookie.path,
            httpOnly: authCookie.httpOnly,
            secure: authCookie.secure,
            sameSite: authCookie.sameSite,
            valueLength: authCookie.value.length,
          }
        : { cookie: null },
    );

    const session = await browserJson(page, "/api/auth/session");
    record(
      "authenticated-session",
      session.status === 200
        && session.json?.authenticated === true
        && session.json?.user?.email === email,
      session,
    );

    await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
    await sleep(1_000);
    const authenticatedBody = await visibleBodySignal(page);
    record(
      "authenticated-studio-render",
      authenticatedBody.bodyTextLength > 0 || authenticatedBody.visualCount > 0,
      authenticatedBody,
    );
    await screenshot(page, "authenticated-studio");

    const commandSearch = await probeCommandSearch(page);
    record("command-search-f1", commandSearch.opened, commandSearch, "soft");

    await page.keyboard.press("b").catch(() => undefined);
    await page.keyboard.press("e").catch(() => undefined);
    await page.keyboard.press("b").catch(() => undefined);

    const canvasProbe = await probeCanvas(page);
    record("canvas-present", canvasProbe.attempted, canvasProbe);
    record("canvas-stroke-visible-change", canvasProbe.drawChanged, canvasProbe, "soft");
    record("history-undo-visible-change", canvasProbe.undoChanged, canvasProbe, "soft");
    record("history-redo-visible-change", canvasProbe.redoChanged, canvasProbe, "soft");

    const pageList = await probePageList(page);
    record("page-list-open", !pageList.attempted || pageList.opened, pageList);
    if (pageList.attempted && pageList.opened) {
      record("page-add-action", pageList.added !== false, pageList, "soft");
    }

    const workspaceTrigger = page.locator(
      'button[aria-haspopup="dialog"][aria-label^="작업공간:"]',
    ).first();
    const workspace = await clickAndDetectDialog(page, workspaceTrigger, "workspace-dialog");
    record("workspace-dialog-open", !workspace.attempted || workspace.opened, workspace);

    const saveProbe = await probeDraftSave(page);
    observe("draft-save-probe", saveProbe);
    if (saveProbe.attempted && saveProbe.responses.length > 0) {
      record(
        "draft-save-server-response",
        saveProbe.responses.some((response) => response.status >= 200 && response.status < 400),
        saveProbe,
        "soft",
      );
    }

    const secondPage = await context.newPage();
    await secondPage.goto(`${WEB_ORIGIN}/studio`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await sleep(800);
    const secondSession = await browserJson(secondPage, "/api/auth/session");
    record(
      "second-tab-shares-authentication",
      secondSession.status === 200
        && secondSession.json?.authenticated === true
        && secondSession.json?.user?.email === email,
      secondSession,
    );

    const recovery = await probeSessionFailureRecovery(context);
    record(
      "session-503-degraded-render",
      recovery.degraded.bodyTextLength > 0 || recovery.degraded.visualCount > 0,
      recovery.degraded,
    );
    record("session-503-recovery", recovery.recovered && recovery.localErrors.length === 0, recovery);

    const logout = await browserJson(page, "/api/auth/logout", { method: "POST" });
    record("logout", logout.status === 200 && logout.json?.ok === true, logout);

    const firstAfterLogout = await browserJson(page, "/api/auth/session");
    const secondAfterLogout = await browserJson(secondPage, "/api/auth/session");
    record(
      "logout-invalidates-all-tabs",
      firstAfterLogout.json?.authenticated === false
        && secondAfterLogout.json?.authenticated === false,
      { firstAfterLogout, secondAfterLogout },
    );

    await page.evaluate(() => {
      sessionStorage.setItem(
        "toonspectrum-auth-session",
        JSON.stringify({
          user: {
            id: "00000000-0000-4000-8000-000000000000",
            email: "forged@example.test",
            name: "Forged",
            role: "admin",
          },
        }),
      );
    });
    const forged = await browserJson(page, "/api/auth/session");
    record(
      "public-profile-cache-cannot-forge-session",
      forged.status === 200 && forged.json?.authenticated === false,
      forged,
    );

    await secondPage.close();

    const hardFailures = results.filter((result) => !result.passed && result.severity === "hard");
    const softFailures = results.filter((result) => !result.passed && result.severity !== "hard");

    const summary = {
      generatedAt: new Date().toISOString(),
      browser: BROWSER_NAME,
      profile: PROFILE_ID,
      viewport: { width: WIDTH, height: HEIGHT },
      hasTouch: HAS_TOUCH,
      mobile: MOBILE,
      apiOrigin: API_ORIGIN,
      webOrigin: WEB_ORIGIN,
      resultCount: results.length,
      passed: results.filter((result) => result.passed).length,
      hardFailures: hardFailures.length,
      softFailures: softFailures.length,
      results,
      observations,
      runtime: {
        ...runtime,
        pageErrors: [...new Set(runtime.pageErrors)],
        consoleErrors: [...new Set(runtime.consoleErrors)],
      },
    };

    await writeFile(
      path.join(REPORT_DIR, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    const markdown = [
      `# Studio authenticated browser QA — ${BROWSER_NAME} / ${PROFILE_ID}`,
      "",
      `- Generated: ${summary.generatedAt}`,
      `- Viewport: ${WIDTH}×${HEIGHT}`,
      `- Cases: ${summary.resultCount}`,
      `- Passed: ${summary.passed}`,
      `- Hard failures: ${summary.hardFailures}`,
      `- Soft failures: ${summary.softFailures}`,
      "",
      "| Result | Severity | Case | Details |",
      "|---|---|---|---|",
      ...results.map((result) =>
        `| ${result.passed ? "PASS" : "FAIL"} | ${result.severity} | ${result.id} | ${safeText(JSON.stringify(result.details), 240).replace(/\|/gu, "\\|")} |`
      ),
      "",
      "## Runtime diagnostics",
      "",
      `- Page errors: ${summary.runtime.pageErrors.length}`,
      `- Console errors: ${summary.runtime.consoleErrors.length}`,
      `- Failed requests: ${summary.runtime.requestFailures.length}`,
      `- HTTP 4xx/5xx API responses observed: ${summary.runtime.responses.length}`,
      "",
    ].join("\n");
    await writeFile(path.join(REPORT_DIR, "report.md"), `${markdown}\n`);

    if (hardFailures.length > 0) {
      throw new Error(
        `${hardFailures.length} hard authenticated-browser QA case(s) failed: ${
          hardFailures.map((failure) => failure.id).join(", ")
        }`,
      );
    }
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    if (webProcess) await stopDetachedProcessTree(webProcess).catch((error) => {
      console.error(`[auth-browser] web cleanup failed: ${safeText(error)}`);
    });
    if (apiProcess) await stopIsolatedMarketApi(apiProcess).catch((error) => {
      console.error(`[auth-browser] api cleanup failed: ${safeText(error)}`);
    });
  }
}

main().catch(async (error) => {
  const message = safeText(error instanceof Error ? error.stack ?? error.message : error, 4_000);
  console.error(`[auth-browser] fatal: ${message}`);
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(
    path.join(REPORT_DIR, "fatal.json"),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      browser: BROWSER_NAME,
      profile: PROFILE_ID,
      error: message,
      results,
      observations,
      runtime,
    }, null, 2)}\n`,
  ).catch(() => undefined);
  process.exitCode = 1;
});
