import { sha256HexPortable } from "./studio-sha256";

/**
 * Renderer-neutral, clean-room surface-lighting oracle.
 *
 * Pixel contract:
 * - source/output RGB is scene-linear, straight-alpha Float32
 * - height is signed: a source channel is shifted by its explicit midpoint, while
 *   a separate height map stores signed values directly
 * - roughness and metalness are unit-interval scalar fields
 * - a normal map stores normalized surface-space XYZ vectors
 * - lighting never changes source alpha
 *
 * The specular term is an energy-partitioned, normalized Blinn lobe. Schlick
 * Fresnel divides the response into diffuse and specular shares, and the lobe is
 * capped by N·L. This makes the reference implementation deliberately conservative
 * and suitable as a deterministic CPU oracle for later accelerated providers.
 */

export const STUDIO_MULTI_LIGHT_SURFACE_RECIPE_VERSION = 1 as const;
export const STUDIO_MULTI_LIGHT_SURFACE_PROVIDER_REVISION = 1 as const;
export const STUDIO_MULTI_LIGHT_SURFACE_RESOURCE_VERSION = 1 as const;
export const STUDIO_MULTI_LIGHT_SURFACE_RECEIPT_VERSION = 1 as const;
export const STUDIO_MULTI_LIGHT_SURFACE_COLOR_CONTRACT =
  "scene-linear-straight-rgba-f32" as const;
export const STUDIO_MULTI_LIGHT_SURFACE_ALPHA_CONTRACT =
  "preserve-source-alpha-exactly" as const;

export const STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS = Object.freeze({
  maximumDimension: 65_536,
  maximumPixels: 268_435_456,
  maximumResidentBytes: 4_294_967_296,
  maximumWorkUnits: 1_099_511_627_776,
  maximumTileEdge: 2_048,
  maximumTiles: 1_048_576,
  maximumLights: 64,
  maximumHeightMagnitude: 16_384,
  maximumSurfaceScale: 16_384,
  maximumCoordinateMagnitude: 1_000_000,
  maximumLightIntensity: 4_096,
  maximumColorComponent: 64,
  maximumRecipeJsonCodeUnits: 131_072,
} as const);

export const STUDIO_MULTI_LIGHT_SURFACE_DEFAULT_BUDGETS = Object.freeze({
  maximumPixels: 67_108_864,
  maximumResidentBytes: 2_147_483_648,
  maximumWorkUnits: 1_073_741_824,
  maximumLights: 32,
  tileEdge: 256,
  maximumTiles: 1_048_576,
} as const);

export type StudioMultiLightSurfaceHeightChannel =
  | "luminance"
  | "red"
  | "green"
  | "blue"
  | "alpha";

export interface StudioMultiLightSurfaceSourceHeightInput {
  readonly source: "source";
  readonly channel: StudioMultiLightSurfaceHeightChannel;
  readonly midpoint: number;
  readonly scale: number;
}

export interface StudioMultiLightSurfaceSeparateHeightInput {
  readonly source: "separate";
  readonly scale: number;
}

export type StudioMultiLightSurfaceHeightInput =
  | StudioMultiLightSurfaceSourceHeightInput
  | StudioMultiLightSurfaceSeparateHeightInput;

export interface StudioMultiLightSurfaceHeightNormalInput {
  readonly source: "height";
}

export interface StudioMultiLightSurfaceMappedNormalInput {
  readonly source: "height-and-map";
  readonly strength: number;
}

export type StudioMultiLightSurfaceNormalInput =
  | StudioMultiLightSurfaceHeightNormalInput
  | StudioMultiLightSurfaceMappedNormalInput;

export interface StudioMultiLightSurfaceScalarMaterialInput {
  readonly source: "constant" | "map";
  readonly value: number;
}

export interface StudioMultiLightSurfaceMaterialInput {
  readonly tint: readonly [red: number, green: number, blue: number];
  readonly diffuseStrength: number;
  readonly specularStrength: number;
  readonly roughness: StudioMultiLightSurfaceScalarMaterialInput;
  readonly metalness: StudioMultiLightSurfaceScalarMaterialInput;
}

export interface StudioMultiLightSurfaceAmbientInput {
  readonly color: readonly [red: number, green: number, blue: number];
  readonly intensity: number;
}

export interface StudioMultiLightSurfaceDirectionalLightInput {
  readonly id: string;
  readonly kind: "directional";
  /** Points from the surface toward the light and is normalized at creation. */
  readonly direction: readonly [x: number, y: number, z: number];
  readonly color: readonly [red: number, green: number, blue: number];
  readonly intensity: number;
}

export type StudioMultiLightSurfaceAttenuationKind =
  | "inverse-square"
  | "smooth-range";

export interface StudioMultiLightSurfaceAttenuationInput {
  readonly kind: StudioMultiLightSurfaceAttenuationKind;
  readonly range: number;
  readonly minimumDistance: number;
}

export interface StudioMultiLightSurfacePointLightInput {
  readonly id: string;
  readonly kind: "point";
  readonly position: readonly [x: number, y: number, z: number];
  readonly color: readonly [red: number, green: number, blue: number];
  readonly intensity: number;
  readonly attenuation: StudioMultiLightSurfaceAttenuationInput;
}

export interface StudioMultiLightSurfaceSpotLightInput {
  readonly id: string;
  readonly kind: "spot";
  readonly position: readonly [x: number, y: number, z: number];
  /** Points outward from the light and is normalized at creation. */
  readonly direction: readonly [x: number, y: number, z: number];
  readonly color: readonly [red: number, green: number, blue: number];
  readonly intensity: number;
  readonly attenuation: StudioMultiLightSurfaceAttenuationInput;
  readonly innerConeDegrees: number;
  readonly outerConeDegrees: number;
}

export type StudioMultiLightSurfaceLightInput =
  | StudioMultiLightSurfaceDirectionalLightInput
  | StudioMultiLightSurfacePointLightInput
  | StudioMultiLightSurfaceSpotLightInput;

export interface StudioMultiLightSurfaceRecipeInput {
  readonly height: StudioMultiLightSurfaceHeightInput;
  readonly normal: StudioMultiLightSurfaceNormalInput;
  readonly material: StudioMultiLightSurfaceMaterialInput;
  readonly ambient: StudioMultiLightSurfaceAmbientInput;
  /** Rig order is preserved in the recipe. Additive evaluation is canonicalized by unique ID. */
  readonly lights: readonly StudioMultiLightSurfaceLightInput[];
}

export type StudioMultiLightSurfaceHeight = StudioMultiLightSurfaceHeightInput;
export type StudioMultiLightSurfaceNormal = StudioMultiLightSurfaceNormalInput;
export type StudioMultiLightSurfaceScalarMaterial =
  StudioMultiLightSurfaceScalarMaterialInput;
export type StudioMultiLightSurfaceMaterial =
  StudioMultiLightSurfaceMaterialInput;
export type StudioMultiLightSurfaceAmbient = StudioMultiLightSurfaceAmbientInput;
export type StudioMultiLightSurfaceAttenuation =
  StudioMultiLightSurfaceAttenuationInput;
export type StudioMultiLightSurfaceLight = StudioMultiLightSurfaceLightInput;

export interface StudioMultiLightSurfaceRecipe {
  readonly kind: "studio-multi-light-surface-recipe";
  readonly version: typeof STUDIO_MULTI_LIGHT_SURFACE_RECIPE_VERSION;
  readonly colorContract: typeof STUDIO_MULTI_LIGHT_SURFACE_COLOR_CONTRACT;
  readonly alphaContract: typeof STUDIO_MULTI_LIGHT_SURFACE_ALPHA_CONTRACT;
  readonly height: StudioMultiLightSurfaceHeight;
  readonly normal: StudioMultiLightSurfaceNormal;
  readonly material: StudioMultiLightSurfaceMaterial;
  readonly ambient: StudioMultiLightSurfaceAmbient;
  readonly lights: readonly StudioMultiLightSurfaceLight[];
  readonly fingerprint: `sha256:${string}`;
}

