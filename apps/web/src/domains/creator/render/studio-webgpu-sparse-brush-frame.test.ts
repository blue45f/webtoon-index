import { describe, expect, it } from "vitest";

import { StudioGpuSparseBrushFramePlanner } from "./studio-webgpu-sparse-brush-frame";

function dab(x: number, y: number, radius: number) {
  return { x, y, radius };
}

describe("Studio WebGPU sparse brush frame planner", () => {
  it("combines stable tile bins with physical atlas assignments", () => {
    const planner = new StudioGpuSparseBrushFramePlanner({
      columns: 2,
      rows: 1,
      tileSize: 128,
    });
    const prepared = planner.prepareFrame({
      frameId: "frame-1",
      documentWidth: 256,
      documentHeight: 128,
      dabs: [
        dab(64, 64, 12),
        dab(128, 64, 4),
        dab(192, 64, 12),
      ],
    });

    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;
    expect(prepared.frame.tiles.map((tile) => ({
      id: tile.logicalTileId,
      slot: tile.assignment.slot,
      dabs: [...tile.dabIndices],
    }))).toEqual([
      { id: "0:0", slot: 0, dabs: [0, 1] },
      { id: "1:0", slot: 1, dabs: [1, 2] },
    ]);
    expect(planner.completeFrame(prepared.frame.token)).toMatchObject({
      status: "completed",
      frameId: "frame-1",
      residentTiles: 2,
    });
  });

  it("intersects non-empty work with an explicit visible tile set", () => {
    const planner = new StudioGpuSparseBrushFramePlanner({
      columns: 1,
      rows: 1,
      tileSize: 128,
    });
    const prepared = planner.prepareFrame({
      frameId: "visible",
      documentWidth: 256,
      documentHeight: 128,
      visibleTileIds: ["1:0"],
      dabs: [dab(64, 64, 8), dab(192, 64, 8)],
    });

    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;
    expect(prepared.frame.tiles).toHaveLength(1);
    expect(prepared.frame.tiles[0]).toMatchObject({
      logicalTileId: "1:0",
      column: 1,
      row: 0,
    });
    expect([...prepared.frame.tiles[0]!.dabIndices]).toEqual([1]);
    expect(planner.abortFrame(prepared.frame.token).status).toBe("aborted");
    expect(planner.stats().residentTiles).toBe(0);
  });

  it("fails without mutating residency when non-empty work exceeds atlas capacity", () => {
    const planner = new StudioGpuSparseBrushFramePlanner({
      columns: 1,
      rows: 1,
      tileSize: 128,
    });
    expect(planner.prepareFrame({
      frameId: "overflow",
      documentWidth: 256,
      documentHeight: 128,
      dabs: [dab(64, 64, 8), dab(192, 64, 8)],
    })).toEqual({
      status: "rejected",
      reason: "atlas-capacity",
    });
    expect(planner.stats()).toMatchObject({
      residentTiles: 0,
      activeFrameId: null,
    });
  });

  it("rejects malformed visibility filters before acquiring an atlas frame", () => {
    const planner = new StudioGpuSparseBrushFramePlanner({
      columns: 2,
      rows: 1,
      tileSize: 128,
    });
    expect(planner.prepareFrame({
      frameId: "invalid-visible",
      documentWidth: 256,
      documentHeight: 128,
      visibleTileIds: ["2:0"],
      dabs: [dab(64, 64, 8)],
    })).toEqual({ status: "rejected", reason: "invalid-visible-tiles" });
    expect(planner.prepareFrame({
      frameId: "duplicate-visible",
      documentWidth: 256,
      documentHeight: 128,
      visibleTileIds: ["0:0", "0:0"],
      dabs: [dab(64, 64, 8)],
    })).toEqual({ status: "rejected", reason: "invalid-visible-tiles" });
    expect(planner.stats().activeFrameId).toBeNull();
  });

  it("revokes prepared topology when the device generation changes", () => {
    const planner = new StudioGpuSparseBrushFramePlanner({
      columns: 1,
      rows: 1,
      tileSize: 128,
    });
    const prepared = planner.prepareFrame({
      frameId: "before-loss",
      documentWidth: 128,
      documentHeight: 128,
      dabs: [dab(64, 64, 8)],
    });
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;

    expect(planner.resetDevice()).toBe(2);
    expect(planner.completeFrame(prepared.frame.token)).toEqual({
      status: "rejected",
      reason: "stale-generation",
    });
  });
});
