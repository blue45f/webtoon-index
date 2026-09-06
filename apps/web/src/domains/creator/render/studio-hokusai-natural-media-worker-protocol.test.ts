import { describe, expect, it } from "vitest";

import {
  planStudioHokusaiNaturalMediaRender,
} from "./studio-hokusai-natural-media-contract";
import {
  STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
  STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION,
  snapshotStudioHokusaiWorkerRenderMessage,
  snapshotStudioHokusaiWorkerResultMessage,
} from "./studio-hokusai-natural-media-worker-protocol";

import type { DrawEl } from "../studio-element-model";

function request() {
  const planned = planStudioHokusaiNaturalMediaRender(
    {
      id: "draw-1",
      type: "draw",
      points: [10, 10, 20, 20, 40, 15],
      pressures: [0.25, 0.5, 1],
      stroke: "#000000",
      strokeWidth: 6,
      brush: "gpen",
    } satisfies DrawEl,
    {
      presetId: "pencil",
      color: "#123456",
      sizeScale: 1,
      opacity: 1,
      seed: 7,
    },
    { width: 800, height: 1_200 },
  );
  if (!planned.ok) throw new Error(planned.message);
  return {
    type: "studio-hokusai/render",
    version: STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION,
    requestId: 1,
    engineEpoch: 1,
    plan: planned.plan,
  };
}

function pngHeader(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes.buffer;
}

function result(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const input = request();
  const width = Math.min(16, input.plan.raster.width);
  const height = Math.min(12, input.plan.raster.height);
  return {
    type: "studio-hokusai/result",
    version: STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION,
    requestId: input.requestId,
    engineEpoch: input.engineEpoch,
    pngBytes: pngHeader(width, height),
    receipt: {
      kind: "studio-hokusai/receipt",
      version: STUDIO_HOKUSAI_WORKER_PROTOCOL_VERSION,
      requestId: input.requestId,
      engineEpoch: input.engineEpoch,
      sourceElementId: input.plan.source.elementId,
      presetId: input.plan.presetId,
      materialProfileId: input.plan.materialProfileId,
      seed: input.plan.seed,
      rasterWidth: input.plan.raster.width,
      rasterHeight: input.plan.raster.height,
      outputRasterWidth: width,
      outputRasterHeight: height,
      dirtyBounds: [0, 0, width, height],
      pixelLayout: "packed-dirty-rgba8",
      inputHash: `sha256:${"1".repeat(64)}`,
      pixelHash: `sha256:${"2".repeat(64)}`,
      pngHash: `sha256:${"3".repeat(64)}`,
      adapterVersion: STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
      execution: "dedicated-worker-wasm-packed-dirty-frame",
      complete: true,
    },
    ...overrides,
  };
}

function resultExpectation() {
  const input = request();
  return {
    requestId: input.requestId,
    engineEpoch: input.engineEpoch,
    sourceElementId: input.plan.source.elementId,
    presetId: input.plan.presetId,
    materialProfileId: input.plan.materialProfileId,
    seed: input.plan.seed,
    rasterWidth: input.plan.raster.width,
    rasterHeight: input.plan.raster.height,
  };
}

describe("Studio Hokusai Worker protocol", () => {
  it("copies a valid render message into frozen clone-safe data", () => {
    const input = request();
    const snapshot = snapshotStudioHokusaiWorkerRenderMessage(input);
    expect(snapshot).not.toBeNull();
    expect(snapshot).not.toBe(input);
    expect(snapshot?.plan.samples).not.toBe(input.plan.samples);
    expect(Object.isFrozen(snapshot?.plan.samples)).toBe(true);
  });

  it("rejects extra fields, wrong epochs and malformed sample order", () => {
    expect(snapshotStudioHokusaiWorkerRenderMessage({
      ...request(),
      extra: true,
    })).toBeNull();
    expect(snapshotStudioHokusaiWorkerRenderMessage({
      ...request(),
      engineEpoch: 0,
    })).toBeNull();
    expect(snapshotStudioHokusaiWorkerRenderMessage({
      ...request(),
      version: 2,
    })).toBeNull();
    const legacyPlan = request();
    const { materialProfileId: _legacyMaterialProfile, ...legacyPlanFields } =
      legacyPlan.plan;
    expect(snapshotStudioHokusaiWorkerRenderMessage({
      ...legacyPlan,
      plan: {
        ...legacyPlanFields,
        version: "studio-hokusai-natural-media-v1",
      },
    })).toBeNull();
    const malformed = request();
    expect(snapshotStudioHokusaiWorkerRenderMessage({
      ...malformed,
      plan: {
        ...malformed.plan,
        samples: malformed.plan.samples.map((sample, index) => ({
          ...sample,
          timeMilliseconds: index === 2 ? -1 : sample.timeMilliseconds,
        })),
      },
    })).toBeNull();
  });

  it("accepts only a PNG whose dimensions exactly match its packed dirty rectangle", () => {
    expect(snapshotStudioHokusaiWorkerResultMessage(
      result(),
      resultExpectation(),
    )).not.toBeNull();

    const valid = result();
    expect(snapshotStudioHokusaiWorkerResultMessage({
      ...valid,
      receipt: {
        ...valid.receipt,
        dirtyBounds: [-1, 0, 16, 12],
      },
    }, resultExpectation())).toBeNull();
    expect(snapshotStudioHokusaiWorkerResultMessage({
      ...valid,
      receipt: {
        ...valid.receipt,
        dirtyBounds: [
          valid.receipt.rasterWidth - 1,
          0,
          16,
          12,
        ],
      },
    }, resultExpectation())).toBeNull();
    expect(snapshotStudioHokusaiWorkerResultMessage({
      ...valid,
      receipt: {
        ...valid.receipt,
        outputRasterWidth: 15,
      },
    }, resultExpectation())).toBeNull();
    expect(snapshotStudioHokusaiWorkerResultMessage({
      ...valid,
      pngBytes: pngHeader(15, 12),
    }, resultExpectation())).toBeNull();
    expect(snapshotStudioHokusaiWorkerResultMessage({
      ...valid,
      extra: true,
    }, resultExpectation())).toBeNull();
  });
});
