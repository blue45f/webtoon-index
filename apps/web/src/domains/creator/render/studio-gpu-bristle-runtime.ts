/**
 * studio-gpu-bristle WebGPU runtime — three passes, persistent chain state, no readback on the
 * pointer path.
 *
 * PROVENANCE (derived work, MIT): David Li, "Fluid Paint" — http://david.li/paint —
 * https://github.com/dli/paint, © 2017 David Li. The pass structure below is an adaptation of
 * `brush.js` + `paint.js`; every kernel it compiles is in `studio-gpu-bristle-wgsl.ts`, which
 * carries the full per-shader upstream attribution. Verbatim permission notice:
 * `third_party/dli-paint/LICENSE`.
 *
 * Device discipline, deliberately unlike `studio-living-ink-webgpu-pure-runtime.ts:293` (which
 * requests its own adapter and carries zero `.lost` handlers in 1,329 lines, making it invisible to
 * the fabric's epoch accounting):
 *   - the device is LEASED from `studio-gpu-fabric.ts`, never self-requested;
 *   - loss arrives through `onStudioGpuDeviceLost` AND through `device.lost`, and either one puts
 *     the runtime permanently in `device-lost`;
 *   - on loss nothing is `destroy()`ed — the device is already gone — and the selected WebGPU
 *     operation ends as unavailable. There is no mid-stroke re-acquire or CPU-carrier replay.
 *   - limits are read once from `getStudioGpuFabricCapabilities()`; re-probing on the hot path is
 *     banned by that module's own header.
 *
 * Residency: paint + height textures are budgeted from this lane's OWN allowance and never from
 * `StudioWebGpuR8GrainTextureCache`'s shared 96 MiB. Starving the grain cache to fund the solver
 * would remove paper texture to buy bristle physics, which is the exact trade ADR-0010 forbids.
 *
 * Bundle: this module value-imports `studio-gpu-fabric.ts` (which in turn value-imports the filter
 * runtime) and `studio-gpu-bristle-wgsl.ts`. It is therefore reachable ONLY from
 * `studio-gpu-bristle.worker.ts`; `studio-gpu-bristle-route-import-boundary.test.ts` fails the
 * build if a durable render surface ever reaches it.
 */

import {
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE,
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_STATION,
  STUDIO_GPU_BRISTLE_DLI_PAINTING,
  STUDIO_GPU_BRISTLE_LIMITS,
  STUDIO_GPU_BRISTLE_SPLAT_LAYOUT,
  STUDIO_GPU_BRISTLE_TUFT_LAYOUT,
  STUDIO_FLUID_PAINT_BRUSH,
  STUDIO_FLUID_PAINT_DISPLAY,
  STUDIO_FLUID_PAINT_RYB_CUBE,
  clampStudioGpuBristleStationDtMs,
  createStudioGpuBristleTuftUniform,
  writeStudioGpuBristleTuftUniform,
} from "./studio-gpu-bristle-contract";
import {
  createStudioGpuBristleReference,
  packStudioGpuBristleState,
  resolveStudioGpuBristleConfig,
  studioGpuBristleLayoutDraw,
} from "./studio-gpu-bristle-reference";
import {
  studioGpuBristleImpastoResolveWgsl,
  studioGpuBristleSolveWgsl,
  studioGpuBristleSplatWgsl,
} from "./studio-gpu-bristle-wgsl";
import { acquireStudioGpuDevice, onStudioGpuDeviceLost } from "./studio-gpu-fabric";
import { packStudioWebGpuR8GrainNativeUniform, studioWebGpuR8GrainDabCenterUv } from "./studio-webgpu-r8-grain-native";

import type {
  StudioGpuBristleResolvedConfig,
  StudioGpuBristleStation,
  StudioGpuBristleTuftOptions,
} from "./studio-gpu-bristle-reference";
import type { StudioGpuBristleWgslLayout } from "./studio-gpu-bristle-wgsl";
import type { StudioGpuDeviceLease } from "./studio-gpu-fabric";
import type { StudioWebGpuR8GrainNativePlan } from "./studio-webgpu-r8-grain-native";

export const STUDIO_GPU_BRISTLE_RUNTIME_VERSION = "studio-gpu-bristle-runtime-v1" as const;

/** Paint (rgba16float, 8 B/px) + height (r16float, 2 B/px) for this lane only. */
export const STUDIO_GPU_BRISTLE_RESIDENT_BUDGET_BYTES = 40 * 1024 * 1024;
export const STUDIO_GPU_BRISTLE_PAINT_FORMAT = "rgba16float" as const;
export const STUDIO_GPU_BRISTLE_HEIGHT_FORMAT = "r16float" as const;
export const STUDIO_GPU_BRISTLE_BYTES_PER_SURFACE_PIXEL = 8 + 2;

/** `Tuft.physics.x` carries a millisecond→second scale so no unit constant lives in shader text. */
const MS_TO_SECONDS = 1 / 1000;

