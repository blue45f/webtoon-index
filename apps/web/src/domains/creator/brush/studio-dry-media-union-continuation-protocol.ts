import {
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
} from "./studio-brush-dynamics";

import type {
  Memory64CrossRealmAllocationAck,
  Memory64CrossRealmReservationToken,
} from "../kernel/Memory64CrossRealmProtocol";
import type { StudioDynamicBrushCoverageMark } from "../studio-dynamic-brush-coverage-renderer";

export const STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION = 1 as const;
export const STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_TARGET_BYTES = 1024 * 1024;
export const STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_BYTES =
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_TARGET_BYTES;
export const STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_INFLIGHT_BYTES = 2 * 1024 * 1024;
export const STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_PACKED_BYTE_LENGTH =
  STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_INFLIGHT_BYTES;
export const STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_PAGE_COUNT = 2;
export const STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_COUNT = 4_096;
export const STUDIO_DRY_MEDIA_UNION_CONTINUATION_TILE_SIZE = 128;
const STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_HEADER_BYTES = 128;
const STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_MAGIC = "TSDRYPG1";

export interface StudioDryMediaUnionContinuationPage {
  readonly contract: "studio-dry-media-union-contour-page-v1";
  readonly version: 1;
  readonly pageIndex: number;
  readonly firstGroupIndex: number;
  readonly byteLength: number;
  /** One transferable slab; all typed views below are exact non-overlapping windows into it. */
  readonly buffer: ArrayBuffer;
  readonly stationIndexes: Uint32Array;
  readonly groupEntryIndexes: Uint32Array;
  /** Contour offsets for every group plus one terminal offset. */
  readonly groupContourOffsets: Uint32Array;
  /** Coordinate-scalar offsets for every contour plus one terminal offset. */
  readonly contourCoordinateOffsets: Uint32Array;
  readonly coordinates: Float64Array;
  /** document-space minX/minY/maxX/maxY for every group. */
  readonly groupBounds: Float64Array;
}

export type StudioDryMediaUnionContinuationPackResult =
  | Readonly<{
      status: "packed";
      pages: readonly StudioDryMediaUnionContinuationPage[];
      startCursor: StudioDryMediaUnionContinuationPackCursor;
      nextCursor: StudioDryMediaUnionContinuationPackCursor | null;
      inputComplete: boolean;
      groupCount: number;
      contourCount: number;
      coordinateCount: number;
      /** Exact sum of the unique ArrayBuffer allocations backing `pages`. */
      physicalBufferByteLength: number;
      /** Compatibility aliases; these are exact physical bytes, not target-size estimates. */
      logicalByteLength: number;
      slabCapacityByteLength: number;
      fragmentationByteLength: number;
    }>
  | Readonly<{
      status: "rejected";
      reason:
        | "invalid-cursor"
        | "invalid-program"
        | "invalid-group"
        | "group-too-large";
    }>;

export interface StudioDryMediaUnionContinuationPackCursor {
  readonly contract: "studio-dry-media-union-pack-cursor-v1";
  readonly version: 1;
  /** Source mark and causal-group positions for the next bounded call. */
  readonly entryIndex: number;
  readonly groupIndex: number;
  /** Persistent page/group authority indexes for the next page. */
  readonly nextPageIndex: number;
  readonly nextGlobalGroupIndex: number;
}

interface PendingGroup {
  readonly stationIndex: number;
  readonly entryIndex: number;
  readonly polygons: readonly (readonly number[])[];
  readonly minimumX: number;
  readonly minimumY: number;
  readonly maximumX: number;
  readonly maximumY: number;
  readonly individualPageByteLength: number;
}

type PendingGroupSnapshotResult = PendingGroup | "invalid-group" | "group-too-large";

const MISSING_DATA_PROPERTY = Symbol("studio-dry-media-union/missing-data-property");

function ownDataValue(value: object, key: PropertyKey): unknown | typeof MISSING_DATA_PROPERTY {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : MISSING_DATA_PROPERTY;
  } catch {
    return MISSING_DATA_PROPERTY;
  }
}

function arrayLength(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  const length = ownDataValue(value, "length");
  return Number.isSafeInteger(length) && (length as number) >= 0
    ? length as number
    : null;
}

