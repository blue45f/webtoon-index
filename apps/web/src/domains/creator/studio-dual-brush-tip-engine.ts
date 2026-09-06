/**
 * Independent dual-tip brush oracle.
 *
 * This implementation is specified from public, product-agnostic behavior only: two normalized
 * alpha fields are transformed, sampled and combined. It contains no restricted implementation
 * source, commercial identifiers or copied tuning constants. The CPU path is authoritative; the
 * packed command stream resolves every stochastic choice for future GPU/WASM consumers.
 */

export const STUDIO_DUAL_TIP_CONTRACT_ID = "toonspectrum.dual-tip-alpha";
export const STUDIO_DUAL_TIP_CONTRACT_VERSION = 1 as const;
export const STUDIO_DUAL_TIP_PACKED_STRIDE = 24 as const;

export type StudioDualTipCombineMode =
  | "multiply"
  | "min"
  | "max"
  | "add"
  | "subtract"
  | "intersect";

/**
 * Versioned exact-deposition blend families shared by the CPU oracle and the WebGPU v2 provider.
 *
 * `soft-intersect` is retained only so the legacy packed-command contract can be replayed without
 * silently changing its Łukasiewicz intersection semantics. New dynamic dual-tip plans use the
 * other eight artist-facing families.
 */
export type StudioDualTipExactBlendFamily =
  | "intersect"
  | "darken"
  | "lighten"
  | "multiply"
  | "screen"
  | "add"
  | "subtract"
  | "difference"
  | "soft-intersect";

export type StudioDualTipExactPorterDuff = "source-over" | "destination-out";

export type StudioDualTipPremultipliedLinearRgba = readonly [
  red: number,
  green: number,
  blue: number,
  alpha: number,
];

export interface StudioDualTipExactDepositionPixel {
  /** Coverage after the primary-tip sampler/transfer function, before paint alpha. */
  readonly primaryCoverage: number;
  /** Coverage after the secondary-tip sampler/transfer function, before paint alpha. */
  readonly secondaryCoverage: number;
  /** Fully resolved pressure × flow × opacity contribution for this logical deposition. */
  readonly paintAlpha: number;
  /** Straight scene-linear paint color. Alpha is carried by `paintAlpha`. */
  readonly linearColor: readonly [red: number, green: number, blue: number];
  readonly blendFamily: StudioDualTipExactBlendFamily;
  readonly porterDuff: StudioDualTipExactPorterDuff;
}

export interface StudioDualTipAlphaField {
  readonly width: number;
  readonly height: number;
  /** Row-major, normalized linear coverage in [0, 1]. */
  readonly alpha: readonly number[];
}

export interface StudioDualTipStrokeSample {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
  readonly tiltX?: number;
  readonly tiltY?: number;
  /** Document pixels per second, supplied by the input sampler. */
  readonly velocity?: number;
}

export interface StudioDualTipTransform {
  readonly rotationDegrees?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  /** Secondary-tip-only normalized offset, multiplied by the current diameter. */
  readonly offsetX?: number;
  readonly offsetY?: number;
}

export interface StudioDualTipDynamics {
  /** Multiplier is `1 + gain * (2p - 1)`, clamped positive. */
  readonly pressureSizeGain?: number;
  /** Opacity factor mixes 1 toward pressure by this amount. */
  readonly pressureOpacityGain?: number;
  /** Area-preserving stretch along the supplied tilt direction. */
  readonly tiltStretchGain?: number;
  /** Fraction of tilt direction added to both tip rotations. */
  readonly tiltRotationGain?: number;
  /** Velocity factor is `1 - gain * v/(v+referenceVelocity)`. */
  readonly velocitySizeGain?: number;
  readonly velocityOpacityGain?: number;
  readonly referenceVelocity?: number;
}

export interface StudioDualTipJitter {
  /** Maximum centre displacement as a fraction of current diameter. */
  readonly position?: number;
  /** Symmetric maximum rotation in degrees. */
  readonly rotationDegrees?: number;
  /** Symmetric fractional scale change. */
  readonly scale?: number;
  /** Symmetric fractional opacity change. */
  readonly opacity?: number;
}

export interface StudioDualTipOutputSurface {
  readonly width: number;
  readonly height: number;
  readonly originX?: number;
  readonly originY?: number;
}

