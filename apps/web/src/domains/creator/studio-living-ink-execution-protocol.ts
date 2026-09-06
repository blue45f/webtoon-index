import type {
  StudioLivingInkBounds,
  StudioLivingInkOperation,
} from "./studio-living-ink-field";
import type {
  StudioLivingInkDisplayMode,
  StudioLivingInkMaterialControls,
} from "./studio-living-ink-gpu-protocol";

export const STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION = 1 as const;
export const STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION =
  "1.3.0-bounded-density-truthful-readback" as const;

/**
 * Physical envelope for paper-granulation modulation of pigment extinction.
 *
 * Granulation redistributes optical density; it cannot create negative pigment or unbounded
 * extinction. One sixteenth keeps valleys absorptive instead of punching white holes, while eight
 * times the base density retains four visible stops of sediment concentration. The final
 * Beer-Lambert density is capped separately because values above 32 are indistinguishable from
 * black after RGBA8 quantisation.
 */
export const STUDIO_LIVING_INK_GRANULATION_MULTIPLIER_BOUNDS = Object.freeze({
  minimum: 1 / 16,
  maximum: 8,
} as const);
export const STUDIO_LIVING_INK_MAXIMUM_OPTICAL_DENSITY = 32 as const;

/**
 * Numeric contract of the wet-media fluid, shared by the WGSL kernels (through uniforms), the GLSL
 * ES 3.00 kernels, the CPU reference solver and the quality gates. These are the certified WebGL2
 * constants; the WebGPU path transcribes them rather than inventing a second fluid.
 *
 * It lives in the protocol — not in the shader library — so a planner or a settings panel can read
 * the numbers without pulling several kilobytes of WGSL text into the application chunk.
 */
export const STUDIO_LIVING_INK_FLUID_DEFAULTS = Object.freeze({
  /** Velocity is frozen on dry paper: smoothstep gate on surface wetness. */
  velocityWetGate: Object.freeze({ minimum: 0.004, maximum: 0.24 }),
  /** Pigment mobility gate — dry paper never bleeds, however strong the wash. */
  pigmentWetGate: Object.freeze({ minimum: 0.015, maximum: 0.46 }),
  velocityDampingBase: 3,
  velocityDampingFlowGain: 2.35,
  /** Extra velocity kill while a fixation pass is settling the surface. */
  fixingVelocityDamping: 7,
  /** Confinement strength = base + gain × material.vorticity. */
  vorticityBase: 0.6,
  vorticityGain: 6,
  velocityClamp: 3,
  /** Water advects at 0.6× the pigment rate: the front lags the flow. */
  wetAdvectionScale: 0.6,
  wetCeiling: 4,
  creepBlendGain: 0.29,
  creepBlendCeiling: 0.38,
  creepReachGain: 3,
  creepFarReach: 1.4,
  frontAdvanceGain: 0.105,
  pigmentCapillaryBase: 0.22,
  pigmentCapillaryGain: 0.68,
  pigmentTransportBase: 6,
  pigmentTransportBleedGain: 9,
  pigmentTransportCeiling: 0.24,
  /** Channel-asymmetric chromatography shift, in fine texels per second at C = 1. */
  chromaShiftScale: 20,
  chromaGreenShiftScale: 0.15,
  chromaBlueShiftScale: 1.35,
  pigmentDiffusionDtScale: 9,
  pigmentDiffusionCeiling: 0.28,
  pigmentChannelCeiling: 0.92,
  pigmentWhiteChannelGain: 1.05,
  minimumDryTimeSeconds: 2,
  maximumDryTimeSeconds: 18,
  fixingDryTimeSeconds: 0.25,
  /**
   * 12 is bounded from both sides by measurement, not picked for convergence.
   *
   * Floor — the browser probe's isolated-wash radial-shape gate fails at 4 sweeps and passes at
   * 12: `maximumAdjacentJumpRatio` 0.2183 → 0.1838 against a 0.2 limit. Under-projecting leaves
   * the residual divergence of each dab impulse in the velocity field, and the wash edge folds
   * into visible facets. (`lineWashHeightExpansion` 35→34 and `wetSheenAndBloomDifference`
   * 57.5→55.8 stay above their 32.5 / 54.6 oracle floors.)
   *
   * Ceiling — do NOT raise it further to chase the residual curve. A dwell water mark injects a
   * deliberately *divergent* capillary impulse (a wet brush physically adds water), and pressure
   * projection removes divergence by construction, so past a point the solver deletes the very
   * outflow that hollows a dab. The `capillaryOutflow` gate in the fluid lab measures exactly
   * this: rim/core pigment transport falls monotonically as sweeps rise.
   */
  interactivePressureIterations: 12,
  settlePressureIterations: 22,
  maximumPressureIterations: 64,
  coarseVelocityScales: Object.freeze([2, 4, 8] as const),
} as const);

