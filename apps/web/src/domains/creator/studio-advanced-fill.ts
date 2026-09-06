/**
 * DOM/canvas와 무관한 고급 페인트 통 엔진.
 *
 * 기준 이미지에서 채울 영역을 계산하고 target의 복제본에만 RGBA를 기록한다. 입력 버퍼는 어떤
 * 상태(성공·누수 차단·중단)에서도 변경하지 않는다. 기준 이미지를 target과 분리할 수 있어 선화
 * 레이어를 참조하면서 별도 채색 레이어를 칠하는 워크플로에도 사용할 수 있다.
 */

import { createStudioPersistentBinaryMaskScanner } from "./render/studio-wasm-connected-components-kernel";
import {
  createStudioPersistentMaskMorphologyExecutor,
  type StudioMaskMorphologyOperation,
} from "./render/studio-wasm-mask-morphology-kernel";

export const ADVANCED_FILL_MAX_PIXELS = 32 * 1024 * 1024;
export const ADVANCED_FILL_MAX_CLOSE_GAP_RADIUS = 32;
export const ADVANCED_FILL_MAX_AREA_ADJUSTMENT = 64;

/**
 * Kept for the lifetime of the Advanced Fill worker/module. The product Worker
 * selects stable Wasm32 before accepting a request and never changes backend
 * after an init/run failure.
 */
const ADVANCED_FILL_MASK_SCANNER = createStudioPersistentBinaryMaskScanner({
  backend: "wasm32",
});
const ADVANCED_FILL_MORPHOLOGY =
  createStudioPersistentMaskMorphologyExecutor({
    backend: "wasm-memory32",
  });

export type AdvancedFillRgba = readonly [red: number, green: number, blue: number, alpha: number];

