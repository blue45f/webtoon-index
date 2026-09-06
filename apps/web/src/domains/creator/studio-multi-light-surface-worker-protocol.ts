import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioMultiLightSurfaceErrorCode,
  StudioMultiLightSurfaceImage,
  StudioMultiLightSurfaceNormalMap,
  StudioMultiLightSurfaceReceipt,
  StudioMultiLightSurfaceRecipe,
  StudioMultiLightSurfaceRequest,
  StudioMultiLightSurfaceScalarMap,
} from "./studio-multi-light-surface-provider";

export const STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION = 1 as const;

const MEBIBYTE = 1_048_576;
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;

export const STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS = Object.freeze({
  maximumDimension: 16_384,
  maximumPixels: 4_194_304,
  maximumInputBytes: 128 * MEBIBYTE,
  maximumOutputBytes: 64 * MEBIBYTE,
  maximumResidentBytes: 192 * MEBIBYTE,
  maximumWorkUnits: 200_000_000,
  maximumLights: 32,
  maximumFailureDetailCharacters: 512,
  tileEdge: 256,
  maximumTiles: 262_144,
} as const);

export type StudioMultiLightSurfaceWorkerRequest = Omit<
  StudioMultiLightSurfaceRequest,
  "signal"
>;

export type StudioMultiLightSurfaceWorkerBoundaryFailureReason =
  | "backpressure"
  | "disposed"
  | "execution-failed"
  | "invalid-message"
  | "operation-timeout"
  | "protocol-error"
  | "startup-timeout"
  | "worker-unavailable";

export interface StudioMultiLightSurfaceWorkerOnlyReceipt {
  readonly kind: "studio-multi-light-surface-worker-only-receipt";
  readonly execution: "dedicated-worker";
  readonly mainThreadComputationFallback: false;
  readonly complete: false;
  readonly reason: StudioMultiLightSurfaceWorkerBoundaryFailureReason;
}

export interface StudioMultiLightSurfaceWorkerBoundaryFailure {
  readonly status: "worker-failed";
  readonly reason: StudioMultiLightSurfaceWorkerBoundaryFailureReason;
  readonly detail: string;
  readonly fallback: StudioMultiLightSurfaceWorkerOnlyReceipt;
}

export interface StudioMultiLightSurfaceWorkerCompleted {
  readonly status: "completed";
  readonly receipt: StudioMultiLightSurfaceReceipt;
}

export interface StudioMultiLightSurfaceWorkerRejected {
  readonly status: "rejected";
  readonly code: StudioMultiLightSurfaceErrorCode;
  readonly detail: string;
  readonly path?: string;
}

export interface StudioMultiLightSurfaceWorkerCancelled {
  readonly status: "cancelled";
}

export type StudioMultiLightSurfaceWorkerResult =
  | StudioMultiLightSurfaceWorkerCompleted
  | StudioMultiLightSurfaceWorkerRejected
  | StudioMultiLightSurfaceWorkerCancelled
  | StudioMultiLightSurfaceWorkerBoundaryFailure;

export interface StudioMultiLightSurfaceWorkerExecuteMessage {
  readonly type: "studio-multi-light-surface/execute";
  readonly version: typeof STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly request: StudioMultiLightSurfaceWorkerRequest;
}

export interface StudioMultiLightSurfaceWorkerCancelMessage {
  readonly type: "studio-multi-light-surface/cancel";
  readonly version: typeof STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
}

export interface StudioMultiLightSurfaceWorkerAdvanceEpochMessage {
  readonly type: "studio-multi-light-surface/advance-epoch";
  readonly version: typeof STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION;
  readonly currentEpoch: number;
}

export type StudioMultiLightSurfaceWorkerInboundMessage =
  | StudioMultiLightSurfaceWorkerExecuteMessage
  | StudioMultiLightSurfaceWorkerCancelMessage
  | StudioMultiLightSurfaceWorkerAdvanceEpochMessage;

export interface StudioMultiLightSurfaceWorkerReadyMessage {
  readonly type: "studio-multi-light-surface/ready";
  readonly version: typeof STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION;
  readonly currentEpoch: number;
}

export interface StudioMultiLightSurfaceWorkerResultMessage {
  readonly type: "studio-multi-light-surface/result";
  readonly version: typeof STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly deviceEpoch: number;
  readonly requestSequence: number;
  readonly result: StudioMultiLightSurfaceWorkerResult;
}

export type StudioMultiLightSurfaceWorkerOutboundMessage =
  | StudioMultiLightSurfaceWorkerReadyMessage
  | StudioMultiLightSurfaceWorkerResultMessage;

export interface StudioMultiLightSurfaceWorkerInputHashes {
  readonly sourceHash: `sha256:${string}`;
  readonly heightMapHash: `sha256:${string}` | null;
  readonly roughnessMapHash: `sha256:${string}` | null;
  readonly metalnessMapHash: `sha256:${string}` | null;
  readonly normalMapHash: `sha256:${string}` | null;
}

