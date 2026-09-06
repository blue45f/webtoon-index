/**
 * Renderer-neutral, structured-clone-safe capture boundary for multi-pass 3D output.
 *
 * This is intentionally additive to the legacy single-raster capture contract. Renderers may
 * produce this value, but no renderer-specific object, texture, GPU handle, or engine enum crosses
 * the boundary. Every accepted typed array is copied into a fixed, exactly-sized ArrayBuffer.
 */

export const STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION = 2 as const;
export const STUDIO_BG3D_ARTIFACT_CAPTURE_KIND =
  "studio-bg3d-artifact-capture" as const;
export const STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE =
  "studio-bg3d-multi-artifact-v2" as const;

export const STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_DIMENSION = 16_384;
export const STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_PIXELS = 16_777_216;
export const STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_DATA_BYTES = 256 * 1024 * 1024;
export const STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_LEGEND_ENTRIES = 16_384;
export const STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_LEGEND_TEXT_BYTES = 2 * 1024 * 1024;

export const STUDIO_BG3D_BEAUTY_RGBA8_PROFILE =
  "rgba8-straight-alpha-srgb-topdown-v1" as const;
export const STUDIO_BG3D_DEPTH_FLOAT32_PROFILE =
  "depth-f32-linear-view-normalized-topdown-v1" as const;
export const STUDIO_BG3D_NORMAL_PROFILE =
  "normal-rg8-octahedral-snorm-view-rh-topdown-v1" as const;
export const STUDIO_BG3D_NORMAL_COORDINATE_SPACE = "view-right-handed" as const;
export const STUDIO_BG3D_NORMAL_PACKING = "octahedral-rg8-snorm" as const;
export const STUDIO_BG3D_STABLE_ID_PROFILE =
  "stable-id-u32-background-zero-topdown-v1" as const;
export const STUDIO_BG3D_LINEAR_COVERAGE_PROFILE =
  "coverage-r8-linear-topdown-v1" as const;
export const STUDIO_BG3D_EMISSION_RGBA8_PROFILE =
  "emission-rgba8-straight-alpha-linear-topdown-v1" as const;
export const STUDIO_BG3D_VELOCITY_FLOAT32_PROFILE =
  "velocity-rg32f-pixels-per-second-topdown-v1" as const;

export type StudioBg3dArtifactKind =
  | "beauty"
  | "depth"
  | "normal"
  | "object-id"
  | "material-id"
  | "shadow"
  | "ambient-occlusion"
  | "emission"
  | "velocity";

export type StudioBg3dRequestedArtifactV2 =
  | { readonly kind: "beauty"; readonly profile: typeof STUDIO_BG3D_BEAUTY_RGBA8_PROFILE }
  | { readonly kind: "depth"; readonly profile: typeof STUDIO_BG3D_DEPTH_FLOAT32_PROFILE }
  | { readonly kind: "normal"; readonly profile: typeof STUDIO_BG3D_NORMAL_PROFILE }
  | { readonly kind: "object-id"; readonly profile: typeof STUDIO_BG3D_STABLE_ID_PROFILE }
  | { readonly kind: "material-id"; readonly profile: typeof STUDIO_BG3D_STABLE_ID_PROFILE }
  | { readonly kind: "shadow"; readonly profile: typeof STUDIO_BG3D_LINEAR_COVERAGE_PROFILE }
  | {
    readonly kind: "ambient-occlusion";
    readonly profile: typeof STUDIO_BG3D_LINEAR_COVERAGE_PROFILE;
  }
  | { readonly kind: "emission"; readonly profile: typeof STUDIO_BG3D_EMISSION_RGBA8_PROFILE }
  | { readonly kind: "velocity"; readonly profile: typeof STUDIO_BG3D_VELOCITY_FLOAT32_PROFILE };

export interface StudioBg3dArtifactCaptureRequestV2 {
  readonly kind: "artifact-capture-v2";
  readonly version: typeof STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION;
  readonly width: number;
  readonly height: number;
  readonly artifacts: readonly StudioBg3dRequestedArtifactV2[];
}

