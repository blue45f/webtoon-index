import { describe, expect, it } from "vitest";

import {
  STUDIO_EDITABLE_MESH_LIMITS,
  diagnoseStudioEditableMesh,
  hashStudioEditableMesh,
  studioEditableMeshStats,
  studioEditableMeshToTriangleSoup,
} from "../studio-editable-half-edge-mesh";

import { STUDIO_LIFT3D_LIMITS } from "./studio-lift3d-contract";
import {
  STUDIO_LIFT3D_MAX_DEPTH_BANDS,
  buildStudioLift3dDepthField,
  studioLift3dBandBuckets,
} from "./studio-lift3d-depth";
import {
  extractStudioLift3dMask,
  resampleStudioLift3dImage,
  type StudioLift3dMask,
} from "./studio-lift3d-mask";
import {
  buildStudioLift3dGeometry,
  countStudioLift3dCardDepthGaps,
  countStudioLift3dPlannedQuads,
  partitionStudioLift3dBandFaces,
  maxStudioLift3dResolutionForLayers,
  normalizeStudioLift3dPositions,
} from "./studio-lift3d-mesh";
import {
  discImage,
  signedVolume,
  verticalGradientImage,
} from "./studio-lift3d.test-fixture";

/** 밴드 분할 불변식을 훑을 깊이 모양들. 매끄러운 것부터 병리적인 것까지. */
const DEPTH_SHAPES: ReadonlyArray<readonly [string, (x: number, y: number, side: number) => number]> = [
  ["세로 그라데이션", (_x, y, side) => y / side],
  ["동심 고리", (x, y, side) => Math.min(1, Math.hypot(x - side / 2, y - side / 2) / (side / 2))],
  ["부드러운 노이즈", (x, y) => 0.5 + 0.5 * Math.sin(x / 9) * Math.cos(y / 11)],
  // 부풀리기 시절 카드가 마스크의 74.5% / 100% 를 덮던 두 입력.
  ["대각 줄무늬", (x, y) => ((x + 3 * y) % 12) / 12],
  ["체커보드", (x, y) => ((x % 2) + 2 * (y % 2)) / 4],
];

function depthFieldOf(
  side: number,
  heightAt: (x: number, y: number, side: number) => number,
): { width: number; height: number; heights: Float64Array; maxDistance: number } {
  const heights = new Float64Array(side * side);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) heights[y * side + x] = heightAt(x, y, side);
  }
  return { width: side, height: side, heights, maxDistance: side / 2 };
}

/** 한 밴드 안에서 대각으로만 이어진 사각형 쌍의 수. */
function countPinches(present: Uint8Array, width: number): number {
  let count = 0;
  for (let y = 1; y < width; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const nw = present[(y - 1) * width + (x - 1)]!;
      const ne = present[(y - 1) * width + x]!;
      const sw = present[y * width + (x - 1)]!;
      const se = present[y * width + x]!;
      if ((nw === 1 && se === 1 && ne === 0 && sw === 0)
        || (ne === 1 && sw === 1 && nw === 0 && se === 0)) count += 1;
    }
  }
  return count;
}

/** 사각형 하나가 쓰는 코너 수와 편집 메시의 코너 예산. 예산 계산을 테스트에서도 같은 말로 쓴다. */
const QUAD_CORNERS = 4;
const CORNER_BUDGET = STUDIO_EDITABLE_MESH_LIMITS.maxEdges;

