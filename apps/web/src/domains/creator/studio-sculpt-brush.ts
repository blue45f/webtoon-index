/**
 * Studio Sculpt — 브러시 10종(draw / clay / smooth / grab / pinch / inflate / crease /
 * flatten / scrape / snakeHook). 전부 순수 함수다.
 *
 * ## 시그니처 규약
 * 브러시는 메시를 **직접 고치지 않는다**. `(ctx, params, out)` 을 받아 영향받는 정점 k 번째의
 * 변위를 `out[k*3 .. k*3+2]` 에 쓴다. 실제 적용(대칭 미러 복사, 언두 델타 기록, 법선 부분
 * 재계산)은 스트로크 세션이 한다. 이렇게 나눈 이유:
 *   - 대칭과 언두가 브러시 종류를 몰라도 된다(브러시가 늘어도 그쪽은 안 바뀐다).
 *   - grab 이 "스트로크 시작 시 고정된 집합" 을 필요로 하는데, 그 상태를 브러시 안에 숨기면
 *     순수성이 깨진다. 집합은 세션이 소유하고 브러시엔 매번 명시적으로 넘긴다.
 *
 * ## 각 브러시가 실제로 하는 일
 *   draw   정점 법선 방향으로 weight × strength × radius 만큼 민다(direction −1 이면 판다).
 *          "inflate" 와 같은 계열이며, 브러시 평면 방향 push 가 아니라 **정점별 법선** 방향이다.
 *   clay   영향 집합의 가중 무게중심 C 와 가중 평균 법선 N 으로 평면을 잡고, 그 평면을
 *          N 방향으로 radius × strength × direction × planeOffset 만큼 띄운 뒤 모든 정점을
 *          그 평면 쪽으로 weight × strength 만큼 당긴다(flatten-toward-plane + 채우기).
 *          planeOffset 을 0 으로 주면 순수 flatten 이 된다.
 *   smooth CSR 인접(오름차순 정렬·중복 제거)으로 이웃 평균을 구해 weight × lambda 만큼 lerp 한다
 *          (균일 가중 라플라시안. 코탄젠트 가중이 아니다 — 아래 한계 참고).
 *   grab   고정된 집합을 dab 이동 벡터 × weight 로 평행이동한다.
 *   pinch  브러시 중심 축으로 weight × strength × radius 만큼 끌어당긴다(direction −1 = 밀어냄).
 *   inflate 법선 방향 균일 변위. weight(팔로프)를 무시해 영역 전체가 같은 비율로 부풀거나 줄어든다.
 *   crease 중심축 당김(pinch 성분) + 법선 절삭(draw 반대 성분)을 합성한 V자 골/능선.
 *   flatten 가중 무게중심·법선 평면으로의 순수 투영(clay 에서 offset 채우기를 뺀 형태).
 *   scrape flatten 의 한쪽면 버전. 평면 기준 direction 쪽으로 튀어나온 정점만 닦아내린다.
 *   snakeHook grab 과 같은 평행이동 산술이지만 pinning 이 없어 매 dab 영향 집합을 다시 잡는다.
 *
 * ## 결정성
 * 모든 루프가 `k` 오름차순이고, clay 의 누산도 같은 순서다. affected 배열의 순서는 스패셜 해시
 * 질의가 결정적이므로 재현된다. 난수·시각 호출이 없다.
 *
 * ## 한계 (정직하게)
 * - smooth 는 **균일 가중(umbrella) 라플라시안**이다. 코탄젠트 가중이 아니라서 삼각형이 심하게
 *   불균일한 메시에서는 등방적이지 않다. 대신 순서 의존이 없고 싸다.
 * - clay 는 Blender 의 Clay Strips 처럼 사각 브러시 단면이나 스트로크 방향 정렬을 하지 않는다.
 * - 알파/텍스처 브러시, 자동 마스킹(토폴로지·면셋), 브러시별 커브 편집이 없다.
 * - 자기 교차(self-intersection) 방지가 없다. 세게 밀면 메시는 뒤집힌다 — dyntopo 가 없으니
 *   삼각형이 늘어나지도 않는다.
 */