interface StudioBg3dArtifactBase<
  Kind extends StudioBg3dArtifactKind,
  Profile extends string,
  Data extends Uint8Array | Uint32Array | Float32Array,
> {
  readonly kind: Kind;
  readonly width: number;
  readonly height: number;
  readonly profile: Profile;
  readonly data: Data;
}

export type StudioBg3dBeautyArtifact = StudioBg3dArtifactBase<
  "beauty",
  typeof STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
  Uint8Array
>;

export type StudioBg3dDepthArtifact = StudioBg3dArtifactBase<
  "depth",
  typeof STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
  Float32Array
>;

export interface StudioBg3dNormalArtifact extends StudioBg3dArtifactBase<
  "normal",
  typeof STUDIO_BG3D_NORMAL_PROFILE,
  Uint8Array
> {
  readonly coordinateSpace: typeof STUDIO_BG3D_NORMAL_COORDINATE_SPACE;
  readonly packing: typeof STUDIO_BG3D_NORMAL_PACKING;
}

export interface StudioBg3dStableIdLegendEntry {
  /** Zero is reserved for background and therefore never appears in the legend. */
  readonly id: number;
  /** Renderer-independent canonical scene identity, stable across capture attempts. */
  readonly stableId: string;
  readonly label: string;
}

export interface StudioBg3dObjectIdArtifact extends StudioBg3dArtifactBase<
  "object-id",
  typeof STUDIO_BG3D_STABLE_ID_PROFILE,
  Uint32Array
> {
  readonly legend: readonly StudioBg3dStableIdLegendEntry[];
}

export interface StudioBg3dMaterialIdArtifact extends StudioBg3dArtifactBase<
  "material-id",
  typeof STUDIO_BG3D_STABLE_ID_PROFILE,
  Uint32Array
> {
  readonly legend: readonly StudioBg3dStableIdLegendEntry[];
}

export type StudioBg3dShadowArtifact = StudioBg3dArtifactBase<
  "shadow",
  typeof STUDIO_BG3D_LINEAR_COVERAGE_PROFILE,
  Uint8Array
>;

export type StudioBg3dAmbientOcclusionArtifact = StudioBg3dArtifactBase<
  "ambient-occlusion",
  typeof STUDIO_BG3D_LINEAR_COVERAGE_PROFILE,
  Uint8Array
>;

export type StudioBg3dEmissionArtifact = StudioBg3dArtifactBase<
  "emission",
  typeof STUDIO_BG3D_EMISSION_RGBA8_PROFILE,
  Uint8Array
>;

export type StudioBg3dVelocityArtifact = StudioBg3dArtifactBase<
  "velocity",
  typeof STUDIO_BG3D_VELOCITY_FLOAT32_PROFILE,
  Float32Array
>;

export type StudioBg3dCaptureArtifactV2 =
  | StudioBg3dBeautyArtifact
  | StudioBg3dDepthArtifact
  | StudioBg3dNormalArtifact
  | StudioBg3dObjectIdArtifact
  | StudioBg3dMaterialIdArtifact
  | StudioBg3dShadowArtifact
  | StudioBg3dAmbientOcclusionArtifact
  | StudioBg3dEmissionArtifact
  | StudioBg3dVelocityArtifact;

export interface StudioBg3dArtifactCaptureResultV2 {
  readonly kind: typeof STUDIO_BG3D_ARTIFACT_CAPTURE_KIND;
  readonly version: typeof STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION;
  readonly profile: typeof STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE;
  readonly width: number;
  readonly height: number;
  readonly artifacts: readonly StudioBg3dCaptureArtifactV2[];
}

type UnknownRecord = Record<PropertyKey, unknown>;

interface ArtifactAdmission {
  readonly record: UnknownRecord;
  readonly kind: StudioBg3dArtifactKind;
  readonly pixels: number;
  readonly expectedByteLength: number;
}

