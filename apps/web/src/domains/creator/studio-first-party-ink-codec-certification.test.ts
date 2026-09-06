// @ts-expect-error -- jsdom is a test-only runtime fixture and does not bundle TypeScript types.
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  executeAndCertifyStudioFirstPartyInkCodec,
  studioFirstPartyInkCodecCertificationScope,
  verifyStudioFirstPartyInkCertifiedExecution,
} from "./studio-first-party-ink-codec-certification";
import {
  encodeStudioInkEnvelopeDocumentTransport,
  encodeStudioInkMlTraceTransport,
} from "./studio-first-party-ink-codec-provider";
import {
  STUDIO_INKML_PROFILE,
} from "./studio-inkml-codec";
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
const originalDomParser = globalThis.DOMParser;

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
  const keyId = "toonspectrum.product.release.ink.2026-07";
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

function inputFor(format: "inkml" | "toonink"): Uint8Array {
  if (format === "inkml") {
    return encodeStudioInkMlTraceTransport({
      profile: STUDIO_INKML_PROFILE,
      traces: [
        {
          id: "signed-trace",
          points: [0, 0, 8, 12],
          pressures: [0.25, 0.875],
          tiltXs: [10, 20],
          tiltYs: [-10, -20],
          twists: [45, 270],
          speeds: [0, 3.5],
          tangentialPressures: [-0.25, 0.5],
        },
      ],
      ignoredChannels: [],
    });
  }
  return encodeStudioInkEnvelopeDocumentTransport({
    format: {
      id: "toonspectrum.ink-document",
      version: 1,
    },
    document: {
      id: "ink:certification-test",
      revision: 2,
      createdAt: ISSUED_AT,
      updatedAt: ISSUED_AT,
    },
    payload: {
      type: "ink-document",
      data: {
        title: "Certified first-party ink",
        strokes: [{ id: "stroke-1", brush: "g-pen" }],
      },
    },
    extensions: {},
  });
}

describe("first-party ink codec product certification", () => {
  for (const format of ["toonink", "inkml"] as const) {
    it(`executes, proves, signs, and verifies exact ${format} bytes`, async () => {
      const scope = studioFirstPartyInkCodecCertificationScope(
        format,
        "encode",
      );
      const { signer, root } = await credentials(scope);
      const certified = await executeAndCertifyStudioFirstPartyInkCodec(
        {
          format,
          direction: "encode",
          inputBytes: inputFor(format),
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
        },
        signer,
      );

      expect(certified.conformance).toMatchObject({
        format,
        decision: "passed",
      });
      expect(certified.receipt.officialClaims).toEqual({
        externalAttestationAccepted: false,
        officialCodec: false,
        certified: false,
        trademarkAuthorized: false,
      });

      const verified = await verifyStudioFirstPartyInkCertifiedExecution(
        certified,
        {
          trustRoots: [root],
          nowEpochMs: VERIFY_AT,
        },
      );
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
  }

  it("rejects output and conformance evidence substitution", async () => {
    const scope = studioFirstPartyInkCodecCertificationScope(
      "toonink",
      "encode",
    );
    const { signer, root } = await credentials(scope);
    const certified = await executeAndCertifyStudioFirstPartyInkCodec(
      {
        format: "toonink",
        direction: "encode",
        inputBytes: inputFor("toonink"),
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      },
      signer,
    );

    await expect(
      verifyStudioFirstPartyInkCertifiedExecution(
        {
          ...certified,
          bytes: Uint8Array.from([...certified.bytes, 0]),
        },
        { trustRoots: [root], nowEpochMs: VERIFY_AT },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "OUTPUT_MISMATCH",
    });
    await expect(
      verifyStudioFirstPartyInkCertifiedExecution(
        {
          ...certified,
          conformanceBytes: Uint8Array.from([
            ...certified.conformanceBytes,
            0,
          ]),
        },
        { trustRoots: [root], nowEpochMs: VERIFY_AT },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "EVIDENCE_MISMATCH",
    });
    await expect(
      verifyStudioFirstPartyInkCertifiedExecution(
        {
          ...certified,
          conformance: {
            ...certified.conformance,
            manifestSha256: `sha256:${"0".repeat(64)}`,
            cases: [],
          },
        },
        { trustRoots: [root], nowEpochMs: VERIFY_AT },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH",
    });
  });

  it("rejects a substituted ergonomic receipt after signature verification", async () => {
    const scope = studioFirstPartyInkCodecCertificationScope(
      "inkml",
      "encode",
    );
    const { signer, root } = await credentials(scope);
    const certified = await executeAndCertifyStudioFirstPartyInkCodec(
      {
        format: "inkml",
        direction: "encode",
        inputBytes: inputFor("inkml"),
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      },
      signer,
    );
    const result = await verifyStudioFirstPartyInkCertifiedExecution(
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
      },
    );
    expect(result).toMatchObject({
      ok: false,
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH",
    });
  });

  it("rejects substituted license scope metadata on the ergonomic receipt", async () => {
    const scope = studioFirstPartyInkCodecCertificationScope(
      "toonink",
      "encode",
    );
    const { signer, root } = await credentials(scope);
    const certified = await executeAndCertifyStudioFirstPartyInkCodec(
      {
        format: "toonink",
        direction: "encode",
        inputBytes: inputFor("toonink"),
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      },
      signer,
    );
    const result = await verifyStudioFirstPartyInkCertifiedExecution(
      {
        ...certified,
        receipt: {
          ...certified.receipt,
          licenseGrant: {
            ...certified.receipt.licenseGrant,
            scope: ["decode"],
          },
        },
      },
      {
        trustRoots: [root],
        nowEpochMs: VERIFY_AT,
      },
    );
    expect(result).toMatchObject({
      ok: false,
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH",
    });
  });

  it("does not consume a one-shot certificate id before wrapper identity succeeds", async () => {
    const scope = studioFirstPartyInkCodecCertificationScope(
      "inkml",
      "encode",
    );
    const { signer, root } = await credentials(scope);
    const certified = await executeAndCertifyStudioFirstPartyInkCodec(
      {
        format: "inkml",
        direction: "encode",
        inputBytes: inputFor("inkml"),
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
      verifyStudioFirstPartyInkCertifiedExecution(
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
      verifyStudioFirstPartyInkCertifiedExecution(certified, {
        trustRoots: [root],
        nowEpochMs: VERIFY_AT,
        claimCertificateId,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(claimed.size).toBe(1);
  });

  it("pins the signed ink conformance media type", async () => {
    const scope = studioFirstPartyInkCodecCertificationScope(
      "inkml",
      "encode",
    );
    const { signer, root } = await credentials(scope);
    const certified = await executeAndCertifyStudioFirstPartyInkCodec(
      {
        format: "inkml",
        direction: "encode",
        inputBytes: encodeStudioInkMlTraceTransport({
          profile: STUDIO_INKML_PROFILE,
          traces: [],
          ignoredChannels: [],
        }),
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
      verifyStudioFirstPartyInkCertifiedExecution(
        { ...certified, certificateBytes: mislabeled },
        { trustRoots: [root], nowEpochMs: VERIFY_AT },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH",
    });
  });
});