import type { SculptVertexAdjacency } from "./studio-sculpt-mesh";

export const SCULPT_BRUSH_KINDS = [
  "draw",
  "clay",
  "smooth",
  "grab",
  "pinch",
  "inflate",
  "crease",
  "flatten",
  "scrape",
  "snakeHook",
] as const;

export type SculptBrushKind = (typeof SCULPT_BRUSH_KINDS)[number];

export const DEFAULT_SCULPT_BRUSH: SculptBrushKind = "draw";

export function normalizeSculptBrushKind(value: unknown): SculptBrushKind {
  return SCULPT_BRUSH_KINDS.includes(value as SculptBrushKind)
    ? (value as SculptBrushKind)
    : DEFAULT_SCULPT_BRUSH;
}

/** 브러시가 읽는 메시 조각 + 이번 dab 의 영향 집합. 전부 호출부 소유(브러시는 읽기만 한다). */
export interface SculptBrushContext {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** 영향받는 정점 인덱스. 앞 `affectedCount` 개만 유효하다. */
  readonly affected: Uint32Array;
  readonly affectedCount: number;
  /** affected 와 평행한 팔로프 가중치 [0, 1]. */
  readonly weights: Float32Array;
  /** smooth 전용. 다른 브러시에는 null 로 넘겨도 된다. */
  readonly adjacency: SculptVertexAdjacency | null;
}

export interface SculptBrushParams {
  readonly centerX: number;
  readonly centerY: number;
  readonly centerZ: number;
  readonly radius: number;
  /** 0..1. 반경 대비 변위 비율로 쓰인다(단위 없는 값이 되도록). */
  readonly strength: number;
  /** +1 = 부풀리기/쌓기, −1 = 파기/깎기. */
  readonly direction: 1 | -1;
  /** grab 의 이번 dab 이동 벡터. */
  readonly moveX: number;
  readonly moveY: number;
  readonly moveZ: number;
  /** smooth 의 lerp 계수 상한(0..1). */
  readonly smoothLambda: number;
  /** clay 평면을 법선 방향으로 띄우는 비율(반경 대비). 0 이면 순수 flatten. */
  readonly clayPlaneOffset: number;
  /** clay 의 평균 법선이 퇴화했을 때 쓰는 폴백 법선(세션이 히트 정점 법선을 넘긴다). */
  readonly fallbackNormalX: number;
  readonly fallbackNormalY: number;
  readonly fallbackNormalZ: number;
}

export const DEFAULT_SCULPT_BRUSH_PARAMS: SculptBrushParams = Object.freeze({
  centerX: 0,
  centerY: 0,
  centerZ: 0,
  radius: 1,
  strength: 0.5,
  direction: 1,
  moveX: 0,
  moveY: 0,
  moveZ: 0,
  smoothLambda: 0.5,
  clayPlaneOffset: 0.25,
  fallbackNormalX: 0,
  fallbackNormalY: 1,
  fallbackNormalZ: 0,
});

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// ---------------------------------------------------------------------------
// 브러시
// ---------------------------------------------------------------------------

/** draw / inflate — 정점 법선 방향 변위. */
export function sculptDrawDisplacement(
  ctx: SculptBrushContext,
  params: SculptBrushParams,
  out: Float32Array,
): void {
  const amount = params.radius * clamp01(params.strength) * params.direction;
  for (let k = 0; k < ctx.affectedCount; k += 1) {
    const base = ctx.affected[k] * 3;
    const scale = amount * ctx.weights[k];
    out[k * 3] = ctx.normals[base] * scale;
    out[k * 3 + 1] = ctx.normals[base + 1] * scale;
    out[k * 3 + 2] = ctx.normals[base + 2] * scale;
  }
}

