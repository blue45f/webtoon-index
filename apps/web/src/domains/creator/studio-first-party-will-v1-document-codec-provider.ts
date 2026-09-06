/**
 * Product-owned provider for the bounded WILL Data Format v1 Annex B OPC document profile.
 *
 * `.will` and ToonSpectrum's top-level container media type are used only for the exact seven-part
 * document implemented by `studio-will-v1-opc-interchange`. The public v1 specification does not
 * define a top-level container media type. This is a ToonSpectrum clean-room codec, not a Wacom
 * SDK, vendor certification, trademark grant, or proof that arbitrary vendor files work.
 */

import {
  STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
  type StudioCodecLicenseScope,
  type StudioCodecProvider,
  type StudioCodecProviderExecution,
  type StudioCodecProviderManifest,
  type StudioCodecProviderRawResult,
} from "./studio-codec-provider-contract";
import {
  STUDIO_FIRST_PARTY_WILL_V1_CODEC_VERSION,
  STUDIO_WILL_V1_PATH_TRANSPORT_KIND,
  STUDIO_WILL_V1_PATH_TRANSPORT_VERSION,
  decodeStudioWillV1PathTransport,
} from "./studio-first-party-will-v1-codec-provider";
import { sha256HexPortable } from "./studio-sha256";
import {
  STUDIO_WILL_V1_LIMITS,
  type StudioWillV1Path,
  type StudioWillV1PathInput,
} from "./studio-will-v1-interchange";
import {
  STUDIO_WILL_V1_OPC_ASSURANCE,
  STUDIO_WILL_V1_OPC_EXTENSION,
  STUDIO_WILL_V1_OPC_LIMITS,
  STUDIO_WILL_V1_OPC_MEDIA_TYPE,
  STUDIO_WILL_V1_OPC_PROFILE,
  buildStudioWillV1OpcBytes,
  importStudioWillV1Opc,
  type StudioWillV1OpcExportInput,
  type StudioWillV1OpcImportResult,
} from "./studio-will-v1-opc-interchange";

export const STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_VERSION =
  STUDIO_FIRST_PARTY_WILL_V1_CODEC_VERSION;
export const STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_FORMAT =
  "will-v1-annex-b-document" as const;
export const STUDIO_WILL_V1_DOCUMENT_TRANSPORT_KIND =
  "toonspectrum-will-v1-document-transport" as const;
export const STUDIO_WILL_V1_DOCUMENT_TRANSPORT_VERSION = 1 as const;

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

export const STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CLAIM_BOUNDARY =
  Object.freeze({
    implementationOwner: "ToonSpectrum" as const,
    annexAPathStreamImplemented: true as const,
    annexBOpcSevenPartDocumentImplemented: true as const,
    boundedSevenPartProfileOnly: true as const,
    fullWillExtensionUsedForBoundedDocument: true as const,
    wacomSdkCodeUsed: false as const,
    thirdPartyCodecCertification: false as const,
    vendorTrademarkAuthorization: false as const,
    arbitraryVendorFileInteroperabilityCertified: false as const,
    will3Compatibility: false as const,
    uimCompatibility: false as const,
  });

export class StudioFirstPartyWillV1DocumentCodecError extends Error {
  readonly code:
    | "INVALID_TRANSPORT"
    | "INVALID_UTF8"
    | "LIMIT_EXCEEDED"
    | "NON_CANONICAL_TRANSPORT";

  constructor(
    code: StudioFirstPartyWillV1DocumentCodecError["code"],
    message: string,
  ) {
    super(message);
    this.name = "StudioFirstPartyWillV1DocumentCodecError";
    this.code = code;
  }
}

interface StudioWillV1DocumentTransportDocument {
  readonly application: string;
  readonly applicationVersion: string;
  readonly createdAt: string;
  readonly height: number;
  readonly paths: readonly StudioWillV1PathInput[];
  readonly title: string;
  readonly width: number;
}

interface StudioWillV1DocumentTransport {
  readonly kind: typeof STUDIO_WILL_V1_DOCUMENT_TRANSPORT_KIND;
  readonly document: StudioWillV1DocumentTransportDocument;
  readonly schemaVersion: typeof STUDIO_WILL_V1_DOCUMENT_TRANSPORT_VERSION;
}

const ROOT_KEYS = ["document", "kind", "schemaVersion"] as const;
const DOCUMENT_KEYS = [
  "application",
  "applicationVersion",
  "createdAt",
  "height",
  "paths",
  "title",
  "width",
] as const;

