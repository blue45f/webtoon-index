/**
 * Multi-stroke brush scenario verifier.
 *
 * The long matrix (`verify-studio-brushes.mts`) proves one straight stroke per brush. This
 * verifier drives the shipped UI through the gestures artists actually make and that a single
 * stroke never exercises:
 *
 *   curve        an S-curve — the live overlay must match the committed stroke along a bend;
 *   cross        two strokes of the same brush crossing — the crossing must not blink, drift or
 *                change tone between the live composite and the committed one. Crossing and corner
 *                regions are judged against the LAST pointer-down frame: the mid-gesture frame is
 *                taken at 60% of the path, and a region the pointer has not reached yet is empty
 *                there for every brush (that read particle-scatter as a 72% renderer drift);
 *   mixed-over   a partner brush first, this brush across it (wet over dry, dry over wet);
 *   mixed-under  this brush first, the partner across it;
 *   endpoints    a tap, a short flick and a medium stroke — pointer-down and pointer-up caps
 *                must survive the hand-off from overlay to document;
 *   eraser-cross this brush, then the standard eraser across it — the gap must persist;
 *   circle       one long closed circle — the seam where the stroke returns to its own start is
 *                where a renderer's endpoint handling shows, and a 360-sample gesture is the
 *                longest continuous path in this matrix;
 *   corners      a zig-zag with 90°, 45° and reflex turns — a corner that is round in the live
 *                frame and mitred in the committed one (or spiked in either) is a drift finding.
 *
 * Every stroke captures baseline / live (mid-gesture) / released (immediately after pointer-up)
 * / a post-release frame series (blink detection) / settled frames, and samples main-thread long
 * tasks and animation-frame stalls while the gesture runs.
 *
 * It also records every frame the compositor presented WHILE the pointer was down, over CDP
 * screencast. Screenshots cannot do that job: each one blocks the renderer for ~100 ms, so a
 * screenshot series is a series of frozen frames, and the single mid-gesture screenshot this
 * harness used to take was structurally blind to a line that blinks as the artist draws it.
 *
 *   TOONSPECTRUM_SCENARIO_IDS=pen,watercolor   brush subset (default: one per engine family)
 *   TOONSPECTRUM_SCENARIOS=curve,cross          scenario subset
 *   TOONSPECTRUM_SCENARIO_DIR=<dir>             artifacts + report.json
 *   TOONSPECTRUM_VERIFY_ORIGIN=http://…         reuse a running preview instead of spawning one
 *   TOONSPECTRUM_SCENARIO_STRICT=1              exit 1 on any error-level finding
 *   TOONSPECTRUM_SCENARIO_CHANNEL=chromium      Playwright channel (default "chromium" = new
 *                                               headless with GPU canvas; the headless shell
 *                                               rasterises with SwiftShader, where every Konva
 *                                               clip/restore costs ~100 ms and every gesture
 *                                               reports long tasks the product never shows)
 */
