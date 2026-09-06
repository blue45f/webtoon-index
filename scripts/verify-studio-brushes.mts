/**
 * Reproducible browser gate for Studio's unified brush catalogue and stroke durability.
 *
 * The harness intentionally drives the shipped UI rather than importing renderer internals:
 * - exactly one desktop built-in catalogue session and no inspector quick-shelf duplicate,
 * - every current built-in preset selected, fast-drawn, visually changed, undone, and redone,
 * - every core preset (or every product preset in opt-in exhaustive mode) survives a sparse
 *   300 px move with visible ink in every route segment and the exact selected runtime brush id
 *   in autosave,
 * - the shipped UI selection list exactly matches the unique full product catalogue, whose core
 *   partition must exactly match BRUSH_PRESETS,
 * - line/rect/ellipse/triangle/polygon Smart Shape gestures persist as the selected brush's exact
 *   snapped outline (rather than reverting to the original freehand gesture), without collapsing
 *   the hand-drawn bounds,
 * - every registered mobile-catalogue brush is exposed and its interactive target is at least
 *   44×44 CSS px,
 * - pointerup alone makes an opaque deferred stroke durable, and a second deferred stroke plus an
 *   immediate navigation survives pagehide through emergency autosave + restore.
 *
 * Run after `pnpm build`:
 *   pnpm verify:studio-brushes
 * Exhaustive full-catalogue long-route audit without repeating the short matrix:
 *   TOONSPECTRUM_ALL_BRUSH_LONG_MATRIX=1 TOONSPECTRUM_BRUSH_LONG_ONLY=1 \
 *     pnpm verify:studio-brushes
 * Focused paint → eraser → paint browser regression (desktop short + core long routes):
 *   TOONSPECTRUM_BRUSH_VERIFY_IDS=perfect-marker,kneaded-eraser,marker \
 *     TOONSPECTRUM_DRAWING_ONLY=1 pnpm verify:studio-brushes
 * Resume one independent product gate after a failure without replaying completed matrices:
 *   TOONSPECTRUM_BRUSH_VERIFY_STAGE=mobile pnpm verify:studio-brushes
 * Screenshots/logs:
 *   TOONSPECTRUM_BRUSH_VERIFY_DIR=/tmp/my-run pnpm verify:studio-brushes
 */
import { type ChildProcess } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { decodePng } from "image-js";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Dialog,
  type Locator,
  type Page,
} from "playwright";

import { isStudioBrushEraserAliasId } from "../apps/web/src/domains/creator/brush/studio-brush-alias-profile";
import { studioBrushPresetUsesIntentionalDiscreteCarrier } from "../apps/web/src/domains/creator/brush/studio-brush-carrier-quality";
import {
  STUDIO_ALL_BRUSH_CATALOG_ITEMS,
  STUDIO_ERASER_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_ERASER_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS,
  STUDIO_PAINT_BRUSH_CATALOG_ITEMS,
  type StudioBrushCatalogItem,
} from "../apps/web/src/domains/creator/brush/studio-brush-catalog";
import { studioBrushCatalogIdIsIntentionallyDiscontinuous } from "../apps/web/src/domains/creator/brush/studio-brush-continuity-audit";
import { serializeStudioBrushDynamicsSettingsCanonical } from "../apps/web/src/domains/creator/brush/studio-brush-dynamics";
import { DEFAULT_STUDIO_BRUSH_SNAPSHOT } from "../apps/web/src/domains/creator/brush/studio-brush-library";
import { studioBrushPackDescriptorById } from "../apps/web/src/domains/creator/brush/studio-brush-pack-index";
import {
  resolveStudioBrushRuntimeContract,
} from "../apps/web/src/domains/creator/brush/studio-brush-runtime-contract";
import {
  materializeStudioBrushCatalogSelection,
  type StudioBrushCatalogSelection,
} from "../apps/web/src/domains/creator/brush/studio-brush-selection";
import { captureStudioDrawPointerPressureContract } from "../apps/web/src/domains/creator/brush/studio-draw-pointer-pressure-contract";
import { classifyStudioDryMediaCatalogIdV1 } from "../apps/web/src/domains/creator/brush/studio-dry-media-anisotropic-grain-v1";
import { studioWetInkBrushDepositsPigment } from "../apps/web/src/domains/creator/brush/studio-wet-ink-brush-runtime";
import { STUDIO_APP_SETTINGS_STORAGE_KEY } from "../apps/web/src/domains/creator/studio-app-settings";
import { studioAutosaveKey } from "../apps/web/src/domains/creator/studio-autosave";
import { BRUSH_PRESETS } from "../apps/web/src/domains/creator/studio-brush";
import {
  resolveStudioCc0MypaintStampTuning,
  studioCc0MypaintPresetUsesIntentionalDiscreteCarrier,
} from "../apps/web/src/domains/creator/studio-cc0-mypaint-preset-import-v1";

import { DIST_DIR } from "./lib/repo-paths.mjs";
import {
  enabledStudioHistoryControl,
} from "./lib/studio-verify-history-controls.mjs";
import {
  cleanScratchDir,
  findFreePort,
  spawnVitePreview,
  stopChildProcess,
  waitForServer,
} from "./lib/studio-verify-preview-harness.mjs";
import {
  analyzeStudioLongBrushQuality,
  studioLongBrushQualityPolicyIsRecordOnly,
  classifyStudioLongBrushQualityPolicy,
  STUDIO_LONG_BRUSH_QUALITY_REPORT_SCHEMA_VERSION,
  type StudioLongBrushQualityResult,
} from "./studio-brush-long-matrix-quality";

const BUILT_IN_BRUSH_PRESET_COUNT = BRUSH_PRESETS.length;
const PRODUCT_BRUSH_CATALOG_COUNT = STUDIO_ALL_BRUSH_CATALOG_ITEMS.length;
const SCRATCH =
  process.env.TOONSPECTRUM_BRUSH_VERIFY_DIR
  ?? process.env.TOONSPECTRUM_VERIFY_DIR
  ?? join(tmpdir(), "toonspectrum-studio-brushes");
const LOG_PATH = join(SCRATCH, "studio-brush-verify.log");
const QUICKSTART_KEY = "toonspectrum-studio-quick-start-dismissed";
const MOBILE_HINT_KEY = "toonspectrum-studio-mobile-hint-dismissed";
const AUTOSAVE_PREFIX = "toonspectrum-studio-autosave";
const AUTOSAVE_KEY = studioAutosaveKey({});
const CLEAN_SESSION_KEY = "toonspectrum-brush-verifier-cleaned";
const OPTIONAL_STATIC_PREVIEW_API_PATHS = [
  "/api/auth/session",
  // The durability audit navigates to the catalogue home as its away-target. That route's data
  // comes from the API (or the static catalogue bundle) which no local preview serves. Excused
  // only on the local preview origin — see expectedStaticPreviewError, which checks the origin
  // and the exact pathname, so /api/home failing on a real deployment still fails the audit.
  "/api/home",
  "/api/kmas/merge-on-access",
  "/api/studio-ai/status",
  "/api/analytics/traffic/page-view",
] as const;
/**
 * Durability timing, both tied to the product's deferred-commit idle flush
 * (DEFERRED_STROKE_COMMIT_IDLE_MS = 200 in StudioPage.tsx). The unload prompt is held BELOW that
 * window so the idle flush cannot author the surviving payload and mask a pointerup write that
 * lost its race with teardown; the receipt budget is the ceiling for a write that is supposed to
 * begin at the input event's microtask checkpoint.
 */
const UNLOAD_PROMPT_HOLD_MS = 150;
/**
 * Also close to the largest useful value, not a tightening: the debounced autosave mirrors a
 * marker-less payload into the same row about 1.7s after pointerup, so a receipt slower than this
 * would find the marker already erased and fail with a worse message.
 */
const RECEIPT_SETTLE_BUDGET_MS = 1_500;
const DEBUG_BRUSH_VERIFIER = process.env.TOONSPECTRUM_DEBUG_BRUSH_VERIFIER === "1";
/** Opt-in diagnostic sweep: keep auditing after a preset fails so one pass lists them all. */
const DESKTOP_SURVEY_MODE = process.env.TOONSPECTRUM_BRUSH_SURVEY === "1";
/**
 * 장획 매트릭스의 시각 불변식을 루프 브레이커가 아니라 집계 실패로 낮춘다.
 *
 * 이 스위치가 없으면 10번째 브러시 하나가 나머지 181개의 증거를 통째로 가린다 — 아래 품질
 * 리포트가 이미 같은 이유로 집계 방식을 쓰고 있다. 서베이가 아닐 때는 동작이 완전히 같다.
 */
const LONG_MATRIX_SURVEY_MODE =
  DESKTOP_SURVEY_MODE || process.env.TOONSPECTRUM_BRUSH_LONG_SURVEY === "1";
const surveyFailures: string[] = [];
const ALL_BRUSH_LONG_MATRIX =
  process.env.TOONSPECTRUM_ALL_BRUSH_LONG_MATRIX === "1";
