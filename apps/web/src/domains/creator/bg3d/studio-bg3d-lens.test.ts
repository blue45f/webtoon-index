import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  computeStudioBg3dTwoPointPerspective,
  isStudioBg3dTwoPointPerspectiveActive,
  STUDIO_BG3D_LENS_MAX_FOCAL_MM,
  STUDIO_BG3D_LENS_MIN_FOCAL_MM,
  STUDIO_BG3D_LENS_PRESETS,
  studioBg3dFocalLengthToFovDegrees,
  studioBg3dFovDegreesToFocalLength,
} from "./studio-bg3d-lens";

describe("초점거리 ↔ 세로 화각 매핑", () => {
  it("알려진 값: 24mm→53.13°, 12mm→90°, 50mm→26.99°", () => {
    expect(studioBg3dFocalLengthToFovDegrees(24)).toBeCloseTo(53.130_102, 4);
    expect(studioBg3dFocalLengthToFovDegrees(12)).toBeCloseTo(90, 10);
    expect(studioBg3dFocalLengthToFovDegrees(50)).toBeCloseTo(26.991_465, 4);
  });

  it("왕복 변환이 한도 안에서 항등이다", () => {
    for (const focal of [8, 16, 24, 35, 50, 85, 135]) {
      expect(studioBg3dFovDegreesToFocalLength(studioBg3dFocalLengthToFovDegrees(focal))).toBeCloseTo(focal, 8);
    }
    for (const fov of [10.2, 20, 50, 90, 112]) {
      expect(studioBg3dFocalLengthToFovDegrees(studioBg3dFovDegreesToFocalLength(fov))).toBeCloseTo(fov, 8);
    }
  });

  it("비정상·범위 밖 입력은 한도로 눌린다", () => {
    expect(studioBg3dFocalLengthToFovDegrees(Number.NaN)).toBeCloseTo(studioBg3dFocalLengthToFovDegrees(50), 10);
    expect(studioBg3dFocalLengthToFovDegrees(1)).toBe(studioBg3dFocalLengthToFovDegrees(STUDIO_BG3D_LENS_MIN_FOCAL_MM));
    expect(studioBg3dFocalLengthToFovDegrees(999)).toBe(studioBg3dFocalLengthToFovDegrees(STUDIO_BG3D_LENS_MAX_FOCAL_MM));
    // 문서 fov 정규화 범위(10–120°)를 벗어나지 않는다.
    expect(studioBg3dFocalLengthToFovDegrees(STUDIO_BG3D_LENS_MIN_FOCAL_MM)).toBeLessThanOrEqual(120);
    expect(studioBg3dFocalLengthToFovDegrees(STUDIO_BG3D_LENS_MAX_FOCAL_MM)).toBeGreaterThanOrEqual(10);
  });

  it("프리셋 7종의 mm가 전부 슬라이더 한도 안이다", () => {
    expect(STUDIO_BG3D_LENS_PRESETS).toHaveLength(7);
    for (const preset of STUDIO_BG3D_LENS_PRESETS) {
      expect(preset.focalLengthMm).toBeGreaterThanOrEqual(STUDIO_BG3D_LENS_MIN_FOCAL_MM);
      expect(preset.focalLengthMm).toBeLessThanOrEqual(STUDIO_BG3D_LENS_MAX_FOCAL_MM);
    }
  });
});

