/**
 * Concrete lazy adapter for p5.brush's standalone runtime.
 *
 * p5.brush keeps module-global brush, field, transform and renderer state.
 * Consequently every invocation is serialized across all adapter instances,
 * rendered into a private Worker-owned OffscreenCanvas, copied to top-left
 * RGBA byte order, and reset before another job may enter the runtime.
 */

import {
  estimateStudioProceduralArtisticBrushRasterMemory,
  type StudioProceduralArtisticBrushAdapter,
  type StudioProceduralArtisticBrushAdapterInput,
  type StudioProceduralArtisticBrushAdapterLoader,
  type StudioProceduralArtisticBrushAdapterOutput,
  type StudioProceduralArtisticBrushCapability,
  type StudioProceduralArtisticBrushParameter,
} from "../studio-procedural-artistic-brush-provider";

export const STUDIO_P5_BRUSH_STANDALONE_ADAPTER_VERSION =
  "2.2.1-adapter.7" as const;

export const STUDIO_P5_BRUSH_STANDALONE_CAPABILITIES = Object.freeze([
  "procedural:flow-field",
  "procedural:hatch",
  "procedural:mass",
  "procedural:watercolor-fill",
  "procedural:flat-wash",
  "execution:settled-only",
  "surface:offscreen-canvas",
  "gpu:webgl2",
  "seed:deterministic",
  "authority:none",
] as const satisfies readonly StudioProceduralArtisticBrushCapability[]);

interface P5BrushStandaloneModule {
  readonly RADIANS: "radians";
  load(target: object): void;
  render(): Promise<void> | void;
  clear(...color: unknown[]): void;
  seed(value: number | string): void;
  noiseSeed(value: number | string): void;
  angleMode(mode: "degrees" | "radians"): void;
  push(): void;
  pop(): void;
  translate(x: number, y: number): void;
  box(): string[];
  set(brushName: string, color: string, weight?: number): void;
  noStroke(): void;
  noFill(): void;
  noHatch(): void;
  noMass(): void;
  noField(): void;
  noWash(): void;
  noClip(): void;
  fill(color: string, opacity?: number): void;
  fillBleed(
    strength: number,
    direction?: "out" | "in",
    angle?: number | null,
  ): void;
  fillTexture(
    texture: number,
    border: number,
    scatter?: boolean,
  ): void;
  wash(color: string, opacity?: number): void;
  listFields(): string[];
  field(name: string): void;
  refreshField(time?: number): void;
  spline(
    points: readonly (readonly [number, number, number])[],
    curvature?: number,
  ): unknown;
  hatch(
    distance?: number,
    angle?: number,
    options?: Readonly<{
      rand?: number | false;
      continuous?: boolean;
      gradient?: number | false;
    }>,
  ): void;
  hatchStyle(
    brushName: string,
    color?: string,
    weight?: number,
  ): void;
  mass(
    brushName: string,
    color: string,
    options?: Readonly<{
      precision?: number;
      strength?: number;
      gradient?: number;
      outline?: boolean;
    }>,
  ): void;
  polygon(
    points: readonly (readonly [number, number, number?])[],
  ): unknown;
}

interface WebGl2Readback {
  readonly DITHER: number;
  readonly FRAMEBUFFER: number;
  readonly PACK_ALIGNMENT: number;
  readonly RGBA: number;
  readonly UNSIGNED_BYTE: number;
  bindFramebuffer(target: number, framebuffer: null): void;
  disable(capability: number): void;
  pixelStorei(parameter: number, value: number): void;
  readPixels(
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    destination: Uint8Array,
  ): void;
  finish(): void;
}

export interface StudioP5BrushStandaloneEnvironment {
  readonly isDedicatedWorkerScope: () => boolean;
  readonly isOffscreenCanvas: (value: unknown) => boolean;
  readonly isWebGl2Context: (value: unknown) => boolean;
}

export interface StudioP5BrushStandaloneAdapterLoaderOptions {
  readonly importStandalone?: () => Promise<unknown>;
  readonly environment?: StudioP5BrushStandaloneEnvironment;
}

