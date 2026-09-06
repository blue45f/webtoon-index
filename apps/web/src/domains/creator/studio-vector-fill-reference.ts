/**
 * Browser-only vector reference rasterization for Advanced Fill.
 *
 * The fill target is a transparent, page-sized virtual raster layer. Its boundary reference is
 * produced from document DrawEl items only through the same deterministic SVG serializer used by
 * Studio SVG export, so pressure, brush dynamics, symmetry, smart-shape geometry and material
 * dabs do not acquire a second rendering implementation here.
 *
 * UI overlays, comments, drawing-assist guides and the page background are not part of `El[]` or
 * are non-draw elements, and are therefore excluded. Hidden elements and hidden layer groups are
 * excluded before serialization. The output is transient and guarded by source/SVG/PNG byte caps
 * plus the Advanced Fill canvas pixel cap.
 */
import { loadStudioSvgExportWorkerClientModule } from "./export/studio-document-export-loaders";
import {
  currentStudioAdvancedFillBrowserMaxPixels,
  formatStudioAdvancedFillRasterSizeError,
  STUDIO_ADVANCED_FILL_BROWSER_MAX_PIXELS,
  validateStudioAdvancedFillRasterDimensions,
} from "./studio-advanced-fill-raster-safety";
import { isEffectivelyHidden, type LayerGroup } from "./studio-layers";
import {
  createStudioOffscreenRasterSession,
  type StudioOffscreenRasterSession,
} from "./studio-offscreen-raster-worker-client";
import {
  adoptStudioOffscreenBitmap,
  isStudioOffscreenRasterEncodedBlobExact,
} from "./studio-offscreen-raster-worker-protocol";
import { readStudioVectorReferenceSourceBudgetReceipt } from "./studio-vector-reference-source-budget-receipt";

import type {
  SvgExportEl,
  SvgExportPageInput,
  SvgExportResult,
  SvgExportTheme,
} from "./export/studio-svg-export";
import type { StudioSvgExportWorkerFactory } from "./export/studio-svg-export-worker-client";
import type { El } from "./studio-element-model";
import type { SelectionFrame } from "./studio-selection-tools";
import type { StudioVectorReferenceSourceBudgetReceipt } from "./studio-vector-reference-source-budget-receipt";

export const STUDIO_VECTOR_REFERENCE_MAX_SOURCE_BYTES = 16 * 1024 * 1024;
export const STUDIO_VECTOR_REFERENCE_MAX_SVG_BYTES = 16 * 1024 * 1024;
export const STUDIO_VECTOR_REFERENCE_MAX_PNG_BYTES = 32 * 1024 * 1024;

const UTF8_ENCODER = new TextEncoder();
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const SVG_EXPORT_MIME = "image/svg+xml";

export interface StudioVectorReferenceBudgets {
  readonly maxPixelCount?: number;
  readonly maxSourceBytes?: number;
  readonly maxSvgBytes?: number;
  readonly maxPngBytes?: number;
}

export interface StudioVectorReferenceInput {
  readonly width: number;
  readonly height: number;
  readonly elements: readonly SvgExportEl[];
  readonly groups?: readonly LayerGroup[];
  readonly theme?: SvgExportTheme;
  /** Generic merged-copy callers may include the authored page background. Fill leaves this true. */
  readonly transparentBg?: boolean;
  readonly bg?: string;
  readonly bgGrad?: readonly string[] | null;
  readonly fingerprintNamespace?: string;
  readonly budgets?: StudioVectorReferenceBudgets;
  /** Internal fast-path proof; invalid identity or budget automatically falls back to validation. */
  readonly sourceBudgetReceipt?: StudioVectorReferenceSourceBudgetReceipt;
}

export interface StudioVectorReferenceRasterRequest {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly maxOutputBytes: number;
  readonly signal?: AbortSignal;
}

export interface StudioVectorReferenceRasterResult {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
}

export type StudioVectorReferenceRasterizer = (
  request: StudioVectorReferenceRasterRequest,
) => Promise<StudioVectorReferenceRasterResult>;

export type StudioVectorReferenceRasterExecutionBackend =
  | "offscreen-worker"
  | "browser-direct"
  | "custom";

type StudioVectorReferenceRasterSelection =
  | {
      /** Product default: one exact OffscreenCanvas Worker provider, with fail-closed errors. */
      readonly rasterExecutionBackend?: "offscreen-worker";
      readonly rasterize?: never;
    }
  | {
      /** Explicit main-thread reference/browser provider selected before the operation starts. */
      readonly rasterExecutionBackend: "browser-direct";
      readonly rasterize?: never;
    }
  | {
      /** Explicit test/platform provider; it is never reached after another backend fails. */
      readonly rasterExecutionBackend: "custom";
      readonly rasterize: StudioVectorReferenceRasterizer;
    };

interface StudioVectorReferenceCommonRenderOptions {
  readonly signal?: AbortSignal;
  /** `null` preselects direct serialization; omitted selects the product module Worker. */
  readonly workerFactory?: StudioSvgExportWorkerFactory | null;
}

export type StudioVectorReferenceRenderOptions =
  StudioVectorReferenceCommonRenderOptions & StudioVectorReferenceRasterSelection;

export type StudioVectorReferencePreparedRenderOptions =
  Pick<StudioVectorReferenceCommonRenderOptions, "signal"> & StudioVectorReferenceRasterSelection;

/**
 * Validated input plus the single authoritative SVG export produced for a vector reference.
 *
 * Keeping this intermediate explicit lets workflows that need to inspect `skipped` fidelity
 * metadata (editable-raster preparation, for example) reuse the exact same Worker result for
 * rasterization. The object deliberately owns the normalized output budgets and namespace so a
 * caller cannot accidentally render the export under a different set of limits.
 */
export interface StudioVectorReferencePreparedExport {
  readonly result: SvgExportResult;
  readonly execution: "worker" | "direct";
  readonly width: number;
  readonly height: number;
  readonly fingerprintNamespace: string;
  readonly maxSvgBytes: number;
  readonly maxPngBytes: number;
}

