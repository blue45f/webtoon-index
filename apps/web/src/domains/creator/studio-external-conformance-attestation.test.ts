import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_CONFORMANCE_ASSURANCE_BOUNDARY,
  STUDIO_EXTERNAL_CONFORMANCE_ATTESTATION_SCHEMA,
  STUDIO_EXTERNAL_CONFORMANCE_ATTESTATION_SCHEMA_VERSION,
  STUDIO_EXTERNAL_CONFORMANCE_DEFAULT_TRUST_ROOTS,
  StudioExternalConformanceAttestationError,
  canonicalStudioExternalConformanceAttestationJson,
  canonicalStudioExternalConformanceSigningBytes,
  createStudioPublicSpecificationSelfValidationReceipt,
  decodeStudioExternalConformanceAttestation,
  digestStudioExternalConformanceEvidence,
  encodeStudioExternalConformanceAttestation,
  parseStudioExternalConformanceAttestation,
  verifyStudioExternalConformanceAttestation,
  verifyStudioExternalConformanceProviderSource,
  type StudioExternalConformanceAttestation,
  type StudioExternalConformanceAttestationPayload,
  type StudioExternalConformanceSignatureAlgorithm,
  type StudioExternalConformanceTrustRoot,
} from "./studio-external-conformance-attestation";

const ENCODER = new TextEncoder();
const P256_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
);
const BIGINT_ZERO = BigInt(0);
const BIGINT_EIGHT = BigInt(8);
const BIGINT_BYTE_MASK = BigInt(255);

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return owned.buffer;
}

function scalar(bytes: Uint8Array): bigint {
  let value = BIGINT_ZERO;
  for (const byte of bytes) value = (value << BIGINT_EIGHT) | BigInt(byte);
  return value;
}

function scalarBytes(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let remainder = value;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remainder & BIGINT_BYTE_MASK);
    remainder >>= BIGINT_EIGHT;
  }
  return bytes;
}

function lowSP256(signature: Uint8Array): Uint8Array {
  const output = signature.slice();
  const s = scalar(output.subarray(32));
  if (s > (P256_ORDER >> BigInt(1))) {
    output.set(scalarBytes(P256_ORDER - s), 32);
  }
  return output;
}

async function p256Keys(): Promise<CryptoKeyPair> {
  const generated = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  );
  if (!("privateKey" in generated)) {
    throw new Error("Expected a P-256 key pair.");
  }
  return generated;
}

async function signPayload(
  payload: StudioExternalConformanceAttestationPayload,
  privateKey: CryptoKey
): Promise<StudioExternalConformanceAttestation> {
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      ownedBuffer(canonicalStudioExternalConformanceSigningBytes(payload))
    )
  );
  return {
    ...payload,
    signatureBytes: base64Url(lowSP256(signature)),
  };
}

interface Fixture {
  payload: StudioExternalConformanceAttestationPayload;
  attestation: StudioExternalConformanceAttestation;
  resultBytes: Uint8Array;
  evidenceBytes: Uint8Array;
  keys: CryptoKeyPair;
  trustRoot: StudioExternalConformanceTrustRoot;
}

async function fixture(): Promise<Fixture> {
  const resultBytes = ENCODER.encode('{"compliant":true,"violations":[]}');
  const evidenceBytes = ENCODER.encode("validator-log\nrule-count=42\n");
  const keys = await p256Keys();
  const payload: StudioExternalConformanceAttestationPayload = {
    schema: STUDIO_EXTERNAL_CONFORMANCE_ATTESTATION_SCHEMA,
    schemaVersion: STUDIO_EXTERNAL_CONFORMANCE_ATTESTATION_SCHEMA_VERSION,
    provider: "validator.example",
    vendor: "Example-Validation-Labs",
    standard: "ISO-19005",
    profile: "PDF-A-2b",
    standardVersion: "2011",
    toolVersion: "validator-7.2.1",
    outcome: "passed",
    documentDigest: `sha256:${"1a".repeat(32)}`,
    resultDigest: await digestStudioExternalConformanceEvidence(resultBytes),
    evidenceDigest: await digestStudioExternalConformanceEvidence(evidenceBytes),
    signedAt: "2026-07-30T01:00:00.000Z",
    expiresAt: "2026-07-30T02:00:00.000Z",
    nonce: "nonce:0f2d734a-9b37-4ca4-8de0",
    keyId: "validation-key:2026-07",
    signatureAlgorithm: "ecdsa-p256-sha256",
  };
  const attestation = await signPayload(payload, keys.privateKey);
  const trustRoot: StudioExternalConformanceTrustRoot = {
    provider: payload.provider,
    vendor: payload.vendor,
    keyId: payload.keyId,
    signatureAlgorithm: payload.signatureAlgorithm,
    publicKey: keys.publicKey,
    scopes: [
      {
        standard: payload.standard,
        profile: payload.profile,
        standardVersion: payload.standardVersion,
      },
    ],
  };
  return { payload, attestation, resultBytes, evidenceBytes, keys, trustRoot };
}

