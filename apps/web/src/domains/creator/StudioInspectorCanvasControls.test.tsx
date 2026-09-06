// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BG_PRESETS } from "./studio-assets";
import { GRADIENT_PRESETS, gradientToBgGrad } from "./studio-gradients";
import { resetStudioInspectorSectionStateCache } from "./studio-inspector-section-state";
import {
  StudioInspectorCanvasControls,
  type StudioInspectorCanvasControlsProps,
} from "./StudioInspectorCanvasControls";

import type { MagicResizePreset, MagicResizeStrategy } from "./studio-magic-resize";

import { useI18n } from "@/shared/lib/i18n";

const MAGIC_PRESET: MagicResizePreset = {
  id: "test-preset",
  label: "테스트 규격",
  hint: "테스트",
  aspectW: 1,
  aspectH: 1,
};

vi.mock("./StudioMagicResizePanel", () => ({
  StudioMagicResizePanel: ({
    currentSize,
    onApplyPreset,
    onStrategyChange,
  }: {
    currentSize: { width: number; height: number };
    onApplyPreset: (preset: MagicResizePreset) => void;
    onStrategyChange: (strategy: MagicResizeStrategy) => void;
  }) => (
    <section aria-label={`매직 리사이즈 ${currentSize.width}×${currentSize.height}`}>
      <button type="button" onClick={() => onApplyPreset(MAGIC_PRESET)}>
        테스트 규격 적용
      </button>
      <button type="button" onClick={() => onStrategyChange("scaleToFit")}>
        맞춤 축소 전략
      </button>
    </section>
  ),
}));

afterEach(cleanup);

beforeEach(() => {
  useI18n.getState().setLang("ko");
  // 접기 상태는 이제 저장된다 — 테스트 간 누수를 막는다.
  globalThis.localStorage.clear();
  resetStudioInspectorSectionStateCache();
});

/**
 * 접힌 섹션을 헤더 클릭으로 연다 — 아티스트가 실제로 밟는 경로와 같다.
 * 이 헬퍼가 필요하다는 사실 자체가 계약이다: advanced 컨트롤은 디스클로저
 * 하나 뒤에 있고, 그 하나는 이름 있는 버튼이라 키보드로도 닿는다.
 */
