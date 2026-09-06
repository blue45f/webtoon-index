import { STUDIO_BG3D_LT_RENDER_MAX_PIXELS } from "./studio-bg3d-lt-render";

import type {
  StudioBg3dLtRasterLayerRole,
  StudioBg3dLtRenderSettings,
} from "./studio-bg3d-lt-render";

/** The wire schema is intentionally versioned independently from the persisted 3D document. */
export const STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION = 1 as const;
export const STUDIO_BG3D_LT_RENDER_WORKER_MAX_LAYERS = 3;

export interface StudioBg3dLtRenderWorkerInput {
  readonly width: number;
  readonly height: number;
  /** Fresh, tightly packed RGBA8 storage owned by this request. SharedArrayBuffer is forbidden. */
  readonly rgbaBuffer: ArrayBuffer;
  /** Optional normalized Float32 depth storage owned by this request. */
  readonly depthBuffer?: ArrayBuffer;
}

export interface StudioBg3dLtRenderWorkerRequest {
  readonly version: typeof STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION;
  readonly kind: "render";
  readonly requestId: number;
  readonly input: StudioBg3dLtRenderWorkerInput;
  readonly settings: StudioBg3dLtRenderSettings;
}

export interface StudioBg3dLtRenderWorkerLayer {
  readonly role: StudioBg3dLtRasterLayerRole;
  readonly width: number;
  readonly height: number;
  /** Fresh, tightly packed RGBA8 storage. SharedArrayBuffer is forbidden. */
  readonly dataBuffer: ArrayBuffer;
}

export type StudioBg3dLtRenderWorkerResponse =
  | {
      readonly version: typeof STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION;
      readonly kind: "result";
      readonly requestId: number;
      readonly width: number;
      readonly height: number;
      readonly layers: readonly StudioBg3dLtRenderWorkerLayer[];
    }
  | {
      readonly version: typeof STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION;
      readonly kind: "error";
      readonly requestId: number;
      readonly code: "protocol" | "render-failed";
    };

const REQUEST_KEYS = ["version", "kind", "requestId", "input", "settings"] as const;
const INPUT_KEYS = ["width", "height", "rgbaBuffer"] as const;
const INPUT_OPTIONAL_KEYS = ["depthBuffer"] as const;
const SETTINGS_KEYS = ["line", "tone"] as const;
const LINE_KEYS = [
  "enabled",
  "layerType",
  "color",
  "widthPx",
  "strength",
  "accuracy",
  "scaleAwareAccuracy",
  "exteriorOutlineStrength",
  "depthEnabled",
  "depthStrength",
  "depthOutlineOnly",
  "smoothing",
  "textureLineEnabled",
  "textureLineStrength",
  "creaseAngleDegrees",
  "hiddenLineRemoval",
] as const;
const TONE_KEYS = [
  "mode",
  "type",
  "pattern",
  "levels",
  "opacity",
  "frequency",
  "angleDegrees",
] as const;
const RESULT_KEYS = ["version", "kind", "requestId", "width", "height", "layers"] as const;
const ERROR_KEYS = ["version", "kind", "requestId", "code"] as const;
const LAYER_KEYS = ["role", "width", "height", "dataBuffer"] as const;

const LINE_LAYER_TYPES = new Set(["raster", "vector"]);
const TONE_MODES = new Set(["none", "flat", "cel", "screentone"]);
const TONE_TYPES = new Set(["color", "grayscale", "pattern"]);
const TONE_PATTERNS = new Set(["dot", "line", "crosshatch", "noise"]);
const LAYER_ROLE_ORDER: Readonly<Record<StudioBg3dLtRasterLayerRole, number>> = {
  color: 0,
  tone: 0,
  "texture-line": 1,
  "main-line": 2,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  if (keys.length < required.length || keys.length > required.length + optional.length) return false;
  return required.every((key) => hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}

function isRequestId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isFiniteRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function dimensions(value: Record<string, unknown>): { width: number; height: number; pixels: number } | null {
  const width = value.width;
  const height = value.height;
  if (
    typeof width !== "number" || !Number.isSafeInteger(width) || width < 1 ||
    typeof height !== "number" || !Number.isSafeInteger(height) || height < 1
  ) return null;
  const pixels = width * height;
  return Number.isSafeInteger(pixels) && pixels <= STUDIO_BG3D_LT_RENDER_MAX_PIXELS
    ? { width, height, pixels }
    : null;
}

function isOwnedArrayBuffer(value: unknown, byteLength: number): value is ArrayBuffer {
  // `instanceof ArrayBuffer` deliberately rejects SharedArrayBuffer-backed payloads.
  return value instanceof ArrayBuffer && value.byteLength === byteLength;
}

function isLineSettings(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, LINE_KEYS)) return false;
  return typeof value.enabled === "boolean" &&
    LINE_LAYER_TYPES.has(value.layerType as string) &&
    typeof value.color === "string" && /^#[0-9a-f]{6}$/u.test(value.color) &&
    isFiniteRange(value.widthPx, 0.25, 8) &&
    isFiniteRange(value.strength, 0, 1) &&
    isFiniteRange(value.accuracy, 0, 1) &&
    typeof value.scaleAwareAccuracy === "boolean" &&
    isFiniteRange(value.exteriorOutlineStrength, 0, 2) &&
    typeof value.depthEnabled === "boolean" &&
    isFiniteRange(value.depthStrength, 0, 1) &&
    typeof value.depthOutlineOnly === "boolean" &&
    isFiniteRange(value.smoothing, 0, 1) &&
    typeof value.textureLineEnabled === "boolean" &&
    isFiniteRange(value.textureLineStrength, 0, 1) &&
    isFiniteRange(value.creaseAngleDegrees, 0, 180) &&
    typeof value.hiddenLineRemoval === "boolean";
}