function options(value: Fixture) {
  return {
    expected: {
      standard: value.payload.standard,
      profile: value.payload.profile,
      standardVersion: value.payload.standardVersion,
      documentDigest: value.payload.documentDigest,
      nonce: value.payload.nonce,
    },
    resultBytes: value.resultBytes,
    evidenceBytes: value.evidenceBytes,
    trustRoots: [value.trustRoot],
    now: new Date("2026-07-30T01:30:00.000Z"),
    consumeNonce: () => true,
  } as const;
}

describe("external conformance attestation schema", () => {
  it("produces deterministic canonical JSON and accepts only its canonical UTF-8 encoding", async () => {
    const value = await fixture();
    const shuffled = {
      signatureBytes: value.attestation.signatureBytes,
      vendor: value.attestation.vendor,
      toolVersion: value.attestation.toolVersion,
      standardVersion: value.attestation.standardVersion,
      standard: value.attestation.standard,
      signedAt: value.attestation.signedAt,
      signatureAlgorithm: value.attestation.signatureAlgorithm,
      schemaVersion: value.attestation.schemaVersion,
      schema: value.attestation.schema,
      resultDigest: value.attestation.resultDigest,
      provider: value.attestation.provider,
      profile: value.attestation.profile,
      outcome: value.attestation.outcome,
      nonce: value.attestation.nonce,
      keyId: value.attestation.keyId,
      expiresAt: value.attestation.expiresAt,
      evidenceDigest: value.attestation.evidenceDigest,
      documentDigest: value.attestation.documentDigest,
    };

    const canonical = canonicalStudioExternalConformanceAttestationJson(shuffled);
    expect(canonical).toBe(
      new TextDecoder().decode(
        encodeStudioExternalConformanceAttestation(value.attestation)
      )
    );
    expect(canonical.startsWith('{"documentDigest":')).toBe(true);
    expect(
      decodeStudioExternalConformanceAttestation(ENCODER.encode(canonical))
    ).toEqual(value.attestation);
    expect(() =>
      decodeStudioExternalConformanceAttestation(ENCODER.encode(` ${canonical}`))
    ).toThrowError(
      expect.objectContaining({ code: "CANONICAL_ENCODING_INVALID" })
    );
  });

  it("fails closed on unknown fields, accessors, unsafe identifiers, and malformed signatures", async () => {
    const value = await fixture();
    expect(() =>
      parseStudioExternalConformanceAttestation({
        ...value.attestation,
        officialCertification: true,
      })
    ).toThrow(StudioExternalConformanceAttestationError);

    const accessor = { ...value.attestation };
    Object.defineProperty(accessor, "provider", {
      enumerable: true,
      get: () => value.attestation.provider,
    });
    expect(() =>
      parseStudioExternalConformanceAttestation(accessor)
    ).toThrow(StudioExternalConformanceAttestationError);
    expect(() =>
      parseStudioExternalConformanceAttestation({
        ...value.attestation,
        nonce: "short",
      })
    ).toThrow(StudioExternalConformanceAttestationError);
    expect(() =>
      parseStudioExternalConformanceAttestation({
        ...value.attestation,
        signatureBytes: "not+padded==",
      })
    ).toThrow(StudioExternalConformanceAttestationError);
  });

  it("computes the exact SHA-256 evidence digest and enforces the byte budget", async () => {
    expect(
      await digestStudioExternalConformanceEvidence(ENCODER.encode("evidence"))
    ).toBe(
      "sha256:ee8250fb76e094b34b471f13a73dbbe51d1ae142e9df59d7c0d31ec20f0a0a8e"
    );
    await expect(
      digestStudioExternalConformanceEvidence(
        new Uint8Array(64 * 1024 * 1024 + 1)
      )
    ).rejects.toMatchObject({ code: "RESOURCE_LIMIT_EXCEEDED" });
  });
});

