import { STUDIO_BG3D_LT_RENDER_MAX_PIXELS } from "./studio-bg3d-lt-render";
import { STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION } from "./studio-bg3d-shot-batch-limits";

import type {
  StudioBg3dLtRasterLayer,
  StudioBg3dLtRasterLayerRole,
} from "./studio-bg3d-lt-render";

/** Versioned independently from the persisted scene and batch archive protocols. */
export const STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION = 1 as const;
export const STUDIO_BG3D_SHOT_PNG_WORKER_MAX_LAYERS = 3;
/** RGBA worst-case storage plus bounded PNG framing/compression overhead. */
export const STUDIO_BG3D_SHOT_PNG_WORKER_MAX_OUTPUT_BYTES =
  STUDIO_BG3D_LT_RENDER_MAX_PIXELS * 4 + 1_048_576;

export interface StudioBg3dShotPngWorkerLayer {
  readonly role: StudioBg3dLtRasterLayerRole;
  readonly width: number;
  readonly height: number;
  /** Fresh, tightly packed RGBA8 storage owned by this request. */
  readonly dataBuffer: ArrayBuffer;
}

export interface StudioBg3dShotPngWorkerRequest {
  readonly version: typeof STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION;
  readonly kind: "encode";
  readonly requestId: number;
  readonly width: number;
  readonly height: number;
  readonly layers: readonly StudioBg3dShotPngWorkerLayer[];
}

export type StudioBg3dShotPngWorkerResponse =
  | {
      /** Emitted after the Worker has proved it can create a 2D OffscreenCanvas. */
      readonly version: typeof STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION;
      readonly kind: "ready";
    }
  | {
      /** Worker-side capability failure; the selected Worker operation ends as unavailable. */
      readonly version: typeof STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION;
      readonly kind: "unavailable";
      readonly code: "offscreen-canvas";
    }
  | {
      readonly version: typeof STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION;
      readonly kind: "result";
      readonly requestId: number;
      readonly width: number;
      readonly height: number;
      readonly png: Blob;
    }
  | {
      readonly version: typeof STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION;
      readonly kind: "error";
      readonly requestId: number;
      readonly code: "protocol" | "encode-failed";
    };

const REQUEST_KEYS = ["version", "kind", "requestId", "width", "height", "layers"] as const;
const LAYER_KEYS = ["role", "width", "height", "dataBuffer"] as const;
const READY_KEYS = ["version", "kind"] as const;
const UNAVAILABLE_KEYS = ["version", "kind", "code"] as const;
const RESULT_KEYS = ["version", "kind", "requestId", "width", "height", "png"] as const;
const ERROR_KEYS = ["version", "kind", "requestId", "code"] as const;

const ROLE_ORDER: Readonly<Record<StudioBg3dLtRasterLayerRole, number>> = {
  color: 0,
  tone: 0,
  "texture-line": 1,
  "main-line": 2,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isRequestId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function dimensions(
  widthValue: unknown,
  heightValue: unknown,
): { readonly width: number; readonly height: number } | null {
  if (
    typeof widthValue !== "number" || !Number.isSafeInteger(widthValue) ||
    widthValue < 1 || widthValue > STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION ||
    typeof heightValue !== "number" || !Number.isSafeInteger(heightValue) ||
    heightValue < 1 || heightValue > STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION
  ) return null;
  const pixels = widthValue * heightValue;
  return Number.isSafeInteger(pixels) && pixels <= STUDIO_BG3D_LT_RENDER_MAX_PIXELS
    ? { width: widthValue, height: heightValue }
    : null;
}

function isLayer(
  value: unknown,
  width: number,
  height: number,
): value is StudioBg3dShotPngWorkerLayer {
  if (!isRecord(value) || !hasExactKeys(value, LAYER_KEYS)) return false;
  return typeof value.role === "string" &&
    Object.prototype.hasOwnProperty.call(ROLE_ORDER, value.role) &&
    value.width === width && value.height === height &&
    value.dataBuffer instanceof ArrayBuffer &&
    value.dataBuffer.byteLength === width * height * 4;
}

/** Strict admission for both the main-thread envelope and the transferred Worker request. */
export function isStudioBg3dShotPngWorkerRequest(
  value: unknown,
): value is StudioBg3dShotPngWorkerRequest {
  try {
    const shape = isRecord(value) ? dimensions(value.width, value.height) : null;
    if (
      !isRecord(value) || !hasExactKeys(value, REQUEST_KEYS) ||
      value.version !== STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION ||
      value.kind !== "encode" || !isRequestId(value.requestId) ||
      !shape || !Array.isArray(value.layers) ||
      value.layers.length < 1 || value.layers.length > STUDIO_BG3D_SHOT_PNG_WORKER_MAX_LAYERS
    ) return false;

    const roles = new Set<StudioBg3dLtRasterLayerRole>();
    let previousOrder = -1;
    for (const layer of value.layers) {
      if (!isLayer(layer, shape.width, shape.height) || roles.has(layer.role)) return false;
      const order = ROLE_ORDER[layer.role];
      if (order <= previousOrder) return false;
      roles.add(layer.role);
      previousOrder = order;
    }
    return true;
  } catch {
    return false;
  }
}

export function isStudioBg3dShotPngWorkerResponse(
  value: unknown,
): value is StudioBg3dShotPngWorkerResponse {
  try {
    if (
      !isRecord(value) ||
      value.version !== STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION
    ) return false;
    if (value.kind === "ready") return hasExactKeys(value, READY_KEYS);
    if (value.kind === "unavailable") {
      return hasExactKeys(value, UNAVAILABLE_KEYS) && value.code === "offscreen-canvas";
    }
    if (!isRequestId(value.requestId)) return false;
    if (value.kind === "error") {
      return hasExactKeys(value, ERROR_KEYS) &&
        (value.code === "protocol" || value.code === "encode-failed");
    }
    return value.kind === "result" && hasExactKeys(value, RESULT_KEYS) &&
      dimensions(value.width, value.height) !== null && value.png instanceof Blob &&
      value.png.type === "image/png" && value.png.size >= 24 &&
      value.png.size <= STUDIO_BG3D_SHOT_PNG_WORKER_MAX_OUTPUT_BYTES;
  } catch {
    return false;
  }
}

export function studioBg3dShotPngWorkerRequestTransfers(
  request: StudioBg3dShotPngWorkerRequest,
): Transferable[] {
  return request.layers.map((layer) => layer.dataBuffer);
}

/** Clone-safe public input shape retained for boundary tests and adapters. */
export type StudioBg3dShotPngInputLayer = Pick<
  StudioBg3dLtRasterLayer,
  "role" | "width" | "height" | "data"
>;
