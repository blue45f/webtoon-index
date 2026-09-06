import {
  STUDIO_VRM_TEXTURE_MAX_DIMENSION,
  STUDIO_VRM_TEXTURE_MAX_TEXELS,
} from "./studio-vrm-texture-uv";

import type {
  StudioVrmTextureFillRequest as StudioVrmTextureFillCoreRequest,
  StudioVrmTextureFillResult,
} from "./studio-vrm-texture-fill";

export const STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION = 1 as const;

export interface StudioVrmTextureFillWorkerReadyMessage {
  readonly type: "studio-vrm-texture-fill/ready";
  readonly version: typeof STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION;
}

export interface StudioVrmTextureFillWorkerRunMessage {
  readonly type: "studio-vrm-texture-fill/run";
  readonly version: typeof STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION;
  readonly requestId: string;
  /** Clone-safe input; cancellation terminates the one-shot Worker realm. */
  readonly request: StudioVrmTextureFillCoreRequest;
}

export type StudioVrmTextureFillWorkerRequest = StudioVrmTextureFillWorkerRunMessage;

export interface StudioVrmTextureFillWorkerSuccessMessage {
  readonly type: "studio-vrm-texture-fill/success";
  readonly version: typeof STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly result: StudioVrmTextureFillResult;
}

export interface StudioVrmTextureFillWorkerSerializedError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
}

export interface StudioVrmTextureFillWorkerFailureMessage {
  readonly type: "studio-vrm-texture-fill/failure";
  readonly version: typeof STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION;
  readonly requestId: string | null;
  readonly error: StudioVrmTextureFillWorkerSerializedError;
}

export type StudioVrmTextureFillWorkerResponseMessage =
  | StudioVrmTextureFillWorkerReadyMessage
  | StudioVrmTextureFillWorkerSuccessMessage
  | StudioVrmTextureFillWorkerFailureMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactDataKeys(value: unknown, expectedKeys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actualKeys = Object.keys(descriptors).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index]) &&
    actualKeys.every((key) => {
      const descriptor = descriptors[key];
      return descriptor !== undefined && "value" in descriptor;
    });
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function isOwnedUint8ClampedArray(value: unknown): value is Uint8ClampedArray<ArrayBuffer> {
  return value instanceof Uint8ClampedArray &&
    value.buffer instanceof ArrayBuffer &&
    value.byteOffset === 0 &&
    value.byteLength === value.buffer.byteLength;
}

