import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCULPT_HISTORY_LIMITS,
  SCULPT_DELTA_BYTES_PER_VERTEX,
  applySculptDelta,
  canRedoSculptHistory,
  canUndoSculptHistory,
  clearSculptHistory,
  createSculptDeltaRecorder,
  createSculptHistory,
  finalizeSculptDelta,
  normalizeSculptHistoryLimits,
  pushSculptDelta,
  recordSculptVertexBefore,
  redoSculptHistory,
  revertSculptDelta,
  sculptDeltaBytes,
  sculptDeltaTouchedVertices,
  undoSculptHistory,
  type SculptVertexDelta,
} from "./studio-sculpt-history";

function makePositions(count: number): Float32Array {
  const positions = new Float32Array(count * 3);
  for (let v = 0; v < count; v += 1) {
    positions[v * 3] = v * 0.125;
    positions[v * 3 + 1] = v * -0.25;
    positions[v * 3 + 2] = v * 0.0625;
  }
  return positions;
}

function expectBitIdentical(actual: Float32Array, expected: Float32Array): void {
  expect(actual.length).toBe(expected.length);
  let mismatch = -1;
  for (let i = 0; i < actual.length; i += 1) {
    if (actual[i] !== expected[i]) {
      mismatch = i;
      break;
    }
  }
  expect(mismatch).toBe(-1);
}

/** 정점 몇 개를 건드리며 델타를 기록하는 헬퍼. */
function editVertices(
  positions: Float32Array,
  vertices: readonly number[],
  amount: number,
  limits = DEFAULT_SCULPT_HISTORY_LIMITS,
): SculptVertexDelta {
  const recorder = createSculptDeltaRecorder(positions.length / 3, limits);
  for (const v of vertices) {
    expect(recordSculptVertexBefore(recorder, v, positions)).toBe(true);
    positions[v * 3] += amount;
    positions[v * 3 + 1] += amount * 2;
    positions[v * 3 + 2] += amount * 3;
  }
  return finalizeSculptDelta(recorder, positions);
}

describe("sculpt history — 델타 기록/복원", () => {
  it("접촉한 정점만 기록하고, 되돌리면 원본이 비트 동일하게 복원된다", () => {
    const positions = makePositions(200);
    const original = Float32Array.from(positions);
    const touchedList = [3, 17, 18, 19, 120, 199];
    const delta = editVertices(positions, touchedList, 0.375);

    expect(Array.from(sculptDeltaTouchedVertices(delta))).toEqual(touchedList);
    expect(delta.before.length).toBe(touchedList.length * 3);
    expect(sculptDeltaBytes(delta)).toBe(touchedList.length * SCULPT_DELTA_BYTES_PER_VERTEX);
    // 건드리지 않은 정점은 그대로여야 한다.
    expect(positions[4 * 3]).toBe(original[4 * 3]);

    const mutated = Float32Array.from(positions);
    revertSculptDelta(positions, delta);
    expectBitIdentical(positions, original);
    applySculptDelta(positions, delta);
    expectBitIdentical(positions, mutated);
  });

  it("같은 정점을 여러 번 건드려도 before 는 최초 값 하나만 남는다", () => {
    const positions = makePositions(20);
    const original = Float32Array.from(positions);
    const recorder = createSculptDeltaRecorder(20);
    for (let pass = 0; pass < 5; pass += 1) {
      expect(recordSculptVertexBefore(recorder, 7, positions)).toBe(true);
      positions[7 * 3] += 1;
    }
    expect(recorder.count).toBe(1);
    const delta = finalizeSculptDelta(recorder, positions);
    expect(delta.touched.length).toBe(1);
    expect(delta.after[0]).toBe(original[21] + 5);
    revertSculptDelta(positions, delta);
    expectBitIdentical(positions, original);
  });

  it("델타 버퍼가 초기 용량을 넘어가면 커지면서 값을 보존한다", () => {
    const positions = makePositions(5000);
    const original = Float32Array.from(positions);
    const vertices: number[] = [];
    for (let v = 0; v < 5000; v += 1) vertices.push(v);
    const delta = editVertices(positions, vertices, 0.5);
    expect(delta.touched.length).toBe(5000);
    revertSculptDelta(positions, delta);
    expectBitIdentical(positions, original);
  });
});

