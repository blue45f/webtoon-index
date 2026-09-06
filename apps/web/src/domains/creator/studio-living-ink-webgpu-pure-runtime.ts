/**
 * Pure WebGPU/WGSL wet-media field runtime.
 *
 * Replaces the WebGL2 GLSL executor when a GPU device is available: field state
 * lives in storage buffers and the Stam stable-fluid, vorticity-confinement,
 * pressure-projection, pigment/fix/Beer–Lambert passes are WGSL compute kernels
 * from studio-living-ink-wgsl-shaders.ts.
 *
 * Grid split (v2): pigment, water and paper are full resolution; velocity,
 * pressure and curl live on a 1/2…1/8 coarse grid, which is what makes a real
 * 22-sweep incompressibility solve fit in the interactive frame budget.
 */

import {
  canonicalStudioLivingInkDisplayRgba8,
  STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
  STUDIO_LIVING_INK_EXECUTION_LIMITS,
  STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
  studioLivingInkCoarseVelocityGrid,
  studioLivingInkDryWindowSeconds,
  studioLivingInkFluidPlan,
  type StudioLivingInkCoarseVelocityScale,
  type StudioLivingInkExecutionApplied,
  type StudioLivingInkExecutionApplyOptions,
  type StudioLivingInkExecutionApplyResult,
  type StudioLivingInkExecutionCapabilities,
  type StudioLivingInkExecutionConfig,
  type StudioLivingInkExecutionFrame,
  type StudioLivingInkExecutionReceipt,
} from "./studio-living-ink-execution-protocol";
import {
  studioLivingInkChromaBleedMultipliers,
  studioLivingInkDepositionPathLength,
  studioLivingInkMeanMarkRadius,
  studioLivingInkPigmentCoatFactor,
  studioLivingInkPigmentDiffusionRates,
  studioLivingInkPigmentOpticalDensity,
  STUDIO_LIVING_INK_PIGMENT_COAT,
  STUDIO_LIVING_INK_WHITE_GOUACHE_LOAD_GAIN,
  type StudioLivingInkBounds,
  type StudioLivingInkOperation,
  type StudioLivingInkSelectionMask,
} from "./studio-living-ink-field";
import { validateStudioLivingInkExecutionConfig } from "./studio-living-ink-webgl2-runtime";
import {
  listStudioLivingInkWgslPassSources,
  STUDIO_LIVING_INK_WGSL_SHADER_REVISION,
  STUDIO_LIVING_INK_WGSL_UNIFORM_WORDS,
  studioLivingInkWgslDisplayModeCode,
  studioLivingInkWgslPassGrid,
  writeStudioLivingInkFieldUniforms,
  type StudioLivingInkWgslPassId,
} from "./studio-living-ink-wgsl-shaders";
import { sha256HexPortable } from "./studio-sha256";

import type { StudioLivingInkDisplayMode } from "./studio-living-ink-gpu-protocol";

/** Splat uniform buffer: two vec2 endpoints, four scalars, two vec4 amounts, two flags + padding. */
const SPLAT_UNIFORM_FLOATS = 20;

/**
 * One capsule deposit, in the shape `SPLAT_FRAGMENT` takes. Field-cell units throughout: the WGSL
 * kernel measures in cells and the GLSL kernel measures in aspect-corrected uv, which is the same
 * space scaled by `1 / fieldHeight`.
 */