const REQUESTED_BRUSH_VERIFY_IDS = (process.env.TOONSPECTRUM_BRUSH_VERIFY_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const REQUESTED_BRUSH_VERIFY_ID_SET = new Set(REQUESTED_BRUSH_VERIFY_IDS);
// The matrices drive the shipped UI, so they iterate the LISTED (quarantine-aware) catalogue;
// quarantined ids stay registered for persisted replay but are not selectable choices.
const BRUSH_MATRIX_CATALOG_ITEMS: readonly StudioBrushCatalogItem[] =
  REQUESTED_BRUSH_VERIFY_IDS.length > 0
    ? STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.filter((item) =>
        REQUESTED_BRUSH_VERIFY_ID_SET.has(item.id)
      )
    : STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS;
const BRUSH_MATRIX_CATALOG_COUNT = BRUSH_MATRIX_CATALOG_ITEMS.length;
/** Repeat the complete short-stroke matrix in the SAME page/context, without reloading on success. */
const STABILITY_ROUNDS = Number(process.env.TOONSPECTRUM_BRUSH_STABILITY_ROUNDS ?? "1");
if (!Number.isSafeInteger(STABILITY_ROUNDS) || STABILITY_ROUNDS < 1 || STABILITY_ROUNDS > 20) {
  throw new RangeError("TOONSPECTRUM_BRUSH_STABILITY_ROUNDS must be an integer from 1 to 20");
}
const DESKTOP_STABILITY_CASES = Array.from(
  { length: STABILITY_ROUNDS }, () => BRUSH_MATRIX_CATALOG_ITEMS,
).flat();
const LONG_BRUSH_CATALOG_CANDIDATES: readonly StudioBrushCatalogItem[] =
  ALL_BRUSH_LONG_MATRIX
    ? STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS
    : STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.filter((item) => item.source === "core");
const LONG_BRUSH_CATALOG_ITEMS: readonly StudioBrushCatalogItem[] =
  REQUESTED_BRUSH_VERIFY_IDS.length > 0
    ? LONG_BRUSH_CATALOG_CANDIDATES.filter((item) =>
        REQUESTED_BRUSH_VERIFY_ID_SET.has(item.id)
      )
    : LONG_BRUSH_CATALOG_CANDIDATES;
const LONG_BRUSH_CATALOG_COUNT = LONG_BRUSH_CATALOG_ITEMS.length;
const LONG_BRUSH_MATRIX_MODE =
  REQUESTED_BRUSH_VERIFY_IDS.length > 0
    ? `focused-${LONG_BRUSH_CATALOG_COUNT}`
    : ALL_BRUSH_LONG_MATRIX
      ? `all-${LONG_BRUSH_CATALOG_COUNT}`
      : "core-only";

type VerifierBrushOperation = "paint" | "erase";

interface BrowserErrorCollector {
  messages: string[];
  failedResponses: string[];
}

interface BrushStrokeEvidence {
  id: string;
  source: StudioBrushCatalogItem["source"];
  operation: VerifierBrushOperation;
  selected: boolean;
  visualChanged: boolean;
  eraseLiveOperationActive: boolean | null;
  eraseResidualRatio: number | null;
  undoEnabled: boolean;
  undoRestoredPixels: boolean;
  redoRestoredStroke: boolean;
  persistedOperationMatched: boolean;
  persistedCatalogId: string | null;
  persistedRuntimeBrushId: string | null;
  persistedDynamicsMatched: boolean | null;
}

interface LongBrushStrokeEvidence {
  id: string;
  source: StudioBrushCatalogItem["source"];
  operation: VerifierBrushOperation;
  expectedRuntimeBrushId: string;
  visualChanged: boolean;
  visibleSegments: number;
  totalSegments: number;
  persistedBrushId: string | null;
  persistedMode: "pen" | "eraser";
  persistedCatalogId: string | null;
  persistedDynamicsMatched: boolean | null;
  persistedPathDistance: number;
  undoRestoredPixels: boolean;
  qualityPolicy: StudioLongBrushQualityResult["policy"]["kind"];
  qualityOk: boolean;
}

interface LongBrushArtifactPath {
  absolute: string;
  relativeToScratch: string;
}

interface LongBrushQualityArtifacts {
  baseline: LongBrushArtifactPath;
  live: LongBrushArtifactPath;
  released: LongBrushArtifactPath;
  settled: LongBrushArtifactPath;
}

interface LongBrushQualityEvidence {
  id: string;
  name: string;
  source: StudioBrushCatalogItem["source"];
  runtimeBrushId: string;
  capture: Readonly<{
    clip: Readonly<{ x: number; y: number; width: number; height: number }>;
    localRouteStart: Readonly<{ x: number; y: number }>;
    localRouteEnd: Readonly<{ x: number; y: number }>;
    brushCursorStyle: "none";
    endpointExclusion: Readonly<{
      enabled: false;
      center: { x: number; y: number };
      radius: 0;
    }>;
  }>;
  quality: StudioLongBrushQualityResult;
  artifacts: LongBrushQualityArtifacts;
}

interface PixelDiff {
  changedPixels: number;
  totalPixels: number;
  maxChannelDelta: number;
}

interface PixelCoverage extends PixelDiff {
  visibleSegments: number;
  segmentChangedPixels: number[];
  bounds: { left: number; top: number; right: number; bottom: number } | null;
}

interface EraserLiftRatio {
  affectedPixels: number;
  residualEnergyRatio: number;
}

interface DesktopBrushResult {
  ok: boolean;
  stabilityRounds: number;
  uniquePresetCount: number;
  catalogSessionCount: number;
  catalogDialogCount: number;
  catalogItemCount: number;
  coreCatalogItemCount: number;
  proCatalogItemCount: number;
  inspectorQuickTrayCount: number;
  presetCount: number;
  evidence: BrushStrokeEvidence[];
  screenshot: string;
  catalogScreenshot: string;
  /**
   * Escape hatches, recorded so a receipt produced with one on can never read like a full run:
   * the external-origin skip drops the picker/catalogue equality check, and survey mode keeps
   * going past a failing preset.
   */
  uiCatalogMatchSkipped: boolean;
  surveyMode: boolean;
  errorCount: number;
}

interface LongBrushResult {
  ok: boolean;
  presetCount: number;
  evidence: LongBrushStrokeEvidence[];
  screenshot: string;
  qualityRunDirectory: LongBrushArtifactPath;
  qualityReport: LongBrushArtifactPath;
  qualityPolicyCounts: Readonly<Record<StudioLongBrushQualityResult["policy"]["kind"], number>>;
  /**
   * Measured route coverage, so the receipt records the distribution instead of a universal claim.
   * `continuousMinimumVisibleSegments` is the one that must stay at the full count: a continuous
   * carrier with a gap is a defect, while a discrete carrier is authored to leave gaps.
   */
  totalSegmentsPerTool: number;
  /** Lane sizes travel with the minimums: an empty lane must not report perfect coverage. */
  continuousPolicyTools: number;
  discretePolicyTools: number;
  continuousMinimumVisibleSegments: number;
  discreteMinimumVisibleSegments: number;
  toolsBelowFullCoverage: number;
  errorCount: number;
}

type SmartShapeExpectedKind = "line" | "rect" | "ellipse" | "triangle" | "polygon";

interface SmartShapeEvidence {
  expectedKind: SmartShapeExpectedKind;
  persistedKind: string | null;
  persistedBrush: string | null;
  polygonSides: number | null;
  persistenceMatched: boolean;
  persistenceRepresentation: "brush-outline" | "geometry" | null;
  visualChanged: boolean;
  widthCoverage: number;
  heightCoverage: number;
}

interface SmartShapeResult {
  ok: boolean;
  evidence: SmartShapeEvidence[];
  screenshot: string;
  errorCount: number;
}

interface MobileTouchResult {
  ok: boolean;
  selectionCount: number;
  eraserSelectionCount: number;
  interactiveTargetCount: number;
  minimumWidth: number;
  minimumHeight: number;
  undersized: Array<{ label: string; width: number; height: number }>;
  screenshot: string;
  errorCount: number;
}

interface EmergencyAutosaveRecord {
  key: string;
  pendingStrokeDurability?: {
    kind?: unknown;
    reason?: unknown;
    pageId?: unknown;
    strokeIds?: unknown;
  };
  pagesList?: Array<{ id?: unknown; elements?: Array<{ id?: unknown }> }>;
}

interface DeferredDurabilityResult {
  ok: boolean;
  navigationIssuedInMs: number;
  unloadGuardShown: boolean;
  /** Phase 1, measured on a live page: which authority made the just-released stroke durable. */
  receiptMarkerReason: string;
  receiptSettledInMs: number;
  receiptStrokeCount: number;
  /** Phase 2, measured after teardown: which authority wrote the payload that actually survived. */
  survivorMarkerReason: string;
  survivorStrokeCount: number;
  unloadPromptHeldMs: number;
  payloadContainsEveryStroke: boolean;
  recoveryBannerShown: boolean;
  recoveredPixelsChanged: boolean;
  screenshot: string;
  errorCount: number;
}

function log(message: string): void {
  const line = `[verify-studio-brushes] ${message}`;
  console.log(line);
  try {
    appendFileSync(LOG_PATH, `${line}\n`);
  } catch {
    // The verifier will still fail on the real assertion; diagnostics are best-effort.
  }
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function verifierBrushOperation(
  selection: Pick<
    StudioBrushCatalogSelection,
    "catalogId" | "runtimeBrushId" | "drawMode"
  >,
): VerifierBrushOperation {
  const runtimeContract =
    resolveStudioBrushRuntimeContract(selection.catalogId)
    ?? resolveStudioBrushRuntimeContract(selection.runtimeBrushId);
  const selectionOperation: VerifierBrushOperation =
    selection.drawMode === "eraser" ? "erase" : "paint";
  const contractOperation = runtimeContract?.operation ?? "paint";
  invariant(
    contractOperation === selectionOperation,
    `${selection.catalogId}: runtime operation ${contractOperation} conflicts with `
      + `selection drawMode ${selection.drawMode ?? "pen"}`,
  );
  return contractOperation;
}

function verifierBaselinePaintItem(): StudioBrushCatalogItem {
  const item = STUDIO_ALL_BRUSH_CATALOG_ITEMS.find((candidate) => {
    if (candidate.source !== "core" || candidate.defaultOpacity < 0.95) return false;
    const contract = resolveStudioBrushRuntimeContract(candidate.id);
    return contract?.engine === "causal-ink" && (contract.operation ?? "paint") === "paint";
  });
  invariant(item, "could not resolve an opaque causal paint brush for eraser baselines");
  return item;
}

/**
 * Catalogue dynamics describe the selected library profile; a persisted stroke additionally owns
 * its selected width and the strictest artist/family/profile geometry floor. Keep the browser oracle
 * on that complete replay contract so exact canonical equality still catches every stale tip,
 * pipeline, mapping, scatter and pressure field without mistaking intentional stroke-local capture
 * for catalogue drift.
 */
function expectedPersistedDynamicsForDefaultSelection(
  selection: StudioBrushCatalogSelection,
) {
  if (!selection.brushDynamics) return null;
  const captured = captureStudioDrawPointerPressureContract({
    drawMode: "pen",
    brush: selection.runtimeBrushId,
    brushDynamics: selection.brushDynamics,
    pressureMinSize: DEFAULT_STUDIO_BRUSH_SNAPSHOT.pressureMinSize,
    strokeWidth: selection.defaultWidth,
  }, true).brushDynamics;
  invariant(
    captured,
    `${selection.catalogId}: catalogue dynamics did not produce a persisted stroke contract`,
  );
  return captured;
}

function assertProductBrushCatalogContract(): {
  presetCount: number;
  catalogItemCount: number;
  coreCatalogItemCount: number;
  proCatalogItemCount: number;
} {
  const presetIds = BRUSH_PRESETS.map((preset) => preset.id);
  const catalogIds = STUDIO_ALL_BRUSH_CATALOG_ITEMS.map((item) => item.id);
  const catalogNames = STUDIO_ALL_BRUSH_CATALOG_ITEMS.map((item) => item.name);
  const coreCatalogItems = STUDIO_ALL_BRUSH_CATALOG_ITEMS
    .filter((item) => item.source === "core");
  const coreCatalogIds = coreCatalogItems.map((item) => item.id);
  const proCatalogIds = STUDIO_ALL_BRUSH_CATALOG_ITEMS
    .filter((item) => item.source === "pro")
    .map((item) => item.id);
  const presetById = new Map(BRUSH_PRESETS.map((preset) => [preset.id, preset]));

  invariant(presetIds.length > 0, "BRUSH_PRESETS must not be empty");
  invariant(catalogIds.length > 0, "the product brush catalogue must not be empty");
  invariant(
    new Set(presetIds).size === presetIds.length,
    "BRUSH_PRESETS contains duplicate ids",
  );
  invariant(
    new Set(catalogIds).size === catalogIds.length,
    "the full product brush catalogue contains duplicate ids",
  );
  invariant(
    new Set(catalogNames).size === catalogNames.length,
    "the full product brush catalogue contains duplicate names, making UI selections ambiguous",
  );
  invariant(
    coreCatalogIds.length === presetIds.length
      && coreCatalogIds.every((id) => presetById.has(id)),
    "the product catalogue core partition does not contain exactly the BRUSH_PRESETS ids",
  );
  invariant(
    coreCatalogItems.every((item) => {
      const preset = presetById.get(item.id);
      return preset?.name === item.name
        && preset.defaultWidth === item.defaultWidth
        && preset.defaultOpacity === item.defaultOpacity;
    }),
    "the product catalogue core metadata has drifted from BRUSH_PRESETS",
  );
  invariant(
    catalogIds.length === coreCatalogIds.length + proCatalogIds.length,
    "the product catalogue contains an item outside the core/pro partitions",
  );
  invariant(
    new Set(REQUESTED_BRUSH_VERIFY_IDS).size === REQUESTED_BRUSH_VERIFY_IDS.length,
    "TOONSPECTRUM_BRUSH_VERIFY_IDS contains duplicate ids",
  );
  invariant(
    BRUSH_MATRIX_CATALOG_COUNT === REQUESTED_BRUSH_VERIFY_ID_SET.size
      || REQUESTED_BRUSH_VERIFY_IDS.length === 0,
    "TOONSPECTRUM_BRUSH_VERIFY_IDS contains an unknown product brush id",
  );
  invariant(
    JSON.stringify(catalogIds) === JSON.stringify([...coreCatalogIds, ...proCatalogIds]),
    "the product catalogue no longer exposes the ordered core-then-pro selection contract",
  );

  return {
    presetCount: presetIds.length,
    catalogItemCount: catalogIds.length,
    coreCatalogItemCount: coreCatalogIds.length,
    proCatalogItemCount: proCatalogIds.length,
  };
}

/** Every absolute URL a console line or failed-response line mentions. */
function messageUrls(message: string): URL[] {
  const urls: URL[] = [];
  for (const token of message.split(/\s+/u)) {
    try {
      urls.push(new URL(token));
    } catch {
      // Not a URL token — console text is mostly prose.
    }
  }
  return urls;
}

function expectedStaticPreviewError(message: string, studioUrl: string): boolean {
  let previewUrl: URL;
  try {
    previewUrl = new URL(studioUrl);
  } catch {
    return false;
  }
  if (
    previewUrl.protocol !== "http:"
    || previewUrl.hostname !== "127.0.0.1"
    || previewUrl.port.length === 0
  ) {
    return false;
  }

  // Scoped to this local preview's own origin and matched on exact pathname. A substring test ran
  // before the guard above and so excused these paths on ANY origin in every stage — including
  // runs against a real deployment, where a genuine 500 must always fail the audit.
  if (
    messageUrls(message).some((url) =>
      url.origin === previewUrl.origin
      && (OPTIONAL_STATIC_PREVIEW_API_PATHS as readonly string[]).includes(url.pathname)
    )
  ) return true;

  const socketUrl =
    `ws://127.0.0.1:${previewUrl.port}/socket.io/?EIO=4&transport=websocket`;
  const expectedMessages = [
    `WebSocket connection to '${socketUrl}' failed: Connection closed before receiving a handshake response`,
    `WebSocket connection to '${socketUrl}' failed: Error during WebSocket handshake: Unexpected response code: 400`,
  ];
  if (expectedMessages.includes(message)) return true;

  const sourcePrefix = expectedMessages
    .map((expectedMessage) => `${expectedMessage} @ `)
    .find((source) => message.startsWith(source));
  if (!sourcePrefix) return false;
  try {
    const sourceUrl = new URL(message.slice(sourcePrefix.length));
    return sourceUrl.origin === previewUrl.origin
      && /^\/assets\/[A-Za-z0-9._-]+\.js$/u.test(sourceUrl.pathname)
      && sourceUrl.search === ""
      && sourceUrl.hash === "";
  } catch {
    return false;
  }
}

/**
 * Third-party webfont/CDN stylesheet hosts whose fetch failures are environment noise, not app
 * defects: an offline or proxied audit machine cannot reach them, the app's font stacks all carry
 * real fallbacks, and no brush-geometry or layout gate in this file measures glyph rendering.
 * Scoped to resource-load console errors on exactly these hosts so a same-origin asset failure —
 * the thing this collector exists to catch — still fails the audit.
 */
const EXTERNAL_FONT_CDN_HOSTS: ReadonlySet<string> = new Set([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
]);

function expectedExternalFontCdnError(message: string): boolean {
  return message.includes("Failed to load resource")
    && messageUrls(message).some((url) => EXTERNAL_FONT_CDN_HOSTS.has(url.hostname));
}

function collectBrowserErrors(
  page: Page,
  label: string,
  studioUrl: string,
): BrowserErrorCollector {
  const collector: BrowserErrorCollector = { messages: [], failedResponses: [] };
  page.on("console", (entry) => {
    if (entry.type() !== "error") return;
    const location = entry.location().url;
    const message = location ? `${entry.text()} @ ${location}` : entry.text();
    if (
      !expectedStaticPreviewError(message, studioUrl)
      && !expectedExternalFontCdnError(message)
    ) {
      collector.messages.push(`${label}: ${message}`);
    }
  });
  page.on("pageerror", (error) => collector.messages.push(
    `${label}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
  ));
  page.on("response", (response) => {
    if (response.status() < 500) return;
    const message = `${response.status()} ${response.url()}`;
    if (!expectedStaticPreviewError(message, studioUrl)) {
      collector.failedResponses.push(`${label}: ${message}`);
    }
  });
  return collector;
}

async function captureBrushStageFailure(
  page: Page,
  stage: string,
  error: unknown,
  browserErrors: BrowserErrorCollector,
): Promise<void> {
  await page.screenshot({ path: join(SCRATCH, `studio-brush-${stage}-failure.png`) })
    .catch(() => undefined);
  writeFileSync(join(SCRATCH, `studio-brush-${stage}-failure.json`), JSON.stringify({
    ok: false,
    stage,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
    browserErrors,
    requestedRounds: STABILITY_ROUNDS,
    uniquePresetCount: BRUSH_MATRIX_CATALOG_COUNT,
  }, null, 2));
}

function reportBrowserErrors(collector: BrowserErrorCollector): void {
  for (const message of collector.messages.slice(0, 10)) log(`browser error: ${message}`);
  for (const message of collector.failedResponses.slice(0, 10)) log(`failed response: ${message}`);
}

async function installCleanStudioState(page: Page): Promise<void> {
  // tsx가 keep-names로 트랜스파일한 함수를 page.evaluate 로 직렬화하면 esbuild 의 `__name`
  // 헬퍼 호출이 함수 본문에 남는다. 브라우저 컨텍스트에는 그 헬퍼가 없으므로 여기서
  // 항등 함수로 채운다(문자열 스크립트라 트랜스파일 대상이 아니다). 앱 코드는 번들이
  // 자체 헬퍼를 인라인하므로 영향이 없다.
  await page.addInitScript({
    content:
      "globalThis.__name ??= (fn) => fn;"
      // 실링 진단 확장(union/표면/캔버스 검열)은 감사 세션에서만 계산되도록 오버레이가
      // 이 플래그를 게이트로 삼는다 — 제품 사용자는 절대 비용을 내지 않는다.
      + " globalThis.__studioDynamicSealDebugEnabled = true;",
  });
  await page.addInitScript(
    ({
      autosavePrefix,
      cleanSessionKey,
      mobileHintKey,
      quickstartKey,
      studioAppSettingsKey,
      debugPerfectInk,
    }) => {
      try {
        window.localStorage.setItem(quickstartKey, "1");
        window.localStorage.setItem(mobileHintKey, "1");
        // Quality screenshots must contain ink only. Persist this verifier-only preference before
        // Studio reads settings so the live pointer-down frame cannot include a Konva cursor whose
        // size/softness varies by brush and then disappears from released/settled frames.
        let persistedSettings: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(
            window.localStorage.getItem(studioAppSettingsKey) ?? "{}",
          ) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            persistedSettings = parsed as Record<string, unknown>;
          }
        } catch {
          // A malformed verifier profile is replaced by the canonical partial preference below.
        }
        const persistedGeneral = (
          persistedSettings.general
          && typeof persistedSettings.general === "object"
          && !Array.isArray(persistedSettings.general)
        )
          ? persistedSettings.general as Record<string, unknown>
          : {};
        window.localStorage.setItem(
          studioAppSettingsKey,
          JSON.stringify({
            ...persistedSettings,
            general: {
              ...persistedGeneral,
              brushCursorStyle: "none",
            },
          }),
        );
        if (debugPerfectInk) {
          (window as { __debugPerfectInk?: boolean }).__debugPerfectInk = true;
        }
        // Init scripts run before every navigation. Clear stale data only once per tab so the
        // durability scenario can navigate away and return without deleting its emergency save.
        if (window.sessionStorage.getItem(cleanSessionKey) !== "1") {
          for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
            const key = window.localStorage.key(index);
            if (key?.startsWith(autosavePrefix)) window.localStorage.removeItem(key);
          }
          window.sessionStorage.setItem(cleanSessionKey, "1");
        }
      } catch {
        // Studio itself handles unavailable storage; the visible assertions below remain strict.
      }
    },
    {
      autosavePrefix: AUTOSAVE_PREFIX,
      cleanSessionKey: CLEAN_SESSION_KEY,
      mobileHintKey: MOBILE_HINT_KEY,
      quickstartKey: QUICKSTART_KEY,
      studioAppSettingsKey: STUDIO_APP_SETTINGS_STORAGE_KEY,
      debugPerfectInk: DEBUG_BRUSH_VERIFIER,
    },
  );
}

/**
 * Onboarding chrome is restored from the SQLite preference store, so on the mobile layout it
 * mounts a beat after the editor is interactive — after the seeded localStorage flags have
 * already been read — and then swallows every tap. The starter closes through its own Close
 * control; modal wizards (quick comic) close on Escape, exactly as a person would dismiss them.
 * Both leave the editor in its normal state instead of forcing gestures through overlay chrome.
 */
async function dismissQuickStartOverlay(page: Page, appearTimeoutMs: number): Promise<void> {
  const modalOverlay = page.locator('[data-studio-quick-comic-overlay="true"]');
  if (
    await modalOverlay.first().isVisible().catch(() => false)
  ) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
  const backdrop = page.locator('[data-studio-quickstart-backdrop="true"]');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // isVisible() resolves immediately, so the starter must be awaited explicitly: it arrives
    // only after the preference store reconciles, well past the editor becoming interactive.
    const appeared = await backdrop
      .first()
      .waitFor({ state: "visible", timeout: attempt === 0 ? appearTimeoutMs : 600 })
      .then(() => true)
      .catch(() => false);
    if (!appeared) return;
    await backdrop.first().click({ timeout: 2_000, force: true }).catch(() => undefined);
    await page.waitForTimeout(200);
    if (await modalOverlay.first().isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
  }
}

/**
 * Onboarding chrome can mount at any point once the preference store reconciles, so a single
 * dismissal before the gesture is not enough: it may arrive between the dismissal and the tap.
 * Retrying the tap with a dismissal in between keeps the audit measuring the editor rather than
 * racing its overlays, and still fails loudly if the control never becomes reachable.
 */
async function clickPastTransientOverlays(page: Page, target: Locator): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const clicked = await target
      .click({ timeout: attempt === 3 ? 7_000 : 2_500 })
      .then(() => true)
      .catch(() => false);
    if (clicked) return;
    await dismissQuickStartOverlay(page, 500);
  }
  await target.click({ timeout: 7_000 });
}

async function dismissTransientChrome(page: Page, clearAutosave = true): Promise<void> {
  const quickstart = page.locator('[data-studio-creative-starter="true"]');
  if (await quickstart.isVisible({ timeout: 250 }).catch(() => false)) {
    await quickstart.locator('[data-studio-quickstart-dismiss="true"]').click();
  }
  await dismissQuickStartOverlay(page, 250);
  if (
    clearAutosave
    && await page.getByText("이전에 작성 중이던 임시저장 데이터가 있습니다.", { exact: false })
      .isVisible({ timeout: 250 })
      .catch(() => false)
  ) {
    await page.getByRole("button", { name: "비우기", exact: true }).click();
  }
}

async function prepareStudioPage(page: Page, studioUrl: string): Promise<void> {
  page.setDefaultTimeout(7_000);
  await installCleanStudioState(page);
  await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.locator('[data-studio-editor="true"]').waitFor({ state: "visible", timeout: 12_000 });
  // Hide transient evidence chrome before any gesture. Moving the pointer or waiting after
  // pointerup would skip the exact live-to-retained boundary this verifier must measure.
  await page.addStyleTag({
    content: [
      '[data-studio-brush-hud="true"] { display: none !important; }',
      // The Konva brush-cursor ring is transient chrome, not document ink; hiding its dedicated
      // canvas keeps live-gesture energy measurements about pigment only.
      'canvas[data-studio-brush-cursor-canvas="true"] { display: none !important; }',
    ].join("\n"),
  });
  await dismissTransientChrome(page);
  const shellState = await page.evaluate(() => ({
    bodyTextLength: document.body.innerText.trim().length,
    hasErrorOverlay: Boolean(
      document.querySelector("vite-error-overlay, .vite-error-overlay, #webpack-dev-server-client-overlay")
    ),
  }));
  invariant(shellState.bodyTextLength > 0, "Studio rendered a blank document");
  invariant(!shellState.hasErrorOverlay, "Vite error overlay is visible");
}

async function activateDesktopPen(page: Page): Promise<void> {
  const penRail = page.locator('button[data-studio-rail-tool-id="pen"]');
  if (await penRail.count() > 0) {
    await penRail.first().click();
  } else {
    await page.keyboard.press("b");
  }
  const toolbar = page.locator('[data-studio-draw-options="true"]');
  await toolbar.waitFor({ state: "visible", timeout: 8_000 });
  const pen = toolbar.getByRole("button", { name: "펜", exact: true });
  if (await pen.count() > 0 && (await pen.getAttribute("aria-pressed") !== "true")) {
    await pen.click();
  }
  await page.locator('[data-studio-brush-active-pill="true"]').waitFor({ state: "visible" });

  const inspectorNavigator = page.getByTestId("studio-inspector-navigator");
  await inspectorNavigator.waitFor({ state: "visible" });
  const propertiesTab = inspectorNavigator.locator(
    '[data-studio-inspector-primary-tab="properties"]',
  );
  if (await propertiesTab.getAttribute("aria-selected") !== "true") await propertiesTab.click();
}

async function activateDesktopEraser(page: Page): Promise<void> {
  await page.keyboard.press("e");
  const toolbar = page.locator('[data-studio-draw-options="true"]');
  await toolbar.waitFor({ state: "visible", timeout: 8_000 });
  await page.waitForFunction(() =>
    document.querySelector('[data-studio-draw-options="true"]')
      ?.getAttribute("data-studio-active-draw-mode") === "eraser"
  );
  await toolbar.locator('[data-studio-brush-active-pill="true"]').waitFor({
    state: "visible",
  });
}

async function ensureDesktopBrushCatalogTrigger(page: Page): Promise<Locator> {
  const toolbar = page.locator('[data-studio-draw-options="true"]');
  await toolbar.waitFor({ state: "visible", timeout: 8_000 });
  let pill = toolbar.locator('[data-studio-brush-active-pill="true"]');
  if (await pill.count() === 0) {
    const pen = toolbar.getByRole("button", { name: "펜", exact: true });
    await pen.click();
    await page.waitForFunction(() =>
      document.querySelector('[data-studio-draw-options="true"]')
        ?.getAttribute("data-studio-active-draw-mode") === "pen"
    );
    pill = toolbar.locator('[data-studio-brush-active-pill="true"]');
    await pill.waitFor({ state: "visible" });
  }
  return pill;
}

async function openDesktopCatalog(page: Page): Promise<Locator> {
  await (await ensureDesktopBrushCatalogTrigger(page)).click();
  const catalog = page.locator('[data-studio-brush-catalog-session="true"]');
  await catalog.waitFor({ state: "visible" });
  invariant(await catalog.count() === 1, "desktop opened more than one built-in catalogue session");
  invariant(
    await page.locator('[role="dialog"][data-studio-brush-floating]').count() === 1,
    "desktop must expose exactly one floating built-in catalogue dialog",
  );
  invariant(
    await catalog.getAttribute("role") === "region"
      && await page.locator('[data-studio-brush-floating]')
        .locator('[data-studio-brush-catalog-session="true"]').count() === 1,
    "desktop catalogue region must belong to the unique floating dialog",
  );
  return catalog;
}

/** Desktop selection deliberately keeps its floating library open for repeated picking. */
async function closeDesktopCatalog(page: Page, catalog: Locator): Promise<void> {
  const dialog = page.locator('[role="dialog"][data-studio-brush-floating]');
  await dialog.getByRole("button", { name: / 닫기$/u }).click();
  await catalog.waitFor({ state: "detached" });
  await dialog.waitFor({ state: "detached" });
}

async function expandFullBrushCatalog(catalog: Locator): Promise<void> {
  // The product UI progressively mounts large catalogues so 200+ SVG previews do not block
  // the first open. Move the actual scrollport to its observer sentinel and require one bounded
  // batch of progress before repeating; a detached observer or stale sentinel fails closed.
  const deadline = Date.now() + 15_000;
  const scrollport = catalog.locator(
    '[data-studio-brush-catalog-scrollport="true"]',
  );
  const selections = catalog.locator('button[aria-label$=" 선택"]');
  let previousCount = await selections.count();
  for (let batchIndex = 0; batchIndex < 20; batchIndex += 1) {
    const sentinel = catalog.locator(
      '[data-studio-brush-progressive-sentinel="true"]',
    );
    if (await sentinel.count() === 0) return;
    invariant(Date.now() < deadline, "brush catalogue progressive reveal exceeded its deadline");
    await scrollport.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const remainingTime = Math.max(250, deadline - Date.now());
    try {
      await selections.nth(previousCount).waitFor({
        state: "attached",
        timeout: remainingTime,
      });
    } catch {
      const stalledCount = await selections.count();
      invariant(
        stalledCount > previousCount,
        `brush catalogue made no progressive reveal progress at ${previousCount} items`,
      );
    }
    const currentCount = await selections.count();
    invariant(
      currentCount > previousCount,
      `brush catalogue repeated a sentinel cycle without progress at ${previousCount} items`,
    );
    previousCount = currentCount;
  }
  invariant(
    await catalog.locator(
      '[data-studio-brush-progressive-sentinel="true"]',
    ).count() === 0,
    "brush catalogue still has hidden pages after the bounded expansion audit",
  );
}

async function assertUiBrushCatalogMatchesProductCatalog(
  catalog: Locator,
  expectedCatalogItems: readonly StudioBrushCatalogItem[],
  operationLabel: "paint" | "erase",
): Promise<void> {
  await catalog.getByRole("tab", { name: "전체", exact: true }).click();
  await catalog.getByRole("searchbox").fill("");
  await expandFullBrushCatalog(catalog);
  const expectedSelections = expectedCatalogItems.map((item) => ({
    label: `${item.name} 선택`,
    source: item.source,
  }));
  const actualSelections = await catalog
    .locator('button[aria-label$=" 선택"]')
    .evaluateAll((buttons) => buttons.map((button) => ({
      label: button.getAttribute("aria-label") ?? "",
      source: button.closest("[data-studio-brush-source]")
        ?.getAttribute("data-studio-brush-source") ?? "",
    })));
  const actualLabels = actualSelections.map((selection) => selection.label);

  if (actualSelections.length !== expectedCatalogItems.length) {
    const actualSet = new Set(actualLabels);
    const missing = expectedSelections
      .filter((selection) => !actualSet.has(selection.label))
      .map((selection) => selection.label);
    const expectedSet = new Set(expectedSelections.map((s) => s.label));
    const unexpected = actualLabels.filter((label) => !expectedSet.has(label));
    console.log(`[verify-studio-brushes] MISSING(${missing.length}): ${missing.join(" | ")}`);
    console.log(`[verify-studio-brushes] UNEXPECTED(${unexpected.length}): ${unexpected.join(" | ")}`);
  }
  invariant(
    actualSelections.length === expectedCatalogItems.length,
    `desktop ${operationLabel} catalogue exposes ${actualSelections.length}/${expectedCatalogItems.length} product choices`,
  );
  invariant(
    new Set(actualLabels).size === actualLabels.length,
    "desktop catalogue exposes duplicate or ambiguous selection labels",
  );
  invariant(
    JSON.stringify(actualSelections) === JSON.stringify(expectedSelections),
    `desktop ${operationLabel} catalogue selection order/source does not exactly match its product partition`,
  );
}

async function assertUiEraserQuickPickerMatchesProductCatalog(
  catalog: Locator,
): Promise<void> {
  await catalog.getByRole("tab", { name: "전체", exact: true }).click();
  await catalog.getByRole("searchbox").fill("");
  const actualIds = await catalog
    .locator("[data-studio-eraser-quick-option]")
    .evaluateAll((buttons) => buttons.map((button) =>
      button.getAttribute("data-studio-eraser-quick-option") ?? ""));
  const expectedIds = STUDIO_LISTED_ERASER_BRUSH_CATALOG_ITEMS.map((item) => item.id);
  invariant(
    JSON.stringify(actualIds) === JSON.stringify(expectedIds),
    `desktop erase quick picker exposes ${actualIds.join(",") || "no choices"}; expected ${expectedIds.join(",")}`,
  );
}

async function selectDesktopBrush(
  page: Page,
  preset: Pick<StudioBrushCatalogItem, "id" | "name">,
  selection?: StudioBrushCatalogSelection,
): Promise<void> {
  const expectedSelection =
    selection ?? await materializeStudioBrushCatalogSelection(preset.id);
  invariant(expectedSelection, `${preset.id}: catalogue selection did not materialize`);
  const operation = verifierBrushOperation(expectedSelection);
  const expectedDrawMode = operation === "erase" ? "eraser" : "pen";
  if (operation === "erase") {
    await activateDesktopEraser(page);
  } else {
    await page.keyboard.press("b");
    await page.waitForFunction(() =>
      document.querySelector('[data-studio-draw-options="true"]')
        ?.getAttribute("data-studio-active-draw-mode") === "pen"
    );
  }
  const catalog = await openDesktopCatalog(page);
  await catalog.getByRole("tab", { name: "전체", exact: true }).click();
  await catalog.getByRole("searchbox").fill(preset.name);
  const option = catalog.getByRole("button", { name: `${preset.name} 선택`, exact: true });
  await option.waitFor({ state: "visible" });
  await option.scrollIntoViewIfNeeded();
  await option.click();
  await page.waitForFunction((id) => {
    const button = document.querySelector<HTMLButtonElement>(
      `[data-studio-brush-select="${id}"]`,
    );
    return Boolean(button && !button.disabled && button.getAttribute("aria-busy") !== "true");
  }, preset.id);
  await page.waitForFunction(
    ({ drawMode }) => document
      .querySelector('[data-studio-draw-options="true"]')
      ?.getAttribute("data-studio-active-draw-mode") === drawMode,
    { drawMode: expectedDrawMode },
    { timeout: 15000 },
  );
  await page.waitForFunction(
    ({ expectedName }) => document
      .querySelector('[data-studio-brush-active-pill="true"]')
      ?.getAttribute("aria-label")
      ?.includes(expectedName) === true,
    { expectedName: preset.name },
  );
  // Wait for the asynchronous profile selection BEFORE closing its host; closing early cancels it.
  await closeDesktopCatalog(page, catalog);
  if (operation === "erase") {
    invariant(
      await page.locator(
        '[data-studio-brush-active-pill="true"][data-studio-active-tool-summary="eraser"]',
      ).count() === 1,
      `${preset.id}: named eraser selection did not expose its active brush identity`,
    );
  }
}

async function enabledHistoryButton(page: Page, ariaLabel: "실행취소" | "다시실행"): Promise<Locator> {
  return enabledStudioHistoryControl(page, ariaLabel === "실행취소" ? "undo" : "redo");
}

/**
 * Deterministic 32-bit FNV-1a over an id. The gesture below is derived from THIS and nothing else,
 * which is the whole point: a brush's verdict must not move when a different brush is added or
 * delisted. The previous scheme keyed the grid cell AND the direction off the preset's INDEX in
 * the listed catalogue, so delisting one id shifted every later preset onto a different cell and a
 * different dy sign — a gate whose result changes when an unrelated brush is delisted is not
 * measuring the brush. (The length lesson had already been learned here; the direction and the
 * cell had not.) Hashing the id also makes `TOONSPECTRUM_BRUSH_VERIFY_IDS=<id>` reproduce the full
 * run's gesture exactly, which the index scheme could not: a focused run put every preset at
 * index 0.
 */
function strokeIdentityHash(seed: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

/** Independent [0,1) streams off one id, salted so cell/direction/shape never correlate. */
function strokeIdentityUnit(presetId: string, salt: string): number {
  return strokeIdentityHash(`${salt}:${presetId}`) / 0x1_0000_0000;
}

/** The historical continuous flick: 9 px of travel with a 2-3 px cross component. */
const CONTINUOUS_GESTURE_LENGTH_PX = 9;
/** The historical discrete reach (6 x the flick). No carrier's gesture may fall below it. */
const DISCRETE_GESTURE_MINIMUM_LENGTH_PX = 54;
/**
 * Stations a discrete carrier's gesture must span — the first mark plus two more. Three is the
 * smallest count that survives the failure this replaces: with one station the verdict is decided
 * by where that single dab's scatter and radius jitter happened to land, which is exactly how
 * mypaint-cc0--splatter (spacing 4 diameters = 168 px at its 42 px default width) produced ZERO
 * changed pixels under both a 54 px and a 90 px flick. Three stations also make the short route no
 * weaker than the long route, which already proves that carrier paints over 300 px.
 */
const DISCRETE_GESTURE_STATIONS = 3;

/**
 * Distance between two of a discrete carrier's own marks, in CSS px, from the preset's own
 * authored spacing — never a flat multiplier. The engine walks `2 · pressureRadius · spacingRatio`,
 * so full-pressure spacing is `diameter · spacingRatio`; taking the full-size (pressure 1) value
 * is the conservative end, since a smaller radius only packs the marks closer together.
 */
function discreteStationSpacingPx(
  presetId: string,
  selection: StudioBrushCatalogSelection,
): number {
  const cc0 = resolveStudioCc0MypaintStampTuning(presetId);
  if (cc0) return selection.defaultWidth * cc0.spacingRatio;
  const dynamics = selection.brushDynamics;
  // `spacing.base` is already the px projection of the dab spacing (width.base · spacingRatio).
  if (dynamics && dynamics.spacing.base > 0) return dynamics.spacing.base;
  if (dynamics?.spacingRatio) return selection.defaultWidth * dynamics.spacingRatio;
  // No authored spacing to read: fall back to one diameter, which is the very threshold the
  // discrete classifiers use, so the fallback can never claim a denser carrier than reality.
  return selection.defaultWidth;
}

/**
 * Keeps one axis of the gesture inside the exposed paper WITHOUT shortening it. The measurement is
 * the gesture; the cell only spreads the matrix over the paper, so when a cell has no room the
 * cell moves, never the length. Fails loudly if the paper cannot hold the gesture at all — a gate
 * that silently truncated it would quietly stop proving what it claims.
 */
function fitStrokeAxis(
  start: number,
  delta: number,
  low: number,
  high: number,
  presetId: string,
): { start: number; delta: number } {
  invariant(
    Math.abs(delta) <= high - low,
    `${presetId}: gesture needs ${Math.abs(delta).toFixed(0)}px but the exposed paper offers `
      + `${(high - low).toFixed(0)}px on this axis`,
  );
  if (start + delta >= low && start + delta <= high) return { start, delta };
  if (start - delta >= low && start - delta <= high) return { start, delta: -delta };
  return { start: delta > 0 ? high - delta : low - delta, delta };
}

function strokePoint(
  box: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  preset: StudioBrushCatalogItem,
  selection: StudioBrushCatalogSelection,
  /**
   * Intentionally discrete carriers (splatter, glint, repeated stamps) place scatter stations
   * along the path instead of a continuous bed, so a 9 px flick can legitimately land between two
   * stations and deposit nothing. Those presets get a longer — still one fast, undwelt move —
   * gesture so the visibility assertion keeps its meaning instead of being skipped.
   */
  intentionalDiscreteCarrier = false,
): { x: number; y: number; dx: number; dy: number } {
  // Konva intentionally extends behind the side inspectors and bottom dock. Keep evidence in the
  // central exposed surface; elementFromPoint below additionally proves every gesture hits canvas.
  // The evidence clip is clamped to this same rectangle, so the two cannot drift apart.
  const {
    left: safeLeft,
    right: safeRight,
    top: safeTop,
    bottom: safeBottom,
  } = canvasSafeRect(box, viewport);
  invariant(safeRight - safeLeft >= 260, "visible canvas is too narrow for the brush grid");
  invariant(safeBottom - safeTop >= 220, "visible canvas is too short for the brush grid");
  const length = intentionalDiscreteCarrier
    ? Math.max(
        DISCRETE_GESTURE_MINIMUM_LENGTH_PX,
        Math.ceil(
          (DISCRETE_GESTURE_STATIONS - 1) * discreteStationSpacingPx(preset.id, selection),
        ),
      )
    : CONTINUOUS_GESTURE_LENGTH_PX;
  // The two shapes the matrix has always drawn (9x3 and 9x-2), now chosen by identity instead of
  // by `index % 3`, and scaled to the length above so a sparse carrier's gesture is the same
  // picture, just long enough to contain its own stations.
  const slope = strokeIdentityUnit(preset.id, "slope") < 0.5 ? 3 / 9 : 2 / 9;
  const signedLength = strokeIdentityUnit(preset.id, "dx") < 0.5 ? length : -length;
  const signedCross = Math.max(1, Math.round(length * slope))
    * (strokeIdentityUnit(preset.id, "dy") < 0.5 ? 1 : -1);
  const cell = {
    x: safeLeft + (safeRight - safeLeft) * strokeIdentityUnit(preset.id, "column"),
    y: safeTop + (safeBottom - safeTop) * strokeIdentityUnit(preset.id, "row"),
  };
  const horizontal = fitStrokeAxis(cell.x, signedLength, safeLeft, safeRight, preset.id);
  const vertical = fitStrokeAxis(cell.y, signedCross, safeTop, safeBottom, preset.id);
  return {
    x: Math.round(horizontal.start),
    y: Math.round(vertical.start),
    dx: horizontal.delta,
    dy: vertical.delta,
  };
}

/**
 * The exposed paper — the rectangle strokePoint aims into. Konva extends behind the side
 * inspectors and the bottom dock, so this trims the editor chrome that overlaps the stage.
 */
function canvasSafeRect(
  box: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; right: number; top: number; bottom: number } {
  return {
    left: Math.max(Math.max(0, box.x) + 52, viewport.width * 0.32),
    right: Math.min(Math.min(viewport.width, box.x + box.width) - 52, viewport.width * 0.68),
    top: Math.max(Math.max(0, box.y) + 70, viewport.height * 0.2),
    bottom: Math.min(box.y + box.height - 50, viewport.height * 0.65),
  };
}

function strokeEvidenceClip(
  point: { x: number; y: number; dx: number; dy: number },
  viewport: { width: number; height: number },
  safe: { left: number; right: number; top: number; bottom: number } | null,
): { x: number; y: number; width: number; height: number } {
  // Compare only the painted neighbourhood. Element screenshots include fixed UI chrome that
  // visually overlaps the canvas; focus rings in that chrome legitimately change after Undo.
  // Clamping to the safe rectangle rather than the viewport is what keeps that chrome out: on the
  // top row the 40px margin otherwise reached into the floating control at the stage's top-right,
  // and a repaint of THAT was read as "Undo left perceptible stroke pixels behind".
  const margin = 40;
  const lowX = safe ? Math.max(0, safe.left) : 0;
  const lowY = safe ? Math.max(0, safe.top) : 0;
  const highX = safe ? Math.min(viewport.width, safe.right) : viewport.width;
  const highY = safe ? Math.min(viewport.height, safe.bottom) : viewport.height;
  const strokeLeft = Math.min(point.x, point.x + point.dx);
  const strokeRight = Math.max(point.x, point.x + point.dx);
  const strokeTop = Math.min(point.y, point.y + point.dy);
  const strokeBottom = Math.max(point.y, point.y + point.dy);
  // Only the MARGIN is trimmed at the safe boundary — never the stroke. Column 6 starts exactly on
  // safeRight and its gesture legitimately reaches 9px beyond, so clamping the whole clip there
  // left the ink outside its own measurement window and read as "produced no visible pixels".
  const left = Math.min(strokeLeft, Math.max(lowX, strokeLeft - margin));
  const top = Math.min(strokeTop, Math.max(lowY, strokeTop - margin));
  const right = Math.max(strokeRight, Math.min(highX, strokeRight + margin));
  const bottom = Math.max(strokeBottom, Math.min(highY, strokeBottom + margin));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function sanitizeEvidenceClip(
  clip: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const clampedX = Math.max(0, Math.min(viewport.width - 2, clip.x));
  const clampedY = Math.max(0, Math.min(viewport.height - 2, clip.y));
  const maxWidth = Math.max(2, viewport.width - clampedX);
  const maxHeight = Math.max(2, viewport.height - clampedY);
  return {
    x: clampedX,
    y: clampedY,
    width: Math.max(2, Math.min(Math.max(2, clip.width), maxWidth)),
    height: Math.max(2, Math.min(Math.max(2, clip.height), maxHeight)),
  };
}

async function compareScreenshotPixels(
  page: Page,
  first: Buffer,
  second: Buffer,
  channelTolerance = 2,
): Promise<PixelDiff> {
  return page.evaluate(async ({ firstBase64, secondBase64, tolerance }) => {
    const [firstResponse, secondResponse] = await Promise.all([
      fetch(`data:image/png;base64,${firstBase64}`),
      fetch(`data:image/png;base64,${secondBase64}`),
    ]);
    const [firstBitmap, secondBitmap] = await Promise.all([
      createImageBitmap(await firstResponse.blob()),
      createImageBitmap(await secondResponse.blob()),
    ]);
    const firstCanvas = new OffscreenCanvas(firstBitmap.width, firstBitmap.height);
    const secondCanvas = new OffscreenCanvas(secondBitmap.width, secondBitmap.height);
    const firstContext = firstCanvas.getContext("2d", { willReadFrequently: true });
    const secondContext = secondCanvas.getContext("2d", { willReadFrequently: true });
    if (!firstContext || !secondContext) throw new Error("could not decode screenshot pixels");
    firstContext.drawImage(firstBitmap, 0, 0);
    secondContext.drawImage(secondBitmap, 0, 0);
    const a = {
      width: firstCanvas.width,
      height: firstCanvas.height,
      data: firstContext.getImageData(0, 0, firstCanvas.width, firstCanvas.height).data,
    };
    const b = {
      width: secondCanvas.width,
      height: secondCanvas.height,
      data: secondContext.getImageData(0, 0, secondCanvas.width, secondCanvas.height).data,
    };
    firstBitmap.close();
    secondBitmap.close();
    if (a.width !== b.width || a.height !== b.height) {
      return {
        changedPixels: Math.max(a.width * a.height, b.width * b.height),
        totalPixels: Math.max(a.width * a.height, b.width * b.height),
        maxChannelDelta: 255,
      };
    }
    let changedPixels = 0;
    let maxChannelDelta = 0;
    for (let offset = 0; offset < a.data.length; offset += 4) {
      let pixelDelta = 0;
      for (let channel = 0; channel < 4; channel += 1) {
        pixelDelta = Math.max(pixelDelta, Math.abs(a.data[offset + channel]! - b.data[offset + channel]!));
      }
      maxChannelDelta = Math.max(maxChannelDelta, pixelDelta);
      if (pixelDelta > tolerance) changedPixels += 1;
    }
    return { changedPixels, totalPixels: a.width * a.height, maxChannelDelta };
  }, {
    firstBase64: first.toString("base64"),
    secondBase64: second.toString("base64"),
    tolerance: channelTolerance,
  });
}

async function measureEraserLiftRatio(
  page: Page,
  empty: Buffer,
  painted: Buffer,
  erased: Buffer,
): Promise<EraserLiftRatio> {
  return page.evaluate(async ({ emptyBase64, paintedBase64, erasedBase64 }) => {
    const [emptyResponse, paintedResponse, erasedResponse] = await Promise.all([
      fetch(`data:image/png;base64,${emptyBase64}`),
      fetch(`data:image/png;base64,${paintedBase64}`),
      fetch(`data:image/png;base64,${erasedBase64}`),
    ]);
    const [emptyBitmap, paintedBitmap, erasedBitmap] = await Promise.all([
      createImageBitmap(await emptyResponse.blob()),
      createImageBitmap(await paintedResponse.blob()),
      createImageBitmap(await erasedResponse.blob()),
    ]);
    const emptyCanvas = new OffscreenCanvas(emptyBitmap.width, emptyBitmap.height);
    const paintedCanvas = new OffscreenCanvas(paintedBitmap.width, paintedBitmap.height);
    const erasedCanvas = new OffscreenCanvas(erasedBitmap.width, erasedBitmap.height);
    const emptyContext = emptyCanvas.getContext("2d", { willReadFrequently: true });
    const paintedContext = paintedCanvas.getContext("2d", { willReadFrequently: true });
    const erasedContext = erasedCanvas.getContext("2d", { willReadFrequently: true });
    if (!emptyContext || !paintedContext || !erasedContext) {
      throw new Error("could not decode eraser evidence pixels");
    }
    emptyContext.drawImage(emptyBitmap, 0, 0);
    paintedContext.drawImage(paintedBitmap, 0, 0);
    erasedContext.drawImage(erasedBitmap, 0, 0);
    const emptyPixels = emptyContext.getImageData(0, 0, emptyCanvas.width, emptyCanvas.height);
    const paintedPixels = paintedContext.getImageData(0, 0, paintedCanvas.width, paintedCanvas.height);
    const erasedPixels = erasedContext.getImageData(0, 0, erasedCanvas.width, erasedCanvas.height);
    emptyBitmap.close();
    paintedBitmap.close();
    erasedBitmap.close();
    if (
      emptyCanvas.width !== paintedCanvas.width
      || emptyCanvas.height !== paintedCanvas.height
      || emptyCanvas.width !== erasedCanvas.width
      || emptyCanvas.height !== erasedCanvas.height
    ) return { affectedPixels: 0, residualEnergyRatio: 0 };

    let affectedPixels = 0;
    let baselineEnergy = 0;
    let residualEnergy = 0;
    for (let offset = 0; offset < emptyPixels.data.length; offset += 4) {
      let paintedFromEmpty = 0;
      let erasedFromPainted = 0;
      let erasedFromEmpty = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        paintedFromEmpty += Math.abs(
          paintedPixels.data[offset + channel]! - emptyPixels.data[offset + channel]!,
        );
        erasedFromPainted += Math.abs(
          erasedPixels.data[offset + channel]! - paintedPixels.data[offset + channel]!,
        );
        erasedFromEmpty += Math.abs(
          erasedPixels.data[offset + channel]! - emptyPixels.data[offset + channel]!,
        );
      }
      if (paintedFromEmpty < 24 || erasedFromPainted < 6) continue;
      affectedPixels += 1;
      baselineEnergy += paintedFromEmpty;
      residualEnergy += erasedFromEmpty;
    }
    return {
      affectedPixels,
      residualEnergyRatio: baselineEnergy > 0 ? residualEnergy / baselineEnergy : 0,
    };
  }, {
    emptyBase64: empty.toString("base64"),
    paintedBase64: painted.toString("base64"),
    erasedBase64: erased.toString("base64"),
  });
}

async function compareScreenshotCoverage(
  page: Page,
  first: Buffer,
  second: Buffer,
  segmentCount = 6,
  channelTolerance = 3,
  segmentXRange?: Readonly<{ start: number; end: number }>,
): Promise<PixelCoverage> {
  return page.evaluate(async ({
    firstBase64,
    secondBase64,
    segments,
    tolerance,
    segmentStartX,
    segmentEndX,
  }) => {
    const [firstResponse, secondResponse] = await Promise.all([
      fetch(`data:image/png;base64,${firstBase64}`),
      fetch(`data:image/png;base64,${secondBase64}`),
    ]);
    const [firstBitmap, secondBitmap] = await Promise.all([
      createImageBitmap(await firstResponse.blob()),
      createImageBitmap(await secondResponse.blob()),
    ]);
    const width = firstBitmap.width;
    const height = firstBitmap.height;
    if (width !== secondBitmap.width || height !== secondBitmap.height) {
      firstBitmap.close();
      secondBitmap.close();
      return {
        changedPixels: Math.max(width * height, secondBitmap.width * secondBitmap.height),
        totalPixels: Math.max(width * height, secondBitmap.width * secondBitmap.height),
        maxChannelDelta: 255,
        visibleSegments: segments,
        segmentChangedPixels: Array.from({ length: segments }, () => 1),
        bounds: { left: 0, top: 0, right: Math.max(width, secondBitmap.width) - 1, bottom: Math.max(height, secondBitmap.height) - 1 },
      };
    }
    const firstCanvas = new OffscreenCanvas(width, height);
    const secondCanvas = new OffscreenCanvas(width, height);
    const firstContext = firstCanvas.getContext("2d", { willReadFrequently: true });
    const secondContext = secondCanvas.getContext("2d", { willReadFrequently: true });
    if (!firstContext || !secondContext) throw new Error("could not decode screenshot coverage pixels");
    firstContext.drawImage(firstBitmap, 0, 0);
    secondContext.drawImage(secondBitmap, 0, 0);
    const a = firstContext.getImageData(0, 0, width, height).data;
    const b = secondContext.getImageData(0, 0, width, height).data;
    firstBitmap.close();
    secondBitmap.close();

    const segmentChangedPixels = Array.from({ length: segments }, () => 0);
    const resolvedSegmentStartX = Number.isFinite(segmentStartX)
      ? Number(segmentStartX)
      : 0;
    const resolvedSegmentEndX = Number.isFinite(segmentEndX)
      ? Number(segmentEndX)
      : width;
    let changedPixels = 0;
    let maxChannelDelta = 0;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        let pixelDelta = 0;
        for (let channel = 0; channel < 4; channel += 1) {
          pixelDelta = Math.max(pixelDelta, Math.abs(a[offset + channel]! - b[offset + channel]!));
        }
        maxChannelDelta = Math.max(maxChannelDelta, pixelDelta);
        if (pixelDelta <= tolerance) continue;
        changedPixels += 1;
        const segmentProgress = (
          x - resolvedSegmentStartX
        ) / Math.max(1, resolvedSegmentEndX - resolvedSegmentStartX);
        const segment = Math.min(
          segments - 1,
          Math.max(0, Math.floor(segmentProgress * segments)),
        );
        segmentChangedPixels[segment]! += 1;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    return {
      changedPixels,
      totalPixels: width * height,
      maxChannelDelta,
      visibleSegments: segmentChangedPixels.filter((count) => count > 0).length,
      segmentChangedPixels,
      bounds: right >= left && bottom >= top ? { left, top, right, bottom } : null,
    };
  }, {
    firstBase64: first.toString("base64"),
    secondBase64: second.toString("base64"),
    segments: Math.max(1, Math.trunc(segmentCount)),
    tolerance: channelTolerance,
    segmentStartX: segmentXRange?.start ?? null,
    segmentEndX: segmentXRange?.end ?? null,
  });
}

function hasMeaningfulPixelChange(diff: PixelDiff): boolean {
  return diff.changedPixels >= 4 && diff.maxChannelDelta >= 4;
}

async function captureStableEvidence(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
): Promise<Buffer> {
  const viewport = page.viewportSize();
  const safeClip = viewport
    ? sanitizeEvidenceClip(clip, viewport)
    : clip;
  let fallbackToFull = false;
  const takeScreenshot = async (): Promise<Buffer> => {
    if (fallbackToFull) return page.screenshot({ animations: "disabled" });
    try {
      return await page.screenshot({ animations: "disabled", clip: safeClip });
    } catch {
      fallbackToFull = true;
      return page.screenshot({ animations: "disabled" });
    }
  };
  let current = await takeScreenshot();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.waitForTimeout(80);
    const next = await takeScreenshot();
    const diff = await compareScreenshotPixels(page, current, next);
    if (diff.changedPixels <= 3) return next;
    current = next;
  }
  return current;
}

interface VerifierStrokeRoute {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

async function drawVerifierStrokeRoute(
  page: Page,
  route: VerifierStrokeRoute,
): Promise<void> {
  await page.mouse.move(route.start.x, route.start.y);
  await page.mouse.down();
  await page.mouse.move(route.end.x, route.end.y);
  await page.mouse.up();
  await page.mouse.move(4, 4);
}

async function prepareVisibleEraserBaseline(
  page: Page,
  route: VerifierStrokeRoute,
  clip: { x: number; y: number; width: number; height: number },
): Promise<{
  empty: Buffer;
  painted: Buffer;
}> {
  const empty = await captureStableEvidence(page, clip);
  const baselineItem = verifierBaselinePaintItem();
  const baselineSelection = await materializeStudioBrushCatalogSelection(baselineItem.id);
  invariant(baselineSelection, "eraser baseline paint selection did not materialize");
  invariant(
    verifierBrushOperation(baselineSelection) === "paint",
    `${baselineItem.id}: eraser baseline resolved to a destructive operation`,
  );
  await selectDesktopBrush(page, baselineItem, baselineSelection);
  await drawVerifierStrokeRoute(page, route);
  await page.waitForTimeout(280);
  const persisted = await waitForPersistedSelectedOperation(
    page,
    baselineSelection,
    "paint",
    1,
    false,
  );
  invariant(
    persisted.stroke.mode === "pen",
    `${baselineItem.id}: eraser baseline did not persist as paint`,
  );
  const painted = await captureStableEvidence(page, clip);
  const paintDiff = await compareScreenshotPixels(page, empty, painted);
  invariant(
    hasMeaningfulPixelChange(paintDiff),
    `${baselineItem.id}: eraser baseline produced no visible paint`,
  );
  return { empty, painted };
}

async function runDesktopBrushMatrix(browser: Browser, studioUrl: string): Promise<DesktopBrushResult> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const errors = collectBrowserErrors(page, "desktop-brushes", studioUrl);
  const screenshot = join(SCRATCH, `studio-brush-desktop-${BRUSH_MATRIX_CATALOG_COUNT}.png`);
  const catalogScreenshot = join(SCRATCH, "studio-brush-desktop-catalog.png");

  try {
    await prepareStudioPage(page, studioUrl);
    await activateDesktopPen(page);
    if (DEBUG_BRUSH_VERIFIER) {
      const flag = await page.evaluate(
        () => (globalThis as { __debugPerfectInk?: boolean }).__debugPerfectInk,
      );
      log(`DEBUG global __debugPerfectInk=${String(flag)}`);
    }

    // Desktop palettes now mount their contents inside an explicit popup. Open it through the
    // shipped control before asserting the summary; waiting for unmounted content never tests ink.
    const subToolsTrigger = page.locator('[data-studio-drawing-palette-icon-trigger="sub-tools"]');
    if (await subToolsTrigger.count() > 0
      && await subToolsTrigger.getAttribute("aria-expanded") !== "true") {
      await subToolsTrigger.click();
    }
    const summary = page.locator('[data-studio-inspector-brush-summary="true"]');
    await summary.waitFor({ state: "attached", timeout: 20_000 });
    const inspectorSummaryCount = await summary.count();
    const inspectorQuickTrayCount = await page
      .locator('[data-testid="studio-inspector-context-drawing"]')
      .locator('[data-studio-brush-tray="true"], [data-studio-open-brush-library="true"]')
      .count();
    invariant(inspectorSummaryCount === 1, "desktop inspector is missing its read-only brush summary");
    invariant(inspectorQuickTrayCount === 0, "desktop inspector still duplicates the quick brush shelf");
    if (await subToolsTrigger.count() > 0
      && await subToolsTrigger.getAttribute("aria-expanded") === "true") {
      await subToolsTrigger.click();
    }

    const firstCatalog = await openDesktopCatalog(page);
    const catalogSessionCount = await page
      .locator('[data-studio-brush-catalog-session="true"]')
      .count();
    const catalogDialogCount = await page
      .locator('[role="dialog"][data-studio-brush-floating]')
      .count();
    // External-origin runs may target a build whose catalogue predates this tree; the strict
    // UI-vs-catalogue match only holds for the co-built local preview.
    const skipUiCatalogMatch =
      process.env.TOONSPECTRUM_SKIP_UI_CATALOG_MATCH === "1"
      && Boolean(process.env.TOONSPECTRUM_VERIFY_ORIGIN);
    if (!skipUiCatalogMatch) {
      await assertUiBrushCatalogMatchesProductCatalog(
        firstCatalog,
        STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS,
        "paint",
      );
    } else {
      log("desktop: UI/catalogue equality SKIPPED (external origin) — receipt records the skip");
    }
    await page.screenshot({ path: catalogScreenshot, animations: "disabled" });
    await closeDesktopCatalog(page, firstCatalog);

    await activateDesktopEraser(page);
    const eraserCatalog = await openDesktopCatalog(page);
    await assertUiEraserQuickPickerMatchesProductCatalog(eraserCatalog);
    await closeDesktopCatalog(page, eraserCatalog);
    await activateDesktopPen(page);

    const stage = page.locator(".konvajs-content").first();
    await stage.waitFor({ state: "visible" });
    const stageBox = await stage.boundingBox();
    const viewport = page.viewportSize();
    invariant(stageBox && viewport, "could not measure the desktop canvas");

    const evidence: BrushStrokeEvidence[] = [];
    for (const [index, preset] of DESKTOP_STABILITY_CASES.entries()) {
      try {
      const expectedSelection = await materializeStudioBrushCatalogSelection(preset.id);
      invariant(expectedSelection, `${preset.id}: product catalogue selection did not materialize`);
      invariant(
        preset.source === "core" || expectedSelection.brushDynamics,
        `${preset.id}: pro catalogue selection has no runtime dynamics`,
      );
      const operation = verifierBrushOperation(expectedSelection);
      const transparentPaint = operation === "paint"
        && !studioWetInkBrushDepositsPigment(expectedSelection.runtimeBrushId);
      const lowDensityEraser = operation === "erase"
        && isStudioBrushEraserAliasId(expectedSelection.runtimeBrushId);
      await selectDesktopBrush(page, preset, expectedSelection);
      await page.mouse.move(4, 4);
      const presetDescriptor = studioBrushPackDescriptorById(preset.id);
      const desktopDryMediaClassification = classifyStudioDryMediaCatalogIdV1(preset.id);
      // The continuity audit's own excuse list is consulted FIRST, because it is the product's
      // statement that a preset is allowed to deposit sparsely. The three classifiers below cannot
      // see it: splatter--burst-cloud is excused there for exactly this reason and matches none of
      // them, so it was handed the 9px flick meant for continuous media and reported as depositing
      // no visible pixels. A preset excused from the continuity bar must get a gesture long enough
      // to contain its own stations.
      const usesDiscreteCarrier =
        studioBrushCatalogIdIsIntentionallyDiscontinuous(preset.id)
        || (desktopDryMediaClassification
          ? desktopDryMediaClassification.kind === "intentional-discrete"
          : presetDescriptor
            ? studioBrushPresetUsesIntentionalDiscreteCarrier(presetDescriptor)
            : studioCc0MypaintPresetUsesIntentionalDiscreteCarrier(preset.id));
      const point = strokePoint(
        stageBox,
        viewport,
        preset,
        expectedSelection,
        usesDiscreteCarrier,
      );
      if (DEBUG_BRUSH_VERIFIER) {
        log(`viewport=${JSON.stringify(viewport)} stageBox=${JSON.stringify(stageBox)} presetIndex=${index}`);
      }
      const safeCanvasPoint = async ({ x, y }: { x: number; y: number }) =>
        page.evaluate(({ x: pointerX, y: pointerY }) =>
          Boolean(document.elementFromPoint(pointerX, pointerY)?.closest(".konvajs-content")),
        { x, y }
      );
      let evidencePoint = point;
      const safeCandidates: Array<{ x: number; y: number }> = [
        { x: point.x, y: point.y },
      ];
      if (!await safeCanvasPoint(point)) {
        const safeLeft = Math.max(0, Math.min(stageBox.x + 36, viewport.width - 36));
        const safeRight = Math.max(0, Math.min(stageBox.x + stageBox.width - 36, viewport.width - 16));
        const safeTop = Math.max(0, Math.min(stageBox.y + 36, viewport.height - 36));
        const safeBottom = Math.max(0, Math.min(stageBox.y + stageBox.height - 36, viewport.height - 16));
        if (safeRight > safeLeft + 8 && safeBottom > safeTop + 8) {
          for (let row = 0; row < 4; row += 1) {
            for (let column = 0; column < 4; column += 1) {
              safeCandidates.push({
                x: Math.round(safeLeft + ((column + 0.5) * (safeRight - safeLeft)) / 4),
                y: Math.round(safeTop + ((row + 0.5) * (safeBottom - safeTop)) / 4),
              });
            }
          }
        }
        for (const candidate of safeCandidates) {
          if (await safeCanvasPoint(candidate)) {
            evidencePoint = { ...candidate, dx: point.dx, dy: point.dy };
            break;
          }
        }
      }
      if (!await safeCanvasPoint(evidencePoint)) {
        if (DEBUG_BRUSH_VERIFIER) {
          const targetDiagnostics = await page.evaluate(
            (candidates) => candidates.slice(0, 8).map(({ x, y }) => {
              const target = document.elementFromPoint(x, y);
              return {
                x,
                y,
                tag: target?.tagName ?? null,
                id: target?.id ?? null,
                className: typeof target?.className === "string" ? target.className : null,
                testId: target?.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
                canvasShell: target?.closest("[data-studio-canvas-shell]")
                  ?.getAttribute("data-studio-canvas-shell") ?? null,
                konva: target?.closest(".konvajs-content") !== null,
              };
            }),
            safeCandidates,
          );
          log(`preset=${preset.id} point targets=${JSON.stringify(targetDiagnostics)}`);
          const stageDiagnostics = await stage.evaluate((element) => {
            const ancestors: Array<{
              tag: string;
              className: string | null;
              pointerEvents: string;
              visibility: string;
              display: string;
              rect: { x: number; y: number; width: number; height: number };
              overflow: string;
            }> = [];
            let current: Element | null = element;
            while (current && ancestors.length < 8) {
              const style = getComputedStyle(current);
              ancestors.push({
                tag: current.tagName,
                className: typeof current.className === "string" ? current.className : null,
                pointerEvents: style.pointerEvents,
                visibility: style.visibility,
                display: style.display,
                rect: current.getBoundingClientRect().toJSON(),
                overflow: style.overflow,
              });
              current = current.parentElement;
            }
            return ancestors;
          });
          log(`preset=${preset.id} stage ancestors=${JSON.stringify(stageDiagnostics)}`);
        }
        evidencePoint = {
          x: Math.round(Math.max(8, Math.min(viewport.width - 8, stageBox.x + stageBox.width / 2))),
          y: Math.round(Math.max(8, Math.min(viewport.height - 8, stageBox.y + stageBox.height / 2))),
          dx: point.dx,
          dy: point.dy,
        };
      }
      const usedClip = sanitizeEvidenceClip(
        strokeEvidenceClip(evidencePoint, viewport, canvasSafeRect(stageBox, viewport)),
        viewport,
      );
      const eraseBaseline = operation === "erase"
        ? await prepareVisibleEraserBaseline(page, {
            start: {
              x: evidencePoint.x - 18,
              y: evidencePoint.y - 1,
            },
            end: {
              x: evidencePoint.x + evidencePoint.dx + 18,
              y: evidencePoint.y + evidencePoint.dy + 1,
            },
          }, usedClip)
        : null;
      if (eraseBaseline) {
        await selectDesktopBrush(page, preset, expectedSelection);
      }
      const emptyBefore = eraseBaseline?.empty ?? null;
      const before = eraseBaseline?.painted
        ?? await captureStableEvidence(page, usedClip);
      const shortOperationRoute: VerifierStrokeRoute = operation === "erase"
        ? {
            start: {
              x: evidencePoint.x - 12,
              y: evidencePoint.y - 1,
            },
            end: {
              x: evidencePoint.x + evidencePoint.dx + 12,
              y: evidencePoint.y + evidencePoint.dy + 1,
            },
          }
        : {
            start: { x: evidencePoint.x, y: evidencePoint.y },
            end: {
              x: evidencePoint.x + evidencePoint.dx,
              y: evidencePoint.y + evidencePoint.dy,
            },
          };
      if (DEBUG_BRUSH_VERIFIER) {
        log(`preset=${preset.id} point=${JSON.stringify(point)} evidencePoint=${JSON.stringify(evidencePoint)} clip=${JSON.stringify(usedClip)}`);
      }

      // No dwell between the trusted down, one short move and release: this is the regression path
      // for strokes that previously vanished when a user released earlier than the deferred commit.
      await page.mouse.move(shortOperationRoute.start.x, shortOperationRoute.start.y);
      await page.mouse.down();
      await page.mouse.move(
        shortOperationRoute.end.x,
        shortOperationRoute.end.y,
        operation === "erase" ? { steps: 4 } : undefined,
      );
      let eraseLiveOperationActive: boolean | null = null;
      if (operation === "erase") {
        await page.waitForTimeout(80);
        const live = await page.screenshot({ animations: "disabled", clip: usedClip });
        const liveDiff = await compareScreenshotPixels(page, before, live);
        eraseLiveOperationActive = await page.evaluate(() =>
          document.querySelector('[data-studio-draw-options="true"]')
            ?.getAttribute("data-studio-active-draw-mode") === "eraser"
        );
        invariant(
          eraseLiveOperationActive,
          `${preset.id}: pointer-down gesture lost eraser operation authority`,
        );
        if (!hasMeaningfulPixelChange(liveDiff)) {
          writeFileSync(
            join(SCRATCH, `studio-brush-diagnostic-${preset.id}-erase-baseline.png`),
            before,
          );
          writeFileSync(
            join(SCRATCH, `studio-brush-diagnostic-${preset.id}-erase-live.png`),
            live,
          );
        }
        invariant(
          hasMeaningfulPixelChange(liveDiff),
          `${preset.id}: eraser gesture had no live retained-layer preview; `
            + `pointer-down diff ${JSON.stringify(liveDiff)}`,
        );
        const liveEraseLift = emptyBefore
          ? await measureEraserLiftRatio(page, emptyBefore, before, live)
          : null;
        if (liveEraseLift) {
          invariant(
            liveEraseLift.affectedPixels >= 4,
            `${preset.id}: live eraser had no measurable baseline overlap`,
          );
          if (lowDensityEraser) {
            invariant(
              liveEraseLift.residualEnergyRatio >= 0.25
                && liveEraseLift.residualEnergyRatio <= 0.85,
              `${preset.id}: live low-density gesture retained `
                + `${(liveEraseLift.residualEnergyRatio * 100).toFixed(1)}% of baseline energy; `
                + "expected one bounded retained-layer lift",
            );
          } else {
            if (process.env.TOONSPECTRUM_DUMP_ERASE_DIAG === "1") {
              writeFileSync(join(SCRATCH, `erase-diag-${preset.id}-empty.png`), emptyBefore!);
              writeFileSync(join(SCRATCH, `erase-diag-${preset.id}-baseline.png`), before);
              writeFileSync(join(SCRATCH, `erase-diag-${preset.id}-live.png`), live);
            }
            invariant(
              liveEraseLift.residualEnergyRatio <= 0.1,
              `${preset.id}: live full-strength gesture retained `
                + `${(liveEraseLift.residualEnergyRatio * 100).toFixed(1)}% of baseline energy`,
            );
          }
        }
      }
      if (process.env.TOONSPECTRUM_LONG_BRUSH_CANVAS_DUMP === "1") {
        const dump = await page.evaluate(() =>
          Array.from(document.querySelectorAll("canvas"), (canvas, index) => ({
            index,
            w: canvas.width,
            h: canvas.height,
            cls: (canvas.className ?? "").toString().slice(0, 48),
            url: canvas.toDataURL("image/png"),
          })),
        );
        const dumpDir = join(SCRATCH, `canvas-dump-${preset.id}-short-live`);
        mkdirSync(dumpDir, { recursive: true });
        for (const entry of dump) {
          const base64 = entry.url.split(",")[1] ?? "";
          if (!base64) continue;
          writeFileSync(
            join(dumpDir, `${String(entry.index).padStart(2, "0")}-${entry.w}x${entry.h}.png`),
            Buffer.from(base64, "base64"),
          );
        }
      }
      await page.mouse.up();
      const immediate = await page.screenshot({ animations: "disabled", clip: usedClip });
      await page.mouse.move(4, 4);
      const immediateDiff = await compareScreenshotPixels(page, before, immediate);
      if (DEBUG_BRUSH_VERIFIER && preset.id === "perfect-ink") {
        log(`DEBUG ${preset.id}: immediateDiff ${JSON.stringify(immediateDiff)} at point ${JSON.stringify(point)}`);
        const branchState = await page.evaluate(() =>
          (globalThis as {
            __perfectInkDebugState?: Record<string, unknown> | null;
          }).__perfectInkDebugState ?? null,
        );
        log(`DEBUG ${preset.id}: branchState ${JSON.stringify(branchState)}`);
        await page.evaluate(() => {
          const globalState = globalThis as { __perfectInkDebugState?: Record<string, unknown> | null };
          globalState.__perfectInkDebugState = null;
        });
      }
      if (!hasMeaningfulPixelChange(immediateDiff)) {
        // Capture what the surface actually showed; an invisible release is either a renderer
        // regression or a selection mishap, and the two are indistinguishable from the message.
        writeFileSync(join(SCRATCH, `release-diag-${preset.id}-before.png`), before);
        writeFileSync(join(SCRATCH, `release-diag-${preset.id}-immediate.png`), immediate);
        log(`release diagnostic for ${preset.id}: ${JSON.stringify(immediateDiff)}`);
        // 라이브 오버레이가 fail-closed 로 지워진 릴리스는 화면만으로 원인을 알 수 없다 —
        // 오버레이가 남긴 마지막 폴백 사유 브레드크럼을 함께 기록한다.
        const overlayDebug = await page.evaluate(() =>
          (globalThis as {
            __studioDynamicOverlayDebug?: { lastFailure: string; at: number } | null;
          }).__studioDynamicOverlayDebug ?? null,
        );
        log(`release diagnostic overlay state for ${preset.id}: ${JSON.stringify(overlayDebug)}`);
        const sealDebug = await page.evaluate(() =>
          (globalThis as {
            __studioDynamicSealDebug?: Record<string, unknown> | null;
          }).__studioDynamicSealDebug ?? null,
        );
        log(`release diagnostic seal state for ${preset.id}: ${JSON.stringify(sealDebug)}`);
        const releaseDebug = await page.evaluate(() =>
          (globalThis as {
            __studioDynamicReleaseDebug?: Record<string, unknown> | null;
          }).__studioDynamicReleaseDebug ?? null,
        );
        log(`release diagnostic settled-clear state for ${preset.id}: ${JSON.stringify(releaseDebug)}`);
        const commitRenderDebug = await page.evaluate(() =>
          (globalThis as {
            __studioCommitRenderDebug?: Record<string, unknown> | null;
          }).__studioCommitRenderDebug ?? null,
        );
        log(`release diagnostic commit render state for ${preset.id}: ${JSON.stringify(commitRenderDebug)}`);
        const commitRouteDebug = await page.evaluate(() =>
          (globalThis as {
            __studioCommitRouteDebug?: Record<string, unknown> | null;
          }).__studioCommitRouteDebug ?? null,
        );
        log(`release diagnostic commit route state for ${preset.id}: ${JSON.stringify(commitRouteDebug)}`);
        // 실제 요소의 입력 채널(압력·속도·모델 키)이 오프라인 플랜 프로브와 다른지가
        // "계획은 풍부, 커밋 픽셀은 희미" 모순의 남은 변수다.
        try {
          const persisted = await persistedDrawElements(page);
          const lastDraw = persisted.at(-1) as Record<string, unknown> | undefined;
          if (lastDraw) {
            const {
              brushDynamics,
              brushEnginePrograms: _brushEnginePrograms,
              ...channels
            } = lastDraw;
            log(
              `release diagnostic persisted element for ${preset.id}: `
                + `${JSON.stringify({ ...channels, hasDynamics: Boolean(brushDynamics) })}`,
            );
          } else {
            log(`release diagnostic persisted element for ${preset.id}: none`);
          }
        } catch (cause) {
          log(`release diagnostic persisted element for ${preset.id}: read failed ${String(cause)}`);
        }
        // 어느 표면이 획을 들고 있(었)는지 확정하기 위해 캔버스별 메타데이터와 잉크 픽셀 수를
        // 함께 기록한다(index 만으로는 커서 캔버스와 오버레이가 구분되지 않았던 실측 교훈).
        const canvasInkCensus = await page.evaluate(() =>
          Array.from(document.querySelectorAll("canvas"), (canvas, index) => {
            let ink = -1;
            try {
              const context = canvas.getContext("2d");
              if (context && canvas.width > 4 && canvas.height > 4) {
                const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
                ink = 0;
                for (let offset = 0; offset < data.length; offset += 16) {
                  if (data[offset + 3]! > 16 && data[offset]! < 200) ink += 1;
                }
              }
            } catch {
              ink = -2;
            }
            const rect = canvas.getBoundingClientRect();
            const computed = getComputedStyle(canvas);
            return {
              index,
              w: canvas.width,
              h: canvas.height,
              attrs: Array.from(canvas.attributes)
                .filter((attribute) => attribute.name.startsWith("data-"))
                .map((attribute) => `${attribute.name}=${attribute.value.slice(0, 24)}`)
                .join(" "),
              ink,
              // 화면 합성 판별: 비트맵에 잉크가 있어도 rect 0×0·display:none·opacity 0 이면
              // 스크린샷에는 절대 나타나지 않는다.
              rect: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
              },
              css: `${computed.display}/${computed.visibility}/op${computed.opacity}`,
            };
          }),
        );
        log(`release diagnostic canvas census for ${preset.id}: ${JSON.stringify(canvasInkCensus)}`);
        if (process.env.TOONSPECTRUM_LONG_BRUSH_CANVAS_DUMP === "1") {
          const dump = await page.evaluate(() =>
            Array.from(document.querySelectorAll("canvas"), (canvas, index) => ({
              index,
              w: canvas.width,
              h: canvas.height,
              cls: (canvas.className ?? "").toString().slice(0, 48),
              url: canvas.toDataURL("image/png"),
            })),
          );
          const dumpDir = join(SCRATCH, `canvas-dump-${preset.id}-short-invisible`);
          mkdirSync(dumpDir, { recursive: true });
          for (const entry of dump) {
            const base64 = entry.url.split(",")[1] ?? "";
            if (!base64) continue;
            writeFileSync(
              join(dumpDir, `${String(entry.index).padStart(2, "0")}-${entry.w}x${entry.h}.png`),
              Buffer.from(base64, "base64"),
            );
          }
        }
        // 릴리스-경합(늦게 나타남)과 불가시 커밋(끝내 안 나타남)을 가르는 최종 판별:
        // 실패 프레임에서 600ms 더 기다린 뒤 같은 클립을 다시 비교한다.
        await page.waitForTimeout(600);
        const late = await page.screenshot({ animations: "disabled", clip: usedClip });
        const lateDiff = await compareScreenshotPixels(page, before, late);
        log(`release diagnostic late(+600ms) diff for ${preset.id}: ${JSON.stringify(lateDiff)}`);
        writeFileSync(join(SCRATCH, `release-diag-${preset.id}-late.png`), late);
      }
      invariant(
        transparentPaint || hasMeaningfulPixelChange(immediateDiff),
        operation === "erase"
          ? `${preset.id}: released eraser did not visibly remove baseline paint`
          : `${preset.id}: fast short stroke produced no visible pixels`,
      );
      // A deferred commit is allowed, but the release preview must settle into durable pixels
      // before its 200 ms idle window elapses instead of silently disappearing.
      await page.waitForTimeout(260);
      const after = await page.screenshot({ animations: "disabled", clip: usedClip });
      const settledDiff = await compareScreenshotPixels(page, before, after);
      const visualChanged = hasMeaningfulPixelChange(settledDiff);
      // 결정성 판별용: 성공 경로에서도 정착(커밋) 시점의 캔버스 비트맵을 남긴다 — 신선한
      // 세션의 커밋 강도와 딥런 실패 프레임의 커밋 강도를 비트맵 수준에서 비교하기 위함.
      if (process.env.TOONSPECTRUM_BRUSH_VERIFY_SETTLED_DUMP === "1") {
        log(`settled diff for ${preset.id}: ${JSON.stringify(settledDiff)}`);
        const dump = await page.evaluate(() =>
          Array.from(document.querySelectorAll("canvas"), (canvas, index) => ({
            index,
            w: canvas.width,
            h: canvas.height,
            url: canvas.width > 4 ? canvas.toDataURL("image/png") : "",
          })),
        );
        const dumpDir = join(SCRATCH, `canvas-dump-${preset.id}-settled`);
        mkdirSync(dumpDir, { recursive: true });
        writeFileSync(join(dumpDir, "settled-after.png"), after);
        writeFileSync(join(dumpDir, "settled-before.png"), before);
        for (const entry of dump) {
          const base64 = entry.url.split(",")[1] ?? "";
          if (!base64) continue;
          writeFileSync(
            join(dumpDir, `${String(entry.index).padStart(2, "0")}-${entry.w}x${entry.h}.png`),
            Buffer.from(base64, "base64"),
          );
        }
      }
      invariant(
        transparentPaint || visualChanged,
        operation === "erase"
          ? `${preset.id}: erased baseline reappeared before commit`
          : `${preset.id}: released stroke disappeared before becoming durable`,
      );
      const eraseLift = operation === "erase" && emptyBefore
        ? await measureEraserLiftRatio(page, emptyBefore, before, after)
        : null;
      if (operation === "erase" && emptyBefore && DEBUG_BRUSH_VERIFIER) {
        writeFileSync(join(SCRATCH, `settled-diag-${preset.id}-after.png`), after);
        writeFileSync(join(SCRATCH, `settled-diag-${preset.id}-before.png`), before);
        writeFileSync(join(SCRATCH, `settled-diag-${preset.id}-empty.png`), emptyBefore);
      }
      if (eraseLift) {
        log(`[ERASE LIFT ${preset.id}] affectedPixels=${eraseLift.affectedPixels} ratio=${eraseLift.residualEnergyRatio}`);
        invariant(
          eraseLift.affectedPixels >= 4,
          `${preset.id}: eraser had no measurable baseline overlap`,
        );
        if (lowDensityEraser) {
          invariant(
            eraseLift.residualEnergyRatio >= 0.25
              && eraseLift.residualEnergyRatio <= 0.85,
            `${preset.id}: one low-density gesture retained `
              + `${(eraseLift.residualEnergyRatio * 100).toFixed(1)}% of baseline energy; `
              + "expected a bounded partial lift",
          );
        } else {
          invariant(
            eraseLift.residualEnergyRatio <= 0.1,
            `${preset.id}: one full-strength gesture retained `
              + `${(eraseLift.residualEnergyRatio * 100).toFixed(1)}% of baseline energy`,
          );
        }
      }
      // Extended catalogue ids intentionally materialize onto three stable renderer ids. A pill
      // can therefore show the requested pro-brush name while a stale dynamics snapshot still
      // paints visible pixels through the same renderer. Verify the durable identity + exact
      // normalized dynamics before history removes the isolated stroke. Core identities receive
      // the same persistence audit in the long-route matrix below.
      const persistedProStroke = preset.source === "pro" && operation === "paint"
        ? await waitForPersistedSingleCatalogStroke(page, expectedSelection)
        : null;
      const persistedTransparentStroke = transparentPaint
        ? await waitForPersistedSelectedOperation(page, expectedSelection, "paint", 1, false, 15_000)
        : null;
      const persistedErase = operation === "erase"
        ? await waitForPersistedSelectedOperation(
            page,
            expectedSelection,
            "erase",
            2,
            false,
          )
        : null;
      const persistedOperationMatched = operation === "erase"
        ? persistedErase?.stroke.mode === "eraser"
          && persistedErase.stroke.brush === expectedSelection.runtimeBrushId
          && persistedErase.stroke.brushCatalogId === expectedSelection.catalogId
          && persistedErase.stroke.brushCatalogName === expectedSelection.catalogName
          && persistedErase.draws[0]?.mode === "pen"
        : true;
      invariant(
        persistedOperationMatched,
        `${preset.id}: committed eraser operation did not persist after its paint baseline`,
      );
      const expectedPersistedDynamics = persistedProStroke
        ? expectedPersistedDynamicsForDefaultSelection(expectedSelection)
        : null;
      const persistedDynamicsMatched = persistedProStroke
        ? serializeStudioBrushDynamicsSettingsCanonical(persistedProStroke.brushDynamics)
          === serializeStudioBrushDynamicsSettingsCanonical(expectedPersistedDynamics)
        : null;
      invariant(
        persistedDynamicsMatched !== false,
        `${preset.id}: persisted dynamics do not match the selected catalogue profile`,
      );

      const undo = await enabledHistoryButton(page, "실행취소");
      invariant(await undo.isEnabled(), `${preset.id}: Undo control did not become enabled`);
      // Exercise the product's trusted keyboard route. Some responsive layouts render more than
      // one history control and the first DOM copy can sit underneath the document menubar.
      await page.keyboard.press("Meta+z");
      // Wait for the undo to actually SETTLE rather than for a fixed 60ms. The old constant made
      // this assertion trip on whichever brush happened to still be compositing when the clock ran
      // out — soft-glow and liner both did, on unrelated commits, at 7-10 residual pixels of Δ22
      // against a Δ20 threshold, while the diagnostic capture was visually blank paper. Polling for
      // two identical consecutive frames measures the same thing the bound below asks about, and
      // does NOT widen that bound: real residual ink still fails.
      let undone = await page.screenshot({ animations: "disabled", clip: usedClip });
      for (let settleAttempt = 0; settleAttempt < 12; settleAttempt += 1) {
        await page.waitForTimeout(60);
        const next = await page.screenshot({ animations: "disabled", clip: usedClip });
        const settled = next.equals(undone);
        undone = next;
        if (settled) break;
      }
      // Konva may re-rasterize the untouched paper by a few channel values after a history jump.
      // Ignore imperceptible antialias noise while still rejecting any residual ink above Δ20.
      const undoDiff = await compareScreenshotPixels(page, before, undone, 20);
      const undoRestoredPixels = transparentPaint || undoDiff.changedPixels <= 3;
      if (!undoRestoredPixels) {
        writeFileSync(join(SCRATCH, `studio-brush-diagnostic-${preset.id}-before.png`), before);
        writeFileSync(join(SCRATCH, `studio-brush-diagnostic-${preset.id}-stroke.png`), after);
        writeFileSync(join(SCRATCH, `studio-brush-diagnostic-${preset.id}-undo.png`), undone);
        log(`${preset.id}: settled diff ${JSON.stringify(settledDiff)}, undo diff ${JSON.stringify(undoDiff)}`);
      }
      invariant(undoRestoredPixels, `${preset.id}: Undo left perceptible stroke pixels behind`);

      const redo = await enabledHistoryButton(page, "다시실행");
      invariant(await redo.isEnabled(), `${preset.id}: Redo control did not become enabled`);
      await page.keyboard.press("Meta+Shift+z");
      await page.waitForTimeout(60);
      const redone = await page.screenshot({ animations: "disabled", clip: usedClip });
      const redoDiff = await compareScreenshotPixels(page, before, redone);
      const redoRestoredStroke = transparentPaint || hasMeaningfulPixelChange(redoDiff);
      invariant(redoRestoredStroke, `${preset.id}: Redo did not restore visible stroke pixels`);

      evidence.push({
        id: preset.id,
        source: preset.source,
        operation,
        selected: true,
        visualChanged,
        eraseLiveOperationActive,
        eraseResidualRatio: eraseLift?.residualEnergyRatio ?? null,
        undoEnabled: true,
        undoRestoredPixels,
        redoRestoredStroke,
        persistedOperationMatched,
        persistedCatalogId:
          persistedProStroke?.brushCatalogId
            ?? persistedTransparentStroke?.stroke.brushCatalogId
            ?? persistedErase?.stroke.brushCatalogId ?? null,
        persistedRuntimeBrushId:
          persistedProStroke?.brush
            ?? persistedTransparentStroke?.stroke.brush
            ?? persistedErase?.stroke.brush ?? null,
        persistedDynamicsMatched,
      });
      // Keep every catalogue entry isolated. Broad texture/pro brushes must not cover the next
      // brush's evidence lane and turn a real no-op into an apparent pixel change.
      await page.keyboard.press("Meta+z");
      await page.waitForTimeout(40);
      const cleaned = await page.screenshot({ animations: "disabled", clip: usedClip });
      const cleanupDiff = await compareScreenshotPixels(page, before, cleaned, 20);
      invariant(
        cleanupDiff.changedPixels <= 3,
        `${preset.id}: post-redo cleanup left perceptible stroke pixels behind`,
      );
      if (operation === "erase") {
        invariant(emptyBefore, `${preset.id}: eraser cleanup lost its empty baseline`);
        await page.keyboard.press("Meta+z");
        await page.waitForTimeout(80);
        const fullyCleaned = await page.screenshot({ animations: "disabled", clip: usedClip });
        const fullCleanupDiff = await compareScreenshotPixels(
          page,
          emptyBefore,
          fullyCleaned,
          20,
        );
        invariant(
          fullCleanupDiff.changedPixels <= 3,
          `${preset.id}: paint+erase cleanup left ${fullCleanupDiff.changedPixels} visible pixels`,
        );
      }
      log(
        `desktop ${index + 1}/${DESKTOP_STABILITY_CASES.length} `
          + `${preset.id}: select/${operation}/undo/redo OK`,
      );
      } catch (error) {
        // Survey mode is diagnostic only: the gate still fails at the end, but one pass
        // enumerates every broken preset instead of stopping at the first.
        if (!DESKTOP_SURVEY_MODE) throw error;
        const message = error instanceof Error ? error.message : String(error);
        surveyFailures.push(message);
        log(`SURVEY FAILURE ${index + 1}/${DESKTOP_STABILITY_CASES.length} ${message}`);
        await installCleanStudioState(page);
        // 실패 진단(캔버스 덤프·검열) 직후의 페이지는 무겁다 — 기본 7초 내비게이션
        // 타임아웃이 복구 리로드를 두 번이나 죽였다(실측). 복구에만 넉넉한 한도를 준다.
        await page.reload({ timeout: 45_000, waitUntil: "domcontentloaded" });
        await prepareStudioPage(page, studioUrl);
        await activateDesktopPen(page);
      }
    }
    if (DESKTOP_SURVEY_MODE) {
      log(`SURVEY COMPLETE: ${surveyFailures.length} failing preset(s)`);
      for (const failure of surveyFailures) log(`SURVEY -> ${failure}`);
      // Without this the mode is not diagnostic-only as advertised: the cleanup invariants throw
      // after the entry is already recorded, so a survey run could satisfy every per-entry
      // predicate and report a pass while presets were failing.
      invariant(
        surveyFailures.length === 0,
        `survey mode recorded ${surveyFailures.length} failing preset(s)`,
      );
    }

    await page.screenshot({ path: screenshot, animations: "disabled" });
    reportBrowserErrors(errors);
    invariant(errors.messages.length === 0, "desktop browser emitted console/page errors");
    invariant(errors.failedResponses.length === 0, "desktop browser received unexpected 5xx responses");
    const ok = evidence.length === DESKTOP_STABILITY_CASES.length && evidence.every((entry) =>
      entry.selected
      && entry.visualChanged
      && (entry.operation === "paint" || entry.eraseLiveOperationActive === true)
      && (
        entry.operation === "paint"
        || (
          entry.eraseResidualRatio !== null
          && (
            isStudioBrushEraserAliasId(entry.persistedRuntimeBrushId)
              ? entry.eraseResidualRatio >= 0.25
                && entry.eraseResidualRatio <= 0.85
              : entry.eraseResidualRatio <= 0.1
          )
        )
      )
      && entry.undoEnabled
      && entry.undoRestoredPixels
      && entry.redoRestoredStroke
      && entry.persistedOperationMatched
      && (
        entry.operation === "erase"
        || entry.source === "core"
        || (
          entry.persistedCatalogId === entry.id
          && entry.persistedRuntimeBrushId !== null
          && entry.persistedDynamicsMatched === true
        )
      )
    );
    return {
      ok,
      stabilityRounds: STABILITY_ROUNDS,
      uniquePresetCount: BRUSH_MATRIX_CATALOG_COUNT,
      catalogSessionCount,
      catalogDialogCount,
      catalogItemCount: PRODUCT_BRUSH_CATALOG_COUNT,
      coreCatalogItemCount: BUILT_IN_BRUSH_PRESET_COUNT,
      proCatalogItemCount: PRODUCT_BRUSH_CATALOG_COUNT - BUILT_IN_BRUSH_PRESET_COUNT,
      inspectorQuickTrayCount,
      presetCount: evidence.length,
      evidence,
      screenshot,
      catalogScreenshot,
      uiCatalogMatchSkipped: skipUiCatalogMatch,
      surveyMode: DESKTOP_SURVEY_MODE,
      errorCount: errors.messages.length + errors.failedResponses.length,
    };
  } catch (error) {
    await page.screenshot({ path: join(SCRATCH, "studio-brush-desktop-failure.png") })
      .catch(() => undefined);
    writeFileSync(join(SCRATCH, "studio-brush-desktop-failure.json"), JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      browserErrors: errors,
      surveyFailures,
      requestedRounds: STABILITY_ROUNDS,
      uniquePresetCount: BRUSH_MATRIX_CATALOG_COUNT,
    }, null, 2));
    throw error;
  } finally {
    await context.close();
  }
}

interface PersistedDrawElement {
  id: string | null;
  brush: string | null;
  brushCatalogId: string | null;
  brushCatalogName: string | null;
  brushDynamics: unknown;
  groupId: string | null;
  hidden: boolean;
  hasLivingInkReceipt: boolean;
  kind: string | null;
  mode: "pen" | "eraser";
  polygonSides: number | null;
  points: number[];
  pressures: number[];
}

interface PersistedStudioDocument {
  savedAt?: string;
  currentPageId?: string;
  pagesList?: Array<{ id?: string; elements?: unknown[] }>;
}

let builtAutosaveSqliteModulePath: string | null = null;

function resolveBuiltAutosaveSqliteModulePath(): string {
  if (builtAutosaveSqliteModulePath) return builtAutosaveSqliteModulePath;
  const manifestPath = resolve(DIST_DIR, ".vite/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
    string,
    { file?: unknown }
  >;
  const entry = manifest["apps/web/src/domains/creator/studio-autosave-sqlite-store.ts"];
  invariant(
    entry && typeof entry.file === "string" && entry.file.length > 0,
    "production manifest is missing the Studio autosave SQLite module",
  );
  builtAutosaveSqliteModulePath = `/${entry.file}`;
  return builtAutosaveSqliteModulePath;
}

async function persistedStudioDocument(page: Page): Promise<PersistedStudioDocument | null> {
  const moduleUrl = new URL(resolveBuiltAutosaveSqliteModulePath(), page.url()).href;
  return page.evaluate(async ({ autosaveKey, sqliteModuleUrl }) => {
    const sqliteModule = await import(/* @vite-ignore */ sqliteModuleUrl) as {
      acquireStudioAutosaveSqliteStore?: () => Promise<{
        read(key: string): Promise<{
          state: "snapshot" | "cleared";
          payload?: PersistedStudioDocument;
        } | null>;
      }>;
    };
    if (typeof sqliteModule.acquireStudioAutosaveSqliteStore !== "function") {
      throw new Error("built Studio autosave SQLite module has no acquisition export");
    }
    const stored = await (await sqliteModule.acquireStudioAutosaveSqliteStore()).read(autosaveKey);
    return stored?.state === "snapshot" && stored.payload ? stored.payload : null;
  }, { autosaveKey: AUTOSAVE_KEY, sqliteModuleUrl: moduleUrl });
}

/**
 * 서베이가 실패한 레인을 버리고 다음 프리셋으로 갈 때 자동저장에 남은 획을 지운다.
 *
 * installCleanStudioState 는 탭 세션당 한 번만(sessionStorage 플래그) localStorage 자동저장을
 * 비우고, 문서의 실제 저장소는 SQLite 스토어라 페이지를 다시 세워도 그대로 남는다. 그래서 한
 * 프리셋이 지속성 대기에서 죽으면 그 획이 다음 190개 프리셋의 "정확히 N개" 판정을 전부 오염시켰다
 * (실측: standard-eraser 이후 maru-pen·calligraphy·parallel-pen·perfect-ink 가 같은 메시지로 연쇄).
 */
async function wipePersistedStudioDocument(page: Page): Promise<void> {
  const moduleUrl = new URL(resolveBuiltAutosaveSqliteModulePath(), page.url()).href;
  await page.evaluate(async ({ autosaveKey, sqliteModuleUrl, cleanSessionKey }) => {
    const sqliteModule = await import(/* @vite-ignore */ sqliteModuleUrl) as {
      acquireStudioAutosaveSqliteStore?: () => Promise<{
        clear(key: string): Promise<void>;
      }>;
    };
    if (typeof sqliteModule.acquireStudioAutosaveSqliteStore === "function") {
      await (await sqliteModule.acquireStudioAutosaveSqliteStore()).clear(autosaveKey);
    }
    // 다음 내비게이션의 init 스크립트가 localStorage 자동저장도 다시 비우게 한다.
    window.sessionStorage.removeItem(cleanSessionKey);
  }, { autosaveKey: AUTOSAVE_KEY, sqliteModuleUrl: moduleUrl, cleanSessionKey: CLEAN_SESSION_KEY });
}

function drawElementsFromPersistedDocument(
  document: PersistedStudioDocument | null,
): PersistedDrawElement[] {
  if (!document?.pagesList) return [];
  const pageRecord = document.pagesList.find((candidate) => candidate.id === document.currentPageId)
    ?? document.pagesList[0];
  return (pageRecord?.elements ?? []).flatMap((element) => {
    if (!element || typeof element !== "object" || Array.isArray(element)) return [];
    const record = element as Record<string, unknown>;
    if (record.type !== "draw") return [];
    const shapeParams = record.shapeParams;
    const polygonSides = shapeParams && typeof shapeParams === "object" && !Array.isArray(shapeParams)
      && typeof (shapeParams as Record<string, unknown>).polygonSides === "number"
      ? (shapeParams as Record<string, number>).polygonSides
      : null;
    return [{
      id: typeof record.id === "string" ? record.id : null,
      brush: typeof record.brush === "string" ? record.brush : null,
      brushCatalogId: typeof record.brushCatalogId === "string"
        ? record.brushCatalogId
        : null,
      brushCatalogName: typeof record.brushCatalogName === "string"
        ? record.brushCatalogName
        : null,
      brushDynamics: record.brushDynamics,
      groupId: typeof record.groupId === "string" ? record.groupId : null,
      hidden: record.hidden === true,
      hasLivingInkReceipt: record.livingInkReceipt != null,
      kind: typeof record.kind === "string" ? record.kind : "freehand",
      mode: record.mode === "eraser" ? "eraser" as const : "pen" as const,
      polygonSides,
      points: Array.isArray(record.points)
        ? record.points.filter((value): value is number =>
            typeof value === "number" && Number.isFinite(value)
          )
        : [],
      pressures: Array.isArray(record.pressures)
        ? record.pressures.filter((value): value is number =>
            typeof value === "number" && Number.isFinite(value)
          )
        : [],
    }];
  });
}

async function waitForPersistedDrawElements(
  page: Page,
  predicate: (draws: PersistedDrawElement[]) => boolean,
  label: string,
  timeoutMilliseconds = 8_000,
): Promise<PersistedDrawElement[]> {
  const deadline = performance.now() + timeoutMilliseconds;
  let latest: PersistedDrawElement[] = [];
  let lastFailure: unknown = null;
  while (performance.now() < deadline) {
    try {
      latest = drawElementsFromPersistedDocument(await persistedStudioDocument(page));
      if (predicate(latest)) return latest;
      lastFailure = null;
    } catch (cause: unknown) {
      lastFailure = cause;
    }
    await page.waitForTimeout(100);
  }
  // 타임아웃 메시지에 "몇 개"만 남기면 어떤 획이 왜 남아 있는지 알 수 없어, 같은 원인이
  // 다음 190개 프리셋으로 번져도 원인을 못 잡는다. 남아 있는 획의 정체를 함께 적는다.
  // 그림 요소로 해석되지 않은 것까지 포함해 페이지에 실제로 무엇이 저장됐는지 종류별로 센다 —
  // 지우개가 draw 가 아닌 다른 종류로 저장되기 시작했다면 그 사실이 여기서만 보인다.
  const rawKinds = await persistedStudioDocument(page)
    .then((document) => {
      const pageRecord = document?.pagesList?.find((candidate) => candidate.id === document?.currentPageId)
        ?? document?.pagesList?.[0];
      const counts = new Map<string, number>();
      for (const element of pageRecord?.elements ?? []) {
        const record = element as { type?: unknown; mode?: unknown; kind?: unknown } | null;
        const key = `${String(record?.type ?? "?")}${record?.mode ? `:${String(record.mode)}` : ""}${record?.kind ? `:${String(record.kind)}` : ""}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.entries()].map(([key, count]) => `${key}×${count}`).join(", ") || "none";
    })
    .catch((cause: unknown) => `unreadable: ${cause instanceof Error ? cause.message : String(cause)}`);
  const durable = latest.map((draw) => [
    draw.id,
    draw.brush,
    draw.mode,
    `pts=${draw.points.length}`,
    draw.hidden ? "hidden" : "",
    draw.groupId !== null ? `group=${draw.groupId}` : "",
    draw.hasLivingInkReceipt ? "living-ink-receipt" : "",
  ].filter(Boolean).join("/")).join(" | ");
  const suffix = lastFailure instanceof Error
    ? `; last SQLite read failed: ${lastFailure.message}`
    : `; last durable draw count: ${latest.length} [${durable}] raw=[${rawKinds}]`;
  throw new Error(`${label} timed out after ${timeoutMilliseconds}ms${suffix}`);
}

async function persistedDrawElements(page: Page): Promise<PersistedDrawElement[]> {
  return drawElementsFromPersistedDocument(await persistedStudioDocument(page));
}

async function waitForPersistedSingleCatalogStroke(
  page: Page,
  expected: StudioBrushCatalogSelection,
): Promise<PersistedDrawElement> {
  const [saved] = await waitForPersistedDrawElements(page, (draws) => {
    const draw = draws[0];
    return draws.length === 1
      && draw?.brushCatalogId === expected.catalogId
      && draw.brushCatalogName === expected.catalogName
      && draw.brush === expected.runtimeBrushId
      && !draw.hidden
      && draw.groupId === null
      && !draw.hasLivingInkReceipt
      && draw.points.length >= 4
      && Boolean(draw.brushDynamics)
      && typeof draw.brushDynamics === "object";
  }, `${expected.catalogId}: SQLite autosave did not expose the isolated pro stroke`);
  invariant(saved, `${expected.catalogId}: autosave did not expose the isolated pro stroke`);
  invariant(
    saved.brushCatalogId === expected.catalogId,
    `${expected.catalogId}: persisted catalogue id is ${saved.brushCatalogId ?? "missing"}`,
  );
  invariant(
    saved.brushCatalogName === expected.catalogName,
    `${expected.catalogId}: persisted catalogue name is ${saved.brushCatalogName ?? "missing"}`,
  );
  invariant(
    saved.brush === expected.runtimeBrushId,
    `${expected.catalogId}: persisted runtime brush is ${saved.brush ?? "missing"}, expected ${expected.runtimeBrushId}`,
  );
  invariant(!saved.hidden, `${expected.catalogId}: ordinary stroke was hidden after pointerup`);
  invariant(saved.groupId === null, `${expected.catalogId}: ordinary stroke was grouped after pointerup`);
  invariant(
    !saved.hasLivingInkReceipt,
    `${expected.catalogId}: ordinary stroke unexpectedly entered the Living Ink document route`,
  );
  return saved;
}

function pointsEqual(
  points: readonly number[],
  leftIndex: number,
  rightIndex: number,
  tolerance = 0.02,
): boolean {
  return Math.abs(points[leftIndex * 2]! - points[rightIndex * 2]!) <= tolerance
    && Math.abs(points[leftIndex * 2 + 1]! - points[rightIndex * 2 + 1]!) <= tolerance;
}

function hasNonDegenerateBounds(points: readonly number[]): boolean {
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  return Math.max(...xs) - Math.min(...xs) > 1
    && Math.max(...ys) - Math.min(...ys) > 1;
}

/**
 * Selected-brush Smart Shape deliberately persists a freehand render path: that is how pressure,
 * calligraphy and textured brush engines can replay the snapped outline in Canvas and SVG. Merely
 * accepting `kind: "freehand"` would hide a recognition regression, though, so verify the exact
 * outline topology emitted for each recognized primitive. The legacy geometry branch remains
 * described for diagnostics but is not accepted by the current default-pen browser scenario.
 */
function persistedSmartShapeRepresentation(
  saved: PersistedDrawElement | undefined,
  fixture: Readonly<{
    expectedKind: SmartShapeExpectedKind;
    expectedPolygonSides?: number;
  }>,
): "brush-outline" | "geometry" | null {
  if (!saved || saved.points.length < 4 || saved.points.length % 2 !== 0) return null;
  if (saved.kind === fixture.expectedKind) {
    if (
      fixture.expectedPolygonSides !== undefined
      && saved.polygonSides !== fixture.expectedPolygonSides
    ) return null;
    return "geometry";
  }
  if (saved.kind !== "freehand" || !saved.brush) return null;

  const sampleCount = saved.points.length / 2;
  const closed = sampleCount >= 2 && pointsEqual(saved.points, 0, sampleCount - 1);
  if (fixture.expectedKind === "line") {
    return sampleCount === 2 && !pointsEqual(saved.points, 0, 1)
      ? "brush-outline"
      : null;
  }
  if (!closed || !hasNonDegenerateBounds(saved.points)) return null;
  if (fixture.expectedKind === "rect") {
    return sampleCount === 5 ? "brush-outline" : null;
  }
  if (fixture.expectedKind === "triangle") {
    return sampleCount === 4 ? "brush-outline" : null;
  }
  if (fixture.expectedKind === "polygon") {
    return sampleCount === (fixture.expectedPolygonSides ?? 0) + 1
      ? "brush-outline"
      : null;
  }
  // Ellipse output is adaptively sampled but always has at least 32 unique outline points plus
  // the explicit closing sample. A hand-drawn closed gesture contains the verifier's much smaller
  // fixture route and therefore cannot accidentally satisfy this contract.
  return sampleCount >= 33 ? "brush-outline" : null;
}

async function waitForPersistedDrawCount(page: Page, expectedCount: number): Promise<void> {
  await waitForPersistedDrawElements(
    page,
    (draws) => draws.length >= expectedCount,
    `SQLite autosave did not reach ${expectedCount} draws`,
  );
}

async function waitForPersistedSelectedOperation(
  page: Page,
  expected: StudioBrushCatalogSelection,
  operation: VerifierBrushOperation,
  expectedDrawCount: number,
  requireCatalogIdentity: boolean,
  timeoutMilliseconds = 5_000,
): Promise<{
  stroke: PersistedDrawElement;
  draws: PersistedDrawElement[];
}> {
  const draws = await waitForPersistedDrawElements(page, (candidates) => {
    if (candidates.length !== expectedDrawCount) return false;
    if (candidates.some((draw) => (
      draw.hidden || draw.groupId !== null || draw.hasLivingInkReceipt
    ))) return false;
    const draw = candidates.at(-1);
    if (!draw || draw.points.length < 4) return false;
    if (operation === "erase") {
      return draw.mode === "eraser"
        && draw.brush === expected.runtimeBrushId
        && draw.brushCatalogId === expected.catalogId
        && draw.brushCatalogName === expected.catalogName;
    }
    return draw.mode !== "eraser"
      && draw.brush === expected.runtimeBrushId
      && (
        !requireCatalogIdentity
        || (
          draw.brushCatalogId === expected.catalogId
          && draw.brushCatalogName === expected.catalogName
          && Boolean(draw.brushDynamics)
          && typeof draw.brushDynamics === "object"
        )
      );
  }, `${expected.catalogId}: SQLite autosave did not expose the selected ${operation} operation`,
  timeoutMilliseconds);
  invariant(
    draws.length === expectedDrawCount,
    `${expected.catalogId}: autosave exposed ${draws.length}/${expectedDrawCount} draw operations`,
  );
  const stroke = draws.at(-1);
  invariant(stroke, `${expected.catalogId}: autosave did not expose the selected operation`);
  invariant(
    operation === "erase"
      ? stroke.mode === "eraser" && stroke.brush === expected.runtimeBrushId
      : stroke.mode === "pen" && stroke.brush === expected.runtimeBrushId,
    `${expected.catalogId}: autosave persisted the wrong ${operation} operation`,
  );
  invariant(
    draws.every((draw) => !draw.hidden),
    `${expected.catalogId}: an ordinary operation was hidden after pointerup`,
  );
  invariant(
    draws.every((draw) => draw.groupId === null),
    `${expected.catalogId}: an ordinary operation gained a group id`,
  );
  invariant(
    draws.every((draw) => !draw.hasLivingInkReceipt),
    `${expected.catalogId}: an ordinary operation entered the Living Ink document route`,
  );
  return { stroke, draws };
}

function persistedStrokePathDistance(points: readonly number[]): number {
  let distance = 0;
  for (let offset = 2; offset + 1 < points.length; offset += 2) {
    distance += Math.hypot(
      points[offset]! - points[offset - 2]!,
      points[offset + 1]! - points[offset - 1]!,
    );
  }
  return distance;
}

function longBrushArtifactPath(
  scratch: string,
  path: string,
): LongBrushArtifactPath {
  return {
    absolute: resolve(path),
    relativeToScratch: relative(resolve(scratch), resolve(path)),
  };
}

function decodeLongBrushQualityImage(buffer: Buffer) {
  const image = decodePng(new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  ));
  const raw = image.getRawImage();
  return {
    width: image.width,
    height: image.height,
    channels: image.channels,
    data: raw.data,
  };
}

