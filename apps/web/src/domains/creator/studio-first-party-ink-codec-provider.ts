/**
 * Product-owned provider adapters for ToonSpectrum InkEnvelope and the bounded public InkML
 * subset.
 *
 * The generic codec provider contract is byte-only. These adapters therefore make both internal
 * transports explicit:
 *
 * - InkEnvelope encode input / decode output: the exact canonical UTF-8 Studio document envelope.
 * - InkML encode input / decode output: an exact canonical UTF-8 trace transport defined below.
 *
 * The encoded sides remain the native `.toonink` and bounded `.inkml` wire bytes. No commercial
 * SDK, vendor codec, hardware identity, trademark permission, or third-party certification is
 * implied. The provider receipts can be bound to ToonSpectrum's separately owned product
 * conformance certificate boundary.
 */

import {
  STUDIO_INK_ENVELOPE_LIMITS,
  decodeStudioInkEnvelope,
  encodeStudioInkEnvelope,
} from "./brush/studio-ink-envelope-codec";
import {
  STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
  type StudioCodecLicenseScope,
  type StudioCodecProvider,
  type StudioCodecProviderExecution,
  type StudioCodecProviderManifest,
  type StudioCodecProviderRawResult,
} from "./studio-codec-provider-contract";
import {
  STUDIO_DOCUMENT_ENVELOPE_LIMITS,
  canonicalizeStudioDocumentEnvelope,
  parseCanonicalStudioDocumentEnvelope,
  serializeCanonicalStudioDocumentEnvelope,
  type CanonicalStudioDocumentEnvelope,
} from "./studio-document-envelope";
import {
  STUDIO_INKML_LIMITS,
  STUDIO_INKML_MEDIA_TYPE,
  STUDIO_INKML_PROFILE,
  compareStudioInkMlChannelNames,
  decodeStudioInkMl,
  encodeStudioInkMl,
  type StudioInkMlDocument,
  type StudioInkMlTrace,
} from "./studio-inkml-codec";
import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_FIRST_PARTY_INK_CODEC_VERSION = "1.0.0" as const;
export const STUDIO_FIRST_PARTY_INK_ENVELOPE_CODEC_PROFILE =
  "toonspectrum-ink-envelope-v1" as const;
export const STUDIO_FIRST_PARTY_INKML_CODEC_PROFILE =
  "toonspectrum-public-inkml-subset-v1" as const;
export const STUDIO_INKML_TRACE_TRANSPORT_KIND =
  "toonspectrum-inkml-trace-transport" as const;
export const STUDIO_INKML_TRACE_TRANSPORT_VERSION = 1 as const;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});
const INKML_TRACE_TRANSPORT_MAX_BYTES = 128 * 1024 * 1024;
const INKML_TRACE_TRANSPORT_MAX_IGNORED_CHANNELS = 4_096;
const INKML_TRACE_TRANSPORT_MAX_JSON_DEPTH = 8;
const INKML_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9._-]{0,127}$/u;
const INKML_CHANNEL_PATTERN = /^[A-Za-z_][A-Za-z0-9._:-]{0,127}$/u;
const UTF8_BOM = Object.freeze([0xef, 0xbb, 0xbf] as const);

const FIRST_PARTY_CODEC_LICENSE_SCOPE = Object.freeze([
  "public-clean-room",
  "encode",
  "decode",
  "commercial-use",
] as const satisfies readonly StudioCodecLicenseScope[]);

export const STUDIO_FIRST_PARTY_INK_CODEC_LIMITS = Object.freeze({
  maxInkEnvelopeDocumentTransportBytes:
    STUDIO_DOCUMENT_ENVELOPE_LIMITS.maxBytes,
  maxInkEnvelopeWireBytes: STUDIO_INK_ENVELOPE_LIMITS.maxWireBytes,
  maxInkMlWireBytes: STUDIO_INKML_LIMITS.maxBytes,
  maxInkMlTraceTransportBytes: INKML_TRACE_TRANSPORT_MAX_BYTES,
  maxInkMlIgnoredChannels: INKML_TRACE_TRANSPORT_MAX_IGNORED_CHANNELS,
  maxInkMlTraceTransportJsonDepth: INKML_TRACE_TRANSPORT_MAX_JSON_DEPTH,
} as const);

