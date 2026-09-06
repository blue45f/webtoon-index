import { describe, expect, it } from "vitest";

import {
  buildStudioLift3dDepthBands,
  buildStudioLift3dDepthField,
  smoothStudioLift3dHeights,
  studioLift3dDistanceField,
  studioLift3dShadingField,
} from "./studio-lift3d-depth";
import {
  extractStudioLift3dMask,
  resampleStudioLift3dImage,
  type StudioLift3dMask,
} from "./studio-lift3d-mask";
import { discImage, verticalGradientImage } from "./studio-lift3d.test-fixture";

function solidMask(width: number, height: number, inset: number): StudioLift3dMask {
  const cells = new Uint8Array(width * height);
  for (let y = inset; y < height - inset; y += 1) {
    for (let x = inset; x < width - inset; x += 1) cells[y * width + x] = 1;
  }
  return {
    width,
    height,
    cells,
    bounds: { minX: inset, minY: inset, maxX: width - inset - 1, maxY: height - inset - 1 },
    coverage: ((width - inset * 2) * (height - inset * 2)) / (width * height),
    mode: "alpha",
    warnings: [],
  };
}

describe("Studio Lift 3D 깊이장", () => {
  it("거리장이 윤곽에서 0, 안쪽으로 갈수록 커진다", () => {
    const mask = solidMask(21, 21, 2);
    const distance = studioLift3dDistanceField(mask.cells, 21, 21);

    expect(distance[0]).toBe(0);
    // 윤곽 바로 안쪽 셀은 1픽셀 거리.
    expect(distance[2 * 21 + 2]).toBeCloseTo(1, 6);
    // 17×17 사각형의 중심 내접 거리는 9픽셀.
    expect(distance[10 * 21 + 10]).toBeCloseTo(9, 6);
  });

  it("격자 밖을 배경으로 취급해 화면에 잘린 피사체도 그 변에서 닫힌다", () => {
    const width = 9;
    const height = 9;
    const cells = new Uint8Array(width * height).fill(1);
    const distance = studioLift3dDistanceField(cells, width, height);

    expect(distance[0]).toBeCloseTo(1, 6);
    expect(distance[4 * width + 4]).toBeCloseTo(5, 6);
  });

  it("round 프로파일은 윤곽에서 0, 가장 두꺼운 곳에서 1 을 준다", () => {
    const mask = solidMask(25, 25, 2);
    const grid = resampleStudioLift3dImage(discImage(25), 25);
    const field = buildStudioLift3dDepthField(mask, grid, { profile: "round", smoothing: 0 });

    expect(field.heights[2 * 25 + 2]).toBeCloseTo(0, 6);
    expect(field.heights[12 * 25 + 12]).toBeCloseTo(1, 6);
    // 원형 단면이라 절반 거리에서 이미 높이가 절반을 크게 넘는다(납작하지 않다).
    expect(field.heights[7 * 25 + 12]).toBeGreaterThan(0.8);
  });

  it("slab 프로파일은 얇은 베벨만 남기고 곧바로 최대 두께에 도달한다", () => {
    const mask = solidMask(25, 25, 2);
    const grid = resampleStudioLift3dImage(discImage(25), 25);
    const field = buildStudioLift3dDepthField(mask, grid, { profile: "slab", smoothing: 0 });

    expect(field.heights[2 * 25 + 2]).toBeCloseTo(0, 6);
    expect(field.heights[6 * 25 + 12]).toBeCloseTo(1, 6);
  });

  it("명암장을 피사체 안쪽 범위로 정규화한다", () => {
    const source = verticalGradientImage(32);
    const grid = resampleStudioLift3dImage(source, 32);
    const mask = extractStudioLift3dMask(grid, { mode: "full" });
    const shading = studioLift3dShadingField(grid, mask.cells);

    expect(shading[0]).toBeCloseTo(0, 6);
    expect(shading[31 * 32 + 16]).toBeCloseTo(1, 6);
  });

  it("relief 프로파일은 밝은 면을 앞으로 내보내고 invert 로 뒤집힌다", () => {
    const source = verticalGradientImage(32);
    const grid = resampleStudioLift3dImage(source, 32);
    const mask = extractStudioLift3dMask(grid, { mode: "full" });

    const lit = buildStudioLift3dDepthField(mask, grid, { profile: "relief", smoothing: 0 });
    const inverted = buildStudioLift3dDepthField(mask, grid, {
      profile: "relief",
      smoothing: 0,
      invertRelief: true,
    });

    const bottom = 31 * 32 + 16;
    const top = 16;
    expect(lit.heights[bottom]!).toBeGreaterThan(lit.heights[top]!);
    expect(inverted.heights[bottom]!).toBeLessThan(inverted.heights[top]!);
  });

  it("평활은 봉합선(윤곽 접촉 셀)의 높이 0 을 건드리지 않는다", () => {
    const mask = solidMask(21, 21, 2);
    const heights = new Float64Array(21 * 21);
    for (let index = 0; index < heights.length; index += 1) {
      heights[index] = mask.cells[index] === 1 ? 1 : 0;
    }
    heights[2 * 21 + 2] = 0;

    const smoothed = smoothStudioLift3dHeights(heights, mask.cells, 21, 21, 4, true);

    expect(smoothed[2 * 21 + 2]).toBe(0);
    expect(smoothed[10 * 21 + 10]).toBeCloseTo(1, 6);
  });

  it("같은 입력에 같은 깊이장을 준다(결정론)", () => {
    const grid = resampleStudioLift3dImage(discImage(64), 48);
    const mask = extractStudioLift3dMask(grid, { mode: "alpha" });
    const first = buildStudioLift3dDepthField(mask, grid, { profile: "round", smoothing: 2 });
    const second = buildStudioLift3dDepthField(mask, grid, { profile: "round", smoothing: 2 });

    expect(Array.from(first.heights)).toEqual(Array.from(second.heights));
  });

  it("밴드는 마스크 셀을 정확히 한 번씩 나눠 갖는다", () => {
    // 한때는 밴드를 한 칸씩 부풀려 경계 사각형을 양쪽 카드에 다 넣었다. 구멍은 막혔지만 깊이가
    // 셀 단위로 번갈아 나오는 원화에서 그 한 칸이 밴드를 마스크 전체로 넓혀, 불투명 카드끼리
    // 서로를 가려 시차가 사라졌다. 지금은 셀이 겹치지 않는다 — 경계는 면 단위로 나눈다.
    const grid = resampleStudioLift3dImage(verticalGradientImage(64), 32);
    const mask = extractStudioLift3dMask(grid, { mode: "full" });
    const depth = buildStudioLift3dDepthField(mask, grid, { profile: "relief", smoothing: 0 });

    const bands = buildStudioLift3dDepthBands(mask, depth, 5);

    const seen = new Int32Array(mask.width * mask.height);
    for (const band of bands) {
      for (let index = 0; index < band.cells.length; index += 1) seen[index]! += band.cells[index]!;
    }
    let inside = 0;
    for (let index = 0; index < mask.cells.length; index += 1) {
      inside += mask.cells[index]!;
      // 피사체 셀은 정확히 하나, 배경 셀은 하나도 아닌 밴드에 속한다.
      expect(seen[index]).toBe(mask.cells[index]);
    }
    expect(inside).toBeGreaterThan(0);
    expect(bands.reduce((sum, band) => sum + band.cellCount, 0)).toBe(inside);
  });

  it("깊이가 셀 단위로 번갈아도 한 밴드가 마스크를 통째로 삼키지 않는다", () => {
    // 이것이 부풀리기를 걷어낸 이유다. 체커보드에서는 모든 셀이 모든 밴드와 체비쇼프 거리 1
    // 안에 있어, 부풀린 밴드가 저마다 마스크 전체(100%)를 덮었다.
    const side = 24;
    const mask = solidMask(side, side, 0);
    const heights = new Float64Array(side * side);
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        heights[y * side + x] = ((x % 2) + 2 * (y % 2) + 0.5) / 4;
      }
    }

    const bands = buildStudioLift3dDepthBands(
      mask,
      { width: side, height: side, heights, maxDistance: 4 },
      4,
    );

    expect(bands).toHaveLength(4);
    for (const band of bands) {
      // 네 밴드가 고르게 나눠 가지므로 어느 하나도 마스크의 절반을 넘지 않는다.
      expect(band.cellCount).toBeLessThan((side * side) / 2);
    }
  });

  it("밴드는 마스크 밖으로 새어 나가지 않는다", () => {
    const grid = resampleStudioLift3dImage(discImage(64), 32);
    const mask = extractStudioLift3dMask(grid, { mode: "alpha" });
    const depth = buildStudioLift3dDepthField(mask, grid, { profile: "round", smoothing: 0 });

    for (const band of buildStudioLift3dDepthBands(mask, depth, 4)) {
      for (let index = 0; index < band.cells.length; index += 1) {
        if (band.cells[index] === 1) expect(mask.cells[index]).toBe(1);
      }
    }
  });
});
