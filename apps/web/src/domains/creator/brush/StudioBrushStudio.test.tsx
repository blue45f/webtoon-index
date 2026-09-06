// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveStudioCoreBrushDefaultRestoreProfile,
} from "./studio-brush-default-restore";
import {
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsSettingsForBrushId,
  studioBrushDynamicsPresetSettings,
} from "./studio-brush-dynamics";
import {
  DEFAULT_STUDIO_BRUSH_SNAPSHOT,
  type StudioSavedBrush,
} from "./studio-brush-library";
import { studioBrushStudioDefaultPresetId } from "./studio-brush-studio-contract";
import { studioBrushTipAlphaMapToBase64 } from "./studio-brush-tip-stamp";
import {
  StudioBrushDualBrushControls,
  StudioBrushDynamicsPreview,
  StudioBrushStudio,
  StudioBrushTipImportControls,
  type StudioBrushStudioProps,
} from "./StudioBrushStudio";

afterEach(cleanup);

function props(overrides: Partial<StudioBrushStudioProps> = {}): StudioBrushStudioProps {
  const settings = studioBrushDynamicsPresetSettings("ink-particle");
  return {
    brushId: "ink-particle",
    strokeWidth: 8,
    color: "#281d18",
    currentSnapshot: {
      ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
      brushId: "ink-particle",
      strokeWidth: 8,
      color: "#281d18",
      brushDynamics: settings,
    },
    settings,
    onSettingsChange: vi.fn(),
    onSelectDynamicsPreset: vi.fn(),
    useVelocityPressure: true,
    onUseVelocityPressureChange: vi.fn(),
    velocitySensitivity: 0.65,
    onVelocitySensitivityChange: vi.fn(),
    pressureCurve: 1,
    onPressureCurveChange: vi.fn(),
    tiltEnabled: true,
    onTiltEnabledChange: vi.fn(),
    tipAngle: -30,
    onTipAngleChange: vi.fn(),
    tipRoundness: 0.24,
    onTipRoundnessChange: vi.fn(),
    onRestoreDefaults: vi.fn(),
    ...overrides,
  };
}

