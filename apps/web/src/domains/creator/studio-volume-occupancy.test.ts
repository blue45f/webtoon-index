import { describe, expect, it } from "vitest";

import {
  intersectStudioVolumeBounds,
  prepareStudioVolume,
  sampleStudioVolumeDensity,
  studioVolumeVoxelIndex,
  type StudioVolumePrepared,
} from "./studio-volume-grid";
import {
  STUDIO_VOLUME_DEFAULT_BLOCK_SIZE,
  buildStudioVolumeOccupancy,
  studioVolumeOccupiedIntervals,
  studioVolumeStepRanges,
} from "./studio-volume-occupancy";
import { studioVolumeHashFloat } from "./studio-volume-sampler";

function volumeFrom(n: number, fill: (i: number, j: number, k: number) => number): StudioVolumePrepared {
  const density = new Float32Array(n * n * n);
  for (let k = 0; k < n; k += 1) {
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        density[studioVolumeVoxelIndex([n, n, n], i, j, k)] = fill(i, j, k);
      }
    }
  }
  return prepareStudioVolume({
    resolution: [n, n, n],
    density,
    boundsMin: [0, 0, 0],
    boundsMax: [1, 1, 1],
  });
}

/** 한가운데 8³ 만 채운 32³ 볼륨 — 대부분이 빈 공간이다. */
function centeredCube(n = 32, half = 4): StudioVolumePrepared {
  const c = n / 2;
  return volumeFrom(n, (i, j, k) =>
    Math.abs(i - c) < half && Math.abs(j - c) < half && Math.abs(k - c) < half ? 2 : 0
  );
}

describe("studio-volume-occupancy · 빌드", () => {
  it("블록 격자 크기는 ceil(resolution / blockSize)", () => {
    const prepared = centeredCube(32);
    const occ = buildStudioVolumeOccupancy(prepared, 8);
    expect(occ.dims).toEqual([4, 4, 4]);
    expect(occ.totalBlocks).toBe(64);
    expect(occ.maxDensity.length).toBe(64);
    expect(occ.blockExtent[0]).toBeCloseTo(8 / 32, 12);
  });

  it("나누어떨어지지 않는 해상도도 처리한다", () => {
    const prepared = volumeFrom(10, () => 1);
    const occ = buildStudioVolumeOccupancy(prepared, 4);
    expect(occ.dims).toEqual([3, 3, 3]);
    expect(occ.occupiedBlocks).toBe(27);
  });

  it("빈 블록은 정확히 0 이고 점유 블록만 센다", () => {
    const prepared = centeredCube(32);
    const occ = buildStudioVolumeOccupancy(prepared, 8);
    expect(occ.occupiedBlocks).toBeGreaterThan(0);
    expect(occ.occupiedBlocks).toBeLessThan(occ.totalBlocks);
    let zeros = 0;
    for (let i = 0; i < occ.maxDensity.length; i += 1) if (occ.maxDensity[i] === 0) zeros += 1;
    expect(zeros).toBe(occ.totalBlocks - occ.occupiedBlocks);
  });

  it("보수성: 빈 블록 내부의 어떤 점을 삼선형 샘플링해도 정확히 0 이다(에이프런 증명)", () => {
    // 에이프런이 없으면 블록 경계 반 셀 안쪽에서 이웃 복셀이 새어 들어와 실패한다.
    const prepared = centeredCube(32);
    const occ = buildStudioVolumeOccupancy(prepared, 8);
    const [bx, by, bz] = occ.dims;
    let probed = 0;
    for (let k = 0; k < bz; k += 1) {
      for (let j = 0; j < by; j += 1) {
        for (let i = 0; i < bx; i += 1) {
          if (occ.maxDensity[i + bx * (j + by * k)] > 0) continue;
          for (let s = 0; s < 40; s += 1) {
            const fx = studioVolumeHashFloat(1, i * 97 + j * 13 + k, s * 3);
            const fy = studioVolumeHashFloat(2, i * 97 + j * 13 + k, s * 3 + 1);
            const fz = studioVolumeHashFloat(3, i * 97 + j * 13 + k, s * 3 + 2);
            const x = (i + fx) * occ.blockExtent[0];
            const y = (j + fy) * occ.blockExtent[1];
            const z = (k + fz) * occ.blockExtent[2];
            expect(sampleStudioVolumeDensity(prepared, x, y, z)).toBe(0);
            probed += 1;
          }
        }
      }
    }
    expect(probed).toBeGreaterThan(1000);
  });

  it("에이프런은 이웃 블록의 밀도를 실제로 끌어온다", () => {
    // 복셀 (8,8,8) 하나만 밀도 → 블록 (1,1,1) 뿐 아니라 (0,0,0)~(1,1,1) 이웃도 점유가 된다.
    const prepared = volumeFrom(16, (i, j, k) => (i === 8 && j === 8 && k === 8 ? 5 : 0));
    const occ = buildStudioVolumeOccupancy(prepared, 8);
    expect(occ.dims).toEqual([2, 2, 2]);
    expect(occ.maxDensity[1 + 2 * (1 + 2 * 1)]).toBe(5);
    // 에이프런 덕에 (0,0,0) 블록도 5 를 본다(경계 지지대 보호).
    expect(occ.maxDensity[0]).toBe(5);
  });

  it("threshold 를 올리면 더 많은 블록이 비게 된다(편향 대가)", () => {
    const prepared = volumeFrom(16, (i) => (i < 8 ? 0.05 : 3));
    const strict = buildStudioVolumeOccupancy(prepared, 4, 0);
    const loose = buildStudioVolumeOccupancy(prepared, 4, 0.1);
    expect(loose.occupiedBlocks).toBeLessThan(strict.occupiedBlocks);
  });

  it("퇴화 볼륨은 블록 0개 구조체를 낸다", () => {
    const degenerate = prepareStudioVolume({
      resolution: [4, 4, 4],
      density: new Float32Array(64),
      boundsMin: [0, 0, 0],
      boundsMax: [0, 1, 1],
    });
    const occ = buildStudioVolumeOccupancy(degenerate);
    expect(occ.totalBlocks).toBe(0);
    expect(occ.dims).toEqual([0, 0, 0]);
    expect(
      studioVolumeOccupiedIntervals(degenerate, occ, 0, 0, 0, 1, 0, 0, 0, 1)
    ).toEqual([]);
  });

  it("기본 블록 크기는 8 이다", () => {
    expect(STUDIO_VOLUME_DEFAULT_BLOCK_SIZE).toBe(8);
    const occ = buildStudioVolumeOccupancy(centeredCube(32));
    expect(occ.blockSize).toBe(8);
  });
});