/**
 * These are product-boundary facts, not claims about an external organization.
 */
export const STUDIO_FIRST_PARTY_INK_CODEC_CLAIM_BOUNDARY = Object.freeze({
  implementationOwner: "ToonSpectrum" as const,
  productConformanceCertificateBindable: true as const,
  thirdPartyCodecCertification: false as const,
  vendorTrademarkAuthorization: false as const,
  commercialSdkWireCompatibility: false as const,
  wacomWillCompatibility: false as const,
  wacomUimCompatibility: false as const,
} as const);

export class StudioFirstPartyInkCodecError extends Error {
  readonly code:
    | "INVALID_DOCUMENT_TRANSPORT"
    | "INVALID_INKML_TRANSPORT"
    | "INVALID_UTF8"
    | "LIMIT_EXCEEDED"
    | "NON_CANONICAL_TRANSPORT";

  constructor(
    code: StudioFirstPartyInkCodecError["code"],
    message: string,
  ) {
    super(message);
    this.name = "StudioFirstPartyInkCodecError";
    this.code = code;
  }
}

type StudioInkMlTraceTransport = Readonly<{
  kind: typeof STUDIO_INKML_TRACE_TRANSPORT_KIND;
  schemaVersion: typeof STUDIO_INKML_TRACE_TRANSPORT_VERSION;
  profile: StudioInkMlDocument["profile"];
  traces: readonly StudioInkMlTrace[];
  ignoredChannels: readonly string[];
}>;

const TRANSPORT_ROOT_KEYS = [
  "ignoredChannels",
  "kind",
  "profile",
  "schemaVersion",
  "traces",
] as const;
const TRANSPORT_TRACE_KEYS = [
  "id",
  "points",
  "pressures",
  "speeds",
  "tangentialPressures",
  "tiltXs",
  "tiltYs",
  "twists",
] as const;

function fail(
  code: StudioFirstPartyInkCodecError["code"],
  message: string,
): never {
  throw new StudioFirstPartyInkCodecError(code, message);
}

function hash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function ownDataRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    return null;
  }
  const record: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return null;
    }
    record[key] = descriptor.value;
  }
  return record;
}

function exactDenseArray(
  value: unknown,
  maximumLength: number,
): readonly unknown[] | null {
  if (!Array.isArray(value) || value.length > maximumLength) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes("length")) {
    return null;
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return null;
    }
  }
  return value;
}

function canonicalNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
  ) {
    return null;
  }
  return Object.is(value, -0) ? 0 : value;
}

function canonicalNumberArray(
  value: unknown,
  expectedLength: number,
  minimum: number,
  maximum: number,
): readonly number[] | null {
  const array = exactDenseArray(value, expectedLength);
  if (!array || array.length !== expectedLength) return null;
  const result = new Array<number>(expectedLength);
  for (let index = 0; index < expectedLength; index += 1) {
    const normalized = canonicalNumber(array[index], minimum, maximum);
    if (normalized === null) return null;
    result[index] = normalized;
  }
  return Object.freeze(result);
}