const ARTIFACT_KINDS = new Set<StudioBg3dArtifactKind>([
  "beauty",
  "depth",
  "normal",
  "object-id",
  "material-id",
  "shadow",
  "ambient-occlusion",
  "emission",
  "velocity",
]);
const MAX_VELOCITY_PIXELS_PER_SECOND = 1_000_000;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~:/-]{0,127}$/u;
const LEGEND_CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u;
const LEGEND_LABEL_MAX_LENGTH = 160;
const UTF8_ENCODER = new TextEncoder();

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(record: UnknownRecord, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(record);
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string")) {
    return false;
  }
  const expectedSet = new Set(expected);
  return keys.every((key) => expectedSet.has(key as string));
}

function isBoundedDimension(value: unknown): value is number {
  return Number.isSafeInteger(value) &&
    (value as number) > 0 &&
    (value as number) <= STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_DIMENSION;
}

function getBoundedPixels(width: unknown, height: unknown): number | null {
  if (!isBoundedDimension(width) || !isBoundedDimension(height)) return null;
  const pixels = width * height;
  return Number.isSafeInteger(pixels) &&
    pixels <= STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_PIXELS
    ? pixels
    : null;
}

function isArtifactKind(value: unknown): value is StudioBg3dArtifactKind {
  return typeof value === "string" &&
    ARTIFACT_KINDS.has(value as StudioBg3dArtifactKind);
}

function expectedArtifactByteLength(
  kind: StudioBg3dArtifactKind,
  pixels: number,
): number {
  switch (kind) {
    case "beauty":
    case "emission":
      return pixels * 4;
    case "depth":
    case "object-id":
    case "material-id":
      return pixels * 4;
    case "normal":
      return pixels * 2;
    case "shadow":
    case "ambient-occlusion":
      return pixels;
    case "velocity":
      return pixels * 2 * Float32Array.BYTES_PER_ELEMENT;
  }
}

function expectedArtifactProfile(kind: StudioBg3dArtifactKind): string {
  switch (kind) {
    case "beauty":
      return STUDIO_BG3D_BEAUTY_RGBA8_PROFILE;
    case "depth":
      return STUDIO_BG3D_DEPTH_FLOAT32_PROFILE;
    case "normal":
      return STUDIO_BG3D_NORMAL_PROFILE;
    case "object-id":
    case "material-id":
      return STUDIO_BG3D_STABLE_ID_PROFILE;
    case "shadow":
    case "ambient-occlusion":
      return STUDIO_BG3D_LINEAR_COVERAGE_PROFILE;
    case "emission":
      return STUDIO_BG3D_EMISSION_RGBA8_PROFILE;
    case "velocity":
      return STUDIO_BG3D_VELOCITY_FLOAT32_PROFILE;
  }
}

function expectedArtifactKeys(kind: StudioBg3dArtifactKind): readonly string[] {
  if (kind === "normal") {
    return ["kind", "width", "height", "profile", "coordinateSpace", "packing", "data"];
  }
  if (kind === "object-id" || kind === "material-id") {
    return ["kind", "width", "height", "profile", "legend", "data"];
  }
  return ["kind", "width", "height", "profile", "data"];
}

function hasFixedExclusiveBackingStore(
  view: ArrayBufferView<ArrayBufferLike>,
  expectedByteLength: number,
): boolean {
  const buffer = view.buffer;
  if (
    !(buffer instanceof ArrayBuffer) ||
    Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype ||
    view.byteOffset !== 0 ||
    view.byteLength !== expectedByteLength ||
    buffer.byteLength !== expectedByteLength
  ) {
    return false;
  }

  const bufferState = buffer as ArrayBuffer & {
    readonly detached?: unknown;
    readonly resizable?: unknown;
    readonly maxByteLength?: unknown;
  };
  if (bufferState.detached === true || bufferState.resizable === true) return false;
  return typeof bufferState.maxByteLength !== "number" ||
    bufferState.maxByteLength === buffer.byteLength;
}