export type StudioMultiLightSurfaceWorkerRequestSnapshot =
  | Readonly<{
      ok: true;
      request: StudioMultiLightSurfaceWorkerRequest;
      inputBytes: number;
      maximumOutputBytes: number;
      residentBytes: number;
      workUnits: number;
      hashes: StudioMultiLightSurfaceWorkerInputHashes;
    }>
  | Readonly<{
      ok: false;
      reason: "invalid-request" | "budget-exceeded";
    }>;

const ERROR_CODES: readonly StudioMultiLightSurfaceErrorCode[] = Object.freeze([
  "invalid-recipe",
  "invalid-image",
  "invalid-map",
  "map-required",
  "map-not-allowed",
  "budget-exceeded",
  "invalid-request",
  "request-sequence",
  "device-epoch",
  "aborted",
  "disposed",
  "runtime-failed",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isContentHash(value: unknown): value is `sha256:${string}` {
  return typeof value === "string"
    && /^sha256:[0-9a-f]{64}$/u.test(value)
    && value !== `sha256:${"0".repeat(64)}`;
}

function hashBytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function hashJson(value: unknown): `sha256:${string}` {
  return hashBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function float32BytesLittleEndian(data: Float32Array): Uint8Array {
  const probe = new Uint16Array([0x00ff]);
  if (new Uint8Array(probe.buffer)[0] === 0xff) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  const bytes = new Uint8Array(data.byteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < data.length; index += 1) {
    view.setFloat32(index * FLOAT_BYTES, data[index]!, true);
  }
  return bytes;
}

function resourceHash(data: Float32Array): `sha256:${string}` {
  return hashBytes(float32BytesLittleEndian(data));
}

function copyTuple3(
  value: unknown,
): readonly [number, number, number] | null {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || !value.every(isFiniteNumber)
  ) return null;
  return Object.freeze([value[0], value[1], value[2]]);
}

function copyScalarMaterial(value: unknown) {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(value, ["source", "value"])
    || (value.source !== "constant" && value.source !== "map")
    || !isFiniteNumber(value.value)
  ) return null;
  return Object.freeze({ source: value.source, value: value.value });
}

function copyAttenuation(value: unknown) {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(value, ["kind", "range", "minimumDistance"])
    || (
      value.kind !== "inverse-square"
      && value.kind !== "smooth-range"
    )
    || !isFiniteNumber(value.range)
    || !isFiniteNumber(value.minimumDistance)
  ) return null;
  return Object.freeze({
    kind: value.kind,
    range: value.range,
    minimumDistance: value.minimumDistance,
  });
}

function copyLight(value: unknown) {
  if (
    !isPlainRecord(value)
    || typeof value.id !== "string"
    || value.id.length === 0
    || !isFiniteNumber(value.intensity)
  ) return null;
  const color = copyTuple3(value.color);
  if (!color) return null;
  if (
    value.kind === "directional"
    && hasOnlyKeys(
      value,
      ["id", "kind", "direction", "color", "intensity"],
    )
  ) {
    const direction = copyTuple3(value.direction);
    return direction
      ? Object.freeze({
          id: value.id,
          kind: "directional" as const,
          direction,
          color,
          intensity: value.intensity,
        })
      : null;
  }
  if (
    value.kind === "point"
    && hasOnlyKeys(
      value,
      ["id", "kind", "position", "color", "intensity", "attenuation"],
    )
  ) {
    const position = copyTuple3(value.position);
    const attenuation = copyAttenuation(value.attenuation);
    return position && attenuation
      ? Object.freeze({
          id: value.id,
          kind: "point" as const,
          position,
          color,
          intensity: value.intensity,
          attenuation,
        })
      : null;
  }
  if (
    value.kind === "spot"
    && hasOnlyKeys(value, [
      "id",
      "kind",
      "position",
      "direction",
      "color",
      "intensity",
      "attenuation",
      "innerConeDegrees",
      "outerConeDegrees",
    ])
    && isFiniteNumber(value.innerConeDegrees)
    && isFiniteNumber(value.outerConeDegrees)
  ) {
    const position = copyTuple3(value.position);
    const direction = copyTuple3(value.direction);
    const attenuation = copyAttenuation(value.attenuation);
    return position && direction && attenuation
      ? Object.freeze({
          id: value.id,
          kind: "spot" as const,
          position,
          direction,
          color,
          intensity: value.intensity,
          attenuation,
          innerConeDegrees: value.innerConeDegrees,
          outerConeDegrees: value.outerConeDegrees,
        })
      : null;
  }
  return null;
}

