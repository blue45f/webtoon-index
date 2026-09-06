import { describe, expect, it } from "vitest";

import {
  STUDIO_LAYER_LIFT_ARTIFACT_KIND,
  STUDIO_LAYER_LIFT_ARTIFACT_VERSION,
  type StudioLayerLiftArtifactPairReceipt,
} from "./studio-layer-lift-artifact";
import {
  STUDIO_LAYER_LIFT_ARTIFACT_WORKER_ERROR_KIND,
  STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION,
  STUDIO_LAYER_LIFT_ARTIFACT_WORKER_REQUEST_KIND,
  STUDIO_LAYER_LIFT_ARTIFACT_WORKER_RESULT_KIND,
  getStudioLayerLiftArtifactWorkerRequestTransferList,
  getStudioLayerLiftArtifactWorkerResultTransferList,
  isStudioLayerLiftArtifactWorkerError,
  isStudioLayerLiftArtifactWorkerRequest,
  isStudioLayerLiftArtifactWorkerResponse,
  isStudioLayerLiftArtifactWorkerResult,
  type StudioLayerLiftArtifactWorkerRequest,
  type StudioLayerLiftArtifactWorkerResult,
} from "./studio-layer-lift-artifact-worker-protocol";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;

function request(): StudioLayerLiftArtifactWorkerRequest {
  const backgroundBytes = new ArrayBuffer(60);
  const foregroundBytes = new ArrayBuffer(61);
  return {
    version: STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION,
    kind: STUDIO_LAYER_LIFT_ARTIFACT_WORKER_REQUEST_KIND,
    generation: 7,
    sequence: 11,
    requestId: "lift-request-1",
    sourceId: "scene-source-1",
    sourceWidth: 4,
    sourceHeight: 1,
    backgroundOutputId: "background-output-1",
    foregroundOutputId: "foreground-output-1",
    backgroundByteLength: backgroundBytes.byteLength,
    foregroundByteLength: foregroundBytes.byteLength,
    backgroundBytes,
    foregroundBytes,
  };
}

function receipt(): StudioLayerLiftArtifactPairReceipt {
  return {
    kind: STUDIO_LAYER_LIFT_ARTIFACT_KIND,
    version: STUDIO_LAYER_LIFT_ARTIFACT_VERSION,
    requestId: "lift-request-1",
    sourceId: "scene-source-1",
    sourceWidth: 4,
    sourceHeight: 1,
    background: {
      outputId: "background-output-1",
      width: 4,
      height: 1,
      pixelCount: 4,
      byteLength: 60,
      decodedByteLength: 16,
      sha256: HASH_A,
    },
    foreground: {
      outputId: "foreground-output-1",
      width: 4,
      height: 1,
      pixelCount: 4,
      byteLength: 61,
      decodedByteLength: 16,
      sha256: HASH_B,
    },
    aggregatePixelCount: 8,
    aggregateByteLength: 121,
    aggregateDecodedByteLength: 32,
    receiptSha256: HASH_C,
  };
}

function result(): StudioLayerLiftArtifactWorkerResult {
  const backgroundBytes = new ArrayBuffer(60);
  const foregroundBytes = new ArrayBuffer(61);
  return {
    version: STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION,
    kind: STUDIO_LAYER_LIFT_ARTIFACT_WORKER_RESULT_KIND,
    generation: 7,
    sequence: 11,
    receipt: receipt(),
    backgroundByteLength: backgroundBytes.byteLength,
    foregroundByteLength: foregroundBytes.byteLength,
    backgroundBytes,
    foregroundBytes,
  };
}

