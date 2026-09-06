/**
 * Studio Puppet Warp — 핀 기반 메쉬 변형(Photoshop Puppet Warp 대응) 순수 코어.
 *
 * ⚠️ 완전한 as-rigid-as-possible(ARAP) 변형은 스코프 밖이다 — 여기서는 실용적 근사를 쓴다:
 *   (1) 사용자가 찍은 핀 + 이미지 네 모서리(항상 고정된 가상 핀)를 정점으로 삼아 "원본 메쉬"를
 *       Delaunay 삼각분할한다(Bowyer-Watson, 이 파일에서 직접 구현 — 외부 라이브러리 없음).
 *   (2) 핀을 드래그해도 삼각형 연결관계(위상)는 그대로 유지한다 — "변형된 메쉬"는 같은 인덱스
 *       삼각형들이 새 정점 위치를 가리킬 뿐이다(매 프레임 재삼각분할하지 않는다).
 *   (3) 렌더링은 삼각형마다 원본→변형 아핀 변환(2x3 행렬, 3점 대응이면 유일하게 결정됨)을 구해
 *       Canvas2D 의 save+clip(변형된 삼각형)+transform+drawImage(원본 전체)+restore 로 그 삼각형
 *       영역만 왜곡해서 그린다(표준 canvas 삼각형 텍스처 매핑 기법).
 *
 * 좌표 규약: studio-selection-tools.ts 와 동일한 3계층(정규화 0..1 → 요소 로컬 px → 마스크 디바이스
 * px). 핀의 위치는 이미지 요소 비회전 로컬 박스 기준 정규화 좌표(SelPoint)이며 0..1 로 클램프한다
 * (Photoshop 과 달리 이미지 경계 밖으로 핀을 확장 배치하는 것은 스코프 밖 — §5 참고 문서에 명시).
 *
 * 코너를 "항상 고정된 가상 핀"으로 포함하는 이유: 사용자 핀만으로 삼각분할하면 볼록 껍질(convex
 * hull) 밖 영역(이미지 모서리 쪽)이 어떤 삼각형에도 덮이지 않아 그 부분이 아예 그려지지 않는다.
 * 네 모서리를 항상 정점 집합에 포함시키면 삼각분할이 항상 이미지 전체(단위 사각형)를 빈틈없이
 * 덮고, 모서리가 절대 움직이지 않으므로 "액자 틀은 고정하고 안쪽만 인형처럼 굽힌다"는 puppet
 * warp 의 직관과도 맞아떨어진다.
 *
 * DOM 의존성 없음 — bakePuppetWarpToCanvas 도 studio-heal-clone.ts 의 bakeHealCloneStrokeToCanvas
 * 와 동일하게 캔버스 팩토리를 주입받는다(PuppetWarpCanvasFactory). 모두 결정적(랜덤·Date 없음).
 */
import { flipNormalizedPoint } from "./studio-magic-wand";

import type { MaskCanvasLike, MaskCtx2DLike, MaskImageSource, SelPoint } from "./studio-selection-tools";

// ---------------------------------------------------------------------------
// 타입·상수
// ---------------------------------------------------------------------------

/** 핀 1개 — rest(원본/배치 당시 위치)와 x/y(현재, 드래그된 위치)를 함께 들고 있다.
 * 드래그하지 않았으면 x===restX && y===restY. 둘 다 정규화(0..1, 이미지 로컬 박스 기준). */
export type PuppetPin = {
  id: string;
  restX: number;
  restY: number;
  x: number;
  y: number;
};

/** 삼각형 1개 — 정점 배열(코너 4개 + 핀들)의 인덱스 3개. 항상 반시계 방향이 되도록 만들어진다. */
export type PuppetTriangle = readonly [number, number, number];

/** 2x3 아핀 행렬 — ctx.transform(a, b, c, d, e, f) 인자 순서와 동일:
 * (x, y) -> (a*x + c*y + e, b*x + d*y + f). */
export type AffineMatrix = { a: number; b: number; c: number; d: number; e: number; f: number };

/** puppetMeshVertices 의 결과 — 코너 4개(index 0..3) + 핀들(index 4..)의 원본/현재 위치 배열. */
export type PuppetMeshVertices = { rest: SelPoint[]; current: SelPoint[] };

