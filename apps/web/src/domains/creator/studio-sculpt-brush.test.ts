import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCULPT_BRUSH_PARAMS,
  SCULPT_BRUSH_KINDS,
  applySculptBrushDisplacement,
  normalizeSculptBrushKind,
  sculptBrushNeedsAdjacency,
  sculptBrushPinsAffectedSet,
  sculptClayDisplacement,
  sculptDrawDisplacement,
  sculptGrabDisplacement,
  sculptPinchDisplacement,
  sculptSmoothDisplacement,
  type SculptBrushContext,
  type SculptBrushParams,
} from "./studio-sculpt-brush";
import { sculptFalloffWeight } from "./studio-sculpt-falloff";
import {
  buildSculptVertexAdjacency,
  createSculptIcosphere,
  createSculptPlaneGrid,
  type SculptMesh,
} from "./studio-sculpt-mesh";
import { bruteForceSculptSphere } from "./studio-sculpt-spatial-hash";

function makeContext(
  mesh: SculptMesh,
  centerX: number,
  centerY: number,
  centerZ: number,
  radius: number,
  withAdjacency = false,
): SculptBrushContext {
  const affected = new Uint32Array(mesh.vertexCount);
  const count = bruteForceSculptSphere(
    mesh.positions,
    mesh.vertexCount,
    centerX,
    centerY,
    centerZ,
    radius,
    affected,
  );
  const weights = new Float32Array(count);
  for (let k = 0; k < count; k += 1) {
    const base = affected[k] * 3;
    const dx = mesh.positions[base] - centerX;
    const dy = mesh.positions[base + 1] - centerY;
    const dz = mesh.positions[base + 2] - centerZ;
    weights[k] = sculptFalloffWeight("smooth", Math.sqrt(dx * dx + dy * dy + dz * dz), radius);
  }
  return {
    positions: mesh.positions,
    normals: mesh.normals,
    affected,
    affectedCount: count,
    weights,
    adjacency: withAdjacency ? buildSculptVertexAdjacency(mesh) : null,
  };
}

function params(overrides: Partial<SculptBrushParams>): SculptBrushParams {
  return { ...DEFAULT_SCULPT_BRUSH_PARAMS, ...overrides };
}

describe("sculpt brush — draw", () => {
  it("정점 법선 방향으로 weight × strength × radius 만큼 정확히 민다", () => {
    const mesh = createSculptIcosphere(2, 1);
    const ctx = makeContext(mesh, 0, 1, 0, 0.5);
    expect(ctx.affectedCount).toBeGreaterThan(3);
    const out = new Float32Array(ctx.affectedCount * 3);
    sculptDrawDisplacement(ctx, params({ radius: 0.5, strength: 0.4, direction: 1 }), out);
    for (let k = 0; k < ctx.affectedCount; k += 1) {
      const base = ctx.affected[k] * 3;
      const expectedScale = 0.5 * 0.4 * ctx.weights[k];
      expect(out[k * 3]).toBe(Math.fround(mesh.normals[base] * expectedScale));
      expect(out[k * 3 + 1]).toBe(Math.fround(mesh.normals[base + 1] * expectedScale));
      expect(out[k * 3 + 2]).toBe(Math.fround(mesh.normals[base + 2] * expectedScale));
    }
  });

  it("direction −1 은 변위를 정확히 반전한다", () => {
    const mesh = createSculptIcosphere(1, 1);
    const ctx = makeContext(mesh, 0, 1, 0, 1);
    const outward = new Float32Array(ctx.affectedCount * 3);
    const inward = new Float32Array(ctx.affectedCount * 3);
    sculptDrawDisplacement(ctx, params({ radius: 1, strength: 0.3, direction: 1 }), outward);
    sculptDrawDisplacement(ctx, params({ radius: 1, strength: 0.3, direction: -1 }), inward);
    for (let i = 0; i < outward.length; i += 1) expect(inward[i]).toBe(-outward[i]);
  });
});