function canonicalTrace(
  value: unknown,
  remainingSamples: number,
): StudioInkMlTrace | null {
  const record = ownDataRecord(value, TRANSPORT_TRACE_KEYS);
  if (
    !record
    || typeof record.id !== "string"
    || !INKML_ID_PATTERN.test(record.id)
  ) {
    return null;
  }
  const points = exactDenseArray(
    record.points,
    STUDIO_INKML_LIMITS.maxSamplesPerStroke * 2,
  );
  if (
    !points
    || points.length === 0
    || points.length % 2 !== 0
    || points.length / 2 > remainingSamples
  ) {
    return null;
  }
  const sampleCount = points.length / 2;
  const normalizedPoints = canonicalNumberArray(
    points,
    points.length,
    -1_000_000_000,
    1_000_000_000,
  );
  const pressures = canonicalNumberArray(
    record.pressures,
    sampleCount,
    0,
    1,
  );
  const tiltXs = canonicalNumberArray(
    record.tiltXs,
    sampleCount,
    -90,
    90,
  );
  const tiltYs = canonicalNumberArray(
    record.tiltYs,
    sampleCount,
    -90,
    90,
  );
  const twists = canonicalNumberArray(
    record.twists,
    sampleCount,
    0,
    360,
  );
  const speeds = canonicalNumberArray(
    record.speeds,
    sampleCount,
    0,
    1_000_000,
  );
  const tangentialPressures = canonicalNumberArray(
    record.tangentialPressures,
    sampleCount,
    -1,
    1,
  );
  if (
    !normalizedPoints
    || !pressures
    || !tiltXs
    || !tiltYs
    || !twists
    || twists.some((twist) => twist >= 360)
    || !speeds
    || !tangentialPressures
  ) {
    return null;
  }
  return Object.freeze({
    id: record.id,
    points: normalizedPoints,
    pressures,
    tiltXs,
    tiltYs,
    twists,
    speeds,
    tangentialPressures,
  });
}

