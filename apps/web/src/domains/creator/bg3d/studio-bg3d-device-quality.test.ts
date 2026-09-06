import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_HARD_MAX_RENDER_PIXELS,
  deriveStudioBg3dGlbBudgetProfiles,
  deriveStudioBg3dGlbValidationPolicy,
  hasStudioBg3dQualityReason,
  resolveStudioBg3dDeviceQuality,
  selectStudioBg3dQualityProfile,
  type StudioBg3dDeviceSignals,
} from "./studio-bg3d-device-quality";
import { createDefaultStudioBg3dSceneDocument } from "./studio-bg3d-scene-document";

const DESKTOP_SIGNALS: StudioBg3dDeviceSignals = {
  cssWidth: 1440,
  cssHeight: 900,
  devicePixelRatio: 2,
  pointer: "fine",
  saveData: false,
  deviceMemoryGb: 8,
  hardwareConcurrency: 8,
};

function defaultDocument() {
  return createDefaultStudioBg3dSceneDocument();
}

describe("selectStudioBg3dQualityProfile", () => {
  it("selects mobile for a complete 375 × 812 phone signal set", () => {
    const selection = selectStudioBg3dQualityProfile({
      cssWidth: 375,
      cssHeight: 812,
      devicePixelRatio: 3,
      pointer: "coarse",
      saveData: false,
      deviceMemoryGb: 6,
      hardwareConcurrency: 8,
    });

    expect(selection.profile).toBe("mobile");
    expect(selection.reasons.map(({ code }) => code)).toEqual([
      "auto-mobile-viewport",
      "auto-coarse-pointer",
    ]);
  });

  it("selects desktop for a complete retina desktop signal set", () => {
    expect(selectStudioBg3dQualityProfile(DESKTOP_SIGNALS)).toMatchObject({
      profile: "desktop",
      preference: "auto",
      reasons: [{ code: "auto-desktop-capable" }],
    });
  });

  it.each([
    [{ deviceMemoryGb: 4 }, "auto-low-device-memory"],
    [{ hardwareConcurrency: 4 }, "auto-low-hardware-concurrency"],
    [{ pointer: "coarse" }, "auto-coarse-pointer"],
    [{ saveData: true }, "auto-save-data"],
  ] as const)("falls to mobile for constrained signals: %j", (change, expectedReason) => {
    const selection = selectStudioBg3dQualityProfile({ ...DESKTOP_SIGNALS, ...change });

    expect(selection.profile).toBe("mobile");
    expect(selection.reasons.map(({ code }) => code)).toContain(expectedReason);
  });

  it("fails conservatively when auto-detection signals are missing", () => {
    const selection = selectStudioBg3dQualityProfile({ cssWidth: 1440, cssHeight: 900 });

    expect(selection.profile).toBe("mobile");
    expect(selection.reasons.map(({ code }) => code)).toEqual([
      "auto-missing-or-invalid-pointer",
      "auto-missing-or-invalid-save-data",
      "auto-missing-or-invalid-device-memory",
      "auto-missing-or-invalid-hardware-concurrency",
    ]);
  });

  it("lets an explicit user override win even when every auto signal is mobile", () => {
    const selection = selectStudioBg3dQualityProfile(
      {
        cssWidth: 375,
        cssHeight: 812,
        devicePixelRatio: 3,
        pointer: "coarse",
        saveData: true,
        deviceMemoryGb: 2,
        hardwareConcurrency: 2,
      },
      "desktop",
    );

    expect(selection).toMatchObject({
      profile: "desktop",
      preference: "desktop",
      reasons: [{ code: "user-desktop-override" }],
    });
  });
});