function safeUint32(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function snapshotGroup(
  value: unknown,
  entryIndex: number,
): PendingGroupSnapshotResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "invalid-group";
  }
  const stationIndex = ownDataValue(value, "stationIndex");
  const rawPolygons = ownDataValue(value, "polygons");
  const polygonCount = arrayLength(rawPolygons);
  if (
    !safeUint32(stationIndex as number)
    || !safeUint32(entryIndex)
    || polygonCount === null
    || polygonCount === 0
  ) return "invalid-group";
  const polygons: number[][] = [];
  let contourCount = 0;
  let coordinateCount = 0;
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (let polygonIndex = 0; polygonIndex < polygonCount; polygonIndex += 1) {
    const rawPolygon = ownDataValue(rawPolygons as object, String(polygonIndex));
    const scalarCount = arrayLength(rawPolygon);
    if (scalarCount === null || scalarCount < 6 || scalarCount % 2 !== 0) {
      return "invalid-group";
    }
    const polygon: number[] = [];
    contourCount += 1;
    coordinateCount += scalarCount;
    const prospectivePageByteLength = pageByteLength(1, contourCount, coordinateCount);
    if (!Number.isSafeInteger(prospectivePageByteLength)) return "invalid-group";
    if (prospectivePageByteLength > STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_BYTES) {
      return "group-too-large";
    }
    for (let index = 0; index < scalarCount; index += 2) {
      const x = ownDataValue(rawPolygon as object, String(index));
      const y = ownDataValue(rawPolygon as object, String(index + 1));
      if (typeof x !== "number" || typeof y !== "number") return "invalid-group";
      if (!Number.isFinite(x) || !Number.isFinite(y)) return "invalid-group";
      polygon.push(x, y);
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
    polygons.push(polygon);
  }
  if (!(maximumX > minimumX) || !(maximumY > minimumY)) return "invalid-group";
  const individualPageByteLength = pageByteLength(1, contourCount, coordinateCount);
  if (!Number.isSafeInteger(individualPageByteLength)) return "invalid-group";
  return {
    stationIndex: stationIndex as number,
    entryIndex,
    polygons,
    minimumX,
    minimumY,
    maximumX,
    maximumY,
    individualPageByteLength,
  };
}

function pageByteLength(
  groupCount: number,
  contourCount: number,
  coordinateCount: number,
): number {
  const uint32Bytes = groupCount * Uint32Array.BYTES_PER_ELEMENT * 2
    + (groupCount + 1) * Uint32Array.BYTES_PER_ELEMENT
    + (contourCount + 1) * Uint32Array.BYTES_PER_ELEMENT;
  const alignedUint32Bytes = Math.ceil(uint32Bytes / Float64Array.BYTES_PER_ELEMENT)
    * Float64Array.BYTES_PER_ELEMENT;
  return STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_HEADER_BYTES
    + alignedUint32Bytes
    + coordinateCount * Float64Array.BYTES_PER_ELEMENT
    + groupCount * 4 * Float64Array.BYTES_PER_ELEMENT;
}