export interface StudioDualTipRequest {
  readonly contractVersion: typeof STUDIO_DUAL_TIP_CONTRACT_VERSION;
  readonly primary: StudioDualTipAlphaField;
  readonly secondary: StudioDualTipAlphaField;
  readonly samples: readonly StudioDualTipStrokeSample[];
  readonly combineMode: StudioDualTipCombineMode;
  readonly diameter: number;
  /** Base-diameter fraction between stamps. */
  readonly spacingRatio: number;
  readonly seed: number;
  readonly opacity?: number;
  readonly linearColor?: readonly [number, number, number];
  readonly primaryTransform?: StudioDualTipTransform;
  readonly secondaryTransform?: StudioDualTipTransform;
  readonly dynamics?: StudioDualTipDynamics;
  readonly jitter?: StudioDualTipJitter;
  readonly output: StudioDualTipOutputSurface;
  /** CPU sampling/compositing upper bound. Default 16M, hard maximum 64M work units. */
  readonly workBudget?: number;
}

export const STUDIO_DUAL_TIP_PACKED_LAYOUT = Object.freeze([
  "centerX",
  "centerY",
  "diameter",
  "opacity",
  "primaryRotationRadians",
  "primaryScaleX",
  "primaryScaleY",
  "secondaryRotationRadians",
  "secondaryScaleX",
  "secondaryScaleY",
  "secondaryOffsetX",
  "secondaryOffsetY",
  "combineModeCode",
  "linearRed",
  "linearGreen",
  "linearBlue",
  "sampleOrdinal",
  "pressure",
  "tiltX",
  "tiltY",
  "velocity",
  "reserved0",
  "reserved1",
  "reserved2",
] as const);

export interface StudioDualTipPackedCommands {
  readonly kind: "studio-dual-tip-packed-f32";
  readonly layoutVersion: 1;
  readonly scalar: "float32";
  readonly byteOrder: "little-endian";
  readonly stride: typeof STUDIO_DUAL_TIP_PACKED_STRIDE;
  readonly layout: typeof STUDIO_DUAL_TIP_PACKED_LAYOUT;
  readonly count: number;
  /** Serializable F32 values. Consumers may copy directly into Float32Array. */
  readonly values: readonly number[];
}

export interface StudioDualTipReceipt {
  readonly contractId: typeof STUDIO_DUAL_TIP_CONTRACT_ID;
  readonly contractVersion: typeof STUDIO_DUAL_TIP_CONTRACT_VERSION;
  readonly algorithmVersion: string;
  readonly provenance: "clean-room-public-behavior";
  readonly executionSource: "toonspectrum-independent-core";
  readonly restrictedSourcePolicy: "prohibited-direct-port";
  readonly goldenCorpusOwnership: "toonspectrum-independent-behavior-corpus";
  readonly alphaContract: "premultiplied-linear-rgba-f32";
  readonly authority: "cpu-f32-oracle";
  readonly packedCommandContract: "gpu-wasm-ready-f32-v1";
  readonly combineModes: readonly StudioDualTipCombineMode[];
}

const STUDIO_DUAL_TIP_COMBINE_MODES: readonly StudioDualTipCombineMode[] = Object.freeze([
  "multiply",
  "min",
  "max",
  "add",
  "subtract",
  "intersect",
]);

export const STUDIO_DUAL_TIP_RECEIPT: StudioDualTipReceipt = Object.freeze({
  contractId: STUDIO_DUAL_TIP_CONTRACT_ID,
  contractVersion: STUDIO_DUAL_TIP_CONTRACT_VERSION,
  algorithmVersion: "2026.07.27.1",
  provenance: "clean-room-public-behavior",
  executionSource: "toonspectrum-independent-core",
  restrictedSourcePolicy: "prohibited-direct-port",
  goldenCorpusOwnership: "toonspectrum-independent-behavior-corpus",
  alphaContract: "premultiplied-linear-rgba-f32",
  authority: "cpu-f32-oracle",
  packedCommandContract: "gpu-wasm-ready-f32-v1",
  combineModes: STUDIO_DUAL_TIP_COMBINE_MODES,
});

export interface StudioDualTipArtifact {
  readonly kind: "studio-dual-tip-artifact";
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
  readonly stampCount: number;
  readonly workUnits: number;
  readonly premultipliedLinearRgba: readonly number[];
  readonly commands: StudioDualTipPackedCommands;
  readonly receipt: StudioDualTipReceipt;
}

export type StudioDualTipErrorCode =
  | "budget-exceeded"
  | "empty-output"
  | "invalid-request";

export type StudioDualTipResult =
  | {
      readonly ok: true;
      readonly artifact: StudioDualTipArtifact;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: StudioDualTipErrorCode;
        readonly stage: "validation" | "planning" | "raster";
      };
    };

