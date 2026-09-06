import { sha256HexPortable } from "../studio-sha256";

/**
 * Clean-room, non-destructive live surface effects.
 *
 * Pixel contract:
 * - input/output RGB: scene-linear, straight alpha, Float32
 * - displacement samples all four source channels with subpixel bilinear filtering
 * - lighting changes straight RGB only; output alpha is exactly the displaced source alpha
 *
 * The CPU oracle deliberately depends only on typed arrays and scalar math. Tile/halo metadata is
 * explicit so a Worker or WebGPU provider can implement the same recipe without changing storage.
 */

export const STUDIO_LIVE_SURFACE_FILTER_RECIPE_VERSION = 1 as const;
export const STUDIO_LIVE_SURFACE_FILTER_PROVIDER_REVISION = 1 as const;
export const STUDIO_LIVE_SURFACE_FILTER_IMAGE_VERSION = 1 as const;
export const STUDIO_LIVE_SURFACE_FILTER_RECEIPT_VERSION = 1 as const;
export const STUDIO_LIVE_SURFACE_FILTER_COLOR_CONTRACT =
  "scene-linear-straight-rgba-f32" as const;
export const STUDIO_LIVE_SURFACE_FILTER_ALPHA_CONTRACT =
  "preserve-displaced-source-alpha" as const;

export const STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS = Object.freeze({
  maximumDimension: 65_536,
  maximumPixels: 268_435_456,
  maximumResidentBytes: 4_294_967_296,
  maximumHaloPixels: 16_384,
  maximumTileEdge: 2_048,
  maximumTiles: 1_048_576,
  maximumDisplacementScale: 16_384,
  maximumSurfaceScale: 16_384,
  maximumLightStrength: 16,
  maximumColorComponent: 64,
  maximumShininess: 2_048,
  maximumCoordinateMagnitude: 1_000_000,
  maximumRecipeJsonCodeUnits: 32_768,
} as const);

export const STUDIO_LIVE_SURFACE_FILTER_DEFAULT_BUDGETS = Object.freeze({
  maximumPixels: 67_108_864,
  maximumResidentBytes: 2_147_483_648,
  maximumHaloPixels: 4_096,
  tileEdge: 256,
  maximumTiles: 1_048_576,
} as const);

export type StudioLiveSurfaceBoundaryMode =
  | "clamp"
  | "reflect"
  | "transparent";

export type StudioLiveSurfaceHeightChannel =
  | "luminance"
  | "red"
  | "green"
  | "blue"
  | "alpha";

export interface StudioLiveSurfaceDisplacementRecipeInput {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly mapMidpoint: number;
  readonly boundaryMode: StudioLiveSurfaceBoundaryMode;
}

export interface StudioLiveSurfaceDirectionalLightInput {
  readonly kind: "directional";
  /** Normalized during recipe construction; points from the surface toward the light. */
  readonly direction: readonly [x: number, y: number, z: number];
}

export interface StudioLiveSurfacePointLightInput {
  readonly kind: "point";
  /** Source-image pixel coordinates. Positive z is above the surface. */
  readonly position: readonly [x: number, y: number, z: number];
}

export type StudioLiveSurfaceLightInput =
  | StudioLiveSurfaceDirectionalLightInput
  | StudioLiveSurfacePointLightInput;

export interface StudioLiveSurfaceLightingRecipeInput {
  readonly enabled: boolean;
  readonly surfaceScale: number;
  readonly ambient: number;
  readonly diffuse: number;
  readonly specular: number;
  readonly shininess: number;
  readonly lightColor: readonly [red: number, green: number, blue: number];
  readonly materialColor: readonly [red: number, green: number, blue: number];
  readonly light: StudioLiveSurfaceLightInput;
}

export interface StudioLiveSurfaceFilterRecipeInput {
  readonly heightSource: "source" | "separate";
  readonly heightChannel: StudioLiveSurfaceHeightChannel;
  readonly displacement: StudioLiveSurfaceDisplacementRecipeInput;
  readonly lighting: StudioLiveSurfaceLightingRecipeInput;
}

export type StudioLiveSurfaceDisplacementRecipe =
  StudioLiveSurfaceDisplacementRecipeInput;

export interface StudioLiveSurfaceDirectionalLight {
  readonly kind: "directional";
  readonly direction: readonly [x: number, y: number, z: number];
}

export interface StudioLiveSurfacePointLight {
  readonly kind: "point";
  readonly position: readonly [x: number, y: number, z: number];
}

export type StudioLiveSurfaceLight =
  | StudioLiveSurfaceDirectionalLight
  | StudioLiveSurfacePointLight;

export interface StudioLiveSurfaceLightingRecipe
  extends Omit<StudioLiveSurfaceLightingRecipeInput, "light"> {
  readonly light: StudioLiveSurfaceLight;
}

export interface StudioLiveSurfaceFilterRecipe {
  readonly kind: "studio-live-surface-filter-recipe";
  readonly version: typeof STUDIO_LIVE_SURFACE_FILTER_RECIPE_VERSION;
  readonly colorContract: typeof STUDIO_LIVE_SURFACE_FILTER_COLOR_CONTRACT;
  readonly alphaContract: typeof STUDIO_LIVE_SURFACE_FILTER_ALPHA_CONTRACT;
  readonly heightSource: "source" | "separate";
  readonly heightChannel: StudioLiveSurfaceHeightChannel;
  readonly displacement: StudioLiveSurfaceDisplacementRecipe;
  readonly lighting: StudioLiveSurfaceLightingRecipe;
  readonly fingerprint: `sha256:${string}`;
}

export type StudioLiveSurfaceFilterRecipeCreationResult =
  | Readonly<{ status: "ready"; recipe: StudioLiveSurfaceFilterRecipe }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-recipe";
      path: string;
    }>;