/** Pass-local `Deposit` uniform: 4 vec4 lanes (flags, ink, transport, splat). */
const DEPOSIT_UNIFORM_COMPONENTS = 16;
/** Resolve `Display` uniform: 4 parameter lanes + the 8 RYB cube vertices. */
const DISPLAY_UNIFORM_COMPONENTS = 48;
/** Grain uniform is anchor_phase + scale/amount/contrast/enabled. */
const GRAIN_UNIFORM_COMPONENTS = 8;

const GRAIN_WGSL_BINDINGS = Object.freeze({
  group: 1,
  textureBinding: 0,
  samplerBinding: 1,
  uniformBinding: 2,
  prefix: "studio_gpu_bristle_grain",
});

export type StudioGpuBristleRuntimeStatus =
  | "ready"
  | "webgpu-unavailable"
  | "device-unavailable"
  | "device-lost"
  | "surface-unavailable"
  | "surface-budget"
  | "shader-unavailable"
  | "disposed";

export interface StudioGpuBristleRuntimeOptions {
  /** Presentation surface. The worker owns it; the host only ever sees an ImageBitmap. */
  readonly canvas: OffscreenCanvas;
  /** Explicit GPU for harnesses. Omitted in product: the fabric picks `navigator.gpu`. */
  readonly gpu?: GPU | null;
}

export interface StudioGpuBristleSurface {
  readonly widthPx: number;
  readonly heightPx: number;
  /** Document coordinate of the surface's top-left pixel corner. */
  readonly originX: number;
  readonly originY: number;
  /** Device pixels per document unit. */
  readonly pixelsPerUnit: number;
}

export interface StudioGpuBristleStrokeRequest {
  readonly tuft: StudioGpuBristleTuftOptions;
  readonly surface: StudioGpuBristleSurface;
  /** Stroke opacity applied at resolve, in [0, 1]. */
  readonly opacity?: number;
  /** Optional paper grain. Absent → the resolve's grain term is an exact 1.0 no-op. */
  readonly grain?: {
    readonly plan: Readonly<StudioWebGpuR8GrainNativePlan>;
    readonly bytes: Uint8Array;
  } | null;
}

export interface StudioGpuBristleAdvanceRequest {
  readonly stations: readonly StudioGpuBristleStation[];
  /** True only for the batch carrying the stroke's first station. */
  readonly place: boolean;
}

export interface StudioGpuBristleRuntime {
  readonly version: typeof STUDIO_GPU_BRISTLE_RUNTIME_VERSION;
  readonly status: StudioGpuBristleRuntimeStatus;
  readonly deviceEpoch: number;
  readonly config: StudioGpuBristleResolvedConfig | null;
  beginStroke(request: StudioGpuBristleStrokeRequest): StudioGpuBristleRuntimeStatus;
  advance(request: StudioGpuBristleAdvanceRequest): StudioGpuBristleRuntimeStatus;
  /** Runs the resolve and hands the caller a transferable bitmap. Never called per pointer move. */
  present(): ImageBitmap | null;
  /** Test/gate only: maps `bristleState` back. Never called on the pointer path. */
  readBristleState(): Promise<Float32Array | null>;
  /** Test/gate only: maps the splat slots back. Never called on the pointer path. */
  readSplatSlots(): Promise<Float32Array | null>;
  dispose(): void;
}

interface Pipelines {
  readonly solve: GPUComputePipeline;
  readonly solveLayout: GPUBindGroupLayout;
  readonly splat: GPURenderPipeline;
  readonly splatLayout: GPUBindGroupLayout;
  readonly resolve: GPURenderPipeline;
  readonly resolveLayout: GPUBindGroupLayout;
  readonly grainLayout: GPUBindGroupLayout;
}

function surfaceBytes(widthPx: number, heightPx: number): number {
  return widthPx * heightPx * STUDIO_GPU_BRISTLE_BYTES_PER_SURFACE_PIXEL;
}

function wgslLayout(config: StudioGpuBristleResolvedConfig): StudioGpuBristleWgslLayout {
  return {
    verticesPerBristle: config.verticesPerBristle,
    maxBristles: STUDIO_GPU_BRISTLE_LIMITS.maxBristleCount,
    maxStationsPerBatch: STUDIO_GPU_BRISTLE_LIMITS.maxStationsPerBatch,
    solveWorkgroupSize: STUDIO_GPU_BRISTLE_LIMITS.workgroupSize,
  };
}

/**
 * Pack the stations the shader reads. `dtMs` travels in the station and is clamped here, never
 * derived from the station index — that is what keeps a suffix solve byte-identical to a replay.
 * `drive.z` carries the windowed peak speed (the reference's `pushSpeed` output) so the shader
 * needs no ring buffer.
 */
export function packStudioGpuBristleStations(
  stations: readonly StudioGpuBristleStation[],
  speedWindow: readonly number[],
): Float32Array {
  const packed = new Float32Array(
    stations.length * STUDIO_GPU_BRISTLE_COMPONENTS_PER_STATION,
  );
  for (let index = 0; index < stations.length; index += 1) {
    const station = stations[index]!;
    const base = index * STUDIO_GPU_BRISTLE_COMPONENTS_PER_STATION;
    packed[base] = station.x;
    packed[base + 1] = station.y;
    packed[base + 2] = Math.min(1, Math.max(0, station.pressure));
    packed[base + 3] = clampStudioGpuBristleStationDtMs(station.dtMs);
    packed[base + 4] = Number.isFinite(station.tiltX ?? 0) ? (station.tiltX ?? 0) : 0;
    packed[base + 5] = Number.isFinite(station.tiltY ?? 0) ? (station.tiltY ?? 0) : 0;
    packed[base + 6] = speedWindow[index] ?? 0;
    packed[base + 7] = 0;
  }
  return packed;
}