export type StudioMultiLightSurfaceRecipeCreationResult =
  | Readonly<{ status: "ready"; recipe: StudioMultiLightSurfaceRecipe }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-recipe";
      path: string;
    }>;

export interface StudioMultiLightSurfaceImage {
  readonly kind: "studio-multi-light-surface-image";
  readonly version: typeof STUDIO_MULTI_LIGHT_SURFACE_RESOURCE_VERSION;
  readonly width: number;
  readonly height: number;
  readonly colorContract: typeof STUDIO_MULTI_LIGHT_SURFACE_COLOR_CONTRACT;
  readonly data: Float32Array;
}

export type StudioMultiLightSurfaceScalarSemantic =
  | "signed-height"
  | "roughness"
  | "metalness";

export interface StudioMultiLightSurfaceScalarMap {
  readonly kind: "studio-multi-light-surface-scalar-map";
  readonly version: typeof STUDIO_MULTI_LIGHT_SURFACE_RESOURCE_VERSION;
  readonly width: number;
  readonly height: number;
  readonly semantic: StudioMultiLightSurfaceScalarSemantic;
  readonly data: Float32Array;
}

export interface StudioMultiLightSurfaceNormalMap {
  readonly kind: "studio-multi-light-surface-normal-map";
  readonly version: typeof STUDIO_MULTI_LIGHT_SURFACE_RESOURCE_VERSION;
  readonly width: number;
  readonly height: number;
  readonly space: "surface";
  readonly data: Float32Array;
}

export interface StudioMultiLightSurfaceCpuOracleInput {
  readonly recipe: StudioMultiLightSurfaceRecipe;
  readonly source: StudioMultiLightSurfaceImage;
  readonly heightMap?: StudioMultiLightSurfaceScalarMap;
  readonly roughnessMap?: StudioMultiLightSurfaceScalarMap;
  readonly metalnessMap?: StudioMultiLightSurfaceScalarMap;
  readonly normalMap?: StudioMultiLightSurfaceNormalMap;
}

export interface StudioMultiLightSurfaceCpuOracleOptions {
  readonly maximumPixels?: number;
  readonly maximumResidentBytes?: number;
  readonly maximumWorkUnits?: number;
  readonly maximumLights?: number;
  readonly tileEdge?: number;
  readonly maximumTiles?: number;
  readonly signal?: AbortSignal;
}

export interface StudioMultiLightSurfaceCpuOracleReceipt {
  readonly kind: "studio-multi-light-surface-cpu-oracle-receipt";
  readonly version: typeof STUDIO_MULTI_LIGHT_SURFACE_RECEIPT_VERSION;
  readonly backend: "cpu-typed-array";
  readonly executionModel: "deterministic-tiled-canonical-light-order";
  readonly colorContract: typeof STUDIO_MULTI_LIGHT_SURFACE_COLOR_CONTRACT;
  readonly alphaContract: typeof STUDIO_MULTI_LIGHT_SURFACE_ALPHA_CONTRACT;
  readonly recipeFingerprint: `sha256:${string}`;
  readonly sourceHash: `sha256:${string}`;
  readonly heightMapHash: `sha256:${string}` | null;
  readonly roughnessMapHash: `sha256:${string}` | null;
  readonly metalnessMapHash: `sha256:${string}` | null;
  readonly normalMapHash: `sha256:${string}` | null;
  readonly outputHash: `sha256:${string}`;
  readonly sourceSize: readonly [width: number, height: number];
  readonly rigOrder: readonly string[];
  readonly evaluationOrder: readonly string[];
  readonly lightCount: number;
  readonly tileEdge: number;
  readonly tileCount: number;
  readonly haloPixels: 1;
  readonly workUnits: number;
  readonly residentBytes: number;
  readonly complete: true;
}

export interface StudioMultiLightSurfaceCpuOracleResult {
  readonly image: StudioMultiLightSurfaceImage;
  readonly receipt: StudioMultiLightSurfaceCpuOracleReceipt;
}

export interface StudioMultiLightSurfaceProviderOptions {
  readonly initialDeviceEpoch?: number;
  readonly maximumPixels?: number;
  readonly maximumResidentBytes?: number;
  readonly maximumWorkUnits?: number;
  readonly maximumLights?: number;
  readonly tileEdge?: number;
  readonly maximumTiles?: number;
}

export interface StudioMultiLightSurfaceRequest
  extends StudioMultiLightSurfaceCpuOracleInput {
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly signal?: AbortSignal;
}

export interface StudioMultiLightSurfaceReceipt {
  readonly kind: "studio-multi-light-surface-receipt";
  readonly version: typeof STUDIO_MULTI_LIGHT_SURFACE_RECEIPT_VERSION;
  readonly providerRevision: typeof STUDIO_MULTI_LIGHT_SURFACE_PROVIDER_REVISION;
  readonly requestSequence: number;
  readonly deviceEpoch: number;
  readonly recipeFingerprint: `sha256:${string}`;
  readonly output: StudioMultiLightSurfaceImage;
  readonly oracle: StudioMultiLightSurfaceCpuOracleReceipt;
  readonly receiptHash: `sha256:${string}`;
  readonly complete: true;
}

export type StudioMultiLightSurfaceProviderCreationResult =
  | Readonly<{
      status: "ready";
      provider: StudioMultiLightSurfaceProvider;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-options";
      path: string;
    }>;

export type StudioMultiLightSurfaceErrorCode =
  | "invalid-recipe"
  | "invalid-image"
  | "invalid-map"
  | "map-required"
  | "map-not-allowed"
  | "budget-exceeded"
  | "invalid-request"
  | "request-sequence"
  | "device-epoch"
  | "aborted"
  | "disposed"
  | "runtime-failed";

export class StudioMultiLightSurfaceError extends Error {
  public constructor(
    readonly code: StudioMultiLightSurfaceErrorCode,
    message: string,
    readonly path?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioMultiLightSurfaceError";
  }
}

interface NormalizedBudgets {
  readonly maximumPixels: number;
  readonly maximumResidentBytes: number;
  readonly maximumWorkUnits: number;
  readonly maximumLights: number;
  readonly tileEdge: number;
  readonly maximumTiles: number;
}

interface PreparedExecution {
  readonly recipe: StudioMultiLightSurfaceRecipe;
  readonly source: StudioMultiLightSurfaceImage;
  readonly heightMap?: StudioMultiLightSurfaceScalarMap;
  readonly roughnessMap?: StudioMultiLightSurfaceScalarMap;
  readonly metalnessMap?: StudioMultiLightSurfaceScalarMap;
  readonly normalMap?: StudioMultiLightSurfaceNormalMap;
  readonly evaluationLights: readonly StudioMultiLightSurfaceLight[];
  readonly budgets: NormalizedBudgets;
  readonly tileCount: number;
  readonly workUnits: number;
  readonly residentBytes: number;
  readonly signal?: AbortSignal;
}

