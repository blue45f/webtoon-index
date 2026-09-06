/**
 * 전수 스윕 프로브 — `docs/perf/brush-advancement-roadmap-2026-08-22.md` §9.1.
 *
 * 실행 대상은 **개발 서버(:5173)** 다. 빌드 dist 를 치지 않으므로 stale-dist 면역이다
 * (audit-studio-brushes-filters.mjs 와 같은 dev-server 패턴).
 *
 * 브러시 목록은 페이지 안에서 카탈로그 모듈을 직접 import 해 열거한다:
 *   import("/src/domains/creator/brush/studio-brush-catalog.ts")
 *   → STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS
 * 브러시 선택은 verify-studio-brushes.mts 의 데스크톱 패턴(카탈로그 searchbox fill →
 * `${name} 선택` 버튼 클릭)을 그대로 쓴다.
 *
 * 브러시마다 두 가지를 잰다.
 * 1. LIVE vs COMMITTED — 600 샘플 제스처 도중(버튼 누른 상태) 캔버스 클립 스크린샷과
 *    mouse.up + 300ms 뒤 스크린샷을 페이지 내 캔버스에 올려 getImageData diff (변경 픽셀 수·
 *    최대 채널差). 노드 측 PNG 디코더가 필요 없다.
 * 2. 장획 성능 — 같은 브러시로 3200 샘플 제스처. in-page rAF 프레임 간격 샘플러 +
 *    longtask PerformanceObserver 로 배치별 프레임시간 p50/p95·longtask 수집.
 *    pageerror/console.error 는 버그 감지, short-stroke diff changedPixels === 0 은 무출력 버그 감지.
 *
 * 결과: results JSON + 최악 20종 표를 docs/perf/live-vs-committed-sweep-<날짜>.md 로.
 *
 * 환경변수:
 *   STUDIO_URL                    기본 http://localhost:5173/studio
 *   TOONSPECTRUM_BRUSH_SWEEP_IDS  쉼표 목록 — 해당 id 만 (스모크/포커스 실행)
 *   TOONSPECTRUM_BRUSH_SWEEP_LIMIT 양의 정수 — 앞 N 종만 (0 = 전체)
 *   SWEEP_HEADLESS                "0" 이면 headed (기본 headless)
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const STUDIO_URL = process.env.STUDIO_URL ?? "http://localhost:5173/studio";
const ID_FILTER = process.env.TOONSPECTRUM_BRUSH_SWEEP_IDS
  ?.split(",")
  .map((id) => id.trim())
  .filter(Boolean) ?? null;
const LIMIT = Number(process.env.TOONSPECTRUM_BRUSH_SWEEP_LIMIT ?? 0);
const HEADLESS = process.env.SWEEP_HEADLESS !== "0";
const SHORT_SAMPLES = 600;
const LONG_SAMPLES = 3200;
const COMMIT_SETTLE_MS = 300;

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const today = new Date().toISOString().slice(0, 10);
const OUT_JSON = process.env.SWEEP_OUT_JSON ?? "/tmp/studio-brush-sweep-results.json";
const OUT_MD = process.env.SWEEP_OUT_MD
  ?? `${repoRoot}docs/perf/live-vs-committed-sweep-${today}.md`;

function log(message) {
  process.stdout.write(`[sweep ${new Date().toISOString().slice(11, 19)}] ${message}\n`);
}

/** 크래시된 대상이 CDP 호출을 영원히 붙잡지 않도록 브러시당 상한을 둔다. */
function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`watchdog:${label} ${ms}ms`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/** 첫 실행 마법사·호환 배너 등 오버레이를 닫는다 (audit-studio-brushes-filters.mjs 패턴). */
async function dismissChrome(page) {
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(80);
  }
}

async function paperBox(page) {
  const box = await page.locator("[data-studio-frame-graph-document]").boundingBox()
    ?? await page.locator(".konvajs-content").boundingBox();
  if (!box) throw new Error("paper box missing");
  return box;
}