export interface StudioVectorReferenceOffscreenOptions {
  /**
   * Test/platform seam for the blob decoder. Production tries this first and, when the browser
   * cannot decode an SVG blob, falls back to the `<img>` decoder — see
   * {@link decodeStudioVectorReferenceSvgBitmap}.
   */
  readonly createBitmap?: (source: Blob) => Promise<ImageBitmap>;
  /** Test/platform seam; injected sessions stay one-shot, while production uses a short shared lease. */
  readonly createSession?: () => StudioOffscreenRasterSession;
}

/**
 * Which decoder actually reads an SVG in this realm. Cleared by
 * {@link disposeStudioVectorReferenceRasterizer} so the verdict never outlives the rasterizer.
 */
type StudioVectorReferenceSvgBitmapDecoder = "blob" | "image-element";
let studioVectorReferenceSvgBitmapDecoder: StudioVectorReferenceSvgBitmapDecoder | null = null;

/**
 * Decodes the serialized page SVG into a transferable bitmap.
 *
 * Chromium has never shipped SVG support for `createImageBitmap(Blob)` — the call rejects with
 * `InvalidStateError: The source image could not be decoded` — and WebKit behaves the same way. A
 * blob-only decoder therefore made this provider unusable in the browsers artists actually run,
 * and because the filter menu selects this provider for every page-composite and layer-scoped
 * filter, the whole filter path failed before its dialog could open. The `<img>` decoder does read
 * SVG, and `createImageBitmap(HTMLImageElement)` still yields a transferable bitmap, so the page
 * draw and PNG encode stay on the Worker exactly as the selected backend promises. The blob route
 * is attempted first and its verdict memoized, so a realm that can decode blobs never pays for the
 * element hop and a realm that cannot only pays once.
 */
async function decodeStudioVectorReferenceSvgBitmap(
  blob: Blob,
  createBitmap: (source: Blob) => Promise<ImageBitmap>,
  signal: AbortSignal | undefined,
): Promise<ImageBitmap> {
  if (studioVectorReferenceSvgBitmapDecoder !== "image-element") {
    try {
      const bitmap = await createBitmap(blob);
      studioVectorReferenceSvgBitmapDecoder = "blob";
      return bitmap;
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      if (typeof globalThis.createImageBitmap !== "function") throw error;
      studioVectorReferenceSvgBitmapDecoder = "image-element";
    }
  }
  const image = await loadSvgBlobImage(blob, signal);
  throwIfAborted(signal);
  return globalThis.createImageBitmap(image);
}

const STUDIO_VECTOR_REFERENCE_RASTER_IDLE_MS = 45_000;
let sharedStudioVectorReferenceRasterSession: StudioOffscreenRasterSession | null = null;
let sharedStudioVectorReferenceRasterIdleTimer: ReturnType<typeof setTimeout> | null = null;
let sharedStudioVectorReferenceRasterActiveRuns = 0;
let sharedStudioVectorReferenceRasterRunId = 0;

function clearStudioVectorReferenceRasterIdleTimer(): void {
  if (sharedStudioVectorReferenceRasterIdleTimer === null) return;
  clearTimeout(sharedStudioVectorReferenceRasterIdleTimer);
  sharedStudioVectorReferenceRasterIdleTimer = null;
}

function scheduleStudioVectorReferenceRasterIdleDisposal(): void {
  clearStudioVectorReferenceRasterIdleTimer();
  if (!sharedStudioVectorReferenceRasterSession) return;
  sharedStudioVectorReferenceRasterIdleTimer = setTimeout(() => {
    sharedStudioVectorReferenceRasterIdleTimer = null;
    if (sharedStudioVectorReferenceRasterActiveRuns > 0) {
      scheduleStudioVectorReferenceRasterIdleDisposal();
      return;
    }
    const session = sharedStudioVectorReferenceRasterSession;
    sharedStudioVectorReferenceRasterSession = null;
    session?.dispose();
  }, STUDIO_VECTOR_REFERENCE_RASTER_IDLE_MS);
}

/** Releases the leased production raster Worker on route/HMR teardown and in deterministic tests. */
export function disposeStudioVectorReferenceRasterizer(): void {
  clearStudioVectorReferenceRasterIdleTimer();
  const session = sharedStudioVectorReferenceRasterSession;
  sharedStudioVectorReferenceRasterSession = null;
  sharedStudioVectorReferenceRasterActiveRuns = 0;
  studioVectorReferenceSvgBitmapDecoder = null;
  session?.dispose();
}

/**
 * Starts only the OffscreenCanvas Worker handshake. No SVG, bitmap, pixel buffer, or document
 * metadata crosses the boundary until a real raster request acquires this short idle lease.
 */
export function preloadStudioVectorReferenceRasterizer(
  createSession: () => StudioOffscreenRasterSession = () => createStudioOffscreenRasterSession({
    policy: "queue-all",
    maxQueued: 8,
  }),
): boolean {
  if (typeof Worker !== "function") return false;
  if (!sharedStudioVectorReferenceRasterSession) {
    try {
      sharedStudioVectorReferenceRasterSession = createSession();
    } catch {
      sharedStudioVectorReferenceRasterSession = null;
    }
  }
  const session = sharedStudioVectorReferenceRasterSession;
  if (!session) return false;
  const discardUnavailableSession = (): void => {
    if (sharedStudioVectorReferenceRasterSession !== session) return;
    clearStudioVectorReferenceRasterIdleTimer();
    sharedStudioVectorReferenceRasterSession = null;
    session.dispose();
  };
  try {
    if (!session.warm()) {
      discardUnavailableSession();
      return false;
    }
  } catch {
    discardUnavailableSession();
    return false;
  }
  if (sharedStudioVectorReferenceRasterActiveRuns === 0) {
    scheduleStudioVectorReferenceRasterIdleDisposal();
  }
  return true;
}

function acquireStudioVectorReferenceRasterSession(): StudioOffscreenRasterSession | null {
  clearStudioVectorReferenceRasterIdleTimer();
  if (!sharedStudioVectorReferenceRasterSession) {
    preloadStudioVectorReferenceRasterizer();
  }
  const session = sharedStudioVectorReferenceRasterSession;
  if (!session) return null;
  sharedStudioVectorReferenceRasterActiveRuns += 1;
  return session;
}

