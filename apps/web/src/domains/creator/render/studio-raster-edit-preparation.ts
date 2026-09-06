/**
 * Non-destructive "editable raster copy" preparation.
 *
 * The compatibility planner uses the exact Studio SVG serializer as a fidelity preflight. The
 * async retouch path instead reuses one Worker export for that preflight and the shared SVG -> PNG
 * rasterizer, avoiding a duplicate main-thread serialization. The original document elements are
 * never removed or patched by this module. Callers materialize one new full-page ImageEl only
 * after an explicit confirmation or an operation whose contract says it creates a merged copy.
 */

import {
  exportPageToSvg,
} from "../export/studio-svg-export";
import { isEffectivelyHidden, isEffectivelyLocked } from "../studio-layers";
import { createStudioVectorReferenceSourceBudgetReceipt } from "../studio-vector-reference-source-budget-receipt";

import type { SvgExportResult, SvgExportTheme } from "../export/studio-svg-export";
import type { El, ImageEl } from "../studio-element-model";
import type { LayerGroup } from "../studio-layers";
import type {
  StudioVectorReferenceInput,
  StudioVectorReferenceBudgets,
  StudioVectorReferencePreparedExport,
  StudioVectorReferencePreparedRenderOptions,
  StudioVectorReferenceRenderOptions,
  StudioVectorReferenceResult,
} from "../studio-vector-fill-reference";
import type { StudioVectorReferenceSourceBudgetReceipt } from "../studio-vector-reference-source-budget-receipt";

const EDITABLE_RASTER_COPY_NAMESPACE = "editable-raster-copy-v1";
const PNG_BASE64_PREFIX = "data:image/png;base64,";
const PNG_DATA_URL_PREFIX = "data:image/png;base64,iVBORw0KGgo";
const EDITABLE_RASTER_COPY_MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const EDITABLE_RASTER_COPY_MAX_SVG_BYTES = 16 * 1024 * 1024;
const EDITABLE_RASTER_COPY_MAX_PNG_BYTES = 32 * 1024 * 1024;
// General merge callers keep the established browser hard cap. Page filters clamp to 4MP below.
const EDITABLE_RASTER_COPY_MAX_PIXELS = 16 * 1024 * 1024;
const PAGE_COMPOSITE_FILTER_MAX_PIXELS = 4 * 1024 * 1024;
const PAGE_COMPOSITE_FILTER_MAX_PNG_BYTES = 4 * 1024 * 1024;
const UTF8_ENCODER = new TextEncoder();

export interface StudioEditableRasterCopyInput {
  readonly pageId: string;
  readonly width: number;
  readonly height: number;
  readonly elements: readonly El[];
  readonly groups?: readonly LayerGroup[];
  /** Omit for all effectively visible document elements. */
  readonly sourceIds?: readonly string[];
  readonly theme?: SvgExportTheme;
  /** Visible-page copies include the authored background; selected-layer copies normally do not. */
  readonly includeBackground?: boolean;
  readonly bg?: string;
  readonly bgGrad?: readonly string[] | null;
  readonly name?: string;
  /** BACK -> FRONT insertion index. Visible-page copies default to the top. */
  readonly insertionIndex?: number;
  /**
   * `hide-originals` keeps source objects intact but hides their authored page instances in the
   * same commit that inserts the raster copy. Pixel editing then reveals the page background
   * instead of an unchanged duplicate source directly underneath.
   */
  readonly sourceDisposition?: "preserve-visible" | "hide-originals";
  /**
   * Source ids that belong to the authored destination and may receive `sourceDisposition`.
   *
   * A page composite can also contain read-only master/linked underlays. Keeping this list
   * separate prevents a locked master from being treated as an authored mutation target while
   * still fingerprinting and rendering it in the exact BACK -> FRONT source order.
   */
  readonly sourceDispositionIds?: readonly string[];
  /**
   * Explicitly omitted ids (for example a transient preview target). An id cannot be both
   * requested through `sourceIds` and excluded; that ambiguous request fails closed.
   */
  readonly excludedSourceIds?: readonly string[];
  readonly documentMutationBlockedReason?: string | null;
  readonly budgets?: StudioVectorReferenceBudgets;
}

export interface StudioEditablePageRasterSource {
  readonly id: string;
  readonly canvasH: number;
  readonly elements: readonly El[];
  readonly groups?: readonly LayerGroup[];
  readonly hideMaster?: boolean;
  readonly bg?: string;
  readonly bgGrad?: readonly string[] | null;
}

export interface StudioEditablePageRasterContextInput {
  readonly page: StudioEditablePageRasterSource;
  readonly canvasWidth: number;
  readonly masterElements: readonly El[];
  readonly localHiddenElementIds: ReadonlySet<string>;
  readonly theme?: SvgExportTheme;
  readonly name: string;
  readonly collaborationLockedReason?: string | null;
  readonly sharedDocument: boolean;
  readonly masterEditMode: boolean;
  readonly reviewLocked: boolean;
  readonly timelinePlaying: boolean;
  readonly viewTransformSuppressed: boolean;
  readonly purpose?: "page-filter" | "pixel-selection";
  readonly budgets?: StudioVectorReferenceBudgets;
}

export interface StudioEditablePageRasterContext {
  /** Page contexts always normalize an owned mutable group snapshot for existing layer helpers. */
  readonly input: StudioEditableRasterCopyInput & { readonly groups: LayerGroup[] };
  readonly destinationElements: readonly El[];
}

export interface StudioRasterPreparationSourceSummary {
  /** Full-page image-local frame shared by rect/ellipse/lasso/brush/wand selection tools. */
  readonly frame: StudioRasterPreparationFrame;
  /** Clipped union of visible, non-transparent authored source geometry; null means no ink/object. */
  readonly sourceBounds: StudioRasterPreparationBounds | null;
  /** Stable BACK -> FRONT order used by both the SVG preflight and the raster result. */
  readonly orderedVisibleSourceIds: readonly string[];
  /** Exact renderer sources in the same BACK -> FRONT order. */
  readonly exactRenderableSourceIds: readonly string[];
  /** Visible ids whose effective element/group lock prevents hide-originals mutation. */
  readonly lockedVisibleSourceIds: readonly string[];
  readonly visibleContentCount: number;
  readonly hiddenContentCount: number;
  readonly visibleRasterCount: number;
  readonly visibleUnlockedRasterCount: number;
  readonly visibleVectorDrawCount: number;
  /** Draw, shape/frame, text/bubble and effect-line objects that contribute visible pixels. */
  readonly visibleCompositeVectorCount: number;
  /** Raster previews that retain a linked editable 3D/VRM scene. */
  readonly visibleLinked3dPreviewCount: number;
  readonly exactRenderableVisibleCount: number;
  readonly unsupportedVisibleCount: number;
  readonly unsupportedReasons: readonly string[];
  readonly hasPageBackground: boolean;
}

export interface StudioRasterPreparationFrame {
  readonly x: 0;
  readonly y: 0;
  readonly width: number;
  readonly height: number;
  readonly rotation: 0;
}

export interface StudioRasterPreparationBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const STUDIO_EDITABLE_RASTER_SELECTION_TOOL_KINDS = [
  "rect",
  "ellipse",
  "lasso",
  "poly-lasso",
  "brush",
  "wand",
  "color-range",
] as const;

export type StudioEditableRasterSelectionToolKind =
  (typeof STUDIO_EDITABLE_RASTER_SELECTION_TOOL_KINDS)[number];

/**
 * Tool-neutral raster target contract. Every pixel-selection gesture consumes the same image-local
 * frame and source revision; only its mask geometry differs.
 */