const REQUIRED_FUNCTION_EXPORTS = [
  "load",
  "render",
  "clear",
  "seed",
  "noiseSeed",
  "angleMode",
  "push",
  "pop",
  "translate",
  "box",
  "set",
  "noStroke",
  "noFill",
  "noHatch",
  "noMass",
  "noField",
  "noWash",
  "noClip",
  "fill",
  "fillBleed",
  "fillTexture",
  "wash",
  "listFields",
  "field",
  "refreshField",
  "spline",
  "hatch",
  "hatchStyle",
  "mass",
  "polygon",
] as const;
const COLOR_PATTERN =
  /^(?:#[0-9a-f]{3,8}|rgba?\([^)]{1,96}\)|[a-z]{1,48})$/iu;
const P5_BRUSH_BOOTSTRAP_SEED = 0x7055_b205;

let globalImportTail: Promise<void> = Promise.resolve();
let globalRuntimeTail: Promise<void> = Promise.resolve();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function defaultIsDedicatedWorkerScope(): boolean {
  try {
    return typeof document === "undefined"
      && Object.getPrototypeOf(globalThis)?.constructor?.name
        === "DedicatedWorkerGlobalScope";
  } catch {
    return false;
  }
}

function globalConstructor(name: string): (new (...args: never[]) => object) | null {
  const candidate = (globalThis as unknown as Record<string, unknown>)[name];
  return typeof candidate === "function"
    ? candidate as new (...args: never[]) => object
    : null;
}

function defaultIsOffscreenCanvas(value: unknown): boolean {
  const Constructor = globalConstructor("OffscreenCanvas");
  return Constructor !== null && value instanceof Constructor;
}

function defaultIsWebGl2Context(value: unknown): boolean {
  const Constructor = globalConstructor("WebGL2RenderingContext");
  return Constructor !== null && value instanceof Constructor;
}

const DEFAULT_ENVIRONMENT: StudioP5BrushStandaloneEnvironment = Object.freeze({
  isDedicatedWorkerScope: defaultIsDedicatedWorkerScope,
  isOffscreenCanvas: defaultIsOffscreenCanvas,
  isWebGl2Context: defaultIsWebGl2Context,
});

async function importP5BrushStandalone(): Promise<unknown> {
  return import("p5.brush/standalone");
}

function deterministicBootstrapRandom(): () => number {
  let state = P5_BRUSH_BOOTSTRAP_SEED >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/**
 * p5.brush initializes four module-global random/noise generators from
 * Math.random() while its standalone module is evaluated. Request seeding
 * happens later and cannot retroactively normalize any state derived during
 * that evaluation. Dedicated Workers therefore import the module under a
 * short, serialized deterministic entropy window, then restore the host
 * function before returning control to product code.
 */
async function importWithDeterministicBootstrap(
  operation: () => Promise<unknown>,
): Promise<unknown> {
  let release: (() => void) | undefined;
  const previousImport = globalImportTail;
  globalImportTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previousImport;
  try {
    const previousRandom = Math.random;
    Math.random = deterministicBootstrapRandom();
    try {
      return await operation();
    } finally {
      Math.random = previousRandom;
    }
  } finally {
    release?.();
  }
}

function normalizeModule(input: unknown): P5BrushStandaloneModule | null {
  if (!isPlainRecord(input) || input.RADIANS !== "radians") return null;
  if (
    REQUIRED_FUNCTION_EXPORTS.some(
      (name) => typeof input[name] !== "function",
    )
  ) return null;
  return input as unknown as P5BrushStandaloneModule;
}

function abortError(): DOMException {
  return new DOMException("Procedural artistic render aborted.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

async function withGlobalRuntimeLock<T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> {
  let release: (() => void) | undefined;
  const previous = globalRuntimeTail;
  globalRuntimeTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    throwIfAborted(signal);
    return await operation();
  } finally {
    release?.();
  }
}

function parameter(
  parameters: Readonly<
    Record<string, StudioProceduralArtisticBrushParameter>
  >,
  key: string,
): StudioProceduralArtisticBrushParameter | undefined {
  return parameters[key];
}

function numberParameter(
  parameters: Readonly<
    Record<string, StudioProceduralArtisticBrushParameter>
  >,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const candidate = parameter(parameters, key);
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? Math.max(minimum, Math.min(maximum, candidate))
    : fallback;
}

function booleanParameter(
  parameters: Readonly<
    Record<string, StudioProceduralArtisticBrushParameter>
  >,
  key: string,
  fallback: boolean,
): boolean {
  const candidate = parameter(parameters, key);
  return typeof candidate === "boolean" ? candidate : fallback;
}

function stringParameter(
  parameters: Readonly<
    Record<string, StudioProceduralArtisticBrushParameter>
  >,
  key: string,
  fallback: string,
): string {
  const candidate = parameter(parameters, key);
  return typeof candidate === "string" ? candidate : fallback;
}

function colorParameter(
  parameters: Readonly<
    Record<string, StudioProceduralArtisticBrushParameter>
  >,
  fallback: string,
): string {
  const candidate = stringParameter(parameters, "color", fallback).trim();
  if (!COLOR_PATTERN.test(candidate)) {
    throw new TypeError("Unsupported artistic brush color.");
  }
  return candidate;
}

function opacityByteParameter(
  parameters: Readonly<
    Record<string, StudioProceduralArtisticBrushParameter>
  >,
  fallback: number,
): number {
  const normalized = numberParameter(
    parameters,
    "opacity",
    fallback,
    0,
    1,
  );
  return Math.round(normalized * 254) + 1;
}

function assertAvailable(
  values: readonly string[],
  candidate: string,
  kind: "brush" | "field",
): void {
  if (!values.includes(candidate)) {
    throw new TypeError(`Unknown p5.brush ${kind}: ${candidate}`);
  }
}

function readTopLeftRgbaInPlace(
  gl: WebGl2Readback,
  width: number,
  height: number,
): Uint8Array {
  const rowBytes = width * 4;
  const pixels = new Uint8Array(rowBytes * height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  gl.finish();
  gl.readPixels(
    0,
    0,
    width,
    height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels,
  );
  const rowScratch = new Uint8Array(rowBytes);
  const rowPairs = Math.floor(height / 2);
  for (let topRow = 0; topRow < rowPairs; topRow += 1) {
    const bottomRow = height - topRow - 1;
    const topOffset = topRow * rowBytes;
    const bottomOffset = bottomRow * rowBytes;
    rowScratch.set(pixels.subarray(topOffset, topOffset + rowBytes));
    pixels.copyWithin(topOffset, bottomOffset, bottomOffset + rowBytes);
    pixels.set(rowScratch, bottomOffset);
  }
  return pixels;
}

/**
 * WebGL enables dithering by default. That is useful for display surfaces, but
 * its sub-LSB perturbation is implementation-defined and feeds back through
 * p5.brush's repeated spectral fill passes. Linux SwiftShader can consequently
 * produce different canonical RGBA bytes for an otherwise identical seeded
 * watercolor render. The private settled-output surface is an export target,
 * not a display target, so disable dithering before p5.brush allocates or draws
 * any renderer-owned resources.
 */
function enforceCanonicalWebGlState(gl: WebGl2Readback): void {
  gl.disable(gl.DITHER);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
}

function resetStandaloneState(runtime: P5BrushStandaloneModule): void {
  runtime.noClip();
  runtime.noField();
  runtime.noMass();
  runtime.noHatch();
  runtime.noFill();
  runtime.noWash();
  runtime.noStroke();
  runtime.angleMode(runtime.RADIANS);
  runtime.seed(0);
  runtime.noiseSeed(0);
}

function renderFlowField(
  runtime: P5BrushStandaloneModule,
  input: StudioProceduralArtisticBrushAdapterInput,
): StudioProceduralArtisticBrushCapability {
  const parameters = input.plan.parameters;
  const brush = stringParameter(parameters, "brush", "HB");
  const field = stringParameter(parameters, "field", "waves");
  assertAvailable(runtime.box(), brush, "brush");
  assertAvailable(runtime.listFields(), field, "field");
  runtime.noFill();
  runtime.noHatch();
  runtime.noMass();
  runtime.set(
    brush,
    colorParameter(parameters, "#202124"),
    numberParameter(parameters, "weight", 1, 0.05, 64),
  );
  runtime.field(field);
  runtime.refreshField(
    numberParameter(parameters, "fieldTime", 0, -1_000_000, 1_000_000),
  );
  const points = input.plan.samples.map(
    (sample) => [
      sample.x,
      sample.y,
      Math.max(0.01, sample.pressure),
    ] as const,
  );
  if (points.length < 2) {
    throw new TypeError("Flow-field rendering requires at least two samples.");
  }
  runtime.spline(
    points,
    numberParameter(parameters, "curvature", 0.5, 0, 1),
  );
  return "procedural:flow-field";
}

function polygonPoints(
  input: StudioProceduralArtisticBrushAdapterInput,
): readonly (readonly [number, number, number])[] {
  if (input.plan.samples.length < 3) {
    throw new TypeError("Artistic polygon rendering requires three samples.");
  }
  return input.plan.samples.map(
    (sample) => [
      sample.x,
      sample.y,
      Math.max(0.01, sample.pressure),
    ] as const,
  );
}

function renderHatch(
  runtime: P5BrushStandaloneModule,
  input: StudioProceduralArtisticBrushAdapterInput,
): StudioProceduralArtisticBrushCapability {
  const parameters = input.plan.parameters;
  const brush = stringParameter(parameters, "brush", "pen");
  assertAvailable(runtime.box(), brush, "brush");
  runtime.noStroke();
  runtime.noFill();
  runtime.noMass();
  runtime.hatch(
    numberParameter(parameters, "distance", 5, 0.1, 2_048),
    numberParameter(parameters, "angle", 45, -360, 360),
    Object.freeze({
      rand: numberParameter(parameters, "randomness", 0, 0, 1),
      continuous: booleanParameter(parameters, "continuous", false),
      gradient: numberParameter(parameters, "gradient", 0, 0, 1),
    }),
  );
  runtime.hatchStyle(
    brush,
    colorParameter(parameters, "#202124"),
    numberParameter(parameters, "weight", 1, 0.05, 64),
  );
  runtime.polygon(polygonPoints(input));
  return "procedural:hatch";
}

function renderMass(
  runtime: P5BrushStandaloneModule,
  input: StudioProceduralArtisticBrushAdapterInput,
): StudioProceduralArtisticBrushCapability {
  const parameters = input.plan.parameters;
  const brush = stringParameter(parameters, "brush", "charcoal");
  assertAvailable(runtime.box(), brush, "brush");
  runtime.noStroke();
  runtime.noFill();
  runtime.noHatch();
  runtime.mass(
    brush,
    colorParameter(parameters, "#202124"),
    Object.freeze({
      precision: numberParameter(parameters, "precision", 0.5, 0, 1),
      strength: numberParameter(parameters, "strength", 0.8, 0, 1),
      gradient: numberParameter(parameters, "gradient", 0.1, 0, 1),
      outline: booleanParameter(parameters, "outline", false),
    }),
  );
  runtime.polygon(polygonPoints(input));
  return "procedural:mass";
}

function renderWatercolorFill(
  runtime: P5BrushStandaloneModule,
  input: StudioProceduralArtisticBrushAdapterInput,
): StudioProceduralArtisticBrushCapability {
  const parameters = input.plan.parameters;
  runtime.noStroke();
  runtime.noHatch();
  runtime.noMass();
  runtime.noWash();
  runtime.noField();
  runtime.fill(
    colorParameter(parameters, "#2563eb"),
    opacityByteParameter(parameters, 0.72),
  );
  runtime.fillBleed(
    numberParameter(parameters, "strength", 0.3, 0, 1),
    "out",
    numberParameter(parameters, "angle", 0, -Math.PI * 2, Math.PI * 2),
  );
  runtime.fillTexture(
    numberParameter(parameters, "density", 0.6, 0, 1),
    0.4,
    true,
  );
  runtime.polygon(polygonPoints(input));
  return "procedural:watercolor-fill";
}

function renderFlatWash(
  runtime: P5BrushStandaloneModule,
  input: StudioProceduralArtisticBrushAdapterInput,
): StudioProceduralArtisticBrushCapability {
  const parameters = input.plan.parameters;
  runtime.noStroke();
  runtime.noFill();
  runtime.noHatch();
  runtime.noMass();
  runtime.noField();
  runtime.wash(
    colorParameter(parameters, "#2563eb"),
    opacityByteParameter(parameters, 0.72),
  );
  runtime.polygon(polygonPoints(input));
  return "procedural:flat-wash";
}

function renderTechnique(
  runtime: P5BrushStandaloneModule,
  input: StudioProceduralArtisticBrushAdapterInput,
): StudioProceduralArtisticBrushCapability {
  switch (input.plan.technique) {
    case "flow-field":
      return renderFlowField(runtime, input);
    case "hatch":
      return renderHatch(runtime, input);
    case "mass":
      return renderMass(runtime, input);
    case "watercolor-fill":
      return renderWatercolorFill(runtime, input);
    case "flat-wash":
      return renderFlatWash(runtime, input);
    case "image-tip":
    case "custom-tip":
      throw new TypeError(
        "Image and custom tips remain fail-closed until the public standalone asset API is integrated.",
      );
  }
}

/**
 * p5.brush lazily initializes technique- and WebGL-context-specific global
 * caches while drawing. A fresh OffscreenCanvas therefore consumes a different
 * amount of seeded randomness on its first draw than on later draws. Execute
 * one discarded pass on every private surface, then reseed and repeat the exact
 * plan so the retained pass always starts from the same warmed runtime state.
 */
async function renderSeededTechniquePass(
  runtime: P5BrushStandaloneModule,
  input: StudioProceduralArtisticBrushAdapterInput,
  signal: AbortSignal,
): Promise<StudioProceduralArtisticBrushCapability> {
  let pushed = false;
  let rendered = false;
  try {
    runtime.seed(input.seed);
    runtime.noiseSeed(input.seed);
    runtime.push();
    pushed = true;
    runtime.translate(-input.width / 2, -input.height / 2);
    throwIfAborted(signal);
    const capability = renderTechnique(runtime, input);
    throwIfAborted(signal);
    await runtime.render();
    rendered = true;
    throwIfAborted(signal);
    return capability;
  } finally {
    if (pushed && !rendered) {
      try {
        await runtime.render();
      } catch {
        // The original pass failure remains authoritative.
      }
    }
    if (pushed) {
      try {
        runtime.pop();
      } catch {
        // The remaining reset operations are still attempted.
      }
    }
    try {
      resetStandaloneState(runtime);
    } catch {
      // The caller clears the private target before reuse or disposal.
    }
  }
}

function readbackContext(
  value: unknown,
  environment: StudioP5BrushStandaloneEnvironment,
): WebGl2Readback | null {
  if (
    !environment.isWebGl2Context(value)
    || typeof value !== "object"
    || value === null
  ) {
    return null;
  }
  const context = value as unknown as Record<string, unknown>;
  if (
    ![
      "bindFramebuffer",
      "disable",
      "pixelStorei",
      "readPixels",
      "finish",
    ].every((name) => typeof context[name] === "function")
    || ![
      "FRAMEBUFFER",
      "DITHER",
      "PACK_ALIGNMENT",
      "RGBA",
      "UNSIGNED_BYTE",
    ].every((name) => typeof context[name] === "number")
  ) return null;
  return value as unknown as WebGl2Readback;
}

function verifySurfaceContext(
  input: StudioProceduralArtisticBrushAdapterInput,
  environment: StudioP5BrushStandaloneEnvironment,
): WebGl2Readback {
  if (!environment.isDedicatedWorkerScope()) {
    throw new TypeError("p5.brush standalone execution requires a Dedicated Worker.");
  }
  if (
    input.surface.kind !== "offscreen-canvas-webgl2"
    || input.surface.executionLocality !== "dedicated-worker"
    || input.surface.transferredFromMainThread !== false
    || input.surface.width !== input.width
    || input.surface.height !== input.height
    || !environment.isOffscreenCanvas(input.surface.canvas)
  ) {
    throw new TypeError("p5.brush standalone requires a private OffscreenCanvas.");
  }
  const canvas = input.surface.canvas as Readonly<{
    width?: unknown;
    height?: unknown;
    getContext?: (
      type: string,
      attributes?: Readonly<Record<string, boolean>>,
    ) => unknown;
  }>;
  if (
    canvas.width !== input.width
    || canvas.height !== input.height
    || typeof canvas.getContext !== "function"
  ) {
    throw new TypeError("OffscreenCanvas dimensions or context API are invalid.");
  }
  const requestedContext = canvas.getContext("webgl2", {
    antialias: false,
    depth: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    stencil: false,
  }) ?? canvas.getContext("webgl2", {
    antialias: false,
    depth: false,
    preserveDrawingBuffer: true,
    stencil: false,
  });
  if (requestedContext !== input.surface.context) {
    throw new TypeError("Surface WebGL2 context identity mismatch.");
  }
  const context = readbackContext(requestedContext, environment);
  if (!context) throw new TypeError("A verified WebGL2 context is required.");
  return context;
}

function createAdapter(
  runtime: P5BrushStandaloneModule,
  environment: StudioP5BrushStandaloneEnvironment,
): StudioProceduralArtisticBrushAdapter {
  let contextAuthority: object | null = null;
  let canvasAuthority: object | null = null;
  let targetLoaded = false;
  return Object.freeze({
    descriptor: Object.freeze({
      id: "p5-brush-standalone-worker",
      version: STUDIO_P5_BRUSH_STANDALONE_ADAPTER_VERSION,
      compatibility: "p5.brush/standalone",
      executionStage: "settled-only",
      executionLocality: "dedicated-worker",
      surface: "offscreen-canvas-webgl2",
      deterministicSeed: true,
      mainSceneAuthority: false,
      capabilities: STUDIO_P5_BRUSH_STANDALONE_CAPABILITIES,
    }),
    async renderSettled(
      input: StudioProceduralArtisticBrushAdapterInput,
      signal: AbortSignal,
    ): Promise<StudioProceduralArtisticBrushAdapterOutput> {
      if (input.stage !== "settled") {
        throw new TypeError("p5.brush adapter only accepts settled strokes.");
      }
      if (
        estimateStudioProceduralArtisticBrushRasterMemory(
          input.width,
          input.height,
          input.plan.technique,
        ) === null
      ) {
        throw new RangeError(
          "p5.brush raster exceeds the bounded resident-memory budget.",
        );
      }
      return withGlobalRuntimeLock(signal, async () => {
        throwIfAborted(signal);
        const gl = verifySurfaceContext(input, environment);
        enforceCanonicalWebGlState(gl);
        if (contextAuthority === null && canvasAuthority === null) {
          contextAuthority = input.surface.context;
          canvasAuthority = input.surface.canvas;
        } else if (
          contextAuthority !== input.surface.context
          || canvasAuthority !== input.surface.canvas
        ) {
          throw new TypeError(
            "A p5.brush standalone adapter is context-affine and cannot "
            + "bind a second OffscreenCanvas WebGL2 context.",
          );
        }
        try {
          if (!targetLoaded) {
            // Bind one verified canvas/context exactly once. Re-running load()
            // replaces the renderer object while p5.brush keeps module-global
            // fill masks and compositor resources, producing a mixed lifetime
            // that is observably non-deterministic on Linux SwiftShader.
            runtime.seed(input.seed);
            runtime.noiseSeed(input.seed);
            runtime.load(input.surface.canvas);
            // Renderer-, mask-, and framebuffer-owned state is initialized
            // lazily. Prime it before the first canonical reset.
            await runtime.render();
            targetLoaded = true;
            throwIfAborted(signal);
          }
          runtime.clear();
          resetStandaloneState(runtime);

          await renderSeededTechniquePass(runtime, input, signal);
          runtime.clear();
          throwIfAborted(signal);

          const capability = await renderSeededTechniquePass(
            runtime,
            input,
            signal,
          );
          const pixels = readTopLeftRgbaInPlace(
            gl,
            input.width,
            input.height,
          );
          throwIfAborted(signal);
          return Object.freeze({
            kind: "studio-procedural-artistic-brush/adapter-output",
            width: input.width,
            height: input.height,
            seed: input.seed,
            backend: "webgl2",
            executionStage: "settled",
            complete: true,
            pixels,
            capabilitiesUsed: Object.freeze([capability]),
          });
        } finally {
          try {
            resetStandaloneState(runtime);
          } catch {
            // The private target is cleared next.
          }
          try {
            runtime.clear();
          } catch {
            // Provider-owned surface disposal remains the final cleanup.
          }
        }
      });
    },
  });
}

export function createStudioP5BrushStandaloneAdapterLoader(
  options: StudioP5BrushStandaloneAdapterLoaderOptions = {},
): StudioProceduralArtisticBrushAdapterLoader {
  const importStandalone =
    options.importStandalone ?? importP5BrushStandalone;
  const environment = options.environment ?? DEFAULT_ENVIRONMENT;
  let adapterPromise:
    | Promise<StudioProceduralArtisticBrushAdapter | null>
    | null = null;
  return () => {
    if (adapterPromise) return adapterPromise;
    adapterPromise = Promise.resolve()
      .then(() => importWithDeterministicBootstrap(importStandalone))
      .then((candidate) => {
        const runtime = normalizeModule(candidate);
        return runtime ? createAdapter(runtime, environment) : null;
      })
      .catch(() => null);
    return adapterPromise;
  };
}
