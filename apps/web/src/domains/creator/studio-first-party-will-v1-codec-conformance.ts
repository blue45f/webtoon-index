/**
 * Deterministic conformance evidence for the ToonSpectrum WILL v1 Annex A provider.
 *
 * This proves the bounded Path-stream profile only. It is not Wacom certification and does not
 * cover the Annex B OPC/ZIP `.will` document container.
 */

import {
  executeStudioCodecProvider,
  type StudioCodecExecutionRequest,
  type StudioCodecExecutionReceipt,
  type StudioCodecProvider,
} from "./studio-codec-provider-contract";
import {
  STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER,
  STUDIO_FIRST_PARTY_WILL_V1_CODEC_VERSION,
  STUDIO_FIRST_PARTY_WILL_V1_FORMAT,
  encodeStudioWillV1PathTransport,
} from "./studio-first-party-will-v1-codec-provider";
import { sha256HexPortable } from "./studio-sha256";
import {
  STUDIO_WILL_V1_PATH_MEDIA_TYPE,
  STUDIO_WILL_V1_PROFILE,
} from "./studio-will-v1-interchange";

export const STUDIO_FIRST_PARTY_WILL_V1_CONFORMANCE_SCHEMA =
  "toonspectrum.first-party-will-v1-annex-a-conformance" as const;
export const STUDIO_FIRST_PARTY_WILL_V1_CONFORMANCE_SCHEMA_VERSION = 1 as const;

export interface StudioFirstPartyWillV1ConformanceEvidence {
  readonly schema: typeof STUDIO_FIRST_PARTY_WILL_V1_CONFORMANCE_SCHEMA;
  readonly schemaVersion:
    typeof STUDIO_FIRST_PARTY_WILL_V1_CONFORMANCE_SCHEMA_VERSION;
  readonly implementation: "toonspectrum-first-party-will-v1-annex-a";
  readonly implementationVersion:
    typeof STUDIO_FIRST_PARTY_WILL_V1_CODEC_VERSION;
  readonly format: typeof STUDIO_FIRST_PARTY_WILL_V1_FORMAT;
  readonly profile: typeof STUDIO_WILL_V1_PROFILE;
  readonly providerId: string;
  readonly manifestSha256: `sha256:${string}`;
  readonly coverage: "annex-a-path-stream-only";
  readonly annexBContainerCovered: false;
  readonly decision: "passed";
  readonly case: Readonly<{
    caseId: "catmull-rom-pressure-width-rgba-v1";
    sourceSha256: `sha256:${string}`;
    encodedSha256: `sha256:${string}`;
    decodedSha256: `sha256:${string}`;
    roundTripMatch: true;
    encodeReceipt: StudioCodecExecutionReceipt;
    decodeReceipt: StudioCodecExecutionReceipt;
  }>;
}

export interface StudioFirstPartyWillV1ConformanceBundle {
  readonly evidence: StudioFirstPartyWillV1ConformanceEvidence;
  readonly bytes: Uint8Array;
  readonly sha256: `sha256:${string}`;
}

export class StudioFirstPartyWillV1ConformanceError extends Error {
  readonly code:
    | "CODEC_EXECUTION_FAILED"
    | "CODEC_OUTPUT_MISMATCH"
    | "PROVIDER_NOT_FOUND";

  constructor(
    code: StudioFirstPartyWillV1ConformanceError["code"],
    message: string,
  ) {
    super(message);
    this.name = "StudioFirstPartyWillV1ConformanceError";
    this.code = code;
  }
}

const TEXT_ENCODER = new TextEncoder();

function hash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function serializeStudioFirstPartyWillV1ConformanceEvidence(
  evidence: StudioFirstPartyWillV1ConformanceEvidence,
): Uint8Array {
  return TEXT_ENCODER.encode(canonicalJson(evidence));
}

function providerFor(
  providers: readonly StudioCodecProvider[],
): StudioCodecProvider {
  const matches = providers.filter(
    (provider) => provider === STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER,
  );
  if (matches.length !== 1 || !matches[0]) {
    throw new StudioFirstPartyWillV1ConformanceError(
      "PROVIDER_NOT_FOUND",
      "Expected one first-party WILL v1 Annex A provider.",
    );
  }
  return matches[0];
}

