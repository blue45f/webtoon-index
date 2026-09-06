import { describe, expect, it } from "vitest";

import {
  STUDIO_PBR_PCF_KERNELS,
  STUDIO_PBR_PCF_KERNEL_3X3,
  STUDIO_PBR_PCF_KERNEL_5X5,
  applyStudioPbrNormalOffset,
  buildStudioPbrDirectionalShadowMatrix,
  multiply4x4,
  projectStudioPbrShadowUv,
  sampleStudioPbrPcf,
  type StudioPbrBounds,
} from "./studio-pbr-shadow";

const BOUNDS: StudioPbrBounds = { min: { x: -5, y: 0, z: -5 }, max: { x: 5, y: 4, z: 5 } };
const DIRECTION = { x: -0.5, y: -1, z: -0.3 };

function shiftBounds(bounds: StudioPbrBounds, dx: number): StudioPbrBounds {
  return {
    min: { x: bounds.min.x + dx, y: bounds.min.y, z: bounds.min.z },
    max: { x: bounds.max.x + dx, y: bounds.max.y, z: bounds.max.z },
  };
}

describe("studio-pbr-shadow: 행렬 구성", () => {
  it("직교 절두체가 바운딩 구를 정확히 감싼다", () => {
    const matrix = buildStudioPbrDirectionalShadowMatrix({
      direction: DIRECTION,
      sceneBounds: BOUNDS,
      mapSize: 1024,
    });
    // 반지름 = half-extent 벡터 길이.
    expect(matrix.radius).toBeCloseTo(Math.sqrt(25 + 4 + 25), 12);
    expect(matrix.texelWorldSize).toBeCloseTo((2 * matrix.radius) / 1024, 12);
  });

  it("viewProjection 이 projection·view 와 정확히 같다", () => {
    const matrix = buildStudioPbrDirectionalShadowMatrix({
      direction: DIRECTION,
      sceneBounds: BOUNDS,
      mapSize: 512,
    });
    const expected = multiply4x4(matrix.projection, matrix.view);
    for (let i = 0; i < 16; i += 1) {
      expect(matrix.viewProjection[i]).toBeCloseTo(expected[i], 12);
    }
  });

  it("씬 중심이 클립 공간 원점 근처(±텍셀)에 온다", () => {
    const matrix = buildStudioPbrDirectionalShadowMatrix({
      direction: DIRECTION,
      sceneBounds: BOUNDS,
      mapSize: 512,
      texelSnap: false,
    });
    const center = { x: 0, y: 2, z: 0 };
    const projected = projectStudioPbrShadowUv(matrix.viewProjection, center);
    expect(projected.u).toBeCloseTo(0.5, 10);
    expect(projected.v).toBeCloseTo(0.5, 10);
    expect(projected.outside).toBe(false);
  });

  it("바운즈 안의 점은 전부 절두체 안에 들어온다", () => {
    const matrix = buildStudioPbrDirectionalShadowMatrix({
      direction: DIRECTION,
      sceneBounds: BOUNDS,
      mapSize: 256,
    });
    for (const x of [BOUNDS.min.x, 0, BOUNDS.max.x]) {
      for (const y of [BOUNDS.min.y, BOUNDS.max.y]) {
        for (const z of [BOUNDS.min.z, 0, BOUNDS.max.z]) {
          expect(projectStudioPbrShadowUv(matrix.viewProjection, { x, y, z }).outside).toBe(false);
        }
      }
    }
  });

  it("영벡터 방향과 잘못된 mapSize 는 던진다", () => {
    expect(() =>
      buildStudioPbrDirectionalShadowMatrix({
        direction: { x: 0, y: 0, z: 0 },
        sceneBounds: BOUNDS,
        mapSize: 512,
      }),
    ).toThrow();
    expect(() =>
      buildStudioPbrDirectionalShadowMatrix({ direction: DIRECTION, sceneBounds: BOUNDS, mapSize: 1 }),
    ).toThrow();
  });
});

