import { describe, expect, it } from "vitest";

import { prepareStudioLayerLiftMask } from "./studio-layer-lift-mask";
import {
  STUDIO_LAYER_LIFT_MASK_WORKER_MAX_AGGREGATE_NEIGHBOR_VISITS,
  STUDIO_LAYER_LIFT_MASK_WORKER_MAX_PEAK_BYTES,
  admitStudioLayerLiftMaskWorkerInput,
  createStudioLayerLiftMaskWorkerResultMessage,
  createStudioLayerLiftMaskWorkerRunMessage,
  decodeStudioLayerLiftMaskWorkerResult,
  isStudioLayerLiftMaskWorkerResponseMessage,
  isStudioLayerLiftMaskWorkerRunMessage,
  preflightStudioLayerLiftMaskWorker,
  studioLayerLiftMaskWorkerRequestTransfers,
  type StudioLayerLiftMaskWorkerInput,
  type StudioLayerLiftMaskWorkerResultMessage,
} from "./studio-layer-lift-mask-worker-protocol";
import {
  executeStudioLayerLiftMaskWorkerMessage,
} from "./studio-layer-lift-mask.worker";

function input(): StudioLayerLiftMaskWorkerInput {
  return {
    confidence: {
      width: 2,
      height: 1,
      confidence: Float32Array.from([1, 0]),
    },
    sourceAlpha: {
      width: 4,
      height: 1,
      alpha: Uint8ClampedArray.from([64, 128, 192, 255]),
    },
    options: { threshold: 0.5 },
  };
}

function runMessage(requestId = 1, epoch = 1) {
  return createStudioLayerLiftMaskWorkerRunMessage(
    admitStudioLayerLiftMaskWorkerInput(input()),
    requestId,
    epoch,
  );
}

function successMessage(): StudioLayerLiftMaskWorkerResultMessage {
  const request = runMessage();
  const result = prepareStudioLayerLiftMask(input());
  return createStudioLayerLiftMaskWorkerResultMessage(request, result);
}

