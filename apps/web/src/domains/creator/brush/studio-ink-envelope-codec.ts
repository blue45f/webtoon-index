/**
 * ToonSpectrum-owned durable ink interchange envelope.
 *
 * This is a clean-room format built from public JSON, UTF-8, and SHA-256 primitives. It is not a
 * clone of any commercial SDK codec and intentionally makes no claim of wire compatibility with
 * one. The existing engine-neutral Studio document envelope remains the canonical content model;
 * this module adds only a deterministic wire container, integrity manifest, optional attestation,
 * and a replaceable product adapter boundary.
 *
 * Version 1 wire form is canonical UTF-8 JSON:
 * - object keys are emitted in a fixed lexical order;
 * - `content` is the exact canonical Studio document envelope;
 * - SHA-256 covers the exact canonical content bytes;
 * - unknown wire versions, fields, flags, non-canonical bytes, tampering, and budget overruns fail
 *   closed before a product adapter is invoked;
 * - optional attestations sign a domain-separated manifest message, never mutable display data.
 *
 * A commercial certification authority can later be connected through the attestation verifier
 * without changing the document model. ToonSpectrum's own conformance tests and signatures prove
 * adherence to this format, but do not impersonate a third party's certification.
 */

import {
  STUDIO_DOCUMENT_ENVELOPE_LIMITS,
  canonicalizeStudioDocumentEnvelope,
  checksumCanonicalStudioDocumentEnvelope,
  serializeCanonicalStudioDocumentEnvelope,
  type CanonicalStudioDocumentEnvelope,
  type StudioDocumentEnvelopeLimits,
  type StudioDocumentEnvelopeOptions,
} from "../studio-document-envelope";

export const STUDIO_INK_ENVELOPE_CODEC_ID =
  "toonspectrum.ink-envelope" as const;
export const STUDIO_INK_ENVELOPE_CODEC_VERSION = 1 as const;
export const STUDIO_INK_ENVELOPE_SERIALIZATION =
  "canonical-json-utf8" as const;
export const STUDIO_INK_ENVELOPE_DIGEST_ALGORITHM = "sha256" as const;
export const STUDIO_INK_ENVELOPE_ATTESTATION_DOMAIN =
  "toonspectrum:ink-envelope-attestation:v1" as const;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ADAPTER_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u;
const ATTESTATION_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,255}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{1,16384}$/u;
const MAX_FORMAT_VERSION = 1_000_000;
const MAX_WIRE_OVERHEAD_BYTES = 32 * 1_024;
const MAX_WIRE_BYTES =
  STUDIO_DOCUMENT_ENVELOPE_LIMITS.maxBytes + MAX_WIRE_OVERHEAD_BYTES;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength"
)?.get;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag
)?.get;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer"
)?.get;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteOffset"
)?.get;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength"
)?.get;
const SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
      SharedArrayBuffer.prototype,
      "byteLength"
    )?.get;

export const STUDIO_INK_ENVELOPE_LIMITS = Object.freeze({
  maxWireBytes: MAX_WIRE_BYTES,
  maxAttestationBytes: 12 * 1_024,
});

export const STUDIO_INK_ENVELOPE_CONFORMANCE_PROFILE = Object.freeze({
  id: "toonspectrum.ink-envelope.conformance",
  version: 1,
  canonicalSerialization: STUDIO_INK_ENVELOPE_SERIALIZATION,
  contentIntegrity: "sha256-canonical-content",
  unknownFields: "reject",
  unknownWireVersions: "reject",
  productPayload: "opaque-canonical-studio-document",
  attestation: "optional-domain-separated-algorithm-key-bound-signature",
} as const);

export type StudioInkEnvelopeErrorCode =
  | "INVALID_SOURCE"
  | "INVALID_UTF8"
  | "INVALID_JSON"
  | "INVALID_STRUCTURE"
  | "LIMIT_EXCEEDED"
  | "UNKNOWN_FUTURE_VERSION"
  | "UNSUPPORTED_CODEC"
  | "NON_CANONICAL_SERIALIZATION"
  | "INTEGRITY_MISMATCH"
  | "ATTESTATION_REQUIRED"
  | "ATTESTATION_UNVERIFIED"
  | "ATTESTATION_INVALID"
  | "ADAPTER_MISMATCH"
  | "UNKNOWN_FUTURE_PAYLOAD_VERSION"
  | "UNSUPPORTED_PAST_PAYLOAD_VERSION"
  | "ADAPTER_REJECTED";

