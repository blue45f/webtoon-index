import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_FOG_MIN_GAP,
  STUDIO_BG3D_FOG_PRESETS,
  resolveStudioBg3dSceneFog,
} from "./studio-bg3d-scene-fog";
import { StudioBg3dSceneFog } from "./StudioBg3dSceneFog";

import type { StudioBg3dBackgroundSettings } from "./studio-bg3d-scene-document";

function background(
  overrides: Partial<StudioBg3dBackgroundSettings> = {},
): StudioBg3dBackgroundSettings {
  return {
    mode: "sky-preset",
    color: "#d8e3ed",
    skyPresetId: "clear_day",
    panoramaRotation: 0,
    fogEnabled: true,
    fogColor: "#c9d6df",
    fogNear: 8,
    fogFar: 40,
    ...overrides,
  };
}

describe("StudioBg3dSceneFog", () => {
  it("does not attach fog when the scene setting is disabled", () => {
    expect(resolveStudioBg3dSceneFog(background({ fogEnabled: false }))).toBeNull();
    expect(StudioBg3dSceneFog({ background: background({ fogEnabled: false }) })).toBeNull();
  });

  it("creates a declarative R3F fog attachment from the canonical scene settings", () => {
    const rendered = StudioBg3dSceneFog({ background: background() });

    expect(resolveStudioBg3dSceneFog(background())).toEqual({
      color: "#c9d6df",
      near: 8,
      far: 40,
    });
    expect(rendered?.type).toBe("fog");
    expect(rendered?.props).toMatchObject({
      attach: "fog",
      args: ["#c9d6df", 8, 40],
    });
  });

  it("keeps malformed legacy ranges finite and strictly ordered at the render boundary", () => {
    const resolved = resolveStudioBg3dSceneFog(
      background({ fogColor: undefined, fogNear: 50, fogFar: 4 }),
    );

    expect(resolved).toEqual({
      color: "#d8e3ed",
      near: 50,
      far: 50 + STUDIO_BG3D_FOG_MIN_GAP,
    });
  });

  it("offers ordered, progressively denser atmosphere presets", () => {
    expect(STUDIO_BG3D_FOG_PRESETS.map((preset) => preset.id)).toEqual([
      "air",
      "depth",
      "mist",
    ]);
    expect(STUDIO_BG3D_FOG_PRESETS.every((preset) => preset.far > preset.near)).toBe(true);
    expect(STUDIO_BG3D_FOG_PRESETS.map((preset) => preset.far - preset.near)).toEqual([
      62,
      32,
      20,
    ]);
  });
});
