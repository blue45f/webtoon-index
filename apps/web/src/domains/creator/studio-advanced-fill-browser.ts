/** Browser orchestration for the pure Advanced Fill engine. */
import {
  currentStudioAdvancedFillBrowserMaxPixels,
  formatStudioAdvancedFillRasterSizeError,
  validateStudioAdvancedFillRasterDimensions,
} from "./studio-advanced-fill-raster-safety";
import { runStudioAdvancedFillWorker } from "./studio-advanced-fill-worker-client";
import { hexToRgb } from "./studio-filters";
import { loadFloodFillSourceImage } from "./studio-flood-fill";

import type {
  AdvancedFillDiagnostics,
  AdvancedFillImageDataLike,
  AdvancedFillMaskLike,
  AdvancedFillRgba,
} from "./studio-advanced-fill";
import type { StudioAdvancedFillSettings } from "./studio-advanced-fill-settings";

export { softenStudioAdvancedFillEdges } from "./studio-advanced-fill";

export type StudioAdvancedFillBlockedReason = "area" | "canvas-edge" | null;

export interface StudioAdvancedFillBrowserRequest {
  targetSrc: string;
  referenceSrc?: string;
  /** Immutable alpha silhouette. Equal to targetSrc on the first fill and separate on previews. */
  alphaLockSrc?: string;
  /**
   * Explicit full-page paint operation for a newly synthesized blank color layer.
   *
   * This is deliberately separate from the user's leak-guard preference: normal raster and
   * line-art fills must still fail closed when they unexpectedly escape to most of the canvas.
   */
  intentionalWholeCanvasFill?: boolean;
  xRatio: number;
  yRatio: number;
  fillColor: string;
  settings: StudioAdvancedFillSettings;
  selectionMask?: AdvancedFillMaskLike;
  createSelectionMask?: (width: number, height: number) => AdvancedFillMaskLike | undefined;
  abort?: AbortSignal;
}

export interface StudioAdvancedFillBrowserResult {
  dataUrl: string;
  changed: boolean;
  blockedReason: StudioAdvancedFillBlockedReason;
  diagnostics: AdvancedFillDiagnostics;
}

export interface StudioAdvancedFillPreviewSummary {
  message: string;
  paintedPixelCount: number;
  regionCount: number;
}

export interface StudioAdvancedFillGuardPlan {
  maxAreaRatio: number;
  blockCanvasEdge: boolean;
}

export function planStudioAdvancedFillGuard(
  settings: Pick<
    StudioAdvancedFillSettings,
    "leakGuard" | "leakGuardMaxFillRatio" | "treatCanvasEdgeAsBoundary"
  >,
  intentionalWholeCanvasFill = false,
): StudioAdvancedFillGuardPlan {
  if (intentionalWholeCanvasFill) {
    return {
      maxAreaRatio: 1,
      blockCanvasEdge: false,
    };
  }
  return {
    maxAreaRatio: settings.leakGuard ? settings.leakGuardMaxFillRatio : 1,
    blockCanvasEdge: settings.leakGuard && !settings.treatCanvasEdgeAsBoundary,
  };
}

export function countChangedStudioAdvancedFillPixels(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): number {
  if (before.length !== after.length || before.length % 4 !== 0) {
    throw new RangeError("Advanced Fill comparison buffers must be equal RGBA arrays.");
  }
  let changedPixelCount = 0;
  for (let offset = 0; offset < before.length; offset += 4) {
    if (
      before[offset] !== after[offset] ||
      before[offset + 1] !== after[offset + 1] ||
      before[offset + 2] !== after[offset + 2] ||
      before[offset + 3] !== after[offset + 3]
    ) {
      changedPixelCount += 1;
    }
  }
  return changedPixelCount;
}

interface LoadedPixels extends AdvancedFillImageDataLike {
  release(): void;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  let safeDimensions: { width: number; height: number };
  try {
    safeDimensions = validateStudioAdvancedFillRasterDimensions(
      width,
      height,
      currentStudioAdvancedFillBrowserMaxPixels(),
    );
  } catch (error) {
    throw new RangeError(formatStudioAdvancedFillRasterSizeError(error), { cause: error });
  }
  if (typeof document === "undefined") throw new Error("이 브라우저에서는 채우기 캔버스를 만들 수 없습니다.");
  const canvas = document.createElement("canvas");
  canvas.width = safeDimensions.width;
  canvas.height = safeDimensions.height;
  return canvas;
}