export class StudioInkEnvelopeError extends Error {
  readonly code: StudioInkEnvelopeErrorCode;
  readonly path?: string;

  constructor(
    code: StudioInkEnvelopeErrorCode,
    message: string,
    options: Readonly<{ path?: string }> = {}
  ) {
    super(message);
    this.name = "StudioInkEnvelopeError";
    this.code = code;
    this.path = options.path;
  }
}

export interface StudioInkEnvelopeAttestation {
  readonly algorithm: string;
  readonly keyId: string;
  readonly signature: string;
}

export interface StudioInkEnvelopeManifest {
  readonly attestation: StudioInkEnvelopeAttestation | null;
  readonly canonicalByteLength: number;
  readonly contentDigest: `sha256:${string}`;
  readonly digestAlgorithm: typeof STUDIO_INK_ENVELOPE_DIGEST_ALGORITHM;
}

/**
 * Pluggable signer for organization-owned or audited key infrastructure.
 *
 * The callback receives an owned byte array containing only the v1 domain, attestation algorithm,
 * key id, canonical content byte length, and SHA-256 digest. The returned signature must be
 * unpadded base64url.
 */
export interface StudioInkEnvelopeAttester {
  readonly algorithm: string;
  readonly keyId: string;
  readonly sign: (message: Uint8Array) => string | Promise<string>;
}

/** Verification boundary for signatures issued by a selected trust domain. */
export interface StudioInkEnvelopeAttestationVerifier {
  readonly verify: (input: Readonly<{
    algorithm: string;
    keyId: string;
    message: Uint8Array;
    signature: string;
  }>) => boolean | Promise<boolean>;
}

/**
 * Product-specific decoder for the opaque canonical content.
 *
 * The codec checks identity and supported version bounds before calling `decode`. A brush engine,
 * input-provenance contract, Studio project, or future interchange format can therefore be
 * swapped independently without weakening the wire conformance boundary.
 */
export interface StudioInkEnvelopePayloadAdapter<Output> {
  readonly id: string;
  readonly formatId: string;
  readonly payloadType: string;
  readonly minimumVersion: number;
  readonly currentVersion: number;
  readonly decode: (
    envelope: CanonicalStudioDocumentEnvelope
  ) => Output | Promise<Output>;
}

export interface StudioInkEnvelopeEncodeOptions
  extends StudioDocumentEnvelopeOptions {
  readonly maxWireBytes?: number;
  readonly attester?: StudioInkEnvelopeAttester;
}

export interface StudioInkEnvelopeDecodeOptions<Output = never>
  extends StudioDocumentEnvelopeOptions {
  readonly maxWireBytes?: number;
  readonly requireAttestation?: boolean;
  readonly attestationVerifier?: StudioInkEnvelopeAttestationVerifier;
  readonly adapter?: StudioInkEnvelopePayloadAdapter<Output>;
}

export interface DecodedStudioInkEnvelope<Output = never> {
  readonly codec: Readonly<{
    id: typeof STUDIO_INK_ENVELOPE_CODEC_ID;
    serialization: typeof STUDIO_INK_ENVELOPE_SERIALIZATION;
    version: typeof STUDIO_INK_ENVELOPE_CODEC_VERSION;
  }>;
  readonly manifest: StudioInkEnvelopeManifest;
  readonly envelope: CanonicalStudioDocumentEnvelope;
  readonly adapted: Output | null;
}

interface ParsedInkEnvelopeRoot {
  readonly codec: Record<string, unknown>;
  readonly content: unknown;
  readonly manifest: Record<string, unknown>;
}

function fail(
  code: StudioInkEnvelopeErrorCode,
  message: string,
  path?: string
): never {
  throw new StudioInkEnvelopeError(code, message, path ? { path } : {});
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function exactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  path: string
): void {
  const expected = new Set(expectedKeys);
  const keys = Object.keys(value);
  if (
    keys.length !== expected.size ||
    keys.some((key) => !expected.has(key))
  ) {
    fail(
      "INVALID_STRUCTURE",
      "InkEnvelope contains missing or unknown fields.",
      path
    );
  }
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    fail("INVALID_STRUCTURE", "InkEnvelope field must be an object.", path);
  }
  return value;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    fail("INVALID_STRUCTURE", "InkEnvelope field must be a string.", path);
  }
  return value;
}

