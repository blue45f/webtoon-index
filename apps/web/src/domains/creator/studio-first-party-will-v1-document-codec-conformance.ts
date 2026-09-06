/**
 * Deterministic conformance evidence for ToonSpectrum's bounded WILL v1 Annex B document codec.
 *
 * The evidence covers the exact seven-part clean-room profile only. It is not Wacom/vendor
 * certification, trademark authorization, or arbitrary `.will` interoperability evidence.
 */

import {
  executeStudioCodecProvider,
  type StudioCodecExecutionRequest,
  type StudioCodecExecutionReceipt,
  type StudioCodecProvider,
} from "./studio-codec-provider-contract";
import {
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER,
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_VERSION,
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_FORMAT,
  encodeStudioWillV1DocumentTransport,
} from "./studio-first-party-will-v1-document-codec-provider";
import { sha256HexPortable } from "./studio-sha256";
import {
  STUDIO_WILL_V1_OPC_EXTENSION,
  STUDIO_WILL_V1_OPC_MEDIA_TYPE,
  STUDIO_WILL_V1_OPC_PROFILE,
} from "./studio-will-v1-opc-interchange";

export const STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CONFORMANCE_SCHEMA =
  "toonspectrum.first-party-will-v1-annex-b-document-conformance" as const;
export const STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CONFORMANCE_SCHEMA_VERSION =
  1 as const;

export interface StudioFirstPartyWillV1DocumentConformanceEvidence {
  readonly schema:
    typeof STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CONFORMANCE_SCHEMA;
  readonly schemaVersion:
    typeof STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CONFORMANCE_SCHEMA_VERSION;
  readonly implementation:
    "toonspectrum-first-party-will-v1-annex-b-document";
  readonly implementationVersion:
    typeof STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_VERSION;
  readonly format: typeof STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_FORMAT;
  readonly profile: typeof STUDIO_WILL_V1_OPC_PROFILE;
  readonly mediaType: typeof STUDIO_WILL_V1_OPC_MEDIA_TYPE;
  readonly extension: typeof STUDIO_WILL_V1_OPC_EXTENSION;
  readonly providerId: string;
  readonly manifestSha256: `sha256:${string}`;
  readonly coverage: "annex-b-bounded-seven-part-document";
  readonly annexAPathStreamCovered: true;
  readonly annexBOpcContainerCovered: true;
  readonly boundedSevenPartProfile: true;
  readonly wacomSdkCodeUsed: false;
  readonly thirdPartyCodecCertification: false;
  readonly vendorTrademarkAuthorization: false;
  readonly arbitraryVendorFileInteroperabilityCertified: false;
  readonly decision: "passed";
  readonly case: Readonly<{
    caseId: "seven-part-catmul-rom-document-v1";
    sourceSha256: `sha256:${string}`;
    encodedSha256: `sha256:${string}`;
    repeatedEncodedSha256: `sha256:${string}`;
    decodedSha256: `sha256:${string}`;
    deterministicEncodeMatch: true;
    roundTripMatch: true;
    encodeReceipt: StudioCodecExecutionReceipt;
    repeatedEncodeReceipt: StudioCodecExecutionReceipt;
    decodeReceipt: StudioCodecExecutionReceipt;
  }>;
}

export interface StudioFirstPartyWillV1DocumentConformanceBundle {
  readonly evidence: StudioFirstPartyWillV1DocumentConformanceEvidence;
  readonly bytes: Uint8Array;
  readonly sha256: `sha256:${string}`;
}

export class StudioFirstPartyWillV1DocumentConformanceError extends Error {
  readonly code:
    | "CODEC_EXECUTION_FAILED"
    | "CODEC_OUTPUT_MISMATCH"
    | "PROVIDER_NOT_FOUND";