interface NormalizedTransform {
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

interface NormalizedDynamics {
  readonly pressureSizeGain: number;
  readonly pressureOpacityGain: number;
  readonly tiltStretchGain: number;
  readonly tiltRotationGain: number;
  readonly velocitySizeGain: number;
  readonly velocityOpacityGain: number;
  readonly referenceVelocity: number;
}

interface NormalizedJitter {
  readonly position: number;
  readonly rotation: number;
  readonly scale: number;
  readonly opacity: number;
}

interface NormalizedRequest {
  readonly primary: StudioDualTipAlphaField;
  readonly secondary: StudioDualTipAlphaField;
  readonly samples: readonly Required<StudioDualTipStrokeSample>[];
  readonly combineMode: StudioDualTipCombineMode;
  readonly diameter: number;
  readonly spacing: number;
  readonly seed: number;
  readonly opacity: number;
  readonly color: readonly [number, number, number];
  readonly primaryTransform: NormalizedTransform;
  readonly secondaryTransform: NormalizedTransform;
  readonly dynamics: NormalizedDynamics;
  readonly jitter: NormalizedJitter;
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
  readonly workBudget: number;
}

interface ResolvedStamp {
  readonly centerX: number;
  readonly centerY: number;
  readonly diameter: number;
  readonly opacity: number;
  readonly primaryRotation: number;
  readonly primaryScaleX: number;
  readonly primaryScaleY: number;
  readonly secondaryRotation: number;
  readonly secondaryScaleX: number;
  readonly secondaryScaleY: number;
  readonly secondaryOffsetX: number;
  readonly secondaryOffsetY: number;
  readonly sampleOrdinal: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly velocity: number;
}

interface PlannedStamps {
  readonly stamps: readonly ResolvedStamp[];
  readonly workUnits: number;
}

const MAX_FIELD_EDGE = 512;
const MAX_FIELD_TEXELS = MAX_FIELD_EDGE * MAX_FIELD_EDGE;
const MAX_SAMPLES = 10_000;
const MAX_STAMPS = 8_192;
const MAX_OUTPUT_EDGE = 2_048;
const DEFAULT_WORK_BUDGET = 16_000_000;
const MAX_WORK_BUDGET = 64_000_000;
const MIN_SCALE = 1 / 64;

const COMBINE_MODE_CODE: Readonly<Record<StudioDualTipCombineMode, number>> = Object.freeze({
  multiply: 0,
  min: 1,
  max: 2,
  add: 3,
  subtract: 4,
  intersect: 5,
});

function failure(
  code: StudioDualTipErrorCode,
  stage: "validation" | "planning" | "raster"
): StudioDualTipResult {
  return Object.freeze({ ok: false, error: Object.freeze({ code, stage }) });
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function normalizedField(field: StudioDualTipAlphaField): StudioDualTipAlphaField | null {
  if (
    !field
    || !Number.isInteger(field.width)
    || !Number.isInteger(field.height)
    || field.width < 1
    || field.height < 1
    || field.width > MAX_FIELD_EDGE
    || field.height > MAX_FIELD_EDGE
    || field.width * field.height > MAX_FIELD_TEXELS
    || !Array.isArray(field.alpha)
    || field.alpha.length !== field.width * field.height
    || !field.alpha.every((alpha) => finiteInRange(alpha, 0, 1))
  ) {
    return null;
  }
  return Object.freeze({
    width: field.width,
    height: field.height,
    alpha: Object.freeze([...field.alpha]),
  });
}

function normalizedTransform(
  transform: StudioDualTipTransform | undefined,
  secondary: boolean
): NormalizedTransform | null {
  const rotation = transform?.rotationDegrees ?? 0;
  const scaleX = transform?.scaleX ?? 1;
  const scaleY = transform?.scaleY ?? 1;
  const offsetX = transform?.offsetX ?? 0;
  const offsetY = transform?.offsetY ?? 0;
  if (
    !finiteInRange(rotation, -360_000, 360_000)
    || !finiteInRange(scaleX, MIN_SCALE, 64)
    || !finiteInRange(scaleY, MIN_SCALE, 64)
    || !finiteInRange(offsetX, -8, 8)
    || !finiteInRange(offsetY, -8, 8)
    || (!secondary && (offsetX !== 0 || offsetY !== 0))
  ) {
    return null;
  }
  return Object.freeze({
    rotation: rotation * Math.PI / 180,
    scaleX,
    scaleY,
    offsetX,
    offsetY,
  });
}

function normalizedDynamics(dynamics: StudioDualTipDynamics | undefined): NormalizedDynamics | null {
  const value: NormalizedDynamics = {
    pressureSizeGain: dynamics?.pressureSizeGain ?? 0,
    pressureOpacityGain: dynamics?.pressureOpacityGain ?? 0,
    tiltStretchGain: dynamics?.tiltStretchGain ?? 0,
    tiltRotationGain: dynamics?.tiltRotationGain ?? 0,
    velocitySizeGain: dynamics?.velocitySizeGain ?? 0,
    velocityOpacityGain: dynamics?.velocityOpacityGain ?? 0,
    referenceVelocity: dynamics?.referenceVelocity ?? 1_000,
  };
  if (
    !finiteInRange(value.pressureSizeGain, -1, 1)
    || !finiteInRange(value.pressureOpacityGain, 0, 1)
    || !finiteInRange(value.tiltStretchGain, 0, 4)
    || !finiteInRange(value.tiltRotationGain, 0, 1)
    || !finiteInRange(value.velocitySizeGain, 0, 1)
    || !finiteInRange(value.velocityOpacityGain, 0, 1)
    || !finiteInRange(value.referenceVelocity, Number.EPSILON, 1_000_000_000)
  ) {
    return null;
  }
  return Object.freeze(value);
}

function normalizedJitter(jitter: StudioDualTipJitter | undefined): NormalizedJitter | null {
  const value: NormalizedJitter = {
    position: jitter?.position ?? 0,
    rotation: (jitter?.rotationDegrees ?? 0) * Math.PI / 180,
    scale: jitter?.scale ?? 0,
    opacity: jitter?.opacity ?? 0,
  };
  if (
    !finiteInRange(value.position, 0, 4)
    || !finiteInRange(jitter?.rotationDegrees ?? 0, 0, 360)
    || !finiteInRange(value.scale, 0, 0.95)
    || !finiteInRange(value.opacity, 0, 1)
  ) {
    return null;
  }
  return Object.freeze(value);
}

function normalizeRequest(request: StudioDualTipRequest): NormalizedRequest | StudioDualTipResult {
  if (
    !request
    || request.contractVersion !== STUDIO_DUAL_TIP_CONTRACT_VERSION
    || !Array.isArray(request.samples)
    || request.samples.length === 0
    || request.samples.length > MAX_SAMPLES
    || !Object.prototype.hasOwnProperty.call(COMBINE_MODE_CODE, request.combineMode)
    || !finiteInRange(request.diameter, 0.1, 1_024)
    || !finiteInRange(request.spacingRatio, 0.01, 8)
    || !Number.isSafeInteger(request.seed)
    || request.seed <= 0
    || request.seed > 0xffff_ffff
  ) {
    return failure("invalid-request", "validation");
  }
  const primary = normalizedField(request.primary);
  const secondary = normalizedField(request.secondary);
  const primaryTransform = normalizedTransform(request.primaryTransform, false);
  const secondaryTransform = normalizedTransform(request.secondaryTransform, true);
  const dynamics = normalizedDynamics(request.dynamics);
  const jitter = normalizedJitter(request.jitter);
  if (!primary || !secondary || !primaryTransform || !secondaryTransform || !dynamics || !jitter) {
    return failure("invalid-request", "validation");
  }

  const opacity = request.opacity ?? 1;
  const color = request.linearColor ?? [0, 0, 0];
  const width = request.output?.width;
  const height = request.output?.height;
  const originX = request.output?.originX ?? 0;
  const originY = request.output?.originY ?? 0;
  const workBudget = request.workBudget ?? DEFAULT_WORK_BUDGET;
  if (
    !finiteInRange(opacity, 0, 1)
    || !Array.isArray(color)
    || color.length !== 3
    || !color.every((channel) => finiteInRange(channel, 0, 1))
    || !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
    || width > MAX_OUTPUT_EDGE
    || height > MAX_OUTPUT_EDGE
    || !Number.isFinite(originX)
    || !Number.isFinite(originY)
    || !Number.isSafeInteger(workBudget)
    || workBudget < 1
    || workBudget > MAX_WORK_BUDGET
  ) {
    return failure("invalid-request", "validation");
  }

  const samples: Required<StudioDualTipStrokeSample>[] = [];
  for (const sample of request.samples) {
    const pressure = sample?.pressure ?? 0.5;
    const tiltX = sample?.tiltX ?? 0;
    const tiltY = sample?.tiltY ?? 0;
    const velocity = sample?.velocity ?? 0;
    if (
      !sample
      || !Number.isFinite(sample.x)
      || !Number.isFinite(sample.y)
      || !finiteInRange(pressure, 0, 1)
      || !finiteInRange(tiltX, -1, 1)
      || !finiteInRange(tiltY, -1, 1)
      || !finiteInRange(velocity, 0, 1_000_000_000)
    ) {
      return failure("invalid-request", "validation");
    }
    samples.push(Object.freeze({
      x: sample.x,
      y: sample.y,
      pressure,
      tiltX,
      tiltY,
      velocity,
    }));
  }

  return Object.freeze({
    primary,
    secondary,
    samples: Object.freeze(samples),
    combineMode: request.combineMode,
    diameter: request.diameter,
    spacing: request.diameter * request.spacingRatio,
    seed: request.seed,
    opacity,
    color: Object.freeze([...color]) as readonly [number, number, number],
    primaryTransform,
    secondaryTransform,
    dynamics,
    jitter,
    width,
    height,
    originX,
    originY,
    workBudget,
  });
}

class XorShift32 {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0;
  }

  public nextSigned(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0xffff_ffff * 2 - 1;
  }
}

function interpolateSample(
  left: Required<StudioDualTipStrokeSample>,
  right: Required<StudioDualTipStrokeSample>,
  t: number
): Required<StudioDualTipStrokeSample> {
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    x: mix(left.x, right.x),
    y: mix(left.y, right.y),
    pressure: mix(left.pressure, right.pressure),
    tiltX: mix(left.tiltX, right.tiltX),
    tiltY: mix(left.tiltY, right.tiltY),
    velocity: mix(left.velocity, right.velocity),
  };
}