function preflightLimit(
  limits: Partial<StudioDocumentEnvelopeLimits> | undefined,
  key: keyof StudioDocumentEnvelopeLimits,
  minimum: number
): number {
  const hardMaximum = STUDIO_DOCUMENT_ENVELOPE_LIMITS[key];
  const value = limits?.[key] ?? hardMaximum;
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > hardMaximum
  ) {
    fail(
      "LIMIT_EXCEEDED",
      `InkEnvelope ${key} budget must be between ${minimum} and ${hardMaximum}.`
    );
  }
  return value;
}

interface JsonPreflightContainer {
  readonly type: "array" | "object";
  arrayItems: number;
  objectKeys: number;
}

/**
 * Rejects allocation-amplifying JSON before `JSON.parse` creates a large object graph.
 *
 * This is deliberately a conservative lexical budget pass, not a second JSON parser. Exact JSON
 * grammar and canonical key order are still enforced by JSON.parse plus deterministic
 * reserialization. Counting strings (including keys) as nodes can only reject earlier.
 */
function assertJsonAllocationBudget(
  serialized: string,
  options: StudioDocumentEnvelopeOptions
): void {
  const configured = options.limits;
  // Validate every caller-supplied content budget before parsing. The lexical pass itself must use
  // hard wire budgets rather than those content budgets: the outer codec/manifest fields are not
  // part of `content`, and JSON escapes can occupy more source characters than the decoded UTF-8
  // value. Exact caller budgets are applied to `/content` by the canonical document validator
  // after this global allocation-amplification guard.
  preflightLimit(configured, "maxBytes", 1);
  preflightLimit(configured, "maxDepth", 1);
  preflightLimit(configured, "maxNodes", 1);
  preflightLimit(configured, "maxObjectKeys", 1);
  preflightLimit(configured, "maxArrayItems", 0);
  preflightLimit(configured, "maxStringBytes", 0);
  preflightLimit(configured, "maxKeyBytes", 1);
  preflightLimit(configured, "maxExtensions", 0);

  const maxDepth = STUDIO_DOCUMENT_ENVELOPE_LIMITS.maxDepth + 8;
  const maxNodes = STUDIO_DOCUMENT_ENVELOPE_LIMITS.maxNodes;
  const maxArrayItems = STUDIO_DOCUMENT_ENVELOPE_LIMITS.maxArrayItems;
  const maxObjectKeys = STUDIO_DOCUMENT_ENVELOPE_LIMITS.maxObjectKeys;
  const maxStringCharacters = STUDIO_INK_ENVELOPE_LIMITS.maxWireBytes;
  const maxKeyCharacters = STUDIO_INK_ENVELOPE_LIMITS.maxWireBytes;
  const conservativeNodeCeiling = maxNodes * 2 + 128;
  const stack: JsonPreflightContainer[] = [];
  let nodes = 0;

  const addNode = (): void => {
    nodes += 1;
    if (nodes > conservativeNodeCeiling) {
      fail(
        "LIMIT_EXCEEDED",
        "InkEnvelope JSON node preflight budget was exceeded."
      );
    }
    const parent = stack.at(-1);
    if (parent?.type === "array") {
      parent.arrayItems += 1;
      if (parent.arrayItems > maxArrayItems) {
        fail(
          "LIMIT_EXCEEDED",
          "InkEnvelope JSON array preflight budget was exceeded."
        );
      }
    }
  };

  for (let index = 0; index < serialized.length; index += 1) {
    const character = serialized.charCodeAt(index);
    if (
      character === 0x20 ||
      character === 0x09 ||
      character === 0x0a ||
      character === 0x0d ||
      character === 0x2c ||
      character === 0x3a
    ) continue;

    if (character === 0x7b || character === 0x5b) {
      addNode();
      stack.push({
        type: character === 0x7b ? "object" : "array",
        arrayItems: 0,
        objectKeys: 0,
      });
      if (stack.length > maxDepth) {
        fail(
          "LIMIT_EXCEEDED",
          "InkEnvelope JSON depth preflight budget was exceeded."
        );
      }
      continue;
    }
    if (character === 0x7d || character === 0x5d) {
      stack.pop();
      continue;
    }
    if (character === 0x22) {
      const start = index + 1;
      let escaped = false;
      for (index += 1; index < serialized.length; index += 1) {
        const stringCharacter = serialized.charCodeAt(index);
        if (escaped) {
          escaped = false;
          continue;
        }
        if (stringCharacter === 0x5c) {
          escaped = true;
          continue;
        }
        if (stringCharacter === 0x22) break;
      }
      let next = index + 1;
      while (
        next < serialized.length &&
        /\s/u.test(serialized[next]!)
      ) next += 1;
      const isObjectKey =
        stack.at(-1)?.type === "object" &&
        serialized.charCodeAt(next) === 0x3a;
      nodes += 1;
      if (nodes > conservativeNodeCeiling) {
        fail(
          "LIMIT_EXCEEDED",
          "InkEnvelope JSON node preflight budget was exceeded."
        );
      }
      if (isObjectKey) {
        const container = stack.at(-1)!;
        container.objectKeys += 1;
        if (
          container.objectKeys > maxObjectKeys ||
          index - start > maxKeyCharacters
        ) {
          fail(
            "LIMIT_EXCEEDED",
            "InkEnvelope JSON object-key preflight budget was exceeded."
          );
        }
      } else {
        if (index - start > maxStringCharacters) {
          fail(
            "LIMIT_EXCEEDED",
            "InkEnvelope JSON string preflight budget was exceeded."
          );
        }
        const parent = stack.at(-1);
        if (parent?.type === "array") {
          parent.arrayItems += 1;
          if (parent.arrayItems > maxArrayItems) {
            fail(
              "LIMIT_EXCEEDED",
              "InkEnvelope JSON array preflight budget was exceeded."
            );
          }
        }
      }
      continue;
    }
    if (
      character === 0x2d ||
      (character >= 0x30 && character <= 0x39) ||
      character === 0x74 ||
      character === 0x66 ||
      character === 0x6e
    ) {
      addNode();
      const primitiveStart = index;
      while (
        index + 1 < serialized.length &&
        !/[\s,\]}]/u.test(serialized[index + 1]!)
      ) {
        index += 1;
        if (index - primitiveStart + 1 > 128) {
          fail(
            "LIMIT_EXCEEDED",
            "InkEnvelope JSON primitive token preflight budget was exceeded."
          );
        }
      }
    }
  }
}