function isSafeUint8Array(
  value: unknown,
  expectedLength: number,
): value is Uint8Array {
  return value instanceof Uint8Array &&
    Object.getPrototypeOf(value) === Uint8Array.prototype &&
    value.length === expectedLength &&
    hasFixedExclusiveBackingStore(value, expectedLength);
}

function isSafeUint32Array(
  value: unknown,
  expectedLength: number,
): value is Uint32Array {
  const byteLength = expectedLength * Uint32Array.BYTES_PER_ELEMENT;
  return value instanceof Uint32Array &&
    Object.getPrototypeOf(value) === Uint32Array.prototype &&
    value.length === expectedLength &&
    hasFixedExclusiveBackingStore(value, byteLength);
}

function isSafeFloat32Array(
  value: unknown,
  expectedLength: number,
): value is Float32Array {
  const byteLength = expectedLength * Float32Array.BYTES_PER_ELEMENT;
  return value instanceof Float32Array &&
    Object.getPrototypeOf(value) === Float32Array.prototype &&
    value.length === expectedLength &&
    hasFixedExclusiveBackingStore(value, byteLength);
}

function validateFiniteRange(
  data: Float32Array,
  minimum: number,
  maximum: number,
): boolean {
  for (const value of data) {
    if (!Number.isFinite(value) || value < minimum || value > maximum) return false;
  }
  return true;
}

function normalizeLegend(
  value: unknown,
  data: Uint32Array,
): readonly StudioBg3dStableIdLegendEntry[] | null {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_LEGEND_ENTRIES
  ) {
    return null;
  }

  const ids = new Set<number>();
  const stableIds = new Set<string>();
  const result: StudioBg3dStableIdLegendEntry[] = [];
  let textBytes = 0;

  for (const item of value) {
    if (!isPlainRecord(item) || !hasExactKeys(item, ["id", "stableId", "label"])) {
      return null;
    }
    const { id, stableId, label } = item;
    if (
      !Number.isSafeInteger(id) ||
      (id as number) <= 0 ||
      (id as number) > 0xffff_ffff ||
      typeof stableId !== "string" ||
      !STABLE_ID_PATTERN.test(stableId) ||
      typeof label !== "string" ||
      label.length < 1 ||
      label.length > LEGEND_LABEL_MAX_LENGTH ||
      label.trim() !== label ||
      LEGEND_CONTROL_CHARACTER_PATTERN.test(label) ||
      ids.has(id as number) ||
      stableIds.has(stableId)
    ) {
      return null;
    }

    textBytes += UTF8_ENCODER.encode(stableId).byteLength +
      UTF8_ENCODER.encode(label).byteLength;
    if (textBytes > STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_LEGEND_TEXT_BYTES) return null;
    ids.add(id as number);
    stableIds.add(stableId);
    result.push(Object.freeze({ id: id as number, stableId, label }));
  }

  for (const id of data) {
    if (id !== 0 && !ids.has(id)) return null;
  }

  result.sort((left, right) => left.id - right.id);
  return Object.freeze(result);
}

function admitArtifact(
  value: unknown,
  captureWidth: number,
  captureHeight: number,
): ArtifactAdmission | null {
  if (!isPlainRecord(value) || !isArtifactKind(value.kind)) return null;
  const kind = value.kind;
  if (!hasExactKeys(value, expectedArtifactKeys(kind))) return null;
  const pixels = getBoundedPixels(value.width, value.height);
  if (
    pixels === null ||
    value.width !== captureWidth ||
    value.height !== captureHeight
  ) {
    return null;
  }
  return {
    record: value,
    kind,
    pixels,
    expectedByteLength: expectedArtifactByteLength(kind, pixels),
  };
}