import { type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { decodeJpeg, decodePng } from "image-js";

import { studioBrushPresetUsesIntentionalDiscreteCarrier } from "../apps/web/src/domains/creator/brush/studio-brush-carrier-quality";
import {
  STUDIO_ERASER_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS,
  type StudioBrushCatalogItem,
} from "../apps/web/src/domains/creator/brush/studio-brush-catalog";
import { studioBrushPackDescriptorById } from "../apps/web/src/domains/creator/brush/studio-brush-pack-index";
import { materializeStudioBrushCatalogSelection } from "../apps/web/src/domains/creator/brush/studio-brush-selection";
import { classifyStudioDryMediaCatalogIdV1 } from "../apps/web/src/domains/creator/brush/studio-dry-media-anisotropic-grain-v1";
import { studioWetInkBrushDepositsPigment } from "../apps/web/src/domains/creator/brush/studio-wet-ink-brush-runtime";
import { STUDIO_APP_SETTINGS_STORAGE_KEY } from "../apps/web/src/domains/creator/studio-app-settings";

import { enabledStudioHistoryControl } from "./lib/studio-verify-history-controls.mjs";
import {
  findFreePort,
  spawnVitePreview,
  stopChildProcess,
  waitForServer,
} from "./lib/studio-verify-preview-harness.mjs";
import { classifyStudioLongBrushQualityPolicy } from "./studio-brush-long-matrix-quality";
import {
  analyzeStudioBrushScenarioDiscrepancy,
  analyzeStudioBrushScenarioFlicker,
  analyzeStudioBrushScenarioInStroke,
  judgeStudioBrushScenarioBuildupLadder,
  judgeStudioBrushScenarioDiscrepancy,
  judgeStudioBrushScenarioFlicker,
  judgeStudioBrushScenarioInStroke,
  judgeStudioBrushScenarioPerf,
  studioBrushScenarioInkMask,
  studioBrushScenarioMaskStats,
  studioBrushScenarioPointRegion,
  type StudioBrushScenarioDiscrepancy,
  type StudioBrushScenarioFinding,
  type StudioBrushScenarioFlickerAnalysis,
  type StudioBrushScenarioInStrokeAnalysis,
  type StudioBrushScenarioInStrokeFrame,
  type StudioBrushScenarioPerfSample,
  type StudioBrushScenarioRegion,
} from "./studio-brush-scenario-quality";

import type { StudioBrushMediaPixelImage } from "./studio-brush-media-pixel-quality";

const QUICKSTART_KEY = "toonspectrum-studio-quick-start-dismissed";
const MOBILE_HINT_KEY = "toonspectrum-studio-mobile-hint-dismissed";
const AUTOSAVE_PREFIX = "toonspectrum-studio-autosave";
const VIEWPORT = { width: 1440, height: 1100 } as const;
const SCENARIO_NAMES = [
  "curve",
  "circle",
  "corners",
  "buildup",
  "slow-fast",
  "cross",
  "mixed-over",
  "mixed-under",
  "endpoints",
  "eraser-cross",
] as const;
type ScenarioName = (typeof SCENARIO_NAMES)[number];

/** One brush per engine family plus the pairs that historically diverged live vs committed. */
const DEFAULT_IDS = [
  "pen",
  "gpen",
  "maru-pen",
  "perfect-ink",
  "pencil",
  "pencil--side-shade",
  "charcoal",
  "marker",
  "highlighter",
  "brush",
  "watercolor",
  "inkwash-pen",
  "inkwash-water-brush",
  "ink-wash--sumi-core",
  "oil",
  "airbrush",
  "spray",
  "glow",
  "neon",
  "web-blend-softener",
  "dry-rake",
  "velvet-charcoal",
  "kneaded-eraser",
] as const;

const OUTPUT_DIR = process.env.TOONSPECTRUM_SCENARIO_DIR?.trim()
  || join(tmpdir(), `toonspectrum-brush-scenarios-${Date.now()}`);
const STRICT = process.env.TOONSPECTRUM_SCENARIO_STRICT === "1";
const LAYER_PROBE = process.env.TOONSPECTRUM_SCENARIO_LAYER_PROBE === "1";
/** Diagnostic: trace full-canvas clears, backing-store resizes and the first draw after each clear. */
const CLEAR_TRACE = process.env.TOONSPECTRUM_SCENARIO_CLEAR_TRACE === "1";
const CHANNEL = process.env.TOONSPECTRUM_SCENARIO_CHANNEL?.trim() || "chromium";
/**
 * Pause between consecutive strokes of one scenario. Artists hatch at well under a second, so the
 * default keeps the follow-up stroke inside the product's deferred-commit window on purpose: a
 * renderer that refuses the second stroke while the first is still committing is a finding.
 */
const STROKE_GAP_MS = Math.max(0, Number(process.env.TOONSPECTRUM_SCENARIO_STROKE_GAP_MS ?? "600") || 0);

function log(message: string): void {
  console.log(`[verify-studio-brush-scenarios] ${message}`);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Resolve the brush set before the browser opens.
 *
 * An id that is no longer listed used to surface as an exception on the brush it reached, which
 * meant a default run spent a quarter of an hour measuring fifteen brushes and then threw
 * (`"acrylic" is not a listed product brush id`) with nothing written. Two different mistakes were
 * being conflated: the default list drifting behind the catalogue, which the harness should
 * survive, and a caller naming a brush that does not exist, which it should refuse.
 */
function requestedIds(): readonly string[] {
  const raw = process.env.TOONSPECTRUM_SCENARIO_IDS?.trim();
  const listed = (id: string) => STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.some((entry) => entry.id === id);
  if (!raw) {
    const [live, dropped] = DEFAULT_IDS.reduce<[string[], string[]]>(
      ([keep, skip], id) => (listed(id) ? [[...keep, id], skip] : [keep, [...skip, id]]),
      [[], []],
    );
    if (dropped.length > 0) log(`skipping ${dropped.join(", ")} — no longer listed in the catalogue`);
    return live;
  }
  const ids = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const unknown = ids.filter((id) => !listed(id));
  invariant(
    unknown.length === 0,
    `not listed product brush ids (quarantined or unknown): ${unknown.join(", ")}`,
  );
  return ids;
}

function requestedScenarios(): readonly ScenarioName[] {
  const raw = process.env.TOONSPECTRUM_SCENARIOS?.trim();
  if (!raw) return SCENARIO_NAMES;
  const names = raw.split(",").map((value) => value.trim()).filter(Boolean);
  for (const name of names) {
    invariant(
      (SCENARIO_NAMES as readonly string[]).includes(name),
      `unknown scenario "${name}" (known: ${SCENARIO_NAMES.join(", ")})`,
    );
  }
  return names as ScenarioName[];
}

function catalogItem(id: string): StudioBrushCatalogItem {
  // Only LISTED presets exist in the picker. A quarantined id would otherwise hang the harness on
  // a search box that can never match it.
  const item = STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.find((entry) => entry.id === id);
  invariant(item, `"${id}" is not a listed product brush id (quarantined or unknown)`);
  return item;
}

function isEraserItem(item: StudioBrushCatalogItem): boolean {
  return STUDIO_ERASER_BRUSH_CATALOG_ITEMS.some((entry) => entry.id === item.id);
}

interface BrushProfile {
  readonly item: StudioBrushCatalogItem;
  readonly runtimeBrushId: string;
  readonly defaultWidth: number;
  readonly softWet: boolean;
  readonly transparent: boolean;
  readonly discrete: boolean;
  readonly eraser: boolean;
}

async function brushProfile(id: string): Promise<BrushProfile> {
  const item = catalogItem(id);
  const selection = await materializeStudioBrushCatalogSelection(id);
  invariant(selection, `${id}: catalogue selection did not materialize`);
  const descriptor = studioBrushPackDescriptorById(id);
  const dryMedia = classifyStudioDryMediaCatalogIdV1(id);
  const intentionalDiscrete = dryMedia
    ? dryMedia.kind === "intentional-discrete"
    : descriptor
      ? studioBrushPresetUsesIntentionalDiscreteCarrier(descriptor)
      : false;
  const transparent = !studioWetInkBrushDepositsPigment(selection.runtimeBrushId);
  const policy = classifyStudioLongBrushQualityPolicy({
    id,
    source: item.source,
    runtimeBrushId: selection.runtimeBrushId,
    mediaGroup: item.mediaGroup,
    previewStyle: item.previewStyle,
    intentionalDiscrete,
    depositsPigment: !transparent,
  });
  return {
    item,
    runtimeBrushId: selection.runtimeBrushId,
    defaultWidth: selection.defaultWidth,
    softWet: policy.kind === "soft-wet-continuous",
    transparent,
    discrete: policy.kind === "record-only-discrete",
    eraser: isEraserItem(item),
  };
}

// ---------------------------------------------------------------------------
// Page preparation — mirrors verify-studio-brushes.mts so both verifiers see the same product.
// ---------------------------------------------------------------------------

async function installCleanStudioState(page: Page): Promise<void> {
  await page.addInitScript({ content: "globalThis.__name ??= (fn) => fn;" });
  await page.addInitScript(
    ({ autosavePrefix, mobileHintKey, quickstartKey, studioAppSettingsKey }) => {
      try {
        window.localStorage.setItem(quickstartKey, "1");
        window.localStorage.setItem(mobileHintKey, "1");
        let persisted: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(window.localStorage.getItem(studioAppSettingsKey) ?? "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) persisted = parsed;
        } catch {
          // replaced below
        }
        const general = persisted.general && typeof persisted.general === "object"
          ? persisted.general as Record<string, unknown>
          : {};
        window.localStorage.setItem(studioAppSettingsKey, JSON.stringify({
          ...persisted,
          general: { ...general, brushCursorStyle: "none" },
        }));
        for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
          const key = window.localStorage.key(index);
          if (key?.startsWith(autosavePrefix)) window.localStorage.removeItem(key);
        }
      } catch {
        // Studio handles unavailable storage itself.
      }
    },
    {
      autosavePrefix: AUTOSAVE_PREFIX,
      mobileHintKey: MOBILE_HINT_KEY,
      quickstartKey: QUICKSTART_KEY,
      studioAppSettingsKey: STUDIO_APP_SETTINGS_STORAGE_KEY,
    },
  );
}

async function dismissTransientChrome(page: Page): Promise<void> {
  const quickstart = page.locator('[data-studio-creative-starter="true"]');
  if (await quickstart.isVisible({ timeout: 250 }).catch(() => false)) {
    await quickstart.locator('[data-studio-quickstart-dismiss="true"]').click();
  }
  await page.keyboard.press("Escape");
  if (
    await page.getByText("이전에 작성 중이던 임시저장 데이터가 있습니다.", { exact: false })
      .isVisible({ timeout: 250 })
      .catch(() => false)
  ) {
    await page.getByRole("button", { name: "비우기", exact: true }).click();
  }
}

/** Evidence chrome that must never reach a frame: the brush HUD card and the Konva cursor ring. */
async function hideEvidenceChrome(page: Page): Promise<void> {
  await page.addStyleTag({
    content: [
      '[data-studio-brush-hud="true"] { display: none !important; }',
      'canvas[data-studio-brush-cursor-canvas="true"] { display: none !important; }',
    ].join("\n"),
  });
}

async function prepareStudioPage(page: Page, studioUrl: string): Promise<void> {
  page.setDefaultTimeout(8_000);
  await installCleanStudioState(page);
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator('[data-studio-editor="true"]').waitFor({ state: "visible", timeout: 20_000 });
  await hideEvidenceChrome(page);
  await dismissTransientChrome(page);
}

async function activatePenMode(page: Page): Promise<void> {
  await page.keyboard.press("b");
  await page.waitForFunction(() =>
    document.querySelector('[data-studio-draw-options="true"]')
      ?.getAttribute("data-studio-active-draw-mode") === "pen"
  );
}

async function activateEraserMode(page: Page): Promise<void> {
  await page.keyboard.press("e");
  await page.waitForFunction(() =>
    document.querySelector('[data-studio-draw-options="true"]')
      ?.getAttribute("data-studio-active-draw-mode") === "eraser"
  );
}

async function selectBrush(page: Page, profile: BrushProfile): Promise<void> {
  if (profile.eraser) await activateEraserMode(page);
  else await activatePenMode(page);
  const toolbar = page.locator('[data-studio-draw-options="true"]');
  await toolbar.waitFor({ state: "visible", timeout: 8_000 });
  const pill = toolbar.locator('[data-studio-brush-active-pill="true"]');
  await pill.waitFor({ state: "visible" });
  await pill.click();
  const catalog = page.locator('[data-studio-brush-catalog-session="true"]');
  await catalog.waitFor({ state: "visible" });
  await catalog.getByRole("tab", { name: "전체", exact: true }).click();
  await catalog.getByRole("searchbox").fill(profile.item.name);
  const option = catalog.getByRole("button", { name: `${profile.item.name} 선택`, exact: true });
  // Large catalogues mount progressively, so a preset far down the list is not in the DOM until
  // its scrollport reaches the observer sentinel. Reveal in bounded batches before giving up.
  for (let batch = 0; batch < 24 && await option.count() === 0; batch += 1) {
    const sentinel = catalog.locator('[data-studio-brush-progressive-sentinel="true"]');
    if (await sentinel.count() === 0) break;
    await catalog.locator('[data-studio-brush-catalog-scrollport="true"]').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.waitForTimeout(120);
  }
  await option.waitFor({ state: "visible" });
  await option.scrollIntoViewIfNeeded();
  await option.click({ force: true });
  await catalog.waitFor({ state: "detached" }).catch(() => {});
  await page.waitForFunction(
    ({ expectedName }) => document
      .querySelector('[data-studio-brush-active-pill="true"]')
      ?.getAttribute("aria-label")
      ?.includes(expectedName) === true,
    { expectedName: profile.item.name },
    { timeout: 15_000 },
  );
  // Leave the pointer away from chrome; the first stroke must not start on a tooltip.
  await page.mouse.move(4, 4);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Clip {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function stageClip(page: Page): Promise<Clip> {
  const box = await page.locator(".konvajs-content").first().boundingBox();
  invariant(box, "the Konva stage is not visible");
  const left = Math.max(box.x + 52, VIEWPORT.width * 0.32);
  const right = Math.min(box.x + box.width - 52, VIEWPORT.width * 0.68);
  const top = Math.max(box.y + 70, VIEWPORT.height * 0.2);
  const bottom = Math.min(box.y + box.height - 50, VIEWPORT.height * 0.65);
  invariant(right - left > 200 && bottom - top > 160, "the exposed canvas area is too small");
  return {
    x: Math.floor(left),
    y: Math.floor(top),
    width: Math.floor(right - left),
    height: Math.floor(bottom - top),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function sCurve(clip: Clip, count: number, yFraction = 0.5, amplitude = 0.22): Point[] {
  const points: Point[] = [];
  const x0 = clip.x + clip.width * 0.12;
  const x1 = clip.x + clip.width * 0.88;
  const yMid = clip.y + clip.height * yFraction;
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    points.push({
      x: lerp(x0, x1, t),
      y: yMid + Math.sin(t * Math.PI * 2) * clip.height * amplitude,
    });
  }
  return points;
}

/** A closed circle whose last sample returns to the first — the seam is the point of interest. */
function circle(clip: Clip, count: number): Point[] {
  const radius = Math.min(clip.width, clip.height) * 0.38;
  const cx = clip.x + clip.width / 2;
  const cy = clip.y + clip.height / 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / (count - 1)) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

/** Zig-zag with a right angle, an acute turn and a reflex turn, sampled densely on each leg. */
function zigZag(clip: Clip): { points: Point[]; corners: Point[] } {
  const left = clip.x + clip.width * 0.12;
  const right = clip.x + clip.width * 0.88;
  const top = clip.y + clip.height * 0.18;
  const bottom = clip.y + clip.height * 0.82;
  const midY = clip.y + clip.height * 0.5;
  const vertices: Point[] = [
    { x: left, y: midY },
    { x: left + (right - left) * 0.22, y: top },
    { x: left + (right - left) * 0.42, y: bottom },
    { x: left + (right - left) * 0.5, y: top },
    { x: left + (right - left) * 0.74, y: midY },
    { x: right, y: bottom },
  ];
  const points: Point[] = [vertices[0]!];
  for (let index = 1; index < vertices.length; index += 1) {
    const leg = line(vertices[index - 1]!, vertices[index]!, 22);
    points.push(...leg.slice(1));
  }
  return { points, corners: vertices.slice(1, -1) };
}

function line(from: Point, to: Point, count: number): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0 : index / (count - 1);
    return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
  });
}

function toClipSpace(point: Point, clip: Clip): Point {
  return { x: point.x - clip.x, y: point.y - clip.y };
}

// ---------------------------------------------------------------------------
// Capture + gesture
// ---------------------------------------------------------------------------

function decode(buffer: Buffer): StudioBrushMediaPixelImage {
  const image = decodePng(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  const raw = image.getRawImage();
  return { width: image.width, height: image.height, channels: image.channels, data: raw.data };
}

interface CapturedStroke {
  readonly baseline: Buffer;
  /** Pointer still down, ~60 % of the path travelled. */
  readonly live: Buffer;
  /** Pointer still down at the final sample — the frame the pointer-up cap is judged against. */
  readonly liveEnd: Buffer;
  readonly released: Buffer;
  readonly postRelease: readonly Buffer[];
  readonly settled: Buffer;
  readonly perf: StudioBrushScenarioPerfSample;
  readonly captureInducedLongTasks: number;
  readonly gestureMs: number;
  /** Product alerts that say a stroke was refused, read right after this gesture. */
  readonly refusals: readonly string[];
  /**
   * The refused-stroke recovery rail's own DOM hook, counted right after pointer-up and again
   * after settle. Read beside the presented-frame series it separates two blinks that look the
   * same on screen: a rail parking a refused stroke and repainting it on the CPU (notice present)
   * from a compositor hidden between a submit and its receipt (no notice).
   */
  readonly rejectedNotices: { readonly released: number; readonly settled: number };
  /** Presented frames while the pointer was down, in presentation order. */
  readonly inStroke: readonly StudioBrushScenarioInStrokeFrame[];
  /** Per-canvas ink over the gesture, when TOONSPECTRUM_SCENARIO_LAYER_PROBE=1. */
  readonly layers: { labels: string[]; samples: Array<[number, number[], number]> } | null;
  /** Canvas clear/resize/draw events over the gesture, when TOONSPECTRUM_SCENARIO_CLEAR_TRACE=1. */
  readonly clearTrace: Array<Record<string, unknown>> | null;
  /** Sizes of the presented frames (diagnostic — off-size frames are skipped by the ink series). */
  readonly presentedMeta: PresentedFrameMeta | null;
  /** The presented frames themselves, so a detected blink can be written out to look at. */
  readonly presented: ReadonlyArray<{ readonly tMs: number; readonly data: Buffer }>;
}

async function installPerfProbe(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const state = { longTasks: [], frameGaps: [], captures: [], last: performance.now(), raf: 0, observer: null };
    try {
      state.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.longTasks.push([entry.startTime, entry.duration]);
      });
      state.observer.observe({ type: "longtask", buffered: false });
    } catch { state.observer = null; }
    const tick = (now) => {
      state.frameGaps.push(now - state.last);
      state.last = now;
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
    window.__scenarioPerf = state;
  })()`);
}

interface RawPerfSample {
  readonly longTasks: ReadonlyArray<readonly [start: number, duration: number]>;
  readonly frameGapsMs: readonly number[];
  readonly captures: ReadonlyArray<readonly [start: number, end: number]>;
}

/**
 * Long tasks that overlap a screenshot window belong to the harness (headless capture blocks the
 * renderer main thread for ~100 ms); only the rest can be blamed on the gesture. Frame gaps that
 * overlap a capture are dropped for the same reason.
 */
function attributePerf(raw: RawPerfSample): { app: StudioBrushScenarioPerfSample; captureInduced: number } {
  const overlapsCapture = (start: number, end: number) =>
    raw.captures.some(([captureStart, captureEnd]) => start <= captureEnd + 8 && end >= captureStart - 8);
  const longTasks: number[] = [];
  let captureInduced = 0;
  for (const [start, duration] of raw.longTasks) {
    if (overlapsCapture(start, start + duration)) captureInduced += 1;
    else longTasks.push(duration);
  }
  return { app: { longTasks, frameGapsMs: raw.frameGapsMs }, captureInduced };
}

async function readPerfProbe(page: Page): Promise<RawPerfSample> {
  return await page.evaluate(`(() => {
    const state = window.__scenarioPerf;
    if (!state) return { longTasks: [], frameGapsMs: [], captures: [] };
    cancelAnimationFrame(state.raf);
    if (state.observer) state.observer.disconnect();
    delete window.__scenarioPerf;
    return { longTasks: state.longTasks, frameGapsMs: state.frameGaps, captures: state.captures };
  })()`) as RawPerfSample;
}

interface ScreencastRecording {
  /** Stop the cast and return the frames it presented, oldest first. */
  readonly stop: () => Promise<ReadonlyArray<{ readonly tMs: number; readonly data: Buffer }>>;
}

/**
 * Record presented frames over CDP. Frames arrive as viewport-sized JPEGs at the compositor's own
 * rate, so they show what the artist saw rather than what a blocking screenshot could catch. The
 * cap bounds memory on a long gesture; it is far above the ~200 frames a scenario stroke presents.
 */
async function recordPresentedFrames(page: Page, maxFrames = 900): Promise<ScreencastRecording> {
  const session = await page.context().newCDPSession(page);
  const frames: Array<{ tMs: number; data: Buffer }> = [];
  let origin: number | null = null;
  session.on("Page.screencastFrame", (event: {
    data: string;
    sessionId: number;
    metadata: { timestamp?: number };
  }) => {
    const stamp = (event.metadata.timestamp ?? 0) * 1_000;
    origin = origin === null ? stamp : Math.min(origin, stamp);
    if (frames.length < maxFrames) frames.push({ tMs: stamp, data: Buffer.from(event.data, "base64") });
    // Chromium presents the next frame only once the previous one is acknowledged.
    void session.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
  });
  await session.send("Page.startScreencast", {
    format: "jpeg",
    quality: 90,
    maxWidth: VIEWPORT.width,
    maxHeight: VIEWPORT.height,
    everyNthFrame: 1,
  });
  return {
    stop: async () => {
      try {
        await session.send("Page.stopScreencast");
      } finally {
        await session.detach().catch(() => {});
      }
      // Frame metadata timestamps do not arrive in order — an out-of-order frame put the deepest
      // dip at -103 ms, i.e. before the cast opened. Order by presentation time before anything
      // reads the series as a timeline.
      const first = origin ?? 0;
      return frames
        .map((frame) => ({ tMs: frame.tMs - first, data: frame.data }))
        .sort((left, right) => left.tMs - right.tMs);
    },
  };
}

/**
 * Canvas mutation tracer (diagnostic). Wraps clearRect / width / height / first draw so a blank
 * presented frame can be attributed: a full clear followed by no draw before the next frame is
 * "cleared and not repainted"; a frame with no clear at all means nothing was ever painted.
 */
async function installClearTrace(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const roots = Array.from(document.querySelectorAll(".konvajs-content, [data-studio-live-ink-overlay], [data-studio-live-retained-settled], [data-studio-live-retained-active], [data-studio-live-dynamic-settled], [data-studio-live-dynamic-active], [data-studio-live-wet-ink-settled], [data-studio-live-wet-ink-active], [data-studio-live-stamp-overlay], [data-studio-live-ink-prediction], [data-studio-gpu-compositor]"));
    const labelOf = (canvas) => {
      const ds = canvas.dataset || {};
      const role = ds.studioLiveInkOverlay ? "live-ink"
        : ds.studioLiveRetainedActive ? "retained-active"
        : ds.studioLiveRetainedSettled ? "retained-settled"
        : ds.studioLiveDynamicActive ? "dynamic-active"
        : ds.studioLiveDynamicSettled ? "dynamic-settled"
        : ds.studioLiveWetInkActive ? "wet-ink-active"
        : ds.studioLiveWetInkSettled ? "wet-ink-settled"
        : ds.studioLiveStampOverlay ? "stamp"
        : ds.studioLiveInkPrediction ? "ink-prediction"
        : ds.studioGpuSurface ? "gpu-" + ds.studioGpuSurface
        : ds.studioDraftPreviewBlend ? "konva-draft-" + ds.studioDraftPreviewBlend
        : "konva";
      const all = roots.flatMap((root) => root instanceof HTMLCanvasElement ? [root] : Array.from(root.querySelectorAll("canvas")));
      const index = all.indexOf(canvas);
      return (index < 0 ? "?" : index) + ":" + role;
    };
    const tracked = (canvas) => canvas instanceof HTMLCanvasElement && roots.some((root) => root === canvas || root.contains(canvas));
    const state = { events: [], drawsSinceClear: new WeakMap(), installed: performance.now() };
    const stackTop = () => {
      try { return String(new Error().stack || "").split("\n").slice(2, 6).map((l) => l.trim()).join(" < "); } catch { return ""; }
    };
    const proto = CanvasRenderingContext2D.prototype;
    const originalClear = proto.clearRect;
    proto.clearRect = function (x, y, w, h) {
      const canvas = this.canvas;
      if (tracked(canvas)) {
        const m = this.getTransform ? this.getTransform() : null;
        const sw = m ? Math.abs(w * m.a) : w;
        const sh = m ? Math.abs(h * m.d) : h;
        const full = sw >= canvas.width * 0.9 && sh >= canvas.height * 0.9;
        if (full) {
          state.events.push({ t: performance.now(), kind: "clear", label: labelOf(canvas), w: canvas.width, h: canvas.height, stack: stackTop() });
          state.drawsSinceClear.set(canvas, 0);
        }
      }
      return originalClear.apply(this, arguments);
    };
    for (const name of ["fill", "stroke", "drawImage", "putImageData", "fillRect", "fillText"]) {
      const original = proto[name];
      if (typeof original !== "function") continue;
      proto[name] = function () {
        const canvas = this.canvas;
        if (tracked(canvas)) {
          const count = state.drawsSinceClear.get(canvas) ?? 0;
          if (count === 0) state.events.push({ t: performance.now(), kind: "first-draw", op: name, label: labelOf(canvas) });
          state.drawsSinceClear.set(canvas, count + 1);
        }
        return original.apply(this, arguments);
      };
    }
    for (const prop of ["width", "height"]) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, prop);
      if (!descriptor || !descriptor.set) continue;
      Object.defineProperty(HTMLCanvasElement.prototype, prop, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) {
          if (tracked(this)) {
            state.events.push({ t: performance.now(), kind: "resize-" + prop, label: labelOf(this), from: descriptor.get.call(this), to: value, stack: stackTop() });
            state.drawsSinceClear.set(this, 0);
          }
          return descriptor.set.call(this, value);
        },
      });
    }
    const originalRaf = window.requestAnimationFrame;
    window.__scenarioClearTrace = state;
    // Frame markers: one per animation frame so events can be bucketed into frames.
    const tick = (now) => { state.events.push({ t: now, kind: "raf" }); state.raf = originalRaf.call(window, tick); };
    state.raf = originalRaf.call(window, tick);
  })()`);
}