describe("studio-volume-occupancy · DDA 순회", () => {
  it("가운데를 관통하는 레이는 점유 구간만 돌려준다", () => {
    const prepared = centeredCube(32, 4);
    const occ = buildStudioVolumeOccupancy(prepared, 8);
    const span = intersectStudioVolumeBounds(prepared, -1, 0.5, 0.5, 1, 0, 0)!;
    const intervals = studioVolumeOccupiedIntervals(
      prepared,
      occ,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      span.tEnter,
      span.tExit
    );
    expect(intervals.length).toBeGreaterThan(0);
    const covered = intervals.reduce((sum, i) => sum + (i.tEnd - i.tStart), 0);
    expect(covered).toBeLessThan(span.tExit - span.tEnter);
    expect(covered).toBeGreaterThan(0);
    for (const interval of intervals) {
      expect(interval.tEnd).toBeGreaterThan(interval.tStart);
      expect(interval.tStart).toBeGreaterThanOrEqual(span.tEnter - 1e-9);
      expect(interval.tEnd).toBeLessThanOrEqual(span.tExit + 1e-9);
    }
  });

  it("구간은 오름차순이며 겹치지 않는다", () => {
    const prepared = volumeFrom(32, (i) => (Math.floor(i / 4) % 2 === 0 ? 1 : 0));
    const occ = buildStudioVolumeOccupancy(prepared, 4);
    const span = intersectStudioVolumeBounds(prepared, -1, 0.5, 0.5, 1, 0, 0)!;
    const intervals = studioVolumeOccupiedIntervals(
      prepared,
      occ,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      span.tEnter,
      span.tExit
    );
    for (let i = 1; i < intervals.length; i += 1) {
      expect(intervals[i].tStart).toBeGreaterThanOrEqual(intervals[i - 1].tEnd);
    }
  });

  it("밀도가 가득 찬 볼륨은 스팬 전체가 한 구간이 된다", () => {
    const prepared = volumeFrom(16, () => 1);
    const occ = buildStudioVolumeOccupancy(prepared, 8);
    const span = intersectStudioVolumeBounds(prepared, -1, 0.5, 0.5, 1, 0, 0)!;
    const intervals = studioVolumeOccupiedIntervals(
      prepared,
      occ,
      -1,
      0.5,
      0.5,
      1,
      0,
      0,
      span.tEnter,
      span.tExit
    );
    expect(intervals.length).toBe(1);
    expect(intervals[0].tStart).toBeCloseTo(span.tEnter, 9);
    expect(intervals[0].tEnd).toBeCloseTo(span.tExit, 9);
  });

  it("완전히 빈 볼륨은 구간이 없다", () => {
    const prepared = volumeFrom(16, () => 0);
    const occ = buildStudioVolumeOccupancy(prepared, 8);
    expect(occ.occupiedBlocks).toBe(0);
    const span = intersectStudioVolumeBounds(prepared, -1, 0.5, 0.5, 1, 0, 0)!;
    expect(
      studioVolumeOccupiedIntervals(prepared, occ, -1, 0.5, 0.5, 1, 0, 0, span.tEnter, span.tExit)
    ).toEqual([]);
  });

  it("축 평행이 아닌 대각선 레이도 안전하게 순회한다", () => {
    const prepared = centeredCube(32, 6);
    const occ = buildStudioVolumeOccupancy(prepared, 8);
    const inv = Math.sqrt(1 / 3);
    const span = intersectStudioVolumeBounds(prepared, -1, -1, -1, inv, inv, inv)!;
    const intervals = studioVolumeOccupiedIntervals(
      prepared,
      occ,
      -1,
      -1,
      -1,
      inv,
      inv,
      inv,
      span.tEnter,
      span.tExit
    );
    expect(intervals.length).toBeGreaterThan(0);
    const covered = intervals.reduce((sum, i) => sum + (i.tEnd - i.tStart), 0);
    expect(covered).toBeLessThan(span.tExit - span.tEnter);
  });
});

