/**
 * Long-session soak for the studio.
 *
 * The per-stroke verifiers each open a fresh page, pick one brush and leave. An artist does not:
 * they draw for an hour, switch brushes dozens of times, run a filter, correct colour, flip a
 * selection, undo half of it and keep going — and that is where the "GPU 오류" banners and the
 * other one-off messages show up. None of the existing gates hold a page open long enough to see
 * them. This one does, and it writes down every message the product raised, with the cycle and
 * the action that preceded it, so a banner that only appears after the 40th brush switch becomes
 * a reproducible line in a report instead of a memory.
 *
 * It is a collector, not a judge: the report lists distinct messages with counts and first
 * occurrence, plus console errors, page errors, WebGPU device loss / uncaptured errors and long
 * tasks. Reading it and deciding what is a defect is the next step, not this script's.
 *
 *   TOONSPECTRUM_SOAK_MINUTES=30            wall-clock budget (default 20)
 *   TOONSPECTRUM_SOAK_SEED=7                deterministic action sequence
 *   TOONSPECTRUM_VERIFY_ORIGIN=http://…     reuse a running server (else spawns vite preview)
 *   TOONSPECTRUM_SOAK_OUT=<dir>             report.json + screenshots
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium, type Browser, type Page } from "@playwright/test";

import {
  STUDIO_ERASER_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS,
  type StudioBrushCatalogItem,
} from "../apps/web/src/domains/creator/brush/studio-brush-catalog";

const MINUTES = Math.max(1, Number(process.env.TOONSPECTRUM_SOAK_MINUTES ?? "20") || 20);
const SEED = Number(process.env.TOONSPECTRUM_SOAK_SEED ?? "1") || 1;
const OUT = process.env.TOONSPECTRUM_SOAK_OUT?.trim() || "/tmp/studio-long-session";
const VIEWPORT = { width: 1440, height: 1100 } as const;

/** Commands driven through the F1 command search, by their Korean label. */
const FILTERS = ["가우시안 블러", "모션 블러", "노이즈 추가", "모자이크 / 픽셀화", "엠보스", "유화", "시네마 필름 그레인"];
const ADJUSTMENTS = ["명도 / 대비", "레이어 보정 · 레벨", "레이어 보정 · 톤 커브", "색상 커브"];
const TRANSFORMS = ["선택 좌우 반전", "선택 상하 반전", "레이어 복제", "아래 레이어와 결합"];

interface Event {
  readonly at: number;
  readonly cycle: number;
  readonly action: string;
  readonly kind: "alert" | "status" | "console" | "pageerror" | "rejection" | "gpu" | "longtask" | "harness";
  readonly text: string;
}

function log(message: string): void {
  console.log(`[verify-studio-long-session] ${message}`);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isEraser = (item: StudioBrushCatalogItem) =>
  STUDIO_ERASER_BRUSH_CATALOG_ITEMS.some((entry) => entry.id === item.id);

/**
 * Everything the page says, captured from inside it: banners and status lines as they appear
 * (a MutationObserver, so a toast that lives 800 ms is still recorded), console errors, page
 * errors, unhandled rejections, and WebGPU device loss / uncaptured errors — the last two by
 * wrapping requestDevice before the app can call it.
 */
async function installCollectors(page: Page, sink: Event[], state: { cycle: number; action: string }): Promise<void> {
  // Installed as SOURCE TEXT, not as a serialised function: tsx compiles this file with esbuild
  // name-keeping, and a serialised arrow function carries `__name(...)` helper calls into a page
  // that never defined them. The smoke run recorded exactly that — "ReferenceError: __name is not
  // defined" at load — as if it were the product's; a plain page load shows no such error.
  await page.addInitScript(`(() => {
    const push = (kind, text) => { (window.__soak ??= []).push([kind, text]); };
    const seen = new WeakSet();
    const scan = (root) => {
      for (const element of root.querySelectorAll('[role="alert"], [role="status"]')) {
        if (seen.has(element)) continue;
        seen.add(element);
        const text = (element.textContent ?? "").replace(/\\s+/g, " ").trim();
        if (text) push(element.getAttribute("role") === "alert" ? "alert" : "status", text);
      }
    };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) if (node instanceof Element) scan(node);
        if (mutation.type === "characterData" && mutation.target.parentElement) scan(mutation.target.parentElement);
      }
    });
    document.addEventListener("DOMContentLoaded", () => {
      scan(document);
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    });
    window.addEventListener("unhandledrejection", (event) => push("rejection", String(event.reason).slice(0, 300)));
    try {
      const observerLong = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (entry.duration >= 200) push("longtask", Math.round(entry.duration) + " ms");
      });
      observerLong.observe({ type: "longtask", buffered: false });
    } catch {}
    const gpu = navigator.gpu;
    if (gpu && gpu.requestAdapter) {
      const requestAdapter = gpu.requestAdapter.bind(gpu);
      gpu.requestAdapter = async (...args) => {
        const adapter = await requestAdapter(...args);
        if (adapter && adapter.requestDevice) {
          const requestDevice = adapter.requestDevice.bind(adapter);
          adapter.requestDevice = async (...deviceArgs) => {
            // Tag every device with the app frame that asked for it: a runtime that destroys its
            // own short-lived device also reports "lost: destroyed", so the creator is the only
            // way to tell a benign teardown from a long-lived engine losing its device mid-stroke.
            const creator = String(new Error().stack || "").split("\n").slice(2, 5).map((line) => line.trim().replace(/^at /, "")).join(" < ");
            const device = await requestDevice(...deviceArgs);
            if (device && device.lost) device.lost.then((info) => push("gpu", "device lost: " + info.reason + " — " + info.message + " [created by " + creator + "]"));
            if (device && device.addEventListener) device.addEventListener("uncapturederror", (event) => push("gpu", "uncaptured: " + ((event.error && event.error.message) || "?")));
            return device;
          };
        }
        return adapter;
      };
    }
  })();`);
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      sink.push({ at: Date.now(), cycle: state.cycle, action: state.action, kind: "console", text: `${message.type()}: ${message.text().slice(0, 300)}` });
    }
  });
  page.on("pageerror", (error) => {
    sink.push({ at: Date.now(), cycle: state.cycle, action: state.action, kind: "pageerror", text: String(error).slice(0, 300) });
  });
}

