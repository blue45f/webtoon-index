import { describe, expect, it } from "vitest";

import { StudioTiledDocumentStore, type StudioTileDocTileWriter } from "./studio-tiledoc-store";
import {
  StudioTileDocWebGpuBridge,
  type StudioTileDocWebGpuConsumer,
  type StudioTileDocWebGpuConsumerResult,
  type StudioTileDocWebGpuFrame,
} from "./studio-tiledoc-webgpu-bridge";

function paint(red: number): StudioTileDocTileWriter {
  return (pixels) => {
    pixels[0] = red;
    pixels[3] = 255;
  };
}

function receipt(
  frame: StudioTileDocWebGpuFrame,
  overrides: Partial<Extract<StudioTileDocWebGpuConsumerResult, { status: "presented" }>> = {}
): Extract<StudioTileDocWebGpuConsumerResult, { status: "presented" }> {
  return {
    status: "presented",
    backend: "webgpu",
    requestSequence: frame.requestSequence,
    presentationRevision: frame.expectedPresentationRevision,
    contentRevision: frame.expectedContentRevision,
    plannerFrameSequence: frame.plannerFrameSequence,
    plannerVisualRevision: frame.plannerVisualRevision,
    scopeId: frame.scopeId,
    visibleTileIds: frame.visibleTileIds,
    processedDirtyTileIds: frame.dirtyTileIds,
    deviceGeneration: 7,
    ...overrides,
  };
}

function recordingConsumer(
  handler: (
    frame: StudioTileDocWebGpuFrame,
    signal: AbortSignal
  ) => Promise<StudioTileDocWebGpuConsumerResult> = async (frame) => receipt(frame),
  supportedBlendModes: readonly string[] = ["normal"]
): StudioTileDocWebGpuConsumer & { readonly frames: StudioTileDocWebGpuFrame[] } {
  const frames: StudioTileDocWebGpuFrame[] = [];
  return {
    supportedBlendModes,
    frames,
    async present(frame, signal) {
      frames.push(frame);
      return handler(frame, signal);
    },
  };
}

function makeStore(): StudioTiledDocumentStore {
  return new StudioTiledDocumentStore({
    documentWidth: 128,
    documentHeight: 64,
    tileSize: 64,
  });
}

const VIEWPORT = Object.freeze({ x: 0, y: 0, width: 128, height: 64 });
const INK_LAYER = Object.freeze([{ id: "ink" }]);

