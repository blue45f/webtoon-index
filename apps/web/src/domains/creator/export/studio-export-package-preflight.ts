/**
 * Export package preflight: page-range selection, dialogue TXT inclusion, trim/bleed/DPI.
 *
 * Blocks invalid packages with explicit Korean reasons. Pure — no canvas/DOM I/O.
 * Complements destination-aware publish preflight (`studio-publish-preflight.ts`) with
 * print/export geometry checks that the image pipeline needs before encoding.
 */
import {
  collectDialogueItems,
  type DialogueBatchItem,
  type DialogueElementLike,
  type DialoguePageLike,
} from "../lettering/studio-dialogue-batch";
import {
  serializeStudioDialogueInterchange,
  studioDialogueItemsToInterchange,
} from "../lettering/studio-dialogue-interchange";
import {
  formatDialogueTextWithRubyPreview,
  type DialogueRubySpan,
} from "../lettering/studio-dialogue-ruby";

export type StudioExportPageRange = {
  /** Inclusive 0-based index into the page list. */
  fromIndex: number;
  /** Inclusive 0-based index into the page list. */
  toIndex: number;
};

export type StudioExportGeometryInput = {
  /** Authored canvas width in CSS pixels. */
  widthPx: number;
  /** Authored canvas height in CSS pixels (per page or max). */
  heightPx: number;
  /** Target output DPI (72 for screen, 300 for print-class). */
  dpi: number;
  /** Trim (finished) width in millimeters. Optional for webtoon-only packs. */
  trimWidthMm?: number;
  trimHeightMm?: number;
  /** Bleed on each side in millimeters. */
  bleedMm?: number;
};

export type StudioExportPackagePreflightInput = {
  pageCount: number;
  /** When omitted, the full range [0, pageCount-1] is used. */
  pageRange?: StudioExportPageRange | null;
  geometry?: StudioExportGeometryInput | null;
  /** When true, package must include a non-empty dialogue TXT when pages have dialogue. */
  requireDialogueTxt?: boolean;
  pagesForDialogue?: readonly DialoguePageLike[] | null;
  dialogueTitle?: string;
  /**
   * Export scale currently selected in the menu. Supplied together with print geometry
   * (trim W/H), it makes the preflight evaluate the real output resolution, so a package that
   * cannot deliver the requested DPI is blocked instead of merely annotated.
   */
  exportScale?: number;
};

export type StudioExportPackageIssueSeverity = "error" | "warning";

export type StudioExportPackageIssueCode =
  | "PAGE_COUNT_INVALID"
  | "PAGE_RANGE_INVALID"
  | "PAGE_RANGE_EMPTY"
  | "DPI_INVALID"
  | "DIMENSIONS_INVALID"
  | "TRIM_INVALID"
  | "BLEED_INVALID"
  | "BLEED_EXCEEDS_TRIM"
  | "PRINT_DPI_BELOW_TARGET"
  | "PRINT_DPI_UNREACHABLE"
  | "DIALOGUE_TXT_REQUIRED"
  | "DIALOGUE_TXT_EMPTY";

export interface StudioExportPackageIssue {
  code: StudioExportPackageIssueCode;
  severity: StudioExportPackageIssueSeverity;
  message: string;
}

export interface StudioExportDialogueTxtPlan {
  readonly fileName: string;
  readonly mimeType: "text/plain;charset=utf-8";
  readonly text: string;
  readonly cueCount: number;
}

export interface StudioExportPackagePreflightResult {
  readonly canExport: boolean;
  /** Normalized inclusive page indices that will be encoded. */
  readonly pageIndices: readonly number[];
  readonly errors: readonly StudioExportPackageIssue[];
  readonly warnings: readonly StudioExportPackageIssue[];
  readonly issues: readonly StudioExportPackageIssue[];
  readonly dialogueTxt: StudioExportDialogueTxtPlan | null;
  /** Physical output size after bleed when geometry is valid. */
  readonly outputSizeMm: { width: number; height: number } | null;
  /**
   * Print resolution plan for the selected scale — null for screen/webtoon packs or when the
   * geometry did not validate. Single source of truth for what the UI displays and what the
   * exporter records, so the panel never recomputes it and cannot drift.
   */
  readonly printPlan: StudioExportPrintPlan | null;
}

