import { describe, expect, it } from "vitest";

import { buildStudioLift3dDepthField } from "./studio-lift3d-depth";
import { extractStudioLift3dMask, resampleStudioLift3dImage } from "./studio-lift3d-mask";
import {
  paintStudioLift3dDepthPreview,
  paintStudioLift3dMaskPreview,
} from "./studio-lift3d-preview-raster";
import { discImage } from "./studio-lift3d.test-fixture";

describe("Studio Lift 3D 2D 미리보기", () => {
  const grid = resampleStudioLift3dImage(discImage(64), 32);
  const mask = extractStudioLift3dMask(grid, { mode: "alpha" });
  const depth = buildStudioLift3dDepthField(mask, grid, { profile: "round", smoothing: 0 });

  it("마스크를 피사체/배경 두 색으로 굽고 항상 불투명하다", () => {
    const pixels = paintStudioLift3dMaskPreview(mask);

    expect(pixels).toHaveLength(mask.width * mask.height * 4);
    const center = (Math.floor(mask.height / 2) * mask.width + Math.floor(mask.width / 2)) * 4;
    expect(pixels[center]).toBeGreaterThan(200);
    expect(pixels[0]).toBeLessThan(40);
    for (let index = 3; index < pixels.length; index += 4) {
      expect(pixels[index]).toBe(255);
    }
  });

  it("깊이 램프가 얕은 곳과 깊은 곳을 다른 색으로 구분한다", () => {
    const pixels = paintStudioLift3dDepthPreview(mask, depth);
    const center = (Math.floor(mask.height / 2) * mask.width + Math.floor(mask.width / 2)) * 4;

    // 가장 두꺼운 중심은 램프의 밝은 끝, 배경은 어두운 상수색.
    expect(pixels[center]).toBeGreaterThan(200);
    expect(pixels[0]).toBe(18);
  });
});
