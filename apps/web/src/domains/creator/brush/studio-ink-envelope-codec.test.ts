import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_INK_ENVELOPE_ATTESTATION_DOMAIN,
  StudioInkEnvelopeError,
  assertStudioInkEnvelopeConformance,
  decodeStudioInkEnvelope,
  encodeStudioInkEnvelope,
  studioInkEnvelopeAttestationMessage,
  type StudioInkEnvelopePayloadAdapter,
} from "./studio-ink-envelope-codec";

const CREATED_AT = "2026-07-30T00:00:00.000Z";

function inkEnvelopeInput(
  version = 1,
  title = "Ink document",
  payloadData: unknown = {
    brushContract: {
      id: "toonspectrum.brush-contract",
      version: 3,
      presetId: "g-pen",
    },
    document: {
      layers: [{ id: "line", opacity: 1 }],
      title,
    },
    inputProvenance: {
      authoritativeSamples: "coalesced-or-dispatched-v1",
      contract: "studio-ink-input-contract",
      predicted: "preview-only-never-persisted-v1",
      version: 1,
    },
  }
) {
  return {
    format: {
      id: "toonspectrum.ink-document",
      version,
    },
    document: {
      id: "ink:01JTEST",
      revision: 4,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
    payload: {
      type: "ink-document",
      data: payloadData,
    },
    extensions: {
      "toonspectrum.engine": {
        renderer: "hybrid-vnext",
      },
    },
  };
}

function expectInkError(
  operation: () => Promise<unknown>,
  code: StudioInkEnvelopeError["code"]
): Promise<void> {
  return operation().then(
    () => {
      throw new Error(`Expected StudioInkEnvelopeError(${code}).`);
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(StudioInkEnvelopeError);
      expect((error as StudioInkEnvelopeError).code).toBe(code);
    }
  );
}

function adapter(
  overrides: Partial<StudioInkEnvelopePayloadAdapter<string>> = {}
): StudioInkEnvelopePayloadAdapter<string> {
  return {
    id: "toonspectrum.ink-document-adapter",
    formatId: "toonspectrum.ink-document",
    payloadType: "ink-document",
    minimumVersion: 1,
    currentVersion: 1,
    decode(envelope) {
      return String(
        (
          envelope.payload.data as {
            document: { title: string };
          }
        ).document.title
      );
    },
    ...overrides,
  };
}

describe("ToonSpectrum InkEnvelope v1 codec", () => {
  it("emits deterministic canonical bytes and round-trips opaque ink contracts", async () => {
    const first = await encodeStudioInkEnvelope(inkEnvelopeInput());
    const reordered = await encodeStudioInkEnvelope({
      extensions: {
        "toonspectrum.engine": { renderer: "hybrid-vnext" },
      },
      payload: inkEnvelopeInput().payload,
      document: inkEnvelopeInput().document,
      format: inkEnvelopeInput().format,
    });

    expect(first).toEqual(reordered);
    const decoded = await decodeStudioInkEnvelope(first, {
      adapter: adapter(),
    });
    expect(decoded.adapted).toBe("Ink document");
    expect(decoded.envelope.payload.data).toMatchObject({
      brushContract: { presetId: "g-pen" },
      inputProvenance: {
        predicted: "preview-only-never-persisted-v1",
      },
    });
    expect(decoded.manifest.contentDigest).toMatch(
      /^sha256:[0-9a-f]{64}$/u
    );
    expect(decoded.manifest.canonicalByteLength).toBeGreaterThan(0);
    expect(Object.isFrozen(decoded.envelope)).toBe(true);
  });

  it("detects canonical content and manifest tampering before invoking adapters", async () => {
    const encoded = await encodeStudioInkEnvelope(
      inkEnvelopeInput(1, "Alpha document")
    );
    const canonical = new TextDecoder().decode(encoded);
    const decodeAdapter = adapter({ decode: vi.fn(() => "never") });

    const contentTamper = new TextEncoder().encode(
      canonical.replace("Alpha document", "Omega document")
    );
    await expectInkError(
      () =>
        decodeStudioInkEnvelope(contentTamper, {
          adapter: decodeAdapter,
        }),
      "INTEGRITY_MISMATCH"
    );

    const digestTamper = new TextEncoder().encode(
      canonical.replace(/sha256:([0-9a-f])/u, (_match, first: string) =>
        `sha256:${first === "a" ? "b" : "a"}`
      )
    );
    await expectInkError(
      () =>
        decodeStudioInkEnvelope(digestTamper, {
          adapter: decodeAdapter,
        }),
      "INTEGRITY_MISMATCH"
    );
    expect(decodeAdapter.decode).not.toHaveBeenCalled();
  });

  it("rejects unknown future wire and payload versions", async () => {
    const encoded = await encodeStudioInkEnvelope(inkEnvelopeInput());
    const canonical = new TextDecoder().decode(encoded);
    const futureWire = new TextEncoder().encode(
      canonical.replace(
        '"serialization":"canonical-json-utf8","version":1',
        '"serialization":"canonical-json-utf8","version":2'
      )
    );
    await expectInkError(
      () => decodeStudioInkEnvelope(futureWire),
      "UNKNOWN_FUTURE_VERSION"
    );

    const futurePayload = await encodeStudioInkEnvelope(inkEnvelopeInput(2));
    await expectInkError(
      () =>
        decodeStudioInkEnvelope(futurePayload, {
          adapter: adapter(),
        }),
      "UNKNOWN_FUTURE_PAYLOAD_VERSION"
    );
  });

  it("requires exact canonical serialization and valid UTF-8", async () => {
    const encoded = await encodeStudioInkEnvelope(inkEnvelopeInput());
    const canonical = new TextDecoder().decode(encoded);
    const spaced = new TextEncoder().encode(
      canonical.replace(',"content":', ', "content":')
    );
    await expectInkError(
      () => decodeStudioInkEnvelope(spaced),
      "NON_CANONICAL_SERIALIZATION"
    );
    await expectInkError(
      () => decodeStudioInkEnvelope(Uint8Array.of(0xc3, 0x28)),
      "INVALID_UTF8"
    );
  });

  it("rejects Symbol.toStringTag buffer impostors before allocating or parsing", async () => {
    const fakeArrayBuffer = {
      [Symbol.toStringTag]: "ArrayBuffer",
      length: 64,
      0: 0x7b,
    };
    const fakeUint8Array = {
      [Symbol.toStringTag]: "Uint8Array",
      buffer: new ArrayBuffer(8),
      byteLength: 8,
      byteOffset: 0,
    };

    await expectInkError(
      () => decodeStudioInkEnvelope(fakeArrayBuffer),
      "INVALID_SOURCE"
    );
    await expectInkError(
      () => decodeStudioInkEnvelope(fakeUint8Array),
      "INVALID_SOURCE"
    );
  });

  it("enforces wire, depth, and node budgets", async () => {
    const encoded = await encodeStudioInkEnvelope(
      inkEnvelopeInput(
        1,
        "deep",
        { one: { two: { three: { four: { five: true } } } } }
      )
    );
    await expectInkError(
      () =>
        decodeStudioInkEnvelope(encoded, {
          maxWireBytes: encoded.byteLength - 1,
        }),
      "LIMIT_EXCEEDED"
    );
    await expectInkError(
      () =>
        decodeStudioInkEnvelope(encoded, {
          limits: { maxDepth: 5 },
        }),
      "LIMIT_EXCEEDED"
    );
    await expectInkError(
      () =>
        decodeStudioInkEnvelope(encoded, {
          limits: { maxNodes: 10 },
        }),
      "LIMIT_EXCEEDED"
    );
  });

  it("preflights allocation-amplifying arrays before JSON.parse", async () => {
    const oversizedArraySource = new TextEncoder().encode(
      `{"codec":{},"content":[${new Array(200_001).fill("0").join(",")}],"manifest":{}}`
    );
    await expectInkError(
      () => decodeStudioInkEnvelope(oversizedArraySource),
      "LIMIT_EXCEEDED"
    );
  });

  it("applies caller content budgets only to content, not codec wrapper fields", async () => {
    const encoded = await encodeStudioInkEnvelope(
      {
        ...inkEnvelopeInput(1, "tiny", { text: "\n".repeat(70) }),
        extensions: {},
      },
      {
        limits: {
          maxStringBytes: 71,
          maxKeyBytes: 16,
        },
      }
    );

    await expect(
      decodeStudioInkEnvelope(encoded, {
        limits: {
          maxStringBytes: 71,
          maxKeyBytes: 16,
        },
      })
    ).resolves.toMatchObject({
      envelope: {
        payload: {
          data: { text: "\n".repeat(70) },
        },
      },
    });
  });

  it("checks adapter identity and invokes it only after conformance succeeds", async () => {
    const encoded = await encodeStudioInkEnvelope(inkEnvelopeInput());
    await expectInkError(
      () =>
        decodeStudioInkEnvelope(encoded, {
          adapter: adapter({ formatId: "toonspectrum.other-document" }),
        }),
      "ADAPTER_MISMATCH"
    );
    await expectInkError(
      () =>
        decodeStudioInkEnvelope(encoded, {
          adapter: adapter({
            decode() {
              throw new Error("product validation failed");
            },
          }),
        }),
      "ADAPTER_REJECTED"
    );
  });

  it("supports pluggable domain-separated attestations without vendor coupling", async () => {
    const signature = "dG9vbnNwZWN0cnVtLXNpZ25hdHVyZQ";
    const sign = vi.fn((_message: Uint8Array) => signature);
    const encoded = await encodeStudioInkEnvelope(inkEnvelopeInput(), {
      attester: {
        algorithm: "ed25519",
        keyId: "studio.release-key:2026-07",
        sign,
      },
    });
    expect(sign).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(sign.mock.calls[0]![0])).toContain(
      STUDIO_INK_ENVELOPE_ATTESTATION_DOMAIN
    );

    await expectInkError(
      () => decodeStudioInkEnvelope(encoded),
      "ATTESTATION_UNVERIFIED"
    );
    const verify = vi.fn(
      ({
        algorithm,
        keyId,
        message,
        signature: received,
      }: {
        algorithm: string;
        keyId: string;
        message: Uint8Array;
        signature: string;
      }) =>
        algorithm === "ed25519" &&
        keyId === "studio.release-key:2026-07" &&
        received === signature &&
        new TextDecoder().decode(message).startsWith(
          `${STUDIO_INK_ENVELOPE_ATTESTATION_DOMAIN}\n`
        )
    );
    const decoded = await decodeStudioInkEnvelope(encoded, {
      requireAttestation: true,
      attestationVerifier: { verify },
    });
    expect(decoded.manifest.attestation).toMatchObject({
      algorithm: "ed25519",
      keyId: "studio.release-key:2026-07",
      signature,
    });
    expect(verify).toHaveBeenCalledOnce();
  });

  it("fails closed when attestation is required or rejected", async () => {
    const unsigned = await encodeStudioInkEnvelope(inkEnvelopeInput());
    await expectInkError(
      () =>
        assertStudioInkEnvelopeConformance(unsigned, {
          requireAttestation: true,
        }),
      "ATTESTATION_REQUIRED"
    );

    const signed = await encodeStudioInkEnvelope(inkEnvelopeInput(), {
      attester: {
        algorithm: "ed25519",
        keyId: "studio.release-key:2026-07",
        sign: () => "c2lnbmF0dXJl",
      },
    });
    await expectInkError(
      () =>
        decodeStudioInkEnvelope(signed, {
          attestationVerifier: {
            verify: () => false,
          },
        }),
      "ATTESTATION_INVALID"
    );
  });

  it("exposes a stable manifest attestation message contract", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(
      new TextDecoder().decode(
        studioInkEnvelopeAttestationMessage(
          "ed25519",
          "studio.release-key:2026-07",
          123,
          digest
        )
      )
    ).toBe(
      `${STUDIO_INK_ENVELOPE_ATTESTATION_DOMAIN}\ned25519\nstudio.release-key:2026-07\n123\n${digest}`
    );
  });
});
