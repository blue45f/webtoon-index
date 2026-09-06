/**
 * ToonSpectrum-owned codec providers for the public raster formats implemented by
 * `studio-raster-interchange`.
 *
 * The provider contract is byte-only, so encode requests use a compact canonical RGBA envelope.
 * Decode requests return the same envelope. This keeps width/height/pixel ownership explicit and
 * lets the generic codec boundary hash, budget, negotiate, and attest the exact bytes without
 * passing browser-only ImageData objects across a Worker or provider boundary.
 */

import {
  decodeStudioRasterInterchange,
  encodeStudioRasterInterchange,
  STUDIO_RASTER_INTERCHANGE_LIMITS,
  type StudioRasterInterchangeFormat,
  type StudioRgbaBitmap,
} from "./render/studio-raster-interchange";
import {
  STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
  type StudioCodecProvider,
  type StudioCodecProviderExecution,
  type StudioCodecLicenseScope,
  type StudioCodecProviderManifest,
  type StudioCodecProviderRawResult,
} from "./studio-codec-provider-contract";
import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE =
  "rgba8-interchange-v2" as const;
export const STUDIO_FIRST_PARTY_RASTER_CODEC_VERSION = "1.0.0" as const;

const RGBA_ENVELOPE_MAGIC = Uint8Array.of(
  0x54, 0x53, 0x52, 0x47, 0x42, 0x41, 0x32, 0x00,
);
const RGBA_ENVELOPE_HEADER_BYTES = 24;
const RGBA_CHANNEL_BYTES = 4;
const ALPHA_LOSS_POLICY_OFFSET = 20;
const RESERVED_OFFSET = 21;
const ALPHA_LOSS_POLICY_REJECT = 0;
const ALPHA_LOSS_POLICY_FLATTEN_ON_WHITE = 1;
const MAX_RGBA_ENVELOPE_BYTES =
  STUDIO_RASTER_INTERCHANGE_LIMITS.maxOutputBytes
  + RGBA_ENVELOPE_HEADER_BYTES;
const FIRST_PARTY_CODEC_LICENSE_SCOPE = Object.freeze([
  "public-clean-room",
  "encode",
  "decode",
  "commercial-use",
] as const satisfies readonly StudioCodecLicenseScope[]);

export const STUDIO_FIRST_PARTY_RASTER_CODEC_LIMITS = Object.freeze({
  maxInputBytes: MAX_RGBA_ENVELOPE_BYTES,
  maxOutputBytes: MAX_RGBA_ENVELOPE_BYTES,
  rgbaEnvelopeHeaderBytes: RGBA_ENVELOPE_HEADER_BYTES,
} as const);

interface StudioFirstPartyRasterCodecDescriptor {
  readonly format: StudioRasterInterchangeFormat;
  readonly providerId: string;
  readonly mimeType: string;
  readonly extension: `.${StudioRasterInterchangeFormat}`;
}

const DESCRIPTORS = Object.freeze([
  {
    format: "bmp",
    providerId: "toonspectrum.raster.bmp.v1",
    mimeType: "image/bmp",
    extension: ".bmp",
  },
  {
    format: "tga",
    providerId: "toonspectrum.raster.tga.v1",
    mimeType: "image/x-tga",
    extension: ".tga",
  },
  {
    format: "ppm",
    providerId: "toonspectrum.raster.ppm.v1",
    mimeType: "image/x-portable-pixmap",
    extension: ".ppm",
  },
  {
    format: "pam",
    providerId: "toonspectrum.raster.pam.v1",
    mimeType: "image/x-portable-arbitrarymap",
    extension: ".pam",
  },
  {
    format: "qoi",
    providerId: "toonspectrum.raster.qoi.v1",
    mimeType: "image/qoi",
    extension: ".qoi",
  },
  {
    format: "tiff",
    providerId: "toonspectrum.raster.tiff.v1",
    mimeType: "image/tiff",
    extension: ".tiff",
  },
] as const satisfies readonly StudioFirstPartyRasterCodecDescriptor[]);

export const STUDIO_FIRST_PARTY_RASTER_CODEC_FORMATS = Object.freeze(
  DESCRIPTORS.map((descriptor) => descriptor.format),
);

export class StudioFirstPartyRasterCodecError extends Error {
  readonly code:
    | "INVALID_RGBA_ENVELOPE"
    | "RGBA_ENVELOPE_BUDGET_EXCEEDED"
    | "LOSSY_ALPHA_REQUIRES_ACKNOWLEDGEMENT";

  constructor(
    code: StudioFirstPartyRasterCodecError["code"],
    message: string,
  ) {
    super(message);
    this.name = "StudioFirstPartyRasterCodecError";
    this.code = code;
  }
}

