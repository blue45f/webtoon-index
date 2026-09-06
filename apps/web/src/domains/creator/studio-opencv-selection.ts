/**
 * OpenCV.js smart-selection provider utilities (E16 lane).
 *
 * Pure data-in/data-out helpers for foreground extraction (grabCut), flood
 * masks (floodFill), edge refinement (morphology + Gaussian feather) and
 * mask→PathIR vectorization. The module never touches React, the DOM or a UI
 * surface, so every function is callable from a dedicated worker: load the
 * runtime once with {@link loadOpenCvForSelection} at worker boot, then call
 * the compute functions with typed arrays (optionally passing the loaded
 * runtime explicitly to keep the hot path synchronous-after-await).
 *
 * The OpenCV package is reached through a dynamic import only — a static
 * value import would defeat the bundle lazy-load gate. Every cv.Mat /
 * cv.MatVector created here is registered in one MatScope and deleted in
 * reverse creation order before any result crosses the boundary (canvaskit
 * dispose lesson: a missed delete leaks width*height bytes per call until the
 * wasm heap grows without bound).
 */

import type { CV, Mat } from "@techstark/opencv-js";
import type { PathIR, PathVerbIR } from "@toonspectrum/studio-project-model";

export const STUDIO_OPENCV_SELECTION_VERSION = 1 as const;

export const STUDIO_OPENCV_SELECTION_LIMITS = Object.freeze({
  maxDimension: 8_192,
  maxPixels: 33_554_432,
  maxGrabCutIterations: 16,
  maxFeatherPx: 64,
  maxMorphOpenPx: 64,
  maxTolerance: 255,
  maxContours: 131_072,
} as const);

/** The OpenCV runtime failed to load or is missing a required capability. */
export class OpenCvUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OpenCvUnavailableError";
  }
}

/** An admitted OpenCV operation failed inside the wasm runtime. */
export class StudioOpenCvSelectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StudioOpenCvSelectionError";
  }
}

export interface StudioSelectionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioFloodMaskOptions {
  readonly connectivity?: 4 | 8;
}

export interface StudioMaskRefineOptions {
  readonly featherPx?: number;
  readonly morphOpen?: number;
}

export interface StudioSelectionPathArtifact {
  /**
   * Subpaths use pixel-center coordinates (x + 0.5, y + 0.5) in scene space.
   * Holes are emitted as sibling subpaths — render with `fillRule` below.
   */
  readonly path: PathIR;
  readonly fillRule: "evenodd";
  readonly contourCount: number;
  readonly holeCount: number;
}

export interface StudioOpenCvSelectionLoadOptions {
  /**
   * Test/host seam. Production callers omit this so the package stays lazy;
   * an injected runtime is validated but never cached.
   */
  readonly runtimeLoader?: () => unknown | PromiseLike<unknown>;
}

type RgbaBuffer = Uint8Array | Uint8ClampedArray;

const REQUIRED_RUNTIME_FUNCTIONS = [
  "Mat",
  "MatVector",
  "Point",
  "Rect",
  "Scalar",
  "Size",
  "matFromArray",
  "cvtColor",
  "grabCut",
  "floodFill",
  "GaussianBlur",
  "morphologyEx",
  "getStructuringElement",
  "threshold",
  "findContours",
  "approxPolyDP",
  "setRNGSeed",
] as const;

const REQUIRED_RUNTIME_CONSTANTS = [
  "CV_8UC1",
  "CV_8UC4",
  "COLOR_RGBA2RGB",
  "GC_FGD",
  "GC_PR_FGD",
  "GC_INIT_WITH_RECT",
  "FLOODFILL_FIXED_RANGE",
  "FLOODFILL_MASK_ONLY",
  "MORPH_OPEN",
  "MORPH_ELLIPSE",
  "THRESH_BINARY",
  "RETR_CCOMP",
  "CHAIN_APPROX_SIMPLE",
  "BORDER_CONSTANT",
] as const;

let cachedRuntimePromise: Promise<CV> | null = null;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertKnownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`${label} has an unknown field "${key}"`);
    }
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function")
    && value !== null
    && typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * @techstark/opencv-js exposes the emscripten module behind up to two layers
 * of `default` and may hand out a thenable that resolves once the wasm
 * runtime is initialized (same unwrap chain as studio-opencv-image-provider).
 */
