import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_VRM_MTOON_CONTROLS,
  STUDIO_VRM_MTOON_CONTROLS_KIND,
  STUDIO_VRM_MTOON_CONTROLS_VERSION,
  STUDIO_VRM_MTOON_ORIGINAL_KEY,
  applyStudioVrmMtoonControls,
  applyStudioVrmMtoonControlsToMaterials,
  parseStudioVrmMtoonControls,
  resetStudioVrmMtoonControls,
  resolveStudioVrmMtoonOutlineWidthFactor,
  sanitizeStudioVrmMtoonControls,
  serializeStudioVrmMtoonControls,
  type StudioVrmMtoonControls,
  type StudioVrmMtoonOutlineWidthMode,
} from "./studio-vrm-mtoon-controls";

/** THREE.Color 의 구조적 대역. 실제 three 없이 유니폼 쓰기를 검증한다. */
class FakeColor {
  private value: number;

  constructor(hex = 0xffffff) {
    this.value = hex;
  }

  setHex(hex: number): this {
    this.value = hex;
    return this;
  }

  getHex(): number {
    return this.value;
  }
}

interface FakeMaterial {
  isMToonMaterial: boolean;
  outlineWidthMode: StudioVrmMtoonOutlineWidthMode;
  outlineWidthFactor: number;
  outlineColorFactor: FakeColor;
  outlineLightingMixFactor: number;
  shadeColorFactor: FakeColor;
  shadingShiftFactor: number;
  shadingToonyFactor: number;
  parametricRimColorFactor: FakeColor;
  rimLightingMixFactor: number;
  parametricRimFresnelPowerFactor: number;
  parametricRimLiftFactor: number;
  needsUpdate: boolean;
  userData: Record<string, unknown>;
}

function fakeMToon(overrides: Partial<FakeMaterial> = {}): FakeMaterial {
  return {
    isMToonMaterial: true,
    outlineWidthMode: "worldCoordinates",
    outlineWidthFactor: 0.001,
    outlineColorFactor: new FakeColor(0x334455),
    outlineLightingMixFactor: 1,
    shadeColorFactor: new FakeColor(0xaabbcc),
    shadingShiftFactor: -0.2,
    shadingToonyFactor: 0.4,
    parametricRimColorFactor: new FakeColor(0x111111),
    rimLightingMixFactor: 0.3,
    parametricRimFresnelPowerFactor: 2,
    parametricRimLiftFactor: 0.1,
    needsUpdate: false,
    userData: {},
    ...overrides,
  };
}

const FULL: StudioVrmMtoonControls = {
  kind: STUDIO_VRM_MTOON_CONTROLS_KIND,
  version: STUDIO_VRM_MTOON_CONTROLS_VERSION,
  outline: {
    enabled: true,
    mode: "screenCoordinates",
    worldWidthMeters: 0.004,
    screenWidthRatio: 0.002,
    color: "#101010",
    lightingMix: 0,
  },
  shading: { enabled: true, shadeColor: "#889099", shadingShift: 0.1, toony: 1 },
  rim: { enabled: true, color: "#ffeecc", mix: 0.5, fresnelPower: 3, lift: 0.2 },
};