export type StudioFirstPartyRasterAlphaLossPolicy =
  | "flatten-on-white"
  | "reject-alpha-loss";

export interface StudioCodecRgbaEnvelopeOptions {
  /**
   * Lossy alpha conversion is rejected by default. Callers must make the flattening choice part
   * of the signed/hashable transport before using an opaque-only codec such as BMP24 or PPM.
   */
  readonly alphaLossPolicy?: StudioFirstPartyRasterAlphaLossPolicy;
}

interface DecodedStudioCodecRgbaEnvelope {
  readonly bitmap: StudioRgbaBitmap;
  readonly alphaLossPolicy: StudioFirstPartyRasterAlphaLossPolicy;
}

function fail(
  code: StudioFirstPartyRasterCodecError["code"],
  message: string,
): never {
  throw new StudioFirstPartyRasterCodecError(code, message);
}

function checkedPixelByteLength(width: number, height: number): number {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || width > STUDIO_RASTER_INTERCHANGE_LIMITS.maxWidth
    || height > STUDIO_RASTER_INTERCHANGE_LIMITS.maxHeight
  ) {
    return fail(
      "INVALID_RGBA_ENVELOPE",
      "RGBA envelope dimensions are outside the codec limits.",
    );
  }
  const pixels = width * height;
  const pixelBytes = pixels * RGBA_CHANNEL_BYTES;
  if (
    !Number.isSafeInteger(pixels)
    || pixels > STUDIO_RASTER_INTERCHANGE_LIMITS.maxPixels
    || !Number.isSafeInteger(pixelBytes)
    || pixelBytes > STUDIO_RASTER_INTERCHANGE_LIMITS.maxOutputBytes
  ) {
    return fail(
      "RGBA_ENVELOPE_BUDGET_EXCEEDED",
      "RGBA envelope pixels exceed the codec budget.",
    );
  }
  return pixelBytes;
}

function hash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

/**
 * Encodes straight-alpha RGBA8 pixels into the byte-level provider transport.
 */
export function encodeStudioCodecRgbaEnvelope(
  bitmap: StudioRgbaBitmap,
  options: StudioCodecRgbaEnvelopeOptions = {},
): Uint8Array {
  const pixelBytes = checkedPixelByteLength(bitmap.width, bitmap.height);
  if (
    !(bitmap.data instanceof Uint8Array)
    && !(bitmap.data instanceof Uint8ClampedArray)
  ) {
    return fail(
      "INVALID_RGBA_ENVELOPE",
      "RGBA envelope pixels must use an 8-bit typed array.",
    );
  }
  if (bitmap.data.byteLength !== pixelBytes) {
    return fail(
      "INVALID_RGBA_ENVELOPE",
      "RGBA envelope pixel length does not match its dimensions.",
    );
  }
  const totalBytes = RGBA_ENVELOPE_HEADER_BYTES + pixelBytes;
  if (totalBytes > MAX_RGBA_ENVELOPE_BYTES) {
    return fail(
      "RGBA_ENVELOPE_BUDGET_EXCEEDED",
      "RGBA envelope exceeds the codec byte budget.",
    );
  }
  const bytes = new Uint8Array(totalBytes);
  bytes.set(RGBA_ENVELOPE_MAGIC, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, bitmap.width, false);
  view.setUint32(12, bitmap.height, false);
  view.setUint32(16, pixelBytes, false);
  bytes[ALPHA_LOSS_POLICY_OFFSET] =
    options.alphaLossPolicy === "flatten-on-white"
      ? ALPHA_LOSS_POLICY_FLATTEN_ON_WHITE
      : ALPHA_LOSS_POLICY_REJECT;
  bytes.set(
    new Uint8Array(
      bitmap.data.buffer,
      bitmap.data.byteOffset,
      bitmap.data.byteLength,
    ),
    RGBA_ENVELOPE_HEADER_BYTES,
  );
  return bytes;
}

/**
 * Strictly decodes the canonical RGBA transport. Trailing data, malformed lengths, and oversized
 * dimensions fail closed before a pixel buffer is copied.
 */
