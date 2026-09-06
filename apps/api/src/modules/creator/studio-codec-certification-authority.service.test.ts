import { createHash } from "node:crypto";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
} from "../../../../web/src/domains/creator/studio-codec-provider-contract";
import {
  STUDIO_PRODUCT_CODEC_CERTIFICATE_DOMAIN,
  STUDIO_PRODUCT_CODEC_CERTIFICATE_ID_DOMAIN,
  STUDIO_PRODUCT_CODEC_CERTIFICATE_KIND,
  STUDIO_PRODUCT_CODEC_CERTIFICATE_VERSION,
  STUDIO_PRODUCT_CODEC_CERTIFICATION_CLAIMS,
  serializeStudioProductCodecCertificate,
  verifyStudioProductCodecCertificate,
  type StudioProductCodecCertificate,
} from "../../../../web/src/domains/creator/studio-product-codec-certification";

import {
  STUDIO_CODEC_CERTIFICATION_AUTHORITY_REQUEST_KIND,
  STUDIO_CODEC_CERTIFICATION_AUTHORITY_SIGNATURE_KIND,
  StudioCodecCertificationAuthorityError,
  StudioCodecCertificationAuthorityService,
  StudioCodecCertificationAuthoritySigningRequestSchema,
  type StudioCodecCertificationAuthorityExecutionVerifier,
  type StudioCodecCertificationAuthorityExecutionVerificationResult,
  type StudioCodecCertificationAuthoritySignature,
  type StudioCodecCertificationAuthoritySigner,
} from "./studio-codec-certification-authority.service";

type JsonValue =
  | boolean
  | null
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const TEXT_ENCODER = new TextEncoder();
const SCOPE = "codec.raster.public-clean-room";
const KEY_ID = "kms/toonspectrum/product-codec/2026-01";
const EXECUTION_ID = "codec-execution/2026-07-30/0001";
const VALID_FROM = "2026-01-01T00:00:00.000Z";
const VALID_UNTIL = "2027-01-01T00:00:00.000Z";
const AUTHORITY_NOW = Date.parse("2026-07-30T00:00:30.000Z");

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(AUTHORITY_NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(
          (value as Readonly<Record<string, JsonValue>>)[key] as JsonValue
        )}`
    )
    .join(",")}}`;
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function signingFixture() {
  const input = Uint8Array.from([1, 2, 3]);
  const output = Uint8Array.from([4, 5, 6]);
  const receipt = {
    schemaVersion: STUDIO_CODEC_PROVIDER_CONTRACT_VERSION,
    kind: "toonspectrum-codec-provider-execution",
    providerId: "toonspectrum.raster.qoi.v1",
    mode: "public-clean-room",
    direction: "encode",
    format: "qoi",
    profile: "rgba8",
    version: "1.0",
    mimeType: "image/qoi",
    extension: ".qoi",
    deterministic: true,
    input: {
      byteLength: input.byteLength,
      sha256: sha256(input),
    },
    output: {
      byteLength: output.byteLength,
      sha256: sha256(output),
    },
    licenseGrant: {
      id: "toonspectrum-public-clean-room-raster-v1",
      scope: ["public-clean-room", "commercial-use", "encode"],
      expiresAt: null,
    },
    officialClaims: {
      externalAttestationAccepted: false,
      officialCodec: false,
      certified: false,
      trademarkAuthorized: false,
    },
  };
  const receiptBytes = TEXT_ENCODER.encode(canonicalJson(receipt));
  const core = {
    certification: STUDIO_PRODUCT_CODEC_CERTIFICATION_CLAIMS,
    evidence: {
      byteLength: 4,
      sha256: sha256(Uint8Array.from([7, 8, 9, 10])),
      mediaType: "application/json",
    },
    kind: STUDIO_PRODUCT_CODEC_CERTIFICATE_KIND,
    nonce: "A".repeat(43),
    output: receipt.output,
    receipt,
    receiptSha256: sha256(receiptBytes),
    schemaVersion: STUDIO_PRODUCT_CODEC_CERTIFICATE_VERSION,
    scope: SCOPE,
    signer: {
      algorithm: "ed25519",
      keyId: KEY_ID,
    },
    validity: {
      issuedAt: "2026-07-30T00:00:00.000Z",
      notBefore: "2026-07-30T00:00:00.000Z",
      expiresAt: "2026-08-30T00:00:00.000Z",
    },
  };
  const idSource = TEXT_ENCODER.encode(
    `${STUDIO_PRODUCT_CODEC_CERTIFICATE_ID_DOMAIN}\u0000${canonicalJson(core)}`
  );
  const unsigned = {
    certificateId: `tspcc1:${sha256(idSource).slice("sha256:".length)}`,
    core,
  };
  const canonicalBytes = TEXT_ENCODER.encode(
    `${STUDIO_PRODUCT_CODEC_CERTIFICATE_DOMAIN}\u0000${canonicalJson(unsigned)}`
  );
  return {
    schemaVersion: 1 as const,
    kind: STUDIO_CODEC_CERTIFICATION_AUTHORITY_REQUEST_KIND,
    algorithm: "ed25519" as const,
    keyId: KEY_ID,
    scope: SCOPE,
    executionId: EXECUTION_ID,
    canonicalByteLength: canonicalBytes.byteLength,
    canonicalSha256: sha256(canonicalBytes),
    canonicalBytes,
  };
}

