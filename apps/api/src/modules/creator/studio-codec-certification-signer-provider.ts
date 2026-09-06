import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  type KeyObject,
  verify as verifyWithPublicKey,
} from "node:crypto";

import { z } from "zod";

import {
  STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS,
} from "../../../../web/src/domains/creator/studio-product-codec-certification";

import type {
  StudioCodecCertificationAuthorityAlgorithm,
  StudioCodecCertificationAuthoritySigner,
} from "./studio-codec-certification-authority.service";

const MAX_IDENTIFIER_CODE_UNITS = 128;
const MAX_RESOURCE_ID_CODE_UNITS = 512;
const MAX_SCOPES = 64;
const MAX_CLOCK_SKEW_MS = 60 * 1_000;
const SIGNATURE_BYTES = 64;
const ECDSA_P256_SCALAR_BYTES = 32;
const ECDSA_P256_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
);
const ECDSA_P256_HALF_ORDER = ECDSA_P256_ORDER >> BigInt(1);
const READINESS_DOMAIN =
  "toonspectrum:codec-certification-signer-readiness:v1";
const TEXT_ENCODER = new TextEncoder();

export const STUDIO_CODEC_CERTIFICATION_SIGNER_CONFIG_VERSION = 1 as const;
export const STUDIO_CODEC_CERTIFICATION_SIGNER_CONFIG_KIND =
  "toonspectrum-codec-certification-signer-config" as const;

const IdentifierSchema = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_CODE_UNITS)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$/u);
const ResourceIdSchema = z
  .string()
  .min(8)
  .max(MAX_RESOURCE_ID_CODE_UNITS)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{7,511}$/u);
const ScopeSchema = z
  .string()
  .min(3)
  .max(STUDIO_PRODUCT_CODEC_CERTIFICATION_LIMITS.maxScopeCodeUnits)
  .regex(/^[a-z][a-z0-9]*(?:[.:/_-][a-z0-9]+)+$/u);
const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const TimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .refine((value) => {
    const epoch = Date.parse(value);
    return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
  });
const CommonConfigShape = {
  schemaVersion: z.literal(STUDIO_CODEC_CERTIFICATION_SIGNER_CONFIG_VERSION),
  kind: z.literal(STUDIO_CODEC_CERTIFICATION_SIGNER_CONFIG_KIND),
  keyId: IdentifierSchema,
  keyResourceId: ResourceIdSchema,
  immutableKeyVersion: IdentifierSchema,
  publicKeySpkiSha256: Sha256Schema,
  scopes: z
    .array(ScopeSchema)
    .min(1)
    .max(MAX_SCOPES)
    .refine((value) => new Set(value).size === value.length),
  validFrom: TimestampSchema,
  validUntil: TimestampSchema,
  requestTimeoutMs: z.number().int().min(100).max(60_000),
} as const;

const AwsKmsConfigSchema = z
  .object({
    ...CommonConfigShape,
    adapterKind: z.literal("kms"),
    provider: z.literal("aws-kms"),
    algorithm: z.literal("ecdsa-p256-sha256"),
    region: z
      .string()
      .regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u),
    signingAlgorithm: z.literal("ECDSA_SHA_256"),
    messageType: z.literal("RAW"),
  })
  .strict();
const GcpKmsConfigSchema = z
  .object({
    ...CommonConfigShape,
    adapterKind: z.literal("kms"),
    provider: z.literal("gcp-cloud-kms"),
    algorithm: z.literal("ecdsa-p256-sha256"),
    location: IdentifierSchema,
    signingAlgorithm: z.literal("EC_SIGN_P256_SHA256"),
  })
  .strict();
const AzureKeyVaultConfigSchema = z
  .object({
    ...CommonConfigShape,
    adapterKind: z.literal("kms"),
    provider: z.literal("azure-key-vault"),
    algorithm: z.literal("ecdsa-p256-sha256"),
    vaultUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:"
          && url.username === ""
          && url.password === ""
          && url.search === ""
          && url.hash === ""
        );
      }),
    signingAlgorithm: z.literal("ES256"),
  })
  .strict();
const Pkcs11HsmConfigSchema = z
  .object({
    ...CommonConfigShape,
    adapterKind: z.literal("hsm"),
    provider: z.literal("pkcs11-hsm"),
    algorithm: z.enum(["ed25519", "ecdsa-p256-sha256"]),
    moduleRegistryId: IdentifierSchema,
    slotId: IdentifierSchema,
    keyLabel: IdentifierSchema,
    signingMechanism: z.enum(["CKM_EDDSA", "CKM_ECDSA"]),
  })
  .strict()
  .superRefine((config, context) => {
    const expected = config.algorithm === "ed25519"
      ? "CKM_EDDSA"
      : "CKM_ECDSA";
    if (config.signingMechanism !== expected) {
      context.addIssue({
        code: "custom",
        path: ["signingMechanism"],
        message: "PKCS#11 mechanism does not match the configured algorithm.",
      });
    }
  });