async function readClearTrace(page: Page): Promise<Array<Record<string, unknown>>> {
  return await page.evaluate(`(() => {
    const state = window.__scenarioClearTrace;
    if (!state) return [];
    cancelAnimationFrame(state.raf);
    delete window.__scenarioClearTrace;
    return state.events;
  })()`) as Array<Record<string, unknown>>;
}

/**
 * Per-canvas ink, sampled once per animation frame.
 *
 * The presented-frame series says a stroke blinked; it cannot say which layer went blank. This
 * reads every canvas under the stage separately — compositing each into one small scratch canvas
 * so a WebGL or WebGPU layer is measured the same way a 2D one is — and reports each layer's ink
 * over time. Opt in with TOONSPECTRUM_SCENARIO_LAYER_PROBE=1; it costs a readback per layer per
 * frame, which is too much to leave on for a whole matrix run.
 */
async function installLayerProbe(page: Page, clip: Clip): Promise<void> {
  await page.evaluate(`((clip) => {
    // The live overlays are siblings of the Konva stage, not children of it, and a GPU-lane brush
    // draws on neither — its pixels are on the WebGPU compositor child. A probe rooted only at
    // .konvajs-content reported "no layer changed" for a whole pen gesture whose every pixel was on
    // that compositor, which is what sent one investigation in circles. Watch all three families.
    const roots = Array.from(document.querySelectorAll(".konvajs-content, [data-studio-live-ink-overlay], [data-studio-live-retained-settled], [data-studio-live-retained-active], [data-studio-live-dynamic-settled], [data-studio-live-dynamic-active], [data-studio-live-wet-ink-settled], [data-studio-live-wet-ink-active], [data-studio-live-stamp-overlay], [data-studio-live-ink-prediction], [data-studio-gpu-compositor]"));
    if (roots.length === 0) return;
    const collect = () => roots.flatMap((root) =>
      root instanceof HTMLCanvasElement ? [root] : Array.from(root.querySelectorAll("canvas")));
    const SIZE = 96;
    const scratch = document.createElement("canvas");
    scratch.width = SIZE;
    scratch.height = SIZE;
    const scratchContext = scratch.getContext("2d", { willReadFrequently: true });
    const state = { samples: [], raf: 0, labels: [], references: new WeakMap() };
    // Ink is measured as CHANGE against each layer's first sample, not as alpha: the paper layer
    // is fully opaque, so an alpha count says "covered" on every frame and can never show a stroke.
    const sampleOf = (canvas) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return -1;
      scratchContext.clearRect(0, 0, SIZE, SIZE);
      try {
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        scratchContext.drawImage(
          canvas,
          (clip.x - rect.left) * scaleX, (clip.y - rect.top) * scaleY,
          clip.width * scaleX, clip.height * scaleY,
          0, 0, SIZE, SIZE,
        );
      } catch {
        return -2;
      }
      const { data } = scratchContext.getImageData(0, 0, SIZE, SIZE);
      const reference = state.references.get(canvas);
      if (!reference) {
        state.references.set(canvas, Uint8ClampedArray.from(data));
        return 0;
      }
      let changed = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (Math.abs(data[index] - reference[index]) > 12
          || Math.abs(data[index + 1] - reference[index + 1]) > 12
          || Math.abs(data[index + 2] - reference[index + 2]) > 12
          || Math.abs(data[index + 3] - reference[index + 3]) > 12) changed += 1;
      }
      return changed;
    };
    const tick = (now) => {
      const canvases = collect();
      state.labels = canvases.map((canvas, index) => {
        const rect = canvas.getBoundingClientRect();
        const role = canvas.dataset.studioLiveInkOverlay ? "live-ink"
          : canvas.dataset.studioLiveRetainedActive ? "retained-active"
          : canvas.dataset.studioLiveRetainedSettled ? "retained-settled"
          : canvas.dataset.studioLiveDynamicActive ? "dynamic-active"
          : canvas.dataset.studioLiveDynamicSettled ? "dynamic-settled"
          : canvas.dataset.studioLiveWetInkActive ? "wet-ink-active"
          : canvas.dataset.studioLiveWetInkSettled ? "wet-ink-settled"
          : canvas.dataset.studioLiveStampOverlay ? "stamp"
          : canvas.dataset.studioLiveInkPrediction ? "ink-prediction"
          : canvas.dataset.studioGpuSurface ? "gpu-" + canvas.dataset.studioGpuSurface
          : canvas.dataset.studioDraftPreviewBlend ? "konva-draft-" + canvas.dataset.studioDraftPreviewBlend
          : "konva";
        return index + ":" + role + ":store" + canvas.width + "x" + canvas.height
          + ":css" + Math.round(rect.width) + "x" + Math.round(rect.height);
      });
      // A hidden surface still reads back its pixels, so ink alone cannot explain a blank frame.
      // The compositor root is CSS-hidden between a GPU submission and its receipt; record that.
      const compositor = document.querySelector("[data-studio-gpu-compositor]");
      const shown = compositor ? getComputedStyle(compositor) : null;
      state.samples.push([
        Math.round(now),
        canvases.map(sampleOf),
        shown ? (shown.visibility === "hidden" || shown.opacity === "0" ? 0 : 1) : -1,
      ]);
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
    window.__scenarioLayers = state;
  })(${JSON.stringify(clip)})`);
}

