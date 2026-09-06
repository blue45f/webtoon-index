// @ts-expect-error -- jsdom is a test-only runtime fixture and does not bundle TypeScript types.
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  executeStudioCodecProvider,
  parseStudioCodecProviderManifest,
  type StudioCodecExecutionRequest,
  type StudioCodecProvider,
} from "./studio-codec-provider-contract";
import {
  STUDIO_FIRST_PARTY_INK_CODEC_CLAIM_BOUNDARY,
  STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
  STUDIO_FIRST_PARTY_INK_CODEC_VERSION,
  STUDIO_FIRST_PARTY_INK_ENVELOPE_CODEC_PROFILE,
  STUDIO_FIRST_PARTY_INKML_CODEC_PROFILE,
  STUDIO_FIRST_PARTY_INKML_CODEC_PROVIDER,
  StudioFirstPartyInkCodecError,
  decodeStudioInkEnvelopeDocumentTransport,
  decodeStudioInkMlTraceTransport,
  encodeStudioInkEnvelopeDocumentTransport,
  encodeStudioInkMlTraceTransport,
} from "./studio-first-party-ink-codec-provider";
import {
  STUDIO_INKML_PROFILE,
  type StudioInkMlDocument,
} from "./studio-inkml-codec";
import { sha256HexPortable } from "./studio-sha256";

const originalDomParser = globalThis.DOMParser;
const CREATED_AT = "2026-07-30T00:00:00.000Z";

beforeEach(() => {
  const window = new JSDOM("").window;
  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    value: window.DOMParser,
  });
});

afterEach(() => {
  if (originalDomParser) {
    Object.defineProperty(globalThis, "DOMParser", {
      configurable: true,
      value: originalDomParser,
    });
  } else {
    Reflect.deleteProperty(globalThis, "DOMParser");
  }
});

