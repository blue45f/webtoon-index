import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
} from "./studio-brush-dynamics";
import {
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_COUNT,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_PACKED_BYTE_LENGTH,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_PAGE_COUNT,
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_TARGET_BYTES,
  createStudioDryMediaUnionContinuationPackCursor,
  hydrateStudioDryMediaUnionContinuationPage,
  packStudioDryMediaUnionContinuationPageBatch,
  packStudioDryMediaUnionContinuationPages,
  snapshotStudioDryMediaUnionContinuationPackCursor,
  studioDryMediaUnionContinuationPageTransferables,
  validateStudioDryMediaUnionContinuationPage,
  type StudioDryMediaUnionContinuationPackCursor,
  type StudioDryMediaUnionContinuationPackResult,
} from "./studio-dry-media-union-continuation-protocol";
import {
  STUDIO_DRY_MEDIA_UNION_RIBBON_CARRIER_VERSION,
  type StudioDryMediaUnionComposableGroup,
} from "./studio-dry-media-union-ribbon-carrier";

import type { StudioDynamicBrushCoverageMark } from "../studio-dynamic-brush-coverage-renderer";

function polygon(stationIndex: number, scalarCount = 6): number[] {
  return Array.from({ length: scalarCount }, (_, index) => (
    index % 2 === 0
      ? stationIndex + Math.floor(index / 2) * 0.25
      : Math.floor(index / 2) * 0.25
  ));
}

function scalarCounts(totalScalarCount: number, contourCount: number): readonly number[] {
  if (totalScalarCount < contourCount * 6 || totalScalarCount % 2 !== 0) {
    throw new Error("invalid contour fixture");
  }
  const counts = Array<number>(contourCount).fill(6);
  let remainder = totalScalarCount - contourCount * 6;
  let cursor = 0;
  while (remainder > 0) {
    counts[cursor % contourCount] = counts[cursor % contourCount]! + 2;
    cursor += 1;
    remainder -= 2;
  }
  return counts;
}

function markFromGroupScalarCounts(
  groupScalarCounts: readonly number[],
  contourCount = 1,
): StudioDynamicBrushCoverageMark {
  const groups = groupScalarCounts.map((totalScalarCount, stationIndex) => ({
    stationIndex,
    polygons: scalarCounts(totalScalarCount, contourCount).map((count, contourIndex) => (
      polygon(stationIndex + contourIndex / 100, count)
    )),
  }));
  const polygons = groups.flatMap((group) => group.polygons);
  return {
    x: groupScalarCounts.length / 2,
    y: 0,
    radiusX: Math.max(0.25, groupScalarCounts.length / 2),
    radiusY: 1,
    angleRadians: 0,
    alpha: 1,
    color: "#332211",
    ribbon: {
      kind: "dry-media-union-ribbon-polygon",
      version: STUDIO_DRY_MEDIA_UNION_RIBBON_CARRIER_VERSION,
      role: "stroke-union",
      polygons,
      compositing: {
        kind: "causal-group-alpha-max",
        version: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
        programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
        groups,
      },
    },
  };
}

function markWithGroups(count: number, scalarCount = 6): StudioDynamicBrushCoverageMark {
  return markFromGroupScalarCounts(Array<number>(count).fill(scalarCount));
}

function markWithOneGroupContourScalarCounts(
  contourScalarCounts: readonly number[],
): StudioDynamicBrushCoverageMark {
  const polygons = contourScalarCounts.map((scalarCount, contourIndex) => (
    polygon(contourIndex, scalarCount)
  ));
  const groups = [{ stationIndex: 0, polygons }];
  return {
    x: 1,
    y: 1,
    radiusX: 1,
    radiusY: 1,
    angleRadians: 0,
    alpha: 1,
    color: "#332211",
    ribbon: {
      kind: "dry-media-union-ribbon-polygon",
      version: STUDIO_DRY_MEDIA_UNION_RIBBON_CARRIER_VERSION,
      role: "stroke-union",
      polygons,
      compositing: {
        kind: "causal-group-alpha-max",
        version: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
        programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
        groups,
      },
    },
  };
}

function requirePacked(
  result: StudioDryMediaUnionContinuationPackResult,
): Extract<StudioDryMediaUnionContinuationPackResult, { status: "packed" }> {
  if (result.status !== "packed") throw new Error(result.reason);
  return result;
}

