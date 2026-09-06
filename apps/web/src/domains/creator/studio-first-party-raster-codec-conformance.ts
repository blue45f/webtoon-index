/**
 * Deterministic release/runtime conformance evidence for ToonSpectrum-owned raster codecs.
 *
 * This is the testable substance behind a ToonSpectrum product certification: every evidence
 * record binds the provider manifest, canonical RGBA input, encoded output, decoded output, and
 * the format's declared alpha-loss model. A product signing authority can sign these exact bytes;
 * no vendor or standards-body certification is implied.
 */

import {
  executeStudioCodecProvider,
  type StudioCodecExecutionRequest,
  type StudioCodecExecutionReceipt,
  type StudioCodecProvider,
} from "./studio-codec-provider-contract";
import {
  decodeStudioCodecRgbaEnvelope,
  encodeStudioCodecRgbaEnvelope,
  STUDIO_FIRST_PARTY_RASTER_CODEC_FORMATS,
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE,
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
  STUDIO_FIRST_PARTY_RASTER_CODEC_VERSION,
} from "./studio-first-party-raster-codec-provider";
import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioRasterInterchangeFormat,
  StudioRgbaBitmap,
} from "./render/studio-raster-interchange";

export const STUDIO_FIRST_PARTY_RASTER_CONFORMANCE_SCHEMA =
  "toonspectrum.first-party-raster-codec-conformance" as const;
export const STUDIO_FIRST_PARTY_RASTER_CONFORMANCE_SCHEMA_VERSION = 1 as const;

export type StudioFirstPartyRasterAlphaPolicy =
  | "preserve-straight-alpha"
  | "flatten-on-white";

export interface StudioFirstPartyRasterConformanceCaseReceipt {
  readonly caseId: string;
  readonly alphaPolicy: StudioFirstPartyRasterAlphaPolicy;
  readonly inputRgbaSha256: `sha256:${string}`;
  readonly encodedSha256: `sha256:${string}`;
  readonly decodedRgbaSha256: `sha256:${string}`;
  readonly expectedRgbaSha256: `sha256:${string}`;
  readonly pixelMatch: true;
  readonly encodeReceipt: StudioCodecExecutionReceipt;
  readonly decodeReceipt: StudioCodecExecutionReceipt;
}

export interface StudioFirstPartyRasterConformanceEvidence {
  readonly schema: typeof STUDIO_FIRST_PARTY_RASTER_CONFORMANCE_SCHEMA;
  readonly schemaVersion:
    typeof STUDIO_FIRST_PARTY_RASTER_CONFORMANCE_SCHEMA_VERSION;
  readonly implementation: "toonspectrum-first-party-raster-codecs";
  readonly implementationVersion:
    typeof STUDIO_FIRST_PARTY_RASTER_CODEC_VERSION;
  readonly format: StudioRasterInterchangeFormat;
  readonly profile: typeof STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE;
  readonly providerId: string;
  readonly manifestSha256: `sha256:${string}`;
  readonly decision: "passed";
  readonly cases: readonly StudioFirstPartyRasterConformanceCaseReceipt[];
}

export interface StudioFirstPartyRasterConformanceBundle {
  readonly evidence: StudioFirstPartyRasterConformanceEvidence;
  readonly bytes: Uint8Array;
  readonly sha256: `sha256:${string}`;
}

export class StudioFirstPartyRasterConformanceError extends Error {
  readonly code:
    | "CODEC_EXECUTION_FAILED"
    | "CODEC_OUTPUT_MISMATCH"
    | "PROVIDER_NOT_FOUND";

  constructor(
    code: StudioFirstPartyRasterConformanceError["code"],
    message: string,
  ) {
    super(message);
    this.name = "StudioFirstPartyRasterConformanceError";
    this.code = code;
  }
}

const TEXT_ENCODER = new TextEncoder();