function resolveMaxWireBytes(value: number | undefined): number {
  const candidate = value ?? STUDIO_INK_ENVELOPE_LIMITS.maxWireBytes;
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < 1 ||
    candidate > STUDIO_INK_ENVELOPE_LIMITS.maxWireBytes
  ) {
    fail(
      "LIMIT_EXCEEDED",
      `InkEnvelope maxWireBytes must be between 1 and ${STUDIO_INK_ENVELOPE_LIMITS.maxWireBytes}.`
    );
  }
  return candidate;
}

function hasArrayBufferInternalSlot(value: unknown): value is ArrayBuffer {
  if (!ARRAY_BUFFER_BYTE_LENGTH_GETTER) return false;
  try {
    ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(value);
    return true;
  } catch {
    return false;
  }
}

function hasSharedArrayBufferInternalSlot(
  value: unknown
): value is SharedArrayBuffer {
  if (!SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER) return false;
  try {
    SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(value);
    return true;
  } catch {
    return false;
  }
}

function intrinsicUint8ArrayView(
  value: unknown
): Readonly<{
  buffer: ArrayBuffer | SharedArrayBuffer;
  byteOffset: number;
  byteLength: number;
}> | null {
  if (
    !TYPED_ARRAY_TAG_GETTER ||
    !TYPED_ARRAY_BUFFER_GETTER ||
    !TYPED_ARRAY_BYTE_OFFSET_GETTER ||
    !TYPED_ARRAY_BYTE_LENGTH_GETTER
  ) return null;
  try {
    if (TYPED_ARRAY_TAG_GETTER.call(value) !== "Uint8Array") return null;
    return Object.freeze({
      buffer: TYPED_ARRAY_BUFFER_GETTER.call(value) as
        | ArrayBuffer
        | SharedArrayBuffer,
      byteOffset: TYPED_ARRAY_BYTE_OFFSET_GETTER.call(value) as number,
      byteLength: TYPED_ARRAY_BYTE_LENGTH_GETTER.call(value) as number,
    });
  } catch {
    return null;
  }
}