export interface StudioEditableRasterSelectionSurface {
  readonly toolKind: StudioEditableRasterSelectionToolKind;
  readonly frame: StudioRasterPreparationFrame;
  readonly sourceBounds: StudioRasterPreparationBounds | null;
  readonly sourceSummary: StudioRasterPreparationSourceSummary;
  readonly sourceFingerprint: string;
}

export interface StudioRasterPreparationSourceSummaryInput {
  readonly width: number;
  readonly height: number;
  readonly elements: readonly El[];
  readonly groups?: readonly LayerGroup[];
  readonly theme?: SvgExportTheme;
  readonly bg?: string;
  readonly bgGrad?: readonly string[] | null;
  /** Studio pages normally always paint a background, even when `bg` is omitted. */
  readonly hasPageBackground?: boolean;
}

export interface StudioEditableRasterCopyPlan {
  readonly pageId: string;
  readonly width: number;
  readonly height: number;
  readonly sourceElements: readonly El[];
  readonly sourceIds: readonly string[];
  readonly groups: readonly LayerGroup[];
  readonly theme?: SvgExportTheme;
  readonly includeBackground: boolean;
  readonly bg?: string;
  readonly bgGrad?: readonly string[] | null;
  readonly name: string;
  readonly insertionIndex: number;
  readonly sourceDisposition: "preserve-visible" | "hide-originals";
  readonly sourceDispositionIds: readonly string[];
  readonly frame: StudioRasterPreparationFrame;
  readonly sourceBounds: StudioRasterPreparationBounds | null;
  readonly sourceSummary: StudioRasterPreparationSourceSummary;
  readonly sourceFingerprint: string;
  readonly sourceElementCount: number;
  readonly budgets?: StudioVectorReferenceBudgets;
}

export type StudioEditableRasterCopyFailureCode =
  | "invalid-page-id"
  | "invalid-dimensions"
  | "document-locked"
  | "no-visible-source"
  | "source-selection-mismatch"
  | "source-locked"
  | "source-budget-exceeded"
  | "svg-budget-exceeded"
  | "unsupported-fidelity";

export type StudioEditableRasterCopyPlanResult =
  | { readonly ok: true; readonly plan: StudioEditableRasterCopyPlan }
  | {
      readonly ok: false;
      readonly code: StudioEditableRasterCopyFailureCode;
      readonly reason: string;
    };

export type StudioEditableRasterCopyApplyResult =
  | { readonly ok: true; readonly elements: El[] }
  | {
      readonly ok: false;
      readonly code: "stale-plan" | "invalid-composite";
      readonly reason: string;
    };

export type StudioEditableRasterCopyRenderer = (
  input: StudioVectorReferenceInput,
  options?: StudioVectorReferenceRenderOptions,
) => Promise<StudioVectorReferenceResult>;

export type StudioEditableRasterCopyExportPreparer = (
  input: StudioVectorReferenceInput,
  options?: StudioVectorReferenceRenderOptions,
) => Promise<StudioVectorReferencePreparedExport>;

export type StudioEditableRasterCopyPreparedRenderer = (
  prepared: StudioVectorReferencePreparedExport,
  options?: StudioVectorReferencePreparedRenderOptions,
) => Promise<StudioVectorReferenceResult>;

export type StudioEditableRasterCopyPreparedResult =
  | {
      readonly ok: true;
      readonly plan: StudioEditableRasterCopyPlan;
      readonly rendered: StudioVectorReferenceResult;
    }
  | Extract<StudioEditableRasterCopyPlanResult, { ok: false }>;

function normalizeCopyName(value: string | undefined): string {
  let safeValue = "";
  for (const character of value ?? "편집용 래스터 복사본") {
    const codePoint = character.codePointAt(0) ?? 0;
    safeValue += codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) ? " " : character;
  }
  const normalized = safeValue.trim();
  return (normalized || "편집용 래스터 복사본").slice(0, 120);
}

function normalizeInsertionIndex(value: number | undefined, maximum: number): number {
  if (!Number.isSafeInteger(value)) return maximum;
  return Math.max(0, Math.min(value!, maximum));
}

function validDimensions(
  width: number,
  height: number,
  maxPixelCount = EDITABLE_RASTER_COPY_MAX_PIXELS,
): boolean {
  return Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && width > 0
    && height > 0
    && width <= Math.floor(maxPixelCount / height);
}

function boundedByteBudget(value: number | undefined, hardMaximum: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? Math.min(value!, hardMaximum)
    : hardMaximum;
}

