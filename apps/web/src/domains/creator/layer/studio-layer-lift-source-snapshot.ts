/**
 * Browser adapter that turns one eligible ImageEl into the provider's canonical RGBA source.
 *
 * The raster is element-local: authored x/y/rotation/flip/skew remain in `placement` and are not
 * baked into pixels. Width/height define the local output raster, matching the pixels displayed
 * by Studio before those placement transforms. Active image filters run through the existing
 * Studio Worker filter pipeline; dependency features rejected by the availability boundary never
 * enter this adapter.
 */

import {
  createPixelEditCanvas,
  loadPixelEditImage,
} from "../canvas/studio-canvas-image-io";
import { hasActiveImageFilters } from "../render/studio-konva-filter-fields";
import { sha256HexPortable } from "../studio-sha256";

import {
  inspectStudioLayerLiftAvailability,
  type StudioLayerLiftAvailabilityFailure,
  type StudioLayerLiftAvailabilityInput,
  type StudioLayerLiftSourcePlacement,
  type StudioLayerLiftUnavailableCode,
} from "./studio-layer-lift-availability";
import {
  STUDIO_SCENE_LAYER_LIFT_BUDGETS,
  type StudioSceneLayerLiftSourceDescriptor,
} from "./studio-layer-lift-contract";
import { fingerprintStudioLayerLiftSource } from "./studio-layer-lift-plan";

import type { El, ImageEl } from "../studio-element-model";

export const STUDIO_LAYER_LIFT_SOURCE_SNAPSHOT_ERROR_CODES = Object.freeze([
  "aborted",
  "source-state-invalid",
  "source-changed",
  "source-load-failed",
  "source-decoded-dimensions-invalid",
  "source-decoded-budget-exceeded",
  "source-readback-blocked",
  "source-rasterization-failed",
  "source-pixel-buffer-invalid",
  "source-filter-failed",
] as const);

export type StudioLayerLiftSourceSnapshotRuntimeErrorCode =
  (typeof STUDIO_LAYER_LIFT_SOURCE_SNAPSHOT_ERROR_CODES)[number];

export type StudioLayerLiftSourceSnapshotErrorCode =
  | StudioLayerLiftUnavailableCode
  | StudioLayerLiftSourceSnapshotRuntimeErrorCode;