/** Per-bristle layout draw buffer: offsetX, offsetY, directionX, directionY. */
export function packStudioGpuBristleLayoutDraws(
  config: StudioGpuBristleResolvedConfig,
): Float32Array {
  const packed = new Float32Array(config.bristleCount * 4);
  for (let bristle = 0; bristle < config.bristleCount; bristle += 1) {
    const draw = studioGpuBristleLayoutDraw(config, bristle);
    packed[bristle * 4] = draw.offsetX;
    packed[bristle * 4 + 1] = draw.offsetY;
    packed[bristle * 4 + 2] = draw.directionX;
    packed[bristle * 4 + 3] = draw.directionY;
  }
  return packed;
}

/** Pass-local `Deposit` uniform. Every value originates in the contract. */
export function packStudioGpuBristleDepositUniform(
  config: StudioGpuBristleResolvedConfig,
  place: boolean,
): ArrayBuffer {
  const buffer = new ArrayBuffer(DEPOSIT_UNIFORM_COMPONENTS * 4);
  const u32 = new Uint32Array(buffer, 0, 4);
  const f32 = new Float32Array(buffer);
  u32[0] = place ? 1 : 0;
  f32[4] = config.ink[0];
  f32[5] = config.ink[1];
  f32[6] = config.ink[2];
  f32[7] = config.inkLoad;
  f32[8] = config.bendStiffnessRatio;
  f32[9] = config.capillaryRate;
  f32[10] = config.depletionRate;
  f32[11] = config.minSplatRadiusPx;
  f32[12] = config.splatRadius;
  f32[13] = config.splatVelocityScale;
  f32[14] = STUDIO_GPU_BRISTLE_DLI_PAINTING.thinMinAlpha;
  f32[15] = STUDIO_GPU_BRISTLE_DLI_PAINTING.thinMaxAlpha;
  return buffer;
}

/**
 * Resolve `Display` uniform. Lighting comes from `STUDIO_FLUID_PAINT_DISPLAY` (dli `paint.js`) and
 * the light direction is dli's `(0, 1, 1)` expressed image-space (y grows downward), matching
 * `studio-impasto-relief-shading-v1.ts` exactly so the ≤1 LSB gate has something to compare to.
 */
export function packStudioGpuBristleDisplayUniform(
  surface: StudioGpuBristleSurface,
  grainOriginUv: readonly [number, number],
  opacity: number,
): Float32Array {
  const packed = new Float32Array(DISPLAY_UNIFORM_COMPONENTS);
  const lightX = 0;
  const lightY = -1;
  const lightZ = 1;
  packed[0] = lightX;
  packed[1] = lightY;
  packed[2] = lightZ;
  packed[3] = STUDIO_FLUID_PAINT_DISPLAY.normalScale;
  packed[4] = STUDIO_FLUID_PAINT_DISPLAY.roughness;
  packed[5] = STUDIO_FLUID_PAINT_DISPLAY.f0;
  packed[6] = STUDIO_FLUID_PAINT_DISPLAY.specularScale;
  packed[7] = STUDIO_FLUID_PAINT_DISPLAY.diffuseScale;
  // maxShadingMultiplier / heightScale mirror STUDIO_IMPASTO_RELIEF_SHADING_DEFAULTS.
  packed[8] = 4;
  packed[9] = 1;
  packed[10] = grainOriginUv[0];
  packed[11] = grainOriginUv[1];
  packed[12] = surface.originX;
  packed[13] = surface.originY;
  packed[14] = surface.pixelsPerUnit > 0 ? 1 / surface.pixelsPerUnit : 1;
  packed[15] = Math.min(1, Math.max(0, opacity));
  const cube = [
    STUDIO_FLUID_PAINT_RYB_CUBE.v000,
    STUDIO_FLUID_PAINT_RYB_CUBE.v100,
    STUDIO_FLUID_PAINT_RYB_CUBE.v010,
    STUDIO_FLUID_PAINT_RYB_CUBE.v001,
    STUDIO_FLUID_PAINT_RYB_CUBE.v101,
    STUDIO_FLUID_PAINT_RYB_CUBE.v011,
    STUDIO_FLUID_PAINT_RYB_CUBE.v110,
    STUDIO_FLUID_PAINT_RYB_CUBE.v111,
  ] as const;
  for (let index = 0; index < cube.length; index += 1) {
    const vertex = cube[index]!;
    packed[16 + index * 4] = vertex[0]!;
    packed[16 + index * 4 + 1] = vertex[1]!;
    packed[16 + index * 4 + 2] = vertex[2]!;
    packed[16 + index * 4 + 3] = 0;
  }
  return packed;
}