/** 핀 최대 개수 — Bowyer-Watson 이 매 삽입마다 O(k) 스캔이라 과도한 핀은 성능/가독성 둘 다 해친다. */
export const MAX_PUPPET_PINS = 24;

/** 핀 사이(그리고 핀-코너 사이) 최소 거리(정규화) — 너무 가까우면 거의 퇴화한(면적≈0) 삼각형이
 * 생겨 아핀 변환이 불안정해진다. 새 핀은 이 거리보다 가까운 기존 핀/코너 위에는 놓이지 않는다. */
export const PUPPET_PIN_MIN_DIST = 0.035;

/** 이미지 네 모서리 — 항상 고정된 가상 핀(사용자가 추가/삭제/이동할 수 없다). */
export const PUPPET_WARP_CORNERS: readonly SelPoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

// ---------------------------------------------------------------------------
// 내부 수치 헬퍼
// ---------------------------------------------------------------------------

/** 0..1 클램프(NaN 은 fallback, ±Infinity 는 방향대로 0/1 로 saturate).
 * 검증 스크립트로 실측한 수정: 예전엔 `!Number.isFinite(v)` 로 NaN 과 ±Infinity 를 한꺼번에
 * fallback 처리해서 +Infinity 가 "clamp" 라는 이름과 반대로 1이 아니라 fallback(기본 0)으로
 * 떨어졌다 — 방향이 있는 ±Infinity 는 그 방향대로 saturate 하는 게 맞고, 방향이 없는 NaN 만
 * fallback 을 쓰는 게 옳다(아래 `v < 0`/`v > 1` 비교는 ±Infinity 에 대해서도 올바르게 동작한다). */
