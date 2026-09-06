import { describe, expect, it } from "vitest";

import {
  executeAndCertifyStudioFirstPartyWillV1Codec,
  studioFirstPartyWillV1CodecCertificationScope,
  verifyStudioFirstPartyWillV1CertifiedExecution,
} from "./studio-first-party-will-v1-codec-certification";
import {
  encodeStudioWillV1PathTransport,
} from "./studio-first-party-will-v1-codec-provider";
import {
  issueStudioProductCodecCertificate,
} from "./studio-product-codec-certification";

import type {
  StudioProductCodecCertificationSigner,
  StudioProductCodecCertificationTrustRoot,
} from "./studio-product-codec-certification";

const ISSUED_AT = "2026-07-30T00:00:00.000Z";
const EXPIRES_AT = "2026-07-31T00:00:00.000Z";
const ROOT_START = "2026-07-01T00:00:00.000Z";
const ROOT_END = "2026-08-31T00:00:00.000Z";
const VERIFY_AT = Date.parse("2026-07-30T12:00:00.000Z");

const INPUT = encodeStudioWillV1PathTransport([
  {
    points: [
      { x: 0, y: 0 },
      { x: 8, y: 12 },
      { x: 16, y: 20 },
      { x: 28, y: 14 },
    ],
    strokeWidths: [0.75, 1.25],
    strokeColor: { r: 12, g: 34, b: 56, a: 220 },
    decimalPrecision: 2,
  },
]);

async function credentials(
  scope: string,
): Promise<Readonly<{
  signer: StudioProductCodecCertificationSigner;
  root: StudioProductCodecCertificationTrustRoot;
}>> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const keyId = "toonspectrum.product.release.will-v1.2026-07";
  return Object.freeze({
    signer: {
      algorithm: "ecdsa-p256-sha256",
      keyId,
      privateKey: pair.privateKey,
      scopes: [scope],
      validFrom: ROOT_START,
      validUntil: ROOT_END,
    },
    root: {
      algorithm: "ecdsa-p256-sha256",
      keyId,
      publicKey: pair.publicKey,
      scopes: [scope],
      validFrom: ROOT_START,
      validUntil: ROOT_END,
      revokedAt: null,
    },
  });
}

describe("first-party WILL v1 Annex A product certification", () => {
  it("executes, proves, signs, and verifies exact Path-stream bytes", async () => {
    const scope = studioFirstPartyWillV1CodecCertificationScope("encode");
    const { signer, root } = await credentials(scope);
    const certified = await executeAndCertifyStudioFirstPartyWillV1Codec(
      {
        direction: "encode",
        inputBytes: INPUT,
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      },
      signer,
    );
    expect(certified.conformance).toMatchObject({
      coverage: "annex-a-path-stream-only",
      annexBContainerCovered: false,
      decision: "passed",
    });

    const verified =
      await verifyStudioFirstPartyWillV1CertifiedExecution(certified, {
        trustRoots: [root],
        nowEpochMs: VERIFY_AT,
      });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(
      verified.certificate.certification
        .officialToonSpectrumProductCertification,
    ).toBe(true);
    expect(
      verified.certificate.certification.codecVendorCertification,
    ).toBe(false);
  });

  it("rejects byte, evidence, and ergonomic receipt substitution", async () => {
    const scope = studioFirstPartyWillV1CodecCertificationScope("encode");
    const { signer, root } = await credentials(scope);
    const certified = await executeAndCertifyStudioFirstPartyWillV1Codec(
      {
        direction: "encode",
        inputBytes: INPUT,
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      },
      signer,
    );
    await expect(
      verifyStudioFirstPartyWillV1CertifiedExecution(
        {
          ...certified,
          bytes: Uint8Array.from([...certified.bytes, 0]),
        },
        { trustRoots: [root], nowEpochMs: VERIFY_AT },
      ),
    ).resolves.toMatchObject({ ok: false, code: "OUTPUT_MISMATCH" });
    await expect(
      verifyStudioFirstPartyWillV1CertifiedExecution(
        {
          ...certified,
          conformanceBytes: Uint8Array.from([
            ...certified.conformanceBytes,
            0,
          ]),
        },
        { trustRoots: [root], nowEpochMs: VERIFY_AT },
      ),
    ).resolves.toMatchObject({ ok: false, code: "EVIDENCE_MISMATCH" });
    await expect(
      verifyStudioFirstPartyWillV1CertifiedExecution(
        {
          ...certified,
          conformance: {
            ...certified.conformance,
            manifestSha256: `sha256:${"0".repeat(64)}`,
          },
        },
        { trustRoots: [root], nowEpochMs: VERIFY_AT },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH",
    });
    await expect(
      verifyStudioFirstPartyWillV1CertifiedExecution(
        {
          ...certified,
          receipt: {
            ...certified.receipt,
            providerId: "substituted.provider",
          },
        },
        { trustRoots: [root], nowEpochMs: VERIFY_AT },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH",
    });
  });

  it("claims one-shot ids only after the Annex A wrapper identity passes", async () => {
    const scope = studioFirstPartyWillV1CodecCertificationScope("encode");
    const { signer, root } = await credentials(scope);
    const certified = await executeAndCertifyStudioFirstPartyWillV1Codec(
      {
        direction: "encode",
        inputBytes: INPUT,
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      },
      signer,
    );
    const claimed = new Set<string>();
    const claimCertificateId = (certificateId: string) => {
      if (claimed.has(certificateId)) return false;
      claimed.add(certificateId);
      return true;
    };
    await expect(
      verifyStudioFirstPartyWillV1CertifiedExecution(
        {
          ...certified,
          receipt: {
            ...certified.receipt,
            providerId: "substituted.provider",
          },
        },
        {
          trustRoots: [root],
          nowEpochMs: VERIFY_AT,
          claimCertificateId,
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH",
    });
    expect(claimed.size).toBe(0);
    await expect(
      verifyStudioFirstPartyWillV1CertifiedExecution(certified, {
        trustRoots: [root],
        nowEpochMs: VERIFY_AT,
        claimCertificateId,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(claimed.size).toBe(1);
  });

  it("pins the signed WILL v1 conformance media type", async () => {
    const scope = studioFirstPartyWillV1CodecCertificationScope("encode");
    const { signer, root } = await credentials(scope);
    const certified = await executeAndCertifyStudioFirstPartyWillV1Codec(
      {
        direction: "encode",
        inputBytes: INPUT,
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      },
      signer,
    );
    const mislabeled = await issueStudioProductCodecCertificate(
      {
        receipt: certified.receipt,
        outputBytes: certified.bytes,
        evidenceBytes: certified.conformanceBytes,
        evidenceMediaType: "application/vnd.toonspectrum.cross-protocol+json",
        scope,
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      },
      signer,
    );
    await expect(
      verifyStudioFirstPartyWillV1CertifiedExecution(
        { ...certified, certificateBytes: mislabeled },
        { trustRoots: [root], nowEpochMs: VERIFY_AT },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH",
    });
  });
});