async function loadPixels(
  src: string,
  outputSize?: { width: number; height: number },
  abort?: AbortSignal,
): Promise<LoadedPixels> {
  if (abort?.aborted) throw advancedFillAbortError();
  const image = await loadFloodFillSourceImage(src, abort);
  if (abort?.aborted) throw advancedFillAbortError();
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) throw new Error("채우기 이미지 크기를 확인할 수 없습니다.");
  const width = outputSize?.width ?? naturalWidth;
  const height = outputSize?.height ?? naturalHeight;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    canvas.width = 0;
    canvas.height = 0;
    throw new Error("채우기 픽셀을 읽을 수 없습니다.");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  let pixels: ImageData;
  try {
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    if (abort?.aborted) throw advancedFillAbortError();
    pixels = context.getImageData(0, 0, width, height);
    if (abort?.aborted) throw advancedFillAbortError();
  } finally {
    // ImageData owns an independent buffer. Release the large Canvas backing store immediately
    // instead of retaining a second RGBA allocation for the entire Worker run.
    canvas.width = 0;
    canvas.height = 0;
  }
  let released = false;
  return {
    data: pixels.data,
    width,
    height,
    release() {
      if (released) return;
      released = true;
    },
  };
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundedSeed(ratio: number, length: number): number {
  return Math.min(length - 1, Math.max(0, Math.round(clampRatio(ratio) * (length - 1))));
}

function advancedFillAbortError(): DOMException {
  return new DOMException("채우기를 취소했습니다.", "AbortError");
}

function readBlobAsDataUrl(blob: Blob, abort?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const onAbort = () => {
      reader.abort();
      reject(advancedFillAbortError());
    };
    abort?.addEventListener("abort", onAbort, { once: true });
    reader.onerror = () => {
      abort?.removeEventListener("abort", onAbort);
      reject(reader.error ?? new Error("채우기 PNG를 읽을 수 없습니다."));
    };
    reader.onload = () => {
      abort?.removeEventListener("abort", onAbort);
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("채우기 PNG를 data URL로 만들 수 없습니다."));
    };
    reader.readAsDataURL(blob);
  });
}

export async function encodeStudioAdvancedFillPixels(
  imageData: AdvancedFillImageDataLike,
  abort?: AbortSignal,
): Promise<string> {
  const canvas = createCanvas(imageData.width, imageData.height);
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.width = 0;
    canvas.height = 0;
    throw new Error("채우기 결과를 만들 수 없습니다.");
  }
  try {
    const output = context.createImageData(imageData.width, imageData.height);
    output.data.set(imageData.data);
    context.putImageData(output, 0, 0);
    if (abort?.aborted) throw advancedFillAbortError();
    if (typeof canvas.toBlob !== "function") return canvas.toDataURL("image/png");
    const blob = await new Promise<Blob>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        reject(advancedFillAbortError());
      };
      abort?.addEventListener("abort", onAbort, { once: true });
      canvas.toBlob((value) => {
        abort?.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        if (value) resolve(value);
        else reject(new Error("채우기 PNG를 인코딩할 수 없습니다."));
      }, "image/png");
    });
    if (abort?.aborted) throw advancedFillAbortError();
    return readBlobAsDataUrl(blob, abort);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function runStudioAdvancedFillInBrowser(
  request: StudioAdvancedFillBrowserRequest,
): Promise<StudioAdvancedFillBrowserResult> {
  const target = await loadPixels(request.targetSrc, undefined, request.abort);
  let reference: LoadedPixels | null = null;
  let alphaLockSource: LoadedPixels | null = null;
  try {
    if (request.referenceSrc) {
      reference = await loadPixels(
        request.referenceSrc,
        { width: target.width, height: target.height },
        request.abort,
      );
    }
    if (request.alphaLockSrc && request.alphaLockSrc !== request.targetSrc) {
      alphaLockSource = await loadPixels(
        request.alphaLockSrc,
        { width: target.width, height: target.height },
        request.abort,
      );
    }
    const { r, g, b } = hexToRgb(request.fillColor);
    const fill: AdvancedFillRgba = [r, g, b, 255];
    const selectionMask =
      request.selectionMask ?? request.createSelectionMask?.(target.width, target.height);
    const guard = planStudioAdvancedFillGuard(
      request.settings,
      request.intentionalWholeCanvasFill,
    );
    const execution = await runStudioAdvancedFillWorker(
      {
        target,
        referenceImage: reference ?? undefined,
        referenceMask: selectionMask,
        seeds: [
          {
            x: roundedSeed(request.xRatio, target.width),
            y: roundedSeed(request.yRatio, target.height),
          },
        ],
        fill,
        options: {
          tolerance: request.settings.tolerance,
          matchAlpha: true,
          contiguous: request.settings.contiguous,
          connectivity: 4,
          closeGapRadius: request.settings.closeGapPx,
          areaAdjustment: request.settings.expansionPx,
          maxAreaRatio: guard.maxAreaRatio,
        },
        softenEdges: request.settings.antiAlias,
        enforceAlphaLock: request.alphaLockSrc !== undefined,
        alphaLockSource: alphaLockSource ?? undefined,
      },
      { executionMode: "worker", signal: request.abort },
    );
    const result = execution.result;

    const blockedReason: StudioAdvancedFillBlockedReason =
      result.diagnostics.status === "leak-guarded"
        ? "area"
        : guard.blockCanvasEdge &&
            result.diagnostics.final.touchesCanvasEdge
          ? "canvas-edge"
          : null;
    if (blockedReason || result.diagnostics.status !== "applied") {
      return {
        dataUrl: request.targetSrc,
        changed: false,
        blockedReason,
        diagnostics: result.diagnostics,
      };
    }

    return {
      dataUrl: await encodeStudioAdvancedFillPixels(result.imageData, request.abort),
      changed: true,
      blockedReason: null,
      diagnostics: result.diagnostics,
    };
  } finally {
    alphaLockSource?.release();
    reference?.release();
    target.release();
  }
}