function mutuallyConsistentForgedFixture() {
  const fixture = signingFixture();
  const prefix = `${STUDIO_PRODUCT_CODEC_CERTIFICATE_DOMAIN}\u0000`;
  const decoded = new TextDecoder().decode(fixture.canonicalBytes);
  const unsigned = JSON.parse(decoded.slice(prefix.length)) as {
    certificateId: string;
    core: {
      output: {
        byteLength: number;
        sha256: string;
      };
      receipt: {
        output: {
          byteLength: number;
          sha256: string;
        };
      };
      receiptSha256: string;
    };
  };
  const forgedDigest = `sha256:${"f".repeat(64)}`;
  unsigned.core.output.sha256 = forgedDigest;
  unsigned.core.receipt.output.sha256 = forgedDigest;
  const receiptBytes = TEXT_ENCODER.encode(
    canonicalJson(unsigned.core.receipt as unknown as JsonValue)
  );
  unsigned.core.receiptSha256 = sha256(receiptBytes);
  const idBytes = TEXT_ENCODER.encode(
    `${STUDIO_PRODUCT_CODEC_CERTIFICATE_ID_DOMAIN}\u0000${canonicalJson(
      unsigned.core as unknown as JsonValue
    )}`
  );
  unsigned.certificateId =
    `tspcc1:${sha256(idBytes).slice("sha256:".length)}`;
  const canonicalBytes = TEXT_ENCODER.encode(
    `${prefix}${canonicalJson(unsigned as unknown as JsonValue)}`
  );
  return {
    ...fixture,
    canonicalByteLength: canonicalBytes.byteLength,
    canonicalSha256: sha256(canonicalBytes),
    canonicalBytes,
  };
}

function verifiedExecution(
  fixture = signingFixture()
): Extract<
  StudioCodecCertificationAuthorityExecutionVerificationResult,
  { verified: true }
> {
  const decoded = new TextDecoder().decode(fixture.canonicalBytes);
  const unsigned = JSON.parse(
    decoded.slice(`${STUDIO_PRODUCT_CODEC_CERTIFICATE_DOMAIN}\u0000`.length)
  ) as {
    core: {
      receipt: {
        providerId: string;
        mode: "public-clean-room";
        direction: "encode";
        format: string;
        profile: string;
        version: string;
        mimeType: string;
        extension: string;
        deterministic: boolean;
        input: {
          byteLength: number;
          sha256: `sha256:${string}`;
        };
        output: {
          byteLength: number;
          sha256: `sha256:${string}`;
        };
        licenseGrant: {
          id: string;
          scope: readonly (
            | "commercial-use"
            | "encode"
            | "public-clean-room"
          )[];
          expiresAt: string | null;
        };
      };
      receiptSha256: `sha256:${string}`;
      evidence: {
        byteLength: number;
        sha256: `sha256:${string}`;
        mediaType: string;
      };
    };
  };
  const receiptBytes = TEXT_ENCODER.encode(
    canonicalJson(unsigned.core.receipt as unknown as JsonValue)
  );
  return {
    verified: true,
    executionId: fixture.executionId,
    canonicalByteLength: fixture.canonicalByteLength,
    canonicalSha256: fixture.canonicalSha256,
    receiptByteLength: receiptBytes.byteLength,
    receiptSha256: unsigned.core.receiptSha256,
    outputByteLength: unsigned.core.receipt.output.byteLength,
    outputSha256: unsigned.core.receipt.output.sha256,
    evidenceByteLength: unsigned.core.evidence.byteLength,
    evidenceSha256: unsigned.core.evidence.sha256,
    evidenceMediaType: unsigned.core.evidence.mediaType,
    providerId: unsigned.core.receipt.providerId,
    mode: unsigned.core.receipt.mode,
    direction: unsigned.core.receipt.direction,
    format: unsigned.core.receipt.format,
    profile: unsigned.core.receipt.profile,
    version: unsigned.core.receipt.version,
    mimeType: unsigned.core.receipt.mimeType,
    extension: unsigned.core.receipt.extension,
    deterministic: unsigned.core.receipt.deterministic,
    inputByteLength: unsigned.core.receipt.input.byteLength,
    inputSha256: unsigned.core.receipt.input.sha256,
    licenseGrantId: unsigned.core.receipt.licenseGrant.id,
    licenseGrantScopes: [...unsigned.core.receipt.licenseGrant.scope],
    licenseGrantExpiresAt: unsigned.core.receipt.licenseGrant.expiresAt,
    authorization: {
      status: "reserved",
      reservationId: "reservation-1",
      attemptId: "attempt-1",
      admissionLeaseId: "admission-lease-1",
      expiresAt: "2026-07-30T00:06:30.000Z",
    },
  };
}