export type StudioLivingInkCoarseVelocityScale =
  (typeof STUDIO_LIVING_INK_FLUID_DEFAULTS.coarseVelocityScales)[number];

export interface StudioLivingInkCoarseVelocityGrid {
  readonly width: number;
  readonly height: number;
  readonly scale: StudioLivingInkCoarseVelocityScale;
}

/**
 * Picks the coarse velocity/pressure grid. `coarseBase` is the target cell count on the long edge
 * (128/192/256); the returned scale is snapped to the planner's 2/4/8 family so a plan and its
 * executor always agree on resource sizes.
 */
export function studioLivingInkCoarseVelocityGrid(
  fieldWidth: number,
  fieldHeight: number,
  coarseBase: number,
): StudioLivingInkCoarseVelocityGrid {
  const longEdge = Math.max(1, Math.max(fieldWidth, fieldHeight));
  const target = Math.max(1, coarseBase);
  const scales = STUDIO_LIVING_INK_FLUID_DEFAULTS.coarseVelocityScales;
  let scale: StudioLivingInkCoarseVelocityScale = scales[0];
  for (const candidate of scales) {
    if (longEdge / candidate >= target) scale = candidate;
  }
  return Object.freeze({
    width: Math.max(2, Math.ceil(fieldWidth / scale)),
    height: Math.max(2, Math.ceil(fieldHeight / scale)),
    scale,
  });
}

/** Per-step velocity retention. Higher `flow` keeps the wash moving for longer. */
export function studioLivingInkVelocityDamping(
  flow: number,
  dt: number,
  fixing: boolean,
): number {
  const clampedFlow = Math.min(1, Math.max(0, flow));
  const base = Math.exp(
    -dt
      * (STUDIO_LIVING_INK_FLUID_DEFAULTS.velocityDampingBase
        - clampedFlow * STUDIO_LIVING_INK_FLUID_DEFAULTS.velocityDampingFlowGain),
  );
  return fixing
    ? base * Math.exp(-dt * STUDIO_LIVING_INK_FLUID_DEFAULTS.fixingVelocityDamping)
    : base;
}

/** Vorticity confinement strength — what keeps ink plumes alive instead of dissolving to a blur. */
export function studioLivingInkVorticityStrength(vorticity: number): number {
  const clamped = Math.min(1, Math.max(0, vorticity));
  return STUDIO_LIVING_INK_FLUID_DEFAULTS.vorticityBase
    + clamped * STUDIO_LIVING_INK_FLUID_DEFAULTS.vorticityGain;
}

/** Drying time constant in seconds, mapped from the material control to the 2…18s product range. */
export function studioLivingInkDryWindowSeconds(dryRate: number): number {
  const clamped = Math.min(1, Math.max(0, dryRate));
  const { minimumDryTimeSeconds, maximumDryTimeSeconds } = STUDIO_LIVING_INK_FLUID_DEFAULTS;
  return minimumDryTimeSeconds + (1 - clamped) * (maximumDryTimeSeconds - minimumDryTimeSeconds);
}

/** Per-step evaporation multiplier on surface water. */
export function studioLivingInkEvaporationMultiplier(
  dryRate: number,
  dt: number,
  fixing: boolean,
): number {
  const window = fixing
    ? STUDIO_LIVING_INK_FLUID_DEFAULTS.fixingDryTimeSeconds
    : studioLivingInkDryWindowSeconds(dryRate);
  return Math.exp(-dt / Math.max(1e-3, window));
}

