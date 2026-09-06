/**
 * Isolated procedural-artistic raster provider boundary.
 *
 * The boundary is intentionally library-neutral and compiles without p5.brush.
 * A Worker-owned adapter may load `p5.brush/standalone` dynamically and render
 * only settled strokes into a private OffscreenCanvas WebGL2 surface. The
 * adapter never becomes scene, document, history, persistence, or live-preview
 * authority; only copied RGBA bytes and integrity receipts cross this boundary.
 */

import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION = 1 as const;

export const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS = Object.freeze({
  maxWidth: 8_192,
  maxHeight: 8_192,
  maxPixels: 67_108_864,
  maxOutputBytes: 256 * 1024 * 1024,
  /**
   * One WebGL drawing buffer, one adapter readback, and one provider-owned
   * artifact may coexist while the untrusted adapter output is normalized.
   */
  residentRgbaFrames: 3,
  /**
   * p5.brush watercolor fills retain additional mask, mix, and compositor
   * surfaces. Budget those techniques as eight full RGBA frames even though
   * only the completed ownership buffer crosses this provider boundary.
   */
  compositedFillResidentRgbaFrames: 8,
  rgbaBytesPerPixel: 4,
  maxResidentBytes: 384 * 1024 * 1024,
  maxSamples: 131_072,
  maxParameters: 64,
  maxParameterNameCodeUnits: 96,
  maxParameterStringCodeUnits: 512,
  maxPresetIdCodeUnits: 160,
  maxTipPixels: 16_777_216,
  maxTipBytes: 64 * 1024 * 1024,
} as const);

export interface StudioProceduralArtisticBrushRasterMemoryEstimate {
  readonly pixelCount: number;
  readonly outputBytes: number;
  readonly gpuDrawingBufferBytes: number;
  readonly adapterReadbackBytes: number;
  readonly artifactOwnershipBytes: number;
  readonly peakResidentBytes: number;
}

/**
 * Returns the conservative peak resident cost for a single settled raster.
 *
 * `null` means the dimensions fail before an OffscreenCanvas, WebGL drawing
 * buffer, readback array, or provider-owned output array may be allocated.
 */
export function estimateStudioProceduralArtisticBrushRasterMemory(
  width: unknown,
  height: unknown,
  technique?: unknown,
): StudioProceduralArtisticBrushRasterMemoryEstimate | null {
  const residentRgbaFrames =
    technique === "watercolor-fill" || technique === "flat-wash"
      ? STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS
        .compositedFillResidentRgbaFrames
      : technique === undefined
        || technique === "flow-field"
        || technique === "hatch"
        || technique === "mass"
        || technique === "image-tip"
        || technique === "custom-tip"
        ? STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.residentRgbaFrames
        : null;
  if (
    residentRgbaFrames === null
    || typeof width !== "number"
    || !Number.isSafeInteger(width)
    || width <= 0
    || typeof height !== "number"
    || !Number.isSafeInteger(height)
    || height <= 0
    || width > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxWidth
    || height > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxHeight
  ) return null;
  const pixelCount = width * height;
  const outputBytes =
    pixelCount * STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.rgbaBytesPerPixel;
  const peakResidentBytes =
    outputBytes
    * residentRgbaFrames;
  if (
    !Number.isSafeInteger(pixelCount)
    || pixelCount > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxPixels
    || !Number.isSafeInteger(outputBytes)
    || outputBytes > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxOutputBytes
    || !Number.isSafeInteger(peakResidentBytes)
    || peakResidentBytes
      > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxResidentBytes
  ) return null;
  return Object.freeze({
    pixelCount,
    outputBytes,
    gpuDrawingBufferBytes: outputBytes,
    adapterReadbackBytes: outputBytes,
    artifactOwnershipBytes: outputBytes,
    peakResidentBytes,
  });
}

export const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_CAPABILITIES = Object.freeze([
  "procedural:flow-field",
  "procedural:hatch",
  "procedural:mass",
  "procedural:watercolor-fill",
  "procedural:flat-wash",
  "tip:image",
  "tip:custom",
  "execution:settled-only",
  "surface:offscreen-canvas",
  "gpu:webgl2",
  "seed:deterministic",
  "authority:none",
] as const);

export type StudioProceduralArtisticBrushCapability =
  (typeof STUDIO_PROCEDURAL_ARTISTIC_BRUSH_CAPABILITIES)[number];

export type StudioProceduralArtisticBrushTechnique =
  | "flow-field"
  | "hatch"
  | "mass"
  | "watercolor-fill"
  | "flat-wash"
  | "image-tip"
  | "custom-tip";

export interface StudioProceduralArtisticBrushSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly timeMilliseconds: number;
}

export type StudioProceduralArtisticBrushParameter =
  | boolean
  | number
  | string;

export interface StudioProceduralArtisticBrushTip {
  readonly kind: "image" | "custom";
  readonly assetId: string;
  readonly width: number;
  readonly height: number;
  readonly rgba8: Uint8Array | Uint8ClampedArray;
}