function verifier(
  verify = vi.fn(async () => verifiedExecution()),
  complete = vi.fn(async () => true)
): StudioCodecCertificationAuthorityExecutionVerifier {
  return { verify, complete };
}

function signer(
  sign = vi.fn(async () => new Uint8Array(64).fill(7)),
  verify = vi.fn(async () => true)
): StudioCodecCertificationAuthoritySigner {
  return {
    adapterKind: "kms",
    algorithm: "ed25519",
    keyId: KEY_ID,
    scopes: [SCOPE],
    validFrom: VALID_FROM,
    validUntil: VALID_UNTIL,
    sign,
    verify,
  };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof StudioCodecCertificationAuthorityError
    ? error.code
    : undefined;
}

describe("StudioCodecCertificationAuthoritySigningRequestSchema", () => {
  it("is strict and enforces bounded canonical bytes", () => {
    const valid = signingFixture();
    expect(
      StudioCodecCertificationAuthoritySigningRequestSchema.safeParse(valid)
        .success
    ).toBe(true);
    expect(
      StudioCodecCertificationAuthoritySigningRequestSchema.safeParse({
        ...valid,
        unexpected: true,
      }).success
    ).toBe(false);
    expect(
      StudioCodecCertificationAuthoritySigningRequestSchema.safeParse({
        ...valid,
        canonicalBytes: new Uint8Array(64 * 1_024 + 1),
      }).success
    ).toBe(false);
  });
});