export function studioAdvancedFillResultMessage(result: StudioAdvancedFillBrowserResult): string {
  if (result.blockedReason === "area") {
    const ratio = Math.round(result.diagnostics.matched.areaRatio * 100);
    return `누수 보호가 ${ratio}%를 넘는 영역의 채우기를 막았습니다. 틈 닫기를 늘리거나 허용 오차를 낮춰 보세요.`;
  }
  if (result.blockedReason === "canvas-edge") {
    return "채우기 영역이 캔버스 가장자리에 닿아 누수 보호가 막았습니다.";
  }
  if (result.diagnostics.status === "empty") return "이 지점에서 채울 수 있는 영역을 찾지 못했습니다.";
  if (result.diagnostics.status === "aborted") return "채우기를 취소했습니다.";
  if (result.diagnostics.status === "noop") return "이미 같은 색으로 채워진 영역입니다.";
  const ratio = Math.max(0.1, result.diagnostics.final.areaRatio * 100).toFixed(1);
  return `채우기 완료 · ${ratio}% · ${result.diagnostics.paintedPixelCount.toLocaleString()}px`;
}

/**
 * Continuous fill runs against the previous preview image, so each successful run's painted
 * pixels are newly changed pixels. Summing them gives an exact, non-overlapping preview total
 * without retaining a full-size mask in React state.
 */
export function summarizeStudioAdvancedFillPreview(
  currentMessage: string,
  current: Pick<AdvancedFillDiagnostics, "width" | "height" | "paintedPixelCount">,
  previous?: Pick<StudioAdvancedFillPreviewSummary, "paintedPixelCount" | "regionCount"> | null,
): StudioAdvancedFillPreviewSummary {
  const totalPixelCount = Math.max(0, Math.trunc(current.width) * Math.trunc(current.height));
  const currentPixelCount = Math.max(0, Math.trunc(current.paintedPixelCount));
  const paintedPixelCount = Math.min(
    totalPixelCount,
    Math.max(0, Math.trunc(previous?.paintedPixelCount ?? 0)) + currentPixelCount,
  );
  const regionCount = Math.max(0, Math.trunc(previous?.regionCount ?? 0)) + 1;
  if (!previous || regionCount === 1) return { message: currentMessage, paintedPixelCount, regionCount };
  const ratio = totalPixelCount > 0 ? Math.max(0.1, (paintedPixelCount / totalPixelCount) * 100).toFixed(1) : "0.0";
  return {
    message: `누적 미리보기 · ${regionCount}개 영역 · ${ratio}% · ${paintedPixelCount.toLocaleString("ko-KR")}px`,
    paintedPixelCount,
    regionCount,
  };
}