export interface StudioProceduralArtisticBrushPlan {
  readonly technique: StudioProceduralArtisticBrushTechnique;
  readonly presetId: string;
  readonly samples: readonly StudioProceduralArtisticBrushSample[];
  readonly parameters: Readonly<
    Record<string, StudioProceduralArtisticBrushParameter>
  >;
  readonly tip?: StudioProceduralArtisticBrushTip;
}

export interface StudioProceduralArtisticBrushRequest {
  readonly kind: "studio-procedural-artistic-brush/request";
  readonly version:
    typeof STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly strokeId: string;
  readonly stage: "live" | "settled";
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly plan: StudioProceduralArtisticBrushPlan;
  readonly signal?: AbortSignal;
}

export interface StudioProceduralArtisticOffscreenWebGl2Surface {
  readonly kind: "offscreen-canvas-webgl2";
  readonly executionLocality: "dedicated-worker";
  readonly transferredFromMainThread: false;
  readonly width: number;
  readonly height: number;
  /** Runtime-only OffscreenCanvas handle. It never crosses the provider output. */
  readonly canvas: object;
  /** Runtime-only WebGL2RenderingContext handle. */
  readonly context: object;
  dispose(): void;
}

export interface StudioProceduralArtisticBrushAdapterDescriptor {
  readonly id: string;
  readonly version: string;
  readonly compatibility: "p5.brush/standalone";
  readonly executionStage: "settled-only";
  readonly executionLocality: "dedicated-worker";
  readonly surface: "offscreen-canvas-webgl2";
  readonly deterministicSeed: true;
  readonly mainSceneAuthority: false;
  readonly capabilities:
    readonly StudioProceduralArtisticBrushCapability[];
}

export interface StudioProceduralArtisticBrushAdapterInput {
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly strokeId: string;
  readonly stage: "settled";
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly plan: StudioProceduralArtisticBrushPlan;
  readonly surface: StudioProceduralArtisticOffscreenWebGl2Surface;
}

export interface StudioProceduralArtisticBrushAdapterOutput {
  readonly kind: "studio-procedural-artistic-brush/adapter-output";
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly backend: "webgl2";
  readonly executionStage: "settled";
  readonly complete: true;
  readonly pixels: Uint8Array | Uint8ClampedArray;
  readonly capabilitiesUsed:
    readonly StudioProceduralArtisticBrushCapability[];
}

export interface StudioProceduralArtisticBrushAdapter {
  readonly descriptor: StudioProceduralArtisticBrushAdapterDescriptor;
  renderSettled(
    input: StudioProceduralArtisticBrushAdapterInput,
    signal: AbortSignal,
  ):
    | Promise<StudioProceduralArtisticBrushAdapterOutput>
    | StudioProceduralArtisticBrushAdapterOutput;
  dispose?(): Promise<void> | void;
}

export type StudioProceduralArtisticBrushAdapterLoader = () =>
  | Promise<StudioProceduralArtisticBrushAdapter | null>
  | StudioProceduralArtisticBrushAdapter
  | null;

export type StudioProceduralArtisticSurfaceFactory = (
  input: Readonly<{
    width: number;
    height: number;
    contextType: "webgl2";
    executionLocality: "dedicated-worker";
    transferredFromMainThread: false;
  }>,
) => StudioProceduralArtisticOffscreenWebGl2Surface | null;

export interface StudioProceduralArtisticBrushProviderOptions {
  readonly engineEpoch: number;
  readonly executionLocality: "dedicated-worker";
  readonly loadAdapter: StudioProceduralArtisticBrushAdapterLoader;
  readonly createSurface: StudioProceduralArtisticSurfaceFactory;
}

export type StudioProceduralArtisticBrushFailureReason =
  | "invalid-options"
  | "invalid-request"
  | "live-stage-forbidden"
  | "epoch-mismatch"
  | "backpressure"
  | "runtime-unavailable"
  | "invalid-runtime-adapter"
  | "unsupported-capability"
  | "surface-unavailable"
  | "invalid-surface"
  | "adapter-failed"
  | "invalid-adapter-output"
  | "aborted"
  | "disposed";

export interface StudioProceduralArtisticBrushReceipt {
  readonly kind: "studio-procedural-artistic-brush/receipt";
  readonly version:
    typeof STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly strokeId: string;
  readonly seed: number;
  readonly technique: StudioProceduralArtisticBrushTechnique;
  readonly presetId: string;
  readonly width: number;
  readonly height: number;
  readonly outputBytes: number;
  readonly inputFingerprint: `sha256:${string}`;
  readonly pixelHash: `sha256:${string}`;
  readonly replayFingerprint: `sha256:${string}`;
  readonly adapter: Readonly<{
    id: string;
    version: string;
    compatibility: "p5.brush/standalone";
  }>;
  readonly execution: Readonly<{
    stage: "settled";
    locality: "dedicated-worker";
    surface: "offscreen-canvas-webgl2";
    backend: "webgl2";
    mainThreadFallback: false;
  }>;
  readonly authority: Readonly<{
    mainScene: false;
    document: false;
    history: false;
    persistence: false;
    output: "settled-raster-suggestion";
  }>;
  readonly capabilitiesUsed:
    readonly StudioProceduralArtisticBrushCapability[];
  readonly complete: true;
}

