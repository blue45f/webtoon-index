/**
 * Metadata-only provenance for replaying a durable R8 grain with canonical brush dynamics.
 *
 * Encoded/decoded image bytes, URLs, runtime handles and the complete dynamics plan are
 * deliberately excluded. The document/CRDT layer can retain this bounded sidecar while asset
 * storage and the renderer independently verify the content-addressed bytes.
 */

import {
  parseStudioProfessionalBrushDynamicsPlan,
  type StudioProfessionalBrushDynamicsPlan,
} from "../studio-professional-brush-dynamics";
import { sha256HexPortable } from "../studio-sha256";

import {
  normalizeStudioBrushR8TextureGrainSource,
  type StudioBrushR8GrainAssetReference,
  type StudioBrushR8TextureGrainSource,
} from "./studio-brush-r8-grain-asset-contract";

export const STUDIO_BRUSH_RENDER_PROVENANCE_VERSION = 1 as const;
export const STUDIO_BRUSH_RENDER_PROVENANCE_CRDT_VERSION = 1 as const;

export const STUDIO_BRUSH_RENDER_PROVENANCE_LIMITS = Object.freeze({
  maxCanonicalBytes: 4 * 1_024,
  maxCrdtSidecarBytes: 6 * 1_024,
  maxOperationIdLength: 160,
  maxCoordinateAbsolute: 16_777_216,
} as const);

const UINT32_RANGE = 0x1_0000_0000;
const UINT32_MAX = 0xffff_ffff;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u;
const PROVENANCE_KEYS = [
  "kind",
  "version",
  "rendererContract",
  "asset",
  "sampling",
  "dynamics",
] as const;
const SAMPLING_KEYS = [
  "filter",
  "edgeMode",
  "space",
  "scale",
  "amount",
  "contrast",
  "contrastTransfer",
  "origin",
  "phase",
] as const;
const ORIGIN_KEYS = ["x", "y"] as const;
const PHASE_KEYS = [
  "algorithm",
  "grainSeed",
  "strokeSeed",
  "x",
  "y",
] as const;
const DYNAMICS_KEYS = [
  "kind",
  "version",
  "planId",
  "revision",
  "sha256",
] as const;
const BUILD_KEYS = ["source", "sampling", "dynamics"] as const;
const BUILD_SAMPLING_KEYS = [
  "space",
  "scale",
  "amount",
  "contrast",
  "grainSeed",
  "strokeSeed",
  "originX",
  "originY",
] as const;
const CRDT_KEYS = [
  "kind",
  "version",
  "operationId",
  "provenanceSha256",
  "provenance",
] as const;
const TEXT_ENCODER = new TextEncoder();

export type StudioBrushRenderProvenanceSha256 = `sha256:${string}`;

export interface StudioBrushRenderProvenancePhase {
  readonly algorithm: "xor-mix-u32-v1";
  readonly grainSeed: number;
  readonly strokeSeed: number;
  readonly x: number;
  readonly y: number;
}

export interface StudioBrushRenderProvenanceSampling {
  readonly filter: "bilinear";
  readonly edgeMode: "repeat";
  readonly space: "canvas-fixed" | "stroke-fixed";
  readonly scale: number;
  readonly amount: number;
  readonly contrast: number;
  readonly contrastTransfer: "midpoint-gain-4x";
  readonly origin: Readonly<{ x: number; y: number }>;
  readonly phase: Readonly<StudioBrushRenderProvenancePhase>;
}

export interface StudioBrushRenderDynamicsDigest {
  readonly kind: "studio-professional-brush-dynamics-digest";
  readonly version: 1;
  readonly planId: string;
  readonly revision: number;
  readonly sha256: StudioBrushRenderProvenanceSha256;
}

export interface StudioBrushRenderProvenance {
  readonly kind: "studio-brush-render-provenance";
  readonly version: typeof STUDIO_BRUSH_RENDER_PROVENANCE_VERSION;
  readonly rendererContract: "durable-r8-repeat-bilinear-v1";
  readonly asset: Readonly<StudioBrushR8GrainAssetReference>;
  readonly sampling: Readonly<StudioBrushRenderProvenanceSampling>;
  readonly dynamics: Readonly<StudioBrushRenderDynamicsDigest>;
}