export interface StudioLiveSurfaceImage {
  readonly kind: "studio-live-surface-image";
  readonly version: typeof STUDIO_LIVE_SURFACE_FILTER_IMAGE_VERSION;
  readonly width: number;
  readonly height: number;
  readonly colorContract: typeof STUDIO_LIVE_SURFACE_FILTER_COLOR_CONTRACT;
  readonly data: Float32Array;
}

export interface StudioLiveSurfaceCpuOracleOptions {
  readonly maximumPixels?: number;
  readonly maximumResidentBytes?: number;
  readonly maximumHaloPixels?: number;
  readonly tileEdge?: number;
  readonly maximumTiles?: number;
  readonly signal?: AbortSignal;
}

export interface StudioLiveSurfaceCpuOracleInput {
  readonly recipe: StudioLiveSurfaceFilterRecipe;
  readonly source: StudioLiveSurfaceImage;
  readonly heightMap?: StudioLiveSurfaceImage;
}

export interface StudioLiveSurfaceCpuOracleReceipt {
  readonly kind: "studio-live-surface-cpu-oracle-receipt";
  readonly version: typeof STUDIO_LIVE_SURFACE_FILTER_RECEIPT_VERSION;
  readonly backend: "cpu-typed-array";
  readonly executionModel: "deterministic-tiled-oracle";
  readonly colorContract: typeof STUDIO_LIVE_SURFACE_FILTER_COLOR_CONTRACT;
  readonly alphaContract: typeof STUDIO_LIVE_SURFACE_FILTER_ALPHA_CONTRACT;
  readonly recipeFingerprint: `sha256:${string}`;
  readonly sourceHash: `sha256:${string}`;
  readonly heightMapHash: `sha256:${string}`;
  readonly outputHash: `sha256:${string}`;
  readonly heightSource: "source" | "separate";
  readonly sourceSize: readonly [width: number, height: number];
  readonly heightMapSize: readonly [width: number, height: number];
  readonly boundaryMode: StudioLiveSurfaceBoundaryMode;
  readonly tileEdge: number;
  readonly tileCount: number;
  readonly haloPixels: number;
  readonly residentBytes: number;
  readonly complete: true;
}

export interface StudioLiveSurfaceCpuOracleResult {
  readonly image: StudioLiveSurfaceImage;
  readonly receipt: StudioLiveSurfaceCpuOracleReceipt;
}

export interface StudioLiveSurfaceFilterProviderOptions {
  readonly initialDeviceEpoch?: number;
  readonly maximumPixels?: number;
  readonly maximumResidentBytes?: number;
  readonly maximumHaloPixels?: number;
  readonly tileEdge?: number;
  readonly maximumTiles?: number;
}

export interface StudioLiveSurfaceFilterRequest {
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly recipe: StudioLiveSurfaceFilterRecipe;
  readonly source: StudioLiveSurfaceImage;
  readonly heightMap?: StudioLiveSurfaceImage;
  readonly signal?: AbortSignal;
}

export interface StudioLiveSurfaceFilterReceipt {
  readonly kind: "studio-live-surface-filter-receipt";
  readonly version: typeof STUDIO_LIVE_SURFACE_FILTER_RECEIPT_VERSION;
  readonly providerRevision: typeof STUDIO_LIVE_SURFACE_FILTER_PROVIDER_REVISION;
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly recipeFingerprint: `sha256:${string}`;
  readonly output: StudioLiveSurfaceImage;
  readonly oracle: StudioLiveSurfaceCpuOracleReceipt;
  readonly receiptHash: `sha256:${string}`;
  readonly complete: true;
}

export type StudioLiveSurfaceFilterProviderCreationResult =
  | Readonly<{
      status: "ready";
      provider: StudioLiveSurfaceFilterProvider;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-options";
      path: string;
    }>;

export type StudioLiveSurfaceFilterErrorCode =
  | "invalid-recipe"
  | "invalid-image"
  | "height-map-required"
  | "height-map-not-allowed"
  | "budget-exceeded"
  | "invalid-request"
  | "request-sequence"
  | "device-epoch"
  | "aborted"
  | "disposed"
  | "runtime-failed";

export class StudioLiveSurfaceFilterError extends Error {
  public constructor(
    readonly code: StudioLiveSurfaceFilterErrorCode,
    message: string,
    readonly path?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioLiveSurfaceFilterError";
  }
}

interface NormalizedBudgets {
  readonly maximumPixels: number;
  readonly maximumResidentBytes: number;
  readonly maximumHaloPixels: number;
  readonly tileEdge: number;
  readonly maximumTiles: number;
}

interface PreparedExecution {
  readonly recipe: StudioLiveSurfaceFilterRecipe;
  readonly source: StudioLiveSurfaceImage;
  readonly heightMap: StudioLiveSurfaceImage;
  readonly budgets: NormalizedBudgets;
  readonly haloPixels: number;
  readonly tileCount: number;
  readonly residentBytes: number;
  readonly signal?: AbortSignal;
}

