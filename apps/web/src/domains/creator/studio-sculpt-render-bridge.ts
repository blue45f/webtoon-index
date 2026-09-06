/**
 * Studio Sculpt — 렌더러/GPU 주입 시임(three-free, 디바이스 호출 0).
 *
 * ## 왜 이 파일이 있는가
 * 스컬프트 코어는 GPU 디바이스를 **한 줄도** 호출하지 않는다. node 테스트 환경에 WebGPU 도 DOM
 * canvas 도 없기 때문에(vitest environment "node"), 디바이스 호출이 코어에 섞이면 팔로프·대칭·
 * 언두를 헤드리스로 전수 검증할 수 없다. 그래서 코어는 "어떤 정점 범위가 더러워졌는가" 만
 * 계산해서 `SculptMeshSink` 로 넘기고, 실제 업로드는 호출부가 한다:
 *   three(0.184) 경로 → `BufferAttribute.addUpdateRange(offset, count)` + `needsUpdate = true`
 *   WebGPU 경로     → `queue.writeBuffer(buffer, byteOffset, data, dataOffset, size)`
 * 둘 다 "정점 범위" 라는 같은 서술만 있으면 되므로, 이 인터페이스가 두 백엔드의 공통 분모다.
 *
 * ## 범위 병합 정책
 * dab 하나가 건드리는 정점은 인덱스 공간에서 흩어져 있다(공간적으로는 뭉쳐 있어도). 범위를 하나씩
 * 올리면 드로우콜당 수천 번의 부분 업로드가 되고, 반대로 항상 전체를 올리면 655k×24B 를 매 dab
 * 마다 밀게 된다. 그래서:
 *   - 정점을 마킹하며 정렬된 범위 목록을 유지하고, 간격이 `mergeGap` 이하면 인접 범위를 합친다.
 *   - 범위 수가 `maxRanges` 를 넘으면 전체를 덮는 **단일 범위**로 붕괴시킨다(상한 보장).
 * 병합은 순수 정수 연산이라 결정적이다.
 *
 * ## 한계
 * - 인덱스 버퍼(토폴로지) 업데이트를 서술하지 않는다. 스컬프트가 토폴로지를 바꾸지 않기 때문이다
 *   (세분은 별도 조작이고, 그때는 지오메트리를 통째로 다시 만든다).
 * - 더블 버퍼링·펜스·비동기 매핑을 다루지 않는다. 그건 호출부(렌더 루프)의 책임이다.
 */

export interface SculptDirtyRange {
  readonly firstVertex: number;
  readonly vertexCount: number;
}

export interface SculptDirtyRangeTrackerOptions {
  /** 이 간격 이하로 떨어진 두 범위는 합친다(정점 단위). */
  readonly mergeGap?: number;
  /** 범위 수 상한. 넘으면 전체를 덮는 단일 범위로 붕괴한다. */
  readonly maxRanges?: number;
}

export const DEFAULT_SCULPT_DIRTY_MERGE_GAP = 64;
export const DEFAULT_SCULPT_DIRTY_MAX_RANGES = 32;

interface MutableRange {
  first: number;
  last: number;
}

export interface SculptDirtyRangeTracker {
  readonly mergeGap: number;
  readonly maxRanges: number;
  ranges: MutableRange[];
  collapsed: boolean;
}

export function createSculptDirtyRangeTracker(
  options: SculptDirtyRangeTrackerOptions = {},
): SculptDirtyRangeTracker {
  const mergeGap = Math.max(
    0,
    Math.floor(options.mergeGap ?? DEFAULT_SCULPT_DIRTY_MERGE_GAP),
  );
  const maxRanges = Math.max(1, Math.floor(options.maxRanges ?? DEFAULT_SCULPT_DIRTY_MAX_RANGES));
  return { mergeGap, maxRanges, ranges: [], collapsed: false };
}

