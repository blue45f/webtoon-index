/**
 * 지오메트리 노드 — **평면 투영 불리언**(union / difference / intersection / xor).
 *
 * ## 정직한 범위 선언 (가장 중요한 한계)
 * 이건 **3D CSG 가 아니다.** 이 레포가 이미 의존하는 `polygon-clipping`(Martinez-Rueta)은
 * 2D 라이브러리다. 그래서 여기 구현한 것은 "두 입력이 **같은 평면 위에 있을 때만**" 동작하는
 * 평면 프로파일 결합이다. 임의의 3D 메시 두 개를 BSP 트리로 자르는 진짜 CSG(동일평면 처리,
 * 자기교차 복구, 볼륨 분류)는 구현하지 않았고, 비평면 입력은 **가짜 결과를 내지 않고 거부**한다
 * (`non-planar` / `coplanar-mismatch`).
 * 실사용 대상은 웹툰 배경의 바닥·벽·소품 실루엣 프로파일 결합이며, 그 결과를
 * `studioGeometryExtrude` 로 두껍게 만들어 입체를 얻는 워크플로를 전제한다.
 *
 * ## 파이프라인
 * 1. 두 메시를 정점 병합(weld) 후 평면 방정식 n·p = d 를 구하고 모든 정점이 그 평면 위인지 검사.
 * 2. 두 평면이 같은 평면인지 검사(법선 평행 + 오프셋 일치).
 * 3. 경계 엣지(정확히 한 삼각형에만 속하는 엣지)를 이어 닫힌 링을 만든다. 링이 안 닫히면 거부.
 * 4. 지배 축을 떨어뜨려 2D 로 투영. 투영 부호가 뒤집히지 않도록 축 순서를 정규화한다.
 * 5. `polygon-clipping` 으로 불리언. 라이브러리 예외는 `boolean-backend-failed` 로 흡수.
 * 6. 구멍은 폭 0 브리지(keyhole)로 외곽 링에 이어 붙인 뒤 **결정적 ear-clipping** 으로 재삼각화.
 *    삼각형 면적 합이 폴리곤 면적과 어긋나면 `triangulation-failed` 로 거부한다(가짜 결과 방지).
 * 7. 평면 방정식으로 역투영해 3D 좌표를 복원.
 *
 * ## 주입 심(seam)
 * `polygon-clipping` 은 dynamic import(비동기)라 평가기를 async 로 오염시키면 안 된다.
 * 그래서 **동기 백엔드 인터페이스**(`StudioGeometryNodesPlanarBooleanBackend`)를 주입받고,
 * `loadStudioGeometryNodesPlanarBooleanBackend()` 가 한 번 await 해서 그 동기 백엔드를 만든다.
 * (`studio-gpu-filter-runtime.ts` 의 주입 오버라이드 관용구와 같은 형태.)
 * ESM 패키징 불일치 때문에 `mod.default ?? mod` 폴백은 필수다 —
 * `studio-path-boolean.ts` 가 실측으로 확인한 함정이며 여기서도 그대로 복제한다.
 */

import {
  createStudioGeometryMesh,
  STUDIO_GEOMETRY_DEFAULT_BUDGETS,
  studioGeometryBoundaryEdges,
  studioGeometryComputeVertexNormals,
  studioGeometryFail,
  studioGeometryFaceNormal,
  studioGeometryMergeVertices,
  studioGeometryOk,
  studioGeometryTriangleCount,
  studioGeometryVertexCount,
} from "./studio-geometry-nodes-mesh";

import type {
  StudioGeometryBudgets,
  StudioGeometryMesh,
  StudioGeometryResult,
} from "./studio-geometry-nodes-mesh";
import type { StudioPathPolygon, StudioPathRing } from "./studio-path-boolean";

// ---------------------------------------------------------------------------
// 카탈로그 · 백엔드 심
// ---------------------------------------------------------------------------

export const STUDIO_GEOMETRY_BOOLEAN_OPS = ["union", "difference", "intersection", "xor"] as const;
export type StudioGeometryBooleanOp = (typeof STUDIO_GEOMETRY_BOOLEAN_OPS)[number];