function canonicalInkMlTransport(value: unknown): StudioInkMlTraceTransport {
  const record = ownDataRecord(value, TRANSPORT_ROOT_KEYS);
  if (
    !record
    || record.kind !== STUDIO_INKML_TRACE_TRANSPORT_KIND
    || record.schemaVersion !== STUDIO_INKML_TRACE_TRANSPORT_VERSION
    || (
      record.profile !== STUDIO_INKML_PROFILE
      && record.profile !== "inkml-basic"
    )
  ) {
    return fail(
      "INVALID_INKML_TRANSPORT",
      "InkML trace transport root is invalid.",
    );
  }
  const ignoredChannelValues = exactDenseArray(
    record.ignoredChannels,
    INKML_TRACE_TRANSPORT_MAX_IGNORED_CHANNELS,
  );
  if (
    !ignoredChannelValues
    || ignoredChannelValues.some(
      (channel) =>
        typeof channel !== "string"
        || !INKML_CHANNEL_PATTERN.test(channel),
    )
  ) {
    return fail(
      "INVALID_INKML_TRANSPORT",
      "InkML trace transport ignored-channel list is invalid.",
    );
  }
  const ignoredChannels = ignoredChannelValues as readonly string[];
  if (
    new Set(ignoredChannels).size !== ignoredChannels.length
    || ignoredChannels.some(
      (channel, index) =>
        index > 0
        && compareStudioInkMlChannelNames(
          ignoredChannels[index - 1]!,
          channel,
        ) >= 0,
    )
  ) {
    return fail(
      "NON_CANONICAL_TRANSPORT",
      "InkML ignored channels must be unique and sorted.",
    );
  }
  const traceValues = exactDenseArray(
    record.traces,
    STUDIO_INKML_LIMITS.maxStrokes,
  );
  if (!traceValues) {
    return fail(
      "INVALID_INKML_TRANSPORT",
      "InkML trace transport stroke budget is invalid.",
    );
  }
  const traces: StudioInkMlTrace[] = [];
  const ids = new Set<string>();
  let sampleCount = 0;
  for (const value of traceValues) {
    const trace = canonicalTrace(
      value,
      STUDIO_INKML_LIMITS.maxSamples - sampleCount,
    );
    if (!trace || ids.has(trace.id)) {
      return fail(
        "INVALID_INKML_TRANSPORT",
        "InkML trace transport contains an invalid or duplicate trace.",
      );
    }
    ids.add(trace.id);
    sampleCount += trace.points.length / 2;
    traces.push(trace);
  }
  return Object.freeze({
    kind: STUDIO_INKML_TRACE_TRANSPORT_KIND,
    schemaVersion: STUDIO_INKML_TRACE_TRANSPORT_VERSION,
    profile: record.profile,
    traces: Object.freeze(traces),
    ignoredChannels: Object.freeze([...ignoredChannels]),
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return fail(
        "INVALID_INKML_TRANSPORT",
        "InkML trace transport contains a non-finite number.",
      );
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value !== "object" || value === null) {
    return fail(
      "INVALID_INKML_TRANSPORT",
      "InkML trace transport contains a non-JSON value.",
    );
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function serializedInkMlTransport(
  transport: StudioInkMlTraceTransport,
): string {
  return canonicalJson({
    ignoredChannels: transport.ignoredChannels,
    kind: transport.kind,
    profile: transport.profile,
    schemaVersion: transport.schemaVersion,
    traces: transport.traces,
  });
}

function hasUtf8Bom(source: Uint8Array): boolean {
  return (
    source.byteLength >= UTF8_BOM.length
    && UTF8_BOM.every((byte, index) => source[index] === byte)
  );
}

function strictUtf8(
  source: unknown,
  maximumBytes: number,
  transport: "document" | "inkml-json" | "inkml-xml",
): string {
  if (
    !(source instanceof Uint8Array)
    || source.byteLength === 0
    || source.byteLength > maximumBytes
  ) {
    return fail(
      "LIMIT_EXCEEDED",
      `${transport} byte length is outside the provider budget.`,
    );
  }
  if (transport !== "inkml-xml" && hasUtf8Bom(source)) {
    return fail(
      "NON_CANONICAL_TRANSPORT",
      `${transport} canonical UTF-8 must not contain a BOM.`,
    );
  }
  try {
    return TEXT_DECODER.decode(Uint8Array.from(source));
  } catch {
    return fail("INVALID_UTF8", `${transport} is not valid UTF-8.`);
  }
}

function preflightInkMlTransportJson(serialized: string): void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < serialized.length; index += 1) {
    const character = serialized.charCodeAt(index);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === 0x5c) {
        escaped = true;
      } else if (character === 0x22) {
        inString = false;
      }
      continue;
    }
    if (character === 0x22) {
      inString = true;
      continue;
    }
    if (character === 0x7b || character === 0x5b) {
      depth += 1;
      if (depth > INKML_TRACE_TRANSPORT_MAX_JSON_DEPTH) {
        fail(
          "LIMIT_EXCEEDED",
          "InkML trace transport JSON depth exceeds its budget.",
        );
      }
    } else if (character === 0x7d || character === 0x5d) {
      depth -= 1;
      if (depth < 0) {
        fail(
          "INVALID_INKML_TRANSPORT",
          "InkML trace transport JSON nesting is invalid.",
        );
      }
    }
  }
  if (depth !== 0 || inString || escaped) {
    fail(
      "INVALID_INKML_TRANSPORT",
      "InkML trace transport JSON is incomplete.",
    );
  }
}

/**
 * Creates the exact canonical document bytes accepted by the InkEnvelope provider's encode side.
 */
export function encodeStudioInkEnvelopeDocumentTransport(
  input: unknown,
): Uint8Array {
  const canonical = canonicalizeStudioDocumentEnvelope(input);
  if (!canonical.ok) {
    return fail(
      canonical.diagnostics[0].code === "LIMIT_EXCEEDED"
        ? "LIMIT_EXCEEDED"
        : "INVALID_DOCUMENT_TRANSPORT",
      "Studio document cannot be represented by the InkEnvelope transport.",
    );
  }
  const bytes = TEXT_ENCODER.encode(
    serializeCanonicalStudioDocumentEnvelope(canonical.envelope),
  );
  if (
    bytes.byteLength
      > STUDIO_FIRST_PARTY_INK_CODEC_LIMITS.maxInkEnvelopeDocumentTransportBytes
  ) {
    return fail(
      "LIMIT_EXCEEDED",
      "Studio document transport exceeds the InkEnvelope budget.",
    );
  }
  return bytes;
}

/**
 * Accepts only the exact canonical document bytes emitted above.
 */