function resampleStroke(
  samples: readonly Required<StudioDualTipStrokeSample>[],
  spacing: number
): readonly Required<StudioDualTipStrokeSample>[] | null {
  if (samples.length === 1) return Object.freeze([samples[0]!]);
  const result: Required<StudioDualTipStrokeSample>[] = [samples[0]!];
  let distanceToNext = spacing;
  let segmentStart = samples[0]!;
  for (let index = 1; index < samples.length; index += 1) {
    const segmentEnd = samples[index]!;
    let dx = segmentEnd.x - segmentStart.x;
    let dy = segmentEnd.y - segmentStart.y;
    let segmentLength = Math.hypot(dx, dy);
    while (segmentLength >= distanceToNext) {
      const t = segmentLength === 0 ? 0 : distanceToNext / segmentLength;
      const stamped = interpolateSample(segmentStart, segmentEnd, t);
      result.push(stamped);
      if (result.length > MAX_STAMPS) return null;
      segmentStart = stamped;
      dx = segmentEnd.x - segmentStart.x;
      dy = segmentEnd.y - segmentStart.y;
      segmentLength = Math.hypot(dx, dy);
      distanceToNext = spacing;
    }
    distanceToNext -= segmentLength;
    segmentStart = segmentEnd;
  }
  const last = samples[samples.length - 1]!;
  const previous = result[result.length - 1]!;
  if (Math.hypot(last.x - previous.x, last.y - previous.y) > Number.EPSILON) result.push(last);
  return result.length > MAX_STAMPS ? null : Object.freeze(result);
}

