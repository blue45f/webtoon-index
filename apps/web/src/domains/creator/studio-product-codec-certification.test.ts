import { describe, expect, it } from "vitest";

import {
  STUDIO_PRODUCT_CODEC_CERTIFICATION_CLAIMS,
  STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS,
  StudioProductCodecCertificationError,
  issueStudioProductCodecCertificate,
  parseStudioProductCodecCertificate,
  serializeStudioProductCodecCertificate,
  verifyStudioProductCodecCertificate,
  type StudioProductCodecCertificationSigner,
  type StudioProductCodecCertificationTrustRoot,
} from "./studio-product-codec-certification";
import { sha256HexPortable } from "./studio-sha256";

import type { StudioInkEnvelopeWebCryptoAlgorithm } from "./brush/studio-ink-envelope-webcrypto-attestation";
import type { StudioCodecExecutionReceipt } from "./studio-codec-provider-contract";

const SCOPE = "toonspectrum.product.codec-conformance.png-encode";
const EVIDENCE_MEDIA_TYPE =
  "application/vnd.toonspectrum.codec-conformance-evidence+json";
const ISSUED_AT = "2026-07-30T00:00:00.000Z";
const NOT_BEFORE = "2026-07-30T00:01:00.000Z";
const EXPIRES_AT = "2026-07-31T00:00:00.000Z";
const ROOT_VALID_FROM = "2026-07-01T00:00:00.000Z";
const ROOT_VALID_UNTIL = "2026-08-31T00:00:00.000Z";
const VERIFY_NOW = Date.parse("2026-07-30T12:00:00.000Z");

const OUTPUT = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const EVIDENCE = new TextEncoder().encode(
  '{"fixtures":128,"pixelDiff":0,"profile":"rgba8"}'
);

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function receipt(
  output = OUTPUT,
  overrides: Partial<StudioCodecExecutionReceipt> = {}
): StudioCodecExecutionReceipt {
  return {
    schemaVersion: 1,
    kind: "toonspectrum-codec-provider-execution",
    providerId: "toonspectrum.codec.png.clean-room",
    mode: "public-clean-room",
    direction: "encode",
    format: "png",
    profile: "rgba8",
    version: "1.0",
    mimeType: "image/png",
    extension: ".png",
    deterministic: true,
    input: {
      byteLength: 4,
      sha256: digest(Uint8Array.of(1, 2, 3, 4)),
    },
    output: {
      byteLength: output.byteLength,
      sha256: digest(output),
    },
    licenseGrant: {
      id: "spdx.mit.toonspectrum.codec.png",
      scope: [
        "public-clean-room",
        "encode",
        "decode",
        "commercial-use",
      ],
      expiresAt: null,
    },
    officialClaims: {
      externalAttestationAccepted: false,
      officialCodec: false,
      certified: false,
      trademarkAuthorized: false,
    },
    ...overrides,
  };
}

async function keyPair(
  algorithm: StudioInkEnvelopeWebCryptoAlgorithm
): Promise<CryptoKeyPair> {
  return algorithm === "ed25519"
    ? (await crypto.subtle.generateKey(
        "Ed25519",
        true,
        ["sign", "verify"]
      )) as CryptoKeyPair
    : (await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
      )) as CryptoKeyPair;
}

function signer(
  algorithm: StudioInkEnvelopeWebCryptoAlgorithm,
  privateKey: CryptoKey,
  overrides: Partial<StudioProductCodecCertificationSigner> = {}
): StudioProductCodecCertificationSigner {
  return {
    algorithm,
    keyId: `toonspectrum.product.release.${algorithm}.2026-07`,
    privateKey,
    scopes: [SCOPE],
    validFrom: ROOT_VALID_FROM,
    validUntil: ROOT_VALID_UNTIL,
    ...overrides,
  };
}