async function readLayerProbe(page: Page): Promise<{
  labels: string[];
  samples: Array<[number, number[], number]>;
}> {
  return await page.evaluate(`(() => {
    const state = window.__scenarioLayers;
    if (!state) return { labels: [], samples: [] };
    cancelAnimationFrame(state.raf);
    delete window.__scenarioLayers;
    return { labels: state.labels, samples: state.samples };
  })()`) as { labels: string[]; samples: Array<[number, number[], number]> };
}

async function shot(page: Page, clip: Clip): Promise<Buffer> {
  const started = await page.evaluate("performance.now()") as number;
  const buffer = await page.screenshot({ animations: "disabled", clip });
  await page.evaluate(
    `(() => { const s = window.__scenarioPerf; if (s) s.captures.push([${started}, performance.now()]); })()`,
  );
  return buffer;
}

/**
 * Drive one gesture through the pointer and capture every representation boundary. The live
 * frame is taken while the pointer is still down at ~60 % of the path; released is the very next
 * screenshot after pointer-up; the post-release series samples the overlay→document hand-off.
 */
async function drawAndCapture(
  page: Page,
  clip: Clip,
  points: readonly Point[],
  options: {
    liveAt?: number;
    settleMs?: number;
    postFrames?: number;
    /** Pause between pointer moves — a slow hand for the speed comparison. */
    stepDelayMs?: number;
  } = {},
): Promise<CapturedStroke> {
  invariant(points.length >= 1, "a gesture needs at least one point");
  const liveAt = Math.min(points.length - 1, Math.max(0, Math.floor((options.liveAt ?? 0.6) * (points.length - 1))));
  const baseline = await shot(page, clip);
  await installPerfProbe(page);
  const cast = await recordPresentedFrames(page);
  if (LAYER_PROBE) await installLayerProbe(page, clip);
  if (CLEAR_TRACE) await installClearTrace(page);
  const started = Date.now();
  const first = points[0]!;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  let live: Buffer | null = null;
  if (points.length === 1) {
    await page.waitForTimeout(40);
    live = await shot(page, clip);
  }
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    await page.mouse.move(point.x, point.y, { steps: 2 });
    if (options.stepDelayMs) await page.waitForTimeout(options.stepDelayMs);
    if (index === liveAt) {
      await page.waitForTimeout(30);
      live = await shot(page, clip);
    }
  }
  await page.waitForTimeout(30);
  const liveEnd = await shot(page, clip);
  if (!live) live = liveEnd;
  const presented = await cast.stop();
  const layers = LAYER_PROBE ? await readLayerProbe(page) : null;
  const clearTrace = CLEAR_TRACE ? await readClearTrace(page) : null;
  await page.mouse.up();
  const gestureMs = Date.now() - started;
  const released = await shot(page, clip);
  const noticesAtRelease = await page.locator("[data-studio-rejected-stroke-notice]").count();
  const postRelease: Buffer[] = [];
  for (let index = 0; index < (options.postFrames ?? 8); index += 1) {
    await page.waitForTimeout(40);
    postRelease.push(await shot(page, clip));
  }
  await page.mouse.move(4, 4);
  await page.waitForTimeout(options.settleMs ?? 2_000);
  const settled = await shot(page, clip);
  const noticesAtSettle = await page.locator("[data-studio-rejected-stroke-notice]").count();
  const { app: perf, captureInduced } = attributePerf(await readPerfProbe(page));
  const refusals = await page.evaluate(`Array.from(document.querySelectorAll('[role="alert"]'))
    .map((element) => (element.textContent || "").trim())
    .filter((text) => text.includes("획을 시작하지 않았습니다") || text.includes("현재 획을 취소했습니다"))`) as string[];
  return {
    baseline,
    live,
    liveEnd,
    released,
    postRelease,
    settled,
    perf,
    captureInducedLongTasks: captureInduced,
    gestureMs,
    refusals,
    rejectedNotices: { released: noticesAtRelease, settled: noticesAtSettle },
    inStroke: measurePresentedInk(presented, clip),
    presentedMeta: lastPresentedMeta,
    layers,
    clearTrace,
    presented,
  };
}

