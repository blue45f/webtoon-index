import { describe, expect, it, vi } from "vitest";

import {
  executeAndCertifyStudioFirstPartyRasterCodec,
  studioFirstPartyRasterCodecCertificationScope,
  verifyStudioFirstPartyRasterCertifiedExecution,
} from "./studio-first-party-raster-codec-certification";
import {
  serializeStudioFirstPartyRasterConformanceEvidence,
} from "./studio-first-party-raster-codec-conformance";
import {
  encodeStudioCodecRgbaEnvelope,
} from "./studio-first-party-raster-codec-provider";
import {
  executeStudioFirstPartyRasterCodecWorkerMessage,
} from "./studio-first-party-raster-codec.worker";
import {
  issueStudioProductCodecCertificate,
} from "./studio-product-codec-certification";

import type {
  StudioFirstPartyRasterCodecWorkerLike,
} from "./studio-first-party-raster-codec-worker-client";
import type {
  StudioFirstPartyRasterCodecWorkerRunMessage,
} from "./studio-first-party-raster-codec-worker-protocol";
import type {
  StudioProductCodecCertificationSigner,
  StudioProductCodecCertificationTrustRoot,
} from "./studio-product-codec-certification";

const ISSUED_AT = "2026-07-30T00:00:00.000Z";
const EXPIRES_AT = "2026-07-31T00:00:00.000Z";
const ROOT_START = "2026-07-01T00:00:00.000Z";
const ROOT_END = "2026-08-31T00:00:00.000Z";
const VERIFY_AT = Date.parse("2026-07-30T12:00:00.000Z");

const INPUT = encodeStudioCodecRgbaEnvelope({
  width: 2,
  height: 1,
  data: Uint8Array.of(
    10, 20, 30, 255,
    200, 150, 100, 255,
  ),
});

type FakeWorkerMode =
  | "hang"
  | "post-error"
  | "runtime-error"
  | "success";

class CertificationFakeWorker
implements StudioFirstPartyRasterCodecWorkerLike {
  onmessage: StudioFirstPartyRasterCodecWorkerLike["onmessage"] = null;
  onerror: StudioFirstPartyRasterCodecWorkerLike["onerror"] = null;
  onmessageerror:
    StudioFirstPartyRasterCodecWorkerLike["onmessageerror"] = null;
  readonly requests: StudioFirstPartyRasterCodecWorkerRunMessage[] = [];
  readonly transfers: Transferable[][] = [];
  terminateCount = 0;
  readonly #mode: FakeWorkerMode;

  constructor(mode: FakeWorkerMode = "success") {
    this.#mode = mode;
  }

  postMessage(
    message: StudioFirstPartyRasterCodecWorkerRunMessage,
    transfer: Transferable[],
  ): void {
    if (this.#mode === "post-error") {
      throw new DOMException("raw startup failure", "DataCloneError");
    }
    this.transfers.push([...transfer]);
    const workerMessage = structuredClone(message, { transfer });
    this.requests.push(workerMessage);
    if (this.#mode === "runtime-error") {
      queueMicrotask(() => {
        this.onerror?.({
          message: "raw provider crash",
        } as ErrorEvent);
      });
    } else if (this.#mode === "success") {
      queueMicrotask(() => {
        void this.#respond(workerMessage);
      });
    }
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  async #respond(
    message: StudioFirstPartyRasterCodecWorkerRunMessage,
  ): Promise<void> {
    const dispatch =
      await executeStudioFirstPartyRasterCodecWorkerMessage(message);
    if (!dispatch) throw new Error("Missing raster Worker dispatch.");
    this.onmessage?.({
      data: structuredClone(dispatch.response, {
        transfer: [...dispatch.transfer],
      }),
    } as MessageEvent<unknown>);
  }
}

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
  const keyId = "toonspectrum.product.release.raster.2026-07";
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