/** Inclusive DPI bounds for print/export geometry editors and validation. */
export const STUDIO_EXPORT_DPI_RANGE = { min: 36, max: 1200 } as const;
/** Inclusive bleed (mm) bounds for print/export geometry editors and validation. */
export const STUDIO_EXPORT_BLEED_MM_RANGE = { min: 0, max: 50 } as const;
/** Inclusive trim (mm) bounds for print/export geometry editors (aligned with MAX_MM). */
export const STUDIO_EXPORT_TRIM_MM_RANGE = { min: 0.1, max: 2_000 } as const;

const MIN_DPI = STUDIO_EXPORT_DPI_RANGE.min;
const MAX_DPI = STUDIO_EXPORT_DPI_RANGE.max;
const MIN_PX = 1;
const MAX_PX = 32_768;
const MAX_MM = STUDIO_EXPORT_TRIM_MM_RANGE.max;
const MAX_BLEED_MM = STUDIO_EXPORT_BLEED_MM_RANGE.max;

/** Millimetres per inch — used for DPI ↔ physical size conversion. */
const MM_PER_INCH = 25.4;

/** Convert millimetres to CSS/device-independent pixels at a target DPI. */
export function mmToPxAtDpi(mm: number, dpi: number): number {
  return (mm / MM_PER_INCH) * dpi;
}

/** Convert pixels to millimetres at a target DPI. */
export function pxToMmAtDpi(px: number, dpi: number): number {
  return (px / dpi) * MM_PER_INCH;
}

export type StudioExportGeometryPresetId = "webtoon72" | "print300-b6" | "print300-a4";

/**
 * Named geometry presets for export preflight editors.
 * `webtoon72` is screen-only (no trim/bleed); print presets include B6/A4 trim + 3 mm bleed.
 */
export function studioExportGeometryPreset(
  id: StudioExportGeometryPresetId
): Pick<StudioExportGeometryInput, "dpi" | "trimWidthMm" | "trimHeightMm" | "bleedMm"> {
  if (id === "print300-b6") {
    return { dpi: 300, trimWidthMm: 148, trimHeightMm: 210, bleedMm: 3 };
  }
  if (id === "print300-a4") {
    return { dpi: 300, trimWidthMm: 210, trimHeightMm: 297, bleedMm: 3 };
  }
  return { dpi: 72 };
}

/**
 * Recommend an integer export scale for the 1–3 button row in the export menu.
 *
 * This is the *button-row* recommendation only: it is clamped to the scales the row can
 * express, so it can silently under-deliver the requested DPI. Anything that reports or
 * records print resolution must use {@link planStudioExportPrintGeometry}, which reports the
 * exact scale, the DPI actually achieved, and whether the target is reachable at all.
 *
 * The 3× ceiling is a UI affordance (`EXPORT_SCALES = [1, 2, 3]`), never a safety limit — the
 * real ceiling is {@link studioExportMaxSafeScale} (11.34× for a 720×1080 page). Clamping print
 * geometry to it is what produced "300 DPI" files that were really 254 DPI.
 *
 * @deprecated No production caller remains; retained only so the regression suite can pin the
 * legacy clamp it replaced. Do not use it to report or record resolution.
 */
export function recommendExportScaleForPrint(input: {
  canvasWidthPx: number;
  canvasHeightPx: number;
  trimWidthMm: number;
  trimHeightMm: number;
  dpi: number;
}): number {
  const { canvasWidthPx, canvasHeightPx, trimWidthMm, trimHeightMm, dpi } = input;
  if (
    !(canvasWidthPx > 0)
    || !(canvasHeightPx > 0)
    || !(trimWidthMm > 0)
    || !(trimHeightMm > 0)
    || !(dpi > 0)
  ) {
    return 1;
  }
  const targetW = mmToPxAtDpi(trimWidthMm, dpi);
  const targetH = mmToPxAtDpi(trimHeightMm, dpi);
  const needed = Math.max(targetW / canvasWidthPx, targetH / canvasHeightPx);
  return Math.min(3, Math.max(1, Math.round(needed)));
}