describe("sculpt brush — clay", () => {
  it("평면 오프셋 0 이면 영향 정점의 평면 편차가 줄어든다(flatten)", () => {
    const mesh = createSculptIcosphere(3, 1);
    const ctx = makeContext(mesh, 0, 1, 0, 0.6);
    const out = new Float32Array(ctx.affectedCount * 3);
    const brushParams = params({
      centerX: 0,
      centerY: 1,
      centerZ: 0,
      radius: 0.6,
      strength: 1,
      clayPlaneOffset: 0,
    });
    // 평면 법선/기준점은 구현과 동일하게 가중 평균으로 잡는다.
    let weightSum = 0;
    let cy = 0;
    let ny = 0;
    for (let k = 0; k < ctx.affectedCount; k += 1) {
      const base = ctx.affected[k] * 3;
      weightSum += ctx.weights[k];
      cy += mesh.positions[base + 1] * ctx.weights[k];
      ny += mesh.normals[base + 1] * ctx.weights[k];
    }
    cy /= weightSum;
    expect(ny).toBeGreaterThan(0);

    const before: number[] = [];
    for (let k = 0; k < ctx.affectedCount; k += 1) {
      before.push(Math.abs(mesh.positions[ctx.affected[k] * 3 + 1] - cy));
    }
    sculptClayDisplacement(ctx, brushParams, out);
    let improved = 0;
    for (let k = 0; k < ctx.affectedCount; k += 1) {
      const base = ctx.affected[k] * 3;
      const after = Math.abs(mesh.positions[base + 1] + out[k * 3 + 1] - cy);
      // weight 가 0 인 가장자리는 변화가 없다 — 그 외에는 평면에 가까워져야 한다.
      if (ctx.weights[k] > 0.05) {
        expect(after).toBeLessThan(before[k] + 1e-6);
        if (after < before[k]) improved += 1;
      }
    }
    expect(improved).toBeGreaterThan(5);
  });

  it("영향 정점이 없으면 아무 것도 쓰지 않는다", () => {
    const mesh = createSculptIcosphere(1, 1);
    const ctx = { ...makeContext(mesh, 0, 1, 0, 0.1), affectedCount: 0 };
    const out = new Float32Array(9).fill(7);
    sculptClayDisplacement(ctx, params({}), out);
    expect(Array.from(out)).toEqual(new Array(9).fill(7));
  });
});

describe("sculpt brush — smooth", () => {
  it("가시(spike)를 이웃 평균 쪽으로 당겨 실제로 낮춘다", () => {
    const mesh = createSculptPlaneGrid(8, 8, 4);
    const spike = 4 * 9 + 4; // 격자 중앙.
    mesh.positions[spike * 3 + 1] = 1;
    const ctx = makeContext(mesh, mesh.positions[spike * 3], 1, mesh.positions[spike * 3 + 2], 1.5, true);
    const out = new Float32Array(ctx.affectedCount * 3);
    sculptSmoothDisplacement(ctx, params({ strength: 1, smoothLambda: 1 }), out);
    const slot = Array.from(ctx.affected.subarray(0, ctx.affectedCount)).indexOf(spike);
    expect(slot).toBeGreaterThanOrEqual(0);
    // 이웃(전부 y=0)의 평균은 0 이므로 변위는 −1 × weight 여야 한다.
    expect(out[slot * 3 + 1]).toBeCloseTo(-ctx.weights[slot], 6);
    expect(out[slot * 3]).toBeCloseTo(0, 6);
    expect(mesh.positions[spike * 3 + 1] + out[slot * 3 + 1]).toBeLessThan(1);
  });

  it("인접 CSR 이 없으면 아무 것도 움직이지 않는다(조용한 오동작 금지)", () => {
    const mesh = createSculptPlaneGrid(4, 4, 2);
    const ctx = makeContext(mesh, 0, 0, 0, 1, false);
    const out = new Float32Array(ctx.affectedCount * 3).fill(9);
    sculptSmoothDisplacement(ctx, params({ strength: 1, smoothLambda: 1 }), out);
    for (let i = 0; i < ctx.affectedCount * 3; i += 1) expect(out[i]).toBe(0);
  });
});

describe("sculpt brush — grab", () => {
  it("이동 벡터 × weight 로 정확히 평행이동한다", () => {
    const mesh = createSculptIcosphere(2, 1);
    const ctx = makeContext(mesh, 0, 1, 0, 0.7);
    const out = new Float32Array(ctx.affectedCount * 3);
    sculptGrabDisplacement(ctx, params({ moveX: 0.1, moveY: -0.2, moveZ: 0.05 }), out);
    for (let k = 0; k < ctx.affectedCount; k += 1) {
      expect(out[k * 3]).toBe(Math.fround(0.1 * ctx.weights[k]));
      expect(out[k * 3 + 1]).toBe(Math.fround(-0.2 * ctx.weights[k]));
      expect(out[k * 3 + 2]).toBe(Math.fround(0.05 * ctx.weights[k]));
    }
  });
});