function ownedWireBytes(source: unknown, maxWireBytes: number): Uint8Array {
  let bytes: Uint8Array;
  try {
    if (hasArrayBufferInternalSlot(source)) {
      bytes = new Uint8Array(source as ArrayBuffer);
    } else {
      const view = intrinsicUint8ArrayView(source);
      if (!view || hasSharedArrayBufferInternalSlot(view.buffer)) {
        fail(
          "INVALID_SOURCE",
          "InkEnvelope source must be an ArrayBuffer or Uint8Array."
        );
      }
      bytes = new Uint8Array(
        view.buffer as ArrayBuffer,
        view.byteOffset,
        view.byteLength
      );
    }
  } catch (error) {
    if (error instanceof StudioInkEnvelopeError) throw error;
    fail("INVALID_SOURCE", "InkEnvelope source buffer is detached or invalid.");
  }
  if (bytes.byteLength === 0) {
    fail(
      "INVALID_SOURCE",
      "InkEnvelope source must use non-empty owned byte storage."
    );
  }
  if (bytes.byteLength > maxWireBytes) {
    fail("LIMIT_EXCEEDED", "InkEnvelope exceeds its wire byte budget.");
  }
  return bytes.slice();
}

function canonicalAttestation(
  value: unknown,
  path: string
): StudioInkEnvelopeAttestation | null {
  if (value === null) return null;
  const record = requiredRecord(value, path);
  exactKeys(record, ["algorithm", "keyId", "signature"], path);
  const algorithm = requiredString(record.algorithm, `${path}/algorithm`);
  const keyId = requiredString(record.keyId, `${path}/keyId`);
  const signature = requiredString(record.signature, `${path}/signature`);
  if (!ATTESTATION_TOKEN_PATTERN.test(algorithm)) {
    fail(
      "INVALID_STRUCTURE",
      "InkEnvelope attestation algorithm is invalid.",
      `${path}/algorithm`
    );
  }
  if (!ATTESTATION_TOKEN_PATTERN.test(keyId)) {
    fail(
      "INVALID_STRUCTURE",
      "InkEnvelope attestation keyId is invalid.",
      `${path}/keyId`
    );
  }
  if (
    !BASE64URL_PATTERN.test(signature) ||
    signature.length % 4 === 1
  ) {
    fail(
      "INVALID_STRUCTURE",
      "InkEnvelope attestation signature must be canonical unpadded base64url.",
      `${path}/signature`
    );
  }
  if (
    TEXT_ENCODER.encode(signature).byteLength >
    STUDIO_INK_ENVELOPE_LIMITS.maxAttestationBytes
  ) {
    fail(
      "LIMIT_EXCEEDED",
      "InkEnvelope attestation signature exceeds its byte budget.",
      `${path}/signature`
    );
  }
  return Object.freeze({ algorithm, keyId, signature });
}

function validateAttester(attester: StudioInkEnvelopeAttester): void {
  if (
    !ATTESTATION_TOKEN_PATTERN.test(attester.algorithm) ||
    !ATTESTATION_TOKEN_PATTERN.test(attester.keyId) ||
    typeof attester.sign !== "function"
  ) {
    fail(
      "INVALID_STRUCTURE",
      "InkEnvelope attester identity or sign callback is invalid."
    );
  }
}

function validateAdapter<Output>(
  adapter: StudioInkEnvelopePayloadAdapter<Output>
): void {
  if (
    !ADAPTER_ID_PATTERN.test(adapter.id) ||
    !ADAPTER_ID_PATTERN.test(adapter.formatId) ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(adapter.payloadType) ||
    !Number.isSafeInteger(adapter.minimumVersion) ||
    !Number.isSafeInteger(adapter.currentVersion) ||
    adapter.minimumVersion < 1 ||
    adapter.currentVersion < adapter.minimumVersion ||
    adapter.currentVersion > MAX_FORMAT_VERSION ||
    typeof adapter.decode !== "function"
  ) {
    fail(
      "INVALID_STRUCTURE",
      "InkEnvelope payload adapter definition is invalid."
    );
  }
}

function serializeAttestation(
  value: StudioInkEnvelopeAttestation | null
): string {
  if (value === null) return "null";
  return `{"algorithm":${JSON.stringify(value.algorithm)},"keyId":${JSON.stringify(value.keyId)},"signature":${JSON.stringify(value.signature)}}`;
}

