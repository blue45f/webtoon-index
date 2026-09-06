import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCULPT_BRUSH_PARAMS,
  SCULPT_BRUSH_KINDS,
  applySculptBrushDisplacement,
  sculptBrushPinsAffectedSet,
  sculptCreaseDisplacement,
  sculptFlattenDisplacement,
  sculptInflateDisplacement,
  sculptScrapeDisplacement,
  type SculptBrushContext,
  type SculptBrushParams,
} from "./studio-sculpt-brush";
import { sculptFalloffWeight } from "./studio-sculpt-falloff";
import {
  createSculptPlaneGrid,
  type SculptMesh,
} from "./studio-sculpt-mesh";
import { bruteForceSculptSphere } from "./studio-sculpt-spatial-hash";

function makeFlatSpotContext(
  mesh: SculptMesh,
  centerX: number,
  centerZ: number,
  radius: number,
): SculptBrushContext {
  const affected = new Uint32Array(mesh.vertexCount);
  const count = bruteForceSculptSphere(
    mesh.positions,
    mesh.vertexCount,
    centerX,
    0,
    centerZ,
    radius,
    affected,
  );
  const weights = new Float32Array(count);
  for (let k = 0; k < count; k += 1) {
    const base = affected[k] * 3;
    const dx = mesh.positions[base] - centerX;
    const dz = mesh.positions[base + 2] - centerZ;
    weights[k] = sculptFalloffWeight("smooth", Math.sqrt(dx * dx + dz * dz), radius);
  }
  return {
    positions: mesh.positions,
    normals: mesh.normals,
    affected,
    affectedCount: count,
    weights,
    adjacency: null,
  };
}

function params(overrides: Partial<SculptBrushParams>): SculptBrushParams {
  return { ...DEFAULT_SCULPT_BRUSH_PARAMS, ...overrides };
}

/** 언덕 한 개가 있는 평면 그리드: 중심(0,0)만 y=높이, 바깥으로 갈수록 0. */
function makeBumpyPlane(): SculptMesh {
  const grid = createSculptPlaneGrid(9, 9, 4);
  for (let i = 0; i < grid.vertexCount; i += 1) {
    const base = i * 3;
    const x = grid.positions[base];
    const z = grid.positions[base + 2];
    const d = Math.sqrt(x * x + z * z);
    if (d < 1.2) {
      grid.positions[base + 1] = 0.6 * (1 - d / 1.2);
    }
  }
  // 노말은 테스트에서 법선 방향 검증에만 쓰므로 up 벡터로 근사한다.
  for (let i = 0; i < grid.vertexCount; i += 1) {
    grid.normals[i * 3] = 0;
    grid.normals[i * 3 + 1] = 1;
    grid.normals[i * 3 + 2] = 0;
  }
  return grid;
}