function maskFromCells(width: number, height: number, cells: Uint8Array): StudioLift3dMask {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (cells[y * width + x] === 0) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  let filled = 0;
  for (let index = 0; index < cells.length; index += 1) filled += cells[index]!;
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

function discGeometry(size: number, targetHeight = 1.7) {
  const grid = resampleStudioLift3dImage(discImage(size), size);
  const mask = extractStudioLift3dMask(grid, { mode: "alpha" });
  const depth = buildStudioLift3dDepthField(mask, grid, { profile: "round", smoothing: 1 });
  return buildStudioLift3dGeometry(mask, depth, {
    mode: "inflate",
    depthScale: 0.3,
    targetHeight,
  });
}

describe("Studio Lift 3D 메시 빌더", () => {
  it("inflate 는 열린 변이 없는 닫힌 solid 를 만든다", () => {
    const built = discGeometry(64);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const stats = studioEditableMeshStats(built.value.mesh);
    expect(stats.boundaryEdgeCount).toBe(0);
    expect(stats.faceCount).toBeGreaterThan(100);
  });

  it("면이 모두 바깥을 향한다(부호 있는 부피가 양수)", () => {
    const built = discGeometry(64);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const soup = studioEditableMeshToTriangleSoup(built.value.mesh);
    expect(signedVolume(soup.positions, soup.indices)).toBeGreaterThan(0);
  });

  it("UV 가 정점과 1:1 로 대응하고 0..1 안에 있다", () => {
    const built = discGeometry(48);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.value.uvs).toHaveLength(built.value.mesh.vertices.length);
    for (const uv of built.value.uvs) {
      expect(uv.u).toBeGreaterThanOrEqual(0);
      expect(uv.u).toBeLessThanOrEqual(1);
      expect(uv.v).toBeGreaterThanOrEqual(0);
      expect(uv.v).toBeLessThanOrEqual(1);
    }
  });

  it("요청한 키에 맞춰 스케일하고 바닥(y=0)에 접지시킨다", () => {
    const built = discGeometry(48, 1.7);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.value.bounds.min.y).toBeCloseTo(0, 6);
    expect(built.value.bounds.max.y).toBeCloseTo(1.7, 6);
    // 원반이라 가로 폭도 키와 비슷하고, 두께는 그 30% 근처다.
    expect(built.value.bounds.max.z - built.value.bounds.min.z).toBeGreaterThan(0.2);
    expect(built.value.bounds.max.z - built.value.bounds.min.z).toBeLessThan(0.7);
  });

  it("두께 비율을 키우면 실제로 더 두꺼워진다", () => {
    const thin = discGeometry(48);
    const grid = resampleStudioLift3dImage(discImage(48), 48);
    const mask = extractStudioLift3dMask(grid, { mode: "alpha" });
    const depth = buildStudioLift3dDepthField(mask, grid, { profile: "round", smoothing: 1 });
    const thick = buildStudioLift3dGeometry(mask, depth, {
      mode: "inflate",
      depthScale: 0.6,
      targetHeight: 1.7,
    });

    expect(thin.ok && thick.ok).toBe(true);
    if (!thin.ok || !thick.ok) return;
    const thinDepth = thin.value.bounds.max.z - thin.value.bounds.min.z;
    const thickDepth = thick.value.bounds.max.z - thick.value.bounds.min.z;
    expect(thickDepth).toBeGreaterThan(thinDepth * 1.8);
  });

  it("대각으로만 이어진 꼬집힘을 잘라 위상을 지킨다", () => {
    // 두 덩어리가 격자 정점 하나에서만 만난다 — 그 정점 주변 면이 두 팬으로 갈라져
    // 비다양체가 되는 고전적 배치다.
    const width = 9;
    const height = 9;
    const cells = new Uint8Array(width * height);
    for (let y = 1; y <= 4; y += 1) {
      for (let x = 1; x <= 4; x += 1) cells[y * width + x] = 1;
    }
    for (let y = 4; y <= 7; y += 1) {
      for (let x = 4; x <= 7; x += 1) cells[y * width + x] = 1;
    }
    const mask = maskFromCells(width, height, cells);
    const grid = resampleStudioLift3dImage(discImage(width), width);
    const depth = buildStudioLift3dDepthField(mask, grid, { profile: "slab", smoothing: 0 });

    const built = buildStudioLift3dGeometry(mask, depth, {
      mode: "inflate",
      depthScale: 0.3,
      targetHeight: 1,
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.warnings.map((warning) => warning.code)).toContain("pinch-faces-dropped");
    expect(studioEditableMeshStats(built.value.mesh).boundaryEdgeCount).toBe(0);
  });

  it("정점이 전부 테두리인 얇은 형상도 닫힌 solid 로 만든다", () => {
    // 폭이 두 칸뿐이라 내부 정점이 하나도 없다. 테두리에도 최소 두께를 주고 옆벽으로 막으므로
    // 거절 대상이 아니라 얇은 solid 가 나와야 한다.
    const width = 12;
    const height = 12;
    const cells = new Uint8Array(width * height);
    for (let x = 2; x < 10; x += 1) {
      cells[5 * width + x] = 1;
      cells[6 * width + x] = 1;
    }
    const mask = maskFromCells(width, height, cells);
    const grid = resampleStudioLift3dImage(discImage(width), width);
    const depth = buildStudioLift3dDepthField(mask, grid, { profile: "round", smoothing: 0 });

    const built = buildStudioLift3dGeometry(mask, depth, {
      mode: "inflate",
      depthScale: 0.3,
      targetHeight: 1,
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(studioEditableMeshStats(built.value.mesh).boundaryEdgeCount).toBe(0);
    const soup = studioEditableMeshToTriangleSoup(built.value.mesh);
    expect(signedVolume(soup.positions, soup.indices)).toBeGreaterThan(0);
  });

  it("가는 돌기가 붙어 있어도 비다양체 변을 만들지 않는다", () => {
    // 이전 방식은 테두리 정점을 앞뒤가 공유했다. 폭 두 칸짜리 팔·꼬리·머리카락에서는 모든
    // 정점이 테두리라, 이웃한 두 사각형이 공유하는 변이 half-edge 를 네 번 쓰며 깨졌다.
    const width = 16;
    const height = 16;
    const cells = new Uint8Array(width * height);
    for (let y = 2; y < 8; y += 1) {
      for (let x = 2; x < 8; x += 1) cells[y * width + x] = 1;
    }
    for (let y = 4; y < 6; y += 1) {
      for (let x = 8; x < 14; x += 1) cells[y * width + x] = 1;
    }
    const mask = maskFromCells(width, height, cells);
    const grid = resampleStudioLift3dImage(discImage(width), width);
    const depth = buildStudioLift3dDepthField(mask, grid, { profile: "round", smoothing: 0 });

    const built = buildStudioLift3dGeometry(mask, depth, {
      mode: "inflate",
      depthScale: 0.3,
      targetHeight: 1,
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const errors = diagnoseStudioEditableMesh(built.value.mesh)
      .filter((diagnostic) => diagnostic.severity === "error");
    expect(errors).toEqual([]);
    expect(studioEditableMeshStats(built.value.mesh).boundaryEdgeCount).toBe(0);
  });

  it("유한하지 않은 두께 값을 예외 대신 사유 코드로 거절한다", () => {
    const grid = resampleStudioLift3dImage(discImage(32), 32);
    const mask = extractStudioLift3dMask(grid, { mode: "alpha" });
    const depth = buildStudioLift3dDepthField(mask, grid, { profile: "round", smoothing: 0 });

    for (const depthScale of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const built = buildStudioLift3dGeometry(mask, depth, {
        mode: "inflate",
        depthScale,
        targetHeight: 1,
      });
      expect(built.ok).toBe(false);
      if (built.ok) continue;
      expect(built.code).toBe("invalid-option");
    }
  });

  it("코너 예산을 넘으면 예외 대신 사유 코드로 거절한다", () => {
    // 편집 메시 preflight 는 면 개수가 아니라 코너 합을 maxEdges 와 비교한다. 면 개수만 보면
    // 여기서 통과시킨 뒤 그 preflight 가 예외를 던진다.
    const side = 260;
    const cells = new Uint8Array(side * side).fill(1);
    const mask = maskFromCells(side, side, cells);
    const grid = resampleStudioLift3dImage(discImage(64), 64);
    const depth = {
      width: side,
      height: side,
      heights: new Float64Array(side * side).fill(1),
      maxDistance: side / 2,
    };
    void grid;

    const built = buildStudioLift3dGeometry(mask, depth, {
      mode: "inflate",
      depthScale: 0.3,
      targetHeight: 1,
    });

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.code).toBe("budget-exceeded");
  });

  it("relief 는 변위된 앞면·평평한 뒷판·옆벽으로 닫힌 슬래브를 만든다", () => {
    const grid = resampleStudioLift3dImage(discImage(48), 48);
    const mask = extractStudioLift3dMask(grid, { mode: "full" });
    const depth = buildStudioLift3dDepthField(mask, grid, { profile: "relief", smoothing: 0 });

    const built = buildStudioLift3dGeometry(mask, depth, {
      mode: "relief",
      depthScale: 0.1,
      baseScale: 0.02,
      targetHeight: 6,
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const stats = studioEditableMeshStats(built.value.mesh);
    expect(stats.boundaryEdgeCount).toBe(0);
    const soup = studioEditableMeshToTriangleSoup(built.value.mesh);
    expect(signedVolume(soup.positions, soup.indices)).toBeGreaterThan(0);
    expect(built.value.bounds.max.z).toBeGreaterThan(built.value.bounds.min.z);
  });

  it("앞/뒤 비율을 옮겨도 총 두께는 그대로다", () => {
    const grid = resampleStudioLift3dImage(discImage(48), 48);
    const mask = extractStudioLift3dMask(grid, { mode: "alpha" });
    const depth = buildStudioLift3dDepthField(mask, grid, { profile: "round", smoothing: 1 });
    const build = (frontRatio: number) => buildStudioLift3dGeometry(mask, depth, {
      mode: "inflate",
      depthScale: 0.4,
      targetHeight: 1.7,
      frontRatio,
    });

    const even = build(0.5);
    const forward = build(0.8);
    expect(even.ok && forward.ok).toBe(true);
    if (!even.ok || !forward.ok) return;

    const depthOf = (bounds: { min: { z: number }; max: { z: number } }) =>
      bounds.max.z - bounds.min.z;
    // 총 두께는 같고, 무게중심만 앞으로 옮겨간다(정규화가 XZ 를 원점에 맞추므로 두께로 비교).
    expect(depthOf(forward.value.bounds)).toBeCloseTo(depthOf(even.value.bounds), 5);
    expect(hashStudioEditableMesh(forward.value.mesh))
      .not.toBe(hashStudioEditableMesh(even.value.mesh));
  });

  it("parallax 는 밴드마다 떨어진 카드를 세우고 각각 닫아 둔다", () => {
    const grid = resampleStudioLift3dImage(verticalGradientImage(64), 48);
    const mask = extractStudioLift3dMask(grid, { mode: "full" });
    const depth = buildStudioLift3dDepthField(mask, grid, { profile: "relief", smoothing: 0 });

    const built = buildStudioLift3dGeometry(mask, depth, {
      mode: "parallax",
      depthScale: 0.4,
      targetHeight: 6,
      layerBands: 5,
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.mode).toBe("parallax");
    expect(built.value.layerCount).toBe(5);
    // 조각끼리 정점을 나누지 않으므로 전부 닫혀 있어야 한다.
    expect(studioEditableMeshStats(built.value.mesh).boundaryEdgeCount).toBe(0);
    expect(
      diagnoseStudioEditableMesh(built.value.mesh)
        .filter((diagnostic) => diagnostic.severity === "error"),
    ).toEqual([]);
    const soup = studioEditableMeshToTriangleSoup(built.value.mesh);
    expect(signedVolume(soup.positions, soup.indices)).toBeGreaterThan(0);
  });

  it("밴드를 늘리면 층이 늘고 깊이 범위는 유지된다", () => {
    const grid = resampleStudioLift3dImage(verticalGradientImage(64), 48);
    const mask = extractStudioLift3dMask(grid, { mode: "full" });
    const depth = buildStudioLift3dDepthField(mask, grid, { profile: "relief", smoothing: 0 });
    const build = (layerBands: number) => buildStudioLift3dGeometry(mask, depth, {
      mode: "parallax",
      depthScale: 0.4,
      targetHeight: 6,
      layerBands,
    });

    const few = build(3);
    const many = build(9);
    expect(few.ok && many.ok).toBe(true);
    if (!few.ok || !many.ok) return;
    expect(many.value.layerCount).toBeGreaterThan(few.value.layerCount);
    // 카드는 밴드 중앙에 놓이므로 층이 늘어도 전체 깊이 범위는 비슷하다.
    const range = (bounds: { min: { z: number }; max: { z: number } }) =>
      bounds.max.z - bounds.min.z;
    expect(range(many.value.bounds)).toBeGreaterThan(range(few.value.bounds) * 0.8);
  });

  it("같은 입력이면 같은 메시 해시가 나온다", () => {
    const first = discGeometry(48);
    const second = discGeometry(48);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(hashStudioEditableMesh(first.value.mesh))
      .toBe(hashStudioEditableMesh(second.value.mesh));
  });

  it("두께가 0 이면 부피 없는 메시를 만들지 않고 거절한다", () => {
    // depthScale 0 은 앞뒤 껍질을 같은 평면에 겹치고 옆벽 넓이도 0 으로 만든다.
    // 그런데도 경계 변이 없어 "닫힌 solid" 로 보고되므로, 만들기 전에 막아야 한다.
    const grid = resampleStudioLift3dImage(discImage(48), 32);
    const mask = extractStudioLift3dMask(grid, { mode: "alpha" });
    const depth = buildStudioLift3dDepthField(mask, grid, { profile: "round", smoothing: 0 });

    for (const mode of ["inflate", "parallax"] as const) {
      const built = buildStudioLift3dGeometry(mask, depth, {
        mode,
        depthScale: 0,
        targetHeight: 1,
        layerBands: 4,
      });

      expect(built.ok).toBe(false);
      if (built.ok) return;
      expect(built.code).toBe("invalid-option");
    }
  });

  it("부조는 뒷판이 두께를 주므로 depthScale 0 도 받는다", () => {
    const grid = resampleStudioLift3dImage(discImage(48), 32);
    const mask = extractStudioLift3dMask(grid, { mode: "full" });
    const depth = buildStudioLift3dDepthField(mask, grid, { profile: "relief", smoothing: 0 });

    const built = buildStudioLift3dGeometry(mask, depth, {
      mode: "relief",
      depthScale: 0,
      baseScale: 0.05,
      targetHeight: 1,
    });

    expect(built.ok).toBe(true);
  });

  it("레이어 상한은 밴드가 늘수록 낮아지고, 한 장짜리는 기존 상한 그대로다", () => {
    const single = maxStudioLift3dResolutionForLayers(1);
    expect(single).toBeGreaterThanOrEqual(STUDIO_LIFT3D_LIMITS.maxResolution);

    let previous = single;
    for (let bands = 2; bands <= STUDIO_LIFT3D_MAX_DEPTH_BANDS; bands += 1) {
      const cap = maxStudioLift3dResolutionForLayers(bands);
      expect(cap).toBeLessThanOrEqual(previous);
      expect(cap).toBeGreaterThan(STUDIO_LIFT3D_LIMITS.minResolution);
      previous = cap;
    }
    expect(previous).toBeLessThan(STUDIO_LIFT3D_LIMITS.maxResolution);
  });

  it("동심 고리처럼 경계가 긴 밴드도 상한 해상도에서 예산 안이다", () => {
    // 상한 공식의 여유는 옆벽 4uB 를 가정한다. 가로 띠보다 경계가 긴 동심 고리가 그 가정을
    // 시험하는 모양이라, 최대 레이어와 함께 걸어 본다.
    const bands = STUDIO_LIFT3D_MAX_DEPTH_BANDS;
    const side = Math.min(
      maxStudioLift3dResolutionForLayers(bands),
      STUDIO_LIFT3D_LIMITS.maxResolution,
    );
    const mask = maskFromCells(side, side, new Uint8Array(side * side).fill(1));
    const heights = new Float64Array(side * side);
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        heights[y * side + x] = Math.min(
          1,
          Math.hypot(x - side / 2, y - side / 2) / (side / 2),
        );
      }
    }

    const planned = countStudioLift3dPlannedQuads(
      mask,
      { width: side, height: side, heights, maxDistance: side / 2 },
      { mode: "parallax", layerBands: bands },
    );

    expect(planned * QUAD_CORNERS).toBeLessThanOrEqual(CORNER_BUDGET);
  });

  it("상한 해상도에서 최대 레이어를 쌓아도 면 예산 안에 들어온다", () => {
    // 화면 전체가 피사체인 배경이 사각형을 가장 많이 만든다. 여기서 통과하지 못하면
    // 슬라이더 두 개를 각각 최대로 올린 조합이 사용자에게는 늘 실패로만 보인다.
    const bands = STUDIO_LIFT3D_MAX_DEPTH_BANDS;
    const side = Math.min(
      maxStudioLift3dResolutionForLayers(bands),
      STUDIO_LIFT3D_LIMITS.maxResolution,
    );
    const grid = resampleStudioLift3dImage(verticalGradientImage(256), side);
    const mask = extractStudioLift3dMask(grid, { mode: "full" });
    const depth = buildStudioLift3dDepthField(mask, grid, { profile: "relief", smoothing: 0 });

    const built = buildStudioLift3dGeometry(mask, depth, {
      mode: "parallax",
      depthScale: 0.25,
      targetHeight: 6,
      layerBands: bands,
    });

    expect(built.ok).toBe(true);
  });

  it("밴드가 잘게 번갈아 나오면 정점을 쌓기 전에 예산 초과로 돌려보낸다", () => {
    // 해상도 상한은 밴드 경계 길이가 O(uB) 라고 보고 세운 값이다. 밴드가 화면 전체에서 잘게
    // 번갈아 나오면 옆벽이 면적에 비례해(O(u²B)) 그 가정이 깨진다. 그때도 수십만 개를 만든
    // 뒤가 아니라 격자 단계에서 정확히 세어 돌려보내야 한다.
    const bands = 12;
    const side = maxStudioLift3dResolutionForLayers(bands);
    const cells = new Uint8Array(side * side).fill(1);
    const mask = maskFromCells(side, side, cells);
    const heights = new Float64Array(side * side);
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        heights[y * side + x] = (((x + 3 * y) % bands) + 0.5) / bands;
      }
    }

    const built = buildStudioLift3dGeometry(
      mask,
      { width: side, height: side, heights, maxDistance: side / 2 },
      { mode: "parallax", depthScale: 0.25, targetHeight: 6, layerBands: bands },
    );

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.code).toBe("budget-exceeded");
    // 해상도만 지목하면 레이어를 줄이는 쪽이 더 나은 경우에 손잡이를 못 찾는다.
    expect(built.detail).toContain("해상도");
    expect(built.detail).toContain("레이어");
  });

  it("방출 전에 센 사각형 수가 실제로 나온 면 수와 정확히 같다", () => {
    // 예산은 방출 **전에** 센 값으로 판정한다. 그 카운터가 실제 방출량과 갈라지면, 적게 세면
    // 예산을 통과한 메시가 createStudioEditableMeshFromPolygons 에서 예외로 끝나고, 많이 세면
    // 만들 수 있는 조합을 괜히 거절한다.
    const grid = resampleStudioLift3dImage(verticalGradientImage(64), 48);
    const mask = extractStudioLift3dMask(grid, { mode: "full" });
    const depth = buildStudioLift3dDepthField(mask, grid, { profile: "relief", smoothing: 0 });

    for (const mode of ["relief", "inflate", "parallax"] as const) {
      const layerBands = mode === "parallax" ? 6 : 1;
      const planned = countStudioLift3dPlannedQuads(mask, depth, { mode, layerBands });
      const built = buildStudioLift3dGeometry(mask, depth, {
        mode,
        depthScale: 0.2,
        targetHeight: 4,
        layerBands,
      });

      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(planned).toBe(built.value.mesh.faces.length);
      expect(built.value.quadCount).toBe(planned);
    }
  });

  it("잘게 번갈아 나오는 밴드는 해상도 상한만으로 예측되지 않는다", () => {
    // 상한 공식은 밴드 경계 길이가 O(uB) 라는 가정 위에 있다. 이 입력은 그 가정을 깨뜨리므로
    // 상한 안쪽 해상도인데도 예산을 넘는다 — 정확한 사전 집계가 필요한 이유다.
    const bands = 12;
    const side = maxStudioLift3dResolutionForLayers(bands);
    const cells = new Uint8Array(side * side).fill(1);
    const mask = maskFromCells(side, side, cells);
    const heights = new Float64Array(side * side);
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        heights[y * side + x] = (((x + 3 * y) % bands) + 0.5) / bands;
      }
    }
    const depth = { width: side, height: side, heights, maxDistance: side / 2 };

    const smooth = countStudioLift3dPlannedQuads(
      mask,
      { ...depth, heights: new Float64Array(side * side).fill(0.5) },
      { mode: "parallax", layerBands: bands },
    );
    const noisy = countStudioLift3dPlannedQuads(mask, depth, { mode: "parallax", layerBands: bands });

    expect(smooth * QUAD_CORNERS).toBeLessThanOrEqual(CORNER_BUDGET);
    expect(noisy * QUAD_CORNERS).toBeGreaterThan(CORNER_BUDGET);
  });

  it("카드는 어떤 깊이 모양에서도 마스크 사각형을 정확히 한 번씩 나눠 갖는다", () => {
    // 시차 카드가 서로를 가리지 않는 근거다. 면이 두 카드에 들어가지 않으므로(겹침 0) 앞 카드가
    // 뒤 카드를 덮을 수 없고, 빠지는 면이 없으므로(덮임 100%) 구멍도 없다. 매끄러운 깊이만이
    // 아니라 잡음·병리적 깊이에서도 성립해야 하는 불변식이라 모양을 훑는다.
    for (const [label, heightAt] of DEPTH_SHAPES) {
      for (const bandCount of [2, 5, STUDIO_LIFT3D_MAX_DEPTH_BANDS]) {
        const side = 40;
        const mask = maskFromCells(side, side, new Uint8Array(side * side).fill(1));
        const depth = depthFieldOf(side, heightAt);

        const faces = partitionStudioLift3dBandFaces(
          mask,
          studioLift3dBandBuckets(mask, depth, bandCount),
          bandCount,
        );

        expect(faces).toHaveLength(bandCount);
        const seen = new Int32Array((side - 1) * (side - 1));
        for (const band of faces) {
          for (let face = 0; face < band.length; face += 1) seen[face]! += band[face]!;
        }
        let orphans = 0;
        let shared = 0;
        for (let face = 0; face < seen.length; face += 1) {
          if (seen[face] === 0) orphans += 1;
          if (seen[face]! > 1) shared += 1;
        }

        expect({ label, bandCount, orphans, shared })
          .toEqual({ label, bandCount, orphans: 0, shared: 0 });
      }
    }
  });

  it("꼬집힘 옮기기는 결정론적이고 꼬집힘을 늘리지 않는다", () => {
    // 면을 버리지 않고 이웃 밴드로 옮겨 푸는 방식이라, 옮기다가 다른 자리에 꼬집힘을 만들거나
    // 두 자리가 서로를 밀어 진동할 수 있다. 최대 횟수로 종료는 보장되지만 **악화되지 않는지**는
    // 별개다. 잡음이 심한 깊이일수록 옮길 일이 많아 그쪽을 함께 본다.
    const side = 40;
    const bandCount = 8;
    for (const [label, heightAt] of DEPTH_SHAPES) {
      const mask = maskFromCells(side, side, new Uint8Array(side * side).fill(1));
      const depth = depthFieldOf(side, heightAt);
      const buckets = studioLift3dBandBuckets(mask, depth, bandCount);

      const first = partitionStudioLift3dBandFaces(mask, buckets, bandCount);
      const second = partitionStudioLift3dBandFaces(mask, buckets, bandCount);
      expect(first.map((band) => Array.from(band)))
        .toEqual(second.map((band) => Array.from(band)));

      // 옮기기 이전(순수 배정)과 이후의 꼬집힘을 견준다.
      const width = side - 1;
      const raw: Uint8Array[] = Array.from(
        { length: bandCount },
        () => new Uint8Array(width * width),
      );
      for (let j = 0; j < width; j += 1) {
        for (let i = 0; i < width; i += 1) {
          const corners = [
            buckets[j * side + i]!, buckets[j * side + i + 1]!,
            buckets[(j + 1) * side + i]!, buckets[(j + 1) * side + i + 1]!,
          ];
          raw[Math.max(...corners)]![j * width + i] = 1;
        }
      }
      const before = raw.reduce((sum, band) => sum + countPinches(band, width), 0);
      const after = first.reduce((sum, band) => sum + countPinches(band, width), 0);

      expect({ label, worsened: after > before }).toEqual({ label, worsened: false });
    }
  });

  it("잡음이 심한 깊이는 상한 해상도에서도 예외 없이 예산 초과로 거절된다", () => {
    // 상한은 매끄러운 깊이에 맞춘 보정값이지 상한이 아니다. 실제 비용은 밴드 경계의 길이로
    // 정해지고 그 길이는 리샘플 전에 알 수 없다. 그러니 넘는 입력이 반드시 있고, 그때 예외가
    // 아니라 두 손잡이를 짚는 사유 코드로 끝나는 것이 이 파이프라인의 계약이다.
    const bandCount = STUDIO_LIFT3D_MAX_DEPTH_BANDS;
    const side = Math.min(
      maxStudioLift3dResolutionForLayers(bandCount),
      STUDIO_LIFT3D_LIMITS.maxResolution,
    );
    const mask = maskFromCells(side, side, new Uint8Array(side * side).fill(1));

    const built = buildStudioLift3dGeometry(
      mask,
      depthFieldOf(side, (x, y) => ((x + 3 * y) % 12) / 12),
      { mode: "parallax", depthScale: 0.25, targetHeight: 6, layerBands: bandCount },
    );

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.code).toBe("budget-exceeded");
    expect(built.detail).toContain(`해상도(${side})`);
    // 살아남은 층이 아니라 요청한 층 수를 짚어야 사용자가 만질 손잡이를 안다.
    expect(built.detail).toContain(`레이어 수(${bandCount})`);
  });

  it("이웃 카드가 깊이에서 맞닿아 층 사이에 틈이 없다", () => {
    // 얇은 판을 각자의 밴드 중앙에만 띄우면 카드 사이 z 간격이 빈 공간이 된다. 정면에서는
    // 멀쩡하다가 카메라가 돌아가는 순간 밴드 경계마다 배경이 비친다 — 시차를 보려고 돌리는
    // 바로 그 움직임에서 갈라지는 셈이다.
    //
    // 맞닿았다면 카드 k 의 앞면과 카드 k+1 의 뒷면이 **같은 z** 다. 그러면 서로 다른 z 값의
    // 개수가 층 수 + 1 이 된다(떠 있으면 층마다 둘씩이라 2배가 된다).
    const side = 40;
    const bandCount = 6;
    const mask = maskFromCells(side, side, new Uint8Array(side * side).fill(1));

    const built = buildStudioLift3dGeometry(
      mask,
      depthFieldOf(side, (_x, y) => y / side),
      { mode: "parallax", depthScale: 0.4, targetHeight: 4, layerBands: bandCount },
    );

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const depths = [...new Set(
      built.value.mesh.vertices.map((vertex) => vertex.position.z.toFixed(9)),
    )];
    expect(built.value.layerCount).toBe(bandCount);
    expect(depths).toHaveLength(bandCount + 1);
  });

  it("면을 못 내는 밴드가 사이에 끼어도 이웃 카드는 서로 맞닿는다", () => {
    // 셀은 있지만 2×2 가 안 나와 면을 못 내는 밴드가 중간에 있을 수 있다. 그 유령을 이웃으로
    // 삼아 깊이를 잡으면, 밴드가 버려진 뒤 아무도 채우지 않는 z 구간이 남아 카메라를 돌릴 때
    // 갈라진다. 이웃은 **실제로 면을 내는** 카드여야 한다.
    const side = 24;
    const mask = maskFromCells(side, side, new Uint8Array(side * side).fill(1));
    const heights = new Float64Array(side * side);
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        // 위쪽 절반은 밴드 0, 아래쪽 절반은 밴드 2.
        heights[y * side + x] = y < side / 2 ? 0.1 : 0.9;
      }
    }
    // 가운데 밴드(1)에 외딴 셀 하나를, **더 높은** 밴드 한가운데 둔다. 면은 네 꼭짓점 중
    // 가장 앞 밴드가 가져가므로, 이 셀에 닿는 사각형은 전부 밴드 2 로 간다 — 밴드 1 은 셀만
    // 있고 면이 없는 유령이 된다.
    heights[16 * side + 6] = 0.5;

    const built = buildStudioLift3dGeometry(
      mask,
      { width: side, height: side, heights, maxDistance: side / 2 },
      { mode: "parallax", depthScale: 0.4, targetHeight: 4, layerBands: 3 },
    );

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // 밴드는 셋이지만 면을 내는 카드는 둘뿐이다.
    expect(built.value.layerCount).toBe(2);
    const depths = [...new Set(
      built.value.mesh.vertices.map((vertex) => vertex.position.z.toFixed(9)),
    )];
    // 맞닿았다면 서로 다른 z 는 층 수 + 1 = 3 이다. 유령을 이웃으로 삼으면 4 가 된다.
    expect(depths).toHaveLength(3);
  });

  it("사각형을 하나도 못 만드는 밴드는 층 수에서 뺀다", () => {
    // 한 칸 폭 부위에만 걸린 밴드는 부풀린 뒤에도 2×2 가 안 나와 정점이 하나도 안 나간다.
    // 그 껍질을 세어만 두면 존재하지 않는 층이 지표와 화면에 광고된다.
    const side = 16;
    const cells = new Uint8Array(side * side);
    for (let y = 2; y <= 8; y += 1) {
      for (let x = 2; x <= 8; x += 1) cells[y * side + x] = 1;
      // 본체와 떨어진 한 칸 폭 가시. 마스크가 여기서 한 칸이라 부풀려도 2×2 가 안 된다.
      cells[y * side + 12] = 1;
    }
    const mask = maskFromCells(side, side, cells);
    const heights = new Float64Array(side * side);
    for (let y = 2; y <= 8; y += 1) {
      for (let x = 2; x <= 8; x += 1) heights[y * side + x] = 0.9;
      heights[y * side + 12] = 0.1;
    }

    const built = buildStudioLift3dGeometry(
      mask,
      { width: side, height: side, heights, maxDistance: 4 },
      { mode: "parallax", depthScale: 0.3, targetHeight: 2, layerBands: 2 },
    );

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // 밴드는 둘이지만 면이 나오는 껍질은 하나뿐이다.
    expect(built.value.layerCount).toBe(1);
  });

  it("이 함수만 직접 불러도 비유한 레이어 수를 거절한다", () => {
    // 파이프라인을 거치지 않는 호출자가 있다(이 테스트 파일부터가 그렇다).
    // clampStudioLift3dBandCount 는 비유한 값을 조용히 1 로 떨어뜨리므로 여기서 막지 않으면
    // "카드 한 장짜리 시차 레이어" 가 parallax 로 성공해 버린다.
    const grid = resampleStudioLift3dImage(discImage(48), 32);
    const mask = extractStudioLift3dMask(grid, { mode: "alpha" });
    const depth = buildStudioLift3dDepthField(mask, grid, { profile: "round", smoothing: 0 });

    for (const layerBands of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      0,
      // 위쪽 한도도 같다. 조용히 조이면 요청한 층 수와 다른 결과가 성공으로 나간다.
      STUDIO_LIFT3D_MAX_DEPTH_BANDS + 1,
      // 분수도 마찬가지다. 반올림하면 1.5 가 2 로 올라가 위상이 조용히 바뀐다.
      1.5,
    ]) {
      const built = buildStudioLift3dGeometry(mask, depth, {
        mode: "parallax",
        depthScale: 0.3,
        targetHeight: 1,
        layerBands,
      });

      expect(built.ok).toBe(false);
      if (built.ok) return;
      expect(built.code).toBe("invalid-option");
    }
  });

  it("나눌 부피가 없으면 앞쪽 두께 비율이 먹히지 않는다고 알린다", () => {
    // 두 칸 폭 실루엣은 모든 정점이 테두리라 앞뒤 두께가 어디서나 같다. frontRatio 는 두 껍질을
    // 통째로 z 로 옮길 뿐이고, 정규화의 z 중심 맞추기가 그 이동을 곧바로 되돌린다. 슬라이더를
    // 끝까지 밀어도 화면이 그대로인데 아무 말이 없으면 사용자는 고장으로 읽는다.
    const side = 16;
    const cells = new Uint8Array(side * side);
    for (let y = 1; y < side - 1; y += 1) {
      cells[y * side + 7] = 1;
      cells[y * side + 8] = 1;
    }
    const mask = maskFromCells(side, side, cells);
    const depth = {
      width: side,
      height: side,
      heights: new Float64Array(side * side).fill(1),
      maxDistance: 1,
    };

    const shifted = buildStudioLift3dGeometry(mask, depth, {
      mode: "inflate",
      depthScale: 0.4,
      targetHeight: 2,
      frontRatio: 0.8,
    });
    const even = buildStudioLift3dGeometry(mask, depth, {
      mode: "inflate",
      depthScale: 0.4,
      targetHeight: 2,
      frontRatio: 0.5,
    });

    expect(shifted.ok && even.ok).toBe(true);
    if (!shifted.ok || !even.ok) return;
    expect(shifted.warnings.map((warning) => warning.code)).toContain("front-ratio-inert");
    // 앞뒤를 반씩 나눠 달라고 한 쪽은 옮길 것이 없으니 경고할 것도 없다.
    expect(even.warnings.map((warning) => warning.code)).not.toContain("front-ratio-inert");
    // 경고가 참말인지도 확인한다 — 두 결과의 z 가 실제로 같아야 한다.
    const zOf = (built: typeof shifted): number[] => (built.ok
      ? built.value.mesh.vertices.map((vertex) => vertex.position.z)
      : []);
    const left = zOf(shifted);
    const right = zOf(even);
    expect(left).toHaveLength(right.length);
    for (let index = 0; index < left.length; index += 1) {
      expect(left[index]!).toBeCloseTo(right[index]!, 12);
    }
  });

  it("안쪽 정점이 있으면 앞쪽 두께 비율이 형태를 실제로 바꾼다", () => {
    // 위 경고가 과잉이 아닌지 확인한다. 세 칸만 되어도 가운데 정점이 안쪽이 되어 부피가 생긴다.
    const side = 16;
    const cells = new Uint8Array(side * side);
    for (let y = 1; y < side - 1; y += 1) {
      for (let x = 6; x <= 9; x += 1) cells[y * side + x] = 1;
    }
    const mask = maskFromCells(side, side, cells);
    const depth = {
      width: side,
      height: side,
      heights: new Float64Array(side * side).fill(1),
      maxDistance: 2,
    };

    const built = buildStudioLift3dGeometry(mask, depth, {
      mode: "inflate",
      depthScale: 0.4,
      targetHeight: 2,
      frontRatio: 0.8,
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.warnings.map((warning) => warning.code)).not.toContain("front-ratio-inert");
  });

  it("정규화는 XZ 중심을 원점에 두고 균일 스케일만 쓴다", () => {
    const normalized = normalizeStudioLift3dPositions(
      [
        { x: 10, y: 4, z: 0 },
        { x: 14, y: 8, z: 2 },
      ],
      2,
    );

    // y 폭 4 → 2 이므로 균일 스케일 0.5. x 는 12, z 는 1 을 중심으로 접힌다.
    expect(normalized.bounds.min).toEqual({ x: -1, y: 0, z: -0.5 });
    expect(normalized.bounds.max).toEqual({ x: 1, y: 2, z: 0.5 });
    expect(normalized.positions[0]).toEqual({ x: -1, y: 0, z: -0.5 });
  });
});

