/**
 * Deterministic release/runtime conformance evidence for ToonSpectrum-owned ink codecs.
 *
 * The evidence binds a public-clean-room provider manifest, canonical source transport,
 * encoded wire bytes, decoded transport, and both provider execution receipts. It is the
 * testable input to ToonSpectrum's own product certificate program and never represents a
 * standards-body or codec-vendor certification.
 */

import {
  executeStudioCodecProvider,
  type StudioCodecExecutionRequest,
  type StudioCodecExecutionReceipt,
  type StudioCodecProvider,
} from "./studio-codec-provider-contract";
import {
  STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
  STUDIO_FIRST_PARTY_INK_CODEC_VERSION,
  STUDIO_FIRST_PARTY_INK_ENVELOPE_CODEC_PROFILE,
  STUDIO_FIRST_PARTY_INKML_CODEC_PROFILE,
  encodeStudioInkEnvelopeDocumentTransport,
  encodeStudioInkMlTraceTransport,
} from "./studio-first-party-ink-codec-provider";
import {
  STUDIO_INKML_PROFILE,
  type StudioInkMlDocument,
} from "./studio-inkml-codec";
import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_FIRST_PARTY_INK_CONFORMANCE_SCHEMA =
  "toonspectrum.first-party-ink-codec-conformance" as const;
export const STUDIO_FIRST_PARTY_INK_CONFORMANCE_SCHEMA_VERSION = 1 as const;

export type StudioFirstPartyInkCodecFormat = "inkml" | "toonink";

export interface StudioFirstPartyInkConformanceCaseReceipt {
  readonly caseId: string;
  readonly sourceSha256: `sha256:${string}`;
  readonly encodedSha256: `sha256:${string}`;
  readonly decodedSha256: `sha256:${string}`;
  readonly roundTripMatch: true;
  readonly encodeReceipt: StudioCodecExecutionReceipt;
  readonly decodeReceipt: StudioCodecExecutionReceipt;
}

export interface StudioFirstPartyInkConformanceEvidence {
  readonly schema: typeof STUDIO_FIRST_PARTY_INK_CONFORMANCE_SCHEMA;
  readonly schemaVersion:
    typeof STUDIO_FIRST_PARTY_INK_CONFORMANCE_SCHEMA_VERSION;
  readonly implementation: "toonspectrum-first-party-ink-codecs";
  readonly implementationVersion:
    typeof STUDIO_FIRST_PARTY_INK_CODEC_VERSION;
  readonly format: StudioFirstPartyInkCodecFormat;
  readonly profile:
    | typeof STUDIO_FIRST_PARTY_INK_ENVELOPE_CODEC_PROFILE
    | typeof STUDIO_FIRST_PARTY_INKML_CODEC_PROFILE;
  readonly providerId: string;
  readonly manifestSha256: `sha256:${string}`;
  readonly decision: "passed";
  readonly cases: readonly StudioFirstPartyInkConformanceCaseReceipt[];
}

export interface StudioFirstPartyInkConformanceBundle {
  readonly evidence: StudioFirstPartyInkConformanceEvidence;
  readonly bytes: Uint8Array;
  readonly sha256: `sha256:${string}`;
}

export class StudioFirstPartyInkConformanceError extends Error {
  readonly code:
    | "CODEC_EXECUTION_FAILED"
    | "CODEC_OUTPUT_MISMATCH"
    | "PROVIDER_NOT_FOUND";

  constructor(
    code: StudioFirstPartyInkConformanceError["code"],
    message: string,
  ) {
    super(message);
    this.name = "StudioFirstPartyInkConformanceError";
    this.code = code;
  }
}

const TEXT_ENCODER = new TextEncoder();
const FIXED_TIMESTAMP = "2026-07-30T00:00:00.000Z";

const TRACE_VECTOR: StudioInkMlDocument = Object.freeze({
  profile: STUDIO_INKML_PROFILE,
  traces: Object.freeze([
    Object.freeze({
      id: "conformance-trace-1",
      points: Object.freeze([0, 0, 4.25, 7.5, 12, 9.75]),
      pressures: Object.freeze([0.125, 0.625, 1]),
      tiltXs: Object.freeze([-45, 0, 45]),
      tiltYs: Object.freeze([45, 0, -45]),
      twists: Object.freeze([0, 180, 359.5]),
      speeds: Object.freeze([0, 2.5, 12.75]),
      tangentialPressures: Object.freeze([-0.5, 0, 0.5]),
    }),
  ]),
  ignoredChannels: Object.freeze([]),
});

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

export function serializeStudioFirstPartyInkConformanceEvidence(
  evidence: StudioFirstPartyInkConformanceEvidence,
): Uint8Array {
  return TEXT_ENCODER.encode(canonicalJson(evidence));
}