describe("StudioBrushStudio", () => {
  it("renders one compact, dialog-capable launcher with a dynamics summary", () => {
    const html = renderToStaticMarkup(<StudioBrushStudio {...props()} />);
    expect(html).toContain("브러시 스튜디오");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("잉크 입자");
    expect(html).toContain("개 연결");
    expect(html).toContain("min-h-[44px]");
    expect(html).not.toContain('role="dialog"');
  });

  it("offers the same explicit 44px full-profile restore action on touch layouts", async () => {
    const onBeforeOpen = vi.fn();
    render(
      <StudioBrushStudio
        {...props({ density: "touch", onBeforeOpen })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /브러시 스튜디오/ }));
    const restore = await screen.findByRole("button", {
      name: "이 브러시 기본값 복원",
    });
    const dialog = screen.getByRole("dialog", { name: "브러시 스튜디오" });
    const panel = dialog.querySelector<HTMLElement>(":scope > div");

    expect(onBeforeOpen).toHaveBeenCalledOnce();
    expect(dialog.getAttribute("data-studio-brush-studio-dialog")).toBe("true");
    expect(dialog.className).toContain("z-[180]");
    expect(dialog.className).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(panel?.className).toContain("h-[calc(100dvh-env(safe-area-inset-bottom))]");
    expect(panel?.className).toContain("overscroll-contain");
    expect(restore.className).toContain("min-h-11");
    expect(screen.getByText(/굵기·불투명도·필압·보정·촉을 함께 복원/)).toBeTruthy();
  });

  it("recovers an incompatible brush through one explicit 44px dynamics preset CTA", async () => {
    const onSelectDynamicsPreset = vi.fn();
    render(
      <StudioBrushStudio
        {...props({
          brushId: "pen",
          settings: normalizeStudioBrushDynamicsSettings(),
          currentSnapshot: {
            ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
            brushId: "pen",
            brushDynamics: normalizeStudioBrushDynamicsSettings(),
          },
          onSelectDynamicsPreset,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /브러시 스튜디오/ }));
    fireEvent.click(await screen.findByRole("tab", { name: /반응/ }));

    const recovery = screen.getByRole("button", { name: "호환 브러시 선택하기" });
    expect(recovery.className).toContain("min-h-11");
    fireEvent.click(recovery);

    expect(onSelectDynamicsPreset).toHaveBeenCalledWith(
      "ink-particle",
      studioBrushDynamicsSettingsForBrushId("ink-particle"),
    );
  });

  it("mints the same pinned snapshot from the presets panel as toolbar brush selection", async () => {
    const onSelectDynamicsPreset = vi.fn();
    render(<StudioBrushStudio {...props({ onSelectDynamicsPreset })} />);

    fireEvent.click(screen.getByRole("button", { name: /브러시 스튜디오/ }));
    fireEvent.click(await screen.findByRole("button", { name: /드라이 미디어/ }));

    const toolbarMinted = studioBrushDynamicsSettingsForBrushId("dry-media");
    if (!toolbarMinted) throw new Error("missing dry-media dynamics");
    expect(toolbarMinted.causalStampGridRule).toBe("causal-stamp-grid-v2");
    expect(onSelectDynamicsPreset).toHaveBeenCalledWith("dry-media", toolbarMinted);
    expect(onSelectDynamicsPreset.mock.calls[0]?.[1]).not.toEqual(
      studioBrushDynamicsPresetSettings("dry-media"),
    );
  });

  it("edits newly authored wet dynamics without replacing the selected brush", async () => {
    const settings = studioBrushDynamicsSettingsForBrushId("ink-wash");
    if (!settings) throw new Error("missing ink-wash dynamics");
    render(
      <StudioBrushStudio
        {...props({ brushId: "ink-wash", settings })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /브러시 스튜디오/ }));
    fireEvent.click(await screen.findByRole("tab", { name: /반응/ }));

    expect(screen.queryByRole("button", { name: "호환 브러시 선택하기" })).toBeNull();
    expect(screen.getByText(/사용자 지정 · 6개 연결/)).toBeTruthy();
  });

  it("confirms one atomic transaction, preserves identity/color, and offers one-step undo", async () => {
    const onRestoreDefaults = vi.fn();
    const currentSnapshot = {
      ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
      brushId: "spray",
      strokeWidth: 9,
      brushOpacity: 0.95,
      color: "#123456",
      stabilizer: 7,
      pressureCurve: 1.8,
      tipAngle: 85,
      brushDynamics: studioBrushDynamicsPresetSettings("ink-particle"),
    };
    render(
      <StudioBrushStudio
        {...props({
          brushId: "spray",
          strokeWidth: currentSnapshot.strokeWidth,
          color: currentSnapshot.color,
          settings: currentSnapshot.brushDynamics,
          currentSnapshot,
          onRestoreDefaults,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /브러시 스튜디오/ }));
    fireEvent.click(screen.getByRole("button", { name: "이 브러시 기본값 복원" }));

    expect(await screen.findByText("미세 스프레이 기본값으로 복원할까요?")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: /개 설정 복원/ });
    fireEvent.click(confirm);

    expect(onRestoreDefaults).toHaveBeenCalledOnce();
    const [transaction, direction] = onRestoreDefaults.mock.calls[0]!;
    expect(direction).toBe("redo");
    expect(transaction.after).toMatchObject({
      strokeWidth: 40,
      brushOpacity: 0.55,
      stabilizer: 3,
      pressureCurve: 1,
      tipAngle: -30,
    });
    expect(transaction.profile.sourceId).toBe("spray");
    expect(transaction).not.toHaveProperty("color");

    fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    expect(onRestoreDefaults).toHaveBeenLastCalledWith(transaction, "undo");
  });

  it("uses an explicitly supplied saved-brush snapshot instead of guessing a built-in default", async () => {
    const settings = studioBrushDynamicsPresetSettings("dry-media");
    const savedBrush: StudioSavedBrush = {
      ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
      id: "saved-lettering",
      name: "내 레터링 붓",
      createdAt: 1,
      updatedAt: 2,
      pinned: false,
      lastUsedAt: null,
      brushId: "calligraphy",
      strokeWidth: 18,
      brushOpacity: 0.7,
      pressureCurve: 0.65,
      tipAngle: -50,
      color: "#765432",
      brushDynamics: settings,
    };
    const currentSnapshot = {
      ...savedBrush,
      strokeWidth: 42,
      pressureCurve: 2.2,
      tipAngle: 90,
    };
    const onRestoreDefaults = vi.fn();
    render(
      <StudioBrushStudio
        {...props({
          brushId: "calligraphy",
          strokeWidth: currentSnapshot.strokeWidth,
          color: currentSnapshot.color,
          settings,
          currentSnapshot,
          savedBrushBaseline: savedBrush,
          onRestoreDefaults,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /브러시 스튜디오/ }));
    fireEvent.click(screen.getByRole("button", { name: "이 브러시 기본값 복원" }));

    expect(await screen.findByText("내 레터링 붓 기본값으로 복원할까요?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /개 설정 복원/ }));
    expect(onRestoreDefaults.mock.calls[0]?.[0].after).toMatchObject({
      strokeWidth: 18,
      brushOpacity: 0.7,
      pressureCurve: 0.65,
      tipAngle: -50,
    });
    expect(onRestoreDefaults.mock.calls[0]?.[0].profile.source).toBe("saved");
  });

  it("reports a no-op instead of emitting a redundant restore callback", async () => {
    const onRestoreDefaults = vi.fn();
    const profile = resolveStudioCoreBrushDefaultRestoreProfile("ink-particle")!;
    const currentSnapshot = {
      ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
      brushId: "ink-particle",
      ...profile.values,
    };
    render(
      <StudioBrushStudio
        {...props({
          strokeWidth: currentSnapshot.strokeWidth,
          settings: currentSnapshot.brushDynamics,
          currentSnapshot,
          onRestoreDefaults,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /브러시 스튜디오/ }));
    fireEvent.click(screen.getByRole("button", { name: "이 브러시 기본값 복원" }));

    await waitFor(() => {
      const status = document.querySelector<HTMLElement>(
        "[data-studio-brush-default-restore-status]",
      );
      expect(status).not.toBeNull();
      expect(status?.getAttribute("data-studio-brush-default-restore-status")).toBe(
        "unchanged",
      );
      expect(status?.textContent).toContain("이미 이 브러시의 기본값입니다.");
    });
    expect(onRestoreDefaults).not.toHaveBeenCalled();
  });

  it("fails safely for an imported custom source without a saved baseline", async () => {
    const currentSnapshot = {
      ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
      brushId: "ink-particle",
      sourcePresetId: "external-custom-brush",
      sourcePresetName: "외부 브러시",
      brushDynamics: studioBrushDynamicsPresetSettings("ink-particle"),
    };
    const onRestoreDefaults = vi.fn();
    render(
      <StudioBrushStudio
        {...props({ currentSnapshot, onRestoreDefaults })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /브러시 스튜디오/ }));
    fireEvent.click(screen.getByRole("button", { name: "이 브러시 기본값 복원" }));

    expect(await screen.findByText(/저장된 브러시 라이브러리에서 다시 적용/)).toBeTruthy();
    expect(onRestoreDefaults).not.toHaveBeenCalled();
  });

  it("uses a 44px-or-larger launcher in touch density and summarizes calligraphy", () => {
    const html = renderToStaticMarkup(
      <StudioBrushStudio {...props({
        brushId: "calligraphy",
        density: "touch",
        tipAngle: -30,
        tipRoundness: 0.24,
        settings: normalizeStudioBrushDynamicsSettings(),
        currentSnapshot: {
          ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
          brushId: "calligraphy",
          brushDynamics: normalizeStudioBrushDynamicsSettings(),
        },
      })} />
    );
    expect(html).toContain("min-h-14");
    expect(html).toContain("촉 -30° · 원형도 24%");
  });

  it.each([
    ["spray", "airbrush"],
    ["soft-brush", "airbrush"],
    ["crayon", "dry-media"],
    ["chalk", "dry-media"],
    ["charcoal", "dry-media"],
  ] as const)("maps the %s catalog alias to its actual dynamics preset", (brushId, presetId) => {
    expect(studioBrushStudioDefaultPresetId(brushId)).toBe(presetId);
    const html = renderToStaticMarkup(
      <StudioBrushStudio
        {...props({
          brushId,
          settings: studioBrushDynamicsPresetSettings(presetId),
        })}
      />
    );

    expect(html).toContain(
      presetId === "airbrush" ? "에어브러시" : "드라이 미디어"
    );
    expect(html).not.toContain("필압·속도 입력과 입자 브러시");
  });

  it("falls back to ink-particle when a non-dynamics brush restores defaults", () => {
    expect(studioBrushStudioDefaultPresetId("pen")).toBe("ink-particle");
  });

  it("renders deterministic rotated elliptical dabs from the shipped planner", () => {
    // Solid ellipse path: force a round tip and neutral material grain so the preview exercises
    // Canvas ellipse geometry rather than the alpha-map material sampling path.
    const preset = studioBrushDynamicsPresetSettings("dry-media");
    const settings = normalizeStudioBrushDynamicsSettings({
      ...preset,
      tip: { shape: "round" as const, softness: 0.35, alphaMapBase64: null, alphaMapSize: 24 },
      grain: { ...preset.grain, amount: 0 },
    });
    const first = renderToStaticMarkup(
      <StudioBrushDynamicsPreview settings={settings} strokeWidth={9} color="#3a2218" />
    );
    const second = renderToStaticMarkup(
      <StudioBrushDynamicsPreview settings={settings} strokeWidth={9} color="#3a2218" />
    );
    expect(first).toBe(second);
    expect((first.match(/<ellipse/g) ?? []).length).toBeGreaterThan(4);
    expect(first).toContain("rotate(");
    expect(first).toContain("필압 · 속도 · 기울기 · 회전");
  });

  it("matches Canvas radius-then-roundness geometry for a deterministic thin tip", () => {
    const preset = studioBrushDynamicsPresetSettings("dry-media");
    const settings = normalizeStudioBrushDynamicsSettings({
      ...preset,
      tip: { shape: "round" as const, softness: 0.35, alphaMapBase64: null, alphaMapSize: 24 },
      grain: { ...preset.grain, amount: 0 },
      width: {
        ...preset.width,
        mappings: [{
          source: "pressure" as const,
          mode: "multiply" as const,
          from: 0.08,
          to: 0.08,
          amount: 1,
          curve: 1,
          invert: false,
        }],
        jitter: null,
      },
      roundness: {
        ...preset.roundness,
        base: 0.08,
        mappings: [],
        jitter: null,
      },
    });
    const html = renderToStaticMarkup(
      <StudioBrushDynamicsPreview settings={settings} strokeWidth={3} color="#3a2218" />
    );
    const firstEllipse = html.match(/<ellipse\b[^>]*\brx="([^"]+)"[^>]*\bry="([^"]+)"/);

    expect(firstEllipse).not.toBeNull();
    const radiusX = Number(firstEllipse![1]);
    const radiusY = Number(firstEllipse![2]);
    expect(radiusX).toBe(0.25);
    expect(radiusY).toBeCloseTo(radiusX * settings.roundness.base, 12);
    expect(radiusY).toBeLessThan(0.25);
  });

  it("renders dual brush controls with secondary tip, blend mode, size ratio and PNG import", () => {
    const settings = normalizeStudioBrushDynamicsSettings({
      ...studioBrushDynamicsPresetSettings("ink-particle"),
      dualBrush: {
        enabled: true,
        tip: { shape: "halftone" },
        blendMode: "screen",
        sizeRatio: 1.5,
      },
    });
    const html = renderToStaticMarkup(
      <StudioBrushDualBrushControls settings={settings} onSettingsChange={vi.fn()} />
    );
    expect(html).toContain("듀얼 브러시 사용");
    expect(html).toContain("간격·산포는 1차 브러시를 따릅니다");
    expect(html).toContain('aria-label="듀얼 브러시 합성 모드"');
    expect(html).toContain("곱하기");
    expect(html).toContain("스크린");
    expect(html).toContain("2차 팁 크기 비율");
    expect(html).toContain("150%");
    expect(html).toContain('aria-label="2차 팁 망점"');
    // The secondary tip reuses the shared PNG tip import system.
    expect(html).toContain("PNG 펜촉 가져오기");
  });

  it("collapses dual brush to a single accessible toggle while disabled", () => {
    const html = renderToStaticMarkup(
      <StudioBrushDualBrushControls
        settings={studioBrushDynamicsPresetSettings("ink-particle")}
        onSettingsChange={vi.fn()}
      />
    );
    expect(html).toContain("듀얼 브러시 사용");
    expect(html).toContain('aria-checked="false"');
    expect(html).not.toContain("2차 팁 크기 비율");
    expect(html).not.toContain('aria-label="듀얼 브러시 합성 모드"');
  });

  it("moves the preview primary tip off the solid-ellipse path only while dual brush is active", () => {
    const roundTip = {
      tip: { shape: "round" as const, softness: 0.35, alphaMapBase64: null, alphaMapSize: 24 },
    };
    const preset = studioBrushDynamicsPresetSettings("dry-media");
    const base = normalizeStudioBrushDynamicsSettings({
      ...preset,
      ...roundTip,
      grain: { ...preset.grain, amount: 0 },
    });
    const disabledHtml = renderToStaticMarkup(
      <StudioBrushDynamicsPreview settings={base} strokeWidth={9} color="#3a2218" />
    );
    expect(disabledHtml).toContain("<ellipse");
    const enabled = normalizeStudioBrushDynamicsSettings({
      ...base,
      dualBrush: { enabled: true, tip: { shape: "halftone" }, blendMode: "multiply", sizeRatio: 1 },
    });
    const enabledHtml = renderToStaticMarkup(
      <StudioBrushDynamicsPreview settings={enabled} strokeWidth={9} color="#3a2218" />
    );
    expect(enabledHtml).toContain("<circle");
    expect(enabledHtml).not.toContain("<ellipse");
  });

  it("offers an actual PNG chooser with clear limits and a 44px touch target", () => {
    const html = renderToStaticMarkup(
      <StudioBrushTipImportControls
        tip={{ shape: "round", softness: 0.35, alphaMapBase64: null, alphaMapSize: 24 }}
        onTipChange={vi.fn()}
      />
    );

    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".png,image/png"');
    expect(html).toContain("PNG 펜촉 가져오기");
    expect(html).toContain("4MB·4,096px 이하");
    expect(html).toContain("min-h-[44px]");
  });

  it("shows embedded custom-tip status and an accessible remove action", () => {
    const payload = studioBrushTipAlphaMapToBase64("sumi", 0.3, 16);
    const html = renderToStaticMarkup(
      <StudioBrushTipImportControls
        tip={{
          shape: "sumi",
          softness: 0.3,
          alphaMapBase64: payload.alphaMapBase64,
          alphaMapSize: payload.alphaMapSize,
        }}
        onTipChange={vi.fn()}
      />
    );

    expect(html).toContain("문서에 포함된 사용자 PNG");
    expect(html).toContain("16×16 알파");
    expect(html).toContain('aria-label="사용자 PNG 펜촉 제거"');
    expect(html).toContain("다른 PNG로 교체");
  });
});