export function decodeStudioInkEnvelopeDocumentTransport(
  source: unknown,
): CanonicalStudioDocumentEnvelope {
  const serialized = strictUtf8(
    source,
    STUDIO_FIRST_PARTY_INK_CODEC_LIMITS.maxInkEnvelopeDocumentTransportBytes,
    "document",
  );
  const parsed = parseCanonicalStudioDocumentEnvelope(serialized);
  if (!parsed.ok) {
    return fail(
      parsed.diagnostics[0].code === "LIMIT_EXCEEDED"
        ? "LIMIT_EXCEEDED"
        : parsed.diagnostics[0].code === "NON_CANONICAL_SERIALIZATION"
          ? "NON_CANONICAL_TRANSPORT"
          : "INVALID_DOCUMENT_TRANSPORT",
      "Studio document transport is invalid or non-canonical.",
    );
  }
  return parsed.envelope;
}

/**
 * Creates the exact canonical JSON bytes used between the product model and the InkML provider.
 */
export function encodeStudioInkMlTraceTransport(
  document: StudioInkMlDocument,
): Uint8Array {
  const transport = canonicalInkMlTransport({
    ignoredChannels: document.ignoredChannels,
    kind: STUDIO_INKML_TRACE_TRANSPORT_KIND,
    profile: document.profile,
    schemaVersion: STUDIO_INKML_TRACE_TRANSPORT_VERSION,
    traces: document.traces,
  });
  const bytes = TEXT_ENCODER.encode(serializedInkMlTransport(transport));
  if (bytes.byteLength > INKML_TRACE_TRANSPORT_MAX_BYTES) {
    return fail(
      "LIMIT_EXCEEDED",
      "InkML trace transport exceeds its byte budget.",
    );
  }
  return bytes;
}

/**
 * Parses only the exact canonical trace JSON emitted above.
 */
export function decodeStudioInkMlTraceTransport(
  source: unknown,
): StudioInkMlDocument {
  const serialized = strictUtf8(
    source,
    INKML_TRACE_TRANSPORT_MAX_BYTES,
    "inkml-json",
  );
  preflightInkMlTransportJson(serialized);
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return fail(
      "INVALID_INKML_TRANSPORT",
      "InkML trace transport JSON could not be parsed.",
    );
  }
  const transport = canonicalInkMlTransport(parsed);
  if (serializedInkMlTransport(transport) !== serialized) {
    return fail(
      "NON_CANONICAL_TRANSPORT",
      "InkML trace transport is not its exact canonical representation.",
    );
  }
  return Object.freeze({
    profile: transport.profile,
    traces: transport.traces,
    ignoredChannels: transport.ignoredChannels,
  });
}

function manifest(
  input: Readonly<{
    providerId: string;
    format: string;
    profile: string;
    mimeType: string;
    extension: string;
    maxInputBytes: number;
    maxOutputBytes: number;
    licenseId: string;
  }>,
): StudioCodecProviderManifest {
  return Object.freeze({
    schemaVersion: STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
    providerId: input.providerId,
    mode: "public-clean-room",
    format: input.format,
    profile: input.profile,
    version: STUDIO_FIRST_PARTY_INK_CODEC_VERSION,
    encode: true,
    decode: true,
    mimeTypes: Object.freeze([input.mimeType]),
    extensions: Object.freeze([input.extension]),
    maxInputBytes: input.maxInputBytes,
    maxOutputBytes: input.maxOutputBytes,
    deterministic: true,
    licenseGrant: Object.freeze({
      id: input.licenseId,
      scope: FIRST_PARTY_CODEC_LICENSE_SCOPE,
      expiresAt: null,
    }),
    officialClaimPolicy: Object.freeze({
      requiresVerifiedExternalAttestation: true,
      maySelfAssertCertification: false,
      maySelfAssertTrademark: false,
    }),
  });
}

