import { sha256HexPortable } from "../studio-sha256";

import type {
  StudioVectorInkCubicSegment,
  StudioVectorInkGeometryArtifact,
} from "../studio-vector-ink-geometry";

export const STUDIO_HYBRID_TEXTURED_VECTOR_INK_PROVIDER_REVISION = 1 as const;

export const STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS = Object.freeze({
  maxAssetDimension: 4_096,
  maxAssetBytesEach: 8 * 1024 * 1024,
  maxAssetBytesTotal: 12 * 1024 * 1024,
  maxCenterlineSegments: 65_536,
  maxSourceSamples: 65_536,
  maxSourceArcSamples: 524_288,
  maxSourcePressureSamples: 524_288,
  maxSourceBytesEstimate: 48 * 1024 * 1024,
  maxDenseSamples: 524_288,
  maxStations: 65_536,
  maxWorkUnits: 16_000_000,
  maxOutputBytesEstimate: 96 * 1024 * 1024,
  maxFingerprintBytes: 24 * 1024 * 1024,
  maxCoordinateAbsolute: 1_000_000_000,
  maxTransformLinearAbsolute: 1_000_000,
  maxSeed: 0xffff_ffff,
  maxConcurrentOperations: 1,
} as const);

export type StudioHybridTexturedVectorInkMat2d = readonly [
  number, number, number, number, number, number,
];

export interface StudioHybridTexturedVectorInkR8AssetInput {
  readonly width: number;
  readonly height: number;
  readonly pixels: ArrayBufferView | readonly number[];
  readonly expectedHash?: `sha256:${string}`;
}

export interface StudioHybridTexturedVectorInkR8Asset {
  readonly kind: "studio-r8-asset";
  readonly role: "tip" | "paper-texture";
  readonly encoding: "r8-unorm";
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly pixels: readonly number[];
  readonly hash: `sha256:${string}`;
}

export interface StudioHybridTexturedVectorInkStyleInput {
  readonly baseWidthDocument?: number;
  readonly minimumWidthRatio?: number;
  readonly widthPressureExponent?: number;
  readonly minimumOpacity?: number;
  readonly maximumOpacity?: number;
  readonly opacityPressureExponent?: number;
  readonly referencePixelsPerDocumentUnit?: number;
  readonly stationSpacingReferencePixels?: number;
  readonly maxStationGapCurrent?: number;
  readonly positionJitterDocument?: number;
  readonly rotationJitterRadians?: number;
  readonly paperPixelsPerDocumentUnit?: number;
  readonly paperPhaseDocument?: readonly [number, number];
  readonly seed?: number;
}

export interface StudioHybridTexturedVectorInkStyle {
  readonly baseWidthDocument: number;
  readonly minimumWidthRatio: number;
  readonly widthPressureExponent: number;
  readonly minimumOpacity: number;
  readonly maximumOpacity: number;
  readonly opacityPressureExponent: number;
  readonly referencePixelsPerDocumentUnit: number;
  readonly stationSpacingReferencePixels: number;
  readonly maxStationGapCurrent: number;
  readonly positionJitterDocument: number;
  readonly rotationJitterRadians: number;
  readonly paperPixelsPerDocumentUnit: number;
  readonly paperPhaseDocument: readonly [number, number];
  readonly seed: number;
}

export type StudioHybridTexturedVectorInkLineageInput =
  | Readonly<{
      mode: "rebuild";
    }>
  | Readonly<{
      mode: "append";
      previousFingerprint: `sha256:${string}`;
    }>
  | Readonly<{
      mode: "replay";
      expectedReplayFingerprint: `sha256:${string}`;
    }>;

export interface StudioHybridTexturedVectorInkEditableCenterline {
  readonly authority: {
    readonly kind: "studio-vector-ink-geometry";
    readonly version: 1;
    readonly contentHash: `fnv1a32:${string}`;
  };
  readonly space: "document";
  readonly geometryKind: "tap" | "path";
  readonly tap: Readonly<{
    point: readonly [number, number];
    pressureRange: readonly [number, number];
  }> | null;
  readonly segments: readonly Readonly<{
    segmentIndex: number;
    controls: readonly [
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
    ];
    sourceRange: readonly [number, number];
    arcLengthDocument: number;
  }>[];
}

export interface StudioHybridTexturedVectorInkStation {
  readonly stationIndex: number;
  readonly segmentIndex: number | null;
  readonly t: number;
  readonly arcDistanceDocument: number;
  readonly arcDistanceCurrent: number;
  readonly pressure: number;
  readonly widthDocument: number;
  readonly widthCurrent: number;
  readonly opacity: number;
  readonly centerlineDocument: readonly [number, number];
  readonly centerlineCurrent: readonly [number, number];
  readonly appearanceCenterDocument: readonly [number, number];
  readonly appearanceCenterCurrent: readonly [number, number];
  readonly tangentDocument: readonly [number, number];
  readonly tangentCurrent: readonly [number, number];
  readonly normalDocument: readonly [number, number];
  readonly normalCurrent: readonly [number, number];
  readonly outline: {
    readonly leftCurrent: readonly [number, number];
    readonly rightCurrent: readonly [number, number];
  };
  readonly seededAppearance: {
    readonly jitterDocument: readonly [number, number];
    readonly rotationCurrentRadians: number;
  };
  readonly tipMapping: {
    readonly assetHash: `sha256:${string}`;
    readonly uvRect: readonly [0, 0, 1, 1];
    readonly sizeCurrent: readonly [number, number];
    readonly basisCurrent: {
      readonly uHalfExtent: readonly [number, number];
      readonly vHalfExtent: readonly [number, number];
    };
    readonly rotationCurrentRadians: number;
  };
  readonly paperMapping: {
    readonly assetHash: `sha256:${string}`;
    readonly anchoring: "document-space";
    readonly phaseDocument: readonly [number, number];
    readonly pixel: readonly [number, number];
    readonly uv: readonly [number, number];
  };
}

export interface StudioHybridTexturedVectorInkQualityReceipt {
  readonly sourceResolution: {
    readonly geometryResampleSpacingDocument: number;
    readonly geometryMaxSourceDeviationDocument: number;
    readonly sourceArcSampleCount: number;
    readonly sourcePressureSampleCount: number;
    readonly sourceSampleCount: number;
    readonly estimatedSourceBytes: number;
  };
  readonly referenceResolution: {
    readonly pixelsPerDocumentUnit: number;
    readonly stationSpacingReferencePixels: number;
    readonly stationSpacingDocument: number;
    readonly nominalWidthReferencePixels: number;
    readonly tipResolution: readonly [number, number];
    readonly paperResolution: readonly [number, number];
  };
  readonly currentTransform: {
    readonly documentToCurrent: StudioHybridTexturedVectorInkMat2d;
    readonly determinant: number;
    readonly singularScaleMinimum: number;
    readonly singularScaleMaximum: number;
    readonly effectiveScale: number;
    readonly nominalStationSpacingCurrent: number;
    readonly targetStationSpacingCurrent: number;
    readonly scheduledStationSpacingCurrent: number;
    readonly maximumAllowedStationGapCurrent: number;
    readonly actualMaximumStationGapDocument: number;
    readonly actualMaximumStationGapCurrent: number;
    readonly qualityMetric: "current-space-centerline-chord-gap-v1";
    readonly arcLengthApproximation:
      "artifact-arc-table-cubic-subdivision-v1";
    readonly denseSampleCount: number;
    readonly stationCount: number;
    readonly resampleQuality: "target-met";
  };
  readonly limitations: readonly [
    "source-geometry-deviation-carried-forward",
    "current-space-chord-gap-not-raster-coverage",
    "append-lineage-uses-full-deterministic-replan",
    "paired-outline-defers-cap-and-join-tessellation",
  ];
}

export interface StudioHybridTexturedVectorInkFingerprints {
  readonly algorithm: "sha256";
  readonly appearance: `sha256:${string}`;
  readonly rebuild: `sha256:${string}`;
  readonly append: `sha256:${string}`;
  readonly replay: `sha256:${string}`;
  readonly active: `sha256:${string}`;
  readonly mode: "append" | "rebuild" | "replay";
  readonly previous: `sha256:${string}` | null;
}