describe("studio tiled document WebGPU bridge", () => {
  it("copies and re-composites only dirty tiles while still presenting every cached visible tile", async () => {
    const store = makeStore();
    store.writeTile("ink", 0, 0, paint(10));
    store.writeTile("ink", 1, 0, paint(20));
    const consumer = recordingConsumer();
    const bridge = new StudioTileDocWebGpuBridge({ store, consumer });

    const first = await bridge.present({ viewport: VIEWPORT, layers: INK_LAYER });
    expect(first).toMatchObject({
      status: "ready",
      presentationRevision: 1,
      contentRevision: 1,
      visibleTileCount: 2,
      dirtyTileIds: ["0:0", "1:0"],
      snapshotBytes: 2 * 64 * 64 * 4,
    });
    expect(consumer.frames[0]?.dirtyTiles.map((tile) => tile.action))
      .toEqual(["composite", "composite"]);

    const pannedInsideSameTileSpan = Object.freeze({ x: 1, y: 0, width: 127, height: 64 });
    const unchanged = await bridge.present({
      viewport: pannedInsideSameTileSpan,
      layers: INK_LAYER,
    });
    expect(unchanged).toMatchObject({
      status: "ready",
      presentationRevision: 2,
      contentRevision: 1,
      visibleTileCount: 2,
      dirtyTileIds: [],
      snapshotBytes: 0,
    });
    expect(consumer.frames[1]?.visibleTileIds).toEqual(["0:0", "1:0"]);
    expect(consumer.frames[1]?.dirtyTiles).toEqual([]);
    expect(consumer.frames[1]?.viewport).toEqual(pannedInsideSameTileSpan);

    store.writeTile("ink", 1, 0, paint(30));
    const edited = await bridge.present({ viewport: VIEWPORT, layers: INK_LAYER });
    expect(edited).toMatchObject({
      status: "ready",
      presentationRevision: 3,
      contentRevision: 2,
      dirtyTileIds: ["1:0"],
      snapshotBytes: 64 * 64 * 4,
    });
    expect(consumer.frames[2]?.dirtyTiles[0]?.stack[0]?.rgba[0]).toBe(30);
  });

  it("emits a deleted source tile once as an exact GPU clear task", async () => {
    const store = makeStore();
    store.writeTile("ink", 0, 0, paint(10));
    const consumer = recordingConsumer();
    const bridge = new StudioTileDocWebGpuBridge({ store, consumer });
    await bridge.present({ viewport: VIEWPORT, layers: INK_LAYER });

    store.deleteTile("ink", 0, 0);
    const cleared = await bridge.present({ viewport: VIEWPORT, layers: INK_LAYER });
    expect(cleared).toMatchObject({
      status: "ready",
      contentRevision: 2,
      visibleTileCount: 0,
      dirtyTileIds: ["0:0"],
      snapshotBytes: 0,
    });
    expect(consumer.frames[1]?.dirtyTiles).toMatchObject([{
      id: "0:0",
      action: "clear",
      stack: [],
    }]);

    const steady = await bridge.present({ viewport: VIEWPORT, layers: INK_LAYER });
    expect(steady).toMatchObject({ status: "ready", contentRevision: 2, dirtyTileIds: [] });
  });

  it("uses detached revision-fenced pixels that cannot mutate the document store", async () => {
    const store = makeStore();
    store.writeTile("ink", 0, 0, paint(10));
    const descriptor = store.queryViewport(VIEWPORT)[0]!;
    const snapshot = store.copyBufferSnapshot(
      descriptor.bufferId,
      descriptor.contentRevision
    );
    expect(snapshot?.pixels).not.toBe(store.bufferPixels(descriptor.bufferId));
    snapshot!.pixels[0] = 240;
    expect(store.readTilePixels("ink", 0, 0)?.[0]).toBe(10);

    store.writeTile("ink", 0, 0, paint(20));
    expect(store.copyBufferSnapshot(
      descriptor.bufferId,
      descriptor.contentRevision
    )).toBeNull();
  });

  it("does not commit a lying receipt and forces the next attempt to rebuild every visible tile", async () => {
    const store = makeStore();
    store.writeTile("ink", 0, 0, paint(10));
    store.writeTile("ink", 1, 0, paint(20));
    let call = 0;
    const consumer = recordingConsumer(async (frame) => {
      call += 1;
      if (call === 2) {
        return receipt(frame, { processedDirtyTileIds: [] });
      }
      return receipt(frame);
    });
    const bridge = new StudioTileDocWebGpuBridge({ store, consumer });
    await bridge.present({ viewport: VIEWPORT, layers: INK_LAYER });

    store.writeTile("ink", 1, 0, paint(30));
    const mismatched = await bridge.present({ viewport: VIEWPORT, layers: INK_LAYER });
    expect(mismatched).toEqual({
      status: "rejected",
      reason: "consumer-receipt-mismatch",
      requestSequence: 2,
    });
    expect(bridge.stats()).toMatchObject({
      presentationRevision: 1,
      contentRevision: 1,
    });

    const retry = await bridge.present({ viewport: VIEWPORT, layers: INK_LAYER });
    expect(retry).toMatchObject({
      status: "ready",
      requestSequence: 3,
      presentationRevision: 2,
      contentRevision: 2,
      dirtyTileIds: ["0:0", "1:0"],
    });
  });

  it("fails closed before consumption for unsupported blend modes and non-resident sources", async () => {
    const store = makeStore();
    store.writeTile("ink", 0, 0, paint(10));
    const consumer = recordingConsumer();
    const bridge = new StudioTileDocWebGpuBridge({ store, consumer });

    const unsupported = await bridge.present({
      viewport: VIEWPORT,
      layers: [{ id: "ink", blendMode: "multiply" }],
    });
    expect(unsupported).toMatchObject({
      status: "rejected",
      reason: "unsupported-blend-mode",
      tileId: "0:0",
      layerId: "ink",
    });
    expect(consumer.frames).toHaveLength(0);

    const descriptor = store.queryViewport(VIEWPORT)[0]!;
    expect(store.markPersisted(descriptor.bufferId, "blob:ink")).toBe(true);
    expect(store.evictBuffers([descriptor.bufferId]).evicted).toEqual([descriptor.bufferId]);
    const nonResident = await bridge.present({ viewport: VIEWPORT, layers: INK_LAYER });
    expect(nonResident).toMatchObject({
      status: "rejected",
      reason: "non-resident",
      tileId: "0:0",
      layerId: "ink",
    });
    expect(consumer.frames).toHaveLength(0);
  });

  it("enforces dirty snapshot budgets before handing a frame to WebGPU", async () => {
    const store = makeStore();
    store.writeTile("ink", 0, 0, paint(10));
    store.writeTile("ink", 1, 0, paint(20));
    const consumer = recordingConsumer();
    const bridge = new StudioTileDocWebGpuBridge({
      store,
      consumer,
      maxDirtyTiles: 1,
    });

    expect(await bridge.present({ viewport: VIEWPORT, layers: INK_LAYER })).toMatchObject({
      status: "rejected",
      reason: "dirty-tile-limit",
    });
    expect(consumer.frames).toHaveLength(0);

    const byteConsumer = recordingConsumer();
    const byteLimited = new StudioTileDocWebGpuBridge({
      store,
      consumer: byteConsumer,
      maxSnapshotBytes: 1,
    });
    expect(await byteLimited.present({ viewport: VIEWPORT, layers: INK_LAYER })).toMatchObject({
      status: "rejected",
      reason: "snapshot-byte-limit",
    });
    expect(byteConsumer.frames).toHaveLength(0);
  });

  it("serializes async presentation and reports busy without superseding the active frame", async () => {
    const store = makeStore();
    store.writeTile("ink", 0, 0, paint(10));
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const consumer = recordingConsumer(async (frame) => {
      await gate;
      return receipt(frame);
    });
    const bridge = new StudioTileDocWebGpuBridge({ store, consumer });

    const active = bridge.present({ viewport: VIEWPORT, layers: INK_LAYER });
    await Promise.resolve();
    expect(await bridge.present({ viewport: VIEWPORT, layers: INK_LAYER })).toEqual({
      status: "rejected",
      reason: "busy",
      requestSequence: 1,
    });
    release!();
    expect(await active).toMatchObject({ status: "ready", presentationRevision: 1 });
  });

  it("invalidates retained comparisons without rewinding committed revision identities", async () => {
    const store = makeStore();
    store.writeTile("ink", 0, 0, paint(10));
    const consumer = recordingConsumer();
    const bridge = new StudioTileDocWebGpuBridge({ store, consumer });
    await bridge.present({ viewport: VIEWPORT, layers: INK_LAYER });
    await bridge.present({ viewport: VIEWPORT, layers: INK_LAYER });

    bridge.invalidate();
    const rebuilt = await bridge.present({ viewport: VIEWPORT, layers: INK_LAYER });
    expect(rebuilt).toMatchObject({
      status: "ready",
      presentationRevision: 3,
      contentRevision: 2,
      dirtyTileIds: ["0:0"],
    });
  });
});