export const StudioCodecCertificationSignerProviderConfigSchema =
  z.discriminatedUnion("provider", [
    AwsKmsConfigSchema,
    GcpKmsConfigSchema,
    AzureKeyVaultConfigSchema,
    Pkcs11HsmConfigSchema,
  ]).superRefine((config, context) => {
    if (Date.parse(config.validFrom) >= Date.parse(config.validUntil)) {
      context.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "Signer validity range is invalid.",
      });
    }
  });

export type StudioCodecCertificationSignerProviderConfig = z.infer<
  typeof StudioCodecCertificationSignerProviderConfigSchema
>;

export interface StudioCodecCertificationSignerProviderFactory {
  /**
   * Resolves credentials through workload identity, managed identity, or an
   * HSM session broker. Config deliberately has no secret/PIN/private-key field.
   */
  readonly create: (
    config: StudioCodecCertificationSignerProviderConfig,
    signal: AbortSignal
  ) => Promise<Readonly<{
    signer: StudioCodecCertificationAuthoritySigner;
    /** Version resolved by the provider response, not echoed from config. */
    immutableKeyVersion: string;
    /** Exact DER SubjectPublicKeyInfo returned by KMS/HSM key inspection. */
    publicKeySpkiDer: Uint8Array;
  }>>;
}

export interface StudioCodecCertificationSignerReadiness {
  readonly ready: true;
  readonly provider: StudioCodecCertificationSignerProviderConfig["provider"];
  readonly adapterKind: "kms" | "hsm";
  readonly algorithm: StudioCodecCertificationAuthorityAlgorithm;
  readonly keyId: string;
  readonly immutableKeyVersion: string;
  readonly publicKeySpkiSha256: `sha256:${string}`;
  readonly configSha256: `sha256:${string}`;
  readonly checkedAt: string;
}

export type StudioCodecCertificationSignerProviderErrorCode =
  | "ABORTED"
  | "INVALID_CONFIG"
  | "PROVIDER_FAILED"
  | "PROVIDER_MISMATCH"
  | "READINESS_SIGNATURE_INVALID";

const ERROR_MESSAGES = Object.freeze({
  ABORTED: "Codec certification signer readiness was aborted.",
  INVALID_CONFIG: "Codec certification signer configuration is invalid.",
  PROVIDER_FAILED: "Codec certification signer provider failed closed.",
  PROVIDER_MISMATCH:
    "Codec certification signer provider does not match its pinned configuration.",
  READINESS_SIGNATURE_INVALID:
    "Codec certification signer failed its cryptographic readiness challenge.",
} satisfies Record<
  StudioCodecCertificationSignerProviderErrorCode,
  string
>);

export class StudioCodecCertificationSignerProviderError extends Error {
  readonly code: StudioCodecCertificationSignerProviderErrorCode;

  constructor(code: StudioCodecCertificationSignerProviderErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "StudioCodecCertificationSignerProviderError";
    this.code = code;
  }
}

function fail(code: StudioCodecCertificationSignerProviderErrorCode): never {
  throw new StudioCodecCertificationSignerProviderError(code);
}

function canonicalJson(
  value: boolean | null | number | string | readonly unknown[] | object
): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) =>
      canonicalJson(entry as never)).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key] as never)}`)
    .join(",")}}`;
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length
    && left.every((entry, index) => entry === right[index])
  );
}

function bigintFromBigEndian(bytes: Uint8Array): bigint {
  let value = BigInt(0);
  for (const byte of bytes) value = (value << BigInt(8)) | BigInt(byte);
  return value;
}

function canonicalSignatureShape(
  algorithm: StudioCodecCertificationAuthorityAlgorithm,
  bytes: Uint8Array
): boolean {
  if (bytes.byteLength !== SIGNATURE_BYTES) return false;
  if (algorithm === "ed25519") return true;
  const r = bigintFromBigEndian(bytes.subarray(0, ECDSA_P256_SCALAR_BYTES));
  const s = bigintFromBigEndian(bytes.subarray(ECDSA_P256_SCALAR_BYTES));
  return (
    r > BigInt(0)
    && r < ECDSA_P256_ORDER
    && s > BigInt(0)
    && s <= ECDSA_P256_HALF_ORDER
  );
}

function sameDigest(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.byteLength === rightBytes.byteLength
    && timingSafeEqual(leftBytes, rightBytes)
  );
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength
    && timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

