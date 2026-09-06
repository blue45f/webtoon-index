/**
 * Studio Sculpt — 접촉한 정점만 저장하는 언두 델타 + 예산이 걸린 스택.
 *
 * ## 왜 델타인가
 * 655k 정점 메시의 전체 스냅샷은 positions 만 7.9MB 다. 스트로크마다 그걸 뜨면 언두 몇 번에
 * 수백 MB 가 된다. 실제로 한 스트로크가 건드리는 정점은 보통 메시의 수 % 뿐이므로, **처음
 * 건드리는 순간의 before 값만** 기록한다(방문 비트맵으로 최초 1회 보장).
 *   레코드 크기 = touched 4B + before 12B + after 12B = **28B/정점**.
 *
 * ## 예산 (fail-closed)
 * `studio-pixel-selection-history.ts` 의 규율을 그대로 따른다 — 구조적 바이트 추정(JS 힙 샘플링이
 * 아니라 배열 길이 × 원소 크기)으로 상한을 재고, 넘으면 조용히 잘라내는 대신 **기록을 거부**한다.
 * 거부는 예외가 아니라 `false` 반환이며, 스트로크 세션이 이를 받아 스트로크를 중단하고
 * `status: "budget-exceeded"` 로 보고한다. 메시는 항상 정확히 되돌릴 수 있는 상태로 남는다.
 *   참고 숫자: 655,362 정점을 전부 건드리는 극단 스트로크 = 28B × 655k ≈ 18.3MB → 기본 예산
 *   8MiB 에서 거부된다(의도된 동작). 호출부는 "반경을 줄이거나 스트로크를 끊으세요" 를 안내해야
 *   한다 — 이건 제품 판단이 필요한 지점이라 통합 스펙에 별도 항목으로 올렸다.
 *
 * ## 복원의 비트 동일성
 * `revertSculptDelta` 는 before 를 그대로 되쓰므로 positions 가 비트 동일하게 돌아온다.
 * 법선은 복원되지 않는다 — 호출부가 `sculptDeltaTouchedVertices` 의 1-ring 을 부분 재계산해야
 * 한다(법선을 델타에 담으면 레코드가 40B/정점으로 43% 커지는데, 재계산이 훨씬 싸다).
 *
 * ## 한계
 * - 토폴로지 변경(세분·리메시)은 이 델타로 표현할 수 없다. 정점 인덱스가 바뀌면 기존 스택 전체가
 *   무효다. 그래서 `subdivideSculptMesh` 는 스트로크와 분리된 조작이고, 세분 시 호출부가
 *   `clearSculptHistory` 를 불러야 한다(이 모듈은 그걸 강제할 방법이 없으므로 계약으로 둔다).
 * - 브랜치 히스토리·병합 없음. 선형 undo/redo 뿐이다.
 */

// ---------------------------------------------------------------------------
// 타입 · 예산
// ---------------------------------------------------------------------------

/** touched(u32 4B) + before(3×f32 12B) + after(3×f32 12B). */
export const SCULPT_DELTA_BYTES_PER_VERTEX = 28;

export interface SculptHistoryLimits {
  readonly maxEntries: number;
  readonly maxBytes: number;
  /** 델타 하나가 담을 수 있는 정점 수 상한(단일 스트로크 폭주 방어). */
  readonly maxVerticesPerDelta: number;
}

export const DEFAULT_SCULPT_HISTORY_LIMITS: SculptHistoryLimits = Object.freeze({
  maxEntries: 32,
  maxBytes: 8 * 1024 * 1024,
  maxVerticesPerDelta: 300_000,
});

export function normalizeSculptHistoryLimits(
  input?: Partial<SculptHistoryLimits>,
): SculptHistoryLimits {
  const pick = (value: unknown, fallback: number, min: number): number =>
    typeof value === "number" && Number.isFinite(value) && value >= min
      ? Math.floor(value)
      : fallback;
  return Object.freeze({
    maxEntries: pick(input?.maxEntries, DEFAULT_SCULPT_HISTORY_LIMITS.maxEntries, 1),
    maxBytes: pick(input?.maxBytes, DEFAULT_SCULPT_HISTORY_LIMITS.maxBytes, 1024),
    maxVerticesPerDelta: pick(
      input?.maxVerticesPerDelta,
      DEFAULT_SCULPT_HISTORY_LIMITS.maxVerticesPerDelta,
      1,
    ),
  });
}