async function drainInPage(page: Page, sink: Event[], state: { cycle: number; action: string }): Promise<void> {
  const items = await page.evaluate(`(() => { const s = window.__soak ?? []; window.__soak = []; return s; })()`) as Array<[string, string]>;
  for (const [kind, text] of items) {
    sink.push({ at: Date.now(), cycle: state.cycle, action: state.action, kind: kind as Event["kind"], text });
  }
}

async function selectBrush(page: Page, item: StudioBrushCatalogItem): Promise<boolean> {
  await page.keyboard.press(isEraser(item) ? "e" : "b");
  await page.waitForTimeout(80);
  const pill = page.locator('[data-studio-draw-options="true"] [data-studio-brush-active-pill="true"]');
  await pill.waitFor({ state: "visible", timeout: 8_000 });
  await pill.click();
  const catalog = page.locator('[data-studio-brush-catalog-session="true"]');
  await catalog.waitFor({ state: "visible", timeout: 8_000 });
  await catalog.getByRole("tab", { name: "전체", exact: true }).click();
  await catalog.getByRole("searchbox").fill(item.name);
  const option = catalog.getByRole("button", { name: /( 선택$|지움\. )/ }).filter({ hasText: item.name.slice(0, 6) }).first();
  for (let batch = 0; batch < 24 && await option.count() === 0; batch += 1) {
    const sentinel = catalog.locator('[data-studio-brush-progressive-sentinel="true"]');
    if (await sentinel.count() === 0) break;
    await catalog.locator('[data-studio-brush-catalog-scrollport="true"]').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.waitForTimeout(120);
  }
  if (await option.count() === 0) {
    await page.keyboard.press("Escape");
    return false;
  }
  await option.scrollIntoViewIfNeeded();
  await option.click({ force: true });
  await catalog.waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
  await page.mouse.move(4, 4);
  return true;
}

async function stroke(page: Page, random: () => number): Promise<void> {
  const box = await page.locator(".konvajs-content").first().boundingBox();
  if (!box) return;
  const x0 = box.x + box.width * (0.2 + random() * 0.4);
  const y0 = box.y + box.height * (0.2 + random() * 0.4);
  const length = 12 + Math.floor(random() * 40);
  const shape = random();
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let step = 1; step <= length; step += 1) {
    const t = step / length;
    const x = shape < 0.4 ? x0 + step * 8 : x0 + Math.cos(t * Math.PI * 2) * 90;
    const y = shape < 0.4 ? y0 + Math.sin(step / 4) * 30 : y0 + Math.sin(t * Math.PI * 2) * 90;
    await page.mouse.move(x, y, { steps: 2 });
  }
  await page.mouse.up();
  await page.waitForTimeout(60 + Math.floor(random() * 300));
}

/** Run a studio command through F1 search; a dialog that opens is applied or dismissed. */
/** Close whatever modal a previous action left up; a soak must survive its own mistakes. */
async function clearModals(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const overlay = page.locator("div.fixed.inset-0").filter({ visible: true });
    if (await overlay.count() === 0) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
}