function trustRoot(
  algorithm: StudioInkEnvelopeWebCryptoAlgorithm,
  publicKey: CryptoKey,
  overrides: Partial<StudioProductCodecCertificationTrustRoot> = {}
): StudioProductCodecCertificationTrustRoot {
  return {
    algorithm,
    keyId: `toonspectrum.product.release.${algorithm}.2026-07`,
    publicKey,
    scopes: [SCOPE],
    validFrom: ROOT_VALID_FROM,
    validUntil: ROOT_VALID_UNTIL,
    revokedAt: null,
    ...overrides,
  };
}

async function issuedCertificate(
  signingKey: StudioProductCodecCertificationSigner,
  overrides: Partial<Parameters<typeof issueStudioProductCodecCertificate>[0]> =
    {}
): Promise<Uint8Array> {
  return issueStudioProductCodecCertificate(
    {
      receipt: receipt(),
      outputBytes: OUTPUT,
      evidenceBytes: EVIDENCE,
      evidenceMediaType: EVIDENCE_MEDIA_TYPE,
      scope: SCOPE,
      issuedAt: ISSUED_AT,
      notBefore: NOT_BEFORE,
      expiresAt: EXPIRES_AT,
      ...overrides,
    },
    signingKey
  );
}

function verifyOptions(
  root: StudioProductCodecCertificationTrustRoot,
  overrides: Partial<
    Parameters<typeof verifyStudioProductCodecCertificate>[1]
  > = {}
): Parameters<typeof verifyStudioProductCodecCertificate>[1] {
  return {
    outputBytes: OUTPUT,
    evidenceBytes: EVIDENCE,
    trustRoots: [root],
    expectedScope: SCOPE,
    nowEpochMs: VERIFY_NOW,
    ...overrides,
  };
}

