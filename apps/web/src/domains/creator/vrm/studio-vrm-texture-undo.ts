/**
 * VRM 텍스처 페인팅 — 획 단위 언두(영역 델타).
 *
 * 4K 아틀라스 하나가 64 MiB 다. 획마다 전체 스냅샷을 쌓으면 몇 획 만에 메모리가 끝난다.
 * 그래서 이 모듈은 **건드린 영역만** 기록한다.
 *
 * 동작:
 *  1) 획 시작 시 레코더를 만들고, dab 을 칠하기 **직전** 그 dab 의 사각형을 `record()` 한다.
 *  2) 레코더는 해당 사각형이 걸치는 64×64 타일을 최초 1 회만 통째로 복사해 둔다
 *     (copy-on-write). 같은 타일을 다시 칠해도 추가 비용이 없다.
 *  3) 획이 끝나면 각 타일 안에서 실제로 건드린 로컬 영역만 packed before/after 로 만든다.
 *     멀리 떨어진 dab 또는 4K 대각선 획도 거대한 합집합 사각형을 할당하지 않는다.
 *
 * 호출 계약(테스트로 고정): 레코딩 세션 동안 대상 버퍼는 **`record()` 로 신고한 영역 밖을
 * 변경해서는 안 된다.** cancel 은 COW 타일 전체를, 완료된 undo/redo 는 신고한 타일별 로컬
 * 영역만 정확히 복원한다.
 */

import {
  clipStudioVrmTextureRect,
  isStudioVrmTextureBuffer,
  isStudioVrmTextureRectEmpty,
  readStudioVrmTextureRegion,
  unionStudioVrmTextureRect,
  writeStudioVrmTextureRegion,
  EMPTY_STUDIO_VRM_TEXTURE_RECT,
} from "./studio-vrm-texture-paint-ops";
import {
  isStudioVrmTextureSize,
  type StudioVrmTextureRect,
  type StudioVrmTextureSize,
} from "./studio-vrm-texture-uv";

export const STUDIO_VRM_TEXTURE_UNDO_TILE_SIZE = 64;

export type StudioVrmTextureUndoDirection = "undo" | "redo";

export interface StudioVrmTextureUndoEntry {
  /** 모든 sparse region 의 진단·dirty-upload용 합집합. payload 크기를 뜻하지 않는다. */
  readonly rect: StudioVrmTextureRect;
  /**
   * 획 이전 RGBA.
   * `tileRects`가 있으면 각 rect payload를 순서대로 붙인 packed 배열이고,
   * 없으면 이전 공개 형식과 동일하게 `rect` 크기의 단일 region이다.
   */
  readonly before: Uint8ClampedArray;
  /** `before`와 동일한 layout의 획 이후 RGBA. */
  readonly after: Uint8ClampedArray;
  /**
   * sparse region metadata: `[x, y, width, height, ...]`.
   * optional로 두어 기존 단일-rect entry도 그대로 적용할 수 있다.
   */
  readonly tileRects?: Uint32Array;
}

export interface StudioVrmTextureUndoRecorder {
  /** 이 사각형을 칠하기 **전에** 호출한다. */
  record(rect: StudioVrmTextureRect): boolean;
  recordAll(rects: readonly StudioVrmTextureRect[]): boolean;
  /** 획 종료 — before/after 델타를 만든다. 기록이 없으면 null. */
  finish(): StudioVrmTextureUndoEntry | null;
  /** 획 취소 — 기록해 둔 타일을 원래대로 되돌린다. 되돌린 타일 수를 반환. */
  cancel(): number;
  /** true 면 retained-history byte cap 때문에 현재 획을 정확히 보존할 수 없다. */
  readonly budgetExceeded: boolean;
  readonly recordedTileCount: number;
  readonly recordedBytes: number;
}

/**
 * 현재 획의 COW snapshots와 완료 entry가 동시에 차지할 최대 바이트를
 * 실제 할당 전에 승인한다. 런타임은 이 지점에서 오래된 history를 bounded-ring으로
 * 퇴거해 전체 상주 상한을 지킬 수 있다.
 */
export type StudioVrmTextureUndoPeakAdmission = (requiredPeakBytes: number) => boolean;

function normalizedTileSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return STUDIO_VRM_TEXTURE_UNDO_TILE_SIZE;
  return Math.max(8, Math.min(512, Math.floor(value)));
}

