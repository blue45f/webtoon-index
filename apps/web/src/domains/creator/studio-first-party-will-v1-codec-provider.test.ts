import { describe, expect, it } from "vitest";

import {
  executeStudioCodecProvider,
  parseStudioCodecProviderManifest,
} from "./studio-codec-provider-contract";
import {
  STUDIO_FIRST_PARTY_WILL_V1_CLAIM_BOUNDARY,
  STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER,
  STUDIO_FIRST_PARTY_WILL_V1_CODEC_VERSION,
  STUDIO_FIRST_PARTY_WILL_V1_EXTENSION,
  STUDIO_FIRST_PARTY_WILL_V1_FORMAT,
  StudioFirstPartyWillV1CodecError,
  decodeStudioWillV1PathTransport,
  encodeStudioWillV1PathTransport,
} from "./studio-first-party-will-v1-codec-provider";
import {
  STUDIO_WILL_V1_PATH_MEDIA_TYPE,
  STUDIO_WILL_V1_PROFILE,
  decodeStudioWillV1PathList,
} from "./studio-will-v1-interchange";

const PATHS = [
  {
    points: [
      { x: 1, y: 2 },
      { x: 1.25, y: 2.5 },
      { x: 0.75, y: 2 },
      { x: 0.75, y: 2 },
    ],
    strokeWidths: [1],
    strokeColor: { r: 10, g: 20, b: 30, a: 255 },
    startParameter: 0,
    endParameter: 1,
    decimalPrecision: 2,
  },
] as const;

function request(direction: "decode" | "encode") {
  return {
    schemaVersion: 1 as const,
    direction,
    format: STUDIO_FIRST_PARTY_WILL_V1_FORMAT,
    profile: STUDIO_WILL_V1_PROFILE,
    version: STUDIO_FIRST_PARTY_WILL_V1_CODEC_VERSION,
    mimeType: STUDIO_WILL_V1_PATH_MEDIA_TYPE,
    extension: STUDIO_FIRST_PARTY_WILL_V1_EXTENSION,
    allowedModes: ["public-clean-room"] as const,
    requireDeterministic: true,
    maxInputBytes:
      STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER.manifest.maxInputBytes,
    maxOutputBytes:
      STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER.manifest.maxOutputBytes,
  };
}

describe("first-party WILL v1 Annex A codec provider", () => {
  it("publishes a deterministic commercial-use provider without external claims", () => {
    expect(
      parseStudioCodecProviderManifest(
        STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER.manifest,
      ),
    ).toEqual(STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER.manifest);
    expect(STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER.manifest).toMatchObject({
      mode: "public-clean-room",
      deterministic: true,
      licenseGrant: {
        scope: [
          "public-clean-room",
          "encode",
          "decode",
          "commercial-use",
        ],
        expiresAt: null,
      },
    });
    expect(STUDIO_FIRST_PARTY_WILL_V1_CLAIM_BOUNDARY).toMatchObject({
      annexAPathStreamImplemented: true,
      annexBOpcZipDocumentImplemented: false,
      fullWillDocumentExtensionClaimed: false,
      wacomSdkCodeUsed: false,
      thirdPartyCodecCertification: false,
      vendorTrademarkAuthorization: false,
      will3Compatibility: false,
      uimCompatibility: false,
    });
  });

  it("round-trips the canonical transport through exact Annex A bytes", async () => {
    const transport = encodeStudioWillV1PathTransport(PATHS);
    const encoded = await executeStudioCodecProvider(
      request("encode"),
      transport,
      [STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER],
    );
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(decodeStudioWillV1PathList(encoded.bytes)).toHaveLength(1);
    expect(encoded.receipt.officialClaims).toEqual({
      externalAttestationAccepted: false,
      officialCodec: false,
      certified: false,
      trademarkAuthorized: false,
    });

    const decoded = await executeStudioCodecProvider(
      request("decode"),
      encoded.bytes,
      [STUDIO_FIRST_PARTY_WILL_V1_CODEC_PROVIDER],
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.bytes).toEqual(transport);
    expect(decodeStudioWillV1PathTransport(decoded.bytes)).toEqual(PATHS);
  });

  it("normalizes quantized values before creating canonical transport bytes", () => {
    const transport = encodeStudioWillV1PathTransport([
      {
        ...PATHS[0],
        points: [
          { x: -0.001, y: 0.009 },
          { x: 1.239, y: 2.349 },
          { x: 3.459, y: 4.569 },
          { x: 5.679, y: 6.789 },
        ],
      },
    ]);
    const decoded = decodeStudioWillV1PathTransport(transport);
    expect(decoded[0]?.points[0]).toEqual({ x: 0, y: 0 });
    expect(Object.is(decoded[0]?.points[0]?.x, -0)).toBe(false);
    expect(decoded[0]?.points[1]).toEqual({ x: 1.23, y: 2.34 });
  });

  it("rejects noncanonical JSON, unknown keys, BOM, and malformed UTF-8", () => {
    const canonical = encodeStudioWillV1PathTransport(PATHS);
    const text = new TextDecoder().decode(canonical);
    expect(() =>
      decodeStudioWillV1PathTransport(
        new TextEncoder().encode(text.replace("\"paths\":", "\"paths\" : ")),
      )
    ).toThrowError(StudioFirstPartyWillV1CodecError);
    expect(() =>
      decodeStudioWillV1PathTransport(
        new TextEncoder().encode(text.replace(
          "\"schemaVersion\":1",
          "\"schemaVersion\":1,\"unknown\":true",
        )),
      )
    ).toThrowError(StudioFirstPartyWillV1CodecError);
    expect(() =>
      decodeStudioWillV1PathTransport(
        Uint8Array.from([0xef, 0xbb, 0xbf, ...canonical]),
      )
    ).toThrowError(StudioFirstPartyWillV1CodecError);
    expect(() =>
      decodeStudioWillV1PathTransport(Uint8Array.of(0xc3, 0x28))
    ).toThrowError(StudioFirstPartyWillV1CodecError);
  });
});