function serializeWireEnvelope(
  content: string,
  manifest: StudioInkEnvelopeManifest
): string {
  return `{"codec":{"id":${JSON.stringify(STUDIO_INK_ENVELOPE_CODEC_ID)},"serialization":${JSON.stringify(STUDIO_INK_ENVELOPE_SERIALIZATION)},"version":${STUDIO_INK_ENVELOPE_CODEC_VERSION}},"content":${content},"manifest":{"attestation":${serializeAttestation(manifest.attestation)},"canonicalByteLength":${manifest.canonicalByteLength},"contentDigest":${JSON.stringify(manifest.contentDigest)},"digestAlgorithm":${JSON.stringify(STUDIO_INK_ENVELOPE_DIGEST_ALGORITHM)}}}`;
}

export function studioInkEnvelopeAttestationMessage(
  algorithm: string,
  keyId: string,
  canonicalByteLength: number,
  contentDigest: string
): Uint8Array {
  if (
    !ATTESTATION_TOKEN_PATTERN.test(algorithm) ||
    !ATTESTATION_TOKEN_PATTERN.test(keyId) ||
    !Number.isSafeInteger(canonicalByteLength) ||
    canonicalByteLength < 1 ||
    canonicalByteLength > STUDIO_DOCUMENT_ENVELOPE_LIMITS.maxBytes ||
    !SHA256_PATTERN.test(contentDigest)
  ) {
    fail(
      "INVALID_STRUCTURE",
      "InkEnvelope attestation manifest input is invalid."
    );
  }
  return TEXT_ENCODER.encode(
    `${STUDIO_INK_ENVELOPE_ATTESTATION_DOMAIN}\n${algorithm}\n${keyId}\n${canonicalByteLength}\n${contentDigest}`
  );
}

function parseRoot(serialized: string): ParsedInkEnvelopeRoot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    fail("INVALID_JSON", "InkEnvelope JSON could not be parsed.");
  }
  const root = requiredRecord(parsed, "");
  exactKeys(root, ["codec", "content", "manifest"], "");
  return {
    codec: requiredRecord(root.codec, "/codec"),
    content: root.content,
    manifest: requiredRecord(root.manifest, "/manifest"),
  };
}

function validateCodec(codec: Record<string, unknown>): void {
  exactKeys(codec, ["id", "serialization", "version"], "/codec");
  if (codec.id !== STUDIO_INK_ENVELOPE_CODEC_ID) {
    fail("UNSUPPORTED_CODEC", "InkEnvelope codec id is unsupported.", "/codec/id");
  }
  if (
    typeof codec.version !== "number" ||
    !Number.isSafeInteger(codec.version) ||
    codec.version < 1
  ) {
    fail(
      "INVALID_STRUCTURE",
      "InkEnvelope codec version is invalid.",
      "/codec/version"
    );
  }
  if (codec.version > STUDIO_INK_ENVELOPE_CODEC_VERSION) {
    fail(
      "UNKNOWN_FUTURE_VERSION",
      "InkEnvelope was written by a newer codec version.",
      "/codec/version"
    );
  }
  if (codec.version !== STUDIO_INK_ENVELOPE_CODEC_VERSION) {
    fail(
      "UNSUPPORTED_CODEC",
      "InkEnvelope codec version is no longer supported.",
      "/codec/version"
    );
  }
  if (codec.serialization !== STUDIO_INK_ENVELOPE_SERIALIZATION) {
    fail(
      "UNSUPPORTED_CODEC",
      "InkEnvelope serialization is unsupported.",
      "/codec/serialization"
    );
  }
}

function validateManifest(
  record: Record<string, unknown>
): StudioInkEnvelopeManifest {
  exactKeys(
    record,
    [
      "attestation",
      "canonicalByteLength",
      "contentDigest",
      "digestAlgorithm",
    ],
    "/manifest"
  );
  if (record.digestAlgorithm !== STUDIO_INK_ENVELOPE_DIGEST_ALGORITHM) {
    fail(
      "UNSUPPORTED_CODEC",
      "InkEnvelope digest algorithm is unsupported.",
      "/manifest/digestAlgorithm"
    );
  }
  if (
    typeof record.canonicalByteLength !== "number" ||
    !Number.isSafeInteger(record.canonicalByteLength) ||
    record.canonicalByteLength < 1 ||
    record.canonicalByteLength > STUDIO_DOCUMENT_ENVELOPE_LIMITS.maxBytes
  ) {
    fail(
      "LIMIT_EXCEEDED",
      "InkEnvelope canonical content byte length is invalid.",
      "/manifest/canonicalByteLength"
    );
  }
  const contentDigest = requiredString(
    record.contentDigest,
    "/manifest/contentDigest"
  );
  if (!SHA256_PATTERN.test(contentDigest)) {
    fail(
      "INVALID_STRUCTURE",
      "InkEnvelope content digest must be lowercase SHA-256.",
      "/manifest/contentDigest"
    );
  }
  return Object.freeze({
    attestation: canonicalAttestation(
      record.attestation,
      "/manifest/attestation"
    ),
    canonicalByteLength: record.canonicalByteLength,
    contentDigest: contentDigest as `sha256:${string}`,
    digestAlgorithm: STUDIO_INK_ENVELOPE_DIGEST_ALGORITHM,
  });
}