/**
 * Longest safe canvas side for a single `stage.toCanvas()` export — the conservative
 * cross-browser limit already used by the strip exporter (`studio-export.MAX_CANVAS_DIM`).
 */
export const STUDIO_EXPORT_MAX_CANVAS_DIM = 16_384;
/**
 * Total pixel budget for one exported canvas. Browsers cap canvas *area* as well as side
 * length (desktop Chrome/Safari refuse past ≈268 MPix and return a blank canvas), and every
 * exported pixel costs 4 bytes of RGBA plus the encoder's copy. 100 MPix ≈ 400 MB per buffer
 * is the conservative desktop-print ceiling — roughly A2 at 300 DPI.
 */
export const STUDIO_EXPORT_MAX_CANVAS_PIXELS = 100_000_000;

function floorToHundredth(value: number): number {
  return Math.floor(value * 100) / 100;
}

function ceilToHundredth(value: number): number {
  return Math.ceil(value * 100) / 100;
}

/**
 * Largest export scale that still produces a canvas the browser will actually rasterize.
 * This is the real ceiling on print scale — the 1–3 button row is a UI convenience, not a
 * safety limit, and clamping print geometry to it is what produced silently under-resolution
 * "300 DPI" deliverables.
 */
export function studioExportMaxSafeScale(input: {
  canvasWidthPx: number;
  canvasHeightPx: number;
  maxCanvasDim?: number;
  maxCanvasPixels?: number;
}): number {
  const {
    canvasWidthPx,
    canvasHeightPx,
    maxCanvasDim = STUDIO_EXPORT_MAX_CANVAS_DIM,
    maxCanvasPixels = STUDIO_EXPORT_MAX_CANVAS_PIXELS,
  } = input;
  if (!(canvasWidthPx > 0) || !(canvasHeightPx > 0)) return 1;
  const bySide = maxCanvasDim / Math.max(canvasWidthPx, canvasHeightPx);
  const byArea = Math.sqrt(maxCanvasPixels / (canvasWidthPx * canvasHeightPx));
  return Math.max(0.01, floorToHundredth(Math.min(bySide, byArea)));
}

export interface StudioExportPrintPlanInput {
  /** Authored canvas size in CSS pixels. */
  canvasWidthPx: number;
  canvasHeightPx: number;
  /** Target output DPI the author asked for. */
  dpi: number;
  trimWidthMm: number;
  trimHeightMm: number;
  bleedMm?: number;
  /** Export scale currently selected in the menu. */
  exportScale: number;
  maxCanvasDim?: number;
  maxCanvasPixels?: number;
}

export interface StudioExportPrintPlan {
  readonly targetDpi: number;
  /** Physical deliverable = trim + bleed on every side. */
  readonly outputWidthMm: number;
  readonly outputHeightMm: number;
  /** Pixels the deliverable needs at the target DPI. */
  readonly requiredWidthPx: number;
  readonly requiredHeightPx: number;
  /** Exact (unclamped) scale that would hit the target DPI. */
  readonly neededScale: number;
  readonly maxSafeScale: number;
  /** Scale we can actually recommend: needed, never below 1×, never past the safe ceiling. */
  readonly recommendedScale: number;
  readonly recommendedDpi: number;
  readonly recommendedWidthPx: number;
  readonly recommendedHeightPx: number;
  readonly currentScale: number;
  readonly currentWidthPx: number;
  readonly currentHeightPx: number;
  /** DPI the current export scale really delivers against the output box. */
  readonly currentDpi: number;
  readonly meetsTargetDpi: boolean;
  /** False when even the safe ceiling cannot reach the target — the canvas is too small. */
  readonly reachable: boolean;
  /** Canvas size that would reach the target DPI at `recommendedScale`. */
  readonly requiredCanvasWidthPx: number;
  readonly requiredCanvasHeightPx: number;
  /** How far the printed page overruns the output box (canvas aspect ≠ output aspect). */
  readonly overflowWidthMm: number;
  readonly overflowHeightMm: number;
  readonly issue: StudioExportPackageIssue | null;
}