const RECIPE_INPUT_KEYS = Object.freeze([
  "heightSource",
  "heightChannel",
  "displacement",
  "lighting",
]);
const RECIPE_KEYS = Object.freeze([
  "kind",
  "version",
  "colorContract",
  "alphaContract",
  ...RECIPE_INPUT_KEYS,
  "fingerprint",
]);
const DISPLACEMENT_KEYS = Object.freeze([
  "scaleX",
  "scaleY",
  "mapMidpoint",
  "boundaryMode",
]);
const LIGHTING_KEYS = Object.freeze([
  "enabled",
  "surfaceScale",
  "ambient",
  "diffuse",
  "specular",
  "shininess",
  "lightColor",
  "materialColor",
  "light",
]);
const DIRECTIONAL_LIGHT_KEYS = Object.freeze(["kind", "direction"]);
const POINT_LIGHT_KEYS = Object.freeze(["kind", "position"]);
const IMAGE_KEYS = Object.freeze([
  "kind",
  "version",
  "width",
  "height",
  "colorContract",
  "data",
]);
const PROVIDER_OPTION_KEYS = Object.freeze([
  "initialDeviceEpoch",
  "maximumPixels",
  "maximumResidentBytes",
  "maximumHaloPixels",
  "tileEdge",
  "maximumTiles",
]);
const REQUEST_KEYS = Object.freeze([
  "requestSequence",
  "deviceEpoch",
  "recipe",
  "source",
  "heightMap",
  "signal",
]);
const CPU_OPTION_KEYS = Object.freeze([
  "maximumPixels",
  "maximumResidentBytes",
  "maximumHaloPixels",
  "tileEdge",
  "maximumTiles",
  "signal",
]);
const HEIGHT_CHANNELS: readonly StudioLiveSurfaceHeightChannel[] = Object.freeze([
  "luminance",
  "red",
  "green",
  "blue",
  "alpha",
]);
const BOUNDARY_MODES: readonly StudioLiveSurfaceBoundaryMode[] = Object.freeze([
  "clamp",
  "reflect",
  "transparent",
]);
const ZERO_HASH = `sha256:${"0".repeat(64)}` as const;
const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;
const RGBA_CHANNELS = 4;
const MAX_RGBA16F_VALUE = 65_504;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key))
    && required.every((key) => Object.hasOwn(value, key));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function normalizedF32(value: number): number {
  const normalized = Math.fround(value);
  return normalized === 0 ? 0 : normalized;
}

function tuple3(
  value: unknown,
  minimum: number,
  maximum: number,
): readonly [number, number, number] | null {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || !value.every(finite)
    || value.some((component) => component < minimum || component > maximum)
  ) return null;
  return Object.freeze([
    normalizedF32(value[0]),
    normalizedF32(value[1]),
    normalizedF32(value[2]),
  ]);
}

function normalizedUnitVector(
  value: unknown,
): readonly [number, number, number] | null {
  const tuple = tuple3(
    value,
    -STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumCoordinateMagnitude,
    STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumCoordinateMagnitude,
  );
  if (!tuple) return null;
  const length = Math.hypot(tuple[0], tuple[1], tuple[2]);
  if (!Number.isFinite(length) || length <= 1e-12) return null;
  return Object.freeze([
    normalizedF32(tuple[0] / length),
    normalizedF32(tuple[1] / length),
    normalizedF32(tuple[2] / length),
  ]);
}

function hashBytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function hashJson(value: unknown): `sha256:${string}` {
  return hashBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function recipePayload(recipe: Omit<StudioLiveSurfaceFilterRecipe, "fingerprint">) {
  return {
    kind: recipe.kind,
    version: recipe.version,
    colorContract: recipe.colorContract,
    alphaContract: recipe.alphaContract,
    heightSource: recipe.heightSource,
    heightChannel: recipe.heightChannel,
    displacement: recipe.displacement,
    lighting: recipe.lighting,
  };
}

function normalizeRecipeInput(
  value: unknown,
): Readonly<{
  heightSource: "source" | "separate";
  heightChannel: StudioLiveSurfaceHeightChannel;
  displacement: StudioLiveSurfaceDisplacementRecipe;
  lighting: StudioLiveSurfaceLightingRecipe;
}> | null {
  if (!exactKeys(value, RECIPE_INPUT_KEYS)) return null;
  const heightSource = value.heightSource;
  const heightChannel = value.heightChannel;
  if (
    (heightSource !== "source" && heightSource !== "separate")
    || typeof heightChannel !== "string"
    || !HEIGHT_CHANNELS.includes(heightChannel as StudioLiveSurfaceHeightChannel)
    || !exactKeys(value.displacement, DISPLACEMENT_KEYS)
    || !exactKeys(value.lighting, LIGHTING_KEYS)
  ) return null;
  const displacement = value.displacement;
  if (
    !finite(displacement.scaleX)
    || !finite(displacement.scaleY)
    || Math.abs(displacement.scaleX)
      > STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumDisplacementScale
    || Math.abs(displacement.scaleY)
      > STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumDisplacementScale
    || !finite(displacement.mapMidpoint)
    || displacement.mapMidpoint < 0
    || displacement.mapMidpoint > 1
    || typeof displacement.boundaryMode !== "string"
    || !BOUNDARY_MODES.includes(
      displacement.boundaryMode as StudioLiveSurfaceBoundaryMode,
    )
  ) return null;
  const lighting = value.lighting;
  const lightColor = tuple3(
    lighting.lightColor,
    0,
    STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumColorComponent,
  );
  const materialColor = tuple3(
    lighting.materialColor,
    0,
    STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumColorComponent,
  );
  if (
    typeof lighting.enabled !== "boolean"
    || !finite(lighting.surfaceScale)
    || Math.abs(lighting.surfaceScale)
      > STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumSurfaceScale
    || !finite(lighting.ambient)
    || lighting.ambient < 0
    || lighting.ambient
      > STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumLightStrength
    || !finite(lighting.diffuse)
    || lighting.diffuse < 0
    || lighting.diffuse
      > STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumLightStrength
    || !finite(lighting.specular)
    || lighting.specular < 0
    || lighting.specular
      > STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumLightStrength
    || !finite(lighting.shininess)
    || lighting.shininess < 1
    || lighting.shininess
      > STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumShininess
    || !lightColor
    || !materialColor
    || !isRecord(lighting.light)
  ) return null;
  let light: StudioLiveSurfaceLight | null = null;
  if (
    lighting.light.kind === "directional"
    && exactKeys(lighting.light, DIRECTIONAL_LIGHT_KEYS)
  ) {
    const direction = normalizedUnitVector(lighting.light.direction);
    if (direction) light = Object.freeze({ kind: "directional", direction });
  } else if (
    lighting.light.kind === "point"
    && exactKeys(lighting.light, POINT_LIGHT_KEYS)
  ) {
    const position = tuple3(
      lighting.light.position,
      -STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumCoordinateMagnitude,
      STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumCoordinateMagnitude,
    );
    if (position && position[2] > 0) {
      light = Object.freeze({ kind: "point", position });
    }
  }
  if (!light) return null;
  return Object.freeze({
    heightSource,
    heightChannel: heightChannel as StudioLiveSurfaceHeightChannel,
    displacement: Object.freeze({
      scaleX: normalizedF32(displacement.scaleX),
      scaleY: normalizedF32(displacement.scaleY),
      mapMidpoint: normalizedF32(displacement.mapMidpoint),
      boundaryMode: displacement.boundaryMode as StudioLiveSurfaceBoundaryMode,
    }),
    lighting: Object.freeze({
      enabled: lighting.enabled,
      surfaceScale: normalizedF32(lighting.surfaceScale),
      ambient: normalizedF32(lighting.ambient),
      diffuse: normalizedF32(lighting.diffuse),
      specular: normalizedF32(lighting.specular),
      shininess: normalizedF32(lighting.shininess),
      lightColor,
      materialColor,
      light,
    }),
  });
}

function buildRecipe(
  normalized: NonNullable<ReturnType<typeof normalizeRecipeInput>>,
): StudioLiveSurfaceFilterRecipe {
  const withoutFingerprint = Object.freeze({
    kind: "studio-live-surface-filter-recipe" as const,
    version: STUDIO_LIVE_SURFACE_FILTER_RECIPE_VERSION,
    colorContract: STUDIO_LIVE_SURFACE_FILTER_COLOR_CONTRACT,
    alphaContract: STUDIO_LIVE_SURFACE_FILTER_ALPHA_CONTRACT,
    ...normalized,
  });
  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: hashJson(recipePayload(withoutFingerprint)),
  });
}

