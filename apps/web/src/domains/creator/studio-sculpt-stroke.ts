/**
 * Studio Sculpt — 스트로크 누적(dab 간격 리샘플) + 세션 오케스트레이션.
 *
 * ## 이 파일이 조율하는 것
 * 브러시(순수)·스패셜 해시(색인)·대칭(미러 복사)·언두 델타(기록)·dirty range(업로드 서술)는 전부
 * 다른 파일에 있다. 세션은 그것들을 "한 스트로크" 라는 단위로 묶으면서 **상태**를 소유한다:
 *   - dab 리샘플러의 잔여 거리(carry) — 포인터 이벤트가 몇 조각으로 쪼개져 들어와도 dab 위치가
 *     동일하도록.
 *   - 스패셜 해시와 그 빌드 시점 좌표 사본 — 빌드 이후 최대 변위를 **정확히** 추적해 질의
 *     padding 으로 넘기고, 감당 못 할 만큼 커지면 재빌드한다.
 *   - grab 의 고정 집합 — 매 dab 재질의하면 잡은 부분이 질질 끌리며 뭉개진다.
 *   - 언두 델타 레코더 — 정점을 처음 건드리는 순간의 before 만 기록.
 *
 * ## dab 간격 리샘플 (결정성의 핵심)
 * 입력 폴리라인을 균등 간격(= radius × spacingRatio)의 dab 으로 바꾼다. 세그먼트 경계에서 남은
 * 거리를 다음 세그먼트로 **이월**하므로, `appendPoints([p0,p1,p2])` 한 번과
 * `appendPoints([p0]); appendPoints([p1]); appendPoints([p2])` 세 번의 dab 열이 동일하다.
 * 이 규약은 이 레포 2D 브러시(`studio-liquify.ts` 의 resampleLiquifyPath, LIQUIFY_STEP_RATIO)의
 * 관례를 **복제**한 것이다 — 재사용이 아니다. 2D 픽셀 좌표 타입을 3D 가 빌려 쓰면 안 된다는 것이
 * 그 파일들에 명시된 하우스 룰이라, 여기서는 독립 타입(`SculptStrokePoint`)을 정의한다.
 *
 * ## 시드
 * dab 지터는 `sculptDabJitter(seed, dabIndex, salt)` — 정수 비트믹싱 해시다. `Math.random` 도
 * `Date.now` 도 부르지 않으므로 같은 seed + 같은 입력점이면 결과가 **바이트 동일**하다.
 * 이 규약 역시 `studio-brush-stamp-engine.ts:stampJitter` 의 복제다(같은 이유로 import 하지 않는다).
 *
 * ## 대칭 적용 규칙
 * 변위는 권위(authority) 쪽 정점에서만 계산하고, 짝 정점에는 축 성분을 부호 반전한 값을
 * **더한다**. 즉 대칭은 "메시" 가 아니라 "이번 편집" 에 적용된다 — 이미 비대칭인 메시를 대칭으로
 * 강제하지 않는다. 평면 위 정점은 축 성분을 명시적으로 0 으로 만들어 한 번만 적용한다.
 *
 * ## 법선 갱신
 * dab 마다 움직인 정점의 **1-ring**(정점→삼각형 CSR 로 확장)만 부분 재계산한다. 전역 재계산과
 * 비트 동일하도록 누산 순서를 맞춰 뒀다(studio-sculpt-mesh.ts 참고). draw 브러시가 법선을 읽으므로
 * 이 갱신 시점 자체가 결과의 일부이며, 그래서 "dab 마다" 로 못 박았다.
 *
 * ## 한계
 * - 스트로크 도중 토폴로지가 바뀌지 않는다(dyntopo 없음). 정점 인덱스는 스트로크 내내 고정이다.
 * - 압력은 반경/강도 스케일에만 쓰인다. 기울기(tilt)·회전(twist)·속도 기반 동역학은 없다.
 * - 브러시 중심은 이미 3D 로 정해져서 들어온다. 화면 좌표 → 표면 레이캐스트는 이 코어 밖이다.
 * - 언두 예산을 넘기면 스트로크가 **중단**된다(부분 적용 상태 그대로, 되돌리기는 정확히 가능).
 */