function buildPage(
  groups: readonly PendingGroup[],
  pageIndex: number,
  firstGroupIndex: number,
): StudioDryMediaUnionContinuationPage {
  const contourCount = groups.reduce((sum, group) => sum + group.polygons.length, 0);
  const coordinateCount = groups.reduce((sum, group) => (
    sum + group.polygons.reduce((inner, polygon) => inner + polygon.length, 0)
  ), 0);
  const byteLength = pageByteLength(groups.length, contourCount, coordinateCount);
  const buffer = new ArrayBuffer(byteLength);
  const header = new Uint8Array(buffer, 0, STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_HEADER_BYTES);
  header.set(new TextEncoder().encode(STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_MAGIC), 0);
  header.set(new TextEncoder().encode(STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST), 32);
  const headerView = new DataView(buffer, 0, STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_HEADER_BYTES);
  headerView.setUint32(8, 1, true);
  headerView.setUint32(12, pageIndex, true);
  headerView.setUint32(16, firstGroupIndex, true);
  headerView.setUint32(20, groups.length, true);
  headerView.setUint32(24, contourCount, true);
  headerView.setUint32(28, coordinateCount, true);
  let byteOffset = STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_HEADER_BYTES;
  const stationIndexes = new Uint32Array(buffer, byteOffset, groups.length);
  byteOffset += stationIndexes.byteLength;
  const groupEntryIndexes = new Uint32Array(buffer, byteOffset, groups.length);
  byteOffset += groupEntryIndexes.byteLength;
  const groupContourOffsets = new Uint32Array(buffer, byteOffset, groups.length + 1);
  byteOffset += groupContourOffsets.byteLength;
  const contourCoordinateOffsets = new Uint32Array(buffer, byteOffset, contourCount + 1);
  byteOffset += contourCoordinateOffsets.byteLength;
  byteOffset = Math.ceil(byteOffset / Float64Array.BYTES_PER_ELEMENT)
    * Float64Array.BYTES_PER_ELEMENT;
  const coordinates = new Float64Array(buffer, byteOffset, coordinateCount);
  byteOffset += coordinates.byteLength;
  const groupBounds = new Float64Array(buffer, byteOffset, groups.length * 4);
  let contourOffset = 0;
  let coordinateOffset = 0;
  for (const [groupIndex, group] of groups.entries()) {
    stationIndexes[groupIndex] = group.stationIndex;
    groupEntryIndexes[groupIndex] = group.entryIndex;
    groupContourOffsets[groupIndex] = contourOffset;
    groupBounds[groupIndex * 4] = group.minimumX;
    groupBounds[groupIndex * 4 + 1] = group.minimumY;
    groupBounds[groupIndex * 4 + 2] = group.maximumX;
    groupBounds[groupIndex * 4 + 3] = group.maximumY;
    for (const polygon of group.polygons) {
      contourCoordinateOffsets[contourOffset] = coordinateOffset;
      coordinates.set(polygon, coordinateOffset);
      coordinateOffset += polygon.length;
      contourOffset += 1;
    }
  }
  groupContourOffsets[groups.length] = contourOffset;
  contourCoordinateOffsets[contourCount] = coordinateOffset;
  return Object.freeze({
    contract: "studio-dry-media-union-contour-page-v1" as const,
    version: 1 as const,
    pageIndex,
    firstGroupIndex,
    byteLength,
    buffer,
    stationIndexes,
    groupEntryIndexes,
    groupContourOffsets,
    contourCoordinateOffsets,
    coordinates,
    groupBounds,
  });
}

/**
 * Rehydrates one immutable bounded contour slab without retaining the caller's
 * ArrayBuffer. The page header is preflighted before any length-derived views
 * are constructed, and the shared validator remains the final authority.
 */
export function hydrateStudioDryMediaUnionContinuationPage(
  candidate: unknown,
): StudioDryMediaUnionContinuationPage | null {
  if (
    !(candidate instanceof ArrayBuffer)
    || candidate.byteLength < STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_HEADER_BYTES
    || candidate.byteLength > STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_BYTES
  ) return null;
  const buffer = candidate.slice(0);
  try {
    const header = new DataView(
      buffer,
      0,
      STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_HEADER_BYTES,
    );
    const pageIndex = header.getUint32(12, true);
    const firstGroupIndex = header.getUint32(16, true);
    const groupCount = header.getUint32(20, true);
    const contourCount = header.getUint32(24, true);
    const coordinateCount = header.getUint32(28, true);
    const byteLength = pageByteLength(groupCount, contourCount, coordinateCount);
    if (
      groupCount <= 0
      || groupCount > STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_COUNT
      || contourCount <= 0
      || coordinateCount < 6
      || !Number.isSafeInteger(byteLength)
      || byteLength !== buffer.byteLength
      || byteLength > STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_BYTES
    ) return null;
    let byteOffset = STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_HEADER_BYTES;
    const stationIndexes = new Uint32Array(buffer, byteOffset, groupCount);
    byteOffset += stationIndexes.byteLength;
    const groupEntryIndexes = new Uint32Array(buffer, byteOffset, groupCount);
    byteOffset += groupEntryIndexes.byteLength;
    const groupContourOffsets = new Uint32Array(buffer, byteOffset, groupCount + 1);
    byteOffset += groupContourOffsets.byteLength;
    const contourCoordinateOffsets = new Uint32Array(
      buffer,
      byteOffset,
      contourCount + 1,
    );
    byteOffset += contourCoordinateOffsets.byteLength;
    byteOffset = Math.ceil(byteOffset / Float64Array.BYTES_PER_ELEMENT)
      * Float64Array.BYTES_PER_ELEMENT;
    const coordinates = new Float64Array(buffer, byteOffset, coordinateCount);
    byteOffset += coordinates.byteLength;
    const groupBounds = new Float64Array(buffer, byteOffset, groupCount * 4);
    const page = Object.freeze({
      contract: "studio-dry-media-union-contour-page-v1" as const,
      version: 1 as const,
      pageIndex,
      firstGroupIndex,
      byteLength,
      buffer,
      stationIndexes,
      groupEntryIndexes,
      groupContourOffsets,
      contourCoordinateOffsets,
      coordinates,
      groupBounds,
    });
    return validateStudioDryMediaUnionContinuationPage(page) ? page : null;
  } catch {
    return null;
  }
}

