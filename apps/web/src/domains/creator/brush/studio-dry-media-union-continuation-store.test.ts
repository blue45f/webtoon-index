import { describe, expect, it } from "vitest";

import {
  createStudioFreehandInputMemoryBinaryCasState,
  createStudioFreehandInputMemoryBinaryCasStore,
} from "../studio-freehand-input-binary-spool-opfs-store";

import {
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
} from "./studio-brush-dynamics";
import { packStudioDryMediaUnionContinuationPages } from "./studio-dry-media-union-continuation-protocol";
import { createStudioDryMediaUnionContinuationStore } from "./studio-dry-media-union-continuation-store";
import { STUDIO_DRY_MEDIA_UNION_RIBBON_CARRIER_VERSION } from "./studio-dry-media-union-ribbon-carrier";

import type { StudioDynamicBrushCoverageMark } from "../studio-dynamic-brush-coverage-renderer";

function mark(): StudioDynamicBrushCoverageMark {
  const groups = Object.freeze(Array.from({ length: 96 }, (_, stationIndex) => Object.freeze({
    stationIndex,
    polygons: Object.freeze([Object.freeze([
      stationIndex, 1,
      stationIndex + 1, 1,
      stationIndex + 0.5, 2,
    ])]),
  })));
  return {
    x: 48,
    y: 1.5,
    radiusX: 48,
    radiusY: 1,
    angleRadians: 0,
    alpha: 1,
    color: "#123456",
    ribbon: {
      kind: "dry-media-union-ribbon-polygon",
      version: STUDIO_DRY_MEDIA_UNION_RIBBON_CARRIER_VERSION,
      role: "stroke-union",
      polygons: groups.flatMap((group) => group.polygons),
      compositing: {
        kind: "causal-group-alpha-max",
        version: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
        programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
        groups,
      },
    },
  };
}