/** view offset을 적용한 three 카메라로 월드 점을 NDC로 투영한다(실측 회귀용). */
function projectWithCamera(
  position: readonly [number, number, number],
  target: readonly [number, number, number],
  fovDegrees: number,
  lensShiftY: number,
  point: readonly [number, number, number],
): THREE.Vector3 {
  const camera = new THREE.PerspectiveCamera(fovDegrees, 1, 0.1, 200);
  camera.position.set(...(position as [number, number, number]));
  camera.lookAt(new THREE.Vector3(...(target as [number, number, number])));
  if (lensShiftY !== 0) {
    camera.setViewOffset(1_000, 1_000, 0, lensShiftY * 1_000, 1_000, 1_000);
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return new THREE.Vector3(...(point as [number, number, number])).project(camera);
}

describe("computeStudioBg3dTwoPointPerspective", () => {
  const view = {
    position: [6, 2, 8] as const,
    target: [0, 5, 0] as const,
    fovDegrees: 50,
  };

  it("올려다보는 카메라를 수평화하고 세로 시프트를 만든다", () => {
    const result = computeStudioBg3dTwoPointPerspective(view);
    expect(result).not.toBeNull();
    expect(result!.target[1]).toBe(view.position[1]);
    expect(result!.target[0]).toBe(view.target[0]);
    expect(result!.target[2]).toBe(view.target[2]);
    // 위를 보던 카메라(Δy>0) → 음수 시프트(창을 위로 올려 타깃을 프레임 안으로).
    expect(result!.lensShiftY).toBeLessThan(0);
  });

  it("실측 회귀: 보정 후 수직 모서리가 화면에서 정확히 수직이 된다", () => {
    const result = computeStudioBg3dTwoPointPerspective(view)!;
    // 원점 근처 수직 모서리(빌딩 코너)의 위·아래 점
    const bottom = [1.5, 0, 1.5] as const;
    const top = [1.5, 6, 1.5] as const;
    // 보정 전(올려다보는 카메라): 수직 모서리의 NDC x가 위아래에서 서로 다르다(수렴 왜곡).
    const beforeBottom = projectWithCamera(view.position, view.target, view.fovDegrees, 0, bottom);
    const beforeTop = projectWithCamera(view.position, view.target, view.fovDegrees, 0, top);
    expect(Math.abs(beforeTop.x - beforeBottom.x)).toBeGreaterThan(0.01);
    // 보정 후: 같은 모서리의 NDC x가 일치한다(2점 투시).
    const afterBottom = projectWithCamera(view.position, result.target, view.fovDegrees, result.lensShiftY, bottom);
    const afterTop = projectWithCamera(view.position, result.target, view.fovDegrees, result.lensShiftY, top);
    expect(afterTop.x).toBeCloseTo(afterBottom.x, 10);
  });

  it("실측 회귀: 원래 타깃의 화면 세로 위치가 보존된다(중앙에 있던 피사체가 화면 밖으로 밀리지 않음)", () => {
    const result = computeStudioBg3dTwoPointPerspective(view)!;
    const before = projectWithCamera(view.position, view.target, view.fovDegrees, 0, view.target);
    const after = projectWithCamera(
      view.position,
      result.target,
      view.fovDegrees,
      result.lensShiftY,
      view.target,
    );
    expect(before.y).toBeCloseTo(0, 10); // 타깃은 정의상 화면 중앙
    expect(after.y).toBeCloseTo(0, 3); // tan 근사가 아닌 정확식이므로 세로 중앙 복원
    expect(after.x).toBeCloseTo(before.x, 6);
  });

  it("내려다보는 카메라는 양수 시프트가 된다", () => {
    const result = computeStudioBg3dTwoPointPerspective({
      position: [4, 9, 6],
      target: [0, 0.5, 0],
      fovDegrees: 50,
    })!;
    expect(result.lensShiftY).toBeGreaterThan(0);
    expect(result.target[1]).toBe(9);
  });

  it("정수직 시점(수평 거리 0)은 null로 실패-닫힘한다", () => {
    expect(
      computeStudioBg3dTwoPointPerspective({ position: [0, 10, 0], target: [0, 0, 0], fovDegrees: 50 }),
    ).toBeNull();
  });

  it("극단 피치도 문서 lensShift 한도(±2) 안으로 클램프된다", () => {
    const result = computeStudioBg3dTwoPointPerspective({
      position: [0.2, 0, 0.2],
      target: [0, 40, 0],
      fovDegrees: 20,
    });
    expect(result).not.toBeNull();
    expect(Math.abs(result!.lensShiftY)).toBeLessThanOrEqual(2);
  });
});

describe("isStudioBg3dTwoPointPerspectiveActive", () => {
  it("수평 시선 + 세로 시프트 조합일 때만 참", () => {
    expect(
      isStudioBg3dTwoPointPerspectiveActive({
        position: [0, 2, 5],
        target: [0, 2, 0],
        lensShift: [0, -0.2],
      }),
    ).toBe(true);
    expect(
      isStudioBg3dTwoPointPerspectiveActive({ position: [0, 2, 5], target: [0, 2, 0], lensShift: [0, 0] }),
    ).toBe(false);
    expect(
      isStudioBg3dTwoPointPerspectiveActive({ position: [0, 2, 5], target: [0, 4, 0], lensShift: [0, -0.2] }),
    ).toBe(false);
    expect(
      isStudioBg3dTwoPointPerspectiveActive({ position: [0, 2, 5], target: [0, 2, 0] }),
    ).toBe(false);
  });
});
