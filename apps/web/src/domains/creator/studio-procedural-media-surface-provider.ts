/**
 * Clean-room procedural media surface CPU oracle.
 *
 * Every sample is evaluated from immutable recipe state and global world
 * coordinates. Tile order, tile dimensions, and halo size therefore cannot
 * perturb the generated channels. No scanned media, preset payload, renderer,
 * host surface, or nondeterministic scheduling input can perturb its bytes.
 */

import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_PROCEDURAL_MEDIA_SURFACE_RECIPE_VERSION = 1 as const;
export const STUDIO_PROCEDURAL_MEDIA_SURFACE_PROVIDER_REVISION = 1 as const;
export const STUDIO_PROCEDURAL_MEDIA_SURFACE_RECEIPT_VERSION = 1 as const;

export const STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS = Object.freeze({
  maximumWidth: 16_384,
  maximumHeight: 16_384,
  maximumHalo: 1_024,
  maximumOutputPixels: 67_108_864,
  maximumWorkUnits: 2_147_483_648,
  maximumResidentBytes: 768 * 1024 * 1024,
  maximumOctaves: 12,
  maximumCoordinateMagnitude: 1_000_000_000,
  maximumRecipeJsonCodeUnits: 262_144,
} as const);

export interface StudioProceduralMediaReliefRecipe {
  readonly frequency: number;
  readonly octaves: number;
  readonly lacunarity: number;
  readonly gain: number;
  readonly amplitude: number;
}

export interface StudioProceduralMediaFiberRecipe {
  readonly frequency: number;
  readonly amplitude: number;
  readonly directionRadians: number;
  readonly irregularity: number;
}

export interface StudioProceduralMediaWeaveRecipe {
  readonly warpFrequency: number;
  readonly weftFrequency: number;
  readonly amplitude: number;
  readonly balance: number;
}

export interface StudioProceduralMediaPoreRecipe {
  readonly frequency: number;
  readonly density: number;
  readonly amplitude: number;
}

export interface StudioProceduralMediaSpeckleRecipe {
  readonly frequency: number;
  readonly density: number;
  readonly amplitude: number;
}

export interface StudioProceduralMediaChannelRecipe {
  readonly absorbencyBase: number;
  readonly reliefToAbsorbency: number;
  readonly poreToAbsorbency: number;
  readonly speckleToAbsorbency: number;
  readonly grainBase: number;
  readonly reliefToGrain: number;
  readonly fiberToGrain: number;
  readonly weaveToGrain: number;
  readonly speckleToGrain: number;
}

export interface StudioProceduralMediaFlowRecipe {
  readonly gradientStep: number;
  readonly downhillWeight: number;
  /** Signed weight; negative values reverse tangent circulation. */
  readonly tangentWeight: number;
  readonly gravity: readonly [x: number, y: number];
  readonly wind: readonly [x: number, y: number];
}

export interface StudioProceduralMediaSurfaceRecipeInput {
  readonly seed: number;
  readonly worldScale: number;
  readonly rotationRadians: number;
  readonly offset: readonly [x: number, y: number];
  readonly contrast: number;
  /**
   * World-space x/y period. Null selects aperiodic value fields. Periodic mode
   * uses integer Fourier modes so translating by either period is seamless.
   */
  readonly seamlessPeriod: readonly [x: number, y: number] | null;
  readonly relief: StudioProceduralMediaReliefRecipe;
  readonly fibers: StudioProceduralMediaFiberRecipe;
  readonly weave: StudioProceduralMediaWeaveRecipe;
  readonly pores: StudioProceduralMediaPoreRecipe;
  readonly speckles: StudioProceduralMediaSpeckleRecipe;
  readonly channels: StudioProceduralMediaChannelRecipe;
  readonly flow: StudioProceduralMediaFlowRecipe;
}

export interface StudioProceduralMediaSurfaceRecipe
  extends StudioProceduralMediaSurfaceRecipeInput {
  readonly kind: "studio-procedural-media-surface-recipe";
  readonly version: typeof STUDIO_PROCEDURAL_MEDIA_SURFACE_RECIPE_VERSION;
  readonly fingerprint: `sha256:${string}`;
}

export type StudioProceduralMediaSurfaceRecipeCreationResult =
  | Readonly<{
      status: "ready";
      recipe: StudioProceduralMediaSurfaceRecipe;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-recipe";
      path: string;
    }>;

export interface StudioProceduralMediaSurfaceRegion {
  /** Global x/y coordinate of the first core pixel, before halo expansion. */
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
  readonly halo: number;
}

export interface StudioProceduralMediaSurfaceBudgets {
  readonly maximumOutputPixels?: number;
  readonly maximumWorkUnits?: number;
  readonly maximumResidentBytes?: number;
}

export interface StudioProceduralMediaSurfaceCpuOptions
  extends StudioProceduralMediaSurfaceBudgets {
  readonly signal?: AbortSignal;
}

export interface StudioProceduralMediaSurfaceReceipt {
  readonly kind: "studio-procedural-media-surface-receipt";
  readonly version: typeof STUDIO_PROCEDURAL_MEDIA_SURFACE_RECEIPT_VERSION;
  readonly providerRevision:
    typeof STUDIO_PROCEDURAL_MEDIA_SURFACE_PROVIDER_REVISION;
  readonly backend: "cpu-f32-global-coordinate-oracle";
  readonly samplingConvention: "integer-pixel-centers-plus-one-half";
  readonly tileContract: "global-origin-with-symmetric-halo";
  readonly periodicMode: "aperiodic" | "integer-fourier-torus";
  readonly flowModel:
    "unit-clamp(downhill*(-normalized-height-gradient)+tangent*perpendicular+gravity+wind)";
  readonly gradientModel: "global-central-difference-composite-height";
  readonly recipeFingerprint: `sha256:${string}`;
  readonly origin: readonly [x: number, y: number];
  readonly coreOrigin: readonly [x: number, y: number];
  readonly coreSize: readonly [width: number, height: number];
  readonly outputSize: readonly [width: number, height: number];
  readonly halo: number;
  readonly outputPixels: number;
  readonly workUnits: number;
  readonly residentBytes: number;
  readonly heightHash: `sha256:${string}`;
  readonly absorbencyHash: `sha256:${string}`;
  readonly grainHash: `sha256:${string}`;
  readonly flowHash: `sha256:${string}`;
  readonly artifactHash: `sha256:${string}`;
  readonly complete: true;
}

export interface StudioProceduralMediaSurfaceArtifact {
  readonly kind: "studio-procedural-media-surface-artifact";
  readonly version: typeof STUDIO_PROCEDURAL_MEDIA_SURFACE_RECEIPT_VERSION;
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
  /** Signed normalized relief in [-1, 1]. */
  readonly heightField: Float32Array;
  /** Water/paint uptake coefficient in [0, 1]. */
  readonly absorbency: Float32Array;
  /** Dry media contact/granulation coefficient in [0, 1]. */
  readonly grain: Float32Array;
  /** Interleaved x/y flow vector, unit-clamped. */
  readonly flow: Float32Array;
  readonly receipt: StudioProceduralMediaSurfaceReceipt;
}

