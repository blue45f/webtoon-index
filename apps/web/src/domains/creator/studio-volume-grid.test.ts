import { describe, expect, it } from "vitest";

import {
  intersectStudioVolumeBounds,
  invertStudioVolumeMat4,
  prepareStudioVolume,
  sampleStudioVolumeDensity,
  sampleStudioVolumeTemperature,
  studioVolumeCellCenter,
  studioVolumeVoxelIndex,
  studioVolumeWorldRayToObject,
  transformStudioVolumeDirection,
  transformStudioVolumePoint,
  type StudioVolumeGrid,
} from "./studio-volume-grid";

/** 값이 인덱스와 같은 램프 그리드 — 삼선형 결과를 손으로 계산할 수 있다. */
function rampGrid(nx: number, ny: number, nz: number): StudioVolumeGrid {
  const density = new Float32Array(nx * ny * nz);
  for (let i = 0; i < density.length; i += 1) density[i] = i;
  return {
    resolution: [nx, ny, nz],
    density,
    boundsMin: [0, 0, 0],
    boundsMax: [1, 1, 1],
  };
}

describe("studio-volume-grid · 입력 계약", () => {
  it("인덱싱 규약은 x + nx*(y + ny*z) 다", () => {
    expect(studioVolumeVoxelIndex([4, 5, 6], 1, 2, 3)).toBe(1 + 4 * (2 + 5 * 3));
    expect(studioVolumeVoxelIndex([4, 5, 6], 0, 0, 0)).toBe(0);
    expect(studioVolumeVoxelIndex([4, 5, 6], 3, 4, 5)).toBe(4 * 5 * 6 - 1);
  });

  it("셀 중심은 boundsMin + (i+0.5)*cellSize 다", () => {
    const prepared = prepareStudioVolume(rampGrid(4, 4, 4));
    const center = studioVolumeCellCenter(prepared, 0, 0, 0);
    expect(center[0]).toBeCloseTo(0.125, 12);
    expect(center[1]).toBeCloseTo(0.125, 12);
    expect(center[2]).toBeCloseTo(0.125, 12);
    const last = studioVolumeCellCenter(prepared, 3, 3, 3);
    expect(last[0]).toBeCloseTo(0.875, 12);
  });

  it("cellSize / invCellSize / maxDensity 를 계산한다", () => {
    const prepared = prepareStudioVolume(rampGrid(2, 4, 8));
    expect(prepared.cellSize).toEqual([0.5, 0.25, 0.125]);
    expect(prepared.invCellSize[0]).toBeCloseTo(2, 12);
    expect(prepared.maxDensity).toBe(2 * 4 * 8 - 1);
    expect(prepared.degenerate).toBe(false);
    expect(prepared.issues).toEqual([]);
  });
});