function saveLongBrushQualityArtifacts(
  runDirectory: string,
  index: number,
  id: string,
  images: Readonly<{
    baseline: Buffer;
    live: Buffer;
    released: Buffer;
    settled: Buffer;
  }>,
): LongBrushQualityArtifacts {
  const safeId = id.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  const directory = join(
    runDirectory,
    `${String(index + 1).padStart(3, "0")}-${safeId}`,
  );
  mkdirSync(directory, { recursive: true });
  const paths = {
    baseline: join(directory, "00-baseline.png"),
    live: join(directory, "01-live-pointer-down.png"),
    released: join(directory, "02-released-immediate.png"),
    settled: join(directory, "03-settled-autosaved.png"),
  };
  writeFileSync(paths.baseline, images.baseline);
  writeFileSync(paths.live, images.live);
  writeFileSync(paths.released, images.released);
  writeFileSync(paths.settled, images.settled);
  return {
    baseline: longBrushArtifactPath(SCRATCH, paths.baseline),
    live: longBrushArtifactPath(SCRATCH, paths.live),
    released: longBrushArtifactPath(SCRATCH, paths.released),
    settled: longBrushArtifactPath(SCRATCH, paths.settled),
  };
}

function summarizeLongBrushQualityTransition(
  evidence: readonly LongBrushQualityEvidence[],
  key: keyof StudioLongBrushQualityResult["transitions"],
) {
  const transitions = evidence.map((entry) => entry.quality.transitions[key]);
  const mean = (values: readonly number[]) => values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
  const maximum = (values: readonly number[]) => Math.max(0, ...values);
  return {
    analyzedBrushCount: transitions.length,
    exactPixelParityBrushCount: transitions.filter(
      ({ rawChangedPixels }) => rawChangedPixels === 0,
    ).length,
    maximumRawChangedPixels: maximum(
      transitions.map(({ rawChangedPixels }) => rawChangedPixels),
    ),
    maximumRawChangedPixelRatio: maximum(
      transitions.map(({ rawChangedPixelRatio }) => rawChangedPixelRatio),
    ),
    maximumChannelDelta: maximum(
      transitions.map(({ maxChannelDelta }) => maxChannelDelta),
    ),
    meanEnergyRatio: mean(transitions.map(({ energyRatio }) => energyRatio)),
    meanPerPixelDifferenceRatio: mean(
      transitions.map(({ perPixelDifferenceRatio }) => perPixelDifferenceRatio),
    ),
    meanShapeDifferenceRatio: mean(
      transitions.map(({ shapeDifferenceRatio }) => shapeDifferenceRatio),
    ),
    maximumBoundsDriftPx: maximum(
      transitions.flatMap(({ boundsDriftPx }) =>
        boundsDriftPx === null ? [] : [boundsDriftPx]
      ),
    ),
    maximumCentroidDriftPx: maximum(
      transitions.flatMap(({ centroidDriftPx }) =>
        centroidDriftPx === null ? [] : [centroidDriftPx]
      ),
    ),
    maximumCenterlineDriftPx: maximum(
      transitions.flatMap(({ centerlineDriftPx }) =>
        centerlineDriftPx === null ? [] : [centerlineDriftPx]
      ),
    ),
  };
}