export interface StudioProceduralMediaSurfaceProviderOptions
  extends StudioProceduralMediaSurfaceBudgets {
  readonly initialEngineEpoch?: number;
}

export interface StudioProceduralMediaSurfaceRenderRequest {
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly recipe: StudioProceduralMediaSurfaceRecipe;
  readonly region: StudioProceduralMediaSurfaceRegion;
  readonly signal?: AbortSignal;
}

export interface StudioProceduralMediaSurfaceRenderReceipt {
  readonly kind: "studio-procedural-media-surface-render-receipt";
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly artifact: StudioProceduralMediaSurfaceArtifact;
  readonly receiptHash: `sha256:${string}`;
  readonly complete: true;
}

export type StudioProceduralMediaSurfaceProviderCreationResult =
  | Readonly<{
      status: "ready";
      provider: StudioProceduralMediaSurfaceProvider;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-options";
      path: string;
    }>;

export type StudioProceduralMediaSurfaceErrorCode =
  | "invalid-recipe"
  | "invalid-region"
  | "invalid-request"
  | "budget-exceeded"
  | "request-sequence"
  | "engine-epoch"
  | "backpressure"
  | "aborted"
  | "disposed";

export class StudioProceduralMediaSurfaceError extends Error {
  public constructor(
    readonly code: StudioProceduralMediaSurfaceErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = "StudioProceduralMediaSurfaceError";
  }
}

interface NormalizedBudgets {
  readonly maximumOutputPixels: number;
  readonly maximumWorkUnits: number;
  readonly maximumResidentBytes: number;
}

interface PreparedExecution {
  readonly recipe: StudioProceduralMediaSurfaceRecipe;
  readonly region: StudioProceduralMediaSurfaceRegion;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly outputOriginX: number;
  readonly outputOriginY: number;
  readonly outputPixels: number;
  readonly workUnits: number;
  readonly residentBytes: number;
  readonly signal?: AbortSignal;
}

interface PreparedChannels {
  readonly heightField: Float32Array;
  readonly absorbency: Float32Array;
  readonly grain: Float32Array;
  readonly flow: Float32Array;
}

interface PreparedChannelHashes {
  readonly heightHash: `sha256:${string}`;
  readonly absorbencyHash: `sha256:${string}`;
  readonly grainHash: `sha256:${string}`;
  readonly flowHash: `sha256:${string}`;
}

interface CooperativeTaskScheduler {
  yieldTask(): Promise<void>;
  dispose(): void;
}

interface RuntimeAbortSignal {
  readonly target: object;
  readonly initialAborted: boolean;
  readonly addEventListener: (
    this: object,
    type: "abort",
    listener: () => void,
    options: Readonly<{ once: true }>,
  ) => void;
  readonly removeEventListener: (
    this: object,
    type: "abort",
    listener: () => void,
  ) => void;
}

interface ProviderActiveExecution {
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly cancellation: {
    aborted: boolean;
  };
}

interface ProviderRequestAdmission {
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly recipe: StudioProceduralMediaSurfaceRecipe;
  readonly region: StudioProceduralMediaSurfaceRegion;
  readonly signal?: RuntimeAbortSignal;
}

interface ComponentSample {
  readonly height: number;
  readonly absorbency: number;
  readonly grain: number;
}

const RECIPE_INPUT_KEYS = Object.freeze([
  "seed",
  "worldScale",
  "rotationRadians",
  "offset",
  "contrast",
  "seamlessPeriod",
  "relief",
  "fibers",
  "weave",
  "pores",
  "speckles",
  "channels",
  "flow",
]);
const RECIPE_KEYS = Object.freeze([
  "kind",
  "version",
  ...RECIPE_INPUT_KEYS,
  "fingerprint",
]);
const REGION_KEYS = Object.freeze([
  "originX",
  "originY",
  "width",
  "height",
  "halo",
]);
const REQUEST_KEYS = Object.freeze([
  "requestSequence",
  "engineEpoch",
  "recipe",
  "region",
]);
const OPTION_KEYS = Object.freeze([
  "initialEngineEpoch",
  "maximumOutputPixels",
  "maximumWorkUnits",
  "maximumResidentBytes",
]);
const COOPERATIVE_PIXEL_CHUNK = 2_048;
const COOPERATIVE_HASH_FLOAT_CHUNK = 16_384;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function range(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return finite(value) && value >= minimum && value <= maximum;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= minimum
    && (value as number) <= maximum;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!plainRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key));
}

function snapshotRuntimeAbortSignal(
  value: unknown,
): RuntimeAbortSignal | null {
  if (
    (typeof value !== "object" && typeof value !== "function")
    || value === null
  ) return null;
  try {
    const aborted = Reflect.get(value, "aborted");
    const addEventListener = Reflect.get(value, "addEventListener");
    const removeEventListener = Reflect.get(value, "removeEventListener");
    if (
      typeof aborted !== "boolean"
      || typeof addEventListener !== "function"
      || typeof removeEventListener !== "function"
    ) return null;
    return Object.freeze({
      target: value,
      initialAborted: aborted,
      addEventListener: addEventListener as
        RuntimeAbortSignal["addEventListener"],
      removeEventListener: removeEventListener as
        RuntimeAbortSignal["removeEventListener"],
    });
  } catch {
    return null;
  }
}

function readRuntimeAbortState(
  signal: RuntimeAbortSignal,
): boolean | null {
  try {
    const aborted = Reflect.get(signal.target, "aborted");
    return typeof aborted === "boolean" ? aborted : null;
  } catch {
    return null;
  }
}

function safelyRemoveRuntimeAbortListener(
  signal: RuntimeAbortSignal,
  listener: () => void,
): void {
  try {
    signal.removeEventListener.call(
      signal.target,
      "abort",
      listener,
    );
  } catch {
    // Internal provider state is released before this untrusted callback.
  }
}

function vector2(
  value: unknown,
  minimum: number,
  maximum: number,
): value is readonly [number, number] {
  return Array.isArray(value)
    && value.length === 2
    && value.every((component) => range(component, minimum, maximum));
}

function cloneVector2(
  value: readonly [number, number],
): readonly [number, number] {
  return Object.freeze([value[0], value[1]]);
}

function hashJson(value: unknown): `sha256:${string}` {
  const json = JSON.stringify(value);
  if (
    json.length
    > STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumRecipeJsonCodeUnits
  ) {
    throw new StudioProceduralMediaSurfaceError(
      "budget-exceeded",
      "Canonical media surface JSON exceeds its integrity budget.",
    );
  }
  return `sha256:${sha256HexPortable(new TextEncoder().encode(json))}`;
}

function hashFloat32(value: Float32Array): `sha256:${string}` {
  const bytes = new Uint8Array(value.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setFloat32(
      index * Float32Array.BYTES_PER_ELEMENT,
      value[index] ?? 0,
      true,
    );
  }
  return `sha256:${sha256HexPortable(bytes)}`;
}

function digestHex(value: ArrayBuffer): `sha256:${string}` {
  const bytes = new Uint8Array(value);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `sha256:${hex}`;
}