/**
 * Pixels the export actually produces at a scale.
 *
 * Truncation — not rounding — is what the browser does: the export path ends at
 * `stage.toCanvas({ pixelRatio })`, and Konva assigns the scaled size to `canvas.width` /
 * `canvas.height`, which the HTML spec converts to an unsigned long by discarding the
 * fraction. Measured: a 720×1080 page at 3.55× writes a 2556×**3833** PNG, not 3834
 * (1080 × 3.55 = 3833.999…). Rounding here made the panel quote one more pixel row than the
 * file contains and would inflate the recorded DPI whenever height is the limiting axis.
 */
function dpiForScale(input: {
  canvasWidthPx: number;
  canvasHeightPx: number;
  outputWidthMm: number;
  outputHeightMm: number;
  scale: number;
}): { dpi: number; widthPx: number; heightPx: number } {
  const widthPx = Math.max(1, Math.floor(input.canvasWidthPx * input.scale));
  const heightPx = Math.max(1, Math.floor(input.canvasHeightPx * input.scale));
  const dpi = Math.min(
    widthPx / (input.outputWidthMm / MM_PER_INCH),
    heightPx / (input.outputHeightMm / MM_PER_INCH)
  );
  return { dpi, widthPx, heightPx };
}

/**
 * Plan the print resolution of a raster export.
 *
 * Trim/bleed are **not** baked into the pixels — cropping to the output aspect would cut the
 * author's drawing and letterbox-padding plus upscaling would fabricate resolution that does
 * not exist. Instead the plan answers the only questions that decide whether a file is a
 * usable print deliverable: how many pixels the output box needs, what DPI the current scale
 * really delivers (the limiting axis — the one that still covers the full box), and what has
 * to change when the target is out of reach.
 *
 * Returns null when there is no print geometry to plan for (screen/webtoon packs).
 */