function documentInput(title = "First-party ink provider") {
  return {
    format: {
      id: "toonspectrum.ink-document",
      version: 1,
    },
    document: {
      id: "ink:provider-test",
      revision: 7,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
    payload: {
      type: "ink-document",
      data: {
        title,
        strokes: [{ id: "stroke-1", brush: "g-pen" }],
      },
    },
    extensions: {
      "toonspectrum.engine": {
        renderer: "hybrid-vnext",
      },
    },
  };
}

const TRACE_DOCUMENT: StudioInkMlDocument = Object.freeze({
  profile: STUDIO_INKML_PROFILE,
  traces: Object.freeze([
    Object.freeze({
      id: "trace-1",
      points: Object.freeze([1.25, 2.5, 20, 30]),
      pressures: Object.freeze([0.25, 0.8]),
      tiltXs: Object.freeze([12, 34]),
      tiltYs: Object.freeze([-21, -43]),
      twists: Object.freeze([45, 270]),
      speeds: Object.freeze([0, 2.75]),
      tangentialPressures: Object.freeze([-0.2, 0.6]),
    }),
  ]),
  ignoredChannels: Object.freeze([]),
});

function provider(format: "toonink" | "inkml"): StudioCodecProvider {
  const selected = STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS.find(
    (candidate) => candidate.manifest.format === format,
  );
  if (!selected) throw new Error(`Missing ${format} provider.`);
  return selected;
}

function request(
  format: "toonink" | "inkml",
  direction: "encode" | "decode",
  overrides: Partial<StudioCodecExecutionRequest> = {},
): StudioCodecExecutionRequest {
  const selected = provider(format);
  return {
    schemaVersion: 1,
    direction,
    format,
    profile: selected.manifest.profile,
    version: STUDIO_FIRST_PARTY_INK_CODEC_VERSION,
    mimeType: selected.manifest.mimeTypes[0]!,
    extension: selected.manifest.extensions[0]!,
    allowedModes: ["public-clean-room"],
    requireDeterministic: true,
    maxInputBytes: selected.manifest.maxInputBytes,
    maxOutputBytes: selected.manifest.maxOutputBytes,
    ...overrides,
  };
}

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

describe("first-party ink provider manifests", () => {
  it("publishes explicit deterministic commercial-use grants without external claims", () => {
    expect(STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS).toHaveLength(2);
    for (const candidate of STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS) {
      expect(parseStudioCodecProviderManifest(candidate.manifest)).toEqual(
        candidate.manifest,
      );
      expect(candidate.manifest.mode).toBe("public-clean-room");
      expect(candidate.manifest.deterministic).toBe(true);
      expect(candidate.manifest.licenseGrant).toMatchObject({
        scope: [
          "public-clean-room",
          "encode",
          "decode",
          "commercial-use",
        ],
        expiresAt: null,
      });
      expect(candidate.manifest.officialClaimPolicy).toEqual({
        requiresVerifiedExternalAttestation: true,
        maySelfAssertCertification: false,
        maySelfAssertTrademark: false,
      });
    }
    expect(provider("toonink").manifest.profile).toBe(
      STUDIO_FIRST_PARTY_INK_ENVELOPE_CODEC_PROFILE,
    );
    expect(provider("inkml").manifest.profile).toBe(
      STUDIO_FIRST_PARTY_INKML_CODEC_PROFILE,
    );
    expect(STUDIO_FIRST_PARTY_INK_CODEC_CLAIM_BOUNDARY).toEqual({
      implementationOwner: "ToonSpectrum",
      productConformanceCertificateBindable: true,
      thirdPartyCodecCertification: false,
      vendorTrademarkAuthorization: false,
      commercialSdkWireCompatibility: false,
      wacomWillCompatibility: false,
      wacomUimCompatibility: false,
    });
  });
});

describe("first-party InkEnvelope provider", () => {
  it("round-trips exact canonical document bytes with independently recomputed receipts", async () => {
    const transport = encodeStudioInkEnvelopeDocumentTransport(documentInput());
    const encoded = await executeStudioCodecProvider(
      request("toonink", "encode"),
      transport,
      STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
    );
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(encoded.receipt.input).toEqual({
      byteLength: transport.byteLength,
      sha256: digest(transport),
    });
    expect(encoded.receipt.output).toEqual({
      byteLength: encoded.bytes.byteLength,
      sha256: digest(encoded.bytes),
    });
    expect(encoded.receipt.officialClaims).toEqual({
      externalAttestationAccepted: false,
      officialCodec: false,
      certified: false,
      trademarkAuthorized: false,
    });

    const decoded = await executeStudioCodecProvider(
      request("toonink", "decode"),
      encoded.bytes,
      STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.bytes).toEqual(transport);
    expect(
      decodeStudioInkEnvelopeDocumentTransport(decoded.bytes).payload.data,
    ).toMatchObject({
      title: "First-party ink provider",
      strokes: [{ brush: "g-pen" }],
    });
  });

  it("is deterministic for semantically reordered document input", async () => {
    const firstTransport =
      encodeStudioInkEnvelopeDocumentTransport(documentInput());
    const source = documentInput();
    const reorderedTransport = encodeStudioInkEnvelopeDocumentTransport({
      extensions: source.extensions,
      payload: source.payload,
      document: source.document,
      format: source.format,
    });
    expect(reorderedTransport).toEqual(firstTransport);

    const first = await executeStudioCodecProvider(
      request("toonink", "encode"),
      firstTransport,
      STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
    );
    const second = await executeStudioCodecProvider(
      request("toonink", "encode"),
      reorderedTransport,
      STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.bytes).toEqual(second.bytes);
    expect(first.receipt.output.sha256).toBe(second.receipt.output.sha256);
  });

  it("rejects non-canonical encode transports and tampered InkEnvelope bytes", async () => {
    const canonical = encodeStudioInkEnvelopeDocumentTransport(documentInput());
    const nonCanonical = new TextEncoder().encode(
      new TextDecoder().decode(canonical).replace(
        "\"document\":",
        "\"document\" : ",
      ),
    );
    const invalidEncode = await executeStudioCodecProvider(
      request("toonink", "encode"),
      nonCanonical,
      STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
    );
    expect(invalidEncode).toMatchObject({
      ok: false,
      code: "provider-runtime-error",
      providerId: "toonspectrum.ink-envelope.v1",
    });

    const encoded = await executeStudioCodecProvider(
      request("toonink", "encode"),
      canonical,
      STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
    );
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const text = new TextDecoder().decode(encoded.bytes);
    const tampered = new TextEncoder().encode(
      text.replace(
        "First-party ink provider",
        "Tampered ink provider value",
      ),
    );
    const invalidDecode = await executeStudioCodecProvider(
      request("toonink", "decode"),
      tampered,
      STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
    );
    expect(invalidDecode).toMatchObject({
      ok: false,
      code: "provider-runtime-error",
      providerId: "toonspectrum.ink-envelope.v1",
    });
  });
});

describe("first-party bounded InkML provider", () => {
  it("round-trips canonical trace transport and exact SHA receipts", async () => {
    const transport = encodeStudioInkMlTraceTransport(TRACE_DOCUMENT);
    const encoded = await executeStudioCodecProvider(
      request("inkml", "encode"),
      transport,
      STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
    );
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(new TextDecoder().decode(encoded.bytes)).toContain(
      STUDIO_INKML_PROFILE,
    );
    expect(encoded.receipt.input.sha256).toBe(digest(transport));
    expect(encoded.receipt.output.sha256).toBe(digest(encoded.bytes));
    expect(encoded.receipt.officialClaims).toEqual({
      externalAttestationAccepted: false,
      officialCodec: false,
      certified: false,
      trademarkAuthorized: false,
    });

    const decoded = await executeStudioCodecProvider(
      request("inkml", "decode"),
      encoded.bytes,
      STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.bytes).toEqual(transport);
    expect(decodeStudioInkMlTraceTransport(decoded.bytes)).toEqual(
      TRACE_DOCUMENT,
    );
  });

  it("normalizes a bounded basic public InkML trace without asserting full processor conformance", async () => {
    const basic = new TextEncoder().encode(
      "<?xml version=\"1.1\"?><ink xmlns=\"http://www.w3.org/2003/InkML\"><trace xml:id=\"basic\">1 2,3.5 4.5</trace></ink>",
    );
    const decoded = await executeStudioCodecProvider(
      request("inkml", "decode"),
      basic,
      STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decodeStudioInkMlTraceTransport(decoded.bytes)).toMatchObject({
      profile: "inkml-basic",
      traces: [{
        id: "basic",
        points: [1, 2, 3.5, 4.5],
        pressures: [0.5, 0.5],
      }],
      ignoredChannels: [],
    });
  });

  it("fails closed for non-canonical trace transport and unsafe or tampered XML", async () => {
    const canonical = encodeStudioInkMlTraceTransport(TRACE_DOCUMENT);
    const nonCanonical = new TextEncoder().encode(
      `${new TextDecoder().decode(canonical)} `,
    );
    const invalidEncode = await executeStudioCodecProvider(
      request("inkml", "encode"),
      nonCanonical,
      STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
    );
    expect(invalidEncode).toMatchObject({
      ok: false,
      code: "provider-runtime-error",
      providerId: "toonspectrum.public-inkml-subset.v1",
    });

    const unsafe = new TextEncoder().encode(
      "<!DOCTYPE ink [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]><ink xmlns=\"http://www.w3.org/2003/InkML\"><trace>1 2</trace></ink>",
    );
    const invalidDecode = await executeStudioCodecProvider(
      request("inkml", "decode"),
      unsafe,
      STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
    );
    expect(invalidDecode).toMatchObject({
      ok: false,
      code: "provider-runtime-error",
      providerId: "toonspectrum.public-inkml-subset.v1",
    });
  });

  it("requires explicit resolution before re-encoding ignored source channels", async () => {
    const withIgnoredChannel = encodeStudioInkMlTraceTransport({
      ...TRACE_DOCUMENT,
      profile: "inkml-basic",
      ignoredChannels: ["LIGHT"],
    });
    const result = await executeStudioCodecProvider(
      request("inkml", "encode"),
      withIgnoredChannel,
      [STUDIO_FIRST_PARTY_INKML_CODEC_PROVIDER],
    );
    expect(result).toMatchObject({
      ok: false,
      code: "provider-runtime-error",
      stage: "execution",
      providerId: "toonspectrum.public-inkml-subset.v1",
    });
  });

  it("uses locale-independent code-unit ordering for ignored channel names", () => {
    expect(() =>
      encodeStudioInkMlTraceTransport({
        ...TRACE_DOCUMENT,
        profile: "inkml-basic",
        ignoredChannels: ["Z", "a"],
      })
    ).not.toThrow();
    expect(() =>
      encodeStudioInkMlTraceTransport({
        ...TRACE_DOCUMENT,
        profile: "inkml-basic",
        ignoredChannels: ["a", "Z"],
      })
    ).toThrow();
  });

  it("enforces caller output budgets after provider execution", async () => {
    const transport = encodeStudioInkMlTraceTransport(TRACE_DOCUMENT);
    const result = await executeStudioCodecProvider(
      request("inkml", "encode", { maxOutputBytes: 1 }),
      transport,
      STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
    );
    expect(result).toMatchObject({
      ok: false,
      code: "output-budget-exceeded",
      stage: "output",
      providerId: "toonspectrum.public-inkml-subset.v1",
    });
  });
});

describe("first-party ink canonical transports", () => {
  it("rejects BOM, malformed UTF-8, sparse arrays and non-canonical numeric zero", () => {
    const canonicalDocument =
      encodeStudioInkEnvelopeDocumentTransport(documentInput());
    const bomDocument = new Uint8Array(canonicalDocument.byteLength + 3);
    bomDocument.set([0xef, 0xbb, 0xbf]);
    bomDocument.set(canonicalDocument, 3);
    expect(() =>
      decodeStudioInkEnvelopeDocumentTransport(bomDocument)
    ).toThrow(
      expect.objectContaining<Partial<StudioFirstPartyInkCodecError>>({
        code: "NON_CANONICAL_TRANSPORT",
      }),
    );
    expect(() =>
      decodeStudioInkMlTraceTransport(Uint8Array.of(0xc3, 0x28))
    ).toThrow(
      expect.objectContaining<Partial<StudioFirstPartyInkCodecError>>({
        code: "INVALID_UTF8",
      }),
    );

    const sparsePressures = new Array<number>(2);
    sparsePressures[0] = 0.25;
    expect(() =>
      encodeStudioInkMlTraceTransport({
        ...TRACE_DOCUMENT,
        traces: [{
          ...TRACE_DOCUMENT.traces[0]!,
          pressures: sparsePressures,
        }],
      })
    ).toThrow(
      expect.objectContaining<Partial<StudioFirstPartyInkCodecError>>({
        code: "INVALID_INKML_TRANSPORT",
      }),
    );

    const negativeZero = new TextEncoder().encode(
      new TextDecoder()
        .decode(encodeStudioInkMlTraceTransport(TRACE_DOCUMENT))
        .replace("\"speeds\":[0,2.75]", "\"speeds\":[-0,2.75]"),
    );
    expect(() => decodeStudioInkMlTraceTransport(negativeZero)).toThrow(
      expect.objectContaining<Partial<StudioFirstPartyInkCodecError>>({
        code: "NON_CANONICAL_TRANSPORT",
      }),
    );
  });
});