function requestFor(
  provider: StudioCodecProvider,
  direction: "decode" | "encode",
): StudioCodecExecutionRequest {
  return Object.freeze({
    schemaVersion: 1,
    direction,
    format: STUDIO_FIRST_PARTY_WILL_V1_FORMAT,
    profile: STUDIO_WILL_V1_PROFILE,
    version: STUDIO_FIRST_PARTY_WILL_V1_CODEC_VERSION,
    mimeType: STUDIO_WILL_V1_PATH_MEDIA_TYPE,
    extension: provider.manifest.extensions[0]!,
    allowedModes: Object.freeze(["public-clean-room"] as const),
    requireDeterministic: true,
    maxInputBytes: provider.manifest.maxInputBytes,
    maxOutputBytes: provider.manifest.maxOutputBytes,
  });
}

function conformanceSource(): Uint8Array {
  return encodeStudioWillV1PathTransport([
    {
      points: [
        { x: 0, y: 0 },
        { x: 12.25, y: 8.5 },
        { x: 24.75, y: 16.25 },
        { x: 40, y: 10.5 },
        { x: 55.5, y: 20 },
      ],
      strokeWidths: [0.75, 1.25, 2],
      strokeColor: { r: 18, g: 52, b: 86, a: 220 },
      startParameter: 0.125,
      endParameter: 0.875,
      decimalPrecision: 2,
    },
  ]);
}

export async function createStudioFirstPartyWillV1ConformanceEvidence(
  providers: readonly StudioCodecProvider[] = [
    STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER,
  ],
): Promise<StudioFirstPartyWillV1ConformanceBundle> {
  const provider = providerFor(providers);
  const source = conformanceSource();
  const encoded = await executeStudioCodecProvider(
    requestFor(provider, "encode"),
    source,
    [provider],
  );
  if (!encoded.ok) {
    throw new StudioFirstPartyWillV1ConformanceError(
      "CODEC_EXECUTION_FAILED",
      `WILL v1 Annex A conformance encode failed (${encoded.code}).`,
    );
  }
  const decoded = await executeStudioCodecProvider(
    requestFor(provider, "decode"),
    encoded.bytes,
    [provider],
  );
  if (!decoded.ok) {
    throw new StudioFirstPartyWillV1ConformanceError(
      "CODEC_EXECUTION_FAILED",
      `WILL v1 Annex A conformance decode failed (${decoded.code}).`,
    );
  }
  if (
    decoded.bytes.byteLength !== source.byteLength
    || decoded.bytes.some((byte, index) => byte !== source[index])
  ) {
    throw new StudioFirstPartyWillV1ConformanceError(
      "CODEC_OUTPUT_MISMATCH",
      "WILL v1 Annex A conformance did not reproduce canonical transport.",
    );
  }

  const evidence: StudioFirstPartyWillV1ConformanceEvidence = Object.freeze({
    schema: STUDIO_FIRST_PARTY_WILL_V1_CONFORMANCE_SCHEMA,
    schemaVersion: STUDIO_FIRST_PARTY_WILL_V1_CONFORMANCE_SCHEMA_VERSION,
    implementation: "toonspectrum-first-party-will-v1-annex-a",
    implementationVersion: STUDIO_FIRST_PARTY_WILL_V1_CODEC_VERSION,
    format: STUDIO_FIRST_PARTY_WILL_V1_FORMAT,
    profile: STUDIO_WILL_V1_PROFILE,
    providerId: provider.manifest.providerId,
    manifestSha256: hash(
      TEXT_ENCODER.encode(canonicalJson(provider.manifest)),
    ),
    coverage: "annex-a-path-stream-only",
    annexBContainerCovered: false,
    decision: "passed",
    case: Object.freeze({
      caseId: "catmull-rom-pressure-width-rgba-v1",
      sourceSha256: hash(source),
      encodedSha256: hash(encoded.bytes),
      decodedSha256: hash(decoded.bytes),
      roundTripMatch: true,
      encodeReceipt: encoded.receipt,
      decodeReceipt: decoded.receipt,
    }),
  });
  const bytes = serializeStudioFirstPartyWillV1ConformanceEvidence(evidence);
  return Object.freeze({ evidence, bytes, sha256: hash(bytes) });
}
