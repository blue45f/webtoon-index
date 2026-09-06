import { describe, expect, it } from "vitest";

import {
  createNullSculptMeshSink,
  createSculptDirtyRangeTracker,
  flushSculptDirtyRanges,
  markSculptDirtyRange,
  markSculptDirtyVertex,
  markSculptDirtyVertices,
  peekSculptDirtyRanges,
  takeSculptDirtyRanges,
} from "./studio-sculpt-render-bridge";

describe("sculpt render bridge — dirty range 병합", () => {
  it("mergeGap 안의 인접 정점을 하나의 범위로 합친다", () => {
    const tracker = createSculptDirtyRangeTracker({ mergeGap: 4, maxRanges: 32 });
    for (const v of [10, 11, 12, 15]) markSculptDirtyVertex(tracker, v);
    expect(peekSculptDirtyRanges(tracker)).toEqual([{ firstVertex: 10, vertexCount: 6 }]);
  });

  it("mergeGap 보다 멀면 별도 범위로 남는다", () => {
    const tracker = createSculptDirtyRangeTracker({ mergeGap: 2 });
    markSculptDirtyVertex(tracker, 0);
    markSculptDirtyVertex(tracker, 100);
    markSculptDirtyVertex(tracker, 3); // 0 과 gap 2 → 합쳐진다.
    expect(peekSculptDirtyRanges(tracker)).toEqual([
      { firstVertex: 0, vertexCount: 4 },
      { firstVertex: 100, vertexCount: 1 },
    ]);
  });

  it("삽입 순서가 뒤죽박죽이어도 항상 정렬·병합된 결과가 나온다", () => {
    const forward = createSculptDirtyRangeTracker({ mergeGap: 0 });
    const backward = createSculptDirtyRangeTracker({ mergeGap: 0 });
    const vertices = [7, 3, 8, 40, 41, 1, 2, 39];
    for (const v of vertices) markSculptDirtyVertex(forward, v);
    for (const v of [...vertices].reverse()) markSculptDirtyVertex(backward, v);
    expect(peekSculptDirtyRanges(forward)).toEqual([
      { firstVertex: 1, vertexCount: 3 },
      { firstVertex: 7, vertexCount: 2 },
      { firstVertex: 39, vertexCount: 3 },
    ]);
    expect(peekSculptDirtyRanges(backward)).toEqual(peekSculptDirtyRanges(forward));
  });

  it("범위 수가 maxRanges 를 넘는 순간 전체를 덮는 단일 범위로 붕괴한다", () => {
    const tracker = createSculptDirtyRangeTracker({ mergeGap: 0, maxRanges: 4 });
    for (let i = 0; i < 5; i += 1) markSculptDirtyVertex(tracker, i * 10);
    expect(peekSculptDirtyRanges(tracker)).toEqual([{ firstVertex: 0, vertexCount: 41 }]);
    expect(tracker.collapsed).toBe(true);
  });

  it("붕괴 후 다시 쌓여도 범위 수는 항상 상한 이하이고 마킹을 하나도 놓치지 않는다", () => {
    const tracker = createSculptDirtyRangeTracker({ mergeGap: 0, maxRanges: 4 });
    const marked: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const vertex = i * 7;
      marked.push(vertex);
      markSculptDirtyVertex(tracker, vertex);
      expect(peekSculptDirtyRanges(tracker).length).toBeLessThanOrEqual(4);
    }
    const ranges = peekSculptDirtyRanges(tracker);
    for (const vertex of marked) {
      const covered = ranges.some(
        (range) =>
          vertex >= range.firstVertex && vertex < range.firstVertex + range.vertexCount,
      );
      expect({ vertex, covered }).toEqual({ vertex, covered: true });
    }
  });

  it("범위 마킹은 길이가 0 이하면 무시한다", () => {
    const tracker = createSculptDirtyRangeTracker();
    markSculptDirtyRange(tracker, 5, 0);
    markSculptDirtyRange(tracker, 5, -3);
    expect(peekSculptDirtyRanges(tracker)).toEqual([]);
  });

  it("배열 마킹은 count 만큼만 읽는다", () => {
    const tracker = createSculptDirtyRangeTracker({ mergeGap: 0 });
    markSculptDirtyVertices(tracker, new Uint32Array([1, 2, 900]), 2);
    expect(peekSculptDirtyRanges(tracker)).toEqual([{ firstVertex: 1, vertexCount: 2 }]);
  });

  it("take 는 스냅샷을 주고 트래커를 비운다", () => {
    const tracker = createSculptDirtyRangeTracker();
    markSculptDirtyVertex(tracker, 42);
    expect(takeSculptDirtyRanges(tracker)).toEqual([{ firstVertex: 42, vertexCount: 1 }]);
    expect(takeSculptDirtyRanges(tracker)).toEqual([]);
    expect(tracker.collapsed).toBe(false);
  });
});

describe("sculpt render bridge — sink 시임", () => {
  it("null sink 가 위치·법선 업로드를 같은 범위로 받아 기록한다", () => {
    const tracker = createSculptDirtyRangeTracker({ mergeGap: 0 });
    markSculptDirtyVertex(tracker, 2);
    markSculptDirtyVertex(tracker, 3);
    markSculptDirtyVertex(tracker, 9);
    const sink = createNullSculptMeshSink();
    const positions = new Float32Array(30);
    const normals = new Float32Array(30);
    const flushed = flushSculptDirtyRanges(tracker, sink, positions, normals);
    expect(flushed).toBe(2);
    expect(sink.positionRanges).toEqual([
      { firstVertex: 2, vertexCount: 2 },
      { firstVertex: 9, vertexCount: 1 },
    ]);
    expect(sink.normalRanges).toEqual(sink.positionRanges);
    expect(sink.uploadedVertexCount).toBe(3);
    // flush 는 트래커를 비운다 — 같은 범위를 두 번 올리지 않는다.
    expect(flushSculptDirtyRanges(tracker, sink, positions, normals)).toBe(0);
    expect(sink.positionRanges.length).toBe(2);
  });

  it("커스텀 sink 는 실제 배열 내용을 받는다(업로드 서술이 데이터와 이어져 있다)", () => {
    const tracker = createSculptDirtyRangeTracker();
    markSculptDirtyRange(tracker, 1, 2);
    const positions = new Float32Array([0, 0, 0, 5, 6, 7, 8, 9, 10]);
    const normals = new Float32Array(9);
    const seen: number[] = [];
    flushSculptDirtyRanges(
      tracker,
      {
        uploadPositions(source, range) {
          for (let v = 0; v < range.vertexCount; v += 1) {
            const base = (range.firstVertex + v) * 3;
            seen.push(source[base], source[base + 1], source[base + 2]);
          }
        },
        uploadNormals() {
          /* 이 테스트는 위치만 본다. */
        },
      },
      positions,
      normals,
    );
    expect(seen).toEqual([5, 6, 7, 8, 9, 10]);
  });
});