describe("dry-media union continuation CAS", () => {
  it("seals and reopens a domain-separated Merkle root with honest page states", async () => {
    const state = createStudioFreehandInputMemoryBinaryCasState();
    const store = createStudioDryMediaUnionContinuationStore(
      createStudioFreehandInputMemoryBinaryCasStore(state),
    );
    const packed = packStudioDryMediaUnionContinuationPages([mark()]);
    if (packed.status !== "packed") throw new Error(packed.reason);
    const contourPages = [];
    for (const page of packed.pages) contourPages.push(await store.putContourPage(page));
    const rgba = new Uint8ClampedArray(32 * 24 * 4);
    rgba.fill(73);
    const bitmap = await store.putBitmapPage({
      tileX: 0,
      tileY: 0,
      width: 32,
      height: 24,
      rgba,
    });
    const receipt = await store.seal({
      strokeId: "dry-cas-1",
      generation: 7,
      sequence: 11,
      presentationGeneration: 13,
      contourPages,
      bitmapPages: [bitmap],
      logicalByteLength: packed.logicalByteLength,
      slabCapacityByteLength: packed.slabCapacityByteLength,
      residentByteLength: 0,
      metadata: {
        width: 320,
        height: 240,
        transform: [2, 0, 0, 2, 0, 0],
        color: "#123456",
      },
    });
    expect(receipt).toMatchObject({
      contract: "studio-dry-media-union-paged-root-v1",
      programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
      groupCount: 96,
      residentByteLength: 0,
      hydratedByteLength: 0,
      inflightByteLength: 0,
      bitmapPageCount: 1,
    });
    expect(receipt.rootDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(state.rootWriteDigests).toEqual([receipt.rootDigest]);

    const reopened = await store.reopen(receipt.rootDigest);
    expect(reopened).toEqual(receipt);
    expect(reopened).not.toBe(receipt);

    const opened = await store.open(receipt.rootDigest);
    expect(opened).toMatchObject({
      receipt,
      metadata: {
        width: 320,
        height: 240,
        color: "#123456",
      },
    });
    expect(opened?.contourPages).toEqual(contourPages);
    expect(opened?.bitmapPages).toEqual([bitmap]);
    await expect(store.verify(receipt.rootDigest)).resolves.toEqual(receipt);
    const hydratedContour = await store.getContourPage(opened!.contourPages[0]!);
    expect(hydratedContour?.coordinates).toEqual(packed.pages[0]!.coordinates);
    hydratedContour!.coordinates[0] = 999;
    expect((await store.getContourPage(opened!.contourPages[0]!))?.coordinates[0])
      .toBe(packed.pages[0]!.coordinates[0]);
    const hydratedBitmap = await store.getBitmapPage(opened!.bitmapPages[0]!);
    expect(hydratedBitmap?.rgba).toEqual(rgba);

    const controller = new AbortController();
    controller.abort();
    await expect(store.open(receipt.rootDigest, { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("copies page ownership into CAS and rejects a corrupted immutable root", async () => {
    const state = createStudioFreehandInputMemoryBinaryCasState();
    const store = createStudioDryMediaUnionContinuationStore(
      createStudioFreehandInputMemoryBinaryCasStore(state),
    );
    const packed = packStudioDryMediaUnionContinuationPages([mark()]);
    if (packed.status !== "packed") throw new Error(packed.reason);
    const page = packed.pages[0]!;
    const firstByte = new Uint8Array(page.buffer)[0]!;
    const stored = await store.putContourPage(page);
    new Uint8Array(page.buffer)[0] ^= 0xff;
    expect(state.cas.get(`page:${stored.digest}`)?.[0]).toBe(firstByte);

    state.cas.set(`root:${"a".repeat(64)}`, new TextEncoder().encode("corrupt"));
    await expect(store.reopen("a".repeat(64))).resolves.toBeNull();
  });

  it("verifies every metadata and Merkle link before reopening authority", async () => {
    const state = createStudioFreehandInputMemoryBinaryCasState();
    const store = createStudioDryMediaUnionContinuationStore(
      createStudioFreehandInputMemoryBinaryCasStore(state),
    );
    const packed = packStudioDryMediaUnionContinuationPages([mark()]);
    if (packed.status !== "packed") throw new Error(packed.reason);
    const contourPages = await Promise.all(packed.pages.map((page) => (
      store.putContourPage(page)
    )));
    const bitmapPages = [];
    for (let tileX = 0; tileX < 65; tileX += 1) {
      bitmapPages.push(await store.putBitmapPage({
        tileX,
        tileY: 0,
        width: 1,
        height: 1,
        rgba: new Uint8ClampedArray([tileX, 2, 3, 255]),
      }));
    }
    const receipt = await store.seal({
      strokeId: "dry-cas-merkle",
      generation: 1,
      sequence: 1,
      presentationGeneration: 1,
      contourPages,
      bitmapPages,
      logicalByteLength: packed.logicalByteLength,
      slabCapacityByteLength: packed.slabCapacityByteLength,
      residentByteLength: 0,
      metadata: {
        width: 8_320,
        height: 128,
        transform: [1, 0, 0, 1, 0, 0],
        color: "#123456",
      },
    });
    expect(receipt).toMatchObject({ pageCount: 66, indexPageCount: 3 });
    await expect(store.open(receipt.rootDigest)).resolves.not.toBeNull();

    const rootIndexKey = `index:${receipt.contentDigest}`;
    const rootIndex = state.cas.get(rootIndexKey)!;
    state.cas.delete(rootIndexKey);
    await expect(store.open(receipt.rootDigest)).resolves.toBeNull();
    state.cas.set(rootIndexKey, rootIndex);

    const metadataKey = `metadata:${receipt.metadataDigest}`;
    const metadata = state.cas.get(metadataKey)!;
    state.cas.set(metadataKey, new Uint8Array(metadata.length).fill(7));
    await expect(store.open(receipt.rootDigest)).resolves.toBeNull();
    state.cas.set(metadataKey, metadata);

    const pageKey = `page:${contourPages[0]!.digest}`;
    const contourBytes = state.cas.get(pageKey)!;
    state.cas.delete(pageKey);
    await expect(store.open(receipt.rootDigest)).resolves.not.toBeNull();
    await expect(store.verify(receipt.rootDigest)).resolves.toBeNull();
    state.cas.set(pageKey, contourBytes);
    state.cas.set(pageKey, new Uint8Array(contourPages[0]!.byteLength).fill(9));
    await expect(store.getContourPage(contourPages[0]!)).resolves.toBeNull();
  });

  it("rejects accessor-bearing page descriptors without executing them", async () => {
    const state = createStudioFreehandInputMemoryBinaryCasState();
    const store = createStudioDryMediaUnionContinuationStore(
      createStudioFreehandInputMemoryBinaryCasStore(state),
    );
    let getterCalls = 0;
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "digest", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "0".repeat(64);
      },
    });

    await expect(store.getContourPage(hostile as never)).resolves.toBeNull();
    await expect(store.getBitmapPage(hostile as never)).resolves.toBeNull();
    expect(getterCalls).toBe(0);
  });
});