/** 불변 레코드. touched 오름차순은 보장하지 않는다(최초 접촉 순서). */
export interface SculptVertexDelta {
  readonly touched: Uint32Array;
  readonly before: Float32Array;
  readonly after: Float32Array;
}

export function sculptDeltaBytes(delta: SculptVertexDelta): number {
  return delta.touched.length * SCULPT_DELTA_BYTES_PER_VERTEX;
}

export function sculptDeltaTouchedVertices(delta: SculptVertexDelta): Uint32Array {
  return delta.touched;
}

// ---------------------------------------------------------------------------
// 레코더
// ---------------------------------------------------------------------------

export interface SculptDeltaRecorder {
  readonly vertexCount: number;
  readonly limits: SculptHistoryLimits;
  /** 정점이 이미 기록됐는지(최초 1회 before 기록 보장). */
  visited: Uint8Array;
  touched: Uint32Array;
  before: Float32Array;
  count: number;
  /** 예산 초과로 거부된 적이 있는가. 한 번 true 가 되면 회복하지 않는다(fail-closed). */
  exceeded: boolean;
}

export function createSculptDeltaRecorder(
  vertexCount: number,
  limits: SculptHistoryLimits = DEFAULT_SCULPT_HISTORY_LIMITS,
  initialCapacity = 1024,
): SculptDeltaRecorder {
  const capacity = Math.max(16, Math.min(vertexCount || 16, Math.floor(initialCapacity)));
  return {
    vertexCount,
    limits,
    visited: new Uint8Array(vertexCount),
    touched: new Uint32Array(capacity),
    before: new Float32Array(capacity * 3),
    count: 0,
    exceeded: false,
  };
}

function growRecorder(recorder: SculptDeltaRecorder): void {
  const nextCapacity = Math.min(recorder.vertexCount, recorder.touched.length * 2);
  const touched = new Uint32Array(nextCapacity);
  touched.set(recorder.touched.subarray(0, recorder.count));
  const before = new Float32Array(nextCapacity * 3);
  before.set(recorder.before.subarray(0, recorder.count * 3));
  recorder.touched = touched;
  recorder.before = before;
}

/**
 * 정점을 건드리기 **직전**에 부른다. 이미 기록된 정점이면 아무 것도 하지 않고 true.
 * 예산을 넘기면 false 를 돌려주고 recorder.exceeded 를 세운다(호출부는 즉시 중단해야 한다).
 */
export function recordSculptVertexBefore(
  recorder: SculptDeltaRecorder,
  vertex: number,
  positions: Float32Array,
): boolean {
  if (recorder.exceeded) return false;
  if (vertex >= recorder.vertexCount) return false;
  if (recorder.visited[vertex] === 1) return true;
  const limits = recorder.limits;
  const nextCount = recorder.count + 1;
  if (
    nextCount > limits.maxVerticesPerDelta
    || nextCount * SCULPT_DELTA_BYTES_PER_VERTEX > limits.maxBytes
  ) {
    recorder.exceeded = true;
    return false;
  }
  if (recorder.count >= recorder.touched.length) growRecorder(recorder);
  const slot = recorder.count;
  recorder.touched[slot] = vertex;
  const source = vertex * 3;
  recorder.before[slot * 3] = positions[source];
  recorder.before[slot * 3 + 1] = positions[source + 1];
  recorder.before[slot * 3 + 2] = positions[source + 2];
  recorder.visited[vertex] = 1;
  recorder.count = nextCount;
  return true;
}