/**
 * 레코더는 `source` 를 살아 있는 버퍼로 계속 참조한다(호출자가 그 자리에서 변경한다).
 * 크기/버퍼가 맞지 않으면 null.
 */
export function createStudioVrmTextureUndoRecorder(
  source: Uint8ClampedArray,
  size: StudioVrmTextureSize,
  tileSize: number = STUDIO_VRM_TEXTURE_UNDO_TILE_SIZE,
  maxBytes: number = Number.MAX_SAFE_INTEGER,
  admitPeak?: StudioVrmTextureUndoPeakAdmission,
): StudioVrmTextureUndoRecorder | null {
  if (!isStudioVrmTextureSize(size)) return null;
  if (!isStudioVrmTextureBuffer(source, size)) return null;

  const tile = normalizedTileSize(tileSize);
  const byteCap =
    typeof maxBytes === "number" && Number.isFinite(maxBytes) && maxBytes >= 0
      ? Math.floor(maxBytes)
      : Number.MAX_SAFE_INTEGER;
  const tilesPerRow = Math.ceil(size.width / tile);
  const tilesPerColumn = Math.ceil(size.height / tile);
  const snapshots = new Map<number, Uint8ClampedArray>();
  const dirtyRects = new Map<number, StudioVrmTextureRect>();
  let bounds: StudioVrmTextureRect = EMPTY_STUDIO_VRM_TEXTURE_RECT;
  let retainedRegionBytes = 0;
  let capturedTileCount = 0;
  let capturedBytes = 0;
  let admittedPeakBytes = 0;
  let budgetExceeded = false;
  let finished = false;

  const tileRect = (tileX: number, tileY: number): StudioVrmTextureRect => {
    const x = tileX * tile;
    const y = tileY * tile;
    return {
      x,
      y,
      width: Math.min(tile, size.width - x),
      height: Math.min(tile, size.height - y),
    };
  };

  const intersectRects = (
    first: StudioVrmTextureRect,
    second: StudioVrmTextureRect,
  ): StudioVrmTextureRect => {
    const x = Math.max(first.x, second.x);
    const y = Math.max(first.y, second.y);
    const right = Math.min(first.x + first.width, second.x + second.width);
    const bottom = Math.min(first.y + first.height, second.y + second.height);
    if (right <= x || bottom <= y) return EMPTY_STUDIO_VRM_TEXTURE_RECT;
    return { x, y, width: right - x, height: bottom - y };
  };

  const rectBytes = (rect: StudioVrmTextureRect): number | null => {
    const pixels = rect.width * rect.height;
    const bytes = pixels * 4;
    return Number.isSafeInteger(pixels) && Number.isSafeInteger(bytes) && bytes >= 0
      ? bytes
      : null;
  };

  const safeByteSum = (first: number, second: number): number | null => {
    if (
      !Number.isSafeInteger(first)
      || first < 0
      || !Number.isSafeInteger(second)
      || second < 0
      || first > Number.MAX_SAFE_INTEGER - second
    ) {
      return null;
    }
    return first + second;
  };

  const admitRequiredPeak = (requiredPeakBytes: number): boolean => {
    if (
      !Number.isSafeInteger(requiredPeakBytes)
      || requiredPeakBytes < 0
      || requiredPeakBytes > byteCap
    ) {
      return false;
    }
    if (requiredPeakBytes <= admittedPeakBytes) return true;
    if (admitPeak) {
      try {
        if (!admitPeak(requiredPeakBytes)) return false;
      } catch {
        return false;
      }
    }
    admittedPeakBytes = requiredPeakBytes;
    return true;
  };

  const captureTile = (tileX: number, tileY: number): boolean => {
    const key = tileY * tilesPerRow + tileX;
    if (snapshots.has(key)) return true;
    let pixels: Uint8ClampedArray | null;
    try {
      pixels = readStudioVrmTextureRegion(source, size, tileRect(tileX, tileY));
    } catch {
      return false;
    }
    if (!pixels) return false;
    snapshots.set(key, pixels);
    capturedTileCount += 1;
    const nextCapturedBytes = safeByteSum(capturedBytes, pixels.byteLength);
    if (nextCapturedBytes === null) {
      snapshots.delete(key);
      capturedTileCount -= 1;
      return false;
    }
    capturedBytes = nextCapturedBytes;
    return true;
  };

  const record = (rect: StudioVrmTextureRect): boolean => {
    if (finished || budgetExceeded) return false;
    const clipped = clipStudioVrmTextureRect(rect, size);
    if (isStudioVrmTextureRectEmpty(clipped)) return true;
    const nextBounds = unionStudioVrmTextureRect(bounds, clipped);
    const firstTileX = Math.floor(clipped.x / tile);
    const lastTileX = Math.min(tilesPerRow - 1, Math.floor((clipped.x + clipped.width - 1) / tile));
    const firstTileY = Math.floor(clipped.y / tile);
    const lastTileY = Math.min(
      tilesPerColumn - 1,
      Math.floor((clipped.y + clipped.height - 1) / tile),
    );
    const updates: Array<Readonly<{
      key: number;
      tileX: number;
      tileY: number;
      nextDirty: StudioVrmTextureRect;
    }>> = [];
    let prospectiveRegionBytes = retainedRegionBytes;
    let prospectiveTileCount = snapshots.size;
    let prospectiveCapturedBytes = capturedBytes;
    for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
      for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
        const key = tileY * tilesPerRow + tileX;
        const localTileRect = tileRect(tileX, tileY);
        const intersection = intersectRects(clipped, localTileRect);
        if (isStudioVrmTextureRectEmpty(intersection)) continue;
        const previousDirty = dirtyRects.get(key);
        const nextDirty = previousDirty
          ? unionStudioVrmTextureRect(previousDirty, intersection)
          : intersection;
        const previousRegionBytes = previousDirty ? rectBytes(previousDirty) : 0;
        const nextRegionBytes = rectBytes(nextDirty);
        if (previousRegionBytes === null || nextRegionBytes === null) {
          budgetExceeded = true;
          return false;
        }
        const withoutPrevious = prospectiveRegionBytes - previousRegionBytes;
        const nextProspectiveRegionBytes = safeByteSum(withoutPrevious, nextRegionBytes);
        if (withoutPrevious < 0 || nextProspectiveRegionBytes === null) {
          budgetExceeded = true;
          return false;
        }
        prospectiveRegionBytes = nextProspectiveRegionBytes;
        if (!snapshots.has(key)) {
          const snapshotBytes = rectBytes(localTileRect);
          const nextProspectiveCapturedBytes = snapshotBytes === null
            ? null
            : safeByteSum(prospectiveCapturedBytes, snapshotBytes);
          if (nextProspectiveCapturedBytes === null) {
            budgetExceeded = true;
            return false;
          }
          prospectiveCapturedBytes = nextProspectiveCapturedBytes;
          prospectiveTileCount += 1;
        }
        updates.push({ key, tileX, tileY, nextDirty });
      }
    }
    const prospectivePayloadBytes = safeByteSum(
      prospectiveRegionBytes,
      prospectiveRegionBytes,
    );
    const prospectiveMetadataBytes =
      prospectiveTileCount * 4 * Uint32Array.BYTES_PER_ELEMENT;
    const prospectiveEntryBytes = prospectivePayloadBytes === null
      || !Number.isSafeInteger(prospectiveMetadataBytes)
      ? null
      : safeByteSum(prospectivePayloadBytes, prospectiveMetadataBytes);
    const prospectivePeakBytes = prospectiveEntryBytes === null
      ? null
      : safeByteSum(prospectiveCapturedBytes, prospectiveEntryBytes);
    if (prospectivePeakBytes === null || !admitRequiredPeak(prospectivePeakBytes)) {
      budgetExceeded = true;
      return false;
    }
    for (const update of updates) {
      if (!captureTile(update.tileX, update.tileY)) {
        budgetExceeded = true;
        return false;
      }
      dirtyRects.set(update.key, update.nextDirty);
    }
    retainedRegionBytes = prospectiveRegionBytes;
    bounds = nextBounds;
    return true;
  };

  const copySourceRegion = (
    region: StudioVrmTextureRect,
    target: Uint8ClampedArray,
    targetOffset: number,
  ): boolean => {
    let writeOffset = targetOffset;
    const rowBytes = region.width * 4;
    if (!Number.isSafeInteger(rowBytes) || rowBytes < 0) return false;
    for (let row = 0; row < region.height; row += 1) {
      const sourceOffset = ((region.y + row) * size.width + region.x) * 4;
      if (
        sourceOffset < 0
        || sourceOffset + rowBytes > source.length
        || writeOffset + rowBytes > target.length
      ) {
        return false;
      }
      target.set(source.subarray(sourceOffset, sourceOffset + rowBytes), writeOffset);
      writeOffset += rowBytes;
    }
    return true;
  };

  const copySnapshotRegion = (
    snapshot: Uint8ClampedArray,
    snapshotRect: StudioVrmTextureRect,
    region: StudioVrmTextureRect,
    target: Uint8ClampedArray,
    targetOffset: number,
  ): boolean => {
    const expectedSnapshotBytes = snapshotRect.width * snapshotRect.height * 4;
    if (snapshot.byteLength !== expectedSnapshotBytes) return false;
    let writeOffset = targetOffset;
    for (let row = 0; row < region.height; row += 1) {
      const sourceOffset =
        ((region.y - snapshotRect.y + row) * snapshotRect.width +
          region.x -
          snapshotRect.x) *
        4;
      const rowBytes = region.width * 4;
      if (
        sourceOffset < 0 ||
        sourceOffset + rowBytes > snapshot.length ||
        writeOffset + rowBytes > target.length
      ) {
        return false;
      }
      target.set(snapshot.subarray(sourceOffset, sourceOffset + rowBytes), writeOffset);
      writeOffset += rowBytes;
    }
    return true;
  };

  return {
    record,
    recordAll(rects: readonly StudioVrmTextureRect[]): boolean {
      for (const rect of rects) {
        if (!record(rect)) return false;
      }
      return true;
    },
    finish(): StudioVrmTextureUndoEntry | null {
      if (finished || budgetExceeded) return null;
      if (isStudioVrmTextureRectEmpty(bounds)) {
        finished = true;
        snapshots.clear();
        dirtyRects.clear();
        return null;
      }
      const rect = clipStudioVrmTextureRect(bounds, size);
      if (isStudioVrmTextureRectEmpty(rect)) {
        finished = true;
        snapshots.clear();
        dirtyRects.clear();
        return null;
      }
      const ordered = [...dirtyRects.entries()].sort(([first], [second]) => first - second);
      if (ordered.length === 0) {
        finished = true;
        snapshots.clear();
        return null;
      }
      const metadataBytes = ordered.length * 4 * Uint32Array.BYTES_PER_ELEMENT;
      const payloadBytes = safeByteSum(retainedRegionBytes, retainedRegionBytes);
      const entryBytes = payloadBytes === null || !Number.isSafeInteger(metadataBytes)
        ? null
        : safeByteSum(payloadBytes, metadataBytes);
      const finishPeakBytes = entryBytes === null
        ? null
        : safeByteSum(capturedBytes, entryBytes);
      if (finishPeakBytes === null || !admitRequiredPeak(finishPeakBytes)) {
        budgetExceeded = true;
        return null;
      }
      try {
        const before = new Uint8ClampedArray(retainedRegionBytes);
        const after = new Uint8ClampedArray(retainedRegionBytes);
        const tileRects = new Uint32Array(ordered.length * 4);
        let payloadOffset = 0;
        for (let index = 0; index < ordered.length; index += 1) {
          const [key, dirtyRect] = ordered[index]!;
          const tileX = key % tilesPerRow;
          const tileY = Math.floor(key / tilesPerRow);
          const localTileRect = tileRect(tileX, tileY);
          const snapshot = snapshots.get(key);
          if (
            !snapshot ||
            !copySnapshotRegion(snapshot, localTileRect, dirtyRect, before, payloadOffset) ||
            !copySourceRegion(dirtyRect, after, payloadOffset)
          ) {
            budgetExceeded = true;
            return null;
          }
          const metadataOffset = index * 4;
          tileRects[metadataOffset] = dirtyRect.x;
          tileRects[metadataOffset + 1] = dirtyRect.y;
          tileRects[metadataOffset + 2] = dirtyRect.width;
          tileRects[metadataOffset + 3] = dirtyRect.height;
          const dirtyBytes = rectBytes(dirtyRect);
          if (dirtyBytes === null) {
            budgetExceeded = true;
            return null;
          }
          payloadOffset += dirtyBytes;
        }
        if (payloadOffset !== retainedRegionBytes) {
          budgetExceeded = true;
          return null;
        }
        snapshots.clear();
        dirtyRects.clear();
        finished = true;
        return { rect, before, after, tileRects };
      } catch {
        budgetExceeded = true;
        return null;
      }
    },
    cancel(): number {
      if (finished) return 0;
      finished = true;
      let restored = 0;
      for (const [key, pixels] of snapshots) {
        const tileX = key % tilesPerRow;
        const tileY = Math.floor(key / tilesPerRow);
        if (writeStudioVrmTextureRegion(source, size, tileRect(tileX, tileY), pixels)) {
          restored += 1;
        }
      }
      snapshots.clear();
      dirtyRects.clear();
      return restored;
    },
    get budgetExceeded(): boolean {
      return budgetExceeded;
    },
    get recordedTileCount(): number {
      return capturedTileCount;
    },
    get recordedBytes(): number {
      return capturedBytes;
    },
  };
}