export interface StudioHybridTexturedVectorInkPlan {
  readonly kind: "studio-hybrid-textured-vector-ink-plan";
  readonly revision: typeof STUDIO_HYBRID_TEXTURED_VECTOR_INK_PROVIDER_REVISION;
  readonly providerId: "hybrid-textured-vector-ink";
  readonly epoch: number;
  readonly sequence: number;
  readonly rendererBoundary: {
    readonly rendererNeutral: true;
    readonly opaqueHandles: false;
    readonly centerlineAuthority: "studio-vector-ink-geometry";
    readonly appearanceRegeneration: "deterministic-from-centerline-v1";
  };
  readonly centerline: StudioHybridTexturedVectorInkEditableCenterline;
  readonly assets: {
    readonly tip: StudioHybridTexturedVectorInkR8Asset;
    readonly paperTexture: StudioHybridTexturedVectorInkR8Asset;
  };
  readonly style: StudioHybridTexturedVectorInkStyle;
  readonly stations: readonly StudioHybridTexturedVectorInkStation[];
  readonly outlinePlan: {
    readonly encoding: "paired-station-edges-v1";
    readonly stationCount: number;
    readonly closed: false;
  };
  readonly texturePlan: {
    readonly tip: "seeded-station-stamp-r8-v1";
    readonly paper: "document-space-repeat-r8-v1";
  };
  readonly quality: StudioHybridTexturedVectorInkQualityReceipt;
  readonly fingerprints: StudioHybridTexturedVectorInkFingerprints;
  readonly budgets: {
    readonly assetBytes: number;
    readonly sourceArcSamples: number;
    readonly sourcePressureSamples: number;
    readonly sourceBytesEstimate: number;
    readonly denseSamples: number;
    readonly stations: number;
    readonly workUnits: number;
    readonly estimatedOutputBytes: number;
  };
}

export class StudioHybridTexturedVectorInkProviderError extends Error {
  constructor(
    readonly code:
      | "invalid-request"
      | "invalid-geometry-artifact"
      | "invalid-asset"
      | "budget-exceeded"
      | "epoch-mismatch"
      | "backpressure"
      | "aborted"
      | "replay-mismatch"
      | "disposed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioHybridTexturedVectorInkProviderError";
  }
}

export interface StudioHybridTexturedVectorInkProvider {
  plan(input: Readonly<{
    geometry: StudioVectorInkGeometryArtifact;
    tip: StudioHybridTexturedVectorInkR8AssetInput;
    paperTexture: StudioHybridTexturedVectorInkR8AssetInput;
    style?: StudioHybridTexturedVectorInkStyleInput;
    documentToCurrent?: StudioHybridTexturedVectorInkMat2d;
    lineage?: StudioHybridTexturedVectorInkLineageInput;
    epoch: number;
    signal?: AbortSignal;
  }>): Promise<StudioHybridTexturedVectorInkPlan>;
  snapshot(): Readonly<{
    state: "ready" | "destroying" | "destroyed";
    epoch: number;
    sequence: number;
    activeOperations: number;
  }>;
  destroy(): Promise<void>;
}

interface PreparedPressureSample {
  readonly t: number;
  readonly pressure: number;
}

interface PreparedSegment {
  readonly segmentIndex: number;
  readonly controls: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
  readonly sourceRange: readonly [number, number];
  readonly arcLength: number;
  readonly arcSamples: readonly Readonly<{
    distance: number;
    t: number;
  }>[];
  readonly pressureSamples: readonly PreparedPressureSample[];
}

interface PreparedGeometry {
  readonly contentHash: `fnv1a32:${string}`;
  readonly geometryKind: "tap" | "path";
  readonly tap: Readonly<{
    point: readonly [number, number];
    pressureRange: readonly [number, number];
  }> | null;
  readonly segments: readonly PreparedSegment[];
  readonly totalArcLength: number;
  readonly sourceSampleCount: number;
  readonly sourceArcSampleCount: number;
  readonly sourcePressureSampleCount: number;
  readonly sourceBytesEstimate: number;
  readonly resampleSpacing: number;
  readonly maxSourceDeviation: number;
}

interface PreparedRequest {
  readonly geometry: PreparedGeometry;
  readonly tip: StudioHybridTexturedVectorInkR8Asset;
  readonly paperTexture: StudioHybridTexturedVectorInkR8Asset;
  readonly style: StudioHybridTexturedVectorInkStyle;
  readonly transform: StudioHybridTexturedVectorInkMat2d;
  readonly transformMetrics: TransformMetrics;
  readonly lineage: StudioHybridTexturedVectorInkLineageInput;
  readonly signal?: AbortSignal;
}

interface TransformMetrics {
  readonly determinant: number;
  readonly minimumScale: number;
  readonly maximumScale: number;
  readonly effectiveScale: number;
}

interface DenseSample {
  readonly pointDocument: readonly [number, number];
  readonly pointCurrent: readonly [number, number];
  readonly segmentIndex: number | null;
  readonly t: number;
  readonly distanceDocument: number;
  readonly distanceCurrent: number;
  readonly pressure: number;
}

interface SampledCenterline {
  readonly pointDocument: readonly [number, number];
  readonly pointCurrent: readonly [number, number];
  readonly tangentDocument: readonly [number, number];
  readonly tangentCurrent: readonly [number, number];
  readonly segmentIndex: number | null;
  readonly t: number;
  readonly distanceDocument: number;
  readonly distanceCurrent: number;
  readonly pressure: number;
}

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GEOMETRY_HASH_PATTERN = /^fnv1a32:[0-9a-f]{8}$/u;

const DEFAULT_STYLE = Object.freeze({
  baseWidthDocument: 8,
  minimumWidthRatio: 0.15,
  widthPressureExponent: 1,
  minimumOpacity: 0.2,
  maximumOpacity: 1,
  opacityPressureExponent: 1,
  referencePixelsPerDocumentUnit: 1,
  stationSpacingReferencePixels: 2,
  maxStationGapCurrent: 2,
  positionJitterDocument: 0,
  rotationJitterRadians: 0,
  paperPixelsPerDocumentUnit: 1,
  seed: 0x51f1_5eed,
} as const);

function invalid(message: string): never {
  throw new StudioHybridTexturedVectorInkProviderError(
    "invalid-request",
    message,
  );
}

function invalidGeometry(message: string): never {
  throw new StudioHybridTexturedVectorInkProviderError(
    "invalid-geometry-artifact",
    message,
  );
}

function invalidAsset(message: string): never {
  throw new StudioHybridTexturedVectorInkProviderError(
    "invalid-asset",
    message,
  );
}

function budget(message: string): never {
  throw new StudioHybridTexturedVectorInkProviderError(
    "budget-exceeded",
    message,
  );
}

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new StudioHybridTexturedVectorInkProviderError(
      "aborted",
      "Hybrid textured-vector ink planning was aborted.",
    );
  }
}

function digestBytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function digestText(value: string): `sha256:${string}` {
  return digestBytes(new TextEncoder().encode(value));
}

function boundedFinite(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(`${label} is outside its bounded range.`);
  }
  return value;
}

function finiteGeometryCoordinate(value: number, label: string): number {
  if (
    !Number.isFinite(value)
    || Math.abs(value)
      > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxCoordinateAbsolute
  ) {
    invalidGeometry(`${label} contains an invalid coordinate.`);
  }
  return value;
}

function freezeDeep<Value>(value: Value): Value {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    if (Array.isArray(value)) {
      for (const child of value) freezeDeep(child);
    } else {
      for (const child of Object.values(value as Record<string, unknown>)) {
        freezeDeep(child);
      }
    }
    Object.freeze(value);
  }
  return value;
}

function copyNumericBytes(
  value: ArrayBufferView | readonly number[],
  expectedLength: number,
  label: string,
  signal?: AbortSignal,
): readonly number[] {
  const length = Array.isArray(value)
    ? value.length
    : ArrayBuffer.isView(value) && "length" in value
      ? Number(value.length)
      : -1;
  if (length !== expectedLength) {
    invalidAsset(`${label} byte length does not match its dimensions.`);
  }
  const source = Array.isArray(value)
    ? value
    : value as unknown as ArrayLike<number>;
  const output = new Array<number>(length);
  for (let index = 0; index < length; index += 1) {
    if ((index & 4_095) === 0) aborted(signal);
    const byte = source[index];
    if (!Number.isInteger(byte) || byte! < 0 || byte! > 255) {
      invalidAsset(`${label} must contain only R8 byte values.`);
    }
    output[index] = byte!;
  }
  return output;
}