/** 반열린 구간이 아니라 [first, last] 포함 구간으로 마킹한다. */
export function markSculptDirtyRange(
  tracker: SculptDirtyRangeTracker,
  firstVertex: number,
  vertexCount: number,
): void {
  if (vertexCount <= 0) return;
  const first = Math.max(0, Math.floor(firstVertex));
  const last = first + Math.floor(vertexCount) - 1;
  const ranges = tracker.ranges;
  // 삽입 위치를 선형 탐색한다 — maxRanges 가 작은 상수(기본 32)라 이분탐색이 이득이 아니다.
  let index = 0;
  while (index < ranges.length && ranges[index].first <= first) index += 1;
  ranges.splice(index, 0, { first, last });
  // 앞뒤로 병합.
  let write = 0;
  for (let read = 0; read < ranges.length; read += 1) {
    if (write > 0 && ranges[read].first <= ranges[write - 1].last + tracker.mergeGap + 1) {
      if (ranges[read].last > ranges[write - 1].last) ranges[write - 1].last = ranges[read].last;
      continue;
    }
    ranges[write] = ranges[read];
    write += 1;
  }
  ranges.length = write;
  if (ranges.length > tracker.maxRanges) {
    const covering = { first: ranges[0].first, last: ranges[ranges.length - 1].last };
    tracker.ranges = [covering];
    tracker.collapsed = true;
  }
}

export function markSculptDirtyVertex(tracker: SculptDirtyRangeTracker, vertex: number): void {
  markSculptDirtyRange(tracker, vertex, 1);
}

export function markSculptDirtyVertices(
  tracker: SculptDirtyRangeTracker,
  vertices: Uint32Array | readonly number[],
  count: number,
): void {
  const limit = Math.min(count, vertices.length);
  for (let k = 0; k < limit; k += 1) markSculptDirtyVertex(tracker, vertices[k]);
}

/** 현재 범위를 불변 스냅샷으로 뽑고 트래커를 비운다. */
export function takeSculptDirtyRanges(tracker: SculptDirtyRangeTracker): SculptDirtyRange[] {
  const out = tracker.ranges.map((range) => ({
    firstVertex: range.first,
    vertexCount: range.last - range.first + 1,
  }));
  tracker.ranges = [];
  tracker.collapsed = false;
  return out;
}

export function peekSculptDirtyRanges(tracker: SculptDirtyRangeTracker): SculptDirtyRange[] {
  return tracker.ranges.map((range) => ({
    firstVertex: range.first,
    vertexCount: range.last - range.first + 1,
  }));
}

// ---------------------------------------------------------------------------
// Sink (주입 시임)
// ---------------------------------------------------------------------------

/**
 * 렌더러 중립 업로드 sink. 구현체는 호출부(three 컴포넌트 / WebGPU 런타임)에 있고, 코어는
 * 이 인터페이스만 안다.
 */
export interface SculptMeshSink {
  uploadPositions(positions: Float32Array, range: SculptDirtyRange): void;
  uploadNormals(normals: Float32Array, range: SculptDirtyRange): void;
}

export interface NullSculptMeshSink extends SculptMeshSink {
  readonly positionRanges: SculptDirtyRange[];
  readonly normalRanges: SculptDirtyRange[];
  readonly uploadedVertexCount: number;
}

/**
 * 헤드리스/테스트용 sink. 아무 것도 업로드하지 않고 호출 기록만 남긴다 — "GPU 없이도 코어를
 * 끝까지 돌릴 수 있다" 는 계약이 실제로 지켜지는지 확인하는 수단이다.
 */
export function createNullSculptMeshSink(): NullSculptMeshSink {
  const positionRanges: SculptDirtyRange[] = [];
  const normalRanges: SculptDirtyRange[] = [];
  return {
    positionRanges,
    normalRanges,
    get uploadedVertexCount(): number {
      let total = 0;
      for (const range of positionRanges) total += range.vertexCount;
      return total;
    },
    uploadPositions(_positions: Float32Array, range: SculptDirtyRange): void {
      positionRanges.push(range);
    },
    uploadNormals(_normals: Float32Array, range: SculptDirtyRange): void {
      normalRanges.push(range);
    },
  };
}

/** 트래커를 비우면서 sink 로 흘려보낸다. 반환값은 업로드한 범위 수. */
export function flushSculptDirtyRanges(
  tracker: SculptDirtyRangeTracker,
  sink: SculptMeshSink,
  positions: Float32Array,
  normals: Float32Array,
): number {
  const ranges = takeSculptDirtyRanges(tracker);
  for (const range of ranges) {
    sink.uploadPositions(positions, range);
    sink.uploadNormals(normals, range);
  }
  return ranges.length;
}