function clamp01(v: number, fallback = 0): number {
  if (Number.isNaN(v)) return fallback;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// (1) 핀 데이터 모델 — 추가/삭제/이동/초기화 (전부 불변)
// ---------------------------------------------------------------------------

/** 핀을 더 추가할 수 있는지(MAX_PUPPET_PINS 미만). */
export function canAddPuppetPin(pins: readonly PuppetPin[]): boolean {
  return pins.length < MAX_PUPPET_PINS;
}

/** point 가 코너 또는 기존 핀(rest 위치)과 너무 가까운지 — 퇴화 삼각형 방지. */
function isTooCloseToExisting(point: SelPoint, pins: readonly PuppetPin[], minDist = PUPPET_PIN_MIN_DIST): boolean {
  const minDistSq = minDist * minDist;
  for (const c of PUPPET_WARP_CORNERS) {
    const dx = c.x - point.x;
    const dy = c.y - point.y;
    if (dx * dx + dy * dy < minDistSq) return true;
  }
  for (const p of pins) {
    const dx = p.restX - point.x;
    const dy = p.restY - point.y;
    if (dx * dx + dy * dy < minDistSq) return true;
  }
  return false;
}

/**
 * 새 핀 추가 — id 는 호출자(StudioPage 의 uid())가 생성해 넘긴다(studio-perspective-guide.ts 의
 * addVanishingPoint 와 동일 관례, 이 모듈은 무작위/시간 의존이 없어 결정적으로 유지된다).
 * 이미 MAX_PUPPET_PINS 개이거나, 좌표가 코너/기존 핀과 너무 가까우면 기존 배열을 그대로 반환한다
 * (변화 없음 신호 — 호출자가 이 반환값과 원본을 참조 비교해 무시할 수 있다).
 */
export function addPuppetPin(pins: readonly PuppetPin[], point: { id: string; x: number; y: number }): PuppetPin[] {
  if (!canAddPuppetPin(pins)) return pins as PuppetPin[];
  const x = clamp01(point.x);
  const y = clamp01(point.y);
  if (isTooCloseToExisting({ x, y }, pins)) return pins as PuppetPin[];
  return [...pins, { id: point.id, restX: x, restY: y, x, y }];
}

/** 핀 삭제 — 없는 id 면 기존 배열을 그대로 반환. */
export function removePuppetPin(pins: readonly PuppetPin[], id: string): PuppetPin[] {
  const next = pins.filter((p) => p.id !== id);
  return next.length === pins.length ? (pins as PuppetPin[]) : next;
}

/**
 * 핀의 현재 위치(드래그 결과)만 갱신 — restX/restY(원본 메쉬 정점, 삼각분할 위상의 기준)는
 * 절대 바꾸지 않는다. 없는 id 이거나 값이 그대로면 기존 배열을 그대로 반환(참조 안정성).
 */
export function movePuppetPin(pins: readonly PuppetPin[], id: string, x: number, y: number): PuppetPin[] {
  const cx = clamp01(x);
  const cy = clamp01(y);
  let changed = false;
  const next = pins.map((p) => {
    if (p.id !== id || (p.x === cx && p.y === cy)) return p;
    changed = true;
    return { ...p, x: cx, y: cy };
  });
  return changed ? next : (pins as PuppetPin[]);
}

/** 모든 핀의 현재 위치를 원본(rest) 위치로 되돌린다("초기화" 버튼) — 핀 자체는 지우지 않는다. */
export function resetPuppetPinPositions(pins: readonly PuppetPin[]): PuppetPin[] {
  let changed = false;
  const next = pins.map((p) => {
    if (p.x === p.restX && p.y === p.restY) return p;
    changed = true;
    return { ...p, x: p.restX, y: p.restY };
  });
  return changed ? next : (pins as PuppetPin[]);
}

/** 구울 변형이 없는지 — 핀이 없거나, 모든 핀이 원본 위치 그대로다(crop 의 isCropRectNoop 과 동일 역할). */
export function isPuppetWarpNoop(pins: readonly PuppetPin[]): boolean {
  return pins.length === 0 || pins.every((p) => p.x === p.restX && p.y === p.restY);
}

// ---------------------------------------------------------------------------
// (2) 메쉬 정점 조립 — 코너(고정) + 핀
// ---------------------------------------------------------------------------

/**
 * 삼각분할·렌더링에 쓸 정점 배열 — 인덱스 0..3 은 항상 PUPPET_WARP_CORNERS(고정, rest===current),
 * 인덱스 4.. 는 pins 순서 그대로(rest=restX/restY, current=x/y). 이 인덱스 배치 규약은
 * delaunayTriangulate/triangleAffineTransform 을 호출하는 모든 코드가 공유한다.
 */
export function puppetMeshVertices(pins: readonly PuppetPin[]): PuppetMeshVertices {
  const rest: SelPoint[] = [...PUPPET_WARP_CORNERS];
  const current: SelPoint[] = [...PUPPET_WARP_CORNERS];
  for (const p of pins) {
    rest.push({ x: p.restX, y: p.restY });
    current.push({ x: p.x, y: p.y });
  }
  return { rest, current };
}

// ---------------------------------------------------------------------------
// (3) Delaunay 삼각분할 — Bowyer-Watson(외부 라이브러리 없이 직접 구현)
// ---------------------------------------------------------------------------

type MutableTriangle = [number, number, number];
type Edge = readonly [number, number];

/** 입력 점들을 넉넉히 감싸는 슈퍼 삼각형(경계 밖 3개 보조 정점) — 좌표는 points 의 bbox 기준으로 스케일. */
function buildSuperTriangle(points: readonly SelPoint[]): [SelPoint, SelPoint, SelPoint] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const dx = maxX - minX;
  const dy = maxY - minY;
  const delta = Math.max(dx, dy, 1) * 20;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return [
    { x: midX - delta, y: midY - delta },
    { x: midX + delta, y: midY - delta },
    { x: midX, y: midY + delta * 2 },
  ];
}

/**
 * 점 p 가 삼각형(a,b,c) 의 외접원 내부에 있는지 — 표준 3x3 행렬식("들어올린 포물면") 판정.
 * a,b,c 를 먼저 반시계 방향으로 정렬한 뒤 판정한다(부호 규약이 방향에 의존하므로).
 * 작은 epsilon 을 둬 부동소수 잡음으로 인한 공원(cocircular) 근방 판정 흔들림을 줄인다.
 */