import {
  applySculptBrushDisplacement,
  normalizeSculptBrushKind,
  sculptBrushNeedsAdjacency,
  sculptBrushPinsAffectedSet,
  type SculptBrushContext,
  type SculptBrushKind,
  type SculptBrushParams,
} from "./studio-sculpt-brush";
import {
  normalizeSculptFalloffKernel,
  sculptFalloff,
  type SculptFalloffKernel,
} from "./studio-sculpt-falloff";
import {
  createSculptDeltaRecorder,
  finalizeSculptDelta,
  normalizeSculptHistoryLimits,
  recordSculptVertexBefore,
  type SculptDeltaRecorder,
  type SculptHistoryLimits,
  type SculptVertexDelta,
} from "./studio-sculpt-history";
import {
  buildSculptVertexAdjacency,
  buildSculptVertexTriangleCsr,
  recomputeSculptNormalsForVertices,
  type SculptMesh,
  type SculptVertexAdjacency,
  type SculptVertexTriangleCsr,
} from "./studio-sculpt-mesh";
import {
  createSculptDirtyRangeTracker,
  markSculptDirtyVertex,
  takeSculptDirtyRanges,
  type SculptDirtyRange,
  type SculptDirtyRangeTracker,
} from "./studio-sculpt-render-bridge";
import {
  SCULPT_QUERY_OVERFLOW,
  SCULPT_QUERY_STALE,
  buildSculptSpatialHash,
  querySculptSphere,
  sculptSpatialHashShouldRebuild,
  type SculptSpatialHash,
} from "./studio-sculpt-spatial-hash";
import {
  buildSculptSymmetryMap,
  sculptSymmetryAuthoritySign,
  sculptSymmetryIsAuthorityVertex,
  type SculptSymmetryAxis,
  type SculptSymmetryMap,
} from "./studio-sculpt-symmetry";

// ---------------------------------------------------------------------------
// 상수 · 타입
// ---------------------------------------------------------------------------

export const SCULPT_MAX_INPUT_POINTS = 20_000;
export const SCULPT_MAX_DABS = 8_192;
export const SCULPT_DEFAULT_SPACING_RATIO = 0.35;

/** 3D 스트로크 점. 2D 브러시 좌표 타입과 절대 공유하지 않는다(하우스 룰). */
export interface SculptStrokePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 0..1. 생략하면 1(최대 압력)로 본다. */
  readonly pressure?: number;
}

export interface SculptStrokeSymmetryOptions {
  readonly axis?: SculptSymmetryAxis;
  readonly epsilon?: number;
}

export interface SculptStrokeOptions {
  /** 필수. 결정성 계약의 뿌리다. */
  readonly seed: number;
  readonly brush?: SculptBrushKind;
  /** 월드 단위 브러시 반경. */
  readonly radius: number;
  readonly strength?: number;
  readonly direction?: 1 | -1;
  readonly falloff?: SculptFalloffKernel;
  /** dab 간격 = radius × 이 비율. */
  readonly spacingRatio?: number;
  readonly smoothLambda?: number;
  readonly clayPlaneOffset?: number;
  /** 0..1. dab 반경을 ±이 비율만큼 결정적으로 흔든다. */
  readonly radiusJitter?: number;
  readonly strengthJitter?: number;
  /** 압력 0 일 때의 반경 비율(0..1). */
  readonly pressureMinRadiusRatio?: number;
  readonly symmetry?: SculptStrokeSymmetryOptions | null;
  readonly historyLimits?: Partial<SculptHistoryLimits>;
  readonly maxDabs?: number;
  readonly maxInputPoints?: number;
}

export type SculptStrokeStatus = "ok" | "empty" | "budget-exceeded";

export interface SculptStrokeResult {
  readonly status: SculptStrokeStatus;
  readonly dabCount: number;
  readonly touchedCount: number;
  readonly rebuildCount: number;
  readonly delta: SculptVertexDelta;
  readonly dirtyRanges: readonly SculptDirtyRange[];
  /** 대칭을 켰을 때, 짝을 못 찾아 대칭 처리에서 제외된 정점 수. 0 이면 완전 대칭. */
  readonly unpairedCount: number;
  readonly symmetryEnabled: boolean;
}