async function runCommand(page: Page, label: string): Promise<"ran" | "not-found" | "dialog-dismissed"> {
  await clearModals(page);
  await page.keyboard.press("F1");
  const input = page.getByPlaceholder(/기능 이름/);
  if (!(await input.waitFor({ state: "visible", timeout: 4_000 }).then(() => true).catch(() => false))) {
    await page.keyboard.press("Escape");
    return "not-found";
  }
  await input.fill(label);
  await page.waitForTimeout(250);
  const option = page.getByRole("option").filter({ hasText: label }).first();
  if (await option.count() === 0) {
    await page.keyboard.press("Escape");
    return "not-found";
  }
  await option.click();
  // The filter dialog is a lazy chunk: on its first open it can take well over the 500 ms a
  // fixed pause allowed, which read as "no dialog" and dismissed every filter in the smoke run.
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: /적용$/ }) }).last();
  const opened = await dialog.waitFor({ state: "visible", timeout: 6_000 }).then(() => true).catch(() => false);
  if (!opened) return "ran";
  // "적용" / "선택 안에 적용" / "선택 밖에 적용" — never the cancel button beside it.
  const apply = dialog.getByRole("button", { name: /적용$/ }).first();
  if (await apply.isEnabled().catch(() => false)) {
    await apply.click({ force: true }).catch(() => {});
    await dialog.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(300);
    return "ran";
  }
  await page.keyboard.press("Escape");
  return "dialog-dismissed";
}

async function spawnPreview(): Promise<{ origin: string; child: ChildProcess | null }> {
  const external = process.env.TOONSPECTRUM_VERIFY_ORIGIN?.trim();
  if (external) return { origin: external, child: null };
  const port = 4600 + (Date.now() % 300);
  const child = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { stdio: "ignore" });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return { origin, child };
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill();
  throw new Error("vite preview never came up");
}

const random = mulberry32(SEED);
const brushes = STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.filter((item) => !isEraser(item));
const erasers = STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.filter(isEraser);
const { origin, child } = await spawnPreview();
mkdirSync(OUT, { recursive: true });
log(`origin ${origin} · ${MINUTES} min · seed ${SEED} · ${brushes.length} brushes`);

