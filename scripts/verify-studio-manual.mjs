import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { chromium } from "playwright";

const base = "http://127.0.0.1:4173";
const output = "artifacts/studio-manual";
await mkdir(output, { recursive: true });
const server = spawn("pnpm", ["exec", "vite", "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], { stdio: "inherit" });
const serverExit = new Promise((resolve) => server.once("exit", resolve));
let browser;
const checks = [];
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error("Preview server exited before readiness");
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1500) });
      if (response.ok) { ready = true; break; }
    } catch { /* readiness retry */ }
    await delay(300);
  }
  assert.ok(ready, "Preview server must start");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await context.addInitScript(() => {
    sessionStorage.setItem("toonspectrum-compat-dismissed", "true");
  });
  await context.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: null, items: [], data: [] }) }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/studio/manual`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "스튜디오 매뉴얼", exact: true }).waitFor();
  assert.match(await page.title(), /스튜디오 매뉴얼/);
  assert.equal(await page.locator(".manual-card").count(), 14);
  assert.equal(await page.locator("canvas").count(), 0, "Manual must not initialize an editor canvas");
  await page.screenshot({ path: `${output}/desktop-index.png` });
  checks.push("desktop index, 14 articles, independent editor-free route");

  const search = page.getByRole("searchbox", { name: "매뉴얼 검색어" });
  await search.fill("스머지");
  await page.waitForFunction(() => {
    const cards = document.querySelectorAll(".manual-card");
    return cards.length > 0 && cards.length < 14 && cards[0]?.textContent?.includes("브러시와 지우개");
  });
  assert.match(await page.locator(".manual-card").first().innerText(), /브러시와 지우개/);
  await search.fill("not-a-real-term-938271");
  await page.getByRole("heading", { name: "검색 결과가 없습니다" }).waitFor();
  await page.getByRole("button", { name: "전체 문서 보기", exact: true }).click();
  assert.equal(await page.locator(".manual-card").count(), 14);
  await page.getByLabel("매뉴얼 분류", { exact: true }).selectOption("three");
  assert.equal(await page.locator(".manual-card").count(), 2);
  await page.getByRole("button", { name: "검색 초기화" }).click();
  checks.push("ranked alias search including body mentions, empty state, reset, category filtering");

  await page.goto(`${base}/studio/manual/save-recovery#backup`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "저장·백업·복구", exact: true }).waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "저장·백업·복구", exact: true }).waitFor();
  await page.waitForFunction(() => {
    const target = document.getElementById("backup");
    if (!target) return false;
    const top = target.getBoundingClientRect().top;
    return top >= 76 && top <= 140;
  });
  assert.match(await page.title(), /저장·백업·복구/);
  await page.screenshot({ path: `${output}/desktop-article.png` });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "주소 복사", exact: true }).click();
  await page.getByText("주소를 복사했습니다.", { exact: true }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /save-recovery#backup$/);
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator(".manual-header").isVisible(), false);
  assert.equal(await page.locator("#main-content").evaluate((element) => getComputedStyle(element).overflow), "visible");
  await page.emulateMedia({ media: "screen" });
  checks.push("direct article URL, reload and fragment scrolling, article title, copy with anchor, print unclipping");

  await page.goto(`${base}/studio/manual/not-a-chapter`);
  await page.getByRole("heading", { name: "문서를 찾을 수 없습니다", exact: true }).waitFor();
  await page.getByRole("link", { name: "매뉴얼 홈으로 돌아가기 →" }).click();
  await page.getByRole("heading", { name: "스튜디오 매뉴얼", exact: true }).waitFor();
  await page.keyboard.press("/");
  assert.equal(await search.evaluate((element) => element === document.activeElement), true);
  await search.fill("임시");
  await search.press("Escape");
  assert.equal(await search.inputValue(), "");
  checks.push("friendly unknown URL, keyboard search, Escape reset");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".manual-mobile-contents > summary").click();
  await page.locator(".manual-mobile-contents").getByRole("link", { name: "기본 단축키 찾아보기", exact: true }).click();
  await page.waitForURL("**/studio/manual/shortcuts");
  await page.getByRole("heading", { name: "기본 단축키 찾아보기", exact: true, level: 1 }).waitFor();
  assert.equal(await page.locator(".manual-mobile-contents").getAttribute("open"), null);
  assert.equal(await page.locator("tbody tr").count(), 14);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Page must not overflow horizontally");
  assert.ok(await page.locator(".studio-manual").evaluate((element) => element.scrollWidth <= element.clientWidth), "Manual must not overflow horizontally");
  await page.screenshot({ path: `${output}/mobile-shortcuts.png` });
  checks.push("390px mobile menu, deep link, 14 shortcut rows, no horizontal overflow");
  assert.deepEqual(errors, [], "No uncaught browser exceptions");
  await writeFile(`${output}/results.json`, JSON.stringify({ status: "passed", checks, errors }, null, 2));
  console.log(JSON.stringify({ status: "passed", checks }, null, 2));
} catch (error) {
  await writeFile(`${output}/results.json`, JSON.stringify({ status: "failed", checks, error: String(error) }, null, 2));
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await Promise.race([serverExit, delay(5000)]);
}