function writeLongBrushQualityReport(input: Readonly<{
  reportPath: string;
  runDirectory: string;
  evidence: readonly LongBrushQualityEvidence[];
  completed: boolean;
}>): void {
  const policyCounts: Record<
    StudioLongBrushQualityResult["policy"]["kind"],
    number
  > = {
    "strict-continuous": 0,
    "soft-wet-continuous": 0,
    "record-only-discrete": 0,
    "record-only-transparent": 0,
  };
  for (const entry of input.evidence) {
    policyCounts[entry.quality.policy.kind] += 1;
  }
  writeFileSync(input.reportPath, `${JSON.stringify({
    schemaVersion: STUDIO_LONG_BRUSH_QUALITY_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: LONG_BRUSH_MATRIX_MODE,
    expectedPresetCount: LONG_BRUSH_CATALOG_COUNT,
    analyzedPresetCount: input.evidence.length,
    completed: input.completed,
    runDirectory: longBrushArtifactPath(SCRATCH, input.runDirectory),
    reportPath: longBrushArtifactPath(SCRATCH, input.reportPath),
    measurementContract: {
      capturesPerBrush: [
        "00-baseline",
        "01-live-pointer-down",
        "02-released-immediate",
        "03-settled-autosaved",
      ],
      identicalCropWithinBrush: true,
      uiContamination:
        "The crop is confined to the exposed central canvas, both route endpoints must pass "
        + "elementFromPoint(.konvajs-content), and the brush HUD is hidden by verifier-only CSS "
        + "before the gesture. The immediate release frame is captured before any pointer move "
        + "or wait, so fixed and transient editor chrome never contributes to the ROI.",
      cursorIsolation:
        "The isolated browser context persists brushCursorStyle='none' in an init script before "
        + "Studio initializes. All transition metrics therefore compare the complete ink ROI; "
        + "no endpoint pixels are masked.",
      startCirclePolicy:
        "No route pixels are masked; a live-only circular start deposit is a hard "
        + "continuous-carrier failure.",
      transparentWashPolicy:
        "A brush that deposits no pigment (studioWetInkBrushDepositsPigment=false) is "
        + "record-only-transparent: its live wet hint is recorded, and any ink left in the "
        + "released or settled frame is a transparent-wash-residue error because it can only be "
        + "another stroke's pigment resurrected by the shared wash.",
      exactTransitionPolicy:
        "Every transition reports rawChangedPixels/maxChannelDelta at zero RGB tolerance as well "
        + "as perceptible changedPixels. released-to-settled exact parity therefore cannot be "
        + "hidden by the perceptual threshold.",
      intentionalDiscretePolicy:
        "Authored particles, motifs, tones, and stamps retain metrics and PNGs but new "
        + "continuous-carrier findings are record-only.",
    },
    policyCounts,
    qualityFailureCount: input.evidence.filter((entry) => !entry.quality.ok).length,
    transitionSummary: {
      liveToReleased: summarizeLongBrushQualityTransition(
        input.evidence,
        "liveToReleased",
      ),
      liveToSettled: summarizeLongBrushQualityTransition(
        input.evidence,
        "liveToSettled",
      ),
      releasedToSettled: summarizeLongBrushQualityTransition(
        input.evidence,
        "releasedToSettled",
      ),
    },
    representativeFailures: input.evidence
      .filter((entry) => !entry.quality.ok)
      .slice(0, 12)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        policy: entry.quality.policy,
        findings: entry.quality.findings.filter(({ level }) => level === "error"),
        artifacts: entry.artifacts,
      })),
    evidence: input.evidence,
  }, null, 2)}\n`);
}