function result(
  providerId: string,
  execution: StudioCodecProviderExecution,
  bytes: Uint8Array,
): StudioCodecProviderRawResult {
  return Object.freeze({
    schemaVersion: STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
    providerId,
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

const inkEnvelopeManifest = manifest({
  providerId: "toonspectrum.ink-envelope.v1",
  format: "toonink",
  profile: STUDIO_FIRST_PARTY_INK_ENVELOPE_CODEC_PROFILE,
  mimeType: "application/vnd.toonspectrum.ink+json",
  extension: ".toonink",
  maxInputBytes: STUDIO_INK_ENVELOPE_LIMITS.maxWireBytes,
  maxOutputBytes: STUDIO_INK_ENVELOPE_LIMITS.maxWireBytes,
  licenseId: "toonspectrum.first-party.ink-envelope.v1",
});

const inkMlManifest = manifest({
  providerId: "toonspectrum.public-inkml-subset.v1",
  format: "inkml",
  profile: STUDIO_FIRST_PARTY_INKML_CODEC_PROFILE,
  mimeType: STUDIO_INKML_MEDIA_TYPE,
  extension: ".inkml",
  maxInputBytes: INKML_TRACE_TRANSPORT_MAX_BYTES,
  maxOutputBytes: INKML_TRACE_TRANSPORT_MAX_BYTES,
  licenseId: "toonspectrum.first-party.public-inkml-subset.v1",
});

export const STUDIO_FIRST_PARTY_INK_ENVELOPE_CODEC_PROVIDER: StudioCodecProvider =
  Object.freeze({
    manifest: inkEnvelopeManifest,
    async execute(execution: StudioCodecProviderExecution) {
      const bytes = execution.request.direction === "encode"
        ? await encodeStudioInkEnvelope(
            decodeStudioInkEnvelopeDocumentTransport(execution.inputBytes),
            {
              maxWireBytes:
                STUDIO_FIRST_PARTY_INK_CODEC_LIMITS.maxInkEnvelopeWireBytes,
            },
          )
        : encodeStudioInkEnvelopeDocumentTransport(
            (
              await decodeStudioInkEnvelope(execution.inputBytes, {
                maxWireBytes:
                  STUDIO_FIRST_PARTY_INK_CODEC_LIMITS.maxInkEnvelopeWireBytes,
              })
            ).envelope,
          );
      return result(inkEnvelopeManifest.providerId, execution, bytes);
    },
  });

export const STUDIO_FIRST_PARTY_INKML_CODEC_PROVIDER: StudioCodecProvider =
  Object.freeze({
    manifest: inkMlManifest,
    execute(execution: StudioCodecProviderExecution) {
      const bytes = execution.request.direction === "encode"
        ? (() => {
            const document = decodeStudioInkMlTraceTransport(
              execution.inputBytes,
            );
            if (document.ignoredChannels.length > 0) {
              return fail(
                "INVALID_INKML_TRANSPORT",
                "InkML encode requires callers to resolve ignored source channels explicitly.",
              );
            }
            return TEXT_ENCODER.encode(
              encodeStudioInkMl(document.traces, {
                maxBytes:
                  STUDIO_FIRST_PARTY_INK_CODEC_LIMITS.maxInkMlWireBytes,
              }),
            );
          })()
        : encodeStudioInkMlTraceTransport(
            decodeStudioInkMl(
              strictUtf8(
                execution.inputBytes,
                STUDIO_FIRST_PARTY_INK_CODEC_LIMITS.maxInkMlWireBytes,
                "inkml-xml",
              ),
              {
                maxBytes:
                  STUDIO_FIRST_PARTY_INK_CODEC_LIMITS.maxInkMlWireBytes,
              },
            ),
          );
      return result(inkMlManifest.providerId, execution, bytes);
    },
  });

/**
 * Explicit registry: the generic provider contract never installs codecs implicitly.
 */
export const STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS:
  readonly StudioCodecProvider[] = Object.freeze([
    STUDIO_FIRST_PARTY_INK_ENVELOPE_CODEC_PROVIDER,
    STUDIO_FIRST_PARTY_INKML_CODEC_PROVIDER,
  ]);