/**
 * 세로로는 완만히 오르고 가로로는 **네 칸 주기로 뚝 끊기는** 깊이.
 *
 * 세로 경사가 모든 밴드를 채워 버려질 밴드가 없고, 가로 단차는 한 칸에서 서너 밴드를 건너뛴다.
 * 카드 순번이 2 이상 벌어지는 자리를 만들려면 이 둘이 **함께** 있어야 한다 — 순수한 경사는
 * 아무리 층을 잘게 잘라도 빈 밴드가 버려지면서 순번이 도로 이어 붙는다.
 */
function steppedDepthField(side: number): {
  width: number; height: number; heights: Float64Array; maxDistance: number;
} {
  const heights = new Float64Array(side * side);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const ramp = 0.45 * (y / (side - 1));
      const step = Math.floor(x / 2) % 2 === 0 ? 0 : 0.45;
      heights[y * side + x] = ramp + step;
    }
  }
  return { width: side, height: side, heights, maxDistance: side / 2 };
}

describe("시차 카드 사이의 깊이 틈", () => {
  it("순번이 이웃한 카드끼리는 z 에서 맞닿으므로 틈이 아니다", () => {
    // 2×1 면 두 장을 좌우로 놓고 각각 0번·1번 카드에 준다.
    const left = Uint8Array.from([1, 0]);
    const right = Uint8Array.from([0, 1]);

    expect(countStudioLift3dCardDepthGaps([left, right], 2, 1)).toEqual({
      crossings: 1,
      gaps: 0,
      maxGap: 0,
    });
  });

  it("옆으로 맞닿았는데 순번이 두 칸 벌어지면 그 경계를 센다", () => {
    const back = Uint8Array.from([1, 0]);
    const middle = Uint8Array.from([0, 0]);
    const front = Uint8Array.from([0, 1]);

    expect(countStudioLift3dCardDepthGaps([back, middle, front], 2, 1)).toEqual({
      crossings: 1,
      gaps: 1,
      maxGap: 2,
    });
  });

  it("밴드 번호가 아니라 **배열 순번**으로 센다", () => {
    // 같은 그림이지만 가운데 카드가 면을 하나도 내지 못해 방출에서 빠진 경우. 남은 두 장은
    // 순번상 이웃이라 실제로 맞닿는다 — 밴드 번호로 셌다면 여기서도 틈을 셌을 것이다.
    const back = Uint8Array.from([1, 0]);
    const front = Uint8Array.from([0, 1]);

    expect(countStudioLift3dCardDepthGaps([back, front], 2, 1).gaps).toBe(0);
  });

  it("한 카드 안쪽 경계는 분모에 넣지 않는다", () => {
    // 인접 사각형을 전부 세면 분모가 해상도의 제곱으로 늘어, 화면을 가르는 균열도 해상도를
    // 올릴수록 비율이 내려간다. 분모는 카드가 갈리는 경계여야 한다.
    const only = Uint8Array.from([1, 1]);

    expect(countStudioLift3dCardDepthGaps([only], 2, 1)).toEqual({
      crossings: 0,
      gaps: 0,
      maxGap: 0,
    });
  });

  it("면이 없는 격자는 경계가 없다", () => {
    expect(countStudioLift3dCardDepthGaps([], 0, 0)).toEqual({
      crossings: 0,
      gaps: 0,
      maxGap: 0,
    });
  });

  it("층수가 원화의 깊이 잔결보다 잘면 경고로 알린다", () => {
    const side = 24;
    const mask = maskFromCells(side, side, new Uint8Array(side * side).fill(1));

    const built = buildStudioLift3dGeometry(mask, steppedDepthField(side), {
      mode: "parallax",
      depthScale: 0.4,
      targetHeight: 3,
      layerBands: 8,
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const warning = built.warnings.find((entry) => entry.code === "layer-depth-gap");
    expect(warning).toBeDefined();
    // 사용자가 돌릴 수 있는 손잡이를 문구가 짚어야 한다.
    expect(warning?.message).toContain("레이어 수");
    expect(warning?.message).toContain("relief");
  });

  it("층수를 낮추면 단차가 한 층으로 합쳐져 경고가 사라진다", () => {
    const side = 24;
    const mask = maskFromCells(side, side, new Uint8Array(side * side).fill(1));

    const built = buildStudioLift3dGeometry(mask, steppedDepthField(side), {
      mode: "parallax",
      depthScale: 0.4,
      targetHeight: 3,
      layerBands: 2,
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.warnings.map((entry) => entry.code)).not.toContain("layer-depth-gap");
  });

  it("매끄러운 경사는 층을 끝까지 올려도 틈이 없다", () => {
    const side = 24;
    const mask = maskFromCells(side, side, new Uint8Array(side * side).fill(1));

    const built = buildStudioLift3dGeometry(mask, depthFieldOf(side, (_x, y) => y / (side - 1)), {
      mode: "parallax",
      depthScale: 0.4,
      targetHeight: 3,
      layerBands: STUDIO_LIFT3D_MAX_DEPTH_BANDS,
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.warnings.map((entry) => entry.code)).not.toContain("layer-depth-gap");
  });

  it("셀만 있고 면이 없는 유령 밴드를 순번으로 세지 않는다", () => {
    // 유령을 순번에 끼워 넣으면 실제로 맞닿는 두 카드가 두 칸 떨어져 보여, 멀쩡한 결과에
    // 틈 경고가 붙는다. 순번은 **면을 내는 카드**만 받는다.
    const side = 24;
    const mask = maskFromCells(side, side, new Uint8Array(side * side).fill(1));
    const heights = new Float64Array(side * side);
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        heights[y * side + x] = y < side / 2 ? 0.1 : 0.9;
      }
    }
    // 가운데 밴드에 외딴 셀 하나. 면은 가장 앞 밴드가 가져가므로 밴드 1 은 셀만 남는다.
    heights[16 * side + 6] = 0.5;

    const built = buildStudioLift3dGeometry(
      mask,
      { width: side, height: side, heights, maxDistance: side / 2 },
      { mode: "parallax", depthScale: 0.4, targetHeight: 4, layerBands: 3 },
    );

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.layerCount).toBe(2);
    expect(built.warnings.map((entry) => entry.code)).not.toContain("layer-depth-gap");
  });

  it("깊이가 딱 끊기는 원화는 빈 밴드가 버려져 두 카드가 맞닿는다", () => {
    const side = 24;
    const mask = maskFromCells(side, side, new Uint8Array(side * side).fill(1));
    // 0.05 와 0.95 두 층뿐인 절벽. 사이의 밴드는 셀이 없어 통째로 버려진다.
    const cliff = depthFieldOf(side, (x) => (x < side / 2 ? 0.05 : 0.95));

    const built = buildStudioLift3dGeometry(mask, cliff, {
      mode: "parallax",
      depthScale: 0.4,
      targetHeight: 3,
      layerBands: 12,
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.layerCount).toBe(2);
    expect(built.warnings.map((entry) => entry.code)).not.toContain("layer-depth-gap");
  });
});