describe("studio-pbr-shadow: 텍셀 스냅", () => {
  const mapSize = 512;
  const base = buildStudioPbrDirectionalShadowMatrix({
    direction: DIRECTION,
    sceneBounds: BOUNDS,
    mapSize,
  });
  const texel = base.texelWorldSize;

  it("텍셀 이하 이동에는 행렬이 바이트 동일하게 유지된다(shimmer 제거)", () => {
    const nudged = buildStudioPbrDirectionalShadowMatrix({
      direction: DIRECTION,
      sceneBounds: shiftBounds(BOUNDS, texel * 0.2),
      mapSize,
    });
    expect(Array.from(nudged.viewProjection)).toEqual(Array.from(base.viewProjection));
  });

  it("텍셀 이상 이동하면 행렬이 실제로 바뀐다", () => {
    const moved = buildStudioPbrDirectionalShadowMatrix({
      direction: DIRECTION,
      sceneBounds: shiftBounds(BOUNDS, texel * 3),
      mapSize,
    });
    expect(Array.from(moved.viewProjection)).not.toEqual(Array.from(base.viewProjection));
  });

  it("스냅을 끄면 텍셀 이하 이동에도 행렬이 흔들린다", () => {
    const options = { direction: DIRECTION, mapSize, texelSnap: false };
    const a = buildStudioPbrDirectionalShadowMatrix({ ...options, sceneBounds: BOUNDS });
    const b = buildStudioPbrDirectionalShadowMatrix({
      ...options,
      sceneBounds: shiftBounds(BOUNDS, texel * 0.2),
    });
    expect(Array.from(b.viewProjection)).not.toEqual(Array.from(a.viewProjection));
  });

  it("스냅된 이동량이 항상 텍셀의 정수배다", () => {
    let previousTranslation: number | null = null;
    const deltas: number[] = [];
    for (let i = 0; i <= 12; i += 1) {
      const matrix = buildStudioPbrDirectionalShadowMatrix({
        direction: DIRECTION,
        sceneBounds: shiftBounds(BOUNDS, texel * i * 0.5),
        mapSize,
      });
      const translation = matrix.view[12]; // 라이트 공간 x 평행이동
      if (previousTranslation !== null && translation !== previousTranslation) {
        deltas.push(Math.abs(translation - previousTranslation));
      }
      previousTranslation = translation;
    }
    expect(deltas.length).toBeGreaterThan(0);
    for (const delta of deltas) {
      expect(delta / texel).toBeCloseTo(Math.round(delta / texel), 8);
    }
  });
});

describe("studio-pbr-shadow: PCF 커널", () => {
  it("두 커널 모두 가중치 합이 정확히 1 이다", () => {
    for (const kernel of STUDIO_PBR_PCF_KERNELS) {
      const total = kernel.taps.reduce((sum, tap) => sum + tap.weight, 0);
      expect(total).toBeCloseTo(1, 12);
    }
  });

  it("탭 개수와 반경이 이름과 일치한다", () => {
    expect(STUDIO_PBR_PCF_KERNEL_3X3.taps.length).toBe(9);
    expect(STUDIO_PBR_PCF_KERNEL_3X3.radius).toBe(1);
    expect(STUDIO_PBR_PCF_KERNEL_5X5.taps.length).toBe(25);
    expect(STUDIO_PBR_PCF_KERNEL_5X5.radius).toBe(2);
  });

  it("탭 오프셋이 고정 격자다 — 난수 회전이 없다(결정성 계약)", () => {
    const offsets = STUDIO_PBR_PCF_KERNEL_3X3.taps.map((tap) => `${tap.dx},${tap.dy}`);
    expect(offsets).toEqual([
      "-1,-1",
      "0,-1",
      "1,-1",
      "-1,0",
      "0,0",
      "1,0",
      "-1,1",
      "0,1",
      "1,1",
    ]);
    // 3×3 은 균등 가중이다.
    for (const tap of STUDIO_PBR_PCF_KERNEL_3X3.taps) expect(tap.weight).toBeCloseTo(1 / 9, 12);
    // 5×5 이항은 중심이 가장 무겁다.
    const center = STUDIO_PBR_PCF_KERNEL_5X5.taps.find((tap) => tap.dx === 0 && tap.dy === 0);
    expect(center?.weight).toBeCloseTo(36 / 256, 12);
  });

  it("5×5 가 3×3 보다 넓게 퍼진다 — 2차 모멘트로 잰다", () => {
    // 중심 가중치로는 비교할 수 없다: 이항 5탭의 정규화 중심(36/256)은 균등 3×3(1/9)
    // 보다 오히려 크다. 퍼짐은 탭 분포의 2차 모멘트로 재야 한다.
    const spread = (kernel: typeof STUDIO_PBR_PCF_KERNEL_3X3): number =>
      kernel.taps.reduce((sum, tap) => sum + tap.weight * (tap.dx * tap.dx + tap.dy * tap.dy), 0);
    expect(spread(STUDIO_PBR_PCF_KERNEL_3X3)).toBeCloseTo(4 / 3, 12);
    expect(spread(STUDIO_PBR_PCF_KERNEL_5X5)).toBeCloseTo(2, 12);
    expect(spread(STUDIO_PBR_PCF_KERNEL_5X5)).toBeGreaterThan(spread(STUDIO_PBR_PCF_KERNEL_3X3));
  });
});