function hashR8Asset(
  width: number,
  height: number,
  pixels: readonly number[],
): `sha256:${string}` {
  const bytes = new Uint8Array(8 + pixels.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  bytes.set(pixels, 8);
  return digestBytes(bytes);
}

function prepareAsset(
  input: StudioHybridTexturedVectorInkR8AssetInput,
  role: "tip" | "paper-texture",
  signal?: AbortSignal,
): StudioHybridTexturedVectorInkR8Asset {
  if (!input || typeof input !== "object") {
    invalidAsset(`${role} R8 asset is required.`);
  }
  if (
    !Number.isSafeInteger(input.width)
    || input.width < 1
    || input.width
      > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxAssetDimension
    || !Number.isSafeInteger(input.height)
    || input.height < 1
    || input.height
      > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxAssetDimension
  ) {
    invalidAsset(`${role} dimensions are outside their bounded range.`);
  }
  const byteLength = input.width * input.height;
  if (
    byteLength
      > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxAssetBytesEach
  ) {
    budget(`${role} exceeds the per-asset byte budget.`);
  }
  const pixels = copyNumericBytes(
    input.pixels,
    byteLength,
    `${role}.pixels`,
    signal,
  );
  const hash = hashR8Asset(input.width, input.height, pixels);
  if (
    input.expectedHash !== undefined
    && (
      !SHA256_PATTERN.test(input.expectedHash)
      || input.expectedHash !== hash
    )
  ) {
    invalidAsset(`${role} expectedHash does not match its R8 bytes.`);
  }
  return freezeDeep({
    kind: "studio-r8-asset",
    role,
    encoding: "r8-unorm",
    width: input.width,
    height: input.height,
    byteLength,
    pixels,
    hash,
  });
}

function copyGeometryPoint(
  value: Readonly<{ x: number; y: number }>,
  label: string,
): readonly [number, number] {
  if (!value || typeof value !== "object") {
    invalidGeometry(`${label} must be a point.`);
  }
  return [
    finiteGeometryCoordinate(value.x, `${label}.x`),
    finiteGeometryCoordinate(value.y, `${label}.y`),
  ];
}

function copySegment(
  segment: StudioVectorInkCubicSegment,
  expectedIndex: number,
  sourceSampleCount: number,
): PreparedSegment {
  if (
    !segment
    || segment.kind !== "cubic"
    || segment.segmentIndex !== expectedIndex
    || !Array.isArray(segment.controls)
    || segment.controls.length !== 4
    || !Number.isFinite(segment.arcLength)
    || segment.arcLength <= 0
    || !Array.isArray(segment.sourceRange)
    || segment.sourceRange.length !== 2
    || !Number.isSafeInteger(segment.sourceRange[0])
    || !Number.isSafeInteger(segment.sourceRange[1])
    || segment.sourceRange[0] < 0
    || segment.sourceRange[1] < segment.sourceRange[0]
  ) {
    invalidGeometry(`segments[${expectedIndex}] is malformed.`);
  }
  if (
    !Array.isArray(segment.arcSamples)
    || segment.arcSamples.length < 2
    || segment.arcSamples.length
      > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxSourceArcSamples
    || !Array.isArray(segment.pressureSamples)
    || segment.pressureSamples.length < 1
    || segment.pressureSamples.length
      > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxSourcePressureSamples
  ) {
    invalidGeometry(
      `segments[${expectedIndex}] lacks arc or pressure samples.`,
    );
  }
  const controls = segment.controls.map((point, controlIndex) =>
    copyGeometryPoint(
      point,
      `segments[${expectedIndex}].controls[${controlIndex}]`,
    )
  ) as unknown as PreparedSegment["controls"];
  const arcSamples = segment.arcSamples.map((sample, sampleIndex) => {
    if (
      !sample
      || !Number.isFinite(sample.distance)
      || sample.distance < 0
      || !Number.isFinite(sample.t)
      || sample.t < 0
      || sample.t > 1
      || (
        sampleIndex > 0
        && (
          sample.distance
            <= segment.arcSamples[sampleIndex - 1]!.distance
          || sample.t <= segment.arcSamples[sampleIndex - 1]!.t
        )
      )
    ) {
      invalidGeometry(
        `segments[${expectedIndex}].arcSamples is not monotonic.`,
      );
    }
    return { distance: sample.distance, t: sample.t };
  });
  const firstArc = arcSamples[0]!;
  const finalArc = arcSamples.at(-1)!;
  if (
    Math.abs(firstArc.distance) > 1e-8
    || Math.abs(firstArc.t) > 1e-8
    || Math.abs(finalArc.distance - segment.arcLength) > 1e-4
    || Math.abs(finalArc.t - 1) > 1e-8
  ) {
    invalidGeometry(`segments[${expectedIndex}] arc endpoints are invalid.`);
  }
  const pressureSamples = segment.pressureSamples.map(
    (sample, sampleIndex) => {
      if (
        !sample
        || !Number.isFinite(sample.t)
        || sample.t < 0
        || sample.t > 1
        || !Number.isFinite(sample.pressure)
        || sample.pressure < 0
        || sample.pressure > 1
        || !Number.isSafeInteger(sample.sourceIndex)
        || sample.sourceIndex < 0
        || sample.sourceIndex >= sourceSampleCount
        || (
          sampleIndex > 0
          && sample.t < segment.pressureSamples[sampleIndex - 1]!.t
        )
      ) {
        invalidGeometry(
          `segments[${expectedIndex}].pressureSamples is malformed.`,
        );
      }
      return { t: sample.t, pressure: sample.pressure };
    },
  );
  return {
    segmentIndex: segment.segmentIndex,
    controls,
    sourceRange: [segment.sourceRange[0], segment.sourceRange[1]],
    arcLength: segment.arcLength,
    arcSamples,
    pressureSamples,
  };
}

function prepareGeometry(
  artifact: StudioVectorInkGeometryArtifact,
  signal?: AbortSignal,
): PreparedGeometry {
  if (
    !artifact
    || artifact.kind !== "studio-vector-ink-geometry"
    || artifact.version !== 1
    || !GEOMETRY_HASH_PATTERN.test(artifact.contentHash)
    || (artifact.geometryKind !== "tap" && artifact.geometryKind !== "path")
    || !Number.isSafeInteger(artifact.sourceSampleCount)
    || artifact.sourceSampleCount < 1
    || artifact.sourceSampleCount
      > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxSourceSamples
    || artifact.source?.encoding !== "canonical-point-pressure-v1"
    || !Array.isArray(artifact.source.samples)
    || artifact.source.samples.length !== artifact.sourceSampleCount
    || !Number.isFinite(artifact.totalArcLength)
    || artifact.totalArcLength < 0
    || !Number.isFinite(artifact.settings?.resampleSpacing)
    || artifact.settings.resampleSpacing <= 0
    || !Number.isFinite(artifact.maxSourceDeviation)
    || artifact.maxSourceDeviation < 0
    || !Array.isArray(artifact.segments)
  ) {
    invalidGeometry("The vector-ink geometry artifact is malformed.");
  }
  if (
    artifact.segments.length
      > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxCenterlineSegments
  ) {
    budget("The vector-ink artifact exceeds the centerline segment budget.");
  }
  for (let index = 0; index < artifact.source.samples.length; index += 1) {
    if ((index & 1_023) === 0) aborted(signal);
    const sample = artifact.source.samples[index]!;
    finiteGeometryCoordinate(sample.x, `source.samples[${index}].x`);
    finiteGeometryCoordinate(sample.y, `source.samples[${index}].y`);
    if (
      !Number.isFinite(sample.pressure)
      || sample.pressure < 0
      || sample.pressure > 1
    ) {
      invalidGeometry(`source.samples[${index}].pressure is invalid.`);
    }
  }
  let sourceArcSampleCount = 0;
  let sourcePressureSampleCount = 0;
  let summedArcLength = 0;
  const segments = artifact.segments.map((segment, index) => {
    if ((index & 255) === 0) aborted(signal);
    const copied = copySegment(
      segment,
      index,
      artifact.sourceSampleCount,
    );
    if (copied.sourceRange[1] >= artifact.sourceSampleCount) {
      invalidGeometry(`segments[${index}].sourceRange exceeds the source.`);
    }
    sourceArcSampleCount += copied.arcSamples.length;
    sourcePressureSampleCount += copied.pressureSamples.length;
    summedArcLength += copied.arcLength;
    if (
      sourceArcSampleCount
        > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxSourceArcSamples
    ) {
      budget("The vector-ink artifact exceeds the source arc-sample budget.");
    }
    if (
      sourcePressureSampleCount
        > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS
          .maxSourcePressureSamples
    ) {
      budget(
        "The vector-ink artifact exceeds the pressure-sample budget.",
      );
    }
    return copied;
  });
  const sourceBytesEstimate = artifact.sourceSampleCount * 24
    + sourceArcSampleCount * 16
    + sourcePressureSampleCount * 16
    + artifact.segments.length * 256;
  if (
    sourceBytesEstimate
      > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxSourceBytesEstimate
  ) {
    budget("The vector-ink artifact exceeds the source-byte budget.");
  }
  if (
    Math.abs(summedArcLength - artifact.totalArcLength)
      > Math.max(1e-4, artifact.totalArcLength * 1e-8)
  ) {
    invalidGeometry("The vector-ink artifact arc-length total is inconsistent.");
  }

  let tap: PreparedGeometry["tap"] = null;
  if (artifact.geometryKind === "tap") {
    if (
      artifact.segments.length !== 0
      || !artifact.tap
      || !Number.isFinite(artifact.tap.pressureRange.minimum)
      || !Number.isFinite(artifact.tap.pressureRange.maximum)
      || artifact.tap.pressureRange.minimum < 0
      || artifact.tap.pressureRange.maximum > 1
      || artifact.tap.pressureRange.minimum
        > artifact.tap.pressureRange.maximum
    ) {
      invalidGeometry("The vector-ink tap artifact is malformed.");
    }
    tap = {
      point: copyGeometryPoint(artifact.tap.point, "tap.point"),
      pressureRange: [
        artifact.tap.pressureRange.minimum,
        artifact.tap.pressureRange.maximum,
      ],
    };
  } else if (artifact.tap !== null || segments.length === 0) {
    invalidGeometry("The vector-ink path artifact is malformed.");
  }

  return freezeDeep({
    contentHash: artifact.contentHash,
    geometryKind: artifact.geometryKind,
    tap,
    segments,
    totalArcLength: artifact.totalArcLength,
    sourceSampleCount: artifact.sourceSampleCount,
    sourceArcSampleCount,
    sourcePressureSampleCount,
    sourceBytesEstimate,
    resampleSpacing: artifact.settings.resampleSpacing,
    maxSourceDeviation: artifact.maxSourceDeviation,
  });
}

function mix32(value: number): number {
  let result = value >>> 0;
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb_352d);
  result ^= result >>> 15;
  result = Math.imul(result, 0x846c_a68b);
  result ^= result >>> 16;
  return result >>> 0;
}

