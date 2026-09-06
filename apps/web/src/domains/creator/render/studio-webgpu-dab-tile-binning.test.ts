import { describe, expect, it } from "vitest";

import {
  planStudioGpuDabTileBinning,
  studioGpuDabIndicesForTile,
} from "./studio-webgpu-dab-tile-binning";

function dab(x: number, y: number, radius: number) {
  return { x, y, radius };
}

describe("Studio WebGPU dab tile binning", () => {
  it("preserves source order independently inside every tile", () => {
    const result = planStudioGpuDabTileBinning({
      documentWidth: 256,
      documentHeight: 128,
      tileSize: 128,
      dabs: [
        dab(64, 64, 16),
        dab(128, 64, 4),
        dab(192, 64, 16),
      ],
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.plan).toMatchObject({
      columns: 2,
      rows: 1,
      tileCount: 2,
      dabCount: 3,
      referenceCount: 4,
      nonEmptyTileCount: 2,
    });
    expect([...result.plan.tileOffsets]).toEqual([0, 2, 4]);
    expect([...result.plan.dabIndices]).toEqual([0, 1, 1, 2]);
    expect([...(studioGpuDabIndicesForTile(result.plan, 0) ?? [])]).toEqual([0, 1]);
    expect([...(studioGpuDabIndicesForTile(result.plan, 1) ?? [])]).toEqual([1, 2]);
  });

  it("bins one boundary-crossing dab into four neighbouring tiles", () => {
    const result = planStudioGpuDabTileBinning({
      documentWidth: 256,
      documentHeight: 256,
      tileSize: 128,
      dabs: [dab(128, 128, 8)],
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.plan.referenceCount).toBe(4);
    expect(result.plan.nonEmptyTileCount).toBe(4);
    for (let tileIndex = 0; tileIndex < 4; tileIndex += 1) {
      expect([...(studioGpuDabIndicesForTile(result.plan, tileIndex) ?? [])]).toEqual([0]);
    }
    expect(result.plan.tileOffsets[result.plan.tileCount]).toBe(
      result.plan.referenceCount,
    );
  });

  it("uses half-open maximum bounds so a zero-coverage tangent does not schedule a neighbour", () => {
    const result = planStudioGpuDabTileBinning({
      documentWidth: 256,
      documentHeight: 128,
      tileSize: 128,
      dabs: [dab(64, 64, 64)],
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect([...result.plan.tileOffsets]).toEqual([0, 1, 1]);
    expect([...result.plan.dabIndices]).toEqual([0]);
  });

  it("accepts finite off-document dabs without creating references", () => {
    const result = planStudioGpuDabTileBinning({
      documentWidth: 256,
      documentHeight: 128,
      tileSize: 128,
      dabs: [dab(-20, 64, 5), dab(64, 64, 5), dab(300, 64, 5)],
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.plan.referenceCount).toBe(1);
    expect([...result.plan.dabIndices]).toEqual([1]);
  });

  it("rejects reference and tile-grid budgets before oversized allocation", () => {
    expect(planStudioGpuDabTileBinning({
      documentWidth: 256,
      documentHeight: 256,
      tileSize: 128,
      maximumTileReferences: 3,
      dabs: [dab(128, 128, 8)],
    })).toEqual({ status: "rejected", reason: "reference-budget" });

    expect(planStudioGpuDabTileBinning({
      documentWidth: 384,
      documentHeight: 384,
      tileSize: 128,
      maximumTiles: 8,
      dabs: [],
    })).toEqual({ status: "rejected", reason: "tile-grid-limit" });
  });

  it("fails closed for malformed samples and invalid lookup indices", () => {
    expect(planStudioGpuDabTileBinning({
      documentWidth: 256,
      documentHeight: 128,
      dabs: [dab(Number.NaN, 1, 1)],
    })).toEqual({ status: "rejected", reason: "invalid-input" });
    expect(planStudioGpuDabTileBinning({
      documentWidth: 256,
      documentHeight: 128,
      dabs: [dab(1, 1, 0)],
    })).toEqual({ status: "rejected", reason: "invalid-input" });

    const valid = planStudioGpuDabTileBinning({
      documentWidth: 128,
      documentHeight: 128,
      dabs: [dab(64, 64, 2)],
    });
    expect(valid.status).toBe("ready");
    if (valid.status !== "ready") return;
    expect(studioGpuDabIndicesForTile(valid.plan, -1)).toBeNull();
    expect(studioGpuDabIndicesForTile(valid.plan, valid.plan.tileCount)).toBeNull();
  });
});