export function isStudioGeometryBooleanOp(value: unknown): value is StudioGeometryBooleanOp {
  return typeof value === "string" && (STUDIO_GEOMETRY_BOOLEAN_OPS as readonly string[]).includes(value);
}

/** 동기 2D 불리언 백엔드 — 평가기가 async 가 되지 않도록 주입된다. */
export interface StudioGeometryNodesPlanarBooleanBackend {
  readonly combine: (
    a: readonly StudioPathPolygon[],
    b: readonly StudioPathPolygon[],
    op: StudioGeometryBooleanOp
  ) => StudioPathPolygon[];
}

type PolygonClippingGeom = StudioPathPolygon | StudioPathPolygon[];
interface PolygonClippingLib {
  union(geom: PolygonClippingGeom, ...geoms: PolygonClippingGeom[]): StudioPathPolygon[];
  intersection(geom: PolygonClippingGeom, ...geoms: PolygonClippingGeom[]): StudioPathPolygon[];
  xor(geom: PolygonClippingGeom, ...geoms: PolygonClippingGeom[]): StudioPathPolygon[];
  difference(subject: PolygonClippingGeom, ...clips: PolygonClippingGeom[]): StudioPathPolygon[];
}

let backendPromise: Promise<StudioGeometryNodesPlanarBooleanBackend> | null = null;

/**
 * polygon-clipping 을 1회 로드해 동기 백엔드로 감싼다.
 * ESM 빌드가 default 단일 객체만 내보내므로 `mod.default ?? mod` 폴백이 반드시 필요하다.
 */
export async function loadStudioGeometryNodesPlanarBooleanBackend(): Promise<StudioGeometryNodesPlanarBooleanBackend> {
  backendPromise ??= import("polygon-clipping").then((mod) => {
    const lib = ((mod as { default?: unknown }).default ?? mod) as PolygonClippingLib;
    return {
      combine: (a, b, op) => {
        const subject = a as StudioPathPolygon[];
        const clip = b as StudioPathPolygon[];
        if (op === "union") return lib.union(subject, clip);
        if (op === "intersection") return lib.intersection(subject, clip);
        if (op === "xor") return lib.xor(subject, clip);
        return lib.difference(subject, clip);
      },
    } satisfies StudioGeometryNodesPlanarBooleanBackend;
  });
  return backendPromise;
}

// ---------------------------------------------------------------------------
// 평면 추출
// ---------------------------------------------------------------------------

export interface StudioGeometryPlane {
  readonly normal: readonly [number, number, number];
  readonly offset: number;
}

const PLANE_TOLERANCE_SCALE = 1e-4;
const MIN_PLANE_TOLERANCE = 1e-4;
/** 2D 좌표 양자 — polygon-clipping 입력 안정화용(스튜디오 패스 불리언의 round2 와 같은 계열). */
const PLANAR_QUANTUM = 1e-6;
/** 링 하나가 가질 수 있는 정점 상한 — ear clipping 이 O(n²) 라 실용 상한을 둔다. */
const MAX_RING_VERTICES = 4_096;
const MIN_RING_AREA = 1e-9;

function quantize2(value: number): number {
  return Math.round(value / PLANAR_QUANTUM) * PLANAR_QUANTUM;
}