function seededUnit(seed: number, station: number, channel: number): number {
  return mix32(
    seed
      ^ Math.imul(station + 1, 0x9e37_79b1)
      ^ Math.imul(channel + 1, 0x85eb_ca77),
  ) / 0x1_0000_0000;
}

function seededArcUnit(
  seed: number,
  distanceDocument: number,
  spacingDocument: number,
  channel: number,
): number {
  const phase = Math.max(0, distanceDocument / spacingDocument);
  const leftIndex = Math.floor(phase);
  const ratio = phase - leftIndex;
  const smoothRatio = ratio * ratio * (3 - 2 * ratio);
  const left = seededUnit(seed, leftIndex, channel);
  const right = seededUnit(seed, leftIndex + 1, channel);
  return left + (right - left) * smoothRatio;
}

function prepareStyle(
  candidate: StudioHybridTexturedVectorInkStyleInput | undefined,
  paper: StudioHybridTexturedVectorInkR8Asset,
): StudioHybridTexturedVectorInkStyle {
  if (candidate !== undefined && (!candidate || typeof candidate !== "object")) {
    invalid("style must be an object.");
  }
  const seed = candidate?.seed ?? DEFAULT_STYLE.seed;
  if (
    !Number.isSafeInteger(seed)
    || seed < 0
    || seed > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxSeed
  ) {
    invalid("style.seed must be an unsigned 32-bit integer.");
  }
  const paperPixelsPerDocumentUnit = boundedFinite(
    candidate?.paperPixelsPerDocumentUnit
      ?? DEFAULT_STYLE.paperPixelsPerDocumentUnit,
    0.001,
    4_096,
    "style.paperPixelsPerDocumentUnit",
  );
  const defaultPhase: readonly [number, number] = [
    seededUnit(seed, 0, 41) * paper.width / paperPixelsPerDocumentUnit,
    seededUnit(seed, 0, 43) * paper.height / paperPixelsPerDocumentUnit,
  ];
  const phase = candidate?.paperPhaseDocument ?? defaultPhase;
  if (
    !Array.isArray(phase)
    || phase.length !== 2
    || phase.some(
      (component) =>
        !Number.isFinite(component)
        || Math.abs(component)
          > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxCoordinateAbsolute,
    )
  ) {
    invalid("style.paperPhaseDocument must be a bounded finite vec2.");
  }
  const minimumOpacity = boundedFinite(
    candidate?.minimumOpacity ?? DEFAULT_STYLE.minimumOpacity,
    0,
    1,
    "style.minimumOpacity",
  );
  const maximumOpacity = boundedFinite(
    candidate?.maximumOpacity ?? DEFAULT_STYLE.maximumOpacity,
    0,
    1,
    "style.maximumOpacity",
  );
  if (minimumOpacity > maximumOpacity) {
    invalid("style.minimumOpacity must not exceed maximumOpacity.");
  }
  return freezeDeep({
    baseWidthDocument: boundedFinite(
      candidate?.baseWidthDocument ?? DEFAULT_STYLE.baseWidthDocument,
      0.001,
      100_000,
      "style.baseWidthDocument",
    ),
    minimumWidthRatio: boundedFinite(
      candidate?.minimumWidthRatio ?? DEFAULT_STYLE.minimumWidthRatio,
      0,
      1,
      "style.minimumWidthRatio",
    ),
    widthPressureExponent: boundedFinite(
      candidate?.widthPressureExponent ?? DEFAULT_STYLE.widthPressureExponent,
      0.05,
      8,
      "style.widthPressureExponent",
    ),
    minimumOpacity,
    maximumOpacity,
    opacityPressureExponent: boundedFinite(
      candidate?.opacityPressureExponent
        ?? DEFAULT_STYLE.opacityPressureExponent,
      0.05,
      8,
      "style.opacityPressureExponent",
    ),
    referencePixelsPerDocumentUnit: boundedFinite(
      candidate?.referencePixelsPerDocumentUnit
        ?? DEFAULT_STYLE.referencePixelsPerDocumentUnit,
      0.001,
      4_096,
      "style.referencePixelsPerDocumentUnit",
    ),
    stationSpacingReferencePixels: boundedFinite(
      candidate?.stationSpacingReferencePixels
        ?? DEFAULT_STYLE.stationSpacingReferencePixels,
      0.05,
      1_024,
      "style.stationSpacingReferencePixels",
    ),
    maxStationGapCurrent: boundedFinite(
      candidate?.maxStationGapCurrent ?? DEFAULT_STYLE.maxStationGapCurrent,
      0.05,
      1_024,
      "style.maxStationGapCurrent",
    ),
    positionJitterDocument: boundedFinite(
      candidate?.positionJitterDocument
        ?? DEFAULT_STYLE.positionJitterDocument,
      0,
      100_000,
      "style.positionJitterDocument",
    ),
    rotationJitterRadians: boundedFinite(
      candidate?.rotationJitterRadians
        ?? DEFAULT_STYLE.rotationJitterRadians,
      0,
      Math.PI,
      "style.rotationJitterRadians",
    ),
    paperPixelsPerDocumentUnit,
    paperPhaseDocument: [phase[0], phase[1]] as const,
    seed,
  });
}

function prepareTransform(
  candidate: StudioHybridTexturedVectorInkMat2d | undefined,
): Readonly<{
  matrix: StudioHybridTexturedVectorInkMat2d;
  metrics: TransformMetrics;
}> {
  const matrix = candidate ?? [1, 0, 0, 1, 0, 0];
  if (
    !Array.isArray(matrix)
    || matrix.length !== 6
    || matrix.some((component) => !Number.isFinite(component))
    || matrix.slice(0, 4).some(
      (component) =>
        Math.abs(component)
          > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS
            .maxTransformLinearAbsolute,
    )
    || matrix.slice(4).some(
      (component) =>
        Math.abs(component)
          > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxCoordinateAbsolute,
    )
  ) {
    invalid("documentToCurrent must be a bounded finite affine matrix.");
  }
  const [a, b, c, d] = matrix;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    invalid("documentToCurrent must be invertible.");
  }
  const trace = a * a + b * b + c * c + d * d;
  const determinantSquared = determinant * determinant;
  const discriminant = Math.sqrt(
    Math.max(0, trace * trace - 4 * determinantSquared),
  );
  const maximumScale = Math.sqrt((trace + discriminant) / 2);
  const minimumScale = Math.sqrt((trace - discriminant) / 2);
  if (
    !Number.isFinite(maximumScale)
    || !Number.isFinite(minimumScale)
    || minimumScale < 1e-9
  ) {
    invalid("documentToCurrent has an unsupported scale range.");
  }
  return freezeDeep({
    matrix: [...matrix] as unknown as StudioHybridTexturedVectorInkMat2d,
    metrics: {
      determinant,
      minimumScale,
      maximumScale,
      effectiveScale: Math.sqrt(Math.abs(determinant)),
    },
  });
}