export interface StudioBrushRenderProvenanceBuildInput {
  readonly source: unknown;
  readonly sampling: unknown;
  readonly dynamics: unknown;
}

export interface StudioBrushRenderProvenanceCrdtSidecar {
  readonly kind: "studio-brush-render-provenance-crdt-sidecar";
  readonly version: typeof STUDIO_BRUSH_RENDER_PROVENANCE_CRDT_VERSION;
  readonly operationId: string;
  readonly provenanceSha256: StudioBrushRenderProvenanceSha256;
  readonly provenance: Readonly<StudioBrushRenderProvenance>;
}

export type StudioBrushRenderProvenanceFailureReason =
  | "not-plain-data"
  | "unknown-field"
  | "missing-field"
  | "invalid-field"
  | "unsupported-version"
  | "budget-exceeded"
  | "phase-mismatch"
  | "hash-mismatch"
  | "source-mismatch"
  | "sampling-mismatch"
  | "dynamics-mismatch"
  | "invalid-json"
  | "non-canonical-json";

export type StudioBrushRenderProvenanceResult =
  | Readonly<{
      status: "ready";
      provenance: Readonly<StudioBrushRenderProvenance>;
    }>
  | Readonly<{
      status: "rejected";
      reason: StudioBrushRenderProvenanceFailureReason;
      path: string;
    }>;

export type StudioBrushRenderProvenanceImportResult =
  | StudioBrushRenderProvenanceResult
  | Readonly<{
      status: "legacy";
      reason: "missing-provenance" | "unversioned-provenance";
    }>;

export type StudioBrushRenderProvenanceVerificationResult =
  | Readonly<{
      status: "verified";
      provenance: Readonly<StudioBrushRenderProvenance>;
      sha256: StudioBrushRenderProvenanceSha256;
    }>
  | Readonly<{
      status: "rejected";
      reason: StudioBrushRenderProvenanceFailureReason;
      path: string;
    }>;

export type StudioBrushRenderProvenanceCrdtResult =
  | Readonly<{
      status: "ready";
      sidecar: Readonly<StudioBrushRenderProvenanceCrdtSidecar>;
    }>
  | Readonly<{
      status: "rejected";
      reason: StudioBrushRenderProvenanceFailureReason;
      path: string;
    }>;

export interface StudioBrushRenderProvenanceOwnedBytes {
  /** Private ArrayBuffer-backed bytes; never a SharedArrayBuffer view. */
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  clone(): StudioBrushRenderProvenanceOwnedBytes | null;
  zeroize(): void;
  isZeroized(): boolean;
}

type Failure = Extract<StudioBrushRenderProvenanceResult, { status: "rejected" }>;
type PlainRecord = Readonly<Record<string, unknown>>;

function failure(
  reason: StudioBrushRenderProvenanceFailureReason,
  path: string,
): Failure {
  return Object.freeze({ status: "rejected", reason, path });
}

function exactRecord(
  input: unknown,
  expectedKeys: readonly string[],
  path: string,
): Readonly<{ status: "ready"; value: PlainRecord }> | Failure {
  try {
    if (
      typeof input !== "object"
      || input === null
      || Array.isArray(input)
      || (
        Object.getPrototypeOf(input) !== Object.prototype
        && Object.getPrototypeOf(input) !== null
      )
      || Object.getOwnPropertySymbols(input).length !== 0
    ) {
      return failure("not-plain-data", path);
    }
    const descriptors = Object.getOwnPropertyDescriptors(input) as Record<
      string,
      PropertyDescriptor
    >;
    const actualKeys = Object.keys(descriptors);
    const expected = new Set(expectedKeys);
    const unknown = actualKeys.find((key) => !expected.has(key));
    if (unknown) return failure("unknown-field", `${path}.${unknown}`);
    const detached: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor) return failure("missing-field", `${path}.${key}`);
      if (!("value" in descriptor) || !descriptor.enumerable) {
        return failure("not-plain-data", `${path}.${key}`);
      }
      detached[key] = descriptor.value;
    }
    return { status: "ready", value: detached };
  } catch {
    return failure("not-plain-data", path);
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function finiteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && !Object.is(value, -0)
    && value >= minimum
    && value <= maximum;
}