function copyRecipe(value: unknown): StudioMultiLightSurfaceRecipe | null {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(value, [
      "kind",
      "version",
      "colorContract",
      "alphaContract",
      "height",
      "normal",
      "material",
      "ambient",
      "lights",
      "fingerprint",
    ])
    || value.kind !== "studio-multi-light-surface-recipe"
    || value.version !== 1
    || value.colorContract !== "scene-linear-straight-rgba-f32"
    || value.alphaContract !== "preserve-source-alpha-exactly"
    || !isContentHash(value.fingerprint)
    || !isPlainRecord(value.height)
    || !isPlainRecord(value.normal)
    || !isPlainRecord(value.material)
    || !isPlainRecord(value.ambient)
    || !Array.isArray(value.lights)
    || value.lights.length < 1
    || value.lights.length
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumLights
  ) return null;

  let height: StudioMultiLightSurfaceRecipe["height"] | null = null;
  if (
    value.height.source === "source"
    && hasOnlyKeys(
      value.height,
      ["source", "channel", "midpoint", "scale"],
    )
    && (
      value.height.channel === "luminance"
      || value.height.channel === "red"
      || value.height.channel === "green"
      || value.height.channel === "blue"
      || value.height.channel === "alpha"
    )
    && isFiniteNumber(value.height.midpoint)
    && isFiniteNumber(value.height.scale)
  ) {
    height = Object.freeze({
      source: "source",
      channel: value.height.channel,
      midpoint: value.height.midpoint,
      scale: value.height.scale,
    });
  } else if (
    value.height.source === "separate"
    && hasOnlyKeys(value.height, ["source", "scale"])
    && isFiniteNumber(value.height.scale)
  ) {
    height = Object.freeze({
      source: "separate",
      scale: value.height.scale,
    });
  }

  let normal: StudioMultiLightSurfaceRecipe["normal"] | null = null;
  if (
    value.normal.source === "height"
    && hasOnlyKeys(value.normal, ["source"])
  ) {
    normal = Object.freeze({ source: "height" });
  } else if (
    value.normal.source === "height-and-map"
    && hasOnlyKeys(value.normal, ["source", "strength"])
    && isFiniteNumber(value.normal.strength)
  ) {
    normal = Object.freeze({
      source: "height-and-map",
      strength: value.normal.strength,
    });
  }

  const tint = copyTuple3(value.material.tint);
  const roughness = copyScalarMaterial(value.material.roughness);
  const metalness = copyScalarMaterial(value.material.metalness);
  const ambientColor = copyTuple3(value.ambient.color);
  if (
    !height
    || !normal
    || !hasOnlyKeys(value.material, [
      "tint",
      "diffuseStrength",
      "specularStrength",
      "roughness",
      "metalness",
    ])
    || !tint
    || !roughness
    || !metalness
    || !isFiniteNumber(value.material.diffuseStrength)
    || !isFiniteNumber(value.material.specularStrength)
    || !hasOnlyKeys(value.ambient, ["color", "intensity"])
    || !ambientColor
    || !isFiniteNumber(value.ambient.intensity)
  ) return null;

  const lights = [];
  for (const candidate of value.lights) {
    const light = copyLight(candidate);
    if (!light) return null;
    lights.push(light);
  }
  const recipe: StudioMultiLightSurfaceRecipe = Object.freeze({
    kind: "studio-multi-light-surface-recipe",
    version: 1,
    colorContract: "scene-linear-straight-rgba-f32",
    alphaContract: "preserve-source-alpha-exactly",
    height,
    normal,
    material: Object.freeze({
      tint,
      diffuseStrength: value.material.diffuseStrength,
      specularStrength: value.material.specularStrength,
      roughness,
      metalness,
    }),
    ambient: Object.freeze({
      color: ambientColor,
      intensity: value.ambient.intensity,
    }),
    lights: Object.freeze(lights),
    fingerprint: value.fingerprint,
  });
  const payload = {
    kind: recipe.kind,
    version: recipe.version,
    colorContract: recipe.colorContract,
    alphaContract: recipe.alphaContract,
    height: recipe.height,
    normal: recipe.normal,
    material: recipe.material,
    ambient: recipe.ambient,
    lights: recipe.lights,
  };
  return hashJson(payload) === recipe.fingerprint ? recipe : null;
}

interface CopiedResource<T> {
  readonly value: T;
  readonly bytes: number;
  readonly hash: `sha256:${string}`;
}

interface DeclaredResource<T> {
  readonly value: T;
  readonly bytes: number;
}

function inspectImage(
  value: unknown,
): DeclaredResource<StudioMultiLightSurfaceImage> | null {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(
      value,
      ["kind", "version", "width", "height", "colorContract", "data"],
    )
    || value.kind !== "studio-multi-light-surface-image"
    || value.version !== 1
    || value.colorContract !== "scene-linear-straight-rgba-f32"
    || !isPositiveInteger(value.width)
    || !isPositiveInteger(value.height)
    || value.width
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumDimension
    || value.height
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumDimension
    || !(value.data instanceof Float32Array)
    || !(value.data.buffer instanceof ArrayBuffer)
  ) return null;
  const pixels = value.width * value.height;
  const elementCount = pixels * 4;
  const bytes = elementCount * FLOAT_BYTES;
  if (
    !Number.isSafeInteger(pixels)
    || pixels > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumPixels
    || !Number.isSafeInteger(bytes)
    || value.data.length !== elementCount
  ) return null;
  return Object.freeze({
    value: value as unknown as StudioMultiLightSurfaceImage,
    bytes,
  });
}