describe("StudioCodecCertificationAuthorityService", () => {
  it("signs only the exact canonical product-certificate message", async () => {
    const fixture = signingFixture();
    const verify = vi.fn(async (request) => {
      expect(request).toMatchObject({
        executionId: fixture.executionId,
        providerId: "toonspectrum.raster.qoi.v1",
        direction: "encode",
        format: "qoi",
      });
      expect(request).not.toHaveProperty("canonicalSha256");
      return verifiedExecution(fixture);
    });
    const sign = vi.fn(async (request) => {
      expect(request.canonicalBytes).not.toBe(fixture.canonicalBytes);
      expect(request.canonicalSha256).toBe(fixture.canonicalSha256);
      expect(request.scope).toBe(SCOPE);
      return new Uint8Array(64).fill(7);
    });
    const service = new StudioCodecCertificationAuthorityService(
      signer(sign),
      verifier(verify)
    );
    const result = await service.signProductCertificateMessage(fixture);

    expect(result).toEqual({
      schemaVersion: 1,
      kind: STUDIO_CODEC_CERTIFICATION_AUTHORITY_SIGNATURE_KIND,
      algorithm: "ed25519",
      keyId: KEY_ID,
      scope: SCOPE,
      executionId: EXECUTION_ID,
      canonicalByteLength: fixture.canonicalByteLength,
      canonicalSha256: fixture.canonicalSha256,
      signatureValue: Buffer.alloc(64, 7).toString("base64url"),
    });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("produces a detached signature that the exact product certificate verifier accepts", async () => {
    const keyPair = await crypto.subtle.generateKey(
      "Ed25519",
      false,
      ["sign", "verify"]
    );
    const service = new StudioCodecCertificationAuthorityService(
      signer(
        vi.fn(async ({ canonicalBytes }) =>
          new Uint8Array(
            await crypto.subtle.sign(
              "Ed25519",
              keyPair.privateKey,
              canonicalBytes
            )
          )
        ),
        vi.fn(async ({ canonicalBytes, signatureBytes }) =>
          crypto.subtle.verify(
            "Ed25519",
            keyPair.publicKey,
            signatureBytes,
            canonicalBytes
          )
        )
      ),
      verifier()
    );
    const fixture = signingFixture();
    const detached = await service.signProductCertificateMessage(fixture);
    const decoded = new TextDecoder().decode(fixture.canonicalBytes);
    const unsigned = JSON.parse(
      decoded.slice(
        `${STUDIO_PRODUCT_CODEC_CERTIFICATE_DOMAIN}\u0000`.length
      )
    ) as {
      certificateId: `tspcc1:${string}`;
      core: Omit<
        StudioProductCodecCertificate,
        "certificateId" | "signature"
      > & {
        signer: {
          algorithm: "ed25519";
          keyId: string;
        };
      };
    };
    const { signer: _signer, ...certificateCore } = unsigned.core;
    const certificate: StudioProductCodecCertificate = {
      ...certificateCore,
      certificateId: unsigned.certificateId,
      signature: {
        algorithm: detached.algorithm,
        keyId: detached.keyId,
        value: detached.signatureValue,
      },
    };
    const serialized = serializeStudioProductCodecCertificate(certificate);
    const verification = await verifyStudioProductCodecCertificate(
      serialized,
      {
        outputBytes: Uint8Array.from([4, 5, 6]),
        evidenceBytes: Uint8Array.from([7, 8, 9, 10]),
        expectedScope: SCOPE,
        nowEpochMs: Date.parse("2026-07-31T00:00:00.000Z"),
        trustRoots: [{
          algorithm: "ed25519",
          keyId: KEY_ID,
          publicKey: keyPair.publicKey,
          scopes: [SCOPE],
          validFrom: VALID_FROM,
          validUntil: VALID_UNTIL,
          revokedAt: null,
        }],
      }
    );
    expect(verification.ok).toBe(true);
  });

  it("fails closed when no production signer is configured", async () => {
    const service = new StudioCodecCertificationAuthorityService(
      undefined,
      verifier()
    );
    await expect(
      service.signProductCertificateMessage(signingFixture())
    ).rejects.toMatchObject({
      code: "SIGNER_UNAVAILABLE",
      message: "Codec certification signer is unavailable.",
    });
  });

  it("fails closed when no server-owned execution verifier is configured", async () => {
    const sign = vi.fn(async () => new Uint8Array(64).fill(7));
    const service = new StudioCodecCertificationAuthorityService(signer(sign));
    await expect(
      service.signProductCertificateMessage(signingFixture())
    ).rejects.toMatchObject({
      code: "EXECUTION_VERIFIER_UNAVAILABLE",
      message: "Codec provider execution verifier is unavailable.",
    });
    expect(sign).not.toHaveBeenCalled();
  });

  it("rejects verified adapters that omit the mandatory completion boundary", async () => {
    const verify = vi.fn(async () => verifiedExecution());
    const sign = vi.fn(async () => new Uint8Array(64).fill(7));
    const service = new StudioCodecCertificationAuthorityService(
      signer(sign),
      { verify } as StudioCodecCertificationAuthorityExecutionVerifier
    );

    await expect(
      service.signProductCertificateMessage(signingFixture())
    ).rejects.toMatchObject({ code: "EXECUTION_VERIFIER_UNAVAILABLE" });
    expect(verify).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it("does not sign a forged but internally consistent certificate when independent verification rejects it", async () => {
    const verify = vi.fn(async () => ({ verified: false as const }));
    const sign = vi.fn(async () => new Uint8Array(64).fill(7));
    const service = new StudioCodecCertificationAuthorityService(
      signer(sign),
      verifier(verify)
    );
    await expect(
      service.signProductCertificateMessage(mutuallyConsistentForgedFixture())
    ).rejects.toMatchObject({
      code: "EXECUTION_NOT_VERIFIED",
      message: "Codec provider execution was not independently verified.",
    });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(sign).not.toHaveBeenCalled();
  });

  it("constant-time rejects independently verified byte digest mismatches before signing", async () => {
    const fixture = signingFixture();
    const sign = vi.fn(async () => new Uint8Array(64).fill(7));
    const service = new StudioCodecCertificationAuthorityService(
      signer(sign),
      verifier(vi.fn(async () => ({
        ...verifiedExecution(fixture),
        evidenceSha256: `sha256:${"0".repeat(64)}` as const,
      })))
    );
    await expect(
      service.signProductCertificateMessage(fixture)
    ).rejects.toMatchObject({
      code: "EXECUTION_VERIFICATION_MISMATCH",
      message:
        "Verified codec execution bytes or provenance do not match the certificate request.",
    });
    expect(sign).not.toHaveBeenCalled();
  });

  it("masks raw execution-verifier errors and times out each verification phase", async () => {
    const sign = vi.fn(async () => new Uint8Array(64).fill(7));
    const rawFailure = new StudioCodecCertificationAuthorityService(
      signer(sign),
      verifier(vi.fn(async () => {
        throw new Error("s3://private-evidence/secret object and stack");
      }))
    );
    await expect(
      rawFailure.signProductCertificateMessage(signingFixture())
    ).rejects.toMatchObject({
      code: "EXECUTION_VERIFICATION_FAILED",
      message: "Codec provider execution verification failed closed.",
    });
    expect(sign).not.toHaveBeenCalled();

    const never = vi.fn(
      ({ signal }: Parameters<
        StudioCodecCertificationAuthorityExecutionVerifier["verify"]
      >[0]) =>
        new Promise<StudioCodecCertificationAuthorityExecutionVerificationResult>(
          (_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new Error("private verifier timeout detail")),
              { once: true }
            );
          }
        )
    );
    const timedOut = new StudioCodecCertificationAuthorityService(
      signer(sign),
      verifier(never)
    );
    await expect(
      timedOut.signProductCertificateMessage(signingFixture(), {
        verificationTimeoutMs: 100,
      })
    ).rejects.toMatchObject({
      code: "EXECUTION_VERIFICATION_TIMEOUT",
      message: "Codec provider execution verification timed out.",
    });
    expect(sign).not.toHaveBeenCalled();
  });

  it("quarantines abort-ignoring operations without permanently poisoning capacity", async () => {
    vi.useFakeTimers();
    try {
      const ignoresAbort = vi.fn(
        () =>
          new Promise<
            StudioCodecCertificationAuthorityExecutionVerificationResult
          >(() => undefined)
      );
      const sign = vi.fn(async () => new Uint8Array(64).fill(7));
      const service = new StudioCodecCertificationAuthorityService(
        signer(sign),
        verifier(ignoresAbort)
      );
      const timedOut = Array.from({ length: 8 }, () =>
        service.signProductCertificateMessage(signingFixture(), {
          verificationTimeoutMs: 100,
        })
      );
      const outcomesPromise = Promise.allSettled(timedOut);
      await vi.advanceTimersByTimeAsync(100);
      const outcomes = await outcomesPromise;
      expect(outcomes).toHaveLength(8);
      expect(outcomes.every(
        (outcome) =>
          outcome.status === "rejected"
          && errorCode(outcome.reason) === "EXECUTION_VERIFICATION_TIMEOUT"
      )).toBe(true);

      await expect(
        service.signProductCertificateMessage(signingFixture(), {
          verificationTimeoutMs: 100,
        })
      ).rejects.toMatchObject({
        code: "BUSY",
        message: "Codec certification signing capacity is exhausted.",
      });
      ignoresAbort.mockImplementationOnce(async () => verifiedExecution());
      await vi.advanceTimersByTimeAsync(1_001);
      await expect(
        service.signProductCertificateMessage(signingFixture(), {
          verificationTimeoutMs: 100,
        })
      ).resolves.toMatchObject({ executionId: EXECUTION_ID });
      expect(ignoresAbort).toHaveBeenCalledTimes(9);
      expect(sign).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects digest mismatch, non-canonical JSON and forbidden vendor claims before signing", async () => {
    const sign = vi.fn(async () => new Uint8Array(64).fill(7));
    const service = new StudioCodecCertificationAuthorityService(signer(sign));
    const fixture = signingFixture();
    await expect(
      service.signProductCertificateMessage({
        ...fixture,
        canonicalSha256: `sha256:${"0".repeat(64)}`,
      })
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "DIGEST_MISMATCH"
    );

    const text = new TextDecoder().decode(fixture.canonicalBytes);
    const prefix = `${STUDIO_PRODUCT_CODEC_CERTIFICATE_DOMAIN}\u0000`;
    const parsed = JSON.parse(text.slice(prefix.length)) as {
      core: {
        certification: { codecVendorCertification: boolean };
      };
    };
    parsed.core.certification.codecVendorCertification = true;
    const forbiddenBytes = TEXT_ENCODER.encode(
      `${prefix}${canonicalJson(parsed as unknown as JsonValue)}`
    );
    await expect(
      service.signProductCertificateMessage({
        ...fixture,
        canonicalByteLength: forbiddenBytes.byteLength,
        canonicalSha256: sha256(forbiddenBytes),
        canonicalBytes: forbiddenBytes,
      })
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "NON_CANONICAL_MESSAGE"
    );

    const prettyBytes = TEXT_ENCODER.encode(
      `${prefix}${JSON.stringify(
        JSON.parse(text.slice(prefix.length)),
        null,
        2
      )}`
    );
    await expect(
      service.signProductCertificateMessage({
        ...fixture,
        canonicalByteLength: prettyBytes.byteLength,
        canonicalSha256: sha256(prettyBytes),
        canonicalBytes: prettyBytes,
      })
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "NON_CANONICAL_MESSAGE"
    );
    expect(sign).not.toHaveBeenCalled();
  });

  it("rejects signer scope, key and validity mismatch before calling the adapter", async () => {
    const sign = vi.fn(async () => new Uint8Array(64).fill(7));
    const service = new StudioCodecCertificationAuthorityService({
      ...signer(sign),
      scopes: ["codec.other.scope"],
    }, verifier());
    await expect(
      service.signProductCertificateMessage(signingFixture())
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "SIGNER_POLICY_MISMATCH"
    );
    expect(sign).not.toHaveBeenCalled();
  });

  it("masks raw adapter failures and rejects malformed signatures", async () => {
    const rawFailure = new StudioCodecCertificationAuthorityService(
      signer(vi.fn(async () => {
        throw new Error("arn:aws:kms:secret-key material and stack");
      })),
      verifier()
    );
    await expect(
      rawFailure.signProductCertificateMessage(signingFixture())
    ).rejects.toMatchObject({
      code: "SIGNER_FAILED",
      message: "Codec certification signer failed closed.",
    });

    const malformed = new StudioCodecCertificationAuthorityService(
      signer(vi.fn(async () => new Uint8Array(63))),
      verifier()
    );
    await expect(
      malformed.signProductCertificateMessage(signingFixture())
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "INVALID_SIGNATURE"
    );

    const wrongKeySignature = new StudioCodecCertificationAuthorityService(
      signer(
        vi.fn(async () => new Uint8Array(64).fill(7)),
        vi.fn(async () => false)
      ),
      verifier()
    );
    await expect(
      wrongKeySignature.signProductCertificateMessage(signingFixture())
    ).rejects.toMatchObject({
      code: "INVALID_SIGNATURE",
      message: "Codec certification signer returned an invalid signature.",
    });
  });

  it("releases a reserved execution after transient signer failure and consumes it only after verified signing", async () => {
    const fixture = signingFixture();
    const complete = vi.fn(async () => true);
    const executionVerifier: StudioCodecCertificationAuthorityExecutionVerifier = {
      verify: vi.fn(async () => ({
        ...verifiedExecution(fixture),
        authorization: {
          status: "reserved" as const,
          reservationId: "reservation-1",
          attemptId: "attempt-1",
          admissionLeaseId: "admission-lease-1",
          expiresAt: "2026-07-30T00:02:30.000Z",
        },
      })),
      complete,
    };
    const sign = vi.fn()
      .mockRejectedValueOnce(new Error("transient KMS timeout"))
      .mockResolvedValueOnce(new Uint8Array(64).fill(7));
    const service = new StudioCodecCertificationAuthorityService(
      signer(sign),
      executionVerifier
    );

    await expect(
      service.signProductCertificateMessage(fixture)
    ).rejects.toMatchObject({ code: "SIGNER_FAILED" });
    expect(complete).toHaveBeenNthCalledWith(1, expect.objectContaining({
      executionId: fixture.executionId,
      reservationId: "reservation-1",
      outcome: "release",
    }));

    await expect(
      service.signProductCertificateMessage(fixture)
    ).resolves.toMatchObject({
      executionId: fixture.executionId,
      canonicalSha256: fixture.canonicalSha256,
    });
    expect(complete).toHaveBeenNthCalledWith(2, expect.objectContaining({
      executionId: fixture.executionId,
      reservationId: "reservation-1",
      outcome: "consume",
    }));
  });

  it("releases a reservation that cannot cover downstream phase budgets plus skew", async () => {
    const fixture = signingFixture();
    const complete = vi.fn(async () => true);
    const sign = vi.fn(async () => new Uint8Array(64).fill(7));
    const service = new StudioCodecCertificationAuthorityService(
      signer(sign),
      verifier(vi.fn(async () => ({
        ...verifiedExecution(fixture),
        authorization: {
          status: "reserved" as const,
          reservationId: "reservation-short",
          attemptId: "attempt-short",
          admissionLeaseId: "admission-short",
          expiresAt: "2026-07-30T00:01:30.000Z",
        },
      })), complete)
    );

    await expect(
      service.signProductCertificateMessage(fixture)
    ).rejects.toMatchObject({ code: "EXECUTION_FINALIZATION_FAILED" });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "release",
      reservationId: "reservation-short",
    }));
    expect(sign).not.toHaveBeenCalled();
  });

  it("never returns a signature when durable reservation consumption times out", async () => {
    const fixture = signingFixture();
    const complete = vi.fn(
      ({ signal }: Parameters<
        NonNullable<
          StudioCodecCertificationAuthorityExecutionVerifier["complete"]
        >
      >[0]) =>
        new Promise<boolean>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("private repository timeout detail")),
            { once: true }
          );
        })
    );
    const service = new StudioCodecCertificationAuthorityService(
      signer(),
      {
        verify: vi.fn(async () => ({
          ...verifiedExecution(fixture),
          authorization: {
            status: "reserved" as const,
            reservationId: "reservation-timeout",
            attemptId: "attempt-timeout",
            admissionLeaseId: "admission-timeout",
            expiresAt: "2026-07-30T00:05:30.000Z",
          },
        })),
        complete,
      }
    );

    await expect(
      service.signProductCertificateMessage(fixture, {
        finalizationTimeoutMs: 100,
      })
    ).rejects.toMatchObject({
      code: "EXECUTION_FINALIZATION_TIMEOUT",
      message:
        "Codec provider execution reservation finalization timed out.",
    });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "consume",
    }));
  });

  it("recovers an ambiguously committed signature without invoking the signer twice", async () => {
    vi.useFakeTimers();
    try {
      const fixture = signingFixture();
      let storedSignature:
        StudioCodecCertificationAuthoritySignature
        | null = null;
      const verifyExecution = vi.fn(async () => storedSignature
        ? {
            ...verifiedExecution(fixture),
            authorization: {
              status: "completed" as const,
              signature: storedSignature,
            },
          }
        : verifiedExecution(fixture));
      const complete = vi.fn((
        request: Parameters<
          StudioCodecCertificationAuthorityExecutionVerifier["complete"]
        >[0]
      ) => {
        if (request.outcome !== "consume") return Promise.resolve(true);
        storedSignature = request.signature;
        // Simulate an atomic repository commit followed by a lost response.
        return new Promise<boolean>(() => undefined);
      });
      const sign = vi.fn(async () => new Uint8Array(64).fill(7));
      const verifySignature = vi.fn(async () => true);
      const service = new StudioCodecCertificationAuthorityService(
        signer(sign, verifySignature),
        { verify: verifyExecution, complete }
      );

      const first = service.signProductCertificateMessage(fixture, {
        finalizationTimeoutMs: 100,
      });
      const firstOutcome = first.then(
        () => null,
        (error: unknown) => error
      );
      await vi.advanceTimersByTimeAsync(100);
      await expect(firstOutcome).resolves.toMatchObject({
        code: "EXECUTION_FINALIZATION_TIMEOUT",
      });
      expect(storedSignature).not.toBeNull();

      const recovered = await service.signProductCertificateMessage(fixture);
      expect(recovered).toEqual(storedSignature);
      expect(sign).toHaveBeenCalledTimes(1);
      expect(verifySignature).toHaveBeenCalledTimes(2);
      expect(complete).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fences concurrent same-execution retries and recovers the completed signature", async () => {
    const fixture = signingFixture();
    let state: "available" | "reserved" | "completed" = "available";
    let storedSignature: StudioCodecCertificationAuthoritySignature | null = null;
    let releaseSigner!: () => void;
    const signerGate = new Promise<void>((resolve) => {
      releaseSigner = resolve;
    });
    const verifyExecution = vi.fn(async () => {
      if (state === "completed" && storedSignature) {
        return {
          ...verifiedExecution(fixture),
          authorization: {
            status: "completed" as const,
            signature: storedSignature,
          },
        };
      }
      if (state === "reserved") return { verified: false as const };
      state = "reserved";
      return verifiedExecution(fixture);
    });
    const complete = vi.fn(async (
      request: Parameters<
        StudioCodecCertificationAuthorityExecutionVerifier["complete"]
      >[0]
    ) => {
      if (request.outcome === "consume") {
        storedSignature = request.signature;
        state = "completed";
      } else if (request.outcome === "release") {
        state = "available";
      }
      return true;
    });
    const sign = vi.fn(async () => {
      await signerGate;
      return new Uint8Array(64).fill(7);
    });
    const service = new StudioCodecCertificationAuthorityService(
      signer(sign),
      { verify: verifyExecution, complete }
    );

    const first = service.signProductCertificateMessage(fixture);
    await vi.waitFor(() => expect(sign).toHaveBeenCalledOnce());
    await expect(
      service.signProductCertificateMessage(fixture)
    ).rejects.toMatchObject({ code: "EXECUTION_NOT_VERIFIED" });
    releaseSigner();
    const signed = await first;
    const recovered = await service.signProductCertificateMessage(fixture);

    expect(recovered).toEqual(signed);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("propagates bounded cancellation and timeout without exposing abort reasons", async () => {
    const never = vi.fn(
      ({ signal }: Parameters<StudioCodecCertificationAuthoritySigner["sign"]>[0]) =>
        new Promise<Uint8Array>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("internal HSM cancellation")),
            { once: true }
          );
        })
    );
    const service = new StudioCodecCertificationAuthorityService(
      signer(never),
      verifier()
    );
    await expect(
      service.signProductCertificateMessage(signingFixture(), {
        timeoutMs: 100,
      })
    ).rejects.toMatchObject({
      code: "SIGNER_TIMEOUT",
      message: "Codec certification signer timed out.",
    });

    const controller = new AbortController();
    const pending = service.signProductCertificateMessage(signingFixture(), {
      signal: controller.signal,
    });
    controller.abort(new Error("private caller reason"));
    await expect(pending).rejects.toMatchObject({
      code: "ABORTED",
      message: "Codec certification signing was aborted.",
    });
  });

  it("closes the external-abort registration race even when the adapter ignores cancellation", async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    const originalAdd = signal.addEventListener.bind(signal);
    vi.spyOn(signal, "addEventListener").mockImplementation((
      ...args: Parameters<AbortSignal["addEventListener"]>
    ) => {
      originalAdd(...args);
      controller.abort();
    });
    const ignoresAbort = vi.fn(
      () =>
        new Promise<StudioCodecCertificationAuthorityExecutionVerificationResult>(
          () => undefined
        )
    );
    const service = new StudioCodecCertificationAuthorityService(
      signer(),
      verifier(ignoresAbort)
    );

    await expect(
      service.signProductCertificateMessage(signingFixture(), { signal })
    ).rejects.toMatchObject({
      code: "ABORTED",
      message: "Codec certification signing was aborted.",
    });
  });

  it("rejects stale and future-dated signing messages against the authority clock", async () => {
    const fixture = signingFixture();
    const staleService = new StudioCodecCertificationAuthorityService(
      signer(),
      verifier(),
      { now: () => Date.parse("2026-07-30T00:06:00.001Z") }
    );
    await expect(
      staleService.signProductCertificateMessage(fixture)
    ).rejects.toMatchObject({ code: "CERTIFICATE_TIME_INVALID" });

    const futureService = new StudioCodecCertificationAuthorityService(
      signer(),
      verifier(),
      { now: () => Date.parse("2026-07-29T23:58:59.999Z") }
    );
    await expect(
      futureService.signProductCertificateMessage(fixture)
    ).rejects.toMatchObject({ code: "CERTIFICATE_TIME_INVALID" });
  });
});