function uint32(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= UINT32_MAX;
}

function sha256(value: unknown): value is StudioBrushRenderProvenanceSha256 {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function operationId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= STUDIO_BRUSH_RENDER_PROVENANCE_LIMITS.maxOperationIdLength
    && OPERATION_ID_PATTERN.test(value);
}

function mixedUnit(seed: number, salt: number): number {
  let value = ((Math.trunc(seed) >>> 0) ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846c_a68b);
  value ^= value >>> 16;
  return (value >>> 0) / UINT32_RANGE;
}

function expectedPhase(
  grainSeed: number,
  strokeSeed: number,
): Readonly<{ x: number; y: number }> {
  const phaseSeed = (grainSeed ^ strokeSeed) >>> 0;
  return Object.freeze({
    x: mixedUnit(phaseSeed, 0x9e37_79b9),
    y: mixedUnit(phaseSeed, 0x243f_6a88),
  });
}

function hashBytes(bytes: Uint8Array): StudioBrushRenderProvenanceSha256 {
  return `sha256:${sha256HexPortable(bytes)}` as StudioBrushRenderProvenanceSha256;
}

function hashUtf8(value: string): StudioBrushRenderProvenanceSha256 {
  const bytes = TEXT_ENCODER.encode(value);
  try {
    return hashBytes(bytes);
  } finally {
    bytes.fill(0);
  }
}

function utf8ByteLength(value: string): number {
  const bytes = TEXT_ENCODER.encode(value);
  try {
    return bytes.byteLength;
  } finally {
    bytes.fill(0);
  }
}

function cloneAsset(
  asset: Readonly<StudioBrushR8GrainAssetReference>,
): Readonly<StudioBrushR8GrainAssetReference> {
  return Object.freeze({ ...asset });
}

function digestDynamics(
  input: unknown,
): Readonly<StudioBrushRenderDynamicsDigest> | Failure {
  const parsed = parseStudioProfessionalBrushDynamicsPlan(input);
  if (!parsed.ok) {
    return failure(
      parsed.reason === "unsupported-version"
        ? "unsupported-version"
        : parsed.reason === "budget-exceeded"
          ? "budget-exceeded"
          : "invalid-field",
      `$.dynamics${parsed.path === "$" ? "" : parsed.path.slice(1)}`,
    );
  }
  const canonical = JSON.stringify(parsed.plan);
  return Object.freeze({
    kind: "studio-professional-brush-dynamics-digest",
    version: 1,
    planId: parsed.plan.planId,
    revision: parsed.plan.revision,
    sha256: hashUtf8(canonical),
  });
}