export const STUDIO_LIVING_INK_EXECUTION_LIMITS = Object.freeze({
  maximumFineDimension: 2_048,
  maximumDisplayDimension: 4_096,
  maximumMarksPerRequest: 4_096,
  maximumAdvanceTicks: 1_080,
  maximumJournalOperations: 512,
  /**
   * Live stroke budget. Sweeps run on the coarse velocity grid, so they are cheap — but cheap is
   * not a reason to raise the count: see the note on `interactivePressureIterations` above.
   * Measured residual/cost curve: tests/benchmarks/results/living-ink-fluid.json.
   */
  interactivePressureIterations:
    STUDIO_LIVING_INK_FLUID_DEFAULTS.interactivePressureIterations,
  settlePressureIterations: STUDIO_LIVING_INK_FLUID_DEFAULTS.settlePressureIterations,
  fixedTimeStepSeconds: 1 / 60,
  fixDurationSeconds: 1.2,
  minimumDryTimeSeconds: STUDIO_LIVING_INK_FLUID_DEFAULTS.minimumDryTimeSeconds,
  maximumDryTimeSeconds: STUDIO_LIVING_INK_FLUID_DEFAULTS.maximumDryTimeSeconds,
  dirtyTileSize: 32,
} as const);

/**
 * The four axes the watercolour-bleed surface exposes to a person. Every other engine number is
 * derived from these plus the field size (see `studioLivingInkFluidPlan`), so a settings panel can
 * be built straight off this table without inventing its own ranges or copy.
 */
export const STUDIO_LIVING_INK_FLUID_AXES = Object.freeze([
  Object.freeze({
    id: "bleed",
    materialKey: "bleed",
    label: "번짐",
    description: "물길을 따라 안료가 퍼지는 정도",
    minimum: 0,
    maximum: 1,
  }),
  Object.freeze({
    id: "flow",
    materialKey: "flow",
    label: "유동",
    description: "붓이 만든 흐름이 얼마나 오래 살아 움직이는지",
    minimum: 0,
    maximum: 1,
  }),
  Object.freeze({
    id: "dry",
    materialKey: "dryRate",
    label: "건조",
    description: "물이 마르는 속도 — 마른 자리에서는 더 이상 번지지 않는다",
    minimum: 0,
    maximum: 1,
  }),
  Object.freeze({
    id: "chroma",
    materialKey: "chromaticSeparation",
    label: "색분리",
    description: "안료가 채널별로 다른 속도로 퍼지며 생기는 색 갈라짐",
    minimum: 0,
    maximum: 1,
  }),
] as const satisfies readonly Readonly<{
  id: string;
  materialKey: keyof StudioLivingInkMaterialControls;
  label: string;
  description: string;
  minimum: number;
  maximum: number;
}>[]);

export type StudioLivingInkFluidAxisId = (typeof STUDIO_LIVING_INK_FLUID_AXES)[number]["id"];

export interface StudioLivingInkFluidPlan {
  readonly quality: "interactive" | "settle";
  readonly pressureIterations: number;
  readonly coarseVelocityScale: StudioLivingInkCoarseVelocityScale;
  readonly coarseWidth: number;
  readonly coarseHeight: number;
  readonly vorticityStrength: number;
  readonly dryWindowSeconds: number;
  readonly velocityWetGate: Readonly<{ minimum: number; maximum: number }>;
  readonly pigmentWetGate: Readonly<{ minimum: number; maximum: number }>;
  /** Coarse-grid cell writes per fixed tick, for frame-budget accounting. */
  readonly coarseCellUpdatesPerTick: number;
  /** Full-resolution cell writes per fixed tick. */
  readonly fineCellUpdatesPerTick: number;
}

/**
 * Resolves the engine-side fluid parameters from the product-visible material controls. Runtimes
 * must not invent their own iteration counts or grid scales: this is the one place a plan and its
 * executor agree, and it is what the fluid-quality lab measures.
 */
