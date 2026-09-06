import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CONFORMANCE_EVIDENCE_MEDIA_TYPE,
  executeAndCertifyStudioFirstPartyWillV1DocumentCodec,
  studioFirstPartyWillV1DocumentCodecCertificationScope,
  verifyStudioFirstPartyWillV1DocumentCertifiedExecution,
} from "./studio-first-party-will-v1-document-codec-certification";
import {
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER,
  encodeStudioWillV1DocumentTransport,
} from "./studio-first-party-will-v1-document-codec-provider";
import {
  executeStudioFirstPartyWillV1DocumentCodecWorkerMessage,
} from "./studio-first-party-will-v1-document-codec.worker";
import {
  issueStudioProductCodecCertificate,
} from "./studio-product-codec-certification";

import type { StudioCodecProvider } from "./studio-codec-provider-contract";
import type {
  StudioFirstPartyWillV1DocumentCodecWorkerLike,
} from "./studio-first-party-will-v1-document-codec-worker-client";
import type {
  StudioFirstPartyWillV1DocumentCodecWorkerRunMessage,
} from "./studio-first-party-will-v1-document-codec-worker-protocol";
import type {
  StudioProductCodecCertificationSigner,
  StudioProductCodecCertificationTrustRoot,
} from "./studio-product-codec-certification";

const ISSUED_AT = "2026-07-30T00:00:00.000Z";
const EXPIRES_AT = "2026-07-31T00:00:00.000Z";
const ROOT_START = "2026-07-01T00:00:00.000Z";
const ROOT_END = "2026-08-31T00:00:00.000Z";
const VERIFY_AT = Date.parse("2026-07-30T12:00:00.000Z");

type FakeWorkerMode =
  | "hang"
  | "post-error"
  | "runtime-error"
  | "success";