function parseSampling(
  input: unknown,
): Readonly<StudioBrushRenderProvenanceSampling> | Failure {
  const sampling = exactRecord(input, SAMPLING_KEYS, "$.sampling");
  if (sampling.status !== "ready") return sampling;
  if (
    sampling.value.filter !== "bilinear"
    || sampling.value.edgeMode !== "repeat"
    || (
      sampling.value.space !== "canvas-fixed"
      && sampling.value.space !== "stroke-fixed"
    )
    || !finiteInRange(sampling.value.scale, 0.25, 512)
    || !finiteInRange(sampling.value.amount, 0, 1)
    || !finiteInRange(sampling.value.contrast, 0, 1)
    || sampling.value.contrastTransfer !== "midpoint-gain-4x"
  ) {
    return failure("invalid-field", "$.sampling");
  }
  const origin = exactRecord(sampling.value.origin, ORIGIN_KEYS, "$.sampling.origin");
  if (origin.status !== "ready") return origin;
  const coordinateLimit = STUDIO_BRUSH_RENDER_PROVENANCE_LIMITS.maxCoordinateAbsolute;
  if (
    !finiteInRange(origin.value.x, -coordinateLimit, coordinateLimit)
    || !finiteInRange(origin.value.y, -coordinateLimit, coordinateLimit)
    || (
      sampling.value.space === "canvas-fixed"
      && (origin.value.x !== 0 || origin.value.y !== 0)
    )
  ) {
    return failure("invalid-field", "$.sampling.origin");
  }
  const phase = exactRecord(sampling.value.phase, PHASE_KEYS, "$.sampling.phase");
  if (phase.status !== "ready") return phase;
  if (
    phase.value.algorithm !== "xor-mix-u32-v1"
    || !uint32(phase.value.grainSeed)
    || !uint32(phase.value.strokeSeed)
    || !finiteInRange(phase.value.x, 0, 1)
    || !finiteInRange(phase.value.y, 0, 1)
    || phase.value.x === 1
    || phase.value.y === 1
  ) {
    return failure("invalid-field", "$.sampling.phase");
  }
  const expected = expectedPhase(phase.value.grainSeed, phase.value.strokeSeed);
  if (phase.value.x !== expected.x || phase.value.y !== expected.y) {
    return failure("phase-mismatch", "$.sampling.phase");
  }
  return deepFreeze({
    filter: "bilinear" as const,
    edgeMode: "repeat" as const,
    space: sampling.value.space,
    scale: sampling.value.scale,
    amount: sampling.value.amount,
    contrast: sampling.value.contrast,
    contrastTransfer: "midpoint-gain-4x" as const,
    origin: { x: origin.value.x, y: origin.value.y },
    phase: {
      algorithm: "xor-mix-u32-v1" as const,
      grainSeed: phase.value.grainSeed,
      strokeSeed: phase.value.strokeSeed,
      x: expected.x,
      y: expected.y,
    },
  });
}

function parseDynamicsDigest(
  input: unknown,
): Readonly<StudioBrushRenderDynamicsDigest> | Failure {
  const dynamics = exactRecord(input, DYNAMICS_KEYS, "$.dynamics");
  if (dynamics.status !== "ready") return dynamics;
  if (
    dynamics.value.kind !== "studio-professional-brush-dynamics-digest"
    || dynamics.value.version !== 1
    || typeof dynamics.value.planId !== "string"
    || dynamics.value.planId.length === 0
    || dynamics.value.planId.length > 128
    || !Number.isSafeInteger(dynamics.value.revision)
    || (dynamics.value.revision as number) < 0
    || !sha256(dynamics.value.sha256)
  ) {
    return failure("invalid-field", "$.dynamics");
  }
  return Object.freeze({
    kind: "studio-professional-brush-dynamics-digest" as const,
    version: 1 as const,
    planId: dynamics.value.planId,
    revision: dynamics.value.revision as number,
    sha256: dynamics.value.sha256,
  });
}

function canonicalFromReady(
  provenance: Readonly<StudioBrushRenderProvenance>,
): string | null {
  const canonical = JSON.stringify(provenance);
  return utf8ByteLength(canonical) <= STUDIO_BRUSH_RENDER_PROVENANCE_LIMITS.maxCanonicalBytes
    ? canonical
    : null;
}

/**
 * Strictly parses the current version. Missing or legacy data is not accepted here; use
 * `importStudioBrushRenderProvenance` when an explicit legacy result is required.
 */
export function parseStudioBrushRenderProvenance(
  input: unknown,
): StudioBrushRenderProvenanceResult {
  const record = exactRecord(input, PROVENANCE_KEYS, "$");
  if (record.status !== "ready") return record;
  if (record.value.kind !== "studio-brush-render-provenance") {
    return failure("invalid-field", "$.kind");
  }
  if (record.value.version !== STUDIO_BRUSH_RENDER_PROVENANCE_VERSION) {
    return failure("unsupported-version", "$.version");
  }
  if (record.value.rendererContract !== "durable-r8-repeat-bilinear-v1") {
    return failure("invalid-field", "$.rendererContract");
  }
  const source = normalizeStudioBrushR8TextureGrainSource({
    kind: "r8-texture-v1",
    asset: record.value.asset,
  });
  if (!source) return failure("invalid-field", "$.asset");
  const sampling = parseSampling(record.value.sampling);
  if ("reason" in sampling) return sampling;
  const dynamics = parseDynamicsDigest(record.value.dynamics);
  if ("reason" in dynamics) return dynamics;
  const provenance = deepFreeze({
    kind: "studio-brush-render-provenance" as const,
    version: STUDIO_BRUSH_RENDER_PROVENANCE_VERSION,
    rendererContract: "durable-r8-repeat-bilinear-v1" as const,
    asset: cloneAsset(source.asset),
    sampling,
    dynamics,
  });
  if (!canonicalFromReady(provenance)) {
    return failure("budget-exceeded", "$");
  }
  return Object.freeze({ status: "ready", provenance });
}