function resolveStamp(
  sample: Required<StudioDualTipStrokeSample>,
  ordinal: number,
  request: NormalizedRequest,
  random: XorShift32
): ResolvedStamp {
  const pressureSize = Math.max(
    MIN_SCALE,
    1 + request.dynamics.pressureSizeGain * (sample.pressure * 2 - 1)
  );
  const pressureOpacity = (1 - request.dynamics.pressureOpacityGain)
    + request.dynamics.pressureOpacityGain * sample.pressure;
  const velocityUnit = sample.velocity / (sample.velocity + request.dynamics.referenceVelocity);
  const velocitySize = 1 - request.dynamics.velocitySizeGain * velocityUnit;
  const velocityOpacity = 1 - request.dynamics.velocityOpacityGain * velocityUnit;
  const tiltMagnitude = Math.min(1, Math.hypot(sample.tiltX, sample.tiltY));
  const tiltStretch = 1 + request.dynamics.tiltStretchGain * tiltMagnitude;
  const tiltRotation = tiltMagnitude > 0
    ? Math.atan2(sample.tiltY, sample.tiltX) * request.dynamics.tiltRotationGain
    : 0;
  const positionAngle = random.nextSigned() * Math.PI;
  const positionRadius = Math.abs(random.nextSigned())
    * request.jitter.position
    * request.diameter
    * pressureSize
    * velocitySize;
  const rotationJitter = random.nextSigned() * request.jitter.rotation;
  const scaleJitter = Math.max(MIN_SCALE, 1 + random.nextSigned() * request.jitter.scale);
  const opacityJitter = Math.max(0, 1 + random.nextSigned() * request.jitter.opacity);
  const commonScale = pressureSize * velocitySize * scaleJitter;
  const majorScale = commonScale * tiltStretch;
  const minorScale = commonScale / tiltStretch;
  const diameter = Math.fround(request.diameter);

  return Object.freeze({
    centerX: Math.fround(sample.x + Math.cos(positionAngle) * positionRadius),
    centerY: Math.fround(sample.y + Math.sin(positionAngle) * positionRadius),
    diameter,
    opacity: Math.fround(Math.min(
      1,
      request.opacity * pressureOpacity * velocityOpacity * opacityJitter
    )),
    primaryRotation: Math.fround(
      request.primaryTransform.rotation + tiltRotation + rotationJitter
    ),
    primaryScaleX: Math.fround(request.primaryTransform.scaleX * majorScale),
    primaryScaleY: Math.fround(request.primaryTransform.scaleY * minorScale),
    secondaryRotation: Math.fround(
      request.secondaryTransform.rotation + tiltRotation + rotationJitter
    ),
    secondaryScaleX: Math.fround(request.secondaryTransform.scaleX * majorScale),
    secondaryScaleY: Math.fround(request.secondaryTransform.scaleY * minorScale),
    secondaryOffsetX: Math.fround(
      request.secondaryTransform.offsetX * diameter * commonScale
    ),
    secondaryOffsetY: Math.fround(
      request.secondaryTransform.offsetY * diameter * commonScale
    ),
    sampleOrdinal: ordinal,
    pressure: Math.fround(sample.pressure),
    tiltX: Math.fround(sample.tiltX),
    tiltY: Math.fround(sample.tiltY),
    velocity: Math.fround(sample.velocity),
  });
}

