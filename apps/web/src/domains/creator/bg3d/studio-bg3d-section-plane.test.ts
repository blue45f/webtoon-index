import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  clampStudioBg3dSectionOffset,
  computeStudioBg3dSectionPlane,
  DEFAULT_STUDIO_BG3D_SECTION_PLANE_STATE,
  isPointKeptByStudioBg3dSectionPlane,
  STUDIO_BG3D_SECTION_AXES,
  STUDIO_BG3D_SECTION_OFFSET_LIMIT,
} from "./studio-bg3d-section-plane";

describe("computeStudioBg3dSectionPlane", () => {
  it("비활성화면 null(클리핑 해제)", () => {
    expect(computeStudioBg3dSectionPlane(DEFAULT_STUDIO_BG3D_SECTION_PLANE_STATE)).toBeNull();
    expect(computeStudioBg3dSectionPlane({ enabled: false, axis: "y", offset: 2, flip: true })).toBeNull();
  });

  it("y축 offset 2, flip=false: 위(y>2)를 잘라 실내가 보인다", () => {
    const plane = computeStudioBg3dSectionPlane({ enabled: true, axis: "y", offset: 2, flip: false })!;
    expect(plane.normal).toEqual([0, -1, 0]);
    expect(plane.constant).toBe(2);
    expect(isPointKeptByStudioBg3dSectionPlane(plane, [0, 1, 0])).toBe(true);
    expect(isPointKeptByStudioBg3dSectionPlane(plane, [0, 2, 0])).toBe(true); // 경계 유지
    expect(isPointKeptByStudioBg3dSectionPlane(plane, [0, 3, 0])).toBe(false);
  });

  it("flip=true는 반대쪽을 잘라낸다", () => {
    const plane = computeStudioBg3dSectionPlane({ enabled: true, axis: "y", offset: 2, flip: true })!;
    expect(plane.normal).toEqual([0, 1, 0]);
    expect(plane.constant).toBe(-2);
    expect(isPointKeptByStudioBg3dSectionPlane(plane, [0, 3, 0])).toBe(true);
    expect(isPointKeptByStudioBg3dSectionPlane(plane, [0, 1, 0])).toBe(false);
  });

  it("세 축 전부에서 해당 축만 잘린다", () => {
    for (const axis of STUDIO_BG3D_SECTION_AXES) {
      const plane = computeStudioBg3dSectionPlane({ enabled: true, axis, offset: -1.5, flip: false })!;
      const kept: [number, number, number] = [0, 0, 0];
      const cut: [number, number, number] = [0, 0, 0];
      const axisIndex = STUDIO_BG3D_SECTION_AXES.indexOf(axis);
      kept[axisIndex] = -2;
      cut[axisIndex] = 5;
      expect(isPointKeptByStudioBg3dSectionPlane(plane, kept)).toBe(true);
      expect(isPointKeptByStudioBg3dSectionPlane(plane, cut)).toBe(false);
    }
  });

  it("three.js Plane 계약과 일치한다(distanceToPoint 부호 실측)", () => {
    const equation = computeStudioBg3dSectionPlane({ enabled: true, axis: "z", offset: 4, flip: false })!;
    const plane = new THREE.Plane(new THREE.Vector3(...equation.normal), equation.constant);
    // three는 distance < 0 픽셀을 잘라낸다 — 우리의 "유지" 판정과 부호가 같아야 한다.
    expect(plane.distanceToPoint(new THREE.Vector3(0, 0, 3))).toBeGreaterThanOrEqual(0);
    expect(plane.distanceToPoint(new THREE.Vector3(0, 0, 5))).toBeLessThan(0);
    expect(isPointKeptByStudioBg3dSectionPlane(equation, [0, 0, 3])).toBe(true);
    expect(isPointKeptByStudioBg3dSectionPlane(equation, [0, 0, 5])).toBe(false);
  });

  it("오프셋은 한계로 클램프되고 비정상 입력은 0", () => {
    expect(clampStudioBg3dSectionOffset(999)).toBe(STUDIO_BG3D_SECTION_OFFSET_LIMIT);
    expect(clampStudioBg3dSectionOffset(-999)).toBe(-STUDIO_BG3D_SECTION_OFFSET_LIMIT);
    expect(clampStudioBg3dSectionOffset(Number.NaN)).toBe(0);
    expect(clampStudioBg3dSectionOffset("3" as never)).toBe(0);
    const plane = computeStudioBg3dSectionPlane({ enabled: true, axis: "x", offset: 999, flip: false })!;
    expect(plane.constant).toBe(STUDIO_BG3D_SECTION_OFFSET_LIMIT);
  });

  it("알 수 없는 축은 null로 실패-닫힘한다", () => {
    expect(
      computeStudioBg3dSectionPlane({ enabled: true, axis: "w" as never, offset: 0, flip: false }),
    ).toBeNull();
  });
});