async function unwrapRuntimeCandidate(moduleNamespace: unknown): Promise<unknown> {
  let candidate: unknown = moduleNamespace;
  if (
    typeof candidate === "object"
    && candidate !== null
    && "default" in candidate
  ) {
    candidate = (candidate as { default: unknown }).default;
  }
  candidate = await Promise.resolve(candidate);
  if (
    typeof candidate === "object"
    && candidate !== null
    && "default" in candidate
    && !("Mat" in candidate)
  ) {
    candidate = await Promise.resolve((candidate as { default: unknown }).default);
  }
  if (
    typeof candidate === "object"
    && candidate !== null
    && !("Mat" in candidate)
    && "ready" in candidate
    && isThenable((candidate as { ready: unknown }).ready)
  ) {
    await (candidate as { ready: PromiseLike<unknown> }).ready;
  }
  return candidate;
}

function validateSelectionRuntime(candidate: unknown): CV {
  if (typeof candidate !== "object" || candidate === null) {
    throw new OpenCvUnavailableError("OpenCV runtime did not resolve to an object");
  }
  const runtime = candidate as Record<string, unknown>;
  for (const name of REQUIRED_RUNTIME_FUNCTIONS) {
    if (typeof runtime[name] !== "function") {
      throw new OpenCvUnavailableError(
        `OpenCV runtime is missing the required function "${name}"`,
      );
    }
  }
  for (const name of REQUIRED_RUNTIME_CONSTANTS) {
    if (typeof runtime[name] !== "number") {
      throw new OpenCvUnavailableError(
        `OpenCV runtime is missing the required constant "${name}"`,
      );
    }
  }
  return candidate as CV;
}

function toUnavailableError(error: unknown): OpenCvUnavailableError {
  if (error instanceof OpenCvUnavailableError) return error;
  return new OpenCvUnavailableError("OpenCV runtime failed to load", { cause: error });
}

/**
 * Acquires the raw @techstark/opencv-js module.
 *
 * The primary lane is the bundler-analyzable dynamic import (the production
 * browser/worker path — static imports are rejected by the bundle gate).
 * Under Vitest/Vite SSR that lane is poisoned: the package's CommonJS
 * `module.exports` is a live Promise, the SSR interop namespace re-exports
 * its `then`, and dynamic-import promise assimilation then calls
 * Promise.prototype.then on the namespace receiver. The Node-only fallback
 * resolves the same package through createRequire, which hands back the
 * untouched `Promise<CV>` for the shared unwrap chain.
 */
async function importOpenCvModule(): Promise<unknown> {
  try {
    return await import("@techstark/opencv-js");
  } catch (bundlerLaneError) {
    const isNodeRuntime =
      typeof process !== "undefined"
      && typeof process.versions?.node === "string";
    if (!isNodeRuntime) throw bundlerLaneError;
    const nodeModuleSpecifier = "node:module";
    const { createRequire } = (await import(
      /* @vite-ignore */ nodeModuleSpecifier
    )) as typeof import("node:module");
    return createRequire(import.meta.url)("@techstark/opencv-js") as unknown;
  }
}

/**
 * Loads and validates the OpenCV.js runtime. The default package load is
 * dynamic-import based, resolved once and cached module-wide; a failed load
 * clears the cache so a later call can retry. Rejects with
 * {@link OpenCvUnavailableError} when the runtime cannot be produced.
 */
export async function loadOpenCvForSelection(
  options: StudioOpenCvSelectionLoadOptions = {},
): Promise<CV> {
  if (!isPlainRecord(options)) {
    throw new TypeError("loadOpenCvForSelection options must be a plain object");
  }
  assertKnownKeys(options, ["runtimeLoader"], "loadOpenCvForSelection options");
  const loader = options.runtimeLoader;
  if (loader !== undefined) {
    if (typeof loader !== "function") {
      throw new TypeError("runtimeLoader must be a function");
    }
    try {
      return validateSelectionRuntime(await unwrapRuntimeCandidate(await loader()));
    } catch (error) {
      throw toUnavailableError(error);
    }
  }
  cachedRuntimePromise ??= importOpenCvModule()
    .then(unwrapRuntimeCandidate)
    .then(validateSelectionRuntime)
    .catch((error: unknown) => {
      cachedRuntimePromise = null;
      throw toUnavailableError(error);
    });
  return cachedRuntimePromise;
}

interface DeletableHandle {
  delete(): void;
}

/**
 * Owns every native handle created inside one operation. Handles are deleted
 * in reverse creation order; a delete failure on the success path is
 * escalated (never swallowed), while cleanup after an operation error is
 * best-effort so the original error survives.
 */
