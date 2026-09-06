import {
  STUDIO_RASTER_INTERCHANGE_LIMITS,
  type StudioRgbaBitmap,
  type StudioRasterDecoded,
  type StudioRasterEncoded,
  type StudioRasterInterchangeFormat,
} from "./studio-raster-interchange";

export const STUDIO_RASTER_INTERCHANGE_WORKER_VERSION = 2 as const;

interface StudioRasterInterchangeWorkerRequestBase {
  readonly version: typeof STUDIO_RASTER_INTERCHANGE_WORKER_VERSION;
  readonly requestId: string;
}

export interface StudioRasterInterchangeWorkerEncodeRequest
  extends StudioRasterInterchangeWorkerRequestBase {
  readonly type: "studio-raster-interchange/encode";
  readonly format: StudioRasterInterchangeFormat;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface StudioRasterInterchangeWorkerDecodeRequest
  extends StudioRasterInterchangeWorkerRequestBase {
  readonly type: "studio-raster-interchange/decode";
  readonly bytes: Uint8Array;
  readonly expectedFormat?: StudioRasterInterchangeFormat;
}

export type StudioRasterInterchangeWorkerRequest =
  | StudioRasterInterchangeWorkerEncodeRequest
  | StudioRasterInterchangeWorkerDecodeRequest;

export type StudioRasterInterchangeWorkerSuccessResponse =
  | {
      readonly type: "studio-raster-interchange/encode-success";
      readonly version: typeof STUDIO_RASTER_INTERCHANGE_WORKER_VERSION;
      readonly requestId: string;
      readonly result: StudioRasterEncoded;
    }
  | {
      readonly type: "studio-raster-interchange/decode-success";
      readonly version: typeof STUDIO_RASTER_INTERCHANGE_WORKER_VERSION;
      readonly requestId: string;
      readonly result: StudioRasterDecoded;
    };

export type StudioRasterInterchangeWorkerResponse =
  | {
      readonly type: "studio-raster-interchange/ready";
      readonly version: typeof STUDIO_RASTER_INTERCHANGE_WORKER_VERSION;
    }
  | StudioRasterInterchangeWorkerSuccessResponse
  | {
      readonly type: "studio-raster-interchange/failure";
      readonly version: typeof STUDIO_RASTER_INTERCHANGE_WORKER_VERSION;
      readonly requestId: string;
      readonly error: { readonly name: string; readonly message: string };
    };

const READY_KEYS = ["type", "version"] as const;
const SUCCESS_KEYS = ["type", "version", "requestId", "result"] as const;
const FAILURE_KEYS = ["type", "version", "requestId", "error"] as const;
const ERROR_KEYS = ["name", "message"] as const;
const ENCODE_RESULT_KEYS = [
  "bytes",
  "extension",
  "mimeType",
  "warnings",
  "lossy",
] as const;
const DECODE_RESULT_KEYS = ["bitmap", "format", "warnings"] as const;
const BITMAP_KEYS = ["width", "height", "data"] as const;
const MAX_REQUEST_ID_CODE_UNITS = 128;
const MAX_WARNING_COUNT = 64;
const MAX_WARNING_CODE_UNITS = 2_048;
const MAX_ERROR_NAME_CODE_UNITS = 128;
const MAX_ERROR_MESSAGE_CODE_UNITS = 2_048;

const FORMAT_METADATA = Object.freeze({
  bmp: Object.freeze({ extension: ".bmp", mimeType: "image/bmp" }),
  tga: Object.freeze({ extension: ".tga", mimeType: "image/x-tga" }),
  ppm: Object.freeze({
    extension: ".ppm",
    mimeType: "image/x-portable-pixmap",
  }),
  pam: Object.freeze({
    extension: ".pam",
    mimeType: "image/x-portable-arbitrarymap",
  }),
  qoi: Object.freeze({ extension: ".qoi", mimeType: "image/qoi" }),
  tiff: Object.freeze({ extension: ".tiff", mimeType: "image/tiff" }),
} satisfies Readonly<
  Record<
    StudioRasterInterchangeFormat,
    Readonly<{ extension: string; mimeType: string }>
  >
>);

function ownDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null {
  try {
    if (
      value === null
      || typeof value !== "object"
      || Array.isArray(value)
    ) {
      return null;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length
      || keys.some(
        (key) =>
          typeof key !== "string" || !expectedKeys.includes(key),
      )
    ) {
      return null;
    }
    const record: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor
        || !descriptor.enumerable
        || !("value" in descriptor)
      ) {
        return null;
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return null;
  }
}

function exactDenseArray(
  value: unknown,
  maximumLength: number,
): readonly unknown[] | null {
  try {
    if (
      !Array.isArray(value)
      || Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return null;
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor
      || !("value" in lengthDescriptor)
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
      || lengthDescriptor.value > maximumLength
    ) {
      return null;
    }
    const length = lengthDescriptor.value as number;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== length + 1
      || !keys.includes("length")
    ) {
      return null;
    }
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(
        value,
        String(index),
      );
      if (
        !descriptor
        || !descriptor.enumerable
        || !("value" in descriptor)
      ) {
        return null;
      }
      values[index] = descriptor.value;
    }
    return values;
  } catch {
    return null;
  }
}