function decodeStudioCodecRgbaEnvelopeTransport(
  source: Uint8Array,
): DecodedStudioCodecRgbaEnvelope {
  if (
    !(source instanceof Uint8Array)
    || source.byteLength < RGBA_ENVELOPE_HEADER_BYTES
    || source.byteLength > MAX_RGBA_ENVELOPE_BYTES
  ) {
    return fail(
      "RGBA_ENVELOPE_BUDGET_EXCEEDED",
      "RGBA envelope length is outside the codec byte budget.",
    );
  }
  if (
    RGBA_ENVELOPE_MAGIC.some(
      (byte, index) => source[index] !== byte,
    )
  ) {
    return fail(
      "INVALID_RGBA_ENVELOPE",
      "RGBA envelope magic or version is invalid.",
    );
  }
  const view = new DataView(
    source.buffer,
    source.byteOffset,
    source.byteLength,
  );
  const width = view.getUint32(8, false);
  const height = view.getUint32(12, false);
  const declaredPixelBytes = view.getUint32(16, false);
  const expectedPixelBytes = checkedPixelByteLength(width, height);
  const alphaLossPolicyByte = source[ALPHA_LOSS_POLICY_OFFSET];
  if (
    declaredPixelBytes !== expectedPixelBytes
    || source.byteLength !== RGBA_ENVELOPE_HEADER_BYTES + expectedPixelBytes
    || (
      alphaLossPolicyByte !== ALPHA_LOSS_POLICY_REJECT
      && alphaLossPolicyByte !== ALPHA_LOSS_POLICY_FLATTEN_ON_WHITE
    )
    || source
      .subarray(RESERVED_OFFSET, RGBA_ENVELOPE_HEADER_BYTES)
      .some((byte) => byte !== 0)
  ) {
    return fail(
      "INVALID_RGBA_ENVELOPE",
      "RGBA envelope has a non-canonical pixel length.",
    );
  }
  return Object.freeze({
    bitmap: Object.freeze({
      width,
      height,
      data: source.slice(RGBA_ENVELOPE_HEADER_BYTES),
    }),
    alphaLossPolicy:
      alphaLossPolicyByte === ALPHA_LOSS_POLICY_FLATTEN_ON_WHITE
        ? "flatten-on-white"
        : "reject-alpha-loss",
  });
}

export function decodeStudioCodecRgbaEnvelope(
  source: Uint8Array,
): StudioRgbaBitmap {
  return decodeStudioCodecRgbaEnvelopeTransport(source).bitmap;
}

function createManifest(
  descriptor: StudioFirstPartyRasterCodecDescriptor,
): StudioCodecProviderManifest {
  return Object.freeze({
    schemaVersion: STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
    providerId: descriptor.providerId,
    mode: "public-clean-room",
    format: descriptor.format,
    profile: STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE,
    version: STUDIO_FIRST_PARTY_RASTER_CODEC_VERSION,
    encode: true,
    decode: true,
    mimeTypes: Object.freeze([descriptor.mimeType]),
    extensions: Object.freeze([descriptor.extension]),
    maxInputBytes: STUDIO_FIRST_PARTY_RASTER_CODEC_LIMITS.maxInputBytes,
    maxOutputBytes: STUDIO_FIRST_PARTY_RASTER_CODEC_LIMITS.maxOutputBytes,
    deterministic: true,
    licenseGrant: Object.freeze({
      id: `toonspectrum.first-party.${descriptor.format}.v1`,
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

function executeRasterCodec(
  descriptor: StudioFirstPartyRasterCodecDescriptor,
  execution: StudioCodecProviderExecution,
): StudioCodecProviderRawResult {
  const { request } = execution;
  let bytes: Uint8Array;
  if (request.direction === "encode") {
    const transport = decodeStudioCodecRgbaEnvelopeTransport(
      execution.inputBytes,
    );
    const encoded = encodeStudioRasterInterchange(
      descriptor.format,
      transport.bitmap,
    );
    if (
      encoded.lossy
      && transport.alphaLossPolicy !== "flatten-on-white"
    ) {
      fail(
        "LOSSY_ALPHA_REQUIRES_ACKNOWLEDGEMENT",
        `${descriptor.format.toUpperCase()} alpha flattening requires explicit transport acknowledgement.`,
      );
    }
    bytes = encoded.bytes;
  } else {
    bytes = encodeStudioCodecRgbaEnvelope(
      decodeStudioRasterInterchange(
        execution.inputBytes,
        descriptor.format,
      ).bitmap,
    );
  }
  return Object.freeze({
    schemaVersion: STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
    providerId: descriptor.providerId,
    direction: request.direction,
    format: request.format,
    profile: request.profile,
    version: request.version,
    mimeType: request.mimeType,
    extension: request.extension,
    inputSha256: execution.inputSha256,
    outputSha256: hash(bytes),
    bytes,
  });
}

function createProvider(
  descriptor: StudioFirstPartyRasterCodecDescriptor,
): StudioCodecProvider {
  const manifest = createManifest(descriptor);
  return Object.freeze({
    manifest,
    execute(execution: StudioCodecProviderExecution) {
      return executeRasterCodec(descriptor, execution);
    },
  });
}

/**
 * Product-owned providers are explicit rather than silently inserted into the generic registry.
 * Callers can therefore choose first-party-only, browser-runtime, licensed, or remote policy.
 */
export const STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS:
  readonly StudioCodecProvider[] = Object.freeze(
    DESCRIPTORS.map(createProvider),
  );
