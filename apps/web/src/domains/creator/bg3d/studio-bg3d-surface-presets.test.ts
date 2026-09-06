import { describe, expect, it } from "vitest";

import { DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE } from "./studio-bg3d-scene-document";
import {
  STUDIO_BG3D_SURFACE_PRESETS,
  buildStudioBg3dSurfacePresetOverride,
  isStudioBg3dSurfacePresetId,
  resolveStudioBg3dSurfaceMaterialProps,
  spreadStudioBg3dSurfaceMaterialProps,
} from "./studio-bg3d-surface-presets";

describe("STUDIO_BG3D_SURFACE_PRESETS", () => {
  it("프리셋 id는 유일하고 한글 라벨·설명을 가진다", () => {
    expect(STUDIO_BG3D_SURFACE_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(STUDIO_BG3D_SURFACE_PRESETS.map((preset) => preset.id)).size).toBe(
      STUDIO_BG3D_SURFACE_PRESETS.length,
    );
    for (const preset of STUDIO_BG3D_SURFACE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  it("패치는 roughness·metalness 0..1 한도와 양수 반투명 계수를 벗어나지 않는다", () => {
    for (const preset of STUDIO_BG3D_SURFACE_PRESETS) {
      if (preset.patch.roughness !== null) {
        expect(preset.patch.roughness).toBeGreaterThanOrEqual(0);
        expect(preset.patch.roughness).toBeLessThanOrEqual(1);
      }
      if (preset.patch.metalness !== null) {
        expect(preset.patch.metalness).toBeGreaterThanOrEqual(0);
        expect(preset.patch.metalness).toBeLessThanOrEqual(1);
      }
      if (preset.patch.emissiveIntensity !== null) {
        expect(preset.patch.emissiveIntensity).toBeGreaterThan(0);
      }
      expect(preset.patch.opacityMultiplier).toBeGreaterThan(0);
      expect(preset.patch.opacityMultiplier).toBeLessThanOrEqual(1);
    }
  });
});

describe("buildStudioBg3dSurfacePresetOverride", () => {
  it("알려진 프리셋은 기본 오버라이드 위에 패치를 얹은 완전한 객체를 돌려준다", () => {
    const chrome = buildStudioBg3dSurfacePresetOverride("chrome");
    expect(chrome).toEqual({
      ...DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE,
      roughness: 0.08,
      metalness: 1,
    });
    expect(chrome?.colorMode).toBe("original");
    expect(chrome?.wireframe).toBe(false);
    expect(Object.isFrozen(DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE)).toBe(true);
  });

  it("유리는 반투명 계수를, 네온은 발광 색·강도를 함께 설정한다", () => {
    expect(buildStudioBg3dSurfacePresetOverride("glass")?.opacityMultiplier).toBeLessThan(1);
    const neon = buildStudioBg3dSurfacePresetOverride("neon");
    expect(neon?.emissiveColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(neon?.emissiveIntensity).toBeGreaterThan(1);
  });

  it("모르는 id는 null이다", () => {
    expect(buildStudioBg3dSurfacePresetOverride("nope")).toBeNull();
    expect(isStudioBg3dSurfacePresetId("chrome")).toBe(true);
    expect(isStudioBg3dSurfacePresetId("nope")).toBe(false);
  });
});

describe("resolveStudioBg3dSurfaceMaterialProps", () => {
  it("오버라이드가 없으면 빈 소품이다", () => {
    expect(resolveStudioBg3dSurfaceMaterialProps(undefined)).toEqual({});
  });

  it("null 필드는 생략하고 실측값만 옮긴다", () => {
    const matte = resolveStudioBg3dSurfaceMaterialProps({
      ...DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE,
      roughness: 0.85,
      metalness: 0,
    });
    expect(matte).toEqual({ roughness: 0.85, metalness: 0 });
    expect(matte.emissive).toBeUndefined();
    expect(matte.opacity).toBeUndefined();
  });

  it("발광은 강도가 있을 때만 색과 함께 옮겨진다", () => {
    const neon = resolveStudioBg3dSurfaceMaterialProps({
      ...DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE,
      emissiveColor: "#fff3d6",
      emissiveIntensity: 2.2,
    });
    expect(neon.emissive).toBe("#fff3d6");
    expect(neon.emissiveIntensity).toBe(2.2);

    const unlitEmissive = resolveStudioBg3dSurfaceMaterialProps({
      ...DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE,
      emissiveColor: "#fff3d6",
      emissiveIntensity: null,
    });
    expect(unlitEmissive.emissive).toBeUndefined();
  });

  it("반투명·와이어프레임이 스프레드 소품으로 전달된다", () => {
    const glass = resolveStudioBg3dSurfaceMaterialProps({
      ...DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE,
      opacityMultiplier: 0.35,
    });
    expect(glass.opacity).toBe(0.35);

    const glassSpread = spreadStudioBg3dSurfaceMaterialProps(glass);
    expect(glassSpread.transparent).toBe(true);
    expect(glassSpread.opacity).toBe(0.35);
    expect(glassSpread.wireframe).toBeUndefined();

    const wireSpread = spreadStudioBg3dSurfaceMaterialProps(
      resolveStudioBg3dSurfaceMaterialProps({
        ...DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE,
        wireframe: true,
      }),
    );
    expect(wireSpread.wireframe).toBe(true);
    expect(wireSpread.transparent).toBeUndefined();
  });
});