/** Viewport uniform for the deposit pass: origin, scale, and both inverse surface extents. */
export function packStudioGpuBristleViewportUniform(
  surface: StudioGpuBristleSurface,
): Float32Array {
  const packed = new Float32Array(8);
  packed[0] = surface.originX;
  packed[1] = surface.originY;
  packed[2] = surface.pixelsPerUnit;
  packed[3] = surface.widthPx > 0 ? 1 / surface.widthPx : 0;
  packed[4] = surface.heightPx > 0 ? 1 / surface.heightPx : 0;
  return packed;
}

class StudioGpuBristleWebGpuRuntime implements StudioGpuBristleRuntime {
  readonly version = STUDIO_GPU_BRISTLE_RUNTIME_VERSION;

  #status: StudioGpuBristleRuntimeStatus;
  #lease: StudioGpuDeviceLease | null;
  #device: GPUDevice | null;
  #context: GPUCanvasContext | null;
  #canvas: OffscreenCanvas;
  #presentationFormat: GPUTextureFormat;
  #unsubscribeLoss: (() => void) | null;
  #pipelines: Pipelines | null = null;
  #config: StudioGpuBristleResolvedConfig | null = null;
  #surface: StudioGpuBristleSurface | null = null;
  #layout: StudioGpuBristleWgslLayout | null = null;

  #tuftBuffer: GPUBuffer | null = null;
  #depositBuffer: GPUBuffer | null = null;
  #stationBuffer: GPUBuffer | null = null;
  #bristleBuffer: GPUBuffer | null = null;
  #splatBuffer: GPUBuffer | null = null;
  #drawBuffer: GPUBuffer | null = null;
  #viewportBuffer: GPUBuffer | null = null;
  #displayBuffer: GPUBuffer | null = null;
  #grainUniformBuffer: GPUBuffer | null = null;
  #grainTexture: GPUTexture | null = null;
  #grainSampler: GPUSampler | null = null;
  #paintTexture: GPUTexture | null = null;
  #heightTexture: GPUTexture | null = null;
  #splatCapacity = 0;
  #opacity = 1;
  #grainPlan: Readonly<StudioWebGpuR8GrainNativePlan> | null = null;
  #speedRing: number[] = [];
  #lastStation: StudioGpuBristleStation | null = null;
  #residentBytes = 0;