function normalizedWarnings(value: unknown): readonly string[] | null {
  const warnings = exactDenseArray(value, MAX_WARNING_COUNT);
  if (!warnings) return null;
  const normalized: string[] = [];
  for (let index = 0; index < warnings.length; index += 1) {
    const warning = warnings[index];
    if (
      typeof warning !== "string"
      || warning.length > MAX_WARNING_CODE_UNITS
    ) {
      return null;
    }
    normalized[index] = warning;
  }
  return Object.freeze(normalized);
}

function validRequestId(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > MAX_REQUEST_ID_CODE_UNITS
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

function rasterFormat(
  value: unknown,
): StudioRasterInterchangeFormat | null {
  return typeof value === "string"
    && Object.hasOwn(FORMAT_METADATA, value)
    ? value as StudioRasterInterchangeFormat
    : null;
}

function exactOwnedBytes(value: unknown): Uint8Array | null {
  try {
    if (
      !(value instanceof Uint8Array)
      || !(value.buffer instanceof ArrayBuffer)
    ) {
      return null;
    }
    if (
      value.byteOffset === 0
      && value.byteLength === value.buffer.byteLength
    ) {
      return value;
    }
    return Uint8Array.from(value);
  } catch {
    return null;
  }
}

function exactOwnedPixels(
  value: unknown,
): StudioRgbaBitmap["data"] | null {
  try {
    if (
      !(value instanceof Uint8Array)
      && !(value instanceof Uint8ClampedArray)
    ) {
      return null;
    }
    if (!(value.buffer instanceof ArrayBuffer)) return null;
    if (
      value.byteOffset === 0
      && value.byteLength === value.buffer.byteLength
    ) {
      return value;
    }
    return value instanceof Uint8ClampedArray
      ? Uint8ClampedArray.from(value)
      : Uint8Array.from(value);
  } catch {
    return null;
  }
}

function normalizeEncodeResult(
  value: unknown,
): StudioRasterEncoded | null {
  const record = ownDataRecord(value, ENCODE_RESULT_KEYS);
  const bytes = record ? exactOwnedBytes(record.bytes) : null;
  const warnings = record
    ? normalizedWarnings(record.warnings)
    : null;
  if (
    !record
    || !bytes
    || bytes.byteLength < 1
    || bytes.byteLength > STUDIO_RASTER_INTERCHANGE_LIMITS.maxOutputBytes
    || typeof record.extension !== "string"
    || typeof record.mimeType !== "string"
    || typeof record.lossy !== "boolean"
    || !warnings
  ) {
    return null;
  }
  const format = rasterFormat(record.extension.slice(1));
  if (
    !format
    || FORMAT_METADATA[format].extension !== record.extension
    || FORMAT_METADATA[format].mimeType !== record.mimeType
  ) {
    return null;
  }
  return Object.freeze({
    bytes,
    extension: FORMAT_METADATA[format].extension,
    mimeType: FORMAT_METADATA[format].mimeType,
    warnings,
    lossy: record.lossy,
  }) as StudioRasterEncoded;
}

function normalizeDecodeResult(
  value: unknown,
): StudioRasterDecoded | null {
  const record = ownDataRecord(value, DECODE_RESULT_KEYS);
  const bitmap = record
    ? ownDataRecord(record.bitmap, BITMAP_KEYS)
    : null;
  const format = record ? rasterFormat(record.format) : null;
  const warnings = record
    ? normalizedWarnings(record.warnings)
    : null;
  const pixels = bitmap
    && typeof bitmap.width === "number"
    && typeof bitmap.height === "number"
    ? bitmap.width * bitmap.height
    : Number.NaN;
  const data = bitmap ? exactOwnedPixels(bitmap.data) : null;
  if (
    !record
    || !bitmap
    || !format
    || !warnings
    || !Number.isSafeInteger(bitmap.width)
    || !Number.isSafeInteger(bitmap.height)
    || (bitmap.width as number) < 1
    || (bitmap.height as number) < 1
    || (bitmap.width as number) > STUDIO_RASTER_INTERCHANGE_LIMITS.maxWidth
    || (bitmap.height as number) > STUDIO_RASTER_INTERCHANGE_LIMITS.maxHeight
    || !Number.isSafeInteger(pixels)
    || pixels < 1
    || pixels > STUDIO_RASTER_INTERCHANGE_LIMITS.maxPixels
    || !data
    || data.byteLength !== pixels * 4
    || data.byteLength > STUDIO_RASTER_INTERCHANGE_LIMITS.maxOutputBytes
  ) {
    return null;
  }
  return Object.freeze({
    bitmap: Object.freeze({
      width: bitmap.width,
      height: bitmap.height,
      data,
    }),
    format,
    warnings,
  }) as StudioRasterDecoded;
}

/**
 * Treats every Worker message as hostile structured-clone data and returns a
 * canonical, bounded response. Typed-array subviews are copied into exact
 * private buffers before they can escape the client boundary.
 */
export function parseStudioRasterInterchangeWorkerResponse(
  value: unknown,
): StudioRasterInterchangeWorkerResponse | null {
  try {
    const ready = ownDataRecord(value, READY_KEYS);
    if (
      ready
      && ready.type === "studio-raster-interchange/ready"
      && ready.version === STUDIO_RASTER_INTERCHANGE_WORKER_VERSION
    ) {
      return Object.freeze({
        type: "studio-raster-interchange/ready",
        version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
      });
    }

    const success = ownDataRecord(value, SUCCESS_KEYS);
    if (
      success
      && success.version === STUDIO_RASTER_INTERCHANGE_WORKER_VERSION
      && validRequestId(success.requestId)
    ) {
      if (success.type === "studio-raster-interchange/encode-success") {
        const result = normalizeEncodeResult(success.result);
        return result
          ? Object.freeze({
              type: "studio-raster-interchange/encode-success",
              version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
              requestId: success.requestId,
              result,
            })
          : null;
      }
      if (success.type === "studio-raster-interchange/decode-success") {
        const result = normalizeDecodeResult(success.result);
        return result
          ? Object.freeze({
              type: "studio-raster-interchange/decode-success",
              version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
              requestId: success.requestId,
              result,
            })
          : null;
      }
    }

    const failure = ownDataRecord(value, FAILURE_KEYS);
    const error = failure
      ? ownDataRecord(failure.error, ERROR_KEYS)
      : null;
    if (
      failure
      && error
      && failure.type === "studio-raster-interchange/failure"
      && failure.version === STUDIO_RASTER_INTERCHANGE_WORKER_VERSION
      && validRequestId(failure.requestId)
      && typeof error.name === "string"
      && error.name.length >= 1
      && error.name.length <= MAX_ERROR_NAME_CODE_UNITS
      && typeof error.message === "string"
      && error.message.length >= 1
      && error.message.length <= MAX_ERROR_MESSAGE_CODE_UNITS
    ) {
      return Object.freeze({
        type: "studio-raster-interchange/failure",
        version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
        requestId: failure.requestId,
        error: Object.freeze({
          name: error.name,
          message: error.message,
        }),
      });
    }
  } catch {
    // Hostile proxies and typed-array subclasses fail closed.
  }
  return null;
}

function exactTransferBuffer(
  view: Uint8Array | Uint8ClampedArray,
): ArrayBuffer | null {
  try {
    const buffer = view.buffer;
    return (
      buffer instanceof ArrayBuffer
      && view.byteOffset === 0
      && view.byteLength === buffer.byteLength
    )
      ? buffer
      : null;
  } catch {
    return null;
  }
}

function replaceSubviewWithPrivateTransfer(
  owner: object,
  key: string,
  view: Uint8Array | Uint8ClampedArray,
): ArrayBuffer | null {
  const exact = exactTransferBuffer(view);
  if (exact) return exact;
  try {
    const privateView = view instanceof Uint8ClampedArray
      ? Uint8ClampedArray.from(view)
      : Uint8Array.from(view);
    Object.defineProperty(owner, key, {
      configurable: true,
      enumerable: true,
      value: privateView,
      writable: true,
    });
    return privateView.buffer;
  } catch {
    return null;
  }
}

export function studioRasterInterchangeRequestTransfers(
  request: StudioRasterInterchangeWorkerRequest,
): Transferable[] {
  const buffer = replaceSubviewWithPrivateTransfer(
    request,
    request.type === "studio-raster-interchange/encode"
      ? "data"
      : "bytes",
    request.type === "studio-raster-interchange/encode"
      ? request.data
      : request.bytes,
  );
  return buffer ? [buffer] : [];
}

export function studioRasterInterchangeResponseTransfers(
  response: StudioRasterInterchangeWorkerResponse
): Transferable[] {
  if (response.type === "studio-raster-interchange/encode-success") {
    const buffer = replaceSubviewWithPrivateTransfer(
      response.result,
      "bytes",
      response.result.bytes,
    );
    return buffer ? [buffer] : [];
  }
  if (response.type === "studio-raster-interchange/decode-success") {
    const buffer = replaceSubviewWithPrivateTransfer(
      response.result.bitmap,
      "data",
      response.result.bitmap.data,
    );
    return buffer ? [buffer] : [];
  }
  return [];
}