async function runLongBrushMatrix(browser: Browser, studioUrl: string): Promise<LongBrushResult> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  // 아래 진단 스크립트는 이름 있는 함수 표현식을 담고 있어 tsx(keep-names) 직렬화가
  // esbuild `__name` 헬퍼 호출을 남긴다 — 페이지 수준 폴리필(installCleanStudioState)보다
  // 컨텍스트 init 스크립트가 먼저 돌므로 여기서도 먼저 채운다.
  await context.addInitScript({
    content:
      "globalThis.__name ??= (fn) => fn;"
      + " globalThis.__studioDynamicSealDebugEnabled = true;",
  });
  // 채널 2 진단: 모든 캔버스 2D 컨텍스트의 setTransform 스케일을 기록해 커밋 렌더가
  // 실제 어떤 물리 배율에서 래스터되는지 덤프와 함께 확인한다.
  await context.addInitScript(() => {
    const w = globalThis as unknown as { __studioCtxScales?: Record<string, number[]> };
    w.__studioCtxScales = {};
    let canvasSeq = 0;
    const original = CanvasRenderingContext2D.prototype.setTransform;
    CanvasRenderingContext2D.prototype.setTransform = function patched(
      this: CanvasRenderingContext2D,
      ...args: unknown[]
    ) {
      try {
        const canvas = this.canvas;
        if (canvas) {
          if (!canvas.dataset.__ctxId) {
            canvas.dataset.__ctxId = `c${canvasSeq++}`;
          }
          const id = canvas.dataset.__ctxId;
          const a = Number(args[0]);
          const d = Number(args[3]);
          if (Number.isFinite(a) && Number.isFinite(d) && args.length >= 6) {
            const scale = Math.hypot(a, d);
            (w.__studioCtxScales![id] ??= []).push(+scale.toFixed(4));
          }
        }
      } catch {
        // diagnostics must never break rendering
      }
      return original.apply(this, args as never);
    } as typeof CanvasRenderingContext2D.prototype.setTransform;
  });
  const page = await context.newPage();
  if (DEBUG_BRUSH_VERIFIER) {
    page.on("console", (entry) => {
      log(`console(${entry.type()}):${entry.text()}`);
    });
  }
  const errors = collectBrowserErrors(page, "long-brushes", studioUrl);
  const qualityRunDirectory = join(
    resolve(SCRATCH),
    `long-brush-matrix-${LONG_BRUSH_MATRIX_MODE}-${Date.now()}`,
  );
  const qualityReportPath = join(qualityRunDirectory, "long-brush-quality-report.json");
  mkdirSync(qualityRunDirectory, { recursive: true });
  const screenshot = join(
    SCRATCH,
    `studio-brush-desktop-long-${LONG_BRUSH_CATALOG_COUNT}.png`,
  );

  try {
    await prepareStudioPage(page, studioUrl);
    await activateDesktopPen(page);
    const stage = page.locator(".konvajs-content").first();
    const stageBox = await stage.boundingBox();
    const viewport = page.viewportSize();
    invariant(stageBox && viewport, "could not measure canvas for the long-brush matrix");

    const safeLeft = Math.max(stageBox.x + 70, viewport.width * 0.34);
    const safeRight = Math.min(stageBox.x + stageBox.width - 70, viewport.width * 0.69);
    const safeTop = Math.max(stageBox.y + 70, viewport.height * 0.18);
    // The Konva surface continues behind the bottom zoom/density dock. Keep every lane in
    // the exposed paper so elementFromPoint proves the browser gesture reaches canvas.
    const safeBottom = Math.min(stageBox.y + stageBox.height - 70, viewport.height * 0.52);
    invariant(safeRight - safeLeft >= 300, "visible canvas is too narrow for a 300 px stroke");
    invariant(
      safeBottom - safeTop >= 120,
      "visible canvas is too short for the isolated long-brush lane",
    );

    const evidence: LongBrushStrokeEvidence[] = [];
    const qualityEvidence: LongBrushQualityEvidence[] = [];
    for (const [index, preset] of LONG_BRUSH_CATALOG_ITEMS.entries()) {
      /**
       * 서베이 모드에서는 어떤 불변식이 깨져도 이 프리셋만 기록하고 다음으로 간다. 잔여 획이
       * 다음 레인을 오염시키지 않도록 페이지는 반드시 새로 세운다. 서베이가 아니면 예전처럼
       * 첫 실패에서 즉시 멈춘다 — 게이트의 엄격함은 그대로다.
       */
      const outcome = await (async (): Promise<"done" | "skipped"> => {
        const expectedSelection = await materializeStudioBrushCatalogSelection(preset.id);
        invariant(expectedSelection, `${preset.id}: long-route catalogue selection did not materialize`);
        invariant(
          preset.source === "core" || expectedSelection.brushDynamics,
          `${preset.id}: long-route pro selection has no runtime dynamics`,
        );
        const operation = verifierBrushOperation(expectedSelection);
        await selectDesktopBrush(page, preset, expectedSelection);
        await page.mouse.move(4, 4);
        // Every preset gets the same clean lane. Packing all brushes into the visible 300 px height
        // made a broad preceding stroke cover a thin successor (notably pen → fineliner), so a
        // screenshot diff falsely reported a truncated route even though autosave held both exact
        // endpoints. The verified Undo below clears ink before the next preset.
        const y = safeTop + (safeBottom - safeTop) / 2;
        const startX = safeLeft;
        const endX = safeRight;
        const qualityMarginX = Math.max(
          32,
          Math.min(90, expectedSelection.defaultWidth * 1.25),
        );
        const qualityMarginY = Math.max(
          48,
          Math.min(104, expectedSelection.defaultWidth * 1.65),
        );
        const clip = sanitizeEvidenceClip({
          x: Math.floor(startX - qualityMarginX),
          y: Math.floor(y - qualityMarginY),
          width: Math.ceil(endX - startX + qualityMarginX * 2),
          height: Math.ceil(qualityMarginY * 2 + 4),
        }, viewport);
        const routeSegmentXRange = {
          start: startX - clip.x,
          end: endX - clip.x,
        };
        const eraseBaseline = operation === "erase"
          ? await prepareVisibleEraserBaseline(page, {
              start: { x: startX, y },
              end: { x: endX, y: y + 4 },
            }, clip)
          : null;
        if (eraseBaseline) {
          await selectDesktopBrush(page, preset, expectedSelection);
        }
        const emptyBefore = eraseBaseline?.empty ?? null;
        const before = eraseBaseline?.painted
          ?? await captureStableEvidence(page, clip);
        const canvasReceivesStart = await page.evaluate(({ x, y: pointY }) =>
          document.elementFromPoint(x, pointY)?.closest(".konvajs-content") !== null,
        { x: startX, y: y });
        const canvasReceivesEnd = await page.evaluate(({ x, y: pointY }) =>
          document.elementFromPoint(x, pointY)?.closest(".konvajs-content") !== null,
        { x: endX, y: y + 4 });
        invariant(canvasReceivesStart && canvasReceivesEnd, `${preset.id}: long-stroke route is covered by editor chrome`);

        // One dispatched long move deliberately stresses sparse/fast pointer delivery. Every brush
        // renderer must interpolate its own route instead of painting only the endpoints or dropping
        // a capped prefix.
        await page.mouse.move(startX, y);
        await page.mouse.down();
        await page.mouse.move(endX, y + 4);
        // Capture the renderer's real pointer-down authority before pointerup can swap it for the
        // retained/committed representation. brushCursorStyle='none' was installed before Studio
        // initialized, so the complete live ROI is compared without an endpoint exclusion.
        await page.waitForTimeout(50);
        if (process.env.TOONSPECTRUM_LONG_BRUSH_CANVAS_DUMP === "1") {
          const dump = await page.evaluate(() =>
            Array.from(document.querySelectorAll("canvas"), (canvas, index) => ({
              index,
              w: canvas.width,
              h: canvas.height,
              cls: (canvas.className ?? "").toString().slice(0, 48),
              id: canvas.id,
              parent: canvas.parentElement?.className?.toString().slice(0, 64) ?? "",
              cssW: canvas.getBoundingClientRect().width,
              cssH: canvas.getBoundingClientRect().height,
              dpr: globalThis.devicePixelRatio ?? 1,
              url: canvas.toDataURL("image/png"),
            })),
          );
          const dumpDir = join(SCRATCH, `canvas-dump-${preset.id}-live`);
          mkdirSync(dumpDir, { recursive: true });
          const ctxScales = await page.evaluate(
            () => (globalThis as unknown as { __studioCtxScales?: Record<string, number[]> }).__studioCtxScales ?? {},
          );
          writeFileSync(join(SCRATCH, `canvas-dump-${preset.id}-live-manifest.json`), JSON.stringify({
            canvases: dump.map(({ url: _url, ...rest }) => rest),
            ctxScales,
          }, null, 1));
          for (const entry of dump) {
            const base64 = entry.url.split(",")[1] ?? "";
            if (!base64) continue;
            writeFileSync(
              join(dumpDir, `${String(entry.index).padStart(2, "0")}-${entry.w}x${entry.h}.png`),
              Buffer.from(base64, "base64"),
            );
          }
        }
        const live = await page.screenshot({ animations: "disabled", clip });
        if (operation === "erase") {
          invariant(
            await page.evaluate(() =>
              document.querySelector('[data-studio-draw-options="true"]')
                ?.getAttribute("data-studio-active-draw-mode") === "eraser"
            ),
            `${preset.id}: long pointer-down gesture lost eraser operation authority`,
          );
        }
        await page.mouse.up();
        const released = await page.screenshot({ animations: "disabled", clip });
        if (process.env.TOONSPECTRUM_LONG_BRUSH_CANVAS_DUMP === "1") {
          const dump = await page.evaluate(() =>
            Array.from(document.querySelectorAll("canvas"), (canvas, index) => ({
              index,
              w: canvas.width,
              h: canvas.height,
              cls: (canvas.className ?? "").toString().slice(0, 48),
              id: canvas.id,
              parent: canvas.parentElement?.className?.toString().slice(0, 64) ?? "",
              cssW: canvas.getBoundingClientRect().width,
              cssH: canvas.getBoundingClientRect().height,
              dpr: globalThis.devicePixelRatio ?? 1,
              url: canvas.toDataURL("image/png"),
            })),
          );
          const dumpDir = join(SCRATCH, `canvas-dump-${preset.id}-released`);
          mkdirSync(dumpDir, { recursive: true });
          for (const entry of dump) {
            const base64 = entry.url.split(",")[1] ?? "";
            if (!base64) continue;
            writeFileSync(
              join(dumpDir, `${String(entry.index).padStart(2, "0")}-${entry.w}x${entry.h}.png`),
              Buffer.from(base64, "base64"),
            );
          }
        }
        await page.mouse.move(4, 4);
        const immediateCoverage = await compareScreenshotCoverage(
          page,
          before,
          released,
          6,
          3,
          routeSegmentXRange,
        );
        /**
         * 물붓처럼 안료를 얹지 않는 도구는 빈 종이에서 아무것도 남기지 않는 것이 제품 계약이다.
         * 여기서 픽셀을 요구하면 studio-ink-wash-feel 이 단언하는 것과 정반대를 요구하게 된다 —
         * 그 도구가 "기존 잉크를 움직이는가"는 유닛 계약이 따로 검증한다.
         */
        const depositsPigment = studioWetInkBrushDepositsPigment(expectedSelection.runtimeBrushId);
        if (depositsPigment) {
          invariant(
            hasMeaningfulPixelChange(immediateCoverage),
            `${preset.id}: fast long stroke produced no immediate visible pixels`,
          );
        }
        if (DEBUG_BRUSH_VERIFIER && preset.id === "perfect-ink") {
          const perfectDebugState = await page.evaluate(() =>
            (globalThis as {
              __perfectInkDebugState?: {
                brush: string;
                pointCount: number;
                strokeDistance: number;
                isVeryShort: boolean;
                isSparseLong: boolean;
                profile: string;
                outlineDistance: number;
                outlinePointCount: number;
                isDegeneratePath: boolean;
              } | null;
            }).__perfectInkDebugState ?? null,
          );
            log(`DEBUG ${preset.id} long:${JSON.stringify(perfectDebugState)}`);
        }
        await page.waitForTimeout(280);
        if (DEBUG_BRUSH_VERIFIER && preset.id === "perfect-ink") {
          const settledPerfectDebugState = await page.evaluate(() =>
            (globalThis as {
              __perfectInkDebugState?: {
                brush: string;
                pointCount: number;
                strokeDistance: number;
                isVeryShort: boolean;
                isSparseLong: boolean;
                profile: string;
                outlineDistance: number;
                outlinePointCount: number;
                isDegeneratePath: boolean;
              } | null;
            }).__perfectInkDebugState ?? null,
          );
          log(`DEBUG ${preset.id} long-settled:${JSON.stringify(settledPerfectDebugState)}`);
        }
        const persistedOperation = await waitForPersistedSelectedOperation(
          page,
          expectedSelection,
          operation,
          operation === "erase" ? 2 : 1,
          preset.source === "pro" && operation === "paint",
          // Living Ink completes a deterministic 120-tick release settle before its canonical PNG
          // transaction becomes durable. Preserve the ordinary 5 s brush contract elsewhere, but
          // give this quality matrix the same bounded 15 s handoff window as the product surface.
          15_000,
        );
        const saved = persistedOperation.stroke;
        const settled = await page.screenshot({ animations: "disabled", clip });
        const descriptor = studioBrushPackDescriptorById(preset.id);
        const dryMediaClassification = classifyStudioDryMediaCatalogIdV1(preset.id);
        const intentionalDiscrete = dryMediaClassification
          ? dryMediaClassification.kind === "intentional-discrete"
          : descriptor
            ? studioBrushPresetUsesIntentionalDiscreteCarrier(descriptor)
            // Imported CC0 presets declare discreteness from their own upstream parameters, so a
            // faithfully sparse splatter records density instead of failing a continuity gate.
            : studioCc0MypaintPresetUsesIntentionalDiscreteCarrier(preset.id);
        const classifiedQualityPolicy = classifyStudioLongBrushQualityPolicy({
          id: preset.id,
          source: preset.source,
          runtimeBrushId: expectedSelection.runtimeBrushId,
          mediaGroup: preset.mediaGroup,
          previewStyle: preset.previewStyle,
          intentionalDiscrete,
          depositsPigment,
        });
        // Erasers replay their exact full compound path on the retained main layer, so the same
        // continuous live/release/settled quality policy now applies to destination-out strokes.
        const qualityPolicy = classifiedQualityPolicy;
        const sampleCount = Math.max(33, Math.ceil(endX - startX) + 1);
        const localRoutePoints = Array.from({ length: sampleCount }, (_, sampleIndex) => {
          const amount = sampleIndex / Math.max(1, sampleCount - 1);
          return {
            x: startX - clip.x + (endX - startX) * amount,
            y: y - clip.y + 4 * amount,
          };
        });
        const crossSectionRadius = Math.max(
          10,
          Math.min(46, expectedSelection.defaultWidth * 1.5),
        );
        const cursorIgnoreRadius = 0;
        const quality = analyzeStudioLongBrushQuality({
          policy: qualityPolicy,
          baseline: decodeLongBrushQualityImage(before),
          live: decodeLongBrushQualityImage(live),
          released: decodeLongBrushQualityImage(released),
          settled: decodeLongBrushQualityImage(settled),
          route: {
            points: localRoutePoints,
            crossSectionRadius,
            cursorIgnoreRadius,
            nominalWidth: expectedSelection.defaultWidth,
          },
        });
        const qualityArtifacts = saveLongBrushQualityArtifacts(
          qualityRunDirectory,
          index,
          preset.id,
          {
            baseline: before,
            live,
            released,
            settled,
          },
        );
        qualityEvidence.push({
          id: preset.id,
          name: preset.name,
          source: preset.source,
          runtimeBrushId: expectedSelection.runtimeBrushId,
          capture: {
            clip,
            localRouteStart: localRoutePoints[0]!,
            localRouteEnd: localRoutePoints.at(-1)!,
            brushCursorStyle: "none",
            endpointExclusion: {
              enabled: false,
              center: localRoutePoints.at(-1)!,
              radius: 0,
            },
          },
          quality,
          artifacts: qualityArtifacts,
        });
        writeLongBrushQualityReport({
          reportPath: qualityReportPath,
          runDirectory: qualityRunDirectory,
          evidence: qualityEvidence,
          completed: false,
        });
        for (const finding of quality.findings) {
          log(
            `${preset.id}: quality ${finding.level.toUpperCase()} `
              + `${finding.code} — ${finding.message}`,
          );
        }
        if (REQUESTED_BRUSH_VERIFY_IDS.length > 0) {
          // 집중 진단 모드에서는 성공/실패와 무관하게 지속 요소의 압력 채널을 읽는다 — 라이브
          // 합성 압력(속도 모델)과 커밋 재생 압력의 괴리(erodible energy-collapse 0.35 실측)를
          // 요소 데이터에서 직접 가른다.
          try {
            const persisted = await persistedDrawElements(page);
            const lastDraw = persisted.at(-1) as
              | { points?: readonly number[]; pressures?: readonly number[] }
              | undefined;
            const pressures = lastDraw?.pressures ?? [];
            log(
              `${preset.id}: long persisted pressures n=${pressures.length} `
                + `head=${JSON.stringify(pressures.slice(0, 6).map((value) => Number(value.toFixed(3))))} `
                + `tail=${JSON.stringify(pressures.slice(-4).map((value) => Number(value.toFixed(3))))}`,
            );
          } catch (cause) {
            log(`${preset.id}: long persisted pressures read failed ${String(cause)}`);
          }
          const liveOverlayDebug = await page.evaluate(() => ({
            seal: (globalThis as { __studioDynamicSealDebug?: unknown }).__studioDynamicSealDebug ?? null,
            release: (globalThis as { __studioDynamicReleaseDebug?: unknown }).__studioDynamicReleaseDebug ?? null,
          }));
          log(`${preset.id}: long live-overlay breadcrumbs ${JSON.stringify(liveOverlayDebug).slice(0, 900)}`);
        }
        const coverage = await compareScreenshotCoverage(
          page,
          before,
          settled,
          6,
          3,
          routeSegmentXRange,
        );
        if (coverage.visibleSegments !== 6) {
          // 장경로 실패에서도 커밋 분기/렌더 결과 브레드크럼을 읽는다 — "양끝 캡만 남는" 패턴이
          // 커밋 타일 합성의 부분 실패인지 플랜 자체의 공백인지 가른다.
          const longCommitDebug = await page.evaluate(() => ({
            route: (globalThis as { __studioCommitRouteDebug?: unknown }).__studioCommitRouteDebug ?? null,
            render: (globalThis as { __studioCommitRenderDebug?: unknown }).__studioCommitRenderDebug ?? null,
          }));
          log(`${preset.id}: long commit breadcrumbs ${JSON.stringify(longCommitDebug)}`);
          try {
            await page.waitForTimeout(2_500);
            const persisted = await persistedDrawElements(page);
            const lastDraw = persisted.at(-1) as
              | { points?: readonly number[]; pressures?: readonly number[] }
              | undefined;
            log(
              `${preset.id}: long persisted element points=${(lastDraw?.points?.length ?? 0) / 2} `
                + `pressures=${lastDraw?.pressures?.length ?? 0} `
                + `head=${JSON.stringify((lastDraw?.points ?? []).slice(0, 8))} `
                + `tail=${JSON.stringify((lastDraw?.points ?? []).slice(-4))}`,
            );
          } catch (cause) {
            log(`${preset.id}: long persisted element read failed ${String(cause)}`);
          }
          writeFileSync(join(SCRATCH, `studio-brush-long-diagnostic-${preset.id}-before.png`), before);
          writeFileSync(
            join(SCRATCH, `studio-brush-long-diagnostic-${preset.id}-immediate.png`),
            released,
          );
          writeFileSync(
            join(SCRATCH, `studio-brush-long-diagnostic-${preset.id}-settled.png`),
            settled,
          );
          log(
            `${preset.id}: long-stroke diagnostic coverage ${JSON.stringify(coverage)} `
              + `clip ${JSON.stringify(clip)}`,
          );
          if (DEBUG_BRUSH_VERIFIER) {
            await page.waitForTimeout(1_700);
            const diagnosticPersisted = await persistedDrawElements(page);
            log(
              `${preset.id}: persisted long-stroke tails `
                + JSON.stringify(diagnosticPersisted.slice(-2)),
            );
            await page.screenshot({
              path: join(SCRATCH, `studio-brush-long-diagnostic-${preset.id}-page.png`),
              animations: "disabled",
            });
          }
        }
        /**
         * 실패한 레인의 잔여 획이 다음 프리셋의 진단을 오염시키므로, 기록 후에는 반드시 페이지를
         * 새로 세우고 넘어간다.
         */
        const surveySkip = async (message: string): Promise<boolean> => {
          if (!LONG_MATRIX_SURVEY_MODE) return false;
          surveyFailures.push(message);
          log(`long SURVEY -> ${message}`);
          await wipePersistedStudioDocument(page).catch(() => undefined);
          await prepareStudioPage(page, studioUrl);
          await activateDesktopPen(page);
          return true;
        };
        if (
          depositsPigment
          && !hasMeaningfulPixelChange(coverage)
          && await surveySkip(`${preset.id}: long stroke disappeared before commit`)
        ) return "skipped";
        if (depositsPigment) {
          invariant(
            hasMeaningfulPixelChange(coverage),
            `${preset.id}: long stroke disappeared before commit`,
          );
        }
        /*
         * A continuous carrier must cover every route segment. Intentionally discrete particle,
         * motif and stamp brushes are different: a valid deterministic long stroke may leave one
         * sampled sixth empty between authored marks (for example rain-mist-combo). Requiring 6/6
         * there turns the verifier into a request to fill deliberate negative space. We still
         * require meaningful output above, persist the full 300 px route below, capture all four
         * frames and exercise Undo; only the continuous-coverage invariant is policy-scoped.
         */
        if (
          depositsPigment
          && (operation === "erase" || !studioLongBrushQualityPolicyIsRecordOnly(qualityPolicy.kind))
        ) {
          const segmentFailure =
            `${preset.id}: long stroke has missing visual segments `
            + `(${coverage.visibleSegments}/6; ${coverage.segmentChangedPixels.join(",")})`;
          if (coverage.visibleSegments !== 6 && await surveySkip(segmentFailure)) return "skipped";
          invariant(coverage.visibleSegments === 6, segmentFailure);
        }
        // Visual-quality findings are aggregate failures, not loop breakers. The exhaustive run must
        // still capture every remaining brush so one early scallop does not hide 213 later results.
        // Functional absence, route coverage, persistence identity and Undo remain immediate failures.
        const expectedPersistedDynamics = preset.source === "pro"
          && operation === "paint"
          ? expectedPersistedDynamicsForDefaultSelection(expectedSelection)
          : null;
        const persistedDynamicsMatched = preset.source === "pro"
          && operation === "paint"
          ? serializeStudioBrushDynamicsSettingsCanonical(saved.brushDynamics)
            === serializeStudioBrushDynamicsSettingsCanonical(expectedPersistedDynamics)
          : null;
        const persistedPathDistance = persistedStrokePathDistance(saved.points);
        invariant(
          saved.kind === "freehand",
          `${preset.id}: isolated long stroke persisted as ${saved.kind ?? "missing"}, not freehand`,
        );
        invariant(
          operation === "erase"
            ? saved.mode === "eraser" && saved.brush === expectedSelection.runtimeBrushId
            : saved.mode === "pen" && saved.brush === expectedSelection.runtimeBrushId,
          operation === "erase"
            ? `${preset.id}: isolated long eraser did not persist as destination-out geometry`
            : `${preset.id}: isolated long stroke persisted with runtime brush `
              + `${saved.brush ?? "missing"}, expected ${expectedSelection.runtimeBrushId}`,
        );
        invariant(
          operation === "erase"
            ? saved.brushCatalogId === expectedSelection.catalogId
            : preset.source === "core" || saved.brushCatalogId === preset.id,
          `${preset.id}: isolated long stroke persisted with catalogue id `
            + `${saved.brushCatalogId ?? "missing"}`,
        );
        invariant(
          persistedDynamicsMatched !== false,
          `${preset.id}: long-route persisted dynamics do not match the selected catalogue profile`,
        );
        invariant(
          persistedPathDistance >= 300,
          `${preset.id}: persisted long route stopped at ${persistedPathDistance.toFixed(1)} document px`,
        );

        const undo = await enabledHistoryButton(page, "실행취소");
        invariant(await undo.isEnabled(), `${preset.id}: isolated long-stroke Undo is disabled`);
        await page.keyboard.press("Meta+z");
        await page.waitForTimeout(80);
        const undone = await page.screenshot({ animations: "disabled", clip });
        const undoDiff = await compareScreenshotPixels(page, before, undone, 20);
        const undoRestoredPixels = undoDiff.changedPixels <= 3;
        invariant(
          undoRestoredPixels,
          `${preset.id}: isolated long-stroke Undo left ${undoDiff.changedPixels} visible pixels`,
        );
        invariant(
          await enabledHistoryButton(page, "다시실행").then(() => true, () => false),
          `${preset.id}: isolated long-stroke Undo did not create a redo entry`,
        );
        if (operation === "erase") {
          invariant(emptyBefore, `${preset.id}: long eraser cleanup lost its empty baseline`);
          await page.keyboard.press("Meta+z");
          await page.waitForTimeout(80);
          const fullyCleaned = await page.screenshot({ animations: "disabled", clip });
          const fullCleanupDiff = await compareScreenshotPixels(
            page,
            emptyBefore,
            fullyCleaned,
            20,
          );
          invariant(
            fullCleanupDiff.changedPixels <= 3,
            `${preset.id}: long paint+erase cleanup left `
              + `${fullCleanupDiff.changedPixels} visible pixels`,
          );
        }
        evidence.push({
          id: preset.id,
          source: preset.source,
          operation,
          expectedRuntimeBrushId: expectedSelection.runtimeBrushId,
          visualChanged: true,
          visibleSegments: coverage.visibleSegments,
          totalSegments: 6,
          persistedBrushId: saved.brush,
          persistedMode: saved.mode,
          persistedCatalogId: saved.brushCatalogId,
          persistedDynamicsMatched,
          persistedPathDistance,
          undoRestoredPixels,
          qualityPolicy: quality.policy.kind,
          qualityOk: quality.ok,
        });
        log(
          `long ${index + 1}/${LONG_BRUSH_CATALOG_COUNT} `
            + `${preset.id} → ${expectedSelection.runtimeBrushId}: `
            + `${coverage.visibleSegments}/6 route segments visible`
            + `${
              operation === "erase"
                ? " (live retained-layer eraser)"
                : quality.policy.kind === "record-only-discrete"
                  ? " (discrete)"
                  : quality.policy.kind === "record-only-transparent"
                    ? " (transparent wash)"
                    : ""
            } + `
            + `${persistedPathDistance.toFixed(1)}px ${operation} persisted + Undo OK`,
        );
        return "done";
      })().catch(async (error: unknown): Promise<"skipped"> => {
        if (!LONG_MATRIX_SURVEY_MODE) throw error;
        const message = error instanceof Error ? error.message : String(error);
        surveyFailures.push(message.startsWith(`${preset.id}:`) ? message : `${preset.id}: ${message}`);
        log(`long SURVEY -> ${message}`);
        await wipePersistedStudioDocument(page).catch(() => undefined);
        await prepareStudioPage(page, studioUrl);
        await activateDesktopPen(page);
        return "skipped";
      });
      if (outcome === "skipped") continue;
    }

    await page.screenshot({ path: screenshot, animations: "disabled" });
    writeLongBrushQualityReport({
      reportPath: qualityReportPath,
      runDirectory: qualityRunDirectory,
      evidence: qualityEvidence,
      completed: true,
    });
    const qualityFailureCount = qualityEvidence.filter((entry) => !entry.quality.ok).length;
    log(
      `long-brush quality report: ${qualityReportPath} · `
        + `${qualityFailureCount}/${qualityEvidence.length} continuous-policy failures`,
    );
    if (LONG_MATRIX_SURVEY_MODE) {
      log(`long SURVEY COMPLETE: ${surveyFailures.length} failing preset(s)`);
      for (const failure of surveyFailures) log(`long SURVEY -> ${failure}`);
    }
    reportBrowserErrors(errors);
    invariant(errors.messages.length === 0, "long-brush browser emitted console/page errors");
    invariant(errors.failedResponses.length === 0, "long-brush browser received unexpected 5xx responses");
    invariant(
      surveyFailures.length === 0,
      `long survey recorded ${surveyFailures.length} failing preset(s)`,
    );
    const continuousSegmentCounts = evidence
      .filter((entry) => !studioLongBrushQualityPolicyIsRecordOnly(entry.qualityPolicy))
      .map((entry) => entry.visibleSegments);
    const discreteSegmentCounts = evidence
      .filter((entry) => entry.qualityPolicy === "record-only-discrete")
      .map((entry) => entry.visibleSegments);
    return {
      ok: evidence.length === LONG_BRUSH_CATALOG_COUNT && evidence.every((entry) =>
        entry.visualChanged
        && (
          entry.visibleSegments === entry.totalSegments
          || studioLongBrushQualityPolicyIsRecordOnly(entry.qualityPolicy)
        )
        && (
          entry.operation === "erase"
            ? entry.persistedMode === "eraser"
              && entry.persistedBrushId === entry.expectedRuntimeBrushId
              && entry.persistedCatalogId === entry.id
            : entry.persistedMode === "pen"
              && entry.persistedBrushId === entry.expectedRuntimeBrushId
        )
        && entry.persistedPathDistance >= 300
        && entry.undoRestoredPixels
        && entry.qualityOk
        && (
          entry.operation === "erase"
          || entry.source === "core"
          || (
            entry.persistedCatalogId === entry.id
            && entry.persistedDynamicsMatched === true
          )
        )
      ),
      presetCount: evidence.length,
      evidence,
      screenshot,
      qualityRunDirectory: longBrushArtifactPath(SCRATCH, qualityRunDirectory),
      qualityReport: longBrushArtifactPath(SCRATCH, qualityReportPath),
      qualityPolicyCounts: {
        "strict-continuous": qualityEvidence.filter((entry) =>
          entry.quality.policy.kind === "strict-continuous"
        ).length,
        "soft-wet-continuous": qualityEvidence.filter((entry) =>
          entry.quality.policy.kind === "soft-wet-continuous"
        ).length,
        "record-only-discrete": qualityEvidence.filter((entry) =>
          entry.quality.policy.kind === "record-only-discrete"
        ).length,
        "record-only-transparent": qualityEvidence.filter((entry) =>
          entry.quality.policy.kind === "record-only-transparent"
        ).length,
      },
      totalSegmentsPerTool: 6,
      // The lane sizes travel with the minimums on purpose. `Math.min(...[], 6)` is 6, so an empty
      // lane would report perfect coverage and its assertion would pass while measuring nothing.
      continuousPolicyTools: continuousSegmentCounts.length,
      discretePolicyTools: discreteSegmentCounts.length,
      continuousMinimumVisibleSegments: Math.min(...continuousSegmentCounts, 6),
      discreteMinimumVisibleSegments: Math.min(...discreteSegmentCounts, 6),
      toolsBelowFullCoverage: evidence.filter((entry) => entry.visibleSegments < 6).length,
      errorCount: errors.messages.length + errors.failedResponses.length,
    };
  } catch (error) {
    await captureBrushStageFailure(page, "long", error, errors);
    throw error;
  } finally {
    await context.close();
  }
}

