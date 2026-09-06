import { describe, expect, it } from "vitest";

import {
  executeStudioCodecProvider,
  parseStudioCodecProviderManifest,
} from "./studio-codec-provider-contract";
import {
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CLAIM_BOUNDARY,
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER,
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_VERSION,
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_FORMAT,
  StudioFirstPartyWillV1DocumentCodecError,
  decodeStudioWillV1DocumentTransport,
  encodeStudioWillV1DocumentTransport,
} from "./studio-first-party-will-v1-document-codec-provider";
import {
  STUDIO_WILL_V1_OPC_EXTENSION,
  STUDIO_WILL_V1_OPC_MEDIA_TYPE,
  STUDIO_WILL_V1_OPC_PROFILE,
  importStudioWillV1Opc,
} from "./studio-will-v1-opc-interchange";

const DOCUMENT = {
  width: 328,
  height: 439,
  title: "Annex B 검증",
  createdAt: "2026-07-30T12:34:56Z",
  application: "ToonSpectrum Studio",
  applicationVersion: "1.0.0",
  paths: [
    {
      points: [
        { x: 1.25, y: 2.5 },
        { x: 10.5, y: 20.25 },
        { x: 30.75, y: 40.5 },
        { x: 50, y: 60 },
      ],
      strokeWidths: [2.5, 3, 3.5, 4],
      strokeColor: { r: 12, g: 34, b: 56, a: 255 },
      decimalPrecision: 2,
      startParameter: 0,
      endParameter: 1,
    },
  ],
} as const;

function request(direction: "decode" | "encode") {
  return {
    schemaVersion: 1 as const,
    direction,
    format: STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_FORMAT,
    profile: STUDIO_WILL_V1_OPC_PROFILE,
    version: STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_VERSION,
    mimeType: STUDIO_WILL_V1_OPC_MEDIA_TYPE,
    extension: STUDIO_WILL_V1_OPC_EXTENSION,
    allowedModes: ["public-clean-room"] as const,
    requireDeterministic: true,
    maxInputBytes:
      STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER.manifest.maxInputBytes,
    maxOutputBytes:
      STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER.manifest.maxOutputBytes,
  };
}

describe("first-party WILL v1 Annex B document codec provider", () => {
  it("claims .will only for the bounded document and never claims vendor authority", () => {
    expect(
      parseStudioCodecProviderManifest(
        STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER.manifest,
      ),
    ).toEqual(STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER.manifest);
    expect(
      STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER.manifest,
    ).toMatchObject({
      format: STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_FORMAT,
      profile: STUDIO_WILL_V1_OPC_PROFILE,
      mimeTypes: [STUDIO_WILL_V1_OPC_MEDIA_TYPE],
      extensions: [STUDIO_WILL_V1_OPC_EXTENSION],
      deterministic: true,
    });
    expect(STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CLAIM_BOUNDARY).toEqual({
      implementationOwner: "ToonSpectrum",
      annexAPathStreamImplemented: true,
      annexBOpcSevenPartDocumentImplemented: true,
      boundedSevenPartProfileOnly: true,
      fullWillExtensionUsedForBoundedDocument: true,
      wacomSdkCodeUsed: false,
      thirdPartyCodecCertification: false,
      vendorTrademarkAuthorization: false,
      arbitraryVendorFileInteroperabilityCertified: false,
      will3Compatibility: false,
      uimCompatibility: false,
    });
  });

  it("round-trips canonical transport through deterministic seven-part .will bytes", async () => {
    const transport = await encodeStudioWillV1DocumentTransport(DOCUMENT);
    const encoded = await executeStudioCodecProvider(
      request("encode"),
      transport,
      [STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER],
    );
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    await expect(importStudioWillV1Opc(encoded.bytes)).resolves.toMatchObject({
      width: DOCUMENT.width,
      height: DOCUMENT.height,
      title: DOCUMENT.title,
    });
    expect(encoded.receipt.officialClaims).toEqual({
      externalAttestationAccepted: false,
      officialCodec: false,
      certified: false,
      trademarkAuthorized: false,
    });

    const decoded = await executeStudioCodecProvider(
      request("decode"),
      encoded.bytes,
      [STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER],
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.bytes).toEqual(transport);
    expect(decodeStudioWillV1DocumentTransport(decoded.bytes)).toMatchObject({
      width: DOCUMENT.width,
      height: DOCUMENT.height,
      title: DOCUMENT.title,
    });
  });

  it("rejects noncanonical JSON, unknown keys, BOM, and malformed UTF-8", async () => {
    const canonical = await encodeStudioWillV1DocumentTransport(DOCUMENT);
    const text = new TextDecoder().decode(canonical);
    expect(() =>
      decodeStudioWillV1DocumentTransport(
        new TextEncoder().encode(text.replace("\"document\":", "\"document\" : ")),
      )
    ).toThrowError(StudioFirstPartyWillV1DocumentCodecError);
    expect(() =>
      decodeStudioWillV1DocumentTransport(
        new TextEncoder().encode(text.replace(
          "\"schemaVersion\":1",
          "\"schemaVersion\":1,\"unknown\":true",
        )),
      )
    ).toThrowError(StudioFirstPartyWillV1DocumentCodecError);
    expect(() =>
      decodeStudioWillV1DocumentTransport(
        Uint8Array.from([0xef, 0xbb, 0xbf, ...canonical]),
      )
    ).toThrowError(StudioFirstPartyWillV1DocumentCodecError);
    expect(() =>
      decodeStudioWillV1DocumentTransport(Uint8Array.of(0xc3, 0x28))
    ).toThrowError(StudioFirstPartyWillV1DocumentCodecError);
  });
});