describe("first-party raster codec product certification", () => {
  it("executes QOI, runs deterministic conformance, signs, and verifies exact bytes", async () => {
    const scope = studioFirstPartyRasterCodecCertificationScope(
      "qoi",
      "encode",
    );
    const { signer, root } = await credentials(scope);
    const certified = await executeAndCertifyStudioFirstPartyRasterCodec(
      {
        format: "qoi",
        direction: "encode",
        inputBytes: INPUT,
        execution: "direct",
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      },
      signer,
    );
    expect(certified.receipt.providerId).toBe(
      "toonspectrum.raster.qoi.v1",
    );
    expect(certified.conformance.decision).toBe("passed");
    expect(certified.conformance.cases).toHaveLength(2);

    const verified =
      await verifyStudioFirstPartyRasterCertifiedExecution(certified, {
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
      verified.certificate.certification.thirdPartyCodecCertification,
    ).toBe(false);
  });

  it("rejects output or conformance evidence substitution", async () => {
    const scope = studioFirstPartyRasterCodecCertificationScope(
      "qoi",
      "encode",
    );
    const { signer, root } = await credentials(scope);
    const certified = await executeAndCertifyStudioFirstPartyRasterCodec(
      {
        format: "qoi",
        direction: "encode",
        inputBytes: INPUT,
        execution: "direct",
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      },
      signer,
    );

    await expect(
      verifyStudioFirstPartyRasterCertifiedExecution(
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
      verifyStudioFirstPartyRasterCertifiedExecution(
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
      verifyStudioFirstPartyRasterCertifiedExecution(
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

  it("enforces exact format/direction identity after signature verification", async () => {
    const scope = studioFirstPartyRasterCodecCertificationScope(
      "qoi",
      "encode",
    );
    const { signer, root } = await credentials(scope);
    const certified = await executeAndCertifyStudioFirstPartyRasterCodec(
      {
        format: "qoi",
        direction: "encode",
        inputBytes: INPUT,
        execution: "direct",
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      },
      signer,
    );
    const result = await verifyStudioFirstPartyRasterCertifiedExecution(
      {
        ...certified,
        direction: "decode",
        scope: studioFirstPartyRasterCodecCertificationScope(
          "qoi",
          "decode",
        ),
      },
      {
        trustRoots: [root],
        nowEpochMs: VERIFY_AT,
      },
    );
    expect(result).toMatchObject({
      ok: false,
      code: "SCOPE_MISMATCH",
    });
  });

  it("pins the signed raster conformance media type", async () => {
    const scope = studioFirstPartyRasterCodecCertificationScope(
      "qoi",
      "encode",
    );
    const { signer, root } = await credentials(scope);
    const certified = await executeAndCertifyStudioFirstPartyRasterCodec(
      {
        format: "qoi",
        direction: "encode",
        inputBytes: INPUT,
        execution: "direct",
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
      verifyStudioFirstPartyRasterCertifiedExecution(
        { ...certified, certificateBytes: mislabeled },
        { trustRoots: [root], nowEpochMs: VERIFY_AT },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH",
    });
  });

  it("rejects signed conformance evidence for a different raster identity", async () => {
    const scope = studioFirstPartyRasterCodecCertificationScope(
      "qoi",
      "encode",
    );
    const { signer, root } = await credentials(scope);
    const certified = await executeAndCertifyStudioFirstPartyRasterCodec(
      {
        format: "qoi",
        direction: "encode",
        inputBytes: INPUT,
        execution: "direct",
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      },
      signer,
    );
    const substitutedConformance = {
      ...certified.conformance,
      format: "bmp" as const,
    };
    const substitutedBytes =
      serializeStudioFirstPartyRasterConformanceEvidence(
        substitutedConformance,
      );
    const substitutedCertificate = await issueStudioProductCodecCertificate(
      {
        receipt: certified.receipt,
        outputBytes: certified.bytes,
        evidenceBytes: substitutedBytes,
        evidenceMediaType:
          "application/vnd.toonspectrum.raster-codec-conformance+json",
        scope,
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      },
      signer,
    );

    await expect(
      verifyStudioFirstPartyRasterCertifiedExecution(
        {
          ...certified,
          conformance: substitutedConformance,
          conformanceBytes: substitutedBytes,
          certificateBytes: substitutedCertificate,
        },
        { trustRoots: [root], nowEpochMs: VERIFY_AT },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH",
    });
  });

  it("rejects substituted receipt metadata after signature verification", async () => {
    const scope = studioFirstPartyRasterCodecCertificationScope(
      "qoi",
      "encode",
    );
    const { signer, root } = await credentials(scope);
    const certified = await executeAndCertifyStudioFirstPartyRasterCodec(
      {
        format: "qoi",
        direction: "encode",
        inputBytes: INPUT,
        execution: "direct",
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      },
      signer,
    );
    const result = await verifyStudioFirstPartyRasterCertifiedExecution(
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

  it("claims one-shot certificate ids only after wrapper identity checks pass", async () => {
    const scope = studioFirstPartyRasterCodecCertificationScope(
      "qoi",
      "encode",
    );
    const { signer, root } = await credentials(scope);
    const certified = await executeAndCertifyStudioFirstPartyRasterCodec(
      {
        format: "qoi",
        direction: "encode",
        inputBytes: INPUT,
        execution: "direct",
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
      verifyStudioFirstPartyRasterCertifiedExecution(
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
      verifyStudioFirstPartyRasterCertifiedExecution(certified, {
        trustRoots: [root],
        nowEpochMs: VERIFY_AT,
        claimCertificateId,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(claimed.size).toBe(1);
  });

  it("selects the dedicated Worker by default and certifies one exact attempt", async () => {
    const scope = studioFirstPartyRasterCodecCertificationScope(
      "qoi",
      "encode",
    );
    const { signer, root } = await credentials(scope);
    const worker = new CertificationFakeWorker();
    const certified = await executeAndCertifyStudioFirstPartyRasterCodec(
      {
        format: "qoi",
        direction: "encode",
        inputBytes: INPUT,
        workerFactory: () => worker,
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      },
      signer,
    );

    expect(worker.requests).toHaveLength(1);
    expect(worker.transfers[0]).toHaveLength(1);
    expect(worker.terminateCount).toBe(1);
    expect(certified.receipt).toMatchObject({
      providerId: "toonspectrum.raster.qoi.v1",
      input: { byteLength: INPUT.byteLength },
      output: { byteLength: certified.bytes.byteLength },
    });
    expect(certified.executionProviderReceipt).toEqual({
      schemaVersion: 1,
      kind: "toonspectrum-codec-execution-provider-selection",
      selectedProvider: "worker",
      attemptedProviders: ["worker"],
    });
    const verified = await verifyStudioFirstPartyRasterCertifiedExecution(
      certified,
      { trustRoots: [root], nowEpochMs: VERIFY_AT },
    );
    expect(verified).toMatchObject({
      ok: true,
      certificate: {
        executionProviderReceipt: {
          selectedProvider: "worker",
          attemptedProviders: ["worker"],
        },
      },
    });
    await expect(
      verifyStudioFirstPartyRasterCertifiedExecution(
        {
          ...certified,
          executionProviderReceipt: {
            schemaVersion: 1,
            kind: "toonspectrum-codec-execution-provider-selection",
            selectedProvider: "direct",
            attemptedProviders: ["direct"],
          },
        },
        { trustRoots: [root], nowEpochMs: VERIFY_AT },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH",
    });
  });

  it("rejects every Worker startup/runtime failure without direct replay", async () => {
    const scope = studioFirstPartyRasterCodecCertificationScope(
      "qoi",
      "encode",
    );
    const { signer } = await credentials(scope);
    await expect(
      executeAndCertifyStudioFirstPartyRasterCodec(
        {
          format: "qoi",
          direction: "encode",
          inputBytes: INPUT,
          workerFactory: null,
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
        },
        signer,
      ),
    ).rejects.toMatchObject({ code: "CODEC_WORKER_REQUIRED" });

    await expect(
      executeAndCertifyStudioFirstPartyRasterCodec(
        {
          format: "qoi",
          direction: "encode",
          inputBytes: INPUT,
          workerFactory: () => {
            throw new Error("startup failed");
          },
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
        },
        signer,
      ),
    ).rejects.toMatchObject({ code: "CODEC_WORKER_REQUIRED" });

    const postFailure = new CertificationFakeWorker("post-error");
    await expect(
      executeAndCertifyStudioFirstPartyRasterCodec(
        {
          format: "qoi",
          direction: "encode",
          inputBytes: INPUT,
          workerFactory: () => postFailure,
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
        },
        signer,
      ),
    ).rejects.toMatchObject({ code: "CODEC_EXECUTION_FAILED" });
    expect(postFailure.terminateCount).toBe(1);

    const runtimeFailure = new CertificationFakeWorker("runtime-error");
    await expect(
      executeAndCertifyStudioFirstPartyRasterCodec(
        {
          format: "qoi",
          direction: "encode",
          inputBytes: INPUT,
          workerFactory: () => runtimeFailure,
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
        },
        signer,
      ),
    ).rejects.toMatchObject({
      code: "CODEC_EXECUTION_FAILED",
      message: "First-party raster codec Worker execution failed.",
    });
    expect(runtimeFailure.terminateCount).toBe(1);

    const invalidFactory = vi.fn(() => new CertificationFakeWorker());
    await expect(
      executeAndCertifyStudioFirstPartyRasterCodec(
        {
          format: "qoi",
          direction: "encode",
          inputBytes: INPUT,
          execution: "auto" as never,
          workerFactory: invalidFactory,
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
        },
        signer,
      ),
    ).rejects.toMatchObject({ code: "INVALID_EXECUTION_POLICY" });
    expect(invalidFactory).not.toHaveBeenCalled();
  });

  it("keeps explicit worker fail-closed and explicit direct independent", async () => {
    const scope = studioFirstPartyRasterCodecCertificationScope(
      "qoi",
      "encode",
    );
    const { signer } = await credentials(scope);
    await expect(
      executeAndCertifyStudioFirstPartyRasterCodec(
        {
          format: "qoi",
          direction: "encode",
          inputBytes: INPUT,
          execution: "worker",
          workerFactory: null,
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
        },
        signer,
      ),
    ).rejects.toMatchObject({
      code: "CODEC_WORKER_REQUIRED",
    });

    const workerFactory = vi.fn(() => {
      throw new Error("must not construct");
    });
    await expect(
      executeAndCertifyStudioFirstPartyRasterCodec(
        {
          format: "qoi",
          direction: "encode",
          inputBytes: INPUT,
          execution: "direct",
          workerFactory,
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
        },
        signer,
      ),
    ).resolves.toMatchObject({
      receipt: {
        providerId: "toonspectrum.raster.qoi.v1",
      },
      executionProviderReceipt: {
        selectedProvider: "direct",
        attemptedProviders: ["direct"],
      },
    });
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("maps AbortSignal and timeout to hard-terminated certification errors", async () => {
    const scope = studioFirstPartyRasterCodecCertificationScope(
      "qoi",
      "encode",
    );
    const { signer } = await credentials(scope);
    const controller = new AbortController();
    const abortedWorker = new CertificationFakeWorker("hang");
    const aborted = executeAndCertifyStudioFirstPartyRasterCodec(
      {
        format: "qoi",
        direction: "encode",
        inputBytes: INPUT,
        execution: "worker",
        workerFactory: () => abortedWorker,
        signal: controller.signal,
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
      },
      signer,
    );
    await Promise.resolve();
    controller.abort();
    await expect(aborted).rejects.toMatchObject({
      code: "CODEC_EXECUTION_ABORTED",
    });
    expect(abortedWorker.terminateCount).toBe(1);

    vi.useFakeTimers();
    try {
      const timeoutWorker = new CertificationFakeWorker("hang");
      const timedOut = executeAndCertifyStudioFirstPartyRasterCodec(
        {
          format: "qoi",
          direction: "encode",
          inputBytes: INPUT,
          execution: "worker",
          workerFactory: () => timeoutWorker,
          timeoutMs: 5,
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
        },
        signer,
      );
      const rejection = expect(timedOut).rejects.toMatchObject({
        code: "CODEC_EXECUTION_TIMEOUT",
      });
      await vi.advanceTimersByTimeAsync(5);
      await rejection;
      expect(timeoutWorker.terminateCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