describe("studio-pbr-shadow: PCF 샘플링", () => {
  const mapSize = 8;

  function uniformDepthMap(value: number): Float32Array {
    return new Float32Array(mapSize * mapSize).fill(value);
  }

  /** 왼쪽 절반은 가까운 캐스터(0.2), 오른쪽 절반은 먼 배경(1.0). */
  function halfOccludedMap(): Float32Array {
    const map = new Float32Array(mapSize * mapSize);
    for (let y = 0; y < mapSize; y += 1) {
      for (let x = 0; x < mapSize; x += 1) {
        map[y * mapSize + x] = x < mapSize / 2 ? 0.2 : 1;
      }
    }
    return map;
  }

  it("수신자가 모든 캐스터보다 앞이면 완전히 밝다(정확히 1)", () => {
    const visibility = sampleStudioPbrPcf(uniformDepthMap(0.9), mapSize, 0.5, 0.5, 0.1);
    expect(visibility).toBeCloseTo(1, 12);
  });

  it("수신자가 모든 캐스터보다 뒤면 완전히 어둡다(정확히 0)", () => {
    const visibility = sampleStudioPbrPcf(uniformDepthMap(0.2), mapSize, 0.5, 0.5, 0.9);
    expect(visibility).toBe(0);
  });

  it("경계에서 커널 가중치 비율만큼 정확히 부분 가시가 된다", () => {
    // 텍셀 x=4 중심에 3×3 커널을 놓으면 x=3(가림) 1열, x=4,5(비가림) 2열이 잡힌다.
    const visibility = sampleStudioPbrPcf(halfOccludedMap(), mapSize, 4.5 / mapSize, 0.5, 0.5);
    expect(visibility).toBeCloseTo(6 / 9, 12);
    // 한 칸 더 오른쪽이면 전부 비가림.
    expect(sampleStudioPbrPcf(halfOccludedMap(), mapSize, 5.5 / mapSize, 0.5, 0.5)).toBeCloseTo(1, 12);
    // 한 칸 왼쪽이면 전부 가림.
    expect(sampleStudioPbrPcf(halfOccludedMap(), mapSize, 2.5 / mapSize, 0.5, 0.5)).toBe(0);
  });

  it("5×5 커널이 경계를 더 넓게 번지게 한다", () => {
    const map = halfOccludedMap();
    const uv = 5.5 / mapSize; // 3×3 로는 완전 가시인 위치
    const narrow = sampleStudioPbrPcf(map, mapSize, uv, 0.5, 0.5, {
      kernel: STUDIO_PBR_PCF_KERNEL_3X3,
    });
    const wide = sampleStudioPbrPcf(map, mapSize, uv, 0.5, 0.5, { kernel: STUDIO_PBR_PCF_KERNEL_5X5 });
    expect(narrow).toBeCloseTo(1, 12);
    expect(wide).toBeLessThan(1);
    expect(wide).toBeGreaterThan(0.8);
  });

  it("경사 비례 바이어스가 스침각에서 실제로 더 밀어준다", () => {
    const map = uniformDepthMap(0.5);
    const options = { slopeScaledBias: 0.1 };
    // n·l=1(정면)이면 바이어스 0 → 0.55 는 가려진다.
    expect(sampleStudioPbrPcf(map, mapSize, 0.5, 0.5, 0.55, { ...options, nDotL: 1 })).toBe(0);
    // n·l=0(스침각)이면 바이어스 0.1 → 0.55-0.1=0.45 로 가시가 된다.
    expect(sampleStudioPbrPcf(map, mapSize, 0.5, 0.5, 0.55, { ...options, nDotL: 0 })).toBeCloseTo(1, 12);
  });

  it("맵 밖 샘플 처리 정책이 반영된다", () => {
    const map = uniformDepthMap(0.1);
    // 좌상단 모서리: 3×3 중 4탭만 맵 안(전부 가림), 5탭이 맵 밖.
    const lit = sampleStudioPbrPcf(map, mapSize, 0.5 / mapSize, 0.5 / mapSize, 0.9, { outsideIsLit: true });
    const dark = sampleStudioPbrPcf(map, mapSize, 0.5 / mapSize, 0.5 / mapSize, 0.9, { outsideIsLit: false });
    expect(lit).toBeCloseTo(5 / 9, 12);
    expect(dark).toBe(0);
  });

  it("길이가 안 맞는 깊이 맵은 던진다", () => {
    expect(() => sampleStudioPbrPcf(new Float32Array(10), 8, 0.5, 0.5, 0.5)).toThrow();
  });
});

describe("studio-pbr-shadow: 노멀 오프셋 바이어스", () => {
  it("정면 입사(n·l=1)에서는 전혀 밀지 않는다", () => {
    const point = { x: 1, y: 2, z: 3 };
    const moved = applyStudioPbrNormalOffset(point, { x: 0, y: 1, z: 0 }, 0.05, 1);
    expect(moved).toEqual(point);
  });

  it("스침각(n·l→0)에서 최대로 민다", () => {
    const texel = 0.05;
    const moved = applyStudioPbrNormalOffset({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, texel, 0);
    expect(moved.y).toBeCloseTo(texel * 1.5, 12);
  });

  it("이동량이 n·l 감소에 따라 단조 증가한다", () => {
    let previous = -1;
    for (let i = 10; i >= 0; i -= 1) {
      const nDotL = i / 10;
      const moved = applyStudioPbrNormalOffset({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 0.05, nDotL);
      expect(moved.y).toBeGreaterThan(previous);
      previous = moved.y;
    }
  });
});