function releaseStudioVectorReferenceRasterSession(): void {
  sharedStudioVectorReferenceRasterActiveRuns = Math.max(
    0,
    sharedStudioVectorReferenceRasterActiveRuns - 1,
  );
  if (sharedStudioVectorReferenceRasterActiveRuns === 0) {
    scheduleStudioVectorReferenceRasterIdleDisposal();
  }
}

function invalidateStudioVectorReferenceRasterSession(
  session: StudioOffscreenRasterSession,
): void {
  if (sharedStudioVectorReferenceRasterSession !== session) return;
  clearStudioVectorReferenceRasterIdleTimer();
  sharedStudioVectorReferenceRasterSession = null;
  session.dispose();
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeStudioVectorReferenceRasterizer);
}

export interface StudioVectorReferenceResult {
  readonly dataUrl: string;
  readonly fingerprint: string;
  readonly elementCount: number;
  readonly width: number;
  readonly height: number;
  readonly svgByteLength: number;
  readonly pngByteLength: number;
  readonly execution: "worker" | "direct";
}

export type StudioAdvancedFillVectorPlanFailureCode =
  | "invalid-page-id"
  | "invalid-dimensions"
  | "no-visible-vector-draw"
  | "source-budget-exceeded"
  | "svg-budget-exceeded"
  | "unsupported-vector-fidelity";

export interface StudioAdvancedFillVirtualTarget {
  readonly id: string;
  readonly pageId: string;
  readonly width: number;
  readonly height: number;
  readonly frame: SelectionFrame;
  readonly name: string;
  readonly blankSrc: string;
  readonly sourceFingerprint: string;
  readonly sourceElementCount: number;
  /** Insert before this z-index so every source line remains above the new color layer. */
  readonly insertionIndex: number;
}

export type StudioAdvancedFillVectorTargetPlan =
  | {
      readonly ok: true;
      readonly target: StudioAdvancedFillVirtualTarget;
    }
  | {
      readonly ok: false;
      readonly code: StudioAdvancedFillVectorPlanFailureCode;
      readonly reason: string;
      /** Deterministic fallback is useful to callers rendering a disabled insertion preview. */
      readonly insertionIndex: number;
    };

export interface StudioAdvancedFillVectorTargetInput {
  readonly pageId: string;
  readonly width: number;
  readonly height: number;
  readonly elements: readonly El[];
  /**
   * Standard bucket fallback for a document that has no raster layer yet. The whole transparent
   * page becomes one fill region and the materialized color layer is inserted at the bottom.
   */
  readonly allowBlankPage?: boolean;
  readonly groups?: readonly LayerGroup[];
  readonly theme?: SvgExportTheme;
  readonly name?: string;
  readonly budgets?: StudioVectorReferenceBudgets;
}

export class StudioVectorReferenceError extends Error {
  readonly code:
    | StudioAdvancedFillVectorPlanFailureCode
    | "aborted"
    | "png-budget-exceeded"
    | "invalid-png-output"
    | "raster-unavailable";

  constructor(code: StudioVectorReferenceError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StudioVectorReferenceError";
    this.code = code;
  }
}

interface NormalizedStudioVectorReferenceBudgets {
  readonly maxPixelCount: number;
  readonly maxSourceBytes: number;
  readonly maxSvgBytes: number;
  readonly maxPngBytes: number;
}

interface PreparedAdvancedFillVectorInput {
  readonly pageId: string;
  readonly width: number;
  readonly height: number;
  readonly elements: readonly Extract<El, { type: "draw" }>[];
  readonly groups: readonly LayerGroup[];
  readonly theme?: SvgExportTheme;
  readonly name: string;
  readonly insertionIndex: number;
  readonly budgets: NormalizedStudioVectorReferenceBudgets;
}

function boundedBudget(value: number | undefined, hardMaximum: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? Math.min(value!, hardMaximum)
    : hardMaximum;
}

function normalizeBudgets(
  raw: StudioVectorReferenceBudgets | undefined,
): NormalizedStudioVectorReferenceBudgets {
  return {
    maxPixelCount: boundedBudget(raw?.maxPixelCount, STUDIO_ADVANCED_FILL_BROWSER_MAX_PIXELS),
    maxSourceBytes: boundedBudget(raw?.maxSourceBytes, STUDIO_VECTOR_REFERENCE_MAX_SOURCE_BYTES),
    maxSvgBytes: boundedBudget(raw?.maxSvgBytes, STUDIO_VECTOR_REFERENCE_MAX_SVG_BYTES),
    maxPngBytes: boundedBudget(raw?.maxPngBytes, STUDIO_VECTOR_REFERENCE_MAX_PNG_BYTES),
  };
}