export function studioLivingInkFluidPlan(
  config: StudioLivingInkExecutionConfig,
  quality: "interactive" | "settle",
): StudioLivingInkFluidPlan {
  const coarse = studioLivingInkCoarseVelocityGrid(
    config.fieldWidth,
    config.fieldHeight,
    config.coarseBase,
  );
  const pressureIterations = quality === "settle"
    ? STUDIO_LIVING_INK_EXECUTION_LIMITS.settlePressureIterations
    : STUDIO_LIVING_INK_EXECUTION_LIMITS.interactivePressureIterations;
  const coarseCells = coarse.width * coarse.height;
  const fineCells = config.fieldWidth * config.fieldHeight;
  return Object.freeze({
    quality,
    pressureIterations,
    coarseVelocityScale: coarse.scale,
    coarseWidth: coarse.width,
    coarseHeight: coarse.height,
    vorticityStrength: studioLivingInkVorticityStrength(config.material.vorticity),
    dryWindowSeconds: studioLivingInkDryWindowSeconds(config.material.dryRate),
    velocityWetGate: STUDIO_LIVING_INK_FLUID_DEFAULTS.velocityWetGate,
    pigmentWetGate: STUDIO_LIVING_INK_FLUID_DEFAULTS.pigmentWetGate,
    // advect + curl + vorticity + divergence + N jacobi + gradient
    coarseCellUpdatesPerTick: coarseCells * (5 + pressureIterations),
    // wet + pigment advection + pigment diffusion
    fineCellUpdatesPerTick: fineCells * 3,
  });
}

export interface StudioLivingInkExecutionConfig {
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly fieldWidth: number;
  readonly fieldHeight: number;
  readonly coarseBase: 128 | 192 | 256;
  readonly seed: number;
  readonly material: StudioLivingInkMaterialControls;
  readonly displayMode: StudioLivingInkDisplayMode;
}

export type StudioLivingInkExecutionBackend =
  | "webgl2-offscreen-half-float"
  | "webgpu-offscreen-half-float";

/**
 * Provider chosen before a Worker execution epoch starts. This is intentionally separate from the
 * receipt backend: callers select one provider id, while receipts name the exact implementation
 * that actually produced pixels. A Worker must never substitute the other provider mid-epoch.
 */
export type StudioLivingInkExecutionProviderId = "webgl2" | "webgpu";

export interface StudioLivingInkExecutionCapabilities {
  readonly backend: StudioLivingInkExecutionBackend;
  readonly worker: true;
  readonly offscreenCanvas: true;
  readonly webgl2: boolean;
  readonly webgpu: boolean;
  readonly halfFloatRenderable: true;
  readonly rgba16Float: true;
  readonly rg16Float: true;
  readonly r16Float: true;
  readonly maximumTextureSize: number;
  readonly pressureIterations: Readonly<{
    readonly interactive: typeof STUDIO_LIVING_INK_EXECUTION_LIMITS.interactivePressureIterations;
    readonly settle: typeof STUDIO_LIVING_INK_EXECUTION_LIMITS.settlePressureIterations;
  }>;
}

interface StudioLivingInkExecutionReceiptBase {
  readonly kind: "studio-living-ink-execution-receipt";
  readonly version: typeof STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION;
  readonly engineVersion: typeof STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION;
  readonly requestId: number;
  readonly revision: number;
  readonly operationKind: StudioLivingInkOperation["kind"] | "restore";
  readonly displaySha256: `sha256:${string}`;
  /**
   * The hash uses premultiplied colour bytes because those are the RGBA8 values an ImageBitmap
   * preserves exactly across a browser canvas transfer. Straight RGB under partial alpha is
   * quantized during that transfer and therefore cannot be a stable screen/receipt authority.
   * Absent means the original straight-RGBA v1 contract on an older persisted receipt.
   */
  readonly displayHashEncoding?: "premultiplied-rgba8-v2";
  readonly operationSha256: `sha256:${string}`;
  readonly dirtyBounds: StudioLivingInkBounds;
  readonly dirtyTileCount: number;
  readonly passCount: number;
  readonly pressureIterations: number;
  readonly simulationTicks: number;
  readonly elapsedMilliseconds: number;
  readonly fixedPigmentPolicy: "immutable";
  readonly dryingWindowSeconds: number;
  readonly fixDurationSeconds: 1.2;
  readonly determinism: "same-runtime-replay";
  readonly crossDeviceBitExact: false;
  readonly cpuOperationHashCrossDeviceDeterministic: true;
  readonly canonicalFrameAuthority: "first-rendered-rgba8-frame";
  readonly replayValidation: "bounded-visual-parity";
  readonly gpuError: 0;
  readonly imageOwnership: "caller-must-close";
  readonly contextRecovery: "worker-rebuild-journal-replay";
}

