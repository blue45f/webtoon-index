import {
  STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_LEGEND_ENTRIES,
  STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_LEGEND_TEXT_BYTES,
  type StudioBg3dStableIdLegendEntry,
} from "./studio-bg3d-artifact-capture-v2";

export interface StudioBg3dStableIdDescriptor {
  readonly stableId: string;
  readonly label: string;
}

export interface StudioBg3dStableIdPackingPlan {
  readonly legend: readonly StudioBg3dStableIdLegendEntry[];
  readonly idByStableId: Readonly<Record<string, number>>;
}

export type StudioBg3dStableIdPackingErrorCode =
  | "duplicate-stable-id"
  | "invalid-descriptor"
  | "invalid-dimensions"
  | "invalid-readback"
  | "palette-exhausted"
  | "unknown-rendered-id";

export class StudioBg3dStableIdPackingError extends Error {
  constructor(readonly code: StudioBg3dStableIdPackingErrorCode) {
    super(`Studio Babylon stable-ID packing failed: ${code}`);
    this.name = "StudioBg3dStableIdPackingError";
  }
}

const MAX_PIXELS = 16_777_216;
const MAX_LABEL_LENGTH = 160;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~:/-]{0,127}$/u;
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u;
const UTF8_ENCODER = new TextEncoder();

function fail(code: StudioBg3dStableIdPackingErrorCode): never {
  throw new StudioBg3dStableIdPackingError(code);
}

function boundedPixels(width: number, height: number): number {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return fail("invalid-dimensions");
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_PIXELS) {
    return fail("invalid-dimensions");
  }
  return pixels;
}

function isSafeDescriptor(
  descriptor: StudioBg3dStableIdDescriptor,
): boolean {
  const keys = typeof descriptor === "object" && descriptor !== null
    ? Object.keys(descriptor)
    : [];
  return (
    typeof descriptor === "object" &&
    descriptor !== null &&
    Object.getPrototypeOf(descriptor) === Object.prototype &&
    keys.length === 2 &&
    keys.includes("stableId") &&
    keys.includes("label") &&
    typeof descriptor.stableId === "string" &&
    STABLE_ID_PATTERN.test(descriptor.stableId) &&
    typeof descriptor.label === "string" &&
    descriptor.label.length > 0 &&
    descriptor.label.length <= MAX_LABEL_LENGTH &&
    descriptor.label.trim() === descriptor.label &&
    !CONTROL_CHARACTER_PATTERN.test(descriptor.label)
  );
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function createStudioBg3dStableIdPackingPlan(
  descriptors: readonly StudioBg3dStableIdDescriptor[],
): StudioBg3dStableIdPackingPlan {
  if (
    !Array.isArray(descriptors) ||
    Object.getPrototypeOf(descriptors) !== Array.prototype
  ) {
    return fail("invalid-descriptor");
  }
  if (descriptors.length > STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_LEGEND_ENTRIES) {
    return fail("palette-exhausted");
  }
  if (descriptors.some((descriptor) => !isSafeDescriptor(descriptor))) {
    return fail("invalid-descriptor");
  }
  const ordered = [...descriptors].sort((left, right) =>
    compareCodeUnits(left.stableId, right.stableId)
  );
  const legend: StudioBg3dStableIdLegendEntry[] = [];
  const idByStableId = Object.create(null) as Record<string, number>;
  let textBytes = 0;
  for (const [index, descriptor] of ordered.entries()) {
    if (Object.hasOwn(idByStableId, descriptor.stableId)) {
      return fail("duplicate-stable-id");
    }
    textBytes += UTF8_ENCODER.encode(descriptor.stableId).byteLength +
      UTF8_ENCODER.encode(descriptor.label).byteLength;
    if (textBytes > STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_LEGEND_TEXT_BYTES) {
      return fail("palette-exhausted");
    }
    const id = index + 1;
    idByStableId[descriptor.stableId] = id;
    legend.push(Object.freeze({
      id,
      stableId: descriptor.stableId,
      label: descriptor.label,
    }));
  }
  return Object.freeze({
    legend: Object.freeze(legend),
    idByStableId: Object.freeze(idByStableId),
  });
}

export function encodeStudioBg3dStableIdRgba(
  id: number,
): readonly [number, number, number, number] {
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    id > STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_LEGEND_ENTRIES
  ) {
    return fail("palette-exhausted");
  }
  return Object.freeze([
    id & 0xff,
    (id >>> 8) & 0xff,
    (id >>> 16) & 0xff,
    0xff,
  ]);
}

export interface DecodeStudioBg3dStableIdReadbackInput {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly flipY: boolean;
  readonly swapRedBlue: boolean;
  readonly plan: StudioBg3dStableIdPackingPlan;
}

