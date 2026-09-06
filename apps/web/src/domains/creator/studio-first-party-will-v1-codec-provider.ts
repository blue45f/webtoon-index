/**
 * Product-owned provider adapter for the bounded WILL Data Format v1 Annex A Path stream.
 *
 * The public provider transport is canonical ToonSpectrum JSON. The encoded side is the Annex A
 * protobuf Path sequence, not the Annex B OPC/ZIP `.will` document. No Wacom SDK code, vendor
 * certification, trademark authorization, WILL 3, or UIM compatibility is implied.
 */

import {
  STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
  type StudioCodecLicenseScope,
  type StudioCodecProvider,
  type StudioCodecProviderExecution,
  type StudioCodecProviderManifest,
  type StudioCodecProviderRawResult,
} from "./studio-codec-provider-contract";
import { sha256HexPortable } from "./studio-sha256";
import {
  STUDIO_WILL_V1_LIMITS,
  STUDIO_WILL_V1_PATH_MEDIA_TYPE,
  STUDIO_WILL_V1_PROFILE,
  STUDIO_WILL_V1_PUBLIC_PATENT_LICENSE_URL,
  STUDIO_WILL_V1_SPECIFICATION_URL,
  decodeStudioWillV1PathList,
  encodeStudioWillV1PathList,
  encodeStudioWillV1PathListDetailed,
  type StudioWillV1Path,
  type StudioWillV1PathInput,
} from "./studio-will-v1-interchange";

export const STUDIO_FIRST_PARTY_WILL_V1_CODEC_VERSION = "1.0.0" as const;
export const STUDIO_FIRST_PARTY_WILL_V1_FORMAT =
  "will-v1-path-stream" as const;
export const STUDIO_FIRST_PARTY_WILL_V1_EXTENSION = ".willpb" as const;
export const STUDIO_WILL_V1_PATH_TRANSPORT_KIND =
  "toonspectrum-will-v1-path-transport" as const;
export const STUDIO_WILL_V1_PATH_TRANSPORT_VERSION = 1 as const;

const MAX_TRANSPORT_BYTES = 64 * 1024 * 1024;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});
const UTF8_BOM = Object.freeze([0xef, 0xbb, 0xbf] as const);
const LICENSE_SCOPE = Object.freeze([
  "public-clean-room",
  "encode",
  "decode",
  "commercial-use",
] as const satisfies readonly StudioCodecLicenseScope[]);

export const STUDIO_FIRST_PARTY_WILL_V1_CLAIM_BOUNDARY = Object.freeze({
  implementationOwner: "ToonSpectrum" as const,
  publicSpecification: STUDIO_WILL_V1_SPECIFICATION_URL,
  publicPatentLicense: STUDIO_WILL_V1_PUBLIC_PATENT_LICENSE_URL,
  annexAPathStreamImplemented: true as const,
  annexBOpcZipDocumentImplemented: false as const,
  fullWillDocumentExtensionClaimed: false as const,
  wacomSdkCodeUsed: false as const,
  thirdPartyCodecCertification: false as const,
  vendorTrademarkAuthorization: false as const,
  will3Compatibility: false as const,
  uimCompatibility: false as const,
});

export class StudioFirstPartyWillV1CodecError extends Error {
  readonly code:
    | "INVALID_TRANSPORT"
    | "INVALID_UTF8"
    | "LIMIT_EXCEEDED"
    | "NON_CANONICAL_TRANSPORT";

  constructor(
    code: StudioFirstPartyWillV1CodecError["code"],
    message: string,
  ) {
    super(message);
    this.name = "StudioFirstPartyWillV1CodecError";
    this.code = code;
  }
}

interface StudioWillV1PathTransport {
  readonly kind: typeof STUDIO_WILL_V1_PATH_TRANSPORT_KIND;
  readonly paths: readonly StudioWillV1PathInput[];
  readonly schemaVersion: typeof STUDIO_WILL_V1_PATH_TRANSPORT_VERSION;
}

const ROOT_KEYS = ["kind", "paths", "schemaVersion"] as const;
const PATH_KEYS = [
  "decimalPrecision",
  "endParameter",
  "points",
  "startParameter",
  "strokeColor",
  "strokeWidths",
] as const;
const POINT_KEYS = ["x", "y"] as const;
const COLOR_KEYS = ["a", "b", "g", "r"] as const;

function fail(
  code: StudioFirstPartyWillV1CodecError["code"],
  message: string,
): never {
  throw new StudioFirstPartyWillV1CodecError(code, message);
}

function hash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function ownDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || keys.some(
      (key) => typeof key !== "string" || !expectedKeys.includes(key),
    )
  ) {
    return null;
  }
  const record: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return null;
    }
    record[key] = descriptor.value;
  }
  return record;
}