/** clay — flatten-toward-plane + 평면 오프셋 채우기. */
export function sculptClayDisplacement(
  ctx: SculptBrushContext,
  params: SculptBrushParams,
  out: Float32Array,
): void {
  let weightSum = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let k = 0; k < ctx.affectedCount; k += 1) {
    const base = ctx.affected[k] * 3;
    const w = ctx.weights[k];
    weightSum += w;
    cx += ctx.positions[base] * w;
    cy += ctx.positions[base + 1] * w;
    cz += ctx.positions[base + 2] * w;
    nx += ctx.normals[base] * w;
    ny += ctx.normals[base + 1] * w;
    nz += ctx.normals[base + 2] * w;
  }
  if (ctx.affectedCount === 0) return;
  if (!(weightSum > 0)) {
    out.fill(0, 0, ctx.affectedCount * 3);
    return;
  }
  const inverse = 1 / weightSum;
  cx *= inverse;
  cy *= inverse;
  cz *= inverse;
  const normalLength = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (normalLength > 0) {
    nx /= normalLength;
    ny /= normalLength;
    nz /= normalLength;
  } else {
    nx = params.fallbackNormalX;
    ny = params.fallbackNormalY;
    nz = params.fallbackNormalZ;
  }
  const strength = clamp01(params.strength);
  const offset = params.radius * params.clayPlaneOffset * strength * params.direction;
  const planeX = cx + nx * offset;
  const planeY = cy + ny * offset;
  const planeZ = cz + nz * offset;
  for (let k = 0; k < ctx.affectedCount; k += 1) {
    const base = ctx.affected[k] * 3;
    const distance =
      (ctx.positions[base] - planeX) * nx
      + (ctx.positions[base + 1] - planeY) * ny
      + (ctx.positions[base + 2] - planeZ) * nz;
    const scale = -distance * ctx.weights[k] * strength;
    out[k * 3] = nx * scale;
    out[k * 3 + 1] = ny * scale;
    out[k * 3 + 2] = nz * scale;
  }
}

/** smooth — 균일 가중 라플라시안(이웃 평균 쪽으로 lerp). */
export function sculptSmoothDisplacement(
  ctx: SculptBrushContext,
  params: SculptBrushParams,
  out: Float32Array,
): void {
  const adjacency = ctx.adjacency;
  const lambda = clamp01(params.smoothLambda) * clamp01(params.strength);
  for (let k = 0; k < ctx.affectedCount; k += 1) {
    const v = ctx.affected[k];
    const base = v * 3;
    if (!adjacency) {
      out[k * 3] = 0;
      out[k * 3 + 1] = 0;
      out[k * 3 + 2] = 0;
      continue;
    }
    const start = adjacency.offsets[v];
    const end = adjacency.offsets[v + 1];
    const degree = end - start;
    if (degree === 0) {
      out[k * 3] = 0;
      out[k * 3 + 1] = 0;
      out[k * 3 + 2] = 0;
      continue;
    }
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let s = start; s < end; s += 1) {
      const nb = adjacency.neighbors[s] * 3;
      sx += ctx.positions[nb];
      sy += ctx.positions[nb + 1];
      sz += ctx.positions[nb + 2];
    }
    const inverse = 1 / degree;
    const scale = lambda * ctx.weights[k];
    out[k * 3] = (sx * inverse - ctx.positions[base]) * scale;
    out[k * 3 + 1] = (sy * inverse - ctx.positions[base + 1]) * scale;
    out[k * 3 + 2] = (sz * inverse - ctx.positions[base + 2]) * scale;
  }
}

/** grab — 고정 집합 평행이동. */
export function sculptGrabDisplacement(
  ctx: SculptBrushContext,
  params: SculptBrushParams,
  out: Float32Array,
): void {
  for (let k = 0; k < ctx.affectedCount; k += 1) {
    const w = ctx.weights[k];
    out[k * 3] = params.moveX * w;
    out[k * 3 + 1] = params.moveY * w;
    out[k * 3 + 2] = params.moveZ * w;
  }
}