export type StudioLivingInkExecutionReadbackProvenance =
  | Readonly<{
      readonly backend: "webgl2-offscreen-half-float";
      readonly displayReadbackOrientation: "webgl-bottom-left-row-major";
      readonly readbackFormat: "rgba8-staging-fbo";
    }>
  | Readonly<{
      readonly backend: "webgpu-offscreen-half-float";
      readonly displayReadbackOrientation: "top-left-row-major";
      readonly readbackFormat: "rgba32float-storage-buffer-to-rgba8";
    }>;

/**
 * A receipt is backend-discriminated: a WebGPU storage-buffer map may never masquerade as a
 * WebGL2 FBO readback. The existing WebGL2 v1 readback-provenance pair remains valid byte-for-byte.
 * Historical WebGPU receipts carrying that WebGL2 pair are intentionally rejected rather than
 * silently coerced; their pixels may still be displayed, but they are not trustworthy provenance
 * evidence.
 */
export type StudioLivingInkExecutionReceipt =
  StudioLivingInkExecutionReceiptBase & StudioLivingInkExecutionReadbackProvenance;

export function isStudioLivingInkExecutionReadbackProvenance(
  value: unknown,
): value is StudioLivingInkExecutionReadbackProvenance {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  if (candidate.backend === "webgl2-offscreen-half-float") {
    return candidate.displayReadbackOrientation === "webgl-bottom-left-row-major"
      && candidate.readbackFormat === "rgba8-staging-fbo";
  }
  if (candidate.backend === "webgpu-offscreen-half-float") {
    return candidate.displayReadbackOrientation === "top-left-row-major"
      && candidate.readbackFormat === "rgba32float-storage-buffer-to-rgba8";
  }
  return false;
}

/**
 * Canonical browser-preserved RGBA8 representation used by Living Ink display receipts.
 *
 * Alpha remains straight; only RGB is premultiplied with integer RGBA8 rounding. A subsequent
 * canvas un-premultiply may choose a neighbouring straight code value, but multiplying that result
 * by alpha recovers these bytes exactly. Transparent placeholder RGB is consequently normalized to
 * zero instead of making otherwise identical clear frames hash differently across GPU backends.
 */
export function canonicalStudioLivingInkDisplayRgba8(
  straightRgba: Uint8Array | Uint8ClampedArray,
): Uint8Array {
  if (straightRgba.byteLength % 4 !== 0) {
    throw new RangeError("Living Ink display RGBA8 length must be divisible by four.");
  }
  const canonical = new Uint8Array(straightRgba.byteLength);
  for (let index = 0; index < straightRgba.byteLength; index += 4) {
    const alpha = straightRgba[index + 3] ?? 0;
    canonical[index] = Math.round(((straightRgba[index] ?? 0) * alpha) / 255);
    canonical[index + 1] = Math.round(((straightRgba[index + 1] ?? 0) * alpha) / 255);
    canonical[index + 2] = Math.round(((straightRgba[index + 2] ?? 0) * alpha) / 255);
    canonical[index + 3] = alpha;
  }
  return canonical;
}

/** Canonicalizes and flips a top-down frame in one allocation for the receipt's bottom-up order. */
export function canonicalStudioLivingInkDisplayRgba8BottomUp(
  straightRgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || straightRgba.byteLength !== width * height * 4
  ) {
    throw new RangeError("Living Ink display dimensions do not match its RGBA8 payload.");
  }
  const canonical = new Uint8Array(straightRgba.byteLength);
  const stride = width * 4;
  for (let sourceRow = 0; sourceRow < height; sourceRow += 1) {
    const destinationRow = height - 1 - sourceRow;
    for (let column = 0; column < width; column += 1) {
      const source = sourceRow * stride + column * 4;
      const destination = destinationRow * stride + column * 4;
      const alpha = straightRgba[source + 3] ?? 0;
      canonical[destination] = Math.round(((straightRgba[source] ?? 0) * alpha) / 255);
      canonical[destination + 1] = Math.round(
        ((straightRgba[source + 1] ?? 0) * alpha) / 255,
      );
      canonical[destination + 2] = Math.round(
        ((straightRgba[source + 2] ?? 0) * alpha) / 255,
      );
      canonical[destination + 3] = alpha;
    }
  }
  return canonical;
}

export interface StudioLivingInkExecutionFrame {
  readonly image: ImageBitmap;
  readonly receipt: StudioLivingInkExecutionReceipt;
}