/** 현재 positions 를 after 로 캡처해 불변 델타를 만든다. 레코더는 그대로 버리면 된다. */
export function finalizeSculptDelta(
  recorder: SculptDeltaRecorder,
  positions: Float32Array,
): SculptVertexDelta {
  const count = recorder.count;
  const touched = recorder.touched.slice(0, count);
  const before = recorder.before.slice(0, count * 3);
  const after = new Float32Array(count * 3);
  for (let k = 0; k < count; k += 1) {
    const source = touched[k] * 3;
    after[k * 3] = positions[source];
    after[k * 3 + 1] = positions[source + 1];
    after[k * 3 + 2] = positions[source + 2];
  }
  return { touched, before, after };
}

// ---------------------------------------------------------------------------
// 적용 / 되돌리기
// ---------------------------------------------------------------------------

export function applySculptDelta(positions: Float32Array, delta: SculptVertexDelta): void {
  for (let k = 0; k < delta.touched.length; k += 1) {
    const target = delta.touched[k] * 3;
    positions[target] = delta.after[k * 3];
    positions[target + 1] = delta.after[k * 3 + 1];
    positions[target + 2] = delta.after[k * 3 + 2];
  }
}

export function revertSculptDelta(positions: Float32Array, delta: SculptVertexDelta): void {
  for (let k = 0; k < delta.touched.length; k += 1) {
    const target = delta.touched[k] * 3;
    positions[target] = delta.before[k * 3];
    positions[target + 1] = delta.before[k * 3 + 1];
    positions[target + 2] = delta.before[k * 3 + 2];
  }
}

// ---------------------------------------------------------------------------
// 예산이 걸린 선형 스택
// ---------------------------------------------------------------------------

export interface SculptHistory {
  readonly limits: SculptHistoryLimits;
  past: SculptVertexDelta[];
  future: SculptVertexDelta[];
  retainedBytes: number;
}

export function createSculptHistory(limits?: Partial<SculptHistoryLimits>): SculptHistory {
  return { limits: normalizeSculptHistoryLimits(limits), past: [], future: [], retainedBytes: 0 };
}

function recomputeRetainedBytes(history: SculptHistory): void {
  let total = 0;
  for (const delta of history.past) total += sculptDeltaBytes(delta);
  for (const delta of history.future) total += sculptDeltaBytes(delta);
  history.retainedBytes = total;
}

/**
 * 새 델타를 밀어 넣는다. redo 스택은 비워지고, 예산 초과 시 **가장 오래된** 항목부터 버린다.
 * 단일 델타 하나가 예산보다 크면 스택을 비우고 그 델타만 유지한다(그래야 최소 1회 undo 가 산다).
 */
export function pushSculptDelta(history: SculptHistory, delta: SculptVertexDelta): void {
  if (delta.touched.length === 0) return;
  history.future = [];
  history.past.push(delta);
  recomputeRetainedBytes(history);
  while (history.past.length > history.limits.maxEntries) {
    history.past.shift();
    recomputeRetainedBytes(history);
  }
  while (history.past.length > 1 && history.retainedBytes > history.limits.maxBytes) {
    history.past.shift();
    recomputeRetainedBytes(history);
  }
}

export function canUndoSculptHistory(history: SculptHistory): boolean {
  return history.past.length > 0;
}

export function canRedoSculptHistory(history: SculptHistory): boolean {
  return history.future.length > 0;
}

/** 되돌린 델타를 반환한다(호출부가 touched 1-ring 법선을 재계산하도록). 없으면 null. */
export function undoSculptHistory(
  history: SculptHistory,
  positions: Float32Array,
): SculptVertexDelta | null {
  const delta = history.past.pop();
  if (!delta) return null;
  revertSculptDelta(positions, delta);
  history.future.push(delta);
  return delta;
}

export function redoSculptHistory(
  history: SculptHistory,
  positions: Float32Array,
): SculptVertexDelta | null {
  const delta = history.future.pop();
  if (!delta) return null;
  applySculptDelta(positions, delta);
  history.past.push(delta);
  return delta;
}

export function clearSculptHistory(history: SculptHistory): void {
  history.past = [];
  history.future = [];
  history.retainedBytes = 0;
}