/** pinch — 브러시 중심 축으로 수축(direction −1 이면 팽창). */
export function sculptPinchDisplacement(
  ctx: SculptBrushContext,
  params: SculptBrushParams,
  out: Float32Array,
): void {
  const amount = params.radius * clamp01(params.strength) * params.direction;
  for (let k = 0; k < ctx.affectedCount; k += 1) {
    const base = ctx.affected[k] * 3;
    const dx = params.centerX - ctx.positions[base];
    const dy = params.centerY - ctx.positions[base + 1];
    const dz = params.centerZ - ctx.positions[base + 2];
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    if (lengthSquared <= 0) {
      out[k * 3] = 0;
      out[k * 3 + 1] = 0;
      out[k * 3 + 2] = 0;
      continue;
    }
    const scale = (amount * ctx.weights[k]) / Math.sqrt(lengthSquared);
    out[k * 3] = dx * scale;
    out[k * 3 + 1] = dy * scale;
    out[k * 3 + 2] = dz * scale;
  }
}

/** inflate — 법선 방향 균일 팽창. 팔로프 무시(풍선처럼 영역 전체가 같은 비율로 부풀음). */
export function sculptInflateDisplacement(
  ctx: SculptBrushContext,
  params: SculptBrushParams,
  out: Float32Array,
): void {
  const amount = params.radius * clamp01(params.strength) * params.direction;
  for (let k = 0; k < ctx.affectedCount; k += 1) {
    const base = ctx.affected[k] * 3;
    out[k * 3] = ctx.normals[base] * amount;
    out[k * 3 + 1] = ctx.normals[base + 1] * amount;
    out[k * 3 + 2] = ctx.normals[base + 2] * amount;
  }
}

/**
 * crease — 날카로운 V자 골/능선. 중심축으로 당기는 성분과 법선 방향 절삭 성분을 합성한다.
 * direction +1 이 골(파기), −1 이 능선(쌓기).
 */
export function sculptCreaseDisplacement(
  ctx: SculptBrushContext,
  params: SculptBrushParams,
  out: Float32Array,
): void {
  const strength = clamp01(params.strength);
  const depth = params.radius * strength * params.direction;
  const pinch = params.radius * strength * 0.35;
  for (let k = 0; k < ctx.affectedCount; k += 1) {
    const base = ctx.affected[k] * 3;
    const w = ctx.weights[k];
    const dx = params.centerX - ctx.positions[base];
    const dy = params.centerY - ctx.positions[base + 1];
    const dz = params.centerZ - ctx.positions[base + 2];
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    let pullX = 0;
    let pullY = 0;
    let pullZ = 0;
    if (lengthSquared > 0) {
      const scale = (pinch * w) / Math.sqrt(lengthSquared);
      pullX = dx * scale;
      pullY = dy * scale;
      pullZ = dz * scale;
    }
    const cut = -depth * w;
    out[k * 3] = pullX + ctx.normals[base] * cut;
    out[k * 3 + 1] = pullY + ctx.normals[base + 1] * cut;
    out[k * 3 + 2] = pullZ + ctx.normals[base + 2] * cut;
  }
}

/** flatten — clay 에서 채우기(offset)를 뺀 순수 가중 평면 투영. */
export function sculptFlattenDisplacement(
  ctx: SculptBrushContext,
  params: SculptBrushParams,
  out: Float32Array,
): void {
  sculptPlaneProjectDisplacement(ctx, params, out, "both");
}

/** scrape — 한쪽 면만 깎는 flatten. 평면 기준 튀어나온 쪽만 담대로 눌러 닫는다. */
export function sculptScrapeDisplacement(
  ctx: SculptBrushContext,
  params: SculptBrushParams,
  out: Float32Array,
): void {
  sculptPlaneProjectDisplacement(ctx, params, out, params.direction === 1 ? "positive" : "negative");
}

type PlaneSideMode = "both" | "positive" | "negative";