function freezePackCursor(
  entryIndex: number,
  groupIndex: number,
  nextPageIndex: number,
  nextGlobalGroupIndex: number,
): StudioDryMediaUnionContinuationPackCursor {
  return Object.freeze({
    contract: "studio-dry-media-union-pack-cursor-v1" as const,
    version: 1 as const,
    entryIndex,
    groupIndex,
    nextPageIndex,
    nextGlobalGroupIndex,
  });
}

export function snapshotStudioDryMediaUnionContinuationPackCursor(
  value: unknown,
): StudioDryMediaUnionContinuationPackCursor | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  const keys = [
    "contract",
    "version",
    "entryIndex",
    "groupIndex",
    "nextPageIndex",
    "nextGlobalGroupIndex",
  ] as const;
  if (
    Object.keys(descriptors).length !== keys.length
    || keys.some((key) => !descriptors[key] || !("value" in descriptors[key]!))
  ) return null;
  const read = (key: typeof keys[number]): unknown => descriptors[key]!.value;
  if (
    read("contract") !== "studio-dry-media-union-pack-cursor-v1"
    || read("version") !== 1
    || !safeUint32(read("entryIndex") as number)
    || !safeUint32(read("groupIndex") as number)
    || !safeUint32(read("nextPageIndex") as number)
    || !safeUint32(read("nextGlobalGroupIndex") as number)
  ) return null;
  return freezePackCursor(
    read("entryIndex") as number,
    read("groupIndex") as number,
    read("nextPageIndex") as number,
    read("nextGlobalGroupIndex") as number,
  );
}

export function createStudioDryMediaUnionContinuationPackCursor(
  firstGlobalGroupIndex = 0,
  firstPageIndex = 0,
): StudioDryMediaUnionContinuationPackCursor | null {
  if (!safeUint32(firstGlobalGroupIndex) || !safeUint32(firstPageIndex)) return null;
  return freezePackCursor(0, 0, firstPageIndex, firstGlobalGroupIndex);
}

interface CompositingGroupsSnapshot {
  readonly groups: readonly unknown[];
  readonly groupCount: number;
}

function snapshotCompositingGroups(
  marks: readonly StudioDynamicBrushCoverageMark[],
  entryIndex: number,
): CompositingGroupsSnapshot | "invalid-program" | "invalid-group" {
  const mark = ownDataValue(marks, String(entryIndex));
  if (mark === null || typeof mark !== "object" || Array.isArray(mark)) {
    return "invalid-program";
  }
  const ribbon = ownDataValue(mark, "ribbon");
  if (ribbon === null || typeof ribbon !== "object" || Array.isArray(ribbon)) {
    return "invalid-program";
  }
  const compositing = ownDataValue(ribbon, "compositing");
  if (
    ownDataValue(ribbon, "kind") !== "dry-media-union-ribbon-polygon"
    || compositing === null
    || typeof compositing !== "object"
    || Array.isArray(compositing)
    || ownDataValue(compositing, "kind") !== "causal-group-alpha-max"
    || ownDataValue(compositing, "version")
      !== STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION
    || ownDataValue(compositing, "programDigest")
      !== STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST
  ) return "invalid-program";
  const groups = ownDataValue(compositing, "groups");
  const groupCount = arrayLength(groups);
  if (groupCount === null || groupCount === 0) return "invalid-group";
  return { groups: groups as readonly unknown[], groupCount };
}

/**
 * Packs one deterministic bounded batch. The result owns at most two exact-sized ArrayBuffers,
 * never splits a causal station group, and keeps no caller mark/group/polygon references.
 */