function normalizeArtifact(admission: ArtifactAdmission): StudioBg3dCaptureArtifactV2 | null {
  const { record, kind, pixels, expectedByteLength } = admission;
  const base = {
    kind,
    width: record.width as number,
    height: record.height as number,
  };

  if (kind === "beauty") {
    if (
      record.profile !== STUDIO_BG3D_BEAUTY_RGBA8_PROFILE ||
      !isSafeUint8Array(record.data, expectedByteLength)
    ) return null;
    return Object.freeze({
      ...base,
      kind,
      profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
      data: new Uint8Array(record.data),
    });
  }

  if (kind === "depth") {
    if (
      record.profile !== STUDIO_BG3D_DEPTH_FLOAT32_PROFILE ||
      !isSafeFloat32Array(record.data, pixels) ||
      !validateFiniteRange(record.data, 0, 1)
    ) return null;
    return Object.freeze({
      ...base,
      kind,
      profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
      data: new Float32Array(record.data),
    });
  }

  if (kind === "normal") {
    if (
      record.profile !== STUDIO_BG3D_NORMAL_PROFILE ||
      record.coordinateSpace !== STUDIO_BG3D_NORMAL_COORDINATE_SPACE ||
      record.packing !== STUDIO_BG3D_NORMAL_PACKING ||
      !isSafeUint8Array(record.data, expectedByteLength)
    ) return null;
    return Object.freeze({
      ...base,
      kind,
      profile: STUDIO_BG3D_NORMAL_PROFILE,
      coordinateSpace: STUDIO_BG3D_NORMAL_COORDINATE_SPACE,
      packing: STUDIO_BG3D_NORMAL_PACKING,
      data: new Uint8Array(record.data),
    });
  }

  if (kind === "object-id" || kind === "material-id") {
    if (
      record.profile !== STUDIO_BG3D_STABLE_ID_PROFILE ||
      !isSafeUint32Array(record.data, pixels)
    ) return null;
    const legend = normalizeLegend(record.legend, record.data);
    if (!legend) return null;
    return Object.freeze({
      ...base,
      kind,
      profile: STUDIO_BG3D_STABLE_ID_PROFILE,
      legend,
      data: new Uint32Array(record.data),
    });
  }

  if (kind === "shadow" || kind === "ambient-occlusion") {
    if (
      record.profile !== STUDIO_BG3D_LINEAR_COVERAGE_PROFILE ||
      !isSafeUint8Array(record.data, expectedByteLength)
    ) return null;
    return Object.freeze({
      ...base,
      kind,
      profile: STUDIO_BG3D_LINEAR_COVERAGE_PROFILE,
      data: new Uint8Array(record.data),
    });
  }

  if (kind === "emission") {
    if (
      record.profile !== STUDIO_BG3D_EMISSION_RGBA8_PROFILE ||
      !isSafeUint8Array(record.data, expectedByteLength)
    ) return null;
    return Object.freeze({
      ...base,
      kind,
      profile: STUDIO_BG3D_EMISSION_RGBA8_PROFILE,
      data: new Uint8Array(record.data),
    });
  }

  if (
    record.profile !== STUDIO_BG3D_VELOCITY_FLOAT32_PROFILE ||
    !isSafeFloat32Array(record.data, pixels * 2) ||
    !validateFiniteRange(
      record.data,
      -MAX_VELOCITY_PIXELS_PER_SECOND,
      MAX_VELOCITY_PIXELS_PER_SECOND,
    )
  ) return null;
  return Object.freeze({
    ...base,
    kind,
    profile: STUDIO_BG3D_VELOCITY_FLOAT32_PROFILE,
    data: new Float32Array(record.data),
  });
}

/**
 * Canonicalizes a specialist multi-pass request before it crosses the runtime boundary.
 *
 * The byte budget is calculated from the requested profiles up front, so an adapter never receives
 * a request whose declared output set cannot fit inside the v2 result contract.
 */