/** verify-studio-brushes.mts:963-967 데스크톱 선택 패턴의 포트. */
async function selectBrush(page, name, operation) {
  // 드로잉 옵션 바는 그리기 도구가 활성된 뒤에 마운트된다 — 툴레일의 펜을 먼저 누르고,
  // 지우개 종목은 그 위에서 'e' 로 전환한다(verify-studio-brushes.mts activateDesktopEraser 순서).
  await page
    .locator('[aria-label^="펜"]')
    .first()
    .click()
    .catch(() => {});
  const drawMode = operation === "erase" ? "eraser" : "pen";
  if (operation === "erase") await page.keyboard.press("e");
  await page.waitForFunction(
    (mode) => document
      .querySelector('[data-studio-draw-options="true"]')
      ?.getAttribute("data-studio-active-draw-mode") === mode,
    drawMode,
    { timeout: 15_000 },
  );
  const toolbar = page.locator('[data-studio-draw-options="true"]');
  let pill = toolbar.locator('[data-studio-brush-active-pill="true"]');
  if (await pill.count() === 0) {
    await toolbar.getByRole("button", { name: "펜", exact: true }).click();
    pill = toolbar.locator('[data-studio-brush-active-pill="true"]');
  }
  await pill.waitFor({ state: "visible", timeout: 10_000 });
  await pill.click();
  const catalog = page.locator('[data-studio-brush-catalog-session="true"]');
  await catalog.waitFor({ state: "visible", timeout: 15_000 });
  await catalog.getByRole("tab", { name: "전체", exact: true }).click();
  await catalog.getByRole("searchbox").fill(name);
  const option = catalog.getByRole("button", { name: `${name} 선택`, exact: true });
  await option.waitFor({ state: "visible", timeout: 15_000 });
  await option.scrollIntoViewIfNeeded();
  await option.click({ force: true });
  await catalog.waitFor({ state: "detached" }).catch(() => {});
  await page.waitForFunction(
    (expectedName) => document
      .querySelector('[data-studio-brush-active-pill="true"]')
      ?.getAttribute("aria-label")
      ?.includes(expectedName) === true,
    name,
    { timeout: 15_000 },
  );
}

/** dataURL 두 장을 페이지 캔버스에 올려 픽셀 diff — 변경 픽셀 수와 최대 채널差. */
async function diffShots(page, liveDataUrl, committedDataUrl) {
  return page.evaluate(async ({ live, committed }) => {
    async function loadImage(dataUrl) {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("shot decode failed"));
        image.src = dataUrl;
      });
      return image;
    }
    const [a, b] = await Promise.all([loadImage(live), loadImage(committed)]);
    const w = Math.min(a.naturalWidth, b.naturalWidth);
    const h = Math.min(a.naturalHeight, b.naturalHeight);
    if (w === 0 || h === 0) throw new Error("empty shot");
    const canvasA = document.createElement("canvas");
    canvasA.width = w;
    canvasA.height = h;
    const ctxA = canvasA.getContext("2d", { willReadFrequently: true });
    ctxA.drawImage(a, 0, 0);
    const canvasB = document.createElement("canvas");
    canvasB.width = w;
    canvasB.height = h;
    const ctxB = canvasB.getContext("2d", { willReadFrequently: true });
    ctxB.drawImage(b, 0, 0);
    const da = ctxA.getImageData(0, 0, w, h).data;
    const db = ctxB.getImageData(0, 0, w, h).data;
    let changedPixels = 0;
    let maxChannelDelta = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(
        Math.abs(da[i] - db[i]),
        Math.abs(da[i + 1] - db[i + 1]),
        Math.abs(da[i + 2] - db[i + 2]),
        Math.abs(da[i + 3] - db[i + 3]),
      );
      if (d > 8) changedPixels += 1;
      if (d > maxChannelDelta) maxChannelDelta = d;
    }
    return { changedPixels, maxChannelDelta, width: w, height: h };
  }, { live: liveDataUrl, committed: committedDataUrl });
}

/** rAF 프레임 간격 + longtask 관측기를 심는다. headless 는 rAF 를 서스펜드할 때가 있어 확인 후 1회 재시도한다. */
async function installPerfSampler(page) {
  await page.bringToFront().catch(() => {});
  for (let attempt = 0; attempt < 2; attempt++) {
    // headless 새 페이지는 가끔 rAF 를 서스펜드한다 — 워밍업 프레임 하나를 기다려 확인한다.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
     
    await page.evaluate(() => {
      window.__sweepFrames = [];
      window.__sweepLongTasks = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__sweepLongTasks.push(entry.duration);
      });
      observer.observe({ entryTypes: ["longtask"] });
      window.__sweepObserver = observer;
      let last = performance.now();
      let running = true;
      function tick(now) {
        if (!running) return;
        window.__sweepFrames.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
      window.__sweepStopTick = () => { running = false; };
    });
     
    await page.waitForTimeout(250);
     
    const frames = await page.evaluate(() => (window.__sweepFrames ?? []).length);
    if (frames > 0) return;
    log(`rAF sampler suspended (attempt ${attempt + 1}) — retrying`);
  }
}