export function packStudioDryMediaUnionContinuationPageBatch(
  marks: readonly StudioDynamicBrushCoverageMark[],
  cursor: unknown = freezePackCursor(0, 0, 0, 0),
): StudioDryMediaUnionContinuationPackResult {
  const startCursor = snapshotStudioDryMediaUnionContinuationPackCursor(cursor);
  if (!startCursor) return Object.freeze({ status: "rejected", reason: "invalid-cursor" });
  const markCount = arrayLength(marks);
  if (markCount === null || startCursor.entryIndex > markCount) {
    return Object.freeze({ status: "rejected", reason: "invalid-group" });
  }
  const pageGroups: PendingGroup[][] = [[]];
  const pageContourCounts = [0];
  const pageCoordinateCounts = [0];
  let entryIndex = startCursor.entryIndex;
  let groupIndex = startCursor.groupIndex;
  let groupCount = 0;
  let inputComplete = false;
  let activeEntryIndex = -1;
  let activeGroups: readonly unknown[] = [];
  let activeGroupCount = 0;
  while (groupCount < STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_COUNT) {
    if (entryIndex >= (markCount as number)) {
      inputComplete = true;
      break;
    }
    if (activeEntryIndex !== entryIndex) {
      const snapshot = snapshotCompositingGroups(marks, entryIndex);
      if (typeof snapshot === "string") {
        return Object.freeze({ status: "rejected", reason: snapshot });
      }
      activeEntryIndex = entryIndex;
      activeGroups = snapshot.groups;
      activeGroupCount = snapshot.groupCount;
      if (groupIndex > activeGroupCount) {
        return Object.freeze({ status: "rejected", reason: "invalid-group" });
      }
    }
    if (groupIndex === activeGroupCount) {
      entryIndex += 1;
      groupIndex = 0;
      activeEntryIndex = -1;
      continue;
    }
    const rawGroup = ownDataValue(activeGroups as object, String(groupIndex));
    const group = snapshotGroup(rawGroup, entryIndex);
    if (typeof group === "string") {
      return Object.freeze({ status: "rejected", reason: group });
    }
    const groupContourCount = group.polygons.length;
    const groupCoordinateCount = group.polygons.reduce(
      (sum, polygon) => sum + polygon.length,
      0,
    );
    let batchPageIndex = pageGroups.length - 1;
    const prospectiveByteLength = pageByteLength(
      pageGroups[batchPageIndex]!.length + 1,
      pageContourCounts[batchPageIndex]! + groupContourCount,
      pageCoordinateCounts[batchPageIndex]! + groupCoordinateCount,
    );
    if (
      pageGroups[batchPageIndex]!.length > 0
      && prospectiveByteLength > STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_TARGET_BYTES
    ) {
      if (pageGroups.length >= STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_PAGE_COUNT) break;
      pageGroups.push([]);
      pageContourCounts.push(0);
      pageCoordinateCounts.push(0);
      batchPageIndex += 1;
    }
    pageGroups[batchPageIndex]!.push(group);
    pageContourCounts[batchPageIndex] = pageContourCounts[batchPageIndex]!
      + groupContourCount;
    pageCoordinateCounts[batchPageIndex] = pageCoordinateCounts[batchPageIndex]!
      + groupCoordinateCount;
    groupCount += 1;
    groupIndex += 1;
    if (groupIndex === activeGroupCount) {
      entryIndex += 1;
      groupIndex = 0;
      activeEntryIndex = -1;
    }
  }
  if (groupCount === 0) {
    return Object.freeze({ status: "rejected", reason: "invalid-group" });
  }
  inputComplete = inputComplete || entryIndex === markCount;
  const lastGlobalGroupIndex = startCursor.nextGlobalGroupIndex + groupCount - 1;
  const lastPageIndex = startCursor.nextPageIndex + pageGroups.length - 1;
  if (!safeUint32(lastGlobalGroupIndex) || !safeUint32(lastPageIndex)) {
    return Object.freeze({ status: "rejected", reason: "invalid-group" });
  }
  if (
    !inputComplete
    && !safeUint32(startCursor.nextGlobalGroupIndex + groupCount)
  ) return Object.freeze({ status: "rejected", reason: "invalid-group" });
  const pages: StudioDryMediaUnionContinuationPage[] = [];
  let firstGroupIndex = startCursor.nextGlobalGroupIndex;
  for (const [batchPageIndex, groups] of pageGroups.entries()) {
    const page = buildPage(
      groups,
      startCursor.nextPageIndex + batchPageIndex,
      firstGroupIndex,
    );
    pages.push(page);
    firstGroupIndex += groups.length;
  }
  const contourCount = pages.reduce(
    (sum, page) => sum + page.contourCoordinateOffsets.length - 1,
    0,
  );
  const coordinateCount = pages.reduce(
    (sum, page) => sum + page.coordinates.length,
    0,
  );
  const physicalBufferByteLength = pages.reduce(
    (sum, page) => sum + page.buffer.byteLength,
    0,
  );
  if (
    pages.length > STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_PAGE_COUNT
    || physicalBufferByteLength > STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_PACKED_BYTE_LENGTH
  ) return Object.freeze({ status: "rejected", reason: "invalid-group" });
  const nextCursor = inputComplete
    ? null
    : freezePackCursor(
        entryIndex,
        groupIndex,
        startCursor.nextPageIndex + pages.length,
        startCursor.nextGlobalGroupIndex + groupCount,
      );
  return Object.freeze({
    status: "packed" as const,
    pages: Object.freeze(pages),
    startCursor,
    nextCursor,
    inputComplete,
    groupCount,
    contourCount,
    coordinateCount,
    physicalBufferByteLength,
    logicalByteLength: physicalBufferByteLength,
    slabCapacityByteLength: physicalBufferByteLength,
    fragmentationByteLength: 0,
  });
}

