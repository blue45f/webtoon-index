import { describe, expect, it } from "vitest";

import {
  despeckleStudioLift3dMask,
  extractStudioLift3dMask,
  keepLargestStudioLift3dPart,
  resampleStudioLift3dImage,
  studioLift3dHasUsableAlpha,
  studioLift3dMaskBounds,
} from "./studio-lift3d-mask";
import { discImage, opaqueSquareImage } from "./studio-lift3d.test-fixture";

describe("Studio Lift 3D 실루엣 마스크", () => {
  it("작업 격자로 내려받을 때 종횡비와 알파를 유지한다", () => {
    const source = { ...discImage(64), width: 64, height: 64 };
    const grid = resampleStudioLift3dImage(source, 32);

    expect(grid.width).toBe(32);
    expect(grid.height).toBe(32);
    expect(grid.alpha).toHaveLength(32 * 32);
    // 중앙은 원반 안쪽이라 불투명, 모서리는 바깥이라 투명.
    expect(grid.alpha[16 * 32 + 16]!).toBeGreaterThan(0.99);
    expect(grid.alpha[0]!).toBe(0);
  });

  it("투명 픽셀의 검은 RGB 가 가장자리 색을 오염시키지 않는다", () => {
    const source = discImage(48, 0.4, { r: 255, g: 0, b: 0, a: 255 });
    const grid = resampleStudioLift3dImage(source, 24);
    const center = grid.height / 2;

    // 원반 경계에 걸친 셀을 훑어 가장 어두운 빨강 성분을 찾는다. 알파 가중 평균이 아니면
    // 여기서 0.5 근처까지 떨어진다(투명 픽셀의 검은색이 섞여서).
    let darkestRed = 1;
    for (let x = 0; x < grid.width; x += 1) {
      const index = Math.floor(center) * grid.width + x;
      if (grid.alpha[index]! > 0.05 && grid.alpha[index]! < 0.95) {
        darkestRed = Math.min(darkestRed, grid.color[index * 3]!);
      }
    }
    expect(darkestRed).toBeGreaterThan(0.9);
  });

  it("알파가 실루엣을 담고 있는지 판별한다", () => {
    expect(studioLift3dHasUsableAlpha(resampleStudioLift3dImage(discImage(48), 24))).toBe(true);
    expect(
      studioLift3dHasUsableAlpha(resampleStudioLift3dImage(opaqueSquareImage(48), 24)),
    ).toBe(false);
  });

  it("알파 모드에서 원반 실루엣을 면적 오차 10% 안으로 잡는다", () => {
    const grid = resampleStudioLift3dImage(discImage(96, 0.4), 48);
    const mask = extractStudioLift3dMask(grid, { mode: "alpha" });

    expect(mask.mode).toBe("alpha");
    expect(mask.coverage).toBeGreaterThan(Math.PI * 0.4 * 0.4 * 0.9);
    expect(mask.coverage).toBeLessThan(Math.PI * 0.4 * 0.4 * 1.1);
    expect(mask.bounds).not.toBeNull();
  });

  it("키 모드는 피사체 안쪽의 배경색 영역을 뚫지 않는다", () => {
    const grid = resampleStudioLift3dImage(opaqueSquareImage(80), 40);
    const mask = extractStudioLift3dMask(grid, { mode: "key" });

    expect(mask.mode).toBe("key");
    const center = Math.floor(mask.height / 2) * mask.width + Math.floor(mask.width / 2);
    // 정중앙은 배경과 같은 색이지만 사각형에 완전히 둘러싸여 있으므로 피사체로 남아야 한다.
    expect(mask.cells[center]).toBe(1);
    expect(mask.cells[0]).toBe(0);
  });

  it("auto 모드는 알파가 없으면 키 모드로 내려가고 그 사실을 경고한다", () => {
    const grid = resampleStudioLift3dImage(opaqueSquareImage(64), 32);
    const mask = extractStudioLift3dMask(grid, { mode: "auto" });

    expect(mask.mode).toBe("key");
    expect(mask.warnings.map((warning) => warning.code)).toContain("alpha-absent");
  });

  it("full 모드는 이미지 전체를 피사체로 삼는다", () => {
    const grid = resampleStudioLift3dImage(opaqueSquareImage(32), 16);
    const mask = extractStudioLift3dMask(grid, { mode: "full" });

    expect(mask.coverage).toBe(1);
    expect(mask.bounds).toEqual({ minX: 0, minY: 0, maxX: 15, maxY: 15 });
  });

  it("열림-닫힘으로 점 노이즈는 지우고 몸통은 보존한다", () => {
    const width = 12;
    const height = 12;
    const cells = new Uint8Array(width * height);
    for (let y = 3; y < 9; y += 1) {
      for (let x = 3; x < 9; x += 1) cells[y * width + x] = 1;
    }
    cells[1 * width + 1] = 1; // 고립된 점 하나

    const cleaned = despeckleStudioLift3dMask(cells, width, height);

    expect(cleaned[1 * width + 1]).toBe(0);
    expect(cleaned[5 * width + 5]).toBe(1);
    expect(studioLift3dMaskBounds(cleaned, width, height)).toEqual({
      minX: 3,
      minY: 3,
      maxX: 8,
      maxY: 8,
    });
  });

  it("가장 큰 연결 성분만 남기고 버린 비율을 보고한다", () => {
    const width = 10;
    const height = 10;
    const cells = new Uint8Array(width * height);
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) cells[y * width + x] = 1;
    }
    cells[9 * width + 9] = 1;

    const result = keepLargestStudioLift3dPart(cells, width, height);

    expect(result.cells[9 * width + 9]).toBe(0);
    expect(result.cells[0]).toBe(1);
    expect(result.droppedRatio).toBeCloseTo(1 / 37, 5);
  });
});
