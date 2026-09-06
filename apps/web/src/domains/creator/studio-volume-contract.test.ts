import { describe, expect, it } from "vitest";

import { STUDIO_VOLUME_COMPOSITE_SPEC } from "./studio-volume-composite";
import {
  STUDIO_VOLUME_CONTRACT_VERSION,
  STUDIO_VOLUME_INPUT_CONTRACT,
  STUDIO_VOLUME_OUTPUT_CONTRACT,
  createStudioVolumeGridFromCells,
  validateStudioVolumeInput,
} from "./studio-volume-contract";
import {
  sampleStudioVolumeDensity,
  studioVolumeCellCenter,
  studioVolumeVoxelIndex,
} from "./studio-volume-grid";

describe("studio-volume-contract · 상류(시뮬레이터) 계약", () => {
  it("계약 상수는 동결되어 있고 버전이 붙어 있다", () => {
    expect(Object.isFrozen(STUDIO_VOLUME_INPUT_CONTRACT)).toBe(true);
    expect(STUDIO_VOLUME_INPUT_CONTRACT.version).toBe(STUDIO_VOLUME_CONTRACT_VERSION);
    expect(STUDIO_VOLUME_INPUT_CONTRACT.indexing).toBe("x + nx * (y + ny * z)");
    expect(STUDIO_VOLUME_INPUT_CONTRACT.samplePosition).toBe("cell-center");
    expect(STUDIO_VOLUME_INPUT_CONTRACT.matrixLayout).toBe("column-major (m[col*4 + row])");
    expect(STUDIO_VOLUME_INPUT_CONTRACT.copiesInput).toBe(false);
    expect(STUDIO_VOLUME_INPUT_CONTRACT.requiredFields).toEqual([
      "resolution",
      "density",
      "boundsMin",
      "boundsMax",
    ]);
  });

  it("하류 계약은 합성 스펙과 같은 객체다", () => {
    expect(STUDIO_VOLUME_OUTPUT_CONTRACT).toBe(STUDIO_VOLUME_COMPOSITE_SPEC);
  });

  it("문서화된 인덱싱 수식이 실제 구현과 일치한다", () => {
    const grid = createStudioVolumeGridFromCells({
      resolution: [3, 4, 5],
      cellSize: 0.5,
      density: new Float32Array(60),
    });
    grid.density[studioVolumeVoxelIndex([3, 4, 5], 2, 3, 4)] = 9;
    // 계약 문자열이 말하는 그대로 계산해도 같은 칸이어야 한다.
    expect(grid.density[2 + 3 * (3 + 4 * 4)]).toBe(9);
  });

  it("셀 크기 기반 헬퍼가 bounds 를 정확히 만든다", () => {
    const grid = createStudioVolumeGridFromCells({
      resolution: [4, 2, 8],
      cellSize: [0.25, 0.5, 0.125],
      origin: [-1, -2, -3],
      density: new Float32Array(64),
    });
    expect(grid.boundsMin).toEqual([-1, -2, -3]);
    expect(grid.boundsMax).toEqual([0, -1, -2]);
    const report = validateStudioVolumeInput(grid);
    expect(report.ok).toBe(true);
    expect(report.prepared.cellSize[0]).toBeCloseTo(0.25, 12);
    expect(report.prepared.cellSize[1]).toBeCloseTo(0.5, 12);
    expect(report.prepared.cellSize[2]).toBeCloseTo(0.125, 12);
  });

  it("스칼라 cellSize 는 등방 셀을 만든다", () => {
    const grid = createStudioVolumeGridFromCells({
      resolution: [2, 2, 2],
      cellSize: 3,
      density: new Float32Array(8),
    });
    expect(grid.boundsMax).toEqual([6, 6, 6]);
  });

  it("렌더러는 입력 배열을 복사하지 않는다(계약 상수와 실제 동작 일치)", () => {
    const density = new Float32Array(8).fill(1);
    const report = validateStudioVolumeInput(
      createStudioVolumeGridFromCells({ resolution: [2, 2, 2], cellSize: 1, density })
    );
    expect(report.prepared.density).toBe(density);
    // 시뮬레이터가 같은 버퍼를 덮어쓰면 렌더러가 즉시 새 값을 본다 — 더블 버퍼링은 상류 책임.
    const center = studioVolumeCellCenter(report.prepared, 0, 0, 0);
    expect(sampleStudioVolumeDensity(report.prepared, center[0], center[1], center[2])).toBe(1);
    density[0] = 77;
    expect(sampleStudioVolumeDensity(report.prepared, center[0], center[1], center[2])).toBe(77);
  });

  it("온도 필드가 붙으면 그대로 통과한다", () => {
    const grid = createStudioVolumeGridFromCells({
      resolution: [2, 2, 2],
      cellSize: 1,
      density: new Float32Array(8).fill(1),
      temperature: new Float32Array(8).fill(1500),
    });
    const report = validateStudioVolumeInput(grid);
    expect(report.ok).toBe(true);
    expect(report.prepared.maxTemperature).toBe(1500);
  });

  it("잘못된 입력은 throw 없이 issues 로 보고된다", () => {
    const report = validateStudioVolumeInput({
      resolution: [4, 4, 4],
      density: new Float32Array(5),
      boundsMin: [0, 0, 0],
      boundsMax: [1, 1, 1],
    });
    expect(report.ok).toBe(false);
    expect(report.degenerate).toBe(true);
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it("완전히 비정상적인 입력에도 throw 하지 않는다", () => {
    const garbage = [
      { resolution: [0, 0, 0], density: new Float32Array(0), boundsMin: [0, 0, 0], boundsMax: [1, 1, 1] },
      {
        resolution: [2, 2, 2],
        density: new Float32Array(8),
        boundsMin: [Number.NaN, 0, 0],
        boundsMax: [1, 1, 1],
      },
      {
        resolution: [2, 2, 2],
        density: new Float32Array(8),
        boundsMin: [0, 0, 0],
        boundsMax: [1, 1, 1],
        objectToWorld: [1, 2, 3],
      },
    ] as const;
    for (const grid of garbage) {
      expect(() => validateStudioVolumeInput(grid)).not.toThrow();
    }
  });
});