describe("sculpt brush — ZBrush benchmark wave (inflate/crease/flatten/scrape/snakeHook)", () => {
  it("registers all ten brush kinds with correct pinning semantics", () => {
    expect(SCULPT_BRUSH_KINDS).toHaveLength(10);
    expect(sculptBrushPinsAffectedSet("grab")).toBe(true);
    expect(sculptBrushPinsAffectedSet("snakeHook")).toBe(false);
  });

  it("inflate ignores falloff so every affected vertex moves equally", () => {
    const mesh = makeBumpyPlane();
    const ctx = makeFlatSpotContext(mesh, 0, 0, 1.5);
    expect(ctx.affectedCount).toBeGreaterThan(4);
    const out = new Float32Array(ctx.affectedCount * 3);
    sculptInflateDisplacement(ctx, params({ strength: 0.5, direction: 1 }), out);
    const firstMagnitude = Math.abs(out[1]);
    for (let k = 0; k < ctx.affectedCount; k += 1) {
      expect(Math.abs(out[k * 3 + 1])).toBeCloseTo(firstMagnitude, 5);
    }
    // draw 와 달리 weight 에 무관하다.
    const drawOut = new Float32Array(ctx.affectedCount * 3);
    applySculptBrushDisplacement("draw", ctx, params({ strength: 0.5, direction: 1 }), drawOut);
    let drawVaries = false;
    for (let k = 1; k < ctx.affectedCount; k += 1) {
      if (Math.abs(drawOut[k * 3 + 1] - drawOut[1]) > 1e-6) drawVaries = true;
    }
    expect(drawVaries).toBe(true);
  });

  it("crease digs a valley with direction +1 and builds a ridge with −1", () => {
    const mesh = makeBumpyPlane();
    // 평탄한 영역에서 검사하면 중심 당김 성분의 y 기여가 0이라 부호 대칭만 남는다.
    for (let i = 0; i < mesh.vertexCount; i += 1) mesh.positions[i * 3 + 1] = 0;
    const ctx = makeFlatSpotContext(mesh, 0, 0, 0.8);
    const valley = new Float32Array(ctx.affectedCount * 3);
    const ridge = new Float32Array(ctx.affectedCount * 3);
    sculptCreaseDisplacement(ctx, params({ strength: 0.5 }), valley);
    sculptCreaseDisplacement(ctx, params({ strength: 0.5, direction: -1 }), ridge);
    for (let k = 0; k < ctx.affectedCount; k += 1) {
      // 법선이 +y 이므로 골은 음수 y 변위, 능선은 양수 y 변위.
      expect(valley[k * 3 + 1]).toBeLessThanOrEqual(0);
      expect(ridge[k * 3 + 1]).toBeGreaterThanOrEqual(0);
      expect(valley[k * 3 + 1]).toBe(-ridge[k * 3 + 1]);
    }
  });

  it("flatten projects every vertex onto the weighted average plane", () => {
    const mesh = makeBumpyPlane();
    const ctx = makeFlatSpotContext(mesh, 0, 0, 1.2);
    // 전체 투영을 검증하기 위해 팔로프를 균일 가중(1)으로 고정한다.
    const uniform: SculptBrushContext = { ...ctx, weights: new Float32Array(ctx.affectedCount).fill(1) };
    const out = new Float32Array(ctx.affectedCount * 3);
    sculptFlattenDisplacement(uniform, params({ strength: 1 }), out);
    // 강도 1이면 전부 같은 평면(y = 가중 평균 높이) 위로 모인다.
    const heights = new Set<number>();
    for (let k = 0; k < ctx.affectedCount; k += 1) {
      const base = ctx.affected[k] * 3;
      heights.add(Number((mesh.positions[base + 1] + out[k * 3 + 1]).toFixed(4)));
    }
    expect(heights.size).toBe(1);
  });

  it("scrape only lowers vertices above the plane and never raises valleys", () => {
    const mesh = makeBumpyPlane();
    const ctx = makeFlatSpotContext(mesh, 0, 0, 1.2);
    const out = new Float32Array(ctx.affectedCount * 3);
    sculptScrapeDisplacement(ctx, params({ strength: 1 }), out);
    for (let k = 0; k < ctx.affectedCount; k += 1) {
      expect(out[k * 3 + 1]).toBeLessThanOrEqual(0);
    }
    // 평균보다 낮은 골짜기는 건드리지 않는다.
    const flattenOut = new Float32Array(ctx.affectedCount * 3);
    sculptFlattenDisplacement(ctx, params({ strength: 1 }), flattenOut);
    let lowestK = 0;
    let lowestY = Infinity;
    for (let k = 0; k < ctx.affectedCount; k += 1) {
      const base = ctx.affected[k] * 3;
      if (mesh.positions[base + 1] < lowestY) {
        lowestY = mesh.positions[base + 1];
        lowestK = k;
      }
    }
    expect(out[lowestK * 3 + 1]).toBe(0);
  });

  it("dispatches the new kinds through the single session entry point", () => {
    const mesh = makeBumpyPlane();
    const ctx = makeFlatSpotContext(mesh, 0, 0, 0.8);
    for (const brush of ["inflate", "crease", "flatten", "scrape", "snakeHook"] as const) {
      const out = new Float32Array(ctx.affectedCount * 3);
      expect(() => applySculptBrushDisplacement(brush, ctx, params({}), out)).not.toThrow();
      expect(out.some((value) => value !== 0)
        || brush === "snakeHook").toBe(true);
    }
  });
});