class MatScope {
  private readonly handles: DeletableHandle[] = [];

  own<T extends DeletableHandle>(handle: T): T {
    this.handles.push(handle);
    return handle;
  }

  release(): void {
    let failed = false;
    for (let index = this.handles.length - 1; index >= 0; index -= 1) {
      try {
        this.handles[index]!.delete();
      } catch {
        failed = true;
      }
    }
    this.handles.length = 0;
    if (failed) {
      throw new StudioOpenCvSelectionError(
        "One or more OpenCV native handles failed to delete",
      );
    }
  }

  releaseSilently(): void {
    try {
      this.release();
    } catch {
      // Best-effort cleanup after an operation error: the original error
      // is more actionable than a secondary delete failure.
    }
  }
}

function withMatScope<T>(work: (scope: MatScope) => T): T {
  const scope = new MatScope();
  let result: T;
  try {
    result = work(scope);
  } catch (error) {
    scope.releaseSilently();
    throw error;
  }
  scope.release();
  return result;
}

function describeCvError(runtime: CV, error: unknown): string {
  if (typeof error === "number") {
    const exceptionFromPtr = (
      runtime as unknown as {
        exceptionFromPtr?: (pointer: number) => { msg?: unknown };
      }
    ).exceptionFromPtr;
    if (typeof exceptionFromPtr === "function") {
      try {
        const exception = exceptionFromPtr(error);
        if (typeof exception?.msg === "string" && exception.msg.length > 0) {
          return exception.msg;
        }
      } catch {
        // Fall through to the generic pointer message.
      }
    }
    return `wasm exception pointer ${error}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function asOperationError(operation: string, runtime: CV, error: unknown): Error {
  if (
    error instanceof StudioOpenCvSelectionError
    || error instanceof OpenCvUnavailableError
    || error instanceof TypeError
    || error instanceof RangeError
  ) {
    return error;
  }
  return new StudioOpenCvSelectionError(
    `OpenCV ${operation} failed: ${describeCvError(runtime, error)}`,
    { cause: error },
  );
}

async function resolveRuntime(runtime: CV | undefined): Promise<CV> {
  return runtime ?? loadOpenCvForSelection();
}

function assertSelectionDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new TypeError("width and height must be safe integers");
  }
  if (width <= 0 || height <= 0) {
    throw new RangeError("width and height must be positive");
  }
  const { maxDimension, maxPixels } = STUDIO_OPENCV_SELECTION_LIMITS;
  if (width > maxDimension || height > maxDimension || width * height > maxPixels) {
    throw new RangeError(
      `selection image exceeds the ${maxDimension}px / ${maxPixels}px budget`,
    );
  }
}

function assertRgbaBuffer(rgba: RgbaBuffer, width: number, height: number): void {
  if (!(rgba instanceof Uint8Array) && !(rgba instanceof Uint8ClampedArray)) {
    throw new TypeError("rgba must be a Uint8Array or Uint8ClampedArray");
  }
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new TypeError(
      `rgba length ${rgba.length} does not match ${width}x${height}x4 = ${expected}`,
    );
  }
}

function assertMaskBuffer(mask: RgbaBuffer, width: number, height: number): void {
  if (!(mask instanceof Uint8Array) && !(mask instanceof Uint8ClampedArray)) {
    throw new TypeError("mask must be a Uint8Array or Uint8ClampedArray");
  }
  const expected = width * height;
  if (mask.length !== expected) {
    throw new TypeError(
      `mask length ${mask.length} does not match ${width}x${height} = ${expected}`,
    );
  }
}

function assertMatShape(mat: Mat, rows: number, cols: number, label: string): void {
  if (mat.rows !== rows || mat.cols !== cols) {
    throw new StudioOpenCvSelectionError(
      `${label} has an unexpected shape ${mat.rows}x${mat.cols}, expected ${rows}x${cols}`,
    );
  }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

interface ClampedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function clampGrabCutRect(
  rect: StudioSelectionRect,
  width: number,
  height: number,
): ClampedRect {
  if (!isPlainRecord(rect)) {
    throw new TypeError("rect must be a plain { x, y, width, height } object");
  }
  assertKnownKeys(rect, ["x", "y", "width", "height"], "rect");
  const { x, y, width: rectWidth, height: rectHeight } = rect;
  if (
    typeof x !== "number"
    || typeof y !== "number"
    || typeof rectWidth !== "number"
    || typeof rectHeight !== "number"
    || !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(rectWidth)
    || !Number.isFinite(rectHeight)
  ) {
    throw new TypeError("rect fields must be finite numbers");
  }
  const x0 = clampInt(Math.floor(x), 0, width);
  const y0 = clampInt(Math.floor(y), 0, height);
  const x1 = clampInt(Math.ceil(x + rectWidth), 0, width);
  const y1 = clampInt(Math.ceil(y + rectHeight), 0, height);
  const clampedWidth = x1 - x0;
  const clampedHeight = y1 - y0;
  if (clampedWidth < 1 || clampedHeight < 1) {
    throw new RangeError("rect does not overlap the image");
  }
  if (
    x0 === 0
    && y0 === 0
    && clampedWidth === width
    && clampedHeight === height
  ) {
    throw new RangeError(
      "rect must leave at least one background pixel outside it (grabCut needs background samples)",
    );
  }
  return { x: x0, y: y0, width: clampedWidth, height: clampedHeight };
}

/**
 * Runs cv.grabCut with rect initialization and returns a binary foreground
 * mask (255 = GC_FGD/GC_PR_FGD, 0 = background), one byte per pixel.
 *
 * The RNG seed is pinned before each run so identical inputs produce
 * identical masks. The rect is clamped into the image but must leave at
 * least one background pixel, otherwise grabCut has no background samples.
 */
export async function computeGrabCutMask(
  rgba: RgbaBuffer,
  width: number,
  height: number,
  rect: StudioSelectionRect,
  iterations = 3,
  runtime?: CV,
): Promise<Uint8Array> {
  assertSelectionDimensions(width, height);
  assertRgbaBuffer(rgba, width, height);
  const clamped = clampGrabCutRect(rect, width, height);
  if (!Number.isSafeInteger(iterations)) {
    throw new TypeError("iterations must be a safe integer");
  }
  if (
    iterations < 1
    || iterations > STUDIO_OPENCV_SELECTION_LIMITS.maxGrabCutIterations
  ) {
    throw new RangeError(
      `iterations must be between 1 and ${STUDIO_OPENCV_SELECTION_LIMITS.maxGrabCutIterations}`,
    );
  }
  const cv = await resolveRuntime(runtime);
  try {
    return withMatScope((scope) => {
      const source = scope.own(cv.matFromArray(height, width, cv.CV_8UC4, rgba));
      const rgb = scope.own(new cv.Mat());
      cv.cvtColor(source, rgb, cv.COLOR_RGBA2RGB);
      const gcMask = scope.own(new cv.Mat());
      const backgroundModel = scope.own(new cv.Mat());
      const foregroundModel = scope.own(new cv.Mat());
      // grabCut seeds its GMMs through kmeans on the global RNG; pinning the
      // seed keeps the mask deterministic for identical inputs.
      cv.setRNGSeed(0);
      cv.grabCut(
        rgb,
        gcMask,
        new cv.Rect(clamped.x, clamped.y, clamped.width, clamped.height),
        backgroundModel,
        foregroundModel,
        iterations,
        cv.GC_INIT_WITH_RECT,
      );
      assertMatShape(gcMask, height, width, "grabCut mask");
      const labels = gcMask.data;
      const output = new Uint8Array(width * height);
      for (let index = 0; index < output.length; index += 1) {
        const label = labels[index];
        output[index] = label === cv.GC_FGD || label === cv.GC_PR_FGD ? 255 : 0;
      }
      return output;
    });
  } catch (error) {
    throw asOperationError("grabCut", cv, error);
  }
}

/**
 * Runs cv.floodFill in mask-only fixed-range mode from the (clamped) seed
 * and returns a binary mask (255 = filled). `tolerance` is the maximal
 * per-channel difference from the seed color (0..255).
 */
export async function computeFloodMask(
  rgba: RgbaBuffer,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  tolerance: number,
  options: StudioFloodMaskOptions = {},
  runtime?: CV,
): Promise<Uint8Array> {
  assertSelectionDimensions(width, height);
  assertRgbaBuffer(rgba, width, height);
  if (
    typeof seedX !== "number"
    || typeof seedY !== "number"
    || !Number.isFinite(seedX)
    || !Number.isFinite(seedY)
  ) {
    throw new TypeError("seedX and seedY must be finite numbers");
  }
  if (
    typeof tolerance !== "number"
    || !Number.isFinite(tolerance)
    || tolerance < 0
    || tolerance > STUDIO_OPENCV_SELECTION_LIMITS.maxTolerance
  ) {
    throw new RangeError(
      `tolerance must be between 0 and ${STUDIO_OPENCV_SELECTION_LIMITS.maxTolerance}`,
    );
  }
  if (!isPlainRecord(options)) {
    throw new TypeError("flood options must be a plain object");
  }
  assertKnownKeys(options, ["connectivity"], "flood options");
  const connectivity = options.connectivity ?? 4;
  if (connectivity !== 4 && connectivity !== 8) {
    throw new TypeError("connectivity must be 4 or 8");
  }
  // Boundary clamp: a seed from a pointer event may land slightly outside
  // the layer; snapping to the nearest edge pixel is the intended UX.
  const seedColumn = clampInt(seedX, 0, width - 1);
  const seedRow = clampInt(seedY, 0, height - 1);
  const cv = await resolveRuntime(runtime);
  try {
    return withMatScope((scope) => {
      const source = scope.own(cv.matFromArray(height, width, cv.CV_8UC4, rgba));
      const rgb = scope.own(new cv.Mat());
      cv.cvtColor(source, rgb, cv.COLOR_RGBA2RGB);
      const maskRows = height + 2;
      const maskCols = width + 2;
      const floodMask = scope.own(
        cv.matFromArray(maskRows, maskCols, cv.CV_8UC1, new Uint8Array(maskRows * maskCols)),
      );
      const flags =
        connectivity
        | (255 << 8)
        | cv.FLOODFILL_FIXED_RANGE
        | cv.FLOODFILL_MASK_ONLY;
      const diff = new cv.Scalar(tolerance, tolerance, tolerance, tolerance);
      cv.floodFill(
        rgb,
        floodMask,
        new cv.Point(seedColumn, seedRow),
        new cv.Scalar(255, 255, 255, 255),
        new cv.Rect(),
        diff,
        diff,
        flags,
      );
      assertMatShape(floodMask, maskRows, maskCols, "flood mask");
      // The flood mask carries a one-pixel border; copy the inner window.
      const padded = floodMask.data;
      const output = new Uint8Array(width * height);
      for (let row = 0; row < height; row += 1) {
        const paddedOffset = (row + 1) * maskCols + 1;
        for (let column = 0; column < width; column += 1) {
          output[row * width + column] = padded[paddedOffset + column] === 255 ? 255 : 0;
        }
      }
      return output;
    });
  } catch (error) {
    throw asOperationError("floodFill", cv, error);
  }
}

/**
 * Refines a selection mask for edge quality: morphological opening removes
 * speckles, then a Gaussian feather softens the boundary into a 0..255 alpha
 * ramp. With both options at zero the input is copied untouched (and the
 * wasm runtime is not loaded at all).
 */
export async function refineMaskEdges(
  mask: RgbaBuffer,
  width: number,
  height: number,
  options: StudioMaskRefineOptions = {},
  runtime?: CV,
): Promise<Uint8Array> {
  assertSelectionDimensions(width, height);
  assertMaskBuffer(mask, width, height);
  if (!isPlainRecord(options)) {
    throw new TypeError("refine options must be a plain object");
  }
  assertKnownKeys(options, ["featherPx", "morphOpen"], "refine options");
  const featherPx = options.featherPx ?? 0;
  const morphOpen = options.morphOpen ?? 0;
  if (
    typeof featherPx !== "number"
    || !Number.isFinite(featherPx)
    || featherPx < 0
    || featherPx > STUDIO_OPENCV_SELECTION_LIMITS.maxFeatherPx
  ) {
    throw new RangeError(
      `featherPx must be between 0 and ${STUDIO_OPENCV_SELECTION_LIMITS.maxFeatherPx}`,
    );
  }
  if (
    typeof morphOpen !== "number"
    || !Number.isSafeInteger(morphOpen)
    || morphOpen < 0
    || morphOpen > STUDIO_OPENCV_SELECTION_LIMITS.maxMorphOpenPx
  ) {
    throw new RangeError(
      `morphOpen must be an integer between 0 and ${STUDIO_OPENCV_SELECTION_LIMITS.maxMorphOpenPx}`,
    );
  }
  if (featherPx === 0 && morphOpen === 0) {
    return new Uint8Array(mask);
  }
  const cv = await resolveRuntime(runtime);
  try {
    return withMatScope((scope) => {
      let current = scope.own(cv.matFromArray(height, width, cv.CV_8UC1, mask));
      if (morphOpen > 0) {
        const kernelSize = morphOpen * 2 + 1;
        const kernel = scope.own(cv.getStructuringElement(
          cv.MORPH_ELLIPSE,
          new cv.Size(kernelSize, kernelSize),
        ));
        const opened = scope.own(new cv.Mat());
        cv.morphologyEx(
          current,
          opened,
          cv.MORPH_OPEN,
          kernel,
          new cv.Point(-1, -1),
          1,
          cv.BORDER_CONSTANT,
        );
        current = opened;
      }
      if (featherPx > 0) {
        // ksize covers ±2σ; the default (reflect) border keeps a selection
        // flush with the canvas edge from feathering inward at that edge.
        const kernelSize = Math.ceil(featherPx * 2) * 2 + 1;
        const feathered = scope.own(new cv.Mat());
        cv.GaussianBlur(
          current,
          feathered,
          new cv.Size(kernelSize, kernelSize),
          featherPx,
          featherPx,
        );
        current = feathered;
      }
      assertMatShape(current, height, width, "refined mask");
      return new Uint8Array(current.data);
    });
  } catch (error) {
    throw asOperationError("mask refine", cv, error);
  }
}

/**
 * Vectorizes a mask into a PathIR: findContours (RETR_CCOMP, two-level
 * hierarchy) then approxPolyDP with `simplifyEps` (0 keeps the raw
 * CHAIN_APPROX_SIMPLE vertices). Outer boundaries and holes are emitted as
 * sibling closed subpaths in pixel-center coordinates; render the fill with
 * the returned "evenodd" rule so holes stay empty. Contours that collapse
 * below three vertices are zero-area specks and carry no fillable region.
 */
export async function maskToPathIR(
  mask: RgbaBuffer,
  width: number,
  height: number,
  simplifyEps = 1,
  runtime?: CV,
): Promise<StudioSelectionPathArtifact> {
  assertSelectionDimensions(width, height);
  assertMaskBuffer(mask, width, height);
  if (
    typeof simplifyEps !== "number"
    || !Number.isFinite(simplifyEps)
    || simplifyEps < 0
  ) {
    throw new RangeError("simplifyEps must be a non-negative finite number");
  }
  const cv = await resolveRuntime(runtime);
  try {
    return withMatScope((scope) => {
      const source = scope.own(cv.matFromArray(height, width, cv.CV_8UC1, mask));
      const binary = scope.own(new cv.Mat());
      cv.threshold(source, binary, 127, 255, cv.THRESH_BINARY);
      const contours = scope.own(new cv.MatVector());
      const hierarchy = scope.own(new cv.Mat());
      cv.findContours(
        binary,
        contours,
        hierarchy,
        cv.RETR_CCOMP,
        cv.CHAIN_APPROX_SIMPLE,
      );
      const totalContours = contours.size();
      if (totalContours > STUDIO_OPENCV_SELECTION_LIMITS.maxContours) {
        throw new StudioOpenCvSelectionError(
          `mask produced ${totalContours} contours, over the ${STUDIO_OPENCV_SELECTION_LIMITS.maxContours} budget`,
        );
      }
      const hierarchyData = hierarchy.data32S;
      const verbs: PathVerbIR[] = [];
      let contourCount = 0;
      let holeCount = 0;
      for (let index = 0; index < totalContours; index += 1) {
        const contour = scope.own(contours.get(index));
        let pointSource = contour;
        if (simplifyEps > 0) {
          const approximated = scope.own(new cv.Mat());
          cv.approxPolyDP(contour, approximated, simplifyEps, true);
          pointSource = approximated;
        }
        const points = pointSource.data32S;
        const pointCount = points.length / 2;
        if (pointCount < 3) continue;
        for (let point = 0; point < pointCount; point += 1) {
          const x = points[point * 2]! + 0.5;
          const y = points[point * 2 + 1]! + 0.5;
          verbs.push(point === 0 ? { v: "M", x, y } : { v: "L", x, y });
        }
        verbs.push({ v: "Z" });
        contourCount += 1;
        // OpenCV hierarchy tuples are [next, previous, firstChild, parent];
        // in RETR_CCOMP a contour with a parent is a hole boundary.
        if (hierarchyData[index * 4 + 3] !== -1) holeCount += 1;
      }
      return Object.freeze({
        path: { verbs },
        fillRule: "evenodd" as const,
        contourCount,
        holeCount,
      });
    });
  } catch (error) {
    throw asOperationError("mask vectorize", cv, error);
  }
}