/** 면적 가중 평균 법선으로 평면을 추정하고 모든 정점이 그 위인지 검사한다. */
export function studioGeometryMeshPlane(
  mesh: StudioGeometryMesh
): StudioGeometryResult<StudioGeometryPlane> {
  const triangles = studioGeometryTriangleCount(mesh);
  const vertices = studioGeometryVertexCount(mesh);
  if (triangles === 0 || vertices === 0) {
    return studioGeometryFail("empty-geometry", "평면을 추정할 면이 없습니다.");
  }
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let t = 0; t < triangles; t++) {
    const [fx, fy, fz] = studioGeometryFaceNormal(mesh, t);
    nx += fx;
    ny += fy;
    nz += fz;
  }
  const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (!(length > 0)) {
    return studioGeometryFail("non-planar", "면 법선 합이 0 입니다(앞뒤가 섞였거나 퇴화한 메시).");
  }
  const normal: [number, number, number] = [nx / length, ny / length, nz / length];
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let extent = 0;
  for (let i = 0; i < vertices; i++) {
    cx += mesh.positions[i * 3];
    cy += mesh.positions[i * 3 + 1];
    cz += mesh.positions[i * 3 + 2];
    for (let axis = 0; axis < 3; axis++) {
      extent = Math.max(extent, Math.abs(mesh.positions[i * 3 + axis]));
    }
  }
  cx /= vertices;
  cy /= vertices;
  cz /= vertices;
  const offset = normal[0] * cx + normal[1] * cy + normal[2] * cz;
  const tolerance = Math.max(MIN_PLANE_TOLERANCE, extent * PLANE_TOLERANCE_SCALE);
  for (let i = 0; i < vertices; i++) {
    const distance =
      normal[0] * mesh.positions[i * 3] +
      normal[1] * mesh.positions[i * 3 + 1] +
      normal[2] * mesh.positions[i * 3 + 2] -
      offset;
    if (Math.abs(distance) > tolerance) {
      return studioGeometryFail(
        "non-planar",
        `정점 ${i} 가 평면에서 ${distance.toFixed(6)} 만큼 벗어났습니다(허용 ${tolerance.toFixed(6)}).`
      );
    }
  }
  return studioGeometryOk({ normal, offset });
}

export interface StudioGeometryPlanarFrame {
  readonly axisU: number;
  readonly axisV: number;
  readonly axisW: number;
  readonly plane: StudioGeometryPlane;
}

function planarFrame(plane: StudioGeometryPlane): StudioGeometryPlanarFrame {
  const [nx, ny, nz] = plane.normal;
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  const axisW = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  let axisU = (axisW + 1) % 3;
  let axisV = (axisW + 2) % 3;
  // 지배 성분이 음수면 투영이 좌우 반전되어 부호가 뒤집힌다 — 축을 바꿔 되돌린다.
  if (plane.normal[axisW] < 0) {
    const swap = axisU;
    axisU = axisV;
    axisV = swap;
  }
  return { axisU, axisV, axisW, plane };
}

function unproject(frame: StudioGeometryPlanarFrame, u: number, v: number): [number, number, number] {
  const n = frame.plane.normal;
  const w = (frame.plane.offset - n[frame.axisU] * u - n[frame.axisV] * v) / n[frame.axisW];
  const out: [number, number, number] = [0, 0, 0];
  out[frame.axisU] = u;
  out[frame.axisV] = v;
  out[frame.axisW] = w;
  return out;
}

// ---------------------------------------------------------------------------
// 경계 링 추출
// ---------------------------------------------------------------------------

export function studioGeometryBoundaryRings(
  mesh: StudioGeometryMesh
): StudioGeometryResult<number[][]> {
  const boundary = studioGeometryBoundaryEdges(mesh);
  if (boundary.length === 0) {
    return studioGeometryFail("open-boundary", "경계 엣지가 없습니다(닫힌 입체는 평면 불리언 대상이 아닙니다).");
  }
  const next = new Map<number, number>();
  for (const [a, b] of boundary) {
    if (next.has(a)) {
      return studioGeometryFail("degenerate-input", `정점 ${a} 에서 경계가 갈라집니다(비다양체).`);
    }
    next.set(a, b);
  }
  const rings: number[][] = [];
  const visited = new Set<number>();
  for (const [start] of boundary) {
    if (visited.has(start)) continue;
    const ring: number[] = [];
    let cursor = start;
    for (let guard = 0; guard <= boundary.length; guard++) {
      if (visited.has(cursor)) break;
      visited.add(cursor);
      ring.push(cursor);
      const step = next.get(cursor);
      if (step === undefined) {
        return studioGeometryFail("open-boundary", `정점 ${cursor} 에서 경계 링이 끊깁니다.`);
      }
      if (step === start) {
        cursor = start;
        break;
      }
      cursor = step;
    }
    if (cursor !== start || ring.length < 3) {
      return studioGeometryFail("open-boundary", "경계 링이 닫히지 않습니다.");
    }
    rings.push(ring);
  }
  return studioGeometryOk(rings);
}