function createCooperativeTaskScheduler(): CooperativeTaskScheduler {
  const channel = new MessageChannel();
  let pendingResolve: (() => void) | null = null;
  let disposed = false;
  channel.port1.onmessage = () => {
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve?.();
  };
  return {
    yieldTask(): Promise<void> {
      if (disposed) return Promise.resolve();
      if (pendingResolve !== null) {
        throw new TypeError(
          "Procedural media surface scheduler already has pending work.",
        );
      }
      return new Promise((resolve) => {
        pendingResolve = resolve;
        channel.port2.postMessage(undefined);
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const resolve = pendingResolve;
      pendingResolve = null;
      channel.port1.onmessage = null;
      channel.port1.close();
      channel.port2.close();
      resolve?.();
    },
  };
}

async function hashFloat32Cooperatively(
  value: Float32Array,
  scheduler: CooperativeTaskScheduler,
  assertActive: () => void,
): Promise<`sha256:${string}`> {
  const bytes = new Uint8Array(
    value.length * Float32Array.BYTES_PER_ELEMENT,
  );
  const view = new DataView(bytes.buffer);
  for (
    let start = 0;
    start < value.length;
    start += COOPERATIVE_HASH_FLOAT_CHUNK
  ) {
    assertActive();
    const end = Math.min(
      value.length,
      start + COOPERATIVE_HASH_FLOAT_CHUNK,
    );
    for (let index = start; index < end; index += 1) {
      view.setFloat32(
        index * Float32Array.BYTES_PER_ELEMENT,
        value[index] ?? 0,
        true,
      );
    }
    assertActive();
    if (end < value.length) await scheduler.yieldTask();
  }
  assertActive();
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new StudioProceduralMediaSurfaceError(
      "invalid-request",
      "Cooperative procedural surface hashing requires SubtleCrypto.",
      "$.runtime.crypto.subtle",
    );
  }
  const digest = await subtle.digest("SHA-256", bytes);
  assertActive();
  return digestHex(digest);
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function f32(value: number): number {
  return Math.fround(Number.isFinite(value) ? value : 0);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const ratio = clamp((value - edge0) / (edge1 - edge0));
  return ratio * ratio * (3 - 2 * ratio);
}

function validateRecipeInput(
  value: unknown,
): value is StudioProceduralMediaSurfaceRecipeInput {
  if (
    !exactKeys(value, RECIPE_INPUT_KEYS)
    || !integer(value.seed, 0, 0xffff_ffff)
    || !range(value.worldScale, 0.03125, 1_000_000)
    || !range(value.rotationRadians, -Math.PI * 2, Math.PI * 2)
    || !vector2(
      value.offset,
      -STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumCoordinateMagnitude,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumCoordinateMagnitude,
    )
    || !range(value.contrast, 0.03125, 16)
    || (
      value.seamlessPeriod !== null
      && !vector2(value.seamlessPeriod, 1, 100_000_000)
    )
    || !exactKeys(
      value.relief,
      ["frequency", "octaves", "lacunarity", "gain", "amplitude"],
    )
    || !range(value.relief.frequency, 0.000_001, 1_024)
    || !integer(
      value.relief.octaves,
      1,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumOctaves,
    )
    || !range(value.relief.lacunarity, 1, 4)
    || !range(value.relief.gain, 0, 1)
    || !range(value.relief.amplitude, 0, 8)
    || !exactKeys(
      value.fibers,
      ["frequency", "amplitude", "directionRadians", "irregularity"],
    )
    || !range(value.fibers.frequency, 0.000_001, 4_096)
    || !range(value.fibers.amplitude, 0, 8)
    || !range(value.fibers.directionRadians, -Math.PI * 2, Math.PI * 2)
    || !range(value.fibers.irregularity, 0, 4)
    || !exactKeys(
      value.weave,
      ["warpFrequency", "weftFrequency", "amplitude", "balance"],
    )
    || !range(value.weave.warpFrequency, 0.000_001, 4_096)
    || !range(value.weave.weftFrequency, 0.000_001, 4_096)
    || !range(value.weave.amplitude, 0, 8)
    || !range(value.weave.balance, 0, 1)
    || !exactKeys(value.pores, ["frequency", "density", "amplitude"])
    || !range(value.pores.frequency, 0.000_001, 4_096)
    || !range(value.pores.density, 0, 1)
    || !range(value.pores.amplitude, 0, 8)
    || !exactKeys(value.speckles, ["frequency", "density", "amplitude"])
    || !range(value.speckles.frequency, 0.000_001, 8_192)
    || !range(value.speckles.density, 0, 1)
    || !range(value.speckles.amplitude, 0, 8)
  ) return false;
  if (
    !exactKeys(
      value.channels,
      [
        "absorbencyBase",
        "reliefToAbsorbency",
        "poreToAbsorbency",
        "speckleToAbsorbency",
        "grainBase",
        "reliefToGrain",
        "fiberToGrain",
        "weaveToGrain",
        "speckleToGrain",
      ],
    )
    || !range(value.channels.absorbencyBase, 0, 1)
    || !range(value.channels.reliefToAbsorbency, -8, 8)
    || !range(value.channels.poreToAbsorbency, -8, 8)
    || !range(value.channels.speckleToAbsorbency, -8, 8)
    || !range(value.channels.grainBase, 0, 1)
    || !range(value.channels.reliefToGrain, -8, 8)
    || !range(value.channels.fiberToGrain, -8, 8)
    || !range(value.channels.weaveToGrain, -8, 8)
    || !range(value.channels.speckleToGrain, -8, 8)
  ) return false;
  return exactKeys(
    value.flow,
    [
      "gradientStep",
      "downhillWeight",
      "tangentWeight",
      "gravity",
      "wind",
    ],
  )
    && range(value.flow.gradientStep, 0.03125, 1_024)
    && range(value.flow.downhillWeight, 0, 8)
    && range(value.flow.tangentWeight, -8, 8)
    && vector2(value.flow.gravity, -8, 8)
    && vector2(value.flow.wind, -8, 8);
}

function canonicalRecipeValue(
  input: StudioProceduralMediaSurfaceRecipeInput,
): Omit<StudioProceduralMediaSurfaceRecipe, "fingerprint"> {
  return {
    kind: "studio-procedural-media-surface-recipe",
    version: STUDIO_PROCEDURAL_MEDIA_SURFACE_RECIPE_VERSION,
    seed: input.seed >>> 0,
    worldScale: input.worldScale,
    rotationRadians: input.rotationRadians,
    offset: cloneVector2(input.offset),
    contrast: input.contrast,
    seamlessPeriod: input.seamlessPeriod === null
      ? null
      : cloneVector2(input.seamlessPeriod),
    relief: Object.freeze({ ...input.relief }),
    fibers: Object.freeze({ ...input.fibers }),
    weave: Object.freeze({ ...input.weave }),
    pores: Object.freeze({ ...input.pores }),
    speckles: Object.freeze({ ...input.speckles }),
    channels: Object.freeze({ ...input.channels }),
    flow: Object.freeze({
      ...input.flow,
      gravity: cloneVector2(input.flow.gravity),
      wind: cloneVector2(input.flow.wind),
    }),
  };
}

export function createStudioProceduralMediaSurfaceRecipe(
  input: StudioProceduralMediaSurfaceRecipeInput,
): StudioProceduralMediaSurfaceRecipeCreationResult {
  if (!validateRecipeInput(input)) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-recipe",
      path: "$",
    });
  }
  const canonical = canonicalRecipeValue(input);
  return Object.freeze({
    status: "ready",
    recipe: Object.freeze({
      ...canonical,
      fingerprint: hashJson(canonical),
    }),
  });
}

