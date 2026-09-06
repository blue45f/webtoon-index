import { describe, expect, it } from "vitest";

import {
  executeStudioCodecProvider,
  parseStudioCodecProviderManifest,
  type StudioCodecExecutionRequest,
} from "./studio-codec-provider-contract";
import {
  decodeStudioCodecRgbaEnvelope,
  encodeStudioCodecRgbaEnvelope,
  STUDIO_FIRST_PARTY_RASTER_CODEC_FORMATS,
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE,
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
  STUDIO_FIRST_PARTY_RASTER_CODEC_VERSION,
  StudioFirstPartyRasterCodecError,
} from "./studio-first-party-raster-codec-provider";

const MIME_BY_FORMAT = Object.freeze({
  bmp: "image/bmp",
  tga: "image/x-tga",
  ppm: "image/x-portable-pixmap",
  pam: "image/x-portable-arbitrarymap",
  qoi: "image/qoi",
  tiff: "image/tiff",
} as const);

function request(
  format: keyof typeof MIME_BY_FORMAT,
  direction: "encode" | "decode",
): StudioCodecExecutionRequest {
  return {
    schemaVersion: 1,
    direction,
    format,
    profile: STUDIO_FIRST_PARTY_RASTER_CODEC_PROFILE,
    version: STUDIO_FIRST_PARTY_RASTER_CODEC_VERSION,
    mimeType: MIME_BY_FORMAT[format],
    extension: `.${format}`,
    allowedModes: ["public-clean-room"],
    requireDeterministic: true,
    maxInputBytes: 4 * 1024 * 1024,
    maxOutputBytes: 4 * 1024 * 1024,
  };
}

const OPAQUE_BITMAP = Object.freeze({
  width: 2,
  height: 2,
  data: Uint8Array.of(
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 255,
  ),
});
const TRANSLUCENT_BITMAP = Object.freeze({
  width: 1,
  height: 1,
  data: Uint8Array.of(10, 20, 30, 128),
});

describe("first-party raster codec provider registry", () => {
  it("publishes one strict deterministic commercial-use provider per owned codec", () => {
    expect(STUDIO_FIRST_PARTY_RASTER_CODEC_FORMATS).toEqual([
      "bmp",
      "tga",
      "ppm",
      "pam",
      "qoi",
      "tiff",
    ]);
    expect(STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS).toHaveLength(6);
    for (const provider of STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS) {
      expect(parseStudioCodecProviderManifest(provider.manifest)).toEqual(
        provider.manifest,
      );
      expect(provider.manifest.mode).toBe("public-clean-room");
      expect(provider.manifest.deterministic).toBe(true);
      expect(provider.manifest.licenseGrant.scope).toEqual(
        expect.arrayContaining([
          "public-clean-room",
          "encode",
          "decode",
          "commercial-use",
        ]),
      );
      expect(provider.manifest.officialClaimPolicy).toEqual({
        requiresVerifiedExternalAttestation: true,
        maySelfAssertCertification: false,
        maySelfAssertTrademark: false,
      });
    }
  });

  it.each(STUDIO_FIRST_PARTY_RASTER_CODEC_FORMATS)(
    "round-trips opaque RGBA through the %s provider with exact receipts",
    async (format) => {
      const rgba = encodeStudioCodecRgbaEnvelope(OPAQUE_BITMAP);
      const encoded = await executeStudioCodecProvider(
        request(format, "encode"),
        rgba,
        STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
      );
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) return;
      expect(encoded.bytes.byteLength).toBeGreaterThan(0);
      expect(encoded.receipt.providerId).toBe(
        `toonspectrum.raster.${format}.v1`,
      );
      expect(encoded.receipt.officialClaims).toEqual({
        externalAttestationAccepted: false,
        officialCodec: false,
        certified: false,
        trademarkAuthorized: false,
      });

      const decoded = await executeStudioCodecProvider(
        request(format, "decode"),
        encoded.bytes,
        STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
      );
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      const bitmap = decodeStudioCodecRgbaEnvelope(decoded.bytes);
      expect(bitmap.width).toBe(OPAQUE_BITMAP.width);
      expect(bitmap.height).toBe(OPAQUE_BITMAP.height);
      expect(Array.from(bitmap.data)).toEqual(Array.from(OPAQUE_BITMAP.data));
    },
  );

  it("produces deterministic bytes for the same provider input", async () => {
    const input = encodeStudioCodecRgbaEnvelope(OPAQUE_BITMAP);
    const first = await executeStudioCodecProvider(
      request("qoi", "encode"),
      input,
      STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
    );
    const second = await executeStudioCodecProvider(
      request("qoi", "encode"),
      input,
      STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.bytes).toEqual(second.bytes);
    expect(first.receipt.output.sha256).toBe(second.receipt.output.sha256);
  });

  it.each(["bmp", "ppm"] as const)(
    "requires explicit alpha-loss acknowledgement before %s flattening",
    async (format) => {
      const rejected = await executeStudioCodecProvider(
        request(format, "encode"),
        encodeStudioCodecRgbaEnvelope(TRANSLUCENT_BITMAP),
        STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
      );
      expect(rejected).toMatchObject({
        ok: false,
        code: "provider-runtime-error",
        stage: "execution",
        providerId: `toonspectrum.raster.${format}.v1`,
      });

      const acknowledged = await executeStudioCodecProvider(
        request(format, "encode"),
        encodeStudioCodecRgbaEnvelope(TRANSLUCENT_BITMAP, {
          alphaLossPolicy: "flatten-on-white",
        }),
        STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
      );
      expect(acknowledged.ok).toBe(true);
    },
  );
});