/** Compatibility entry point for the first bounded streaming batch. */
export function packStudioDryMediaUnionContinuationPages(
  marks: readonly StudioDynamicBrushCoverageMark[],
  firstGroupIndex = 0,
): StudioDryMediaUnionContinuationPackResult {
  const cursor = createStudioDryMediaUnionContinuationPackCursor(firstGroupIndex);
  if (!cursor) return Object.freeze({ status: "rejected", reason: "invalid-cursor" });
  return packStudioDryMediaUnionContinuationPageBatch(marks, cursor);
}

export function studioDryMediaUnionContinuationPageTransferables(
  page: StudioDryMediaUnionContinuationPage,
): readonly ArrayBuffer[] {
  return Object.freeze([page.buffer]);
}

export interface StudioDryMediaUnionContinuationBeginRequest {
  readonly type: "studio-dry-media-union/begin";
  readonly version: typeof STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION;
  readonly workerGeneration: number;
  readonly requestId: number;
  readonly strokeId: string;
  readonly presentationGeneration: number;
  readonly programVersion: typeof STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION;
  readonly programDigest: typeof STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST;
  readonly width: number;
  readonly height: number;
  readonly transform: readonly [number, number, number, number, number, number];
  readonly color: string;
  readonly scratchReservation: Memory64CrossRealmReservationToken;
}

export interface StudioDryMediaUnionContinuationAppendRequest {
  readonly type: "studio-dry-media-union/append";
  readonly version: typeof STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION;
  readonly workerGeneration: number;
  readonly requestId: number;
  readonly strokeId: string;
  readonly sequence: number;
  readonly pages: readonly StudioDryMediaUnionContinuationPage[];
}

export interface StudioDryMediaUnionContinuationSealRequest {
  readonly type: "studio-dry-media-union/seal";
  readonly version: typeof STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION;
  readonly workerGeneration: number;
  readonly requestId: number;
  readonly strokeId: string;
  readonly sequence: number;
}

export interface StudioDryMediaUnionContinuationCancelRequest {
  readonly type: "studio-dry-media-union/cancel";
  readonly version: typeof STUDIO_DRY_MEDIA_UNION_CONTINUATION_PROTOCOL_VERSION;
  readonly workerGeneration: number;
  readonly requestId: number;
  readonly strokeId: string;
}

export type StudioDryMediaUnionContinuationRequest =
  | StudioDryMediaUnionContinuationBeginRequest
  | StudioDryMediaUnionContinuationAppendRequest
  | StudioDryMediaUnionContinuationSealRequest
  | StudioDryMediaUnionContinuationCancelRequest;

export interface StudioDryMediaUnionPagedRootReceipt {
  readonly contract: "studio-dry-media-union-paged-root-v1";
  readonly version: 1;
  readonly strokeId: string;
  readonly generation: number;
  readonly sequence: number;
  readonly programVersion: typeof STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION;
  readonly programDigest: typeof STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST;
  readonly rootDigest: string;
  readonly contentDigest: string;
  readonly metadataDigest: string;
  readonly pageCount: number;
  readonly indexPageCount: number;
  readonly bitmapPageCount: number;
  readonly groupCount: number;
  readonly contourCount: number;
  readonly coordinateCount: number;
  readonly logicalByteLength: number;
  readonly pagedByteLength: number;
  readonly residentByteLength: number;
  readonly hydratedByteLength: number;
  readonly inflightByteLength: number;
  readonly slabCapacityByteLength: number;
  readonly fragmentationByteLength: number;
  readonly presentationGeneration: number;
}