export interface StudioLayerLiftDecodedImage {
  readonly image: unknown;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

export interface StudioLayerLiftFilterResult {
  readonly bytes: Uint8Array | Uint8ClampedArray;
  readonly execution: "direct" | "worker";
}

export interface StudioLayerLiftSourceSnapshotRuntime {
  readonly loadImage: (
    source: string,
    signal: AbortSignal | undefined,
  ) => Promise<StudioLayerLiftDecodedImage>;
  readonly readPixels: (
    decoded: StudioLayerLiftDecodedImage,
    width: number,
    height: number,
  ) => Uint8Array | Uint8ClampedArray;
  readonly applyFilters: (
    bytes: Uint8Array<ArrayBuffer>,
    width: number,
    height: number,
    source: Readonly<ImageEl & El>,
    signal: AbortSignal | undefined,
  ) => Promise<StudioLayerLiftFilterResult>;
}

export interface CreateStudioLayerLiftSourceSnapshotInput {
  readonly availability: StudioLayerLiftAvailabilityInput;
  /**
   * Reads editor refs again after every async boundary. Omitting it is safe only for an immutable
   * detached document snapshot; the same original input is re-inspected in that case.
   */
  readonly readCurrent?: () => StudioLayerLiftAvailabilityInput;
  readonly signal?: AbortSignal;
  readonly runtime?: Partial<StudioLayerLiftSourceSnapshotRuntime>;
}

export interface StudioLayerLiftSourceSnapshotSuccess {
  readonly ok: true;
  readonly source: StudioSceneLayerLiftSourceDescriptor;
  readonly sourceFingerprint: string;
  readonly placement: StudioLayerLiftSourcePlacement;
  readonly filterExecution: "none" | "direct" | "worker";
}

export interface StudioLayerLiftSourceSnapshotFailure {
  readonly ok: false;
  readonly phase:
    | "availability"
    | "state"
    | "decode"
    | "readback"
    | "filter";
  readonly code: StudioLayerLiftSourceSnapshotErrorCode;
  readonly message: string;
  readonly sourceId: string | null;
}

export type StudioLayerLiftSourceSnapshotResult =
  | StudioLayerLiftSourceSnapshotSuccess
  | StudioLayerLiftSourceSnapshotFailure;

type StudioLayerLiftImage = ImageEl & El;

function snapshotFailure(
  phase: StudioLayerLiftSourceSnapshotFailure["phase"],
  code: StudioLayerLiftSourceSnapshotErrorCode,
  message: string,
  sourceId: string | null,
): StudioLayerLiftSourceSnapshotFailure {
  return Object.freeze({ ok: false, phase, code, message, sourceId });
}

function availabilityFailure(
  failure: StudioLayerLiftAvailabilityFailure,
): StudioLayerLiftSourceSnapshotFailure {
  return snapshotFailure(
    "availability",
    failure.code,
    failure.message,
    failure.sourceId,
  );
}

function abortFailure(
  sourceId: string | null,
): StudioLayerLiftSourceSnapshotFailure {
  return snapshotFailure(
    "state",
    "aborted",
    "의미 레이어 분리 원본 준비를 취소했습니다.",
    sourceId,
  );
}

function isAbortError(error: unknown): boolean {
  const DomException = globalThis.DOMException;
  return (
    (
      typeof DomException === "function"
      && error instanceof DomException
      && error.name === "AbortError"
    )
    || (
      error !== null
      && typeof error === "object"
      && (error as { name?: unknown }).name === "AbortError"
    )
  );
}

function isReadbackBlockedError(error: unknown): boolean {
  if (
    error !== null
    && typeof error === "object"
    && (error as { name?: unknown }).name === "SecurityError"
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /taint|cross-origin|cross origin|cors|insecure|security/iu.test(message);
}

function finitePositiveInteger(value: unknown): value is number {
  return (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
  );
}

function ownedPixelBytes(
  input: Uint8Array | Uint8ClampedArray,
  expectedByteLength: number,
): Uint8Array<ArrayBuffer> | null {
  if (
    !(input instanceof Uint8Array)
    && !(input instanceof Uint8ClampedArray)
  ) {
    return null;
  }
  if (input.byteLength !== expectedByteLength) {
    return null;
  }
  return Uint8Array.from(input);
}

function cloneSourceElement(source: StudioLayerLiftImage): StudioLayerLiftImage {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(source) as StudioLayerLiftImage;
  }
  return JSON.parse(JSON.stringify(source)) as StudioLayerLiftImage;
}

async function defaultLoadImage(
  source: string,
  signal: AbortSignal | undefined,
): Promise<StudioLayerLiftDecodedImage> {
  const image = await loadPixelEditImage(source, signal);
  return {
    image,
    naturalWidth: image.naturalWidth || image.width,
    naturalHeight: image.naturalHeight || image.height,
  };
}

function defaultReadPixels(
  decoded: StudioLayerLiftDecodedImage,
  width: number,
  height: number,
): Uint8ClampedArray {
  const prepared = createPixelEditCanvas(width, height);
  if (!prepared) {
    throw new Error("의미 레이어 분리용 sRGB 캔버스를 만들 수 없습니다.");
  }
  const { ctx } = prepared;
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Canvas 2D's default ImageData path is 8-bit, unpremultiplied (straight-alpha) sRGB. The
  // element-local draw intentionally excludes authored placement transforms.
  ctx.drawImage(decoded.image as CanvasImageSource, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

async function defaultApplyFilters(
  bytes: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
  source: Readonly<StudioLayerLiftImage>,
  signal: AbortSignal | undefined,
): Promise<StudioLayerLiftFilterResult> {
  const { runStudioImageFilterWorker } = await import("../studio-image-filter-worker-client"
  );
  const result = await runStudioImageFilterWorker({
    imageData: {
      data: Uint8ClampedArray.from(bytes),
      width,
      height,
    },
    el: source,
  }, { signal });
  return {
    bytes: result.imageData.data,
    execution: result.execution,
  };
}

function currentAvailability(
  input: CreateStudioLayerLiftSourceSnapshotInput,
) {
  return inspectStudioLayerLiftAvailability(
    input.readCurrent?.() ?? input.availability,
  );
}

function isSameAvailability(
  expected: Extract<
    ReturnType<typeof inspectStudioLayerLiftAvailability>,
    { available: true }
  >,
  current: ReturnType<typeof inspectStudioLayerLiftAvailability>,
): current is Extract<
  ReturnType<typeof inspectStudioLayerLiftAvailability>,
  { available: true }
> {
  return (
    current.available
    && current.sourceId === expected.sourceId
    && current.sourceFingerprint === expected.sourceFingerprint
    && current.readableSource === expected.readableSource
    && current.sourceMimeType === expected.sourceMimeType
    && current.rasterWidth === expected.rasterWidth
    && current.rasterHeight === expected.rasterHeight
  );
}

function revalidateCurrent(
  input: CreateStudioLayerLiftSourceSnapshotInput,
  expected: Extract<
    ReturnType<typeof inspectStudioLayerLiftAvailability>,
    { available: true }
  >,
): StudioLayerLiftSourceSnapshotFailure | null {
  if (input.signal?.aborted) return abortFailure(expected.sourceId);
  let current: ReturnType<typeof inspectStudioLayerLiftAvailability>;
  try {
    current = currentAvailability(input);
  } catch {
    return snapshotFailure(
      "state",
      "source-changed",
      "원본 준비 중 현재 이미지 상태를 다시 확인하지 못했습니다.",
      expected.sourceId,
    );
  }
  if (!isSameAvailability(expected, current)) {
    return snapshotFailure(
      "state",
      "source-changed",
      "원본 준비 중 선택 이미지가 바뀌었습니다. 최신 이미지에서 다시 실행해 주세요.",
      expected.sourceId,
    );
  }
  return null;
}

/**
 * Creates an owned straight-alpha sRGB RGBA8 descriptor and hashes the exact returned bytes.
 * Every async boundary revalidates source identity; no caller-owned pixel view is retained.
 */
export async function createStudioLayerLiftSourceSnapshot(
  input: CreateStudioLayerLiftSourceSnapshotInput,
): Promise<StudioLayerLiftSourceSnapshotResult> {
  let initial: ReturnType<typeof inspectStudioLayerLiftAvailability>;
  try {
    initial = inspectStudioLayerLiftAvailability(input.availability);
  } catch {
    return snapshotFailure(
      "availability",
      "source-state-invalid",
      "선택 이미지 상태를 안전하게 확인하지 못했습니다.",
      input.availability.selectedIds[0] ?? null,
    );
  }
  if (!initial.available) return availabilityFailure(initial);
  if (input.signal?.aborted) return abortFailure(initial.sourceId);

  const sourceAtIndex = input.availability.elements[initial.sourceIndex];
  if (
    !sourceAtIndex
    || sourceAtIndex.type !== "image"
    || sourceAtIndex.id !== initial.sourceId
  ) {
    return snapshotFailure(
      "state",
      "source-state-invalid",
      "선택 이미지 스냅샷이 현재 문서와 일치하지 않습니다.",
      initial.sourceId,
    );
  }

  let source: StudioLayerLiftImage;
  try {
    source = cloneSourceElement(sourceAtIndex as StudioLayerLiftImage);
  } catch {
    return snapshotFailure(
      "state",
      "source-state-invalid",
      "선택 이미지 속성을 안전하게 복제하지 못했습니다.",
      initial.sourceId,
    );
  }
  const cloneFingerprint = fingerprintStudioLayerLiftSource({
    elements: input.availability.elements.map((element, index) =>
      index === initial.sourceIndex ? source : element),
    groups: input.availability.groups,
    sourceId: initial.sourceId,
  });
  if (
    cloneFingerprint !== initial.sourceFingerprint
    || hasActiveImageFilters(source) !== initial.filtersWillBeBaked
  ) {
    return snapshotFailure(
      "state",
      "source-state-invalid",
      "선택 이미지 속성을 같은 상태로 고정하지 못했습니다.",
      initial.sourceId,
    );
  }

  const runtime: StudioLayerLiftSourceSnapshotRuntime = {
    loadImage: input.runtime?.loadImage ?? defaultLoadImage,
    readPixels: input.runtime?.readPixels ?? defaultReadPixels,
    applyFilters: input.runtime?.applyFilters ?? defaultApplyFilters,
  };

  const staleBeforeDecode = revalidateCurrent(input, initial);
  if (staleBeforeDecode) return staleBeforeDecode;

  let decoded: StudioLayerLiftDecodedImage;
  try {
    decoded = await runtime.loadImage(initial.readableSource, input.signal);
  } catch (error) {
    if (input.signal?.aborted || isAbortError(error)) {
      return abortFailure(initial.sourceId);
    }
    return snapshotFailure(
      "decode",
      "source-load-failed",
      initial.readbackRequirement === "cors-probe"
        ? "외부 이미지가 CORS 읽기를 허용하지 않거나 원본을 불러오지 못했습니다."
        : "선택 이미지 원본을 불러오지 못했습니다.",
      initial.sourceId,
    );
  }
  const staleAfterDecode = revalidateCurrent(input, initial);
  if (staleAfterDecode) return staleAfterDecode;

  if (
    !finitePositiveInteger(decoded.naturalWidth)
    || !finitePositiveInteger(decoded.naturalHeight)
  ) {
    return snapshotFailure(
      "decode",
      "source-decoded-dimensions-invalid",
      "디코드된 이미지의 자연 해상도를 확인할 수 없습니다.",
      initial.sourceId,
    );
  }
  const decodedPixelCount = decoded.naturalWidth * decoded.naturalHeight;
  if (
    !Number.isSafeInteger(decodedPixelCount)
    || decoded.naturalWidth
      > STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumAxisPixels
    || decoded.naturalHeight
      > STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumAxisPixels
    || decodedPixelCount > STUDIO_SCENE_LAYER_LIFT_BUDGETS.maximumPixels
  ) {
    return snapshotFailure(
      "decode",
      "source-decoded-budget-exceeded",
      "디코드된 이미지 원본이 의미 레이어 분리 안전 해상도를 넘습니다.",
      initial.sourceId,
    );
  }

  const expectedByteLength = initial.pixelCount * 4;
  let rawPixels: Uint8Array | Uint8ClampedArray;
  try {
    rawPixels = runtime.readPixels(
      decoded,
      initial.rasterWidth,
      initial.rasterHeight,
    );
  } catch (error) {
    if (input.signal?.aborted || isAbortError(error)) {
      return abortFailure(initial.sourceId);
    }
    if (isReadbackBlockedError(error)) {
      return snapshotFailure(
        "readback",
        "source-readback-blocked",
        "브라우저가 외부 이미지 픽셀 읽기를 차단했습니다. CORS가 허용된 원본이 필요합니다.",
        initial.sourceId,
      );
    }
    return snapshotFailure(
      "readback",
      "source-rasterization-failed",
      "선택 이미지를 요소 로컬 sRGB 픽셀로 변환하지 못했습니다.",
      initial.sourceId,
    );
  }
  let bytes = ownedPixelBytes(rawPixels, expectedByteLength);
  if (!bytes) {
    return snapshotFailure(
      "readback",
      "source-pixel-buffer-invalid",
      "이미지 픽셀 길이가 요소 로컬 해상도와 일치하지 않습니다.",
      initial.sourceId,
    );
  }

  let filterExecution: StudioLayerLiftSourceSnapshotSuccess["filterExecution"] =
    "none";
  if (initial.filtersWillBeBaked) {
    try {
      const filtered = await runtime.applyFilters(
        bytes,
        initial.rasterWidth,
        initial.rasterHeight,
        source,
        input.signal,
      );
      if (
        filtered.execution !== "direct"
        && filtered.execution !== "worker"
      ) {
        throw new TypeError("invalid filter execution");
      }
      const filteredBytes = ownedPixelBytes(
        filtered.bytes,
        expectedByteLength,
      );
      if (!filteredBytes) throw new TypeError("invalid filter pixel buffer");
      bytes = filteredBytes;
      filterExecution = filtered.execution;
    } catch (error) {
      if (input.signal?.aborted || isAbortError(error)) {
        return abortFailure(initial.sourceId);
      }
      return snapshotFailure(
        "filter",
        "source-filter-failed",
        "선택 이미지의 필터 외형을 정확하게 굽지 못해 분리를 중단했습니다.",
        initial.sourceId,
      );
    }
  }

  const staleAfterPixels = revalidateCurrent(input, initial);
  if (staleAfterPixels) return staleAfterPixels;

  const sourceDescriptor: StudioSceneLayerLiftSourceDescriptor = Object.freeze({
    sourceId: initial.sourceId,
    sourceName: initial.sourceName,
    mimeType: initial.sourceMimeType,
    width: initial.rasterWidth,
    height: initial.rasterHeight,
    pixelCount: initial.pixelCount,
    pixelFormat: "rgba8-srgb-straight",
    channels: 4,
    byteLength: bytes.byteLength,
    sha256: `sha256:${sha256HexPortable(bytes)}`,
    bytes,
  });

  return Object.freeze({
    ok: true,
    source: sourceDescriptor,
    sourceFingerprint: initial.sourceFingerprint,
    placement: initial.placement,
    filterExecution,
  });
}