export interface AdvancedFillImageDataLike {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** 0..255 단일 채널 마스크. width/height는 target과 같아야 한다. */
export interface AdvancedFillMaskLike {
  readonly data: Uint8Array | Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface AdvancedFillSeed {
  readonly x: number;
  readonly y: number;
}

/** AbortSignal을 직접 요구하지 않아 Node/worker에서도 DOM 타입 없이 사용할 수 있다. */
export interface AdvancedFillAbortLike {
  readonly aborted: boolean;
}

export type AdvancedFillMatchMode = "seed-color" | "boundary-only";
export type AdvancedFillAlphaBoundary = "none" | "transparent" | "visible";
export type AdvancedFillMaskMode = "allow" | "block";
export type AdvancedFillConnectivity = 4 | 8;

export interface AdvancedFillOptions {
  /** 채널별 RMS 색 거리 허용치(0..255). 기본 32. */
  readonly tolerance?: number;
  /** 색 거리 계산에 알파 채널을 포함한다. 기본 true. */
  readonly matchAlpha?: boolean;
  /** seed-color는 시드 색을 비교하고 boundary-only는 경계/마스크만 사용한다. */
  readonly matchMode?: AdvancedFillMatchMode;
  /** 기준 이미지의 투명 또는 보이는 픽셀을 절대 경계로 취급한다. */
  readonly alphaBoundary?: AdvancedFillAlphaBoundary;
  /** alphaBoundary를 나누는 0..255 임계값. alpha <= threshold가 투명이다. */
  readonly alphaThreshold?: number;
  /** allow: threshold보다 큰 마스크만 허용, block: threshold보다 큰 마스크를 차단. */
  readonly maskMode?: AdvancedFillMaskMode;
  readonly maskThreshold?: number;
  /** true면 시드와 이어진 영역만, false면 같은 조건의 모든 영역을 선택한다. */
  readonly contiguous?: boolean;
  readonly connectivity?: AdvancedFillConnectivity;
  /** 끊어진 경계를 이 반경(0..32)의 정사각 커널로 닫는다. */
  readonly closeGapRadius?: number;
  /** 양수는 팽창, 음수는 수축(-64..64). 0.5px 입력은 0에서 먼 쪽 정수 픽셀로 반올림한다. */
  readonly areaAdjustment?: number;
  /** 팽창한 영역도 referenceMask 밖으로 나가지 않게 한다. 기본 true. */
  readonly constrainExpansionToMask?: boolean;
  /** 최종 선택이 전체 캔버스에서 차지할 수 있는 최대 비율(0 초과, 1 이하). 기본 0.85. */
  readonly maxAreaRatio?: number;
}

export interface AdvancedFillRequest {
  readonly target: AdvancedFillImageDataLike;
  /** 생략하면 target을 기준 이미지로 사용한다. */
  readonly referenceImage?: AdvancedFillImageDataLike;
  readonly referenceMask?: AdvancedFillMaskLike;
  readonly seeds: readonly AdvancedFillSeed[];
  readonly fill: AdvancedFillRgba;
  readonly options?: AdvancedFillOptions;
  /** 함수 또는 AbortSignal 호환 객체. 연산 도중 주기적으로 확인한다. */
  readonly abort?: AdvancedFillAbortLike | (() => boolean);
}

export type AdvancedFillStatus = "applied" | "noop" | "empty" | "leak-guarded" | "aborted";
export type AdvancedFillLeakPhase = "scan" | "adjustment" | null;

export interface AdvancedFillBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AdvancedFillSelectionDiagnostics {
  readonly pixelCount: number;
  readonly areaRatio: number;
  readonly touchesCanvasEdge: boolean;
  readonly bounds: AdvancedFillBounds | null;
}

export interface AdvancedFillDiagnostics {
  readonly status: AdvancedFillStatus;
  readonly width: number;
  readonly height: number;
  readonly referenceSource: "target" | "reference-image";
  readonly requestedSeedCount: number;
  readonly uniqueSeedCount: number;
  readonly acceptedSeedCount: number;
  readonly rejectedSeedCount: number;
  readonly paintedPixelCount: number;
  readonly matched: AdvancedFillSelectionDiagnostics;
  readonly final: AdvancedFillSelectionDiagnostics;
  readonly mask: {
    readonly supplied: boolean;
    readonly mode: AdvancedFillMaskMode;
    readonly threshold: number;
    readonly constrainExpansion: boolean;
  };
  readonly leakGuard: {
    readonly triggered: boolean;
    readonly phase: AdvancedFillLeakPhase;
    readonly maxAreaRatio: number;
    readonly maxPixelCount: number;
  };
  readonly closeGapRadius: number;
  readonly areaAdjustment: number;
}

export interface AdvancedFillResult {
  /** 항상 target과 별개의 버퍼다. 실패·중단 시 target 내용의 완전한 복제본이다. */
  readonly imageData: AdvancedFillImageDataLike;
  /** 면적 팽창/수축 전 영역. 누수 차단 시에는 검사된 하한 영역일 수 있다. */
  readonly matchedMask: Uint8Array;
  /** 실제 칠하기에 사용된 최종 영역. 누수 차단·중단 시에는 모두 0이다. */
  readonly mask: Uint8Array;
  readonly diagnostics: AdvancedFillDiagnostics;
}

/**
 * Softens only the inside pixel ring of a final fill mask. Keeping this DOM-free operation beside
 * the engine lets module workers perform the O(width×height) pass off the browser main thread.
 */
export function softenStudioAdvancedFillEdges(
  output: Uint8ClampedArray,
  original: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  fill: AdvancedFillRgba,
): void {
  if (output.length !== original.length || output.length !== width * height * 4 || mask.length !== width * height) {
    throw new RangeError("Advanced Fill anti-alias buffers do not match their dimensions.");
  }
  const isFilled = (x: number, y: number): boolean =>
    x < 0 || x >= width || y < 0 || y >= height || mask[y * width + x] === 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const position = y * width + x;
      if (!mask[position]) continue;
      const neighbors =
        Number(isFilled(x - 1, y)) +
        Number(isFilled(x + 1, y)) +
        Number(isFilled(x, y - 1)) +
        Number(isFilled(x, y + 1));
      if (neighbors === 4) continue;
      const coverage = 0.625 + neighbors * 0.09375;
      const offset = position * 4;
      const originalAlpha = original[offset + 3]! / 255;
      const fillAlpha = fill[3] / 255;
      const outputAlpha = originalAlpha * (1 - coverage) + fillAlpha * coverage;
      for (let channel = 0; channel < 3; channel++) {
        const premultiplied =
          original[offset + channel]! * originalAlpha * (1 - coverage) +
          fill[channel] * fillAlpha * coverage;
        output[offset + channel] = outputAlpha > 0 ? Math.round(premultiplied / outputAlpha) : 0;
      }
      output[offset + 3] = Math.round(outputAlpha * 255);
    }
  }
}

export const ADVANCED_FILL_DEFAULTS = Object.freeze({
  tolerance: 32,
  matchAlpha: true,
  matchMode: "seed-color" as AdvancedFillMatchMode,
  alphaBoundary: "none" as AdvancedFillAlphaBoundary,
  alphaThreshold: 0,
  maskMode: "allow" as AdvancedFillMaskMode,
  maskThreshold: 0,
  contiguous: true,
  connectivity: 4 as AdvancedFillConnectivity,
  closeGapRadius: 0,
  areaAdjustment: 0,
  constrainExpansionToMask: true,
  maxAreaRatio: 0.85,
});

interface NormalizedOptions {
  tolerance: number;
  matchAlpha: boolean;
  matchMode: AdvancedFillMatchMode;
  alphaBoundary: AdvancedFillAlphaBoundary;
  alphaThreshold: number;
  maskMode: AdvancedFillMaskMode;
  maskThreshold: number;
  contiguous: boolean;
  connectivity: AdvancedFillConnectivity;
  closeGapRadius: number;
  areaAdjustment: number;
  constrainExpansionToMask: boolean;
  maxAreaRatio: number;
}

interface NormalizedSeed extends AdvancedFillSeed {
  readonly position: number;
}