describe("sculpt history — 예산 fail-closed", () => {
  it("정점 수 상한을 넘으면 기록을 거부하고 exceeded 를 세운다", () => {
    const positions = makePositions(100);
    const limits = normalizeSculptHistoryLimits({ maxVerticesPerDelta: 5 });
    const recorder = createSculptDeltaRecorder(100, limits);
    for (let v = 0; v < 5; v += 1) {
      expect(recordSculptVertexBefore(recorder, v, positions)).toBe(true);
    }
    expect(recordSculptVertexBefore(recorder, 5, positions)).toBe(false);
    expect(recorder.exceeded).toBe(true);
    // 한 번 넘기면 회복하지 않는다(이미 기록된 정점에 대해서도).
    expect(recordSculptVertexBefore(recorder, 0, positions)).toBe(false);
  });

  it("바이트 상한을 넘으면 거부한다 — 28B/정점 산식이 실제로 적용된다", () => {
    const positions = makePositions(100);
    const limits = normalizeSculptHistoryLimits({ maxBytes: 1024, maxVerticesPerDelta: 1_000_000 });
    const allowed = Math.floor(1024 / SCULPT_DELTA_BYTES_PER_VERTEX);
    const recorder = createSculptDeltaRecorder(100, limits);
    let accepted = 0;
    for (let v = 0; v < 100; v += 1) {
      if (!recordSculptVertexBefore(recorder, v, positions)) break;
      accepted += 1;
    }
    expect(accepted).toBe(Math.min(100, allowed));
  });

  it("기본 예산은 655k 정점 극단 스트로크(약 18.3MB)를 실제로 거부한다", () => {
    const extremeBytes = 655_362 * SCULPT_DELTA_BYTES_PER_VERTEX;
    expect(extremeBytes).toBeGreaterThan(DEFAULT_SCULPT_HISTORY_LIMITS.maxBytes);
    expect(Math.round(extremeBytes / 1024 / 1024)).toBe(18);
  });

  it("한도 정규화가 잘못된 입력을 기본값으로 되돌린다", () => {
    const limits = normalizeSculptHistoryLimits({
      maxEntries: -3,
      maxBytes: Number.NaN,
      maxVerticesPerDelta: 0,
    });
    expect(limits).toEqual(DEFAULT_SCULPT_HISTORY_LIMITS);
  });
});

describe("sculpt history — 선형 스택", () => {
  it("undo/redo 가 정확한 좌표로 왕복한다", () => {
    const positions = makePositions(50);
    const stage0 = Float32Array.from(positions);
    const history = createSculptHistory();

    const first = editVertices(positions, [1, 2, 3], 1);
    pushSculptDelta(history, first);
    const stage1 = Float32Array.from(positions);

    const second = editVertices(positions, [3, 4, 5], 2);
    pushSculptDelta(history, second);
    const stage2 = Float32Array.from(positions);

    expect(canUndoSculptHistory(history)).toBe(true);
    expect(canRedoSculptHistory(history)).toBe(false);

    expect(undoSculptHistory(history, positions)).toBe(second);
    expectBitIdentical(positions, stage1);
    expect(undoSculptHistory(history, positions)).toBe(first);
    expectBitIdentical(positions, stage0);
    expect(undoSculptHistory(history, positions)).toBeNull();

    expect(redoSculptHistory(history, positions)).toBe(first);
    expectBitIdentical(positions, stage1);
    expect(redoSculptHistory(history, positions)).toBe(second);
    expectBitIdentical(positions, stage2);
    expect(redoSculptHistory(history, positions)).toBeNull();
  });

  it("새 델타를 밀면 redo 스택이 비워진다", () => {
    const positions = makePositions(30);
    const history = createSculptHistory();
    pushSculptDelta(history, editVertices(positions, [1], 1));
    undoSculptHistory(history, positions);
    expect(canRedoSculptHistory(history)).toBe(true);
    pushSculptDelta(history, editVertices(positions, [2], 1));
    expect(canRedoSculptHistory(history)).toBe(false);
  });

  it("maxEntries 를 넘으면 가장 오래된 델타부터 버린다", () => {
    const positions = makePositions(40);
    const history = createSculptHistory({ maxEntries: 3 });
    const deltas: SculptVertexDelta[] = [];
    for (let step = 0; step < 6; step += 1) {
      const delta = editVertices(positions, [step], 1);
      deltas.push(delta);
      pushSculptDelta(history, delta);
    }
    expect(history.past.length).toBe(3);
    expect(history.past).toEqual([deltas[3], deltas[4], deltas[5]]);
    expect(history.retainedBytes).toBe(3 * SCULPT_DELTA_BYTES_PER_VERTEX);
  });

  it("바이트 예산을 넘으면 오래된 것부터 버리되 최소 1건은 남긴다", () => {
    const positions = makePositions(400);
    const history = createSculptHistory({ maxEntries: 100, maxBytes: 2048 });
    expect(history.limits.maxBytes).toBe(2048);
    const big: number[] = [];
    for (let v = 0; v < 300; v += 1) big.push(v);
    pushSculptDelta(history, editVertices(positions, [1], 1));
    pushSculptDelta(history, editVertices(positions, big, 1));
    // 단일 델타(8,400B)가 예산보다 크므로 그것만 남는다 — 최소 1회 undo 는 살려 둔다.
    expect(history.past.length).toBe(1);
    expect(history.retainedBytes).toBe(300 * SCULPT_DELTA_BYTES_PER_VERTEX);
  });

  it("maxBytes 는 1KiB 미만 값을 기본값으로 되돌린다(무의미한 예산 방지)", () => {
    const history = createSculptHistory({ maxBytes: 200 });
    expect(history.limits.maxBytes).toBe(DEFAULT_SCULPT_HISTORY_LIMITS.maxBytes);
  });

  it("빈 델타는 스택에 쌓이지 않는다", () => {
    const history = createSculptHistory();
    pushSculptDelta(history, {
      touched: new Uint32Array(0),
      before: new Float32Array(0),
      after: new Float32Array(0),
    });
    expect(history.past.length).toBe(0);
    clearSculptHistory(history);
    expect(history.retainedBytes).toBe(0);
  });
});