describe("studio-vrm-mtoon-controls normalize", () => {
  it("clamps every numeric field into its documented range", () => {
    const controls = sanitizeStudioVrmMtoonControls({
      outline: {
        enabled: true,
        worldWidthMeters: 99,
        screenWidthRatio: -4,
        lightingMix: 5,
      },
      shading: { enabled: true, shadingShift: -7, toony: 3 },
      rim: { enabled: true, mix: -1, fresnelPower: 1000, lift: 9 },
    });
    expect(controls.outline.worldWidthMeters).toBe(0.05);
    expect(controls.outline.screenWidthRatio).toBe(0);
    expect(controls.outline.lightingMix).toBe(1);
    expect(controls.shading.shadingShift).toBe(-1);
    expect(controls.shading.toony).toBe(1);
    expect(controls.rim.mix).toBe(0);
    expect(controls.rim.fresnelPower).toBe(10);
    expect(controls.rim.lift).toBe(1);
  });

  it("falls back for bad colours, modes and non-numeric values", () => {
    const controls = sanitizeStudioVrmMtoonControls({
      outline: { mode: "diagonalCoordinates", color: "red" },
      shading: { shadeColor: "#abc", toony: "very" },
      rim: { color: 42, fresnelPower: Number.NaN },
    });
    expect(controls.outline.mode).toBe(DEFAULT_STUDIO_VRM_MTOON_CONTROLS.outline.mode);
    expect(controls.outline.color).toBe(DEFAULT_STUDIO_VRM_MTOON_CONTROLS.outline.color);
    expect(controls.shading.shadeColor).toBe(DEFAULT_STUDIO_VRM_MTOON_CONTROLS.shading.shadeColor);
    expect(controls.shading.toony).toBe(DEFAULT_STUDIO_VRM_MTOON_CONTROLS.shading.toony);
    expect(controls.rim.color).toBe(DEFAULT_STUDIO_VRM_MTOON_CONTROLS.rim.color);
    expect(controls.rim.fresnelPower).toBe(DEFAULT_STUDIO_VRM_MTOON_CONTROLS.rim.fresnelPower);
  });

  it("lowercases hex colours and keeps enabled strictly boolean", () => {
    const controls = sanitizeStudioVrmMtoonControls({
      outline: { enabled: "yes", color: "#AABBCC" },
      shading: { enabled: 1 },
      rim: { enabled: true },
    });
    expect(controls.outline.color).toBe("#aabbcc");
    expect(controls.outline.enabled).toBe(false);
    expect(controls.shading.enabled).toBe(false);
    expect(controls.rim.enabled).toBe(true);
  });

  it("survives corrupt, hostile and non-object payloads without throwing", () => {
    for (const raw of [undefined, null, 42, "not json", "{", [], { outline: [] }, () => 1]) {
      const controls = sanitizeStudioVrmMtoonControls(raw);
      expect(controls.kind).toBe(STUDIO_VRM_MTOON_CONTROLS_KIND);
      expect(controls.version).toBe(STUDIO_VRM_MTOON_CONTROLS_VERSION);
    }

    // 프로토타입 오염 시도는 무시된다.
    const polluted = JSON.parse('{"__proto__":{"polluted":true},"outline":{"enabled":true}}');
    const controls = sanitizeStudioVrmMtoonControls(polluted);
    expect(controls.outline.enabled).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("round-trips through serialize/parse", () => {
    const serialized = serializeStudioVrmMtoonControls(FULL);
    expect(parseStudioVrmMtoonControls(serialized)).toEqual(FULL);
    expect(parseStudioVrmMtoonControls("}{")).toEqual(sanitizeStudioVrmMtoonControls(undefined));
    // 파서는 문자열도 객체도 같은 결과를 낸다(멱등).
    expect(sanitizeStudioVrmMtoonControls(parseStudioVrmMtoonControls(FULL))).toEqual(FULL);
  });

  it("picks the outline width factor by mode", () => {
    expect(resolveStudioVrmMtoonOutlineWidthFactor(FULL)).toBe(0.002);
    expect(
      resolveStudioVrmMtoonOutlineWidthFactor({
        ...FULL,
        outline: { ...FULL.outline, mode: "worldCoordinates" },
      }),
    ).toBe(0.004);
    expect(
      resolveStudioVrmMtoonOutlineWidthFactor({
        ...FULL,
        outline: { ...FULL.outline, mode: "none" },
      }),
    ).toBe(0);
  });
});

describe("studio-vrm-mtoon-controls apply", () => {
  it("writes every supported uniform and flags the material dirty", () => {
    const material = fakeMToon();
    const report = applyStudioVrmMtoonControls(material, FULL);
    expect(report.isMToon).toBe(true);
    expect(report.unsupported).toHaveLength(0);
    expect(material.outlineWidthMode).toBe("screenCoordinates");
    expect(material.outlineWidthFactor).toBe(0.002);
    expect(material.outlineColorFactor.getHex()).toBe(0x101010);
    expect(material.outlineLightingMixFactor).toBe(0);
    expect(material.shadeColorFactor.getHex()).toBe(0x889099);
    expect(material.shadingShiftFactor).toBe(0.1);
    expect(material.shadingToonyFactor).toBe(1);
    expect(material.parametricRimColorFactor.getHex()).toBe(0xffeecc);
    expect(material.rimLightingMixFactor).toBe(0.5);
    expect(material.parametricRimFresnelPowerFactor).toBe(3);
    expect(material.parametricRimLiftFactor).toBe(0.2);
    expect(material.needsUpdate).toBe(true);
  });

  it("does nothing at all to non-MToon materials", () => {
    const standard = { color: new FakeColor(0x00ff00), needsUpdate: false, userData: {} };
    const report = applyStudioVrmMtoonControls(standard, FULL);
    expect(report.isMToon).toBe(false);
    expect(report.applied).toHaveLength(0);
    expect(standard.needsUpdate).toBe(false);
    expect(standard.userData).toEqual({});

    expect(applyStudioVrmMtoonControls(null, FULL).isMToon).toBe(false);
    expect(applyStudioVrmMtoonControls("material", FULL).isMToon).toBe(false);
  });

  it("caches the model's originals once and restores them when a group is disabled", () => {
    const material = fakeMToon();
    applyStudioVrmMtoonControls(material, FULL);
    // 두 번째 적용이 "원본"을 오염시키면 안 된다.
    applyStudioVrmMtoonControls(material, {
      ...FULL,
      shading: { ...FULL.shading, shadeColor: "#000000" },
    });
    expect(material.userData[STUDIO_VRM_MTOON_ORIGINAL_KEY]).toBeDefined();

    applyStudioVrmMtoonControls(material, {
      ...FULL,
      outline: { ...FULL.outline, enabled: false },
      shading: { ...FULL.shading, enabled: false },
      rim: { ...FULL.rim, enabled: false },
    });
    expect(material.outlineWidthMode).toBe("worldCoordinates");
    expect(material.outlineWidthFactor).toBe(0.001);
    expect(material.outlineColorFactor.getHex()).toBe(0x334455);
    expect(material.outlineLightingMixFactor).toBe(1);
    expect(material.shadeColorFactor.getHex()).toBe(0xaabbcc);
    expect(material.shadingShiftFactor).toBe(-0.2);
    expect(material.shadingToonyFactor).toBe(0.4);
    expect(material.parametricRimColorFactor.getHex()).toBe(0x111111);
    expect(material.rimLightingMixFactor).toBe(0.3);
  });

  it("resetStudioVrmMtoonControls restores everything in one call", () => {
    const material = fakeMToon();
    const before = {
      mode: material.outlineWidthMode,
      width: material.outlineWidthFactor,
      shade: material.shadeColorFactor.getHex(),
      toony: material.shadingToonyFactor,
    };
    applyStudioVrmMtoonControls(material, FULL);
    expect(resetStudioVrmMtoonControls(material)).toBe(true);
    expect(material.outlineWidthMode).toBe(before.mode);
    expect(material.outlineWidthFactor).toBe(before.width);
    expect(material.shadeColorFactor.getHex()).toBe(before.shade);
    expect(material.shadingToonyFactor).toBe(before.toony);

    // 한 번도 적용하지 않은 재질은 되돌릴 원본이 없다.
    expect(resetStudioVrmMtoonControls(fakeMToon())).toBe(false);
    expect(resetStudioVrmMtoonControls({ isMToonMaterial: false })).toBe(false);
  });

  it("protects eye/highlight materials that never had an outline", () => {
    const eye = fakeMToon({ outlineWidthMode: "none", outlineWidthFactor: 0 });
    const report = applyStudioVrmMtoonControls(eye, FULL);
    expect(report.outlineSkipped).toBe(true);
    expect(eye.outlineWidthMode).toBe("none");
    expect(eye.outlineWidthFactor).toBe(0);
    // 셰이딩·림은 정상 적용된다.
    expect(eye.shadingToonyFactor).toBe(1);

    const forced = fakeMToon({ outlineWidthMode: "none", outlineWidthFactor: 0 });
    const forcedReport = applyStudioVrmMtoonControls(forced, FULL, { outlineTargets: "all" });
    expect(forcedReport.outlineSkipped).toBe(false);
    expect(forced.outlineWidthMode).toBe("screenCoordinates");
    expect(forced.outlineWidthFactor).toBe(0.002);
  });

  it("reports uniforms this three-vrm build does not expose", () => {
    const partial = {
      isMToonMaterial: true,
      outlineWidthMode: "worldCoordinates" as const,
      outlineWidthFactor: 0.001,
      shadeColorFactor: new FakeColor(0x222222),
      userData: {},
    };
    const report = applyStudioVrmMtoonControls(partial, FULL);
    expect(report.isMToon).toBe(true);
    expect(report.applied).toContain("outlineWidthFactor");
    expect(report.applied).toContain("shadeColorFactor");
    expect(report.unsupported).toContain("outlineColorFactor");
    expect(report.unsupported).toContain("rimLightingMixFactor");
  });

  it("aggregates a whole scene's material list", () => {
    const materials = [
      fakeMToon(),
      fakeMToon(),
      fakeMToon({ outlineWidthMode: "none" }),
      { isMToonMaterial: false, userData: {} },
      null,
    ];
    const report = applyStudioVrmMtoonControlsToMaterials(materials, FULL);
    expect(report.materials).toBe(5);
    expect(report.mtoonMaterials).toBe(3);
    expect(report.outlineSkipped).toBe(1);
    expect(report.appliedFields).toBeGreaterThan(0);
  });
});

describe("MToon controls on the WebGPU node material", () => {
  it("applies to a node-branded material, which carries the same uniforms", () => {
    // The node port only differs by its brand flag. A guard that knows one brand leaves WebGPU
    // characters unstyled without raising anything, which silently changes LT line extraction.
    const material = {
      isMToonNodeMaterial: true,
      outlineWidthMode: "worldCoordinates" as const,
      outlineWidthFactor: 0.004,
      shadingToonyFactor: 0.5,
      userData: {} as Record<string, unknown>,
    };
    const report = applyStudioVrmMtoonControls(
      material,
      { ...DEFAULT_STUDIO_VRM_MTOON_CONTROLS,
        shading: { ...DEFAULT_STUDIO_VRM_MTOON_CONTROLS.shading, enabled: true, toony: 1 } },
    );
    expect(report.applied).toContain("shadingToonyFactor");
    expect(material.shadingToonyFactor).toBe(1);
    expect(resetStudioVrmMtoonControls(material)).toBe(true);
    expect(material.shadingToonyFactor).toBe(0.5);
  });
});