/** 델타를 되돌리거나(undo) 다시 적용한다(redo). 크기가 안 맞으면 false. */
export function applyStudioVrmTextureUndoEntry(
  target: Uint8ClampedArray,
  size: StudioVrmTextureSize,
  entry: StudioVrmTextureUndoEntry,
  direction: StudioVrmTextureUndoDirection,
): boolean {
  if (!isStudioVrmTextureBuffer(target, size)) return false;
  const pixels = direction === "undo" ? entry.before : entry.after;
  const tileRects = entry.tileRects;
  if (!tileRects) {
    if (pixels.length !== entry.rect.width * entry.rect.height * 4) return false;
    return writeStudioVrmTextureRegion(target, size, entry.rect, pixels);
  }
  if (!(tileRects instanceof Uint32Array)) return false;
  if (tileRects.length === 0 || tileRects.length % 4 !== 0) return false;
  if (entry.before.length !== entry.after.length || pixels.length !== entry.before.length) {
    return false;
  }

  const regions: StudioVrmTextureRect[] = [];
  let expectedPayloadBytes = 0;
  let expectedBounds: StudioVrmTextureRect = EMPTY_STUDIO_VRM_TEXTURE_RECT;
  for (let offset = 0; offset < tileRects.length; offset += 4) {
    const rect = {
      x: tileRects[offset]!,
      y: tileRects[offset + 1]!,
      width: tileRects[offset + 2]!,
      height: tileRects[offset + 3]!,
    };
    const clipped = clipStudioVrmTextureRect(rect, size);
    if (
      isStudioVrmTextureRectEmpty(clipped) ||
      clipped.x !== rect.x ||
      clipped.y !== rect.y ||
      clipped.width !== rect.width ||
      clipped.height !== rect.height
    ) {
      return false;
    }
    const regionBytes = rect.width * rect.height * 4;
    if (!Number.isSafeInteger(regionBytes)) return false;
    expectedPayloadBytes += regionBytes;
    if (!Number.isSafeInteger(expectedPayloadBytes) || expectedPayloadBytes > pixels.length) {
      return false;
    }
    expectedBounds = unionStudioVrmTextureRect(expectedBounds, rect);
    regions.push(rect);
  }
  if (expectedPayloadBytes !== pixels.length) return false;
  if (
    expectedBounds.x !== entry.rect.x ||
    expectedBounds.y !== entry.rect.y ||
    expectedBounds.width !== entry.rect.width ||
    expectedBounds.height !== entry.rect.height
  ) {
    return false;
  }

  let payloadOffset = 0;
  for (const rect of regions) {
    const regionBytes = rect.width * rect.height * 4;
    if (
      !writeStudioVrmTextureRegion(
        target,
        size,
        rect,
        pixels.subarray(payloadOffset, payloadOffset + regionBytes),
      )
    ) {
      return false;
    }
    payloadOffset += regionBytes;
  }
  return true;
}

/** 이 델타가 차지하는 바이트(전체 텍스처 스냅샷 대비 얼마나 작은지 계측·예산용). */
export function studioVrmTextureUndoEntryBytes(entry: StudioVrmTextureUndoEntry): number {
  return (
    entry.before.byteLength +
    entry.after.byteLength +
    (entry.tileRects?.byteLength ?? 0)
  );
}