export function normalizeStudioBg3dArtifactCaptureRequestV2(
  value: unknown,
): StudioBg3dArtifactCaptureRequestV2 | null {
  try {
    if (
      !isPlainRecord(value) ||
      !hasExactKeys(value, ["kind", "version", "width", "height", "artifacts"]) ||
      value.kind !== "artifact-capture-v2" ||
      value.version !== STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION
    ) {
      return null;
    }
    const pixels = getBoundedPixels(value.width, value.height);
    if (
      pixels === null ||
      !Array.isArray(value.artifacts) ||
      Object.getPrototypeOf(value.artifacts) !== Array.prototype ||
      value.artifacts.length < 1 ||
      value.artifacts.length > ARTIFACT_KINDS.size
    ) {
      return null;
    }

    const seenKinds = new Set<StudioBg3dArtifactKind>();
    const artifacts: StudioBg3dRequestedArtifactV2[] = [];
    let expectedDataBytes = 0;
    for (const artifact of value.artifacts) {
      if (
        !isPlainRecord(artifact) ||
        !hasExactKeys(artifact, ["kind", "profile"]) ||
        !isArtifactKind(artifact.kind) ||
        artifact.profile !== expectedArtifactProfile(artifact.kind) ||
        seenKinds.has(artifact.kind)
      ) {
        return null;
      }
      seenKinds.add(artifact.kind);
      expectedDataBytes += expectedArtifactByteLength(artifact.kind, pixels);
      if (
        !Number.isSafeInteger(expectedDataBytes) ||
        expectedDataBytes > STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_DATA_BYTES
      ) {
        return null;
      }
      artifacts.push(Object.freeze({
        kind: artifact.kind,
        profile: artifact.profile,
      }) as StudioBg3dRequestedArtifactV2);
    }

    return Object.freeze({
      kind: "artifact-capture-v2",
      version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
      width: value.width as number,
      height: value.height as number,
      artifacts: Object.freeze(artifacts),
    });
  } catch {
    return null;
  }
}

/**
 * Validates untrusted renderer or Worker output and returns an owned canonical snapshot.
 *
 * Unknown fields and formats fail closed. The function never throws for malformed input, making it
 * suitable as the single admission point for post-processing, persistence, and export pipelines.
 */
export function normalizeStudioBg3dArtifactCaptureResultV2(
  value: unknown,
): StudioBg3dArtifactCaptureResultV2 | null {
  try {
    if (
      !isPlainRecord(value) ||
      !hasExactKeys(value, ["kind", "version", "profile", "width", "height", "artifacts"]) ||
      value.kind !== STUDIO_BG3D_ARTIFACT_CAPTURE_KIND ||
      value.version !== STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION ||
      value.profile !== STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE
    ) {
      return null;
    }

    const pixels = getBoundedPixels(value.width, value.height);
    if (
      pixels === null ||
      !Array.isArray(value.artifacts) ||
      Object.getPrototypeOf(value.artifacts) !== Array.prototype ||
      value.artifacts.length < 1 ||
      value.artifacts.length > ARTIFACT_KINDS.size
    ) {
      return null;
    }

    const seenKinds = new Set<StudioBg3dArtifactKind>();
    const admissions: ArtifactAdmission[] = [];
    let expectedDataBytes = 0;
    for (const artifact of value.artifacts) {
      const admission = admitArtifact(
        artifact,
        value.width as number,
        value.height as number,
      );
      if (!admission || seenKinds.has(admission.kind)) return null;
      seenKinds.add(admission.kind);
      expectedDataBytes += admission.expectedByteLength;
      if (
        !Number.isSafeInteger(expectedDataBytes) ||
        expectedDataBytes > STUDIO_BG3D_ARTIFACT_CAPTURE_MAX_DATA_BYTES
      ) {
        return null;
      }
      admissions.push(admission);
    }

    const artifacts: StudioBg3dCaptureArtifactV2[] = [];
    for (const admission of admissions) {
      const artifact = normalizeArtifact(admission);
      if (!artifact) return null;
      artifacts.push(artifact);
    }

    return Object.freeze({
      kind: STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
      version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
      profile: STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
      width: value.width as number,
      height: value.height as number,
      artifacts: Object.freeze(artifacts),
    });
  } catch {
    return null;
  }
}