function inCircumcircle(a: SelPoint, b: SelPoint, c: SelPoint, p: SelPoint): boolean {
  const area2 = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  const A = a;
  const B = area2 < 0 ? c : b;
  const C = area2 < 0 ? b : c;
  const ax = A.x - p.x;
  const ay = A.y - p.y;
  const bx = B.x - p.x;
  const by = B.y - p.y;
  const cx = C.x - p.x;
  const cy = C.y - p.y;
  const det =
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay);
  return det > 1e-12;
}

/** 삼각형 목록에서 정확히 한 번만 등장하는 방향 있는 변("구멍" 경계) 목록. */
function boundaryEdgesOf(triangles: readonly MutableTriangle[]): Edge[] {
  const edges: Edge[] = [];
  for (const t of triangles) {
    edges.push([t[0], t[1]], [t[1], t[2]], [t[2], t[0]]);
  }
  return edges.filter(
    ([u, v], i) => !edges.some(([u2, v2], j) => i !== j && u2 === v && v2 === u)
  );
}

/**
 * Bowyer-Watson 증분 삽입 Delaunay 삼각분할. points 는 정규화 좌표(0..1) 가정이지만 임의의 유한
 * 좌표에도 동작한다(슈퍼 삼각형이 입력 bbox 기준으로 스스로 크기를 잡는다). 3점 미만이면 빈 배열.
 * 반환된 삼각형은 슈퍼 삼각형 정점을 전혀 참조하지 않는다(모두 points 배열 안 인덱스).
 * 결정적 — 입력 순서가 같으면 항상 같은 삼각형 목록을 반환한다.
 */
export function delaunayTriangulate(points: readonly SelPoint[]): PuppetTriangle[] {
  const n = points.length;
  if (n < 3) return [];

  const superPts = buildSuperTriangle(points);
  const all: SelPoint[] = [...points, ...superPts]; // 인덱스 n, n+1, n+2 = 슈퍼 삼각형.
  let triangles: MutableTriangle[] = [[n, n + 1, n + 2]];

  for (let i = 0; i < n; i += 1) {
    const p = points[i]!;
    const bad: MutableTriangle[] = [];
    const good: MutableTriangle[] = [];
    for (const t of triangles) {
      if (inCircumcircle(all[t[0]]!, all[t[1]]!, all[t[2]]!, p)) bad.push(t);
      else good.push(t);
    }
    const boundary = boundaryEdgesOf(bad);
    const retriangulated: MutableTriangle[] = boundary.map(([u, v]) => [u, v, i]);
    triangles = [...good, ...retriangulated];
  }

  return triangles.filter((t) => t[0] < n && t[1] < n && t[2] < n) as PuppetTriangle[];
}

/** 편의 함수 — 핀 배열 → "원본 메쉬" 삼각분할(위상). puppetMeshVertices(pins).rest 에 대해 계산한다. */
export function triangulatePuppetMesh(pins: readonly PuppetPin[]): PuppetTriangle[] {
  return delaunayTriangulate(puppetMeshVertices(pins).rest);
}

// ---------------------------------------------------------------------------
// (4) 삼각형 아핀 변환 — 3점 대응(원본→변형)에서 유일하게 결정되는 2x3 행렬
// ---------------------------------------------------------------------------

/**
 * 소스 삼각형(src0,src1,src2) → 목적지 삼각형(dst0,dst1,dst2) 을 정확히 맞추는 아핀 변환.
 * ctx.transform(a,b,c,d,e,f) 에 그대로 넘길 수 있는 형태 — (x,y) -> (a*x+c*y+e, b*x+d*y+f).
 * 소스 삼각형이 퇴화(공선, 면적≈0)면 역행렬을 구할 수 없으므로 null(호출자는 그 삼각형을 건너뛴다).
 */