describe("studio layer-lift mask Worker protocol", () => {
  it("admits an exact dense request and transfers both caller-owned inputs", () => {
    const owned = input();
    const message = createStudioLayerLiftMaskWorkerRunMessage(
      admitStudioLayerLiftMaskWorkerInput(owned),
      7,
      3,
    );

    expect(isStudioLayerLiftMaskWorkerRunMessage(message)).toBe(true);
    expect(studioLayerLiftMaskWorkerRequestTransfers(message)).toEqual([
      owned.confidence.confidence.buffer,
      owned.sourceAlpha.alpha.buffer,
    ]);

    const received = structuredClone(message, {
      transfer: studioLayerLiftMaskWorkerRequestTransfers(message),
    });
    expect(owned.confidence.confidence.byteLength).toBe(0);
    expect(owned.sourceAlpha.alpha.byteLength).toBe(0);
    expect(isStudioLayerLiftMaskWorkerRunMessage(received)).toBe(true);
  });

  it("rejects unknown keys, accessors, and sparse transfer-plane tuples", () => {
    const extra = runMessage();
    expect(isStudioLayerLiftMaskWorkerRunMessage({
      ...extra,
      unexpected: true,
    })).toBe(false);

    const nested = runMessage();
    expect(isStudioLayerLiftMaskWorkerRunMessage({
      ...nested,
      request: {
        ...nested.request,
        options: { ...nested.request.options, endpoint: "remote" },
      },
    })).toBe(false);

    const sparse = runMessage();
    const sparsePlanes = new Array(2);
    sparsePlanes[0] = sparse.request.planes[0];
    expect(isStudioLayerLiftMaskWorkerRunMessage({
      ...sparse,
      request: { ...sparse.request, planes: sparsePlanes },
    })).toBe(false);

    const accessor = { ...runMessage() };
    Object.defineProperty(accessor, "requestId", {
      enumerable: true,
      get: () => 1,
    });
    expect(isStudioLayerLiftMaskWorkerRunMessage(accessor)).toBe(false);
  });

  it("reuses core morphology accounting and aggregates island neighbour work", () => {
    const pixelCount = 4_096 * 4_096;
    const four = preflightStudioLayerLiftMaskWorker({
      confidenceWidth: 4_096,
      confidenceHeight: 4_096,
      sourceWidth: 4_096,
      sourceHeight: 4_096,
      options: {
        morphology: {
          operation: "close",
          iterations: 1,
          connectivity: 4,
        },
      },
    });
    expect(four.ok).toBe(true);
    if (!four.ok) return;
    expect(four.value).toMatchObject({
      morphologyPassCount: 2,
      morphologyMaximumNeighborsPerPixel: 5,
      morphologyMaximumNeighborVisits: pixelCount * 2 * 5,
    });

    const eight = preflightStudioLayerLiftMaskWorker({
      confidenceWidth: 4_096,
      confidenceHeight: 4_096,
      sourceWidth: 4_096,
      sourceHeight: 4_096,
      options: {
        morphology: {
          operation: "close",
          iterations: 1,
          connectivity: 8,
        },
      },
    });
    expect(eight).toMatchObject({
      ok: true,
      value: {
        morphologyPassCount: 2,
        morphologyMaximumNeighborsPerPixel: 9,
        morphologyMaximumNeighborVisits:
          STUDIO_LAYER_LIFT_MASK_WORKER_MAX_AGGREGATE_NEIGHBOR_VISITS,
      },
    });

    expect(preflightStudioLayerLiftMaskWorker({
      confidenceWidth: 4_096,
      confidenceHeight: 4_096,
      sourceWidth: 4_096,
      sourceHeight: 4_096,
      options: {
        morphology: {
          operation: "close",
          iterations: 1,
          connectivity: 8,
        },
        islands: { minimumPixels: 2, connectivity: 4 },
      },
    })).toMatchObject({ ok: false, code: "work-budget-exceeded" });
  });

  it("rejects the aggregate full-frame peak before allocating raster planes", () => {
    const result = preflightStudioLayerLiftMaskWorker({
      confidenceWidth: 8_192,
      confidenceHeight: 2_048,
      sourceWidth: 4_096,
      sourceHeight: 4_096,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "memory-budget-exceeded",
    });
    expect(STUDIO_LAYER_LIFT_MASK_WORKER_MAX_PEAK_BYTES)
      .toBe(384 * 1024 * 1024);
  });

  it("transfers four exact output buffers and reconstructs client ownership", () => {
    const request = runMessage();
    const workerRequest = structuredClone(request, {
      transfer: studioLayerLiftMaskWorkerRequestTransfers(request),
    });
    const dispatch = executeStudioLayerLiftMaskWorkerMessage(workerRequest);
    if (!dispatch) throw new Error("expected Worker dispatch");
    const message = dispatch.response;
    expect(isStudioLayerLiftMaskWorkerResponseMessage(message)).toBe(true);
    expect(message.type).toBe("studio-layer-lift-mask/result");
    if (message.type !== "studio-layer-lift-mask/result") return;
    const transfers = [...dispatch.transfer];
    expect(transfers).toHaveLength(4);

    const received = structuredClone(message, { transfer: transfers });
    for (const transfer of transfers) {
      expect((transfer as ArrayBuffer).byteLength).toBe(0);
    }
    expect(isStudioLayerLiftMaskWorkerResponseMessage(received)).toBe(true);
    const decoded = decodeStudioLayerLiftMaskWorkerResult(received);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect([...decoded.value.foregroundAlpha.alpha]).toEqual([64, 128, 0, 0]);
    expect(decoded.value.confidence.confidence.buffer.byteLength).toBe(16);
  });

  it("rejects malformed and sparse success output planes", () => {
    const extra = successMessage();
    expect(isStudioLayerLiftMaskWorkerResponseMessage({
      ...extra,
      result: { ...extra.result, unexpected: true },
    })).toBe(false);

    const sparse = successMessage();
    if (!sparse.result.ok) throw new Error("expected success fixture");
    const planes = new Array(4);
    planes[0] = sparse.result.planes[0];
    planes[1] = sparse.result.planes[1];
    planes[3] = sparse.result.planes[3];
    expect(isStudioLayerLiftMaskWorkerResponseMessage({
      ...sparse,
      result: { ...sparse.result, planes },
    })).toBe(false);
  });
});
