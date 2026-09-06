import { describe, expect, it } from "vitest";

import {
  buildStudioBg3dScaleGuideParts,
  computeStudioBg3dScaleGuideHeightRange,
  STUDIO_BG3D_SCALE_GUIDE_HEIGHT_M,
} from "./studio-bg3d-scale-guide";

describe("buildStudioBg3dScaleGuideParts", () => {
  it("실루엣은 발바닥 y=0, 정수리 y=1.6m를 정확히 채운다", () => {
    const parts = buildStudioBg3dScaleGuideParts();
    const [min, max] = computeStudioBg3dScaleGuideHeightRange(parts);
    expect(min).toBeCloseTo(0, 10);
    expect(max).toBeCloseTo(STUDIO_BG3D_SCALE_GUIDE_HEIGHT_M, 10);
  });

  it("파츠 구성이 결정적이고 값이 전부 유한하다", () => {
    const parts = buildStudioBg3dScaleGuideParts();
    expect(parts).toEqual(buildStudioBg3dScaleGuideParts());
    expect(parts.map((part) => part.name)).toEqual(["머리", "몸통", "왼다리", "오른다리", "왼팔", "오른팔"]);
    for (const part of parts) {
      expect(part.position.every(Number.isFinite)).toBe(true);
      expect(part.scale.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
    }
  });

  it("머리(구)는 지름 = scale.y 규약으로 정수리가 1.6에 정확히 닿는다", () => {
    const head = buildStudioBg3dScaleGuideParts().find((part) => part.name === "머리")!;
    expect(head.shape).toBe("sphere");
    expect(head.position[1] + head.scale[1] / 2).toBeCloseTo(STUDIO_BG3D_SCALE_GUIDE_HEIGHT_M, 10);
  });

  it("팔·다리는 좌우 대칭이다", () => {
    const parts = buildStudioBg3dScaleGuideParts();
    const leftLeg = parts.find((part) => part.name === "왼다리")!;
    const rightLeg = parts.find((part) => part.name === "오른다리")!;
    expect(leftLeg.position[0]).toBeCloseTo(-rightLeg.position[0], 10);
    expect(leftLeg.position[1]).toBe(rightLeg.position[1]);
    const leftArm = parts.find((part) => part.name === "왼팔")!;
    const rightArm = parts.find((part) => part.name === "오른팔")!;
    expect(leftArm.position[0]).toBeCloseTo(-rightArm.position[0], 10);
  });
});