const RECIPE_INPUT_KEYS = Object.freeze([
  "height",
  "normal",
  "material",
  "ambient",
  "lights",
]);
const RECIPE_KEYS = Object.freeze([
  "kind",
  "version",
  "colorContract",
  "alphaContract",
  ...RECIPE_INPUT_KEYS,
  "fingerprint",
]);
const SOURCE_HEIGHT_KEYS = Object.freeze([
  "source",
  "channel",
  "midpoint",
  "scale",
]);
const SEPARATE_HEIGHT_KEYS = Object.freeze(["source", "scale"]);
const HEIGHT_NORMAL_KEYS = Object.freeze(["source"]);
const MAPPED_NORMAL_KEYS = Object.freeze(["source", "strength"]);
const MATERIAL_KEYS = Object.freeze([
  "tint",
  "diffuseStrength",
  "specularStrength",
  "roughness",
  "metalness",
]);
const SCALAR_MATERIAL_KEYS = Object.freeze(["source", "value"]);
const AMBIENT_KEYS = Object.freeze(["color", "intensity"]);
const DIRECTIONAL_LIGHT_KEYS = Object.freeze([
  "id",
  "kind",
  "direction",
  "color",
  "intensity",
]);
const POINT_LIGHT_KEYS = Object.freeze([
  "id",
  "kind",
  "position",
  "color",
  "intensity",
  "attenuation",
]);
const SPOT_LIGHT_KEYS = Object.freeze([
  "id",
  "kind",
  "position",
  "direction",
  "color",
  "intensity",
  "attenuation",
  "innerConeDegrees",
  "outerConeDegrees",
]);
const ATTENUATION_KEYS = Object.freeze([
  "kind",
  "range",
  "minimumDistance",
]);
const IMAGE_KEYS = Object.freeze([
  "kind",
  "version",
  "width",
  "height",
  "colorContract",
  "data",
]);
const SCALAR_MAP_KEYS = Object.freeze([
  "kind",
  "version",
  "width",
  "height",
  "semantic",
  "data",
]);
const NORMAL_MAP_KEYS = Object.freeze([
  "kind",
  "version",
  "width",
  "height",
  "space",
  "data",
]);
const CPU_INPUT_KEYS = Object.freeze([
  "recipe",
  "source",
  "heightMap",
  "roughnessMap",
  "metalnessMap",
  "normalMap",
]);
const CPU_OPTION_KEYS = Object.freeze([
  "maximumPixels",
  "maximumResidentBytes",
  "maximumWorkUnits",
  "maximumLights",
  "tileEdge",
  "maximumTiles",
  "signal",
]);
const PROVIDER_OPTION_KEYS = Object.freeze([
  "initialDeviceEpoch",
  "maximumPixels",
  "maximumResidentBytes",
  "maximumWorkUnits",
  "maximumLights",
  "tileEdge",
  "maximumTiles",
]);
const REQUEST_KEYS = Object.freeze([
  "requestSequence",
  "deviceEpoch",
  ...CPU_INPUT_KEYS,
  "signal",
]);
const HEIGHT_CHANNELS: readonly StudioMultiLightSurfaceHeightChannel[] =
  Object.freeze(["luminance", "red", "green", "blue", "alpha"]);
const ZERO_HASH = `sha256:${"0".repeat(64)}` as const;
const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;
const RGBA_CHANNELS = 4;
const NORMAL_CHANNELS = 3;
const MAX_RGBA16F_VALUE = 65_504;
const LIGHT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,62}[a-z0-9])?$/u;

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

function unitVector(
  value: unknown,
): readonly [number, number, number] | null {
  const tuple = tuple3(
    value,
    -STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumCoordinateMagnitude,
    STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumCoordinateMagnitude,
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

function copyHeight(
  value: unknown,
): StudioMultiLightSurfaceHeight | null {
  if (!isRecord(value) || (value.source !== "source" && value.source !== "separate")) {
    return null;
  }
  if (value.source === "source") {
    if (
      !exactKeys(value, SOURCE_HEIGHT_KEYS)
      || typeof value.channel !== "string"
      || !HEIGHT_CHANNELS.includes(
        value.channel as StudioMultiLightSurfaceHeightChannel,
      )
      || !finite(value.midpoint)
      || value.midpoint < 0
      || value.midpoint > 1
      || !finite(value.scale)
      || Math.abs(value.scale)
        > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumSurfaceScale
    ) return null;
    return Object.freeze({
      source: "source",
      channel: value.channel as StudioMultiLightSurfaceHeightChannel,
      midpoint: normalizedF32(value.midpoint),
      scale: normalizedF32(value.scale),
    });
  }
  if (
    !exactKeys(value, SEPARATE_HEIGHT_KEYS)
    || !finite(value.scale)
    || Math.abs(value.scale)
      > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumSurfaceScale
  ) return null;
  return Object.freeze({
    source: "separate",
    scale: normalizedF32(value.scale),
  });
}

function copyNormal(
  value: unknown,
): StudioMultiLightSurfaceNormal | null {
  if (!isRecord(value)) return null;
  if (value.source === "height" && exactKeys(value, HEIGHT_NORMAL_KEYS)) {
    return Object.freeze({ source: "height" });
  }
  if (
    value.source === "height-and-map"
    && exactKeys(value, MAPPED_NORMAL_KEYS)
    && finite(value.strength)
    && value.strength >= 0
    && value.strength <= 1
  ) {
    return Object.freeze({
      source: "height-and-map",
      strength: normalizedF32(value.strength),
    });
  }
  return null;
}

function copyScalarMaterial(
  value: unknown,
): StudioMultiLightSurfaceScalarMaterial | null {
  if (
    !exactKeys(value, SCALAR_MATERIAL_KEYS)
    || (value.source !== "constant" && value.source !== "map")
    || !finite(value.value)
    || value.value < 0
    || value.value > 1
  ) return null;
  return Object.freeze({
    source: value.source,
    value: normalizedF32(value.value),
  });
}

function copyAttenuation(
  value: unknown,
): StudioMultiLightSurfaceAttenuation | null {
  if (
    !exactKeys(value, ATTENUATION_KEYS)
    || (value.kind !== "inverse-square" && value.kind !== "smooth-range")
    || !finite(value.range)
    || value.range <= 0
    || value.range
      > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumCoordinateMagnitude
    || !finite(value.minimumDistance)
    || value.minimumDistance <= 0
    || value.minimumDistance > value.range
  ) return null;
  return Object.freeze({
    kind: value.kind,
    range: normalizedF32(value.range),
    minimumDistance: normalizedF32(value.minimumDistance),
  });
}

function copyLight(value: unknown): StudioMultiLightSurfaceLight | null {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || !LIGHT_ID_PATTERN.test(value.id)
    || !finite(value.intensity)
    || value.intensity < 0
    || value.intensity
      > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumLightIntensity
  ) return null;
  const color = tuple3(
    value.color,
    0,
    STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumColorComponent,
  );
  if (!color) return null;
  if (
    value.kind === "directional"
    && exactKeys(value, DIRECTIONAL_LIGHT_KEYS)
  ) {
    const direction = unitVector(value.direction);
    return direction
      ? Object.freeze({
          id: value.id,
          kind: "directional",
          direction,
          color,
          intensity: normalizedF32(value.intensity),
        })
      : null;
  }
  const position = tuple3(
    value.position,
    -STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumCoordinateMagnitude,
    STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumCoordinateMagnitude,
  );
  const attenuation = copyAttenuation(value.attenuation);
  if (!position || !attenuation) return null;
  if (value.kind === "point" && exactKeys(value, POINT_LIGHT_KEYS)) {
    return Object.freeze({
      id: value.id,
      kind: "point",
      position,
      color,
      intensity: normalizedF32(value.intensity),
      attenuation,
    });
  }
  if (
    value.kind === "spot"
    && exactKeys(value, SPOT_LIGHT_KEYS)
    && finite(value.innerConeDegrees)
    && finite(value.outerConeDegrees)
    && value.innerConeDegrees >= 0
    && value.outerConeDegrees > value.innerConeDegrees
    && value.outerConeDegrees < 90
  ) {
    const direction = unitVector(value.direction);
    return direction
      ? Object.freeze({
          id: value.id,
          kind: "spot",
          position,
          direction,
          color,
          intensity: normalizedF32(value.intensity),
          attenuation,
          innerConeDegrees: normalizedF32(value.innerConeDegrees),
          outerConeDegrees: normalizedF32(value.outerConeDegrees),
        })
      : null;
  }
  return null;
}

function normalizeRecipeInput(
  value: unknown,
): Omit<
  StudioMultiLightSurfaceRecipe,
  "kind" | "version" | "colorContract" | "alphaContract" | "fingerprint"
> | null {
  if (
    !exactKeys(value, RECIPE_INPUT_KEYS)
    || !exactKeys(value.material, MATERIAL_KEYS)
    || !exactKeys(value.ambient, AMBIENT_KEYS)
    || !Array.isArray(value.lights)
    || value.lights.length < 1
    || value.lights.length
      > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumLights
  ) return null;
  const height = copyHeight(value.height);
  const normal = copyNormal(value.normal);
  const roughness = copyScalarMaterial(value.material.roughness);
  const metalness = copyScalarMaterial(value.material.metalness);
  const tint = tuple3(
    value.material.tint,
    0,
    STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumColorComponent,
  );
  const ambientColor = tuple3(
    value.ambient.color,
    0,
    STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumColorComponent,
  );
  if (
    !height
    || !normal
    || !roughness
    || !metalness
    || !tint
    || !ambientColor
    || !finite(value.material.diffuseStrength)
    || value.material.diffuseStrength < 0
    || value.material.diffuseStrength > 1
    || !finite(value.material.specularStrength)
    || value.material.specularStrength < 0
    || value.material.specularStrength > 1
    || !finite(value.ambient.intensity)
    || value.ambient.intensity < 0
    || value.ambient.intensity
      > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumLightIntensity
  ) return null;
  const lights: StudioMultiLightSurfaceLight[] = [];
  const ids = new Set<string>();
  for (const candidate of value.lights) {
    const light = copyLight(candidate);
    if (!light || ids.has(light.id)) return null;
    ids.add(light.id);
    lights.push(light);
  }
  return Object.freeze({
    height,
    normal,
    material: Object.freeze({
      tint,
      diffuseStrength: normalizedF32(value.material.diffuseStrength),
      specularStrength: normalizedF32(value.material.specularStrength),
      roughness,
      metalness,
    }),
    ambient: Object.freeze({
      color: ambientColor,
      intensity: normalizedF32(value.ambient.intensity),
    }),
    lights: Object.freeze(lights),
  });
}

function recipePayload(
  value: Omit<StudioMultiLightSurfaceRecipe, "fingerprint">,
) {
  return {
    kind: value.kind,
    version: value.version,
    colorContract: value.colorContract,
    alphaContract: value.alphaContract,
    height: value.height,
    normal: value.normal,
    material: value.material,
    ambient: value.ambient,
    lights: value.lights,
  };
}

function buildRecipe(
  normalized: NonNullable<ReturnType<typeof normalizeRecipeInput>>,
): StudioMultiLightSurfaceRecipe {
  const withoutFingerprint = Object.freeze({
    kind: "studio-multi-light-surface-recipe" as const,
    version: STUDIO_MULTI_LIGHT_SURFACE_RECIPE_VERSION,
    colorContract: STUDIO_MULTI_LIGHT_SURFACE_COLOR_CONTRACT,
    alphaContract: STUDIO_MULTI_LIGHT_SURFACE_ALPHA_CONTRACT,
    ...normalized,
  });
  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: hashJson(recipePayload(withoutFingerprint)),
  });
}