function publicKeyMatchesAlgorithm(
  publicKey: KeyObject,
  algorithm: StudioCodecCertificationAuthorityAlgorithm
): boolean {
  if (algorithm === "ed25519") {
    return publicKey.asymmetricKeyType === "ed25519";
  }
  const namedCurve = publicKey.asymmetricKeyDetails?.namedCurve;
  return (
    publicKey.asymmetricKeyType === "ec"
    && (
      namedCurve === "P-256"
      || namedCurve === "prime256v1"
      || namedCurve === "secp256r1"
    )
  );
}

function independentlyVerifyReadinessSignature(
  algorithm: StudioCodecCertificationAuthorityAlgorithm,
  publicKey: KeyObject,
  challenge: Uint8Array,
  signature: Uint8Array
): boolean {
  try {
    if (algorithm === "ed25519") {
      return verifyWithPublicKey(
        null,
        Buffer.from(challenge),
        publicKey,
        Buffer.from(signature)
      );
    }
    return verifyWithPublicKey(
      "sha256",
      Buffer.from(challenge),
      {
        key: publicKey,
        dsaEncoding: "ieee-p1363",
      },
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

function runBoundedProviderPhase<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  externalSignal: AbortSignal,
  timeoutMs: number
): Promise<T> {
  if (externalSignal.aborted) {
    return Promise.reject(
      new StudioCodecCertificationSignerProviderError("ABORTED")
    );
  }
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      externalSignal.removeEventListener("abort", abortExternally);
    };
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const terminate = (
      code: Extract<
        StudioCodecCertificationSignerProviderErrorCode,
        "ABORTED" | "PROVIDER_FAILED"
      >
    ) => {
      settle(() => {
        controller.abort();
        reject(new StudioCodecCertificationSignerProviderError(code));
      });
    };
    const abortExternally = () => terminate("ABORTED");

    externalSignal.addEventListener("abort", abortExternally, { once: true });
    if (externalSignal.aborted) {
      abortExternally();
      return;
    }
    timer = setTimeout(() => terminate("PROVIDER_FAILED"), timeoutMs);
    timer.unref?.();

    const running = Promise.resolve().then(() => operation(controller.signal));
    void running.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error))
    );
  });
}

/**
 * Loads the deployment adapter and proves that the pinned key can sign and
 * verify an exact domain-separated challenge before the authority is exposed.
 */