function isSafeLegendEntry(
  value: unknown,
  expectedId: number,
  idByStableId: Readonly<Record<string, number>>,
): value is StudioBg3dStableIdLegendEntry {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    !Object.isFrozen(value)
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === 3 &&
    keys.includes("id") &&
    keys.includes("stableId") &&
    keys.includes("label") &&
    record.id === expectedId &&
    typeof record.stableId === "string" &&
    STABLE_ID_PATTERN.test(record.stableId) &&
    typeof record.label === "string" &&
    record.label.length > 0 &&
    record.label.length <= MAX_LABEL_LENGTH &&
    record.label.trim() === record.label &&
    !CONTROL_CHARACTER_PATTERN.test(record.label) &&
    idByStableId[record.stableId] === expectedId
  );
}

function isSafePackingPlan(value: unknown): value is StudioBg3dStableIdPackingPlan {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    !Object.isFrozen(value)
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    !Object.hasOwn(record, "legend") ||
    !Object.hasOwn(record, "idByStableId") ||
    !Array.isArray(record.legend) ||
    Object.getPrototypeOf(record.legend) !== Array.prototype ||
    !Object.isFrozen(record.legend) ||
    record.legend.length > STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_LEGEND_ENTRIES ||
    typeof record.idByStableId !== "object" ||
    record.idByStableId === null ||
    Object.getPrototypeOf(record.idByStableId) !== null ||
    !Object.isFrozen(record.idByStableId) ||
    Object.keys(record.idByStableId).length !== record.legend.length
  ) {
    return false;
  }
  const idByStableId = record.idByStableId as Readonly<Record<string, number>>;
  let textBytes = 0;
  let previousStableId: string | null = null;
  for (const [index, entry] of record.legend.entries()) {
    if (!isSafeLegendEntry(entry, index + 1, idByStableId)) return false;
    if (
      previousStableId !== null &&
      compareCodeUnits(previousStableId, entry.stableId) >= 0
    ) {
      return false;
    }
    previousStableId = entry.stableId;
    textBytes += UTF8_ENCODER.encode(entry.stableId).byteLength +
      UTF8_ENCODER.encode(entry.label).byteLength;
    if (textBytes > STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_LEGEND_TEXT_BYTES) {
      return false;
    }
  }
  return true;
}

function hasFixedExclusiveArrayBuffer(
  data: Uint8Array,
  expectedByteLength: number,
): boolean {
  const buffer = data.buffer;
  if (
    !(buffer instanceof ArrayBuffer) ||
    Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype ||
    data.byteOffset !== 0 ||
    data.byteLength !== expectedByteLength ||
    buffer.byteLength !== expectedByteLength
  ) {
    return false;
  }
  const state = buffer as ArrayBuffer & {
    readonly detached?: unknown;
    readonly maxByteLength?: unknown;
    readonly resizable?: unknown;
  };
  return (
    state.detached !== true &&
    state.resizable !== true &&
    (
      typeof state.maxByteLength !== "number" ||
      state.maxByteLength === buffer.byteLength
    )
  );
}

export function decodeStudioBg3dStableIdReadback(
  input: DecodeStudioBg3dStableIdReadbackInput,
): Uint32Array {
  const pixels = boundedPixels(input.width, input.height);
  if (
    !(input.data instanceof Uint8Array) ||
    Object.getPrototypeOf(input.data) !== Uint8Array.prototype ||
    input.data.length !== pixels * 4 ||
    !hasFixedExclusiveArrayBuffer(input.data, pixels * 4) ||
    typeof input.flipY !== "boolean" ||
    typeof input.swapRedBlue !== "boolean" ||
    !isSafePackingPlan(input.plan)
  ) {
    return fail("invalid-readback");
  }
  const maximumId = input.plan.legend.length;
  const decoded = new Uint32Array(pixels);
  for (let targetY = 0; targetY < input.height; targetY += 1) {
    const sourceY = input.flipY ? input.height - targetY - 1 : targetY;
    for (let x = 0; x < input.width; x += 1) {
      const targetPixel = targetY * input.width + x;
      const sourceOffset = (sourceY * input.width + x) * 4;
      const red = input.data[sourceOffset + (input.swapRedBlue ? 2 : 0)]!;
      const green = input.data[sourceOffset + 1]!;
      const blue = input.data[sourceOffset + (input.swapRedBlue ? 0 : 2)]!;
      const alpha = input.data[sourceOffset + 3]!;
      const id = red | (green << 8) | (blue << 16);
      if (id === 0) {
        if (alpha !== 0) return fail("unknown-rendered-id");
        decoded[targetPixel] = 0;
        continue;
      }
      if (alpha !== 0xff || id > maximumId) return fail("unknown-rendered-id");
      decoded[targetPixel] = id;
    }
  }
  return decoded;
}
