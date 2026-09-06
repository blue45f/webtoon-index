/**
 * Standards-only cryptographic attestation adapter for ToonSpectrum InkEnvelope.
 *
 * Keys remain caller-owned: this module never exports, persists, identifies, or uploads key
 * material. Production trust policy (release keys, organization CAs, key rotation, revocation) is
 * intentionally outside the codec. The implementation uses Web Crypto Ed25519 or ECDSA P-256 and
 * unpadded canonical base64url, so browser and server deployments can share one verifier contract.
 */

import type {
  StudioInkEnvelopeAttestationVerifier,
  StudioInkEnvelopeAttester,
} from "./studio-ink-envelope-codec";

export type StudioInkEnvelopeWebCryptoAlgorithm =
  | "ed25519"
  | "ecdsa-p256-sha256";

export class StudioInkEnvelopeWebCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioInkEnvelopeWebCryptoError";
  }
}

export interface StudioInkEnvelopeWebCryptoAttesterOptions {
  readonly algorithm: StudioInkEnvelopeWebCryptoAlgorithm;
  readonly keyId: string;
  readonly privateKey: CryptoKey;
  readonly subtle?: SubtleCrypto;
}

export interface StudioInkEnvelopeWebCryptoVerifierOptions {
  readonly resolvePublicKey: (
    algorithm: StudioInkEnvelopeWebCryptoAlgorithm,
    keyId: string
  ) => CryptoKey | null | Promise<CryptoKey | null>;
  readonly subtle?: SubtleCrypto;
}

const ECDSA_P256_SCALAR_BYTES = 32;
const ECDSA_P256_SIGNATURE_BYTES = ECDSA_P256_SCALAR_BYTES * 2;
const ED25519_SIGNATURE_BYTES = 64;
const ECDSA_P256_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
);
const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const BIGINT_EIGHT = BigInt(8);
const BIGINT_BYTE_MASK = BigInt(255);
const ECDSA_P256_HALF_ORDER = ECDSA_P256_ORDER >> BIGINT_ONE;

function subtleCrypto(override: SubtleCrypto | undefined): SubtleCrypto {
  const subtle = override ?? globalThis.crypto?.subtle;
  if (!subtle) {
    throw new StudioInkEnvelopeWebCryptoError(
      "Web Crypto SubtleCrypto is unavailable."
    );
  }
  return subtle;
}

function algorithmIdentifier(
  algorithm: StudioInkEnvelopeWebCryptoAlgorithm
): AlgorithmIdentifier | EcdsaParams {
  return algorithm === "ed25519"
    ? "Ed25519"
    : { name: "ECDSA", hash: "SHA-256" };
}

function keyMatchesAlgorithm(
  key: CryptoKey,
  algorithm: StudioInkEnvelopeWebCryptoAlgorithm,
  type: "private" | "public",
  usage: KeyUsage
): boolean {
  if (key.type !== type || !key.usages.includes(usage)) return false;
  if (algorithm === "ed25519") {
    return key.algorithm.name.toLowerCase() === "ed25519";
  }
  const ec = key.algorithm as EcKeyAlgorithm;
  return ec.name === "ECDSA" && ec.namedCurve === "P-256";
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize)
    );
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (
    !/^[A-Za-z0-9_-]+$/u.test(value) ||
    value.length % 4 === 1
  ) {
    return null;
  }
  const padding = (4 - (value.length % 4)) % 4;
  try {
    const binary = atob(
      value.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat(padding)
    );
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0)
    );
    return base64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

function bigIntFromBigEndian(bytes: Uint8Array): bigint {
  let value = BIGINT_ZERO;
  for (const byte of bytes) {
    value = (value << BIGINT_EIGHT) | BigInt(byte);
  }
  return value;
}

function fixedBigEndian(value: bigint, byteLength: number): Uint8Array {
  const output = new Uint8Array(byteLength);
  let remainder = value;
  for (let index = output.length - 1; index >= 0; index -= 1) {
    output[index] = Number(remainder & BIGINT_BYTE_MASK);
    remainder >>= BIGINT_EIGHT;
  }
  if (remainder !== BIGINT_ZERO) {
    throw new StudioInkEnvelopeWebCryptoError(
      "InkEnvelope ECDSA scalar exceeds the P-256 field width."
    );
  }
  return output;
}