function denseArray(
  value: unknown,
  maximumLength: number,
): readonly unknown[] | null {
  if (!Array.isArray(value) || value.length > maximumLength) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) return null;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return null;
    }
  }
  return value;
}

function numberValue(
  value: unknown,
  minimum: number,
  maximum: number,
  integer = false,
): number | null {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
    || (integer && !Number.isInteger(value))
  ) {
    return null;
  }
  return Object.is(value, -0) ? 0 : value;
}

function pathInput(value: unknown): StudioWillV1PathInput | null {
  const record = ownDataRecord(value, PATH_KEYS);
  if (!record) return null;
  const pointsSource = denseArray(
    record.points,
    STUDIO_WILL_V1_LIMITS.maxPointsPerPath,
  );
  const widthsSource = denseArray(
    record.strokeWidths,
    STUDIO_WILL_V1_LIMITS.maxPointsPerPath,
  );
  const colorRecord = ownDataRecord(record.strokeColor, COLOR_KEYS);
  const decimalPrecision = numberValue(
    record.decimalPrecision,
    0,
    STUDIO_WILL_V1_LIMITS.maxDecimalPrecision,
    true,
  );
  const startParameter = numberValue(record.startParameter, 0, 1);
  const endParameter = numberValue(record.endParameter, 0, 1);
  if (
    !pointsSource
    || !widthsSource
    || !colorRecord
    || decimalPrecision === null
    || startParameter === null
    || endParameter === null
  ) {
    return null;
  }
  const points = pointsSource.map((candidate) => {
    const point = ownDataRecord(candidate, POINT_KEYS);
    const x = point
      ? numberValue(
          point.x,
          -STUDIO_WILL_V1_LIMITS.maxCoordinateMagnitude,
          STUDIO_WILL_V1_LIMITS.maxCoordinateMagnitude,
        )
      : null;
    const y = point
      ? numberValue(
          point.y,
          -STUDIO_WILL_V1_LIMITS.maxCoordinateMagnitude,
          STUDIO_WILL_V1_LIMITS.maxCoordinateMagnitude,
        )
      : null;
    if (x === null || y === null) return null;
    return Object.freeze({ x, y });
  });
  const widths = widthsSource.map((candidate) =>
    numberValue(
      candidate,
      Number.MIN_VALUE,
      STUDIO_WILL_V1_LIMITS.maxStrokeWidth,
    )
  );
  const color = Object.fromEntries(
    COLOR_KEYS.map((channel) => [
      channel,
      numberValue(colorRecord[channel], 0, 255, true),
    ]),
  ) as Record<(typeof COLOR_KEYS)[number], number | null>;
  if (
    points.some((point) => point === null)
    || widths.some((width) => width === null)
    || COLOR_KEYS.some((channel) => color[channel] === null)
  ) {
    return null;
  }
  return Object.freeze({
    decimalPrecision,
    endParameter,
    points: Object.freeze(points as readonly Readonly<{ x: number; y: number }>[]),
    startParameter,
    strokeColor: Object.freeze({
      a: color.a!,
      b: color.b!,
      g: color.g!,
      r: color.r!,
    }),
    strokeWidths: Object.freeze(widths as readonly number[]),
  });
}

function asInput(path: StudioWillV1Path): StudioWillV1PathInput {
  return Object.freeze({
    decimalPrecision: path.decimalPrecision,
    endParameter: path.endParameter,
    points: Object.freeze(
      path.points.map((point) => Object.freeze({ x: point.x, y: point.y })),
    ),
    startParameter: path.startParameter,
    strokeColor: Object.freeze({
      a: path.strokeColor.a,
      b: path.strokeColor.b,
      g: path.strokeColor.g,
      r: path.strokeColor.r,
    }),
    strokeWidths: Object.freeze([...path.strokeWidths]),
  });
}

function canonicalTransport(
  paths: readonly StudioWillV1PathInput[],
): StudioWillV1PathTransport {
  const normalized = encodeStudioWillV1PathListDetailed(paths).paths;
  return Object.freeze({
    kind: STUDIO_WILL_V1_PATH_TRANSPORT_KIND,
    paths: Object.freeze(normalized.map(asInput)),
    schemaVersion: STUDIO_WILL_V1_PATH_TRANSPORT_VERSION,
  });
}

function serializeTransport(transport: StudioWillV1PathTransport): string {
  return JSON.stringify(transport);
}

export function encodeStudioWillV1PathTransport(
  paths: readonly StudioWillV1PathInput[],
): Uint8Array {
  const bytes = TEXT_ENCODER.encode(
    serializeTransport(canonicalTransport(paths)),
  );
  if (bytes.byteLength > MAX_TRANSPORT_BYTES) {
    return fail("LIMIT_EXCEEDED", "WILL v1 path transport is too large.");
  }
  return bytes;
}