/** Builds a complete provenance record from admitted R8 metadata and a strict dynamics plan. */
export function buildStudioBrushRenderProvenance(
  input: unknown,
): StudioBrushRenderProvenanceResult {
  const build = exactRecord(input, BUILD_KEYS, "$");
  if (build.status !== "ready") return build;
  const source = normalizeStudioBrushR8TextureGrainSource(build.value.source);
  if (!source) return failure("invalid-field", "$.source");
  const samplingInput = exactRecord(
    build.value.sampling,
    BUILD_SAMPLING_KEYS,
    "$.sampling",
  );
  if (samplingInput.status !== "ready") return samplingInput;
  if (
    (
      samplingInput.value.space !== "canvas-fixed"
      && samplingInput.value.space !== "stroke-fixed"
    )
    || !finiteInRange(samplingInput.value.scale, 0.25, 512)
    || !finiteInRange(samplingInput.value.amount, 0, 1)
    || !finiteInRange(samplingInput.value.contrast, 0, 1)
    || !uint32(samplingInput.value.grainSeed)
    || !uint32(samplingInput.value.strokeSeed)
  ) {
    return failure("invalid-field", "$.sampling");
  }
  const coordinateLimit = STUDIO_BRUSH_RENDER_PROVENANCE_LIMITS.maxCoordinateAbsolute;
  if (
    !finiteInRange(samplingInput.value.originX, -coordinateLimit, coordinateLimit)
    || !finiteInRange(samplingInput.value.originY, -coordinateLimit, coordinateLimit)
  ) {
    return failure("invalid-field", "$.sampling");
  }
  const phase = expectedPhase(
    samplingInput.value.grainSeed,
    samplingInput.value.strokeSeed,
  );
  const dynamics = digestDynamics(build.value.dynamics);
  if ("reason" in dynamics) return dynamics;
  return parseStudioBrushRenderProvenance({
    kind: "studio-brush-render-provenance",
    version: STUDIO_BRUSH_RENDER_PROVENANCE_VERSION,
    rendererContract: "durable-r8-repeat-bilinear-v1",
    asset: source.asset,
    sampling: {
      filter: "bilinear",
      edgeMode: "repeat",
      space: samplingInput.value.space,
      scale: samplingInput.value.scale,
      amount: samplingInput.value.amount,
      contrast: samplingInput.value.contrast,
      contrastTransfer: "midpoint-gain-4x",
      origin: samplingInput.value.space === "canvas-fixed"
        ? { x: 0, y: 0 }
        : {
            x: samplingInput.value.originX,
            y: samplingInput.value.originY,
          },
      phase: {
        algorithm: "xor-mix-u32-v1",
        grainSeed: samplingInput.value.grainSeed,
        strokeSeed: samplingInput.value.strokeSeed,
        x: phase.x,
        y: phase.y,
      },
    },
    dynamics,
  });
}

/** Returns schema-ordered canonical JSON, or null for any malformed/over-budget candidate. */
export function serializeStudioBrushRenderProvenanceCanonical(
  input: unknown,
): string | null {
  const parsed = parseStudioBrushRenderProvenance(input);
  return parsed.status === "ready" ? canonicalFromReady(parsed.provenance) : null;
}

export function hashStudioBrushRenderProvenance(
  input: unknown,
): StudioBrushRenderProvenanceSha256 | null {
  const owned = encodeStudioBrushRenderProvenanceCanonical(input);
  if (!owned) return null;
  try {
    return hashBytes(owned.bytes);
  } finally {
    owned.zeroize();
  }
}