export function parseStudioProceduralMediaSurfaceRecipe(
  value: unknown,
): StudioProceduralMediaSurfaceRecipe | null {
  if (
    !exactKeys(value, RECIPE_KEYS)
    || value.kind !== "studio-procedural-media-surface-recipe"
    || value.version !== STUDIO_PROCEDURAL_MEDIA_SURFACE_RECIPE_VERSION
    || typeof value.fingerprint !== "string"
  ) return null;
  const input: Record<string, unknown> = {};
  for (const key of RECIPE_INPUT_KEYS) input[key] = value[key];
  if (!validateRecipeInput(input)) return null;
  const result = createStudioProceduralMediaSurfaceRecipe(
    input as unknown as StudioProceduralMediaSurfaceRecipeInput,
  );
  return result.status === "ready"
    && result.recipe.fingerprint === value.fingerprint
    ? result.recipe
    : null;
}

function mixUint32(value: number): number {
  let result = value >>> 0;
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb_352d);
  result ^= result >>> 15;
  result = Math.imul(result, 0x846c_a68b);
  result ^= result >>> 16;
  return result >>> 0;
}

function latticeUnit(
  seed: number,
  x: number,
  y: number,
  channel: number,
): number {
  return mixUint32(
    seed
    ^ Math.imul(x, 0x1f12_3bb5)
    ^ Math.imul(y, 0x5f35_6495)
    ^ Math.imul(channel + 1, 0x9e37_79b1),
  ) / 0x1_0000_0000;
}