function ringSignedArea2(ring: StudioPathRing): number {
  let doubled = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    doubled += a[0] * b[1] - b[0] * a[1];
  }
  return doubled / 2;
}

/**
 * 평면 메시 + 프레임 → polygon-clipping 입력(MultiPolygon).
 *
 * 링 방향 정규화: 면적 절댓값이 가장 큰 링이 음수면 모든 링을 뒤집는다. 그래야 프레임을
 * 제공한 메시와 법선이 반대인 상대 메시도 "외곽=양수, 구멍=음수" 규약으로 들어온다.
 * 구멍은 면적이 가장 큰 외곽 링에 귀속시킨다(결정적 근사 — 서로 포함하는 다중 외곽 링의
 * 병리적 중첩은 다루지 않는다).
 */
export function studioGeometryProjectMeshToPolygons(
  mesh: StudioGeometryMesh,
  frame: StudioGeometryPlanarFrame
): StudioGeometryResult<StudioPathPolygon[]> {
  const rings = studioGeometryBoundaryRings(mesh);
  if (!rings.ok) return rings;
  const projectedRings: StudioPathRing[] = [];
  for (const ring of rings.value) {
    if (ring.length > MAX_RING_VERTICES) {
      return studioGeometryFail("budget-exceeded", `경계 링 정점 ${ring.length} > ${MAX_RING_VERTICES}`);
    }
    const projected: StudioPathRing = ring.map((index) => [
      quantize2(mesh.positions[index * 3 + frame.axisU]),
      quantize2(mesh.positions[index * 3 + frame.axisV]),
    ]);
    if (Math.abs(ringSignedArea2(projected)) < MIN_RING_AREA) continue;
    projectedRings.push(projected);
  }
  if (projectedRings.length === 0) {
    return studioGeometryFail("degenerate-input", "면적을 가진 경계 링이 없습니다.");
  }
  let dominantArea = 0;
  for (const ring of projectedRings) {
    const area = ringSignedArea2(ring);
    if (Math.abs(area) > Math.abs(dominantArea)) dominantArea = area;
  }
  const normalized = dominantArea < 0 ? projectedRings.map((ring) => ring.slice().reverse()) : projectedRings;
  const outer: StudioPathRing[] = [];
  const holes: StudioPathRing[] = [];
  for (const ring of normalized) {
    if (ringSignedArea2(ring) > 0) outer.push(ring);
    else holes.push(ring);
  }
  if (outer.length === 0) {
    return studioGeometryFail("degenerate-input", "면적을 가진 외곽 링이 없습니다.");
  }
  const polygons: StudioPathPolygon[] = outer.map((ring) => [ring]);
  if (holes.length > 0) {
    let largest = 0;
    let largestArea = -Infinity;
    for (let i = 0; i < outer.length; i++) {
      const area = Math.abs(ringSignedArea2(outer[i]));
      if (area > largestArea) {
        largestArea = area;
        largest = i;
      }
    }
    for (const hole of holes) polygons[largest].push(hole);
  }
  return studioGeometryOk(polygons);
}

/** 메시 스스로의 평면에서 프레임을 뽑고 투영까지 한 번에. */
export function studioGeometryMeshToPlanarPolygons(
  mesh: StudioGeometryMesh
): StudioGeometryResult<{ polygons: StudioPathPolygon[]; frame: StudioGeometryPlanarFrame }> {
  const plane = studioGeometryMeshPlane(mesh);
  if (!plane.ok) return plane;
  const frame = planarFrame(plane.value);
  const polygons = studioGeometryProjectMeshToPolygons(mesh, frame);
  if (!polygons.ok) return polygons;
  return studioGeometryOk({ polygons: polygons.value, frame });
}