function isOwnedUint8Array(value: unknown): value is Uint8Array<ArrayBuffer> {
  return value instanceof Uint8Array &&
    value.buffer instanceof ArrayBuffer &&
    value.byteOffset === 0 &&
    value.byteLength === value.buffer.byteLength;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isByte(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
}

function isSeed(value: unknown, width: number, height: number): boolean {
  return hasExactDataKeys(value, ["x", "y"]) &&
    isRecord(value) &&
    isNonNegativeSafeInteger(value.x) &&
    value.x < width &&
    isNonNegativeSafeInteger(value.y) &&
    value.y < height;
}

function isBounds(
  value: unknown,
): value is { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null {
  if (value === null) return true;
  if (
    !hasExactDataKeys(value, ["x", "y", "width", "height"]) ||
    !isRecord(value) ||
    !isNonNegativeSafeInteger(value.x) ||
    !isNonNegativeSafeInteger(value.y) ||
    !isPositiveSafeInteger(value.width) ||
    !isPositiveSafeInteger(value.height)
  ) return false;
  return value.x <= Number.MAX_SAFE_INTEGER - value.width &&
    value.y <= Number.MAX_SAFE_INTEGER - value.height;
}

function isSeedRgba(value: unknown): value is readonly [number, number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    Object.keys(value).length !== 4
  ) return false;
  return isByte(value[0]) &&
    isByte(value[1]) &&
    isByte(value[2]) &&
    isByte(value[3]);
}

function isSerializedError(value: unknown): value is StudioVrmTextureFillWorkerSerializedError {
  if (!isRecord(value)) return false;
  const hasCode = Object.hasOwn(value, "code");
  if (!hasExactDataKeys(value, hasCode ? ["name", "message", "code"] : ["name", "message"])) {
    return false;
  }
  return typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 128 &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    value.message.length <= 1_024 &&
    (!hasCode || (
      typeof value.code === "string" &&
      value.code.length > 0 &&
      value.code.length <= 128
    ));
}

/** Exact clone-safe request guard used before either transfer or computation. */
export function isStudioVrmTextureFillRequest(
  value: unknown,
): value is StudioVrmTextureFillCoreRequest {
  if (
    !hasExactDataKeys(value, [
      "pixels",
      "width",
      "height",
      "seed",
      "tolerance",
      "scope",
    ]) ||
    !isRecord(value) ||
    !isOwnedUint8ClampedArray(value.pixels) ||
    !isPositiveSafeInteger(value.width) ||
    !isPositiveSafeInteger(value.height) ||
    value.width > STUDIO_VRM_TEXTURE_MAX_DIMENSION ||
    value.height > STUDIO_VRM_TEXTURE_MAX_DIMENSION ||
    value.width > Math.floor(Number.MAX_SAFE_INTEGER / value.height)
  ) return false;
  const pixelCount = value.width * value.height;
  const tolerance = value.tolerance;
  if (
    pixelCount > STUDIO_VRM_TEXTURE_MAX_TEXELS ||
    pixelCount > Math.floor(Number.MAX_SAFE_INTEGER / 4) ||
    value.pixels.length !== pixelCount * 4 ||
    !isSeed(value.seed, value.width, value.height) ||
    typeof tolerance !== "number" ||
    !Number.isSafeInteger(tolerance) ||
    tolerance < 0 ||
    tolerance > 255
  ) return false;
  return value.scope === "contiguous" || value.scope === "whole-material";
}

/**
 * Validates the immutable Worker envelope and clone-safe transferable ownership boundary. The fill
 * core repeats its numeric/domain admission before allocating the output mask.
 */
export function isStudioVrmTextureFillWorkerRunMessage(
  value: unknown,
): value is StudioVrmTextureFillWorkerRunMessage {
  if (
    !hasExactDataKeys(value, ["type", "version", "requestId", "request"]) ||
    !isRecord(value)
  ) return false;
  if (
    value.type !== "studio-vrm-texture-fill/run" ||
    value.version !== STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION ||
    !isRequestId(value.requestId) ||
    !isStudioVrmTextureFillRequest(value.request)
  ) return false;
  return true;
}

export function isStudioVrmTextureFillWorkerResponseMessage(
  value: unknown,
): value is StudioVrmTextureFillWorkerResponseMessage {
  if (!isRecord(value)) return false;
  if (value.type === "studio-vrm-texture-fill/ready") {
    return hasExactDataKeys(value, ["type", "version"]) &&
      value.version === STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION;
  }
  if (value.type === "studio-vrm-texture-fill/failure") {
    return hasExactDataKeys(value, ["type", "version", "requestId", "error"]) &&
      value.version === STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION &&
      (value.requestId === null || isRequestId(value.requestId)) &&
      isSerializedError(value.error);
  }
  if (
    value.type !== "studio-vrm-texture-fill/success" ||
    !hasExactDataKeys(value, ["type", "version", "requestId", "result"]) ||
    value.version !== STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION ||
    !isRequestId(value.requestId) ||
    !isRecord(value.result)
  ) return false;
  const bounds = value.result.bounds;
  if (
    !hasExactDataKeys(value.result, [
      "bitMask",
      "bounds",
      "matchedCount",
      "seedRgba",
    ]) ||
    !isOwnedUint8Array(value.result.bitMask) ||
    value.result.bitMask.byteLength > Math.ceil(STUDIO_VRM_TEXTURE_MAX_TEXELS / 8) ||
    !isBounds(bounds) ||
    !isNonNegativeSafeInteger(value.result.matchedCount) ||
    value.result.matchedCount > STUDIO_VRM_TEXTURE_MAX_TEXELS ||
    value.result.matchedCount > value.result.bitMask.byteLength * 8 ||
    !isSeedRgba(value.result.seedRgba)
  ) return false;
  if (bounds === null) return value.result.matchedCount === 0;
  const boundsArea = bounds.width * bounds.height;
  return Number.isSafeInteger(boundsArea) &&
    boundsArea <= STUDIO_VRM_TEXTURE_MAX_TEXELS &&
    value.result.matchedCount > 0 &&
    value.result.matchedCount <= boundsArea;
}

function uniqueArrayBufferTransfers(values: readonly unknown[]): Transferable[] {
  const seen = new Set<ArrayBuffer>();
  const transfers: Transferable[] = [];
  for (const value of values) {
    const buffer = ArrayBuffer.isView(value) ? value.buffer : value;
    // SharedArrayBuffer is cloneable, but it is never transferable. The `instanceof` check also
    // keeps hostile ArrayBuffer-like objects out of postMessage's transfer list.
    if (!(buffer instanceof ArrayBuffer) || seen.has(buffer)) continue;
    seen.add(buffer);
    transfers.push(buffer);
  }
  return transfers;
}

export function studioVrmTextureFillRequestTransfers(
  message: StudioVrmTextureFillWorkerRunMessage,
): Transferable[] {
  return uniqueArrayBufferTransfers([message.request.pixels]);
}

export function studioVrmTextureFillSuccessTransfers(
  message: StudioVrmTextureFillWorkerSuccessMessage,
): Transferable[] {
  return uniqueArrayBufferTransfers([message.result.bitMask]);
}