function providerFor(
  format: StudioFirstPartyInkCodecFormat,
  providers: readonly StudioCodecProvider[],
): StudioCodecProvider {
  const expected = STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS.find(
    (provider) => provider.manifest.format === format,
  );
  const matches = expected
    ? providers.filter((provider) => provider === expected)
    : [];
  if (matches.length !== 1 || !matches[0]) {
    throw new StudioFirstPartyInkConformanceError(
      "PROVIDER_NOT_FOUND",
      `Expected one first-party ${format} codec provider.`,
    );
  }
  return matches[0];
}

function requestFor(
  provider: StudioCodecProvider,
  direction: "decode" | "encode",
): StudioCodecExecutionRequest {
  const mimeType = provider.manifest.mimeTypes[0];
  const extension = provider.manifest.extensions[0];
  if (!mimeType || !extension) {
    throw new StudioFirstPartyInkConformanceError(
      "PROVIDER_NOT_FOUND",
      "First-party ink provider identity is incomplete.",
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

function sourceVector(format: StudioFirstPartyInkCodecFormat): Uint8Array {
  if (format === "inkml") {
    return encodeStudioInkMlTraceTransport(TRACE_VECTOR);
  }
  return encodeStudioInkEnvelopeDocumentTransport({
    format: {
      id: "toonspectrum.ink-document",
      version: 1,
    },
    document: {
      id: "ink:conformance-vector",
      revision: 1,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
    },
    payload: {
      type: "ink-document",
      data: {
        title: "ToonSpectrum ink codec conformance",
        strokes: [
          {
            id: "stroke-1",
            brush: "g-pen",
            points: [0, 0, 4.25, 7.5, 12, 9.75],
            pressures: [0.125, 0.625, 1],
          },
        ],
      },
    },
    extensions: {
      "toonspectrum.engine": {
        renderer: "hybrid-vnext",
      },
    },
  });
}

export async function createStudioFirstPartyInkConformanceEvidence(
  format: StudioFirstPartyInkCodecFormat,
  providers: readonly StudioCodecProvider[] =
    STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
): Promise<StudioFirstPartyInkConformanceBundle> {
  const provider = providerFor(format, providers);
  const source = sourceVector(format);
  const encoded = await executeStudioCodecProvider(
    requestFor(provider, "encode"),
    source,
    [provider],
  );
  if (!encoded.ok) {
    throw new StudioFirstPartyInkConformanceError(
      "CODEC_EXECUTION_FAILED",
      `${format} conformance encode failed (${encoded.code}).`,
    );
  }
  const decoded = await executeStudioCodecProvider(
    requestFor(provider, "decode"),
    encoded.bytes,
    [provider],
  );
  if (!decoded.ok) {
    throw new StudioFirstPartyInkConformanceError(
      "CODEC_EXECUTION_FAILED",
      `${format} conformance decode failed (${decoded.code}).`,
    );
  }
  if (
    decoded.bytes.byteLength !== source.byteLength
    || decoded.bytes.some((byte, index) => byte !== source[index])
  ) {
    throw new StudioFirstPartyInkConformanceError(
      "CODEC_OUTPUT_MISMATCH",
      `${format} conformance did not reproduce the canonical source transport.`,
    );
  }

  const profile = format === "toonink"
    ? STUDIO_FIRST_PARTY_INK_ENVELOPE_CODEC_PROFILE
    : STUDIO_FIRST_PARTY_INKML_CODEC_PROFILE;
  const evidence: StudioFirstPartyInkConformanceEvidence = Object.freeze({
    schema: STUDIO_FIRST_PARTY_INK_CONFORMANCE_SCHEMA,
    schemaVersion: STUDIO_FIRST_PARTY_INK_CONFORMANCE_SCHEMA_VERSION,
    implementation: "toonspectrum-first-party-ink-codecs",
    implementationVersion: STUDIO_FIRST_PARTY_INK_CODEC_VERSION,
    format,
    profile,
    providerId: provider.manifest.providerId,
    manifestSha256: hash(
      TEXT_ENCODER.encode(canonicalJson(provider.manifest)),
    ),
    decision: "passed",
    cases: Object.freeze([
      Object.freeze({
        caseId: format === "toonink"
          ? "canonical-studio-ink-document-v1"
          : "multichannel-pressure-tilt-trace-v1",
        sourceSha256: hash(source),
        encodedSha256: hash(encoded.bytes),
        decodedSha256: hash(decoded.bytes),
        roundTripMatch: true,
        encodeReceipt: encoded.receipt,
        decodeReceipt: decoded.receipt,
      }),
    ]),
  });
  const bytes = serializeStudioFirstPartyInkConformanceEvidence(evidence);
  return Object.freeze({
    evidence,
    bytes,
    sha256: hash(bytes),
  });
}