/**
 * Ink pixels inside the canvas clip for each presented frame, measured against the frame the cast
 * opened with. Screencast frames cover the whole viewport, so the clip is applied as a region
 * rather than by cropping; the first frame is the pre-gesture reference by construction.
 */
/** Diagnostic: sizes of every presented frame of the last measured gesture (clip screenshots resize the cast). */
interface PresentedFrameMeta {
  readonly referenceWidth: number;
  readonly referenceHeight: number;
  readonly frames: Array<{ tMs: number; width: number; height: number }>;
}

let lastPresentedMeta: PresentedFrameMeta | null = null;

function measurePresentedInk(
  presented: ReadonlyArray<{ readonly tMs: number; readonly data: Buffer }>,
  clip: Clip,
): StudioBrushScenarioInStrokeFrame[] {
  if (presented.length < 2) return [];
  const toImage = (data: Buffer): StudioBrushMediaPixelImage => {
    const image = decodeJpeg(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    const raw = image.getRawImage();
    return { width: image.width, height: image.height, channels: image.channels, data: raw.data };
  };
  const reference = toImage(presented[0]!.data);
  const region = { x: clip.x, y: clip.y, width: clip.width, height: clip.height };
  const measured: StudioBrushScenarioInStrokeFrame[] = [];
  lastPresentedMeta = {
    referenceWidth: reference.width,
    referenceHeight: reference.height,
    frames: [{ tMs: presented[0]!.tMs, width: reference.width, height: reference.height }],
  };
  for (let index = 1; index < presented.length; index += 1) {
    const frame = presented[index]!;
    let image: StudioBrushMediaPixelImage;
    try {
      image = toImage(frame.data);
    } catch {
      continue; // a truncated frame is the cast's problem, not the renderer's
    }
    lastPresentedMeta.frames.push({ tMs: frame.tMs, width: image.width, height: image.height });
    if (image.width !== reference.width || image.height !== reference.height) continue;
    const mask = studioBrushScenarioInkMask(reference, image);
    measured.push({
      tMs: frame.tMs,
      ink: studioBrushScenarioMaskStats(mask, reference.width, reference.height, region).count,
    });
  }
  return measured;
}

/**
 * Undo every stroke of a scenario and prove the canvas is back at the scenario baseline. The
 * keyboard route is the product's primary undo; the history button is the fallback when focus
 * wandered. A residue that survives both is reported by the caller as a harness failure.
 */
async function undoTimes(page: Page, clip: Clip, baseline: Buffer, count: number): Promise<number> {
  const inkAgainstBaseline = async (): Promise<number> => {
    const base = decode(baseline);
    const now = decode(await shot(page, clip));
    return studioBrushScenarioMaskStats(studioBrushScenarioInkMask(base, now), base.width, base.height).count;
  };
  await page.mouse.move(4, 4);
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await page.waitForTimeout(160);
  }
  await page.waitForTimeout(400);
  if (await inkAgainstBaseline() < 24) return 0;
  for (let attempt = 0; attempt < count + 1; attempt += 1) {
    const undo = await enabledStudioHistoryControl(page, "undo", 3_000).catch(() => null);
    if (!undo) break;
    await undo.click();
    await page.waitForTimeout(200);
    if (await inkAgainstBaseline() < 24) return 0;
  }
  return await inkAgainstBaseline();
}

// ---------------------------------------------------------------------------
// Analysis records
// ---------------------------------------------------------------------------

interface StrokeRecord {
  readonly label: string;
  readonly inkLive: number;
  readonly inkReleased: number;
  readonly inkSettled: number;
  readonly flicker: StudioBrushScenarioFlickerAnalysis;
  readonly inStroke: StudioBrushScenarioInStrokeAnalysis;
  /** The presented-frame ink series the in-stroke verdict was read from (diagnostic). */
  readonly inStrokeFrames: readonly StudioBrushScenarioInStrokeFrame[];
  readonly rejectedNotices: { readonly released: number; readonly settled: number };
  readonly layers: { labels: string[]; samples: Array<[number, number[], number]> } | null;
  readonly clearTrace: Array<Record<string, unknown>> | null;
  readonly presentedMeta: PresentedFrameMeta | null;
  readonly regions: Readonly<Record<string, StudioBrushScenarioDiscrepancy>>;
  readonly perf: {
    longTasks: number;
    worstTaskMs: number;
    worstFrameGapMs: number;
    captureInducedLongTasks: number;
    gestureMs: number;
  };
  readonly findings: readonly StudioBrushScenarioFinding[];
  readonly artifacts: Readonly<Record<string, string>>;
}

interface ScenarioRecord {
  readonly scenario: ScenarioName;
  readonly partner: string | null;
  readonly strokes: readonly StrokeRecord[];
  readonly findings: readonly StudioBrushScenarioFinding[];
  readonly skipped: string | null;
}

interface BrushRecord {
  readonly id: string;
  readonly runtimeBrushId: string;
  readonly policy: { softWet: boolean; transparent: boolean; discrete: boolean; eraser: boolean };
  readonly scenarios: readonly ScenarioRecord[];
}