function fade(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function valueNoise(
  x: number,
  y: number,
  seed: number,
  channel: number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const a = latticeUnit(seed, x0, y0, channel) * 2 - 1;
  const b = latticeUnit(seed, x0 + 1, y0, channel) * 2 - 1;
  const c = latticeUnit(seed, x0, y0 + 1, channel) * 2 - 1;
  const d = latticeUnit(seed, x0 + 1, y0 + 1, channel) * 2 - 1;
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

function transformedCoordinate(
  recipe: StudioProceduralMediaSurfaceRecipe,
  worldX: number,
  worldY: number,
): readonly [number, number] {
  const x = (worldX + recipe.offset[0]) / recipe.worldScale;
  const y = (worldY + recipe.offset[1]) / recipe.worldScale;
  const cosine = Math.cos(recipe.rotationRadians);
  const sine = Math.sin(recipe.rotationRadians);
  return [
    x * cosine - y * sine,
    x * sine + y * cosine,
  ];
}

function periodicHarmonic(
  recipe: StudioProceduralMediaSurfaceRecipe,
  worldX: number,
  worldY: number,
  frequency: number,
  seedChannel: number,
  directionRadians?: number,
): number {
  const period = recipe.seamlessPeriod;
  if (period === null) return 0;
  const u = (worldX + recipe.offset[0]) / period[0];
  const v = (worldY + recipe.offset[1]) / period[1];
  const waveCount = directionRadians === undefined ? 6 : 3;
  let total = 0;
  let weightTotal = 0;
  for (let wave = 0; wave < waveCount; wave += 1) {
    const randomAngle = latticeUnit(
      recipe.seed,
      seedChannel,
      wave,
      31,
    ) * Math.PI * 2;
    const angle = (
      directionRadians ?? randomAngle
    ) + recipe.rotationRadians + wave * 0.173;
    const cyclesX = Math.max(
      1,
      Math.round(
        frequency * period[0] / recipe.worldScale * Math.cos(angle),
      ),
    );
    const cyclesY = Math.max(
      1,
      Math.round(
        frequency * period[1] / recipe.worldScale * Math.sin(angle),
      ),
    );
    const phase = latticeUnit(
      recipe.seed,
      seedChannel,
      wave,
      47,
    ) * Math.PI * 2;
    const weight = 0.65 + latticeUnit(
      recipe.seed,
      seedChannel,
      wave,
      59,
    ) * 0.35;
    total += Math.sin(
      Math.PI * 2 * (cyclesX * u + cyclesY * v) + phase,
    ) * weight;
    weightTotal += weight;
  }
  return total / Math.max(weightTotal, 0.000_001);
}

function scalarField(
  recipe: StudioProceduralMediaSurfaceRecipe,
  worldX: number,
  worldY: number,
  frequency: number,
  seedChannel: number,
  directionRadians?: number,
): number {
  if (recipe.seamlessPeriod !== null) {
    return periodicHarmonic(
      recipe,
      worldX,
      worldY,
      frequency,
      seedChannel,
      directionRadians,
    );
  }
  const [x, y] = transformedCoordinate(recipe, worldX, worldY);
  if (directionRadians === undefined) {
    return valueNoise(
      x * frequency,
      y * frequency,
      recipe.seed,
      seedChannel,
    );
  }
  const direction =
    directionRadians + recipe.rotationRadians;
  const normalX = -Math.sin(direction);
  const normalY = Math.cos(direction);
  const along = x * normalX + y * normalY;
  const warp = valueNoise(
    x * frequency * 0.25,
    y * frequency * 0.25,
    recipe.seed,
    seedChannel + 101,
  );
  const phase = latticeUnit(
    recipe.seed,
    seedChannel,
    0,
    71,
  ) * Math.PI * 2;
  return Math.sin(
    Math.PI * 2 * frequency * (along + warp * 0.18) + phase,
  );
}

function fractalRelief(
  recipe: StudioProceduralMediaSurfaceRecipe,
  worldX: number,
  worldY: number,
): number {
  let frequency = recipe.relief.frequency;
  let amplitude = 1;
  let total = 0;
  let weightTotal = 0;
  for (let octave = 0; octave < recipe.relief.octaves; octave += 1) {
    total += scalarField(
      recipe,
      worldX,
      worldY,
      frequency,
      100 + octave * 17,
    ) * amplitude;
    weightTotal += amplitude;
    frequency *= recipe.relief.lacunarity;
    amplitude *= recipe.relief.gain;
  }
  return weightTotal > 0 ? total / weightTotal : 0;
}

function ridge(value: number): number {
  return 1 - Math.abs(value);
}

function densityMask(value: number, density: number): number {
  if (density <= 0) return 0;
  if (density >= 1) return clamp(value * 0.5 + 0.5);
  const normalized = value * 0.5 + 0.5;
  const threshold = 1 - density;
  return smoothstep(threshold, Math.min(1, threshold + 0.12), normalized);
}

function componentSample(
  recipe: StudioProceduralMediaSurfaceRecipe,
  worldX: number,
  worldY: number,
): ComponentSample {
  const relief = fractalRelief(recipe, worldX, worldY);
  const irregularity = scalarField(
    recipe,
    worldX,
    worldY,
    recipe.fibers.frequency * 0.2,
    401,
  ) * recipe.fibers.irregularity;
  const fiberWave = scalarField(
    recipe,
    worldX + irregularity,
    worldY - irregularity * 0.5,
    recipe.fibers.frequency,
    409,
    recipe.fibers.directionRadians,
  );
  const fiber = ridge(fiberWave);
  const warp = ridge(scalarField(
    recipe,
    worldX,
    worldY,
    recipe.weave.warpFrequency,
    503,
    0,
  ));
  const weft = ridge(scalarField(
    recipe,
    worldX,
    worldY,
    recipe.weave.weftFrequency,
    509,
    Math.PI / 2,
  ));
  const weave =
    warp * recipe.weave.balance
    + weft * (1 - recipe.weave.balance);
  const pore = densityMask(
    scalarField(
      recipe,
      worldX,
      worldY,
      recipe.pores.frequency,
      601,
    ),
    recipe.pores.density,
  );
  const speckle = densityMask(
    scalarField(
      recipe,
      worldX,
      worldY,
      recipe.speckles.frequency,
      701,
    ),
    recipe.speckles.density,
  );
  const rawHeight =
    relief * recipe.relief.amplitude
    + (fiber - 0.5) * recipe.fibers.amplitude
    + (weave - 0.5) * recipe.weave.amplitude
    - pore * recipe.pores.amplitude
    + (speckle - 0.5) * recipe.speckles.amplitude;
  const height = Math.tanh(rawHeight * recipe.contrast);
  const absorbency = clamp(
    recipe.channels.absorbencyBase
    + (-height) * recipe.channels.reliefToAbsorbency
    + pore * recipe.channels.poreToAbsorbency
    + speckle * recipe.channels.speckleToAbsorbency,
  );
  const grain = clamp(
    recipe.channels.grainBase
    + Math.abs(relief) * recipe.channels.reliefToGrain
    + fiber * recipe.channels.fiberToGrain
    + weave * recipe.channels.weaveToGrain
    + speckle * recipe.channels.speckleToGrain,
  );
  return { height, absorbency, grain };
}

function flowVector(
  recipe: StudioProceduralMediaSurfaceRecipe,
  worldX: number,
  worldY: number,
): readonly [number, number] {
  const step = recipe.flow.gradientStep;
  const left = componentSample(recipe, worldX - step, worldY).height;
  const right = componentSample(recipe, worldX + step, worldY).height;
  const top = componentSample(recipe, worldX, worldY - step).height;
  const bottom = componentSample(recipe, worldX, worldY + step).height;
  const gradientX = (right - left) / (step * 2);
  const gradientY = (bottom - top) / (step * 2);
  const gradientMagnitude = Math.hypot(gradientX, gradientY);
  const downhillX = gradientMagnitude > 0.000_000_001
    ? -gradientX / gradientMagnitude
    : 0;
  const downhillY = gradientMagnitude > 0.000_000_001
    ? -gradientY / gradientMagnitude
    : 0;
  const tangentX = -downhillY;
  const tangentY = downhillX;
  let flowX =
    downhillX * recipe.flow.downhillWeight
    + tangentX * recipe.flow.tangentWeight
    + recipe.flow.gravity[0]
    + recipe.flow.wind[0];
  let flowY =
    downhillY * recipe.flow.downhillWeight
    + tangentY * recipe.flow.tangentWeight
    + recipe.flow.gravity[1]
    + recipe.flow.wind[1];
  const magnitude = Math.hypot(flowX, flowY);
  if (magnitude > 1) {
    flowX /= magnitude;
    flowY /= magnitude;
  }
  return [flowX, flowY];
}

function normalizeBudgets(
  options: StudioProceduralMediaSurfaceBudgets,
): NormalizedBudgets | null {
  const budgets = {
    maximumOutputPixels:
      options.maximumOutputPixels
      ?? STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumOutputPixels,
    maximumWorkUnits:
      options.maximumWorkUnits
      ?? STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumWorkUnits,
    maximumResidentBytes:
      options.maximumResidentBytes
      ?? STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumResidentBytes,
  };
  if (
    !integer(
      budgets.maximumOutputPixels,
      1,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumOutputPixels,
    )
    || !integer(
      budgets.maximumWorkUnits,
      1,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumWorkUnits,
    )
    || !integer(
      budgets.maximumResidentBytes,
      1,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumResidentBytes,
    )
  ) return null;
  return Object.freeze(budgets);
}

function cloneRegion(
  value: unknown,
): StudioProceduralMediaSurfaceRegion | null {
  if (
    !exactKeys(value, REGION_KEYS)
    || !integer(
      value.originX,
      -STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumCoordinateMagnitude,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumCoordinateMagnitude,
    )
    || !integer(
      value.originY,
      -STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumCoordinateMagnitude,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumCoordinateMagnitude,
    )
    || !integer(
      value.width,
      1,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumWidth,
    )
    || !integer(
      value.height,
      1,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumHeight,
    )
    || !integer(
      value.halo,
      0,
      STUDIO_PROCEDURAL_MEDIA_SURFACE_LIMITS.maximumHalo,
    )
  ) return null;
  return Object.freeze({
    originX: value.originX,
    originY: value.originY,
    width: value.width,
    height: value.height,
    halo: value.halo,
  });
}

function snapshotProviderRequestAdmission(
  value: unknown,
): ProviderRequestAdmission | null {
  if (!exactKeys(value, REQUEST_KEYS, ["signal"])) return null;
  try {
    const requestSequence = value.requestSequence;
    const engineEpoch = value.engineEpoch;
    const recipe = value.recipe;
    const region = value.region;
    const signalValue = Object.hasOwn(value, "signal")
      ? value.signal
      : undefined;
    if (
      !integer(requestSequence, 1, Number.MAX_SAFE_INTEGER)
      || !integer(engineEpoch, 1, Number.MAX_SAFE_INTEGER)
    ) return null;
    const signal = signalValue === undefined
      ? undefined
      : snapshotRuntimeAbortSignal(signalValue);
    if (signal === null) return null;
    return Object.freeze({
      requestSequence,
      engineEpoch,
      recipe:
        recipe as StudioProceduralMediaSurfaceRecipe,
      region:
        region as StudioProceduralMediaSurfaceRegion,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    return null;
  }
}

function prepareExecution(
  recipeValue: StudioProceduralMediaSurfaceRecipe,
  regionValue: StudioProceduralMediaSurfaceRegion,
  options: StudioProceduralMediaSurfaceCpuOptions,
): PreparedExecution {
  const recipe = parseStudioProceduralMediaSurfaceRecipe(recipeValue);
  if (!recipe) {
    throw new StudioProceduralMediaSurfaceError(
      "invalid-recipe",
      "Procedural media surface recipe failed integrity validation.",
      "$.recipe",
    );
  }
  const region = cloneRegion(regionValue);
  if (!region) {
    throw new StudioProceduralMediaSurfaceError(
      "invalid-region",
      "Procedural media surface region is malformed.",
      "$.region",
    );
  }
  const budgets = normalizeBudgets(options);
  if (!budgets) {
    throw new StudioProceduralMediaSurfaceError(
      "invalid-request",
      "Procedural media surface budgets are invalid.",
      "$.options",
    );
  }
  const outputWidth = region.width + region.halo * 2;
  const outputHeight = region.height + region.halo * 2;
  const outputPixels = outputWidth * outputHeight;
  const baseWorkPerPixel = recipe.relief.octaves * 8 + 84;
  const workUnits = outputPixels * baseWorkPerPixel * 5;
  // Five output floats plus the largest temporary little-endian hash buffer.
  const residentBytes =
    outputPixels * 7 * Float32Array.BYTES_PER_ELEMENT;
  if (
    !Number.isSafeInteger(outputPixels)
    || !Number.isSafeInteger(workUnits)
    || outputPixels > budgets.maximumOutputPixels
    || workUnits > budgets.maximumWorkUnits
    || residentBytes > budgets.maximumResidentBytes
  ) {
    throw new StudioProceduralMediaSurfaceError(
      "budget-exceeded",
      "Procedural media surface output, work, or memory budget exceeded.",
    );
  }
  if (options.signal?.aborted) {
    throw new StudioProceduralMediaSurfaceError(
      "aborted",
      "Procedural media surface request was aborted.",
    );
  }
  return Object.freeze({
    recipe,
    region,
    outputWidth,
    outputHeight,
    outputOriginX: region.originX - region.halo,
    outputOriginY: region.originY - region.halo,
    outputPixels,
    workUnits,
    residentBytes,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

function createPreparedChannels(
  prepared: PreparedExecution,
): PreparedChannels {
  return {
    heightField: new Float32Array(prepared.outputPixels),
    absorbency: new Float32Array(prepared.outputPixels),
    grain: new Float32Array(prepared.outputPixels),
    flow: new Float32Array(prepared.outputPixels * 2),
  };
}

function renderPreparedPixelRange(
  prepared: PreparedExecution,
  channels: PreparedChannels,
  startPixel: number,
  endPixel: number,
): void {
  let y = Math.floor(startPixel / prepared.outputWidth);
  let x = startPixel - y * prepared.outputWidth;
  for (let index = startPixel; index < endPixel; index += 1) {
    if (
      (index - startPixel) % COOPERATIVE_PIXEL_CHUNK === 0
      && prepared.signal?.aborted
    ) {
      throw new StudioProceduralMediaSurfaceError(
        "aborted",
        "Procedural media surface request was aborted.",
      );
    }
    const worldY = prepared.outputOriginY + y + 0.5;
    const worldX = prepared.outputOriginX + x + 0.5;
    const sample = componentSample(prepared.recipe, worldX, worldY);
    const vector = flowVector(prepared.recipe, worldX, worldY);
    channels.heightField[index] = f32(sample.height);
    channels.absorbency[index] = f32(sample.absorbency);
    channels.grain[index] = f32(sample.grain);
    channels.flow[index * 2] = f32(vector[0]);
    channels.flow[index * 2 + 1] = f32(vector[1]);
    x += 1;
    if (x === prepared.outputWidth) {
      x = 0;
      y += 1;
    }
  }
}

function finishPreparedChannels(
  prepared: PreparedExecution,
  channels: PreparedChannels,
  hashes: PreparedChannelHashes = {
    heightHash: hashFloat32(channels.heightField),
    absorbencyHash: hashFloat32(channels.absorbency),
    grainHash: hashFloat32(channels.grain),
    flowHash: hashFloat32(channels.flow),
  },
): StudioProceduralMediaSurfaceArtifact {
  const artifactHash = hashJson({
    recipeFingerprint: prepared.recipe.fingerprint,
    origin: [prepared.outputOriginX, prepared.outputOriginY],
    size: [prepared.outputWidth, prepared.outputHeight],
    heightHash: hashes.heightHash,
    absorbencyHash: hashes.absorbencyHash,
    grainHash: hashes.grainHash,
    flowHash: hashes.flowHash,
  });
  const receipt = Object.freeze({
    kind: "studio-procedural-media-surface-receipt" as const,
    version: STUDIO_PROCEDURAL_MEDIA_SURFACE_RECEIPT_VERSION,
    providerRevision: STUDIO_PROCEDURAL_MEDIA_SURFACE_PROVIDER_REVISION,
    backend: "cpu-f32-global-coordinate-oracle" as const,
    samplingConvention: "integer-pixel-centers-plus-one-half" as const,
    tileContract: "global-origin-with-symmetric-halo" as const,
    periodicMode: prepared.recipe.seamlessPeriod === null
      ? "aperiodic" as const
      : "integer-fourier-torus" as const,
    flowModel:
      "unit-clamp(downhill*(-normalized-height-gradient)+tangent*perpendicular+gravity+wind)" as const,
    gradientModel:
      "global-central-difference-composite-height" as const,
    recipeFingerprint: prepared.recipe.fingerprint,
    origin: Object.freeze([
      prepared.outputOriginX,
      prepared.outputOriginY,
    ]) as readonly [number, number],
    coreOrigin: Object.freeze([
      prepared.region.originX,
      prepared.region.originY,
    ]) as readonly [number, number],
    coreSize: Object.freeze([
      prepared.region.width,
      prepared.region.height,
    ]) as readonly [number, number],
    outputSize: Object.freeze([
      prepared.outputWidth,
      prepared.outputHeight,
    ]) as readonly [number, number],
    halo: prepared.region.halo,
    outputPixels: prepared.outputPixels,
    workUnits: prepared.workUnits,
    residentBytes: prepared.residentBytes,
    heightHash: hashes.heightHash,
    absorbencyHash: hashes.absorbencyHash,
    grainHash: hashes.grainHash,
    flowHash: hashes.flowHash,
    artifactHash,
    complete: true as const,
  });
  return Object.freeze({
    kind: "studio-procedural-media-surface-artifact" as const,
    version: STUDIO_PROCEDURAL_MEDIA_SURFACE_RECEIPT_VERSION,
    width: prepared.outputWidth,
    height: prepared.outputHeight,
    originX: prepared.outputOriginX,
    originY: prepared.outputOriginY,
    heightField: channels.heightField,
    absorbency: channels.absorbency,
    grain: channels.grain,
    flow: channels.flow,
    receipt,
  });
}

function renderPrepared(
  prepared: PreparedExecution,
): StudioProceduralMediaSurfaceArtifact {
  const channels = createPreparedChannels(prepared);
  renderPreparedPixelRange(
    prepared,
    channels,
    0,
    prepared.outputPixels,
  );
  return finishPreparedChannels(prepared, channels);
}

async function renderPreparedCooperatively(
  prepared: PreparedExecution,
  assertActive: () => void,
): Promise<StudioProceduralMediaSurfaceArtifact> {
  const channels = createPreparedChannels(prepared);
  const scheduler = createCooperativeTaskScheduler();
  try {
    for (
      let startPixel = 0;
      startPixel < prepared.outputPixels;
      startPixel += COOPERATIVE_PIXEL_CHUNK
    ) {
      assertActive();
      const endPixel = Math.min(
        prepared.outputPixels,
        startPixel + COOPERATIVE_PIXEL_CHUNK,
      );
      renderPreparedPixelRange(
        prepared,
        channels,
        startPixel,
        endPixel,
      );
      assertActive();
      if (endPixel < prepared.outputPixels) {
        await scheduler.yieldTask();
      }
    }
    assertActive();
    const hashes = {
      heightHash: await hashFloat32Cooperatively(
        channels.heightField,
        scheduler,
        assertActive,
      ),
      absorbencyHash: await hashFloat32Cooperatively(
        channels.absorbency,
        scheduler,
        assertActive,
      ),
      grainHash: await hashFloat32Cooperatively(
        channels.grain,
        scheduler,
        assertActive,
      ),
      flowHash: await hashFloat32Cooperatively(
        channels.flow,
        scheduler,
        assertActive,
      ),
    };
    assertActive();
    return finishPreparedChannels(prepared, channels, hashes);
  } finally {
    scheduler.dispose();
  }
}

export function renderStudioProceduralMediaSurfaceCpuOracle(
  recipe: StudioProceduralMediaSurfaceRecipe,
  region: StudioProceduralMediaSurfaceRegion,
  options: StudioProceduralMediaSurfaceCpuOptions = {},
): StudioProceduralMediaSurfaceArtifact {
  return renderPrepared(prepareExecution(recipe, region, options));
}

interface RenderReceiptIntegrityContext {
  readonly artifact: StudioProceduralMediaSurfaceArtifact;
  readonly receipt: StudioProceduralMediaSurfaceReceipt;
  readonly recipe: StudioProceduralMediaSurfaceRecipe;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly outputOriginX: number;
  readonly outputOriginY: number;
}

function renderReceiptIntegrityContext(
  value: StudioProceduralMediaSurfaceRenderReceipt,
  expectedRequest: Omit<
    StudioProceduralMediaSurfaceRenderRequest,
    "signal"
  >,
): RenderReceiptIntegrityContext | null {
    const { artifact } = value;
    const { receipt } = artifact;
    const { recipe, region } = expectedRequest;
    const outputWidth = region.width + region.halo * 2;
    const outputHeight = region.height + region.halo * 2;
    const outputOriginX = region.originX - region.halo;
    const outputOriginY = region.originY - region.halo;
    const outputPixels = outputWidth * outputHeight;
    const workUnits =
      outputPixels * (recipe.relief.octaves * 8 + 84) * 5;
    const residentBytes =
      outputPixels * 7 * Float32Array.BYTES_PER_ELEMENT;
    if (
      value.kind !== "studio-procedural-media-surface-render-receipt"
      || value.complete !== true
      || value.requestSequence !== expectedRequest.requestSequence
      || value.engineEpoch !== expectedRequest.engineEpoch
      || artifact.kind !== "studio-procedural-media-surface-artifact"
      || artifact.version
        !== STUDIO_PROCEDURAL_MEDIA_SURFACE_RECEIPT_VERSION
      || artifact.width !== outputWidth
      || artifact.height !== outputHeight
      || artifact.originX !== outputOriginX
      || artifact.originY !== outputOriginY
      || artifact.heightField.length !== outputPixels
      || artifact.absorbency.length !== outputPixels
      || artifact.grain.length !== outputPixels
      || artifact.flow.length !== outputPixels * 2
      || receipt.kind !== "studio-procedural-media-surface-receipt"
      || receipt.version
        !== STUDIO_PROCEDURAL_MEDIA_SURFACE_RECEIPT_VERSION
      || receipt.providerRevision
        !== STUDIO_PROCEDURAL_MEDIA_SURFACE_PROVIDER_REVISION
      || receipt.recipeFingerprint !== recipe.fingerprint
      || receipt.origin[0] !== outputOriginX
      || receipt.origin[1] !== outputOriginY
      || receipt.coreOrigin[0] !== region.originX
      || receipt.coreOrigin[1] !== region.originY
      || receipt.coreSize[0] !== region.width
      || receipt.coreSize[1] !== region.height
      || receipt.outputSize[0] !== outputWidth
      || receipt.outputSize[1] !== outputHeight
      || receipt.halo !== region.halo
      || receipt.outputPixels !== outputPixels
      || receipt.workUnits !== workUnits
      || receipt.residentBytes !== residentBytes
      || receipt.periodicMode !== (
        recipe.seamlessPeriod === null
          ? "aperiodic"
          : "integer-fourier-torus"
      )
    ) return null;
    return {
      artifact,
      receipt,
      recipe,
      outputWidth,
      outputHeight,
      outputOriginX,
      outputOriginY,
    };
}

function verifyRenderReceiptHashes(
  value: StudioProceduralMediaSurfaceRenderReceipt,
  expectedRequest: Omit<
    StudioProceduralMediaSurfaceRenderRequest,
    "signal"
  >,
  context: RenderReceiptIntegrityContext,
  hashes: PreparedChannelHashes,
): boolean {
  const {
    receipt,
    recipe,
    outputWidth,
    outputHeight,
    outputOriginX,
    outputOriginY,
  } = context;
  if (
    receipt.heightHash !== hashes.heightHash
    || receipt.absorbencyHash !== hashes.absorbencyHash
    || receipt.grainHash !== hashes.grainHash
    || receipt.flowHash !== hashes.flowHash
  ) return false;
  const artifactHash = hashJson({
    recipeFingerprint: recipe.fingerprint,
    origin: [outputOriginX, outputOriginY],
    size: [outputWidth, outputHeight],
    ...hashes,
  });
  if (receipt.artifactHash !== artifactHash) return false;
  return value.receiptHash === hashJson({
    requestSequence: expectedRequest.requestSequence,
    engineEpoch: expectedRequest.engineEpoch,
    artifactHash,
  });
}

export function verifyStudioProceduralMediaSurfaceRenderReceiptIntegrity(
  value: StudioProceduralMediaSurfaceRenderReceipt,
  expectedRequest: Omit<
    StudioProceduralMediaSurfaceRenderRequest,
    "signal"
  >,
): boolean {
  try {
    const context = renderReceiptIntegrityContext(value, expectedRequest);
    if (!context) return false;
    const hashes = {
      heightHash: hashFloat32(context.artifact.heightField),
      absorbencyHash: hashFloat32(context.artifact.absorbency),
      grainHash: hashFloat32(context.artifact.grain),
      flowHash: hashFloat32(context.artifact.flow),
    };
    return verifyRenderReceiptHashes(
      value,
      expectedRequest,
      context,
      hashes,
    );
  } catch {
    return false;
  }
}

export async function verifyStudioProceduralMediaSurfaceRenderReceiptIntegrityCooperatively(
  value: StudioProceduralMediaSurfaceRenderReceipt,
  expectedRequest: Omit<
    StudioProceduralMediaSurfaceRenderRequest,
    "signal"
  >,
  assertActive: () => void = () => {},
): Promise<boolean> {
  const scheduler = createCooperativeTaskScheduler();
  try {
    assertActive();
    const context = renderReceiptIntegrityContext(value, expectedRequest);
    if (!context) return false;
    const hashes = {
      heightHash: await hashFloat32Cooperatively(
        context.artifact.heightField,
        scheduler,
        assertActive,
      ),
      absorbencyHash: await hashFloat32Cooperatively(
        context.artifact.absorbency,
        scheduler,
        assertActive,
      ),
      grainHash: await hashFloat32Cooperatively(
        context.artifact.grain,
        scheduler,
        assertActive,
      ),
      flowHash: await hashFloat32Cooperatively(
        context.artifact.flow,
        scheduler,
        assertActive,
      ),
    };
    assertActive();
    return verifyRenderReceiptHashes(
      value,
      expectedRequest,
      context,
      hashes,
    );
  } catch {
    return false;
  } finally {
    scheduler.dispose();
  }
}

export class StudioProceduralMediaSurfaceProvider {
  readonly #budgets: NormalizedBudgets;
  #engineEpoch: number;
  #lastRequestSequence = 0;
  #admissionReserved = false;
  #active: ProviderActiveExecution | null = null;
  #disposed = false;

  public constructor(
    initialEngineEpoch: number,
    budgets: NormalizedBudgets,
  ) {
    this.#engineEpoch = initialEngineEpoch;
    this.#budgets = budgets;
  }

  #assertActiveExecution(
    execution: ProviderActiveExecution,
  ): void {
    if (execution.cancellation.aborted) {
      throw new StudioProceduralMediaSurfaceError(
        "aborted",
        "Procedural media surface request was aborted.",
      );
    }
    if (this.#disposed) {
      throw new StudioProceduralMediaSurfaceError(
        "disposed",
        "Procedural media surface provider was disposed during execution.",
      );
    }
    if (execution.engineEpoch !== this.#engineEpoch) {
      throw new StudioProceduralMediaSurfaceError(
        "engine-epoch",
        "Procedural media surface epoch changed during execution.",
      );
    }
  }

  public async render(
    request: StudioProceduralMediaSurfaceRenderRequest,
  ): Promise<StudioProceduralMediaSurfaceRenderReceipt> {
    if (this.#disposed) {
      throw new StudioProceduralMediaSurfaceError(
        "disposed",
        "Procedural media surface provider is disposed.",
      );
    }
    if (this.#admissionReserved || this.#active !== null) {
      throw new StudioProceduralMediaSurfaceError(
        "backpressure",
        "Procedural media surface provider allows one active operation.",
      );
    }
    this.#admissionReserved = true;
    try {
      let admission: ProviderRequestAdmission | null;
      try {
        admission = snapshotProviderRequestAdmission(request);
      } catch {
        admission = null;
      }
    if (!admission) {
      throw new StudioProceduralMediaSurfaceError(
        "invalid-request",
        "Procedural media surface provider request is malformed.",
      );
    }
    const { requestSequence, engineEpoch } = admission;
    if (engineEpoch !== this.#engineEpoch) {
      throw new StudioProceduralMediaSurfaceError(
        "engine-epoch",
        "Procedural media surface request targets a stale epoch.",
      );
    }
    if (requestSequence <= this.#lastRequestSequence) {
      throw new StudioProceduralMediaSurfaceError(
        "request-sequence",
        "Procedural media surface request sequence must increase.",
      );
    }
    if (admission.signal?.initialAborted) {
      throw new StudioProceduralMediaSurfaceError(
        "aborted",
        "Procedural media surface request was aborted.",
      );
    }
    const prepared = prepareExecution(admission.recipe, admission.region, {
      ...this.#budgets,
    });
    const previousRequestSequence = this.#lastRequestSequence;
    const execution: ProviderActiveExecution = {
      requestSequence,
      engineEpoch,
      cancellation: { aborted: false },
    };
    const abortListener = (): void => {
      execution.cancellation.aborted = true;
    };
    let signalListenerAttempted = false;
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      if (this.#active === execution) this.#active = null;
      if (signalListenerAttempted && admission.signal) {
        safelyRemoveRuntimeAbortListener(
          admission.signal,
          abortListener,
        );
      }
    };
    const rollbackAdmission = (): void => {
      if (
        this.#engineEpoch === engineEpoch
        && this.#lastRequestSequence === requestSequence
      ) this.#lastRequestSequence = previousRequestSequence;
      cleanup();
    };
    this.#active = execution;
    this.#lastRequestSequence = requestSequence;
    if (admission.signal) {
      signalListenerAttempted = true;
      try {
        admission.signal.addEventListener.call(
          admission.signal.target,
          "abort",
          abortListener,
          { once: true },
        );
        const aborted = readRuntimeAbortState(admission.signal);
        if (aborted === null) {
          throw new TypeError("Abort signal state became malformed.");
        }
        execution.cancellation.aborted ||= aborted;
      } catch {
        rollbackAdmission();
        throw new StudioProceduralMediaSurfaceError(
          "invalid-request",
          "Procedural media surface abort signal listener failed.",
          "$.signal",
        );
      }
    }
    this.#admissionReserved = false;
    try {
      this.#assertActiveExecution(execution);
      const artifact = await renderPreparedCooperatively(
        prepared,
        () => this.#assertActiveExecution(execution),
      );
      this.#assertActiveExecution(execution);
      const receiptHash = hashJson({
        requestSequence,
        engineEpoch,
        artifactHash: artifact.receipt.artifactHash,
      });
      return Object.freeze({
        kind: "studio-procedural-media-surface-render-receipt",
        requestSequence,
        engineEpoch,
        artifact,
        receiptHash,
        complete: true,
      });
    } finally {
      cleanup();
    }
    } finally {
      this.#admissionReserved = false;
    }
  }

  public advanceEngineEpoch(): number {
    if (this.#disposed) {
      throw new StudioProceduralMediaSurfaceError(
        "disposed",
        "Procedural media surface provider is disposed.",
      );
    }
    if (this.#engineEpoch >= Number.MAX_SAFE_INTEGER) {
      throw new StudioProceduralMediaSurfaceError(
        "engine-epoch",
        "Procedural media surface epoch is exhausted.",
      );
    }
    this.#engineEpoch += 1;
    this.#lastRequestSequence = 0;
    return this.#engineEpoch;
  }

  public snapshot(): Readonly<{
    state: "ready" | "active" | "disposed";
    engineEpoch: number;
    lastRequestSequence: number;
  }> {
    return Object.freeze({
      state: this.#disposed
        ? "disposed"
        : this.#admissionReserved || this.#active !== null
          ? "active"
          : "ready",
      engineEpoch: this.#engineEpoch,
      lastRequestSequence: this.#lastRequestSequence,
    });
  }

  public dispose(): void {
    this.#disposed = true;
  }
}

export function createStudioProceduralMediaSurfaceProvider(
  options: StudioProceduralMediaSurfaceProviderOptions = {},
): StudioProceduralMediaSurfaceProviderCreationResult {
  if (!exactKeys(options, [], OPTION_KEYS)) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-options",
      path: "$",
    });
  }
  const initialEngineEpoch = options.initialEngineEpoch ?? 1;
  const budgets = normalizeBudgets(options);
  if (
    !integer(initialEngineEpoch, 1, Number.MAX_SAFE_INTEGER - 1)
    || !budgets
  ) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-options",
      path: "$",
    });
  }
  return Object.freeze({
    status: "ready",
    provider: new StudioProceduralMediaSurfaceProvider(
      initialEngineEpoch,
      budgets,
    ),
  });
}
