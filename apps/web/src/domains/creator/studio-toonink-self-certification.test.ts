import { describe, expect, it, vi } from "vitest";

import {
  encodeStudioInkEnvelope,
  type StudioInkEnvelopeAttestationVerifier,
} from "./brush/studio-ink-envelope-codec";
import {
  STUDIO_TOONINK_CONFORMANCE_CAPABILITIES,
  STUDIO_TOONINK_SELF_CERTIFICATION_ID,
  STUDIO_TOONINK_SELF_CERTIFICATION_VERSION,
  STUDIO_TOONINK_VERIFIED_BADGE,
  verifyStudioToonInkSelfCertification,
} from "./studio-toonink-self-certification";

function documentInput() {
  const timestamp = "2026-07-30T00:00:00.000Z";
  return {
    format: {
      id: "toonspectrum.ink-document",
      version: 1,
    },
    document: {
      id: "ink:self-certification",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    payload: {
      type: "ink-document",
      data: {
        strokes: [{ id: "stroke:1", brushId: "g-pen" }],
      },
    },
    extensions: {},
  };
}

describe("ToonInk self-certification", () => {
  it("issues an unsigned conformance receipt without a verified badge", async () => {
    const encoded = await encodeStudioInkEnvelope(documentInput());
    const receipt = await verifyStudioToonInkSelfCertification(encoded);

    expect(receipt).toMatchObject({
      report: {
        id: STUDIO_TOONINK_SELF_CERTIFICATION_ID,
        version: STUDIO_TOONINK_SELF_CERTIFICATION_VERSION,
      },
      result: {
        conformance: "passed",
        integrity: "verified",
        attestation: "not-present",
        badge: null,
        keyId: null,
      },
      error: null,
    });
    expect(receipt.result.contentDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.profile.capabilities).toEqual(
      STUDIO_TOONINK_CONFORMANCE_CAPABILITIES
    );
    expect(receipt.limitations.join(" ")).toContain(
      "does not prove copyright ownership"
    );
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it("awards the ToonSpectrum badge only after a configured verifier accepts the signature", async () => {
    const encoded = await encodeStudioInkEnvelope(documentInput(), {
      attester: {
        algorithm: "ed25519",
        keyId: "studio.release-key:2026-07",
        sign: () => "c2VsZi1jZXJ0aWZpY2F0aW9u",
      },
    });
    const verify = vi.fn(() => true);
    const verifier: StudioInkEnvelopeAttestationVerifier = { verify };

    const receipt = await verifyStudioToonInkSelfCertification(encoded, {
      requireAttestation: true,
      attestationVerifier: verifier,
    });

    expect(receipt.result).toMatchObject({
      conformance: "passed",
      integrity: "verified",
      attestation: "verified",
      badge: STUDIO_TOONINK_VERIFIED_BADGE,
      keyId: "studio.release-key:2026-07",
    });
    expect(verify).toHaveBeenCalledOnce();
  });

  it("fails closed for signed files when no trust verifier is configured", async () => {
    const encoded = await encodeStudioInkEnvelope(documentInput(), {
      attester: {
        algorithm: "ed25519",
        keyId: "studio.release-key:2026-07",
        sign: () => "c2lnbmF0dXJl",
      },
    });

    const receipt = await verifyStudioToonInkSelfCertification(encoded);
    expect(receipt.result).toEqual({
      conformance: "rejected",
      integrity: "unverified",
      attestation: "unverified",
      badge: null,
      contentDigest: null,
      keyId: null,
    });
    expect(receipt.error?.code).toBe("ATTESTATION_UNVERIFIED");
  });

  it("never badges tampered input", async () => {
    const encoded = await encodeStudioInkEnvelope(documentInput());
    const serialized = new TextDecoder().decode(encoded);
    const tampered = new TextEncoder().encode(
      serialized.replace("g-pen", "x-pen")
    );

    const receipt = await verifyStudioToonInkSelfCertification(tampered);
    expect(receipt.result.badge).toBeNull();
    expect(receipt.result.conformance).toBe("rejected");
    expect(receipt.result.integrity).toBe("unverified");
    expect(receipt.error?.code).toBe("INTEGRITY_MISMATCH");
  });

  it("rejects future profiles and unknown capabilities before decoding", async () => {
    const malformedSource = new Uint8Array();
    const future = await verifyStudioToonInkSelfCertification(
      malformedSource,
      {
        request: {
          id: STUDIO_TOONINK_SELF_CERTIFICATION_ID,
          version: STUDIO_TOONINK_SELF_CERTIFICATION_VERSION + 1,
          requiredCapabilities: [],
        },
      }
    );
    expect(future.error?.code).toBe("UNKNOWN_FUTURE_PROFILE_VERSION");

    const unknownCapability = await verifyStudioToonInkSelfCertification(
      malformedSource,
      {
        request: {
          id: STUDIO_TOONINK_SELF_CERTIFICATION_ID,
          version: STUDIO_TOONINK_SELF_CERTIFICATION_VERSION,
          requiredCapabilities: ["future-neural-ink-v9"],
        },
      }
    );
    expect(unknownCapability.error?.code).toBe("UNSUPPORTED_CAPABILITY");
  });

  it("requires exact request structure and unique capabilities", async () => {
    const encoded = await encodeStudioInkEnvelope(documentInput());
    const duplicate = await verifyStudioToonInkSelfCertification(encoded, {
      request: {
        id: STUDIO_TOONINK_SELF_CERTIFICATION_ID,
        version: STUDIO_TOONINK_SELF_CERTIFICATION_VERSION,
        requiredCapabilities: [
          "sha256-integrity-v1",
          "sha256-integrity-v1",
        ],
      },
    });
    expect(duplicate.error?.code).toBe("INVALID_CONFORMANCE_REQUEST");

    const unknownField = await verifyStudioToonInkSelfCertification(encoded, {
      request: {
        id: STUDIO_TOONINK_SELF_CERTIFICATION_ID,
        version: STUDIO_TOONINK_SELF_CERTIFICATION_VERSION,
        requiredCapabilities: [],
        vendorCertification: "wacom",
      },
    });
    expect(unknownField.error?.code).toBe("INVALID_CONFORMANCE_REQUEST");
  });
});