async function createManifest(
  envelope: CanonicalStudioDocumentEnvelope,
  attester: StudioInkEnvelopeAttester | undefined
): Promise<StudioInkEnvelopeManifest> {
  const content = serializeCanonicalStudioDocumentEnvelope(envelope);
  const canonicalByteLength = TEXT_ENCODER.encode(content).byteLength;
  const contentDigest =
    await checksumCanonicalStudioDocumentEnvelope(envelope);
  let attestation: StudioInkEnvelopeAttestation | null = null;
  if (attester) {
    validateAttester(attester);
    const signature = await attester.sign(
      studioInkEnvelopeAttestationMessage(
        attester.algorithm,
        attester.keyId,
        canonicalByteLength,
        contentDigest
      ).slice()
    );
    attestation = canonicalAttestation(
      {
        algorithm: attester.algorithm,
        keyId: attester.keyId,
        signature,
      },
      "/manifest/attestation"
    );
  }
  return Object.freeze({
    attestation,
    canonicalByteLength,
    contentDigest,
    digestAlgorithm: STUDIO_INK_ENVELOPE_DIGEST_ALGORITHM,
  });
}

/**
 * Canonicalizes a Studio document and emits deterministic, integrity-addressed InkEnvelope bytes.
 */
export async function encodeStudioInkEnvelope(
  input: unknown,
  options: StudioInkEnvelopeEncodeOptions = {}
): Promise<Uint8Array> {
  const maxWireBytes = resolveMaxWireBytes(options.maxWireBytes);
  const canonical = canonicalizeStudioDocumentEnvelope(input, {
    limits: options.limits,
  });
  if (!canonical.ok) {
    const first = canonical.diagnostics[0];
    fail(
      first.code === "LIMIT_EXCEEDED"
        ? "LIMIT_EXCEEDED"
        : "INVALID_STRUCTURE",
      `InkEnvelope content is invalid: ${first.message}`,
      first.path
    );
  }
  const manifest = await createManifest(
    canonical.envelope,
    options.attester
  );
  const bytes = TEXT_ENCODER.encode(
    serializeWireEnvelope(
      serializeCanonicalStudioDocumentEnvelope(canonical.envelope),
      manifest
    )
  );
  if (bytes.byteLength > maxWireBytes) {
    fail("LIMIT_EXCEEDED", "InkEnvelope exceeds its wire byte budget.");
  }
  return bytes;
}

async function verifyAttestation(
  manifest: StudioInkEnvelopeManifest,
  options: StudioInkEnvelopeDecodeOptions<unknown>
): Promise<void> {
  if (manifest.attestation === null) {
    if (options.requireAttestation) {
      fail(
        "ATTESTATION_REQUIRED",
        "InkEnvelope requires a trusted attestation."
      );
    }
    return;
  }
  if (!options.attestationVerifier) {
    fail(
      "ATTESTATION_UNVERIFIED",
      "InkEnvelope carries an attestation but no verifier was configured."
    );
  }
  let accepted: boolean;
  try {
    accepted = await options.attestationVerifier.verify({
      algorithm: manifest.attestation.algorithm,
      keyId: manifest.attestation.keyId,
      message: studioInkEnvelopeAttestationMessage(
        manifest.attestation.algorithm,
        manifest.attestation.keyId,
        manifest.canonicalByteLength,
        manifest.contentDigest
      ).slice(),
      signature: manifest.attestation.signature,
    });
  } catch {
    accepted = false;
  }
  if (!accepted) {
    fail(
      "ATTESTATION_INVALID",
      "InkEnvelope attestation could not be verified."
    );
  }
}