export interface StudioProceduralArtisticBrushArtifact {
  readonly kind: "studio-procedural-artistic-brush/artifact";
  readonly version:
    typeof STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION;
  readonly width: number;
  readonly height: number;
  readonly encoding: "rgba8-unorm";
  readonly colorSpace: "srgb";
  readonly alpha: "straight";
  readonly pixels: Uint8ClampedArray;
  readonly receipt: StudioProceduralArtisticBrushReceipt;
}

export type StudioProceduralArtisticBrushResult =
  | Readonly<{
      status: "completed";
      consumed: false;
      artifact: StudioProceduralArtisticBrushArtifact;
    }>
  | Readonly<{
      status: "rejected";
      consumed: false;
      reason: StudioProceduralArtisticBrushFailureReason;
      detail: string;
    }>;

export type StudioProceduralArtisticBrushProviderCreationResult =
  | Readonly<{
      status: "ready";
      provider: StudioProceduralArtisticBrushProvider;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-options";
      path: string;
    }>;

interface NormalizedPlan {
  readonly technique: StudioProceduralArtisticBrushTechnique;
  readonly presetId: string;
  readonly samples: readonly StudioProceduralArtisticBrushSample[];
  readonly parameters: Readonly<
    Record<string, StudioProceduralArtisticBrushParameter>
  >;
  readonly tip?: Readonly<{
    kind: "image" | "custom";
    assetId: string;
    width: number;
    height: number;
    rgba8: Uint8Array;
    contentHash: `sha256:${string}`;
  }>;
}

interface NormalizedRequest {
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly strokeId: string;
  readonly stage: "settled";
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly plan: NormalizedPlan;
  readonly signal?: AbortSignal;
  readonly requiredCapability: StudioProceduralArtisticBrushCapability;
  readonly inputFingerprint: `sha256:${string}`;
}

interface ResolvedAdapter {
  readonly adapter: StudioProceduralArtisticBrushAdapter;
  readonly descriptor: StudioProceduralArtisticBrushAdapterDescriptor;
}