export function triangleAffineTransform(
  src: readonly [SelPoint, SelPoint, SelPoint],
  dst: readonly [SelPoint, SelPoint, SelPoint]
): AffineMatrix | null {
  const [s0, s1, s2] = src;
  const [d0, d1, d2] = dst;

  // S = [s1-s0 | s2-s0] (2x2, 열벡터). det(S) ≈ 0 이면 세 점이 (거의) 일직선 — 역행렬 없음.
  const a11 = s1.x - s0.x;
  const a21 = s1.y - s0.y;
  const a12 = s2.x - s0.x;
  const a22 = s2.y - s0.y;
  const det = a11 * a22 - a12 * a21;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;

  const invDet = 1 / det;
  // S^{-1} = 1/det * [ a22  -a12 ; -a21  a11 ]
  const i11 = a22 * invDet;
  const i12 = -a12 * invDet;
  const i21 = -a21 * invDet;
  const i22 = a11 * invDet;

  // D = [d1-d0 | d2-d0] (2x2, 열벡터).
  const b11 = d1.x - d0.x;
  const b21 = d1.y - d0.y;
  const b12 = d2.x - d0.x;
  const b22 = d2.y - d0.y;

  // A = D * S^{-1} — src 의 (s1-s0),(s2-s0) 를 dst 의 (d1-d0),(d2-d0) 로 보내는 선형부.
  const A11 = b11 * i11 + b12 * i21;
  const A12 = b11 * i12 + b12 * i22;
  const A21 = b21 * i11 + b22 * i21;
  const A22 = b21 * i12 + b22 * i22;

  // t = d0 - A*s0 — s0 가 정확히 d0 로 가도록 하는 평행이동.
  const tx = d0.x - (A11 * s0.x + A12 * s0.y);
  const ty = d0.y - (A21 * s0.x + A22 * s0.y);

  if (![A11, A12, A21, A22, tx, ty].every((v) => Number.isFinite(v))) return null;
  return { a: A11, b: A21, c: A12, d: A22, e: tx, f: ty };
}

// ---------------------------------------------------------------------------
// (5) Konva 오버레이용 기하 — 변형된 메쉬의 삼각형 그물선(로컬 px)
// ---------------------------------------------------------------------------

/**
 * 변형된 메쉬(현재 핀 위치 기준)의 삼각형 각각을 요소 로컬 px 평탄 좌표로 —
 * Konva Line(points, closed) 에 그대로 대응(studio-selection-tools.ts 의 subpathOutlinePoints 와
 * 동일 관례). 위상(삼각형 인덱스 목록)은 항상 rest 메쉬에서 계산한다(§ 모듈 헤더 참고).
 */
export function puppetMeshTriangleLines(
  pins: readonly PuppetPin[],
  size: { width: number; height: number }
): number[][] {
  const { rest, current } = puppetMeshVertices(pins);
  const triangles = delaunayTriangulate(rest);
  return triangles.map(([i0, i1, i2]) => {
    const p0 = current[i0]!;
    const p1 = current[i1]!;
    const p2 = current[i2]!;
    return [p0.x * size.width, p0.y * size.height, p1.x * size.width, p1.y * size.height, p2.x * size.width, p2.y * size.height];
  });
}

// ---------------------------------------------------------------------------
// (6) 캔버스 팩토리 orchestration — bakeHealCloneStrokeToCanvas 와 동일 관례
// ---------------------------------------------------------------------------

/**
 * studio-selection-tools.ts 의 MaskCtx2DLike 를 확장 — 삼각형별 클립+아핀 변환에는 save/restore/
 * transform/clip 이 필요하다(MaskCtx2DLike 엔 없음). StudioPage.tsx 의 createPixelEditCanvas 는
 * 이미 진짜 CanvasRenderingContext2D 를 반환하므로 **수정 없이 그대로** 넘길 수 있다(구조적 호환,
 * HealCloneCtx2DLike 와 동일한 관례 — 메서드 바이베리언스로 컴파일 검증됨).
 */
export type PuppetWarpCtx2DLike = MaskCtx2DLike & {
  save(): void;
  restore(): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clip(fillRule?: "nonzero" | "evenodd"): void;
};

/** 오프스크린 캔버스 팩토리 — DOM 의존부를 호출자(StudioPage)가 주입한다. */
export type PuppetWarpCanvasFactory = (
  width: number,
  height: number
) => { canvas: MaskCanvasLike & MaskImageSource; ctx: PuppetWarpCtx2DLike } | null;