export function createStudioLiveSurfaceFilterRecipe(
  value: unknown,
): StudioLiveSurfaceFilterRecipeCreationResult {
  const normalized = normalizeRecipeInput(value);
  return normalized
    ? Object.freeze({ status: "ready", recipe: buildRecipe(normalized) })
    : Object.freeze({
        status: "rejected",
        reason: "invalid-recipe",
        path: "$",
      });
}

export function parseStudioLiveSurfaceFilterRecipe(
  value: unknown,
): StudioLiveSurfaceFilterRecipe | null {
  let candidate: unknown = value;
  if (typeof value === "string") {
    if (
      value.length
      > STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumRecipeJsonCodeUnits
    ) return null;
    try {
      candidate = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!exactKeys(candidate, RECIPE_KEYS)) return null;
  if (
    candidate.kind !== "studio-live-surface-filter-recipe"
    || candidate.version !== STUDIO_LIVE_SURFACE_FILTER_RECIPE_VERSION
    || candidate.colorContract !== STUDIO_LIVE_SURFACE_FILTER_COLOR_CONTRACT
    || candidate.alphaContract !== STUDIO_LIVE_SURFACE_FILTER_ALPHA_CONTRACT
    || typeof candidate.fingerprint !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(candidate.fingerprint)
  ) return null;
  const normalized = normalizeRecipeInput({
    heightSource: candidate.heightSource,
    heightChannel: candidate.heightChannel,
    displacement: candidate.displacement,
    lighting: candidate.lighting,
  });
  if (!normalized) return null;
  const recipe = buildRecipe(normalized);
  return recipe.fingerprint === candidate.fingerprint ? recipe : null;
}

export function serializeStudioLiveSurfaceFilterRecipe(
  value: StudioLiveSurfaceFilterRecipe,
): string | null {
  const recipe = parseStudioLiveSurfaceFilterRecipe(value);
  return recipe ? JSON.stringify(recipe) : null;
}

function imageShapeValid(value: unknown): value is StudioLiveSurfaceImage {
  if (
    !exactKeys(value, IMAGE_KEYS)
    || value.kind !== "studio-live-surface-image"
    || value.version !== STUDIO_LIVE_SURFACE_FILTER_IMAGE_VERSION
    || value.colorContract !== STUDIO_LIVE_SURFACE_FILTER_COLOR_CONTRACT
    || !positiveSafeInteger(value.width)
    || !positiveSafeInteger(value.height)
    || value.width > STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumDimension
    || value.height > STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumDimension
    || !(value.data instanceof Float32Array)
  ) return false;
  const pixelCount = value.width * value.height;
  return Number.isSafeInteger(pixelCount)
    && pixelCount <= STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumPixels
    && value.data.length === pixelCount * RGBA_CHANNELS;
}

function validateImageValues(
  image: StudioLiveSurfaceImage,
  path: string,
): void {
  for (let index = 0; index < image.data.length; index += RGBA_CHANNELS) {
    for (let channel = 0; channel < 3; channel += 1) {
      const component = image.data[index + channel]!;
      if (
        !Number.isFinite(component)
        || component < 0
        || component > MAX_RGBA16F_VALUE
      ) {
        throw new StudioLiveSurfaceFilterError(
          "invalid-image",
          `${path} contains a non-finite or out-of-range linear RGB component.`,
          `${path}.data[${index + channel}]`,
        );
      }
    }
    const alpha = image.data[index + 3]!;
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new StudioLiveSurfaceFilterError(
        "invalid-image",
        `${path} contains an invalid alpha component.`,
        `${path}.data[${index + 3}]`,
      );
    }
  }
}