// ---------------------------------------------------------------------------
// 재삼각화 (keyhole + ear clipping)
// ---------------------------------------------------------------------------

function stripClosingVertex(ring: StudioPathRing): StudioPathRing {
  const out = ring.map(([x, y]) => [quantize2(x), quantize2(y)] as [number, number]);
  while (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) out.pop();
    else break;
  }
  return out;
}

/** 중복·공선 정점 제거. 반드시 keyhole 브리지를 만들기 **전에** 호출해야 한다(브리지는 공선이다). */
function stripCollinear(ring: StudioPathRing): StudioPathRing {
  const deduped: StudioPathRing = [];
  for (const point of ring) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev[0] === point[0] && prev[1] === point[1]) continue;
    deduped.push(point);
  }
  if (deduped.length < 3) return deduped;
  const out: StudioPathRing = [];
  for (let i = 0; i < deduped.length; i++) {
    const prev = deduped[(i + deduped.length - 1) % deduped.length];
    const cur = deduped[i];
    const next = deduped[(i + 1) % deduped.length];
    const cross =
      (cur[0] - prev[0]) * (next[1] - prev[1]) - (cur[1] - prev[1]) * (next[0] - prev[0]);
    if (Math.abs(cross) < PLANAR_QUANTUM * PLANAR_QUANTUM) continue;
    out.push(cur);
  }
  return out.length >= 3 ? out : deduped;
}

/** 구멍을 폭 0 브리지로 외곽 링에 잇는다. 앵커 선택은 전부 결정적(최대 x → 최소 y, 최근접 → 최소 인덱스). */
function keyhole(polygon: StudioPathPolygon): StudioPathRing {
  let ring = polygon[0].slice();
  const outerSign = Math.sign(ringSignedArea2(ring)) || 1;
  const holes = polygon
    .slice(1)
    .map((hole) => (Math.sign(ringSignedArea2(hole)) === outerSign ? hole.slice().reverse() : hole.slice()));
  holes.sort((a, b) => maxX(b) - maxX(a));
  for (const hole of holes) {
    let holeAnchor = 0;
    for (let i = 1; i < hole.length; i++) {
      const [hx, hy] = hole[i];
      const [bx, by] = hole[holeAnchor];
      if (hx > bx || (hx === bx && hy < by)) holeAnchor = i;
    }
    let ringAnchor = 0;
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const dx = ring[i][0] - hole[holeAnchor][0];
      const dy = ring[i][1] - hole[holeAnchor][1];
      const distance = dx * dx + dy * dy;
      if (distance < best) {
        best = distance;
        ringAnchor = i;
      }
    }
    const bridged: StudioPathRing = [];
    for (let i = 0; i <= ringAnchor; i++) bridged.push(ring[i]);
    for (let i = 0; i < hole.length; i++) bridged.push(hole[(holeAnchor + i) % hole.length]);
    bridged.push(hole[holeAnchor]);
    for (let i = ringAnchor; i < ring.length; i++) bridged.push(ring[i]);
    ring = bridged;
  }
  return ring;
}

function maxX(ring: StudioPathRing): number {
  let value = -Infinity;
  for (const [x] of ring) if (x > value) value = x;
  return value;
}

function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function sameVertex(ring: StudioPathRing, i: number, j: number): boolean {
  return ring[i][0] === ring[j][0] && ring[i][1] === ring[j][1];
}