function stampHalfExtents(stamp: ResolvedStamp): readonly [number, number] {
  const extent = (
    rotation: number,
    scaleX: number,
    scaleY: number,
    offsetX: number,
    offsetY: number
  ): readonly [number, number] => {
    const halfWidth = stamp.diameter * scaleX / 2;
    const halfHeight = stamp.diameter * scaleY / 2;
    const cosine = Math.abs(Math.cos(rotation));
    const sine = Math.abs(Math.sin(rotation));
    return [
      cosine * halfWidth + sine * halfHeight + Math.abs(offsetX),
      sine * halfWidth + cosine * halfHeight + Math.abs(offsetY),
    ];
  };
  const primary = extent(
    stamp.primaryRotation,
    stamp.primaryScaleX,
    stamp.primaryScaleY,
    0,
    0
  );
  const secondary = extent(
    stamp.secondaryRotation,
    stamp.secondaryScaleX,
    stamp.secondaryScaleY,
    stamp.secondaryOffsetX,
    stamp.secondaryOffsetY
  );
  return [Math.max(primary[0], secondary[0]), Math.max(primary[1], secondary[1])];
}

function clippedStampWork(stamp: ResolvedStamp, request: NormalizedRequest): number {
  const [halfWidth, halfHeight] = stampHalfExtents(stamp);
  const firstX = Math.max(0, Math.floor(stamp.centerX - halfWidth - request.originX));
  const firstY = Math.max(0, Math.floor(stamp.centerY - halfHeight - request.originY));
  const lastX = Math.min(
    request.width - 1,
    Math.ceil(stamp.centerX + halfWidth - request.originX)
  );
  const lastY = Math.min(
    request.height - 1,
    Math.ceil(stamp.centerY + halfHeight - request.originY)
  );
  if (lastX < firstX || lastY < firstY) return 0;
  return (lastX - firstX + 1) * (lastY - firstY + 1);
}

function planStamps(request: NormalizedRequest): PlannedStamps | null {
  const sampled = resampleStroke(request.samples, request.spacing);
  if (!sampled) return null;
  const random = new XorShift32(request.seed);
  const stamps: ResolvedStamp[] = [];
  let workUnits = 0;
  for (let index = 0; index < sampled.length; index += 1) {
    const stamp = resolveStamp(sampled[index]!, index, request, random);
    workUnits += clippedStampWork(stamp, request);
    if (!Number.isSafeInteger(workUnits) || workUnits > request.workBudget) return null;
    stamps.push(stamp);
  }
  return Object.freeze({ stamps: Object.freeze(stamps), workUnits });
}

