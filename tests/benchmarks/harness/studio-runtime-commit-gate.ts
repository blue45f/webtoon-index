/**
 * Runtime gate for the Studio "hot path de-React" contract.
 *
 * The repo already pins this contract with source-text assertions
 * (`*-boundary.test.ts`). Those check that a specific mechanism is still
 * written the way it was designed; they cannot see a gesture that breaks the
 * contract some other way. The canvas diagnostic proved the gap: a hand-tool
 * pan re-rendered the whole editor once per frame — 42 react-dom commits for 40
 * pointer moves — while every source assertion passed.
 *
 * This gate closes it by measuring the shipped production build in a real
 * browser with trusted input and failing when a gesture exceeds the ceilings in
 * `apps/web/src/domains/creator/studio-hot-path-commit-budget.ts`.
 *
 * Two independent signals are counted per gesture:
 *   - product render counters (`studio:editor`, `studio:canvas`) emitted by
 *     `recordStudioHotPathRender`, armed by installing the sink before any app
 *     script runs. This is the contract's real subject: page renders.
 *   - react-dom commits, via a stub `__REACT_DEVTOOLS_GLOBAL_HOOK__` (react-dom
 *     calls `onCommitFiberRoot` on production builds too).
 *
 * Both are proven live before any budget is judged: a control gesture must move
 * them, and an idle window must leave them at zero. If instrumentation cannot
 * be proven, the gate fails rather than reporting a flattering zero.
 *
 * Run after `pnpm exec vite build`:
 *   pnpm exec tsx tests/benchmarks/harness/studio-runtime-commit-gate.ts
 *
 * Env:
 *   TOONSPECTRUM_VERIFY_ORIGIN  reuse an already-running preview origin
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { arch, cpus, platform } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { chromium, type Browser, type Page } from "playwright";

import {
  STUDIO_HOT_PATH_COMMIT_BUDGETS,
  evaluateStudioHotPathBudget,
  type StudioHotPathBudgetViolation,
  type StudioHotPathGestureSample,
} from "../../../apps/web/src/domains/creator/studio-hot-path-commit-budget";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;
const RESULTS_DIR = join(REPO_ROOT, "tests", "benchmarks", "results");
const RESULTS_FILE = "studio-runtime-commit-gate.json";

const VIEWPORT = { width: 1440, height: 1100 } as const;

function log(message: string): void {
  console.log(`[studio-runtime-commit-gate] ${message}`);
}

interface HotPathMark {
  readonly commits: number;
  readonly editor: number;
  readonly canvas: number;
}

interface HotPathBridge {
  readonly reactRenderersInjected: number;
  mark: () => HotPathMark;
  measure: (mark: HotPathMark) => { reactCommits: number; editorRenders: number; canvasRenders: number };
  zoomLabel: () => string | null;
  scrollOffset: () => { left: number; top: number } | null;
}

declare global {
  /** Injected page bridge; only exists inside the driven browser context. */
  var __hotPathGate: HotPathBridge | undefined;
}

/**
 * Shipped as source text, not a serialized closure: the tsx/esbuild transform
 * rewrites nested named functions with `__name(...)` helpers that do not exist
 * in a fresh page realm.
 */