describe("resolveStudioBg3dDeviceQuality", () => {
  it("uses the mobile DPR ceiling and effective renderer settings on 375 × 812", () => {
    const quality = resolveStudioBg3dDeviceQuality({
      document: defaultDocument(),
      mode: "edit",
      signals: {
        cssWidth: 375,
        cssHeight: 812,
        devicePixelRatio: 3,
        pointer: "coarse",
        saveData: false,
        deviceMemoryGb: 6,
        hardwareConcurrency: 8,
      },
    });

    expect(quality).toMatchObject({
      profile: "mobile",
      effectiveDpr: 1.5,
      renderWidth: 562,
      renderHeight: 1218,
      renderPixels: 684_516,
      shadows: true,
      shadowMapSize: 2048,
      textureScale: 1,
      lodBias: 0,
      targetFps: 30,
    });
    expect(hasStudioBg3dQualityReason(quality, "profile-dpr-max-limited")).toBe(true);
  });

  it("keeps DPR 2 on an ordinary retina desktop within its pixel budget", () => {
    const quality = resolveStudioBg3dDeviceQuality({
      document: defaultDocument(),
      mode: "edit",
      signals: DESKTOP_SIGNALS,
    });

    expect(quality).toMatchObject({
      profile: "desktop",
      effectiveDpr: 2,
      renderWidth: 2880,
      renderHeight: 1800,
      renderPixels: 5_184_000,
      shadows: true,
      shadowMapSize: 2048,
      textureScale: 1,
      lodBias: 0,
      targetFps: 60,
    });
  });

  it("reduces a UHD retina desktop to DPR 1 at the profile pixel ceiling", () => {
    const quality = resolveStudioBg3dDeviceQuality({
      document: defaultDocument(),
      mode: "edit",
      preference: "desktop",
      signals: {
        ...DESKTOP_SIGNALS,
        cssWidth: 3840,
        cssHeight: 2160,
      },
    });

    expect(quality.effectiveDpr).toBe(1.23168);
    expect(quality.renderPixels).toBe(12_579_140);
    expect(hasStudioBg3dQualityReason(quality, "pixel-budget-limited")).toBe(true);
  });

  it("lets capture request desktop quality but never exceed a supplied absolute cap", () => {
    const quality = resolveStudioBg3dDeviceQuality({
      document: defaultDocument(),
      mode: "capture",
      preference: "desktop",
      absolutePixelCap: 1_000_000,
      signals: {
        cssWidth: 2000,
        cssHeight: 2000,
        devicePixelRatio: 3,
        pointer: "coarse",
        saveData: true,
        deviceMemoryGb: 2,
        hardwareConcurrency: 2,
      },
    });

    expect(quality).toMatchObject({
      mode: "capture",
      profile: "desktop",
      effectiveDpr: 0.5,
      renderWidth: 1000,
      renderHeight: 1000,
      renderPixels: 1_000_000,
      maxRenderPixels: 1_000_000,
      shadows: true,
      targetFps: 60,
    });
    expect(quality.reasons.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "user-desktop-override",
        "capture-mode",
        "absolute-pixel-cap-applied",
        "pixel-budget-limited",
        "profile-dpr-min-bypassed-for-safety",
      ]),
    );
  });

  it("allows the pixel budget to take priority over dprMin", () => {
    const base = defaultDocument();
    const document = {
      ...base,
      quality: {
        ...base.quality,
        desktop: {
          ...base.quality.desktop,
          dprMin: 1,
          dprMax: 2,
          maxRenderPixels: 1_000,
        },
      },
    };
    const quality = resolveStudioBg3dDeviceQuality({
      document,
      mode: "edit",
      preference: "desktop",
      signals: { ...DESKTOP_SIGNALS, cssWidth: 1000, cssHeight: 1000 },
    });

    expect(quality.effectiveDpr).toBe(0.031622);
    expect(quality.effectiveDpr).toBeLessThan(1);
    expect(quality.renderPixels).toBeLessThanOrEqual(1_000);
    expect(hasStudioBg3dQualityReason(quality, "profile-dpr-min-bypassed-for-safety")).toBe(
      true,
    );
  });

  it("disables profile shadows when the scene render setting disables them", () => {
    const base = defaultDocument();
    const quality = resolveStudioBg3dDeviceQuality({
      document: { ...base, render: { ...base.render, shadows: false } },
      mode: "edit",
      preference: "desktop",
      signals: DESKTOP_SIGNALS,
    });

    expect(quality.shadows).toBe(false);
    expect(quality.shadowMapSize).toBe(0);
    expect(hasStudioBg3dQualityReason(quality, "shadows-disabled-by-scene")).toBe(true);
  });

  it.each([
    [{ cssWidth: 0, cssHeight: 812, devicePixelRatio: 0 }, "invalid-css-size-clamped"],
    [
      {
        cssWidth: Number.POSITIVE_INFINITY,
        cssHeight: Number.NEGATIVE_INFINITY,
        devicePixelRatio: Number.POSITIVE_INFINITY,
      },
      "invalid-css-size-clamped",
    ],
    [
      { cssWidth: Number.MAX_VALUE, cssHeight: Number.MAX_VALUE, devicePixelRatio: 8 },
      "oversized-css-size-clamped",
    ],
  ] as const)("keeps invalid and huge viewport math finite: %j", (dimensions, expectedReason) => {
    const quality = resolveStudioBg3dDeviceQuality({
      document: defaultDocument(),
      mode: "edit",
      signals: {
        pointer: "fine",
        saveData: false,
        deviceMemoryGb: 8,
        hardwareConcurrency: 8,
        ...dimensions,
      },
    });

    expect(quality.profile).toBe("mobile");
    expect(Number.isFinite(quality.effectiveDpr)).toBe(true);
    expect(quality.effectiveDpr).toBeGreaterThan(0);
    expect(Number.isSafeInteger(quality.renderPixels)).toBe(true);
    expect(quality.renderPixels).toBeLessThanOrEqual(quality.maxRenderPixels);
    expect(hasStudioBg3dQualityReason(quality, expectedReason)).toBe(true);
  });

  it("restricts an invalid supplied pixel cap instead of ignoring it", () => {
    const quality = resolveStudioBg3dDeviceQuality({
      document: defaultDocument(),
      mode: "capture",
      preference: "desktop",
      absolutePixelCap: Number.NaN,
      signals: DESKTOP_SIGNALS,
    });

    expect(quality.maxRenderPixels).toBe(1);
    expect(quality.renderPixels).toBe(1);
    expect(hasStudioBg3dQualityReason(quality, "invalid-absolute-pixel-cap-restricted")).toBe(
      true,
    );
  });

  it("keeps backing dimensions internally consistent for an extreme aspect ratio", () => {
    const quality = resolveStudioBg3dDeviceQuality({
      document: defaultDocument(),
      mode: "capture",
      preference: "desktop",
      absolutePixelCap: 1,
      signals: {
        ...DESKTOP_SIGNALS,
        cssWidth: 32_768,
        cssHeight: 1,
      },
    });

    expect(quality.renderPixels).toBe(quality.renderWidth * quality.renderHeight);
    expect(quality.renderPixels).toBe(1);
    expect(quality.maxRenderPixels).toBe(1);
  });

  it("never lets a supplied cap widen the selected profile pixel budget", () => {
    const quality = resolveStudioBg3dDeviceQuality({
      document: defaultDocument(),
      mode: "capture",
      preference: "mobile",
      absolutePixelCap: Number.MAX_SAFE_INTEGER,
      signals: {
        ...DESKTOP_SIGNALS,
        cssWidth: 3840,
        cssHeight: 2160,
      },
    });

    expect(quality.maxRenderPixels).toBe(4_194_304);
    expect(quality.renderPixels).toBeLessThanOrEqual(4_194_304);
  });
});

