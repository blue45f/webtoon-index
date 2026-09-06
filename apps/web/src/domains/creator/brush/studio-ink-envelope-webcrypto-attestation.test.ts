import { describe, expect, it } from "vitest";

import {
  StudioInkEnvelopeError,
  decodeStudioInkEnvelope,
  encodeStudioInkEnvelope,
} from "./studio-ink-envelope-codec";
import {
  StudioInkEnvelopeWebCryptoError,
  createStudioInkEnvelopeWebCryptoAttester,
  createStudioInkEnvelopeWebCryptoVerifier,
} from "./studio-ink-envelope-webcrypto-attestation";

function input() {
  return {
    format: { id: "toonspectrum.ink-document", version: 1 },
    document: {
      id: "ink:webcrypto-test",
      revision: 1,
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z",
    },
    payload: {
      type: "ink-document",
      data: {
        brushContract: "g-pen-v3",
        inputProvenance: "pointer-events-level-3-v1",
      },
    },
    extensions: {},
  };
}

async function p256KeyPair(): Promise<CryptoKeyPair> {
  const generated = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  );
  if (!("privateKey" in generated)) {
    throw new Error("Expected a P-256 CryptoKeyPair.");
  }
  return generated;
}

const P256_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
);
const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const BIGINT_EIGHT = BigInt(8);
const BIGINT_BYTE_MASK = BigInt(255);