const PAGE_INSTRUMENTATION_SOURCE = String.raw`
(() => {
  const state = { reactCommits: 0, reactRenderersInjected: 0 };

  // Arm the product's own render counters. Their sink must exist before any app
  // script runs; with no sink the product recorder is a no-op.
  const counters = Object.create(null);
  Object.defineProperty(globalThis, "__studioHotPathRenderCounters", {
    value: counters, configurable: true, writable: true,
  });

  const hook = {
    renderers: new Map(),
    supportsFiber: true,
    isDisabled: false,
    checkDCE: function () {},
    inject: function (renderer) {
      state.reactRenderersInjected += 1;
      hook.renderers.set(state.reactRenderersInjected, renderer);
      return state.reactRenderersInjected;
    },
    onCommitFiberRoot: function () { state.reactCommits += 1; },
    onPostCommitFiberRoot: function () {},
    onCommitFiberUnmount: function () {},
    setStrictMode: function () {},
    getFiberRoots: function () { return new Set(); },
    getInternalModuleRanges: function () { return []; },
    registerInternalModuleStart: function () {},
    registerInternalModuleStop: function () {},
    emit: function () {},
    on: function () {},
    off: function () {},
    sub: function () { return function () {}; },
  };
  Object.defineProperty(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
    value: hook, configurable: true, writable: true,
  });

  function scrollHost() {
    const root = document.querySelector(".konvajs-content");
    let node = root;
    while (node) {
      if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) return node;
      node = node.parentElement;
    }
    return null;
  }

  globalThis.__hotPathGate = {
    get reactRenderersInjected() { return state.reactRenderersInjected; },
    mark: function () {
      return {
        commits: state.reactCommits,
        editor: counters["studio:editor"] || 0,
        canvas: counters["studio:canvas"] || 0,
      };
    },
    measure: function (mark) {
      return {
        reactCommits: state.reactCommits - mark.commits,
        editorRenders: (counters["studio:editor"] || 0) - mark.editor,
        canvasRenders: (counters["studio:canvas"] || 0) - mark.canvas,
      };
    },
    zoomLabel: function () {
      const nodes = document.querySelectorAll("button, span, div");
      for (let i = 0; i < nodes.length; i += 1) {
        const text = (nodes[i].textContent || "").trim();
        if (/^\d{2,4}%$/.test(text)) return text;
      }
      return null;
    },
    scrollOffset: function () {
      const host = scrollHost();
      return host ? { left: host.scrollLeft, top: host.scrollTop } : null;
    },
  };
})();
`;

const STORAGE_PRIMING_SOURCE = String.raw`
(() => {
  try {
    localStorage.setItem("toonspectrum-studio-quick-start-dismissed", "1");
    localStorage.setItem("toonspectrum-studio-mobile-hint-dismissed", "1");
    const keys = Object.keys(localStorage);
    for (let i = 0; i < keys.length; i += 1) {
      if (keys[i].indexOf("toonspectrum-studio-autosave") === 0) localStorage.removeItem(keys[i]);
    }
  } catch (error) {
    // Private mode: the studio still boots, just without the primed flags.
  }
})();
`;

interface GestureReading extends StudioHotPathGestureSample {
  readonly evidence: Record<string, unknown>;
}

async function measure(
  page: Page,
  gesture: string,
  run: () => Promise<Record<string, unknown>>,
): Promise<GestureReading> {
  const mark = await page.evaluate(() => globalThis.__hotPathGate!.mark());
  const evidence = await run();
  const reading = await page.evaluate(
    (m) => globalThis.__hotPathGate!.measure(m),
    mark,
  );
  return { gesture, ...reading, evidence };
}

/** Move focus off any text input so the studio's key handlers are reachable. */
async function blurActiveInput(page: Page): Promise<void> {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
}

async function stageBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(".konvajs-content").first().boundingBox();
  if (!box) throw new Error("konva stage has no layout box");
  return box;
}

/** A point on the stage that is also inside the viewport. */
function visibleStagePoint(
  box: { x: number; y: number; width: number; height: number },
  fx: number,
  fy: number,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(box.x + box.width * fx, 8), VIEWPORT.width - 8),
    y: Math.min(Math.max(box.y + box.height * fy, 8), VIEWPORT.height - 8),
  };
}