const CONFORMANCE_VECTORS = Object.freeze([
  Object.freeze({
    caseId: "opaque-primary-2x2",
    bitmap: Object.freeze({
      width: 2,
      height: 2,
      data: Uint8Array.of(
        255, 0, 0, 255,
        0, 255, 0, 255,
        0, 0, 255, 255,
        255, 255, 255, 255,
      ),
    }),
  }),
  Object.freeze({
    caseId: "alpha-edge-3x1",
    bitmap: Object.freeze({
      width: 3,
      height: 1,
      data: Uint8Array.of(
        120, 40, 200, 0,
        10, 200, 90, 128,
        250, 50, 0, 255,
      ),
    }),
  }),
] as const satisfies readonly Readonly<{
  readonly caseId: string;
  readonly bitmap: StudioRgbaBitmap;
}>[]);

function hash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function serializeStudioFirstPartyRasterConformanceEvidence(
  evidence: StudioFirstPartyRasterConformanceEvidence,
): Uint8Array {
  return TEXT_ENCODER.encode(canonicalJson(evidence));
}

function providerFor(
  format: StudioRasterInterchangeFormat,
  providers: readonly StudioCodecProvider[],
): StudioCodecProvider {
  const expected = STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS.find(
    (provider) => provider.manifest.format === format,
  );
  const matches = expected
    ? providers.filter((provider) => provider === expected)
    : [];
  if (matches.length !== 1 || !matches[0]) {
    throw new StudioFirstPartyRasterConformanceError(
      "PROVIDER_NOT_FOUND",
      `Expected one first-party ${format} codec provider.`,
    );
  }
  return matches[0];
}

function requestFor(
  provider: StudioCodecProvider,
  direction: "encode" | "decode",
): StudioCodecExecutionRequest {
  const mimeType = provider.manifest.mimeTypes[0];
  const extension = provider.manifest.extensions[0];
  if (!mimeType || !extension) {
    throw new StudioFirstPartyRasterConformanceError(
      "PROVIDER_NOT_FOUND",
      "First-party codec provider is missing its canonical MIME or extension.",
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    direction,
    format: provider.manifest.format,
    profile: provider.manifest.profile,
    version: provider.manifest.version,
    mimeType,
    extension,
    allowedModes: Object.freeze(["public-clean-room"] as const),
    requireDeterministic: true,
    maxInputBytes: provider.manifest.maxInputBytes,
    maxOutputBytes: provider.manifest.maxOutputBytes,
  });
}

function alphaPolicyFor(
  format: StudioRasterInterchangeFormat,
): StudioFirstPartyRasterAlphaPolicy {
  return format === "bmp" || format === "ppm"
    ? "flatten-on-white"
    : "preserve-straight-alpha";
}

function flattenChannel(
  channel: number,
  alpha: number,
): number {
  return Math.round((channel * alpha + 255 * (255 - alpha)) / 255);
}

function expectedBitmap(
  bitmap: StudioRgbaBitmap,
  alphaPolicy: StudioFirstPartyRasterAlphaPolicy,
): StudioRgbaBitmap {
  if (alphaPolicy === "preserve-straight-alpha") {
    return Object.freeze({
      width: bitmap.width,
      height: bitmap.height,
      data: Uint8Array.from(bitmap.data),
    });
  }
  const data = Uint8Array.from(bitmap.data);
  for (let index = 0; index < data.byteLength; index += 4) {
    const alpha = data[index + 3]!;
    data[index] = flattenChannel(data[index]!, alpha);
    data[index + 1] = flattenChannel(data[index + 1]!, alpha);
    data[index + 2] = flattenChannel(data[index + 2]!, alpha);
    data[index + 3] = 255;
  }
  return Object.freeze({
    width: bitmap.width,
    height: bitmap.height,
    data,
  });
}

function sameBytes(
  left: Uint8Array | Uint8ClampedArray,
  right: Uint8Array | Uint8ClampedArray,
): boolean {
  return (
    left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index])
  );
}

