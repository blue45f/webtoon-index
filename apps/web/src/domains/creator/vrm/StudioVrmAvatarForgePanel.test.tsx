// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAvatarForgeState,
  parseAvatarForgeState,
  type AvatarForgeState,
} from "./studio-vrm-avatar-forge";
import { STUDIO_VRM_GENERATE_DEFAULT_PRESET_ID } from "./studio-vrm-generate-recipe";
import { StudioVrmAvatarForgePanel } from "./StudioVrmAvatarForgePanel";

import type { StudioVrmProportionMetrics } from "./studio-vrm-proportion-core";

afterEach(cleanup);

function renderPanel(overrides: {
  readonly state?: AvatarForgeState;
  readonly disabled?: boolean;
  readonly proportionMetrics?: StudioVrmProportionMetrics | null;
  readonly proportionPresetNote?: string | null;
  readonly proportionUnavailableReason?: string | null;
  readonly onGeneratedFile?: (file: File) => void;
} = {}) {
  const onChange = vi.fn();
  const onGeneratedFile = overrides.onGeneratedFile ?? vi.fn();
  const state = overrides.state ?? createAvatarForgeState("wave-diva");
  const view = render(
    <StudioVrmAvatarForgePanel
      state={state}
      disabled={overrides.disabled}
      detectedOriginalHairCount={2}
      proportionMetrics={overrides.proportionMetrics}
      proportionPresetNote={overrides.proportionPresetNote}
      proportionUnavailableReason={overrides.proportionUnavailableReason}
      onChange={onChange}
      onGeneratedFile={onGeneratedFile}
    />,
  );
  return { ...view, onChange, onGeneratedFile, state };
}

describe("StudioVrmAvatarForgePanel VRM generation", () => {
  it("exposes generate, preview, and export controls on the shipped forge surface", () => {
    renderPanel();
    expect(document.querySelector("[data-studio-vrm-generate]")).toBeTruthy();
    expect(document.querySelector("[data-studio-vrm-generate-preview]")).toBeTruthy();
    expect(document.querySelector("[data-studio-vrm-generate-submit]")).toBeTruthy();
    expect(document.querySelector("[data-studio-vrm-generate-export]")).toBeTruthy();
    expect(screen.getByRole("button", { name: "VRM 생성" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "VRM 내보내기" })).toBeTruthy();
    expect(document.querySelector("[data-studio-vrm-generate-preset]")?.getAttribute(
      "data-studio-vrm-generate-preset",
    )).toBe("wave-diva");
  });

  it("creates a new VRM file from the current forge preset", async () => {
    const { onGeneratedFile } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "VRM 생성" }));
    await waitFor(() => expect(onGeneratedFile).toHaveBeenCalledOnce());
    const file = vi.mocked(onGeneratedFile).mock.calls[0]?.[0] as File;
    expect(file.name).toBe("웨이브 디바.vrm");
    expect(file.size).toBeGreaterThan(200);
    expect(screen.getByRole("status").textContent).toContain("웨이브 디바");
  });
});