/**
 * 결정적 ear clipping. CCW(양의 면적) 링을 받아 삼각형 인덱스 3개씩을 돌려준다.
 * 1차로 엄격한 볼록 귀만 자르고, 한 바퀴에 하나도 못 자르면 퇴화(공선) 귀를 허용하는
 * 2차 패스로 넘어간다. 그래도 못 자르면 null(호출부가 triangulation-failed 로 수렴).
 *
 * keyhole 브리지는 정점 좌표를 **의도적으로 중복**시킨다(구멍 앵커·외곽 앵커가 각각 두 번
 * 등장). `pointInTriangle` 은 경계 위 점도 "안"으로 보므로, 그 쌍둥이 정점이 모든 후보 귀를
 * 막아 버린다. 그래서 후보 삼각형의 세 꼭짓점과 **좌표가 같은** 정점은 포함 검사에서 제외한다
 * (earcut 이 동일 상황을 처리하는 방식). 이 처리가 없으면 구멍 뚫린 불리언 결과가 전부
 * triangulation-failed 로 떨어진다 — 테스트로 고정해 둔 회귀 지점이다.
 */
function earClip(ring: StudioPathRing): number[] | null {
  const n = ring.length;
  if (n < 3) return null;
  const alive: number[] = [];
  for (let i = 0; i < n; i++) alive.push(i);
  const triangles: number[] = [];
  let guard = 0;
  const maxIterations = n * n + 32;
  while (alive.length > 3) {
    if (guard++ > maxIterations) return null;
    let clippedAt = -1;
    for (let pass = 0; pass < 2 && clippedAt < 0; pass++) {
      for (let i = 0; i < alive.length; i++) {
        const ia = alive[(i + alive.length - 1) % alive.length];
        const ib = alive[i];
        const ic = alive[(i + 1) % alive.length];
        const [ax, ay] = ring[ia];
        const [bx, by] = ring[ib];
        const [cx, cy] = ring[ic];
        const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (pass === 0 ? !(cross > 0) : cross < 0) continue;
        let contains = false;
        if (cross > 0) {
          for (const other of alive) {
            if (other === ia || other === ib || other === ic) continue;
            if (
              sameVertex(ring, other, ia) ||
              sameVertex(ring, other, ib) ||
              sameVertex(ring, other, ic)
            ) {
              continue;
            }
            if (pointInTriangle(ring[other][0], ring[other][1], ax, ay, bx, by, cx, cy)) {
              contains = true;
              break;
            }
          }
        }
        if (contains) continue;
        if (cross > 0) triangles.push(ia, ib, ic);
        clippedAt = i;
        break;
      }
    }
    if (clippedAt < 0) return null;
    alive.splice(clippedAt, 1);
  }
  triangles.push(alive[0], alive[1], alive[2]);
  return triangles;
}

// ---------------------------------------------------------------------------
// 메인 진입점
// ---------------------------------------------------------------------------

export interface StudioGeometryBooleanOptions {
  readonly backend: StudioGeometryNodesPlanarBooleanBackend | null;
  readonly budgets?: StudioGeometryBudgets;
}

const AREA_TOLERANCE_RATIO = 1e-3;

/**
 * 두 평면 메시를 같은 평면 위에서 불리언 결합한다.
 * 실패 코드: `boolean-backend-missing` / `non-planar` / `coplanar-mismatch` /
 * `open-boundary` / `degenerate-input` / `boolean-backend-failed` / `boolean-empty` /
 * `triangulation-failed` / `budget-exceeded`.
 */