export function planStudioExportPrintGeometry(
  input: StudioExportPrintPlanInput
): StudioExportPrintPlan | null {
  const bleed = input.bleedMm != null && input.bleedMm >= 0 ? input.bleedMm : 0;
  const outputWidthMm = input.trimWidthMm + bleed * 2;
  const outputHeightMm = input.trimHeightMm + bleed * 2;
  if (
    !(input.canvasWidthPx > 0)
    || !(input.canvasHeightPx > 0)
    || !(input.dpi > 0)
    || !(outputWidthMm > 0)
    || !(outputHeightMm > 0)
  ) {
    return null;
  }
  const currentScale = input.exportScale > 0 ? input.exportScale : 1;
  const requiredWidthPx = Math.ceil(mmToPxAtDpi(outputWidthMm, input.dpi));
  const requiredHeightPx = Math.ceil(mmToPxAtDpi(outputHeightMm, input.dpi));
  const neededScale = Math.max(
    requiredWidthPx / input.canvasWidthPx,
    requiredHeightPx / input.canvasHeightPx
  );
  const maxSafeScale = studioExportMaxSafeScale({
    canvasWidthPx: input.canvasWidthPx,
    canvasHeightPx: input.canvasHeightPx,
    ...(input.maxCanvasDim != null ? { maxCanvasDim: input.maxCanvasDim } : {}),
    ...(input.maxCanvasPixels != null ? { maxCanvasPixels: input.maxCanvasPixels } : {}),
  });
  // Never downscale below 1× to "hit" the target — that throws away authored detail. When the
  // canvas is already denser than the target the file simply prints at its own higher DPI.
  const scaleCeiling = Math.max(1, maxSafeScale);
  let recommendedScale = Math.min(scaleCeiling, Math.max(1, ceilToHundredth(neededScale)));
  // `neededScale` is exact, but the exporter truncates the scaled size, so a scale rounded to
  // the hundredth can still land one pixel short of the requirement. Nudge up in hundredths
  // (bounded, and never past the safe ceiling) until the *truncated* pixels really cover it.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const widthPx = Math.floor(input.canvasWidthPx * recommendedScale);
    const heightPx = Math.floor(input.canvasHeightPx * recommendedScale);
    if (widthPx >= requiredWidthPx && heightPx >= requiredHeightPx) break;
    const nudged = Math.min(scaleCeiling, ceilToHundredth(recommendedScale + 0.01));
    if (nudged <= recommendedScale) break;
    recommendedScale = nudged;
  }

  const geometry = {
    canvasWidthPx: input.canvasWidthPx,
    canvasHeightPx: input.canvasHeightPx,
    outputWidthMm,
    outputHeightMm,
  };
  const recommended = dpiForScale({ ...geometry, scale: recommendedScale });
  const current = dpiForScale({ ...geometry, scale: currentScale });

  const reachable = recommended.dpi >= input.dpi - 0.05;
  const meetsTargetDpi = current.dpi >= input.dpi - 0.05;
  const requiredCanvasWidthPx = Math.ceil(requiredWidthPx / recommendedScale);
  const requiredCanvasHeightPx = Math.ceil(requiredHeightPx / recommendedScale);
  const printedWidthMm = pxToMmAtDpi(current.widthPx, current.dpi);
  const printedHeightMm = pxToMmAtDpi(current.heightPx, current.dpi);

  let planIssue: StudioExportPackageIssue | null = null;
  if (!reachable) {
    planIssue = issue(
      "PRINT_DPI_UNREACHABLE",
      "error",
      `현재 캔버스(${input.canvasWidthPx}×${input.canvasHeightPx}px)로는 ${Math.round(input.dpi)}DPI `
        + `${outputWidthMm}×${outputHeightMm}mm 원고를 만들 수 없습니다. `
        + `안전 배율 상한 ${maxSafeScale}×에서 최대 ${Math.round(recommended.dpi)}DPI입니다. `
        + `캔버스를 ${requiredCanvasWidthPx}×${requiredCanvasHeightPx}px 이상으로 키운 뒤 다시 내보내세요. `
        + `지금 저장하면 파일에는 실제 해상도 ${Math.round(current.dpi)}DPI가 기록됩니다.`
    );
  } else if (!meetsTargetDpi) {
    planIssue = issue(
      "PRINT_DPI_BELOW_TARGET",
      "error",
      `현재 배율 ${currentScale}×는 ${current.widthPx}×${current.heightPx}px = 실제 `
        + `${Math.round(current.dpi)}DPI라 목표 ${Math.round(input.dpi)}DPI에 못 미칩니다. `
        + `"배율 권장"으로 ${recommendedScale}×(${recommended.widthPx}×${recommended.heightPx}px, `
        + `${Math.round(recommended.dpi)}DPI)를 적용하세요.`
    );
  }

  return {
    targetDpi: input.dpi,
    outputWidthMm,
    outputHeightMm,
    requiredWidthPx,
    requiredHeightPx,
    neededScale,
    maxSafeScale,
    recommendedScale,
    recommendedDpi: recommended.dpi,
    recommendedWidthPx: recommended.widthPx,
    recommendedHeightPx: recommended.heightPx,
    currentScale,
    currentWidthPx: current.widthPx,
    currentHeightPx: current.heightPx,
    currentDpi: current.dpi,
    meetsTargetDpi,
    reachable,
    requiredCanvasWidthPx,
    requiredCanvasHeightPx,
    overflowWidthMm: Math.max(0, printedWidthMm - outputWidthMm),
    overflowHeightMm: Math.max(0, printedHeightMm - outputHeightMm),
    issue: planIssue,
  };
}