describe("external conformance attestation verification", () => {
  it("accepts a scoped P-256 provider assertion without issuing certification or trademark approval", async () => {
    const value = await fixture();
    const consumeNonce = vi.fn(() => true);
    const result = await verifyStudioExternalConformanceAttestation(
      value.attestation,
      { ...options(value), consumeNonce }
    );

    expect(result).toMatchObject({
      accepted: true,
      receipt: {
        kind: "studio-external-conformance-attestation-acceptance",
        assurance: "external-provider-attestation-accepted",
        provider: value.payload.provider,
        profile: "PDF-A-2b",
        officialCertificationIssuedByProduct: false,
        trademarkApprovalIssuedByProduct: false,
        selfValidationReceiptIssued: false,
      },
    });
    expect(consumeNonce).toHaveBeenCalledOnce();
    expect(consumeNonce).toHaveBeenCalledWith(
      expect.objectContaining({
        nonce: value.payload.nonce,
        documentDigest: value.payload.documentDigest,
      })
    );
  });

  it("ships an empty trust root allowlist and never consumes a nonce for an untrusted signer", async () => {
    const value = await fixture();
    const consumeNonce = vi.fn(() => true);
    expect(STUDIO_EXTERNAL_CONFORMANCE_DEFAULT_TRUST_ROOTS).toEqual([]);
    expect(
      await verifyStudioExternalConformanceAttestation(value.attestation, {
        ...options(value),
        trustRoots: undefined,
        consumeNonce,
      })
    ).toEqual({ accepted: false, code: "trust-root-not-found" });
    expect(consumeNonce).not.toHaveBeenCalled();
  });

  it("rejects mismatched profile, document, result, evidence, and failed claims", async () => {
    const value = await fixture();
    const base = options(value);
    expect(
      await verifyStudioExternalConformanceAttestation(value.attestation, {
        ...base,
        expected: { ...base.expected, profile: "PDF-X-4" },
      })
    ).toEqual({ accepted: false, code: "claim-mismatch" });
    expect(
      await verifyStudioExternalConformanceAttestation(value.attestation, {
        ...base,
        expected: {
          ...base.expected,
          documentDigest: `sha256:${"2b".repeat(32)}`,
        },
      })
    ).toEqual({ accepted: false, code: "document-digest-mismatch" });
    expect(
      await verifyStudioExternalConformanceAttestation(value.attestation, {
        ...base,
        resultBytes: ENCODER.encode("tampered"),
      })
    ).toEqual({ accepted: false, code: "result-digest-mismatch" });
    expect(
      await verifyStudioExternalConformanceAttestation(value.attestation, {
        ...base,
        evidenceBytes: ENCODER.encode("tampered"),
      })
    ).toEqual({ accepted: false, code: "evidence-digest-mismatch" });
    expect(
      await verifyStudioExternalConformanceAttestation(
        { ...value.attestation, outcome: "failed" },
        base
      )
    ).toEqual({ accepted: false, code: "claim-not-passed" });
  });

  it("rejects expired, future, overlong, duplicate nonce, and missing nonce policies", async () => {
    const value = await fixture();
    const base = options(value);
    expect(
      await verifyStudioExternalConformanceAttestation(value.attestation, {
        ...base,
        now: new Date("2026-07-30T02:00:00.000Z"),
      })
    ).toEqual({ accepted: false, code: "expired" });
    expect(
      await verifyStudioExternalConformanceAttestation(value.attestation, {
        ...base,
        now: new Date("2026-07-30T00:00:00.000Z"),
      })
    ).toEqual({ accepted: false, code: "not-yet-valid" });
    expect(
      await verifyStudioExternalConformanceAttestation(value.attestation, {
        ...base,
        maxLifetimeMs: 30 * 60 * 1_000,
      })
    ).toEqual({ accepted: false, code: "lifetime-invalid" });
    expect(
      await verifyStudioExternalConformanceAttestation(value.attestation, {
        ...base,
        consumeNonce: () => false,
      })
    ).toEqual({ accepted: false, code: "nonce-replayed" });
    const { consumeNonce: _consumeNonce, ...withoutNonceStore } = base;
    expect(
      await verifyStudioExternalConformanceAttestation(
        value.attestation,
        withoutNonceStore
      )
    ).toEqual({ accepted: false, code: "nonce-verifier-unavailable" });
  });

  it("rejects ambiguous roots, wrong keys, and a cryptographically altered assertion", async () => {
    const value = await fixture();
    const otherKeys = await p256Keys();
    expect(
      await verifyStudioExternalConformanceAttestation(value.attestation, {
        ...options(value),
        trustRoots: [value.trustRoot, value.trustRoot],
      })
    ).toEqual({ accepted: false, code: "trust-root-ambiguous" });
    expect(
      await verifyStudioExternalConformanceAttestation(value.attestation, {
        ...options(value),
        trustRoots: [{ ...value.trustRoot, publicKey: otherKeys.publicKey }],
      })
    ).toEqual({ accepted: false, code: "signature-invalid" });

    const signature = atob(
      value.attestation.signatureBytes
        .replace(/-/gu, "+")
        .replace(/_/gu, "/") + "=="
    );
    const changed = Uint8Array.from(signature, (character) =>
      character.charCodeAt(0)
    );
    changed[1] = (changed[1] ?? 0) ^ 1;
    expect(
      await verifyStudioExternalConformanceAttestation(
        { ...value.attestation, signatureBytes: base64Url(changed) },
        options(value)
      )
    ).toEqual({ accepted: false, code: "signature-invalid" });
  });

  it("supports Ed25519 when the Web Crypto runtime exposes it", async () => {
    let generated: CryptoKeyPair;
    try {
      const keys = await crypto.subtle.generateKey(
        "Ed25519",
        false,
        ["sign", "verify"]
      );
      if (!("privateKey" in keys)) return;
      generated = keys;
    } catch {
      return;
    }
    const value = await fixture();
    const payload: StudioExternalConformanceAttestationPayload = {
      ...value.payload,
      keyId: "validation-ed25519:2026-07",
      signatureAlgorithm: "ed25519",
    };
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        generated.privateKey,
        ownedBuffer(canonicalStudioExternalConformanceSigningBytes(payload))
      )
    );
    const attestation: StudioExternalConformanceAttestation = {
      ...payload,
      signatureBytes: base64Url(signature),
    };
    const trustRoot: StudioExternalConformanceTrustRoot = {
      ...value.trustRoot,
      keyId: payload.keyId,
      signatureAlgorithm: payload.signatureAlgorithm,
      publicKey: generated.publicKey,
    };

    expect(
      await verifyStudioExternalConformanceAttestation(attestation, {
        ...options(value),
        trustRoots: [trustRoot],
      })
    ).toMatchObject({ accepted: true });
  });
});

