import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { chromium, expect } from "@playwright/test";

const origin = process.env.CREATOR_HOME_ORIGIN || "http://127.0.0.1:4173";
const output = "artifacts/creator-home";
mkdirSync(output, { recursive: true });
const results = [];
const manifest = JSON.parse(readFileSync("apps/web/public/brand/film-manifest.json", "utf8"));
for (const [format, entry] of Object.entries(manifest.assets)) {
  const path = `apps/web/public${entry.src}`;
  assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), entry.sha256);
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], { encoding: "utf8" }));
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  assert.equal(video.width, entry.width);
  assert.equal(video.height, entry.height);
  assert.equal(video.codec_name, "h264");
  assert(Math.abs(Number(probe.format.duration) - 24) < 0.1);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "20", "-i", path, "-frames:v", "1", `${output}/film-${format}-20s.png`]);
  results.push({ check: `render-${format}`, dimensions: [video.width, video.height], duration: probe.format.duration, sha256: entry.sha256 });
}
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const response = await fetch(origin);
    if (response.ok) break;
  } catch { /* Preview server is starting. */ }
  if (attempt === 59) throw new Error("Preview server did not become ready");
  await new Promise((resolve) => setTimeout(resolve, 500));
}
const viewports = [
  ["desktop", 1440, 1000, "ko", "light"],
  ["tablet", 820, 1180, "ko", "light"],
  ["mobile", 390, 844, "ko", "light"],
  ["small-mobile", 320, 740, "ko", "light"],
  ["dark", 1440, 1000, "ko", "dark"],
  ["english-mobile", 390, 844, "en", "light"],
  ["english-small-mobile", 320, 740, "en", "light"],
];
const browser = await chromium.launch({ headless: true });
let currentPage;
let currentName;
let failure;
try {
  for (const [name, width, height, locale, theme] of viewports) {
    currentName = name;
    const context = await browser.newContext({ viewport: { width, height }, locale: locale === "ko" ? "ko-KR" : "en-US", reducedMotion: "reduce" });
    await context.addInitScript(({ locale, theme }) => {
      localStorage.setItem("toonspectrum-lang", JSON.stringify({ state: { lang: locale }, version: 0 }));
      localStorage.setItem("toonspectrum-theme", JSON.stringify({ state: { theme }, version: 0 }));
    }, { locale, theme });
    const page = await context.newPage();
    currentPage = page;
    const errors = [];
    const videoRequests = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("request", (request) => { if (/\.mp4(?:\?|$)/.test(request.url())) videoRequests.push(request.url()); });
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator('[data-creator-home="studio-first"]').waitFor({ timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(await page.locator("video").count(), 0, "Video must not mount before a user gesture");
    assert.equal(videoRequests.length, 0, "Video must not download before a user gesture");
    const brand = locale === "ko" ? "툰스튜디오" : "ToonStudio";
    await page.waitForFunction((name) => document.title.includes(name), brand);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Horizontal page overflow: ${name}`);
    const headlineBounds = await page.locator("#creator-home-title > span").boundingBox();
    assert(headlineBounds && headlineBounds.x >= 0 && headlineBounds.x + headlineBounds.width <= width + 1, `Clipped headline: ${name}`);
    assert(await page.locator('.ch-actions a[href="/studio"]').isVisible());

    const previewOptions = page.locator(".ch-preview-options button");
    await previewOptions.nth(1).click();
    assert.equal(await previewOptions.nth(1).getAttribute("aria-pressed"), "true");
    assert((await page.locator("#creator-stage-description").innerText()).includes(locale === "ko" ? "장면과 장면" : "one scene"));
    await previewOptions.nth(2).focus();
    await page.keyboard.press("Enter");
    assert.equal(await previewOptions.nth(2).getAttribute("aria-pressed"), "true");
    await previewOptions.nth(0).click();
    const faq = page.locator(".ch-faq summary").first();
    await faq.click();
    assert.equal(await faq.locator("..").getAttribute("open"), "");
    await faq.click();

    // The existing shell intentionally defers its footer. Exercise scroll, wait for its
    // real lazy-loaded content, and only then capture the complete document.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const footer = page.locator('footer[data-site-chrome="footer"]');
    await footer.waitFor({ state: "visible", timeout: 30000 });
    assert.equal(await footer.getByRole("heading", { name: brand, exact: true }).count(), 1);
    assert.equal(await footer.locator("nav").first().locator("a").first().getAttribute("href"), "/studio");
    assert.equal(/툰스펙트럼|ToonSpectrum/i.test(await footer.innerText()), false, `Legacy footer brand: ${name}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Footer overflow: ${name}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true, animations: "disabled" });

    if (name === "desktop") {
      await page.getByTestId("creator-film-play").click();
      const video = page.locator("video");
      // Poll current media state instead of relying on one loadeddata event. Fast decoders can
      // emit that event between the click and listener registration, producing a false timeout.
      await expect.poll(
        () => video.evaluate((element) => element.error ? -element.error.code : element.readyState),
        {
          message: "Brand film reaches HAVE_CURRENT_DATA without a media error",
          timeout: 30000,
        },
      ).toBeGreaterThanOrEqual(2);
      await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0.2);
      assert(Math.abs(await video.evaluate((element) => element.duration) - 24) < 0.1);
      await page.locator(".ch-film-chapters button").nth(2).click();
      assert(await video.evaluate((element) => element.currentTime >= 12));
      await page.getByRole("button", { name: "포스터로 돌아가기" }).click();
      assert.equal(await page.locator("video").count(), 0);
      results.push({ check: "native-video-play-seek-stop", pass: true });
    }
    if (name === "mobile") {
      const trigger = page.locator('header button[aria-haspopup="dialog"]');
      await trigger.click();
      await page.locator('[role="dialog"]').waitFor();
      assert(await page.locator('[role="dialog"] a[href="/ranking"]').isVisible());
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      // SiteHeader restores focus in requestAnimationFrame after removing inert.
      // Keep the real focus contract, but wait for that frame instead of racing it.
      await expect(trigger).toBeFocused({ timeout: 3000 });
      await page.route("**/brand/toonstudio-intro.mp4", (route) => route.abort());
      await page.getByTestId("creator-film-play").click();
      await page.locator(".ch-film-error").waitFor();
      assert.equal(await page.locator('.ch-actions a[href="/studio"]').count(), 1);
      results.push({ check: "mobile-menu-focus-and-film-error", pass: true });
    }
    assert.deepEqual(errors, [], `Uncaught page errors: ${name}`);
    results.push({ check: name, viewport: [width, height], locale, theme, noHorizontalOverflow: true, headlineWithinViewport: true, footerBrandVerified: true, uncaughtErrors: errors });
    await context.close();
    currentPage = undefined;
  }
} catch (error) {
  failure = String(error);
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: `${output}/failure-${currentName}.png`, fullPage: true, animations: "disabled" }).catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
  writeFileSync(`${output}/report.json`, JSON.stringify({ status: failure ? "failed" : "passed", failure, sourceCommit: process.env.GITHUB_SHA || "local", origin, results }, null, 2) + "\n");
}
console.log(JSON.stringify({ status: "passed", results }, null, 2));