export async function verifyStudioCodecCertificationSignerReadiness(
  source: unknown,
  factory: StudioCodecCertificationSignerProviderFactory,
  options: Readonly<{
    signal?: AbortSignal;
    nowEpochMs?: number;
  }> = {}
): Promise<StudioCodecCertificationSignerReadiness> {
  let configResult: ReturnType<
    typeof StudioCodecCertificationSignerProviderConfigSchema.safeParse
  >;
  try {
    configResult =
      StudioCodecCertificationSignerProviderConfigSchema.safeParse(source);
  } catch {
    return fail("INVALID_CONFIG");
  }
  if (!configResult.success) fail("INVALID_CONFIG");
  const config = configResult.data;
  const nowEpochMs = options.nowEpochMs ?? Date.now();
  if (
    !Number.isSafeInteger(nowEpochMs)
    || nowEpochMs < 0
    || Date.parse(config.validFrom) > nowEpochMs + MAX_CLOCK_SKEW_MS
    || Date.parse(config.validUntil) <= nowEpochMs
  ) {
    fail("INVALID_CONFIG");
  }
  const signal = options.signal ?? new AbortController().signal;
  if (signal.aborted) fail("ABORTED");

  let resolved: Awaited<
    ReturnType<StudioCodecCertificationSignerProviderFactory["create"]>
  >;
  try {
    resolved = await runBoundedProviderPhase(
      (phaseSignal) => factory.create(config, phaseSignal),
      signal,
      config.requestTimeoutMs
    );
  } catch (error) {
    if (error instanceof StudioCodecCertificationSignerProviderError) {
      throw error;
    }
    if (signal.aborted) return fail("ABORTED");
    return fail("PROVIDER_FAILED");
  }
  let signer: StudioCodecCertificationAuthoritySigner;
  let metadata: Readonly<{
    adapterKind: "kms" | "hsm";
    algorithm: StudioCodecCertificationAuthorityAlgorithm;
    keyId: string;
    scopes: readonly string[];
    validFrom: string;
    validUntil: string;
  }>;
  try {
    signer = resolved.signer;
    metadata = {
      adapterKind: signer.adapterKind,
      algorithm: signer.algorithm,
      keyId: signer.keyId,
      scopes: [...signer.scopes],
      validFrom: signer.validFrom,
      validUntil: signer.validUntil,
    };
  } catch {
    return fail("PROVIDER_MISMATCH");
  }
  let inspectedSpkiSha256: `sha256:${string}`;
  let pinnedPublicKey: KeyObject;
  try {
    if (
      typeof resolved.immutableKeyVersion !== "string"
      || !(resolved.publicKeySpkiDer instanceof Uint8Array)
      || resolved.publicKeySpkiDer.byteLength < 32
      || resolved.publicKeySpkiDer.byteLength > 16 * 1_024
    ) {
      fail("PROVIDER_MISMATCH");
    }
    const publicKeySpkiDer = Uint8Array.from(resolved.publicKeySpkiDer);
    inspectedSpkiSha256 = sha256(publicKeySpkiDer);
    pinnedPublicKey = createPublicKey({
      key: Buffer.from(publicKeySpkiDer),
      format: "der",
      type: "spki",
    });
    const canonicalSpkiDer = Uint8Array.from(
      pinnedPublicKey.export({
        format: "der",
        type: "spki",
      })
    );
    if (
      !sameBytes(publicKeySpkiDer, canonicalSpkiDer)
      || !publicKeyMatchesAlgorithm(pinnedPublicKey, config.algorithm)
    ) {
      fail("PROVIDER_MISMATCH");
    }
  } catch (error) {
    if (error instanceof StudioCodecCertificationSignerProviderError) {
      throw error;
    }
    return fail("PROVIDER_MISMATCH");
  }
  if (
    metadata.adapterKind !== config.adapterKind
    || metadata.algorithm !== config.algorithm
    || metadata.keyId !== config.keyId
    || !sameStringArray(metadata.scopes, config.scopes)
    || metadata.validFrom !== config.validFrom
    || metadata.validUntil !== config.validUntil
    || resolved.immutableKeyVersion !== config.immutableKeyVersion
    || !sameDigest(inspectedSpkiSha256, config.publicKeySpkiSha256)
    || typeof signer.sign !== "function"
    || typeof signer.verify !== "function"
  ) {
    fail("PROVIDER_MISMATCH");
  }

  const configBytes = TEXT_ENCODER.encode(canonicalJson(config));
  const configSha256 = sha256(configBytes);
  const challenge = TEXT_ENCODER.encode(
    `${READINESS_DOMAIN}\u0000${configSha256}\u0000${new Date(
      nowEpochMs
    ).toISOString()}`
  );
  const challengeSha256 = sha256(challenge);
  let rawSignature: Uint8Array;
  try {
    const returned = await runBoundedProviderPhase(
      (phaseSignal) =>
        signer.sign({
          algorithm: config.algorithm,
          keyId: config.keyId,
          scope: config.scopes[0] as string,
          canonicalBytes: Uint8Array.from(challenge),
          canonicalByteLength: challenge.byteLength,
          canonicalSha256: challengeSha256,
          signal: phaseSignal,
        }),
      signal,
      config.requestTimeoutMs
    );
    if (!(returned instanceof Uint8Array)) {
      fail("READINESS_SIGNATURE_INVALID");
    }
    rawSignature = Uint8Array.from(returned);
  } catch (error) {
    if (error instanceof StudioCodecCertificationSignerProviderError) {
      throw error;
    }
    if (signal.aborted) fail("ABORTED");
    return fail("PROVIDER_FAILED");
  }
  if (!canonicalSignatureShape(config.algorithm, rawSignature)) {
    fail("READINESS_SIGNATURE_INVALID");
  }
  if (
    !independentlyVerifyReadinessSignature(
      config.algorithm,
      pinnedPublicKey,
      challenge,
      rawSignature
    )
  ) {
    fail("READINESS_SIGNATURE_INVALID");
  }

  return Object.freeze({
    ready: true,
    provider: config.provider,
    adapterKind: config.adapterKind,
    algorithm: config.algorithm,
    keyId: config.keyId,
    immutableKeyVersion: config.immutableKeyVersion,
    publicKeySpkiSha256:
      config.publicKeySpkiSha256 as `sha256:${string}`,
    configSha256,
    checkedAt: new Date(nowEpochMs).toISOString(),
  });
}

/** Prevent accidental credential-shaped additions from passing review. */
export function studioCodecCertificationSignerConfigHasNoSecrets(
  source: unknown
): boolean {
  const result = StudioCodecCertificationSignerProviderConfigSchema.safeParse(
    source
  );
  if (!result.success) return false;
  const forbidden = /(?:credential|private.?key|secret|token|password|pin)/iu;
  return !Object.keys(source as object).some((key) => forbidden.test(key));
}
