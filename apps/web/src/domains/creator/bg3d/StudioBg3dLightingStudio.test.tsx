// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  studioBg3dLightAnglesToDirection,
  studioBg3dLightDirectionToAngles,
} from "./studio-bg3d-light-direction";
import {
  STUDIO_BG3D_LIGHTING_STUDIO_PRESETS,
} from "./studio-bg3d-lighting-studio";
import {
  StudioBg3dLightingStudio,
} from "./StudioBg3dLightingStudio";
import lightingStudioSource from "./StudioBg3dLightingStudio.tsx?raw";

import type {
  StudioBg3dLightingSettings,
  StudioBg3dVec3,
} from "./studio-bg3d-scene-document";
import type { ComponentProps } from "react";

const DEFAULT_LIGHTING: StudioBg3dLightingSettings = {
  ambientColor: "#dbe5f0",
  ambientIntensity: 0.58,
  key: {
    color: "#fff0d2",
    direction: studioBg3dLightAnglesToDirection({
      azimuthDeg: 38,
      elevationDeg: 48,
    }),
    intensity: 1.25,
    castsShadow: true,
  },
  fill: {
    color: "#b9cfee",
    direction: studioBg3dLightAnglesToDirection({
      azimuthDeg: -132,
      elevationDeg: 28,
    }),
    intensity: 0.38,
    castsShadow: false,
  },
};

type LightingStudioProps = ComponentProps<typeof StudioBg3dLightingStudio>;

function renderStudio(overrides: Partial<LightingStudioProps> = {}) {
  const props: LightingStudioProps = {
    lighting: DEFAULT_LIGHTING,
    exposure: 1,
    onUpdateLighting: vi.fn(),
    onUpdateExposure: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<StudioBg3dLightingStudio {...props} />) };
}

function expectDirectionClose(
  actual: StudioBg3dVec3,
  expected: StudioBg3dVec3,
): void {
  expect(actual[0]).toBeCloseTo(expected[0], 8);
  expect(actual[1]).toBeCloseTo(expected[1], 8);
  expect(actual[2]).toBeCloseTo(expected[2], 8);
}

afterEach(cleanup);

describe("StudioBg3dLightingStudio direction conversion", () => {
  it.each([
    { azimuthDeg: 0, elevationDeg: 0 },
    { azimuthDeg: 42, elevationDeg: 35 },
    { azimuthDeg: -126, elevationDeg: 18 },
    { azimuthDeg: 90, elevationDeg: -28 },
  ])("round-trips $azimuthDeg° / $elevationDeg°", (angles) => {
    const direction = studioBg3dLightAnglesToDirection(angles);
    const restored = studioBg3dLightDirectionToAngles(direction);

    expect(Math.hypot(...direction)).toBeCloseTo(1, 10);
    expect(restored.azimuthDeg).toBeCloseTo(angles.azimuthDeg, 8);
    expect(restored.elevationDeg).toBeCloseTo(angles.elevationDeg, 8);
  });

  it("fails closed to the canonical forward finite direction for a zero vector", () => {
    const restored = studioBg3dLightDirectionToAngles([0, 0, 0]);

    expect(restored.azimuthDeg).toBe(0);
    expect(restored.elevationDeg).toBe(0);
    expectDirectionClose(
      studioBg3dLightAnglesToDirection({
        azimuthDeg: Number.NaN,
        elevationDeg: Number.POSITIVE_INFINITY,
      }),
      studioBg3dLightAnglesToDirection({ azimuthDeg: 0, elevationDeg: 0 }),
    );
  });
});