  constructor(
    lease: StudioGpuDeviceLease,
    canvas: OffscreenCanvas,
    context: GPUCanvasContext,
    presentationFormat: GPUTextureFormat,
  ) {
    this.#lease = lease;
    this.#device = lease.device;
    this.#canvas = canvas;
    this.#context = context;
    this.#presentationFormat = presentationFormat;
    this.#status = "ready";
    const epoch = lease.epoch;
    this.#unsubscribeLoss = onStudioGpuDeviceLost((event) => {
      if (event.epoch !== epoch) return;
      this.#markLost();
    });
    // Belt and braces: the fabric hub can only fire for devices it minted, and a harness may hand
    // in its own. Both routes end in the same terminal state.
    void lease.device.lost.then(() => {
      this.#markLost();
    });
  }

  get status(): StudioGpuBristleRuntimeStatus {
    if (this.#status === "ready" && this.#lease?.lost === true) return "device-lost";
    return this.#status;
  }

  get deviceEpoch(): number {
    return this.#lease?.epoch ?? -1;
  }

  get config(): StudioGpuBristleResolvedConfig | null {
    return this.#config;
  }

  #markLost(): void {
    if (this.#status === "disposed") return;
    this.#status = "device-lost";
    // Nothing is destroyed: the device is already gone and every handle with it.
    this.#pipelines = null;
    this.#tuftBuffer = null;
    this.#depositBuffer = null;
    this.#stationBuffer = null;
    this.#bristleBuffer = null;
    this.#splatBuffer = null;
    this.#drawBuffer = null;
    this.#viewportBuffer = null;
    this.#displayBuffer = null;
    this.#grainUniformBuffer = null;
    this.#grainTexture = null;
    this.#paintTexture = null;
    this.#heightTexture = null;
    this.#residentBytes = 0;
  }

  #ensurePipelines(layout: StudioGpuBristleWgslLayout): Pipelines | null {
    const device = this.#device;
    if (!device) return null;
    if (
      this.#pipelines
      && this.#layout
      && this.#layout.verticesPerBristle === layout.verticesPerBristle
      && this.#layout.solveWorkgroupSize === layout.solveWorkgroupSize
    ) {
      return this.#pipelines;
    }
    const solveSource = studioGpuBristleSolveWgsl(layout);
    const splatSource = studioGpuBristleSplatWgsl(layout);
    const resolveSource = studioGpuBristleImpastoResolveWgsl(GRAIN_WGSL_BINDINGS);
    if (!solveSource || !splatSource || !resolveSource) {
      this.#status = "shader-unavailable";
      return null;
    }

    // Explicit bind-group layouts everywhere — never `layout: "auto"`, so a binding that drifts is
    // a validation error at pipeline creation rather than a silently wrong frame.
    const solveLayout = device.createBindGroupLayout({
      label: "studio-gpu-bristle-solve",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      ],
    });
    const splatLayout = device.createBindGroupLayout({
      label: "studio-gpu-bristle-splat",
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });
    const resolveLayout = device.createBindGroupLayout({
      label: "studio-gpu-bristle-resolve",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    const grainLayout = device.createBindGroupLayout({
      label: "studio-gpu-bristle-grain",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });

    const solveModule = device.createShaderModule({
      label: "studio-gpu-bristle-solve",
      code: solveSource,
    });
    const splatModule = device.createShaderModule({
      label: "studio-gpu-bristle-splat",
      code: splatSource,
    });
    const resolveModule = device.createShaderModule({
      label: "studio-gpu-bristle-resolve",
      code: resolveSource,
    });

    const pipelines: Pipelines = {
      solveLayout,
      splatLayout,
      resolveLayout,
      grainLayout,
      solve: device.createComputePipeline({
        label: "studio-gpu-bristle-solve",
        layout: device.createPipelineLayout({ bindGroupLayouts: [solveLayout] }),
        compute: { module: solveModule, entryPoint: "bristle_solve" },
      }),
      splat: device.createRenderPipeline({
        label: "studio-gpu-bristle-splat",
        layout: device.createPipelineLayout({ bindGroupLayouts: [splatLayout] }),
        vertex: { module: splatModule, entryPoint: "splat_vertex" },
        fragment: {
          module: splatModule,
          entryPoint: "splat_fragment",
          targets: [
            {
              format: STUDIO_GPU_BRISTLE_PAINT_FORMAT,
              blend: {
                color: { srcFactor: "one", dstFactor: "one", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
              },
            },
            {
              format: STUDIO_GPU_BRISTLE_HEIGHT_FORMAT,
              blend: {
                color: { srcFactor: "one", dstFactor: "one", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
              },
            },
          ],
        },
        primitive: { topology: "triangle-list" },
      }),
      resolve: device.createRenderPipeline({
        label: "studio-gpu-bristle-resolve",
        layout: device.createPipelineLayout({
          bindGroupLayouts: [resolveLayout, grainLayout],
        }),
        vertex: { module: resolveModule, entryPoint: "resolve_vertex" },
        fragment: {
          module: resolveModule,
          entryPoint: "resolve_fragment",
          targets: [{ format: this.#presentationFormat }],
        },
        primitive: { topology: "triangle-list" },
      }),
    };
    this.#pipelines = pipelines;
    this.#layout = layout;
    return pipelines;
  }

  beginStroke(request: StudioGpuBristleStrokeRequest): StudioGpuBristleRuntimeStatus {
    if (this.status !== "ready") return this.status;
    const device = this.#device;
    const context = this.#context;
    if (!device || !context) {
      this.#status = "surface-unavailable";
      return this.#status;
    }
    const surface = request.surface;
    const width = Math.max(1, Math.ceil(surface.widthPx));
    const height = Math.max(1, Math.ceil(surface.heightPx));
    const bytes = surfaceBytes(width, height);
    if (bytes > STUDIO_GPU_BRISTLE_RESIDENT_BUDGET_BYTES) {
      // Fail closed rather than compete with the grain cache's shared budget.
      this.#status = "surface-budget";
      return this.#status;
    }

    let config: StudioGpuBristleResolvedConfig;
    try {
      config = resolveStudioGpuBristleConfig(request.tuft);
    } catch {
      this.#status = "shader-unavailable";
      return this.#status;
    }

    const layout = wgslLayout(config);
    const pipelines = this.#ensurePipelines(layout);
    if (!pipelines) return this.status;

    this.#releaseStrokeResources();
    this.#config = config;
    this.#surface = { ...surface, widthPx: width, heightPx: height };
    this.#speedRing = [];
    this.#lastStation = null;
    this.#opacity = Math.min(1, Math.max(0, request.opacity ?? 1));
    this.#grainPlan = request.grain?.plan ?? null;

    this.#canvas.width = width;
    this.#canvas.height = height;
    context.configure({
      device,
      format: this.#presentationFormat,
      alphaMode: "premultiplied",
    });

    this.#paintTexture = device.createTexture({
      label: "studio-gpu-bristle-paint",
      size: { width, height },
      format: STUDIO_GPU_BRISTLE_PAINT_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.#heightTexture = device.createTexture({
      label: "studio-gpu-bristle-height",
      size: { width, height },
      format: STUDIO_GPU_BRISTLE_HEIGHT_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.#residentBytes = bytes;

    this.#tuftBuffer = device.createBuffer({
      label: "studio-gpu-bristle-tuft",
      size: STUDIO_GPU_BRISTLE_TUFT_LAYOUT.sizeOf,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#depositBuffer = device.createBuffer({
      label: "studio-gpu-bristle-deposit",
      size: DEPOSIT_UNIFORM_COMPONENTS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#viewportBuffer = device.createBuffer({
      label: "studio-gpu-bristle-viewport",
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#displayBuffer = device.createBuffer({
      label: "studio-gpu-bristle-display",
      size: DISPLAY_UNIFORM_COMPONENTS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#stationBuffer = device.createBuffer({
      label: "studio-gpu-bristle-stations",
      size:
        STUDIO_GPU_BRISTLE_LIMITS.maxStationsPerBatch
        * STUDIO_GPU_BRISTLE_COMPONENTS_PER_STATION
        * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.#bristleBuffer = device.createBuffer({
      label: "studio-gpu-bristle-state",
      size: config.bristleCount * STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE * 4,
      usage:
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.#splatCapacity =
      config.bristleCount * STUDIO_GPU_BRISTLE_LIMITS.maxStationsPerBatch;
    this.#splatBuffer = device.createBuffer({
      label: "studio-gpu-bristle-splats",
      size: this.#splatCapacity * STUDIO_GPU_BRISTLE_SPLAT_LAYOUT.sizeOf,
      usage:
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.#drawBuffer = device.createBuffer({
      label: "studio-gpu-bristle-draws",
      size: config.bristleCount * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Initial chain state comes from the CPU twin's own reset — identical `params`, identical rest
    // lengths, so the two sides start from the same numbers instead of two transcriptions of them.
    const seedState = packStudioGpuBristleState(
      createStudioGpuBristleReference(request.tuft),
    );
    device.queue.writeBuffer(this.#bristleBuffer, 0, seedState);
    device.queue.writeBuffer(this.#drawBuffer, 0, packStudioGpuBristleLayoutDraws(config));
    device.queue.writeBuffer(
      this.#viewportBuffer,
      0,
      packStudioGpuBristleViewportUniform(this.#surface),
    );

    this.#configureGrain(device, request);
    return this.#status;
  }

  #configureGrain(device: GPUDevice, request: StudioGpuBristleStrokeRequest): void {
    this.#grainSampler = device.createSampler({
      label: "studio-gpu-bristle-grain",
      addressModeU: "repeat",
      addressModeV: "repeat",
      magFilter: "linear",
      minFilter: "linear",
    });
    this.#grainUniformBuffer = device.createBuffer({
      label: "studio-gpu-bristle-grain-uniform",
      size: GRAIN_UNIFORM_COMPONENTS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const grain = request.grain ?? null;
    if (!grain) {
      // No paper asset: a 1x1 white texel with `enabled = 0`. The generated helper then returns
      // exactly 1.0, so the resolve is bit-identical to having no grain term at all.
      this.#grainTexture = device.createTexture({
        label: "studio-gpu-bristle-grain-null",
        size: { width: 1, height: 1 },
        format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture(
        { texture: this.#grainTexture },
        new Uint8Array([255]),
        { bytesPerRow: 1 },
        { width: 1, height: 1 },
      );
      device.queue.writeBuffer(
        this.#grainUniformBuffer,
        0,
        new Float32Array([0, 0, 0, 0, 1, 0, 0, 0]),
      );
      return;
    }
    const { width, height } = grain.plan.source.asset;
    this.#grainTexture = device.createTexture({
      label: "studio-gpu-bristle-grain",
      size: { width, height },
      format: "r8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    // `writeTexture` from CPU data carries no 256-byte row requirement (that is a
    // copyBufferToTexture rule), so the tightly packed decoded payload goes straight across.
    const staging = new Uint8Array(width * height);
    staging.set(grain.bytes.subarray(0, width * height));
    device.queue.writeTexture(
      { texture: this.#grainTexture },
      staging,
      { bytesPerRow: width },
      { width, height },
    );
    staging.fill(0);
    device.queue.writeBuffer(
      this.#grainUniformBuffer,
      0,
      packStudioWebGpuR8GrainNativeUniform(grain.plan.parameters),
    );
  }

  advance(request: StudioGpuBristleAdvanceRequest): StudioGpuBristleRuntimeStatus {
    if (this.status !== "ready") return this.status;
    const device = this.#device;
    const pipelines = this.#pipelines;
    const config = this.#config;
    const surface = this.#surface;
    if (
      !device
      || !pipelines
      || !config
      || !surface
      || !this.#tuftBuffer
      || !this.#depositBuffer
      || !this.#stationBuffer
      || !this.#bristleBuffer
      || !this.#splatBuffer
      || !this.#drawBuffer
      || !this.#viewportBuffer
      || !this.#paintTexture
      || !this.#heightTexture
    ) {
      return this.status;
    }
    const stations = request.stations.slice(
      0,
      STUDIO_GPU_BRISTLE_LIMITS.maxStationsPerBatch,
    );
    if (stations.length === 0) return this.status;

    const speedWindow = this.#windowedSpeeds(stations);
    device.queue.writeBuffer(
      this.#stationBuffer,
      0,
      packStudioGpuBristleStations(stations, speedWindow),
    );
    device.queue.writeBuffer(
      this.#depositBuffer,
      0,
      packStudioGpuBristleDepositUniform(config, request.place),
    );
    const tuft = writeStudioGpuBristleTuftUniform(createStudioGpuBristleTuftUniform(), {
      bristleCount: config.bristleCount,
      verticesPerBristle: config.verticesPerBristle,
      iterations: config.iterations,
      stationCount: stations.length,
      // `Tuft.physics.x` is the millisecond→second scale; the per-station dt travels in `pose.w`.
      dt: MS_TO_SECONDS,
      gravity: config.gravity,
      damping: config.damping,
      stiffnessVariation: config.stiffnessVariation,
      bristleLength: config.bristleLength,
      jitter: config.bristleJitter,
      baseRadiusPx: config.baseRadiusPx,
      zThreshold: config.zThreshold,
      headX: this.#lastStation?.x ?? stations[0]!.x,
      headY: this.#lastStation?.y ?? stations[0]!.y,
      brushHeight: config.brushHeight,
      filteredSpeed: speedWindow[speedWindow.length - 1] ?? 0,
    });
    device.queue.writeBuffer(this.#tuftBuffer, 0, tuft);

    const encoder = device.createCommandEncoder({ label: "studio-gpu-bristle-advance" });
    const compute = encoder.beginComputePass({ label: "bristle-solve" });
    compute.setPipeline(pipelines.solve);
    compute.setBindGroup(
      0,
      device.createBindGroup({
        layout: pipelines.solveLayout,
        entries: [
          { binding: 0, resource: { buffer: this.#tuftBuffer } },
          { binding: 1, resource: { buffer: this.#stationBuffer } },
          { binding: 2, resource: { buffer: this.#bristleBuffer } },
          { binding: 3, resource: { buffer: this.#splatBuffer } },
          { binding: 4, resource: { buffer: this.#depositBuffer } },
          { binding: 5, resource: { buffer: this.#drawBuffer } },
        ],
      }),
    );
    compute.dispatchWorkgroups(1, 1, 1);
    compute.end();

    const loadOp: GPULoadOp = request.place ? "clear" : "load";
    const deposit = encoder.beginRenderPass({
      label: "splat-deposit",
      colorAttachments: [
        {
          view: this.#paintTexture.createView(),
          loadOp,
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
        {
          view: this.#heightTexture.createView(),
          loadOp,
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    deposit.setPipeline(pipelines.splat);
    deposit.setBindGroup(
      0,
      device.createBindGroup({
        layout: pipelines.splatLayout,
        entries: [
          { binding: 0, resource: { buffer: this.#viewportBuffer } },
          { binding: 1, resource: { buffer: this.#splatBuffer } },
        ],
      }),
    );
    deposit.draw(6, stations.length * config.bristleCount, 0, 0);
    deposit.end();

    device.queue.submit([encoder.finish()]);
    this.#lastStation = stations[stations.length - 1] ?? this.#lastStation;
    return this.#status;
  }

  /** Reference `pushSpeed`: peak of the last `previousSpeeds` raw speeds, carried across batches. */
  #windowedSpeeds(stations: readonly StudioGpuBristleStation[]): number[] {
    const window = STUDIO_FLUID_PAINT_BRUSH.previousSpeeds;
    const out: number[] = [];
    let previous = this.#lastStation;
    for (const station of stations) {
      const dtSeconds = clampStudioGpuBristleStationDtMs(station.dtMs) / 1000;
      const travelled = previous
        ? Math.hypot(station.x - previous.x, station.y - previous.y)
        : 0;
      const raw =
        station.speed !== undefined && Number.isFinite(station.speed)
          ? Math.abs(station.speed)
          : dtSeconds > 0
            ? travelled / dtSeconds
            : 0;
      this.#speedRing.push(raw);
      if (this.#speedRing.length > window) this.#speedRing.shift();
      let peak = 0;
      for (const value of this.#speedRing) {
        if (value > peak) peak = value;
      }
      out.push(peak);
      previous = station;
    }
    return out;
  }

  present(): ImageBitmap | null {
    if (this.status !== "ready") return null;
    const device = this.#device;
    const context = this.#context;
    const pipelines = this.#pipelines;
    const surface = this.#surface;
    if (
      !device
      || !context
      || !pipelines
      || !surface
      || !this.#displayBuffer
      || !this.#paintTexture
      || !this.#heightTexture
      || !this.#grainTexture
      || !this.#grainSampler
      || !this.#grainUniformBuffer
    ) {
      return null;
    }
    const grainOrigin = this.#grainOriginUv(surface);
    device.queue.writeBuffer(
      this.#displayBuffer,
      0,
      packStudioGpuBristleDisplayUniform(surface, grainOrigin, this.#opacity),
    );
    const encoder = device.createCommandEncoder({ label: "studio-gpu-bristle-present" });
    const pass = encoder.beginRenderPass({
      label: "impasto-resolve",
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    pass.setPipeline(pipelines.resolve);
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: pipelines.resolveLayout,
        entries: [
          { binding: 0, resource: { buffer: this.#displayBuffer } },
          { binding: 1, resource: this.#paintTexture.createView() },
          { binding: 2, resource: this.#heightTexture.createView() },
        ],
      }),
    );
    pass.setBindGroup(
      1,
      device.createBindGroup({
        layout: pipelines.grainLayout,
        entries: [
          { binding: 0, resource: this.#grainTexture.createView() },
          { binding: 1, resource: this.#grainSampler },
          { binding: 2, resource: { buffer: this.#grainUniformBuffer } },
        ],
      }),
    );
    pass.draw(3, 1, 0, 0);
    pass.end();
    device.queue.submit([encoder.finish()]);
    try {
      return this.#canvas.transferToImageBitmap();
    } catch {
      return null;
    }
  }

  #grainOriginUv(surface: StudioGpuBristleSurface): readonly [number, number] {
    const plan = this.#grainPlan;
    if (!plan) return [0, 0] as const;
    return (
      studioWebGpuR8GrainDabCenterUv(plan.parameters, surface.originX, surface.originY)
      ?? ([0, 0] as const)
    );
  }

  async readBristleState(): Promise<Float32Array | null> {
    return this.#readBuffer(this.#bristleBuffer);
  }

  async readSplatSlots(): Promise<Float32Array | null> {
    return this.#readBuffer(this.#splatBuffer);
  }

  async #readBuffer(source: GPUBuffer | null): Promise<Float32Array | null> {
    const device = this.#device;
    if (!device || !source || this.status !== "ready") return null;
    const staging = device.createBuffer({
      label: "studio-gpu-bristle-readback",
      size: source.size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: "studio-gpu-bristle-readback" });
    encoder.copyBufferToBuffer(source, 0, staging, 0, source.size);
    device.queue.submit([encoder.finish()]);
    try {
      await staging.mapAsync(GPUMapMode.READ);
      const copy = new Float32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      return copy;
    } catch {
      return null;
    } finally {
      staging.destroy();
    }
  }

  #releaseStrokeResources(): void {
    for (const resource of [
      this.#tuftBuffer,
      this.#depositBuffer,
      this.#stationBuffer,
      this.#bristleBuffer,
      this.#splatBuffer,
      this.#drawBuffer,
      this.#viewportBuffer,
      this.#displayBuffer,
      this.#grainUniformBuffer,
    ]) {
      try {
        resource?.destroy();
      } catch {
        // A lost device invalidates every handle; destruction is best effort.
      }
    }
    for (const texture of [this.#paintTexture, this.#heightTexture, this.#grainTexture]) {
      try {
        texture?.destroy();
      } catch {
        // Same.
      }
    }
    this.#tuftBuffer = null;
    this.#depositBuffer = null;
    this.#stationBuffer = null;
    this.#bristleBuffer = null;
    this.#splatBuffer = null;
    this.#drawBuffer = null;
    this.#viewportBuffer = null;
    this.#displayBuffer = null;
    this.#grainUniformBuffer = null;
    this.#paintTexture = null;
    this.#heightTexture = null;
    this.#grainTexture = null;
    this.#residentBytes = 0;
  }

  get residentBytes(): number {
    return this.#residentBytes;
  }

  dispose(): void {
    if (this.#status === "disposed") return;
    this.#releaseStrokeResources();
    this.#unsubscribeLoss?.();
    this.#unsubscribeLoss = null;
    this.#pipelines = null;
    this.#config = null;
    this.#surface = null;
    this.#layout = null;
    this.#lease?.release();
    this.#lease = null;
    this.#device = null;
    this.#context = null;
    this.#status = "disposed";
  }
}

export interface StudioGpuBristleRuntimeResult {
  readonly status: StudioGpuBristleRuntimeStatus;
  readonly runtime: StudioGpuBristleRuntime | null;
  readonly reason: string;
}

/**
 * Acquire the selected WebGPU lane. Every failure returns a named status and a null runtime so
 * the caller can end the operation as unavailable without painting through another carrier.
 */
export async function createStudioGpuBristleRuntime(
  options: StudioGpuBristleRuntimeOptions,
): Promise<StudioGpuBristleRuntimeResult> {
  const canvas = options.canvas;
  if (!canvas || typeof canvas.getContext !== "function") {
    return { status: "surface-unavailable", runtime: null, reason: "no OffscreenCanvas" };
  }
  const gpu =
    options.gpu !== undefined
      ? options.gpu
      : ((globalThis as { navigator?: { gpu?: GPU } }).navigator?.gpu ?? null);
  if (!gpu) {
    return { status: "webgpu-unavailable", runtime: null, reason: "navigator.gpu absent" };
  }
  let lease: StudioGpuDeviceLease | null;
  try {
    lease = await acquireStudioGpuDevice({ gpu });
  } catch {
    lease = null;
  }
  if (!lease) {
    return { status: "device-unavailable", runtime: null, reason: "no device lease" };
  }
  if (lease.lost) {
    lease.release();
    return { status: "device-lost", runtime: null, reason: "lease already lost" };
  }
  let context: GPUCanvasContext | null;
  try {
    context = canvas.getContext("webgpu") as GPUCanvasContext | null;
  } catch {
    context = null;
  }
  if (!context) {
    lease.release();
    return { status: "surface-unavailable", runtime: null, reason: "no webgpu context" };
  }
  const presentationFormat =
    typeof gpu.getPreferredCanvasFormat === "function"
      ? gpu.getPreferredCanvasFormat()
      : ("bgra8unorm" as GPUTextureFormat);
  const runtime = new StudioGpuBristleWebGpuRuntime(
    lease,
    canvas,
    context,
    presentationFormat,
  );
  return { status: runtime.status, runtime, reason: "" };
}

export { StudioGpuBristleWebGpuRuntime };