export interface StudioDryMediaUnionContinuationTilePatch {
  readonly tileX: number;
  readonly tileY: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly bitmap: ImageBitmap;
}

export interface StudioDryMediaUnionContinuationFrameReceipt {
  readonly contract: "studio-dry-media-union-frame-v1";
  readonly version: 1;
  readonly status: "rendered";
  readonly strokeId: string;
  readonly workerGeneration: number;
  readonly sequence: number;
  readonly presentationGeneration: number;
  readonly programDigest: typeof STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST;
  readonly coverage: Readonly<{
    readonly contract: "studio-dry-media-union-frame-coverage-v1";
    readonly version: 1;
    readonly admittedGroupCount: number;
    readonly visibleGroupCount: number;
    readonly contourVisitCount: number;
    readonly coordinateVisitCount: number;
    readonly tileCount: number;
    readonly tilePixelArea: number;
    readonly rasterPixelArea: number;
    readonly clearPixelArea: number;
    readonly readbackPixelArea: number;
  }>;
  readonly tiles: readonly StudioDryMediaUnionContinuationTilePatch[];
}

export type StudioDryMediaUnionContinuationResponse =
  | Readonly<{
      type: "studio-dry-media-union/ready";
      version: 1;
      workerGeneration: number;
      requestId: number;
      strokeId: string;
      scratchAllocationAck: Memory64CrossRealmAllocationAck;
    }>
  | Readonly<{
      type: "studio-dry-media-union/appended";
      version: 1;
      workerGeneration: number;
      requestId: number;
      strokeId: string;
      sequence: number;
      logicalByteLength: number;
      residentByteLength: number;
      inflightByteLength: number;
      frame: StudioDryMediaUnionContinuationFrameReceipt;
    }>
  | Readonly<{
      type: "studio-dry-media-union/sealed";
      version: 1;
      workerGeneration: number;
      requestId: number;
      strokeId: string;
      receipt: StudioDryMediaUnionPagedRootReceipt;
    }>
  | Readonly<{
      type: "studio-dry-media-union/cancelled";
      version: 1;
      workerGeneration: number;
      requestId: number;
      strokeId: string;
    }>
  | Readonly<{
      type: "studio-dry-media-union/failure";
      version: 1;
      workerGeneration: number | null;
      requestId: number | null;
      strokeId: string | null;
      reason: "invalid-message" | "invalid-state" | "raster-failed" | "store-failed";
      detail: string;
    }>;