describe("ToonSpectrum product codec conformance certification", () => {
  it.each<StudioInkEnvelopeWebCryptoAlgorithm>([
    "ed25519",
    "ecdsa-p256-sha256",
  ])(
    "issues and verifies exact-source %s certificates",
    async algorithm => {
      const keys = await keyPair(algorithm);
      const source = await issuedCertificate(
        signer(algorithm, keys.privateKey)
      );
      const result = await verifyStudioProductCodecCertificate(
        source,
        verifyOptions(trustRoot(algorithm, keys.publicKey))
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.certificate.certification).toEqual(
        STUDIO_PRODUCT_CODEC_CERTIFICATION_CLAIMS
      );
      expect(result.certificate.certification).toMatchObject({
        officialToonSpectrumProductCertification: true,
        thirdPartyCodecCertification: false,
        codecVendorCertification: false,
        officialCodecVendorClaim: false,
        trademarkAuthorization: false,
      });
      expect(result.certificate.receipt.officialClaims).toEqual({
        externalAttestationAccepted: false,
        officialCodec: false,
        certified: false,
        trademarkAuthorized: false,
      });
      expect(result.certificate.output).toEqual({
        byteLength: OUTPUT.byteLength,
        sha256: digest(OUTPUT),
      });
      expect(result.certificate.evidence).toEqual({
        byteLength: EVIDENCE.byteLength,
        sha256: digest(EVIDENCE),
        mediaType: EVIDENCE_MEDIA_TYPE,
      });
    }
  );

  it("round-trips only canonical UTF-8 JSON and freezes the parsed certificate", async () => {
    const keys = await keyPair("ecdsa-p256-sha256");
    const source = await issuedCertificate(
      signer("ecdsa-p256-sha256", keys.privateKey)
    );
    const parsed = parseStudioProductCodecCertificate(source);

    expect(serializeStudioProductCodecCertificate(parsed)).toEqual(source);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.receipt)).toBe(true);
    expect(Object.isFrozen(parsed.signature)).toBe(true);
    const spaced = new TextEncoder().encode(
      new TextDecoder().decode(source).replace(',"evidence":', ', "evidence":')
    );
    expect(() => parseStudioProductCodecCertificate(spaced)).toThrowError(
      expect.objectContaining({
        code: "NON_CANONICAL_SERIALIZATION",
      })
    );
  });

  it("rejects signed-source tampering and signature tampering", async () => {
    const keys = await keyPair("ecdsa-p256-sha256");
    const source = await issuedCertificate(
      signer("ecdsa-p256-sha256", keys.privateKey)
    );
    const serialized = new TextDecoder().decode(source);
    const scopeTamper = new TextEncoder().encode(
      serialized.replace(
        "toonspectrum.product.codec-conformance.png-encode",
        "toonspectrum.product.codec-conformance.png-decode"
      )
    );
    const structuralResult = await verifyStudioProductCodecCertificate(
      scopeTamper,
      verifyOptions(trustRoot("ecdsa-p256-sha256", keys.publicKey))
    );
    expect(structuralResult).toMatchObject({
      ok: false,
      code: "CERTIFICATE_ID_MISMATCH",
    });

    const exactSignatureTamper = new TextEncoder().encode(
      serialized.replace(
        /"value":"([A-Za-z0-9_-])/u,
        (_match, first: string) =>
          `"value":"${first === "A" ? "B" : "A"}`
      )
    );
    const signatureResult = await verifyStudioProductCodecCertificate(
      exactSignatureTamper,
      verifyOptions(trustRoot("ecdsa-p256-sha256", keys.publicKey))
    );
    expect(signatureResult).toMatchObject({
      ok: false,
      code: "SIGNATURE_INVALID",
    });

    const invalidSignatureAndSameLengthOutput = await verifyStudioProductCodecCertificate(
      exactSignatureTamper,
      verifyOptions(trustRoot("ecdsa-p256-sha256", keys.publicKey), {
        outputBytes: Uint8Array.from([...OUTPUT.slice(0, -1), 9]),
      })
    );
    expect(invalidSignatureAndSameLengthOutput).toMatchObject({
      ok: false,
      code: "SIGNATURE_INVALID",
    });
  });

  it("rejects output and evidence substitutions independently", async () => {
    const keys = await keyPair("ecdsa-p256-sha256");
    const source = await issuedCertificate(
      signer("ecdsa-p256-sha256", keys.privateKey)
    );
    const root = trustRoot("ecdsa-p256-sha256", keys.publicKey);

    await expect(
      verifyStudioProductCodecCertificate(
        source,
        verifyOptions(root, {
          outputBytes: Uint8Array.from([...OUTPUT.slice(0, -1), 9]),
        })
      )
    ).resolves.toMatchObject({ ok: false, code: "OUTPUT_MISMATCH" });
    await expect(
      verifyStudioProductCodecCertificate(
        source,
        verifyOptions(root, {
          evidenceBytes: new TextEncoder().encode("different evidence"),
        })
      )
    ).resolves.toMatchObject({ ok: false, code: "EVIDENCE_MISMATCH" });
  });

  it("will not issue a certificate for bytes that differ from the provider receipt", async () => {
    const keys = await keyPair("ecdsa-p256-sha256");
    await expect(
      issuedCertificate(
        signer("ecdsa-p256-sha256", keys.privateKey),
        {
          receipt: receipt(Uint8Array.of(1, 2, 3)),
        }
      )
    ).rejects.toMatchObject({
      name: "StudioProductCodecCertificationError",
      code: "OUTPUT_MISMATCH",
    });
  });

  it("enforces expected scope and scoped trust roots", async () => {
    const keys = await keyPair("ecdsa-p256-sha256");
    const source = await issuedCertificate(
      signer("ecdsa-p256-sha256", keys.privateKey)
    );
    const root = trustRoot("ecdsa-p256-sha256", keys.publicKey);

    await expect(
      verifyStudioProductCodecCertificate(
        source,
        verifyOptions(root, {
          expectedScope: "toonspectrum.product.codec-conformance.webp-encode",
        })
      )
    ).resolves.toMatchObject({ ok: false, code: "SCOPE_MISMATCH" });
    await expect(
      verifyStudioProductCodecCertificate(
        source,
        verifyOptions({
          ...root,
          scopes: [
            "toonspectrum.product.codec-conformance.webp-encode",
          ],
        })
      )
    ).resolves.toMatchObject({ ok: false, code: "UNTRUSTED_KEY" });
  });

  it("rejects a wrong key even when its algorithm and key id match", async () => {
    const signingKeys = await keyPair("ecdsa-p256-sha256");
    const wrongKeys = await keyPair("ecdsa-p256-sha256");
    const source = await issuedCertificate(
      signer("ecdsa-p256-sha256", signingKeys.privateKey)
    );
    const result = await verifyStudioProductCodecCertificate(
      source,
      verifyOptions(
        trustRoot("ecdsa-p256-sha256", wrongKeys.publicKey)
      )
    );
    expect(result).toMatchObject({ ok: false, code: "SIGNATURE_INVALID" });
  });

  it("supports non-overlapping key rotation windows", async () => {
    const oldKeys = await keyPair("ecdsa-p256-sha256");
    const newKeys = await keyPair("ecdsa-p256-sha256");
    const oldSigner = signer("ecdsa-p256-sha256", oldKeys.privateKey, {
      keyId: "toonspectrum.product.release.p256.2026-h1",
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2026-08-01T00:00:00.000Z",
    });
    const newSigner = signer("ecdsa-p256-sha256", newKeys.privateKey, {
      keyId: "toonspectrum.product.release.p256.2026-h2",
      validFrom: "2026-08-01T00:00:00.000Z",
      validUntil: "2027-01-01T00:00:00.000Z",
    });
    const oldSource = await issuedCertificate(oldSigner, {
      issuedAt: "2026-07-29T00:00:00.000Z",
      notBefore: "2026-07-29T00:00:00.000Z",
      expiresAt: "2026-07-31T00:00:00.000Z",
    });
    const newSource = await issuedCertificate(newSigner, {
      issuedAt: "2026-08-02T00:00:00.000Z",
      notBefore: "2026-08-02T00:00:00.000Z",
      expiresAt: "2026-08-03T00:00:00.000Z",
    });
    const roots = [
      trustRoot("ecdsa-p256-sha256", oldKeys.publicKey, {
        keyId: oldSigner.keyId,
        validFrom: oldSigner.validFrom,
        validUntil: oldSigner.validUntil,
      }),
      trustRoot("ecdsa-p256-sha256", newKeys.publicKey, {
        keyId: newSigner.keyId,
        validFrom: newSigner.validFrom,
        validUntil: newSigner.validUntil,
      }),
    ];

    await expect(
      verifyStudioProductCodecCertificate(oldSource, {
        ...verifyOptions(roots[0]!),
        trustRoots: roots,
        nowEpochMs: Date.parse("2026-07-30T00:00:00.000Z"),
      })
    ).resolves.toMatchObject({ ok: true });
    await expect(
      verifyStudioProductCodecCertificate(newSource, {
        ...verifyOptions(roots[1]!),
        trustRoots: roots,
        nowEpochMs: Date.parse("2026-08-02T12:00:00.000Z"),
      })
    ).resolves.toMatchObject({ ok: true });
  });

  it("enforces not-before, expiry, certificate revocation, and key revocation", async () => {
    const keys = await keyPair("ecdsa-p256-sha256");
    const source = await issuedCertificate(
      signer("ecdsa-p256-sha256", keys.privateKey)
    );
    const root = trustRoot("ecdsa-p256-sha256", keys.publicKey);
    const certificate = parseStudioProductCodecCertificate(source);

    await expect(
      verifyStudioProductCodecCertificate(
        source,
        verifyOptions(root, {
          nowEpochMs: Date.parse("2026-07-30T00:00:30.000Z"),
        })
      )
    ).resolves.toMatchObject({
      ok: false,
      code: "CERTIFICATE_NOT_YET_VALID",
    });
    await expect(
      verifyStudioProductCodecCertificate(
        source,
        verifyOptions(root, {
          nowEpochMs: Date.parse(EXPIRES_AT),
        })
      )
    ).resolves.toMatchObject({ ok: false, code: "CERTIFICATE_EXPIRED" });
    await expect(
      verifyStudioProductCodecCertificate(
        source,
        verifyOptions(root, {
          revokedCertificateIds: new Set([certificate.certificateId]),
        })
      )
    ).resolves.toMatchObject({ ok: false, code: "CERTIFICATE_REVOKED" });
    await expect(
      verifyStudioProductCodecCertificate(
        source,
        verifyOptions(root, {
          revokedKeyIds: new Set([certificate.signature.keyId]),
        })
      )
    ).resolves.toMatchObject({ ok: false, code: "KEY_REVOKED" });
    await expect(
      verifyStudioProductCodecCertificate(
        source,
        verifyOptions({
          ...root,
          revokedAt: "2026-07-30T06:00:00.000Z",
        })
      )
    ).resolves.toMatchObject({ ok: false, code: "KEY_REVOKED" });
  });

  it("uses random certificate ids and an atomic claim hook to reject replay", async () => {
    const keys = await keyPair("ecdsa-p256-sha256");
    const signingKey = signer("ecdsa-p256-sha256", keys.privateKey);
    const first = await issuedCertificate(signingKey);
    const second = await issuedCertificate(signingKey);
    const firstParsed = parseStudioProductCodecCertificate(first);
    const secondParsed = parseStudioProductCodecCertificate(second);
    expect(firstParsed.certificateId).not.toBe(secondParsed.certificateId);
    expect(firstParsed.nonce).not.toBe(secondParsed.nonce);

    const claimed = new Set<string>();
    const claimCertificateId = (id: string): boolean => {
      if (claimed.has(id)) return false;
      claimed.add(id);
      return true;
    };
    const options = verifyOptions(
      trustRoot("ecdsa-p256-sha256", keys.publicKey),
      { claimCertificateId }
    );
    await expect(
      verifyStudioProductCodecCertificate(first, options)
    ).resolves.toMatchObject({ ok: true });
    await expect(
      verifyStudioProductCodecCertificate(first, options)
    ).resolves.toMatchObject({
      ok: false,
      code: "REPLAYED_CERTIFICATE",
    });
  });

  it("fails closed on malformed, non-canonical, and over-budget sources", async () => {
    expect(() =>
      parseStudioProductCodecCertificate(Uint8Array.of(0xc3, 0x28))
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_UTF8" })
    );
    expect(() =>
      parseStudioProductCodecCertificate(new TextEncoder().encode("{"))
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_JSON" })
    );
    expect(() =>
      parseStudioProductCodecCertificate(
        new Uint8Array(
          STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxCertificateBytes + 1
        )
      )
    ).toThrowError(
      expect.objectContaining({ code: "LIMIT_EXCEEDED" })
    );
    expect(() =>
      parseStudioProductCodecCertificate({ byteLength: 8 })
    ).toThrowError(StudioProductCodecCertificationError);
  });

  it("rejects ambiguous trust roots instead of choosing one implicitly", async () => {
    const keys = await keyPair("ecdsa-p256-sha256");
    const source = await issuedCertificate(
      signer("ecdsa-p256-sha256", keys.privateKey)
    );
    const root = trustRoot("ecdsa-p256-sha256", keys.publicKey);
    const result = await verifyStudioProductCodecCertificate(source, {
      ...verifyOptions(root),
      trustRoots: [root, { ...root }],
    });
    expect(result).toMatchObject({
      ok: false,
      code: "AMBIGUOUS_TRUST_ROOT",
    });
  });

  it("fails closed when an adversarial trust-root descriptor throws", async () => {
    const keys = await keyPair("ecdsa-p256-sha256");
    const source = await issuedCertificate(
      signer("ecdsa-p256-sha256", keys.privateKey)
    );
    const adversarial = new Proxy(
      trustRoot("ecdsa-p256-sha256", keys.publicKey),
      {
        getOwnPropertyDescriptor() {
          throw new Error("descriptor trap");
        },
      }
    );
    await expect(
      verifyStudioProductCodecCertificate(source, {
        ...verifyOptions(
          trustRoot("ecdsa-p256-sha256", keys.publicKey)
        ),
        trustRoots: [adversarial],
      })
    ).resolves.toMatchObject({
      ok: false,
      code: "UNTRUSTED_KEY",
    });
  });
});