describe("StudioBg3dLightingStudio", () => {
  it("starts collapsed, summarizes live values, and keeps compact controls touch-sized", () => {
    const { container } = renderStudio();
    const details = screen.getByTestId("bg3d-lighting-studio") as HTMLDetailsElement;
    const summary = screen.getByText("조명 스튜디오").closest("summary");

    expect(details.open).toBe(false);
    expect(screen.getByText(/균형 3점 · 키 1.25 · 필 0.38 · 노출 1.00/)).toBeTruthy();
    expect(summary?.className).toContain("min-h-11");
    expect(container.querySelectorAll('input[type="color"]')).toHaveLength(3);
    for (const colorInput of container.querySelectorAll('input[type="color"]')) {
      expect(colorInput.className).toContain("size-11");
      expect(colorInput.className).toContain("pointer-coarse:size-11");
    }
    expect(lightingStudioSource).toContain("grid-cols-2");
    expect(lightingStudioSource).toContain("min-w-0");
  });

  it("emits narrow immutable lighting patches for color, intensity, direction, and shadow", () => {
    const sourceSnapshot = JSON.stringify(DEFAULT_LIGHTING);
    const onUpdateLighting = vi.fn();
    const { container } = renderStudio({ onUpdateLighting });

    const ambientColor = container.querySelector<HTMLInputElement>(
      'input[aria-label="주변광 색상"]',
    );
    expect(ambientColor).not.toBeNull();
    fireEvent.change(ambientColor!, {
      target: { value: "#123456" },
    });
    expect(onUpdateLighting).toHaveBeenLastCalledWith({ ambientColor: "#123456" });

    fireEvent.change(screen.getByRole("slider", { name: /^주변광 세기/u }), {
      target: { value: "0.9" },
    });
    expect(onUpdateLighting).toHaveBeenLastCalledWith({ ambientIntensity: 0.9 });

    fireEvent.change(screen.getByRole("slider", { name: /^키 라이트 세기/u }), {
      target: { value: "1.7" },
    });
    expect(onUpdateLighting).toHaveBeenLastCalledWith({
      key: { ...DEFAULT_LIGHTING.key, intensity: 1.7 },
    });

    fireEvent.change(screen.getByRole("slider", { name: /^키 라이트 방위각/u }), {
      target: { value: "90" },
    });
    expect(onUpdateLighting).toHaveBeenLastCalledWith({
      key: {
        ...DEFAULT_LIGHTING.key,
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: 90,
          elevationDeg: 48,
        }),
      },
    });

    fireEvent.click(screen.getByRole("switch", { name: "키 라이트 그림자" }));
    expect(onUpdateLighting).toHaveBeenLastCalledWith({
      key: { ...DEFAULT_LIGHTING.key, castsShadow: false },
    });
    expect(JSON.stringify(DEFAULT_LIGHTING)).toBe(sourceSnapshot);
  });

  it("updates fill independently and delegates exposure without rewriting lighting", () => {
    const onUpdateLighting = vi.fn();
    const onUpdateExposure = vi.fn();
    renderStudio({ onUpdateLighting, onUpdateExposure });

    fireEvent.change(screen.getByRole("slider", { name: /^필 라이트 고도각/u }), {
      target: { value: "52" },
    });
    expect(onUpdateLighting).toHaveBeenLastCalledWith({
      fill: {
        ...DEFAULT_LIGHTING.fill,
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: -132,
          elevationDeg: 52,
        }),
      },
    });

    fireEvent.change(screen.getByRole("slider", { name: /^노출/u }), {
      target: { value: "1.35" },
    });
    expect(onUpdateExposure).toHaveBeenCalledWith(1.35);
    expect(onUpdateLighting).toHaveBeenCalledTimes(1);
  });

  it("disables every editing input while capture or scene restoration is transient", () => {
    const onUpdateLighting = vi.fn();
    const onUpdateExposure = vi.fn();
    const { container } = renderStudio({
      disabled: true,
      onUpdateLighting,
      onUpdateExposure,
    });

    const presetButtons = screen.getAllByRole("button", {
      name: /조명 프리셋 적용$/u,
    });
    const colorInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="color"]'),
    );
    const rangeInputs = screen.getAllByRole("slider");
    const shadowToggles = [
      screen.getByRole("switch", { name: "키 라이트 그림자" }),
      screen.getByRole("switch", { name: "필 라이트 그림자" }),
    ];

    for (const control of [
      ...presetButtons,
      ...colorInputs,
      ...rangeInputs,
      ...shadowToggles,
    ]) {
      expect((control as HTMLButtonElement | HTMLInputElement).disabled).toBe(true);
    }

    fireEvent.click(presetButtons[0]!);
    expect(onUpdateLighting).not.toHaveBeenCalled();
    expect(onUpdateExposure).not.toHaveBeenCalled();
  });

  it("applies a complete light-only preset and exposes exact selected state", () => {
    const preset = STUDIO_BG3D_LIGHTING_STUDIO_PRESETS[1]!;
    const onUpdateLighting = vi.fn();
    const onUpdateExposure = vi.fn();
    const view = renderStudio({ onUpdateLighting, onUpdateExposure });

    fireEvent.click(screen.getByRole("button", {
      name: `${preset.label} 조명 프리셋 적용`,
    }));
    expect(onUpdateLighting).toHaveBeenCalledOnce();
    expect(onUpdateLighting).toHaveBeenCalledWith(preset.lighting);
    expect(onUpdateExposure).toHaveBeenCalledOnce();
    expect(onUpdateExposure).toHaveBeenCalledWith(preset.exposure);

    view.rerender(
      <StudioBg3dLightingStudio
        lighting={preset.lighting}
        exposure={preset.exposure}
        onUpdateLighting={onUpdateLighting}
        onUpdateExposure={onUpdateExposure}
      />,
    );
    expect(screen.getByRole("button", {
      name: `${preset.label} 조명 프리셋 적용`,
    }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(
      new RegExp(`${preset.label} · 키 ${preset.lighting.key.intensity.toFixed(2)}`),
    )).toBeTruthy();
  });

  it("keeps all presets unique, frozen, and isolated from mood, sun, background, and fog state", () => {
    expect(STUDIO_BG3D_LIGHTING_STUDIO_PRESETS).toHaveLength(8);
    expect(new Set(STUDIO_BG3D_LIGHTING_STUDIO_PRESETS.map(({ id }) => id)).size).toBe(8);
    expect(Object.isFrozen(STUDIO_BG3D_LIGHTING_STUDIO_PRESETS)).toBe(true);
    for (const preset of STUDIO_BG3D_LIGHTING_STUDIO_PRESETS) {
      expect(Object.isFrozen(preset)).toBe(true);
      expect(Object.isFrozen(preset.lighting)).toBe(true);
      expect(Math.hypot(...preset.lighting.key.direction)).toBeCloseTo(1, 10);
      expect(Math.hypot(...preset.lighting.fill.direction)).toBeCloseTo(1, 10);
    }

    expect(lightingStudioSource).not.toContain('from "./studio-bg3d-mood-rigs"');
    expect(lightingStudioSource).not.toContain('from "./studio-bg3d-sun-rig"');
    expect(lightingStudioSource).not.toContain("onUpdateBackground");
    expect(lightingStudioSource).not.toContain("fogEnabled");
  });
});