describe("studio-volume-grid · 삼선형 샘플링", () => {
  it("셀 중심에서 저장값과 정확히 일치한다", () => {
    const grid = rampGrid(4, 4, 4);
    const prepared = prepareStudioVolume(grid);
    for (let k = 0; k < 4; k += 1) {
      for (let j = 0; j < 4; j += 1) {
        for (let i = 0; i < 4; i += 1) {
          const c = studioVolumeCellCenter(prepared, i, j, k);
          const sampled = sampleStudioVolumeDensity(prepared, c[0], c[1], c[2]);
          expect(sampled).toBe(grid.density[studioVolumeVoxelIndex([4, 4, 4], i, j, k)]);
        }
      }
    }
  });

  it("인접 셀 중심의 중점은 정확히 두 값의 평균이다", () => {
    const grid = rampGrid(4, 4, 4);
    const prepared = prepareStudioVolume(grid);
    const a = studioVolumeCellCenter(prepared, 1, 1, 1);
    const b = studioVolumeCellCenter(prepared, 2, 1, 1);
    const mid = sampleStudioVolumeDensity(prepared, (a[0] + b[0]) / 2, a[1], a[2]);
    const va = grid.density[studioVolumeVoxelIndex([4, 4, 4], 1, 1, 1)];
    const vb = grid.density[studioVolumeVoxelIndex([4, 4, 4], 2, 1, 1)];
    expect(mid).toBeCloseTo((va + vb) / 2, 12);
  });

  it("8개 셀 중심의 무게중심은 8값 평균이다(3축 동시 보간)", () => {
    const grid = rampGrid(4, 4, 4);
    const prepared = prepareStudioVolume(grid);
    const c0 = studioVolumeCellCenter(prepared, 1, 1, 1);
    const c1 = studioVolumeCellCenter(prepared, 2, 2, 2);
    const sampled = sampleStudioVolumeDensity(
      prepared,
      (c0[0] + c1[0]) / 2,
      (c0[1] + c1[1]) / 2,
      (c0[2] + c1[2]) / 2
    );
    let sum = 0;
    for (let k = 1; k <= 2; k += 1) {
      for (let j = 1; j <= 2; j += 1) {
        for (let i = 1; i <= 2; i += 1) {
          sum += grid.density[studioVolumeVoxelIndex([4, 4, 4], i, j, k)];
        }
      }
    }
    expect(sampled).toBeCloseTo(sum / 8, 10);
  });

  it("AABB 바깥은 0, 경계 반 셀 안쪽은 clamp-to-edge 다", () => {
    const grid = rampGrid(4, 4, 4);
    const prepared = prepareStudioVolume(grid);
    expect(sampleStudioVolumeDensity(prepared, -0.001, 0.5, 0.5)).toBe(0);
    expect(sampleStudioVolumeDensity(prepared, 1.001, 0.5, 0.5)).toBe(0);
    expect(sampleStudioVolumeDensity(prepared, 0.5, -5, 0.5)).toBe(0);
    expect(sampleStudioVolumeDensity(prepared, 0.5, 0.5, 42)).toBe(0);
    // boundsMin 코너는 (0,0,0) 셀 값으로 클램프된다(0 감쇠 아님).
    expect(sampleStudioVolumeDensity(prepared, 0, 0, 0)).toBe(grid.density[0]);
    expect(sampleStudioVolumeDensity(prepared, 1, 1, 1)).toBe(grid.density[grid.density.length - 1]);
  });

  it("NaN 좌표는 0 을 돌려준다(비교가 전부 false 라도 경계 검사에 걸린다)", () => {
    const prepared = prepareStudioVolume(rampGrid(4, 4, 4));
    expect(sampleStudioVolumeDensity(prepared, Number.NaN, 0.5, 0.5)).toBe(0);
  });

  it("온도 필드가 없으면 온도 샘플은 0 이다", () => {
    const prepared = prepareStudioVolume(rampGrid(2, 2, 2));
    expect(prepared.temperature).toBeNull();
    expect(sampleStudioVolumeTemperature(prepared, 0.5, 0.5, 0.5)).toBe(0);
  });

  it("1×1×1 그리드도 던지지 않고 상수 필드처럼 동작한다", () => {
    const density = new Float32Array([7]);
    const prepared = prepareStudioVolume({
      resolution: [1, 1, 1],
      density,
      boundsMin: [0, 0, 0],
      boundsMax: [2, 2, 2],
    });
    expect(prepared.degenerate).toBe(false);
    expect(sampleStudioVolumeDensity(prepared, 0.1, 0.1, 0.1)).toBe(7);
    expect(sampleStudioVolumeDensity(prepared, 1.9, 1.9, 1.9)).toBe(7);
    expect(sampleStudioVolumeDensity(prepared, 2.1, 1, 1)).toBe(0);
  });
});