function openSection(label: string): HTMLElement {
  const header = screen.getByRole("button", {
    name: new RegExp(`^${label}`, "u"),
  });
  expect(header.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(header);
  expect(header.getAttribute("aria-expanded")).toBe("true");
  return header;
}

function canvasProps(
  overrides: Partial<StudioInspectorCanvasControlsProps> = {}
): StudioInspectorCanvasControlsProps {
  return {
    background: "#ffffff",
    backgroundGradient: null,
    canvasHeight: 12_000,
    controlsDisabled: false,
    controlsDisabledReason: null,
    gridSize: 40,
    hidden: false,
    magicResizeStrategy: "reposition",
    masterEditMode: false,
    panelGutter: 24,
    paperGrainKind: "cold-press",
    paperGrainVisible: true,
    showGrid: true,
    showAlignmentGuides: true,
    showWebtoonGuides: false,
    snapEnabled: true,
    templateGutterUnavailableReason: null,
    userGuides: [
      { id: "guide-v", type: "v", pos: 320 },
      { id: "guide-h", type: "h", pos: 1_800 },
    ],
    webtoonGuides: null,
    webtoonTheme: "classic",
    onAddUserGuide: vi.fn(),
    onApplyBackgroundPreset: vi.fn(),
    onApplyMagicResizePreset: vi.fn(),
    onBackgroundChange: vi.fn(),
    onCanvasHeightDelta: vi.fn(),
    onClearUserGuides: vi.fn(),
    onDeleteUserGuide: vi.fn(),
    onGradientChange: vi.fn(),
    onGridSizeChange: vi.fn(),
    onMagicResizeStrategyChange: vi.fn(),
    onMoveUserGuide: vi.fn(),
    onOpenBackgroundEditor: vi.fn(),
    onPaperGrainKindChange: vi.fn(),
    onPaperGrainVisibleChange: vi.fn(),
    onApplyPaperTintBackground: vi.fn(),
    onPanelGutterChange: vi.fn(),
    onShowGridChange: vi.fn(),
    onShowWebtoonGuidesChange: vi.fn(),
    onShowAlignmentGuidesChange: vi.fn(),
    onSnapEnabledChange: vi.fn(),
    onWarmWebtoonGuides: vi.fn(),
    onWebtoonThemeChange: vi.fn(),
    ...overrides,
  };
}

describe("StudioInspectorCanvasControls", () => {
  it("종이 질감 선택을 부모 callback으로 전달한다", () => {
    const props = canvasProps();
    render(<StudioInspectorCanvasControls {...props} />);

    openSection("배경·종이 질감");
    fireEvent.click(screen.getByRole("button", { name: "한지" }));
    expect(props.onPaperGrainKindChange).toHaveBeenCalledWith("washi");
    fireEvent.click(screen.getByRole("button", { name: "목탄지" }));
    expect(props.onPaperGrainKindChange).toHaveBeenCalledWith("charcoal");
  });

  it("선택 종이의 물성·브러시 반응과 미리보기 범위를 설명한다", () => {
    const props = canvasProps();
    const view = render(<StudioInspectorCanvasControls {...props} />);

    openSection("배경·종이 질감");
    expect(screen.getByText("균형 · 자연스러운 과립")).toBeTruthy();
    expect(screen.getByRole("img", { name: "수채 중목 실제 결 확대 미리보기" })).toBeTruthy();
    expect(screen.getAllByRole("meter")).toHaveLength(4);
    expect(screen.getByText("브러시 성질별 반응")).toBeTruthy();
    expect(screen.getByText("연필·목탄·파스텔")).toBeTruthy();
    expect(screen.getByText("G펜·마커·에어브러시")).toBeTruthy();
    expect(screen.getByText("영향 없음")).toBeTruthy();

    view.rerender(
      <StudioInspectorCanvasControls {...canvasProps({ paperGrainKind: "rough" })} />,
    );
    expect(screen.getByText("거침 · 강한 과립")).toBeTruthy();
    expect(screen.getByText(/굵고 깊은 요철/u)).toBeTruthy();
    expect(screen.getByText(/드라이브러시, 풍경, 질감 수채/u)).toBeTruthy();
  });

  it("편집 화면 미리보기 토글과 종이색 배경 적용을 controlled callback으로 전달한다", () => {
    const props = canvasProps();
    render(<StudioInspectorCanvasControls {...props} />);

    openSection("배경·종이 질감");
    const preview = screen.getByRole("checkbox", {
      name: /편집 화면에서 종이 결 미리보기/u,
    });
    expect((preview as HTMLInputElement).checked).toBe(true);
    fireEvent.click(preview);
    expect(props.onPaperGrainVisibleChange).toHaveBeenCalledWith(false);
    expect(screen.getByText("화면 표시만 바꾸며 브러시의 종이 반응은 유지됩니다.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "배경도 중목 색으로 맞추기" }));
    expect(props.onApplyPaperTintBackground).toHaveBeenCalledTimes(1);
  });

  it("배경·그라디언트·편집기·캔버스 높이 동작을 부모 callback으로 전달한다", () => {
    const props = canvasProps();
    render(<StudioInspectorCanvasControls {...props} />);

    // 배경색과 높이는 기본 티어 — 디스클로저 없이 바로 닿는다.
    fireEvent.change(screen.getByLabelText("배경색"), {
      target: { value: "#123456" },
    });
    expect(props.onBackgroundChange).toHaveBeenCalledWith("#123456");

    fireEvent.click(screen.getByRole("button", { name: "높이 240px 줄이기" }));
    fireEvent.click(screen.getByRole("button", { name: "높이 240px 늘리기" }));
    expect(props.onCanvasHeightDelta).toHaveBeenNthCalledWith(1, -240);
    expect(props.onCanvasHeightDelta).toHaveBeenNthCalledWith(2, 240);

    openSection("배경·종이 질감");
    fireEvent.click(
      screen.getByRole("button", { name: `배경 ${BG_PRESETS[0]?.label}` })
    );
    expect(props.onApplyBackgroundPreset).toHaveBeenCalledWith(BG_PRESETS[0]);

    fireEvent.click(
      screen.getByRole("button", { name: `그라디언트 ${GRADIENT_PRESETS[0]?.label}` })
    );
    expect(props.onGradientChange).toHaveBeenCalledWith(
      gradientToBgGrad(GRADIENT_PRESETS[0]!)
    );

    fireEvent.click(screen.getByRole("button", { name: "배경 편집기 · 리사이저 열기" }));
    expect(props.onOpenBackgroundEditor).toHaveBeenCalledTimes(1);
  });

  it("현재 단색·배경 그라디언트·무드 그라디언트 프리셋을 aria-pressed로 구분한다", () => {
    const backgroundGradientPreset = BG_PRESETS.find((preset) => preset.grad)!;
    const backgroundGradient = backgroundGradientPreset.grad!;
    const moodGradient = gradientToBgGrad(GRADIENT_PRESETS[0]!);
    const view = render(
      <StudioInspectorCanvasControls
        {...canvasProps({ paperGrainVisible: false })}
      />,
    );

    openSection("배경·종이 질감");
    expect(
      screen.getByRole("button", { name: "배경 흰색" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: `배경 ${backgroundGradientPreset.label}` })
        .getAttribute("aria-pressed"),
    ).toBe("false");

    view.rerender(
      <StudioInspectorCanvasControls
        {...canvasProps({
          background: "#FFFFFF",
          backgroundGradient,
          paperGrainVisible: false,
        })}
      />,
    );
    expect(
      screen.getByRole("button", { name: "배경 흰색" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: `배경 ${backgroundGradientPreset.label}` })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    view.rerender(
      <StudioInspectorCanvasControls
        {...canvasProps({ backgroundGradient: moodGradient, paperGrainVisible: false })}
      />,
    );
    expect(
      screen.getByRole("button", { name: `그라디언트 ${GRADIENT_PRESETS[0]!.label}` })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: `배경 ${backgroundGradientPreset.label}` })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("접힌 배경 섹션의 activeCount가 단색과 bgGrad를 모두 반영한다", () => {
    const view = render(
      <StudioInspectorCanvasControls
        {...canvasProps({ paperGrainVisible: false })}
      />,
    );

    expect(screen.getByRole("button", { name: "배경·종이 질감" })).toBeTruthy();

    view.rerender(
      <StudioInspectorCanvasControls
        {...canvasProps({
          backgroundGradient: gradientToBgGrad(GRADIENT_PRESETS[0]!),
          paperGrainVisible: false,
        })}
      />,
    );
    expect(
      screen.getByRole("button", { name: "배경·종이 질감, 설정 1개 켜짐" }),
    ).toBeTruthy();

    view.rerender(
      <StudioInspectorCanvasControls
        {...canvasProps({
          background: "#fbf3e4",
          backgroundGradient: null,
          paperGrainVisible: false,
        })}
      />,
    );
    expect(
      screen.getByRole("button", { name: "배경·종이 질감, 설정 1개 켜짐" }),
    ).toBeTruthy();
  });

  it("스냅·그리드·규격과 사용자 가이드 조작을 controlled callback으로 전달한다", () => {
    const props = canvasProps();
    render(<StudioInspectorCanvasControls {...props} />);

    // 기본 티어 — 스냅·그리드·웹툰 규격은 접기 뒤가 아니다.
    const snapGuideCheckbox = screen.getByRole("checkbox", {
      name: /오브젝트·격자 스냅/u,
    });
    fireEvent.click(snapGuideCheckbox);
    expect(props.onSnapEnabledChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByLabelText("그리드 격자 표시"));
    expect(props.onShowGridChange).toHaveBeenCalledWith(false);
    fireEvent.change(screen.getByRole("combobox", { name: "그리드 간격" }), {
      target: { value: "60" },
    });
    expect(props.onGridSizeChange).toHaveBeenCalledWith(60);

    const webtoonGuideToggle = screen.getByLabelText("웹툰 규격 가이드");
    fireEvent.focus(webtoonGuideToggle);
    fireEvent.click(webtoonGuideToggle);
    expect(props.onWarmWebtoonGuides).toHaveBeenCalledTimes(1);
    expect(props.onShowWebtoonGuidesChange).toHaveBeenCalledWith(true);

    openSection("크기·여백");
    fireEvent.change(screen.getByRole("slider", { name: /패널 여백/u }), {
      target: { value: "32" },
    });
    expect(props.onPanelGutterChange).toHaveBeenCalledWith(32);

    openSection("가이드선");
    const alignmentGuideCheckbox = screen.getByRole("checkbox", {
      name: /정렬선 표시/u,
    });
    fireEvent.click(alignmentGuideCheckbox);
    expect(props.onShowAlignmentGuidesChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "+ 세로 가이드" }));
    fireEvent.click(screen.getByRole("button", { name: "+ 가로 가이드" }));
    expect(props.onAddUserGuide).toHaveBeenNthCalledWith(1, "v");
    expect(props.onAddUserGuide).toHaveBeenNthCalledWith(2, "h");

    fireEvent.change(screen.getByRole("slider", { name: "세로 가이드 #1 위치" }), {
      target: { value: "400" },
    });
    expect(props.onMoveUserGuide).toHaveBeenCalledWith("guide-v", 400);

    fireEvent.click(screen.getAllByRole("button", { name: "삭제" })[0]!);
    expect(props.onDeleteUserGuide).toHaveBeenCalledWith("guide-v");
    fireEvent.click(screen.getByRole("button", { name: "모든 가이드 삭제" }));
    expect(props.onClearUserGuides).toHaveBeenCalledTimes(1);
  });

  it("퍼센트 프리셋과 직접 입력을 방향별 캔버스 px 위치로 변환한다", () => {
    const props = canvasProps();
    render(<StudioInspectorCanvasControls {...props} />);

    openSection("가이드선");
    fireEvent.click(screen.getByRole("button", { name: "세로 가이드 25% 추가" }));
    expect(props.onAddUserGuide).toHaveBeenLastCalledWith("v", 180);

    fireEvent.click(screen.getByRole("radio", { name: "가로 · 높이 기준" }));
    fireEvent.click(screen.getByRole("button", { name: "가로 가이드 33.3% 추가" }));
    expect(props.onAddUserGuide).toHaveBeenLastCalledWith("h", 3_996);

    const directInput = screen.getByRole("textbox", { name: "직접 입력" });
    fireEvent.change(directInput, { target: { value: " 66,7 % " } });
    expect(screen.getByText("66.7% → 8004px")).toBeTruthy();
    fireEvent.submit(directInput.closest("form")!);
    expect(props.onAddUserGuide).toHaveBeenLastCalledWith("h", 8_004);
  });

  it("잘못된 퍼센트는 fail-closed하고 입력 오류를 접근 가능하게 알린다", () => {
    const props = canvasProps();
    render(<StudioInspectorCanvasControls {...props} />);

    openSection("가이드선");
    const directInput = screen.getByRole("textbox", { name: "직접 입력" });
    const addButton = screen.getByRole("button", { name: "추가" });
    const initialCalls = vi.mocked(props.onAddUserGuide).mock.calls.length;

    for (const value of ["0", "100", "NaN", "Infinity", " "]) {
      fireEvent.change(directInput, { target: { value } });
      expect((addButton as HTMLButtonElement).disabled).toBe(true);
      fireEvent.submit(directInput.closest("form")!);
    }

    expect(props.onAddUserGuide).toHaveBeenCalledTimes(initialCalls);
    fireEvent.change(directInput, { target: { value: "100" } });
    expect(directInput.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("100보다 작은");
  });

  it("매직 리사이즈와 테마 변경을 위임하고 문서 제어 잠금을 UI에 반영한다", () => {
    const props = canvasProps();
    const { rerender } = render(<StudioInspectorCanvasControls {...props} />);

    openSection("크기·여백");
    openSection("가이드선");
    openSection("만화/웹툰 연출 스타일");
    expect(screen.getByRole("region", { name: "매직 리사이즈 720×12000" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "테스트 규격 적용" }));
    fireEvent.click(screen.getByRole("button", { name: "맞춤 축소 전략" }));
    fireEvent.click(screen.getByRole("button", { name: "소프트" }));
    expect(props.onApplyMagicResizePreset).toHaveBeenCalledWith(MAGIC_PRESET);
    expect(props.onMagicResizeStrategyChange).toHaveBeenCalledWith("scaleToFit");
    expect(props.onWebtoonThemeChange).toHaveBeenCalledWith("soft");

    rerender(
      <StudioInspectorCanvasControls
        {...props}
        controlsDisabled
        controlsDisabledReason="검토 잠금을 해제한 뒤 변경할 수 있어요."
      />
    );
    expect(
      (screen.getByRole("slider", { name: /패널 여백/u }) as HTMLInputElement).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "소프트" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "세로 가이드 25% 추가" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);

    rerender(<StudioInspectorCanvasControls {...props} masterEditMode />);
    expect(screen.queryByRole("region", { name: /매직 리사이즈/u })).toBeNull();
  });

  it("패널 여백 비활성 이유를 인라인으로 설명하고 슬라이더에 연결한다", () => {
    const view = render(
      <StudioInspectorCanvasControls
        {...canvasProps({ templateGutterUnavailableReason: "no-template" })}
      />,
    );
    openSection("크기·여백");

    const slider = screen.getByRole("slider", { name: /패널 여백/u });
    expect((slider as HTMLInputElement).disabled).toBe(true);
    const reasonId = slider.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    expect(document.getElementById(reasonId!)?.textContent).toContain("패널 템플릿을 적용");

    view.rerender(
      <StudioInspectorCanvasControls
        {...canvasProps({ templateGutterUnavailableReason: "no-panels" })}
      />,
    );
    expect(screen.getByText("빈 캔버스에는 여백을 조절할 패널이 없어요.")).toBeTruthy();

    view.rerender(
      <StudioInspectorCanvasControls
        {...canvasProps({ templateGutterUnavailableReason: "unsupported-topology" })}
      />,
    );
    expect(screen.getByText(/비정형 패널 배치/u)).toBeTruthy();
  });

  it("문서 잠금 사유를 템플릿 미지원보다 우선해 서로 구분한다", () => {
    render(
      <StudioInspectorCanvasControls
        {...canvasProps({
          controlsDisabled: true,
          controlsDisabledReason: "공동 문서 편집 권한이 없어 변경할 수 없어요.",
          templateGutterUnavailableReason: "unsupported-topology",
        })}
      />,
    );
    openSection("크기·여백");

    const slider = screen.getByRole("slider", { name: /패널 여백/u });
    const reasonId = slider.getAttribute("aria-describedby");
    expect(document.getElementById(reasonId!)?.textContent).toBe(
      "공동 문서 편집 권한이 없어 변경할 수 없어요.",
    );
    expect(screen.queryByText(/비정형 패널 배치/u)).toBeNull();
  });
});

/**
 * Wave D 는 이 패널을 손대지 않아서 23개 컨트롤이 전부 펼쳐진 채였다 — 인스펙터에서
 * 가장 긴 스크롤이었다. 아래는 그걸 접고 나서 지켜야 하는 것들이다.
 */
describe("StudioInspectorCanvasControls — CSP식 접기", () => {
  const ADVANCED_SECTIONS = [
    "배경·종이 질감",
    "크기·여백",
    "가이드선",
    "만화/웹툰 연출 스타일",
  ] as const;

  it("기본 티어 다섯 가지는 접기 없이 바로 보인다", () => {
    render(<StudioInspectorCanvasControls {...canvasProps()} />);

    expect(screen.getByLabelText("배경색")).toBeTruthy();
    expect(screen.getByRole("button", { name: "높이 240px 늘리기" })).toBeTruthy();
    expect(screen.getByLabelText("그리드 격자 표시")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /오브젝트·격자 스냅/u })).toBeTruthy();
    expect(screen.getByLabelText("웹툰 규격 가이드")).toBeTruthy();
  });

  it("접힌 섹션은 열기 전까지 자기 컨트롤을 아예 렌더하지 않는다", () => {
    render(<StudioInspectorCanvasControls {...canvasProps()} />);

    // 열기 전: 안쪽 컨트롤이 DOM 에 없다(숨김이 아니라 미마운트).
    expect(screen.queryByRole("button", { name: "배경 편집기 · 리사이저 열기" })).toBeNull();
    expect(screen.queryByRole("slider", { name: /패널 여백/u })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ 세로 가이드" })).toBeNull();
    expect(screen.queryByRole("button", { name: "소프트" })).toBeNull();

    for (const label of ADVANCED_SECTIONS) openSection(label);

    expect(screen.getByRole("button", { name: "배경 편집기 · 리사이저 열기" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: /패널 여백/u })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ 세로 가이드" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "소프트" })).toBeTruthy();
  });

  it("모든 섹션 헤더가 aria-expanded 와 aria-controls 를 가진 진짜 버튼이다", () => {
    render(<StudioInspectorCanvasControls {...canvasProps()} />);

    for (const label of ADVANCED_SECTIONS) {
      const header = screen.getByRole("button", {
        name: new RegExp(`^${label}`, "u"),
      });
      expect(header.tagName).toBe("BUTTON");
      expect(header.getAttribute("type")).toBe("button");
      expect(header.getAttribute("aria-expanded")).toBe("false");
      const controls = header.getAttribute("aria-controls");
      expect(controls).toBeTruthy();
      expect(document.getElementById(controls!)).toBeTruthy();
    }
  });

  it("키보드 Enter 로도 열린다 — 마우스 전용 경로가 아니다", () => {
    render(<StudioInspectorCanvasControls {...canvasProps()} />);

    const header = screen.getByRole("button", { name: /^가이드선/u });
    header.focus();
    expect(document.activeElement).toBe(header);
    // 네이티브 <button> 이므로 Enter 는 click 으로 승격된다.
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
  });

  it("값이 설정된 섹션은 닫힌 헤더에 배지로 그 사실을 밝힌다", () => {
    render(
      <StudioInspectorCanvasControls
        {...canvasProps({ showAlignmentGuides: true, webtoonTheme: "vivid" })}
      />,
    );

    // 가이드선: 정렬선 표시 + 사용자 가이드 있음 → 2. 숫자 배지는 시각 전용이고
    // 접근 가능한 이름에는 문장이 들어간다("가이드선2" 로 붙여 읽히지 않게).
    expect(
      screen.getByRole("button", { name: "가이드선, 설정 2개 켜짐" }),
    ).toBeTruthy();
    // 연출 스타일: 기본값(출판만화)이 아니므로 1
    expect(
      screen.getByRole("button", { name: "만화/웹툰 연출 스타일, 설정 1개 켜짐" }),
    ).toBeTruthy();
  });

  it("기본값 그대로인 섹션에는 배지를 붙이지 않는다", () => {
    render(
      <StudioInspectorCanvasControls
        {...canvasProps({
          showAlignmentGuides: false,
          userGuides: [],
          webtoonTheme: "classic",
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "가이드선" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "만화/웹툰 연출 스타일" })).toBeTruthy();
  });

  it("펼쳐 둔 섹션은 패널이 통째로 언마운트됐다 돌아와도 펼쳐진 채다", () => {
    const view = render(<StudioInspectorCanvasControls {...canvasProps()} />);
    openSection("크기·여백");

    // 인스펙터가 페이지 탭을 떠났다 돌아오는 상황.
    view.unmount();
    render(<StudioInspectorCanvasControls {...canvasProps()} />);

    const header = screen.getByRole("button", { name: /^크기·여백/u });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("slider", { name: /패널 여백/u })).toBeTruthy();
  });

  it("접어 둔 것도 똑같이 기억한다 — 기억은 한쪽 방향이 아니다", () => {
    const view = render(<StudioInspectorCanvasControls {...canvasProps()} />);
    const opened = openSection("가이드선");
    fireEvent.click(opened);
    expect(opened.getAttribute("aria-expanded")).toBe("false");

    view.unmount();
    render(<StudioInspectorCanvasControls {...canvasProps()} />);
    expect(
      screen.getByRole("button", { name: /^가이드선/u }).getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("모든 컨트롤은 접기 뒤로 갔을 뿐 사라지지 않았다", () => {
    const props = canvasProps();
    render(<StudioInspectorCanvasControls {...props} />);
    for (const label of ADVANCED_SECTIONS) openSection(label);

    // density 표가 23개 leaf 를 선언한다. 대표 컨트롤이 전부 살아 있는지 훑는다.
    for (const name of [
      "배경 편집기 · 리사이저 열기",
      "+ 세로 가이드",
      "+ 가로 가이드",
      "모든 가이드 삭제",
      "세로 가이드 25% 추가",
      "출판만화",
      "소프트",
      "비비드",
      "배경도 중목 색으로 맞추기",
    ]) {
      expect(screen.getByRole("button", { name }), name).toBeTruthy();
    }
    expect(screen.getByRole("slider", { name: /패널 여백/u })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "세로 가이드 #1 위치" })).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: /편집 화면에서 종이 결 미리보기/u }),
    ).toBeTruthy();
  });
});
