import { describe, expect, it } from "vitest";

import {
  StudioTileDocCompositePlanner,
  type StudioTileDocCompositeFramePlan,
  type StudioTileDocCompositeLayer,
} from "./studio-tiledoc-composite-plan";
import { StudioTiledDocumentStore } from "./studio-tiledoc-store";

import type { StudioTileDocViewportTile } from "./studio-tiledoc-store";

function tile(
  layerId: string,
  column: number,
  row: number,
  bufferId: number,
  contentRevision = 1
): StudioTileDocViewportTile {
  return Object.freeze({
    layerId,
    id: `${column}:${row}`,
    column,
    row,
    rect: Object.freeze({ x: column * 64, y: row * 64, width: 64, height: 64 }),
    bufferId,
    contentRevision,
    resident: true,
  });
}

function planned(
  result: ReturnType<StudioTileDocCompositePlanner["plan"]>
): StudioTileDocCompositeFramePlan {
  expect(result.status).toBe("planned");
  return result as StudioTileDocCompositeFramePlan;
}

const layers = (
  ...values: Array<StudioTileDocCompositeLayer | string>
): readonly StudioTileDocCompositeLayer[] => values.map((value) => (
  typeof value === "string" ? { id: value } : value
));

describe("studio tiled document incremental composite planner", () => {
  it("consumes store revisions and dirties only the tile written in place", () => {
    const store = new StudioTiledDocumentStore({
      documentWidth: 128,
      documentHeight: 64,
      tileSize: 64,
    });
    const paint = (red: number) => (pixels: Uint8ClampedArray) => {
      pixels[0] = red;
      pixels[3] = 255;
    };
    store.writeTile("ink", 0, 0, paint(10));
    store.writeTile("ink", 1, 0, paint(20));
    const rect = { x: 0, y: 0, width: 128, height: 64 };
    const planner = new StudioTileDocCompositePlanner();
    planner.plan({
      scopeId: store.viewportScopeId(rect),
      layers: layers("ink"),
      viewportTiles: store.queryViewport(rect),
    });

    store.writeTile("ink", 1, 0, paint(30));
    const edited = planned(planner.plan({
      scopeId: store.viewportScopeId(rect),
      layers: layers("ink"),
      viewportTiles: store.queryViewport(rect),
    }));

    expect(edited.dirtyTileIds).toEqual(["1:0"]);
    expect(edited.reusedTileCount).toBe(1);
  });

  it("reuses a byte-identical frame and keeps the thumbnail visual revision stable", () => {
    const planner = new StudioTileDocCompositePlanner();
    const input = {
      scopeId: "viewport:0:0:1:0",
      layers: layers("ink", "color"),
      viewportTiles: [tile("ink", 0, 0, 1), tile("color", 0, 0, 2)],
    } as const;

    const first = planned(planner.plan(input));
    const second = planned(planner.plan(input));

    expect(first.dirtyTileIds).toEqual(["0:0"]);
    expect(second.dirtyTileIds).toEqual([]);
    expect(second.tiles[0]).toBe(first.tiles[0]);
    expect(second.reusedTileCount).toBe(1);
    expect(second.visualRevision).toBe(first.visualRevision);
  });

  it("turns a non-overlapping layer reorder into zero composite work", () => {
    const planner = new StudioTileDocCompositePlanner();
    const viewportTiles = [tile("ink", 0, 0, 1), tile("color", 1, 0, 2)];
    const first = planned(planner.plan({
      scopeId: "viewport",
      layers: layers("ink", "color"),
      viewportTiles,
    }));
    const reordered = planned(planner.plan({
      scopeId: "viewport",
      layers: layers("color", "ink"),
      viewportTiles,
    }));

    expect(reordered.dirtyTileIds).toEqual([]);
    expect(reordered.reusedTileCount).toBe(2);
    expect(reordered.visualRevision).toBe(first.visualRevision);
  });

  it("keeps a 256-layer non-overlap reorder at zero dirty tiles", () => {
    const planner = new StudioTileDocCompositePlanner();
    const manyLayers = Array.from({ length: 256 }, (_, index) => ({ id: `layer-${index}` }));
    const manyTiles = manyLayers.map((layer, index) => tile(
      layer.id,
      index,
      0,
      index + 1
    ));
    const first = planned(planner.plan({
      scopeId: "wide-viewport",
      layers: manyLayers,
      viewportTiles: manyTiles,
    }));
    const reordered = planned(planner.plan({
      scopeId: "wide-viewport",
      layers: [...manyLayers].reverse(),
      viewportTiles: manyTiles,
    }));

    expect(first.dirtyTileIds).toHaveLength(256);
    expect(reordered.dirtyTileIds).toEqual([]);
    expect(reordered.reusedTileCount).toBe(256);
    expect(reordered.visualRevision).toBe(first.visualRevision);
  });

  it("invalidates only overlapping tiles when relative layer order changes", () => {
    const planner = new StudioTileDocCompositePlanner();
    const viewportTiles = [
      tile("ink", 0, 0, 1),
      tile("ink", 1, 0, 2),
      tile("color", 0, 0, 3),
    ];
    planner.plan({
      scopeId: "viewport",
      layers: layers("ink", "color"),
      viewportTiles,
    });
    const reordered = planned(planner.plan({
      scopeId: "viewport",
      layers: layers("color", "ink"),
      viewportTiles,
    }));

    expect(reordered.dirtyTileIds).toEqual(["0:0"]);
    expect(reordered.reusedTileCount).toBe(1);
    expect(reordered.tiles.find((entry) => entry.id === "0:0")?.stack.map((entry) => entry.layerId))
      .toEqual(["color", "ink"]);
  });

  it("scopes opacity, visibility and in-place pixel changes to their affected tiles", () => {
    const planner = new StudioTileDocCompositePlanner();
    const viewportTiles = [
      tile("ink", 0, 0, 1),
      tile("ink", 1, 0, 2),
      tile("color", 0, 0, 3),
    ];
    planner.plan({
      scopeId: "viewport",
      layers: layers("ink", "color"),
      viewportTiles,
    });

    const opacity = planned(planner.plan({
      scopeId: "viewport",
      layers: layers({ id: "ink", opacity: 0.5 }, "color"),
      viewportTiles,
    }));
    expect(opacity.dirtyTileIds).toEqual(["0:0", "1:0"]);

    const hidden = planned(planner.plan({
      scopeId: "viewport",
      layers: layers({ id: "ink", opacity: 0.5 }, { id: "color", visible: false }),
      viewportTiles,
    }));
    expect(hidden.dirtyTileIds).toEqual(["0:0"]);

    const editedTiles = viewportTiles.map((entry) => (
      entry.layerId === "ink" && entry.id === "1:0"
        ? tile("ink", 1, 0, entry.bufferId, entry.contentRevision + 1)
        : entry
    ));
    const edited = planned(planner.plan({
      scopeId: "viewport",
      layers: layers({ id: "ink", opacity: 0.5 }, { id: "color", visible: false }),
      viewportTiles: editedTiles,
    }));
    expect(edited.dirtyTileIds).toEqual(["1:0"]);
  });

  it("emits a deleted tile as a one-frame clear without retaining an empty cache entry", () => {
    const planner = new StudioTileDocCompositePlanner();
    planner.plan({
      scopeId: "viewport",
      layers: layers("ink"),
      viewportTiles: [tile("ink", 0, 0, 1)],
    });

    const cleared = planned(planner.plan({
      scopeId: "viewport",
      layers: layers("ink"),
      viewportTiles: [],
    }));
    const steady = planned(planner.plan({
      scopeId: "viewport",
      layers: layers("ink"),
      viewportTiles: [],
    }));

    expect(cleared.dirtyTileIds).toEqual(["0:0"]);
    expect(cleared.tiles[0]?.stack).toEqual([]);
    expect(steady.dirtyTileIds).toEqual([]);
    expect(steady.tiles).toEqual([]);
  });

  it("starts a fresh dirty comparison when the viewport scope changes", () => {
    const planner = new StudioTileDocCompositePlanner();
    const viewportTiles = [tile("ink", 0, 0, 1)];
    const first = planned(planner.plan({
      scopeId: "viewport-a",
      layers: layers("ink"),
      viewportTiles,
    }));
    const moved = planned(planner.plan({
      scopeId: "viewport-b",
      layers: layers("ink"),
      viewportTiles,
    }));

    expect(first.dirtyTileIds).toEqual(["0:0"]);
    expect(moved.dirtyTileIds).toEqual(["0:0"]);
    expect(moved.reusedTileCount).toBe(0);
  });

  it("fails closed for ambiguous layer and tile contracts", () => {
    const planner = new StudioTileDocCompositePlanner();
    expect(planner.plan({
      scopeId: "viewport",
      layers: layers("ink", "ink"),
      viewportTiles: [],
    })).toEqual({ status: "rejected", reason: "duplicate-layer" });
    expect(planner.plan({
      scopeId: "viewport",
      layers: layers("ink"),
      viewportTiles: [tile("unknown", 0, 0, 1)],
    })).toEqual({ status: "rejected", reason: "unknown-layer" });
    const duplicate = tile("ink", 0, 0, 1);
    expect(planner.plan({
      scopeId: "viewport",
      layers: layers("ink"),
      viewportTiles: [duplicate, duplicate],
    })).toEqual({ status: "rejected", reason: "duplicate-tile-reference" });
  });
});