type ScreenPoint = { x: number; y: number };

function sampledClosedPath(vertices: readonly ScreenPoint[], samplesPerEdge = 8): ScreenPoint[] {
  const points: ScreenPoint[] = [{ ...vertices[0]! }];
  for (let edge = 0; edge < vertices.length; edge += 1) {
    const start = vertices[edge]!;
    const end = vertices[(edge + 1) % vertices.length]!;
    for (let sample = 1; sample <= samplesPerEdge; sample += 1) {
      const amount = sample / samplesPerEdge;
      points.push({
        x: start.x + (end.x - start.x) * amount,
        y: start.y + (end.y - start.y) * amount,
      });
    }
  }
  return points;
}

function sampledLinePath(start: ScreenPoint, end: ScreenPoint, samples = 18): ScreenPoint[] {
  return Array.from({ length: samples }, (_, index) => {
    const amount = index / Math.max(1, samples - 1);
    return {
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount,
    };
  });
}

function sampledEllipsePath(
  box: { left: number; top: number; right: number; bottom: number },
  samples = 48,
): ScreenPoint[] {
  const centerX = (box.left + box.right) / 2;
  const centerY = (box.top + box.bottom) / 2;
  const radiusX = (box.right - box.left) / 2;
  const radiusY = (box.bottom - box.top) / 2;
  return Array.from({ length: samples + 1 }, (_, index) => {
    const angle = (index / samples) * Math.PI * 2;
    return { x: centerX + Math.cos(angle) * radiusX, y: centerY + Math.sin(angle) * radiusY };
  });
}