export function createStudioMultiLightSurfaceRecipe(
  value: unknown,
): StudioMultiLightSurfaceRecipeCreationResult {
  const normalized = normalizeRecipeInput(value);
  return normalized
    ? Object.freeze({ status: "ready", recipe: buildRecipe(normalized) })
    : Object.freeze({
        status: "rejected",
        reason: "invalid-recipe",
        path: "$",
      });
}

export function parseStudioMultiLightSurfaceRecipe(
  value: unknown,
): StudioMultiLightSurfaceRecipe | null {
  let candidate: unknown = value;
  if (typeof value === "string") {
    if (
      value.length
      > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumRecipeJsonCodeUnits
    ) return null;
    try {
      candidate = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (
    !exactKeys(candidate, RECIPE_KEYS)
    || candidate.kind !== "studio-multi-light-surface-recipe"
    || candidate.version !== STUDIO_MULTI_LIGHT_SURFACE_RECIPE_VERSION
    || candidate.colorContract !== STUDIO_MULTI_LIGHT_SURFACE_COLOR_CONTRACT
    || candidate.alphaContract !== STUDIO_MULTI_LIGHT_SURFACE_ALPHA_CONTRACT
    || typeof candidate.fingerprint !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(candidate.fingerprint)
  ) return null;
  const normalized = normalizeRecipeInput({
    height: candidate.height,
    normal: candidate.normal,
    material: candidate.material,
    ambient: candidate.ambient,
    lights: candidate.lights,
  });
  if (!normalized) return null;
  const recipe = buildRecipe(normalized);
  return recipe.fingerprint === candidate.fingerprint ? recipe : null;
}

export function serializeStudioMultiLightSurfaceRecipe(
  value: StudioMultiLightSurfaceRecipe,
): string | null {
  const recipe = parseStudioMultiLightSurfaceRecipe(value);
  return recipe ? JSON.stringify(recipe) : null;
}

function imageShapeValid(value: unknown): value is StudioMultiLightSurfaceImage {
  if (
    !exactKeys(value, IMAGE_KEYS)
    || value.kind !== "studio-multi-light-surface-image"
    || value.version !== STUDIO_MULTI_LIGHT_SURFACE_RESOURCE_VERSION
    || value.colorContract !== STUDIO_MULTI_LIGHT_SURFACE_COLOR_CONTRACT
    || !positiveSafeInteger(value.width)
    || !positiveSafeInteger(value.height)
    || value.width > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumDimension
    || value.height > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumDimension
    || !(value.data instanceof Float32Array)
  ) return false;
  const pixels = value.width * value.height;
  return Number.isSafeInteger(pixels)
    && pixels <= STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumPixels
    && value.data.length === pixels * RGBA_CHANNELS;
}

function scalarMapShapeValid(
  value: unknown,
  semantic: StudioMultiLightSurfaceScalarSemantic,
): value is StudioMultiLightSurfaceScalarMap {
  if (
    !exactKeys(value, SCALAR_MAP_KEYS)
    || value.kind !== "studio-multi-light-surface-scalar-map"
    || value.version !== STUDIO_MULTI_LIGHT_SURFACE_RESOURCE_VERSION
    || value.semantic !== semantic
    || !positiveSafeInteger(value.width)
    || !positiveSafeInteger(value.height)
    || value.width > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumDimension
    || value.height > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumDimension
    || !(value.data instanceof Float32Array)
  ) return false;
  const pixels = value.width * value.height;
  return Number.isSafeInteger(pixels)
    && pixels <= STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumPixels
    && value.data.length === pixels;
}

function normalMapShapeValid(
  value: unknown,
): value is StudioMultiLightSurfaceNormalMap {
  if (
    !exactKeys(value, NORMAL_MAP_KEYS)
    || value.kind !== "studio-multi-light-surface-normal-map"
    || value.version !== STUDIO_MULTI_LIGHT_SURFACE_RESOURCE_VERSION
    || value.space !== "surface"
    || !positiveSafeInteger(value.width)
    || !positiveSafeInteger(value.height)
    || value.width > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumDimension
    || value.height > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumDimension
    || !(value.data instanceof Float32Array)
  ) return false;
  const pixels = value.width * value.height;
  return Number.isSafeInteger(pixels)
    && pixels <= STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumPixels
    && value.data.length === pixels * NORMAL_CHANNELS;
}

function validateImageValues(
  image: StudioMultiLightSurfaceImage,
  path: string,
): void {
  for (let index = 0; index < image.data.length; index += RGBA_CHANNELS) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = image.data[index + channel]!;
      if (
        !Number.isFinite(value)
        || value < 0
        || value > MAX_RGBA16F_VALUE
      ) {
        throw new StudioMultiLightSurfaceError(
          "invalid-image",
          `${path} has a non-finite or out-of-range RGB component.`,
          `${path}.data[${index + channel}]`,
        );
      }
    }
    const alpha = image.data[index + 3]!;
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new StudioMultiLightSurfaceError(
        "invalid-image",
        `${path} has an invalid alpha component.`,
        `${path}.data[${index + 3}]`,
      );
    }
  }
}