describe("studio-volume-occupancy · 스텝 인덱스 범위", () => {
  it("구간을 겹치지 않는 오름차순 [lo,hi] 쌍으로 바꾼다", () => {
    const ranges = studioVolumeStepRanges(
      [
        { tStart: 0.2, tEnd: 0.3 },
        { tStart: 0.6, tEnd: 0.8 },
      ],
      0,
      0.1,
      10
    );
    expect(ranges.length % 2).toBe(0);
    for (let i = 0; i < ranges.length; i += 2) {
      expect(ranges[i]).toBeLessThanOrEqual(ranges[i + 1]);
      if (i >= 2) expect(ranges[i]).toBeGreaterThan(ranges[i - 1]);
    }
    expect(ranges[0]).toBeGreaterThanOrEqual(0);
    expect(ranges[ranges.length - 1]).toBeLessThanOrEqual(9);
  });

  it("구간을 덮는 스텝 인덱스를 하나도 빠뜨리지 않는다(양쪽 1칸 여유 포함)", () => {
    const stepSize = 0.1;
    const ranges = studioVolumeStepRanges([{ tStart: 0.25, tEnd: 0.55 }], 0, stepSize, 10);
    const covered = new Set<number>();
    for (let i = 0; i < ranges.length; i += 2) {
      for (let k = ranges[i]; k <= ranges[i + 1]; k += 1) covered.add(k);
    }
    // 스텝 k 의 표본은 [k·dt, (k+1)·dt) 에 있다 → 0.25~0.55 를 덮는 k 는 2..5.
    for (const k of [2, 3, 4, 5]) expect(covered.has(k)).toBe(true);
  });

  it("빈 입력/0 스텝은 빈 배열", () => {
    expect(studioVolumeStepRanges([], 0, 0.1, 10)).toEqual([]);
    expect(studioVolumeStepRanges([{ tStart: 0, tEnd: 1 }], 0, 0.1, 0)).toEqual([]);
    expect(studioVolumeStepRanges([{ tStart: 0, tEnd: 1 }], 0, 0, 10)).toEqual([]);
  });
});