function issue(
  code: StudioExportPackageIssueCode,
  severity: StudioExportPackageIssueSeverity,
  message: string
): StudioExportPackageIssue {
  return { code, severity, message };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Resolve and validate an inclusive page range against a page list length. */
export function resolveStudioExportPageRange(
  pageCount: number,
  range?: StudioExportPageRange | null
): { ok: true; indices: number[] } | { ok: false; issues: StudioExportPackageIssue[] } {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    return {
      ok: false,
      issues: [
        issue(
          "PAGE_COUNT_INVALID",
          "error",
          "내보낼 페이지가 없습니다. 페이지를 하나 이상 만든 뒤 다시 시도해 주세요."
        ),
      ],
    };
  }
  const from = range == null ? 0 : range.fromIndex;
  const to = range == null ? pageCount - 1 : range.toIndex;
  if (
    !Number.isSafeInteger(from)
    || !Number.isSafeInteger(to)
    || from < 0
    || to < 0
    || from >= pageCount
    || to >= pageCount
    || from > to
  ) {
    return {
      ok: false,
      issues: [
        issue(
          "PAGE_RANGE_INVALID",
          "error",
          `페이지 범위가 올바르지 않습니다. 1~${pageCount} 사이의 시작·끝 번호를 지정해 주세요.`
        ),
      ],
    };
  }
  const indices: number[] = [];
  for (let index = from; index <= to; index += 1) indices.push(index);
  if (indices.length === 0) {
    return {
      ok: false,
      issues: [
        issue("PAGE_RANGE_EMPTY", "error", "선택한 페이지 범위에 내보낼 페이지가 없습니다."),
      ],
    };
  }
  return { ok: true, indices };
}

/**
 * Validate print/export geometry. Screen webtoon packs may omit trim/bleed; when provided they
 * must be finite, positive, and bleed must not dominate the trim box.
 */
export function validateStudioExportGeometry(
  geometry: StudioExportGeometryInput
): {
  issues: StudioExportPackageIssue[];
  outputSizeMm: { width: number; height: number } | null;
} {
  const issues: StudioExportPackageIssue[] = [];
  const widthPx = finiteNumber(geometry.widthPx);
  const heightPx = finiteNumber(geometry.heightPx);
  const dpi = finiteNumber(geometry.dpi);

  if (
    widthPx == null
    || heightPx == null
    || widthPx < MIN_PX
    || heightPx < MIN_PX
    || widthPx > MAX_PX
    || heightPx > MAX_PX
    || !Number.isSafeInteger(widthPx)
    || !Number.isSafeInteger(heightPx)
  ) {
    issues.push(
      issue(
        "DIMENSIONS_INVALID",
        "error",
        `페이지 크기가 안전 범위(${MIN_PX}~${MAX_PX}px)를 벗어났습니다.`
      )
    );
  }

  if (dpi == null || dpi < MIN_DPI || dpi > MAX_DPI) {
    issues.push(
      issue(
        "DPI_INVALID",
        "error",
        `해상도(DPI)는 ${MIN_DPI}~${MAX_DPI} 사이여야 합니다. 웹툰은 72, 인쇄 원고는 300을 권장합니다.`
      )
    );
  } else if (dpi < 72) {
    issues.push(
      issue(
        "DPI_INVALID",
        "warning",
        "DPI가 72 미만입니다. 화면용 미리보기에는 쓸 수 있지만 게시·인쇄 품질이 낮을 수 있습니다."
      )
    );
  }

  const trimW = geometry.trimWidthMm == null ? null : finiteNumber(geometry.trimWidthMm);
  const trimH = geometry.trimHeightMm == null ? null : finiteNumber(geometry.trimHeightMm);
  const bleed = geometry.bleedMm == null ? 0 : finiteNumber(geometry.bleedMm);

  if (geometry.trimWidthMm != null || geometry.trimHeightMm != null) {
    if (
      trimW == null
      || trimH == null
      || trimW <= 0
      || trimH <= 0
      || trimW > MAX_MM
      || trimH > MAX_MM
    ) {
      issues.push(
        issue(
          "TRIM_INVALID",
          "error",
          `재단(트림) 크기가 올바르지 않습니다. 0보다 크고 ${MAX_MM}mm 이하여야 합니다.`
        )
      );
    }
  }

  if (geometry.bleedMm != null) {
    if (bleed == null || bleed < 0 || bleed > MAX_BLEED_MM) {
      issues.push(
        issue(
          "BLEED_INVALID",
          "error",
          `도련(블리드)은 0~${MAX_BLEED_MM}mm 사이여야 합니다.`
        )
      );
    }
  }

  let outputSizeMm: { width: number; height: number } | null = null;
  if (
    trimW != null
    && trimH != null
    && trimW > 0
    && trimH > 0
    && bleed != null
    && bleed >= 0
  ) {
    if (bleed * 2 >= trimW || bleed * 2 >= trimH) {
      issues.push(
        issue(
          "BLEED_EXCEEDS_TRIM",
          "error",
          "도련이 재단 크기보다 크거나 같아 유효 인쇄 영역이 없습니다. 도련을 줄이거나 트림을 키워 주세요."
        )
      );
    } else {
      outputSizeMm = {
        width: trimW + bleed * 2,
        height: trimH + bleed * 2,
      };
    }
  }

  return { issues, outputSizeMm };
}