function validateScalarMapValues(
  map: StudioMultiLightSurfaceScalarMap,
  path: string,
): void {
  const minimum = map.semantic === "signed-height"
    ? -STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumHeightMagnitude
    : 0;
  const maximum = map.semantic === "signed-height"
    ? STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumHeightMagnitude
    : 1;
  for (let index = 0; index < map.data.length; index += 1) {
    const value = map.data[index]!;
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new StudioMultiLightSurfaceError(
        "invalid-map",
        `${path} contains a non-finite or out-of-range scalar.`,
        `${path}.data[${index}]`,
      );
    }
  }
}

function validateNormalMapValues(
  map: StudioMultiLightSurfaceNormalMap,
  path: string,
): void {
  for (let index = 0; index < map.data.length; index += NORMAL_CHANNELS) {
    const x = map.data[index]!;
    const y = map.data[index + 1]!;
    const z = map.data[index + 2]!;
    const length = Math.hypot(x, y, z);
    if (
      !Number.isFinite(length)
      || length <= 1e-6
      || x < -1
      || x > 1
      || y < -1
      || y > 1
      || z < -1
      || z > 1
    ) {
      throw new StudioMultiLightSurfaceError(
        "invalid-map",
        `${path} contains an invalid surface-space normal.`,
        `${path}.data[${index}]`,
      );
    }
  }
}

function normalizeBudgets(
  value: unknown,
  keys: readonly string[],
): NormalizedBudgets | null {
  if (!exactKeys(value, keys, [])) return null;
  const maximumPixels = value.maximumPixels
    ?? STUDIO_MULTI_LIGHT_SURFACE_DEFAULT_BUDGETS.maximumPixels;
  const maximumResidentBytes = value.maximumResidentBytes
    ?? STUDIO_MULTI_LIGHT_SURFACE_DEFAULT_BUDGETS.maximumResidentBytes;
  const maximumWorkUnits = value.maximumWorkUnits
    ?? STUDIO_MULTI_LIGHT_SURFACE_DEFAULT_BUDGETS.maximumWorkUnits;
  const maximumLights = value.maximumLights
    ?? STUDIO_MULTI_LIGHT_SURFACE_DEFAULT_BUDGETS.maximumLights;
  const tileEdge = value.tileEdge
    ?? STUDIO_MULTI_LIGHT_SURFACE_DEFAULT_BUDGETS.tileEdge;
  const maximumTiles = value.maximumTiles
    ?? STUDIO_MULTI_LIGHT_SURFACE_DEFAULT_BUDGETS.maximumTiles;
  if (
    !positiveSafeInteger(maximumPixels)
    || maximumPixels > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumPixels
    || !positiveSafeInteger(maximumResidentBytes)
    || maximumResidentBytes
      > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumResidentBytes
    || !positiveSafeInteger(maximumWorkUnits)
    || maximumWorkUnits
      > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumWorkUnits
    || !positiveSafeInteger(maximumLights)
    || maximumLights > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumLights
    || !positiveSafeInteger(tileEdge)
    || tileEdge > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumTileEdge
    || !positiveSafeInteger(maximumTiles)
    || maximumTiles > STUDIO_MULTI_LIGHT_SURFACE_HARD_LIMITS.maximumTiles
  ) return null;
  return Object.freeze({
    maximumPixels,
    maximumResidentBytes,
    maximumWorkUnits,
    maximumLights,
    tileEdge,
    maximumTiles,
  });
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== "undefined" && value instanceof AbortSignal;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new StudioMultiLightSurfaceError(
      "aborted",
      "Multi-light surface rendering was aborted.",
    );
  }
}

function expectMap(
  required: boolean,
  value: unknown,
  semantic: StudioMultiLightSurfaceScalarSemantic,
  path: string,
): StudioMultiLightSurfaceScalarMap | undefined {
  if (!required) {
    if (value !== undefined) {
      throw new StudioMultiLightSurfaceError(
        "map-not-allowed",
        `${path} is not used by this recipe.`,
        path,
      );
    }
    return undefined;
  }
  if (!scalarMapShapeValid(value, semantic)) {
    throw new StudioMultiLightSurfaceError(
      "map-required",
      `${path} is required and must have ${semantic} semantics.`,
      path,
    );
  }
  return value;
}