/**
 * 핀 배치 전체를 원본에 구워 최종 왜곡된 캔버스를 만든다.
 *
 * 알고리즘: (a) 원본 이미지를 있는 그대로 한 번 그린다 — 이것이 폴백 바닥층이다(메쉬가 어떤
 * 이유로든 — 퇴화 삼각형 등 — 전체를 못 덮어도 그 자리엔 최소한 원본이 그대로 보인다).
 * (b) rest 메쉬를 삼각분할하고, 각 삼각형에 대해 (원본 위치 3점 → 현재 위치 3점) 아핀 변환을
 * 구해 save→clip(현재 삼각형)→transform→drawImage(원본 전체)→restore 로 그 삼각형 영역만
 * 왜곡해서 덮어 그린다. 삼각형은 배열 순서대로 그려지며 서로 겹치지 않는 것이 이상적이지만,
 * 핀을 극단적으로 드래그해 삼각형이 뒤집히면 겹칠 수 있다(§5, 알려진 한계).
 *
 * 좌표는 studio-heal-clone.ts 의 flipNormalizedPoint 관례를 그대로 따른다 — 핀은 "화면에 보이는
 * (반전 표시 포함) 이미지" 기준 정규화 좌표이므로, 원본(비반전) 자연 픽셀 좌표로 되돌린 뒤에만
 * naturalWidth/Height 로 환산한다. rest/current 양쪽에 동일하게 적용하므로(반전은 대합(involution)
 * 이라 두 점 모두에 같은 변환을 걸어도 상대 관계가 보존된다) 결과 캔버스는 항상 "비반전 원본" 픽셀
 * 데이터로 남고, 기존 flipped/flippedY 속성이 그대로 다시 적용돼 화면에는 사용자가 드래그하며 본
 * 모습 그대로 보인다.
 *
 * pins 가 사실상 무연산(isPuppetWarpNoop)이면 null — 캔버스를 아예 만들지 않는다(호출자는 patchEl
 * 을 생략해야 한다는 신호, bakeHealCloneStrokeToCanvas 의 "도장 없으면 null" 관례와 동일).
 */
export function bakePuppetWarpToCanvas(
  source: MaskImageSource,
  naturalWidth: number,
  naturalHeight: number,
  pins: readonly PuppetPin[],
  createCanvas: PuppetWarpCanvasFactory,
  opts?: { flipX?: boolean; flipY?: boolean }
): (MaskCanvasLike & MaskImageSource) | null {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    return null;
  }
  if (isPuppetWarpNoop(pins)) return null;

  const w = Math.max(1, Math.round(naturalWidth));
  const h = Math.max(1, Math.round(naturalHeight));
  const flipX = opts?.flipX ?? false;
  const flipY = opts?.flipY ?? false;

  const { rest, current } = puppetMeshVertices(pins);
  const triangles = delaunayTriangulate(rest);

  const toDevice = (p: SelPoint): SelPoint => {
    const flipped = flipNormalizedPoint(p, flipX, flipY);
    return { x: flipped.x * w, y: flipped.y * h };
  };
  const restDevice = rest.map(toDevice);
  const currentDevice = current.map(toDevice);

  const out = createCanvas(w, h);
  if (!out) return null;

  // 폴백 바닥층 — 항상 원본을 있는 그대로 한 번 깔아 둔다(메쉬가 못 덮는 자리의 안전망).
  out.ctx.drawImage(source, 0, 0);

  for (const [i0, i1, i2] of triangles) {
    const s0 = restDevice[i0]!;
    const s1 = restDevice[i1]!;
    const s2 = restDevice[i2]!;
    const d0 = currentDevice[i0]!;
    const d1 = currentDevice[i1]!;
    const d2 = currentDevice[i2]!;
    const m = triangleAffineTransform([s0, s1, s2], [d0, d1, d2]);
    if (!m) continue; // 퇴화 소스 삼각형 — 폴백 바닥층이 이미 그 자리를 채우고 있다.

    out.ctx.save();
    out.ctx.beginPath();
    out.ctx.moveTo(d0.x, d0.y);
    out.ctx.lineTo(d1.x, d1.y);
    out.ctx.lineTo(d2.x, d2.y);
    out.ctx.closePath();
    out.ctx.clip();
    out.ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    out.ctx.drawImage(source, 0, 0);
    out.ctx.restore();
  }

  return out.canvas;
}