function inspectScalarMap(
  value: unknown,
  semantic: StudioMultiLightSurfaceScalarMap["semantic"],
): DeclaredResource<StudioMultiLightSurfaceScalarMap> | null {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(
      value,
      ["kind", "version", "width", "height", "semantic", "data"],
    )
    || value.kind !== "studio-multi-light-surface-scalar-map"
    || value.version !== 1
    || value.semantic !== semantic
    || !isPositiveInteger(value.width)
    || !isPositiveInteger(value.height)
    || value.width
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumDimension
    || value.height
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumDimension
    || !(value.data instanceof Float32Array)
    || !(value.data.buffer instanceof ArrayBuffer)
  ) return null;
  const pixels = value.width * value.height;
  const bytes = pixels * FLOAT_BYTES;
  if (
    !Number.isSafeInteger(pixels)
    || pixels > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumPixels
    || !Number.isSafeInteger(bytes)
    || value.data.length !== pixels
  ) return null;
  return Object.freeze({
    value: value as unknown as StudioMultiLightSurfaceScalarMap,
    bytes,
  });
}

function inspectNormalMap(
  value: unknown,
): DeclaredResource<StudioMultiLightSurfaceNormalMap> | null {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(
      value,
      ["kind", "version", "width", "height", "space", "data"],
    )
    || value.kind !== "studio-multi-light-surface-normal-map"
    || value.version !== 1
    || value.space !== "surface"
    || !isPositiveInteger(value.width)
    || !isPositiveInteger(value.height)
    || value.width
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumDimension
    || value.height
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumDimension
    || !(value.data instanceof Float32Array)
    || !(value.data.buffer instanceof ArrayBuffer)
  ) return null;
  const pixels = value.width * value.height;
  const elementCount = pixels * 3;
  const bytes = elementCount * FLOAT_BYTES;
  if (
    !Number.isSafeInteger(pixels)
    || pixels > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumPixels
    || !Number.isSafeInteger(bytes)
    || value.data.length !== elementCount
  ) return null;
  return Object.freeze({
    value: value as unknown as StudioMultiLightSurfaceNormalMap,
    bytes,
  });
}

function copyImage(value: unknown): CopiedResource<StudioMultiLightSurfaceImage> | null {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(
      value,
      ["kind", "version", "width", "height", "colorContract", "data"],
    )
    || value.kind !== "studio-multi-light-surface-image"
    || value.version !== 1
    || value.colorContract !== "scene-linear-straight-rgba-f32"
    || !isPositiveInteger(value.width)
    || !isPositiveInteger(value.height)
    || value.width
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumDimension
    || value.height
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumDimension
    || !(value.data instanceof Float32Array)
    || !(value.data.buffer instanceof ArrayBuffer)
  ) return null;
  const pixels = value.width * value.height;
  if (
    !Number.isSafeInteger(pixels)
    || pixels > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumPixels
    || value.data.length !== pixels * 4
    || !value.data.every(Number.isFinite)
  ) return null;
  const data = new Float32Array(value.data);
  return Object.freeze({
    value: Object.freeze({
      kind: "studio-multi-light-surface-image",
      version: 1,
      width: value.width,
      height: value.height,
      colorContract: "scene-linear-straight-rgba-f32",
      data,
    }),
    bytes: data.byteLength,
    hash: resourceHash(data),
  });
}

function copyScalarMap(
  value: unknown,
  semantic: StudioMultiLightSurfaceScalarMap["semantic"],
): CopiedResource<StudioMultiLightSurfaceScalarMap> | null {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(
      value,
      ["kind", "version", "width", "height", "semantic", "data"],
    )
    || value.kind !== "studio-multi-light-surface-scalar-map"
    || value.version !== 1
    || value.semantic !== semantic
    || !isPositiveInteger(value.width)
    || !isPositiveInteger(value.height)
    || value.width
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumDimension
    || value.height
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumDimension
    || !(value.data instanceof Float32Array)
    || !(value.data.buffer instanceof ArrayBuffer)
  ) return null;
  const pixels = value.width * value.height;
  if (
    !Number.isSafeInteger(pixels)
    || pixels > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumPixels
    || value.data.length !== pixels
    || !value.data.every(Number.isFinite)
  ) return null;
  const data = new Float32Array(value.data);
  return Object.freeze({
    value: Object.freeze({
      kind: "studio-multi-light-surface-scalar-map",
      version: 1,
      width: value.width,
      height: value.height,
      semantic,
      data,
    }),
    bytes: data.byteLength,
    hash: resourceHash(data),
  });
}

function copyNormalMap(
  value: unknown,
): CopiedResource<StudioMultiLightSurfaceNormalMap> | null {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(
      value,
      ["kind", "version", "width", "height", "space", "data"],
    )
    || value.kind !== "studio-multi-light-surface-normal-map"
    || value.version !== 1
    || value.space !== "surface"
    || !isPositiveInteger(value.width)
    || !isPositiveInteger(value.height)
    || value.width
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumDimension
    || value.height
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumDimension
    || !(value.data instanceof Float32Array)
    || !(value.data.buffer instanceof ArrayBuffer)
  ) return null;
  const pixels = value.width * value.height;
  if (
    !Number.isSafeInteger(pixels)
    || pixels > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumPixels
    || value.data.length !== pixels * 3
    || !value.data.every(Number.isFinite)
  ) return null;
  const data = new Float32Array(value.data);
  return Object.freeze({
    value: Object.freeze({
      kind: "studio-multi-light-surface-normal-map",
      version: 1,
      width: value.width,
      height: value.height,
      space: "surface",
      data,
    }),
    bytes: data.byteLength,
    hash: resourceHash(data),
  });
}

