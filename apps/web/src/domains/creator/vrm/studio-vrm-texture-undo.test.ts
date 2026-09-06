import { describe, expect, it } from "vitest";

import {
  applyStudioVrmTexturePaintOp,
  createStudioVrmTextureBuffer,
  studioVrmTexturePaintOpRects,
  type StudioVrmTexturePaintOp,
} from "./studio-vrm-texture-paint-ops";
import {
  applyStudioVrmTextureUndoEntry,
  createStudioVrmTextureUndoRecorder,
  studioVrmTextureUndoEntryBytes,
} from "./studio-vrm-texture-undo";

import type { StudioVrmTextureSize } from "./studio-vrm-texture-uv";

const SIZE: StudioVrmTextureSize = { width: 128, height: 128 };

function seededBuffer(size: StudioVrmTextureSize): Uint8ClampedArray {
  const created = createStudioVrmTextureBuffer(size);
  if (!created) throw new Error("buffer");
  // 결정적 의사난수 — 복원 검증이 "0 으로 채웠더니 0 이더라" 로 통과하지 않게 한다.
  let state = 12345;
  for (let index = 0; index < created.length; index += 1) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    created[index] = state & 0xff;
  }
  return created;
}

function buffersEqual(
  first: Uint8ClampedArray,
  second: Uint8ClampedArray,
): boolean {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

const DAB: StudioVrmTexturePaintOp = {
  x: 40,
  y: 40,
  radius: 9,
  hardness: 0.8,
  color: "#ff2244",
  opacity: 0.9,
  blend: "normal",
};

function paintWithRecording(
  target: Uint8ClampedArray,
  ops: readonly StudioVrmTexturePaintOp[],
  size: StudioVrmTextureSize = SIZE,
) {
  const recorder = createStudioVrmTextureUndoRecorder(target, size);
  if (!recorder) throw new Error("recorder");
  for (const op of ops) {
    if (!recorder.recordAll(studioVrmTexturePaintOpRects(op, size))) {
      throw new Error("recorder-budget");
    }
    applyStudioVrmTexturePaintOp(target, size, op);
  }
  return recorder;
}

describe("studio-vrm-texture-undo delta", () => {
  it("restores the exact bytes of a stroke and replays it", () => {
    const target = seededBuffer(SIZE);
    const original = target.slice();

    const recorder = paintWithRecording(target, [
      DAB,
      { ...DAB, x: 52, y: 44 },
      { ...DAB, x: 64, y: 60, blend: "multiply" },
    ]);
    const painted = target.slice();
    expect(painted).not.toEqual(original);

    const entry = recorder.finish();
    expect(entry).not.toBeNull();

    expect(applyStudioVrmTextureUndoEntry(target, SIZE, entry!, "undo")).toBe(true);
    expect(target).toEqual(original);

    expect(applyStudioVrmTextureUndoEntry(target, SIZE, entry!, "redo")).toBe(true);
    expect(target).toEqual(painted);
  });

  it("stays exact when the stroke leaves an unrecorded tile inside the union bounds", () => {
    const target = seededBuffer(SIZE);
    const original = target.slice();

    // 서로 멀리 떨어진 두 dab — 합집합 rect 안에 기록되지 않은 타일이 통째로 들어간다.
    const recorder = paintWithRecording(target, [
      { ...DAB, x: 20, y: 20 },
      { ...DAB, x: 110, y: 104 },
    ]);
    const entry = recorder.finish();
    expect(entry).not.toBeNull();
    expect(entry!.rect.width).toBeGreaterThan(80);
    expect(recorder.recordedTileCount).toBeLessThan(8);
    expect(entry!.tileRects).toBeInstanceOf(Uint32Array);
    expect(entry!.before.byteLength).toBeLessThan(entry!.rect.width * entry!.rect.height * 4);

    applyStudioVrmTextureUndoEntry(target, SIZE, entry!, "undo");
    expect(target).toEqual(original);
  });

  it("retains a sparse 4K diagonal below 32 MiB and replays every byte exactly", () => {
    const size = { width: 4096, height: 4096 } satisfies StudioVrmTextureSize;
    const target = createStudioVrmTextureBuffer(size);
    if (!target) throw new Error("buffer");
    const maxHistoryBytes = 32 * 1024 * 1024;
    const recorder = createStudioVrmTextureUndoRecorder(
      target,
      size,
      64,
      maxHistoryBytes,
    );
    if (!recorder) throw new Error("recorder");

    for (let tileIndex = 0; tileIndex < 64; tileIndex += 1) {
      const coordinate = tileIndex * 64;
      expect(recorder.record({
        x: coordinate,
        y: coordinate,
        width: 1,
        height: 1,
      })).toBe(true);
      const offset = (coordinate * size.width + coordinate) * 4;
      target[offset] = tileIndex + 1;
      target[offset + 1] = 255 - tileIndex;
      target[offset + 2] = (tileIndex * 17) & 0xff;
      target[offset + 3] = 255;
    }
    const painted = target.slice();
    const entry = recorder.finish();

    expect(entry).not.toBeNull();
    expect(recorder.recordedTileCount).toBe(64);
    expect(entry!.tileRects).toHaveLength(64 * 4);
    expect(entry!.rect.width * entry!.rect.height * 4 * 2).toBeGreaterThan(
      maxHistoryBytes,
    );
    expect(studioVrmTextureUndoEntryBytes(entry!)).toBeLessThan(maxHistoryBytes);

    expect(applyStudioVrmTextureUndoEntry(target, size, entry!, "undo")).toBe(true);
    expect(target.every((value) => value === 0)).toBe(true);

    expect(applyStudioVrmTextureUndoEntry(target, size, entry!, "redo")).toBe(true);
    expect(buffersEqual(target, painted)).toBe(true);
  });

  it("records region deltas, not whole-texture snapshots", () => {
    const target = seededBuffer(SIZE);
    const recorder = paintWithRecording(target, [DAB]);
    const entry = recorder.finish();
    const fullTextureBytes = SIZE.width * SIZE.height * 4;
    expect(studioVrmTextureUndoEntryBytes(entry!)).toBeLessThan(fullTextureBytes / 8);
    // copy-on-write 는 dab 이 걸친 64×64 타일 하나만 뜬다.
    expect(recorder.recordedTileCount).toBe(1);
    expect(recorder.recordedBytes).toBe(64 * 64 * 4);
    expect(recorder.recordedBytes).toBeLessThan(fullTextureBytes);
  });

  it("captures a tile only once however many dabs hit it", () => {
    const target = seededBuffer(SIZE);
    const recorder = createStudioVrmTextureUndoRecorder(target, SIZE);
    if (!recorder) throw new Error("recorder");
    for (let step = 0; step < 40; step += 1) {
      const op = { ...DAB, x: 30 + step * 0.2, y: 30 };
      recorder.recordAll(studioVrmTexturePaintOpRects(op, SIZE));
      applyStudioVrmTexturePaintOp(target, SIZE, op);
    }
    expect(recorder.recordedTileCount).toBeLessThanOrEqual(4);
  });
});

describe("studio-vrm-texture-undo lifecycle", () => {
  it("cancel() rolls a half-finished stroke back in place", () => {
    const target = seededBuffer(SIZE);
    const original = target.slice();
    const recorder = paintWithRecording(target, [DAB, { ...DAB, x: 55 }]);
    expect(target).not.toEqual(original);
    expect(recorder.cancel()).toBeGreaterThan(0);
    expect(target).toEqual(original);
  });

  it("budgets sparse payload rather than distant union bounds and still cancels exactly", () => {
    const target = seededBuffer(SIZE);
    const original = target.slice();
    // 한 8×8 타일 = COW snapshot 256 B + before/after 512 B + packed rect 16 B.
    const recorder = createStudioVrmTextureUndoRecorder(target, SIZE, 8, 784);
    if (!recorder) throw new Error("recorder");

    expect(recorder.record({ x: 0, y: 0, width: 8, height: 8 })).toBe(true);
    target[0] = 255 - target[0]!;
    expect(recorder.record({ x: 120, y: 120, width: 8, height: 8 })).toBe(false);
    expect(recorder.budgetExceeded).toBe(true);
    expect(recorder.finish()).toBeNull();
    expect(recorder.recordedBytes).toBe(8 * 8 * 4);
    expect(recorder.cancel()).toBe(1);
    expect(target).toEqual(original);
  });

  it("rejects a one-pixel-many-tiles stroke before COW snapshots exceed its cap", () => {
    const size = { width: 256, height: 64 } satisfies StudioVrmTextureSize;
    const target = seededBuffer(size);
    const original = target.slice();
    const maxBytes = 64 * 1024;
    const recorder = createStudioVrmTextureUndoRecorder(target, size, 64, maxBytes);
    if (!recorder) throw new Error("recorder");

    for (const x of [0, 64, 128]) {
      expect(recorder.record({ x, y: 0, width: 1, height: 1 })).toBe(true);
      target[x * 4] = 255 - target[x * 4]!;
    }

    // 네 번째 1 px 자체의 최종 sparse entry는 작지만, 그 전에 64 KiB COW
    // snapshots와 before/after/metadata가 동시에 살아 메모리 상한을 넘는다.
    expect(recorder.record({ x: 192, y: 0, width: 1, height: 1 })).toBe(false);
    expect(recorder.budgetExceeded).toBe(true);
    expect(recorder.recordedTileCount).toBe(3);
    expect(recorder.recordedBytes).toBe(3 * 64 * 64 * 4);
    expect(recorder.recordedBytes).toBeLessThan(maxBytes);
    expect(recorder.finish()).toBeNull();
    expect(recorder.cancel()).toBe(3);
    expect(target).toEqual(original);
  });

  it("asks the runtime for growing peak capacity before allocating each new tile", () => {
    const size = { width: 128, height: 64 } satisfies StudioVrmTextureSize;
    const target = seededBuffer(size);
    const maxBytes = 64 * 1024;
    let retainedHistoryBytes = 50 * 1024;
    const observedSnapshotBytes: number[] = [];
    let recorder: ReturnType<typeof createStudioVrmTextureUndoRecorder> = null;
    recorder = createStudioVrmTextureUndoRecorder(
      target,
      size,
      64,
      maxBytes,
      (requiredPeakBytes) => {
        observedSnapshotBytes.push(recorder?.recordedBytes ?? 0);
        if (retainedHistoryBytes + requiredPeakBytes > maxBytes) {
          retainedHistoryBytes -= 20 * 1024;
        }
        return retainedHistoryBytes + requiredPeakBytes <= maxBytes;
      },
    );
    if (!recorder) throw new Error("recorder");

    expect(recorder.record({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(recorder.record({ x: 64, y: 0, width: 1, height: 1 })).toBe(true);
    expect(observedSnapshotBytes).toEqual([0, 64 * 64 * 4]);
    expect(retainedHistoryBytes).toBe(30 * 1024);
    expect(recorder.recordedBytes).toBe(2 * 64 * 64 * 4);
  });

  it("returns null when nothing was recorded and refuses double finish", () => {
    const target = seededBuffer(SIZE);
    const recorder = createStudioVrmTextureUndoRecorder(target, SIZE);
    expect(recorder?.finish()).toBeNull();
    expect(recorder?.finish()).toBeNull();

    const second = paintWithRecording(seededBuffer(SIZE), [DAB]);
    expect(second.finish()).not.toBeNull();
    expect(second.finish()).toBeNull();
  });

  it("ignores out-of-bounds records and mismatched buffers", () => {
    const target = seededBuffer(SIZE);
    expect(createStudioVrmTextureUndoRecorder(new Uint8ClampedArray(4), SIZE)).toBeNull();
    expect(createStudioVrmTextureUndoRecorder(target, { width: 0, height: 4 })).toBeNull();

    const recorder = createStudioVrmTextureUndoRecorder(target, SIZE);
    recorder?.record({ x: 900, y: 900, width: 4, height: 4 });
    expect(recorder?.recordedTileCount).toBe(0);
    expect(recorder?.finish()).toBeNull();
  });

  it("refuses to apply an entry whose payload no longer matches its rect", () => {
    const target = seededBuffer(SIZE);
    const entry = paintWithRecording(target, [DAB]).finish();
    expect(entry).not.toBeNull();
    const corrupted = { ...entry!, before: new Uint8ClampedArray(4) };
    expect(applyStudioVrmTextureUndoEntry(target, SIZE, corrupted, "undo")).toBe(false);
    expect(applyStudioVrmTextureUndoEntry(new Uint8ClampedArray(4), SIZE, entry!, "undo")).toBe(
      false,
    );
    expect(applyStudioVrmTextureUndoEntry(target, SIZE, {
      ...entry!,
      tileRects: new Uint32Array([0, 0, 64, 64]),
    }, "undo")).toBe(false);
  });

  it("keeps applying legacy single-rect entries without sparse metadata", () => {
    const target = seededBuffer(SIZE);
    const rect = { x: 2, y: 3, width: 2, height: 1 };
    const before = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);
    const after = new Uint8ClampedArray([9, 10, 11, 12, 13, 14, 15, 16]);
    const entry = { rect, before, after };

    expect(applyStudioVrmTextureUndoEntry(target, SIZE, entry, "undo")).toBe(true);
    const firstOffset = (rect.y * SIZE.width + rect.x) * 4;
    expect(target.slice(firstOffset, firstOffset + 8)).toEqual(before);
    expect(applyStudioVrmTextureUndoEntry(target, SIZE, entry, "redo")).toBe(true);
    expect(target.slice(firstOffset, firstOffset + 8)).toEqual(after);
  });

  it("closes an empty recorder after the first finish attempt", () => {
    const target = seededBuffer(SIZE);
    const recorder = createStudioVrmTextureUndoRecorder(target, SIZE);
    if (!recorder) throw new Error("recorder");

    expect(recorder.finish()).toBeNull();
    expect(recorder.record({ x: 0, y: 0, width: 4, height: 4 })).toBe(false);
    expect(recorder.cancel()).toBe(0);
  });

  it("clips a recorded rect that hangs off the texture edge", () => {
    const target = seededBuffer(SIZE);
    const original = target.slice();
    const edge: StudioVrmTexturePaintOp = { ...DAB, x: 1, y: 1 };
    const recorder = paintWithRecording(target, [edge]);
    const entry = recorder.finish();
    expect(entry?.rect.x).toBe(0);
    expect(entry?.rect.y).toBe(0);
    applyStudioVrmTextureUndoEntry(target, SIZE, entry!, "undo");
    expect(target).toEqual(original);
  });
});