function ownedBytes(bytes: Uint8Array): StudioBrushRenderProvenanceOwnedBytes {
  let zeroized = false;
  const privateBytes = new Uint8Array(bytes);
  const result: StudioBrushRenderProvenanceOwnedBytes = {
    bytes: privateBytes,
    byteLength: privateBytes.byteLength,
    clone: () => zeroized ? null : ownedBytes(privateBytes),
    zeroize: () => {
      if (zeroized) return;
      privateBytes.fill(0);
      zeroized = true;
    },
    isZeroized: () => zeroized,
  };
  return Object.freeze(result);
}

/** Returns a fresh, explicitly owned canonical byte buffer suitable for transfer and zeroization. */
export function encodeStudioBrushRenderProvenanceCanonical(
  input: unknown,
): StudioBrushRenderProvenanceOwnedBytes | null {
  const canonical = serializeStudioBrushRenderProvenanceCanonical(input);
  if (!canonical) return null;
  const encoded = TEXT_ENCODER.encode(canonical);
  try {
    return ownedBytes(encoded);
  } finally {
    encoded.fill(0);
  }
}

type EnvelopeDiscriminator =
  | Readonly<{ status: "ready"; kind: unknown; version: unknown }>
  | Readonly<{ status: "legacy" }>
  | Failure;

function envelopeDiscriminator(
  input: unknown,
): EnvelopeDiscriminator {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return Object.freeze({ status: "legacy" });
    }
    const kind = Object.getOwnPropertyDescriptor(input, "kind");
    const version = Object.getOwnPropertyDescriptor(input, "version");
    if (!kind && !version) return Object.freeze({ status: "legacy" });
    if (!kind) return failure("missing-field", "$.kind");
    if (!version) return failure("missing-field", "$.version");
    if (
      !("value" in kind)
      || !("value" in version)
      || !kind.enumerable
      || !version.enumerable
    ) {
      return failure("not-plain-data", "$");
    }
    return { status: "ready", kind: kind.value, version: version.value };
  } catch {
    return failure("not-plain-data", "$");
  }
}

/**
 * Imports persisted JSON without silently treating missing old metadata as current semantics.
 * Legacy absence/unversioned data receives a distinct result that callers must handle explicitly.
 */
export function importStudioBrushRenderProvenance(
  input: unknown,
): StudioBrushRenderProvenanceImportResult {
  if (input === null || input === undefined || input === "") {
    return Object.freeze({ status: "legacy", reason: "missing-provenance" });
  }
  let candidate: unknown = input;
  let originalJson: string | null = null;
  if (typeof input === "string") {
    if (utf8ByteLength(input) > STUDIO_BRUSH_RENDER_PROVENANCE_LIMITS.maxCanonicalBytes) {
      return failure("budget-exceeded", "$");
    }
    try {
      candidate = JSON.parse(input) as unknown;
      originalJson = input;
    } catch {
      return failure("invalid-json", "$");
    }
  }
  const discriminator = envelopeDiscriminator(candidate);
  if (discriminator.status === "legacy") {
    return Object.freeze({ status: "legacy", reason: "unversioned-provenance" });
  }
  if (discriminator.status === "rejected") return discriminator;
  const parsed = parseStudioBrushRenderProvenance(candidate);
  if (parsed.status !== "ready") return parsed;
  const canonical = canonicalFromReady(parsed.provenance);
  if (originalJson !== null && originalJson !== canonical) {
    return failure("non-canonical-json", "$");
  }
  return parsed;
}

/**
 * Rebuilds the expected record from live bindings and compares canonical identity. This catches an
 * asset hash/dimension/channel replacement, sampling drift, or dynamics change before replay.
 */