export function snapshotStudioMultiLightSurfaceWorkerRequest(
  value: unknown,
): StudioMultiLightSurfaceWorkerRequestSnapshot {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(
      value,
      ["requestSequence", "deviceEpoch", "recipe", "source"],
      ["heightMap", "roughnessMap", "metalnessMap", "normalMap"],
    )
    || !isPositiveInteger(value.requestSequence)
    || !isPositiveInteger(value.deviceEpoch)
  ) return Object.freeze({ ok: false, reason: "invalid-request" });
  const recipe = copyRecipe(value.recipe);
  const sourceDeclaration = inspectImage(value.source);
  if (!recipe || !sourceDeclaration) {
    return Object.freeze({ ok: false, reason: "invalid-request" });
  }

  const heightRequired = recipe.height.source === "separate";
  const roughnessRequired = recipe.material.roughness.source === "map";
  const metalnessRequired = recipe.material.metalness.source === "map";
  const normalRequired = recipe.normal.source === "height-and-map";
  if (
    heightRequired !== (value.heightMap !== undefined)
    || roughnessRequired !== (value.roughnessMap !== undefined)
    || metalnessRequired !== (value.metalnessMap !== undefined)
    || normalRequired !== (value.normalMap !== undefined)
  ) return Object.freeze({ ok: false, reason: "invalid-request" });

  const heightDeclaration = heightRequired
    ? inspectScalarMap(value.heightMap, "signed-height")
    : null;
  const roughnessDeclaration = roughnessRequired
    ? inspectScalarMap(value.roughnessMap, "roughness")
    : null;
  const metalnessDeclaration = metalnessRequired
    ? inspectScalarMap(value.metalnessMap, "metalness")
    : null;
  const normalDeclaration = normalRequired
    ? inspectNormalMap(value.normalMap)
    : null;
  if (
    (heightRequired && !heightDeclaration)
    || (roughnessRequired && !roughnessDeclaration)
    || (metalnessRequired && !metalnessDeclaration)
    || (normalRequired && !normalDeclaration)
  ) return Object.freeze({ ok: false, reason: "invalid-request" });

  const inputBytes = sourceDeclaration.bytes
    + (heightDeclaration?.bytes ?? 0)
    + (roughnessDeclaration?.bytes ?? 0)
    + (metalnessDeclaration?.bytes ?? 0)
    + (normalDeclaration?.bytes ?? 0);
  const maximumOutputBytes = sourceDeclaration.bytes;
  const residentBytes = inputBytes + maximumOutputBytes;
  const pixels =
    sourceDeclaration.value.width * sourceDeclaration.value.height;
  const workUnits = pixels * (recipe.lights.length + 8);
  if (
    !Number.isSafeInteger(inputBytes)
    || !Number.isSafeInteger(residentBytes)
    || !Number.isSafeInteger(workUnits)
    || inputBytes
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumInputBytes
    || maximumOutputBytes
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumOutputBytes
    || residentBytes
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumResidentBytes
    || workUnits
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumWorkUnits
  ) return Object.freeze({ ok: false, reason: "budget-exceeded" });

  const source = copyImage(sourceDeclaration.value);
  const heightMap = heightDeclaration
    ? copyScalarMap(heightDeclaration.value, "signed-height")
    : null;
  const roughnessMap = roughnessDeclaration
    ? copyScalarMap(roughnessDeclaration.value, "roughness")
    : null;
  const metalnessMap = metalnessDeclaration
    ? copyScalarMap(metalnessDeclaration.value, "metalness")
    : null;
  const normalMap = normalDeclaration
    ? copyNormalMap(normalDeclaration.value)
    : null;
  if (
    !source
    || (heightRequired && !heightMap)
    || (roughnessRequired && !roughnessMap)
    || (metalnessRequired && !metalnessMap)
    || (normalRequired && !normalMap)
  ) return Object.freeze({ ok: false, reason: "invalid-request" });

  const request: StudioMultiLightSurfaceWorkerRequest = Object.freeze({
    requestSequence: value.requestSequence,
    deviceEpoch: value.deviceEpoch,
    recipe,
    source: source.value,
    ...(heightMap ? { heightMap: heightMap.value } : {}),
    ...(roughnessMap ? { roughnessMap: roughnessMap.value } : {}),
    ...(metalnessMap ? { metalnessMap: metalnessMap.value } : {}),
    ...(normalMap ? { normalMap: normalMap.value } : {}),
  });
  return Object.freeze({
    ok: true,
    request,
    inputBytes,
    maximumOutputBytes,
    residentBytes,
    workUnits,
    hashes: Object.freeze({
      sourceHash: source.hash,
      heightMapHash: heightMap?.hash ?? null,
      roughnessMapHash: roughnessMap?.hash ?? null,
      metalnessMapHash: metalnessMap?.hash ?? null,
      normalMapHash: normalMap?.hash ?? null,
    }),
  });
}