/** 샘플러를 멈추고 프레임 통계를 회수한다. 함수는 페이지 경계를 넘을 수 없다. */
async function collectPerfSampling(page) {
  return page.evaluate(() => {
    window.__sweepStopTick?.();
    const frames = (window.__sweepFrames ?? []).slice().sort((x, y) => x - y);
    const pick = (q) => frames.length === 0
      ? 0
      : frames[Math.min(frames.length - 1, Math.floor(q * frames.length))];
    const result = {
      frameCount: frames.length,
      p50: pick(0.5),
      p95: pick(0.95),
      max: frames.length === 0 ? 0 : frames[frames.length - 1],
      longTaskCount: (window.__sweepLongTasks ?? []).length,
      longTaskTotalMs: (window.__sweepLongTasks ?? []).reduce((sum, ms) => sum + ms, 0),
    };
    window.__sweepObserver?.disconnect();
    delete window.__sweepFrames;
    delete window.__sweepLongTasks;
    delete window.__sweepObserver;
    delete window.__sweepStopTick;
    return result;
  });
}

async function drawGesture(page, box, samples) {
  const x1 = box.x + box.width * 0.18;
  const y1 = box.y + box.height * 0.25;
  const x2 = box.x + box.width * 0.82;
  const y2 = box.y + box.height * 0.75;
  // 살짝 구부러진 경로 — 직선만 되는 레인을 걸러내지 않도록.
  const pathPoint = (t) => ({
    x: x1 + (x2 - x1) * t,
    y: y1 + (y2 - y1) * t - Math.sin(t * Math.PI) * box.height * 0.12,
  });
  const start = pathPoint(0);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: "left" });
  // 샘플 수는 유지하되 CDP 왕복은 배치로 줄인다: steps=N 이 서버 측에서 N 개의
  // pointermove 를 생성한다 — 엔진이 보는 이벤트 스트림은 동일하다.
  const batches = 20;
  const perBatch = Math.floor(samples / batches);
  for (let b = 1; b <= batches; b++) {
    const target = pathPoint(b / batches);
    await page.mouse.move(target.x, target.y, { steps: Math.max(1, perBatch) });
  }
}

async function clearCanvas(page) {
  // 명령 바의 실행취소 버튼이 disabled 가 될 때까지 클릭 — macOS 단축키 계열 편차를 피한다.
  for (let i = 0; i < 8; i++) {
    const enabled = await page.getByRole("button", { name: "실행취소", exact: true })
      .first()
      .isEnabled()
      .catch(() => false);
    if (!enabled) return;
    await page.getByRole("button", { name: "실행취소", exact: true }).first().click();
    await page.waitForTimeout(140);
  }
}

