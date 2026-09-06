/**
 * Renderer-neutral bridge from a canonical top-down 3D object-ID plane to the Studio filter-mask
 * encoding. The bridge is deliberately fail-closed: a malformed legend or a single unregistered
 * non-background pixel invalidates the entire mask instead of leaking a partial selection.
 */

import {
  STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_DIMENSION,
  STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_LEGEND_ENTRIES,
  STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_LEGEND_TEXT_BYTES,
  STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_PIXELS,
  type StudioBg3dStableIdLegendEntry,
} from "./studio-bg3d-artifact-capture-v2";

export const STUDIO_BG3D_MAGIC_FILTER_MASK_PROFILE =
  "rgba8-white-alpha-mask-topdown-v1" as const;

export interface BuildStudioBg3dMagicFilterMaskInput {
  readonly width: number;
  readonly height: number;
  /** Canonical top-down, row-major object IDs. Zero is the background. */
  readonly objectIds: Uint32Array;
  readonly legend: readonly StudioBg3dStableIdLegendEntry[];
  /** SceneDocument node ID. Its canonical capture identity is `obj/${selectedId}`. */
  readonly selectedId: string;
}

export interface StudioBg3dMagicFilterMaskBounds {
  /** Left edge in canonical top-down pixel coordinates. */
  readonly x: number;
  /** Top edge in canonical top-down pixel coordinates. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioBg3dMagicFilterMask {
  readonly profile: typeof STUDIO_BG3D_MAGIC_FILTER_MASK_PROFILE;
  readonly width: number;
  readonly height: number;
  readonly selectedId: string;
  readonly selectedStableId: string;
  readonly selectedNumericId: number;
  readonly selectedPixelCount: number;
  readonly totalPixelCount: number;
  readonly coverageRatio: number;
  readonly selectedBounds: StudioBg3dMagicFilterMaskBounds;
  /**
   * Fresh, exactly-sized caller-owned RGBA bytes. RGB is always white; alpha is 255 for selected
   * pixels and 0 elsewhere. No source or module-owned storage is shared with this view.
   */
  readonly data: Uint8Array;
}

export type StudioBg3dMagicFilterMaskErrorCode =
  | "duplicate-legend-numeric-id"
  | "duplicate-legend-stable-id"
  | "empty-selection"
  | "invalid-dimensions"
  | "invalid-input"
  | "invalid-object-id-buffer"
  | "invalid-selected-node-id"
  | "malformed-legend"
  | "selected-stable-id-missing"
  | "unexpected-object-id";