function fail(
  code: StudioFirstPartyWillV1DocumentCodecError["code"],
  message: string,
): never {
  throw new StudioFirstPartyWillV1DocumentCodecError(code, message);
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
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (
    keys.length !== expectedKeys.length
    || keys.some(
      (key) => typeof key !== "string" || !expectedKeys.includes(key),
    )
  ) return null;
  const record: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return null;
    }
    record[key] = descriptor.value;
  }
  return record;
}

function normalizedDimension(value: unknown): number | null {
  return typeof value === "number"
    && Number.isFinite(value)
    && value > 0
    && value <= STUDIO_WILL_V1_OPC_LIMITS.maxDimension
    && Number(value.toFixed(6)) === value
    ? value
    : null;
}

function safeText(value: unknown, maximum: number): value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value.normalize("NFC") !== value
  ) {
    return false;
  }
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (
      code === 0
      || (code >= 1 && code <= 8)
      || code === 11
      || code === 12
      || (code >= 14 && code <= 31)
      || code === 127
      || code === 0xfffe
      || code === 0xffff
    ) {
      return false;
    }
  }
  return true;
}

function canonicalCreatedAt(value: unknown): value is string {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)
  ) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString().replace(".000Z", "Z") === value;
}

function asPathInput(path: StudioWillV1Path): StudioWillV1PathInput {
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

function canonicalPaths(value: unknown): readonly StudioWillV1PathInput[] {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > STUDIO_WILL_V1_LIMITS.maxPaths
  ) {
    return fail(
      "INVALID_TRANSPORT",
      "WILL v1 document transport paths are invalid.",
    );
  }
  try {
    const annexATransport = TEXT_ENCODER.encode(JSON.stringify({
      kind: STUDIO_WILL_V1_PATH_TRANSPORT_KIND,
      paths: value,
      schemaVersion: STUDIO_WILL_V1_PATH_TRANSPORT_VERSION,
    }));
    return decodeStudioWillV1PathTransport(annexATransport);
  } catch {
    return fail(
      "INVALID_TRANSPORT",
      "WILL v1 document transport paths are invalid.",
    );
  }
}

function canonicalDocument(
  value: unknown,
): StudioWillV1DocumentTransportDocument {
  const record = ownDataRecord(value, DOCUMENT_KEYS);
  const width = record ? normalizedDimension(record.width) : null;
  const height = record ? normalizedDimension(record.height) : null;
  if (
    !record
    || width === null
    || height === null
    || !safeText(
      record.title,
      STUDIO_WILL_V1_OPC_LIMITS.maxMetadataCharacters,
    )
    || !canonicalCreatedAt(record.createdAt)
    || !safeText(
      record.application,
      STUDIO_WILL_V1_OPC_LIMITS.maxMetadataCharacters,
    )
    || !safeText(record.applicationVersion, 64)
    || !/^[\p{L}\p{N}][\p{L}\p{N}._+ -]{0,63}$/u.test(
      record.applicationVersion,
    )
  ) {
    return fail(
      "INVALID_TRANSPORT",
      "WILL v1 document transport metadata is invalid.",
    );
  }
  return Object.freeze({
    application: record.application,
    applicationVersion: record.applicationVersion,
    createdAt: record.createdAt,
    height,
    paths: Object.freeze(canonicalPaths(record.paths)),
    title: record.title,
    width,
  });
}

function transportFromImported(
  imported: StudioWillV1OpcImportResult,
): StudioWillV1DocumentTransport {
  return Object.freeze({
    document: Object.freeze({
      application: imported.application,
      applicationVersion: imported.applicationVersion,
      createdAt: imported.createdAt,
      height: imported.height,
      paths: Object.freeze(imported.paths.map(asPathInput)),
      title: imported.title,
      width: imported.width,
    }),
    kind: STUDIO_WILL_V1_DOCUMENT_TRANSPORT_KIND,
    schemaVersion: STUDIO_WILL_V1_DOCUMENT_TRANSPORT_VERSION,
  });
}

function serializeTransport(transport: StudioWillV1DocumentTransport): string {
  return JSON.stringify(transport);
}

function encodeImportedStudioWillV1DocumentTransport(
  imported: StudioWillV1OpcImportResult,
): Uint8Array {
  const bytes = TEXT_ENCODER.encode(
    serializeTransport(transportFromImported(imported)),
  );
  if (bytes.byteLength > MAX_TRANSPORT_BYTES) {
    return fail(
      "LIMIT_EXCEEDED",
      "WILL v1 document transport is too large.",
    );
  }
  return bytes;
}