async function drawMousePath(page: Page, points: readonly ScreenPoint[]): Promise<void> {
  invariant(points.length >= 2, "shape fixture has too few pointer samples");
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
  await page.mouse.up();
  await page.mouse.move(4, 4);
}

async function drawPenPathWithJitterHold(
  page: Page,
  points: readonly ScreenPoint[],
): Promise<void> {
  invariant(points.length >= 2, "pen shape fixture has too few pointer samples");
  const session = await page.context().newCDPSession(page);
  try {
    const first = points[0]!;
    await session.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: first.x,
      y: first.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
      force: 0.55,
      pointerType: "pen",
    });
    for (const point of points.slice(1)) {
      await session.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: point.x,
        y: point.y,
        button: "none",
        buttons: 1,
        force: 0.55,
        pointerType: "pen",
      });
    }
    const endpoint = points.at(-1)!;
    for (let index = 0; index < 20; index += 1) {
      const angle = (index * Math.PI * 2) / 7;
      const radius = 2 + (index % 4);
      await page.waitForTimeout(20);
      await session.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: endpoint.x + Math.cos(angle) * radius,
        y: endpoint.y + Math.sin(angle) * radius,
        button: "none",
        buttons: 1,
        force: 0.55,
        pointerType: "pen",
      });
    }
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: endpoint.x,
      y: endpoint.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
      force: 0,
      pointerType: "pen",
    });
  } finally {
    await session.detach();
  }
  await page.mouse.move(4, 4);
}

async function enableSmartShape(page: Page): Promise<void> {
  const railToggle = page.locator('button[data-studio-rail-tool-id="smart-shape"]');
  if (await railToggle.isVisible()) {
    if (await railToggle.getAttribute("aria-pressed") !== "true") await railToggle.click();
    return;
  }
  const buttons = page.getByRole("button", { name: "스마트 도형", exact: true });
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!await button.isVisible()) continue;
    if (await button.getAttribute("aria-pressed") !== "true") await button.click();
    return;
  }
  throw new Error("visible Smart Shape toggle was not found");
}

async function runSmartShapeMatrix(browser: Browser, studioUrl: string): Promise<SmartShapeResult> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const errors = collectBrowserErrors(page, "smart-shapes", studioUrl);
  const screenshot = join(SCRATCH, "studio-smart-shape-desktop.png");

  try {
    await prepareStudioPage(page, studioUrl);
    await activateDesktopPen(page);
    await enableSmartShape(page);
    const stage = page.locator(".konvajs-content").first();
    const stageBox = await stage.boundingBox();
    const viewport = page.viewportSize();
    invariant(stageBox && viewport, "could not measure canvas for Smart Shape");

    const left = Math.max(stageBox.x + 65, viewport.width * 0.33);
    const right = Math.min(stageBox.x + stageBox.width - 65, viewport.width * 0.70);
    const top = Math.max(stageBox.y + 65, viewport.height * 0.16);
    const bottom = Math.min(stageBox.y + stageBox.height - 65, viewport.height * 0.75);
    invariant(right - left >= 480, "visible canvas is too narrow for Smart Shape fixtures");
    invariant(bottom - top >= 520, "visible canvas is too short for Smart Shape fixtures");

    const triangleBox = { left: left + 20, top: top + 220, right: left + 320, bottom: top + 330 };
    const polygonBox = { left: right - 130, top: top + 210, right: right - 20, bottom: top + 500 };
    const fixtures: Array<{
      expectedKind: SmartShapeExpectedKind;
      expectedPolygonSides?: number;
      box: { left: number; top: number; right: number; bottom: number };
      path: ScreenPoint[];
      enforceExtent: boolean;
      penJitterHold?: boolean;
    }> = [
      {
        expectedKind: "line",
        box: { left: left + 20, top: top + 28, right: right - 20, bottom: top + 34 },
        path: sampledLinePath({ x: left + 20, y: top + 30 }, { x: right - 20, y: top + 32 }),
        enforceExtent: false,
      },
      {
        expectedKind: "rect",
        box: { left: left + 20, top: top + 70, right: left + 175, bottom: top + 165 },
        path: sampledClosedPath([
          { x: left + 20, y: top + 70 },
          { x: left + 175, y: top + 70 },
          { x: left + 175, y: top + 165 },
          { x: left + 20, y: top + 165 },
        ]),
        enforceExtent: true,
      },
      {
        expectedKind: "ellipse",
        box: { left: right - 195, top: top + 70, right: right - 20, bottom: top + 165 },
        path: sampledEllipsePath({ left: right - 195, top: top + 70, right: right - 20, bottom: top + 165 }),
        enforceExtent: true,
      },
      {
        expectedKind: "triangle",
        box: triangleBox,
        path: sampledClosedPath([
          { x: (triangleBox.left + triangleBox.right) / 2, y: triangleBox.top },
          { x: triangleBox.right, y: triangleBox.bottom },
          { x: triangleBox.left, y: triangleBox.bottom },
        ], 10),
        enforceExtent: true,
      },
      {
        expectedKind: "rect",
        box: { left: left + 20, top: top + 370, right: left + 175, bottom: top + 465 },
        path: sampledClosedPath([
          { x: left + 20, y: top + 370 },
          { x: left + 175, y: top + 370 },
          { x: left + 175, y: top + 465 },
          { x: left + 20, y: top + 465 },
        ]),
        enforceExtent: true,
        penJitterHold: true,
      },
      {
        expectedKind: "polygon",
        expectedPolygonSides: 5,
        box: polygonBox,
        path: sampledClosedPath(Array.from({ length: 5 }, (_, index) => {
          const angle = -Math.PI / 2 + (index * Math.PI * 2) / 5;
          return {
            x: (polygonBox.left + polygonBox.right) / 2 + Math.cos(angle) * ((polygonBox.right - polygonBox.left) / 2),
            y: (polygonBox.top + polygonBox.bottom) / 2 + Math.sin(angle) * ((polygonBox.bottom - polygonBox.top) / 2),
          };
        }), 10),
        enforceExtent: true,
      },
    ];

    const evidence: SmartShapeEvidence[] = [];
    for (const fixture of fixtures) {
      const clip = {
        x: Math.max(0, Math.floor(fixture.box.left - 20)),
        y: Math.max(0, Math.floor(fixture.box.top - 20)),
        width: Math.ceil(fixture.box.right - fixture.box.left + 40),
        height: Math.ceil(fixture.box.bottom - fixture.box.top + 40),
      };
      const before = await captureStableEvidence(page, clip);
      if (fixture.penJitterHold) await drawPenPathWithJitterHold(page, fixture.path);
      else await drawMousePath(page, fixture.path);
      await page.waitForTimeout(300);
      const after = await page.screenshot({ animations: "disabled", clip });
      const coverage = await compareScreenshotCoverage(page, before, after, 1);
      const visualChanged = hasMeaningfulPixelChange(coverage);
      const actualWidth = coverage.bounds ? coverage.bounds.right - coverage.bounds.left + 1 : 0;
      const actualHeight = coverage.bounds ? coverage.bounds.bottom - coverage.bounds.top + 1 : 0;
      const expectedWidth = Math.max(1, fixture.box.right - fixture.box.left);
      const expectedHeight = Math.max(1, fixture.box.bottom - fixture.box.top);
      const widthCoverage = actualWidth / expectedWidth;
      const heightCoverage = actualHeight / expectedHeight;
      invariant(visualChanged, `${fixture.expectedKind}: Smart Shape produced no visible result`);
      if (fixture.enforceExtent) {
        invariant(
          widthCoverage >= 0.72 && heightCoverage >= 0.72,
          `${fixture.expectedKind}: Smart Shape collapsed its drawn bounds (${widthCoverage.toFixed(2)}× width, ${heightCoverage.toFixed(2)}× height)`,
        );
      }
      evidence.push({
        expectedKind: fixture.expectedKind,
        persistedKind: null,
        persistedBrush: null,
        polygonSides: null,
        persistenceMatched: false,
        persistenceRepresentation: null,
        visualChanged,
        widthCoverage,
        heightCoverage,
      });
      log(`Smart Shape ${fixture.expectedKind}: visible bounds ${widthCoverage.toFixed(2)}×${heightCoverage.toFixed(2)} OK`);
    }

    await waitForPersistedDrawCount(page, fixtures.length);
    const persisted = (await persistedDrawElements(page)).slice(-fixtures.length);
    invariant(persisted.length === fixtures.length, `autosave contains ${persisted.length}/${fixtures.length} Smart Shapes`);
    for (const [index, fixture] of fixtures.entries()) {
      const saved = persisted[index];
      evidence[index]!.persistedKind = saved?.kind ?? null;
      evidence[index]!.persistedBrush = saved?.brush ?? null;
      evidence[index]!.polygonSides = saved?.polygonSides ?? null;
      const representation = persistedSmartShapeRepresentation(saved, fixture);
      evidence[index]!.persistenceMatched = representation === "brush-outline";
      evidence[index]!.persistenceRepresentation = representation;
      if (representation !== "brush-outline") {
        log(`${fixture.expectedKind}: persisted mismatch ${JSON.stringify(saved)}`);
      }
      invariant(
        representation === "brush-outline",
        `${fixture.expectedKind}: persisted Smart Shape is not the selected-brush outline `
          + `(kind=${saved?.kind ?? "missing"}, brush=${saved?.brush ?? "missing"}, `
          + `samples=${(saved?.points.length ?? 0) / 2})`,
      );
    }

    await page.screenshot({ path: screenshot, animations: "disabled" });
    reportBrowserErrors(errors);
    invariant(errors.messages.length === 0, "Smart Shape browser emitted console/page errors");
    invariant(errors.failedResponses.length === 0, "Smart Shape browser received unexpected 5xx responses");
    return {
      ok: evidence.length === fixtures.length && evidence.every((entry) =>
        entry.visualChanged && entry.persistenceMatched
      ),
      evidence,
      screenshot,
      errorCount: errors.messages.length + errors.failedResponses.length,
    };
  } catch (error) {
    await captureBrushStageFailure(page, "shapes", error, errors);
    throw error;
  } finally {
    await context.close();
  }
}

async function runMobileTouchAudit(browser: Browser, studioUrl: string): Promise<MobileTouchResult> {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors = collectBrowserErrors(page, "mobile-catalogue", studioUrl);
  const screenshot = join(SCRATCH, "studio-brush-mobile-operations.png");

  try {
    await prepareStudioPage(page, studioUrl);
    const dock = page.locator('nav[data-studio-mobile-editing-dock="true"]');
    await dock.waitFor({ state: "visible", timeout: 10_000 });
    await dismissQuickStartOverlay(page, 4_000);
    await clickPastTransientOverlays(
      page,
      dock.locator('button[aria-controls="studio-mobile-draw-settings"]:not([data-studio-primary-action])'),
    );
    const drawSheet = page.locator('[data-studio-sheet-id="draw"][data-studio-mobile-sheet="draw"]');
    await drawSheet.waitFor({ state: "visible" });
    await clickPastTransientOverlays(
      page,
      drawSheet.locator('[data-studio-open-brush-library="true"]'),
    );
    const catalog = page.locator('[data-studio-brush-catalog-session="true"]');
    await catalog.waitFor({ state: "visible" });
    invariant(await catalog.count() === 1, "mobile opened more than one built-in catalogue session");
    await catalog.getByRole("tab", { name: "전체", exact: true }).click();
    await expandFullBrushCatalog(catalog);
    const selectionCount = await catalog.locator('button[aria-label$=" 선택"]').count();
    const expectedCatalogCount = STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS.length;
    invariant(
      selectionCount === expectedCatalogCount,
      `mobile paint catalogue exposes ${selectionCount}/${expectedCatalogCount} brush choices`,
    );

    const targets = await catalog.locator("button, input").evaluateAll((elements) => elements
      .map((element) => {
        const node = element as HTMLElement;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const visible = rect.width > 0
          && rect.height > 0
          && style.display !== "none"
          && style.visibility !== "hidden"
          && !node.closest("[hidden], [inert], [aria-hidden='true']");
        if (!visible) return null;
        return {
          label: node.getAttribute("aria-label") || node.textContent?.trim() || node.tagName,
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2)),
        };
      })
      .filter((target): target is { label: string; width: number; height: number } => target !== null));
    const undersized = targets.filter((target) => target.width < 43.5 || target.height < 43.5);
    const minimumWidth = Math.min(...targets.map((target) => target.width));
    const minimumHeight = Math.min(...targets.map((target) => target.height));
    invariant(targets.length > 40, "mobile catalogue touch audit found too few controls");
    invariant(
      undersized.length === 0,
      `mobile catalogue has undersized targets: ${undersized
        .slice(0, 8)
        .map((target) => `${target.label}=${target.width}x${target.height}`)
        .join(", ")}`,
    );

    await catalog.locator('[data-studio-brush-library-close="true"]').click();
    await catalog.waitFor({ state: "detached" });
    const eraserButton = dock.locator('[data-studio-mobile-tool="eraser"]');
    await eraserButton.click();
    await dock.locator('[data-studio-mobile-tool="eraser"][aria-pressed="true"]')
      .waitFor({ state: "visible" });
    await dock.locator('button[aria-controls="studio-mobile-draw-settings"]:not([data-studio-primary-action])').click();
    await drawSheet.waitFor({ state: "visible" });
    const eraserQuickPicker = drawSheet.locator('[data-studio-eraser-quick-picker="true"]');
    await eraserQuickPicker.waitFor({ state: "visible" });
    const actualEraserIds = await eraserQuickPicker
      .locator("[data-studio-eraser-quick-option]")
      .evaluateAll((buttons) => buttons.map((button) =>
        button.getAttribute("data-studio-eraser-quick-option") ?? ""));
    const expectedEraserIds = STUDIO_LISTED_ERASER_BRUSH_CATALOG_ITEMS.map((item) => item.id);
    invariant(
      JSON.stringify(actualEraserIds) === JSON.stringify(expectedEraserIds),
      `mobile eraser quick picker exposes ${actualEraserIds.join(",") || "no choices"}; expected ${expectedEraserIds.join(",")}`,
    );
    for (const eraserId of expectedEraserIds) {
      const option = eraserQuickPicker.locator(
        `[data-studio-eraser-quick-option="${eraserId}"]`,
      );
      await option.click();
      await eraserQuickPicker
        .locator(`[data-studio-eraser-quick-option="${eraserId}"][aria-pressed="true"]`)
        .waitFor({ state: "visible" });
    }
    await page.screenshot({ path: screenshot, animations: "disabled" });
    reportBrowserErrors(errors);
    invariant(errors.messages.length === 0, "mobile browser emitted console/page errors");
    invariant(errors.failedResponses.length === 0, "mobile browser received unexpected 5xx responses");
    return {
      ok: true,
      selectionCount,
      eraserSelectionCount: actualEraserIds.length,
      interactiveTargetCount: targets.length,
      minimumWidth,
      minimumHeight,
      undersized,
      screenshot,
      errorCount: errors.messages.length + errors.failedResponses.length,
    };
  } catch (error) {
    await captureBrushStageFailure(page, "mobile", error, errors);
    throw error;
  } finally {
    await context.close();
  }
}

async function readEmergencyAutosave(page: Page): Promise<EmergencyAutosaveRecord | null> {
  const payload = await persistedStudioDocument(page) as Omit<
    EmergencyAutosaveRecord,
    "key"
  > | null;
  return payload?.pendingStrokeDurability?.kind === "pending-strokes"
    ? { ...payload, key: AUTOSAVE_KEY }
    : null;
}

/** Every persisted element id on every page, so a lost stroke is visible regardless of paging. */
function persistedElementIds(
  document: Pick<EmergencyAutosaveRecord, "pagesList"> | PersistedStudioDocument,
): Set<string> {
  return new Set(
    (document.pagesList ?? []).flatMap((savedPage) =>
      ((savedPage.elements ?? []) as Array<{ id?: unknown }>).flatMap((element) =>
        typeof element?.id === "string" ? [element.id] : []
      )
    )
  );
}

async function waitForPersistedStudioDocument(
  page: Page,
  timeoutMilliseconds = 8_000,
): Promise<PersistedStudioDocument | null> {
  const deadline = performance.now() + timeoutMilliseconds;
  let lastFailure: unknown = null;
  while (performance.now() < deadline) {
    try {
      const document = await persistedStudioDocument(page);
      if (document) return document;
      lastFailure = null;
    } catch (cause: unknown) {
      lastFailure = cause;
    }
    await page.waitForTimeout(100);
  }
  if (lastFailure instanceof Error) {
    throw new Error(
      `post-navigation SQLite autosave read failed: ${lastFailure.message}`,
      { cause: lastFailure },
    );
  }
  return null;
}