describe("studio-layer-lift artifact worker protocol", () => {
  it("accepts an exact request and transfers both owned buffers", () => {
    const value = request();
    expect(isStudioLayerLiftArtifactWorkerRequest(value)).toBe(true);
    expect(getStudioLayerLiftArtifactWorkerRequestTransferList(value)).toEqual([
      value.backgroundBytes,
      value.foregroundBytes,
    ]);
  });

  it("rejects extra, inherited, accessor, length, budget, and authority fields", () => {
    const extra = { ...request(), extra: true };
    expect(isStudioLayerLiftArtifactWorkerRequest(extra)).toBe(false);

    const inherited = Object.create(request()) as unknown;
    expect(isStudioLayerLiftArtifactWorkerRequest(inherited)).toBe(false);

    const accessor = { ...request() } as Record<string, unknown>;
    Object.defineProperty(accessor, "sourceId", {
      enumerable: true,
      get: () => "scene-source-1",
    });
    expect(isStudioLayerLiftArtifactWorkerRequest(accessor)).toBe(false);

    expect(
      isStudioLayerLiftArtifactWorkerRequest({
        ...request(),
        backgroundByteLength: 59,
      }),
    ).toBe(false);
    expect(
      isStudioLayerLiftArtifactWorkerRequest({
        ...request(),
        backgroundBytes: new ArrayBuffer(8 * 1024 * 1024 + 1),
        backgroundByteLength: 8 * 1024 * 1024 + 1,
      }),
    ).toBe(false);
    expect(
      isStudioLayerLiftArtifactWorkerRequest({
        ...request(),
        sourceWidth: 8_193,
      }),
    ).toBe(false);
    expect(
      isStudioLayerLiftArtifactWorkerRequest({
        ...request(),
        foregroundOutputId: "background-output-1",
      }),
    ).toBe(false);
  });

  it("rejects shared memory instead of accepting it as transferable ownership", () => {
    if (typeof SharedArrayBuffer !== "function") {
      return;
    }
    expect(
      isStudioLayerLiftArtifactWorkerRequest({
        ...request(),
        backgroundBytes: new SharedArrayBuffer(60),
      }),
    ).toBe(false);
  });

  it("accepts an exact result envelope and exposes its two transferables", () => {
    const value = result();
    expect(isStudioLayerLiftArtifactWorkerResult(value)).toBe(true);
    expect(isStudioLayerLiftArtifactWorkerResponse(value)).toBe(true);
    expect(getStudioLayerLiftArtifactWorkerResultTransferList(value)).toEqual([
      value.backgroundBytes,
      value.foregroundBytes,
    ]);
  });

  it("rejects malformed receipts and result byte-length mismatches", () => {
    expect(
      isStudioLayerLiftArtifactWorkerResult({
        ...result(),
        receipt: { version: STUDIO_LAYER_LIFT_ARTIFACT_VERSION },
      }),
    ).toBe(false);
    expect(
      isStudioLayerLiftArtifactWorkerResult({
        ...result(),
        receipt: {
          ...receipt(),
          aggregateByteLength: 122,
        },
      }),
    ).toBe(false);
    expect(
      isStudioLayerLiftArtifactWorkerResult({
        ...result(),
        receipt: {
          ...receipt(),
          background: {
            ...receipt().background,
            outputId: "foreground-output-1",
          },
        },
      }),
    ).toBe(false);
    expect(
      isStudioLayerLiftArtifactWorkerResult({
        ...result(),
        backgroundByteLength: 59,
      }),
    ).toBe(false);
  });

  it("accepts only bounded, exact worker errors", () => {
    const error = {
      version: STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION,
      kind: STUDIO_LAYER_LIFT_ARTIFACT_WORKER_ERROR_KIND,
      generation: 7,
      sequence: 11,
      code: "invalid-png",
      message: "CRC mismatch",
    };
    expect(isStudioLayerLiftArtifactWorkerError(error)).toBe(true);
    expect(isStudioLayerLiftArtifactWorkerResponse(error)).toBe(true);
    expect(
      isStudioLayerLiftArtifactWorkerError({ ...error, code: "unknown" }),
    ).toBe(false);
    expect(
      isStudioLayerLiftArtifactWorkerError({ ...error, extra: true }),
    ).toBe(false);
    expect(
      isStudioLayerLiftArtifactWorkerError({
        ...error,
        message: "x".repeat(501),
      }),
    ).toBe(false);
  });
});