class CertificationFakeWorker
implements StudioFirstPartyWillV1DocumentCodecWorkerLike {
  onmessage:
    StudioFirstPartyWillV1DocumentCodecWorkerLike["onmessage"] = null;
  onerror:
    StudioFirstPartyWillV1DocumentCodecWorkerLike["onerror"] = null;
  onmessageerror:
    StudioFirstPartyWillV1DocumentCodecWorkerLike["onmessageerror"] = null;
  readonly requests:
    StudioFirstPartyWillV1DocumentCodecWorkerRunMessage[] = [];
  readonly transfers: Transferable[][] = [];
  terminateCount = 0;

  constructor(private readonly mode: FakeWorkerMode = "success") {}

  postMessage(
    message: StudioFirstPartyWillV1DocumentCodecWorkerRunMessage,
    transfer: Transferable[],
  ): void {
    if (this.mode === "post-error") {
      throw new DOMException(
        "/private/raw/will-codec.wasm startup",
        "DataCloneError",
      );
    }
    this.transfers.push([...transfer]);
    const workerMessage = structuredClone(message, { transfer });
    this.requests.push(workerMessage);
    if (this.mode === "success") {
      queueMicrotask(() => {
        void this.respond(workerMessage);
      });
    } else if (this.mode === "runtime-error") {
      queueMicrotask(() => {
        this.onerror?.({
          error: new Error("/private/raw/will-codec.wasm panic"),
          message: "/private/raw/will-codec.wasm panic",
          preventDefault() {},
        });
      });
    }
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  private async respond(
    message: StudioFirstPartyWillV1DocumentCodecWorkerRunMessage,
  ): Promise<void> {
    const dispatch =
      await executeStudioFirstPartyWillV1DocumentCodecWorkerMessage(
        message,
      );
    if (!dispatch) throw new Error("Missing WILL Worker dispatch.");
    this.onmessage?.({
      data: structuredClone(dispatch.response, {
        transfer: [...dispatch.transfer],
      }),
    } as MessageEvent<unknown>);
  }
}

async function inputBytes(): Promise<Uint8Array> {
  return encodeStudioWillV1DocumentTransport({
    width: 328,
    height: 439,
    title: "Certified bounded WILL",
    createdAt: "2026-07-30T12:34:56Z",
    application: "ToonSpectrum Studio",
    applicationVersion: "1.0.0",
    paths: [
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
    ],
  });
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
  const keyId = "toonspectrum.product.release.will-v1-document.2026-07";
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

describe("first-party WILL v1 Annex B document product certification", () => {
  it("executes, proves, signs, and verifies exact bounded .will bytes", async () => {
    const scope =
      studioFirstPartyWillV1DocumentCodecCertificationScope("encode");
    const { signer, root } = await credentials(scope);
    const certified =
      await executeAndCertifyStudioFirstPartyWillV1DocumentCodec(
        {
          direction: "encode",
          inputBytes: await inputBytes(),
          execution: "direct",
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
        },
        signer,
      );
    expect(certified.conformance).toMatchObject({
      coverage: "annex-b-bounded-seven-part-document",
      annexBOpcContainerCovered: true,
      thirdPartyCodecCertification: false,
      vendorTrademarkAuthorization: false,
      arbitraryVendorFileInteroperabilityCertified: false,
      decision: "passed",
    });
    const verified =
      await verifyStudioFirstPartyWillV1DocumentCertifiedExecution(
        certified,
        { trustRoots: [root], nowEpochMs: VERIFY_AT },
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

  it("rejects byte, canonical evidence object, and media-type substitution", async () => {
    const scope =
      studioFirstPartyWillV1DocumentCodecCertificationScope("encode");
    const { signer, root } = await credentials(scope);
    const certified =
      await executeAndCertifyStudioFirstPartyWillV1DocumentCodec(
        {
          direction: "encode",
          inputBytes: await inputBytes(),
          execution: "direct",
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
        },
        signer,
      );
    await expect(
      verifyStudioFirstPartyWillV1DocumentCertifiedExecution(
        {
          ...certified,
          bytes: Uint8Array.from([...certified.bytes, 0]),
        },
        { trustRoots: [root], nowEpochMs: VERIFY_AT },
      ),
    ).resolves.toMatchObject({ ok: false, code: "OUTPUT_MISMATCH" });
    await expect(
      verifyStudioFirstPartyWillV1DocumentCertifiedExecution(
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
    expect(
      STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CONFORMANCE_EVIDENCE_MEDIA_TYPE,
    ).not.toBe("application/vnd.toonspectrum.cross-protocol+json");
    await expect(
      verifyStudioFirstPartyWillV1DocumentCertifiedExecution(
        { ...certified, certificateBytes: mislabeled },
        { trustRoots: [root], nowEpochMs: VERIFY_AT },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "CERTIFIED_EXECUTION_IDENTITY_MISMATCH",
    });
  });

  it("pins the built-in provider and claims one-shot ids only after identity", async () => {
    const scope =
      studioFirstPartyWillV1DocumentCodecCertificationScope("encode");
    const { signer, root } = await credentials(scope);
    const source = await inputBytes();
    const substituted: StudioCodecProvider = Object.freeze({
      manifest: STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER.manifest,
      execute:
        STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER.execute,
    });
    await expect(
      executeAndCertifyStudioFirstPartyWillV1DocumentCodec(
        {
          direction: "encode",
          inputBytes: source,
          execution: "direct",
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
          providers: [substituted],
        },
        signer,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_FOUND" });

    const certified =
      await executeAndCertifyStudioFirstPartyWillV1DocumentCodec(
        {
          direction: "encode",
          inputBytes: source,
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
      verifyStudioFirstPartyWillV1DocumentCertifiedExecution(
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
      verifyStudioFirstPartyWillV1DocumentCertifiedExecution(certified, {
        trustRoots: [root],
        nowEpochMs: VERIFY_AT,
        claimCertificateId,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(claimed.size).toBe(1);
  });

  it("selects the dedicated Worker by default and certifies one exact attempt", async () => {
    const scope =
      studioFirstPartyWillV1DocumentCodecCertificationScope("encode");
    const { signer, root } = await credentials(scope);
    const source = await inputBytes();
    const worker = new CertificationFakeWorker();
    const certified =
      await executeAndCertifyStudioFirstPartyWillV1DocumentCodec(
        {
          direction: "encode",
          inputBytes: source,
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
      providerId: "toonspectrum.will-v1-annex-b-document.v1",
      input: { byteLength: source.byteLength },
      output: { byteLength: certified.bytes.byteLength },
    });
    expect(certified.executionProviderReceipt).toEqual({
      schemaVersion: 1,
      kind: "toonspectrum-codec-execution-provider-selection",
      selectedProvider: "worker",
      attemptedProviders: ["worker"],
    });
    const verified =
      await verifyStudioFirstPartyWillV1DocumentCertifiedExecution(
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
      verifyStudioFirstPartyWillV1DocumentCertifiedExecution(
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
    const scope =
      studioFirstPartyWillV1DocumentCodecCertificationScope("encode");
    const { signer } = await credentials(scope);
    const source = await inputBytes();
    await expect(
      executeAndCertifyStudioFirstPartyWillV1DocumentCodec(
        {
          direction: "encode",
          inputBytes: source,
          workerFactory: null,
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
        },
        signer,
      ),
    ).rejects.toMatchObject({ code: "CODEC_WORKER_REQUIRED" });

    await expect(
      executeAndCertifyStudioFirstPartyWillV1DocumentCodec(
        {
          direction: "encode",
          inputBytes: source,
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
      executeAndCertifyStudioFirstPartyWillV1DocumentCodec(
        {
          direction: "encode",
          inputBytes: source,
          workerFactory: () => postFailure,
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
        },
        signer,
      ),
    ).rejects.toMatchObject({ code: "CODEC_EXECUTION_FAILED" });
    expect(postFailure.terminateCount).toBe(1);

    const runtimeWorker = new CertificationFakeWorker("runtime-error");
    const runtime =
      executeAndCertifyStudioFirstPartyWillV1DocumentCodec(
        {
          direction: "encode",
          inputBytes: source,
          workerFactory: () => runtimeWorker,
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
        },
        signer,
      );
    const error = await runtime.catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: "CODEC_EXECUTION_FAILED" });
    expect(String((error as Error).message)).not.toContain("private");
    expect(String((error as Error).message)).not.toContain("wasm");
    expect(runtimeWorker.terminateCount).toBe(1);

    const invalidFactory = vi.fn(() => new CertificationFakeWorker());
    await expect(
      executeAndCertifyStudioFirstPartyWillV1DocumentCodec(
        {
          direction: "encode",
          inputBytes: source,
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
    const scope =
      studioFirstPartyWillV1DocumentCodecCertificationScope("encode");
    const { signer } = await credentials(scope);
    const source = await inputBytes();
    const factory = vi.fn(() => {
      throw new Error("must not construct");
    });
    await expect(
      executeAndCertifyStudioFirstPartyWillV1DocumentCodec(
        {
          direction: "encode",
          inputBytes: source,
          execution: "direct",
          workerFactory: factory,
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
        },
        signer,
      ),
    ).resolves.toMatchObject({
      receipt: {
        providerId: "toonspectrum.will-v1-annex-b-document.v1",
      },
      executionProviderReceipt: {
        selectedProvider: "direct",
        attemptedProviders: ["direct"],
      },
    });
    expect(factory).not.toHaveBeenCalled();

    await expect(
      executeAndCertifyStudioFirstPartyWillV1DocumentCodec(
        {
          direction: "encode",
          inputBytes: source,
          execution: "worker",
          workerFactory: null,
          issuedAt: ISSUED_AT,
          expiresAt: EXPIRES_AT,
        },
        signer,
      ),
    ).rejects.toMatchObject({ code: "CODEC_WORKER_REQUIRED" });
  });

  it("maps abort and bounded operation timeout after hard termination", async () => {
    const scope =
      studioFirstPartyWillV1DocumentCodecCertificationScope("encode");
    const { signer } = await credentials(scope);
    const source = await inputBytes();
    const controller = new AbortController();
    const abortedWorker = new CertificationFakeWorker("hang");
    const aborted =
      executeAndCertifyStudioFirstPartyWillV1DocumentCodec(
        {
          direction: "encode",
          inputBytes: source,
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
      const timedOut =
        executeAndCertifyStudioFirstPartyWillV1DocumentCodec(
          {
            direction: "encode",
            inputBytes: source,
            execution: "worker",
            workerFactory: () => timeoutWorker,
            timeoutMs: 120_000,
            issuedAt: ISSUED_AT,
            expiresAt: EXPIRES_AT,
          },
          signer,
        );
      const rejection = expect(timedOut).rejects.toMatchObject({
        code: "CODEC_EXECUTION_TIMEOUT",
      });
      await vi.advanceTimersByTimeAsync(120_000);
      await rejection;
      expect(timeoutWorker.terminateCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