function normalizeBudgets(
  value: unknown,
  keys: readonly string[],
): NormalizedBudgets | null {
  if (!exactKeys(value, keys, [])) return null;
  const record = value;
  const maximumPixels = record.maximumPixels
    ?? STUDIO_LIVE_SURFACE_FILTER_DEFAULT_BUDGETS.maximumPixels;
  const maximumResidentBytes = record.maximumResidentBytes
    ?? STUDIO_LIVE_SURFACE_FILTER_DEFAULT_BUDGETS.maximumResidentBytes;
  const maximumHaloPixels = record.maximumHaloPixels
    ?? STUDIO_LIVE_SURFACE_FILTER_DEFAULT_BUDGETS.maximumHaloPixels;
  const tileEdge = record.tileEdge
    ?? STUDIO_LIVE_SURFACE_FILTER_DEFAULT_BUDGETS.tileEdge;
  const maximumTiles = record.maximumTiles
    ?? STUDIO_LIVE_SURFACE_FILTER_DEFAULT_BUDGETS.maximumTiles;
  if (
    !positiveSafeInteger(maximumPixels)
    || maximumPixels > STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumPixels
    || !positiveSafeInteger(maximumResidentBytes)
    || maximumResidentBytes
      > STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumResidentBytes
    || !positiveSafeInteger(maximumHaloPixels)
    || maximumHaloPixels
      > STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumHaloPixels
    || !positiveSafeInteger(tileEdge)
    || tileEdge > STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumTileEdge
    || !positiveSafeInteger(maximumTiles)
    || maximumTiles > STUDIO_LIVE_SURFACE_FILTER_HARD_LIMITS.maximumTiles
  ) return null;
  return Object.freeze({
    maximumPixels,
    maximumResidentBytes,
    maximumHaloPixels,
    tileEdge,
    maximumTiles,
  });
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== "undefined" && value instanceof AbortSignal;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new StudioLiveSurfaceFilterError(
      "aborted",
      "Live surface rendering was aborted.",
    );
  }
}

function displacementHalo(recipe: StudioLiveSurfaceFilterRecipe): number {
  const maximumSignedHeight = Math.max(
    recipe.displacement.mapMidpoint,
    1 - recipe.displacement.mapMidpoint,
  );
  const maximumDisplacement = Math.max(
    Math.abs(recipe.displacement.scaleX),
    Math.abs(recipe.displacement.scaleY),
  ) * maximumSignedHeight;
  const sourceHalo = maximumDisplacement > 0
    ? Math.ceil(maximumDisplacement) + 1
    : 0;
  const heightGradientHalo = recipe.lighting.enabled ? 1 : 0;
  return Math.max(sourceHalo, heightGradientHalo);
}