/** Same boot sequence as the canvas-interaction harness so both read one UI. */
async function prepareStudio(page: Page, studioUrl: string): Promise<void> {
  page.setDefaultTimeout(15_000);
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  // esbuild's __name helper is absent on some preview chunks.
  await page.evaluate("globalThis.__name ??= (target) => target");
  await page.locator(".konvajs-content").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.keyboard.press("b");
  const toolbar = page.getByRole("toolbar", { name: /그리기 옵션/u });
  await toolbar.waitFor({ state: "visible", timeout: 20_000 });
  const pen = toolbar.getByRole("button", { name: "펜", exact: true });
  if ((await pen.getAttribute("aria-pressed")) !== "true") await pen.click();
  await page.waitForTimeout(400);
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        reject(new Error("could not reserve a preview port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForServer(origin: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(origin, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // preview is still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`vite preview did not become ready at ${origin}`);
}

async function main(): Promise<void> {
  const started = performance.now();
  const externalOrigin = process.env.TOONSPECTRUM_VERIFY_ORIGIN?.trim();
  const port = externalOrigin ? null : await findFreePort();
  const origin = externalOrigin
    ? `${externalOrigin.replace(/\/+$/u, "")}/`
    : `http://127.0.0.1:${port}/`;
  const studioUrl = `${origin}studio`;
  const server: ChildProcess | null = externalOrigin
    ? null
    : spawn(
        process.execPath,
        [
          join(REPO_ROOT, "node_modules", "vite", "bin", "vite.js"),
          "preview",
          "--port",
          String(port),
          "--strictPort",
          "--host",
          "127.0.0.1",
        ],
        { cwd: REPO_ROOT, stdio: ["ignore", "ignore", "ignore"] },
      );

  let browser: Browser | null = null;
  const readings: GestureReading[] = [];
  let validity: Record<string, unknown> = { note: "not reached" };
  let failure: string | null = null;

  try {
    await waitForServer(origin);
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({ viewport: { ...VIEWPORT }, deviceScaleFactor: 1 });
    await context.addInitScript({ content: STORAGE_PRIMING_SOURCE });
    await context.addInitScript({ content: PAGE_INSTRUMENTATION_SOURCE });
    const page = await context.newPage();
    await prepareStudio(page, studioUrl);

    /* ---- instrumentation validity ------------------------------------- */
    const renderers = await page.evaluate(() => globalThis.__hotPathGate!.reactRenderersInjected);
    const control = await measure(page, "control:brush-size-slider", async () => {
      const slider = page
        .locator('[data-studio-core-draw-control="size"] input[type="range"]')
        .first();
      await slider.fill("18");
      await page.waitForTimeout(240);
      await slider.fill("6");
      await page.waitForTimeout(200);
      await blurActiveInput(page);
      return { action: "brush size slider 6 -> 18 -> 6" };
    });
    await page.mouse.move(6, 6);
    await page.waitForTimeout(300);
    const idle = await measure(page, "idle", async () => {
      await page.waitForTimeout(2_000);
      return { observedMs: 2_000 };
    });
    readings.push(idle);

    const countersLive = renderers > 0
      && control.reactCommits > 0
      && control.editorRenders > 0;
    validity = {
      reactRenderersInjected: renderers,
      controlGesture: {
        action: control.evidence.action,
        reactCommits: control.reactCommits,
        editorRenders: control.editorRenders,
        canvasRenders: control.canvasRenders,
      },
      countersProvenLive: countersLive,
      note: countersLive
        ? "react-dom commit counter and product render counters both moved on a control gesture"
        : "instrumentation did NOT move on a control gesture — every zero below is unmeasured",
    };
    log(
      `counters live=${String(countersLive)} (renderers=${renderers}, control commits=${control.reactCommits}, ` +
        `control editor renders=${control.editorRenders}) · idle editor renders=${idle.editorRenders}`,
    );
    if (!countersLive) {
      failure = "instrumentation could not be proven live; refusing to report budgets";
    }

    /* ---- zoom: gesture window and settle window ------------------------ */
    if (!failure) {
      const box = await stageBox(page);
      const center = visibleStagePoint(box, 0.5, 0.4);
      await page.mouse.move(center.x, center.y);
      await page.waitForTimeout(150);

      const zoomBefore = await page.evaluate(() => globalThis.__hotPathGate!.zoomLabel());
      readings.push(
        await measure(page, "zoom:wheel-gesture", async () => {
          for (let step = 0; step < 20; step += 1) await page.mouse.wheel(0, -120);
          return { notches: 20, zoomBefore };
        }),
      );
      readings.push(
        await measure(page, "zoom:wheel-settle", async () => {
          // The settle commit is scheduled ~170ms after the last notch; the
          // window has to outlast the re-raster it triggers.
          await page.waitForTimeout(12_000);
          const zoomAfter = await page.evaluate(() => globalThis.__hotPathGate!.zoomLabel());
          return { zoomAfter, zoomChanged: zoomAfter !== zoomBefore };
        }),
      );

      await blurActiveInput(page);
      await page.keyboard.press("Shift+0");
      await page.waitForTimeout(1_500);
    }

    /* ---- pan ----------------------------------------------------------- */
    if (!failure) {
      const hand = page.locator('[data-studio-rail-tool-id="hand"]').first();
      await hand.click();
      await page.waitForTimeout(200);
      const handActive = await hand.getAttribute("aria-pressed");
      const box = await stageBox(page);
      const start = visibleStagePoint(box, 0.35, 0.45);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      const scrollBefore = await page.evaluate(() => globalThis.__hotPathGate!.scrollOffset());
      const pan = await measure(page, "pan:hand-drag", async () => {
        const moves = 40;
        // The drag traces a full circle, so its start and end scroll offsets are
        // the same. Validity has to be judged on the largest excursion during
        // the drag or a pan that scrolled hundreds of pixels would look inert.
        let maxExcursion = 0;
        for (let index = 1; index <= moves; index += 1) {
          const t = index / moves;
          await page.mouse.move(
            start.x + Math.sin(t * Math.PI * 2) * 160,
            start.y + Math.cos(t * Math.PI * 2) * 90,
          );
          if (index % 5 === 0 && scrollBefore) {
            const sample = await page.evaluate(() => globalThis.__hotPathGate!.scrollOffset());
            if (sample) {
              maxExcursion = Math.max(
                maxExcursion,
                Math.abs(sample.left - scrollBefore.left),
                Math.abs(sample.top - scrollBefore.top),
              );
            }
          }
        }
        const scrollAfter = await page.evaluate(() => globalThis.__hotPathGate!.scrollOffset());
        return {
          pointerMoves: moves,
          handToolActive: handActive,
          scrollBefore,
          scrollAfter,
          maxScrollExcursionPx: maxExcursion,
          // A pan that never scrolled would report a flattering zero; the gate
          // must know the gesture actually moved the view.
          scrolled: maxExcursion > 8,
        };
      });
      await page.mouse.up();
      readings.push(pan);
      if (handActive !== "true") failure = "hand tool did not activate; pan reading is invalid";
      else if (pan.evidence.scrolled !== true) failure = "pan gesture never scrolled the view; reading is invalid";
    }

    /* ---- stroke -------------------------------------------------------- */
    if (!failure) {
      await blurActiveInput(page);
      await page.keyboard.press("b");
      await page.waitForTimeout(250);
      const box = await stageBox(page);
      const start = visibleStagePoint(box, 0.3, 0.35);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.waitForTimeout(60);
      readings.push(
        await measure(page, "stroke:pen-paced", async () => {
          const moves = 60;
          for (let index = 1; index <= moves; index += 1) {
            await page.mouse.move(start.x + index * 3, start.y + Math.sin(index / 4) * 40);
            await page.waitForTimeout(8);
          }
          return { pointerMoves: moves };
        }),
      );
      await page.mouse.up();
      await page.waitForTimeout(400);
    }

    await context.close().catch(() => undefined);
  } catch (error) {
    failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (server) {
      server.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 700));
      server.kill("SIGKILL");
    }
  }

  const violations: StudioHotPathBudgetViolation[] = [];
  for (const reading of readings) {
    if (reading.gesture.startsWith("control:")) continue;
    violations.push(...evaluateStudioHotPathBudget(reading));
  }

  const report = {
    gate: "tests/benchmarks/harness/studio-runtime-commit-gate.ts",
    contract: "apps/web/src/domains/creator/studio-hot-path-commit-budget.ts",
    generatedAt: new Date().toISOString(),
    route: studioUrl,
    build: "production dist/ served by vite preview (pnpm exec vite build)",
    host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? "unknown" },
    method: {
      pageRenders:
        "product-emitted counters (recordStudioHotPathRender) armed by installing " +
        "globalThis.__studioHotPathRenderCounters before any app script runs",
      reactCommits:
        "stub __REACT_DEVTOOLS_GLOBAL_HOOK__ installed before app scripts; react-dom " +
        "calls onCommitFiberRoot on it in production builds too",
      validity:
        "a control gesture must move both counters and a 2s idle window must leave them at zero",
    },
    instrumentationValidity: validity,
    budgets: STUDIO_HOT_PATH_COMMIT_BUDGETS,
    readings,
    violations,
    failure,
    passed: !failure && violations.length === 0,
    runtimeMs: Number((performance.now() - started).toFixed(1)),
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(join(RESULTS_DIR, RESULTS_FILE), `${JSON.stringify(report, null, 2)}\n`);

  for (const reading of readings) {
    log(
      `${reading.gesture}: editor=${reading.editorRenders} canvas=${reading.canvasRenders} ` +
        `commits=${reading.reactCommits}`,
    );
  }
  if (failure) log(`FAILED: ${failure}`);
  for (const violation of violations) {
    log(
      `BUDGET EXCEEDED ${violation.gesture}.${violation.metric}: ` +
        `${violation.observed} > ${violation.budget}`,
    );
  }
  log(`written: ${join(RESULTS_DIR, RESULTS_FILE)}`);
  if (!report.passed) process.exitCode = 1;
  else log("all hot-path budgets held");
}

await main();