function sculptPlaneProjectDisplacement(
  ctx: SculptBrushContext,
  params: SculptBrushParams,
  out: Float32Array,
  mode: PlaneSideMode,
): void {
  let weightSum = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let k = 0; k < ctx.affectedCount; k += 1) {
    const base = ctx.affected[k] * 3;
    const w = ctx.weights[k];
    weightSum += w;
    cx += ctx.positions[base] * w;
    cy += ctx.positions[base + 1] * w;
    cz += ctx.positions[base + 2] * w;
    nx += ctx.normals[base] * w;
    ny += ctx.normals[base + 1] * w;
    nz += ctx.normals[base + 2] * w;
  }
  if (ctx.affectedCount === 0) return;
  if (!(weightSum > 0)) {
    out.fill(0, 0, ctx.affectedCount * 3);
    return;
  }
  const inverse = 1 / weightSum;
  cx *= inverse;
  cy *= inverse;
  cz *= inverse;
  const normalLength = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (normalLength > 0) {
    nx /= normalLength;
    ny /= normalLength;
    nz /= normalLength;
  } else {
    nx = params.fallbackNormalX;
    ny = params.fallbackNormalY;
    nz = params.fallbackNormalZ;
  }
  const strength = clamp01(params.strength);
  for (let k = 0; k < ctx.affectedCount; k += 1) {
    const base = ctx.affected[k] * 3;
    const distance =
      (ctx.positions[base] - cx) * nx
      + (ctx.positions[base + 1] - cy) * ny
      + (ctx.positions[base + 2] - cz) * nz;
    const above = distance > 0;
    const active = mode === "both"
      || (mode === "positive" ? above : !above);
    if (!active) {
      out[k * 3] = 0;
      out[k * 3 + 1] = 0;
      out[k * 3 + 2] = 0;
      continue;
    }
    const scale = -distance * ctx.weights[k] * strength;
    out[k * 3] = nx * scale;
    out[k * 3 + 1] = ny * scale;
    out[k * 3 + 2] = nz * scale;
  }
}

/** snake hook — grab 산술이지만 매 dab 영향 집합을 다시 잡아 연속으로 끌고 간다(pinning 없음). */
export function sculptSnakeHookDisplacement(
  ctx: SculptBrushContext,
  params: SculptBrushParams,
  out: Float32Array,
): void {
  for (let k = 0; k < ctx.affectedCount; k += 1) {
    const w = ctx.weights[k];
    out[k * 3] = params.moveX * w;
    out[k * 3 + 1] = params.moveY * w;
    out[k * 3 + 2] = params.moveZ * w;
  }
}

/** 디스패처 — 세션은 브러시 종류를 이 함수 하나로만 다룬다. */
export function applySculptBrushDisplacement(
  brush: SculptBrushKind,
  ctx: SculptBrushContext,
  params: SculptBrushParams,
  out: Float32Array,
): void {
  switch (brush) {
    case "clay":
      sculptClayDisplacement(ctx, params, out);
      return;
    case "smooth":
      sculptSmoothDisplacement(ctx, params, out);
      return;
    case "grab":
      sculptGrabDisplacement(ctx, params, out);
      return;
    case "pinch":
      sculptPinchDisplacement(ctx, params, out);
      return;
    case "inflate":
      sculptInflateDisplacement(ctx, params, out);
      return;
    case "crease":
      sculptCreaseDisplacement(ctx, params, out);
      return;
    case "flatten":
      sculptFlattenDisplacement(ctx, params, out);
      return;
    case "scrape":
      sculptScrapeDisplacement(ctx, params, out);
      return;
    case "snakeHook":
      sculptSnakeHookDisplacement(ctx, params, out);
      return;
    case "draw":
    default:
      sculptDrawDisplacement(ctx, params, out);
  }
}

/** grab 은 스트로크 시작 시 집합을 고정해야 한다(매 dab 재질의하면 잡은 곳이 질질 끌린다). */
export function sculptBrushPinsAffectedSet(brush: SculptBrushKind): boolean {
  return brush === "grab";
}

/** 이 브러시가 인접 CSR 을 요구하는가(세션이 필요할 때만 만들도록). */
export function sculptBrushNeedsAdjacency(brush: SculptBrushKind): boolean {
  return brush === "smooth";
}