function prepareExecution(
  input: StudioMultiLightSurfaceCpuOracleInput,
  options: StudioMultiLightSurfaceCpuOracleOptions,
): PreparedExecution {
  if (!exactKeys(input, CPU_INPUT_KEYS, ["recipe", "source"])) {
    throw new StudioMultiLightSurfaceError(
      "invalid-request",
      "CPU oracle input contains missing or unknown fields.",
      "$",
    );
  }
  const recipe = parseStudioMultiLightSurfaceRecipe(input.recipe);
  if (!recipe) {
    throw new StudioMultiLightSurfaceError(
      "invalid-recipe",
      "Recipe is invalid or its fingerprint does not match.",
      "$.recipe",
    );
  }
  if (!imageShapeValid(input.source)) {
    throw new StudioMultiLightSurfaceError(
      "invalid-image",
      "Source must be a bounded scene-linear RGBA Float32 image.",
      "$.source",
    );
  }
  if (!exactKeys(options, CPU_OPTION_KEYS, [])) {
    throw new StudioMultiLightSurfaceError(
      "invalid-request",
      "CPU oracle options contain unknown fields.",
      "$.options",
    );
  }
  if (options.signal !== undefined && !isAbortSignal(options.signal)) {
    throw new StudioMultiLightSurfaceError(
      "invalid-request",
      "signal must be a native AbortSignal.",
      "$.options.signal",
    );
  }
  const budgets = normalizeBudgets(options, CPU_OPTION_KEYS);
  if (!budgets) {
    throw new StudioMultiLightSurfaceError(
      "invalid-request",
      "CPU oracle budgets are invalid.",
      "$.options",
    );
  }
  const heightMap = expectMap(
    recipe.height.source === "separate",
    input.heightMap,
    "signed-height",
    "$.heightMap",
  );
  const roughnessMap = expectMap(
    recipe.material.roughness.source === "map",
    input.roughnessMap,
    "roughness",
    "$.roughnessMap",
  );
  const metalnessMap = expectMap(
    recipe.material.metalness.source === "map",
    input.metalnessMap,
    "metalness",
    "$.metalnessMap",
  );
  let normalMap: StudioMultiLightSurfaceNormalMap | undefined;
  if (recipe.normal.source === "height-and-map") {
    if (!normalMapShapeValid(input.normalMap)) {
      throw new StudioMultiLightSurfaceError(
        "map-required",
        "A surface-space normal map is required by this recipe.",
        "$.normalMap",
      );
    }
    normalMap = input.normalMap;
  } else if (input.normalMap !== undefined) {
    throw new StudioMultiLightSurfaceError(
      "map-not-allowed",
      "This recipe does not use a normal map.",
      "$.normalMap",
    );
  }
  throwIfAborted(options.signal);
  validateImageValues(input.source, "$.source");
  if (heightMap) validateScalarMapValues(heightMap, "$.heightMap");
  if (roughnessMap) validateScalarMapValues(roughnessMap, "$.roughnessMap");
  if (metalnessMap) validateScalarMapValues(metalnessMap, "$.metalnessMap");
  if (normalMap) validateNormalMapValues(normalMap, "$.normalMap");
  const pixels = input.source.width * input.source.height;
  const outputBytes = pixels * RGBA_CHANNELS * FLOAT32_BYTES;
  const residentBytes = input.source.data.byteLength
    + outputBytes
    + (heightMap?.data.byteLength ?? 0)
    + (roughnessMap?.data.byteLength ?? 0)
    + (metalnessMap?.data.byteLength ?? 0)
    + (normalMap?.data.byteLength ?? 0);
  const workUnits = pixels * (recipe.lights.length + 8);
  const tileColumns = Math.ceil(input.source.width / budgets.tileEdge);
  const tileRows = Math.ceil(input.source.height / budgets.tileEdge);
  const tileCount = tileColumns * tileRows;
  if (
    pixels > budgets.maximumPixels
    || residentBytes > budgets.maximumResidentBytes
    || workUnits > budgets.maximumWorkUnits
    || recipe.lights.length > budgets.maximumLights
    || tileCount > budgets.maximumTiles
  ) {
    throw new StudioMultiLightSurfaceError(
      "budget-exceeded",
      "Execution exceeds its pixel, memory, work, light, or tile budget.",
      "$.budget",
    );
  }
  const evaluationLights = Object.freeze(
    [...recipe.lights].sort((left, right) => (
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    )),
  );
  return Object.freeze({
    recipe,
    source: input.source,
    ...(heightMap === undefined ? {} : { heightMap }),
    ...(roughnessMap === undefined ? {} : { roughnessMap }),
    ...(metalnessMap === undefined ? {} : { metalnessMap }),
    ...(normalMap === undefined ? {} : { normalMap }),
    evaluationLights,
    budgets,
    tileCount,
    workUnits,
    residentBytes,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function bilinearScalar(
  data: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  channels: number,
  channel: number,
): number {
  const x0 = Math.floor(clamp(x, 0, width - 1));
  const y0 = Math.floor(clamp(y, 0, height - 1));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const amountX = clamp(x, 0, width - 1) - x0;
  const amountY = clamp(y, 0, height - 1) - y0;
  const top = data[(y0 * width + x0) * channels + channel]! * (1 - amountX)
    + data[(y0 * width + x1) * channels + channel]! * amountX;
  const bottom = data[(y1 * width + x0) * channels + channel]! * (1 - amountX)
    + data[(y1 * width + x1) * channels + channel]! * amountX;
  return top * (1 - amountY) + bottom * amountY;
}

function sourceChannel(
  source: StudioMultiLightSurfaceImage,
  x: number,
  y: number,
  channel: StudioMultiLightSurfaceHeightChannel,
): number {
  if (channel === "red") {
    return bilinearScalar(source.data, source.width, source.height, x, y, 4, 0);
  }
  if (channel === "green") {
    return bilinearScalar(source.data, source.width, source.height, x, y, 4, 1);
  }
  if (channel === "blue") {
    return bilinearScalar(source.data, source.width, source.height, x, y, 4, 2);
  }
  if (channel === "alpha") {
    return bilinearScalar(source.data, source.width, source.height, x, y, 4, 3);
  }
  return bilinearScalar(source.data, source.width, source.height, x, y, 4, 0)
      * 0.2126
    + bilinearScalar(source.data, source.width, source.height, x, y, 4, 1)
      * 0.7152
    + bilinearScalar(source.data, source.width, source.height, x, y, 4, 2)
      * 0.0722;
}

function mapCoordinate(
  coordinate: number,
  sourceSize: number,
  mapSize: number,
): number {
  return ((coordinate + 0.5) / sourceSize) * mapSize - 0.5;
}

function sampleScalarMap(
  map: StudioMultiLightSurfaceScalarMap,
  source: StudioMultiLightSurfaceImage,
  x: number,
  y: number,
): number {
  return bilinearScalar(
    map.data,
    map.width,
    map.height,
    mapCoordinate(x, source.width, map.width),
    mapCoordinate(y, source.height, map.height),
    1,
    0,
  );
}

function sampleHeight(
  execution: PreparedExecution,
  x: number,
  y: number,
): number {
  const height = execution.recipe.height;
  if (height.source === "separate") {
    return sampleScalarMap(execution.heightMap!, execution.source, x, y);
  }
  return sourceChannel(execution.source, x, y, height.channel)
    - height.midpoint;
}

function sampleMaterialScalar(
  field: StudioMultiLightSurfaceScalarMaterial,
  map: StudioMultiLightSurfaceScalarMap | undefined,
  execution: PreparedExecution,
  x: number,
  y: number,
): number {
  if (field.source === "constant") return field.value;
  return clamp(sampleScalarMap(map!, execution.source, x, y), 0, 1);
}

type Vec3 = readonly [number, number, number];

function normalize3(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length <= 1e-12) return [0, 0, 1];
  return [x / length, y / length, z / length];
}

function sampleNormalMap(
  map: StudioMultiLightSurfaceNormalMap,
  source: StudioMultiLightSurfaceImage,
  x: number,
  y: number,
): Vec3 {
  const mapX = mapCoordinate(x, source.width, map.width);
  const mapY = mapCoordinate(y, source.height, map.height);
  return normalize3(
    bilinearScalar(map.data, map.width, map.height, mapX, mapY, 3, 0),
    bilinearScalar(map.data, map.width, map.height, mapX, mapY, 3, 1),
    bilinearScalar(map.data, map.width, map.height, mapX, mapY, 3, 2),
  );
}

function surfaceNormal(
  execution: PreparedExecution,
  x: number,
  y: number,
): Vec3 {
  const scale = execution.recipe.height.scale;
  const gradientX = (
    sampleHeight(execution, x + 1, y)
    - sampleHeight(execution, x - 1, y)
  ) * 0.5 * scale;
  const gradientY = (
    sampleHeight(execution, x, y + 1)
    - sampleHeight(execution, x, y - 1)
  ) * 0.5 * scale;
  const fromHeight = normalize3(-gradientX, -gradientY, 1);
  if (
    execution.recipe.normal.source === "height"
    || !execution.normalMap
  ) return fromHeight;
  const mapped = sampleNormalMap(
    execution.normalMap,
    execution.source,
    x,
    y,
  );
  const amount = execution.recipe.normal.strength;
  return normalize3(
    fromHeight[0] * (1 - amount) + mapped[0] * amount,
    fromHeight[1] * (1 - amount) + mapped[1] * amount,
    fromHeight[2] * (1 - amount) + mapped[2] * amount,
  );
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function distanceAttenuation(
  distance: number,
  attenuation: StudioMultiLightSurfaceAttenuation,
): number {
  if (distance >= attenuation.range) return 0;
  const rangeFade = 1 - smoothstep(
    attenuation.range * 0.75,
    attenuation.range,
    distance,
  );
  if (attenuation.kind === "smooth-range") {
    const normalizedDistance = distance / attenuation.range;
    const smooth = Math.max(0, 1 - normalizedDistance * normalizedDistance);
    return smooth * smooth * rangeFade;
  }
  const boundedDistance = Math.max(distance, attenuation.minimumDistance);
  return rangeFade / (boundedDistance * boundedDistance);
}

interface LightSample {
  readonly direction: Vec3;
  readonly radiance: Vec3;
}

function sampleLight(
  light: StudioMultiLightSurfaceLight,
  x: number,
  y: number,
  z: number,
): LightSample {
  if (light.kind === "directional") {
    return {
      direction: light.direction,
      radiance: [
        light.color[0] * light.intensity,
        light.color[1] * light.intensity,
        light.color[2] * light.intensity,
      ],
    };
  }
  const deltaX = light.position[0] - x;
  const deltaY = light.position[1] - y;
  const deltaZ = light.position[2] - z;
  const distance = Math.hypot(deltaX, deltaY, deltaZ);
  if (!Number.isFinite(distance) || distance <= 1e-12) {
    return { direction: [0, 0, 1], radiance: [0, 0, 0] };
  }
  const direction = normalize3(deltaX, deltaY, deltaZ);
  let attenuation = distanceAttenuation(distance, light.attenuation);
  if (light.kind === "spot" && attenuation > 0) {
    const fromLightToSurface: Vec3 = [
      -direction[0],
      -direction[1],
      -direction[2],
    ];
    const coneCosine = fromLightToSurface[0] * light.direction[0]
      + fromLightToSurface[1] * light.direction[1]
      + fromLightToSurface[2] * light.direction[2];
    const cosineInner = Math.cos(light.innerConeDegrees * Math.PI / 180);
    const cosineOuter = Math.cos(light.outerConeDegrees * Math.PI / 180);
    attenuation *= smoothstep(cosineOuter, cosineInner, coneCosine);
  }
  const strength = light.intensity * attenuation;
  return {
    direction,
    radiance: [
      light.color[0] * strength,
      light.color[1] * strength,
      light.color[2] * strength,
    ],
  };
}

function schlickFresnel(baseReflectance: number, viewDotHalf: number): number {
  return baseReflectance
    + (1 - baseReflectance) * Math.pow(1 - viewDotHalf, 5);
}

function lightResponse(
  light: StudioMultiLightSurfaceLight,
  normal: Vec3,
  x: number,
  y: number,
  z: number,
  albedo: Vec3,
  roughness: number,
  metalness: number,
  diffuseStrength: number,
  specularStrength: number,
): Vec3 {
  const sampled = sampleLight(light, x, y, z);
  const normalDotLight = Math.max(
    0,
    normal[0] * sampled.direction[0]
      + normal[1] * sampled.direction[1]
      + normal[2] * sampled.direction[2],
  );
  if (normalDotLight <= 0) return [0, 0, 0];
  const half = normalize3(
    sampled.direction[0],
    sampled.direction[1],
    sampled.direction[2] + 1,
  );
  const normalDotHalf = Math.max(
    0,
    normal[0] * half[0] + normal[1] * half[1] + normal[2] * half[2],
  );
  const viewDotHalf = Math.max(0, half[2]);
  const safeRoughness = Math.max(0.02, roughness);
  const exponent = Math.min(
    2_048,
    Math.max(1, 2 / (safeRoughness * safeRoughness) - 2),
  );
  const normalizedLobe = (exponent + 2) / (2 * Math.PI)
    * Math.pow(normalDotHalf, exponent)
    * normalDotLight;
  const boundedLobe = Math.min(normalDotLight, normalizedLobe);
  const result: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    const boundedAlbedo = clamp(albedo[channel]!, 0, 1);
    const dielectricReflectance = 0.04 * specularStrength;
    const baseReflectance = dielectricReflectance * (1 - metalness)
      + boundedAlbedo * metalness;
    const fresnel = clamp(
      schlickFresnel(baseReflectance, viewDotHalf),
      0,
      1,
    );
    const diffuse = boundedAlbedo
      * diffuseStrength
      * (1 - metalness)
      * (1 - fresnel)
      * normalDotLight;
    const specular = fresnel * boundedLobe * specularStrength;
    result[channel] = sampled.radiance[channel]! * (diffuse + specular);
  }
  return result;
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

function resourceHash(data: Float32Array): `sha256:${string}` {
  return hashBytes(float32BytesLittleEndian(data));
}

export function renderStudioMultiLightSurfaceCpuOracle(
  input: StudioMultiLightSurfaceCpuOracleInput,
  options: StudioMultiLightSurfaceCpuOracleOptions = {},
): StudioMultiLightSurfaceCpuOracleResult {
  const execution = prepareExecution(input, options);
  throwIfAborted(execution.signal);
  let outputData: Float32Array;
  try {
    outputData = new Float32Array(execution.source.data.length);
  } catch (error) {
    throw new StudioMultiLightSurfaceError(
      "runtime-failed",
      "Could not allocate the multi-light surface output.",
      "$.output",
      { cause: error },
    );
  }
  const tileEdge = execution.budgets.tileEdge;
  for (let tileY = 0; tileY < execution.source.height; tileY += tileEdge) {
    const endY = Math.min(execution.source.height, tileY + tileEdge);
    for (let tileX = 0; tileX < execution.source.width; tileX += tileEdge) {
      throwIfAborted(execution.signal);
      const endX = Math.min(execution.source.width, tileX + tileEdge);
      for (let y = tileY; y < endY; y += 1) {
        throwIfAborted(execution.signal);
        for (let x = tileX; x < endX; x += 1) {
          const offset = (y * execution.source.width + x) * RGBA_CHANNELS;
          const alpha = execution.source.data[offset + 3]!;
          const albedo: Vec3 = [
            execution.source.data[offset]!
              * execution.recipe.material.tint[0],
            execution.source.data[offset + 1]!
              * execution.recipe.material.tint[1],
            execution.source.data[offset + 2]!
              * execution.recipe.material.tint[2],
          ];
          const normal = surfaceNormal(execution, x, y);
          const height = sampleHeight(execution, x, y)
            * execution.recipe.height.scale;
          const roughness = sampleMaterialScalar(
            execution.recipe.material.roughness,
            execution.roughnessMap,
            execution,
            x,
            y,
          );
          const metalness = sampleMaterialScalar(
            execution.recipe.material.metalness,
            execution.metalnessMap,
            execution,
            x,
            y,
          );
          const accumulated: [number, number, number] = [
            albedo[0]
              * execution.recipe.ambient.color[0]
              * execution.recipe.ambient.intensity,
            albedo[1]
              * execution.recipe.ambient.color[1]
              * execution.recipe.ambient.intensity,
            albedo[2]
              * execution.recipe.ambient.color[2]
              * execution.recipe.ambient.intensity,
          ];
          for (const light of execution.evaluationLights) {
            const response = lightResponse(
              light,
              normal,
              x,
              y,
              height,
              albedo,
              roughness,
              metalness,
              execution.recipe.material.diffuseStrength,
              execution.recipe.material.specularStrength,
            );
            accumulated[0] += response[0];
            accumulated[1] += response[1];
            accumulated[2] += response[2];
          }
          outputData[offset] = normalizedF32(
            clamp(accumulated[0], 0, MAX_RGBA16F_VALUE),
          );
          outputData[offset + 1] = normalizedF32(
            clamp(accumulated[1], 0, MAX_RGBA16F_VALUE),
          );
          outputData[offset + 2] = normalizedF32(
            clamp(accumulated[2], 0, MAX_RGBA16F_VALUE),
          );
          outputData[offset + 3] = alpha;
        }
      }
    }
  }
  throwIfAborted(execution.signal);
  const image: StudioMultiLightSurfaceImage = Object.freeze({
    kind: "studio-multi-light-surface-image",
    version: STUDIO_MULTI_LIGHT_SURFACE_RESOURCE_VERSION,
    width: execution.source.width,
    height: execution.source.height,
    colorContract: STUDIO_MULTI_LIGHT_SURFACE_COLOR_CONTRACT,
    data: outputData,
  });
  const receipt: StudioMultiLightSurfaceCpuOracleReceipt = Object.freeze({
    kind: "studio-multi-light-surface-cpu-oracle-receipt",
    version: STUDIO_MULTI_LIGHT_SURFACE_RECEIPT_VERSION,
    backend: "cpu-typed-array",
    executionModel: "deterministic-tiled-canonical-light-order",
    colorContract: STUDIO_MULTI_LIGHT_SURFACE_COLOR_CONTRACT,
    alphaContract: STUDIO_MULTI_LIGHT_SURFACE_ALPHA_CONTRACT,
    recipeFingerprint: execution.recipe.fingerprint,
    sourceHash: resourceHash(execution.source.data),
    heightMapHash: execution.heightMap
      ? resourceHash(execution.heightMap.data)
      : null,
    roughnessMapHash: execution.roughnessMap
      ? resourceHash(execution.roughnessMap.data)
      : null,
    metalnessMapHash: execution.metalnessMap
      ? resourceHash(execution.metalnessMap.data)
      : null,
    normalMapHash: execution.normalMap
      ? resourceHash(execution.normalMap.data)
      : null,
    outputHash: resourceHash(outputData),
    sourceSize: Object.freeze([
      execution.source.width,
      execution.source.height,
    ] as const),
    rigOrder: Object.freeze(execution.recipe.lights.map((light) => light.id)),
    evaluationOrder: Object.freeze(
      execution.evaluationLights.map((light) => light.id),
    ),
    lightCount: execution.recipe.lights.length,
    tileEdge,
    tileCount: execution.tileCount,
    haloPixels: 1,
    workUnits: execution.workUnits,
    residentBytes: execution.residentBytes,
    complete: true,
  });
  return Object.freeze({ image, receipt });
}

function receiptHash(
  requestSequence: number,
  deviceEpoch: number,
  oracle: StudioMultiLightSurfaceCpuOracleReceipt,
): `sha256:${string}` {
  return hashJson({
    kind: "studio-multi-light-surface-receipt",
    version: STUDIO_MULTI_LIGHT_SURFACE_RECEIPT_VERSION,
    providerRevision: STUDIO_MULTI_LIGHT_SURFACE_PROVIDER_REVISION,
    requestSequence,
    deviceEpoch,
    recipeFingerprint: oracle.recipeFingerprint,
    sourceHash: oracle.sourceHash,
    heightMapHash: oracle.heightMapHash,
    roughnessMapHash: oracle.roughnessMapHash,
    metalnessMapHash: oracle.metalnessMapHash,
    normalMapHash: oracle.normalMapHash,
    outputHash: oracle.outputHash,
    rigOrder: oracle.rigOrder,
    evaluationOrder: oracle.evaluationOrder,
    lightCount: oracle.lightCount,
    tileEdge: oracle.tileEdge,
    tileCount: oracle.tileCount,
    haloPixels: oracle.haloPixels,
    workUnits: oracle.workUnits,
    residentBytes: oracle.residentBytes,
  });
}

export class StudioMultiLightSurfaceProvider {
  #deviceEpoch: number;
  #lastRequestSequence = 0;
  #disposed = false;
  #operationReserved = false;

  public constructor(
    initialDeviceEpoch: number,
    readonly budgets: NormalizedBudgets,
  ) {
    this.#deviceEpoch = initialDeviceEpoch;
  }

  public async execute(
    request: StudioMultiLightSurfaceRequest,
  ): Promise<StudioMultiLightSurfaceReceipt> {
    if (this.#disposed) {
      throw new StudioMultiLightSurfaceError(
        "disposed",
        "Multi-light surface provider is disposed.",
      );
    }
    if (this.#operationReserved) {
      throw new StudioMultiLightSurfaceError(
        "runtime-failed",
        "Multi-light surface provider already has an admitted operation.",
      );
    }
    this.#operationReserved = true;
    try {
      if (
        !exactKeys(
          request,
          REQUEST_KEYS,
          ["requestSequence", "deviceEpoch", "recipe", "source"],
        )
      ) {
        throw new StudioMultiLightSurfaceError(
          "invalid-request",
          "Multi-light surface request is malformed.",
          "$",
        );
      }
      const requestSequence = request.requestSequence;
      const deviceEpoch = request.deviceEpoch;
      const signal = request.signal;
      if (
        !positiveSafeInteger(requestSequence)
        || !positiveSafeInteger(deviceEpoch)
        || (signal !== undefined && !isAbortSignal(signal))
      ) {
        throw new StudioMultiLightSurfaceError(
          "invalid-request",
          "Multi-light surface request is malformed.",
          "$",
        );
      }
      if (deviceEpoch !== this.#deviceEpoch) {
        throw new StudioMultiLightSurfaceError(
          "device-epoch",
          "Request belongs to a stale device epoch.",
          "$.deviceEpoch",
        );
      }
      if (requestSequence <= this.#lastRequestSequence) {
        throw new StudioMultiLightSurfaceError(
          "request-sequence",
          "Request sequence must increase monotonically.",
          "$.requestSequence",
        );
      }
      throwIfAborted(signal);
      const input: StudioMultiLightSurfaceCpuOracleInput = {
        recipe: request.recipe,
        source: request.source,
        ...(request.heightMap === undefined
          ? {}
          : { heightMap: request.heightMap }),
        ...(request.roughnessMap === undefined
          ? {}
          : { roughnessMap: request.roughnessMap }),
        ...(request.metalnessMap === undefined
          ? {}
          : { metalnessMap: request.metalnessMap }),
        ...(request.normalMap === undefined
          ? {}
          : { normalMap: request.normalMap }),
      };
      const executionOptions = {
        ...this.budgets,
        ...(signal === undefined ? {} : { signal }),
      };
      prepareExecution(input, executionOptions);
      throwIfAborted(signal);
      if (this.#disposed) {
        throw new StudioMultiLightSurfaceError(
          "disposed",
          "Multi-light surface provider was disposed during preflight.",
        );
      }
      if (deviceEpoch !== this.#deviceEpoch) {
        throw new StudioMultiLightSurfaceError(
          "device-epoch",
          "Multi-light surface provider epoch changed during preflight.",
          "$.deviceEpoch",
        );
      }
      if (requestSequence <= this.#lastRequestSequence) {
        throw new StudioMultiLightSurfaceError(
          "request-sequence",
          "Multi-light surface request was superseded during preflight.",
          "$.requestSequence",
        );
      }
      const oracle = renderStudioMultiLightSurfaceCpuOracle(
        input,
        executionOptions,
      );
      const receipt = Object.freeze({
        kind: "studio-multi-light-surface-receipt" as const,
        version: STUDIO_MULTI_LIGHT_SURFACE_RECEIPT_VERSION,
        providerRevision: STUDIO_MULTI_LIGHT_SURFACE_PROVIDER_REVISION,
        requestSequence,
        deviceEpoch,
        recipeFingerprint: oracle.receipt.recipeFingerprint,
        output: oracle.image,
        oracle: oracle.receipt,
        receiptHash: receiptHash(
          requestSequence,
          deviceEpoch,
          oracle.receipt,
        ),
        complete: true as const,
      });
      throwIfAborted(signal);
      if (this.#disposed) {
        throw new StudioMultiLightSurfaceError(
          "disposed",
          "Multi-light surface provider was disposed before commit.",
        );
      }
      if (deviceEpoch !== this.#deviceEpoch) {
        throw new StudioMultiLightSurfaceError(
          "device-epoch",
          "Multi-light surface provider epoch changed before commit.",
          "$.deviceEpoch",
        );
      }
      if (requestSequence <= this.#lastRequestSequence) {
        throw new StudioMultiLightSurfaceError(
          "request-sequence",
          "Multi-light surface request was superseded before commit.",
          "$.requestSequence",
        );
      }
      this.#lastRequestSequence = requestSequence;
      return receipt;
    } finally {
      this.#operationReserved = false;
    }
  }

  public advanceDeviceEpoch(): number {
    if (this.#disposed) return this.#deviceEpoch;
    if (this.#deviceEpoch >= Number.MAX_SAFE_INTEGER) {
      throw new StudioMultiLightSurfaceError(
        "runtime-failed",
        "Multi-light surface device epoch is exhausted.",
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

export function createStudioMultiLightSurfaceProvider(
  value: StudioMultiLightSurfaceProviderOptions = {},
): StudioMultiLightSurfaceProviderCreationResult {
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
    provider: new StudioMultiLightSurfaceProvider(initialDeviceEpoch, budgets),
  });
}

export function isStudioMultiLightSurfaceContentHash(
  value: unknown,
): value is `sha256:${string}` {
  return typeof value === "string"
    && /^sha256:[0-9a-f]{64}$/u.test(value)
    && value !== ZERO_HASH;
}