const browser: Browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newContext({ viewport: { ...VIEWPORT } }).then((context) => context.newPage());
const events: Event[] = [];
const state = { cycle: 0, action: "load" };
await installCollectors(page, events, state);
await page.goto(new URL("/studio", origin).toString(), { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForSelector('[data-studio-editor="true"]', { timeout: 90_000 });
await page.waitForTimeout(2_500);
await drainInPage(page, events, state);

const deadline = Date.now() + MINUTES * 60_000;
const actions = { strokes: 0, brushSwitches: 0, filters: 0, adjustments: 0, transforms: 0, undos: 0, commandMisses: [] as string[] };
const screenshots = new Map<string, string>();
const snapshotNew = async () => {
  for (const event of events.slice(-8)) {
    if (event.kind === "longtask" || event.kind === "status") continue;
    const key = `${event.kind}:${event.text.slice(0, 80)}`;
    if (screenshots.has(key)) continue;
    const path = join(OUT, `event-${screenshots.size + 1}.png`);
    await page.screenshot({ path }).catch(() => {});
    screenshots.set(key, path);
  }
};

while (Date.now() < deadline) {
  state.cycle += 1;
  const cycle = state.cycle;
  const brush = random() < 0.12 && erasers.length > 0
    ? erasers[Math.floor(random() * erasers.length)]!
    : brushes[Math.floor(random() * brushes.length)]!;
  await clearModals(page);
  state.action = `select ${brush.id}`;
  const selected = await selectBrush(page, brush).catch((error: unknown) => {
    events.push({ at: Date.now(), cycle, action: state.action, kind: "harness", text: String(error).split("\n")[0]!.slice(0, 200) });
    return false;
  });
  if (selected) actions.brushSwitches += 1;
  else actions.commandMisses.push(`brush:${brush.id}`);
  // The refused-stroke recovery rail has a DOM hook of its own; counting it per switch is the
  // first measurement of how often that rail actually fires across a long session.
  const rejectedNotices = await page.locator("[data-studio-rejected-stroke-notice]").count();
  if (rejectedNotices > 0) {
    events.push({ at: Date.now(), cycle, action: state.action, kind: "alert", text: `rejected-stroke-notice ×${rejectedNotices} after switching to ${brush.id}` });
  }
  const strokes = 1 + Math.floor(random() * 3);
  for (let index = 0; index < strokes; index += 1) {
    state.action = `stroke ${brush.id}`;
    await stroke(page, random).catch((error: unknown) => {
      events.push({ at: Date.now(), cycle, action: state.action, kind: "harness", text: String(error).split("\n")[0]!.slice(0, 200) });
    });
    actions.strokes += 1;
  }
  if (cycle % 3 === 0) {
    const label = FILTERS[Math.floor(random() * FILTERS.length)]!;
    state.action = `filter ${label}`;
    const result = await runCommand(page, label).catch((error: unknown) => {
      events.push({ at: Date.now(), cycle, action: state.action, kind: "harness", text: String(error).split("\n")[0]!.slice(0, 200) });
      return "not-found" as const;
    });
    if (result === "ran") actions.filters += 1; else actions.commandMisses.push(`${result}:${label}`);
  }
  if (cycle % 4 === 0) {
    const label = ADJUSTMENTS[Math.floor(random() * ADJUSTMENTS.length)]!;
    state.action = `adjust ${label}`;
    const result = await runCommand(page, label).catch((error: unknown) => {
      events.push({ at: Date.now(), cycle, action: state.action, kind: "harness", text: String(error).split("\n")[0]!.slice(0, 200) });
      return "not-found" as const;
    });
    if (result === "ran") actions.adjustments += 1; else actions.commandMisses.push(`${result}:${label}`);
  }
  if (cycle % 5 === 0) {
    await page.keyboard.press("Meta+a").catch(() => {});
    await page.waitForTimeout(150);
    const label = TRANSFORMS[Math.floor(random() * TRANSFORMS.length)]!;
    state.action = `transform ${label}`;
    const result = await runCommand(page, label).catch((error: unknown) => {
      events.push({ at: Date.now(), cycle, action: state.action, kind: "harness", text: String(error).split("\n")[0]!.slice(0, 200) });
      return "not-found" as const;
    });
    if (result === "ran") actions.transforms += 1; else actions.commandMisses.push(`${result}:${label}`);
    await page.keyboard.press("Escape").catch(() => {});
  }
  if (random() < 0.35) {
    state.action = "undo/redo";
    const count = 1 + Math.floor(random() * 3);
    for (let index = 0; index < count; index += 1) { await page.keyboard.press("Meta+z"); await page.waitForTimeout(90); }
    if (random() < 0.5) { await page.keyboard.press("Meta+Shift+z"); await page.waitForTimeout(90); }
    actions.undos += count;
  }
  await drainInPage(page, events, state);
  await snapshotNew();
  if (cycle % 10 === 0) {
    const alerts = events.filter((event) => event.kind === "alert").length;
    const gpu = events.filter((event) => event.kind === "gpu").length;
    log(`cycle ${cycle} · ${actions.strokes} strokes · ${actions.brushSwitches} switches · ${alerts} alerts · ${gpu} gpu · ${Math.round((deadline - Date.now()) / 60_000)} min left`);
  }
}

await drainInPage(page, events, state);
await browser.close();
child?.kill();

const distinct = new Map<string, { kind: string; text: string; count: number; firstCycle: number; firstAction: string }>();
for (const event of events) {
  if (event.kind === "longtask") continue;
  const key = `${event.kind}:${event.text.slice(0, 120)}`;
  const entry = distinct.get(key);
  if (entry) entry.count += 1;
  else distinct.set(key, { kind: event.kind, text: event.text, count: 1, firstCycle: event.cycle, firstAction: event.action });
}
const longTasks = events.filter((event) => event.kind === "longtask").map((event) => Number.parseInt(event.text, 10));
const report = {
  origin, seed: SEED, minutes: MINUTES, cycles: state.cycle, actions,
  longTasks: { count: longTasks.length, worstMs: Math.max(0, ...longTasks) },
  distinct: [...distinct.values()].sort((left, right) => right.count - left.count),
  screenshots: Object.fromEntries(screenshots),
};
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
log(`${state.cycle} cycles · ${actions.strokes} strokes · ${actions.brushSwitches} brush switches · ${actions.filters} filters · ${actions.adjustments} adjustments · ${actions.transforms} transforms · ${actions.undos} undos`);
log(`${report.distinct.length} distinct messages · ${longTasks.length} long tasks (worst ${report.longTasks.worstMs} ms) · report ${join(OUT, "report.json")}`);
for (const entry of report.distinct.slice(0, 40)) log(`  ${entry.kind} ×${entry.count} (first: cycle ${entry.firstCycle}, ${entry.firstAction}) — ${entry.text.slice(0, 140)}`);
if (actions.commandMisses.length > 0) log(`  harness could not drive: ${[...new Set(actions.commandMisses)].join(", ")}`);
