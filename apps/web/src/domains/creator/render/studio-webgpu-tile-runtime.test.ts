import { describe, expect, it, vi } from "vitest";

import {
  createStudioGpuTileTextureFactory,
  describeStudioGpuTileTexture,
  StudioGpuTileRuntime,
  type StudioGpuTileDocumentContract,
  type StudioGpuTileReleaseReason,
  type StudioGpuTileResourceFactory,
  type StudioGpuTileTextureDescriptor,
} from "./studio-webgpu-tile-runtime";

import type {
  StudioGpuTile,
  StudioGpuTileOperation,
  StudioGpuTileState,
} from "./studio-webgpu-tile-plan";

const CONTRACT: StudioGpuTileDocumentContract = {
  logicalWidth: 1_024,
  logicalHeight: 2_048,
  tileSize: 512,
  bleed: 2,
};

function tile(column: number, row: number): StudioGpuTile {
  const x = column * CONTRACT.tileSize;
  const y = row * CONTRACT.tileSize;
  return {
    id: `${column}:${row}`,
    column,
    row,
    x,
    y,
    width: Math.min(CONTRACT.tileSize, CONTRACT.logicalWidth - x),
    height: Math.min(CONTRACT.tileSize, CONTRACT.logicalHeight - y),
  };
}

function operation(id: string, signature = id): StudioGpuTileOperation {
  return { id, fingerprint: `fast:${signature}`, signature: `exact:${signature}` };
}

function state(
  target: StudioGpuTile,
  operations: readonly StudioGpuTileOperation[]
): StudioGpuTileState {
  return {
    ...target,
    operations,
    logicalWidth: CONTRACT.logicalWidth,
    logicalHeight: CONTRACT.logicalHeight,
    tileSize: CONTRACT.tileSize,
    bleed: CONTRACT.bleed,
  };
}

interface FakeResource {
  readonly serial: number;
  readonly tileId: string;
  readonly descriptor: StudioGpuTileTextureDescriptor;
}

function fakeFactory(failAt = Number.POSITIVE_INFINITY) {
  const created: FakeResource[] = [];
  const destroyed: FakeResource[] = [];
  const factory: StudioGpuTileResourceFactory<FakeResource> = {
    create: (descriptor) => {
      if (created.length + 1 === failAt) throw new Error("allocation failed");
      const resource = { serial: created.length + 1, tileId: descriptor.id, descriptor };
      created.push(resource);
      return resource;
    },
    destroy: (resource) => destroyed.push(resource),
  };
  return { created, destroyed, factory };
}

function prepared<Resource>(
  result: ReturnType<StudioGpuTileRuntime<Resource>["prepareFrame"]>
) {
  expect(result.status).toBe("prepared");
  if (result.status !== "prepared") throw new Error(`Expected prepared, got ${result.reason}`);
  return result;
}