describe("first-party RGBA codec envelope", () => {
  it("round-trips an owned byte copy and accepts sliced typed-array views", () => {
    const encoded = encodeStudioCodecRgbaEnvelope(OPAQUE_BITMAP);
    const padded = new Uint8Array(encoded.byteLength + 8);
    padded.set(encoded, 4);
    const decoded = decodeStudioCodecRgbaEnvelope(
      padded.subarray(4, 4 + encoded.byteLength),
    );
    expect(decoded).toEqual(OPAQUE_BITMAP);
    decoded.data[0] = 0;
    expect(OPAQUE_BITMAP.data[0]).toBe(255);
  });

  it.each([
    ["bad magic", (bytes: Uint8Array) => { bytes[0] = 0; }],
    ["trailing byte", (bytes: Uint8Array) => bytes.slice(0, -1)],
    ["non-canonical length", (bytes: Uint8Array) => {
      new DataView(bytes.buffer).setUint32(16, 1, false);
    }],
    ["unknown alpha policy", (bytes: Uint8Array) => {
      bytes[20] = 2;
    }],
    ["non-zero reserved byte", (bytes: Uint8Array) => {
      bytes[21] = 1;
    }],
  ])("fails closed for %s", (_label, mutate) => {
    const source = encodeStudioCodecRgbaEnvelope(OPAQUE_BITMAP);
    const result: unknown = mutate(source);
    const candidate = result instanceof Uint8Array ? result : source;
    expect(() => decodeStudioCodecRgbaEnvelope(candidate)).toThrow(
      StudioFirstPartyRasterCodecError,
    );
  });

  it("surfaces malformed encode transport only as a stable provider runtime failure", async () => {
    const invalid = encodeStudioCodecRgbaEnvelope(OPAQUE_BITMAP);
    invalid[0] = 0;
    const result = await executeStudioCodecProvider(
      request("bmp", "encode"),
      invalid,
      STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
    );
    expect(result).toMatchObject({
      ok: false,
      code: "provider-runtime-error",
      stage: "execution",
      providerId: "toonspectrum.raster.bmp.v1",
    });
  });
});