async function waitForEmergencyAutosave(
  page: Page,
  timeoutMilliseconds = 8_000,
): Promise<EmergencyAutosaveRecord | null> {
  const deadline = performance.now() + timeoutMilliseconds;
  let lastFailure: unknown = null;
  while (performance.now() < deadline) {
    try {
      const emergency = await readEmergencyAutosave(page);
      if (emergency) return emergency;
      lastFailure = null;
    } catch (cause: unknown) {
      lastFailure = cause;
    }
    await page.waitForTimeout(100);
  }
  if (lastFailure instanceof Error) {
    throw new Error(
      `pagehide SQLite autosave read failed: ${lastFailure.message}`,
      { cause: lastFailure },
    );
  }
  return null;
}

async function runDeferredDurabilityAudit(
  browser: Browser,
  origin: string,
  studioUrl: string,
): Promise<DeferredDurabilityResult> {
  const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = collectBrowserErrors(page, "deferred-durability", studioUrl);
  const screenshot = join(SCRATCH, "studio-brush-emergency-recovery.png");

  try {
    await prepareStudioPage(page, studioUrl);
    await activateDesktopPen(page);
    await selectDesktopBrush(page, BRUSH_PRESETS[0]!);
    const stage = page.locator(".konvajs-content").first();
    const stageBox = await stage.boundingBox();
    const viewport = page.viewportSize();
    invariant(stageBox && viewport, "could not measure canvas for deferred-stroke audit");
    await page.mouse.move(4, 4);
    const baseline = await stage.screenshot({ animations: "disabled" });
    // This stage owns its own lanes, measured from the exposed paper rather than the brush-matrix
    // grid: that grid's row pitch shrinks with a focused brush subset, which pushed the gesture
    // below the viewport, where a silent no-op is indistinguishable from a lost durability receipt.
    const safeLeft = Math.max(stageBox.x + 70, viewport.width * 0.34);
    const safeRight = Math.min(stageBox.x + stageBox.width - 70, viewport.width * 0.69);
    const safeTop = Math.max(stageBox.y + 70, viewport.height * 0.18);
    const safeBottom = Math.min(stageBox.y + stageBox.height - 70, viewport.height * 0.52);
    invariant(safeRight - safeLeft >= 240, "visible canvas is too narrow for the deferred stroke");
    invariant(safeBottom - safeTop >= 140, "visible canvas is too short for the deferred stroke");
    const receiptLane = { x: safeLeft, y: safeTop + (safeBottom - safeTop) * 0.3 };
    const navigationLane = { x: safeLeft, y: safeTop + (safeBottom - safeTop) * 0.6 };
    const endX = Math.min(safeRight, safeLeft + 240);
    // A gesture that never reaches Konva paints nothing, so it would fail this audit as a missing
    // emergency autosave. Prove both routes hit canvas first and fail with the real reason.
    const canvasReceivesStrokes = await page.evaluate(
      ({ lanes, routeEndX }) =>
        lanes.every((lane) =>
          document.elementFromPoint(lane.x, lane.y)?.closest(".konvajs-content") !== null
          && document.elementFromPoint(routeEndX, lane.y + 46)?.closest(".konvajs-content") !== null
        ),
      { lanes: [receiptLane, navigationLane], routeEndX: endX },
    );
    invariant(canvasReceivesStrokes, "deferred-stroke route is covered by editor chrome");

    // 1) The pointerup write alone must make a still-deferred stroke durable. Nothing else has run
    // yet — no idle flush, no debounced autosave — so a receipt here can only come from pointerup.
    await page.mouse.move(receiptLane.x, receiptLane.y);
    await page.mouse.down();
    await page.mouse.move(endX, receiptLane.y + 46, { steps: 14 });
    await page.mouse.up();
    const receiptRequestedAt = performance.now();
    // Bounded on purpose: pointerup starts the durable write at the input event's microtask
    // checkpoint, so the receipt lands in tens of milliseconds. An unbounded poll would also
    // accept a write that had been pushed behind a timer or a dynamic import — exactly the
    // regression the product forbids — because it would still arrive "eventually".
    const receipt = await waitForEmergencyAutosave(page, RECEIPT_SETTLE_BUDGET_MS);
    const receiptSettledInMs = performance.now() - receiptRequestedAt;
    if (!receipt) {
      const raw = await persistedStudioDocument(page).catch((cause: unknown) => ({
        readFailure: cause instanceof Error ? cause.message : String(cause),
      })) as Record<string, unknown> | null;
      // A payload that carries only a lifecycle marker means the stroke never entered the deferred
      // batch, so the durable write it produced belongs to a later lifecycle event, not pointerup.
      log(`durability diagnostic: persisted markers ${JSON.stringify({
        present: raw !== null,
        lifecycleDurability: raw?.lifecycleDurability ?? null,
        pendingStrokeDurability: raw?.pendingStrokeDurability ?? null,
      })}`);
      log(`durability diagnostic: console messages ${JSON.stringify(errors.messages).slice(0, 800)}`);
    }
    invariant(receipt, "pointerup did not create a durable autosave for the deferred stroke");
    const marker = receipt.pendingStrokeDurability;
    const receiptStrokeIds = Array.isArray(marker?.strokeIds)
      ? marker.strokeIds.filter((id): id is string => typeof id === "string")
      : [];
    const markerReason = typeof marker?.reason === "string" ? marker.reason : "missing";
    invariant(receiptStrokeIds.length > 0, "emergency autosave contains no deferred stroke ids");
    invariant(
      markerReason === "pointerup",
      `the deferred stroke became durable through ${markerReason} instead of pointerup`,
    );
    const receiptPayloadIds = persistedElementIds(receipt);
    invariant(
      receiptStrokeIds.every((id) => receiptPayloadIds.has(id)),
      "pointerup receipt marker references a stroke missing from its own payload",
    );
    invariant(
      receiptSettledInMs < RECEIPT_SETTLE_BUDGET_MS,
      `pointerup receipt took ${receiptSettledInMs.toFixed(0)}ms, past its microtask checkpoint`,
    );
    await page.mouse.move(4, 4);
    // The canvas as it stands with ONLY the proven-durable stroke. Recovery must differ from this,
    // or it repainted stroke one and silently dropped the stroke that was actually at risk.
    const afterReceiptStroke = await stage.screenshot({ animations: "disabled" });

    // 2) Navigating away in the same beat as the release must lose nothing, AND the payload that
    // survives teardown must be the one pointerup wrote — a survivor written by pagehide would mean
    // the microtask checkpoint lost its race and durability now rides on the unload handler.
    const knownStrokeIds = [...receiptPayloadIds];
    // Let the first batch leave the deferred window so the navigation below audits one fresh
    // release rather than a batch this audit already proved durable.
    await page.waitForTimeout(400);
    await page.mouse.move(navigationLane.x, navigationLane.y);
    await page.mouse.down();
    await page.mouse.move(endX, navigationLane.y + 46, { steps: 14 });
    await page.mouse.up();
    const releasedAt = performance.now();
    let unloadGuardShown = false;
    let dialogFailure: Error | null = null;
    let dialogSettlement: Promise<void> | null = null;
    const handleDialog = (dialog: Dialog): void => {
      dialogSettlement = (async () => {
        if (dialog.type() !== "beforeunload") {
          dialogFailure = new Error(`unexpected durability dialog: ${dialog.type()}`);
          await dialog.dismiss();
          return;
        }
        unloadGuardShown = true;
        // Deliberately shorter than the product's deferred-commit idle flush: a longer prompt lets
        // that flush produce the surviving payload, which would mask a pointerup write that had
        // been pushed past teardown. Holding the prompt under the idle window keeps pointerup the
        // only authority that can have written what survives.
        await new Promise((resolve) => setTimeout(resolve, UNLOAD_PROMPT_HOLD_MS));
        await dialog.accept();
      })().catch((cause: unknown) => {
        dialogFailure = cause instanceof Error ? cause : new Error(String(cause));
      });
    };
    page.on("dialog", handleDialog);
    const navigation = page.goto(origin, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const navigationIssuedInMs = performance.now() - releasedAt;
    await navigation;
    if (dialogSettlement) await dialogSettlement;
    page.off("dialog", handleDialog);
    if (dialogFailure) throw dialogFailure;
    invariant(
      navigationIssuedInMs < 50,
      `navigation was not immediate after pointerup (${navigationIssuedInMs.toFixed(2)}ms)`,
    );

    const survivor = await waitForPersistedStudioDocument(page);
    if (!survivor) {
      log(`durability diagnostic: console messages ${JSON.stringify(errors.messages).slice(0, 800)}`);
    }
    invariant(survivor, "immediate navigation left no durable document behind");
    // Which authority refused decides the diagnosis: a follower verdict means the leadership guard
    // suppressed the SQLite write (product defect), while a payload that lost the just-released
    // stroke points at the write racing document teardown instead.
    const survivorIds = persistedElementIds(survivor);
    const payloadContainsEveryStroke =
      knownStrokeIds.every((id) => survivorIds.has(id))
      && survivorIds.size === knownStrokeIds.length + 1;
    invariant(
      payloadContainsEveryStroke,
      `immediate navigation lost deferred ink: kept ${survivorIds.size} of ${knownStrokeIds.length + 1} strokes`,
    );
    // Cardinality alone would accept any extra element — a live-surface draft, or the committed
    // element with its geometry projected away. Name the released stroke and check it carries ink.
    const releasedStrokeId = [...survivorIds].find((id) => !knownStrokeIds.includes(id));
    invariant(releasedStrokeId, "the survivor kept a stroke count but not the released stroke");
    const releasedStrokeHasGeometry = ((survivor.pagesList ?? []) as Array<{
      elements?: Array<{ id?: unknown; points?: unknown }>;
    }>).some((savedPage) =>
      (savedPage.elements ?? []).some((element) =>
        element?.id === releasedStrokeId
        && Array.isArray(element.points)
        && element.points.length > 0
      )
    );
    invariant(
      releasedStrokeHasGeometry,
      "the released stroke survived as an empty shell with no points",
    );
    // Provenance is the whole contract: pointerup must beat teardown. With the unload prompt held
    // under the idle-flush window, a survivor marked anything else means the durable write moved
    // behind document teardown and a tab kill (which shows no prompt at all) would lose the ink.
    const survivorMarker = (survivor as unknown as {
      pendingStrokeDurability?: { reason?: unknown; strokeIds?: unknown };
    }).pendingStrokeDurability;
    const survivorMarkerReason =
      typeof survivorMarker?.reason === "string" ? survivorMarker.reason : "missing";
    invariant(
      survivorMarkerReason === "pointerup",
      `the payload that survived teardown was written by ${survivorMarkerReason}, not pointerup`,
    );
    const survivorMarkerStrokeIds = Array.isArray(survivorMarker?.strokeIds)
      ? survivorMarker.strokeIds.filter((id): id is string => typeof id === "string")
      : [];
    invariant(
      survivorMarkerStrokeIds.includes(releasedStrokeId),
      "the surviving pointerup marker does not claim the stroke released just before navigation",
    );

    await page.goto(studioUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.locator('[data-studio-editor="true"]').waitFor({ state: "visible", timeout: 12_000 });
    await dismissTransientChrome(page, false);
    const recoveryText = page.getByText(
      "이전에 작성 중이던 임시저장 데이터가 있습니다.",
      { exact: false },
    );
    await recoveryText.waitFor({ state: "visible", timeout: 8_000 });
    const recoveryBannerShown = true;
    await page.getByRole("button", { name: "복구하기", exact: true }).click();
    await recoveryText.waitFor({ state: "detached", timeout: 8_000 });
    const restoredStage = page.locator(".konvajs-content").first();
    await restoredStage.waitFor({ state: "visible" });
    await page.waitForTimeout(180);
    await page.mouse.move(4, 4);
    const restored = await restoredStage.screenshot({ animations: "disabled" });
    const recoveredPixelsChanged = !baseline.equals(restored);
    invariant(recoveredPixelsChanged, "restored emergency autosave did not repaint the deferred stroke");
    // Against the empty baseline, repainting stroke one alone would pass. Compare against the
    // canvas that already held stroke one so the assertion is about the at-risk stroke.
    invariant(
      !afterReceiptStroke.equals(restored),
      "recovery repainted only the proven stroke; the released stroke is missing from the canvas",
    );
    await page.screenshot({ path: screenshot, animations: "disabled" });

    reportBrowserErrors(errors);
    invariant(errors.messages.length === 0, "durability browser emitted console/page errors");
    invariant(errors.failedResponses.length === 0, "durability browser received unexpected 5xx responses");
    return {
      ok: true,
      navigationIssuedInMs,
      unloadGuardShown,
      // Two measurements over two strokes: the receipt fields come from phase 1 on a live page,
      // the survivor fields from phase 2's payload after teardown. Naming them apart keeps a
      // reader from combining them into a claim neither phase makes on its own.
      receiptMarkerReason: markerReason,
      receiptSettledInMs,
      receiptStrokeCount: receiptStrokeIds.length,
      survivorMarkerReason,
      survivorStrokeCount: survivorIds.size,
      unloadPromptHeldMs: UNLOAD_PROMPT_HOLD_MS,
      payloadContainsEveryStroke,
      recoveryBannerShown,
      recoveredPixelsChanged,
      screenshot,
      errorCount: errors.messages.length + errors.failedResponses.length,
    };
  } catch (error) {
    await captureBrushStageFailure(page, "durability", error, errors);
    throw error;
  } finally {
    await context.close();
  }
}

const EVIDENCE_RECEIPT_PATH = fileURLToPath(
  new URL("../tests/benchmarks/results/studio-brush-browser.json", import.meta.url),
);

/**
 * Writes the wave's checked-in receipt from the run that just passed. Hand-transcribing it from
 * stdout is how the receipt came to claim full route coverage while the same run's log recorded a
 * discrete carrier at four sixths — a number no assertion could catch, because both the claim and
 * the check were typed by the same hand. Only a complete, unfiltered run may author it: a focused
 * or single-stage run would otherwise overwrite the wave's proof with a partial one.
 */
function writeBrowserEvidenceReceipt(run: {
  desktop: DesktopBrushResult | null;
  longBrushes: LongBrushResult | null;
  smartShapes: SmartShapeResult | null;
  mobile: MobileTouchResult | null;
  durability: DeferredDurabilityResult | null;
}): void {
  const { desktop, longBrushes, smartShapes, mobile, durability } = run;
  if (!desktop || !longBrushes || !smartShapes || !mobile || !durability) {
    log("receipt: skipped — not every stage ran, so this run cannot author the wave's proof");
    return;
  }
  if (REQUESTED_BRUSH_VERIFY_IDS.length > 0 || ALL_BRUSH_LONG_MATRIX) {
    log("receipt: skipped — brush selection was filtered, so the counts are not the shipped set");
    return;
  }
  const listedCoreCount = STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.filter(
    (item) => item.source === "core",
  ).length;
  const receipt = {
    schemaVersion: 2,
    measuredAt: new Date().toISOString(),
    command: "pnpm run verify:studio-brushes",
    status: "pass",
    catalog: {
      total: STUDIO_ALL_BRUSH_CATALOG_ITEMS.length,
      core: STUDIO_ALL_BRUSH_CATALOG_ITEMS.filter((item) => item.source === "core").length,
      pro: STUDIO_ALL_BRUSH_CATALOG_ITEMS.filter((item) => item.source === "pro").length,
      paint: STUDIO_PAINT_BRUSH_CATALOG_ITEMS.length,
      erase: STUDIO_ERASER_BRUSH_CATALOG_ITEMS.length,
      quarantined:
        STUDIO_ALL_BRUSH_CATALOG_ITEMS.length - STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.length,
    },
    desktop: {
      stabilityRounds: desktop.stabilityRounds,
      uniquePresetCount: desktop.uniquePresetCount,
      selectedAndRendered: desktop.evidence.filter((entry) => entry.selected && entry.visualChanged)
        .length,
      undoPassed: desktop.evidence.filter((entry) => entry.undoRestoredPixels).length,
      redoPassed: desktop.evidence.filter((entry) => entry.redoRestoredStroke).length,
      uiCatalogMatchSkipped: desktop.uiCatalogMatchSkipped,
      surveyMode: desktop.surveyMode,
      errorCount: desktop.errorCount,
      // Per-eraser lift, kept in the receipt because it is the only place the erase behaviour is
      // recorded: a standard eraser must clear its ink, a kneaded one must only lighten it.
      erasers: Object.fromEntries(
        desktop.evidence
          .filter((entry) => entry.operation === "erase")
          .map((entry) => [entry.id, {
            operation: entry.operation,
            liveRetainedLayerActive: entry.eraseLiveOperationActive,
            residualEnergyRatio: entry.eraseResidualRatio,
          }]),
      ),
    },
    longRouteCore: {
      passed: longBrushes.presetCount,
      total: listedCoreCount,
      totalSegmentsPerTool: longBrushes.totalSegmentsPerTool,
      continuousPolicyTools: longBrushes.continuousPolicyTools,
      discretePolicyTools: longBrushes.discretePolicyTools,
      continuousMinimumVisibleSegments: longBrushes.continuousMinimumVisibleSegments,
      discreteMinimumVisibleSegments: longBrushes.discreteMinimumVisibleSegments,
      toolsBelowFullCoverage: longBrushes.toolsBelowFullCoverage,
      continuousPolicyFailures: longBrushes.evidence.filter(
        (entry) => entry.qualityPolicy !== "record-only-discrete" && !entry.qualityOk,
      ).length,
      undoPassed: longBrushes.evidence.filter((entry) => entry.undoRestoredPixels).length,
      representativePersistedPathDistancePx:
        longBrushes.evidence[0]?.persistedPathDistance ?? 0,
      qualityPolicyCounts: longBrushes.qualityPolicyCounts,
      errorCount: longBrushes.errorCount,
    },
    smartShapes: {
      passed: smartShapes.evidence.filter(
        (entry) => entry.persistenceMatched && entry.visualChanged,
      ).length,
      total: smartShapes.evidence.length,
      representation: smartShapes.evidence[0]?.persistenceRepresentation ?? null,
      errorCount: smartShapes.errorCount,
    },
    mobile: {
      paintSelections: mobile.selectionCount,
      eraserSelections: mobile.eraserSelectionCount,
      interactiveTargets: mobile.interactiveTargetCount,
      minimumTargetWidthPx: mobile.minimumWidth,
      minimumTargetHeightPx: mobile.minimumHeight,
      undersizedTargets: mobile.undersized.length,
      errorCount: mobile.errorCount,
    },
    pointerUpDurability: {
      receiptMarkerReason: durability.receiptMarkerReason,
      receiptSettledInMs: Number(durability.receiptSettledInMs.toFixed(2)),
      receiptStrokeCount: durability.receiptStrokeCount,
      survivorMarkerReason: durability.survivorMarkerReason,
      survivorStrokeCount: durability.survivorStrokeCount,
      unloadPromptHeldMs: durability.unloadPromptHeldMs,
      navigationIssuedInMs: Number(durability.navigationIssuedInMs.toFixed(2)),
      unloadGuardShown: durability.unloadGuardShown,
      payloadContainsEveryStroke: durability.payloadContainsEveryStroke,
      recoveryBannerShown: durability.recoveryBannerShown,
      recoveredPixelsChanged: durability.recoveredPixelsChanged,
      errorCount: durability.errorCount,
    },
  };
  writeFileSync(EVIDENCE_RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
  log(`receipt: wrote ${EVIDENCE_RECEIPT_PATH}`);
}

function cleanScratch(): void {
  cleanScratchDir({
    directory: SCRATCH,
    filePrefix: "studio-brush-",
    extensions: [".png", ".log"],
  });
}

async function main(): Promise<void> {
  cleanScratch();
  const catalogContract = assertProductBrushCatalogContract();
  log(
    `catalog contract: ${catalogContract.presetCount} core presets + `
      + `${catalogContract.proCatalogItemCount} pro presets = `
      + `${catalogContract.catalogItemCount} unique product selections`,
  );
  const drawingOnly = process.env.TOONSPECTRUM_DRAWING_ONLY === "1";
  const shapesOnly = process.env.TOONSPECTRUM_SHAPES_ONLY === "1";
  const longOnly = process.env.TOONSPECTRUM_BRUSH_LONG_ONLY === "1";
  const requestedStage = process.env.TOONSPECTRUM_BRUSH_VERIFY_STAGE?.trim() ?? "";
  const supportedStages = ["desktop", "long", "shapes", "mobile", "durability"] as const;
  invariant(
    requestedStage === "" || supportedStages.some((stage) => stage === requestedStage),
    `unsupported TOONSPECTRUM_BRUSH_VERIFY_STAGE: ${requestedStage}`,
  );
  invariant(
    requestedStage === "" || (!drawingOnly && !shapesOnly && !longOnly),
    "TOONSPECTRUM_BRUSH_VERIFY_STAGE cannot be combined with legacy only-stage flags",
  );
  const runDesktop = requestedStage
    ? requestedStage === "desktop"
    : !shapesOnly && !longOnly;
  const runLong = requestedStage ? requestedStage === "long" : !shapesOnly;
  const runShapes = requestedStage
    ? requestedStage === "shapes"
    : !drawingOnly && !longOnly;
  const runMobile = requestedStage
    ? requestedStage === "mobile"
    : !drawingOnly && !shapesOnly && !longOnly;
  const runDurability = requestedStage
    ? requestedStage === "durability"
    : !drawingOnly && !shapesOnly && !longOnly;
  invariant(
    !(shapesOnly && longOnly),
    "TOONSPECTRUM_SHAPES_ONLY and TOONSPECTRUM_BRUSH_LONG_ONLY cannot be combined",
  );
  invariant(
    !runLong || LONG_BRUSH_CATALOG_COUNT > 0,
    "the requested brush subset contains no brush admitted by the selected long-matrix mode",
  );
  if (REQUESTED_BRUSH_VERIFY_IDS.length > 0) {
    log(
      `focused brush subset: ${BRUSH_MATRIX_CATALOG_ITEMS.map((item) => item.id).join(", ")}`,
    );
  }
  const externalOrigin = process.env.TOONSPECTRUM_VERIFY_ORIGIN?.trim();
  const port = externalOrigin ? null : await findFreePort();
  const origin = externalOrigin
    ? `${externalOrigin.replace(/\/+$/, "")}/`
    : `http://127.0.0.1:${port}/`;
  const studioUrl = `${origin}studio`;
  const server: ChildProcess | null = port === null
    ? null
    : spawnVitePreview({ port, runner: "node-vite-bin", logPath: LOG_PATH });

  let browser: Browser | null = null;
  try {
    await waitForServer(origin);
    // 샌드박스 이미지가 저장소의 Playwright 고정판과 다른 Chromium 리비전을 담고 있을 때
    // playwright.config.ts 와 같은 규약으로 실행 파일 경로를 받아들인다.
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox"],
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
        : {}),
    });
    const desktop = runDesktop ? await runDesktopBrushMatrix(browser, studioUrl) : null;
    if (desktop) {
      invariant(
        desktop.ok,
        `desktop ${BRUSH_MATRIX_CATALOG_COUNT}-brush matrix failed`,
      );
    }
    const longBrushes = runLong ? await runLongBrushMatrix(browser, studioUrl) : null;
    if (longBrushes) {
      invariant(
        longBrushes.ok,
        `long ${LONG_BRUSH_CATALOG_COUNT}-brush matrix failed`,
      );
    }
    const smartShapes = runShapes ? await runSmartShapeMatrix(browser, studioUrl) : null;
    if (smartShapes) invariant(smartShapes.ok, "Smart Shape matrix failed");
    const mobile = runMobile ? await runMobileTouchAudit(browser, studioUrl) : null;
    if (mobile) invariant(mobile.ok, "mobile catalogue touch audit failed");
    const durability = runDurability
      ? await runDeferredDurabilityAudit(browser, origin, studioUrl)
      : null;
    if (durability) invariant(durability.ok, "deferred stroke durability audit failed");

    await browser.close();
    browser = null;
    log(
      REQUESTED_BRUSH_VERIFY_IDS.length > 0
        ? `ALL ${BRUSH_MATRIX_CATALOG_COUNT} FOCUSED BRUSH GATES OK`
        : longOnly
          ? `ALL ${LONG_BRUSH_CATALOG_COUNT} LONG-ROUTE BRUSH GATES OK`
          : "ALL BRUSH AND SMART SHAPE BROWSER GATES OK",
    );
    writeBrowserEvidenceReceipt({ desktop, longBrushes, smartShapes, mobile, durability });
    const stageReport = {
      ok: true,
      stage: requestedStage || "all",
      finishedAt: new Date().toISOString(),
      scratch: SCRATCH,
      desktop, longBrushes, smartShapes, mobile, durability,
    };
    writeFileSync(join(SCRATCH, `studio-brush-${requestedStage || "all"}-report.json`),
      JSON.stringify(stageReport, null, 2));
    console.log(JSON.stringify(stageReport, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (server) await stopChildProcess(server).catch(() => undefined);
  }
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    log(`FATAL: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  },
);