/**
 * A simulation-only acknowledgement. It deliberately has no display hash or ImageBitmap: the
 * operation is already journaled and visible to the next explicit render, but no synchronous GPU
 * readback or presentation allocation was performed for this request.
 */
export interface StudioLivingInkExecutionApplied {
  readonly kind: "living-ink/applied";
  readonly version: typeof STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION;
  readonly engineVersion: typeof STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION;
  readonly requestId: number;
  readonly revision: number;
  readonly operationKind: StudioLivingInkOperation["kind"];
  readonly operationSha256: `sha256:${string}`;
  readonly backend: StudioLivingInkExecutionBackend;
  readonly dirtyBounds: StudioLivingInkBounds;
  readonly dirtyTileCount: number;
  readonly passCount: number;
  readonly pressureIterations: number;
  readonly simulationTicks: number;
  readonly elapsedMilliseconds: number;
  readonly presented: false;
  readonly displayReadbackCount: 0;
  readonly imageBitmapCount: 0;
}

export type StudioLivingInkExecutionApplyResult =
  | StudioLivingInkExecutionFrame
  | StudioLivingInkExecutionApplied;

export interface StudioLivingInkExecutionApplyOptions {
  readonly simulationTicks?: number;
  readonly quality?: "interactive" | "settle";
  readonly displayMode?: StudioLivingInkDisplayMode;
  /**
   * Defaults to true for compatibility. False applies every operation and advances the journal,
   * while deferring readPixels/ImageBitmap work to an explicit render at the presentation cadence.
   */
  readonly present?: boolean;
}

interface StudioLivingInkWorkerRequestBase {
  readonly version: typeof STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION;
  readonly requestId: number;
}

export type StudioLivingInkWorkerRequest =
  | (StudioLivingInkWorkerRequestBase & Readonly<{
      type: "living-ink/initialize";
      backend: StudioLivingInkExecutionProviderId;
      config: StudioLivingInkExecutionConfig;
    }>)
  | (StudioLivingInkWorkerRequestBase & Readonly<{
      type: "living-ink/apply";
      operation: StudioLivingInkOperation;
      options: StudioLivingInkExecutionApplyOptions;
    }>)
  | (StudioLivingInkWorkerRequestBase & Readonly<{
      type: "living-ink/render";
      displayMode: StudioLivingInkDisplayMode;
    }>)
  | (StudioLivingInkWorkerRequestBase & Readonly<{
      type: "living-ink/cancel";
      targetRequestId: number;
    }>)
  | (StudioLivingInkWorkerRequestBase & Readonly<{
      type: "living-ink/dispose";
    }>);

interface StudioLivingInkWorkerResponseBase {
  readonly version: typeof STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION;
  readonly requestId: number;
}

export type StudioLivingInkWorkerResponse =
  | (StudioLivingInkWorkerResponseBase & Readonly<{
      type: "living-ink/ready";
      capabilities: StudioLivingInkExecutionCapabilities;
    }>)
  | (StudioLivingInkWorkerResponseBase & Readonly<{
      type: "living-ink/frame";
      frame: StudioLivingInkExecutionFrame;
    }>)
  | (StudioLivingInkWorkerResponseBase & Readonly<{
      type: "living-ink/applied";
      applied: StudioLivingInkExecutionApplied;
    }>)
  | (StudioLivingInkWorkerResponseBase & Readonly<{
      type: "living-ink/cancelled";
      targetRequestId: number;
    }>)
  | (StudioLivingInkWorkerResponseBase & Readonly<{
      type: "living-ink/disposed";
    }>)
  | (StudioLivingInkWorkerResponseBase & Readonly<{
      /** Epoch-wide structured-clone/Worker failure; it is not tied to one pending request. */
      type: "living-ink/fatal";
      code: "invalid-message" | "unavailable" | "gpu-failure";
      message: string;
    }>)
  | (StudioLivingInkWorkerResponseBase & Readonly<{
      type: "living-ink/error";
      code:
        | "invalid-message"
        | "unavailable"
        | "not-ready"
        | "gpu-failure"
        | "budget-exceeded"
        | "cancelled";
      message: string;
    }>);

export function studioLivingInkWorkerResponseTransfers(
  response: StudioLivingInkWorkerResponse,
): Transferable[] {
  return response.type === "living-ink/frame" ? [response.frame.image] : [];
}
