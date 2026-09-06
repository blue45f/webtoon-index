import { describe, expect, it } from "vitest";

import {
  STUDIO_SMOKE_BOUNDARY_FACES,
  STUDIO_SMOKE_CHIMNEY_BOUNDARY,
  STUDIO_SMOKE_CLOSED_BOUNDARY,
  STUDIO_SMOKE_INTERACTIVE_MAX_CELLS,
  STUDIO_SMOKE_MAX_CELLS,
  STUDIO_SMOKE_RESOLUTIONS,
  countStudioSmokeSolidCells,
  createStudioSmokeGridSpec,
  createStudioSmokeState,
  estimateStudioSmokeMemoryBytes,
  fillStudioSmokeSolidBox,
  fillStudioSmokeSolidSlab,
  fillStudioSmokeSolidSphere,
  packStudioSmokeBoundaryMask,
  resetStudioSmokeFields,
  studioSmokeCellCount,
  studioSmokeCellIndex,
  studioSmokeUCount,
  studioSmokeUIndex,
  studioSmokeVCount,
  studioSmokeVIndex,
  studioSmokeWCount,
  studioSmokeWIndex,
} from "./studio-smoke-grid";

describe("studio-smoke-grid: 스펙 검증", () => {
  it("축이 2 미만이거나 정수가 아니면 던진다(무음 클램프 없음)", () => {
    expect(() => createStudioSmokeGridSpec({ nx: 1, ny: 8, nz: 8 })).toThrow(RangeError);
    expect(() => createStudioSmokeGridSpec({ nx: 8.5, ny: 8, nz: 8 })).toThrow(RangeError);
    expect(() => createStudioSmokeGridSpec({ nx: 8, ny: Number.NaN, nz: 8 })).toThrow(RangeError);
  });

  it("h 가 0 이하이거나 비유한이면 던진다", () => {
    expect(() => createStudioSmokeGridSpec({ nx: 8, ny: 8, nz: 8, h: 0 })).toThrow(RangeError);
    expect(() => createStudioSmokeGridSpec({ nx: 8, ny: 8, nz: 8, h: -1 })).toThrow(RangeError);
    expect(() => createStudioSmokeGridSpec({ nx: 8, ny: 8, nz: 8, h: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
  });

  it("64³ 초과는 allowOffline 없이는 못 만든다", () => {
    expect(() => createStudioSmokeGridSpec({ nx: 96, ny: 96, nz: 96 })).toThrow(/allowOffline/);
    const spec = createStudioSmokeGridSpec({ nx: 96, ny: 96, nz: 96, allowOffline: true });
    expect(studioSmokeCellCount(spec)).toBe(884736);
    expect(studioSmokeCellCount(spec)).toBeGreaterThan(STUDIO_SMOKE_INTERACTIVE_MAX_CELLS);
  });

  it("128³ 초과는 allowOffline 으로도 못 만든다", () => {
    expect(() => createStudioSmokeGridSpec({ nx: 160, ny: 160, nz: 160, allowOffline: true })).toThrow(
      /절대 상한/,
    );
    expect(STUDIO_SMOKE_MAX_CELLS).toBe(128 ** 3);
  });

  it("비정방 격자를 허용한다(연기 기둥은 세로가 길다)", () => {
    const spec = createStudioSmokeGridSpec({ nx: 16, ny: 48, nz: 20 });
    expect(studioSmokeCellCount(spec)).toBe(16 * 48 * 20);
    expect(studioSmokeUCount(spec)).toBe(17 * 48 * 20);
    expect(studioSmokeVCount(spec)).toBe(16 * 49 * 20);
    expect(studioSmokeWCount(spec)).toBe(16 * 48 * 21);
  });
});

describe("studio-smoke-grid: 인덱서", () => {
  const spec = createStudioSmokeGridSpec({ nx: 5, ny: 4, nz: 3 });

  it("셀/면 인덱스는 전단사이고 배열 길이와 정확히 맞는다", () => {
    const cellSeen = new Set<number>();
    for (let k = 0; k < spec.nz; k += 1) {
      for (let j = 0; j < spec.ny; j += 1) {
        for (let i = 0; i < spec.nx; i += 1) cellSeen.add(studioSmokeCellIndex(spec, i, j, k));
      }
    }
    expect(cellSeen.size).toBe(studioSmokeCellCount(spec));
    expect(Math.max(...cellSeen)).toBe(studioSmokeCellCount(spec) - 1);

    const uSeen = new Set<number>();
    for (let k = 0; k < spec.nz; k += 1) {
      for (let j = 0; j < spec.ny; j += 1) {
        for (let i = 0; i <= spec.nx; i += 1) uSeen.add(studioSmokeUIndex(spec, i, j, k));
      }
    }
    expect(uSeen.size).toBe(studioSmokeUCount(spec));
    expect(Math.max(...uSeen)).toBe(studioSmokeUCount(spec) - 1);

    const vSeen = new Set<number>();
    for (let k = 0; k < spec.nz; k += 1) {
      for (let j = 0; j <= spec.ny; j += 1) {
        for (let i = 0; i < spec.nx; i += 1) vSeen.add(studioSmokeVIndex(spec, i, j, k));
      }
    }
    expect(vSeen.size).toBe(studioSmokeVCount(spec));
    expect(Math.max(...vSeen)).toBe(studioSmokeVCount(spec) - 1);

    const wSeen = new Set<number>();
    for (let k = 0; k <= spec.nz; k += 1) {
      for (let j = 0; j < spec.ny; j += 1) {
        for (let i = 0; i < spec.nx; i += 1) wSeen.add(studioSmokeWIndex(spec, i, j, k));
      }
    }
    expect(wSeen.size).toBe(studioSmokeWCount(spec));
    expect(Math.max(...wSeen)).toBe(studioSmokeWCount(spec) - 1);
  });
});

describe("studio-smoke-grid: 메모리", () => {
  it("추정치가 실제 할당 바이트와 정확히 같다", () => {
    for (const [nx, ny, nz] of [
      [8, 8, 8],
      [16, 32, 12],
      [48, 48, 48],
    ] as const) {
      const state = createStudioSmokeState({ nx, ny, nz });
      let actual = state.fields.solid.byteLength;
      for (const key of [
        "u",
        "u0",
        "v",
        "v0",
        "w",
        "w0",
        "density",
        "density0",
        "temperature",
        "temperature0",
        "pressure",
        "pressure0",
        "divergence",
        "curlX",
        "curlY",
        "curlZ",
        "curlMagnitude",
      ] as const) {
        actual += state.fields[key].byteLength;
      }
      expect(estimateStudioSmokeMemoryBytes(state.spec)).toBe(actual);
    }
  });

  it("정육면체 N³ 에서 69·N³ + 24·N² 공식과 일치한다(문서 표의 출처)", () => {
    for (const n of [32, 48, 64, 96, 128]) {
      const spec = createStudioSmokeGridSpec({ nx: n, ny: n, nz: n, allowOffline: n > 64 });
      expect(estimateStudioSmokeMemoryBytes(spec)).toBe(69 * n ** 3 + 24 * n ** 2);
    }
    expect(estimateStudioSmokeMemoryBytes(createStudioSmokeGridSpec({ nx: 32, ny: 32, nz: 32 }))).toBe(2285568);
  });
});

describe("studio-smoke-grid: 경계 마스크", () => {
  it("open 면만 비트가 서고 순서는 STUDIO_SMOKE_BOUNDARY_FACES 와 같다", () => {
    expect(packStudioSmokeBoundaryMask(STUDIO_SMOKE_CLOSED_BOUNDARY)).toBe(0);
    expect(packStudioSmokeBoundaryMask(STUDIO_SMOKE_CHIMNEY_BOUNDARY)).toBe(1 << 3);
    for (let bit = 0; bit < STUDIO_SMOKE_BOUNDARY_FACES.length; bit += 1) {
      const boundary = { ...STUDIO_SMOKE_CLOSED_BOUNDARY, [STUDIO_SMOKE_BOUNDARY_FACES[bit]]: "open" as const };
      expect(packStudioSmokeBoundaryMask(boundary)).toBe(1 << bit);
    }
    const all = packStudioSmokeBoundaryMask({
      xMin: "open",
      xMax: "open",
      yMin: "open",
      yMax: "open",
      zMin: "open",
      zMax: "open",
    });
    expect(all).toBe(0b111111);
  });
});

describe("studio-smoke-grid: solid 마스크 빌더", () => {
  it("박스는 지정 범위의 셀만 solid 로 만든다", () => {
    const state = createStudioSmokeState({ nx: 10, ny: 10, nz: 10 });
    const touched = fillStudioSmokeSolidBox(state, {
      minX: 2,
      maxX: 5,
      minY: 2,
      maxY: 5,
      minZ: 2,
      maxZ: 5,
    });
    expect(touched).toBe(countStudioSmokeSolidCells(state));
    expect(touched).toBeGreaterThan(0);
    const { spec, fields } = state;
    for (let k = 0; k < spec.nz; k += 1) {
      for (let j = 0; j < spec.ny; j += 1) {
        for (let i = 0; i < spec.nx; i += 1) {
          const inside = i >= 2 && i < 5 && j >= 2 && j < 5 && k >= 2 && k < 5;
          expect(fields.solid[studioSmokeCellIndex(spec, i, j, k)] !== 0).toBe(inside);
        }
      }
    }
  });

  it("박스는 격자 밖으로 나가도 잘려서 안전하다", () => {
    const state = createStudioSmokeState({ nx: 6, ny: 6, nz: 6 });
    const touched = fillStudioSmokeSolidBox(state, {
      minX: -100,
      maxX: 100,
      minY: -100,
      maxY: 100,
      minZ: -100,
      maxZ: 100,
    });
    expect(touched).toBe(6 * 6 * 6);
    expect(countStudioSmokeSolidCells(state)).toBe(216);
  });

  it("구는 반지름 안 셀만 solid 이고 solid=false 로 되돌릴 수 있다", () => {
    const state = createStudioSmokeState({ nx: 12, ny: 12, nz: 12 });
    fillStudioSmokeSolidSphere(state, 6, 6, 6, 3);
    const count = countStudioSmokeSolidCells(state);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(12 ** 3);
    const { spec, fields } = state;
    // 중심은 solid, 모서리는 아니다.
    expect(fields.solid[studioSmokeCellIndex(spec, 6, 6, 6)]).toBe(1);
    expect(fields.solid[studioSmokeCellIndex(spec, 0, 0, 0)]).toBe(0);
    fillStudioSmokeSolidSphere(state, 6, 6, 6, 3, false);
    expect(countStudioSmokeSolidCells(state)).toBe(0);
  });

  it("슬래브는 축 하나만 잘라내고 나머지 축은 전부 덮는다", () => {
    const state = createStudioSmokeState({ nx: 8, ny: 8, nz: 8 });
    fillStudioSmokeSolidSlab(state, "y", 0, 2);
    expect(countStudioSmokeSolidCells(state)).toBe(8 * 2 * 8);
    const { spec, fields } = state;
    for (let k = 0; k < spec.nz; k += 1) {
      for (let i = 0; i < spec.nx; i += 1) {
        expect(fields.solid[studioSmokeCellIndex(spec, i, 0, k)]).toBe(1);
        expect(fields.solid[studioSmokeCellIndex(spec, i, 1, k)]).toBe(1);
        expect(fields.solid[studioSmokeCellIndex(spec, i, 2, k)]).toBe(0);
      }
    }
  });

  it("resetStudioSmokeFields 는 solid 마스크를 보존한 채 나머지를 0 으로 만든다", () => {
    const state = createStudioSmokeState({ nx: 6, ny: 6, nz: 6 });
    fillStudioSmokeSolidSlab(state, "y", 0, 1);
    state.fields.density.fill(3);
    state.fields.u.fill(9);
    const solidBefore = countStudioSmokeSolidCells(state);
    resetStudioSmokeFields(state.fields);
    expect(countStudioSmokeSolidCells(state)).toBe(solidBefore);
    expect(Array.from(state.fields.density).every((value) => value === 0)).toBe(true);
    expect(Array.from(state.fields.u).every((value) => value === 0)).toBe(true);
  });
});

describe("studio-smoke-grid: 해상도 프리셋", () => {
  it("id 가 유일하고 offline 플래그가 실제 셀 수 게이트와 일치한다", () => {
    const ids = STUDIO_SMOKE_RESOLUTIONS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of STUDIO_SMOKE_RESOLUTIONS) {
      const cells = preset.nx * preset.ny * preset.nz;
      expect(preset.offline).toBe(cells > STUDIO_SMOKE_INTERACTIVE_MAX_CELLS);
      expect(preset.label.length).toBeGreaterThan(0);
      // offline=false 프리셋은 플래그 없이 만들어져야 하고, true 는 던져야 한다.
      if (preset.offline) {
        expect(() => createStudioSmokeGridSpec({ nx: preset.nx, ny: preset.ny, nz: preset.nz })).toThrow();
      } else {
        expect(() =>
          createStudioSmokeGridSpec({ nx: preset.nx, ny: preset.ny, nz: preset.nz }),
        ).not.toThrow();
      }
    }
  });
});