describe("studio-volume-grid · 퇴화 입력", () => {
  it("두께 0 bounds 는 던지지 않고 degenerate 로 보고한다", () => {
    const prepared = prepareStudioVolume({
      resolution: [4, 4, 4],
      density: new Float32Array(64),
      boundsMin: [0, 0, 0],
      boundsMax: [0, 1, 1],
    });
    expect(prepared.degenerate).toBe(true);
    expect(prepared.issues.join(" ")).toContain("positive extent");
    expect(sampleStudioVolumeDensity(prepared, 0, 0, 0)).toBe(0);
    expect(intersectStudioVolumeBounds(prepared, 0, 0, 0, 1, 0, 0)).toBeNull();
  });

  it("density 길이 불일치는 degenerate", () => {
    const prepared = prepareStudioVolume({
      resolution: [4, 4, 4],
      density: new Float32Array(10),
      boundsMin: [0, 0, 0],
      boundsMax: [1, 1, 1],
    });
    expect(prepared.degenerate).toBe(true);
    expect(prepared.issues[0]).toContain("density length must be 64");
  });

  it("해상도 0 은 degenerate", () => {
    const prepared = prepareStudioVolume({
      resolution: [0, 4, 4],
      density: new Float32Array(0),
      boundsMin: [0, 0, 0],
      boundsMax: [1, 1, 1],
    });
    expect(prepared.degenerate).toBe(true);
  });

  it("특이 objectToWorld(평면으로 찌부러짐)는 degenerate", () => {
    const singular = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
    const prepared = prepareStudioVolume({
      resolution: [2, 2, 2],
      density: new Float32Array(8),
      boundsMin: [0, 0, 0],
      boundsMax: [1, 1, 1],
      objectToWorld: singular,
    });
    expect(prepared.degenerate).toBe(true);
    expect(prepared.issues.join(" ")).toContain("singular");
  });

  it("온도 길이만 틀리면 온도만 버리고 계속 렌더 가능하다", () => {
    const prepared = prepareStudioVolume({
      resolution: [2, 2, 2],
      density: new Float32Array(8).fill(1),
      temperature: new Float32Array(3),
      boundsMin: [0, 0, 0],
      boundsMax: [1, 1, 1],
    });
    expect(prepared.degenerate).toBe(false);
    expect(prepared.temperature).toBeNull();
    expect(prepared.issues.join(" ")).toContain("temperature length");
  });
});

describe("studio-volume-grid · 행렬과 레이", () => {
  it("열 우선 4×4 역행렬이 항등을 복원한다", () => {
    const m = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1];
    const inv = new Float64Array(16);
    expect(invertStudioVolumeMat4(m, inv)).toBe(true);
    const p = transformStudioVolumePoint(m, 1, 1, 1, new Float64Array(3));
    expect(Array.from(p)).toEqual([7, 9, 11]);
    const back = transformStudioVolumePoint(inv, p[0], p[1], p[2], new Float64Array(3));
    expect(back[0]).toBeCloseTo(1, 12);
    expect(back[1]).toBeCloseTo(1, 12);
    expect(back[2]).toBeCloseTo(1, 12);
  });

  it("방향 변환은 평행이동을 무시한다", () => {
    const m = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 100, 100, 100, 1];
    const d = transformStudioVolumeDirection(m, 1, 0, 0, new Float64Array(3));
    expect(Array.from(d)).toEqual([2, 0, 0]);
  });

  it("월드→오브젝트 레이는 방향을 정규화하지 않는다(파라미터 t 가 월드 거리)", () => {
    const scale2 = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1];
    const prepared = prepareStudioVolume({
      resolution: [2, 2, 2],
      density: new Float32Array(8).fill(1),
      boundsMin: [0, 0, 0],
      boundsMax: [1, 1, 1],
      objectToWorld: scale2,
    });
    const ray = studioVolumeWorldRayToObject(prepared, -1, 1, 1, 1, 0, 0);
    // 월드 x=-1 → 오브젝트 x=-0.5. 방향 길이는 1/2 이 되어야 t 가 월드 거리로 남는다.
    expect(ray[0]).toBeCloseTo(-0.5, 12);
    expect(Math.hypot(ray[3], ray[4], ray[5])).toBeCloseTo(0.5, 12);
    const span = intersectStudioVolumeBounds(prepared, ray[0], ray[1], ray[2], ray[3], ray[4], ray[5]);
    expect(span).not.toBeNull();
    // 오브젝트 박스는 한 변 1 이지만 월드에서는 2 → 현 길이 2.
    expect(span!.tExit - span!.tEnter).toBeCloseTo(2, 10);
  });

  it("AABB 를 비껴가는 레이는 null", () => {
    const prepared = prepareStudioVolume(rampGrid(2, 2, 2));
    expect(intersectStudioVolumeBounds(prepared, -1, 5, 0.5, 1, 0, 0)).toBeNull();
    // 축과 평행하고 박스 밖에서 시작하는 성분이 있으면 즉시 기각.
    expect(intersectStudioVolumeBounds(prepared, 0.5, -1, 0.5, 0, 0, 1)).toBeNull();
  });

  it("내부에서 출발한 레이는 tEnter = 0 이다", () => {
    const prepared = prepareStudioVolume(rampGrid(2, 2, 2));
    const span = intersectStudioVolumeBounds(prepared, 0.5, 0.5, 0.5, 1, 0, 0);
    expect(span).not.toBeNull();
    expect(span!.tEnter).toBe(0);
    expect(span!.tExit).toBeCloseTo(0.5, 12);
  });
});