export function verifyStudioBrushRenderProvenanceBindings(
  provenance: unknown,
  expected: unknown,
): StudioBrushRenderProvenanceVerificationResult {
  const parsed = parseStudioBrushRenderProvenance(provenance);
  if (parsed.status !== "ready") return parsed;
  const rebuilt = buildStudioBrushRenderProvenance(expected);
  if (rebuilt.status !== "ready") return rebuilt;
  const actual = parsed.provenance;
  const wanted = rebuilt.provenance;
  if (JSON.stringify(actual.asset) !== JSON.stringify(wanted.asset)) {
    return failure("source-mismatch", "$.asset");
  }
  if (JSON.stringify(actual.sampling) !== JSON.stringify(wanted.sampling)) {
    return failure("sampling-mismatch", "$.sampling");
  }
  if (JSON.stringify(actual.dynamics) !== JSON.stringify(wanted.dynamics)) {
    return failure("dynamics-mismatch", "$.dynamics");
  }
  const digest = hashStudioBrushRenderProvenance(actual);
  if (!digest) return failure("hash-mismatch", "$");
  return Object.freeze({ status: "verified", provenance: actual, sha256: digest });
}

/** Creates a small operation-bound JSON sidecar; it never embeds raster or dynamics payloads. */
export function createStudioBrushRenderProvenanceCrdtSidecar(
  operationIdValue: unknown,
  provenanceValue: unknown,
): StudioBrushRenderProvenanceCrdtResult {
  if (!operationId(operationIdValue)) {
    return failure("invalid-field", "$.operationId");
  }
  const parsed = parseStudioBrushRenderProvenance(provenanceValue);
  if (parsed.status !== "ready") return parsed;
  const provenanceSha256 = hashStudioBrushRenderProvenance(parsed.provenance);
  if (!provenanceSha256) return failure("hash-mismatch", "$.provenance");
  return parseStudioBrushRenderProvenanceCrdtSidecar({
    kind: "studio-brush-render-provenance-crdt-sidecar",
    version: STUDIO_BRUSH_RENDER_PROVENANCE_CRDT_VERSION,
    operationId: operationIdValue,
    provenanceSha256,
    provenance: parsed.provenance,
  });
}

export function parseStudioBrushRenderProvenanceCrdtSidecar(
  input: unknown,
): StudioBrushRenderProvenanceCrdtResult {
  const record = exactRecord(input, CRDT_KEYS, "$");
  if (record.status !== "ready") return record;
  if (record.value.kind !== "studio-brush-render-provenance-crdt-sidecar") {
    return failure("invalid-field", "$.kind");
  }
  if (record.value.version !== STUDIO_BRUSH_RENDER_PROVENANCE_CRDT_VERSION) {
    return failure("unsupported-version", "$.version");
  }
  if (!operationId(record.value.operationId)) {
    return failure("invalid-field", "$.operationId");
  }
  if (!sha256(record.value.provenanceSha256)) {
    return failure("invalid-field", "$.provenanceSha256");
  }
  const parsed = parseStudioBrushRenderProvenance(record.value.provenance);
  if (parsed.status !== "ready") return parsed;
  const actualHash = hashStudioBrushRenderProvenance(parsed.provenance);
  if (actualHash !== record.value.provenanceSha256) {
    return failure("hash-mismatch", "$.provenanceSha256");
  }
  const sidecar = deepFreeze({
    kind: "studio-brush-render-provenance-crdt-sidecar" as const,
    version: STUDIO_BRUSH_RENDER_PROVENANCE_CRDT_VERSION,
    operationId: record.value.operationId,
    provenanceSha256: actualHash,
    provenance: parsed.provenance,
  });
  const canonical = JSON.stringify(sidecar);
  if (utf8ByteLength(canonical)
    > STUDIO_BRUSH_RENDER_PROVENANCE_LIMITS.maxCrdtSidecarBytes) {
    return failure("budget-exceeded", "$");
  }
  return Object.freeze({ status: "ready", sidecar });
}

export function serializeStudioBrushRenderProvenanceCrdtSidecarCanonical(
  input: unknown,
): string | null {
  const parsed = parseStudioBrushRenderProvenanceCrdtSidecar(input);
  return parsed.status === "ready" ? JSON.stringify(parsed.sidecar) : null;
}

/** Type-only seam for callers that already hold a parsed professional dynamics plan. */
export type StudioBrushRenderProvenanceDynamicsInput =
  Readonly<StudioProfessionalBrushDynamicsPlan>;

/** Type-only seam for callers that already hold an admitted R8 source. */
export type StudioBrushRenderProvenanceSourceInput =
  Readonly<StudioBrushR8TextureGrainSource>;