export function validateStudioDryMediaUnionContinuationPage(
  value: unknown,
): value is StudioDryMediaUnionContinuationPage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return false;
  }
  const allowed = new Set([
    "contract",
    "version",
    "pageIndex",
    "firstGroupIndex",
    "byteLength",
    "buffer",
    "stationIndexes",
    "groupEntryIndexes",
    "groupContourOffsets",
    "contourCoordinateOffsets",
    "coordinates",
    "groupBounds",
  ]);
  if (
    Object.keys(descriptors).length !== allowed.size
    || Object.keys(descriptors).some((key) => !allowed.has(key))
    || [...allowed].some((key) => {
      const descriptor = descriptors[key];
      return !descriptor || !("value" in descriptor);
    })
  ) return false;
  const page = Object.fromEntries(
    [...allowed].map((key) => [key, descriptors[key]!.value]),
  ) as unknown as StudioDryMediaUnionContinuationPage;
  if (
    page.contract !== "studio-dry-media-union-contour-page-v1"
    || page.version !== 1
    || !safeUint32(page.pageIndex as number)
    || !safeUint32(page.firstGroupIndex as number)
    || !(page.buffer instanceof ArrayBuffer)
    || !(page.stationIndexes instanceof Uint32Array)
    || !(page.groupEntryIndexes instanceof Uint32Array)
    || !(page.groupContourOffsets instanceof Uint32Array)
    || !(page.contourCoordinateOffsets instanceof Uint32Array)
    || !(page.coordinates instanceof Float64Array)
    || !(page.groupBounds instanceof Float64Array)
    || page.buffer.byteLength < STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_HEADER_BYTES
  ) return false;
  const groupCount = page.stationIndexes.length;
  const contourCount = page.contourCoordinateOffsets.length - 1;
  const computedBytes = pageByteLength(groupCount, contourCount, page.coordinates.length);
  const header = new Uint8Array(
    page.buffer,
    0,
    STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_HEADER_BYTES,
  );
  const headerView = new DataView(
    page.buffer,
    0,
    STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_HEADER_BYTES,
  );
  const magic = new TextDecoder().decode(header.subarray(0, 8));
  const digest = new TextDecoder().decode(header.subarray(32, 96));
  let expectedOffset = STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_HEADER_BYTES;
  const expectedStationOffset = expectedOffset;
  expectedOffset += groupCount * Uint32Array.BYTES_PER_ELEMENT;
  const expectedEntryOffset = expectedOffset;
  expectedOffset += groupCount * Uint32Array.BYTES_PER_ELEMENT;
  const expectedGroupContourOffset = expectedOffset;
  expectedOffset += (groupCount + 1) * Uint32Array.BYTES_PER_ELEMENT;
  const expectedContourCoordinateOffset = expectedOffset;
  expectedOffset += (contourCount + 1) * Uint32Array.BYTES_PER_ELEMENT;
  expectedOffset = Math.ceil(expectedOffset / Float64Array.BYTES_PER_ELEMENT)
    * Float64Array.BYTES_PER_ELEMENT;
  const expectedCoordinatesOffset = expectedOffset;
  expectedOffset += page.coordinates.length * Float64Array.BYTES_PER_ELEMENT;
  const expectedBoundsOffset = expectedOffset;
  if (
    groupCount <= 0
    || groupCount > STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_COUNT
    || !safeUint32(page.firstGroupIndex + groupCount - 1)
    || page.groupEntryIndexes.length !== groupCount
    || page.groupContourOffsets.length !== groupCount + 1
    || page.groupBounds.length !== groupCount * 4
    || contourCount <= 0
    || page.byteLength !== computedBytes
    || page.buffer.byteLength !== computedBytes
    || page.stationIndexes.buffer !== page.buffer
    || page.groupEntryIndexes.buffer !== page.buffer
    || page.groupContourOffsets.buffer !== page.buffer
    || page.contourCoordinateOffsets.buffer !== page.buffer
    || page.coordinates.buffer !== page.buffer
    || page.groupBounds.buffer !== page.buffer
    || magic !== STUDIO_DRY_MEDIA_UNION_CONTINUATION_PAGE_MAGIC
    || digest !== STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST
    || headerView.getUint32(8, true) !== 1
    || headerView.getUint32(12, true) !== page.pageIndex
    || headerView.getUint32(16, true) !== page.firstGroupIndex
    || headerView.getUint32(20, true) !== groupCount
    || headerView.getUint32(24, true) !== contourCount
    || headerView.getUint32(28, true) !== page.coordinates.length
    || page.stationIndexes.byteOffset !== expectedStationOffset
    || page.groupEntryIndexes.byteOffset !== expectedEntryOffset
    || page.groupContourOffsets.byteOffset !== expectedGroupContourOffset
    || page.contourCoordinateOffsets.byteOffset !== expectedContourCoordinateOffset
    || page.coordinates.byteOffset !== expectedCoordinatesOffset
    || page.groupBounds.byteOffset !== expectedBoundsOffset
    || computedBytes > STUDIO_DRY_MEDIA_UNION_CONTINUATION_MAX_GROUP_BYTES
    || page.groupContourOffsets[0] !== 0
    || page.groupContourOffsets[groupCount] !== contourCount
    || page.contourCoordinateOffsets[0] !== 0
    || page.contourCoordinateOffsets[contourCount] !== page.coordinates.length
  ) return false;
  for (let index = 1; index < page.groupContourOffsets.length; index += 1) {
    if (page.groupContourOffsets[index]! <= page.groupContourOffsets[index - 1]!) return false;
  }
  for (let index = 1; index < page.contourCoordinateOffsets.length; index += 1) {
    const length = page.contourCoordinateOffsets[index]!
      - page.contourCoordinateOffsets[index - 1]!;
    if (length < 6 || length % 2 !== 0) return false;
  }
  for (const value of page.coordinates) if (!Number.isFinite(value)) return false;
  for (const value of page.groupBounds) if (!Number.isFinite(value)) return false;
  return true;
}