function normalizedLowSEcdsaP256Signature(
  signature: Uint8Array
): Uint8Array {
  if (signature.byteLength !== ECDSA_P256_SIGNATURE_BYTES) {
    throw new StudioInkEnvelopeWebCryptoError(
      "InkEnvelope ECDSA signature is not the Web Crypto P-256 raw format."
    );
  }
  const r = bigIntFromBigEndian(
    signature.subarray(0, ECDSA_P256_SCALAR_BYTES)
  );
  const originalS = bigIntFromBigEndian(
    signature.subarray(ECDSA_P256_SCALAR_BYTES)
  );
  if (
    r <= BIGINT_ZERO ||
    r >= ECDSA_P256_ORDER ||
    originalS <= BIGINT_ZERO ||
    originalS >= ECDSA_P256_ORDER
  ) {
    throw new StudioInkEnvelopeWebCryptoError(
      "InkEnvelope ECDSA signature contains an invalid P-256 scalar."
    );
  }
  const s = originalS > ECDSA_P256_HALF_ORDER
    ? ECDSA_P256_ORDER - originalS
    : originalS;
  const output = new Uint8Array(ECDSA_P256_SIGNATURE_BYTES);
  output.set(
    fixedBigEndian(r, ECDSA_P256_SCALAR_BYTES),
    0
  );
  output.set(
    fixedBigEndian(s, ECDSA_P256_SCALAR_BYTES),
    ECDSA_P256_SCALAR_BYTES
  );
  return output;
}

function signatureHasCanonicalShape(
  algorithm: StudioInkEnvelopeWebCryptoAlgorithm,
  signature: Uint8Array
): boolean {
  if (algorithm === "ed25519") {
    return signature.byteLength === ED25519_SIGNATURE_BYTES;
  }
  try {
    const normalized = normalizedLowSEcdsaP256Signature(signature);
    return normalized.every((byte, index) => byte === signature[index]);
  } catch {
    return false;
  }
}

export function createStudioInkEnvelopeWebCryptoAttester(
  options: StudioInkEnvelopeWebCryptoAttesterOptions
): StudioInkEnvelopeAttester {
  const subtle = subtleCrypto(options.subtle);
  if (
    !keyMatchesAlgorithm(
      options.privateKey,
      options.algorithm,
      "private",
      "sign"
    )
  ) {
    throw new StudioInkEnvelopeWebCryptoError(
      "InkEnvelope private key does not match its attestation algorithm."
    );
  }
  return Object.freeze({
    algorithm: options.algorithm,
    keyId: options.keyId,
    async sign(message: Uint8Array): Promise<string> {
      try {
        const owned = message.slice();
        const signature = await subtle.sign(
          algorithmIdentifier(options.algorithm),
          options.privateKey,
          owned
        );
        const bytes = new Uint8Array(signature);
        const canonical = options.algorithm === "ecdsa-p256-sha256"
          ? normalizedLowSEcdsaP256Signature(bytes)
          : bytes;
        if (!signatureHasCanonicalShape(options.algorithm, canonical)) {
          throw new StudioInkEnvelopeWebCryptoError(
            "InkEnvelope signer returned a non-canonical signature."
          );
        }
        return base64Url(canonical);
      } catch {
        throw new StudioInkEnvelopeWebCryptoError(
          "InkEnvelope Web Crypto signing failed."
        );
      }
    },
  });
}

function isSupportedAlgorithm(
  value: string
): value is StudioInkEnvelopeWebCryptoAlgorithm {
  return value === "ed25519" || value === "ecdsa-p256-sha256";
}

export function createStudioInkEnvelopeWebCryptoVerifier(
  options: StudioInkEnvelopeWebCryptoVerifierOptions
): StudioInkEnvelopeAttestationVerifier {
  const subtle = subtleCrypto(options.subtle);
  return Object.freeze({
    async verify(input: Readonly<{
      algorithm: string;
      keyId: string;
      message: Uint8Array;
      signature: string;
    }>): Promise<boolean> {
      if (!isSupportedAlgorithm(input.algorithm)) return false;
      const signature = decodeBase64Url(input.signature);
      if (
        !signature ||
        !signatureHasCanonicalShape(input.algorithm, signature)
      ) return false;
      let publicKey: CryptoKey | null;
      try {
        publicKey = await options.resolvePublicKey(
          input.algorithm,
          input.keyId
        );
      } catch {
        return false;
      }
      if (
        !publicKey ||
        !keyMatchesAlgorithm(publicKey, input.algorithm, "public", "verify")
      ) {
        return false;
      }
      try {
        const ownedSignature = new Uint8Array(signature.byteLength);
        ownedSignature.set(signature);
        const ownedMessage = new Uint8Array(input.message.byteLength);
        ownedMessage.set(input.message);
        return await subtle.verify(
          algorithmIdentifier(input.algorithm),
          publicKey,
          ownedSignature.buffer,
          ownedMessage.buffer
        );
      } catch {
        return false;
      }
    },
  });
}