interface SeedGroup {
  readonly color: AdvancedFillRgba | null;
  readonly seeds: NormalizedSeed[];
}

type Checkpoint = (force?: boolean) => void;

const ABORTED = Symbol("advanced-fill-aborted");
const CHECKPOINT_INTERVAL_MASK = 4095;

function assertFiniteNumber(value: number, label: string, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${label} must be a finite number between ${min} and ${max}.`);
  }
}

function assertInteger(value: number, label: string, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer between ${min} and ${max}.`);
  }
}

function assertBoolean(value: boolean, label: string): void {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean.`);
}

function validateImageData(image: AdvancedFillImageDataLike, label: string): number {
  if (!image || typeof image !== "object") throw new TypeError(`${label} must be an image-data object.`);
  assertInteger(image.width, `${label}.width`, 1, ADVANCED_FILL_MAX_PIXELS);
  assertInteger(image.height, `${label}.height`, 1, ADVANCED_FILL_MAX_PIXELS);

  const pixelCount = image.width * image.height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > ADVANCED_FILL_MAX_PIXELS) {
    throw new RangeError(`${label} exceeds the ${ADVANCED_FILL_MAX_PIXELS} pixel safety limit.`);
  }
  if (!(image.data instanceof Uint8ClampedArray)) {
    throw new TypeError(`${label}.data must be a Uint8ClampedArray.`);
  }
  if (image.data.length !== pixelCount * 4) {
    throw new RangeError(`${label}.data length must equal width * height * 4.`);
  }
  return pixelCount;
}

function validateMask(mask: AdvancedFillMaskLike, width: number, height: number, pixelCount: number): void {
  if (!mask || typeof mask !== "object") throw new TypeError("referenceMask must be a mask object.");
  if (mask.width !== width || mask.height !== height) {
    throw new RangeError("referenceMask dimensions must match target dimensions.");
  }
  if (!(mask.data instanceof Uint8Array) && !(mask.data instanceof Uint8ClampedArray)) {
    throw new TypeError("referenceMask.data must be a Uint8Array or Uint8ClampedArray.");
  }
  if (mask.data.length !== pixelCount) {
    throw new RangeError("referenceMask.data length must equal width * height.");
  }
}

function normalizeOptions(options: AdvancedFillOptions | undefined): NormalizedOptions {
  const normalized: NormalizedOptions = {
    tolerance: options?.tolerance ?? ADVANCED_FILL_DEFAULTS.tolerance,
    matchAlpha: options?.matchAlpha ?? ADVANCED_FILL_DEFAULTS.matchAlpha,
    matchMode: options?.matchMode ?? ADVANCED_FILL_DEFAULTS.matchMode,
    alphaBoundary: options?.alphaBoundary ?? ADVANCED_FILL_DEFAULTS.alphaBoundary,
    alphaThreshold: options?.alphaThreshold ?? ADVANCED_FILL_DEFAULTS.alphaThreshold,
    maskMode: options?.maskMode ?? ADVANCED_FILL_DEFAULTS.maskMode,
    maskThreshold: options?.maskThreshold ?? ADVANCED_FILL_DEFAULTS.maskThreshold,
    contiguous: options?.contiguous ?? ADVANCED_FILL_DEFAULTS.contiguous,
    connectivity: options?.connectivity ?? ADVANCED_FILL_DEFAULTS.connectivity,
    closeGapRadius: options?.closeGapRadius ?? ADVANCED_FILL_DEFAULTS.closeGapRadius,
    areaAdjustment: options?.areaAdjustment ?? ADVANCED_FILL_DEFAULTS.areaAdjustment,
    constrainExpansionToMask:
      options?.constrainExpansionToMask ?? ADVANCED_FILL_DEFAULTS.constrainExpansionToMask,
    maxAreaRatio: options?.maxAreaRatio ?? ADVANCED_FILL_DEFAULTS.maxAreaRatio,
  };

  assertFiniteNumber(normalized.tolerance, "options.tolerance", 0, 255);
  assertBoolean(normalized.matchAlpha, "options.matchAlpha");
  if (normalized.matchMode !== "seed-color" && normalized.matchMode !== "boundary-only") {
    throw new TypeError('options.matchMode must be "seed-color" or "boundary-only".');
  }
  if (
    normalized.alphaBoundary !== "none" &&
    normalized.alphaBoundary !== "transparent" &&
    normalized.alphaBoundary !== "visible"
  ) {
    throw new TypeError('options.alphaBoundary must be "none", "transparent", or "visible".');
  }
  assertInteger(normalized.alphaThreshold, "options.alphaThreshold", 0, 255);
  if (normalized.maskMode !== "allow" && normalized.maskMode !== "block") {
    throw new TypeError('options.maskMode must be "allow" or "block".');
  }
  assertInteger(normalized.maskThreshold, "options.maskThreshold", 0, 255);
  assertBoolean(normalized.contiguous, "options.contiguous");
  if (normalized.connectivity !== 4 && normalized.connectivity !== 8) {
    throw new RangeError("options.connectivity must be 4 or 8.");
  }
  assertInteger(
    normalized.closeGapRadius,
    "options.closeGapRadius",
    0,
    ADVANCED_FILL_MAX_CLOSE_GAP_RADIUS,
  );
  assertFiniteNumber(
    normalized.areaAdjustment,
    "options.areaAdjustment",
    -ADVANCED_FILL_MAX_AREA_ADJUSTMENT,
    ADVANCED_FILL_MAX_AREA_ADJUSTMENT,
  );
  // UI가 제공하는 0.5px 단계를 허용하되 이진 픽셀 마스크에서는 대칭적으로 확정한다.
  normalized.areaAdjustment =
    Math.sign(normalized.areaAdjustment) * Math.round(Math.abs(normalized.areaAdjustment));
  assertBoolean(normalized.constrainExpansionToMask, "options.constrainExpansionToMask");
  assertFiniteNumber(normalized.maxAreaRatio, "options.maxAreaRatio", Number.MIN_VALUE, 1);
  return normalized;
}

function normalizeFill(fill: AdvancedFillRgba): AdvancedFillRgba {
  if (!Array.isArray(fill) || fill.length !== 4) {
    throw new TypeError("fill must contain exactly four RGBA channels.");
  }
  for (let channel = 0; channel < 4; channel++) {
    assertInteger(fill[channel]!, `fill[${channel}]`, 0, 255);
  }
  return [fill[0], fill[1], fill[2], fill[3]];
}

function normalizeSeeds(seeds: readonly AdvancedFillSeed[], width: number, height: number): NormalizedSeed[] {
  if (!Array.isArray(seeds) || seeds.length === 0) {
    throw new RangeError("seeds must contain at least one point.");
  }

  const unique = new Map<number, NormalizedSeed>();
  for (let index = 0; index < seeds.length; index++) {
    const seed = seeds[index];
    if (!seed || typeof seed !== "object") throw new TypeError(`seeds[${index}] must be a point.`);
    assertInteger(seed.x, `seeds[${index}].x`, 0, width - 1);
    assertInteger(seed.y, `seeds[${index}].y`, 0, height - 1);
    const position = seed.y * width + seed.x;
    if (!unique.has(position)) unique.set(position, { x: seed.x, y: seed.y, position });
  }
  return [...unique.values()];
}

function createCheckpoint(abort: AdvancedFillRequest["abort"]): Checkpoint {
  let calls = 0;
  const isAborted =
    typeof abort === "function" ? abort : abort ? () => abort.aborted === true : () => false;
  return (force = false) => {
    calls++;
    if ((force || (calls & CHECKPOINT_INTERVAL_MASK) === 0) && isAborted()) throw ABORTED;
  };
}

function cloneImageData(image: AdvancedFillImageDataLike): AdvancedFillImageDataLike {
  return { data: image.data.slice(), width: image.width, height: image.height };
}

function runAcceleratedMorphologyPass(
  input: Uint8Array,
  width: number,
  height: number,
  operation: StudioMaskMorphologyOperation,
  outsideIsOne: boolean,
  checkpoint: Checkpoint,
): Uint8Array {
  checkpoint(true);
  const result = ADVANCED_FILL_MORPHOLOGY.process(
    input,
    width,
    height,
    operation,
  );
  checkpoint(true);
  if (!result.ok) {
    throw new Error(`Advanced Fill morphology backend failed: ${result.reason}`, {
      cause: result.cause,
    });
  }

  // The 3×3 kernel ignores samples outside the canvas. That is equivalent to
  // zero-padding for dilation and one-padding for erosion. Explicit zero-padding
  // erosion additionally clears its one-pixel boundary.
  if (operation === "erode" && !outsideIsOne) {
    result.pixels.fill(0, 0, width);
    if (height > 1) {
      result.pixels.fill(0, (height - 1) * width, height * width);
    }
    for (let y = 1; y < height - 1; y += 1) {
      const row = y * width;
      result.pixels[row] = 0;
      if (width > 1) result.pixels[row + width - 1] = 0;
    }
  }
  return result.pixels;
}

/** O(width*height) 정사각 커널 팽창. */
function dilateSquare(
  input: Uint8Array,
  width: number,
  height: number,
  radius: number,
  checkpoint: Checkpoint,
): Uint8Array {
  if (radius === 0) return input.slice();
  if (radius === 1) {
    return runAcceleratedMorphologyPass(
      input,
      width,
      height,
      "dilate",
      false,
      checkpoint,
    );
  }
  const horizontal = new Uint8Array(input.length);
  const output = new Uint8Array(input.length);

  for (let y = 0; y < height; y++) {
    checkpoint();
    const row = y * width;
    let count = 0;
    for (let x = 0; x <= Math.min(radius, width - 1); x++) count += input[row + x]!;
    for (let x = 0; x < width; x++) {
      horizontal[row + x] = count > 0 ? 1 : 0;
      const removeX = x - radius;
      const addX = x + radius + 1;
      if (removeX >= 0) count -= input[row + removeX]!;
      if (addX < width) count += input[row + addX]!;
    }
  }

  for (let x = 0; x < width; x++) {
    checkpoint();
    let count = 0;
    for (let y = 0; y <= Math.min(radius, height - 1); y++) count += horizontal[y * width + x]!;
    for (let y = 0; y < height; y++) {
      output[y * width + x] = count > 0 ? 1 : 0;
      const removeY = y - radius;
      const addY = y + radius + 1;
      if (removeY >= 0) count -= horizontal[removeY * width + x]!;
      if (addY < height) count += horizontal[addY * width + x]!;
    }
  }
  return output;
}

/** O(width*height) 정사각 커널 침식. outsideIsOne은 경계 닫기에서만 true로 사용한다. */
function erodeSquare(
  input: Uint8Array,
  width: number,
  height: number,
  radius: number,
  outsideIsOne: boolean,
  checkpoint: Checkpoint,
): Uint8Array {
  if (radius === 0) return input.slice();
  if (radius === 1) {
    return runAcceleratedMorphologyPass(
      input,
      width,
      height,
      "erode",
      outsideIsOne,
      checkpoint,
    );
  }
  const horizontal = new Uint8Array(input.length);
  const output = new Uint8Array(input.length);
  const diameter = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    checkpoint();
    const row = y * width;
    let left = 0;
    let right = Math.min(radius, width - 1);
    let count = 0;
    for (let x = left; x <= right; x++) count += input[row + x]!;
    for (let x = 0; x < width; x++) {
      const inBoundsLength = right - left + 1;
      horizontal[row + x] = count === (outsideIsOne ? inBoundsLength : diameter) ? 1 : 0;
      const nextLeft = Math.max(0, x + 1 - radius);
      const nextRight = Math.min(width - 1, x + 1 + radius);
      while (left < nextLeft) count -= input[row + left++]!;
      while (right < nextRight) count += input[row + ++right]!;
    }
  }

  for (let x = 0; x < width; x++) {
    checkpoint();
    let top = 0;
    let bottom = Math.min(radius, height - 1);
    let count = 0;
    for (let y = top; y <= bottom; y++) count += horizontal[y * width + x]!;
    for (let y = 0; y < height; y++) {
      const inBoundsLength = bottom - top + 1;
      output[y * width + x] = count === (outsideIsOne ? inBoundsLength : diameter) ? 1 : 0;
      const nextTop = Math.max(0, y + 1 - radius);
      const nextBottom = Math.min(height - 1, y + 1 + radius);
      while (top < nextTop) count -= horizontal[top++ * width + x]!;
      while (bottom < nextBottom) count += horizontal[++bottom * width + x]!;
    }
  }
  return output;
}

/** 막힌 영역의 binary closing. 원래 경계는 반드시 보존해 유효 영역을 새로 열지 않는다. */
function closeBlockedMask(
  blocked: Uint8Array,
  width: number,
  height: number,
  radius: number,
  checkpoint: Checkpoint,
): Uint8Array {
  const dilated = dilateSquare(blocked, width, height, radius, checkpoint);
  const closed = erodeSquare(dilated, width, height, radius, true, checkpoint);
  for (let position = 0; position < closed.length; position++) {
    checkpoint();
    if (blocked[position]) closed[position] = 1;
  }
  return closed;
}

function selectionSummary(
  mask: Uint8Array,
  width: number,
  height: number,
  checkpoint?: Checkpoint,
): AdvancedFillSelectionDiagnostics {
  checkpoint?.(true);
  const accelerated = ADVANCED_FILL_MASK_SCANNER.scan({
    mask,
    width,
    height,
  });
  checkpoint?.(true);
  if (!accelerated.ok) {
    throw new Error(`Advanced Fill component-scan backend failed: ${accelerated.reason}`, {
      cause: "cause" in accelerated ? accelerated.cause : undefined,
    });
  }
  const pixelCount = Number(accelerated.scan.foregroundPixelCount);
  const bounds = accelerated.scan.bounds;
  return {
    pixelCount,
    areaRatio: pixelCount / (width * height),
    touchesCanvasEdge: Boolean(
      bounds
      && (
        bounds.minX === 0
        || bounds.minY === 0
        || bounds.maxXExclusive === width
        || bounds.maxYExclusive === height
      )
    ),
    bounds: bounds
      ? {
          x: bounds.minX,
          y: bounds.minY,
          width: bounds.width,
          height: bounds.height,
        }
      : null,
  };
}

function createHardAllowedMasks(
  reference: AdvancedFillImageDataLike,
  referenceMask: AdvancedFillMaskLike | undefined,
  options: NormalizedOptions,
  checkpoint: Checkpoint,
): { hardAllowed: Uint8Array; maskAllowed: Uint8Array | null } {
  const pixelCount = reference.width * reference.height;
  const hardAllowed = new Uint8Array(pixelCount);
  const maskAllowed = referenceMask ? new Uint8Array(pixelCount) : null;

  for (let position = 0; position < pixelCount; position++) {
    checkpoint();
    let allowedByMask = true;
    if (referenceMask) {
      const marked = referenceMask.data[position]! > options.maskThreshold;
      allowedByMask = options.maskMode === "allow" ? marked : !marked;
      maskAllowed![position] = allowedByMask ? 1 : 0;
    }

    const alpha = reference.data[position * 4 + 3]!;
    const alphaBlocks =
      options.alphaBoundary === "transparent"
        ? alpha <= options.alphaThreshold
        : options.alphaBoundary === "visible"
          ? alpha > options.alphaThreshold
          : false;
    hardAllowed[position] = allowedByMask && !alphaBlocks ? 1 : 0;
  }
  return { hardAllowed, maskAllowed };
}

function groupSeeds(
  seeds: readonly NormalizedSeed[],
  reference: AdvancedFillImageDataLike,
  hardAllowed: Uint8Array,
  matchMode: AdvancedFillMatchMode,
): { groups: SeedGroup[]; acceptedSeedCount: number; rejectedSeedCount: number } {
  const groups = new Map<string, SeedGroup>();
  let acceptedSeedCount = 0;
  let rejectedSeedCount = 0;

  for (const seed of seeds) {
    if (!hardAllowed[seed.position]) {
      rejectedSeedCount++;
      continue;
    }
    acceptedSeedCount++;
    const offset = seed.position * 4;
    const color: AdvancedFillRgba = [
      reference.data[offset]!,
      reference.data[offset + 1]!,
      reference.data[offset + 2]!,
      reference.data[offset + 3]!,
    ];
    const key = matchMode === "boundary-only" ? "boundary-only" : color.join(",");
    const existing = groups.get(key);
    if (existing) {
      existing.seeds.push(seed);
    } else {
      groups.set(key, { color: matchMode === "boundary-only" ? null : color, seeds: [seed] });
    }
  }
  return { groups: [...groups.values()], acceptedSeedCount, rejectedSeedCount };
}

function createCandidateMask(
  group: SeedGroup,
  reference: AdvancedFillImageDataLike,
  hardAllowed: Uint8Array,
  options: NormalizedOptions,
  checkpoint: Checkpoint,
): Uint8Array {
  const candidate = new Uint8Array(hardAllowed.length);
  const channels = options.matchAlpha ? 4 : 3;
  const maximumDistanceSquared = options.tolerance * options.tolerance * channels;

  for (let position = 0; position < candidate.length; position++) {
    checkpoint();
    if (!hardAllowed[position]) continue;
    if (!group.color) {
      candidate[position] = 1;
      continue;
    }
    const offset = position * 4;
    let distanceSquared = 0;
    for (let channel = 0; channel < channels; channel++) {
      const difference = reference.data[offset + channel]! - group.color[channel]!;
      distanceSquared += difference * difference;
    }
    if (distanceSquared <= maximumDistanceSquared) candidate[position] = 1;
  }

  if (options.closeGapRadius > 0) {
    const blocked = new Uint8Array(candidate.length);
    for (let position = 0; position < candidate.length; position++) {
      checkpoint();
      blocked[position] = candidate[position] ? 0 : 1;
    }
    const closedBlocked = closeBlockedMask(
      blocked,
      reference.width,
      reference.height,
      options.closeGapRadius,
      checkpoint,
    );
    for (let position = 0; position < candidate.length; position++) {
      checkpoint();
      candidate[position] = closedBlocked[position] ? 0 : 1;
    }
    // 경계 가까이에 찍은 정상 시드까지 closing이 지워도 시드 자체는 고립된 시작점으로 유지한다.
    for (const seed of group.seeds) candidate[seed.position] = 1;
  }
  return candidate;
}

interface ScanResult {
  readonly matchedMask: Uint8Array;
  readonly pixelCount: number;
  readonly leakGuardTriggered: boolean;
}

function scanGroups(
  groups: readonly SeedGroup[],
  reference: AdvancedFillImageDataLike,
  hardAllowed: Uint8Array,
  options: NormalizedOptions,
  maximumPixelCount: number,
  checkpoint: Checkpoint,
): ScanResult {
  const width = reference.width;
  const height = reference.height;
  const pixelCount = width * height;
  const matchedMask = new Uint8Array(pixelCount);
  const queue = options.contiguous ? new Uint32Array(pixelCount) : null;
  let matchedPixelCount = 0;

  for (const group of groups) {
    checkpoint(true);
    const candidate = createCandidateMask(group, reference, hardAllowed, options, checkpoint);
    if (!options.contiguous) {
      for (let position = 0; position < pixelCount; position++) {
        checkpoint();
        if (!candidate[position] || matchedMask[position]) continue;
        matchedMask[position] = 1;
        matchedPixelCount++;
        if (matchedPixelCount > maximumPixelCount) {
          return { matchedMask, pixelCount: matchedPixelCount, leakGuardTriggered: true };
        }
      }
      continue;
    }

    const visited = new Uint8Array(pixelCount);
    let head = 0;
    let tail = 0;
    for (const seed of group.seeds) {
      if (!candidate[seed.position] || visited[seed.position]) continue;
      visited[seed.position] = 1;
      queue![tail++] = seed.position;
      if (!matchedMask[seed.position]) {
        matchedMask[seed.position] = 1;
        matchedPixelCount++;
        if (matchedPixelCount > maximumPixelCount) {
          return { matchedMask, pixelCount: matchedPixelCount, leakGuardTriggered: true };
        }
      }
    }

    const enqueue = (position: number) => {
      if (visited[position] || !candidate[position]) return false;
      visited[position] = 1;
      queue![tail++] = position;
      if (!matchedMask[position]) {
        matchedMask[position] = 1;
        matchedPixelCount++;
        if (matchedPixelCount > maximumPixelCount) return true;
      }
      return false;
    };

    while (head < tail) {
      checkpoint();
      const position = queue![head++]!;
      const x = position % width;
      const y = (position / width) | 0;
      if (x > 0 && enqueue(position - 1)) {
        return { matchedMask, pixelCount: matchedPixelCount, leakGuardTriggered: true };
      }
      if (x < width - 1 && enqueue(position + 1)) {
        return { matchedMask, pixelCount: matchedPixelCount, leakGuardTriggered: true };
      }
      if (y > 0 && enqueue(position - width)) {
        return { matchedMask, pixelCount: matchedPixelCount, leakGuardTriggered: true };
      }
      if (y < height - 1 && enqueue(position + width)) {
        return { matchedMask, pixelCount: matchedPixelCount, leakGuardTriggered: true };
      }
      if (options.connectivity === 8) {
        if (x > 0 && y > 0 && enqueue(position - width - 1)) {
          return { matchedMask, pixelCount: matchedPixelCount, leakGuardTriggered: true };
        }
        if (x < width - 1 && y > 0 && enqueue(position - width + 1)) {
          return { matchedMask, pixelCount: matchedPixelCount, leakGuardTriggered: true };
        }
        if (x > 0 && y < height - 1 && enqueue(position + width - 1)) {
          return { matchedMask, pixelCount: matchedPixelCount, leakGuardTriggered: true };
        }
        if (x < width - 1 && y < height - 1 && enqueue(position + width + 1)) {
          return { matchedMask, pixelCount: matchedPixelCount, leakGuardTriggered: true };
        }
      }
    }
  }
  return { matchedMask, pixelCount: matchedPixelCount, leakGuardTriggered: false };
}

interface ResultContext {
  readonly target: AdvancedFillImageDataLike;
  readonly referenceSource: "target" | "reference-image";
  readonly requestedSeedCount: number;
  readonly uniqueSeedCount: number;
  readonly acceptedSeedCount: number;
  readonly rejectedSeedCount: number;
  readonly options: NormalizedOptions;
  readonly referenceMaskSupplied: boolean;
  readonly maximumPixelCount: number;
}

function createResult(
  context: ResultContext,
  status: AdvancedFillStatus,
  imageData: AdvancedFillImageDataLike,
  matchedMask: Uint8Array,
  finalMask: Uint8Array,
  paintedPixelCount: number,
  leakPhase: AdvancedFillLeakPhase,
  checkpoint?: Checkpoint,
): AdvancedFillResult {
  return {
    imageData,
    matchedMask,
    mask: finalMask,
    diagnostics: {
      status,
      width: context.target.width,
      height: context.target.height,
      referenceSource: context.referenceSource,
      requestedSeedCount: context.requestedSeedCount,
      uniqueSeedCount: context.uniqueSeedCount,
      acceptedSeedCount: context.acceptedSeedCount,
      rejectedSeedCount: context.rejectedSeedCount,
      paintedPixelCount,
      matched: selectionSummary(matchedMask, context.target.width, context.target.height, checkpoint),
      final: selectionSummary(finalMask, context.target.width, context.target.height, checkpoint),
      mask: {
        supplied: context.referenceMaskSupplied,
        mode: context.options.maskMode,
        threshold: context.options.maskThreshold,
        constrainExpansion: context.options.constrainExpansionToMask,
      },
      leakGuard: {
        triggered: status === "leak-guarded",
        phase: leakPhase,
        maxAreaRatio: context.options.maxAreaRatio,
        maxPixelCount: context.maximumPixelCount,
      },
      closeGapRadius: context.options.closeGapRadius,
      areaAdjustment: context.options.areaAdjustment,
    },
  };
}

/**
 * 고급 채우기를 원자적으로 실행한다. 반환 status가 applied/noop일 때만 mask가 칠해진 결과를 담는다.
 * leak-guarded/aborted는 imageData를 원본과 같은 내용으로, 최종 mask를 전부 0으로 반환한다.
 */
export function applyAdvancedFill(request: AdvancedFillRequest): AdvancedFillResult {
  if (!request || typeof request !== "object") throw new TypeError("request must be an object.");
  const pixelCount = validateImageData(request.target, "target");
  const reference = request.referenceImage ?? request.target;
  validateImageData(reference, "referenceImage");
  if (reference.width !== request.target.width || reference.height !== request.target.height) {
    throw new RangeError("referenceImage dimensions must match target dimensions.");
  }
  if (request.referenceMask) {
    validateMask(request.referenceMask, request.target.width, request.target.height, pixelCount);
  }

  const options = normalizeOptions(request.options);
  const fill = normalizeFill(request.fill);
  const seeds = normalizeSeeds(request.seeds, request.target.width, request.target.height);
  const checkpoint = createCheckpoint(request.abort);
  const maximumPixelCount = Math.floor(pixelCount * options.maxAreaRatio);
  let acceptedSeedCount = 0;
  let rejectedSeedCount = 0;

  const resultContext = (): ResultContext => ({
    target: request.target,
    referenceSource: request.referenceImage ? "reference-image" : "target",
    requestedSeedCount: request.seeds.length,
    uniqueSeedCount: seeds.length,
    acceptedSeedCount,
    rejectedSeedCount,
    options,
    referenceMaskSupplied: Boolean(request.referenceMask),
    maximumPixelCount,
  });

  try {
    checkpoint(true);
    const { hardAllowed, maskAllowed } = createHardAllowedMasks(
      reference,
      request.referenceMask,
      options,
      checkpoint,
    );
    const grouped = groupSeeds(seeds, reference, hardAllowed, options.matchMode);
    acceptedSeedCount = grouped.acceptedSeedCount;
    rejectedSeedCount = grouped.rejectedSeedCount;
    const scan = scanGroups(
      grouped.groups,
      reference,
      hardAllowed,
      options,
      maximumPixelCount,
      checkpoint,
    );

    if (scan.leakGuardTriggered) {
      return createResult(
        resultContext(),
        "leak-guarded",
        cloneImageData(request.target),
        scan.matchedMask,
        new Uint8Array(pixelCount),
        0,
        "scan",
        checkpoint,
      );
    }

    if (scan.pixelCount === 0) {
      const empty = new Uint8Array(pixelCount);
      return createResult(
        resultContext(),
        "empty",
        cloneImageData(request.target),
        scan.matchedMask,
        empty,
        0,
        null,
        checkpoint,
      );
    }

    let finalMask: Uint8Array = scan.matchedMask.slice();
    if (options.areaAdjustment > 0) {
      finalMask = dilateSquare(
        finalMask,
        request.target.width,
        request.target.height,
        options.areaAdjustment,
        checkpoint,
      );
      if (maskAllowed && options.constrainExpansionToMask) {
        for (let position = 0; position < pixelCount; position++) {
          checkpoint();
          if (!maskAllowed[position]) finalMask[position] = 0;
        }
      }
    } else if (options.areaAdjustment < 0) {
      finalMask = erodeSquare(
        finalMask,
        request.target.width,
        request.target.height,
        -options.areaAdjustment,
        false,
        checkpoint,
      );
    }

    let finalPixelCount = 0;
    for (let position = 0; position < pixelCount; position++) {
      checkpoint();
      if (finalMask[position]) finalPixelCount++;
      if (finalPixelCount > maximumPixelCount) {
        return createResult(
          resultContext(),
          "leak-guarded",
          cloneImageData(request.target),
          scan.matchedMask,
          new Uint8Array(pixelCount),
          0,
          "adjustment",
          checkpoint,
        );
      }
    }

    if (finalPixelCount === 0) {
      return createResult(
        resultContext(),
        "empty",
        cloneImageData(request.target),
        scan.matchedMask,
        finalMask,
        0,
        null,
        checkpoint,
      );
    }

    const imageData = cloneImageData(request.target);
    let paintedPixelCount = 0;
    for (let position = 0; position < pixelCount; position++) {
      checkpoint();
      if (!finalMask[position]) continue;
      const offset = position * 4;
      if (
        imageData.data[offset] !== fill[0] ||
        imageData.data[offset + 1] !== fill[1] ||
        imageData.data[offset + 2] !== fill[2] ||
        imageData.data[offset + 3] !== fill[3]
      ) {
        paintedPixelCount++;
      }
      imageData.data[offset] = fill[0];
      imageData.data[offset + 1] = fill[1];
      imageData.data[offset + 2] = fill[2];
      imageData.data[offset + 3] = fill[3];
    }
    checkpoint(true);

    return createResult(
      resultContext(),
      paintedPixelCount > 0 ? "applied" : "noop",
      imageData,
      scan.matchedMask,
      finalMask,
      paintedPixelCount,
      null,
      checkpoint,
    );
  } catch (error) {
    if (error !== ABORTED) throw error;
    const empty = new Uint8Array(pixelCount);
    return createResult(
      resultContext(),
      "aborted",
      cloneImageData(request.target),
      empty,
      empty.slice(),
      0,
      null,
    );
  }
}