function prepareLineage(
  candidate: StudioHybridTexturedVectorInkLineageInput | undefined,
): StudioHybridTexturedVectorInkLineageInput {
  const lineage = candidate ?? { mode: "rebuild" };
  if (!lineage || typeof lineage !== "object") {
    invalid("lineage must be an object.");
  }
  switch (lineage.mode) {
    case "rebuild":
      return freezeDeep({ mode: "rebuild" });
    case "append":
      if (!SHA256_PATTERN.test(lineage.previousFingerprint)) {
        invalid("append.previousFingerprint must be a SHA-256 fingerprint.");
      }
      return freezeDeep({
        mode: "append",
        previousFingerprint: lineage.previousFingerprint,
      });
    case "replay":
      if (!SHA256_PATTERN.test(lineage.expectedReplayFingerprint)) {
        invalid(
          "replay.expectedReplayFingerprint must be a SHA-256 fingerprint.",
        );
      }
      return freezeDeep({
        mode: "replay",
        expectedReplayFingerprint: lineage.expectedReplayFingerprint,
      });
    default:
      invalid("Unsupported lineage mode.");
  }
}

function prepareRequest(
  input: Parameters<StudioHybridTexturedVectorInkProvider["plan"]>[0],
): PreparedRequest {
  if (!input || typeof input !== "object") {
    invalid("A hybrid textured-vector ink request is required.");
  }
  aborted(input.signal);
  const tip = prepareAsset(input.tip, "tip", input.signal);
  const paperTexture = prepareAsset(
    input.paperTexture,
    "paper-texture",
    input.signal,
  );
  if (
    tip.byteLength + paperTexture.byteLength
      > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxAssetBytesTotal
  ) {
    budget("Combined R8 assets exceed the asset-byte budget.");
  }
  const transform = prepareTransform(input.documentToCurrent);
  return Object.freeze({
    geometry: prepareGeometry(input.geometry, input.signal),
    tip,
    paperTexture,
    style: prepareStyle(input.style, paperTexture),
    transform: transform.matrix,
    transformMetrics: transform.metrics,
    lineage: prepareLineage(input.lineage),
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

class WorkGuard {
  workUnits = 0;
  denseSamples = 0;
  stations = 0;

  constructor(private readonly signal: AbortSignal | undefined) {}

  checkpoint(units = 1): void {
    aborted(this.signal);
    this.workUnits += units;
    if (
      this.workUnits
        > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxWorkUnits
    ) {
      budget("Hybrid ink planning exceeded the work-unit budget.");
    }
  }

  admitDense(): void {
    this.checkpoint();
    this.denseSamples += 1;
    if (
      this.denseSamples
        > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxDenseSamples
    ) {
      budget("Hybrid ink planning exceeded the dense-sample budget.");
    }
  }

  admitStation(): void {
    this.checkpoint(4);
    this.stations += 1;
    if (
      this.stations
        > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxStations
    ) {
      budget("Hybrid ink planning exceeded the station budget.");
    }
  }
}

function applyTransform(
  matrix: StudioHybridTexturedVectorInkMat2d,
  point: readonly [number, number],
): readonly [number, number] {
  const output = [
    matrix[0] * point[0] + matrix[2] * point[1] + matrix[4],
    matrix[1] * point[0] + matrix[3] * point[1] + matrix[5],
  ] as const;
  if (
    output.some(
      (component) =>
        !Number.isFinite(component)
        || Math.abs(component)
          > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxCoordinateAbsolute,
    )
  ) {
    budget("The transformed appearance exceeds the coordinate budget.");
  }
  return output;
}

function applyLinear(
  matrix: StudioHybridTexturedVectorInkMat2d,
  vector: readonly [number, number],
): readonly [number, number] {
  return [
    matrix[0] * vector[0] + matrix[2] * vector[1],
    matrix[1] * vector[0] + matrix[3] * vector[1],
  ];
}

function normalize2(
  vector: readonly [number, number],
  fallback: readonly [number, number] = [1, 0],
): readonly [number, number] {
  const length = Math.hypot(vector[0], vector[1]);
  if (!Number.isFinite(length) || length < 1e-12) return fallback;
  return [vector[0] / length, vector[1] / length];
}

function distance2(
  left: readonly [number, number],
  right: readonly [number, number],
): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function cubicPoint(
  controls: PreparedSegment["controls"],
  t: number,
): readonly [number, number] {
  const inverse = 1 - t;
  const b0 = inverse ** 3;
  const b1 = 3 * inverse ** 2 * t;
  const b2 = 3 * inverse * t ** 2;
  const b3 = t ** 3;
  return [
    controls[0][0] * b0
      + controls[1][0] * b1
      + controls[2][0] * b2
      + controls[3][0] * b3,
    controls[0][1] * b0
      + controls[1][1] * b1
      + controls[2][1] * b2
      + controls[3][1] * b3,
  ];
}

function cubicTangent(
  controls: PreparedSegment["controls"],
  t: number,
): readonly [number, number] {
  const inverse = 1 - t;
  const derivative: readonly [number, number] = [
    3 * inverse ** 2 * (controls[1][0] - controls[0][0])
      + 6 * inverse * t * (controls[2][0] - controls[1][0])
      + 3 * t ** 2 * (controls[3][0] - controls[2][0]),
    3 * inverse ** 2 * (controls[1][1] - controls[0][1])
      + 6 * inverse * t * (controls[2][1] - controls[1][1])
      + 3 * t ** 2 * (controls[3][1] - controls[2][1]),
  ];
  return normalize2(
    derivative,
    normalize2([
      controls[3][0] - controls[0][0],
      controls[3][1] - controls[0][1],
    ]),
  );
}

function segmentPressure(segment: PreparedSegment, t: number): number {
  const samples = segment.pressureSamples;
  if (t <= samples[0]!.t) return samples[0]!.pressure;
  if (t >= samples.at(-1)!.t) return samples.at(-1)!.pressure;
  for (let index = 1; index < samples.length; index += 1) {
    const right = samples[index]!;
    if (t > right.t) continue;
    const left = samples[index - 1]!;
    if (right.t - left.t < 1e-12) return right.pressure;
    const ratio = (t - left.t) / (right.t - left.t);
    return left.pressure + (right.pressure - left.pressure) * ratio;
  }
  return samples.at(-1)!.pressure;
}

function makeDenseSamples(
  prepared: PreparedRequest,
  targetSpacingCurrent: number,
  guard: WorkGuard,
): readonly DenseSample[] {
  if (prepared.geometry.geometryKind === "tap") {
    const tap = prepared.geometry.tap!;
    const pointCurrent = applyTransform(prepared.transform, tap.point);
    guard.admitDense();
    return [{
      pointDocument: tap.point,
      pointCurrent,
      segmentIndex: null,
      t: 0,
      distanceDocument: 0,
      distanceCurrent: 0,
      pressure: (tap.pressureRange[0] + tap.pressureRange[1]) / 2,
    }];
  }
  const dense: DenseSample[] = [];
  let segmentBaseDistance = 0;
  let currentDistance = 0;
  const fineGapCurrent = Math.max(0.01, targetSpacingCurrent / 2);
  for (const segment of prepared.geometry.segments) {
    for (let interval = 1; interval < segment.arcSamples.length; interval += 1) {
      guard.checkpoint();
      const leftArc = segment.arcSamples[interval - 1]!;
      const rightArc = segment.arcSamples[interval]!;
      const documentArcDelta = rightArc.distance - leftArc.distance;
      const projectedArcBound = documentArcDelta
        * prepared.transformMetrics.maximumScale;
      const subdivisions = Math.max(
        1,
        Math.ceil(projectedArcBound / fineGapCurrent),
      );
      const firstSubdivision = dense.length === 0 || interval === 1 ? 0 : 1;
      for (
        let subdivision = firstSubdivision;
        subdivision <= subdivisions;
        subdivision += 1
      ) {
        guard.admitDense();
        const ratio = subdivision / subdivisions;
        const t = leftArc.t + (rightArc.t - leftArc.t) * ratio;
        const pointDocument = cubicPoint(segment.controls, t);
        const pointCurrent = applyTransform(prepared.transform, pointDocument);
        if (dense.length > 0) {
          currentDistance += distance2(
            dense.at(-1)!.pointCurrent,
            pointCurrent,
          );
        }
        dense.push({
          pointDocument,
          pointCurrent,
          segmentIndex: segment.segmentIndex,
          t,
          distanceDocument: segmentBaseDistance
            + leftArc.distance
            + documentArcDelta * ratio,
          distanceCurrent: currentDistance,
          pressure: segmentPressure(segment, t),
        });
      }
    }
    segmentBaseDistance += segment.arcLength;
  }
  if (dense.length < 2) {
    invalidGeometry("The path artifact did not produce a station source.");
  }
  return dense;
}

function segmentByIndex(
  geometry: PreparedGeometry,
  segmentIndex: number,
): PreparedSegment {
  const segment = geometry.segments[segmentIndex];
  if (!segment || segment.segmentIndex !== segmentIndex) {
    invalidGeometry("Dense station references an invalid cubic segment.");
  }
  return segment;
}

function interpolateDense(
  dense: readonly DenseSample[],
  distanceCurrent: number,
  geometry: PreparedGeometry,
  transform: StudioHybridTexturedVectorInkMat2d,
  edgeHint: number,
): Readonly<{ sample: SampledCenterline; nextEdge: number }> {
  if (dense.length === 1) {
    return {
      sample: {
        pointDocument: dense[0]!.pointDocument,
        pointCurrent: dense[0]!.pointCurrent,
        tangentDocument: [1, 0],
        tangentCurrent: normalize2(applyLinear(transform, [1, 0])),
        segmentIndex: null,
        t: 0,
        distanceDocument: 0,
        distanceCurrent: 0,
        pressure: dense[0]!.pressure,
      },
      nextEdge: 0,
    };
  }
  let edge = Math.min(edgeHint, dense.length - 2);
  while (
    edge < dense.length - 2
    && dense[edge + 1]!.distanceCurrent < distanceCurrent
  ) {
    edge += 1;
  }
  const left = dense[edge]!;
  const right = dense[edge + 1]!;
  const edgeLength = right.distanceCurrent - left.distanceCurrent;
  const ratio = edgeLength < 1e-12
    ? 0
    : Math.min(1, Math.max(
        0,
        (distanceCurrent - left.distanceCurrent) / edgeLength,
      ));
  const segmentIndex = ratio < 0.5
    ? left.segmentIndex
    : right.segmentIndex;
  if (segmentIndex === null) {
    invalidGeometry("A path station lost its segment reference.");
  }
  const sameSegment = left.segmentIndex === right.segmentIndex;
  const t = sameSegment
    ? left.t + (right.t - left.t) * ratio
    : ratio < 0.5 ? left.t : right.t;
  const segment = segmentByIndex(geometry, segmentIndex);
  const pointDocument = sameSegment
    ? cubicPoint(segment.controls, t)
    : ratio < 0.5 ? left.pointDocument : right.pointDocument;
  const pointCurrent = applyTransform(transform, pointDocument);
  const tangentDocument = cubicTangent(segment.controls, t);
  const tangentCurrent = normalize2(applyLinear(transform, tangentDocument));
  return {
    sample: {
      pointDocument,
      pointCurrent,
      tangentDocument,
      tangentCurrent,
      segmentIndex,
      t,
      distanceDocument: left.distanceDocument
        + (right.distanceDocument - left.distanceDocument) * ratio,
      distanceCurrent,
      pressure: sameSegment
        ? segmentPressure(segment, t)
        : left.pressure + (right.pressure - left.pressure) * ratio,
    },
    nextEdge: edge,
  };
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function createStation(
  sample: SampledCenterline,
  stationIndex: number,
  prepared: PreparedRequest,
): StudioHybridTexturedVectorInkStation {
  const pressure = Math.min(1, Math.max(0, sample.pressure));
  const widthPressure = pressure ** prepared.style.widthPressureExponent;
  const opacityPressure = pressure ** prepared.style.opacityPressureExponent;
  const widthDocument = prepared.style.baseWidthDocument * (
    prepared.style.minimumWidthRatio
      + (1 - prepared.style.minimumWidthRatio) * widthPressure
  );
  const opacity = prepared.style.minimumOpacity
    + (
      prepared.style.maximumOpacity - prepared.style.minimumOpacity
    ) * opacityPressure;
  const normalDocument = [
    -sample.tangentDocument[1],
    sample.tangentDocument[0],
  ] as const;
  const normalCurrent = normalize2(applyLinear(
    prepared.transform,
    normalDocument,
  ));
  const stationSpacingDocument =
    prepared.style.stationSpacingReferencePixels
    / prepared.style.referencePixelsPerDocumentUnit;
  const jitterNormal = (
    seededArcUnit(
      prepared.style.seed,
      sample.distanceDocument,
      stationSpacingDocument,
      1,
    ) * 2 - 1
  ) * prepared.style.positionJitterDocument;
  const jitterTangent = (
    seededArcUnit(
      prepared.style.seed,
      sample.distanceDocument,
      stationSpacingDocument,
      2,
    ) * 2 - 1
  ) * prepared.style.positionJitterDocument * 0.35;
  const jitterDocument = [
    normalDocument[0] * jitterNormal
      + sample.tangentDocument[0] * jitterTangent,
    normalDocument[1] * jitterNormal
      + sample.tangentDocument[1] * jitterTangent,
  ] as const;
  const appearanceCenterDocument = [
    sample.pointDocument[0] + jitterDocument[0],
    sample.pointDocument[1] + jitterDocument[1],
  ] as const;
  const appearanceCenterCurrent = applyTransform(
    prepared.transform,
    appearanceCenterDocument,
  );
  const halfWidth = widthDocument / 2;
  const leftCurrent = applyTransform(prepared.transform, [
    appearanceCenterDocument[0] + normalDocument[0] * halfWidth,
    appearanceCenterDocument[1] + normalDocument[1] * halfWidth,
  ]);
  const rightCurrent = applyTransform(prepared.transform, [
    appearanceCenterDocument[0] - normalDocument[0] * halfWidth,
    appearanceCenterDocument[1] - normalDocument[1] * halfWidth,
  ]);
  const widthCurrent = distance2(leftCurrent, rightCurrent);
  const rotationJitterDocument = (
    seededArcUnit(
      prepared.style.seed,
      sample.distanceDocument,
      stationSpacingDocument,
      3,
    ) * 2 - 1
  ) * prepared.style.rotationJitterRadians;
  const maximumTipDimension = Math.max(
    prepared.tip.width,
    prepared.tip.height,
  );
  const cosine = Math.cos(rotationJitterDocument);
  const sine = Math.sin(rotationJitterDocument);
  const tipUUnitDocument = [
    sample.tangentDocument[0] * cosine - sample.tangentDocument[1] * sine,
    sample.tangentDocument[0] * sine + sample.tangentDocument[1] * cosine,
  ] as const;
  const tipVUnitDocument = [
    -tipUUnitDocument[1],
    tipUUnitDocument[0],
  ] as const;
  const tipSizeDocument = [
    widthDocument * prepared.tip.width / maximumTipDimension,
    widthDocument * prepared.tip.height / maximumTipDimension,
  ] as const;
  const uHalfExtent = applyLinear(prepared.transform, [
    tipUUnitDocument[0] * tipSizeDocument[0] / 2,
    tipUUnitDocument[1] * tipSizeDocument[0] / 2,
  ]);
  const vHalfExtent = applyLinear(prepared.transform, [
    tipVUnitDocument[0] * tipSizeDocument[1] / 2,
    tipVUnitDocument[1] * tipSizeDocument[1] / 2,
  ]);
  const tipSizeCurrent = [
    Math.hypot(...uHalfExtent) * 2,
    Math.hypot(...vHalfExtent) * 2,
  ] as const;
  const rotationCurrentRadians = Math.atan2(
    uHalfExtent[1],
    uHalfExtent[0],
  );
  const paperPixel = [
    positiveModulo(
      (
        sample.pointDocument[0]
          + prepared.style.paperPhaseDocument[0]
      ) * prepared.style.paperPixelsPerDocumentUnit,
      prepared.paperTexture.width,
    ),
    positiveModulo(
      (
        sample.pointDocument[1]
          + prepared.style.paperPhaseDocument[1]
      ) * prepared.style.paperPixelsPerDocumentUnit,
      prepared.paperTexture.height,
    ),
  ] as const;
  return {
    stationIndex,
    segmentIndex: sample.segmentIndex,
    t: sample.t,
    arcDistanceDocument: sample.distanceDocument,
    arcDistanceCurrent: sample.distanceCurrent,
    pressure,
    widthDocument,
    widthCurrent,
    opacity,
    centerlineDocument: sample.pointDocument,
    centerlineCurrent: sample.pointCurrent,
    appearanceCenterDocument,
    appearanceCenterCurrent,
    tangentDocument: sample.tangentDocument,
    tangentCurrent: sample.tangentCurrent,
    normalDocument,
    normalCurrent,
    outline: { leftCurrent, rightCurrent },
    seededAppearance: {
      jitterDocument,
      rotationCurrentRadians,
    },
    tipMapping: {
      assetHash: prepared.tip.hash,
      uvRect: [0, 0, 1, 1],
      sizeCurrent: tipSizeCurrent,
      basisCurrent: { uHalfExtent, vHalfExtent },
      rotationCurrentRadians,
    },
    paperMapping: {
      assetHash: prepared.paperTexture.hash,
      anchoring: "document-space",
      phaseDocument: prepared.style.paperPhaseDocument,
      pixel: paperPixel,
      uv: [
        paperPixel[0] / prepared.paperTexture.width,
        paperPixel[1] / prepared.paperTexture.height,
      ],
    },
  };
}

function makeStations(
  dense: readonly DenseSample[],
  prepared: PreparedRequest,
  targetSpacingCurrent: number,
  guard: WorkGuard,
): readonly StudioHybridTexturedVectorInkStation[] {
  const totalCurrent = dense.at(-1)!.distanceCurrent;
  const regularStationCount = totalCurrent <= 1e-12
    ? 1
    : Math.floor(totalCurrent / targetSpacingCurrent) + 1;
  const needsFinalStation = totalCurrent > 1e-12
    && Math.abs(
      (regularStationCount - 1) * targetSpacingCurrent - totalCurrent,
    ) > 1e-8;
  if (
    regularStationCount + (needsFinalStation ? 1 : 0)
      > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxStations
  ) {
    budget("The transformed stroke exceeds the station budget.");
  }
  const distances = Array.from(
    { length: regularStationCount },
    (_, index) => index * targetSpacingCurrent,
  );
  if (
    needsFinalStation
  ) {
    distances.push(totalCurrent);
  }
  const stations: StudioHybridTexturedVectorInkStation[] = [];
  let edge = 0;
  for (const stationDistance of distances) {
    guard.admitStation();
    const interpolated = interpolateDense(
      dense,
      stationDistance,
      prepared.geometry,
      prepared.transform,
      edge,
    );
    edge = interpolated.nextEdge;
    stations.push(
      createStation(interpolated.sample, stations.length, prepared),
    );
  }
  return stations;
}

function editableCenterline(
  geometry: PreparedGeometry,
): StudioHybridTexturedVectorInkEditableCenterline {
  return {
    authority: {
      kind: "studio-vector-ink-geometry",
      version: 1,
      contentHash: geometry.contentHash,
    },
    space: "document",
    geometryKind: geometry.geometryKind,
    tap: geometry.tap
      ? {
          point: [...geometry.tap.point] as readonly [number, number],
          pressureRange: [
            geometry.tap.pressureRange[0],
            geometry.tap.pressureRange[1],
          ],
        }
      : null,
    segments: geometry.segments.map((segment) => ({
      segmentIndex: segment.segmentIndex,
      controls: segment.controls.map(
        (point) => [point[0], point[1]] as const,
      ) as unknown as StudioHybridTexturedVectorInkEditableCenterline[
        "segments"
      ][number]["controls"],
      sourceRange: [segment.sourceRange[0], segment.sourceRange[1]],
      arcLengthDocument: segment.arcLength,
    })),
  };
}

const FINGERPRINT_FLOATS_PER_STATION = 38;
const FINGERPRINT_RECORD_BYTES = 8 + FINGERPRINT_FLOATS_PER_STATION * 8;

function appearanceFingerprint(
  prepared: PreparedRequest,
  stations: readonly StudioHybridTexturedVectorInkStation[],
): `sha256:${string}` {
  const metadata = new TextEncoder().encode(JSON.stringify({
    revision: STUDIO_HYBRID_TEXTURED_VECTOR_INK_PROVIDER_REVISION,
    geometry: prepared.geometry.contentHash,
    tip: prepared.tip.hash,
    paperTexture: prepared.paperTexture.hash,
    style: prepared.style,
    transform: prepared.transform,
    stationCount: stations.length,
  }));
  const totalBytes = metadata.byteLength
    + stations.length * FINGERPRINT_RECORD_BYTES;
  if (
    totalBytes
      > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxFingerprintBytes
  ) {
    budget("The appearance fingerprint exceeds its byte budget.");
  }
  const bytes = new Uint8Array(totalBytes);
  bytes.set(metadata);
  const view = new DataView(bytes.buffer);
  let offset = metadata.byteLength;
  for (const station of stations) {
    view.setUint32(offset, station.stationIndex, true);
    view.setInt32(offset + 4, station.segmentIndex ?? -1, true);
    offset += 8;
    const floats = [
      station.t,
      station.arcDistanceDocument,
      station.arcDistanceCurrent,
      station.pressure,
      station.widthDocument,
      station.widthCurrent,
      station.opacity,
      ...station.centerlineDocument,
      ...station.centerlineCurrent,
      ...station.appearanceCenterDocument,
      ...station.appearanceCenterCurrent,
      ...station.tangentDocument,
      ...station.tangentCurrent,
      ...station.normalDocument,
      ...station.normalCurrent,
      ...station.outline.leftCurrent,
      ...station.outline.rightCurrent,
      ...station.seededAppearance.jitterDocument,
      station.seededAppearance.rotationCurrentRadians,
      ...station.tipMapping.sizeCurrent,
      ...station.tipMapping.basisCurrent.uHalfExtent,
      ...station.tipMapping.basisCurrent.vHalfExtent,
      ...station.paperMapping.uv,
    ];
    if (floats.length !== FINGERPRINT_FLOATS_PER_STATION) {
      throw new Error("Hybrid ink fingerprint record invariant failed.");
    }
    for (const value of floats) {
      view.setFloat64(offset, value, true);
      offset += 8;
    }
  }
  return digestBytes(bytes);
}

function buildFingerprints(
  prepared: PreparedRequest,
  appearance: `sha256:${string}`,
): StudioHybridTexturedVectorInkFingerprints {
  const rebuild = digestText(`rebuild-v1\n${appearance}`);
  const previous = prepared.lineage.mode === "append"
    ? prepared.lineage.previousFingerprint
    : null;
  const append = digestText(
    `append-v1\n${previous ?? "root"}\n${appearance}`,
  );
  const replay = digestText(`replay-v1\n${appearance}`);
  if (
    prepared.lineage.mode === "replay"
    && prepared.lineage.expectedReplayFingerprint !== replay
  ) {
    throw new StudioHybridTexturedVectorInkProviderError(
      "replay-mismatch",
      "Hybrid ink replay fingerprint does not match regenerated appearance.",
    );
  }
  return {
    algorithm: "sha256",
    appearance,
    rebuild,
    append,
    replay,
    active: prepared.lineage.mode === "append"
      ? append
      : prepared.lineage.mode === "replay"
        ? replay
        : rebuild,
    mode: prepared.lineage.mode,
    previous,
  };
}

function maximumStationGap(
  stations: readonly StudioHybridTexturedVectorInkStation[],
): number {
  let maximum = 0;
  for (let index = 1; index < stations.length; index += 1) {
    maximum = Math.max(
      maximum,
      distance2(
        stations[index - 1]!.centerlineDocument,
        stations[index]!.centerlineDocument,
      ),
    );
  }
  return maximum;
}

function maximumCurrentStationGap(
  stations: readonly StudioHybridTexturedVectorInkStation[],
): number {
  let maximum = 0;
  for (let index = 1; index < stations.length; index += 1) {
    maximum = Math.max(
      maximum,
      distance2(
        stations[index - 1]!.centerlineCurrent,
        stations[index]!.centerlineCurrent,
      ),
    );
  }
  return maximum;
}

function buildPlan(
  prepared: PreparedRequest,
  epoch: number,
  sequence: number,
): StudioHybridTexturedVectorInkPlan {
  const guard = new WorkGuard(prepared.signal);
  const stationSpacingDocument =
    prepared.style.stationSpacingReferencePixels
    / prepared.style.referencePixelsPerDocumentUnit;
  const nominalStationSpacingCurrent = stationSpacingDocument
    * prepared.transformMetrics.effectiveScale;
  const targetStationSpacingCurrent = Math.min(
    nominalStationSpacingCurrent,
    prepared.style.maxStationGapCurrent,
  );
  // Reserve a small deterministic interpolation margin so cubic evaluation
  // remains within the caller's chord-gap target after arc-table interpolation.
  const scheduledStationSpacingCurrent =
    targetStationSpacingCurrent * 0.995;
  const dense = makeDenseSamples(
    prepared,
    scheduledStationSpacingCurrent,
    guard,
  );
  const stations = makeStations(
    dense,
    prepared,
    scheduledStationSpacingCurrent,
    guard,
  );
  const actualMaximumStationGapCurrent = maximumCurrentStationGap(stations);
  if (
    actualMaximumStationGapCurrent
      > targetStationSpacingCurrent + 1e-5
  ) {
    budget(
      "Generated station spacing failed its current-space quality gate "
      + `(${actualMaximumStationGapCurrent} > ${targetStationSpacingCurrent}).`,
    );
  }
  const rawAssetBytes = prepared.tip.byteLength
    + prepared.paperTexture.byteLength;
  const estimatedOutputBytes = rawAssetBytes * 4
    + stations.length * 720
    + prepared.geometry.segments.length * 192;
  if (
    estimatedOutputBytes
      > STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxOutputBytesEstimate
  ) {
    budget("The hybrid ink plan exceeds its estimated output-byte budget.");
  }
  const appearance = appearanceFingerprint(prepared, stations);
  const fingerprints = buildFingerprints(prepared, appearance);
  const quality: StudioHybridTexturedVectorInkQualityReceipt = {
    sourceResolution: {
      geometryResampleSpacingDocument: prepared.geometry.resampleSpacing,
      geometryMaxSourceDeviationDocument:
        prepared.geometry.maxSourceDeviation,
      sourceArcSampleCount: prepared.geometry.sourceArcSampleCount,
      sourcePressureSampleCount:
        prepared.geometry.sourcePressureSampleCount,
      sourceSampleCount: prepared.geometry.sourceSampleCount,
      estimatedSourceBytes: prepared.geometry.sourceBytesEstimate,
    },
    referenceResolution: {
      pixelsPerDocumentUnit:
        prepared.style.referencePixelsPerDocumentUnit,
      stationSpacingReferencePixels:
        prepared.style.stationSpacingReferencePixels,
      stationSpacingDocument,
      nominalWidthReferencePixels:
        prepared.style.baseWidthDocument
        * prepared.style.referencePixelsPerDocumentUnit,
      tipResolution: [prepared.tip.width, prepared.tip.height],
      paperResolution: [
        prepared.paperTexture.width,
        prepared.paperTexture.height,
      ],
    },
    currentTransform: {
      documentToCurrent: prepared.transform,
      determinant: prepared.transformMetrics.determinant,
      singularScaleMinimum: prepared.transformMetrics.minimumScale,
      singularScaleMaximum: prepared.transformMetrics.maximumScale,
      effectiveScale: prepared.transformMetrics.effectiveScale,
      nominalStationSpacingCurrent,
      targetStationSpacingCurrent,
      scheduledStationSpacingCurrent,
      maximumAllowedStationGapCurrent:
        prepared.style.maxStationGapCurrent,
      actualMaximumStationGapDocument: maximumStationGap(stations),
      actualMaximumStationGapCurrent,
      qualityMetric: "current-space-centerline-chord-gap-v1",
      arcLengthApproximation:
        "artifact-arc-table-cubic-subdivision-v1",
      denseSampleCount: dense.length,
      stationCount: stations.length,
      resampleQuality: "target-met",
    },
    limitations: [
      "source-geometry-deviation-carried-forward",
      "current-space-chord-gap-not-raster-coverage",
      "append-lineage-uses-full-deterministic-replan",
      "paired-outline-defers-cap-and-join-tessellation",
    ],
  };
  return freezeDeep({
    kind: "studio-hybrid-textured-vector-ink-plan",
    revision: STUDIO_HYBRID_TEXTURED_VECTOR_INK_PROVIDER_REVISION,
    providerId: "hybrid-textured-vector-ink",
    epoch,
    sequence,
    rendererBoundary: {
      rendererNeutral: true,
      opaqueHandles: false,
      centerlineAuthority: "studio-vector-ink-geometry",
      appearanceRegeneration: "deterministic-from-centerline-v1",
    },
    centerline: editableCenterline(prepared.geometry),
    assets: {
      tip: prepared.tip,
      paperTexture: prepared.paperTexture,
    },
    style: prepared.style,
    stations,
    outlinePlan: {
      encoding: "paired-station-edges-v1",
      stationCount: stations.length,
      closed: false,
    },
    texturePlan: {
      tip: "seeded-station-stamp-r8-v1",
      paper: "document-space-repeat-r8-v1",
    },
    quality,
    fingerprints,
    budgets: {
      assetBytes: rawAssetBytes,
      sourceArcSamples: prepared.geometry.sourceArcSampleCount,
      sourcePressureSamples: prepared.geometry.sourcePressureSampleCount,
      sourceBytesEstimate: prepared.geometry.sourceBytesEstimate,
      denseSamples: guard.denseSamples,
      stations: guard.stations,
      workUnits: guard.workUnits,
      estimatedOutputBytes,
    },
  });
}

function asProviderError(
  error: unknown,
): StudioHybridTexturedVectorInkProviderError {
  if (error instanceof StudioHybridTexturedVectorInkProviderError) {
    return error;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new StudioHybridTexturedVectorInkProviderError(
      "aborted",
      "Hybrid textured-vector ink planning was aborted.",
      { cause: error },
    );
  }
  return new StudioHybridTexturedVectorInkProviderError(
    "invalid-request",
    "Hybrid textured-vector ink planning failed closed.",
    { cause: error },
  );
}

export function createStudioHybridTexturedVectorInkProvider(
  options: Readonly<{ epoch?: number }> = {},
): StudioHybridTexturedVectorInkProvider {
  const epoch = options.epoch ?? 0;
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    invalid("epoch must be a non-negative safe integer.");
  }
  let state: "ready" | "destroying" | "destroyed" = "ready";
  let sequence = 0;
  let activeOperations = 0;
  let resolveIdle: (() => void) | null = null;
  let destroyPromise: Promise<void> | null = null;

  const enter = (signal?: AbortSignal): number => {
    if (state !== "ready") {
      throw new StudioHybridTexturedVectorInkProviderError(
        "disposed",
        "Hybrid textured-vector ink provider is not ready.",
      );
    }
    aborted(signal);
    if (
      activeOperations
        >= STUDIO_HYBRID_TEXTURED_VECTOR_INK_BUDGETS.maxConcurrentOperations
    ) {
      throw new StudioHybridTexturedVectorInkProviderError(
        "backpressure",
        "Hybrid textured-vector ink operation budget exceeded.",
      );
    }
    activeOperations += 1;
    sequence += 1;
    return sequence;
  };

  const leave = (): void => {
    activeOperations -= 1;
    if (activeOperations === 0) {
      resolveIdle?.();
      resolveIdle = null;
    }
  };

  return {
    plan(input) {
      let prepared: PreparedRequest;
      let admittedSequence: number;
      try {
        if (!Number.isSafeInteger(input?.epoch) || input.epoch !== epoch) {
          throw new StudioHybridTexturedVectorInkProviderError(
            "epoch-mismatch",
            "Hybrid textured-vector ink request epoch does not match.",
          );
        }
        prepared = prepareRequest(input);
        admittedSequence = enter(input.signal);
      } catch (error) {
        return Promise.reject(asProviderError(error));
      }
      return Promise.resolve()
        .then(() => {
          aborted(prepared.signal);
          return buildPlan(prepared, epoch, admittedSequence);
        })
        .catch((error: unknown) => {
          throw asProviderError(error);
        })
        .finally(leave);
    },

    snapshot() {
      return {
        state,
        epoch,
        sequence,
        activeOperations,
      };
    },

    destroy() {
      if (destroyPromise) return destroyPromise;
      state = "destroying";
      destroyPromise = (async () => {
        if (activeOperations > 0) {
          await new Promise<void>((resolve) => {
            resolveIdle = resolve;
          });
        }
        state = "destroyed";
      })();
      return destroyPromise;
    },
  };
}