const CAPABILITY_SET = new Set<StudioProceduralArtisticBrushCapability>(
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_CAPABILITIES,
);
const TECHNIQUES = new Set<StudioProceduralArtisticBrushTechnique>([
  "flow-field",
  "hatch",
  "mass",
  "watercolor-fill",
  "flat-wash",
  "image-tip",
  "custom-tip",
]);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u;
const PRODUCT_COLOR = /^#[0-9a-f]{6}$/iu;
const WATERCOLOR_FILL_PARAMETER_KEYS = Object.freeze([
  "angle",
  "color",
  "density",
  "opacity",
  "strength",
]);
const FLAT_WASH_PARAMETER_KEYS = Object.freeze([
  "color",
  "opacity",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUint32(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 0xffff_ffff;
}

function isSafeIdentifier(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && SAFE_IDENTIFIER.test(value);
}

function reject(
  reason: StudioProceduralArtisticBrushFailureReason,
  detail: string,
): StudioProceduralArtisticBrushResult {
  return Object.freeze({
    status: "rejected",
    consumed: false,
    reason,
    detail: detail.slice(0, 512),
  });
}

function techniqueCapability(
  technique: StudioProceduralArtisticBrushTechnique,
): StudioProceduralArtisticBrushCapability {
  switch (technique) {
    case "flow-field":
      return "procedural:flow-field";
    case "hatch":
      return "procedural:hatch";
    case "mass":
      return "procedural:mass";
    case "watercolor-fill":
      return "procedural:watercolor-fill";
    case "flat-wash":
      return "procedural:flat-wash";
    case "image-tip":
      return "tip:image";
    case "custom-tip":
      return "tip:custom";
  }
}

function hashJson(value: unknown): `sha256:${string}` {
  return `sha256:${sha256HexPortable(
    new TextEncoder().encode(JSON.stringify(value)),
  )}`;
}

function hashPixels(
  value: Uint8Array | Uint8ClampedArray,
): `sha256:${string}` {
  const bytes = value instanceof Uint8ClampedArray
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : value;
  return `sha256:${sha256HexPortable(bytes)}`;
}

function normalizeParameters(
  input: unknown,
): Readonly<Record<string, StudioProceduralArtisticBrushParameter>> | null {
  if (!isPlainRecord(input)) return null;
  const keys = Object.keys(input);
  if (keys.length > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxParameters) {
    return null;
  }
  const output: Record<string, StudioProceduralArtisticBrushParameter> =
    Object.create(null) as Record<
      string,
      StudioProceduralArtisticBrushParameter
    >;
  for (const key of keys.sort()) {
    if (
      !isSafeIdentifier(
        key,
        STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxParameterNameCodeUnits,
      )
    ) return null;
    const value = input[key];
    if (
      typeof value === "string"
      && value.length <= STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS
        .maxParameterStringCodeUnits
    ) {
      output[key] = value;
    } else if (typeof value === "boolean" || isFiniteNumber(value)) {
      output[key] = value;
    } else {
      return null;
    }
  }
  return Object.freeze(output);
}

function exactParameterKeys(
  parameters: Readonly<
    Record<string, StudioProceduralArtisticBrushParameter>
  >,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(parameters);
  return keys.length === expected.length
    && expected.every((key) => Object.hasOwn(parameters, key));
}

function validCompositedFillParameters(
  technique: StudioProceduralArtisticBrushTechnique,
  parameters: Readonly<
    Record<string, StudioProceduralArtisticBrushParameter>
  >,
): boolean {
  if (technique === "watercolor-fill") {
    return exactParameterKeys(
      parameters,
      WATERCOLOR_FILL_PARAMETER_KEYS,
    )
      && typeof parameters.color === "string"
      && PRODUCT_COLOR.test(parameters.color)
      && isFiniteNumber(parameters.angle)
      && parameters.angle >= -Math.PI * 2
      && parameters.angle <= Math.PI * 2
      && isFiniteNumber(parameters.density)
      && parameters.density >= 0
      && parameters.density <= 1
      && isFiniteNumber(parameters.opacity)
      && parameters.opacity >= 0
      && parameters.opacity <= 1
      && isFiniteNumber(parameters.strength)
      && parameters.strength >= 0
      && parameters.strength <= 1;
  }
  if (technique === "flat-wash") {
    return exactParameterKeys(parameters, FLAT_WASH_PARAMETER_KEYS)
      && typeof parameters.color === "string"
      && PRODUCT_COLOR.test(parameters.color)
      && isFiniteNumber(parameters.opacity)
      && parameters.opacity >= 0.01
      && parameters.opacity <= 1;
  }
  return true;
}

function expectedFillPresetId(
  technique: StudioProceduralArtisticBrushTechnique,
): string | null {
  switch (technique) {
    case "watercolor-fill":
      return "studio-procedural-watercolor-fill-v1";
    case "flat-wash":
      return "studio-procedural-flat-wash-v1";
    default:
      return null;
  }
}

function normalizeSamples(
  input: unknown,
): readonly StudioProceduralArtisticBrushSample[] | null {
  if (
    !Array.isArray(input)
    || input.length === 0
    || input.length > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxSamples
  ) return null;
  const output: StudioProceduralArtisticBrushSample[] = [];
  for (const candidate of input) {
    if (!isPlainRecord(candidate)) return null;
    const keys = Object.keys(candidate);
    if (
      keys.length !== 6
      || ![
        "x",
        "y",
        "pressure",
        "tiltX",
        "tiltY",
        "timeMilliseconds",
      ].every((key) => Object.hasOwn(candidate, key))
    ) return null;
    const { x, y, pressure, tiltX, tiltY, timeMilliseconds } = candidate;
    if (
      !isFiniteNumber(x)
      || !isFiniteNumber(y)
      || !isFiniteNumber(pressure)
      || pressure < 0
      || pressure > 1
      || !isFiniteNumber(tiltX)
      || tiltX < -90
      || tiltX > 90
      || !isFiniteNumber(tiltY)
      || tiltY < -90
      || tiltY > 90
      || !isFiniteNumber(timeMilliseconds)
      || timeMilliseconds < 0
    ) return null;
    output.push(Object.freeze({
      x,
      y,
      pressure,
      tiltX,
      tiltY,
      timeMilliseconds,
    }));
  }
  return Object.freeze(output);
}

function normalizeTip(
  input: unknown,
): NormalizedPlan["tip"] | null | undefined {
  if (input === undefined) return undefined;
  if (!isPlainRecord(input)) return null;
  const { kind, assetId, width, height, rgba8 } = input;
  if (
    (kind !== "image" && kind !== "custom")
    || !isSafeIdentifier(
      assetId,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxPresetIdCodeUnits,
    )
    || !isPositiveSafeInteger(width)
    || !isPositiveSafeInteger(height)
    || width > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxWidth
    || height > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxHeight
    || width * height > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxTipPixels
    || !(rgba8 instanceof Uint8Array)
    || rgba8.byteLength !== width * height * 4
    || rgba8.byteLength > STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxTipBytes
  ) return null;
  const pixels = new Uint8Array(rgba8);
  return Object.freeze({
    kind,
    assetId,
    width,
    height,
    rgba8: pixels,
    contentHash: hashPixels(pixels),
  });
}

function normalizeRequest(
  input: unknown,
): NormalizedRequest | StudioProceduralArtisticBrushResult {
  if (!isPlainRecord(input)) {
    return reject("invalid-request", "Request must be a plain object.");
  }
  if (input.stage === "live") {
    return reject(
      "live-stage-forbidden",
      "Procedural artistic providers may render settled strokes only.",
    );
  }
  const {
    kind,
    version,
    requestSequence,
    engineEpoch,
    strokeId,
    stage,
    seed,
    width,
    height,
    pixelRatio,
    plan,
    signal,
  } = input;
  const rasterMemory = estimateStudioProceduralArtisticBrushRasterMemory(
    width,
    height,
  );
  if (
    kind !== "studio-procedural-artistic-brush/request"
    || version !== STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION
    || !isPositiveSafeInteger(requestSequence)
    || !isPositiveSafeInteger(engineEpoch)
    || !isSafeIdentifier(
      strokeId,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxPresetIdCodeUnits,
    )
    || stage !== "settled"
    || !isUint32(seed)
    || !isPositiveSafeInteger(width)
    || !isPositiveSafeInteger(height)
    || rasterMemory === null
    || !isFiniteNumber(pixelRatio)
    || pixelRatio <= 0
    || pixelRatio > 16
    || !isPlainRecord(plan)
    || (
      signal !== undefined
      && !(signal instanceof AbortSignal)
    )
  ) return reject("invalid-request", "Request fields failed validation.");

  const technique = plan.technique;
  const presetId = plan.presetId;
  const samples = normalizeSamples(plan.samples);
  const parameters = normalizeParameters(plan.parameters);
  const tip = normalizeTip(plan.tip);
  if (
    typeof technique !== "string"
    || !TECHNIQUES.has(technique as StudioProceduralArtisticBrushTechnique)
    || !isSafeIdentifier(
      presetId,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxPresetIdCodeUnits,
    )
    || !samples
    || !parameters
    || tip === null
  ) return reject("invalid-request", "Artistic plan failed validation.");

  const normalizedTechnique =
    technique as StudioProceduralArtisticBrushTechnique;
  const fillPresetId = expectedFillPresetId(normalizedTechnique);
  if (
    (normalizedTechnique === "image-tip" && tip?.kind !== "image")
    || (normalizedTechnique === "custom-tip" && tip?.kind !== "custom")
    || (
      normalizedTechnique !== "image-tip"
      && normalizedTechnique !== "custom-tip"
      && tip !== undefined
    )
    || (
      fillPresetId !== null
      && presetId !== fillPresetId
    )
    || !validCompositedFillParameters(normalizedTechnique, parameters)
    || estimateStudioProceduralArtisticBrushRasterMemory(
      width,
      height,
      normalizedTechnique,
    ) === null
  ) {
    return reject(
      "invalid-request",
      "Tip payload does not match the selected technique.",
    );
  }

  const normalizedPlan = Object.freeze({
    technique: normalizedTechnique,
    presetId,
    samples,
    parameters,
    ...(tip === undefined ? {} : { tip }),
  });
  const inputFingerprint = hashJson({
    width,
    height,
    pixelRatio,
    seed,
    technique: normalizedPlan.technique,
    presetId: normalizedPlan.presetId,
    samples: normalizedPlan.samples,
    parameters: normalizedPlan.parameters,
    tip: normalizedPlan.tip
      ? {
          kind: normalizedPlan.tip.kind,
          assetId: normalizedPlan.tip.assetId,
          width: normalizedPlan.tip.width,
          height: normalizedPlan.tip.height,
          contentHash: normalizedPlan.tip.contentHash,
        }
      : null,
  });
  return Object.freeze({
    requestSequence,
    engineEpoch,
    strokeId,
    stage: "settled",
    seed,
    width,
    height,
    pixelRatio,
    plan: normalizedPlan,
    ...(signal === undefined ? {} : { signal }),
    requiredCapability: techniqueCapability(normalizedTechnique),
    inputFingerprint,
  });
}

function normalizeCapabilities(
  input: unknown,
): readonly StudioProceduralArtisticBrushCapability[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const unique = new Set<StudioProceduralArtisticBrushCapability>();
  for (const capability of input) {
    if (
      typeof capability !== "string"
      || !CAPABILITY_SET.has(
        capability as StudioProceduralArtisticBrushCapability,
      )
    ) return null;
    unique.add(capability as StudioProceduralArtisticBrushCapability);
  }
  return Object.freeze([...unique]);
}

function normalizeAdapter(
  input: unknown,
): ResolvedAdapter | null {
  if (!isPlainRecord(input) || typeof input.renderSettled !== "function") {
    return null;
  }
  const descriptor = input.descriptor;
  if (!isPlainRecord(descriptor)) return null;
  const capabilities = normalizeCapabilities(descriptor.capabilities);
  if (
    !isSafeIdentifier(
      descriptor.id,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxPresetIdCodeUnits,
    )
    || !isSafeIdentifier(
      descriptor.version,
      STUDIO_PROCEDURAL_ARTISTIC_BRUSH_LIMITS.maxPresetIdCodeUnits,
    )
    || descriptor.compatibility !== "p5.brush/standalone"
    || descriptor.executionStage !== "settled-only"
    || descriptor.executionLocality !== "dedicated-worker"
    || descriptor.surface !== "offscreen-canvas-webgl2"
    || descriptor.deterministicSeed !== true
    || descriptor.mainSceneAuthority !== false
    || !capabilities
    || !capabilities.includes("execution:settled-only")
    || !capabilities.includes("surface:offscreen-canvas")
    || !capabilities.includes("gpu:webgl2")
    || !capabilities.includes("seed:deterministic")
    || !capabilities.includes("authority:none")
  ) return null;
  const adapter = input as unknown as StudioProceduralArtisticBrushAdapter;
  return Object.freeze({
    adapter,
    descriptor: Object.freeze({
      id: descriptor.id,
      version: descriptor.version,
      compatibility: "p5.brush/standalone",
      executionStage: "settled-only",
      executionLocality: "dedicated-worker",
      surface: "offscreen-canvas-webgl2",
      deterministicSeed: true,
      mainSceneAuthority: false,
      capabilities,
    }),
  });
}

function normalizeSurface(
  input: unknown,
  width: number,
  height: number,
): StudioProceduralArtisticOffscreenWebGl2Surface | null {
  if (!isPlainRecord(input)) return null;
  if (
    input.kind !== "offscreen-canvas-webgl2"
    || input.executionLocality !== "dedicated-worker"
    || input.transferredFromMainThread !== false
    || input.width !== width
    || input.height !== height
    || typeof input.canvas !== "object"
    || input.canvas === null
    || typeof input.context !== "object"
    || input.context === null
    || typeof input.dispose !== "function"
  ) return null;
  return input as unknown as StudioProceduralArtisticOffscreenWebGl2Surface;
}

function normalizeAdapterOutput(
  input: unknown,
  request: NormalizedRequest,
  descriptor: StudioProceduralArtisticBrushAdapterDescriptor,
): Readonly<{
  pixels: Uint8ClampedArray;
  capabilitiesUsed: readonly StudioProceduralArtisticBrushCapability[];
}> | null {
  if (!isPlainRecord(input)) return null;
  const capabilitiesUsed = normalizeCapabilities(input.capabilitiesUsed);
  if (
    input.kind !== "studio-procedural-artistic-brush/adapter-output"
    || input.width !== request.width
    || input.height !== request.height
    || input.seed !== request.seed
    || input.backend !== "webgl2"
    || input.executionStage !== "settled"
    || input.complete !== true
    || !(
      input.pixels instanceof Uint8Array
      || input.pixels instanceof Uint8ClampedArray
    )
    || input.pixels.byteLength !== request.width * request.height * 4
    || !capabilitiesUsed
    || !capabilitiesUsed.includes(request.requiredCapability)
    || capabilitiesUsed.some(
      (capability) => !descriptor.capabilities.includes(capability),
    )
  ) return null;
  return Object.freeze({
    pixels: new Uint8ClampedArray(input.pixels),
    capabilitiesUsed,
  });
}

function createLinkedAbortController(
  callerSignal: AbortSignal | undefined,
): Readonly<{
  controller: AbortController;
  removeCallerListener: () => void;
}> {
  const controller = new AbortController();
  const abort = (): void => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abort();
  else callerSignal?.addEventListener("abort", abort, { once: true });
  return Object.freeze({
    controller,
    removeCallerListener: () => {
      callerSignal?.removeEventListener("abort", abort);
    },
  });
}

export class StudioProceduralArtisticBrushProvider {
  readonly #loadAdapter: StudioProceduralArtisticBrushAdapterLoader;
  readonly #createSurface: StudioProceduralArtisticSurfaceFactory;
  #engineEpoch: number;
  #phase: "cold" | "ready" | "disposed" = "cold";
  #adapterResolution:
    | Promise<ResolvedAdapter | null>
    | null = null;
  #resolvedAdapter: ResolvedAdapter | null = null;
  #adapterDisposal: Promise<void> | null = null;
  #providerDisposal: Promise<void> | null = null;
  #loaderCalls = 0;
  #activeController: AbortController | null = null;
  #completed = 0;
  #rejected = 0;

  constructor(options: StudioProceduralArtisticBrushProviderOptions) {
    if (
      !isPositiveSafeInteger(options.engineEpoch)
      || options.executionLocality !== "dedicated-worker"
      || typeof options.loadAdapter !== "function"
      || typeof options.createSurface !== "function"
    ) {
      throw new TypeError("Invalid procedural artistic provider options.");
    }
    this.#engineEpoch = options.engineEpoch;
    this.#loadAdapter = options.loadAdapter;
    this.#createSurface = options.createSurface;
  }

  #isDisposed(): boolean {
    return this.#phase === "disposed";
  }

  #disposeAdapterOnce(adapter: ResolvedAdapter["adapter"]): Promise<void> {
    if (this.#adapterDisposal) return this.#adapterDisposal;
    this.#adapterDisposal = Promise.resolve()
      .then(() => adapter.dispose?.())
      .then(
        () => undefined,
        () => undefined,
      );
    return this.#adapterDisposal;
  }

  async #resolveAdapter(): Promise<ResolvedAdapter | null> {
    if (this.#adapterResolution) return this.#adapterResolution;
    this.#loaderCalls += 1;
    this.#adapterResolution = Promise.resolve()
      .then(() => this.#loadAdapter())
      .then((adapter) => normalizeAdapter(adapter))
      .catch(() => null);
    const resolved = await this.#adapterResolution;
    if (resolved) {
      if (this.#phase === "disposed") {
        await this.#disposeAdapterOnce(resolved.adapter);
      } else {
        this.#resolvedAdapter = resolved;
        this.#phase = "ready";
      }
    }
    return resolved;
  }

  async render(
    input: unknown,
  ): Promise<StudioProceduralArtisticBrushResult> {
    if (this.#phase === "disposed") {
      this.#rejected += 1;
      return reject("disposed", "Provider has been disposed.");
    }
    const request = normalizeRequest(input);
    if ("status" in request) {
      this.#rejected += 1;
      return request;
    }
    if (request.engineEpoch !== this.#engineEpoch) {
      this.#rejected += 1;
      return reject("epoch-mismatch", "Request engine epoch is stale.");
    }
    if (this.#activeController) {
      this.#rejected += 1;
      return reject("backpressure", "Only one artistic render may run at once.");
    }

    const linkedAbort = createLinkedAbortController(request.signal);
    this.#activeController = linkedAbort.controller;
    let surface: StudioProceduralArtisticOffscreenWebGl2Surface | null = null;
    try {
      if (linkedAbort.controller.signal.aborted) {
        this.#rejected += 1;
        return reject("aborted", "Render was aborted before runtime loading.");
      }
      const resolved = await this.#resolveAdapter();
      if (!resolved) {
        this.#rejected += 1;
        return reject(
          "runtime-unavailable",
          "No valid p5.brush-compatible runtime adapter is available.",
        );
      }
      if (this.#isDisposed()) {
        this.#rejected += 1;
        return reject("disposed", "Provider was disposed during runtime loading.");
      }
      if (linkedAbort.controller.signal.aborted) {
        this.#rejected += 1;
        return reject("aborted", "Render was aborted during runtime loading.");
      }
      if (
        !resolved.descriptor.capabilities.includes(request.requiredCapability)
      ) {
        this.#rejected += 1;
        return reject(
          "unsupported-capability",
          `Runtime does not support ${request.requiredCapability}.`,
        );
      }

      let surfaceCandidate: unknown;
      try {
        surfaceCandidate = this.#createSurface({
          width: request.width,
          height: request.height,
          contextType: "webgl2",
          executionLocality: "dedicated-worker",
          transferredFromMainThread: false,
        });
      } catch {
        this.#rejected += 1;
        return reject(
          "surface-unavailable",
          "Offscreen WebGL2 surface creation failed.",
        );
      }
      if (surfaceCandidate === null) {
        this.#rejected += 1;
        return reject(
          "surface-unavailable",
          "Offscreen WebGL2 surface is unavailable.",
        );
      }
      surface = normalizeSurface(
        surfaceCandidate,
        request.width,
        request.height,
      );
      if (!surface) {
        try {
          if (
            isPlainRecord(surfaceCandidate)
            && typeof surfaceCandidate.dispose === "function"
          ) {
            surfaceCandidate.dispose();
          }
        } catch {
          // Invalid surfaces remain rejected regardless of cleanup failure.
        }
        this.#rejected += 1;
        return reject(
          "invalid-surface",
          "Surface factory returned an invalid isolation contract.",
        );
      }

      let rawOutput: unknown;
      try {
        rawOutput = await resolved.adapter.renderSettled(
          Object.freeze({
            requestSequence: request.requestSequence,
            engineEpoch: request.engineEpoch,
            strokeId: request.strokeId,
            stage: "settled",
            seed: request.seed,
            width: request.width,
            height: request.height,
            pixelRatio: request.pixelRatio,
            plan: request.plan,
            surface,
          }),
          linkedAbort.controller.signal,
        );
      } catch {
        if (linkedAbort.controller.signal.aborted) {
          this.#rejected += 1;
          return reject("aborted", "Artistic render was aborted.");
        }
        this.#rejected += 1;
        return reject("adapter-failed", "Artistic runtime adapter failed.");
      }
      if (linkedAbort.controller.signal.aborted) {
        this.#rejected += 1;
        return reject("aborted", "Artistic render was aborted.");
      }
      if (this.#isDisposed()) {
        this.#rejected += 1;
        return reject("disposed", "Provider was disposed during rendering.");
      }
      const output = normalizeAdapterOutput(
        rawOutput,
        request,
        resolved.descriptor,
      );
      rawOutput = null;
      if (!output) {
        this.#rejected += 1;
        return reject(
          "invalid-adapter-output",
          "Artistic runtime returned an invalid raster artifact.",
        );
      }

      const pixelHash = hashPixels(output.pixels);
      const replayFingerprint = hashJson({
        inputFingerprint: request.inputFingerprint,
        pixelHash,
        adapterId: resolved.descriptor.id,
        adapterVersion: resolved.descriptor.version,
        capabilitiesUsed: output.capabilitiesUsed,
      });
      const receipt: StudioProceduralArtisticBrushReceipt = Object.freeze({
        kind: "studio-procedural-artistic-brush/receipt",
        version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION,
        requestSequence: request.requestSequence,
        engineEpoch: request.engineEpoch,
        strokeId: request.strokeId,
        seed: request.seed,
        technique: request.plan.technique,
        presetId: request.plan.presetId,
        width: request.width,
        height: request.height,
        outputBytes: output.pixels.byteLength,
        inputFingerprint: request.inputFingerprint,
        pixelHash,
        replayFingerprint,
        adapter: Object.freeze({
          id: resolved.descriptor.id,
          version: resolved.descriptor.version,
          compatibility: "p5.brush/standalone",
        }),
        execution: Object.freeze({
          stage: "settled",
          locality: "dedicated-worker",
          surface: "offscreen-canvas-webgl2",
          backend: "webgl2",
          mainThreadFallback: false,
        }),
        authority: Object.freeze({
          mainScene: false,
          document: false,
          history: false,
          persistence: false,
          output: "settled-raster-suggestion",
        }),
        capabilitiesUsed: output.capabilitiesUsed,
        complete: true,
      });
      const artifact: StudioProceduralArtisticBrushArtifact = Object.freeze({
        kind: "studio-procedural-artistic-brush/artifact",
        version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_PROVIDER_REVISION,
        width: request.width,
        height: request.height,
        encoding: "rgba8-unorm",
        colorSpace: "srgb",
        alpha: "straight",
        pixels: output.pixels,
        receipt,
      });
      this.#completed += 1;
      return Object.freeze({
        status: "completed",
        consumed: false,
        artifact,
      });
    } finally {
      try {
        surface?.dispose();
      } catch {
        // Disposal cannot retroactively invalidate an already copied artifact.
      }
      linkedAbort.removeCallerListener();
      if (this.#activeController === linkedAbort.controller) {
        this.#activeController = null;
      }
    }
  }

  advanceEngineEpoch(): number {
    if (this.#phase === "disposed") return this.#engineEpoch;
    this.#activeController?.abort("engine-epoch-advanced");
    this.#engineEpoch += 1;
    return this.#engineEpoch;
  }

  snapshot(): Readonly<{
    phase: "cold" | "ready" | "disposed";
    engineEpoch: number;
    adapterLoaded: boolean;
    loaderCalls: number;
    active: boolean;
    completed: number;
    rejected: number;
    authority: "none";
    execution: "dedicated-worker-offscreen-webgl2-settled-only";
  }> {
    return Object.freeze({
      phase: this.#phase,
      engineEpoch: this.#engineEpoch,
      adapterLoaded: this.#resolvedAdapter !== null,
      loaderCalls: this.#loaderCalls,
      active: this.#activeController !== null,
      completed: this.#completed,
      rejected: this.#rejected,
      authority: "none",
      execution: "dedicated-worker-offscreen-webgl2-settled-only",
    });
  }

  dispose(): Promise<void> {
    if (this.#providerDisposal) return this.#providerDisposal;
    this.#phase = "disposed";
    this.#activeController?.abort("provider-disposed");
    const pendingAdapter = this.#adapterResolution;
    this.#providerDisposal = (async () => {
      const resolved =
        this.#resolvedAdapter
        ?? (pendingAdapter ? await pendingAdapter : null);
      if (resolved) await this.#disposeAdapterOnce(resolved.adapter);
    })();
    return this.#providerDisposal;
  }
}

export function createStudioProceduralArtisticBrushProvider(
  input: unknown,
): StudioProceduralArtisticBrushProviderCreationResult {
  if (!isPlainRecord(input)) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-options",
      path: "options",
    });
  }
  if (
    !isPositiveSafeInteger(input.engineEpoch)
    || input.executionLocality !== "dedicated-worker"
    || typeof input.loadAdapter !== "function"
    || typeof input.createSurface !== "function"
  ) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-options",
      path: "options",
    });
  }
  return Object.freeze({
    status: "ready",
    provider: new StudioProceduralArtisticBrushProvider({
      engineEpoch: input.engineEpoch,
      executionLocality: "dedicated-worker",
      loadAdapter:
        input.loadAdapter as StudioProceduralArtisticBrushAdapterLoader,
      createSurface:
        input.createSurface as StudioProceduralArtisticSurfaceFactory,
    }),
  });
}