interface CapsuleSplat {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly startRadius: number;
  readonly radius: number;
  readonly falloff: number;
  readonly radialVector: boolean;
  readonly startAmount: readonly [number, number, number, number];
  readonly amount: readonly [number, number, number, number];
  readonly maximumBlend: boolean;
  readonly selectionEnabled: boolean;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampRange(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  ).join(",")}}`;
}

function sha256(value: Uint8Array | string): `sha256:${string}` {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return `sha256:${sha256HexPortable(bytes)}`;
}

/**
 * True when a readback carries no presentable surface at all.
 *
 * A valid empty Living Ink surface is transparent white: its alpha says that the page-sized wash
 * layer must not repaint the document, while its colour distinguishes that deliberate clear
 * resolve from an unwritten zeroed storage buffer. Opaque quantized black is valid pigment and must
 * be admitted; only the exact all-channel-zero initialization marker is considered unwritten.
 */
export function studioLivingInkPresentedPixelsAreBlank(
  pixels: Uint8Array | Uint8ClampedArray,
): boolean {
  for (const value of pixels) if (value !== 0) return false;
  return true;
}

/**
 * Watercolour admission floors for the WGSL runtime.
 *
 * These are the product policy in numbers. Handfeel and texture rank above throughput, so a WebGPU
 * user must never be handed a faster backend that draws a worse picture — and "worse" here has a
 * measured meaning, not a vibe. A resolve that has lost the paper model reads exactly 0 texture
 * standard deviation, and one that has lost the optical-density model reads under one code value of
 * ink darkness; the certified GLSL runtime measures ~3.6-4.2 and ~22.8 on the same probe. The
 * floors sit far below the GLSL numbers on purpose: this gate exists to catch a *structurally*
 * broken resolve on any device, not to re-run the visual gate at startup.
 */
export const STUDIO_LIVING_INK_WGSL_ADMISSION = Object.freeze({
  minimumPaperLuminanceStandardDeviation: 1,
  minimumProbeStrokeDarkness: 6,
  /** An untouched strip has to come back as clean page, not as a repainted paper sheet. */
  maximumUntouchedPageLuminanceStandardDeviation: 0.5,
  minimumUntouchedPageLuminance: 254.5,
});

export interface StudioLivingInkWatercolourProof {
  readonly admitted: boolean;
  readonly blank: boolean;
  readonly paperLuminanceStandardDeviation: number;
  readonly probeStrokeDarkness: number;
}

/**
 * Region statistics of the frame **as the page shows it**, i.e. composited over the white document.
 *
 * The resolve emits wash coverage in alpha, so raw RGB outside a wash is the un-premultiply's
 * placeholder rather than a picture. Compositing here keeps every admission number meaning the same
 * thing it did when the surface was an opaque sheet: what the artist would actually see.
 */
function regionLuminance(
  pixels: Uint8Array,
  width: number,
  region: Readonly<{ x: number; y: number; width: number; height: number }>,
): Readonly<{ mean: number; standardDeviation: number }> {
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = (pixels[index + 3] ?? 0) / 255;
      const channel = (offset: number) => 255 + ((pixels[index + offset] ?? 0) - 255) * alpha;
      const luminance = (channel(0) + channel(1) + channel(2)) / 3;
      sum += luminance;
      sumSquares += luminance * luminance;
      count += 1;
    }
  }
  if (count === 0) return { mean: 0, standardDeviation: 0 };
  const mean = sum / count;
  return { mean, standardDeviation: Math.sqrt(Math.max(0, sumSquares / count - mean * mean)) };
}

function unionBounds(
  a: StudioLivingInkBounds | null,
  b: StudioLivingInkBounds,
  width: number,
  height: number,
): StudioLivingInkBounds {
  if (!a) {
    return Object.freeze({
      x: Math.max(0, Math.min(width - 1, Math.floor(b.x))),
      y: Math.max(0, Math.min(height - 1, Math.floor(b.y))),
      width: Math.max(1, Math.min(width, Math.ceil(b.width))),
      height: Math.max(1, Math.min(height, Math.ceil(b.height))),
    });
  }
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.width, b.x + b.width);
  const y1 = Math.max(a.y + a.height, b.y + b.height);
  return Object.freeze({
    x: Math.max(0, Math.floor(x0)),
    y: Math.max(0, Math.floor(y0)),
    width: Math.max(1, Math.ceil(x1 - x0)),
    height: Math.max(1, Math.ceil(y1 - y0)),
  });
}

export class StudioLivingInkWebGpuPureRuntime {
  readonly capabilities: StudioLivingInkExecutionCapabilities;
  readonly webGpuDevice: GPUDevice;
  readonly wgslRevision = STUDIO_LIVING_INK_WGSL_SHADER_REVISION;
  readonly coarseVelocityScale: StudioLivingInkCoarseVelocityScale;

  private readonly device: GPUDevice;
  private readonly config: StudioLivingInkExecutionConfig;
  private readonly canvas: OffscreenCanvas;
  private readonly presentation: OffscreenCanvasRenderingContext2D;
  private readonly pipelines = new Map<StudioLivingInkWgslPassId, GPUComputePipeline>();
  private readonly coarseWidth: number;
  private readonly coarseHeight: number;
  private mobile!: GPUBuffer;
  private mobileScratch!: GPUBuffer;
  private fixed!: GPUBuffer;
  private wet!: GPUBuffer;
  private wetScratch!: GPUBuffer;
  private strokeDeposit!: GPUBuffer;
  private selection!: GPUBuffer;
  private velocity!: GPUBuffer;
  private velocityScratch!: GPUBuffer;
  private curl!: GPUBuffer;
  private pressureA!: GPUBuffer;
  private pressureB!: GPUBuffer;
  private display!: GPUBuffer;
  private uniforms!: GPUBuffer;
  private splatUniforms!: GPUBuffer;
  private readonly splatScratch = new Float32Array(SPLAT_UNIFORM_FLOATS);
  private revision = 0;
  private passCount = 0;
  private disposed = false;
  private dirty: StudioLivingInkBounds | null = null;
  /** Set while a `fix` with `scope: "selection"` is settling; gates the exchange coverage mask. */
  private fixSelectionEnabled = false;
  /**
   * Last deposited ink mark, kept across operations so a batch knows the path length it covers.
   * Product code forwards a stroke as a run of suffix operations, so the distance a batch actually
   * travels includes the gap back to the previous batch's last mark.
   */
  private lastInkMark: Readonly<{ x: number; y: number }> | null = null;

  private constructor(
    device: GPUDevice,
    config: StudioLivingInkExecutionConfig,
    canvas: OffscreenCanvas,
    presentation: OffscreenCanvasRenderingContext2D,
  ) {
    this.device = device;
    this.webGpuDevice = device;
    this.config = Object.freeze({ ...config });
    this.canvas = canvas;
    this.presentation = presentation;
    const coarse = studioLivingInkCoarseVelocityGrid(
      config.fieldWidth,
      config.fieldHeight,
      config.coarseBase,
    );
    this.coarseWidth = coarse.width;
    this.coarseHeight = coarse.height;
    this.coarseVelocityScale = coarse.scale;
    this.capabilities = Object.freeze({
      backend: "webgpu-offscreen-half-float",
      worker: true,
      offscreenCanvas: true,
      webgl2: false,
      webgpu: true,
      halfFloatRenderable: true,
      rgba16Float: true,
      rg16Float: true,
      r16Float: true,
      maximumTextureSize: Math.max(config.fieldWidth, config.fieldHeight, 8192),
      pressureIterations: Object.freeze({
        interactive: STUDIO_LIVING_INK_EXECUTION_LIMITS.interactivePressureIterations,
        settle: STUDIO_LIVING_INK_EXECUTION_LIMITS.settlePressureIterations,
      }),
    });
  }

  static async tryCreate(
    config: StudioLivingInkExecutionConfig,
  ): Promise<StudioLivingInkWebGpuPureRuntime | null> {
    try {
      validateStudioLivingInkExecutionConfig(config);
    } catch {
      return null;
    }
    const gpu = (globalThis.navigator as Navigator | undefined)?.gpu;
    if (!gpu || typeof OffscreenCanvas !== "function") return null;
    let device: GPUDevice;
    try {
      const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) return null;
      device = await adapter.requestDevice();
    } catch {
      return null;
    }

    const canvas = new OffscreenCanvas(config.displayWidth, config.displayHeight);
    /*
     * The WGSL passes resolve into a storage buffer, so the presentation surface has to be one
     * that can *receive* those pixels — a 2D context. This runtime used to acquire a `webgpu`
     * context here and never configure or render into it, which only looked like a GPU present
     * path: `transferToImageBitmap()` then handed back a surface nothing had drawn to.
     */
    // Alpha stays on: the resolve writes wash coverage there so an untouched page is transparent.
    const presentation = canvas.getContext("2d", { alpha: true });
    if (!presentation) return null;

    const runtime = new StudioLivingInkWebGpuPureRuntime(device, config, canvas, presentation);
    try {
      runtime.allocateBuffers();
      runtime.compilePipelines();
      runtime.dispatchClearAll();
      return runtime;
    } catch {
      runtime.dispose();
      return null;
    }
  }

  private cellCount(): number {
    return this.config.fieldWidth * this.config.fieldHeight;
  }

  private coarseCellCount(): number {
    return this.coarseWidth * this.coarseHeight;
  }

  private displayCellCount(): number {
    return this.config.displayWidth * this.config.displayHeight;
  }

  private allocateBuffers(): void {
    const bytes = this.cellCount() * 16;
    const coarseBytes = this.coarseCellCount() * 16;
    const usage =
      GPUBufferUsage.STORAGE
      | GPUBufferUsage.COPY_SRC
      | GPUBufferUsage.COPY_DST;
    this.mobile = this.device.createBuffer({ size: bytes, usage });
    this.mobileScratch = this.device.createBuffer({ size: bytes, usage });
    this.fixed = this.device.createBuffer({ size: bytes, usage });
    this.wet = this.device.createBuffer({ size: bytes, usage });
    this.wetScratch = this.device.createBuffer({ size: bytes, usage });
    this.strokeDeposit = this.device.createBuffer({ size: bytes, usage });
    this.selection = this.device.createBuffer({ size: bytes, usage });
    this.velocity = this.device.createBuffer({ size: coarseBytes, usage });
    this.velocityScratch = this.device.createBuffer({ size: coarseBytes, usage });
    this.curl = this.device.createBuffer({ size: coarseBytes, usage });
    this.pressureA = this.device.createBuffer({ size: coarseBytes, usage });
    this.pressureB = this.device.createBuffer({ size: coarseBytes, usage });
    /*
     * `MAP_READ` may only be paired with `COPY_DST` — combining it with `STORAGE` made every
     * display buffer invalid at allocation, so the `display` pass's bind group was rejected and
     * the resolve silently never ran. The readback below already copies into its own mappable
     * staging buffer, so this buffer only ever needed to be a storage/copy target.
     *
     * It is sized to the *display* grid, not the field: the paper fibre, tooth and granulation
     * model in the resolve is authored in display pixels, so resolving at field resolution and
     * point-sampling up would alias the very texture the gate measures.
     */
    this.display = this.device.createBuffer({ size: this.displayCellCount() * 16, usage });
    this.uniforms = this.device.createBuffer({
      size: STUDIO_LIVING_INK_WGSL_UNIFORM_WORDS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.splatUniforms = this.device.createBuffer({
      size: SPLAT_UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  private compilePipelines(): void {
    for (const pass of listStudioLivingInkWgslPassSources()) {
      const module = this.device.createShaderModule({ code: pass.source });
      const pipeline = this.device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: pass.entryPoint },
      });
      this.pipelines.set(pass.id, pipeline);
    }
  }

  /**
   * Display tunables, derived exactly as the GLSL `render()` uploads them: composite gets
   * `beerLambertDensity * 2.2`, every isolated channel view gets the flat `1.5` the certified
   * runtime uses, and edge darkening carries its own `* 2.2`.
   */
  private displayUniforms(mode: StudioLivingInkDisplayMode) {
    const material = this.config.material;
    return {
      displayWidth: this.config.displayWidth,
      displayHeight: this.config.displayHeight,
      densityStrength: mode === "composite" ? material.beerLambertDensity * 2.2 : 1.5,
      paperFiber: material.paperFiber,
      paperTooth: material.paperTooth,
      granulation: material.granulation,
      edgeAmount: material.edgeDarkening * 2.2,
      wetSheen: material.wetSheen,
      vignette: material.vignette,
      seed: this.config.seed % 4_093,
      displayMode: studioLivingInkWgslDisplayModeCode(mode),
    };
  }

  private writeUniforms(extra?: {
    fixTransfer?: number;
    fixing?: boolean;
    velocitySettling?: boolean;
    displayMode?: StudioLivingInkDisplayMode;
  }): void {
    const chroma = studioLivingInkChromaBleedMultipliers(
      this.config.material.chromaticSeparation,
    );
    this.device.queue.writeBuffer(this.uniforms, 0, writeStudioLivingInkFieldUniforms({
      width: this.config.fieldWidth,
      height: this.config.fieldHeight,
      coarseWidth: this.coarseWidth,
      coarseHeight: this.coarseHeight,
      dt: STUDIO_LIVING_INK_EXECUTION_LIMITS.fixedTimeStepSeconds,
      bleed: this.config.material.bleed,
      dryRate: this.config.material.dryRate,
      chroma,
      chromaticSeparation: this.config.material.chromaticSeparation,
      beerDensity: this.config.material.beerLambertDensity,
      fixTransfer: extra?.fixTransfer ?? 0.22,
      flow: this.config.material.flow,
      vorticity: this.config.material.vorticity,
      capillaryCreep: this.config.material.capillaryCreep,
      fixing: extra?.fixing ?? false,
      velocitySettling: extra?.velocitySettling ?? false,
      dryingEdgeDeposition: this.config.material.dryingEdgeDeposition,
      // mobility = 1 is the worst-case wet cell; the kernel still gates by local mobility. The
      // scrub-tip variant is deliberately absent: both runtimes clear the brush footprint before
      // the tick loop, so `mix(quiet, tip, brush)` in GLSL always resolves to the quiet rate here.
      pigmentDiffusion: studioLivingInkPigmentDiffusionRates({
        bleed: this.config.material.bleed,
        mobility: 1,
        dt: STUDIO_LIVING_INK_EXECUTION_LIMITS.fixedTimeStepSeconds,
        brushFootprint: 0,
        chromaticSeparation: this.config.material.chromaticSeparation,
      }),
      fixSelectionEnabled: this.fixSelectionEnabled,
      display: this.displayUniforms(extra?.displayMode ?? this.config.displayMode),
    }));
  }

  private dispatchClearAll(): void {
    this.writeUniforms();
    this.lastInkMark = null;
    for (const buffer of [
      this.mobile,
      this.mobileScratch,
      this.fixed,
      this.wet,
      this.wetScratch,
      this.strokeDeposit,
      this.selection,
    ]) {
      this.dispatch("clear", [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: { buffer } },
      ]);
    }
    for (const buffer of [
      this.velocity,
      this.velocityScratch,
      this.curl,
      this.pressureA,
      this.pressureB,
    ]) {
      this.dispatch("clear-coarse", [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: { buffer } },
      ]);
    }
  }

  private dispatch(
    pass: StudioLivingInkWgslPassId,
    entries: GPUBindGroupEntry[],
  ): void {
    const pipeline = this.pipelines.get(pass);
    if (!pipeline) throw new Error(`WGSL pass missing: ${pass}`);
    const encoder = this.device.createCommandEncoder();
    const passEncoder = encoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries,
    });
    passEncoder.setBindGroup(0, bindGroup);
    const grid = studioLivingInkWgslPassGrid(pass);
    const width = grid === "coarse"
      ? this.coarseWidth
      : grid === "display" ? this.config.displayWidth : this.config.fieldWidth;
    const height = grid === "coarse"
      ? this.coarseHeight
      : grid === "display" ? this.config.displayHeight : this.config.fieldHeight;
    passEncoder.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    passEncoder.end();
    this.device.queue.submit([encoder.finish()]);
    this.passCount += 1;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("Living Ink pure WGSL runtime disposed.");
  }

  private simulationBounds(): StudioLivingInkBounds {
    return this.dirty ?? Object.freeze({
      x: 0,
      y: 0,
      width: this.config.fieldWidth,
      height: this.config.fieldHeight,
    });
  }

  private markDirty(bounds: StudioLivingInkBounds): void {
    this.dirty = unionBounds(
      this.dirty,
      bounds,
      this.config.fieldWidth,
      this.config.fieldHeight,
    );
  }

  private operationBounds(operation: StudioLivingInkOperation): StudioLivingInkBounds {
    if (operation.kind === "clear" || operation.kind === "fix" || operation.kind === "advance") {
      return Object.freeze({
        x: 0,
        y: 0,
        width: this.config.fieldWidth,
        height: this.config.fieldHeight,
      });
    }
    let result: StudioLivingInkBounds | null = operation.selection?.bounds ?? null;
    for (const mark of operation.marks) {
      const r = Math.max(1, mark.radius);
      result = unionBounds(
        result,
        { x: mark.x - r, y: mark.y - r, width: r * 2, height: r * 2 },
        this.config.fieldWidth,
        this.config.fieldHeight,
      );
    }
    return result ?? Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
  }

  private writeSplatUniforms(splat: CapsuleSplat): void {
    const values = this.splatScratch;
    values[0] = splat.fromX;
    values[1] = splat.fromY;
    values[2] = splat.toX;
    values[3] = splat.toY;
    values[4] = splat.startRadius;
    values[5] = splat.radius;
    values[6] = splat.falloff;
    values[7] = splat.radialVector ? 1 : 0;
    values.set(splat.startAmount, 8);
    values.set(splat.amount, 12);
    values[16] = splat.maximumBlend ? 1 : 0;
    values[17] = splat.selectionEnabled ? 1 : 0;
    values[18] = 0;
    values[19] = 0;
    this.device.queue.writeBuffer(this.splatUniforms, 0, values);
  }

  private splat(target: GPUBuffer, splat: CapsuleSplat): void {
    this.writeSplatUniforms(splat);
    this.dispatch("splat", [
      { binding: 0, resource: { buffer: this.uniforms } },
      { binding: 1, resource: { buffer: target } },
      { binding: 2, resource: { buffer: this.splatUniforms } },
      { binding: 3, resource: { buffer: this.selection } },
    ]);
  }

  private splatVelocity(splat: CapsuleSplat): void {
    this.writeSplatUniforms(splat);
    this.dispatch("splat-velocity", [
      { binding: 0, resource: { buffer: this.uniforms } },
      { binding: 1, resource: { buffer: this.velocity } },
      { binding: 2, resource: { buffer: this.splatUniforms } },
    ]);
  }

  private uploadSelection(mask: StudioLivingInkSelectionMask | null): boolean {
    if (!mask) return false;
    const cells = this.cellCount();
    const coverage = new Float32Array(cells * 4);
    const { bounds } = mask;
    for (let row = 0; row < bounds.height; row += 1) {
      const y = bounds.y + row;
      if (y < 0 || y >= this.config.fieldHeight) continue;
      for (let column = 0; column < bounds.width; column += 1) {
        const x = bounds.x + column;
        if (x < 0 || x >= this.config.fieldWidth) continue;
        coverage[(y * this.config.fieldWidth + x) * 4] = clamp01(
          mask.coverage[row * bounds.width + column] ?? 0,
        );
      }
    }
    this.device.queue.writeBuffer(this.selection, 0, coverage);
    return true;
  }

  /**
   * Deposition, transcribed from `applyDepositions` in the certified WebGL2 runtime.
   *
   * The previous WGSL version threw away the whole authoring model — pressure, speed, water mass,
   * pigment mass, tool and the near-black reflectance floor — and deposited a flat 0.7 of the raw
   * sRGB-ish colour. That is why the WGSL line measured 0.67 darkness against 22.8: the field was
   * carrying colour where the physics expects *optical density*. It also splatted the ink colour
   * into the water field, so a "wet" cell held the red channel of the ink instead of water mass.
   */
  private applyDepositions(
    operation: Extract<StudioLivingInkOperation, { kind: "ink" | "water" }>,
    isCancelled: () => boolean,
  ): void {
    const selectionEnabled = this.uploadSelection(operation.selection);
    if (operation.kind === "ink") {
      this.dispatch("clear", [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: { buffer: this.strokeDeposit } },
      ]);
    }
    const coat = studioLivingInkPigmentCoatFactor(
      studioLivingInkDepositionPathLength(operation.marks, this.lastInkMark),
      studioLivingInkMeanMarkRadius(operation.marks),
    );
    let previousX: number | null = null;
    let previousY: number | null = null;
    let previousRadius: number | null = null;
    let previousWetAmount: number | null = null;
    let previousDeposit: readonly [number, number, number, number] | null = null;
    const waterOnly = operation.kind === "water";
    const penTool = operation.kind === "ink" && operation.tool === "pen";
    const broad = waterOnly || (operation.kind === "ink" && operation.tool !== "pen");
    for (let index = 0; index < operation.marks.length; index += 1) {
      if (isCancelled()) throw new DOMException("Living Ink request cancelled.", "AbortError");
      const mark = operation.marks[index]!;
      const pressure = clampRange(mark.pressure, 0.02, 1);
      const relativeSpeed = clampRange(
        mark.speed / Math.max(1, this.config.fieldHeight * 3),
        0,
        1,
      );
      const radiusScale = broad
        ? (0.72 + Math.sqrt(pressure) * 0.58) * (1 + relativeSpeed * 0.22)
        : (0.55 + pressure * 0.72) * (1.08 - relativeSpeed * 0.38);
      const radius = Math.max(0.25, mark.radius * radiusScale);
      const speedLoad = broad ? 0.62 + (1 - relativeSpeed) * 0.38 : 0.5 + (1 - relativeSpeed) * 0.65;
      const load = (0.18 + pressure * 0.82) * speedLoad;
      // InkWash pen lays a faint wetness (~0.16) so a wash moments later can feather the line.
      const wetAmount = clampRange(
        Math.max(mark.waterMass * load, penTool ? 0.16 * load : 0),
        0,
        4,
      );
      const wetRadius = broad ? radius : radius * 2.35;
      this.splat(this.wet, {
        fromX: previousX ?? mark.x,
        fromY: previousY ?? mark.y,
        toX: mark.x,
        toY: mark.y,
        startRadius: broad ? (previousRadius ?? radius) : (previousRadius ?? radius) * 2.35,
        radius: wetRadius,
        falloff: 3.25,
        radialVector: false,
        startAmount: [previousWetAmount ?? wetAmount, 0, 0, 0],
        amount: [wetAmount, 0, 0, 0],
        maximumBlend: true,
        selectionEnabled,
      });
      if (operation.kind === "ink") {
        const pigmentMark = operation.marks[index]!;
        const pigment = pigmentMark.pigmentMass * load;
        // One pass is one coat: divide the batch by the path length it covers and by the measured
        // gain of the resolve, then scale by the stroke's own opacity as the CPU oracle already did.
        // Opaque white is a coverage well rather than an optical density, so it keeps the raw load.
        const pigmentCoat = pigment
          * clamp01(pigmentMark.color[3])
          * coat
          / STUDIO_LIVING_INK_PIGMENT_COAT.resolveGain;
        const white = operation.tool === "white-gouache";
        const densityRed = studioLivingInkPigmentOpticalDensity(pigmentMark.color[0]) * pigmentCoat;
        const densityGreen = studioLivingInkPigmentOpticalDensity(pigmentMark.color[1]) * pigmentCoat;
        const densityBlue = studioLivingInkPigmentOpticalDensity(pigmentMark.color[2]) * pigmentCoat;
        const deposit: readonly [number, number, number, number] = white
          ? [
              0,
              0,
              0,
              pigment
                * STUDIO_LIVING_INK_WHITE_GOUACHE_LOAD_GAIN
                * clamp01(pigmentMark.color[3]),
            ]
          : [densityRed, densityGreen, densityBlue, 0];
        this.splat(this.strokeDeposit, {
          fromX: previousX ?? mark.x,
          fromY: previousY ?? mark.y,
          toX: mark.x,
          toY: mark.y,
          startRadius: white ? (previousRadius ?? radius) * 1.45 : (previousRadius ?? radius),
          radius: white ? radius * 1.45 : radius,
          falloff: white ? 0.9 : 3.25,
          radialVector: false,
          startAmount: previousDeposit ?? deposit,
          amount: deposit,
          maximumBlend: true,
          selectionEnabled,
        });
        previousDeposit = deposit;
      }
      if (broad) this.splatStrokeMomentum(operation, index, mark, radius, pressure, {
        previousX,
        previousY,
        waterOnly,
        selectionEnabled,
      });
      this.markDirty(this.markBounds(mark.x, mark.y, radius));
      previousX = mark.x;
      previousY = mark.y;
      previousRadius = radius;
      previousWetAmount = wetAmount;
    }
    if (operation.kind === "ink" && operation.marks.length > 0) {
      // One physical pigment write after the capsule union pass, exactly as GLSL merges its
      // stroke-deposit surface: within a stroke the dabs take a maximum, not a sum, so a
      // self-intersection cannot accumulate an unbounded knot.
      this.dispatch("merge-deposit", [
        { binding: 0, resource: { buffer: this.uniforms } },
        { binding: 1, resource: { buffer: this.mobile } },
        { binding: 2, resource: { buffer: this.strokeDeposit } },
      ]);
      const last = operation.marks[operation.marks.length - 1]!;
      this.lastInkMark = Object.freeze({ x: last.x, y: last.y });
    }
  }

  /**
   * The wash impulse, ported from the same block in the certified runtime: a tangential push with a
   * deterministic normal stir along a moving stroke, a seeded angular impulse for a dwell mark, and
   * — for water only — an added radial capillary source. Without the radial term a single water
   * dwell has no momentum at all and the bloom can only diffuse into a perfect disc.
   */
  private splatStrokeMomentum(
    operation: Extract<StudioLivingInkOperation, { kind: "ink" | "water" }>,
    index: number,
    mark: { readonly x: number; readonly y: number },
    radius: number,
    pressure: number,
    context: {
      previousX: number | null;
      previousY: number | null;
      waterOnly: boolean;
      selectionEnabled: boolean;
    },
  ): void {
    const { previousX, previousY, waterOnly, selectionEnabled } = context;
    const material = this.config.material;
    const dx = previousX === null ? 0 : mark.x - previousX;
    const dy = previousY === null ? 0 : mark.y - previousY;
    const distance = Math.hypot(dx, dy);
    let velocityX: number;
    let velocityY: number;
    if (distance > 1e-4) {
      const tangentX = dx / distance;
      /*
       * GLSL negates dy here because its velocity field lives in WebGL uv, where +y points up
       * while mark coordinates point down. The WGSL velocity field is already top-down — `wet` and
       * `pigment` both back-trace with a uv built from `gid.y` — so the same physical push is the
       * un-negated component. Copying the negation across would have driven every stroke's wash the
       * wrong way up the page.
       */
      const tangentY = dy / distance;
      const normalX = -tangentY;
      const normalY = tangentX;
      const tangentImpulse = (
        waterOnly ? 0.01 + material.flow * 0.035 : 0.03 + material.flow * 0.16
      ) * pressure;
      const stirPhase = Math.sin(index * 0.47 + operation.sequence * 0.73);
      const stirImpulse = (
        waterOnly ? 0.004 + material.vorticity * 0.025 : 0.003 + material.vorticity * 0.018
      ) * pressure * stirPhase;
      velocityX = tangentX * tangentImpulse + normalX * stirImpulse;
      velocityY = tangentY * tangentImpulse + normalY * stirImpulse;
    } else {
      const angle = ((operation.sequence * 131 + index * 977 + this.config.seed) % 6_283) / 1_000;
      const impulse = (
        waterOnly ? 0.006 + material.flow * 0.012 : 0.003 + material.flow * 0.008
      ) * pressure;
      velocityX = Math.cos(angle) * impulse;
      velocityY = Math.sin(angle) * impulse;
    }
    const momentum: readonly [number, number, number, number] = [velocityX, velocityY, 0, 0];
    this.splatVelocity({
      fromX: previousX ?? mark.x,
      fromY: previousY ?? mark.y,
      toX: mark.x,
      toY: mark.y,
      startRadius: radius * 1.15,
      radius: radius * 1.15,
      falloff: 3.25,
      radialVector: false,
      startAmount: momentum,
      amount: momentum,
      maximumBlend: false,
      selectionEnabled,
    });
    if (!waterOnly) return;
    // A continuous capsule-normal source moves pigment toward the wet boundary on a stroke;
    // for a dwell mark the same shader becomes a deterministic radial capillary impulse.
    const radialImpulse = (0.018 + material.capillaryCreep * 0.055) * pressure;
    const radial: readonly [number, number, number, number] = [radialImpulse, 0, 0, 0];
    this.splatVelocity({
      fromX: previousX ?? mark.x,
      fromY: previousY ?? mark.y,
      toX: mark.x,
      toY: mark.y,
      startRadius: radius * 1.45,
      radius: radius * 1.45,
      falloff: 2.1,
      radialVector: true,
      startAmount: radial,
      amount: radial,
      maximumBlend: false,
      selectionEnabled,
    });
  }

  private markBounds(x: number, y: number, radius: number): StudioLivingInkBounds {
    const left = Math.max(0, Math.floor(x - radius * 4));
    const top = Math.max(0, Math.floor(y - radius * 4));
    const right = Math.min(this.config.fieldWidth, Math.ceil(x + radius * 4));
    const bottom = Math.min(this.config.fieldHeight, Math.ceil(y + radius * 4));
    return Object.freeze({
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    });
  }

  private swapVelocity(): void {
    const spare = this.velocity;
    this.velocity = this.velocityScratch;
    this.velocityScratch = spare;
  }

  /**
   * One fixed tick of the Stable Fluids loop, in the order the fluid requires:
   * advect → confine vorticity → project (divergence, Jacobi, gradient) → water → pigment.
   */
  private step(
    fixing: boolean,
    pressureIterations: number,
    velocitySettling = false,
  ): void {
    // Settle rate, from the certified runtime: `1 - exp(-dt * 5)` per fixation tick — an
    // exponential approach over the fix window, not a flat fraction.
    const dt = STUDIO_LIVING_INK_EXECUTION_LIMITS.fixedTimeStepSeconds;
    this.writeUniforms({
      fixTransfer: fixing ? 1 - Math.exp(-dt * 5) : 0,
      fixing,
      velocitySettling,
    });
    const uniforms = { binding: 0, resource: { buffer: this.uniforms } } as const;

    this.dispatch("advect-velocity", [
      uniforms,
      { binding: 1, resource: { buffer: this.velocity } },
      { binding: 2, resource: { buffer: this.velocityScratch } },
      { binding: 3, resource: { buffer: this.wet } },
    ]);
    this.swapVelocity();

    this.dispatch("curl", [
      uniforms,
      { binding: 1, resource: { buffer: this.velocity } },
      { binding: 2, resource: { buffer: this.curl } },
    ]);
    this.dispatch("vorticity", [
      uniforms,
      { binding: 1, resource: { buffer: this.velocity } },
      { binding: 2, resource: { buffer: this.curl } },
      { binding: 3, resource: { buffer: this.velocityScratch } },
    ]);
    this.swapVelocity();

    this.dispatch("divergence", [
      uniforms,
      { binding: 1, resource: { buffer: this.velocity } },
      { binding: 2, resource: { buffer: this.pressureA } },
    ]);
    let solved = this.pressureA;
    for (let iteration = 0; iteration < pressureIterations; iteration += 1) {
      const src = iteration % 2 === 0 ? this.pressureA : this.pressureB;
      const dst = iteration % 2 === 0 ? this.pressureB : this.pressureA;
      this.dispatch("jacobi", [
        uniforms,
        { binding: 1, resource: { buffer: src } },
        { binding: 2, resource: { buffer: dst } },
      ]);
      solved = dst;
    }
    this.dispatch("gradient", [
      uniforms,
      { binding: 1, resource: { buffer: this.velocity } },
      { binding: 2, resource: { buffer: solved } },
      { binding: 3, resource: { buffer: this.velocityScratch } },
    ]);
    this.swapVelocity();

    this.dispatch("wet", [
      uniforms,
      { binding: 1, resource: { buffer: this.wet } },
      { binding: 2, resource: { buffer: this.wetScratch } },
      { binding: 3, resource: { buffer: this.velocity } },
    ]);
    const spareWet = this.wet;
    this.wet = this.wetScratch;
    this.wetScratch = spareWet;

    this.dispatch("pigment", [
      uniforms,
      { binding: 1, resource: { buffer: this.mobile } },
      { binding: 2, resource: { buffer: this.mobileScratch } },
      { binding: 3, resource: { buffer: this.wet } },
      { binding: 4, resource: { buffer: this.velocity } },
    ]);
    const spareMobile = this.mobile;
    this.mobile = this.mobileScratch;
    this.mobileScratch = spareMobile;

    if (fixing) {
      this.dispatch("fix", [
        uniforms,
        { binding: 1, resource: { buffer: this.mobile } },
        { binding: 2, resource: { buffer: this.fixed } },
        { binding: 3, resource: { buffer: this.selection } },
      ]);
    }
  }

  async apply(
    requestId: number,
    operation: StudioLivingInkOperation,
    options: StudioLivingInkExecutionApplyOptions,
    isCancelled: () => boolean,
    yieldControl: () => Promise<void>,
  ): Promise<StudioLivingInkExecutionApplyResult> {
    this.assertActive();
    const started = performance.now();
    this.passCount = 0;
    this.markDirty(this.operationBounds(operation));

    this.fixSelectionEnabled = operation.kind === "fix"
      ? this.uploadSelection(operation.selection)
      : false;
    this.writeUniforms();
    if (operation.kind === "clear") {
      if (operation.scope === "selection" && operation.selection) {
        this.uploadSelection(operation.selection);
        for (const buffer of [this.mobile, this.fixed, this.wet]) {
          this.dispatch("clear-masked", [
            { binding: 0, resource: { buffer: this.uniforms } },
            { binding: 1, resource: { buffer } },
            { binding: 2, resource: { buffer: this.selection } },
          ]);
        }
        /*
         * The certified runtime clears five surfaces under the mask, not three: velocity and
         * pressure go with the pigment and the water. Leaving them was a real behavioural
         * divergence rather than an omission of bookkeeping — the wash momentum inside a cleared
         * region survived the clear, so the next stroke laid into that region was advected by the
         * velocity of the marks the user had just erased. WebGL2 users never saw that.
         *
         * `velocityScratch` and `curl` are deliberately not masked, for the same reason the GLSL
         * runtime never masks its own curl surface: both are fully rewritten from the live field
         * (by `advect-velocity` and `curl`) before anything reads them, so they hold no state a
         * clear could leave behind. Both pressure halves are masked because the Jacobi ping-pong's
         * solved head alternates with the iteration count — neither half is "the" live one.
         */
        for (const buffer of [this.velocity, this.pressureA, this.pressureB]) {
          this.dispatch("clear-masked-coarse", [
            { binding: 0, resource: { buffer: this.uniforms } },
            { binding: 1, resource: { buffer } },
            { binding: 2, resource: { buffer: this.selection } },
          ]);
        }
      } else {
        this.dispatchClearAll();
      }
    } else if (operation.kind === "ink" || operation.kind === "water") {
      this.applyDepositions(operation, isCancelled);
    }

    const quality = options.quality ?? (operation.kind === "fix" ? "settle" : "interactive");
    const { pressureIterations } = studioLivingInkFluidPlan(this.config, quality);
    let ticks = options.simulationTicks
      ?? (operation.kind === "advance" ? operation.fixedTicks : 1);
    if (operation.kind === "fix") {
      ticks = Math.round(
        STUDIO_LIVING_INK_EXECUTION_LIMITS.fixDurationSeconds
          / STUDIO_LIVING_INK_EXECUTION_LIMITS.fixedTimeStepSeconds,
      );
    }
    const velocitySettling = operation.kind === "advance" && quality === "settle";
    for (let tick = 0; tick < ticks; tick += 1) {
      if (isCancelled()) throw new DOMException("Living Ink request cancelled.", "AbortError");
      this.step(operation.kind === "fix", pressureIterations, velocitySettling);
      if ((tick + 1) % 6 === 0) await yieldControl();
    }

    this.revision += 1;
    const dirtyBounds = this.simulationBounds();
    const tile = STUDIO_LIVING_INK_EXECUTION_LIMITS.dirtyTileSize;
    const dirtyTileCount =
      Math.ceil(dirtyBounds.width / tile) * Math.ceil(dirtyBounds.height / tile);
    const operationSha256 = sha256(stableJson(operation));

    if (options.present === false) {
      const applied: StudioLivingInkExecutionApplied = Object.freeze({
        kind: "living-ink/applied",
        version: STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
        engineVersion: STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
        requestId,
        revision: this.revision,
        operationKind: operation.kind,
        operationSha256,
        backend: "webgpu-offscreen-half-float",
        dirtyBounds,
        dirtyTileCount,
        passCount: this.passCount,
        pressureIterations,
        simulationTicks: ticks,
        elapsedMilliseconds: performance.now() - started,
        presented: false,
        displayReadbackCount: 0,
        imageBitmapCount: 0,
      });
      return applied;
    }

    const displayMode = options.displayMode ?? this.config.displayMode;
    await this.renderDisplay(displayMode);
    const pixels = await this.readDisplayRgba8();
    const receipt = this.makeReceipt({
      requestId,
      operationKind: operation.kind,
      operationSha256,
      dirtyBounds,
      dirtyTileCount,
      pressureIterations,
      simulationTicks: ticks,
      started,
      displaySha256: this.displayHash(pixels),
    });
    return Object.freeze({ image: this.present(pixels), receipt });
  }

  /**
   * Proves this runtime can draw watercolour before the Worker is allowed to prefer it, then puts
   * the field back the way it found it.
   *
   * Admission by demonstration is what keeps the quality policy enforceable at runtime rather than
   * only in CI: the runtime lays one reference stroke, resolves a real frame, measures the two
   * signals a broken resolve destroys first — paper texture and ink density — and clears. Because
   * the probe restores the revision counter, dirty bounds and every field buffer, a caller cannot
   * tell the proof ran, and a journal replay produces the same hashes with or without it.
   */
  async proveWatercolourResolve(): Promise<StudioLivingInkWatercolourProof> {
    const empty = Object.freeze({
      admitted: false,
      blank: true,
      paperLuminanceStandardDeviation: 0,
      probeStrokeDarkness: 0,
    });
    try {
      this.assertActive();
      const width = this.config.fieldWidth;
      const height = this.config.fieldHeight;
      const marks = Array.from({ length: 24 }, (_, index) => ({
        x: width * 0.18 + (index / 23) * width * 0.64,
        y: height * 0.5,
        radius: Math.max(1.5, height * 0.02),
        pressure: 0.82,
        speed: 0,
        waterMass: 0.2,
        pigmentMass: 0.6,
        color: [0.05, 0.05, 0.06, 1] as const,
      }));
      this.applyDepositions(
        {
          kind: "ink",
          version: 1,
          sequence: 1,
          tool: "brush",
          marks,
          selection: null,
        },
        () => false,
      );
      this.step(false, 4);
      await this.renderDisplay("composite");
      const pixels = await this.readDisplayRgba8();
      const blank = studioLivingInkPresentedPixelsAreBlank(pixels);
      const displayWidth = this.config.displayWidth;
      const displayHeight = this.config.displayHeight;
      const paper = regionLuminance(pixels, displayWidth, {
        x: 0,
        y: 0,
        width: displayWidth,
        height: Math.max(2, Math.floor(displayHeight * 0.08)),
      });
      const stroke = regionLuminance(pixels, displayWidth, {
        x: Math.floor(displayWidth * 0.25),
        y: Math.floor(displayHeight * 0.46),
        width: Math.max(1, Math.floor(displayWidth * 0.5)),
        height: Math.max(1, Math.floor(displayHeight * 0.08)),
      });
      const probeStrokeDarkness = paper.mean - stroke.mean;
      // Paper texture now lives *inside* the wash: the resolve stops painting paper where there is
      // no wash so a committed page-sized layer cannot repaint the document background. So the
      // texture floor is read off the stroke band, and the untouched strip earns a second floor of
      // its own — it has to come back as clean page, which is exactly the regression it used to hide.
      const pageIsClean = paper.standardDeviation
        <= STUDIO_LIVING_INK_WGSL_ADMISSION.maximumUntouchedPageLuminanceStandardDeviation
        && paper.mean >= STUDIO_LIVING_INK_WGSL_ADMISSION.minimumUntouchedPageLuminance;
      return Object.freeze({
        admitted: !blank
          && pageIsClean
          && stroke.standardDeviation
            >= STUDIO_LIVING_INK_WGSL_ADMISSION.minimumPaperLuminanceStandardDeviation
          && probeStrokeDarkness >= STUDIO_LIVING_INK_WGSL_ADMISSION.minimumProbeStrokeDarkness,
        blank,
        paperLuminanceStandardDeviation: stroke.standardDeviation,
        probeStrokeDarkness,
      });
    } catch {
      return empty;
    } finally {
      try {
        this.dispatchClearAll();
      } catch {
        /* a runtime that cannot even clear is about to be disposed by the caller */
      }
      this.revision = 0;
      this.passCount = 0;
      this.dirty = null;
    }
  }

  async renderFrame(
    requestId: number,
    displayMode: StudioLivingInkDisplayMode,
  ): Promise<StudioLivingInkExecutionFrame> {
    this.assertActive();
    const started = performance.now();
    this.passCount = 0;
    await this.renderDisplay(displayMode);
    const pixels = await this.readDisplayRgba8();
    const receipt = this.makeReceipt({
      requestId,
      operationKind: "restore",
      operationSha256: sha256(`render:${displayMode}:${this.revision}`),
      dirtyBounds: this.simulationBounds(),
      dirtyTileCount: 0,
      pressureIterations: 0,
      simulationTicks: 0,
      started,
      displaySha256: this.displayHash(pixels),
    });
    return Object.freeze({ image: this.present(pixels), receipt });
  }

  /** Canonical receipt hash: WebGPU storage and ImageData are both top-left row-major. */
  private displayHash(pixels: Uint8Array): `sha256:${string}` {
    return sha256(canonicalStudioLivingInkDisplayRgba8(pixels));
  }

  /**
   * Turns the resolved pixels into the frame the caller shows. The bitmap is built from the same
   * array whose browser-preserved premultiplied bytes the receipt hashes, so "what was verified"
   * and "what reaches the screen" cannot drift apart. Straight RGB itself is not hash-stable under
   * partial alpha because every canvas transfer quantizes through premultiplication.
   *
   * Fails closed on a blank readback rather than presenting it. The runtime has no second pixel
   * source and `tryCreateStudioLivingInkWebGpuRuntime` admits only this WebGPU implementation.
   * Refusal leaves the selected provider unavailable; it never starts a WebGL2 operation.
   */
  private present(pixels: Uint8Array): ImageBitmap {
    if (studioLivingInkPresentedPixelsAreBlank(pixels)) {
      throw new Error(
        "Living Ink WGSL runtime resolved an empty display frame; refusing to present a blank canvas.",
      );
    }
    const rgba = new Uint8ClampedArray(pixels.byteLength);
    rgba.set(pixels);
    this.presentation.putImageData(
      new ImageData(rgba, this.config.displayWidth, this.config.displayHeight),
      0,
      0,
    );
    return this.canvas.transferToImageBitmap();
  }

  private async renderDisplay(mode: StudioLivingInkDisplayMode): Promise<void> {
    this.writeUniforms({ displayMode: mode });
    this.dispatch("display", [
      { binding: 0, resource: { buffer: this.uniforms } },
      { binding: 1, resource: { buffer: this.mobile } },
      { binding: 2, resource: { buffer: this.fixed } },
      { binding: 3, resource: { buffer: this.display } },
      { binding: 4, resource: { buffer: this.wet } },
      { binding: 5, resource: { buffer: this.velocity } },
    ]);
  }

  /** Resolved display pixels in natural top-left ImageData/storage-buffer row order. */
  private async readDisplayRgba8(): Promise<Uint8Array> {
    // Map requires MAP_READ-only buffer; copy display → staging
    const bytes = this.displayCellCount() * 16;
    const staging = this.device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.display, 0, staging, 0, bytes);
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const f32 = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    const out = new Uint8Array(this.displayCellCount() * 4);
    // The resolve already ran on the display grid, so this is a straight 1:1 quantisation.
    for (let index = 0; index < out.length; index += 4) {
      out[index] = Math.round(clamp01(f32[index] ?? 0) * 255);
      out[index + 1] = Math.round(clamp01(f32[index + 1] ?? 0) * 255);
      out[index + 2] = Math.round(clamp01(f32[index + 2] ?? 0) * 255);
      // Wash coverage, not a constant: an untouched page has to stay transparent so the committed
      // page-sized layer cannot repaint the document background.
      out[index + 3] = Math.round(clamp01(f32[index + 3] ?? 0) * 255);
    }
    return out;
  }

  private makeReceipt(input: {
    requestId: number;
    operationKind: StudioLivingInkExecutionReceipt["operationKind"];
    operationSha256: `sha256:${string}`;
    dirtyBounds: StudioLivingInkBounds;
    dirtyTileCount: number;
    pressureIterations: number;
    simulationTicks: number;
    started: number;
    displaySha256: `sha256:${string}`;
  }): StudioLivingInkExecutionReceipt {
    return Object.freeze({
      kind: "studio-living-ink-execution-receipt",
      version: STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
      engineVersion: STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
      requestId: input.requestId,
      revision: this.revision,
      operationKind: input.operationKind,
      backend: "webgpu-offscreen-half-float",
      displaySha256: input.displaySha256,
      displayHashEncoding: "premultiplied-rgba8-v2",
      operationSha256: input.operationSha256,
      dirtyBounds: input.dirtyBounds,
      dirtyTileCount: input.dirtyTileCount,
      passCount: this.passCount,
      pressureIterations: input.pressureIterations,
      simulationTicks: input.simulationTicks,
      elapsedMilliseconds: performance.now() - input.started,
      fixedPigmentPolicy: "immutable",
      dryingWindowSeconds: studioLivingInkDryWindowSeconds(this.config.material.dryRate),
      fixDurationSeconds: 1.2,
      determinism: "same-runtime-replay",
      crossDeviceBitExact: false,
      cpuOperationHashCrossDeviceDeterministic: true,
      canonicalFrameAuthority: "first-rendered-rgba8-frame",
      replayValidation: "bounded-visual-parity",
      displayReadbackOrientation: "top-left-row-major",
      gpuError: 0,
      readbackFormat: "rgba32float-storage-buffer-to-rgba8",
      imageOwnership: "caller-must-close",
      contextRecovery: "worker-rebuild-journal-replay",
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const buffer of [
      this.mobile,
      this.mobileScratch,
      this.fixed,
      this.wet,
      this.wetScratch,
      this.strokeDeposit,
      this.selection,
      this.velocity,
      this.velocityScratch,
      this.curl,
      this.pressureA,
      this.pressureB,
      this.display,
      this.uniforms,
      this.splatUniforms,
    ]) {
      try {
        buffer?.destroy();
      } catch {
        /* ignore */
      }
    }
    try {
      this.device.destroy();
    } catch {
      /* ignore */
    }
  }
}