describe("GLB validator policy derivation", () => {
  it("intersects validator defaults with document limits without widening either profile", () => {
    const document = defaultDocument();
    const profiles = deriveStudioBg3dGlbBudgetProfiles(document);

    expect(profiles.mobile.complexity.maxModelBytes).toBe(64 * 1024 * 1024);
    expect(profiles.desktop.complexity.maxModelBytes).toBe(100 * 1024 * 1024);
    expect(profiles.mobile.complexity.maxNodes).toBe(256);
    expect(profiles.desktop.complexity.maxNodes).toBe(256);
    expect(profiles.mobile.complexity).toMatchObject({
      maxAnimations: 32,
      maxAnimationChannels: 256,
      maxAnimationKeyframes: 250_000,
      maxAnimationValues: 2_000_000,
      maxSkins: 32,
      maxJoints: 1_024,
      maxMorphTargets: 128,
    });
    expect(profiles.desktop.complexity).toMatchObject({
      maxAnimations: 64,
      maxAnimationChannels: 1_024,
      maxAnimationKeyframes: 1_000_000,
      maxAnimationValues: 8_000_000,
      maxSkins: 64,
      maxJoints: 2_048,
      maxMorphTargets: 256,
    });
    expect(profiles.mobile.textures.maxTextures).toBe(64);
    expect(profiles.desktop.textures.maxTextures).toBe(128);
    expect(profiles.mobile.textures.maxDimension).toBe(8192);
    expect(profiles.desktop.textures.maxDimension).toBe(8192);
  });

  it("preserves stricter project limits across mobile and desktop validator profiles", () => {
    const base = defaultDocument();
    const document = {
      ...base,
      budgets: {
        complexity: {
          maxModelBytes: 12_000_000,
          maxNodes: 40,
          maxTriangles: 80_000,
          maxDrawCalls: 30,
          maxMaterials: 20,
          maxLights: 2,
          maxAnimations: 3,
          maxAnimationChannels: 30,
          maxAnimationKeyframes: 300,
          maxAnimationValues: 1_200,
          maxSkins: 2,
          maxJoints: 64,
          maxMorphTargets: 8,
          maxAccessorElements: 100_000,
          maxDecodedGeometryBytes: 4_000_000,
        },
        textures: {
          maxTextures: 10,
          maxTotalBytes: 8_000_000,
          maxDimension: 1024,
        },
      },
    };
    const profiles = deriveStudioBg3dGlbBudgetProfiles(document);

    expect(profiles.mobile).toEqual(document.budgets);
    expect(profiles.desktop).toEqual(document.budgets);
  });

  it("maps the resolved profile and budgets into validator options", () => {
    const document = defaultDocument();
    const resolved = resolveStudioBg3dDeviceQuality({
      document,
      mode: "capture",
      preference: "desktop",
      signals: DESKTOP_SIGNALS,
    });
    const policy = deriveStudioBg3dGlbValidationPolicy(document, resolved);

    expect(policy.profile).toBe("desktop");
    expect(policy.budgets.desktop.complexity.maxModelBytes).toBeLessThanOrEqual(
      document.budgets.complexity.maxModelBytes,
    );
    expect(policy.budgets.mobile.textures.maxTotalBytes).toBeLessThanOrEqual(
      document.budgets.textures.maxTotalBytes,
    );
  });

  it("fails malformed document limits closed instead of widening them", () => {
    const base = defaultDocument();
    const document = {
      ...base,
      budgets: {
        ...base.budgets,
        complexity: {
          ...base.budgets.complexity,
          maxNodes: Number.NaN,
          maxModelBytes: Number.POSITIVE_INFINITY,
          maxAnimationValues: Number.NEGATIVE_INFINITY,
          maxMorphTargets: -1,
        },
      },
    };
    const profiles = deriveStudioBg3dGlbBudgetProfiles(document);

    expect(profiles.mobile.complexity.maxNodes).toBe(0);
    expect(profiles.desktop.complexity.maxNodes).toBe(0);
    expect(profiles.mobile.complexity.maxModelBytes).toBe(0);
    expect(profiles.desktop.complexity.maxModelBytes).toBe(0);
    expect(profiles.mobile.complexity.maxAnimationValues).toBe(0);
    expect(profiles.desktop.complexity.maxAnimationValues).toBe(0);
    expect(profiles.mobile.complexity.maxMorphTargets).toBe(0);
    expect(profiles.desktop.complexity.maxMorphTargets).toBe(0);
  });

  it("never exceeds the hard renderer pixel ceiling", () => {
    expect(STUDIO_BG3D_HARD_MAX_RENDER_PIXELS).toBe(16_777_216);
  });
});