describe("provider adapter and assurance separation", () => {
  it("accepts an exact provider adapter bundle and rejects adapter expansion", async () => {
    const value = await fixture();
    const accepted = await verifyStudioExternalConformanceProviderSource(
      {
        adapterId: "example-validator-adapter:v1",
        read: () => ({
          attestation: value.attestation,
          resultBytes: value.resultBytes,
          evidenceBytes: value.evidenceBytes,
        }),
      },
      { vendorResponse: "opaque" },
      options(value)
    );
    expect(accepted).toMatchObject({ accepted: true });

    const rejected = await verifyStudioExternalConformanceProviderSource(
      {
        adapterId: "example-validator-adapter:v1",
        read: () =>
          ({
            attestation: value.attestation,
            resultBytes: value.resultBytes,
            evidenceBytes: value.evidenceBytes,
            injectedTrustRoot: value.trustRoot,
          }) as never,
      },
      null,
      options(value)
    );
    expect(rejected).toEqual({
      accepted: false,
      code: "provider-adapter-failed",
    });
  });

  it("keeps public-spec self-validation distinct from external attestation acceptance", () => {
    const receipt = createStudioPublicSpecificationSelfValidationReceipt({
      standard: "W3C-InkML",
      profile: "ToonSpectrum-safe-profile",
      standardVersion: "2011",
      documentDigest: `sha256:${"3c".repeat(32)}`,
      evidenceDigest: `sha256:${"4d".repeat(32)}`,
      validatedAt: "2026-07-30T01:00:00.000Z",
    });

    expect(receipt).toMatchObject({
      assurance: "self-validation",
      externalAttestationAccepted: false,
      officialCertificationIssuedByProduct: false,
      trademarkApprovalIssuedByProduct: false,
    });
    expect(STUDIO_CONFORMANCE_ASSURANCE_BOUNDARY).toEqual({
      publicSpecificationSelfValidation: "toonspectrum-self-validation",
      externalAttestation: "external-provider-attestation-accepted",
      productIssuedOfficialCertification: false,
      productIssuedTrademarkApproval: false,
      vendorSdkOrSigningKeyBundled: false,
    });
  });

  it.each<StudioExternalConformanceSignatureAlgorithm>([
    "ed25519",
    "ecdsa-p256-sha256",
  ])("binds %s algorithm and key identity into canonical signing bytes", async (algorithm) => {
    const value = await fixture();
    const payload = {
      ...value.payload,
      signatureAlgorithm: algorithm,
    };
    const original = canonicalStudioExternalConformanceSigningBytes(payload);
    const relabeled = canonicalStudioExternalConformanceSigningBytes({
      ...payload,
      keyId: "different-key:2026-07",
    });
    expect(original).not.toEqual(relabeled);
  });
});