export function studioMultiLightSurfaceRequestTransfers(
  message: StudioMultiLightSurfaceWorkerExecuteMessage,
): Transferable[] {
  const ownedBuffer = (data: Float32Array): ArrayBuffer => {
    if (!(data.buffer instanceof ArrayBuffer)) {
      throw new TypeError("Worker resources must own transferable buffers");
    }
    return data.buffer;
  };
  const buffers: ArrayBuffer[] = [ownedBuffer(message.request.source.data)];
  if (message.request.heightMap) {
    buffers.push(ownedBuffer(message.request.heightMap.data));
  }
  if (message.request.roughnessMap) {
    buffers.push(ownedBuffer(message.request.roughnessMap.data));
  }
  if (message.request.metalnessMap) {
    buffers.push(ownedBuffer(message.request.metalnessMap.data));
  }
  if (message.request.normalMap) {
    buffers.push(ownedBuffer(message.request.normalMap.data));
  }
  return buffers;
}

export function studioMultiLightSurfaceWorkerFailure(
  reason: StudioMultiLightSurfaceWorkerBoundaryFailureReason,
  detail: string,
): StudioMultiLightSurfaceWorkerBoundaryFailure {
  const bounded = detail.slice(
    0,
    STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS
      .maximumFailureDetailCharacters,
  );
  return Object.freeze({
    status: "worker-failed",
    reason,
    detail: bounded,
    fallback: Object.freeze({
      kind: "studio-multi-light-surface-worker-only-receipt",
      execution: "dedicated-worker",
      mainThreadComputationFallback: false,
      complete: false,
      reason,
    }),
  });
}

export function studioMultiLightSurfaceWorkerRejected(
  code: StudioMultiLightSurfaceErrorCode,
  detail: string,
  path?: string,
): StudioMultiLightSurfaceWorkerRejected {
  return Object.freeze({
    status: "rejected",
    code,
    detail: detail.slice(
      0,
      STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS
        .maximumFailureDetailCharacters,
    ),
    ...(path === undefined
      ? {}
      : {
          path: path.slice(
            0,
            STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS
              .maximumFailureDetailCharacters,
          ),
        }),
  });
}

function copyWorkerFailure(
  value: unknown,
): StudioMultiLightSurfaceWorkerBoundaryFailure | null {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(value, ["status", "reason", "detail", "fallback"])
    || value.status !== "worker-failed"
    || (
      value.reason !== "backpressure"
      && value.reason !== "disposed"
      && value.reason !== "execution-failed"
      && value.reason !== "invalid-message"
      && value.reason !== "operation-timeout"
      && value.reason !== "protocol-error"
      && value.reason !== "startup-timeout"
      && value.reason !== "worker-unavailable"
    )
    || typeof value.detail !== "string"
    || value.detail.length
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS
        .maximumFailureDetailCharacters
    || !isPlainRecord(value.fallback)
    || !hasOnlyKeys(value.fallback, [
      "kind",
      "execution",
      "mainThreadComputationFallback",
      "complete",
      "reason",
    ])
    || value.fallback.kind
      !== "studio-multi-light-surface-worker-only-receipt"
    || value.fallback.execution !== "dedicated-worker"
    || value.fallback.mainThreadComputationFallback !== false
    || value.fallback.complete !== false
    || value.fallback.reason !== value.reason
  ) return null;
  return studioMultiLightSurfaceWorkerFailure(value.reason, value.detail);
}

function copyRejected(
  value: unknown,
): StudioMultiLightSurfaceWorkerRejected | null {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(value, ["status", "code", "detail"], ["path"])
    || value.status !== "rejected"
    || typeof value.code !== "string"
    || !ERROR_CODES.includes(value.code as StudioMultiLightSurfaceErrorCode)
    || typeof value.detail !== "string"
    || value.detail.length
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS
        .maximumFailureDetailCharacters
    || (
      value.path !== undefined
      && (
        typeof value.path !== "string"
        || value.path.length
          > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS
            .maximumFailureDetailCharacters
      )
    )
  ) return null;
  return studioMultiLightSurfaceWorkerRejected(
    value.code as StudioMultiLightSurfaceErrorCode,
    value.detail,
    value.path as string | undefined,
  );
}

function copyStringArray(
  value: unknown,
  expectedLength: number,
): readonly string[] | null {
  if (
    !Array.isArray(value)
    || value.length !== expectedLength
    || !value.every((entry) => typeof entry === "string")
  ) return null;
  return Object.freeze([...value]);
}