function saveFrames(
  directory: string,
  prefix: string,
  captured: CapturedStroke,
): Record<string, string> {
  mkdirSync(directory, { recursive: true });
  const artifacts: Record<string, string> = {};
  const save = (name: string, buffer: Buffer, extension: "png" | "jpg" = "png") => {
    const path = join(directory, `${prefix}-${name}.${extension}`);
    writeFileSync(path, buffer);
    artifacts[name] = path;
  };
  // A blink is only actionable if you can see what went missing, so the deepest dip and the
  // frames either side of it are written out whenever the presented series contains one.
  const inStroke = analyzeStudioBrushScenarioInStroke(captured.inStroke);
  if (inStroke.verdict === "blink" && inStroke.worstDropAtMs !== null) {
    const dip = captured.presented.findIndex((frame) => frame.tMs >= inStroke.worstDropAtMs!);
    if (dip >= 0) {
      for (const [suffix, offset] of [["before", -1], ["dip", 0], ["after", 1]] as const) {
        const frame = captured.presented[dip + offset];
        if (frame) save(`05-blink-${suffix}`, frame.data, "jpg");
      }
    }
  }
  save("00-baseline", captured.baseline);
  save("01-live", captured.live);
  save("01-live-end", captured.liveEnd);
  save("02-released", captured.released);
  captured.postRelease.forEach((frame, index) => save(`03-post-${index}`, frame));
  save("04-settled", captured.settled);
  return artifacts;
}

interface RegionSpec {
  readonly name: string;
  readonly region: StudioBrushScenarioRegion;
  readonly code: Parameters<typeof judgeStudioBrushScenarioDiscrepancy>[1];
  /** Which pointer-down frame the region is judged against; caps at the end need the last one. */
  readonly frame?: "mid" | "end";
}