/** 1-based inclusive range label for status / button chrome (Korean UX). */
export function formatExportPageRangeLabel(fromPage: number, toPage: number): string {
  if (fromPage === toPage) return `페이지 ${fromPage}`;
  return `페이지 ${fromPage}–${toPage}`;
}

/**
 * Decide how multi-page archive/PDF/preset capture should honor package pageIndices.
 * Prefers parent `capturePagesForIndices` when provided; otherwise capture-all, and slice
 * when the selected range is a proper subset (panel-only residual without StudioPage glue).
 */
export function planMultiPageExportCapture(input: {
  pageIndices: readonly number[];
  pageCount: number;
  hasIndicesCapture: boolean;
}): {
  mode: "indices" | "all" | "all-then-slice";
  indices: number[];
} {
  const pageCount = Math.max(0, Math.floor(input.pageCount));
  // Empty package pageIndices means preflight rejected the range — do not invent full-doc indices.
  if (input.pageIndices.length === 0) {
    return { mode: "all", indices: [] };
  }
  const indices = [...input.pageIndices];

  if (input.hasIndicesCapture) {
    return { mode: "indices", indices };
  }

  const isFullRange =
    indices.length === pageCount && indices.every((value, index) => value === index);

  if (isFullRange) {
    return { mode: "all", indices };
  }

  return { mode: "all-then-slice", indices };
}

type DialogueElementWithRuby = DialogueElementLike & {
  rubySpans?: readonly DialogueRubySpan[];
};

/** pageId + element id → source element for ruby lookup (export-only, pure). */
function dialogueElementLookup(
  pages: readonly DialoguePageLike[]
): Map<string, DialogueElementWithRuby> {
  const map = new Map<string, DialogueElementWithRuby>();
  for (const page of pages) {
    for (const element of page.elements) {
      map.set(`${page.id}\0${element.id}`, element as DialogueElementWithRuby);
    }
  }
  return map;
}

/**
 * Prefer 漢字(かんじ) plain-text ruby preview on cue text when the source element
 * carries `rubySpans`. Items without spans keep raw text.
 */
function enrichDialogueItemsWithRubyPreview(
  items: readonly DialogueBatchItem[],
  pages: readonly DialoguePageLike[]
): DialogueBatchItem[] {
  const byKey = dialogueElementLookup(pages);
  return items.map((item) => {
    const element = byKey.get(`${item.pageId}\0${item.id}`);
    const rubySpans = element?.rubySpans;
    if (!rubySpans?.length) return item;
    const text = formatDialogueTextWithRubyPreview(item.text, rubySpans);
    return text === item.text ? item : { ...item, text };
  });
}

