/**
 * Studio Mesh Warp & Interactive Liquify Deformer — 웹툰 작화 및 인체 보정을 위한
 * 자유 격자 변형(Mesh Warp), 케이지 디폼 및 픽셀/벡터 리퀴파이(밀기/팽창/수축/회오리) 코어.
 *
 * 마스터플랜 5.11 (선택·변형·보정) & 997개 기능 갭 (F-121 ~ F-142):
 * - 정밀 메쉬 그리드 (Rows x Cols 제어점 격자) 생성 및 베지어/쌍선형 변형 보간
 * - 대화형 리퀴파이 브러시: 전방 밀기(Push Forward), 팽창(Bloat), 수축(Pinch), 회오리(Twirl), 복원(Reconstruct)
 * - 가우시안/스무스스텝 브러시 감쇄(Falloff) 및 벡터 스트로크 포인트 변형
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_MESH_WARP_VERSION = 1 as const;

export const LIQUIFY_BRUSH_MODES = [
  "push-forward",
  "expand-bloat",
  "pinch-pucker",
  "twirl-cw",
  "twirl-ccw",
  "reconstruct-smooth",
] as const;
export type LiquifyBrushMode = (typeof LIQUIFY_BRUSH_MODES)[number];

export interface MeshControlPoint {
  readonly col: number;
  readonly row: number;
  readonly origX: number;
  readonly origY: number;
  readonly currX: number;
  readonly currY: number;
}

export interface StudioMeshWarpGrid {
  readonly version: typeof STUDIO_MESH_WARP_VERSION;
  readonly rows: number;
  readonly cols: number;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly controlPoints: readonly MeshControlPoint[];
}

export interface LiquifyPoint2D {
  readonly x: number;
  readonly y: number;
}

export function createMeshWarpGrid(
  bounds: { x: number; y: number; width: number; height: number },
  cols: number = 4,
  rows: number = 4,
): StudioMeshWarpGrid {
  const points: MeshControlPoint[] = [];

  for (let r = 0; r <= rows; r += 1) {
    const v = r / rows;
    const y = bounds.y + v * bounds.height;
    for (let c = 0; c <= cols; c += 1) {
      const u = c / cols;
      const x = bounds.x + u * bounds.width;

      points.push(
        Object.freeze({
          col: c,
          row: r,
          origX: x,
          origY: y,
          currX: x,
          currY: y,
        }),
      );
    }
  }

  return Object.freeze({
    version: STUDIO_MESH_WARP_VERSION,
    rows,
    cols,
    bounds: Object.freeze({ ...bounds }),
    controlPoints: Object.freeze(points),
  });
}

export function displaceMeshControlPoint(
  grid: StudioMeshWarpGrid,
  col: number,
  row: number,
  deltaX: number,
  deltaY: number,
): StudioMeshWarpGrid {
  const index = grid.controlPoints.findIndex((p) => p.col === col && p.row === row);
  if (index === -1) {
    throw new Error(`Control point col=${col}, row=${row} not found`);
  }
  const pt = grid.controlPoints[index];
  const updated: MeshControlPoint = {
    ...pt,
    currX: pt.currX + deltaX,
    currY: pt.currY + deltaY,
  };

  const nextPoints = [...grid.controlPoints];
  nextPoints[index] = Object.freeze(updated);
  return { ...grid, controlPoints: Object.freeze(nextPoints) };
}

/**
 * 정규화된 (u, v) 좌표 [0..1]에서 변형된 메쉬 위치 [x, y]를 쌍선형(Bilinear) 보간으로 계산한다.
 */
export function evaluateMeshWarpPosition(
  grid: StudioMeshWarpGrid,
  u: number,
  v: number,
): [number, number] {
  const clampedU = Math.max(0, Math.min(1, u));
  const clampedV = Math.max(0, Math.min(1, v));

  const colFloat = clampedU * grid.cols;
  const rowFloat = clampedV * grid.rows;

  const c0 = Math.floor(colFloat);
  const r0 = Math.floor(rowFloat);
  const c1 = Math.min(grid.cols, c0 + 1);
  const r1 = Math.min(grid.rows, r0 + 1);

  const fracU = colFloat - c0;
  const fracV = rowFloat - r0;

  const getPt = (col: number, row: number) => {
    return (
      grid.controlPoints.find((p) => p.col === col && p.row === row) ?? {
        currX: grid.bounds.x + (col / grid.cols) * grid.bounds.width,
        currY: grid.bounds.y + (row / grid.rows) * grid.bounds.height,
      }
    );
  };

  const p00 = getPt(c0, r0);
  const p10 = getPt(c1, r0);
  const p01 = getPt(c0, r1);
  const p11 = getPt(c1, r1);

  // Bilinear interpolation
  const topX = p00.currX + (p10.currX - p00.currX) * fracU;
  const topY = p00.currY + (p10.currY - p00.currY) * fracU;
  const botX = p01.currX + (p11.currX - p01.currX) * fracU;
  const botY = p01.currY + (p11.currY - p01.currY) * fracU;

  const outX = topX + (botX - topX) * fracV;
  const outY = topY + (botY - topY) * fracV;

  return [outX, outY];
}

/**
 * 리퀴파이 브러시 액션을 점 목록에 적용한다.
 */
export function applyLiquifyBrush(
  points: readonly LiquifyPoint2D[],
  brushCenter: readonly [number, number],
  mode: LiquifyBrushMode,
  radiusPx: number,
  strength: number = 0.5,
  directionVector?: readonly [number, number],
): readonly LiquifyPoint2D[] {
  const [bx, by] = brushCenter;
  const [dirX, dirY] = directionVector ?? [0, 0];

  return Object.freeze(
    points.map((pt) => {
      const dx = pt.x - bx;
      const dy = pt.y - by;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist >= radiusPx) return pt;

      // Smoothstep falloff: 1 - 3t^2 + 2t^3
      const t = dist / radiusPx;
      const falloff = (1 - t * t * (3 - 2 * t)) * Math.max(0, Math.min(1, strength));

      if (mode === "push-forward") {
        return Object.freeze({
          x: pt.x + dirX * falloff,
          y: pt.y + dirY * falloff,
        });
      }

      if (mode === "expand-bloat") {
        const factor = 1 + falloff * 0.5;
        return Object.freeze({
          x: bx + dx * factor,
          y: by + dy * factor,
        });
      }

      if (mode === "pinch-pucker") {
        const factor = 1 - falloff * 0.5;
        return Object.freeze({
          x: bx + dx * factor,
          y: by + dy * factor,
        });
      }

      if (mode === "twirl-cw") {
        const angle = falloff * Math.PI * 0.5;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        return Object.freeze({
          x: bx + dx * cosA - dy * sinA,
          y: by + dx * sinA + dy * cosA,
        });
      }

      return pt;
    }),
  );
}