describe("StudioVrmAvatarForgePanel body creator", () => {
  it("exposes a compact four-step creation flow and a dedicated body workspace", () => {
    renderPanel();
    const tablist = screen.getByRole("tablist", { name: "아바타 조형 단계" });
    const bodyTab = screen.getByRole("tab", { name: "체형" });

    expect(tablist.className).toContain("grid-cols-4");
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(bodyTab.className).toContain("min-w-0");

    fireEvent.click(bodyTab);

    expect(bodyTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "체형 실루엣 편집" })).toBeTruthy();
    expect(screen.getAllByRole("slider")).toHaveLength(9);
    const presets = screen.getAllByRole("button", { name: /두신.*체형:/u });
    expect(presets).toHaveLength(7);
    expect(presets.map((button) => button.getAttribute("aria-label")?.slice(0, 2))).toEqual([
      "3두", "4두", "5두", "6두", "7두", "8두", "9두",
    ]);
    expect(screen.getByText(/본을 찌그러뜨리지 않고/u)).toBeTruthy();
    expect(screen.getByText(/두신 · 비율 기준 예상 신장/u)).toBeTruthy();
  });

  it("applies a deterministic head-unit preset while preserving the existing face and hair", () => {
    const { onChange, state } = renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "체형" }));
    fireEvent.click(screen.getByRole("button", { name: /^3두신 SD 치비 체형:/u }));

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0]?.[0] as AvatarForgeState;
    expect(next.bodyPresetId).toBeUndefined();
    expect(next.presetId).toBeUndefined();
    expect(next.proportions.presetId).toBe("sd-chibi-3");
    expect(next.proportions.headBodyRatio).toBeGreaterThan(2);
    expect(next.proportions.legLength).toBeLessThan(1);
    expect(next.face).toEqual(state.face);
    expect(next.hair).toEqual(state.hair);
    expect(next.faceAccents).toEqual(state.faceAccents);
  });

  it("turns a head-unit preset into a direct edit when a proportion slider moves", () => {
    const hero = createAvatarForgeState("wave-diva");
    hero.proportions = {
      ...hero.proportions,
      presetId: "webtoon-7",
      shoulderWidth: 1.03,
    };
    const { onChange } = renderPanel({ state: hero });
    fireEvent.click(screen.getByRole("tab", { name: "체형" }));

    fireEvent.change(screen.getByRole("slider", { name: "어깨 너비" }), {
      target: { value: "1.04" },
    });

    const next = onChange.mock.calls[0]?.[0] as AvatarForgeState;
    expect(next.bodyPresetId).toBeUndefined();
    expect(next.presetId).toBeUndefined();
    expect(next.proportions.presetId).toBeUndefined();
    expect(next.proportions.shoulderWidth).toBe(1.04);
    expect(next.hair).toEqual(hero.hair);
  });

  it("disables body recipes and sliders together when no VRM is loaded", () => {
    const { onChange } = renderPanel({ disabled: true });
    fireEvent.click(screen.getByRole("tab", { name: "체형" }));

    const chibi = screen.getByRole("button", { name: /^3두신 SD 치비 체형:/u });
    expect((chibi as HTMLButtonElement).disabled).toBe(true);
    for (const slider of screen.getAllByRole("slider")) {
      expect((slider as HTMLInputElement).disabled).toBe(true);
    }

    fireEvent.click(chibi);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows measured runtime proportions and isolates an unsupported rig from hair editing", () => {
    const { onChange } = renderPanel({
      proportionMetrics: {
        totalHeight: 1.73,
        headLength: 0.23,
        headUnits: 7.52,
        footHeight: 0,
        hipsHeight: 0.91,
        legLength: 0.84,
        armLength: 0.72,
        shoulderSpan: 0.4,
      },
      proportionUnavailableReason: "필수 손 본을 찾지 못했습니다.",
    });
    fireEvent.click(screen.getByRole("tab", { name: "체형" }));

    expect(screen.getByText(/7\.5두신 · 모델 실측 신장 1\.73m/u)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("필수 손 본을 찾지 못했습니다.");
    expect(screen.getAllByRole("slider").every(
      (slider) => (slider as HTMLInputElement).disabled,
    )).toBe(true);

    fireEvent.click(screen.getByRole("tab", { name: "헤어" }));
    const shortHair = screen.getByRole("button", { name: "숏" });
    expect((shortHair as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(shortHair);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("blocks every sculpt control while an inconsistent rig requires a reload", () => {
    renderPanel({
      disabled: true,
      proportionUnavailableReason: "캐릭터를 다시 불러와 주세요.",
    });

    fireEvent.click(screen.getByRole("tab", { name: "체형" }));
    expect(screen.getByRole("alert").textContent).toContain(
      "아바타 조형을 잠시 중단했습니다.",
    );
    fireEvent.click(screen.getByRole("tab", { name: "헤어" }));
    expect((screen.getByRole("button", { name: "숏" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("explains when a model's safe limits clamp a selected head-unit preset", () => {
    const state = createAvatarForgeState("wave-diva");
    state.proportions = { ...state.proportions, presetId: "sd-chibi-3" };
    renderPanel({
      state,
      proportionPresetNote: "3두신 목표를 이 모델의 안전 범위에서 3.4두신까지 적용했습니다.",
    });
    fireEvent.click(screen.getByRole("tab", { name: "체형" }));
    expect(screen.getByText(/3두신 목표를 이 모델의 안전 범위에서 3\.4두신까지 적용했습니다/u)).toBeTruthy();
  });

  it("separates rig head units from the apparent ratio of a taller face sculpt", () => {
    const state = createAvatarForgeState();
    state.face = { ...state.face, headHeight: 1.1 };
    renderPanel({
      state,
      proportionMetrics: {
        totalHeight: 1.8,
        headLength: 0.225,
        headUnits: 8,
        footHeight: 0.08,
        hipsHeight: 0.95,
        legLength: 0.88,
        armLength: 0.72,
        shoulderSpan: 0.4,
      },
    });
    fireEvent.click(screen.getByRole("tab", { name: "체형" }));
    expect(screen.getByText(/골격 8\.0두신/u)).toBeTruthy();
    expect(screen.getByText(/현재 얼굴 조형 7\.4두신/u)).toBeTruthy();
  });
});

describe("StudioVrmAvatarForgePanel default-style intent", () => {
  /**
   * 부모(useStudioVrmPoserRuntimeC)처럼 올라온 상태를 정규화해 되돌려 주는 제어 래퍼.
   * "새 VRM 설치" 버튼은 useStudioVrmPoserInstall 이 하는 조형 상태 전면 교체를 흉내낸다.
   */
  function renderControlled(initial: AvatarForgeState) {
    function Host() {
      const [state, setState] = useState(initial);
      const [modelId, setModelId] = useState("model-a");
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setModelId((current) => (current === "model-a" ? "model-b" : "model-a"));
              setState(createAvatarForgeState());
            }}
          >
            새 VRM 설치
          </button>
          <StudioVrmAvatarForgePanel
            state={state}
            sculptSessionId={modelId}
            detectedOriginalHairCount={2}
            proportionMetrics={null}
            proportionPresetNote={null}
            proportionUnavailableReason={null}
            onChange={(next) => setState(parseAvatarForgeState(next))}
            onGeneratedFile={vi.fn()}
          />
        </>
      );
    }
    return render(<Host />);
  }

  const defaultPresetNotice = () =>
    document.querySelector("[data-studio-vrm-generate-default-preset]");

  it("stops applying the default style once a hair silhouette is picked", () => {
    renderControlled(createAvatarForgeState());
    expect(defaultPresetNotice()).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "헤어" }));
    fireEvent.click(screen.getByRole("button", { name: /트윈테일/u }));

    // 부모가 정규화해 되돌려 준 뒤에도 "직접 골랐다"는 의도가 살아남아야 한다.
    expect(defaultPresetNotice()).toBeNull();
  });

  it("forgets the hair choice when the forge state is replaced from outside", () => {
    renderControlled(createAvatarForgeState());
    fireEvent.click(screen.getByRole("tab", { name: "헤어" }));
    fireEvent.click(screen.getByRole("button", { name: /트윈테일/u }));
    expect(defaultPresetNotice()).toBeNull();

    // 새 VRM 설치는 조형 상태를 통째로 초기화하지만 패널은 마운트된 채로 남는다.
    // 이전 캐릭터의 헤어 의도가 살아남으면 새 캐릭터가 민머리로 생성된다.
    fireEvent.click(screen.getByRole("button", { name: "새 VRM 설치" }));
    expect(defaultPresetNotice()?.getAttribute("data-studio-vrm-generate-default-preset")).toBe(
      STUDIO_VRM_GENERATE_DEFAULT_PRESET_ID,
    );
  });

  it("forgets an explicit no-hair choice when a different model is installed", () => {
    // 순정 상태에서 "헤어 없음"을 고르면 상태가 그대로라 서명이 바뀌지 않는다. 새 모델의
    // 조형 상태도 순정이므로 서명 비교로는 교체를 알아볼 수 없다 — 모델 신원이 필요하다.
    renderControlled(createAvatarForgeState());
    fireEvent.click(screen.getByRole("tab", { name: "헤어" }));
    fireEvent.click(screen.getByRole("button", { name: "헤어 없음" }));
    expect(defaultPresetNotice()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "새 VRM 설치" }));
    expect(defaultPresetNotice()?.getAttribute("data-studio-vrm-generate-default-preset")).toBe(
      STUDIO_VRM_GENERATE_DEFAULT_PRESET_ID,
    );
  });

  it("keeps an explicit no-hair choice through the parent's normalisation", () => {
    renderControlled(createAvatarForgeState());
    fireEvent.click(screen.getByRole("tab", { name: "헤어" }));
    // "없음"은 이미 기본값이라 상태가 그대로다 — 서명이 같아도 의도는 지워지면 안 된다.
    fireEvent.click(screen.getByRole("button", { name: "헤어 없음" }));
    expect(defaultPresetNotice()).toBeNull();
  });
});