function isToneSettings(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, TONE_KEYS)) return false;
  return TONE_MODES.has(value.mode as string) &&
    TONE_TYPES.has(value.type as string) &&
    TONE_PATTERNS.has(value.pattern as string) &&
    typeof value.levels === "number" && Number.isSafeInteger(value.levels) &&
    value.levels >= 2 && value.levels <= 8 &&
    isFiniteRange(value.opacity, 0, 1) &&
    isFiniteRange(value.frequency, 1, 200) &&
    isFiniteRange(value.angleDegrees, -180, 180);
}

function isSettings(value: unknown): value is StudioBg3dLtRenderSettings {
  return isRecord(value) && hasExactKeys(value, SETTINGS_KEYS) &&
    isLineSettings(value.line) && isToneSettings(value.tone);
}

function isWorkerInput(
  value: unknown,
  validateDepthSamples: boolean,
): value is StudioBg3dLtRenderWorkerInput {
  if (!isRecord(value) || !hasExactKeys(value, INPUT_KEYS, INPUT_OPTIONAL_KEYS)) return false;
  const shape = dimensions(value);
  if (!shape || !isOwnedArrayBuffer(value.rgbaBuffer, shape.pixels * 4)) return false;
  if (!hasOwn(value, "depthBuffer")) return true;
  if (!isOwnedArrayBuffer(
    value.depthBuffer,
    shape.pixels * Float32Array.BYTES_PER_ELEMENT,
  )) return false;
  if (!validateDepthSamples) return true;
  const depth = new Float32Array(value.depthBuffer);
  for (let index = 0; index < depth.length; index += 1) {
    const sample = depth[index];
    if (!Number.isFinite(sample) || sample < 0 || sample > 1) return false;
  }
  return true;
}

function isWorkerRequest(
  value: unknown,
  validateDepthSamples: boolean,
): value is StudioBg3dLtRenderWorkerRequest {
  return isRecord(value) && hasExactKeys(value, REQUEST_KEYS) &&
    value.version === STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION &&
    value.kind === "render" && isRequestId(value.requestId) &&
    isWorkerInput(value.input, validateDepthSamples) && isSettings(value.settings);
}

/**
 * Main-thread admission checks exact keys, dimensions, byte lengths, settings, and ownership without
 * walking every depth sample. The dedicated Worker performs the full value scan after transfer.
 */
export function isStudioBg3dLtRenderWorkerRequestEnvelope(
  value: unknown,
): value is StudioBg3dLtRenderWorkerRequest {
  try {
    return isWorkerRequest(value, false);
  } catch {
    return false;
  }
}

/** Strict Worker-side admission, including a full normalized finite-depth scan. */
export function isStudioBg3dLtRenderWorkerRequest(
  value: unknown,
): value is StudioBg3dLtRenderWorkerRequest {
  try {
    return isWorkerRequest(value, true);
  } catch {
    return false;
  }
}

function isLayer(value: unknown, resultWidth: number, resultHeight: number): value is StudioBg3dLtRenderWorkerLayer {
  if (!isRecord(value) || !hasExactKeys(value, LAYER_KEYS)) return false;
  const role = value.role;
  return typeof role === "string" && hasOwn(LAYER_ROLE_ORDER, role) &&
    value.width === resultWidth && value.height === resultHeight &&
    isOwnedArrayBuffer(value.dataBuffer, resultWidth * resultHeight * 4);
}

/**
 * Validates dimensions, stable role ordering, unique roles, and exact RGBA byte lengths. Because
 * layer storage is admitted only as ArrayBuffer and rehydrated as Uint8ClampedArray, every sample
 * is intrinsically a finite integer in [0, 255].
 */
export function isStudioBg3dLtRenderWorkerResponse(
  value: unknown,
): value is StudioBg3dLtRenderWorkerResponse {
  try {
    if (
      !isRecord(value) ||
      value.version !== STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION ||
      !isRequestId(value.requestId)
    ) return false;
    if (value.kind === "error") {
      return hasExactKeys(value, ERROR_KEYS) &&
        (value.code === "protocol" || value.code === "render-failed");
    }
    if (value.kind !== "result" || !hasExactKeys(value, RESULT_KEYS)) return false;
    const shape = dimensions(value);
    if (!shape || !Array.isArray(value.layers) || value.layers.length > STUDIO_BG3D_LT_RENDER_WORKER_MAX_LAYERS) {
      return false;
    }
    let previousRoleOrder = -1;
    const roles = new Set<StudioBg3dLtRasterLayerRole>();
    for (const layer of value.layers) {
      if (!isLayer(layer, shape.width, shape.height)) return false;
      if (roles.has(layer.role)) return false;
      const order = LAYER_ROLE_ORDER[layer.role];
      if (order <= previousRoleOrder) return false;
      roles.add(layer.role);
      previousRoleOrder = order;
    }
    return true;
  } catch {
    return false;
  }
}

export function studioBg3dLtRenderWorkerRequestTransfers(
  request: StudioBg3dLtRenderWorkerRequest,
): Transferable[] {
  return request.input.depthBuffer
    ? [request.input.rgbaBuffer, request.input.depthBuffer]
    : [request.input.rgbaBuffer];
}

export function studioBg3dLtRenderWorkerResponseTransfers(
  response: StudioBg3dLtRenderWorkerResponse,
): Transferable[] {
  return response.kind === "result"
    ? response.layers.map((layer) => layer.dataBuffer)
    : [];
}