function vectorReferenceAbortError(): StudioVectorReferenceError {
  const error = new StudioVectorReferenceError("aborted", "벡터 선화 참조 생성을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw vectorReferenceAbortError();
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function fingerprintStudioVectorReferenceBytes(bytes: Uint8Array, namespace: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193) >>> 0;
    second = Math.imul(second ^ byte, 0x85ebca6b) >>> 0;
    second = (second ^ (second >>> 13)) >>> 0;
  }
  return `${namespace}:${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

/** Non-cryptographic content fingerprint for cache/stale-result ownership, not trust decisions. */
export function fingerprintStudioVectorReference(svg: string, namespace = "vector-reference-v1"): string {
  return fingerprintStudioVectorReferenceBytes(UTF8_ENCODER.encode(svg), namespace);
}

function stableIdHash(value: string): string {
  return fingerprintStudioVectorReference(value, "id").slice(-16);
}

function transparentPageSvg(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;
}

function transparentPageDataUrl(width: number, height: number): string {
  return `data:${SVG_EXPORT_MIME},${encodeURIComponent(transparentPageSvg(width, height))}`;
}

function normalizedTargetName(value: string | undefined): string {
  let safeValue = "";
  for (const character of value ?? "") {
    const codePoint = character.codePointAt(0) ?? 0;
    safeValue += codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) ? " " : character;
  }
  const normalized = safeValue.trim();
  if (!normalized) return "벡터 채색";
  return normalized.slice(0, 120);
}

function sourceSerializedByteLength(elements: readonly SvgExportEl[]): number {
  try {
    return utf8ByteLength(JSON.stringify(elements));
  } catch (error) {
    throw new StudioVectorReferenceError(
      "source-budget-exceeded",
      "벡터 선화 데이터를 안전하게 읽지 못했습니다. 문제가 있는 획을 삭제하거나 페이지를 복제해 다시 시도해 주세요.",
      { cause: error },
    );
  }
}

function validateVectorDimensions(
  width: number,
  height: number,
  budgets: NormalizedStudioVectorReferenceBudgets,
): { width: number; height: number } {
  try {
    return validateStudioAdvancedFillRasterDimensions(width, height, budgets.maxPixelCount);
  } catch (error) {
    throw new StudioVectorReferenceError(
      "invalid-dimensions",
      formatStudioAdvancedFillRasterSizeError(error),
      { cause: error },
    );
  }
}

function assertSourceBudget(
  elements: readonly SvgExportEl[],
  budgets: NormalizedStudioVectorReferenceBudgets,
  receipt?: StudioVectorReferenceSourceBudgetReceipt,
): void {
  const receivedByteLength = readStudioVectorReferenceSourceBudgetReceipt(
    receipt,
    elements,
    budgets.maxSourceBytes,
  );
  const sourceByteLength = receivedByteLength ?? sourceSerializedByteLength(elements);
  if (sourceByteLength > budgets.maxSourceBytes) {
    throw new StudioVectorReferenceError(
      "source-budget-exceeded",
      "벡터 선화 데이터가 안전 처리 한도를 넘었습니다. 페이지를 나누거나 일부 획을 병합한 뒤 다시 시도해 주세요.",
    );
  }
}

function assertSvgResult(
  result: SvgExportResult,
  maxSvgBytes: number,
  fingerprintNamespace: string,
): { readonly fingerprint: string; readonly svgByteLength: number } {
  if (result.skipped.length > 0) {
    throw new StudioVectorReferenceError(
      "unsupported-vector-fidelity",
      "일부 벡터 획을 원본과 같게 참조 이미지로 만들 수 없습니다. 지우개 획이나 지원되지 않는 합성을 병합한 뒤 다시 시도해 주세요.",
    );
  }
  const svgBytes = UTF8_ENCODER.encode(result.svg);
  const svgByteLength = svgBytes.byteLength;
  if (svgByteLength > maxSvgBytes) {
    throw new StudioVectorReferenceError(
      "svg-budget-exceeded",
      "벡터 선화의 렌더 데이터가 안전 처리 한도를 넘었습니다. 페이지를 나누거나 일부 획을 병합한 뒤 다시 시도해 주세요.",
    );
  }
  return {
    fingerprint: fingerprintStudioVectorReferenceBytes(svgBytes, fingerprintNamespace),
    svgByteLength,
  };
}

function pngDataUrlByteLength(dataUrl: string): number | null {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) return null;
  const payload = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
  if (!payload.startsWith("iVBORw0KGgo") || payload.length === 0 || payload.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(payload)) return null;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return payload.length / 4 * 3 - padding;
}

function blobToDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => {
      reader.abort();
      reject(vectorReferenceAbortError());
    });
    reader.onerror = () => finish(() => reject(
      reader.error ?? new StudioVectorReferenceError("raster-unavailable", "벡터 선화 PNG를 읽지 못했습니다."),
    ));
    reader.onload = () => finish(() => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new StudioVectorReferenceError("raster-unavailable", "벡터 선화 PNG를 data URL로 만들지 못했습니다."));
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    reader.readAsDataURL(blob);
  });
}

function loadSvgBlobImage(blob: Blob, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof Image !== "function" || typeof URL.createObjectURL !== "function") {
      reject(new StudioVectorReferenceError("raster-unavailable", "이 브라우저에서는 벡터 선화를 이미지로 만들 수 없습니다."));
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      URL.revokeObjectURL(objectUrl);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => {
      image.src = "";
      reject(vectorReferenceAbortError());
    });
    image.onload = () => finish(() => resolve(image));
    image.onerror = () => finish(() => reject(
      new StudioVectorReferenceError("raster-unavailable", "벡터 선화 SVG를 이미지로 읽지 못했습니다."),
    ));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    image.src = objectUrl;
  });
}

function canvasToPngBlob(
  canvas: HTMLCanvasElement,
  maxOutputBytes: number,
  signal?: AbortSignal,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(vectorReferenceAbortError()));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    canvas.toBlob((blob) => finish(() => {
      if (!blob) {
        reject(new StudioVectorReferenceError("raster-unavailable", "벡터 선화 PNG를 인코딩하지 못했습니다."));
      } else if (blob.size > maxOutputBytes) {
        reject(new StudioVectorReferenceError(
          "png-budget-exceeded",
          "벡터 선화 PNG가 안전 처리 한도를 넘었습니다. 페이지를 나누거나 해상도를 낮춰 주세요.",
        ));
      } else {
        resolve(blob);
      }
    }), "image/png");
  });
}

export const rasterizeStudioVectorReferenceInBrowser: StudioVectorReferenceRasterizer = async ({
  svg,
  width,
  height,
  maxOutputBytes,
  signal,
}) => {
  throwIfAborted(signal);
  if (typeof document === "undefined") {
    throw new StudioVectorReferenceError("raster-unavailable", "이 브라우저에서는 벡터 선화 캔버스를 만들 수 없습니다.");
  }
  const svgBlob = new Blob([svg], { type: SVG_EXPORT_MIME });
  const image = await loadSvgBlobImage(svgBlob, signal);
  throwIfAborted(signal);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      throw new StudioVectorReferenceError("raster-unavailable", "벡터 선화 캔버스를 만들 수 없습니다.");
    }
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    throwIfAborted(signal);
    if (typeof canvas.toBlob !== "function") {
      const dataUrl = canvas.toDataURL("image/png");
      const byteLength = pngDataUrlByteLength(dataUrl);
      if (byteLength === null) {
        throw new StudioVectorReferenceError("invalid-png-output", "벡터 선화 PNG 형식을 확인하지 못했습니다.");
      }
      if (byteLength > maxOutputBytes) {
        throw new StudioVectorReferenceError(
          "png-budget-exceeded",
          "벡터 선화 PNG가 안전 처리 한도를 넘었습니다. 페이지를 나누거나 해상도를 낮춰 주세요.",
        );
      }
      return { dataUrl, width, height };
    }
    const png = await canvasToPngBlob(canvas, maxOutputBytes, signal);
    return { dataUrl: await blobToDataUrl(png, signal), width, height };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
};

/**
 * Moves the expensive page-sized SVG draw and PNG encode off the interaction thread.
 *
 * Directly drawn Studio strokes reach smudge/mix/dodge/liquify through an editable raster copy.
 * SVG serialization was already Worker-backed, but the final full-page draw + PNG encode still
 * happened on the main thread and could look like a frozen canvas on long webtoon pages. The SVG is
 * decoded asynchronously (see {@link decodeStudioVectorReferenceSvgBitmap}) and the decoded bitmap
 * is transferred once to the shared OffscreenCanvas runtime for drawing and `convertToBlob()`
 * encoding. Startup and Worker failures are terminal for this selected provider and surface as
 * `raster-unavailable`; the decoder picks whichever route this realm can actually read SVG with,
 * which never moves the draw or the encode back onto the interaction thread.
 */
export async function rasterizeStudioVectorReferenceOffscreen(
  request: StudioVectorReferenceRasterRequest,
  options: StudioVectorReferenceOffscreenOptions = {},
): Promise<StudioVectorReferenceRasterResult> {
  throwIfAborted(request.signal);
  const createBitmap = options.createBitmap
    ?? (typeof globalThis.createImageBitmap === "function"
      ? (source: Blob) => globalThis.createImageBitmap(source)
      : null);
  if (!createBitmap) {
    throw new StudioVectorReferenceError(
      "raster-unavailable",
      "선택한 Offscreen 벡터 래스터 엔진에서 SVG 비트맵 디코더를 사용할 수 없습니다.",
    );
  }
  if (typeof Worker !== "function") {
    throw new StudioVectorReferenceError(
      "raster-unavailable",
      "선택한 Offscreen 벡터 래스터 Worker를 사용할 수 없습니다.",
    );
  }

  let bitmap: ImageBitmap | null = null;
  let session: StudioOffscreenRasterSession | null = null;
  let leasedSession = false;
  try {
    bitmap = await decodeStudioVectorReferenceSvgBitmap(
      new Blob([request.svg], { type: SVG_EXPORT_MIME }),
      createBitmap,
      request.signal,
    );
    throwIfAborted(request.signal);
    if (bitmap.width <= 0 || bitmap.height <= 0) {
      throw new StudioVectorReferenceError(
        "raster-unavailable",
        "선택한 Offscreen 벡터 래스터 엔진이 유효한 SVG 비트맵을 만들지 못했습니다.",
      );
    }

    if (options.createSession) {
      session = options.createSession();
    } else {
      session = acquireStudioVectorReferenceRasterSession();
      leasedSession = session !== null;
    }
    if (!session) {
      throw new StudioVectorReferenceError(
        "raster-unavailable",
        "선택한 Offscreen 벡터 래스터 Worker를 시작하지 못했습니다.",
      );
    }
    sharedStudioVectorReferenceRasterRunId += 1;
    const result = await session.run(
      `vector-reference:${sharedStudioVectorReferenceRasterRunId}`,
      {
        target: {
          width: request.width,
          height: request.height,
          background: null,
        },
        sources: [{
          kind: "bitmap",
          bitmap: adoptStudioOffscreenBitmap(bitmap),
          placement: {
            dx: 0,
            dy: 0,
            dw: request.width,
            dh: request.height,
            opacity: 1,
            rotation: 0,
            flipX: false,
            flipY: false,
          },
        }],
        output: { kind: "encoded", mime: "image/png" },
      },
      { signal: request.signal },
    );
    throwIfAborted(request.signal);
    if (
      !result.ok
      && leasedSession
      && (
        result.code === "worker-failed"
        || result.code === "protocol"
        || result.code === "timeout"
        || result.code === "unsupported"
      )
    ) {
      invalidateStudioVectorReferenceRasterSession(session);
    }
    if (!result.ok) {
      throw new StudioVectorReferenceError(
        "raster-unavailable",
        `선택한 Offscreen 벡터 래스터 Worker가 작업을 완료하지 못했습니다. ${result.message}`,
      );
    }
    if (
      result.width !== request.width
      || result.height !== request.height
      || result.payload.kind !== "encoded"
      || result.payload.mime !== "image/png"
    ) {
      throw new StudioVectorReferenceError(
        "raster-unavailable",
        "선택한 Offscreen 벡터 래스터 Worker가 유효한 PNG 결과를 반환하지 않았습니다.",
      );
    }
    if (!await isStudioOffscreenRasterEncodedBlobExact(result.payload.blob, "image/png")) {
      throw new StudioVectorReferenceError(
        "raster-unavailable",
        "선택한 Offscreen 벡터 래스터 Worker가 PNG 대신 다른 컨테이너를 반환했습니다.",
      );
    }
    if (result.payload.blob.size > request.maxOutputBytes) {
      throw new StudioVectorReferenceError(
        "png-budget-exceeded",
        "벡터 선화 PNG가 안전 처리 한도를 넘었습니다. 페이지를 나누거나 해상도를 낮춰 주세요.",
      );
    }
    return {
      dataUrl: await blobToDataUrl(result.payload.blob, request.signal),
      width: request.width,
      height: request.height,
    };
  } catch (error) {
    if (request.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw vectorReferenceAbortError();
    }
    if (error instanceof StudioVectorReferenceError && error.code === "png-budget-exceeded") {
      throw error;
    }
    if (leasedSession && session) invalidateStudioVectorReferenceRasterSession(session);
    if (error instanceof StudioVectorReferenceError) throw error;
    throw new StudioVectorReferenceError(
      "raster-unavailable",
      "선택한 Offscreen 벡터 래스터 엔진을 실행하지 못했습니다.",
      { cause: error },
    );
  } finally {
    if (leasedSession) releaseStudioVectorReferenceRasterSession();
    else session?.dispose();
    try {
      bitmap?.close();
    } catch {
      // A successfully posted ImageBitmap is already detached in the main realm.
    }
  }
}

/**
 * Generic SVG-export -> transparent PNG seam. Advanced Fill filters to DrawEl before calling it;
 * future attachment-less vector filters can pass their own explicit document-vector selection.
 */
export async function renderStudioVectorReference(
  input: StudioVectorReferenceInput,
  options: StudioVectorReferenceRenderOptions = {},
): Promise<StudioVectorReferenceResult> {
  throwIfAborted(options.signal);
  const rasterize = selectedStudioVectorReferenceRasterizer(options);
  const prepared = await prepareStudioVectorReferenceExport(input, options);
  return renderPreparedStudioVectorReferenceWithRasterizer(
    prepared,
    options.signal,
    rasterize,
  );
}

/**
 * Runs the expensive SVG serializer exactly once and retains its fidelity census for a later
 * rasterization step. Source/dimension limits are checked before the Worker receives the tree.
 */
export async function prepareStudioVectorReferenceExport(
  input: StudioVectorReferenceInput,
  options: StudioVectorReferenceRenderOptions = {},
): Promise<StudioVectorReferencePreparedExport> {
  throwIfAborted(options.signal);
  const budgets = normalizeBudgets(input.budgets);
  const dimensions = validateVectorDimensions(input.width, input.height, budgets);
  assertSourceBudget(input.elements, budgets, input.sourceBudgetReceipt);
  const exportInput: SvgExportPageInput = {
    width: dimensions.width,
    height: dimensions.height,
    elements: input.elements,
    groups: input.groups,
    theme: input.theme,
    transparentBg: input.transparentBg ?? true,
    bg: input.bg,
    bgGrad: input.bgGrad,
  };
  const workerOptions = options.workerFactory === null
    ? { signal: options.signal, executionBackend: "direct" as const }
    : options.workerFactory === undefined
      ? { signal: options.signal }
      : { signal: options.signal, workerFactory: options.workerFactory };
  const { runStudioSvgExportWorker } = await loadStudioSvgExportWorkerClientModule();
  throwIfAborted(options.signal);
  const exported = await runStudioSvgExportWorker(exportInput, workerOptions);
  throwIfAborted(options.signal);
  return {
    result: exported.result,
    execution: exported.execution,
    width: dimensions.width,
    height: dimensions.height,
    fingerprintNamespace: input.fingerprintNamespace ?? "vector-reference-v1",
    maxSvgBytes: budgets.maxSvgBytes,
    maxPngBytes: budgets.maxPngBytes,
  };
}

function selectedStudioVectorReferenceRasterizer(
  options: StudioVectorReferencePreparedRenderOptions,
): StudioVectorReferenceRasterizer {
  if (options.rasterize && options.rasterExecutionBackend !== "custom") {
    throw new TypeError(
      "studio-vector-reference: an injected rasterizer requires rasterExecutionBackend=custom",
    );
  }
  const executionBackend = options.rasterExecutionBackend ?? "offscreen-worker";
  if (executionBackend === "offscreen-worker") {
    return rasterizeStudioVectorReferenceOffscreen;
  }
  if (executionBackend === "browser-direct") {
    return rasterizeStudioVectorReferenceInBrowser;
  }
  if (executionBackend === "custom" && options.rasterize) return options.rasterize;
  throw new TypeError(
    "studio-vector-reference: invalid or incomplete rasterExecutionBackend selection",
  );
}

async function renderPreparedStudioVectorReferenceWithRasterizer(
  prepared: StudioVectorReferencePreparedExport,
  signal: AbortSignal | undefined,
  rasterize: StudioVectorReferenceRasterizer,
): Promise<StudioVectorReferenceResult> {
  throwIfAborted(signal);
  const { fingerprint, svgByteLength } = assertSvgResult(
    prepared.result,
    prepared.maxSvgBytes,
    prepared.fingerprintNamespace,
  );
  const rasterized = await rasterize({
    svg: prepared.result.svg,
    width: prepared.width,
    height: prepared.height,
    maxOutputBytes: prepared.maxPngBytes,
    signal,
  });
  throwIfAborted(signal);
  if (rasterized.width !== prepared.width || rasterized.height !== prepared.height) {
    throw new StudioVectorReferenceError("invalid-png-output", "벡터 선화 PNG의 페이지 크기가 일치하지 않습니다.");
  }
  const pngByteLength = pngDataUrlByteLength(rasterized.dataUrl);
  if (pngByteLength === null) {
    throw new StudioVectorReferenceError("invalid-png-output", "벡터 선화 PNG 형식을 확인하지 못했습니다.");
  }
  if (pngByteLength > prepared.maxPngBytes) {
    throw new StudioVectorReferenceError(
      "png-budget-exceeded",
      "벡터 선화 PNG가 안전 처리 한도를 넘었습니다. 페이지를 나누거나 해상도를 낮춰 주세요.",
    );
  }
  return {
    dataUrl: rasterized.dataUrl,
    fingerprint,
    elementCount: prepared.result.elementCount,
    width: prepared.width,
    height: prepared.height,
    svgByteLength,
    pngByteLength,
    execution: prepared.execution,
  };
}

/** Rasterizes a previously prepared export through one backend selected before work starts. */
export async function renderPreparedStudioVectorReference(
  prepared: StudioVectorReferencePreparedExport,
  options: StudioVectorReferencePreparedRenderOptions = {},
): Promise<StudioVectorReferenceResult> {
  throwIfAborted(options.signal);
  const rasterize = selectedStudioVectorReferenceRasterizer(options);
  return renderPreparedStudioVectorReferenceWithRasterizer(
    prepared,
    options.signal,
    rasterize,
  );
}

type StudioDrawStroke = Extract<El, { type: "draw" }>;

/**
 * 획의 바운딩 박스(선 두께 포함).
 *
 * `studio-element-geometry` 의 `elBounds` 는 중심선만 보고 두께를 무시한다. 여기서는 "겹치지
 * 않는다"는 판정으로 fail-open 을 하므로 **넓게 잡는 쪽이 안전**하다 — 두께의 절반에 1px 여유를
 * 더해 부풀린다. 브러시 다이내믹스로 실제 자국이 공칭 두께보다 넓어질 수 있어서 여유를 둔다.
 */
function strokeBounds(element: StudioDrawStroke): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} | null {
  const { points } = element;
  if (points.length < 2) return null;
  let minX = points[0];
  let minY = points[1];
  let maxX = minX;
  let maxY = minY;
  for (let i = 2; i + 1 < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const pad = Math.max(1, element.strokeWidth) / 2 + 1;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/**
 * 참조 이미지 합성에 아무 기여도 하지 않는 지우개 획을 뺀다.
 *
 * 왜 필요한가
 * -----------
 * 공유 SVG 직렬화기는 지우개 획을 재현할 수 없어 통째로 `skipped` 처리한다
 * (`studio-svg-export.ts` `serializeDraw`). 그래서 이 모듈은 "지우개 획이 하나라도 있으면"
 * 참조 이미지가 화면과 달라진다고 보고 fail-closed 했다 — 진입 단계에서 통째로 막고
 * "지우개 벡터 획은 … 정확히 재현할 수 없습니다" 배너를 띄웠다.
 *
 * 그런데 **"지우개 획이 있다"와 "지우개가 화면을 바꾼다"는 다르다.** 지우개는 자기보다 아래
 * (먼저 그려진) 잉크만 지운다. 아래에 겹치는 잉크가 없는 지우개 획 — 빈 곳을 문지른 획,
 * 잉크를 다 지우고 이어서 그은 꼬리, 잉크보다 먼저 놓인 획 — 은 합성 결과에 흔적을 남기지
 * 않는다. 그런 획을 직렬화 입력에서 빼면 SVG 는 화면을 **정확히** 재현하고 `skipped` 도 비므로,
 * 사유 배너를 띄울 근거 자체가 사라진다. 반대로 실제로 잉크를 지운 획이 하나라도 남으면
 * 예전과 똑같이 막힌다 — 배너 문구가 참인 경우는 그대로 지킨다.
 *
 * 판정은 보수적이다. 바운딩 박스가 조금이라도 겹치면 "영향 있음"으로 본다(실제 획 모양이
 * 겹치는지는 보지 않는다). 즉 이 함수가 빼는 것은 **확실히 무해한 획**뿐이다.
 */
function dropInertEraserStrokes(
  elements: readonly StudioDrawStroke[],
): StudioDrawStroke[] {
  if (!elements.some((element) => element.mode === "eraser")) return [...elements];
  const boundsByIndex = elements.map(strokeBounds);
  const kept: StudioDrawStroke[] = [];
  for (let i = 0; i < elements.length; i += 1) {
    const element = elements[i];
    if (element.mode !== "eraser") {
      kept.push(element);
      continue;
    }
    const eraser = boundsByIndex[i];
    // 좌표를 못 읽는 획은 판정할 수 없다 — 예전처럼 남겨 fail-closed 를 유지한다.
    let affectsInk = eraser === null;
    if (eraser) {
      for (let below = 0; below < i; below += 1) {
        const ink = elements[below];
        if (ink.mode === "eraser") continue;
        const inkBounds = boundsByIndex[below];
        if (!inkBounds) continue;
        if (
          inkBounds.minX <= eraser.maxX &&
          inkBounds.maxX >= eraser.minX &&
          inkBounds.minY <= eraser.maxY &&
          inkBounds.maxY >= eraser.minY
        ) {
          affectsInk = true;
          break;
        }
      }
    }
    if (affectsInk) kept.push(element);
  }
  return kept;
}

function prepareAdvancedFillVectorInput(
  input: StudioAdvancedFillVectorTargetInput,
): PreparedAdvancedFillVectorInput | Extract<StudioAdvancedFillVectorTargetPlan, { ok: false }> {
  const groups = [...(input.groups ?? [])];
  const insertionIndex = input.elements.findIndex(
    (element) => element.type === "draw" && !isEffectivelyHidden(element, groups),
  );
  const safeInsertionIndex = insertionIndex >= 0
    ? insertionIndex
    : input.allowBlankPage
      ? 0
      : input.elements.length;
  const pageId = input.pageId.trim();
  if (!pageId) {
    return {
      ok: false,
      code: "invalid-page-id",
      reason: "벡터 채색 레이어를 연결할 페이지를 찾지 못했습니다.",
      insertionIndex: safeInsertionIndex,
    };
  }
  const elements = dropInertEraserStrokes(
    input.elements.filter(
      (element): element is Extract<El, { type: "draw" }> =>
        element.type === "draw" && !isEffectivelyHidden(element, groups),
    ),
  );
  if (elements.length === 0 && !input.allowBlankPage) {
    return {
      ok: false,
      code: "no-visible-vector-draw",
      reason: "페이지에 표시 중인 벡터 선화가 없습니다. 펜이나 도형으로 선화를 추가한 뒤 다시 시도해 주세요.",
      insertionIndex: safeInsertionIndex,
    };
  }
  const budgets = normalizeBudgets(input.budgets);
  try {
    const dimensions = validateVectorDimensions(input.width, input.height, budgets);
    assertSourceBudget(elements, budgets);
    return {
      pageId,
      width: dimensions.width,
      height: dimensions.height,
      elements,
      groups,
      theme: input.theme,
      name: normalizedTargetName(input.name),
      insertionIndex: safeInsertionIndex,
      budgets,
    };
  } catch (error) {
    if (error instanceof StudioVectorReferenceError) {
      return {
        ok: false,
        code: error.code === "invalid-dimensions" ? "invalid-dimensions" : "source-budget-exceeded",
        reason: error.message,
        insertionIndex: safeInsertionIndex,
      };
    }
    throw error;
  }
}

export function planStudioAdvancedFillVectorTarget(
  input: StudioAdvancedFillVectorTargetInput,
): StudioAdvancedFillVectorTargetPlan {
  const prepared = prepareAdvancedFillVectorInput(input);
  if ("ok" in prepared) return prepared;
  if (prepared.elements.some((element) => element.mode === "eraser")) {
    return {
      ok: false,
      code: "unsupported-vector-fidelity",
      reason: "지우개 벡터 획은 선화 참조 이미지에서 원본 합성을 정확히 재현할 수 없습니다. 먼저 레이어를 병합해 주세요.",
      insertionIndex: prepared.insertionIndex,
    };
  }
  const sourcePayload = JSON.stringify({
    width: prepared.width,
    height: prepared.height,
    elements: prepared.elements,
    groups: prepared.groups,
    theme: prepared.theme,
  });
  const minimumSerializedBytes = utf8ByteLength(sourcePayload)
    + utf8ByteLength(transparentPageSvg(prepared.width, prepared.height));
  if (minimumSerializedBytes > prepared.budgets.maxSvgBytes) {
    return {
      ok: false,
      code: "svg-budget-exceeded",
      reason: "벡터 선화의 최소 직렬화 크기가 안전 처리 한도를 넘었습니다. 페이지를 나누거나 일부 획을 병합해 주세요.",
      insertionIndex: prepared.insertionIndex,
    };
  }
  const sourceFingerprint = fingerprintStudioVectorReference(sourcePayload, "advanced-fill-vector-v2");
  return {
    ok: true,
    target: {
      id: `advanced-fill-vector-${stableIdHash(prepared.pageId)}-${sourceFingerprint.slice(-16)}`,
      pageId: prepared.pageId,
      width: prepared.width,
      height: prepared.height,
      frame: { x: 0, y: 0, width: prepared.width, height: prepared.height, rotation: 0 },
      name: prepared.name,
      blankSrc: transparentPageDataUrl(prepared.width, prepared.height),
      sourceFingerprint,
      sourceElementCount: prepared.elements.length,
      insertionIndex: prepared.insertionIndex,
    },
  };
}

/**
 * 래스터 대상 채우기에서 벡터 선화 참조를 만들지 못했을 때 쓸 정직한 제외 문구.
 *
 * 왜 던지지 않는가
 * ----------------
 * 벡터 대상(`virtual-vector-fill`)에서 이 참조는 채우기 경계 **그 자체**라 없으면 할 일이
 * 없다. 하지만 래스터 대상에서는 래스터 경계 위에 얹는 **추가** 경계일 뿐이다. 참조를 못
 * 만든다고 래스터 채우기가 틀려지지는 않는다 — 경계가 하나 줄어들 뿐이다. 그런데도 실패를
 * 던지면 페이지 어딘가의 지우개 획 하나가 무관한 래스터 레이어의 채우기를 통째로 막고,
 * 배너는 "먼저 레이어를 병합해 주세요" 라며 파괴적인 작업을 요구한다.
 *
 * 그래서 이 경로는 `studio-svg-export.ts` 의 정직성 규약을 그대로 따른다 — 완벽 재현이
 * 불가한 것은 그리지 않고, 대신 무엇을 왜 뺐는지 전부 알린다. 채우기 결과는 명시적 적용
 * 전까지 미리보기라, 경계가 하나 빠진 결과를 사용자가 눈으로 보고 판단할 수 있다.
 *
 * 근사본을 대신 넣지 않는 이유도 같은 규약이다. 지우개를 뺀 SVG 는 화면에 없는 선을 경계로
 * 세운다. 채우기가 보이지 않는 벽에서 멈추면 미리보기로도 확인할 방법이 없다. 아예 빼면
 * 채우기가 선화를 넘어 번지는 모습이 그대로 보이므로 적용 전에 알아챌 수 있다.
 *
 * @returns 뺄 것이 애초에 없으면(`no-visible-vector-draw`) null — 알릴 사실이 없다.
 */
export function describeStudioAdvancedFillVectorReferenceExclusion(
  failure: Extract<StudioAdvancedFillVectorTargetPlan, { readonly ok: false }>,
): string | null {
  if (failure.code === "no-visible-vector-draw") return null;
  return `벡터 선화는 채우기 경계에서 빼고 래스터 경계만으로 계산했어요. ${failure.reason}`;
}

export async function renderStudioAdvancedFillVectorReference(
  input: StudioAdvancedFillVectorTargetInput,
  options: StudioVectorReferenceRenderOptions = {},
): Promise<StudioVectorReferenceResult> {
  const prepared = prepareAdvancedFillVectorInput(input);
  if ("ok" in prepared) {
    throw new StudioVectorReferenceError(prepared.code, prepared.reason);
  }
  const rendered = await renderStudioVectorReference(
    {
      width: prepared.width,
      height: prepared.height,
      elements: prepared.elements,
      groups: prepared.groups,
      theme: prepared.theme,
      fingerprintNamespace: "advanced-fill-vector-v1",
      budgets: prepared.budgets,
    },
    options,
  );
  const sourcePayload = JSON.stringify({
    width: prepared.width,
    height: prepared.height,
    elements: prepared.elements,
    groups: prepared.groups,
    theme: prepared.theme,
  });
  return {
    ...rendered,
    fingerprint: fingerprintStudioVectorReference(sourcePayload, "advanced-fill-vector-v2"),
  };
}

export type StudioAdvancedFillMaterializedVectorTarget = Extract<El, { type: "image" }>;

export function materializeStudioAdvancedFillVectorTarget(
  target: StudioAdvancedFillVirtualTarget,
  resultSrc: string,
): StudioAdvancedFillMaterializedVectorTarget {
  if (pngDataUrlByteLength(resultSrc) === null) {
    throw new StudioVectorReferenceError("invalid-png-output", "벡터 채색 결과가 올바른 PNG 형식이 아닙니다.");
  }
  return {
    id: target.id,
    type: "image",
    name: target.name,
    src: resultSrc,
    x: target.frame.x,
    y: target.frame.y,
    width: target.frame.width,
    height: target.frame.height,
    rotation: target.frame.rotation ?? 0,
  };
}

/** Runtime helper for callers that choose a device-specific plan budget. */
export function currentStudioVectorReferenceBudgets(): StudioVectorReferenceBudgets {
  return { maxPixelCount: currentStudioAdvancedFillBrowserMaxPixels() };
}