export function studioGeometryPlanarBoolean(
  a: StudioGeometryMesh,
  b: StudioGeometryMesh,
  op: StudioGeometryBooleanOp,
  options: StudioGeometryBooleanOptions
): StudioGeometryResult<StudioGeometryMesh> {
  const budgets = options.budgets ?? STUDIO_GEOMETRY_DEFAULT_BUDGETS;
  if (!options.backend) {
    return studioGeometryFail("boolean-backend-missing", "2D 불리언 백엔드가 주입되지 않았습니다.");
  }
  const weldedA = studioGeometryMergeVertices(a).mesh;
  const weldedB = studioGeometryMergeVertices(b).mesh;
  const planarA = studioGeometryMeshToPlanarPolygons(weldedA);
  if (!planarA.ok) return planarA;
  const planarB = studioGeometryMeshToPlanarPolygons(weldedB);
  if (!planarB.ok) return planarB;
  const frame = planarA.value.frame;
  const other = planarB.value.frame.plane;
  const dot =
    frame.plane.normal[0] * other.normal[0] +
    frame.plane.normal[1] * other.normal[1] +
    frame.plane.normal[2] * other.normal[2];
  if (Math.abs(Math.abs(dot) - 1) > 1e-3) {
    return studioGeometryFail("coplanar-mismatch", `두 입력의 법선이 평행하지 않습니다(dot=${dot.toFixed(6)}).`);
  }
  const alignedOffset = dot >= 0 ? other.offset : -other.offset;
  if (Math.abs(alignedOffset - frame.plane.offset) > 1e-3) {
    return studioGeometryFail(
      "coplanar-mismatch",
      `두 입력이 같은 평면 위에 있지 않습니다(Δ=${(alignedOffset - frame.plane.offset).toFixed(6)}).`
    );
  }
  // b 는 a 의 프레임으로 다시 투영해야 축 순서가 일치한다.
  const reprojectedB = studioGeometryProjectMeshToPolygons(weldedB, frame);
  if (!reprojectedB.ok) return reprojectedB;

  let combined: StudioPathPolygon[];
  try {
    combined = options.backend.combine(planarA.value.polygons, reprojectedB.value, op);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return studioGeometryFail("boolean-backend-failed", `2D 불리언이 이 도형을 처리하지 못했습니다: ${detail}`);
  }
  if (!Array.isArray(combined) || combined.length === 0) {
    return studioGeometryFail("boolean-empty", "결합 결과가 비었습니다.");
  }

  const positions: number[] = [];
  const indices: number[] = [];
  for (const rawPolygon of combined) {
    if (!Array.isArray(rawPolygon) || rawPolygon.length === 0) continue;
    const rings = rawPolygon
      .map((ring) => stripCollinear(stripClosingVertex(ring)))
      .filter((ring) => ring.length >= 3 && Math.abs(ringSignedArea2(ring)) >= MIN_RING_AREA);
    if (rings.length === 0) continue;
    const expectedArea = rings.reduce((sum, ring, index) => {
      const area = Math.abs(ringSignedArea2(ring));
      return index === 0 ? area : sum - area;
    }, 0);
    let ring = keyhole(rings);
    if (ring.length > MAX_RING_VERTICES) {
      return studioGeometryFail("budget-exceeded", `결과 링 정점 ${ring.length} > ${MAX_RING_VERTICES}`);
    }
    if (ringSignedArea2(ring) < 0) ring = ring.slice().reverse();
    const clipped = earClip(ring);
    if (!clipped) return studioGeometryFail("triangulation-failed", "결과 폴리곤을 삼각화하지 못했습니다.");
    let triangulatedArea = 0;
    for (let t = 0; t < clipped.length; t += 3) {
      const [ax, ay] = ring[clipped[t]];
      const [bx, by] = ring[clipped[t + 1]];
      const [cx, cy] = ring[clipped[t + 2]];
      triangulatedArea += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
    }
    if (Math.abs(triangulatedArea - expectedArea) > Math.max(MIN_RING_AREA, expectedArea * AREA_TOLERANCE_RATIO)) {
      return studioGeometryFail(
        "triangulation-failed",
        `삼각화 면적 ${triangulatedArea.toFixed(6)} 가 폴리곤 면적 ${expectedArea.toFixed(6)} 와 다릅니다.`
      );
    }
    const base = positions.length / 3;
    for (const [u, v] of ring) {
      const [x, y, z] = unproject(frame, u, v);
      positions.push(x, y, z);
    }
    for (const index of clipped) indices.push(base + index);
  }
  if (indices.length === 0) {
    return studioGeometryFail("boolean-empty", "삼각형이 하나도 남지 않았습니다.");
  }
  const built = createStudioGeometryMesh(
    { positions: new Float32Array(positions), indices: new Uint32Array(indices), normals: null, uvs: null },
    budgets
  );
  if (!built.ok) return built;
  return studioGeometryOk({
    ...built.value,
    normals: studioGeometryComputeVertexNormals(built.value),
  });
}