function currentBudgetsAreNotStricter(
  planned: StudioVectorReferenceBudgets | undefined,
  current: StudioVectorReferenceBudgets | undefined,
): boolean {
  return boundedByteBudget(current?.maxPixelCount, EDITABLE_RASTER_COPY_MAX_PIXELS)
      >= boundedByteBudget(planned?.maxPixelCount, EDITABLE_RASTER_COPY_MAX_PIXELS)
    && boundedByteBudget(current?.maxSourceBytes, EDITABLE_RASTER_COPY_MAX_SOURCE_BYTES)
      >= boundedByteBudget(planned?.maxSourceBytes, EDITABLE_RASTER_COPY_MAX_SOURCE_BYTES)
    && boundedByteBudget(current?.maxSvgBytes, EDITABLE_RASTER_COPY_MAX_SVG_BYTES)
      >= boundedByteBudget(planned?.maxSvgBytes, EDITABLE_RASTER_COPY_MAX_SVG_BYTES)
    && boundedByteBudget(current?.maxPngBytes, EDITABLE_RASTER_COPY_MAX_PNG_BYTES)
      >= boundedByteBudget(planned?.maxPngBytes, EDITABLE_RASTER_COPY_MAX_PNG_BYTES);
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function pngDataUrlByteLength(value: string): number | null {
  if (!value.startsWith(PNG_DATA_URL_PREFIX)) return null;
  const payload = value.slice(PNG_BASE64_PREFIX.length);
  if (payload.length === 0 || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(payload)) {
    return null;
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor(payload.length * 3 / 4) - padding;
}

/** Keep the lazy preparation seam independent from the Studio's eager vector runtime chunk. */
function fingerprintEditableRasterCopy(value: string): string {
  const bytes = UTF8_ENCODER.encode(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193) >>> 0;
    second = Math.imul(second ^ byte, 0x85ebca6b) >>> 0;
    second = (second ^ (second >>> 13)) >>> 0;
  }
  return `${EDITABLE_RASTER_COPY_NAMESPACE}:${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

/**
 * Builds a key-order-independent JSON payload for document ownership.
 *
 * The SVG serializer can gain an outline stroker after its lazy chunk loads. That improves the
 * rendered SVG without changing the authored document, so an SVG hash cannot be the durable
 * plan/current fingerprint. This payload deliberately contains only render-affecting source
 * state and remains identical before and after optional renderer modules initialize.
 */
function canonicalFingerprintJson(value: unknown): string {
  const ancestors = new Set<object>();
  const normalize = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== "object") return entry;
    if (ancestors.has(entry)) throw new TypeError("circular raster fingerprint source");
    ancestors.add(entry);
    try {
      if (Array.isArray(entry)) return entry.map(normalize);
      const record = entry as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .filter((key) => record[key] !== undefined)
          .toSorted()
          .map((key) => [key, normalize(record[key])]),
      );
    } finally {
      ancestors.delete(entry);
    }
  };
  const serialized = JSON.stringify(normalize(value));
  if (serialized === undefined) throw new TypeError("empty raster fingerprint source");
  return serialized;
}

function fingerprintEditableRasterCopySource(input: {
  readonly width: number;
  readonly height: number;
  readonly sourceElements: readonly El[];
  readonly theme?: SvgExportTheme;
  readonly includeBackground: boolean;
  readonly bg?: string;
  readonly bgGrad?: readonly string[] | null;
}): string {
  return fingerprintEditableRasterCopy(canonicalFingerprintJson({
    width: input.width,
    height: input.height,
    elements: input.sourceElements,
    theme: input.theme ?? null,
    background: input.includeBackground
      ? { color: input.bg ?? null, gradient: input.bgGrad ?? null }
      : null,
  }));
}

interface StudioRasterSourceSelection {
  readonly sourceElements: readonly El[];
  readonly mismatchIds: readonly string[];
}

const UNSUPPORTED_GROUP_TRANSFORM_KEYS = [
  "x",
  "y",
  "rotation",
  "scaleX",
  "scaleY",
  "skewX",
  "skewY",
  "transform",
  "matrix",
] as const;

function hasUnsupportedGroupTransform(group: LayerGroup): boolean {
  const record = group as LayerGroup & Record<string, unknown>;
  return UNSUPPORTED_GROUP_TRANSFORM_KEYS.some((key) => {
    const value = record[key];
    if (value === undefined || value === null) return false;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return true;
      if (key === "scaleX" || key === "scaleY") return value !== 1;
      return value !== 0;
    }
    return true;
  });
}

function studioRasterPreparationFrame(
  width: number,
  height: number,
): StudioRasterPreparationFrame {
  return { x: 0, y: 0, width, height, rotation: 0 };
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fullyTransparentCssColor(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase().replace(/\s+/gu, "");
  if (normalized === "transparent") return true;
  if (/^#[0-9a-f]{8}$/u.test(normalized)) return normalized.slice(7) === "00";
  if (/^#[0-9a-f]{4}$/u.test(normalized)) return normalized.slice(4) === "0";
  const functional = normalized.match(/^rgba?\((.*)\)$/u);
  if (!functional) return false;
  const channels = functional[1]?.split(",") ?? [];
  if (channels.length !== 4) return false;
  const alpha = channels[3];
  if (!alpha) return false;
  return alpha.endsWith("%")
    ? Number.parseFloat(alpha) <= 0
    : Number.parseFloat(alpha) <= 0;
}

function elementContributesVisiblePixels(element: El): boolean {
  if ((element.opacity ?? 1) <= 0) return false;
  if (element.type === "draw") {
    // An eraser contributes to the composite by removing pixels underneath it. It is not a
    // selectable vector boundary, but must remain in the fidelity census so SVG preflight blocks
    // rather than silently ignoring the deletion.
    if (element.mode === "eraser") return element.points.length >= 2;
    const fillVisible = element.fill !== undefined && !fullyTransparentCssColor(element.fill);
    const strokeVisible = element.strokeWidth > 0 && !fullyTransparentCssColor(element.stroke);
    return fillVisible || strokeVisible;
  }
  if (element.type === "text") {
    return element.text.trim().length > 0
      && (element.fontSize > 0)
      && (!fullyTransparentCssColor(element.fill)
        || ((element.strokeWidth ?? 0) > 0 && !fullyTransparentCssColor(element.stroke)));
  }
  if (element.type === "bubble") {
    return !fullyTransparentCssColor(element.fill)
      || !fullyTransparentCssColor(element.stroke)
      || (element.text.trim().length > 0 && !fullyTransparentCssColor(element.textFill));
  }
  if (element.type === "sticker") {
    return element.text.trim().length > 0 && element.fontSize > 0;
  }
  if (element.type === "image") return element.src.trim().length > 0;
  if (element.type === "frame") {
    return !fullyTransparentCssColor(element.bgColor ?? "#ffffff")
      || ((element.strokeWidth ?? 3) > 0 && !fullyTransparentCssColor(element.stroke ?? "#16100c"))
      || Boolean(element.bg);
  }
  return element.width > 0
    && element.height > 0
    && element.strokeWidth > 0
    && !fullyTransparentCssColor(element.stroke);
}

function rotatedRectBounds(input: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number;
}): StudioRasterPreparationBounds {
  const angle = ((input.rotation ?? 0) * Math.PI) / 180;
  if (angle === 0) {
    return { x: input.x, y: input.y, width: input.width, height: input.height };
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners = [
    [0, 0],
    [input.width, 0],
    [input.width, input.height],
    [0, input.height],
  ] as const;
  const xs = corners.map(([x, y]) => input.x + x * cos - y * sin);
  const ys = corners.map(([x, y]) => input.y + x * sin + y * cos);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function drawElementBounds(
  element: Extract<El, { type: "draw" }>,
): StudioRasterPreparationBounds | null {
  if (element.points.length < 2 || element.points.length % 2 !== 0) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 0; index < element.points.length; index += 2) {
    xs.push(element.points[index]!);
    ys.push(element.points[index + 1]!);
  }
  const padding = Math.max(0, element.strokeWidth) / 2;
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  const maxX = Math.max(...xs) + padding;
  const maxY = Math.max(...ys) + padding;
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function elementRasterPreparationBounds(element: El): StudioRasterPreparationBounds | null {
  if (!elementContributesVisiblePixels(element)) return null;
  if (element.type === "draw") return drawElementBounds(element);
  if (element.type === "text") {
    const lineCount = Math.max(1, element.text.split("\n").length);
    return rotatedRectBounds({
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.fontSize * (element.lineHeight ?? 1) * lineCount,
      rotation: element.rotation,
    });
  }
  if (element.type === "sticker") {
    return rotatedRectBounds({
      x: element.x,
      y: element.y,
      width: element.fontSize,
      height: element.fontSize,
      rotation: element.rotation,
    });
  }
  return rotatedRectBounds({
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: "rotation" in element ? element.rotation : 0,
  });
}

function clipBoundsToFrame(
  bounds: StudioRasterPreparationBounds,
  frame: StudioRasterPreparationFrame,
): StudioRasterPreparationBounds | null {
  const x = Math.max(frame.x, bounds.x);
  const y = Math.max(frame.y, bounds.y);
  const right = Math.min(frame.width, bounds.x + bounds.width);
  const bottom = Math.min(frame.height, bounds.y + bounds.height);
  if (!(right > x && bottom > y)) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function unionSourceBounds(
  elements: readonly El[],
  frame: StudioRasterPreparationFrame,
): StudioRasterPreparationBounds | null {
  let union: StudioRasterPreparationBounds | null = null;
  for (const element of elements) {
    const rawBounds = elementRasterPreparationBounds(element);
    if (!rawBounds) continue;
    const bounds = clipBoundsToFrame(rawBounds, frame);
    if (!bounds) continue;
    if (!union) {
      union = bounds;
      continue;
    }
    const x = Math.min(union.x, bounds.x);
    const y = Math.min(union.y, bounds.y);
    const right = Math.max(union.x + union.width, bounds.x + bounds.width);
    const bottom = Math.max(union.y + union.height, bounds.y + bounds.height);
    union = { x, y, width: right - x, height: bottom - y };
  }
  return union;
}

function invalidElementGeometryReason(element: El): string | null {
  if (!element.id.trim()) return "빈 요소 id";
  if (!finiteNumber(element.opacity ?? 1) || (element.opacity ?? 1) < 0 || (element.opacity ?? 1) > 1) {
    return "요소 불투명도";
  }
  if (element.type === "draw") {
    if (
      element.points.length < 2
      || element.points.length % 2 !== 0
      || element.points.some((point) => !finiteNumber(point))
      || !finiteNumber(element.strokeWidth)
      || element.strokeWidth < 0
    ) {
      return "선·도형 좌표";
    }
    return null;
  }
  if (
    !finiteNumber(element.x)
    || !finiteNumber(element.y)
    || ("rotation" in element && !finiteNumber(element.rotation))
  ) {
    return "요소 변형";
  }
  if (element.type === "text") {
    return finiteNumber(element.width)
      && element.width > 0
      && finiteNumber(element.fontSize)
      && element.fontSize > 0
      ? null
      : "텍스트 경계";
  }
  if (element.type === "sticker") {
    return finiteNumber(element.fontSize) && element.fontSize > 0 ? null : "스티커 경계";
  }
  return finiteNumber(element.width)
    && finiteNumber(element.height)
    && element.width > 0
    && element.height > 0
    ? null
    : "요소 경계";
}

function selectCopySources(input: StudioEditableRasterCopyInput): StudioRasterSourceSelection {
  const groups = [...(input.groups ?? [])];
  const requested = input.sourceIds ? new Set(input.sourceIds) : null;
  const excluded = new Set(input.excludedSourceIds ?? []);
  const visibleById = new Map(
    input.elements
      .filter((element) =>
        !isEffectivelyHidden(element, groups) && elementContributesVisiblePixels(element)
      )
      .map((element) => [element.id, element] as const),
  );
  const mismatchIds = requested
    ? [...requested].filter((id) => !visibleById.has(id) || excluded.has(id))
    : [];
  return {
    sourceElements: input.elements.filter((element) =>
      !isEffectivelyHidden(element, groups)
      && elementContributesVisiblePixels(element)
      && !excluded.has(element.id)
      && (!requested || requested.has(element.id))
    ),
    mismatchIds,
  };
}

/** Builds the page snapshot and all fail-closed reasons inside the user-triggered lazy seam. */
export function createStudioEditablePageRasterContext(
  context: StudioEditablePageRasterContextInput,
): StudioEditablePageRasterContext {
  const { page } = context;
  const purpose = context.purpose ?? "page-filter";
  const groups = [...(page.groups ?? [])];
  const sourceElements = [
    ...(page.hideMaster ? [] : context.masterElements),
    ...page.elements,
  ];
  const hasVisibleAnimatedSource = sourceElements.some((element) =>
    element.type === "image" &&
    !isEffectivelyHidden(element, groups) &&
    (element.isAnimatedGif || (element.frames?.length ?? 0) > 1)
  );
  const hasLocallyHiddenSource = sourceElements.some((element) =>
    context.localHiddenElementIds.has(element.id)
  );
  const documentMutationBlockedReason = context.collaborationLockedReason
    ?? (context.sharedDocument
      ? purpose === "pixel-selection"
        ? "공동 작업 문서에서는 편집용 래스터 복사본 동기화를 준비 중이에요. 개인 문서에서 픽셀 선택을 사용해 주세요."
        : "공동 작업 문서의 페이지 합성 필터는 모든 참여자에게 동일한 픽셀 결과를 전달할 수 있도록 준비 중이에요. 지금은 선택 이미지 필터를 사용해 주세요."
      : hasLocallyHiddenSource
        ? "‘나만 숨기기’ 레이어를 먼저 다시 표시해 주세요. 개인 표시 상태는 공유·저장되는 필터 합성본에 포함하지 않습니다."
        : context.masterEditMode
          ? "마스터 편집을 끝낸 뒤 현재 페이지 합성 필터를 사용할 수 있어요."
          : context.reviewLocked
            ? "검토 잠금을 해제한 뒤 현재 페이지에 필터를 적용해 주세요."
            : context.timelinePlaying
              ? "타임라인 재생을 멈춘 뒤 현재 프레임을 기준으로 필터를 적용해 주세요."
              : hasVisibleAnimatedSource
                ? "애니메이션 레이어는 현재 프레임의 정적 복사본을 만든 뒤 페이지 필터에 포함할 수 있어요."
                : context.viewTransformSuppressed
                  ? "저장·내보내기·타임랩스 캡처가 끝난 뒤 현재 페이지에 필터를 적용해 주세요."
                  : null);
  const budgets = purpose === "page-filter"
    ? {
        ...context.budgets,
        maxPixelCount: Math.min(
          context.budgets?.maxPixelCount ?? PAGE_COMPOSITE_FILTER_MAX_PIXELS,
          PAGE_COMPOSITE_FILTER_MAX_PIXELS,
        ),
        maxPngBytes: Math.min(
          context.budgets?.maxPngBytes ?? PAGE_COMPOSITE_FILTER_MAX_PNG_BYTES,
          PAGE_COMPOSITE_FILTER_MAX_PNG_BYTES,
        ),
      }
    : context.budgets;

  return {
    input: {
      pageId: page.id,
      width: context.canvasWidth,
      height: page.canvasH,
      elements: sourceElements,
      groups,
      theme: context.theme,
      includeBackground: true,
      bg: page.bg,
      bgGrad: page.bgGrad,
      name: context.name,
      insertionIndex: page.elements.length,
      sourceDisposition: purpose === "pixel-selection"
        ? "hide-originals"
        : "preserve-visible",
      sourceDispositionIds: purpose === "pixel-selection"
        ? page.elements.map((element) => element.id)
        : [],
      documentMutationBlockedReason,
      budgets,
    },
    destinationElements: page.elements,
  };
}

/**
 * One source census for menus/rails/inspectors. It is intended for command-open or panel-open
 * paths, not pointermove: SVG serialization is used to detect approximated fidelity honestly.
 */
interface StudioRasterPreparationAnalysis {
  readonly summary: StudioRasterPreparationSourceSummary;
  readonly exported: SvgExportResult | null;
}

function analyzeStudioRasterPreparationSources(
  input: StudioRasterPreparationSourceSummaryInput,
  preparedExport?: SvgExportResult,
): StudioRasterPreparationAnalysis {
  const groups = [...(input.groups ?? [])];
  const visible = input.elements.filter((element) => !isEffectivelyHidden(element, groups));
  const hiddenContentCount = input.elements.length - visible.length;
  const visibleRaster = visible.filter((element): element is ImageEl & El => element.type === "image");
  const visibleContributing = visible.filter(elementContributesVisiblePixels);
  const visibleVectorDrawCount = visibleContributing.filter(
    (element) => element.type === "draw" && element.mode !== "eraser",
  ).length;
  const visibleCompositeVectorCount = visibleContributing.filter(
    (element) => element.type !== "image" && !(element.type === "draw" && element.mode === "eraser"),
  ).length;
  const visibleLinked3dPreviewCount = visibleContributing.filter(
    (element) => element.type === "image" && Boolean(element.bg3dScene || element.vrmScene),
  ).length;
  const frame = studioRasterPreparationFrame(input.width, input.height);
  const sourceBounds = validDimensions(input.width, input.height)
    ? unionSourceBounds(visibleContributing, frame)
    : null;
  const orderedVisibleSourceIds = visibleContributing.map((element) => element.id);
  const lockedVisibleSourceIds = visibleContributing
    .filter((element) => isEffectivelyLocked(element, groups))
    .map((element) => element.id);
  if (!validDimensions(input.width, input.height)) {
    return {
      summary: {
        frame,
        sourceBounds,
        orderedVisibleSourceIds,
        exactRenderableSourceIds: [],
        lockedVisibleSourceIds,
        visibleContentCount: visible.length,
        hiddenContentCount,
        visibleRasterCount: visibleRaster.length,
        visibleUnlockedRasterCount: visibleRaster.filter(
          (element) => !isEffectivelyLocked(element, groups),
        ).length,
        visibleVectorDrawCount,
        visibleCompositeVectorCount,
        visibleLinked3dPreviewCount,
        exactRenderableVisibleCount: 0,
        unsupportedVisibleCount: visibleContributing.length,
        unsupportedReasons: ["페이지 크기가 안전한 래스터 처리 범위를 벗어났습니다."],
        hasPageBackground: input.hasPageBackground ?? true,
      },
      exported: null,
    };
  }

  const knownGroupIds = new Set(groups.map((group) => group.id));
  const duplicateElementIds = new Set<string>();
  const seenElementIds = new Set<string>();
  for (const element of visible) {
    if (seenElementIds.has(element.id)) duplicateElementIds.add(element.id);
    seenElementIds.add(element.id);
  }
  const structurallyUnsupported = new Map<string, string>();
  for (const element of visibleContributing) {
    const invalidGeometry = invalidElementGeometryReason(element);
    if (invalidGeometry) {
      structurallyUnsupported.set(element.id, `${invalidGeometry}가 올바르지 않습니다.`);
      continue;
    }
    if (duplicateElementIds.has(element.id)) {
      structurallyUnsupported.set(element.id, "중복 요소 id는 안전하게 합성할 수 없습니다.");
      continue;
    }
    if (element.groupId && !knownGroupIds.has(element.groupId)) {
      structurallyUnsupported.set(element.id, "연결되지 않은 레이어 그룹은 안전하게 합성할 수 없습니다.");
      continue;
    }
    const group = element.groupId
      ? groups.find((candidate) => candidate.id === element.groupId)
      : null;
    if (group && hasUnsupportedGroupTransform(group)) {
      structurallyUnsupported.set(element.id, "레이어 그룹 변형은 합성 렌더러에서 지원되지 않습니다.");
    }
  }
  const exported = preparedExport ?? exportPageToSvg({
    width: input.width,
    height: input.height,
    elements: visibleContributing,
    groups,
    theme: input.theme,
    transparentBg: !(input.hasPageBackground ?? true),
    bg: input.bg,
    bgGrad: input.bgGrad,
  });
  const unsupportedIds = new Set([
    ...exported.skipped.map((skip) => skip.id),
    ...structurallyUnsupported.keys(),
  ]);
  const exactRenderableSourceIds = orderedVisibleSourceIds.filter((id) => !unsupportedIds.has(id));
  return {
    summary: {
      frame,
      sourceBounds,
      orderedVisibleSourceIds,
      exactRenderableSourceIds,
      lockedVisibleSourceIds,
      visibleContentCount: visible.length,
      hiddenContentCount,
      visibleRasterCount: visibleRaster.length,
      visibleUnlockedRasterCount: visibleRaster.filter(
        (element) => !isEffectivelyLocked(element, groups),
      ).length,
      visibleVectorDrawCount,
      visibleCompositeVectorCount,
      visibleLinked3dPreviewCount,
      exactRenderableVisibleCount: exactRenderableSourceIds.length,
      unsupportedVisibleCount: unsupportedIds.size,
      unsupportedReasons: [...new Set([
        ...exported.skipped.map((skip) => skip.label),
        ...structurallyUnsupported.values(),
      ])],
      hasPageBackground: input.hasPageBackground ?? true,
    },
    exported,
  };
}

/**
 * One source census for menus, recovery panels and selection tools. Planning uses the same
 * analyzer and reuses its SVG output so a large page is never serialized twice per command.
 */
export function summarizeStudioRasterPreparationSources(
  input: StudioRasterPreparationSourceSummaryInput,
): StudioRasterPreparationSourceSummary {
  return analyzeStudioRasterPreparationSources(input).summary;
}

/**
 * The preflight's loss labels are authored for the SVG export dialog ("…는 SVG에 없어…"), which is
 * the wrong vocabulary the moment the same label surfaces on a filter: an artist reading it learns
 * nothing about what to do next. Fail-closed is right — a filter must never quietly produce
 * something other than what is on screen — so the copy, not the gate, is what changes here. Each
 * known blocker maps to the edit that clears it; anything unmapped falls back to the one action
 * that always works (bake that layer to an image first).
 */
const FIDELITY_ACTIONS: readonly { readonly match: RegExp; readonly action: string }[] = [
  {
    match: /자동 줄바꿈/u,
    action:
      "말풍선·글상자의 글이 상자보다 길어 자동으로 줄이 바뀝니다. 상자를 조금 넓히거나 원하는 자리에서 엔터로 줄을 나눈 뒤 다시 시도해 주세요.",
  },
  {
    match: /지우개/u,
    action:
      "지우개로 지운 자국이 남은 그리기 레이어가 있습니다. 그 레이어를 먼저 이미지로 병합한 뒤 다시 시도해 주세요.",
  },
  {
    match: /세로쓰기/u,
    action:
      "세로쓰기 안의 영문·숫자 구간은 줄 나눔이 화면과 조금 달라질 수 있습니다. 해당 텍스트를 가로쓰기로 바꾸거나 이미지로 병합한 뒤 다시 시도해 주세요.",
  },
  {
    match: /외부 주소/u,
    action:
      "인터넷 주소로 연결된 이미지가 있습니다. 그 이미지를 작업 파일에 넣어 두거나(다시 올리기) 잠시 숨긴 뒤 다시 시도해 주세요.",
  },
  {
    match: /혼합 모드|클리핑 마스크|아래 레이어로 자르기/u,
    action:
      "혼합 모드나 아래 레이어로 자르기가 걸린 레이어가 있습니다. 그 레이어를 먼저 아래 레이어와 병합한 뒤 다시 시도해 주세요.",
  },
  {
    match: /픽셀 필터·색보정/u,
    action:
      "이미 색보정이 걸려 있는 이미지 레이어가 있습니다. 그 보정을 레이어에 먼저 적용(병합)한 뒤 다시 시도해 주세요.",
  },
  {
    match: /중복 요소 id|연결되지 않은 레이어 그룹|레이어 그룹 변형|올바르지 않습니다/u,
    action:
      "레이어 구조가 어긋난 요소가 있습니다. 문제 레이어를 그룹에서 꺼내거나 지운 뒤 다시 시도해 주세요.",
  },
];

const FIDELITY_FALLBACK_ACTION =
  "화면과 똑같이 합칠 수 없는 레이어가 있습니다. 그 레이어를 먼저 이미지로 병합한 뒤 다시 시도해 주세요.";

function fidelityAction(label: string): string {
  return FIDELITY_ACTIONS.find((entry) => entry.match.test(label))?.action
    ?? FIDELITY_FALLBACK_ACTION;
}

function fidelityReason(labels: readonly string[]): string {
  const actions = [...new Set(labels.map(fidelityAction))].slice(0, 2);
  const detail = actions.length > 0 ? ` ${actions.join(" ")}` : ` ${FIDELITY_FALLBACK_ACTION}`;
  return `화면에 보이는 그대로 만들 수 없어 아무것도 바꾸지 않았습니다.${detail}`;
}

interface StudioEditableRasterCopyCandidate {
  readonly pageId: string;
  readonly width: number;
  readonly height: number;
  readonly sourceElements: readonly El[];
  readonly groups: readonly LayerGroup[];
  readonly theme?: SvgExportTheme;
  readonly includeBackground: boolean;
  readonly bg?: string;
  readonly bgGrad?: readonly string[] | null;
  readonly name: string;
  readonly insertionIndex: number;
  readonly sourceDisposition: "preserve-visible" | "hide-originals";
  readonly sourceDispositionIds: readonly string[];
  readonly sourceFingerprint: string;
  readonly sourceBudgetReceipt: StudioVectorReferenceSourceBudgetReceipt;
  readonly budgets?: StudioVectorReferenceBudgets;
}

type StudioEditableRasterCopyCandidateResult =
  | { readonly ok: true; readonly candidate: StudioEditableRasterCopyCandidate }
  | Extract<StudioEditableRasterCopyPlanResult, { ok: false }>;

/** Cheap ownership, lock and source-budget checks shared by sync and Worker-fused planners. */
function preflightStudioEditableRasterCopy(
  input: StudioEditableRasterCopyInput,
): StudioEditableRasterCopyCandidateResult {
  const pageId = input.pageId.trim();
  if (!pageId) {
    return { ok: false, code: "invalid-page-id", reason: "편집용 복사본을 연결할 페이지를 찾지 못했습니다." };
  }
  if (input.documentMutationBlockedReason) {
    return {
      ok: false,
      code: "document-locked",
      reason: input.documentMutationBlockedReason,
    };
  }
  const maxPixelCount = boundedByteBudget(
    input.budgets?.maxPixelCount,
    EDITABLE_RASTER_COPY_MAX_PIXELS,
  );
  if (!validDimensions(input.width, input.height, maxPixelCount)) {
    const requestedPixels = Number.isSafeInteger(input.width) && Number.isSafeInteger(input.height)
      ? input.width * input.height
      : null;
    return {
      ok: false,
      code: "invalid-dimensions",
      reason: requestedPixels && requestedPixels > 0
        ? `현재 페이지는 ${requestedPixels}픽셀로 필터 허용치 ${maxPixelCount}픽셀을 넘습니다. 페이지를 나누거나 해상도를 낮춰 주세요.`
        : "페이지 크기가 올바르지 않습니다. 양수 정수 해상도로 조정해 주세요.",
    };
  }

  const includeBackground = input.includeBackground ?? true;
  const sourceDisposition = input.sourceDisposition ?? "preserve-visible";
  const selectedSources = selectCopySources(input);
  const sourceElements = selectedSources.sourceElements;
  if (selectedSources.mismatchIds.length > 0) {
    return {
      ok: false,
      code: "source-selection-mismatch",
      reason: `요청한 합성 원본 ${selectedSources.mismatchIds.slice(0, 3).join(" · ")}이(가) 숨김·제외·누락 또는 완전 투명 상태입니다. 표시 상태와 대상을 다시 확인해 주세요.`,
    };
  }
  if (
    sourceElements.length === 0
    && (!includeBackground || sourceDisposition === "hide-originals")
  ) {
    return {
      ok: false,
      code: "no-visible-source",
      reason: sourceDisposition === "hide-originals"
        ? "픽셀 선택용 복사본으로 만들 표시 요소가 없습니다. 완전 투명·숨김 레이어가 아닌 선이나 객체를 먼저 추가해 주세요."
        : "편집용 복사본으로 만들 표시 레이어가 없습니다.",
    };
  }
  const requestedDispositionIds = input.sourceDispositionIds
    ? new Set(input.sourceDispositionIds)
    : sourceDisposition === "hide-originals"
      ? new Set(sourceElements.map((element) => element.id))
      : new Set<string>();
  const sourceIds = new Set(sourceElements.map((element) => element.id));
  const unknownDispositionIds = [...requestedDispositionIds].filter(
    (id) => !input.elements.some((element) => element.id === id),
  );
  if (unknownDispositionIds.length > 0) {
    return {
      ok: false,
      code: "source-selection-mismatch",
      reason: `숨김 대상으로 지정한 원본 ${unknownDispositionIds.slice(0, 3).join(" · ")}을(를) 현재 문서에서 찾지 못했습니다.`,
    };
  }
  const sourceDispositionIds = [...requestedDispositionIds].filter((id) => sourceIds.has(id));
  const groups = [...(input.groups ?? [])];
  if (sourceDisposition === "hide-originals") {
    const lockedDispositionIds = sourceElements
      .filter(
        (element) =>
          requestedDispositionIds.has(element.id)
          && isEffectivelyLocked(element, groups),
      )
      .map((element) => element.id);
    if (lockedDispositionIds.length > 0) {
      return {
        ok: false,
        code: "source-locked",
        reason: `잠긴 원본 ${lockedDispositionIds.slice(0, 3).join(" · ")}은(는) 숨길 수 없습니다. 요소 또는 그룹 잠금을 해제한 뒤 다시 시도해 주세요.`,
      };
    }
  }
  const maxSourceBytes = boundedByteBudget(
    input.budgets?.maxSourceBytes,
    EDITABLE_RASTER_COPY_MAX_SOURCE_BYTES,
  );
  let sourceBudgetReceipt: StudioVectorReferenceSourceBudgetReceipt;
  let sourceByteLength: number;
  let sourceFingerprint: string;
  try {
    ({ receipt: sourceBudgetReceipt, sourceByteLength } =
      createStudioVectorReferenceSourceBudgetReceipt(sourceElements, maxSourceBytes));
    sourceFingerprint = fingerprintEditableRasterCopySource({
      width: input.width,
      height: input.height,
      sourceElements,
      theme: input.theme,
      includeBackground,
      bg: input.bg,
      bgGrad: input.bgGrad,
    });
  } catch {
    return {
      ok: false,
      code: "source-budget-exceeded",
      reason: "표시 레이어 데이터를 안전하게 읽지 못해 편집용 복사본을 만들지 않았습니다.",
    };
  }
  if (sourceByteLength > maxSourceBytes) {
    return {
      ok: false,
      code: "source-budget-exceeded",
      reason: "표시 레이어 데이터가 안전 처리 한도를 넘었습니다. 페이지를 나누거나 일부 레이어를 먼저 병합해 주세요.",
    };
  }
  return {
    ok: true,
    candidate: {
      pageId,
      width: input.width,
      height: input.height,
      sourceElements,
      groups,
      theme: input.theme,
      includeBackground,
      bg: input.bg,
      bgGrad: input.bgGrad,
      name: normalizeCopyName(input.name),
      insertionIndex: normalizeInsertionIndex(input.insertionIndex, input.elements.length),
      sourceDisposition,
      sourceDispositionIds,
      sourceFingerprint,
      sourceBudgetReceipt,
      budgets: input.budgets ? { ...input.budgets } : undefined,
    },
  };
}

function finalizeStudioEditableRasterCopyPlan(
  candidate: StudioEditableRasterCopyCandidate,
  preparedExport?: SvgExportResult,
): StudioEditableRasterCopyPlanResult {
  const sourceAnalysis = analyzeStudioRasterPreparationSources({
    width: candidate.width,
    height: candidate.height,
    elements: candidate.sourceElements,
    groups: candidate.groups,
    theme: candidate.theme,
    bg: candidate.bg,
    bgGrad: candidate.bgGrad,
    hasPageBackground: candidate.includeBackground,
  }, preparedExport);
  const sourceSummary = sourceAnalysis.summary;
  if (sourceSummary.unsupportedVisibleCount > 0) {
    return {
      ok: false,
      code: "unsupported-fidelity",
      reason: fidelityReason(sourceSummary.unsupportedReasons),
    };
  }
  const exported = sourceAnalysis.exported;
  if (!exported) {
    return {
      ok: false,
      code: "invalid-dimensions",
      reason: "페이지 크기가 올바르지 않습니다. 양수 정수 해상도로 조정해 주세요.",
    };
  }
  if (exported.skipped.length > 0) {
    return {
      ok: false,
      code: "unsupported-fidelity",
      reason: fidelityReason(exported.skipped.map((skip) => skip.label)),
    };
  }
  if (utf8ByteLength(exported.svg) > boundedByteBudget(
    candidate.budgets?.maxSvgBytes,
    EDITABLE_RASTER_COPY_MAX_SVG_BYTES,
  )) {
    return {
      ok: false,
      code: "svg-budget-exceeded",
      reason: "합성된 벡터 데이터가 안전 처리 한도를 넘었습니다. 페이지를 나누거나 일부 레이어를 먼저 병합해 주세요.",
    };
  }
  return {
    ok: true,
    plan: {
      pageId: candidate.pageId,
      width: candidate.width,
      height: candidate.height,
      sourceElements: candidate.sourceElements,
      sourceIds: candidate.sourceElements.map((element) => element.id),
      groups: candidate.groups,
      theme: candidate.theme,
      includeBackground: candidate.includeBackground,
      bg: candidate.bg,
      bgGrad: candidate.bgGrad,
      name: candidate.name,
      insertionIndex: candidate.insertionIndex,
      sourceDisposition: candidate.sourceDisposition,
      sourceDispositionIds: candidate.sourceDispositionIds,
      frame: sourceSummary.frame,
      sourceBounds: sourceSummary.sourceBounds,
      sourceSummary,
      sourceFingerprint: candidate.sourceFingerprint,
      sourceElementCount: exported.elementCount,
      budgets: candidate.budgets,
    },
  };
}

/**
 * Established synchronous planner retained for menus, summaries and compatibility callers.
 * It still performs one exact main-realm SVG export as its fidelity preflight.
 */
export function planStudioEditableRasterCopy(
  input: StudioEditableRasterCopyInput,
): StudioEditableRasterCopyPlanResult {
  const preflight = preflightStudioEditableRasterCopy(input);
  if (!preflight.ok) return preflight;
  return finalizeStudioEditableRasterCopyPlan(preflight.candidate);
}

function editableRasterCopyVectorInput(
  candidate: StudioEditableRasterCopyCandidate,
): StudioVectorReferenceInput {
  return {
    width: candidate.width,
    height: candidate.height,
    elements: candidate.sourceElements,
    groups: candidate.groups,
    theme: candidate.theme,
    transparentBg: !candidate.includeBackground,
    bg: candidate.bg,
    bgGrad: candidate.bgGrad,
    fingerprintNamespace: EDITABLE_RASTER_COPY_NAMESPACE,
    budgets: candidate.budgets,
    sourceBudgetReceipt: candidate.sourceBudgetReceipt,
  };
}

function throwIfEditableRasterPreparationAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("편집용 래스터 복사본 준비를 취소했습니다.");
  error.name = "AbortError";
  throw error;
}

export function describeStudioEditableRasterSelectionSurface(
  plan: StudioEditableRasterCopyPlan,
  toolKind: StudioEditableRasterSelectionToolKind,
): StudioEditableRasterSelectionSurface {
  return {
    toolKind,
    frame: plan.frame,
    sourceBounds: plan.sourceBounds,
    sourceSummary: plan.sourceSummary,
    sourceFingerprint: plan.sourceFingerprint,
  };
}

export async function renderStudioEditableRasterCopy(
  plan: StudioEditableRasterCopyPlan,
  renderVectorReference: StudioEditableRasterCopyRenderer,
  options: StudioVectorReferenceRenderOptions = {},
): Promise<StudioVectorReferenceResult> {
  // The eager Studio owner injects its existing renderer. Keeping this lazy seam type-only avoids
  // extracting that renderer into an additional shared HTTP request solely for this workflow.
  const result = await renderVectorReference({
    width: plan.width,
    height: plan.height,
    elements: plan.sourceElements,
    groups: plan.groups,
    theme: plan.theme,
    transparentBg: !plan.includeBackground,
    bg: plan.bg,
    bgGrad: plan.bgGrad,
    fingerprintNamespace: EDITABLE_RASTER_COPY_NAMESPACE,
    budgets: plan.budgets,
  }, options);
  return validateStudioEditableRasterCopyRender(plan, result);
}

function validateStudioEditableRasterCopyRender(
  plan: StudioEditableRasterCopyPlan,
  result: StudioVectorReferenceResult,
): StudioVectorReferenceResult {
  const pngByteLength = pngDataUrlByteLength(result.dataUrl);
  if (!new RegExp(`^${EDITABLE_RASTER_COPY_NAMESPACE}:[0-9a-f]{16}$`, "u").test(result.fingerprint)) {
    throw new Error("필터를 준비하는 동안 페이지 내용이 바뀌었습니다. 최신 화면에서 다시 시도해 주세요.");
  }
  if (result.width !== plan.width || result.height !== plan.height) {
    throw new Error("필터 합성 결과의 해상도가 현재 페이지와 다릅니다. 페이지 크기를 확인한 뒤 다시 시도해 주세요.");
  }
  if (result.elementCount !== plan.sourceElementCount) {
    throw new Error("필터 합성 결과의 레이어 수가 현재 페이지와 다릅니다. 최신 화면에서 다시 시도해 주세요.");
  }
  if (pngByteLength === null) {
    throw new Error("필터 합성 결과가 올바른 PNG가 아닙니다. 레이어를 단순화한 뒤 다시 시도해 주세요.");
  }
  const maxPngBytes = boundedByteBudget(
    plan.budgets?.maxPngBytes,
    EDITABLE_RASTER_COPY_MAX_PNG_BYTES,
  );
  if (pngByteLength > maxPngBytes) {
    throw new Error(`필터 합성 PNG가 ${pngByteLength}바이트로 허용치 ${maxPngBytes}바이트를 넘습니다. 페이지를 나누거나 해상도와 레이어 복잡도를 낮춰 주세요.`);
  }
  return {
    ...result,
    // Downstream materialization and commit compare document ownership, not the renderer's
    // pre/post-lazy SVG implementation fingerprint.
    fingerprint: plan.sourceFingerprint,
    pngByteLength,
  };
}

/**
 * Worker-fused cold path for retouch preparation.
 *
 * Ownership/lock/source limits are checked before serialization. The single prepared SVG result
 * then supplies both the fidelity plan (`skipped`, count and SVG budget) and the rasterizer, so
 * this path never invokes the synchronous `exportPageToSvg` preflight on the interaction thread.
 * The established synchronous `planStudioEditableRasterCopy` API remains available unchanged for
 * callers that cannot cross an async boundary.
 */
export async function prepareAndRenderStudioEditableRasterCopy(
  input: StudioEditableRasterCopyInput,
  prepareVectorReference: StudioEditableRasterCopyExportPreparer,
  renderPreparedVectorReference: StudioEditableRasterCopyPreparedRenderer,
  options: StudioVectorReferenceRenderOptions = {},
): Promise<StudioEditableRasterCopyPreparedResult> {
  throwIfEditableRasterPreparationAborted(options.signal);
  const preflight = preflightStudioEditableRasterCopy(input);
  if (!preflight.ok) return preflight;

  const prepared = await prepareVectorReference(
    editableRasterCopyVectorInput(preflight.candidate),
    options,
  );
  throwIfEditableRasterPreparationAborted(options.signal);

  const planned = finalizeStudioEditableRasterCopyPlan(
    preflight.candidate,
    prepared.result,
  );
  if (!planned.ok) return planned;
  throwIfEditableRasterPreparationAborted(options.signal);

  const rendered = await renderPreparedVectorReference(prepared, options);
  throwIfEditableRasterPreparationAborted(options.signal);
  return {
    ok: true,
    plan: planned.plan,
    rendered: validateStudioEditableRasterCopyRender(planned.plan, rendered),
  };
}

export function materializeStudioEditableRasterCopy(input: {
  readonly plan: StudioEditableRasterCopyPlan;
  readonly rendered: StudioVectorReferenceResult;
  readonly newId: string;
}): ImageEl & El {
  const id = input.newId.trim();
  if (!id) throw new Error("편집용 래스터 복사본 id가 필요합니다.");
  if (
    input.rendered.fingerprint !== input.plan.sourceFingerprint
    || input.rendered.width !== input.plan.width
    || input.rendered.height !== input.plan.height
    || !input.rendered.dataUrl.startsWith(PNG_DATA_URL_PREFIX)
  ) {
    throw new Error("편집용 래스터 복사본 결과가 현재 계획과 일치하지 않습니다.");
  }
  return {
    id,
    type: "image",
    name: input.plan.name,
    src: input.rendered.dataUrl,
    x: 0,
    y: 0,
    width: input.plan.width,
    height: input.plan.height,
    rotation: 0,
  };
}

/**
 * Revalidate document ownership after an await without repeating SVG fidelity serialization.
 *
 * The initial plan already proved renderer fidelity. At commit time only document/source identity,
 * visibility, mutation locks and placement can have gone stale; canonical source fingerprinting is
 * sufficient for those checks and keeps a first pixel gesture from paying two more synchronous
 * `exportPageToSvg` passes.
 */
export function isStudioEditableRasterCopyPlanCurrent(
  plan: StudioEditableRasterCopyPlan,
  current: StudioEditableRasterCopyInput,
): boolean {
  if (
    current.documentMutationBlockedReason
    || current.pageId.trim() !== plan.pageId
    || !validDimensions(
      current.width,
      current.height,
      boundedByteBudget(current.budgets?.maxPixelCount, EDITABLE_RASTER_COPY_MAX_PIXELS),
    )
    || !currentBudgetsAreNotStricter(plan.budgets, current.budgets)
  ) return false;

  const includeBackground = current.includeBackground ?? true;
  const sourceDisposition = current.sourceDisposition ?? "preserve-visible";
  if (sourceDisposition !== plan.sourceDisposition) return false;

  const selectedSources = selectCopySources(current);
  if (selectedSources.mismatchIds.length > 0) return false;
  const sourceElements = selectedSources.sourceElements;
  if (
    sourceElements.length === 0
    && (!includeBackground || sourceDisposition === "hide-originals")
  ) return false;
  if (
    sourceElements.length !== plan.sourceIds.length
    || sourceElements.some((element, index) => element.id !== plan.sourceIds[index])
  ) return false;

  const requestedDispositionIds = current.sourceDispositionIds
    ? new Set(current.sourceDispositionIds)
    : sourceDisposition === "hide-originals"
      ? new Set(sourceElements.map((element) => element.id))
      : new Set<string>();
  if ([...requestedDispositionIds].some(
    (id) => !current.elements.some((element) => element.id === id),
  )) return false;
  const sourceIds = new Set(sourceElements.map((element) => element.id));
  const sourceDispositionIds = [...requestedDispositionIds].filter((id) => sourceIds.has(id));
  if (
    sourceDispositionIds.length !== plan.sourceDispositionIds.length
    || sourceDispositionIds.some((id, index) => id !== plan.sourceDispositionIds[index])
  ) return false;

  const groups = [...(current.groups ?? [])];
  const knownGroupIds = new Set(groups.map((group) => group.id));
  if (sourceElements.some(
    (element) => element.groupId && !knownGroupIds.has(element.groupId),
  )) return false;
  if (sourceElements.some((element) => {
    const group = element.groupId
      ? groups.find((candidate) => candidate.id === element.groupId)
      : null;
    return Boolean(group && hasUnsupportedGroupTransform(group));
  })) return false;
  if (
    sourceDisposition === "hide-originals"
    && sourceElements.some(
      (element) => requestedDispositionIds.has(element.id) && isEffectivelyLocked(element, groups),
    )
  ) return false;
  if (normalizeInsertionIndex(current.insertionIndex, current.elements.length) !== plan.insertionIndex) {
    return false;
  }

  try {
    return fingerprintEditableRasterCopySource({
      width: current.width,
      height: current.height,
      sourceElements,
      theme: current.theme,
      includeBackground,
      bg: current.bg,
      bgGrad: current.bgGrad,
    }) === plan.sourceFingerprint;
  } catch {
    return false;
  }
}

/**
 * Commit boundary for a non-destructive raster copy.
 *
 * Planning, rendering and materializing are deliberately mutation-free, so dismissing a preview
 * requires no rollback. Applying revalidates the complete source fingerprint and document lock
 * after the asynchronous raster boundary, then inserts exactly one composite without removing or
 * patching any authored element.
 */
export function applyStudioEditableRasterCopy(input: {
  readonly plan: StudioEditableRasterCopyPlan;
  readonly current: StudioEditableRasterCopyInput;
  readonly composite: ImageEl & El;
  /**
   * Optional authored destination when the raster source also contains read-only underlays such
   * as a document master. The plan fingerprint still covers `current.elements`, while only this
   * destination receives the new composite.
   */
  readonly destinationElements?: readonly El[];
}): StudioEditableRasterCopyApplyResult {
  if (!isStudioEditableRasterCopyPlanCurrent(input.plan, input.current)) {
    return {
      ok: false,
      code: "stale-plan",
      reason: "편집용 래스터를 준비하는 동안 페이지 내용이나 잠금 상태가 바뀌었습니다. 최신 화면에서 다시 시도해 주세요.",
    };
  }

  const { composite, plan } = input;
  const destinationElements = input.destinationElements ?? input.current.elements;
  const pngByteLength = pngDataUrlByteLength(composite.src);
  const maxPngBytes = boundedByteBudget(
    plan.budgets?.maxPngBytes,
    EDITABLE_RASTER_COPY_MAX_PNG_BYTES,
  );
  if (pngByteLength === null) {
    return {
      ok: false,
      code: "invalid-composite",
      reason: "래스터 합성 결과가 올바른 PNG가 아니어서 원본을 변경하지 않았습니다.",
    };
  }
  if (pngByteLength > maxPngBytes) {
    return {
      ok: false,
      code: "invalid-composite",
      reason: `필터 합성 PNG가 허용치 ${maxPngBytes}바이트를 넘어 적용하지 않았습니다. 페이지를 나누거나 해상도를 낮춰 주세요.`,
    };
  }
  if (
    !composite.id.trim()
    || destinationElements.some((element) => element.id === composite.id)
    || composite.x !== 0
    || composite.y !== 0
    || composite.width !== plan.width
    || composite.height !== plan.height
    || composite.rotation !== 0
    || plan.insertionIndex > destinationElements.length
  ) {
    return {
      ok: false,
      code: "invalid-composite",
      reason: "필터 합성 레이어가 현재 페이지와 일치하지 않아 원본을 변경하지 않았습니다.",
    };
  }

  const sourceDispositionIds = new Set(plan.sourceDispositionIds);
  const elements = plan.sourceDisposition === "hide-originals"
    ? destinationElements.map((element) =>
        sourceDispositionIds.has(element.id) && element.hidden !== true
          ? { ...element, hidden: true }
          : element
      )
    : [...destinationElements];
  elements.splice(plan.insertionIndex, 0, composite);
  return { ok: true, elements };
}