describe("sculpt brush — pinch", () => {
  it("모든 변위가 브러시 중심을 향하고 크기가 weight × strength × radius 다", () => {
    const mesh = createSculptIcosphere(2, 1);
    const center = { x: 0, y: 1, z: 0 };
    const ctx = makeContext(mesh, center.x, center.y, center.z, 0.8);
    const out = new Float32Array(ctx.affectedCount * 3);
    sculptPinchDisplacement(
      ctx,
      params({ centerX: center.x, centerY: center.y, centerZ: center.z, radius: 0.8, strength: 0.5 }),
      out,
    );
    for (let k = 0; k < ctx.affectedCount; k += 1) {
      const base = ctx.affected[k] * 3;
      const toCenterX = center.x - mesh.positions[base];
      const toCenterY = center.y - mesh.positions[base + 1];
      const toCenterZ = center.z - mesh.positions[base + 2];
      const length = Math.sqrt(
        toCenterX * toCenterX + toCenterY * toCenterY + toCenterZ * toCenterZ,
      );
      const magnitude = Math.sqrt(
        out[k * 3] ** 2 + out[k * 3 + 1] ** 2 + out[k * 3 + 2] ** 2,
      );
      if (length <= 1e-6) {
        // 중심과 정확히 겹친 정점은 방향이 정의되지 않는다 — 문서대로 변위 0.
        expect(magnitude).toBe(0);
        continue;
      }
      expect(magnitude).toBeCloseTo(0.8 * 0.5 * ctx.weights[k], 6);
      if (magnitude > 1e-9) {
        const dot =
          (out[k * 3] * toCenterX + out[k * 3 + 1] * toCenterY + out[k * 3 + 2] * toCenterZ)
          / (length * magnitude);
        expect(dot).toBeCloseTo(1, 5);
      }
    }
  });
});

describe("sculpt brush — 공통 계약", () => {
  it("같은 입력을 두 번 넣으면 비트 동일한 변위가 나온다", () => {
    const mesh = createSculptIcosphere(3, 1);
    const ctx = makeContext(mesh, 0, 1, 0, 0.6, true);
    for (const brush of SCULPT_BRUSH_KINDS) {
      const first = new Float32Array(ctx.affectedCount * 3);
      const second = new Float32Array(ctx.affectedCount * 3);
      const brushParams = params({
        centerX: 0,
        centerY: 1,
        centerZ: 0,
        radius: 0.6,
        strength: 0.4,
        moveX: 0.03,
        moveY: 0.02,
        moveZ: -0.01,
      });
      applySculptBrushDisplacement(brush, ctx, brushParams, first);
      applySculptBrushDisplacement(brush, ctx, brushParams, second);
      for (let i = 0; i < first.length; i += 1) {
        expect(Object.is(first[i], second[i])).toBe(true);
      }
    }
  });

  it("모든 브러시가 실제로 정점을 움직인다(무동작 브러시 없음)", () => {
    const mesh = createSculptIcosphere(3, 1);
    const ctx = makeContext(mesh, 0, 1, 0, 0.6, true);
    // smooth 가 의미를 갖도록 결정적으로 표면을 흔든다.
    for (let k = 0; k < ctx.affectedCount; k += 1) {
      mesh.positions[ctx.affected[k] * 3 + 1] += ((ctx.affected[k] % 3) - 1) * 0.02;
    }
    for (const brush of SCULPT_BRUSH_KINDS) {
      const out = new Float32Array(ctx.affectedCount * 3);
      applySculptBrushDisplacement(
        brush,
        ctx,
        params({
          centerX: 0,
          centerY: 1,
          centerZ: 0,
          radius: 0.6,
          strength: 0.6,
          moveX: 0.05,
          moveY: 0.05,
          moveZ: 0,
        }),
        out,
      );
      let moved = 0;
      for (let i = 0; i < out.length; i += 1) if (out[i] !== 0) moved += 1;
      expect({ brush, moved: moved > 0 }).toEqual({ brush, moved: true });
    }
  });

  it("브러시별 요구사항 플래그가 정확하다", () => {
    expect(sculptBrushPinsAffectedSet("grab")).toBe(true);
    expect(sculptBrushPinsAffectedSet("draw")).toBe(false);
    expect(sculptBrushNeedsAdjacency("smooth")).toBe(true);
    expect(sculptBrushNeedsAdjacency("clay")).toBe(false);
    expect(normalizeSculptBrushKind("pinch")).toBe("pinch");
    expect(normalizeSculptBrushKind("sharpen")).toBe("draw");
  });
});
