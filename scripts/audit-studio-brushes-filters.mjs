/**
 * Real-browser studio audit: mouse-drawn brushes, filters, and long-task freeze probe.
 * Uses the running Vite server on :5173.
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const STUDIO = process.env.STUDIO_URL
  ?? "http://localhost:5173/studio?audit=perf-brushes-filters";
const OUT = "/tmp/studio-brush-filter-audit.json";

async function dismissChrome(page) {
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(80);
  }
  const dismissers = [
    "호환 모드로 계속하기",
    "임시저장본 영구 삭제",
    "비우기",
    "닫기",
    "레이어 필터 닫기",
  ];
  for (const name of dismissers) {
    const btn = page.getByRole("button", { name, exact: false }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 1000 }).catch(() => {});
    }
  }
}

async function sampleKonva(page) {
  return page.evaluate(() => {
    const stage = window.Konva?.stages?.[0];
    const nodes = [];
    stage?.find("Line, Path, Image, Text").forEach((n) => {
      if (!n.visible()) return;
      const name = n.name() || "";
      if (name.includes("cursor") || name === "bg" || name === "back") return;
      const box = n.getClientRect({ skipShadow: true });
      const attrs = n.getAttrs();
      if (box.width < 2 && box.height < 2 && !(attrs.points && attrs.points.length > 2)) return;
      nodes.push({
        cls: n.getClassName(),
        name,
        w: Math.round(box.width),
        h: Math.round(box.height),
        pts: attrs.points?.length,
        stroke: attrs.stroke,
        text: typeof n.text === "function" ? n.text() : undefined,
      });
    });
    return {
      nodes,
      frameGraph: document.querySelector("[data-studio-frame-graph-document]")
        ?.getAttribute("data-studio-frame-graph-document"),
      authority: document.querySelector("[data-studio-vello-hub-authority]")
        ?.getAttribute("data-studio-vello-hub-authority"),
      gpuCanvas: [...document.querySelectorAll("[data-studio-vello-hub-surface]")].map((c) => ({
        w: c.width,
        h: c.height,
        display: c.style.display,
        present: c.dataset.studioVelloPresentNodes ?? null,
      })),
      undo: document.querySelector("[data-studio-history-undo-depth]")
        ?.getAttribute("data-studio-history-undo-depth"),
      penPressed: document.querySelector("[data-studio-rail-tool-id='pen']")
        ?.getAttribute("aria-pressed"),
      longTasks: window.__studioLongTasks ?? [],
    };
  });
}

async function drawStroke(page, x1n, y1n, x2n, y2n) {
  const box = await page.locator("[data-studio-frame-graph-document]").boundingBox()
    ?? await page.locator(".konvajs-content").boundingBox();
  if (!box) throw new Error("paper box missing");
  const x1 = box.x + box.width * x1n;
  const y1 = box.y + box.height * y1n;
  const x2 = box.x + box.width * x2n;
  const y2 = box.y + box.height * y2n;
  await page.mouse.move(x1, y1);
  await page.mouse.down({ button: "left" });
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, { steps: 1 });
  }
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(280);
}

async function main() { // NOSONAR javascript:S3776
  const result = {
    ok: false,
    brushes: [],
    filters: [],
    perf: {},
    errors: [],
  };
  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--enable-unsafe-webgpu"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => result.errors.push(`pageerror:${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") result.errors.push(`console:${msg.text()}`);
  });
  await page.addInitScript(() => {
    window.__studioLongTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__studioLongTasks.push({
            name: entry.name,
            duration: Math.round(entry.duration),
          });
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // longtask may be unavailable
    }
  });

  const started = Date.now();
  await page.goto(STUDIO, { waitUntil: "load", timeout: 60_000 });
  try {
    await page.locator("[data-studio-rail-tool-id='pen']").waitFor({ timeout: 45_000 });
  } catch (error) {
    result.boot = {
      url: page.url(),
      title: await page.title(),
      body: (await page.locator("body").innerText().catch(() => "")).slice(0, 400),
    };
    await page.screenshot({ path: "/tmp/studio-brush-filter-boot-fail.png" }).catch(() => {});
    throw error;
  }
  await dismissChrome(page);
  const full = page.getByRole("button", { name: /^전체/ });
  if (await full.isVisible().catch(() => false)) {
    await full.click().catch(() => {});
  }
  await dismissChrome(page);

  await page.locator("[data-studio-rail-tool-id='pen']").click();
  await page.waitForTimeout(200);
  const penPressed = await page.locator("[data-studio-rail-tool-id='pen']").getAttribute("aria-pressed");
  if (penPressed !== "true") {
    await page.keyboard.press("b");
    await page.waitForTimeout(150);
  }

  const brushPlan = [
    { name: "pen-default", chip: null, x1: 0.18, y1: 0.22, x2: 0.42, y2: 0.38 },
    { name: "watercolor", match: /수채/, x1: 0.18, y1: 0.42, x2: 0.40, y2: 0.58 },
    { name: "airbrush", match: /에어브러시/, x1: 0.18, y1: 0.62, x2: 0.38, y2: 0.76 },
    { name: "ink", match: /잉크|G펜/, x1: 0.48, y1: 0.22, x2: 0.72, y2: 0.40 },
  ];

  for (const brush of brushPlan) {
    if (brush.match) {
      const option = page.getByRole("option", { name: brush.match }).first();
      if (await option.isVisible().catch(() => false)) {
        await option.click();
        await page.waitForTimeout(80);
      } else {
        const chip = page.locator("[data-studio-brush-chip]").filter({ hasText: brush.match }).first();
        if (await chip.count()) await chip.click().catch(() => {});
      }
    }
    const before = await sampleKonva(page);
    await drawStroke(page, brush.x1, brush.y1, brush.x2, brush.y2);
    const after = await sampleKonva(page);
    result.brushes.push({
      name: brush.name,
      penPressed: after.penPressed,
      nodesBefore: before.nodes?.length ?? 0,
      nodesAfter: after.nodes?.length ?? 0,
      nodes: after.nodes,
      undo: after.undo,
      ok: (after.nodes?.length ?? 0) > (before.nodes?.length ?? 0)
        || Number(after.undo ?? 0) > Number(before.undo ?? 0),
    });
    console.error(JSON.stringify(result.brushes.at(-1)));
  }
  await page.screenshot({ path: "/tmp/studio-brushes-after-draw.png" }).catch(() => {});

  try {
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 180;
    canvas.height = 120;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ff3b30";
    ctx.fillRect(0, 0, 180, 120);
    ctx.fillStyle = "#2196f3";
    ctx.fillRect(20, 20, 80, 80);
    ctx.fillStyle = "#ffcc00";
    ctx.beginPath();
    ctx.arc(130, 60, 30, 0, Math.PI * 2);
    ctx.fill();
    return canvas.toDataURL("image/png");
  });
  await page.locator("[data-studio-rail-tool-id='text']").click().catch(() => {});
  await page.waitForTimeout(150);
  await page.locator("[data-studio-rail-tool-id='bubble']").click().catch(() => {});
  await page.waitForTimeout(150);
  const imageInput = page.locator('input[type="file"][accept*="image"]').first();
  const buffer = Buffer.from(png.split(",")[1], "base64");
  await imageInput.setInputFiles({
    name: "audit-filter.png",
    mimeType: "image/png",
    buffer,
  });
  await page.waitForTimeout(600);

  await page.getByRole("menuitem", { name: "효과" }).click().catch(() => {});
  await page.waitForTimeout(120);
  const filterNames = ["가우시안 블러", "색조 / 채도 / 밝기", "모자이크 / 픽셀화"];
  for (const name of filterNames) {
    const item = page.getByRole("menuitem", { name: new RegExp(name) }).first();
    const visible = await item.isVisible().catch(() => false);
    if (!visible) {
      await page.getByRole("menuitem", { name: "효과" }).click().catch(() => {});
      await page.waitForTimeout(80);
    }
    const t0 = Date.now();
    if (await item.isVisible().catch(() => false)) {
      await item.click({ timeout: 3000 }).catch((error) => {
        result.filters.push({ name, ok: false, error: String(error) });
      });
    }
    await page.waitForTimeout(400);
    const dialog = page.getByRole("dialog");
    const dialogOpen = await dialog.isVisible().catch(() => false);
    if (dialogOpen) {
      const apply = page.getByRole("button", { name: /적용|확인|미리보기/ }).first();
      if (await apply.isVisible().catch(() => false)) {
        await apply.click().catch(() => {});
        await page.waitForTimeout(400);
      } else {
        await page.keyboard.press("Escape");
      }
    }
    result.filters.push({
      name,
      dialogOpen,
      ms: Date.now() - t0,
      ok: true,
    });
    await dismissChrome(page);
  }
  } catch (error) {
    result.filters.push({ name: "setup", ok: false, error: String(error) });
  }

  const after = await sampleKonva(page);
  result.perf = {
    elapsedMs: Date.now() - started,
    longTasks: after.longTasks,
    longTaskCount: after.longTasks.length,
    longTaskMax: after.longTasks.reduce((m, t) => Math.max(m, t.duration), 0),
    gpuCanvas: after.gpuCanvas,
    frameGraph: after.frameGraph,
    authority: after.authority,
    undo: after.undo,
  };
  result.ok = result.brushes.filter((b) => b.ok).length >= 1
    && result.errors.filter((e) => !e.includes("502")).length === 0;
  await page.screenshot({ path: "/tmp/studio-brush-filter-audit.png", fullPage: false });
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