function prepareExecution(
  input: StudioLiveSurfaceCpuOracleInput,
  options: StudioLiveSurfaceCpuOracleOptions,
): PreparedExecution {
  if (!exactKeys(input, ["recipe", "source", "heightMap"], ["recipe", "source"])) {
    throw new StudioLiveSurfaceFilterError(
      "invalid-request",
      "CPU oracle input contains missing or unknown fields.",
      "$",
    );
  }
  const recipe = parseStudioLiveSurfaceFilterRecipe(input.recipe);
  if (!recipe) {
    throw new StudioLiveSurfaceFilterError(
      "invalid-recipe",
      "Live surface recipe is invalid or its fingerprint does not match.",
      "$.recipe",
    );
  }
  if (!imageShapeValid(input.source)) {
    throw new StudioLiveSurfaceFilterError(
      "invalid-image",
      "Source must be a bounded scene-linear RGBA Float32 image.",
      "$.source",
    );
  }
  if (recipe.heightSource === "separate" && !imageShapeValid(input.heightMap)) {
    throw new StudioLiveSurfaceFilterError(
      "height-map-required",
      "This recipe requires a separate scene-linear height map.",
      "$.heightMap",
    );
  }
  if (recipe.heightSource === "source" && input.heightMap !== undefined) {
    throw new StudioLiveSurfaceFilterError(
      "height-map-not-allowed",
      "Same-source recipes must not include a separate height map.",
      "$.heightMap",
    );
  }
  if (!exactKeys(options, CPU_OPTION_KEYS, [])) {
    throw new StudioLiveSurfaceFilterError(
      "invalid-request",
      "CPU oracle options contain unknown fields.",
      "$.options",
    );
  }
  if (options.signal !== undefined && !isAbortSignal(options.signal)) {
    throw new StudioLiveSurfaceFilterError(
      "invalid-request",
      "signal must be a native AbortSignal.",
      "$.options.signal",
    );
  }
  const budgets = normalizeBudgets(options, CPU_OPTION_KEYS);
  if (!budgets) {
    throw new StudioLiveSurfaceFilterError(
      "invalid-request",
      "CPU oracle budgets are invalid.",
      "$.options",
    );
  }
  throwIfAborted(options.signal);
  const heightMap = recipe.heightSource === "source"
    ? input.source
    : input.heightMap!;
  const pixels = input.source.width * input.source.height;
  const outputBytes = pixels * RGBA_CHANNELS * FLOAT32_BYTES;
  const inputBytes = input.source.data.byteLength
    + (heightMap === input.source ? 0 : heightMap.data.byteLength);
  const residentBytes = inputBytes + outputBytes;
  const haloPixels = displacementHalo(recipe);
  const tileColumns = Math.ceil(input.source.width / budgets.tileEdge);
  const tileRows = Math.ceil(input.source.height / budgets.tileEdge);
  const tileCount = tileColumns * tileRows;
  if (
    pixels > budgets.maximumPixels
    || residentBytes > budgets.maximumResidentBytes
    || haloPixels > budgets.maximumHaloPixels
    || tileCount > budgets.maximumTiles
  ) {
    throw new StudioLiveSurfaceFilterError(
      "budget-exceeded",
      "Live surface execution exceeds its pixel, memory, halo, or tile budget.",
      "$.budget",
    );
  }
  validateImageValues(input.source, "$.source");
  if (heightMap !== input.source) validateImageValues(heightMap, "$.heightMap");
  return Object.freeze({
    recipe,
    source: input.source,
    heightMap,
    budgets,
    haloPixels,
    tileCount,
    residentBytes,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

function resolveIndex(
  index: number,
  size: number,
  mode: StudioLiveSurfaceBoundaryMode,
): number {
  if (index >= 0 && index < size) return index;
  if (mode === "transparent") return -1;
  if (mode === "clamp") return Math.max(0, Math.min(size - 1, index));
  if (size === 1) return 0;
  const period = size * 2;
  const wrapped = ((index % period) + period) % period;
  return wrapped < size ? wrapped : period - wrapped - 1;
}

function texel(
  image: StudioLiveSurfaceImage,
  x: number,
  y: number,
  channel: number,
  mode: StudioLiveSurfaceBoundaryMode,
): number {
  const resolvedX = resolveIndex(x, image.width, mode);
  const resolvedY = resolveIndex(y, image.height, mode);
  if (resolvedX < 0 || resolvedY < 0) return 0;
  return image.data[(resolvedY * image.width + resolvedX) * 4 + channel]!;
}

function bilinearChannel(
  image: StudioLiveSurfaceImage,
  x: number,
  y: number,
  channel: number,
  mode: StudioLiveSurfaceBoundaryMode,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const amountX = x - x0;
  const amountY = y - y0;
  const top = texel(image, x0, y0, channel, mode) * (1 - amountX)
    + texel(image, x0 + 1, y0, channel, mode) * amountX;
  const bottom = texel(image, x0, y0 + 1, channel, mode) * (1 - amountX)
    + texel(image, x0 + 1, y0 + 1, channel, mode) * amountX;
  return top * (1 - amountY) + bottom * amountY;
}

function sampleRgba(
  image: StudioLiveSurfaceImage,
  x: number,
  y: number,
  mode: StudioLiveSurfaceBoundaryMode,
  target: Float32Array,
): void {
  for (let channel = 0; channel < RGBA_CHANNELS; channel += 1) {
    target[channel] = normalizedF32(bilinearChannel(image, x, y, channel, mode));
  }
}

function heightTexel(
  image: StudioLiveSurfaceImage,
  x: number,
  y: number,
  channel: StudioLiveSurfaceHeightChannel,
  mode: StudioLiveSurfaceBoundaryMode,
): number {
  if (channel === "red") return bilinearChannel(image, x, y, 0, mode);
  if (channel === "green") return bilinearChannel(image, x, y, 1, mode);
  if (channel === "blue") return bilinearChannel(image, x, y, 2, mode);
  if (channel === "alpha") return bilinearChannel(image, x, y, 3, mode);
  return bilinearChannel(image, x, y, 0, mode) * 0.2126
    + bilinearChannel(image, x, y, 1, mode) * 0.7152
    + bilinearChannel(image, x, y, 2, mode) * 0.0722;
}

function sampleHeightAtSourceCoordinate(
  execution: PreparedExecution,
  sourceX: number,
  sourceY: number,
): number {
  const mapX = ((sourceX + 0.5) / execution.source.width)
    * execution.heightMap.width - 0.5;
  const mapY = ((sourceY + 0.5) / execution.source.height)
    * execution.heightMap.height - 0.5;
  return Math.max(0, Math.min(1, heightTexel(
    execution.heightMap,
    mapX,
    mapY,
    execution.recipe.heightChannel,
    // Height maps are resampled over the source's normalized domain. Clamp avoids inventing
    // transparent cliffs when a lower-resolution map reaches its own outer texel; the selected
    // boundary mode applies to the displaced source sample itself.
    "clamp",
  )));
}

function normalizedLightVector(
  recipe: StudioLiveSurfaceFilterRecipe,
  x: number,
  y: number,
  height: number,
): readonly [number, number, number] {
  if (recipe.lighting.light.kind === "directional") {
    return recipe.lighting.light.direction;
  }
  const light = recipe.lighting.light.position;
  const deltaX = light[0] - x;
  const deltaY = light[1] - y;
  const deltaZ = light[2] - height * recipe.lighting.surfaceScale;
  const length = Math.hypot(deltaX, deltaY, deltaZ);
  if (!Number.isFinite(length) || length <= 1e-12) return [0, 0, 0];
  return [
    normalizedF32(deltaX / length),
    normalizedF32(deltaY / length),
    normalizedF32(deltaZ / length),
  ];
}

function applyLighting(
  execution: PreparedExecution,
  sourceX: number,
  sourceY: number,
  currentHeight: number,
  displaced: Float32Array,
  output: Float32Array,
  outputOffset: number,
): void {
  const lighting = execution.recipe.lighting;
  if (!lighting.enabled) {
    output[outputOffset] = displaced[0]!;
    output[outputOffset + 1] = displaced[1]!;
    output[outputOffset + 2] = displaced[2]!;
    output[outputOffset + 3] = displaced[3]!;
    return;
  }
  const gradientX = (
    sampleHeightAtSourceCoordinate(execution, sourceX + 1, sourceY)
    - sampleHeightAtSourceCoordinate(execution, sourceX - 1, sourceY)
  ) * 0.5 * lighting.surfaceScale;
  const gradientY = (
    sampleHeightAtSourceCoordinate(execution, sourceX, sourceY + 1)
    - sampleHeightAtSourceCoordinate(execution, sourceX, sourceY - 1)
  ) * 0.5 * lighting.surfaceScale;
  const normalLength = Math.hypot(gradientX, gradientY, 1);
  const normalX = -gradientX / normalLength;
  const normalY = -gradientY / normalLength;
  const normalZ = 1 / normalLength;
  const light = normalizedLightVector(
    execution.recipe,
    sourceX,
    sourceY,
    currentHeight,
  );
  const normalDotLight = Math.max(
    0,
    normalX * light[0] + normalY * light[1] + normalZ * light[2],
  );
  const halfX = light[0];
  const halfY = light[1];
  const halfZ = light[2] + 1;
  const halfLength = Math.hypot(halfX, halfY, halfZ);
  const normalDotHalf = halfLength <= 1e-12
    ? 0
    : Math.max(
        0,
        (
          normalX * halfX
          + normalY * halfY
          + normalZ * halfZ
        ) / halfLength,
      );
  const specular = normalDotLight > 0
    ? lighting.specular * Math.pow(normalDotHalf, lighting.shininess)
    : 0;
  const alpha = displaced[3]!;
  for (let channel = 0; channel < 3; channel += 1) {
    if (alpha <= 0) {
      output[outputOffset + channel] = 0;
      continue;
    }
    const material = displaced[channel]! * lighting.materialColor[channel]!;
    const lit = material * lighting.ambient
      + material
        * lighting.lightColor[channel]!
        * lighting.diffuse
        * normalDotLight
      + lighting.lightColor[channel]! * specular;
    output[outputOffset + channel] = normalizedF32(
      Math.max(0, Math.min(MAX_RGBA16F_VALUE, lit)),
    );
  }
  output[outputOffset + 3] = alpha;
}

function float32BytesLittleEndian(data: Float32Array): Uint8Array {
  const probe = new Uint16Array([0x00ff]);
  const littleEndian = new Uint8Array(probe.buffer)[0] === 0xff;
  if (littleEndian) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  const bytes = new Uint8Array(data.byteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < data.length; index += 1) {
    view.setFloat32(index * FLOAT32_BYTES, data[index]!, true);
  }
  return bytes;
}

function imageHash(image: StudioLiveSurfaceImage): `sha256:${string}` {
  return hashBytes(float32BytesLittleEndian(image.data));
}

export function renderStudioLiveSurfaceFilterCpuOracle(
  input: StudioLiveSurfaceCpuOracleInput,
  options: StudioLiveSurfaceCpuOracleOptions = {},
): StudioLiveSurfaceCpuOracleResult {
  const execution = prepareExecution(input, options);
  throwIfAborted(execution.signal);
  let outputData: Float32Array;
  try {
    outputData = new Float32Array(
      execution.source.width * execution.source.height * RGBA_CHANNELS,
    );
  } catch (error) {
    throw new StudioLiveSurfaceFilterError(
      "runtime-failed",
      "Could not allocate the live surface output.",
      "$.output",
      { cause: error },
    );
  }
  const displaced = new Float32Array(RGBA_CHANNELS);
  const boundary = execution.recipe.displacement.boundaryMode;
  const tileEdge = execution.budgets.tileEdge;
  for (
    let tileY = 0;
    tileY < execution.source.height;
    tileY += tileEdge
  ) {
    const endY = Math.min(execution.source.height, tileY + tileEdge);
    for (
      let tileX = 0;
      tileX < execution.source.width;
      tileX += tileEdge
    ) {
      throwIfAborted(execution.signal);
      const endX = Math.min(execution.source.width, tileX + tileEdge);
      for (let y = tileY; y < endY; y += 1) {
        throwIfAborted(execution.signal);
        for (let x = tileX; x < endX; x += 1) {
          const height = sampleHeightAtSourceCoordinate(execution, x, y);
          const signedHeight = height
            - execution.recipe.displacement.mapMidpoint;
          const displacedX = x
            + signedHeight * execution.recipe.displacement.scaleX;
          const displacedY = y
            + signedHeight * execution.recipe.displacement.scaleY;
          sampleRgba(
            execution.source,
            displacedX,
            displacedY,
            boundary,
            displaced,
          );
          applyLighting(
            execution,
            x,
            y,
            height,
            displaced,
            outputData,
            (y * execution.source.width + x) * RGBA_CHANNELS,
          );
        }
      }
    }
  }
  throwIfAborted(execution.signal);
  const image: StudioLiveSurfaceImage = Object.freeze({
    kind: "studio-live-surface-image",
    version: STUDIO_LIVE_SURFACE_FILTER_IMAGE_VERSION,
    width: execution.source.width,
    height: execution.source.height,
    colorContract: STUDIO_LIVE_SURFACE_FILTER_COLOR_CONTRACT,
    data: outputData,
  });
  const sourceHash = imageHash(execution.source);
  const heightMapHash = execution.heightMap === execution.source
    ? sourceHash
    : imageHash(execution.heightMap);
  const outputHash = imageHash(image);
  const receipt: StudioLiveSurfaceCpuOracleReceipt = Object.freeze({
    kind: "studio-live-surface-cpu-oracle-receipt",
    version: STUDIO_LIVE_SURFACE_FILTER_RECEIPT_VERSION,
    backend: "cpu-typed-array",
    executionModel: "deterministic-tiled-oracle",
    colorContract: STUDIO_LIVE_SURFACE_FILTER_COLOR_CONTRACT,
    alphaContract: STUDIO_LIVE_SURFACE_FILTER_ALPHA_CONTRACT,
    recipeFingerprint: execution.recipe.fingerprint,
    sourceHash,
    heightMapHash,
    outputHash,
    heightSource: execution.recipe.heightSource,
    sourceSize: Object.freeze([
      execution.source.width,
      execution.source.height,
    ] as const),
    heightMapSize: Object.freeze([
      execution.heightMap.width,
      execution.heightMap.height,
    ] as const),
    boundaryMode: boundary,
    tileEdge,
    tileCount: execution.tileCount,
    haloPixels: execution.haloPixels,
    residentBytes: execution.residentBytes,
    complete: true,
  });
  return Object.freeze({ image, receipt });
}

function receiptHash(
  requestSequence: number,
  deviceEpoch: number,
  oracle: StudioLiveSurfaceCpuOracleReceipt,
): `sha256:${string}` {
  return hashJson({
    kind: "studio-live-surface-filter-receipt",
    version: STUDIO_LIVE_SURFACE_FILTER_RECEIPT_VERSION,
    providerRevision: STUDIO_LIVE_SURFACE_FILTER_PROVIDER_REVISION,
    requestSequence,
    deviceEpoch,
    recipeFingerprint: oracle.recipeFingerprint,
    sourceHash: oracle.sourceHash,
    heightMapHash: oracle.heightMapHash,
    outputHash: oracle.outputHash,
    heightSource: oracle.heightSource,
    sourceSize: oracle.sourceSize,
    heightMapSize: oracle.heightMapSize,
    boundaryMode: oracle.boundaryMode,
    tileEdge: oracle.tileEdge,
    tileCount: oracle.tileCount,
    haloPixels: oracle.haloPixels,
    residentBytes: oracle.residentBytes,
  });
}

export class StudioLiveSurfaceFilterProvider {
  #deviceEpoch: number;
  #lastRequestSequence = 0;
  #disposed = false;

  public constructor(
    initialDeviceEpoch: number,
    readonly budgets: NormalizedBudgets,
  ) {
    this.#deviceEpoch = initialDeviceEpoch;
  }

  public async execute(
    request: StudioLiveSurfaceFilterRequest,
  ): Promise<StudioLiveSurfaceFilterReceipt> {
    if (this.#disposed) {
      throw new StudioLiveSurfaceFilterError(
        "disposed",
        "Live surface provider is disposed.",
      );
    }
    if (
      !exactKeys(
        request,
        REQUEST_KEYS,
        ["requestSequence", "deviceEpoch", "recipe", "source"],
      )
      || !positiveSafeInteger(request.requestSequence)
      || !positiveSafeInteger(request.deviceEpoch)
      || (
        request.signal !== undefined
        && !isAbortSignal(request.signal)
      )
    ) {
      throw new StudioLiveSurfaceFilterError(
        "invalid-request",
        "Live surface request is malformed.",
        "$",
      );
    }
    if (request.deviceEpoch !== this.#deviceEpoch) {
      throw new StudioLiveSurfaceFilterError(
        "device-epoch",
        "Live surface request belongs to a stale device epoch.",
        "$.deviceEpoch",
      );
    }
    if (request.requestSequence <= this.#lastRequestSequence) {
      throw new StudioLiveSurfaceFilterError(
        "request-sequence",
        "Live surface request sequence must increase monotonically.",
        "$.requestSequence",
      );
    }
    throwIfAborted(request.signal);
    const input: StudioLiveSurfaceCpuOracleInput = {
      recipe: request.recipe,
      source: request.source,
      ...(request.heightMap === undefined ? {} : { heightMap: request.heightMap }),
    };
    // Validation and budget rejection happen before the sequence is consumed.
    prepareExecution(input, {
      ...this.budgets,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    this.#lastRequestSequence = request.requestSequence;
    const oracle = renderStudioLiveSurfaceFilterCpuOracle(input, {
      ...this.budgets,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const hash = receiptHash(
      request.requestSequence,
      request.deviceEpoch,
      oracle.receipt,
    );
    return Object.freeze({
      kind: "studio-live-surface-filter-receipt",
      version: STUDIO_LIVE_SURFACE_FILTER_RECEIPT_VERSION,
      providerRevision: STUDIO_LIVE_SURFACE_FILTER_PROVIDER_REVISION,
      requestSequence: request.requestSequence,
      deviceEpoch: request.deviceEpoch,
      recipeFingerprint: oracle.receipt.recipeFingerprint,
      output: oracle.image,
      oracle: oracle.receipt,
      receiptHash: hash,
      complete: true,
    });
  }

  public advanceDeviceEpoch(): number {
    if (this.#disposed) return this.#deviceEpoch;
    if (this.#deviceEpoch >= Number.MAX_SAFE_INTEGER) {
      throw new StudioLiveSurfaceFilterError(
        "runtime-failed",
        "Live surface device epoch is exhausted.",
      );
    }
    this.#deviceEpoch += 1;
    this.#lastRequestSequence = 0;
    return this.#deviceEpoch;
  }

  public snapshot(): Readonly<{
    state: "ready" | "disposed";
    deviceEpoch: number;
    lastRequestSequence: number;
    budgets: NormalizedBudgets;
  }> {
    return Object.freeze({
      state: this.#disposed ? "disposed" : "ready",
      deviceEpoch: this.#deviceEpoch,
      lastRequestSequence: this.#lastRequestSequence,
      budgets: this.budgets,
    });
  }

  public dispose(): void {
    this.#disposed = true;
  }
}

export function createStudioLiveSurfaceFilterProvider(
  value: StudioLiveSurfaceFilterProviderOptions = {},
): StudioLiveSurfaceFilterProviderCreationResult {
  if (!exactKeys(value, PROVIDER_OPTION_KEYS, [])) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-options",
      path: "$",
    });
  }
  const initialDeviceEpoch = value.initialDeviceEpoch ?? 1;
  const budgets = normalizeBudgets(value, PROVIDER_OPTION_KEYS);
  if (!positiveSafeInteger(initialDeviceEpoch) || !budgets) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-options",
      path: "$",
    });
  }
  return Object.freeze({
    status: "ready",
    provider: new StudioLiveSurfaceFilterProvider(initialDeviceEpoch, budgets),
  });
}

/** Visible negative proof for accidental placeholder hashes in future save/provider adapters. */
export function isStudioLiveSurfaceFilterContentHash(
  value: unknown,
): value is `sha256:${string}` {
  return typeof value === "string"
    && /^sha256:[0-9a-f]{64}$/u.test(value)
    && value !== ZERO_HASH;
}