/** Build a plain-text dialogue export from story pages (TXT interchange). */
export function planStudioExportDialogueTxt(input: {
  pages: readonly DialoguePageLike[];
  title?: string;
  pageIndices?: readonly number[];
}): StudioExportDialogueTxtPlan | null {
  const pages =
    input.pageIndices && input.pageIndices.length > 0
      ? input.pageIndices
          .map((index) => input.pages[index])
          .filter((page): page is DialoguePageLike => page != null)
      : [...input.pages];
  if (pages.length === 0) return null;
  const items = collectDialogueItems(pages);
  if (items.length === 0) return null;
  const enriched = enrichDialogueItemsWithRubyPreview(items, pages);
  const document = studioDialogueItemsToInterchange(enriched, {
    title: input.title?.trim() || "toonspectrum-dialogue",
  });
  const serialized = serializeStudioDialogueInterchange("txt", document);
  return {
    fileName: `${(input.title?.trim() || "toonspectrum-dialogue").slice(0, 80)}.txt`,
    mimeType: "text/plain;charset=utf-8",
    text: serialized.text,
    cueCount: document.cues.length,
  };
}

/** Full package preflight used before export/download commits. */
export function preflightStudioExportPackage(
  input: StudioExportPackagePreflightInput
): StudioExportPackagePreflightResult {
  const issues: StudioExportPackageIssue[] = [];
  const range = resolveStudioExportPageRange(input.pageCount, input.pageRange);
  let pageIndices: number[] = [];
  if (!range.ok) {
    issues.push(...range.issues);
  } else {
    pageIndices = range.indices;
  }

  let outputSizeMm: { width: number; height: number } | null = null;
  let printPlan: StudioExportPrintPlan | null = null;
  if (input.geometry) {
    const geometry = validateStudioExportGeometry(input.geometry);
    issues.push(...geometry.issues);
    outputSizeMm = geometry.outputSizeMm;

    // Only plan print resolution once the geometry itself is sound — planning on top of an
    // invalid trim/DPI would stack a second, confusing message on the same root cause.
    const geometrySound = geometry.issues.every((entry) => entry.severity !== "error");
    const { trimWidthMm, trimHeightMm } = input.geometry;
    if (geometrySound && trimWidthMm != null && trimHeightMm != null) {
      printPlan = planStudioExportPrintGeometry({
        canvasWidthPx: input.geometry.widthPx,
        canvasHeightPx: input.geometry.heightPx,
        dpi: input.geometry.dpi,
        trimWidthMm,
        trimHeightMm,
        ...(input.geometry.bleedMm != null ? { bleedMm: input.geometry.bleedMm } : {}),
        exportScale: input.exportScale != null && input.exportScale > 0 ? input.exportScale : 1,
      });
      // An error-severity resolution issue has to block. Showing a red "300DPI를 만들 수
      // 없습니다" next to a green "통과" chip is the same dishonesty in a different place.
      if (printPlan?.issue) issues.push(printPlan.issue);
    }
  }

  let dialogueTxt: StudioExportDialogueTxtPlan | null = null;
  if (input.pagesForDialogue) {
    dialogueTxt = planStudioExportDialogueTxt({
      pages: input.pagesForDialogue,
      title: input.dialogueTitle,
      pageIndices: pageIndices.length > 0 ? pageIndices : undefined,
    });
  }

  if (input.requireDialogueTxt) {
    if (!input.pagesForDialogue) {
      issues.push(
        issue(
          "DIALOGUE_TXT_REQUIRED",
          "error",
          "대사 TXT를 포함하도록 선택했지만 페이지 문서가 없어 내보낼 수 없습니다."
        )
      );
    } else if (!dialogueTxt || dialogueTxt.cueCount === 0) {
      issues.push(
        issue(
          "DIALOGUE_TXT_EMPTY",
          "error",
          "선택한 페이지 범위에 내보낼 대사가 없습니다. 말풍선·텍스트를 추가하거나 대사 TXT 옵션을 끄세요."
        )
      );
    }
  }

  const errors = issues.filter((entry) => entry.severity === "error");
  const warnings = issues.filter((entry) => entry.severity === "warning");
  return {
    canExport: errors.length === 0 && pageIndices.length > 0,
    pageIndices,
    errors,
    warnings,
    issues,
    dialogueTxt: errors.some((entry) => entry.code.startsWith("DIALOGUE_"))
      ? null
      : dialogueTxt,
    outputSizeMm,
    printPlan,
  };
}