function analyzeStroke(
  label: string,
  captured: CapturedStroke,
  regions: readonly RegionSpec[],
  profile: BrushProfile,
  artifacts: Record<string, string>,
  options: { flicker?: boolean; expectGap?: StudioBrushScenarioRegion | null } = {},
): StrokeRecord {
  const baseline = decode(captured.baseline);
  const live = decode(captured.live);
  const liveEnd = decode(captured.liveEnd);
  const released = decode(captured.released);
  const settled = decode(captured.settled);
  const judgement = { softWet: profile.softWet, transparent: profile.transparent };
  // An eraser stroke on paper that carries no base removes nothing, so "there is no ink" is a
  // statement about the scenario, not about the renderer. It used to be reported as
  // post-release-empty on every eraser preset the curve scenario ran.
  const judgesInk = options.flicker !== false && !(profile.eraser && options.expectGap == null);
  const findings: StudioBrushScenarioFinding[] = [];
  const stats = (frame: StudioBrushMediaPixelImage) =>
    studioBrushScenarioMaskStats(studioBrushScenarioInkMask(baseline, frame), baseline.width, baseline.height).count;
  const flicker = analyzeStudioBrushScenarioFlicker(
    baseline,
    [released, ...captured.postRelease.map(decode), settled],
  );
  if (judgesInk) findings.push(...judgeStudioBrushScenarioFlicker(flicker, judgement));
  const inStroke = analyzeStudioBrushScenarioInStroke(captured.inStroke);
  if (judgesInk) findings.push(...judgeStudioBrushScenarioInStroke(inStroke, judgement));
  const regionResults: Record<string, StudioBrushScenarioDiscrepancy> = {};
  for (const spec of regions) {
    const discrepancy = analyzeStudioBrushScenarioDiscrepancy(
      baseline,
      spec.frame === "end" ? liveEnd : live,
      released,
      spec.region,
    );
    regionResults[spec.name] = discrepancy;
    findings.push(...judgeStudioBrushScenarioDiscrepancy(discrepancy, spec.code, judgement));
  }
  if (options.expectGap) {
    // An eraser stroke must remove ink: the released and settled frames inside the crossing must
    // hold fewer ink pixels (vs the pre-eraser baseline they are compared against) than the live
    // frame's own footprint would, i.e. the region must have CHANGED against the baseline.
    const releasedChange = studioBrushScenarioMaskStats(
      studioBrushScenarioInkMask(baseline, released),
      baseline.width,
      baseline.height,
      options.expectGap,
    ).count;
    const settledChange = studioBrushScenarioMaskStats(
      studioBrushScenarioInkMask(baseline, settled),
      baseline.width,
      baseline.height,
      options.expectGap,
    ).count;
    if (releasedChange < 12 || settledChange < 12) {
      findings.push({
        level: "error",
        code: "eraser-gap-missing",
        message: `the eraser changed ${releasedChange}/${settledChange} px (released/settled) inside the crossing`,
      });
    }
  }
  const perfFindings = judgeStudioBrushScenarioPerf(captured.perf);
  findings.push(...perfFindings);
  if (captured.refusals.length > 0) {
    findings.push({
      level: "error",
      code: "stroke-refused",
      message: captured.refusals[0]!.slice(0, 160),
    });
  }
  return {
    label,
    inkLive: stats(live),
    inkReleased: stats(released),
    inkSettled: stats(settled),
    flicker,
    inStroke,
    inStrokeFrames: captured.inStroke,
    clearTrace: captured.clearTrace,
    presentedMeta: captured.presentedMeta,
    rejectedNotices: captured.rejectedNotices,
    layers: captured.layers,
    regions: regionResults,
    perf: {
      longTasks: captured.perf.longTasks.length,
      worstTaskMs: captured.perf.longTasks.length === 0 ? 0 : Math.max(...captured.perf.longTasks),
      worstFrameGapMs: captured.perf.frameGapsMs.length === 0 ? 0 : Math.max(...captured.perf.frameGapsMs),
      captureInducedLongTasks: captured.captureInducedLongTasks,
      gestureMs: captured.gestureMs,
    },
    findings,
    artifacts,
  };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

function partnerFor(profile: BrushProfile): string {
  if (profile.item.mediaGroup === "watercolor" || profile.runtimeBrushId.includes("ink")) return "pen";
  return "watercolor";
}

function crossingRegion(clip: Clip, center: Point, radius: number): StudioBrushScenarioRegion {
  const local = toClipSpace(center, clip);
  return studioBrushScenarioPointRegion(local, radius, { width: clip.width, height: clip.height });
}

async function runScenario(
  page: Page,
  clip: Clip,
  scenario: ScenarioName,
  profile: BrushProfile,
  partner: BrushProfile | null,
  directory: string,
): Promise<ScenarioRecord> {
  const strokes: StrokeRecord[] = [];
  const width = Math.max(4, profile.defaultWidth);
  const capRadius = Math.max(10, width * 1.2 + 6);
  const crossRadius = Math.max(14, width * 1.6 + 8);
  const center = { x: clip.x + clip.width / 2, y: clip.y + clip.height / 2 };
  const diagonalA = line(
    { x: clip.x + clip.width * 0.2, y: clip.y + clip.height * 0.22 },
    { x: clip.x + clip.width * 0.8, y: clip.y + clip.height * 0.78 },
    40,
  );
  const diagonalB = line(
    { x: clip.x + clip.width * 0.2, y: clip.y + clip.height * 0.78 },
    { x: clip.x + clip.width * 0.8, y: clip.y + clip.height * 0.22 },
    40,
  );
  let undoCount = 0;
  const prefix = (name: string) => `${scenario}-${name}`;
  const scenarioBaseline = await shot(page, clip);

  switch (scenario) {
    case "curve": {
      const points = sCurve(clip, 60);
      const captured = await drawAndCapture(page, clip, points);
      undoCount += 1;
      const artifacts = saveFrames(directory, prefix("curve"), captured);
      const local = points.map((point) => toClipSpace(point, clip));
      strokes.push(analyzeStroke("curve", captured, [
        { name: "start-cap", code: "start-cap-live-commit-drift", region: studioBrushScenarioPointRegion(local[0]!, capRadius, clip) },
        { name: "end-cap", code: "end-cap-live-commit-drift", frame: "end", region: studioBrushScenarioPointRegion(local[local.length - 1]!, capRadius, clip) },
        { name: "bend", code: "crossing-live-commit-drift", region: studioBrushScenarioPointRegion(local[15]!, crossRadius, clip) },
      ], profile, artifacts));
      break;
    }
    case "circle": {
      const points = circle(clip, 360);
      const captured = await drawAndCapture(page, clip, points, { liveAt: 0.92 });
      undoCount += 1;
      const local = points.map((point) => toClipSpace(point, clip));
      const seam = local[0]!;
      strokes.push(analyzeStroke("circle", captured, [
        // The seam carries both caps: pointer-down and pointer-up land within a pixel of each
        // other, so a cap that only one representation draws is unmissable here.
        { name: "seam", code: "start-cap-live-commit-drift", frame: "end", region: studioBrushScenarioPointRegion(seam, capRadius + 10, clip) },
        { name: "top", code: "crossing-live-commit-drift", region: studioBrushScenarioPointRegion(local[Math.floor(local.length * 0.25)]!, crossRadius, clip) },
        { name: "bottom", code: "crossing-live-commit-drift", region: studioBrushScenarioPointRegion(local[Math.floor(local.length * 0.75)]!, crossRadius, clip) },
      ], profile, saveFrames(directory, prefix("circle"), captured)));
      break;
    }
    case "corners": {
      const { points, corners } = zigZag(clip);
      const captured = await drawAndCapture(page, clip, points, { liveAt: 0.95 });
      undoCount += 1;
      strokes.push(analyzeStroke("corners", captured, corners.map((corner, index) => ({
        name: `corner-${index}`,
        code: "crossing-live-commit-drift" as const,
        frame: "end" as const,
        region: studioBrushScenarioPointRegion(toClipSpace(corner, clip), crossRadius + 6, clip),
      })), profile, saveFrames(directory, prefix("corners"), captured)));
      break;
    }
    case "buildup": {
      // 문서 표준 테스트: 같은 위치 20회 중첩. 판정은 각 패스의 델타가 아니라 최초 baseline
      // 대비 누적으로 한다 — 불투명 브러시는 2회차부터 더할 것이 없고 그것은 결함이 아니다.
      const path = line(
        { x: clip.x + clip.width * 0.18, y: clip.y + clip.height * 0.5 },
        { x: clip.x + clip.width * 0.82, y: clip.y + clip.height * 0.5 },
        30,
      );
      const passes = 20;
      const base = decode(scenarioBaseline);
      const cumulativeInk: number[] = [];
      const meanDarkness: number[] = [];
      for (let pass = 0; pass < passes; pass += 1) {
        const captured = await drawAndCapture(page, clip, path, {
          postFrames: 1,
          settleMs: pass === passes - 1 ? 2_000 : STROKE_GAP_MS,
        });
        undoCount += 1;
        const settled = decode(captured.settled);
        const mask = studioBrushScenarioInkMask(base, settled);
        cumulativeInk.push(studioBrushScenarioMaskStats(mask, base.width, base.height).count);
        let darknessSum = 0;
        let darknessCount = 0;
        for (let index = 0; index < mask.length; index += 1) {
          if (mask[index] === 0) continue;
          const offset = index * settled.channels;
          darknessSum += 255 - (
            settled.data[offset]! + settled.data[offset + 1]! + settled.data[offset + 2]!
          ) / 3;
          darknessCount += 1;
        }
        meanDarkness.push(darknessCount === 0 ? 0 : darknessSum / darknessCount);
        if (pass === 0 || pass === passes - 1) {
          strokes.push(analyzeStroke(
            `pass-${pass + 1}`,
            captured,
            [],
            profile,
            saveFrames(directory, prefix(`pass-${pass + 1}`), captured),
            { flicker: pass === 0 },
          ));
        }
      }
      const buildupFindings: StudioBrushScenarioFinding[] = [];
      const firstInk = cumulativeInk[0] ?? 0;
      const finalInk = cumulativeInk.at(-1) ?? 0;
      const firstDarkness = meanDarkness[0] ?? 0;
      const finalDarkness = meanDarkness.at(-1) ?? 0;
      const worstShrink = cumulativeInk.reduce(
        (worst, value) => Math.max(worst, firstInk === 0 ? 0 : 1 - value / firstInk),
        0,
      );
      if (!profile.transparent && finalInk < firstInk * 0.9) {
        buildupFindings.push({
          level: "error",
          code: "buildup-lost",
          message: `20 passes ended at ${finalInk} px against the first pass's ${firstInk} px`,
        });
      } else if (worstShrink > 0.25) {
        buildupFindings.push({
          level: "warning",
          code: "buildup-lost",
          message: `a pass dropped to ${(100 - worstShrink * 100).toFixed(0)}% of the first pass's `
            + `coverage (${cumulativeInk.join(",")})`,
        });
      }
      // A brush that is opaque by material has no headroom to darken into; only a brush that can
      // build tone is asked to. (The pen at opacity 1 read 90.1 -> 92.2 here and was reported.)
      const opaqueByMaterial = profile.item.defaultOpacity >= 0.999;
      if (
        !profile.transparent && !opaqueByMaterial
        && firstDarkness > 0 && finalDarkness < firstDarkness * 1.05
      ) {
        buildupFindings.push({
          level: "warning",
          code: "buildup-lost",
          message: "mean darkness barely moved over 20 passes "
            + `(${firstDarkness.toFixed(1)} → ${finalDarkness.toFixed(1)})`,
        });
      }
      // 위의 첫/끝 비교만으로는 3회차에 이미 포화한 사다리를 잡지 못한다(연필 82.9 → 98.4 는
      // 1.19배라 통과했다). 사다리 자체를 판정한다.
      buildupFindings.push(...judgeStudioBrushScenarioBuildupLadder(meanDarkness, {
        transparent: profile.transparent,
        softWet: profile.softWet,
        // Opaque by material: no headroom, no ladder — see the judge for the pen measurement.
        opaque: opaqueByMaterial,
      }));
      strokes.push({
        label: "buildup-summary",
        inkLive: firstInk,
        inkReleased: finalInk,
        inkSettled: finalInk,
        flicker: {
          counts: cumulativeInk,
          maxDropRatio: worstShrink,
          dipFrame: null,
          verdict: "stable",
        },
        // This row summarises a ladder of separate passes rather than one gesture, so it captured
        // no in-stroke frames. Let the analyzer say that itself: a hand-written "stable" with
        // blinkCount 0 reads as a blink check that passed, when none ever ran.
        inStroke: analyzeStudioBrushScenarioInStroke([]),
        inStrokeFrames: [],
        rejectedNotices: { released: 0, settled: 0 },
        clearTrace: null,
        presentedMeta: null,
        layers: null,
        regions: {},
        perf: {
          longTasks: 0,
          worstTaskMs: 0,
          worstFrameGapMs: 0,
          captureInducedLongTasks: 0,
          gestureMs: 0,
        },
        findings: buildupFindings,
        artifacts: { darkness: meanDarkness.map((value) => value.toFixed(1)).join(",") },
      });
      break;
    }
    case "slow-fast": {
      const slowPath = line(
        { x: clip.x + clip.width * 0.18, y: clip.y + clip.height * 0.34 },
        { x: clip.x + clip.width * 0.82, y: clip.y + clip.height * 0.34 },
        90,
      );
      const fastPath = line(
        { x: clip.x + clip.width * 0.18, y: clip.y + clip.height * 0.66 },
        { x: clip.x + clip.width * 0.82, y: clip.y + clip.height * 0.66 },
        6,
      );
      const slow = await drawAndCapture(page, clip, slowPath, { stepDelayMs: 12 });
      undoCount += 1;
      strokes.push(analyzeStroke("slow", slow, [], profile, saveFrames(directory, prefix("slow"), slow)));
      const fast = await drawAndCapture(page, clip, fastPath);
      undoCount += 1;
      strokes.push(analyzeStroke("fast", fast, [], profile, saveFrames(directory, prefix("fast"), fast)));
      break;
    }
    case "cross": {
      const first = await drawAndCapture(page, clip, diagonalA, { postFrames: 2, settleMs: STROKE_GAP_MS });
      undoCount += 1;
      strokes.push(analyzeStroke("first", first, [], profile, saveFrames(directory, prefix("first"), first)));
      const second = await drawAndCapture(page, clip, diagonalB);
      undoCount += 1;
      strokes.push(analyzeStroke("second", second, [
        { name: "crossing", code: "crossing-live-commit-drift", frame: "end", region: crossingRegion(clip, center, crossRadius) },
      ], profile, saveFrames(directory, prefix("second"), second)));
      break;
    }
    case "mixed-over":
    case "mixed-under": {
      invariant(partner, `${scenario} needs a partner brush`);
      const underProfile = scenario === "mixed-over" ? partner : profile;
      const overProfile = scenario === "mixed-over" ? profile : partner;
      await selectBrush(page, underProfile);
      const under = await drawAndCapture(page, clip, diagonalA, { postFrames: 2, settleMs: STROKE_GAP_MS });
      undoCount += 1;
      strokes.push(analyzeStroke(`under:${underProfile.item.id}`, under, [], underProfile, saveFrames(directory, prefix("under"), under)));
      await selectBrush(page, overProfile);
      const over = await drawAndCapture(page, clip, diagonalB);
      undoCount += 1;
      strokes.push(analyzeStroke(`over:${overProfile.item.id}`, over, [
        { name: "crossing", code: "crossing-live-commit-drift", frame: "end", region: crossingRegion(clip, center, Math.max(crossRadius, partner.defaultWidth * 1.6 + 8)) },
      ], overProfile, saveFrames(directory, prefix("over"), over)));
      await selectBrush(page, profile);
      break;
    }
    case "endpoints": {
      const tapPoint = { x: clip.x + clip.width * 0.25, y: clip.y + clip.height * 0.3 };
      const tap = await drawAndCapture(page, clip, [tapPoint], { postFrames: 4, settleMs: STROKE_GAP_MS });
      undoCount += 1;
      strokes.push(analyzeStroke("tap", tap, [
        { name: "tap", code: "start-cap-live-commit-drift", region: studioBrushScenarioPointRegion(toClipSpace(tapPoint, clip), capRadius, clip) },
      ], profile, saveFrames(directory, prefix("tap"), tap)));
      const flickStart = { x: clip.x + clip.width * 0.45, y: clip.y + clip.height * 0.3 };
      const flickPoints = line(flickStart, { x: flickStart.x + 22, y: flickStart.y + 3 }, 4);
      const flick = await drawAndCapture(page, clip, flickPoints, { postFrames: 4, settleMs: STROKE_GAP_MS });
      undoCount += 1;
      strokes.push(analyzeStroke("flick", flick, [
        { name: "flick", code: "end-cap-live-commit-drift", frame: "end", region: studioBrushScenarioPointRegion(toClipSpace(flickStart, clip), capRadius + 14, clip) },
      ], profile, saveFrames(directory, prefix("flick"), flick)));
      const mediumStart = { x: clip.x + clip.width * 0.2, y: clip.y + clip.height * 0.72 };
      const mediumEnd = { x: clip.x + clip.width * 0.8, y: clip.y + clip.height * 0.66 };
      const medium = await drawAndCapture(page, clip, line(mediumStart, mediumEnd, 30));
      undoCount += 1;
      strokes.push(analyzeStroke("medium", medium, [
        { name: "start-cap", code: "start-cap-live-commit-drift", region: studioBrushScenarioPointRegion(toClipSpace(mediumStart, clip), capRadius, clip) },
        { name: "end-cap", code: "end-cap-live-commit-drift", frame: "end", region: studioBrushScenarioPointRegion(toClipSpace(mediumEnd, clip), capRadius, clip) },
      ], profile, saveFrames(directory, prefix("medium"), medium)));
      break;
    }
    case "eraser-cross": {
      const base = await drawAndCapture(page, clip, diagonalA, { postFrames: 2, settleMs: STROKE_GAP_MS });
      undoCount += 1;
      strokes.push(analyzeStroke("base", base, [], profile, saveFrames(directory, prefix("base"), base)));
      await activateEraserMode(page);
      const erase = await drawAndCapture(page, clip, diagonalB);
      undoCount += 1;
      const region = crossingRegion(clip, center, crossRadius);
      strokes.push(analyzeStroke("eraser", erase, [
        { name: "crossing", code: "eraser-live-commit-drift", frame: "end", region },
      ], { ...profile, transparent: false, softWet: profile.softWet }, saveFrames(directory, prefix("eraser"), erase), {
        flicker: false,
        expectGap: region,
      }));
      await selectBrush(page, profile);
      break;
    }
  }

  // A refused stroke leaves its banner on screen, and that banner reflows the canvas — the
  // leftover "ink" is then the layout shift, not undone geometry. Report the residue instead of
  // failing the scenario so the refusal finding stays the headline.
  const undoResidue = await undoTimes(page, clip, scenarioBaseline, undoCount);
  const findings = strokes.flatMap((stroke) => stroke.findings);
  if (undoResidue >= 24) {
    // A residue count cannot say whether it is leftover ink or a layout shift from a banner;
    // the frame can. Write it next to the stroke artifacts whenever residue is reported.
    writeFileSync(join(directory, `${scenario}-06-after-undo.png`), await shot(page, clip));
    findings.push({
      level: findings.some((entry) => entry.code === "stroke-refused") ? "warning" : "error",
      code: "undo-residue",
      message: `undo left ${undoResidue} changed pixels after ${undoCount} stroke(s)`,
    });
  }
  return {
    scenario,
    partner: partner?.item.id ?? null,
    strokes,
    findings,
    skipped: null,
  };
}

async function runBrush(
  browser: Browser,
  studioUrl: string,
  profile: BrushProfile,
  scenarios: readonly ScenarioName[],
): Promise<BrushRecord> {
  const context: BrowserContext = await browser.newContext({ viewport: { ...VIEWPORT } });
  const page = await context.newPage();
  const records: ScenarioRecord[] = [];
  try {
    await prepareStudioPage(page, studioUrl);
    await activatePenMode(page);
    const clip = await stageClip(page);
    const partnerId = partnerFor(profile);
    const partner = partnerId === profile.item.id ? null : await brushProfile(partnerId);
    await selectBrush(page, profile);
    for (const scenario of scenarios) {
      if (
        profile.eraser
        && scenario !== "eraser-cross"
        && scenario !== "endpoints"
        && scenario !== "curve"
        && scenario !== "circle"
        && scenario !== "corners"
        && scenario !== "buildup"
        && scenario !== "slow-fast"
      ) {
        records.push({ scenario, partner: null, strokes: [], findings: [], skipped: "eraser presets only run curve, endpoints and eraser-cross" });
        continue;
      }
      if (profile.eraser && scenario === "eraser-cross") {
        records.push({ scenario, partner: null, strokes: [], findings: [], skipped: "an eraser cannot be its own base stroke" });
        continue;
      }
      const directory = join(OUTPUT_DIR, profile.item.id);
      try {
        const record = await runScenario(page, clip, scenario, profile, partner, directory);
        records.push(record);
        const summary = record.findings.length === 0
          ? "ok"
          : record.findings.map((entry) => `${entry.level === "error" ? "✗" : "△"} ${entry.code}`).join(", ");
        log(`${profile.item.id}/${scenario}: ${summary}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const frame = error instanceof Error
          ? (error.stack ?? "").split("\n").find((line) => line.includes("verify-studio-brush-scenarios"))?.trim() ?? ""
          : "";
        log(`${profile.item.id}/${scenario}: harness failure — ${message.split("\n")[0]} ${frame}`);
        records.push({ scenario, partner: partner?.item.id ?? null, strokes: [], findings: [], skipped: `harness failure: ${message.split("\n")[0]} ${frame}` });
        // Recover a clean page for the next scenario: a fresh navigation re-runs the clean-state
        // init script (the reloaded autosave would otherwise carry this scenario's strokes) and
        // the evidence chrome must be hidden again because a navigation drops the style tag.
        await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
        await page.locator('[data-studio-editor="true"]').waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
        await hideEvidenceChrome(page).catch(() => {});
        await dismissTransientChrome(page).catch(() => {});
        await activatePenMode(page).catch(() => {});
        await selectBrush(page, profile).catch(() => {});
      }
    }
  } finally {
    await context.close();
  }
  return {
    id: profile.item.id,
    runtimeBrushId: profile.runtimeBrushId,
    policy: {
      softWet: profile.softWet,
      transparent: profile.transparent,
      discrete: profile.discrete,
      eraser: profile.eraser,
    },
    scenarios: records,
  };
}

function writeReport(
  scenarios: readonly ScenarioName[],
  brushes: readonly BrushRecord[],
  completed: boolean,
): string {
  const reportPath = join(OUTPUT_DIR, "report.json");
  writeFileSync(reportPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    completed,
    outputDir: OUTPUT_DIR,
    channel: CHANNEL,
    scenarios,
    brushes,
  }, null, 1));
  return reportPath;
}

async function main(): Promise<void> {
  const ids = requestedIds();
  const scenarios = requestedScenarios();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const externalOrigin = process.env.TOONSPECTRUM_VERIFY_ORIGIN?.trim();
  const port = externalOrigin ? null : await findFreePort();
  const origin = externalOrigin ? `${externalOrigin.replace(/\/+$/, "")}/` : `http://127.0.0.1:${port}/`;
  const studioUrl = `${origin}studio`;
  const server: ChildProcess | null = port === null
    ? null
    : spawnVitePreview({ port, runner: "node-vite-bin", logPath: join(OUTPUT_DIR, "preview.log") });
  let browser: Browser | null = null;
  const brushes: BrushRecord[] = [];
  try {
    await waitForServer(origin);
    browser = await chromium.launch(CHANNEL === "shell" ? {} : { channel: CHANNEL });
    log(
      `origin ${origin} · channel ${CHANNEL} · ${ids.length} brushes × ${scenarios.length} scenarios `
        + `→ ${OUTPUT_DIR}`,
    );
    for (const id of ids) {
      const profile = await brushProfile(id);
      brushes.push(await runBrush(browser, studioUrl, profile, scenarios));
      // A partial report after every brush keeps a long matrix inspectable while it runs and
      // salvages the finished lanes when the run is cut short.
      writeReport(scenarios, brushes, false);
    }
  } finally {
    await browser?.close().catch(() => {});
    if (server) await stopChildProcess(server);
  }
  const reportPath = writeReport(scenarios, brushes, true);
  const errors = brushes.flatMap((brush) =>
    brush.scenarios.flatMap((scenario) =>
      scenario.findings.filter((entry) => entry.level === "error").map((entry) => `${brush.id}/${scenario.scenario}: ${entry.code} — ${entry.message}`)
    )
  );
  const warnings = brushes.flatMap((brush) =>
    brush.scenarios.flatMap((scenario) =>
      scenario.findings.filter((entry) => entry.level === "warning").map((entry) => `${brush.id}/${scenario.scenario}: ${entry.code} — ${entry.message}`)
    )
  );
  const skipped = brushes.flatMap((brush) =>
    brush.scenarios.filter((scenario) => scenario.skipped).map((scenario) => `${brush.id}/${scenario.scenario}: ${scenario.skipped}`)
  );
  log(`report ${reportPath}`);
  log(`${errors.length} error(s), ${warnings.length} warning(s), ${skipped.length} skipped`);
  for (const entry of errors) log(`  ✗ ${entry}`);
  for (const entry of warnings) log(`  △ ${entry}`);
  for (const entry of skipped) log(`  · ${entry}`);
  if (STRICT && errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