async function adaptEnvelope<Output>(
  envelope: CanonicalStudioDocumentEnvelope,
  adapter: StudioInkEnvelopePayloadAdapter<Output> | undefined
): Promise<Output | null> {
  if (!adapter) return null;
  validateAdapter(adapter);
  if (
    envelope.format.id !== adapter.formatId ||
    envelope.payload.type !== adapter.payloadType
  ) {
    fail(
      "ADAPTER_MISMATCH",
      "InkEnvelope content does not match the selected payload adapter."
    );
  }
  if (envelope.format.version > adapter.currentVersion) {
    fail(
      "UNKNOWN_FUTURE_PAYLOAD_VERSION",
      "InkEnvelope content was written by a newer payload format."
    );
  }
  if (envelope.format.version < adapter.minimumVersion) {
    fail(
      "UNSUPPORTED_PAST_PAYLOAD_VERSION",
      "InkEnvelope content predates the selected payload adapter."
    );
  }
  try {
    return await adapter.decode(envelope);
  } catch {
    fail(
      "ADAPTER_REJECTED",
      `InkEnvelope payload adapter ${adapter.id} rejected the content.`
    );
  }
}

/**
 * Verifies exact v1 wire conformance, SHA-256 integrity, optional trust attestation, and optional
 * product adaptation. The product adapter is invoked only after all wire checks have succeeded.
 */
export async function decodeStudioInkEnvelope<Output = never>(
  source: unknown,
  options: StudioInkEnvelopeDecodeOptions<Output> = {}
): Promise<DecodedStudioInkEnvelope<Output>> {
  const maxWireBytes = resolveMaxWireBytes(options.maxWireBytes);
  const bytes = ownedWireBytes(source, maxWireBytes);
  let serialized: string;
  try {
    serialized = TEXT_DECODER.decode(bytes);
  } catch {
    fail("INVALID_UTF8", "InkEnvelope is not valid canonical UTF-8.");
  }
  assertJsonAllocationBudget(serialized, options);
  const root = parseRoot(serialized);
  validateCodec(root.codec);
  const manifest = validateManifest(root.manifest);
  const canonical = canonicalizeStudioDocumentEnvelope(root.content, {
    limits: options.limits,
  });
  if (!canonical.ok) {
    const first = canonical.diagnostics[0];
    fail(
      first.code === "LIMIT_EXCEEDED"
        ? "LIMIT_EXCEEDED"
        : "INVALID_STRUCTURE",
      `InkEnvelope content is invalid: ${first.message}`,
      first.path
    );
  }
  const content = serializeCanonicalStudioDocumentEnvelope(canonical.envelope);
  const actualByteLength = TEXT_ENCODER.encode(content).byteLength;
  if (actualByteLength !== manifest.canonicalByteLength) {
    fail(
      "INTEGRITY_MISMATCH",
      "InkEnvelope canonical content byte length does not match its manifest."
    );
  }
  const actualDigest =
    await checksumCanonicalStudioDocumentEnvelope(canonical.envelope);
  if (actualDigest !== manifest.contentDigest) {
    fail(
      "INTEGRITY_MISMATCH",
      "InkEnvelope content digest does not match its manifest."
    );
  }
  if (serializeWireEnvelope(content, manifest) !== serialized) {
    fail(
      "NON_CANONICAL_SERIALIZATION",
      "InkEnvelope bytes are not the exact canonical v1 representation."
    );
  }
  await verifyAttestation(
    manifest,
    options as StudioInkEnvelopeDecodeOptions<unknown>
  );
  const adapted = await adaptEnvelope(canonical.envelope, options.adapter);
  return Object.freeze({
    codec: Object.freeze({
      id: STUDIO_INK_ENVELOPE_CODEC_ID,
      serialization: STUDIO_INK_ENVELOPE_SERIALIZATION,
      version: STUDIO_INK_ENVELOPE_CODEC_VERSION,
    }),
    manifest,
    envelope: canonical.envelope,
    adapted,
  });
}

/** Conformance-only alias that never invokes a product adapter. */
export async function assertStudioInkEnvelopeConformance(
  source: unknown,
  options: Omit<StudioInkEnvelopeDecodeOptions, "adapter"> = {}
): Promise<DecodedStudioInkEnvelope> {
  return decodeStudioInkEnvelope(source, options);
}