function bilinearAlpha(field: StudioDualTipAlphaField, u: number, v: number): number {
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
  const x = u * (field.width - 1);
  const y = v * (field.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(field.width - 1, x0 + 1);
  const y1 = Math.min(field.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a00 = field.alpha[y0 * field.width + x0]!;
  const a10 = field.alpha[y0 * field.width + x1]!;
  const a01 = field.alpha[y1 * field.width + x0]!;
  const a11 = field.alpha[y1 * field.width + x1]!;
  const top = a00 + (a10 - a00) * tx;
  const bottom = a01 + (a11 - a01) * tx;
  return top + (bottom - top) * ty;
}

function sampleField(
  field: StudioDualTipAlphaField,
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  diameter: number,
  rotation: number,
  scaleX: number,
  scaleY: number,
  offsetX: number,
  offsetY: number
): number {
  const dx = x - (centerX + offsetX);
  const dy = y - (centerY + offsetY);
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const localX = (cosine * dx + sine * dy) / (diameter * scaleX) + 0.5;
  const localY = (-sine * dx + cosine * dy) / (diameter * scaleY) + 0.5;
  return bilinearAlpha(field, localX, localY);
}

/** Independent fuzzy/linear-alpha definitions; no vendor mode constants are inherited. */
export function combineStudioDualTipAlpha(
  primary: number,
  secondary: number,
  mode: StudioDualTipCombineMode
): number {
  const a = Math.min(1, Math.max(0, primary));
  const b = Math.min(1, Math.max(0, secondary));
  if (mode === "multiply") return a * b;
  if (mode === "min") return Math.min(a, b);
  if (mode === "max") return Math.max(a, b);
  if (mode === "add") return Math.min(1, a + b);
  if (mode === "subtract") return Math.max(0, a - b);
  // Łukasiewicz t-norm: a strict soft intersection distinct from product and minimum.
  return Math.max(0, a + b - 1);
}

/**
 * Exact v2 coverage combination. This function deliberately combines the two coverages belonging
 * to one logical deposition before any canvas accumulation happens.
 */
export function combineStudioDualTipExactCoverageV2(
  primary: number,
  secondary: number,
  family: StudioDualTipExactBlendFamily,
): number {
  const a = Math.min(1, Math.max(0, primary));
  const b = Math.min(1, Math.max(0, secondary));
  if (family === "intersect" || family === "multiply") return a * b;
  if (family === "darken") return Math.min(a, b);
  if (family === "lighten") return Math.max(a, b);
  if (family === "screen") return 1 - (1 - a) * (1 - b);
  if (family === "add") return Math.min(1, a + b);
  if (family === "subtract") return Math.max(0, a - b);
  if (family === "difference") return Math.abs(a - b);
  return Math.max(0, a + b - 1);
}

/**
 * CPU authority for one exact dual-tip deposition.
 *
 * The ordering is normative:
 * 1. combine the two coverages for this deposition;
 * 2. multiply by its resolved paint alpha;
 * 3. produce premultiplied scene-linear RGBA;
 * 4. source-over or destination-out the current authority pixel.
 *
 * Aggregating either tip mask before step 1 is not equivalent and must never be advertised as
 * exact.
 */
export function compositeStudioDualTipExactDepositionV2(
  destination: StudioDualTipPremultipliedLinearRgba,
  deposition: StudioDualTipExactDepositionPixel,
): StudioDualTipPremultipliedLinearRgba {
  const combinedCoverage = combineStudioDualTipExactCoverageV2(
    deposition.primaryCoverage,
    deposition.secondaryCoverage,
    deposition.blendFamily,
  );
  const paintAlpha = Math.min(1, Math.max(0, deposition.paintAlpha));
  const sourceAlpha = Math.fround(combinedCoverage * paintAlpha);
  const inverse = Math.fround(1 - sourceAlpha);
  if (deposition.porterDuff === "destination-out") {
    return Object.freeze([
      Math.fround(destination[0] * inverse),
      Math.fround(destination[1] * inverse),
      Math.fround(destination[2] * inverse),
      Math.fround(destination[3] * inverse),
    ]);
  }
  return Object.freeze([
    Math.fround(deposition.linearColor[0] * sourceAlpha + destination[0] * inverse),
    Math.fround(deposition.linearColor[1] * sourceAlpha + destination[1] * inverse),
    Math.fround(deposition.linearColor[2] * sourceAlpha + destination[2] * inverse),
    Math.fround(sourceAlpha + destination[3] * inverse),
  ]);
}

/**
 * Deterministic randomized-corpus/parity helper. Callers can feed any generated deposition
 * sequence; every item is applied in order through the same per-deposition CPU authority.
 */
export function compositeStudioDualTipExactSequenceV2(
  depositions: readonly StudioDualTipExactDepositionPixel[],
  initial: StudioDualTipPremultipliedLinearRgba = [0, 0, 0, 0],
): StudioDualTipPremultipliedLinearRgba {
  let authority = initial;
  for (const deposition of depositions) {
    authority = compositeStudioDualTipExactDepositionV2(authority, deposition);
  }
  return authority;
}

function rasterize(
  request: NormalizedRequest,
  plan: PlannedStamps
): readonly number[] | null {
  const output = new Float32Array(request.width * request.height * 4);
  for (const stamp of plan.stamps) {
    const [halfWidth, halfHeight] = stampHalfExtents(stamp);
    const firstX = Math.max(0, Math.floor(stamp.centerX - halfWidth - request.originX));
    const firstY = Math.max(0, Math.floor(stamp.centerY - halfHeight - request.originY));
    const lastX = Math.min(
      request.width - 1,
      Math.ceil(stamp.centerX + halfWidth - request.originX)
    );
    const lastY = Math.min(
      request.height - 1,
      Math.ceil(stamp.centerY + halfHeight - request.originY)
    );
    for (let pixelY = firstY; pixelY <= lastY; pixelY += 1) {
      const documentY = request.originY + pixelY + 0.5;
      for (let pixelX = firstX; pixelX <= lastX; pixelX += 1) {
        const documentX = request.originX + pixelX + 0.5;
        const primary = sampleField(
          request.primary,
          documentX,
          documentY,
          stamp.centerX,
          stamp.centerY,
          stamp.diameter,
          stamp.primaryRotation,
          stamp.primaryScaleX,
          stamp.primaryScaleY,
          0,
          0
        );
        const secondary = sampleField(
          request.secondary,
          documentX,
          documentY,
          stamp.centerX,
          stamp.centerY,
          stamp.diameter,
          stamp.secondaryRotation,
          stamp.secondaryScaleX,
          stamp.secondaryScaleY,
          stamp.secondaryOffsetX,
          stamp.secondaryOffsetY
        );
        const sourceAlpha = Math.fround(
          combineStudioDualTipAlpha(primary, secondary, request.combineMode) * stamp.opacity
        );
        if (!(sourceAlpha > 0)) continue;
        const offset = (pixelY * request.width + pixelX) * 4;
        const destinationAlpha = output[offset + 3]!;
        const inverse = Math.fround(1 - sourceAlpha);
        output[offset] = Math.fround(
          request.color[0] * sourceAlpha + output[offset]! * inverse
        );
        output[offset + 1] = Math.fround(
          request.color[1] * sourceAlpha + output[offset + 1]! * inverse
        );
        output[offset + 2] = Math.fround(
          request.color[2] * sourceAlpha + output[offset + 2]! * inverse
        );
        output[offset + 3] = Math.fround(
          sourceAlpha + destinationAlpha * inverse
        );
      }
    }
  }
  return Object.freeze(Array.from(output));
}

function packedCommands(
  request: NormalizedRequest,
  plan: PlannedStamps
): StudioDualTipPackedCommands {
  const values: number[] = [];
  const color = request.color.map(Math.fround) as [number, number, number];
  for (const stamp of plan.stamps) {
    values.push(
      stamp.centerX,
      stamp.centerY,
      stamp.diameter,
      stamp.opacity,
      stamp.primaryRotation,
      stamp.primaryScaleX,
      stamp.primaryScaleY,
      stamp.secondaryRotation,
      stamp.secondaryScaleX,
      stamp.secondaryScaleY,
      stamp.secondaryOffsetX,
      stamp.secondaryOffsetY,
      Math.fround(COMBINE_MODE_CODE[request.combineMode]),
      color[0],
      color[1],
      color[2],
      Math.fround(stamp.sampleOrdinal),
      stamp.pressure,
      stamp.tiltX,
      stamp.tiltY,
      stamp.velocity,
      0,
      0,
      0
    );
  }
  return Object.freeze({
    kind: "studio-dual-tip-packed-f32",
    layoutVersion: 1,
    scalar: "float32",
    byteOrder: "little-endian",
    stride: STUDIO_DUAL_TIP_PACKED_STRIDE,
    layout: STUDIO_DUAL_TIP_PACKED_LAYOUT,
    count: plan.stamps.length,
    values: Object.freeze(values),
  });
}

/**
 * Plans and rasterizes one dual-tip stroke. No partial artifact is returned on validation, stamp
 * count or work-budget failure.
 */
export function renderStudioDualBrushTip(
  request: StudioDualTipRequest
): StudioDualTipResult {
  const normalized = normalizeRequest(request);
  if ("ok" in normalized) return normalized;
  const plan = planStamps(normalized);
  if (!plan) return failure("budget-exceeded", "planning");
  const rgba = rasterize(normalized, plan);
  if (!rgba) return failure("budget-exceeded", "raster");
  const hasCoverage = rgba.some((value, index) => index % 4 === 3 && value > 0);
  if (!hasCoverage) return failure("empty-output", "raster");

  const artifact: StudioDualTipArtifact = Object.freeze({
    kind: "studio-dual-tip-artifact",
    width: normalized.width,
    height: normalized.height,
    originX: normalized.originX,
    originY: normalized.originY,
    stampCount: plan.stamps.length,
    workUnits: plan.workUnits,
    premultipliedLinearRgba: rgba,
    commands: packedCommands(normalized, plan),
    receipt: STUDIO_DUAL_TIP_RECEIPT,
  });
  return Object.freeze({ ok: true, artifact });
}