async function main() { // NOSONAR javascript:S3776
  const browser = await chromium.launch({
    channel: "chrome",
    headless: HEADLESS,
    args: ["--enable-unsafe-webgpu"],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  let page = await context.newPage();
  const globalErrors = [];
  page.on("pageerror", (error) => globalErrors.push(`pageerror:${error.message.slice(0, 200)}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") globalErrors.push(`console:${msg.text().slice(0, 200)}`);
  });

  /** 탭 크래시 후 같은 컨텍스트에서 새 페이지로 복원한다. */
  async function recoverPageIfCrashed(error) {
    const message = String(error instanceof Error ? error.message : error);
    if (!/Target crashed|Target page, context or browser has been closed|Session closed/.test(message)) {
      return false;
    }
    log("page crashed — recreating");
    try { await page.close(); } catch { /* 이미 닫혀 있음 */ }
    page = await context.newPage();
    page.on("pageerror", (error2) => globalErrors.push(`pageerror:${error2.message.slice(0, 200)}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") globalErrors.push(`console:${msg.text().slice(0, 200)}`);
    });
    await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await dismissChrome(page);
    globalErrors.length = 0;
    return true;
  }

  await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await dismissChrome(page);

  // 카탈로그 열거 — 페이지 안에서 모듈을 직접 import (stale-dist 면역의 핵심).
  const listed = await page.evaluate(async () => {
    const module = await import("/src/domains/creator/brush/studio-brush-catalog.ts");
    const all = module.STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.map((item) => ({
      id: item.id,
      name: item.name,
    }));
    const erasers = new Set(module.STUDIO_LISTED_ERASER_BRUSH_CATALOG_ITEMS.map((item) => item.id));
    return all.map((item) => ({ ...item, operation: erasers.has(item.id) ? "erase" : "paint" }));
  });
  log(`listed brushes: ${listed.length}`);

  let targets = listed;
  if (ID_FILTER) targets = targets.filter((item) => ID_FILTER.includes(item.id));
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);
  log(`targets: ${targets.length}`);

  const results = [];
  const startedAt = Date.now();
  for (const [index, preset] of targets.entries()) {
    const record = {
      id: preset.id,
      name: preset.name,
      operation: preset.operation,
      ok: false,
      error: null,
      liveVsCommitted: null,
      longStroke: null,
      errorsDuringRun: [],
    };
    const phase = (label) => log(`#${index + 1} ${preset.id} — ${label}`);
    const body = (async () => {
      phase("select");
      await withTimeout(selectBrush(page, preset.name, preset.operation), 60_000, "select");
      const box = await paperBox(page);
      const errorBefore = globalErrors.length;

      // 1) LIVE vs COMMITTED (600 샘플, 도중(다운 상태) 캡처 → 끝까지 이동 → 업 후 커밋 캡처)
      await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.25);
      await page.mouse.down({ button: "left" });
      // 전반부 300 샘플(배치 steps) → 라이브 캡처 → 후반부 300 샘플 → 커밋.
      const half = Math.floor(SHORT_SAMPLES / 2);
      await page.mouse.move(
        box.x + box.width * (0.18 + 0.32),
        box.y + box.height * (0.25 + 0.25),
        { steps: half },
      );
      // 버튼은 누른 상태로 스크린샷 — 라이브 중간 프레임.
      const liveShot = (await page.screenshot({ clip: box, type: "png" })).toString("base64");
      await page.mouse.move(
        box.x + box.width * (0.18 + 0.64),
        box.y + box.height * (0.25 + 0.5),
        { steps: SHORT_SAMPLES - half },
      );
      await page.mouse.up({ button: "left" });
      await page.waitForTimeout(COMMIT_SETTLE_MS);
      const committedShot = (await page.screenshot({ clip: box, type: "png" }))
        .toString("base64");
      record.liveVsCommitted = await diffShots(
        page,
        `data:image/png;base64,${liveShot}`,
        `data:image/png;base64,${committedShot}`,
      );

      // 2) 장획 성능 (3200 샘플)
      await clearCanvas(page);
      phase("long-stroke");
      await installPerfSampler(page);
      await drawGesture(page, await paperBox(page), LONG_SAMPLES);
      await page.mouse.up({ button: "left" });
      await page.waitForTimeout(400);
      record.longStroke = await collectPerfSampling(page);
      record.errorsDuringRun = globalErrors.slice(errorBefore);
      // 지우개는 빈 캔버스에서 지울 것이 없어 changedPixels 0 이 정상이다.
      const expectsInk = preset.operation !== "erase";
      record.ok = (record.liveVsCommitted.changedPixels > 0 || !expectsInk)
        && record.errorsDuringRun.length === 0;
      await clearCanvas(page);
    })();
    try {
      await withTimeout(body, 240_000, `brush:${preset.id}`);
    } catch (error) {
      record.error = String(error instanceof Error ? error.message : error).slice(0, 300);
    }
    results.push(record);
    // 크래시는 브러시 결함이 아니라 하네스 복원 사안 — 기록 후 다음 종목은 새 페이지에서.
    if (record.error && /Target crashed|has been closed|Session closed/.test(record.error)) {
      record.crashed = true;
      try {
        await recoverPageIfCrashed(record.error);
      } catch (recoverError) {
        log(`recovery failed: ${String(recoverError).slice(0, 120)}`);
      }
    }
    if (index % 10 === 9 || index === targets.length - 1) {
      const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
      log(`${index + 1}/${targets.length} done (${elapsedMin} min)`);
      writeFileSync(OUT_JSON, JSON.stringify({ startedAt, results }, null, 2));
    }
  }

  writeFileSync(OUT_JSON, JSON.stringify({ startedAt, finishedAt: Date.now(), results }, null, 2));

  const okResults = results.filter((r) => r.longStroke && r.longStroke.p95 > 0);
  const worst = [...okResults]
    .sort((a, b) => b.longStroke.p95 - a.longStroke.p95)
    .slice(0, 20);
  const silent = results.filter((r) => r.ok && r.liveVsCommitted?.changedPixels === 0);
  const errored = results.filter((r) => !r.ok);
  const md = [
    `# 라이브 vs 커밋 전수 스윕 — ${today}`,
    "",
    `- 대상: listed ${listed.length}종 중 ${results.length}종 실행`,
    `- 성공 ${okResults.length} / 실패 ${errored.length} / 무출력 의심 ${silent.length}`,
    `- 산출물: ${OUT_JSON}`,
    "",
    "## 최악 20종 (장획 p95 프레임시간)",
    "",
    "| # | id | p50 | p95 | max | longtasks | changedPx | 최대채널差 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...worst.map((r, i) =>
      `| ${i + 1} | ${r.id} | ${r.longStroke.p50.toFixed(1)} | ${r.longStroke.p95.toFixed(1)}`
      + ` | ${r.longStroke.max.toFixed(1)} | ${r.longStroke.longTaskCount}`
      + ` | ${r.liveVsCommitted?.changedPixels ?? "-"} | ${r.liveVsCommitted?.maxChannelDelta ?? "-"} |`),
    "",
    errored.length > 0 ? ["## 실패 목록", "", ...errored.map((r) =>
      `- ${r.id}: ${r.error ?? r.errorsDuringRun.join("; ")}`)].join("\n") : "",
  ].filter(Boolean).join("\n");
  writeFileSync(OUT_MD, md);
  log(`wrote ${OUT_MD}`);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