export async function encodeStudioWillV1DocumentTransport(
  input: StudioWillV1OpcExportInput,
): Promise<Uint8Array> {
  const built = await buildStudioWillV1OpcBytes(input, {
    crc32ExecutionMode: "direct-bounded",
  });
  const imported = await importStudioWillV1Opc(built.bytes);
  return encodeImportedStudioWillV1DocumentTransport(imported);
}

export function decodeStudioWillV1DocumentTransport(
  source: unknown,
): StudioWillV1OpcExportInput {
  if (!(source instanceof Uint8Array)) {
    return fail(
      "INVALID_TRANSPORT",
      "WILL v1 document transport must be bytes.",
    );
  }
  if (source.byteLength > MAX_TRANSPORT_BYTES) {
    return fail(
      "LIMIT_EXCEEDED",
      "WILL v1 document transport is too large.",
    );
  }
  if (
    source.byteLength >= UTF8_BOM.length
    && UTF8_BOM.every((byte, index) => source[index] === byte)
  ) {
    return fail(
      "NON_CANONICAL_TRANSPORT",
      "WILL v1 document transport must not contain a UTF-8 BOM.",
    );
  }
  let serialized: string;
  try {
    serialized = TEXT_DECODER.decode(source);
  } catch {
    return fail(
      "INVALID_UTF8",
      "WILL v1 document transport is not UTF-8.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return fail(
      "INVALID_TRANSPORT",
      "WILL v1 document transport is not JSON.",
    );
  }
  const root = ownDataRecord(parsed, ROOT_KEYS);
  if (
    !root
    || root.kind !== STUDIO_WILL_V1_DOCUMENT_TRANSPORT_KIND
    || root.schemaVersion !== STUDIO_WILL_V1_DOCUMENT_TRANSPORT_VERSION
  ) {
    return fail(
      "INVALID_TRANSPORT",
      "WILL v1 document transport identity is invalid.",
    );
  }
  const document = canonicalDocument(root.document);
  const canonical = Object.freeze({
    document,
    kind: STUDIO_WILL_V1_DOCUMENT_TRANSPORT_KIND,
    schemaVersion: STUDIO_WILL_V1_DOCUMENT_TRANSPORT_VERSION,
  });
  if (serializeTransport(canonical) !== serialized) {
    return fail(
      "NON_CANONICAL_TRANSPORT",
      "WILL v1 document transport is not its exact canonical representation.",
    );
  }
  return Object.freeze({
    application: document.application,
    applicationVersion: document.applicationVersion,
    createdAt: document.createdAt,
    height: document.height,
    paths: document.paths,
    title: document.title,
    width: document.width,
  });
}

const manifest: StudioCodecProviderManifest = Object.freeze({
  schemaVersion: STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
  providerId: "toonspectrum.will-v1-annex-b-document.v1",
  mode: "public-clean-room",
  format: STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_FORMAT,
  profile: STUDIO_WILL_V1_OPC_PROFILE,
  version: STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_VERSION,
  encode: true,
  decode: true,
  mimeTypes: Object.freeze([STUDIO_WILL_V1_OPC_MEDIA_TYPE]),
  extensions: Object.freeze([STUDIO_WILL_V1_OPC_EXTENSION]),
  maxInputBytes: MAX_TRANSPORT_BYTES,
  maxOutputBytes: MAX_TRANSPORT_BYTES,
  deterministic: true,
  licenseGrant: Object.freeze({
    id: "toonspectrum.first-party.will-v1-annex-b-document.v1",
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

export const STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER:
  StudioCodecProvider = Object.freeze({
    manifest,
    async execute(execution: StudioCodecProviderExecution) {
      const bytes = execution.request.direction === "encode"
        ? (
            await buildStudioWillV1OpcBytes(
              decodeStudioWillV1DocumentTransport(execution.inputBytes),
              { crc32ExecutionMode: "direct-bounded" },
            )
          ).bytes
        : encodeImportedStudioWillV1DocumentTransport(
            await importStudioWillV1Opc(execution.inputBytes),
          );
      return result(execution, bytes);
    },
  });

export const STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_ASSURANCE =
  STUDIO_WILL_V1_OPC_ASSURANCE;