function base64UrlBytes(value: string): Uint8Array {
  const padding = (4 - (value.length % 4)) % 4;
  const binary = atob(
    value.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat(padding)
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesBase64Url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function scalar(bytes: Uint8Array): bigint {
  let value = BIGINT_ZERO;
  for (const byte of bytes) {
    value = (value << BIGINT_EIGHT) | BigInt(byte);
  }
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

function parsedSignedEnvelope(bytes: Uint8Array): {
  manifest: {
    attestation: {
      algorithm: string;
      keyId: string;
      signature: string;
    };
  };
} {
  return JSON.parse(new TextDecoder().decode(bytes)) as {
    manifest: {
      attestation: {
        algorithm: string;
        keyId: string;
        signature: string;
      };
    };
  };
}

describe("InkEnvelope Web Crypto attestation", () => {
  it("signs and verifies a canonical envelope with an owned P-256 key", async () => {
    const keys = await p256KeyPair();
    const attester = createStudioInkEnvelopeWebCryptoAttester({
      algorithm: "ecdsa-p256-sha256",
      keyId: "studio.release-key:2026-07",
      privateKey: keys.privateKey,
    });
    const verifier = createStudioInkEnvelopeWebCryptoVerifier({
      resolvePublicKey(algorithm, keyId) {
        return algorithm === "ecdsa-p256-sha256" &&
          keyId === "studio.release-key:2026-07"
          ? keys.publicKey
          : null;
      },
    });

    const encoded = await encodeStudioInkEnvelope(input(), { attester });
    const decoded = await decodeStudioInkEnvelope(encoded, {
      requireAttestation: true,
      attestationVerifier: verifier,
    });

    expect(decoded.manifest.attestation).toMatchObject({
      algorithm: "ecdsa-p256-sha256",
      keyId: "studio.release-key:2026-07",
    });
    expect(decoded.manifest.attestation?.signature).toMatch(
      /^[A-Za-z0-9_-]+$/u
    );
    const signature = base64UrlBytes(
      decoded.manifest.attestation?.signature ?? ""
    );
    expect(signature).toHaveLength(64);
    expect(scalar(signature.subarray(32))).toBeLessThanOrEqual(
      P256_ORDER >> BIGINT_ONE
    );
  });

  it("binds algorithm and key id into the signed message", async () => {
    const keys = await p256KeyPair();
    const encoded = await encodeStudioInkEnvelope(input(), {
      attester: createStudioInkEnvelopeWebCryptoAttester({
        algorithm: "ecdsa-p256-sha256",
        keyId: "studio.release-key:2026-07",
        privateKey: keys.privateKey,
      }),
    });
    const relabeled = parsedSignedEnvelope(encoded);
    relabeled.manifest.attestation.keyId = "studio.release-key:2026-08";
    const verifier = createStudioInkEnvelopeWebCryptoVerifier({
      resolvePublicKey: () => keys.publicKey,
    });

    await expect(
      decodeStudioInkEnvelope(
        new TextEncoder().encode(JSON.stringify(relabeled)),
        { attestationVerifier: verifier }
      )
    ).rejects.toMatchObject({
      code: "ATTESTATION_INVALID",
    } satisfies Partial<StudioInkEnvelopeError>);
  });

  it("normalizes P-256 signatures to low-S and rejects the malleable high-S twin", async () => {
    const keys = await p256KeyPair();
    const encoded = await encodeStudioInkEnvelope(input(), {
      attester: createStudioInkEnvelopeWebCryptoAttester({
        algorithm: "ecdsa-p256-sha256",
        keyId: "studio.release-key:2026-07",
        privateKey: keys.privateKey,
      }),
    });
    const malleated = parsedSignedEnvelope(encoded);
    const signature = base64UrlBytes(
      malleated.manifest.attestation.signature
    );
    const lowS = scalar(signature.subarray(32));
    signature.set(scalarBytes(P256_ORDER - lowS), 32);
    malleated.manifest.attestation.signature = bytesBase64Url(signature);
    const verifier = createStudioInkEnvelopeWebCryptoVerifier({
      resolvePublicKey: () => keys.publicKey,
    });

    await expect(
      decodeStudioInkEnvelope(
        new TextEncoder().encode(JSON.stringify(malleated)),
        { attestationVerifier: verifier }
      )
    ).rejects.toMatchObject({
      code: "ATTESTATION_INVALID",
    } satisfies Partial<StudioInkEnvelopeError>);
  });

  it("rejects a valid signature when it is checked against a different trust key", async () => {
    const signerKeys = await p256KeyPair();
    const otherKeys = await p256KeyPair();
    const encoded = await encodeStudioInkEnvelope(input(), {
      attester: createStudioInkEnvelopeWebCryptoAttester({
        algorithm: "ecdsa-p256-sha256",
        keyId: "studio.release-key:2026-07",
        privateKey: signerKeys.privateKey,
      }),
    });
    const verifier = createStudioInkEnvelopeWebCryptoVerifier({
      resolvePublicKey: () => otherKeys.publicKey,
    });

    await expect(
      decodeStudioInkEnvelope(encoded, {
        attestationVerifier: verifier,
      })
    ).rejects.toMatchObject({
      code: "ATTESTATION_INVALID",
    } satisfies Partial<StudioInkEnvelopeError>);
  });

  it("fails at configuration time for a mismatched private key algorithm", async () => {
    const keys = await p256KeyPair();
    expect(() =>
      createStudioInkEnvelopeWebCryptoAttester({
        algorithm: "ed25519",
        keyId: "studio.release-key:2026-07",
        privateKey: keys.privateKey,
      })
    ).toThrow(StudioInkEnvelopeWebCryptoError);
  });

  it("does not emit a malformed signature returned by a custom Ed25519 runtime", async () => {
    const keys = await crypto.subtle.generateKey(
      "Ed25519",
      false,
      ["sign", "verify"]
    );
    if (!("privateKey" in keys)) {
      throw new Error("Expected an Ed25519 CryptoKeyPair.");
    }
    const subtle = {
      sign: async () => Uint8Array.of(1).buffer,
    } as unknown as SubtleCrypto;
    const attester = createStudioInkEnvelopeWebCryptoAttester({
      algorithm: "ed25519",
      keyId: "studio.release-key:malformed-runtime",
      privateKey: keys.privateKey,
      subtle,
    });

    await expect(attester.sign(Uint8Array.of(1, 2, 3))).rejects.toThrow(
      StudioInkEnvelopeWebCryptoError
    );
  });
});