export interface SculptDab {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly pressure: number;
}

// ---------------------------------------------------------------------------
// 결정적 지터
// ---------------------------------------------------------------------------

/**
 * dab 인덱스 → [0,1) 결정적 지터. `studio-brush-stamp-engine.ts:stampJitter` 와 동일한
 * 비트믹싱 규약을 복제한 것이다(2D 브러시 모듈을 3D 코어가 import 하지 않기 위해).
 */
export function sculptDabJitter(seed: number, dabIndex: number, salt: number): number {
  let h = (Math.imul((seed | 0) + 1, 374761393) + Math.imul((dabIndex | 0) + 1, 668265263)) | 0;
  h = (h + Math.imul((salt | 0) + 1, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// 리샘플 (일회성 순수 버전)
// ---------------------------------------------------------------------------

/**
 * 폴리라인을 균등 간격 dab 으로. 세션의 증분 리샘플러와 **같은 규칙**이라, 한 번에 넣은 결과와
 * 나눠 넣은 결과가 같다(테스트로 잠갔다).
 */
export function resampleSculptStroke(
  points: readonly SculptStrokePoint[],
  spacing: number,
  maxDabs = SCULPT_MAX_DABS,
): SculptDab[] {
  const resampler = createSculptStrokeResampler(spacing, maxDabs);
  const out: SculptDab[] = [];
  appendSculptStrokeResampler(resampler, points, out);
  return out;
}

interface SculptStrokeResampler {
  readonly spacing: number;
  readonly maxDabs: number;
  hasLast: boolean;
  lastX: number;
  lastY: number;
  lastZ: number;
  lastPressure: number;
  carry: number;
  emitted: number;
}

function createSculptStrokeResampler(spacing: number, maxDabs: number): SculptStrokeResampler {
  const safeSpacing = Number.isFinite(spacing) && spacing > 0 ? spacing : 1;
  return {
    spacing: safeSpacing,
    maxDabs: Math.max(1, Math.floor(maxDabs)),
    hasLast: false,
    lastX: 0,
    lastY: 0,
    lastZ: 0,
    lastPressure: 1,
    carry: 0,
    emitted: 0,
  };
}

function normalizedPressure(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function appendSculptStrokeResampler(
  resampler: SculptStrokeResampler,
  points: readonly SculptStrokePoint[],
  out: SculptDab[],
): void {
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
      continue;
    }
    const pressure = normalizedPressure(point.pressure);
    if (!resampler.hasLast) {
      resampler.hasLast = true;
      resampler.lastX = point.x;
      resampler.lastY = point.y;
      resampler.lastZ = point.z;
      resampler.lastPressure = pressure;
      resampler.carry = 0;
      if (resampler.emitted < resampler.maxDabs) {
        out.push({ x: point.x, y: point.y, z: point.z, pressure });
        resampler.emitted += 1;
      }
      continue;
    }
    const dx = point.x - resampler.lastX;
    const dy = point.y - resampler.lastY;
    const dz = point.z - resampler.lastZ;
    const segment = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(segment > 0)) continue;
    const inverse = 1 / segment;
    let travelled = resampler.spacing - resampler.carry;
    while (travelled <= segment) {
      if (resampler.emitted >= resampler.maxDabs) break;
      const t = travelled * inverse;
      out.push({
        x: resampler.lastX + dx * t,
        y: resampler.lastY + dy * t,
        z: resampler.lastZ + dz * t,
        pressure: resampler.lastPressure + (pressure - resampler.lastPressure) * t,
      });
      resampler.emitted += 1;
      travelled += resampler.spacing;
    }
    resampler.carry = segment - (travelled - resampler.spacing);
    resampler.lastX = point.x;
    resampler.lastY = point.y;
    resampler.lastZ = point.z;
    resampler.lastPressure = pressure;
  }
}

// ---------------------------------------------------------------------------
// 세션
// ---------------------------------------------------------------------------

interface ResolvedStrokeOptions {
  seed: number;
  brush: SculptBrushKind;
  radius: number;
  strength: number;
  direction: 1 | -1;
  falloff: SculptFalloffKernel;
  spacing: number;
  smoothLambda: number;
  clayPlaneOffset: number;
  radiusJitter: number;
  strengthJitter: number;
  pressureMinRadiusRatio: number;
  maxDabs: number;
  maxInputPoints: number;
}

function clamp01(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function resolveStrokeOptions(options: SculptStrokeOptions): ResolvedStrokeOptions {
  const radius = Number.isFinite(options.radius) && options.radius > 0 ? options.radius : 1;
  const spacingRatio = clamp01(options.spacingRatio, SCULPT_DEFAULT_SPACING_RATIO);
  return {
    seed: Number.isFinite(options.seed) ? Math.floor(options.seed) : 0,
    brush: normalizeSculptBrushKind(options.brush),
    radius,
    strength: clamp01(options.strength, 0.5),
    direction: options.direction === -1 ? -1 : 1,
    falloff: normalizeSculptFalloffKernel(options.falloff),
    spacing: radius * Math.max(0.02, spacingRatio),
    smoothLambda: clamp01(options.smoothLambda, 0.5),
    clayPlaneOffset: clamp01(options.clayPlaneOffset, 0.25),
    radiusJitter: clamp01(options.radiusJitter, 0),
    strengthJitter: clamp01(options.strengthJitter, 0),
    pressureMinRadiusRatio: clamp01(options.pressureMinRadiusRatio, 1),
    maxDabs: Math.max(
      1,
      Math.min(SCULPT_MAX_DABS, Math.floor(options.maxDabs ?? SCULPT_MAX_DABS)),
    ),
    maxInputPoints: Math.max(
      1,
      Math.min(SCULPT_MAX_INPUT_POINTS, Math.floor(options.maxInputPoints ?? SCULPT_MAX_INPUT_POINTS)),
    ),
  };
}

export interface SculptStrokeSession {
  appendPoints(points: readonly SculptStrokePoint[]): void;
  end(): SculptStrokeResult;
  readonly mesh: SculptMesh;
}

interface SessionState {
  mesh: SculptMesh;
  resolved: ResolvedStrokeOptions;
  csr: SculptVertexTriangleCsr;
  adjacency: SculptVertexAdjacency | null;
  hash: SculptSpatialHash;
  hashBase: Float32Array;
  maxDisplacement: number;
  rebuildCount: number;
  recorder: SculptDeltaRecorder;
  tracker: SculptDirtyRangeTracker;
  symmetry: SculptSymmetryMap | null;
  authoritySign: 1 | -1;
  authorityResolved: boolean;
  resampler: SculptStrokeResampler;
  dabIndex: number;
  previousDab: SculptDab | null;
  pinnedAffected: Uint32Array | null;
  pinnedWeights: Float32Array | null;
  pinnedCount: number;
  affected: Uint32Array;
  weights: Float32Array;
  displacement: Float32Array;
  normalScratch: Uint32Array;
  normalScratchCount: number;
  visitScratch: Uint8Array;
  ended: boolean;
  aborted: boolean;
}

function ensureCapacity(state: SessionState, needed: number): void {
  if (state.affected.length >= needed) return;
  let capacity = Math.max(64, state.affected.length);
  while (capacity < needed) capacity *= 2;
  capacity = Math.min(capacity, Math.max(needed, state.mesh.vertexCount));
  state.affected = new Uint32Array(capacity);
  state.weights = new Float32Array(capacity);
  state.displacement = new Float32Array(capacity * 3);
}

function rebuildHash(state: SessionState): void {
  state.hash = buildSculptSpatialHash(state.mesh.positions, state.mesh.vertexCount);
  state.hashBase.set(state.mesh.positions);
  state.maxDisplacement = 0;
  state.rebuildCount += 1;
}

/** 해시 질의 → affected 채우기. 실패(stale/overflow)는 여기서 회복한다. */
function queryAffected(state: SessionState, dab: SculptDab, radius: number): number {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const count = querySculptSphere(
      state.hash,
      state.mesh.positions,
      dab.x,
      dab.y,
      dab.z,
      radius,
      state.maxDisplacement,
      state.affected,
    );
    if (count >= 0) return count;
    if (count === SCULPT_QUERY_STALE) {
      rebuildHash(state);
      continue;
    }
    if (count !== SCULPT_QUERY_OVERFLOW) return 0;
    ensureCapacity(state, Math.min(state.mesh.vertexCount, state.affected.length * 2 + 64));
    if (state.affected.length >= state.mesh.vertexCount) {
      // 버퍼가 이미 전체 정점만큼 크다 — 더 키울 곳이 없으므로 여기서 멈춘다.
      const final = querySculptSphere(
        state.hash,
        state.mesh.positions,
        dab.x,
        dab.y,
        dab.z,
        radius,
        state.maxDisplacement,
        state.affected,
      );
      return final < 0 ? 0 : final;
    }
  }
  return 0;
}

function markNormalTarget(state: SessionState, vertex: number): void {
  if (state.normalScratchCount >= state.normalScratch.length) {
    const grown = new Uint32Array(state.normalScratch.length * 2 + 64);
    grown.set(state.normalScratch.subarray(0, state.normalScratchCount));
    state.normalScratch = grown;
  }
  state.normalScratch[state.normalScratchCount] = vertex;
  state.normalScratchCount += 1;
}

/** 움직인 정점의 1-ring(정점→삼각형 CSR 의 코너 전부)을 법선 재계산 대상으로 넣는다. */
function expandNormalTargets(state: SessionState, movedVertices: readonly number[]): void {
  state.normalScratchCount = 0;
  const { csr, mesh } = state;
  for (const v of movedVertices) {
    const start = csr.offsets[v];
    const end = csr.offsets[v + 1];
    for (let s = start; s < end; s += 1) {
      const t = csr.triangles[s];
      markNormalTarget(state, mesh.indices[t * 3]);
      markNormalTarget(state, mesh.indices[t * 3 + 1]);
      markNormalTarget(state, mesh.indices[t * 3 + 2]);
    }
  }
}

function trackDisplacement(state: SessionState, vertex: number): void {
  const base = vertex * 3;
  const dx = state.mesh.positions[base] - state.hashBase[base];
  const dy = state.mesh.positions[base + 1] - state.hashBase[base + 1];
  const dz = state.mesh.positions[base + 2] - state.hashBase[base + 2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance > state.maxDisplacement) state.maxDisplacement = distance;
}

function applyDab(state: SessionState, dab: SculptDab): boolean {
  const resolved = state.resolved;
  const index = state.dabIndex;
  const pressureScale =
    resolved.pressureMinRadiusRatio + (1 - resolved.pressureMinRadiusRatio) * dab.pressure;
  const radiusNoise = 1 + (sculptDabJitter(resolved.seed, index, 17) - 0.5) * 2 * resolved.radiusJitter;
  const radius = Math.max(1e-6, resolved.radius * pressureScale * radiusNoise);
  const strengthNoise =
    1 + (sculptDabJitter(resolved.seed, index, 29) - 0.5) * 2 * resolved.strengthJitter;
  const strength = Math.max(0, Math.min(1, resolved.strength * dab.pressure * strengthNoise));

  const pinned = sculptBrushPinsAffectedSet(resolved.brush);
  let count: number;
  if (pinned && state.pinnedAffected && state.pinnedWeights) {
    count = state.pinnedCount;
    state.affected = state.pinnedAffected;
    state.weights = state.pinnedWeights;
    if (state.displacement.length < count * 3) state.displacement = new Float32Array(count * 3);
  } else {
    count = queryAffected(state, dab, radius);
    if (count === 0) return true;
    // 팔로프 가중치.
    for (let k = 0; k < count; k += 1) {
      const base = state.affected[k] * 3;
      const dx = state.mesh.positions[base] - dab.x;
      const dy = state.mesh.positions[base + 1] - dab.y;
      const dz = state.mesh.positions[base + 2] - dab.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      state.weights[k] = sculptFalloff(resolved.falloff, distance / radius);
    }
    // 대칭이 켜져 있으면 권위 쪽만 남긴다(비권위 쪽은 반사로 채워진다).
    const symmetry = state.symmetry;
    if (symmetry) {
      if (!state.authorityResolved) {
        const axisValue =
          symmetry.component === 0 ? dab.x : symmetry.component === 1 ? dab.y : dab.z;
        state.authoritySign = sculptSymmetryAuthoritySign(axisValue);
        state.authorityResolved = true;
      }
      let write = 0;
      for (let k = 0; k < count; k += 1) {
        const v = state.affected[k];
        if (
          !sculptSymmetryIsAuthorityVertex(state.mesh.positions, symmetry, v, state.authoritySign)
        ) {
          continue;
        }
        state.affected[write] = v;
        state.weights[write] = state.weights[k];
        write += 1;
      }
      count = write;
    }
    if (pinned) {
      state.pinnedAffected = state.affected.slice(0, count);
      state.pinnedWeights = state.weights.slice(0, count);
      state.pinnedCount = count;
      state.affected = state.pinnedAffected;
      state.weights = state.pinnedWeights;
      if (state.displacement.length < count * 3) state.displacement = new Float32Array(count * 3);
    }
  }
  if (count === 0) return true;

  const previous = state.previousDab;
  const fallbackBase = state.affected[0] * 3;
  const params: SculptBrushParams = {
    centerX: dab.x,
    centerY: dab.y,
    centerZ: dab.z,
    radius,
    strength,
    direction: resolved.direction,
    moveX: previous ? dab.x - previous.x : 0,
    moveY: previous ? dab.y - previous.y : 0,
    moveZ: previous ? dab.z - previous.z : 0,
    smoothLambda: resolved.smoothLambda,
    clayPlaneOffset: resolved.clayPlaneOffset,
    fallbackNormalX: state.mesh.normals[fallbackBase],
    fallbackNormalY: state.mesh.normals[fallbackBase + 1],
    fallbackNormalZ: state.mesh.normals[fallbackBase + 2],
  };
  const ctx: SculptBrushContext = {
    positions: state.mesh.positions,
    normals: state.mesh.normals,
    affected: state.affected,
    affectedCount: count,
    weights: state.weights,
    adjacency: state.adjacency,
  };
  applySculptBrushDisplacement(resolved.brush, ctx, params, state.displacement);

  const symmetry = state.symmetry;
  const component = symmetry ? symmetry.component : -1;
  const moved: number[] = [];
  for (let k = 0; k < count; k += 1) {
    const v = state.affected[k];
    let dx = state.displacement[k * 3];
    let dy = state.displacement[k * 3 + 1];
    let dz = state.displacement[k * 3 + 2];
    if (dx === 0 && dy === 0 && dz === 0) continue;
    const partner = symmetry ? symmetry.partner[v] : -1;
    if (symmetry && partner === v) {
      // 평면 위 정점 — 축 성분을 명시적으로 0 으로 만들어 평면을 벗어나지 않게 한다.
      if (component === 0) dx = 0;
      else if (component === 1) dy = 0;
      else dz = 0;
      if (dx === 0 && dy === 0 && dz === 0) continue;
    }
    if (!recordSculptVertexBefore(state.recorder, v, state.mesh.positions)) return false;
    const base = v * 3;
    state.mesh.positions[base] += dx;
    state.mesh.positions[base + 1] += dy;
    state.mesh.positions[base + 2] += dz;
    markSculptDirtyVertex(state.tracker, v);
    trackDisplacement(state, v);
    moved.push(v);
    if (symmetry && partner >= 0 && partner !== v) {
      if (!recordSculptVertexBefore(state.recorder, partner, state.mesh.positions)) return false;
      const mirrorBase = partner * 3;
      state.mesh.positions[mirrorBase] += component === 0 ? -dx : dx;
      state.mesh.positions[mirrorBase + 1] += component === 1 ? -dy : dy;
      state.mesh.positions[mirrorBase + 2] += component === 2 ? -dz : dz;
      markSculptDirtyVertex(state.tracker, partner);
      trackDisplacement(state, partner);
      moved.push(partner);
    }
  }
  if (moved.length === 0) return true;

  expandNormalTargets(state, moved);
  recomputeSculptNormalsForVertices(
    state.mesh,
    state.csr,
    state.normalScratch,
    state.normalScratchCount,
    state.visitScratch,
  );
  if (sculptSpatialHashShouldRebuild(state.hash, state.maxDisplacement)) rebuildHash(state);
  return true;
}

/**
 * 스트로크 세션 생성. 메시는 **제자리에서** 수정된다(호출부가 사본을 원하면 cloneSculptMesh).
 * 대칭 페어맵과 해시는 여기서 한 번 만들고, 이후 필요할 때만 해시를 다시 만든다.
 */
export function createSculptStrokeSession(
  mesh: SculptMesh,
  options: SculptStrokeOptions,
): SculptStrokeSession {
  const resolved = resolveStrokeOptions(options);
  const hash = buildSculptSpatialHash(mesh.positions, mesh.vertexCount);
  const symmetry = options.symmetry
    ? buildSculptSymmetryMap(mesh.positions, mesh.vertexCount, {
        axis: options.symmetry.axis,
        epsilon: options.symmetry.epsilon,
        hash,
      })
    : null;
  const initialCapacity = Math.max(64, Math.min(mesh.vertexCount || 64, 4096));
  const state: SessionState = {
    mesh,
    resolved,
    csr: buildSculptVertexTriangleCsr(mesh),
    adjacency: sculptBrushNeedsAdjacency(resolved.brush) ? buildSculptVertexAdjacency(mesh) : null,
    hash,
    hashBase: Float32Array.from(mesh.positions),
    maxDisplacement: 0,
    rebuildCount: 0,
    recorder: createSculptDeltaRecorder(
      mesh.vertexCount,
      normalizeSculptHistoryLimits(options.historyLimits),
    ),
    tracker: createSculptDirtyRangeTracker(),
    symmetry,
    authoritySign: 1,
    authorityResolved: false,
    resampler: createSculptStrokeResampler(resolved.spacing, resolved.maxDabs),
    dabIndex: 0,
    previousDab: null,
    pinnedAffected: null,
    pinnedWeights: null,
    pinnedCount: 0,
    affected: new Uint32Array(initialCapacity),
    weights: new Float32Array(initialCapacity),
    displacement: new Float32Array(initialCapacity * 3),
    normalScratch: new Uint32Array(initialCapacity * 3),
    normalScratchCount: 0,
    visitScratch: new Uint8Array(mesh.vertexCount),
    ended: false,
    aborted: false,
  };

  return {
    mesh,
    appendPoints(points: readonly SculptStrokePoint[]): void {
      if (state.ended || state.aborted) return;
      const limited = points.length > resolved.maxInputPoints
        ? points.slice(0, resolved.maxInputPoints)
        : points;
      const dabs: SculptDab[] = [];
      appendSculptStrokeResampler(state.resampler, limited, dabs);
      for (const dab of dabs) {
        if (!applyDab(state, dab)) {
          state.aborted = true;
          return;
        }
        state.previousDab = dab;
        state.dabIndex += 1;
      }
    },
    end(): SculptStrokeResult {
      state.ended = true;
      const delta = finalizeSculptDelta(state.recorder, state.mesh.positions);
      const status: SculptStrokeStatus = state.aborted
        ? "budget-exceeded"
        : state.dabIndex === 0
          ? "empty"
          : "ok";
      return {
        status,
        dabCount: state.dabIndex,
        touchedCount: delta.touched.length,
        rebuildCount: state.rebuildCount,
        delta,
        dirtyRanges: takeSculptDirtyRanges(state.tracker),
        unpairedCount: state.symmetry ? state.symmetry.unpairedCount : 0,
        symmetryEnabled: state.symmetry !== null,
      };
    },
  };
}

/** 일회성 편의 래퍼 — 전체 점열을 한 번에 흘려 넣는다. */
export function runSculptStroke(
  mesh: SculptMesh,
  points: readonly SculptStrokePoint[],
  options: SculptStrokeOptions,
): SculptStrokeResult {
  const session = createSculptStrokeSession(mesh, options);
  session.appendPoints(points);
  return session.end();
}