describe("StudioGpuTileRuntime", () => {
  it("allocates only non-empty viewport tiles and exposes bleed-cropped composite items", () => {
    const resources = fakeFactory();
    const runtime = new StudioGpuTileRuntime({ resourceFactory: resources.factory });
    const visible = [tile(1, 0), tile(0, 0)];
    const offscreen = tile(0, 3);
    const frame = prepared(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: visible,
      tileStates: [
        state(tile(0, 0), [operation("left")]),
        state(tile(1, 0), [operation("right")]),
        state(offscreen, [operation("offscreen")]),
      ],
    }));

    expect(resources.created.map((resource) => resource.tileId)).toEqual(["0:0", "1:0"]);
    expect(frame.tasks.map((task) => [task.tile.id, task.mode])).toEqual([
      ["0:0", "rebuild"],
      ["1:0", "rebuild"],
    ]);
    expect(frame.residentBytes).toBe(516 * 516 * 4 * 2);

    const composite = runtime.completeFrame(frame.token);
    expect(composite).toMatchObject({
      kind: "tile-resource-frame",
      items: [
        { tile: { id: "0:0" }, descriptor: { contentX: 2, contentWidth: 512 } },
        { tile: { id: "1:0" }, descriptor: { contentX: 2, contentWidth: 512 } },
      ],
    });
    expect(composite && "complete" in composite).toBe(false);
    expect(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [tile(0, 0)],
      tileStates: [state(tile(0, 0), [operation("left"), operation("new")])],
    })).toMatchObject({
      status: "rejected",
      reason: "busy",
      activeFrameId: frame.frameId,
    });
    expect(runtime.releaseFrame(frame.token)).toBe(true);
    const afterPresentation = prepared(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [tile(0, 0)],
      tileStates: [state(tile(0, 0), [operation("left"), operation("new")])],
    }));
    expect(afterPresentation.tasks[0]).toMatchObject({ mode: "append" });
    expect(afterPresentation.tasks[0]?.resource).toBe(composite?.items[0]?.resource);
  });

  it("retains exact tiles, appends immutable suffixes, and rebuilds historical edits", () => {
    const resources = fakeFactory();
    const runtime = new StudioGpuTileRuntime({ resourceFactory: resources.factory });
    const target = tile(0, 0);
    const firstState = state(target, [operation("first")]);
    const initial = prepared(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [target],
      tileStates: [firstState],
    }));
    runtime.completeFrame(initial.token);
    runtime.releaseFrame(initial.token);

    const clean = prepared(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [target],
      tileStates: [state(target, [{ ...operation("first") }])],
    }));
    expect(clean.tasks).toEqual([]);
    runtime.completeFrame(clean.token);
    runtime.releaseFrame(clean.token);

    const appendedState = state(target, [operation("first"), operation("second")]);
    const appended = prepared(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [target],
      tileStates: [appendedState],
    }));
    expect(appended.tasks).toEqual([
      expect.objectContaining({
        mode: "append",
        operations: [expect.objectContaining({ id: "second" })],
        previousOperationCount: 1,
        nextOperationCount: 2,
      }),
    ]);
    runtime.completeFrame(appended.token);
    runtime.releaseFrame(appended.token);

    const edited = prepared(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [target],
      tileStates: [state(target, [operation("first", "changed"), operation("second")])],
    }));
    expect(edited.tasks[0]).toMatchObject({
      mode: "rebuild",
      previousOperationCount: 2,
      nextOperationCount: 2,
    });
    expect(edited.tasks[0]?.operations).toHaveLength(2);
  });

  it("evicts deterministic least-recently-used non-visible tiles", () => {
    const resources = fakeFactory();
    const releases: Array<[string, StudioGpuTileReleaseReason]> = [];
    const runtime = new StudioGpuTileRuntime({
      resourceFactory: resources.factory,
      maxEntries: 2,
      onRelease: (id, reason) => releases.push([id, reason]),
    });
    const states = [0, 1, 2].map((row) => state(tile(0, row), [operation(`row-${row}`)]));
    const renderRow = (row: number) => {
      const frame = prepared(runtime.prepareFrame({
        contract: CONTRACT,
        visibleTiles: [tile(0, row)],
        tileStates: states,
      }));
      runtime.completeFrame(frame.token);
      runtime.releaseFrame(frame.token);
    };

    renderRow(0);
    renderRow(1);
    renderRow(0);
    renderRow(2);

    expect(releases).toEqual([["0:1", "budget"]]);
    expect(resources.destroyed.map((resource) => resource.tileId)).toEqual(["0:1"]);
    expect(runtime.getStats()).toMatchObject({ residentEntries: 2, residentBytes: 516 * 516 * 4 * 2 });
  });

  it("rejects an over-budget viewport before evicting or partially allocating it", () => {
    const resources = fakeFactory();
    const runtime = new StudioGpuTileRuntime({
      resourceFactory: resources.factory,
      maxEntries: 1,
    });
    const left = tile(0, 0);
    const right = tile(1, 0);
    const states = [state(left, [operation("left")]), state(right, [operation("right")])];
    const first = prepared(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [left],
      tileStates: states,
    }));
    runtime.completeFrame(first.token);
    runtime.releaseFrame(first.token);

    const rejected = runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [left, right],
      tileStates: states,
    });
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: "budget-exceeded",
      residentEntries: 1,
    });
    expect(resources.destroyed).toEqual([]);
    expect(resources.created).toHaveLength(1);
  });

  it("destroys every possibly-mutated texture on abort and then forces a fresh rebuild", () => {
    const resources = fakeFactory();
    const runtime = new StudioGpuTileRuntime({ resourceFactory: resources.factory });
    const target = tile(0, 0);
    const first = state(target, [operation("first")]);
    const initial = prepared(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [target],
      tileStates: [first],
    }));
    runtime.completeFrame(initial.token);
    runtime.releaseFrame(initial.token);

    const next = state(target, [operation("first"), operation("second")]);
    const append = prepared(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [target],
      tileStates: [next],
    }));
    expect(append.tasks[0]?.mode).toBe("append");
    expect(runtime.abortFrame(append.token)).toEqual(["0:0"]);
    expect(resources.destroyed[0]).toBe(resources.created[0]);

    const recovery = prepared(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [target],
      tileStates: [next],
    }));
    expect(recovery.tasks[0]?.mode).toBe("rebuild");
    expect(recovery.tasks[0]?.resource).not.toBe(append.tasks[0]?.resource);
  });

  it("serializes prepared frames until callers complete or abort GPU work", () => {
    const resources = fakeFactory();
    const runtime = new StudioGpuTileRuntime({ resourceFactory: resources.factory });
    const target = tile(0, 0);
    const first = prepared(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [target],
      tileStates: [state(target, [operation("one")])],
    }));

    expect(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [target],
      tileStates: [state(target, [operation("two")])],
    })).toMatchObject({
      status: "rejected",
      reason: "busy",
      activeFrameId: first.frameId,
    });
    const otherRuntime = new StudioGpuTileRuntime({ resourceFactory: fakeFactory().factory });
    const colliding = prepared(otherRuntime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [target],
      tileStates: [state(target, [operation("other")])],
    }));
    expect(colliding.frameId).toBe(first.frameId);
    expect(otherRuntime.completeFrame(first.token)).toBeNull();
    expect(otherRuntime.getStats().activeFrameId).toBe(colliding.frameId);
    expect(otherRuntime.completeFrame(colliding.token)).not.toBeNull();
    expect(runtime.getStats().activeFrameId).toBe(first.frameId);
  });

  it("cleans up device loss in tile order, rejects stale completion, and recovers empty", () => {
    const original = fakeFactory();
    const replacement = fakeFactory();
    const releases: Array<[string, StudioGpuTileReleaseReason]> = [];
    const runtime = new StudioGpuTileRuntime({
      resourceFactory: original.factory,
      onRelease: (id, reason) => releases.push([id, reason]),
    });
    const upper = tile(1, 0);
    const lower = tile(0, 1);
    const pending = prepared(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [lower, upper],
      tileStates: [state(lower, [operation("lower")]), state(upper, [operation("upper")])],
    }));
    const oldGeneration = pending.deviceGeneration;

    expect(runtime.handleDeviceLost(oldGeneration)).toEqual(["1:0", "0:1"]);
    expect(releases).toEqual([["1:0", "device-loss"], ["0:1", "device-loss"]]);
    expect(runtime.completeFrame(pending.token)).toBeNull();
    expect(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [upper],
      tileStates: [state(upper, [operation("upper")])],
    })).toMatchObject({ status: "rejected", reason: "device-unavailable" });

    expect(runtime.restoreDevice(replacement.factory)).toBe(true);
    const recovered = prepared(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [upper],
      tileStates: [state(upper, [operation("upper")])],
    }));
    expect(recovered.deviceGeneration).toBeGreaterThan(oldGeneration);
    expect(recovered.tasks[0]?.mode).toBe("rebuild");
    expect(runtime.handleDeviceLost(oldGeneration)).toEqual([]);
    expect(runtime.getStats().deviceAvailable).toBe(true);
    expect(runtime.completeFrame(recovered.token)).not.toBeNull();
  });

  it("rolls back newly-created resources when a later tile allocation fails", () => {
    const resources = fakeFactory(2);
    const releases: Array<[string, StudioGpuTileReleaseReason]> = [];
    const runtime = new StudioGpuTileRuntime({
      resourceFactory: resources.factory,
      onRelease: (id, reason) => releases.push([id, reason]),
    });
    const left = tile(0, 0);
    const right = tile(1, 0);

    expect(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [left, right],
      tileStates: [state(left, [operation("left")]), state(right, [operation("right")])],
    })).toMatchObject({
      status: "rejected",
      reason: "allocation-failed",
      residentBytes: 0,
      residentEntries: 0,
    });
    expect(resources.destroyed).toEqual(resources.created);
    expect(releases).toEqual([["0:0", "allocation-rollback"]]);
  });

  it("fails closed for invalid contracts, duplicate tiles, and oversized tile textures", () => {
    const resources = fakeFactory();
    const runtime = new StudioGpuTileRuntime({ resourceFactory: resources.factory });
    const target = tile(0, 0);
    expect(runtime.prepareFrame({
      contract: { ...CONTRACT, logicalHeight: Number.POSITIVE_INFINITY },
      visibleTiles: [target],
      tileStates: [],
    })).toMatchObject({ status: "rejected", reason: "invalid-input" });
    expect(describeStudioGpuTileTexture(target, {
      ...CONTRACT,
      bleed: Number.MAX_VALUE,
    }, {
      resolutionScale: Number.MIN_VALUE,
      bytesPerPixel: 4,
      maxTextureDimension2D: 8_192,
    })).toBeNull();
    expect(runtime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [target, { ...target }],
      tileStates: [],
    })).toMatchObject({ status: "rejected", reason: "invalid-input" });
    expect(describeStudioGpuTileTexture(target, CONTRACT, {
      resolutionScale: 4,
      bytesPerPixel: 4,
      maxTextureDimension2D: 1_024,
    })).toBeNull();
    expect(resources.created).toEqual([]);
  });

  it("uses one global physical edge grid for adjacent tiles at fractional resolution", () => {
    const leftTile = tile(0, 0);
    const rightTile = tile(1, 0);
    const options = {
      resolutionScale: 1.3,
      bytesPerPixel: 4,
      maxTextureDimension2D: 8_192,
    } as const;
    const left = describeStudioGpuTileTexture(leftTile, CONTRACT, options)!;
    const right = describeStudioGpuTileTexture(rightTile, CONTRACT, options)!;

    expect(left.contentWidth).toBe(666);
    expect(right.contentWidth).toBe(665);
    expect(left.contentWidth + right.contentWidth).toBe(Math.round(1_024 * 1.3));
    expect((leftTile.x - left.renderX) / left.renderWidth).toBeCloseTo(
      left.contentX / left.width,
      12
    );
    expect((leftTile.x + leftTile.width - left.renderX) / left.renderWidth).toBeCloseTo(
      (left.contentX + left.contentWidth) / left.width,
      12
    );
    expect((rightTile.x - right.renderX) / right.renderWidth).toBeCloseTo(
      right.contentX / right.width,
      12
    );
  });

  it("derives rgba16float budget cost and creates sampleable render-attachment textures", () => {
    const texture = { destroy: vi.fn() };
    const createTexture = vi.fn(() => texture);
    const device = { createTexture } as unknown as GPUDevice;
    const factory = createStudioGpuTileTextureFactory(device, { format: "rgba16float" });
    const descriptor = describeStudioGpuTileTexture(tile(0, 0), CONTRACT, {
      resolutionScale: 1,
      bytesPerPixel: 8,
      maxTextureDimension2D: 8_192,
    })!;

    const underBudget = new StudioGpuTileRuntime({
      resourceFactory: factory,
      maxBytes: 516 * 516 * 4,
    });
    expect(underBudget.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [tile(0, 0)],
      tileStates: [state(tile(0, 0), [operation("hdr")])],
    })).toMatchObject({
      status: "rejected",
      reason: "budget-exceeded",
      residentBytes: 0,
    });
    expect(createTexture).not.toHaveBeenCalled();

    const sdrFactory = createStudioGpuTileTextureFactory(device, { format: "rgba8unorm" });
    const switchingRuntime = new StudioGpuTileRuntime({ resourceFactory: sdrFactory });
    const sdr = prepared(switchingRuntime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [tile(0, 0)],
      tileStates: [state(tile(0, 0), [operation("sdr")])],
    }));
    expect(sdr.residentBytes).toBe(516 * 516 * 4);
    switchingRuntime.completeFrame(sdr.token);
    const sdrGeneration = switchingRuntime.getStats().deviceGeneration;
    switchingRuntime.handleDeviceLost(sdrGeneration);
    switchingRuntime.restoreDevice(factory);
    const hdr = prepared(switchingRuntime.prepareFrame({
      contract: CONTRACT,
      visibleTiles: [tile(0, 0)],
      tileStates: [state(tile(0, 0), [operation("hdr")])],
    }));
    expect(hdr.residentBytes).toBe(516 * 516 * 8);

    expect(factory.bytesPerPixel).toBe(8);
    expect(factory.create(descriptor)).toBe(texture);
    expect(createTexture).toHaveBeenCalledWith(expect.objectContaining({
      label: "Studio retained tile 0:0",
      size: { width: 516, height: 516, depthOrArrayLayers: 1 },
      format: "rgba16float",
      usage: 0x17,
    }));
    texture.destroy.mockClear();
    factory.destroy(texture as unknown as GPUTexture);
    expect(texture.destroy).toHaveBeenCalledOnce();
  });
});