export class StudioBg3dMagicFilterMaskError extends Error {
  constructor(
    readonly code: StudioBg3dMagicFilterMaskErrorCode,
    cause?: unknown,
  ) {
    super(
      `Studio 3D Magic filter-mask conversion failed: ${code}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "StudioBg3dMagicFilterMaskError";
  }
}

type UnknownRecord = Record<PropertyKey, unknown>;

const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const STABLE_OBJECT_ID_PATTERN = /^obj\/[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const FORBIDDEN_ID_SET = new Set(["constructor", "prototype", "__proto__"]);
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u;
const LEGEND_LABEL_MAX_LENGTH = 160;
const UINT32_MAXIMUM = 0xffff_ffff;
const UTF8_ENCODER = new TextEncoder();
const INPUT_KEYS = Object.freeze([
  "width",
  "height",
  "objectIds",
  "legend",
  "selectedId",
]);
const LEGEND_ENTRY_KEYS = Object.freeze(["id", "stableId", "label"]);

function fail(
  code: StudioBg3dMagicFilterMaskErrorCode,
  cause?: unknown,
): never {
  throw new StudioBg3dMagicFilterMaskError(code, cause);
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactOwnStringKeys(
  record: UnknownRecord,
  expected: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(record);
  if (
    keys.length !== expected.length ||
    keys.some((key) => typeof key !== "string")
  ) {
    return false;
  }
  const expectedSet = new Set(expected);
  return keys.every((key) => expectedSet.has(key as string));
}

function ownDataValue(
  record: UnknownRecord,
  key: string,
  code: StudioBg3dMagicFilterMaskErrorCode = "invalid-input",
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : fail(code);
}

function boundedPixelCount(width: unknown, height: unknown): number {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    (width as number) <= 0 ||
    (height as number) <= 0 ||
    (width as number) > STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_DIMENSION ||
    (height as number) > STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_DIMENSION
  ) {
    return fail("invalid-dimensions");
  }
  const pixels = (width as number) * (height as number);
  if (
    !Number.isSafeInteger(pixels) ||
    pixels > STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_PIXELS
  ) {
    return fail("invalid-dimensions");
  }
  return pixels;
}

function hasFixedExclusiveArrayBuffer(
  data: Uint32Array,
  expectedLength: number,
): boolean {
  const expectedByteLength = expectedLength * Uint32Array.BYTES_PER_ELEMENT;
  const buffer = data.buffer;
  if (
    !(buffer instanceof ArrayBuffer) ||
    Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype ||
    data.byteOffset !== 0 ||
    data.length !== expectedLength ||
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

function isSafeSelectedNodeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    NODE_ID_PATTERN.test(value) &&
    !FORBIDDEN_ID_SET.has(value.toLowerCase())
  );
}

function isSafeLegendLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= LEGEND_LABEL_MAX_LENGTH &&
    value.trim() === value &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function nodeIdFromStableObjectId(stableId: string): string {
  return stableId.slice("obj/".length);
}

interface ValidatedLegend {
  readonly numericIdByStableId: ReadonlyMap<string, number>;
  readonly knownNumericIds: ReadonlySet<number>;
}

function validateLegend(value: unknown): ValidatedLegend {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_LEGEND_ENTRIES
  ) {
    return fail("malformed-legend");
  }

  const numericIdByStableId = new Map<string, number>();
  const knownNumericIds = new Set<number>();
  let textBytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const itemDescriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!itemDescriptor || !("value" in itemDescriptor)) {
      return fail("malformed-legend");
    }
    const item = itemDescriptor.value;
    if (
      !isPlainRecord(item) ||
      !hasExactOwnStringKeys(item, LEGEND_ENTRY_KEYS)
    ) {
      return fail("malformed-legend");
    }
    const id = ownDataValue(item, "id", "malformed-legend");
    const stableId = ownDataValue(item, "stableId", "malformed-legend");
    const label = ownDataValue(item, "label", "malformed-legend");
    if (
      !Number.isSafeInteger(id) ||
      (id as number) <= 0 ||
      (id as number) > UINT32_MAXIMUM ||
      typeof stableId !== "string" ||
      !STABLE_OBJECT_ID_PATTERN.test(stableId) ||
      !isSafeSelectedNodeId(nodeIdFromStableObjectId(stableId)) ||
      !isSafeLegendLabel(label)
    ) {
      return fail("malformed-legend");
    }
    if (knownNumericIds.has(id as number)) {
      return fail("duplicate-legend-numeric-id");
    }
    if (numericIdByStableId.has(stableId)) {
      return fail("duplicate-legend-stable-id");
    }

    textBytes += UTF8_ENCODER.encode(stableId).byteLength +
      UTF8_ENCODER.encode(label).byteLength;
    if (textBytes > STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_LEGEND_TEXT_BYTES) {
      return fail("malformed-legend");
    }
    knownNumericIds.add(id as number);
    numericIdByStableId.set(stableId, id as number);
  }

  return { numericIdByStableId, knownNumericIds };
}

function buildMask(
  input: BuildStudioBg3dMagicFilterMaskInput,
): StudioBg3dMagicFilterMask {
  if (
    !isPlainRecord(input) ||
    !hasExactOwnStringKeys(input, INPUT_KEYS)
  ) {
    return fail("invalid-input");
  }

  const width = ownDataValue(input, "width");
  const height = ownDataValue(input, "height");
  const objectIds = ownDataValue(input, "objectIds");
  const legend = ownDataValue(input, "legend");
  const selectedId = ownDataValue(input, "selectedId");
  const totalPixelCount = boundedPixelCount(width, height);

  if (!isSafeSelectedNodeId(selectedId)) {
    return fail("invalid-selected-node-id");
  }
  if (
    !(objectIds instanceof Uint32Array) ||
    Object.getPrototypeOf(objectIds) !== Uint32Array.prototype ||
    !hasFixedExclusiveArrayBuffer(objectIds, totalPixelCount)
  ) {
    return fail("invalid-object-id-buffer");
  }

  const { numericIdByStableId, knownNumericIds } = validateLegend(legend);
  const selectedStableId = `obj/${selectedId}`;
  const selectedNumericId = numericIdByStableId.get(selectedStableId);
  if (selectedNumericId === undefined) {
    return fail("selected-stable-id-missing");
  }

  const data = new Uint8Array(totalPixelCount * 4);
  let selectedPixelCount = 0;
  let minimumX = width as number;
  let minimumY = height as number;
  let maximumX = -1;
  let maximumY = -1;

  for (let pixelIndex = 0; pixelIndex < totalPixelCount; pixelIndex += 1) {
    const objectId = objectIds[pixelIndex]!;
    if (objectId !== 0 && !knownNumericIds.has(objectId)) {
      return fail("unexpected-object-id");
    }

    const rgbaOffset = pixelIndex * 4;
    data[rgbaOffset] = 0xff;
    data[rgbaOffset + 1] = 0xff;
    data[rgbaOffset + 2] = 0xff;
    if (objectId !== selectedNumericId) continue;

    data[rgbaOffset + 3] = 0xff;
    selectedPixelCount += 1;
    const x = pixelIndex % (width as number);
    const y = Math.floor(pixelIndex / (width as number));
    minimumX = Math.min(minimumX, x);
    minimumY = Math.min(minimumY, y);
    maximumX = Math.max(maximumX, x);
    maximumY = Math.max(maximumY, y);
  }

  if (selectedPixelCount === 0) return fail("empty-selection");

  const selectedBounds = Object.freeze({
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX + 1,
    height: maximumY - minimumY + 1,
  });

  return Object.freeze({
    profile: STUDIO_BG3D_MAGIC_FILTER_MASK_PROFILE,
    width: width as number,
    height: height as number,
    selectedId,
    selectedStableId,
    selectedNumericId,
    selectedPixelCount,
    totalPixelCount,
    coverageRatio: selectedPixelCount / totalPixelCount,
    selectedBounds,
    data,
  });
}

/**
 * Converts one selected canonical object-ID into Studio's white/alpha filter-mask pixels.
 *
 * No row transform is performed: input and output are both canonical top-down. On success the
 * returned object and metadata are frozen, while `data` is a fresh exact-size caller-owned buffer.
 * Malformed boundary values throw a typed error and never produce a partial mask.
 */
export function buildStudioBg3dMagicFilterMask(
  input: BuildStudioBg3dMagicFilterMaskInput,
): StudioBg3dMagicFilterMask {
  try {
    return buildMask(input);
  } catch (error) {
    if (error instanceof StudioBg3dMagicFilterMaskError) throw error;
    return fail("invalid-input", error);
  }
}