export function decodeStudioWillV1PathTransport(
  source: unknown,
): readonly StudioWillV1PathInput[] {
  if (!(source instanceof Uint8Array) || source.byteLength > MAX_TRANSPORT_BYTES) {
    return fail("LIMIT_EXCEEDED", "WILL v1 path transport is too large.");
  }
  if (
    source.byteLength >= UTF8_BOM.length
    && UTF8_BOM.every((byte, index) => source[index] === byte)
  ) {
    return fail(
      "NON_CANONICAL_TRANSPORT",
      "WILL v1 path transport must not contain a UTF-8 BOM.",
    );
  }
  let serialized: string;
  try {
    serialized = TEXT_DECODER.decode(source);
  } catch {
    return fail("INVALID_UTF8", "WILL v1 path transport is not UTF-8.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return fail("INVALID_TRANSPORT", "WILL v1 path transport is not JSON.");
  }
  const root = ownDataRecord(parsed, ROOT_KEYS);
  const pathValues = root
    ? denseArray(root.paths, STUDIO_WILL_V1_LIMITS.maxPaths)
    : null;
  if (
    !root
    || root.kind !== STUDIO_WILL_V1_PATH_TRANSPORT_KIND
    || root.schemaVersion !== STUDIO_WILL_V1_PATH_TRANSPORT_VERSION
    || !pathValues
  ) {
    return fail(
      "INVALID_TRANSPORT",
      "WILL v1 path transport identity is invalid.",
    );
  }
  const paths = pathValues.map(pathInput);
  if (paths.some((path) => path === null)) {
    return fail(
      "INVALID_TRANSPORT",
      "WILL v1 path transport contains an invalid Path.",
    );
  }
  let canonical: StudioWillV1PathTransport;
  try {
    canonical = canonicalTransport(
      paths as readonly StudioWillV1PathInput[],
    );
  } catch (cause) {
    return fail(
      cause instanceof RangeError ? "LIMIT_EXCEEDED" : "INVALID_TRANSPORT",
      "WILL v1 path transport violates the bounded model.",
    );
  }
  if (serializeTransport(canonical) !== serialized) {
    return fail(
      "NON_CANONICAL_TRANSPORT",
      "WILL v1 path transport is not its exact canonical representation.",
    );
  }
  return canonical.paths;
}

const manifest: StudioCodecProviderManifest = Object.freeze({
  schemaVersion: STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
  providerId: "toonspectrum.will-v1-annex-a.v1",
  mode: "public-clean-room",
  format: STUDIO_FIRST_PARTY_WILL_V1_FORMAT,
  profile: STUDIO_WILL_V1_PROFILE,
  version: STUDIO_FIRST_PARTY_WILL_V1_CODEC_VERSION,
  encode: true,
  decode: true,
  mimeTypes: Object.freeze([STUDIO_WILL_V1_PATH_MEDIA_TYPE]),
  extensions: Object.freeze([STUDIO_FIRST_PARTY_WILL_V1_EXTENSION]),
  maxInputBytes: MAX_TRANSPORT_BYTES,
  maxOutputBytes: MAX_TRANSPORT_BYTES,
  deterministic: true,
  licenseGrant: Object.freeze({
    id: "toonspectrum.first-party.will-v1-annex-a.v1",
    scope: LICENSE_SCOPE,
    expiresAt: null,
  }),
  officialClaimPolicy: Object.freeze({
    requiresVerifiedExternalAttestation: true,
    maySelfAssertCertification: false,
    maySelfAssertTrademark: false,
  }),
});

function result(
  execution: StudioCodecProviderExecution,
  bytes: Uint8Array,
): StudioCodecProviderRawResult {
  return Object.freeze({
    schemaVersion: STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
    providerId: manifest.providerId,
    direction: execution.request.direction,
    format: execution.request.format,
    profile: execution.request.profile,
    version: execution.request.version,
    mimeType: execution.request.mimeType,
    extension: execution.request.extension,
    inputSha256: execution.inputSha256,
    outputSha256: hash(bytes),
    bytes,
  });
}

export const STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER: StudioCodecProvider =
  Object.freeze({
    manifest,
    execute(execution: StudioCodecProviderExecution) {
      const bytes = execution.request.direction === "encode"
        ? encodeStudioWillV1PathList(
            decodeStudioWillV1PathTransport(execution.inputBytes),
          )
        : encodeStudioWillV1PathTransport(
            decodeStudioWillV1PathList(execution.inputBytes),
          );
      return result(execution, bytes);
    },
  });