  constructor(
    code: StudioFirstPartyWillV1DocumentConformanceError["code"],
    message: string,
  ) {
    super(message);
    this.name = "StudioFirstPartyWillV1DocumentConformanceError";
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

export function serializeStudioFirstPartyWillV1DocumentConformanceEvidence(
  evidence: StudioFirstPartyWillV1DocumentConformanceEvidence,
): Uint8Array {
  return TEXT_ENCODER.encode(canonicalJson(evidence));
}

function providerFor(
  providers: readonly StudioCodecProvider[],
): StudioCodecProvider {
  const matches = providers.filter(
    (provider) =>
      provider === STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER,
  );
  if (matches.length !== 1 || !matches[0]) {
    throw new StudioFirstPartyWillV1DocumentConformanceError(
      "PROVIDER_NOT_FOUND",
      "Expected one exact first-party WILL v1 Annex B document provider.",
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
    format: STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_FORMAT,
    profile: STUDIO_WILL_V1_OPC_PROFILE,
    version: STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_VERSION,
    mimeType: STUDIO_WILL_V1_OPC_MEDIA_TYPE,
    extension: STUDIO_WILL_V1_OPC_EXTENSION,
    allowedModes: Object.freeze(["public-clean-room"] as const),
    requireDeterministic: true,
    maxInputBytes: provider.manifest.maxInputBytes,
    maxOutputBytes: provider.manifest.maxOutputBytes,
  });
}

async function conformanceSource(): Promise<Uint8Array> {
  return encodeStudioWillV1DocumentTransport({
    width: 328,
    height: 439,
    title: "ToonSpectrum WILL v1 Annex B conformance",
    createdAt: "2026-07-30T00:00:00Z",
    application: "ToonSpectrum Studio",
    applicationVersion: "1.0.0",
    paths: [
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
    ],
  });
}

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return first.byteLength === second.byteLength
    && first.every((byte, index) => byte === second[index]);
}

export async function createStudioFirstPartyWillV1DocumentConformanceEvidence(
  providers: readonly StudioCodecProvider[] = [
    STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER,
  ],
): Promise<StudioFirstPartyWillV1DocumentConformanceBundle> {
  const provider = providerFor(providers);
  const source = await conformanceSource();
  const encoded = await executeStudioCodecProvider(
    requestFor(provider, "encode"),
    source,
    [provider],
  );
  const repeatedEncoded = await executeStudioCodecProvider(
    requestFor(provider, "encode"),
    source,
    [provider],
  );
  if (!encoded.ok || !repeatedEncoded.ok) {
    throw new StudioFirstPartyWillV1DocumentConformanceError(
      "CODEC_EXECUTION_FAILED",
      "WILL v1 Annex B deterministic conformance encode failed.",
    );
  }
  if (!sameBytes(encoded.bytes, repeatedEncoded.bytes)) {
    throw new StudioFirstPartyWillV1DocumentConformanceError(
      "CODEC_OUTPUT_MISMATCH",
      "WILL v1 Annex B provider did not reproduce deterministic bytes.",
    );
  }
  const decoded = await executeStudioCodecProvider(
    requestFor(provider, "decode"),
    encoded.bytes,
    [provider],
  );
  if (!decoded.ok) {
    throw new StudioFirstPartyWillV1DocumentConformanceError(
      "CODEC_EXECUTION_FAILED",
      `WILL v1 Annex B conformance decode failed (${decoded.code}).`,
    );
  }
  if (!sameBytes(decoded.bytes, source)) {
    throw new StudioFirstPartyWillV1DocumentConformanceError(
      "CODEC_OUTPUT_MISMATCH",
      "WILL v1 Annex B conformance did not reproduce canonical transport.",
    );
  }

  const evidence: StudioFirstPartyWillV1DocumentConformanceEvidence =
    Object.freeze({
      schema: STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CONFORMANCE_SCHEMA,
      schemaVersion:
        STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CONFORMANCE_SCHEMA_VERSION,
      implementation:
        "toonspectrum-first-party-will-v1-annex-b-document",
      implementationVersion:
        STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_VERSION,
      format: STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_FORMAT,
      profile: STUDIO_WILL_V1_OPC_PROFILE,
      mediaType: STUDIO_WILL_V1_OPC_MEDIA_TYPE,
      extension: STUDIO_WILL_V1_OPC_EXTENSION,
      providerId: provider.manifest.providerId,
      manifestSha256: hash(
        TEXT_ENCODER.encode(canonicalJson(provider.manifest)),
      ),
      coverage: "annex-b-bounded-seven-part-document",
      annexAPathStreamCovered: true,
      annexBOpcContainerCovered: true,
      boundedSevenPartProfile: true,
      wacomSdkCodeUsed: false,
      thirdPartyCodecCertification: false,
      vendorTrademarkAuthorization: false,
      arbitraryVendorFileInteroperabilityCertified: false,
      decision: "passed",
      case: Object.freeze({
        caseId: "seven-part-catmul-rom-document-v1",
        sourceSha256: hash(source),
        encodedSha256: hash(encoded.bytes),
        repeatedEncodedSha256: hash(repeatedEncoded.bytes),
        decodedSha256: hash(decoded.bytes),
        deterministicEncodeMatch: true,
        roundTripMatch: true,
        encodeReceipt: encoded.receipt,
        repeatedEncodeReceipt: repeatedEncoded.receipt,
        decodeReceipt: decoded.receipt,
      }),
    });
  const bytes =
    serializeStudioFirstPartyWillV1DocumentConformanceEvidence(evidence);
  return Object.freeze({ evidence, bytes, sha256: hash(bytes) });
}