async function runCase(
  provider: StudioCodecProvider,
  format: StudioRasterInterchangeFormat,
  vector: (typeof CONFORMANCE_VECTORS)[number],
): Promise<StudioFirstPartyRasterConformanceCaseReceipt> {
  const alphaPolicy = alphaPolicyFor(format);
  const inputRgba = encodeStudioCodecRgbaEnvelope(vector.bitmap, {
    alphaLossPolicy:
      alphaPolicy === "flatten-on-white"
        ? "flatten-on-white"
        : "reject-alpha-loss",
  });
  const encoded = await executeStudioCodecProvider(
    requestFor(provider, "encode"),
    inputRgba,
    [provider],
  );
  if (!encoded.ok) {
    throw new StudioFirstPartyRasterConformanceError(
      "CODEC_EXECUTION_FAILED",
      `${format} encode conformance failed (${encoded.code}).`,
    );
  }
  const decoded = await executeStudioCodecProvider(
    requestFor(provider, "decode"),
    encoded.bytes,
    [provider],
  );
  if (!decoded.ok) {
    throw new StudioFirstPartyRasterConformanceError(
      "CODEC_EXECUTION_FAILED",
      `${format} decode conformance failed (${decoded.code}).`,
    );
  }
  const actual = decodeStudioCodecRgbaEnvelope(decoded.bytes);
  const expected = expectedBitmap(vector.bitmap, alphaPolicy);
  const expectedEnvelope = encodeStudioCodecRgbaEnvelope(expected);
  if (
    actual.width !== expected.width
    || actual.height !== expected.height
    || !sameBytes(actual.data, expected.data)
  ) {
    throw new StudioFirstPartyRasterConformanceError(
      "CODEC_OUTPUT_MISMATCH",
      `${format} decoded pixels do not match the declared alpha policy.`,
    );
  }
  return Object.freeze({
    caseId: vector.caseId,
    alphaPolicy,
    inputRgbaSha256: hash(inputRgba),
    encodedSha256: encoded.receipt.output.sha256,
    decodedRgbaSha256: decoded.receipt.output.sha256,
    expectedRgbaSha256: hash(expectedEnvelope),
    pixelMatch: true,
    encodeReceipt: encoded.receipt,
    decodeReceipt: decoded.receipt,
  });
}

export async function createStudioFirstPartyRasterConformanceEvidence(
  format: StudioRasterInterchangeFormat,
  providers: readonly StudioCodecProvider[] =
    STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
): Promise<StudioFirstPartyRasterConformanceBundle> {
  if (!STUDIO_FIRST_PARTY_RASTER_CODEC_FORMATS.includes(format)) {
    throw new StudioFirstPartyRasterConformanceError(
      "PROVIDER_NOT_FOUND",
      "Raster format is outside the first-party conformance profile.",
    );
  }
  const provider = providerFor(format, providers);
  const cases = await Promise.all(
    CONFORMANCE_VECTORS.map((vector) =>
      runCase(provider, format, vector),
    ),
  );
  const evidence: StudioFirstPartyRasterConformanceEvidence = Object.freeze({
    schema: STUDIO_FIRST_PARTY_RASTER_CONFORMANCE_SCHEMA,
    schemaVersion: STUDIO_FIRST_PARTY_RASTER_CONFORMANCE_SCHEMA_VERSION,
    implementation: "toonspectrum-first-party-raster-codecs",
    implementationVersion: STUDIO_FIRST_PARTY_RASTER_CODEC_VERSION,
    format,
    profile: STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE,
    providerId: provider.manifest.providerId,
    manifestSha256: hash(
      TEXT_ENCODER.encode(canonicalJson(provider.manifest)),
    ),
    decision: "passed",
    cases: Object.freeze(cases),
  });
  const bytes = serializeStudioFirstPartyRasterConformanceEvidence(evidence);
  return Object.freeze({
    evidence,
    bytes,
    sha256: hash(bytes),
  });
}
