import { describe, expect, it } from "vitest";

import { extractStudioLift3dMask, resampleStudioLift3dImage } from "./studio-lift3d-mask";
import {
  STUDIO_LIFT3D_SYMMETRY_CONFIDENT_SCORE,
  findStudioLift3dSymmetryAxis,
  symmetrizeStudioLift3dHeights,
} from "./studio-lift3d-symmetry";
import { discImage } from "./studio-lift3d.test-fixture";

import type { StudioLift3dMask } from "./studio-lift3d-mask";

function maskFrom(width: number, height: number, cells: Uint8Array): StudioLift3dMask {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let filled = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (cells[y * width + x] === 0) continue;
      filled += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    width,
    height,
    cells,
    bounds: maxX < 0 ? null : { minX, minY, maxX, maxY },
    coverage: filled / (width * height),
    mode: "alpha",
    warnings: [],
  };
}

describe("Studio Lift 3D 대칭 축", () => {
  it("격자를 벗어난 거울상까지 합집합에 넣어 점수를 부풀리지 않는다", () => {
    // `.#.#####` 를 축 5 에서 접으면 열 1 의 거울상이 열 9 로 격자 밖에 떨어진다. 그 셀을
    // 합집합에서 빠뜨리면 어긋남 하나를 한 번만 세어 5/6 = 0.833 이 되고, 0.82 문턱을 넘어
    // 비대칭 실루엣에 대칭 보정이 걸린다. 참값은 5/7 = 0.714 다.
    const width = 8;
    const height = 4;
    const row = [0, 1, 0, 1, 1, 1, 1, 1];
    const cells = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) cells[y * width + x] = row[x]!;
    }

    const found = findStudioLift3dSymmetryAxis(maskFrom(width, height, cells));

    expect(found).not.toBeNull();
    if (found === null) return;
    // 최적 축이 5 가 아닐 수도 있지만, 어떤 축을 고르든 부풀린 0.833 을 넘어서는 안 된다.
    expect(found.score).toBeLessThan(0.83);
    expect(found.confident).toBe(false);
  });

  it("원반의 축을 중심에서 반 칸 안으로 찾아낸다", () => {
    const grid = resampleStudioLift3dImage(discImage(64), 48);
    const mask = extractStudioLift3dMask(grid, { mode: "alpha" });
    const symmetry = findStudioLift3dSymmetryAxis(mask);

    expect(symmetry).not.toBeNull();
    if (symmetry === null) return;
    const center = (mask.bounds!.minX + mask.bounds!.maxX) / 2;
    expect(Math.abs(symmetry.axisX - center)).toBeLessThanOrEqual(0.5);
    expect(symmetry.score).toBeGreaterThan(0.95);
    expect(symmetry.confident).toBe(true);
  });

  it("중심에서 벗어난 대칭 형상의 축도 그 형상 위에서 찾는다", () => {
    // 왼쪽에 치우친 대칭 사각형. 무게중심이 곧 대칭 축이다.
    const width = 40;
    const height = 20;
    const cells = new Uint8Array(width * height);
    for (let y = 5; y < 15; y += 1) {
      for (let x = 6; x < 17; x += 1) cells[y * width + x] = 1;
    }
    const symmetry = findStudioLift3dSymmetryAxis(maskFrom(width, height, cells));

    expect(symmetry).not.toBeNull();
    if (symmetry === null) return;
    expect(symmetry.axisX).toBeCloseTo(11, 5);
    expect(symmetry.score).toBeCloseTo(1, 5);
  });

  it("좌우가 다른 실루엣은 낮은 점수로 대칭 보정을 말린다", () => {
    // 오른쪽으로만 뻗은 팔 — 어떤 축으로 접어도 겹치지 않는 부분이 크게 남는다.
    const width = 40;
    const height = 20;
    const cells = new Uint8Array(width * height);
    for (let y = 6; y < 14; y += 1) {
      for (let x = 8; x < 16; x += 1) cells[y * width + x] = 1;
    }
    for (let y = 9; y < 11; y += 1) {
      for (let x = 16; x < 34; x += 1) cells[y * width + x] = 1;
    }
    const symmetry = findStudioLift3dSymmetryAxis(maskFrom(width, height, cells));

    expect(symmetry).not.toBeNull();
    if (symmetry === null) return;
    expect(symmetry.score).toBeLessThan(STUDIO_LIFT3D_SYMMETRY_CONFIDENT_SCORE);
    expect(symmetry.confident).toBe(false);
  });

  it("빈 마스크에는 축이 없다", () => {
    expect(findStudioLift3dSymmetryAxis(maskFrom(8, 8, new Uint8Array(64)))).toBeNull();
  });

  it("좌우 높이를 축 기준으로 평균 낸다", () => {
    const width = 7;
    const height = 1;
    const cells = new Uint8Array(width * height).fill(1);
    const mask = maskFrom(width, height, cells);
    const heights = Float64Array.from([0, 0, 0, 1, 0, 0, 1]);

    const full = symmetrizeStudioLift3dHeights(heights, mask, 3, 1);
    // x=0 과 x=6 이 짝. 값은 0 과 1 이므로 둘 다 0.5 가 된다.
    expect(full[0]).toBeCloseTo(0.5, 6);
    expect(full[6]).toBeCloseTo(0.5, 6);
    // 축 위의 셀은 자기 자신과 짝이라 값이 그대로다.
    expect(full[3]).toBeCloseTo(1, 6);

    const half = symmetrizeStudioLift3dHeights(heights, mask, 3, 0.5);
    expect(half[0]).toBeCloseTo(0.25, 6);
    expect(symmetrizeStudioLift3dHeights(heights, mask, 3, 0)).toBe(heights);
  });

  it("거울상이 실루엣 밖이면 그 셀은 건드리지 않는다", () => {
    const width = 7;
    const cells = Uint8Array.from([0, 0, 0, 1, 1, 1, 1]);
    const mask = maskFrom(width, 1, cells);
    const heights = Float64Array.from([0, 0, 0, 0.4, 0.6, 0.8, 1]);

    // 축 5 기준: x=6 의 짝은 x=4(안쪽) — 섞인다. x=3 의 짝은 x=7(격자 밖) — 그대로.
    const out = symmetrizeStudioLift3dHeights(heights, mask, 5, 1);
    expect(out[3]).toBeCloseTo(0.4, 6);
    expect(out[6]).toBeCloseTo(0.8, 6);
  });
});