function copyCompleted(
  value: unknown,
): StudioMultiLightSurfaceWorkerCompleted | null {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(value, ["status", "receipt"])
    || value.status !== "completed"
    || !isPlainRecord(value.receipt)
    || !hasOnlyKeys(value.receipt, [
      "kind",
      "version",
      "providerRevision",
      "requestSequence",
      "deviceEpoch",
      "recipeFingerprint",
      "output",
      "oracle",
      "receiptHash",
      "complete",
    ])
    || value.receipt.kind !== "studio-multi-light-surface-receipt"
    || value.receipt.version !== 1
    || value.receipt.providerRevision !== 1
    || !isPositiveInteger(value.receipt.requestSequence)
    || !isPositiveInteger(value.receipt.deviceEpoch)
    || !isContentHash(value.receipt.recipeFingerprint)
    || !isContentHash(value.receipt.receiptHash)
    || value.receipt.complete !== true
  ) return null;
  const output = copyImage(value.receipt.output);
  const oracleValue = value.receipt.oracle;
  if (
    !output
    || output.bytes
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumOutputBytes
    || !isPlainRecord(oracleValue)
    || !hasOnlyKeys(oracleValue, [
      "kind",
      "version",
      "backend",
      "executionModel",
      "colorContract",
      "alphaContract",
      "recipeFingerprint",
      "sourceHash",
      "heightMapHash",
      "roughnessMapHash",
      "metalnessMapHash",
      "normalMapHash",
      "outputHash",
      "sourceSize",
      "rigOrder",
      "evaluationOrder",
      "lightCount",
      "tileEdge",
      "tileCount",
      "haloPixels",
      "workUnits",
      "residentBytes",
      "complete",
    ])
    || oracleValue.kind
      !== "studio-multi-light-surface-cpu-oracle-receipt"
    || oracleValue.version !== 1
    || oracleValue.backend !== "cpu-typed-array"
    || oracleValue.executionModel
      !== "deterministic-tiled-canonical-light-order"
    || oracleValue.colorContract !== "scene-linear-straight-rgba-f32"
    || oracleValue.alphaContract !== "preserve-source-alpha-exactly"
    || oracleValue.recipeFingerprint
      !== value.receipt.recipeFingerprint
    || !isContentHash(oracleValue.sourceHash)
    || !(
      oracleValue.heightMapHash === null
      || isContentHash(oracleValue.heightMapHash)
    )
    || !(
      oracleValue.roughnessMapHash === null
      || isContentHash(oracleValue.roughnessMapHash)
    )
    || !(
      oracleValue.metalnessMapHash === null
      || isContentHash(oracleValue.metalnessMapHash)
    )
    || !(
      oracleValue.normalMapHash === null
      || isContentHash(oracleValue.normalMapHash)
    )
    || !isContentHash(oracleValue.outputHash)
    || oracleValue.outputHash !== output.hash
    || !Array.isArray(oracleValue.sourceSize)
    || oracleValue.sourceSize.length !== 2
    || oracleValue.sourceSize[0] !== output.value.width
    || oracleValue.sourceSize[1] !== output.value.height
    || !isPositiveInteger(oracleValue.lightCount)
    || oracleValue.lightCount
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumLights
    || !isPositiveInteger(oracleValue.tileEdge)
    || oracleValue.tileEdge > 2_048
    || !isPositiveInteger(oracleValue.tileCount)
    || oracleValue.tileCount
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumTiles
    || oracleValue.haloPixels !== 1
    || !isPositiveInteger(oracleValue.workUnits)
    || oracleValue.workUnits
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumWorkUnits
    || !isPositiveInteger(oracleValue.residentBytes)
    || oracleValue.residentBytes
      > STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumResidentBytes
    || oracleValue.complete !== true
  ) return null;
  const rigOrder = copyStringArray(
    oracleValue.rigOrder,
    oracleValue.lightCount,
  );
  const evaluationOrder = copyStringArray(
    oracleValue.evaluationOrder,
    oracleValue.lightCount,
  );
  if (
    !rigOrder
    || !evaluationOrder
    || new Set(rigOrder).size !== rigOrder.length
    || [...evaluationOrder].sort().join("\0")
      !== evaluationOrder.join("\0")
    || [...rigOrder].sort().join("\0")
      !== evaluationOrder.join("\0")
  ) return null;
  const expectedWork = output.value.width
    * output.value.height
    * (oracleValue.lightCount + 8);
  const expectedTiles = Math.ceil(output.value.width / oracleValue.tileEdge)
    * Math.ceil(output.value.height / oracleValue.tileEdge);
  if (
    oracleValue.workUnits !== expectedWork
    || oracleValue.tileCount !== expectedTiles
  ) return null;

  const oracle = Object.freeze({
    kind: "studio-multi-light-surface-cpu-oracle-receipt" as const,
    version: 1 as const,
    backend: "cpu-typed-array" as const,
    executionModel:
      "deterministic-tiled-canonical-light-order" as const,
    colorContract: "scene-linear-straight-rgba-f32" as const,
    alphaContract: "preserve-source-alpha-exactly" as const,
    recipeFingerprint: oracleValue.recipeFingerprint,
    sourceHash: oracleValue.sourceHash,
    heightMapHash: oracleValue.heightMapHash,
    roughnessMapHash: oracleValue.roughnessMapHash,
    metalnessMapHash: oracleValue.metalnessMapHash,
    normalMapHash: oracleValue.normalMapHash,
    outputHash: oracleValue.outputHash,
    sourceSize: Object.freeze([
      output.value.width,
      output.value.height,
    ] as const),
    rigOrder,
    evaluationOrder,
    lightCount: oracleValue.lightCount,
    tileEdge: oracleValue.tileEdge,
    tileCount: oracleValue.tileCount,
    haloPixels: 1 as const,
    workUnits: oracleValue.workUnits,
    residentBytes: oracleValue.residentBytes,
    complete: true as const,
  });
  const expectedReceiptHash = hashJson({
    kind: "studio-multi-light-surface-receipt",
    version: 1,
    providerRevision: 1,
    requestSequence: value.receipt.requestSequence,
    deviceEpoch: value.receipt.deviceEpoch,
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
  if (expectedReceiptHash !== value.receipt.receiptHash) return null;
  return Object.freeze({
    status: "completed",
    receipt: Object.freeze({
      kind: "studio-multi-light-surface-receipt",
      version: 1,
      providerRevision: 1,
      requestSequence: value.receipt.requestSequence,
      deviceEpoch: value.receipt.deviceEpoch,
      recipeFingerprint: value.receipt.recipeFingerprint,
      output: output.value,
      oracle,
      receiptHash: value.receipt.receiptHash,
      complete: true,
    }),
  });
}

export function snapshotStudioMultiLightSurfaceWorkerResult(
  value: unknown,
): StudioMultiLightSurfaceWorkerResult | null {
  if (!isPlainRecord(value) || typeof value.status !== "string") return null;
  if (value.status === "completed") return copyCompleted(value);
  if (value.status === "rejected") return copyRejected(value);
  if (value.status === "worker-failed") return copyWorkerFailure(value);
  if (
    value.status === "cancelled"
    && hasOnlyKeys(value, ["status"])
  ) return Object.freeze({ status: "cancelled" });
  return null;
}

export function studioMultiLightSurfaceResultTransfers(
  message: StudioMultiLightSurfaceWorkerResultMessage,
): Transferable[] {
  if (message.result.status !== "completed") return [];
  const buffer = message.result.receipt.output.data.buffer;
  if (!(buffer instanceof ArrayBuffer)) {
    throw new TypeError("Worker output must own a transferable buffer");
  }
  return [buffer];
}

export function snapshotStudioMultiLightSurfaceWorkerInboundMessage(
  value: unknown,
): StudioMultiLightSurfaceWorkerInboundMessage | null {
  if (
    !isPlainRecord(value)
    || value.version !== STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION
  ) return null;
  if (
    value.type === "studio-multi-light-surface/execute"
    && hasOnlyKeys(value, ["type", "version", "requestId", "request"])
    && isPositiveInteger(value.requestId)
  ) {
    const snapshot = snapshotStudioMultiLightSurfaceWorkerRequest(
      value.request,
    );
    return snapshot.ok
      ? Object.freeze({
          type: "studio-multi-light-surface/execute",
          version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
          requestId: value.requestId,
          request: snapshot.request,
        })
      : null;
  }
  if (
    value.type === "studio-multi-light-surface/cancel"
    && hasOnlyKeys(value, ["type", "version", "requestId"])
    && isPositiveInteger(value.requestId)
  ) {
    return Object.freeze({
      type: "studio-multi-light-surface/cancel",
      version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId: value.requestId,
    });
  }
  if (
    value.type === "studio-multi-light-surface/advance-epoch"
    && hasOnlyKeys(value, ["type", "version", "currentEpoch"])
    && isPositiveInteger(value.currentEpoch)
  ) {
    return Object.freeze({
      type: "studio-multi-light-surface/advance-epoch",
      version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
      currentEpoch: value.currentEpoch,
    });
  }
  return null;
}

export function snapshotStudioMultiLightSurfaceWorkerOutboundMessage(
  value: unknown,
): StudioMultiLightSurfaceWorkerOutboundMessage | null {
  if (
    !isPlainRecord(value)
    || value.version !== STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION
  ) return null;
  if (
    value.type === "studio-multi-light-surface/ready"
    && hasOnlyKeys(value, ["type", "version", "currentEpoch"])
    && isNonNegativeInteger(value.currentEpoch)
  ) {
    return Object.freeze({
      type: "studio-multi-light-surface/ready",
      version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
      currentEpoch: value.currentEpoch,
    });
  }
  if (
    value.type === "studio-multi-light-surface/result"
    && hasOnlyKeys(value, [
      "type",
      "version",
      "requestId",
      "deviceEpoch",
      "requestSequence",
      "result",
    ])
    && isPositiveInteger(value.requestId)
    && isPositiveInteger(value.deviceEpoch)
    && isPositiveInteger(value.requestSequence)
  ) {
    const result = snapshotStudioMultiLightSurfaceWorkerResult(value.result);
    return result
      ? Object.freeze({
          type: "studio-multi-light-surface/result",
          version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
          requestId: value.requestId,
          deviceEpoch: value.deviceEpoch,
          requestSequence: value.requestSequence,
          result,
        })
      : null;
  }
  return null;
}

export function isStudioMultiLightSurfaceWorkerInboundMessage(
  value: unknown,
): value is StudioMultiLightSurfaceWorkerInboundMessage {
  return snapshotStudioMultiLightSurfaceWorkerInboundMessage(value) !== null;
}

export function isStudioMultiLightSurfaceWorkerOutboundMessage(
  value: unknown,
): value is StudioMultiLightSurfaceWorkerOutboundMessage {
  return snapshotStudioMultiLightSurfaceWorkerOutboundMessage(value) !== null;
}