function pageDigest(
  batches: readonly Extract<StudioDryMediaUnionContinuationPackResult, { status: "packed" }>[],
): string {
  const hash = createHash("sha256");
  for (const batch of batches) {
    for (const page of batch.pages) hash.update(new Uint8Array(page.buffer));
  }
  return hash.digest("hex");
}

function packEveryBatch(
  marks: readonly StudioDynamicBrushCoverageMark[],
): readonly Extract<StudioDryMediaUnionContinuationPackResult, { status: "packed" }>[] {
  const batches: Extract<StudioDryMediaUnionContinuationPackResult, { status: "packed" }>[] = [];
  let cursor: StudioDryMediaUnionContinuationPackCursor | null =
    createStudioDryMediaUnionContinuationPackCursor();
  if (!cursor) throw new Error("cursor setup failed");
  do {
    const batch = requirePacked(
      packStudioDryMediaUnionContinuationPageBatch(marks, cursor),
    );
    batches.push(batch);
    cursor = batch.nextCursor;
  } while (cursor);
  return batches;
}

describe("dry-media union continuation protocol", () => {
  it("splits the real-ish 571/572 coalesced edge only between complete station groups", () => {
    const delivery571 = requirePacked(packStudioDryMediaUnionContinuationPages([
      markFromGroupScalarCounts(Array<number>(571).fill(220), 7),
    ]));
    const delivery572 = requirePacked(packStudioDryMediaUnionContinuationPages([
      markFromGroupScalarCounts([
        ...Array<number>(571).fill(220),
        300,
      ], 7),
    ]));

    expect(delivery571.pages).toHaveLength(1);
    expect(delivery571.groupCount).toBe(571);
    expect(delivery571.inputComplete).toBe(true);
    expect(delivery572.pages).toHaveLength(2);
    expect(delivery572.groupCount).toBe(572);
    expect(delivery572.inputComplete).toBe(true);
    expect(delivery572.pages[0]?.stationIndexes).toHaveLength(571);
    expect(delivery572.pages[1]?.stationIndexes).toHaveLength(1);
    expect(delivery572.pages[1]?.groupContourOffsets).toEqual(new Uint32Array([0, 7]));
    expect(delivery572.pages[1]?.coordinates).toHaveLength(300);
    expect(delivery572.pages.every((page) => (
      page.byteLength <= STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_TARGET_BYTES
    ))).toBe(true);
  });

  it("streams a large coalesced delivery with bounded pages, bytes and group snapshots", () => {
    const marks = [markWithGroups(10_000)];
    const first = packEveryBatch(marks);
    const second = packEveryBatch(marks);

    expect(first).toHaveLength(3);
    expect(first.map((batch) => batch.groupCount)).toEqual([4_096, 4_096, 1_808]);
    expect(first.reduce((sum, batch) => sum + batch.groupCount, 0)).toBe(10_000);
    expect(first.every((batch) => (
      batch.groupCount <= STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_COUNT
      && batch.pages.length <= STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_PAGE_COUNT
      && batch.physicalBufferByteLength
        <= STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_PACKED_BYTE_LENGTH
    ))).toBe(true);
    expect(first.at(-1)?.inputComplete).toBe(true);
    expect(first.at(-1)?.nextCursor).toBeNull();
    expect(pageDigest(first)).toBe(pageDigest(second));

    const stationOrder = first.flatMap((batch) => (
      batch.pages.flatMap((page) => [...page.stationIndexes])
    ));
    expect(stationOrder).toEqual(Array.from({ length: 10_000 }, (_, index) => index));
  });

  it("accounts each physical backing once and transfers one buffer per page", () => {
    const packed = requirePacked(packStudioDryMediaUnionContinuationPages([
      markFromGroupScalarCounts([
        ...Array<number>(571).fill(220),
        300,
      ], 7),
    ]));
    const buffers = new Set(packed.pages.map((page) => page.buffer));
    const physicalBytes = [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);

    expect(buffers.size).toBe(packed.pages.length);
    expect(packed.physicalBufferByteLength).toBe(physicalBytes);
    expect(packed.logicalByteLength).toBe(physicalBytes);
    expect(packed.slabCapacityByteLength).toBe(physicalBytes);
    expect(packed.fragmentationByteLength).toBe(0);
    for (const page of packed.pages) {
      expect(validateStudioDryMediaUnionContinuationPage(page)).toBe(true);
      expect(studioDryMediaUnionContinuationPageTransferables(page)).toEqual([page.buffer]);
      expect([
        page.stationIndexes.buffer,
        page.groupEntryIndexes.buffer,
        page.groupContourOffsets.buffer,
        page.contourCoordinateOffsets.buffer,
        page.coordinates.buffer,
        page.groupBounds.buffer,
      ].every((buffer) => buffer === page.buffer)).toBe(true);
    }
  });

  it("keeps entry indexes wider than Uint16 without wrap", () => {
    const mark = markWithGroups(1);
    const marks = Array<StudioDynamicBrushCoverageMark>(65_537).fill(mark);
    const cursor = {
      contract: "studio-dry-media-union-pack-cursor-v1",
      version: 1,
      entryIndex: 65_536,
      groupIndex: 0,
      nextPageIndex: 65_536,
      nextGlobalGroupIndex: 65_536,
    } satisfies StudioDryMediaUnionContinuationPackCursor;
    const packed = requirePacked(
      packStudioDryMediaUnionContinuationPageBatch(marks, cursor),
    );

    expect(packed.pages).toHaveLength(1);
    expect(packed.pages[0]?.groupEntryIndexes[0]).toBe(65_536);
    expect(packed.pages[0]?.groupEntryIndexes.constructor).toBe(Uint32Array);
    expect(packed.pages[0]?.firstGroupIndex).toBe(65_536);
    expect(packed.pages[0]?.pageIndex).toBe(65_536);
  });

  it("accepts the literal 1 MiB group page and rejects its next aligned quantum atomically", () => {
    const atLimit = requirePacked(packStudioDryMediaUnionContinuationPages([
      markWithOneGroupContourScalarCounts([6, 131_042]),
    ]));
    expect(STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_TARGET_BYTES).toBe(1_048_576);
    expect(atLimit.pages).toHaveLength(1);
    expect(atLimit.pages[0]?.byteLength).toBe(1_048_576);

    const nextLayoutQuantum = packStudioDryMediaUnionContinuationPages([
      markWithOneGroupContourScalarCounts([6, 6, 6, 131_030]),
    ]);
    expect(nextLayoutQuantum).toEqual({
      status: "rejected",
      reason: "group-too-large",
    });
    expect("pages" in nextLayoutQuantum).toBe(false);
  });

  it("copies input coordinates and rejects hostile accessors without invoking them", () => {
    const mutableMark = markWithGroups(1) as StudioDynamicBrushCoverageMark;
    const mutablePolygon = mutableMark.ribbon && "polygons" in mutableMark.ribbon
      ? mutableMark.ribbon.polygons[0] as number[]
      : null;
    if (!mutablePolygon) throw new Error("fixture setup failed");
    const packed = requirePacked(packStudioDryMediaUnionContinuationPages([mutableMark]));
    const original = packed.pages[0]!.coordinates[0]!;
    mutablePolygon[0] = 9_999;
    expect(packed.pages[0]!.coordinates[0]).toBe(original);

    let getterCalls = 0;
    const hostileMark = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostileMark, "ribbon", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return mutableMark.ribbon;
      },
    });
    expect(packStudioDryMediaUnionContinuationPages([
      hostileMark as unknown as StudioDynamicBrushCoverageMark,
    ])).toEqual({ status: "rejected", reason: "invalid-program" });

    const hostileCursor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostileCursor, "contract", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "studio-dry-media-union-pack-cursor-v1";
      },
    });
    expect(snapshotStudioDryMediaUnionContinuationPackCursor(hostileCursor)).toBeNull();

    const hostilePage = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostilePage, "contract", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "studio-dry-media-union-contour-page-v1";
      },
    });
    expect(validateStudioDryMediaUnionContinuationPage(hostilePage)).toBe(false);
    expect(getterCalls).toBe(0);
  });

  it("does not inspect group 4,097 and rejects a later hostile group atomically", () => {
    const boundedMark = markWithGroups(STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_COUNT);
    if (
      !boundedMark.ribbon
      || boundedMark.ribbon.kind !== "dry-media-union-ribbon-polygon"
      || !boundedMark.ribbon.compositing
    ) throw new Error("fixture setup failed");
    const groups: StudioDryMediaUnionComposableGroup[] = [
      ...boundedMark.ribbon.compositing.groups,
    ];
    let getterCalls = 0;
    Object.defineProperty(groups, STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_COUNT, {
      enumerable: true,
      get() {
        getterCalls += 1;
        return boundedMark.ribbon && "compositing" in boundedMark.ribbon
          ? boundedMark.ribbon.compositing?.groups[0]
          : undefined;
      },
    });
    const coalesced = {
      ...boundedMark,
      ribbon: {
        ...boundedMark.ribbon,
        compositing: {
          ...boundedMark.ribbon.compositing,
          groups,
        },
      },
    } satisfies StudioDynamicBrushCoverageMark;
    const first = requirePacked(packStudioDryMediaUnionContinuationPages([coalesced]));

    expect(first.groupCount).toBe(STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_COUNT);
    expect(first.inputComplete).toBe(false);
    expect(first.nextCursor?.groupIndex).toBe(
      STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_COUNT,
    );
    expect(getterCalls).toBe(0);
    expect(packStudioDryMediaUnionContinuationPageBatch([coalesced], first.nextCursor))
      .toEqual({ status: "rejected", reason: "invalid-group" });
    expect(getterCalls).toBe(0);

    const validGroup = boundedMark.ribbon.compositing.groups[0]!;
    const hostileGroup = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostileGroup, "polygons", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return validGroup.polygons;
      },
    });
    Object.defineProperty(hostileGroup, "stationIndex", {
      enumerable: true,
      value: 1,
    });
    const invalidAfterValid = {
      ...boundedMark,
      ribbon: {
        ...boundedMark.ribbon,
        compositing: {
          ...boundedMark.ribbon.compositing,
          groups: [
            validGroup,
            hostileGroup as unknown as StudioDryMediaUnionComposableGroup,
          ],
        },
      },
    } as StudioDynamicBrushCoverageMark;
    const rejected = packStudioDryMediaUnionContinuationPages([invalidAfterValid]);
    expect(rejected).toEqual({ status: "rejected", reason: "invalid-group" });
    expect("pages" in rejected).toBe(false);
    expect(getterCalls).toBe(0);
  });

  it("produces byte-identical page digests and exact global indexes across resumptions", () => {
    const marks = [markWithGroups(9_000, 18)];
    const batches = packEveryBatch(marks);
    const repeated = packEveryBatch(marks);
    const firstCursor = batches[0]!.startCursor;
    const lastPage = batches.at(-1)!.pages.at(-1)!;

    expect(firstCursor).toEqual({
      contract: "studio-dry-media-union-pack-cursor-v1",
      version: 1,
      entryIndex: 0,
      groupIndex: 0,
      nextPageIndex: 0,
      nextGlobalGroupIndex: 0,
    });
    expect(lastPage.firstGroupIndex + lastPage.stationIndexes.length).toBe(9_000);
    expect(pageDigest(batches)).toMatch(/^[a-f0-9]{64}$/u);
    expect(pageDigest(batches)).toBe(pageDigest(repeated));
  });

  it("rehydrates one copied bounded slab and rejects a forged header before view construction", () => {
    const packed = requirePacked(packStudioDryMediaUnionContinuationPages([
      markWithGroups(17, 18),
    ]));
    const source = packed.pages[0]!;
    const hydrated = hydrateStudioDryMediaUnionContinuationPage(source.buffer);

    expect(hydrated).not.toBeNull();
    expect(hydrated?.buffer).not.toBe(source.buffer);
    expect(hydrated?.stationIndexes).toEqual(source.stationIndexes);
    expect(hydrated?.groupContourOffsets).toEqual(source.groupContourOffsets);
    expect(hydrated?.coordinates).toEqual(source.coordinates);
    new Uint8Array(source.buffer).fill(0);
    expect(validateStudioDryMediaUnionContinuationPage(hydrated)).toBe(true);

    const forged = hydrated!.buffer.slice(0);
    new DataView(forged).setUint32(20, 0xffff_ffff, true);
    expect(hydrateStudioDryMediaUnionContinuationPage(forged)).toBeNull();
    expect(hydrateStudioDryMediaUnionContinuationPage(new ArrayBuffer(127))).toBeNull();
  });
});
